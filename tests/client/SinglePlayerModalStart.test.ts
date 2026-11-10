import {
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
  prewarmCosmetics: vi.fn(async () => {}),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    requestMidgameAd: vi.fn(async () => {}),
  },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: vi.fn(() => ({ manifest: async () => ({ nations: [] }) })),
  },
}));

// Side-effect import so the custom element registers (a type-only import
// would be elided and createElement would return an inert element).
import "../../src/client/SinglePlayerModal";

function createModal(): any {
  return document.createElement("single-player-modal") as any;
}

describe("SinglePlayerModal start", () => {
  it("carries the selected team count and validated disabled units into the join-lobby config", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    // Selection arrives via the game-config-settings child event.
    modal.handleConfigTeamCountSelected(
      new CustomEvent("team-count-selected", { detail: { count: 4 } }),
    );
    // One real unit and one junk entry: the start path must keep only
    // values that are actual UnitTypes.
    modal.disabledUnits = [UnitType.Warship, "Bogus"];

    await modal.startGame();

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("singleplayer");
    const config = events[0].gameStartInfo.config;
    expect(config.playerTeams).toBe(4);
    expect(config.disabledUnits).toEqual([UnitType.Warship]);
  });
});

describe("SinglePlayerModal map shortcuts", () => {
  it("uses the same map-selection handler for a shortcut and ignores invalid maps", () => {
    const modal = createModal();
    modal.onOpen({ map: GameMapType.Europe });
    expect(modal.selectedMap).toBe(GameMapType.Europe);
    expect(modal.useRandomMap).toBe(false);
    modal.onOpen({ map: "missing-map" });
    expect(modal.selectedMap).toBe(GameMapType.Europe);
  });
});

describe("Geopolitics launch", () => {
  it("launches the offline ruleset and ignores incompatible Classic settings", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );
    modal.gameMode = GameMode.Team;
    modal.customAlliances = true;
    modal.customAllianceMinutes = 0;
    modal.maxTimer = true;
    modal.maxTimerValue = undefined;
    modal.onOpen({ geopolitics: true });
    await modal.startGame();
    expect(events).toHaveLength(1);
    const c = events[0].gameStartInfo.config;
    expect(c.geopolitics).toBe(true);
    expect(c.geopoliticsFunctional).toBe(false);
    expect(Number.isInteger(c.geopoliticsSeed)).toBe(true);
    expect(c.gameType).toBe(GameType.Singleplayer);
    expect(c.gameMode).toBe(GameMode.FFA);
    expect(c.customAllianceDuration).toBeUndefined();
    expect(c.maxTimerValue).toBeUndefined();
    expect(c.donateGold).toBe(true);
    modal.onOpen({});
    expect(modal.geopolitics).toBe(false);
  });
});
