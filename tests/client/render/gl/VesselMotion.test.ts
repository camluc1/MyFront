import { describe, expect, it } from "vitest";
import { VesselMotion } from "../../../../src/client/render/gl/utils/VesselMotion";

describe("render-only vessel motion", () => {
  it("interpolates positions without replaying repeated lastPos snapshots", () => {
    const m = new VesselMotion(10, 0, 0, 0, 0, 100);
    m.sample(50);
    expect(m.x).toBe(5);
    m.update(10, 0, 50, 100);
    m.sample(100);
    expect(m.x).toBe(10);
    m.sample(200);
    expect(m.x).toBe(10);
    expect(m.wake(600)).toBe(0);
  });
  it("turns gradually and does not snap between cardinal grid steps", () => {
    const m = new VesselMotion(1, 0, 0, 0, 0, 100);
    m.update(1, 1, 100, 100);
    m.sample(100);
    expect(m.angle).toBe(0);
    m.sample(150);
    expect(m.angle).toBeGreaterThan(0);
    expect(m.angle).toBeLessThan(Math.PI / 8);
    const angle = m.angle;
    m.update(2, 1, 150, 100);
    m.sample(150);
    expect(m.angle).toBe(angle);
  });
  it("takes the short turn across the -PI/PI boundary", () => {
    const m = new VesselMotion(-10, 0.1, 0, 0, 0, 100);
    const before = m.angle;
    m.update(-20, -0.1, 100, 100);
    m.sample(380);
    expect(Math.abs(m.angle - before)).toBeLessThan(0.1);
  });
  it("stays still without a wake when spawned stationary", () => {
    const m = new VesselMotion(4, 5, 4, 5, 0, 100);
    m.sample(1000);
    expect([m.x, m.y, m.wake(1000)]).toEqual([4, 5, 0]);
  });
});
