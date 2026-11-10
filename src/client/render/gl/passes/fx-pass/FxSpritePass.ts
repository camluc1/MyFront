/** Instanced sprites. Cinematic clouds are baked once; per-frame work is atlas sampling. */
import type { Config } from "@openfront/engine-lib/configuration/Config";
import { assetUrl } from "@openfront/shared/AssetUrls";
import type { ConquestFx, DeadUnitFx, RendererConfig } from "../../../types";
import { STRUCTURE_TYPES, UT_SHELL, UT_TRAIN, UT_WARSHIP, UT_BISMARCK, UT_MIRV_WARHEAD, UT_ATOM_BOMB, UT_TSAR_BOMBA, UT_ATTACK_AIRCRAFT, UT_BOMBER_AIRCRAFT, UT_FIGHTER_AIRCRAFT } from "../../../types";
import { DynamicInstanceBuffer } from "../../DynamicBuffer";
import { cinematicQualityBudget, enhancedVisualsEnabled, ENHANCED_SHADER_MARKER } from "../../EnhancedVisuals";
import type { RenderSettings } from "../../RenderSettings";
import { createProgram, shaderSrc } from "../../utils/GlUtils";
import { bakeCinematicCloudAtlas, nuclearGroundAtlas } from "../../utils/CinematicCloudAtlas";
import { nukeExplosionRadius } from "./FxSettings";
import { isFxVisible } from "./FxVisibility";
import fxAtlasMeta from "resources/atlases/fx-atlas-meta.json";
import spriteFragSrc from "../../shaders/fx/sprite.frag.glsl?raw";
import spriteVertSrc from "../../shaders/fx/sprite.vert.glsl?raw";

const fxAtlasUrl = assetUrl("atlases/fx-atlas.png");
const cinematicNukeAtlasUrl = assetUrl("sprites/cinematic-nuke-atlas.svg");
const cinematicImpactAtlasUrl = assetUrl("sprites/cinematic-impact-atlas.svg");
const CINEMATIC_NUKE_LIFETIME_MS = 3_200;
const MAX_CINEMATIC_DEBRIS_PER_TYPE = 12;
const MAX_CINEMATIC_FX_INSTANCES = 640;
const FX_NUKE = 0, FX_SAM_EXPLOSION = 1, FX_BUILDING_EXPLOSION = 2;
const FX_UNIT_EXPLOSION = 3, FX_MINI_EXPLOSION = 4, FX_SINKING_SHIP = 5;
const FX_MINI_FIRE = 6, FX_MINI_SMOKE = 7, FX_MINI_BIG_SMOKE = 8;
const FX_MINI_SMOKE_FIRE = 9, FX_DUST = 10, FX_CONQUEST = 11;
// Procedural launch flashes: zero new textures and the same instanced draw.
const FX_NAVAL_LAUNCH = 12, FX_SAM_LAUNCH = 13;
const FX_TYPE_COUNT = 14;
// Existing frame counts/durations are unchanged for the classic profile.
const FX_CONFIG = [
  [9,70,false], [9,70,false], [10,70,false], [4,70,false],
  [4,70,false], [14,90,false], [6,100,true], [4,120,true],
  [5,120,true], [5,120,true], [3,100,false], [10,90,false],
  [5,55,false], [5,45,false],
] as const;
const DEBRIS_PLAN = [
  { type: FX_MINI_FIRE, radiusFactor: 1, density: 1/25 },
  { type: FX_MINI_SMOKE, radiusFactor: 1, density: 1/28 },
  { type: FX_MINI_BIG_SMOKE, radiusFactor: .9, density: 1/70 },
  { type: FX_MINI_SMOKE_FIRE, radiusFactor: .9, density: 1/70 },
];
function seededRandom(seed: number): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
interface ActiveFx {
  x: number; y: number; fxType: number; startMs: number; lifetimeMs: number;
  fadeIn: number; fadeOut: number; cinematic: boolean; scale: number;
}
// The two formerly unused bytes carry interpolation and cloud scale. Still 16 bytes.
const SPRITE_FLOATS = 4, SPRITE_BYTES = 16;

