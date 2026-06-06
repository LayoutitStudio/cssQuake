import type { PolyFirstPersonControlsHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity, QuakeScene } from "../prepare/scene";
import type { QuakeCollisionWorld, QuakeTouchedTrigger } from "./collision";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  QUAKE_CROUCH_EYE_HEIGHT,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  STEP_HEIGHT,
} from "./constants";
import type { QuakeHazardDamage } from "./hazards";
import { markQuakeTrace } from "./debug/traceMarks";
import { createInitialInventory, type QuakePlayerInventory } from "./hud";
import { distanceSq3, subtractVec3 } from "./math";

const FALL_DT_CLAMP = 0.05;
const PUSH_DT_CLAMP = 0.035;
const PUSH_AIR_DRAG = 0.08;
const PUSH_GROUND_FRICTION = 5.5;
// Quake clamps trigger_push impulses through the default sv_maxvelocity cap.
const PUSH_MAX_SPEED = 2000 * QUAKE_COLLISION_UNIT_SCALE;
const PUSH_STOP_SPEED = 16 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_DAMAGE_INTERVAL_MS = 1000;
const QUAKE_DAMAGE_FLASH_MS = 260;

export interface QuakePlayerControllerOptions {
  activateSolidTouch: (touch: QuakeTouchedTrigger) => void;
  canTakeDamage: () => boolean;
  controls: PolyFirstPersonControlsHandle;
  getCollisionWorld: () => QuakeCollisionWorld | null;
  getCurrentScene: () => QuakeScene | null;
  gravity: number;
  jumpVelocity: number;
  onDamageFlash: (active: boolean) => void;
  onHazardState: (kind: QuakeHazardDamage["kind"] | null) => void;
  onInventoryChanged: () => void;
  onRespawn: (scene: QuakeScene, origin: [number, number, number]) => void;
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
  damage: (amount: number) => boolean;
  eyeHeight: () => number;
  inventory: () => QuakePlayerInventory;
  isCrouching: () => boolean;
  push: (velocity: Vec3) => boolean;
  resetInventory: () => void;
  resetForSceneDispose: () => void;
  spawn: (spawn: QuakeScene["spawn"]) => void;
  setCrouching: (crouching: boolean) => void;
  setDebugOrigin: (origin: [number, number, number]) => void;
  syncCollision: () => void;
  syncHazard: (hazard: QuakeHazardDamage | null) => boolean;
  teleportTo: (destination: QuakeEntity) => boolean;
}

