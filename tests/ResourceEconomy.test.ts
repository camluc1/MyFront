import {
  GameMapType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { resourceDeposits } from "@openfront/engine-lib/game/NaturalResources";
import { resourceProduction } from "@openfront/engine-lib/game/ResourceProduction";
import { NaturalResourceExecution } from "@openfront/engine/execution/NaturalResourceExecution";
import { resourceRailMultiplier } from "@openfront/engine/game/ResourceEconomy";
import { setup } from "./util/Setup";

async function economyGame() {
  const game = await setup(
    "big_plains",
    { gameMap: GameMapType.Asia, instantBuild: true, startingGold: 10000000 },
    [new PlayerInfo("owner", PlayerType.Human, null, "owner")],
  );
  const owner = game.player("owner");
  game.map().forEachTile((tile) => {
    if (game.isLand(tile)) owner.conquer(tile);
  });
  owner.addGold(10000000n);
  return { game, owner, sites: resourceDeposits(game.map(), GameMapType.Asia) };
}
describe("Resource economics from the simulation", () => {
  test("matches the actual payout and next upgrade without consuming reserves", async () => {
    const { game, owner, sites } = await economyGame();
    const site = sites.find(
      (s) =>
        s.resource !== "fertile_soil" &&
        s.resource !== "oil" &&
        s.resource !== "gas",
    )!;
    const tile = game.ref(site.x, site.y);
    const unit = owner.buildUnit(UnitType.Mine, tile, {});
    const before = game.resourceRemaining(site.id, site.capacity);
    const info = owner.buildableUnits(tile, [UnitType.Mine])[0]
      .resourceEconomy!;
    expect(info.resource).toBe(site.resource);
    expect(info.quality).toBe(site.quality);
    expect(info.remainingCycles).toBe(before);
    expect(info.railway).toBe("inactive");
    expect(info.nextPerCycle).toBe(
      resourceProduction(site.resource, site.quality, 2, 1, 1),
    );
    expect(info.upgradeGainPerCycle).toBe(
      info.nextPerCycle - info.currentPerCycle,
    );
    expect(game.resourceRemaining(site.id, site.capacity)).toBe(before);
    const execution = new NaturalResourceExecution(unit);
    execution.init(game, 0);
    const gold = owner.gold();
    execution.tick(unit.id() % 100);
    expect(Number(owner.gold() - gold)).toBe(info.currentPerCycle);
    expect(game.resourceRemaining(site.id, site.capacity)).toBe(before - 1);
    expect(
      owner.buildableUnits(null, [UnitType.Mine])[0].resourceIncomePerMinute,
    ).toBe(info.currentPerCycle * 6);
    for (let i = 1; i < site.capacity; i++)
      game.consumeResource(site.id, site.capacity);
    const depleted = owner.buildableUnits(tile, [UnitType.Mine])[0]
      .resourceEconomy!;
    expect(depleted.reason).toBe("exhausted");
    expect(depleted.currentPerCycle).toBe(0);
    expect(depleted.nextPerCycle).toBe(0);
  });
  test("explains wrong resources and lack of funds", async () => {
    const { game, owner, sites } = await economyGame();
    const site = sites.find((s) => s.resource === "fertile_soil")!;
    const tile = game.ref(site.x, site.y);
    expect(
      owner.buildableUnits(tile, [UnitType.OilWell])[0].resourceEconomy?.reason,
    ).toBe("wrong_resource");
    owner.removeGold(owner.gold());
    const info = owner.buildableUnits(tile, [UnitType.Farm])[0]
      .resourceEconomy!;
    expect(info.reason).toBe("money");
    expect(info.renewable).toBe(true);
    expect(info.remainingCycles).toBeNull();
  });
  test("uses the existing railway bonus and caps production upgrades at 50", () => {
    expect(resourceProduction("gold", 4, 1, 1.4, 2)).toBe(
      Math.floor(19000 * 1.75 * 1.4 * 2),
    );
    expect(resourceProduction("gold", 4, 60, 1.4, 2)).toBe(
      resourceProduction("gold", 4, 50, 1.4, 2),
    );
  });
  test("only grants the rail bonus for a connected same-owner factory", async () => {
    const { game, owner, sites } = await economyGame();
    const site = sites.find(
      (s) =>
        s.resource === "gold" || s.resource === "iron" || s.resource === "coal",
    )!;
    const mine = owner.buildUnit(UnitType.Mine, game.ref(site.x, site.y), {});
    const factory = owner.buildUnit(UnitType.Factory, game.ref(1, 1), {});
    const manager = game.railNetwork().stationManager();
    const connected = {
      getCluster: () => ({
        stations: new Set([{ isActive: () => true, unit: factory }]),
      }),
    };
    vi.spyOn(manager, "findStation").mockReturnValue(
      connected as unknown as ReturnType<typeof manager.findStation>,
    );
    expect(resourceRailMultiplier(game, mine)).toBe(1.4);
    vi.spyOn(factory, "owner").mockReturnValue(
      {} as ReturnType<typeof factory.owner>,
    );
    expect(resourceRailMultiplier(game, mine)).toBe(1);
  });
});
