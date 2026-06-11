export const QUAKE_MULTIPLAYER_PROTOCOL_VERSION = 1 as const;

export type QuakeMultiplayerProtocolVersion = typeof QUAKE_MULTIPLAYER_PROTOCOL_VERSION;
export type QuakeMultiplayerVec3 = readonly [number, number, number];

export interface QuakeMultiplayerRoomCompatibilityKey {
  mapName: string;
  assetManifestVersion: number;
  assetRoot: string;
  sceneUrl: string;
  preparedSceneVersion?: number;
  gameLogicVersion?: number;
}

export interface QuakeMultiplayerSpawnPoint {
  spawnId: string;
  classname: "info_player_deathmatch" | "info_player_coop" | "info_player_start";
  origin: QuakeMultiplayerVec3;
  rotX: number;
  rotY: number;
  sourceEntityIndex?: number;
}

export interface QuakeMultiplayerPickupEffect {
  health?: number;
  healthMax?: number;
  armor?: number;
  armorType?: number;
  weapon?: {
    id: string;
    itemFlag?: number;
    select?: boolean;
  };
  shells?: number;
  nails?: number;
  rockets?: number;
  cells?: number;
  key?: string;
  powerup?: QuakeMultiplayerPowerupEffect;
}

export interface QuakeMultiplayerPowerupEffect {
  activationField: string;
  durationMs: number;
  finishedField: string;
  itemFlag: number;
  itemFlagExpression?: string;
}

export interface QuakeMultiplayerPickupLifecycle {
  action: "leave" | "remove" | "respawn";
  condition: string;
  delayMs?: number;
}

export interface QuakeMultiplayerPickupFeedback {
  message?: string;
  soundPath?: string;
}

export interface QuakeMultiplayerPickupDefinition {
  pickupId: string;
  entityIndex: number;
  classname: string;
  origin: QuakeMultiplayerVec3;
  effect: QuakeMultiplayerPickupEffect;
  lifecycle?: QuakeMultiplayerPickupLifecycle;
  feedback?: QuakeMultiplayerPickupFeedback;
  targetEntityIndexes?: readonly number[];
  killtargetEntityIndexes?: readonly number[];
  delayMs?: number;
  message?: string;
}

export interface QuakeMultiplayerMapGameplayFacts {
  factsVersion: number;
  factsHash: string;
  deathmatchSpawnCount: number;
  pickupCount: number;
}

export interface QuakeMultiplayerGameplayDefinitions {
  gameplayFacts: QuakeMultiplayerMapGameplayFacts;
  deathmatchSpawns: readonly QuakeMultiplayerSpawnPoint[];
  pickupDefinitions: readonly QuakeMultiplayerPickupDefinition[];
}

export interface QuakeMultiplayerWorldBounds {
  mins: QuakeMultiplayerVec3;
  maxs: QuakeMultiplayerVec3;
}

export type QuakeMultiplayerTriggerActivationClassname =
  | "trigger_multiple"
  | "trigger_once"
  | "trigger_secret"
  | "trigger_counter"
  | "trigger_relay";

export type QuakeMultiplayerMoverClassname = "func_button";
export type QuakeMultiplayerMoverActivation = "touch" | "target" | "shoot";
export type QuakeMultiplayerMoverState = "moving-up" | "top" | "moving-down" | "bottom";

export interface QuakeMultiplayerTriggerCounterMessage {
  message: string;
  remaining?: number;
  minRemaining?: number;
}

