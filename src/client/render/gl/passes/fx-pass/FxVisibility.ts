/**
 * Conservative screen-space culling for existing FX sprites.
 *
 * Matches sprite.vert.glsl's world sizes, scaling and nuclear ground anchor.
 * No allocations on the render path, no texture or geometry changes.
 * Offscreen FX remain alive so panning back before expiration still shows them.
 */
import fxAtlasMeta from "resources/atlases/fx-atlas-meta.json";

export interface FxVisibilityItem {
  x: number;
  y: number;
  fxType: number;
  cinematic: boolean;
  scale: number;
}

const NUCLEAR_ANCHOR_Y = 219 / 256;
const CLIP_PADDING = 0.025;

export function isFxVisible(
  camera: Float32Array,
  fx: FxVisibilityItem,
): boolean {
  const type = fx.fxType;
  const row = fxAtlasMeta.rows[type];
  // Procedural naval/SAM launch flashes are included in the same atlas uniform
  // but don't have texel rows in the classic sprite sheet.
  const width = row?.worldWidth ?? (type === 12 ? 20 : 18);
  const height = row?.worldHeight ?? (type === 12 ? 20 : 18);

  const cinematicNuke = fx.cinematic && type === 0;
  const cinematicImpact = fx.cinematic && type >= 2 && type <= 4;
  let spriteScale = 1;
  let verticalReach = 0.5;

  if (cinematicNuke) {
    spriteScale = 2.12 * fx.scale;
    // Nuclear artwork expands much farther above its ground impact.
    verticalReach = Math.max(NUCLEAR_ANCHOR_Y, 1 - NUCLEAR_ANCHOR_Y);
  } else if (cinematicImpact) {
    spriteScale = type === 4 ? 2.1 : type === 2 ? 1.58 : 1.55;
  } else {
    spriteScale = type === 0 ? 1.30 : type === 2 ? 1.18 :
      type === 4 ? 1.55 : 1;
  }

  const rx = width * spriteScale * 0.5;
  const ry = height * spriteScale * verticalReach;
  const x = fx.x + 0.5;
  const y = fx.y + 0.5;
  const cx = camera[0] * x + camera[3] * y + camera[6];
  const cy = camera[1] * x + camera[4] * y + camera[7];
  // Conservative for rotated/skewed map cameras as well as standard ones.
  const sx = Math.abs(camera[0]) * rx + Math.abs(camera[3]) * ry;
  const sy = Math.abs(camera[1]) * rx + Math.abs(camera[4]) * ry;
  return cx + sx >= -1 - CLIP_PADDING &&
    cx - sx <= 1 + CLIP_PADDING &&
    cy + sy >= -1 - CLIP_PADDING &&
    cy - sy <= 1 + CLIP_PADDING;
}
