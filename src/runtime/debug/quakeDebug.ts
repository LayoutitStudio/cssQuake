import { quakeMapLoadFailureIsCurrent, type QuakeMapLoadResult } from "../app/mapLoadOwnership";
import type { Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../../types/quake";
import { QUAKE_PLAYER_MINS_Z, STEP_HEIGHT } from "../constants";
import type { QuakeDebugRecorder, QuakeDebugRecording } from "./recording";
import type { QuakePlayerInventory, QuakeWeaponId } from "../hud";
import type { QuakePlayerDamageContext } from "../player";
import type { QuakeMoversDebugStats } from "../movers";
import type { QuakePickupDebugStats } from "../pickups";
import type { QuakeCanDamageResult } from "../shootables/damage";
import type { CssQuakeDamageableBrushProgressSnapshot } from "../saveLoad";
import type {
  QuakeEnemyProjectileDebugCapture,
  QuakeShootableEnemyAcquisitionDebugResult,
  QuakeShootablesDebugStats,
} from "../shootables";
import type { QuakeResolvedViewmodelTuning, QuakeViewmodelDebugSnapshot, QuakeViewmodelTuning } from "../viewmodel";
import type {
  QuakeWeaponProjectileDebugCapture,
  QuakeWeaponProjectileDebugFireOptions,
  QuakeWeaponProjectileImpactDebugResult,
} from "../weapons";
import type { QuakeWorldDebugStats } from "../world";

const QUAKE_DEBUG_PROJECTION_LEAF_BUDGET_PX = 5000;
const QUAKE_DEBUG_PICKUP_PROJECTION_LEAF_VIEWPORT_BUDGET = 0.1;
const QUAKE_DEBUG_PROJECTION_MESH_VIEWPORT_BUDGET = 0.55;
const QUAKE_DEBUG_PROJECTION_TOTAL_VIEWPORT_BUDGET = 0.45;
const QUAKE_DEBUG_PROJECTION_MESH_LIMIT = 8;
const QUAKE_DEBUG_POSE_EPSILON = 0.0001;

export interface QuakeDebugHooks {
  activateEntity(entityIndex: number, sourceEntityIndex?: number): boolean;
  canDamage(
    inflictorX: number,
    inflictorY: number,
    inflictorZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
  ): QuakeCanDamageResult | null;
  contentsAt(x: number, y: number, z: number): number | null;
  copyViewUrl(): Promise<string>;
  damageableBrushesStats(): CssQuakeDamageableBrushProgressSnapshot;
  damage(amount?: number, inflictorX?: number, inflictorY?: number, inflictorZ?: number): boolean;
  damageWeaponTarget(entityIndex: number, amount?: number): boolean;
  debugMountEntity(entityIndex: number): boolean;
  setEnemyTickFilter(entityIndexes?: number[] | null): boolean;
  enemyAcquisition(
    entityIndex: number,
    playerX: number,
    playerY: number,
    playerZ: number,
    monsterYaw?: number,
  ): QuakeShootableEnemyAcquisitionDebugResult | null;
  enemyForceAttack(
    entityIndex: number,
    targetX?: number,
    targetY?: number,
    targetZ?: number,
  ): boolean;
  enemyForceAttackChain(
    entityIndex: number,
    chain: string,
    targetX?: number,
    targetY?: number,
    targetZ?: number,
  ): boolean;
  enemyProjectileTraceCapture(): QuakeEnemyProjectileDebugCapture | null;
  enemyProjectileTraceClear(): boolean;
  enemyProjectileTraceEnabled(enabled: boolean): boolean;
  enemyProjectileTraceStep(dtMs?: number): QuakeEnemyProjectileDebugCapture | null;
  entityIndexes(classname?: string): number[];
  fire(): boolean;
  fireProjectileTrace(
    directDamage?: number,
    timeoutMs?: number,
  ): Promise<QuakeWeaponProjectileDebugFireResult | null>;
  lastGameplayRecording(): QuakeDebugRecording | null;
  floorAt(x: number, y: number, maxZ?: number, minZ?: number): number | null;
  focusEntity(entityIndex: number, distance?: number, rotX?: number, rotY?: number): boolean;
  loadMap(mapName: string): Promise<boolean>;
  getWeaponTuning(): QuakeResolvedViewmodelTuning;
  requestMultiplayerPickup(entityIndex: number): boolean;
  resetWeaponTuning(): QuakeResolvedViewmodelTuning;
  setExpandedLogicalCombat(enabled: boolean): boolean;
  setMountedEnemyAcquisition(enabled: boolean): boolean;
  setMultiplayerInputPaused(paused: boolean): boolean;
  setPowerup(finishedField: string, durationMs: number): boolean;
  startGameplayRecording(): boolean;
  stopGameplayRecording(): QuakeDebugRecording | null;
  projectileImpact(
    weapon: QuakeWeaponId,
    entityIndex: number,
    x: number,
    y: number,
    z: number,
    directDamage?: number,
  ): QuakeWeaponProjectileImpactDebugResult | null;
  setUnmountedAi(enabled: boolean): boolean;
  setEntityOrigin(entityIndex: number, x: number, y: number, z: number): boolean;
  setEntityYaw(entityIndex: number, yaw: number): boolean;
  setWeapon(weapon: QuakeWeaponId): boolean;
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
  syncCollision(): boolean;
  syncMultiplayerPose(): boolean;
  touchEntity(entityIndex: number): boolean;
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
  canDamage(
    inflictorOrigin: { x: number; y: number; z: number },
    targetOrigin: { x: number; y: number; z: number },
  ): QuakeCanDamageResult;
  copyViewUrl(): Promise<string>;
  controls: {
    getOrigin(): [number, number, number];
    setOrigin(origin: [number, number, number]): void;
  };
  currentMapName(): string;
  contentsAt(point: { x: number; y: number; z: number }): number | null;
  activateEntity(entityIndex: number, sourceEntityIndex?: number): boolean;
  damageableBrushesStats(): CssQuakeDamageableBrushProgressSnapshot;
  damagePlayer(amount: number, context?: QuakePlayerDamageContext): boolean;
  damageWeaponTarget(entityIndex: number, amount: number): boolean;
  debugMountEntity(entityIndex: number): boolean;
  setEnemyTickFilter(entityIndexes: readonly number[] | null): void;
  debugRecorder(): QuakeDebugRecorder | null;
  enemyAcquisition(
    entityIndex: number,
    playerSourceOrigin: { x: number; y: number; z: number },
    monsterYaw?: number,
  ): QuakeShootableEnemyAcquisitionDebugResult | null;
  enemyForceAttack(entityIndex: number, targetOrigin?: Vec3): boolean;
  enemyForceAttackChain(entityIndex: number, chain: string, targetOrigin?: Vec3): boolean;
  enemyProjectileTraceCapture(): QuakeEnemyProjectileDebugCapture;
  enemyProjectileTraceClear(): void;
  enemyProjectileTraceEnabled(enabled: boolean): void;
  enemyProjectileTraceStep(dtMs?: number): QuakeEnemyProjectileDebugCapture;
  entities(): ReadonlyMap<number, QuakeEntity>;
  fireWeapon(): boolean;
  fireWeaponDebug(options?: QuakeWeaponProjectileDebugFireOptions): boolean;
  fireballEmittersCount(): number;
  fireballsCount(): number;
  floorAt(x: number, y: number, maxZ?: number, minZ?: number): number | null;
  forwardDirection(rotX: number, rotY: number): Vec3;
  hasCurrentScene(): boolean;
  hideMainMenu(): void;
  inventory(): QuakePlayerInventory;
  isLoading(): boolean;
  loadMap(mapName: string): Promise<QuakeMapLoadResult>;
  mapExists(mapName: string): boolean;
  getWeaponTuning(): QuakeResolvedViewmodelTuning;
  resetWeaponTuning(): QuakeResolvedViewmodelTuning;
  setExpandedLogicalCombat(enabled: boolean): void;
  setMountedEnemyAcquisition(enabled: boolean): void;
  setMultiplayerInputPaused(paused: boolean): boolean;
  setPowerup(finishedField: string, durationMs: number): boolean;
  setUnmountedAi(enabled: boolean): void;
  setWeapon(weapon: QuakeWeaponId): boolean;
  setWeaponTuning(tuning: QuakeViewmodelTuning): QuakeResolvedViewmodelTuning;
  viewmodelDebug(): QuakeViewmodelDebugSnapshot;
  moversStats(): QuakeMoversDebugStats;
  multiplayerStats(): Record<string, unknown> | null;
  pickupsStats(): QuakePickupDebugStats;
  playerEyeHeight(): number;
  playerMoveDebug(): Record<string, unknown>;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  renderOrigin(): Vec3;
  requestMultiplayerPickup(entityIndex: number): boolean;
  projectileImpact(
    weapon: QuakeWeaponId,
    entityIndex: number,
    origin: Vec3,
    directDamage?: number,
  ): QuakeWeaponProjectileImpactDebugResult | null;
  projectileTraceCapture(): QuakeWeaponProjectileDebugCapture;
  projectileTraceClear(): void;
  projectileTraceEnabled(enabled: boolean): void;
  runWithDebugInput<T>(callback: () => T): T;
  setCollisionBypassUntil(until: number): void;
  setShootableOrigin(entityIndex: number, origin: Vec3): boolean;
  setShootableYaw(entityIndex: number, yaw: number): boolean;
  shootablesStats(): QuakeShootablesDebugStats;
  triggersStats(): Record<string, unknown>;
  syncCrosshairTarget(): void;
  syncGameplay(origin: [number, number, number]): void;
  syncPlayerCollision(): void;
  syncMultiplayerPose(): boolean;
  syncPickupsVisibility(origin: [number, number, number]): void;
  syncSceneCameraAt(origin: [number, number, number], rotX: number, rotY: number): void;
  syncShootablesVisibility(origin: [number, number, number], force?: boolean): void;
  syncViewmodel(options?: { stable?: boolean }): void;
  syncWorldVisibility(force?: boolean): void;
  touchEntity(entityIndex: number): boolean;
  viewUrl(): string;
  worldStats(): QuakeWorldDebugStats;
}

export interface QuakeWeaponProjectileDebugFireResult {
  capture: QuakeWeaponProjectileDebugCapture;
  fired: boolean;
}

export function installQuakeDebugHooks(enabled: boolean, runtime: QuakeDebugRuntime): void {
  if (!enabled) return;
  (window as QuakeDebugWindow).__cssQuakeDebug = {
    activateEntity: (entityIndex, sourceEntityIndex) =>
      activateQuakeDebugEntity(runtime, entityIndex, sourceEntityIndex),
    canDamage: (inflictorX, inflictorY, inflictorZ, targetX, targetY, targetZ) =>
      canDamageQuakeDebugTrace(runtime, inflictorX, inflictorY, inflictorZ, targetX, targetY, targetZ),
    contentsAt: (x, y, z) => contentsAtQuakeDebugPoint(runtime, x, y, z),
    copyViewUrl: () => runtime.copyViewUrl(),
    damageableBrushesStats: () => runtime.damageableBrushesStats(),
    damage: (amount, inflictorX, inflictorY, inflictorZ) =>
      damageQuakeDebugPlayer(runtime, amount, inflictorX, inflictorY, inflictorZ),
    damageWeaponTarget: (entityIndex, amount) =>
      damageQuakeDebugWeaponTarget(runtime, entityIndex, amount),
    debugMountEntity: (entityIndex) => debugMountQuakeEntity(runtime, entityIndex),
    setEnemyTickFilter: (entityIndexes) => setQuakeDebugEnemyTickFilter(runtime, entityIndexes),
    enemyAcquisition: (entityIndex, playerX, playerY, playerZ, monsterYaw) =>
      enemyAcquisitionQuakeDebugProbe(runtime, entityIndex, playerX, playerY, playerZ, monsterYaw),
    enemyForceAttack: (entityIndex, targetX, targetY, targetZ) =>
      enemyForceAttackQuakeDebug(runtime, entityIndex, targetX, targetY, targetZ),
    enemyForceAttackChain: (entityIndex, chain, targetX, targetY, targetZ) =>
      enemyForceAttackChainQuakeDebug(runtime, entityIndex, chain, targetX, targetY, targetZ),
    enemyProjectileTraceCapture: () => enemyProjectileTraceQuakeDebugCapture(runtime),
    enemyProjectileTraceClear: () => enemyProjectileTraceQuakeDebugClear(runtime),
    enemyProjectileTraceEnabled: (enabled) => enemyProjectileTraceQuakeDebugEnabled(runtime, enabled),
    enemyProjectileTraceStep: (dtMs) => enemyProjectileTraceQuakeDebugStep(runtime, dtMs),
    entityIndexes: (classname) => quakeDebugEntityIndexes(runtime, classname),
    fire: () => fireQuakeDebugWeapon(runtime),
    fireProjectileTrace: (directDamage, timeoutMs) =>
      fireProjectileTraceQuakeDebugWeapon(runtime, directDamage, timeoutMs),
    lastGameplayRecording: () => runtime.debugRecorder()?.lastRecording() ?? null,
    floorAt: (x, y, maxZ, minZ) => runtime.floorAt(x, y, maxZ, minZ),
    focusEntity: (entityIndex, distance, rotX, rotY) =>
      focusQuakeDebugEntity(runtime, entityIndex, distance, rotX, rotY),
    getWeaponTuning: () => runtime.getWeaponTuning(),
    loadMap: (mapName) => loadQuakeDebugMap(runtime, mapName),
    projectileImpact: (weapon, entityIndex, x, y, z, directDamage) =>
      projectileImpactQuakeDebugWeapon(runtime, weapon, entityIndex, x, y, z, directDamage),
    requestMultiplayerPickup: (entityIndex) => requestQuakeDebugMultiplayerPickup(runtime, entityIndex),
    resetWeaponTuning: () => runtime.resetWeaponTuning(),
    setExpandedLogicalCombat: (enabled) => setQuakeDebugExpandedLogicalCombat(runtime, enabled),
    setMountedEnemyAcquisition: (enabled) => setQuakeDebugMountedEnemyAcquisition(runtime, enabled),
    setMultiplayerInputPaused: (paused) => setQuakeDebugMultiplayerInputPaused(runtime, paused),
    setPowerup: (finishedField, durationMs) => setQuakeDebugPowerup(runtime, finishedField, durationMs),
    startGameplayRecording: () => startQuakeDebugGameplayRecording(runtime),
    stopGameplayRecording: () => stopQuakeDebugGameplayRecording(runtime),
    setEntityOrigin: (entityIndex, x, y, z) =>
      setQuakeDebugEntityOrigin(runtime, entityIndex, x, y, z),
    setEntityYaw: (entityIndex, yaw) => setQuakeDebugEntityYaw(runtime, entityIndex, yaw),
    setUnmountedAi: (enabled) => setQuakeDebugUnmountedAi(runtime, enabled),
    setWeapon: (weapon) => setQuakeDebugWeapon(runtime, weapon),
    setWeaponTuning: (tuning) => runtime.setWeaponTuning(tuning),
    viewmodel: () => runtime.viewmodelDebug(),
    setGroundViewpos: (x, y, z, pitch, yaw, rollOrOptions, options) =>
      setQuakeDebugGroundViewpos(runtime, x, y, z, pitch, yaw, rollOrOptions, options),
    setPose: (origin, rotX, rotY, options) => setQuakeDebugPose(runtime, origin, rotX, rotY, options),
    setViewpos: (x, y, z, pitch, yaw, rollOrOptions, options) =>
      setQuakeDebugViewpos(runtime, x, y, z, pitch, yaw, rollOrOptions, options),
    stats: () => buildQuakeDebugStats(runtime),
    syncCollision: () => syncQuakeDebugCollision(runtime),
    syncMultiplayerPose: () => syncQuakeDebugMultiplayerPose(runtime),
    touchEntity: (entityIndex) => touchQuakeDebugEntity(runtime, entityIndex),
    viewUrl: () => runtime.viewUrl(),
  };
}

function activateQuakeDebugEntity(
  runtime: QuakeDebugRuntime,
  entityIndex: number,
  sourceEntityIndex?: number,
): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.hideMainMenu();
  return runtime.activateEntity(entityIndex, sourceEntityIndex);
}

