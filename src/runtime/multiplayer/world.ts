import type {
  QuakeGameLogicFacts,
  QuakeGameLogicGeneratedTextFact,
} from "../../prepare/gameLogicFacts";
import type { QuakeEntity, QuakeVertex } from "../../types/quake";
import {
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  QUAKE_PLAYER_VIEW_Z,
} from "../constants";
import type {
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerClientWorldEnvelope,
  QuakeMultiplayerFireIntent,
  QuakeMultiplayerJson,
  QuakeMultiplayerMoverClassname,
  QuakeMultiplayerMoverState,
  QuakeMultiplayerRoomRejectPayload,
  QuakeMultiplayerTriggerActivationClassname,
  QuakeMultiplayerTriggerCounterMessage,
  QuakeMultiplayerVec3,
  QuakeMultiplayerWorldBounds,
  QuakeMultiplayerWorldDefinition,
  QuakeMultiplayerWorldIntent,
} from "./protocol";
import {
  quakeMultiplayerPointToRoom,
  type QuakeMultiplayerSceneGameplayOptions,
} from "./sceneFacts";

const QUAKE_MULTIPLAYER_WORLD_TOUCH_TOLERANCE = 1;
const QUAKE_MULTIPLAYER_WORLD_TOUCH_ORIGIN_HINT_MAX_HORIZONTAL_DRIFT = 3;
const QUAKE_MULTIPLAYER_WORLD_TOUCH_ORIGIN_HINT_MAX_VERTICAL_DRIFT = 8;
export const QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED = 300 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS = 200;
export const QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE = 50000;
export const QUAKE_MULTIPLAYER_TRIGGER_HURT_COOLDOWN_MS = 1000;
const QUAKE_MULTIPLAYER_TELEFRAG_TRIGGER_EXPAND = 1 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_PLAYER_EYE_HEIGHT = QUAKE_PLAYER_VIEW_Z - QUAKE_PLAYER_MINS_Z;
const QUAKE_MULTIPLAYER_TRIGGER_HURT_DEFAULT_DAMAGE = 5;
const QUAKE_MULTIPLAYER_TRIGGER_PUSH_DEFAULT_SPEED = 1000;
const QUAKE_MULTIPLAYER_TRIGGER_PUSH_ONCE = 1;
const QUAKE_MULTIPLAYER_TRIGGER_PUSH_VELOCITY_MULTIPLIER = 10;
const QUAKE_MULTIPLAYER_SUB_CALC_MOVE_MIN_MS = 100;
const QUAKE_MULTIPLAYER_MOVER_OFFSET_EPSILON = 1e-6;
const QUAKE_MULTIPLAYER_TRIGGER_ACTIVATION_CLASSNAMES =
  new Set<QuakeMultiplayerTriggerActivationClassname>([
    "trigger_multiple",
    "trigger_once",
    "trigger_secret",
    "trigger_counter",
    "trigger_relay",
  ]);
const QUAKE_MULTIPLAYER_MOVER_CLASSNAMES =
  new Set<QuakeMultiplayerMoverClassname>([
    "func_button",
    "func_door",
    "func_door_secret",
    "func_plat",
  ]);

export interface QuakeMultiplayerSceneWorldSource {
  entities: readonly QuakeEntity[];
  entityManifest?: {
    runtime?: {
      targetEntities?: Record<string, readonly number[]>;
    };
  };
  gameLogic?: QuakeGameLogicFacts;
  collision?: {
    pivot?: QuakeVertex;
  };
  spawn?: {
    eyeHeight?: number;
  };
}

export type QuakeMultiplayerWorldIntentResolution =
  | {
      ok: true;
      kind: "teleport";
      definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "teleport" }>;
      player: QuakeMultiplayerAuthoritativePlayerState;
    }
  | {
      ok: true;
      kind: "changelevel";
      definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "changelevel" }>;
    }
  | {
      ok: true;
      kind: "hurt";
      definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "hurt" }>;
      damage: number;
    }
  | {
      ok: true;
      kind: "push";
      definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "push" }>;
      player: QuakeMultiplayerAuthoritativePlayerState;
    }
  | {
      ok: true;
      kind: "trigger";
      definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>;
    }
  | {
      ok: true;
      kind: "mover";
      definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>;
    }
  | {
      ok: false;
      reason: string;
      message: string;
      details?: Record<string, QuakeMultiplayerJson>;
    };

export function quakeMultiplayerWorldDefinitionsFromScene(
  scene: QuakeMultiplayerSceneWorldSource,
  options: QuakeMultiplayerSceneGameplayOptions = {},
): QuakeMultiplayerWorldDefinition[] {
  const sceneOptions = quakeMultiplayerSceneWorldOptions(scene, options);
  const entityByIndex = new Map(scene.entities.map((entity) => [entity.index, entity]));
  const logicByIndex = new Map((scene.gameLogic?.entities ?? [])
    .map((entity) => [entity.entityIndex, entity as QuakeMultiplayerWorldLogicEntity]));
  return scene.entities
    .map((entity) => quakeMultiplayerWorldDefinitionFromEntity(
      entity,
      scene,
      entityByIndex,
      logicByIndex,
      sceneOptions,
    ))
    .filter((definition): definition is QuakeMultiplayerWorldDefinition => Boolean(definition));
}

