#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;
uniform sampler2D uTerrain;
uniform vec3 uBackground;
uniform float uTime;
uniform vec4 uSurface;
#ifdef FRONTIER_CINEMATIC
uniform float uWaterQuality;
uniform sampler2D uOceanDetail;
#endif
in vec2 vUV;
in vec2 vScreen;
out vec4 fragColor;
float hash(vec2 p) {
  vec3 v=fract(vec3(p.xyx)*.1031);v+=dot(v,v.yzx+33.33);
  return fract((v.x+v.y)*v.z);
}
float grain(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
float elevation(ivec2 p,ivec2 limit,float fallback) {
  int t=int(texelFetch(uTerrain,clamp(p,ivec2(0),limit),0).a*255.0+.5);
  return (t&128)!=0 && (t&31)!=31 ? float(t&31) : fallback;
}
#ifdef FRONTIER_CINEMATIC_ULTRA
float shoreLand(ivec2 p) {
  p=clamp(p,ivec2(0),textureSize(uTerrain,0)-1);
  int t=int(texelFetch(uTerrain,p,0).a*255.0+.5);
  return (t&128)!=0 ? 1.0 : 0.0;
}
vec2 shoreNormal(vec2 world) {
  ivec2 p=ivec2(world);
  vec2 n=vec2(shoreLand(p+ivec2(-1,0))-shoreLand(p+ivec2(1,0)),
              shoreLand(p+ivec2(0,-1))-shoreLand(p+ivec2(0,1)));
  return dot(n,n)>.01 ? normalize(n) : normalize(vec2(.8,.6));
}
#endif
#ifdef FRONTIER_CINEMATIC
// Constant integer powers: identical curve to pow(x,N) for nonnegative x,
// but expressed as multiplies (no per-pixel exp/log approximation).
float power26(float x) {
  float x2=x*x, x4=x2*x2, x8=x4*x4, x16=x8*x8;
  return x16*x8*x2;
}
#ifdef FRONTIER_CINEMATIC_ULTRA
float power48(float x) {
  float x2=x*x, x4=x2*x2, x8=x4*x4, x16=x8*x8, x32=x16*x16;
  return x32*x16;
}
#endif
float power13(float x) {
  float x2=x*x, x4=x2*x2, x8=x4*x4;
  return x8*x4*x;
}
vec3 cinematicOcean(vec3 base,vec2 w,int terrain,float footprint) {
#ifdef FRONTIER_REDUCED_MOTION
  float t=0.0;
#else
  float t=uTime;
#endif
  float quality=clamp(uWaterQuality,0.0,1.0);
  float nearLOD=1.0-smoothstep(.60,2.80,footprint);
  float midLOD=1.0-smoothstep(2.80,11.0,footprint);
  bool coast=(terrain&64)!=0;
  float depth=clamp(float(terrain&31)/31.0,0.0,1.0);
  float shelf=coast ? .76 : (1.0-depth)*.15;
  vec3 deep=base*vec3(.64,.84,1.05)+vec3(.006,.012,.035);
  vec3 shallow=base*vec3(.76,1.12,1.08)+vec3(.002,.033,.040);
  vec3 color=mix(deep,shallow,shelf);
  // For footprints >= 11 tiles, midLOD and nearLOD are exactly zero.
  // The original shader returns color * .96; avoid invisible ocean work.
  if(footprint>=11.0) return color*.96;
  float swellA=sin(dot(w,vec2(.026,.012))-t*.11+sin(dot(w,vec2(-.008,.021))-t*.037)*.58);
  float swellB=sin(dot(w,vec2(-.017,.034))-t*.083);
  color*=.96+midLOD*(swellA*.075+swellB*.052);
  if(nearLOD<.025 || quality<.06) return color;
  if(quality<=.35) {
    float wave=sin(dot(w,vec2(.125,.050))-t*.38+swellB*.8);
    color*=1.0+wave*.045*nearLOD*quality;
    return color;
  }
  vec3 fieldA=texture(uOceanDetail,w*.018+vec2(t*.005,-t*.003)).rgb;
  vec3 fieldB=texture(uOceanDetail,w*.035+vec2(-t*.008,t*.006)).rgb;
  float noiseA=mix(fieldA.b,fieldB.b,.31);
  float noiseB=mix(fieldA.b,fieldB.b,.67);
  float warp=(noiseA-.5)*3.2+(noiseB-.5)*1.1;
  float phaseA=dot(w,vec2(.176,.072))-t*.59+warp+swellA*.92;
  float phaseB=dot(w,vec2(-.112,.175))-t*.45+warp*.61;
  float waveA=sin(phaseA),waveB=sin(phaseB);
  float rough=nearLOD*quality;
  color*=1.0+rough*(.083*waveA+.037*waveB);
  vec2 slope=(fieldA.xy*2.0-1.0)*.42+(fieldB.xy*2.0-1.0)*.23+
    vec2(cos(phaseA)*.23-cos(phaseB)*.09,cos(phaseA)*.11+cos(phaseB)*.16);
#ifdef FRONTIER_CINEMATIC_ULTRA
  // Third scale reuses the SAME 128px mipmapped texture. No new allocation/pass.
  mat2 rotation=mat2(.8,.6,-.6,.8);
  vec3 fieldC=texture(uOceanDetail,rotation*w*.011+vec2(-t*.002,t*.004)).rgb;
  slope+=transpose(rotation)*(fieldC.xy*2.0-1.0)*.24;
  noiseA=mix(noiseA,fieldC.b,.20);
#endif
  vec3 normal=normalize(vec3(-slope,.91));
  vec3 halfSky=normalize(vec3(-.28,.25,.95));
  float glint=power26(max(dot(normal,halfSky),0.0));
  color+=vec3(.48,.71,.90)*glint*rough*.17*smoothstep(.23,.78,noiseA);
#ifdef FRONTIER_CINEMATIC_ULTRA
  // Broad sky reflection plus fine highlights, rather than stronger white glare.
  float skyFacing=clamp(1.0-normal.z,0.0,1.0);
  float sky=skyFacing*skyFacing;
  color=mix(color,vec3(.19,.34,.44),min(.12,sky*.55)*rough);
  float sparkle=power48(max(dot(normal,normalize(vec3(-.33,.16,.97))),0.0));
  color+=vec3(.48,.62,.67)*sparkle*rough*.055*noiseB;
#endif
  float crest=smoothstep(.82,.98,waveA+waveB*.20);
  float fragment=smoothstep(.34,.73,noiseA)*(.24+.76*smoothstep(.38,.77,noiseB));
  float whitecap=crest*fragment*rough;
  color=mix(color,vec3(.72,.88,.94),whitecap*.49);
  if(coast) {
    float wash=max(0.0,sin(phaseA*.61-t*.12+noiseA*2.0));
#ifdef FRONTIER_CINEMATIC_ULTRA
    if(footprint<1.0) {
      vec2 shore=shoreNormal(w);
      wash=max(0.0,sin(dot(w,shore)*.42-t*.42+noiseA*1.8));
    }
#endif
    float shoreFoam=smoothstep(.57,.90,wash)*(.36+.64*noiseA)*rough;
    color=mix(color,vec3(.74,.91,.92),shoreFoam*.72);
    if(quality>.72 && footprint<1.0) {
      float caustic=power13(max(0.0,sin(phaseA*2.2+phaseB)));
      color+=vec3(.13,.25,.26)*caustic*rough*.09;
    }
  }
  return color;
}
#endif
void main() {
  if(all(greaterThanEqual(vUV,vec2(0))) && all(lessThanEqual(vUV,vec2(1)))) {
    vec4 tile=texture(uTerrain,vUV);
    int terrain=int(tile.a*255.0+.5);
    bool land=(terrain&128)!=0;
    int height=terrain&31;
    vec2 size=vec2(textureSize(uTerrain,0));
    vec2 world=vUV*size;
    float footprint=max(fwidth(world.x),fwidth(world.y));
    float detail=1.0-smoothstep(1.0,4.0,footprint);
    vec3 color=tile.rgb;
    if(!land) {
#ifdef FRONTIER_CINEMATIC
      if(uWaterQuality>.02) color=cinematicOcean(color,world,terrain,footprint);
      else
#endif
      {
        float waterDetail=1.0-smoothstep(.65,2.0,footprint);
        float phase=world.x*.19+world.y*.11-uTime*.65+grain(world*.035)*2.4;
        float swell=sin(world.x*.038+world.y*.025-uTime*.22);
        float wave=sin(phase+swell*.8);
        float crossing=sin(world.x*-.09+world.y*.16-uTime*.41);
        color*=1.0+(wave*.25+swell*.35)*uSurface.x*mix(.25,1.0,waterDetail);
        if(detail>0.0 && uSurface.y>0.0) {
          float breakup=grain(world*.09+vec2(uTime*.012,0));
          float reflection=pow(max(0.0,wave*.7+crossing*.3),6.0)*smoothstep(.35,.8,breakup);
          color+=vec3(.64,.83,.86)*reflection*uSurface.y*waterDetail*waterDetail;
          if((terrain&64)!=0) {
            float wash=pow(.5+.5*sin(phase*.65-uTime*.18),4.0);
            color+=vec3(.65,.80,.75)*wash*uSurface.y*waterDetail;
          }
        }
      }
    } else if(height!=31 && detail>0.0) {
      ivec2 coord=ivec2(world),limit=textureSize(uTerrain,0)-1;
      float nw=elevation(coord-ivec2(1),limit,float(height));
      float se=elevation(coord+ivec2(1),limit,float(height));
      float relief=clamp((se-nw)*.11,-1.0,1.0);
      bool shore=(terrain&64)!=0;
      float grass=shore ? 0.0 : 1.0-smoothstep(7.0,11.0,float(height));
      float rocky=smoothstep(15.0,23.0,float(height));
      float dry=smoothstep(8.0,12.0,float(height))*(1.0-rocky);
      float closeDetail=1.0-smoothstep(.45,1.5,footprint);
      vec2 materialCoord=mix(world*.30,vec2(world.x*.24+world.y*.08,world.y*.65),grass*closeDetail);
      float textureGrain=grain(materialCoord)-.5;
      float broad=grain(world*.055)-.5;
      float materialContrast=mix(.7,1.5,rocky);
      if(shore) materialContrast=1.1;
      float vegetation=(broad+.5)*uSurface.w*detail*grass;
      color*=vec3(1.0-vegetation,1.0+vegetation*.2,1.0-vegetation*1.4);
      float dryVariation=(textureGrain+broad)*uSurface.w*dry*closeDetail;
      color*=vec3(1.0+dryVariation*.5,1.0+dryVariation*.15,1.0-dryVariation*.5);
      color*=1.0+(relief*uSurface.z*mix(1.0,1.12,rocky)+(textureGrain*materialContrast+broad)*uSurface.w)*detail;
#ifdef FRONTIER_CINEMATIC
      float mountain=smoothstep(12.0,26.0,float(height));
      float ridgeLight=max(0.0,relief)*mountain*closeDetail;
      float valleyShade=max(0.0,-relief)*mountain*closeDetail;
      float stonyGrain=(textureGrain*.55+broad*.45)*mountain*closeDetail;
      color*=mix(vec3(1),vec3(1.08,1.035,.96),min(.22,ridgeLight*.16));
      color*=mix(vec3(1),vec3(.78,.86,.98),min(.27,valleyShade*.18));
      color*=1.0+stonyGrain*.085;
      if(shore && closeDetail>.01) color*=mix(vec3(1),vec3(1.04,1.035,.98),.19*closeDetail);
#endif
    }
    fragColor=vec4(color,1);
    return;
  }
  vec2 centered=vScreen-.5;
  float vignette=clamp(1.0-dot(centered,centered)*1.4,0.0,1.0);
  vec2 grid=mod(gl_FragCoord.xy,64.0);
  float line=1.0-step(1.0,min(grid.x,grid.y));
  vec3 color=uBackground*(.82+vignette*.22);
  color+=vec3(.035,.045,.055)*line;
#ifdef FRONTIER_CINEMATIC
  color=uBackground*(.70+vignette*.33);
  color+=vec3(.016,.027,.033)*line;
  float horizon=exp(-dot(centered-vec2(-.18,-.20),centered-vec2(-.18,-.20))*5.0);
  color+=vec3(.006,.014,.018)*horizon;
#endif
  fragColor=vec4(color,1);
}
