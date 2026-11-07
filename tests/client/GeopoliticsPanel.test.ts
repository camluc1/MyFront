import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  emptyAssets,
  DiplomacyAction,
} from "@openfront/engine-api/Geopolitics";
import { Game } from "@openfront/engine/game/Game";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  GeopoliticsPanel,
  transferRuns,
  mountGeopolitics,
} from "../../src/client/hud/GeopoliticsPanel";
import type { TransformHandler } from "../../src/client/TransformHandler";
import { SendDiplomacyIntentEvent } from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";
import { setup } from "../util/Setup";
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
let game: Game, panel: GeopoliticsPanel, dispose: () => void;
let sent: DiplomacyAction[];
const text = (name: string) => `geopolitics.${name}`;
const click = async (name: string) => {
  const b = [...panel.shadowRoot!.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text(name)),
  );
  expect(b, `button ${name}`).toBeTruthy();
  b!.click();
  await panel.updateComplete;
};
beforeEach(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  game = await setup(
    "plains",
    { geopolitics: true, instantBuild: true },
    ["a", "b", "c"].map(
      (id) => new PlayerInfo(id, PlayerType.Human, id.padEnd(8, "0"), id),
    ),
  );
  for (let i = 0; i < 3; i++) {
    const p = game.player(["a", "b", "c"][i]);
    for (let x = 0; x < 10; x++) p.conquer(game.ref(x, i));
    p.addGold(1000000n);
    p.addTroops(10000);
  }
  const facade = Object.assign(game, {
    myPlayer: () => game.player("a"),
    diplomacy: game.diplomacy,
  });
  // The UI consumes the worker's plain diplomatic snapshot, while the fixture's engine owns its mutations.
  const view = new Proxy(facade, {
    get(target, key) {
      if (key === "diplomacy") return game.diplomacy.state;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as GameView;
  const bus = new EventBus();
  sent = [];
  bus.on(SendDiplomacyIntentEvent, (e) => sent.push(e.diplomacy));
  dispose = mountGeopolitics(view, bus, {
    worldToScreenCoordinates: (c: { x: number; y: number }) => c,
  } as unknown as TransformHandler);
  panel = document.querySelector("geopolitics-panel")! as GeopoliticsPanel;
  await panel.updateComplete;
});
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
it("opens negotiations, selects actual building tiles and emits the exact preview", async () => {
  const b = game.player("b");
  const city = b.buildUnit(UnitType.City, game.ref(2, 1), {});
  await click("title");
  await click("negotiate");
  const inputs = [
    ...panel.shadowRoot!.querySelectorAll<HTMLInputElement>(
      ".receive .buildings input",
    ),
  ];
  expect(inputs).toHaveLength(1);
  inputs[0].click();
  await panel.updateComplete;
  const gold = panel.shadowRoot!.querySelector<HTMLInputElement>(
    ".give input[type=number]",
  )!;
  gold.value = "120";
  gold.dispatchEvent(new Event("change"));
  await panel.updateComplete;
  await click("send");
  expect(sent).toHaveLength(1);
  const action = sent[0];
  expect(action.action).toBe("offer");
  expect(action.give?.gold).toBe(120);
  expect(action.receive?.buildings).toEqual([city.id()]);
  expect(action.receive?.tiles).toContain(city.tile());
  expect(action.receive?.tiles.every((t) => game.owner(t) === b)).toBe(true);
});
it("shows an incoming offer, then accepts it without changing its terms", async () => {
  game.diplomacy.act(game.player("b"), {
    action: "offer",
    target: "a",
    kind: "peace",
    give: emptyAssets(),
    receive: { ...emptyAssets(), gold: 20 },
  });
  panel.requestUpdate();
  await panel.updateComplete;
  const alert = [...panel.shadowRoot!.querySelectorAll("aside button")].find(
    (b) => b.textContent?.includes("geopolitics.peace"),
  ) as HTMLButtonElement;
  expect(alert).toBeTruthy();
  alert.click();
  await panel.updateComplete;
  await click("accept");
  expect(sent[0]).toEqual({ action: "accept", target: "b", offerID: 1 });
});
it("makes a counteroffer by swapping the two sides", async () => {
  game.diplomacy.act(game.player("b"), {
    action: "offer",
    target: "a",
    kind: "peace",
    give: { ...emptyAssets(), troops: 50 },
    receive: { ...emptyAssets(), gold: 20 },
  });
  panel.requestUpdate();
  await panel.updateComplete;
  (
    [...panel.shadowRoot!.querySelectorAll("aside button")].find((b) =>
      b.textContent?.includes("geopolitics.peace"),
    ) as HTMLButtonElement
  ).click();
  await panel.updateComplete;
  await click("counter");
  await click("send");
  expect(sent[0].counterTo).toBe(1);
  expect(sent[0].give?.gold).toBe(20);
  expect(sent[0].receive?.troops).toBe(50);
});
it("shows a victory countdown and releases its overlay on disposal", async () => {
  game.diplomacy.state.victory = {
    members: ["a", "b"],
    since: 0,
    remaining: 42,
    share: 920,
  };
  panel.requestUpdate();
  await panel.updateComplete;
  expect(panel.shadowRoot!.textContent).toContain("42s");
  expect(panel.shadowRoot!.textContent).toContain("92%");
  expect(document.querySelectorAll("canvas")).toHaveLength(1);
  dispose();
  expect(document.querySelectorAll("canvas")).toHaveLength(0);
});

it("compresses exact transfer highlights without filling gaps or isolated enclaves", () => {
  const tiles = [
    game.ref(1, 1),
    game.ref(2, 1),
    game.ref(4, 1),
    game.ref(9, 2),
  ];
  const runs = transferRuns(tiles, game);
  const painted = runs.flatMap((r) =>
    Array.from({ length: r.width }, (_, i) => game.ref(r.x + i, r.y)),
  );
  expect(painted.sort((a, b) => a - b)).toEqual(
    [...tiles].sort((a, b) => a - b),
  );
  expect(runs.length).toBe(3);
});

it("lists infrastructure by level and exposes the selected territorial impact", async () => {
  const b = game.player("b");
  const first = b.buildUnit(UnitType.City, game.ref(2, 1), {});
  const second = b.buildUnit(UnitType.Port, game.ref(8, 1), {});
  second.increaseLevel();
  await click("title");
  await click("negotiate");
  const rows = [
    ...panel.shadowRoot!.querySelectorAll(".receive .buildings > .building"),
  ];
  expect(rows[0].textContent).toContain("geopolitics.level 2");
  (rows[0].querySelector("input") as HTMLInputElement).click();
  await panel.updateComplete;
  expect(panel.shadowRoot!.textContent).toContain(
    "geopolitics.territory_impact",
  );
  expect(
    panel.shadowRoot!.querySelectorAll(
      'button[aria-label="geopolitics.locate"]',
    ).length,
  ).toBeGreaterThan(0);
  expect(first.level()).toBe(1);
});

it("prepares a port purchase without choosing territory on the player's behalf", async () => {
  const b = game.player("b");
  b.buildUnit(UnitType.Port, game.ref(8, 1), {});
  await click("title");
  await click("negotiate");
  await click("approach_infrastructure");
  const gold = panel.shadowRoot!.querySelector<HTMLInputElement>(
    ".give input[type=number]",
  )!;
  expect(Number(gold.value)).toBe(
    Math.floor(Number(game.player("a").gold()) / 10),
  );
  expect(
    panel.shadowRoot!.querySelector<HTMLInputElement>(
      ".receive .buildings input",
    )!.checked,
  ).toBe(false);
});