function touchQuakeDebugEntity(runtime: QuakeDebugRuntime, entityIndex: number): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  if (!Number.isInteger(entityIndex)) return false;
  runtime.hideMainMenu();
  return runtime.touchEntity(entityIndex);
}

function requestQuakeDebugMultiplayerPickup(runtime: QuakeDebugRuntime, entityIndex: number): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  if (!Number.isInteger(entityIndex)) return false;
  runtime.hideMainMenu();
  return runtime.requestMultiplayerPickup(entityIndex);
}

function syncQuakeDebugMultiplayerPose(runtime: QuakeDebugRuntime): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.hideMainMenu();
  return runtime.syncMultiplayerPose();
}

function syncQuakeDebugCollision(runtime: QuakeDebugRuntime): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.setCollisionBypassUntil(0);
  runtime.hideMainMenu();
  runtime.syncPlayerCollision();
  return true;
}

function setQuakeDebugMultiplayerInputPaused(runtime: QuakeDebugRuntime, paused: boolean): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.hideMainMenu();
  return runtime.setMultiplayerInputPaused(paused);
}

function canDamageQuakeDebugTrace(
  runtime: QuakeDebugRuntime,
  inflictorX: number,
  inflictorY: number,
  inflictorZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
): QuakeCanDamageResult | null {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return null;
  if (!Number.isFinite(inflictorX) || !Number.isFinite(inflictorY) || !Number.isFinite(inflictorZ)) return null;
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || !Number.isFinite(targetZ)) return null;
  runtime.hideMainMenu();
  return runtime.canDamage(
    { x: inflictorX, y: inflictorY, z: inflictorZ },
    { x: targetX, y: targetY, z: targetZ },
  );
}

