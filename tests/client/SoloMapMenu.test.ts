import { GameMapType, listedMaps } from "@openfront/engine-api/game/GameTypes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: (map: string) => ({ webpPath: `/maps/${map}.webp` }),
  },
}));
import "../../src/client/components/SoloMapMenu";
import type { SoloMapMenu } from "../../src/client/components/SoloMapMenu";

describe("solo map shortcuts", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => document.body.replaceChildren());
  async function mount() {
    const menu = document.createElement("solo-map-menu") as SoloMapMenu;
    document.body.append(menu);
    await menu.updateComplete;
    return menu;
  }
  it("opens solo configuration with the clicked map instead of joining a lobby", async () => {
    const menu = await mount();
    const selected = vi.fn();
    const join = vi.fn();
    menu.addEventListener("solo-map-selected", selected);
    menu.addEventListener("join-lobby", join);
    const map = listedMaps.find((map) => map.type === GameMapType.World)!;
    menu
      .querySelector<HTMLButtonElement>(
        `button[aria-label="${map.translationKey} · main.solo"]`,
      )!
      .click();
    expect(selected).toHaveBeenCalledOnce();
    expect((selected.mock.calls[0][0] as CustomEvent).detail.map).toBe(
      GameMapType.World,
    );
    expect(join).not.toHaveBeenCalled();
    expect(menu.textContent).not.toContain("Starting");
  });
  it("persists favorites and exposes shortcuts after reopening", async () => {
    let menu = await mount();
    menu
      .querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!
      .click();
    await menu.updateComplete;
    expect(menu.textContent).toContain("Mapas favoritos");
    expect(JSON.parse(localStorage.getItem("map-favorites")!)).toHaveLength(1);
    menu.remove();
    menu = await mount();
    expect(menu.textContent).toContain("Mapas favoritos");
    menu
      .querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!
      .click();
    await menu.updateComplete;
    expect(menu.textContent).not.toContain("Mapas favoritos");
  });
});
