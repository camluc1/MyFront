#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;

uniform sampler2D uTerrain;
uniform vec3 uBackground;
uniform float uTime;
uniform vec4 uSurface; // water motion, highlights, relief, surface grain
#ifdef FRONTIER_CINEMATIC
uniform float uWaterQuality;
#endif
in vec2 vUV;
in vec2 vScreen;
out vec4 fragColor;

// Stable world-space grain. No image textures or time-varying random noise.
float hash(vec2 p) {
  vec3 v=fract(vec3(p.xyx)*0.1031);
  v+=dot(v,v.yzx+33.33);
  return fract((v.x+v.y)*v.z);
}
float grain(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
float elevation(ivec2 p, ivec2 limit, float fallback) {
  int t=int(texelFetch(uTerrain,clamp(p,ivec2(0),limit),0).a*255.0+0.5);
  return (t&128)!=0 && (t&31)!=31 ? float(t&31) : fallback;
}

#ifdef FRONTIER_CINEMATIC
// Screen/zoom bounded ocean shading. No simulation, reflection texture,
// extra map-sized buffer, per-tile CPU update or extra draw call.
vec3 cinematicOcean(vec3 base, vec2 world, int terrain, float footprint) {
#ifdef FRONTIER_REDUCED_MOTION
  float time = 0.0;
#else
  float time = uTime;
#endif
  float quality = clamp(uWaterQuality, 0.0, 1.0);
  // Pixel-footprint LOD prevents subpixel waves from flickering at world zoom.
  float close = 1.0-smoothstep(0.65,2.25,footprint);
  float mid = 1.0-smoothstep(2.5,7.0,footprint);
  bool coast = (terrain&64)!=0;
  // Cohesive wind-driven swells instead of random moving noise. Broad water
  // remains readable at all zoom levels, even during adaptive degradation.
  vec2 wind = vec2(0.894,0.447);
  float waveA = dot(world,wind)*0.055-time*0.22;
  float swell = sin(waveA);
  float cross = sin(dot(world,vec2(-0.35,0.94))*0.034-time*0.115);
  vec3 sea = base*(0.945+0.052*swell*mid+0.024*cross*mid);
  // Balanced deep-water blue and slightly brighter coastal teal. The map's
  // own terrain color is never replaced, only modulated.
  sea += (coast ? vec3(0.015,0.038,0.047) : vec3(0.008,0.020,0.034))*mid;
  if (close < 0.04 || quality < 0.08) return sea;
  // Fast fallback with one coherent thin wave crest: no noise texture, no
  // extra pass, no derivative-based specular when frame pacing drops.
  float crestPhase = dot(world,wind)*0.175-time*0.65+cross*0.62;
  float crest = max(0.0,sin(crestPhase));
  float ribbon = pow(crest,10.0)*close;
  float multiplier = quality <= 0.35 ? 0.55 : 1.0;
  sea += vec3(0.21,0.40,0.48)*ribbon*0.18*multiplier;
  if (quality <= 0.35) return sea;
  // A cross-wind interference pattern breaks up the crests at close zoom.
  // Only high detail uses one stable grain and a broad directional normal.
  float breakup = grain(world*0.045+vec2(time*0.010,-time*0.004));
  float ripple = sin(dot(world,vec2(-0.16,0.23))-time*0.52+breakup*1.3);
  float spark = pow(max(0.0,0.62*crest+0.38*ripple),8.0);
  float glint = spark*close*quality*(0.075+0.06*breakup);
  sea += vec3(0.49,0.72,0.85)*glint;
  if (coast) {
    // White surf on shoreline tiles, held in thin moving streaks, not a
    // uniform green/white checkerboard overlay on every water tile.
    float surf = pow(max(0.0,sin(crestPhase*0.65-time*0.10)),6.0);
    surf *= smoothstep(0.28,0.72,breakup)*close*quality;
    sea += vec3(0.48,0.71,0.74)*surf*0.22;
    if (quality > 0.65 && footprint < 1.0) {
      float caustic = pow(max(0.0,sin(crestPhase*1.5+cross*0.75)),12.0);
      sea += vec3(0.22,0.36,0.40)*caustic*0.025*close;
    }
  }
  return sea;
}
#endif
  float quality = clamp(uWaterQuality, 0.0, 1.0);
  float detail = (1.0-smoothstep(0.7,2.2,footprint))*quality;
  float swellPhase = dot(world,vec2(0.029,0.018))-time*0.21;
  float swell = sin(swellPhase);
  vec3 color = base*(0.96+0.025*swell);
  // A true low-cost tier: on huge framebuffers, overview views, or slow
  // devices skip the derivative-driven specular highlights and water noise.
  // Never allocate a second water pass or texture.
  if (detail < 0.035) return color;
  if (quality <= 0.35) {
    float broad = sin(dot(world,vec2(0.068,-0.024))-time*0.16);
    return color*(1.0 + 0.018*broad*detail);
  }
  float breakup = grain(world*0.034+vec2(time*0.007,0.0));
  float a = dot(world,vec2(0.18,0.09))-time*0.57+breakup*1.8;
  float b = dot(world,vec2(-0.08,0.15))-time*0.39+swell*0.6;
  vec3 normal = normalize(vec3(
    -cos(a)*0.43-cos(b)*0.19,
    -cos(a)*0.22+cos(b)*0.27, 1.0));
  vec3 halfLight = normalize(vec3(-0.32,0.24,1.0));
  float spec = pow(max(dot(normal,halfLight),0.0),28.0);
  float crest = 0.5+0.5*sin(a);
  color *= 1.0+(crest-0.5)*0.085*detail;
  // Restrained cool reflection: ownership fills and naval warnings stay legible.
  // Bounded broad reflection. Less flashing when waves overlap on giant seas.
  float reflection = spec*(0.025+0.055*breakup)*detail;
  color += vec3(0.57,0.76,0.84)*reflection;
  bool shore = (terrain&64)!=0;
  if (shore) {
    float wash = pow(0.5+0.5*sin(a*0.64-time*0.16),5.0);
    float foam = wash*smoothstep(0.25,0.75,breakup);
    color = mix(color,color*vec3(0.87,1.06,1.04),detail*0.3);
    color += vec3(0.64,0.80,0.78)*foam*detail*0.14;
    if (quality>0.55 && footprint<0.9) {
      float caustic = pow(max(0.0,sin(a*1.7)+sin(b*1.9)-0.6),2.0);
      color += vec3(0.13,0.25,0.24)*caustic*detail*0.035;
    }
  }
  return color;
}
#endif

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
#ifdef FRONTIER_CINEMATIC
      if (uWaterQuality>0.02) {
        color=cinematicOcean(color,world,terrain,footprint);
      } else
