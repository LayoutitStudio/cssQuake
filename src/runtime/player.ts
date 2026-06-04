import type { PolyFirstPersonControlsHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity, QuakePocScene } from "../prepared/preparedScene";
import type { QuakeCollisionWorld, QuakeTouchedTrigger } from "./collision";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  QUAKE_PLAYER_VIEW_Z,
  STEP_HEIGHT,
} from "./constants";
import type { QuakeHazardDamage } from "./hazards";
import { createInitialInventory, type QuakePlayerInventory } from "./hud";
import { distanceSq3 } from "./math";

const FALL_DT_CLAMP = 0.05;
const QUAKE_DAMAGE_INTERVAL_MS = 1000;
const QUAKE_DAMAGE_FLASH_MS = 260;

export interface QuakePlayerControllerOptions {
  activateSolidTouch: (touch: QuakeTouchedTrigger) => void;
  controls: PolyFirstPersonControlsHandle;
  getCollisionWorld: () => QuakeCollisionWorld | null;
  getCurrentScene: () => QuakePocScene | null;
  gravity: number;
  jumpVelocity: number;
  onDamageFlash: (active: boolean) => void;
  onHazardState: (kind: QuakeHazardDamage["kind"] | null) => void;
  onInventoryChanged: () => void;
  onRespawn: (scene: QuakePocScene, origin: [number, number, number]) => void;
  pointToPoly: (point: { x: number; y: number; z: number }) => Vec3;
  resolveShootablesCollision: (
    result: { origin: [number, number, number]; groundZ: number; grounded: boolean; touches?: QuakeTouchedTrigger[] },
    previous: [number, number, number],
    eyeHeight: number,
  ) => { origin: [number, number, number]; groundZ: number; grounded: boolean; touches?: QuakeTouchedTrigger[] };
  syncCrosshairTarget: () => void;
  syncHazards: (origin?: [number, number, number], triggers?: QuakeTouchedTrigger[]) => boolean;
  syncPickups: (origin: [number, number, number], eyeHeight: number) => void;
  syncTouchedTriggers: (origin: [number, number, number]) => QuakeTouchedTrigger[];
  syncViewmodel: () => void;
  syncWorldVisibility: (force?: boolean) => void;
  transitionSerial: () => number;
}

export interface QuakePlayerController {
  carryWithMover: (delta: Vec3, entityIndex: number) => void;
  clearLevelState: () => void;
  currentGroundEntity: () => number | null;
  currentOrigin: () => [number, number, number];
  eyeHeight: () => number;
  inventory: () => QuakePlayerInventory;
  resetInventory: () => void;
  resetForSceneDispose: () => void;
  spawn: (spawn: QuakePocScene["spawn"]) => void;
  syncCollision: () => void;
  syncHazard: (hazard: QuakeHazardDamage | null) => boolean;
  teleportTo: (destination: QuakeEntity) => boolean;
}