function contentsAtQuakeDebugPoint(
  runtime: QuakeDebugRuntime,
  x: number,
  y: number,
  z: number,
): number | null {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return runtime.contentsAt({ x, y, z });
}

function damageQuakeDebugPlayer(
  runtime: QuakeDebugRuntime,
  amount = 10,
  inflictorX?: number,
  inflictorY?: number,
  inflictorZ?: number,
): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  const previousHealth = runtime.inventory().health;
  const previousArmor = runtime.inventory().armor;
  const context = Number.isFinite(inflictorX) &&
    Number.isFinite(inflictorY) &&
    Number.isFinite(inflictorZ)
    ? { inflictorOrigin: runtime.pointToPoly({ x: inflictorX ?? 0, y: inflictorY ?? 0, z: inflictorZ ?? 0 }) }
    : undefined;
  runtime.hideMainMenu();
  return runtime.damagePlayer(amount, context) ||
    runtime.inventory().health < previousHealth ||
    runtime.inventory().armor < previousArmor;
}

function damageQuakeDebugWeaponTarget(
  runtime: QuakeDebugRuntime,
  entityIndex: number,
  amount = 100,
): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  if (!Number.isFinite(entityIndex) || !Number.isFinite(amount)) return false;
  runtime.hideMainMenu();
  return runtime.damageWeaponTarget(Math.round(entityIndex), amount);
}

