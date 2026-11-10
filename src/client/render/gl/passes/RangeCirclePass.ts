/**
 * RangeCirclePass — draws the existing ghost radius and the currently
 * inspected castle or Iron Dome defensive area. White by default,
 * red when the ghost flags a warning (e.g. nuking would break an alliance).
 *
 * Single quad with circle SDF in the fragment shader.
 * Active only when a ghost preview with rangeRadius > 0 is set.
 */

import type { GhostPreviewData } from "../../types";

/** World-tile coordinates, matching the existing build-preview radius pass. */
export interface SelectedDefenseRange {
  x: number;
  y: number;
  radius: number;
  hostile: boolean;
  fortified: boolean;
}
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/range-circle/range-circle.frag.glsl?raw";
import vertSrc from "../shaders/range-circle/range-circle.vert.glsl?raw";

export class RangeCirclePass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quadBuffer: WebGLBuffer;

  private uCamera: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uRadius: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uSelected: WebGLUniformLocation;

  private centerX = 0;
  private centerY = 0;
  private radius = 0;
  private warning = false;
  private inspected: SelectedDefenseRange | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc, "RangeCirclePass");

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uCenter = gl.getUniformLocation(this.program, "uCenter")!;
    this.uRadius = gl.getUniformLocation(this.program, "uRadius")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    this.uSelected = gl.getUniformLocation(this.program, "uSelected")!;

    // Unit quad [0,1]
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  updateGhostPreview(data: GhostPreviewData | null): void {
    if (data && data.rangeRadius > 0) {
      this.centerX = data.radiusTileX;
      this.centerY = data.radiusTileY;
      this.radius = data.rangeRadius;
      this.warning = data.rangeWarning;
    } else {
      this.radius = 0;
      this.warning = false;
    }
  }

  updateSelectedDefenseRange(range: SelectedDefenseRange | null): void {
    this.inspected = range;
  }

  draw(cameraMatrix: Float32Array): void {
    // A construction ghost takes precedence, so the map never gets two
    // overlapping selectable circles while the player is placing a building.
    const selected = this.radius > 0 ? null : this.inspected;
    if (this.radius <= 0 && (!selected || selected.radius <= 0)) return;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.bindVertexArray(this.vao);

    if (selected) {
      gl.uniform2f(this.uCenter, selected.x, selected.y);
      gl.uniform1f(this.uRadius, selected.radius);
      gl.uniform1f(this.uSelected, 1.0);
      if (selected.hostile) {
        if (selected.fortified) gl.uniform3f(this.uColor, 1.0, 0.30, 0.25);
        else gl.uniform3f(this.uColor, 1.0, 0.63, 0.28);
      } else {
        if (selected.fortified) gl.uniform3f(this.uColor, 0.26, 0.96, 0.59);
        else gl.uniform3f(this.uColor, 0.26, 0.81, 0.98);
      }
    } else {
      gl.uniform2f(this.uCenter, this.centerX, this.centerY);
      gl.uniform1f(this.uRadius, this.radius);
      gl.uniform1f(this.uSelected, 0.0);
      if (this.warning) gl.uniform3f(this.uColor, 1.0, 0.2, 0.2);
      else gl.uniform3f(this.uColor, 1.0, 1.0, 1.0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quadBuffer);
  }
}
