import type { Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../../prepare/scene";
import { QUAKE_PLAYER_MINS_Z, STEP_HEIGHT } from "../constants";
import type { QuakePlayerInventory } from "../hud";
import type { QuakeMoversDebugStats } from "../movers";
import type { QuakeShootablesDebugStats } from "../shootables";
import type { QuakeResolvedViewmodelTuning, QuakeViewmodelDebugSnapshot, QuakeViewmodelTuning } from "../viewmodel";
import type { QuakeWorldDebugStats } from "../world";

const QUAKE_DEBUG_PROJECTION_LEAF_BUDGET_PX = 5000;
const QUAKE_DEBUG_PICKUP_PROJECTION_LEAF_VIEWPORT_BUDGET = 0.1;
const QUAKE_DEBUG_PROJECTION_MESH_VIEWPORT_BUDGET = 0.55;
const QUAKE_DEBUG_PROJECTION_TOTAL_VIEWPORT_BUDGET = 0.45;
const QUAKE_DEBUG_PROJECTION_MESH_LIMIT = 8;
const QUAKE_DEBUG_POSE_EPSILON = 0.0001;

export interface QuakeDebugHooks {
  copyViewUrl(): Promise<string>;
  damage(amount?: number): boolean;
  debugMountEntity(entityIndex: number): boolean;
  fire(): boolean;
  floorAt(x: number, y: number, maxZ?: number, minZ?: number): number | null;
  focusEntity(entityIndex: number, distance?: number, rotX?: number, rotY?: number): boolean;
  loadMap(mapName: string): Promise<boolean>;
  getWeaponTuning(): QuakeResolvedViewmodelTuning;
  resetWeaponTuning(): QuakeResolvedViewmodelTuning;
  setWeaponTuning(tuning: QuakeViewmodelTuning): QuakeResolvedViewmodelTuning;
  viewmodel(): QuakeViewmodelDebugSnapshot;
  setPose(origin: Vec3, rotX?: number, rotY?: number, options?: QuakeDebugPoseOptions): boolean;
  setGroundViewpos(
    x: number,
    y: number,
    z: number,
    pitch?: number,
    yaw?: number,
    rollOrOptions?: number | QuakeDebugPoseOptions,
    options?: QuakeDebugPoseOptions,
  ): boolean;
  setViewpos(
    x: number,
    y: number,
    z: number,
    pitch?: number,
    yaw?: number,
    rollOrOptions?: number | QuakeDebugPoseOptions,
    options?: QuakeDebugPoseOptions,
  ): boolean;
  stats(): Record<string, unknown>;
  viewUrl(): string;
}

export interface QuakeDebugPoseOptions {
  collisionBypassMs?: number;
  gameplay?: boolean;
  stableViewmodel?: boolean;
}

interface QuakeDebugWindow extends Window {
  __cssQuakeDebug?: QuakeDebugHooks;
}

export function isQuakeDebugHooksEnabled(): boolean {
  return import.meta.env.DEV || new URLSearchParams(window.location.search).has("debug");
}

export interface QuakeDebugRuntime {
  cameraRotation(): { rotX: number; rotY: number };
  copyViewUrl(): Promise<string>;
  controls: {
    getOrigin(): [number, number, number];
    setOrigin(origin: [number, number, number]): void;
  };
  currentMapName(): string;
  damagePlayer(amount: number): boolean;
  debugMountEntity(entityIndex: number): boolean;
  entities(): ReadonlyMap<number, QuakeEntity>;
  fireWeapon(): void;
  fireballEmittersCount(): number;
  fireballsCount(): number;
  floorAt(x: number, y: number, maxZ?: number, minZ?: number): number | null;
  forwardDirection(rotX: number, rotY: number): Vec3;
  hasCurrentScene(): boolean;
  hideMainMenu(): void;
  inventory(): QuakePlayerInventory;
  isLoading(): boolean;
  loadMap(mapName: string): Promise<void>;
  mapExists(mapName: string): boolean;
  getWeaponTuning(): QuakeResolvedViewmodelTuning;
  resetWeaponTuning(): QuakeResolvedViewmodelTuning;
  setWeaponTuning(tuning: QuakeViewmodelTuning): QuakeResolvedViewmodelTuning;
  viewmodelDebug(): QuakeViewmodelDebugSnapshot;
  moversStats(): QuakeMoversDebugStats;
  playerEyeHeight(): number;
  playerMoveDebug(): Record<string, unknown>;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  setCollisionBypassUntil(until: number): void;
  shootablesStats(): QuakeShootablesDebugStats;
  syncCrosshairTarget(): void;
  syncGameplay(origin: [number, number, number]): void;
  syncPickupsVisibility(origin: [number, number, number]): void;
  syncSceneCameraAt(origin: [number, number, number], rotX: number, rotY: number): void;
  syncShootablesVisibility(origin: [number, number, number], force?: boolean): void;
  syncViewmodel(options?: { stable?: boolean }): void;
  syncWorldVisibility(force?: boolean): void;
  viewUrl(): string;
  worldStats(): QuakeWorldDebugStats;
}

export function installQuakeDebugHooks(enabled: boolean, runtime: QuakeDebugRuntime): void {
  if (!enabled) return;
  (window as QuakeDebugWindow).__cssQuakeDebug = {
    copyViewUrl: () => runtime.copyViewUrl(),
    damage: (amount) => damageQuakeDebugPlayer(runtime, amount),
    debugMountEntity: (entityIndex) => debugMountQuakeEntity(runtime, entityIndex),
    fire: () => fireQuakeDebugWeapon(runtime),
    floorAt: (x, y, maxZ, minZ) => runtime.floorAt(x, y, maxZ, minZ),
    focusEntity: (entityIndex, distance, rotX, rotY) =>
      focusQuakeDebugEntity(runtime, entityIndex, distance, rotX, rotY),
    getWeaponTuning: () => runtime.getWeaponTuning(),
    loadMap: (mapName) => loadQuakeDebugMap(runtime, mapName),
    resetWeaponTuning: () => runtime.resetWeaponTuning(),
    setWeaponTuning: (tuning) => runtime.setWeaponTuning(tuning),
    viewmodel: () => runtime.viewmodelDebug(),
    setGroundViewpos: (x, y, z, pitch, yaw, rollOrOptions, options) =>
      setQuakeDebugGroundViewpos(runtime, x, y, z, pitch, yaw, rollOrOptions, options),
    setPose: (origin, rotX, rotY, options) => setQuakeDebugPose(runtime, origin, rotX, rotY, options),
    setViewpos: (x, y, z, pitch, yaw, rollOrOptions, options) =>
      setQuakeDebugViewpos(runtime, x, y, z, pitch, yaw, rollOrOptions, options),
    stats: () => buildQuakeDebugStats(runtime),
    viewUrl: () => runtime.viewUrl(),
  };
}

function damageQuakeDebugPlayer(runtime: QuakeDebugRuntime, amount = 10): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  const previousHealth = runtime.inventory().health;
  const previousArmor = runtime.inventory().armor;
  runtime.hideMainMenu();
  return runtime.damagePlayer(amount) ||
    runtime.inventory().health < previousHealth ||
    runtime.inventory().armor < previousArmor;
}

