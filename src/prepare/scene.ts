import { computeTextureAtlasPlanPublic, mergePolygons, type Polygon, type TextureTriangle, type Vec2, type Vec3 } from "@layoutit/polycss";

import { buildEntityManifest, cloneEntityManifest } from "./entities";
import { parseQuakePakDirectory, quakePakEntryBytes, readFixedAscii, type QuakePakEntry } from "./pak";
import { buildSourceFaceVisibilityKeys, buildVisibility } from "./visibility";
export { parseQuakePakDirectory, quakePakEntryBytes, type QuakePakEntry } from "./pak";

export type RGB = [number, number, number];

export interface QuakeTextureEncodeInput {
  width: number;
  height: number;
  pixels: Uint8Array;
  palette: RGB[];
  brightness: number;
  alpha?: Uint8Array;
}

export type QuakeTextureUrlEncoder = (input: QuakeTextureEncodeInput) => Promise<string>;

interface QuakeMipTexture {
  name: string;
  width: number;
  height: number;
  pixels: Uint8Array;
  url: string;
}

export interface QuakeVertex {
  x: number;
  y: number;
  z: number;
}

export interface QuakePlane {
  normal: QuakeVertex;
  dist: number;
}

interface QuakeTexInfo {
  s: [number, number, number, number];
  t: [number, number, number, number];
  miptex: number;
}

interface QuakeTextureCoordinateBounds {
  minS: number;
  maxS: number;
  minT: number;
  maxT: number;
}

interface QuakeFace {
  plane: number;
  side: number;
  firstEdge: number;
  edgeCount: number;
  texInfo: number;
  styles: [number, number, number, number];
  lightOffset: number;
}

interface QuakeModel {
  mins: QuakeVertex;
  maxs: QuakeVertex;
  origin: QuakeVertex;
  headNodes: [number, number, number, number];
  firstFace: number;
  faceCount: number;
}

export type QuakeEntityProperties = Record<string, string>;

export interface QuakeEntity {
  index: number;
  classname: string;
  properties: QuakeEntityProperties;
  origin?: QuakeVertex;
  angle?: number;
  model?: string;
  modelIndex?: number;
}

export type QuakeEntityManifestCategory =
  | "worldspawn"
  | "player-start"
  | "pickup"
  | "monster"
  | "trigger"
  | "teleporter"
  | "exit"
  | "counter"
  | "secret"
  | "mover"
  | "brush"
  | "light"
  | "path"
  | "ambient"
  | "decor"
  | "multiplayer"
  | "unknown";

export type QuakeEntityRuntimeStatus = "active" | "metadata-only" | "ignored";

export interface QuakeEntityManifestEntry {
  entityIndex: number;
  classname: string;
  category: QuakeEntityManifestCategory;
  runtimeStatus: QuakeEntityRuntimeStatus;
  spawnflags: number;
  origin?: QuakeVertex;
  angle?: number;
  model?: string;
  modelIndex?: number;
  target?: string;
  targetname?: string;
  reason?: string;
}

export interface QuakeEntityManifestPoint {
  entityIndex: number;
  classname: string;
  origin: QuakeVertex;
  spawnflags: number;
  angle?: number;
  targetname?: string;
}

export interface QuakeEntityManifestBrush {
  entityIndex: number;
  classname: string;
  modelIndex?: number;
  spawnflags: number;
  target?: string;
  targetname?: string;
}

export interface QuakeEntityManifestMover extends QuakeEntityManifestBrush {
  speed?: number;
  wait?: number;
  lip?: number;
  height?: number;
}

export interface QuakeEntityManifestTrigger extends QuakeEntityManifestBrush {
  delay?: number;
  wait?: number;
  count?: number;
  dmg?: number;
  message?: string;
}

export interface QuakeEntityManifestTeleporter {
  entityIndex: number;
  modelIndex?: number;
  target: string;
  destinationEntityIndexes: number[];
}

export interface QuakeEntityManifestExit {
  entityIndex: number;
  modelIndex?: number;
  map?: string;
}

export interface QuakeEntityManifestLight {
  entityIndex: number;
  classname: string;
  origin: QuakeVertex;
  spawnflags: number;
  light?: number;
  style?: number;
  targetname?: string;
  delay?: number;
  wait?: number;
  mangle?: QuakeVertex;
  color?: RGB;
}

export interface QuakeEntityManifest {
  totals: {
    entities: number;
    active: number;
    metadataOnly: number;
    ignored: number;
    byClassname: Record<string, number>;
    byCategory: Record<string, number>;
  };
  entries: QuakeEntityManifestEntry[];
  starts: QuakeEntityManifestPoint[];
  pickups: QuakeEntityManifestPoint[];
  monsters: QuakeEntityManifestPoint[];
  triggers: QuakeEntityManifestTrigger[];
  movers: QuakeEntityManifestMover[];
  teleporters: QuakeEntityManifestTeleporter[];
  exits: QuakeEntityManifestExit[];
  lights: QuakeEntityManifestLight[];
  counters: QuakeEntityManifestTrigger[];
  secrets: QuakeEntityManifestTrigger[];
  inert: QuakeEntityManifestEntry[];
  runtime: QuakeEntityRuntimeManifest;
}

export interface QuakeEntityRuntimeManifest {
  targetEntities: Record<string, number[]>;
  triggerCounterCounts: Array<[number, number]>;
  damageableBrushEntityIndexes: number[];
  fireballEmitterEntityIndexes: number[];
  ambientEntityIndexes: number[];
  pickupEntityIndexes: number[];
  shootableEntityIndexes: number[];
  moverEntityIndexes: number[];
  moverSupportEntityIndexes: number[];
}

export interface QuakeVisibilityCandidate {
  faceIndex: number;
  sourceFaceIndices: number[];
}

interface QuakeFaceCandidate extends QuakeVisibilityCandidate {
  points: QuakeVertex[];
  polygon: Polygon;
}

interface QuakeFaceBuildCandidate {
  faceIndex: number;
  modelIndex: number;
  entityIndex?: number;
  points: QuakeVertex[];
  texture: QuakeMipTexture;
  texInfo: QuakeTexInfo;
  lightStyles: number[];
  brightness: number;
  lightstyleAnimation?: number;
  lightstyleFrameBrightnesses?: number[];
}

export interface QuakeBrushModel {
  faceIndices: number[];
  center: QuakeVertex;
}

interface QuakeSpawn {
  origin: QuakeVertex;
  angle: number;
}

export interface QuakeNode {
  plane: number;
  children: [number, number];
}

export interface QuakeClipNode {
  plane: number;
  children: [number, number];
}

export interface QuakeLeaf {
  contents: number;
  visOffset: number;
  firstMarkSurface: number;
  markSurfaceCount: number;
}

export interface QuakeVisibility {
  faceForPolygon: number[];
  leafIndexAt(point: Vec3): number;
  visibleLeavesAt(point: Vec3): Set<number> | null;
  visibleFacesAt(point: Vec3): Set<number> | null;
}

export type QuakeSerializedPolygon = Omit<Polygon, "texture"> & {
  texture?: number | string;
};

export interface QuakePreparedRenderBundle {
  version: 1;
  kind: "polycss-mesh";
  polycssVersion: string;
  textureLighting: "baked";
  textureQuality: 1;
  meshHtml: string;
  meshCss?: string;
  styleUrl?: string;
  styleClassName?: string;
  assetUrls: string[];
  leafMetadata: QuakeRenderBundleLeafMetadata[];
  leafFrameStyles?: QuakeRenderBundleLeafFrameStyle[];
  leafFrameStylesUrl?: string;
  leafFrameStylesIndex?: number;
  polygonCount: number;
  leafCount: number;
  atlasLeafCount: number;
}

export type QuakeRenderBundleLeafFrameStyle = [
  matrix: string,
  background?: string | null,
  extraStyle?: string | null,
];

export interface QuakeRenderBundleLeafMetadata {
  f: number;
  m?: number;
  e?: number;
  t?: string;
  l?: string;
}

export interface QuakePreparedVisibility {
  planes: QuakePlane[];
  nodes: QuakeNode[];
  leaves: QuakeLeaf[];
  markSurfaces: number[];
  visData: string;
  candidates: QuakeVisibilityCandidate[];
  brushModels: QuakeBrushModel[];
  pivot: QuakeVertex;
}

export interface QuakeCollisionHull {
  index: number;
  headNode: number;
  mins: QuakeVertex;
  maxs: QuakeVertex;
}

export interface QuakePreparedModel {
  index: number;
  mins: QuakeVertex;
  maxs: QuakeVertex;
  origin: QuakeVertex;
  headNodes: [number, number, number, number];
  hulls: QuakeCollisionHull[];
  firstFace: number;
  faceCount: number;
}

export type QuakeBrushCollisionKind = "solid" | "trigger";

export interface QuakePreparedBrushCollision {
  entityIndex: number;
  modelIndex: number;
  classname: string;
  kind: QuakeBrushCollisionKind;
  origin: QuakeVertex;
  mins: QuakeVertex;
  maxs: QuakeVertex;
  headNodes: [number, number, number, number];
  hulls: QuakeCollisionHull[];
  target?: string;
  targetname?: string;
}

export interface QuakePreparedCollision {
  planes: QuakePlane[];
  nodes?: QuakeNode[];
  leaves?: QuakeLeaf[];
  clipNodes: QuakeClipNode[];
  headNodes: [number, number, number, number];
  hulls: QuakeCollisionHull[];
  models: QuakePreparedModel[];
  brushModels: QuakePreparedBrushCollision[];
  pivot: QuakeVertex;
  runtime: QuakePreparedRuntimeCollision;
}

export interface QuakePreparedRuntimeCollision {
  groundGrid: QuakePreparedRuntimeGroundGrid;
  hullMinsZ: number;
  pointHeadNode?: number;
  planes: QuakePreparedRuntimeCollisionPlane[];
  brushes: QuakePreparedRuntimeCollisionBrush[];
  solidBrushIndexes: number[];
  triggerBrushIndexes: number[];
}

export interface QuakePreparedRuntimeGroundGrid {
  cellSize: number;
  height: number;
  nullSample: number;
  origin: [number, number];
  samples: string;
  width: number;
  zScale: number;
}

export interface QuakePreparedRuntimeCollisionPlane {
  normal: Vec3;
  dist: number;
}

export interface QuakePreparedRuntimeCollisionBrush {
  headNode: number;
  pointHeadNode?: number;
  kind: QuakeBrushCollisionKind;
  baseOffset: Vec3;
  entityIndex?: number;
  modelIndex: number;
  classname: string;
  target?: string;
  targetname?: string;
}

export interface QuakePreparedScene {
  version: 2;
  polygons?: QuakeSerializedPolygon[];
  textures?: string[];
  skyTexture?: number | string;
  renderBundle?: QuakePreparedRenderBundle;
  lightstyleRenderBundle?: QuakePreparedRenderBundle;
  textureCount: number;
  faceCount: number;
  sourceFaceCount: number;
  label: string;
  warnings: string[];
  entities: QuakeEntity[];
  entityManifest: QuakeEntityManifest;
  models?: QuakePreparedModel[];
  spawn: {
    origin: Vec3;
    groundZ: number;
    eyeHeight: number;
    rotX: number;
    rotY: number;
  };
  visibility?: QuakePreparedVisibility;
  collision?: QuakePreparedCollision;
}

export interface QuakeScene {
  polygons: Polygon[];
  skyTextureUrl?: string;
  renderBundle?: QuakePreparedRenderBundle;
  lightstyleRenderBundle?: QuakePreparedRenderBundle;
  textureCount: number;
  faceCount: number;
  sourceFaceCount: number;
  label: string;
  warnings: string[];
  entities: QuakeEntity[];
  entityManifest: QuakeEntityManifest;
  models: QuakePreparedModel[];
  spawn: {
    origin: Vec3;
    groundZ: number;
    eyeHeight: number;
    rotX: number;
    rotY: number;
  };
  visibility?: QuakeVisibility;
  collision?: QuakePreparedCollision;
}