export type QuakeMultiplayerWorldDefinition =
  | {
      kind: "teleport";
      entityIndex: number;
      classname: "trigger_teleport";
      bounds?: QuakeMultiplayerWorldBounds;
      destinationEntityIndex: number;
      destinationOrigin: QuakeMultiplayerVec3;
      destinationRotX: number;
      destinationRotY: number;
      touchRequiresActivation?: boolean;
      activationWindowMs?: number;
    }
  | {
      kind: "changelevel";
      entityIndex: number;
      classname: "trigger_changelevel";
      bounds?: QuakeMultiplayerWorldBounds;
      targetMap: string;
    }
  | {
      kind: "hurt";
      entityIndex: number;
      classname: "trigger_hurt";
      bounds?: QuakeMultiplayerWorldBounds;
      damage: number;
    }
  | {
      kind: "push";
      entityIndex: number;
      classname: "trigger_push";
      bounds?: QuakeMultiplayerWorldBounds;
      direction: QuakeMultiplayerVec3;
      speed: number;
      velocity: QuakeMultiplayerVec3;
      oneShot: boolean;
    }
  | {
      kind: "trigger";
      entityIndex: number;
      classname: QuakeMultiplayerTriggerActivationClassname;
      bounds?: QuakeMultiplayerWorldBounds;
      touchActivates: boolean;
      useActivates: boolean;
      shootActivates?: boolean;
      shootHealth?: number;
      oneShot: boolean;
      delayMs: number;
      waitMs: number;
      targetEntityIndexes: readonly number[];
      killtargetEntityIndexes?: readonly number[];
      facingDirection?: QuakeMultiplayerVec3;
      count?: number;
      counterMessages?: readonly QuakeMultiplayerTriggerCounterMessage[];
      message?: string;
      soundPath?: string;
    }
  | {
      kind: "mover";
      entityIndex: number;
      classname: QuakeMultiplayerMoverClassname;
      bounds?: QuakeMultiplayerWorldBounds;
      touchActivates: boolean;
      useActivates: boolean;
      shootActivates: boolean;
      shootHealth?: number;
      speed: number;
      moveMs: number;
      returnDelayMs?: number;
      delayMs: number;
      fromOrigin: QuakeMultiplayerVec3;
      toOrigin: QuakeMultiplayerVec3;
      targetEntityIndexes: readonly number[];
      killtargetEntityIndexes?: readonly number[];
      soundPath?: string;
    };

export interface QuakeMultiplayerAuthoritativePickupState {
  pickupId: string;
  entityIndex: number;
  available: boolean;
  updatedAt: number;
  respawnAt?: number;
  ownerPlayerIds?: string[];
}

export interface QuakeMultiplayerEnvelope<
  TDirection extends QuakeMultiplayerMessageDirection,
  TType extends QuakeMultiplayerMessageType,
  TPayload,
> {
  protocolVersion: QuakeMultiplayerProtocolVersion;
  direction: TDirection;
  type: TType;
  messageId: string;
  sequence: number;
  sentAt: number;
  roomKey: QuakeMultiplayerRoomCompatibilityKey;
  payload: TPayload;
}

export type QuakeMultiplayerMessageDirection = "client" | "room";

export type QuakeMultiplayerClientMessageType =
  | "client.hello"
  | "client.presence"
  | "client.input"
  | "client.fire"
  | "client.damage"
  | "client.pickup"
  | "client.match"
  | "client.world"
  | "client.pose"
  | "client.ping"
  | "client.pong";

export type QuakeMultiplayerRoomMessageType =
  | "room.snapshot"
  | "room.event"
  | "room.reject"
  | "room.error"
  | "room.ping"
  | "room.pong";

export type QuakeMultiplayerMessageType =
  | QuakeMultiplayerClientMessageType
  | QuakeMultiplayerRoomMessageType;

export interface QuakeMultiplayerMoveIntent {
  forward: number;
  side: number;
  up: number;
}

export interface QuakeMultiplayerButtonIntent {
  attack: boolean;
  jump: boolean;
  use: boolean;
}

export interface QuakeMultiplayerLocalInputIntent {
  inputSequence: number;
  sampledAt: number;
  dt: number;
  move: QuakeMultiplayerMoveIntent;
  buttons: QuakeMultiplayerButtonIntent;
  rotX: number;
  rotY: number;
  activeWeapon?: string;
}

export interface QuakeMultiplayerPoseSample {
  poseSequence: number;
  sampledAt: number;
  origin: QuakeMultiplayerVec3;
  velocity?: QuakeMultiplayerVec3;
  rotX: number;
  rotY: number;
  grounded: boolean;
  alive: boolean;
}

