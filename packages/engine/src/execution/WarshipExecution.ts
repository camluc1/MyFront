import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRandom,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { findMinimumBy } from "@openfront/engine-lib/Util";
import { z } from "zod";
import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitParams,
} from "../game/Game";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  restoreWaterPathFinder,
  WaterPathFinderSchema,
  waterPathFinderState,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { ShellExecution } from "./ShellExecution";

/** Mobile naval logistics use the existing vessel type and batched renderer. */
export const SUPPORT_SHIP_COST = 5_000_000n;
export const SUPPORT_SHIP_RADIUS = 90;
export const SUPPORT_SHIP_CAPACITY = 3;
const SUPPORT_DOCK_RADIUS = 75;
const SUPPORT_COMBAT_COOLDOWN = 10;

export class WarshipExecution implements Execution {
  private random: PseudoRandom;
  private warship: Unit;
  private mg: Game;
  private pathfinder: WaterPathFinder;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private lastManualMoveTickRetreatDisabled = 0;
  private lastObservedPatrolTile: TileRef | undefined;
  private activeHealingRemainder = 0;
  private lastEmittedCombat = false;
  /** Persistent repair bays: three ships remain assigned until they leave or recover. */
  private assignedRepairShipIDs: number[] = [];

  constructor(
    private input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = new WaterPathFinder(mg);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.warship = this.input;
    } else {
      const support = this.input.supportShip === true;
      if (support && (mg.config().gameConfig().geopolitics !== true ||
          (!mg.config().infiniteGold() && this.input.owner.gold() < SUPPORT_SHIP_COST))) return;
      const baseCost = mg.unitInfo(UnitType.Warship).cost(mg, this.input.owner);
      const spawn = this.input.owner.canBuild(
        UnitType.Warship,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn warship for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.warship = this.input.owner.buildUnit(
        UnitType.Warship,
        spawn,
        this.input,
      );
      // buildUnit already charged the ordinary warship amount.
      if (support && !mg.config().infiniteGold()) {
        this.input.owner.removeGold(SUPPORT_SHIP_COST - baseCost);
      }
    }
    this.lastObservedPatrolTile = this.warship.warshipState().patrolTile;
  }

  tick(ticks: number): void {
    if (this.warship.health() <= 0) {
      this.warship.delete();
      return;
    }
    const isInCombat = this.warship.warshipState().isInCombat ?? false;
    if (this.lastEmittedCombat && !isInCombat) {
      this.warship.touch();
    }
    this.lastEmittedCombat = isInCombat;
    const healthBeforeHealing = this.warship.health();

    if (this.warship.warshipState().supportShip) {
      // Off-mode keeps the pre-existing self-heal and stationary repair rules.
      if (!this.mg.config().isFunctionalGeopolitics()) {
        this.healWarship();
        this.moveSupportShip();
        this.repairSupportedShips();
        return;
      }
      // Experimental service base: no autonomous health regeneration at sea.
      // It retreats only if an accessible friendly port is available, using
      // the same port docking + repair logic as a regular warship.
      if (this.warship.warshipState().state === "docked") {
        if (!this.currentRetreatPort()) {
          this.cancelRepairRetreat();
        } else {
          this.healWarship();
          if (this.isFullyHealed()) this.cancelRepairRetreat();
          else return;
        }
      }
      if (this.warship.warshipState().state === "retreating" &&
          this.handleRepairRetreat()) return;
      if (!this.warship.owner().inDoomsdayClock() &&
          this.warship.health() * 2 < this.warship.maxHealth()) {
        const port = this.findNearestPort();
        if (port !== undefined) {
          this.warship.updateWarshipState({
            state: "retreating",
            retreatPort: port,
            retreatSupportID: undefined,
          });
          if (this.handleRepairRetreat()) return;
        }
      }
      // At full health, the service base resumes its original ordered post.
      // It never randomly escorts warships.
      this.moveSupportShip();
      this.repairSupportedShips();
      return;
    }

    this.healWarship();
    this.handleManualPatrolOverride();

    // A doomed side cannot repair its navy (see healWarship), so retreating to
    // a port only pulls a warship out of the fight to idle there forever. Undock
    // or abort any retreat and keep patrolling until the side recovers.
    if (
      this.warship.owner().inDoomsdayClock() &&
      this.warship.warshipState().state !== "patrolling"
    ) {
      this.cancelRepairRetreat();
    }

    if (this.warship.warshipState().state === "docked") {
      if (this.currentRetreatPort() === undefined &&
          this.currentRetreatSupport() === undefined) {
        this.cancelRepairRetreat();
      }
      const support = this.currentRetreatSupport();
      if (support && this.mg.euclideanDistSquared(this.warship.tile(), support.tile()) >
          SUPPORT_DOCK_RADIUS * SUPPORT_DOCK_RADIUS) {
        this.warship.updateWarshipState({ state: "retreating" });
      }
      if (this.isFullyHealed()) {
        this.cancelRepairRetreat();
      }
      if (this.warship.warshipState().state === "docked") {
        return;
      }
    }

    if (this.handleRepairRetreat()) {
      return;
    }

    // Priority 1: Check if need to heal before doing anything else
    if (this.shouldStartRepairRetreat(healthBeforeHealing)) {
      this.startRepairRetreat();
      if (this.handleRepairRetreat()) {
        return;
      }
    }

    this.warship.setTargetUnit(this.findTargetUnit());

    // Priority 1: Shoot transport ship if in range
    if (this.warship.targetUnit()?.type() === UnitType.TransportShip) {
      this.shootTarget();
      this.patrol();
      return;
    }

    // Priority 2: Fight enemy warship if in range
    if (this.warship.targetUnit()?.type() === UnitType.Warship) {
      this.shootTarget();
      this.patrol();
      return;
    }

    // Priority 3: Hunt trade ship only if not healing and no enemy warship
    if (this.warship.targetUnit()?.type() === UnitType.TradeShip) {
      this.huntDownTradeShip();
      return;
    }

    this.patrol();
  }

