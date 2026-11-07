import {
  DiplomacyAction,
  DiplomacyActionSchema,
} from "@openfront/engine-api/Geopolitics";
import { z } from "zod";
import type { Execution, Game } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord } from "../snapshot/SnapshotContext";
export class DiplomacyExecution implements Execution {
  constructor(
    private actor: string,
    private action: DiplomacyAction,
  ) {}
  init(game: Game) {
    if (game.hasPlayer(this.actor))
      game.diplomacy.act(game.player(this.actor), this.action);
  }
  tick() {}
  isActive() {
    return false;
  }
  activeDuringSpawnPhase() {
    return false;
  }
  snapshot(): ExecRecord {
    return DiplomacyExecutionSnapshot.write({
      actor: this.actor,
      action: this.action,
    });
  }
  restoreSnapshot(s: { actor: string; action: DiplomacyAction }) {
    this.actor = s.actor;
    this.action = s.action;
  }
}
export const DiplomacyExecutionSnapshot = execSnapshotType({
  name: "Diplomacy",
  version: 1,
  schema: z.object({ actor: z.string(), action: DiplomacyActionSchema }),
  cls: () => DiplomacyExecution,
});
