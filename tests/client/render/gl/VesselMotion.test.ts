import { describe, expect, it } from "vitest";
import { VesselMotion } from "../../../../src/client/render/gl/utils/VesselMotion";

describe("vessel trajectory and body alignment", () => {
  it("keeps the hull aligned with actual rendered travel", () => {
    const m = new VesselMotion(1, 0, 0, 0, 0, 100);
    let x = 1,
      y = 0;
    for (let tick = 1; tick < 50; tick++) {
      if (tick < 20) {
        if (tick % 2) y++;
        else x++;
      } else y++;
      m.update(x, y, tick * 100, 100);
      for (let f = 1; f < 10; f++) {
        m.sample(tick * 100 + f * 10);
        const px = m.x,
          py = m.y;
        m.sample(tick * 100 + f * 10 + 0.01);
        const dx = m.x - px,
          dy = m.y - py;
        if (Math.hypot(dx, dy) > 1e-8)
          expect(
            (dx * Math.cos(m.angle) + dy * Math.sin(m.angle)) /
              Math.hypot(dx, dy),
          ).toBeGreaterThan(0.999);
      }
    }
  });
  it("removes repeating grid-step rocking on a straight diagonal course", () => {
    const m = new VesselMotion(1, 0, 0, 0, 0, 100);
    let x = 1,
      y = 0;
    const angles: number[] = [];
    for (let tick = 1; tick <= 80; tick++) {
      if (tick % 2) y++;
      else x++;
      m.update(x, y, tick * 100, 100);
      m.sample(tick * 100 + 50);
      if (tick > 60) angles.push(m.angle);
    }
    expect(Math.max(...angles) - Math.min(...angles)).toBeLessThan(0.01);
  });
  it("settles to the final authoritative position without rotating at rest", () => {
    const m = new VesselMotion(1, 0, 0, 0, 0, 100);
    m.update(2, 1, 100, 100);
    for (let t = 200; t <= 1000; t += 100) m.update(2, 1, t, 100);
    m.sample(2000);
    expect(m.x).toBeCloseTo(2);
    expect(m.y).toBeCloseTo(1);
    const angle = m.angle;
    m.sample(3000);
    expect(m.angle).toBe(angle);
    expect(m.wake(3000)).toBe(0);
  });
});
