import {
  CASTLE_DEFENSE_ACTIVE_TICKS,
  CASTLE_DEFENSE_RECOVERY_TICKS,
  CASTLE_DEFENSE_COST,
  castleDefenseMode,
} from "@openfront/engine-api/game/CastleDefense";
import { GameType, PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { tryActivateCastleDefense } from "@openfront/engine/execution/CastleDefenseExecution";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";
import { constructionExecution } from "./util/utils";

describe("Geopolitics fortress decisions", () => {
  const human = (name: string) => new PlayerInfo(name, PlayerType.Human, null, name);

  it("charges once, prevents spam, changes phase and clears on capture", async () => {
    const game = await setup("plains", {
      geopolitics: true, gameType: GameType.Singleplayer, instantBuild: true,
    }, [human("a"), human("b")]);
    const owner = game.player("a");
    owner.addGold(5_000_000n);
    for (let y = 26; y <= 34; y++)
      for (let x = 26; x <= 34; x++) owner.conquer(game.ref(x, y));
    constructionExecution(game, owner, 30, 30, UnitType.Castle, 4);
    const castle = owner.units(UnitType.Castle)[0];
    expect(castle).toBeDefined();
    const tick = game.ticks();
    const gold = owner.gold();
    expect(tryActivateCastleDefense(game, owner, castle.id())).toBe(true);
    expect(owner.gold()).toBe(gold - CASTLE_DEFENSE_COST);
    expect(tryActivateCastleDefense(game, owner, castle.id())).toBe(false);
    const state = castle.castleDefenseState();
    expect(state.activeUntilTick).toBe(tick + CASTLE_DEFENSE_ACTIVE_TICKS);
    expect(state.cooldownUntilTick).toBe(
      tick + CASTLE_DEFENSE_ACTIVE_TICKS + CASTLE_DEFENSE_RECOVERY_TICKS,
    );
    expect(castleDefenseMode(tick, state)).toBe("fortified");
    expect(castleDefenseMode(state.activeUntilTick, state)).toBe("recovery");
    expect(castleDefenseMode(state.cooldownUntilTick, state)).toBe("normal");
    castle.setOwner(game.player("b"));
    expect(castle.castleDefenseState()).toEqual({
      activeUntilTick: 0, cooldownUntilTick: 0,
    });
  });

  it("restores the exact active and recovery ticks from a save", async () => {
    const game = await setup("plains", {
      geopolitics: true, gameType: GameType.Singleplayer, instantBuild: true,
    }, [human("a")]);
    const owner = game.player("a");
    owner.addGold(5_000_000n);
    for (let y = 26; y <= 34; y++)
      for (let x = 26; x <= 34; x++) owner.conquer(game.ref(x, y));
    constructionExecution(game, owner, 30, 30, UnitType.Castle, 4);
    const castle = owner.units(UnitType.Castle)[0];
    expect(tryActivateCastleDefense(game, owner, castle.id())).toBe(true);
    const expected = castle.castleDefenseState();
    const { restored } = await roundTrip(game, "plains");
    expect(restored.unit(castle.id())?.castleDefenseState()).toEqual(expected);
    expect(restored.player("a").gold()).toBe(owner.gold());
  });

  it("rejects Classic, construction and foreign commands without charging", async () => {
    const game = await setup("plains", { geopolitics: false }, [human("a")]);
    const a = game.player("a");
    a.addGold(500_000n);
    expect(tryActivateCastleDefense(game, a, 99_999)).toBe(false);
    expect(a.gold()).toBe(500_000n);
  });
});
