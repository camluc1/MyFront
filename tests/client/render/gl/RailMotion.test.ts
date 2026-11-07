import { describe, expect, it } from "vitest";
import { RailMotion } from "../../../../src/client/render/gl/utils/RailMotion";

describe("rail vehicle motion", () => {
  it("follows straight rails without drifting after arrival", () => {
    const m = new RailMotion(10, 0, 0, 0, 0, 100);
    m.sample(50);
    expect([m.x, m.y]).toEqual([5, 0]);
    m.sample(100);
    expect([m.x, m.y]).toEqual([10, 0]);
    const angle = m.angle;
    m.update(10, 0, 200, 100);
    m.sample(1000);
    expect([m.x, m.y, m.angle, m.wake()]).toEqual([10, 0, angle, 0]);
  });
  it("completes a right angle during movement rather than rotating at the station", () => {
    const m = new RailMotion(2, 0, 0, 0, 0, 100);
    m.update(2, 2, 100, 100);
    m.sample(150);
    expect(m.x).toBe(2);
    expect(m.y).toBe(1);
    expect(m.angle).toBeCloseTo(Math.PI / 4);
    m.sample(200);
    expect(m.angle).toBeCloseTo(Math.PI / 2);
    m.sample(500);
    expect(m.angle).toBeCloseTo(Math.PI / 2);
  });
});
