import { describe, expect, it, vi } from "vitest";
import { TerrainPass } from "../../../../src/client/render/gl/passes/TerrainPass";
import { buildTerrainRGBA } from "../../../../src/client/render/gl/utils/ColorUtils";

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
});
