import {
  BASE_TILE,
  computeTextureAtlasPlanPublic,
  mergePolygons,
  type Polygon,
  type TextureTriangle,
  type Vec2,
  type Vec3,
} from "@layoutit/polycss";

import { QUAKE_RENDER_SUPERSAMPLE, QUAKE_UNIT_SCALE } from "../quakeScale.js";
import { buildEntityManifest, cloneEntityManifest } from "./entities";
import {
  buildQuakeGameLogicFacts,
  cloneQuakeGameLogicFacts,
  type QuakeGameLogicEntityFact,
  type QuakeGameLogicFacts,
  type QuakeGameLogicProgramFactsInput,
} from "./gameLogicFacts";
import { parseQuakePakDirectory, quakePakEntryBytes, readFixedAscii, type QuakePakEntry } from "./pak";
import { buildSourceFaceVisibilityKeys, buildVisibility } from "./visibility";
export { parseQuakePakDirectory, quakePakEntryBytes, type QuakePakEntry } from "./pak";
export { QUAKE_RENDER_SUPERSAMPLE } from "../quakeScale.js";

export type RGB = [number, number, number];

export interface QuakeTextureEncodeInput {
  width: number;
  height: number;
  pixels: Uint8Array;
  palette: RGB[];
  brightness: number;
  alpha?: Uint8Array;
  rgba?: Uint8Array;
}

export type QuakeTextureUrlEncoder = (input: QuakeTextureEncodeInput) => Promise<string>;

export interface QuakePreparedSceneCreateOptions {
  encodeTextureUrl?: QuakeTextureUrlEncoder;
  lightmapBake?: boolean;
  lightmapBakeDetailTarget?: number;
  lightmapBakeLightSupersample?: number;
  lightmapBakeMaxSide?: number;
  lightmapBakeMaxTotalTexels?: number;
  lightmapBakeMinDisplaySide?: number;
  lightmapBakeMinTextureScale?: number;
  lightmapBakeMinTextureSide?: number;
  lightmapBakeTextureFallbackOverlay?: boolean;
  lightmapBakeTextureFallbackOverlayMaxExtraRatio?: number;
  lightmapBakeTextureFallbackOverlayMaxSide?: number;
  lightmapBakeTextureEncoding?: boolean;
  lightmapBakeMergedOverlay?: boolean;
  lightmapBakeMergedOverlayMaxExtraRatio?: number;
  lightmapBakeMergedOverlayMaxSide?: number;
  lightmapBakeMinRange?: number;
  lightmapOverlay?: boolean;
  lightmapOverlayMaxExtraRatio?: number;
  lightmapOverlayMaxSide?: number;
  lightmapOverlayMinRange?: number;
  litTextureEncoding?: boolean;
  litTextureEncodingTextureNames?: string[];
  gameLogicProgramFacts?: QuakeGameLogicProgramFactsInput | null;
  mapPath?: string;
}

interface QuakeBspPrepareOptions {
  gameLogicProgramFacts?: QuakeGameLogicProgramFactsInput | null;
  lightmapBake: QuakeLightmapBakeOptions;
  lightmapOverlay: QuakeLightmapOverlayOptions;
  litTextureEncoding: boolean;
  litTextureEncodingTextureNames?: ReadonlySet<string>;
}

interface QuakeLightmapBakeOptions {
  enabled: boolean;
  detailTargetRatio: number;
  lightSupersample: number;
  maxTextureSide: number;
  maxTotalTexels: number;
  minDisplayRange: number;
  minDisplaySide: number;
  minTextureScale: number;
  minTextureSide: number;
  textureEncoding: boolean;
  textureFallbackOverlay: boolean;
  textureFallbackOverlayMaxExtraRatio: number;
  textureFallbackOverlayMaxTextureSide: number;
  mergedOverlay: boolean;
  mergedOverlayMaxExtraRatio: number;
  mergedOverlayMaxTextureSide: number;
}

interface QuakeLightmapBakeStats {
  candidateDetailWeight: number;
  candidateTexels: number;
  detailTargetRatio: number;
  fallbackOverlayCappedByLeaves: boolean;
  fallbackOverlayCount: number;
  fallbackOverlayDetailWeight: number;
  fallbackOverlayMaxExtraLeaves: number;
  fallbackOverlayTexels: number;
  mergedFallbackOverlayCandidateCount: number;
  mergedFallbackOverlayCount: number;
  mergedFallbackOverlayDetailWeight: number;
  mergedFallbackOverlaySourceFaceCount: number;
  mergedFallbackOverlayTexels: number;
  maxTotalTexels: number;
  selectedDetailWeight: number;
  selectedTexels: number;
  selectedCount: number;
  totalCount: number;
  cappedByTexels: boolean;
  textureFidelityRejectedCount: number;
  textureFidelityRejectedDetailWeight: number;
  textureFidelityRejectedTexels: number;
}

interface QuakeLightmapOverlayOptions {
  enabled: boolean;
  maxExtraRatio: number;
  maxTextureSide: number;
  minDisplayRange: number;
}

interface QuakeFaceLightmapGrid {
  lightOffset: number;
  minS: number;
  minT: number;
  width: number;
  height: number;
  sampleCount: number;
  styles: number[];
}

interface QuakeFaceLightmapOverlaySelection {
  baseBrightness: number;
  displayRange: number;
  overlay: QuakeFaceCandidate;
  renderCandidate: QuakeFaceCandidate;
  score: number;
  sourceCandidate: QuakeFaceBuildCandidate;
  sourceFaceIndex: number;
}

interface QuakeFaceLightmapBakeSelection {
  baseBrightness: number;
  bounds: QuakeTextureCoordinateBounds;
  detailDensity: number;
  detailWeight: number;
  dimensions: { width: number; height: number };
  displayRange: number;
  grid: QuakeFaceLightmapGrid;
  renderCandidate: QuakeFaceCandidate;
  score: number;
  sourceCandidate: QuakeFaceBuildCandidate;
  texelCount: number;
  uvs: Vec2[];
}

interface QuakeLightmapBakeTextureFidelityRejectedSelectionCollector {
  selections: QuakeFaceLightmapBakeSelection[];
  textureFidelityCount: number;
  textureFidelityDetailWeight: number;
  textureFidelityTexels: number;
}

interface QuakeLightmapBakeFallbackOverlayStats {
  cappedByLeaves: boolean;
  detailWeight: number;
  maxExtraLeaves: number;
  selectedCount: number;
  texels: number;
}

interface QuakeMergedLightmapOverlayStats {
  cappedByLeaves: boolean;
  candidateCount: number;
  detailWeight: number;
  maxExtraLeaves: number;
  selectedSourceFaceIndices: Set<number>;
  selectedCount: number;
  sourceFaceCount: number;
  texels: number;
}

interface QuakeMergedLightmapOverlaySelection {
  baseBrightness: number;
  baseDisplayBrightness: number;
  basis: QuakeWallBleedBasis;
  bounds: QuakeLocalBounds;
  detailWeight: number;
  dimensions: { width: number; height: number };
  displayRange: number;
  baseRenderCandidates: QuakeFaceCandidate[];
  faceIndex: number;
  fillRatio?: number;
  localPoints: Vec2[];
  minSideQuake?: number;
  solidSampleRatio?: number;
  sourceFaces: QuakeMergedLightmapOverlaySourceFace[];
  texelCount: number;
  vertices: Vec3[];
  uvs: Vec2[];
}

interface QuakeMergedLightmapOverlaySourceFace {
  bounds: QuakeLocalBounds;
  detailWeight: number;
  displayRange: number;
  grid: QuakeFaceLightmapGrid;
  localPoints: Vec2[];
  sourceCandidate: QuakeFaceBuildCandidate;
  textureBounds: QuakeTextureCoordinateBounds;
}

interface QuakeLocalBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

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
  face: QuakeFace;
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
  mins: QuakeVertex;
  maxs: QuakeVertex;
  firstMarkSurface: number;
  markSurfaceCount: number;
}

export interface QuakeVisibilityBounds {
  mins: QuakeVertex;
  maxs: QuakeVertex;
  center: QuakeVertex;
}

export interface QuakeVisibilitySourceFaceMetadata {
  faceIndex: number;
  modelIndex: number;
  entityIndex?: number;
  texture: string;
  planeIndex: number;
  plane: QuakePlane;
  side: number;
  pointCount: number;
  area: number;
  leafIndexes: number[];
  bounds: QuakeVisibilityBounds;
}

export interface QuakeVisibilityLeafMetadata {
  leafIndex: number;
  contents: number;
  bounds: QuakeVisibilityBounds;
  faceIndexes: number[];
  visibleLeafIndexes: number[] | null;
  visibleFaceIndexes: number[] | null;
  adjacentLeafIndexes: number[];
}

export interface QuakeVisibilityDoorBlockerMetadata {
  entityIndex: number;
  modelIndex: number;
  classname: string;
  kind: "func_door" | "func_door_secret";
  linkedEntityIndexes: number[];
  closedBounds: QuakeVisibilityBounds;
  origin?: QuakeVertex;
  openBounds?: QuakeVisibilityBounds;
  triggerBounds?: QuakeVisibilityBounds;
  moveDirection?: QuakeVertex;
  travelOffset?: QuakeVertex;
  startsOpen?: boolean;
  faceIndexes: number[];
  leafIndexes: number[];
  nearbyLeafIndexes: number[];
  blockedLeafPairCandidates: Array<[number, number]>;
}

export interface QuakePreparedVisibilityMetadata {
  version: 1;
  source: "prepared-bsp";
  pvsSource: "bsp-visdata";
  leafAdjacencySource: "bounds-touch";
  doorLeafCutSource: "bounds-touch-door-intersection";
  leaves: QuakeVisibilityLeafMetadata[];
  sourceFaces: QuakeVisibilitySourceFaceMetadata[];
  doorBlockers: QuakeVisibilityDoorBlockerMetadata[];
}

export interface QuakeVisibility {
  faceForPolygon: number[];
  metadata?: QuakePreparedVisibilityMetadata;
  leafIndexAt(point: Vec3): number;
  sourceFaceIndicesForRenderFace(faceIndex: number): readonly number[];
  visibleLeavesAt(point: Vec3): Set<number> | null;
  visibleFacesAt(point: Vec3): Set<number> | null;
  visibleFaceGroupAt(point: Vec3): QuakeVisibleFaceGroup;
}

export interface QuakeVisibleFaceGroup {
  key: string;
  faces: Set<number> | null;
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
  assetUrlsComplete: true;
  debugOutlineSourceAssetUrls?: string[];
  debugOutlineAssetUrls?: string[];
  debugOutlineBackgrounds?: QuakeRenderBundleDebugOutlineBackground[];
  debugOutlineOverpainted?: boolean;
  debugTransparentOutlineSourceAssetUrls?: string[];
  debugTransparentOutlineAssetUrls?: string[];
  debugTransparentOutlineBackgrounds?: QuakeRenderBundleDebugOutlineBackground[];
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

export type QuakeRenderBundleDebugOutlineBackground = [position: string, size: string] | null;

export interface QuakeRenderBundleLeafMetadata {
  f: number;
  p?: number;
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
  metadata?: QuakePreparedVisibilityMetadata;
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
  gameLogic?: QuakeGameLogicFacts;
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
  gameLogic?: QuakeGameLogicFacts;
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
  ["maps/e1m1.bsp", { origin: { x: 480, y: -104, z: 30 }, angle: 90 }],
]);
const QUAKE_GROUND_GRID_CELL_SIZE = 0.5;
const QUAKE_GROUND_GRID_Z_SCALE = 1 / 256;
const QUAKE_GROUND_GRID_NULL_SAMPLE = -32768;
const QUAKE_CONTENTS_SOLID = -2;
const QUAKE_VISIBILITY_LEAF_ADJACENCY_EPSILON = 1;
const QUAKE_VISIBILITY_DOOR_LEAF_EXPANSION = 1;
const QUAKE_VISIBILITY_DOOR_NEARBY_LEAF_EXPANSION = 16;
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
const QUAKE_FACE_NORMAL_AREA_EPS = 1e-4;
const QUAKE_LIGHTMAP_BAKE_DEFAULT_MAX_TEXTURE_SIDE = 384;
const QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE = 4;
const QUAKE_LIGHTMAP_BAKE_MAX_TEXTURE_SIDE = 512;
const QUAKE_LIGHTMAP_BAKE_DEFAULT_DETAIL_TARGET_RATIO = 0.9;
const QUAKE_LIGHTMAP_BAKE_DEFAULT_LIGHT_SUPERSAMPLE = 2;
const QUAKE_LIGHTMAP_BAKE_MAX_LIGHT_SUPERSAMPLE = 4;
const QUAKE_LIGHTMAP_BAKE_DEFAULT_MAX_TOTAL_TEXELS = 24_000_000;
const QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_DISPLAY_RANGE = 0.02;
const QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_DISPLAY_SIDE = 0;
const QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_TEXTURE_SCALE = 0.99;
const QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_TEXTURE_SIDE = 48;
const QUAKE_LIGHTMAP_BAKE_REPEAT_EPS = 0.05;
const QUAKE_LIGHTMAP_BAKE_REPEATED_TILE_MIN_BAKE_SIDE = 48;
const QUAKE_LIGHTMAP_BAKE_REPEATED_STRIP_MIN_REPEAT = 1.25;
const QUAKE_LIGHTMAP_BAKE_REPEATED_STRIP_MIN_TILE_COVERAGE = 0.75;
const QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_DEFAULT_MAX_EXTRA_RATIO = 0.35;
const QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_MAX_EXTRA_RATIO = 0.5;
const QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_DEFAULT_MAX_TEXTURE_SIDE = 128;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_DEFAULT_MAX_EXTRA_RATIO = 0.08;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_EXTRA_RATIO = 0.35;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_DEFAULT_MAX_TEXTURE_SIDE = 192;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_VERTICES = 16;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_SOURCE_FACES = 16;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_ASPECT_RATIO = 12;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MIN_FILL_RATIO = 0.86;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MIN_SOLID_SIDE = 24;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MIN_SAMPLE_FILL_RATIO = 0.9;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_SOLID_SAMPLE_UNIT = 32;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_SOLID_SAMPLES = 14;
const QUAKE_LIGHTMAP_OVERLAY_DEFAULT_MAX_TEXTURE_SIDE = 128;
const QUAKE_LIGHTMAP_OVERLAY_DEFAULT_MAX_EXTRA_RATIO = 0.05;
const QUAKE_LIGHTMAP_OVERLAY_DEFAULT_MIN_DISPLAY_RANGE = 0.14;
const QUAKE_LIGHTMAP_OVERLAY_OFFSET = 0.0015;
const QUAKE_LIGHTMAP_OVERLAY_MAX_OPACITY = 0.86;
const QUAKE_LIGHTSTYLE_OVERLAY_STRENGTH = 0.72;
const QUAKE_LIGHTSTYLE_OVERLAY_GAMMA = 1.35;
const QUAKE_LIGHTSTYLE_OVERLAY_MAX_OPACITY = 0.52;
const QUAKE_LIGHTSTYLE_OVERLAY_OFFSET = 0.001;
const QUAKE_SKY_TRANSPARENT_INDEX = 0;
const QUAKE_WALL_RENDER_BLEED_PX = 1;
const QUAKE_WALL_RENDER_BLEED = QUAKE_WALL_RENDER_BLEED_PX / BASE_TILE;
const QUAKE_WALL_RENDER_L_JUNCTION_BLEED = QUAKE_WALL_RENDER_BLEED * 0.5;
const QUAKE_WALL_RENDER_MAX_VERTEX_BLEED = QUAKE_WALL_RENDER_BLEED * 2.5;
const QUAKE_WALL_RENDER_MAX_ABS_NORMAL_Z = 0.25;
const QUAKE_WALL_RENDER_EDGE_KEY_EPS = 1e-5;
const QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_EDGE_TOUCH_EPS = QUAKE_WALL_RENDER_EDGE_KEY_EPS * 64;
const QUAKE_WALL_RENDER_PARALLEL_NORMAL_DOT = 0.9999;
const QUAKE_WALL_RENDER_L_JUNCTION_NORMAL_DOT = 0.1;
const QUAKE_WALL_RENDER_ATLAS_EDGE_EPS = 1e-4;
const QUAKE_WALL_RENDER_ATLAS_EDGE_FRACTION_EPS = 0.01;
const QUAKE_WALL_RENDER_MIN_VISIBLE_EDGE_LUMA = 40;
const QUAKE_WALL_RENDER_MIN_VISIBLE_EDGE_COLOR_DELTA = 24;
const QUAKE_WALL_RENDER_UV_AFFINE_EPS = 1e-4;
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
  options: QuakePreparedSceneCreateOptions = {},
): Promise<QuakePreparedScene> {
  const timer = createQuakePrepareSceneTimer();
  const entries = timer.sync("prepare-scene.pak-directory", () => parseQuakePakDirectory(buffer));
  const palette = timer.sync("prepare-scene.palette", () => paletteFromPak(buffer, entries));
  const mapEntry = timer.sync("prepare-scene.select-map", () =>
    options.mapPath
      ? entries.find((entry) => entry.name === options.mapPath)
      : selectMapEntry(entries)
  );
  if (!mapEntry) throw new Error(options.mapPath ? `No ${options.mapPath} entry found in this PAK.` : "No maps/*.bsp entry found in this PAK.");
  const bsp = timer.sync("prepare-scene.read-bsp", () => quakePakEntryBytes(buffer, mapEntry).slice().buffer);
  return timer.asyncPhase("prepare-scene.bsp-total", () => createQuakePreparedSceneFromBsp(
    bsp,
    palette,
    mapEntry.name,
    options.encodeTextureUrl ?? browserTextureUrlEncoder,
    {
      gameLogicProgramFacts: options.gameLogicProgramFacts ?? null,
      lightmapBake: normalizeQuakeLightmapBakeOptions(options),
      lightmapOverlay: normalizeQuakeLightmapOverlayOptions(options),
      litTextureEncoding: options.litTextureEncoding !== false,
      litTextureEncodingTextureNames: normalizeQuakeTextureNameSet(options.litTextureEncodingTextureNames),
    },
  ));
}

function createQuakePrepareSceneTimer() {
  return {
    sync<T>(_label: string, callback: () => T): T {
      return callback();
    },
    async asyncPhase<T>(_label: string, callback: () => Promise<T>): Promise<T> {
      return await callback();
    },
  };
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
    ...(prepared.gameLogic ? { gameLogic: cloneQuakeGameLogicFacts(prepared.gameLogic) } : {}),
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
          prepared.visibility.metadata,
        )
      : undefined,
    collision: prepared.collision,
  };
}