function debugMountQuakeEntity(runtime: QuakeDebugRuntime, entityIndex: number): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.hideMainMenu();
  return runtime.debugMountEntity(entityIndex);
}

async function loadQuakeDebugMap(runtime: QuakeDebugRuntime, mapName: string): Promise<boolean> {
  const nextMapName = mapName.trim().toLowerCase();
  if (!runtime.mapExists(nextMapName)) return false;
  if (runtime.currentMapName() === nextMapName && !runtime.isLoading() && runtime.hasCurrentScene()) {
    runtime.hideMainMenu();
    return true;
  }
  if (runtime.isLoading()) return false;
  runtime.hideMainMenu();
  await runtime.loadMap(nextMapName);
  runtime.hideMainMenu();
  return true;
}

function fireQuakeDebugWeapon(runtime: QuakeDebugRuntime): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.hideMainMenu();
  runtime.fireWeapon();
  return true;
}

function focusQuakeDebugEntity(
  runtime: QuakeDebugRuntime,
  entityIndex: number,
  distance = 2.35,
  rotX = 90,
  rotY = 270,
): boolean {
  const entity = runtime.entities().get(entityIndex);
  if (!entity?.origin) return false;
  const entityOrigin = runtime.pointToPoly(entity.origin);
  const forward = runtime.forwardDirection(rotX, rotY);
  return setQuakeDebugPose(runtime, [
    entityOrigin[0] - forward[0] * distance,
    entityOrigin[1] - forward[1] * distance,
    entityOrigin[2] + runtime.playerEyeHeight() + 0.7,
  ], rotX, rotY);
}

