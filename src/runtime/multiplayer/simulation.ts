import type { QuakeCollisionWorld } from "../collision";
import {
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  QUAKE_PLAYER_VIEW_Z,
} from "../constants";
import {
  QUAKE_CONTENTS_WATER,
  QUAKE_CONTENTS_LAVA,
  QUAKE_CONTENTS_SLIME,
  quakePlayerWaterLevel,
} from "../hazards";
import { quakePlayerFallDamageFromVelocityZ } from "../playerPhysics";
import { quakeMultiplayerAdvancePlayerWithInputResult } from "./movement";
import type {
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerLocalInputIntent,
  QuakeMultiplayerVec3,
} from "./protocol";

export const QUAKE_MULTIPLAYER_ROOM_SIMULATION_TICK_MS = 50;
export const QUAKE_MULTIPLAYER_MAX_ROOM_SIMULATION_CATCHUP_TICKS = 4;
export const QUAKE_MULTIPLAYER_MAX_QUEUED_INPUTS = 8;
export const QUAKE_MULTIPLAYER_INPUT_HOLD_MS = 250;
export const QUAKE_MULTIPLAYER_TELEPORT_BACKPEDAL_LOCK_MS = 700;
export const QUAKE_MULTIPLAYER_DROWN_AIR_MS = 12_000;
export const QUAKE_MULTIPLAYER_DROWN_DAMAGE_INTERVAL_MS = 1_000;
export const QUAKE_MULTIPLAYER_DROWN_INITIAL_DAMAGE = 2;
export const QUAKE_MULTIPLAYER_LAVA_DAMAGE_INTERVAL_MS = 200;
export const QUAKE_MULTIPLAYER_LIQUID_RADSUIT_DAMAGE_INTERVAL_MS = 1000;
export const QUAKE_MULTIPLAYER_SLIME_DAMAGE_INTERVAL_MS = 1000;
export const QUAKE_MULTIPLAYER_WATER_VELOCITY_DAMPING = 0.8;

export interface QuakeMultiplayerRoomPlayerSimulationState {
  airFinishedAt: number;
  drownDamage: number;
  drownPainFinishedAt?: number;
  playerId: string;
  grounded: boolean;
  floorZ?: number;
  fallVelocityZ?: number;
  lastAcceptedInput?: QuakeMultiplayerLocalInputIntent;
  lastAcceptedInputSequence: number;
  lastSimulatedAt: number;
  lastSimulatedTick: number;
  nextLiquidDamageAt?: number;
  pendingInputs: readonly QuakeMultiplayerLocalInputIntent[];
  teleportBackpedalLockUntil?: number;
}

export interface QuakeMultiplayerRoomHazardDamage {
  damagedAt: number;
  damage: number;
  kind: "drown" | "fall" | "lava" | "slime";
  waterLevel: number;
}

export interface QuakeMultiplayerRoomSimulationAdvanceOptions {
  now: number;
  tickMs?: number;
  maxCatchupTicks?: number;
  maxInputHoldMs?: number;
  collisionWorld?: Pick<QuakeCollisionWorld, "contentsAt" | "floorAt" | "resolve"> | null;
  playerEyeHeight?: number;
  radsuitActive?: boolean;
}

export interface QuakeMultiplayerRoomInputQueueResult {
  accepted: boolean;
  state: QuakeMultiplayerRoomPlayerSimulationState;
}

export interface QuakeMultiplayerRoomSimulationAdvanceResult {
  advancedTicks: number;
  consumedInputSequences: number[];
  hazardDamages: QuakeMultiplayerRoomHazardDamage[];
  player: QuakeMultiplayerAuthoritativePlayerState;
  state: QuakeMultiplayerRoomPlayerSimulationState;
}