export function quakeMultiplayerTriggerCounterMessage(
  definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>,
  remaining: number,
  complete: boolean,
): string | undefined {
  if (definition.classname !== "trigger_counter") return definition.message;
  for (const candidate of definition.counterMessages ?? []) {
    if (complete) {
      if (candidate.remaining === 0) return candidate.message;
      continue;
    }
    if (candidate.remaining !== undefined && candidate.remaining === remaining) return candidate.message;
    if (candidate.minRemaining !== undefined && remaining >= candidate.minRemaining) return candidate.message;
    if (candidate.remaining === undefined && candidate.minRemaining === undefined) return candidate.message;
  }
  return definition.message;
}

export function quakeMultiplayerTriggerUsesMultiTrigger(
  definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>,
): boolean {
  return definition.classname === "trigger_multiple" ||
    definition.classname === "trigger_once" ||
    definition.classname === "trigger_secret";
}

export interface QuakeMultiplayerShootableMoverHit {
  definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>;
  distance: number;
  impact: QuakeMultiplayerVec3;
}

export interface QuakeMultiplayerShootableTriggerHit {
  definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>;
  distance: number;
  impact: QuakeMultiplayerVec3;
}

export type QuakeMultiplayerShootableWorldHit =
  | QuakeMultiplayerShootableMoverHit
  | QuakeMultiplayerShootableTriggerHit;

export function quakeMultiplayerShootableMoverHit(
  fire: Pick<QuakeMultiplayerFireIntent, "direction" | "origin" | "range">,
  definitions: Iterable<QuakeMultiplayerWorldDefinition>,
): QuakeMultiplayerShootableMoverHit | null {
  const hit = quakeMultiplayerShootableWorldHit(fire, definitions);
  return hit?.definition.kind === "mover" ? hit : null;
}

export function quakeMultiplayerShootableWorldHit(
  fire: Pick<QuakeMultiplayerFireIntent, "direction" | "origin" | "range">,
  definitions: Iterable<QuakeMultiplayerWorldDefinition>,
): QuakeMultiplayerShootableWorldHit | null {
  const direction = quakeMultiplayerNormalizedVec3(fire.direction);
  if (!direction) return null;
  const range = Number.isFinite(fire.range) && fire.range > 0 ? fire.range : 0;
  if (range <= 0) return null;
  let best: QuakeMultiplayerShootableWorldHit | null = null;
  for (const definition of definitions) {
    if (!quakeMultiplayerWorldDefinitionShootActivates(definition) || !definition.bounds) continue;
    const distance = quakeMultiplayerRayBoundsDistance(fire.origin, direction, range, definition.bounds);
    if (distance === null) continue;
    if (best && distance >= best.distance) continue;
    best = {
      definition,
      distance,
      impact: [
        fire.origin[0] + direction[0] * distance,
        fire.origin[1] + direction[1] * distance,
        fire.origin[2] + direction[2] * distance,
      ],
    };
  }
  return best;
}

function quakeMultiplayerWorldDefinitionShootActivates(
  definition: QuakeMultiplayerWorldDefinition,
): definition is Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" | "trigger" }> {
  return (definition.kind === "mover" || definition.kind === "trigger") && Boolean(definition.shootActivates);
}

export function quakeMultiplayerMoverOffsetForState(
  definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
  state: QuakeMultiplayerMoverState,
): QuakeMultiplayerVec3 {
  if (state === "top" || state === "moving-down") {
    return [
      definition.toOrigin[0] - definition.fromOrigin[0],
      definition.toOrigin[1] - definition.fromOrigin[1],
      definition.toOrigin[2] - definition.fromOrigin[2],
    ];
  }
  return [0, 0, 0];
}

export function quakeMultiplayerMoverOffsetAtTime(
  definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
  state: QuakeMultiplayerMoverState,
  startedAt: number,
  now: number,
  durationMs: number,
): QuakeMultiplayerVec3 {
  if (state === "top" || state === "bottom") return quakeMultiplayerMoverOffsetForState(definition, state);
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return quakeMultiplayerMoverOffsetForState(definition, state);
  }
  const progress = Math.max(0, Math.min(1, (now - startedAt) / durationMs));
  const topOffset = quakeMultiplayerMoverOffsetForState(definition, "top");
  if (state === "moving-down") {
    return [
      topOffset[0] * (1 - progress),
      topOffset[1] * (1 - progress),
      topOffset[2] * (1 - progress),
    ];
  }
  return [
    topOffset[0] * progress,
    topOffset[1] * progress,
    topOffset[2] * progress,
  ];
}