export type QuakeMultiplayerFireKind = "hitscan" | "melee" | "projectile" | "beam";

export interface QuakeMultiplayerFireIntent {
  fireSequence: number;
  firedAt: number;
  weapon: string;
  fireKind: QuakeMultiplayerFireKind;
  origin: QuakeMultiplayerVec3;
  direction: QuakeMultiplayerVec3;
  range: number;
}

export interface QuakeMultiplayerDamageIntent {
  damageSequence: number;
  damagedAt: number;
  amount: number;
  source: string;
}

export interface QuakeMultiplayerPickupIntent {
  pickupSequence: number;
  requestedAt: number;
  entityIndex: number;
}

export interface QuakeMultiplayerMatchIntent {
  matchSequence: number;
  requestedAt: number;
  action: "restart";
}

export type QuakeMultiplayerWorldIntent =
  | {
      intentType: "use";
      worldSequence: number;
      requestedAt: number;
      origin: QuakeMultiplayerVec3;
      direction: QuakeMultiplayerVec3;
      range: number;
      targetEntityId?: string;
      targetEntityIndex?: number;
    }
  | {
      intentType: "touch";
      worldSequence: number;
      requestedAt: number;
      entityIndex: number;
      origin: QuakeMultiplayerVec3;
    }
  | {
      intentType: "teleport";
      worldSequence: number;
      requestedAt: number;
      entityIndex: number;
      origin: QuakeMultiplayerVec3;
      velocity: QuakeMultiplayerVec3;
      destinationEntityId?: string;
      destinationEntityIndex?: number;
    }
  | {
      intentType: "level-transition";
      worldSequence: number;
      requestedAt: number;
      entityId?: string;
      entityIndex?: number;
      origin?: QuakeMultiplayerVec3;
      targetMap?: string;
    };

export interface QuakeMultiplayerInventoryState {
  health: number;
  armor: number;
  armorType: number;
  activeWeapon: string;
  itemFlags: number;
  weapons: string[];
  shells: number;
  nails: number;
  rockets: number;
  cells: number;
  keys: string[];
  powerups: QuakeMultiplayerInventoryPowerupState[];
}

export interface QuakeMultiplayerInventoryPowerupState {
  active: true;
  activationField: string;
  finishedAt: number;
  finishedField: string;
  itemFlag: number;
  itemFlagExpression?: string;
}

export interface QuakeMultiplayerLocalVisualPredictionState {
  playerId: string;
  predictedAt: number;
  inputSequence: number;
  origin: QuakeMultiplayerVec3;
  velocity: QuakeMultiplayerVec3;
  rotX: number;
  rotY: number;
  grounded: boolean;
  alive: boolean;
}

export interface QuakeMultiplayerAuthoritativePlayerState {
  playerId: string;
  clientId: string;
  displayName: string;
  color?: string;
  mapName: string;
  spawnId?: string;
  origin: QuakeMultiplayerVec3;
  velocity: QuakeMultiplayerVec3;
  rotX: number;
  rotY: number;
  health: number;
  armor: number;
  activeWeapon: string;
  inventory?: QuakeMultiplayerInventoryState;
  alive: boolean;
  frags: number;
  deaths: number;
  lastInputSequence: number;
  updatedAt: number;
  pingMs?: number;
  respawnAt?: number;
}

export interface QuakeMultiplayerRemoteInterpolationSample {
  playerId: string;
  sampledAt: number;
  origin: QuakeMultiplayerVec3;
  rotX: number;
  rotY: number;
  alive: boolean;
}

export interface QuakeMultiplayerRemoteInterpolationState {
  playerId: string;
  renderAt: number;
  renderOrigin: QuakeMultiplayerVec3;
  renderRotX: number;
  renderRotY: number;
  alive: boolean;
  previous?: QuakeMultiplayerRemoteInterpolationSample;
  next?: QuakeMultiplayerRemoteInterpolationSample;
  stale: boolean;
}

export type QuakeMultiplayerJson =
  | null
  | boolean
  | number
  | string
  | QuakeMultiplayerJson[]
  | { [key: string]: QuakeMultiplayerJson };