  /** Sail toward the player-selected destination and remain stationary on arrival. */
  private moveSupportShip(): void {
    const destination = this.warship.warshipState().patrolTile;
    if (destination === undefined || !this.mg.isValidRef(destination)) return;
    if (!this.mg.isWater(destination)) {
      this.warship.updateWarshipState({ patrolTile: this.warship.tile() });
      this.warship.setTargetTile(undefined);
      return;
    }
    if (this.warship.tile() === destination) {
      this.warship.setTargetTile(undefined);
      return;
    }
    const component = this.mg.getWaterComponent(this.warship.tile());
    if (component === null || !this.mg.hasWaterComponent(destination, component)) {
      this.warship.updateWarshipState({ patrolTile: this.warship.tile() });
      this.warship.setTargetTile(undefined);
      return;
    }
    this.warship.setTargetTile(destination);
    const next = this.pathfinder.next(this.warship.tile(), destination);
    if (next.status === PathStatus.COMPLETE || next.status === PathStatus.NEXT) {
      this.warship.move(next.node);
      if (next.node === destination) this.warship.setTargetTile(undefined);
    } else if (next.status === PathStatus.NOT_FOUND) {
      // Stop expensive repeated path searches for an unreachable destination.
      // A new player order can always select a different route.
      this.warship.setTargetTile(undefined);
      this.warship.updateWarshipState({ patrolTile: this.warship.tile() });
    }
  }

