import { PlayerInfo, PlayerType, UnitType, Nukes } from "@openfront/engine-api/game/GameTypes";
import { unitTypeToBombUnit } from "@openfront/engine-api/StatsSchemas";
import { PACKED_UNIT_TYPES } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

const human = (id: string) => new PlayerInfo(id, PlayerType.Human, null, id);

describe("functional Geopolitics Tsar Bomba", () => {
  it("is opt-in only and leaves all existing packet IDs intact", async () => {
    expect(PACKED_UNIT_TYPES[23]).toBe(UnitType.Shipyard);
    expect(PACKED_UNIT_TYPES[24]).toBe(UnitType.Bismarck);
    expect(PACKED_UNIT_TYPES[25]).toBe(UnitType.TsarBomba);
    expect(Nukes.has(UnitType.TsarBomba)).toBe(true);
    expect(unitTypeToBombUnit[UnitType.TsarBomba]).toBe("tsar");

    for (const config of [
      { geopolitics: false, geopoliticsFunctional: true },
      { geopolitics: true, geopoliticsFunctional: false },
      { geopolitics: true },
    ]) {
      const game = await setup("plains", config, [human("a")]);
      expect(game.config().isUnitDisabled(UnitType.TsarBomba)).toBe(true);
    }
  });

  it("costs 20M, doubles both hydrogen radii and uses the regular silo launch", async () => {
    const map = "big_plains";
    const game = await setup(map, {
      geopolitics: true,
      geopoliticsFunctional: true,
      instantBuild: true,
      infiniteGold: false,
    }, [human("a"), human("b")]);
    const a = game.player("a");
    const target = game.ref(105, 105);
    const siloTile = game.ref(10, 10);
    a.conquer(siloTile);
    a.addGold(21_000_000n);
    a.buildUnit(UnitType.MissileSilo, siloTile, {});

    expect(game.config().isUnitDisabled(UnitType.TsarBomba)).toBe(false);
    expect(game.unitInfo(UnitType.TsarBomba).cost(game, a)).toBe(20_000_000n);
    // setup() defaults to TestConfig whose 1-tile blast keeps simulations cheap;
    // verify the shipping radii against the real engine config, not the test override.
    const liveConfig = new EngineConfig(game.config().gameConfig(), false);
    expect(liveConfig.nukeMagnitudes(UnitType.TsarBomba)).toEqual({ inner: 160, outer: 200 });
    const hydrogen = liveConfig.nukeMagnitudes(UnitType.HydrogenBomb);
    expect(liveConfig.nukeMagnitudes(UnitType.TsarBomba).outer).toBe(hydrogen.outer * 2);

    const nuke = new NukeExecution(UnitType.TsarBomba, a, target);
    game.addExecution(nuke);
    game.executeNextTick();
    game.executeNextTick();
    expect(nuke.getNuke()?.type()).toBe(UnitType.TsarBomba);
    expect(a.gold()).toBe(0n);

    const { restored } = await roundTrip(game, map);
    expect(restored.config().isFunctionalGeopolitics()).toBe(true);
    expect(restored.player("a").units(UnitType.TsarBomba)).toHaveLength(1);
    expect(restored.player("a").units(UnitType.TsarBomba)[0].targetTile()).toBe(target);
  });
});