export type QuakeMultiplayerPlayerPresenceStatus =
  | "active"
  | "input-paused"
  | "backgrounded"
  | "disconnecting";

export interface QuakeMultiplayerMatchSettings {
  fragLimit?: number;
  timeLimitMs?: number;
  maxPlayers?: number;
  restartDelayMs?: number;
}

export type QuakeMultiplayerSharedWorldEvent =
  | {
      eventType: "player.presence";
      eventId: string;
      roomTime: number;
      playerId: string;
      status: QuakeMultiplayerPlayerPresenceStatus;
    }
  | {
      eventType: "player.joined";
      eventId: string;
      roomTime: number;
      player: QuakeMultiplayerAuthoritativePlayerState;
    }
  | {
      eventType: "player.left";
      eventId: string;
      roomTime: number;
      playerId: string;
      reason?: string;
    }
  | {
      eventType: "player.spawned";
      eventId: string;
      roomTime: number;
      player: QuakeMultiplayerAuthoritativePlayerState;
    }
  | {
      eventType: "player.fired";
      eventId: string;
      roomTime: number;
      playerId: string;
      weapon: string;
      fireKind: QuakeMultiplayerFireKind;
      origin: QuakeMultiplayerVec3;
      direction: QuakeMultiplayerVec3;
    }
  | {
      eventType: "player.damaged";
      eventId: string;
      roomTime: number;
      victimPlayerId: string;
      attackerPlayerId?: string;
      damage: number;
      health: number;
      armor: number;
      damageSource?: string;
    }
  | {
      eventType: "player.killed";
      eventId: string;
      roomTime: number;
      victimPlayerId: string;
      attackerPlayerId?: string;
      damageSource?: string;
    }
  | {
      eventType: "player.respawned";
      eventId: string;
      roomTime: number;
      player: QuakeMultiplayerAuthoritativePlayerState;
    }
  | {
      eventType: "pickup.taken";
      eventId: string;
      roomTime: number;
      playerId: string;
      pickupId: string;
      entityIndex: number;
      effect: QuakeMultiplayerPickupEffect;
      leaveInPlace: boolean;
      respawnAt?: number;
      feedback?: QuakeMultiplayerPickupFeedback;
    }
  | {
      eventType: "pickup.rejected";
      eventId: string;
      roomTime: number;
      playerId: string;
      pickupId?: string;
      entityIndex: number;
      reason: string;
    }
  | {
      eventType: "pickup.respawned";
      eventId: string;
      roomTime: number;
      pickup: QuakeMultiplayerAuthoritativePickupState;
    }
  | {
      eventType: "world.use";
      eventId: string;
      roomTime: number;
      playerId: string;
      entityId?: string;
      entityIndex?: number;
    }
  | {
      eventType: "world.touch";
      eventId: string;
      roomTime: number;
      playerId: string;
      entityIndex: number;
    }
  | {
      eventType: "world.teleport";
      eventId: string;
      roomTime: number;
      playerId: string;
      entityIndex: number;
      origin: QuakeMultiplayerVec3;
      velocity: QuakeMultiplayerVec3;
      destinationEntityId?: string;
      destinationEntityIndex?: number;
    }
  | {
      eventType: "world.push";
      eventId: string;
      roomTime: number;
      playerId: string;
      entityIndex: number;
      velocity: QuakeMultiplayerVec3;
      oneShot: boolean;
    }
  | {
      eventType: "world.trigger";
      eventId: string;
      roomTime: number;
      playerId: string;
      entityIndex: number;
      classname: QuakeMultiplayerTriggerActivationClassname;
      activation: "touch" | "target" | "shoot";
      targetEntityIndexes: readonly number[];
      killtargetEntityIndexes?: readonly number[];
      delayMs: number;
      waitMs: number;
      oneShot: boolean;
      remaining?: number;
      complete?: boolean;
      message?: string;
      soundPath?: string;
    }
  | {
      eventType: "world.mover";
      eventId: string;
      roomTime: number;
      playerId: string;
      entityIndex: number;
      classname: QuakeMultiplayerMoverClassname;
      activation: QuakeMultiplayerMoverActivation;
      state: QuakeMultiplayerMoverState;
      fromOrigin: QuakeMultiplayerVec3;
      toOrigin: QuakeMultiplayerVec3;
      speed: number;
      moveMs: number;
      returnDelayMs?: number;
      targetEntityIndexes: readonly number[];
      killtargetEntityIndexes?: readonly number[];
      delayMs: number;
      soundPath?: string;
    }
  | {
      eventType: "world.targets";
      eventId: string;
      roomTime: number;
      sourceEventId: string;
      sourceEntityIndex: number;
      playerId?: string;
      targetEntityIndexes: readonly number[];
      killtargetEntityIndexes?: readonly number[];
      delayMs: number;
      message?: string;
      soundPath?: string;
    }
  | {
      eventType: "level.transition";
      eventId: string;
      roomTime: number;
      playerId?: string;
      entityId?: string;
      entityIndex?: number;
      targetMap?: string;
    }
  | {
      eventType: "world.changed";
      eventId: string;
      roomTime: number;
      entityId?: string;
      entityIndex?: number;
      change: string;
      data?: Record<string, QuakeMultiplayerJson>;
    }
  | {
      eventType: "match.notice";
      eventId: string;
      roomTime: number;
      code: string;
      message?: string;
    };

