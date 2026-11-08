import {
  PlayerInfo, PlayerType, TerrainType, UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { AttackLogicInput } from "@openfront/engine/configuration/EngineConfig";
import {
  protectedByIronDome,
  createBlastIronDomeCoverage,
} from "@openfront/engine/execution/IronDomeProtection";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { executeTicks } from "./util/utils";
import { setup } from "./util/Setup";

const human = (name: string) =>
  new PlayerInfo(name, PlayerType.Human, null, name);

describe("Geopolitics advanced defenses", () => {
  it("does not offer or allow Castle and Iron Dome in classic games", async () => {
    const game = await setup("plains", { geopolitics: false }, [human("a")]);
    expect(game.config().isUnitDisabled(UnitType.Castle)).toBe(true);
    expect(game.config().isUnitDisabled(UnitType.IronDome)).toBe(true);
  });

  it("uses fixed 1.5M / 10M costs and 60 / 84 tile ranges", async () => {
    const game = await setup("plains", { geopolitics: true }, [human("a")]);
    const player = game.player("a");
    expect(game.config().isUnitDisabled(UnitType.Castle)).toBe(false);
    expect(game.config().isUnitDisabled(UnitType.IronDome)).toBe(false);
    expect(game.unitInfo(UnitType.Castle).cost(game, player)).toBe(1_500_000n);
    expect(game.unitInfo(UnitType.IronDome).cost(game, player)).toBe(10_000_000n);
    expect(game.config().castleRange()).toBe(game.config().defensePostRange() * 2);
    expect(game.config().ironDomeRange()).toBe(Math.round(game.config().samRange(1) * 1.2));
    expect(game.config().castleRange()).toBe(60);
    expect(game.config().ironDomeRange()).toBe(84);
    expect(game.config().unitInfo(UnitType.Castle).upgradable).toBeFalsy();
    expect(game.config().unitInfo(UnitType.IronDome).upgradable).toBeFalsy();
  });

  it("a Castle beats a Defense Post without combining their multipliers", async () => {
    const game = await setup("plains", { geopolitics: true }, [human("a")]);
    const input: AttackLogicInput = {
      terrain: TerrainType.Plains,
      attackTroops: 200_000,
      attacker: { type: PlayerType.Human, numTiles: 200 },
      defender: {
        type: PlayerType.Human, numTiles: 200, troops: 75_000,
        isTraitor: false, isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: true,
      falloutRatio: null,
      borderSize: 8,
    };
    const post = game.config().attackLogic(input);
    const castle = game.config().attackLogic({ ...input, defenderHasCastle: true });
    const castleOnly = game.config().attackLogic({
      ...input, defenderHasCastle: true, defenderHasDefensePost: false,
    });
    expect(castle.attackerTroopLoss).toBeGreaterThan(post.attackerTroopLoss);
    expect(castle).toEqual(castleOnly);
  });

  it("intercepts simultaneous MIRV sub-warheads without damaging the dome or city", async () => {
    const game = await setup(
      "big_plains", { geopolitics: true, infiniteGold: true, instantBuild: true },
      [human("attacker"), human("defender")],
    );
    const attacker = game.player("attacker");
    const defender = game.player("defender");
    attacker.conquer(game.ref(10, 10));
    for (let x = 100; x < 107; x++)
      defender.conquer(game.ref(x, 100));
    attacker.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});
    const dome = defender.buildUnit(UnitType.IronDome, game.ref(100, 100), {});
    const city = defender.buildUnit(UnitType.City, game.ref(101, 100), {});
    const warheads: NukeExecution[] = [];
    for (let x = 102; x < 107; x++) {
      const warhead = new NukeExecution(
        UnitType.MIRVWarhead, attacker, game.ref(x, 100), game.ref(10, 10),
      );
      warheads.push(warhead);
      game.addExecution(warhead);
    }
    executeTicks(game, 300);
    expect(warheads.every((w) => w.getNuke()?.isActive() === false)).toBe(true);
    expect(dome.isActive()).toBe(true);
    expect(city.isActive()).toBe(true);
    expect(game.owner(game.ref(102, 100))).toBe(defender);
  });

  it("protects owner tiles from blast fringes without ammunition or cooldown", async () => {
    const game = await setup(
      "big_plains", { geopolitics: true, infiniteGold: false, instantBuild: true },
      [human("a"), human("b")],
    );
    const a = game.player("a");
    const b = game.player("b");
    const origin = game.ref(30, 30);
    a.conquer(origin);
    a.addGold(12_000_000n);
    const dome = a.buildUnit(UnitType.IronDome, origin, {});
    expect(protectedByIronDome(game, game.ref(40, 30), a)).toBe(true);
    const field = createBlastIronDomeCoverage(game);
    // Identical protection on every tile, even during a fringe blast.
    expect(field(game.ref(40, 30), a)).toBe(true);
    expect(field(game.ref(40, 30), b)).toBe(false);
    expect(field(game.ref(115, 30), a)).toBe(false);
    expect(protectedByIronDome(game, game.ref(40, 30), b)).toBe(false);
    expect(dome.isInCooldown()).toBe(false);
    dome.setUnderConstruction(true);
    expect(protectedByIronDome(game, game.ref(40, 30), a)).toBe(false);
    dome.setUnderConstruction(false);
    expect(protectedByIronDome(game, game.ref(40, 30), a)).toBe(true);
    dome.setOwner(b);
    expect(protectedByIronDome(game, game.ref(40, 30), a)).toBe(false);
    expect(protectedByIronDome(game, game.ref(40, 30), b)).toBe(true);
  });
});