export function resolveQuakeMultiplayerWorldIntent(
  player: QuakeMultiplayerAuthoritativePlayerState,
  intent: QuakeMultiplayerWorldIntent,
  definitions: Iterable<QuakeMultiplayerWorldDefinition>,
  now = Date.now(),
): QuakeMultiplayerWorldIntentResolution {
  if (!player.alive) {
    return { ok: false, reason: "not-alive", message: "Dead multiplayer players cannot mutate the shared world." };
  }
  if (intent.intentType !== "touch" && intent.intentType !== "teleport" && intent.intentType !== "level-transition") {
    return {
      ok: false,
      reason: "unsupported",
      message: `Multiplayer world intent "${intent.intentType}" is not authoritative yet.`,
    };
  }
  const entityIndex = "entityIndex" in intent ? intent.entityIndex : undefined;
  if (entityIndex === undefined) {
    return {
      ok: false,
      reason: "missing-entity",
      message: "Multiplayer world intent must name a world entity.",
    };
  }
  const definition = [...definitions].find((candidate) => candidate.entityIndex === entityIndex);
  if (!definition) {
    return {
      ok: false,
      reason: "unknown-entity",
      message: "Multiplayer world intent targets an unknown shared world entity.",
    };
  }
  if (!quakeMultiplayerWorldIntentTouchesDefinition(player, intent, definition)) {
    return {
      ok: false,
      reason: "too-far",
      message: "Multiplayer world intent is too far from the authoritative player position.",
      details: quakeMultiplayerWorldIntentTouchRejectDetails(player, intent, definition),
    };
  }
  if (intent.intentType === "teleport" && definition.kind !== "teleport") {
    return {
      ok: false,
      reason: "wrong-kind",
      message: "Multiplayer teleport intent does not target a teleporter.",
    };
  }
  if (intent.intentType === "level-transition" && definition.kind !== "changelevel") {
    return {
      ok: false,
      reason: "wrong-kind",
      message: "Multiplayer level-transition intent does not target a changelevel trigger.",
    };
  }
  if (
    intent.intentType === "teleport" &&
    "destinationEntityIndex" in intent &&
    intent.destinationEntityIndex !== undefined &&
    intent.destinationEntityIndex !== definition.destinationEntityIndex
  ) {
    return {
      ok: false,
      reason: "destination-mismatch",
      message: "Multiplayer teleport destination does not match the trusted room definition.",
    };
  }
  if (
    intent.intentType === "level-transition" &&
    "targetMap" in intent &&
    intent.targetMap !== undefined &&
    intent.targetMap.trim().toLowerCase() !== definition.targetMap
  ) {
    return {
      ok: false,
      reason: "target-map-mismatch",
      message: "Multiplayer level target does not match the trusted room definition.",
    };
  }
  if (definition.kind === "teleport") {
    return {
      ok: true,
      kind: "teleport",
      definition,
      player: {
        ...player,
        origin: definition.destinationOrigin,
        velocity: quakeMultiplayerTeleportExitVelocity(definition.destinationRotY),
        rotX: definition.destinationRotX,
        rotY: definition.destinationRotY,
        updatedAt: now,
      },
    };
  }
  if (definition.kind === "hurt") {
    return {
      ok: true,
      kind: "hurt",
      definition,
      damage: definition.damage,
    };
  }
  if (definition.kind === "push") {
    return {
      ok: true,
      kind: "push",
      definition,
      player: {
        ...player,
        velocity: definition.velocity,
        updatedAt: now,
      },
    };
  }
  if (definition.kind === "trigger") {
    if (intent.intentType === "touch" && !quakeMultiplayerPlayerFacesTrigger(player, definition)) {
      return {
        ok: false,
        reason: "wrong-facing",
        message: "Multiplayer trigger touch does not match the trusted trigger facing direction.",
      };
    }
    return {
      ok: true,
      kind: "trigger",
      definition,
    };
  }
  if (definition.kind === "mover") {
    if (intent.intentType !== "touch" || !definition.touchActivates) {
      return {
        ok: false,
        reason: "wrong-kind",
        message: "Multiplayer touch intent does not target a touch-activated mover.",
      };
    }
    return {
      ok: true,
      kind: "mover",
      definition,
    };
  }
  return {
    ok: true,
    kind: "changelevel",
    definition,
  };
}

export function quakeMultiplayerWorldIntentRejectionIsIgnorableTouchMiss(
  intent: QuakeMultiplayerWorldIntent,
  reason: string,
): boolean {
  return intent.intentType === "touch" && (reason === "too-far" || reason === "not-alive");
}

export function rejectQuakeMultiplayerClientWorldEvent(
  message: QuakeMultiplayerClientWorldEnvelope,
): QuakeMultiplayerRoomRejectPayload {
  const description = quakeMultiplayerClientWorldDescription(message);
  return {
    code: "unsupported",
    message: `Client-originated ${description.label} "${description.value}" is not authoritative yet.`,
    recoverable: true,
    rejectedMessageId: message.messageId,
    ...(description.details ? { details: description.details } : {}),
  };
}

function quakeMultiplayerClientWorldDescription(
  message: QuakeMultiplayerClientWorldEnvelope,
): { label: string; value: string; details?: Record<string, QuakeMultiplayerJson> } {
  if (message.payload.intent) {
    const intent = message.payload.intent;
    const details: Record<string, QuakeMultiplayerJson> = {
      intentType: intent.intentType,
      worldSequence: intent.worldSequence,
    };
    if ("entityIndex" in intent && intent.entityIndex !== undefined) details.entityIndex = intent.entityIndex;
    if ("targetEntityIndex" in intent && intent.targetEntityIndex !== undefined) {
      details.targetEntityIndex = intent.targetEntityIndex;
    }
    if ("destinationEntityIndex" in intent && intent.destinationEntityIndex !== undefined) {
      details.destinationEntityIndex = intent.destinationEntityIndex;
    }
    if ("targetMap" in intent && intent.targetMap !== undefined) details.targetMap = intent.targetMap;
    return {
      label: "world intent",
      value: intent.intentType,
      details,
    };
  }
  return {
    label: "world change",
    value: message.payload.event.change,
  };
}