function debugMountQuakeEntity(runtime: QuakeDebugRuntime, entityIndex: number): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.hideMainMenu();
  return runtime.debugMountEntity(entityIndex);
}

function setQuakeDebugEnemyTickFilter(
  runtime: QuakeDebugRuntime,
  entityIndexes?: number[] | null,
): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  if (entityIndexes == null) {
    runtime.setEnemyTickFilter(null);
    return true;
  }
  if (!Array.isArray(entityIndexes)) return false;
  const filtered = entityIndexes
    .map((entityIndex) => Math.round(Number(entityIndex)))
    .filter((entityIndex) => Number.isInteger(entityIndex) && entityIndex > 0);
  runtime.setEnemyTickFilter(filtered);
  return true;
}

function enemyAcquisitionQuakeDebugProbe(
  runtime: QuakeDebugRuntime,
  entityIndex: number,
  playerX: number,
  playerY: number,
  playerZ: number,
  monsterYaw?: number,
): QuakeShootableEnemyAcquisitionDebugResult | null {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return null;
  if (!Number.isFinite(entityIndex) || !Number.isFinite(playerX) || !Number.isFinite(playerY) || !Number.isFinite(playerZ)) {
    return null;
  }
  if (monsterYaw !== undefined && !Number.isFinite(monsterYaw)) return null;
  runtime.hideMainMenu();
  return runtime.enemyAcquisition(
    Math.round(entityIndex),
    { x: playerX, y: playerY, z: playerZ },
    monsterYaw,
  );
}