function setQuakeDebugPose(
  runtime: QuakeDebugRuntime,
  origin: Vec3,
  rotX = 90,
  rotY = 270,
  options: QuakeDebugPoseOptions = {},
): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  const nextOrigin = [origin[0], origin[1], origin[2]] as [number, number, number];
  const currentOrigin = runtime.controls.getOrigin();
  const currentRotation = runtime.cameraRotation();
  const originChanged = !debugVec3Equals(currentOrigin, nextOrigin);
  const rotationChanged =
    !debugNumberEquals(currentRotation.rotX, rotX) ||
    !debugNumberEquals(currentRotation.rotY, rotY);
  const collisionBypassMs = options.collisionBypassMs ?? (options.gameplay ? 0 : 10000);
  runtime.setCollisionBypassUntil(collisionBypassMs > 0 ? performance.now() + collisionBypassMs : 0);
  runtime.hideMainMenu();
  if (!originChanged && !rotationChanged) {
    if (options.gameplay) runtime.syncGameplay(nextOrigin);
    else if (options.stableViewmodel) runtime.syncViewmodel({ stable: true });
    return true;
  }
  if (originChanged) runtime.controls.setOrigin(nextOrigin);
  runtime.syncSceneCameraAt(nextOrigin, rotX, rotY);
  if (options.gameplay) {
    runtime.syncGameplay(nextOrigin);
    return true;
  }
  runtime.syncShootablesVisibility(nextOrigin, originChanged);
  if (originChanged) {
    runtime.syncPickupsVisibility(nextOrigin);
    runtime.syncWorldVisibility(true);
  }
  runtime.syncViewmodel({ stable: options.stableViewmodel });
  runtime.syncCrosshairTarget();
  return true;
}

function setQuakeDebugViewpos(
  runtime: QuakeDebugRuntime,
  x: number,
  y: number,
  z: number,
  pitch?: number,
  yaw?: number,
  rollOrOptions?: number | QuakeDebugPoseOptions,
  options: QuakeDebugPoseOptions = {},
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (pitch !== undefined && !Number.isFinite(pitch)) return false;
  if (yaw !== undefined && !Number.isFinite(yaw)) return false;
  if (typeof rollOrOptions === "number" && !Number.isFinite(rollOrOptions)) return false;
  if (!quakeDebugSupportsRoll(rollOrOptions)) return false;

  const currentRotation = runtime.cameraRotation();
  const origin = runtime.pointToPoly({ x, y, z });
  const eyeOrigin = [
    origin[0],
    origin[1],
    origin[2] + QUAKE_PLAYER_MINS_Z + runtime.playerEyeHeight(),
  ] as Vec3;
  const rotX = pitch === undefined ? currentRotation.rotX : 90 - pitch;
  const rotY = yaw === undefined ? currentRotation.rotY : (180 + yaw + 360) % 360;
  const poseOptions = typeof rollOrOptions === "object" ? rollOrOptions : options;
  return setQuakeDebugPose(runtime, eyeOrigin, rotX, rotY, poseOptions);
}

