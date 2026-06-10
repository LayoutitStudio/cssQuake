import { BASE_TILE, type Vec3 } from "@layoutit/polycss";

export interface QuakeViewmodelRasterModel {
  version: 1;
  source: string;
  skinWidth: number;
  skinHeight: number;
  skin: string;
  palette: string;
  triangles: QuakeViewmodelRasterTriangle[];
  frames: QuakeViewmodelRasterFrame[];
}

export interface QuakeViewmodelRasterTriangle {
  facesfront: boolean;
  indices: [number, number, number];
  uvs: [number, number][];
}

export interface QuakeViewmodelRasterFrame {
  name: string;
  vertices: Vec3[];
  normalIndices: number[];
}

export interface QuakeViewmodelRasterSyncState {
  width: number;
  height: number;
  stageLeftPx: number;
  stageTopPx: number;
  stageTransform: string;
  meshTransform: string;
  perspectivePx: number;
  perspectiveOriginX: number;
  perspectiveOriginY: number;
  rotY: number;
  postTransform?: QuakeViewmodelRasterPostTransform | null;
}

export interface QuakeViewmodelRasterPostTransform {
  originX: number;
  originY: number;
  translateX: number;
  translateY: number;
  rotateDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  scaleX: number;
  scaleY: number;
}

export interface QuakeViewmodelRasterLayer {
  mount(model: QuakeViewmodelRasterModel): void;
  remove(): void;
  sync(state: QuakeViewmodelRasterSyncState): void;
  setFrameIndex(frameIndex: number): void;
}

interface DecodedQuakeViewmodelRasterModel {
  source: string;
  skinWidth: number;
  skinHeight: number;
  skin: Uint8Array;
  palette: Uint8Array;
  skinR: Uint8Array;
  skinG: Uint8Array;
  skinB: Uint8Array;
  skinFullbright: Uint8Array;
  triangles: QuakeViewmodelRasterTriangle[];
  frames: QuakeViewmodelRasterFrame[];
}

interface ProjectedVertex {
  x: number;
  y: number;
  z: number;
  q: number;
  shade: number;
}

interface ProjectedTriangle {
  triangle: QuakeViewmodelRasterTriangle;
  vertices: [ProjectedVertex, ProjectedVertex, ProjectedVertex];
}

interface RasterDirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RasterBuffer {
  image: ImageData;
  zBuffer: Float32Array;
  width: number;
  height: number;
}

