import { describe, expect, it } from "vitest";
import { NATURAL_RESOURCES, RESOURCE_CATEGORY, WORLD_RESOURCE_PROFILES, worldResourceProfile } from "../../packages/engine-lib/src/game/NaturalResources";
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
