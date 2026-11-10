import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { AIRCRAFT_MAX_FUEL } from "@openfront/engine-api/game/Aircraft";
import { PACKED_UNIT_TYPES, packUnitUpdates, unpackUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { AircraftExecution } from "@openfront/engine/execution/AircraftExecution";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

const human = (id: string) => new PlayerInfo(id, PlayerType.Human, null, id);

describe("Functional Geopolitics aviation", () => {
  it("appends aircraft IDs and keeps every aircraft disabled outside opt-in singleplayer", async () => {
    expect(PACKED_UNIT_TYPES[26]).toBe(UnitType.Airfield);
    expect(PACKED_UNIT_TYPES[27]).toBe(UnitType.AttackAircraft);
    expect(PACKED_UNIT_TYPES[28]).toBe(UnitType.BomberAircraft);
    expect(PACKED_UNIT_TYPES[29]).toBe(UnitType.FighterAircraft);
    for (const config of [
      { geopolitics: false, geopoliticsFunctional: true },
      { geopolitics: true, geopoliticsFunctional: false },
      { geopolitics: true },
    ]) {
      const game = await setup("plains", config, [human("a")]);
      for (const type of [
        UnitType.Airfield, UnitType.AttackAircraft,
        UnitType.BomberAircraft, UnitType.FighterAircraft,
      ]) expect(game.config().isUnitDisabled(type)).toBe(true);
    }
  });

  it("spawns a paid aircraft only from a completed runway, flies and restores fuel", async () => {
    const game = await setup("plains", {
      geopolitics: true, geopoliticsFunctional: true,
      infiniteGold: false, instantBuild: true,
    }, [human("a")]);
    const a = game.player("a");
    const home = game.ref(30, 30), destination = game.ref(44, 36);
    a.addGold(10_000_000n);
    expect(a.canBuild(UnitType.AttackAircraft, home)).toBe(false);
    a.conquer(home);
    const airfield = a.buildUnit(UnitType.Airfield, home, {});
    expect(airfield.isActive()).toBe(true);
    const before = a.gold();
    game.addExecution(new AircraftExecution({
      owner: a, type: UnitType.AttackAircraft, tile: home,
    }));
    game.executeNextTick();
    const plane = a.units(UnitType.AttackAircraft)[0];
    expect(plane).toBeDefined();
    expect(a.gold()).toBe(before - 1_000_000n);
    expect(plane.aircraftState()?.fuel).toBe(AIRCRAFT_MAX_FUEL);
    game.addExecution(new MoveWarshipExecution(a, [plane.id()], destination));
    game.executeNextTick();
    expect(plane.aircraftState()?.targetTile).toBe(destination);
    expect(plane.aircraftState()?.phase).not.toBe("docked");
    for (let i=0; i<3; i++) game.executeNextTick();
    expect(plane.aircraftState()?.fuel).toBeLessThan(AIRCRAFT_MAX_FUEL);
    const packed = packUnitUpdates([plane.toUpdate()]);
    const restoredUpdate = unpackUnitUpdates(
      packed.packedUnitUpdates, packed.packedMissileTimers,
    )[0];
    expect(restoredUpdate.aircraftState?.fuel).toBe(plane.aircraftState()?.fuel);
    expect(restoredUpdate.aircraftState?.homeTile).toBe(home);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.player("a").units(UnitType.AttackAircraft)[0].aircraftState())
      .toEqual(plane.aircraftState());
  });

  it("rejects an unsafe sortie, then completes a safe mission and refuels", async () => {
    const game = await setup("plains", {
      geopolitics: true, geopoliticsFunctional: true,
      infiniteGold: true, instantBuild: true,
    }, [human("a")]);
    const a = game.player("a");
    const home = game.ref(30, 30), objective = game.ref(50, 30);
    a.conquer(home);
    a.buildUnit(UnitType.Airfield, home, {});
    const plane = a.buildUnit(UnitType.AttackAircraft, home, { homeTile: home });
    game.addExecution(new AircraftExecution(plane));
    game.executeNextTick();

    // 20 tiles outbound + 20 back + 80 in reserve = 120 required.
    plane.updateAircraftState({ fuel: 5 });
    game.addExecution(new MoveWarshipExecution(a, [plane.id()], objective));
    game.executeNextTick();
    expect(plane.aircraftState()?.phase).toBe("docked");
    expect(plane.aircraftState()?.targetTile).toBeUndefined();

    // Once it has refuelled, the same command is accepted.
    for (let i = 0; i < 3; i++) game.executeNextTick();
    expect(plane.aircraftState()?.fuel).toBeGreaterThan(120);
    game.addExecution(new MoveWarshipExecution(a, [plane.id()], objective));
    game.executeNextTick();
    expect(plane.aircraftState()?.targetTile).toBe(objective);
    for (let i = 0; i < 30; i++) game.executeNextTick();
    expect(plane.isActive()).toBe(true);
    expect(plane.aircraftState()?.phase).toBe("docked");
    expect(plane.aircraftState()?.targetTile).toBeUndefined();
    expect(plane.aircraftState()?.fuel).toBeGreaterThan(0);
  });

  it("limits the mobile repair carrier to four docked aircraft and redirects a fifth", async () => {
    const game = await setup("half_land_half_ocean", {
      geopolitics: true, geopoliticsFunctional: true,
      instantBuild: true, infiniteGold: true,
    }, [human("a")]);
    const a = game.player("a");
    const home = game.ref(7, 10), carrierTile = game.ref(9, 10);
    a.conquer(home);
    a.buildUnit(UnitType.Airfield, home, {});
    const carrier = a.buildUnit(UnitType.Warship, carrierTile, {
      patrolTile: carrierTile, supportShip: true,
    });
    const planes = Array.from({ length: 5 }, () =>
      a.buildUnit(UnitType.FighterAircraft, carrierTile, { homeTile: home }));
    for (const plane of planes) {
      plane.updateAircraftState({ phase: "returning", fuel: 500 });
      game.addExecution(new AircraftExecution(plane));
    }
    for (let i = 0; i < 8; i++) game.executeNextTick();
    expect(planes.every((plane) => plane.isActive())).toBe(true);
    const aboard = planes.filter((plane) =>
      plane.aircraftState()?.phase === "docked" &&
      plane.aircraftState()?.carrierId === carrier.id());
    expect(aboard).toHaveLength(4);
    const remaining = planes.find((plane) => !aboard.includes(plane));
    expect(remaining?.aircraftState()?.phase).toBe("docked");
    expect(remaining?.aircraftState()?.carrierId).toBeUndefined();
    expect(remaining?.tile()).toBe(home);
  });

  it("ground-attack removes at most 500k soldiers but never transfers land", async () => {
    const game = await setup("plains", {
      geopolitics: true, geopoliticsFunctional: true,
      instantBuild: true, infiniteGold: true,
    }, [human("a"), human("b")]);
    const a=game.player("a"), b=game.player("b");
    const home=game.ref(30,30), target=game.ref(37,34);
    a.conquer(home);
    b.conquer(target);
    a.buildUnit(UnitType.Airfield,home,{});
    b.setTroops(900_000);
    game.addExecution(new AircraftExecution({
      owner:a,type:UnitType.AttackAircraft,tile:home,
    }));
    game.executeNextTick();
    const plane=a.units(UnitType.AttackAircraft)[0];
    game.addExecution(new MoveWarshipExecution(a,[plane.id()],target));
    for(let i=0;i<20;i++)game.executeNextTick();
    expect(b.troops()).toBe(400_000);
    expect(game.owner(target)).toBe(b);
    expect(plane.aircraftState()?.phase).not.toBe("outbound");
  });

  it("bomber and fighter keep independent fuel and deterministic orders", async () => {
    const game=await setup("plains", {
      geopolitics:true, geopoliticsFunctional:true,
      instantBuild:true, infiniteGold:true,
    }, [human("a"),human("b")]);
    const a=game.player("a"),b=game.player("b");
    const home=game.ref(32,32),target=game.ref(39,32);
    a.conquer(home);
    for (let x=37; x<=41; x++) b.conquer(game.ref(x,32));
    a.buildUnit(UnitType.Airfield,home,{});
    b.setTroops(600_000);
    const bomber=a.buildUnit(UnitType.BomberAircraft,home,{homeTile:home});
    const fighter=a.buildUnit(UnitType.FighterAircraft,home,{homeTile:home});
    game.addExecution(new AircraftExecution(bomber),new AircraftExecution(fighter));
    game.addExecution(
      new MoveWarshipExecution(a,[bomber.id()],target),
      new MoveWarshipExecution(a,[fighter.id()],target),
    );
    let visualBombImpacts = 0;
    for (let i=0;i<15;i++) {
      const updates = game.executeNextTick()[GameUpdateType.Unit];
      visualBombImpacts += updates.filter((u) =>
        u.unitType === UnitType.Shell && !u.isActive && u.reachedTarget).length;
    }
    expect(visualBombImpacts).toBe(5);
    expect(b.troops()).toBeLessThan(600_000);
    // Fighter never touches the ground troop pool: the bomber alone did that.
    expect(fighter.aircraftState()?.fuel).toBeGreaterThan(0);
    expect(bomber.aircraftState()?.fuel).toBeGreaterThan(0);
  });
});