const QUAKE_ALIAS_VIEWMODEL_LIGHT_COLOR = 96 / 200;
const QUAKE_ALIAS_SHADER_LIGHT_SCALE = 2;
const QUAKE_RASTER_POSTPROCESS_GAMMA = 0.9;
const QUAKE_RASTER_POSTPROCESS_CONTRAST = 1.4;
const QUAKE_RASTER_MIN_DENOMINATOR = 1e-3;
const QUAKE_RASTER_EDGE_EPSILON = 1e-5;
const QUAKE_ALIAS_NORMALS = decodeAliasNormals([
  "-0.525731,0.000000,0.850651,-0.442863,0.238856,0.864188,-0.295242,0.000000,0.955423,-0.309017,",
  "0.500000,0.809017,-0.162460,0.262866,0.951056,0.000000,0.000000,1.000000,0.000000,0.850651,0.5",
  "25731,-0.147621,0.716567,0.681718,0.147621,0.716567,0.681718,0.000000,0.525731,0.850651,0.3090",
  "17,0.500000,0.809017,0.525731,0.000000,0.850651,0.295242,0.000000,0.955423,0.442863,0.238856,0",
  ".864188,0.162460,0.262866,0.951056,-0.681718,0.147621,0.716567,-0.809017,0.309017,0.500000,-0.",
  "587785,0.425325,0.688191,-0.850651,0.525731,0.000000,-0.864188,0.442863,0.238856,-0.716567,0.6",
  "81718,0.147621,-0.688191,0.587785,0.425325,-0.500000,0.809017,0.309017,-0.238856,0.864188,0.44",
  "2863,-0.425325,0.688191,0.587785,-0.716567,0.681718,-0.147621,-0.500000,0.809017,-0.309017,-0.",
  "525731,0.850651,0.000000,0.000000,0.850651,-0.525731,-0.238856,0.864188,-0.442863,0.000000,0.9",
  "55423,-0.295242,-0.262866,0.951056,-0.162460,0.000000,1.000000,0.000000,0.000000,0.955423,0.29",
  "5242,-0.262866,0.951056,0.162460,0.238856,0.864188,0.442863,0.262866,0.951056,0.162460,0.50000",
  "0,0.809017,0.309017,0.238856,0.864188,-0.442863,0.262866,0.951056,-0.162460,0.500000,0.809017,",
  "-0.309017,0.850651,0.525731,0.000000,0.716567,0.681718,0.147621,0.716567,0.681718,-0.147621,0.",
  "525731,0.850651,0.000000,0.425325,0.688191,0.587785,0.864188,0.442863,0.238856,0.688191,0.5877",
  "85,0.425325,0.809017,0.309017,0.500000,0.681718,0.147621,0.716567,0.587785,0.425325,0.688191,0",
  ".955423,0.295242,0.000000,1.000000,0.000000,0.000000,0.951056,0.162460,0.262866,0.850651,-0.52",
  "5731,0.000000,0.955423,-0.295242,0.000000,0.864188,-0.442863,0.238856,0.951056,-0.162460,0.262",
  "866,0.809017,-0.309017,0.500000,0.681718,-0.147621,0.716567,0.850651,0.000000,0.525731,0.86418",
  "8,0.442863,-0.238856,0.809017,0.309017,-0.500000,0.951056,0.162460,-0.262866,0.525731,0.000000",
  ",-0.850651,0.681718,0.147621,-0.716567,0.681718,-0.147621,-0.716567,0.850651,0.000000,-0.52573",
  "1,0.809017,-0.309017,-0.500000,0.864188,-0.442863,-0.238856,0.951056,-0.162460,-0.262866,0.147",
  "621,0.716567,-0.681718,0.309017,0.500000,-0.809017,0.425325,0.688191,-0.587785,0.442863,0.2388",
  "56,-0.864188,0.587785,0.425325,-0.688191,0.688191,0.587785,-0.425325,-0.147621,0.716567,-0.681",
  "718,-0.309017,0.500000,-0.809017,0.000000,0.525731,-0.850651,-0.525731,0.000000,-0.850651,-0.4",
  "42863,0.238856,-0.864188,-0.295242,0.000000,-0.955423,-0.162460,0.262866,-0.951056,0.000000,0.",
  "000000,-1.000000,0.295242,0.000000,-0.955423,0.162460,0.262866,-0.951056,-0.442863,-0.238856,-",
  "0.864188,-0.309017,-0.500000,-0.809017,-0.162460,-0.262866,-0.951056,0.000000,-0.850651,-0.525",
  "731,-0.147621,-0.716567,-0.681718,0.147621,-0.716567,-0.681718,0.000000,-0.525731,-0.850651,0.",
  "309017,-0.500000,-0.809017,0.442863,-0.238856,-0.864188,0.162460,-0.262866,-0.951056,0.238856,",
  "-0.864188,-0.442863,0.500000,-0.809017,-0.309017,0.425325,-0.688191,-0.587785,0.716567,-0.6817",
  "18,-0.147621,0.688191,-0.587785,-0.425325,0.587785,-0.425325,-0.688191,0.000000,-0.955423,-0.2",
  "95242,0.000000,-1.000000,0.000000,0.262866,-0.951056,-0.162460,0.000000,-0.850651,0.525731,0.0",
  "00000,-0.955423,0.295242,0.238856,-0.864188,0.442863,0.262866,-0.951056,0.162460,0.500000,-0.8",
  "09017,0.309017,0.716567,-0.681718,0.147621,0.525731,-0.850651,0.000000,-0.238856,-0.864188,-0.",
  "442863,-0.500000,-0.809017,-0.309017,-0.262866,-0.951056,-0.162460,-0.850651,-0.525731,0.00000",
  "0,-0.716567,-0.681718,-0.147621,-0.716567,-0.681718,0.147621,-0.525731,-0.850651,0.000000,-0.5",
  "00000,-0.809017,0.309017,-0.238856,-0.864188,0.442863,-0.262866,-0.951056,0.162460,-0.864188,-",
  "0.442863,0.238856,-0.809017,-0.309017,0.500000,-0.688191,-0.587785,0.425325,-0.681718,-0.14762",
  "1,0.716567,-0.442863,-0.238856,0.864188,-0.587785,-0.425325,0.688191,-0.309017,-0.500000,0.809",
  "017,-0.147621,-0.716567,0.681718,-0.425325,-0.688191,0.587785,-0.162460,-0.262866,0.951056,0.4",
  "42863,-0.238856,0.864188,0.162460,-0.262866,0.951056,0.309017,-0.500000,0.809017,0.147621,-0.7",
  "16567,0.681718,0.000000,-0.525731,0.850651,0.425325,-0.688191,0.587785,0.587785,-0.425325,0.68",
  "8191,0.688191,-0.587785,0.425325,-0.955423,0.295242,0.000000,-0.951056,0.162460,0.262866,-1.00",
  "0000,0.000000,0.000000,-0.850651,0.000000,0.525731,-0.955423,-0.295242,0.000000,-0.951056,-0.1",
  "62460,0.262866,-0.864188,0.442863,-0.238856,-0.951056,0.162460,-0.262866,-0.809017,0.309017,-0",
  ".500000,-0.864188,-0.442863,-0.238856,-0.951056,-0.162460,-0.262866,-0.809017,-0.309017,-0.500",
  "000,-0.681718,0.147621,-0.716567,-0.681718,-0.147621,-0.716567,-0.850651,0.000000,-0.525731,-0",
  ".688191,0.587785,-0.425325,-0.587785,0.425325,-0.688191,-0.425325,0.688191,-0.587785,-0.425325",
  ",-0.688191,-0.587785,-0.587785,-0.425325,-0.688191,-0.688191,-0.587785,-0.425325",
].join(""));