function clonePreparedRenderBundle(renderBundle: QuakePreparedRenderBundle): QuakePreparedRenderBundle {
  return {
    ...renderBundle,
    assetUrls: [...renderBundle.assetUrls],
    ...(renderBundle.debugOutlineSourceAssetUrls ? {
      debugOutlineSourceAssetUrls: [...renderBundle.debugOutlineSourceAssetUrls],
    } : {}),
    ...(renderBundle.debugOutlineAssetUrls ? {
      debugOutlineAssetUrls: [...renderBundle.debugOutlineAssetUrls],
    } : {}),
    ...(renderBundle.debugOutlineBackgrounds ? {
      debugOutlineBackgrounds: renderBundle.debugOutlineBackgrounds.map((background) =>
        background ? [...background] as QuakeRenderBundleDebugOutlineBackground : null
      ),
    } : {}),
    ...(renderBundle.debugOutlineOverpainted ? { debugOutlineOverpainted: true } : {}),
    ...(renderBundle.debugTransparentOutlineSourceAssetUrls ? {
      debugTransparentOutlineSourceAssetUrls: [...renderBundle.debugTransparentOutlineSourceAssetUrls],
    } : {}),
    ...(renderBundle.debugTransparentOutlineAssetUrls ? {
      debugTransparentOutlineAssetUrls: [...renderBundle.debugTransparentOutlineAssetUrls],
    } : {}),
    ...(renderBundle.debugTransparentOutlineBackgrounds ? {
      debugTransparentOutlineBackgrounds: renderBundle.debugTransparentOutlineBackgrounds.map((background) =>
        background ? [...background] as QuakeRenderBundleDebugOutlineBackground : null
      ),
    } : {}),
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
  options: QuakeBspPrepareOptions = {
    lightmapBake: normalizeQuakeLightmapBakeOptions(),
    lightmapOverlay: normalizeQuakeLightmapOverlayOptions(),
    litTextureEncoding: true,
  },
): Promise<QuakePreparedScene> {
  const timer = createQuakePrepareSceneTimer();
  const view = timer.sync("prepare-scene.bsp-view", () => new DataView(buffer));
  timer.sync("prepare-scene.bsp-header", () => {
    assertValidBspHeader(view);
    const version = view.getInt32(0, true);
    if (version !== QUAKE_BSP_VERSION) {
      throw new Error(`Unsupported BSP version ${version}; expected Quake BSP ${QUAKE_BSP_VERSION}.`);
    }
    validateBspLumps(view);
  });

  const { entities, sourceSpawn, spawn } = timer.sync("prepare-scene.entities", () => {
    const entitiesText = readLumpText(view, buffer, BSP_LUMP_ENTITIES);
    const parsedEntities = parseEntities(entitiesText);
    const parsedSpawn = parseSpawn(parsedEntities);
    return {
      entities: parsedEntities,
      sourceSpawn: parsedSpawn,
      spawn: quakeGameplaySpawn(label, parsedSpawn),
    };
  });
  const rawVertices = timer.sync("prepare-scene.vertices", () => parseVertices(view));
  const bounds = timer.sync("prepare-scene.bounds", () => vertexBounds(rawVertices));
  const floorZ = sourceSpawn ? sourceSpawn.origin.z + QUAKE_PLAYER_MINS_Z : bounds.min.z;
  const pivot = sourceSpawn ? { x: sourceSpawn.origin.x, y: sourceSpawn.origin.y, z: floorZ } : {
    x: (bounds.min.x + bounds.max.x) * 0.5,
    y: (bounds.min.y + bounds.max.y) * 0.5,
    z: bounds.min.z,
  };
  const planes = timer.sync("prepare-scene.planes", () => parsePlanes(view));
  const textureUrls: string[] = [];
  const textures = await timer.asyncPhase("prepare-scene.textures", () =>
    parseMipTextures(view, buffer, palette, textureUrls, encodeTextureUrl)
  );
  const { texInfos, edges, surfEdges, faces, clipNodes } = timer.sync("prepare-scene.face-lumps", () => ({
    texInfos: parseTexInfos(view),
    edges: parseEdges(view),
    surfEdges: parseSurfEdges(view),
    faces: parseFaces(view),
    clipNodes: parseClipNodes(view),
  }));
  const { nodes, leaves, markSurfaces, visData } = timer.sync("prepare-scene.visibility-lumps", () => ({
    nodes: parseNodes(view),
    leaves: parseLeaves(view),
    markSurfaces: parseMarkSurfaces(view),
    visData: parseVisibility(view, buffer),
  }));
  const lighting = timer.sync("prepare-scene.lighting", () => parseLighting(view, buffer));
  const { models, preparedModels, faceModels } = timer.sync("prepare-scene.models", () => {
    const parsedModels = parseModels(view);
    return {
      models: parsedModels,
      preparedModels: buildPreparedModels(parsedModels),
      faceModels: buildFaceModelIndices(parsedModels, faces.length),
    };
  });
  const { entityByModel, entityByIndex } = timer.sync("prepare-scene.entity-indexes", () => ({
    entityByModel: buildEntityByModelIndex(entities),
    entityByIndex: new Map(entities.map((entity) => [entity.index, entity])),
  }));
  const model = models[0] ?? {
    mins: bounds.min,
    maxs: bounds.max,
    origin: { x: 0, y: 0, z: 0 },
    headNodes: [0, 0, 0, 0],
    firstFace: 0,
    faceCount: faces.length,
  };
  const brushModels = timer.sync("prepare-scene.brush-models", () => visibleBrushModels(entities, models));
  const candidates: QuakeFaceCandidate[] = [];
  const buildCandidates: QuakeFaceBuildCandidate[] = [];
  const fallbackColorCache = new Map<string, string>();
  const litTextureCache = new Map<string, Promise<string> | string>();
  const skyTextureCache = new Map<string, Promise<string> | string>();
  const textureAnimationSpriteCache = new Map<string, Promise<string> | string>();
  let skyTextureUrl: string | undefined;
  const faceIndices = new Set<number>();
  timer.sync("prepare-scene.face-indexes", () => {
    const endFace = Math.min(faces.length, model.firstFace + model.faceCount);
    for (let faceIndex = model.firstFace; faceIndex < endFace; faceIndex++) {
      faceIndices.add(faceIndex);
    }
    for (const brushModel of brushModels) {
      for (const faceIndex of brushModel.faceIndices) faceIndices.add(faceIndex);
    }
  });

  timer.sync("prepare-scene.build-face-candidates", () => {
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
        face,
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
  });

  const smoothedBrightness = timer.sync("prepare-scene.smooth-brightness", () => smoothFaceBrightness(buildCandidates));
  await timer.asyncPhase("prepare-scene.render-candidates", async () => {
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
    const encodeLitTexture = options.litTextureEncoding ||
      shouldEncodeLitTextureForRenderCandidate(
        candidate,
        texture,
        entityByIndex,
        options.litTextureEncodingTextureNames,
      );
    const textureUrl = encodeLitTexture
      ? await litTextureUrlFor(texture, brightness, palette, textureUrls, litTextureCache, encodeTextureUrl)
      : texture.url;
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
  });

  const sourceFaceCount = timer.sync(
    "prepare-scene.source-face-count",
    () => uniqueSorted(candidates.flatMap((candidate) => candidate.sourceFaceIndices)).length,
  );
  const visibilityKeys = timer.sync("prepare-scene.visibility-keys", () =>
    buildSourceFaceVisibilityKeys(planes, nodes, leaves, markSurfaces, visData, candidates, brushModels)
  );
  const renderCandidates = timer.sync("prepare-scene.merge-candidates", () =>
    mergeQuakeFaceCandidates(candidates, visibilityKeys)
  );
  const buildCandidateByFaceIndex = timer.sync("prepare-scene.build-candidate-index", () =>
    new Map(buildCandidates.map((candidate) => [candidate.faceIndex, candidate]))
  );
  const lightmapOverlaySourceFaceIndices = await timer.asyncPhase(
    "prepare-scene.lightmap-overlay",
    () => applyFaceLightmapOverlayBudgetToRenderCandidates(
      renderCandidates,
      buildCandidateByFaceIndex,
      lighting,
      textures,
      palette,
      textureUrls,
      litTextureCache,
      encodeTextureUrl,
      options.lightmapOverlay,
    ),
  );
  const mergedLightmapOverlayStats = await timer.asyncPhase(
    "prepare-scene.merged-lightmap-overlay",
    () => applyMergedLightmapOverlayPrototypeToRenderCandidates(
      renderCandidates,
      buildCandidateByFaceIndex,
      lighting,
      textures,
      palette,
      textureUrls,
      litTextureCache,
      encodeTextureUrl,
      options.lightmapBake,
      pivot,
      lightmapOverlaySourceFaceIndices,
    ),
  );
  for (const sourceFaceIndex of mergedLightmapOverlayStats.selectedSourceFaceIndices) {
    lightmapOverlaySourceFaceIndices.add(sourceFaceIndex);
  }
  const lightmapBakeStats = await timer.asyncPhase(
    "prepare-scene.lightmap-bake",
    () => applyFaceLightmapBakeToRenderCandidates(
      renderCandidates,
      buildCandidateByFaceIndex,
      lighting,
      textures,
      palette,
      textureUrls,
      litTextureCache,
      encodeTextureUrl,
      options.lightmapBake,
      pivot,
      lightmapOverlaySourceFaceIndices,
    ),
  );
  timer.sync("prepare-scene.wall-bleed", () => applyQuakeWallRenderBleedToCandidates(renderCandidates));
  await timer.asyncPhase(
    "prepare-scene.texture-animation-sprites",
    () => addTextureAnimationSpritesToRenderCandidates(
      renderCandidates,
      textures,
      palette,
      textureAnimationSpriteCache,
      encodeTextureUrl,
    ),
  );
  const polygons = timer.sync("prepare-scene.polygons", () => renderCandidates.map((candidate) => candidate.polygon));
  const serialized = timer.sync("prepare-scene.serialize-polygons", () => serializePreparedPolygons(polygons, textureUrls));
  const skyTexture = timer.sync("prepare-scene.sky-texture-index", () =>
    skyTextureUrl ? serialized.textures.indexOf(skyTextureUrl) : -1
  );
  const warnings: string[] = [];
  if (polygons.length > 2500) {
    warnings.push(`Mounted ${polygons.length} merged BSP faces from ${sourceFaceCount} source faces; trigger brush volumes are excluded.`);
  }
  if (lightmapBakeStats) warnings.push(formatLightmapBakeStats(lightmapBakeStats));
  if (mergedLightmapOverlayStats.selectedCount > 0) {
    warnings.push(formatMergedLightmapOverlayStats(mergedLightmapOverlayStats));
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
  const entityManifest = timer.sync("prepare-scene.entity-manifest", () => buildEntityManifest(entities));
  const collision = timer.sync("prepare-scene.collision", () =>
    buildPreparedCollision(
      planes,
      nodes,
      leaves,
      clipNodes,
      preparedModels,
      entities,
      model.headNodes,
      pivot,
      candidates.map((candidate) => candidate.polygon),
    )
  );
  const gameLogic = timer.sync("prepare-scene.game-logic", () =>
    buildQuakeGameLogicFacts({
      label,
      entities,
      entityManifest,
      models: preparedModels,
      ...(collision ? { collision } : {}),
      programFacts: options.gameLogicProgramFacts,
    })
  );
  const preparedVisibility = timer.sync("prepare-scene.prepared-visibility", () =>
    buildPreparedVisibility(
      planes,
      nodes,
      leaves,
      markSurfaces,
      visData,
      renderCandidates,
      buildCandidates,
      brushModels,
      preparedModels,
      gameLogic,
      pivot,
    )
  );
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
    entityManifest,
    gameLogic,
    models: preparedModels,
    spawn: spawnState,
    visibility: preparedVisibility,
    collision,
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
  sourceCandidates: QuakeFaceBuildCandidate[],
  brushModels: QuakeBrushModel[],
  models: QuakePreparedModel[],
  gameLogic: QuakeGameLogicFacts,
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
    metadata: buildPreparedVisibilityMetadata(
      planes,
      nodes,
      leaves,
      markSurfaces,
      sourceCandidates,
      models,
      gameLogic,
      visData,
    ),
  };
}

interface QuakeVisibilityLeafFaceMaps {
  faceIndexesByLeaf: number[][];
  leafIndexesByFace: Map<number, number[]>;
}

function buildPreparedVisibilityMetadata(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  markSurfaces: number[],
  sourceCandidates: QuakeFaceBuildCandidate[],
  models: QuakePreparedModel[],
  gameLogic: QuakeGameLogicFacts,
  visData: Uint8Array,
): QuakePreparedVisibilityMetadata {
  const sourceFaceIndexes = new Set(sourceCandidates.map((candidate) => candidate.faceIndex));
  const leafFaceMaps = buildVisibilityLeafFaceMaps(leaves, markSurfaces, sourceFaceIndexes);
  const leafAdjacency = buildVisibilityLeafAdjacency(leaves);
  const visibleLeafIndexesByLeaf = buildVisibilityVisibleLeafIndexesByLeaf(leaves, visData);
  const visibleFaceIndexesByLeaf = buildVisibilityVisibleFaceIndexesByLeaf(
    leafFaceMaps.faceIndexesByLeaf,
    visibleLeafIndexesByLeaf,
  );
  return {
    version: 1,
    source: "prepared-bsp",
    pvsSource: "bsp-visdata",
    leafAdjacencySource: "bounds-touch",
    doorLeafCutSource: "bounds-touch-door-intersection",
    leaves: buildVisibilityLeafMetadata(
      leaves,
      leafFaceMaps.faceIndexesByLeaf,
      visibleLeafIndexesByLeaf,
      visibleFaceIndexesByLeaf,
      leafAdjacency,
    ),
    sourceFaces: buildVisibilitySourceFaceMetadata(
      planes,
      nodes,
      leaves,
      sourceCandidates,
      leafFaceMaps.leafIndexesByFace,
    ),
    doorBlockers: buildVisibilityDoorBlockerMetadata(planes, nodes, leaves, leafAdjacency, models, gameLogic),
  };
}

function buildVisibilityLeafFaceMaps(
  leaves: QuakeLeaf[],
  markSurfaces: number[],
  sourceFaceIndexes: Set<number>,
): QuakeVisibilityLeafFaceMaps {
  const faceSetsByLeaf = leaves.map(() => new Set<number>());
  const leafSetsByFace = new Map<number, Set<number>>();
  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    const leaf = leaves[leafIndex];
    if (!leaf) continue;
    const end = leaf.firstMarkSurface + leaf.markSurfaceCount;
    for (let i = leaf.firstMarkSurface; i < end; i++) {
      const faceIndex = markSurfaces[i];
      if (faceIndex === undefined || !sourceFaceIndexes.has(faceIndex)) continue;
      faceSetsByLeaf[leafIndex]?.add(faceIndex);
      const leafSet = leafSetsByFace.get(faceIndex);
      if (leafSet) {
        leafSet.add(leafIndex);
      } else {
        leafSetsByFace.set(faceIndex, new Set([leafIndex]));
      }
    }
  }
  return {
    faceIndexesByLeaf: faceSetsByLeaf.map((set) => [...set].sort((a, b) => a - b)),
    leafIndexesByFace: new Map(
      [...leafSetsByFace].map(([faceIndex, set]) => [faceIndex, [...set].sort((a, b) => a - b)]),
    ),
  };
}

function buildVisibilityLeafMetadata(
  leaves: QuakeLeaf[],
  faceIndexesByLeaf: number[][],
  visibleLeafIndexesByLeaf: Array<number[] | null>,
  visibleFaceIndexesByLeaf: Array<number[] | null>,
  adjacentLeafIndexesByLeaf: number[][],
): QuakeVisibilityLeafMetadata[] {
  return leaves.map((leaf, leafIndex) => ({
    leafIndex,
    contents: leaf.contents,
    bounds: quakeVisibilityBoundsFromMinMax(leaf.mins, leaf.maxs),
    faceIndexes: faceIndexesByLeaf[leafIndex] ?? [],
    visibleLeafIndexes: visibleLeafIndexesByLeaf[leafIndex] ?? null,
    visibleFaceIndexes: visibleFaceIndexesByLeaf[leafIndex] ?? null,
    adjacentLeafIndexes: adjacentLeafIndexesByLeaf[leafIndex] ?? [],
  }));
}

function buildVisibilityVisibleLeafIndexesByLeaf(
  leaves: QuakeLeaf[],
  visData: Uint8Array,
): Array<number[] | null> {
  return leaves.map((leaf, leafIndex) => {
    if (!leaf || leaf.visOffset < 0 || !visData.length) return null;
    const visible = quakeVisibilityDecompressVisibleLeaves(visData, leaf.visOffset, leaves.length);
    const indexes = [leafIndex];
    for (let i = 0; i < visible.length; i++) {
      if (visible[i]) indexes.push(i);
    }
    return [...new Set(indexes)].sort((a, b) => a - b);
  });
}

function buildVisibilityVisibleFaceIndexesByLeaf(
  faceIndexesByLeaf: number[][],
  visibleLeafIndexesByLeaf: Array<number[] | null>,
): Array<number[] | null> {
  return visibleLeafIndexesByLeaf.map((visibleLeafIndexes) => {
    if (!visibleLeafIndexes) return null;
    const faces = new Set<number>();
    for (const leafIndex of visibleLeafIndexes) {
      for (const faceIndex of faceIndexesByLeaf[leafIndex] ?? []) faces.add(faceIndex);
    }
    return [...faces].sort((a, b) => a - b);
  });
}

function buildVisibilitySourceFaceMetadata(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  sourceCandidates: QuakeFaceBuildCandidate[],
  leafIndexesByFace: Map<number, number[]>,
): QuakeVisibilitySourceFaceMetadata[] {
  return sourceCandidates
    .map((candidate) => {
      const bounds = quakeVisibilityBoundsFromVertices(candidate.points);
      const plane = quakeVisibilityClonePlane(planes[candidate.face.plane]);
      const leafIndexes = leafIndexesByFace.get(candidate.faceIndex) ??
        quakeVisibilityLeafIndexesForPoint(bounds.center, planes, nodes, leaves);
      return {
        faceIndex: candidate.faceIndex,
        modelIndex: candidate.modelIndex,
        ...(candidate.entityIndex !== undefined ? { entityIndex: candidate.entityIndex } : {}),
        texture: candidate.texture.name,
        planeIndex: candidate.face.plane,
        plane,
        side: candidate.face.side,
        pointCount: candidate.points.length,
        area: quakeVisibilityFaceArea(candidate.points),
        leafIndexes,
        bounds,
      };
    })
    .sort((a, b) => a.faceIndex - b.faceIndex);
}

function buildVisibilityLeafAdjacency(leaves: QuakeLeaf[]): number[][] {
  const adjacency = leaves.map(() => new Set<number>());
  const bounds = leaves.map((leaf) => quakeVisibilityBoundsFromMinMax(leaf.mins, leaf.maxs));
  for (let a = 0; a < leaves.length; a++) {
    if (leaves[a]?.contents === QUAKE_CONTENTS_SOLID) continue;
    for (let b = a + 1; b < leaves.length; b++) {
      if (leaves[b]?.contents === QUAKE_CONTENTS_SOLID) continue;
      if (!quakeVisibilityBoundsTouch(bounds[a], bounds[b], QUAKE_VISIBILITY_LEAF_ADJACENCY_EPSILON)) continue;
      adjacency[a]?.add(b);
      adjacency[b]?.add(a);
    }
  }
  return adjacency.map((set) => [...set].sort((a, b) => a - b));
}

