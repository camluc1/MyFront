import { BuildableUnit, BuildMenus, UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILD_KEYBIND_ACTIONS, buildActionForUnit } from "../../src/client/BuildKeybinds";
import { InputHandler } from "../../src/client/InputHandler";
import "../../src/client/hud/layers/BuildMenu";
import type { BuildMenu } from "../../src/client/hud/layers/BuildMenu";
import { getDefaultKeybinds, KEYBINDS_KEY, UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

const added = [
  [UnitType.Farm, "buildFarm", "KeyJ", "J"],
  [UnitType.Mine, "buildMine", "KeyV", "V"],
  [UnitType.OilWell, "buildOilWell", "KeyO", "O"],
  [UnitType.GasPlant, "buildGasPlant", "KeyZ", "Z"],
] as const;

beforeEach(() => {
  new UserSettings().removeCached(KEYBINDS_KEY, false);
});

afterEach(() => {
  new UserSettings().removeCached(KEYBINDS_KEY, false);
  document.body.innerHTML = "";
});

describe("DLC keyboard build controls", () => {
  it("covers every DLC buildable with distinct unused default letters", () => {
    const defaults = getDefaultKeybinds(false);
    const actions = BUILD_KEYBIND_ACTIONS.map((entry) => entry.action);
    const codes = Object.entries(defaults)
      .filter(([name]) => !name.startsWith("build"))
      .map(([, code]) => code);
    for (const [type, action, code] of added) {
      expect(buildActionForUnit(type)).toBe(action);
      expect(defaults[action]).toBe(code);
      expect(codes).not.toContain(code);
      expect(actions.filter((name) => name === action)).toHaveLength(1);
    }
    expect(new Set(added.map(([, , code]) => code)).size).toBe(added.length);
    // Every item displayed in BuildMenu must be reachable from a shortcut.
    for (const type of BuildMenus.types) expect(buildActionForUnit(type)).toBeDefined();
    expect(new Set(BUILD_KEYBIND_ACTIONS.map(({ type }) => type)).size)
      .toBe(BuildMenus.types.length);
  });

  it("shows a muted key label on every available structure and follows rebinds", async () => {
    const menu = document.createElement("build-menu") as BuildMenu;
    menu.game = {
      myPlayer: () => ({ totalUnitLevels: () => 0 }),
    } as unknown as GameView;
    menu.uiState = { preventStacking: false } as any;
    menu.playerBuildables = added.map(([type]) => ({
      type, canBuild: true, canUpgrade: false, cost: 1n,
    })) as unknown as BuildableUnit[];
    document.body.append(menu);
    await menu.updateComplete;

    const badge = (type: UnitType) => {
      const button = [...menu.renderRoot.querySelectorAll(".build-button")]
        .find((button) => button.querySelector(`img[alt="${type}"]`));
      return button?.querySelector(".build-hotkey")?.textContent?.trim();
    };
    for (const [type, , , letter] of added) {
      expect(badge(type)).toBe(letter);
    }
    new UserSettings().setKeybinds({
      buildFarm: { value: "KeyI", key: "I" },
    });
    await menu.updateComplete;
    expect(badge(UnitType.Farm)).toBe("I");
    menu.remove();
  });

  it("selects the correct ghost structure from every new hotkey", () => {
    const gameView = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true }),
    } as unknown as GameView;
    const ui = {
      ghostStructure: null as UnitType | null,
      upgradeMultiplier: 1,
      rocketDirectionUp: true,
      attackRatio: 20,
      preventStacking: false,
    };
    const handler = new InputHandler(
      gameView, ui as any, document.createElement("canvas"), new EventBus(),
    );
    handler.initialize();
    try {
      for (const [type, , code] of added) {
        window.dispatchEvent(new KeyboardEvent("keydown", {
          code, bubbles: true,
        }));
        window.dispatchEvent(new KeyboardEvent("keyup", {
          code, bubbles: true,
        }));
        expect(ui.ghostStructure).toBe(type);
      }
    } finally {
      handler.destroy();
    }
  });

  it("does not activate a build shortcut while typing in a text field", () => {
    const gameView = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true }),
    } as unknown as GameView;
    const ui = { ghostStructure: null, upgradeMultiplier: 1, attackRatio: 20, rocketDirectionUp: true };
    const handler = new InputHandler(gameView, ui as any, document.createElement("canvas"), new EventBus());
    handler.initialize();
    const input = document.createElement("input");
    document.body.append(input);
    try {
      input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyJ", bubbles: true }));
      expect(ui.ghostStructure).toBeNull();
    } finally {
      handler.destroy();
    }
  });
});
