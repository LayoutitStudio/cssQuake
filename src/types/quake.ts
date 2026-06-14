import type { Polygon, Vec3 } from "@layoutit/polycss";

import type { QuakeGameLogicFacts } from "../prepare/gameLogicFacts";

export type RGB = [number, number, number];

export interface QuakeVertex {
  x: number;
  y: number;
  z: number;
}

export interface QuakePlane {
  normal: QuakeVertex;
  dist: number;
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

export interface QuakeBrushModel {
  faceIndices: number[];
  center: QuakeVertex;
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