#endif
      {
      // Two travelling wave fields share a wind direction. Their analytic
      // slope drives soft glints; they never move coastlines or gameplay tiles.
      float waterDetail=1.0-smoothstep(0.65,2.0,footprint);
      float phase=world.x*0.19+world.y*0.11-uTime*0.65+grain(world*0.035)*2.4;
      float swell=sin(world.x*0.038+world.y*0.025-uTime*0.22);
      float wave=sin(phase+swell*0.8);
      float crossing=sin(world.x*-0.09+world.y*0.16-uTime*0.41);
      color *= 1.0+(wave*0.25+swell*0.35)*uSurface.x*mix(0.25,1.0,waterDetail);
      if(detail>0.0 && uSurface.y>0.0) {
        float breakup=grain(world*0.09+vec2(uTime*0.012,0));
        float reflection=pow(max(0.0,wave*0.7+crossing*0.3),6.0)*smoothstep(0.35,0.8,breakup);
        color+=vec3(0.64,0.83,0.86)*reflection*uSurface.y*waterDetail*waterDetail;
        if((terrain&64)!=0) {
          float wash=pow(0.5+0.5*sin(phase*0.65-uTime*0.18),4.0);
          color+=vec3(0.65,0.80,0.75)*wash*uSurface.y*waterDetail;
        }
      }
      }
    } else if (height != 31 && detail>0.0) {
      ivec2 coord=ivec2(world),limit=textureSize(uTerrain,0)-1;
      float nw=elevation(coord-ivec2(1),limit,float(height));
      float se=elevation(coord+ivec2(1),limit,float(height));
      float relief=clamp((se-nw)*0.11,-1.0,1.0);
      // Material detail shares the same two grain evaluations at every zoom.
      // Grass is fine and slightly directional; rock has broader broken facets.
      bool shore=(terrain&64)!=0;
      float grass=shore ? 0.0 : 1.0-smoothstep(7.0,11.0,float(height));
      float rocky=smoothstep(15.0,23.0,float(height));
      float dry=smoothstep(8.0,12.0,float(height))*(1.0-rocky);
      float closeDetail=1.0-smoothstep(0.45,1.5,footprint);
      vec2 materialCoord=mix(world*0.30,vec2(world.x*0.24+world.y*0.08,world.y*0.65),grass*closeDetail);
      float textureGrain=grain(materialCoord)-0.5;
      float broad=grain(world*0.055)-0.5;
      float materialContrast=mix(0.7,1.5,rocky);
      if(shore) materialContrast=1.1;
      float vegetation=(broad+0.5)*uSurface.w*detail*grass;
      color*=vec3(1.0-vegetation,1.0+vegetation*0.2,1.0-vegetation*1.4);
      float dryVariation=(textureGrain+broad)*uSurface.w*dry*closeDetail;
      color*=vec3(1.0+dryVariation*0.5,1.0+dryVariation*0.15,1.0-dryVariation*0.5);
      // Fixed upper-left light follows real elevations; a restrained extra
      // contrast on rocky slopes separates ridges from valleys.
      color*=1.0+(relief*uSurface.z*mix(1.0,1.12,rocky)
        +(textureGrain*materialContrast+broad)*uSurface.w)*detail;
#ifdef FRONTIER_CINEMATIC
      // Additional aerial ridge separation only when terrain can be seen;
      // narrow amplitude keeps strategic ownership colors intact.
      float ridge = max(0.0, relief)*rocky*closeDetail;
      color *= 1.0 + min(0.055,ridge*0.055);
#endif
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
#ifdef FRONTIER_CINEMATIC
  // The empty surround is deliberately quiet, not another animated ocean.
  color=uBackground*(0.70+vignette*0.33);
  color+=vec3(0.016,0.027,0.033)*line;
  float horizon=exp(-dot(centered-vec2(-0.18,-0.20),centered-vec2(-0.18,-0.20))*5.0);
  color+=vec3(0.006,0.014,0.018)*horizon;
#endif
  fragColor = vec4(color, 1.0);
}
