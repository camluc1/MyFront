import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameMap } from "../packages/engine-api/src/game/GameMap";
import { NATURAL_RESOURCES, RESOURCE_CATEGORY, WORLD_RESOURCE_PROFILES, resourceAt, resourceDeposits, worldResourceProfile } from "../packages/engine-lib/src/game/NaturalResources";
describe("world natural resource profiles", () => {
  it("covers the 72 world-map entries", () => {
    expect(Object.keys(WORLD_RESOURCE_PROFILES)).toHaveLength(72);
  });
  it("contains only unique supported resources", () => {
    for (const region of Object.values(WORLD_RESOURCE_PROFILES)) {
      expect(new Set(region).size).toBe(region.length);
      for (const resource of region) {
        expect(NATURAL_RESOURCES).toContain(resource);
        expect(RESOURCE_CATEGORY[resource]).toBeDefined();
      }
    }
  });
  it("keeps empty regions and country profiles distinct", () => {
    expect(worldResourceProfile("Antarctica")).toEqual([]);
    expect(worldResourceProfile("West Antarctica")).toEqual([]);
    expect(worldResourceProfile("Bolivia")).toContain("lithium");
    expect(worldResourceProfile("Texas")).toContain("oil");
    expect(worldResourceProfile("unknown")).toEqual([]);
  });
});

function fakeLandMap(width: number, height: number): GameMap {
  return {
    width: () => width,
    height: () => height,
    ref: (x: number, y: number) => y * width + x,
    isValidRef: (t: number) => Number.isInteger(t) && t >= 0 && t < width * height,
    isLand: () => true,
    x: (t: number) => t % width,
    y: (t: number) => Math.floor(t / width),
  } as unknown as GameMap;
}
describe("FRONTIER territorial resource generation", () => {
  it("covers all ten resource types on the world map", () => {
    const map = fakeLandMap(2000, 1000);
    const deposits = resourceDeposits(map, "World");
    expect(deposits.length).toBeGreaterThan(100);
    for (const resource of NATURAL_RESOURCES) {
      expect(deposits.some((deposit) => deposit.resource === resource)).toBe(true);
    }
    expect(deposits.some((deposit) => deposit.resource === "oil")).toBe(true);
    expect(deposits.every((deposit, i) => deposit.id === i)).toBe(true);
  });
  it("is deterministic across independent clients", () => {
    const first = resourceDeposits(fakeLandMap(2000, 1000), "World");
    const second = resourceDeposits(fakeLandMap(2000, 1000), "World");
    expect(first).toEqual(second);
    const proceduralA = resourceDeposits(fakeLandMap(512, 384), "ArchipelagoSea");
    const proceduralB = resourceDeposits(fakeLandMap(512, 384), "ArchipelagoSea");
    expect(proceduralA).toEqual(proceduralB);
  });
  it("scales to compact maps and keeps some territory empty", () => {
    const map = fakeLandMap(1000, 500);
    const deposits = resourceDeposits(map, "World");
    expect(deposits.length).toBeGreaterThan(100);
    expect(deposits.every((d) =>
      d.x >= 0 && d.x < map.width() && d.y >= 0 && d.y < map.height(),
    )).toBe(true);
    expect(resourceAt(map, "World", -1)).toBeNull();
    expect(resourceAt(map, "World", map.ref(999, 499))).toBeNull();
  });
  it("returns matching deposits and positive finite extractable reserves", () => {
    const map = fakeLandMap(2000, 1000);
    const deposits = resourceDeposits(map, "World");
    for (const site of deposits.slice(0, 20)) {
      expect(site.quality).toBeGreaterThanOrEqual(1);
      expect(site.quality).toBeLessThanOrEqual(4);
      expect(site.capacity).toBeGreaterThan(0);
      expect(resourceAt(map, "World", map.ref(site.x, site.y))).not.toBeNull();
    }
  });
});

// Resource footprints must remain distinct across all resource types, not only
// their visual markers: extraction resolves the deposit covering the tile.
describe("resource footprint spacing", () => {
  it.each([
    [2000, 1000, "World"],
    [1000, 500, "World"],
    [512, 384, "ArchipelagoSea"],
    [32, 32, "World"],
  ])("keeps deposits separate on %sx%s %s", (width, height, mapType) => {
    const map = fakeLandMap(width, height);
    const deposits = resourceDeposits(map, mapType);
    expect(deposits.length).toBeGreaterThan(0);
    for (let i = 0; i < deposits.length; i++) {
      const a = deposits[i];
      expect(resourceAt(map, mapType, map.ref(a.x, a.y))?.id).toBe(a.id);
      for (let j = i + 1; j < deposits.length; j++) {
        const b = deposits[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        expect(dx * dx + dy * dy).toBeGreaterThan((a.radius + b.radius) ** 2);
      }
    }
  });
  it("does not stack resources when only one land tile is available", () => {
    const map = fakeLandMap(2000, 1000);
    const tile = map.ref(484, 284);
    map.isLand = (candidate: number) => candidate === tile;
    const deposits = resourceDeposits(map, "World");
    expect(deposits).toHaveLength(1);
    expect(deposits[0].x).toBe(484);
    expect(deposits[0].y).toBe(284);
  });
  it("does not create deposits on an ocean-only map", () => {
    const map = fakeLandMap(100, 100);
    map.isLand = () => false;
    expect(resourceDeposits(map, "World")).toEqual([]);
  });
});

describe("World resource spacing on real terrain", () => {
  it.each(["map", "map4x"] as const)("separates footprints on %s", (size) => {
    const dir = new URL("./testdata/maps/world/", import.meta.url);
    const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", dir), "utf8"));
    const { width, height } = manifest[size];
    const terrain = fs.readFileSync(new URL(size === "map" ? "map.bin" : "map4x.bin", dir));
    const createMap = () => {
      const map = fakeLandMap(width, height);
      map.isLand = (tile: number) => Boolean(terrain[tile] & 128);
      return map;
    };
    const map = createMap();
    const deposits = resourceDeposits(map, "World");
    expect(new Set(deposits.map((d) => d.resource)).size).toBe(10);
    expect(resourceDeposits(createMap(), "World")).toEqual(deposits);
    for (let i = 0; i < deposits.length; i++) {
      const a = deposits[i];
      expect(a.id).toBe(i);
      expect(map.isLand(map.ref(a.x, a.y))).toBe(true);
      expect(resourceAt(map, "World", map.ref(a.x, a.y))?.id).toBe(a.id);
      for (const b of deposits.slice(i + 1)) {
        expect((a.x - b.x) ** 2 + (a.y - b.y) ** 2).toBeGreaterThan((a.radius + b.radius) ** 2);
      }
    }
  });
});
