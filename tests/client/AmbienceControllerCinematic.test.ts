import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@openfront/shared/EventBus";
import { AmbienceController } from "../../src/client/controllers/AmbienceController";
import { setEnhancedVisuals } from "../../src/client/render/gl/EnhancedVisuals";
import { SetAmbienceEvent } from "../../src/client/sound/Sounds";
import type { GameView } from "../../src/client/view";
import type { TransformHandler } from "../../src/client/TransformHandler";

beforeEach(() => setEnhancedVisuals(false));
afterEach(() => setEnhancedVisuals(false));

describe("cinematic ocean ambience gating", () => {
  const setup = (water: boolean, scale = 18) => {
    const game = {
      isValidCoord: () => true, ref: () => 18,
      isWater: () => water, nearbyUnits: () => [],
    } as unknown as GameView;
    const camera = {
      scale, screenCenter: () => ({ screenX: 6, screenY: 3 }),
    } as unknown as TransformHandler;
    const bus = new EventBus();
    const receive = vi.fn();
    bus.on(SetAmbienceEvent, receive);
    const controller = new AmbienceController(game, bus, camera);
    return { controller, receive };
  };

  it("keeps the existing quiet sea when cinematic graphics are disabled", () => {
    const { controller, receive } = setup(true);
    controller.tick();
    expect(receive).not.toHaveBeenCalled();
  });

  it("plays only near water and at close zoom with the opt-in enabled", () => {
    setEnhancedVisuals(true);
    const sea = setup(true);
    sea.controller.tick();
    expect(sea.receive).toHaveBeenCalledOnce();
    const call = sea.receive.mock.calls[0][0] as SetAmbienceEvent;
    expect(call.track).toBe("sea");
    expect(call.gain).toBeGreaterThan(0);
    expect(call.gain).toBeLessThanOrEqual(0.3);
    const land = setup(false);
    land.controller.tick();
    expect(land.receive).not.toHaveBeenCalled();
    const distant = setup(true, 1.8);
    distant.controller.tick();
    expect(distant.receive).not.toHaveBeenCalled();
  });

  it("does not re-emit the same loop on every tick", () => {
    setEnhancedVisuals(true);
    const { controller, receive } = setup(true);
    for (let i = 0; i < 1000; i++) controller.tick();
    expect(receive).toHaveBeenCalledOnce();
  });
});