function enemyForceAttackQuakeDebug(
  runtime: QuakeDebugRuntime,
  entityIndex: number,
  targetX?: number,
  targetY?: number,
  targetZ?: number,
): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  if (!Number.isFinite(entityIndex)) return false;
  const hasTarget = targetX !== undefined || targetY !== undefined || targetZ !== undefined;
  if (!hasTarget) return runtime.enemyForceAttack(Math.round(entityIndex));
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || !Number.isFinite(targetZ)) return false;
  return runtime.enemyForceAttack(Math.round(entityIndex), [targetX, targetY, targetZ]);
}

function enemyForceAttackChainQuakeDebug(
  runtime: QuakeDebugRuntime,
  entityIndex: number,
  chain: string,
  targetX?: number,
  targetY?: number,
  targetZ?: number,
): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  if (!Number.isFinite(entityIndex) || typeof chain !== "string" || !chain) return false;
  const hasTarget = targetX !== undefined || targetY !== undefined || targetZ !== undefined;
  if (!hasTarget) return runtime.enemyForceAttackChain(Math.round(entityIndex), chain);
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || !Number.isFinite(targetZ)) return false;
  return runtime.enemyForceAttackChain(Math.round(entityIndex), chain, [targetX, targetY, targetZ]);
}

function enemyProjectileTraceQuakeDebugCapture(
  runtime: QuakeDebugRuntime,
): QuakeEnemyProjectileDebugCapture | null {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return null;
  return runtime.enemyProjectileTraceCapture();
}