const BSP_LUMP_ENTITIES = 0;
const BSP_LUMP_PLANES = 1;
const BSP_LUMP_TEXTURES = 2;
const BSP_LUMP_VERTICES = 3;
const BSP_LUMP_VISIBILITY = 4;
const BSP_LUMP_NODES = 5;
const BSP_LUMP_TEXINFO = 6;
const BSP_LUMP_FACES = 7;
const BSP_LUMP_LIGHTING = 8;
const BSP_LUMP_CLIPNODES = 9;
const BSP_LUMP_LEAVES = 10;
const BSP_LUMP_MARKSURFACES = 11;
const BSP_LUMP_EDGES = 12;
const BSP_LUMP_SURFEDGES = 13;
const BSP_LUMP_MODELS = 14;
const BSP_LUMP_COUNT = 15;
const BSP_HEADER_SIZE = 4 + BSP_LUMP_COUNT * 8;
const QUAKE_BSP_VERSION = 29;
const BSP_LUMP_NAMES = [
  "entities",
  "planes",
  "textures",
  "vertices",
  "visibility",
  "nodes",
  "texinfo",
  "faces",
  "lighting",
  "clipnodes",
  "leaves",
  "marksurfaces",
  "edges",
  "surfedges",
  "models",
] as const;
const BSP_FIXED_LUMP_RECORD_SIZES = new Map<number, number>([
  [BSP_LUMP_PLANES, 20],
  [BSP_LUMP_VERTICES, 12],
  [BSP_LUMP_NODES, 24],
  [BSP_LUMP_TEXINFO, 40],
  [BSP_LUMP_FACES, 20],
  [BSP_LUMP_CLIPNODES, 8],
  [BSP_LUMP_LEAVES, 28],
  [BSP_LUMP_MARKSURFACES, 2],
  [BSP_LUMP_EDGES, 4],
  [BSP_LUMP_SURFEDGES, 4],
  [BSP_LUMP_MODELS, 64],
]);
export const QUAKE_RENDER_SUPERSAMPLE = 1;
const QUAKE_UNIT_SCALE = 1 / 48;
const QUAKE_PLAYER_MINS_Z = -24;
const QUAKE_PLAYER_VIEW_Z = 22;
const QUAKE_EYE_HEIGHT = (QUAKE_PLAYER_VIEW_Z - QUAKE_PLAYER_MINS_Z) * QUAKE_UNIT_SCALE;
const QUAKE_COLLISION_HULL_DEFS: Array<{ mins: QuakeVertex; maxs: QuakeVertex }> = [
  { mins: { x: 0, y: 0, z: 0 }, maxs: { x: 0, y: 0, z: 0 } },
  { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 32 } },
  { mins: { x: -32, y: -32, z: -24 }, maxs: { x: 32, y: 32, z: 64 } },
  { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: -8 } },
];
const QUAKE_MAP_SPAWN_OVERRIDES = new Map<string, QuakeSpawn>([
  ["maps/e1m1.bsp", { origin: { x: 480, y: -40, z: 30 }, angle: 90 }],
]);
const QUAKE_GROUND_GRID_CELL_SIZE = 0.5;
const QUAKE_GROUND_GRID_Z_SCALE = 1 / 256;
const QUAKE_GROUND_GRID_NULL_SAMPLE = -32768;
const QUAKE_GROUND_GRID_MAX_CELLS = 180000;
const QUAKE_GROUND_WALKABLE_NORMAL_Z = 0.52;
const QUAKE_LIGHT_SAMPLE_SIZE = 16;
const QUAKE_LIGHT_MIN = 0.18;
const QUAKE_LIGHT_MAX = 1.45;
const QUAKE_LIGHT_BUCKETS = 128;
const QUAKE_LIGHT_SAMPLE_NORMAL_SCALE = 272 / 256;
const QUAKE_LIGHT_DISPLAY_GAMMA = 0.86;
const QUAKE_LIGHT_SMOOTHING_WEIGHT = 0.4;
const QUAKE_LIGHT_SMOOTHING_NORMAL_DOT = 0.999;
const QUAKE_LIGHT_SMOOTHING_PLANE_EPS = 0.5;
const QUAKE_LIGHT_SMOOTHING_TOUCH_EPS = 1.5;
const QUAKE_RENDER_COLLINEAR_EPS = 1e-6;
const QUAKE_LIGHTSTYLE_OVERLAY_STRENGTH = 0.72;
const QUAKE_LIGHTSTYLE_OVERLAY_GAMMA = 1.35;
const QUAKE_LIGHTSTYLE_OVERLAY_MAX_OPACITY = 0.52;
const QUAKE_LIGHTSTYLE_OVERLAY_OFFSET = 0.001;
const QUAKE_SKY_TRANSPARENT_INDEX = 0;
const QUAKE_PREPARED_SCENE_VERSION = 2;
export const QUAKE_LIGHT_STYLE_PATTERNS = new Map<number, string>([
  [0, "m"],
  [1, "mmnmmommommnonmmonqnmmo"],
  [2, "abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba"],
  [3, "mmmmmaaaaammmmmaaaaaabcdefgabcdefg"],
  [4, "mamamamamama"],
  [5, "jklmnopqrstuvwxyzyxwvutsrqponmlkj"],
  [6, "nmonqnmomnmomomno"],
  [7, "mmmaaaabcdefgmmmmaaaammmaamm"],
  [8, "mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa"],
  [9, "aaaaaaaazzzzzzzz"],
  [10, "mmamammmmammamamaaamammma"],
  [11, "abcdefghijklmnopqrrqponmlkjihgfedcba"],
]);

const REPEAT_WRAP = { s: "repeat", t: "repeat" } as const;

export async function createQuakeSceneFromPakFile(file: File): Promise<QuakeScene> {
  const buffer = await file.arrayBuffer();
  const prepared = await createQuakePreparedSceneFromPakBuffer(buffer);
  return createQuakeSceneFromPreparedScene(prepared);
}

export async function createQuakePreparedSceneFromPakBuffer(
  buffer: ArrayBuffer,
  options: { encodeTextureUrl?: QuakeTextureUrlEncoder; mapPath?: string } = {},
): Promise<QuakePreparedScene> {
  const entries = parseQuakePakDirectory(buffer);
  const palette = paletteFromPak(buffer, entries);
  const mapEntry = options.mapPath
    ? entries.find((entry) => entry.name === options.mapPath)
    : selectMapEntry(entries);
  if (!mapEntry) throw new Error(options.mapPath ? `No ${options.mapPath} entry found in this PAK.` : "No maps/*.bsp entry found in this PAK.");
  const bsp = quakePakEntryBytes(buffer, mapEntry).slice().buffer;
  return createQuakePreparedSceneFromBsp(
    bsp,
    palette,
    mapEntry.name,
    options.encodeTextureUrl ?? browserTextureUrlEncoder,
  );
}

export function createQuakeSceneFromPreparedScene(prepared: QuakePreparedScene): QuakeScene {
  if (prepared.version !== QUAKE_PREPARED_SCENE_VERSION) {
    throw new Error(`Unsupported Quake prepared scene version ${String(prepared.version)}.`);
  }
  const textures = prepared.textures ?? [];
  const polygons = (prepared.polygons ?? []).map((polygon) => hydratePreparedPolygon(polygon, textures));
  const skyTextureUrl = hydratePreparedTexture(prepared.skyTexture, textures);
  const entities = cloneEntities(prepared.entities ?? []);
  return {
    polygons,
    ...(skyTextureUrl ? { skyTextureUrl } : {}),
    ...(prepared.renderBundle ? { renderBundle: clonePreparedRenderBundle(prepared.renderBundle) } : {}),
    ...(prepared.lightstyleRenderBundle
      ? { lightstyleRenderBundle: clonePreparedRenderBundle(prepared.lightstyleRenderBundle) }
      : {}),
    textureCount: prepared.textureCount,
    faceCount: prepared.faceCount,
    sourceFaceCount: prepared.sourceFaceCount,
    label: prepared.label,
    warnings: [...prepared.warnings],
    entities,
    entityManifest: cloneEntityManifest(prepared.entityManifest),
    models: clonePreparedModels(prepared.models ?? prepared.collision?.models ?? []),
    spawn: {
      origin: [...prepared.spawn.origin],
      groundZ: prepared.spawn.groundZ,
      eyeHeight: prepared.spawn.eyeHeight,
      rotX: prepared.spawn.rotX,
      rotY: prepared.spawn.rotY,
    },
    visibility: prepared.visibility
      ? buildVisibility(
          prepared.visibility.planes,
          prepared.visibility.nodes,
          prepared.visibility.leaves,
          prepared.visibility.markSurfaces,
          base64ToBytes(prepared.visibility.visData),
          prepared.visibility.candidates,
          prepared.visibility.brushModels,
          prepared.visibility.pivot,
        )
      : undefined,
    collision: prepared.collision,
  };
}

function clonePreparedRenderBundle(renderBundle: QuakePreparedRenderBundle): QuakePreparedRenderBundle {
  return {
    ...renderBundle,
    assetUrls: [...renderBundle.assetUrls],
    leafMetadata: renderBundle.leafMetadata.map((leaf) => ({ ...leaf })),
    ...(renderBundle.leafFrameStyles ? {
      leafFrameStyles: renderBundle.leafFrameStyles.map((frameStyle) => [...frameStyle]),
    } : {}),
    ...(renderBundle.leafFrameStylesUrl ? { leafFrameStylesUrl: renderBundle.leafFrameStylesUrl } : {}),
    ...(renderBundle.leafFrameStylesIndex !== undefined ? {
      leafFrameStylesIndex: renderBundle.leafFrameStylesIndex,
    } : {}),
  };
}

export function buildQuakeLightstyleOverlayPolygons(polygons: Polygon[]): Polygon[] {
  const overlays: Polygon[] = [];
  for (const polygon of polygons) {
    const styleId = polygon.data?.["ls-anim"];
    const faceIndex = polygon.data?.["f"];
    if (styleId === undefined || faceIndex === undefined) continue;
    overlays.push({
      vertices: offsetQuakePolygonVertices(polygon.vertices, QUAKE_LIGHTSTYLE_OVERLAY_OFFSET),
      color: "#000000",
      data: {
        "f": faceIndex,
        ...(polygon.data?.["m"] !== undefined ? { "m": polygon.data["m"] } : {}),
        ...(polygon.data?.["e"] !== undefined ? { "e": polygon.data["e"] } : {}),
        "ls-overlay": true,
        "ls-anim": styleId,
        ...(polygon.data?.["ls-pattern"] !== undefined
          ? { "ls-pattern": polygon.data["ls-pattern"] }
          : {}),
      },
    });
  }
  return overlays;
}

function hydratePreparedTexture(texture: number | string | undefined, textures: string[]): string | undefined {
  return typeof texture === "number" ? textures[texture] : texture;
}

function hydratePreparedPolygon(polygon: QuakeSerializedPolygon, textures: string[]): Polygon {
  const { texture, data, ...rest } = polygon;
  const hydratedTexture = hydratePreparedTexture(texture, textures);
  const hydratedData = hydratePreparedPolygonData(data, textures);
  return {
    ...rest,
    ...(hydratedData ? { data: hydratedData } : {}),
    ...(hydratedTexture ? { texture: hydratedTexture } : {}),
  } as Polygon;
}

function hydratePreparedPolygonData(
  data: Polygon["data"] | undefined,
  textures: string[],
): Polygon["data"] | undefined {
  if (!data) return undefined;
  const hydrated = { ...data };
  const sprite = data["sprite"];
  if (typeof sprite === "number") {
    hydrated["sprite"] = textures[sprite];
  }
  return hydrated;
}

