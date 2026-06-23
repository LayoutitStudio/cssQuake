import type * as Party from "partykit/server";

import {
  buildQuakeClipCollisionWorld,
  type QuakeCollisionWorld,
} from "../collision";
import {
  clampQuakeMultiplayerMatchSettings,
  createQuakeMultiplayerEnvelope,
  createQuakeMultiplayerRoomCompatibilityKey,
  QUAKE_MULTIPLAYER_PROTOCOL_VERSION,
  type QuakeMultiplayerAnyEnvelope,
  type QuakeMultiplayerAuthoritativePickupState,
  type QuakeMultiplayerAuthoritativePlayerState,
  type QuakeMultiplayerClientEnvelope,
  type QuakeMultiplayerFireDecision,
  type QuakeMultiplayerGameplayDefinitions,
  type QuakeMultiplayerLocalInputIntent,
  type QuakeMultiplayerMapGameplayFacts,
  type QuakeMultiplayerMatchSettings,
  type QuakeMultiplayerMoverState,
  type QuakeMultiplayerPickupDefinition,
  type QuakeMultiplayerProjectileState,
  type QuakeMultiplayerPlayerPresenceStatus,
  type QuakeMultiplayerRoomCompatibilityKey,
  type QuakeMultiplayerRoomEnvelope,
  type QuakeMultiplayerRoomEventPayload,
  type QuakeMultiplayerRoomMatchState,
  type QuakeMultiplayerRoomRejectPayload,
  type QuakeMultiplayerRoomSpectatorState,
  type QuakeMultiplayerSpawnPoint,
  type QuakeMultiplayerVec3,
  type QuakeMultiplayerWorldDefinition,
} from "./protocol";
import {
  validateQuakeMultiplayerClientEnvelope,
} from "./validation";
import {
  validateQuakeMultiplayerClientAuthority,
  type QuakeMultiplayerClientAuthorityState,
} from "./authority";
import {
  QUAKE_MULTIPLAYER_ROOM_SNAPSHOT_INTERVAL_MS,
  shouldEmitQuakeMultiplayerRoomSnapshot,
} from "./cadence";
import {
  QUAKE_MULTIPLAYER_ROOM_HEARTBEAT_INTERVAL_MS,
  QUAKE_MULTIPLAYER_STALE_CLIENT_MS,
  isQuakeMultiplayerClientStale,
  quakeMultiplayerPingMsFromPong,
  shouldSendQuakeMultiplayerRoomPing,
} from "./heartbeat";
import {
  QUAKE_MULTIPLAYER_DEATHMATCH_RESPAWN_DELAY_MS,
  quakeMultiplayerDeathmatchFireFromPlayer,
  quakeMultiplayerDeathmatchFragDeltaForKill,
  quakeMultiplayerDeathmatchLagCompensationMs,
  quakeMultiplayerDeathmatchLightningDischarge,
  quakeMultiplayerDeathmatchPlayerWithDamageMomentum,
  quakeMultiplayerDeathmatchProjectileSplashHitsAtImpact,
  quakeMultiplayerDeathmatchProjectileWorldSplashHits,
  quakeMultiplayerDeathmatchSelectSpawnPoint,
  quakeMultiplayerDeathmatchSpawnOrder,
  quakeMultiplayerDeathmatchSplashHits,
  quakeMultiplayerDeathmatchVisibleHitDecision,
  quakeMultiplayerDeathmatchWeaponCooldownMs,
  quakeMultiplayerDeathmatchWeaponDamage,
  rejectQuakeMultiplayerClientDamageIntent,
} from "./deathmatch";
import {
  createQuakeMultiplayerInitialInventory,
  quakeMultiplayerApplyDamageToInventory,
  quakeMultiplayerApplyPickupEffect,
  quakeMultiplayerConsumeLightningDischargeCells,
  quakeMultiplayerConsumeWeaponAmmo,
  quakeMultiplayerDamageMultiplierForInventory,
  quakeMultiplayerDroppedBackpackDefinition,
  quakeMultiplayerInventoryCanAcceptPickupEffect,
  quakeMultiplayerInventoryWithBestWeaponIfCurrentAmmoEmpty,
  quakeMultiplayerInventoryWithoutDeathPowerups,
  quakeMultiplayerInventoryWithoutPowerup,
  quakeMultiplayerPickupAlwaysAcceptsTouch,
  quakeMultiplayerPlayerCanReachPickup,
  quakeMultiplayerPlayerInventory,
  quakeMultiplayerPlayerPowerupActive,
  quakeMultiplayerPlayerWithInventory,
  quakeMultiplayerPickupStateRespawned,
  quakeMultiplayerPickupStateWithoutOwner,
  quakeMultiplayerPruneExpiredPowerups,
} from "./items";
import {
  checkQuakeMultiplayerGameplayFactsClaim,
  sameQuakeMultiplayerGameplayFacts,
} from "./facts";
import {
  quakeMultiplayerGameplayDefinitionsFromScene,
  type QuakeMultiplayerSceneGameplaySource,
} from "./sceneFacts";
import {
  QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE,
  QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS,
  QUAKE_MULTIPLAYER_TRIGGER_HURT_COOLDOWN_MS,
  quakeMultiplayerPlayerIntersectsTelefragVolume,
  quakeMultiplayerTriggerCounterMessage,
  quakeMultiplayerMoverOffsetAtTime,
  quakeMultiplayerMoverOffsetForState,
  quakeMultiplayerShootableWorldHit,
  sameQuakeMultiplayerMoverOffset,
  quakeMultiplayerTriggerUsesMultiTrigger,
  quakeMultiplayerWorldDefinitionsFromScene,
  quakeMultiplayerWorldIntentRejectionIsIgnorableTouchMiss,
  rejectQuakeMultiplayerClientWorldEvent,
  resolveQuakeMultiplayerWorldIntent,
} from "./world";
import {
  QUAKE_MULTIPLAYER_ROOM_SIMULATION_TICK_MS,
  QUAKE_MULTIPLAYER_TELEPORT_BACKPEDAL_LOCK_MS,
  advanceQuakeMultiplayerRoomPlayerSimulation,
  createQuakeMultiplayerRoomPlayerSimulationState,
  pauseQuakeMultiplayerRoomPlayerSimulation,
  queueQuakeMultiplayerRoomInput,
  validateQuakeMultiplayerRoomFireInputHistory,
  type QuakeMultiplayerRoomPlayerSimulationState,
} from "./simulation";
import {
  quakeMultiplayerHistoricalCombatPlayers,
  recordQuakeMultiplayerSnapshotHistory,
  type QuakeMultiplayerSnapshotHistory,
} from "./history";
import {
  advanceQuakeMultiplayerServerProjectile,
  createQuakeMultiplayerServerProjectile,
  quakeMultiplayerServerProjectileWeaponSupported,
  type QuakeMultiplayerServerProjectile,
} from "./projectileAuthority";
import {
  CSSQUAKE_PRESENCE_ROOM_ID,
  createCssQuakePresenceUpdatePayload,
} from "./presenceRoom";
import type { QuakePreparedCollision } from "../../types/quake";

type CssQuakeConnectionRole = "player" | "spectator";

interface CssQuakeConnectionState {
  authority: QuakeMultiplayerClientAuthorityState;
  clientId: string;
  displayName: string;
  lastRoomPingAt?: number;
  lastRoomPingId?: string;
  lastSeenAt: number;
  playerId?: string;
  pingMs?: number;
  presenceStatus: QuakeMultiplayerPlayerPresenceStatus;
  role: CssQuakeConnectionRole;
}

export interface CssQuakeMultiplayerRoomOptions {
  random?: () => number;
  trustedGameplayDefinitions?:
    | QuakeMultiplayerGameplayDefinitions
    | ((roomKey: QuakeMultiplayerRoomCompatibilityKey) => QuakeMultiplayerGameplayDefinitions | null | undefined);
  trustedGameplayDefinitionsFetcher?:
    (roomKey: QuakeMultiplayerRoomCompatibilityKey) => Promise<QuakeMultiplayerGameplayDefinitions | null | undefined>;
  trustedWorldDefinitions?:
    | readonly QuakeMultiplayerWorldDefinition[]
    | ((roomKey: QuakeMultiplayerRoomCompatibilityKey) => readonly QuakeMultiplayerWorldDefinition[] | null | undefined);
  trustedSceneMovement?: {
    collisionWorld: QuakeCollisionWorld;
    playerEyeHeight: number;
  };
}

interface CssQuakeTargetDispatchSource {
  entityIndex: number;
  targetEntityIndexes: readonly number[];
  killtargetEntityIndexes?: readonly number[];
  delayMs: number;
  message?: string;
  soundPath?: string;
}

type CssQuakeMoverState = "bottom" | "moving-up" | "top" | "moving-down";
type CssQuakeMoverMotionState = Extract<QuakeMultiplayerMoverState, "moving-up" | "moving-down">;

interface CssQuakeMoverCollisionMotion {
  durationMs: number;
  startedAt: number;
  state: CssQuakeMoverMotionState;
}

const CSSQUAKE_PARTY_MAX_MESSAGE_AGE_MS = 60_000;
const CSSQUAKE_PARTY_MAX_MESSAGE_BYTES = 64 * 1024;
export const CSSQUAKE_PARTY_MAX_REJECTS_PER_CONNECTION = 8;
export const CSSQUAKE_PARTY_MAX_SPECTATORS_PER_ROOM = 8;
const CSSQUAKE_PARTY_REJECT_CLOSE_CODE = 1008;
const CSSQUAKE_PARTY_RECONNECT_GRACE_MS = 15_000;

export default class CssQuakeMultiplayerRoom implements Party.Server {
  private roomKey: QuakeMultiplayerRoomCompatibilityKey | null = null;
  private readonly players = new Map<string, QuakeMultiplayerAuthoritativePlayerState>();
  private readonly playerSimulationStates = new Map<string, QuakeMultiplayerRoomPlayerSimulationState>();
  private readonly connectionPlayers = new Map<string, CssQuakeConnectionState>();
  private spawnPoints: QuakeMultiplayerSpawnPoint[] = [];
  private readonly pickupDefinitions = new Map<number, QuakeMultiplayerPickupDefinition>();
  private readonly pickupStates = new Map<number, QuakeMultiplayerAuthoritativePickupState>();
  private readonly worldDefinitions = new Map<number, QuakeMultiplayerWorldDefinition>();
  private gameplayFacts: QuakeMultiplayerMapGameplayFacts | null = null;
  private spawnCursor = 0;
  private readonly lastFireAtByPlayer = new Map<string, number>();
  private readonly hurtNextTouchAtByEntity = new Map<number, number>();
  private readonly teleportActiveUntilByEntity = new Map<number, number>();
  private readonly triggerNextTouchAt = new Map<number, number>();
  private readonly triggerCounterRemaining = new Map<number, number>();
  private readonly triggerShootHealth = new Map<number, number>();
  private readonly respawnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pickupRespawnTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly pickupRemovalTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly targetDispatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly moverStateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly moverStates = new Map<number, CssQuakeMoverState>();
  private readonly moverCollisionMotions = new Map<number, CssQuakeMoverCollisionMotion>();
  private readonly moverCollisionOffsets = new Map<number, QuakeMultiplayerVec3>();
  private readonly moverShootHealth = new Map<number, number>();
  private readonly serverProjectiles = new Map<string, QuakeMultiplayerServerProjectile>();
  private readonly disconnectRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly connectionRejectCounts = new Map<string, number>();
  private snapshotHistory: QuakeMultiplayerSnapshotHistory = [];
  private projectileSequence = 0;
  private dynamicPickupSequence = 1_000_000;
  private matchRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private roomSequence = 0;
  private tick = 0;
  private worldEventSequence = 0;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private simulationTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastScheduledSnapshotAt = -Infinity;
  private startedAt = Date.now();
  private matchSettings: QuakeMultiplayerMatchSettings = {};
  private matchStatus: QuakeMultiplayerRoomMatchState["status"] = "active";
  private fetchedTrustedGameplayDefinitions: QuakeMultiplayerGameplayDefinitions | null = null;
  private fetchedTrustedWorldDefinitions: QuakeMultiplayerWorldDefinition[] | null = null;
  private trustedGameplayDefinitionsPromise: Promise<QuakeMultiplayerGameplayDefinitions | null> | null = null;
  private trustedSceneMovement: {
    collisionWorld: QuakeCollisionWorld;
    playerEyeHeight: number;
  } | null = null;

  constructor(readonly room: Party.Room, private readonly options: CssQuakeMultiplayerRoomOptions = {}) {
    this.trustedSceneMovement = options.trustedSceneMovement ?? null;
  }

  onConnect(connection: Party.Connection): void {
    connection.setState(null);
  }

  onMessage(message: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection): void | Promise<void> {
    if (typeof message !== "string") {
      this.closeMalformed(sender, "cssQuake multiplayer messages must be JSON strings.");
      return;
    }
    if (message.length > CSSQUAKE_PARTY_MAX_MESSAGE_BYTES) {
      this.closeMalformed(sender, "cssQuake multiplayer message is too large.");
      return;
    }
    const raw = parseQuakePartyMessage(message);
    const roomKey = this.roomKey ?? firstHelloRoomKey(raw);
    if (!roomKey) {
      this.closeMalformed(sender, "First cssQuake multiplayer message must be a client hello with a room key.");
      return;
    }
    const receivedAt = Date.now();
    const validation = validateQuakeMultiplayerClientEnvelope(raw, {
      roomKey,
      now: receivedAt,
      maxMessageAgeMs: CSSQUAKE_PARTY_MAX_MESSAGE_AGE_MS,
    });
    if (!validation.ok) {
      this.reject(sender, {
        code: validation.code,
        message: validation.reason,
        recoverable: validation.code === "stale",
        rejectedMessageId: isQuakeEnvelopeLike(raw) ? raw.messageId : undefined,
      }, roomKey);
      return;
    }
    const connectionState = this.connectionState(sender);
    const authority = validateQuakeMultiplayerClientAuthority(validation.envelope, connectionState?.authority, {
      now: receivedAt,
    });
    if (!authority.ok) {
      this.reject(sender, authority.reject, roomKey);
      return;
    }
    this.clearConnectionRejects(sender);
    if (!this.roomKey) this.roomKey = roomKey;
    if (validation.envelope.type === "client.hello") {
      this.seedPendingHelloAuthority(sender, validation.envelope, authority.state, receivedAt);
      const trustedDefinitionsReady = this.ensureTrustedGameplayDefinitions(validation.envelope, sender, roomKey);
      if (isPromiseLike(trustedDefinitionsReady)) {
        return trustedDefinitionsReady.then((ok) => {
          if (ok) this.handleClientMessage(validation.envelope, sender, authority.state, receivedAt);
        });
      }
      if (!trustedDefinitionsReady) return;
    }
    this.handleClientMessage(validation.envelope, sender, authority.state, receivedAt);
  }

