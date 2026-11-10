import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { SHIPYARD_MAX_LEVEL, shipyardUpgradePrice } from "@openfront/engine-api/game/Shipyard";
import { packUnitUpdates, unpackUnitUpdates, UNIT_UPDATE_STRIDE } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { shipyardLevel } from "@openfront/engine/game/ShipyardUpgrades";
import { merchantAcceleratedPath, merchantStepsAtTick } from "@openfront/engine/execution/TradeShipExecution";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

const human = (id: string) => new PlayerInfo(id, PlayerType.Human, null, id);

describe("functional Shipyard research and serialization", () => {
  it("is unavailable when functional Geopolitics is off", async () => {
    for (const config of [
      { geopolitics: true },
      { geopolitics: false, geopoliticsFunctional: true },
    ]) {
      const game = await setup("plains", config, [human("a")]);
      expect(game.config().isUnitDisabled(UnitType.Shipyard)).toBe(true);
    }
  });

  it("enforces independent paid levels up to three, with real hull and damage research", async () => {
    const game = await setup("plains", {
      geopolitics: true, geopoliticsFunctional: true, instantBuild: true,
    }, [human("a")]);
    const a = game.player("a");
    const home = game.ref(30, 30);
    a.conquer(home);
    a.addGold(20_000_000n);
    const yard = a.buildUnit(UnitType.Shipyard, home, {});
    const baselineGold = a.gold();
    const ship = a.buildUnit(UnitType.Warship, game.ref(30, 30),
      { patrolTile: game.ref(30, 30) });
    expect(ship.maxHealth()).toBe(1000);
    for (let i = 0; i < SHIPYARD_MAX_LEVEL; i++) {
      game.addExecution(new UpgradeStructureExecution(
        a, yard.id(), 1, "warshipHealth"));
      game.executeNextTick();
    }
    expect(yard.shipyardLevels()?.warshipHealth).toBe(3);
    expect(shipyardLevel(a, "warshipHealth")).toBe(3);
    expect(ship.maxHealth()).toBe(1450);
    expect(ship.health()).toBe(1450);
    expect(a.gold()).toBe(baselineGold -
      (shipyardUpgradePrice(0)! + shipyardUpgradePrice(1)! +
        shipyardUpgradePrice(2)!));
    game.addExecution(new UpgradeStructureExecution(a, yard.id(), 1,
      "warshipHealth"));
    game.executeNextTick();
    expect(yard.shipyardLevels()?.warshipHealth).toBe(3);
    const later = a.buildUnit(UnitType.Warship, game.ref(31, 30),
      { patrolTile: game.ref(31, 30) });
    expect(later.health()).toBe(1450);
    expect(yard.shipyardLevels()?.warshipDamage).toBe(0);
    game.addExecution(new UpgradeStructureExecution(a, yard.id(), 1,
      "warshipDamage"));
    game.executeNextTick();
    expect(shipyardLevel(a, "warshipDamage")).toBe(1);
  });

  it("preserves levels in both the packed 21-lane wire format and snapshots", async () => {
    const game = await setup("plains", {
      geopolitics: true, geopoliticsFunctional: true, instantBuild: true,
    }, [human("a")]);
    const a = game.player("a");
    a.conquer(game.ref(25, 25));
    a.addGold(5_000_000n);
    const yard = a.buildUnit(UnitType.Shipyard, game.ref(25, 25), {});
    game.addExecution(new UpgradeStructureExecution(a, yard.id(), 1,
      "merchantSpeed"));
    game.executeNextTick();
    const packed = packUnitUpdates([yard.toUpdate()]);
    expect(packed.packedUnitUpdates.length).toBe(UNIT_UPDATE_STRIDE);
    expect(unpackUnitUpdates(
      packed.packedUnitUpdates, packed.packedMissileTimers,
    )[0].shipyardLevels).toEqual({
      merchantSpeed: 1, transportCapacity: 0,
      warshipHealth: 0, warshipDamage: 0,
    });
    const { restored } = await roundTrip(game, "plains");
    expect(restored.player("a").units(UnitType.Shipyard)[0].shipyardLevels())
      .toEqual(yard.shipyardLevels());
  });

  it("keeps upgraded merchant motion plans deterministic and faster", () => {
    const path = Array.from({ length: 101 }, (_, i) => i);
    expect(merchantAcceleratedPath(path, 0, 0)).toEqual(path);
    const accelerated = merchantAcceleratedPath(path, 0, 3);
    expect(accelerated.length).toBeLessThan(path.length);
    let index = 0;
    for (let t = 1; t < accelerated.length; t++) {
      index = Math.min(100, index + merchantStepsAtTick(t, 3));
      expect(accelerated[t]).toBe(path[index]);
    }
  });
});