  /** One nearby-unit lookup per dock and at most three repairs per tick. */
  private repairSupportedShips(): void {
    const owner = this.warship.owner();
    if (owner.inDoomsdayClock() ||
      this.mg.ticks() - this.warship.warshipState().lastCombatTick <= 3) return;
    const component = this.mg.getWaterComponent(this.warship.tile());
    if (component === null) return;
    const radiusSquared = SUPPORT_SHIP_RADIUS * SUPPORT_SHIP_RADIUS;
    const repairHP = this.warship.tile() === this.warship.warshipState().patrolTile ? 4 : 1;
    const candidates = this.mg.nearbyUnits(
      this.warship.tile(), SUPPORT_SHIP_RADIUS, [UnitType.Warship],
    ).filter(({ unit, distSquared }) =>
      unit !== this.warship && unit.owner() === owner && unit.isActive() &&
      !unit.isMarkedForDeletion() && !unit.warshipState().supportShip &&
      unit.health() > 0 && unit.health() < unit.maxHealth() &&
      this.mg.ticks() - unit.warshipState().lastCombatTick > SUPPORT_COMBAT_COOLDOWN &&
      distSquared <= radiusSquared && this.mg.hasWaterComponent(unit.tile(), component),
    );
    candidates.sort((a, b) =>
      a.unit.health() * b.unit.maxHealth() - b.unit.health() * a.unit.maxHealth() ||
      a.unit.id() - b.unit.id(),
    );
    // Inspect other service vessels only once for this tick. The normal
    // owner.units() lookup stays memoized and does not allocate per candidate.
    const otherDocks = owner.units(UnitType.Warship).filter((vessel) =>
      vessel !== this.warship && vessel.warshipState().supportShip &&
      vessel.isActive() && !vessel.isMarkedForDeletion() && vessel.health() > 0,
    );
    // Preserve the same three repair bays across ticks. Without sticky bays,
    // ships with lower health replace those just repaired every tick, causing
    // four or more different ships to heal despite a three-ship capacity.
    const candidateByID = new Map(candidates.map((entry) => [entry.unit.id(), entry]));
    const nextAssigned: number[] = [];
    const tryAssign = ({ unit, distSquared }: { unit: Unit; distSquared: number }): void => {
      if (nextAssigned.length >= SUPPORT_SHIP_CAPACITY) return;
      // Overlapping docks must not double-heal the same hull.
      let closestID = this.warship.id();
      let closestDist = distSquared;
      for (const vessel of otherDocks) {
        const d = this.mg.euclideanDistSquared(vessel.tile(), unit.tile());
        if (d <= radiusSquared &&
            (d < closestDist || (d === closestDist && vessel.id() < closestID))) {
          closestDist = d;
          closestID = vessel.id();
        }
      }
      if (closestID !== this.warship.id()) return;
      nextAssigned.push(unit.id());
      unit.modifyHealth(repairHP);
    };
    for (const id of this.assignedRepairShipIDs) {
      const candidate = candidateByID.get(id);
      if (!candidate) continue;
      tryAssign(candidate);
      candidateByID.delete(id);
    }
    for (const candidate of candidates) {
      if (nextAssigned.length >= SUPPORT_SHIP_CAPACITY) break;
      if (candidateByID.has(candidate.unit.id())) {
        tryAssign(candidate);
      }
    }
    this.assignedRepairShipIDs = nextAssigned;
  }

  /** The target moves, so store and resolve the support unit ID, never a static tile. */
  private currentRetreatSupport(): Unit | undefined {
    const id = this.warship.warshipState().retreatSupportID;
    if (id === undefined) return undefined;
    const unit = this.mg.unit(id);
    return unit?.type() === UnitType.Warship && unit.owner() === this.warship.owner() &&
      unit.warshipState().supportShip && unit.isActive() &&
      !unit.isMarkedForDeletion() && unit.health() > 0 ? unit : undefined;
  }

  private findNearestSupport(): Unit | undefined {
    const component = this.mg.getWaterComponent(this.warship.tile());
    if (component === null) return undefined;
    return findMinimumBy(
      this.warship.owner().units(UnitType.Warship),
      (candidate) => this.mg.euclideanDistSquared(this.warship.tile(), candidate.tile()),
      (candidate) => candidate !== this.warship && candidate.warshipState().supportShip === true &&
        candidate.isActive() && !candidate.isMarkedForDeletion() && candidate.health() > 0 &&
        this.mg.hasWaterComponent(candidate.tile(), component),
    ) ?? undefined;
  }

  private healWarship(): void {
    const owner = this.warship.owner();
    // A doomed side (below the Doomsday Clock bar) cannot repair its navy, so the
    // decay in DoomsdayClockExecution actually sinks warships instead of being
    // out-healed at a port. Inert when the mode is off: the mark is never set.
    if (owner.inDoomsdayClock()) return;
    const passiveHealing = this.mg.config().warshipPassiveHealing();
    const passiveHealingRange = this.mg.config().warshipPassiveHealingRange();
    const passiveHealingRangeSquared =
      passiveHealingRange * passiveHealingRange;
    const warshipTile = this.warship.tile();

    let isNearPort = false;
    for (const port of owner.units(UnitType.Port)) {
      const distSquared = this.mg.euclideanDistSquared(
        warshipTile,
        port.tile(),
      );
      if (distSquared <= passiveHealingRangeSquared) {
        isNearPort = true;
        break;
      }
    }

    if (isNearPort) {
      this.warship.modifyHealth(passiveHealing);
    }

    if (this.warship.warshipState().state === "docked") {
      this.applyActiveDockedHealing();
    }
  }

  private isFullyHealed(): boolean {
    if (!this.warship.hasHealth()) {
      return true;
    }
    return this.warship.health() >= this.warship.maxHealth();
  }

