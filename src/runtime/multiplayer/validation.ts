import {
  QUAKE_MULTIPLAYER_PROTOCOL_VERSION,
  sameQuakeMultiplayerRoomCompatibilityKey,
} from "./protocol";
import type {
  QuakeMultiplayerAnyEnvelope,
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerClientEnvelope,
  QuakeMultiplayerClientMessageType,
  QuakeMultiplayerAuthoritativePickupState,
  QuakeMultiplayerFireIntent,
  QuakeMultiplayerFireKind,
  QuakeMultiplayerInventoryState,
  QuakeMultiplayerJson,
  QuakeMultiplayerLocalInputIntent,
  QuakeMultiplayerMapGameplayFacts,
  QuakeMultiplayerMatchIntent,
  QuakeMultiplayerMessageDirection,
  QuakeMultiplayerMessageType,
  QuakeMultiplayerMoveIntent,
  QuakeMultiplayerPickupDefinition,
  QuakeMultiplayerPickupEffect,
  QuakeMultiplayerPickupIntent,
  QuakeMultiplayerPickupLifecycle,
  QuakeMultiplayerPlayerPresenceStatus,
  QuakeMultiplayerPoseSample,
  QuakeMultiplayerProtocolVersion,
  QuakeMultiplayerRejectCode,
  QuakeMultiplayerRoomCompatibilityKey,
  QuakeMultiplayerRoomEnvelope,
  QuakeMultiplayerRoomMatchState,
  QuakeMultiplayerRoomMessageType,
  QuakeMultiplayerSpawnPoint,
  QuakeMultiplayerSharedWorldEvent,
  QuakeMultiplayerVec3,
  QuakeMultiplayerWorldIntent,
} from "./protocol";

const CLIENT_MESSAGE_TYPES = new Set<QuakeMultiplayerClientMessageType>([
  "client.hello",
  "client.presence",
  "client.input",
  "client.fire",
  "client.damage",
  "client.pickup",
  "client.match",
  "client.world",
  "client.pose",
  "client.ping",
  "client.pong",
]);

const ROOM_MESSAGE_TYPES = new Set<QuakeMultiplayerRoomMessageType>([
  "room.snapshot",
  "room.event",
  "room.reject",
  "room.error",
  "room.ping",
  "room.pong",
]);

const PRESENCE_STATUSES = new Set<QuakeMultiplayerPlayerPresenceStatus>([
  "active",
  "input-paused",
  "backgrounded",
  "disconnecting",
]);

const REJECT_CODES = new Set<QuakeMultiplayerRejectCode>([
  "malformed",
  "stale",
  "wrong-map",
  "wrong-protocol",
  "room-full",
  "not-authorized",
  "unsupported",
]);

const MATCH_STATUSES = new Set<QuakeMultiplayerRoomMatchState["status"]>([
  "waiting",
  "warmup",
  "active",
  "intermission",
]);

const SPAWN_CLASSNAMES = new Set<QuakeMultiplayerSpawnPoint["classname"]>([
  "info_player_deathmatch",
  "info_player_coop",
  "info_player_start",
]);

const FIRE_KINDS = new Set<QuakeMultiplayerFireKind>([
  "hitscan",
  "melee",
  "projectile",
  "beam",
]);

const TRIGGER_ACTIVATION_CLASSNAMES = new Set([
  "trigger_multiple",
  "trigger_once",
  "trigger_secret",
  "trigger_counter",
  "trigger_relay",
]);

const MOVER_CLASSNAMES = new Set([
  "func_button",
]);

export type QuakeMultiplayerValidationCode =
  | "malformed"
  | "stale"
  | "wrong-map"
  | "wrong-protocol";

export interface QuakeMultiplayerValidationContext {
  roomKey: QuakeMultiplayerRoomCompatibilityKey;
  now?: number;
  maxMessageAgeMs?: number;
  maxFutureSkewMs?: number;
  minimumSequence?: number;
  protocolVersion?: QuakeMultiplayerProtocolVersion;
}

export type QuakeMultiplayerValidationResult<TEnvelope> =
  | { ok: true; envelope: TEnvelope }
  | { ok: false; code: QuakeMultiplayerValidationCode; reason: string };

