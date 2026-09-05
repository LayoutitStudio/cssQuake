import type { Vec3 } from "@layoutit/polycss";

import type { QuakeDebugRecorder } from "../debug/recording";
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
  debugRecorder(): QuakeDebugRecorder | null;
  fireballEmittersCount(): number;
  fireballsCount(): number;
  forwardDirection(rotX: number, rotY: number): Vec3;
  loadMap(mapName: string): Promise<boolean>;
  mapExists(mapName: string): boolean;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  renderOrigin(): Vec3;
  requestMultiplayerPickup(entityIndex: number): boolean;
  setCollisionBypassUntil(until: number): void;
  setMultiplayerInputPaused(paused: boolean): boolean;
  syncHud(): void;
  syncCrosshairTarget(): void;
  syncGameplay(origin: [number, number, number]): void;
  syncMultiplayerPose(): boolean;
  syncSceneCameraAt(origin: [number, number, number], rotX: number, rotY: number): void;
  touchEntity(entityIndex: number): boolean;
  viewUrl(): string;
}

export function installQuakeAppDebugApi(options: QuakeAppDebugApiOptions): void {
  installQuakeDebugHooks(isQuakeDebugHooksEnabled(), createQuakeAppDebugRuntime(options));
}

function createQuakeAppDebugRuntime({
  runtime,
  activateEntity,
  copyViewUrl,
  debugRecorder,
  fireballEmittersCount,
  fireballsCount,
  forwardDirection,
  loadMap,
  mapExists,
  pointToPoly,
  renderOrigin,
  requestMultiplayerPickup,
  setCollisionBypassUntil,
  setMultiplayerInputPaused,
  syncHud,
  syncCrosshairTarget,
  syncGameplay,
  syncMultiplayerPose,
  syncSceneCameraAt,
  touchEntity,
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
    contentsAt: (point) => runtime.session.collisionWorld()?.contentsAt?.(pointToPoly(point)) ?? null,
    copyViewUrl,
    controls: {
      getOrigin: () => runtime.controls.getOrigin(),
      setOrigin: (origin) => runtime.controllers.player().setDebugOrigin(origin),
    },
    currentMapName: runtime.session.currentMapName,
    damageableBrushesStats: () => runtime.controllers.damageableBrushes.snapshot(),
    damagePlayer: (amount, context) => runtime.controllers.player().damage(amount, context),
    damageWeaponTarget: (entityIndex, amount) =>
      runtime.controllers.shootables.debugDamageWeaponTarget(entityIndex, amount),
    debugMountEntity: (entityIndex) => runtime.controllers.shootables.debugMountEntity(entityIndex),
    setEnemyTickFilter: (entityIndexes) =>
      runtime.controllers.shootables.debugSetEnemyTickFilter(entityIndexes),
    debugRecorder,
    enemyAcquisition: (entityIndex, playerSourceOrigin, monsterYaw) =>
      runtime.controllers.shootables.debugEnemyAcquisition(entityIndex, playerSourceOrigin, { monsterYaw }),
    enemyForceAttack: (entityIndex, targetOrigin) =>
      runtime.controllers.shootables.debugForceEnemyAttack(
        entityIndex,
        targetOrigin
          ? pointToPoly({ x: targetOrigin[0], y: targetOrigin[1], z: targetOrigin[2] })
          : undefined,
      ),
    enemyForceAttackChain: (entityIndex, chain, targetOrigin) =>
      runtime.controllers.shootables.debugForceEnemyAttackChain(
        entityIndex,
        chain,
        targetOrigin
          ? pointToPoly({ x: targetOrigin[0], y: targetOrigin[1], z: targetOrigin[2] })
          : undefined,
      ),
    enemyProjectileTraceCapture: () => runtime.controllers.shootables.debugEnemyProjectileCapture(),
    enemyProjectileTraceClear: () => runtime.controllers.shootables.debugClearEnemyProjectileCapture(),
    enemyProjectileTraceEnabled: (enabled) =>
      runtime.controllers.shootables.debugSetEnemyProjectileCaptureEnabled(enabled),
    enemyProjectileTraceStep: (dtMs) => runtime.controllers.shootables.debugStepEnemyProjectiles(dtMs),
    entities: runtime.session.entities,
    fireWeapon: () => {
      runtime.gameplay.resumeForDebugInput();
      return runtime.gameplay.runWithDebugInput(() => runtime.controllers.weapons.fire());
    },
    fireWeaponDebug: (options) => {
      runtime.gameplay.resumeForDebugInput();
      return runtime.gameplay.runWithDebugInput(() => runtime.controllers.weapons.debugFireProjectile(options));
    },
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
    setMultiplayerInputPaused,
    setPowerup: (finishedField, durationMs) => setQuakeDebugPowerup(runtime, finishedField, durationMs, syncHud),
    setWeapon: (weapon) => setQuakeDebugWeapon(runtime, weapon, syncHud),
    setWeaponTuning: (tuning) => runtime.controllers.viewmodel.setTuning(tuning),
    viewmodelDebug: () => runtime.controllers.viewmodel.debugSnapshot(),
    moversStats: () => runtime.controllers.movers.debugStats(),
    multiplayerStats: () => runtime.multiplayer?.snapshot() ?? null,
    pickupsStats: () => runtime.controllers.pickups().debugStats(),
    playerEyeHeight: () => runtime.controllers.player().eyeHeight(),
    playerMoveDebug: () => runtime.controllers.player().debugMovement(),
    pointToPoly,
    renderOrigin,
    requestMultiplayerPickup,
    projectileImpact: (weapon, entityIndex, origin, directDamage) =>
      runtime.controllers.weapons.debugProjectileImpact(weapon, entityIndex, origin, directDamage),
    projectileTraceCapture: () => runtime.controllers.weapons.debugProjectileCapture(),
    projectileTraceClear: () => runtime.controllers.weapons.debugClearProjectileCapture(),
    projectileTraceEnabled: (enabled) => runtime.controllers.weapons.debugSetProjectileCaptureEnabled(enabled),
    runWithDebugInput: runtime.gameplay.runWithDebugInput,
    setUnmountedAi: (enabled) => runtime.controllers.shootables.setUnmountedAiEnabled(enabled),
    setCollisionBypassUntil,
    setShootableOrigin: (entityIndex, origin) => runtime.controllers.shootables.debugSetOrigin(entityIndex, origin),
    setShootableYaw: (entityIndex, yaw) => runtime.controllers.shootables.debugSetYaw(entityIndex, yaw),
    shootablesStats: () => runtime.controllers.shootables.debugStats(),
    triggersStats: () => runtime.controllers.triggers.debugStats(),
    syncCrosshairTarget,
    syncGameplay,
    syncMultiplayerPose,
    syncPlayerCollision: () => runtime.controllers.player().syncCollision(),
    syncPickupsVisibility: (origin) => runtime.controllers.pickups().syncVisibility(origin),
    syncSceneCameraAt,
    syncShootablesVisibility: (origin, force) => runtime.controllers.shootables.syncVisibility(origin, force),
    syncViewmodel: (options) => runtime.controllers.viewmodel.syncTransform(options),
    syncWorldVisibility: (force) => runtime.controllers.world.syncVisibility(force),
    touchEntity,
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

function setQuakeDebugPowerup(
  runtime: QuakeAppRuntimeContext,
  finishedField: string,
  durationMs: number,
  syncHud: () => void,
): boolean {
  if (!finishedField || !Number.isFinite(durationMs)) return false;
  const inventory = runtime.controllers.player().inventory();
  if (durationMs <= 0) {
    delete inventory.powerups[finishedField];
    syncHud();
    return true;
  }
  inventory.powerups[finishedField] = {
    active: true,
    activationField: "debug",
    finishedAt: performance.now() + durationMs,
    itemFlag: 0,
    itemFlagExpression: "debug",
  };
  syncHud();
  return true;
}

function isQuakeWeaponId(value: string): value is QuakeWeaponId {
  return Object.prototype.hasOwnProperty.call(QUAKE_WEAPON_ITEM_FLAGS, value);
}