function quakeMultiplayerWorldDefinitionFromEntity(
  entity: QuakeEntity,
  scene: QuakeMultiplayerSceneWorldSource,
  entityByIndex: ReadonlyMap<number, QuakeEntity>,
  logicByIndex: ReadonlyMap<number, QuakeMultiplayerWorldLogicEntity>,
  options: QuakeMultiplayerSceneGameplayOptions & { pivot?: QuakeVertex },
): QuakeMultiplayerWorldDefinition | null {
  const logic = logicByIndex.get(entity.index);
  const trigger = logic?.resolvedTrigger;
  if (entity.classname === "trigger_teleport" || trigger?.kind === "trigger_teleport") {
    const destinationIndex = trigger?.kind === "trigger_teleport"
      ? trigger.destinationEntityIndexes?.[0]
      : undefined;
    const fallbackIndex = destinationIndex ??
      (entity.properties.target ? scene.entityManifest?.runtime?.targetEntities?.[entity.properties.target]?.[0] : undefined);
    const destination = fallbackIndex !== undefined ? entityByIndex.get(fallbackIndex) : undefined;
    if (!destination?.origin || fallbackIndex === undefined) return null;
    const origin = quakeMultiplayerPointToRoom(destination.origin, options);
    return {
      kind: "teleport",
      entityIndex: entity.index,
      classname: "trigger_teleport",
      ...(quakeMultiplayerWorldBoundsFromLogic(logic, options) ? {
        bounds: quakeMultiplayerWorldBoundsFromLogic(logic, options),
      } : {}),
      destinationEntityIndex: fallbackIndex,
      destinationOrigin: [
        origin[0],
        origin[1],
        origin[2] + QUAKE_PLAYER_MINS_Z + (options.playerEyeHeight ?? 0),
      ],
      destinationRotX: 90,
      destinationRotY: quakeMultiplayerEntityYaw(destination),
      ...(entity.properties.targetname ? {
        touchRequiresActivation: true,
        activationWindowMs: QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS,
      } : {}),
    };
  }
  if (entity.classname === "trigger_changelevel" || trigger?.kind === "trigger_changelevel") {
    const targetMap = (trigger?.kind === "trigger_changelevel" ? trigger.changelevelMap : entity.properties.map)
      ?.trim()
      .toLowerCase();
    if (!targetMap) return null;
    return {
      kind: "changelevel",
      entityIndex: entity.index,
      classname: "trigger_changelevel",
      ...(quakeMultiplayerWorldBoundsFromLogic(logic, options) ? {
        bounds: quakeMultiplayerWorldBoundsFromLogic(logic, options),
      } : {}),
      targetMap,
    };
  }
  if (entity.classname === "trigger_hurt" || trigger?.kind === "trigger_hurt") {
    const damage = quakeMultiplayerTriggerHurtDamage(entity, trigger);
    if (damage <= 0) return null;
    return {
      kind: "hurt",
      entityIndex: entity.index,
      classname: "trigger_hurt",
      ...(quakeMultiplayerWorldBoundsFromLogic(logic, options) ? {
        bounds: quakeMultiplayerWorldBoundsFromLogic(logic, options),
      } : {}),
      damage,
    };
  }
  if (entity.classname === "trigger_push" || trigger?.kind === "trigger_push") {
    const push = quakeMultiplayerTriggerPushActivation(entity, trigger);
    return {
      kind: "push",
      entityIndex: entity.index,
      classname: "trigger_push",
      ...(quakeMultiplayerWorldBoundsFromLogic(logic, options) ? {
        bounds: quakeMultiplayerWorldBoundsFromLogic(logic, options),
      } : {}),
      ...push,
    };
  }
  if (
    quakeMultiplayerMoverClassname(entity.classname) &&
    logic?.resolvedMover?.kind === entity.classname
  ) {
    const mover = logic.resolvedMover;
    const endpointOrigins = quakeMultiplayerMoverEndpointOrigins(mover);
    if (!endpointOrigins) return null;
    const target = entity.properties.target;
    const killtarget = entity.properties.killtarget;
    const fromOrigin = quakeMultiplayerPointToRoom(endpointOrigins.from, options);
    const toOrigin = quakeMultiplayerPointToRoom(endpointOrigins.to, options);
    const delay = Math.max(0, quakeMultiplayerFiniteNumber(entity.properties.delay, 0));
    const wait = mover.wait ?? mover.waitAtTop;
    const waitMs = quakeMultiplayerSecondsToMs(wait);
    return {
      kind: "mover",
      entityIndex: entity.index,
      classname: entity.classname,
      ...(quakeMultiplayerWorldBoundsFromLogic(logic, options) ? {
        bounds: quakeMultiplayerWorldBoundsFromLogic(logic, options),
      } : {}),
      touchActivates: Boolean(mover.callbacks.touch),
      useActivates: Boolean(mover.callbacks.use),
      shootActivates: Boolean(mover.callbacks.th_die),
      ...(mover.health !== undefined && mover.health > 0 ? { shootHealth: mover.health } : {}),
      speed: mover.speed,
      moveMs: quakeMultiplayerMoverMoveMs(
        mover.travelDistance ?? quakeMultiplayerMoverEndpointDistance(endpointOrigins),
        mover.speed,
      ),
      ...(wait !== undefined && wait >= 0 ? { returnDelayMs: waitMs } : {}),
      delayMs: quakeMultiplayerSecondsToMs(delay),
      fromOrigin,
      toOrigin,
      targetEntityIndexes: target ? [...(scene.entityManifest?.runtime?.targetEntities?.[target] ?? [])] : [],
      ...(killtarget ? {
        killtargetEntityIndexes: [...(scene.entityManifest?.runtime?.targetEntities?.[killtarget] ?? [])],
      } : {}),
      ...(mover.activationSound ? { soundPath: mover.activationSound } : {}),
    };
  }
  if (
    quakeMultiplayerTriggerActivationClassname(entity.classname) &&
    trigger?.kind === entity.classname &&
    (trigger.touchActivates || trigger.useActivates)
  ) {
    const counterMessages = quakeMultiplayerTriggerCounterMessages(trigger);
    const facingDirection = quakeMultiplayerTriggerFacingDirection(entity, trigger);
    return {
      kind: "trigger",
      entityIndex: entity.index,
      classname: entity.classname,
      ...(quakeMultiplayerWorldBoundsFromLogic(logic, options) ? {
        bounds: quakeMultiplayerWorldBoundsFromLogic(logic, options),
      } : {}),
      touchActivates: Boolean(trigger.touchActivates),
      useActivates: Boolean(trigger.useActivates),
      ...(trigger.damageable ? { shootActivates: true } : {}),
      ...(trigger.health !== undefined && trigger.health > 0 ? { shootHealth: trigger.health } : {}),
      oneShot: Boolean(trigger.oneShot),
      delayMs: quakeMultiplayerSecondsToMs(trigger.targetUse?.delay ?? 0),
      waitMs: quakeMultiplayerSecondsToMs(Math.max(0, trigger.wait ?? 0)),
      targetEntityIndexes: trigger.targetUse?.targetEntityIndexes ?? [],
      ...(trigger.targetUse?.killtargetEntityIndexes?.length
        ? { killtargetEntityIndexes: trigger.targetUse.killtargetEntityIndexes }
        : {}),
      ...(facingDirection ? { facingDirection } : {}),
      ...(trigger.count !== undefined ? { count: Math.max(0, Math.floor(trigger.count)) } : {}),
      ...(counterMessages ? { counterMessages } : {}),
      ...(trigger.message ? { message: trigger.message } : {}),
      ...(trigger.activationSound ? { soundPath: trigger.activationSound } : {}),
    };
  }
  return null;
}