export function createQuakePlayerController(options: QuakePlayerControllerOptions): QuakePlayerController {
  let currentEyeHeight = 1.72;
  let currentGroundZ = 0;
  let lastValidOrigin: [number, number, number] = [0, 0, 1.72];
  let lastSafeOrigin: [number, number, number] = [0, 0, 1.72];
  let syncingCollision = false;
  let fallingFrame: number | null = null;
  let fallingTime = 0;
  let fallingVelocity = 0;
  let inventory = createInitialInventory();
  let nextDamageAt = 0;
  let hazardTimer: number | null = null;
  let damageFlashTimer: number | null = null;
  let lastGroundEntityIndex: number | null = null;

  const resetInventory = (): void => {
    inventory = createInitialInventory();
    options.onInventoryChanged();
  };

  const clearHazardTimer = (): void => {
    if (hazardTimer !== null) {
      window.clearTimeout(hazardTimer);
      hazardTimer = null;
    }
  };

  const clearDamageFlash = (): void => {
    if (damageFlashTimer !== null) {
      window.clearTimeout(damageFlashTimer);
      damageFlashTimer = null;
    }
    options.onDamageFlash(false);
  };

  const flashDamage = (): void => {
    clearDamageFlash();
    options.onDamageFlash(true);
    damageFlashTimer = window.setTimeout(clearDamageFlash, QUAKE_DAMAGE_FLASH_MS);
  };

  const resetForSceneDispose = (): void => {
    clearHazardTimer();
    clearDamageFlash();
    stopFalling();
    inventory = createInitialInventory();
    nextDamageAt = 0;
    lastGroundEntityIndex = null;
    lastValidOrigin = [0, 0, 1.72];
    lastSafeOrigin = [0, 0, 1.72];
    options.onHazardState(null);
    options.onInventoryChanged();
  };

  const spawn = (spawn: QuakePocScene["spawn"]): void => {
    const collisionWorld = options.getCollisionWorld();
    currentEyeHeight = spawn.eyeHeight;
    currentGroundZ = collisionWorld?.floorAt(
      spawn.origin[0],
      spawn.origin[1],
      spawn.groundZ + STEP_HEIGHT,
      -Infinity,
    ) ?? spawn.groundZ;
    const origin: [number, number, number] = [
      spawn.origin[0],
      spawn.origin[1],
      currentGroundZ + currentEyeHeight,
    ];
    setOrigin(origin);
    lastSafeOrigin = origin;
  };

  const teleportTo = (destination: QuakeEntity): boolean => {
    if (!destination.origin) return false;
    clearHazardTimer();
    clearDamageFlash();
    nextDamageAt = 0;
    options.onHazardState(null);
    stopFalling();

    const collisionWorld = options.getCollisionWorld();
    const hullOrigin = options.pointToPoly(destination.origin);
    const eyeOrigin: Vec3 = [hullOrigin[0], hullOrigin[1], hullOrigin[2] + QUAKE_PLAYER_VIEW_Z];
    const groundZ = collisionWorld?.floorAt(
      eyeOrigin[0],
      eyeOrigin[1],
      eyeOrigin[2] - currentEyeHeight + STEP_HEIGHT,
      eyeOrigin[2] - currentEyeHeight - STEP_HEIGHT,
    ) ?? eyeOrigin[2] - currentEyeHeight;
    setOrigin([eyeOrigin[0], eyeOrigin[1], groundZ + currentEyeHeight], groundZ);
    return true;
  };

  const applyDamage = (amount: number): boolean => {
    if (amount <= 0) return false;
    inventory.health = Math.max(0, inventory.health - Math.round(amount));
    options.onInventoryChanged();
    flashDamage();
    if (inventory.health > 0) return false;
    respawn();
    return true;
  };

  const respawn = (): void => {
    const scene = options.getCurrentScene();
    if (!scene) return;
    clearHazardTimer();
    nextDamageAt = performance.now() + QUAKE_DAMAGE_INTERVAL_MS;
    stopFalling();
    resetInventory();
    options.onHazardState(null);
    options.onRespawn(scene, lastValidOrigin);
    spawn(scene.spawn);
    const origin = lastValidOrigin;
    const triggers = options.syncTouchedTriggers(origin);
    options.syncHazards(origin, triggers);
    options.syncPickups(origin, currentEyeHeight);
    options.syncViewmodel();
    options.syncWorldVisibility(true);
    options.syncCrosshairTarget();
  };

  const syncCollision = (): void => {
    const collisionWorld = options.getCollisionWorld();
    if (syncingCollision || !collisionWorld) return;
    const origin = options.controls.getOrigin();
    const resolved = options.resolveShootablesCollision(
      collisionWorld.resolve(origin, lastValidOrigin, currentEyeHeight, currentGroundZ),
      lastValidOrigin,
      currentEyeHeight,
    );
    const moved = distanceSq3(origin, resolved.origin) > COLLISION_EPSILON;
    const groundChanged = Math.abs(resolved.groundZ - currentGroundZ) > COLLISION_EPSILON;

    if (resolved.grounded) {
      stopFalling();
    } else if (origin[2] - currentEyeHeight <= currentGroundZ + GROUND_SNAP) {
      startFalling();
    }

    if (moved || groundChanged) {
      setOrigin(resolved.origin, resolved.groundZ);
    }

    lastValidOrigin = resolved.origin;
    if (resolved.grounded) lastSafeOrigin = resolved.origin;
    lastGroundEntityIndex = resolved.touches?.find((touch) => touch.contact === "floor")?.entityIndex ?? null;
    for (const touch of resolved.touches ?? []) {
      options.activateSolidTouch(touch);
    }
    const transitionSerial = options.transitionSerial();
    const triggers = options.syncTouchedTriggers(resolved.origin);
    if (options.transitionSerial() !== transitionSerial) return;
    if (options.syncHazards(resolved.origin, triggers)) return;
    options.syncPickups(resolved.origin, currentEyeHeight);
    options.syncViewmodel();
    options.syncWorldVisibility();
    options.syncCrosshairTarget();
  };

  const scheduleHazardTick = (delay: number): void => {
    if (hazardTimer !== null) return;
    hazardTimer = window.setTimeout(() => {
      hazardTimer = null;
      if (!options.getCollisionWorld()) return;
      options.syncHazards(lastValidOrigin);
    }, Math.max(0, delay));
  };

  const syncHazard = (hazard: QuakeHazardDamage | null): boolean => {
    if (!hazard) {
      clearHazardTimer();
      nextDamageAt = 0;
      options.onHazardState(null);
      return false;
    }

    options.onHazardState(hazard.kind);
    const now = performance.now();
    const delay = nextDamageAt - now;
    if (delay > 0) {
      scheduleHazardTick(delay);
      return false;
    }

    const died = applyDamage(hazard.amount);
    nextDamageAt = performance.now() + QUAKE_DAMAGE_INTERVAL_MS;
    if (!died) scheduleHazardTick(QUAKE_DAMAGE_INTERVAL_MS);
    return died;
  };

  const clearLevelState = (): void => {
    clearHazardTimer();
    clearDamageFlash();
    options.onHazardState(null);
    stopFalling();
    options.controls.update({ moveEnabled: false, jumpEnabled: false });
    options.controls.unlock();
  };

  const startFalling = (): void => {
    if (fallingFrame !== null || !options.getCollisionWorld()) return;
    fallingTime = 0;
    fallingVelocity = 0;
    syncingCollision = true;
    options.controls.update({ jumpEnabled: false });
    syncingCollision = false;
    fallingFrame = window.requestAnimationFrame(tickFalling);
  };

  function stopFalling(): void {
    if (fallingFrame !== null) {
      window.cancelAnimationFrame(fallingFrame);
      fallingFrame = null;
    }
    fallingTime = 0;
    fallingVelocity = 0;
    syncingCollision = true;
    options.controls.update({ jumpEnabled: true, jumpVelocity: options.jumpVelocity, gravity: options.gravity });
    syncingCollision = false;
  }

  const restoreLastSafeOrigin = (): void => {
    stopFalling();
    const origin = [...lastSafeOrigin] as [number, number, number];
    setOrigin(origin, origin[2] - currentEyeHeight, true);
    lastValidOrigin = origin;
    const transitionSerial = options.transitionSerial();
    const triggers = options.syncTouchedTriggers(origin);
    if (options.transitionSerial() !== transitionSerial) return;
    options.syncHazards(origin, triggers);
    options.syncPickups(origin, currentEyeHeight);
    options.syncViewmodel();
    options.syncWorldVisibility();
    options.syncCrosshairTarget();
  };

  const tickFalling = (now: number): void => {
    const collisionWorld = options.getCollisionWorld();
    if (fallingFrame === null || !collisionWorld) return;
    const dt = Math.min(FALL_DT_CLAMP, fallingTime ? (now - fallingTime) / 1000 : 0.0167);
    fallingTime = now;
    fallingVelocity += options.gravity * dt;

    const origin = options.controls.getOrigin();
    const footZ = origin[2] - currentEyeHeight;
    const floorZ = collisionWorld.floorAt(origin[0], origin[1], footZ + GROUND_SNAP, -Infinity);
    if (floorZ === null) {
      restoreLastSafeOrigin();
      return;
    }
    let nextGroundZ = footZ - fallingVelocity * dt;
    let landed = false;
    if (nextGroundZ <= floorZ + GROUND_SNAP) {
      nextGroundZ = floorZ;
      landed = true;
    }

    const nextOrigin: [number, number, number] = [origin[0], origin[1], nextGroundZ + currentEyeHeight];
    setOrigin(nextOrigin, nextGroundZ, true, landed);
    lastValidOrigin = nextOrigin;
    const transitionSerial = options.transitionSerial();
    const triggers = options.syncTouchedTriggers(nextOrigin);
    if (options.transitionSerial() !== transitionSerial) return;
    if (options.syncHazards(nextOrigin, triggers)) return;
    options.syncPickups(nextOrigin, currentEyeHeight);
    options.syncViewmodel();
    options.syncWorldVisibility();
    options.syncCrosshairTarget();

    if (landed) {
      stopFalling();
      return;
    }
    fallingFrame = window.requestAnimationFrame(tickFalling);
  };

  const setOrigin = (
    origin: [number, number, number],
    groundZ = origin[2] - currentEyeHeight,
    jumpEnabled = true,
    landed = true,
  ): void => {
    syncingCollision = true;
    currentGroundZ = groundZ;
    options.controls.update({
      groundZ: currentGroundZ,
      eyeHeight: currentEyeHeight,
      jumpEnabled,
      jumpVelocity: options.jumpVelocity,
      gravity: options.gravity,
    });
    options.controls.setOrigin(origin);
    syncingCollision = false;
    lastValidOrigin = origin;
    if (landed) lastSafeOrigin = origin;
  };

  const carryWithMover = (delta: Vec3, entityIndex: number): void => {
    const origin = options.controls.getOrigin();
    const nextOrigin: [number, number, number] = [
      origin[0] + delta[0],
      origin[1] + delta[1],
      origin[2] + delta[2],
    ];
    setOrigin(nextOrigin, currentGroundZ + delta[2]);
    lastGroundEntityIndex = entityIndex;
    const transitionSerial = options.transitionSerial();
    const triggers = options.syncTouchedTriggers(nextOrigin);
    if (options.transitionSerial() !== transitionSerial) return;
    if (options.syncHazards(nextOrigin, triggers)) return;
    options.syncPickups(nextOrigin, currentEyeHeight);
    options.syncViewmodel();
    options.syncWorldVisibility();
    options.syncCrosshairTarget();
  };

  return {
    carryWithMover,
    clearLevelState,
    currentGroundEntity: () => lastGroundEntityIndex,
    currentOrigin: () => lastValidOrigin,
    eyeHeight: () => currentEyeHeight,
    inventory: () => inventory,
    resetInventory,
    resetForSceneDispose,
    spawn,
    syncCollision,
    syncHazard,
    teleportTo,
  };
}
