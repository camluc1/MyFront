#version 300 es
// FRONTIER_CINEMATIC_VARIANT
precision highp float;
precision highp usampler2D;
uniform usampler2D uTrailTex;
uniform sampler2D uPalette;
uniform sampler2D uAffiliation;
uniform sampler2D uEffect;
uniform vec2 uMapSize;
uniform float uTrailAlpha;
uniform float uTime;
uniform int uAltView;
in vec2 vWorldPos;
out vec4 fragColor;
#ifdef FRONTIER_CINEMATIC
float boatNeighbor(ivec2 p, uint owner) {
  ivec2 end=textureSize(uTrailTex,0)-1;
  if(any(lessThan(p,ivec2(0))) || any(greaterThan(p,end))) return 0.0;
  // Do not mistake a missile trail owned by the same player for a boat wake.
  uint value=texelFetch(uTrailTex,p,0).r;
  return (value&0x1FFFu)==owner ? 1.0 : 0.0;
}
#endif
void main() {
  ivec2 tc=ivec2(floor(vWorldPos));
  if(tc.x<0 || tc.y<0 || tc.x>=int(uMapSize.x) || tc.y>=int(uMapSize.y)) discard;
  uint trailVal=texelFetch(uTrailTex,tc,0).r;
  uint owner=trailVal&0xFFFu;
  if(owner==0u) discard;
  uint isNuke=(trailVal>>12)&1u;
  vec3 color;
  if(uAltView!=0) color=texelFetch(uAffiliation,ivec2(int(owner),1),0).rgb;
  else {
    int o=int(owner), rowBase=isNuke==1u ? MAX_TRAIL_COLORS : 0;
    int count=int(texelFetch(uEffect,ivec2(o,rowBase),0).a+.5);
    if(count<=0) {
      float u=(float(owner)+.5)/float(PALETTE_SIZE);
      color=texture(uPalette,vec2(u,.25)).rgb;
    } else if(count==1) color=texelFetch(uEffect,ivec2(o,rowBase),0).rgb;
    else if(int(texelFetch(uEffect,ivec2(o,rowBase+1),0).a+.5)==2)
      color=texelFetch(uEffect,ivec2(o,rowBase),0).rgb;
    else if(int(texelFetch(uEffect,ivec2(o,rowBase+1),0).a+.5)==1) {
      float t=uTime*texelFetch(uEffect,ivec2(o,rowBase+2),0).a;
      int i=int(t)%count, j=(i+1)%count;
      color=mix(texelFetch(uEffect,ivec2(o,rowBase+i),0).rgb,
        texelFetch(uEffect,ivec2(o,rowBase+j),0).rgb,fract(t));
    } else {
      float colorSize=max(texelFetch(uEffect,ivec2(o,rowBase+2),0).a,.001);
      float speed=texelFetch(uEffect,ivec2(o,rowBase+3),0).a;
      float f=fract((vWorldPos.x+vWorldPos.y-uTime*speed)/(colorSize*float(count)))*float(count);
      int i=int(f)%count, j=(i+1)%count;
      color=mix(texelFetch(uEffect,ivec2(o,rowBase+i),0).rgb,
        texelFetch(uEffect,ivec2(o,rowBase+j),0).rgb,fract(f));
    }
  }
#ifdef FRONTIER_CINEMATIC
  if(isNuke==0u && uAltView==0) {
    float footprint=max(fwidth(vWorldPos.x),fwidth(vWorldPos.y));
    float detail=1.0-smoothstep(.65,1.85,footprint);
    if(detail>.01) {
      float l=boatNeighbor(tc+ivec2(-1,0),owner),r=boatNeighbor(tc+ivec2(1,0),owner);
      float u=boatNeighbor(tc+ivec2(0,-1),owner),d=boatNeighbor(tc+ivec2(0,1),owner);
      float xx=l+r, yy=u+d;
      vec2 tangent=xx>=yy ? vec2(1,0) : vec2(0,1);
      vec2 directed=vec2(r-l,d-u);
      if(abs(xx-yy)<.01 && dot(directed,directed)>.01) tangent=normalize(directed);
#ifdef FRONTIER_CINEMATIC_ULTRA
      // Exactly straight two-sided segments already have an unambiguous
      // axis. Only corners, ends and diagonals need the four extra reads.
      // These are identical for ordinary straight wakes, at full resolution.
      if(abs(xx-yy)<1.5) {
        float nw=boatNeighbor(tc+ivec2(-1,-1),owner),ne=boatNeighbor(tc+ivec2(1,-1),owner);
        float sw=boatNeighbor(tc+ivec2(-1,1),owner),se=boatNeighbor(tc+ivec2(1,1),owner);
        float xy=(nw+se-ne-sw)*.5;
        if(abs(xx-yy)+abs(xy)>.01) {
          float angle=.5*atan(2.0*xy,xx-yy);
          tangent=vec2(cos(angle),sin(angle));
        }
      }
#endif
      vec2 across=vec2(-tangent.y,tangent.x);
      float lateral=abs(dot(fract(vWorldPos)-.5,across));
      float whiteEdge=1.0-smoothstep(.04,.27,lateral);
#ifdef FRONTIER_REDUCED_MOTION
      float t=0.0;
#else
      float t=uTime;
#endif
      float wave=.74+.26*sin(dot(vWorldPos,tangent)*8.0-t*1.6);
      float foam=whiteEdge*detail*wave;
#ifdef FRONTIER_CINEMATIC_ULTRA
      float breakup=.74+.26*sin(dot(vWorldPos,vec2(2.31,3.17))-t*.61);
      foam*=breakup;
      float fringe=(1.0-smoothstep(.25,.43,lateral))*smoothstep(.10,.25,lateral);
      foam+=fringe*detail*breakup*.16;
#endif
      color=mix(color,vec3(.76,.92,.96),foam*.56);
    }
  }
#endif
  fragColor=vec4(color,uTrailAlpha);
}
