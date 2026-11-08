#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;

uniform sampler2D uAtlas;

in vec2 vAtlasUV;
flat in float vAlpha;
flat in float vFxType;
flat in float vFxProgress;
in vec2 vLocalUV;

out vec4 fragColor;

void main() {
  vec4 texel = texture(uAtlas, vAtlasUV);
#ifdef FRONTIER_CINEMATIC
  // The blast remains a single atlas quad: a bright initial pressure flash
  // collapses into fiery textured smoke without any additional particle,
  // screen-space blur, dynamic light or draw pass.
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
    // Retain the detailed silhouette and animated shape of the original
    // sprite; tint the opaque texels rather than painting a solid square.
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
  fragColor = vec4(texel.rgb, texel.a * vAlpha);
}
