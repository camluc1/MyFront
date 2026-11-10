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
  [UnitType.Castle, "buildCastle", "Shift+KeyC", "Shift+C"],
  [UnitType.Shipyard, "buildShipyard", "Shift+KeyY", "Shift+Y"],
  [UnitType.Bismarck, "buildBismarck", "Shift+KeyB", "Shift+B"],
  [UnitType.IronDome, "buildIronDome", "KeyI", "I"],
] as const;

beforeEach(() => {
  new UserSettings().removeCached(KEYBINDS_KEY, false);
});

afterEach(() => {
  new UserSettings().removeCached(KEYBINDS_KEY, false);
  document.body.innerHTML = "";
});

describe("DLC keyboard build controls", () => {
  it("covers all economy and advanced defense buildables with non-conflicting defaults", () => {
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
      const button = [...menu.renderRoot.querySelectorAll(".build-button")]
        .find((node) => node.querySelector(`img[alt="${type}"]`));
      const icon = button?.querySelector(".build-icon-wrap");
      expect(icon).toBeTruthy();
      expect(icon?.querySelector(".build-hotkey")?.textContent?.trim())
        .toBe(letter);
    }
    new UserSettings().setKeybinds({
      buildFarm: { value: "KeyI", key: "I" },
    });
    await menu.updateComplete;
    expect(badge(UnitType.Farm)).toBe("I");
    new UserSettings().setKeybinds({
      buildFarm: { value: "Null", key: "" },
    });
    await menu.updateComplete;
    expect(badge(UnitType.Farm)).toBe("—");
    expect(menu.renderRoot.querySelector(".build-hotkey.unbound")).toBeTruthy();
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
      for (const [type, , binding] of added) {
        const shiftKey = binding.startsWith("Shift+");
        const code = shiftKey ? binding.slice(6) : binding;
        window.dispatchEvent(new KeyboardEvent("keydown", {
          code, shiftKey, bubbles: true,
        }));
        window.dispatchEvent(new KeyboardEvent("keyup", {
          code, shiftKey, bubbles: true,
        }));
        expect(ui.ghostStructure).toBe(type);
      }
    } finally {
      handler.destroy();
    }
  });

  it("repeating the Dome hotkey steps through 1, 5 and 10 upgrades", () => {
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
    const press = () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyI" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyI" }));
    };
    try {
      press();
      expect(ui.ghostStructure).toBe(UnitType.IronDome);
      expect(ui.upgradeMultiplier).toBe(1);
      press();
      expect(ui.upgradeMultiplier).toBe(5);
      press();
      expect(ui.upgradeMultiplier).toBe(10);
    } finally {
      handler.destroy();
    }
  });

  it("honors live remapping and does not steal a key reserved by the player", () => {
    const gameView = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true }),
    } as unknown as GameView;
    const ui = { ghostStructure: null as UnitType | null,
      upgradeMultiplier: 1, attackRatio: 20, rocketDirectionUp: true };
    const handler = new InputHandler(
      gameView, ui as any, document.createElement("canvas"), new EventBus(),
    );
    handler.initialize();
    const press = (code: string) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    };
    try {
      new UserSettings().setKeybinds({
        buildFarm: { value: "KeyI", key: "I" },
      });
      press("KeyI");
      expect(ui.ghostStructure).toBe(UnitType.Farm);
      ui.ghostStructure = null;
      press("KeyJ");
      expect(ui.ghostStructure).toBeNull();
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
