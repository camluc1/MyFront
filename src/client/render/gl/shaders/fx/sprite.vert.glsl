#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 aInstPos;
layout(location=2) in vec4 aInstFlags; // frame, alpha, subframe, scale (0=classic sequence)
uniform mat3 uCamera;
#ifdef FRONTIER_CINEMATIC
uniform float uCinematicNukeReady;
uniform float uCinematicImpactReady;
uniform highp usampler2D uTerrainFlags;
uniform int uHasTerrainFlags;
#endif
uniform vec4 uFxUV[FX_TYPE_COUNT];
uniform vec4 uFxWorld[FX_TYPE_COUNT];
out vec2 vAtlasUV;
flat out float vAlpha;
flat out float vFxType;
flat out float vFxProgress;
flat out float vFxFrame;
flat out float vCinematic;
out vec2 vLocalUV;
#ifdef FRONTIER_CINEMATIC
flat out float vWaterImpact;
#endif
void main() {
  int type=int(aInstPos.z+.5);
  float frameIdx=floor(aInstFlags.x+.5);
  vec4 uv=uFxUV[type], world=uFxWorld[type];
  vec2 center=aInstPos.xy+.5;
#ifdef FRONTIER_CINEMATIC
  vWaterImpact=0.0;
  if(type==4 && uHasTerrainFlags!=0) {
    ivec2 tc=clamp(ivec2(floor(center)),ivec2(0),textureSize(uTerrainFlags,0)-1);
    uint tile=texelFetch(uTerrainFlags,tc,0).r;
    vWaterImpact=(tile & 128u)==0u ? 1.0 : 0.0;
  }
#endif
  vec2 anchor=vec2(.5);
  float scale=1.0;
  vCinematic=0.0;
  float subframe=0.0;
#ifdef FRONTIER_CINEMATIC
  bool newNuke=type==0 && uCinematicNukeReady>.5 && aInstFlags.w>0.0;
  bool newImpact=(type==2 || type==3 || type==4) && uCinematicImpactReady>.5 && aInstFlags.w>0.0;
  if(newNuke) {
    scale=2.12*aInstFlags.w/128.0;
    // World Y grows DOWN. Anchor at the artwork's ground, not its center.
    anchor.y=219.0/256.0;
  } else if(newImpact) scale=type==4 ? 2.1 : type==2 ? 1.58 : 1.55;
  else scale=type==0 ? 1.30 : type==2 ? 1.18 : type==4 ? 1.55 : 1.0;
  if(newNuke || newImpact) {
    vCinematic=1.0;
#ifndef FRONTIER_CINEMATIC_MEDIUM
    subframe=aInstFlags.z/255.0;
#endif
  }
#endif
  vec2 worldPos=center+(aPos-anchor)*world.xy*scale;
  gl_Position=vec4((uCamera*vec3(worldPos,1)).xy,0,1);
  vAtlasUV=vec2((frameIdx+aPos.x)*uv.z,uv.x+aPos.y*uv.y);
  vAlpha=aInstFlags.y/255.0;
  vFxType=float(type);
  float lastFrame=type==12 ? 4.0 : type==13 ? 4.0 :
    type==0 ? 8.0 : type==2 ? 9.0 : type==3 || type==4 ? 3.0 : 8.0;
  if(vCinematic>.5) lastFrame=15.0;
  vFxFrame=frameIdx+subframe;
  vFxProgress=clamp(vFxFrame/lastFrame,0.0,1.0);
  vLocalUV=aPos;
}
