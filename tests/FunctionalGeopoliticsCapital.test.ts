import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { emptyAssets } from "@openfront/engine-api/Geopolitics";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

const human = (id: string) => new PlayerInfo(id, PlayerType.Human, null, id);

describe("functional Geopolitics capitals (experimental)", () => {
  it("does not change Classic or Geopolitics without the explicit flag", async () => {
    for (const config of [
      { geopolitics: false, geopoliticsFunctional: true },
      { geopolitics: true, geopoliticsFunctional: false },
      { geopolitics: true },
    ]) {
      const game = await setup("plains", config, [human("a")]);
      expect(game.config().isFunctionalGeopolitics()).toBe(false);
      expect(game.config().isUnitDisabled(UnitType.Capital)).toBe(true);
    }
  });

  it("automatically spawns a unique zero-cost palace at the spawn center", async () => {
    const info = human("a");
    const game = await setup("big_plains", {
      geopolitics: true, geopoliticsFunctional: true, instantBuild: true,
    }, [info], undefined, undefined, false);
    const tile = game.ref(30, 30);
    game.addExecution(new SpawnExecution("game-id", info, tile));
    game.executeNextTick();
    game.executeNextTick();
    const a = game.player("a");
    expect(a.units(UnitType.Capital)).toHaveLength(1);
    expect(a.units(UnitType.Capital)[0].tile()).toBe(a.spawnTile());
    expect(game.owner(a.spawnTile()!)).toBe(a);
    expect(game.config().isFunctionalGeopolitics()).toBe(true);
  });

  it("rejects exact diplomatic territory selection containing the capital", async () => {
    const game = await setup("plains", {
      geopolitics: true, geopoliticsFunctional: true,
    }, [human("a"), human("b")]);
    const a = game.player("a"), b = game.player("b");
    a.conquer(game.ref(8, 8));
    b.conquer(game.ref(20, 20));
    b.conquer(game.ref(21, 20));
    const capital = b.buildUnit(UnitType.Capital, game.ref(20, 20), {});
    game.diplomacy.act(b, {
      action: "offer", target: a.id(), kind: "peace",
      give: { ...emptyAssets(), tiles: [capital.tile()] },
      receive: emptyAssets(),
    });
    expect(game.diplomacy.state.offers).toHaveLength(0);
    game.diplomacy.act(b, {
      action: "offer", target: a.id(), kind: "peace",
      give: { ...emptyAssets(), buildings: [capital.id()] },
      receive: emptyAssets(),
    });
    expect(game.diplomacy.state.offers).toHaveLength(0);
  });

  it("captures all territory, removes treaties and recalculates victory on palace conquest", async () => {
    const game = await setup("plains", {
      geopolitics: true, geopoliticsFunctional: true,
    }, [human("a"), human("b"), human("c")]);
    const a = game.player("a"), b = game.player("b");
    a.conquer(game.ref(5, 5));
    for (const tile of [game.ref(20, 20), game.ref(21, 20), game.ref(60, 60)])
      b.conquer(tile);
    const palaceTile = game.ref(20, 20);
    b.buildUnit(UnitType.Capital, palaceTile, {});
    game.diplomacy.state.treaties.push({
      id: 4, a: a.id(), b: b.id(), kind: "peace", until: 2000,
    });
    game.diplomacy.state.coalitions.push({
      id: 5, members: [a.id(), b.id()], threat: "", until: 2000,
    });
    game.diplomacy.state.victory = {
      members: [a.id(), b.id()], since: 1, share: 900, remaining: 42,
    };
    game.diplomacy.act(a, {
      action: "offer", target: b.id(), kind: "peace",
      give: emptyAssets(), receive: emptyAssets(),
    });
    a.conquer(palaceTile);
    expect(b.isAlive()).toBe(false);
    expect(game.owner(game.ref(21, 20))).toBe(a);
    expect(game.owner(game.ref(60, 60))).toBe(a);
    expect(b.units(UnitType.Capital)).toHaveLength(0);
    expect(game.diplomacy.state.treaties).toHaveLength(0);
    expect(game.diplomacy.state.coalitions).toHaveLength(0);
    expect(game.diplomacy.state.offers.filter((o) => o.status === "pending")).toHaveLength(0);
    expect(game.diplomacy.state.victory).toBeNull();
  });

  it("survives save/restore, while a direct blast-style relinquish cannot erase the palace", async () => {
    const game = await setup("plains", {
      geopolitics: true, geopoliticsFunctional: true,
    }, [human("a")]);
    const a = game.player("a"), tile = game.ref(24, 24);
    a.conquer(tile);
    a.buildUnit(UnitType.Capital, tile, {});
    a.conquer(game.ref(25, 24));
    a.relinquish(tile);
    expect(game.owner(tile)).toBe(a);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.config().isFunctionalGeopolitics()).toBe(true);
    expect(restored.player("a").units(UnitType.Capital)[0].tile()).toBe(tile);
  });
});
