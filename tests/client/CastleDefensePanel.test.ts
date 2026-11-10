import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@openfront/shared/EventBus";
import { CastleDefensePanel, defenseAtScreenPoint, InspectDefenseEvent } from "../../src/client/hud/CastleDefensePanel";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { MapRenderer } from "../../src/client/render/gl/MapRenderer";
import type { SelectedDefenseRange } from "../../src/client/render/gl/passes/RangeCirclePass";
import { SendCastleDefenseIntentEvent } from "../../src/client/Transport";
import type { GameView, UnitView } from "../../src/client/view";
import type { TransformHandler } from "../../src/client/TransformHandler";
import type { UIState } from "../../src/client/UIState";

describe("interactive Geopolitics Castle panel", () => {
  it("shows three inspectable states, explicit price, help, and sends the real intent", async () => {
    const bus = new EventBus();
    const sent = vi.spyOn(bus, "emit");
    const owner = { id: () => "owner", gold: () => 500_000n, displayName: () => "Aliado" };
    const castle = {
      id: () => 7, tile: () => 123, type: () => UnitType.Castle,
      level: () => 1, owner: () => owner,
      isActive: () => true, isUnderConstruction: () => false,
      state: { castleActiveUntilTick: 0, castleCooldownUntilTick: 0 },
    } as unknown as UnitView;
    let tick = 100;
    const game = {
      ticks: () => tick, units: () => [castle], myPlayer: () => owner,
      x: () => 30, y: () => 30, config: () => ({ castleRange: () => 60,
        gameConfig: () => ({ geopolitics: true }) }),
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
    const coverage: Array<SelectedDefenseRange | null> = [];
    el.view = { setSelectedDefenseRange: (range: SelectedDefenseRange | null) =>
      coverage.push(range) } as unknown as MapRenderer;
    document.body.append(el);
    try {
      await el.updateComplete;
      const marker = el.shadowRoot?.querySelector<HTMLButtonElement>(".tag");
      expect(marker).toBeTruthy();
      marker!.click();
      await el.updateComplete;
      expect(coverage.at(-1)).toMatchObject({ radius: 60, hostile: false });
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

  it("shows enemy fortification and real dome coverage without allowing enemy activation", async () => {
    const bus = new EventBus();
    const mine = { id: () => "mine", gold: () => 1_000_000n,
      displayName: () => "Jugador" };
    const enemy = { id: () => "enemy", gold: () => 50_000n,
      displayName: () => "Nación rival" };
    const enemyCastle = {
      id: () => 17, tile: () => 700, type: () => UnitType.Castle,
      level: () => 1, owner: () => enemy, isActive: () => true,
      isUnderConstruction: () => false,
      state: { castleActiveUntilTick: 300, castleCooldownUntilTick: 1500 },
    } as unknown as UnitView;
    const enemyDome = {
      id: () => 18, tile: () => 800, type: () => UnitType.IronDome,
      level: () => 2, owner: () => enemy, isActive: () => true,
      isUnderConstruction: () => false,
      state: { castleActiveUntilTick: 0, castleCooldownUntilTick: 0 },
    } as unknown as UnitView;
    const game = {
      ticks: () => 100, myPlayer: () => mine, isSpectator: () => false,
      inSpawnPhase: () => false,
      units: (...types: UnitType[]) =>
        [enemyCastle, enemyDome].filter((u) => types.includes(u.type())),
      x: (tile: number) => tile === 700 ? 10 : 20,
      y: () => 40,
      config: () => ({ castleRange: () => 60, ironDomeRange: () => 100,
        gameConfig: () => ({ geopolitics: true }) }),
    } as unknown as GameView;
    const transform = {
      scale: 1.2,
      worldToScreenCoordinates: (cell: { x: number }) =>
        ({ x: cell.x === 10 ? 200 : 300, y: 160 }),
    } as unknown as TransformHandler;
    const coverage: Array<SelectedDefenseRange | null> = [];
    const el = new CastleDefensePanel();
    el.game = game;
    el.bus = bus;
    el.transform = transform;
    el.uiState = { ghostStructure: null } as UIState;
    el.view = { setSelectedDefenseRange: (range: SelectedDefenseRange | null) =>
      coverage.push(range) } as unknown as MapRenderer;
    document.body.append(el);
    try {
      await el.updateComplete;
      expect(defenseAtScreenPoint(game, transform, 200, 160)?.id()).toBe(17);
      expect(defenseAtScreenPoint(game, transform, 300, 160)?.id()).toBe(18);
      expect(defenseAtScreenPoint(game, transform, 500, 160)).toBeUndefined();
      const marker = el.shadowRoot!.querySelector<HTMLButtonElement>(".tag.enemy");
      expect(marker).not.toBeNull();
      marker!.click();
      await el.updateComplete;
      expect(el.shadowRoot?.textContent).toContain("Resistencia extrema activa");
      expect(el.shadowRoot?.textContent).toContain("Nación rival");
      expect(el.shadowRoot?.querySelector(".activate")).toBeNull();
      expect(coverage.at(-1)).toMatchObject({
        radius: 60, hostile: true, fortified: true,
      });
      bus.emit(new InspectDefenseEvent(18));
      await el.updateComplete;
      expect(el.shadowRoot?.textContent).toContain("Cúpula de Hierro");
      expect(el.shadowRoot?.textContent).toContain("100 casillas");
      expect(el.shadowRoot?.querySelector(".activate")).toBeNull();
      expect(coverage.at(-1)).toMatchObject({
        radius: 100, hostile: true, fortified: false,
      });
    } finally {
      el.remove();
    }
  });
});
