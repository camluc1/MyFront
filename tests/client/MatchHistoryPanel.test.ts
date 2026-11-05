import { GameType } from "@openfront/engine-api/game/GameTypes";
import type {
  MatchHistory,
  HistoryRow,
} from "@openfront/engine-api/game/MatchHistory";
import "../../src/client/hud/layers/MatchHistoryPanel";
import type { MatchHistoryPanel } from "../../src/client/hud/layers/MatchHistoryPanel";
const row = (id: number, tiles: number): HistoryRow => [
  id,
  tiles,
  5,
  2,
  50,
  100,
  100,
  1,
  3,
  0,
  0,
  0,
  0,
];
const history: MatchHistory = {
  version: 1,
  startTick: 0,
  endTick: 600,
  players: [
    { id: 1, name: "You", kind: "human" },
    { id: 2, name: "Rival", kind: "nation" },
  ],
  samples: [
    { tick: 0, rows: [row(1, 100), row(2, 200)] },
    { tick: 600, rows: [row(1, 300), row(2, 0)] },
  ],
};
function mount(data: MatchHistory = history) {
  const panel = document.createElement(
    "match-history-panel",
  ) as MatchHistoryPanel;
  const query = vi.fn().mockResolvedValue(structuredClone(data));
  panel.game = {
    config: () => ({ gameConfig: () => ({ gameType: GameType.Singleplayer }) }),
    myPlayer: () => ({ smallID: () => 1 }),
    worker: { matchHistory: query },
  } as any;
  document.body.append(panel);
  return { panel, query };
}
test("live and final panel use the same frozen history, retain eliminated countries and share SVG axes", async () => {
  const { panel, query } = mount();
  try {
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-match-history]")).not.toBeNull(),
    );
    expect(panel.textContent).toContain("Rival · eliminado");
    expect(panel.textContent).toContain("RESULTADO FINAL");
    panel.selected = [1, 2];
    panel.summary = true;
    await panel.updateComplete;
    expect(panel.querySelectorAll("polyline")).toHaveLength(2);
    expect(panel.querySelector("polyline")?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
    expect(panel.textContent).toContain("RESUMEN DE LA PARTIDA");
    await panel.refresh();
    expect(query).toHaveBeenCalledTimes(1);
    panel.cursor = 0;
    await panel.updateComplete;
    expect(panel.textContent?.replace(/\s+/g, " ")).toContain("You: 100");
  } finally {
    panel.remove();
  }
});
test("old saves explicitly label partial history", async () => {
  const { panel } = mount({ ...history, startTick: 900 });
  try {
    await vi.waitFor(() =>
      expect(panel.textContent).toContain("Registro parcial"),
    );
  } finally {
    panel.remove();
  }
});
test("late responses cannot install a different game's history", async () => {
  const { panel } = mount();
  try {
    await vi.waitFor(() => expect(panel.history).not.toBeNull());
    panel.history = null;
    let complete: (h: MatchHistory) => void = () => {};
    panel.game!.worker.matchHistory = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => (complete = resolve)));
    const work = panel.refresh();
    panel.remove();
    complete(history);
    await work;
    expect(panel.history).toBeNull();
  } finally {
    panel.remove();
  }
});

test("compares eight countries without evicting selections and toggles curves", async () => {
  const data: MatchHistory = {
    ...history,
    players: Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `Country ${i + 1}`,
      kind: "nation",
    })),
    samples: [
      {
        tick: 0,
        rows: Array.from({ length: 10 }, (_, i) => row(i + 1, (i + 1) * 100)),
      },
    ],
  };
  const { panel } = mount(data);
  try {
    await vi.waitFor(() => expect(panel.history).not.toBeNull());
    for (let id = 2; id <= 9; id++) panel["choose"](id);
    expect(panel.selected).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    await panel.updateComplete;
    expect(panel.querySelectorAll("polyline")).toHaveLength(8);
    expect(
      new Set(
        Array.from(panel.querySelectorAll("polyline")).map((p) =>
          p.getAttribute("stroke"),
        ),
      ).size,
    ).toBe(8);
    panel["choose"](4);
    panel["choose"](9);
    expect(panel.selected).toEqual([1, 2, 3, 5, 6, 7, 8, 9]);
    panel["selectLeaders"]();
    expect(panel.selected).toEqual([1, 10, 9, 8, 7, 6]);
  } finally {
    panel.remove();
  }
});

test("compares source totals without counting extraction twice and ranks eliminated nations", async () => {
  const data = structuredClone(history);
  data.samples[1].sources = { "1": [100, 0, 50, 0, 0, 0, 0, 20, 10, 0, 0] };
  data.eliminations = [{ id: 2, tick: 550, killer: 1 }];
  const { panel } = mount(data);
  try {
    await vi.waitFor(() =>
      expect(panel.textContent).toContain("Origen del oro"),
    );
    expect(panel.textContent).toContain("150");
    expect(panel.textContent).toContain("Agricultura");
    expect(panel.textContent).toContain("2 / 2");
    expect(panel.textContent).toContain("0:55");
    const old = panel.querySelector("polyline")?.getAttribute("stroke");
    panel.selected = [2, 1];
    await panel.updateComplete;
    expect(panel.querySelectorAll("polyline")[1].getAttribute("stroke")).toBe(
      old,
    );
    (panel as any).zoomPeriod(0.5);
    expect(panel.to - panel.from).toBeGreaterThan(0);
  } finally {
    panel.remove();
  }
});