function setQuakeDebugGroundViewpos(
  runtime: QuakeDebugRuntime,
  x: number,
  y: number,
  z: number,
  pitch?: number,
  yaw?: number,
  rollOrOptions?: number | QuakeDebugPoseOptions,
  options: QuakeDebugPoseOptions = {},
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (pitch !== undefined && !Number.isFinite(pitch)) return false;
  if (yaw !== undefined && !Number.isFinite(yaw)) return false;
  if (typeof rollOrOptions === "number" && !Number.isFinite(rollOrOptions)) return false;
  if (!quakeDebugSupportsRoll(rollOrOptions)) return false;

  const currentRotation = runtime.cameraRotation();
  const playerOrigin = runtime.pointToPoly({ x, y, z });
  const footZ = playerOrigin[2] + QUAKE_PLAYER_MINS_Z;
  const groundZ = runtime.floorAt(
    playerOrigin[0],
    playerOrigin[1],
    footZ + STEP_HEIGHT,
    footZ - STEP_HEIGHT,
  ) ?? runtime.floorAt(playerOrigin[0], playerOrigin[1], footZ + STEP_HEIGHT, -Infinity) ?? footZ;
  const eyeOrigin = [
    playerOrigin[0],
    playerOrigin[1],
    groundZ + runtime.playerEyeHeight(),
  ] as Vec3;
  const rotX = pitch === undefined ? currentRotation.rotX : 90 - pitch;
  const rotY = yaw === undefined ? currentRotation.rotY : (180 + yaw + 360) % 360;
  const poseOptions = typeof rollOrOptions === "object" ? rollOrOptions : options;
  return setQuakeDebugPose(runtime, eyeOrigin, rotX, rotY, poseOptions);
}

function quakeDebugSupportsRoll(rollOrOptions?: number | QuakeDebugPoseOptions): boolean {
  return typeof rollOrOptions !== "number" || Math.abs(rollOrOptions) <= QUAKE_DEBUG_POSE_EPSILON;
}

function debugVec3Equals(previous: Vec3, next: Vec3): boolean {
  return debugNumberEquals(previous[0], next[0]) &&
    debugNumberEquals(previous[1], next[1]) &&
    debugNumberEquals(previous[2], next[2]);
}

function debugNumberEquals(previous: number, next: number): boolean {
  return Math.abs(previous - next) <= QUAKE_DEBUG_POSE_EPSILON;
}

