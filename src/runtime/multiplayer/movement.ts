import {
  GROUND_SNAP,
  QUAKE_COLLISION_UNIT_SCALE,
} from "../constants";
import {
  QUAKE_PMOVE_DT_CLAMP,
  QUAKE_PMOVE_EDGE_DISTANCE,
  QUAKE_PMOVE_EDGE_DROP,
  QUAKE_PMOVE_EDGE_FRICTION,
  QUAKE_PMOVE_SIDE_SPEED,
  QUAKE_PMOVE_SPEED_KEY_MULTIPLIER,
  updateQuakePlayerPhysics,
} from "../playerPhysics";
import type { QuakeCollisionWorld } from "../collision";
import {
  quakeMultiplayerInventoryWithSelectedWeapon,
  quakeMultiplayerPlayerInventory,
  quakeMultiplayerPlayerWithInventory,
} from "./items";
import type {
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerLocalInputIntent,
  QuakeMultiplayerVec3,
} from "./protocol";

const QUAKE_MULTIPLAYER_MAX_MOVE_INTENT =
  QUAKE_PMOVE_SIDE_SPEED * QUAKE_PMOVE_SPEED_KEY_MULTIPLIER;
const QUAKE_MULTIPLAYER_DEFAULT_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_DEFAULT_JUMP_VELOCITY = 270 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_DEFAULT_PLAYER_EYE_HEIGHT = 46 * QUAKE_COLLISION_UNIT_SCALE;

export interface QuakeMultiplayerInputAdvanceOptions {
  now: number;
  maxDt?: number;
  frictionScale?: number;
  collisionWorld?: Pick<QuakeCollisionWorld, "floorAt" | "resolve"> | null;
  currentGroundZ?: number;
  grounded?: boolean;
  gravity?: number;
  jumpVelocity?: number;
  playerEyeHeight?: number;
}

export interface QuakeMultiplayerInputAdvanceResult {
  player: QuakeMultiplayerAuthoritativePlayerState;
  grounded?: boolean;
  groundZ?: number;
}

export function quakeMultiplayerAdvancePlayerWithInput(
  player: QuakeMultiplayerAuthoritativePlayerState,
  input: QuakeMultiplayerLocalInputIntent,
  options: QuakeMultiplayerInputAdvanceOptions,
): QuakeMultiplayerAuthoritativePlayerState {
  return quakeMultiplayerAdvancePlayerWithInputResult(player, input, options).player;
}

export function quakeMultiplayerAdvancePlayerWithInputResult(
  player: QuakeMultiplayerAuthoritativePlayerState,
  input: QuakeMultiplayerLocalInputIntent,
  options: QuakeMultiplayerInputAdvanceOptions,
): QuakeMultiplayerInputAdvanceResult {
  const timestamp = options.now;
  const dt = quakeMultiplayerInputDeltaSeconds(input.dt, options.maxDt);
  const rotY = normalizeQuakeMultiplayerDegrees(input.rotY);
  let next = quakeMultiplayerPlayerWithInputWeapon(player, input);

  if (!next.alive) {
    return {
      player: {
        ...next,
        rotX: input.rotX,
        rotY,
        lastInputSequence: input.inputSequence,
        updatedAt: timestamp,
      },
      ...(options.grounded !== undefined ? { grounded: options.grounded } : {}),
      ...(options.currentGroundZ !== undefined ? { groundZ: options.currentGroundZ } : {}),
    };
  }

  const collisionWorld = options.collisionWorld ?? null;
  const playerEyeHeight = normalizePositiveNumber(
    options.playerEyeHeight,
    QUAKE_MULTIPLAYER_DEFAULT_PLAYER_EYE_HEIGHT,
  );
  const inferredGround = collisionWorld
    ? quakeMultiplayerInferredGround(collisionWorld, next.origin, playerEyeHeight, options.currentGroundZ)
    : null;
  const currentGroundZ = options.currentGroundZ ?? inferredGround?.groundZ ?? (next.origin[2] - playerEyeHeight);
  const grounded = options.grounded ?? inferredGround?.grounded ?? true;
  const velocity: [number, number, number] = collisionWorld
    ? [next.velocity[0], next.velocity[1], next.velocity[2]]
    : [next.velocity[0], next.velocity[1], 0];
  const frictionScale = options.frictionScale ??
    (collisionWorld && grounded
      ? quakeMultiplayerEdgeFriction(collisionWorld, next.origin, playerEyeHeight, velocity)
      : 1);
  const physicsGrounded = updateQuakePlayerPhysics(
    velocity,
    {
      forwardMove: clampQuakeMultiplayerMoveIntent(input.move.forward),
      sideMove: clampQuakeMultiplayerMoveIntent(input.move.side),
      jump: collisionWorld ? input.buttons.jump : false,
      yawDegrees: rotY,
    },
    grounded,
    dt,
    collisionWorld ? normalizePositiveNumber(options.gravity, QUAKE_MULTIPLAYER_DEFAULT_GRAVITY) : 0,
    collisionWorld ? normalizePositiveNumber(options.jumpVelocity, QUAKE_MULTIPLAYER_DEFAULT_JUMP_VELOCITY) : 0,
    frictionScale,
  );

  const target: QuakeMultiplayerVec3 = [
    next.origin[0] + velocity[0] * dt,
    next.origin[1] + velocity[1] * dt,
    collisionWorld ? next.origin[2] + velocity[2] * dt : next.origin[2],
  ];
  if (!collisionWorld) {
    next = {
      ...next,
      origin: target,
      velocity: [velocity[0], velocity[1], 0],
      rotX: input.rotX,
      rotY,
      lastInputSequence: input.inputSequence,
      updatedAt: timestamp,
    };
    return { player: next };
  }

  let resolved = collisionWorld.resolve(target, next.origin, playerEyeHeight, currentGroundZ, !physicsGrounded);
  if (!physicsGrounded && velocity[2] > 0 && resolved.grounded) {
    resolved = {
      ...resolved,
      origin: target,
      groundZ: currentGroundZ,
      grounded: false,
    };
  }

  const actualDeltaX = resolved.origin[0] - next.origin[0];
  const actualDeltaY = resolved.origin[1] - next.origin[1];
  const actualDeltaZ = resolved.origin[2] - next.origin[2];
  const intendedDeltaZ = target[2] - next.origin[2];
  const nextVelocity: QuakeMultiplayerVec3 = dt > 0
    ? [actualDeltaX / dt, actualDeltaY / dt, actualDeltaZ / dt]
    : velocity;
  if (resolved.grounded) {
    nextVelocity[2] = 0;
  } else if (velocity[2] > 0 && actualDeltaZ < intendedDeltaZ * 0.25) {
    nextVelocity[2] = 0;
  }
  next = {
    ...next,
    origin: resolved.origin,
    velocity: nextVelocity,
    rotX: input.rotX,
    rotY,
    lastInputSequence: input.inputSequence,
    updatedAt: timestamp,
  };
  return {
    player: next,
    grounded: resolved.grounded,
    groundZ: resolved.groundZ,
  };
}

