import { describe, expect, it } from "vitest";
import shader from "../../../../src/client/render/gl/shaders/move-indicator/move-indicator.frag.glsl?raw";
import { VesselMotion } from "../../../../src/client/render/gl/utils/VesselMotion";

describe("naval waypoint feedback", () => {
  it("has a bounded, eased, fading marker with a centered confirmation pulse", () => {
    expect(shader).toContain("float converge = t * t * (3.0 - 2.0 * t)");
    expect(shader).toContain("float beaconRadius");
    expect(shader).toContain("smoothstep(0.72, 1.0, t)");
  });
  it("keeps presentation-only heading from changing ship coordinates", () => {
    const v = new VesselMotion(1, 0, 0, 0, 0, 100);
    const before = { x:v.x, y:v.y };
    v.headingByte();
    expect({ x:v.x, y:v.y }).toEqual(before);
  });
});
