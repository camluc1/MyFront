import { describe, expect, it } from "vitest";
import {
  buildSailingRoute,
  sampleSailingRoute,
} from "../../../../src/client/render/gl/utils/SailingRoute";
import { VesselMotion } from "../../../../src/client/render/gl/utils/VesselMotion";
const width = 1000;
const make = (points: [number, number][]) =>
  buildSailingRoute(
    {
      planId: 1,
      startTick: 10,
      ticksPerStep: 2,
      path: Uint32Array.from(points.map(([x, y]) => y * width + x)),
    },
    width,
    () => true,
  );
describe("boats follow their navigation route, rather than chasing grid steps", () => {
  it("has zero lateral oscillation or yaw on a full diagonal staircase", () => {
    const points: [number, number][] = [[0, 0]];
    for (let i = 1; i < 81; i++)
      points.push([Math.ceil(i / 2), Math.floor(i / 2)]);
    const route = make(points),
      out = { x: 0, y: 0, angle: 0 };
    for (let t = 0; t < 80; t += 0.05) {
      sampleSailingRoute(route, t, out);
      expect(out.x - out.y).toBeCloseTo(0, 9);
      expect(out.angle).toBeCloseTo(Math.PI / 4, 9);
    }
  });
  it("keeps the bow tangent to its rounded, real turn", () => {
    const points: [number, number][] = [];
    for (let x = 0; x <= 20; x++) points.push([x, 0]);
    for (let y = 1; y <= 20; y++) points.push([20, y]);
    const route = make(points);
    const a = { x: 0, y: 0, angle: 0 },
      b = { ...a };
    let last = 0;
    for (let t = 1; t < 39; t += 0.02) {
      sampleSailingRoute(route, t, a);
      sampleSailingRoute(route, t + 0.0001, b);
      const heading = Math.atan2(b.y - a.y, b.x - a.x);
      expect(Math.abs(heading - a.angle)).toBeLessThan(0.002);
      expect(Math.abs(a.angle - last)).toBeLessThan(0.08);
      last = a.angle;
    }
    expect(last).toBeCloseTo(Math.PI / 2);
  });
  it("does not cut across a land obstacle when simplifying a route", () => {
    const points: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
      [1, 2],
      [0, 2],
    ];
    const canSail = (x: number, y: number) => !(x === 1 && y === 1);
    const route = buildSailingRoute(
      {
        planId: 1,
        startTick: 0,
        ticksPerStep: 1,
        path: Uint32Array.from(points.map(([x, y]) => y * width + x)),
      },
      width,
      canSail,
    );
    const out = { x: 0, y: 0, angle: 0 };
    for (let t = 0; t <= 6; t += 0.01) {
      sampleSailingRoute(route, t, out);
      expect(canSail(Math.floor(out.x + 0.5), Math.floor(out.y + 0.5))).toBe(
        true,
      );
    }
  });
  it("uses authoritative plan timing and stays at the destination after the end", () => {
    const route = make([
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ]);
    const m = new VesselMotion(0, 0, 0, 0, 0, 100);
    m.setRoute(route, 14, 400);
    m.sample(450);
    expect(m.x).toBeCloseTo(1.125);
    expect(m.y).toBeCloseTo(1.125);
    expect(m.angle).toBeCloseTo(Math.PI / 4);
    m.setRoute(route, 25, 1000);
    m.sample(1050);
    expect(m.x).toBe(2);
    expect(m.y).toBe(2);
    expect(m.wake(1050)).toBe(0);
  });
});

it("removes repeated two-cell zigzags in open water", () => {
  const points: [number, number][] = [[0, 0]];
  let x = 0,
    y = 0;
  for (let i = 0; i < 20; i++) {
    points.push([++x, y], [++x, y], [x, ++y], [x, ++y]);
  }
  const route = make(points),
    out = { x: 0, y: 0, angle: 0 };
  for (let t = 0; t < 80; t += 0.1) {
    sampleSailingRoute(route, t, out);
    expect(out.x).toBeCloseTo(out.y, 8);
    expect(out.angle).toBeCloseTo(Math.PI / 4, 8);
  }
});
