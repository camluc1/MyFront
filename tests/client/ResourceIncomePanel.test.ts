import { GameType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { FrontierWorldIntelligence } from "../../src/client/hud/layers/FrontierWorldIntelligence";
import type { GameView } from "../../src/client/view";
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
test("queries resource capacity by building and shows it separately from actual income", async () => {
  const buildables = vi
    .fn()
    .mockResolvedValue(
      [UnitType.Farm, UnitType.Mine, UnitType.OilWell, UnitType.GasPlant].map(
        (type, i) => ({ type, resourceIncomePerMinute: (i + 1) * 6000 }),
      ),
    );
  const game = {
    config: () => ({ gameConfig: () => ({ gameType: GameType.Singleplayer }) }),
    ticks: () => 100,
    playerViews: () => [{ smallID: () => 3, buildables }],
  } as unknown as GameView;
  const panel = new FrontierWorldIntelligence();
  panel.game = game;
  panel["open"] = true;
  panel["tab"] = "economy";
  panel["selectedSmallID"] = 3;
  panel["refreshResourceEconomy"]();
  await Promise.resolve();
  await Promise.resolve();
  expect(buildables).toHaveBeenCalledWith(undefined, [
    UnitType.Farm,
    UnitType.Mine,
    UnitType.OilWell,
    UnitType.GasPlant,
  ]);
  expect(panel["resourceEconomy"]).toEqual({
    smallID: 3,
    values: [6000, 12000, 18000, 24000],
  });
  panel["refreshResourceEconomy"]();
  expect(buildables).toHaveBeenCalledTimes(1);
});
test("does not load economic queries when the dashboard is closed", () => {
  const panel = new FrontierWorldIntelligence();
  expect(() => panel["refreshResourceEconomy"]()).not.toThrow();
  expect(panel["resourceEconomy"]).toBeNull();
});
