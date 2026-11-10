#version 300 es
// FRONTIER_CINEMATIC_VARIANT
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
uniform vec4 uNavalPulse; // warship opacity, transport opacity, period, radius
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
flat in float vResearchHull;
flat in float vResearchGuns;
flat in float vHash;
flat in float vStrategic;
flat in float vGlow;

out vec4 fragColor;

// Flag constants — must match CPU-side FLAG_* values
const float FLAG_FLICKER        = 1.0;
const float FLAG_ANGRY          = 2.0;
const float FLAG_TRADE_FRIENDLY = 3.0;
const float FLAG_RETREATING     = 4.0;
const float FLAG_FLICKER_UNTARGETABLE = 5.0; // nuke out of SAM range — dimmed
const float FLAG_TRADE_SELF     = 6.0;
const float FLAG_SUPPORT_SHIP   = 7.0;

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
vec4 vehicleSprite(vec2 q, float col, out float signedHullDistance) {
  float aa = max(fwidth(q.x), fwidth(q.y));
  float detail = 1.0 - smoothstep(0.10, 0.25, aa);
  float gray = 0.706;
  float d;
  if (col < 2.5) {
    bool cargo=col>0.5 && col<1.5;
    bool warship=col>1.5;
    bool repairCarrier=warship && abs(vFlags-FLAG_SUPPORT_SHIP)<0.1;
    // A repair carrier needs a broad, long service deck; a battleship's
    // narrow hull made the support unit look like an empty destroyer.
    float stern=repairCarrier ? -0.75 : (warship ? -0.62 : (cargo ? -0.37 : -0.29));
    float bow=repairCarrier ? 0.80 : (warship ? 0.72 : (cargo ? 0.45 : 0.34));
    float beam=repairCarrier ? 0.265 : (warship ? 0.17 : (cargo ? 0.23 : 0.18));
    // A proper tapered waterline, with a rounded stern and a distinct bow.
    float width=beam*min(clamp((bow-q.x)/(warship ? 0.32 : 0.20),0.0,1.0),clamp((q.x-stern)/0.08,0.0,1.0));
    if(col<0.5) width=beam*clamp((q.x-stern)/0.07,0.0,1.0);
    d=max(abs(q.y)-width,max(stern-q.x,q.x-bow));
    gray=abs(q.y)>width-0.025 ? 0.275 : 0.706;
    // Large clear deck areas, rather than dozens of subpixel grid lines.
    if(cargo) {
      // Coaster seen from above: rounded transom, raised rear bridge, long
      // recessed cargo hold, tapered forecastle. The hold is not the hull.
#ifdef FRONTIER_CINEMATIC_ULTRA
      // Round the bow and square off the stern without touching the hull bounds.
      float fore=sqrt(clamp((bow-q.x)/0.16,0.0,1.0));
      float aft=clamp((q.x-stern)/0.035,0.0,1.0);
#else
      float fore=clamp((bow-q.x)/0.22,0.0,1.0);
      float aft=sqrt(clamp((q.x-stern)/0.12,0.0,1.0));
#endif
      width=beam*min(fore,aft);
      d=max(abs(q.y)-width,max(stern-q.x,q.x-bow));
      gray=abs(q.y)>width-0.028 ? 0.275 : 0.706;
      if(q.x>-.13 && q.x<.27 && abs(q.y)<.17)gray=.51;
      // Separate, staggered container bays; broad forms survive small scales.
      if(q.x>-.09 && q.x<.23 && abs(q.y)<.135)gray=.80;
      if(detail>.1 && q.x>-.09 && q.x<.23 && abs(q.y)<.14) {
        if(abs(q.x-.015)<.015 || abs(q.x-.125)<.015 || abs(q.y)<.012)gray=.51;
      }
      if(q.x>-.30 && q.x<-.17 && abs(q.y)<.15)gray=.92;
      if(q.x>-.27 && q.x<-.23 && abs(q.y)<.055)gray=.51;
      if(length(q-vec2(-.28,.08))<.025)gray=.275;
      if(detail>.1 && q.x>-.20 && q.x<-.17 && abs(q.y)<.10)gray=.275;
      if(detail>.1 && q.x>.29 && q.x<.34 && abs(q.y)<.025)gray=.92;
    } else if(warship) {
      if (repairCarrier) {
#ifdef FRONTIER_CINEMATIC_ULTRA
        // Ultra Portabuques: big service deck, two drydock bays and bridge.
        // Keep the broad carrier silhouette and existing logical quad.
        if (abs(q.x)<0.63 && abs(q.y)<0.20) gray=0.51;
        if (abs(q.x)<0.55 && abs(q.y)<0.157) gray=0.73;
        float bay=max(abs(q.x+0.05)-0.26,abs(abs(q.y)-0.099)-0.053);
        if(bay<0.0)gray=0.88;
        if(bay< -0.030)gray=0.51;
        if(abs(q.x)<0.55 && abs(q.y)<0.022)gray=0.275;
        // Clearly offset bridge, not a spherical radar dome.
        if(q.x> -0.43 && q.x< -0.20 && q.y>0.13 && q.y<0.247)gray=0.92;
        if(q.x> -0.38 && q.x< -0.25 && q.y>0.165 && q.y<0.218)gray=0.275;
        // One recognizable crane and a broad stern gate.
        if(q.x>0.14 && q.x<0.42 && abs(q.y-0.172)<0.021)gray=0.92;
        if(abs(q.x-0.30)<0.022 && q.y>0.052 && q.y<0.17)gray=0.275;
        if(q.x> -0.61 && q.x< -0.56 && abs(q.y)<0.145)gray=0.92;
        if(detail>0.01 && q.x>0.22 && q.x<0.35 && abs(q.y-0.123)<0.018)
          gray=mix(gray,0.51,detail);
#else
        // Aircraft-carrier silhouette, but a NAVAL REPAIR SHIP: two parallel
        // drydock lanes, edge work lights and a starboard service island.
        // No aircraft, radar dome, blue rings, sprites or additional draw calls.
        if (abs(q.x) < 0.64 && abs(q.y) < 0.205) gray = 0.52;
        if (abs(q.x) < 0.58 && abs(q.y) < 0.15) gray = 0.73;
        // Hardened gunwales read as two long rails at strategic zoom.
        if (abs(q.x) < 0.60 && abs(abs(q.y)-0.215) < 0.025) gray = 0.275;
        // Long central bay separation, maintenance lanes for three vessels.
        if (abs(q.x) < 0.51 && abs(q.y) < 0.015) gray = 0.275;
        if (abs(q.x) < 0.51 && abs(abs(q.y)-0.105) < 0.012) gray = 0.91;
        // Stern bay doors and bow approach arrows, no runway/aircraft.
        if (abs(q.x+0.46) < 0.018 && abs(q.y) < 0.17) gray = 0.92;
        if (abs(q.x-0.40) < 0.018 && abs(q.y) < 0.15) gray = 0.275;
        // Two distinct high-sided service lifts with inset deck floors.
        if (q.x > -0.32 && q.x < 0.13 && abs(abs(q.y)-0.074) < 0.046) gray = 0.87;
        if (q.x > -0.28 && q.x < 0.09 && abs(abs(q.y)-0.074) < 0.026) gray = 0.51;
        // Starboard island bridge: offset from the service deck, not a dome.
        if (q.x > -0.40 && q.x < -0.19 && q.y > 0.125 && q.y < 0.244) gray = 0.92;
        if (q.x > -0.35 && q.x < -0.23 && q.y > 0.16 && q.y < 0.21) gray = 0.275;
        // Service crane boom, long enough to be legible at high zoom.
        if (detail > 0.08) {
          if (q.x > 0.13 && q.x < 0.43 && abs(q.y-0.17) < 0.016) gray = 0.92;
          if (abs(q.x-0.32) < 0.013 && q.y > 0.07 && q.y < 0.18) gray = 0.275;
          if (abs(q.x-0.32) < 0.026 && abs(q.y-0.075) < 0.018) gray = 0.92;
          // Tiny bay registration lines, suppressed before they alias.
          if (abs(q.x+0.07) < 0.012 && abs(q.y) < 0.15) gray = 0.275;
        }
#endif
      } else {
      if(q.x> -0.32 && q.x<0.30 && abs(q.y)<0.115)gray=0.51;
      if(q.x> -0.15 && q.x<0.12 && abs(q.y)<0.08)gray=0.92;
      if(detail>0.1) {
        if(q.x> -0.10 && q.x< -0.03 && abs(q.y)<0.045)gray=0.275;
        float turret=min(length((q-vec2(0.36,0.0))/vec2(1.25,1.0)),length((q+vec2(0.42,0.0))/vec2(1.25,1.0)));
        if(turret<0.065)gray=0.92;
        if(q.x>0.36 && q.x<0.55 && abs(q.y)<0.014)gray=0.275;
        if(q.x< -0.42 && q.x> -0.58 && abs(q.y)<0.014)gray=0.275;
      }
#ifdef FRONTIER_CINEMATIC_ULTRA
      // More readable bridge, forward deck recess and stern machinery.
      // Shared hull quad/palette; no extra mesh, texture or draw calls.
      if(detail>0.01) {
        // Do not switch details on abruptly at an exact zoom threshold.
        // Fade the small internal fittings while retaining the two gun
        // turrets and pointed hull at every zoom level.
        float fineLOD=smoothstep(0.14,0.78,detail);
        if(q.x>0.12 && q.x<0.27 && abs(q.y)<0.032) gray=mix(gray,0.275,fineLOD);
        if(q.x> -0.32 && q.x< -0.22 && abs(q.y)<0.065) gray=mix(gray,0.92,fineLOD);
        if(q.x> -0.36 && q.x< -0.31 && abs(q.y)<0.072) gray=mix(gray,0.275,fineLOD);
      }
#endif
      }
    } else {
      // Open troop well and full-width forward landing ramp.
      if(q.x> -0.15 && q.x<0.19 && abs(q.y)<0.12)gray=0.275;
      if(q.x>0.21 && abs(q.y)<0.15)gray=0.92;
      if(q.x< -0.18 && q.x> -0.25 && abs(q.y)<0.12)gray=0.51;
      if(detail>0.1 && q.x> -0.10 && q.x<0.13 && abs(abs(q.y)-0.075)<0.025)gray=0.92;
    }
  } else {
    bool engine = col < 9.5;
    vec2 halfBody = vec2(engine ? 0.45 : 0.34, 0.18);
    d = max(abs(q.x) - halfBody.x, abs(q.y) - halfBody.y);
    // Narrow couplers visually join cars without oversized overlapping bodies.
    d = min(d, max(abs(q.x) - 0.41, abs(q.y) - 0.025));
    if (abs(q.y) > 0.13 || abs(q.x) > halfBody.x - 0.04) gray = 0.275;
    if (engine && q.x > 0.14 && abs(q.y) < 0.12) gray = 0.51;
    if (engine && detail > 0.1) {
      if (q.x > 0.18 && q.x < 0.29 && abs(q.y) < 0.10) gray = 0.92;
      if (q.x < 0.08 && q.x > -0.31 && abs(q.y) < 0.09) gray = 0.51;
      if (q.x < 0.03 && q.x > -0.27 && abs(q.y) < 0.07)
        gray = mod(floor(q.x*35.0),2.0) < 1.0 ? 0.275 : 0.51;
      if (q.x > 0.30 && q.x < 0.36 && abs(q.y) < 0.11) gray = 0.275;
      if (q.x > 0.39 && abs(q.y) < 0.09) gray = 0.92;
    }
    // Roof from above: longitudinal owner stripe and two broad roof hatches.
    if (!engine && abs(q.x)<0.28 && abs(q.y)<0.105) gray=0.51;
    if (!engine && abs(q.x)<0.26 && abs(q.y)<0.045) gray=0.706;
    if (!engine && detail>0.1 && abs(abs(q.x)-0.14)<0.075 && abs(q.y)<0.08) gray=0.92;
    if (detail > 0.1 && abs(q.y) > 0.16 && abs(abs(q.x) - 0.22) < 0.06) {
      d = min(d, max(abs(abs(q.x) - 0.22) - 0.06, abs(q.y) - 0.23));
      gray = 0.275;
    }
  }
  signedHullDistance = d;
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
  vec4 waterEffect = vec4(0.0);
  bool inSprite = vCellUV.x >= 0.0 && vCellUV.x <= 1.0 &&
                  vCellUV.y >= 0.0 && vCellUV.y <= 1.0;
  bool vessel = vAtlasCol < 2.5;
  bool train = vAtlasCol > 8.5;
  vec2 q = (vCellUV - 0.5) * 2.0;
  // Reused by the post-palette Ultra contour after the sprite is sampled.
  float hullSignedDistance = 1.0;
  if (vessel || train) {
    texel = vehicleSprite(q, vAtlasCol, hullSignedDistance);
    // Unit-local pulse, composed behind the hull in this same instance.
    // No terrain modification, accumulated stain, particles or extra draw call.
    bool warship = vAtlasCol > 1.5 && vAtlasCol < 2.5;
    bool transport = vAtlasCol < 0.5;
    bool supportCarrier=warship && abs(vFlags-FLAG_SUPPORT_SHIP)<0.1;
    if ((warship || transport) && !supportCarrier && uAltView == 0) {
      float phase = fract(uTime / max(uNavalPulse.z, 0.1) + fract(vOwnerID * 0.173));
      float radius = uNavalPulse.w * (warship ? 1.0 : 0.68);
      float r = length(q) / radius;
      float expansion = mix(0.42, 0.94, phase);
      float aa = max(fwidth(r), 0.01);
      float ring = (1.0-smoothstep(0.025, 0.055+aa, abs(r-expansion))) * sin(phase*3.14159265);
      float breath = 0.5+0.5*sin(phase*6.2831853);
      float glow = exp(-r*r*5.0) * (0.22+0.25*breath);
      float edgeFade = 1.0-smoothstep(0.86,1.0,r);
      float strength = warship ? uNavalPulse.x : uNavalPulse.y;
#ifdef FRONTIER_CINEMATIC
      // Replace the distracting red sonar halo with a subdued blue-gray
      // pressure ripple. Preserve its tactical presence, position and period.
      // This does not create a new quad or expand the effect bounds.
      float soft = (ring*0.26 + glow*0.17)*edgeFade*strength;
      waterEffect = vec4(vec3(0.58, 0.79, 0.83), min(0.22, soft));
#else
      waterEffect = vec4(1.0, 0.12, 0.08, (ring+glow)*edgeFade*strength);
#endif
    }
#ifdef FRONTIER_CINEMATIC
    // Opt-in wake stays inside the existing vessel quad: constant work per
    // visible vessel, no particles, history buffers or additional draw call.
    if (vessel && vHash > 0.01 && texel.a < 0.05 && uAltView == 0) {
      float aa = max(fwidth(q.x), fwidth(q.y));
      float lod = 1.0-smoothstep(0.075,0.21,aa);
      if (lod > 0.01) {
#ifdef FRONTIER_REDUCED_MOTION
        float time = 0.0;
#else
        float time = uTime;
#endif
        bool cargo = vAtlasCol > 0.5 && vAtlasCol < 1.5;
#ifdef FRONTIER_CINEMATIC_ULTRA
        // The repair carrier is longer than a gunship. Align foam to its
        // actual waterline instead of starting the wake inside the hull.
        float stern = supportCarrier ? -0.75 : (warship ? -0.64 : (cargo ? -0.40 : -0.30));
        float bow = supportCarrier ? 0.80 : (warship ? 0.72 : (cargo ? 0.45 : 0.34));
#else
        float stern = warship ? -0.64 : (cargo ? -0.40 : -0.30);
        float bow = warship ? 0.72 : (cargo ? 0.45 : 0.34);
#endif
        float behind = max(0.0,stern-q.x);
        float reach = max(0.08,min(0.55,0.97+stern));
        float sternMask = step(q.x,stern)*(1.0-smoothstep(0.0,reach,behind));
        float spread = 0.07+behind*0.34;
#ifdef FRONTIER_CINEMATIC_ULTRA
        if (supportCarrier) spread = 0.08+behind*0.43;
#endif
        float edges = 1.0-smoothstep(0.01,0.03+aa,abs(abs(q.y)-spread));
        float churn = exp(-q.y*q.y/max(0.008,0.008+behind*0.07));
        float bands = 0.72+0.28*sin(behind*38.0-time*2.5+vOwnerID*0.6);
        // A light turquoise wake reads against both deep and shallow water.
        // Keep it short-lived and contained within each already instanced hull.
        float trail = (edges*0.60+churn*0.38)*sternMask*bands;
#ifdef FRONTIER_CINEMATIC_ULTRA
        // A little broken stern turbulence reacts to motion without needing
        // water particles, trail allocations or an additional draw pass.
        float turbulence=0.5+0.5*sin(behind*22.0+abs(q.y)*13.0-time*2.2);
        trail+=sternMask*churn*(0.07+0.13*turbulence);
#endif
        // Soft bow pressure arc and a short side wash, never a full halo.
        vec2 front = (q-vec2(bow-0.04,0.0))/vec2(0.16,0.20);
        float bowArc = (1.0-smoothstep(0.07,0.14+aa*4.0,abs(length(front)-1.0)))*step(bow-0.02,q.x);
        float extent = 1.0-smoothstep(0.89,0.99,max(abs(q.x),abs(q.y)));
#ifdef FRONTIER_CINEMATIC_ULTRA
        // Byte 14 is the already-smoothed vessel speed/wake factor, updated
        // each frame by UnitPass. No new uniform, simulation or per-boat VBO.
        float speedWake = smoothstep(0.025,0.88,clamp(vHash,0.0,1.0));
        float wake = clamp((trail+bowArc*0.28)*extent*lod*speedWake*0.72,0.0,0.58);
#else
        float wake = clamp((trail+bowArc*0.34)*extent*lod*clamp(vHash,0.0,1.0)*0.76,0.0,0.62);
#endif
        if (wake>0.005) {
          float combined = wake+waterEffect.a*(1.0-wake);
          vec3 foamColor = mix(vec3(0.58,0.79,0.88),vec3(0.91,0.97,0.96),edges);
          waterEffect=vec4((foamColor*wake+waterEffect.rgb*waterEffect.a*(1.0-wake))/max(combined,0.001),combined);
        }
      }
    }
#else
    // A short, tapered V wake fades out at distant zoom. No particles or history buffers.
    if (vessel && vHash > 0.01 && texel.a < 0.05 && uAltView == 0) {
      float stern = vAtlasCol > 1.5 ? -0.64 : (vAtlasCol > 0.5 ? -0.40 : -0.30);
      float behind = stern - q.x;
      float aa = max(fwidth(q.x), fwidth(q.y));
      float spread = 0.07 + behind * 0.30;
      float edge = abs(abs(q.y) - spread);
      float foam = 1.0 - smoothstep(0.012, 0.025 + aa, edge);
      float fade = (1.0 - smoothstep(0.0, min(0.55, 0.98 + stern), behind)) * step(0.0, behind);
      float lod = 1.0 - smoothstep(0.12, 0.28, aa);
      float ripple = 0.80 + 0.20 * sin(behind * 35.0 - uTime * 3.0);
      float churn = exp(-q.y*q.y / (0.004 + behind*0.04)) * 0.32;
      float wake = (foam + churn) * fade * lod * ripple * 0.45 * vHash;
      if (wake > 0.005) {
        float combined = wake + waterEffect.a*(1.0-wake);
        waterEffect = vec4((vec3(0.78,0.90,0.94)*wake + waterEffect.rgb*waterEffect.a*(1.0-wake))/combined,combined);
      }
    }
#endif
#ifdef FRONTIER_CINEMATIC_ULTRA
    // Ultra only: project a faint water shadow one screen pixel down/right,
    // approximated from the existing hull distance. Nothing grows the unit
    // quad, creates extra geometry, or affects hit testing or normal modes.
    if (vessel && uAltView == 0) {
      float px = max(fwidth(hullSignedDistance), 0.0001);
      float displaced = hullSignedDistance
        - 0.58 * dFdx(hullSignedDistance)
        - 0.92 * dFdy(hullSignedDistance);
      float shade = (1.0 - smoothstep(-px * 0.45, px * 1.30, displaced))
        * (1.0 - texel.a);
      float shadowAlpha = shade * 0.16;
      if (shadowAlpha > 0.001) {
        float current = waterEffect.a;
        float alpha = current + shadowAlpha * (1.0 - current);
        vec3 darkWater = vec3(0.025, 0.065, 0.082);
        waterEffect = vec4(
          (waterEffect.rgb * current + darkWater * shadowAlpha * (1.0 - current))
            / max(alpha, 0.001),
          alpha);
      }
    }
#endif
  } else if (inSprite) {
    vec2 atlasUV = vec2((vAtlasCol + vCellUV.x) / float(ATLAS_COLS), vCellUV.y);
    texel = texture(uAtlas, atlasUV);
  }

  // Outside the sprite: render the steady soft glow under the hydrogen bomb,
  // otherwise discard. Glow is suppressed in alt (affiliation) view.
  if (texel.a < 0.01) {
    if (waterEffect.a > 0.001) { fragColor = waterEffect; return; }
#ifdef FRONTIER_CINEMATIC
    // Exhaust on moving SAM missiles and naval shells. The CPU supplies
    // their real travel bearing; this quad rotates with it in the vertex
    // shader. This uses transparent margin of the original missile instance.
    if (uAltView == 0 && vAtlasCol > 5.5 && vAtlasCol < 7.5) {
      vec2 q=(vQuadPos-0.5)*2.0;
      float sam=1.0-step(6.5,vAtlasCol);
      float behind=smoothstep(-0.09,-0.82,q.x);
      float narrow=exp(-pow(q.y/(0.07+0.055*sam),2.0));
      float taper=1.0-smoothstep(0.66,0.99,abs(q.x));
      float ember=behind*narrow*taper;
#ifdef FRONTIER_CINEMATIC_ULTRA
      ember*=0.85+0.15*sin(q.x*20.0-uTime*7.0+vHash*6.2831853);
#endif
      float opacity=ember*(0.24+0.19*sam);
#ifdef FRONTIER_REDUCED_MOTION
      opacity*=0.65;
#endif
      if(opacity>0.008) {
        vec3 tone=mix(vec3(1.0,0.67,0.31),vec3(0.44,0.83,1.0),sam);
        fragColor=vec4(tone,opacity*alphaMul);
        return;
      }
    }
#endif
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

  // Vessel hulls always retain the owning country palette.
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
    // Combat is shown on the water; the country-colored hull stays unchanged.
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
    if (vAtlasCol > 0.5 && vAtlasCol < 1.5 && gray > 0.77 && gray < 0.83) {
      // Honey, faded terracotta and desaturated teal cargo; ownership stays on
      // the gunwale. At distance the same bays resolve to a warm cargo accent.
      float bay=floor((q.x+.09)/.11);
      vec3 cargoColor=bay<1.0 ? vec3(.87,.62,.29) : (bay<2.0 ? vec3(.31,.58,.56) : vec3(.76,.39,.28));
      float cargoDetail=1.0-smoothstep(.06,.18,max(fwidth(q.x),fwidth(q.y)));
      color=mix(vec3(.95,.76,.36),cargoColor,cargoDetail);
    }
    if (vessel && gray > 0.45 && gray < 0.6) color = mix(vec3(0.40,0.46,0.48),territoryColor,0.22);
    if (gray > 0.85) color = mix(vec3(0.86,0.89,0.86),territoryColor,0.20);
    float edgeLight = (1.0 - smoothstep(-0.16, 0.10, q.y)) * 0.18;
    color = mix(color, vec3(0.87, 0.93, 0.95), edgeLight);
  }
  if (vessel && vAtlasCol>0.5 && vAtlasCol<1.5) {
    // A pale recessed working deck separates the cargo from the colored hull.
    // Windows, coamings and the funnel remain crisp negative shapes.
    if(q.x>-.145 && q.x<.275 && abs(q.y)>.14 && abs(q.y)<.175)
      color=mix(vec3(.68,.71,.62),territoryColor,.12);
    if(q.x>-.30 && q.x<-.17 && abs(q.y)<.15 && gray>.85)
      color=vec3(.89,.89,.80);
    if(q.x>-.20 && q.x<-.17 && abs(q.y)<.10 && gray<.34)
      color=vec3(.13,.25,.29);
    // Light falls across each bay independently, rather than washing the boat
    // into one yellow rectangle. Broad cargo color remains at overview scale.
    if(gray>.77 && gray<.83){
      float face=1.0-smoothstep(-.12,.12,q.y);
      color*=mix(.84,1.10,face);
    }
  }
#ifdef FRONTIER_CINEMATIC_ULTRA
  if (vessel) {
    // Four discrete, low-contrast tonal zones follow the original owner
    // palette. The team color stays dominant; cargo/deck pigments remain
    // legible. Top-left lighting is fixed in ship-local coordinates.
    float detailPx = max(fwidth(q.x), fwidth(q.y));
    float closeLOD = 1.0 - smoothstep(0.070, 0.225, detailPx);
    float lightSide = clamp(0.57 - 0.48 * q.y - 0.20 * q.x, 0.0, 1.0);
    float tone = (step(0.24, lightSide) +
                  step(0.49, lightSide) +
                  step(0.75, lightSide)) / 3.0;
    float hullMaterial = gray > 0.83 ? 0.28 : 1.0;
    color *= mix(1.0, 0.88 + 0.23 * tone, hullMaterial);

    // Lighten the lit edge of low-luminance player colors, especially blue
    // over blue water. This is calculated from the ACTUAL owner color, not
    // from a per-team hardcoded color or a neutral gray replacement.
    float ownerLuma = dot(territoryColor, vec3(0.2126,0.7152,0.0722));
    float lift = 0.035 + clamp((0.34-ownerLuma)*0.29, 0.0, 0.10);
    float sunlight = smoothstep(0.43, 0.85, lightSide);
    color = mix(color, vec3(1.0), sunlight * lift * hullMaterial);

    // Screen-space ~1px near, less than a pixel at strategic zoom.
    // Avoid a solid one-pixel black outline on a 4-5px distant ship.
    float rimPx = clamp(fwidth(hullSignedDistance)*0.87, 0.005, 0.038);
    float rim = smoothstep(-rimPx*1.85, -rimPx*0.18, hullSignedDistance);
    vec3 rimColor = mix(borderColor, territoryColor, 0.24);
    color = mix(color, rimColor, rim * mix(0.44,0.72,closeLOD));
  }
#endif
  if (vessel) {
    float aa = max(fwidth(q.x), fwidth(q.y));
    float strategic = vStrategic;
    // Large, simple class markings replace deck micro-detail at a distance.
    // Hull keeps owner color; affiliation mode returned above, combat signals win.
    float mark = 0.0;
    vec3 accent = vec3(0.96, 0.97, 1.0);
    if (vAtlasCol < 0.5) {
      // Bright embarkation chevron on a dark open troop well.
      float chevron = abs(q.x - (0.11 - abs(q.y) * 0.9));
      mark = (1.0-smoothstep(0.045,0.045+aa,chevron)) * (1.0-smoothstep(0.125,0.125+aa,abs(q.y)));
    } else if (vAtlasCol < 1.5) {
      float box = max(abs(q.x-0.04)-0.23,abs(q.y)-0.21);
      mark = 1.0-smoothstep(-aa,aa,box);
      accent = vec3(1.0,0.85,0.32);
    } else if (abs(vFlags-FLAG_SUPPORT_SHIP) < 0.1) {
      // Distinct broad hospital-ship style service lanes (not crosshairs).
      float lanes = max(abs(q.x)-0.43, abs(abs(q.y)-0.104)-0.027);
      mark = 1.0-smoothstep(-aa,aa,lanes);
      accent = vec3(0.38,0.92,0.76);
    } else {
      // Twin pale gun/deck bands survive when individual turrets are subpixel.
      float bars = max(abs(abs(q.x)-0.28)-0.075, abs(q.y)-0.13);
      mark = 1.0-smoothstep(-aa,aa,bars);
    }
    if (abs(vFlags-FLAG_ANGRY) > 0.1 && abs(vFlags-FLAG_RETREATING) > 0.1)
      color = mix(color,accent,mark*strategic);
    // Small owner-colored warship plate/torret accents make researched fleets
    // distinguishable at medium zoom without obscuring national affiliation.
    // Drawn in the EXISTING hull fragment, not extra geometry or textures.
    if (vAtlasCol > 1.5 && vAtlasCol < 2.5 &&
        abs(vFlags-FLAG_SUPPORT_SHIP) > 0.1 &&
        (vResearchHull > 0.1 || vResearchGuns > 0.1)) {
      float deck = 1.0-smoothstep(0.01,0.02+aa,
        abs(abs(q.y)-0.205));
      deck *= 1.0-smoothstep(0.40,0.58,abs(q.x));
      float gunEmblem = 1.0-smoothstep(0.018,0.038+aa,
        abs(abs(q.x)-0.34));
      gunEmblem *= 1.0-smoothstep(0.10,0.20,abs(q.y));
      float hullStrength = min(0.60,vResearchHull*0.17);
      float gunStrength = min(0.55,vResearchGuns*0.16);
      color = mix(color,vec3(0.77,0.94,0.99),deck*hullStrength);
      color = mix(color,vec3(0.99,0.84,0.42),gunEmblem*gunStrength);
    }
    // Functional shipyard merchant/transport research has its own discrete
    // deck identifiers. These use the existing flag bits and vary by tier;
    // ownership color stays dominant at normal and strategic map zoom.
    if (vResearchHull > 0.1 && vAtlasCol < 1.5) {
      float tier = clamp(vResearchHull, 1.0, 3.0);
      float stripe = 0.0;
      if (vAtlasCol < 0.5) {
        // Reinforced troop ramps: two short transverse capacity marks.
        stripe = (1.0-smoothstep(0.012,0.024+aa,abs(q.x+0.16))) *
          (1.0-smoothstep(0.10,0.16,abs(q.y)));
      } else {
        // Merchant speed upgrade: narrow foredeck chevron.
        stripe = (1.0-smoothstep(0.016,0.033+aa,
          abs(q.x-(0.22-abs(q.y)*0.9)))) *
          (1.0-smoothstep(0.11,0.19,abs(q.y)));
      }
      color=mix(color,vec3(0.83,0.94,0.99),stripe*min(0.62,tier*0.21));
    }
    // In place of the old sonar circles, subtle green deck-service strips
    // slowly breathe while the mobile dock is active. No external halo.
    if (vAtlasCol > 1.5 && vAtlasCol < 2.5 &&
        abs(vFlags-FLAG_SUPPORT_SHIP) < 0.1 && uAltView == 0) {
      float aa = max(fwidth(q.x), fwidth(q.y));
      float sideRails =
        (1.0-smoothstep(0.009,0.009+aa,abs(abs(q.y)-0.185))) *
        (1.0-smoothstep(0.02,0.05+aa,abs(q.x)-0.52));
      float pulse = 0.56 + 0.18*sin(uTime*1.65+q.x*5.0);
      color = mix(color,vec3(0.28,0.92,0.73),sideRails*pulse);
    }
  }
#ifdef FRONTIER_CINEMATIC
  if (vessel && vStrategic<0.5 && gray>0.45 &&
      abs(vFlags-FLAG_RETREATING)>0.1) {
    float closeDetail=1.0-smoothstep(0.05,0.15,max(fwidth(q.x),fwidth(q.y)));
    float bevel=(1.0-smoothstep(0.02,0.12,abs(q.y+0.075)))*closeDetail;
    color=mix(color,vec3(0.84,0.91,0.93),bevel*0.10);
  }
#endif
  fragColor = vec4(color, texel.a * alphaMul);
}
