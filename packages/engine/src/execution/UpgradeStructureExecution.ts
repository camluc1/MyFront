import {
  zNum,
  zPlayerRef,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { type ShipyardTrack, shipyardUpgradePrice } from "@openfront/engine-api/game/Shipyard";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export class UpgradeStructureExecution implements Execution {
  private structure: Unit | undefined;
  private cost: bigint;

  constructor(
    private player: Player,
    private unitId: number,
    private amount: number = 1,
    private shipyardTrack?: ShipyardTrack,
  ) {}

  init(mg: Game, ticks: number): void {
    this.structure = mg.unit(this.unitId);
    if (this.structure && this.structure.owner() !== this.player) {
      console.warn(`structure not owned by player`);
      this.structure = undefined;
    }

    if (this.structure === undefined) {
      console.warn(`structure is undefined`);
      return;
    }

    if (this.shipyardTrack !== undefined) {
      if (!mg.config().isFunctionalGeopolitics() ||
          this.structure.type() !== UnitType.Shipyard ||
          this.player.type() !== PlayerType.Human ||
          this.structure.isUnderConstruction() || !this.structure.isActive()) return;
      for (let i = 0; i < this.amount; i++) {
        const current = this.structure.shipyardLevels()?.[this.shipyardTrack];
        if (current === undefined) break;
        const cost = shipyardUpgradePrice(current);
        if (cost === null || this.player.gold() < cost) break;
        const ships = this.shipyardTrack === "warshipHealth"
          ? this.player.units(UnitType.Warship, UnitType.Bismarck).filter((s) =>
            s.isActive() && !s.warshipState().supportShip).map((s) =>
              ({ ship: s, previousMax: s.maxHealth() })) : [];
        if (!this.structure.upgradeShipyard(this.shipyardTrack)) break;
        this.player.removeGold(cost);
        for (const { ship, previousMax } of ships)
          ship.modifyHealth(Math.max(0, ship.maxHealth() - previousMax));
      }
      return;
    }
    for (let i = 0; i < this.amount; i++) {
      if (!this.player.canUpgradeUnit(this.structure)) {
        if (i === 0) {
          console.warn(
            `[UpgradeStructureExecution] unit type ${this.structure.type()} cannot be upgraded`,
          );
        }
        break;
      }
      this.player.upgradeUnit(this.structure);
    }
    return;
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return UpgradeStructureExecutionSnapshot.write({
      structure: this.structure === undefined ? null : w.unit(this.structure),
      player: w.player(this.player),
      unitId: this.unitId,
      amount: this.amount,
      shipyardTrack: this.shipyardTrack,
    });
  }

  restoreSnapshot(s: UpgradeStructureState, r: SnapshotReader): void {
    if (s.structure !== null) this.structure = r.unit(s.structure);
    this.player = r.player(s.player);
    this.unitId = s.unitId;
    this.amount = s.amount;
    this.shipyardTrack = s.shipyardTrack;
  }
}

// cost is declared but never assigned, so there is nothing to store for it.
const UpgradeStructureStateSchema = z.object({
  structure: zRef().nullable(),
  player: zPlayerRef(),
  unitId: zNum(),
  amount: zNum(),
  shipyardTrack: z.enum(["merchantSpeed", "transportCapacity",
    "warshipHealth", "warshipDamage"]).optional(),
});
type UpgradeStructureState = z.infer<typeof UpgradeStructureStateSchema>;

export const UpgradeStructureExecutionSnapshot = execSnapshotType({
  name: "UpgradeStructure",
  version: 1,
  schema: UpgradeStructureStateSchema,
  cls: () => UpgradeStructureExecution,
});
