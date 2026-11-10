import { describe, expect, it } from "vitest";
import { isDomeVisible, protectingDomeOffset } from "../../../../src/client/render/gl/passes/IronDomePass";

const camera = new Float32Array([
  .01, 0, 0,
  0, .01, 0,
  0, 0, 1,
]);

describe("Iron Dome frustum culling", () => {
  it("selects the nearest real same-owner dome, never a foreign or out-of-range shield", () => {
    const domes = [
      100.5, 100.5, 1, 84, 0,
      110.5, 100.5, 1, 84, 0,
      100.5, 100.5, 2, 84, 0,
    ];
    expect(protectingDomeOffset(domes, 108, 100, 1)).toBe(5);
    expect(protectingDomeOffset(domes, 108, 100, 2)).toBe(10);
    expect(protectingDomeOffset(domes, 300, 300, 1)).toBe(-1);
    expect(protectingDomeOffset(domes, 108, 100, 9)).toBe(-1);
  });

  it("keeps visible and screen-edge containment circles", () => {
    expect(isDomeVisible(camera, 0, 0, 84, 1280, 800)).toBe(true);
    expect(isDomeVisible(camera, 108, 0, 12, 1280, 800)).toBe(true);
    expect(isDomeVisible(camera, 300, 0, 84, 1280, 800)).toBe(false);
    expect(isDomeVisible(camera, -300, 0, 84, 1280, 800)).toBe(false);
  });

  it("culls subpixel contours only, never a readable on-screen dome", () => {
    expect(isDomeVisible(camera, 0, 0, .001, 1280, 800)).toBe(false);
    expect(isDomeVisible(camera, 0, 0, 1, 1280, 800)).toBe(true);
  });

  it("handles rotated cameras without relying on an axis-aligned zoom", () => {
    const rotated = new Float32Array([
      0, .01, 0,
      -.01, 0, 0,
      0, 0, 1,
    ]);
    expect(isDomeVisible(rotated, 0, 0, 84, 1280, 800)).toBe(true);
    expect(isDomeVisible(rotated, 500, 500, 84, 1280, 800)).toBe(false);
  });
});
