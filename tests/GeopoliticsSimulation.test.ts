import { GameType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { emptyAssets } from "@openfront/engine-api/Geopolitics";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import {
  createScriptedRunner,
  restoreScriptedRunner,
  scriptedGameStart,
  stepScripted,
} from "./util/ScriptedGame";
import { diffSnapshots } from "./util/Snapshot";

it("runs strategic AI with attacks and construction, then resumes identically", async () => {
  const start = scriptedGameStart({
    geopolitics: true,
    geopoliticsSeed: 17432,
    gameType: GameType.Singleplayer,
    bots: 12,
    nations: 6,
    infiniteGold: false,
  });
  const runner = await createScriptedRunner("world", start);
  for (let i = 0; i < 1800; i++) {
    stepScripted(runner);
    if (i === 700) {
      const ps = runner.game.players();
      const a = ps.find((p) => p.clientID() !== null),
        b = ps.find((p) => p !== a && p.type() !== PlayerType.Bot);
      if (a && b)
        runner.game.diplomacy.act(a, {
          action: "offer",
          target: b.id(),
          kind: "truce",
          give: emptyAssets(),
          receive: emptyAssets(),
        });
    }
  }
  const restored = await restoreScriptedRunner(
    "world",
    start,
    snapshotGame(runner.game),
  );
  for (let i = 0; i < 600; i++) {
    stepScripted(runner);
    stepScripted(restored);
  }
  expect(
    diffSnapshots(snapshotGame(runner.game), snapshotGame(restored.game)),
  ).toEqual([]);
  expect(runner.game.diplomacy.state.offers.length).toBeGreaterThan(0);
  expect(runner.game.diplomacy.state.offers.length).toBeLessThanOrEqual(160);
  for (const c of runner.game.diplomacy.state.coalitions)
    expect(c.members.length).toBeLessThanOrEqual(4);
}, 120000);
