import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { resourceAt, type NaturalResource } from "@openfront/engine-lib/game/NaturalResources";
import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader, SnapshotWriter } from "../snapshot/SnapshotContext";
import { TrainStationExecution } from "./TrainStationExecution";

/** Gold per 100 ticks (10 seconds) at level 1 before resource quality.
 * The range is deliberately below or near a well-utilised Port, with
 * upgrades and working rail connections rewarding a long-term investment.
 */
export const RESOURCE_BASE_GOLD: Record<NaturalResource, number> = {
  fertile_soil: 11500,
  oil: 22000,
  gas: 17500,
  coal: 9000,
  gold: 19000,
  silver: 15000,
  copper: 12000,
  iron: 9000,
  lithium: 16500,
  uranium: 18500,
};

export class NaturalResourceExecution implements Execution {
  private game: Game;
  private active = true;
  private stationScheduled = false;

  constructor(private structure: Unit) {}

  init(mg: Game, _ticks: number): void {
    this.game = mg;
  }
  tick(ticks: number): void {
    if (!this.structure.isActive()) {
      this.active = false;
      return;
    }
    if (this.structure.isUnderConstruction()) return;
    const type = this.structure.type();
    // Mines become genuine, non-train-spawning rail stations when they have a
    // factory nearby. FactoryExecution handles the reverse build order.
    if (type === UnitType.Mine && !this.stationScheduled &&
        !this.structure.hasTrainStation()) {
      if (this.game.hasUnitNearby(this.structure.tile(),
          this.game.config().trainStationMaxRange(), UnitType.Factory)) {
        this.game.addExecution(new TrainStationExecution(this.structure));
        this.stationScheduled = true;
      }
    }
    // Stable staggering keeps hundreds of sites from paying out on one tick.
    if (ticks % 100 !== this.structure.id() % 100) return;
    const map = this.game.map();
    const site = resourceAt(map, this.game.config().gameConfig().gameMap, this.structure.tile());
    if (!site) return;
    if (type === UnitType.Farm && site.resource !== "fertile_soil") return;
    if (type === UnitType.OilWell && site.resource !== "oil") return;
    if (type === UnitType.GasPlant && site.resource !== "gas") return;
    if (type === UnitType.Mine &&
        (site.resource === "fertile_soil" || site.resource === "oil" || site.resource === "gas")) return;
    if (site.resource !== "fertile_soil" && !this.game.consumeResource(site.id, site.capacity)) return;

    // A connected (not merely nearby) factory boosts mine gold by 40%.
    // This is the existing graph of real railway stations and rails.
    let factoryMultiplier = 1;
    if (type === UnitType.Mine) {
      const station = this.game.railNetwork().stationManager().findStation(this.structure);
      const cluster = station?.getCluster();
      if (cluster) {
        for (const other of cluster.stations) {
          if (other.isActive() && other.unit.type() === UnitType.Factory &&
              other.unit.owner() === this.structure.owner()) {
            factoryMultiplier = 1.4;
            break;
          }
        }
      }
    }
    const level = Math.min(50, Math.max(1, this.structure.level()));
    const qualityMultiplier = 0.75 + site.quality * 0.25;
    const upgradeMultiplier = 1 + (level - 1) * 0.30;
    const gold = Math.floor(
      RESOURCE_BASE_GOLD[site.resource] * qualityMultiplier *
      upgradeMultiplier * factoryMultiplier * this.game.config().goldMultiplier()
    );
    if (gold > 0) {
      const payout = BigInt(gold);
      const owner = this.structure.owner();
      owner.addGold(payout);
      // Record resource earnings in the existing work-income statistics.
      this.game.stats().goldWork(owner, payout);
    }
  }
  isActive(): boolean { return this.active; }
  activeDuringSpawnPhase(): boolean { return false; }
  snapshot(w: SnapshotWriter): ExecRecord {
    return NaturalResourceExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== undefined,
      stationScheduled: this.stationScheduled,
      structure: w.unit(this.structure),
    });
  }
  restoreSnapshot(s: NaturalResourceState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.game = r.game;
    this.stationScheduled = s.stationScheduled;
    this.structure = r.unit(s.structure);
  }
}
const NaturalResourceStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  stationScheduled: z.boolean(),
  structure: zRef(),
});
type NaturalResourceState = z.infer<typeof NaturalResourceStateSchema>;
export const NaturalResourceExecutionSnapshot = execSnapshotType({
  name: "NaturalResource",
  version: 1,
  schema: NaturalResourceStateSchema,
  cls: () => NaturalResourceExecution,
});