export function createQuakeViewmodelRasterLayer(layer: HTMLElement): QuakeViewmodelRasterLayer {
  const canvas = layer.ownerDocument.createElement("canvas");
  const context = canvas.getContext("2d");
  let decoded: DecodedQuakeViewmodelRasterModel | null = null;
  let currentState: QuakeViewmodelRasterSyncState | null = null;
  let rasterBuffer: RasterBuffer | null = null;
  let frameIndex = 0;

  canvas.id = "quake-viewmodel-raster";
  canvas.width = 1;
  canvas.height = 1;
  canvas.style.left = "0px";
  canvas.style.top = "0px";
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
  canvas.style.width = "1px";
  canvas.style.height = "1px";

  function mount(model: QuakeViewmodelRasterModel): void {
    if (!context) throw new Error("Quake viewmodel raster requires a 2D canvas context.");
    decoded = decodeRasterModel(model);
    frameIndex = 0;
    if (canvas.parentElement !== layer) layer.appendChild(canvas);
    layer.classList.add("quake-viewmodel-raster-active");
    if (currentState) draw(currentState);
  }

  function remove(): void {
    decoded = null;
    currentState = null;
    frameIndex = 0;
    layer.classList.remove("quake-viewmodel-raster-active");
    canvas.remove();
  }

  function sync(state: QuakeViewmodelRasterSyncState): void {
    currentState = state;
    if (!decoded || !context || canvas.parentElement !== layer) return;
    draw(state);
  }

  function setFrameIndex(nextFrameIndex: number): void {
    frameIndex = Math.max(0, Math.floor(nextFrameIndex));
    if (currentState) draw(currentState);
  }

  function draw(state: QuakeViewmodelRasterSyncState): void {
    if (!decoded || !context) return;
    const width = Math.max(1, Math.round(state.width));
    const height = Math.max(1, Math.round(state.height));

    let meshMatrix: DOMMatrix;
    let stageMatrix: DOMMatrix;
    try {
      meshMatrix = cssTransformMatrix(state.meshTransform);
      stageMatrix = cssTransformMatrix(state.stageTransform);
    } catch {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const frame = decoded.frames[Math.min(frameIndex, decoded.frames.length - 1)] ?? decoded.frames[0];
    if (!frame) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const shadeVector = quakeAliasShadeVector(state.rotY);
    const projectedVertices: (ProjectedVertex | null)[] = new Array(frame.vertices.length);
    for (let vertexIndex = 0; vertexIndex < frame.vertices.length; vertexIndex++) {
      projectedVertices[vertexIndex] = projectVertex(
        frame.vertices[vertexIndex],
        meshMatrix,
        stageMatrix,
        state,
        quakeAliasVertexLight(frame.normalIndices[vertexIndex], shadeVector),
      );
    }

    const projectedTriangles: ProjectedTriangle[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let triangleIndex = 0; triangleIndex < decoded.triangles.length; triangleIndex++) {
      const triangle = decoded.triangles[triangleIndex];
      const v0 = projectedVertices[triangle.indices[0]];
      const v1 = projectedVertices[triangle.indices[1]];
      const v2 = projectedVertices[triangle.indices[2]];
      if (!v0 || !v1 || !v2) continue;
      const vertices: [ProjectedVertex, ProjectedVertex, ProjectedVertex] = [v0, v1, v2];
      projectedTriangles.push({ triangle, vertices });
      for (const vertex of vertices) {
        minX = Math.min(minX, vertex.x);
        minY = Math.min(minY, vertex.y);
        maxX = Math.max(maxX, vertex.x);
        maxY = Math.max(maxY, vertex.y);
      }
    }

    const dirtyRect = rasterDirtyRect(minX, minY, maxX, maxY, width, height);
    if (!dirtyRect) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    rasterBuffer = rasterBufferFor(context, rasterBuffer, dirtyRect.width, dirtyRect.height);
    syncCanvasBounds(canvas, rasterBuffer, dirtyRect);
    syncCanvasPostTransform(canvas, state.postTransform ?? null, dirtyRect);
    context.clearRect(0, 0, canvas.width, canvas.height);
    clearRasterBuffer(rasterBuffer, dirtyRect.width, dirtyRect.height);
    for (const projected of projectedTriangles) {
      drawTriangle(
        rasterBuffer.image.data,
        rasterBuffer.zBuffer,
        rasterBuffer.width,
        dirtyRect.width,
        dirtyRect.height,
        decoded,
        projected.triangle,
        projected.vertices,
        dirtyRect.x,
        dirtyRect.y,
      );
    }
    context.putImageData(rasterBuffer.image, 0, 0, 0, 0, dirtyRect.width, dirtyRect.height);
  }

  return { mount, remove, sync, setFrameIndex };
}

function decodeRasterModel(model: QuakeViewmodelRasterModel): DecodedQuakeViewmodelRasterModel {
  const skin = decodeBase64Bytes(model.skin);
  const palette = decodeBase64Bytes(model.palette);
  const texelCount = model.skinWidth * model.skinHeight;
  const skinR = new Uint8Array(texelCount);
  const skinG = new Uint8Array(texelCount);
  const skinB = new Uint8Array(texelCount);
  const skinFullbright = new Uint8Array(texelCount);
  for (let index = 0; index < texelCount; index++) {
    const skinIndex = skin[index] ?? 0;
    const paletteIndex = skinIndex * 3;
    skinR[index] = palette[paletteIndex] ?? 0;
    skinG[index] = palette[paletteIndex + 1] ?? 0;
    skinB[index] = palette[paletteIndex + 2] ?? 0;
    skinFullbright[index] = skinIndex >= 224 ? 1 : 0;
  }

  return {
    source: model.source,
    skinWidth: model.skinWidth,
    skinHeight: model.skinHeight,
    skin,
    palette,
    skinR,
    skinG,
    skinB,
    skinFullbright,
    triangles: model.triangles,
    frames: model.frames,
  };
}

function projectVertex(
  vertex: Vec3 | undefined,
  meshMatrix: DOMMatrix,
  stageMatrix: DOMMatrix,
  state: QuakeViewmodelRasterSyncState,
  shade: number,
): ProjectedVertex | null {
  if (!vertex) return null;
  const local = new DOMPoint(vertex[1] * BASE_TILE, vertex[0] * BASE_TILE, vertex[2] * BASE_TILE, 1);
  const transformed = local.matrixTransform(meshMatrix).matrixTransform(stageMatrix);
  const layerX = state.stageLeftPx + transformed.x;
  const layerY = state.stageTopPx + transformed.y;
  const denominator = state.perspectivePx - transformed.z;
  if (!Number.isFinite(denominator) || denominator <= QUAKE_RASTER_MIN_DENOMINATOR) return null;
  const q = state.perspectivePx / denominator;
  return {
    x: state.perspectiveOriginX + (layerX - state.perspectiveOriginX) * q,
    y: state.perspectiveOriginY + (layerY - state.perspectiveOriginY) * q,
    z: transformed.z,
    q,
    shade,
  };
}

function rasterDirtyRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  width: number,
  height: number,
): RasterDirtyRect | null {
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }
  const left = clampInt(Math.floor(minX) - 2, 0, width);
  const top = clampInt(Math.floor(minY) - 2, 0, height);
  const right = clampInt(Math.ceil(maxX) + 2, 0, width);
  const bottom = clampInt(Math.ceil(maxY) + 2, 0, height);
  if (right <= left || bottom <= top) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function rasterBufferFor(
  context: CanvasRenderingContext2D,
  current: RasterBuffer | null,
  width: number,
  height: number,
): RasterBuffer {
  if (current && current.width >= width && current.height >= height) return current;
  const nextWidth = alignInt(Math.max(width, current?.width ?? 0), 32);
  const nextHeight = alignInt(Math.max(height, current?.height ?? 0), 32);
  return {
    image: context.createImageData(nextWidth, nextHeight),
    zBuffer: new Float32Array(nextWidth * nextHeight),
    width: nextWidth,
    height: nextHeight,
  };
}

