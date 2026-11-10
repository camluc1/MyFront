import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { PACKED_UNIT_TYPES } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

const human = (id: string) => new PlayerInfo(id, PlayerType.Human, null, id);

describe("Functional Geopolitics Bismarck", () => {
  it("keeps existing packet IDs, and rejects the unit outside the opt-in mode", async () => {
    expect(PACKED_UNIT_TYPES[0]).toBe(UnitType.TransportShip);
    expect(PACKED_UNIT_TYPES[23]).toBe(UnitType.Shipyard);
    expect(PACKED_UNIT_TYPES[24]).toBe(UnitType.Bismarck);
    for (const config of [
      { geopolitics: false, geopoliticsFunctional: true },
      { geopolitics: true, geopoliticsFunctional: false },
      { geopolitics: true },
    ]) {
      const game = await setup("half_land_half_ocean", config, [human("a")]);
      expect(game.config().isUnitDisabled(UnitType.Bismarck)).toBe(true);
    }
  });

  it("has a 10m purchase, a reinforced hull and preserves movement after a save", async () => {
    const game = await setup("half_land_half_ocean", {
      geopolitics: true, geopoliticsFunctional: true,
      instantBuild: true, infiniteGold: false,
    }, [human("a")]);
    const a = game.player("a");
    a.addGold(40_000_000n);
    const tile = game.ref(9, 10), target = game.ref(10, 10);
    expect(game.config().isUnitDisabled(UnitType.Bismarck)).toBe(false);
    expect(game.unitInfo(UnitType.Bismarck).cost(game, a)).toBe(10_000_000n);
    const ship = a.buildUnit(UnitType.Bismarck, tile, { patrolTile: tile });
    expect(ship.maxHealth()).toBe(4000);
    expect(ship.health()).toBe(4000);
    game.addExecution(new WarshipExecution(ship));
    game.addExecution(new MoveWarshipExecution(a, [ship.id()], target));
    game.executeNextTick();
    expect(ship.warshipState().patrolTile).toBe(target);
    const { restored } = await roundTrip(game, "half_land_half_ocean");
    const copied = restored.player("a").units(UnitType.Bismarck)[0];
    expect(copied.maxHealth()).toBe(ship.maxHealth());
    expect(copied.warshipState().patrolTile).toBe(target);
  });

  it.each([2, 3])("resolves Bismarck versus %i ordinary warships in the actual engine", async (numberOfOpponents) => {
    const game = await setup("half_land_half_ocean", {
      geopolitics: true, geopoliticsFunctional: true,
      instantBuild: true, infiniteGold: true,
    }, [human("a"), human("b")]);
    const a = game.player("a"), b = game.player("b");
    a.conquer(game.ref(5, 10)); b.conquer(game.ref(5, 12));
    const capitalShipTile = game.ref(12, 12);
    const flagship = a.buildUnit(UnitType.Bismarck, capitalShipTile,
      { patrolTile: capitalShipTile });
    game.addExecution(new WarshipExecution(flagship));
    const opponents = [];
    for (let i = 0; i < numberOfOpponents; i++) {
      const tile = game.ref(13, 11 + i);
      const enemy = b.buildUnit(UnitType.Warship, tile, { patrolTile: tile });
      opponents.push(enemy);
      game.addExecution(new WarshipExecution(enemy));
    }
    for (let tick = 0; tick < 900; tick++) {
      game.executeNextTick();
      if (!flagship.isActive() || opponents.every((ship) => !ship.isActive())) break;
    }
    if (numberOfOpponents === 2) {
      expect(flagship.isActive()).toBe(true);
      expect(opponents.every((ship) => !ship.isActive())).toBe(true);
      expect(flagship.health()).toBeGreaterThan(400);
    } else {
      expect(flagship.isActive()).toBe(false);
      expect(opponents.some((ship) => ship.isActive())).toBe(true);
    }
  });

  it("uses the existing repair-port retreat threshold at 40 percent", async () => {
    const game = await setup("half_land_half_ocean", {
      geopolitics: true, geopoliticsFunctional: true,
      instantBuild: true, infiniteGold: true,
    }, [human("a")]);
    const a = game.player("a"), tile = game.ref(9, 10);
    a.conquer(game.ref(7, 10));
    a.buildUnit(UnitType.Port, game.ref(7, 10), {});
    const ship = a.buildUnit(UnitType.Bismarck, tile, { patrolTile: tile });
    game.addExecution(new WarshipExecution(ship));
    for (let i = 0; i < 55; i++) game.executeNextTick();
    ship.modifyHealth(-2550);
    for (let i = 0; i < 15; i++) game.executeNextTick();
    expect(ship.warshipState().state).not.toBe("patrolling");
  });
});
