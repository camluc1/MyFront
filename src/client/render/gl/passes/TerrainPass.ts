/**
 * TerrainPass — renders the terrain and static overview surround in one quad.
 *
 * Initial upload happens once; incremental updates flow through
 * applyTerrainRects() so water-nuke conversions (land → water) are reflected
 * live. Vertex shader transforms the map quad by the camera mat3; fragment
 * shader samples the RGBA8 terrain texture with nearest-neighbour filtering
 * so each terrain cell stays pixel-crisp at every zoom level.
 */

import type { TerrainRect } from "../../types";
import defaults from "../render-settings.json";
import type { RenderSettings } from "../RenderSettings";
import {
  enhancedVisualsEnabled,
  ENHANCED_SHADER_MARKER,
  prefersReducedVisualMotion,
  WaterQualityGovernor,
} from "../EnhancedVisuals";
import terrainFragSrc from "../shaders/terrain/terrain.frag.glsl?raw";
import terrainVertSrc from "../shaders/terrain/terrain.vert.glsl?raw";
import {
  buildTerrainRGBA,
  encodeTerrainTile,
  TerrainColorOverrides,
} from "../utils/ColorUtils";
import { buildOceanDetailTexture, OCEAN_DETAIL_SIZE } from "../utils/OceanDetailTexture";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

// ---------------------------------------------------------------------------
// TerrainPass
// ---------------------------------------------------------------------------

export class TerrainPass {
  private program: WebGLProgram;
  private tex: WebGLTexture;
  private oceanDetailTex: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;
  private uSurface: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private startTime = performance.now();
  private uBackground: WebGLUniformLocation;
  private uWaterQuality: WebGLUniformLocation | null;
  private cinematic = enhancedVisualsEnabled();
  private readonly reducedMotion = prefersReducedVisualMotion();
  private readonly waterQuality = new WaterQualityGovernor();
  private mapW: number;
  private mapH: number;
  // Base ocean (deep water) color; reused by applyTerrainRects and rebuilds.
  private terrainColors: TerrainColorOverrides | undefined;
  // Scratch RGBA buffer for rect sub-uploads; grown as needed and reused
  // across applyTerrainRects calls.
  private rgbaScratch = new Uint8Array(0);

  constructor(
    private gl: WebGL2RenderingContext,
    // Regenerates current per-tile terrain bytes (reflecting water-nuke
    // conversions) for the rare full re-bake in setTerrainColors. A provider
    // instead of a retained buffer: terrain bytes are map-sized (8 MB on the
    // giant map).
    private terrainSource: () => Uint8Array,
    terrainBytes: Uint8Array,
    mapW: number,
    mapH: number,
    terrainColors?: TerrainColorOverrides,
    private surface: RenderSettings["terrain"] = defaults.terrain,
  ) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.terrainColors = terrainColors;
    const vertex = shaderSrc(terrainVertSrc, { MAP_W: mapW, MAP_H: mapH });
    try {
      this.program = createProgram(gl, vertex, terrainFragSrc, "TerrainPass");
    } catch (error) {
      if (!this.cinematic || gl.isContextLost()) throw error;
      // The ocean is optional. A problematic GPU/driver must still be able
      // to render the normal game terrain instead of losing the entire map.
      console.warn("Cinematic ocean shader unavailable; using classic sea", error);
      this.cinematic = false;
      this.program = createProgram(gl, vertex,
        terrainFragSrc.replace(ENHANCED_SHADER_MARKER, ""),
        "TerrainPass fallback");
    }
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uSurface = gl.getUniformLocation(this.program, "uSurface")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uBackground = gl.getUniformLocation(this.program, "uBackground")!;
    this.uWaterQuality = gl.getUniformLocation(this.program, "uWaterQuality");

