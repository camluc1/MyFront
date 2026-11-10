import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

const human = (id: string) => new PlayerInfo(id, PlayerType.Human, null, id);

describe("functional Geopolitics naval integration", () => {
  it("keeps all experimental buildables disabled without the complete singleplayer flag", async () => {
    for (const config of [
      { geopolitics: false, geopoliticsFunctional: true },
      { geopolitics: true, geopoliticsFunctional: false },
      { geopolitics: true },
    ]) {
      const game = await setup("half_land_half_ocean", config, [human("a")]);
      for (const type of [UnitType.Capital, UnitType.Shipyard, UnitType.Bismarck]) {
        expect(game.config().isUnitDisabled(type)).toBe(true);
      }
    }
  });

  it("applies paid shipyard research to a Bismarck that is then moved and saved", async () => {
    const map = "half_land_half_ocean";
    const game = await setup(map, {
      geopolitics: true,
      geopoliticsFunctional: true,
      instantBuild: true,
      infiniteGold: false,
    }, [human("a")]);
    const player = game.player("a");
    player.addGold(40_000_000n);
    const yardTile = game.ref(7, 10);
    const shipTile = game.ref(9, 10);
    const destination = game.ref(10, 10);
    player.conquer(yardTile);
    const yard = player.buildUnit(UnitType.Shipyard, yardTile, {});
    const ship = player.buildUnit(UnitType.Bismarck, shipTile, {
      patrolTile: shipTile,
    });
    expect(ship.maxHealth()).toBe(4800);
    game.addExecution(new WarshipExecution(ship));

    const before = player.gold();
    game.addExecution(new UpgradeStructureExecution(
      player, yard.id(), 1, "warshipHealth",
    ));
    game.executeNextTick();

    expect(yard.shipyardLevels()?.warshipHealth).toBe(1);
    expect(ship.maxHealth()).toBe(5520);
    expect(player.gold()).toBe(before - 500_000n);

    game.addExecution(new MoveWarshipExecution(player, [ship.id()], destination));
    game.executeNextTick();
    expect(ship.warshipState().patrolTile).toBe(destination);

    const { restored } = await roundTrip(game, map);
    const restoredPlayer = restored.player("a");
    const restoredYard = restoredPlayer.units(UnitType.Shipyard)[0];
    const restoredShip = restoredPlayer.units(UnitType.Bismarck)[0];
    expect(restoredYard.shipyardLevels()?.warshipHealth).toBe(1);
    expect(restoredShip.maxHealth()).toBe(5520);
    expect(restoredShip.warshipState().patrolTile).toBe(destination);
    expect(restoredPlayer.gold()).toBe(player.gold());
  });
});
