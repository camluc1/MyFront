import { beforeEach, describe, expect, it, vi } from "vitest";

// Same boundary stubs as tests/UsernameInput.test.ts: the identity bar pulls
// in the whole client bootstrap, so keep the test on the component itself.
vi.mock("../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => false),
  invalidateUserMe: vi.fn(),
}));
vi.mock("../../src/client/ClanApi", () => ({
  checkClanTagOwnership: vi.fn(async (tag: string) => ({ tag, error: null })),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: () => false,
    getUsername: async () => null,
    addAuthListener: () => {},
  },
}));
vi.mock("../../src/client/SteamSDK", () => ({
  steamSDK: { isOnSteam: () => false, getUser: async () => null },
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => false),
  showInGameAlert: vi.fn(async () => true),
}));
// Echo keys (plus interpolations) so assertions read as i18n keys.
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

// Side-effect import registers <username-input>; vi.mock is hoisted above it.
import "../../src/client/UsernameInput";
import type { UsernameInput as UsernameInputEl } from "../../src/client/UsernameInput";

async function mount(): Promise<UsernameInputEl> {
  const el = document.createElement("username-input") as UsernameInputEl;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("UsernameInput validation error", () => {
  it("surfaces the validator's error and blocks play on an invalid name", async () => {
    const el = await mount();
    const input = el.querySelector<HTMLInputElement>(
      'input[aria-label="username.enter_username"]',
    )!;

    // Below MIN_USERNAME_LENGTH, so validateUsername rejects it.
    input.value = "ab";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;

    expect(el.canPlay()).toBe(false);
    expect(el.validationError).toContain("username.too_short");

    // Typing a valid name clears the error again.
    input.value = "ValidName";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;

    expect(el.canPlay()).toBe(true);
    expect(el.validationError).toBe("");
  });
});

describe("pre-game territory color picker", () => {
  it("lets the player select and clear a palette color beside the name", async () => {
    const el = await mount();
    const toggle = el.querySelector<HTMLButtonElement>("#game-color-picker-toggle")!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    await el.updateComplete;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const swatch = el.querySelector<HTMLButtonElement>('[data-game-color="#3b82f6"]')!;
    expect(swatch).not.toBeNull();
    swatch.click();
    await el.updateComplete;
    expect(localStorage.getItem("settings.preferredGameColor")).toBe("#3b82f6");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    await el.updateComplete;
    expect(el.querySelector('[data-game-color="#3b82f6"]')?.getAttribute("aria-pressed")).toBe("true");
    el.querySelector<HTMLButtonElement>("[data-game-color-default]")!.click();
    await el.updateComplete;
    expect(localStorage.getItem("settings.preferredGameColor")).toBeNull();
    el.remove();
  });
});
