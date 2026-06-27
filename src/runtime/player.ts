import type { PolyFirstPersonControlsHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity, QuakeScene } from "../types/quake";
import type { QuakeCollisionWorld, QuakeTouchedTrigger } from "./collision";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  QUAKE_CROUCH_EYE_HEIGHT,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  STEP_HEIGHT,
} from "./constants";
import {
  QUAKE_CONTENTS_WATER,
  quakePlayerWaterLevel,
  type QuakeHazardDamage,
} from "./hazards";
import { markQuakeTrace } from "./debug/traceMarks";
import {
  applyQuakeDamageToInventory,
  createInitialInventory,
  type QuakeInventoryPowerupState,
  type QuakeKey,
  type QuakePlayerInventory,
  type QuakeWeaponId,
} from "./hud";
import { distanceSq3, subtractVec3 } from "./math";
import {
  QUAKE_PMOVE_BACK_SPEED,
  QUAKE_PMOVE_DT_CLAMP,
  QUAKE_PMOVE_EDGE_DISTANCE,
  QUAKE_PMOVE_EDGE_DROP,
  QUAKE_PMOVE_EDGE_FRICTION,
  QUAKE_PMOVE_FORWARD_SPEED,
  QUAKE_PMOVE_SIDE_SPEED,
  QUAKE_PMOVE_SPEED_KEY_MULTIPLIER,
  quakePlayerFallDamageFromVelocityZ,
  updateQuakePlayerPhysics,
  type QuakePlayerMoveCommand,
  type QuakePlayerWaterMoveState,
} from "./playerPhysics";

const FALL_DT_CLAMP = 0.05;
const PUSH_DT_CLAMP = 0.035;
const PUSH_AIR_DRAG = 0.08;
const PUSH_GROUND_FRICTION = 5.5;
// Quake clamps trigger_push impulses through the default sv_maxvelocity cap.
const PUSH_MAX_SPEED = 2000 * QUAKE_COLLISION_UNIT_SCALE;
const PUSH_STOP_SPEED = 16 * QUAKE_COLLISION_UNIT_SCALE;
const DEATH_TOSS_DT_CLAMP = 0.05;
const DEATH_TOSS_MAX_MS = 1400;
const DEATH_TOSS_STOP_SPEED = 8 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PLAYER_DEATH_EYE_HEIGHT = 16 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_DAMAGE_INTERVAL_MS = 1000;
const QUAKE_LAVA_DAMAGE_INTERVAL_MS = 200;
const QUAKE_LAVA_RADSUIT_DAMAGE_INTERVAL_MS = 1000;
const QUAKE_DAMAGE_FLASH_MS = 260;
const PLAYER_MOVE_STOP_SPEED = 1 * QUAKE_COLLISION_UNIT_SCALE;
const PLAYER_MOVE_STOP_SPEED_SQ = PLAYER_MOVE_STOP_SPEED * PLAYER_MOVE_STOP_SPEED;
const PLAYER_MOVE_ANALOG_DEADZONE = 0.001;
const QUAKE_FORWARD_KEY_CODES = new Set(["ArrowUp", "KeyW"]);
const QUAKE_BACK_KEY_CODES = new Set(["ArrowDown", "KeyS"]);
const QUAKE_LEFT_KEY_CODES = new Set(["ArrowLeft", "KeyA"]);
const QUAKE_RIGHT_KEY_CODES = new Set(["ArrowRight", "KeyD"]);
const QUAKE_JUMP_KEY_CODES = new Set(["Space"]);
const QUAKE_SPEED_KEY_CODES = new Set(["ShiftLeft", "ShiftRight"]);
const QUAKE_MOVE_FORWARD_BIT = 1 << 0;
const QUAKE_MOVE_BACK_BIT = 1 << 1;
const QUAKE_MOVE_LEFT_BIT = 1 << 2;
const QUAKE_MOVE_RIGHT_BIT = 1 << 3;
const QUAKE_MOVE_JUMP_BIT = 1 << 4;
const QUAKE_MOVE_SPEED_BIT = 1 << 5;
const QUAKE_MOVE_DIRECTION_BITS =
  QUAKE_MOVE_FORWARD_BIT |
  QUAKE_MOVE_BACK_BIT |
  QUAKE_MOVE_LEFT_BIT |
  QUAKE_MOVE_RIGHT_BIT;
const QUAKE_PLAYER_PROGRESS_WEAPONS: readonly QuakeWeaponId[] = [
  "axe",
  "shotgun",
  "supershotgun",
  "nailgun",
  "supernailgun",
  "grenadelauncher",
  "rocketlauncher",
  "lightning",
];
const QUAKE_PLAYER_PROGRESS_KEYS: readonly QuakeKey[] = ["silver", "gold"];
const QUAKE_PLAYER_PROGRESS_WEAPON_SET = new Set<QuakeWeaponId>(QUAKE_PLAYER_PROGRESS_WEAPONS);
const QUAKE_PLAYER_PROGRESS_KEY_SET = new Set<QuakeKey>(QUAKE_PLAYER_PROGRESS_KEYS);

export const QUAKE_PLAYER_DEATH_SOUND_PATHS = [
  "player/death1.wav",
  "player/death2.wav",
  "player/death3.wav",
  "player/death4.wav",
  "player/death5.wav",
] as const;

export const QUAKE_PLAYER_GIB_SOUND_PATHS = [
  "player/gib.wav",
  "player/udeath.wav",
] as const;

export type QuakePlayerDeathRandomLabel =
  | "DeathSound"
  | "GibPlayer.sound"
  | "PlayerDie.animation"
  | "PlayerDie.velocity_z";

