import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import {
  SUPPORT_SHIP_CAPACITY,
  SUPPORT_SHIP_COST,
  SUPPORT_SHIP_RADIUS,
  WarshipExecution,
} from "@openfront/engine/execution/WarshipExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("Geopolitics mobile shipyard", () => {
  let game: Game;
  let owner: Player;
  let enemy: Player;
  let workshop: Unit;

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { geopolitics: true, instantBuild: true, infiniteGold: true },
      [
        new PlayerInfo("Naval logistics", PlayerType.Human, null, "shipyard_owner"),
        new PlayerInfo("Opposition", PlayerType.Human, null, "shipyard_enemy"),
      ],
    );
    owner = game.player("shipyard_owner");
    enemy = game.player("shipyard_enemy");
    const tile = game.ref(10, 10);
    workshop = owner.buildUnit(UnitType.Warship, tile, {
      patrolTile: tile,
      supportShip: true,
    });
    game.addExecution(new WarshipExecution(workshop));
  });

  const makeShip = (player: Player, game: Game, x: number): Unit => {
    const tile = game.ref(x, 11);
    const unit = player.buildUnit(UnitType.Warship, tile, { patrolTile: tile });
    unit.modifyHealth(-300);
    return unit;
  };

  test("repairs at most three nearby warships without healing enemies", () => {
    expect(SUPPORT_SHIP_CAPACITY).toBe(3);
    expect(SUPPORT_SHIP_RADIUS).toBe(90);
    expect(SUPPORT_SHIP_COST).toBe(5_000_000n);
    const ships = [11, 12, 13, 14].map(x => makeShip(owner, game, x));
    const hostile = makeShip(enemy, game, 15);
    const previous = ships.map(ship => ship.health());
    const hostilePrevious = hostile.health();

    game.executeNextTick();

    expect(ships.slice(0, 3).every((ship, index) =>
      ship.health() === previous[index] + 4,
    )).toBe(true);
    expect(ships[3].health()).toBe(previous[3]);
    expect(hostile.health()).toBe(hostilePrevious);
  });

  test("can be given a new sea destination and moves toward it", () => {
    const destination = game.ref(18, 20);
    const before = workshop.tile();
    game.addExecution(new MoveWarshipExecution(owner, [workshop.id()], destination));
    executeTicks(game, 12);
    expect(workshop.warshipState().patrolTile).toBe(destination);
    expect(workshop.tile()).not.toBe(before);
  });

  test("does not repair a warship that has just taken enemy fire", () => {
    const ship = makeShip(owner, game, 11);
    ship.modifyHealth(-100, enemy);
    const before = ship.health();
    game.executeNextTick();
    expect(ship.health()).toBe(before);
    executeTicks(game, 11);
    expect(ship.health()).toBeGreaterThan(before);
  });

  test("support ship never targets an enemy or fires shells", () => {
    const hostile = enemy.buildUnit(UnitType.Warship, game.ref(11, 10), {
      patrolTile: game.ref(11, 10),
    });
    const before = hostile.health();
    executeTicks(game, 12);
    expect(workshop.targetUnit()).toBeUndefined();
    expect(hostile.health()).toBe(before);
  });
});
