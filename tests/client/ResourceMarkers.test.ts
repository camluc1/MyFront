import type { GameMap } from "@openfront/engine-api/game/GameMap";
import {
  NATURAL_RESOURCES,
  resourceAt,
  resourceDeposits,
  type ResourceDeposit,
} from "@openfront/engine-lib/game/NaturalResources";
import fs from "node:fs";
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
    "anchors every marker on a %sx%s map without changing its deposit",
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
        expect(a.x).toBe(a.deposit.x + 0.5);
        expect(a.y).toBe(a.deposit.y + 0.5);
        expect(a.radius).toBeLessThanOrEqual(a.deposit.radius / 2);
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

describe("resource markers on production World terrain", () => {
  it.each(["map", "map4x"] as const)(
    "keeps %s markers on their own resource and off water",
    (size) => {
      const dir = "resources/maps/world/";
      const manifest = JSON.parse(
        fs.readFileSync(dir + "manifest.json", "utf8"),
      );
      const { width, height } = manifest[size];
      const terrain = fs.readFileSync(
        dir + (size === "map" ? "map.bin" : "map4x.bin"),
      );
      const map = {
        width: () => width,
        height: () => height,
        ref: (x: number, y: number) => y * width + x,
        isValidRef: (t: number) =>
          Number.isInteger(t) && t >= 0 && t < width * height,
        isLand: (t: number) => Boolean(terrain[t] & 128),
        x: (t: number) => t % width,
        y: (t: number) => Math.floor(t / width),
      } as unknown as GameMap;
      const deposits = resourceDeposits(map, "World");
      const markers = layoutResourceMarkers(deposits, width, height);
      expect(markers.length).toBeGreaterThan(100);
      for (let i = 0; i < markers.length; i++) {
        const a = markers[i];
        const tile = map.ref(Math.floor(a.x), Math.floor(a.y));
        expect(map.isLand(tile)).toBe(true);
        expect(resourceAt(map, "World", tile)?.id).toBe(a.deposit.id);
        for (const b of markers.slice(i + 1)) {
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(
            a.radius + b.radius,
          );
        }
      }
    },
  );
});
