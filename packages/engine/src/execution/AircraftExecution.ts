import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Aircraft, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  AIRCRAFT_BOMBER_BOMBS,
  AIRCRAFT_BOMBER_TROOPS_PER_BOMB,
  AIRCRAFT_CARRIER_CAPACITY,
  AIRCRAFT_CRUISE_TILES_PER_TICK,
  AIRCRAFT_FUEL_RESERVE,
  AIRCRAFT_GROUND_STRIKE_TROOPS,
  AIRCRAFT_MAX_FUEL,
} from "@openfront/engine-api/game/Aircraft";
import { zInt, zPlayerRef, zRef, zTile } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, isUnit, Player, Unit } from "../game/Game";
import { UnitTypeSchema } from "../snapshot/CommonSchemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader, SnapshotWriter } from "../snapshot/SnapshotContext";

type AircraftType = typeof Aircraft.types[number];
type Launch = { owner: Player; type: AircraftType; tile: TileRef };

/**
 * Deterministic single-player aircraft. The world itself provides direct air
 * navigation; no water-pathfinder or external random source is involved.
 * Flight state lives on the unit and survives snapshot/restore.
 */
export class AircraftExecution implements Execution {
  private mg!: Game;
  private aircraft: Unit | null = null;
  private active = true;
  constructor(private input: Launch | Unit) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    if (!mg.config().isFunctionalGeopolitics()) {
      this.active = false;
      return;
    }
    if (isUnit(this.input)) {
      this.aircraft = this.input;
    } else {
      this.deploy();
    }
  }

  private deploy(): void {
    if (isUnit(this.input)) return;
    const owner = this.input.owner;
    const tile = owner.canBuild(this.input.type, this.input.tile);
    if (tile === false) {
      this.active = false;
      return;
    }
    this.aircraft = owner.buildUnit(this.input.type, tile, { homeTile: tile });
  }

  activeDuringSpawnPhase(): boolean { return false; }
  isActive(): boolean { return this.active; }

  private airportOrCarrier(aircraft: Unit): {tile: TileRef; carrierId?: number} | undefined {
    const owner = aircraft.owner();
    const candidates: Array<{tile: TileRef; carrierId?: number; id: number}> = [];
    for (const field of owner.units(UnitType.Airfield)) {
      if (field.isActive() && !field.isUnderConstruction())
        candidates.push({tile: field.tile(), id: field.id()});
    }
    // Four *reserved* slots, not merely four planes that have landed.
    const inService = owner.units(Aircraft.types);
    for (const carrier of owner.units(UnitType.Warship)) {
      if (!carrier.isActive() || !carrier.warshipState().supportShip) continue;
      const booked = inService.filter((unit) => unit.id() !== aircraft.id() &&
        unit.aircraftState()?.carrierId === carrier.id() &&
        unit.aircraftState()?.phase !== "outbound").length;
      if (booked < AIRCRAFT_CARRIER_CAPACITY) {
        candidates.push({ tile: carrier.tile(), carrierId: carrier.id(), id: carrier.id() });
      }
    }
    candidates.sort((a, b) =>
      this.mg.manhattanDist(aircraft.tile(), a.tile) -
      this.mg.manhattanDist(aircraft.tile(), b.tile) ||
      a.id - b.id);
    return candidates[0];
  }

  private flyToward(plane: Unit, target: TileRef): boolean {
    if (!this.mg.isValidRef(target)) return false;
    const state = plane.aircraftState();
    if (!state) return false;
    let x = this.mg.x(plane.tile()), y = this.mg.y(plane.tile());
    const tx = this.mg.x(target), ty = this.mg.y(target);
    let moved = 0;
    for (let i = 0; i < AIRCRAFT_CRUISE_TILES_PER_TICK; i++) {
      if (x === tx && y === ty) break;
      const dx = tx - x, dy = ty - y;
      if (Math.abs(dx) >= Math.abs(dy)) x += dx > 0 ? 1 : -1;
      else y += dy > 0 ? 1 : -1;
      moved++;
    }
    if (moved > 0) {
      plane.move(this.mg.ref(x, y));
      plane.updateAircraftState({ fuel: Math.max(0, state.fuel - moved) });
    }
    return x === tx && y === ty;
  }

  private enemyPlane(plane: Unit): Unit | undefined {
    const nearby = this.mg.nearbyUnits(plane.tile(), 8, Aircraft.types,
      ({ unit }) => isUnit(unit) && unit.isActive() &&
        !plane.owner().isFriendly(unit.owner()) &&
        unit.owner() !== plane.owner());
    nearby.sort((a, b) => a.distSquared - b.distSquared || a.unit.id() - b.unit.id());
    return nearby[0]?.unit;
  }

  /** Reuse the existing shell-impact FX event rather than introducing a
   * custom rendering pass or non-deterministic client-only fake explosions.
   * The zero-cost shell is born, marked as landed and retired in this tick;
   * its authoritative death update triggers one mini-explosion on clients. */
  private emitImpactFx(plane: Unit, tile: TileRef): void {
    const impact = plane.owner().buildUnit(UnitType.Shell, tile, {});
    impact.setReachedTarget();
    impact.delete(false);
  }

  private strike(plane: Unit, target: TileRef): void {
    if (plane.type() === UnitType.FighterAircraft) {
      const hostile = this.enemyPlane(plane);
      if (hostile) hostile.modifyHealth(-400, plane.owner());
      return;
    }
    if (plane.type() === UnitType.AttackAircraft) {
      const owner = this.mg.owner(target);
      if (owner.isPlayer() && owner !== plane.owner() &&
          !plane.owner().isFriendly(owner)) {
        owner.removeTroops(AIRCRAFT_GROUND_STRIKE_TROOPS);
        this.emitImpactFx(plane, target);
      }
      return;
    }
    if (plane.type() === UnitType.BomberAircraft) {
      const x = this.mg.x(target), y = this.mg.y(target);
      // Spread the run along the approach instead of always west/east.
      const lastX = this.mg.x(plane.lastTile());
      const lastY = this.mg.y(plane.lastTile());
      const vertical = Math.abs(y-lastY) > Math.abs(x-lastX);
      for (let i = 0; i < AIRCRAFT_BOMBER_BOMBS; i++) {
        const offset = i - Math.floor(AIRCRAFT_BOMBER_BOMBS / 2);
        const px = x + (vertical ? 0 : offset), py = y + (vertical ? offset : 0);
        if (!this.mg.isValidCoord(px, py)) continue;
        const owner = this.mg.owner(this.mg.ref(px, py));
        if (owner.isPlayer() && owner !== plane.owner() &&
            !plane.owner().isFriendly(owner)) {
          owner.removeTroops(AIRCRAFT_BOMBER_TROOPS_PER_BOMB);
          this.emitImpactFx(plane, this.mg.ref(px, py));
        }
      }
    }
  }

  private beginReturn(plane: Unit): void {
    const base = this.airportOrCarrier(plane);
    if (base) {
      plane.updateAircraftState({
        phase: "returning", carrierId: base.carrierId, homeTile: base.tile,
      });
    } else {
      // No surviving landing base: continue homeward and eventually run out of fuel.
      plane.updateAircraftState({ phase: "returning", carrierId: undefined });
    }
  }

  tick(_ticks: number): void {
    if (!this.aircraft || !this.aircraft.isActive() ||
        !this.mg.config().isFunctionalGeopolitics()) {
      this.active = false;
      return;
    }
    const plane = this.aircraft;
    const state = plane.aircraftState();
    if (!state) { this.active = false; return; }
    if (state.fuel <= 0) {
      plane.delete();
      this.active = false;
      return;
    }

    if (state.phase === "docked") {
      if (state.carrierId === undefined) {
        const runway = plane.owner().units(UnitType.Airfield).some((field) =>
          field.isActive() && !field.isUnderConstruction() &&
          field.tile() === plane.tile());
        if (!runway) {
          this.beginReturn(plane);
          return;
        }
      }
      if (state.carrierId !== undefined) {
        const carrier = plane.owner().units(UnitType.Warship)
          .find((u) => u.id() === state.carrierId &&
            u.isActive() && u.warshipState().supportShip);
        if (carrier) {
          if (carrier.tile() !== plane.tile()) plane.move(carrier.tile());
        } else {
          this.beginReturn(plane);
          return;
        }
      }
      if (state.fuel < AIRCRAFT_MAX_FUEL) {
        plane.updateAircraftState({ fuel: Math.min(AIRCRAFT_MAX_FUEL, state.fuel + 90) });
      }
      return;
    }

    if (state.phase === "outbound") {
      const destination = state.targetTile;
      if (destination === undefined) {
        this.beginReturn(plane);
        return;
      }
      const base = this.airportOrCarrier(plane);
      if (base && state.fuel <= this.mg.manhattanDist(plane.tile(), base.tile) +
          AIRCRAFT_FUEL_RESERVE) {
        this.beginReturn(plane);
        return;
      }
      const arrived = this.flyToward(plane, destination);
      if (plane.type() === UnitType.FighterAircraft && this.enemyPlane(plane)) {
        this.strike(plane, destination);
        this.beginReturn(plane);
      } else if (arrived) {
        this.strike(plane, destination);
        this.beginReturn(plane);
      }
      return;
    }

    if (state.phase === "returning") {
      const base = this.airportOrCarrier(plane);
      if (base) {
        if (state.carrierId !== base.carrierId || state.homeTile !== base.tile) {
          plane.updateAircraftState({ carrierId: base.carrierId, homeTile: base.tile });
        }
        if (this.flyToward(plane, base.tile)) {
          plane.updateAircraftState({
            phase: "docked", targetTile: undefined,
            carrierId: base.carrierId, homeTile: base.tile,
          });
        }
      } else {
        const reached = this.flyToward(plane, state.homeTile);
        if (reached) {
          // A destroyed runway must not become an infinite-fuel safe haven.
          // A stranded plane loses remaining fuel while circling its last fix.
          plane.updateAircraftState({
            fuel: Math.max(0, (plane.aircraftState()?.fuel ?? 0) -
              AIRCRAFT_CRUISE_TILES_PER_TICK),
          });
        }
      }
    }
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AircraftExecutionSnapshot.write({
      active: this.active,
      aircraft: w.unitOrNull(this.aircraft),
      input: isUnit(this.input)
        ? {unit: w.unit(this.input)}
        : {owner: w.player(this.input.owner), type: this.input.type, tile: this.input.tile},
    });
  }

  restoreSnapshot(s: AircraftExecState, r: SnapshotReader): void {
    this.mg = r.game;
    this.active = s.active;
    this.aircraft = r.unitOrNull(s.aircraft);
    this.input = "unit" in s.input ? r.unit(s.input.unit) :
      {owner: r.player(s.input.owner), type: s.input.type as AircraftType, tile: s.input.tile};
  }
}

const AircraftExecSchema = z.object({
  active: z.boolean(),
  aircraft: zRef().nullable(),
  input: z.union([
    z.object({unit: zRef()}),
    z.object({owner: zPlayerRef(), type: UnitTypeSchema, tile: zTile()}),
  ]),
});
type AircraftExecState = z.infer<typeof AircraftExecSchema>;
export const AircraftExecutionSnapshot = execSnapshotType({
  name: "Aircraft", version: 1, schema: AircraftExecSchema, cls: () => AircraftExecution,
});
