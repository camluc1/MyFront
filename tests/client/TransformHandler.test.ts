import { Cell } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DragEvent, ZoomEvent } from "../../src/client/InputHandler";
import {
  GOTO_INTERVAL_MS,
  GoToPositionEvent,
  TransformHandler,
} from "../../src/client/TransformHandler";
import type { GameView } from "../../src/client/view";

function makeHandler() {
  const game = {
    width: () => 400,
    height: () => 400,
    myPlayer: () => null,
  } as unknown as GameView;
  const eventBus = new EventBus();
  const handler = new TransformHandler(
    game,
    eventBus,
    document.createElement("canvas"),
  );
  return { handler, eventBus };
}

describe("TransformHandler", () => {
  it("starts with the default camera and no pending changes", () => {
    const { handler } = makeHandler();
    expect(handler.scale).toBe(1.8);
    expect(handler.hasChanged()).toBe(false);
  });

  it("treats a goTo tick after the target was cleared as a programming error", () => {
    const { handler } = makeHandler();
    handler.override(); // clears any target
    expect(() => (handler as any).goTo()).toThrow("null target");
  });

  describe("go-to animation", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("pans toward the target each tick until manual control clears it", () => {
      const { handler, eventBus } = makeHandler();
      const startX = handler.offsetX;

      eventBus.emit(new GoToPositionEvent(500, 500));
      vi.advanceTimersByTime(GOTO_INTERVAL_MS);
      expect(handler.offsetX).not.toBe(startX);
      expect(handler.hasChanged()).toBe(true);

      // Taking manual control stops the pending go-to interval.
      handler.override(10, 20, 1);
      const [x, y] = [handler.offsetX, handler.offsetY];
      vi.advanceTimersByTime(GOTO_INTERVAL_MS * 5);
      expect(handler.offsetX).toBe(x);
      expect(handler.offsetY).toBe(y);
    });
  });
});

describe("full map overview", () => {
  it.each([
    [2000, 1000, 1600, 900],
    [1000, 2000, 1600, 900],
    [2000, 1000, 600, 1000],
    [1000, 1000, 3440, 1440],
    [4000, 300, 390, 844],
  ])("fits map %s × %s in viewport %s × %s", (mapW, mapH, width, height) => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () =>
      ({ width, height, left: 37, top: 21 }) as DOMRect;
    const handler = new TransformHandler(
      { width: () => mapW, height: () => mapH } as GameView,
      new EventBus(),
      canvas,
    );
    const assertFits = () => {
      const topLeft = handler.worldToCanvasCoordinates(new Cell(0, 0));
      const bottomRight = handler.worldToCanvasCoordinates(
        new Cell(mapW, mapH),
      );
      expect(topLeft.x).toBeGreaterThanOrEqual(-0.000001);
      expect(topLeft.y).toBeGreaterThanOrEqual(-0.000001);
      expect(bottomRight.x).toBeLessThanOrEqual(width + 0.000001);
      expect(bottomRight.y).toBeLessThanOrEqual(height + 0.000001);
      expect(topLeft.x + bottomRight.x).toBeCloseTo(width);
      expect(topLeft.y + bottomRight.y).toBeCloseTo(height);
    };
    handler.centerAll();
    const border = Math.min(24, width * 0.04, height * 0.04);
    expect(handler.scale).toBe(
      Math.min((width - 2 * border) / mapW, (height - 2 * border) / mapH),
    );
    assertFits();
    handler.onMove(new DragEvent(9999, -9999));
    assertFits();
    handler.onZoom(new ZoomEvent(80, 120, 10000));
    assertFits();
  });

  it("keeps the overview fitted across resize in either direction", () => {
    let width = 1600,
      height = 900;
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () =>
      ({ width, height, left: 0, top: 0 }) as DOMRect;
    const handler = new TransformHandler(
      { width: () => 2000, height: () => 1000 } as GameView,
      new EventBus(),
      canvas,
    );
    handler.centerAll();
    expect(handler.scale).toBe(0.776);
    width = 600;
    height = 1000;
    handler.updateCanvasBoundingRect();
    expect(handler.scale).toBe(0.276);
    width = 1920;
    height = 1080;
    handler.updateCanvasBoundingRect();
    expect(handler.scale).toBe(0.936);
  });
});

describe("HUD-safe overview", () => {
  it.each([
    [1600, 900, 2000, 1000, 80, 220],
    [390, 844, 1000, 2000, 100, 400],
    [900, 500, 4000, 300, 60, 140],
  ])(
    "leaves a border and clears HUD in %s × %s",
    (width, height, mapW, mapH, top, bottom) => {
      const canvas = document.createElement("canvas");
      canvas.getBoundingClientRect = () =>
        ({ width, height, left: 0, top: 0 }) as DOMRect;
      const handler = new TransformHandler(
        { width: () => mapW, height: () => mapH } as GameView,
        new EventBus(),
        canvas,
      );
      handler.setViewportInsets({ left: 0, right: 0, top, bottom });
      handler.centerAll();
      const assertVisible = () => {
        const a = handler.worldToCanvasCoordinates(new Cell(0, 0));
        const b = handler.worldToCanvasCoordinates(new Cell(mapW, mapH));
        expect(a.x).toBeGreaterThan(0);
        expect(b.x).toBeLessThan(width);
        expect(a.y).toBeGreaterThan(top);
        expect(b.y).toBeLessThan(height - bottom);
        expect(a.y + b.y).toBeCloseTo(height + top - bottom);
      };
      assertVisible();
      handler.onZoom(new ZoomEvent(100, 100, 10000));
      handler.onMove(new DragEvent(99999, -99999));
      assertVisible();
      // An expanded bottom dock re-fits an overview instead of covering land.
      handler.setViewportInsets({
        left: 0,
        right: 0,
        top,
        bottom: bottom + 20,
      });
      const b = handler.worldToCanvasCoordinates(new Cell(mapW, mapH));
      expect(b.y).toBeLessThan(height - bottom - 20);
    },
  );
});
