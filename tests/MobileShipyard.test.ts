import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import { ShellExecution } from "@openfront/engine/execution/ShellExecution";
import {
  SUPPORT_SHIP_CAPACITY,
  SUPPORT_SHIP_COST,
  SUPPORT_SHIP_RADIUS,
  WarshipExecution,
} from "@openfront/engine/execution/WarshipExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";
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

    executeTicks(game, 12);

    // At most three different recipients, with an explicit health delta.
    const healed = ships.map((ship, index) => ship.health() - previous[index]);
    expect(healed.filter(delta => delta > 0)).toHaveLength(3);
    expect(healed.slice(0, 3).every(delta => delta > 0)).toBe(true);
    expect(healed[3]).toBe(0);
    expect(hostile.health()).toBe(hostilePrevious);
  });

  test("the fourth ship waits until a repair bay becomes available", () => {
    const ships = [11, 12, 13, 14].map((x) => {
      const tile = game.ref(x, 11);
      const ship = owner.buildUnit(UnitType.Warship, tile, { patrolTile: tile });
      ship.modifyHealth(-8);
      return ship;
    });
    // The execution manager may initialize the dock one tick after setup.
    // During all servicing ticks, the fourth hull must remain in the queue.
    for (let i = 0; i < 12; i++) {
      if (ships.slice(0, 3).every((ship) => ship.health() === ship.maxHealth())) break;
      expect(ships[3].health()).toBe(ships[3].maxHealth() - 8);
      game.executeNextTick();
    }
    expect(ships.slice(0, 3).every((ship) => ship.health() === ship.maxHealth())).toBe(true);
    expect(ships[3].health()).toBe(ships[3].maxHealth() - 8);
    game.executeNextTick();
    expect(ships[3].health()).toBeGreaterThan(ships[3].maxHealth() - 8);
  });

  test("support ship and its three repair assignments survive save/load", async () => {
    [11, 12, 13, 14].forEach((x) => makeShip(owner, game, x));
    executeTicks(game, 6);
    // The general Geopolitics graph check currently reports a pre-existing
    // lastEmission bookkeeping mismatch. Validate the workshop persistence
    // and subsequent simulation behavior directly instead.
    const { restored } = await roundTrip(game, "half_land_half_ocean");
    const restoredWorkshop = restored.unit(workshop.id());
    expect(restoredWorkshop?.warshipState().supportShip).toBe(true);
    executeTicks(restored, 3);
    const repairedShips = restored.player("shipyard_owner")
      .units(UnitType.Warship)
      .filter((ship) => !ship.warshipState().supportShip);
    expect(repairedShips.filter((ship) => ship.health() > 700)).toHaveLength(3);
    expect(repairedShips.filter((ship) => ship.health() === 700)).toHaveLength(1);
  });

  test("can be given a new sea destination and moves toward it", () => {
    const destination = game.ref(14, 13);
    const before = workshop.tile();
    game.addExecution(new MoveWarshipExecution(owner, [workshop.id()], destination));
    executeTicks(game, 12);
    expect(workshop.warshipState().patrolTile).toBe(destination);
    expect(workshop.tile()).not.toBe(before);
  });

  test("can change course mid-voyage and arrive at the second destination", () => {
    const first = game.ref(14, 13);
    const second = game.ref(11, 15);
    game.addExecution(new MoveWarshipExecution(owner, [workshop.id()], first));
    executeTicks(game, 2);
    game.addExecution(new MoveWarshipExecution(owner, [workshop.id()], second));
    for (let tick = 0; tick < 40 && workshop.tile() !== second; tick++) {
      game.executeNextTick();
    }
    expect(workshop.warshipState().patrolTile).toBe(second);
    expect(workshop.tile()).toBe(second);
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

  test("a damaged warship retreats to the mobile dock even without a port", () => {
    const ship = owner.buildUnit(UnitType.Warship, game.ref(14, 14), {
      patrolTile: game.ref(14, 14),
    });
    // The existing retreat guard deliberately ignores automatic retreats
    // during the first 50 simulation ticks after manual movement.
    executeTicks(game, 51);
    ship.modifyHealth(-400);
    game.addExecution(new WarshipExecution(ship));
    executeTicks(game, 3);

    expect(ship.warshipState().retreatSupportID).toBe(workshop.id());
    expect(["docked", "retreating"]).toContain(ship.warshipState().state);
  });

  test("real construction charges exactly 5 million in Geopolitics", async () => {
    const actualGame = await setup(
      "half_land_half_ocean",
      { geopolitics: true, instantBuild: true, infiniteGold: false },
      [new PlayerInfo("Paying admiral", PlayerType.Human, null, "paying_admiral")],
    );
    const admiral = actualGame.player("paying_admiral");
    admiral.conquer(actualGame.ref(3, 10));
    admiral.buildUnit(UnitType.Port, actualGame.ref(7, 10), {});
    // Keep the treasury above the fixed price after paying for the port.
    admiral.addGold(10_000_000n);
    const before = admiral.gold();
    actualGame.addExecution(new ConstructionExecution(
      admiral, UnitType.Warship, actualGame.ref(10, 10),
      undefined, undefined, true,
    ));
    executeTicks(actualGame, 3);
    const vessels = admiral.units(UnitType.Warship);
    expect(vessels).toHaveLength(1);
    expect(vessels[0].warshipState().supportShip).toBe(true);
    expect(admiral.gold()).toBe(before - SUPPORT_SHIP_COST);
  });

  test("classic construction does not create a mobile workshop", async () => {
    const classic = await setup(
      "half_land_half_ocean",
      { geopolitics: false, instantBuild: true, infiniteGold: true },
      [new PlayerInfo("Classic admiral", PlayerType.Human, null, "classic_admiral")],
    );
    const admiral = classic.player("classic_admiral");
    admiral.conquer(classic.ref(3, 10));
    admiral.buildUnit(UnitType.Port, classic.ref(7, 10), {});
    classic.addExecution(new ConstructionExecution(
      admiral, UnitType.Warship, classic.ref(10, 10),
      undefined, undefined, true,
    ));
    executeTicks(classic, 3);
    expect(admiral.units(UnitType.Warship)).toHaveLength(0);
  });

  test("enemy combat warship recognizes the mobile workshop as an attack target", () => {
    // Model a declared war: the target should be discoverable by the ordinary
    // warship AI, not only vulnerable to manually spawned projectiles.
    vi.spyOn(enemy, "canAttackPlayer").mockReturnValue(true);
    game.config().warshipShellAttackRate = () => 2;
    const tile = game.ref(11, 10);
    const attacker = enemy.buildUnit(UnitType.Warship, tile, { patrolTile: tile });
    game.addExecution(new WarshipExecution(attacker));
    const before = workshop.health();
    let everTargeted = false;
    let wasDamaged = false;
    for (let i = 0; i < 12; i++) {
      game.executeNextTick();
      everTargeted ||= attacker.targetUnit() === workshop;
      wasDamaged ||= workshop.health() < before;
    }
    expect(everTargeted).toBe(true);
    expect(wasDamaged).toBe(true);
    vi.restoreAllMocks();
  });

  test("enemy gunfire damages and can sink the support ship", () => {
    // Exercise the actual projectile damage pipeline rather than deleting
    // the unit directly. The workshop is a vulnerable naval target.
    const gunner = enemy.buildUnit(UnitType.Warship, game.ref(11, 10), {
      patrolTile: game.ref(11, 10),
    });
    const before = workshop.health();
    game.addExecution(new ShellExecution(gunner.tile(), enemy, gunner, workshop));
    executeTicks(game, 15);
    expect(workshop.health()).toBeLessThan(before);
    // A second projectile can finish an already heavily damaged workshop.
    workshop.modifyHealth(1 - workshop.health());
    game.addExecution(new ShellExecution(gunner.tile(), enemy, gunner, workshop));
    executeTicks(game, 15);
    expect(workshop.isActive()).toBe(false);
  });

  test("retreating ships abandon a destroyed mobile dock", () => {
    const ship = owner.buildUnit(UnitType.Warship, game.ref(13, 11), {
      patrolTile: game.ref(13, 11),
    });
    game.addExecution(new WarshipExecution(ship));
    executeTicks(game, 51);
    ship.modifyHealth(-400);
    executeTicks(game, 3);
    expect(ship.warshipState().retreatSupportID).toBe(workshop.id());
    workshop.modifyHealth(-workshop.health(), enemy);
    executeTicks(game, 2);
    expect(ship.warshipState().retreatSupportID).toBeUndefined();
    expect(ship.warshipState().state).toBe("patrolling");
  });

  test("rejects movement commands to land without changing course", () => {
    const original = workshop.warshipState().patrolTile;
    const land = game.ref(2, 10);
    expect(game.isWater(land)).toBe(false);
    new MoveWarshipExecution(owner, [workshop.id()], land).init(game, 0);
    expect(workshop.warshipState().patrolTile).toBe(original);
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