function buildVisibilityDoorBlockerMetadata(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  leafAdjacency: number[][],
  models: QuakePreparedModel[],
  gameLogic: QuakeGameLogicFacts,
): QuakeVisibilityDoorBlockerMetadata[] {
  const leafBounds = leaves.map((leaf) => quakeVisibilityBoundsFromMinMax(leaf.mins, leaf.maxs));
  const out: QuakeVisibilityDoorBlockerMetadata[] = [];
  for (const entity of gameLogic.entities) {
    const resolvedMover = entity.resolvedMover;
    if (resolvedMover?.kind !== "func_door" && resolvedMover?.kind !== "func_door_secret") continue;
    if (entity.modelIndex === undefined) continue;
    const model = models[entity.modelIndex];
    const baseBounds = quakeVisibilityEntityBrushBounds(entity, model);
    if (!baseBounds) continue;

    const closedBounds = resolvedMover.kind === "func_door"
      ? quakeVisibilityOffsetBounds(
          baseBounds,
          resolvedMover.startsOpen ? resolvedMover.travelOffset : { x: 0, y: 0, z: 0 },
        )
      : baseBounds;
    const openBounds = resolvedMover.kind === "func_door"
      ? quakeVisibilityOffsetBounds(
          baseBounds,
          resolvedMover.startsOpen ? { x: 0, y: 0, z: 0 } : resolvedMover.travelOffset,
        )
      : undefined;
    const triggerBounds = resolvedMover.kind === "func_door" && resolvedMover.trigger
      ? quakeVisibilityBoundsFromMinMax(resolvedMover.trigger.mins, resolvedMover.trigger.maxs)
      : undefined;
    const nearbyBounds = [openBounds, triggerBounds]
      .filter((bounds): bounds is QuakeVisibilityBounds => Boolean(bounds))
      .reduce((acc, bounds) => quakeVisibilityUnionBounds(acc, bounds), closedBounds);

    const leafIndexes = quakeVisibilityLeafIndexesForBounds(
      leaves,
      leafBounds,
      closedBounds,
      QUAKE_VISIBILITY_DOOR_LEAF_EXPANSION,
    );
    const nearbyLeafIndexes = quakeVisibilityLeafIndexesForBounds(
      leaves,
      leafBounds,
      nearbyBounds,
      QUAKE_VISIBILITY_DOOR_NEARBY_LEAF_EXPANSION,
    );
    const centerLeafIndexes = quakeVisibilityLeafIndexesForPoint(closedBounds.center, planes, nodes, leaves);
    for (const leafIndex of centerLeafIndexes) {
      addSortedUniqueNumber(leafIndexes, leafIndex);
      addSortedUniqueNumber(nearbyLeafIndexes, leafIndex);
    }
    const blockedLeafPairCandidates = quakeVisibilityDoorBlockedLeafPairCandidates(
      leafBounds,
      leafAdjacency,
      closedBounds,
      nearbyLeafIndexes,
    );

    out.push({
      entityIndex: entity.entityIndex,
      modelIndex: entity.modelIndex,
      classname: entity.classname,
      kind: resolvedMover.kind,
      linkedEntityIndexes: resolvedMover.kind === "func_door"
        ? [...(resolvedMover.linkedDoorGroup?.linkedEntityIndexes ?? [entity.entityIndex])]
        : [entity.entityIndex],
      closedBounds,
      ...(entity.origin ? { origin: { ...entity.origin } } : {}),
      ...(openBounds ? { openBounds } : {}),
      ...(triggerBounds ? { triggerBounds } : {}),
      ...(resolvedMover.kind === "func_door" ? {
        moveDirection: { ...resolvedMover.moveDirection },
        travelOffset: { ...resolvedMover.travelOffset },
        startsOpen: resolvedMover.startsOpen,
      } : {}),
      faceIndexes: model ? quakeModelFaceIndexes(model) : [],
      leafIndexes,
      nearbyLeafIndexes,
      blockedLeafPairCandidates,
    });
  }
  return out.sort((a, b) => a.entityIndex - b.entityIndex);
}

function quakeVisibilityEntityBrushBounds(
  entity: QuakeGameLogicEntityFact,
  model: QuakePreparedModel | undefined,
): QuakeVisibilityBounds | null {
  if (entity.brushModel) {
    return quakeVisibilityOffsetBounds(
      quakeVisibilityBoundsFromMinMax(entity.brushModel.mins, entity.brushModel.maxs),
      entity.origin ?? { x: 0, y: 0, z: 0 },
    );
  }
  if (!model) return null;
  return quakeVisibilityOffsetBounds(
    quakeVisibilityBoundsFromMinMax(model.mins, model.maxs),
    entity.origin ?? { x: 0, y: 0, z: 0 },
  );
}

function quakeVisibilityLeafIndexesForPoint(
  point: QuakeVertex,
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
): number[] {
  const leafIndex = quakeVisibilityLeafForPoint(point, planes, nodes);
  return leaves[leafIndex] ? [leafIndex] : [];
}

function quakeVisibilityLeafIndexesForBounds(
  leaves: QuakeLeaf[],
  leafBounds: QuakeVisibilityBounds[],
  bounds: QuakeVisibilityBounds,
  expansion: number,
): number[] {
  const queryBounds = quakeVisibilityInflateBounds(bounds, expansion);
  const indexes: number[] = [];
  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    if (leaves[leafIndex]?.contents === QUAKE_CONTENTS_SOLID) continue;
    const leafBound = leafBounds[leafIndex];
    if (leafBound && quakeVisibilityBoundsOverlap(queryBounds, leafBound)) indexes.push(leafIndex);
  }
  return indexes;
}

function quakeVisibilityLeafForPoint(point: QuakeVertex, planes: QuakePlane[], nodes: QuakeNode[]): number {
  let index = 0;
  for (let guard = 0; guard < nodes.length; guard++) {
    const node = nodes[index];
    if (!node) return 0;
    const plane = planes[node.plane];
    if (!plane) return 0;
    const dist = point.x * plane.normal.x + point.y * plane.normal.y + point.z * plane.normal.z - plane.dist;
    const child = node.children[dist >= 0 ? 0 : 1];
    if (child < 0) return -child - 1;
    index = child;
  }
  return 0;
}

