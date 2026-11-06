#version 300 es
precision highp float;

uniform sampler2D uPalette;
uniform sampler2D uAtlas;
uniform sampler2D uAffiliation;   // 256×2 RGBA8 — row 1 = unit affiliation
uniform sampler2D uEffect;        // RGBA32F — shared effect palette, keyed by
                                  //   ownerID. The warship block starts at row
                                  //   WARSHIP_EFFECT_ROW_BASE and the train
                                  //   block at TRAIN_EFFECT_ROW_BASE; same
                                  //   layout as trail/structure.frag.glsl (row r =
                                  //   color r's rgb; row 0.a = count,
                                  //   1.a = styleId, 2.a = scalar0,
                                  //   3.a = scalar1)
uniform float uTime;              // seconds, for animated effect styles
uniform float uTick;
uniform float uFlickerSpeed;
uniform vec3  uAngryColor;
uniform int   uAltView;
uniform vec3  uSelfColor;         // affiliation self/ally colors (alt-view trade ships)
uniform vec3  uAllyColor;
uniform vec3  uHBombGlowColor;
uniform float uHBombGlowStrength;
uniform float uHBombGlowInner;
uniform float uUntargetableAlpha;

in vec2  vQuadPos;
in vec2  vCellUV;
in vec2  vWorldPos;
flat in float vAtlasCol;
flat in float vOwnerID;
flat in float vFlags;
flat in float vHash;
flat in float vGlow;

out vec4 fragColor;

// Flag constants — must match CPU-side FLAG_* values
const float FLAG_FLICKER        = 1.0;
const float FLAG_ANGRY          = 2.0;
const float FLAG_TRADE_FRIENDLY = 3.0;
const float FLAG_RETREATING     = 4.0;
const float FLAG_FLICKER_UNTARGETABLE = 5.0; // nuke out of SAM range — dimmed
const float FLAG_TRADE_SELF     = 6.0;

// Flicker hot colors: red → orange → yellow → white
const vec3 FLICKER_COLORS[4] = vec3[4](
  vec3(1.0, 0.0, 0.0),   // red
  vec3(1.0, 0.5, 0.0),   // orange
  vec3(1.0, 1.0, 0.0),   // yellow
  vec3(1.0, 1.0, 1.0)    // white
);

// The owner's sprite cosmetic color, if equipped, from the effect-palette
// block starting at row rowBase (the warship or train block). Returns false
// when the owner has no effect in that block (count 0).
//
// `coord` positions the gradient: with iconSpace the caller passes the sprite
// diagonal in 0..1 (the palette spans the sprite once, sliding one cycle every
// colorSize · count / movementSpeed seconds — structure.frag.glsl semantics);
// otherwise it passes the world diagonal x + y (colorSize = band width in
// tiles, movementSpeed = tiles/sec — trail.frag.glsl semantics).
bool spriteEffectColor(int rowBase, int owner, float coord, bool iconSpace, out vec3 color) {
  int count = int(texelFetch(uEffect, ivec2(owner, rowBase), 0).a + 0.5);
  if (count <= 0) return false;
  if (count == 1) {
    // Single color — flat recolor.
    color = texelFetch(uEffect, ivec2(owner, rowBase), 0).rgb;
  } else if (int(texelFetch(uEffect, ivec2(owner, rowBase + 1), 0).a + 0.5) == 1) {
    // transition — one color at a time, cross-fading through the list.
    // frequency = color changes per second.
    float frequency = texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a;
    float t = uTime * frequency;
    int i = int(t) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(t));
  } else {
    // gradient — cyclic palette along `coord` (see above), scrolling over
    // time.
    float colorSize = max(texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a, 0.001);
    float movementSpeed = texelFetch(uEffect, ivec2(owner, rowBase + 3), 0).a;
    float cycle = colorSize * float(count);
    float c = iconSpace ? coord : coord / cycle;
    float phase = fract(c - uTime * movementSpeed / cycle);
    float f = phase * float(count);
    int i = int(f) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(f));
  }
  return true;
}

