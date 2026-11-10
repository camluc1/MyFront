import { describe, expect, it } from "vitest";
import { VesselMotion } from "../../../../src/client/render/gl/utils/VesselMotion";

const straightRoute = {
  planId: 1,
  startTick: 0,
  ticksPerStep: 1,
  lastStep: 20,
  segments: [{
    start: 0, end: 20, ax: 0, ay: 0, cx: 10, cy: 0, bx: 20, by: 0,
  }],
};

describe("presentation-only naval inertia", () => {
  it("does not snap to a newly assigned heading on the first route frame", () => {
    const vessel = new VesselMotion(1, 0, 0, 0, 0, 100);
    const verticalRoute = {
      planId: 23, startTick: 0, ticksPerStep: 1, lastStep: 12,
      segments: [{ start: 0, end: 12, ax: 0, ay: 0, cx: 0, cy: 6, bx: 0, by: 12 }],
    };
    vessel.setRoute(verticalRoute, 1, 100);
    vessel.sample(150);
    // The previous heading is east; the new course is north. It must turn
    // with bounded angular speed rather than teleport its orientation.
    expect(vessel.angle).toBeGreaterThan(0);
    expect(vessel.angle).toBeLessThan(0.1);
  });

  it("accelerates at departure, cruises in the middle and brakes at arrival", () => {
    const vessel = new VesselMotion(0, 0, 0, 0, 0, 100);
    vessel.setRoute(straightRoute, 0, 0);
    vessel.sample(50);
    // Linear routing would already be half a tile along.
    expect(vessel.x).toBeGreaterThan(0);
    expect(vessel.x).toBeLessThan(0.5);

    vessel.setRoute(straightRoute, 10, 1000);
    vessel.sample(1050);
    expect(vessel.x).toBeCloseTo(10.5, 6);

    vessel.setRoute(straightRoute, 19, 1900);
    vessel.sample(1950);
    // Easing approaches the last tile ahead of linear motion then slows down.
    expect(vessel.x).toBeGreaterThan(19.5);
    expect(vessel.x).toBeLessThan(20);

    vessel.setRoute(straightRoute, 20, 2000);
    vessel.sample(2050);
    expect(vessel.x).toBe(20);
    expect(vessel.wake(2050)).toBe(0);
  });

  it("turns progressively without snapping across a right angle", () => {
    const vessel = new VesselMotion(1, 0, 0, 0, 0, 100);
    const route = {
      planId: 2, startTick: 0, ticksPerStep: 1, lastStep: 16,
      segments: [
        { start: 0, end: 8, ax: 0, ay: 0, cx: 4, cy: 0, bx: 8, by: 0 },
        { start: 8, end: 16, ax: 8, ay: 0, cx: 8, cy: 4, bx: 8, by: 8 },
      ],
    };
    vessel.setRoute(route, 7, 700);
    vessel.sample(750);
    expect(vessel.angle).toBeCloseTo(0, 6);

    let previous = vessel.angle;
    const changes: number[] = [];
    for (let tick = 8; tick <= 24; tick++) {
      vessel.setRoute(route, tick, tick * 100);
      vessel.sample(tick * 100 + 50);
      const turn = Math.atan2(
        Math.sin(vessel.angle - previous),
        Math.cos(vessel.angle - previous),
      );
      expect(Math.abs(turn)).toBeLessThan(0.16);
      changes.push(turn);
      previous = vessel.angle;
    }
    // Angular acceleration is gradual: the first update is slower than
    // the following update, not a one-frame 90-degree flip.
    expect(changes[1]).toBeGreaterThan(changes[0]);
    expect(vessel.angle).toBeCloseTo(Math.PI / 2, 1);
  });

  it("does not jump backwards when a planned route is removed at arrival", () => {
    const vessel = new VesselMotion(19, 0, 18, 0, 0, 100);
    vessel.setRoute(straightRoute, 20, 2000);
    vessel.sample(2050);
    vessel.update(20, 0, 2100, 100);
    vessel.setRoute(undefined, 21, 2100);
    vessel.sample(2150);
    expect(vessel.x).toBeCloseTo(20, 6);
    expect(vessel.y).toBeCloseTo(0, 6);
  });
});