  private shouldStartRepairRetreat(
    healthBeforeHealing = this.warship.health(),
  ): boolean {
    if (this.warship.warshipState().state !== "patrolling") {
      return false;
    }
    // A doomed side cannot repair (see healWarship), so there is nothing to
    // retreat for; stay on patrol instead of idling at a port.
    if (this.warship.owner().inDoomsdayClock()) {
      return false;
    }
    const manualMoveRetreatDisabledDuration = 50;
    if (
      this.mg.ticks() - this.lastManualMoveTickRetreatDisabled <
      manualMoveRetreatDisabledDuration
    ) {
      return false;
    }
    // Percentage of (veterancy-adjusted) max health, so a tougher veteran ship
    // retreats at the same relative health as a fresh one. Integer math.
    const retreatThreshold = Math.floor(
      (this.warship.maxHealth() *
        this.mg.config().warshipRetreatHealthPercent()) /
        100,
    );
    if (healthBeforeHealing >= retreatThreshold) {
      return false;
    }
    const ports = this.warship.owner().units(UnitType.Port);
    return ports.length > 0 || this.findNearestSupport() !== undefined;
  }

  private findNearestPort(): TileRef | undefined {
    const ports = this.warship.owner().units(UnitType.Port);
    if (ports.length === 0) {
      return undefined;
    }

    const warshipTile = this.warship.tile();
    const warshipComponent = this.mg.getWaterComponent(warshipTile);
    if (warshipComponent === null) {
      return undefined;
    }

    const nearest = findMinimumBy(
      ports,
      (port) => this.mg.euclideanDistSquared(warshipTile, port.tile()),
      (port) => {
        const portComponent = this.mg.getWaterComponent(port.tile());
        return portComponent !== null && portComponent === warshipComponent;
      },
    );

    return nearest?.tile();
  }

  private findRetreatAggroTarget(): Unit | undefined {
    return this.findBestTarget([UnitType.TransportShip, UnitType.Warship]);
  }

  private findTargetUnit(): Unit | undefined {
    return this.findBestTarget(
      [UnitType.TransportShip, UnitType.Warship, UnitType.TradeShip],
      true,
    );
  }

  /**
   * Shared target selection: searches nearby units of given types,
   * filters common exclusions (self, friendly, docked, already-shelled),
   * picks best by type priority (lower index = higher priority) then distance.
   *
   * When `includeTradeShips` is true, applies trade-ship-specific filters
   * (safe from pirates, patrol range, water component, allied destination).
   */
  private findBestTarget(
    types: UnitType[],
    includeTradeShips = false,
  ): Unit | undefined {
    const mg = this.mg;
    const config = mg.config();
    const owner = this.warship.owner();

    const ships = mg.nearbyUnits(
      this.warship.tile(),
      config.warshipTargettingRange(),
      types,
    );

    // Trade-ship-specific state, lazily computed.
    let hasReachablePort: boolean | undefined;
    let patrolTile: number | undefined;
    let patrolRangeSquared: number | undefined;
    let warshipComponent: number | null | undefined = undefined;

    let bestUnit: Unit | undefined = undefined;
    let bestTypePriority = 0;
    let bestDistSquared = 0;

    for (const { unit, distSquared } of ships) {
      if (
        unit === this.warship ||
        unit.owner() === owner ||
        !owner.canAttackPlayer(unit.owner(), true) ||
        this.alreadySentShell.has(unit) ||
        (unit.type() === UnitType.Warship &&
          unit.warshipState().state === "docked")
      ) {
        continue;
      }

      const type = unit.type();

      if (includeTradeShips && type === UnitType.TradeShip) {
        if (warshipComponent === undefined) {
          warshipComponent = mg.getWaterComponent(this.warship.tile());
          hasReachablePort =
            warshipComponent !== null &&
            owner
              .units(UnitType.Port)
              .some(
                (port) =>
                  port.isActive() &&
                  !port.isMarkedForDeletion() &&
                  !port.isUnderConstruction() &&
                  mg.hasWaterComponent(port.tile(), warshipComponent!),
              );
          patrolTile = this.warship.warshipState().patrolTile;
          patrolRangeSquared = config.warshipPatrolRange() ** 2;
        }
        if (
          !hasReachablePort ||
          patrolTile === undefined ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === owner ||
          unit.targetUnit()?.owner().isFriendly(owner)
        ) {
          continue;
        }
        if (
          mg.euclideanDistSquared(patrolTile, unit.tile()) > patrolRangeSquared!
        ) {
          continue;
        }
      }

      const typePriority =
        type === UnitType.TransportShip ? 0 : type === UnitType.Warship ? 1 : 2;

      if (
        bestUnit === undefined ||
        typePriority < bestTypePriority ||
        (typePriority === bestTypePriority && distSquared < bestDistSquared)
      ) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
      }
    }