function quakeMultiplayerMoverEndpointOrigins(
  mover: NonNullable<QuakeMultiplayerWorldLogicEntity["resolvedMover"]>,
): { from: QuakeVertex; to: QuakeVertex } | null {
  if (mover.pos1Origin && mover.pos2Origin) {
    return { from: mover.pos1Origin, to: mover.pos2Origin };
  }
  if (mover.kind === "func_plat" && (mover.bottomOrigin || mover.topOrigin)) {
    const from = mover.bottomOrigin ?? mover.initialOrigin ?? mover.topOrigin;
    const to = mover.topOrigin ?? mover.initialOrigin ?? mover.bottomOrigin;
    return from && to ? { from, to } : null;
  }
  const from = mover.oldOrigin ?? mover.initialOrigin ?? mover.pos1Origin ?? mover.pos2Origin;
  const to = mover.initialOrigin ?? mover.pos2Origin ?? mover.pos1Origin ?? mover.oldOrigin;
  return from && to ? { from, to } : null;
}

function quakeMultiplayerMoverEndpointDistance(input: { from: QuakeVertex; to: QuakeVertex }): number {
  return Math.hypot(
    input.to.x - input.from.x,
    input.to.y - input.from.y,
    input.to.z - input.from.z,
  );
}

function quakeMultiplayerWorldBoundsFromLogic(
  logic: QuakeMultiplayerWorldLogicEntity | undefined,
  options: QuakeMultiplayerSceneGameplayOptions & { pivot?: QuakeVertex },
): QuakeMultiplayerWorldBounds | undefined {
  const brushModel = logic?.brushModel;
  if (!brushModel?.mins || !brushModel.maxs) return undefined;
  const left = quakeMultiplayerPointToRoom(brushModel.mins, options);
  const right = quakeMultiplayerPointToRoom(brushModel.maxs, options);
  return {
    mins: [
      Math.min(left[0], right[0]),
      Math.min(left[1], right[1]),
      Math.min(left[2], right[2]),
    ],
    maxs: [
      Math.max(left[0], right[0]),
      Math.max(left[1], right[1]),
      Math.max(left[2], right[2]),
    ],
  };
}

function quakeMultiplayerWorldIntentTouchesDefinition(
  player: QuakeMultiplayerAuthoritativePlayerState,
  intent: QuakeMultiplayerWorldIntent,
  definition: QuakeMultiplayerWorldDefinition,
): boolean {
  if (quakeMultiplayerPlayerTouchesWorldDefinition(player, definition)) return true;
  const origin = "origin" in intent ? intent.origin : undefined;
  if (!origin) return false;
  if (!quakeMultiplayerTouchOriginHintWithinDrift(player.origin, origin)) {
    return false;
  }
  return quakeMultiplayerPlayerTouchesWorldDefinition({ origin }, definition);
}

function quakeMultiplayerWorldIntentTouchRejectDetails(
  player: QuakeMultiplayerAuthoritativePlayerState,
  intent: QuakeMultiplayerWorldIntent,
  definition: QuakeMultiplayerWorldDefinition,
): Record<string, QuakeMultiplayerJson> {
  const origin = "origin" in intent ? intent.origin : undefined;
  const horizontalDrift = origin
    ? Math.hypot(player.origin[0] - origin[0], player.origin[1] - origin[1])
    : null;
  const verticalDrift = origin ? Math.abs(player.origin[2] - origin[2]) : null;
  return {
    authoritativeOrigin: player.origin,
    authoritativeTouches: quakeMultiplayerPlayerTouchesWorldDefinition(player, definition),
    definitionKind: definition.kind,
    entityIndex: definition.entityIndex,
    hintOrigin: origin ?? null,
    hintTouches: origin ? quakeMultiplayerPlayerTouchesWorldDefinition({ origin }, definition) : false,
    horizontalDrift,
    hintWithinDrift: origin ? quakeMultiplayerTouchOriginHintWithinDrift(player.origin, origin) : false,
    verticalDrift,
  };
}