  onClose(connection: Party.Connection): void {
    this.removeConnection(connection, "closed");
  }

  onError(connection: Party.Connection): void {
    this.removeConnection(connection, "error");
  }

  onRequest(): Response {
    return Response.json({
      roomId: this.room.id,
      protocolVersion: QUAKE_MULTIPLAYER_PROTOCOL_VERSION,
      players: this.players.size,
      activePlayers: this.activePlayerCount(),
      spectators: this.spectatorCount(),
      connections: this.connectionPlayers.size,
      mapName: this.roomKey?.mapName ?? null,
      gameplayFactsHash: this.gameplayFacts?.factsHash ?? null,
    });
  }

  private handleClientMessage(
    message: QuakeMultiplayerClientEnvelope,
    sender: Party.Connection,
    authority: QuakeMultiplayerClientAuthorityState,
    receivedAt: number,
  ): void {
    switch (message.type) {
      case "client.hello":
        if (this.registerPlayer(sender, message, authority, receivedAt)) {
          this.broadcastSnapshot();
        }
        break;
      case "client.presence":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.handlePresence(message, sender);
        break;
      case "client.input":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.queuePlayerInput(sender, message.payload.input);
        break;
      case "client.inputBatch":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.queuePlayerInputs(sender, message.payload.inputs);
        break;
      case "client.fire":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.advanceRoomSimulation(Date.now());
        this.handleFireIntent(message, sender);
        break;
      case "client.damage":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.reject(sender, rejectQuakeMultiplayerClientDamageIntent(message));
        break;
      case "client.pickup":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.advanceRoomSimulation(Date.now());
        this.handlePickupIntent(message, sender);
        break;
      case "client.match":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.handleMatchIntent(message, sender);
        break;
      case "client.world":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.advanceRoomSimulation(Date.now());
        this.handleWorldEvent(message, sender);
        break;
      case "client.pose":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.updatePlayer(sender, (player) => ({
          ...player,
          ...(player.alive && !player.lastInputSequence && !this.playerSimulationStateHasInput(player.playerId) ? {
            origin: message.payload.pose.origin,
            velocity: message.payload.pose.velocity ?? [0, 0, 0],
            rotX: message.payload.pose.rotX,
            rotY: message.payload.pose.rotY,
          } : player.lastInputSequence ? {
            rotX: message.payload.pose.rotX,
            rotY: message.payload.pose.rotY,
          } : {}),
          updatedAt: Date.now(),
        }));
        this.requestSnapshot();
        break;
      case "client.ping":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.send(sender, "room.pong", {
          pingId: message.payload.pingId,
          sentAt: Date.now(),
          echoedSentAt: message.payload.sentAt,
          responderTime: this.roomTime(),
        });
        break;
      case "client.pong":
        this.updateConnectionAuthority(sender, authority, receivedAt);
        this.handleClientPong(message, sender, receivedAt);
        break;
    }
  }

  private registerPlayer(
    sender: Party.Connection,
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.hello" }>,
    authority: QuakeMultiplayerClientAuthorityState,
    receivedAt: number,
  ): boolean {
    if (!this.roomKey) return false;
    if (!this.acceptGameplayFacts(sender, message)) return false;
    const trustedDefinitions = this.trustedGameplayDefinitions();
    const deathmatchSpawns = trustedDefinitions?.deathmatchSpawns ?? message.payload.deathmatchSpawns;
    if (!this.spawnPoints.length && deathmatchSpawns?.length) {
      this.spawnPoints = quakeMultiplayerDeathmatchSpawnOrder(deathmatchSpawns);
    }
    const pickupDefinitions = trustedDefinitions?.pickupDefinitions ?? message.payload.pickupDefinitions;
    if (!this.pickupDefinitions.size && pickupDefinitions?.length) {
      this.registerPickupDefinitions(pickupDefinitions);
    }
    const worldDefinitions = this.trustedWorldDefinitions();
    if (!this.worldDefinitions.size && worldDefinitions?.length) {
      this.registerWorldDefinitions(worldDefinitions);
    }
    const playerId = this.playerIdForClient(message.payload.clientId);
    const existingPlayer = this.players.get(playerId);
    if (existingPlayer) {
      this.cancelDisconnectedPlayerRemoval(playerId);
      this.closeDuplicatePlayerConnections(sender, playerId);
    }
    if (!Object.keys(this.matchSettings).length && message.payload.matchSettings) {
      this.matchSettings = clampQuakeMultiplayerMatchSettings(message.payload.matchSettings);
    }
    const maxPlayers = this.matchSettings.maxPlayers;
    if (maxPlayers !== undefined && !this.players.has(playerId) && this.players.size >= maxPlayers) {
      if (this.spectatorCount() >= CSSQUAKE_PARTY_MAX_SPECTATORS_PER_ROOM) {
        this.reject(sender, {
          code: "room-full",
          message: "Multiplayer room is full.",
          recoverable: false,
          rejectedMessageId: message.messageId,
        });
        return false;
      }
      this.registerSpectator(sender, message, authority, receivedAt);
      return true;
    }
    const spawn = existingPlayer ? null : this.nextSpawnPoint();
    const inventory = createQuakeMultiplayerInitialInventory();
    const player: QuakeMultiplayerAuthoritativePlayerState = existingPlayer ?? {
      playerId,
      clientId: message.payload.clientId,
      displayName: message.payload.displayName,
      ...(message.payload.color ? { color: message.payload.color } : {}),
      mapName: this.roomKey.mapName,
      ...(spawn ? { spawnId: spawn.spawnId } : {}),
      origin: spawn?.origin ?? [0, 0, 0],
      velocity: [0, 0, 0],
      rotX: spawn?.rotX ?? 90,
      rotY: spawn?.rotY ?? 270,
      health: inventory.health,
      armor: inventory.armor,
      activeWeapon: inventory.activeWeapon,
      inventory,
      alive: true,
      frags: 0,
      deaths: 0,
      lastInputSequence: 0,
      updatedAt: Date.now(),
    };
    const nextPlayer = {
      ...player,
      clientId: message.payload.clientId,
      displayName: message.payload.displayName,
      ...(message.payload.color ?? player.color ? { color: message.payload.color ?? player.color } : {}),
      mapName: this.roomKey.mapName,
      ...(spawn && !player.spawnId ? { spawnId: spawn.spawnId, origin: spawn.origin, rotX: spawn.rotX, rotY: spawn.rotY } : {}),
      updatedAt: Date.now(),
    };
    this.players.set(playerId, nextPlayer);
    if (!this.playerSimulationStates.has(playerId)) {
      this.playerSimulationStates.set(playerId, createQuakeMultiplayerRoomPlayerSimulationState({
        playerId,
        now: Date.now(),
        lastAcceptedInputSequence: nextPlayer.lastInputSequence,
      }));
    }
    const latestAuthority = this.latestConnectionAuthority(sender, message.payload.clientId, authority);
    const state = {
      authority: latestAuthority,
      clientId: message.payload.clientId,
      displayName: message.payload.displayName,
      lastSeenAt: receivedAt,
      playerId,
      presenceStatus: "active" as const,
      role: "player" as const,
    };
    this.connectionPlayers.set(sender.id, state);
    sender.setState(state);
    this.startSimulationTicker();
    this.startSnapshotTicker();
    this.startHeartbeatTicker();
    this.reportPresence();
    if (existingPlayer) {
      this.broadcastRoomEvent({
        eventType: "player.presence",
        eventId: `reconnect-${message.messageId}`,
        roomTime: this.roomTime(),
        playerId,
        status: "active",
      }, [sender.id]);
    } else {
      this.broadcastRoomEvent({
        eventType: "player.joined",
        eventId: `join-${message.messageId}`,
        roomTime: this.roomTime(),
        player: this.players.get(playerId) ?? player,
      }, [sender.id]);
    }
    return true;
  }

  private registerSpectator(
    sender: Party.Connection,
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.hello" }>,
    authority: QuakeMultiplayerClientAuthorityState,
    receivedAt: number,
  ): void {
    const latestAuthority = this.latestConnectionAuthority(sender, message.payload.clientId, authority);
    const state = {
      authority: latestAuthority,
      clientId: message.payload.clientId,
      displayName: message.payload.displayName,
      lastSeenAt: receivedAt,
      presenceStatus: "active" as const,
      role: "spectator" as const,
    };
    this.connectionPlayers.set(sender.id, state);
    sender.setState(state);
    this.startSnapshotTicker();
    this.startHeartbeatTicker();
    this.reportPresence();
  }

  private acceptGameplayFacts(
    sender: Party.Connection,
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.hello" }>,
  ): boolean {
    const trustedDefinitions = this.trustedGameplayDefinitions();
    if (trustedDefinitions) {
      return this.acceptTrustedGameplayFacts(sender, message, trustedDefinitions);
    }
    const incoming = message.payload.gameplayFacts;
    const suppliedGameplayDefinitions = Boolean(
      message.payload.deathmatchSpawns?.length ||
        message.payload.pickupDefinitions?.length,
    );
    if (!incoming && suppliedGameplayDefinitions) {
      this.reject(sender, {
        code: "wrong-map",
        message: "Multiplayer gameplay facts fingerprint is required when gameplay definitions are supplied.",
        recoverable: false,
        rejectedMessageId: message.messageId,
      });
      return false;
    }
    if (!this.gameplayFacts) {
      if (incoming) {
        const claim = checkQuakeMultiplayerGameplayFactsClaim(incoming, {
          deathmatchSpawns: message.payload.deathmatchSpawns,
          pickupDefinitions: message.payload.pickupDefinitions,
        }, {
          requireDefinitionsForNonEmptyFacts: true,
        });
        if (!claim.ok) {
          this.reject(sender, {
            code: "wrong-map",
            message: claim.reason,
            recoverable: false,
            rejectedMessageId: message.messageId,
            details: {
              claimedFactsHash: incoming.factsHash,
              computedFactsHash: claim.computed?.factsHash ?? "",
            },
          });
          return false;
        }
        this.gameplayFacts = incoming;
      }
      return true;
    }
    if (incoming && suppliedGameplayDefinitions) {
      const claim = checkQuakeMultiplayerGameplayFactsClaim(incoming, {
        deathmatchSpawns: message.payload.deathmatchSpawns,
        pickupDefinitions: message.payload.pickupDefinitions,
      });
      if (!claim.ok) {
        this.reject(sender, {
          code: "wrong-map",
          message: claim.reason,
          recoverable: false,
          rejectedMessageId: message.messageId,
          details: {
            claimedFactsHash: incoming.factsHash,
            computedFactsHash: claim.computed?.factsHash ?? "",
          },
        });
        return false;
      }
    }
    if (sameQuakeMultiplayerGameplayFacts(this.gameplayFacts, incoming)) return true;
    this.reject(sender, {
      code: "wrong-map",
      message: "Multiplayer gameplay facts do not match this room.",
      recoverable: false,
      rejectedMessageId: message.messageId,
      details: {
        expectedFactsHash: this.gameplayFacts.factsHash,
        receivedFactsHash: incoming?.factsHash ?? "",
      },
    });
    return false;
  }

  private acceptTrustedGameplayFacts(
    sender: Party.Connection,
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.hello" }>,
    trustedDefinitions: QuakeMultiplayerGameplayDefinitions,
  ): boolean {
    const incoming = message.payload.gameplayFacts;
    if (incoming && !sameQuakeMultiplayerGameplayFacts(trustedDefinitions.gameplayFacts, incoming)) {
      this.reject(sender, {
        code: "wrong-map",
        message: "Multiplayer gameplay facts do not match this room.",
        recoverable: false,
        rejectedMessageId: message.messageId,
        details: {
          expectedFactsHash: trustedDefinitions.gameplayFacts.factsHash,
          receivedFactsHash: incoming.factsHash,
        },
      });
      return false;
    }
    const suppliedGameplayDefinitions = Boolean(
      message.payload.deathmatchSpawns?.length ||
        message.payload.pickupDefinitions?.length,
    );
    if (suppliedGameplayDefinitions) {
      const claim = checkQuakeMultiplayerGameplayFactsClaim(trustedDefinitions.gameplayFacts, {
        deathmatchSpawns: message.payload.deathmatchSpawns,
        pickupDefinitions: message.payload.pickupDefinitions,
      });
      if (!claim.ok) {
        this.reject(sender, {
          code: "wrong-map",
          message: "Client-supplied multiplayer gameplay definitions do not match this room.",
          recoverable: false,
          rejectedMessageId: message.messageId,
          details: {
            expectedFactsHash: trustedDefinitions.gameplayFacts.factsHash,
            computedFactsHash: claim.computed?.factsHash ?? "",
          },
        });
        return false;
      }
    }
    this.gameplayFacts = trustedDefinitions.gameplayFacts;
    return true;
  }

  private handlePresence(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.presence" }>,
    sender: Party.Connection,
  ): void {
    const state = this.connectionState(sender);
    if (!state?.playerId) return;
    const next = {
      ...state,
      presenceStatus: message.payload.status,
    };
    this.connectionPlayers.set(sender.id, next);
    sender.setState(next);
    if (!quakeMultiplayerPresenceAcceptsInput(message.payload.status)) {
      this.pausePlayerSimulation(state.playerId);
      this.broadcastSnapshot();
    } else {
      this.startSimulationTicker();
    }
    this.broadcastRoomEvent({
      eventType: "player.presence",
      eventId: `presence-${message.messageId}`,
      roomTime: this.roomTime(),
      playerId: state.playerId,
      status: message.payload.status,
    });
  }

  private updatePlayer(
    sender: Party.Connection,
    update: (player: QuakeMultiplayerAuthoritativePlayerState) => QuakeMultiplayerAuthoritativePlayerState,
  ): void {
    const state = this.connectionState(sender);
    if (!state?.playerId) return;
    const player = this.players.get(state.playerId);
    if (!player) return;
    this.players.set(state.playerId, update(player));
  }

  private queuePlayerInput(sender: Party.Connection, input: QuakeMultiplayerLocalInputIntent): void {
    this.queuePlayerInputs(sender, [input]);
  }

  private queuePlayerInputs(sender: Party.Connection, inputs: readonly QuakeMultiplayerLocalInputIntent[]): void {
    const state = this.connectionState(sender);
    if (!state?.playerId) return;
    if (!quakeMultiplayerPresenceAcceptsInput(state.presenceStatus)) {
      this.pausePlayerSimulation(state.playerId);
      return;
    }
    this.enterIntermissionIfTimeLimitReached("input");
    if (this.matchStatus !== "active") return;
    const player = this.players.get(state.playerId);
    if (!player) return;
    const simulationState =
      this.playerSimulationStates.get(player.playerId) ??
      createQuakeMultiplayerRoomPlayerSimulationState({
        playerId: player.playerId,
        now: Date.now(),
        lastAcceptedInputSequence: player.lastInputSequence,
      });
    let nextState = simulationState;
    let accepted = false;
    for (const input of inputs) {
      const result = queueQuakeMultiplayerRoomInput(nextState, input);
      nextState = result.state;
      accepted = accepted || result.accepted;
    }
    this.playerSimulationStates.set(player.playerId, nextState);
    if (accepted) this.startSimulationTicker();
  }

