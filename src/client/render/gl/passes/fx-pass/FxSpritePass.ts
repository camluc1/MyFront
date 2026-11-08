/**
 * FxSpritePass — instanced textured quads sampling an animated sprite atlas.
 *
 * Manages: sprite FX state (explosions, dust, conquest, debris).
 * Atlas layout: 12 horizontal sprite strips stacked vertically.
 * Pre-built by generate-sprite-atlases.mjs.
 */

import type { Config } from "@openfront/engine-lib/configuration/Config";
import type { ConquestFx, DeadUnitFx, RendererConfig } from "../../../types";
import {
  STRUCTURE_TYPES,
  UT_SHELL,
  UT_TRAIN,
  UT_WARSHIP,
} from "../../../types";
import { DynamicInstanceBuffer } from "../../DynamicBuffer";
import type { RenderSettings } from "../../RenderSettings";
import { createProgram, shaderSrc } from "../../utils/GlUtils";
import { nukeExplosionRadius } from "./FxSettings";

import { assetUrl } from "@openfront/shared/AssetUrls";
import { enhancedVisualsEnabled } from "../../EnhancedVisuals";
import fxAtlasMeta from "resources/atlases/fx-atlas-meta.json";

import spriteFragSrc from "../../shaders/fx/sprite.frag.glsl?raw";
import spriteVertSrc from "../../shaders/fx/sprite.vert.glsl?raw";

const fxAtlasUrl = assetUrl("atlases/fx-atlas.png");
const cinematicNukeAtlasUrl = assetUrl("sprites/cinematic-nuke-atlas.svg");
const cinematicImpactAtlasUrl = assetUrl("sprites/cinematic-impact-atlas.svg");
/** 16 frames × 200 ms; the old 630ms atlas remains the standard-profile path. */
const CINEMATIC_NUKE_LIFETIME_MS = 3_200;
const MAX_CINEMATIC_NUKES = 10;
const MAX_CINEMATIC_DEBRIS_PER_TYPE = 12;
const MAX_CINEMATIC_FX_INSTANCES = 640;

// ---------------------------------------------------------------------------
// FX type indices (atlas row)
// ---------------------------------------------------------------------------

const FX_NUKE = 0;
const FX_SAM_EXPLOSION = 1;
const FX_BUILDING_EXPLOSION = 2;
const FX_UNIT_EXPLOSION = 3;
const FX_MINI_EXPLOSION = 4;
const FX_SINKING_SHIP = 5;
const FX_MINI_FIRE = 6;
const FX_MINI_SMOKE = 7;
const FX_MINI_BIG_SMOKE = 8;
const FX_MINI_SMOKE_FIRE = 9;
const FX_DUST = 10;
const FX_CONQUEST = 11;
const FX_TYPE_COUNT = 12;

// ---------------------------------------------------------------------------
// FX sprite config (matches AnimatedSpriteLoader)
// ---------------------------------------------------------------------------

interface FxTypeConfig {
  frameWidth: number;
  frameCount: number;
  frameDurationMs: number;
  looping: boolean;
}

const FX_CONFIG: FxTypeConfig[] = [
  /* 0 Nuke          */ {
    frameWidth: 60,
    frameCount: 9,
    frameDurationMs: 70,
    looping: false,
  },
  /* 1 SAMExplosion   */ {
    frameWidth: 48,
    frameCount: 9,
    frameDurationMs: 70,
    looping: false,
  },
  /* 2 BuildingExpl   */ {
    frameWidth: 17,
    frameCount: 10,
    frameDurationMs: 70,
    looping: false,
  },
  /* 3 UnitExplosion  */ {
    frameWidth: 19,
    frameCount: 4,
    frameDurationMs: 70,
    looping: false,
  },
  /* 4 MiniExplosion  */ {
    frameWidth: 13,
    frameCount: 4,
    frameDurationMs: 70,
    looping: false,
  },
  /* 5 SinkingShip    */ {
    frameWidth: 16,
    frameCount: 14,
    frameDurationMs: 90,
    looping: false,
  },
  /* 6 MiniFire       */ {
    frameWidth: 7,
    frameCount: 6,
    frameDurationMs: 100,
    looping: true,
  },
  /* 7 MiniSmoke      */ {
    frameWidth: 11,
    frameCount: 4,
    frameDurationMs: 120,
    looping: true,
  },
  /* 8 MiniBigSmoke   */ {
    frameWidth: 24,
    frameCount: 5,
    frameDurationMs: 120,
    looping: true,
  },
  /* 9 MiniSmokeFire  */ {
    frameWidth: 24,
    frameCount: 5,
    frameDurationMs: 120,
    looping: true,
  },
  /* 10 Dust          */ {
    frameWidth: 9,
    frameCount: 3,
    frameDurationMs: 100,
    looping: false,
  },
  /* 11 Conquest      */ {
    frameWidth: 21,
    frameCount: 10,
    frameDurationMs: 90,
    looping: false,
  },
];

