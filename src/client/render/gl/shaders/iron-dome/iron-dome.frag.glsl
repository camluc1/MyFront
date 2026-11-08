#version 300 es
precision highp float;
in float vSide;
in float vPhase;
in float vInner;
flat in float vOwner;
uniform float uTime;
uniform float uLocalPlayerID;
out vec4 fragColor;
void main() {
  float self=1.0-step(.5,abs(vOwner-uLocalPlayerID));
  float bright=.5+.5*sin(6.2831853*(vPhase*11.0-uTime*.07));
  float opacity=mix(.18,.38,self)*mix(1.0,.38,vInner);
#ifdef FRONTIER_CINEMATIC_ULTRA
  opacity*=.92+.08*bright;
  // Traveling interference along the containment field.
  float shimmer=pow(bright,9.0);
#else
  float shimmer=0.0;
#endif
  vec3 field=mix(vec3(.39,.55,.79),vec3(.17,.83,1.0),self);
  field=mix(field,vec3(.75,.97,1.0),shimmer*.26);
  float edge=.82+.18*(1.0-abs(vSide*2.0-1.0));
  fragColor=vec4(field,opacity*edge);
}