  private advanceRoomSimulation(timestamp: number): boolean {
    if (this.enterIntermissionIfTimeLimitReached("simulation")) {
      this.broadcastSnapshot();
      return false;
    }
    if (this.matchStatus !== "active") return false;
    this.syncMoverCollisionOffsets(timestamp);
    let advanced = false;
    for (const [playerId, player] of this.players) {
      if (!this.playerAcceptsInput(playerId)) continue;
      const state =
        this.playerSimulationStates.get(playerId) ??
        createQuakeMultiplayerRoomPlayerSimulationState({
          playerId,
          now: timestamp,
          lastAcceptedInputSequence: player.lastInputSequence,
        });
    const result = advanceQuakeMultiplayerRoomPlayerSimulation(player, state, {
      now: timestamp,
      tickMs: QUAKE_MULTIPLAYER_ROOM_SIMULATION_TICK_MS,
      collisionWorld: this.trustedSceneMovement?.collisionWorld,
      playerEyeHeight: this.trustedSceneMovement?.playerEyeHeight,
      radsuitActive: quakeMultiplayerPlayerPowerupActive(player, "radsuit_finished", timestamp),
    });
      this.playerSimulationStates.set(playerId, result.state);
      if (result.advancedTicks <= 0) continue;
      this.players.set(playerId, result.player);
      for (const hazard of result.hazardDamages) {
        this.applyPlayerDamage({
          victimPlayerId: playerId,
          damage: hazard.damage,
          source: hazard.kind,
          eventId: `hazard-${hazard.kind}-${playerId}-${hazard.damagedAt}`,
          now: hazard.damagedAt,
        });
      }
      advanced = true;
    }
    if (this.advanceServerProjectiles(timestamp)) advanced = true;
    if (advanced) this.recordSnapshotHistory(timestamp);
    return advanced;
  }

  private advanceServerProjectiles(timestamp: number): boolean {
    if (!this.serverProjectiles.size) return false;
    let advanced = false;
    for (const [projectileId, projectile] of [...this.serverProjectiles]) {
      const result = advanceQuakeMultiplayerServerProjectile(projectile, {
        collisionWorld: this.trustedSceneMovement?.collisionWorld,
        now: timestamp,
        players: this.players.values(),
      });
      if (result.type === "active") {
        this.serverProjectiles.set(projectileId, result.projectile);
        advanced = true;
        continue;
      }
      this.serverProjectiles.delete(projectileId);
      advanced = true;
      if (result.type === "expired") {
        this.broadcastRoomEvent({
          eventType: "projectile.impacted",
          eventId: `projectile-expired-${projectileId}`,
          roomTime: this.roomTime(timestamp),
          projectileId,
          ownerPlayerId: result.projectile.ownerPlayerId,
          weapon: result.projectile.weapon,
          origin: result.projectile.origin,
          impactKind: "world",
          playerDamageCount: 0,
        });
        continue;
      }
      this.broadcastRoomEvent({
        eventType: "projectile.impacted",
        eventId: `projectile-impacted-${projectileId}`,
        roomTime: this.roomTime(timestamp),
        projectileId,
        ownerPlayerId: result.projectile.ownerPlayerId,
        weapon: result.projectile.weapon,
        origin: result.impact.origin,
        impactKind: result.impact.kind,
        playerDamageCount: result.impact.damageHits.length,
        ...(result.impact.targetPlayerId ? { targetPlayerId: result.impact.targetPlayerId } : {}),
      });
      const owner = this.players.get(result.projectile.ownerPlayerId);
      const ownerInventory = owner
        ? quakeMultiplayerPruneExpiredPowerups(quakeMultiplayerPlayerInventory(owner), timestamp)
        : null;
      const damageMultiplier = ownerInventory
        ? quakeMultiplayerDamageMultiplierForInventory(ownerInventory, timestamp)
        : 1;
      for (const damageHit of result.impact.damageHits) {
        this.applyPlayerDamage({
          attackerPlayerId: result.projectile.ownerPlayerId,
          victimPlayerId: damageHit.target.playerId,
          damage: damageHit.damage * damageMultiplier,
          source: result.projectile.weapon,
          eventId: `${projectileId}-${damageHit.target.playerId}`,
          inflictorOrigin: result.impact.origin,
          now: timestamp,
        });
      }
    }
    return advanced;
  }

  private playerSimulationStateHasInput(playerId: string): boolean {
    const state = this.playerSimulationStates.get(playerId);
    return Boolean(
      state &&
        (state.lastAcceptedInputSequence > 0 ||
          state.lastAcceptedInput ||
          state.pendingInputs.length > 0),
    );
  }

  private pausePlayerSimulation(playerId: string, now = Date.now()): void {
    const state = this.playerSimulationStates.get(playerId);
    if (!state) return;
    this.playerSimulationStates.set(playerId, pauseQuakeMultiplayerRoomPlayerSimulation(state, now));
  }

  private handleFireIntent(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.fire" }>,
    sender: Party.Connection,
  ): void {
    const state = this.connectionState(sender);
    if (!state?.playerId) return;
    const attacker = this.players.get(state.playerId);
    if (!attacker || !attacker.alive) return;
    if (!this.acceptActivePresenceIntent(sender, message.messageId, state)) return;
    if (!this.acceptActiveMatchIntent(sender, message.messageId)) return;
    const now = Date.now();
    const attackerInventory = quakeMultiplayerInventoryWithBestWeaponIfCurrentAmmoEmpty(
      quakeMultiplayerPruneExpiredPowerups(quakeMultiplayerPlayerInventory(attacker), now),
    );
    const authoritativeFire = quakeMultiplayerDeathmatchFireFromPlayer(
      quakeMultiplayerPlayerWithInventory(attacker, attackerInventory),
      message.payload.fire,
    );
    const cooldownMs = quakeMultiplayerDeathmatchWeaponCooldownMs(authoritativeFire.weapon);
    if (!Number.isFinite(cooldownMs)) {
      this.reject(sender, {
        code: "unsupported",
        message: `Weapon ${authoritativeFire.weapon} is not enabled for multiplayer damage yet.`,
        recoverable: true,
        rejectedMessageId: message.messageId,
      });
      return;
    }
    const inputHistoryValidation = validateQuakeMultiplayerRoomFireInputHistory(
      this.playerSimulationStates.get(attacker.playerId),
      authoritativeFire,
    );
    if (!inputHistoryValidation.ok) {
      this.reject(sender, {
        code: "stale",
        message: `Multiplayer fire timestamp is outside accepted input history (${inputHistoryValidation.reason}).`,
        recoverable: true,
        rejectedMessageId: message.messageId,
      });
      return;
    }
    const nextFireAt = (this.lastFireAtByPlayer.get(attacker.playerId) ?? -Infinity) + cooldownMs;
    if (now < nextFireAt) {
      this.reject(sender, {
        code: "stale",
        message: "Multiplayer fire intent arrived before weapon cooldown elapsed.",
        recoverable: true,
        rejectedMessageId: message.messageId,
        retryAfterMs: Math.max(0, nextFireAt - now),
      });
      return;
    }
    const lightningDischarge = quakeMultiplayerDeathmatchLightningDischarge({
      attacker: quakeMultiplayerPlayerWithInventory(attacker, attackerInventory),
      collisionWorld: this.trustedSceneMovement?.collisionWorld,
      playerEyeHeight: this.trustedSceneMovement?.playerEyeHeight,
      players: this.players.values(),
    });
    if (lightningDischarge) {
      const consumedInventory = quakeMultiplayerConsumeLightningDischargeCells(attackerInventory);
      if (!consumedInventory) {
        this.reject(sender, {
          code: "unsupported",
          message: `Not enough ammo for ${authoritativeFire.weapon}.`,
          recoverable: true,
          rejectedMessageId: message.messageId,
        });
        return;
      }
      const nextInventory = quakeMultiplayerInventoryWithBestWeaponIfCurrentAmmoEmpty(consumedInventory);
      this.lastFireAtByPlayer.set(attacker.playerId, now);
      this.players.set(attacker.playerId, {
        ...quakeMultiplayerPlayerWithInventory(attacker, nextInventory),
        updatedAt: now,
      });
      this.broadcastRoomEvent({
        eventType: "player.fired",
        eventId: `fire-${message.messageId}`,
        roomTime: this.roomTime(),
        playerId: attacker.playerId,
        weapon: authoritativeFire.weapon,
        fireKind: authoritativeFire.fireKind,
        origin: authoritativeFire.origin,
        direction: authoritativeFire.direction,
        decision: {
          outcome: "discharge",
          playerDamageCount: lightningDischarge.hits.length,
          reason: "lightning-discharge",
          targetRewindMs: 0,
        },
      });
      const damageMultiplier = quakeMultiplayerDamageMultiplierForInventory(nextInventory, now);
      for (const hit of lightningDischarge.hits) {
        this.applyPlayerDamage({
          attackerPlayerId: attacker.playerId,
          victimPlayerId: hit.target.playerId,
          damage: hit.damage * damageMultiplier,
          source: "lightning-discharge",
          eventId: `${message.messageId}-discharge-${hit.target.playerId}`,
          inflictorOrigin: attacker.origin,
          now,
        });
      }
      this.broadcastSnapshot();
      return;
    }
    const consumedInventory = quakeMultiplayerConsumeWeaponAmmo(attackerInventory, authoritativeFire.weapon);
    if (!consumedInventory) {
      this.reject(sender, {
        code: "unsupported",
        message: `Not enough ammo for ${authoritativeFire.weapon}.`,
        recoverable: true,
        rejectedMessageId: message.messageId,
      });
      return;
    }
    const nextInventory = quakeMultiplayerInventoryWithBestWeaponIfCurrentAmmoEmpty(consumedInventory);
    this.lastFireAtByPlayer.set(attacker.playerId, now);
    this.players.set(attacker.playerId, {
      ...quakeMultiplayerPlayerWithInventory(attacker, nextInventory),
      updatedAt: now,
    });
    const damageMultiplier = quakeMultiplayerDamageMultiplierForInventory(nextInventory, now);
    const broadcastFired = (decision: QuakeMultiplayerFireDecision): void => {
      this.broadcastRoomEvent({
        eventType: "player.fired",
        eventId: `fire-${message.messageId}`,
        roomTime: this.roomTime(),
        playerId: attacker.playerId,
        weapon: authoritativeFire.weapon,
        fireKind: authoritativeFire.fireKind,
        origin: authoritativeFire.origin,
        direction: authoritativeFire.direction,
        decision,
      });
    };
    if (quakeMultiplayerServerProjectileWeaponSupported(authoritativeFire.weapon)) {
      const projectile = createQuakeMultiplayerServerProjectile({
        fire: authoritativeFire,
        now,
        ownerPlayerId: attacker.playerId,
        projectileId: `projectile-${message.messageId}-${++this.projectileSequence}`,
      });
      if (projectile) {
        this.serverProjectiles.set(projectile.projectileId, projectile);
        broadcastFired({
          outcome: "projectile-spawned",
          playerDamageCount: 0,
          reason: "server-projectile-spawned",
          targetRewindMs: 0,
        });
        this.broadcastRoomEvent({
          eventType: "projectile.spawned",
          eventId: `projectile-spawned-${projectile.projectileId}`,
          roomTime: this.roomTime(),
          projectile: quakeMultiplayerProjectileStateFromServer(projectile),
        });
        this.startSimulationTicker();
        this.broadcastSnapshot();
        return;
      }
    }
    const targetRewindMs = quakeMultiplayerDeathmatchLagCompensationMs(attacker);
    const combatPlayers = this.combatPlayersForFire(attacker.playerId, now - targetRewindMs);
    const hitDecision = quakeMultiplayerDeathmatchVisibleHitDecision(
      authoritativeFire,
      combatPlayers,
      attacker.playerId,
      this.trustedSceneMovement?.collisionWorld,
    );
    const hit = hitDecision.hit;
    const worldHit = quakeMultiplayerShootableWorldHit(authoritativeFire, this.worldDefinitions.values());
    if (worldHit && (!hit || worldHit.distance <= hit.distance)) {
      const worldSplashHits = quakeMultiplayerDeathmatchProjectileSplashHitsAtImpact(
        authoritativeFire,
        worldHit.impact,
        combatPlayers,
        attacker.playerId,
        this.trustedSceneMovement?.collisionWorld,
        undefined,
      );
      broadcastFired({
        blockedCandidateCount: hitDecision.blockedCandidateCount,
        candidateCount: hitDecision.candidateCount,
        outcome: "hit-world",
        playerDamageCount: worldSplashHits.length,
        reason: "world-before-player",
        targetEntityIndex: worldHit.definition.entityIndex,
        targetRewindMs,
        worldHitDistance: worldHit.distance,
      });
      const damage = quakeMultiplayerDeathmatchWeaponDamage(authoritativeFire.weapon) * damageMultiplier;
      if (worldHit.definition.kind === "mover") {
        this.applyShootableMoverDamage(
          worldHit.definition,
          attacker.playerId,
          `mover-shoot-${message.messageId}-${worldHit.definition.entityIndex}`,
          damage,
        );
      } else {
        this.applyShootableTriggerDamage(
          worldHit.definition,
          attacker.playerId,
          `trigger-shoot-${message.messageId}-${worldHit.definition.entityIndex}`,
          damage,
        );
      }
      for (const damageHit of worldSplashHits) {
        this.applyPlayerDamage({
          attackerPlayerId: attacker.playerId,
          victimPlayerId: damageHit.target.playerId,
          damage: damageHit.damage * damageMultiplier,
          source: authoritativeFire.weapon,
          eventId: `${message.messageId}-world-splash-${damageHit.target.playerId}`,
          inflictorOrigin: damageHit.impact,
          now,
        });
      }
      this.broadcastSnapshot();
      return;
    }
    if (!hit) {
      const worldSplashHits = quakeMultiplayerDeathmatchProjectileWorldSplashHits(
        authoritativeFire,
        combatPlayers,
        attacker.playerId,
        this.trustedSceneMovement?.collisionWorld,
      );
      broadcastFired({
        blockedCandidateCount: hitDecision.blockedCandidateCount,
        candidateCount: hitDecision.candidateCount,
        outcome: worldSplashHits.length > 0 ? "world-splash" : "miss",
        playerDamageCount: worldSplashHits.length,
        reason: worldSplashHits.length > 0
          ? "projectile-world-splash"
          : authoritativeFire.fireKind === "projectile" && hitDecision.candidateCount === 0
            ? "no-world-impact"
            : hitDecision.reason,
        targetRewindMs,
      });
      for (const damageHit of worldSplashHits) {
        this.applyPlayerDamage({
          attackerPlayerId: attacker.playerId,
          victimPlayerId: damageHit.target.playerId,
          damage: damageHit.damage * damageMultiplier,
          source: authoritativeFire.weapon,
          eventId: `${message.messageId}-wall-splash-${damageHit.target.playerId}`,
          inflictorOrigin: damageHit.impact,
          now,
        });
      }
      this.broadcastSnapshot();
      return;
    }
    const splashHits = quakeMultiplayerDeathmatchSplashHits(
      authoritativeFire,
      hit,
      combatPlayers,
      attacker.playerId,
      this.trustedSceneMovement?.collisionWorld,
    );
    broadcastFired({
      blockedCandidateCount: hitDecision.blockedCandidateCount,
      candidateCount: hitDecision.candidateCount,
      outcome: "hit-player",
      playerDamageCount: splashHits.length,
      reason: "player-direct",
      targetPlayerId: hit.target.playerId,
      targetRewindMs,
    });
    for (const damageHit of splashHits) {
      this.applyPlayerDamage({
        attackerPlayerId: attacker.playerId,
        victimPlayerId: damageHit.target.playerId,
        damage: damageHit.damage * damageMultiplier,
        source: authoritativeFire.weapon,
        eventId: damageHit.direct ? message.messageId : `${message.messageId}-${damageHit.target.playerId}`,
        inflictorOrigin: authoritativeFire.fireKind === "projectile" ? damageHit.impact : attacker.origin,
        now,
      });
    }
    this.broadcastSnapshot();
  }