function quakeMoveKeyBit(code: string): number {
  if (QUAKE_FORWARD_KEY_CODES.has(code)) return QUAKE_MOVE_FORWARD_BIT;
  if (QUAKE_BACK_KEY_CODES.has(code)) return QUAKE_MOVE_BACK_BIT;
  if (QUAKE_LEFT_KEY_CODES.has(code)) return QUAKE_MOVE_LEFT_BIT;
  if (QUAKE_RIGHT_KEY_CODES.has(code)) return QUAKE_MOVE_RIGHT_BIT;
  if (QUAKE_JUMP_KEY_CODES.has(code)) return QUAKE_MOVE_JUMP_BIT;
  if (QUAKE_SPEED_KEY_CODES.has(code)) return QUAKE_MOVE_SPEED_BIT;
  return 0;
}

function quakeFiniteProgressNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function quakeProgressVec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? [value[0], value[1], value[2]]
    : [...fallback] as [number, number, number];
}

function quakeProgressWeapon(value: unknown, fallback: QuakeWeaponId): QuakeWeaponId {
  if (typeof value !== "string") return fallback;
  return QUAKE_PLAYER_PROGRESS_WEAPON_SET.has(value as QuakeWeaponId)
    ? value as QuakeWeaponId
    : fallback;
}

function quakeProgressWeaponList(values: unknown): QuakeWeaponId[] {
  if (!Array.isArray(values)) return [];
  const out: QuakeWeaponId[] = [];
  for (const value of values) {
    const weapon = quakeProgressWeapon(value, "axe");
    if (!out.includes(weapon)) out.push(weapon);
  }
  return out;
}

