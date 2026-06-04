import { computeTextureAtlasPlanPublic, mergePolygons, type Polygon, type TextureTriangle, type Vec2, type Vec3 } from "@layoutit/polycss";

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

interface PakEntry {
  name: string;
  offset: number;
  size: number;
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

interface QuakeBrushVisibility {
  leafIndex: number;
  faceIndices: number[];
}

export interface QuakePocVisibility {
  faceForPolygon: number[];
  leafIndexAt(point: Vec3): number;
  visibleLeavesAt(point: Vec3): Set<number> | null;
  visibleFacesAt(point: Vec3): Set<number> | null;
}

export type QuakePocSerializedPolygon = Omit<Polygon, "texture"> & {
  texture?: number | string;
};

export interface QuakePocPreparedVisibility {
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

export interface QuakePocPreparedModel {
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

export interface QuakePocPreparedBrushCollision {
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

export interface QuakePocPreparedCollision {
  planes: QuakePlane[];
  nodes?: QuakeNode[];
  leaves?: QuakeLeaf[];
  clipNodes: QuakeClipNode[];
  headNodes: [number, number, number, number];
  hulls: QuakeCollisionHull[];
  models: QuakePocPreparedModel[];
  brushModels: QuakePocPreparedBrushCollision[];
  pivot: QuakeVertex;
}

export interface QuakePocPreparedScene {
  version: 2;
  polygons: QuakePocSerializedPolygon[];
  textures: string[];
  textureCount: number;
  faceCount: number;
  sourceFaceCount: number;
  label: string;
  warnings: string[];
  entities: QuakeEntity[];
  entityManifest: QuakeEntityManifest;
  models: QuakePocPreparedModel[];
  spawn: {
    origin: Vec3;
    groundZ: number;
    eyeHeight: number;
    rotX: number;
    rotY: number;
  };
  visibility?: QuakePocPreparedVisibility;
  collision?: QuakePocPreparedCollision;
}

export interface QuakePocScene {
  polygons: Polygon[];
  textureUrls: string[];
  textureCount: number;
  faceCount: number;
  sourceFaceCount: number;
  label: string;
  warnings: string[];
  entities: QuakeEntity[];
  entityManifest: QuakeEntityManifest;
  models: QuakePocPreparedModel[];
  spawn: {
    origin: Vec3;
    groundZ: number;
    eyeHeight: number;
    rotX: number;
    rotY: number;
  };
  visibility?: QuakePocVisibility;
  collision?: QuakePocPreparedCollision;
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
const QUAKE_BSP_VERSION = 29;
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
const QUAKE_LIGHTSTYLE_OVERLAY_STRENGTH = 0.72;
const QUAKE_LIGHTSTYLE_OVERLAY_GAMMA = 1.35;
const QUAKE_LIGHTSTYLE_OVERLAY_MAX_OPACITY = 0.52;
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

export async function createQuakePocFromPakFile(file: File): Promise<QuakePocScene> {
  const buffer = await file.arrayBuffer();
  const prepared = await createQuakePocPreparedSceneFromPakBuffer(buffer);
  return createQuakePocFromPreparedScene(prepared);
}

export async function createQuakePocPreparedSceneFromPakBuffer(
  buffer: ArrayBuffer,
  options: { encodeTextureUrl?: QuakeTextureUrlEncoder; mapPath?: string } = {},
): Promise<QuakePocPreparedScene> {
  const entries = parsePak(buffer);
  const palette = paletteFromPak(buffer, entries);
  const mapEntry = options.mapPath
    ? entries.find((entry) => entry.name === options.mapPath)
    : selectMapEntry(entries);
  if (!mapEntry) throw new Error(options.mapPath ? `No ${options.mapPath} entry found in this PAK.` : "No maps/*.bsp entry found in this PAK.");
  const bsp = buffer.slice(mapEntry.offset, mapEntry.offset + mapEntry.size);
  return createQuakePocPreparedSceneFromBsp(
    bsp,
    palette,
    mapEntry.name,
    options.encodeTextureUrl ?? browserTextureUrlEncoder,
  );
}

export function createQuakePocFromPreparedScene(prepared: QuakePocPreparedScene): QuakePocScene {
  if (prepared.version !== QUAKE_PREPARED_SCENE_VERSION) {
    throw new Error(`Unsupported Quake PoC cache version ${String(prepared.version)}.`);
  }
  const polygons = prepared.polygons.map((polygon) => hydratePreparedPolygon(polygon, prepared.textures));
  return {
    polygons,
    textureUrls: [...prepared.textures],
    textureCount: prepared.textureCount,
    faceCount: prepared.faceCount,
    sourceFaceCount: prepared.sourceFaceCount,
    label: prepared.label,
    warnings: [...prepared.warnings],
    entities: cloneEntities(prepared.entities ?? []),
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

function hydratePreparedPolygon(polygon: QuakePocSerializedPolygon, textures: string[]): Polygon {
  const { texture, data, ...rest } = polygon;
  const hydratedTexture = typeof texture === "number" ? textures[texture] : texture;
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
  const sprite = data["quake-texture-animation-sprite"];
  if (typeof sprite === "number") {
    hydrated["quake-texture-animation-sprite"] = textures[sprite];
  }
  return hydrated;
}

async function createQuakePocPreparedSceneFromBsp(
  buffer: ArrayBuffer,
  palette: RGB[],
  label: string,
  encodeTextureUrl: QuakeTextureUrlEncoder,
): Promise<QuakePocPreparedScene> {
  const view = new DataView(buffer);
  const version = view.getInt32(0, true);
  if (version !== QUAKE_BSP_VERSION) {
    throw new Error(`Unsupported BSP version ${version}; expected Quake BSP ${QUAKE_BSP_VERSION}.`);
  }

  const entitiesText = readLumpText(view, buffer, BSP_LUMP_ENTITIES);
  const entities = parseEntities(entitiesText);
  const spawn = parseSpawn(entities);
  const rawVertices = parseVertices(view);
  const bounds = vertexBounds(rawVertices);
  const floorZ = spawn ? spawn.origin.z + QUAKE_PLAYER_MINS_Z : bounds.min.z;
  const pivot = spawn ? { x: spawn.origin.x, y: spawn.origin.y, z: floorZ } : {
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
  const textureAnimationSpriteCache = new Map<string, Promise<string> | string>();
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
        quake: true,
        "quake-texture": texture.name,
        "quake-face": candidate.faceIndex,
        "quake-model": candidate.modelIndex,
        ...(candidate.entityIndex !== undefined ? { "quake-entity": candidate.entityIndex } : {}),
        "quake-light": formatQuakeBrightness(brightness),
        ...(buttonPressedTextureUrl
          ? {
              "quake-button-base-texture": textureUrl,
              "quake-button-pressed-texture": buttonPressedTextureUrl,
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

  const sourceFaceCount = candidates.length;
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
  const warnings: string[] = [];
  if (polygons.length > 2500) {
    warnings.push(`Mounted ${polygons.length} merged BSP faces from ${sourceFaceCount} source faces; trigger brush volumes are excluded.`);
  }

  const angle = spawn?.angle ?? 90;
  const spawnState = {
    origin: spawn ? [0, 0, QUAKE_EYE_HEIGHT] : [0, -6, QUAKE_EYE_HEIGHT],
    groundZ: 0,
    eyeHeight: QUAKE_EYE_HEIGHT,
    rotX: 90,
    rotY: (180 + angle + 360) % 360,
  } satisfies QuakePocScene["spawn"];
  return {
    version: QUAKE_PREPARED_SCENE_VERSION,
    polygons: serialized.polygons,
    textures: serialized.textures,
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
    collision: buildPreparedCollision(planes, nodes, leaves, clipNodes, preparedModels, entities, model.headNodes, pivot),
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

function buildEntityManifest(entities: QuakeEntity[]): QuakeEntityManifest {
  const targetnameIndex = new Map<string, number[]>();
  for (const entity of entities) {
    const targetname = entity.properties.targetname;
    if (!targetname) continue;
    const bucket = targetnameIndex.get(targetname);
    if (bucket) {
      bucket.push(entity.index);
    } else {
      targetnameIndex.set(targetname, [entity.index]);
    }
  }

  const manifest: QuakeEntityManifest = {
    totals: {
      entities: entities.length,
      active: 0,
      metadataOnly: 0,
      ignored: 0,
      byClassname: {},
      byCategory: {},
    },
    entries: [],
    starts: [],
    pickups: [],
    monsters: [],
    triggers: [],
    movers: [],
    teleporters: [],
    exits: [],
    lights: [],
    counters: [],
    secrets: [],
    inert: [],
  };

  for (const entity of entities) {
    const category = quakeEntityManifestCategory(entity);
    const runtimeStatus = quakeEntityRuntimeStatus(entity, category);
    const spawnflags = quakeManifestInteger(entity, "spawnflags") ?? 0;
    const entry: QuakeEntityManifestEntry = {
      entityIndex: entity.index,
      classname: entity.classname,
      category,
      runtimeStatus,
      spawnflags,
      ...(entity.origin ? { origin: { ...entity.origin } } : {}),
      ...(entity.angle !== undefined ? { angle: entity.angle } : {}),
      ...(entity.model !== undefined ? { model: entity.model } : {}),
      ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
      ...(entity.properties.target ? { target: entity.properties.target } : {}),
      ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
      ...quakeEntityRuntimeReason(runtimeStatus, category),
    };

    manifest.entries.push(entry);
    incrementRecord(manifest.totals.byClassname, entity.classname || "(empty)");
    incrementRecord(manifest.totals.byCategory, category);
    if (runtimeStatus === "active") manifest.totals.active += 1;
    if (runtimeStatus === "metadata-only") manifest.totals.metadataOnly += 1;
    if (runtimeStatus === "ignored") manifest.totals.ignored += 1;
    if (runtimeStatus !== "active") manifest.inert.push(entry);

    const point = quakeManifestPoint(entity, spawnflags);
    if (category === "player-start" && point) manifest.starts.push(point);
    if (category === "pickup" && point) manifest.pickups.push(point);
    if (category === "monster" && point) manifest.monsters.push(point);
    if (category === "light" && entity.origin) manifest.lights.push(quakeManifestLight(entity, spawnflags));

    if (entity.classname.startsWith("trigger_")) {
      const trigger = quakeManifestTrigger(entity, spawnflags);
      manifest.triggers.push(trigger);
      if (category === "counter") manifest.counters.push(trigger);
      if (category === "secret") manifest.secrets.push(trigger);
    }
    if (category === "mover") {
      manifest.movers.push(quakeManifestMover(entity, spawnflags));
      if (entity.classname === "func_door_secret") {
        manifest.secrets.push(quakeManifestTrigger(entity, spawnflags));
      }
    }
    if (category === "teleporter" && entity.properties.target) {
      manifest.teleporters.push({
        entityIndex: entity.index,
        ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
        target: entity.properties.target,
        destinationEntityIndexes: [...(targetnameIndex.get(entity.properties.target) ?? [])],
      });
    }
    if (category === "exit") {
      manifest.exits.push({
        entityIndex: entity.index,
        ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
        ...(entity.properties.map ? { map: entity.properties.map } : {}),
      });
    }
  }

  return manifest;
}

function cloneEntityManifest(manifest: QuakeEntityManifest): QuakeEntityManifest {
  return {
    totals: {
      entities: manifest.totals.entities,
      active: manifest.totals.active,
      metadataOnly: manifest.totals.metadataOnly,
      ignored: manifest.totals.ignored,
      byClassname: { ...manifest.totals.byClassname },
      byCategory: { ...manifest.totals.byCategory },
    },
    entries: manifest.entries.map(cloneEntityManifestEntry),
    starts: manifest.starts.map(cloneEntityManifestPoint),
    pickups: manifest.pickups.map(cloneEntityManifestPoint),
    monsters: manifest.monsters.map(cloneEntityManifestPoint),
    triggers: manifest.triggers.map(cloneEntityManifestTrigger),
    movers: manifest.movers.map(cloneEntityManifestMover),
    teleporters: manifest.teleporters.map((teleporter) => ({
      entityIndex: teleporter.entityIndex,
      ...(teleporter.modelIndex !== undefined ? { modelIndex: teleporter.modelIndex } : {}),
      target: teleporter.target,
      destinationEntityIndexes: [...teleporter.destinationEntityIndexes],
    })),
    exits: manifest.exits.map((exit) => ({
      entityIndex: exit.entityIndex,
      ...(exit.modelIndex !== undefined ? { modelIndex: exit.modelIndex } : {}),
      ...(exit.map ? { map: exit.map } : {}),
    })),
    lights: manifest.lights.map((light) => ({
      entityIndex: light.entityIndex,
      classname: light.classname,
      origin: { ...light.origin },
      spawnflags: light.spawnflags,
      ...(light.light !== undefined ? { light: light.light } : {}),
      ...(light.style !== undefined ? { style: light.style } : {}),
      ...(light.targetname ? { targetname: light.targetname } : {}),
      ...(light.delay !== undefined ? { delay: light.delay } : {}),
      ...(light.wait !== undefined ? { wait: light.wait } : {}),
      ...(light.mangle ? { mangle: { ...light.mangle } } : {}),
      ...(light.color ? { color: [...light.color] as RGB } : {}),
    })),
    counters: manifest.counters.map(cloneEntityManifestTrigger),
    secrets: manifest.secrets.map(cloneEntityManifestTrigger),
    inert: manifest.inert.map(cloneEntityManifestEntry),
  };
}

function quakeEntityManifestCategory(entity: QuakeEntity): QuakeEntityManifestCategory {
  const classname = entity.classname;
  if (classname === "worldspawn") return "worldspawn";
  if (classname === "info_player_start") return "player-start";
  if (classname === "info_player_deathmatch" || classname === "info_player_coop") return "multiplayer";
  if (isQuakePickupClassname(classname)) return "pickup";
  if (classname.startsWith("monster_")) return "monster";
  if (classname === "trigger_teleport") return "teleporter";
  if (classname === "trigger_changelevel") return "exit";
  if (classname === "trigger_counter") return "counter";
  if (classname === "trigger_secret") return "secret";
  if (classname.startsWith("trigger_")) return "trigger";
  if (isQuakeMoverClassname(classname)) return "mover";
  if (classname.startsWith("func_")) return "brush";
  if (classname === "light" || classname.startsWith("light_")) return "light";
  if (classname === "path_corner" || classname.startsWith("info_intermission")) return "path";
  if (classname.startsWith("ambient_")) return "ambient";
  if (classname.startsWith("misc_")) return "decor";
  return "unknown";
}

function quakeEntityRuntimeStatus(
  entity: QuakeEntity,
  category: QuakeEntityManifestCategory,
): QuakeEntityRuntimeStatus {
  if (category === "multiplayer" || category === "ambient") return "ignored";
  if (
    category === "worldspawn" ||
    category === "player-start" ||
    category === "pickup" ||
    category === "teleporter" ||
    category === "exit" ||
    category === "counter" ||
    category === "secret" ||
    category === "mover"
  ) return "active";
  if (category === "trigger" && isQuakeActiveTriggerClassname(entity.classname)) return "active";
  if (category === "brush" && entity.modelIndex !== undefined) return "active";
  if (category === "decor" && isQuakeShootableDecorClassname(entity.classname)) return "active";
  return "metadata-only";
}

function quakeEntityRuntimeReason(
  runtimeStatus: QuakeEntityRuntimeStatus,
  category: QuakeEntityManifestCategory,
): Pick<QuakeEntityManifestEntry, "reason"> {
  if (runtimeStatus === "active") return {};
  if (category === "multiplayer") return { reason: "multiplayer unsupported" };
  if (category === "ambient") return { reason: "sound disabled" };
  if (category === "monster") return { reason: "monster behavior not implemented" };
  if (category === "light") return { reason: "BSP lightmaps are baked; point light entities are metadata only" };
  if (category === "decor") return { reason: "decor model spawning not implemented" };
  return { reason: "runtime behavior not implemented" };
}

function isQuakePickupClassname(classname: string): boolean {
  return classname.startsWith("item_") ||
    classname.startsWith("weapon_") ||
    classname.startsWith("ammo_") ||
    classname.startsWith("key_");
}

function isQuakeMoverClassname(classname: string): boolean {
  return classname === "func_button" ||
    classname === "func_door" ||
    classname === "func_door_secret" ||
    classname === "func_plat";
}

function isQuakeActiveTriggerClassname(classname: string): boolean {
  return classname === "trigger_hurt" ||
    classname === "trigger_multiple" ||
    classname === "trigger_once";
}

function isQuakeShootableDecorClassname(classname: string): boolean {
  return classname === "misc_explobox" ||
    classname === "misc_explobox2";
}

function quakeManifestPoint(entity: QuakeEntity, spawnflags: number): QuakeEntityManifestPoint | null {
  if (!entity.origin) return null;
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    origin: { ...entity.origin },
    spawnflags,
    ...(entity.angle !== undefined ? { angle: entity.angle } : {}),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
  };
}

function quakeManifestTrigger(entity: QuakeEntity, spawnflags: number): QuakeEntityManifestTrigger {
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
    spawnflags,
    ...(entity.properties.target ? { target: entity.properties.target } : {}),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
    ...quakeManifestOptionalNumber(entity, "delay"),
    ...quakeManifestOptionalNumber(entity, "wait"),
    ...quakeManifestOptionalNumber(entity, "count"),
    ...quakeManifestOptionalNumber(entity, "dmg"),
    ...(entity.properties.message ? { message: entity.properties.message } : {}),
  };
}

function quakeManifestMover(entity: QuakeEntity, spawnflags: number): QuakeEntityManifestMover {
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
    spawnflags,
    ...(entity.properties.target ? { target: entity.properties.target } : {}),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
    ...quakeManifestOptionalNumber(entity, "speed"),
    ...quakeManifestOptionalNumber(entity, "wait"),
    ...quakeManifestOptionalNumber(entity, "lip"),
    ...quakeManifestOptionalNumber(entity, "height"),
  };
}

function quakeManifestLight(entity: QuakeEntity, spawnflags: number): QuakeEntityManifestLight {
  const mangle = quakeManifestVector(entity.properties.mangle);
  const color = quakeManifestColor(entity.properties._color);
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    origin: { ...(entity.origin ?? { x: 0, y: 0, z: 0 }) },
    spawnflags,
    ...quakeManifestOptionalNumber(entity, "light"),
    ...quakeManifestOptionalNumber(entity, "style"),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
    ...quakeManifestOptionalNumber(entity, "delay"),
    ...quakeManifestOptionalNumber(entity, "wait"),
    ...(mangle ? { mangle } : {}),
    ...(color ? { color } : {}),
  };
}

function cloneEntityManifestEntry(entry: QuakeEntityManifestEntry): QuakeEntityManifestEntry {
  return {
    entityIndex: entry.entityIndex,
    classname: entry.classname,
    category: entry.category,
    runtimeStatus: entry.runtimeStatus,
    spawnflags: entry.spawnflags,
    ...(entry.origin ? { origin: { ...entry.origin } } : {}),
    ...(entry.angle !== undefined ? { angle: entry.angle } : {}),
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    ...(entry.modelIndex !== undefined ? { modelIndex: entry.modelIndex } : {}),
    ...(entry.target ? { target: entry.target } : {}),
    ...(entry.targetname ? { targetname: entry.targetname } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
  };
}

function cloneEntityManifestPoint(point: QuakeEntityManifestPoint): QuakeEntityManifestPoint {
  return {
    entityIndex: point.entityIndex,
    classname: point.classname,
    origin: { ...point.origin },
    spawnflags: point.spawnflags,
    ...(point.angle !== undefined ? { angle: point.angle } : {}),
    ...(point.targetname ? { targetname: point.targetname } : {}),
  };
}

function cloneEntityManifestTrigger(trigger: QuakeEntityManifestTrigger): QuakeEntityManifestTrigger {
  return {
    entityIndex: trigger.entityIndex,
    classname: trigger.classname,
    ...(trigger.modelIndex !== undefined ? { modelIndex: trigger.modelIndex } : {}),
    spawnflags: trigger.spawnflags,
    ...(trigger.target ? { target: trigger.target } : {}),
    ...(trigger.targetname ? { targetname: trigger.targetname } : {}),
    ...(trigger.delay !== undefined ? { delay: trigger.delay } : {}),
    ...(trigger.wait !== undefined ? { wait: trigger.wait } : {}),
    ...(trigger.count !== undefined ? { count: trigger.count } : {}),
    ...(trigger.dmg !== undefined ? { dmg: trigger.dmg } : {}),
    ...(trigger.message ? { message: trigger.message } : {}),
  };
}

function cloneEntityManifestMover(mover: QuakeEntityManifestMover): QuakeEntityManifestMover {
  return {
    ...cloneEntityManifestTrigger(mover),
    ...(mover.speed !== undefined ? { speed: mover.speed } : {}),
    ...(mover.lip !== undefined ? { lip: mover.lip } : {}),
    ...(mover.height !== undefined ? { height: mover.height } : {}),
  };
}

function quakeManifestOptionalNumber(entity: QuakeEntity, key: string): Record<string, number> {
  const value = quakeManifestNumber(entity, key);
  return value === undefined ? {} : { [key]: value };
}

function quakeManifestInteger(entity: QuakeEntity, key: string): number | undefined {
  const value = quakeManifestNumber(entity, key);
  return value === undefined ? undefined : Math.trunc(value);
}

function quakeManifestNumber(entity: QuakeEntity, key: string): number | undefined {
  const value = parseFiniteNumber(entity.properties[key]);
  return value === null ? undefined : value;
}

function quakeManifestVector(value: string | undefined): QuakeVertex | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/).map((part) => parseFiniteNumber(part));
  if (parts.length < 3 || parts.some((part) => part === null)) return undefined;
  return { x: parts[0] ?? 0, y: parts[1] ?? 0, z: parts[2] ?? 0 };
}

function quakeManifestColor(value: string | undefined): RGB | undefined {
  const vector = quakeManifestVector(value);
  if (!vector) return undefined;
  return [vector.x, vector.y, vector.z];
}

function incrementRecord(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function clonePreparedModels(models: QuakePocPreparedModel[]): QuakePocPreparedModel[] {
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
): { polygons: QuakePocSerializedPolygon[]; textures: string[] } {
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
        } as QuakePocSerializedPolygon;
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
  const sprite = data["quake-texture-animation-sprite"];
  if (typeof sprite === "string") {
    serialized["quake-texture-animation-sprite"] = indexForTexture(sprite);
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
): QuakePocPreparedVisibility | undefined {
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

function buildPreparedModels(models: QuakeModel[]): QuakePocPreparedModel[] {
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
  models: QuakePocPreparedModel[],
  entities: QuakeEntity[],
  headNodes: [number, number, number, number],
  pivot: QuakeVertex,
): QuakePocPreparedCollision | undefined {
  if (!planes.length || !clipNodes.length) return undefined;
  const worldModel = models[0];
  return {
    planes,
    nodes,
    leaves,
    clipNodes,
    headNodes: [...(worldModel?.headNodes ?? headNodes)] as [number, number, number, number],
    hulls: worldModel ? cloneHulls(worldModel.hulls) : hullsForHeadNodes(headNodes),
    models: clonePreparedModels(models),
    brushModels: buildPreparedBrushCollisionModels(entities, models),
    pivot,
  };
}

function buildPreparedBrushCollisionModels(
  entities: QuakeEntity[],
  models: QuakePocPreparedModel[],
): QuakePocPreparedBrushCollision[] {
  const out: QuakePocPreparedBrushCollision[] = [];
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

function parsePak(buffer: ArrayBuffer): PakEntry[] {
  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== "PACK") throw new Error("Not a Quake PAK file.");
  const dirOffset = view.getInt32(4, true);
  const dirSize = view.getInt32(8, true);
  if (dirOffset < 0 || dirSize < 0 || dirOffset + dirSize > buffer.byteLength || dirSize % 64 !== 0) {
    throw new Error("Invalid PAK directory.");
  }

  const entries: PakEntry[] = [];
  for (let offset = dirOffset; offset < dirOffset + dirSize; offset += 64) {
    entries.push({
      name: readAscii(view, offset, 56).toLowerCase(),
      offset: view.getInt32(offset + 56, true),
      size: view.getInt32(offset + 60, true),
    });
  }
  return entries;
}

function selectMapEntry(entries: PakEntry[]): PakEntry | undefined {
  const maps = entries.filter((entry) => /^maps\/.+\.bsp$/.test(entry.name));
  return maps.find((entry) => entry.name === "maps/e1m1.bsp") ??
    maps.find((entry) => entry.name === "maps/start.bsp") ??
    maps[0];
}

function paletteFromPak(buffer: ArrayBuffer, entries: PakEntry[]): RGB[] {
  const entry = entries.find((item) => item.name === "gfx/palette.lmp");
  if (!entry || entry.size < 768) return defaultPalette();
  const bytes = new Uint8Array(buffer, entry.offset, entry.size);
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
    const name = readAscii(view, base, 16);
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

function bspLump(view: DataView, index: number): { offset: number; length: number } {
  if (index < 0 || index >= BSP_LUMP_COUNT) throw new Error(`Invalid BSP lump ${index}.`);
  const offset = view.getInt32(4 + index * 8, true);
  const length = view.getInt32(8 + index * 8, true);
  if (offset < 0 || length < 0 || offset + length > view.byteLength) {
    throw new Error(`Invalid BSP lump bounds for lump ${index}.`);
  }
  return { offset, length };
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
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
  for (const group of groups.values()) {
    if (group.length < 2) {
      pushRenderCandidate(out, group[0].polygon, group[0].sourceFaceIndices);
      continue;
    }

    const merged = mergePolygons(group.map((candidate) => polygonForMerge(candidate.polygon)));
    if (merged.length >= group.length) {
      for (const candidate of group) {
        pushRenderCandidate(out, candidate.polygon, candidate.sourceFaceIndices);
      }
      continue;
    }

    const sourceFaceIndices = uniqueSorted(group.flatMap((candidate) => candidate.sourceFaceIndices));
    const fallbackData = quakeFallbackData(group[0].polygon);
    for (const polygon of merged) {
      pushRenderCandidate(out, polygon, sourceFaceIndices, fallbackData);
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
    const textureName = typeof data?.["quake-texture"] === "string" ? data["quake-texture"] : "";
    const texture = textureByName.get(textureName.toLowerCase());
    if (!texture || !textureAnimationFrameTextures(texture, textures)) continue;
    const brightnessValue = typeof data?.["quake-light"] === "string"
      ? parseFiniteNumber(data["quake-light"])
      : typeof data?.["quake-light"] === "number"
        ? data["quake-light"]
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
      "quake-texture-animation-sprite": animation.sprite,
      "quake-texture-animation-frame-count": animation.frameCount,
    };
  }
}

function quakeMergeGroupKey(candidate: QuakeFaceCandidate, visibilityKeys: Map<number, string>): string {
  const polygon = candidate.polygon;
  return [
    visibilityKeys.get(candidate.faceIndex) ?? `face:${candidate.faceIndex}`,
    polygon.texture ?? "",
    polygon.color ?? "",
    polygon.textureWrap?.s ?? "",
    polygon.textureWrap?.t ?? "",
    polygon.textureAlphaMode ?? "",
    polygon.doubleSided === true ? "double" : "single",
    String(polygon.data?.["quake-texture"] ?? ""),
    String(polygon.data?.["quake-model"] ?? ""),
    String(polygon.data?.["quake-entity"] ?? ""),
    String(polygon.data?.["quake-light"] ?? ""),
    String(polygon.data?.["quake-lightstyles"] ?? ""),
    String(polygon.data?.["quake-lightstyle-animation"] ?? ""),
    String(polygon.data?.["quake-lightstyle-overlay-pattern"] ?? ""),
    String(polygon.data?.["quake-button-base-texture"] ?? ""),
    String(polygon.data?.["quake-button-pressed-texture"] ?? ""),
  ].join("\u001f");
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
): void {
  const faceIndex = out.length;
  const textureName = String(polygon.data?.["quake-texture"] ?? fallbackData["quake-texture"] ?? "");
  const modelIndex = String(polygon.data?.["quake-model"] ?? fallbackData["quake-model"] ?? "");
  const entityIndex = String(polygon.data?.["quake-entity"] ?? fallbackData["quake-entity"] ?? "");
  const brightness = String(polygon.data?.["quake-light"] ?? fallbackData["quake-light"] ?? "");
  const lightStyles = String(polygon.data?.["quake-lightstyles"] ?? fallbackData["quake-lightstyles"] ?? "");
  const lightstyleAnimation = String(
    polygon.data?.["quake-lightstyle-animation"] ?? fallbackData["quake-lightstyle-animation"] ?? "",
  );
  const lightstyleOverlayPattern = String(
    polygon.data?.["quake-lightstyle-overlay-pattern"] ?? fallbackData["quake-lightstyle-overlay-pattern"] ?? "",
  );
  const buttonBaseTexture = String(
    polygon.data?.["quake-button-base-texture"] ?? fallbackData["quake-button-base-texture"] ?? "",
  );
  const buttonPressedTexture = String(
    polygon.data?.["quake-button-pressed-texture"] ?? fallbackData["quake-button-pressed-texture"] ?? "",
  );
  const sortedSourceFaceIndices = uniqueSorted(sourceFaceIndices);
  out.push({
    faceIndex,
    sourceFaceIndices: sortedSourceFaceIndices,
    points: [],
    polygon: {
      ...polygon,
      data: {
        quake: true,
        "quake-face": faceIndex,
        ...(textureName ? { "quake-texture": textureName } : {}),
        ...(modelIndex ? { "quake-model": modelIndex } : {}),
        ...(entityIndex ? { "quake-entity": entityIndex } : {}),
        ...(brightness ? { "quake-light": brightness } : {}),
        ...(lightStyles ? { "quake-lightstyles": lightStyles } : {}),
        ...(lightstyleAnimation ? { "quake-lightstyle-animation": lightstyleAnimation } : {}),
        ...(lightstyleOverlayPattern ? { "quake-lightstyle-overlay-pattern": lightstyleOverlayPattern } : {}),
        ...(buttonBaseTexture ? { "quake-button-base-texture": buttonBaseTexture } : {}),
        ...(buttonPressedTexture ? { "quake-button-pressed-texture": buttonPressedTexture } : {}),
      },
    },
  });
}

function quakeFallbackData(polygon: Polygon): Record<string, string | number | boolean> {
  const data = polygon.data ?? {};
  return {
    ...(data["quake-texture"] !== undefined ? { "quake-texture": data["quake-texture"] } : {}),
    ...(data["quake-model"] !== undefined ? { "quake-model": data["quake-model"] } : {}),
    ...(data["quake-entity"] !== undefined ? { "quake-entity": data["quake-entity"] } : {}),
    ...(data["quake-light"] !== undefined ? { "quake-light": data["quake-light"] } : {}),
    ...(data["quake-lightstyles"] !== undefined ? { "quake-lightstyles": data["quake-lightstyles"] } : {}),
    ...(data["quake-lightstyle-animation"] !== undefined
      ? { "quake-lightstyle-animation": data["quake-lightstyle-animation"] }
      : {}),
    ...(data["quake-lightstyle-overlay-pattern"] !== undefined
      ? { "quake-lightstyle-overlay-pattern": data["quake-lightstyle-overlay-pattern"] }
      : {}),
    ...(data["quake-button-base-texture"] !== undefined
      ? { "quake-button-base-texture": data["quake-button-base-texture"] }
      : {}),
    ...(data["quake-button-pressed-texture"] !== undefined
      ? { "quake-button-pressed-texture": data["quake-button-pressed-texture"] }
      : {}),
  };
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function buildSourceFaceVisibilityKeys(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  markSurfaces: number[],
  visData: Uint8Array,
  candidates: QuakeFaceCandidate[],
  brushModels: QuakeBrushModel[],
): Map<number, string> {
  if (!planes.length || !nodes.length || !leaves.length) {
    return new Map(candidates.map((candidate) => [candidate.faceIndex, "all"]));
  }
  const sourceFaces = sourceFaceSetFor(candidates);
  const worldFaceByLeaf = buildWorldFaceByLeaf(leaves, markSurfaces, sourceFaces);
  const brushVisibility = buildBrushVisibility(brushModels, sourceFaces, planes, nodes);
  const visibleFromLeafByFace = new Map<number, number[]>();
  for (const faceIndex of sourceFaces) visibleFromLeafByFace.set(faceIndex, []);

  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    const visibleFaces = visibleSourceFacesForLeaf(
      leafIndex,
      leaves,
      worldFaceByLeaf,
      visData,
      brushVisibility,
      sourceFaces,
    ) ?? sourceFaces;
    for (const faceIndex of visibleFaces) {
      visibleFromLeafByFace.get(faceIndex)?.push(leafIndex);
    }
  }

  const keys = new Map<number, string>();
  for (const [faceIndex, visibleLeaves] of visibleFromLeafByFace) {
    keys.set(faceIndex, visibleLeaves.join(","));
  }
  return keys;
}

function buildVisibility(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  markSurfaces: number[],
  visData: Uint8Array,
  candidates: QuakeVisibilityCandidate[],
  brushModels: QuakeBrushModel[],
  pivot: QuakeVertex,
): QuakePocVisibility | undefined {
  if (!planes.length || !nodes.length || !leaves.length) return undefined;
  const sourceFaces = sourceFaceSetFor(candidates);
  const renderFacesBySource = renderFaceMapFor(candidates);
  const faceForPolygon = candidates.map((candidate) => candidate.faceIndex);
  const worldFaceByLeaf = buildWorldFaceByLeaf(leaves, markSurfaces, sourceFaces);
  const brushVisibility = buildBrushVisibility(brushModels, sourceFaces, planes, nodes);
  const allFaces = new Set(candidates.map((candidate) => candidate.faceIndex));

  function leafIndexAt(point: Vec3): number {
    return leafForPoint(polyToQuake(point, pivot), planes, nodes);
  }

  function visibleLeavesAt(point: Vec3): Set<number> | null {
    const leafIndex = leafIndexAt(point);
    const leaf = leaves[leafIndex];
    if (!leaf) return new Set([leafIndex]);
    if (leaf.visOffset < 0 || !visData.length) return null;
    const visible = decompressVisibleLeaves(visData, leaf.visOffset, leaves.length);
    const out = new Set<number>([leafIndex]);
    for (let i = 0; i < visible.length; i++) {
      if (visible[i]) out.add(i);
    }
    return out;
  }

  function visibleFacesAt(point: Vec3): Set<number> | null {
    const leafIndex = leafIndexAt(point);
    const sourceVisibleFaces = visibleSourceFacesForLeaf(
      leafIndex,
      leaves,
      worldFaceByLeaf,
      visData,
      brushVisibility,
      sourceFaces,
    );
    if (!sourceVisibleFaces) return allFaces;
    const faces = new Set<number>();
    for (const sourceFaceIndex of sourceVisibleFaces) {
      for (const renderFaceIndex of renderFacesBySource.get(sourceFaceIndex) ?? []) {
        faces.add(renderFaceIndex);
      }
    }
    return faces;
  }

  return { faceForPolygon, leafIndexAt, visibleLeavesAt, visibleFacesAt };
}

function sourceFaceSetFor(candidates: QuakeVisibilityCandidate[]): Set<number> {
  const faces = new Set<number>();
  for (const candidate of candidates) {
    for (const faceIndex of candidate.sourceFaceIndices) faces.add(faceIndex);
  }
  return faces;
}

function renderFaceMapFor(candidates: QuakeVisibilityCandidate[]): Map<number, number[]> {
  const faces = new Map<number, number[]>();
  for (const candidate of candidates) {
    for (const sourceFaceIndex of candidate.sourceFaceIndices) {
      const renderFaces = faces.get(sourceFaceIndex);
      if (renderFaces) {
        renderFaces.push(candidate.faceIndex);
      } else {
        faces.set(sourceFaceIndex, [candidate.faceIndex]);
      }
    }
  }
  return faces;
}

function buildWorldFaceByLeaf(
  leaves: QuakeLeaf[],
  markSurfaces: number[],
  sourceFaces: Set<number>,
): Array<Set<number>> {
  return leaves.map((leaf) => {
    const faces = new Set<number>();
    const end = leaf.firstMarkSurface + leaf.markSurfaceCount;
    for (let i = leaf.firstMarkSurface; i < end; i++) {
      const faceIndex = markSurfaces[i];
      if (faceIndex !== undefined && sourceFaces.has(faceIndex)) faces.add(faceIndex);
    }
    return faces;
  });
}

function buildBrushVisibility(
  brushModels: QuakeBrushModel[],
  sourceFaces: Set<number>,
  planes: QuakePlane[],
  nodes: QuakeNode[],
): QuakeBrushVisibility[] {
  return brushModels.map((brushModel) => ({
    leafIndex: leafForPoint(brushModel.center, planes, nodes),
    faceIndices: brushModel.faceIndices.filter((faceIndex) => sourceFaces.has(faceIndex)),
  })).filter((brushModel) => brushModel.faceIndices.length > 0);
}

function visibleSourceFacesForLeaf(
  leafIndex: number,
  leaves: QuakeLeaf[],
  worldFaceByLeaf: Array<Set<number>>,
  visData: Uint8Array,
  brushVisibility: QuakeBrushVisibility[],
  sourceFaces: Set<number>,
): Set<number> | null {
  const leaf = leaves[leafIndex];
  if (!leaf) return sourceFaces;
  if (leaf.visOffset < 0 || !visData.length) return null;

  const visibleLeaves = decompressVisibleLeaves(visData, leaf.visOffset, leaves.length);
  const faces = new Set<number>();
  for (let i = 0; i < visibleLeaves.length; i++) {
    if (!visibleLeaves[i]) continue;
    for (const faceIndex of worldFaceByLeaf[i] ?? []) faces.add(faceIndex);
  }
  for (const brushModel of brushVisibility) {
    if (brushModel.leafIndex !== leafIndex && !visibleLeaves[brushModel.leafIndex]) continue;
    for (const faceIndex of brushModel.faceIndices) faces.add(faceIndex);
  }
  return faces;
}

function leafForPoint(point: QuakeVertex, planes: QuakePlane[], nodes: QuakeNode[]): number {
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

function decompressVisibleLeaves(visData: Uint8Array, offset: number, leafCount: number): boolean[] {
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
      quantizeLightBrightness(
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

function polyToQuake(point: Vec3, pivot: QuakeVertex): QuakeVertex {
  return {
    x: point[0] / QUAKE_UNIT_SCALE + pivot.x,
    y: point[1] / QUAKE_UNIT_SCALE + pivot.y,
    z: point[2] / QUAKE_UNIT_SCALE + pivot.z,
  };
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
    values.push(Math.max(QUAKE_LIGHT_MIN, Math.min(QUAKE_LIGHT_MAX, brightness)));
  }

  return quantizeLightBrightness(trimmedBrightnessAverage(values));
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
    "quake-lightstyles": styles.join(","),
    ...(animatedStyle !== undefined ? { "quake-lightstyle-animation": String(animatedStyle) } : {}),
  };
}

function lightstyleOverlayData(candidate: QuakeFaceBuildCandidate, baseBrightness: number): Record<string, string> {
  if (candidate.lightstyleAnimation === undefined || !candidate.lightstyleFrameBrightnesses?.length) return {};
  const opacities = candidate.lightstyleFrameBrightnesses.map((brightness) =>
    lightstyleOverlayOpacity(baseBrightness, brightness).toFixed(3),
  );
  return {
    "quake-lightstyle-overlay-pattern": opacities.join(","),
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
  return Math.max(QUAKE_LIGHT_MIN, Math.min(QUAKE_LIGHT_MAX, (sample / 128) * QUAKE_LIGHT_SAMPLE_NORMAL_SCALE));
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
  const clamped = Math.max(QUAKE_LIGHT_MIN, Math.min(QUAKE_LIGHT_MAX, brightness));
  const adjusted = clamped < 1 ? Math.pow(clamped, QUAKE_LIGHT_DISPLAY_GAMMA) : clamped;
  return Math.round(adjusted * QUAKE_LIGHT_BUCKETS) / QUAKE_LIGHT_BUCKETS;
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
