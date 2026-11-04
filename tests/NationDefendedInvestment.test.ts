import {
  Difficulty,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { createGame, L } from "./core/pathfinding/_fixtures";

function scenario(
  difficulty: Difficulty,
  gameType: GameType,
  defended: boolean,
) {
  const size = 120;
  const game = createGame(
    { width: size, height: size, grid: Array(size * size).fill(L) },
    {
      difficulty,
      gameType,
      disabledUnits: [
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
        UnitType.MIRV,
        UnitType.MissileSilo,
      ],
    },
  );
  const nation = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
  );
  const enemy = game.addPlayer(
    new PlayerInfo("enemy", PlayerType.Nation, null, "enemy"),
  );
  game
    .map()
    .forEachTile((tile) => (game.x(tile) < 60 ? nation : enemy).conquer(tile));
  nation.setTroops(100_000);
  enemy.setTroops(200_000);
  nation.addGold(10_000_000n);
  const behavior = new NationStructureBehavior(
    new PseudoRandom(7),
    game,
    nation,
  );
  // Establish the nation's first investment through the production decision path.
  expect(behavior.handleStructures()).toBe(true);
  game.endSpawnPhase();
  game.executeNextTick();
  if (defended) nation.buildUnit(UnitType.DefensePost, game.ref(39, 60), {});
  game.addExecution(new AttackExecution(40_000, enemy, nation.id()));
  game.executeNextTick();
  expect(nation.incomingAttacks().length).toBeGreaterThan(0);
  expect(
    nation.incomingAttacks().reduce((n, a) => n + a.troops(), 0) /
      nation.troops(),
  ).toBeGreaterThanOrEqual(0.35);
  return { game, nation, behavior };
}

describe("Investment behind an already defended front", () => {
  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s single-player can keep investing when the needed defense is already in place",
    (difficulty) => {
      const { game, nation, behavior } = scenario(difficulty, GameType.Singleplayer, true);
      expect(behavior["defensePostNeeded"]()).toBe(false);
      const goldBefore = nation.gold();
      expect(behavior.handleStructures()).toBe(true);
      game.executeNextTick(); // Initialize the queued construction.
      game.executeNextTick(); // Execute and pay for it.
      expect(nation.gold()).toBeLessThan(goldBefore);
      expect(nation.gold()).toBeGreaterThan(0n);
    },
  );
  it.each([
    [Difficulty.Medium, GameType.Singleplayer],
    [Difficulty.Hard, GameType.Public],
    [Difficulty.Impossible, GameType.Public],
  ])("preserves %s %s behavior", (difficulty, gameType) => {
    const { behavior } = scenario(difficulty, gameType, true);
    expect(behavior["defensePostNeeded"]()).toBe(true);
    expect(behavior.handleStructures()).toBe(false);
  });
  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s still requests defense on an uncovered front",
    (difficulty) => {
      const { behavior } = scenario(difficulty, GameType.Singleplayer, false);
      expect(behavior["defensePostNeeded"]()).toBe(true);
    },
  );
});