async function createQuakePreparedSceneFromBsp(
  buffer: ArrayBuffer,
  palette: RGB[],
  label: string,
  encodeTextureUrl: QuakeTextureUrlEncoder,
): Promise<QuakePreparedScene> {
  const view = new DataView(buffer);
  assertValidBspHeader(view);
  const version = view.getInt32(0, true);
  if (version !== QUAKE_BSP_VERSION) {
    throw new Error(`Unsupported BSP version ${version}; expected Quake BSP ${QUAKE_BSP_VERSION}.`);
  }
  validateBspLumps(view);

  const entitiesText = readLumpText(view, buffer, BSP_LUMP_ENTITIES);
  const entities = parseEntities(entitiesText);
  const sourceSpawn = parseSpawn(entities);
  const spawn = quakeGameplaySpawn(label, sourceSpawn);
  const rawVertices = parseVertices(view);
  const bounds = vertexBounds(rawVertices);
  const floorZ = sourceSpawn ? sourceSpawn.origin.z + QUAKE_PLAYER_MINS_Z : bounds.min.z;
  const pivot = sourceSpawn ? { x: sourceSpawn.origin.x, y: sourceSpawn.origin.y, z: floorZ } : {
    x: (bounds.min.x + bounds.max.x) * 0.5,
    y: (bounds.min.y + bounds.max.y) * 0.5,
    z: bounds.min.z,
  };
  const planes = parsePlanes(view);
  const textureUrls: string[] = [];
  const textures = await parseMipTextures(view, buffer, palette, textureUrls, encodeTextureUrl);
  const texInfos = parseTexInfos(view);
  const edges = parseEdges(view);
  const surfEdges = parseSurfEdges(view);
  const faces = parseFaces(view);
  const clipNodes = parseClipNodes(view);
  const nodes = parseNodes(view);
  const leaves = parseLeaves(view);
  const markSurfaces = parseMarkSurfaces(view);
  const visData = parseVisibility(view, buffer);
  const lighting = parseLighting(view, buffer);
  const models = parseModels(view);
  const preparedModels = buildPreparedModels(models);
  const faceModels = buildFaceModelIndices(models, faces.length);
  const entityByModel = buildEntityByModelIndex(entities);
  const entityByIndex = new Map(entities.map((entity) => [entity.index, entity]));
  const model = models[0] ?? {
    mins: bounds.min,
    maxs: bounds.max,
    origin: { x: 0, y: 0, z: 0 },
    headNodes: [0, 0, 0, 0],
    firstFace: 0,
    faceCount: faces.length,
  };
  const brushModels = visibleBrushModels(entities, models);
  const candidates: QuakeFaceCandidate[] = [];
  const buildCandidates: QuakeFaceBuildCandidate[] = [];
  const fallbackColorCache = new Map<string, string>();
  const litTextureCache = new Map<string, Promise<string> | string>();
  const skyTextureCache = new Map<string, Promise<string> | string>();
  const textureAnimationSpriteCache = new Map<string, Promise<string> | string>();
  let skyTextureUrl: string | undefined;
  const faceIndices = new Set<number>();
  const endFace = Math.min(faces.length, model.firstFace + model.faceCount);
  for (let faceIndex = model.firstFace; faceIndex < endFace; faceIndex++) {
    faceIndices.add(faceIndex);
  }
  for (const brushModel of brushModels) {
    for (const faceIndex of brushModel.faceIndices) faceIndices.add(faceIndex);
  }

  for (const faceIndex of [...faceIndices].sort((a, b) => a - b)) {
    const face = faces[faceIndex];
    if (!face) continue;
    const texInfo = texInfos[face.texInfo];
    if (!texInfo || texInfo.miptex < 0) continue;
    const texture = textures[texInfo.miptex];
    if (!texture) continue;

    const qPoints: QuakeVertex[] = [];
    for (let i = 0; i < face.edgeCount; i++) {
      const surfEdge = surfEdges[face.firstEdge + i];
      if (surfEdge === undefined) continue;
      const edge = edges[Math.abs(surfEdge)];
      if (!edge) continue;
      const vertexIndex = surfEdge >= 0 ? edge[0] : edge[1];
      const point = rawVertices[vertexIndex];
      if (point) qPoints.push(point);
    }

    const deduped = stabilizeFacePoints(dedupeFacePoints(qPoints));
    if (deduped.length < 3) continue;
    const oriented = stabilizeFacePoints(orientFacePoints(deduped, face, planes));
    if (oriented.length < 3) continue;
    const lightStyles = activeLightStyles(face.styles);
    const lightstyleAnimation = animatedLightStyle(lightStyles);
    const lightstyleFrameBrightnesses = lightstyleAnimation === undefined
      ? undefined
      : faceLightstyleFrameBrightnesses(face, oriented, texInfo, lighting, lightstyleAnimation);
    buildCandidates.push({
      faceIndex,
      modelIndex: faceModels[faceIndex] ?? 0,
      ...(entityByModel.get(faceModels[faceIndex] ?? 0) !== undefined
        ? { entityIndex: entityByModel.get(faceModels[faceIndex] ?? 0) }
        : {}),
      points: oriented,
      texture,
      texInfo,
      lightStyles,
      brightness: lightstyleFrameBrightnesses
        ? Math.max(...lightstyleFrameBrightnesses, QUAKE_LIGHT_MIN)
        : faceLightBrightness(face, oriented, texInfo, lighting),
      ...(lightstyleAnimation !== undefined ? { lightstyleAnimation } : {}),
      ...(lightstyleFrameBrightnesses ? { lightstyleFrameBrightnesses } : {}),
    });
  }

  const smoothedBrightness = smoothFaceBrightness(buildCandidates);
  for (const candidate of buildCandidates) {
    const texture = candidate.texture;
    const texInfo = candidate.texInfo;
    const isSky = quakeTextureIsSky(texture);
    if (isSky) {
      const textureUrl = await skyTextureUrlFor(texture, palette, textureUrls, skyTextureCache, encodeTextureUrl);
      skyTextureUrl ??= textureUrl;
      const polygon: Polygon = {
        vertices: candidate.points.map((point) => quakeToPoly(point, pivot)),
        texture: textureUrl,
        textureWrap: REPEAT_WRAP,
        textureAlphaMode: "opaque",
        color: litTextureFallbackColor(texture, 1, palette, fallbackColorCache),
        uvs: candidate.points.map((point) => textureUv(point, texInfo, texture)),
        data: {
          "tex": texture.name,
          "f": candidate.faceIndex,
          "m": candidate.modelIndex,
          ...(candidate.entityIndex !== undefined ? { "e": candidate.entityIndex } : {}),
        },
      };
      candidates.push({
        faceIndex: candidate.faceIndex,
        sourceFaceIndices: [candidate.faceIndex],
        points: candidate.points,
        polygon,
      });
      continue;
    }
    const brightness = smoothedBrightness.get(candidate.faceIndex) ?? candidate.brightness;
    const fallbackColor = litTextureFallbackColor(texture, brightness, palette, fallbackColorCache);
    const textureUrl = await litTextureUrlFor(texture, brightness, palette, textureUrls, litTextureCache, encodeTextureUrl);
    const vertices = candidate.points.map((point) => quakeToPoly(point, pivot));
    const uvs = candidate.points.map((point) => textureUv(point, texInfo, texture));
    const buttonPressedTextureUrl =
      candidate.entityIndex !== undefined && entityByIndex.get(candidate.entityIndex)?.classname === "func_button"
        ? await buttonPressedTextureUrlFor(
            texture,
            brightness,
            textures,
            palette,
            textureUrls,
            litTextureCache,
            encodeTextureUrl,
          )
        : undefined;
    const polygon: Polygon = {
      vertices,
      texture: textureUrl,
      textureWrap: REPEAT_WRAP,
      textureAlphaMode: "opaque",
      color: fallbackColor,
      uvs,
      data: {
        "tex": texture.name,
        "f": candidate.faceIndex,
        "m": candidate.modelIndex,
        ...(candidate.entityIndex !== undefined ? { "e": candidate.entityIndex } : {}),
        "lit": formatQuakeBrightness(brightness),
        ...(buttonPressedTextureUrl
          ? {
              "base": textureUrl,
              "pressed": buttonPressedTextureUrl,
            }
          : {}),
        ...lightstyleOverlayData(candidate, brightness),
        ...lightStyleData(candidate.lightStyles),
      },
    };
    candidates.push({
      faceIndex: candidate.faceIndex,
      sourceFaceIndices: [candidate.faceIndex],
      points: candidate.points,
      polygon,
    });
  }

  const sourceFaceCount = uniqueSorted(candidates.flatMap((candidate) => candidate.sourceFaceIndices)).length;
  const visibilityKeys = buildSourceFaceVisibilityKeys(planes, nodes, leaves, markSurfaces, visData, candidates, brushModels);
  const renderCandidates = mergeQuakeFaceCandidates(candidates, visibilityKeys);
  await addTextureAnimationSpritesToRenderCandidates(
    renderCandidates,
    textures,
    palette,
    textureAnimationSpriteCache,
    encodeTextureUrl,
  );
  const polygons = renderCandidates.map((candidate) => candidate.polygon);
  const serialized = serializePreparedPolygons(polygons, textureUrls);
  const skyTexture = skyTextureUrl ? serialized.textures.indexOf(skyTextureUrl) : -1;
  const warnings: string[] = [];
  if (polygons.length > 2500) {
    warnings.push(`Mounted ${polygons.length} merged BSP faces from ${sourceFaceCount} source faces; trigger brush volumes are excluded.`);
  }

  const angle = spawn?.angle ?? 90;
  const spawnGroundZ = spawn ? quakeSpawnGroundZToPoly(spawn.origin, pivot) : 0;
  const spawnState = {
    origin: spawn ? quakeSpawnOriginToPoly(spawn.origin, pivot) : [0, -6, QUAKE_EYE_HEIGHT],
    groundZ: spawnGroundZ,
    eyeHeight: QUAKE_EYE_HEIGHT,
    rotX: 90,
    rotY: (180 + angle + 360) % 360,
  } satisfies QuakeScene["spawn"];
  return {
    version: QUAKE_PREPARED_SCENE_VERSION,
    polygons: serialized.polygons,
    textures: serialized.textures,
    ...(skyTexture >= 0 ? { skyTexture } : {}),
    textureCount: textures.filter(Boolean).length,
    faceCount: polygons.length,
    sourceFaceCount,
    label,
    warnings,
    entities,
    entityManifest: buildEntityManifest(entities),
    models: preparedModels,
    spawn: spawnState,
    visibility: buildPreparedVisibility(planes, nodes, leaves, markSurfaces, visData, renderCandidates, brushModels, pivot),
    collision: buildPreparedCollision(
      planes,
      nodes,
      leaves,
      clipNodes,
      preparedModels,
      entities,
      model.headNodes,
      pivot,
      candidates.map((candidate) => candidate.polygon),
    ),
  };
}

function cloneEntities(entities: QuakeEntity[]): QuakeEntity[] {
  return entities.map((entity) => ({
    index: entity.index,
    classname: entity.classname,
    properties: { ...entity.properties },
    ...(entity.origin ? { origin: { ...entity.origin } } : {}),
    ...(entity.angle !== undefined ? { angle: entity.angle } : {}),
    ...(entity.model !== undefined ? { model: entity.model } : {}),
    ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
  }));
}


function clonePreparedModels(models: QuakePreparedModel[]): QuakePreparedModel[] {
  return models.map((model) => ({
    index: model.index,
    mins: { ...model.mins },
    maxs: { ...model.maxs },
    origin: { ...model.origin },
    headNodes: [...model.headNodes] as [number, number, number, number],
    hulls: model.hulls.map((hull) => ({
      index: hull.index,
      headNode: hull.headNode,
      mins: { ...hull.mins },
      maxs: { ...hull.maxs },
    })),
    firstFace: model.firstFace,
    faceCount: model.faceCount,
  }));
}

function serializePreparedPolygons(
  polygons: Polygon[],
  textureUrls: string[],
): { polygons: QuakeSerializedPolygon[]; textures: string[] } {
  const textures: string[] = [];
  const textureIndex = new Map<string, number>();
  const indexForTexture = (url: string): number => {
    const existing = textureIndex.get(url);
    if (existing !== undefined) return existing;
    const index = textures.length;
    textures.push(url);
    textureIndex.set(url, index);
    return index;
  };

  for (const url of textureUrls) indexForTexture(url);

  return {
    textures,
    polygons: polygons.map((polygon) => {
      const { texture, data, ...rest } = polygon;
      const serializedData = serializePreparedPolygonData(data, indexForTexture);
      if (!texture) {
        return {
          ...rest,
          ...(serializedData ? { data: serializedData } : {}),
        } as QuakeSerializedPolygon;
      }
      return {
        ...rest,
        ...(serializedData ? { data: serializedData } : {}),
        texture: indexForTexture(texture),
      };
    }),
  };
}

function serializePreparedPolygonData(
  data: Polygon["data"] | undefined,
  indexForTexture: (url: string) => number,
): Polygon["data"] | undefined {
  if (!data) return undefined;
  const serialized = { ...data };
  const sprite = data["sprite"];
  if (typeof sprite === "string") {
    serialized["sprite"] = indexForTexture(sprite);
  }
  return serialized;
}

function buildPreparedVisibility(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  markSurfaces: number[],
  visData: Uint8Array,
  candidates: QuakeVisibilityCandidate[],
  brushModels: QuakeBrushModel[],
  pivot: QuakeVertex,
): QuakePreparedVisibility | undefined {
  if (!planes.length || !nodes.length || !leaves.length) return undefined;
  return {
    planes,
    nodes,
    leaves,
    markSurfaces,
    visData: bytesToBase64(visData),
    candidates: candidates.map((candidate) => ({
      faceIndex: candidate.faceIndex,
      sourceFaceIndices: [...candidate.sourceFaceIndices],
    })),
    brushModels,
    pivot,
  };
}

function buildPreparedModels(models: QuakeModel[]): QuakePreparedModel[] {
  return models.map((model, index) => ({
    index,
    mins: { ...model.mins },
    maxs: { ...model.maxs },
    origin: { ...model.origin },
    headNodes: [...model.headNodes] as [number, number, number, number],
    hulls: hullsForHeadNodes(model.headNodes),
    firstFace: model.firstFace,
    faceCount: model.faceCount,
  }));
}

function buildFaceModelIndices(models: QuakeModel[], faceCount: number): number[] {
  const out = Array.from({ length: faceCount }, () => 0);
  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];
    if (!model) continue;
    const end = Math.min(faceCount, model.firstFace + model.faceCount);
    for (let faceIndex = model.firstFace; faceIndex < end; faceIndex++) out[faceIndex] = modelIndex;
  }
  return out;
}

function buildEntityByModelIndex(entities: QuakeEntity[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const entity of entities) {
    if (entity.modelIndex === undefined) continue;
    if (!out.has(entity.modelIndex)) out.set(entity.modelIndex, entity.index);
  }
  return out;
}

