#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;

uniform sampler2D uTerrain;
uniform vec3 uBackground;
uniform float uTime;
uniform vec4 uSurface; // water motion, highlights, relief, surface grain
#ifdef FRONTIER_CINEMATIC
uniform float uWaterQuality;
uniform sampler2D uOceanDetail;
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
vec3 cinematicOcean(vec3 base, vec2 w, int terrain, float footprint) {
#ifdef FRONTIER_REDUCED_MOTION
  float t = 0.0;
#else
  float t = uTime;
#endif
  float quality = clamp(uWaterQuality, 0.0, 1.0);
  float nearLOD = 1.0-smoothstep(0.60,2.80,footprint);
  float midLOD = 1.0-smoothstep(2.80,11.0,footprint);
  bool coast = (terrain&64)!=0;
  // Water gains depth and a richer blue/teal shelf, while land and ownership
  // colors are still rendered and blended by their original paths.
  float depth = clamp(float(terrain&31)/31.0,0.0,1.0);
  float shelf = coast ? 0.76 : (1.0-depth)*0.15;
  vec3 deep = base*vec3(0.64,0.84,1.05)+vec3(0.006,0.012,0.035);
  vec3 shallow = base*vec3(0.76,1.12,1.08)+vec3(0.002,0.033,0.040);
  vec3 color = mix(deep,shallow,shelf);
  // Two ocean-scale swells remain readable on a zoomed-out map. No water
  // geometry, tile movement or animation CPU pass is required.
  float swellA = sin(dot(w,vec2(0.026,0.012))-t*0.11+
    sin(dot(w,vec2(-0.008,0.021))-t*0.037)*0.58);
  float swellB = sin(dot(w,vec2(-0.017,0.034))-t*0.083);
  color *= 0.96+midLOD*(swellA*0.075+swellB*0.052);
  if (nearLOD < 0.025 || quality < 0.06) return color;
  // Slow frames take an analytic fallback, without noise-map texture reads
  // or expensive specular terms.
  if (quality <= 0.35) {
    float wave = sin(dot(w,vec2(0.125,0.050))-t*0.38+swellB*0.8);
    color *= 1.0+wave*0.045*nearLOD*quality;
    return color;
  }
  // Two taps of a tiny, seamless 128px normal/foam atlas. Mipmapping
  // suppresses shimmer as the camera moves; independent drift prevents
  // frozen repeating stripes. Texture is allocated once per match.
  vec3 fieldA = texture(uOceanDetail,
    w*0.018+vec2(t*0.005,-t*0.003)).rgb;
  vec3 fieldB = texture(uOceanDetail,
    w*0.035+vec2(-t*0.008,t*0.006)).rgb;
  float noiseA = mix(fieldA.b,fieldB.b,0.31);
  float noiseB = mix(fieldA.b,fieldB.b,0.67);
  float warp = (noiseA-0.5)*3.2+(noiseB-0.5)*1.1;
  float phaseA = dot(w,vec2(0.176,0.072))-t*0.59+
    warp+swellA*0.92;
  float phaseB = dot(w,vec2(-0.112,0.175))-t*0.45+
    warp*0.61;
  float waveA = sin(phaseA), waveB = sin(phaseB);
  float rough = nearLOD*quality;
  color *= 1.0+rough*(0.083*waveA+0.037*waveB);
  // Height-field normals from the atlas combine with large analytic waves.
  // Anisotropic sky highlights create perceived depth without ray tracing.
  vec2 slope = (fieldA.xy*2.0-1.0)*0.42+
    (fieldB.xy*2.0-1.0)*0.23+
    vec2(cos(phaseA)*0.23-cos(phaseB)*0.09,
         cos(phaseA)*0.11+cos(phaseB)*0.16);
  vec3 normal = normalize(vec3(-slope,0.91));
  vec3 halfSky = normalize(vec3(-0.28,0.25,0.95));
  float glint = pow(max(dot(normal,halfSky),0.0),26.0);
  color += vec3(0.48,0.71,0.90)*glint*rough*0.17*
    smoothstep(0.23,0.78,noiseA);
  // Bright foam fragments form on local breaking crests, not evenly-spaced
  // geometric stripes across the entire sea.
  float crest = smoothstep(0.82,0.98,waveA+waveB*0.20);
  float fragment = smoothstep(0.34,0.73,noiseA)*
    (0.24+0.76*smoothstep(0.38,0.77,noiseB));
  float whitecap = crest*fragment*rough;
  color = mix(color,vec3(0.72,0.88,0.94),whitecap*0.49);
  if (coast) {
    float wash = max(0.0,sin(phaseA*0.61-t*0.12+noiseA*2.0));
    float shoreFoam = smoothstep(0.57,0.90,wash)*
      (0.36+0.64*noiseA)*rough;
    color = mix(color,vec3(0.74,0.91,0.92),shoreFoam*0.72);
    if (quality>0.72 && footprint<1.0) {
      float caustic = pow(max(0.0,sin(phaseA*2.2+phaseB)),13.0);
      color += vec3(0.13,0.25,0.26)*caustic*rough*0.09;
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
