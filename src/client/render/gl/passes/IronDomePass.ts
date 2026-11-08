/**
 * IronDomePass: permanent low-overdraw magnetic containment contours.
 *
 * Two instanced thin ring meshes, not a full-screen transparent quad:
 * 128 segments x 2 arcs, one GPU draw regardless of shield count.
 * A passive structure with no gameplay ticking, particles or textures.
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
export class IronDomePass {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly instanceBuf: DynamicInstanceBuffer;
  private readonly uCamera: WebGLUniformLocation;
  private readonly uTime: WebGLUniformLocation;
  private readonly uLocalPlayerID: WebGLUniformLocation;
  private readonly start = performance.now();
  private count = 0;
  private localPlayerID = 0;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly mapW: number) {
    this.program = createProgram(gl, vertSrc, fragSrc, "IronDomePass");
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uLocalPlayerID = gl.getUniformLocation(this.program, "uLocalPlayerID")!;
    this.vao = gl.createVertexArray()!;
    this.instanceBuf = new DynamicInstanceBuffer(gl, gl.createBuffer()!, 16, FIELDS);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
  }

  setLocalPlayer(id: number): void { this.localPlayerID = id; }

  updateStructures(units: Map<number, UnitState>): void {
    let count = 0;
    const data = this.instanceBuf;
    for (const u of units.values()) {
      if (u.unitType !== UT_IRON_DOME || !u.isActive || u.underConstruction)
        continue;
      data.ensureCapacity(count + 1);
      const x = u.pos % this.mapW;
      const y = (u.pos - x) / this.mapW;
      const off = count * FIELDS;
      data.float32[off] = x + 0.5;
      data.float32[off + 1] = y + 0.5;
      data.float32[off + 2] = u.ownerID;
      data.float32[off + 3] = Math.round(samRange(Math.max(1, u.level)) * 1.2);
      count++;
    }
    this.count = count;
    if (count > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, data.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.float32, 0, count * FIELDS);
    }
  }

  draw(camera: Float32Array): void {
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
