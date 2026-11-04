import {
  Difficulty,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationAttackBehavior } from "@openfront/engine/execution/nation/NationAttackBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

async function scenario(
  gameType = GameType.Singleplayer,
  difficulty = Difficulty.Impossible,
) {
  const game = await setup("big_plains", { gameType, difficulty });
  (game.config() as TestConfig).setNationSpawnImmunityDuration(600);
  const add = (name: string, type: PlayerType) =>
    game.addPlayer(new PlayerInfo(name, type, null, name));
  const nation = add("nation", PlayerType.Nation);
  const human = add("human", PlayerType.Human);
  const rival = add("rival", PlayerType.Nation);
  const bot = add("bot", PlayerType.Bot);
  const random = new PseudoRandom(42);
  const emoji = new NationEmojiBehavior(random, game, nation);
  const behavior = new NationAttackBehavior(
    random,
    game,
    nation,
    0,
    0,
    0,
    new NationAllianceBehavior(random, game, nation, emoji),
    emoji,
    new NationWarshipBehavior(random, game, nation, emoji),
  );
  return { game, human, rival, bot, behavior, random };
}

describe("Nation peace attack decisions", () => {
  it("protects humans and nations while allowing bots and neutral land", async () => {
    const { game, human, rival, bot, behavior } = await scenario();
    expect(game.isNationSpawnImmunityActive()).toBe(true);
    expect(behavior.shouldAttack(human)).toBe(false);
    expect(behavior.shouldAttack(rival)).toBe(false);
    expect(behavior.shouldAttack(bot)).toBe(true);
    expect(behavior.shouldAttack(game.terraNullius())).toBe(true);
    for (let i = 0; i <= 600; i++) game.executeNextTick();
    expect(game.isNationSpawnImmunityActive()).toBe(false);
    expect(behavior.shouldAttack(human)).toBe(true);
    expect(behavior.shouldAttack(rival)).toBe(true);
  });

  it("preserves multiplayer attack decisions during spawn immunity", async () => {
    const { human, rival, behavior } = await scenario(GameType.Public);
    expect(behavior.shouldAttack(human)).toBe(true);
    expect(behavior.shouldAttack(rival)).toBe(true);
  });

  it("retains the original easy-difficulty reluctance after peace", async () => {
    const { game, human, behavior, random } = await scenario(
      GameType.Singleplayer,
      Difficulty.Easy,
    );
    for (let i = 0; i <= 600; i++) game.executeNextTick();
    const roll = vi.spyOn(random, "nextInt").mockReturnValue(1);
    expect(behavior.shouldAttack(human)).toBe(false);
    roll.mockReturnValue(0);
    expect(behavior.shouldAttack(human)).toBe(true);
  });
});
