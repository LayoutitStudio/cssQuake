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
import {
  QUAKE_PMOVE_BACK_SPEED,
  QUAKE_PMOVE_DT_CLAMP,
  QUAKE_PMOVE_FORWARD_SPEED,
  QUAKE_PMOVE_MAX_SPEED,
  QUAKE_PMOVE_SIDE_SPEED,
  updateQuakePlayerPhysics,
  type QuakePlayerMoveCommand,
} from "./playerPhysics";

const FALL_DT_CLAMP = 0.05;
const PUSH_DT_CLAMP = 0.035;
const PUSH_AIR_DRAG = 0.08;
const PUSH_GROUND_FRICTION = 5.5;
// Quake clamps trigger_push impulses through the default sv_maxvelocity cap.
const PUSH_MAX_SPEED = 2000 * QUAKE_COLLISION_UNIT_SCALE;
const PUSH_STOP_SPEED = 16 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_DAMAGE_INTERVAL_MS = 1000;
const QUAKE_DAMAGE_FLASH_MS = 260;
const PLAYER_MOVE_STOP_SPEED = 1 * QUAKE_COLLISION_UNIT_SCALE;
const PLAYER_MOVE_STOP_SPEED_SQ = PLAYER_MOVE_STOP_SPEED * PLAYER_MOVE_STOP_SPEED;
const PLAYER_MOVE_ANALOG_DEADZONE = 0.001;
const QUAKE_FORWARD_KEY_CODES = new Set(["ArrowUp", "KeyW"]);
const QUAKE_BACK_KEY_CODES = new Set(["ArrowDown", "KeyS"]);
const QUAKE_LEFT_KEY_CODES = new Set(["ArrowLeft", "KeyA"]);
const QUAKE_RIGHT_KEY_CODES = new Set(["ArrowRight", "KeyD"]);
const QUAKE_JUMP_KEY_CODES = new Set(["Space"]);
const QUAKE_MOVE_FORWARD_BIT = 1 << 0;
const QUAKE_MOVE_BACK_BIT = 1 << 1;
const QUAKE_MOVE_LEFT_BIT = 1 << 2;
const QUAKE_MOVE_RIGHT_BIT = 1 << 3;
const QUAKE_MOVE_JUMP_BIT = 1 << 4;
const QUAKE_MOVE_DIRECTION_BITS =
  QUAKE_MOVE_FORWARD_BIT |
  QUAKE_MOVE_BACK_BIT |
  QUAKE_MOVE_LEFT_BIT |
  QUAKE_MOVE_RIGHT_BIT;

function quakeMoveKeyBit(code: string): number {
  if (QUAKE_FORWARD_KEY_CODES.has(code)) return QUAKE_MOVE_FORWARD_BIT;
  if (QUAKE_BACK_KEY_CODES.has(code)) return QUAKE_MOVE_BACK_BIT;
  if (QUAKE_LEFT_KEY_CODES.has(code)) return QUAKE_MOVE_LEFT_BIT;
  if (QUAKE_RIGHT_KEY_CODES.has(code)) return QUAKE_MOVE_RIGHT_BIT;
  if (QUAKE_JUMP_KEY_CODES.has(code)) return QUAKE_MOVE_JUMP_BIT;
  return 0;
}