  private applyPlayerDamage(input: {
    attackerPlayerId?: string;
    victimPlayerId: string;
    damage: number;
    source: string;
    eventId: string;
    inflictorOrigin?: QuakeMultiplayerVec3 | null;
    now?: number;
  }): void {
    const victim = this.players.get(input.victimPlayerId);
    if (!victim || !victim.alive) return;
    const damage = Math.max(0, input.damage);
    if (damage <= 0) return;
    const now = input.now ?? Date.now();
    const victimInventory = quakeMultiplayerPruneExpiredPowerups(quakeMultiplayerPlayerInventory(victim), now);
    const invulnerable = quakeMultiplayerPlayerPowerupActive(victim, "invincible_finished", now);
    const nextInventory = quakeMultiplayerApplyDamageToInventory(
      victimInventory,
      damage,
      { applyHealth: !invulnerable },
    );
    const died = !invulnerable && nextInventory.health <= 0;
    const resolvedInventory = died
      ? quakeMultiplayerInventoryWithoutDeathPowerups(nextInventory)
      : nextInventory;
    const victimFragDelta = died
      ? Math.min(0, quakeMultiplayerDeathmatchFragDeltaForKill({
          attackerPlayerId: input.attackerPlayerId,
          victimPlayerId: victim.playerId,
        }))
      : 0;
    const damagedVictim = quakeMultiplayerDeathmatchPlayerWithDamageMomentum({
      player: quakeMultiplayerPlayerWithInventory(victim, resolvedInventory),
      damage,
      inflictorOrigin: input.inflictorOrigin,
    });
    const updatedVictim: QuakeMultiplayerAuthoritativePlayerState = {
      ...damagedVictim,
      alive: !died,
      frags: victim.frags + victimFragDelta,
      deaths: died ? victim.deaths + 1 : victim.deaths,
      updatedAt: now,
      ...(died ? { respawnAt: now + QUAKE_MULTIPLAYER_DEATHMATCH_RESPAWN_DELAY_MS } : {}),
    };
    this.players.set(victim.playerId, updatedVictim);
    if (invulnerable) {
      this.broadcastSnapshot();
      return;
    }
    if (died) {
      const attacker = input.attackerPlayerId ? this.players.get(input.attackerPlayerId) : undefined;
      let matchEnded = false;
      if (attacker && attacker.playerId !== victim.playerId) {
        const fragDelta = quakeMultiplayerDeathmatchFragDeltaForKill({
          attackerPlayerId: attacker.playerId,
          victimPlayerId: victim.playerId,
        });
        const updatedAttacker = {
          ...attacker,
          frags: attacker.frags + fragDelta,
          updatedAt: now,
        };
        this.players.set(attacker.playerId, updatedAttacker);
      }
      this.broadcastRoomEvent({
        eventType: "player.killed",
        eventId: `kill-${input.eventId}`,
        roomTime: this.roomTime(now),
        victimPlayerId: victim.playerId,
        ...(input.attackerPlayerId ? { attackerPlayerId: input.attackerPlayerId } : {}),
        damageSource: input.source,
      });
      const updatedAttacker = input.attackerPlayerId ? this.players.get(input.attackerPlayerId) : undefined;
      if (updatedAttacker && updatedAttacker.playerId !== victim.playerId) {
        matchEnded = this.enterIntermissionIfFragLimitReached(updatedAttacker, input.eventId);
      }
      this.dropPlayerBackpack(victim, now);
      this.clearPickupOwnership(victim.playerId, now);
      this.pausePlayerSimulation(victim.playerId, now);
      if (!matchEnded) this.schedulePlayerRespawn(victim.playerId, updatedVictim.respawnAt ?? now, now);
    } else {
      this.broadcastRoomEvent({
        eventType: "player.damaged",
        eventId: `damage-${input.eventId}`,
        roomTime: this.roomTime(now),
        victimPlayerId: victim.playerId,
        ...(input.attackerPlayerId ? { attackerPlayerId: input.attackerPlayerId } : {}),
        damage,
        health: updatedVictim.health,
        armor: updatedVictim.armor,
        damageSource: input.source,
      });
    }
    this.broadcastSnapshot();
  }

  private schedulePlayerRespawn(playerId: string, respawnAt: number, now = Date.now()): void {
    const previous = this.respawnTimers.get(playerId);
    if (previous) clearTimeout(previous);
    const delay = Math.max(0, respawnAt - now);
    const timer = setTimeout(() => {
      this.respawnTimers.delete(playerId);
      this.respawnPlayer(playerId);
    }, delay);
    this.respawnTimers.set(playerId, timer);
  }