export interface QuakeMultiplayerClientHelloPayload {
  clientId: string;
  displayName: string;
  color?: string;
  matchSettings?: QuakeMultiplayerMatchSettings;
  capabilities?: string[];
  gameplayFacts?: QuakeMultiplayerMapGameplayFacts;
  deathmatchSpawns?: QuakeMultiplayerSpawnPoint[];
  pickupDefinitions?: QuakeMultiplayerPickupDefinition[];
}

export interface QuakeMultiplayerClientPresencePayload {
  clientId: string;
  status: QuakeMultiplayerPlayerPresenceStatus;
}

export interface QuakeMultiplayerClientInputPayload {
  clientId: string;
  input: QuakeMultiplayerLocalInputIntent;
}

export interface QuakeMultiplayerClientFirePayload {
  clientId: string;
  fire: QuakeMultiplayerFireIntent;
}

export interface QuakeMultiplayerClientDamagePayload {
  clientId: string;
  damage: QuakeMultiplayerDamageIntent;
}

export interface QuakeMultiplayerClientPickupPayload {
  clientId: string;
  pickup: QuakeMultiplayerPickupIntent;
}

export interface QuakeMultiplayerClientMatchPayload {
  clientId: string;
  match: QuakeMultiplayerMatchIntent;
}

export type QuakeMultiplayerClientWorldPayload =
  | {
      clientId: string;
      intent: QuakeMultiplayerWorldIntent;
      event?: never;
    }
  | {
      clientId: string;
      event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "world.changed" }>;
      intent?: never;
    };

export interface QuakeMultiplayerClientPosePayload {
  clientId: string;
  prototypeOnly: true;
  pose: QuakeMultiplayerPoseSample;
}

export interface QuakeMultiplayerPingPayload {
  pingId: string;
  sentAt: number;
}

export interface QuakeMultiplayerPongPayload {
  pingId: string;
  sentAt: number;
  echoedSentAt: number;
  responderTime: number;
}

export interface QuakeMultiplayerRoomMatchState {
  status: "waiting" | "warmup" | "active" | "intermission";
  clockMs: number;
  fragLimit?: number;
  timeLimitMs?: number;
  maxPlayers?: number;
  restartDelayMs?: number;
}

export interface QuakeMultiplayerRoomSnapshotPayload {
  roomId: string;
  tick: number;
  roomTime: number;
  match: QuakeMultiplayerRoomMatchState;
  players: QuakeMultiplayerAuthoritativePlayerState[];
  pickups?: QuakeMultiplayerAuthoritativePickupState[];
  lastWorldEventSequence: number;
}