export interface QuakePlayerControllerOptions {
  activateSolidTouch: (touch: QuakeTouchedTrigger) => void;
  canUseGameplayInput: () => boolean;
  canTakeDamage: () => boolean;
  controls: PolyFirstPersonControlsHandle;
  getYaw: () => number;
  getCollisionWorld: () => QuakeCollisionWorld | null;
  getCurrentScene: () => QuakeScene | null;
  gravity: number;
  jumpVelocity: number;
  onDamageFlash: (active: boolean, feedback?: QuakePlayerDamageFeedback) => void;
  onDeath: () => void;
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
  clearMoveInput: () => void;
  clearLevelState: () => void;
  currentGroundEntity: () => number | null;
  currentOrigin: () => [number, number, number];
  damage: (amount: number) => boolean;
  debugMovement: () => QuakePlayerMovementDebug;
  eyeHeight: () => number;
  handleMoveKey: (code: string, pressed: boolean) => boolean;
  inventory: () => QuakePlayerInventory;
  isCrouching: () => boolean;
  isDead: () => boolean;
  push: (velocity: Vec3) => boolean;
  resetInventory: () => void;
  resetForSceneDispose: () => void;
  respawn: () => void;
  spawn: (spawn: QuakeScene["spawn"]) => void;
  setAnalogMove: (x: number, y: number) => void;
  setCrouching: (crouching: boolean) => void;
  setDebugOrigin: (origin: [number, number, number]) => void;
  syncCollision: () => void;
  syncHazard: (hazard: QuakeHazardDamage | null) => boolean;
  teleportTo: (destination: QuakeEntity) => boolean;
}

export interface QuakePlayerDamageFeedback {
  amount: number;
}

export interface QuakePlayerMovementDebug {
  analogX: number;
  analogY: number;
  grounded: boolean;
  groundZ: number;
  jumpQueued: boolean;
  jumpReleased: boolean;
  keys: string[];
  lastStep: Record<string, unknown> | null;
  moveFrameActive: boolean;
  velocity: Vec3;
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
  let moveFrame: number | null = null;
  let moveTime = 0;
  let moveVelocity: Vec3 = [0, 0, 0];
  let moveKeyBits = 0;
  let moveKeyCodesDown = new Set<string>();
  let moveAnalogX = 0;
  let moveAnalogY = 0;
  let jumpQueued = false;
  let jumpReleased = true;
  let currentGrounded = true;
  let lastMoveStepDebug: Record<string, unknown> | null = null;
  const moveCommand: QuakePlayerMoveCommand = {
    forwardMove: 0,
    jump: false,
    sideMove: 0,
    yawDegrees: 270,
  };
  const moveStepDebug: Record<string, unknown> = {};
  const playerControlUpdate: Parameters<typeof options.controls.update>[0] = {
    groundZ: currentGroundZ,
    eyeHeight: currentEyeHeight,
    moveEnabled: false,
    jumpEnabled: false,
    crouchEnabled: false,
    jumpVelocity: options.jumpVelocity,
    gravity: 0,
  };
  let inventory = createInitialInventory();
  let nextDamageAt = 0;
  let hazardTimer: number | null = null;
  let damageFlashTimer: number | null = null;
  let damageFlashSerial = 0;
  let damageFlashActive = false;
  let lastGroundEntityIndex: number | null = null;
  let dead = false;

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

  const flashDamage = (feedback: QuakePlayerDamageFeedback): void => {
    damageFlashSerial += 1;
    if (damageFlashTimer !== null) {
      window.clearTimeout(damageFlashTimer);
      damageFlashTimer = null;
    }
    const serial = damageFlashSerial;
    damageFlashActive = true;
    markQuakeTrace("damage-flash", { active: true, durationMs: QUAKE_DAMAGE_FLASH_MS });
    options.onDamageFlash(true, feedback);
    damageFlashTimer = window.setTimeout(() => finishDamageFlash(serial), QUAKE_DAMAGE_FLASH_MS);
  };

  const resetForSceneDispose = (): void => {
    dead = false;
    clearHazardTimer();
    clearDamageFlash();
    clearMoveInput();
    stopMoveFrame();
    stopFalling();
    stopPush();
    inventory = createInitialInventory();
    standingEyeHeight = 1.72;
    currentEyeHeight = standingEyeHeight;
    currentCrouching = false;
    currentGrounded = true;
    moveVelocity = [0, 0, 0];
    nextDamageAt = 0;
    lastGroundEntityIndex = null;
    lastValidOrigin = [0, 0, 1.72];
    lastSafeOrigin = [0, 0, 1.72];
    options.onHazardState(null);
    options.onInventoryChanged();
  };

