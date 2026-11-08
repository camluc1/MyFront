#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec3 aInstPos;   // x, y, fxType
layout(location = 2) in vec2 aInstFlags; // frameIdx (uint8), alpha (uint8)

uniform mat3 uCamera;
#ifdef FRONTIER_CINEMATIC
uniform float uCinematicNukeReady;
uniform float uCinematicImpactReady;
#endif
uniform vec4 uFxUV[FX_TYPE_COUNT];    // vTop, vSpan, uFrameSpan, 0
uniform vec4 uFxWorld[FX_TYPE_COUNT]; // worldW, worldH, 0, 0

out vec2  vAtlasUV;
flat out float vAlpha;
flat out float vFxType;
flat out float vFxProgress;
flat out float vFxFrame;
out vec2 vLocalUV;

void main() {
  int type = int(aInstPos.z + 0.5);
  float frameIdx = floor(aInstFlags.x + 0.5);
  float alpha = aInstFlags.y / 255.0;

  vec4 uv = uFxUV[type];
  vec4 world = uFxWorld[type];

  vec2 center = vec2(aInstPos.x + 0.5, aInstPos.y + 0.5);
#ifdef FRONTIER_CINEMATIC
  // The original 60px mushroom becomes a readable 2D billboard (130 tiles
  // before camera projection). All explosions remain exactly one instance;
  // critically the SAM interception and cosmetic atlas types are untouched.
  bool newNuke = type == 0 && uCinematicNukeReady > 0.5;
  bool newImpact = (type == 2 || type == 3 || type == 4) &&
    uCinematicImpactReady > 0.5;
  float impactScale = newNuke ? 2.12 :
    newImpact ? type == 4 ? 2.1 : type == 2 ? 1.58 : 1.55 :
    type == 0 ? 1.30 : type == 2 ? 1.18 : type == 4 ? 1.55 : 1.0;
#else
  float impactScale = 1.0;
#endif
  vec2 worldPos = center + (aPos - 0.5) *
    vec2(world.x, world.y) * impactScale;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  float u = (frameIdx + aPos.x) * uv.z;
  float v = uv.x + aPos.y * uv.y;
  vAtlasUV = vec2(u, v);
  vAlpha = alpha;
  vFxType = float(type);
  float lastFrame = type == 0 ? 8.0 : type == 2 ? 9.0 :
    type == 3 || type == 4 ? 3.0 : 8.0;
#ifdef FRONTIER_CINEMATIC
  if (newNuke || newImpact) lastFrame = 15.0;
#endif
  vFxProgress = clamp(frameIdx / lastFrame,0.0,1.0);
  vFxFrame = frameIdx;
  vLocalUV = aPos;
}