function enemyProjectileTraceQuakeDebugClear(runtime: QuakeDebugRuntime): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.enemyProjectileTraceClear();
  return true;
}

function enemyProjectileTraceQuakeDebugEnabled(runtime: QuakeDebugRuntime, enabled: boolean): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.enemyProjectileTraceEnabled(Boolean(enabled));
  return true;
}

function enemyProjectileTraceQuakeDebugStep(
  runtime: QuakeDebugRuntime,
  dtMs = 16,
): QuakeEnemyProjectileDebugCapture | null {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return null;
  if (!Number.isFinite(dtMs)) return null;
  return runtime.enemyProjectileTraceStep(Math.max(1, Math.min(250, dtMs)));
}

function quakeDebugEntityIndexes(runtime: QuakeDebugRuntime, classname?: string): number[] {
  const selectedClassname = classname?.trim() ?? "";
  return [...runtime.entities().values()]
    .filter((entity) => !selectedClassname || entity.classname === selectedClassname)
    .map((entity) => entity.index)
    .filter((entityIndex) => Number.isFinite(entityIndex))
    .sort((a, b) => a - b);
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
  let loaded: QuakeMapLoadResult;
  try {
    loaded = await runtime.loadMap(nextMapName);
  } catch (error) {
    if (!quakeMapLoadFailureIsCurrent(error)) return false;
    throw error;
  }
  if (!loaded || !loaded.isCurrent()) return false;
  runtime.hideMainMenu();
  return true;
}

function fireQuakeDebugWeapon(runtime: QuakeDebugRuntime): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.hideMainMenu();
  return runtime.runWithDebugInput(() => runtime.fireWeapon());
}

function startQuakeDebugGameplayRecording(runtime: QuakeDebugRuntime): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.hideMainMenu();
  return runtime.debugRecorder()?.start({ downloadOnStop: false }) ?? false;
}

function stopQuakeDebugGameplayRecording(runtime: QuakeDebugRuntime): QuakeDebugRecording | null {
  return runtime.debugRecorder()?.stop("stop", { download: false }) ?? null;
}