export interface QuakeMultiplayerRoomEventPayload {
  roomId: string;
  tick: number;
  sequence: number;
  event: QuakeMultiplayerSharedWorldEvent;
}

export type QuakeMultiplayerRejectCode =
  | "malformed"
  | "stale"
  | "wrong-map"
  | "wrong-protocol"
  | "room-full"
  | "not-authorized"
  | "unsupported";

export interface QuakeMultiplayerRoomRejectPayload {
  code: QuakeMultiplayerRejectCode;
  message: string;
  recoverable: boolean;
  rejectedMessageId?: string;
  retryAfterMs?: number;
  details?: Record<string, QuakeMultiplayerJson>;
}

export interface QuakeMultiplayerRoomErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
  details?: Record<string, QuakeMultiplayerJson>;
}

export type QuakeMultiplayerClientHelloEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.hello",
  QuakeMultiplayerClientHelloPayload
>;
export type QuakeMultiplayerClientPresenceEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.presence",
  QuakeMultiplayerClientPresencePayload
>;
export type QuakeMultiplayerClientInputEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.input",
  QuakeMultiplayerClientInputPayload
>;
export type QuakeMultiplayerClientFireEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.fire",
  QuakeMultiplayerClientFirePayload
>;
export type QuakeMultiplayerClientDamageEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.damage",
  QuakeMultiplayerClientDamagePayload
>;
export type QuakeMultiplayerClientPickupEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.pickup",
  QuakeMultiplayerClientPickupPayload
>;
export type QuakeMultiplayerClientMatchEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.match",
  QuakeMultiplayerClientMatchPayload
>;
export type QuakeMultiplayerClientWorldEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.world",
  QuakeMultiplayerClientWorldPayload
>;
export type QuakeMultiplayerClientPoseEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.pose",
  QuakeMultiplayerClientPosePayload
>;
export type QuakeMultiplayerClientPingEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.ping",
  QuakeMultiplayerPingPayload
>;
export type QuakeMultiplayerClientPongEnvelope = QuakeMultiplayerEnvelope<
  "client",
  "client.pong",
  QuakeMultiplayerPongPayload
>;

export type QuakeMultiplayerRoomSnapshotEnvelope = QuakeMultiplayerEnvelope<
  "room",
  "room.snapshot",
  QuakeMultiplayerRoomSnapshotPayload
>;
export type QuakeMultiplayerRoomEventEnvelope = QuakeMultiplayerEnvelope<
  "room",
  "room.event",
  QuakeMultiplayerRoomEventPayload
>;
export type QuakeMultiplayerRoomRejectEnvelope = QuakeMultiplayerEnvelope<
  "room",
  "room.reject",
  QuakeMultiplayerRoomRejectPayload
>;
export type QuakeMultiplayerRoomErrorEnvelope = QuakeMultiplayerEnvelope<
  "room",
  "room.error",
  QuakeMultiplayerRoomErrorPayload
>;
export type QuakeMultiplayerRoomPingEnvelope = QuakeMultiplayerEnvelope<
  "room",
  "room.ping",
  QuakeMultiplayerPingPayload
>;
export type QuakeMultiplayerRoomPongEnvelope = QuakeMultiplayerEnvelope<
  "room",
  "room.pong",
  QuakeMultiplayerPongPayload
>;

export type QuakeMultiplayerClientEnvelope =
  | QuakeMultiplayerClientHelloEnvelope
  | QuakeMultiplayerClientPresenceEnvelope
  | QuakeMultiplayerClientInputEnvelope
  | QuakeMultiplayerClientFireEnvelope
  | QuakeMultiplayerClientDamageEnvelope
  | QuakeMultiplayerClientPickupEnvelope
  | QuakeMultiplayerClientMatchEnvelope
  | QuakeMultiplayerClientWorldEnvelope
  | QuakeMultiplayerClientPoseEnvelope
  | QuakeMultiplayerClientPingEnvelope
  | QuakeMultiplayerClientPongEnvelope;

