import {
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  MatchHistorySchema,
  type MatchHistory,
  type HistoryRow,
} from "@openfront/engine-api/game/MatchHistory";
import {
  countrySummary,
  historyHighlights,
  historyValue,
  rivalHighlights,
} from "@openfront/engine-lib/game/MatchHistory";
import { sampleMatchHistory } from "@openfront/engine/game/MatchHistory";
import { StatsImpl } from "@openfront/engine/game/StatsImpl";
import {
  snapshotGame,
  snapshotGameData,
} from "@openfront/engine/snapshot/GameSnapshot";
import { encodeSnapshotValue } from "@openfront/engine/snapshot/SnapshotCodec";
import { setup } from "./util/Setup";
import { restoreTestGame } from "./util/Snapshot";
const row = (id: number, tiles: number, earned = 0): HistoryRow => [
  id,
  tiles,
  10,
  0,
  100,
  earned,
  earned,
  1,
  1,
  0,
  0,
  0,
  0,
];
async function scenario(type = GameType.Singleplayer) {
  const g = await setup("big_plains", { gameType: type, instantBuild: true });
  const a = g.addPlayer(
    new PlayerInfo("Human", PlayerType.Human, "human", "human"),
  );
  const b = g.addPlayer(
    new PlayerInfo("Nation", PlayerType.Nation, null, "nation"),
  );
  for (const [p, x] of [
    [a, 10],
    [b, 40],
  ] as const) {
    p.conquer(g.ref(x, 10));
    p.setSpawnTile(g.ref(x, 10));
  }
  return { g, a, b };
}
test("records human and nation independently of UI, separates reserve/deployment and freezes at end", async () => {
  const { g, a, b } = await scenario();
  (g.stats() as StatsImpl).goldResource(b, 1, 1000n);
  b.addGold(1000n);
  a.buildUnit(UnitType.City, g.ref(10, 10), {});
  for (let i = 0; i < 201; i++) g.executeNextTick();
  expect(g.matchHistory!.players).toHaveLength(2);
  const sample = g.matchHistory!.samples[0].rows.find(
    (r) => r[0] === b.smallID(),
  )!;
  expect(sample[6]).toBe(1000);
  expect(sample[10]).toBe(1000);
  g.setWinner(a, g.stats().stats());
  const frozen = structuredClone(g.matchHistory);
  a.addGold(99999n);
  for (let i = 0; i < 150; i++) g.executeNextTick();
  expect(g.matchHistory).toEqual(frozen);
});
test("keeps all samples beyond thirty minutes and restores source counters and history exactly", async () => {
  const { g, a } = await scenario();
  // Exercise recording over 40 minutes without running unrelated AI/pathfinding.
  const spy = vi.spyOn(g, "elapsedGameSeconds");
  for (let i = 0; i <= 240; i++) {
    spy.mockReturnValue(i * 10);
    g.matchHistory = sampleMatchHistory(g, g.matchHistory);
  }
  spy.mockRestore();
  expect(g.matchHistory!.samples).toHaveLength(241);
  expect(g.matchHistory!.samples[0].tick).toBe(0);
  (g.stats() as StatsImpl).goldResource(a, 0, 123n);
  const restored = await restoreTestGame(snapshotGame(g), "big_plains");
  expect(restored.matchHistory).toEqual(g.matchHistory);
  expect((restored.stats() as StatsImpl).historyIncome(a.id())).toEqual(
    (g.stats() as StatsImpl).historyIncome(a.id()),
  );
  expect(MatchHistorySchema.safeParse(restored.matchHistory).success).toBe(
    true,
  );
});
test("old snapshots start partial history, and multiplayer records none", async () => {
  const { g } = await scenario();
  for (let i = 0; i < 301; i++) g.executeNextTick();
  const data = snapshotGameData(g);
  const state = data.game.d as Record<string, unknown>;
  delete state.matchHistory;
  const restored = await restoreTestGame(
    encodeSnapshotValue(data),
    "big_plains",
  );
  restored.executeNextTick();
  expect(restored.matchHistory!.startTick).toBeGreaterThan(100);
  const { g: multi } = await scenario(GameType.Public);
  for (let i = 0; i < 101; i++) multi.executeNextTick();
  expect(multi.matchHistory).toBeUndefined();
});
test("ranks use ties, income uses recurring deltas and highlights include the human and later rival decline", () => {
  const h: MatchHistory = {
    version: 1,
    startTick: 0,
    players: [
      { id: 1, name: "You", kind: "human" },
      { id: 2, name: "Rival", kind: "nation" },
    ],
    samples: [
      { tick: 0, rows: [row(1, 200), row(2, 100)] },
      { tick: 300, rows: [row(1, 200), row(2, 100)] },
      { tick: 600, rows: [row(1, 200, 6000), row(2, 300)] },
      { tick: 900, rows: [row(1, 200, 6000), row(2, 300)] },
      { tick: 6600, rows: [row(1, 200, 6000), row(2, 0)] },
    ],
  };
  expect(historyValue(h, 2, h.samples[2].rows[0], "income")).toBe(6000);
  expect(
    rivalHighlights(h, 1).some((e) =>
      e.text.includes("10 minutos después: eliminado"),
    ),
  ).toBe(true);
  expect(historyHighlights(h).some((e) => e.text.includes("You"))).toBe(true);
  expect(
    historyHighlights(h).filter((e) => e.text.includes("eliminado")),
  ).toHaveLength(1);
  expect(countrySummary(h, 1).bestRank).toBe(1);
});