  private respawnPlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || player.alive) return;
    const spawn = this.nextSpawnPoint();
    const inventory = createQuakeMultiplayerInitialInventory();
    this.clearPickupOwnership(playerId);
    const respawned: QuakeMultiplayerAuthoritativePlayerState = {
      ...quakeMultiplayerPlayerWithInventory(player, inventory),
      ...(spawn ? { spawnId: spawn.spawnId, origin: spawn.origin, rotX: spawn.rotX, rotY: spawn.rotY } : {}),
      velocity: [0, 0, 0],
      alive: true,
      respawnAt: undefined,
      updatedAt: Date.now(),
    };
    this.players.set(playerId, respawned);
    this.playerSimulationStates.set(playerId, createQuakeMultiplayerRoomPlayerSimulationState({
      playerId,
      now: Date.now(),
      lastAcceptedInputSequence: respawned.lastInputSequence,
    }));
    this.broadcastRoomEvent({
      eventType: "player.respawned",
      eventId: `respawn-${playerId}-${Date.now()}`,
      roomTime: this.roomTime(),
      player: respawned,
    });
    this.broadcastSnapshot();
  }

  private registerPickupDefinitions(definitions: readonly QuakeMultiplayerPickupDefinition[]): void {
    for (const definition of definitions) {
      if (this.pickupDefinitions.has(definition.entityIndex)) continue;
      this.pickupDefinitions.set(definition.entityIndex, definition);
      this.pickupStates.set(definition.entityIndex, {
        pickupId: definition.pickupId,
        entityIndex: definition.entityIndex,
        available: true,
        updatedAt: Date.now(),
      });
    }
  }

  private dynamicPickupDefinitions(): QuakeMultiplayerPickupDefinition[] {
    return [...this.pickupDefinitions.values()].filter((definition) => definition.runtime === true);
  }

  private dropPlayerBackpack(
    player: QuakeMultiplayerAuthoritativePlayerState,
    now: number,
  ): void {
    const definition = quakeMultiplayerDroppedBackpackDefinition({
      player,
      entityIndex: this.dynamicPickupSequence++,
      now,
    });
    if (!definition) return;
    const pickup: QuakeMultiplayerAuthoritativePickupState = {
      pickupId: definition.pickupId,
      entityIndex: definition.entityIndex,
      available: true,
      updatedAt: now,
    };
    this.pickupDefinitions.set(definition.entityIndex, definition);
    this.pickupStates.set(definition.entityIndex, pickup);
    this.broadcastRoomEvent({
      eventType: "pickup.dropped",
      eventId: `pickup-drop-${definition.entityIndex}-${now}`,
      roomTime: this.roomTime(now),
      sourcePlayerId: player.playerId,
      definition,
      pickup,
    });
    if (definition.removeAt !== undefined) {
      this.schedulePickupRemoval(definition.entityIndex, definition.removeAt);
    }
  }

  private schedulePickupRemoval(entityIndex: number, removeAt: number): void {
    const previous = this.pickupRemovalTimers.get(entityIndex);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.pickupRemovalTimers.delete(entityIndex);
      const definition = this.pickupDefinitions.get(entityIndex);
      const state = this.pickupStates.get(entityIndex);
      if (!definition?.runtime || !state?.available) return;
      this.broadcastRoomEvent({
        eventType: "pickup.expired",
        eventId: `pickup-expired-${entityIndex}-${Date.now()}`,
        roomTime: this.roomTime(),
        pickupId: definition.pickupId,
        entityIndex,
      });
      this.removePickupDefinition(entityIndex);
      this.broadcastSnapshot();
    }, Math.max(0, removeAt - Date.now()));
    unrefTimer(timer);
    this.pickupRemovalTimers.set(entityIndex, timer);
  }

  private removePickupDefinition(entityIndex: number): void {
    this.pickupDefinitions.delete(entityIndex);
    this.pickupStates.delete(entityIndex);
    const timer = this.pickupRemovalTimers.get(entityIndex);
    if (timer) clearTimeout(timer);
    this.pickupRemovalTimers.delete(entityIndex);
    const respawnTimer = this.pickupRespawnTimers.get(entityIndex);
    if (respawnTimer) clearTimeout(respawnTimer);
    this.pickupRespawnTimers.delete(entityIndex);
  }

  private clearRuntimePickupDefinitions(): void {
    for (const definition of this.dynamicPickupDefinitions()) {
      this.removePickupDefinition(definition.entityIndex);
    }
  }

  private registerWorldDefinitions(definitions: readonly QuakeMultiplayerWorldDefinition[]): void {
    for (const definition of definitions) {
      if (this.worldDefinitions.has(definition.entityIndex)) continue;
      this.worldDefinitions.set(definition.entityIndex, definition);
      if (definition.kind === "mover") this.resetMoverCollisionOffset(definition.entityIndex);
    }
  }

  private handlePickupIntent(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.pickup" }>,
    sender: Party.Connection,
  ): void {
    const connectionState = this.connectionState(sender);
    if (!connectionState?.playerId) return;
    const player = this.players.get(connectionState.playerId);
    if (!player || !player.alive) return;
    if (!this.acceptActivePresenceIntent(sender, message.messageId, connectionState)) return;
    if (!this.acceptActiveMatchIntent(sender, message.messageId)) return;
    const definition = this.pickupDefinitions.get(message.payload.pickup.entityIndex);
    const state = this.pickupStates.get(message.payload.pickup.entityIndex);
    if (!definition || !state) {
      return;
    }
    const ownerPlayerIds = new Set(state.ownerPlayerIds ?? []);
    if (!state.available || ownerPlayerIds.has(player.playerId)) {
      this.broadcastPickupRejected(player.playerId, message, definition, "unavailable");
      return;
    }
    if (!quakeMultiplayerPlayerCanReachPickup(player, definition, undefined, message.payload.pickup.origin)) {
      this.broadcastPickupRejected(player.playerId, message, definition, "too-far");
      return;
    }
    const now = Date.now();
    const inventory = quakeMultiplayerPruneExpiredPowerups(quakeMultiplayerPlayerInventory(player), now);
    if (
      !quakeMultiplayerPickupAlwaysAcceptsTouch(definition) &&
      !quakeMultiplayerInventoryCanAcceptPickupEffect(inventory, definition.effect, now)
    ) {
      this.broadcastPickupRejected(player.playerId, message, definition, "not-needed");
      return;
    }
    const updatedPlayer = {
      ...quakeMultiplayerPlayerWithInventory(
        player,
        quakeMultiplayerApplyPickupEffect(inventory, definition.effect, now),
      ),
      updatedAt: now,
    };
    this.players.set(player.playerId, updatedPlayer);
    const leaveInPlace = definition.lifecycle?.action === "leave";
    const updatedState: QuakeMultiplayerAuthoritativePickupState = {
      ...state,
      available: leaveInPlace,
      updatedAt: now,
      ...(leaveInPlace ? { ownerPlayerIds: [...ownerPlayerIds, player.playerId] } : {}),
      ...(!leaveInPlace && definition.lifecycle?.action === "respawn" && definition.lifecycle.delayMs !== undefined
        ? { respawnAt: now + definition.lifecycle.delayMs }
        : {}),
    };
    this.pickupStates.set(definition.entityIndex, updatedState);
    this.broadcastRoomEvent({
      eventType: "pickup.taken",
      eventId: `pickup-${message.messageId}`,
      roomTime: this.roomTime(),
      playerId: player.playerId,
      pickupId: definition.pickupId,
      entityIndex: definition.entityIndex,
      effect: definition.effect,
      leaveInPlace,
      ...(updatedState.respawnAt !== undefined ? { respawnAt: updatedState.respawnAt } : {}),
      ...(definition.feedback ? { feedback: definition.feedback } : {}),
    });
    if (!leaveInPlace && updatedState.respawnAt !== undefined) {
      this.schedulePickupRespawn(definition.entityIndex, updatedState.respawnAt);
    }
    const targetDispatch = this.pickupTargetDispatchSource(definition);
    if (targetDispatch) this.scheduleTargetDispatch(targetDispatch, player.playerId, `pickup-${message.messageId}`);
    if (definition.runtime && !leaveInPlace && updatedState.respawnAt === undefined) {
      this.removePickupDefinition(definition.entityIndex);
    }
    this.broadcastSnapshot();
  }

  private handleMatchIntent(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.match" }>,
    sender: Party.Connection,
  ): void {
    const connectionState = this.connectionState(sender);
    if (!connectionState?.playerId) return;
    if (!this.acceptActivePresenceIntent(sender, message.messageId, connectionState)) return;
    if (this.matchStatus !== "intermission") {
      this.reject(sender, {
        code: "unsupported",
        message: "Multiplayer match can only be restarted during intermission.",
        recoverable: true,
        rejectedMessageId: message.messageId,
      });
      return;
    }
    this.restartMatch(message.messageId);
  }

  private handleWorldEvent(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.world" }>,
    sender: Party.Connection,
  ): void {
    const connectionState = this.connectionState(sender);
    if (!connectionState?.playerId) return;
    const player = this.players.get(connectionState.playerId);
    if (!player) return;
    if (!message.payload.intent) {
      this.reject(sender, rejectQuakeMultiplayerClientWorldEvent(message));
      return;
    }
    if (!this.acceptActivePresenceIntent(sender, message.messageId, connectionState)) return;
    if (!this.acceptActiveMatchIntent(sender, message.messageId)) return;
    const resolution = resolveQuakeMultiplayerWorldIntent(
      player,
      message.payload.intent,
      this.worldDefinitions.values(),
      Date.now(),
    );
    if (!resolution.ok) {
      if (quakeMultiplayerWorldIntentRejectionIsIgnorableTouchMiss(message.payload.intent, resolution.reason)) {
        return;
      }
      this.reject(sender, {
        code: "unsupported",
        message: resolution.message,
        recoverable: true,
        rejectedMessageId: message.messageId,
        details: { reason: resolution.reason, ...(resolution.details ?? {}) },
      });
      return;
    }
    if (resolution.kind === "teleport") {
      if (!this.acceptTeleportTouch(resolution.definition, Date.now())) {
        this.reject(sender, {
          code: "unsupported",
          message: "Multiplayer teleporter is not active.",
          recoverable: true,
          rejectedMessageId: message.messageId,
          details: { reason: "teleport-inactive" },
        });
        return;
      }
      this.applyTeleportDeath(player.playerId, resolution.definition.destinationOrigin, message.messageId);
      const currentPlayer = this.players.get(player.playerId) ?? player;
      const teleportedPlayer = {
        ...currentPlayer,
        origin: resolution.player.origin,
        velocity: resolution.player.velocity,
        rotX: resolution.player.rotX,
        rotY: resolution.player.rotY,
        lastInputSequence: resolution.player.lastInputSequence,
        updatedAt: resolution.player.updatedAt,
      };
      this.players.set(player.playerId, teleportedPlayer);
      if (teleportedPlayer.alive) {
        const timestamp = Date.now();
        this.playerSimulationStates.set(player.playerId, createQuakeMultiplayerRoomPlayerSimulationState({
          playerId: player.playerId,
          now: timestamp,
          grounded: false,
          lastAcceptedInputSequence: teleportedPlayer.lastInputSequence,
          teleportBackpedalLockUntil: timestamp + QUAKE_MULTIPLAYER_TELEPORT_BACKPEDAL_LOCK_MS,
        }));
      } else {
        this.pausePlayerSimulation(player.playerId);
      }
      this.broadcastRoomEvent({
        eventType: "world.teleport",
        eventId: `teleport-${message.messageId}`,
        roomTime: this.roomTime(),
        playerId: player.playerId,
        entityIndex: resolution.definition.entityIndex,
        origin: resolution.definition.destinationOrigin,
        velocity: teleportedPlayer.velocity,
        destinationEntityIndex: resolution.definition.destinationEntityIndex,
      });
      this.broadcastSnapshot();
      return;
    }
    if (resolution.kind === "hurt") {
      const timestamp = Date.now();
      if (!this.acceptHurtTouch(resolution.definition.entityIndex, timestamp)) return;
      this.applyPlayerDamage({
        victimPlayerId: player.playerId,
        damage: resolution.damage,
        source: "trigger_hurt",
        eventId: `world-${message.messageId}`,
        now: timestamp,
      });
      return;
    }
    if (resolution.kind === "push") {
      this.players.set(player.playerId, resolution.player);
      const simulationState = this.playerSimulationStates.get(player.playerId);
      if (simulationState) {
        const { floorZ: _floorZ, ...nextSimulationState } = simulationState;
        this.playerSimulationStates.set(player.playerId, {
          ...nextSimulationState,
          grounded: false,
        });
      }
      if (resolution.definition.oneShot) this.removeWorldDefinition(resolution.definition.entityIndex);
      this.broadcastRoomEvent({
        eventType: "world.push",
        eventId: `push-${message.messageId}`,
        roomTime: this.roomTime(),
        playerId: player.playerId,
        entityIndex: resolution.definition.entityIndex,
        velocity: resolution.definition.velocity,
        oneShot: resolution.definition.oneShot,
      });
      this.broadcastSnapshot();
      return;
    }
    if (resolution.kind === "trigger") {
      if (!this.acceptTriggerTouch(resolution.definition, Date.now())) return;
      if (resolution.definition.oneShot) this.removeWorldDefinition(resolution.definition.entityIndex);
      const eventId = `trigger-${message.messageId}`;
      this.broadcastRoomEvent({
        eventType: "world.trigger",
        eventId,
        roomTime: this.roomTime(),
        playerId: player.playerId,
        entityIndex: resolution.definition.entityIndex,
        classname: resolution.definition.classname,
        activation: "touch",
        targetEntityIndexes: resolution.definition.targetEntityIndexes,
        ...(resolution.definition.killtargetEntityIndexes ? {
          killtargetEntityIndexes: resolution.definition.killtargetEntityIndexes,
        } : {}),
        delayMs: resolution.definition.delayMs,
        waitMs: resolution.definition.waitMs,
        oneShot: resolution.definition.oneShot,
        ...(resolution.definition.message ? { message: resolution.definition.message } : {}),
        ...(resolution.definition.soundPath ? { soundPath: resolution.definition.soundPath } : {}),
      });
      this.scheduleTargetDispatch(resolution.definition, player.playerId, eventId);
      return;
    }
    if (resolution.kind === "mover") {
      this.activateMover(resolution.definition, player.playerId, `mover-${message.messageId}`, 0, "touch");
      return;
    }
    this.matchStatus = "intermission";
    this.clearTimeoutMap(this.respawnTimers);
    this.clearTimeoutMap(this.targetDispatchTimers);
    this.clearTimeoutMap(this.moverStateTimers);
    this.resetMoverCollisionOffsets();
    this.moverStates.clear();
    this.moverShootHealth.clear();
    this.broadcastRoomEvent({
      eventType: "level.transition",
      eventId: `level-transition-${message.messageId}`,
      roomTime: this.roomTime(),
      playerId: player.playerId,
      entityIndex: resolution.definition.entityIndex,
      targetMap: resolution.definition.targetMap,
    });
    this.broadcastRoomEvent({
      eventType: "match.notice",
      eventId: `match-level-transition-${message.messageId}`,
      roomTime: this.roomTime(),
      code: "level-transition",
      message: `Level transition requested: ${resolution.definition.targetMap}.`,
    });
    this.scheduleMatchRestart(message.messageId);
    this.broadcastSnapshot();
  }

  private broadcastPickupRejected(
    playerId: string,
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.pickup" }>,
    definition: QuakeMultiplayerPickupDefinition | undefined,
    reason: string,
  ): void {
    this.broadcastRoomEvent({
      eventType: "pickup.rejected",
      eventId: `pickup-reject-${message.messageId}`,
      roomTime: this.roomTime(),
      playerId,
      ...(definition ? { pickupId: definition.pickupId } : {}),
      entityIndex: message.payload.pickup.entityIndex,
      reason,
    });
  }

  private schedulePickupRespawn(entityIndex: number, respawnAt: number): void {
    const previous = this.pickupRespawnTimers.get(entityIndex);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.pickupRespawnTimers.delete(entityIndex);
      const state = this.pickupStates.get(entityIndex);
      if (!state) return;
      const respawned = quakeMultiplayerPickupStateRespawned(state, Date.now());
      this.pickupStates.set(entityIndex, respawned);
      this.broadcastRoomEvent({
        eventType: "pickup.respawned",
        eventId: `pickup-respawn-${entityIndex}-${Date.now()}`,
        roomTime: this.roomTime(),
        pickup: respawned,
      });
      this.broadcastSnapshot();
    }, Math.max(0, respawnAt - Date.now()));
    this.pickupRespawnTimers.set(entityIndex, timer);
  }

  private acceptHurtTouch(entityIndex: number, timestamp: number): boolean {
    const nextAllowedAt = this.hurtNextTouchAtByEntity.get(entityIndex) ?? -Infinity;
    if (timestamp < nextAllowedAt) return false;
    this.hurtNextTouchAtByEntity.set(entityIndex, timestamp + QUAKE_MULTIPLAYER_TRIGGER_HURT_COOLDOWN_MS);
    return true;
  }

  private acceptTeleportTouch(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "teleport" }>,
    timestamp: number,
  ): boolean {
    if (!definition.touchRequiresActivation) return true;
    const activeUntil = this.teleportActiveUntilByEntity.get(definition.entityIndex) ?? -Infinity;
    return timestamp <= activeUntil;
  }

  private acceptTriggerTouch(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>,
    timestamp: number,
  ): boolean {
    const nextAllowedAt = this.triggerNextTouchAt.get(definition.entityIndex) ?? -Infinity;
    if (timestamp < nextAllowedAt) return false;
    if (definition.oneShot) {
      this.triggerNextTouchAt.set(definition.entityIndex, Infinity);
    } else if (definition.waitMs > 0) {
      this.triggerNextTouchAt.set(definition.entityIndex, timestamp + definition.waitMs);
    }
    return true;
  }

  private scheduleTargetDispatch(
    definition: CssQuakeTargetDispatchSource,
    playerId: string,
    sourceEventId: string,
    cascadeDepth = 0,
    dispatchDelayMs = definition.delayMs,
  ): void {
    const dispatch = (): void => {
      this.targetDispatchTimers.delete(sourceEventId);
      if (!this.roomKey || this.matchStatus !== "active") return;
      for (const entityIndex of definition.killtargetEntityIndexes ?? []) {
        this.removeKilltargetEntity(entityIndex);
      }
      this.broadcastRoomEvent({
        eventType: "world.targets",
        eventId: `targets-${sourceEventId}`,
        roomTime: this.roomTime(),
        sourceEventId,
        sourceEntityIndex: definition.entityIndex,
        playerId,
        targetEntityIndexes: definition.targetEntityIndexes,
        ...(definition.killtargetEntityIndexes ? { killtargetEntityIndexes: definition.killtargetEntityIndexes } : {}),
        delayMs: definition.delayMs,
        ...(definition.message ? { message: definition.message } : {}),
        ...(definition.soundPath ? { soundPath: definition.soundPath } : {}),
      });
      this.activateTargetReceivers(definition.targetEntityIndexes, playerId, sourceEventId, cascadeDepth + 1);
    };
    if (dispatchDelayMs <= 0) {
      dispatch();
      return;
    }
    const timer = setTimeout(dispatch, dispatchDelayMs);
    this.targetDispatchTimers.set(sourceEventId, timer);
    timer.unref?.();
  }

  private removeWorldDefinition(entityIndex: number): void {
    this.resetMoverCollisionOffset(entityIndex);
    this.worldDefinitions.delete(entityIndex);
    this.teleportActiveUntilByEntity.delete(entityIndex);
    this.triggerCounterRemaining.delete(entityIndex);
    this.triggerShootHealth.delete(entityIndex);
    this.moverStates.delete(entityIndex);
    this.moverShootHealth.delete(entityIndex);
    this.clearMoverStateTimers(entityIndex);
  }

  private removeKilltargetEntity(entityIndex: number): void {
    this.removeWorldDefinition(entityIndex);
    this.pickupStates.delete(entityIndex);
    const pickupTimer = this.pickupRespawnTimers.get(entityIndex);
    if (pickupTimer) clearTimeout(pickupTimer);
    this.pickupRespawnTimers.delete(entityIndex);
  }

  private pickupTargetDispatchSource(
    definition: QuakeMultiplayerPickupDefinition,
  ): CssQuakeTargetDispatchSource | null {
    const targetEntityIndexes = definition.targetEntityIndexes ?? [];
    const killtargetEntityIndexes = definition.killtargetEntityIndexes ?? [];
    if (!targetEntityIndexes.length && !killtargetEntityIndexes.length && !definition.message) return null;
    return {
      entityIndex: definition.entityIndex,
      targetEntityIndexes,
      ...(killtargetEntityIndexes.length ? { killtargetEntityIndexes } : {}),
      delayMs: definition.delayMs ?? 0,
      ...(definition.message ? { message: definition.message } : {}),
    };
  }

  private applyTeleportDeath(ownerPlayerId: string, destinationOrigin: QuakeMultiplayerVec3, eventId: string): void {
    const timestamp = Date.now();
    for (const victim of [...this.players.values()]) {
      if (victim.playerId === ownerPlayerId) continue;
      if (!quakeMultiplayerPlayerIntersectsTelefragVolume(victim, destinationOrigin)) continue;
      const owner = this.players.get(ownerPlayerId);
      const victimInvulnerable = quakeMultiplayerPlayerPowerupActive(victim, "invincible_finished", timestamp);
      const ownerInvulnerable = owner
        ? quakeMultiplayerPlayerPowerupActive(owner, "invincible_finished", timestamp)
        : false;
      if (victimInvulnerable && owner && ownerInvulnerable) {
        this.players.set(
          victim.playerId,
          quakeMultiplayerPlayerWithoutPowerup(victim, "invincible_finished"),
        );
        this.players.set(
          owner.playerId,
          quakeMultiplayerPlayerWithoutPowerup(owner, "invincible_finished"),
        );
        this.applyPlayerDamage({
          victimPlayerId: victim.playerId,
          damage: QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE,
          source: "teledeath3",
          eventId: `telefrag-double-${eventId}-${victim.playerId}`,
          now: timestamp,
        });
        this.applyPlayerDamage({
          victimPlayerId: owner.playerId,
          damage: QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE,
          source: "teledeath3",
          eventId: `telefrag-double-${eventId}-${owner.playerId}`,
          now: timestamp,
        });
        continue;
      }
      if (victimInvulnerable) {
        this.applyPlayerDamage({
          attackerPlayerId: ownerPlayerId,
          victimPlayerId: ownerPlayerId,
          damage: QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE,
          source: "teledeath2",
          eventId: `telefrag-deflect-${eventId}-${victim.playerId}`,
          now: timestamp,
        });
        continue;
      }
      this.applyPlayerDamage({
        attackerPlayerId: ownerPlayerId,
        victimPlayerId: victim.playerId,
        damage: QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE,
        source: "teledeath",
        eventId: `telefrag-${eventId}-${victim.playerId}`,
        now: timestamp,
      });
    }
  }

  private activateTargetReceivers(
    entityIndexes: readonly number[],
    playerId: string,
    sourceEventId: string,
    cascadeDepth: number,
  ): void {
    if (cascadeDepth > 8) return;
    for (const entityIndex of entityIndexes) {
      const definition = this.worldDefinitions.get(entityIndex);
      if (definition?.kind === "trigger" && definition.useActivates) {
        this.activateTargetTrigger(definition, playerId, sourceEventId, cascadeDepth);
      } else if (definition?.kind === "teleport" && definition.touchRequiresActivation) {
        this.activateTargetTeleport(definition, playerId, sourceEventId);
      } else if (definition?.kind === "mover" && definition.useActivates) {
        this.activateMover(definition, playerId, `mover-${sourceEventId}-${definition.entityIndex}`, cascadeDepth, "target");
      }
    }
  }

  private activateTargetTeleport(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "teleport" }>,
    playerId: string,
    sourceEventId: string,
  ): void {
    const activeForMs = definition.activationWindowMs ?? QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS;
    this.teleportActiveUntilByEntity.set(definition.entityIndex, Date.now() + activeForMs);
    this.broadcastRoomEvent({
      eventType: "world.use",
      eventId: `teleport-use-${sourceEventId}-${definition.entityIndex}`,
      roomTime: this.roomTime(),
      playerId,
      entityIndex: definition.entityIndex,
    });
  }

  private activateTargetTrigger(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>,
    playerId: string,
    sourceEventId: string,
    cascadeDepth: number,
  ): void {
    if (definition.classname === "trigger_counter") {
      const previous = this.triggerCounterRemaining.get(definition.entityIndex) ?? Math.max(0, definition.count ?? 2);
      if (previous <= 0) return;
      const remaining = Math.max(0, previous - 1);
      this.triggerCounterRemaining.set(definition.entityIndex, remaining);
      const complete = remaining === 0;
      const eventId = `trigger-${sourceEventId}-${definition.entityIndex}-${previous}`;
      this.broadcastTargetTriggerEvent(definition, playerId, eventId, remaining, complete);
      if (!complete) return;
      if (definition.oneShot) this.removeWorldDefinition(definition.entityIndex);
      this.scheduleTargetDispatch(definition, playerId, eventId, cascadeDepth);
      return;
    }
    if (quakeMultiplayerTriggerUsesMultiTrigger(definition)) {
      if (!this.acceptTriggerTouch(definition, Date.now())) return;
      const eventId = `trigger-${sourceEventId}-${definition.entityIndex}`;
      if (definition.oneShot) this.removeWorldDefinition(definition.entityIndex);
      this.broadcastTargetTriggerEvent(definition, playerId, eventId, undefined, true);
      this.scheduleTargetDispatch(definition, playerId, eventId, cascadeDepth);
      return;
    }
    if (definition.classname !== "trigger_relay") return;
    const eventId = `trigger-${sourceEventId}-${definition.entityIndex}`;
    this.broadcastTargetTriggerEvent(definition, playerId, eventId, undefined, true);
    this.scheduleTargetDispatch(definition, playerId, eventId, cascadeDepth);
  }

  private activateMover(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    playerId: string,
    eventId: string,
    cascadeDepth: number,
    activation: "touch" | "target" | "shoot",
  ): void {
    const state = this.moverStates.get(definition.entityIndex) ?? "bottom";
    if (state === "moving-up" || state === "top") return;
    this.moverStates.set(definition.entityIndex, "moving-up");
    this.clearMoverStateTimers(definition.entityIndex);
    this.applyMoverCollisionOffset(definition, "moving-up");
    this.broadcastMoverEvent(definition, playerId, eventId, activation, "moving-up");
    this.scheduleMoverStateTransition(definition, playerId, eventId, activation, "top", definition.moveMs);
    if (definition.returnDelayMs !== undefined) {
      this.scheduleMoverStateTransition(
        definition,
        playerId,
        eventId,
        activation,
        "moving-down",
        definition.moveMs + definition.returnDelayMs,
      );
      this.scheduleMoverStateTransition(
        definition,
        playerId,
        eventId,
        activation,
        "bottom",
        definition.moveMs + definition.returnDelayMs + definition.moveMs,
      );
    }
    this.scheduleTargetDispatch(definition, playerId, eventId, cascadeDepth, definition.moveMs + definition.delayMs);
  }

  private broadcastMoverEvent(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    playerId: string,
    eventId: string,
    activation: "touch" | "target" | "shoot",
    state: CssQuakeMoverState,
  ): void {
    const [fromOrigin, toOrigin] = cssQuakeMoverStateOrigins(definition, state);
    this.broadcastRoomEvent({
      eventType: "world.mover",
      eventId,
      roomTime: this.roomTime(),
      playerId,
      entityIndex: definition.entityIndex,
      classname: definition.classname,
      activation,
      state,
      fromOrigin,
      toOrigin,
      speed: definition.speed,
      moveMs: definition.moveMs,
      ...(definition.returnDelayMs !== undefined ? { returnDelayMs: definition.returnDelayMs } : {}),
      targetEntityIndexes: definition.targetEntityIndexes,
      ...(definition.killtargetEntityIndexes ? { killtargetEntityIndexes: definition.killtargetEntityIndexes } : {}),
      delayMs: definition.delayMs,
      ...(definition.soundPath ? { soundPath: definition.soundPath } : {}),
    });
  }

  private applyShootableMoverDamage(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    playerId: string,
    eventId: string,
    damage: number,
  ): boolean {
    if (!definition.shootActivates) return false;
    const state = this.moverStates.get(definition.entityIndex) ?? "bottom";
    if (state === "moving-up" || state === "top") return true;
    const maxHealth = Math.max(1, Math.round(definition.shootHealth ?? 1));
    const previousHealth = this.moverShootHealth.get(definition.entityIndex) ?? maxHealth;
    const remaining = previousHealth - Math.max(0, damage);
    if (remaining > 0) {
      this.moverShootHealth.set(definition.entityIndex, remaining);
      return true;
    }
    this.moverShootHealth.set(definition.entityIndex, maxHealth);
    this.activateMover(definition, playerId, eventId, 0, "shoot");
    return true;
  }

  private applyShootableTriggerDamage(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>,
    playerId: string,
    eventId: string,
    damage: number,
  ): boolean {
    if (!definition.shootActivates) return false;
    const timestamp = Date.now();
    const nextAllowedAt = this.triggerNextTouchAt.get(definition.entityIndex) ?? -Infinity;
    if (timestamp < nextAllowedAt) return true;
    const maxHealth = Math.max(1, Math.round(definition.shootHealth ?? 1));
    const previousHealth = this.triggerShootHealth.get(definition.entityIndex) ?? maxHealth;
    const remaining = previousHealth - Math.max(0, damage);
    if (remaining > 0) {
      this.triggerShootHealth.set(definition.entityIndex, remaining);
      return true;
    }
    if (!this.acceptTriggerTouch(definition, timestamp)) return true;
    this.triggerShootHealth.set(definition.entityIndex, maxHealth);
    if (definition.oneShot) this.removeWorldDefinition(definition.entityIndex);
    this.broadcastTargetTriggerEvent(definition, playerId, eventId, undefined, true, "shoot");
    this.scheduleTargetDispatch(definition, playerId, eventId);
    return true;
  }

  private scheduleMoverStateTransition(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    playerId: string,
    sourceEventId: string,
    activation: "touch" | "target" | "shoot",
    state: CssQuakeMoverState,
    delayMs: number,
  ): void {
    const entityIndex = definition.entityIndex;
    const key = `${entityIndex}:${state}`;
    const timer = setTimeout(() => {
      this.moverStateTimers.delete(key);
      if (!this.worldDefinitions.has(entityIndex)) return;
      this.moverStates.set(entityIndex, state);
      this.applyMoverCollisionOffset(definition, state);
      this.broadcastMoverEvent(definition, playerId, `${sourceEventId}-${state}`, activation, state);
    }, Math.max(0, delayMs));
    this.moverStateTimers.set(key, timer);
    timer.unref?.();
  }

  private clearMoverStateTimers(entityIndex: number): void {
    for (const [key, timer] of this.moverStateTimers) {
      if (!key.startsWith(`${entityIndex}:`)) continue;
      clearTimeout(timer);
      this.moverStateTimers.delete(key);
    }
  }

  private applyMoverCollisionOffset(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    state: CssQuakeMoverState,
  ): void {
    const timestamp = Date.now();
    if (state === "moving-up" || state === "moving-down") {
      this.moverCollisionMotions.set(definition.entityIndex, {
        durationMs: definition.moveMs,
        startedAt: timestamp,
        state,
      });
      this.writeMoverCollisionOffset(
        definition.entityIndex,
        quakeMultiplayerMoverOffsetAtTime(definition, state, timestamp, timestamp, definition.moveMs),
      );
      return;
    }
    this.moverCollisionMotions.delete(definition.entityIndex);
    this.writeMoverCollisionOffset(definition.entityIndex, quakeMultiplayerMoverOffsetForState(definition, state));
  }

  private syncMoverCollisionOffsets(timestamp: number): void {
    if (!this.trustedSceneMovement?.collisionWorld.setBrushOffset) return;
    for (const [entityIndex, motion] of this.moverCollisionMotions) {
      const definition = this.worldDefinitions.get(entityIndex);
      if (definition?.kind !== "mover") {
        this.moverCollisionMotions.delete(entityIndex);
        continue;
      }
      const offset = quakeMultiplayerMoverOffsetAtTime(
        definition,
        motion.state,
        motion.startedAt,
        timestamp,
        motion.durationMs,
      );
      this.writeMoverCollisionOffset(entityIndex, offset);
    }
  }

  private writeMoverCollisionOffset(entityIndex: number, offset: QuakeMultiplayerVec3): void {
    if (sameQuakeMultiplayerMoverOffset(this.moverCollisionOffsets.get(entityIndex), offset)) return;
    this.moverCollisionOffsets.set(entityIndex, [...offset] as QuakeMultiplayerVec3);
    this.trustedSceneMovement?.collisionWorld.setBrushOffset?.(entityIndex, offset);
  }

  private resetMoverCollisionOffset(entityIndex: number): void {
    this.moverCollisionMotions.delete(entityIndex);
    this.writeMoverCollisionOffset(entityIndex, [0, 0, 0]);
    this.moverCollisionOffsets.delete(entityIndex);
  }

  private resetMoverCollisionOffsets(): void {
    for (const definition of this.worldDefinitions.values()) {
      if (definition.kind === "mover") this.resetMoverCollisionOffset(definition.entityIndex);
    }
    this.moverCollisionMotions.clear();
    this.moverCollisionOffsets.clear();
  }

  private broadcastTargetTriggerEvent(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>,
    playerId: string,
    eventId: string,
    remaining: number | undefined,
    complete: boolean,
    activation: "target" | "shoot" = "target",
  ): void {
    const message = remaining !== undefined
      ? quakeMultiplayerTriggerCounterMessage(definition, remaining, complete)
      : definition.message;
    this.broadcastRoomEvent({
      eventType: "world.trigger",
      eventId,
      roomTime: this.roomTime(),
      playerId,
      entityIndex: definition.entityIndex,
      classname: definition.classname,
      activation,
      targetEntityIndexes: definition.targetEntityIndexes,
      ...(definition.killtargetEntityIndexes ? { killtargetEntityIndexes: definition.killtargetEntityIndexes } : {}),
      delayMs: definition.delayMs,
      waitMs: definition.waitMs,
      oneShot: definition.oneShot,
      ...(remaining !== undefined ? { remaining } : {}),
      complete,
      ...(message ? { message } : {}),
      ...(definition.soundPath ? { soundPath: definition.soundPath } : {}),
    });
  }

  private clearPickupOwnership(playerId: string, timestamp = Date.now()): void {
    for (const [entityIndex, state] of this.pickupStates) {
      const next = quakeMultiplayerPickupStateWithoutOwner(state, playerId, timestamp);
      if (next !== state) this.pickupStates.set(entityIndex, next);
    }
  }

  private trustedGameplayDefinitions(): QuakeMultiplayerGameplayDefinitions | null {
    if (!this.roomKey) return null;
    const source = this.options.trustedGameplayDefinitions;
    if (source) return typeof source === "function" ? source(this.roomKey) ?? null : source;
    return this.fetchedTrustedGameplayDefinitions;
  }

  private trustedWorldDefinitions(): readonly QuakeMultiplayerWorldDefinition[] | null {
    if (!this.roomKey) return null;
    const source = this.options.trustedWorldDefinitions;
    if (source) return typeof source === "function" ? source(this.roomKey) ?? null : source;
    return this.fetchedTrustedWorldDefinitions;
  }

  private ensureTrustedGameplayDefinitions(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.hello" }>,
    sender: Party.Connection,
    roomKey: QuakeMultiplayerRoomCompatibilityKey,
  ): boolean | Promise<boolean> {
    if (this.trustedGameplayDefinitions()) return true;
    const pending = this.loadTrustedGameplayDefinitions(roomKey);
    if (!pending) return true;
    return pending.then((definitions) => {
      if (definitions) {
        this.fetchedTrustedGameplayDefinitions = definitions;
        return true;
      }
      this.reject(sender, {
        code: "wrong-map",
        message: "Could not load trusted multiplayer gameplay facts for this room.",
        recoverable: false,
        rejectedMessageId: message.messageId,
      }, roomKey);
      return false;
    });
  }

  private loadTrustedGameplayDefinitions(
    roomKey: QuakeMultiplayerRoomCompatibilityKey,
  ): Promise<QuakeMultiplayerGameplayDefinitions | null> | null {
    if (this.trustedGameplayDefinitionsPromise) return this.trustedGameplayDefinitionsPromise;
    const customFetcher = this.options.trustedGameplayDefinitionsFetcher;
    if (customFetcher) {
      this.trustedGameplayDefinitionsPromise = Promise.resolve(customFetcher(roomKey))
        .then((definitions) => definitions ?? null)
        .catch(() => null);
      return this.trustedGameplayDefinitionsPromise;
    }
    const assetFetcher = this.room.context?.assets?.fetch;
    if (typeof assetFetcher !== "function") return null;
    const sceneAssetPath = trustedQuakeMultiplayerSceneAssetPath(roomKey.sceneUrl);
    if (!sceneAssetPath) return null;
    this.trustedGameplayDefinitionsPromise = assetFetcher.call(this.room.context.assets, sceneAssetPath)
      .then(async (response) => {
        if (!response?.ok) return null;
        const scene = await response.json() as unknown;
        if (!isQuakeMultiplayerSceneGameplaySource(scene)) return null;
        this.trustedSceneMovement = trustedQuakeMultiplayerSceneMovement(scene);
        this.fetchedTrustedWorldDefinitions = quakeMultiplayerWorldDefinitionsFromScene(scene, {});
        return quakeMultiplayerGameplayDefinitionsFromScene(scene, {});
      })
      .catch(() => null);
    return this.trustedGameplayDefinitionsPromise;
  }

  private removeConnection(connection: Party.Connection, reason: string): void {
    const state = this.connectionState(connection);
    this.connectionPlayers.delete(connection.id);
    this.clearConnectionRejects(connection);
    connection.setState(null);
    if (!state?.playerId) return;
    if (this.playerHasActiveConnection(state.playerId)) return;
    this.pausePlayerSimulation(state.playerId);
    this.reportPresence();
    this.broadcastRoomEvent({
      eventType: "player.presence",
      eventId: `disconnecting-${connection.id}-${Date.now()}`,
      roomTime: this.roomTime(),
      playerId: state.playerId,
      status: "disconnecting",
    });
    this.scheduleDisconnectedPlayerRemoval(state.playerId, reason);
    this.broadcastSnapshot();
  }

  private cancelDisconnectedPlayerRemoval(playerId: string): void {
    const timer = this.disconnectRemovalTimers.get(playerId);
    if (!timer) return;
    clearTimeout(timer);
    this.disconnectRemovalTimers.delete(playerId);
  }

  private closeDuplicatePlayerConnections(sender: Party.Connection, playerId: string): void {
    for (const connection of this.room.getConnections<CssQuakeConnectionState>()) {
      if (connection.id === sender.id) continue;
      const state = this.connectionState(connection);
      if (state?.playerId !== playerId) continue;
      this.connectionPlayers.delete(connection.id);
      connection.setState(null);
      connection.close(4001, "duplicate-player-connection");
    }
  }

  private playerHasActiveConnection(playerId: string): boolean {
    for (const state of this.connectionPlayers.values()) {
      if (state.playerId === playerId) return true;
    }
    return false;
  }

  private playerAcceptsInput(playerId: string): boolean {
    for (const state of this.connectionPlayers.values()) {
      if (state.playerId === playerId && quakeMultiplayerPresenceAcceptsInput(state.presenceStatus)) return true;
    }
    return false;
  }

  private scheduleDisconnectedPlayerRemoval(playerId: string, reason: string): void {
    this.cancelDisconnectedPlayerRemoval(playerId);
    const timer = setTimeout(() => {
      this.finalizeDisconnectedPlayer(playerId, reason);
    }, CSSQUAKE_PARTY_RECONNECT_GRACE_MS);
    this.disconnectRemovalTimers.set(playerId, timer);
    unrefTimer(timer);
  }

  private finalizeDisconnectedPlayer(playerId: string, reason: string): void {
    this.cancelDisconnectedPlayerRemoval(playerId);
    if (this.playerHasActiveConnection(playerId)) return;
    const respawnTimer = this.respawnTimers.get(playerId);
    if (respawnTimer) clearTimeout(respawnTimer);
    this.respawnTimers.delete(playerId);
    this.lastFireAtByPlayer.delete(playerId);
    this.clearPickupOwnership(playerId);
    this.playerSimulationStates.delete(playerId);
    const existed = this.players.delete(playerId);
    if (!existed) return;
    this.reportPresence();
    this.broadcastRoomEvent({
      eventType: "player.left",
      eventId: `left-${playerId}-${Date.now()}`,
      roomTime: this.roomTime(),
      playerId,
      reason,
    });
    this.broadcastSnapshot();
    if (!this.players.size) {
      this.stopSimulationTicker();
      this.stopSnapshotTicker();
      this.stopHeartbeatTicker();
      this.resetIdleRoomState();
    }
  }

  private resetIdleRoomState(): void {
    this.roomKey = null;
    this.players.clear();
    this.playerSimulationStates.clear();
    this.connectionPlayers.clear();
    this.connectionRejectCounts.clear();
    this.spawnPoints = [];
    this.pickupDefinitions.clear();
    this.pickupStates.clear();
    this.resetMoverCollisionOffsets();
    this.worldDefinitions.clear();
    this.gameplayFacts = null;
    this.spawnCursor = 0;
    this.lastFireAtByPlayer.clear();
    this.hurtNextTouchAtByEntity.clear();
    this.teleportActiveUntilByEntity.clear();
    this.triggerNextTouchAt.clear();
    this.triggerCounterRemaining.clear();
    this.triggerShootHealth.clear();
    this.moverStates.clear();
    this.moverShootHealth.clear();
    this.clearTimeoutMap(this.respawnTimers);
    this.clearTimeoutMap(this.pickupRespawnTimers);
    this.clearTimeoutMap(this.pickupRemovalTimers);
    this.clearTimeoutMap(this.targetDispatchTimers);
    this.clearTimeoutMap(this.moverStateTimers);
    this.clearTimeoutMap(this.disconnectRemovalTimers);
    this.clearMatchRestartTimer();
    this.matchSettings = {};
    this.matchStatus = "active";
    this.fetchedTrustedGameplayDefinitions = null;
    this.fetchedTrustedWorldDefinitions = null;
    this.trustedGameplayDefinitionsPromise = null;
    this.trustedSceneMovement = this.options.trustedSceneMovement ?? null;
    this.snapshotHistory = [];
    this.dynamicPickupSequence = 1_000_000;
    this.roomSequence = 0;
    this.tick = 0;
    this.worldEventSequence = 0;
    this.lastScheduledSnapshotAt = -Infinity;
    this.startedAt = Date.now();
  }

  private clearTimeoutMap<TKey>(timers: Map<TKey, ReturnType<typeof setTimeout>>): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  private connectionState(connection: Party.Connection): CssQuakeConnectionState | null {
    return this.connectionPlayers.get(connection.id) ?? (connection.state as CssQuakeConnectionState | null);
  }

  private seedPendingHelloAuthority(
    connection: Party.Connection,
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.hello" }>,
    authority: QuakeMultiplayerClientAuthorityState,
    lastSeenAt: number,
  ): void {
    const state = this.connectionState(connection);
    if (state) {
      this.updateConnectionAuthority(connection, authority, lastSeenAt);
      return;
    }
    const next = {
      authority,
      clientId: message.payload.clientId,
      displayName: message.payload.displayName,
      lastSeenAt,
      presenceStatus: "active" as const,
      role: "player" as const,
    };
    this.connectionPlayers.set(connection.id, next);
    connection.setState(next);
  }

  private updateConnectionAuthority(
    connection: Party.Connection,
    authority: QuakeMultiplayerClientAuthorityState,
    lastSeenAt = Date.now(),
  ): void {
    const state = this.connectionState(connection);
    if (!state) return;
    const next = { ...state, authority, lastSeenAt };
    this.connectionPlayers.set(connection.id, next);
    connection.setState(next);
  }

  private latestConnectionAuthority(
    connection: Party.Connection,
    clientId: string,
    fallback: QuakeMultiplayerClientAuthorityState,
  ): QuakeMultiplayerClientAuthorityState {
    const current = this.connectionState(connection)?.authority;
    if (
      current?.clientId === clientId &&
      (current.lastEnvelopeSequence ?? -1) >= (fallback.lastEnvelopeSequence ?? -1)
    ) {
      return current;
    }
    return fallback;
  }

  private handleClientPong(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.pong" }>,
    sender: Party.Connection,
    receivedAt: number,
  ): void {
    const state = this.connectionState(sender);
    if (!state || message.payload.pingId !== state.lastRoomPingId) return;
    const pingMs = quakeMultiplayerPingMsFromPong(receivedAt, message.payload.echoedSentAt);
    const next = { ...state, pingMs };
    this.connectionPlayers.set(sender.id, next);
    sender.setState(next);
    if (!state.playerId) {
      this.requestSnapshot();
      return;
    }
    const player = this.players.get(state.playerId);
    if (!player) return;
    this.players.set(state.playerId, {
      ...player,
      pingMs,
      updatedAt: receivedAt,
    });
    this.requestSnapshot();
  }

  private reject(
    sender: Party.Connection,
    payload: QuakeMultiplayerRoomRejectPayload,
    roomKey = this.roomKey,
  ): void {
    if (!roomKey) {
      this.closeMalformed(sender, payload.message);
      return;
    }
    this.send(sender, "room.reject", payload, roomKey);
    if (!payload.recoverable || this.noteConnectionReject(sender) >= CSSQUAKE_PARTY_MAX_REJECTS_PER_CONNECTION) {
      this.closeRejectedConnection(sender, payload);
    }
  }

  private noteConnectionReject(connection: Party.Connection): number {
    const count = (this.connectionRejectCounts.get(connection.id) ?? 0) + 1;
    this.connectionRejectCounts.set(connection.id, count);
    return count;
  }

  private clearConnectionRejects(connection: Party.Connection): void {
    this.connectionRejectCounts.delete(connection.id);
  }

  private closeRejectedConnection(connection: Party.Connection, payload: QuakeMultiplayerRoomRejectPayload): void {
    const reason = payload.recoverable ? "too-many-rejects" : `reject:${payload.code}`;
    connection.close(CSSQUAKE_PARTY_REJECT_CLOSE_CODE, reason.slice(0, 120));
    this.removeConnection(connection, reason);
  }

  private broadcastSnapshot(without?: string[]): void {
    if (!this.roomKey) return;
    this.enterIntermissionIfTimeLimitReached("snapshot");
    this.pruneExpiredPlayerPowerups();
    const sampledAt = Date.now();
    this.lastScheduledSnapshotAt = sampledAt;
    this.tick += 1;
    const roomTime = this.roomTime();
    const players = [...this.players.values()];
    this.snapshotHistory = recordQuakeMultiplayerSnapshotHistory(this.snapshotHistory, {
      sampledAt,
      roomTime,
      tick: this.tick,
      players,
    });
    this.broadcast("room.snapshot", {
      roomId: this.room.id,
      tick: this.tick,
      roomTime,
      match: {
        status: this.matchStatus,
        clockMs: roomTime,
        ...this.matchSettings,
      },
      players,
      spectators: this.spectatorStates(),
      dynamicPickups: this.dynamicPickupDefinitions(),
      pickups: [...this.pickupStates.values()],
      projectiles: [...this.serverProjectiles.values()].map(quakeMultiplayerProjectileStateFromServer),
      lastWorldEventSequence: this.worldEventSequence,
    }, without);
  }

  private recordSnapshotHistory(sampledAt: number): void {
    if (!this.roomKey || !this.players.size) return;
    this.snapshotHistory = recordQuakeMultiplayerSnapshotHistory(this.snapshotHistory, {
      sampledAt,
      roomTime: this.roomTime(),
      tick: this.tick,
      players: this.players.values(),
    });
  }

  private combatPlayersForFire(
    attackerPlayerId: string,
    targetTime: number,
  ): QuakeMultiplayerAuthoritativePlayerState[] {
    return quakeMultiplayerHistoricalCombatPlayers(
      this.snapshotHistory,
      this.players.values(),
      {
        attackerPlayerId,
        targetTime,
      },
    );
  }

  private spectatorStates(): QuakeMultiplayerRoomSpectatorState[] {
    const spectators: QuakeMultiplayerRoomSpectatorState[] = [];
    for (const state of this.connectionPlayers.values()) {
      if (state.role !== "spectator") continue;
      spectators.push({
        clientId: state.clientId,
        displayName: state.displayName,
        ...(state.pingMs !== undefined ? { pingMs: state.pingMs } : {}),
      });
    }
    return spectators;
  }

  private spectatorCount(): number {
    let count = 0;
    for (const state of this.connectionPlayers.values()) {
      if (state.role === "spectator") count += 1;
    }
    return count;
  }

  private activePlayerCount(): number {
    const playerIds = new Set<string>();
    for (const state of this.connectionPlayers.values()) {
      if (state.role === "player" && state.playerId) playerIds.add(state.playerId);
    }
    return playerIds.size;
  }

  private reportPresence(): void {
    const presenceParty = this.room.context?.parties?.presence;
    if (!presenceParty) return;
    const update = createCssQuakePresenceUpdatePayload({
      roomId: this.room.id,
      mapName: this.roomKey?.mapName ?? null,
      gameplayFactsHash: this.gameplayFacts?.factsHash ?? null,
      activePlayers: this.activePlayerCount(),
      roomPlayers: this.players.size,
      spectators: this.spectatorCount(),
      connections: this.connectionPlayers.size,
    });
    try {
      void presenceParty.get(CSSQUAKE_PRESENCE_ROOM_ID).fetch({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      }).catch(() => {});
    } catch {
      // Presence is best-effort; room simulation must not depend on the global counter.
    }
  }

  private requestSnapshot(): void {
    this.startSnapshotTicker();
  }

  private startSimulationTicker(): void {
    if (this.simulationTimer || !this.players.size) return;
    this.simulationTimer = setInterval(() => {
      if (this.advanceRoomSimulation(Date.now())) {
        this.requestSnapshot();
      }
    }, QUAKE_MULTIPLAYER_ROOM_SIMULATION_TICK_MS);
    unrefTimer(this.simulationTimer);
  }

  private stopSimulationTicker(): void {
    if (!this.simulationTimer) return;
    clearInterval(this.simulationTimer);
    this.simulationTimer = null;
  }

  private startSnapshotTicker(): void {
    if (this.snapshotTimer || !this.players.size) return;
    this.snapshotTimer = setInterval(() => {
      const timestamp = Date.now();
      this.advanceRoomSimulation(timestamp);
      if (
        shouldEmitQuakeMultiplayerRoomSnapshot(timestamp, { lastSnapshotAt: this.lastScheduledSnapshotAt }, {
          connected: Boolean(this.roomKey),
          playerCount: this.players.size,
          intervalMs: QUAKE_MULTIPLAYER_ROOM_SNAPSHOT_INTERVAL_MS,
        })
      ) {
        this.broadcastSnapshot();
      }
    }, QUAKE_MULTIPLAYER_ROOM_SNAPSHOT_INTERVAL_MS);
    unrefTimer(this.snapshotTimer);
  }

  private stopSnapshotTicker(): void {
    if (!this.snapshotTimer) return;
    clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
  }

  private startHeartbeatTicker(): void {
    if (this.heartbeatTimer || !this.players.size) return;
    this.heartbeatTimer = setInterval(() => {
      const timestamp = Date.now();
      for (const connection of this.room.getConnections<CssQuakeConnectionState>()) {
        const state = this.connectionState(connection);
        if (!state) continue;
        if (isQuakeMultiplayerClientStale(timestamp, state.lastSeenAt, QUAKE_MULTIPLAYER_STALE_CLIENT_MS)) {
          connection.close(4000, "stale");
          this.removeConnection(connection, "stale");
          continue;
        }
        if (!shouldSendQuakeMultiplayerRoomPing(
          timestamp,
          state.lastRoomPingAt,
          QUAKE_MULTIPLAYER_ROOM_HEARTBEAT_INTERVAL_MS,
        )) {
          continue;
        }
        const pingId = `party-ping-${state.clientId}-${timestamp}`;
        const next = {
          ...state,
          lastRoomPingAt: timestamp,
          lastRoomPingId: pingId,
        };
        this.connectionPlayers.set(connection.id, next);
        connection.setState(next);
        this.send(connection, "room.ping", {
          pingId,
          sentAt: timestamp,
        });
      }
    }, QUAKE_MULTIPLAYER_ROOM_HEARTBEAT_INTERVAL_MS);
    unrefTimer(this.heartbeatTimer);
  }

  private stopHeartbeatTicker(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private pruneExpiredPlayerPowerups(): void {
    const now = Date.now();
    for (const [playerId, player] of this.players) {
      const inventory = quakeMultiplayerPlayerInventory(player);
      const pruned = quakeMultiplayerPruneExpiredPowerups(inventory, now);
      if (pruned.powerups.length === inventory.powerups.length) continue;
      this.players.set(playerId, {
        ...quakeMultiplayerPlayerWithInventory(player, pruned),
        updatedAt: now,
      });
    }
  }

  private broadcastRoomEvent(event: QuakeMultiplayerRoomEventPayload["event"], without?: string[]): void {
    if (!this.roomKey) return;
    this.tick += 1;
    this.worldEventSequence += 1;
    this.broadcast("room.event", {
      roomId: this.room.id,
      tick: this.tick,
      sequence: this.worldEventSequence,
      event,
    }, without);
  }

  private enterIntermissionIfFragLimitReached(
    player: QuakeMultiplayerAuthoritativePlayerState,
    eventIdSeed: string,
  ): boolean {
    const fragLimit = this.matchSettings.fragLimit;
    if (
      this.matchStatus !== "active" ||
      fragLimit === undefined ||
      fragLimit <= 0 ||
      player.frags < fragLimit
    ) {
      return false;
    }
    this.matchStatus = "intermission";
    this.clearTimeoutMap(this.respawnTimers);
    this.broadcastRoomEvent({
      eventType: "match.notice",
      eventId: `match-frag-limit-${eventIdSeed}`,
      roomTime: this.roomTime(),
      code: "frag-limit",
      message: `${player.displayName} reached the frag limit.`,
    });
    this.scheduleMatchRestart(eventIdSeed);
    return true;
  }

  private enterIntermissionIfTimeLimitReached(eventIdSeed: string): boolean {
    const timeLimitMs = this.matchSettings.timeLimitMs;
    if (
      this.matchStatus !== "active" ||
      timeLimitMs === undefined ||
      timeLimitMs <= 0 ||
      this.roomTime() < timeLimitMs
    ) {
      return false;
    }
    this.matchStatus = "intermission";
    this.clearTimeoutMap(this.respawnTimers);
    this.broadcastRoomEvent({
      eventType: "match.notice",
      eventId: `match-time-limit-${eventIdSeed}`,
      roomTime: this.roomTime(),
      code: "time-limit",
      message: "Time limit reached.",
    });
    this.scheduleMatchRestart(eventIdSeed);
    return true;
  }

  private scheduleMatchRestart(eventIdSeed: string): void {
    this.clearMatchRestartTimer();
    const restartDelayMs = this.matchSettings.restartDelayMs;
    if (restartDelayMs === undefined || restartDelayMs <= 0) return;
    this.matchRestartTimer = setTimeout(() => {
      this.matchRestartTimer = null;
      this.restartMatch(eventIdSeed);
    }, restartDelayMs);
    unrefTimer(this.matchRestartTimer);
  }

  private clearMatchRestartTimer(): void {
    if (!this.matchRestartTimer) return;
    clearTimeout(this.matchRestartTimer);
    this.matchRestartTimer = null;
  }

  private restartMatch(eventIdSeed: string): void {
    if (!this.roomKey || this.matchStatus !== "intermission") return;
    const timestamp = Date.now();
    this.clearMatchRestartTimer();
    this.matchStatus = "active";
    this.startedAt = timestamp;
    this.clearTimeoutMap(this.respawnTimers);
    this.clearTimeoutMap(this.pickupRespawnTimers);
    this.clearTimeoutMap(this.pickupRemovalTimers);
    this.clearTimeoutMap(this.targetDispatchTimers);
    this.clearTimeoutMap(this.moverStateTimers);
    this.lastFireAtByPlayer.clear();
    this.hurtNextTouchAtByEntity.clear();
    this.teleportActiveUntilByEntity.clear();
    this.triggerNextTouchAt.clear();
    this.triggerCounterRemaining.clear();
    this.triggerShootHealth.clear();
    this.resetMoverCollisionOffsets();
    this.moverStates.clear();
    this.moverShootHealth.clear();
    this.clearRuntimePickupDefinitions();
    this.pickupStates.clear();
    for (const definition of this.pickupDefinitions.values()) {
      this.pickupStates.set(definition.entityIndex, {
        pickupId: definition.pickupId,
        entityIndex: definition.entityIndex,
        available: true,
        updatedAt: timestamp,
      });
    }
    this.spawnCursor = 0;
    this.playerSimulationStates.clear();
    for (const [playerId, player] of this.players) {
      const inventory = createQuakeMultiplayerInitialInventory();
      const spawn = this.nextSpawnPoint();
      const restarted: QuakeMultiplayerAuthoritativePlayerState = {
        ...quakeMultiplayerPlayerWithInventory(player, inventory),
        ...(spawn ? { spawnId: spawn.spawnId, origin: spawn.origin, rotX: spawn.rotX, rotY: spawn.rotY } : {}),
        velocity: [0, 0, 0],
        alive: true,
        frags: 0,
        deaths: 0,
        respawnAt: undefined,
        lastInputSequence: 0,
        updatedAt: timestamp,
      };
      this.players.set(playerId, restarted);
      this.playerSimulationStates.set(playerId, createQuakeMultiplayerRoomPlayerSimulationState({
        playerId,
        now: timestamp,
      }));
    }
    this.broadcastRoomEvent({
      eventType: "match.notice",
      eventId: `match-restart-${eventIdSeed}-${timestamp}`,
      roomTime: this.roomTime(),
      code: "restart",
      message: "Match restarted.",
    });
    this.broadcastSnapshot();
    this.startSimulationTicker();
    this.startSnapshotTicker();
  }

  private acceptActiveMatchIntent(sender: Party.Connection, rejectedMessageId: string): boolean {
    const endedByTimeLimit = this.enterIntermissionIfTimeLimitReached(rejectedMessageId);
    if (endedByTimeLimit) this.broadcastSnapshot();
    if (this.matchStatus === "active") return true;
    this.rejectInactiveMatchIntent(sender, rejectedMessageId);
    return false;
  }

  private acceptActivePresenceIntent(
    sender: Party.Connection,
    rejectedMessageId: string,
    state = this.connectionState(sender),
  ): boolean {
    if (!state?.playerId) return false;
    if (quakeMultiplayerPresenceAcceptsInput(state.presenceStatus)) return true;
    this.pausePlayerSimulation(state.playerId);
    this.reject(sender, {
      code: "unsupported",
      message: "Multiplayer player input is paused.",
      recoverable: true,
      rejectedMessageId,
    });
    return false;
  }

  private rejectInactiveMatchIntent(sender: Party.Connection, rejectedMessageId: string): void {
    this.reject(sender, {
      code: "unsupported",
      message: "Multiplayer match is not active.",
      recoverable: true,
      rejectedMessageId,
    });
  }

  private send<TType extends QuakeMultiplayerRoomEnvelope["type"]>(
    connection: Party.Connection,
    type: TType,
    payload: Extract<QuakeMultiplayerRoomEnvelope, { type: TType }>["payload"],
    roomKey = this.roomKey,
  ): void {
    if (!roomKey) return;
    connection.send(JSON.stringify(this.roomEnvelope(type, payload, roomKey)));
  }

  private broadcast<TType extends QuakeMultiplayerRoomEnvelope["type"]>(
    type: TType,
    payload: Extract<QuakeMultiplayerRoomEnvelope, { type: TType }>["payload"],
    without?: string[],
  ): void {
    if (!this.roomKey) return;
    this.room.broadcast(JSON.stringify(this.roomEnvelope(type, payload, this.roomKey)), without);
  }

  private roomEnvelope<TType extends QuakeMultiplayerRoomEnvelope["type"]>(
    type: TType,
    payload: Extract<QuakeMultiplayerRoomEnvelope, { type: TType }>["payload"],
    roomKey: QuakeMultiplayerRoomCompatibilityKey,
  ): QuakeMultiplayerRoomEnvelope {
    return createQuakeMultiplayerEnvelope({
      direction: "room",
      type,
      roomKey,
      sequence: ++this.roomSequence,
      sentAt: Date.now(),
      payload,
    }) as QuakeMultiplayerRoomEnvelope;
  }

  private roomTime(now = Date.now()): number {
    return Math.max(0, now - this.startedAt);
  }

  private playerIdForClient(clientId: string): string {
    return `party:${clientId}`;
  }

  private nextSpawnPoint(): QuakeMultiplayerSpawnPoint | null {
    if (!this.spawnPoints.length) return null;
    const selection = quakeMultiplayerDeathmatchSelectSpawnPoint(
      this.spawnPoints,
      this.players.values(),
      this.options.random ? { random: this.options.random } : {},
    );
    if (!selection) return null;
    this.spawnCursor = selection.nextCursor;
    return selection.spawn;
  }

  private closeMalformed(connection: Party.Connection, reason: string): void {
    connection.close(1003, reason.slice(0, 120));
  }
}

