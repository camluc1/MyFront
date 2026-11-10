import { GameType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { CASTLE_DEFENSE_COST } from "@openfront/engine-api/game/CastleDefense";
import { zInt, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader, SnapshotWriter } from "../snapshot/SnapshotContext";

/** Shared authoritative check and debit for human and nation commands. */
export function tryActivateCastleDefense(game: Game, player: Player, unitId: number): boolean {
  if (game.inSpawnPhase() || !game.config().gameConfig().geopolitics ||
      game.config().gameConfig().gameType !== GameType.Singleplayer) return false;
  const castle = game.unit(unitId);
  if (!castle || castle.type() !== UnitType.Castle || !castle.isActive() ||
      castle.owner() !== player || castle.isUnderConstruction() ||
      castle.isMarkedForDeletion() ||
      castle.castleDefenseState().cooldownUntilTick > game.ticks() ||
      player.gold() < CASTLE_DEFENSE_COST) return false;
  player.removeGold(CASTLE_DEFENSE_COST);
  castle.activateCastleDefense(game.ticks());
  return true;
}

export class CastleDefenseExecution implements Execution {
  constructor(private player: Player, private unitId: number) {}
  init(game: Game): void { tryActivateCastleDefense(game, this.player, this.unitId); }
  tick(): void {}
  isActive(): boolean { return false; }
  activeDuringSpawnPhase(): boolean { return false; }
  snapshot(w: SnapshotWriter): ExecRecord {
    return CastleDefenseExecutionSnapshot.write({ player: w.player(this.player), unitId: this.unitId });
  }
  restoreSnapshot(s: { player: number; unitId: number }, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.unitId = s.unitId;
  }
}
export const CastleDefenseExecutionSnapshot = execSnapshotType({
  name: "CastleDefense", version: 1,
  schema: z.object({ player: zPlayerRef(), unitId: zInt() }),
  cls: () => CastleDefenseExecution,
});