export function createQuakePlayerController(options: QuakePlayerControllerOptions): QuakePlayerController {
  let standingEyeHeight = 1.72;
  let currentEyeHeight = 1.72;
  let currentCrouching = false;
  let currentGroundZ = 0;
  let lastValidOrigin: [number, number, number] = [0, 0, 1.72];
  let lastSafeOrigin: [number, number, number] = [0, 0, 1.72];
  let syncingCollision = false;
  let fallingFrame: number | null = null;
  let fallingTime = 0;
  let fallingVelocity = 0;
  let pushFrame: number | null = null;
  let pushTime = 0;
  let pushVelocity: Vec3 = [0, 0, 0];
  let inventory = createInitialInventory();
  let nextDamageAt = 0;
  let hazardTimer: number | null = null;
  let damageFlashTimer: number | null = null;
  let damageFlashSerial = 0;
  let damageFlashActive = false;
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

  const finishDamageFlash = (serial: number): void => {
    if (serial !== damageFlashSerial) return;
    damageFlashTimer = null;
    if (!damageFlashActive) return;
    damageFlashActive = false;
    markQuakeTrace("damage-flash", { active: false });
    options.onDamageFlash(false);
  };

  const clearDamageFlash = (): void => {
    damageFlashSerial += 1;
    if (damageFlashTimer !== null) {
      window.clearTimeout(damageFlashTimer);
      damageFlashTimer = null;
    }
    if (!damageFlashActive) return;
    damageFlashActive = false;
    markQuakeTrace("damage-flash", { active: false });
    options.onDamageFlash(false);
  };

  const flashDamage = (): void => {
    damageFlashSerial += 1;
    if (damageFlashTimer !== null) {
      window.clearTimeout(damageFlashTimer);
      damageFlashTimer = null;
    }
    const serial = damageFlashSerial;
    damageFlashActive = true;
    markQuakeTrace("damage-flash", { active: true, durationMs: QUAKE_DAMAGE_FLASH_MS });
    options.onDamageFlash(true);
    damageFlashTimer = window.setTimeout(() => finishDamageFlash(serial), QUAKE_DAMAGE_FLASH_MS);
  };

  const resetForSceneDispose = (): void => {
    clearHazardTimer();
    clearDamageFlash();
    stopFalling();
    stopPush();
    inventory = createInitialInventory();
    standingEyeHeight = 1.72;
    currentEyeHeight = standingEyeHeight;
    currentCrouching = false;
    nextDamageAt = 0;
    lastGroundEntityIndex = null;
    lastValidOrigin = [0, 0, 1.72];
    lastSafeOrigin = [0, 0, 1.72];
    options.onHazardState(null);
    options.onInventoryChanged();
  };

  const spawn = (spawn: QuakeScene["spawn"]): void => {
    const collisionWorld = options.getCollisionWorld();
    standingEyeHeight = spawn.eyeHeight;
    currentEyeHeight = standingEyeHeight;
    currentCrouching = false;
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
    stopPush();

    const collisionWorld = options.getCollisionWorld();
    const hullOrigin = options.pointToPoly(destination.origin);
    const eyeOrigin: Vec3 = [
      hullOrigin[0],
      hullOrigin[1],
      hullOrigin[2] + QUAKE_PLAYER_MINS_Z + currentEyeHeight,
    ];
    const groundZ = collisionWorld?.floorAt(
      eyeOrigin[0],
      eyeOrigin[1],
      eyeOrigin[2] - currentEyeHeight + STEP_HEIGHT,
      eyeOrigin[2] - currentEyeHeight - STEP_HEIGHT,
    ) ?? eyeOrigin[2] - currentEyeHeight;
    setOrigin([eyeOrigin[0], eyeOrigin[1], groundZ + currentEyeHeight], groundZ);
    return true;
  };

  const setDebugOrigin = (origin: [number, number, number]): void => {
    stopFalling();
    stopPush();
    setOrigin(origin, origin[2] - currentEyeHeight);
  };

  const setCrouching = (crouching: boolean): void => {
    const nextEyeHeight = crouching
      ? Math.min(standingEyeHeight, QUAKE_CROUCH_EYE_HEIGHT)
      : standingEyeHeight;
    if (
      currentCrouching === crouching &&
      Math.abs(currentEyeHeight - nextEyeHeight) <= COLLISION_EPSILON
    ) return;

    const origin = options.controls.getOrigin();
    const footZ = origin[2] - currentEyeHeight;
    currentCrouching = crouching;
    currentEyeHeight = nextEyeHeight;
    const nextOrigin: [number, number, number] = [origin[0], origin[1], footZ + currentEyeHeight];
    const grounded = Math.abs(footZ - currentGroundZ) <= GROUND_SNAP;
    const jumpEnabled = fallingFrame === null && pushFrame === null;
    setOrigin(nextOrigin, currentGroundZ, jumpEnabled, grounded);

    markQuakeTrace("player-crouch", {
      active: currentCrouching,
      eyeHeight: currentEyeHeight,
      x: nextOrigin[0],
      y: nextOrigin[1],
      z: nextOrigin[2],
    });
    const transitionSerial = options.transitionSerial();
    const triggers = options.syncTouchedTriggers(nextOrigin);
    if (options.transitionSerial() !== transitionSerial) return;
    if (options.syncHazards(nextOrigin, triggers)) return;
    options.syncPickups(nextOrigin, currentEyeHeight);
    options.syncViewmodel();
    options.syncWorldVisibility();
    options.syncCrosshairTarget();
  };

  const applyDamage = (amount: number): boolean => {
    if (amount <= 0 || !options.canTakeDamage()) return false;
    const damage = Math.round(amount);
    inventory.health = Math.max(0, inventory.health - damage);
    markQuakeTrace("player-damage", { amount: damage, health: inventory.health, died: inventory.health <= 0 });
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
    stopPush();
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

    if (pushFrame === null) {
      if (resolved.grounded) {
        stopFalling();
      } else if (origin[2] - currentEyeHeight <= currentGroundZ + GROUND_SNAP) {
        startFalling();
      }
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
      markQuakeTrace("hazard-delay", { kind: hazard.kind, delayMs: delay });
      scheduleHazardTick(delay);
      return false;
    }

    markQuakeTrace("hazard-damage", { kind: hazard.kind, amount: hazard.amount });
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
    stopPush();
    options.controls.update({ moveEnabled: false, jumpEnabled: false });
    options.controls.unlock();
  };

  const push = (velocity: Vec3): boolean => {
    if (!options.getCollisionWorld()) return false;
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    if (!Number.isFinite(speed) || speed <= COLLISION_EPSILON) return false;
    const scale = Math.min(1, PUSH_MAX_SPEED / speed);
    pushVelocity = [
      velocity[0] * scale,
      velocity[1] * scale,
      velocity[2] * scale,
    ];
    pushTime = 0;
    stopFalling();
    syncingCollision = true;
    options.controls.update({ jumpEnabled: false });
    syncingCollision = false;
    if (pushFrame === null) {
      pushFrame = window.requestAnimationFrame(tickPush);
    }
    return true;
  };

  function stopPush(): void {
    if (pushFrame !== null) {
      window.cancelAnimationFrame(pushFrame);
      pushFrame = null;
    }
    pushTime = 0;
    pushVelocity = [0, 0, 0];
    syncingCollision = true;
    options.controls.update({ jumpEnabled: true, jumpVelocity: options.jumpVelocity, gravity: options.gravity });
    syncingCollision = false;
  }

  const startFalling = (): void => {
    if (fallingFrame !== null || pushFrame !== null || !options.getCollisionWorld()) return;
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

  const tickFalling = (_frameNow: number): void => {
    const collisionWorld = options.getCollisionWorld();
    if (fallingFrame === null || !collisionWorld) return;
    const now = performance.now();
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

  const tickPush = (_frameNow: number): void => {
    const collisionWorld = options.getCollisionWorld();
    if (pushFrame === null || !collisionWorld) {
      stopPush();
      return;
    }

    const now = performance.now();
    const dt = Math.min(PUSH_DT_CLAMP, pushTime ? (now - pushTime) / 1000 : 0.0167);
    pushTime = now;
    pushVelocity[2] -= options.gravity * dt;

    const origin = options.controls.getOrigin();
    const target: [number, number, number] = [
      origin[0] + pushVelocity[0] * dt,
      origin[1] + pushVelocity[1] * dt,
      origin[2] + pushVelocity[2] * dt,
    ];
    const resolved = options.resolveShootablesCollision(
      collisionWorld.resolve(target, origin, currentEyeHeight, currentGroundZ),
      origin,
      currentEyeHeight,
    );
    const actualDelta = subtractVec3(resolved.origin, origin);
    const intendedDelta = subtractVec3(target, origin);
    const grounded = resolved.grounded;

    if (grounded && pushVelocity[2] < 0) pushVelocity[2] = 0;
    if (!grounded && pushVelocity[2] > 0 && actualDelta[2] < intendedDelta[2] * 0.25) {
      pushVelocity[2] = 0;
    }

    const damping = Math.max(0, 1 - (grounded ? PUSH_GROUND_FRICTION : PUSH_AIR_DRAG) * dt);
    pushVelocity[0] *= damping;
    pushVelocity[1] *= damping;

    setOrigin(resolved.origin, resolved.groundZ, false, grounded);
    lastGroundEntityIndex = resolved.touches?.find((touch) => touch.contact === "floor")?.entityIndex ?? null;
    for (const touch of resolved.touches ?? []) {
      options.activateSolidTouch(touch);
    }

    const transitionSerial = options.transitionSerial();
    const triggers = options.syncTouchedTriggers(resolved.origin);
    if (pushFrame === null || options.transitionSerial() !== transitionSerial) return;
    if (options.syncHazards(resolved.origin, triggers)) return;
    options.syncPickups(resolved.origin, currentEyeHeight);
    options.syncViewmodel();
    options.syncWorldVisibility();
    options.syncCrosshairTarget();

    const horizontalSpeed = Math.hypot(pushVelocity[0], pushVelocity[1]);
    if (grounded && horizontalSpeed <= PUSH_STOP_SPEED && Math.abs(pushVelocity[2]) <= PUSH_STOP_SPEED) {
      stopPush();
      return;
    }
    pushFrame = window.requestAnimationFrame(tickPush);
  };

  const setOrigin = (
    origin: [number, number, number],
    groundZ = origin[2] - currentEyeHeight,
    jumpEnabled = true,
    landed = true,
  ): void => {
    const previousGroundZ = currentGroundZ;
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
    const groundDelta = groundZ - previousGroundZ;
    if (Math.abs(groundDelta) > COLLISION_EPSILON || !landed) {
      markQuakeTrace("player-origin", {
        x: origin[0],
        y: origin[1],
        z: origin[2],
        groundZ,
        groundDz: groundDelta,
        landed,
        jumpEnabled,
      });
    }
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
    damage: applyDamage,
    eyeHeight: () => currentEyeHeight,
    inventory: () => inventory,
    isCrouching: () => currentCrouching,
    push,
    resetInventory,
    resetForSceneDispose,
    spawn,
    setCrouching,
    setDebugOrigin,
    syncCollision,
    syncHazard,
    teleportTo,
  };
}
