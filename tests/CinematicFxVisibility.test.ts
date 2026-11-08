import { describe, expect, it } from "vitest";
import { isFxVisible } from "../src/client/render/gl/passes/fx-pass/FxVisibility";

const camera = new Float32Array([
  0.02, 0, 0,
  0, 0.02, 0,
  -1, -1, 1,
]);

describe("cinematic FX visibility", () => {
  it("culls tiny offscreen impact and launch sprites", () => {
    expect(isFxVisible(camera, {
      x: 150, y: 40, fxType: 4, cinematic: true, scale: 1,
    })).toBe(false);
    expect(isFxVisible(camera, {
      x: 150, y: 40, fxType: 13, cinematic: false, scale: 1,
    })).toBe(false);
  });

  it("preserves the large rising nuclear cloud near viewport edges", () => {
    expect(isFxVisible(camera, {
      x: 150, y: 40, fxType: 0, cinematic: true, scale: 1,
    })).toBe(true);
    expect(isFxVisible(camera, {
      x: 80, y: 145, fxType: 0, cinematic: true, scale: 1,
    })).toBe(true);
  });

  it("handles scaled MIRV clouds and rotated cameras conservatively", () => {
    expect(isFxVisible(camera, {
      x: 150, y: 40, fxType: 0, cinematic: true, scale: 0.56,
    })).toBe(false);
    const rotated = new Float32Array([
      0, 0.02, 0,
      -0.02, 0, 0,
      1, -1, 1,
    ]);
    expect(isFxVisible(rotated, {
      x: 50, y: 50, fxType: 3, cinematic: true, scale: 1,
    })).toBe(true);
  });

  it("preserves ordinary classic sprites and does not mutate camera", () => {
    const copy = Array.from(camera);
    expect(isFxVisible(camera, {
      x: 50, y: 50, fxType: 4, cinematic: false, scale: 1,
    })).toBe(true);
    expect(isFxVisible(camera, {
      x: 150, y: 40, fxType: 4, cinematic: false, scale: 1,
    })).toBe(false);
    expect(Array.from(camera)).toEqual(copy);
  });
});