function parseQuakePartyMessage(message: string): unknown {
  try {
    return JSON.parse(message) as unknown;
  } catch {
    return null;
  }
}

function trustedQuakeMultiplayerSceneAssetPath(sceneUrl: string): string | null {
  try {
    const url = new URL(sceneUrl, "https://cssquake.local");
    const decodedPath = decodeURIComponent(url.pathname);
    if (!decodedPath.startsWith("/q/") || !decodedPath.endsWith(".json")) return null;
    if (decodedPath.includes("..") || decodedPath.includes("\\")) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function isQuakeMultiplayerSceneGameplaySource(value: unknown): value is QuakeMultiplayerSceneGameplaySource {
  if (!isRecord(value)) return false;
  const entityManifest = value.entityManifest;
  const runtime = isRecord(entityManifest) ? entityManifest.runtime : null;
  const spawn = value.spawn;
  return (
    Array.isArray(value.entities) &&
    value.entities.every(isQuakeEntityLike) &&
    isRecord(runtime) &&
    Array.isArray(runtime.pickupEntityIndexes) &&
    runtime.pickupEntityIndexes.every(isFiniteNumber) &&
    (value.gameLogic === undefined || isRecord(value.gameLogic)) &&
    (value.collision === undefined || isSceneCollisionLike(value.collision)) &&
    isRecord(spawn) &&
    isQuakeMultiplayerVec3Like(spawn.origin) &&
    (spawn.eyeHeight === undefined || isFiniteNumber(spawn.eyeHeight)) &&
    isFiniteNumber(spawn.rotX) &&
    isFiniteNumber(spawn.rotY)
  );
}

function trustedQuakeMultiplayerSceneMovement(
  scene: QuakeMultiplayerSceneGameplaySource,
): { collisionWorld: QuakeCollisionWorld; playerEyeHeight: number } | null {
  if (!isQuakePreparedCollisionLike(scene.collision)) return null;
  try {
    const collisionWorld = buildQuakeClipCollisionWorld(scene.collision);
    if (!collisionWorld) return null;
    return {
      collisionWorld,
      playerEyeHeight: scene.spawn.eyeHeight ?? 0.92,
    };
  } catch {
    return null;
  }
}

function isQuakePreparedCollisionLike(value: unknown): value is QuakePreparedCollision {
  if (!isRecord(value)) return false;
  const runtime = value.runtime;
  if (!isRecord(runtime)) return false;
  return (
    Array.isArray(value.clipNodes) &&
    Array.isArray(runtime.brushes) &&
    Array.isArray(runtime.planes) &&
    Array.isArray(runtime.solidBrushIndexes) &&
    Array.isArray(runtime.triggerBrushIndexes) &&
    isRecord(runtime.groundGrid)
  );
}

function isQuakeEntityLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.index) &&
    typeof value.classname === "string" &&
    isRecord(value.properties) &&
    (value.origin === undefined || isQuakeVertexLike(value.origin)) &&
    (value.angle === undefined || isFiniteNumber(value.angle))
  );
}