export class FxSpritePass {
  private readonly mapW: number;
  private program: WebGLProgram;
  private readonly uCamera: WebGLUniformLocation;
  private readonly uFxUV: WebGLUniformLocation;
  private readonly uFxWorld: WebGLUniformLocation;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadBuf: WebGLBuffer;
  private readonly instanceBuf: DynamicInstanceBuffer;
  private spriteCount = 0;
  private readonly atlasTex: WebGLTexture;
  private atlasReady = false;
  private cinematic = enhancedVisualsEnabled();
  private readonly budget = cinematicQualityBudget();
  private cinematicNukeTex: WebGLTexture | null = null;
  private cinematicNukeReady = false;
  private uCinematicNukeReady: WebGLUniformLocation | null = null;
  private cinematicImpactTex: WebGLTexture | null = null;
  private cinematicImpactReady = false;
  private uCinematicImpactReady: WebGLUniformLocation | null = null;
  private activeFx: ActiveFx[] = [];
  private timeFn: () => number = () => performance.now();
  private isDisposed = false;
  private readonly atlasAbort = new AbortController();

  constructor(private gl: WebGL2RenderingContext, header: RendererConfig,
    private settings: RenderSettings, private config: Config,
    private terrainFlagsTex: WebGLTexture | null = null) {
    this.mapW = header.mapWidth;
    const vertex = shaderSrc(spriteVertSrc, { FX_TYPE_COUNT });
    try {
      this.program = createProgram(gl, vertex, spriteFragSrc, "FxSpritePass");
    } catch (error) {
      if (!this.cinematic || gl.isContextLost()) throw error;
      console.warn("Cinematic blast shader unavailable; using classic FX", error);
      this.cinematic = false;
      this.program = createProgram(gl, vertex.replace(ENHANCED_SHADER_MARKER, ""),
        spriteFragSrc.replace(ENHANCED_SHADER_MARKER, ""), "FxSpritePass fallback");
    }
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uFxUV = gl.getUniformLocation(this.program, "uFxUV")!;
    this.uFxWorld = gl.getUniformLocation(this.program, "uFxWorld")!;
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 0);
    this.atlasTex = this.placeholderTexture(0, gl.NEAREST);
    if (this.cinematic) {
      this.uCinematicNukeReady = gl.getUniformLocation(this.program, "uCinematicNukeReady");
      this.uCinematicImpactReady = gl.getUniformLocation(this.program, "uCinematicImpactReady");
      gl.uniform1i(gl.getUniformLocation(this.program, "uCinematicNukeAtlas"), 1);
      gl.uniform1i(gl.getUniformLocation(this.program, "uCinematicImpactAtlas"), 2);
      gl.uniform1i(gl.getUniformLocation(this.program, "uTerrainFlags"), 3);
      gl.uniform1i(gl.getUniformLocation(this.program, "uHasTerrainFlags"),
        this.terrainFlagsTex ? 1 : 0);
      this.cinematicNukeTex = this.placeholderTexture(1, gl.LINEAR);
      this.cinematicImpactTex = this.placeholderTexture(2, gl.LINEAR);
    }
    gl.activeTexture(gl.TEXTURE0);
    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(gl, glBuf, 256, SPRITE_FLOATS);
    this.vao = gl.createVertexArray()!;
    this.quadBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,1,0,0,1,1,0,1,1,0,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, SPRITE_BYTES, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, false, SPRITE_BYTES, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    void this.loadAtlas();
    if (this.cinematic) {
      void this.loadCinematicNukeAtlas();
      void this.loadCinematicImpactAtlas();
    }
  }

  private placeholderTexture(slot: number, filter: number): WebGLTexture {
    const gl = this.gl, tex = gl.createTexture();
    if (!tex) throw new Error("FX texture allocation failed");
    gl.activeTexture(gl.TEXTURE0 + slot);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  private async image(url: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    return img;
  }
  private upload(tex: WebGLTexture, img: HTMLImageElement, slot: number, premultiplied = false): void {
    const gl = this.gl;
    const active = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
    const premul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
    gl.activeTexture(gl.TEXTURE0 + slot);
    const binding = gl.getParameter(gl.TEXTURE_BINDING_2D);
    try {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied ? 1 : 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, binding);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip ? 1 : 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul ? 1 : 0);
      gl.activeTexture(active);
    }
  }
  private async loadAtlas(): Promise<void> {
    try {
      const img = await this.image(fxAtlasUrl);
      if (this.isDisposed) return;
      this.upload(this.atlasTex, img, 0);
      const uvData = new Float32Array(FX_TYPE_COUNT * 4);
      const worldData = new Float32Array(FX_TYPE_COUNT * 4);
      for (let i = 0; i < FX_TYPE_COUNT; i++) {
        const row = fxAtlasMeta.rows[i];
        if (!row) {
          // Launch flashes are shader-generated, with a small bounded footprint.
          const width = i === FX_NAVAL_LAUNCH ? 20 : 18;
          worldData[i*4] = width;
          worldData[i*4+1] = width;
          continue;
        }
        uvData[i*4] = row.yOffset / fxAtlasMeta.height;
        uvData[i*4+1] = row.height / fxAtlasMeta.height;
        uvData[i*4+2] = row.worldWidth / fxAtlasMeta.width;
        worldData[i*4] = row.worldWidth;
        worldData[i*4+1] = row.worldHeight;
      }
      const old = this.gl.getParameter(this.gl.CURRENT_PROGRAM);
      this.gl.useProgram(this.program);
      this.gl.uniform4fv(this.uFxUV, uvData);
      this.gl.uniform4fv(this.uFxWorld, worldData);
      this.gl.useProgram(old);
      this.atlasReady = true;
    } catch (error) { if (!this.isDisposed) console.warn("Failed to load FX atlas", error); }
  }
  private async loadCinematicNukeAtlas(): Promise<void> {
    if (!this.cinematicNukeTex) return;
    try {
      const response = await fetch(cinematicNukeAtlasUrl, { signal: this.atlasAbort.signal });
      if (!response.ok) throw new Error(`Nuclear atlas HTTP ${response.status}`);
      const svg = nuclearGroundAtlas(await response.text());
      const img = await this.image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      if (this.isDisposed || !this.cinematicNukeTex) return;
      this.upload(this.cinematicNukeTex, img, 1, true);
      bakeCinematicCloudAtlas(this.gl, this.cinematicNukeTex);
      this.cinematicNukeReady = true;
    } catch (error) {
      if (this.isDisposed) return;
      console.warn("Cloud bake unavailable; using original nuclear atlas", error);
      try {
        const img = await this.image(cinematicNukeAtlasUrl);
        if (this.isDisposed || !this.cinematicNukeTex) return;
        this.upload(this.cinematicNukeTex, img, 1, true);
        this.cinematicNukeReady = true;
      } catch (fallbackError) { if (!this.isDisposed) console.warn("Using classic nuclear sprite", fallbackError); }
    }
  }
  private async loadCinematicImpactAtlas(): Promise<void> {
    try {
      const img = await this.image(cinematicImpactAtlasUrl);
      if (this.isDisposed || !this.cinematicImpactTex) return;
      this.upload(this.cinematicImpactTex, img, 2);
      this.cinematicImpactReady = true;
    } catch (error) { if (!this.isDisposed) console.warn("Using classic impact sprites", error); }
  }

  private append(fx: ActiveFx): void {
    // Bound CPU state as well as GPU instances. No sort/filter allocations during barrages.
    if (this.cinematic && this.activeFx.length >= MAX_CINEMATIC_FX_INSTANCES) {
      let index = -1, oldest = Infinity;
      for (let i=0; i<this.activeFx.length; i++) {
        const candidate=this.activeFx[i];
        if (candidate.fxType > FX_MINI_EXPLOSION && candidate.startMs < oldest) {
          index=i; oldest=candidate.startMs;
        }
      }
      if (index < 0) {
        if (fx.fxType > FX_MINI_EXPLOSION) return;
        for (let i=0; i<this.activeFx.length; i++) if (this.activeFx[i].startMs < oldest) {
          index=i; oldest=this.activeFx[i].startMs;
        }
      }
      this.activeFx[index] = fx;
    } else this.activeFx.push(fx);
  }
  applyRailroadDust(tileRefs: number[]): void {
    const now=this.timeFn();
    for (const ref of tileRefs) if (Math.random() <= .33) this.pushFx(ref % this.mapW, Math.floor(ref / this.mapW), FX_DUST, now);
  }
  applyConquestEvents(events: ConquestFx[]): void {
    const now=this.timeFn(), f=this.settings.fx;
    for (const evt of events) {
      const startMs=now-(evt.tickAge ?? 0)*this.config.msPerTick();
      if (now-startMs >= f.conquestLifetimeMs) continue;
      this.append({x:evt.x,y:evt.y,fxType:FX_CONQUEST,startMs,lifetimeMs:f.conquestLifetimeMs,
        fadeIn:f.conquestFadeIn,fadeOut:f.conquestFadeOut,cinematic:false,scale:1});
    }
  }
  spawnFxForUnit(unit: DeadUnitFx, now: number): void {
    const type=unit.unitType, x=unit.pos%this.mapW, y=Math.floor(unit.pos/this.mapW);
    const radius=nukeExplosionRadius(this.settings.fx,type);
    if (radius !== undefined) {
      if (unit.reachedTarget) {
        // MIRV WARHEADS detonate; the carrier splits and must not create a fake ground blast.
        const scale=type === UT_MIRV_WARHEAD ? .56 : type === UT_ATOM_BOMB ? .80 : type === UT_TSAR_BOMBA ? 1.75 : 1;
        this.pushFx(x,y,FX_NUKE,now,scale);
        let debrisIdx=0;
        for (const {type: debrisType,radiusFactor,density} of DEBRIS_PLAN) {
          const proposed=Math.max(0,Math.floor(radius*density*this.settings.fx.debrisDensity));
          const count=this.cinematic ? Math.min(MAX_CINEMATIC_DEBRIS_PER_TYPE,proposed) : proposed;
          for(let i=0;i<count;i++) {
            const seed=unit.pos*997+debrisIdx++;
            const angle=seededRandom(seed)*Math.PI*2, dist=seededRandom(seed+0x10000)*radius*radiusFactor/2;
            this.pushDebris(x+Math.floor(Math.cos(angle)*dist),y+Math.floor(Math.sin(angle)*dist),debrisType,now);
          }
        }
      } else this.pushFx(x,y,FX_SAM_EXPLOSION,now);
      return;
    }
    if(type===UT_WARSHIP || type===UT_BISMARCK) {
      this.pushFx(x,y,FX_UNIT_EXPLOSION,now);
      this.pushFx(x,y,FX_SINKING_SHIP,now);
    } else if(type===UT_ATTACK_AIRCRAFT || type===UT_BOMBER_AIRCRAFT ||
      type===UT_FIGHTER_AIRCRAFT) {
      // A shot-down aircraft explodes in air; it must never sink like a ship.
      this.pushFx(x,y,FX_UNIT_EXPLOSION,now);
    }
    else if((type===UT_SHELL && unit.reachedTarget)||(type===UT_TRAIN && !unit.reachedTarget)) this.pushFx(x,y,FX_MINI_EXPLOSION,now);
    else if(STRUCTURE_TYPES.has(type)) this.pushFx(x,y,FX_BUILDING_EXPLOSION,now);
  }
  /** Visual only. The unit pass detects a real, newly visible launch. */
  spawnWeaponLaunch(x:number,y:number,kind:"naval"|"sam",now:number): void {
    if (!this.cinematic) return;
    this.pushFx(x,y,kind==="naval" ? FX_NAVAL_LAUNCH : FX_SAM_LAUNCH,now);
  }
  pushFx(x:number,y:number,fxType:number,now:number,scale=1): void {
    const cfg=FX_CONFIG[fxType];
    if(!cfg) return;
    // Freeze the sequence at spawn: async atlas completion cannot switch a live effect's timing.
    const cinematic=this.cinematic && (fxType===FX_NUKE ? this.cinematicNukeReady :
      fxType>=FX_BUILDING_EXPLOSION && fxType<=FX_MINI_EXPLOSION && this.cinematicImpactReady);
    const lifetimeMs=cinematic ? fxType===FX_NUKE ? CINEMATIC_NUKE_LIFETIME_MS :
      fxType===FX_BUILDING_EXPLOSION ? 1200 : fxType===FX_UNIT_EXPLOSION ? 900 : 700 : cfg[0]*cfg[1];
    this.append({x,y,fxType,startMs:now,lifetimeMs,fadeIn:0,fadeOut:1,cinematic,scale});
  }
  private pushDebris(x:number,y:number,fxType:number,now:number): void {
    const f=this.settings.fx;
    this.append({x,y,fxType,startMs:now,lifetimeMs:f.debrisLifetimeMs,
      fadeIn:f.debrisFadeIn,fadeOut:f.debrisFadeOut,cinematic:false,scale:1});
  }
  tick(): void {
    const now=this.timeFn();
    for(let i=this.activeFx.length-1;i>=0;i--) if(now-this.activeFx[i].startMs>=this.activeFx[i].lifetimeMs) {
      this.activeFx[i]=this.activeFx[this.activeFx.length-1];this.activeFx.pop();
    }
    if(!this.activeFx.length) this.spriteCount=0;
  }
  private rebuildInstances(now:number, camera:Float32Array): void {
    this.instanceBuf.ensureCapacity(this.activeFx.length);
    let count=0, plumeArea=0;
    // Weapon impacts before incidental smoke; reverse order favors recent detonations.
    const passes=this.cinematic ? 2 : 1;
    for(let pass=0;pass<passes;pass++) for(let n=0;n<this.activeFx.length;n++) {
      const i=this.cinematic ? this.activeFx.length-1-n : n;
      const fx=this.activeFx[i];
      if(this.cinematic && ((fx.fxType<=FX_MINI_EXPLOSION) !== (pass===0))) continue;
      if(this.cinematic) {
        if(count>=this.budget.fxLimit) break;
        // Per-effect bounds match the drawn quad, including the tall
        // nuclear column. Tiny flashes no longer use a 160-tile margin.
        if (!isFxVisible(camera, fx)) continue;
        if(fx.fxType===FX_NUKE && fx.cinematic) {
          const area=fx.scale*fx.scale;
          if(plumeArea+area>this.budget.plumeLimit) continue;
          plumeArea+=area;
        }
      }
      const cfg=FX_CONFIG[fx.fxType], elapsed=Math.max(0,now-fx.startMs);
      const frame=fx.cinematic ? Math.min(15,16*elapsed/fx.lifetimeMs) :
        cfg[2] ? Math.floor((elapsed%(cfg[0]*cfg[1]))/cfg[1]) : Math.min(Math.floor(elapsed/cfg[1]),cfg[0]-1);
      let alpha=255;
      const life=elapsed/fx.lifetimeMs;
      if(fx.fadeIn>0 && life<fx.fadeIn) alpha=Math.floor(life/fx.fadeIn*255);
      else if(fx.fadeOut<1 && life>fx.fadeOut) alpha=Math.floor((1-life)/(1-fx.fadeOut)*255);
      const off=count*SPRITE_FLOATS, byte=count*SPRITE_BYTES;
      this.instanceBuf.float32[off]=fx.x;
      this.instanceBuf.float32[off+1]=fx.y;
      this.instanceBuf.float32[off+2]=fx.fxType;
      this.instanceBuf.uint8[byte+12]=Math.floor(frame);
      this.instanceBuf.uint8[byte+13]=Math.max(0,Math.min(255,alpha));
      this.instanceBuf.uint8[byte+14]=fx.cinematic ? Math.round((frame-Math.floor(frame))*255) : 0;
      this.instanceBuf.uint8[byte+15]=fx.cinematic ? Math.max(1,Math.min(255,Math.round(fx.scale*128))) : 0;
      count++;
    }
    this.spriteCount=count;
  }
  draw(cameraMatrix:Float32Array): void {
    if(!this.atlasReady || !this.activeFx.length) return;
    this.rebuildInstances(this.timeFn(),cameraMatrix);
    if(!this.spriteCount) return;
    const gl=this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera,false,cameraMatrix);
    if(this.cinematicNukeTex) {
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.cinematicNukeTex);
      gl.uniform1f(this.uCinematicNukeReady,this.cinematicNukeReady ? 1 : 0);
    }
    if(this.cinematicImpactTex) {
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.cinematicImpactTex);
      gl.uniform1f(this.uCinematicImpactReady,this.cinematicImpactReady ? 1 : 0);
    }
    if(this.cinematic && this.terrainFlagsTex) {
      // Existing shared R8UI map. The vertex shader only checks shell impacts.
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D,this.terrainFlagsTex);
    }
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.atlasTex);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.instanceBuf.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER,0,this.instanceBuf.float32,0,this.spriteCount*SPRITE_FLOATS);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,this.spriteCount);
  }
  setTimeFn(fn:()=>number): void {this.timeFn=fn;}
  clear(): void {this.activeFx.length=0;this.spriteCount=0;}
  dispose(): void {
    this.isDisposed=true;this.atlasAbort.abort();this.clear();
    const gl=this.gl;
    gl.deleteProgram(this.program);this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);gl.deleteBuffer(this.quadBuf);gl.deleteTexture(this.atlasTex);
    if(this.cinematicNukeTex) gl.deleteTexture(this.cinematicNukeTex);
    if(this.cinematicImpactTex) gl.deleteTexture(this.cinematicImpactTex);
    this.cinematicNukeTex=null;this.cinematicImpactTex=null;
    this.cinematicNukeReady=false;this.cinematicImpactReady=false;
  }
}