function quakeVisibilityDoorBlockedLeafPairCandidates(
  leafBounds: QuakeVisibilityBounds[],
  leafAdjacency: number[][],
  closedBounds: QuakeVisibilityBounds,
  nearbyLeafIndexes: number[],
): Array<[number, number]> {
  const nearby = new Set(nearbyLeafIndexes);
  const queryBounds = quakeVisibilityInflateBounds(closedBounds, QUAKE_VISIBILITY_DOOR_NEARBY_LEAF_EXPANSION);
  const pairs: Array<[number, number]> = [];
  for (const a of nearbyLeafIndexes) {
    const aBounds = leafBounds[a];
    if (!aBounds || !quakeVisibilityBoundsOverlap(queryBounds, aBounds)) continue;
    for (const b of leafAdjacency[a] ?? []) {
      if (b <= a || !nearby.has(b)) continue;
      const bBounds = leafBounds[b];
      if (!bBounds || !quakeVisibilityBoundsOverlap(queryBounds, bBounds)) continue;
      const pairBounds = quakeVisibilityUnionBounds(aBounds, bBounds);
      if (!quakeVisibilityBoundsOverlap(queryBounds, pairBounds)) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

function quakeVisibilityDecompressVisibleLeaves(
  visData: Uint8Array,
  offset: number,
  leafCount: number,
): boolean[] {
  const visible = Array.from({ length: leafCount }, () => false);
  let leaf = 1;
  let cursor = offset;
  while (leaf < leafCount && cursor < visData.length) {
    const value = visData[cursor++] ?? 0;
    if (value !== 0) {
      for (let bit = 0; bit < 8 && leaf < leafCount; bit++, leaf++) {
        visible[leaf] = (value & (1 << bit)) !== 0;
      }
      continue;
    }
    const skip = visData[cursor++] ?? 0;
    leaf += skip * 8;
  }
  return visible;
}

function quakeVisibilityBoundsFromVertices(vertices: QuakeVertex[]): QuakeVisibilityBounds {
  const bounds = vertexBounds(vertices);
  return quakeVisibilityBoundsFromMinMax(bounds.min, bounds.max);
}

function quakeVisibilityClonePlane(plane: QuakePlane | undefined): QuakePlane {
  return {
    normal: {
      x: plane?.normal.x ?? 0,
      y: plane?.normal.y ?? 0,
      z: plane?.normal.z ?? 1,
    },
    dist: plane?.dist ?? 0,
  };
}

function quakeVisibilityFaceArea(vertices: QuakeVertex[]): number {
  const origin = vertices[0];
  if (!origin || vertices.length < 3) return 0;
  let area = 0;
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    if (!a || !b) continue;
    area += quakeVisibilityTriangleArea(origin, a, b);
  }
  return area;
}

function quakeVisibilityTriangleArea(a: QuakeVertex, b: QuakeVertex, c: QuakeVertex): number {
  const ab = {
    x: b.x - a.x,
    y: b.y - a.y,
    z: b.z - a.z,
  };
  const ac = {
    x: c.x - a.x,
    y: c.y - a.y,
    z: c.z - a.z,
  };
  const cross = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  return Math.sqrt(cross.x * cross.x + cross.y * cross.y + cross.z * cross.z) * 0.5;
}

function quakeVisibilityBoundsFromMinMax(mins: QuakeVertex, maxs: QuakeVertex): QuakeVisibilityBounds {
  const normalizedMins = {
    x: Math.min(mins.x, maxs.x),
    y: Math.min(mins.y, maxs.y),
    z: Math.min(mins.z, maxs.z),
  };
  const normalizedMaxs = {
    x: Math.max(mins.x, maxs.x),
    y: Math.max(mins.y, maxs.y),
    z: Math.max(mins.z, maxs.z),
  };
  return {
    mins: normalizedMins,
    maxs: normalizedMaxs,
    center: {
      x: (normalizedMins.x + normalizedMaxs.x) * 0.5,
      y: (normalizedMins.y + normalizedMaxs.y) * 0.5,
      z: (normalizedMins.z + normalizedMaxs.z) * 0.5,
    },
  };
}

function quakeVisibilityOffsetBounds(bounds: QuakeVisibilityBounds, offset: QuakeVertex): QuakeVisibilityBounds {
  return quakeVisibilityBoundsFromMinMax(
    {
      x: bounds.mins.x + offset.x,
      y: bounds.mins.y + offset.y,
      z: bounds.mins.z + offset.z,
    },
    {
      x: bounds.maxs.x + offset.x,
      y: bounds.maxs.y + offset.y,
      z: bounds.maxs.z + offset.z,
    },
  );
}

function quakeVisibilityInflateBounds(bounds: QuakeVisibilityBounds, amount: number): QuakeVisibilityBounds {
  return quakeVisibilityBoundsFromMinMax(
    {
      x: bounds.mins.x - amount,
      y: bounds.mins.y - amount,
      z: bounds.mins.z - amount,
    },
    {
      x: bounds.maxs.x + amount,
      y: bounds.maxs.y + amount,
      z: bounds.maxs.z + amount,
    },
  );
}

function quakeVisibilityUnionBounds(
  a: QuakeVisibilityBounds,
  b: QuakeVisibilityBounds,
): QuakeVisibilityBounds {
  return quakeVisibilityBoundsFromMinMax(
    {
      x: Math.min(a.mins.x, b.mins.x),
      y: Math.min(a.mins.y, b.mins.y),
      z: Math.min(a.mins.z, b.mins.z),
    },
    {
      x: Math.max(a.maxs.x, b.maxs.x),
      y: Math.max(a.maxs.y, b.maxs.y),
      z: Math.max(a.maxs.z, b.maxs.z),
    },
  );
}

function quakeVisibilityBoundsOverlap(a: QuakeVisibilityBounds, b: QuakeVisibilityBounds): boolean {
  return a.mins.x <= b.maxs.x && a.maxs.x >= b.mins.x &&
    a.mins.y <= b.maxs.y && a.maxs.y >= b.mins.y &&
    a.mins.z <= b.maxs.z && a.maxs.z >= b.mins.z;
}

function quakeVisibilityBoundsTouch(
  a: QuakeVisibilityBounds,
  b: QuakeVisibilityBounds,
  epsilon: number,
): boolean {
  const touchX = intervalsTouch(a.mins.x, a.maxs.x, b.mins.x, b.maxs.x, epsilon);
  const touchY = intervalsTouch(a.mins.y, a.maxs.y, b.mins.y, b.maxs.y, epsilon);
  const touchZ = intervalsTouch(a.mins.z, a.maxs.z, b.mins.z, b.maxs.z, epsilon);
  const overlapX = intervalsOverlap(a.mins.x, a.maxs.x, b.mins.x, b.maxs.x, epsilon);
  const overlapY = intervalsOverlap(a.mins.y, a.maxs.y, b.mins.y, b.maxs.y, epsilon);
  const overlapZ = intervalsOverlap(a.mins.z, a.maxs.z, b.mins.z, b.maxs.z, epsilon);
  return (touchX && overlapY && overlapZ) ||
    (touchY && overlapX && overlapZ) ||
    (touchZ && overlapX && overlapY);
}

function intervalsOverlap(aMin: number, aMax: number, bMin: number, bMax: number, epsilon: number): boolean {
  return aMin <= bMax + epsilon && aMax + epsilon >= bMin;
}

function intervalsTouch(aMin: number, aMax: number, bMin: number, bMax: number, epsilon: number): boolean {
  return Math.abs(aMax - bMin) <= epsilon || Math.abs(bMax - aMin) <= epsilon;
}

function quakeModelFaceIndexes(model: QuakePreparedModel): number[] {
  return Array.from({ length: model.faceCount }, (_item, index) => model.firstFace + index);
}

function addSortedUniqueNumber(values: number[], value: number): void {
  if (values.includes(value)) return;
  values.push(value);
  values.sort((a, b) => a - b);
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
      mins: {
        x: view.getInt16(offset + 8, true),
        y: view.getInt16(offset + 10, true),
        z: view.getInt16(offset + 12, true),
      },
      maxs: {
        x: view.getInt16(offset + 14, true),
        y: view.getInt16(offset + 16, true),
        z: view.getInt16(offset + 18, true),
      },
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
  if (points.length < 4) return points;
  let bestArea = faceFirstTripleAreaSq(points);
  let best = points;
  for (let i = 1; i < points.length; i++) {
    const rotated = [...points.slice(i), ...points.slice(0, i)];
    const area = faceFirstTripleAreaSq(rotated);
    if (area > bestArea) {
      bestArea = area;
      best = rotated;
    }
  }
  return bestArea > QUAKE_FACE_NORMAL_AREA_EPS ? best : points;
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
  const visibilityKey = visibilityKeys.get(candidate.faceIndex) ?? `face:${candidate.faceIndex}`;
  if (quakePolygonIsSky(polygon)) {
    return [
      visibilityKey,
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
    visibilityKey,
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

interface QuakeWallBleedBasis {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  localPoints: Vec2[];
}

interface QuakeWallBleedPlan {
  basis: QuakeWallBleedBasis;
  candidate: QuakeFaceCandidate;
  edgeAmounts: number[];
  edgeKeys: string[];
  edgeRenderRisks: number[];
  fallbackRgb: RGB;
  fallbackLuma: number;
  normal: Vec3;
  textureName: string;
  uvAffine: QuakeUvAffine;
}

interface QuakeWallBleedEdgeOwner {
  edgeIndex: number;
  plan: QuakeWallBleedPlan;
}

interface QuakeUvAffine {
  ux: number;
  uy: number;
  u0: number;
  vx: number;
  vy: number;
  v0: number;
}

function applyQuakeWallRenderBleedToCandidates(candidates: QuakeFaceCandidate[]): void {
  const plans = candidates
    .map((candidate) => quakeWallRenderBleedPlan(candidate))
    .filter((plan): plan is QuakeWallBleedPlan => plan !== null);
  if (!plans.length) return;

  const edges = new Map<string, QuakeWallBleedEdgeOwner[]>();
  for (const plan of plans) {
    for (let edgeIndex = 0; edgeIndex < plan.edgeKeys.length; edgeIndex++) {
      const edgeKey = plan.edgeKeys[edgeIndex];
      if (!edgeKey) continue;
      const owners = edges.get(edgeKey);
      if (owners) {
        owners.push({ plan, edgeIndex });
      } else {
        edges.set(edgeKey, [{ plan, edgeIndex }]);
      }
    }
  }

  for (const owners of edges.values()) {
    if (owners.length < 2) continue;
    if (quakeWallBleedSharedEdgeUsesSplitLJunctionBleed(owners)) {
      for (const owner of owners) {
        owner.plan.edgeAmounts[owner.edgeIndex] = Math.max(
          owner.plan.edgeAmounts[owner.edgeIndex] ?? 0,
          QUAKE_WALL_RENDER_L_JUNCTION_BLEED,
        );
      }
      continue;
    }
    const owner = quakeWallBleedOwnerForSharedEdge(owners);
    if (owner) owner.plan.edgeAmounts[owner.edgeIndex] = QUAKE_WALL_RENDER_BLEED;
  }

  for (const plan of plans) {
    if (!plan.edgeAmounts.some((amount) => amount > 0)) continue;
    const polygon = quakeWallRenderBleedPolygon(plan);
    if (polygon) plan.candidate.polygon = polygon;
  }
}

function quakeWallRenderBleedPlan(candidate: QuakeFaceCandidate): QuakeWallBleedPlan | null {
  const polygon = candidate.polygon;
  const uvs = polygon.uvs;
  if (!uvs || uvs.length !== polygon.vertices.length || polygon.vertices.length < 3) return null;

  const textureName = String(polygon.data?.["tex"] ?? "").toLowerCase();
  if (textureName.startsWith("sky") || textureName.startsWith("*")) return null;

  const normal = quakePolygonNormal(polygon.vertices);
  if (Math.abs(normal[2]) > QUAKE_WALL_RENDER_MAX_ABS_NORMAL_Z) return null;

  const basis = quakeWallBleedBasis(polygon.vertices, normal);
  if (!basis) return null;

  const uvAffine = quakeUvAffineForLocalPoints(basis.localPoints, uvs);
  if (!uvAffine) return null;
  const fallbackRgb = quakeWallBleedFallbackRgb(polygon.color);

  return {
    basis,
    candidate,
    edgeAmounts: Array.from({ length: polygon.vertices.length }, () => 0),
    edgeKeys: polygon.vertices.map((_, index) => quakeWallBleedEdgeKey(polygon.vertices, index)),
    edgeRenderRisks: quakeWallBleedRenderRiskScores(polygon, candidate.faceIndex),
    fallbackRgb,
    fallbackLuma: quakeWallBleedRgbLuma(fallbackRgb),
    normal,
    textureName,
    uvAffine,
  };
}

function quakeWallBleedOwnerForSharedEdge(owners: QuakeWallBleedEdgeOwner[]): QuakeWallBleedEdgeOwner | null {
  const riskyOwners = owners.filter((owner) => (owner.plan.edgeRenderRisks[owner.edgeIndex] ?? 0) > 0);
  if (!riskyOwners.length) return null;
  if (!quakeWallBleedSharedEdgeIsCorner(owners)) return null;
  if (!quakeWallBleedSharedEdgeIsVisible(owners)) return null;
  if (quakeWallBleedSharedEdgeIsSimpleLJunction(owners)) return null;

  return riskyOwners.reduce((best, next) => {
    const bestScore = quakeWallBleedEdgeOwnerScore(best);
    const nextScore = quakeWallBleedEdgeOwnerScore(next);
    return nextScore > bestScore ||
      (nextScore === bestScore && next.plan.candidate.faceIndex < best.plan.candidate.faceIndex)
      ? next
      : best;
  });
}

function quakeWallBleedEdgeOwnerScore(owner: QuakeWallBleedEdgeOwner): number {
  return (owner.plan.edgeRenderRisks[owner.edgeIndex] ?? 0) * 1000 +
    owner.plan.fallbackLuma;
}

function quakeWallBleedSharedEdgeUsesSplitLJunctionBleed(owners: QuakeWallBleedEdgeOwner[]): boolean {
  if (!owners.some((owner) => (owner.plan.edgeRenderRisks[owner.edgeIndex] ?? 0) > 0)) return false;
  if (!quakeWallBleedSharedEdgeIsCorner(owners)) return false;
  if (!quakeWallBleedSharedEdgeIsSimpleLJunction(owners)) return false;
  return quakeWallBleedSharedEdgeIsVisible(owners);
}

function quakeWallBleedSharedEdgeIsCorner(owners: QuakeWallBleedEdgeOwner[]): boolean {
  for (let first = 0; first < owners.length - 1; first++) {
    for (let second = first + 1; second < owners.length; second++) {
      const dot = Math.abs(quakeVecDot3(owners[first].plan.normal, owners[second].plan.normal));
      if (dot < QUAKE_WALL_RENDER_PARALLEL_NORMAL_DOT) return true;
    }
  }
  return false;
}

function quakeWallBleedSharedEdgeIsSimpleLJunction(owners: QuakeWallBleedEdgeOwner[]): boolean {
  if (owners.length !== 2) return false;
  const dot = Math.abs(quakeVecDot3(owners[0].plan.normal, owners[1].plan.normal));
  return dot <= QUAKE_WALL_RENDER_L_JUNCTION_NORMAL_DOT;
}

function quakeWallBleedSharedEdgeIsVisible(owners: QuakeWallBleedEdgeOwner[]): boolean {
  if (owners.some((owner) => owner.plan.fallbackLuma >= QUAKE_WALL_RENDER_MIN_VISIBLE_EDGE_LUMA)) {
    return true;
  }

  for (let first = 0; first < owners.length - 1; first++) {
    for (let second = first + 1; second < owners.length; second++) {
      const a = owners[first].plan;
      const b = owners[second].plan;
      if (a.textureName === b.textureName) continue;
      if (quakeWallBleedRgbDistance(a.fallbackRgb, b.fallbackRgb) >= QUAKE_WALL_RENDER_MIN_VISIBLE_EDGE_COLOR_DELTA) {
        return true;
      }
    }
  }

  return false;
}

function quakeWallBleedRenderRiskScores(polygon: Polygon, faceIndex: number): number[] {
  const empty = Array.from({ length: polygon.vertices.length }, () => 0);
  const plan = computeTextureAtlasPlanPublic(polygon, faceIndex, {
    tileSize: BASE_TILE,
    layerElevation: BASE_TILE,
  });
  if (!plan || plan.screenPts.length !== polygon.vertices.length * 2) return empty;
  return polygon.vertices.map((_, edgeIndex) => quakeWallBleedRenderRiskScore(plan, edgeIndex));
}

function quakeWallBleedRenderRiskScore(
  plan: { canvasH: number; canvasW: number; screenPts: number[] },
  edgeIndex: number,
): number {
  const vertexCount = plan.screenPts.length / 2;
  const nextIndex = (edgeIndex + 1) % vertexCount;
  const ax = plan.screenPts[edgeIndex * 2];
  const ay = plan.screenPts[edgeIndex * 2 + 1];
  const bx = plan.screenPts[nextIndex * 2];
  const by = plan.screenPts[nextIndex * 2 + 1];
  if (![ax, ay, bx, by].every(Number.isFinite)) return 0;

  const dx = bx - ax;
  const dy = by - ay;
  if (Math.hypot(dx, dy) <= QUAKE_WALL_RENDER_ATLAS_EDGE_EPS) return 0;

  const horizontal = Math.abs(dy) <= QUAKE_WALL_RENDER_ATLAS_EDGE_EPS;
  const vertical = Math.abs(dx) <= QUAKE_WALL_RENDER_ATLAS_EDGE_EPS;
  let score = 0;
  if (!horizontal && !vertical) score += 3;
  if (
    Math.max(
      quakeWallBleedPixelFraction(ax),
      quakeWallBleedPixelFraction(ay),
      quakeWallBleedPixelFraction(bx),
      quakeWallBleedPixelFraction(by),
    ) > QUAKE_WALL_RENDER_ATLAS_EDGE_FRACTION_EPS
  ) {
    score += 2;
  }

  const onOuterLine = (horizontal && (quakeWallBleedClose(ay, 0) || quakeWallBleedClose(ay, plan.canvasH))) ||
    (vertical && (quakeWallBleedClose(ax, 0) || quakeWallBleedClose(ax, plan.canvasW)));
  if (!onOuterLine) {
    score += 1;
  } else if (!quakeWallBleedSpansAtlasSide(plan, ax, ay, bx, by, horizontal, vertical)) {
    score += 1;
  }

  return score;
}

function quakeWallBleedSpansAtlasSide(
  plan: { canvasH: number; canvasW: number },
  ax: number,
  ay: number,
  bx: number,
  by: number,
  horizontal: boolean,
  vertical: boolean,
): boolean {
  if (horizontal) {
    return quakeWallBleedClose(Math.min(ax, bx), 0) &&
      quakeWallBleedClose(Math.max(ax, bx), plan.canvasW);
  }
  if (vertical) {
    return quakeWallBleedClose(Math.min(ay, by), 0) &&
      quakeWallBleedClose(Math.max(ay, by), plan.canvasH);
  }
  return false;
}

function quakeWallBleedClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= QUAKE_WALL_RENDER_ATLAS_EDGE_EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

function quakeWallBleedPixelFraction(value: number): number {
  return Math.abs(value - Math.round(value));
}

function quakeWallBleedFallbackRgb(color: string | undefined): RGB {
  if (!color) return [204, 204, 204];
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const value = hex[1];
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  }
  const shortHex = /^#([0-9a-f]{3})$/i.exec(color);
  if (shortHex) {
    return shortHex[1].split("").map((part) => parseInt(`${part}${part}`, 16)) as RGB;
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  if (rgba) {
    return [
      quakeClampColorChannel(Number(rgba[1])),
      quakeClampColorChannel(Number(rgba[2])),
      quakeClampColorChannel(Number(rgba[3])),
    ];
  }
  return [204, 204, 204];
}

function quakeWallBleedRgbLuma([r, g, b]: RGB): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function quakeWallBleedRgbDistance(a: RGB, b: RGB): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function quakeClampColorChannel(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 204;
}

function quakeWallRenderBleedPolygon(plan: QuakeWallBleedPlan): Polygon | null {
  const polygon = plan.candidate.polygon;
  const expandedPoints = quakeWallBleedLocalPoints(plan.basis.localPoints, plan.edgeAmounts);

  const vertices: Vec3[] = [];
  const expandedUvs: Vec2[] = [];
  for (let index = 0; index < expandedPoints.length; index++) {
    const point = expandedPoints[index];
    if (!point) return null;
    vertices.push(quakeWallBleedLocalToWorld(point, plan.basis));
    expandedUvs.push(quakeUvAffineAt(point, plan.uvAffine));
  }

  const { textureTriangles: _textureTriangles, ...rest } = polygon;
  return {
    ...rest,
    vertices,
    uvs: expandedUvs,
  };
}

function quakeWallBleedLocalPoints(points: Vec2[], edgeAmounts: number[]): Vec2[] {
  const area = quakeSignedArea2(points);
  if (Math.abs(area) <= QUAKE_RENDER_COLLINEAR_EPS) return points;
  const winding = area >= 0 ? 1 : -1;
  const offsets = points.map(() => [0, 0] as Vec2);

  for (let index = 0; index < points.length; index++) {
    const amount = edgeAmounts[index] ?? 0;
    if (amount <= 0) continue;
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) continue;
    const dx = next[0] - current[0];
    const dy = next[1] - current[1];
    const length = Math.hypot(dx, dy);
    if (length <= QUAKE_RENDER_COLLINEAR_EPS) continue;
    const offset: Vec2 = [
      winding * (dy / length) * amount,
      winding * (-dx / length) * amount,
    ];
    offsets[index][0] += offset[0];
    offsets[index][1] += offset[1];
    const nextIndex = (index + 1) % points.length;
    offsets[nextIndex][0] += offset[0];
    offsets[nextIndex][1] += offset[1];
  }

  return points.map((point, index) =>
    quakeClampWallBleedPoint(point, [
      point[0] + offsets[index][0],
      point[1] + offsets[index][1],
    ]),
  );
}

function quakeClampWallBleedPoint(original: Vec2, expanded: Vec2): Vec2 {
  const dx = expanded[0] - original[0];
  const dy = expanded[1] - original[1];
  const distance = Math.hypot(dx, dy);
  if (distance <= QUAKE_WALL_RENDER_MAX_VERTEX_BLEED) return expanded;
  const scale = QUAKE_WALL_RENDER_MAX_VERTEX_BLEED / distance;
  return [
    original[0] + dx * scale,
    original[1] + dy * scale,
  ];
}

function quakeSignedArea2(points: Vec2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) continue;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area * 0.5;
}

function quakeWallBleedEdgeKey(vertices: Vec3[], index: number): string {
  const current = vertices[index];
  const next = vertices[(index + 1) % vertices.length];
  if (!current || !next) return "";
  const a = quakeWallBleedVertexKey(current);
  const b = quakeWallBleedVertexKey(next);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function quakeWallBleedVertexKey(vertex: Vec3): string {
  return vertex.map((value) => String(Math.round(value / QUAKE_WALL_RENDER_EDGE_KEY_EPS))).join(",");
}

function quakeWallBleedBasis(vertices: Vec3[], normal: Vec3): QuakeWallBleedBasis | null {
  const origin = vertices[0];
  if (!origin) return null;
  let xAxis: Vec3 | null = null;
  for (let index = 0; index < vertices.length; index++) {
    const next = vertices[(index + 1) % vertices.length];
    const current = vertices[index];
    if (!current || !next) continue;
    const edge = quakeVecSub3(next, current);
    const length = quakeVecLength3(edge);
    if (length <= QUAKE_RENDER_COLLINEAR_EPS) continue;
    xAxis = [edge[0] / length, edge[1] / length, edge[2] / length];
    break;
  }
  if (!xAxis) return null;
  const yAxisRaw = quakeVecCross3(normal, xAxis);
  const yLength = quakeVecLength3(yAxisRaw);
  if (yLength <= QUAKE_RENDER_COLLINEAR_EPS) return null;
  const yAxis: Vec3 = [yAxisRaw[0] / yLength, yAxisRaw[1] / yLength, yAxisRaw[2] / yLength];
  const localPoints = vertices.map((vertex) => {
    const delta = quakeVecSub3(vertex, origin);
    return [quakeVecDot3(delta, xAxis), quakeVecDot3(delta, yAxis)] as Vec2;
  });
  return { origin, xAxis, yAxis, localPoints };
}

function quakeWallBleedLocalToWorld(point: Vec2, basis: QuakeWallBleedBasis): Vec3 {
  return [
    basis.origin[0] + basis.xAxis[0] * point[0] + basis.yAxis[0] * point[1],
    basis.origin[1] + basis.xAxis[1] * point[0] + basis.yAxis[1] * point[1],
    basis.origin[2] + basis.xAxis[2] * point[0] + basis.yAxis[2] * point[1],
  ];
}

function quakeUvAffineForLocalPoints(points: Vec2[], uvs: Vec2[]): QuakeUvAffine | null {
  for (let first = 0; first < points.length - 2; first++) {
    for (let second = first + 1; second < points.length - 1; second++) {
      for (let third = second + 1; third < points.length; third++) {
        const affine = quakeUvAffineFromTriple(
          points[first],
          points[second],
          points[third],
          uvs[first],
          uvs[second],
          uvs[third],
        );
        if (affine && quakeUvAffineMatches(points, uvs, affine)) return affine;
      }
    }
  }
  return null;
}

function quakeUvAffineFromTriple(
  p0: Vec2 | undefined,
  p1: Vec2 | undefined,
  p2: Vec2 | undefined,
  uv0: Vec2 | undefined,
  uv1: Vec2 | undefined,
  uv2: Vec2 | undefined,
): QuakeUvAffine | null {
  if (!p0 || !p1 || !p2 || !uv0 || !uv1 || !uv2) return null;
  const x1 = p1[0] - p0[0];
  const y1 = p1[1] - p0[1];
  const x2 = p2[0] - p0[0];
  const y2 = p2[1] - p0[1];
  const det = x1 * y2 - y1 * x2;
  if (Math.abs(det) <= QUAKE_RENDER_COLLINEAR_EPS) return null;
  const du1 = uv1[0] - uv0[0];
  const du2 = uv2[0] - uv0[0];
  const dv1 = uv1[1] - uv0[1];
  const dv2 = uv2[1] - uv0[1];
  const ux = (du1 * y2 - du2 * y1) / det;
  const uy = (x1 * du2 - x2 * du1) / det;
  const vx = (dv1 * y2 - dv2 * y1) / det;
  const vy = (x1 * dv2 - x2 * dv1) / det;
  return {
    ux,
    uy,
    u0: uv0[0] - ux * p0[0] - uy * p0[1],
    vx,
    vy,
    v0: uv0[1] - vx * p0[0] - vy * p0[1],
  };
}

function quakeUvAffineMatches(points: Vec2[], uvs: Vec2[], affine: QuakeUvAffine): boolean {
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const uv = uvs[index];
    if (!point || !uv) return false;
    const actual = quakeUvAffineAt(point, affine);
    if (
      !quakeUvClose(actual[0], uv[0]) ||
      !quakeUvClose(actual[1], uv[1])
    ) {
      return false;
    }
  }
  return true;
}

function quakeUvAffineAt(point: Vec2, affine: QuakeUvAffine): Vec2 {
  return [
    affine.ux * point[0] + affine.uy * point[1] + affine.u0,
    affine.vx * point[0] + affine.vy * point[1] + affine.v0,
  ];
}

function quakeUvClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= QUAKE_WALL_RENDER_UV_AFFINE_EPS * Math.max(1, Math.abs(a), Math.abs(b));
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
  let bestNormal = { x: 0, y: 0, z: 0 };
  let bestArea = 0;
  for (let i = 0; i < points.length - 2; i++) {
    const a = points[i];
    if (!a) continue;
    for (let j = i + 1; j < points.length - 1; j++) {
      const b = points[j];
      if (!b) continue;
      for (let k = j + 1; k < points.length; k++) {
        const c = points[k];
        if (!c) continue;
        const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const normal = {
          x: ab.y * ac.z - ab.z * ac.y,
          y: ab.z * ac.x - ab.x * ac.z,
          z: ab.x * ac.y - ab.y * ac.x,
        };
        const area = normal.x * normal.x + normal.y * normal.y + normal.z * normal.z;
        if (area > bestArea) {
          bestArea = area;
          bestNormal = normal;
        }
      }
    }
  }
  if (bestArea > QUAKE_FACE_NORMAL_AREA_EPS) {
    const length = Math.hypot(bestNormal.x, bestNormal.y, bestNormal.z);
    return {
      x: bestNormal.x / length,
      y: bestNormal.y / length,
      z: bestNormal.z / length,
    };
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

async function applyFaceLightmapOverlayBudgetToRenderCandidates(
  renderCandidates: QuakeFaceCandidate[],
  buildCandidateByFaceIndex: Map<number, QuakeFaceBuildCandidate>,
  lighting: Uint8Array,
  textures: Array<QuakeMipTexture | null>,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
  options: QuakeLightmapOverlayOptions,
): Promise<Set<number>> {
  const selectedSourceFaceIndices = new Set<number>();
  if (!options.enabled || options.maxExtraRatio <= 0) return selectedSourceFaceIndices;
  const maxExtraLeaves = Math.floor(renderCandidates.length * options.maxExtraRatio);
  if (maxExtraLeaves <= 0) return selectedSourceFaceIndices;

  const selections: QuakeFaceLightmapOverlaySelection[] = [];
  for (const renderCandidate of renderCandidates) {
    if (renderCandidate.sourceFaceIndices.length !== 1) continue;
    const sourceFaceIndex = renderCandidate.sourceFaceIndices[0];
    const sourceCandidate = sourceFaceIndex === undefined
      ? undefined
      : buildCandidateByFaceIndex.get(sourceFaceIndex);
    if (!sourceCandidate) continue;
    const brightness = brightnessFromPolygonData(renderCandidate.polygon.data?.["lit"]) ?? sourceCandidate.brightness;
    const selection = await faceLightmapOverlaySelectionFor(
      renderCandidate,
      sourceCandidate,
      brightness,
      lighting,
      textures,
      palette,
      urls,
      cache,
      encodeTextureUrl,
      options,
    );
    if (selection) selections.push(selection);
  }

  selections.sort((a, b) => b.score - a.score || a.sourceFaceIndex - b.sourceFaceIndex);
  const overlays: QuakeFaceCandidate[] = [];
  for (const selection of selections.slice(0, maxExtraLeaves)) {
    const baseTexture = await litTextureUrlFor(
      selection.sourceCandidate.texture,
      selection.baseBrightness,
      palette,
      urls,
      cache,
      encodeTextureUrl,
    );
    selection.renderCandidate.polygon = {
      ...selection.renderCandidate.polygon,
      texture: baseTexture,
      textureWrap: REPEAT_WRAP,
      textureAlphaMode: "opaque",
      color: litTextureFallbackColor(selection.sourceCandidate.texture, selection.baseBrightness, palette, new Map()),
      data: {
        ...selection.renderCandidate.polygon.data,
        "lit": formatQuakeBrightness(selection.baseBrightness),
        "lm-overlay-base": true,
      },
    };
    overlays.push(selection.overlay);
    selectedSourceFaceIndices.add(selection.sourceFaceIndex);
  }
  renderCandidates.push(...overlays);
  return selectedSourceFaceIndices;
}

async function applyMergedLightmapOverlayPrototypeToRenderCandidates(
  renderCandidates: QuakeFaceCandidate[],
  buildCandidateByFaceIndex: Map<number, QuakeFaceBuildCandidate>,
  lighting: Uint8Array,
  textures: Array<QuakeMipTexture | null>,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
  options: QuakeLightmapBakeOptions,
  pivot: QuakeVertex,
  skipSourceFaceIndices = new Set<number>(),
): Promise<QuakeMergedLightmapOverlayStats> {
  const selectedSourceFaceIndices = new Set<number>();
  if (!options.enabled || !options.mergedOverlay || options.mergedOverlayMaxExtraRatio <= 0) {
    return {
      cappedByLeaves: false,
      candidateCount: 0,
      detailWeight: 0,
      maxExtraLeaves: 0,
      selectedCount: 0,
      selectedSourceFaceIndices,
      sourceFaceCount: 0,
      texels: 0,
    };
  }

  const maxExtraLeaves = Math.floor(renderCandidates.length * options.mergedOverlayMaxExtraRatio);
  if (maxExtraLeaves <= 0) {
    return {
      cappedByLeaves: false,
      candidateCount: 0,
      detailWeight: 0,
      maxExtraLeaves,
      selectedCount: 0,
      selectedSourceFaceIndices,
      sourceFaceCount: 0,
      texels: 0,
    };
  }

  const selections: QuakeMergedLightmapOverlaySelection[] = [];
  for (const renderCandidate of renderCandidates) {
    const selection = mergedLightmapOverlaySelectionFor(
      renderCandidate,
      buildCandidateByFaceIndex,
      lighting,
      textures,
      options,
      pivot,
      skipSourceFaceIndices,
    );
    if (selection) selections.push(selection);
  }

  selections.sort((a, b) =>
    b.detailWeight / Math.max(1, b.texelCount) - a.detailWeight / Math.max(1, a.texelCount) ||
    b.detailWeight - a.detailWeight ||
    a.faceIndex - b.faceIndex
  );

  let detailWeight = 0;
  let texels = 0;
  let selectedCount = 0;
  let cappedByLeaves = false;
  const overlays: QuakeFaceCandidate[] = [];
  for (const selection of selections) {
    if (selectedCount >= maxExtraLeaves) {
      cappedByLeaves = true;
      break;
    }
    const overlay = await encodeMergedLightmapOverlaySelection(
      selection,
      lighting,
      palette,
      urls,
      cache,
      encodeTextureUrl,
      pivot,
    );
    if (!overlay) continue;
    const sourceTexture = selection.sourceFaces[0]?.sourceCandidate.texture;
    if (!sourceTexture) continue;
    const baseTexture = await litTextureUrlFor(
      sourceTexture,
      selection.baseBrightness,
      palette,
      urls,
      cache,
      encodeTextureUrl,
    );
    for (const baseRenderCandidate of selection.baseRenderCandidates) {
      baseRenderCandidate.polygon = {
        ...baseRenderCandidate.polygon,
        texture: baseTexture,
        textureWrap: REPEAT_WRAP,
        textureAlphaMode: "opaque",
        color: litTextureFallbackColor(sourceTexture, selection.baseBrightness, palette, new Map()),
        data: {
          ...baseRenderCandidate.polygon.data,
          "lit": formatQuakeBrightness(selection.baseBrightness),
          "lm-merged-overlay-base": true,
        },
      };
    }
    overlays.push(overlay);
    detailWeight += selection.detailWeight;
    texels += selection.texelCount;
    selectedCount++;
    for (const sourceFace of selection.sourceFaces) {
      selectedSourceFaceIndices.add(sourceFace.sourceCandidate.faceIndex);
    }
  }

  renderCandidates.push(...overlays);
  return {
    cappedByLeaves,
    candidateCount: selections.length,
    detailWeight,
    maxExtraLeaves,
    selectedCount,
    selectedSourceFaceIndices,
    sourceFaceCount: selectedSourceFaceIndices.size,
    texels,
  };
}

async function applyFaceLightmapBakeToRenderCandidates(
  renderCandidates: QuakeFaceCandidate[],
  buildCandidateByFaceIndex: Map<number, QuakeFaceBuildCandidate>,
  lighting: Uint8Array,
  textures: Array<QuakeMipTexture | null>,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
  options: QuakeLightmapBakeOptions,
  pivot: QuakeVertex,
  skipSourceFaceIndices = new Set<number>(),
): Promise<QuakeLightmapBakeStats | undefined> {
  if (!options.enabled) return undefined;
  const selections: QuakeFaceLightmapBakeSelection[] = [];
  const rejected: QuakeLightmapBakeTextureFidelityRejectedSelectionCollector = {
    selections: [],
    textureFidelityCount: 0,
    textureFidelityDetailWeight: 0,
    textureFidelityTexels: 0,
  };
  for (const renderCandidate of renderCandidates) {
    if (renderCandidate.sourceFaceIndices.length !== 1) continue;
    const sourceFaceIndex = renderCandidate.sourceFaceIndices[0];
    if (sourceFaceIndex === undefined || skipSourceFaceIndices.has(sourceFaceIndex)) continue;
    const sourceCandidate = sourceFaceIndex === undefined
      ? undefined
      : buildCandidateByFaceIndex.get(sourceFaceIndex);
    if (!sourceCandidate) continue;
    const selection = faceLightmapBakeSelectionFor(
      renderCandidate,
      sourceCandidate,
      lighting,
      textures,
      options,
      rejected,
      pivot,
    );
    if (selection) selections.push(selection);
  }

  let texelsUsed = 0;
  let detailWeightUsed = 0;
  let selectedCount = 0;
  let cappedByTexels = false;
  const bakeEligibleTexels = selections.reduce((total, selection) => total + selection.texelCount, 0);
  const bakeEligibleDetailWeight = selections.reduce((total, selection) => total + selection.detailWeight, 0);
  const totalTexels = bakeEligibleTexels + rejected.textureFidelityTexels;
  const totalDetailWeight = bakeEligibleDetailWeight + rejected.textureFidelityDetailWeight;
  const targetDetailWeight = totalDetailWeight * options.detailTargetRatio;
  selections.sort((a, b) =>
    b.detailDensity - a.detailDensity ||
    b.detailWeight - a.detailWeight ||
    a.sourceCandidate.faceIndex - b.sourceCandidate.faceIndex
  );
  for (const selection of selections) {
    if (totalDetailWeight > 0 && detailWeightUsed >= targetDetailWeight) break;
    if (texelsUsed + selection.texelCount > options.maxTotalTexels) {
      cappedByTexels = true;
      continue;
    }
    const baked = await encodeFaceLightmapBakeSelection(
      selection,
      lighting,
      palette,
      urls,
      cache,
      encodeTextureUrl,
      options,
    );
    if (!baked) continue;
    selection.renderCandidate.polygon = {
      ...selection.renderCandidate.polygon,
      texture: baked.url,
      uvs: selection.uvs,
      textureWrap: undefined,
      color: litTextureFallbackColor(selection.sourceCandidate.texture, selection.baseBrightness, palette, new Map()),
      data: {
        ...selection.renderCandidate.polygon.data,
        "lit": formatQuakeBrightness(selection.baseBrightness),
        "lm-bake": true,
        "lm-range": formatQuakeBrightness(selection.displayRange),
        "lm-texels": selection.texelCount,
      },
    };
    texelsUsed += selection.texelCount;
    detailWeightUsed += selection.detailWeight;
    selectedCount++;
  }
  const mergedFallbackOverlayStats = await applyLightmapBakeMergedFallbackOverlayIslandsToRenderCandidates(
    renderCandidates,
    rejected.selections,
    lighting,
    palette,
    urls,
    cache,
    encodeTextureUrl,
    options,
    pivot,
    Math.max(0, targetDetailWeight - detailWeightUsed),
  );
  const fallbackSelections = mergedFallbackOverlayStats.selectedSourceFaceIndices.size > 0
    ? rejected.selections.filter((selection) =>
        !mergedFallbackOverlayStats.selectedSourceFaceIndices.has(selection.sourceCandidate.faceIndex)
      )
    : rejected.selections;
  const fallbackOverlayStats = await applyFaceLightmapBakeTextureFallbackOverlaysToRenderCandidates(
    renderCandidates,
    fallbackSelections,
    lighting,
    palette,
    urls,
    cache,
    encodeTextureUrl,
    options,
    Math.max(0, targetDetailWeight - detailWeightUsed - mergedFallbackOverlayStats.detailWeight),
  );
  return {
    candidateDetailWeight: totalDetailWeight,
    candidateTexels: totalTexels,
    detailTargetRatio: options.detailTargetRatio,
    fallbackOverlayCappedByLeaves: fallbackOverlayStats.cappedByLeaves,
    fallbackOverlayCount: fallbackOverlayStats.selectedCount,
    fallbackOverlayDetailWeight: fallbackOverlayStats.detailWeight,
    fallbackOverlayMaxExtraLeaves: fallbackOverlayStats.maxExtraLeaves,
    fallbackOverlayTexels: fallbackOverlayStats.texels,
    mergedFallbackOverlayCandidateCount: mergedFallbackOverlayStats.candidateCount,
    mergedFallbackOverlayCount: mergedFallbackOverlayStats.selectedCount,
    mergedFallbackOverlayDetailWeight: mergedFallbackOverlayStats.detailWeight,
    mergedFallbackOverlaySourceFaceCount: mergedFallbackOverlayStats.sourceFaceCount,
    mergedFallbackOverlayTexels: mergedFallbackOverlayStats.texels,
    maxTotalTexels: options.maxTotalTexels,
    selectedDetailWeight: detailWeightUsed + mergedFallbackOverlayStats.detailWeight + fallbackOverlayStats.detailWeight,
    selectedTexels: texelsUsed,
    selectedCount,
    totalCount: selections.length,
    cappedByTexels,
    textureFidelityRejectedCount: rejected.textureFidelityCount,
    textureFidelityRejectedDetailWeight: rejected.textureFidelityDetailWeight,
    textureFidelityRejectedTexels: rejected.textureFidelityTexels,
  };
}

async function applyLightmapBakeMergedFallbackOverlayIslandsToRenderCandidates(
  renderCandidates: QuakeFaceCandidate[],
  selections: QuakeFaceLightmapBakeSelection[],
  lighting: Uint8Array,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
  options: QuakeLightmapBakeOptions,
  pivot: QuakeVertex,
  targetDetailWeight: number,
): Promise<QuakeMergedLightmapOverlayStats> {
  const selectedSourceFaceIndices = new Set<number>();
  if (!options.mergedOverlay || options.mergedOverlayMaxExtraRatio <= 0 || targetDetailWeight <= 0) {
    return {
      cappedByLeaves: false,
      candidateCount: 0,
      detailWeight: 0,
      maxExtraLeaves: 0,
      selectedCount: 0,
      selectedSourceFaceIndices,
      sourceFaceCount: 0,
      texels: 0,
    };
  }

  const maxExtraLeaves = Math.floor(renderCandidates.length * options.mergedOverlayMaxExtraRatio);
  if (maxExtraLeaves <= 0) {
    return {
      cappedByLeaves: selections.length > 0,
      candidateCount: 0,
      detailWeight: 0,
      maxExtraLeaves,
      selectedCount: 0,
      selectedSourceFaceIndices,
      sourceFaceCount: 0,
      texels: 0,
    };
  }

  const islands = mergedFallbackOverlayIslandSelectionsFor(selections, options, pivot);
  islands.sort((a, b) =>
    b.detailWeight / Math.max(1, b.texelCount) - a.detailWeight / Math.max(1, a.texelCount) ||
    b.detailWeight - a.detailWeight ||
    a.faceIndex - b.faceIndex
  );

  let detailWeight = 0;
  let texels = 0;
  let selectedCount = 0;
  let cappedByLeaves = false;
  const overlays: QuakeFaceCandidate[] = [];
  for (const island of islands) {
    if (detailWeight >= targetDetailWeight) break;
    if (selectedCount >= maxExtraLeaves) {
      cappedByLeaves = true;
      break;
    }
    if (island.sourceFaces.some((sourceFace) => selectedSourceFaceIndices.has(sourceFace.sourceCandidate.faceIndex))) {
      continue;
    }

    const overlay = await encodeMergedLightmapOverlaySelection(
      island,
      lighting,
      palette,
      urls,
      cache,
      encodeTextureUrl,
      pivot,
    );
    if (!overlay) continue;
    const sourceTexture = island.sourceFaces[0]?.sourceCandidate.texture;
    if (!sourceTexture) continue;
    const baseTexture = await litTextureUrlFor(
      sourceTexture,
      island.baseBrightness,
      palette,
      urls,
      cache,
      encodeTextureUrl,
    );
    for (const baseRenderCandidate of island.baseRenderCandidates) {
      baseRenderCandidate.polygon = {
        ...baseRenderCandidate.polygon,
        texture: baseTexture,
        textureWrap: REPEAT_WRAP,
        textureAlphaMode: "opaque",
        color: litTextureFallbackColor(sourceTexture, island.baseBrightness, palette, new Map()),
        data: {
          ...baseRenderCandidate.polygon.data,
          "lit": formatQuakeBrightness(island.baseBrightness),
          "lm-merged-fallback-base": true,
        },
      };
    }
    overlays.push(overlay);
    detailWeight += island.detailWeight;
    texels += island.texelCount;
    selectedCount++;
    for (const sourceFace of island.sourceFaces) {
      selectedSourceFaceIndices.add(sourceFace.sourceCandidate.faceIndex);
    }
  }

  renderCandidates.push(...overlays);
  return {
    cappedByLeaves,
    candidateCount: islands.length,
    detailWeight,
    maxExtraLeaves,
    selectedCount,
    selectedSourceFaceIndices,
    sourceFaceCount: selectedSourceFaceIndices.size,
    texels,
  };
}

async function applyFaceLightmapBakeTextureFallbackOverlaysToRenderCandidates(
  renderCandidates: QuakeFaceCandidate[],
  selections: QuakeFaceLightmapBakeSelection[],
  lighting: Uint8Array,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
  options: QuakeLightmapBakeOptions,
  targetDetailWeight: number,
): Promise<QuakeLightmapBakeFallbackOverlayStats> {
  if (!options.textureFallbackOverlay || options.textureFallbackOverlayMaxExtraRatio <= 0 || targetDetailWeight <= 0) {
    return {
      cappedByLeaves: false,
      detailWeight: 0,
      maxExtraLeaves: 0,
      selectedCount: 0,
      texels: 0,
    };
  }

  const maxExtraLeaves = Math.floor(renderCandidates.length * options.textureFallbackOverlayMaxExtraRatio);
  if (maxExtraLeaves <= 0) {
    return {
      cappedByLeaves: selections.length > 0,
      detailWeight: 0,
      maxExtraLeaves,
      selectedCount: 0,
      texels: 0,
    };
  }

  selections.sort((a, b) =>
    b.detailDensity - a.detailDensity ||
    b.detailWeight - a.detailWeight ||
    a.sourceCandidate.faceIndex - b.sourceCandidate.faceIndex
  );

  let detailWeight = 0;
  let texels = 0;
  let selectedCount = 0;
  let cappedByLeaves = false;
  const overlays: QuakeFaceCandidate[] = [];
  for (const selection of selections) {
    if (detailWeight >= targetDetailWeight) break;
    if (selectedCount >= maxExtraLeaves) {
      cappedByLeaves = true;
      break;
    }

    const overlay = await encodeFaceLightmapBakeTextureFallbackOverlaySelection(
      selection,
      lighting,
      palette,
      urls,
      cache,
      encodeTextureUrl,
      options,
    );
    if (!overlay) continue;
    const baseTexture = await litTextureUrlFor(
      selection.sourceCandidate.texture,
      selection.baseBrightness,
      palette,
      urls,
      cache,
      encodeTextureUrl,
    );
    selection.renderCandidate.polygon = {
      ...selection.renderCandidate.polygon,
      texture: baseTexture,
      textureWrap: REPEAT_WRAP,
      textureAlphaMode: "opaque",
      color: litTextureFallbackColor(selection.sourceCandidate.texture, selection.baseBrightness, palette, new Map()),
      data: {
        ...selection.renderCandidate.polygon.data,
        "lit": formatQuakeBrightness(selection.baseBrightness),
        "lm-overlay-base": true,
      },
    };
    overlays.push(overlay.overlay);
    detailWeight += selection.detailWeight;
    texels += overlay.texelCount;
    selectedCount++;
  }

  renderCandidates.push(...overlays);
  return {
    cappedByLeaves,
    detailWeight,
    maxExtraLeaves,
    selectedCount,
    texels,
  };
}

function mergedFallbackOverlayIslandSelectionsFor(
  selections: QuakeFaceLightmapBakeSelection[],
  options: QuakeLightmapBakeOptions,
  pivot: QuakeVertex,
): QuakeMergedLightmapOverlaySelection[] {
  const keyedSelections = new Map<string, QuakeFaceLightmapBakeSelection[]>();
  for (const selection of selections) {
    const key = mergedFallbackOverlaySelectionGroupKey(selection);
    if (!key) continue;
    const group = keyedSelections.get(key);
    if (group) {
      group.push(selection);
    } else {
      keyedSelections.set(key, [selection]);
    }
  }

  const islands: QuakeMergedLightmapOverlaySelection[] = [];
  for (const group of keyedSelections.values()) {
    for (const chunk of mergedFallbackOverlayConnectedChunks(group)) {
      const island = mergedFallbackOverlayIslandSelectionFor(chunk, options, pivot);
      if (island) islands.push(island);
    }
  }
  return islands;
}

function mergedFallbackOverlaySelectionGroupKey(selection: QuakeFaceLightmapBakeSelection): string | null {
  const vertices = selection.renderCandidate.polygon.vertices;
  if (vertices.length < 3 || vertices.length > QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_VERTICES) return null;
  const textureName = selection.sourceCandidate.texture.name.toLowerCase();
  if (!textureName || textureName.startsWith("sky") || textureName.startsWith("*") || textureName.startsWith("+")) {
    return null;
  }
  const planeKey = quakeLightmapOverlayPlaneKey(vertices);
  if (!planeKey) return null;
  return [
    textureName,
    String(selection.sourceCandidate.modelIndex),
    String(selection.sourceCandidate.entityIndex ?? ""),
    planeKey,
  ].join("\u001f");
}

function mergedFallbackOverlayConnectedChunks(
  selections: QuakeFaceLightmapBakeSelection[],
): QuakeFaceLightmapBakeSelection[][] {
  if (selections.length < 2) return [];

  const adjacency = selections.map(() => new Set<number>());
  const projectedSelections = mergedFallbackOverlayProjectedSelections(selections);
  for (let first = 0; first < projectedSelections.length - 1; first++) {
    const a = projectedSelections[first];
    if (!a) continue;
    for (let second = first + 1; second < projectedSelections.length; second++) {
      const b = projectedSelections[second];
      if (!b || !mergedFallbackOverlayProjectedSelectionsTouch(a, b)) continue;
      adjacency[first].add(second);
      adjacency[second].add(first);
    }
  }

  const mergeableCache = new Map<string, boolean>();
  const remaining = new Set(selections.map((_, index) => index));
  const chunks: QuakeFaceLightmapBakeSelection[][] = [];
  while (remaining.size > 0) {
    const start = [...remaining].sort((a, b) =>
      selections[b].detailWeight - selections[a].detailWeight ||
      selections[a].sourceCandidate.faceIndex - selections[b].sourceCandidate.faceIndex
    )[0];
    remaining.delete(start);

    const chunkIndexes = [start];
    const frontier = new Set([...adjacency[start]].filter((index) => remaining.has(index)));
    while (frontier.size > 0 && chunkIndexes.length < QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_SOURCE_FACES) {
      const next = [...frontier]
        .filter((index) => remaining.has(index))
        .sort((a, b) =>
          selections[b].detailWeight - selections[a].detailWeight ||
          selections[a].sourceCandidate.faceIndex - selections[b].sourceCandidate.faceIndex
        )
        .find((index) =>
          mergedFallbackOverlaySelectionsCanFormIsland(
            [...chunkIndexes.map((selectionIndex) => selections[selectionIndex]), selections[index]],
            mergeableCache,
          )
        );
      if (next === undefined) break;

      frontier.delete(next);
      remaining.delete(next);
      chunkIndexes.push(next);
      for (const neighbor of adjacency[next]) {
        if (remaining.has(neighbor)) frontier.add(neighbor);
      }
    }

    if (chunkIndexes.length >= 2) chunks.push(chunkIndexes.map((index) => selections[index]));
  }
  return chunks;
}

function mergedFallbackOverlaySelectionsCanFormIsland(
  selections: QuakeFaceLightmapBakeSelection[],
  cache: Map<string, boolean>,
): boolean {
  if (selections.length < 2 || selections.length > QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_SOURCE_FACES) return false;
  const key = selections
    .map((selection) => selection.sourceCandidate.faceIndex)
    .sort((a, b) => a - b)
    .join(",");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const coverage = mergedFallbackOverlayProjectedIslandCoverage(selections);
  const mergeable = coverage !== null &&
    quakeSaneLightmapOverlayBounds(coverage.bounds, QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_ASPECT_RATIO) &&
    mergedLightmapOverlaySolidCoverageAcceptable(coverage);
  cache.set(key, mergeable);
  return mergeable;
}

interface QuakeMergedLightmapOverlaySolidCoverage {
  bounds: QuakeLocalBounds;
  fillRatio: number;
  hasInteriorHole: boolean;
  minSideQuake: number;
  solidSampleRatio: number;
}

function mergedFallbackOverlayProjectedIslandCoverage(
  selections: QuakeFaceLightmapBakeSelection[],
): QuakeMergedLightmapOverlaySolidCoverage | null {
  const firstPolygon = selections[0]?.renderCandidate.polygon;
  if (!firstPolygon || firstPolygon.vertices.length < 3) return null;
  const normal = quakePolygonNormal(firstPolygon.vertices);
  const basis = quakeWallBleedBasis(firstPolygon.vertices, normal);
  if (!basis) return null;

  const localPolygons: Vec2[][] = [];
  for (const selection of selections) {
    const vertices = selection.renderCandidate.polygon.vertices;
    if (!quakePointsLieOnBasisPlane(vertices, basis, normal)) return null;
    localPolygons.push(vertices.map((point) => quakeProjectToBasis(point, basis)));
  }
  return mergedLightmapOverlaySolidCoverageForLocalPolygons(localPolygons);
}

function mergedLightmapOverlaySolidCoverageAcceptable(coverage: QuakeMergedLightmapOverlaySolidCoverage): boolean {
  return coverage.fillRatio >= QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MIN_FILL_RATIO &&
    coverage.minSideQuake >= QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MIN_SOLID_SIDE &&
    coverage.solidSampleRatio >= QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MIN_SAMPLE_FILL_RATIO &&
    !coverage.hasInteriorHole;
}

function mergedLightmapOverlaySolidCoverageForLocalPolygons(
  localPolygons: Vec2[][],
): QuakeMergedLightmapOverlaySolidCoverage | null {
  const points = localPolygons.flat();
  const bounds = quakeLocalBounds(points);
  if (!bounds) return null;

  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const boundsArea = spanX * spanY;
  if (boundsArea <= QUAKE_RENDER_COLLINEAR_EPS) return null;

  const sourceArea = localPolygons.reduce((total, polygon) => total + Math.abs(quakeSignedArea2(polygon)), 0);
  const fillRatio = Math.max(0, Math.min(1, sourceArea / boundsArea));
  const samplesX = mergedLightmapOverlaySolidSampleCount(spanX);
  const samplesY = mergedLightmapOverlaySolidSampleCount(spanY);
  let solidSamples = 0;
  let totalSamples = 0;
  let hasInteriorHole = false;

  for (let y = 0; y < samplesY; y++) {
    const localY = bounds.maxY - ((y + 0.5) / samplesY) * spanY;
    for (let x = 0; x < samplesX; x++) {
      const localX = bounds.minX + ((x + 0.5) / samplesX) * spanX;
      const covered = mergedLightmapOverlayLocalPointCovered(localPolygons, [localX, localY]);
      totalSamples++;
      if (covered) {
        solidSamples++;
      } else if (x > 0 && x < samplesX - 1 && y > 0 && y < samplesY - 1) {
        hasInteriorHole = true;
      }
    }
  }

  return {
    bounds,
    fillRatio,
    hasInteriorHole,
    minSideQuake: Math.min(spanX, spanY) / QUAKE_UNIT_SCALE,
    solidSampleRatio: totalSamples > 0 ? solidSamples / totalSamples : 0,
  };
}

function mergedLightmapOverlaySolidSampleCount(span: number): number {
  const quakeUnits = span / QUAKE_UNIT_SCALE;
  return Math.max(
    3,
    Math.min(
      QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_SOLID_SAMPLES,
      Math.ceil(quakeUnits / QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_SOLID_SAMPLE_UNIT),
    ),
  );
}

function mergedLightmapOverlayLocalPointCovered(localPolygons: Vec2[][], point: Vec2): boolean {
  return localPolygons.some((polygon) => quakePointInPolygon2(point, polygon));
}

interface QuakeMergedLightmapOverlayProjectedSelection {
  bounds: QuakeLocalBounds;
  edges: QuakeMergedLightmapOverlayProjectedEdge[];
}

interface QuakeMergedLightmapOverlayProjectedEdge {
  a: Vec2;
  b: Vec2;
  bounds: QuakeLocalBounds;
  length: number;
}

function mergedFallbackOverlayProjectedSelections(
  selections: QuakeFaceLightmapBakeSelection[],
): Array<QuakeMergedLightmapOverlayProjectedSelection | null> {
  const firstPolygon = selections[0]?.renderCandidate.polygon;
  if (!firstPolygon || firstPolygon.vertices.length < 3) return selections.map(() => null);
  const normal = quakePolygonNormal(firstPolygon.vertices);
  const basis = quakeWallBleedBasis(firstPolygon.vertices, normal);
  if (!basis) return selections.map(() => null);

  return selections.map((selection) => {
    const localPoints = selection.renderCandidate.polygon.vertices.map((point) => quakeProjectToBasis(point, basis));
    const bounds = quakeLocalBounds(localPoints);
    if (!bounds) return null;
    const edges: QuakeMergedLightmapOverlayProjectedEdge[] = [];
    for (let index = 0; index < localPoints.length; index++) {
      const a = localPoints[index];
      const b = localPoints[(index + 1) % localPoints.length];
      if (!a || !b) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length <= QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_EDGE_TOUCH_EPS) continue;
      edges.push({ a, b, bounds: quakeEdgeLocalBounds(a, b), length });
    }
    return edges.length ? { bounds, edges } : null;
  });
}

function quakeEdgeLocalBounds(a: Vec2, b: Vec2): QuakeLocalBounds {
  return {
    minX: Math.min(a[0], b[0]),
    maxX: Math.max(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxY: Math.max(a[1], b[1]),
  };
}

function mergedFallbackOverlayProjectedSelectionsTouch(
  a: QuakeMergedLightmapOverlayProjectedSelection,
  b: QuakeMergedLightmapOverlayProjectedSelection,
): boolean {
  const eps = QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_EDGE_TOUCH_EPS;
  if (
    intervalGap(a.bounds.minX, a.bounds.maxX, b.bounds.minX, b.bounds.maxX) > eps ||
    intervalGap(a.bounds.minY, a.bounds.maxY, b.bounds.minY, b.bounds.maxY) > eps
  ) {
    return false;
  }

  for (const edgeA of a.edges) {
    for (const edgeB of b.edges) {
      if (
        intervalGap(edgeA.bounds.minX, edgeA.bounds.maxX, edgeB.bounds.minX, edgeB.bounds.maxX) > eps ||
        intervalGap(edgeA.bounds.minY, edgeA.bounds.maxY, edgeB.bounds.minY, edgeB.bounds.maxY) > eps
      ) {
        continue;
      }
      if (quakeSegmentsOverlapOnLine2(edgeA.a, edgeA.b, edgeB.a, edgeB.b, eps)) return true;
    }
  }
  return false;
}

function quakeSegmentsOverlapOnLine2(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, eps: number): boolean {
  const ax = a1[0] - a0[0];
  const ay = a1[1] - a0[1];
  const bx = b1[0] - b0[0];
  const by = b1[1] - b0[1];
  const aLength = Math.hypot(ax, ay);
  const bLength = Math.hypot(bx, by);
  if (aLength <= eps || bLength <= eps) return false;

  const directionCross = ax * by - ay * bx;
  if (Math.abs(directionCross) > eps * Math.max(1, aLength * bLength)) return false;

  const offsetCross = ax * (b0[1] - a0[1]) - ay * (b0[0] - a0[0]);
  if (Math.abs(offsetCross) / aLength > eps) return false;

  const ux = ax / aLength;
  const uy = ay / aLength;
  const bStart = (b0[0] - a0[0]) * ux + (b0[1] - a0[1]) * uy;
  const bEnd = (b1[0] - a0[0]) * ux + (b1[1] - a0[1]) * uy;
  return intervalOverlap(0, aLength, Math.min(bStart, bEnd), Math.max(bStart, bEnd)) > eps;
}

function mergedFallbackOverlayIslandSelectionFor(
  selections: QuakeFaceLightmapBakeSelection[],
  options: QuakeLightmapBakeOptions,
  pivot: QuakeVertex,
): QuakeMergedLightmapOverlaySelection | undefined {
  if (selections.length < 2 || selections.length > QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_SOURCE_FACES) {
    return undefined;
  }
  const firstPolygon = selections[0]?.renderCandidate.polygon;
  if (!firstPolygon || firstPolygon.vertices.length < 3) return undefined;
  const normal = quakePolygonNormal(firstPolygon.vertices);
  const basis = quakeWallBleedBasis(firstPolygon.vertices, normal);
  if (!basis) return undefined;

  let baseDisplayBrightness = 0;
  let displayRange = 0;
  let detailWeight = 0;
  const sourceLocalPolygons: Vec2[][] = [];
  const sourceFaces: QuakeMergedLightmapOverlaySourceFace[] = [];
  for (const selection of selections) {
    const sourceWorldPoints = selection.sourceCandidate.points.map((point) => quakeToPoly(point, pivot));
    if (!quakePointsLieOnBasisPlane(sourceWorldPoints, basis, normal)) return undefined;
    const sourceLocalPoints = sourceWorldPoints.map((point) => quakeProjectToBasis(point, basis));
    if (!quakeConvexPolygon2(sourceLocalPoints)) return undefined;
    const sourceLocalBounds = quakeLocalBounds(sourceLocalPoints);
    if (!sourceLocalBounds) return undefined;
    sourceLocalPolygons.push(sourceLocalPoints);
    baseDisplayBrightness = Math.max(baseDisplayBrightness, displayLightBrightness(selection.baseBrightness));
    displayRange = Math.max(displayRange, selection.displayRange);
    detailWeight += selection.detailWeight;
    sourceFaces.push({
      bounds: sourceLocalBounds,
      detailWeight: selection.detailWeight,
      displayRange: selection.displayRange,
      grid: selection.grid,
      localPoints: sourceLocalPoints,
      sourceCandidate: selection.sourceCandidate,
      textureBounds: selection.bounds,
    });
  }
  if (displayRange < options.minDisplayRange || detailWeight <= 0 || baseDisplayBrightness <= 0) return undefined;
  const coverage = mergedLightmapOverlaySolidCoverageForLocalPolygons(sourceLocalPolygons);
  if (
    !coverage ||
    !quakeSaneLightmapOverlayBounds(coverage.bounds, QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_ASPECT_RATIO) ||
    !mergedLightmapOverlaySolidCoverageAcceptable(coverage)
  ) {
    return undefined;
  }
  const bounds = coverage.bounds;
  const dimensions = mergedLightmapOverlayDimensions(bounds, options.mergedOverlayMaxTextureSide);
  if (!dimensions) return undefined;
  const localPoints = mergedLightmapOverlayRectangleLocalPoints(bounds);
  const vertices = localPoints.map((point) => quakeWallBleedLocalToWorld(point, basis));
  return {
    baseBrightness: Math.max(QUAKE_LIGHT_MIN, Math.min(QUAKE_LIGHT_MAX, undisplayLightBrightness(baseDisplayBrightness))),
    baseDisplayBrightness,
    basis,
    bounds,
    detailWeight,
    dimensions,
    displayRange,
    baseRenderCandidates: selections.map((selection) => selection.renderCandidate),
    faceIndex: Math.min(...selections.map((selection) => selection.renderCandidate.faceIndex)),
    fillRatio: coverage.fillRatio,
    localPoints,
    minSideQuake: coverage.minSideQuake,
    solidSampleRatio: coverage.solidSampleRatio,
    sourceFaces,
    texelCount: dimensions.width * dimensions.height,
    vertices,
    uvs: mergedLightmapOverlayUvs(localPoints, bounds),
  };
}

function mergedLightmapOverlaySelectionFor(
  renderCandidate: QuakeFaceCandidate,
  buildCandidateByFaceIndex: Map<number, QuakeFaceBuildCandidate>,
  lighting: Uint8Array,
  textures: Array<QuakeMipTexture | null>,
  options: QuakeLightmapBakeOptions,
  pivot: QuakeVertex,
  skipSourceFaceIndices: Set<number>,
): QuakeMergedLightmapOverlaySelection | undefined {
  const sourceFaceIndices = renderCandidate.sourceFaceIndices;
  if (sourceFaceIndices.length < 2 || sourceFaceIndices.length > QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_SOURCE_FACES) {
    return undefined;
  }
  if (sourceFaceIndices.some((sourceFaceIndex) => skipSourceFaceIndices.has(sourceFaceIndex))) return undefined;
  const vertices = renderCandidate.polygon.vertices;
  if (vertices.length < 3 || vertices.length > QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_VERTICES) return undefined;
  if (String(renderCandidate.polygon.data?.["tex"] ?? "").startsWith("lm-")) return undefined;

  const normal = quakePolygonNormal(vertices);
  const basis = quakeWallBleedBasis(vertices, normal);
  if (!basis) return undefined;
  const bounds = quakeLocalBounds(basis.localPoints);
  if (!bounds || !quakeSaneLightmapOverlayBounds(bounds, QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_ASPECT_RATIO)) {
    return undefined;
  }
  const dimensions = mergedLightmapOverlayDimensions(bounds, options.mergedOverlayMaxTextureSide);
  if (!dimensions) return undefined;

  const sourceCandidates = sourceFaceIndices
    .map((sourceFaceIndex) => buildCandidateByFaceIndex.get(sourceFaceIndex))
    .filter((candidate): candidate is QuakeFaceBuildCandidate => candidate !== undefined);
  if (sourceCandidates.length !== sourceFaceIndices.length) return undefined;
  const textureName = sourceCandidates[0]?.texture.name.toLowerCase();
  if (!textureName || sourceCandidates.some((candidate) => candidate.texture.name.toLowerCase() !== textureName)) {
    return undefined;
  }

  let baseDisplayBrightness = displayLightBrightness(
    brightnessFromPolygonData(renderCandidate.polygon.data?.["lit"]) ?? sourceCandidates[0]?.brightness ?? 1,
  );
  let displayRange = 0;
  let detailWeight = 0;
  const sourceFaces: QuakeMergedLightmapOverlaySourceFace[] = [];
  for (const sourceCandidate of sourceCandidates) {
    if (!staticWorldLightmapCandidate(sourceCandidate, textures)) return undefined;
    const sourceWorldPoints = sourceCandidate.points.map((point) => quakeToPoly(point, pivot));
    if (!quakePointsLieOnBasisPlane(sourceWorldPoints, basis, normal)) return undefined;
    const sourceLocalPoints = sourceWorldPoints.map((point) => quakeProjectToBasis(point, basis));
    if (!quakeConvexPolygon2(sourceLocalPoints)) return undefined;
    const sourceLocalBounds = quakeLocalBounds(sourceLocalPoints);
    if (!sourceLocalBounds) return undefined;

    const textureBounds = faceTextureCoordinateBounds(sourceCandidate.points, sourceCandidate.texInfo);
    if (!textureBounds) return undefined;
    const grid = faceLightmapGridFor(sourceCandidate.face, textureBounds, lighting);
    if (!grid) return undefined;
    const stats = faceLightmapDisplayStats(grid, lighting);
    const sourceDisplayRange = stats.max - stats.min;
    baseDisplayBrightness = Math.max(baseDisplayBrightness, stats.max);
    displayRange = Math.max(displayRange, sourceDisplayRange);
    const sourceDimensions = faceLightmapBakeDimensions(textureBounds, options.maxTextureSide);
    const sourceTexels = sourceDimensions ? sourceDimensions.width * sourceDimensions.height : 0;
    const sourceDetailWeight = sourceDisplayRange >= options.minDisplayRange
      ? stats.rmsContrast * sourceTexels
      : 0;
    detailWeight += sourceDetailWeight;
    sourceFaces.push({
      bounds: sourceLocalBounds,
      detailWeight: sourceDetailWeight,
      displayRange: sourceDisplayRange,
      grid,
      localPoints: sourceLocalPoints,
      sourceCandidate,
      textureBounds,
    });
  }

  if (displayRange < options.minDisplayRange || detailWeight <= 0) return undefined;
  return {
    baseBrightness: Math.max(QUAKE_LIGHT_MIN, Math.min(QUAKE_LIGHT_MAX, undisplayLightBrightness(baseDisplayBrightness))),
    baseDisplayBrightness,
    basis,
    bounds,
    detailWeight,
    dimensions,
    displayRange,
    baseRenderCandidates: [renderCandidate],
    faceIndex: renderCandidate.faceIndex,
    localPoints: basis.localPoints,
    sourceFaces,
    texelCount: dimensions.width * dimensions.height,
    vertices,
    uvs: mergedLightmapOverlayUvs(basis.localPoints, bounds),
  };
}

async function encodeMergedLightmapOverlaySelection(
  selection: QuakeMergedLightmapOverlaySelection,
  lighting: Uint8Array,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
  pivot: QuakeVertex,
): Promise<QuakeFaceCandidate | undefined> {
  const key = [
    "lightmap-merged-overlay",
    selection.faceIndex,
    selection.sourceFaces.map((sourceFace) => sourceFace.sourceCandidate.faceIndex).join(","),
    selection.dimensions.width,
    selection.dimensions.height,
    selection.baseDisplayBrightness.toFixed(4),
    selection.bounds.minX.toFixed(4),
    selection.bounds.maxX.toFixed(4),
    selection.bounds.minY.toFixed(4),
    selection.bounds.maxY.toFixed(4),
  ].join(":");
  const cached = cache.get(key);
  let url: string;
  if (cached) {
    url = await cached;
  } else {
    const task = encodeTextureUrl({
      width: selection.dimensions.width,
      height: selection.dimensions.height,
      pixels: new Uint8Array(selection.dimensions.width * selection.dimensions.height),
      palette,
      brightness: 1,
      rgba: buildMergedLightmapOverlayRgba(selection, lighting, pivot),
    });
    cache.set(key, task);
    url = await task;
    cache.set(key, url);
    urls.push(url);
  }

  return {
    faceIndex: selection.faceIndex,
    sourceFaceIndices: selection.sourceFaces.map((sourceFace) => sourceFace.sourceCandidate.faceIndex),
    points: [],
    polygon: {
      vertices: offsetQuakePolygonVertices(selection.vertices, QUAKE_LIGHTMAP_OVERLAY_OFFSET),
      texture: url,
      textureAlphaMode: "blend",
      color: "#000000",
      uvs: selection.uvs,
      data: {
        "f": selection.faceIndex,
        "m": selection.sourceFaces[0]?.sourceCandidate.modelIndex ?? 0,
        "tex": "lm-overlay",
        "lm-merged": true,
        "lm-overlay": true,
        "lm-range": formatQuakeBrightness(selection.displayRange),
        "lm-texels": selection.texelCount,
        "lm-sources": selection.sourceFaces.length,
        ...(selection.fillRatio !== undefined ? { "lm-fill": selection.fillRatio.toFixed(3) } : {}),
        ...(selection.minSideQuake !== undefined ? { "lm-min-side": selection.minSideQuake.toFixed(1) } : {}),
        ...(selection.solidSampleRatio !== undefined ? { "lm-solid": selection.solidSampleRatio.toFixed(3) } : {}),
      },
    },
  };
}

async function encodeFaceLightmapBakeTextureFallbackOverlaySelection(
  selection: QuakeFaceLightmapBakeSelection,
  lighting: Uint8Array,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
  options: QuakeLightmapBakeOptions,
): Promise<{ overlay: QuakeFaceCandidate; texelCount: number } | undefined> {
  const dimensions = faceLightmapBakeDimensions(selection.bounds, options.textureFallbackOverlayMaxTextureSide);
  if (!dimensions) return undefined;

  const baseDisplayBrightness = displayLightBrightness(selection.baseBrightness);
  const key = [
    "lightmap-bake-fallback-overlay",
    selection.sourceCandidate.faceIndex,
    dimensions.width,
    dimensions.height,
    options.textureFallbackOverlayMaxTextureSide,
    baseDisplayBrightness.toFixed(4),
    selection.bounds.minS.toFixed(3),
    selection.bounds.maxS.toFixed(3),
    selection.bounds.minT.toFixed(3),
    selection.bounds.maxT.toFixed(3),
  ].join(":");
  const cached = cache.get(key);
  let url: string;
  if (cached) {
    url = await cached;
  } else {
    const task = encodeTextureUrl({
      width: dimensions.width,
      height: dimensions.height,
      pixels: new Uint8Array(dimensions.width * dimensions.height),
      palette,
      brightness: 1,
      rgba: buildFaceLightmapOverlayRgba(
        selection.bounds,
        selection.grid,
        lighting,
        dimensions,
        baseDisplayBrightness,
      ),
    });
    cache.set(key, task);
    url = await task;
    cache.set(key, url);
    urls.push(url);
  }

  const texelCount = dimensions.width * dimensions.height;
  return {
    overlay: {
      faceIndex: selection.renderCandidate.faceIndex,
      sourceFaceIndices: [selection.sourceCandidate.faceIndex],
      points: selection.sourceCandidate.points,
      polygon: {
        vertices: offsetQuakePolygonVertices(selection.renderCandidate.polygon.vertices, QUAKE_LIGHTMAP_OVERLAY_OFFSET),
        texture: url,
        textureAlphaMode: "blend",
        color: "#000000",
        uvs: selection.uvs,
        data: {
          "f": selection.renderCandidate.faceIndex,
          "m": selection.sourceCandidate.modelIndex,
          "tex": "lm-overlay",
          "lm-fallback": true,
          "lm-overlay": true,
          "lm-range": formatQuakeBrightness(selection.displayRange),
          "lm-texels": texelCount,
        },
      },
    },
    texelCount,
  };
}

function formatLightmapBakeStats(stats: QuakeLightmapBakeStats): string {
  const captured = stats.candidateDetailWeight > 0
    ? stats.selectedDetailWeight / stats.candidateDetailWeight
    : 1;
  const target = formatPercent(stats.detailTargetRatio);
  const capNote = stats.cappedByTexels ? `; capped at ${formatTexelCount(stats.maxTotalTexels)} texels` : "";
  const overlayNote = stats.fallbackOverlayCount > 0
    ? `; ${stats.fallbackOverlayCount}/${stats.textureFidelityRejectedCount} texture-risky faces as overlays, ` +
      `${formatTexelCount(stats.fallbackOverlayTexels)} texels`
    : "";
  const mergedFallbackNote = stats.mergedFallbackOverlayCount > 0
    ? `; ${stats.mergedFallbackOverlayCount}/${stats.mergedFallbackOverlayCandidateCount} merged fallback overlays ` +
      `covering ${stats.mergedFallbackOverlaySourceFaceCount} faces, ` +
      `${formatTexelCount(stats.mergedFallbackOverlayTexels)} texels`
    : "";
  const overlayCapNote = stats.fallbackOverlayCappedByLeaves
    ? `; overlay capped at ${stats.fallbackOverlayMaxExtraLeaves} faces`
    : "";
  const fidelityNote = stats.textureFidelityRejectedCount > 0
    ? `; texture/repeat gate protected ${stats.textureFidelityRejectedCount} faces, ` +
      `${formatTexelCount(stats.textureFidelityRejectedTexels)} texels`
    : "";
  return `Captured ${formatPercent(captured)} lightmap detail against ${target} target ` +
    `(${stats.selectedCount}/${stats.totalCount} baked faces, ` +
    `${formatTexelCount(stats.selectedTexels)} baked/${formatTexelCount(stats.candidateTexels)} candidate texels` +
    `${capNote}${mergedFallbackNote}${overlayNote}${overlayCapNote}${fidelityNote}).`;
}

function formatMergedLightmapOverlayStats(stats: QuakeMergedLightmapOverlayStats): string {
  const capNote = stats.cappedByLeaves ? `; capped at ${stats.maxExtraLeaves} overlays` : "";
  return `Merged lightmap overlay prototype selected ${stats.selectedCount}/${stats.candidateCount} overlays ` +
    `covering ${stats.sourceFaceCount} source faces ` +
    `(${formatTexelCount(stats.texels)} texels, ${formatTexelCount(stats.detailWeight)} detail${capNote}).`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTexelCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function normalizeQuakeLightmapBakeOptions(
  options: Pick<
    QuakePreparedSceneCreateOptions,
    | "lightmapBake"
    | "lightmapBakeDetailTarget"
    | "lightmapBakeLightSupersample"
    | "lightmapBakeMaxSide"
    | "lightmapBakeMaxTotalTexels"
    | "lightmapBakeMinDisplaySide"
    | "lightmapBakeMinTextureScale"
    | "lightmapBakeMinTextureSide"
    | "lightmapBakeTextureEncoding"
    | "lightmapBakeTextureFallbackOverlay"
    | "lightmapBakeTextureFallbackOverlayMaxExtraRatio"
    | "lightmapBakeTextureFallbackOverlayMaxSide"
    | "lightmapBakeMergedOverlay"
    | "lightmapBakeMergedOverlayMaxExtraRatio"
    | "lightmapBakeMergedOverlayMaxSide"
    | "lightmapBakeMinRange"
  > = {},
): QuakeLightmapBakeOptions {
  const rawDetailTargetRatio = options.lightmapBakeDetailTarget ?? QUAKE_LIGHTMAP_BAKE_DEFAULT_DETAIL_TARGET_RATIO;
  const detailTargetRatio = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(rawDetailTargetRatio) ? rawDetailTargetRatio : QUAKE_LIGHTMAP_BAKE_DEFAULT_DETAIL_TARGET_RATIO,
    ),
  );
  const rawMaxSide = options.lightmapBakeMaxSide ?? QUAKE_LIGHTMAP_BAKE_DEFAULT_MAX_TEXTURE_SIDE;
  const maxTextureSide = Math.max(
    QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE,
    Math.min(
      QUAKE_LIGHTMAP_BAKE_MAX_TEXTURE_SIDE,
      Number.isFinite(rawMaxSide) ? Math.round(rawMaxSide) : QUAKE_LIGHTMAP_BAKE_DEFAULT_MAX_TEXTURE_SIDE,
    ),
  );
  const rawLightSupersample = options.lightmapBakeLightSupersample
    ?? QUAKE_LIGHTMAP_BAKE_DEFAULT_LIGHT_SUPERSAMPLE;
  const lightSupersample = Math.max(
    1,
    Math.min(
      QUAKE_LIGHTMAP_BAKE_MAX_LIGHT_SUPERSAMPLE,
      Number.isFinite(rawLightSupersample)
        ? Math.round(rawLightSupersample)
        : QUAKE_LIGHTMAP_BAKE_DEFAULT_LIGHT_SUPERSAMPLE,
    ),
  );
  const rawMinRange = options.lightmapBakeMinRange ?? QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_DISPLAY_RANGE;
  const minDisplayRange = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(rawMinRange) ? rawMinRange : QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_DISPLAY_RANGE,
    ),
  );
  const rawMinDisplaySide = options.lightmapBakeMinDisplaySide
    ?? QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_DISPLAY_SIDE;
  const minDisplaySide = Math.max(
    0,
    Number.isFinite(rawMinDisplaySide) ? rawMinDisplaySide : QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_DISPLAY_SIDE,
  );
  const rawMaxTotalTexels = options.lightmapBakeMaxTotalTexels ?? QUAKE_LIGHTMAP_BAKE_DEFAULT_MAX_TOTAL_TEXELS;
  const maxTotalTexels = Math.max(
    0,
    Number.isFinite(rawMaxTotalTexels) ? Math.floor(rawMaxTotalTexels) : Number.POSITIVE_INFINITY,
  );
  const rawMinTextureScale = options.lightmapBakeMinTextureScale
    ?? QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_TEXTURE_SCALE;
  const minTextureScale = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(rawMinTextureScale) ? rawMinTextureScale : QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_TEXTURE_SCALE,
    ),
  );
  const rawMinTextureSide = options.lightmapBakeMinTextureSide
    ?? QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_TEXTURE_SIDE;
  const minTextureSide = Math.max(
    QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE,
    Math.min(
      maxTextureSide,
      Number.isFinite(rawMinTextureSide)
        ? Math.round(rawMinTextureSide)
        : QUAKE_LIGHTMAP_BAKE_DEFAULT_MIN_TEXTURE_SIDE,
    ),
  );
  const rawFallbackOverlayMaxExtraRatio = options.lightmapBakeTextureFallbackOverlayMaxExtraRatio
    ?? QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_DEFAULT_MAX_EXTRA_RATIO;
  const textureFallbackOverlayMaxExtraRatio = Math.max(
    0,
    Math.min(
      QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_MAX_EXTRA_RATIO,
      Number.isFinite(rawFallbackOverlayMaxExtraRatio)
        ? rawFallbackOverlayMaxExtraRatio
        : QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_DEFAULT_MAX_EXTRA_RATIO,
    ),
  );
  const rawFallbackOverlayMaxSide = options.lightmapBakeTextureFallbackOverlayMaxSide
    ?? QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_DEFAULT_MAX_TEXTURE_SIDE;
  const textureFallbackOverlayMaxTextureSide = Math.max(
    QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE,
    Math.min(
      QUAKE_LIGHTMAP_BAKE_MAX_TEXTURE_SIDE,
      Number.isFinite(rawFallbackOverlayMaxSide)
        ? Math.round(rawFallbackOverlayMaxSide)
        : QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_DEFAULT_MAX_TEXTURE_SIDE,
    ),
  );
  const rawMergedOverlayMaxExtraRatio = options.lightmapBakeMergedOverlayMaxExtraRatio
    ?? QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_DEFAULT_MAX_EXTRA_RATIO;
  const mergedOverlayMaxExtraRatio = Math.max(
    0,
    Math.min(
      QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_EXTRA_RATIO,
      Number.isFinite(rawMergedOverlayMaxExtraRatio)
        ? rawMergedOverlayMaxExtraRatio
        : QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_DEFAULT_MAX_EXTRA_RATIO,
    ),
  );
  const rawMergedOverlayMaxSide = options.lightmapBakeMergedOverlayMaxSide
    ?? QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_DEFAULT_MAX_TEXTURE_SIDE;
  const mergedOverlayMaxTextureSide = Math.max(
    QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE,
    Math.min(
      QUAKE_LIGHTMAP_BAKE_MAX_TEXTURE_SIDE,
      Number.isFinite(rawMergedOverlayMaxSide)
        ? Math.round(rawMergedOverlayMaxSide)
        : QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_DEFAULT_MAX_TEXTURE_SIDE,
    ),
  );
  return {
    enabled: options.lightmapBake === true,
    detailTargetRatio,
    lightSupersample,
    maxTextureSide,
    maxTotalTexels,
    minDisplayRange,
    minDisplaySide,
    minTextureScale,
    minTextureSide,
    textureEncoding: options.lightmapBakeTextureEncoding !== false,
    textureFallbackOverlay: options.lightmapBakeTextureFallbackOverlay === true,
    textureFallbackOverlayMaxExtraRatio,
    textureFallbackOverlayMaxTextureSide,
    mergedOverlay: options.lightmapBakeMergedOverlay === true,
    mergedOverlayMaxExtraRatio,
    mergedOverlayMaxTextureSide,
  };
}

