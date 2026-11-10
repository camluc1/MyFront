#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;

layout(location = 0) in vec2 aPos;

// Per-instance attributes
layout(location = 1) in vec3 aInstPos;   // x, y, ownerID
layout(location = 2) in vec4 aInstFlags; // atlasIdx, flags, flickerHash (uint8→float)

uniform mat3  uCamera;

uniform float uUnitSize;
uniform float uTrainScale;
uniform vec2 uViewport;
uniform vec4 uFleetReadability; // minimum hull pixels: transport, cargo, warship; maximum enlargement
uniform float uFleetWarshipScale;
uniform float uFunctionalSupportScale;
uniform float uFunctionalShipyard;
uniform float uHBombGlowScale; // quad enlargement for the hydrogen bomb glow halo

out vec2  vQuadPos;     // quad coords [0,1] — drives the radial glow falloff
out vec2  vCellUV;      // sprite cell coords; the central 1/scale region is the sprite
out vec2  vWorldPos;    // world-space tile coords — drives the train effect's gradient
flat out float vAtlasCol;
flat out float vOwnerID;
flat out float vResearchHull;
flat out float vResearchGuns;
flat out float vFlags;  // 0.0 = normal, 1.0 = flicker, 2.0 = angry
flat out float vHash;   // per-instance hash for flicker phase offset
flat out float vStrategic;
flat out float vGlow;   // 1.0 if this instance is a hydrogen bomb (draw glow), else 0.0

void main() {
  float worldX = aInstPos.x;
  float worldY = aInstPos.y;
  vOwnerID = aInstPos.z;

  float atlasCol = aInstFlags.x;
  // Research tiers are packed into spare high bits of the existing flag byte.
  float rawFlags = aInstFlags.y;
  vFlags = uFunctionalShipyard > 0.5 ? mod(rawFlags, 8.0) : rawFlags;
  vResearchGuns = uFunctionalShipyard > 0.5 ? mod(floor(rawFlags / 8.0), 4.0) : 0.0;
  vResearchHull = uFunctionalShipyard > 0.5 ? mod(floor(rawFlags / 32.0), 4.0) : 0.0;
  vAtlasCol = atlasCol;

  // Per-instance hash so each unit flickers independently. Computed CPU-side
  // from the tick position — hashing worldX/Y here would re-roll the phase
  // every frame for nukes whose position is smoothed per frame.
  vHash = aInstFlags.z * (1.0 / 255.0);

  // Hydrogen bombs render an enlarged quad so there's room for a glow halo
  // around the sprite. All other units keep scale 1 (no behavior change).
  float isHBomb = step(abs(atlasCol - float(HYDROGEN_BOMB_COL)), 0.5);
  vGlow = isHBomb;
  float scale = mix(1.0, uHBombGlowScale, isHBomb);
#ifdef FRONTIER_CINEMATIC
  // SAM and naval shells get a little quad margin for a directional exhaust.
  // Not another sprite instance, and not enabled in classic graphics.
  if (atlasCol > 5.5 && atlasCol < 7.5)
    scale = atlasCol < 6.5 ? 1.55 : 1.38;
#endif
  bool vessel = atlasCol < 2.5;
  bool train = atlasCol > 8.5;
  // Extra space behind a hull holds its wake, in the same instanced quad.
  vStrategic = 0.0;
  if (vessel) {
    // The mobile repair base has a carrier-sized flight-deck silhouette,
    // but is a ship repair station (no planes). Grow the existing quad only:
    // it remains one instance with no separate textures or render pass.
    bool repairCarrier = atlasCol > 1.5 && abs(vFlags - 7.0) < 0.1;
    scale = atlasCol > 1.5
      ? uFleetWarshipScale * (repairCarrier ? 1.32 * uFunctionalSupportScale : 1.0)
      : (atlasCol > 0.5 ? 0.64 : 0.82);
    // Screen-space readability, bounded so distant fleets do not cover the map.
    float pixelsPerTile = length(uCamera[0].xy * uViewport * 0.5);
    float hullFraction = atlasCol < 0.5 ? 0.30 : (atlasCol < 1.5 ? 0.43 : (repairCarrier ? 0.83 : 0.685));
    float minimumPixels = atlasCol < 0.5 ? uFleetReadability.x : (atlasCol < 1.5 ? uFleetReadability.y : uFleetReadability.z);
    float hullPixels = max(0.001, uUnitSize * scale * hullFraction * pixelsPerTile);
    float enlargement = clamp(minimumPixels / hullPixels, 1.0, uFleetReadability.w);
    scale *= enlargement;
    vStrategic = smoothstep(0.45, 0.95, minimumPixels / (hullPixels * enlargement));
  }

  // Carriages are spaced two track tiles apart in the simulation. Keep their
  // physical length near that spacing instead of overlapping full-size icons.
  if (train) scale = uTrainScale;

  // UNIT_SIZE is in world-space tiles — no zoom division needed.
  // Units scale with the map like territory tiles do.
  float halfSize = uUnitSize * 0.5 * scale;

  vec2 center = vec2(worldX + 0.5, worldY + 0.5);
  vec2 localPos = (aPos - 0.5) * halfSize * 2.0;
  bool directional = vessel || train;
#ifdef FRONTIER_CINEMATIC
  directional = directional || (atlasCol > 5.5 && atlasCol < 7.5);
#endif
  if (directional) {
    float angle = aInstFlags.w * (6.28318530718 / 255.0);
    float c = cos(angle), s = sin(angle);
    localPos = mat2(c, s, -s, c) * localPos;
  }
  vec2 worldPos = center + localPos;
  vWorldPos = worldPos;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vQuadPos = aPos;

  // Map the enlarged quad back to sprite cell space: the central 1/scale
  // portion is the sprite, anything outside [0,1] is glow-only margin.
  vCellUV = (vessel || train) ? aPos : (aPos - 0.5) * scale + 0.5;
}
