import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@openfront/shared/EventBus";
import { CastleDefensePanel } from "../../src/client/hud/CastleDefensePanel";
import { SendCastleDefenseIntentEvent } from "../../src/client/Transport";
import type { GameView, UnitView } from "../../src/client/view";
import type { TransformHandler } from "../../src/client/TransformHandler";
import type { UIState } from "../../src/client/UIState";

describe("interactive Geopolitics Castle panel", () => {
  it("shows three inspectable states, explicit price, help, and sends the real intent", async () => {
    const bus = new EventBus();
    const sent = vi.spyOn(bus, "emit");
    const owner = { id: () => "owner", gold: () => 500_000n };
    const castle = {
      id: () => 7, tile: () => 123, owner: () => owner,
      isActive: () => true, isUnderConstruction: () => false,
      state: { castleActiveUntilTick: 0, castleCooldownUntilTick: 0 },
    } as unknown as UnitView;
    let tick = 100;
    const game = {
      ticks: () => tick, units: () => [castle], myPlayer: () => owner,
      x: () => 30, y: () => 30, config: () => ({ castleRange: () => 60 }),
      isSpectator: () => false, inSpawnPhase: () => false,
    } as unknown as GameView;
    const transform = {
      scale: 2, worldToScreenCoordinates: () => ({ x: 200, y: 200 }),
    } as unknown as TransformHandler;
    const el = new CastleDefensePanel();
    el.game = game;
    el.bus = bus;
    el.transform = transform;
    el.uiState = { ghostStructure: null } as UIState;
    document.body.append(el);
    try {
      await el.updateComplete;
      const marker = el.shadowRoot?.querySelector<HTMLButtonElement>(".tag");
      expect(marker).toBeTruthy();
      marker!.click();
      await el.updateComplete;
      expect(el.shadowRoot?.textContent).toContain("$150.000");
      const options = el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".choice");
      expect(options).toHaveLength(3);
      const activation = () => el.shadowRoot!.querySelector<HTMLButtonElement>(".activate")!;
      expect(activation().disabled).toBe(true);
      options[1].click();
      await el.updateComplete;
      expect(activation().disabled).toBe(false);
      activation().click();
      expect(sent.mock.calls.some(([e]) =>
        e instanceof SendCastleDefenseIntentEvent && e.unitId === 7)).toBe(true);
      castle.state.castleActiveUntilTick = 150;
      castle.state.castleCooldownUntilTick = 270;
      el.requestUpdate();
      await el.updateComplete;
      expect(el.shadowRoot?.textContent).toContain("Resistencia extrema activa");
      tick = 150;
      el.requestUpdate();
      await el.updateComplete;
      expect(el.shadowRoot?.textContent).toContain("En recuperación");
      expect(el.shadowRoot?.textContent).toContain("Disponible en");
    } finally {
      el.remove();
    }
  });
});
