#version 300 es
precision highp float;
out vec4 fragColor;

// One-time atlas bake only. This shader NEVER runs in the gameplay frame loop.
float hash3(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),
                 mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),
                 mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) {
  return noise3(p)*.57+noise3(p*2.03+11.7)*.29+noise3(p*4.11+3.1)*.14;
}
float density(vec3 p, float life, float grow) {
  float crownY=.35+1.83*grow;
  float radius=.20+1.03*grow;
  vec3 q=p;
  q.x-=.09*grow + .045*sin(p.y*2.7)*grow;
  float cap=1.0-length(vec3(q.x/radius,(q.y-crownY)/(.17+.39*grow),q.z/(radius*.76)));
  float stemR=.08+.17*grow+.055*sin(q.y*3.8-life*3.0);
  float stem=1.0-length(q.xz)/stemR;
  stem=min(stem, min(q.y*8.0,(crownY-q.y)*5.0));
  float envelope=max(cap,stem*.65);
  if(envelope < -.38) return 0.0;
  // Advect material upward; coherent coordinates keep neighboring frames related.
  vec3 adv=vec3(q.x,q.y-life*.78,q.z);
  float broad=fbm(adv*3.5+vec3(4.1,8.7,2.3));
  float detail=noise3(adv*13.0+6.1);
  float edge=envelope+(broad-.5)*.95+(detail-.5)*.12;
  return smoothstep(-.12,.28,edge) * (.40+.60*broad)*3.9;
}
void main() {
  vec2 cell=floor(gl_FragCoord.xy/256.0);
  float frame=cell.y*4.0+cell.x;
  if(frame<1.0 || frame>14.5) { fragColor=vec4(0); return; }
  float life=frame/15.0;
  float grow=1.0-pow(1.0-life,1.65);
  vec2 uv=mod(gl_FragCoord.xy,256.0)/256.0;
  vec3 ray=vec3((uv.x-.5)*3.35,(.855-uv.y)*3.75,1.50);
  if(ray.y<-.06) { fragColor=vec4(0); return; }
  float transmit=1.0;
  vec3 accumulated=vec3(0);
  const float stepSize=3.0/28.0;
  vec3 lightDir=normalize(vec3(-.45,.65,.55));
  for(int i=0;i<28;i++) {
    vec3 p=ray-vec3(0,0,(float(i)+.5)*stepSize);
    float d=density(p,life,grow);
    if(d>.005) {
      float shadow=density(p+lightDir*.19,life,grow);
      float illumination=clamp(.67+(d-shadow)*.48,.22,1.12);
      vec3 ash=mix(vec3(.30,.31,.32),vec3(.68,.66,.61),illumination);
      float heat=exp(-p.y*1.15)*pow(1.0-life,2.5);
      vec3 color=ash+vec3(.88,.40,.10)*heat;
      float opacity=1.0-exp(-d*stepSize*1.8);
      accumulated+=transmit*opacity*color;
      transmit*=1.0-opacity;
      if(transmit<.012) break;
    }
  }
  float fade=(1.0-smoothstep(.71,1.0,life))*smoothstep(0.0,.12,life);
  // Premultiplied RGBA: bake over premultiplied ground artwork with ONE blending.
  fragColor=vec4(accumulated,1.0-transmit)*fade;
}