function buildPreparedCollision(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  clipNodes: QuakeClipNode[],
  models: QuakePreparedModel[],
  entities: QuakeEntity[],
  headNodes: [number, number, number, number],
  pivot: QuakeVertex,
  facePolygons: Polygon[],
): QuakePreparedCollision | undefined {
  if (!planes.length || !clipNodes.length) return undefined;
  const worldModel = models[0];
  const preparedHeadNodes = [...(worldModel?.headNodes ?? headNodes)] as [number, number, number, number];
  const preparedHulls = worldModel ? cloneHulls(worldModel.hulls) : hullsForHeadNodes(headNodes);
  const brushModels = buildPreparedBrushCollisionModels(entities, models);
  return {
    planes,
    nodes,
    leaves,
    clipNodes,
    headNodes: preparedHeadNodes,
    hulls: preparedHulls,
    models: clonePreparedModels(models),
    brushModels,
    pivot,
    runtime: buildPreparedRuntimeCollision(
      planes,
      nodes,
      leaves,
      clipNodes,
      preparedHeadNodes,
      preparedHulls,
      brushModels,
      pivot,
      facePolygons,
    ),
  };
}

function buildPreparedRuntimeCollision(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  clipNodes: QuakeClipNode[],
  headNodes: [number, number, number, number],
  hulls: QuakeCollisionHull[],
  brushModels: QuakePreparedBrushCollision[],
  pivot: QuakeVertex,
  facePolygons: Polygon[],
): QuakePreparedRuntimeCollision {
  const playerHull = hulls.find((item) => item.index === 1);
  const playerHeadNode = playerHull?.headNode ?? headNodes[1];
  const pointHeadNode = validPreparedPointHeadNode(headNodes[0], nodes, leaves) ? headNodes[0] : undefined;
  const groundGrid = buildPreparedRuntimeGroundGrid(facePolygons);
  if (!groundGrid) throw new Error("Prepared collision requires a static ground grid.");
  const brushes: QuakePreparedRuntimeCollisionBrush[] = [{
    headNode: playerHeadNode,
    ...(pointHeadNode !== undefined ? { pointHeadNode } : {}),
    kind: "solid",
    baseOffset: [0, 0, 0],
    modelIndex: 0,
    classname: "worldspawn",
  }];
  const solidBrushIndexes = [0];
  const triggerBrushIndexes: number[] = [];

  for (const brushModel of brushModels) {
    const brushHull = brushModel.hulls.find((item) => item.index === 1);
    const brushHeadNode = brushHull?.headNode ?? brushModel.headNodes[1];
    if (!Number.isInteger(brushHeadNode) || brushHeadNode < 0 || brushHeadNode >= clipNodes.length) continue;
    const brushPointHeadNode = validPreparedPointHeadNode(brushModel.headNodes[0], nodes, leaves)
      ? brushModel.headNodes[0]
      : undefined;
    const index = brushes.length;
    brushes.push({
      headNode: brushHeadNode,
      ...(brushPointHeadNode !== undefined ? { pointHeadNode: brushPointHeadNode } : {}),
      kind: brushModel.kind,
      baseOffset: quakeDeltaToPoly(brushModel.origin),
      entityIndex: brushModel.entityIndex,
      modelIndex: brushModel.modelIndex,
      classname: brushModel.classname,
      ...(brushModel.target ? { target: brushModel.target } : {}),
      ...(brushModel.targetname ? { targetname: brushModel.targetname } : {}),
    });
    if (brushModel.kind === "trigger") {
      triggerBrushIndexes.push(index);
    } else {
      solidBrushIndexes.push(index);
    }
  }

  return {
    groundGrid,
    hullMinsZ: (playerHull?.mins.z ?? -24) * QUAKE_UNIT_SCALE,
    ...(pointHeadNode !== undefined ? { pointHeadNode } : {}),
    planes: planes.map((plane) => ({
      normal: [plane.normal.x, plane.normal.y, plane.normal.z],
      dist: (
        plane.dist -
        plane.normal.x * pivot.x -
        plane.normal.y * pivot.y -
        plane.normal.z * pivot.z
      ) * QUAKE_UNIT_SCALE,
    })),
    brushes,
    solidBrushIndexes,
    triggerBrushIndexes,
  };
}

interface QuakeGroundGridSurface {
  anchor: Vec3;
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  normal: Vec3;
  vertices: Vec3[];
}

function buildPreparedRuntimeGroundGrid(polygons: Polygon[]): QuakePreparedRuntimeGroundGrid | undefined {
  const surfaces = polygons
    .map((polygon) => quakeGroundGridSurface(polygon))
    .filter((surface): surface is QuakeGroundGridSurface => Boolean(surface));
  if (!surfaces.length) return undefined;

  const minX = Math.floor(Math.min(...surfaces.map((surface) => surface.minX)) / QUAKE_GROUND_GRID_CELL_SIZE) *
    QUAKE_GROUND_GRID_CELL_SIZE;
  const minY = Math.floor(Math.min(...surfaces.map((surface) => surface.minY)) / QUAKE_GROUND_GRID_CELL_SIZE) *
    QUAKE_GROUND_GRID_CELL_SIZE;
  const maxX = Math.ceil(Math.max(...surfaces.map((surface) => surface.maxX)) / QUAKE_GROUND_GRID_CELL_SIZE) *
    QUAKE_GROUND_GRID_CELL_SIZE;
  const maxY = Math.ceil(Math.max(...surfaces.map((surface) => surface.maxY)) / QUAKE_GROUND_GRID_CELL_SIZE) *
    QUAKE_GROUND_GRID_CELL_SIZE;
  const width = Math.max(1, Math.floor((maxX - minX) / QUAKE_GROUND_GRID_CELL_SIZE) + 1);
  const height = Math.max(1, Math.floor((maxY - minY) / QUAKE_GROUND_GRID_CELL_SIZE) + 1);
  if (width * height > QUAKE_GROUND_GRID_MAX_CELLS) return undefined;

  const samples = new Int16Array(width * height);
  samples.fill(QUAKE_GROUND_GRID_NULL_SAMPLE);
  for (const surface of surfaces) {
    const startX = Math.max(0, Math.floor((surface.minX - minX) / QUAKE_GROUND_GRID_CELL_SIZE));
    const endX = Math.min(width - 1, Math.ceil((surface.maxX - minX) / QUAKE_GROUND_GRID_CELL_SIZE));
    const startY = Math.max(0, Math.floor((surface.minY - minY) / QUAKE_GROUND_GRID_CELL_SIZE));
    const endY = Math.min(height - 1, Math.ceil((surface.maxY - minY) / QUAKE_GROUND_GRID_CELL_SIZE));
    for (let row = startY; row <= endY; row++) {
      const y = minY + row * QUAKE_GROUND_GRID_CELL_SIZE;
      for (let column = startX; column <= endX; column++) {
        const x = minX + column * QUAKE_GROUND_GRID_CELL_SIZE;
        if (!pointInQuakePolygon2(x, y, surface.vertices)) continue;
        const z = quakeGroundGridZOnPlane(x, y, surface);
        if (!Number.isFinite(z)) continue;
        const sample = Math.max(
          QUAKE_GROUND_GRID_NULL_SAMPLE + 1,
          Math.min(32767, Math.round(z / QUAKE_GROUND_GRID_Z_SCALE)),
        );
        const index = row * width + column;
        if (samples[index] === QUAKE_GROUND_GRID_NULL_SAMPLE || sample > samples[index]) {
          samples[index] = sample;
        }
      }
    }
  }

  if (!samples.some((sample) => sample !== QUAKE_GROUND_GRID_NULL_SAMPLE)) return undefined;
  return {
    cellSize: QUAKE_GROUND_GRID_CELL_SIZE,
    height,
    nullSample: QUAKE_GROUND_GRID_NULL_SAMPLE,
    origin: [minX, minY],
    samples: int16SamplesToBase64(samples),
    width,
    zScale: QUAKE_GROUND_GRID_Z_SCALE,
  };
}

function quakeGroundGridSurface(polygon: Polygon): QuakeGroundGridSurface | null {
  const data = polygon.data ?? {};
  if (data["e"] !== undefined || Number(data["m"] ?? 0) !== 0) return null;
  if (String(data["tex"] ?? "").startsWith("*")) return null;
  const vertices = polygon.vertices;
  if (vertices.length < 3) return null;
  const normal = quakePolygonNormal(vertices);
  if (normal[2] <= QUAKE_GROUND_WALKABLE_NORMAL_Z) return null;
  const bounds = quakeGroundGridBounds2(vertices);
  return {
    anchor: vertices[0] ?? [0, 0, 0],
    normal,
    vertices,
    ...bounds,
  };
}

function quakeGroundGridBounds2(vertices: Vec3[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex[0]);
    maxX = Math.max(maxX, vertex[0]);
    minY = Math.min(minY, vertex[1]);
    maxY = Math.max(maxY, vertex[1]);
  }
  return { minX, maxX, minY, maxY };
}

function quakeGroundGridZOnPlane(x: number, y: number, surface: QuakeGroundGridSurface): number {
  const normalZ = surface.normal[2];
  if (Math.abs(normalZ) < QUAKE_RENDER_COLLINEAR_EPS) return NaN;
  return surface.anchor[2] - (
    surface.normal[0] * (x - surface.anchor[0]) +
    surface.normal[1] * (y - surface.anchor[1])
  ) / normalZ;
}

function pointInQuakePolygon2(x: number, y: number, vertices: Vec3[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (!a || !b) continue;
    const intersects = (a[1] > y) !== (b[1] > y) &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function int16SamplesToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index++) {
    view.setInt16(index * 2, samples[index] ?? QUAKE_GROUND_GRID_NULL_SAMPLE, true);
  }
  return bytesToBase64(bytes);
}

function validPreparedPointHeadNode(
  headNode: number | undefined,
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
): headNode is number {
  return Number.isInteger(headNode) && headNode >= 0 && nodes.length > 0 && leaves.length > 0 && headNode < nodes.length;
}

function buildPreparedBrushCollisionModels(
  entities: QuakeEntity[],
  models: QuakePreparedModel[],
): QuakePreparedBrushCollision[] {
  const out: QuakePreparedBrushCollision[] = [];
  for (const entity of entities) {
    if (entity.modelIndex === undefined) continue;
    const kind = brushCollisionKind(entity.classname);
    if (!kind) continue;
    const model = models[entity.modelIndex];
    if (!model) continue;
    out.push({
      entityIndex: entity.index,
      modelIndex: model.index,
      classname: entity.classname,
      kind,
      origin: entity.origin ? { ...entity.origin } : { x: 0, y: 0, z: 0 },
      mins: { ...model.mins },
      maxs: { ...model.maxs },
      headNodes: [...model.headNodes] as [number, number, number, number],
      hulls: cloneHulls(model.hulls),
      ...(entity.properties.target ? { target: entity.properties.target } : {}),
      ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
    });
  }
  return out;
}

function cloneHulls(hulls: QuakeCollisionHull[]): QuakeCollisionHull[] {
  return hulls.map((hull) => ({
    index: hull.index,
    headNode: hull.headNode,
    mins: { ...hull.mins },
    maxs: { ...hull.maxs },
  }));
}

function hullsForHeadNodes(headNodes: [number, number, number, number]): QuakeCollisionHull[] {
  return QUAKE_COLLISION_HULL_DEFS.map((hull, index) => ({
    index,
    headNode: headNodes[index] ?? 0,
    mins: { ...hull.mins },
    maxs: { ...hull.maxs },
  }));
}

function brushCollisionKind(classname: string): QuakeBrushCollisionKind | null {
  if (classname.startsWith("trigger_")) return "trigger";
  if (classname === "func_illusionary") return null;
  if (classname.startsWith("func_")) return "solid";
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  const buffer = (globalThis as { Buffer?: { from(bytes: Uint8Array): { toString(encoding: string): string } } }).Buffer;
  if (buffer) return buffer.from(bytes).toString("base64");
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const buffer = (globalThis as { Buffer?: { from(value: string, encoding: string): Uint8Array } }).Buffer;
  if (buffer) return new Uint8Array(buffer.from(value, "base64"));
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function selectMapEntry(entries: QuakePakEntry[]): QuakePakEntry | undefined {
  const maps = entries.filter((entry) => /^maps\/.+\.bsp$/.test(entry.name));
  return maps.find((entry) => entry.name === "maps/e1m1.bsp") ??
    maps.find((entry) => entry.name === "maps/start.bsp") ??
    maps[0];
}

function paletteFromPak(buffer: ArrayBuffer, entries: QuakePakEntry[]): RGB[] {
  const entry = entries.find((item) => item.name === "gfx/palette.lmp");
  if (!entry || entry.size < 768) return defaultPalette();
  const bytes = quakePakEntryBytes(buffer, entry);
  const palette: RGB[] = [];
  for (let i = 0; i < 256; i++) {
    palette.push([bytes[i * 3] ?? 0, bytes[i * 3 + 1] ?? 0, bytes[i * 3 + 2] ?? 0]);
  }
  return palette;
}

function defaultPalette(): RGB[] {
  return Array.from({ length: 256 }, (_, index) => [index, index, index] as RGB);
}

function parseMipTextures(
  view: DataView,
  buffer: ArrayBuffer,
  palette: RGB[],
  urls: string[],
  encodeTextureUrl: QuakeTextureUrlEncoder,
): Promise<Array<QuakeMipTexture | null>> {
  const lump = bspLump(view, BSP_LUMP_TEXTURES);
  const count = view.getInt32(lump.offset, true);
  const tasks: Array<Promise<QuakeMipTexture | null>> = [];
  for (let i = 0; i < count; i++) {
    const relative = view.getInt32(lump.offset + 4 + i * 4, true);
    if (relative < 0) {
      tasks.push(Promise.resolve(null));
      continue;
    }

    const base = lump.offset + relative;
    const name = readFixedAscii(view, base, 16);
    const width = view.getUint32(base + 16, true);
    const height = view.getUint32(base + 20, true);
    const mip0 = view.getUint32(base + 24, true);
    if (!width || !height || base + mip0 + width * height > buffer.byteLength) {
      tasks.push(Promise.resolve(null));
      continue;
    }
    const pixels = new Uint8Array(buffer, base + mip0, width * height).slice();
    tasks.push(indexedPixelsToTextureUrl(width, height, pixels, palette, 1, encodeTextureUrl).then((url) => {
      urls.push(url);
      return { name, width, height, pixels, url };
    }));
  }
  return Promise.all(tasks);
}

function parseVertices(view: DataView): QuakeVertex[] {
  const lump = bspLump(view, BSP_LUMP_VERTICES);
  const vertices: QuakeVertex[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 12) {
    vertices.push({
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
    });
  }
  return vertices;
}

function parsePlanes(view: DataView): QuakePlane[] {
  const lump = bspLump(view, BSP_LUMP_PLANES);
  const planes: QuakePlane[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 20) {
    planes.push({
      normal: {
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 4, true),
        z: view.getFloat32(offset + 8, true),
      },
      dist: view.getFloat32(offset + 12, true),
    });
  }
  return planes;
}