function syncCanvasBounds(canvas: HTMLCanvasElement, buffer: RasterBuffer, rect: RasterDirtyRect): void {
  if (canvas.width !== buffer.width) canvas.width = buffer.width;
  if (canvas.height !== buffer.height) canvas.height = buffer.height;
  canvas.style.left = `${rect.x}px`;
  canvas.style.top = `${rect.y}px`;
  canvas.style.width = `${buffer.width}px`;
  canvas.style.height = `${buffer.height}px`;
}

function syncCanvasPostTransform(
  canvas: HTMLCanvasElement,
  transform: QuakeViewmodelRasterPostTransform | null,
  rect: RasterDirtyRect,
): void {
  if (!transform) {
    canvas.style.removeProperty("transform");
    canvas.style.removeProperty("transform-origin");
    return;
  }
  canvas.style.transformOrigin = `${transform.originX - rect.x}px ${transform.originY - rect.y}px`;
  const transforms = [
    Math.abs(transform.translateX) > 0.001 || Math.abs(transform.translateY) > 0.001
      ? `translate(${transform.translateX}px, ${transform.translateY}px)`
      : "",
    Math.abs(transform.rotateDeg) > 0.001 ? `rotate(${transform.rotateDeg}deg)` : "",
    Math.abs(transform.skewXDeg) > 0.001 ? `skewX(${transform.skewXDeg}deg)` : "",
    Math.abs(transform.skewYDeg) > 0.001 ? `skewY(${transform.skewYDeg}deg)` : "",
    Math.abs(transform.scaleX - 1) > 0.001 || Math.abs(transform.scaleY - 1) > 0.001
      ? `scale(${transform.scaleX}, ${transform.scaleY})`
      : "",
  ];
  canvas.style.transform = transforms.filter(Boolean).join(" ");
}