function normalizeQuakeLightmapOverlayOptions(
  options: Pick<
    QuakePreparedSceneCreateOptions,
    "lightmapOverlay" | "lightmapOverlayMaxExtraRatio" | "lightmapOverlayMaxSide" | "lightmapOverlayMinRange"
  > = {},
): QuakeLightmapOverlayOptions {
  const rawMaxSide = options.lightmapOverlayMaxSide ?? QUAKE_LIGHTMAP_OVERLAY_DEFAULT_MAX_TEXTURE_SIDE;
  const maxTextureSide = Math.max(
    QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE,
    Math.min(
      QUAKE_LIGHTMAP_BAKE_MAX_TEXTURE_SIDE,
      Number.isFinite(rawMaxSide) ? Math.round(rawMaxSide) : QUAKE_LIGHTMAP_OVERLAY_DEFAULT_MAX_TEXTURE_SIDE,
    ),
  );
  const rawMaxExtraRatio = options.lightmapOverlayMaxExtraRatio ?? QUAKE_LIGHTMAP_OVERLAY_DEFAULT_MAX_EXTRA_RATIO;
  const maxExtraRatio = Math.max(
    0,
    Math.min(
      0.25,
      Number.isFinite(rawMaxExtraRatio) ? rawMaxExtraRatio : QUAKE_LIGHTMAP_OVERLAY_DEFAULT_MAX_EXTRA_RATIO,
    ),
  );
  const rawMinRange = options.lightmapOverlayMinRange ?? QUAKE_LIGHTMAP_OVERLAY_DEFAULT_MIN_DISPLAY_RANGE;
  const minDisplayRange = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(rawMinRange) ? rawMinRange : QUAKE_LIGHTMAP_OVERLAY_DEFAULT_MIN_DISPLAY_RANGE,
    ),
  );
  return {
    enabled: options.lightmapOverlay === true,
    maxExtraRatio,
    maxTextureSide,
    minDisplayRange,
  };
}