function quakeMultiplayerTouchOriginHintWithinDrift(
  authoritativeOrigin: QuakeMultiplayerVec3,
  hintOrigin: QuakeMultiplayerVec3,
): boolean {
  const horizontalDrift = Math.hypot(
    authoritativeOrigin[0] - hintOrigin[0],
    authoritativeOrigin[1] - hintOrigin[1],
  );
  const verticalDrift = Math.abs(authoritativeOrigin[2] - hintOrigin[2]);
  return horizontalDrift <= QUAKE_MULTIPLAYER_WORLD_TOUCH_ORIGIN_HINT_MAX_HORIZONTAL_DRIFT &&
    verticalDrift <= QUAKE_MULTIPLAYER_WORLD_TOUCH_ORIGIN_HINT_MAX_VERTICAL_DRIFT;
}

function quakeMultiplayerPlayerTouchesWorldDefinition(
  player: Pick<QuakeMultiplayerAuthoritativePlayerState, "origin">,
  definition: QuakeMultiplayerWorldDefinition,
): boolean {
  if (!definition.bounds) return true;
  return quakeMultiplayerBoundsOverlap(
    quakeMultiplayerPlayerEyeBounds(
      player.origin,
      QUAKE_MULTIPLAYER_WORLD_TOUCH_TOLERANCE,
      QUAKE_MULTIPLAYER_PLAYER_EYE_HEIGHT,
    ),
    definition.bounds,
  );
}

function quakeMultiplayerPointInBounds(
  point: QuakeMultiplayerVec3,
  bounds: QuakeMultiplayerWorldBounds,
  tolerance: number,
): boolean {
  return point[0] >= bounds.mins[0] - tolerance &&
    point[0] <= bounds.maxs[0] + tolerance &&
    point[1] >= bounds.mins[1] - tolerance &&
    point[1] <= bounds.maxs[1] + tolerance &&
    point[2] >= bounds.mins[2] - tolerance &&
    point[2] <= bounds.maxs[2] + tolerance;
}

function quakeMultiplayerSceneWorldOptions(
  scene: QuakeMultiplayerSceneWorldSource,
  options: QuakeMultiplayerSceneGameplayOptions,
): QuakeMultiplayerSceneGameplayOptions & { pivot?: QuakeVertex } {
  return {
    ...options,
    ...(options.playerEyeHeight === undefined && scene.spawn?.eyeHeight !== undefined
      ? { playerEyeHeight: scene.spawn.eyeHeight }
      : {}),
    ...(scene.collision?.pivot ? { pivot: scene.collision.pivot } : {}),
  };
}

function quakeMultiplayerEntityYaw(entity: QuakeEntity): number {
  const value = quakeMultiplayerEntityAngle(entity);
  const angle = Number.isFinite(value) ? value : 0;
  return (180 + angle + 360) % 360;
}

function quakeMultiplayerEntityAngle(entity: QuakeEntity): number | undefined {
  const value = typeof entity.angle === "number"
    ? entity.angle
    : entity.properties.angle !== undefined
      ? Number.parseFloat(entity.properties.angle)
      : undefined;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function quakeMultiplayerTriggerHurtDamage(
  entity: QuakeEntity,
  trigger: QuakeMultiplayerWorldLogicEntity["resolvedTrigger"] | undefined,
): number {
  if (trigger?.kind === "trigger_hurt") {
    return quakeMultiplayerNonNegativeNumber(trigger.dmg, QUAKE_MULTIPLAYER_TRIGGER_HURT_DEFAULT_DAMAGE);
  }
  return quakeMultiplayerNonNegativeNumber(entity.properties.dmg, QUAKE_MULTIPLAYER_TRIGGER_HURT_DEFAULT_DAMAGE);
}

function quakeMultiplayerTriggerPushActivation(
  entity: QuakeEntity,
  trigger: QuakeMultiplayerWorldLogicEntity["resolvedTrigger"] | undefined,
): {
  direction: QuakeMultiplayerVec3;
  speed: number;
  velocity: QuakeMultiplayerVec3;
  oneShot: boolean;
} {
  const direction = trigger?.kind === "trigger_push" && trigger.moveDirection
    ? quakeMultiplayerVectorTuple(trigger.moveDirection)
    : quakeMultiplayerMoveDirection(entity);
  const speed = trigger?.kind === "trigger_push"
    ? quakeMultiplayerPositiveNumber(trigger.speed, QUAKE_MULTIPLAYER_TRIGGER_PUSH_DEFAULT_SPEED)
    : quakeMultiplayerPositiveNumber(entity.properties.speed, QUAKE_MULTIPLAYER_TRIGGER_PUSH_DEFAULT_SPEED);
  const multiplier = trigger?.kind === "trigger_push"
    ? quakeMultiplayerFiniteNumber(
        trigger.pushVelocityMultiplier,
        QUAKE_MULTIPLAYER_TRIGGER_PUSH_VELOCITY_MULTIPLIER,
      )
    : QUAKE_MULTIPLAYER_TRIGGER_PUSH_VELOCITY_MULTIPLIER;
  return {
    direction,
    speed,
    velocity: [
      direction[0] * speed * multiplier * QUAKE_COLLISION_UNIT_SCALE,
      direction[1] * speed * multiplier * QUAKE_COLLISION_UNIT_SCALE,
      direction[2] * speed * multiplier * QUAKE_COLLISION_UNIT_SCALE,
    ],
    oneShot: trigger?.kind === "trigger_push"
      ? Boolean(trigger.oneShot)
      : (quakeMultiplayerEntitySpawnflags(entity) & QUAKE_MULTIPLAYER_TRIGGER_PUSH_ONCE) !== 0,
  };
}

function quakeMultiplayerTriggerFacingDirection(
  entity: QuakeEntity,
  trigger: QuakeMultiplayerWorldLogicEntity["resolvedTrigger"] | undefined,
): QuakeMultiplayerVec3 | undefined {
  if (!trigger?.touchActivates) return undefined;
  if (!quakeMultiplayerTriggerUsesFacingDirection(entity.classname)) return undefined;
  const angle = quakeMultiplayerEntityAngle(entity);
  if (angle === undefined || angle === 0) return undefined;
  return quakeMultiplayerMoveDirectionFromAngle(angle);
}

function quakeMultiplayerTriggerUsesFacingDirection(classname: string): boolean {
  return classname === "trigger_multiple" ||
    classname === "trigger_once" ||
    classname === "trigger_secret";
}

function quakeMultiplayerNonNegativeNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseFloat(value)
      : fallback;
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
}