function clearRasterBuffer(buffer: RasterBuffer, width: number, height: number): void {
  const rgbaStride = buffer.width * 4;
  const rgbaRowBytes = width * 4;
  const rgba = buffer.image.data;
  const zBuffer = buffer.zBuffer;
  if (width === buffer.width && height === buffer.height) {
    rgba.fill(0);
    zBuffer.fill(-Infinity);
    return;
  }
  for (let y = 0; y < height; y++) {
    const rgbaStart = y * rgbaStride;
    rgba.fill(0, rgbaStart, rgbaStart + rgbaRowBytes);
    const zStart = y * buffer.width;
    zBuffer.fill(-Infinity, zStart, zStart + width);
  }
}

function drawTriangle(
  rgba: Uint8ClampedArray,
  zBuffer: Float32Array,
  stride: number,
  width: number,
  height: number,
  model: DecodedQuakeViewmodelRasterModel,
  triangle: QuakeViewmodelRasterTriangle,
  vertices: [ProjectedVertex, ProjectedVertex, ProjectedVertex],
  offsetX = 0,
  offsetY = 0,
): void {
  const [a, b, c] = vertices;
  const ax = a.x - offsetX;
  const ay = a.y - offsetY;
  const bx = b.x - offsetX;
  const by = b.y - offsetY;
  const cx = c.x - offsetX;
  const cy = c.y - offsetY;
  const area = edgeFunction(ax, ay, bx, by, cx, cy);
  if (Math.abs(area) <= QUAKE_RASTER_EDGE_EPSILON) return;
  const sign = area < 0 ? -1 : 1;
  const invAreaAbs = 1 / Math.abs(area);
  const minX = clampInt(Math.floor(Math.min(ax, bx, cx)), 0, width - 1);
  const maxX = clampInt(Math.ceil(Math.max(ax, bx, cx)), 0, width - 1);
  const minY = clampInt(Math.floor(Math.min(ay, by, cy)), 0, height - 1);
  const maxY = clampInt(Math.ceil(Math.max(ay, by, cy)), 0, height - 1);
  const uv0 = triangle.uvs[0] ?? [0, 0];
  const uv1 = triangle.uvs[1] ?? [0, 0];
  const uv2 = triangle.uvs[2] ?? [0, 0];
  const stepX0 = sign * (cy - by);
  const stepY0 = sign * -(cx - bx);
  const stepX1 = sign * (ay - cy);
  const stepY1 = sign * -(ax - cx);
  const stepX2 = sign * (by - ay);
  const stepY2 = sign * -(bx - ax);
  const startX = minX + 0.5;
  let rowW0 = sign * edgeFunction(bx, by, cx, cy, startX, minY + 0.5);
  let rowW1 = sign * edgeFunction(cx, cy, ax, ay, startX, minY + 0.5);
  let rowW2 = sign * edgeFunction(ax, ay, bx, by, startX, minY + 0.5);

  for (let y = minY; y <= maxY; y++) {
    let w0 = rowW0;
    let w1 = rowW1;
    let w2 = rowW2;
    for (let x = minX; x <= maxX; x++) {
      if (w0 < -QUAKE_RASTER_EDGE_EPSILON || w1 < -QUAKE_RASTER_EDGE_EPSILON || w2 < -QUAKE_RASTER_EDGE_EPSILON) {
        w0 += stepX0;
        w1 += stepX1;
        w2 += stepX2;
        continue;
      }

      const b0 = w0 * invAreaAbs;
      const b1 = w1 * invAreaAbs;
      const b2 = w2 * invAreaAbs;
      const q0 = b0 * a.q;
      const q1 = b1 * b.q;
      const q2 = b2 * c.q;
      const q = q0 + q1 + q2;
      if (Math.abs(q) <= QUAKE_RASTER_EDGE_EPSILON) {
        w0 += stepX0;
        w1 += stepX1;
        w2 += stepX2;
        continue;
      }
      const z = (q0 * a.z + q1 * b.z + q2 * c.z) / q;
      const pixelIndex = y * stride + x;
      if (z <= zBuffer[pixelIndex]) {
        w0 += stepX0;
        w1 += stepX1;
        w2 += stepX2;
        continue;
      }
      zBuffer[pixelIndex] = z;

      const u = (q0 * uv0[0] + q1 * uv1[0] + q2 * uv2[0]) / q;
      const v = (q0 * uv0[1] + q1 * uv1[1] + q2 * uv2[1]) / q;
      const skinX = clampNumber(u * model.skinWidth - 0.5, 0, model.skinWidth - 1);
      const skinY = clampNumber((1 - v) * model.skinHeight - 0.5, 0, model.skinHeight - 1);
      const x0 = Math.floor(skinX);
      const y0 = Math.floor(skinY);
      const x1 = Math.min(model.skinWidth - 1, x0 + 1);
      const y1 = Math.min(model.skinHeight - 1, y0 + 1);
      const tx = skinX - x0;
      const ty = skinY - y0;
      const row0 = y0 * model.skinWidth;
      const row1 = y1 * model.skinWidth;
      const i00 = row0 + x0;
      const i10 = row0 + x1;
      const i01 = row1 + x0;
      const i11 = row1 + x1;
      const r = bilerpNumber(model.skinR[i00], model.skinR[i10], model.skinR[i01], model.skinR[i11], tx, ty);
      const g = bilerpNumber(model.skinG[i00], model.skinG[i10], model.skinG[i01], model.skinG[i11], tx, ty);
      const blue = bilerpNumber(model.skinB[i00], model.skinB[i10], model.skinB[i01], model.skinB[i11], tx, ty);
      const fullbright =
        model.skinFullbright[i00] || model.skinFullbright[i10] || model.skinFullbright[i01] || model.skinFullbright[i11];
      const light = fullbright ? 1 : (q0 * a.shade + q1 * b.shade + q2 * c.shade) / q;
      const out = pixelIndex * 4;
      rgba[out] = postprocessChannel(r, light);
      rgba[out + 1] = postprocessChannel(g, light);
      rgba[out + 2] = postprocessChannel(blue, light);
      rgba[out + 3] = 255;
      w0 += stepX0;
      w1 += stepX1;
      w2 += stepX2;
    }
    rowW0 += stepY0;
    rowW1 += stepY1;
    rowW2 += stepY2;
  }
}

