import { describe, expect, it } from "vitest";
import { RailMotion } from "../../../../src/client/render/gl/utils/RailMotion";

describe("rail axle orientation", () => {
  it("draws a rigid body along straight rails", () => {
    const m = new RailMotion(10, 0, 0, 0, 0, 100);
    m.sample(50);
    expect(m.x).toBe(4.5);
    expect(m.y).toBe(0);
    expect(m.angle).toBe(0);
    m.sample(100);
    expect(m.x).toBe(9.5);
  });
  it("pivots around the corner according to both axles rather than spinning in place", () => {
    const m = new RailMotion(2, 0, 0, 0, 0, 100);
    m.update(2, 2, 100, 100);
    m.sample(125);
    expect(m.x).toBeCloseTo(1.75);
    expect(m.y).toBeCloseTo(0.25);
    expect(m.angle).toBeCloseTo(Math.PI / 4);
    m.sample(150);
    expect(m.x).toBe(2);
    expect(m.y).toBe(0.5);
    expect(m.angle).toBeCloseTo(Math.PI / 2);
    m.sample(200);
    const pose = [m.x, m.y, m.angle];
    m.sample(1000);
    expect([m.x, m.y, m.angle]).toEqual(pose);
  });
});