function parseTexInfos(view: DataView): QuakeTexInfo[] {
  const lump = bspLump(view, BSP_LUMP_TEXINFO);
  const texInfos: QuakeTexInfo[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 40) {
    texInfos.push({
      s: [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
        view.getFloat32(offset + 12, true),
      ],
      t: [
        view.getFloat32(offset + 16, true),
        view.getFloat32(offset + 20, true),
        view.getFloat32(offset + 24, true),
        view.getFloat32(offset + 28, true),
      ],
      miptex: view.getInt32(offset + 32, true),
    });
  }
  return texInfos;
}

function parseVisibility(view: DataView, buffer: ArrayBuffer): Uint8Array {
  const lump = bspLump(view, BSP_LUMP_VISIBILITY);
  return new Uint8Array(buffer, lump.offset, lump.length);
}

function parseLighting(view: DataView, buffer: ArrayBuffer): Uint8Array {
  const lump = bspLump(view, BSP_LUMP_LIGHTING);
  return new Uint8Array(buffer, lump.offset, lump.length);
}

function parseNodes(view: DataView): QuakeNode[] {
  const lump = bspLump(view, BSP_LUMP_NODES);
  const nodes: QuakeNode[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 24) {
    nodes.push({
      plane: view.getUint32(offset, true),
      children: [
        view.getInt16(offset + 4, true),
        view.getInt16(offset + 6, true),
      ],
    });
  }
  return nodes;
}

function parseEdges(view: DataView): Array<[number, number]> {
  const lump = bspLump(view, BSP_LUMP_EDGES);
  const edges: Array<[number, number]> = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 4) {
    edges.push([view.getUint16(offset, true), view.getUint16(offset + 2, true)]);
  }
  return edges;
}

function parseSurfEdges(view: DataView): number[] {
  const lump = bspLump(view, BSP_LUMP_SURFEDGES);
  const surfEdges: number[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 4) {
    surfEdges.push(view.getInt32(offset, true));
  }
  return surfEdges;
}

function parseFaces(view: DataView): QuakeFace[] {
  const lump = bspLump(view, BSP_LUMP_FACES);
  const faces: QuakeFace[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 20) {
    faces.push({
      plane: view.getUint16(offset, true),
      side: view.getUint16(offset + 2, true),
      firstEdge: view.getInt32(offset + 4, true),
      edgeCount: view.getUint16(offset + 8, true),
      texInfo: view.getUint16(offset + 10, true),
      styles: [
        view.getUint8(offset + 12),
        view.getUint8(offset + 13),
        view.getUint8(offset + 14),
        view.getUint8(offset + 15),
      ],
      lightOffset: view.getInt32(offset + 16, true),
    });
  }
  return faces;
}

function parseClipNodes(view: DataView): QuakeClipNode[] {
  const lump = bspLump(view, BSP_LUMP_CLIPNODES);
  const clipNodes: QuakeClipNode[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 8) {
    clipNodes.push({
      plane: view.getInt32(offset, true),
      children: [
        view.getInt16(offset + 4, true),
        view.getInt16(offset + 6, true),
      ],
    });
  }
  return clipNodes;
}

function parseLeaves(view: DataView): QuakeLeaf[] {
  const lump = bspLump(view, BSP_LUMP_LEAVES);
  const leaves: QuakeLeaf[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 28) {
    leaves.push({
      contents: view.getInt32(offset, true),
      visOffset: view.getInt32(offset + 4, true),
      firstMarkSurface: view.getUint16(offset + 20, true),
      markSurfaceCount: view.getUint16(offset + 22, true),
    });
  }
  return leaves;
}

function parseMarkSurfaces(view: DataView): number[] {
  const lump = bspLump(view, BSP_LUMP_MARKSURFACES);
  const markSurfaces: number[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 2) {
    markSurfaces.push(view.getUint16(offset, true));
  }
  return markSurfaces;
}

function parseModels(view: DataView): QuakeModel[] {
  const lump = bspLump(view, BSP_LUMP_MODELS);
  const models: QuakeModel[] = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 64) {
    models.push({
      mins: {
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 4, true),
        z: view.getFloat32(offset + 8, true),
      },
      maxs: {
        x: view.getFloat32(offset + 12, true),
        y: view.getFloat32(offset + 16, true),
        z: view.getFloat32(offset + 20, true),
      },
      origin: {
        x: view.getFloat32(offset + 24, true),
        y: view.getFloat32(offset + 28, true),
        z: view.getFloat32(offset + 32, true),
      },
      headNodes: [
        view.getInt32(offset + 36, true),
        view.getInt32(offset + 40, true),
        view.getInt32(offset + 44, true),
        view.getInt32(offset + 48, true),
      ],
      firstFace: view.getInt32(offset + 56, true),
      faceCount: view.getInt32(offset + 60, true),
    });
  }
  return models;
}

function parseEntities(entitiesText: string): QuakeEntity[] {
  const blocks = entitiesText.match(/\{[\s\S]*?\}/g) ?? [];
  return blocks.map((block, index) => {
    const properties: QuakeEntityProperties = {};
    const tokens = [...block.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
    for (let i = 0; i < tokens.length; i += 2) {
      const key = tokens[i];
      if (!key) continue;
      properties[key] = tokens[i + 1] ?? "";
    }

    const model = properties.model;
    const modelIndex = modelIndexFromEntityModel(model);
    const origin = parseQuakeVector(properties.origin);
    const angle = parseFiniteNumber(properties.angle);
    return {
      index,
      classname: properties.classname ?? "",
      properties,
      ...(origin ? { origin } : {}),
      ...(angle !== null ? { angle } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(modelIndex !== null ? { modelIndex } : {}),
    };
  });
}

function visibleBrushModels(entities: QuakeEntity[], models: QuakeModel[]): QuakeBrushModel[] {
  const brushModels: QuakeBrushModel[] = [];
  for (const entity of entities) {
    const classname = entity.classname;
    if (!isVisibleBrushEntity(classname)) continue;
    if (entity.modelIndex === undefined) continue;
    const model = models[entity.modelIndex];
    if (!model) continue;
    const faceIndices: number[] = [];
    for (let i = 0; i < model.faceCount; i++) faceIndices.push(model.firstFace + i);
    const origin = entity.origin ?? { x: 0, y: 0, z: 0 };
    brushModels.push({
      faceIndices,
      center: {
        x: (model.mins.x + model.maxs.x) * 0.5 + origin.x,
        y: (model.mins.y + model.maxs.y) * 0.5 + origin.y,
        z: (model.mins.z + model.maxs.z) * 0.5 + origin.z,
      },
    });
  }
  return brushModels;
}

function isVisibleBrushEntity(classname: string): boolean {
  return classname.startsWith("func_");
}

function quakeGameplaySpawn(label: string, sourceSpawn: QuakeSpawn | null): QuakeSpawn | null {
  return QUAKE_MAP_SPAWN_OVERRIDES.get(label) ?? sourceSpawn;
}

function quakeSpawnOriginToPoly(origin: QuakeVertex, pivot: QuakeVertex): Vec3 {
  const groundZ = quakeSpawnGroundZToPoly(origin, pivot);
  return [
    (origin.x - pivot.x) * QUAKE_UNIT_SCALE,
    (origin.y - pivot.y) * QUAKE_UNIT_SCALE,
    groundZ + QUAKE_EYE_HEIGHT,
  ];
}

function quakeSpawnGroundZToPoly(origin: QuakeVertex, pivot: QuakeVertex): number {
  return (origin.z + QUAKE_PLAYER_MINS_Z - pivot.z) * QUAKE_UNIT_SCALE;
}

function parseSpawn(entities: QuakeEntity[]): QuakeSpawn | null {
  for (const entity of entities) {
    if (entity.classname !== "info_player_start") continue;
    const origin = entity.origin;
    if (!origin) continue;
    const angle = entity.angle ?? 90;
    return {
      origin,
      angle: Number.isFinite(angle) ? angle : 90,
    };
  }
  return null;
}

function modelIndexFromEntityModel(model: string | undefined): number | null {
  const match = model?.match(/^\*(\d+)$/);
  return match ? Number(match[1]) : null;
}

function parseQuakeVector(value: string | undefined): QuakeVertex | null {
  if (!value) return null;
  const [x, y, z] = value.trim().split(/\s+/).map(Number);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x: x ?? 0, y: y ?? 0, z: z ?? 0 };
}

function parseFiniteNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readLumpText(view: DataView, buffer: ArrayBuffer, index: number): string {
  const lump = bspLump(view, index);
  return new TextDecoder("ascii").decode(new Uint8Array(buffer, lump.offset, lump.length));
}

function assertValidBspHeader(view: DataView): void {
  if (view.byteLength < BSP_HEADER_SIZE) {
    throw new Error(`Invalid BSP header: ${view.byteLength} bytes; expected at least ${BSP_HEADER_SIZE}.`);
  }
}

function validateBspLumps(view: DataView): void {
  for (let index = 0; index < BSP_LUMP_COUNT; index++) bspLump(view, index);
}

function bspLump(view: DataView, index: number): { offset: number; length: number } {
  if (index < 0 || index >= BSP_LUMP_COUNT) throw new Error(`Invalid BSP lump ${index}.`);
  const offset = view.getInt32(4 + index * 8, true);
  const length = view.getInt32(8 + index * 8, true);
  const name = bspLumpName(index);
  if (offset < 0 || length < 0 || offset > view.byteLength || length > view.byteLength - offset) {
    throw new Error(`Invalid BSP ${name} lump bounds: offset ${offset}, length ${length}, file size ${view.byteLength}.`);
  }
  const recordSize = BSP_FIXED_LUMP_RECORD_SIZES.get(index);
  if (recordSize !== undefined && length % recordSize !== 0) {
    throw new Error(`Invalid BSP ${name} lump size ${length}; expected a multiple of ${recordSize} bytes.`);
  }
  return { offset, length };
}

function bspLumpName(index: number): string {
  return BSP_LUMP_NAMES[index] ?? `lump ${index}`;
}

function dedupeFacePoints(points: QuakeVertex[]): QuakeVertex[] {
  const out: QuakeVertex[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && samePoint(previous, point)) continue;
    out.push(point);
  }
  if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
  return out;
}

function stabilizeFacePoints(points: QuakeVertex[]): QuakeVertex[] {
  if (points.length < 4 || faceFirstTripleAreaSq(points) > 0.000001) return points;
  for (let i = 1; i < points.length; i++) {
    const rotated = [...points.slice(i), ...points.slice(0, i)];
    if (faceFirstTripleAreaSq(rotated) > 0.000001) return rotated;
  }
  return points;
}

function mergeQuakeFaceCandidates(
  candidates: QuakeFaceCandidate[],
  visibilityKeys: Map<number, string>,
): QuakeFaceCandidate[] {
  const groups = new Map<string, QuakeFaceCandidate[]>();
  for (const candidate of candidates) {
    const key = quakeMergeGroupKey(candidate, visibilityKeys);
    const group = groups.get(key);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(key, [candidate]);
    }
  }

  const out: QuakeFaceCandidate[] = [];
  const renderDedupe = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) {
      pushRenderCandidate(out, group[0].polygon, group[0].sourceFaceIndices, {}, renderDedupe);
      continue;
    }

    const merged = mergePolygons(group.map((candidate) => polygonForMerge(candidate.polygon)));
    if (merged.length >= group.length) {
      for (const candidate of group) {
        pushRenderCandidate(out, candidate.polygon, candidate.sourceFaceIndices, {}, renderDedupe);
      }
      continue;
    }

    const sourceFaceIndices = uniqueSorted(group.flatMap((candidate) => candidate.sourceFaceIndices));
    const fallbackData = quakeFallbackData(group[0].polygon);
    for (const polygon of merged) {
      pushRenderCandidate(out, polygon, sourceFaceIndices, fallbackData, renderDedupe);
    }
  }
  return out;
}

