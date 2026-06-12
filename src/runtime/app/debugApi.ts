import type { Vec3 } from "@layoutit/polycss";

import { QUAKE_WEAPON_ITEM_FLAGS, type QuakeWeaponId } from "../hud";
import { quakecCanDamageTracePointsForTargetOrigin, type QuakeCanDamageResult } from "../shootables/damage";
import {
  installQuakeDebugHooks,
  isQuakeDebugHooksEnabled,
  type QuakeDebugRuntime,
} from "../debug/quakeDebug";
import type { QuakeAppRuntimeContext } from "./context";

const QUAKE_DEBUG_WEAPON_AMMO = {
  shells: 100,
  nails: 200,
  rockets: 100,
  cells: 100,
} as const;

export interface QuakeAppDebugApiOptions {
  runtime: QuakeAppRuntimeContext;
  activateEntity(entityIndex: number, sourceEntityIndex?: number): boolean;
  copyViewUrl(): Promise<string>;
  fireballEmittersCount(): number;
  fireballsCount(): number;
  forwardDirection(rotX: number, rotY: number): Vec3;
  loadMap(mapName: string): Promise<void>;
  mapExists(mapName: string): boolean;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  setCollisionBypassUntil(until: number): void;
  syncHud(): void;
  syncCrosshairTarget(): void;
  syncGameplay(origin: [number, number, number]): void;
  syncSceneCameraAt(origin: [number, number, number], rotX: number, rotY: number): void;
  viewUrl(): string;
}

export function installQuakeAppDebugApi(options: QuakeAppDebugApiOptions): void {
  installQuakeDebugHooks(isQuakeDebugHooksEnabled(), createQuakeAppDebugRuntime(options));
}

function createQuakeAppDebugRuntime({
  runtime,
  activateEntity,
  copyViewUrl,
  fireballEmittersCount,
  fireballsCount,
  forwardDirection,
  loadMap,
  mapExists,
  pointToPoly,
  setCollisionBypassUntil,
  syncHud,
  syncCrosshairTarget,
  syncGameplay,
  syncSceneCameraAt,
  viewUrl,
}: QuakeAppDebugApiOptions): QuakeDebugRuntime {
  return {
    activateEntity,
    cameraRotation: () => ({
      rotX: runtime.scene.camera.state.rotX ?? 88,
      rotY: runtime.scene.camera.state.rotY ?? 270,
    }),
    canDamage: (inflictorOrigin, targetOrigin): QuakeCanDamageResult =>
      runtime.controllers.shootables.debugCanDamageTrace(
        pointToPoly(inflictorOrigin),
        quakecCanDamageTracePointsForTargetOrigin(targetOrigin, pointToPoly),
      ),
    copyViewUrl,
    controls: {
      getOrigin: () => runtime.controls.getOrigin(),
      setOrigin: (origin) => runtime.controllers.player().setDebugOrigin(origin),
    },
    currentMapName: runtime.session.currentMapName,
    damagePlayer: (amount) => runtime.controllers.player().damage(amount),
    damageWeaponTarget: (entityIndex, amount) =>
      runtime.controllers.shootables.debugDamageWeaponTarget(entityIndex, amount),
    debugMountEntity: (entityIndex) => runtime.controllers.shootables.debugMountEntity(entityIndex),
    enemyAcquisition: (entityIndex, playerSourceOrigin, monsterYaw) =>
      runtime.controllers.shootables.debugEnemyAcquisition(entityIndex, playerSourceOrigin, { monsterYaw }),
    entities: runtime.session.entities,
    fireWeapon: () => runtime.controllers.weapons.fire(),
    fireballEmittersCount,
    fireballsCount,
    floorAt: (x, y, maxZ, minZ) =>
      runtime.session.collisionWorld()?.floorAt(x, y, maxZ, minZ) ??
      runtime.session.collisionWorld()?.staticFloorAt(x, y, maxZ, minZ) ??
      null,
    forwardDirection,
    hasCurrentScene: () => runtime.session.currentScene() !== null,
    hideMainMenu: () => runtime.controllers.menu.hideMainMenu(),
    inventory: () => runtime.controllers.player().inventory(),
    isLoading: runtime.session.isLoading,
    loadMap,
    mapExists,
    getWeaponTuning: () => runtime.controllers.viewmodel.getTuning(),
    resetWeaponTuning: () => runtime.controllers.viewmodel.resetTuning(),
    setExpandedLogicalCombat: (enabled) => runtime.controllers.shootables.setExpandedLogicalCombatEnabled(enabled),
    setMountedEnemyAcquisition: (enabled) =>
      runtime.controllers.shootables.setMountedEnemyAcquisitionEnabled(enabled),
    setWeapon: (weapon) => setQuakeDebugWeapon(runtime, weapon, syncHud),
    setWeaponTuning: (tuning) => runtime.controllers.viewmodel.setTuning(tuning),
    viewmodelDebug: () => runtime.controllers.viewmodel.debugSnapshot(),
    moversStats: () => runtime.controllers.movers.debugStats(),
    multiplayerStats: () => runtime.multiplayer?.snapshot() ?? null,
    playerEyeHeight: () => runtime.controllers.player().eyeHeight(),
    playerMoveDebug: () => runtime.controllers.player().debugMovement(),
    pointToPoly,
    projectileImpact: (weapon, entityIndex, origin, directDamage) =>
      runtime.controllers.weapons.debugProjectileImpact(weapon, entityIndex, origin, directDamage),
    setUnmountedAi: (enabled) => runtime.controllers.shootables.setUnmountedAiEnabled(enabled),
    setCollisionBypassUntil,
    setShootableOrigin: (entityIndex, origin) => runtime.controllers.shootables.debugSetOrigin(entityIndex, origin),
    shootablesStats: () => runtime.controllers.shootables.debugStats(),
    syncCrosshairTarget,
    syncGameplay,
    syncPickupsVisibility: (origin) => runtime.controllers.pickups().syncVisibility(origin),
    syncSceneCameraAt,
    syncShootablesVisibility: (origin, force) => runtime.controllers.shootables.syncVisibility(origin, force),
    syncViewmodel: (options) => runtime.controllers.viewmodel.syncTransform(options),
    syncWorldVisibility: (force) => runtime.controllers.world.syncVisibility(force),
    viewUrl,
    worldStats: () => runtime.controllers.world.debugStats(),
  };
}

function setQuakeDebugWeapon(
  runtime: QuakeAppRuntimeContext,
  weapon: QuakeWeaponId,
  syncHud: () => void,
): boolean {
  if (!isQuakeWeaponId(weapon)) return false;
  const inventory = runtime.controllers.player().inventory();
  inventory.weapons.add(weapon);
  inventory.itemFlags |= QUAKE_WEAPON_ITEM_FLAGS[weapon];
  inventory.shells = Math.max(inventory.shells, QUAKE_DEBUG_WEAPON_AMMO.shells);
  inventory.nails = Math.max(inventory.nails, QUAKE_DEBUG_WEAPON_AMMO.nails);
  inventory.rockets = Math.max(inventory.rockets, QUAKE_DEBUG_WEAPON_AMMO.rockets);
  inventory.cells = Math.max(inventory.cells, QUAKE_DEBUG_WEAPON_AMMO.cells);
  inventory.activeWeapon = weapon;
  syncHud();
  return true;
}

function isQuakeWeaponId(value: string): value is QuakeWeaponId {
  return Object.prototype.hasOwnProperty.call(QUAKE_WEAPON_ITEM_FLAGS, value);
}
