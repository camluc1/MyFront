import { describe, expect, it } from "vitest";
import { VesselMotion } from "../../../../src/client/render/gl/utils/VesselMotion";

describe("render-only vessel motion", () => {
  it("interpolates positions without replaying repeated lastPos snapshots", () => {
    const m = new VesselMotion(10, 0, 0, 0, 0, 100);
    m.sample(50);
    expect(m.x).toBeGreaterThan(0);
    expect(m.x).toBeLessThan(10);
    m.update(10, 0, 50, 100);
    m.sample(100);
    expect(m.x).toBeGreaterThan(8);
    m.sample(1000);
    expect(m.x).toBeCloseTo(10);
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
  it("holds a stable course on a long alternating grid staircase", () => {
    const m = new VesselMotion(1, 0, 0, 0, 0, 100);
    let x = 1,
      y = 0;
    const headings: number[] = [];
    for (let i = 1; i <= 80; i++) {
      if (i % 2) y++;
      else x++;
      m.update(x, y, i * 100, 100);
      m.sample(i * 100 + 90);
      if (i > 60) headings.push(m.angle);
    }
    expect(Math.max(...headings) - Math.min(...headings)).toBeLessThan(0.02);
    // A genuine sustained turn must still be followed.
    for (let i = 81; i <= 100; i++) {
      y++;
      m.update(x, y, i * 100, 100);
    }
    m.sample(11000);
    expect(m.angle).toBeGreaterThan(1.35);
  });
});