export function createQuakeMultiplayerRoomPlayerSimulationState(input: {
  playerId: string;
  now: number;
  grounded?: boolean;
  floorZ?: number;
  lastAcceptedInputSequence?: number;
  lastSimulatedTick?: number;
  teleportBackpedalLockUntil?: number;
}): QuakeMultiplayerRoomPlayerSimulationState {
  return {
    playerId: input.playerId,
    grounded: input.grounded ?? true,
    ...(input.floorZ !== undefined ? { floorZ: input.floorZ } : {}),
    ...(input.teleportBackpedalLockUntil !== undefined
      ? { teleportBackpedalLockUntil: input.teleportBackpedalLockUntil }
      : {}),
    airFinishedAt: input.now + QUAKE_MULTIPLAYER_DROWN_AIR_MS,
    drownDamage: QUAKE_MULTIPLAYER_DROWN_INITIAL_DAMAGE,
    lastAcceptedInputSequence: input.lastAcceptedInputSequence ?? 0,
    lastSimulatedAt: input.now,
    lastSimulatedTick: input.lastSimulatedTick ?? 0,
    pendingInputs: [],
  };
}

export function queueQuakeMultiplayerRoomInput(
  state: QuakeMultiplayerRoomPlayerSimulationState,
  input: QuakeMultiplayerLocalInputIntent,
): QuakeMultiplayerRoomInputQueueResult {
  if (input.inputSequence <= state.lastAcceptedInputSequence) {
    return { accepted: false, state };
  }
  const pending = state.pendingInputs.filter((candidate) =>
    candidate.inputSequence > state.lastAcceptedInputSequence &&
    candidate.inputSequence !== input.inputSequence
  );
  pending.push(input);
  pending.sort((left, right) => left.inputSequence - right.inputSequence);
  return {
    accepted: true,
    state: {
      ...state,
      pendingInputs: pending.slice(-QUAKE_MULTIPLAYER_MAX_QUEUED_INPUTS),
    },
  };
}

export function pauseQuakeMultiplayerRoomPlayerSimulation(
  state: QuakeMultiplayerRoomPlayerSimulationState,
  now: number,
): QuakeMultiplayerRoomPlayerSimulationState {
  return {
    ...state,
    lastAcceptedInput: undefined,
    lastSimulatedAt: now,
    pendingInputs: [],
  };
}

