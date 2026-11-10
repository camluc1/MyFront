import { describe, expect, it, afterEach } from "vitest";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import "../../src/client/hud/layers/UnitDisplay";
import type { UnitDisplay } from "../../src/client/hud/layers/UnitDisplay";
import type { GameView } from "../../src/client/view";

afterEach(() => {
  document.body.innerHTML = "";
});

function mountHUD(options: { disabled?: UnitType[]; geopolitics?: boolean; functional?: boolean; tutorial?: boolean } = {}) {
  const player = {
    isAlive: () => true,
    gold: () => 50_000_000n,
    units: (_type: UnitType) => [],
    totalUnitLevels: (_type: UnitType) => 0,
  };
  const game = {
    myPlayer: () => player,
    inSpawnPhase: () => false,
    config: () => ({
      // Production hides experimental units outside the *explicit* functional switch.
      isUnitDisabled: (unit: UnitType) => (
        (options.disabled?.includes(unit) ?? false) ||
        (!options.functional || !options.geopolitics) && [
          UnitType.TsarBomba, UnitType.Bismarck, UnitType.Airfield,
          UnitType.AttackAircraft, UnitType.BomberAircraft,
          UnitType.FighterAircraft,
        ].includes(unit)
      ),
      isFunctionalGeopolitics: () => !!(options.functional && options.geopolitics),
      gameConfig: () => ({
        geopolitics: options.geopolitics ?? false,
        tutorial: options.tutorial ?? false,
        infiniteGold: false,
      }),
    }),
  } as unknown as GameView;
  const hud = document.createElement("unit-display") as UnitDisplay;
  hud.game = game;
  hud.uiState = {
    ghostStructure: null, supportShipMode: false,
    preventStacking: false, upgradeMultiplier: 1,
  } as any;
  document.body.appendChild(hud);
  return hud;
}

describe("Frontier bottom HUD categories", () => {
  it("keeps construction in one scroll row and nuclear actions separate", async () => {
    const hud = mountHUD();
    await hud.updateComplete;
    const row = hud.querySelector(".unit-display-scroll > .unit-display-grid");
    expect(row).not.toBeNull();
    expect(row?.querySelectorAll(":scope > div")).toHaveLength(6);
    expect(hud.querySelectorAll(".unit-display-arsenal .unit-display-grid > div")).toHaveLength(3);
    expect(hud.querySelectorAll('[data-build-category]')).toHaveLength(4);
    expect(hud.querySelector('[data-build-category="aviation"]')).toBeNull();
    hud.querySelector<HTMLButtonElement>('[data-build-category="defense"]')?.click();
    await hud.updateComplete;
    expect(hud.querySelectorAll(".unit-display-scroll .unit-display-grid > div")).toHaveLength(5);
    hud.remove();
  });

  it("exposes aviation and the fourth nuclear option only when Functional Geopolitics is on", async () => {
    const hud = mountHUD({ geopolitics: true, functional: true });
    await hud.updateComplete;
    expect(hud.querySelectorAll(".unit-display-arsenal .unit-display-grid > div")).toHaveLength(4);
    expect(hud.querySelector('[data-build-category="aviation"]')).not.toBeNull();
    hud.querySelector<HTMLButtonElement>('[data-build-category="aviation"]')?.click();
    await hud.updateComplete;
    expect(hud.querySelectorAll(".unit-display-scroll .unit-display-grid > div")).toHaveLength(4);
    hud.remove();
  });

  it("only displays units permitted in the current mode", async () => {
    const hud = mountHUD({ disabled: [UnitType.Farm, UnitType.Mine, UnitType.Castle] });
    await hud.updateComplete;
    expect(hud.querySelectorAll(".unit-display-scroll .unit-display-grid > div")).toHaveLength(4);
    hud.querySelector<HTMLButtonElement>('[data-build-category="defense"]')?.click();
    await hud.updateComplete;
    expect(hud.querySelectorAll(".unit-display-scroll .unit-display-grid > div")).toHaveLength(4);
    hud.remove();
  });

  it("provides visible costs, inventory and disabled explanation while data loads", async () => {
    const hud = mountHUD();
    await hud.updateComplete;
    const card = hud.querySelector<HTMLElement>(".unit-display-scroll .unit-display-action");
    expect(card?.getAttribute("aria-disabled")).toBe("true");
    expect(card?.querySelector(".unit-display-action-count")).not.toBeNull();
    expect(card?.querySelector(".unit-display-action-cost")?.textContent).toContain("—");
    expect(card?.getAttribute("title")).toContain("Cargando costos");
    hud.remove();
  });

  it("makes the geopolítics-only workshop available in the naval category", async () => {
    const hud = mountHUD({ geopolitics: true });
    await hud.updateComplete;
    hud.querySelector<HTMLButtonElement>('[data-build-category="naval"]')?.click();
    await hud.updateComplete;
    expect(hud.querySelector("[data-mobile-shipyard]")).not.toBeNull();
    expect(hud.querySelectorAll(".unit-display-scroll .unit-display-grid > div")).toHaveLength(4);
    hud.remove();
  });
});