async function addTextureAnimationSpritesToRenderCandidates(
  candidates: QuakeFaceCandidate[],
  textures: Array<QuakeMipTexture | null>,
  palette: RGB[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
): Promise<void> {
  const textureByName = new Map<string, QuakeMipTexture>();
  for (const texture of textures) {
    if (texture) textureByName.set(texture.name.toLowerCase(), texture);
  }

  for (const candidate of candidates) {
    const data = candidate.polygon.data;
    const textureName = typeof data?.["tex"] === "string" ? data["tex"] : "";
    const texture = textureByName.get(textureName.toLowerCase());
    if (!texture || !textureAnimationFrameTextures(texture, textures)) continue;
    const brightnessValue = typeof data?.["lit"] === "string"
      ? parseFiniteNumber(data["lit"])
      : typeof data?.["lit"] === "number"
        ? data["lit"]
        : null;
    const animation = await textureAnimationSpriteFor(
      candidate.polygon,
      texture,
      brightnessValue ?? 1,
      textures,
      palette,
      cache,
      encodeTextureUrl,
    );
    if (!animation) continue;
    candidate.polygon.data = {
      ...candidate.polygon.data,
      "sprite": animation.sprite,
      "frames": animation.frameCount,
    };
  }
}

function quakeMergeGroupKey(candidate: QuakeFaceCandidate, visibilityKeys: Map<number, string>): string {
  const polygon = candidate.polygon;
  if (quakePolygonIsSky(polygon)) {
    return [
      "sky",
      polygon.texture ?? "",
      polygon.color ?? "",
      polygon.textureWrap?.s ?? "",
      polygon.textureWrap?.t ?? "",
      polygon.textureAlphaMode ?? "",
      polygon.doubleSided === true ? "double" : "single",
      String(polygon.data?.["tex"] ?? ""),
      String(polygon.data?.["m"] ?? ""),
      String(polygon.data?.["e"] ?? ""),
    ].join("\u001f");
  }
  return [
    visibilityKeys.get(candidate.faceIndex) ?? `face:${candidate.faceIndex}`,
    polygon.texture ?? "",
    polygon.color ?? "",
    polygon.textureWrap?.s ?? "",
    polygon.textureWrap?.t ?? "",
    polygon.textureAlphaMode ?? "",
    polygon.doubleSided === true ? "double" : "single",
    String(polygon.data?.["tex"] ?? ""),
    String(polygon.data?.["m"] ?? ""),
    String(polygon.data?.["e"] ?? ""),
    String(polygon.data?.["lit"] ?? ""),
    String(polygon.data?.["ls"] ?? ""),
    String(polygon.data?.["ls-anim"] ?? ""),
    String(polygon.data?.["ls-pattern"] ?? ""),
    String(polygon.data?.["base"] ?? ""),
    String(polygon.data?.["pressed"] ?? ""),
  ].join("\u001f");
}

function quakePolygonIsSky(polygon: Polygon): boolean {
  return String(polygon.data?.["tex"] ?? "").toLowerCase().startsWith("sky");
}

function polygonForMerge(polygon: Polygon): Polygon {
  return {
    ...polygon,
    vertices: polygon.vertices.map((vertex) => [...vertex] as Vec3),
    uvs: polygon.uvs?.map((uv) => [...uv] as Vec2),
    textureTriangles: polygon.textureTriangles?.map(cloneTextureTriangle),
    data: undefined,
  };
}

function cloneTextureTriangle(triangle: TextureTriangle): TextureTriangle {
  return {
    vertices: [
      [...triangle.vertices[0]] as Vec3,
      [...triangle.vertices[1]] as Vec3,
      [...triangle.vertices[2]] as Vec3,
    ],
    uvs: [
      [...triangle.uvs[0]] as Vec2,
      [...triangle.uvs[1]] as Vec2,
      [...triangle.uvs[2]] as Vec2,
    ],
  };
}

function pushRenderCandidate(
  out: QuakeFaceCandidate[],
  polygon: Polygon,
  sourceFaceIndices: number[],
  fallbackData: Record<string, string | number | boolean> = {},
  renderDedupe?: Map<string, number>,
): void {
  const renderPolygon = simplifyQuakeRenderPolygon(polygon);
  const dedupeKey = quakeRenderDedupeKey(renderPolygon, fallbackData);
  const existingIndex = renderDedupe?.get(dedupeKey);
  if (existingIndex !== undefined) {
    const existing = out[existingIndex];
    if (existing) {
      existing.sourceFaceIndices = uniqueSorted([...existing.sourceFaceIndices, ...sourceFaceIndices]);
    }
    return;
  }

  const faceIndex = out.length;
  const textureName = String(renderPolygon.data?.["tex"] ?? fallbackData["tex"] ?? "");
  const modelIndex = String(renderPolygon.data?.["m"] ?? fallbackData["m"] ?? "");
  const entityIndex = String(renderPolygon.data?.["e"] ?? fallbackData["e"] ?? "");
  const brightness = String(renderPolygon.data?.["lit"] ?? fallbackData["lit"] ?? "");
  const lightStyles = String(renderPolygon.data?.["ls"] ?? fallbackData["ls"] ?? "");
  const lightstyleAnimation = String(
    renderPolygon.data?.["ls-anim"] ?? fallbackData["ls-anim"] ?? "",
  );
  const lightstyleOverlayPattern = String(
    renderPolygon.data?.["ls-pattern"] ?? fallbackData["ls-pattern"] ?? "",
  );
  const buttonBaseTexture = String(
    renderPolygon.data?.["base"] ?? fallbackData["base"] ?? "",
  );
  const buttonPressedTexture = String(
    renderPolygon.data?.["pressed"] ?? fallbackData["pressed"] ?? "",
  );
  const sortedSourceFaceIndices = uniqueSorted(sourceFaceIndices);
  out.push({
    faceIndex,
    sourceFaceIndices: sortedSourceFaceIndices,
    points: [],
    polygon: {
      ...renderPolygon,
      data: {
        "f": faceIndex,
        ...(textureName ? { "tex": textureName } : {}),
        ...(modelIndex ? { "m": modelIndex } : {}),
        ...(entityIndex ? { "e": entityIndex } : {}),
        ...(brightness ? { "lit": brightness } : {}),
        ...(lightStyles ? { "ls": lightStyles } : {}),
        ...(lightstyleAnimation ? { "ls-anim": lightstyleAnimation } : {}),
        ...(lightstyleOverlayPattern ? { "ls-pattern": lightstyleOverlayPattern } : {}),
        ...(buttonBaseTexture ? { "base": buttonBaseTexture } : {}),
        ...(buttonPressedTexture ? { "pressed": buttonPressedTexture } : {}),
      },
    },
  });
  renderDedupe?.set(dedupeKey, faceIndex);
}

function quakeFallbackData(polygon: Polygon): Record<string, string | number | boolean> {
  const data = polygon.data ?? {};
  return {
    ...(data["tex"] !== undefined ? { "tex": data["tex"] } : {}),
    ...(data["m"] !== undefined ? { "m": data["m"] } : {}),
    ...(data["e"] !== undefined ? { "e": data["e"] } : {}),
    ...(data["lit"] !== undefined ? { "lit": data["lit"] } : {}),
    ...(data["ls"] !== undefined ? { "ls": data["ls"] } : {}),
    ...(data["ls-anim"] !== undefined
      ? { "ls-anim": data["ls-anim"] }
      : {}),
    ...(data["ls-pattern"] !== undefined
      ? { "ls-pattern": data["ls-pattern"] }
      : {}),
    ...(data["base"] !== undefined
      ? { "base": data["base"] }
      : {}),
    ...(data["pressed"] !== undefined
      ? { "pressed": data["pressed"] }
      : {}),
  };
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function simplifyQuakeRenderPolygon(polygon: Polygon): Polygon {
  if (polygon.vertices.length <= 3) return polygon;
  const vertices = polygon.vertices.map((vertex) => [...vertex] as Vec3);
  const uvs = polygon.uvs?.length === polygon.vertices.length
    ? polygon.uvs.map((uv) => [...uv] as Vec2)
    : undefined;
  let changed = false;
  let removed = true;

  while (removed && vertices.length > 3) {
    removed = false;
    for (let index = 0; index < vertices.length; index++) {
      const previous = (index + vertices.length - 1) % vertices.length;
      const next = (index + 1) % vertices.length;
      if (
        !quakePointBetween3(vertices[previous], vertices[index], vertices[next]) ||
        !quakeCollinear3(vertices[previous], vertices[index], vertices[next]) ||
        (uvs && (
          !quakePointBetween2(uvs[previous], uvs[index], uvs[next]) ||
          !quakeCollinear2(uvs[previous], uvs[index], uvs[next])
        ))
      ) {
        continue;
      }

      vertices.splice(index, 1);
      uvs?.splice(index, 1);
      changed = true;
      removed = true;
      break;
    }
  }

  return changed
    ? {
        ...polygon,
        vertices,
        ...(uvs ? { uvs } : { uvs: undefined }),
      }
    : polygon;
}

function quakeCollinear3(a: Vec3, b: Vec3, c: Vec3): boolean {
  const ab = quakeVecSub3(b, a);
  const bc = quakeVecSub3(c, b);
  const ac = quakeVecSub3(c, a);
  const cross = quakeVecCross3(ab, bc);
  return quakeVecLength3(cross) <= QUAKE_RENDER_COLLINEAR_EPS * Math.max(
    1,
    quakeVecLength3(ab) * quakeVecLength3(bc),
    quakeVecLength3(ac),
  );
}

function quakeCollinear2(a: Vec2, b: Vec2, c: Vec2): boolean {
  const abX = b[0] - a[0];
  const abY = b[1] - a[1];
  const bcX = c[0] - b[0];
  const bcY = c[1] - b[1];
  return Math.abs(abX * bcY - abY * bcX) <= QUAKE_RENDER_COLLINEAR_EPS * Math.max(
    1,
    Math.hypot(abX, abY) * Math.hypot(bcX, bcY),
  );
}

function quakePointBetween3(a: Vec3, b: Vec3, c: Vec3): boolean {
  const ac = quakeVecSub3(c, a);
  const lengthSq = quakeVecDot3(ac, ac);
  if (lengthSq <= QUAKE_RENDER_COLLINEAR_EPS * QUAKE_RENDER_COLLINEAR_EPS) return true;
  const t = quakeVecDot3(quakeVecSub3(b, a), ac) / lengthSq;
  return t >= -QUAKE_RENDER_COLLINEAR_EPS && t <= 1 + QUAKE_RENDER_COLLINEAR_EPS;
}

function quakePointBetween2(a: Vec2, b: Vec2, c: Vec2): boolean {
  const acX = c[0] - a[0];
  const acY = c[1] - a[1];
  const lengthSq = acX * acX + acY * acY;
  if (lengthSq <= QUAKE_RENDER_COLLINEAR_EPS * QUAKE_RENDER_COLLINEAR_EPS) return true;
  const t = ((b[0] - a[0]) * acX + (b[1] - a[1]) * acY) / lengthSq;
  return t >= -QUAKE_RENDER_COLLINEAR_EPS && t <= 1 + QUAKE_RENDER_COLLINEAR_EPS;
}

function quakeVecSub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function quakeVecCross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function quakeVecDot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function quakeVecLength3(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function offsetQuakePolygonVertices(vertices: Vec3[], amount: number): Vec3[] {
  const normal = quakePolygonNormal(vertices);
  return vertices.map((vertex) => [
    vertex[0] + normal[0] * amount,
    vertex[1] + normal[1] * amount,
    vertex[2] + normal[2] * amount,
  ] as Vec3);
}

function quakePolygonNormal(vertices: Vec3[]): Vec3 {
  for (let i = 0; i < vertices.length - 2; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const c = vertices[i + 2];
    if (!a || !b || !c) continue;
    const normal = quakeVecCross3(quakeVecSub3(b, a), quakeVecSub3(c, a));
    const length = quakeVecLength3(normal);
    if (length > QUAKE_RENDER_COLLINEAR_EPS) {
      return [normal[0] / length, normal[1] / length, normal[2] / length];
    }
  }
  return [0, 0, 0];
}

function quakeRenderDedupeKey(
  polygon: Polygon,
  fallbackData: Record<string, string | number | boolean>,
): string {
  const data = polygon.data ?? {};
  return [
    quakeVertexUvKey(polygon),
    quakeTextureTriangleKey(polygon),
    polygon.texture ?? "",
    polygon.color ?? "",
    polygon.textureWrap?.s ?? "",
    polygon.textureWrap?.t ?? "",
    polygon.textureAlphaMode ?? "",
    polygon.doubleSided === true ? "double" : "single",
    String(data["tex"] ?? fallbackData["tex"] ?? ""),
    String(data["m"] ?? fallbackData["m"] ?? ""),
    String(data["e"] ?? fallbackData["e"] ?? ""),
    String(data["lit"] ?? fallbackData["lit"] ?? ""),
    String(data["ls"] ?? fallbackData["ls"] ?? ""),
    String(data["ls-anim"] ?? fallbackData["ls-anim"] ?? ""),
    String(data["ls-pattern"] ?? fallbackData["ls-pattern"] ?? ""),
    String(data["base"] ?? fallbackData["base"] ?? ""),
    String(data["pressed"] ?? fallbackData["pressed"] ?? ""),
  ].join("\u001f");
}

function quakeVertexUvKey(polygon: Polygon): string {
  return polygon.vertices
    .map((vertex, index) => {
      const uv = polygon.uvs?.[index];
      return `${quakeVecKey(vertex)}@${uv ? quakeVecKey(uv) : ""}`;
    })
    .sort()
    .join("|");
}

function quakeTextureTriangleKey(polygon: Polygon): string {
  return (polygon.textureTriangles ?? [])
    .map((triangle) => [
      ...triangle.vertices.map(quakeVecKey).sort(),
      ...triangle.uvs.map(quakeVecKey).sort(),
    ].join("@"))
    .sort()
    .join("|");
}

function quakeVecKey(values: readonly number[]): string {
  return values.map((value) => value.toFixed(5)).join(",");
}



function orientFacePoints(points: QuakeVertex[], face: QuakeFace, planes: QuakePlane[]): QuakeVertex[] {
  const plane = planes[face.plane];
  if (!plane || points.length < 3) return points;
  const expected = face.side
    ? { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z }
    : plane.normal;
  const actual = faceNormal(points);
  const dot = actual.x * expected.x + actual.y * expected.y + actual.z * expected.z;
  return dot < 0 ? points.slice().reverse() : points;
}

function faceNormal(points: QuakeVertex[]): QuakeVertex {
  for (let i = 0; i < points.length - 2; i++) {
    const a = points[i];
    const b = points[i + 1];
    const c = points[i + 2];
    if (!a || !b || !c) continue;
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const normal = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x,
    };
    const length = Math.hypot(normal.x, normal.y, normal.z);
    if (length > 0.000001) {
      return {
        x: normal.x / length,
        y: normal.y / length,
        z: normal.z / length,
      };
    }
  }
  return { x: 0, y: 0, z: 0 };
}

function faceFirstTripleAreaSq(points: QuakeVertex[]): number {
  if (points.length < 3) return 0;
  const a = points[0];
  const b = points[1];
  const c = points[2];
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const nx = ab.y * ac.z - ab.z * ac.y;
  const ny = ab.z * ac.x - ab.x * ac.z;
  const nz = ab.x * ac.y - ab.y * ac.x;
  return nx * nx + ny * ny + nz * nz;
}

function samePoint(a: QuakeVertex, b: QuakeVertex): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001 && Math.abs(a.z - b.z) < 0.001;
}

function smoothFaceBrightness(candidates: QuakeFaceBuildCandidate[]): Map<number, number> {
  if (candidates.length < 2 || QUAKE_LIGHT_SMOOTHING_WEIGHT <= 0) return new Map();

  const metas = candidates.map((candidate) => {
    const normal = faceNormal(candidate.points);
    const d = candidate.points[0]
      ? candidate.points[0].x * normal.x + candidate.points[0].y * normal.y + candidate.points[0].z * normal.z
      : 0;
    return { normal, d, bounds: facePlaneBounds(candidate.points, normal) };
  });

  const neighbors = Array.from({ length: candidates.length }, () => new Set<number>());
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (!canSmoothFaceBrightness(metas[i], metas[j])) continue;
      if (!planeBoundsTouch(metas[i].bounds, metas[j].bounds)) continue;
      neighbors[i].add(j);
      neighbors[j].add(i);
    }
  }

  const smoothed = new Map<number, number>();
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateNeighbors = neighbors[i];
    if (candidateNeighbors.size === 0) continue;

    let neighborTotal = 0;
    for (const neighborIndex of candidateNeighbors) neighborTotal += candidates[neighborIndex].brightness;
    const neighborAverage = neighborTotal / candidateNeighbors.size;
    smoothed.set(
      candidate.faceIndex,
      clampLightBrightness(
        candidate.brightness * (1 - QUAKE_LIGHT_SMOOTHING_WEIGHT) +
          neighborAverage * QUAKE_LIGHT_SMOOTHING_WEIGHT,
      ),
    );
  }
  return smoothed;
}