function normalizeQuakeTextureNameSet(names?: string[]): ReadonlySet<string> | undefined {
  const normalized = (names ?? [])
    .map((name) => String(name ?? "").trim().toLowerCase())
    .filter(Boolean);
  return normalized.length ? new Set(normalized) : undefined;
}

function shouldEncodeLitTextureForRenderCandidate(
  candidate: QuakeFaceBuildCandidate,
  texture: QuakeMipTexture,
  entityByIndex: Map<number, QuakeEntity>,
  preservedTextureNames?: ReadonlySet<string>,
): boolean {
  const textureName = texture.name.toLowerCase();
  if (textureName.startsWith("*") || textureName.startsWith("+")) return true;
  if (preservedTextureNames?.has(textureName)) return true;
  return candidate.entityIndex !== undefined &&
    entityByIndex.get(candidate.entityIndex)?.classname === "func_button";
}

async function faceLightmapOverlaySelectionFor(
  renderCandidate: QuakeFaceCandidate,
  sourceCandidate: QuakeFaceBuildCandidate,
  currentBrightness: number,
  lighting: Uint8Array,
  textures: Array<QuakeMipTexture | null>,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
  options: QuakeLightmapOverlayOptions,
): Promise<QuakeFaceLightmapOverlaySelection | undefined> {
  if (!staticWorldLightmapCandidate(sourceCandidate, textures)) return undefined;
  const bounds = faceTextureCoordinateBounds(sourceCandidate.points, sourceCandidate.texInfo);
  if (!bounds) return undefined;
  const grid = faceLightmapGridFor(sourceCandidate.face, bounds, lighting);
  if (!grid) return undefined;
  const stats = faceLightmapDisplayStats(grid, lighting);
  const displayRange = stats.max - stats.min;
  if (displayRange < options.minDisplayRange) return undefined;
  const dimensions = faceLightmapBakeDimensions(bounds, options.maxTextureSide);
  if (!dimensions) return undefined;

  const baseDisplayBrightness = Math.max(stats.max, displayLightBrightness(currentBrightness));
  const baseBrightness = Math.max(QUAKE_LIGHT_MIN, Math.min(QUAKE_LIGHT_MAX, undisplayLightBrightness(baseDisplayBrightness)));
  const uvs = sourceCandidate.points.map((point) =>
    faceLightmapBakeUv(point, sourceCandidate.texInfo, bounds),
  );
  const key = [
    "lightmap-overlay",
    sourceCandidate.faceIndex,
    dimensions.width,
    dimensions.height,
    options.maxTextureSide,
    baseDisplayBrightness.toFixed(4),
    bounds.minS.toFixed(3),
    bounds.maxS.toFixed(3),
    bounds.minT.toFixed(3),
    bounds.maxT.toFixed(3),
  ].join(":");
  const cached = cache.get(key);
  let url: string;
  if (cached) {
    url = await cached;
  } else {
    const task = encodeTextureUrl({
      width: dimensions.width,
      height: dimensions.height,
      pixels: new Uint8Array(dimensions.width * dimensions.height),
      palette,
      brightness: 1,
      rgba: buildFaceLightmapOverlayRgba(bounds, grid, lighting, dimensions, baseDisplayBrightness),
    });
    cache.set(key, task);
    url = await task;
    cache.set(key, url);
    urls.push(url);
  }

  const renderFaceIndex = renderCandidate.faceIndex;
  const sourceFaceIndex = sourceCandidate.faceIndex;
  const area = quakeFaceArea(sourceCandidate.points);
  const overlay: QuakeFaceCandidate = {
    faceIndex: renderFaceIndex,
    sourceFaceIndices: [sourceFaceIndex],
    points: sourceCandidate.points,
    polygon: {
      vertices: offsetQuakePolygonVertices(renderCandidate.polygon.vertices, QUAKE_LIGHTMAP_OVERLAY_OFFSET),
      texture: url,
      textureAlphaMode: "blend",
      color: "#000000",
      uvs,
      data: {
        "f": renderFaceIndex,
        "m": sourceCandidate.modelIndex,
        "tex": "lm-overlay",
        "lm-overlay": true,
        "lm-range": formatQuakeBrightness(displayRange),
      },
    },
  };
  return {
    baseBrightness,
    displayRange,
    overlay,
    renderCandidate,
    score: displayRange * Math.sqrt(Math.max(1, area)),
    sourceCandidate,
    sourceFaceIndex,
  };
}

