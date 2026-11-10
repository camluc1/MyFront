import { describe, expect, it } from "vitest";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { UnitSelectionEvent } from "../../src/client/InputHandler";
import { NavalStatusPanel } from "../../src/client/hud/NavalStatusPanel";
import type { GameView, UnitView } from "../../src/client/view";

describe("Geopolitics naval selection HUD", () => {
  it("reacts to existing selection events without creating movement commands", async () => {
    const bus = new EventBus();
    const warship = {
      id: () => 27, type: () => UnitType.Warship,
      aircraftState: () => undefined,
      isActive: () => true, health: () => 83,
      veterancy: () => 2, tile: () => 120,
      warshipState: () => ({
        state: "patrolling", patrolTile: 340, supportShip: false,
        isInCombat: false, lastCombatTick: 0, veterancy: 2, veterancyProgress: 0,
      }),
    } as unknown as UnitView;
    const game = {
      units: () => [warship], x: (tile: number) => Math.trunc(tile / 10),
      y: (tile: number) => tile % 10,
    } as unknown as GameView;
    const el = new NavalStatusPanel();
    el.game = game;
    el.bus = bus;
    document.body.append(el);
    try {
      bus.emit(new UnitSelectionEvent(warship, true));
      await el.updateComplete;
      expect(el.shadowRoot?.textContent).toContain("Buque de guerra");
      expect(el.shadowRoot?.textContent).toContain("Patrullando");
      expect(el.shadowRoot?.textContent).toContain("Nivel 2");
      expect(el.shadowRoot?.textContent).toContain("34, 0");
      bus.emit(new UnitSelectionEvent(null, false));
      await el.updateComplete;
      expect(el.shadowRoot?.querySelector(".panel")).toBeNull();
    } finally {
      el.remove();
    }
  });

  it("identifies the functional Bismarck through the existing selection event", async () => {
    const bus = new EventBus();
    const bismarck = {
      id: () => 91, type: () => UnitType.Bismarck,
      aircraftState: () => undefined,
      isActive: () => true, health: () => 4800,
      veterancy: () => 0, tile: () => 210,
      warshipState: () => ({
        state: "retreating", patrolTile: 330, supportShip: false,
        isInCombat: false, lastCombatTick: 0, veterancy: 0,
        veterancyProgress: 0,
      }),
    } as unknown as UnitView;
    const game = {
      units: () => [bismarck],
      x: (tile: number) => Math.trunc(tile / 10),
      y: (tile: number) => tile % 10,
    } as unknown as GameView;
    const el = new NavalStatusPanel();
    el.game = game;
    el.bus = bus;
    document.body.append(el);
    try {
      bus.emit(new UnitSelectionEvent(bismarck, true));
      await el.updateComplete;
      expect(el.shadowRoot?.textContent).toContain("Bismarck");
      expect(el.shadowRoot?.textContent).toContain("Retirándose");
      expect(el.shadowRoot?.textContent).toContain("4.800");
      bus.emit(new UnitSelectionEvent(null, false));
      await el.updateComplete;
      expect(el.shadowRoot?.querySelector(".panel")).toBeNull();
    } finally {
      el.remove();
    }
  });
});