function buildQuakeDebugStats(runtime: QuakeDebugRuntime): Record<string, unknown> {
  const worldStats = runtime.worldStats();
  const shootableStats = runtime.shootablesStats();
  const inventory = runtime.inventory();
  const playerMove = runtime.playerMoveDebug();
  const cameraRotation = runtime.cameraRotation();
  const cameraForward = runtime.forwardDirection(cameraRotation.rotX, cameraRotation.rotY);
  const enemyMeshes = Array.from(document.querySelectorAll<HTMLElement>(".polycss-mesh.shootable.enemy"));
  const activeEnemyMeshes = enemyMeshes.filter(
    (element) => !element.classList.contains("quake-shootable-prewarmed") &&
      !element.classList.contains("quake-frame-hidden"),
  );
  const pickupMeshes = Array.from(document.querySelectorAll<HTMLElement>(".polycss-mesh.pickup"));
  const activePickupMeshes = pickupMeshes.filter((element) => !element.hidden);
  const hiddenEnemyFrameMeshes = enemyMeshes.filter((element) => element.classList.contains("quake-frame-hidden"));
  const prewarmedEnemyMeshes = enemyMeshes.filter((element) => element.classList.contains("quake-shootable-prewarmed"));
  const mountedEnemyLeaves = enemyMeshes.reduce(
    (total, element) => total + element.querySelectorAll("b,i,s,u").length,
    0,
  );
  return {
    loading: runtime.isLoading(),
    mapName: runtime.currentMapName(),
    origin: runtime.controls.getOrigin(),
    cameraRotX: cameraRotation.rotX,
    cameraRotY: cameraRotation.rotY,
    cameraForward,
    currentLeafIndex: worldStats.currentLeafIndex,
    visibleLeafCount: worldStats.visibleLeafCount,
    pvsFaceCount: worldStats.pvsFaceCount,
    fireballEmitters: runtime.fireballEmittersCount(),
    fireballs: runtime.fireballsCount(),
    playerHealth: inventory.health,
    playerArmor: inventory.armor,
    playerGroundEntity: playerMove.currentGroundEntity ?? null,
    playerMove,
    playerShells: inventory.shells,
    playerNails: inventory.nails,
    playerRockets: inventory.rockets,
    playerCells: inventory.cells,
    enemyMeshes: enemyMeshes.length,
    activeEnemyMeshes: activeEnemyMeshes.length,
    hiddenEnemyFrameMeshes: hiddenEnemyFrameMeshes.length,
    prewarmedEnemyMeshes: prewarmedEnemyMeshes.length,
    pickupMeshes: pickupMeshes.length,
    activePickupMeshes: activePickupMeshes.length,
    mountedEnemyLeaves,
    mountedEnemyAtlasLeaves: enemyMeshes.reduce(
      (total, element) => total + element.querySelectorAll("s").length,
      0,
    ),
    projectionBudget: {
      leafArea: QUAKE_DEBUG_PROJECTION_LEAF_BUDGET_PX,
      meshViewportRatio: QUAKE_DEBUG_PROJECTION_MESH_VIEWPORT_BUDGET,
      totalViewportRatio: QUAKE_DEBUG_PROJECTION_TOTAL_VIEWPORT_BUDGET,
    },
    enemyProjection: buildQuakeProjectionStats(activeEnemyMeshes, "enemy"),
    pickupProjection: buildQuakeProjectionStats(activePickupMeshes, "pickup"),
    movers: runtime.moversStats(),
    worldLeaves: worldStats.mountedLeaves,
    worldAtlasLeaves: worldStats.mountedAtlasLeaves,
    viewmodel: runtime.viewmodelDebug(),
    world: worldStats,
    shootables: shootableStats,
  };
}

type QuakeProjectionMeshKind = "enemy" | "pickup";

interface QuakeProjectionMeshStats {
  kind: QuakeProjectionMeshKind;
  entityIndex: number | null;
  classname: string | null;
  leafCount: number;
  atlasLeafCount: number;
  tagCounts: Record<"b" | "i" | "s" | "u", number>;
  clippedArea: number;
  maxLeafArea: number;
  p95LeafArea: number;
  leavesOverBudget: number;
  overBudget: boolean;
  prewarmed: boolean;
  frameHidden: boolean;
  animationFrame: number | null;
  animationMode: string | null;
  paintBackend: string | null;
  attack: string | null;
}

function buildQuakeProjectionStats(meshes: HTMLElement[], kind: QuakeProjectionMeshKind): Record<string, unknown> {
  const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
  const viewportHeight = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
  const viewportArea = viewportWidth * viewportHeight;
  const meshAreaBudget = viewportArea * QUAKE_DEBUG_PROJECTION_MESH_VIEWPORT_BUDGET;
  const totalAreaBudget = viewportArea * QUAKE_DEBUG_PROJECTION_TOTAL_VIEWPORT_BUDGET;
  const leafAreaBudget = quakeDebugProjectionLeafAreaBudget(kind, viewportArea);
  const meshStats = meshes.map((element) => buildQuakeProjectionMeshStats(
    element,
    kind,
    viewportWidth,
    viewportHeight,
    meshAreaBudget,
    leafAreaBudget,
  ));
  const rankedMeshes = [...meshStats].sort((a, b) => b.clippedArea - a.clippedArea);
  const clippedArea = meshStats.reduce((total, mesh) => total + mesh.clippedArea, 0);
  return {
    viewportWidth,
    viewportHeight,
    meshAreaBudget: Math.round(meshAreaBudget),
    totalAreaBudget: Math.round(totalAreaBudget),
    leafAreaBudget,
    meshCount: meshStats.length,
    leafCount: meshStats.reduce((total, mesh) => total + mesh.leafCount, 0),
    atlasLeafCount: meshStats.reduce((total, mesh) => total + mesh.atlasLeafCount, 0),
    clippedArea: Math.round(clippedArea),
    maxMeshClippedArea: Math.round(rankedMeshes[0]?.clippedArea ?? 0),
    maxLeafArea: Math.round(Math.max(0, ...meshStats.map((mesh) => mesh.maxLeafArea))),
    overBudgetTotal: clippedArea > totalAreaBudget,
    overBudgetMeshes: meshStats.filter((mesh) => mesh.overBudget).length,
    meshes: rankedMeshes.slice(0, QUAKE_DEBUG_PROJECTION_MESH_LIMIT),
  };
}