  const spawn = (spawn: QuakeScene["spawn"]): void => {
    dead = false;
    clearMoveInput();
    stopMoveFrame();
    moveVelocity = [0, 0, 0];
    const collisionWorld = options.getCollisionWorld();
    standingEyeHeight = spawn.eyeHeight;
    currentEyeHeight = standingEyeHeight;
    currentCrouching = false;
    currentGroundZ = collisionWorld?.floorAt(
      spawn.origin[0],
      spawn.origin[1],
      spawn.groundZ + STEP_HEIGHT + GROUND_SNAP,
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
    if (dead) return false;
    if (!destination.origin) return false;
    clearHazardTimer();
    clearDamageFlash();
    nextDamageAt = 0;
    options.onHazardState(null);
    clearMoveInput();
    stopMoveFrame();
    moveVelocity = [0, 0, 0];
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
      eyeOrigin[2] - currentEyeHeight + STEP_HEIGHT + GROUND_SNAP,
      eyeOrigin[2] - currentEyeHeight - STEP_HEIGHT,
    ) ?? eyeOrigin[2] - currentEyeHeight;
    setOrigin([eyeOrigin[0], eyeOrigin[1], groundZ + currentEyeHeight], groundZ);
    return true;
  };

  const setDebugOrigin = (origin: [number, number, number]): void => {
    clearMoveInput();
    stopMoveFrame();
    moveVelocity = [0, 0, 0];
    stopFalling();
    stopPush();
    setOrigin(origin, origin[2] - currentEyeHeight);
  };