function quakeMultiplayerPositiveNumber(value: unknown, fallback: number): number {
  const numeric = quakeMultiplayerFiniteNumber(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function quakeMultiplayerFiniteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseFloat(value)
      : fallback;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function quakeMultiplayerMoveDirection(entity: QuakeEntity): QuakeMultiplayerVec3 {
  const angle = quakeMultiplayerFiniteNumber(entity.properties.angle, entity.angle ?? 0);
  return quakeMultiplayerMoveDirectionFromAngle(angle);
}

function quakeMultiplayerMoveDirectionFromAngle(angle: number): QuakeMultiplayerVec3 {
  if (angle === -1) return [0, 0, 1];
  if (angle === -2) return [0, 0, -1];
  const radians = (angle * Math.PI) / 180;
  return [
    quakeMultiplayerZeroNear(Math.cos(radians)),
    quakeMultiplayerZeroNear(Math.sin(radians)),
    0,
  ];
}

export function quakeMultiplayerTeleportExitVelocity(rotY: number): QuakeMultiplayerVec3 {
  const radians = (quakeMultiplayerFiniteNumber(rotY, 180) * Math.PI) / 180;
  return [
    quakeMultiplayerZeroNear(-Math.cos(radians) * QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED),
    quakeMultiplayerZeroNear(-Math.sin(radians) * QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED),
    0,
  ];
}

export function quakeMultiplayerPlayerIntersectsTelefragVolume(
  player: QuakeMultiplayerAuthoritativePlayerState,
  destinationOrigin: QuakeMultiplayerVec3,
  playerEyeHeight = QUAKE_MULTIPLAYER_PLAYER_EYE_HEIGHT,
): boolean {
  if (!player.alive) return false;
  return quakeMultiplayerBoundsOverlap(
    quakeMultiplayerPlayerEyeBounds(player.origin, 0, playerEyeHeight),
    quakeMultiplayerPlayerEyeBounds(
      destinationOrigin,
      QUAKE_MULTIPLAYER_TELEFRAG_TRIGGER_EXPAND,
      playerEyeHeight,
    ),
  );
}

export function quakeMultiplayerPlayerFacesTrigger(
  player: Pick<QuakeMultiplayerAuthoritativePlayerState, "rotY">,
  definition: Pick<Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>, "facingDirection">,
): boolean {
  if (!definition.facingDirection) return true;
  return quakeMultiplayerVec3Dot(
    quakeMultiplayerPlayerForwardFromYaw(player.rotY),
    definition.facingDirection,
  ) >= 0;
}

function quakeMultiplayerPlayerEyeBounds(
  origin: QuakeMultiplayerVec3,
  expand: number,
  playerEyeHeight: number,
): QuakeMultiplayerWorldBounds {
  return {
    mins: [
      origin[0] - PLAYER_RADIUS - expand,
      origin[1] - PLAYER_RADIUS - expand,
      origin[2] - playerEyeHeight - expand,
    ],
    maxs: [
      origin[0] + PLAYER_RADIUS + expand,
      origin[1] + PLAYER_RADIUS + expand,
      origin[2] - playerEyeHeight + PLAYER_HEIGHT + expand,
    ],
  };
}

function quakeMultiplayerBoundsOverlap(
  left: QuakeMultiplayerWorldBounds,
  right: QuakeMultiplayerWorldBounds,
): boolean {
  return left.mins[0] <= right.maxs[0] &&
    left.maxs[0] >= right.mins[0] &&
    left.mins[1] <= right.maxs[1] &&
    left.maxs[1] >= right.mins[1] &&
    left.mins[2] <= right.maxs[2] &&
    left.maxs[2] >= right.mins[2];
}

function quakeMultiplayerPlayerForwardFromYaw(rotY: number): QuakeMultiplayerVec3 {
  const radians = (quakeMultiplayerFiniteNumber(rotY, 0) * Math.PI) / 180;
  return [
    quakeMultiplayerZeroNear(-Math.cos(radians)),
    quakeMultiplayerZeroNear(-Math.sin(radians)),
    0,
  ];
}

function quakeMultiplayerVec3Dot(left: QuakeMultiplayerVec3, right: QuakeMultiplayerVec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function quakeMultiplayerZeroNear(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

function quakeMultiplayerVectorTuple(vector: QuakeVertex): QuakeMultiplayerVec3 {
  return [vector.x, vector.y, vector.z];
}

function quakeMultiplayerEntitySpawnflags(entity: QuakeEntity): number {
  const value = Number.parseInt(entity.properties.spawnflags ?? "0", 10);
  return Number.isFinite(value) ? value : 0;
}

function quakeMultiplayerTriggerActivationClassname(
  classname: string,
): classname is QuakeMultiplayerTriggerActivationClassname {
  return QUAKE_MULTIPLAYER_TRIGGER_ACTIVATION_CLASSNAMES.has(
    classname as QuakeMultiplayerTriggerActivationClassname,
  );
}

function quakeMultiplayerMoverClassname(
  classname: string,
): classname is QuakeMultiplayerMoverClassname {
  return QUAKE_MULTIPLAYER_MOVER_CLASSNAMES.has(
    classname as QuakeMultiplayerMoverClassname,
  );
}

function quakeMultiplayerMoverMoveMs(distance: number, speed: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(speed) || speed <= 0) return 0;
  const travelMs = Math.max(0, Math.round((distance / speed) * 1000));
  return travelMs < QUAKE_MULTIPLAYER_SUB_CALC_MOVE_MIN_MS
    ? QUAKE_MULTIPLAYER_SUB_CALC_MOVE_MIN_MS
    : travelMs;
}

function quakeMultiplayerTriggerCounterMessages(
  trigger: QuakeMultiplayerWorldLogicEntity["resolvedTrigger"],
): QuakeMultiplayerTriggerCounterMessage[] | undefined {
  if (trigger?.kind !== "trigger_counter") return undefined;
  const messages: QuakeMultiplayerTriggerCounterMessage[] = [];
  for (const fact of trigger.generatedText ?? []) {
    if (
      fact.lane !== "centerprint" ||
      (fact.reason !== "counter-remaining" && fact.reason !== "counter-complete")
    ) {
      continue;
    }
    const message = fact.text.trim();
    if (!message) continue;
    const remaining = quakeMultiplayerNonNegativeIntegerCondition(fact.condition?.remaining);
    const minRemaining = quakeMultiplayerNonNegativeIntegerCondition(fact.condition?.minRemaining);
    messages.push({
      message,
      ...(remaining !== undefined ? { remaining } : {}),
      ...(minRemaining !== undefined ? { minRemaining } : {}),
    });
  }
  return messages.length ? messages : undefined;
}

function quakeMultiplayerNonNegativeIntegerCondition(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function quakeMultiplayerSecondsToMs(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1000));
}

function quakeMultiplayerNormalizedVec3(value: QuakeMultiplayerVec3): QuakeMultiplayerVec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= 0) return null;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function quakeMultiplayerRayBoundsDistance(
  origin: QuakeMultiplayerVec3,
  direction: QuakeMultiplayerVec3,
  range: number,
  bounds: QuakeMultiplayerWorldBounds,
): number | null {
  let enter = 0;
  let exit = range;
  for (let axis = 0; axis < 3; axis++) {
    const originAxis = origin[axis] ?? 0;
    const directionAxis = direction[axis] ?? 0;
    const minAxis = bounds.mins[axis] ?? 0;
    const maxAxis = bounds.maxs[axis] ?? 0;
    if (Math.abs(directionAxis) < 1e-8) {
      if (originAxis < minAxis || originAxis > maxAxis) return null;
      continue;
    }
    const t1 = (minAxis - originAxis) / directionAxis;
    const t2 = (maxAxis - originAxis) / directionAxis;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) return null;
  }
  return enter >= 0 && enter <= range ? enter : null;
}