function buildQuakeProjectionMeshStats(
  element: HTMLElement,
  kind: QuakeProjectionMeshKind,
  viewportWidth: number,
  viewportHeight: number,
  meshAreaBudget: number,
  leafAreaBudget: number,
): QuakeProjectionMeshStats {
  const leaves = Array.from(element.querySelectorAll<HTMLElement>("b,i,s,u"));
  const tagCounts: Record<"b" | "i" | "s" | "u", number> = { b: 0, i: 0, s: 0, u: 0 };
  const visibleLeafAreas: number[] = [];
  let clippedArea = 0;
  let maxLeafArea = 0;
  let leavesOverBudget = 0;

  for (const leaf of leaves) {
    const tag = leaf.tagName.toLowerCase();
    if (tag === "b" || tag === "i" || tag === "s" || tag === "u") tagCounts[tag] += 1;
    const area = clippedRectArea(leaf.getBoundingClientRect(), viewportWidth, viewportHeight);
    if (area <= 0) continue;
    visibleLeafAreas.push(area);
    clippedArea += area;
    maxLeafArea = Math.max(maxLeafArea, area);
    if (area > leafAreaBudget) leavesOverBudget++;
  }

  visibleLeafAreas.sort((a, b) => a - b);
  return {
    kind,
    entityIndex: numericDatasetValue(element.dataset.entityIndex),
    classname: element.dataset.classname ?? null,
    leafCount: leaves.length,
    atlasLeafCount: tagCounts.s,
    tagCounts,
    clippedArea: Math.round(clippedArea),
    maxLeafArea: Math.round(maxLeafArea),
    p95LeafArea: Math.round(percentileSorted(visibleLeafAreas, 0.95)),
    leavesOverBudget,
    overBudget: clippedArea > meshAreaBudget || leavesOverBudget > 0,
    prewarmed: element.classList.contains("quake-shootable-prewarmed"),
    frameHidden: element.classList.contains("quake-frame-hidden"),
    animationFrame: numericDatasetValue(element.dataset.animationFrame),
    animationMode: element.dataset.animationMode ?? null,
    paintBackend: element.dataset.paintBackend ?? null,
    attack: element.dataset.attack ?? null,
  };
}

function quakeDebugProjectionLeafAreaBudget(kind: QuakeProjectionMeshKind, viewportArea: number): number {
  if (kind === "pickup") {
    return Math.round(viewportArea * QUAKE_DEBUG_PICKUP_PROJECTION_LEAF_VIEWPORT_BUDGET);
  }
  return QUAKE_DEBUG_PROJECTION_LEAF_BUDGET_PX;
}

function clippedRectArea(rect: DOMRect, viewportWidth: number, viewportHeight: number): number {
  const left = Math.max(0, Math.min(viewportWidth, rect.left));
  const right = Math.max(0, Math.min(viewportWidth, rect.right));
  const top = Math.max(0, Math.min(viewportHeight, rect.top));
  const bottom = Math.max(0, Math.min(viewportHeight, rect.bottom));
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function percentileSorted(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * ratio)));
  return values[index] ?? 0;
}

function numericDatasetValue(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
