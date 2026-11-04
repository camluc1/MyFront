import type {
  BuildableUnit,
  ResourceEconomyInfo,
} from "@openfront/engine-api/game/GameTypes";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { BuildPreviewController } from "../../src/client/controllers/BuildPreviewController";
import type { UIState } from "../../src/client/UIState";
import type { PlayerView } from "../../src/client/view";

test("resource bulk preview uses and quotes only the remaining productive upgrades", () => {
  const controller = Object.create(
    BuildPreviewController.prototype,
  ) as BuildPreviewController;
  controller["uiState"] = { upgradeMultiplier: 10 } as UIState;
  const unit: BuildableUnit = {
    type: UnitType.Mine,
    canBuild: false,
    canUpgrade: 7,
    cost: 100n,
    upgradeCosts: [100n, 250n],
    overlappingRailroads: [],
    ghostRailPaths: [],
    resourceEconomy: { level: 48 } as ResourceEconomyInfo,
  };
  expect(controller["selectedUpgradeAmount"](unit)).toBe(2);
  const quote = controller["resolveGhostAffordability"](
    { gold: () => 1000n } as PlayerView,
    unit,
  );
  expect(quote).toEqual({ cost: 250, multiplier: 2, canAfford: true });
  expect(
    controller["selectedUpgradeAmount"]({
      ...unit,
      type: UnitType.City,
      resourceEconomy: undefined,
    }),
  ).toBe(10);
});
