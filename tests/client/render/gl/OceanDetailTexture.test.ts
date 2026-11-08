import { describe, expect, it } from "vitest";
import {
  buildOceanDetailTexture, OCEAN_DETAIL_SIZE,
} from "../../../../src/client/render/gl/utils/OceanDetailTexture";

describe("V5 cinematic ocean detail", () => {
  it("generates a deterministic, small, seamless RGBA texture", () => {
    const a = buildOceanDetailTexture();
    const b = buildOceanDetailTexture();
    expect(a).toEqual(b);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.byteLength).toBe(128 * 128 * 4);
    expect(OCEAN_DETAIL_SIZE).toBe(128);
    expect(a.length).toBeLessThan(70_000);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
  });
  it("has real variance rather than a flat blue-noise mask", () => {
    const data = buildOceanDetailTexture();
    const red = new Set<number>(), green = new Set<number>();
    const foam = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      red.add(data[i]); green.add(data[i + 1]); foam.add(data[i + 2]);
    }
    expect(red.size).toBeGreaterThan(25);
    expect(green.size).toBeGreaterThan(25);
    expect(foam.size).toBeGreaterThan(25);
  });
});
