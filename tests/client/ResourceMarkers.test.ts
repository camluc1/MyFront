import {
  NATURAL_RESOURCES,
  type ResourceDeposit,
} from "@openfront/engine-lib/game/NaturalResources";
import { describe, expect, it } from "vitest";
import {
  layoutResourceMarkers,
  RESOURCE_STYLE,
} from "../../src/client/controllers/ResourceMarkers";

describe("Resource annotations", () => {
  it.each([
    [2000, 1000, 500],
    [100, 50, 60],
    [12, 12, 20],
  ])(
    "separates every marker on a %sx%s map without changing its deposit",
    (width, height, count) => {
      const deposits: ResourceDeposit[] = Array.from(
        { length: count },
        (_, id) => ({
          id,
          resource: NATURAL_RESOURCES[id % NATURAL_RESOURCES.length],
          x: 1,
          y: 1,
          radius: 10,
          quality: 1,
          capacity: 240,
        }),
      );
      const before = structuredClone(deposits);
      const markers = layoutResourceMarkers(deposits, width, height);
      expect(markers).toHaveLength(count);
      expect(deposits).toEqual(before);
      expect(markers.map((x) => x.deposit)).toEqual(deposits);
      for (let i = 0; i < markers.length; i++) {
        const a = markers[i];
        expect(a.x - a.radius).toBeGreaterThanOrEqual(0);
        expect(a.y - a.radius).toBeGreaterThanOrEqual(0);
        expect(a.x + a.radius).toBeLessThanOrEqual(width);
        expect(a.y + a.radius).toBeLessThanOrEqual(height);
        for (let j = i + 1; j < markers.length; j++) {
          const b = markers[j];
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(
            a.radius + b.radius,
          );
        }
      }
      expect(layoutResourceMarkers(deposits, width, height)).toEqual(markers);
    },
  );
  it("assigns every resource a distinct color and a non-color identifier", () => {
    expect(
      new Set(NATURAL_RESOURCES.map((x) => RESOURCE_STYLE[x].color)).size,
    ).toBe(NATURAL_RESOURCES.length);
    expect(
      new Set(NATURAL_RESOURCES.map((x) => RESOURCE_STYLE[x].symbol)).size,
    ).toBe(NATURAL_RESOURCES.length);
  });
});
