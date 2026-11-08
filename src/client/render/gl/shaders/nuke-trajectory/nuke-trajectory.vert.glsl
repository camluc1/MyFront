#version 300 es
precision highp float;
layout(location=0) in vec3 aVertex;
uniform mat3 uCamera;
uniform vec2 uP0,uP1,uP2,uP3;
uniform float uPixelSize;
uniform float uQuadHalfPx;
out float vT;
out float vArcDist;
out float vEdgeDist;
vec2 bezier(float t) {
  float T=1.0-t,TT=T*T,tt=t*t;
  return TT*T*uP0+3.0*TT*t*uP1+3.0*T*tt*uP2+tt*t*uP3;
}
vec2 bezierDeriv(float t) {
  float T=1.0-t;
  return 3.0*(T*T*(uP1-uP0)+2.0*T*t*(uP2-uP1)+t*t*(uP3-uP2));
}
void main() {
  float t=aVertex.x,side=aVertex.y;
  vec2 pos=bezier(t),tang=bezierDeriv(t);
  // Keep the authoritative curve. Avoid an arbitrary horizontal ribbon
  // normal at a stationary tangent on nearly vertical launch paths.
  if(dot(tang,tang)<.000001) {
    tang=bezier(min(1.0,t+.002))-bezier(max(0.0,t-.002));
    if(dot(tang,tang)<.000001) tang=uP3-uP0;
    if(dot(tang,tang)<.000001) tang=vec2(1,0);
  }
  vec2 normTang=normalize(tang);
  pos+=vec2(-normTang.y,normTang.x)*side*uQuadHalfPx*uPixelSize;
  pos+=.5;
  vT=t;vEdgeDist=side;vArcDist=aVertex.z;
  gl_Position=vec4((uCamera*vec3(pos,1)).xy,0,1);
}