export function validateQuakeMultiplayerClientEnvelope(
  value: unknown,
  context: QuakeMultiplayerValidationContext,
): QuakeMultiplayerValidationResult<QuakeMultiplayerClientEnvelope> {
  const result = validateQuakeMultiplayerEnvelope(value, context, "client");
  if (!result.ok) return result;
  return CLIENT_MESSAGE_TYPES.has(result.envelope.type as QuakeMultiplayerClientMessageType) &&
    isClientPayload(result.envelope.type, result.envelope.payload)
    ? { ok: true, envelope: result.envelope as QuakeMultiplayerClientEnvelope }
    : fail("malformed", "Client multiplayer payload does not match its message type.");
}

export function validateQuakeMultiplayerRoomEnvelope(
  value: unknown,
  context: QuakeMultiplayerValidationContext,
): QuakeMultiplayerValidationResult<QuakeMultiplayerRoomEnvelope> {
  const result = validateQuakeMultiplayerEnvelope(value, context, "room");
  if (!result.ok) return result;
  return ROOM_MESSAGE_TYPES.has(result.envelope.type as QuakeMultiplayerRoomMessageType) &&
    isRoomPayload(result.envelope.type, result.envelope.payload)
    ? { ok: true, envelope: result.envelope as QuakeMultiplayerRoomEnvelope }
    : fail("malformed", "Room multiplayer payload does not match its message type.");
}

export function validateQuakeMultiplayerAnyEnvelope(
  value: unknown,
  context: QuakeMultiplayerValidationContext,
): QuakeMultiplayerValidationResult<QuakeMultiplayerAnyEnvelope> {
  if (!isRecord(value) || (value.direction !== "client" && value.direction !== "room")) {
    return fail("malformed", "Multiplayer envelope direction is missing or invalid.");
  }
  return value.direction === "client"
    ? validateQuakeMultiplayerClientEnvelope(value, context)
    : validateQuakeMultiplayerRoomEnvelope(value, context);
}

function validateQuakeMultiplayerEnvelope(
  value: unknown,
  context: QuakeMultiplayerValidationContext,
  direction: QuakeMultiplayerMessageDirection,
): QuakeMultiplayerValidationResult<QuakeMultiplayerAnyEnvelope> {
  if (!isRecord(value)) return fail("malformed", "Multiplayer message must be an object.");
  const expectedProtocol = context.protocolVersion ?? QUAKE_MULTIPLAYER_PROTOCOL_VERSION;
  if (value.protocolVersion !== expectedProtocol) {
    return fail("wrong-protocol", "Multiplayer message protocol version does not match this client.");
  }
  if (value.direction !== direction) {
    return fail("malformed", `Expected a ${direction} multiplayer message.`);
  }
  if (!isMessageTypeForDirection(value.type, direction)) {
    return fail("malformed", "Multiplayer message type is missing or invalid for its direction.");
  }
  if (!isNonEmptyString(value.messageId)) {
    return fail("malformed", "Multiplayer message id is missing or empty.");
  }
  if (!isNonNegativeInteger(value.sequence)) {
    return fail("malformed", "Multiplayer message sequence must be a non-negative integer.");
  }
  if (typeof context.minimumSequence === "number" && value.sequence < context.minimumSequence) {
    return fail("stale", "Multiplayer message sequence is older than the accepted window.");
  }
  if (!Number.isFinite(value.sentAt)) {
    return fail("malformed", "Multiplayer message timestamp must be finite.");
  }
  const timestampResult = validateMessageTimestamp(
    value.sentAt,
    context.now ?? Date.now(),
    context.maxMessageAgeMs ?? 15_000,
    context.maxFutureSkewMs ?? 5_000,
  );
  if (timestampResult) return timestampResult;
  if (!isRoomCompatibilityKey(value.roomKey)) {
    return fail("malformed", "Multiplayer room compatibility key is missing or invalid.");
  }
  if (!sameQuakeMultiplayerRoomCompatibilityKey(value.roomKey, context.roomKey)) {
    if (
      direction === "room" &&
      value.type === "room.reject" &&
      isRoomPayload(value.type, value.payload) &&
      isRecord(value.payload) &&
      value.payload.code === "wrong-map"
    ) {
      return { ok: true, envelope: value as QuakeMultiplayerAnyEnvelope };
    }
    return fail("wrong-map", "Multiplayer room compatibility key does not match the current map/assets.");
  }
  if (!("payload" in value)) return fail("malformed", "Multiplayer message payload is missing.");
  return { ok: true, envelope: value as QuakeMultiplayerAnyEnvelope };
}

