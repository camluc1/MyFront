import {
  GameType,
  PlayerType,
  type NationObjectiveInfo,
} from "@openfront/engine-api/game/GameTypes";
import { render } from "lit";
import { FrontierWorldIntelligence } from "../../src/client/hud/layers/FrontierWorldIntelligence";
import type { GameView } from "../../src/client/view";
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
const objective: NationObjectiveInfo = {
  kind: "capture",
  targetSmallID: 4,
  tile: 10,
  startedTick: 10,
  expiresTick: 1810,
};
function makeGame(profile = vi.fn().mockResolvedValue({ objective })) {
  return {
    config: () => ({ gameConfig: () => ({ gameType: GameType.Singleplayer }) }),
    ticks: () => 100,
    playerViews: () => [
      {
        smallID: () => 3,
        type: () => PlayerType.Nation,
        displayName: () => "Country A",
        profile,
      },
      {
        smallID: () => 4,
        type: () => PlayerType.Nation,
        displayName: () => "Country B",
      },
    ],
  } as unknown as GameView;
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
test("reads the actual engine plan and renders it with its target", async () => {
  const panel = new FrontierWorldIntelligence();
  const profile = vi.fn().mockResolvedValue({ objective });
  panel.game = makeGame(profile);
  panel["open"] = true;
  panel["selectedSmallID"] = 3;
  panel["refreshObjective"]();
  await flush();
  expect(panel["nationObjective"]).toEqual({ smallID: 3, value: objective });
  const container = document.createElement("div");
  render(panel["renderObjective"](), container);
  expect(container.textContent).toContain("nation_objective.capture");
  expect(container.textContent).toContain("Country B");
  panel["refreshObjective"]();
  expect(profile).toHaveBeenCalledTimes(1);
});
test("a closed dashboard does not query the engine", () => {
  const panel = new FrontierWorldIntelligence();
  const profile = vi.fn();
  panel.game = makeGame(profile);
  panel["selectedSmallID"] = 3;
  panel["refreshObjective"]();
  expect(profile).not.toHaveBeenCalled();
});
test("changing games ignores an old response and lets the new request finish", async () => {
  let finish!: (p: { objective: NationObjectiveInfo }) => void;
  const old = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const panel = new FrontierWorldIntelligence();
  panel.game = makeGame(old);
  panel["open"] = true;
  panel["selectedSmallID"] = 3;
  panel["refreshObjective"]();
  panel.game = makeGame(
    vi.fn().mockResolvedValue({ objective: { ...objective, kind: "develop" } }),
  );
  panel["open"] = true;
  panel["selectedSmallID"] = 3;
  panel["refreshObjective"]();
  await flush();
  finish({ objective });
  await flush();
  expect(panel["nationObjective"]?.value?.kind).toBe("develop");
  expect(panel["objectivePending"]).toBe(false);
});
test("a delayed result for a previous selection is not displayed on another country", async () => {
  const panel = new FrontierWorldIntelligence();
  panel.game = makeGame();
  panel["open"] = true;
  panel["selectedSmallID"] = 3;
  panel["refreshObjective"]();
  await flush();
  panel["selectedSmallID"] = 4;
  const container = document.createElement("div");
  render(panel["renderObjective"](), container);
  expect(container.textContent).toBe("");
});
test("an idle nation is shown as assessing opportunities", async () => {
  const panel = new FrontierWorldIntelligence();
  panel.game = makeGame(vi.fn().mockResolvedValue({}));
  panel["open"] = true;
  panel["selectedSmallID"] = 3;
  panel["refreshObjective"]();
  await flush();
  const container = document.createElement("div");
  render(panel["renderObjective"](), container);
  expect(container.textContent).toContain("nation_objective.none");
});