function faceLightmapBakeSelectionFor(
  renderCandidate: QuakeFaceCandidate,
  sourceCandidate: QuakeFaceBuildCandidate,
  lighting: Uint8Array,
  textures: Array<QuakeMipTexture | null>,
  options: QuakeLightmapBakeOptions,
  rejected?: QuakeLightmapBakeTextureFidelityRejectedSelectionCollector,
  pivot?: QuakeVertex,
): QuakeFaceLightmapBakeSelection | undefined {
  if (!options.enabled) return undefined;
  if (!staticWorldLightmapCandidate(sourceCandidate, textures)) return undefined;
  const bounds = faceTextureCoordinateBounds(sourceCandidate.points, sourceCandidate.texInfo);
  if (!bounds) return undefined;
  const grid = faceLightmapGridFor(sourceCandidate.face, bounds, lighting);
  if (!grid) return undefined;
  const stats = faceLightmapDisplayStats(grid, lighting);
  const displayRange = stats.max - stats.min;
  if (displayRange < options.minDisplayRange) return undefined;
  const dimensions = faceLightmapBakeDimensions(bounds, options.maxTextureSide);
  if (!dimensions) return undefined;
  const uvs = pivot
    ? renderCandidate.polygon.vertices.map((vertex) =>
      faceLightmapBakeUv(polyToQuake(vertex, pivot), sourceCandidate.texInfo, bounds)
    )
    : sourceCandidate.points.map((point) => faceLightmapBakeUv(point, sourceCandidate.texInfo, bounds));
  const baseBrightness = Math.max(
    QUAKE_LIGHT_MIN,
    Math.min(QUAKE_LIGHT_MAX, undisplayLightBrightness(Math.max(stats.max, stats.mean))),
  );
  const area = quakeFaceArea(sourceCandidate.points);
  const texelCount = dimensions.width * dimensions.height;
  const detailDensity = stats.rmsContrast;
  const detailWeight = detailDensity * texelCount;
  const fidelity = faceLightmapBakeTextureFidelity(bounds, dimensions, sourceCandidate.texture, sourceCandidate.points);
  const selection = {
    baseBrightness,
    bounds,
    detailDensity,
    detailWeight,
    dimensions,
    displayRange,
    grid,
    renderCandidate,
    score: detailDensity * Math.sqrt(Math.max(1, area)),
    sourceCandidate,
    texelCount,
    uvs,
  };
  if (
    fidelity.minScale < options.minTextureScale ||
    fidelity.minSide < options.minTextureSide ||
    fidelity.minDisplaySide < options.minDisplaySide ||
    fidelity.repeatedTileRisk
  ) {
    if (rejected) {
      rejected.selections.push(selection);
      rejected.textureFidelityCount++;
      rejected.textureFidelityDetailWeight += detailWeight;
      rejected.textureFidelityTexels += texelCount;
    }
    return undefined;
  }
  return selection;
}

function faceLightmapBakeTextureFidelity(
  bounds: QuakeTextureCoordinateBounds,
  dimensions: { width: number; height: number },
  texture: QuakeMipTexture,
  renderPoints: QuakeVertex[],
): { minDisplaySide: number; minScale: number; minSide: number; repeatedTileRisk: boolean } {
  const spanS = Math.max(1, bounds.maxS - bounds.minS);
  const spanT = Math.max(1, bounds.maxT - bounds.minT);
  const repeatsS = spanS / Math.max(1, texture.width);
  const repeatsT = spanT / Math.max(1, texture.height);
  const maxRepeat = Math.max(repeatsS, repeatsT);
  const minRepeat = Math.min(repeatsS, repeatsT);
  const repeatedTile = repeatsS > 1 + QUAKE_LIGHTMAP_BAKE_REPEAT_EPS ||
    repeatsT > 1 + QUAKE_LIGHTMAP_BAKE_REPEAT_EPS;
  const minSide = Math.min(dimensions.width, dimensions.height);
  const repeatedSmallBake = repeatedTile && minSide < QUAKE_LIGHTMAP_BAKE_REPEATED_TILE_MIN_BAKE_SIDE;
  const repeatedStrip = maxRepeat > QUAKE_LIGHTMAP_BAKE_REPEATED_STRIP_MIN_REPEAT &&
    minRepeat < QUAKE_LIGHTMAP_BAKE_REPEATED_STRIP_MIN_TILE_COVERAGE &&
    repeatedTile;
  return {
    minDisplaySide: faceMinimumPlaneSpan(renderPoints),
    minScale: Math.min(dimensions.width / spanS, dimensions.height / spanT),
    minSide,
    repeatedTileRisk: repeatedSmallBake || repeatedStrip,
  };
}

function faceMinimumPlaneSpan(points: QuakeVertex[]): number {
  if (points.length < 3) return 0;
  const normal = faceNormal(points);
  const bounds = facePlaneBounds(points, normal);
  const spanU = bounds.maxU - bounds.minU;
  const spanV = bounds.maxV - bounds.minV;
  if (!Number.isFinite(spanU) || !Number.isFinite(spanV)) return 0;
  return Math.max(0, Math.min(spanU, spanV));
}

async function encodeFaceLightmapBakeSelection(
  selection: QuakeFaceLightmapBakeSelection,
  lighting: Uint8Array,
  palette: RGB[],
  urls: string[],
  cache: Map<string, Promise<string> | string>,
  encodeTextureUrl: QuakeTextureUrlEncoder,
  options: QuakeLightmapBakeOptions,
): Promise<{ url: string } | undefined> {
  const { bounds, dimensions, sourceCandidate } = selection;
  if (!options.textureEncoding) return { url: sourceCandidate.texture.url };
  const key = [
    "lightmap-bake",
    sourceCandidate.faceIndex,
    sourceCandidate.texture.name,
    dimensions.width,
    dimensions.height,
    options.maxTextureSide,
    options.lightSupersample,
    selection.baseBrightness.toFixed(4),
    bounds.minS.toFixed(3),
    bounds.maxS.toFixed(3),
    bounds.minT.toFixed(3),
    bounds.maxT.toFixed(3),
  ].join(":");
  const cached = cache.get(key);
  if (cached) return { url: await cached };

  const task = encodeTextureUrl({
    width: dimensions.width,
    height: dimensions.height,
    pixels: new Uint8Array(dimensions.width * dimensions.height),
    palette,
    brightness: 1,
    rgba: buildFaceLightmapBakeRgba(
      sourceCandidate.texture,
      bounds,
      selection.grid,
      lighting,
      palette,
      dimensions,
      options.lightSupersample,
    ),
  });
  cache.set(key, task);
  const url = await task;
  cache.set(key, url);
  urls.push(url);
  return { url };
}