function validateMessageTimestamp(
  sentAt: number,
  now: number,
  maxMessageAgeMs: number,
  maxFutureSkewMs: number,
): QuakeMultiplayerValidationResult<never> | null {
  if (sentAt < now - maxMessageAgeMs) {
    return fail("stale", "Multiplayer message is older than the accepted time window.");
  }
  if (sentAt > now + maxFutureSkewMs) {
    return fail("stale", "Multiplayer message timestamp is too far in the future.");
  }
  return null;
}

function isMessageTypeForDirection(value: unknown, direction: QuakeMultiplayerMessageDirection): value is QuakeMultiplayerMessageType {
  if (typeof value !== "string") return false;
  return direction === "client"
    ? CLIENT_MESSAGE_TYPES.has(value as QuakeMultiplayerClientMessageType)
    : ROOM_MESSAGE_TYPES.has(value as QuakeMultiplayerRoomMessageType);
}

function isClientPayload(type: QuakeMultiplayerMessageType, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  switch (type) {
    case "client.hello":
      return isNonEmptyString(payload.clientId) &&
        isNonEmptyString(payload.displayName) &&
        (payload.color === undefined || isPlayerColor(payload.color)) &&
        (payload.matchSettings === undefined || isMatchSettings(payload.matchSettings)) &&
        (payload.capabilities === undefined ||
          (Array.isArray(payload.capabilities) && payload.capabilities.every(isNonEmptyString))) &&
        (payload.gameplayFacts === undefined || isGameplayFacts(payload.gameplayFacts)) &&
        (payload.deathmatchSpawns === undefined ||
          (Array.isArray(payload.deathmatchSpawns) &&
            payload.deathmatchSpawns.length <= 128 &&
            payload.deathmatchSpawns.every(isSpawnPoint))) &&
        (payload.pickupDefinitions === undefined ||
          (Array.isArray(payload.pickupDefinitions) &&
            payload.pickupDefinitions.length <= 1024 &&
            payload.pickupDefinitions.every(isPickupDefinition)));
    case "client.presence":
      return isNonEmptyString(payload.clientId) &&
        PRESENCE_STATUSES.has(payload.status as QuakeMultiplayerPlayerPresenceStatus);
    case "client.input":
      return isNonEmptyString(payload.clientId) && isLocalInputIntent(payload.input);
    case "client.fire":
      return isNonEmptyString(payload.clientId) && isFireIntent(payload.fire);
    case "client.damage":
      return isNonEmptyString(payload.clientId) && isDamageIntent(payload.damage);
    case "client.pickup":
      return isNonEmptyString(payload.clientId) && isPickupIntent(payload.pickup);
    case "client.match":
      return isNonEmptyString(payload.clientId) && isMatchIntent(payload.match);
    case "client.world":
      return isNonEmptyString(payload.clientId) &&
        (
          (payload.event === undefined && isWorldIntent(payload.intent)) ||
          (payload.intent === undefined &&
            isSharedWorldEvent(payload.event) &&
            payload.event.eventType === "world.changed")
        );
    case "client.pose":
      return isNonEmptyString(payload.clientId) && payload.prototypeOnly === true && isPoseSample(payload.pose);
    case "client.ping":
      return isPingPayload(payload);
    case "client.pong":
      return isPongPayload(payload);
    default:
      return false;
  }
}

function isRoomPayload(type: QuakeMultiplayerMessageType, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  switch (type) {
    case "room.snapshot":
      return isNonEmptyString(payload.roomId) &&
        isNonNegativeInteger(payload.tick) &&
        Number.isFinite(payload.roomTime) &&
        isRoomMatchState(payload.match) &&
        Array.isArray(payload.players) &&
        payload.players.every(isAuthoritativePlayerState) &&
        (payload.pickups === undefined ||
          (Array.isArray(payload.pickups) && payload.pickups.every(isAuthoritativePickupState))) &&
        isNonNegativeInteger(payload.lastWorldEventSequence);
    case "room.event":
      return isNonEmptyString(payload.roomId) &&
        isNonNegativeInteger(payload.tick) &&
        isNonNegativeInteger(payload.sequence) &&
        isSharedWorldEvent(payload.event);
    case "room.reject":
      return REJECT_CODES.has(payload.code as QuakeMultiplayerRejectCode) &&
        isNonEmptyString(payload.message) &&
        typeof payload.recoverable === "boolean" &&
        (payload.rejectedMessageId === undefined || isNonEmptyString(payload.rejectedMessageId)) &&
        (payload.retryAfterMs === undefined || isNonNegativeFiniteNumber(payload.retryAfterMs)) &&
        (payload.details === undefined || isJsonRecord(payload.details));
    case "room.error":
      return isNonEmptyString(payload.code) &&
        isNonEmptyString(payload.message) &&
        typeof payload.recoverable === "boolean" &&
        (payload.details === undefined || isJsonRecord(payload.details));
    case "room.ping":
      return isPingPayload(payload);
    case "room.pong":
      return isPongPayload(payload);
    default:
      return false;
  }
}

