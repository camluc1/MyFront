#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;
precision highp usampler2D;

uniform usampler2D uTrailTex;     // R16UI — trail texel: owner smallID (bits 0-11)
                                  //   + nuke bit (bit 12); 0 = no trail
uniform sampler2D  uPalette;      // RGBA32F — player colors
uniform sampler2D  uAffiliation;  // RGBA8 — affiliation colors (row 0 = border, row 1 = unit)
uniform sampler2D  uEffect;       // RGBA32F — trail effect, keyed by ownerID. Stacked blocks
                                  //   of MAX_TRAIL_COLORS rows: block 0 = transportShipTrail,
                                  //   block 1 = nukeTrail. Within a block (rowBase = block start):
                                  //   row r = color r's rgb; spare alphas hold scalars:
                                  //   row 0.a = color count (0 = no effect → territory color),
                                  //   row 1.a = styleId (0 = gradient, 1 = transition, 2 = spiral),
                                  //   row 2.a = scalar0 (gradient colorSize / transition freq),
                                  //   row 3.a = scalar1 (gradient movementSpeed)
uniform vec2 uMapSize;
uniform float uTrailAlpha;
uniform float uTime;              // seconds, for animated effect styles
uniform int uAltView;

in vec2 vWorldPos;
out vec4 fragColor;

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  uint trailVal = texelFetch(uTrailTex, tc, 0).r;
  uint owner = trailVal & 0xFFFu;       // bits 0-11 = owner smallID
  if (owner == 0u) discard;
  uint isNuke = (trailVal >> 12) & 1u;  // bit 12 = nuke trail

  vec3 color;
  if (uAltView != 0) {
    // Alt view recolors everything by affiliation — effects stay off so the
    // strategic overlay reads consistently.
    color = texelFetch(uAffiliation, ivec2(int(owner), 1), 0).rgb;
  } else {
    int o = int(owner);
    // Boat trails read block 0; nuke trails read block 1 (rows offset by
    // MAX_TRAIL_COLORS). The effect attributes are otherwise identical.
    int rowBase = isNuke == 1u ? MAX_TRAIL_COLORS : 0;
    int count = int(texelFetch(uEffect, ivec2(o, rowBase), 0).a + 0.5);
    if (count <= 0) {
      // No effect — fall back to the player's territory color.
      float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
      color = texture(uPalette, vec2(u, 0.25)).rgb;
    } else if (count == 1) {
      // Single color — flat trail.
      color = texelFetch(uEffect, ivec2(o, rowBase), 0).rgb;
    } else if (int(texelFetch(uEffect, ivec2(o, rowBase + 1), 0).a + 0.5) == 2) {
      // spiral — the vortex itself renders as ribbon geometry above this
      // pass (SpiralRibbonPass); the stamped centerline underneath draws
      // flat in the first color, as the missile's spine.
      color = texelFetch(uEffect, ivec2(o, rowBase), 0).rgb;
    } else if (int(texelFetch(uEffect, ivec2(o, rowBase + 1), 0).a + 0.5) == 1) {
      // transition — the whole trail is one color at a time, cross-fading
      // through the list over time. frequency = color changes per second.
      float frequency = texelFetch(uEffect, ivec2(o, rowBase + 2), 0).a;
      float t = uTime * frequency;
      int i = int(t) % count;
      int j = (i + 1) % count;
      vec3 a = texelFetch(uEffect, ivec2(o, rowBase + i), 0).rgb;
      vec3 b = texelFetch(uEffect, ivec2(o, rowBase + j), 0).rgb;
      color = mix(a, b, fract(t));
    } else {
      // gradient — cyclic gradient banded across the map (world-space diagonal),
      // scrolling over time so a moving trail shifts hue along it. colorSize
      // = band width in tiles; movementSpeed = tiles/sec the bands travel.
      float colorSize = max(texelFetch(uEffect, ivec2(o, rowBase + 2), 0).a, 0.001);
      float movementSpeed = texelFetch(uEffect, ivec2(o, rowBase + 3), 0).a;
      float cycle = colorSize * float(count);
      float phase =
        fract((vWorldPos.x + vWorldPos.y - uTime * movementSpeed) / cycle);
      float f = phase * float(count);
      int i = int(f) % count;
      int j = (i + 1) % count;
      vec3 a = texelFetch(uEffect, ivec2(o, rowBase + i), 0).rgb;
      vec3 b = texelFetch(uEffect, ivec2(o, rowBase + j), 0).rgb;
      color = mix(a, b, fract(f));
    }
  }
#ifdef FRONTIER_CINEMATIC
  if (isNuke == 0u && uAltView == 0) {
    // The existing stamped boat path doubles as a foamy wake spine when
    // zoomed in. Only occupied trail pixels execute the neighbor lookups;
    // no per-vessel sprites, geometry, map texture or draw pass.
    float footprint = max(fwidth(vWorldPos.x),fwidth(vWorldPos.y));
    float detail = 1.0-smoothstep(0.65,1.85,footprint);
    if (detail > 0.01) {
      ivec2 end = textureSize(uTrailTex,0)-1;
      ivec2 leftPos = clamp(tc+ivec2(-1,0),ivec2(0),end);
      ivec2 rightPos = clamp(tc+ivec2(1,0),ivec2(0),end);
      ivec2 upPos = clamp(tc+ivec2(0,-1),ivec2(0),end);
      ivec2 downPos = clamp(tc+ivec2(0,1),ivec2(0),end);
      uint l = texelFetch(uTrailTex,leftPos,0).r & 0xFFFu;
      uint r = texelFetch(uTrailTex,rightPos,0).r & 0xFFFu;
      uint u = texelFetch(uTrailTex,upPos,0).r & 0xFFFu;
      uint d = texelFetch(uTrailTex,downPos,0).r & 0xFFFu;
      vec2 tangent = vec2(
        (r==owner ? 1.0 : 0.0)-(l==owner ? 1.0 : 0.0),
        (d==owner ? 1.0 : 0.0)-(u==owner ? 1.0 : 0.0));
      if (dot(tangent,tangent)<0.25) tangent=vec2(1.0,0.0);
      vec2 across=normalize(vec2(-tangent.y,tangent.x));
      float lateral=abs(dot(fract(vWorldPos)-vec2(0.5),across));
      float whiteEdge=1.0-smoothstep(0.04,0.27,lateral);
#ifdef FRONTIER_REDUCED_MOTION
      float wave=0.8;
#else
      float wave=0.74+0.26*sin(dot(vWorldPos,tangent)*8.0-uTime*1.6);
#endif
      float foam=whiteEdge*detail*wave;
      color=mix(color,vec3(0.76,0.92,0.96),foam*0.56);
    }
  }
#endif
  fragColor = vec4(color, uTrailAlpha);
}