function quakeProgressKeyList(values: unknown): QuakeKey[] {
  if (!Array.isArray(values)) return [];
  const out: QuakeKey[] = [];
  for (const value of values) {
    const key = value as QuakeKey;
    if (QUAKE_PLAYER_PROGRESS_KEY_SET.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
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
  alwaysRun?: () => boolean;
  isGameplayPaused?: () => boolean;
  isInvulnerable?: () => boolean;
  jumpVelocity: number;
  onHazardDamage?: (hazard: QuakeHazardDamage) => boolean;
  onDamageFlash: (active: boolean, feedback?: QuakePlayerDamageFeedback) => void;
  onDeath: (details: QuakePlayerDeathDetails) => QuakePlayerDeathResult | void;
  onHazardState: (kind: QuakeHazardDamage["kind"] | null) => void;
  onInventoryChanged: () => void;
  onRespawn: (scene: QuakeScene, origin: [number, number, number]) => void;
  pointToPoly: (point: { x: number; y: number; z: number }) => Vec3;
  resolveShootablesCollision: (
    result: { origin: [number, number, number]; groundZ: number; grounded: boolean; touches?: QuakeTouchedTrigger[] },
    previous: [number, number, number],
    eyeHeight: number,
    validateOrigin?: (origin: [number, number, number]) => boolean,
  ) => { origin: [number, number, number]; groundZ: number; grounded: boolean; touches?: QuakeTouchedTrigger[] };
  syncCrosshairTarget: () => void;
  syncHazards: (origin?: [number, number, number], triggers?: QuakeTouchedTrigger[]) => boolean;
  syncCamera: (origin: [number, number, number], mode: "move" | "reset" | "smooth-step") => void;
  syncPickups: (origin: [number, number, number], eyeHeight: number) => void;
  syncTouchedTriggers: (origin: [number, number, number]) => QuakeTouchedTrigger[];
  syncViewmodel: () => void;
  syncWorldVisibility: (force?: boolean) => void;
  transitionSerial: () => number;
  quakecRandom?: (label: QuakePlayerDeathRandomLabel) => number;
}

export interface QuakePlayerController {
  carryWithMover: (delta: Vec3, entityIndex: number) => void;
  clearMoveInput: () => void;
  clearLevelState: () => void;
  currentGroundEntity: () => number | null;
  currentOrigin: () => [number, number, number];
  damage: (amount: number, context?: QuakePlayerDamageContext) => boolean;
  debugMovement: () => QuakePlayerMovementDebug;
  eyeHeight: () => number;
  handleMoveKey: (code: string, pressed: boolean) => boolean;
  inventory: () => QuakePlayerInventory;
  isCrouching: () => boolean;
  isDead: () => boolean;
  push: (velocity: Vec3) => boolean;
  resetInventory: () => void;
  resetForSceneDispose: () => void;
  restoreProgress: (snapshot: QuakePlayerProgressSnapshot) => void;
  respawn: () => void;
  snapshotProgress: () => QuakePlayerProgressSnapshot;
  spawn: (spawn: QuakeScene["spawn"]) => void;
  setAnalogMove: (x: number, y: number) => void;
  setAuthoritativeOrigin: (origin: [number, number, number]) => void;
  setCrouching: (crouching: boolean) => void;
  setDebugOrigin: (origin: [number, number, number]) => void;
  syncCollision: () => void;
  syncHazard: (hazard: QuakeHazardDamage | null) => boolean;
  teleportTo: (destination: QuakeEntity) => boolean;
}

export interface QuakePlayerDamageFeedback {
  amount: number;
}

export interface QuakePlayerDamageContext {
  inflictorOrigin?: Vec3 | null;
}

export interface QuakePlayerDeathRandomDraw {
  label: QuakePlayerDeathRandomLabel;
  value: number;
}

export interface QuakePlayerDeathDetails {
  animationRandom: number | null;
  deathEyeHeight: number;
  gibbed: boolean;
  health: number;
  randomDraws: QuakePlayerDeathRandomDraw[];
  soundPath: string | null;
  soundRandom: number | null;
  tossRandom: number | null;
  tossStarted: boolean;
  tossVelocity: Vec3;
  velocityBeforeDeath: Vec3;
}

export interface QuakePlayerDeathResult {
  soundPlayed?: boolean;
}

export interface QuakeInventoryPowerupProgressSnapshot {
  active: true;
  activationField: string;
  itemFlag: number;
  itemFlagExpression: string;
  itemFlagMutation?: QuakeInventoryPowerupState["itemFlagMutation"];
  remainingMs: number;
}

export interface QuakePlayerInventoryProgressSnapshot {
  health: number;
  armor: number;
  armorType: number;
  itemFlags: number;
  activeWeapon: QuakeWeaponId;
  weapons: QuakeWeaponId[];
  shells: number;
  nails: number;
  rockets: number;
  cells: number;
  keys: QuakeKey[];
  powerups: Record<string, QuakeInventoryPowerupProgressSnapshot>;
}

export interface QuakePlayerProgressSnapshot {
  crouching: boolean;
  eyeHeight: number;
  grounded: boolean;
  groundZ: number;
  inventory: QuakePlayerInventoryProgressSnapshot;
  lastGroundEntityIndex: number | null;
  origin: [number, number, number];
}

export interface QuakePlayerMovementDebug {
  analogX: number;
  currentGroundEntity: number | null;
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
  let fallDamageVelocityZ = 0;
  let pushFrame: number | null = null;
  let pushTime = 0;
  let pushVelocity: Vec3 = [0, 0, 0];
  let deathTossFrame: number | null = null;
  let deathTossTime = 0;
  let deathTossStartedAt = 0;
  let deathTossVelocity: Vec3 = [0, 0, 0];
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
  let lastMoveWaterLevel = 0;
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

  const gameplayPaused = (): boolean => options.isGameplayPaused?.() === true;

  const resetInventory = (): void => {
    inventory = createInitialInventory();
    options.onInventoryChanged();
  };

  const snapshotInventoryProgress = (): QuakePlayerInventoryProgressSnapshot => {
    const now = performance.now();
    const powerups: Record<string, QuakeInventoryPowerupProgressSnapshot> = {};
    for (const [finishedField, state] of Object.entries(inventory.powerups)) {
      const remainingMs = Math.max(0, state.finishedAt - now);
      if (remainingMs <= 0) continue;
      powerups[finishedField] = {
        active: true,
        activationField: state.activationField,
        itemFlag: state.itemFlag,
        itemFlagExpression: state.itemFlagExpression,
        ...(state.itemFlagMutation ? { itemFlagMutation: state.itemFlagMutation } : {}),
        remainingMs,
      };
    }
    return {
      health: inventory.health,
      armor: inventory.armor,
      armorType: inventory.armorType,
      itemFlags: inventory.itemFlags,
      activeWeapon: inventory.activeWeapon,
      weapons: [...inventory.weapons],
      shells: inventory.shells,
      nails: inventory.nails,
      rockets: inventory.rockets,
      cells: inventory.cells,
      keys: [...inventory.keys],
      powerups,
    };
  };

  const restoreInventoryProgress = (snapshot?: Partial<QuakePlayerInventoryProgressSnapshot>): QuakePlayerInventory => {
    const next = createInitialInventory();
    next.health = quakeFiniteProgressNumber(snapshot?.health, next.health);
    next.armor = quakeFiniteProgressNumber(snapshot?.armor, next.armor);
    next.armorType = quakeFiniteProgressNumber(snapshot?.armorType, next.armorType);
    next.itemFlags = quakeFiniteProgressNumber(snapshot?.itemFlags, next.itemFlags);
    next.shells = quakeFiniteProgressNumber(snapshot?.shells, next.shells);
    next.nails = quakeFiniteProgressNumber(snapshot?.nails, next.nails);
    next.rockets = quakeFiniteProgressNumber(snapshot?.rockets, next.rockets);
    next.cells = quakeFiniteProgressNumber(snapshot?.cells, next.cells);
    next.weapons = new Set(quakeProgressWeaponList(snapshot?.weapons));
    if (next.weapons.size === 0) {
      next.weapons.add("axe");
      next.weapons.add("shotgun");
    }
    next.activeWeapon = quakeProgressWeapon(snapshot?.activeWeapon, next.activeWeapon);
    if (!next.weapons.has(next.activeWeapon)) next.weapons.add(next.activeWeapon);
    next.keys = new Set(quakeProgressKeyList(snapshot?.keys));
    const now = performance.now();
    next.powerups = {};
    for (const [finishedField, state] of Object.entries(snapshot?.powerups ?? {})) {
      const powerup = state as Partial<QuakeInventoryPowerupProgressSnapshot>;
      if (!powerup || powerup.active !== true || !Number.isFinite(powerup.remainingMs) || (powerup.remainingMs ?? 0) <= 0) continue;
      next.powerups[finishedField] = {
        active: true,
        activationField: typeof powerup.activationField === "string" ? powerup.activationField : "",
        finishedAt: now + (powerup.remainingMs ?? 0),
        itemFlag: quakeFiniteProgressNumber(powerup.itemFlag, 0),
        itemFlagExpression: typeof powerup.itemFlagExpression === "string" ? powerup.itemFlagExpression : "",
        ...(powerup.itemFlagMutation ? { itemFlagMutation: powerup.itemFlagMutation } : {}),
      };
    }
    return next;
  };

  const snapshotProgress = (): QuakePlayerProgressSnapshot => ({
    crouching: currentCrouching,
    eyeHeight: currentEyeHeight,
    grounded: currentGrounded,
    groundZ: currentGroundZ,
    inventory: snapshotInventoryProgress(),
    lastGroundEntityIndex,
    origin: [...lastValidOrigin] as [number, number, number],
  });

  const restoreProgress = (snapshot: QuakePlayerProgressSnapshot): void => {
    dead = false;
    clearHazardTimer();
    clearDamageFlash();
    clearMoveInput();
    stopMoveFrame();
    moveVelocity = [0, 0, 0];
    fallDamageVelocityZ = 0;
    lastMoveWaterLevel = 0;
    stopFalling();
    stopPush();
    stopDeathToss();
    moveTime = 0;
    nextDamageAt = performance.now() + QUAKE_DAMAGE_INTERVAL_MS;
    currentEyeHeight = Math.max(0.1, quakeFiniteProgressNumber(snapshot.eyeHeight, standingEyeHeight));
    currentCrouching = Boolean(snapshot.crouching);
    currentGrounded = snapshot.grounded !== false;
    lastGroundEntityIndex = Number.isInteger(snapshot.lastGroundEntityIndex) ? snapshot.lastGroundEntityIndex : null;
    inventory = restoreInventoryProgress(snapshot.inventory);
    options.onHazardState(null);
    const origin = quakeProgressVec3(snapshot.origin, lastValidOrigin);
    const groundZ = quakeFiniteProgressNumber(snapshot.groundZ, origin[2] - currentEyeHeight);
    setOrigin(origin, groundZ, true, currentGrounded, "reset");
    options.onInventoryChanged();
    options.syncViewmodel();
    options.syncWorldVisibility(true);
    options.syncCrosshairTarget();
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
    stopDeathToss();
    inventory = createInitialInventory();
    standingEyeHeight = 1.72;
    currentEyeHeight = standingEyeHeight;
    currentCrouching = false;
    currentGrounded = true;
    lastMoveWaterLevel = 0;
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
    stopDeathToss();
    moveVelocity = [0, 0, 0];
    const collisionWorld = options.getCollisionWorld();
    standingEyeHeight = spawn.eyeHeight;
    currentEyeHeight = standingEyeHeight;
    currentCrouching = false;
    lastMoveWaterLevel = 0;
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
    stopDeathToss();

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
    stopDeathToss();
    setOrigin(origin, origin[2] - currentEyeHeight);
  };

  const setAuthoritativeOrigin = (origin: [number, number, number]): void => {
    moveVelocity = [0, 0, 0];
    stopFalling();
    stopPush();
    stopDeathToss();
    setOrigin(origin, origin[2] - currentEyeHeight, true, true, "smooth-step");
    if (hasMoveInput()) scheduleMoveFrame();
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
      currentGroundEntity: lastGroundEntityIndex,
      grounded: currentGrounded,
    groundZ: currentGroundZ,
    jumpQueued,
    jumpReleased,
    keys: [...moveKeyCodesDown],
    moveFrameActive: moveFrame !== null,
    lastStep: lastMoveStepDebug,
    velocity: [...moveVelocity] as Vec3,
  });

  const applyDamage = (amount: number, context: QuakePlayerDamageContext = {}): boolean => {
    if (amount <= 0 || dead || !options.canTakeDamage()) return false;
    const invulnerable = options.isInvulnerable?.() === true;
    // QuakeC T_Damage computes armor save before invulnerability blocks health damage.
    const damage = applyQuakeDamageToInventory(inventory, amount, { applyHealth: !invulnerable });
    applyDamageMomentum(damage.rawDamage, context);
    if (invulnerable) {
      markQuakeTrace("player-damage-blocked", {
        amount: damage.rawDamage,
        armor: inventory.armor,
        armorDamage: damage.armorDamage,
        armorType: inventory.armorType,
        reason: "invulnerability",
      });
    }
    if (!damage.changed) return false;
    markQuakeTrace("player-damage", {
      amount: damage.rawDamage,
      armor: inventory.armor,
      armorDamage: damage.armorDamage,
      armorType: inventory.armorType,
      blockedHealthDamage: invulnerable,
      health: inventory.health,
      healthDamage: damage.healthDamage,
      died: inventory.health <= 0,
    });
    options.onInventoryChanged();
    if (invulnerable) return false;
    flashDamage({ amount: damage.rawDamage });
    if (inventory.health > 0) return false;
    enterDeath();
    return true;
  };

  const applyDamageMomentum = (amount: number, context: QuakePlayerDamageContext): void => {
    const impulse = quakePlayerDamageMomentumImpulse(playerQuakeEntityOrigin(), context.inflictorOrigin ?? null, amount);
    if (!impulse) return;
    if (fallingFrame !== null) stopFalling();
    moveVelocity[0] += impulse[0];
    moveVelocity[1] += impulse[1];
    moveVelocity[2] += impulse[2];
    if (impulse[2] > 0) currentGrounded = false;
    markQuakeTrace("player-damage-momentum", {
      amount,
      inflictorX: context.inflictorOrigin?.[0] ?? null,
      inflictorY: context.inflictorOrigin?.[1] ?? null,
      inflictorZ: context.inflictorOrigin?.[2] ?? null,
      vx: impulse[0],
      vy: impulse[1],
      vz: impulse[2],
    });
    if (pushFrame === null) scheduleMoveFrame();
  };

  const playerQuakeEntityOrigin = (): Vec3 => [
    lastValidOrigin[0],
    lastValidOrigin[1],
    lastValidOrigin[2] - currentEyeHeight - QUAKE_PLAYER_MINS_Z,
  ];

  const createDeathDetails = (
    health: number,
    velocityBeforeDeath: Vec3,
  ): QuakePlayerDeathDetails => {
    const randomDraws: QuakePlayerDeathRandomDraw[] = [];
    const nextDeathRandom = (label: QuakePlayerDeathRandomLabel): number => {
      const value = quakeNormalizedRandom(options.quakecRandom?.(label) ?? Math.random());
      randomDraws.push({ label, value });
      return value;
    };
    const tossRandom = quakePlayerDeathNeedsTossRandom(velocityBeforeDeath)
      ? nextDeathRandom("PlayerDie.velocity_z")
      : null;
    const tossVelocity = quakePlayerDeathTossVelocity(velocityBeforeDeath, tossRandom);
    const gibbed = health < -40;
    const soundRandom = nextDeathRandom(gibbed ? "GibPlayer.sound" : "DeathSound");
    const soundPath = gibbed
      ? quakePlayerGibSoundPathFromRandom(soundRandom)
      : quakePlayerDeathSoundPathFromRandom(soundRandom);
    const animationRandom = gibbed ? null : nextDeathRandom("PlayerDie.animation");
    return {
      animationRandom,
      deathEyeHeight: QUAKE_PLAYER_DEATH_EYE_HEIGHT,
      gibbed,
      health,
      randomDraws,
      soundPath,
      soundRandom,
      tossRandom,
      tossStarted: false,
      tossVelocity,
      velocityBeforeDeath: [...velocityBeforeDeath] as Vec3,
    };
  };

  const applyDeathEyeHeight = (deathEyeHeight: number): void => {
    const origin = options.controls.getOrigin();
    const footZ = origin[2] - currentEyeHeight;
    currentEyeHeight = Math.max(0.1, deathEyeHeight);
    setOrigin([origin[0], origin[1], footZ + currentEyeHeight], footZ, false, currentGrounded, "move");
  };

  const enterDeath = (): void => {
    if (dead) return;
    dead = true;
    const velocityBeforeDeath = [...moveVelocity] as Vec3;
    const deathDetails = createDeathDetails(inventory.health, velocityBeforeDeath);
    clearHazardTimer();
    clearMoveInput();
    stopMoveFrame();
    stopFalling();
    stopPush();
    moveVelocity = [0, 0, 0];
    options.onHazardState(null);
    options.controls.update({ lookEnabled: false, moveEnabled: false, jumpEnabled: false, gravity: 0 });
    applyDeathEyeHeight(deathDetails.deathEyeHeight);
    deathDetails.tossStarted = startDeathToss(deathDetails.tossVelocity);
    const deathResult = options.onDeath(deathDetails) ?? {};
    markQuakeTrace("player-death", {
      animationRandom: deathDetails.animationRandom,
      deathEyeHeight: deathDetails.deathEyeHeight,
      gibbed: deathDetails.gibbed,
      health: deathDetails.health,
      soundPath: deathDetails.soundPath,
      soundPlayed: deathResult.soundPlayed === true,
      soundRandom: deathDetails.soundRandom,
      tossRandom: deathDetails.tossRandom,
      tossStarted: deathDetails.tossStarted,
      tossVelocityZ: deathDetails.tossVelocity[2],
      velocityBeforeDeathZ: deathDetails.velocityBeforeDeath[2],
    });
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
    stopDeathToss();
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
      jumpQueued ||
      (lastMoveWaterLevel >= 2 && Boolean(moveKeyBits & QUAKE_MOVE_JUMP_BIT));
  }

  function hasDirectionalMoveInput(): boolean {
    return (moveKeyBits & QUAKE_MOVE_DIRECTION_BITS) !== 0;
  }

  function hasMoveMotion(): boolean {
    return (!currentGrounded && lastMoveWaterLevel < 2) ||
      moveVelocity[0] * moveVelocity[0] + moveVelocity[1] * moveVelocity[1] > PLAYER_MOVE_STOP_SPEED_SQ ||
      Math.abs(moveVelocity[2]) > PLAYER_MOVE_STOP_SPEED ||
      hasMoveInput();
  }

  function updateCurrentMoveCommand(waterLevel = lastMoveWaterLevel): QuakePlayerMoveCommand {
    let forwardMove = 0;
    let sideMove = 0;
    if (moveKeyBits & QUAKE_MOVE_FORWARD_BIT) forwardMove += QUAKE_PMOVE_FORWARD_SPEED;
    if (moveKeyBits & QUAKE_MOVE_BACK_BIT) forwardMove -= QUAKE_PMOVE_BACK_SPEED;
    if (moveKeyBits & QUAKE_MOVE_RIGHT_BIT) sideMove += QUAKE_PMOVE_SIDE_SPEED;
    if (moveKeyBits & QUAKE_MOVE_LEFT_BIT) sideMove -= QUAKE_PMOVE_SIDE_SPEED;
    forwardMove += moveAnalogY >= 0
      ? moveAnalogY * QUAKE_PMOVE_FORWARD_SPEED
      : moveAnalogY * QUAKE_PMOVE_BACK_SPEED;
    sideMove += moveAnalogX * QUAKE_PMOVE_SIDE_SPEED;
    if (Boolean(moveKeyBits & QUAKE_MOVE_SPEED_BIT) !== (options.alwaysRun?.() === true)) {
      forwardMove *= QUAKE_PMOVE_SPEED_KEY_MULTIPLIER;
      sideMove *= QUAKE_PMOVE_SPEED_KEY_MULTIPLIER;
    }
    moveCommand.forwardMove = forwardMove;
    moveCommand.jump = jumpQueued || (waterLevel >= 2 && Boolean(moveKeyBits & QUAKE_MOVE_JUMP_BIT));
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
    const wasGroundedAtTickStart = currentGrounded;
    const origin = options.controls.getOrigin();
    const footZ = origin[2] - currentEyeHeight;
    const waterMove = quakePlayerCurrentWaterMove(collisionWorld, origin);
    lastMoveWaterLevel = waterMove.waterLevel ?? 0;
    const snapGroundZ = !currentGrounded && moveVelocity[2] <= 0
      ? collisionWorld.floorAt(origin[0], origin[1], footZ + GROUND_SNAP, footZ - GROUND_SNAP)
      : null;
    const groundedForPhysics = currentGrounded || snapGroundZ !== null;
    if (snapGroundZ !== null) currentGroundZ = snapGroundZ;
    currentGrounded = groundedForPhysics;
    const command = updateCurrentMoveCommand(waterMove.waterLevel ?? 0);
    jumpQueued = false;
    const frictionScale = groundedForPhysics
      ? quakePlayerEdgeFriction(collisionWorld, origin, currentEyeHeight, moveVelocity)
      : 1;
    const physicsGrounded = updateQuakePlayerPhysics(
      moveVelocity,
      command,
      groundedForPhysics,
      dt,
      options.gravity,
      options.jumpVelocity,
      frictionScale,
      waterMove,
    );
    currentGrounded = physicsGrounded;

    const target: [number, number, number] = [
      origin[0] + moveVelocity[0] * dt,
      origin[1] + moveVelocity[1] * dt,
      origin[2] + moveVelocity[2] * dt,
    ];
    const collisionResolved = collisionWorld.resolve(target, origin, currentEyeHeight, currentGroundZ, !physicsGrounded);
    let resolved = resolveDynamicCollision(
      collisionWorld,
      collisionResolved,
      origin,
      !physicsGrounded,
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
    moveStepDebug.frictionScale = frictionScale;
    moveStepDebug.physicsGrounded = physicsGrounded;
    moveStepDebug.physicsVelocityZ = moveVelocity[2];
    moveStepDebug.resolvedGrounded = resolved.grounded;
    moveStepDebug.resolvedZ = resolved.origin[2];
    moveStepDebug.targetZ = target[2];
    moveStepDebug.upwardGroundSnapIgnored = upwardGroundSnapIgnored;
    moveStepDebug.waterContents = waterMove.contents ?? null;
    moveStepDebug.waterLevel = waterMove.waterLevel ?? 0;
    lastMoveStepDebug = moveStepDebug;
    const intendedDeltaZ = target[2] - origin[2];
    const actualDeltaX = resolved.origin[0] - origin[0];
    const actualDeltaY = resolved.origin[1] - origin[1];
    const actualDeltaZ = resolved.origin[2] - origin[2];
    if (dt > 0) {
      moveVelocity[0] = actualDeltaX / dt;
      moveVelocity[1] = actualDeltaY / dt;
    }
    const landingVelocityZ = !wasGroundedAtTickStart && resolved.grounded
      ? (moveVelocity[2] < 0 ? moveVelocity[2] : fallDamageVelocityZ)
      : 0;
    if (resolved.grounded) {
      moveVelocity[2] = 0;
    } else if (moveVelocity[2] > 0 && actualDeltaZ < intendedDeltaZ * 0.25) {
      moveVelocity[2] = 0;
    }
    if (!resolved.grounded) rememberFallDamageVelocity(moveVelocity[2]);

    applyCollisionResult(resolved, origin, false, landingVelocityZ);
    if (moveFrame === null && hasMoveMotion()) scheduleMoveFrame();
  };

  function quakePlayerCurrentWaterMove(
    collisionWorld: QuakeCollisionWorld,
    origin: [number, number, number],
  ): QuakePlayerWaterMoveState {
    const contentsAt = collisionWorld.contentsAt;
    if (!contentsAt) return { contents: null, waterLevel: 0 };
    const waterLevel = quakePlayerWaterLevel(contentsAt, origin, currentEyeHeight);
    if (waterLevel <= 0) return { contents: null, waterLevel: 0 };
    const footZ = origin[2] - currentEyeHeight;
    const contents = contentsAt([origin[0], origin[1], footZ + QUAKE_COLLISION_UNIT_SCALE]) ?? null;
    return { contents, waterLevel };
  }

  function quakePlayerEdgeFriction(
    collisionWorld: QuakeCollisionWorld,
    origin: [number, number, number],
    eyeHeight: number,
    velocity: Vec3,
  ): number {
    const speed = Math.hypot(velocity[0], velocity[1]);
    if (speed <= COLLISION_EPSILON) return 1;
    const footZ = origin[2] - eyeHeight;
    const edgeX = origin[0] + (velocity[0] / speed) * QUAKE_PMOVE_EDGE_DISTANCE;
    const edgeY = origin[1] + (velocity[1] / speed) * QUAKE_PMOVE_EDGE_DISTANCE;
    const floorZ = collisionWorld.floorAt(edgeX, edgeY, footZ + COLLISION_EPSILON, footZ - QUAKE_PMOVE_EDGE_DROP);
    return floorZ === null ? QUAKE_PMOVE_EDGE_FRICTION : 1;
  }

  const syncCollision = (): void => {
    if (dead) return;
    const collisionWorld = options.getCollisionWorld();
    if (gameplayPaused()) return;
    if (syncingCollision || moveFrame !== null || pushFrame !== null || fallingFrame !== null || !collisionWorld) return;
    const origin = options.controls.getOrigin();
    const resolved = resolveDynamicCollision(
      collisionWorld,
      collisionWorld.resolve(origin, lastValidOrigin, currentEyeHeight, currentGroundZ, !currentGrounded),
      lastValidOrigin,
      !currentGrounded,
    );
    applyCollisionResult(resolved, origin);
  };

  function resolveDynamicCollision(
    collisionWorld: QuakeCollisionWorld,
    resolved: { origin: [number, number, number]; groundZ: number; grounded: boolean; touches?: QuakeTouchedTrigger[] },
    previous: [number, number, number],
    forceAir = false,
  ): { origin: [number, number, number]; groundZ: number; grounded: boolean; touches?: QuakeTouchedTrigger[] } {
    const dynamicResolved = options.resolveShootablesCollision(
      resolved,
      previous,
      currentEyeHeight,
      (origin) => distanceSq3(
        collisionWorld.resolve(origin, previous, currentEyeHeight, resolved.groundZ, forceAir).origin,
        origin,
      ) <= COLLISION_EPSILON,
    );
    if (distanceSq3(dynamicResolved.origin, resolved.origin) <= COLLISION_EPSILON) return dynamicResolved;
    return collisionWorld.resolve(
      dynamicResolved.origin,
      previous,
      currentEyeHeight,
      dynamicResolved.groundZ,
      forceAir,
    );
  }

  function applyCollisionResult(
    resolved: { origin: [number, number, number]; groundZ: number; grounded: boolean; touches?: QuakeTouchedTrigger[] },
    previousOrigin: [number, number, number],
    jumpEnabled = false,
    landingVelocityZ = 0,
  ): void {
    const moved = distanceSq3(previousOrigin, resolved.origin) > COLLISION_EPSILON;
    const groundDelta = resolved.groundZ - currentGroundZ;
    const groundChanged = Math.abs(groundDelta) > COLLISION_EPSILON;
    const groundedChanged = currentGrounded !== resolved.grounded;
    const cameraMode = currentGrounded &&
      resolved.grounded &&
      groundChanged &&
      groundDelta > COLLISION_EPSILON &&
      groundDelta <= STEP_HEIGHT + GROUND_SNAP
      ? "smooth-step"
      : "move";

    currentGrounded = resolved.grounded;
    if (resolved.grounded) {
      stopFalling();
    } else if (pushFrame === null) {
      scheduleMoveFrame();
    }

    if (moved || groundChanged || groundedChanged) {
      setOrigin(resolved.origin, resolved.groundZ, jumpEnabled, resolved.grounded, cameraMode);
    } else {
      lastValidOrigin = resolved.origin;
    }

    if (resolved.grounded) lastSafeOrigin = resolved.origin;
    if (resolved.grounded) {
      if (applyFallDamage(landingVelocityZ, resolved.origin)) return;
      fallDamageVelocityZ = 0;
    }
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
    if (hazardTimer !== null || gameplayPaused()) return;
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
    if (gameplayPaused()) {
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
    const nextIntervalMs = quakeHazardDamageIntervalMs(hazard);
    if (options.onHazardDamage?.(hazard)) {
      nextDamageAt = performance.now() + nextIntervalMs;
      scheduleHazardTick(nextIntervalMs);
      return false;
    }
    const died = applyDamage(hazard.amount);
    nextDamageAt = performance.now() + nextIntervalMs;
    if (!died) scheduleHazardTick(nextIntervalMs);
    return died;
  };

  const clearLevelState = (): void => {
    clearHazardTimer();
    clearDamageFlash();
    options.onHazardState(null);
    clearMoveInput();
    stopMoveFrame();
    moveVelocity = [0, 0, 0];
    fallDamageVelocityZ = 0;
    stopFalling();
    stopPush();
    stopDeathToss();
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

  function startDeathToss(velocity: Vec3): boolean {
    if (!options.getCollisionWorld()) return false;
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    if (!Number.isFinite(speed) || speed <= COLLISION_EPSILON) return false;
    deathTossVelocity = [...velocity] as Vec3;
    deathTossTime = 0;
    deathTossStartedAt = performance.now();
    currentGrounded = false;
    if (deathTossFrame === null) deathTossFrame = window.requestAnimationFrame(tickDeathToss);
    markQuakeTrace("player-death-toss-start", {
      vx: deathTossVelocity[0],
      vy: deathTossVelocity[1],
      vz: deathTossVelocity[2],
    });
    return true;
  }

  function stopDeathToss(): void {
    if (deathTossFrame !== null) {
      window.cancelAnimationFrame(deathTossFrame);
      deathTossFrame = null;
    }
    deathTossTime = 0;
    deathTossStartedAt = 0;
    deathTossVelocity = [0, 0, 0];
  }

  const tickDeathToss = (_frameNow: number): void => {
    const collisionWorld = options.getCollisionWorld();
    if (deathTossFrame === null || !dead || !collisionWorld) {
      stopDeathToss();
      return;
    }
    if (gameplayPaused()) {
      deathTossTime = 0;
      deathTossFrame = window.requestAnimationFrame(tickDeathToss);
      return;
    }

    const now = performance.now();
    const dt = Math.min(DEATH_TOSS_DT_CLAMP, deathTossTime ? (now - deathTossTime) / 1000 : 0.0167);
    deathTossTime = now;
    deathTossVelocity[2] -= options.gravity * dt;

    const origin = options.controls.getOrigin();
    const target: [number, number, number] = [
      origin[0] + deathTossVelocity[0] * dt,
      origin[1] + deathTossVelocity[1] * dt,
      origin[2] + deathTossVelocity[2] * dt,
    ];
    const resolved = collisionWorld.resolve(target, origin, currentEyeHeight, currentGroundZ, true);
    const actualDelta = subtractVec3(resolved.origin, origin);
    const intendedDelta = subtractVec3(target, origin);
    if (resolved.grounded && deathTossVelocity[2] < 0) deathTossVelocity[2] = 0;
    if (!resolved.grounded && deathTossVelocity[2] > 0 && actualDelta[2] < intendedDelta[2] * 0.25) {
      deathTossVelocity[2] = 0;
    }

    setOrigin(resolved.origin, resolved.groundZ, false, resolved.grounded, "move");
    lastGroundEntityIndex = resolved.touches?.find((touch) => touch.contact === "floor")?.entityIndex ?? null;
    options.syncViewmodel();
    options.syncWorldVisibility();
    options.syncCrosshairTarget();

    const elapsedMs = now - deathTossStartedAt;
    const speed = Math.hypot(deathTossVelocity[0], deathTossVelocity[1], deathTossVelocity[2]);
    if (elapsedMs >= DEATH_TOSS_MAX_MS || (resolved.grounded && speed <= DEATH_TOSS_STOP_SPEED)) {
      markQuakeTrace("player-death-toss-stop", {
        elapsedMs,
        grounded: resolved.grounded,
        speed,
      });
      stopDeathToss();
      return;
    }
    deathTossFrame = window.requestAnimationFrame(tickDeathToss);
  };

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
    if (gameplayPaused()) {
      fallingTime = 0;
      fallingFrame = window.requestAnimationFrame(tickFalling);
      return;
    }
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
    setOrigin(nextOrigin, nextGroundZ, true, landed, "move");
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
      if (applyFallDamage(-fallingVelocity, nextOrigin)) return;
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
    if (gameplayPaused()) {
      pushTime = 0;
      pushFrame = window.requestAnimationFrame(tickPush);
      return;
    }

    const now = performance.now();
    const dt = Math.min(PUSH_DT_CLAMP, pushTime ? (now - pushTime) / 1000 : 0.0167);
    pushTime = now;
    pushVelocity[2] -= options.gravity * dt;

    const origin = options.controls.getOrigin();
    const wasGroundedAtTickStart = currentGrounded;
    const target: [number, number, number] = [
      origin[0] + pushVelocity[0] * dt,
      origin[1] + pushVelocity[1] * dt,
      origin[2] + pushVelocity[2] * dt,
    ];
    const resolved = resolveDynamicCollision(
      collisionWorld,
      collisionWorld.resolve(target, origin, currentEyeHeight, currentGroundZ),
      origin,
    );
    const actualDelta = subtractVec3(resolved.origin, origin);
    const intendedDelta = subtractVec3(target, origin);
    const grounded = resolved.grounded;
    const landingVelocityZ = !wasGroundedAtTickStart && grounded ? pushVelocity[2] : 0;

    if (grounded && pushVelocity[2] < 0) pushVelocity[2] = 0;
    if (!grounded && pushVelocity[2] > 0 && actualDelta[2] < intendedDelta[2] * 0.25) {
      pushVelocity[2] = 0;
    }

    const damping = Math.max(0, 1 - (grounded ? PUSH_GROUND_FRICTION : PUSH_AIR_DRAG) * dt);
    pushVelocity[0] *= damping;
    pushVelocity[1] *= damping;

    setOrigin(resolved.origin, resolved.groundZ, false, grounded, "move");
    if (grounded && applyFallDamage(landingVelocityZ, resolved.origin)) return;
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
    cameraMode: "move" | "reset" | "smooth-step" = "reset",
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
    options.syncCamera(origin, cameraMode);
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

  function rememberFallDamageVelocity(velocityZ: number): void {
    fallDamageVelocityZ = Number.isFinite(velocityZ) && velocityZ < 0 ? velocityZ : 0;
  }

  function applyFallDamage(velocityZ: number, origin: [number, number, number]): boolean {
    const damage = quakePlayerFallDamageFromVelocityZ(velocityZ);
    if (damage <= 0) return false;
    if (fallDamageBlockedByWater(origin)) {
      markQuakeTrace("player-fall-damage-blocked", { damage, velocityZ, reason: "water" });
      return false;
    }
    markQuakeTrace("player-fall-damage", { damage, velocityZ });
    const previousVelocityZ = moveVelocity[2];
    if (velocityZ < 0) moveVelocity[2] = velocityZ;
    const died = applyDamage(damage);
    if (!died) moveVelocity[2] = previousVelocityZ;
    return died;
  }

  function fallDamageBlockedByWater(origin: [number, number, number]): boolean {
    const contentsAt = options.getCollisionWorld()?.contentsAt;
    if (!contentsAt) return false;
    const footZ = origin[2] - currentEyeHeight;
    return contentsAt([origin[0], origin[1], footZ + QUAKE_COLLISION_UNIT_SCALE]) === QUAKE_CONTENTS_WATER;
  }

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
    restoreProgress,
    respawn,
    snapshotProgress,
    spawn,
    setAnalogMove,
    setAuthoritativeOrigin,
    setCrouching,
    setDebugOrigin,
    syncCollision,
    syncHazard,
    teleportTo,
  };
}

function quakeHazardDamageIntervalMs(hazard: QuakeHazardDamage): number {
  if (hazard.kind === "lava") {
    return hazard.radsuitActive ? QUAKE_LAVA_RADSUIT_DAMAGE_INTERVAL_MS : QUAKE_LAVA_DAMAGE_INTERVAL_MS;
  }
  return QUAKE_DAMAGE_INTERVAL_MS;
}

export function quakePlayerDeathNeedsTossRandom(velocity: Vec3): boolean {
  return velocity[2] < 10 * QUAKE_COLLISION_UNIT_SCALE;
}

export function quakePlayerDamageMomentumImpulse(
  targetOrigin: Vec3,
  inflictorOrigin: Vec3 | null | undefined,
  damage: number,
): Vec3 | null {
  if (!inflictorOrigin || !Number.isFinite(damage) || damage <= 0) return null;
  const dx = targetOrigin[0] - inflictorOrigin[0];
  const dy = targetOrigin[1] - inflictorOrigin[1];
  const dz = targetOrigin[2] - inflictorOrigin[2];
  const length = Math.hypot(dx, dy, dz);
  if (length <= COLLISION_EPSILON) return null;
  const speed = damage * 8 * QUAKE_COLLISION_UNIT_SCALE;
  return [
    (dx / length) * speed,
    (dy / length) * speed,
    (dz / length) * speed,
  ];
}

export function quakePlayerDeathTossVelocity(
  velocity: Vec3,
  randomValue: number | null,
): Vec3 {
  const out = [...velocity] as Vec3;
  if (quakePlayerDeathNeedsTossRandom(out)) {
    out[2] += quakeNormalizedRandom(randomValue) * 300 * QUAKE_COLLISION_UNIT_SCALE;
  }
  return out;
}

export function quakePlayerDeathSoundIndexFromRandom(randomValue: number): 1 | 2 | 3 | 4 | 5 {
  const index = Math.round(quakeNormalizedRandom(randomValue) * 4 + 1);
  return Math.max(1, Math.min(5, index)) as 1 | 2 | 3 | 4 | 5;
}

export function quakePlayerDeathSoundPathFromRandom(randomValue: number): string {
  return QUAKE_PLAYER_DEATH_SOUND_PATHS[quakePlayerDeathSoundIndexFromRandom(randomValue) - 1];
}

export function quakePlayerGibSoundPathFromRandom(randomValue: number): string {
  return quakeNormalizedRandom(randomValue) < 0.5
    ? QUAKE_PLAYER_GIB_SOUND_PATHS[0]
    : QUAKE_PLAYER_GIB_SOUND_PATHS[1];
}

function quakeNormalizedRandom(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999999, value));
}
