/**
 * GPU-ready color utilities.
 *
 * Terrain RGBA: Uint8Array(w × h × 4) — one RGBA pixel per tile, computed
 * from the terrain color rules applied to the raw terrain byte layout.
 *
 * Player palette is NOT built here — consumers provide a pre-built
 * Float32Array(PALETTE_SIZE × 2 × 4) to the GPURenderer constructor.
 */

import renderDefaults from "../render-settings.json";

/** Must cover 12-bit smallID range (0-4095). */
const PALETTE_SIZE = 4096;

export function getPaletteSize(): number {
  return PALETTE_SIZE;
}

/**
 * Max colors per trail gradient = rows per block in the trail-effect texture.
 * Longer catalog color lists are truncated. Shared so the CPU side that fills
 * the texture and the GPU side that allocates it can't drift.
 */
export const MAX_TRAIL_COLORS = 8;

/**
 * The effect-palette texture stacks one MAX_TRAIL_COLORS-row block per
 * trail-styled effectType: block 0 = transportShipTrail, block 1 = nukeTrail
 * (matching the nuke bit in trail.frag.glsl), block 2 = structures (read by
 * structure.frag.glsl), block 3 = warship and block 4 = train (both read by
 * unit.frag.glsl), block 5 = railroad (read by railroad.frag.glsl). Bump this
 * if another trail-styled effectType is added (and give its consumer shader
 * the new rowBase).
 */
export const EFFECT_PALETTE_BLOCKS = 6;

/** Block index of the structures effect within the effect-palette texture. */
export const STRUCTURES_EFFECT_BLOCK = 2;

/** Block index of the warship effect within the effect-palette texture. */
export const WARSHIP_EFFECT_BLOCK = 3;

/** Block index of the train effect within the effect-palette texture. */
export const TRAIN_EFFECT_BLOCK = 4;

/** Block index of the railroad effect within the effect-palette texture. */
export const RAILROAD_EFFECT_BLOCK = 5;

// ---------- Terrain ----------

/** Parse a "#rrggbb" (or "rrggbb") hex string into an RGB tuple, or null. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Default base (shallowest, magnitude 0) color for deep water. Derived from
 * the `terrain.oceanColor` default in render-settings.json (the single source
 * of truth); used as a fallback when no override color is supplied.
 */
const DEEP_WATER_BASE: readonly [number, number, number] = hexToRgb(
  renderDefaults.terrain.oceanColor,
)!;

/**
 * Default map background color, from `terrain.backgroundColor` in
 * render-settings.json; used as a fallback when no override is supplied.
 */
const BACKGROUND_BASE: readonly [number, number, number] = hexToRgb(
  renderDefaults.terrain.backgroundColor,
)!;

const DEFAULT_SAND = hexToRgb(renderDefaults.terrain.sandColor)!;
const DEFAULT_PLAINS = hexToRgb(renderDefaults.terrain.plainsColor)!;
const DEFAULT_HIGHLAND = hexToRgb(renderDefaults.terrain.highlandColor)!;
const DEFAULT_MOUNTAIN = hexToRgb(renderDefaults.terrain.mountainColor)!;

/**
 * Compute a static RGBA8 texture from raw terrain bytes.
 * The single source of truth for terrain colors.
 *
 * Terrain byte layout per tile:
 *   bit 7: isLand
 *   bit 6: isShoreline
 *   bit 5: isOcean  (water only)
 *   bits 0-4: magnitude (0-31)
 *
 * Impassable terrain is encoded as isLand=1 + magnitude=31. It renders as
 * the map background colour (matching `gl.clearColor` in Renderer.ts) so the
 * map appears non-rectangular — the impassable regions are visually
 * indistinguishable from the area outside the map.
 */
/** Encode one terrain byte → RGBA, writing into `out[offset..offset+3]`. */
export interface TerrainColorOverrides {
  backgroundColor?: readonly [number, number, number];
  oceanColor?: readonly [number, number, number];
  sandColor?: readonly [number, number, number];
  plainsColor?: readonly [number, number, number];
  highlandColor?: readonly [number, number, number];
  mountainColor?: readonly [number, number, number];
}

export function encodeTerrainTile(
  tb: number,
  out: Uint8Array,
  offset: number,
  colors?: TerrainColorOverrides,
): void {
  const backgroundColor = colors?.backgroundColor;
  const oceanColor = colors?.oceanColor;
  const sandColor = colors?.sandColor;
  const plainsColor = colors?.plainsColor;
  const highlandColor = colors?.highlandColor;
  const mountainColor = colors?.mountainColor;

  const isLand = (tb & 0x80) !== 0;
  const isShoreline = (tb & 0x40) !== 0;
  const magnitude = tb & 0x1f;

  let r: number, g: number, b: number;

  const terrainColors = {
    ocean: oceanColor ?? DEEP_WATER_BASE,
    shoreWater: [100, 143, 255],
    sand: sandColor ?? DEFAULT_SAND,
    plains: plainsColor ?? DEFAULT_PLAINS,
    highland: highlandColor ?? DEFAULT_HIGHLAND,
    mountain: mountainColor ?? DEFAULT_MOUNTAIN,
    peak: backgroundColor ?? BACKGROUND_BASE,
  };

  // Impassable terrain: render as the map background colour so it blends
  // with the area outside the map quad. Must match the clear colour in
  // Renderer.ts drawBaseLayer() (settings.terrain.backgroundColor).
  if (isLand && magnitude === 31) {
    [r, g, b] = terrainColors.peak;
  } else if (isLand && isShoreline) {
    [r, g, b] = terrainColors.sand;
  } else if (isLand) {
    // Smooth biome ramps prevent abrupt white plateaus at height 20.
    // Height 31 remains impassable and was handled above.
    let low: readonly number[], high: readonly number[], t: number;
    if (magnitude < 10) {
      low = terrainColors.plains;
      high = terrainColors.highland;
      t = Math.max(0, (magnitude - 5) / 5);
    } else if (magnitude < 20) {
      low = terrainColors.highland;
      high = terrainColors.mountain;
      t = (magnitude - 10) / 16;
    } else {
      low = terrainColors.highland;
      high = terrainColors.mountain;
      t = 0.625 + (magnitude - 20) * 0.0375;
    }
    t = Math.min(1, t);
    r = Math.round(low[0] + (high[0] - low[0]) * t);
    g = Math.round(low[1] + (high[1] - low[1]) * t);
    b = Math.round(low[2] + (high[2] - low[2]) * t);
  } else if (isShoreline) {
    // Coastal shallows stay related to the selected ocean color.
    const base = oceanColor ?? DEEP_WATER_BASE;
    r = Math.min(255, base[0] + 24);
    g = Math.min(255, base[1] + 34);
    b = Math.min(255, base[2] + 30);
  } else {
    // Deep water — darkens with depth (magnitude). The base color sets the
    // shallowest (brightest) shade; the per-depth gradient is preserved by
    // subtracting the depth from each channel.
    const m = Math.min(magnitude, 10);
    const base = terrainColors.ocean;
    r = Math.max(0, base[0] - m);
    g = Math.max(0, base[1] - m);
    b = Math.max(0, base[2] - m);
  }

  out[offset] = r;
  out[offset + 1] = g;
  out[offset + 2] = b;
  out[offset + 3] = 255;
}

export function buildTerrainRGBA(
  terrainBytes: Uint8Array,
  w: number,
  h: number,
  colors?: TerrainColorOverrides,
): Uint8Array {
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    encodeTerrainTile(terrainBytes[i], pixels, i * 4, colors);
  }
  return pixels;
}