function quakeAliasVertexLight(normalIndex: number | undefined, shadeVector: Vec3): number {
  const normal = QUAKE_ALIAS_NORMALS[normalIndex ?? -1] ?? [0, 0, 1];
  const dot = normal[0] * shadeVector[0] + normal[1] * shadeVector[1] + normal[2] * shadeVector[2];
  const shadeDot = dot < 0 ? 1 + dot * (13 / 44) : 1 + dot;
  return QUAKE_ALIAS_VIEWMODEL_LIGHT_COLOR * shadeDot * QUAKE_ALIAS_SHADER_LIGHT_SCALE;
}

function quakeAliasShadeVector(rotY: number): Vec3 {
  const quakeYaw = normalizeAngleDegrees(rotY - 180);
  const quantized = Math.floor(quakeYaw * (16 / 360)) / 16;
  const angle = quantized * Math.PI * 2;
  return normalizeVec3([Math.cos(-angle), Math.sin(-angle), 1]);
}

function postprocessChannel(value: number, light: number): number {
  const lit = (value / 255) * light;
  const contrasted = lit * QUAKE_RASTER_POSTPROCESS_CONTRAST;
  const corrected = Math.pow(clampNumber(contrasted, 0, 1), QUAKE_RASTER_POSTPROCESS_GAMMA);
  return clampInt(Math.round(corrected * 255), 0, 255);
}

function cssTransformMatrix(transform: string): DOMMatrix {
  const trimmed = transform.trim();
  return trimmed && trimmed !== "none" ? new DOMMatrix(trimmed) : new DOMMatrix();
}

function edgeFunction(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 1e-8 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 1];
}

function normalizeAngleDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function decodeAliasNormals(value: string): Vec3[] {
  const numbers = value.split(",").map((part) => Number.parseFloat(part));
  const normals: Vec3[] = [];
  for (let index = 0; index + 2 < numbers.length; index += 3) {
    normals.push(normalizeVec3([numbers[index], numbers[index + 1], numbers[index + 2]]));
  }
  return normals;
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function bilerpNumber(c00: number, c10: number, c01: number, c11: number, tx: number, ty: number): number {
  return lerpNumber(lerpNumber(c00, c10, tx), lerpNumber(c01, c11, tx), ty);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value | 0));
}

function alignInt(value: number, alignment: number): number {
  return Math.max(alignment, Math.ceil(value / alignment) * alignment);
}