export function sameQuakeMultiplayerMoverOffset(
  left: QuakeMultiplayerVec3 | undefined,
  right: QuakeMultiplayerVec3,
): boolean {
  return Boolean(left) &&
    Math.abs(left![0] - right[0]) <= QUAKE_MULTIPLAYER_MOVER_OFFSET_EPSILON &&
    Math.abs(left![1] - right[1]) <= QUAKE_MULTIPLAYER_MOVER_OFFSET_EPSILON &&
    Math.abs(left![2] - right[2]) <= QUAKE_MULTIPLAYER_MOVER_OFFSET_EPSILON;
}

type QuakeMultiplayerWorldLogicEntity = {
  entityIndex: number;
  brushModel?: {
    mins?: QuakeVertex;
    maxs?: QuakeVertex;
  };
  resolvedTrigger?: {
    kind: string;
    destinationEntityIndexes?: number[];
    changelevelMap?: string;
    dmg?: number;
    speed?: number;
    moveDirection?: QuakeVertex;
    pushVelocityMultiplier?: number;
    oneShot?: boolean;
    touchActivates?: boolean;
    useActivates?: boolean;
    wait?: number;
    count?: number;
    message?: string;
    generatedText?: readonly QuakeGameLogicGeneratedTextFact[];
    activationSound?: string;
    health?: number;
    damageable?: boolean;
    targetUse?: {
      delay: number;
      targetEntityIndexes: number[];
      killtargetEntityIndexes?: number[];
    };
  };
  resolvedMover?: {
    kind: string;
    speed: number;
    wait?: number;
    waitAtTop?: number;
    pos1Origin?: QuakeVertex;
    pos2Origin?: QuakeVertex;
    topOrigin?: QuakeVertex;
    bottomOrigin?: QuakeVertex;
    initialOrigin?: QuakeVertex;
    oldOrigin?: QuakeVertex;
    travelDistance?: number;
    activationSound?: string;
    health?: number;
    callbacks: {
      use?: string;
      touch?: string;
      th_die?: string;
    };
  };
};