export function advanceQuakeMultiplayerRoomPlayerSimulation(
  player: QuakeMultiplayerAuthoritativePlayerState,
  state: QuakeMultiplayerRoomPlayerSimulationState,
  options: QuakeMultiplayerRoomSimulationAdvanceOptions,
): QuakeMultiplayerRoomSimulationAdvanceResult {
  const tickMs = normalizePositiveNumber(options.tickMs, QUAKE_MULTIPLAYER_ROOM_SIMULATION_TICK_MS);
  const maxCatchupTicks = Math.max(
    1,
    Math.floor(normalizePositiveNumber(
      options.maxCatchupTicks,
      QUAKE_MULTIPLAYER_MAX_ROOM_SIMULATION_CATCHUP_TICKS,
    )),
  );
  const maxInputHoldMs = normalizePositiveNumber(options.maxInputHoldMs, QUAKE_MULTIPLAYER_INPUT_HOLD_MS);
  const elapsedTicks = Math.floor((options.now - state.lastSimulatedAt) / tickMs);
  const ticksToRun = Math.min(maxCatchupTicks, Math.max(0, elapsedTicks));
  if (ticksToRun <= 0) {
    return { advancedTicks: 0, consumedInputSequences: [], hazardDamages: [], player, state };
  }

  let nextPlayer = player;
  let nextState = state;
  const consumedInputSequences: number[] = [];
  const hazardDamages: QuakeMultiplayerRoomHazardDamage[] = [];

  for (let index = 0; index < ticksToRun; index++) {
    const simulatedAt = nextState.lastSimulatedAt + tickMs;
    const selected = selectInputForSimulationTick(nextPlayer, nextState, simulatedAt, maxInputHoldMs);
    const pendingInputs = selected.pendingInputs;
    const tickInput = selected.input
      ? {
          ...quakeMultiplayerInputAfterTeleportBackpedalLock(selected.input, nextState, simulatedAt),
          dt: tickMs / 1000,
        }
      : options.collisionWorld && !nextState.grounded
        ? createQuakeMultiplayerIdleInput(nextPlayer, nextState, simulatedAt, tickMs)
        : null;
    let lastAcceptedInput = nextState.lastAcceptedInput;
    let lastAcceptedInputSequence = nextState.lastAcceptedInputSequence;
    let grounded = nextState.grounded;
    let floorZ = nextState.floorZ;
    let fallVelocityZ = nextState.fallVelocityZ;

    if (tickInput) {
      const wasGrounded = nextState.grounded;
      const incomingVelocityZ = nextPlayer.velocity[2];
      const advanced = quakeMultiplayerAdvancePlayerWithInputResult(nextPlayer, tickInput, {
        now: simulatedAt,
        maxDt: tickMs / 1000,
        collisionWorld: options.collisionWorld,
        grounded: nextState.grounded,
        currentGroundZ: nextState.floorZ,
        playerEyeHeight: options.playerEyeHeight,
      });
      nextPlayer = advanced.player;
      grounded = advanced.grounded ?? grounded;
      floorZ = advanced.groundZ ?? floorZ;
      if (!wasGrounded && grounded) {
        const landingVelocityZ = incomingVelocityZ < 0 ? incomingVelocityZ : (fallVelocityZ ?? 0);
        const damage = quakePlayerFallDamageFromVelocityZ(landingVelocityZ);
        if (
          damage > 0 &&
          !quakeMultiplayerFallDamageBlockedByWater(nextPlayer, options.collisionWorld, options.playerEyeHeight)
        ) {
          hazardDamages.push({
            damagedAt: simulatedAt,
            damage,
            kind: "fall",
            waterLevel: 0,
          });
        }
        fallVelocityZ = undefined;
      } else if (grounded) {
        fallVelocityZ = undefined;
      } else {
        fallVelocityZ = nextPlayer.velocity[2] < 0 ? nextPlayer.velocity[2] : undefined;
      }
      if (selected.input) {
        lastAcceptedInput = selected.input;
        lastAcceptedInputSequence = selected.input.inputSequence;
        if (!consumedInputSequences.includes(selected.input.inputSequence)) {
          consumedInputSequences.push(selected.input.inputSequence);
        }
      }
    }

    const hazard = quakeMultiplayerWaterMoveHazardDamagesForTick(nextPlayer, nextState, {
      collisionWorld: options.collisionWorld,
      playerEyeHeight: options.playerEyeHeight,
      radsuitActive: options.radsuitActive,
      simulatedAt,
    });
    nextState = hazard.state;
    hazardDamages.push(...hazard.damages);
    nextPlayer = quakeMultiplayerPlayerWithWaterMoveVelocityDamping(nextPlayer, {
      collisionWorld: options.collisionWorld,
      dt: tickMs / 1000,
      playerEyeHeight: options.playerEyeHeight,
      simulatedAt,
    });

    const { fallVelocityZ: _previousFallVelocityZ, ...stateWithoutFallVelocity } = nextState;
    nextState = {
      ...stateWithoutFallVelocity,
      ...(floorZ !== undefined ? { floorZ } : {}),
      ...(fallVelocityZ !== undefined ? { fallVelocityZ } : {}),
      grounded,
      lastAcceptedInput,
      lastAcceptedInputSequence,
      lastSimulatedAt: simulatedAt,
      lastSimulatedTick: nextState.lastSimulatedTick + 1,
      pendingInputs,
    };
  }

  return {
    advancedTicks: ticksToRun,
    consumedInputSequences,
    hazardDamages,
    player: nextPlayer,
    state: nextState,
  };
}

export function quakeMultiplayerInputAfterTeleportBackpedalLock(
  input: QuakeMultiplayerLocalInputIntent,
  state: Pick<QuakeMultiplayerRoomPlayerSimulationState, "teleportBackpedalLockUntil">,
  now: number,
): QuakeMultiplayerLocalInputIntent {
  if (
    state.teleportBackpedalLockUntil === undefined ||
    now >= state.teleportBackpedalLockUntil ||
    input.move.forward >= 0
  ) {
    return input;
  }
  return {
    ...input,
    move: {
      ...input.move,
      forward: 0,
    },
  };
}