function isSceneCollisionLike(value: unknown): boolean {
  return isRecord(value) && (value.pivot === undefined || isQuakeVertexLike(value.pivot));
}

function isQuakeVertexLike(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

function isQuakeMultiplayerVec3Like(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(isFiniteNumber)
  );
}

function quakeMultiplayerPlayerWithoutPowerup(
  player: QuakeMultiplayerAuthoritativePlayerState,
  finishedField: string,
): QuakeMultiplayerAuthoritativePlayerState {
  return quakeMultiplayerPlayerWithInventory(
    player,
    quakeMultiplayerInventoryWithoutPowerup(
      quakeMultiplayerPlayerInventory(player),
      finishedField,
    ),
  );
}

function quakeMultiplayerProjectileStateFromServer(
  projectile: QuakeMultiplayerServerProjectile,
): QuakeMultiplayerProjectileState {
  return {
    projectileId: projectile.projectileId,
    ownerPlayerId: projectile.ownerPlayerId,
    weapon: projectile.weapon,
    origin: projectile.origin,
    direction: projectile.direction,
    speed: projectile.speed,
    spawnedAt: projectile.spawnedAt,
    updatedAt: projectile.updatedAt,
    expiresAt: projectile.expiresAt,
  };
}

function firstHelloRoomKey(value: unknown): QuakeMultiplayerRoomCompatibilityKey | null {
  if (!isRecord(value) || value.type !== "client.hello" || !isRecord(value.roomKey)) return null;
  const roomKey = value.roomKey;
  if (
    typeof roomKey.mapName !== "string" ||
    typeof roomKey.assetRoot !== "string" ||
    typeof roomKey.sceneUrl !== "string" ||
    !Number.isFinite(roomKey.assetManifestVersion)
  ) {
    return null;
  }
  return createQuakeMultiplayerRoomCompatibilityKey({
    mapName: roomKey.mapName,
    assetManifestVersion: roomKey.assetManifestVersion,
    assetRoot: roomKey.assetRoot,
    sceneUrl: roomKey.sceneUrl,
    ...(Number.isFinite(roomKey.preparedSceneVersion) ? { preparedSceneVersion: roomKey.preparedSceneVersion } : {}),
    ...(Number.isFinite(roomKey.gameLogicVersion) ? { gameLogicVersion: roomKey.gameLogicVersion } : {}),
  });
}

function isQuakeEnvelopeLike(value: unknown): value is QuakeMultiplayerAnyEnvelope {
  return isRecord(value) && typeof value.messageId === "string";
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return isRecord(value) && typeof value.then === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function quakeMultiplayerPresenceAcceptsInput(status: QuakeMultiplayerPlayerPresenceStatus): boolean {
  return status === "active";
}

function cssQuakeMoverStateOrigins(
  definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
  state: CssQuakeMoverState,
): [typeof definition.fromOrigin, typeof definition.toOrigin] {
  if (state === "top") return [definition.toOrigin, definition.toOrigin];
  if (state === "moving-down") return [definition.toOrigin, definition.fromOrigin];
  if (state === "bottom") return [definition.fromOrigin, definition.fromOrigin];
  return [definition.fromOrigin, definition.toOrigin];
}

function unrefTimer(timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}

CssQuakeMultiplayerRoom satisfies Party.Worker;
