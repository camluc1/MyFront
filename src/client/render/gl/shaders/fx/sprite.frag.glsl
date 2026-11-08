#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;

uniform sampler2D uAtlas;
#ifdef FRONTIER_CINEMATIC
uniform sampler2D uCinematicNukeAtlas;
uniform sampler2D uCinematicImpactAtlas;
uniform float uCinematicNukeReady;
uniform float uCinematicImpactReady;
#endif
in vec2 vAtlasUV;
flat in float vAlpha;
flat in float vFxType;
flat in float vFxProgress;
flat in float vFxFrame;
in vec2 vLocalUV;

out vec4 fragColor;

#ifdef FRONTIER_CINEMATIC
// The original artwork is 16 sequential 256x256 cells on a 4x4 1024px atlas.
// Frame sampling stays local to the active sprite: no bleeding or new draw.
vec2 cinematicAtlasUV(float index, vec2 uv) {
  float frame = clamp(floor(index+0.5),0.0,15.0);
  vec2 cell = vec2(mod(frame,4.0),floor(frame/4.0));
  vec2 p = clamp(uv,vec2(0.004),vec2(0.996));
  // SVG rows start at the top; the GPU quad's local y starts at the bottom.
  return (cell+vec2(p.x,1.0-p.y))*0.25;
}
#endif

void main() {
#ifdef FRONTIER_CINEMATIC
  bool newMushroom = vFxType < 0.5 && uCinematicNukeReady > 0.5;
  bool newImpact = (abs(vFxType-2.0)<0.5 ||
    abs(vFxType-3.0)<0.5 || abs(vFxType-4.0)<0.5) &&
    uCinematicImpactReady > 0.5;
  if (newMushroom || newImpact) {
    // The mushroom is a staged fireball, column and smoke cap. Small missile
    // explosions use a completely separate brief blast/smoke sequence.
    vec2 atlasUV=cinematicAtlasUV(vFxFrame,vLocalUV);
    vec4 art;
    if (newMushroom) art=texture(uCinematicNukeAtlas,atlasUV);
    else art=texture(uCinematicImpactAtlas,atlasUV);
    if (art.a < 0.012) discard;
    float initial = pow(1.0-clamp(vFxProgress,0.0,1.0),8.0);
    vec3 warm = vec3(1.0,0.63,0.28) *
      initial * (newMushroom ? 0.13 : 0.10);
#ifdef FRONTIER_REDUCED_MOTION
    warm *= 0.35;
#endif
    fragColor = vec4(min(vec3(1.0),art.rgb+warm),
      clamp(art.a*vAlpha,0.0,1.0));
    return;
  }
#endif
  vec4 texel = texture(uAtlas, vAtlasUV);
#ifdef FRONTIER_CINEMATIC
  // If a new atlas cannot be decoded, gracefully retain the existing V4
  // visual; SAM, custom cosmetics and normal graphics never use this branch.
  bool nuke = vFxType < 0.5;
  bool buildingBlast = abs(vFxType-2.0) < 0.5;
  bool shellBlast = abs(vFxType-4.0) < 0.5;
  if (nuke || buildingBlast || shellBlast) {
    float life = clamp(vFxProgress,0.0,1.0);
    vec2 p = (vLocalUV-0.5)*2.0;
    float radius = length(p);
    float bloom = (1.0-smoothstep(0.06,0.88,radius))*
      pow(1.0-life, nuke ? 4.0 : 2.6);
#ifdef FRONTIER_REDUCED_MOTION
    bloom *= 0.6;
#endif
    float hot = pow(1.0-life,nuke ? 1.7 : 1.3);
    vec3 ash = vec3(0.25,0.24,0.24);
    vec3 orange = vec3(1.0,0.59,0.24);
    vec3 fire = mix(ash,orange,hot);
    vec3 color = mix(texel.rgb,texel.rgb*fire*1.45,
      nuke ? 0.46 : 0.32);
    color += vec3(1.0,0.72,0.32)*bloom*(nuke ? 0.58 : 0.50);
    float alpha = max(texel.a, bloom*(nuke ? 0.26 : 0.17))*vAlpha;
    if (alpha < 0.012) discard;
    fragColor = vec4(min(color,vec3(1.0)),clamp(alpha,0.0,1.0));
    return;
  }
#endif
  if (texel.a < 0.01) discard;
  fragColor = vec4(texel.rgb,texel.a * vAlpha);
}
