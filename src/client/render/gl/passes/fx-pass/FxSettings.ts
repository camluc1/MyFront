/**
 * Pure (no WebGL) helpers that turn the `settings.fx` slice into per-spawn
 * FX parameters. Kept out of the passes so they can be unit-tested.
 */

import {
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_TSAR_BOMBA,
  UT_MIRV_WARHEAD,
} from "../../../types";
import type { RenderSettings } from "../../RenderSettings";
import type { NukeExplosionRenderParams } from "../../../types";

/**
 * Visual explosion radius (shockwave / debris scatter — not the gameplay
 * damage radius) for a detonating unit type, or undefined for non-nukes.
 */
export function nukeExplosionRadius(
  fx: RenderSettings["fx"],
  unitType: string,
): number | undefined {
  switch (unitType) {
    case UT_ATOM_BOMB:
      return fx.nukeRadiusAtom;
    case UT_HYDROGEN_BOMB:
      return fx.nukeRadiusHydro;
    case UT_TSAR_BOMBA:
      // A Tsar detonation must visibly exceed hydrogen as well as
      // doubling its authoritative damage rings. No additional FX pass.
      return fx.nukeRadiusHydro * 2;
    case UT_MIRV_WARHEAD:
      return fx.nukeRadiusMirv;
    default:
      return undefined;
  }
}

/**
 * Cosmetic explosion radius is otherwise absolute and would make the Tsar
 * indistinguishable from hydrogen whenever a player has a cosmetic equipped.
 * Preserve each chosen style and palette while doubling the Tsar's footprint.
 */
export function effectiveNukeExplosionParams(
  unitType: string,
  cosmetic?: NukeExplosionRenderParams,
): NukeExplosionRenderParams | undefined {
  if (!cosmetic || unitType !== UT_TSAR_BOMBA) return cosmetic;
  return { ...cosmetic, maxRadius: cosmetic.maxRadius * 2 };
}
