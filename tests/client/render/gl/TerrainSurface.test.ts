import { describe, expect, it, vi } from "vitest";
import { TerrainPass } from "../../../../src/client/render/gl/passes/TerrainPass";
import {
  buildTerrainRGBA,
  encodeTerrainTile,
} from "../../../../src/client/render/gl/utils/ColorUtils";

describe("terrain surface classification", () => {
  it("retains user colors while packing land, water and impassable metadata", () => {
    const pass = Object.create(TerrainPass.prototype);
    const terrain = new Uint8Array([32, 64, 128, 159]);
    const colors = { oceanColor: [20, 40, 60] as const };
    Object.assign(pass, { mapW: 4, mapH: 1, terrainColors: colors });
    const rgba = pass.bakeTerrain(terrain);
    const expected = buildTerrainRGBA(terrain, 4, 1, colors);
    for (let i = 0; i < 4; i++) {
      expect(rgba.slice(i * 4, i * 4 + 3)).toEqual(
        expected.slice(i * 4, i * 4 + 3),
      );
      expect(rgba[i * 4 + 3]).toBe(terrain[i]);
    }
  });
  it("updates surface metadata on land-to-water conversions", () => {
    const upload = vi.fn();
    const pass = Object.create(TerrainPass.prototype);
    Object.assign(pass, {
      gl: { bindTexture: vi.fn(), pixelStorei: vi.fn(), texSubImage2D: upload },
      rgbaScratch: new Uint8Array(0),
    });
    pass.applyTerrainRects(
      [{ x: 0, y: 0, w: 2, h: 1 }],
      new Uint8Array([32, 64]),
    );
    const rgba = upload.mock.calls[0][8] as Uint8Array;
    expect([rgba[3], rgba[7]]).toEqual([32, 64]);
  });
  it("keeps impassable tiles and custom coast colors recognizable", () => {
    const pixel = new Uint8Array(4);
    encodeTerrainTile(159, pixel, 0, { backgroundColor: [9, 18, 27] });
    expect([...pixel]).toEqual([9, 18, 27, 255]);
    encodeTerrainTile(192, pixel, 0, { sandColor: [123, 145, 167] });
    expect([...pixel]).toEqual([123, 145, 167, 255]);
  });
  it("avoids a white cliff at the rock/snow boundary and leaves source data intact", () => {
    const source = Uint8Array.from({ length: 31 }, (_, i) => 128 + i);
    const original = source.slice();
    const rgba = buildTerrainRGBA(source, 31, 1);
    expect(source).toEqual(original);
    for (let h = 1; h < 31; h++)
      for (let channel = 0; channel < 3; channel++)
        expect(
          Math.abs(rgba[h * 4 + channel] - rgba[(h - 1) * 4 + channel]),
        ).toBeLessThan(12);
    expect(rgba[20 * 4]).toBeLessThan(rgba[30 * 4]);
  });
});