function canSmoothFaceBrightness(
  aMeta: { normal: QuakeVertex; d: number },
  bMeta: { normal: QuakeVertex; d: number },
): boolean {
  const dot =
    aMeta.normal.x * bMeta.normal.x +
    aMeta.normal.y * bMeta.normal.y +
    aMeta.normal.z * bMeta.normal.z;
  if (dot < QUAKE_LIGHT_SMOOTHING_NORMAL_DOT) return false;
  return Math.abs(aMeta.d - bMeta.d) <= QUAKE_LIGHT_SMOOTHING_PLANE_EPS;
}

function facePlaneBounds(points: QuakeVertex[], normal: QuakeVertex): { minU: number; maxU: number; minV: number; maxV: number } {
  const axis = dominantNormalAxis(normal);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const point of points) {
    const [u, v] = axis === "x" ? [point.y, point.z] : axis === "y" ? [point.x, point.z] : [point.x, point.y];
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { minU, maxU, minV, maxV };
}

function dominantNormalAxis(normal: QuakeVertex): "x" | "y" | "z" {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ax >= ay && ax >= az) return "x";
  return ay >= az ? "y" : "z";
}

function planeBoundsTouch(
  a: { minU: number; maxU: number; minV: number; maxV: number },
  b: { minU: number; maxU: number; minV: number; maxV: number },
): boolean {
  const gapU = intervalGap(a.minU, a.maxU, b.minU, b.maxU);
  const gapV = intervalGap(a.minV, a.maxV, b.minV, b.maxV);
  const overlapU = intervalOverlap(a.minU, a.maxU, b.minU, b.maxU);
  const overlapV = intervalOverlap(a.minV, a.maxV, b.minV, b.maxV);
  return (
    (gapU <= QUAKE_LIGHT_SMOOTHING_TOUCH_EPS && overlapV > QUAKE_LIGHT_SMOOTHING_TOUCH_EPS) ||
    (gapV <= QUAKE_LIGHT_SMOOTHING_TOUCH_EPS && overlapU > QUAKE_LIGHT_SMOOTHING_TOUCH_EPS)
  );
}

function intervalGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

function intervalOverlap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
}

function quakeToPoly(point: QuakeVertex, pivot: QuakeVertex): Vec3 {
  return [
    (point.x - pivot.x) * QUAKE_UNIT_SCALE,
    (point.y - pivot.y) * QUAKE_UNIT_SCALE,
    (point.z - pivot.z) * QUAKE_UNIT_SCALE,
  ];
}

function quakeDeltaToPoly(point: QuakeVertex): Vec3 {
  return [
    point.x * QUAKE_UNIT_SCALE,
    point.y * QUAKE_UNIT_SCALE,
    point.z * QUAKE_UNIT_SCALE,
  ];
}

function textureUv(point: QuakeVertex, texInfo: QuakeTexInfo, texture: QuakeMipTexture): Vec2 {
  const s = point.x * texInfo.s[0] + point.y * texInfo.s[1] + point.z * texInfo.s[2] + texInfo.s[3];
  const t = point.x * texInfo.t[0] + point.y * texInfo.t[1] + point.z * texInfo.t[2] + texInfo.t[3];
  return [s / texture.width, -t / texture.height];
}

function faceLightBrightness(
  face: QuakeFace,
  points: QuakeVertex[],
  texInfo: QuakeTexInfo,
  lighting: Uint8Array,
  styleScaleOverrides?: Map<number, number>,
): number {
  if (!lighting.length || face.lightOffset < 0) return 1;
  const styles = activeLightStyles(face.styles);
  if (styles.length === 0) return 1;
  const bounds = faceTextureCoordinateBounds(points, texInfo);
  if (!bounds) return 1;
  const minS = Math.floor(bounds.minS / QUAKE_LIGHT_SAMPLE_SIZE);
  const minT = Math.floor(bounds.minT / QUAKE_LIGHT_SAMPLE_SIZE);
  const width = Math.max(1, Math.ceil(bounds.maxS / QUAKE_LIGHT_SAMPLE_SIZE) - minS + 1);
  const height = Math.max(1, Math.ceil(bounds.maxT / QUAKE_LIGHT_SAMPLE_SIZE) - minT + 1);
  const sampleCount = width * height;
  if (!Number.isFinite(sampleCount) || sampleCount <= 0 || face.lightOffset >= lighting.length) return 1;

  const values: number[] = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    let brightness = 0;
    for (let styleIndex = 0; styleIndex < styles.length; styleIndex++) {
      const offset = face.lightOffset + styleIndex * sampleCount + sampleIndex;
      if (offset >= lighting.length) return 1;
      const style = styles[styleIndex];
      brightness += lightSampleToBrightness(lighting[offset] ?? 0) * lightScaleForStyle(style, styleScaleOverrides);
    }
    values.push(clampLightBrightness(brightness));
  }

  return clampLightBrightness(trimmedBrightnessAverage(values));
}

function faceLightstyleFrameBrightnesses(
  face: QuakeFace,
  points: QuakeVertex[],
  texInfo: QuakeTexInfo,
  lighting: Uint8Array,
  style: number,
): number[] | undefined {
  const pattern = QUAKE_LIGHT_STYLE_PATTERNS.get(style);
  if (!pattern) return undefined;
  const values: number[] = [];
  for (const char of pattern) {
    values.push(faceLightBrightness(face, points, texInfo, lighting, new Map([[style, lightStyleCharScale(char)]])));
  }
  return values;
}

function activeLightStyles(styles: readonly number[]): number[] {
  return styles.filter((style) => style !== 255);
}

function animatedLightStyle(styles: readonly number[]): number | undefined {
  return styles.find((style) => style !== 0 && QUAKE_LIGHT_STYLE_PATTERNS.has(style));
}

function lightStyleData(styles: readonly number[]): Record<string, string> {
  if (styles.length === 0) return {};
  const animatedStyle = animatedLightStyle(styles);
  return {
    "ls": styles.join(","),
    ...(animatedStyle !== undefined ? { "ls-anim": String(animatedStyle) } : {}),
  };
}

function lightstyleOverlayData(candidate: QuakeFaceBuildCandidate, baseBrightness: number): Record<string, string> {
  if (candidate.lightstyleAnimation === undefined || !candidate.lightstyleFrameBrightnesses?.length) return {};
  const opacities = candidate.lightstyleFrameBrightnesses.map((brightness) =>
    lightstyleOverlayOpacity(baseBrightness, brightness).toFixed(3),
  );
  return {
    "ls-pattern": opacities.join(","),
  };
}

function lightstyleOverlayOpacity(baseBrightness: number, frameBrightness: number): number {
  const base = Math.max(QUAKE_LIGHT_MIN, baseBrightness);
  const exactDarkening = Math.max(0, 1 - Math.min(frameBrightness, base) / base);
  return Math.max(
    0,
    Math.min(
      QUAKE_LIGHTSTYLE_OVERLAY_MAX_OPACITY,
      Math.pow(exactDarkening, QUAKE_LIGHTSTYLE_OVERLAY_GAMMA) * QUAKE_LIGHTSTYLE_OVERLAY_STRENGTH,
    ),
  );
}

function faceTextureCoordinateBounds(points: QuakeVertex[], texInfo: QuakeTexInfo): QuakeTextureCoordinateBounds | null {
  let minS = Infinity;
  let maxS = -Infinity;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const point of points) {
    const s = point.x * texInfo.s[0] + point.y * texInfo.s[1] + point.z * texInfo.s[2] + texInfo.s[3];
    const t = point.x * texInfo.t[0] + point.y * texInfo.t[1] + point.z * texInfo.t[2] + texInfo.t[3];
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
  }
  if (![minS, maxS, minT, maxT].every(Number.isFinite)) return null;
  return { minS, maxS, minT, maxT };
}

function lightSampleToBrightness(sample: number): number {
  return clampLightBrightness((sample / 128) * QUAKE_LIGHT_SAMPLE_NORMAL_SCALE);
}

