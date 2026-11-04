import { resourceProduction } from "@openfront/engine-lib/game/ResourceProduction";
export { RESOURCE_BASE_GOLD } from "@openfront/engine-lib/game/ResourceProduction";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { resourceAt } from "@openfront/engine-lib/game/NaturalResources";
import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type { Execution, Game, Unit } from "../game/Game";
import { resourceRailMultiplier } from "../game/ResourceEconomy";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { TrainStationExecution } from "./TrainStationExecution";

/** Gold per 100 ticks (10 seconds) at level 1 before resource quality.
 * The range is deliberately below or near a well-utilised Port, with
 * upgrades and working rail connections rewarding a long-term investment.
 */
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
    if (
      type === UnitType.Mine &&
      !this.stationScheduled &&
      !this.structure.hasTrainStation()
    ) {
      if (
        this.game.hasUnitNearby(
          this.structure.tile(),
          this.game.config().trainStationMaxRange(),
          UnitType.Factory,
        )
      ) {
        this.game.addExecution(new TrainStationExecution(this.structure));
        this.stationScheduled = true;
      }
    }
    // Stable staggering keeps hundreds of sites from paying out on one tick.
    if (ticks % 100 !== this.structure.id() % 100) return;
    const map = this.game.map();
    const site = resourceAt(
      map,
      this.game.config().gameConfig().gameMap,
      this.structure.tile(),
    );
    if (!site) return;
    if (type === UnitType.Farm && site.resource !== "fertile_soil") return;
    if (type === UnitType.OilWell && site.resource !== "oil") return;
    if (type === UnitType.GasPlant && site.resource !== "gas") return;
    if (
      type === UnitType.Mine &&
      (site.resource === "fertile_soil" ||
        site.resource === "oil" ||
        site.resource === "gas")
    )
      return;
    if (
      site.resource !== "fertile_soil" &&
      !this.game.consumeResource(site.id, site.capacity)
    )
      return;

    // A connected (not merely nearby) factory boosts mine gold by 40%.
    // This is the existing graph of real railway stations and rails.
    const gold = resourceProduction(
      site.resource,
      site.quality,
      this.structure.level(),
      resourceRailMultiplier(this.game, this.structure),
      this.game.config().productionGoldMultiplier(this.structure.owner()),
    );
    if (gold > 0) {
      const payout = BigInt(gold);
      const owner = this.structure.owner();
      owner.addGold(payout);
      // Record resource earnings in the existing work-income statistics.
      this.game
        .stats()
        .goldResource(
          owner,
          [
            UnitType.Farm,
            UnitType.Mine,
            UnitType.OilWell,
            UnitType.GasPlant,
          ].indexOf(type),
          payout,
        );
    }
  }
  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
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