function createQuakeMultiplayerIdleInput(
  player: QuakeMultiplayerAuthoritativePlayerState,
  state: QuakeMultiplayerRoomPlayerSimulationState,
  simulatedAt: number,
  tickMs: number,
): QuakeMultiplayerLocalInputIntent {
  return {
    inputSequence: state.lastAcceptedInputSequence,
    sampledAt: simulatedAt,
    dt: tickMs / 1000,
    move: { forward: 0, side: 0, up: 0 },
    buttons: { attack: false, jump: false, use: false },
    rotX: player.rotX,
    rotY: player.rotY,
    activeWeapon: player.activeWeapon,
  };
}

function selectInputForSimulationTick(
  player: QuakeMultiplayerAuthoritativePlayerState,
  state: QuakeMultiplayerRoomPlayerSimulationState,
  simulatedAt: number,
  maxInputHoldMs: number,
): {
  input: QuakeMultiplayerLocalInputIntent | undefined;
  pendingInputs: readonly QuakeMultiplayerLocalInputIntent[];
} {
  const freshPendingInputs = state.pendingInputs.filter((input) =>
    input.inputSequence > state.lastAcceptedInputSequence
  );
  const queuedInput = freshPendingInputs.at(-1);
  if (queuedInput) {
    return {
      input: queuedInput,
      pendingInputs: [],
    };
  }
  if (
    player.alive &&
    state.lastAcceptedInput &&
    simulatedAt - state.lastAcceptedInput.sampledAt <= maxInputHoldMs
  ) {
    return {
      input: state.lastAcceptedInput,
      pendingInputs: [],
    };
  }
  return {
    input: undefined,
    pendingInputs: [],
  };
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback;
  return value;
}

function quakeMultiplayerWaterMoveHazardDamagesForTick(
  player: QuakeMultiplayerAuthoritativePlayerState,
  state: QuakeMultiplayerRoomPlayerSimulationState,
  options: {
    collisionWorld?: Pick<QuakeCollisionWorld, "contentsAt"> | null;
    playerEyeHeight?: number;
    radsuitActive?: boolean;
    simulatedAt: number;
  },
): {
  damages: QuakeMultiplayerRoomHazardDamage[];
  state: QuakeMultiplayerRoomPlayerSimulationState;
} {
  const contentsAt = options.collisionWorld?.contentsAt;
  if (!player.alive || !contentsAt) return { damages: [], state };
  const playerEyeHeight = normalizePositiveNumber(
    options.playerEyeHeight,
    QUAKE_PLAYER_VIEW_Z - QUAKE_PLAYER_MINS_Z,
  );
  const waterLevel = quakePlayerWaterLevel(
    contentsAt,
    player.origin as QuakeMultiplayerVec3,
    playerEyeHeight,
  );
  const damages: QuakeMultiplayerRoomHazardDamage[] = [];
  let nextState = state;

  if (waterLevel !== 3) {
    nextState = {
      ...nextState,
      airFinishedAt: options.simulatedAt + QUAKE_MULTIPLAYER_DROWN_AIR_MS,
      drownDamage: QUAKE_MULTIPLAYER_DROWN_INITIAL_DAMAGE,
    };
  } else if (
    nextState.airFinishedAt < options.simulatedAt &&
    (nextState.drownPainFinishedAt ?? -Infinity) < options.simulatedAt
  ) {
    const damage = quakeMultiplayerNextDrownDamage(nextState.drownDamage);
    damages.push({
      damagedAt: options.simulatedAt,
      damage,
      kind: "drown",
      waterLevel,
    });
    nextState = {
      ...nextState,
      drownDamage: damage,
      drownPainFinishedAt: options.simulatedAt + QUAKE_MULTIPLAYER_DROWN_DAMAGE_INTERVAL_MS,
    };
  }

  if (waterLevel <= 0) {
    return { damages, state: quakeMultiplayerStateWithoutLiquidDamageTimer(nextState) };
  }
  const contents = contentsAt(quakeMultiplayerLiquidContentsPoint(player.origin, playerEyeHeight));
  const nextDamageAt = nextState.nextLiquidDamageAt ?? -Infinity;
  if (options.simulatedAt <= nextDamageAt) return { damages, state: nextState };
  if (contents === QUAKE_CONTENTS_LAVA) {
    const intervalMs = options.radsuitActive
      ? QUAKE_MULTIPLAYER_LIQUID_RADSUIT_DAMAGE_INTERVAL_MS
      : QUAKE_MULTIPLAYER_LAVA_DAMAGE_INTERVAL_MS;
    damages.push({
      damagedAt: options.simulatedAt,
      damage: 10 * waterLevel,
      kind: "lava",
      waterLevel,
    });
    return {
      damages,
      state: {
        ...nextState,
        nextLiquidDamageAt: options.simulatedAt + intervalMs,
      },
    };
  }
  if (contents === QUAKE_CONTENTS_SLIME && !options.radsuitActive) {
    damages.push({
      damagedAt: options.simulatedAt,
      damage: 4 * waterLevel,
      kind: "slime",
      waterLevel,
    });
    return {
      damages,
      state: {
        ...nextState,
        nextLiquidDamageAt: options.simulatedAt + QUAKE_MULTIPLAYER_SLIME_DAMAGE_INTERVAL_MS,
      },
    };
  }
  return { damages, state: nextState };
}

