/**
 * IronDomePass — cheap, animated magnetic containment rings.
 *
 * Structures are indexed only when they change. At render time a world-space
 * circle is conservatively culled against the camera ellipse, and only visible
 * domes are uploaded/drawn. A stable visible set costs zero new GPU uploads.
 * There are no textures, new particles, transparent full-screen quads, or
 * quality governors: a single thin instanced mesh per visible dome.
 */
import type { UnitState } from "../../types";
import { UT_IRON_DOME } from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import { samRange } from "../utils/NukeTrajectory";
import { createProgram } from "../utils/GlUtils";
import vertSrc from "../shaders/iron-dome/iron-dome.vert.glsl?raw";
import fragSrc from "../shaders/iron-dome/iron-dome.frag.glsl?raw";

const SEGMENTS = 128;
const VERTICES = SEGMENTS * 6 * 2;
const FIELDS = 4;

/**
 * Camera is a column-major 3x3 world-to-clip affine transform. A world-space
 * circle projects to an ellipse whose extents are the lengths of the first
 * two transform rows times its radius. This works even if the camera rotates.
 */
export function isDomeVisible(
  camera: Float32Array,
  x: number,
  y: number,
  radius: number,
  viewportW: number,
  viewportH: number,
): boolean {
  const clipX = camera[0] * x + camera[3] * y + camera[6];
  const clipY = camera[1] * x + camera[4] * y + camera[7];
  const rx = radius * Math.hypot(camera[0], camera[3]);
  const ry = radius * Math.hypot(camera[1], camera[4]);
  if (clipX + rx < -1 || clipX - rx > 1 ||
      clipY + ry < -1 || clipY - ry > 1) return false;
  // Subpixel rings flicker but add no useful visual information at far zoom.
  return Math.max(rx * viewportW, ry * viewportH) >= 2.5;
}

export class IronDomePass {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly instanceBuf: DynamicInstanceBuffer;
  private readonly uCamera: WebGLUniformLocation;
  private readonly uTime: WebGLUniformLocation;
  private readonly uLocalPlayerID: WebGLUniformLocation;
  private readonly start = performance.now();
  /** Flat x,y,ownerID,radius array, rebuilt only when structures change. */
  private readonly domes: number[] = [];
  /** Reused arrays avoid per-frame allocations. */
  private readonly visibleKeys: number[] = [];
  private readonly nextVisibleKeys: number[] = [];
  private sourceDirty = true;
  private count = 0;
  private localPlayerID = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly mapW: number,
  ) {
    this.program = createProgram(gl, vertSrc, fragSrc, "IronDomePass");
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uLocalPlayerID = gl.getUniformLocation(this.program, "uLocalPlayerID")!;
    this.vao = gl.createVertexArray()!;
    this.instanceBuf = new DynamicInstanceBuffer(gl, gl.createBuffer()!, 16, FIELDS);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, FIELDS, gl.FLOAT, false, FIELDS * 4, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
  }

  setLocalPlayer(id: number): void { this.localPlayerID = id; }

  updateStructures(units: Map<number, UnitState>): void {
    this.domes.length = 0;
    for (const u of units.values()) {
      if (u.unitType !== UT_IRON_DOME || !u.isActive || u.underConstruction)
        continue;
      const x = u.pos % this.mapW;
      const y = (u.pos - x) / this.mapW;
      this.domes.push(
        x + 0.5,
        y + 0.5,
        u.ownerID,
        Math.round(samRange(Math.max(1, u.level)) * 1.2),
      );
    }
    this.sourceDirty = true;
  }

  /**
   * Upload only when the visible dome indices (or their underlying data)
   * change. Off-camera shields never submit vertices or fragment work.
   */
  private syncVisible(camera: Float32Array): void {
    const keys = this.nextVisibleKeys;
    keys.length = 0;
    const width = this.gl.drawingBufferWidth;
    const height = this.gl.drawingBufferHeight;
    for (let i = 0; i < this.domes.length; i += FIELDS) {
      if (isDomeVisible(
        camera, this.domes[i], this.domes[i + 1],
        this.domes[i + 3], width, height,
      )) keys.push(i);
    }

    let changed = this.sourceDirty || keys.length !== this.visibleKeys.length;
    if (!changed) {
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] !== this.visibleKeys[i]) {
          changed = true;
          break;
        }
      }
    }
    this.count = keys.length;
    if (!changed) return;

    this.instanceBuf.ensureCapacity(keys.length);
    const data = this.instanceBuf.float32;
    for (let i = 0; i < keys.length; i++) {
      const off = keys[i];
      const dst = i * FIELDS;
      data[dst] = this.domes[off];
      data[dst + 1] = this.domes[off + 1];
      data[dst + 2] = this.domes[off + 2];
      data[dst + 3] = this.domes[off + 3];
    }
    if (keys.length > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, keys.length * FIELDS);
    }
    this.visibleKeys.length = 0;
    for (const key of keys) this.visibleKeys.push(key);
    this.sourceDirty = false;
  }

  draw(camera: Float32Array): void {
    if (this.domes.length === 0) return;
    this.syncVisible(camera);
    if (this.count === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, camera);
    gl.uniform1f(this.uTime, (performance.now() - this.start) / 1000);
    gl.uniform1f(this.uLocalPlayerID, this.localPlayerID);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, VERTICES, this.count);
  }

  dispose(): void {
    this.instanceBuf.dispose();
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
