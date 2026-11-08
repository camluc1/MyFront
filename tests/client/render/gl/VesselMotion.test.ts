import { describe, expect, it } from "vitest";
import { VesselMotion } from "../../../../src/client/render/gl/utils/VesselMotion";

describe("vessel trajectory and body alignment", () => {
  it("limits real turns and reaches the new course without snapping", () => {
    const m = new VesselMotion(1, 0, 0, 0, 0, 100);
    let last = m.angle;
    for (let tick = 1; tick < 70; tick++) {
      m.update(
        tick < 20 ? tick : 20,
        tick < 20 ? 0 : tick - 20,
        tick * 100,
        100,
      );
      for (let f = 0; f < 10; f++) {
        m.sample(tick * 100 + f * 10);
        expect(Math.abs(m.angle - last)).toBeLessThanOrEqual(
          (Math.PI / 2) * 0.02 + 1e-6,
        );
        last = m.angle;
      }
    }
    expect(m.angle).toBeCloseTo(Math.PI / 2, 2);
  });
  it("does not rock on uneven staircase routes interspersed with stationary ticks", () => {
    const m = new VesselMotion(1, 0, 0, 0, 0, 100);
    let x = 1,
      y = 0;
    const angles: number[] = [];
    for (let tick = 1; tick < 140; tick++) {
      if (tick % 3 === 0) x++;
      else if (tick % 3 === 1) y++;
      m.update(x, y, tick * 100, 100);
      for (let f = 0; f < 10; f++) {
        m.sample(tick * 100 + f * 10);
        if (tick > 80) angles.push(m.angle);
      }
    }
    expect(Math.max(...angles) - Math.min(...angles)).toBeLessThan(0.015);
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

it("keeps an unplanned warship's position and bow stable on a two-cell stair route", () => {
  const m = new VesselMotion(0, 0, 0, 0, 0, 100);
  let x = 0,
    y = 0;
  const angles: number[] = [],
    sides: number[] = [];
  for (let tick = 1; tick <= 180; tick++) {
    if ((tick - 1) % 4 < 2) x++;
    else y++;
    m.update(x, y, tick * 100, 100);
    for (let f = 1; f <= 5; f++) {
      m.sample(tick * 100 + f * 16);
      if (tick > 100) {
        angles.push(m.angle);
        sides.push(m.x - m.y);
      }
    }
  }
  expect(Math.max(...angles) - Math.min(...angles)).toBeLessThan(0.02);
  expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(0.02);
});

it("keeps planned ship corners smooth instead of instantly swinging left-right", () => {
  const m = new VesselMotion(1, 0, 0, 0, 0, 100);
  const route = {
    planId: 1, startTick: 0, ticksPerStep: 1, lastStep: 8,
    segments: [
      {start:0,end:4,ax:0,ay:0,cx:2,cy:0,bx:4,by:0},
      {start:4,end:8,ax:4,ay:0,cx:4,cy:2,bx:4,by:4},
    ],
  };
  m.setRoute(route, 2, 0);
  m.sample(50);
  expect(m.angle).toBeCloseTo(0, 4);
  let before = m.angle;
  for (let tick = 5; tick < 25; tick++) {
    const now = (tick - 4) * 100;
    m.setRoute(route, 7, now);
    m.sample(now + 50);
    expect(m.angle - before).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.abs(m.angle - before)).toBeLessThan(0.20);
    before = m.angle;
  }
  expect(m.angle).toBeCloseTo(Math.PI / 2, 2);
});