function isRoomCompatibilityKey(value: unknown): value is QuakeMultiplayerRoomCompatibilityKey {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.mapName) &&
    Number.isFinite(value.assetManifestVersion) &&
    isNonEmptyString(value.assetRoot) &&
    isNonEmptyString(value.sceneUrl) &&
    (value.preparedSceneVersion === undefined || Number.isFinite(value.preparedSceneVersion)) &&
    (value.gameLogicVersion === undefined || Number.isFinite(value.gameLogicVersion));
}

function isGameplayFacts(value: unknown): value is QuakeMultiplayerMapGameplayFacts {
  if (!isRecord(value)) return false;
  return isPositiveInteger(value.factsVersion) &&
    isNonEmptyString(value.factsHash) &&
    /^[0-9a-f]{16}$/i.test(value.factsHash) &&
    isNonNegativeInteger(value.deathmatchSpawnCount) &&
    value.deathmatchSpawnCount <= 128 &&
    isNonNegativeInteger(value.pickupCount) &&
    value.pickupCount <= 1024;
}

function isLocalInputIntent(value: unknown): value is QuakeMultiplayerLocalInputIntent {
  if (!isRecord(value)) return false;
  return isNonNegativeInteger(value.inputSequence) &&
    Number.isFinite(value.sampledAt) &&
    isNonNegativeFiniteNumber(value.dt) &&
    isMoveIntent(value.move) &&
    isButtonIntent(value.buttons) &&
    Number.isFinite(value.rotX) &&
    Number.isFinite(value.rotY) &&
    (value.activeWeapon === undefined || isNonEmptyString(value.activeWeapon));
}

function isMoveIntent(value: unknown): value is QuakeMultiplayerMoveIntent {
  if (!isRecord(value)) return false;
  return Number.isFinite(value.forward) && Number.isFinite(value.side) && Number.isFinite(value.up);
}

function isButtonIntent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.attack === "boolean" &&
    typeof value.jump === "boolean" &&
    typeof value.use === "boolean";
}

function isPoseSample(value: unknown): value is QuakeMultiplayerPoseSample {
  if (!isRecord(value)) return false;
  return isNonNegativeInteger(value.poseSequence) &&
    Number.isFinite(value.sampledAt) &&
    isVec3(value.origin) &&
    (value.velocity === undefined || isVec3(value.velocity)) &&
    Number.isFinite(value.rotX) &&
    Number.isFinite(value.rotY) &&
    typeof value.grounded === "boolean" &&
    typeof value.alive === "boolean";
}

function isFireIntent(value: unknown): value is QuakeMultiplayerFireIntent {
  if (!isRecord(value)) return false;
  return isNonNegativeInteger(value.fireSequence) &&
    Number.isFinite(value.firedAt) &&
    isNonEmptyString(value.weapon) &&
    FIRE_KINDS.has(value.fireKind as QuakeMultiplayerFireKind) &&
    isVec3(value.origin) &&
    isVec3(value.direction) &&
    isNonNegativeFiniteNumber(value.range);
}

function isDamageIntent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonNegativeInteger(value.damageSequence) &&
    Number.isFinite(value.damagedAt) &&
    isNonNegativeFiniteNumber(value.amount) &&
    isNonEmptyString(value.source);
}

function isPickupIntent(value: unknown): value is QuakeMultiplayerPickupIntent {
  if (!isRecord(value)) return false;
  return isNonNegativeInteger(value.pickupSequence) &&
    Number.isFinite(value.requestedAt) &&
    isNonNegativeInteger(value.entityIndex);
}

function isMatchIntent(value: unknown): value is QuakeMultiplayerMatchIntent {
  if (!isRecord(value)) return false;
  return isNonNegativeInteger(value.matchSequence) &&
    Number.isFinite(value.requestedAt) &&
    value.action === "restart";
}