function staticWorldLightmapCandidate(
  candidate: QuakeFaceBuildCandidate,
  textures: Array<QuakeMipTexture | null>,
): boolean {
  if (candidate.modelIndex !== 0 || candidate.entityIndex !== undefined) return false;
  const textureName = candidate.texture.name.toLowerCase();
  if (textureName.startsWith("sky") || textureName.startsWith("*") || textureName.startsWith("+")) return false;
  if (textureAnimationFrameTextures(candidate.texture, textures)) return false;
  return !candidate.lightStyles.some((style) => style !== 0);
}

function brightnessFromPolygonData(value: string | number | boolean | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function faceLightmapBakeDimensions(
  bounds: QuakeTextureCoordinateBounds,
  maxTextureSide: number,
): { width: number; height: number } | undefined {
  const spanS = bounds.maxS - bounds.minS;
  const spanT = bounds.maxT - bounds.minT;
  if (![spanS, spanT].every(Number.isFinite) || spanS <= 0 || spanT <= 0) return undefined;
  const scale = Math.min(1, maxTextureSide / Math.max(spanS, spanT));
  const width = Math.max(QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE, Math.ceil(spanS * scale));
  const height = Math.max(QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE, Math.ceil(spanT * scale));
  return {
    width: Math.min(maxTextureSide, width),
    height: Math.min(maxTextureSide, height),
  };
}

function faceLightmapGridFor(
  face: QuakeFace,
  bounds: QuakeTextureCoordinateBounds,
  lighting: Uint8Array,
): QuakeFaceLightmapGrid | undefined {
  if (!lighting.length || face.lightOffset < 0) return undefined;
  const styles = activeLightStyles(face.styles);
  if (styles.length === 0) return undefined;
  const minS = Math.floor(bounds.minS / QUAKE_LIGHT_SAMPLE_SIZE);
  const minT = Math.floor(bounds.minT / QUAKE_LIGHT_SAMPLE_SIZE);
  const width = Math.max(1, Math.ceil(bounds.maxS / QUAKE_LIGHT_SAMPLE_SIZE) - minS + 1);
  const height = Math.max(1, Math.ceil(bounds.maxT / QUAKE_LIGHT_SAMPLE_SIZE) - minT + 1);
  const sampleCount = width * height;
  const byteCount = sampleCount * styles.length;
  if (!Number.isFinite(byteCount) || byteCount <= 0 || face.lightOffset + byteCount > lighting.length) {
    return undefined;
  }
  return { lightOffset: face.lightOffset, minS, minT, width, height, sampleCount, styles };
}

function faceLightmapBakeUv(
  point: QuakeVertex,
  texInfo: QuakeTexInfo,
  bounds: QuakeTextureCoordinateBounds,
): Vec2 {
  const spanS = Math.max(1e-6, bounds.maxS - bounds.minS);
  const spanT = Math.max(1e-6, bounds.maxT - bounds.minT);
  const s = point.x * texInfo.s[0] + point.y * texInfo.s[1] + point.z * texInfo.s[2] + texInfo.s[3];
  const t = point.x * texInfo.t[0] + point.y * texInfo.t[1] + point.z * texInfo.t[2] + texInfo.t[3];
  return [(s - bounds.minS) / spanS, (bounds.maxT - t) / spanT];
}

function faceLightmapDisplayStats(
  grid: QuakeFaceLightmapGrid,
  lighting: Uint8Array,
): { min: number; max: number; mean: number; rmsContrast: number } {
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  let totalSq = 0;
  let count = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const brightness = displayLightBrightness(faceLightmapSampleBrightness(grid, lighting, x, y));
      min = Math.min(min, brightness);
      max = Math.max(max, brightness);
      total += brightness;
      totalSq += brightness * brightness;
      count++;
    }
  }
  if (count === 0) return { min: 1, max: 1, mean: 1, rmsContrast: 0 };
  const mean = total / count;
  const variance = Math.max(0, totalSq / count - mean * mean);
  return { min, max, mean, rmsContrast: Math.sqrt(variance) };
}

function buildFaceLightmapBakeRgba(
  texture: QuakeMipTexture,
  bounds: QuakeTextureCoordinateBounds,
  grid: QuakeFaceLightmapGrid,
  lighting: Uint8Array,
  palette: RGB[],
  dimensions: { width: number; height: number },
  lightSupersample: number,
): Uint8Array {
  const rgba = new Uint8Array(dimensions.width * dimensions.height * 4);
  const spanS = bounds.maxS - bounds.minS;
  const spanT = bounds.maxT - bounds.minT;
  for (let y = 0; y < dimensions.height; y++) {
    const t = bounds.maxT - ((y + 0.5) / dimensions.height) * spanT;
    for (let x = 0; x < dimensions.width; x++) {
      const s = bounds.minS + ((x + 0.5) / dimensions.width) * spanS;
      const paletteIndex = sampleWrappedTextureTexel(texture, s, t);
      const [r, g, b] = palette[paletteIndex] ?? [0, 0, 0];
      const light = paletteIndex >= 224
        ? 1
        : displayLightBrightness(faceLightmapPixelBrightness(grid, lighting, bounds, dimensions, x, y, lightSupersample));
      const offset = (y * dimensions.width + x) * 4;
      rgba[offset] = clampByte(r * light);
      rgba[offset + 1] = clampByte(g * light);
      rgba[offset + 2] = clampByte(b * light);
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

function buildFaceLightmapOverlayRgba(
  bounds: QuakeTextureCoordinateBounds,
  grid: QuakeFaceLightmapGrid,
  lighting: Uint8Array,
  dimensions: { width: number; height: number },
  baseDisplayBrightness: number,
): Uint8Array {
  const rgba = new Uint8Array(dimensions.width * dimensions.height * 4);
  const spanS = bounds.maxS - bounds.minS;
  const spanT = bounds.maxT - bounds.minT;
  const base = Math.max(QUAKE_LIGHT_MIN, baseDisplayBrightness);
  for (let y = 0; y < dimensions.height; y++) {
    const t = bounds.maxT - ((y + 0.5) / dimensions.height) * spanT;
    for (let x = 0; x < dimensions.width; x++) {
      const s = bounds.minS + ((x + 0.5) / dimensions.width) * spanS;
      const light = displayLightBrightness(faceLightmapBrightnessAt(grid, lighting, s, t));
      const darken = Math.max(0, Math.min(QUAKE_LIGHTMAP_OVERLAY_MAX_OPACITY, 1 - light / base));
      const offset = (y * dimensions.width + x) * 4;
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = clampByte(darken * 255);
    }
  }
  return rgba;
}

function buildMergedLightmapOverlayRgba(
  selection: QuakeMergedLightmapOverlaySelection,
  lighting: Uint8Array,
  pivot: QuakeVertex,
): Uint8Array {
  const rgba = new Uint8Array(selection.dimensions.width * selection.dimensions.height * 4);
  const spanX = selection.bounds.maxX - selection.bounds.minX;
  const spanY = selection.bounds.maxY - selection.bounds.minY;
  const base = Math.max(QUAKE_LIGHT_MIN, selection.baseDisplayBrightness);
  for (let y = 0; y < selection.dimensions.height; y++) {
    const localY = selection.bounds.maxY - ((y + 0.5) / selection.dimensions.height) * spanY;
    for (let x = 0; x < selection.dimensions.width; x++) {
      const localX = selection.bounds.minX + ((x + 0.5) / selection.dimensions.width) * spanX;
      const localPoint: Vec2 = [localX, localY];
      const sourceFace = mergedLightmapOverlaySourceFaceAt(selection.sourceFaces, localPoint);
      if (!sourceFace) continue;

      const polyPoint = quakeWallBleedLocalToWorld(localPoint, selection.basis);
      const quakePoint = polyToQuake(polyPoint, pivot);
      const s = quakePoint.x * sourceFace.sourceCandidate.texInfo.s[0] +
        quakePoint.y * sourceFace.sourceCandidate.texInfo.s[1] +
        quakePoint.z * sourceFace.sourceCandidate.texInfo.s[2] +
        sourceFace.sourceCandidate.texInfo.s[3];
      const t = quakePoint.x * sourceFace.sourceCandidate.texInfo.t[0] +
        quakePoint.y * sourceFace.sourceCandidate.texInfo.t[1] +
        quakePoint.z * sourceFace.sourceCandidate.texInfo.t[2] +
        sourceFace.sourceCandidate.texInfo.t[3];
      const light = displayLightBrightness(faceLightmapBrightnessAt(sourceFace.grid, lighting, s, t));
      const darken = Math.max(0, Math.min(QUAKE_LIGHTMAP_OVERLAY_MAX_OPACITY, 1 - light / base));
      const offset = (y * selection.dimensions.width + x) * 4;
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = clampByte(darken * 255);
    }
  }
  return rgba;
}

function mergedLightmapOverlaySourceFaceAt(
  sourceFaces: QuakeMergedLightmapOverlaySourceFace[],
  point: Vec2,
): QuakeMergedLightmapOverlaySourceFace | undefined {
  for (const sourceFace of sourceFaces) {
    if (
      point[0] < sourceFace.bounds.minX - QUAKE_RENDER_COLLINEAR_EPS ||
      point[0] > sourceFace.bounds.maxX + QUAKE_RENDER_COLLINEAR_EPS ||
      point[1] < sourceFace.bounds.minY - QUAKE_RENDER_COLLINEAR_EPS ||
      point[1] > sourceFace.bounds.maxY + QUAKE_RENDER_COLLINEAR_EPS
    ) {
      continue;
    }
    if (quakePointInPolygon2(point, sourceFace.localPoints)) return sourceFace;
  }
  return undefined;
}

function polyToQuake(point: Vec3, pivot: QuakeVertex): QuakeVertex {
  return {
    x: point[0] / QUAKE_UNIT_SCALE + pivot.x,
    y: point[1] / QUAKE_UNIT_SCALE + pivot.y,
    z: point[2] / QUAKE_UNIT_SCALE + pivot.z,
  };
}

function quakeProjectToBasis(point: Vec3, basis: QuakeWallBleedBasis): Vec2 {
  const delta = quakeVecSub3(point, basis.origin);
  return [quakeVecDot3(delta, basis.xAxis), quakeVecDot3(delta, basis.yAxis)];
}

function quakePointsLieOnBasisPlane(points: Vec3[], basis: QuakeWallBleedBasis, normal: Vec3): boolean {
  return points.every((point) =>
    Math.abs(quakeVecDot3(quakeVecSub3(point, basis.origin), normal)) <= QUAKE_RENDER_COLLINEAR_EPS * 64,
  );
}

function quakeLightmapOverlayPlaneKey(vertices: Vec3[]): string | null {
  if (vertices.length < 3) return null;
  let normal = quakePolygonNormal(vertices);
  const first = vertices[0];
  if (!first) return null;
  let dist = quakeVecDot3(normal, first);
  const flip = normal[0] < -QUAKE_RENDER_COLLINEAR_EPS ||
    (Math.abs(normal[0]) <= QUAKE_RENDER_COLLINEAR_EPS && normal[1] < -QUAKE_RENDER_COLLINEAR_EPS) ||
    (
      Math.abs(normal[0]) <= QUAKE_RENDER_COLLINEAR_EPS &&
      Math.abs(normal[1]) <= QUAKE_RENDER_COLLINEAR_EPS &&
      normal[2] < -QUAKE_RENDER_COLLINEAR_EPS
    );
  if (flip) {
    normal = [-normal[0], -normal[1], -normal[2]];
    dist = -dist;
  }
  const scale = 1 / QUAKE_WALL_RENDER_EDGE_KEY_EPS;
  return [
    Math.round(normal[0] * scale),
    Math.round(normal[1] * scale),
    Math.round(normal[2] * scale),
    Math.round(dist * scale),
  ].join(",");
}

function quakeLocalBounds(points: Vec2[]): QuakeLocalBounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  if (![minX, maxX, minY, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return null;
  return { minX, maxX, minY, maxY };
}

function quakeSaneLightmapOverlayBounds(bounds: QuakeLocalBounds, maxAspectRatio: number): boolean {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (spanX <= QUAKE_RENDER_COLLINEAR_EPS || spanY <= QUAKE_RENDER_COLLINEAR_EPS) return false;
  return Math.max(spanX / spanY, spanY / spanX) <= maxAspectRatio;
}

function mergedLightmapOverlayDimensions(
  bounds: QuakeLocalBounds,
  maxTextureSide: number,
): { width: number; height: number } | undefined {
  const spanX = (bounds.maxX - bounds.minX) / QUAKE_UNIT_SCALE;
  const spanY = (bounds.maxY - bounds.minY) / QUAKE_UNIT_SCALE;
  if (![spanX, spanY].every(Number.isFinite) || spanX <= 0 || spanY <= 0) return undefined;
  const scale = Math.min(1, maxTextureSide / Math.max(spanX, spanY));
  return {
    width: Math.max(QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE, Math.min(maxTextureSide, Math.ceil(spanX * scale))),
    height: Math.max(QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE, Math.min(maxTextureSide, Math.ceil(spanY * scale))),
  };
}

function mergedLightmapOverlayUvs(points: Vec2[], bounds: QuakeLocalBounds): Vec2[] {
  const spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-6, bounds.maxY - bounds.minY);
  return points.map((point) => [
    (point[0] - bounds.minX) / spanX,
    (bounds.maxY - point[1]) / spanY,
  ]);
}

function mergedLightmapOverlayRectangleLocalPoints(bounds: QuakeLocalBounds): Vec2[] {
  return [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ];
}

function quakeConvexPolygon2(points: Vec2[]): boolean {
  if (points.length < 3) return false;
  let sign = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    if (!a || !b || !c) return false;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) <= QUAKE_RENDER_COLLINEAR_EPS) continue;
    const nextSign = Math.sign(cross);
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return sign !== 0;
}

function quakePointInPolygon2(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (!a || !b) continue;
    if (quakePointOnSegment2(point, a, b)) return true;
    const intersects = (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function quakePointOnSegment2(point: Vec2, a: Vec2, b: Vec2): boolean {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = point[0] - a[0];
  const apy = point[1] - a[1];
  const cross = abx * apy - aby * apx;
  if (Math.abs(cross) > QUAKE_RENDER_COLLINEAR_EPS) return false;
  const dot = apx * abx + apy * aby;
  if (dot < -QUAKE_RENDER_COLLINEAR_EPS) return false;
  const lenSq = abx * abx + aby * aby;
  return dot <= lenSq + QUAKE_RENDER_COLLINEAR_EPS;
}

function quakeFaceArea(points: QuakeVertex[]): number {
  if (points.length < 3) return 0;
  const origin = points[0];
  if (!origin) return 0;
  let area = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const b = points[i];
    const c = points[i + 1];
    if (!b || !c) continue;
    const ab = quakeVertexSub(b, origin);
    const ac = quakeVertexSub(c, origin);
    area += quakeVertexLength(quakeVertexCross(ab, ac)) * 0.5;
  }
  return area;
}

function quakeVertexSub(a: QuakeVertex, b: QuakeVertex): QuakeVertex {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function quakeVertexCross(a: QuakeVertex, b: QuakeVertex): QuakeVertex {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function quakeVertexLength(value: QuakeVertex): number {
  return Math.hypot(value.x, value.y, value.z);
}

function faceLightmapPixelBrightness(
  grid: QuakeFaceLightmapGrid,
  lighting: Uint8Array,
  bounds: QuakeTextureCoordinateBounds,
  dimensions: { width: number; height: number },
  pixelX: number,
  pixelY: number,
  lightSupersample: number,
): number {
  const samplesPerAxis = Math.max(1, Math.floor(lightSupersample));
  const spanS = bounds.maxS - bounds.minS;
  const spanT = bounds.maxT - bounds.minT;
  if (samplesPerAxis <= 1) {
    const s = bounds.minS + ((pixelX + 0.5) / dimensions.width) * spanS;
    const t = bounds.maxT - ((pixelY + 0.5) / dimensions.height) * spanT;
    return faceLightmapBrightnessAt(grid, lighting, s, t);
  }

  let total = 0;
  const step = 1 / samplesPerAxis;
  for (let sampleY = 0; sampleY < samplesPerAxis; sampleY++) {
    const y = pixelY + (sampleY + 0.5) * step;
    const t = bounds.maxT - (y / dimensions.height) * spanT;
    for (let sampleX = 0; sampleX < samplesPerAxis; sampleX++) {
      const x = pixelX + (sampleX + 0.5) * step;
      const s = bounds.minS + (x / dimensions.width) * spanS;
      total += faceLightmapBrightnessAt(grid, lighting, s, t);
    }
  }
  return clampLightBrightness(total / (samplesPerAxis * samplesPerAxis));
}

function faceLightmapBrightnessAt(
  grid: QuakeFaceLightmapGrid,
  lighting: Uint8Array,
  s: number,
  t: number,
): number {
  const sampleS = s / QUAKE_LIGHT_SAMPLE_SIZE - grid.minS;
  const sampleT = t / QUAKE_LIGHT_SAMPLE_SIZE - grid.minT;
  const x0 = Math.max(0, Math.min(grid.width - 1, Math.floor(sampleS)));
  const y0 = Math.max(0, Math.min(grid.height - 1, Math.floor(sampleT)));
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, sampleS - x0));
  const fy = Math.max(0, Math.min(1, sampleT - y0));
  const top = lerpNumber(
    faceLightmapSampleBrightness(grid, lighting, x0, y0),
    faceLightmapSampleBrightness(grid, lighting, x1, y0),
    fx,
  );
  const bottom = lerpNumber(
    faceLightmapSampleBrightness(grid, lighting, x0, y1),
    faceLightmapSampleBrightness(grid, lighting, x1, y1),
    fx,
  );
  return clampLightBrightness(lerpNumber(top, bottom, fy));
}

function faceLightmapSampleBrightness(
  grid: QuakeFaceLightmapGrid,
  lighting: Uint8Array,
  x: number,
  y: number,
): number {
  const sampleIndex = y * grid.width + x;
  let brightness = 0;
  for (let styleIndex = 0; styleIndex < grid.styles.length; styleIndex++) {
    const offset = grid.lightOffset + styleIndex * grid.sampleCount + sampleIndex;
    const style = grid.styles[styleIndex] ?? 0;
    brightness += lightSampleToBrightness(lighting[offset] ?? 0) * lightScaleForStyle(style);
  }
  return clampLightBrightness(brightness);
}

function displayLightBrightness(brightness: number): number {
  const clamped = clampLightBrightness(brightness);
  return clamped < 1 ? Math.pow(clamped, QUAKE_LIGHT_DISPLAY_GAMMA) : clamped;
}

function undisplayLightBrightness(brightness: number): number {
  const clamped = clampLightBrightness(brightness);
  return clamped < 1 ? Math.pow(clamped, 1 / QUAKE_LIGHT_DISPLAY_GAMMA) : clamped;
}

function sampleWrappedTextureTexel(texture: QuakeMipTexture, s: number, t: number): number {
  const x = wrappedTextureCoord(s, texture.width);
  const y = wrappedTextureCoord(t, texture.height);
  return texture.pixels[y * texture.width + x] ?? 0;
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
  rgba,
}: QuakeTextureEncodeInput): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available.");
  const image = ctx.createImageData(width, height);
  if (rgba) {
    image.data.set(rgba.subarray(0, image.data.length));
  } else {
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
