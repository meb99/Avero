import { markerSize, partCenter, type BoardModel } from "../core/board";
import type { Camera } from "../core/camera";
import type { Point } from "../core/types";
import type { Palette } from "./palette";
import type { BoardStyle } from "./style";

/**
 * WebGL2 board renderer.
 *
 * Geometry is uploaded once per board; selection and side changes only
 * re-upload the per-element color buffers. Pins and test points are
 * instanced quads shaded as circles, squares or diamonds; outlines are
 * instanced screen-space line quads, so line width is independent of zoom;
 * copper tracks use the same quads with their width in board units.
 */

const LINE_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_seg;
layout(location=2) in vec4 a_color;
layout(location=3) in float a_width;
uniform mat3 u_world;
uniform vec2 u_viewport;
uniform float u_dpr;
uniform float u_scale;
out vec4 v_color;
void main() {
  vec2 p0 = (u_world * vec3(a_seg.xy, 1.0)).xy;
  vec2 p1 = (u_world * vec3(a_seg.zw, 1.0)).xy;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  // Negative widths are board units (tracks), positive ones CSS pixels.
  float hw = (a_width < 0.0 ? max(-a_width * u_scale, u_dpr) : a_width * u_dpr) * 0.5;
  vec2 p = mix(p0, p1, a_corner.x) + dir * (a_corner.x * 2.0 - 1.0) * hw + n * a_corner.y * hw;
  vec2 clip = p / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`;

const COLOR_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o;
void main() {
  if (v_color.a <= 0.0) discard;
  o = v_color;
}`;

const PAD_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_pad;
layout(location=2) in vec4 a_color;
uniform mat3 u_world;
uniform vec2 u_viewport;
uniform float u_scale;
uniform float u_minRadius;
uniform float u_dpr;
out vec2 v_local;
out vec4 v_color;
flat out float v_shape;
out float v_radius;
void main() {
  vec2 c = (u_world * vec3(a_pad.xy, 1.0)).xy;
  // Negative radii are CSS pixels (markers), positive ones board units.
  float r = a_pad.z < 0.0 ? -a_pad.z * u_dpr : max(a_pad.z * u_scale, u_minRadius);
  float extent = r + 1.5;
  v_local = a_corner * extent;
  v_radius = r;
  v_shape = a_pad.w;
  v_color = a_color;
  vec2 clip = (c + v_local) / u_viewport * 2.0 - 1.0;
  gl_Position = a_color.a > 0.0 ? vec4(clip.x, -clip.y, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const PAD_FS = `#version 300 es
precision mediump float;
in vec2 v_local;
in vec4 v_color;
flat in float v_shape;
in float v_radius;
out vec4 o;
void main() {
  float r = v_radius;
  float d;
  if (v_shape < 0.5) {
    d = length(v_local) - r;
  } else if (v_shape < 1.5) {
    vec2 q = abs(v_local) - vec2(r * 0.86);
    d = max(q.x, q.y);
  } else {
    d = (abs(v_local.x) + abs(v_local.y)) * 0.7071 - r * 0.78;
  }
  float coverage = clamp(0.5 - d, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  float rim = r > 5.0 ? smoothstep(-1.6, -0.4, d) : 0.0;
  vec3 rgb = mix(v_color.rgb, v_color.rgb * 0.45, rim);
  o = vec4(rgb, v_color.a * coverage);
}`;

const FILL_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_color;
uniform mat3 u_world;
uniform vec2 u_viewport;
out vec4 v_color;
void main() {
  vec2 p = (u_world * vec3(a_pos, 1.0)).xy;
  vec2 clip = p / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`;

const IMAGE_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
uniform mat3 u_world;
uniform vec2 u_viewport;
out vec2 v_uv;
void main() {
  vec2 p = (u_world * vec3(a_pos, 1.0)).xy;
  vec2 clip = p / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
}`;

const IMAGE_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv);
  o = vec4(c.rgb, c.a * u_opacity);
}`;

export const SHAPE_CIRCLE = 0;
export const SHAPE_SQUARE = 1;
export const SHAPE_DIAMOND = 2;

interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface InstanceSet {
  vao: WebGLVertexArrayObject;
  colors: WebGLBuffer;
  widths?: WebGLBuffer;
  count: number;
}

interface FillSet {
  vao: WebGLVertexArrayObject;
  colors: WebGLBuffer;
  count: number;
}

export class BoardRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly lineProgram: Program;
  private readonly padProgram: Program;
  private readonly fillProgram: Program;
  private readonly imageProgram: Program;
  private readonly quad: WebGLBuffer;
  private readonly lineCorners: WebGLBuffer;

  private pins?: InstanceSet;
  private testPoints?: InstanceSet;
  private traces?: InstanceSet;
  private markers?: InstanceSet;
  /** Part index per marker instance. */
  private markerOwner = new Uint32Array(0);
  /** Trace index per instance: inner layers drawn first, top last. */
  private traceOrder = new Uint32Array(0);
  private partLines?: InstanceSet;
  /** Part index per part outline segment, to expand per-part colors. */
  private partLineOwner = new Uint32Array(0);
  private boardLines?: InstanceSet;
  private partFill?: FillSet;
  private partFillOwner = new Uint32Array(0);
  private boardFill?: { vao: WebGLVertexArrayObject; fans: [number, number][]; quadStart: number };
  /** Photo of the real board, drawn between the board area and the parts. */
  private photo?: { texture: WebGLTexture; vao: WebGLVertexArrayObject; buffer: WebGLBuffer; opacity: number };
  /** Lines drawn above everything else, such as the ratsnest. */
  private overlay?: { set: InstanceSet; buffers: WebGLBuffer[]; vaos: WebGLVertexArrayObject[] };
  private buffers: WebGLBuffer[] = [];
  private vaos: WebGLVertexArrayObject[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, stencil: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL 2 is not available");
    this.gl = gl;
    this.lineProgram = this.compile(LINE_VS, COLOR_FS, ["u_world", "u_viewport", "u_dpr", "u_scale"]);
    this.padProgram = this.compile(PAD_VS, PAD_FS, ["u_world", "u_viewport", "u_scale", "u_minRadius", "u_dpr"]);
    this.fillProgram = this.compile(FILL_VS, COLOR_FS, ["u_world", "u_viewport"]);
    this.imageProgram = this.compile(IMAGE_VS, IMAGE_FS, ["u_world", "u_viewport", "u_tex", "u_opacity"]);
    this.quad = this.staticBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    this.lineCorners = this.staticBuffer(new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]));
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private compile(vs: string, fs: string, uniforms: string[]): Program {
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link error");
    return { program, uniforms: Object.fromEntries(uniforms.map((u) => [u, gl.getUniformLocation(program, u)])) };
  }

  private staticBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  private boardBuffer(data: ArrayBufferView, usage: number): WebGLBuffer {
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    this.buffers.push(b);
    return b;
  }

  private attrib(loc: number, buffer: WebGLBuffer, size: number, type: number, normalized: boolean, divisor: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    gl.vertexAttribDivisor(loc, divisor);
  }

  private vao(): WebGLVertexArrayObject {
    const v = this.gl.createVertexArray()!;
    this.vaos.push(v);
    this.gl.bindVertexArray(v);
    return v;
  }

  private padSet(instances: Float32Array, count: number): InstanceSet {
    const gl = this.gl;
    const vao = this.vao();
    this.attrib(0, this.quad, 2, gl.FLOAT, false, 0);
    this.attrib(1, this.boardBuffer(instances, gl.STATIC_DRAW), 4, gl.FLOAT, false, 1);
    const colors = this.boardBuffer(new Uint8Array(count * 4), gl.DYNAMIC_DRAW);
    this.attrib(2, colors, 4, gl.UNSIGNED_BYTE, true, 1);
    gl.bindVertexArray(null);
    return { vao, colors, count };
  }

  private lineSet(segments: Float32Array, count: number, color?: readonly number[], width = 1): InstanceSet {
    const gl = this.gl;
    const vao = this.vao();
    this.attrib(0, this.lineCorners, 2, gl.FLOAT, false, 0);
    this.attrib(1, this.boardBuffer(segments, gl.STATIC_DRAW), 4, gl.FLOAT, false, 1);
    const colorData = new Uint8Array(count * 4);
    if (color) for (let i = 0; i < count; i++) colorData.set(color, i * 4);
    const colors = this.boardBuffer(colorData, gl.DYNAMIC_DRAW);
    this.attrib(2, colors, 4, gl.UNSIGNED_BYTE, true, 1);
    const widths = this.boardBuffer(new Float32Array(count).fill(width), gl.DYNAMIC_DRAW);
    this.attrib(3, widths, 1, gl.FLOAT, false, 1);
    gl.bindVertexArray(null);
    return { vao, colors, widths, count };
  }

  /** Uploads the geometry of a new board. */
  setBoard(model: BoardModel, palette: Palette): void {
    this.release();
    const gl = this.gl;
    const { pins, testPoints, parts, board } = model;

    const pinData = new Float32Array(pins.length * 4);
    pins.forEach((p, i) => {
      const first = p.number === "1" || p.number.toUpperCase() === "A1";
      pinData.set([p.x, p.y, p.radius, first ? SHAPE_SQUARE : SHAPE_CIRCLE], i * 4);
    });
    this.pins = this.padSet(pinData, pins.length);

    const tpData = new Float32Array(testPoints.length * 4);
    testPoints.forEach((t, i) => tpData.set([t.x, t.y, t.radius, t.kind === "nail" ? SHAPE_DIAMOND : SHAPE_CIRCLE], i * 4));
    this.testPoints = this.padSet(tpData, testPoints.length);

    const traces = model.traces;
    const rank = { both: 0, bottom: 1, top: 2 } as const;
    this.traceOrder = Uint32Array.from(traces.keys()).sort((a, b) => rank[traces[a].side] - rank[traces[b].side] || traces[a].layer - traces[b].layer);
    const traceData = new Float32Array(traces.length * 4);
    const traceWidths = new Float32Array(traces.length);
    this.traceOrder.forEach((ti, i) => {
      const t = traces[ti];
      traceData.set([t.x1, t.y1, t.x2, t.y2], i * 4);
      traceWidths[i] = -Math.max(t.width, 0.01);
    });
    this.traces = this.lineSet(traceData, traces.length);
    upload(gl, this.traces.widths!, traceWidths);

    const markerData: number[] = [];
    const markerOwner: number[] = [];
    parts.forEach((p, i) => {
      if (!p.marker) return;
      const c = partCenter(p);
      const size = markerSize(p);
      markerData.push(c.x, c.y, -size, size > 4 ? SHAPE_SQUARE : SHAPE_CIRCLE);
      markerOwner.push(i);
    });
    this.markerOwner = Uint32Array.from(markerOwner);
    this.markers = this.padSet(new Float32Array(markerData), markerOwner.length);

    const segs: number[] = [];
    const owner: number[] = [];
    parts.forEach((p, i) => {
      if (p.marker) return;
      const o = p.outline;
      for (let k = 0; k < o.length; k++) {
        const a = o[k];
        const b = o[(k + 1) % o.length];
        segs.push(a.x, a.y, b.x, b.y);
        owner.push(i);
      }
    });
    this.partLineOwner = Uint32Array.from(owner);
    this.partLines = this.lineSet(new Float32Array(segs), owner.length);

    const edge: number[] = [];
    for (const path of board.outline) {
      for (let k = 0; k + 1 < path.length; k++) edge.push(path[k].x, path[k].y, path[k + 1].x, path[k + 1].y);
    }
    this.boardLines = this.lineSet(new Float32Array(edge), edge.length / 4, palette.boardEdge, 1.6);

    // Part bodies as triangle fans flattened into triangles.
    const tri: number[] = [];
    const triOwner: number[] = [];
    parts.forEach((p, i) => {
      if (p.marker) return;
      const o = p.outline;
      for (let k = 1; k + 1 < o.length; k++) {
        tri.push(o[0].x, o[0].y, o[k].x, o[k].y, o[k + 1].x, o[k + 1].y);
        triOwner.push(i, i, i);
      }
    });
    this.partFillOwner = Uint32Array.from(triOwner);
    {
      const vao = this.vao();
      this.attrib(0, this.boardBuffer(new Float32Array(tri), gl.STATIC_DRAW), 2, gl.FLOAT, false, 0);
      const colors = this.boardBuffer(new Uint8Array(triOwner.length * 4), gl.DYNAMIC_DRAW);
      this.attrib(1, colors, 4, gl.UNSIGNED_BYTE, true, 0);
      gl.bindVertexArray(null);
      this.partFill = { vao, colors, count: triOwner.length };
    }

    // Board area: closed outline paths filled with the stencil invert trick,
    // which handles concave shapes and holes without triangulation.
    const closed = board.outline.filter((p) => p.length >= 3 && isClosed(p));
    const fillPts: number[] = [];
    const fans: [number, number][] = [];
    for (const path of closed) {
      fans.push([fillPts.length / 2, path.length]);
      for (const pt of path) fillPts.push(pt.x, pt.y);
    }
    const b = board.bounds;
    const quadStart = fillPts.length / 2;
    fillPts.push(b.minX, b.minY, b.maxX, b.minY, b.minX, b.maxY, b.maxX, b.maxY);
    {
      const vao = this.vao();
      this.attrib(0, this.boardBuffer(new Float32Array(fillPts), gl.STATIC_DRAW), 2, gl.FLOAT, false, 0);
      gl.bindVertexArray(null);
      this.boardFill = { vao, fans, quadStart };
    }
  }

  /** Uploads new element colors after a selection, side or theme change. */
  setStyle(style: BoardStyle, palette: Palette): void {
    const gl = this.gl;
    if (!this.pins || !this.testPoints || !this.partLines || !this.partFill || !this.boardLines) return;
    upload(gl, this.pins.colors, style.pinColors);
    upload(gl, this.testPoints.colors, style.testPointColors);
    if (this.markers && this.markers.count > 0) {
      const colors = new Uint8Array(this.markerOwner.length * 4);
      this.markerOwner.forEach((part, i) => colors.set(style.markerColors.subarray(part * 4, part * 4 + 4), i * 4));
      upload(gl, this.markers.colors, colors);
    }
    if (this.traces && this.traces.count > 0) {
      const colors = new Uint8Array(this.traceOrder.length * 4);
      this.traceOrder.forEach((ti, i) => colors.set(style.traceColors.subarray(ti * 4, ti * 4 + 4), i * 4));
      upload(gl, this.traces.colors, colors);
    }

    const lineColors = new Uint8Array(this.partLineOwner.length * 4);
    const lineWidths = new Float32Array(this.partLineOwner.length);
    this.partLineOwner.forEach((part, i) => {
      lineColors.set(style.partOutlineColors.subarray(part * 4, part * 4 + 4), i * 4);
      lineWidths[i] = style.partOutlineWidths[part];
    });
    upload(gl, this.partLines.colors, lineColors);
    upload(gl, this.partLines.widths!, lineWidths);

    const fillColors = new Uint8Array(this.partFillOwner.length * 4);
    this.partFillOwner.forEach((part, i) => fillColors.set(style.partFillColors.subarray(part * 4, part * 4 + 4), i * 4));
    upload(gl, this.partFill.colors, fillColors);

    const edge = new Uint8Array(this.boardLines.count * 4);
    for (let i = 0; i < this.boardLines.count; i++) edge.set(palette.boardEdge, i * 4);
    upload(gl, this.boardLines.colors, edge);
  }

  /**
   * Shows a photo of the board. `corners` are the board positions of the
   * image's top-left, top-right, bottom-left and bottom-right corners.
   */
  setPhoto(image: TexImageSource | null, corners: Point[] = [], opacity = 1): void {
    this.clearPhoto();
    if (!image || corners.length !== 4) return;
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const [tl, tr, bl, br] = corners;
    const data = new Float32Array([tl.x, tl.y, 0, 0, tr.x, tr.y, 1, 0, bl.x, bl.y, 0, 1, br.x, br.y, 1, 1]);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    this.photo = { texture, vao, buffer, opacity };
  }

  setPhotoOpacity(opacity: number): void {
    if (this.photo) this.photo.opacity = opacity;
  }

  private clearPhoto(): void {
    if (!this.photo) return;
    this.gl.deleteTexture(this.photo.texture);
    this.gl.deleteBuffer(this.photo.buffer);
    this.gl.deleteVertexArray(this.photo.vao);
    this.photo = undefined;
  }

  /** Replaces the overlay lines: `segments` holds x1, y1, x2, y2 per line. */
  setOverlay(segments: Float32Array, color: readonly number[], width: number): void {
    this.clearOverlay();
    const count = segments.length / 4;
    if (count === 0) return;
    const buffers = this.buffers.length;
    const vaos = this.vaos.length;
    const set = this.lineSet(segments, count, color, width);
    // Kept apart from the board buffers so they can be swapped on their own.
    this.overlay = { set, buffers: this.buffers.splice(buffers), vaos: this.vaos.splice(vaos) };
  }

  private clearOverlay(): void {
    if (!this.overlay) return;
    for (const b of this.overlay.buffers) this.gl.deleteBuffer(b);
    for (const v of this.overlay.vaos) this.gl.deleteVertexArray(v);
    this.overlay = undefined;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(camera: Camera, palette: Palette, dpr: number): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    const bg = palette.background;
    gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    if (!this.pins) return;

    const [a, b, c, d, e, f] = camera.matrix();
    // Column-major mat3: world -> device pixels.
    const world = new Float32Array([a * dpr, b * dpr, 0, c * dpr, d * dpr, 0, e * dpr, f * dpr, 1]);

    // Board area.
    const fill = this.fillProgram;
    gl.useProgram(fill.program);
    gl.uniformMatrix3fv(fill.uniforms.u_world, false, world);
    gl.uniform2f(fill.uniforms.u_viewport, w, h);
    if (this.boardFill && this.boardFill.fans.length > 0) {
      gl.bindVertexArray(this.boardFill.vao);
      gl.disableVertexAttribArray(1);
      gl.enable(gl.STENCIL_TEST);
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.ALWAYS, 0, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      for (const [first, count] of this.boardFill.fans) gl.drawArrays(gl.TRIANGLE_FAN, first, count);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.EQUAL, 1, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      const bf = palette.boardFill;
      gl.vertexAttrib4f(1, bf[0] / 255, bf[1] / 255, bf[2] / 255, bf[3] / 255);
      gl.drawArrays(gl.TRIANGLE_STRIP, this.boardFill.quadStart, 4);
      gl.disable(gl.STENCIL_TEST);
    }

    if (this.photo) {
      const img = this.imageProgram;
      gl.useProgram(img.program);
      gl.uniformMatrix3fv(img.uniforms.u_world, false, world);
      gl.uniform2f(img.uniforms.u_viewport, w, h);
      gl.uniform1f(img.uniforms.u_opacity, this.photo.opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.photo.texture);
      gl.uniform1i(img.uniforms.u_tex, 0);
      gl.bindVertexArray(this.photo.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.useProgram(fill.program);
    }

    const line = this.lineProgram;
    gl.useProgram(line.program);
    gl.uniformMatrix3fv(line.uniforms.u_world, false, world);
    gl.uniform2f(line.uniforms.u_viewport, w, h);
    gl.uniform1f(line.uniforms.u_dpr, dpr);
    gl.uniform1f(line.uniforms.u_scale, camera.scale * dpr);
    if (this.traces && this.traces.count > 0) {
      gl.bindVertexArray(this.traces.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.traces.count);
    }

    if (this.partFill) {
      gl.useProgram(fill.program);
      gl.bindVertexArray(this.partFill.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.partFill.count);
      gl.useProgram(line.program);
    }

    for (const set of [this.boardLines, this.partLines]) {
      if (set && set.count > 0) {
        gl.bindVertexArray(set.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, set.count);
      }
    }

    const pad = this.padProgram;
    gl.useProgram(pad.program);
    gl.uniformMatrix3fv(pad.uniforms.u_world, false, world);
    gl.uniform2f(pad.uniforms.u_viewport, w, h);
    gl.uniform1f(pad.uniforms.u_scale, camera.scale * dpr);
    gl.uniform1f(pad.uniforms.u_minRadius, 1.2 * dpr);
    gl.uniform1f(pad.uniforms.u_dpr, dpr);
    for (const set of [this.pins, this.testPoints, this.markers]) {
      if (set && set.count > 0) {
        gl.bindVertexArray(set.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, set.count);
      }
    }

    if (this.overlay) {
      gl.useProgram(line.program);
      gl.bindVertexArray(this.overlay.set.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.overlay.set.count);
    }
    gl.bindVertexArray(null);
  }

  private release(): void {
    const gl = this.gl;
    this.clearOverlay();
    this.clearPhoto();
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const v of this.vaos) gl.deleteVertexArray(v);
    this.buffers = [];
    this.vaos = [];
    this.pins = this.testPoints = this.traces = this.markers = this.partLines = this.boardLines = undefined;
    this.partFill = undefined;
    this.boardFill = undefined;
  }

  // The context itself is left alone: a remount (React StrictMode, hot
  // reload) gets the same context back from the same canvas and must be
  // able to use it.
  dispose(): void {
    this.release();
  }
}

function upload(gl: WebGL2RenderingContext, buffer: WebGLBuffer, data: ArrayBufferView): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
}

function isClosed(path: Point[]): boolean {
  const a = path[0];
  const b = path[path.length - 1];
  let span = 1;
  for (const p of path) span = Math.max(span, Math.abs(p.x - a.x) + Math.abs(p.y - a.y));
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= span * 0.02;
}
