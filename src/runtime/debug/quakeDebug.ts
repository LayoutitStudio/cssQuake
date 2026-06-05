import type { Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../../prepare/scene";
import type { QuakePlayerInventory } from "../hud";
import type { QuakeShootablesDebugStats } from "../shootables";
import type { QuakeWorldDebugStats } from "../world";

export interface QuakeDebugHooks {
  fire(): boolean;
  focusEntity(entityIndex: number, distance?: number, rotX?: number, rotY?: number): boolean;
  loadMap(mapName: string): Promise<boolean>;
  setPose(origin: Vec3, rotX?: number, rotY?: number): boolean;
  stats(): Record<string, unknown>;
}

interface QuakeDebugWindow extends Window {
  __cssQuakeDebug?: QuakeDebugHooks;
}

export interface QuakeDebugRuntime {
  controls: {
    getOrigin(): [number, number, number];
    setOrigin(origin: [number, number, number]): void;
  };
  currentMapName(): string;
  entities(): ReadonlyMap<number, QuakeEntity>;
  fireWeapon(): void;
  fireballEmittersCount(): number;
  fireballsCount(): number;
  forwardDirection(rotX: number, rotY: number): Vec3;
  hasCurrentScene(): boolean;
  hideMainMenu(): void;
  inventory(): QuakePlayerInventory;
  isLoading(): boolean;
  loadMap(mapName: string): Promise<void>;
  mapExists(mapName: string): boolean;
  playerEyeHeight(): number;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  setCollisionBypassUntil(until: number): void;
  shootablesStats(): QuakeShootablesDebugStats;
  syncCrosshairTarget(): void;
  syncPickupsVisibility(origin: [number, number, number]): void;
  syncSceneCameraAt(origin: [number, number, number], rotX: number, rotY: number): void;
  syncShootablesVisibility(origin: [number, number, number], force?: boolean): void;
  syncViewmodel(): void;
  syncWorldVisibility(force?: boolean): void;
  worldStats(): QuakeWorldDebugStats;
}

export function installQuakeDebugHooks(enabled: boolean, runtime: QuakeDebugRuntime): void {
  if (!enabled) return;
  (window as QuakeDebugWindow).__cssQuakeDebug = {
    fire: () => fireQuakeDebugWeapon(runtime),
    focusEntity: (entityIndex, distance, rotX, rotY) =>
      focusQuakeDebugEntity(runtime, entityIndex, distance, rotX, rotY),
    loadMap: (mapName) => loadQuakeDebugMap(runtime, mapName),
    setPose: (origin, rotX, rotY) => setQuakeDebugPose(runtime, origin, rotX, rotY),
    stats: () => buildQuakeDebugStats(runtime),
  };
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

function setQuakeDebugPose(runtime: QuakeDebugRuntime, origin: Vec3, rotX = 90, rotY = 270): boolean {
  if (runtime.isLoading() || !runtime.hasCurrentScene()) return false;
  const nextOrigin = [origin[0], origin[1], origin[2]] as [number, number, number];
  runtime.setCollisionBypassUntil(performance.now() + 10000);
  runtime.hideMainMenu();
  runtime.controls.setOrigin(nextOrigin);
  runtime.syncSceneCameraAt(nextOrigin, rotX, rotY);
  runtime.syncShootablesVisibility(nextOrigin, true);
  runtime.syncPickupsVisibility(nextOrigin);
  runtime.syncViewmodel();
  runtime.syncWorldVisibility(true);
  runtime.syncCrosshairTarget();
  return true;
}

function buildQuakeDebugStats(runtime: QuakeDebugRuntime): Record<string, unknown> {
  const worldStats = runtime.worldStats();
  const shootableStats = runtime.shootablesStats();
  const inventory = runtime.inventory();
  const enemyMeshes = Array.from(document.querySelectorAll<HTMLElement>(".polycss-mesh.shootable.enemy"));
  const activeEnemyMeshes = enemyMeshes.filter(
    (element) => element.dataset.prewarmed !== "true" && element.dataset.frameHidden !== "true",
  );
  const hiddenEnemyFrameMeshes = enemyMeshes.filter((element) => element.dataset.frameHidden === "true");
  const prewarmedEnemyMeshes = enemyMeshes.filter((element) => element.dataset.prewarmed === "true");
  const mountedEnemyLeaves = enemyMeshes.reduce(
    (total, element) => total + element.querySelectorAll("b,i,s,u").length,
    0,
  );
  return {
    loading: runtime.isLoading(),
    mapName: runtime.currentMapName(),
    origin: runtime.controls.getOrigin(),
    currentLeafIndex: worldStats.currentLeafIndex,
    visibleLeafCount: worldStats.visibleLeafCount,
    pvsFaceCount: worldStats.pvsFaceCount,
    fireballEmitters: runtime.fireballEmittersCount(),
    fireballs: runtime.fireballsCount(),
    playerHealth: inventory.health,
    playerArmor: inventory.armor,
    playerShells: inventory.shells,
    playerNails: inventory.nails,
    playerRockets: inventory.rockets,
    playerCells: inventory.cells,
    enemyMeshes: enemyMeshes.length,
    activeEnemyMeshes: activeEnemyMeshes.length,
    hiddenEnemyFrameMeshes: hiddenEnemyFrameMeshes.length,
    prewarmedEnemyMeshes: prewarmedEnemyMeshes.length,
    mountedEnemyLeaves,
    mountedEnemyAtlasLeaves: enemyMeshes.reduce(
      (total, element) => total + element.querySelectorAll("s").length,
      0,
    ),
    worldLeaves: worldStats.mountedLeaves,
    worldAtlasLeaves: worldStats.mountedAtlasLeaves,
    world: worldStats,
    shootables: shootableStats,
  };
}