// ---------------------------------------------------------------------------
// Nuke debris plan
// ---------------------------------------------------------------------------

const DEBRIS_PLAN = [
  { type: FX_MINI_FIRE, radiusFactor: 1.0, density: 1 / 25 },
  { type: FX_MINI_SMOKE, radiusFactor: 1.0, density: 1 / 28 },
  { type: FX_MINI_BIG_SMOKE, radiusFactor: 0.9, density: 1 / 70 },
  { type: FX_MINI_SMOKE_FIRE, radiusFactor: 0.9, density: 1 / 70 },
];

/** Deterministic float in [0,1) from an integer seed (mulberry32). */
function seededRandom(seed: number): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Active FX state
// ---------------------------------------------------------------------------

interface ActiveFx {
  x: number;
  y: number;
  fxType: number;
  startMs: number;
  lifetimeMs: number;
  fadeIn: number; // fraction 0–1 (start of full alpha)
  fadeOut: number; // fraction 0–1 (start of fade out)
}

// ---------------------------------------------------------------------------
// Instance data layout
// ---------------------------------------------------------------------------

const SPRITE_FLOATS = 4; // x, y, fxType, [frameIdx u8, alpha u8, pad, pad]
const SPRITE_BYTES = 16;

// ---------------------------------------------------------------------------
// FxSpritePass
// ---------------------------------------------------------------------------

export class FxSpritePass {
  private gl: WebGL2RenderingContext;
  private mapW: number;
  private settings: RenderSettings;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uFxUV: WebGLUniformLocation;
  private uFxWorld: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private spriteCount = 0;
  private atlasTex: WebGLTexture;
  private atlasReady = false;
  private readonly cinematic = enhancedVisualsEnabled();
  private cinematicNukeTex: WebGLTexture | null = null;
  private cinematicNukeReady = false;
  private uCinematicNukeReady: WebGLUniformLocation | null = null;
  private cinematicImpactTex: WebGLTexture | null = null;
  private cinematicImpactReady = false;
  private uCinematicImpactReady: WebGLUniformLocation | null = null;

  private activeFx: ActiveFx[] = [];
  private timeFn: () => number = () => performance.now();

  constructor(
    gl: WebGL2RenderingContext,
    header: RendererConfig,
    settings: RenderSettings,
    private config: Config,
  ) {
    this.gl = gl;
    this.mapW = header.mapWidth;
    this.settings = settings;

    this.program = createProgram(
      gl,
      shaderSrc(spriteVertSrc, { FX_TYPE_COUNT }),
      spriteFragSrc,
      "FxSpritePass",
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uFxUV = gl.getUniformLocation(this.program, "uFxUV")!;
    this.uFxWorld = gl.getUniformLocation(this.program, "uFxWorld")!;
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 0);
    if (this.cinematic) {
      this.uCinematicNukeReady = gl.getUniformLocation(
        this.program, "uCinematicNukeReady");
      gl.uniform1i(gl.getUniformLocation(this.program, "uCinematicNukeAtlas"), 1);
      this.cinematicNukeTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.cinematicNukeTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.uCinematicImpactReady = gl.getUniformLocation(
        this.program, "uCinematicImpactReady");
      gl.uniform1i(gl.getUniformLocation(this.program, "uCinematicImpactAtlas"), 2);
      this.cinematicImpactTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.cinematicImpactTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
    }

    // Placeholder atlas (1x1 transparent)
    this.atlasTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Instance buffer
    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(gl, glBuf, 256, SPRITE_FLOATS);

    // VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, SPRITE_BYTES, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.UNSIGNED_BYTE, false, SPRITE_BYTES, 12);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);

    void this.loadAtlas();
    if (this.cinematic) {
      void this.loadCinematicNukeAtlas();
      void this.loadCinematicImpactAtlas();
    }
  }

