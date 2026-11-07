#version 300 es
precision highp float;

uniform sampler2D uTerrain;
uniform vec3 uBackground;
uniform float uTime;
uniform vec4 uSurface; // water motion, highlights, relief, surface grain
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
    } else if (height != 31 && detail>0.0) {
      ivec2 coord=ivec2(world),limit=textureSize(uTerrain,0)-1;
      float nw=elevation(coord-ivec2(1),limit,float(height));
      float se=elevation(coord+ivec2(1),limit,float(height));
      float relief=clamp((se-nw)*0.11,-1.0,1.0);
      // A fixed upper-left light keeps the terrain readable while panning.
      float textureGrain=grain(world*0.30)-0.5;
      float broad=grain(world*0.055)-0.5;
      float rock=height>=16 ? 1.3 : 0.7;
      color*=1.0+(relief*uSurface.z+(textureGrain*rock+broad)*uSurface.w)*detail;
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
  fragColor = vec4(color, 1.0);
}
