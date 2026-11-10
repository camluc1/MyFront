#version 300 es
precision highp float;
in float vSide;
in float vPhase;
in float vInner;
in float vInterceptPulse;
flat in float vOwner;
uniform float uTime;
uniform float uLocalPlayerID;
out vec4 fragColor;
void main() {
  float self=1.0-step(.5,abs(vOwner-uLocalPlayerID));
  // Animate a restrained luminous arc along the existing thin contour.
  // The old #ifdef had no active define in this pass, so the GPU optimized
  // the whole animation (including uTime) away. One sine per visible ring
  // fragment is cheap and keeps every quality preset visually alive.
  float wave=.5+.5*sin(6.2831853*(vPhase*11.0-uTime*.09));
  float shimmer=pow(wave,9.0);
  float opacity=mix(.17,.35,self)*mix(1.0,.42,vInner);
  opacity*=.90+.10*wave;
  vec3 field=mix(vec3(.39,.55,.79),vec3(.17,.83,1.0),self);
  field=mix(field,vec3(.77,.98,1.0),shimmer*.32);
  // A successful real interception sends a single luminous flash over the
  // existing ring geometry: no particles, counter or extra GPU draw call.
  field=mix(field,vec3(.91,1.0,1.0),vInterceptPulse*.88);
  opacity=min(.92,opacity+vInterceptPulse*.54);
  float edge=.82+.18*(1.0-abs(vSide*2.0-1.0));
  fragColor=vec4(field,opacity*edge);
}