    this.tex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: this.bakeTerrain(terrainBytes),
      filter: gl.NEAREST, // pixel-crisp at all zoom levels
    });

    if (this.cinematic) {
      // A tiny shared periodic normal/foam map, generated once in JS and
      // uploaded once. No reflection render target or map-size allocation.
      this.oceanDetailTex = gl.createTexture();
      if (this.oceanDetailTex) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.oceanDetailTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8,
          OCEAN_DETAIL_SIZE, OCEAN_DETAIL_SIZE, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, buildOceanDetailTexture());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
          gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.activeTexture(gl.TEXTURE0);
        gl.useProgram(this.program);
        gl.uniform1i(gl.getUniformLocation(this.program, "uOceanDetail"), 1);
      }
    }

    // Fullscreen quad also paints the overview margins in the same draw call.
    this.vao = createMapQuad(gl, 2, 2);
  }

  // Reuse the otherwise opaque alpha byte for terrain classification. The
  // terrain pass writes alpha=1; no new map-sized texture is required.
  private bakeTerrain(bytes: Uint8Array): Uint8Array {
    const rgba = buildTerrainRGBA(
      bytes,
      this.mapW,
      this.mapH,
      this.terrainColors,
    );
    for (let i = 0; i < bytes.length; i++) rgba[i * 4 + 3] = bytes[i];
    return rgba;
  }

  /**
   * Replace the base terrain colors and re-upload the whole terrain texture.
   * Called when the user changes the terrain colors in graphics settings.
   */
  setTerrainColors(terrainColors?: TerrainColorOverrides): void {
    this.terrainColors = terrainColors;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.bakeTerrain(this.terrainSource()),
    );
  }

  /**
   * Update terrain regions in-place (e.g. land→water from a water nuke).
   * Each rect's terrain bytes are stored row-major, concatenated in `bytes`
   * in rect order. One texSubImage2D per rect — a massive bomb changes tens
   * of thousands of tiles, so per-tile 1×1 uploads are too slow. A later full
   * re-upload (setTerrainColors) regenerates from terrainSource, whose
   * backing game map already reflects these conversions.
   */
  applyTerrainRects(rects: readonly TerrainRect[], bytes: Uint8Array): void {
    if (rects.length === 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    let offset = 0;
    for (const r of rects) {
      const count = r.w * r.h;
      if (this.rgbaScratch.length < count * 4) {
        this.rgbaScratch = new Uint8Array(count * 4);
      }
      for (let i = 0; i < count; i++) {
        encodeTerrainTile(
          bytes[offset + i],
          this.rgbaScratch,
          i * 4,
          this.terrainColors,
        );
        this.rgbaScratch[i * 4 + 3] = bytes[offset + i];
      }
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        r.x,
        r.y,
        r.w,
        r.h,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.rgbaScratch,
        0,
      );
      offset += count;
    }
  }

  /** Render the terrain. Call with depth test disabled, no blending. */
  draw(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform4f(
      this.uSurface,
      this.surface.waterMotionStrength,
      this.surface.waterHighlightStrength,
      this.surface.reliefStrength,
      this.surface.surfaceTextureStrength,
    );
    const now = performance.now();
    gl.uniform1f(this.uTime,
      this.cinematic && this.reducedMotion ? 0 : (now - this.startTime) / 1000);
    if (this.cinematic && this.uWaterQuality !== null) {
      gl.uniform1f(this.uWaterQuality, this.waterQuality.sample(
        now, gl.drawingBufferWidth * gl.drawingBufferHeight,
      ));
    }
    const background = this.terrainColors?.backgroundColor ?? [11, 22, 36];
    gl.uniform3f(
      this.uBackground,
      background[0] / 255,
      background[1] / 255,
      background[2] / 255,
    );

    if (this.oceanDetailTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.oceanDetailTex);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.tex);
    if (this.oceanDetailTex) gl.deleteTexture(this.oceanDetailTex);
    // VAO + buffer leak is acceptable on dispose (context is being destroyed)
  }
}