function isWorldIntent(value: unknown): value is QuakeMultiplayerWorldIntent {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.intentType) ||
    !isNonNegativeInteger(value.worldSequence) ||
    !Number.isFinite(value.requestedAt)
  ) {
    return false;
  }
  switch (value.intentType) {
    case "use":
      return isVec3(value.origin) &&
        isVec3(value.direction) &&
        isNonNegativeFiniteNumber(value.range) &&
        (value.targetEntityId === undefined || isNonEmptyString(value.targetEntityId)) &&
        (value.targetEntityIndex === undefined || isNonNegativeInteger(value.targetEntityIndex));
    case "touch":
      return isNonNegativeInteger(value.entityIndex) && isVec3(value.origin);
    case "teleport":
      return isNonNegativeInteger(value.entityIndex) &&
        isVec3(value.origin) &&
        isVec3(value.velocity) &&
        (value.destinationEntityId === undefined || isNonEmptyString(value.destinationEntityId)) &&
        (value.destinationEntityIndex === undefined || isNonNegativeInteger(value.destinationEntityIndex));
    case "level-transition":
      return (value.entityId === undefined || isNonEmptyString(value.entityId)) &&
        (value.entityIndex === undefined || isNonNegativeInteger(value.entityIndex)) &&
        (value.origin === undefined || isVec3(value.origin)) &&
        (value.targetMap === undefined || isNonEmptyString(value.targetMap));
    default:
      return false;
  }
}

function isPickupDefinition(value: unknown): value is QuakeMultiplayerPickupDefinition {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.pickupId) &&
    isNonNegativeInteger(value.entityIndex) &&
    isNonEmptyString(value.classname) &&
    isVec3(value.origin) &&
    isPickupEffect(value.effect) &&
    (value.lifecycle === undefined || isPickupLifecycle(value.lifecycle)) &&
    (value.feedback === undefined || (
      isRecord(value.feedback) &&
      (value.feedback.message === undefined || isNonEmptyString(value.feedback.message)) &&
      (value.feedback.soundPath === undefined || isNonEmptyString(value.feedback.soundPath))
    )) &&
    (value.targetEntityIndexes === undefined || isNonNegativeIntegerArray(value.targetEntityIndexes)) &&
    (value.killtargetEntityIndexes === undefined || isNonNegativeIntegerArray(value.killtargetEntityIndexes)) &&
    (value.delayMs === undefined || isNonNegativeFiniteNumber(value.delayMs)) &&
    (value.message === undefined || isNonEmptyString(value.message));
}

function isPickupLifecycle(value: unknown): value is QuakeMultiplayerPickupLifecycle {
  if (!isRecord(value)) return false;
  return (value.action === "leave" || value.action === "remove" || value.action === "respawn") &&
    isNonEmptyString(value.condition) &&
    (value.delayMs === undefined || isNonNegativeFiniteNumber(value.delayMs));
}

function isPickupEffect(value: unknown): value is QuakeMultiplayerPickupEffect {
  if (!isRecord(value)) return false;
  return (value.health === undefined || Number.isFinite(value.health)) &&
    (value.healthMax === undefined || isNonNegativeFiniteNumber(value.healthMax)) &&
    (value.armor === undefined || isNonNegativeFiniteNumber(value.armor)) &&
    (value.armorType === undefined || isNonNegativeFiniteNumber(value.armorType)) &&
    (value.shells === undefined || isNonNegativeFiniteNumber(value.shells)) &&
    (value.nails === undefined || isNonNegativeFiniteNumber(value.nails)) &&
    (value.rockets === undefined || isNonNegativeFiniteNumber(value.rockets)) &&
    (value.cells === undefined || isNonNegativeFiniteNumber(value.cells)) &&
    (value.key === undefined || isNonEmptyString(value.key)) &&
    (value.powerup === undefined || isPowerupEffect(value.powerup)) &&
    (value.weapon === undefined || (
      isRecord(value.weapon) &&
      isNonEmptyString(value.weapon.id) &&
      (value.weapon.itemFlag === undefined || isNonNegativeFiniteNumber(value.weapon.itemFlag)) &&
      (value.weapon.select === undefined || typeof value.weapon.select === "boolean")
    ));
}