export type QuakeMultiplayerRoomEnvelope =
  | QuakeMultiplayerRoomSnapshotEnvelope
  | QuakeMultiplayerRoomEventEnvelope
  | QuakeMultiplayerRoomRejectEnvelope
  | QuakeMultiplayerRoomErrorEnvelope
  | QuakeMultiplayerRoomPingEnvelope
  | QuakeMultiplayerRoomPongEnvelope;

export type QuakeMultiplayerAnyEnvelope =
  | QuakeMultiplayerClientEnvelope
  | QuakeMultiplayerRoomEnvelope;

export interface QuakeMultiplayerEnvelopeInit<
  TDirection extends QuakeMultiplayerMessageDirection,
  TType extends QuakeMultiplayerMessageType,
  TPayload,
> {
  direction: TDirection;
  type: TType;
  roomKey: QuakeMultiplayerRoomCompatibilityKey;
  payload: TPayload;
  messageId?: string;
  sequence?: number;
  sentAt?: number;
}

export const QUAKE_MULTIPLAYER_AUTHORITY_MATRIX = {
  localClient: [
    "immediate input feel",
    "camera rendering",
    "local visual prediction",
    "pose samples for early prototype only",
  ],
  room: [
    "roster",
    "score",
    "health",
    "armor",
    "death",
    "respawn",
    "shared pickups",
    "match clock",
    "match restart",
  ],
  clientReportsRoomValidates: [
    "pose",
    "fire intent",
    "map agreement",
    "liveness",
    "cooldown",
    "ammo",
    "broad plausibility",
  ],
  rejectedClientClaims: [
    "authoritative kills",
    "authoritative pickup ownership",
    "authoritative shared world mutation",
    "authoritative use/trigger/teleport decisions",
  ],
} as const;

let nextEnvelopeId = 1;

export function createQuakeMultiplayerEnvelope<
  TDirection extends QuakeMultiplayerMessageDirection,
  TType extends QuakeMultiplayerMessageType,
  TPayload,
>(input: QuakeMultiplayerEnvelopeInit<TDirection, TType, TPayload>): QuakeMultiplayerEnvelope<TDirection, TType, TPayload> {
  return {
    protocolVersion: QUAKE_MULTIPLAYER_PROTOCOL_VERSION,
    direction: input.direction,
    type: input.type,
    messageId: input.messageId ?? createQuakeMultiplayerMessageId(input.direction),
    sequence: input.sequence ?? 0,
    sentAt: input.sentAt ?? Date.now(),
    roomKey: createQuakeMultiplayerRoomCompatibilityKey(input.roomKey),
    payload: input.payload,
  };
}

export function createQuakeMultiplayerMessageId(prefix = "mp"): string {
  const id = nextEnvelopeId++;
  return `${prefix}-${Date.now().toString(36)}-${id.toString(36)}`;
}

export function createQuakeMultiplayerRoomCompatibilityKey(
  input: QuakeMultiplayerRoomCompatibilityKey,
): QuakeMultiplayerRoomCompatibilityKey {
  return {
    mapName: input.mapName.trim().toLowerCase(),
    assetManifestVersion: input.assetManifestVersion,
    assetRoot: input.assetRoot.trim(),
    sceneUrl: input.sceneUrl.trim(),
    ...(typeof input.preparedSceneVersion === "number" ? { preparedSceneVersion: input.preparedSceneVersion } : {}),
    ...(typeof input.gameLogicVersion === "number" ? { gameLogicVersion: input.gameLogicVersion } : {}),
  };
}

export function sameQuakeMultiplayerRoomCompatibilityKey(
  a: QuakeMultiplayerRoomCompatibilityKey,
  b: QuakeMultiplayerRoomCompatibilityKey,
): boolean {
  const left = createQuakeMultiplayerRoomCompatibilityKey(a);
  const right = createQuakeMultiplayerRoomCompatibilityKey(b);
  return left.mapName === right.mapName &&
    left.assetManifestVersion === right.assetManifestVersion &&
    left.assetRoot === right.assetRoot &&
    left.sceneUrl === right.sceneUrl &&
    left.preparedSceneVersion === right.preparedSceneVersion &&
    left.gameLogicVersion === right.gameLogicVersion;
}