  const setCrouching = (crouching: boolean): void => {
    if (dead && crouching) return;
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

  const debugMovement = (): QuakePlayerMovementDebug => ({
    analogX: moveAnalogX,
    analogY: moveAnalogY,
    grounded: currentGrounded,
    groundZ: currentGroundZ,
    jumpQueued,
    jumpReleased,
    keys: [...moveKeyCodesDown],
    moveFrameActive: moveFrame !== null,
    lastStep: lastMoveStepDebug,
    velocity: [...moveVelocity] as Vec3,
  });

  const applyDamage = (amount: number): boolean => {
    if (amount <= 0 || dead || !options.canTakeDamage()) return false;
    const damage = Math.round(amount);
    inventory.health = Math.max(0, inventory.health - damage);
    markQuakeTrace("player-damage", { amount: damage, health: inventory.health, died: inventory.health <= 0 });
    options.onInventoryChanged();
    flashDamage({ amount: damage });
    if (inventory.health > 0) return false;
    enterDeath();
    return true;
  };

  const enterDeath = (): void => {
    if (dead) return;
    dead = true;
    clearHazardTimer();
    clearMoveInput();
    stopMoveFrame();
    moveVelocity = [0, 0, 0];
    stopFalling();
    stopPush();
    options.onHazardState(null);
    options.controls.update({ lookEnabled: false, moveEnabled: false, jumpEnabled: false, gravity: 0 });
    markQuakeTrace("player-death", { health: inventory.health });
    options.onDeath();
  };

  const respawn = (): void => {
    const scene = options.getCurrentScene();
    if (!scene) return;
    dead = false;
    clearHazardTimer();
    clearDamageFlash();
    clearMoveInput();
    stopMoveFrame();
    moveVelocity = [0, 0, 0];
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
    markQuakeTrace("player-respawn", { x: origin[0], y: origin[1], z: origin[2] });
  };

  const handleMoveKey = (code: string, pressed: boolean): boolean => {
    const keyBit = quakeMoveKeyBit(code);
    if (!keyBit) return false;
    if (pressed) {
      if (keyBit === QUAKE_MOVE_JUMP_BIT) {
        if (jumpReleased) {
          jumpQueued = true;
          jumpReleased = false;
        }
      }
      moveKeyBits |= keyBit;
      moveKeyCodesDown.add(code);
      scheduleMoveFrame();
    } else {
      moveKeyBits &= ~keyBit;
      moveKeyCodesDown.delete(code);
      if (keyBit === QUAKE_MOVE_JUMP_BIT) jumpReleased = true;
    }
    return true;
  };

  const clearMoveInput = (): void => {
    if (
      moveKeyBits === 0 &&
      Math.abs(moveAnalogX) <= PLAYER_MOVE_ANALOG_DEADZONE &&
      Math.abs(moveAnalogY) <= PLAYER_MOVE_ANALOG_DEADZONE &&
      !jumpQueued &&
      jumpReleased
    ) return;
    moveKeyBits = 0;
    moveKeyCodesDown.clear();
    moveAnalogX = 0;
    moveAnalogY = 0;
    jumpQueued = false;
    jumpReleased = true;
  };

  const setAnalogMove = (x: number, y: number): void => {
    const clampedX = Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0));
    const clampedY = Math.max(-1, Math.min(1, Number.isFinite(y) ? y : 0));
    moveAnalogX = Math.abs(clampedX) <= PLAYER_MOVE_ANALOG_DEADZONE ? 0 : clampedX;
    moveAnalogY = Math.abs(clampedY) <= PLAYER_MOVE_ANALOG_DEADZONE ? 0 : clampedY;
    if (moveAnalogX || moveAnalogY) scheduleMoveFrame();
  };

  function stopMoveFrame(): void {
    if (moveFrame !== null) {
      window.cancelAnimationFrame(moveFrame);
      moveFrame = null;
    }
    moveTime = 0;
  }

  function scheduleMoveFrame(): void {
    if (moveFrame !== null || dead || pushFrame !== null || !options.getCollisionWorld()) return;
    moveFrame = window.requestAnimationFrame(tickMove);
  }

  function hasMoveInput(): boolean {
    return hasDirectionalMoveInput() ||
      Math.abs(moveAnalogX) > PLAYER_MOVE_ANALOG_DEADZONE ||
      Math.abs(moveAnalogY) > PLAYER_MOVE_ANALOG_DEADZONE ||
      jumpQueued;
  }

  function hasDirectionalMoveInput(): boolean {
    return (moveKeyBits & QUAKE_MOVE_DIRECTION_BITS) !== 0;
  }

  function hasMoveMotion(): boolean {
    return !currentGrounded ||
      moveVelocity[0] * moveVelocity[0] + moveVelocity[1] * moveVelocity[1] > PLAYER_MOVE_STOP_SPEED_SQ ||
      Math.abs(moveVelocity[2]) > PLAYER_MOVE_STOP_SPEED ||
      hasMoveInput();
  }

  function updateCurrentMoveCommand(): QuakePlayerMoveCommand {
    let forwardMove = 0;
    let sideMove = 0;
    if (moveKeyBits & QUAKE_MOVE_FORWARD_BIT) forwardMove += QUAKE_PMOVE_FORWARD_SPEED;
    if (moveKeyBits & QUAKE_MOVE_BACK_BIT) forwardMove -= QUAKE_PMOVE_BACK_SPEED;
    if (moveKeyBits & QUAKE_MOVE_RIGHT_BIT) sideMove += QUAKE_PMOVE_SIDE_SPEED;
    if (moveKeyBits & QUAKE_MOVE_LEFT_BIT) sideMove -= QUAKE_PMOVE_SIDE_SPEED;
    forwardMove += moveAnalogY * QUAKE_PMOVE_MAX_SPEED;
    sideMove += moveAnalogX * QUAKE_PMOVE_MAX_SPEED;
    moveCommand.forwardMove = forwardMove;
    moveCommand.jump = jumpQueued;
    moveCommand.sideMove = sideMove;
    moveCommand.yawDegrees = options.getYaw();
    return moveCommand;
  }

  const tickMove = (frameNow: number): void => {
    moveFrame = null;
    const collisionWorld = options.getCollisionWorld();
    if (dead || pushFrame !== null || !collisionWorld || !options.canUseGameplayInput()) {
      moveTime = 0;
      return;
    }
    if (!hasMoveMotion()) {
      moveTime = 0;
      moveVelocity[0] = 0;
      moveVelocity[1] = 0;
      moveVelocity[2] = 0;
      return;
    }

    const dt = Math.min(QUAKE_PMOVE_DT_CLAMP, moveTime ? (frameNow - moveTime) / 1000 : 0.0167);
    moveTime = frameNow;
    const origin = options.controls.getOrigin();
    const footZ = origin[2] - currentEyeHeight;
    const snapGroundZ = !currentGrounded && moveVelocity[2] <= 0
      ? collisionWorld.floorAt(origin[0], origin[1], footZ + GROUND_SNAP, footZ - GROUND_SNAP)
      : null;
    const groundedForPhysics = currentGrounded || snapGroundZ !== null;
    if (snapGroundZ !== null) currentGroundZ = snapGroundZ;
    currentGrounded = groundedForPhysics;
    const command = updateCurrentMoveCommand();
    jumpQueued = false;
    const physicsGrounded = updateQuakePlayerPhysics(
      moveVelocity,
      command,
      groundedForPhysics,
      dt,
      options.gravity,
      options.jumpVelocity,
    );
    currentGrounded = physicsGrounded;

    const target: [number, number, number] = [
      origin[0] + moveVelocity[0] * dt,
      origin[1] + moveVelocity[1] * dt,
      origin[2] + moveVelocity[2] * dt,
    ];
    const collisionResolved = collisionWorld.resolve(target, origin, currentEyeHeight, currentGroundZ, !physicsGrounded);
    let resolved = options.resolveShootablesCollision(
      collisionResolved,
      origin,
      currentEyeHeight,
    );
    let upwardGroundSnapIgnored = false;
    if (!physicsGrounded && moveVelocity[2] > 0 && resolved.grounded) {
      upwardGroundSnapIgnored = true;
      resolved = {
        ...resolved,
        grounded: false,
        groundZ: currentGroundZ,
        origin: target,
        touches: resolved.touches?.filter((touch) => touch.contact !== "floor"),
      };
    }
    moveStepDebug.commandJump = command.jump;
    moveStepDebug.collisionGrounded = collisionResolved.grounded;
    moveStepDebug.collisionZ = collisionResolved.origin[2];
    moveStepDebug.dt = dt;
    moveStepDebug.groundedForPhysics = groundedForPhysics;
    moveStepDebug.groundSnapZ = snapGroundZ;
    moveStepDebug.physicsGrounded = physicsGrounded;
    moveStepDebug.physicsVelocityZ = moveVelocity[2];
    moveStepDebug.resolvedGrounded = resolved.grounded;
    moveStepDebug.resolvedZ = resolved.origin[2];
    moveStepDebug.targetZ = target[2];
    moveStepDebug.upwardGroundSnapIgnored = upwardGroundSnapIgnored;
    lastMoveStepDebug = moveStepDebug;
    const intendedDeltaZ = target[2] - origin[2];
    const actualDeltaX = resolved.origin[0] - origin[0];
    const actualDeltaY = resolved.origin[1] - origin[1];
    const actualDeltaZ = resolved.origin[2] - origin[2];
    if (dt > 0) {
      moveVelocity[0] = actualDeltaX / dt;
      moveVelocity[1] = actualDeltaY / dt;
    }
    if (resolved.grounded) {
      moveVelocity[2] = 0;
    } else if (moveVelocity[2] > 0 && actualDeltaZ < intendedDeltaZ * 0.25) {
      moveVelocity[2] = 0;
    }

    applyCollisionResult(resolved, origin, false);
    if (moveFrame === null && hasMoveMotion()) scheduleMoveFrame();
  };

  const syncCollision = (): void => {
    if (dead) return;
    const collisionWorld = options.getCollisionWorld();
    if (syncingCollision || moveFrame !== null || pushFrame !== null || fallingFrame !== null || !collisionWorld) return;
    const origin = options.controls.getOrigin();
    const resolved = options.resolveShootablesCollision(
      collisionWorld.resolve(origin, lastValidOrigin, currentEyeHeight, currentGroundZ, !currentGrounded),
      lastValidOrigin,
      currentEyeHeight,
    );
    applyCollisionResult(resolved, origin);
  };

  function applyCollisionResult(
    resolved: { origin: [number, number, number]; groundZ: number; grounded: boolean; touches?: QuakeTouchedTrigger[] },
    previousOrigin: [number, number, number],
    jumpEnabled = false,
  ): void {
    const moved = distanceSq3(previousOrigin, resolved.origin) > COLLISION_EPSILON;
    const groundChanged = Math.abs(resolved.groundZ - currentGroundZ) > COLLISION_EPSILON;
    const groundedChanged = currentGrounded !== resolved.grounded;

    currentGrounded = resolved.grounded;
    if (resolved.grounded) {
      stopFalling();
    } else if (pushFrame === null) {
      scheduleMoveFrame();
    }

    if (moved || groundChanged || groundedChanged) {
      setOrigin(resolved.origin, resolved.groundZ, jumpEnabled, resolved.grounded);
    } else {
      lastValidOrigin = resolved.origin;
    }

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
  }

  const scheduleHazardTick = (delay: number): void => {
    if (hazardTimer !== null) return;
    hazardTimer = window.setTimeout(() => {
      hazardTimer = null;
      if (!options.getCollisionWorld()) return;
      options.syncHazards(lastValidOrigin);
    }, Math.max(0, delay));
  };

  const syncHazard = (hazard: QuakeHazardDamage | null): boolean => {
    if (dead) {
      clearHazardTimer();
      options.onHazardState(null);
      return false;
    }
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
    clearMoveInput();
    stopMoveFrame();
    moveVelocity = [0, 0, 0];
    stopFalling();
    stopPush();
    options.controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
    options.controls.unlock();
  };

  const push = (velocity: Vec3): boolean => {
    if (dead) return false;
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
    stopMoveFrame();
    stopFalling();
    syncingCollision = true;
    options.controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
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
    options.controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
    syncingCollision = false;
    if (hasMoveMotion()) scheduleMoveFrame();
  }

  const startFalling = (): void => {
    if (fallingFrame !== null || pushFrame !== null || !options.getCollisionWorld()) return;
    fallingTime = 0;
    fallingVelocity = 0;
    syncingCollision = true;
    options.controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
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
    options.controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
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
    currentGrounded = landed;
    const controlsGroundZ = landed ? currentGroundZ : origin[2] - currentEyeHeight;
    playerControlUpdate.groundZ = controlsGroundZ;
    playerControlUpdate.eyeHeight = currentEyeHeight;
    playerControlUpdate.jumpVelocity = options.jumpVelocity;
    options.controls.update(playerControlUpdate);
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
    if (dead) return;
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
    clearMoveInput,
    clearLevelState,
    currentGroundEntity: () => lastGroundEntityIndex,
    currentOrigin: () => lastValidOrigin,
    damage: applyDamage,
    debugMovement,
    eyeHeight: () => currentEyeHeight,
    handleMoveKey,
    inventory: () => inventory,
    isCrouching: () => currentCrouching,
    isDead: () => dead,
    push,
    resetInventory,
    resetForSceneDispose,
    respawn,
    spawn,
    setAnalogMove,
    setCrouching,
    setDebugOrigin,
    syncCollision,
    syncHazard,
    teleportTo,
  };
}