function isPowerupEffect(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.activationField) &&
    isPositiveInteger(value.durationMs) &&
    isNonEmptyString(value.finishedField) &&
    isNonNegativeFiniteNumber(value.itemFlag) &&
    (value.itemFlagExpression === undefined || isNonEmptyString(value.itemFlagExpression));
}

function isAuthoritativePickupState(value: unknown): value is QuakeMultiplayerAuthoritativePickupState {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.pickupId) &&
    isNonNegativeInteger(value.entityIndex) &&
    typeof value.available === "boolean" &&
    Number.isFinite(value.updatedAt) &&
    (value.respawnAt === undefined || isNonNegativeFiniteNumber(value.respawnAt)) &&
    (value.ownerPlayerIds === undefined ||
      (Array.isArray(value.ownerPlayerIds) && value.ownerPlayerIds.every(isNonEmptyString)));
}

function isInventoryState(value: unknown): value is QuakeMultiplayerInventoryState {
  if (!isRecord(value)) return false;
  return Number.isFinite(value.health) &&
    Number.isFinite(value.armor) &&
    Number.isFinite(value.armorType) &&
    isNonEmptyString(value.activeWeapon) &&
    Number.isFinite(value.itemFlags) &&
    Array.isArray(value.weapons) &&
    value.weapons.every(isNonEmptyString) &&
    Number.isFinite(value.shells) &&
    Number.isFinite(value.nails) &&
    Number.isFinite(value.rockets) &&
    Number.isFinite(value.cells) &&
    Array.isArray(value.keys) &&
    value.keys.every(isNonEmptyString) &&
    Array.isArray(value.powerups) &&
    value.powerups.every(isInventoryPowerupState);
}

function isInventoryPowerupState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.active === true &&
    isNonEmptyString(value.activationField) &&
    isNonNegativeFiniteNumber(value.finishedAt) &&
    isNonEmptyString(value.finishedField) &&
    isNonNegativeFiniteNumber(value.itemFlag) &&
    (value.itemFlagExpression === undefined || isNonEmptyString(value.itemFlagExpression));
}

function isAuthoritativePlayerState(value: unknown): value is QuakeMultiplayerAuthoritativePlayerState {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.playerId) &&
    isNonEmptyString(value.clientId) &&
    isNonEmptyString(value.displayName) &&
    (value.color === undefined || isPlayerColor(value.color)) &&
    isNonEmptyString(value.mapName) &&
    (value.spawnId === undefined || isNonEmptyString(value.spawnId)) &&
    isVec3(value.origin) &&
    isVec3(value.velocity) &&
    Number.isFinite(value.rotX) &&
    Number.isFinite(value.rotY) &&
    Number.isFinite(value.health) &&
    Number.isFinite(value.armor) &&
    isNonEmptyString(value.activeWeapon) &&
    (value.inventory === undefined || isInventoryState(value.inventory)) &&
    typeof value.alive === "boolean" &&
    Number.isFinite(value.frags) &&
    Number.isFinite(value.deaths) &&
    isNonNegativeInteger(value.lastInputSequence) &&
    Number.isFinite(value.updatedAt) &&
    (value.pingMs === undefined || isNonNegativeFiniteNumber(value.pingMs)) &&
    (value.respawnAt === undefined || isNonNegativeFiniteNumber(value.respawnAt));
}

function isPlayerColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isRoomMatchState(value: unknown): value is QuakeMultiplayerRoomMatchState {
  if (!isRecord(value)) return false;
  return MATCH_STATUSES.has(value.status as QuakeMultiplayerRoomMatchState["status"]) &&
    isNonNegativeFiniteNumber(value.clockMs) &&
    (value.fragLimit === undefined || isNonNegativeFiniteNumber(value.fragLimit)) &&
    (value.timeLimitMs === undefined || isNonNegativeFiniteNumber(value.timeLimitMs)) &&
    (value.maxPlayers === undefined || isNonNegativeFiniteNumber(value.maxPlayers)) &&
    (value.restartDelayMs === undefined || isNonNegativeFiniteNumber(value.restartDelayMs));
}

function isMatchSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value.fragLimit === undefined || isPositiveInteger(value.fragLimit)) &&
    (value.timeLimitMs === undefined || isPositiveInteger(value.timeLimitMs)) &&
    (value.maxPlayers === undefined || isPositiveInteger(value.maxPlayers)) &&
    (value.restartDelayMs === undefined || isPositiveInteger(value.restartDelayMs));
}