function quakeMultiplayerPlayerWithInputWeapon(
  player: QuakeMultiplayerAuthoritativePlayerState,
  input: QuakeMultiplayerLocalInputIntent,
): QuakeMultiplayerAuthoritativePlayerState {
  const activeWeapon = input.activeWeapon?.trim().toLowerCase();
  if (!activeWeapon) return player;
  const inventory = quakeMultiplayerPlayerInventory(player);
  const selected = quakeMultiplayerInventoryWithSelectedWeapon(inventory, activeWeapon);
  if (!selected) return player;
  return quakeMultiplayerPlayerWithInventory(player, selected);
}

function quakeMultiplayerInputDeltaSeconds(inputDt: number, maxDt = QUAKE_PMOVE_DT_CLAMP): number {
  if (!Number.isFinite(inputDt) || inputDt <= 0) return 0;
  return Math.min(Math.max(0, maxDt), inputDt);
}

function clampQuakeMultiplayerMoveIntent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-QUAKE_MULTIPLAYER_MAX_MOVE_INTENT, Math.min(QUAKE_MULTIPLAYER_MAX_MOVE_INTENT, value));
}

function normalizeQuakeMultiplayerDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

function quakeMultiplayerEdgeFriction(
  collisionWorld: Pick<QuakeCollisionWorld, "floorAt">,
  origin: QuakeMultiplayerVec3,
  playerEyeHeight: number,
  velocity: QuakeMultiplayerVec3,
): number {
  const speed = Math.hypot(velocity[0], velocity[1]);
  if (speed <= 0.0001) return 1;
  const footZ = origin[2] - playerEyeHeight;
  const edgeX = origin[0] + (velocity[0] / speed) * QUAKE_PMOVE_EDGE_DISTANCE;
  const edgeY = origin[1] + (velocity[1] / speed) * QUAKE_PMOVE_EDGE_DISTANCE;
  const floorZ = collisionWorld.floorAt(edgeX, edgeY, footZ + 0.0001, footZ - QUAKE_PMOVE_EDGE_DROP);
  return floorZ === null ? QUAKE_PMOVE_EDGE_FRICTION : 1;
}

function quakeMultiplayerInferredGround(
  collisionWorld: Pick<QuakeCollisionWorld, "floorAt">,
  origin: QuakeMultiplayerVec3,
  playerEyeHeight: number,
  currentGroundZ: number | undefined,
): { groundZ: number; grounded: boolean } | null {
  if (currentGroundZ !== undefined) {
    return {
      groundZ: currentGroundZ,
      grounded: Math.abs(origin[2] - playerEyeHeight - currentGroundZ) <= GROUND_SNAP,
    };
  }
  const footZ = origin[2] - playerEyeHeight;
  const groundZ = collisionWorld.floorAt(origin[0], origin[1], footZ + GROUND_SNAP, footZ - GROUND_SNAP);
  if (groundZ === null) return null;
  return {
    groundZ,
    grounded: Math.abs(footZ - groundZ) <= GROUND_SNAP,
  };
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback;
  return value;
}