async function fireProjectileTraceQuakeDebugWeapon(
  runtime: QuakeDebugRuntime,
  directDamage?: number,
  timeoutMs = 1500,
): Promise<QuakeWeaponProjectileDebugFireResult | null> {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return null;
  if (directDamage !== undefined && !Number.isFinite(directDamage)) return null;
  if (!Number.isFinite(timeoutMs)) return null;
  runtime.hideMainMenu();
  return await runtime.runWithDebugInput(async () => {
    runtime.projectileTraceClear();
    runtime.projectileTraceEnabled(true);
    const fired = runtime.fireWeaponDebug({ directDamage });
    if (!fired) {
      const capture = runtime.projectileTraceCapture();
      runtime.projectileTraceEnabled(false);
      return { capture, fired };
    }

    const deadline = performance.now() + Math.max(1, Math.min(10_000, timeoutMs));
    while (performance.now() < deadline) {
      const capture = runtime.projectileTraceCapture();
      const removed = capture.events.some((event) => event.type === "remove");
      const impacted = capture.events.some((event) => event.type === "impact" && event.impactResult === "remove");
      if ((removed && impacted) || (impacted && capture.activeCount === 0)) {
        runtime.projectileTraceEnabled(false);
        return { capture, fired };
      }
      await nextAnimationFrame();
    }

    const capture = runtime.projectileTraceCapture();
    runtime.projectileTraceEnabled(false);
    return { capture, fired };
  });
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function projectileImpactQuakeDebugWeapon(
  runtime: QuakeDebugRuntime,
  weapon: QuakeWeaponId,
  entityIndex: number,
  x: number,
  y: number,
  z: number,
  directDamage?: number,
): QuakeWeaponProjectileImpactDebugResult | null {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return null;
  if (!Number.isFinite(entityIndex) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (directDamage !== undefined && !Number.isFinite(directDamage)) return null;
  runtime.hideMainMenu();
  return runtime.projectileImpact(
    weapon,
    Math.round(entityIndex),
    runtime.pointToPoly({ x, y, z }),
    directDamage,
  );
}

function setQuakeDebugEntityOrigin(
  runtime: QuakeDebugRuntime,
  entityIndex: number,
  x: number,
  y: number,
  z: number,
): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  runtime.hideMainMenu();
  return runtime.setShootableOrigin(entityIndex, runtime.pointToPoly({ x, y, z }));
}

function setQuakeDebugEntityYaw(runtime: QuakeDebugRuntime, entityIndex: number, yaw: number): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  if (!Number.isFinite(entityIndex) || !Number.isFinite(yaw)) return false;
  runtime.hideMainMenu();
  return runtime.setShootableYaw(Math.round(entityIndex), yaw);
}

function setQuakeDebugExpandedLogicalCombat(runtime: QuakeDebugRuntime, enabled: boolean): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.setExpandedLogicalCombat(Boolean(enabled));
  return true;
}

function setQuakeDebugMountedEnemyAcquisition(runtime: QuakeDebugRuntime, enabled: boolean): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.setMountedEnemyAcquisition(Boolean(enabled));
  return true;
}

function setQuakeDebugUnmountedAi(runtime: QuakeDebugRuntime, enabled: boolean): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.setUnmountedAi(Boolean(enabled));
  return true;
}

function setQuakeDebugWeapon(runtime: QuakeDebugRuntime, weapon: QuakeWeaponId): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  runtime.hideMainMenu();
  return runtime.setWeapon(weapon);
}

function setQuakeDebugPowerup(runtime: QuakeDebugRuntime, finishedField: string, durationMs: number): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  if (typeof finishedField !== "string" || !finishedField || !Number.isFinite(durationMs)) return false;
  runtime.hideMainMenu();
  return runtime.setPowerup(finishedField, durationMs);
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
    if (options.gameplay) {
      runtime.syncGameplay(nextOrigin);
      runtime.syncSceneCameraAt(nextOrigin, rotX, rotY);
      runtime.syncViewmodel({ stable: options.stableViewmodel });
      runtime.syncCrosshairTarget();
    } else if (options.stableViewmodel) runtime.syncViewmodel({ stable: true });
    return true;
  }
  if (originChanged) runtime.controls.setOrigin(nextOrigin);
  if (options.gameplay) {
    runtime.syncGameplay(nextOrigin);
    runtime.syncSceneCameraAt(nextOrigin, rotX, rotY);
    runtime.syncViewmodel({ stable: options.stableViewmodel });
    runtime.syncCrosshairTarget();
    return true;
  }
  runtime.syncSceneCameraAt(nextOrigin, rotX, rotY);
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
    renderOrigin: runtime.renderOrigin(),
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
    activeWeapon: inventory.activeWeapon,
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
    multiplayer: runtime.multiplayerStats(),
    pickups: runtime.pickupsStats(),
    triggers: runtime.triggersStats(),
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
  visibleLeafSamples: number;
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
    visibleLeafSamples: meshStats.reduce((total, mesh) => total + mesh.visibleLeafSamples, 0),
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
    visibleLeafSamples: visibleLeafAreas.length,
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