  // -------------------------------------------------------------------------
  // Atlas loading
  // -------------------------------------------------------------------------

  private isDisposed = false;

  private async loadAtlas(): Promise<void> {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = fxAtlasUrl;
      await img.decode();
      if (this.isDisposed) return;
      const gl = this.gl;

      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      const meta = fxAtlasMeta;
      const uvData = new Float32Array(FX_TYPE_COUNT * 4);
      const worldData = new Float32Array(FX_TYPE_COUNT * 4);

      for (let i = 0; i < FX_TYPE_COUNT; i++) {
        const row = meta.rows[i];
        uvData[i * 4 + 0] = row.yOffset / meta.height;
        uvData[i * 4 + 1] = row.height / meta.height;
        uvData[i * 4 + 2] = row.worldWidth / meta.width;
        uvData[i * 4 + 3] = 0;
        worldData[i * 4 + 0] = row.worldWidth;
        worldData[i * 4 + 1] = row.worldHeight;
        worldData[i * 4 + 2] = 0;
        worldData[i * 4 + 3] = 0;
      }

      gl.useProgram(this.program);
      gl.uniform4fv(this.uFxUV, uvData);
      gl.uniform4fv(this.uFxWorld, worldData);

      this.atlasReady = true;
    } catch (e) {
      console.warn("Failed to load fx atlas:", e);
    }
  }

  /** Single optional 1024² RGBA atlas (~4 MiB GPU memory). It is decoded
   * once per cinematic renderer, not once per detonation. If SVG decode fails,
   * the old blast sprite remains usable. */
  private async loadCinematicNukeAtlas(): Promise<void> {
    if (!this.cinematicNukeTex) return;
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = cinematicNukeAtlasUrl;
      await img.decode();
      if (this.isDisposed || !this.cinematicNukeTex) return;
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.cinematicNukeTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
        gl.UNSIGNED_BYTE, img);
      gl.activeTexture(gl.TEXTURE0);
      this.cinematicNukeReady = true;
    } catch (error) {
      console.warn("Cinematic nuke atlas unavailable; using default FX", error);
    }
  }

  /** Single shared explosion atlas, independent of the 16-frame nuke.
   * It handles shell, unit and building impacts while preserving the exact
   * old SAM interceptor and special cosmetic sprites. */
  private async loadCinematicImpactAtlas(): Promise<void> {
    if (!this.cinematicImpactTex) return;
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = cinematicImpactAtlasUrl;
      await img.decode();
      if (this.isDisposed || !this.cinematicImpactTex) return;
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.cinematicImpactTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
        gl.UNSIGNED_BYTE, img);
      gl.activeTexture(gl.TEXTURE0);
      this.cinematicImpactReady = true;
    } catch (error) {
      console.warn("Cinematic impact atlas unavailable; using default FX", error);
    }
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  applyRailroadDust(tileRefs: number[]): void {
    const now = this.timeFn();
    for (const ref of tileRefs) {
      if (Math.random() > 0.33) continue;
      const x = ref % this.mapW;
      const y = (ref - x) / this.mapW;
      this.pushFx(x, y, FX_DUST, now);
    }
  }

  applyConquestEvents(events: ConquestFx[]): void {
    const now = this.timeFn();
    const fx = this.settings.fx;
    for (const evt of events) {
      const startMs = now - (evt.tickAge ?? 0) * this.config.msPerTick();
      if (now - startMs >= fx.conquestLifetimeMs) continue;
      this.activeFx.push({
        x: evt.x,
        y: evt.y,
        fxType: FX_CONQUEST,
        startMs,
        lifetimeMs: fx.conquestLifetimeMs,
        fadeIn: fx.conquestFadeIn,
        fadeOut: fx.conquestFadeOut,
      });
    }
  }

  /**
   * Spawn sprite FX for a dead unit. Returns the nuke radius if a nuke
   * exploded (so the orchestrator can also spawn a shockwave), or null.
   */
  spawnFxForUnit(unit: DeadUnitFx, now: number): void {
    const typeName = unit.unitType;
    const x = unit.pos % this.mapW;
    const y = (unit.pos - x) / this.mapW;

    const nukeRadius = nukeExplosionRadius(this.settings.fx, typeName);
    if (nukeRadius !== undefined) {
      if (unit.reachedTarget) {
        this.spawnNukeSprites(x, y, nukeRadius, now, unit.pos);
      } else {
        this.pushFx(x, y, FX_SAM_EXPLOSION, now);
      }
      return;
    }

    if (typeName === UT_WARSHIP) {
      this.pushFx(x, y, FX_UNIT_EXPLOSION, now);
      this.pushFx(x, y, FX_SINKING_SHIP, now);
      return;
    }

    if (typeName === UT_SHELL && unit.reachedTarget) {
      this.pushFx(x, y, FX_MINI_EXPLOSION, now);
      return;
    }

    if (typeName === UT_TRAIN && !unit.reachedTarget) {
      this.pushFx(x, y, FX_MINI_EXPLOSION, now);
      return;
    }

    if (STRUCTURE_TYPES.has(typeName)) {
      this.pushFx(x, y, FX_BUILDING_EXPLOSION, now);
    }
  }

  private spawnNukeSprites(
    x: number,
    y: number,
    radius: number,
    now: number,
    pos: number,
  ): void {
    this.pushFx(x, y, FX_NUKE, now);

    let debrisIdx = 0;
    const densityScale = this.settings.fx.debrisDensity;
    for (const { type, radiusFactor, density } of DEBRIS_PLAN) {
      const proposed = Math.max(0, Math.floor(radius * density * densityScale));
      const count = this.cinematic
        ? Math.min(MAX_CINEMATIC_DEBRIS_PER_TYPE, proposed) : proposed;
      const r = radius * radiusFactor;
      for (let i = 0; i < count; i++) {
        const seed = pos * 997 + debrisIdx++;
        const angle = seededRandom(seed) * Math.PI * 2;
        const dist = seededRandom(seed + 0x10000) * (r / 2);
        const dx = Math.floor(Math.cos(angle) * dist);
        const dy = Math.floor(Math.sin(angle) * dist);
        this.pushDebris(x + dx, y + dy, type, now);
      }
    }
  }

  pushFx(x: number, y: number, fxType: number, now: number): void {
    const cfg = FX_CONFIG[fxType];
    const newImpact = this.cinematic && this.cinematicImpactReady &&
      (fxType === FX_BUILDING_EXPLOSION ||
        fxType === FX_UNIT_EXPLOSION || fxType === FX_MINI_EXPLOSION);
    // Many MIRVs can detonate in the same frame. Preserve the newest visible
    // plumes, but never keep hundreds of 3.2-second clouds on the GPU.
    if (this.cinematic && fxType === FX_NUKE) {
      let active = 0, oldestIndex = -1, oldestMs = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.activeFx.length; i++) {
        const fx = this.activeFx[i];
        if (fx.fxType !== FX_NUKE) continue;
        active++;
        if (fx.startMs < oldestMs) {
          oldestMs = fx.startMs;
          oldestIndex = i;
        }
      }
      if (active >= MAX_CINEMATIC_NUKES && oldestIndex >= 0)
        this.activeFx.splice(oldestIndex, 1);
    }
    this.activeFx.push({
      x,
      y,
      fxType,
      startMs: now,
      lifetimeMs: this.cinematic && fxType === FX_NUKE
        ? this.cinematicNukeReady ? CINEMATIC_NUKE_LIFETIME_MS
          : cfg.frameDurationMs * cfg.frameCount
        : newImpact ? fxType === FX_BUILDING_EXPLOSION ? 1_200
          : fxType === FX_UNIT_EXPLOSION ? 900 : 700
        : cfg.frameDurationMs * cfg.frameCount,
      fadeIn: 0,
      fadeOut: 1,
    });
  }

  private pushDebris(x: number, y: number, fxType: number, now: number): void {
    const fx = this.settings.fx;
    this.activeFx.push({
      x,
      y,
      fxType,
      startMs: now,
      lifetimeMs: fx.debrisLifetimeMs,
      fadeIn: fx.debrisFadeIn,
      fadeOut: fx.debrisFadeOut,
    });
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  tick(): void {
    if (this.activeFx.length === 0) return;
    const now = this.timeFn();
    if (this.cinematic &&
      this.activeFx.length > MAX_CINEMATIC_FX_INSTANCES) {
      // Cosmetic smoke and embers yield to actual weapon impacts on a MIRV
      // barrage; cap the single instanced draw even in gigantic battles.
      const essential = (fx: ActiveFx) => fx.fxType <= FX_MINI_EXPLOSION;
      const priority = this.activeFx
        .filter(essential).sort((a, b) => b.startMs - a.startMs);
      const incidental = this.activeFx
        .filter((fx) => !essential(fx))
        .sort((a, b) => b.startMs - a.startMs);
      const safeEssential = priority.slice(0, MAX_CINEMATIC_FX_INSTANCES);
      this.activeFx = safeEssential.concat(incidental.slice(
        0, MAX_CINEMATIC_FX_INSTANCES-safeEssential.length));
    }

    for (let i = this.activeFx.length - 1; i >= 0; i--) {
      if (now - this.activeFx[i].startMs >= this.activeFx[i].lifetimeMs) {
        this.activeFx[i] = this.activeFx[this.activeFx.length - 1];
        this.activeFx.pop();
      }
    }

    this.rebuildInstances(now);
  }

  private rebuildInstances(now: number): void {
    const count = this.activeFx.length;
    this.instanceBuf.ensureCapacity(count);

    for (let i = 0; i < count; i++) {
      const fx = this.activeFx[i];
      const cfg = FX_CONFIG[fx.fxType];
      const elapsed = now - fx.startMs;

      let frameIdx: number;
      const newImpact = this.cinematic && this.cinematicImpactReady &&
        (fx.fxType === FX_BUILDING_EXPLOSION ||
          fx.fxType === FX_UNIT_EXPLOSION || fx.fxType === FX_MINI_EXPLOSION);
      if ((this.cinematic && fx.fxType === FX_NUKE &&
          this.cinematicNukeReady) || newImpact) {
        // Encode 0..15 in the existing uint8 frame byte; no new instance
        // attributes and no new draw calls are required.
        frameIdx = Math.min(15, Math.floor(
          16 * Math.max(0, elapsed) / fx.lifetimeMs));
      } else if (cfg.looping) {
        const cycle = cfg.frameDurationMs * cfg.frameCount;
        frameIdx = Math.floor((elapsed % cycle) / cfg.frameDurationMs);
      } else {
        frameIdx = Math.min(
          Math.floor(elapsed / cfg.frameDurationMs),
          cfg.frameCount - 1,
        );
      }

      let alpha = 255;
      if (fx.fadeIn > 0 || fx.fadeOut < 1) {
        const t = elapsed / fx.lifetimeMs;
        if (t < fx.fadeIn) {
          alpha = Math.floor((t / fx.fadeIn) * 255);
        } else if (t > fx.fadeOut) {
          alpha = Math.floor(((1 - t) / (1 - fx.fadeOut)) * 255);
        }
      }

      const off = i * SPRITE_FLOATS;
      this.instanceBuf.float32[off + 0] = fx.x;
      this.instanceBuf.float32[off + 1] = fx.y;
      this.instanceBuf.float32[off + 2] = fx.fxType;
      const byteOff = i * SPRITE_BYTES;
      this.instanceBuf.uint8[byteOff + 12] = frameIdx;
      this.instanceBuf.uint8[byteOff + 13] = alpha;
    }

    this.spriteCount = count;
  }

  // -------------------------------------------------------------------------
  // Draw
  // -------------------------------------------------------------------------

  draw(cameraMatrix: Float32Array): void {
    if (this.spriteCount === 0 || !this.atlasReady) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    if (this.cinematicNukeTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.cinematicNukeTex);
      gl.activeTexture(gl.TEXTURE0);
      if (this.uCinematicNukeReady)
        gl.uniform1f(this.uCinematicNukeReady,
          this.cinematicNukeReady ? 1 : 0);
    }
    if (this.cinematicImpactTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.cinematicImpactTex);
      gl.activeTexture(gl.TEXTURE0);
      if (this.uCinematicImpactReady)
        gl.uniform1f(this.uCinematicImpactReady,
          this.cinematicImpactReady ? 1 : 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceBuf.float32,
      0,
      this.spriteCount * SPRITE_FLOATS,
    );
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.spriteCount);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  setTimeFn(fn: () => number): void {
    this.timeFn = fn;
  }

  clear(): void {
    this.activeFx.length = 0;
    this.spriteCount = 0;
  }

  dispose(): void {
    this.isDisposed = true;
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.atlasTex);
    if (this.cinematicNukeTex) gl.deleteTexture(this.cinematicNukeTex);
    if (this.cinematicImpactTex) gl.deleteTexture(this.cinematicImpactTex);
    this.cinematicNukeTex = null;
    this.cinematicNukeReady = false;
    this.cinematicImpactTex = null;
    this.cinematicImpactReady = false;
  }
}