// Compact vector silhouettes. No texture download or per-vessel draw call.
// +X is the bow; palette gray bands retain ownership, combat and cosmetics.
vec4 vehicleSprite(vec2 q, float col) {
  float aa = max(fwidth(q.x), fwidth(q.y));
  float detail = 1.0 - smoothstep(0.10, 0.25, aa);
  float gray = 0.706;
  float d;
  if (col < 2.5) {
    bool warship = col > 1.5;
    bool cargo = col > 0.5 && col < 1.5;
    float length = warship ? 0.55 : 0.38;
    float beam = warship ? 0.22 : 0.17;
    float taper = clamp((length - q.x) / (length * 0.48), 0.0, 1.0);
    float width = beam * taper;
    d = max(abs(q.y) - width, max(-length * 0.75 - q.x, q.x - length));
    if (abs(q.y) > width - 0.035 || q.x < -length * 0.75 + 0.035) gray = 0.275;
    if (detail > 0.1) {
      // Raised bridge and a bright deck seam; different cargo/transport decks.
      if (abs(q.x + length * 0.35) < length * 0.20 && abs(q.y) < beam * 0.65) gray = 0.51;
      if (cargo && q.x > -0.06 && q.x < length * 0.55 && abs(q.y) < beam * 0.65)
        gray = mod(floor(q.x * 22.0), 2.0) < 1.0 ? 0.51 : 0.706;
      if (abs(q.x + length * 0.35) < length * 0.14 && abs(q.y) < beam * 0.42) gray = 0.92;
      if (warship) {
        if (abs(q.x + 0.03) < 0.08 && abs(q.y) < 0.105) gray = 0.51;
        if (abs(q.x + 0.03) < 0.045 && abs(q.y) < 0.065) gray = 0.92;
        if (distance(q, vec2(0.23,0.0)) < 0.065) gray = 0.51;
        if (q.x > 0.23 && q.x < 0.43 && abs(q.y) < 0.018) gray = 0.275;
        if (q.x > -0.28 && q.x < 0.30 && abs(q.y + 0.155) < 0.012) gray = 0.92;
      }
    }
  } else {
    bool engine = col < 9.5;
    vec2 halfBody = vec2(engine ? 0.39 : 0.34, 0.18);
    d = max(abs(q.x) - halfBody.x, abs(q.y) - halfBody.y);
    if (abs(q.y) > 0.13 || abs(q.x) > halfBody.x - 0.04) gray = 0.275;
    if (engine && q.x > 0.14 && abs(q.y) < 0.12) gray = 0.51;
    if (engine && detail > 0.1) {
      if (q.x > 0.18 && q.x < 0.29 && abs(q.y) < 0.10) gray = 0.92;
      if (q.x < 0.08 && q.x > -0.22 && abs(q.y) < 0.09) gray = 0.51;
    }
    if (!engine && col > 10.5 && abs(q.x) < 0.26 && abs(q.y) < 0.11)
      gray = mod(floor(q.x * 18.0), 2.0) < 1.0 ? 0.51 : 0.706;
    if (detail > 0.1 && abs(q.y) > 0.16 && abs(abs(q.x) - 0.22) < 0.06) {
      d = min(d, max(abs(abs(q.x) - 0.22) - 0.06, abs(q.y) - 0.23));
      gray = 0.275;
    }
  }
  float alpha = 1.0 - smoothstep(-aa, aa, d);
  return vec4(vec3(gray), alpha);
}

