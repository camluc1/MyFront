#version 300 es
precision highp float;

uniform sampler2D uTerrain;
uniform vec3 uBackground;
uniform float uTime;
in vec2 vUV;
in vec2 vScreen;
out vec4 fragColor;

void main() {
  if (all(greaterThanEqual(vUV, vec2(0.0))) && all(lessThanEqual(vUV, vec2(1.0)))) {
    vec4 tile = texture(uTerrain, vUV);
    int terrain = int(tile.a * 255.0 + 0.5);
    bool land = (terrain & 128) != 0;
    int height = terrain & 31;
    vec2 size = vec2(textureSize(uTerrain, 0));
    vec2 world = vUV * size;
    float footprint = max(fwidth(world.x), fwidth(world.y));
    float detail = 1.0 - smoothstep(1.0, 4.0, footprint);
    vec3 color = tile.rgb;
    if (!land) {
      // Continuous world-anchored swells: no random flicker or screen-space swim.
      float swell = sin(world.x * 0.075 + world.y * 0.047 - uTime * 0.38);
      float crossWave = sin(world.x * -0.041 + world.y * 0.091 - uTime * 0.23);
      float crest = pow(max(0.0, sin(world.x * 0.45 + world.y * 0.19 - uTime * 0.65 + swell)), 8.0);
      color *= 1.0 + (swell + crossWave) * 0.025;
      float patches = pow(max(0.0, sin(world.x * 0.13 - world.y * 0.21 + crossWave)), 4.0);
      color += vec3(0.010, 0.018, 0.022) * crest * patches * detail;
      if ((terrain & 64) != 0) color += vec3(0.025, 0.032, 0.03) * (0.5 + 0.5 * swell);
    } else if (height != 31) {
      // Restrained relief from actual neighboring elevations, never from ownership.
      ivec2 coord = ivec2(world);
      ivec2 limit = textureSize(uTerrain, 0) - 1;
      int nw = int(texelFetch(uTerrain, clamp(coord-ivec2(1),ivec2(0),limit),0).a*255.0+0.5);
      int se = int(texelFetch(uTerrain, clamp(coord+ivec2(1),ivec2(0),limit),0).a*255.0+0.5);
      if ((nw & 128) != 0 && (se & 128) != 0 && (nw & 31) != 31 && (se & 31) != 31)
        color *= 1.0 + clamp(float((se & 31)-(nw & 31))*0.009,-0.07,0.07) * detail;
    }
    fragColor = vec4(color, 1.0);
    return;
  }
  // Quiet chart-table surround: static vignette and fine navigation grid.
  // No animation, blur, particles, additional texture or draw call.
  vec2 centered = vScreen - 0.5;
  float vignette = clamp(1.0 - dot(centered, centered) * 1.4, 0.0, 1.0);
  vec2 grid = mod(gl_FragCoord.xy, 64.0);
  float line = 1.0 - step(1.0, min(grid.x, grid.y));
  vec3 color = uBackground * (0.82 + vignette * 0.22);
  color += vec3(0.035, 0.045, 0.055) * line;
  fragColor = vec4(color, 1.0);
}
