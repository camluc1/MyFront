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
flat in float vCinematic;
in vec2 vLocalUV;
#ifdef FRONTIER_CINEMATIC
flat in float vWaterImpact;
#endif
out vec4 fragColor;
#ifdef FRONTIER_CINEMATIC
vec2 cinematicAtlasUV(float index,vec2 uv) {
  float frame=clamp(floor(index),0.0,15.0);
  vec2 cell=vec2(mod(frame,4.0),floor(frame/4.0));
  // Both the world quad and uploaded atlas start at TOP. Do not invert Y again.
  return (cell+clamp(uv,vec2(.004),vec2(.996)))*.25;
}
vec4 cinematicSample(float frame,bool nuke) {
  vec2 uv=cinematicAtlasUV(frame,vLocalUV);
  if(nuke) return texture(uCinematicNukeAtlas,uv); // already premultiplied
  vec4 art=texture(uCinematicImpactAtlas,uv);
  art.rgb*=art.a;
  return art;
}
#endif
void main() {
#ifdef FRONTIER_CINEMATIC
  // A SAM intercept is an aerial, fast, blue-white event, never a ground fireball.
  // It reuses this instanced sprite quad; no new particles or draw passes.
  if (abs(vFxType-1.0)<0.5) {
    vec2 p=(vLocalUV-.5)*2.0;
    float r=length(p);
    float t=clamp(vFxProgress,0.0,1.0);
    float flash=exp(-18.0*r*r)*pow(1.0-t,5.0);
    float ringRadius=.12+.70*t;
    float ring=exp(-pow((r-ringRadius)*22.0,2.0))*(1.0-t);
    float theta=atan(p.y,p.x);
    float spokes=pow(max(0.0,cos(theta*9.0+t*2.0)),42.0)*
      smoothstep(.13,.24,r)*(1.0-smoothstep(.57,.85,r))*pow(1.0-t,2.0);
#ifdef FRONTIER_REDUCED_MOTION
    flash*=.30;
    spokes*=.50;
#endif
    float alpha=clamp(flash*.94+ring*.29+spokes*.22,0.0,.86)*vAlpha;
    if(alpha<.008) discard;
    vec3 col=mix(vec3(.27,.71,.89),vec3(.96,.98,1.0),clamp(flash+spokes,0.0,1.0));
    fragColor=vec4(col,alpha);
    return;
  }
  // Procedural muzzle/launch flash. Each is a single short-lived instance
  // generated only when a projectile actually appears, not every frame.
  if(vFxType>11.5) {
    vec2 p=(vLocalUV-.5)*2.0;
    float r=length(p),t=clamp(vFxProgress,0.0,1.0);
    bool naval=vFxType<12.5;
    float core=exp(-r*r*(naval ? 18.0 : 24.0))*pow(1.0-t,4.0);
    float angle=atan(p.y,p.x);
    float streak=pow(max(0.0,cos(angle*(naval ? 6.0 : 8.0))),36.0)*
      smoothstep(.04,.13,r)*(1.0-smoothstep(.45,.85,r))*pow(1.0-t,2.4);
#ifdef FRONTIER_REDUCED_MOTION
    core*=0.4;
    streak*=0.6;
#endif
    float alpha=clamp(core*.85+streak*.25,0.0,.78)*vAlpha;
    if(alpha<.008) discard;
    vec3 warm=vec3(1.0,.77,.37),cool=vec3(.52,.83,1.0);
    fragColor=vec4(mix(cool,warm,naval ? 1.0 : 0.0),alpha);
    return;
  }
  // A shell hitting water produces spray and a surface ring, not burning
  // soil. The ground impact and all existing nuclear ground effects are intact.
  if(abs(vFxType-4.0)<.5 && vWaterImpact>.5) {
    vec2 p=(vLocalUV-.5)*2.0;
    float t=clamp(vFxProgress,0.0,1.0);
    float sprayR=length(vec2(p.x,(p.y+.19)*1.25));
    float radius=.11+.58*t;
    float ring=exp(-pow((sprayR-radius)*19.0,2.0))*
      (1.0-smoothstep(.16,.72,abs(p.y+.19)))*pow(1.0-t,1.35);
    float up=clamp(-p.y,0.0,1.0);
    float jet=exp(-pow(p.x/(.11+.18*t),2.0))*
      smoothstep(.04,.24,up)*(1.0-smoothstep(.45+.23*t,.88,up))*
      (1.0-t)*.35;
#ifdef FRONTIER_CINEMATIC_ULTRA
    float ray=pow(abs(sin(atan(p.y+.19,p.x)*11.0)),22.0);
    jet+=ray*exp(-pow((sprayR-(.19+.52*t))*6.5,2.0))*.15*(1.0-t);
#endif
    float alpha=clamp(ring*.43+jet*.53,0.0,.58)*vAlpha;
    if(alpha<.006) discard;
    vec3 color=mix(vec3(.40,.75,.88),vec3(.88,.97,.98),clamp(jet*1.6,0.0,1.0));
    fragColor=vec4(color,alpha);
    return;
  }
  bool newNuke=vCinematic>.5 && vFxType<.5 && uCinematicNukeReady>.5;
  bool newImpact=vCinematic>.5 && (abs(vFxType-2.0)<.5 || abs(vFxType-3.0)<.5 || abs(vFxType-4.0)<.5) && uCinematicImpactReady>.5;
  if(newNuke || newImpact) {
    float frame=floor(vFxFrame);
    vec4 art=cinematicSample(frame,newNuke);
#ifndef FRONTIER_CINEMATIC_MEDIUM
    if(frame<15.0) art=mix(art,cinematicSample(frame+1.0,newNuke),fract(vFxFrame));
#endif
    if(art.a<.012) discard;
    vec3 color=art.rgb/max(art.a,.001);
    // A sinking warship is a cooler metal/steam flash; conventional impacts
    // retain their warm explosion. Same texture, same instance count.
    if(!newNuke && abs(vFxType-3.0)<.5) {
      float steam=smoothstep(.20,.82,vFxProgress);
      color=mix(color,vec3(.43,.57,.63),steam*.48);
    }
    float initial=pow(1.0-clamp(vFxProgress,0.0,1.0),8.0);
    vec3 warm=vec3(1.0,.63,.28)*initial*(newNuke ? .13 : .10);
#ifdef FRONTIER_REDUCED_MOTION
    warm*=.35;
#endif
    fragColor=vec4(min(vec3(1),color+warm),clamp(art.a*vAlpha,0.0,1.0));
    return;
  }
#endif
  vec4 texel=texture(uAtlas,vAtlasUV);
#ifdef FRONTIER_CINEMATIC
  bool nuke=vFxType<.5;
  bool buildingBlast=abs(vFxType-2.0)<.5;
  bool shellBlast=abs(vFxType-4.0)<.5;
  if(nuke || buildingBlast || shellBlast) {
    float life=clamp(vFxProgress,0.0,1.0);
    float radius=length((vLocalUV-.5)*2.0);
    float bloom=(1.0-smoothstep(.06,.88,radius))*pow(1.0-life,nuke ? 4.0 : 2.6);
#ifdef FRONTIER_REDUCED_MOTION
    bloom*=.6;
#endif
    float hot=pow(1.0-life,nuke ? 1.7 : 1.3);
    vec3 fire=mix(vec3(.25,.24,.24),vec3(1.0,.59,.24),hot);
    vec3 color=mix(texel.rgb,texel.rgb*fire*1.45,nuke ? .46 : .32);
    color+=vec3(1.0,.72,.32)*bloom*(nuke ? .58 : .50);
    float alpha=max(texel.a,bloom*(nuke ? .26 : .17))*vAlpha;
    if(alpha<.012) discard;
    fragColor=vec4(min(color,vec3(1)),clamp(alpha,0.0,1.0));
    return;
  }
#endif
  if(texel.a<.01) discard;
  fragColor=vec4(texel.rgb,texel.a*vAlpha);
}
