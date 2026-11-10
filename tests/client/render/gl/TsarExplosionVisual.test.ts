import { describe, expect, it } from "vitest";
import {
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_TSAR_BOMBA,
  UT_MIRV_WARHEAD,
} from "../../../../src/client/render/types/UnitType";
import { nukeExplosionRadius } from "../../../../src/client/render/gl/passes/fx-pass/FxSettings";
import type { RenderSettings } from "../../../../src/client/render/gl/RenderSettings";

describe("functional Tsar Bomba visual blast contract", () => {
  it("spawns an FX blast twice the hydrogen size without affecting classic weapons", () => {
    const fx = {
      nukeRadiusAtom: 13,
      nukeRadiusHydro: 55,
      nukeRadiusMirv: 8,
    } as RenderSettings["fx"];
    expect(nukeExplosionRadius(fx, UT_ATOM_BOMB)).toBe(13);
    expect(nukeExplosionRadius(fx, UT_HYDROGEN_BOMB)).toBe(55);
    expect(nukeExplosionRadius(fx, UT_TSAR_BOMBA)).toBe(110);
    expect(nukeExplosionRadius(fx, UT_MIRV_WARHEAD)).toBe(8);
    expect(nukeExplosionRadius(fx, "City")).toBeUndefined();
  });
});
