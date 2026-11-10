#version 300 es
precision highp float;
// (x,y,ownerID,active). Two narrow contours for each protected dome.
layout(location=0) in vec4 aDome;
layout(location=1) in float aPulseStart;
uniform mat3 uCamera;
uniform float uTime;
out float vSide;
out float vPhase;
out float vInner;
out float vInterceptPulse;
flat out float vOwner;
const float PI2 = 6.28318530718;
const float SEGMENTS = 128.0;
void main() {
  int quadVertex = gl_VertexID % 6;
  int segment = (gl_VertexID / 6) % 128;
  int ring = gl_VertexID / (6 * 128);
  float nextAngle = (quadVertex==2 || quadVertex==4 || quadVertex==5) ? 1.0 : 0.0;
  float radial = (quadVertex==1 || quadVertex==3 || quadVertex==4) ? 1.0 : 0.0;
  float phase = (float(segment)+nextAngle) / SEGMENTS;
  float theta = phase*PI2;
  // Radius comes from the unit's actual upgrade level; level one is 84.
  float radius = aDome.w * (ring==0 ? 1.0 : .72);
  float thickness = ring==0 ? 1.5 : .85;
  radius += (radial-.5)*thickness;
  vec2 pos = aDome.xy + vec2(cos(theta),sin(theta))*radius;
  vec3 clip = uCamera*vec3(pos,1.0);
  gl_Position=vec4(clip.xy,0.0,1.0);
  vSide=radial;
  vPhase=phase;
  vInner=float(ring);
  vOwner=aDome.z;
  float age=uTime-aPulseStart;
  vInterceptPulse = (aPulseStart>0.0 && age>=0.0 && age<1.1)
    ? 1.0-smoothstep(0.04,1.1,age) : 0.0;
}