function trimmedBrightnessAverage(values: number[]): number {
  if (values.length === 0) return 1;
  let rawTotal = 0;
  let squaredTotal = 0;
  for (const value of values) {
    rawTotal += value;
    squaredTotal += value * value;
  }
  const rawAverage = rawTotal / values.length;
  const rmsAverage = Math.sqrt(squaredTotal / values.length);
  if (values.length < 8) return rawAverage;

  values.sort((a, b) => a - b);
  const trim = Math.max(1, Math.floor(values.length * 0.1));
  const start = Math.min(trim, values.length - 1);
  const end = Math.max(start + 1, values.length - trim);
  let trimmedTotal = 0;
  for (let i = start; i < end; i++) trimmedTotal += values[i];
  const trimmedAverage = trimmedTotal / (end - start);
  return rawAverage * 0.45 + trimmedAverage * 0.35 + rmsAverage * 0.2;
}

function lightScaleForStyle(style: number, styleScaleOverrides?: Map<number, number>): number {
  const override = styleScaleOverrides?.get(style);
  if (override !== undefined) return override;
  const pattern = QUAKE_LIGHT_STYLE_PATTERNS.get(style);
  if (!pattern) return 1;
  let total = 0;
  for (const char of pattern) total += lightStyleCharScale(char);
  return total / pattern.length;
}

function lightStyleCharScale(char: string): number {
  return Math.max(0, char.charCodeAt(0) - 97) / 12;
}

function quantizeLightBrightness(brightness: number): number {
  const clamped = clampLightBrightness(brightness);
  const adjusted = clamped < 1 ? Math.pow(clamped, QUAKE_LIGHT_DISPLAY_GAMMA) : clamped;
  return Math.round(adjusted * QUAKE_LIGHT_BUCKETS) / QUAKE_LIGHT_BUCKETS;
}

function clampLightBrightness(brightness: number): number {
  return Math.max(QUAKE_LIGHT_MIN, Math.min(QUAKE_LIGHT_MAX, brightness));
}

function formatQuakeBrightness(brightness: number): string {
  return quantizeLightBrightness(brightness).toFixed(4);
}

async function buttonPressedTextureUrlFor(
  texture: QuakeMipTexture,
  brightness: number,
  textures: Array<QuakeMipTexture | null>,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
): Promise<string | undefined> {
  const pressedTexture = buttonPressedTextureFrame(texture, textures);
  if (!pressedTexture) return undefined;
  return litTextureUrlFor(pressedTexture, brightness, palette, urls, cache, encodeTextureUrl);
}

async function textureAnimationSpriteFor(
  polygon: Polygon,
  texture: QuakeMipTexture,
  brightness: number,
  textures: Array<QuakeMipTexture | null>,
  palette: RGB[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
): Promise<{ sprite: string; frameCount: number } | undefined> {
  const animation = textureAnimationFrameTextures(texture, textures);
  if (!animation) return undefined;
  const frames = rotateTextureAnimationFrames(animation.frames, animation.frameIndex);
  const plan = computeTextureAtlasPlanPublic(polygon, 0);
  if (!plan) return undefined;
  const frameW = Math.max(1, Math.ceil(plan.canvasW));
  const frameH = Math.max(1, Math.ceil(plan.canvasH));
  const quantized = quantizeLightBrightness(brightness);
  const key = [
    frames.map((frame) => frame.name).join("|"),
    quantized.toFixed(4),
    frameW,
    frameH,
    polygon.vertices.flat().map((value) => value.toFixed(4)).join(","),
    polygon.uvs?.flat().map((value) => value.toFixed(4)).join(",") ?? "",
  ].join(":");
  const cached = cache.get(key);
  if (cached) return { sprite: await cached, frameCount: frames.length };

  const task = textureAnimationSpriteUrlForPlan(
    plan,
    frameW,
    frameH,
    frames,
    palette,
    quantized,
    encodeTextureUrl,
  );
  cache.set(key, task);
  const sprite = await task;
  cache.set(key, sprite);
  return {
    sprite,
    frameCount: frames.length,
  };
}

function textureAnimationFrameTextures(
  texture: QuakeMipTexture,
  textures: Array<QuakeMipTexture | null>,
): { frames: QuakeMipTexture[]; frameIndex: number } | undefined {
  const match = texture.name.match(/^\+([0-9])(.+)$/);
  if (!match) return undefined;
  const suffix = match[2]?.toLowerCase();
  if (!suffix) return undefined;
  const frames = textures
    .filter((item): item is QuakeMipTexture => {
      if (!item) return false;
      const itemMatch = item.name.match(/^\+([0-9])(.+)$/);
      return Boolean(itemMatch && itemMatch[2]?.toLowerCase() === suffix);
    })
    .sort((a, b) => Number(a.name[1]) - Number(b.name[1]));
  if (frames.length <= 1) return undefined;
  const frameIndex = frames.findIndex((frame) => frame.name.toLowerCase() === texture.name.toLowerCase());
  return frameIndex >= 0 ? { frames, frameIndex } : undefined;
}

function rotateTextureAnimationFrames(frames: QuakeMipTexture[], frameIndex: number): QuakeMipTexture[] {
  if (frameIndex <= 0) return frames;
  return [...frames.slice(frameIndex), ...frames.slice(0, frameIndex)];
}

async function textureAnimationSpriteUrlForPlan(
  plan: NonNullable<ReturnType<typeof computeTextureAtlasPlanPublic>>,
  frameW: number,
  frameH: number,
  frames: QuakeMipTexture[],
  palette: RGB[],
  brightness: number,
  encodeTextureUrl: QuakeTextureUrlEncoder,
): Promise<string> {
  const width = frameW * frames.length;
  const height = frameH;
  const pixels = new Uint8Array(width * height);
  const alpha = new Uint8Array(width * height);
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const texture = frames[frameIndex];
    if (!texture) continue;
    for (let y = 0; y < frameH; y++) {
      for (let x = 0; x < frameW; x++) {
        const target = y * width + frameIndex * frameW + x;
        const localX = x + 0.5;
        const localY = y + 0.5;
        if (!pointInScreenPolygon(localX, localY, plan.screenPts)) continue;
        const uv = textureAnimationUvAtPlanPoint(plan, localX, localY, frameW, frameH);
        if (!uv) continue;
        pixels[target] = sampleWrappedTexturePixel(texture, uv.u, uv.v);
        alpha[target] = 255;
      }
    }
  }
  return indexedPixelsToTextureUrl(width, height, pixels, palette, brightness, encodeTextureUrl, alpha);
}

function textureAnimationUvAtPlanPoint(
  plan: NonNullable<ReturnType<typeof computeTextureAtlasPlanPublic>>,
  x: number,
  y: number,
  frameW: number,
  frameH: number,
): { u: number; v: number } | null {
  if (plan.uvAffine) {
    const { a, b, c, d, e, f } = plan.uvAffine;
    const det = a * d - b * c;
    if (Math.abs(det) <= 1e-9) return null;
    const dx = x - e;
    const dy = y - f;
    return {
      u: (dx * d - b * dy) / det,
      v: (a * dy - dx * c) / det,
    };
  }
  if (!plan.uvSampleRect) return null;
  return {
    u: plan.uvSampleRect.minU + (x / frameW) * (plan.uvSampleRect.maxU - plan.uvSampleRect.minU),
    v: plan.uvSampleRect.minV + (y / frameH) * (plan.uvSampleRect.maxV - plan.uvSampleRect.minV),
  };
}

function sampleWrappedTexturePixel(texture: QuakeMipTexture, u: number, v: number): number {
  const x = wrappedTextureCoord(u * texture.width, texture.width);
  const y = wrappedTextureCoord(v * texture.height, texture.height);
  return texture.pixels[y * texture.width + x] ?? 0;
}

function wrappedTextureCoord(value: number, size: number): number {
  const whole = Math.floor(value);
  return ((whole % size) + size) % size;
}

function pointInScreenPolygon(x: number, y: number, points: number[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const xi = points[i] ?? 0;
    const yi = points[i + 1] ?? 0;
    const xj = points[j] ?? 0;
    const yj = points[j + 1] ?? 0;
    if (pointOnScreenSegment(x, y, xi, yi, xj, yj)) return true;
    const crosses = (yi > y) !== (yj > y);
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointOnScreenSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const cross = (px - ax) * dy - (py - ay) * dx;
  if (Math.abs(cross) > 1e-5) return false;
  const dot = (px - ax) * dx + (py - ay) * dy;
  if (dot < -1e-5) return false;
  return dot <= dx * dx + dy * dy + 1e-5;
}

function buttonPressedTextureFrame(
  texture: QuakeMipTexture,
  textures: Array<QuakeMipTexture | null>,
): QuakeMipTexture | undefined {
  if (!texture.name.startsWith("+0") || texture.name.length <= 2) return undefined;
  const pressedName = `+a${texture.name.slice(2)}`.toLowerCase();
  return textures.find((item): item is QuakeMipTexture =>
    Boolean(item && item.name.toLowerCase() === pressedName)
  );
}

async function litTextureUrlFor(
  texture: QuakeMipTexture,
  brightness: number,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
): Promise<string> {
  const quantized = quantizeLightBrightness(brightness);
  if (quantized === 1) return texture.url;
  const key = `${texture.name}:${quantized.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached) return await cached;

  const task = indexedPixelsToTextureUrl(texture.width, texture.height, texture.pixels, palette, quantized, encodeTextureUrl);
  cache.set(key, task);
  const url = await task;
  cache.set(key, url);
  urls.push(url);
  return url;
}

function quakeTextureIsSky(texture: QuakeMipTexture): boolean {
  return texture.name.toLowerCase().startsWith("sky");
}

async function skyTextureUrlFor(
  texture: QuakeMipTexture,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
): Promise<string> {
  const key = `${texture.name}:sky:${texture.width}x${texture.height}`;
  const cached = cache.get(key);
  if (cached) return await cached;

  const task = indexedPixelsToTextureUrl(
    texture.width,
    texture.height,
    quakeCompositeSkyPixels(texture),
    palette,
    1,
    encodeTextureUrl,
  );
  cache.set(key, task);
  const url = await task;
  cache.set(key, url);
  urls.push(url);
  return url;
}

function quakeCompositeSkyPixels(texture: QuakeMipTexture): Uint8Array {
  const layerWidth = Math.floor(texture.width / 2);
  if (layerWidth <= 0) return texture.pixels.slice();

  const pixels = new Uint8Array(texture.pixels.length);
  for (let y = 0; y < texture.height; y++) {
    const row = y * texture.width;
    for (let x = 0; x < texture.width; x++) {
      const layerX = x % layerWidth;
      const cloud = texture.pixels[row + layerX] ?? QUAKE_SKY_TRANSPARENT_INDEX;
      pixels[row + x] = cloud === QUAKE_SKY_TRANSPARENT_INDEX
        ? texture.pixels[row + layerWidth + layerX] ?? QUAKE_SKY_TRANSPARENT_INDEX
        : cloud;
    }
  }
  return pixels;
}

function litTextureFallbackColor(
  texture: QuakeMipTexture,
  brightness: number,
  palette: RGB[],
  cache: Map<string, string>,
): string {
  const quantized = quantizeLightBrightness(brightness);
  const key = `${texture.name}:${quantized.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const paletteIndex of texture.pixels) {
    const [pr, pg, pb] = palette[paletteIndex] ?? [0, 0, 0];
    const light = paletteIndex >= 224 ? 1 : quantized;
    r += pr * light;
    g += pg * light;
    b += pb * light;
    count++;
  }

  const color = count
    ? rgbToHex(clampByte(r / count), clampByte(g / count), clampByte(b / count))
    : "#202020";
  cache.set(key, color);
  return color;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function vertexBounds(vertices: QuakeVertex[]): { min: QuakeVertex; max: QuakeVertex } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const vertex of vertices) {
    min.x = Math.min(min.x, vertex.x);
    min.y = Math.min(min.y, vertex.y);
    min.z = Math.min(min.z, vertex.z);
    max.x = Math.max(max.x, vertex.x);
    max.y = Math.max(max.y, vertex.y);
    max.z = Math.max(max.z, vertex.z);
  }
  return { min, max };
}

function indexedPixelsToTextureUrl(
  width: number,
  height: number,
  pixels: Uint8Array,
  palette: RGB[],
  brightness = 1,
  encodeTextureUrl: QuakeTextureUrlEncoder = browserTextureUrlEncoder,
  alpha?: Uint8Array,
): Promise<string> {
  return encodeTextureUrl({
    width,
    height,
    pixels,
    palette,
    brightness,
    ...(alpha ? { alpha } : {}),
  });
}

function browserTextureUrlEncoder({
  width,
  height,
  pixels,
  palette,
  brightness,
  alpha,
}: QuakeTextureEncodeInput): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available.");
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < pixels.length; i++) {
    const paletteIndex = pixels[i] ?? 0;
    const [r, g, b] = palette[paletteIndex] ?? [0, 0, 0];
    const light = paletteIndex >= 224 ? 1 : brightness;
    const index = i * 4;
    image.data[index] = clampByte(r * light);
    image.data[index + 1] = clampByte(g * light);
    image.data[index + 2] = clampByte(b * light);
    image.data[index + 3] = alpha?.[i] ?? 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvasToObjectUrl(canvas);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode texture PNG."));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, "image/png");
  });
}