void main() {
  // Untargetable nukes render translucent so players know SAMs can't hit them
  float alphaMul = abs(vFlags - FLAG_FLICKER_UNTARGETABLE) < 0.1
    ? uUntargetableAlpha
    : 1.0;

  // The sprite lives in the central cell-space region [0,1]; for the enlarged
  // hydrogen-bomb quad, anything outside that range is glow-only margin.
  vec4 texel = vec4(0.0);
  bool inSprite = vCellUV.x >= 0.0 && vCellUV.x <= 1.0 &&
                  vCellUV.y >= 0.0 && vCellUV.y <= 1.0;
  bool vessel = vAtlasCol < 2.5;
  bool train = vAtlasCol > 8.5;
  vec2 q = (vCellUV - 0.5) * 2.0;
  if (vessel || train) {
    texel = vehicleSprite(q, vAtlasCol);
    // A short, tapered V wake fades out at distant zoom. No particles or history buffers.
    if (vessel && vHash > 0.5 && texel.a < 0.05 && uAltView == 0) {
      float stern = vAtlasCol > 1.5 ? -0.4125 : -0.285;
      float behind = stern - q.x;
      float aa = max(fwidth(q.x), fwidth(q.y));
      float spread = 0.10 + behind * 0.32;
      float edge = abs(abs(q.y) - spread);
      float foam = 1.0 - smoothstep(0.012, 0.025 + aa, edge);
      float fade = (1.0 - smoothstep(0.0, 0.55, behind)) * step(0.0, behind);
      float lod = 1.0 - smoothstep(0.12, 0.28, aa);
      float ripple = 0.80 + 0.20 * sin(behind * 35.0 - uTime * 3.0);
      float wake = foam * fade * lod * ripple * 0.38;
      if (wake > 0.005) { fragColor = vec4(0.78, 0.90, 0.94, wake); return; }
    }
  } else if (inSprite) {
    vec2 atlasUV = vec2((vAtlasCol + vCellUV.x) / float(ATLAS_COLS), vCellUV.y);
    texel = texture(uAtlas, atlasUV);
  }

  // Outside the sprite: render the steady soft glow under the hydrogen bomb,
  // otherwise discard. Glow is suppressed in alt (affiliation) view.
  if (texel.a < 0.01) {
    if (vGlow > 0.5 && uAltView == 0) {
      float d = length(vQuadPos - 0.5) * 2.0; // 0 at center → ~1 at quad edge
      float g = (1.0 - smoothstep(uHBombGlowInner, 1.0, d)) * uHBombGlowStrength;
      if (g > 0.001) {
        fragColor = vec4(uHBombGlowColor, g * alphaMul);
        return;
      }
    }
    discard;
  }

  float gray = texel.r;

  // Alt-view: solid affiliation color, no gray-replacement bands
  if (uAltView != 0) {
    // Trade ships: green if self is on either end, yellow if an ally is
    vec3 ac = abs(vFlags - FLAG_TRADE_SELF) < 0.1
      ? uSelfColor
      : abs(vFlags - FLAG_TRADE_FRIENDLY) < 0.1
        ? uAllyColor
        : texelFetch(uAffiliation, ivec2(int(vOwnerID), 1), 0).rgb;
    fragColor = vec4(ac, texel.a * alphaMul);
    return;
  }

  // Player color lookup from palette
  float u = (vOwnerID + 0.5) / float(PALETTE_SIZE);
  vec3 territoryColor = texture(uPalette, vec2(u, 0.25)).rgb;
  vec3 borderColor    = texture(uPalette, vec2(u, 0.75)).rgb;

  // warship cosmetic: recolor the warship's territory-color bands with the
  // owner's effect (raw catalog colors, like trails). The border band keeps
  // the player color so ownership stays readable, and combat signals win: the
  // angry (attacking) override below replaces this with red, and the retreat
  // blink still darkens the center band.
  if (abs(vAtlasCol - float(WARSHIP_COL)) < 0.1) {
    vec3 effectRGB;
    float dn = (vCellUV.x + vCellUV.y) * 0.5; // sprite diagonal, 0..1
    if (spriteEffectColor(WARSHIP_EFFECT_ROW_BASE, int(vOwnerID + 0.5), dn, true, effectRGB)) {
      territoryColor = effectRGB;
    }
  }

  // train cosmetic: the train sprites (engine, carriage, loaded carriage) are
  // the last three atlas columns. The engine is drawn entirely in the border
  // band and the carriages are a border-band frame around a territory-band
  // fill, so recolor both bands — the border band darkened — to keep that
  // engine/frame/fill structure while the whole train takes the effect.
  // The gradient is world-space (like trails and the railroad effect): the
  // 5×5 train sprites fill only the middle of the 13-tile unit cell, so an
  // icon-space gradient would show a sliver of the palette per car, whereas a
  // world-space one runs along the whole train.
  if (vAtlasCol > float(TRAIN_FIRST_COL) - 0.1) {
    vec3 effectRGB;
    float diag = vWorldPos.x + vWorldPos.y;
    if (spriteEffectColor(TRAIN_EFFECT_ROW_BASE, int(vOwnerID + 0.5), diag, false, effectRGB)) {
      territoryColor = effectRGB;
      borderColor = effectRGB * 0.6;
    }
  }

  // Flag states (uint8 passed as float via vertex attribute):
  //   0 = normal
  //   1 = flicker (nukes/warheads — cycling hot colors)
  //   2 = angry (warships attacking — outer ring (180 band) solid red)
  //   4 = retreating (warships fleeing to port — blinking black center)
  float retreatBlink = 0.0;
  if (abs(vFlags - FLAG_ANGRY) < 0.1) {
    // Angry: the outer ring (180) and center (100) go red via territoryColor
    territoryColor = uAngryColor;
  } else if (abs(vFlags - FLAG_RETREATING) < 0.1) {
    // Retreating: slowly blink the center (100 band) black so the ship reads as fleeing
    retreatBlink = step(0.5, fract(uTick * 0.07));
  } else if (abs(vFlags - FLAG_FLICKER) < 0.1 ||
             abs(vFlags - FLAG_FLICKER_UNTARGETABLE) < 0.1) {
    // Flicker: cycle through hot colors, offset by position hash
    float phase = fract(uTick * uFlickerSpeed + vHash);
    int idx = int(phase * 4.0) % 4;
    territoryColor = FLICKER_COLORS[idx];
    borderColor = FLICKER_COLORS[(idx + 2) % 4];
  }

  // Four-band gray replacement:
  //   180/255 ~ 0.706 -> territory color (light band)
  //   130/255 ~ 0.510 -> spawn/mid color (interpolated; used by missiles)
  //   100/255 ~ 0.392 -> center accent (warship center — tracks ring, blinks black)
  //   70/255  ~ 0.275 -> border color (dark band)
  vec3 spawnColor = mix(territoryColor, borderColor, 0.5);
  vec3 centerColor = mix(territoryColor, vec3(0.0), retreatBlink);

  vec3 color;
  if (gray > 0.6) {
    // Light band (180) -> territory color
    color = territoryColor;
  } else if (gray > 0.45) {
    // Mid band (130) -> spawn color
    color = spawnColor;
  } else if (gray > 0.34) {
    // Center accent band (100) -> center color
    color = centerColor;
  } else {
    // Dark band (70) -> border color
    color = borderColor;
  }

  if ((vessel || train) && gray > 0.45) {
    // Baked-style bevel, not dynamic lighting or a shadow pass.
    if (gray > 0.85) color = mix(territoryColor, vec3(0.86, 0.91, 0.89), 0.65);
    float edgeLight = (1.0 - smoothstep(-0.16, 0.10, q.y)) * 0.18;
    color = mix(color, vec3(0.87, 0.93, 0.95), edgeLight);
  }
  fragColor = vec4(color, texel.a * alphaMul);
}