function quakeMultiplayerNextDrownDamage(previous: number): number {
  const damage = previous + 2;
  return damage > 15 ? 10 : damage;
}

function quakeMultiplayerPlayerWithWaterMoveVelocityDamping(
  player: QuakeMultiplayerAuthoritativePlayerState,
  options: {
    collisionWorld?: Pick<QuakeCollisionWorld, "contentsAt"> | null;
    dt: number;
    playerEyeHeight?: number;
    simulatedAt: number;
  },
): QuakeMultiplayerAuthoritativePlayerState {
  const contentsAt = options.collisionWorld?.contentsAt;
  if (!player.alive || !contentsAt || !Number.isFinite(options.dt) || options.dt <= 0) return player;
  const playerEyeHeight = normalizePositiveNumber(
    options.playerEyeHeight,
    QUAKE_PLAYER_VIEW_Z - QUAKE_PLAYER_MINS_Z,
  );
  const waterLevel = quakePlayerWaterLevel(
    contentsAt,
    player.origin as QuakeMultiplayerVec3,
    playerEyeHeight,
  );
  if (waterLevel <= 0) return player;
  const scale = 1 - QUAKE_MULTIPLAYER_WATER_VELOCITY_DAMPING * waterLevel * options.dt;
  return {
    ...player,
    velocity: [
      player.velocity[0] * scale,
      player.velocity[1] * scale,
      player.velocity[2] * scale,
    ],
    updatedAt: options.simulatedAt,
  };
}

function quakeMultiplayerStateWithoutLiquidDamageTimer(
  state: QuakeMultiplayerRoomPlayerSimulationState,
): QuakeMultiplayerRoomPlayerSimulationState {
  const next = { ...state };
  delete next.nextLiquidDamageAt;
  return next;
}

function quakeMultiplayerFallDamageBlockedByWater(
  player: QuakeMultiplayerAuthoritativePlayerState,
  collisionWorld: Pick<QuakeCollisionWorld, "contentsAt"> | null | undefined,
  playerEyeHeight: number | undefined,
): boolean {
  const contentsAt = collisionWorld?.contentsAt;
  if (!contentsAt) return false;
  const eyeHeight = normalizePositiveNumber(playerEyeHeight, QUAKE_PLAYER_VIEW_Z - QUAKE_PLAYER_MINS_Z);
  return contentsAt(quakeMultiplayerLiquidContentsPoint(player.origin, eyeHeight)) === QUAKE_CONTENTS_WATER;
}

function quakeMultiplayerLiquidContentsPoint(
  origin: QuakeMultiplayerVec3,
  playerEyeHeight: number,
): QuakeMultiplayerVec3 {
  return [
    origin[0],
    origin[1],
    origin[2] - playerEyeHeight + 2 * QUAKE_COLLISION_UNIT_SCALE,
  ];
}
