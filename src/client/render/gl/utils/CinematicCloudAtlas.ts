import { createProgram } from "./GlUtils";
import cloudBakeSource from "../shaders/fx/cloud-bake.frag.glsl?raw";

/** Copy the accepted ground artwork, remove ONLY the old airborne ellipses.
 * The original asset is trusted repository content and is never inserted in DOM.
 */
export function nuclearGroundAtlas(source: string): string {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid nuclear atlas SVG");
  const root = doc.documentElement;
  const frames = Array.from(root.children).filter((node) => node.localName === "svg");
  if (frames.length !== 16 || root.getAttribute("width") !== "1024" || root.getAttribute("height") !== "1024") {
    throw new Error("Unsupported nuclear atlas layout");
  }
  for (const frame of frames) {
    for (const node of Array.from(frame.children)) {
      const keep = node.getAttribute("fill") === "url(#ground)" ||
        (node.localName === "ellipse" && node.hasAttribute("stroke")) ||
        (node.localName === "circle" && ["url(#fire)", "url(#heat)"].includes(node.getAttribute("fill") ?? ""));
      if (!keep) node.remove();
    }
  }
  return new XMLSerializer().serializeToString(root);
}

const BAKE_VERTEX = `#version 300 es
void main() {
  vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
  gl_Position=vec4(p*2.0-1.0,0,1);
}`;

/** Bake a connected, lit density volume ONCE into the existing 4 MiB atlas.
 * No volumetric shader, extra texture, FBO or particle emitter survives this call.
 * target must contain premultiplied ground-only RGBA at 1024 x 1024.
 * Every touched GL state is restored, including exceptional paths.
 */
export function bakeCinematicCloudAtlas(gl: WebGL2RenderingContext, target: WebGLTexture): void {
  const oldFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  const oldProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const oldVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  const mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
  const caps = [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.STENCIL_TEST, gl.RASTERIZER_DISCARD];
  const enabled = caps.map((cap) => gl.isEnabled(cap));
  const blend = [gl.BLEND_SRC_RGB, gl.BLEND_DST_RGB, gl.BLEND_SRC_ALPHA, gl.BLEND_DST_ALPHA, gl.BLEND_EQUATION_RGB, gl.BLEND_EQUATION_ALPHA].map((p) => gl.getParameter(p) as number);
  let program: WebGLProgram | null = null;
  let fbo: WebGLFramebuffer | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  try {
    program = createProgram(gl, BAKE_VERTEX, cloudBakeSource, "CinematicCloudAtlas.bake");
    fbo = gl.createFramebuffer();
    vao = gl.createVertexArray();
    if (!fbo || !vao) throw new Error("Cloud atlas allocation failed");
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Incomplete cloud atlas framebuffer");
    for (const cap of caps) gl.disable(cap);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, true);
    gl.viewport(0, 0, 1024, 1024);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } finally {
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, oldFramebuffer);
    gl.useProgram(oldProgram);
    gl.bindVertexArray(oldVAO);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    gl.colorMask(mask[0], mask[1], mask[2], mask[3]);
    gl.blendFuncSeparate(blend[0], blend[1], blend[2], blend[3]);
    gl.blendEquationSeparate(blend[4], blend[5]);
    caps.forEach((cap, i) => enabled[i] ? gl.enable(cap) : gl.disable(cap));
    if (vao) gl.deleteVertexArray(vao);
    if (fbo) gl.deleteFramebuffer(fbo);
    if (program) gl.deleteProgram(program);
  }
}