function isSpawnPoint(value: unknown): value is QuakeMultiplayerSpawnPoint {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.spawnId) &&
    SPAWN_CLASSNAMES.has(value.classname as QuakeMultiplayerSpawnPoint["classname"]) &&
    isVec3(value.origin) &&
    Number.isFinite(value.rotX) &&
    Number.isFinite(value.rotY) &&
    (value.sourceEntityIndex === undefined || isNonNegativeInteger(value.sourceEntityIndex));
}

function isSharedWorldEvent(value: unknown): value is QuakeMultiplayerSharedWorldEvent {
  if (!isRecord(value) || !isNonEmptyString(value.eventType)) return false;
  if (!isNonEmptyString(value.eventId) || !Number.isFinite(value.roomTime)) return false;
  switch (value.eventType) {
    case "player.presence":
      return isNonEmptyString(value.playerId) &&
        PRESENCE_STATUSES.has(value.status as QuakeMultiplayerPlayerPresenceStatus);
    case "player.joined":
    case "player.spawned":
    case "player.respawned":
      return isAuthoritativePlayerState(value.player);
    case "player.fired":
      return isNonEmptyString(value.playerId) &&
        isNonEmptyString(value.weapon) &&
        FIRE_KINDS.has(value.fireKind as QuakeMultiplayerFireKind) &&
        isVec3(value.origin) &&
        isVec3(value.direction);
    case "player.damaged":
      return isNonEmptyString(value.victimPlayerId) &&
        (value.attackerPlayerId === undefined || isNonEmptyString(value.attackerPlayerId)) &&
        isNonNegativeFiniteNumber(value.damage) &&
        Number.isFinite(value.health) &&
        Number.isFinite(value.armor) &&
        (value.damageSource === undefined || isNonEmptyString(value.damageSource));
    case "player.left":
      return isNonEmptyString(value.playerId) && (value.reason === undefined || isNonEmptyString(value.reason));
    case "player.killed":
      return isNonEmptyString(value.victimPlayerId) &&
        (value.attackerPlayerId === undefined || isNonEmptyString(value.attackerPlayerId)) &&
        (value.damageSource === undefined || isNonEmptyString(value.damageSource));
    case "pickup.taken":
      return isNonEmptyString(value.playerId) &&
        isNonEmptyString(value.pickupId) &&
        isNonNegativeInteger(value.entityIndex) &&
        isPickupEffect(value.effect) &&
        typeof value.leaveInPlace === "boolean" &&
        (value.respawnAt === undefined || isNonNegativeFiniteNumber(value.respawnAt)) &&
        (value.feedback === undefined || (
          isRecord(value.feedback) &&
          (value.feedback.message === undefined || isNonEmptyString(value.feedback.message)) &&
          (value.feedback.soundPath === undefined || isNonEmptyString(value.feedback.soundPath))
        ));
    case "pickup.rejected":
      return isNonEmptyString(value.playerId) &&
        (value.pickupId === undefined || isNonEmptyString(value.pickupId)) &&
        isNonNegativeInteger(value.entityIndex) &&
        isNonEmptyString(value.reason);
    case "pickup.respawned":
      return isAuthoritativePickupState(value.pickup);
    case "world.use":
      return isNonEmptyString(value.playerId) &&
        (value.entityId === undefined || isNonEmptyString(value.entityId)) &&
        (value.entityIndex === undefined || isNonNegativeInteger(value.entityIndex));
    case "world.touch":
      return isNonEmptyString(value.playerId) && isNonNegativeInteger(value.entityIndex);
    case "world.teleport":
      return isNonEmptyString(value.playerId) &&
        isNonNegativeInteger(value.entityIndex) &&
        isVec3(value.origin) &&
        isVec3(value.velocity) &&
        (value.destinationEntityId === undefined || isNonEmptyString(value.destinationEntityId)) &&
        (value.destinationEntityIndex === undefined || isNonNegativeInteger(value.destinationEntityIndex));
    case "world.push":
      return isNonEmptyString(value.playerId) &&
        isNonNegativeInteger(value.entityIndex) &&
        isVec3(value.velocity) &&
        typeof value.oneShot === "boolean";
    case "world.trigger":
      return isNonEmptyString(value.playerId) &&
        isNonNegativeInteger(value.entityIndex) &&
        TRIGGER_ACTIVATION_CLASSNAMES.has(value.classname as string) &&
        (value.activation === "touch" || value.activation === "target" || value.activation === "shoot") &&
        isNonNegativeIntegerArray(value.targetEntityIndexes) &&
        (value.killtargetEntityIndexes === undefined || isNonNegativeIntegerArray(value.killtargetEntityIndexes)) &&
        isNonNegativeFiniteNumber(value.delayMs) &&
        isNonNegativeFiniteNumber(value.waitMs) &&
        typeof value.oneShot === "boolean" &&
        (value.remaining === undefined || isNonNegativeInteger(value.remaining)) &&
        (value.complete === undefined || typeof value.complete === "boolean") &&
        (value.message === undefined || isNonEmptyString(value.message)) &&
        (value.soundPath === undefined || isNonEmptyString(value.soundPath));
    case "world.mover":
      return isNonEmptyString(value.playerId) &&
        isNonNegativeInteger(value.entityIndex) &&
        MOVER_CLASSNAMES.has(value.classname as string) &&
        (value.activation === "touch" || value.activation === "target" || value.activation === "shoot") &&
        (value.state === "moving-up" || value.state === "top" || value.state === "moving-down" || value.state === "bottom") &&
        isVec3(value.fromOrigin) &&
        isVec3(value.toOrigin) &&
        isNonNegativeFiniteNumber(value.speed) &&
        isNonNegativeFiniteNumber(value.moveMs) &&
        (value.returnDelayMs === undefined || isNonNegativeFiniteNumber(value.returnDelayMs)) &&
        isNonNegativeIntegerArray(value.targetEntityIndexes) &&
        (value.killtargetEntityIndexes === undefined || isNonNegativeIntegerArray(value.killtargetEntityIndexes)) &&
        isNonNegativeFiniteNumber(value.delayMs) &&
        (value.soundPath === undefined || isNonEmptyString(value.soundPath));
    case "world.targets":
      return isNonEmptyString(value.sourceEventId) &&
        isNonNegativeInteger(value.sourceEntityIndex) &&
        (value.playerId === undefined || isNonEmptyString(value.playerId)) &&
        isNonNegativeIntegerArray(value.targetEntityIndexes) &&
        (value.killtargetEntityIndexes === undefined || isNonNegativeIntegerArray(value.killtargetEntityIndexes)) &&
        isNonNegativeFiniteNumber(value.delayMs) &&
        (value.message === undefined || isNonEmptyString(value.message)) &&
        (value.soundPath === undefined || isNonEmptyString(value.soundPath));
    case "level.transition":
      return (value.playerId === undefined || isNonEmptyString(value.playerId)) &&
        (value.entityId === undefined || isNonEmptyString(value.entityId)) &&
        (value.entityIndex === undefined || isNonNegativeInteger(value.entityIndex)) &&
        (value.targetMap === undefined || isNonEmptyString(value.targetMap));
    case "world.changed":
      return (value.entityId === undefined || isNonEmptyString(value.entityId)) &&
        (value.entityIndex === undefined || isNonNegativeInteger(value.entityIndex)) &&
        isNonEmptyString(value.change) &&
        (value.data === undefined || isJsonRecord(value.data));
    case "match.notice":
      return isNonEmptyString(value.code) && (value.message === undefined || isNonEmptyString(value.message));
    default:
      return false;
  }
}

function isPingPayload(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.pingId) && Number.isFinite(value.sentAt);
}

function isPongPayload(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.pingId) &&
    Number.isFinite(value.sentAt) &&
    Number.isFinite(value.echoedSentAt) &&
    Number.isFinite(value.responderTime);
}

function isVec3(value: unknown): value is QuakeMultiplayerVec3 {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function isJsonRecord(value: unknown): value is Record<string, QuakeMultiplayerJson> {
  return isRecord(value) && Object.values(value).every((entry) => isJson(entry, 1));
}

function isJson(value: unknown, depth: number): value is QuakeMultiplayerJson {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth > 8) return false;
  if (Array.isArray(value)) return value.every((entry) => isJson(entry, depth + 1));
  return isRecord(value) && Object.values(value).every((entry) => isJson(entry, depth + 1));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && value >= 0;
}

function isNonNegativeIntegerArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every(isNonNegativeInteger);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(
  code: QuakeMultiplayerValidationCode,
  reason: string,
): QuakeMultiplayerValidationResult<never> {
  return { ok: false, code, reason };
}
