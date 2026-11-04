import {
  Difficulty,
  GameMapType,
  PlayerInfo,
  PlayerType,
  UnitType,
  maxBulkAmount,
} from "@openfront/engine-api/game/GameTypes";
import {
  resourceAt,
  resourceDeposits,
} from "@openfront/engine-lib/game/NaturalResources";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { setup } from "./util/Setup";

async function investmentGame() {
  const game = await setup(
    "big_plains",
    {
      gameMap: GameMapType.World,
      difficulty: Difficulty.Impossible,
      instantBuild: true,
    },
    [new PlayerInfo("nation", PlayerType.Nation, null, "nation")],
  );
  const player = game.player("nation");
  game.map().forEachTile((tile) => {
    if (game.isLand(tile)) player.conquer(tile);
  });
  player.addGold(1000000000n);
  const sites = resourceDeposits(game.map(), GameMapType.World);
  const mineral = sites.find(
    (s) => !["fertile_soil", "oil", "gas"].includes(s.resource),
  )!;
  return { game, player, sites, mineral };
}

describe("Resource investment rules", () => {
  test("AI replaces an exhausted extractor instead of counting it against productive capacity", async () => {
    const { game, player, sites, mineral } = await investmentGame();
    player.buildUnit(UnitType.Mine, game.ref(mineral.x, mineral.y), {});
    for (let i = 0; i < mineral.capacity; i++)
      game.consumeResource(mineral.id, mineral.capacity);
    const available = sites.filter(
      (s) =>
        s.id !== mineral.id &&
        player.canBuild(
          s.resource === "fertile_soil"
            ? UnitType.Farm
            : s.resource === "oil"
              ? UnitType.OilWell
              : s.resource === "gas"
                ? UnitType.GasPlant
                : UnitType.Mine,
          game.ref(s.x, s.y),
        ) !== false,
    );
    expect(available.length).toBeGreaterThan(0);
    const random = new PseudoRandom(42);
    vi.spyOn(random, "nextInt").mockReturnValue(0);
    const behavior = new NationStructureBehavior(random, game, player);
    const added = vi.spyOn(game, "addExecution");
    expect(behavior["maybeDevelopNaturalResources"]()).toBe(true);
    expect(
      added.mock.calls.some(
        ([execution]) => execution instanceof ConstructionExecution,
      ),
    ).toBe(true);
  });
  test("keeps productive extractors in the quota and upgrades them", async () => {
    const { game, player, mineral } = await investmentGame();
    const unit = player.buildUnit(
      UnitType.Mine,
      game.ref(mineral.x, mineral.y),
      {},
    );
    const random = new PseudoRandom(42);
    vi.spyOn(random, "nextInt").mockReturnValue(0);
    const added = vi.spyOn(game, "addExecution");
    expect(
      new NationStructureBehavior(random, game, player)[
        "maybeDevelopNaturalResources"
      ](),
    ).toBe(true);
    expect(
      added.mock.calls.some(
        ([e]) =>
          e instanceof UpgradeStructureExecution && e["unitId"] === unit.id(),
      ),
    ).toBe(true);
  });
  test("searches past the nearest land tile to find compatible gas with valid spacing", async () => {
    const { game, player, sites } = await investmentGame();
    const gas = sites.find(
      (s) => s.resource === "gas" && s.x + s.radius + 2 < game.width(),
    )!;
    const target = game.ref(gas.x + gas.radius + 1, gas.y);
    expect(
      resourceAt(game.map(), GameMapType.World, target)?.resource,
    ).not.toBe("gas");
    const placement = player.canBuild(UnitType.GasPlant, target);
    expect(placement).not.toBe(false);
    if (placement === false) throw new Error("expected a valid gas site");
    expect(game.owner(placement)).toBe(player);
    expect(resourceAt(game.map(), GameMapType.World, placement)?.resource).toBe(
      "gas",
    );
    expect(game.euclideanDistSquared(target, placement)).toBeLessThan(15 ** 2);
  });
  test("rejects exhausted upgrades in preview, execution and direct calls without charging gold", async () => {
    const { game, player, mineral } = await investmentGame();
    const tile = game.ref(mineral.x, mineral.y);
    const unit = player.buildUnit(UnitType.Mine, tile, {});
    for (let i = 0; i < mineral.capacity; i++)
      game.consumeResource(mineral.id, mineral.capacity);
    expect(player.canUpgradeUnit(unit)).toBe(false);
    const preview = player.buildableUnits(tile, [UnitType.Mine])[0];
    expect(preview.canUpgrade).toBe(false);
    expect(preview.resourceEconomy?.reason).toBe("exhausted");
    const gold = player.gold();
    player.upgradeUnit(unit);
    new UpgradeStructureExecution(player, unit.id(), 10).init(
      game,
      game.ticks(),
    );
    expect(unit.level()).toBe(1);
    expect(player.gold()).toBe(gold);
  });
  test("caps a bulk resource upgrade at 50 and charges only productive levels", async () => {
    const { game, player, mineral } = await investmentGame();
    const tile = game.ref(mineral.x, mineral.y);
    const unit = player.buildUnit(UnitType.Mine, tile, {});
    while (unit.level() < 48) unit.increaseLevel();
    const preview = player.buildableUnits(tile, [UnitType.Mine])[0];
    expect(preview.upgradeCosts).toHaveLength(2);
    expect(maxBulkAmount(preview, player.gold())).toBe(2);
    expect(preview.resourceEconomy!.upgradeGainPerCycle).toBeGreaterThan(0);
    const gold = player.gold();
    new UpgradeStructureExecution(player, unit.id(), 10).init(
      game,
      game.ticks(),
    );
    expect(unit.level()).toBe(50);
    expect(gold - player.gold()).toBe(preview.upgradeCosts![1]);
    const capped = player.buildableUnits(tile, [UnitType.Mine])[0];
    expect(capped.canUpgrade).toBe(false);
    expect(capped.resourceEconomy?.reason).toBe("max_level");
    expect(capped.resourceEconomy?.upgradeGainPerCycle).toBe(0);
    player.upgradeUnit(unit);
    expect(unit.level()).toBe(50);
  });
  test("renewable farms also stop at the productive maximum; original cities retain their upgrade rules", async () => {
    const { game, player, sites } = await investmentGame();
    const soil = sites.find((s) => s.resource === "fertile_soil")!;
    const farm = player.buildUnit(UnitType.Farm, game.ref(soil.x, soil.y), {});
    while (farm.level() < 50) farm.increaseLevel();
    expect(player.canUpgradeUnit(farm)).toBe(false);
    const city = player.buildUnit(UnitType.City, game.ref(0, 0), {});
    while (city.level() < 50) city.increaseLevel();
    expect(player.canUpgradeUnit(city)).toBe(true);
    player.upgradeUnit(city);
    expect(city.level()).toBe(51);
  });
});