    return bestUnit;
  }

  private startRepairRetreat(): void {
    const portTile = this.findNearestPort();
    const support = this.findNearestSupport();
    const supportDist = support ? this.mg.euclideanDistSquared(this.warship.tile(), support.tile()) : Infinity;
    const portDist = portTile === undefined ? Infinity : this.mg.euclideanDistSquared(this.warship.tile(), portTile);
    if (portTile === undefined && support === undefined) return;
    const useSupport = support !== undefined && supportDist <= portDist;
    this.warship.updateWarshipState({
      retreatPort: useSupport ? undefined : portTile,
      retreatSupportID: useSupport ? support!.id() : undefined,
      state: "retreating",
    });
    this.activeHealingRemainder = 0;
    this.warship.setTargetUnit(undefined);
  }

  private cancelRepairRetreat(clearTargetTile = true): void {
    this.activeHealingRemainder = 0;
    this.warship.updateWarshipState({
      state: "patrolling",
      retreatPort: undefined,
      retreatSupportID: undefined,
    });
    if (clearTargetTile) {
      this.warship.setTargetTile(undefined);
    }
  }

  private handleManualPatrolOverride(): void {
    const patrolTile = this.warship.warshipState().patrolTile;
    if (
      this.lastObservedPatrolTile !== undefined &&
      patrolTile !== this.lastObservedPatrolTile
    ) {
      this.lastManualMoveTickRetreatDisabled = this.mg.ticks();
      if (this.warship.warshipState().state !== "patrolling") {
        this.cancelRepairRetreat(false);
      }
    }
    this.lastObservedPatrolTile = patrolTile;
  }

  private handleRepairRetreat(): boolean {
    if (this.warship.warshipState().state === "patrolling") {
      return false;
    }

    const retreatAggroTarget =
      this.warship.warshipState().supportShip &&
      this.mg.config().isFunctionalGeopolitics()
        ? undefined : this.findRetreatAggroTarget();
    if (retreatAggroTarget) {
      this.warship.setTargetUnit(retreatAggroTarget);
      this.shootTarget();
      // Fall through — continue retreating toward port even while firing back.
    }

    if (this.warship.warshipState().retreatSupportID !== undefined) {
      const support = this.currentRetreatSupport();
      if (support) {
        if (!retreatAggroTarget) this.warship.setTargetUnit(undefined);
        const destination = support.tile();
        if (this.mg.euclideanDistSquared(this.warship.tile(), destination) <=
            SUPPORT_DOCK_RADIUS * SUPPORT_DOCK_RADIUS) {
          this.warship.setTargetTile(undefined);
          this.warship.updateWarshipState({ state: "docked" });
          return true;
        }
        this.warship.updateWarshipState({ state: "retreating" });
        this.warship.setTargetTile(destination);
        const step = this.pathfinder.next(this.warship.tile(), destination);
        if (step.status === PathStatus.NEXT || step.status === PathStatus.COMPLETE) {
          this.warship.move(step.node);
        } else {
          this.warship.updateWarshipState({ retreatSupportID: undefined, retreatPort: this.findNearestPort() });
        }
        return true;
      }
      this.warship.updateWarshipState({ retreatSupportID: undefined, retreatPort: this.findNearestPort(), state: "retreating" });
    }
    if (!this.refreshRetreatPortTile()) {
      this.cancelRepairRetreat();
      return false;
    }

    // Only clear the target when there's no active aggro target this tick.
    if (!retreatAggroTarget) {
      this.warship.setTargetUnit(undefined);
    }

    const retreatPortTile = this.warship.warshipState().retreatPort;
    if (retreatPortTile === undefined) {
      return false;
    }

    const dockingRadius = this.mg.config().warshipDockingRange();
    const dockingRadiusSq = dockingRadius * dockingRadius;
    const distToPort = this.mg.euclideanDistSquared(
      this.warship.tile(),
      retreatPortTile,
    );

    if (distToPort <= dockingRadiusSq) {
      // Check if the port has capacity available (excluding this warship from capacity check)
      const port = this.warship
        .owner()
        .units(UnitType.Port)
        .find((p) => p.tile() === retreatPortTile);
      if (port && !this.isPortFullOfHealing(port, this.warship)) {
        // Port has capacity - dock here
        this.warship.setTargetTile(undefined);
        this.warship.updateWarshipState({
          state: "docked",
        });
        return true;
      } else {
        // Port is full - wait near port, but leave if already fully healed
        if (this.isFullyHealed()) {
          this.cancelRepairRetreat();
          return false;
        }
        return true;
      }
    }

    this.warship.setTargetTile(retreatPortTile);
    const result = this.pathfinder.next(this.warship.tile(), retreatPortTile);
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.move(result.node);
        if (result.node === retreatPortTile) {
          this.warship.setTargetTile(undefined);
        }
        break;
      case PathStatus.NEXT:
        this.warship.move(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        const newPort = this.findNearestAvailablePortTile();
        this.warship.updateWarshipState({
          retreatPort: newPort,
        });
        if (newPort === undefined) {
          this.cancelRepairRetreat();
        }
        break;
      }
    }

    return true;
  }

  private refreshRetreatPortTile(): boolean {
    const ports = this.warship.owner().units(UnitType.Port);
    if (ports.length === 0) {
      return false;
    }

    const currentRetreatPort = this.warship.warshipState().retreatPort;

    // Check if current retreat port still exists
    const currentPortExists =
      currentRetreatPort !== undefined &&
      ports.some((port) => port.tile() === currentRetreatPort);

    if (!currentPortExists) {
      const newPort = this.findNearestAvailablePortTile();
      this.warship.updateWarshipState({
        retreatPort: newPort,
      });
      return newPort !== undefined;
    }

    // Check if current port is now full of healing (not counting arrived warships)
    const currentPort = ports.find((p) => p.tile() === currentRetreatPort);
    if (currentPort && this.isPortFullOfHealing(currentPort)) {
      // Current port is at healing capacity, look for alternatives
      const alternativePort = this.findNearestAvailablePort();
      if (alternativePort) {
        this.warship.updateWarshipState({
          retreatPort: alternativePort,
        });
      }
      return this.warship.warshipState().retreatPort !== undefined;
    }

    // Check if a significantly closer port is available
    const closerPort = this.findBetterPortTile();
    if (closerPort && closerPort !== currentRetreatPort) {
      this.warship.updateWarshipState({
        retreatPort: closerPort,
      });
      return true;
    }

    return true;
  }

  private isPortFullOfHealing(port: Unit, excludeShip?: Unit): boolean {
    const maxShipsHealing = port.level();
    return this.dockedShipsAtPort(port, excludeShip).length >= maxShipsHealing;
  }

  private dockedShipsAtPort(port: Unit, excludeShip?: Unit): Unit[] {
    const dockingRadius = this.mg.config().warshipDockingRange();
    const owner = this.warship.owner();

    return this.mg
      .nearbyUnits(port.tile(), dockingRadius, [UnitType.Warship])
      .filter(({ unit: ship }) => {
        if (excludeShip && ship === excludeShip) return false;
        if (ship.owner() !== owner) return false;
        if (ship.warshipState().state === "patrolling") return false;
        if (ship.targetTile() !== undefined) return false;
        return true;
      })
      .map(({ unit }) => unit);
  }

  private applyActiveDockedHealing(): void {
    const dockedPort = this.currentRetreatPort();
    if (!dockedPort) {
      return;
    }

    const dockedShips = this.dockedShipsAtPort(dockedPort);
    if (!dockedShips.some((ship) => ship === this.warship)) {
      return;
    }

    const healingPool =
      dockedPort.level() * this.mg.config().warshipPortHealingBonusPerLevel();
    if (healingPool <= 0 || dockedShips.length === 0) {
      return;
    }

    // Preserve fractional split healing over time with a per-ship remainder.
    const activeHealing = healingPool / dockedShips.length;
    this.activeHealingRemainder += activeHealing;
    const integerHealing = Math.floor(this.activeHealingRemainder);
    if (integerHealing <= 0) {
      return;
    }

    this.activeHealingRemainder -= integerHealing;
    this.warship.modifyHealth(integerHealing);
  }

  private currentRetreatPort(): Unit | undefined {
    const retreatPort = this.warship.warshipState().retreatPort;
    if (retreatPort === undefined) {
      return undefined;
    }

    return this.warship
      .owner()
      .units(UnitType.Port)
      .find((port) => port.tile() === retreatPort);
  }

  private nearestAvailablePortTile(
    excludeShip?: Unit,
  ): { tile: TileRef; distSquared: number } | undefined {
    const ports = this.warship.owner().units(UnitType.Port);
    const warshipTile = this.warship.tile();
    const warshipComponent = this.mg.getWaterComponent(warshipTile);
    if (warshipComponent === null) {
      return undefined;
    }

    let bestTile: TileRef | undefined = undefined;
    let bestDistance = Infinity;

    for (const port of ports) {
      if (this.isPortFullOfHealing(port, excludeShip)) {
        continue;
      }

      const portTile = port.tile();
      if (!this.mg.hasWaterComponent(portTile, warshipComponent)) {
        continue;
      }

      const distance = this.mg.euclideanDistSquared(warshipTile, portTile);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTile = portTile;
      }
    }

    return bestTile !== undefined
      ? { tile: bestTile, distSquared: bestDistance }
      : undefined;
  }

  private findNearestAvailablePort(): TileRef | undefined {
    return this.nearestAvailablePortTile()?.tile;
  }

  private findBetterPortTile(): TileRef | undefined {
    const result = this.nearestAvailablePortTile();
    if (!result) return undefined;

    let currentDistance = Infinity;
    const currentRetreatPort = this.warship.warshipState().retreatPort;
    if (currentRetreatPort !== undefined) {
      currentDistance = this.mg.euclideanDistSquared(
        this.warship.tile(),
        currentRetreatPort,
      );
    }

    if (
      result.distSquared <
      currentDistance * this.mg.config().warshipPortSwitchThreshold()
    ) {
      return result.tile;
    }
    return undefined;
  }

  private findNearestAvailablePortTile(): TileRef | undefined {
    return this.nearestAvailablePortTile(this.warship)?.tile;
  }

  private shootTarget() {
    this.warship.updateWarshipState({ isInCombat: true });
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      if (this.warship.targetUnit()?.type() !== UnitType.TransportShip) {
        // Warships don't need to reload when attacking transport ships.
        this.lastShellAttack = this.mg.ticks();
      }
      this.mg.addExecution(
        new ShellExecution(
          this.warship.tile(),
          this.warship.owner(),
          this.warship,
          this.warship.targetUnit()!,
        ),
      );
      if (!this.warship.targetUnit()!.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.warship.targetUnit()!);
        this.warship.setTargetUnit(undefined);
        return;
      }
    }
  }

  private huntDownTradeShip() {
    this.warship.updateWarshipState({ isInCombat: true });
    for (let i = 0; i < 2; i++) {
      const target = this.warship.targetUnit()!;
      const targetTile = target.tile();
      const dist = this.mg.manhattanDist(this.warship.tile(), targetTile);

      if (dist <= 5) {
        this.warship.owner().captureUnit(target);
        this.warship.recordTradeCapture();
        this.warship.setTargetUnit(undefined);
        this.warship.touch();
        return;
      }

      // When close, the minimap (2x scale) produces diagonal upscaled paths that
      // make it hard to converge. Use direct greedy movement instead.
      if (dist <= 20) {
        const nextTile = this.bestNeighborToward(targetTile);
        if (nextTile !== undefined) {
          this.warship.move(nextTile);
          continue;
        }
      }

      const result = this.pathfinder.next(this.warship.tile(), targetTile, 5);
      switch (result.status) {
        case PathStatus.COMPLETE:
          this.warship.owner().captureUnit(target);
          this.warship.recordTradeCapture();
          this.warship.setTargetUnit(undefined);
          this.warship.touch();
          return;
        case PathStatus.NEXT:
          this.warship.move(result.node);
          break;
        case PathStatus.NOT_FOUND:
          console.log(`path not found to target`);
          break;
      }
    }
  }

  private bestNeighborToward(targetTile: TileRef): TileRef | undefined {
    const warshipTile = this.warship.tile();
    let best: TileRef | undefined;
    let bestDist = this.mg.manhattanDist(warshipTile, targetTile);
    this.mg.forEachNeighbor(warshipTile, (neighbor) => {
      if (!this.mg.isWater(neighbor)) return;
      const d = this.mg.manhattanDist(neighbor, targetTile);
      if (d < bestDist) {
        bestDist = d;
        best = neighbor;
      }
    });
    return best;
  }

  private patrol() {
    if (this.warship.targetTile() === undefined) {
      this.warship.setTargetTile(this.randomTile());
      if (this.warship.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.next(
      this.warship.tile(),
      this.warship.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.setTargetTile(undefined);
        this.warship.move(result.node);
        break;
      case PathStatus.NEXT:
        this.warship.move(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        console.log(`path not found to target`);
        this.warship.setTargetTile(undefined);
        break;
      }
    }
  }

  isActive(): boolean {
    return this.warship?.isActive();
  }

  isDocked(): boolean {
    return (this.warship?.warshipState().state ?? "patrolling") === "docked";
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let warshipPatrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand: number = 500;
    let attempts: number = 0;
    let expandCount: number = 0;

    // Get warship's water component for connectivity check
    const warshipComponent = this.mg.getWaterComponent(this.warship.tile());

    const patrolTile = this.warship.warshipState().patrolTile;
    // A non-integer or out-of-range patrolTile makes mg.x()/mg.y() return
    // undefined, so every candidate coordinate below is NaN, isValidCoord is
    // always false, and the loop's out-of-bounds `continue` (which does not
    // advance expandCount) spins forever, hanging the whole synchronous sim.
    // Bail out instead of trusting patrolTile is a valid tile.
    if (patrolTile === undefined || !this.mg.isValidRef(patrolTile)) {
      return undefined;
    }

    while (expandCount < 3) {
      const x =
        this.mg.x(patrolTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(patrolTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        !this.mg.isWater(tile) ||
        (!allowShoreline && this.mg.isShoreline(tile))
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      // Check water component connectivity
      if (
        warshipComponent !== null &&
        !this.mg.hasWaterComponent(tile, warshipComponent)
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for warship for ${this.warship.owner().name()}`,
    );
    if (!allowShoreline) {
      // If we failed to find a tile on the ocean, try again but allow shoreline
      return this.randomTile(true);
    }
    return undefined;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return WarshipExecutionSnapshot.write({
      input: isUnit(this.input)
        ? { unit: w.unit(this.input) }
        : {
            owner: w.player(this.input.owner),
            patrolTile: this.input.patrolTile,
            supportShip: this.input.supportShip,
          },
      initialized: this.mg !== undefined,
      random: this.random === undefined ? null : w.random(this.random),
      warship: this.warship === undefined ? null : w.unit(this.warship),
      pathfinder:
        this.pathfinder === undefined
          ? null
          : waterPathFinderState(this.pathfinder),
      lastShellAttack: this.lastShellAttack,
      alreadySentShell: [...this.alreadySentShell].map((u) => w.unit(u)),
      lastManualMoveTickRetreatDisabled: this.lastManualMoveTickRetreatDisabled,
      lastObservedPatrolTile: this.lastObservedPatrolTile,
      activeHealingRemainder: this.activeHealingRemainder,
      lastEmittedCombat: this.lastEmittedCombat,
      // Do not change normal/classic warship snapshot payloads.
      assignedRepairShipIDs: this.warship?.warshipState().supportShip
        ? [...this.assignedRepairShipIDs]
        : undefined,
    });
  }

  restoreSnapshot(s: WarshipExecutionState, r: SnapshotReader): void {
    this.input =
      "unit" in s.input
        ? r.unit(s.input.unit)
        : { owner: r.player(s.input.owner), patrolTile: s.input.patrolTile, supportShip: s.input.supportShip };
    if (s.initialized) this.mg = r.game;
    if (s.random !== null) this.random = r.random(s.random);
    if (s.warship !== null) this.warship = r.unit(s.warship);
    if (s.pathfinder !== null) {
      this.pathfinder = restoreWaterPathFinder(r.game, s.pathfinder);
    }
    this.lastShellAttack = s.lastShellAttack;
    this.alreadySentShell = new Set(s.alreadySentShell.map((i) => r.unit(i)));
    this.lastManualMoveTickRetreatDisabled =
      s.lastManualMoveTickRetreatDisabled;
    this.lastObservedPatrolTile = s.lastObservedPatrolTile;
    this.activeHealingRemainder = s.activeHealingRemainder;
    this.lastEmittedCombat = s.lastEmittedCombat;
    this.assignedRepairShipIDs = s.assignedRepairShipIDs ?? [];
  }
}

const WarshipExecutionStateSchema = z.object({
  /** An existing warship, or the params to build one in init(). */
  input: z.union([
    z.object({ unit: zRef() }),
    z.object({ owner: zPlayerRef(), patrolTile: zTile(), supportShip: z.boolean().optional() }),
  ]),
  initialized: z.boolean(),
  random: zRandom().nullable(),
  /** Null before init() or when the spawn failed. */
  warship: zRef().nullable(),
  pathfinder: WaterPathFinderSchema.nullable(),
  lastShellAttack: zInt(),
  /** In insertion order. */
  alreadySentShell: z.array(zRef()),
  lastManualMoveTickRetreatDisabled: zInt(),
  lastObservedPatrolTile: zTile().optional(),
  activeHealingRemainder: zNum(),
  lastEmittedCombat: z.boolean(),
  assignedRepairShipIDs: z.array(zInt()).optional(),
});
type WarshipExecutionState = z.infer<typeof WarshipExecutionStateSchema>;

export const WarshipExecutionSnapshot = execSnapshotType({
  name: "Warship",
  version: 1,
  schema: WarshipExecutionStateSchema,
  cls: () => WarshipExecution,
});
