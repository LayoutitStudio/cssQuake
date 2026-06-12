import {
  createQuakeMultiplayerEnvelope,
  createQuakeMultiplayerRoomCompatibilityKey,
} from "./protocol";
import type { QuakeCollisionWorld } from "../collision";
import type {
  QuakeMultiplayerAuthoritativePickupState,
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerClientEnvelope,
  QuakeMultiplayerGameplayDefinitions,
  QuakeMultiplayerMapGameplayFacts,
  QuakeMultiplayerMatchSettings,
  QuakeMultiplayerPickupDefinition,
  QuakeMultiplayerPlayerPresenceStatus,
  QuakeMultiplayerRoomCompatibilityKey,
  QuakeMultiplayerRoomEnvelope,
  QuakeMultiplayerRoomEventPayload,
  QuakeMultiplayerRoomMatchState,
  QuakeMultiplayerRoomMessageType,
  QuakeMultiplayerRoomRejectPayload,
  QuakeMultiplayerPoseSample,
  QuakeMultiplayerSpawnPoint,
  QuakeMultiplayerVec3,
  QuakeMultiplayerWorldDefinition,
} from "./protocol";
import {
  QUAKE_MULTIPLAYER_DEATHMATCH_RESPAWN_DELAY_MS,
  quakeMultiplayerDeathmatchFireFromPlayer,
  quakeMultiplayerDeathmatchFragDeltaForKill,
  quakeMultiplayerDeathmatchHitscanHit,
  quakeMultiplayerDeathmatchLightningDischarge,
  quakeMultiplayerDeathmatchSpawnOrder,
  quakeMultiplayerDeathmatchPlayerWithDamageMomentum,
  quakeMultiplayerDeathmatchSplashHits,
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
  quakeMultiplayerInventoryCanAcceptPickupEffect,
  quakeMultiplayerPlayerCanReachPickup,
  quakeMultiplayerPlayerInventory,
  quakeMultiplayerPlayerPowerupActive,
  quakeMultiplayerPlayerWithInventory,
  quakeMultiplayerPickupStateRespawned,
  quakeMultiplayerPickupStateWithoutOwner,
  quakeMultiplayerPruneExpiredPowerups,
} from "./items";
import {
  QUAKE_MULTIPLAYER_ROOM_HEARTBEAT_INTERVAL_MS,
  QUAKE_MULTIPLAYER_STALE_CLIENT_MS,
  isQuakeMultiplayerClientStale,
  quakeMultiplayerPingMsFromPong,
  shouldSendQuakeMultiplayerRoomPing,
} from "./heartbeat";
import type {
  QuakeMultiplayerRoomMessageListener,
  QuakeMultiplayerSessionAdapter,
  QuakeMultiplayerSessionConnectOptions,
  QuakeMultiplayerSessionStatus,
} from "./session";
import { validateQuakeMultiplayerClientEnvelope } from "./validation";
import {
  validateQuakeMultiplayerClientAuthority,
  type QuakeMultiplayerClientAuthorityState,
} from "./authority";
import {
  QUAKE_MULTIPLAYER_ROOM_SNAPSHOT_INTERVAL_MS,
  shouldEmitQuakeMultiplayerRoomSnapshot,
} from "./cadence";
import {
  checkQuakeMultiplayerGameplayFactsClaim,
  sameQuakeMultiplayerGameplayFacts,
} from "./facts";
import {
  QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE,
  QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS,
  QUAKE_MULTIPLAYER_TRIGGER_HURT_COOLDOWN_MS,
  quakeMultiplayerPlayerIntersectsTelefragVolume,
  quakeMultiplayerShootableWorldHit,
  quakeMultiplayerTriggerCounterMessage,
  quakeMultiplayerTriggerUsesMultiTrigger,
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
  type QuakeMultiplayerRoomPlayerSimulationState,
} from "./simulation";

export interface QuakeLoopbackMultiplayerSessionOptions {
  roomId?: string;
  now?: () => number;
  asyncDispatch?: boolean;
  maxMessageAgeMs?: number;
  maxFutureSkewMs?: number;
  snapshotIntervalMs?: number | false;
  simulationTickMs?: number | false;
  heartbeatIntervalMs?: number | false;
  staleClientMs?: number;
  trustedGameplayDefinitions?:
    | QuakeMultiplayerGameplayDefinitions
    | ((roomKey: QuakeMultiplayerRoomCompatibilityKey) => QuakeMultiplayerGameplayDefinitions | null | undefined);
  trustedWorldDefinitions?:
    | readonly QuakeMultiplayerWorldDefinition[]
    | ((roomKey: QuakeMultiplayerRoomCompatibilityKey) => readonly QuakeMultiplayerWorldDefinition[] | null | undefined);
  trustedSceneMovement?: {
    collisionWorld: Pick<QuakeCollisionWorld, "contentsAt" | "floorAt" | "resolve" | "traceUse">;
    playerEyeHeight: number;
  };
  includeDefaultSimulatedPlayer?: boolean;
  simulatedPlayers?: () => readonly QuakeMultiplayerAuthoritativePlayerState[];
}

interface QuakeMultiplayerLoopbackTargetDispatchSource {
  entityIndex: number;
  targetEntityIndexes: readonly number[];
  killtargetEntityIndexes?: readonly number[];
  delayMs: number;
  message?: string;
  soundPath?: string;
}

type QuakeMultiplayerLoopbackMoverState = "bottom" | "moving-up" | "top" | "moving-down";

export function createQuakeLoopbackMultiplayerSession(
  options: QuakeLoopbackMultiplayerSessionOptions = {},
): QuakeMultiplayerSessionAdapter {
  const roomId = options.roomId ?? "loopback";
  const now = options.now ?? (() => Date.now());
  const snapshotIntervalMs = options.snapshotIntervalMs ?? QUAKE_MULTIPLAYER_ROOM_SNAPSHOT_INTERVAL_MS;
  const simulationTickMs = options.simulationTickMs ?? QUAKE_MULTIPLAYER_ROOM_SIMULATION_TICK_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? QUAKE_MULTIPLAYER_ROOM_HEARTBEAT_INTERVAL_MS;
  const listeners = new Set<QuakeMultiplayerRoomMessageListener>();
  let roomKey: QuakeMultiplayerRoomCompatibilityKey | null = null;
  let clientId = "";
  let displayName = "";
  let playerColor: string | undefined;
  let roomSequence = 0;
  let worldEventSequence = 0;
  let tick = 0;
  let matchSettings: QuakeMultiplayerMatchSettings = {};
  let matchStatus: QuakeMultiplayerRoomMatchState["status"] = "active";
  let presenceStatus: QuakeMultiplayerPlayerPresenceStatus = "active";
  let gameplayFacts: QuakeMultiplayerMapGameplayFacts | null = null;
  let playerState: QuakeMultiplayerAuthoritativePlayerState | null = null;
  let playerSimulationState: QuakeMultiplayerRoomPlayerSimulationState | null = null;
  let pickupDefinitions = new Map<number, QuakeMultiplayerPickupDefinition>();
  let pickupStates = new Map<number, QuakeMultiplayerAuthoritativePickupState>();
  let worldDefinitions = new Map<number, QuakeMultiplayerWorldDefinition>();
  let lastFireAt = -Infinity;
  let clientAuthorityState: QuakeMultiplayerClientAuthorityState | null = null;
  let roomReady = false;
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;
  let simulationTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let matchRestartTimer: ReturnType<typeof setTimeout> | null = null;
  let lastScheduledSnapshotAt = -Infinity;
  let lastSeenAt = -Infinity;
  let lastRoomPingAt: number | undefined;
  let lastRoomPingId: string | undefined;
  let currentStatus: QuakeMultiplayerSessionStatus = {
    state: "closed",
    mode: "loopback",
  };
  const respawnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pickupRespawnTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const targetDispatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const moverStateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const moverStates = new Map<number, QuakeMultiplayerLoopbackMoverState>();
  const moverShootHealth = new Map<number, number>();
  const simulatedPlayerOverrides = new Map<string, QuakeMultiplayerAuthoritativePlayerState>();
  const hurtNextTouchAtByEntity = new Map<number, number>();
  const teleportActiveUntilByEntity = new Map<number, number>();
  const triggerNextTouchAt = new Map<number, number>();
  const triggerCounterRemaining = new Map<number, number>();
  const triggerShootHealth = new Map<number, number>();

  const adapter: QuakeMultiplayerSessionAdapter = {
    mode: "loopback",
    status: () => currentStatus,
    connect: async (connectOptions: QuakeMultiplayerSessionConnectOptions): Promise<QuakeMultiplayerSessionStatus> => {
      roomKey = createQuakeMultiplayerRoomCompatibilityKey(connectOptions.roomKey);
      clientId = connectOptions.clientId;
      displayName = connectOptions.displayName;
      playerColor = connectOptions.color;
      roomSequence = 0;
      worldEventSequence = 0;
      tick = 0;
      matchSettings = {};
      matchStatus = "active";
      presenceStatus = "active";
      gameplayFacts = null;
      playerState = createLoopbackPlayerState(roomKey, clientId, displayName, playerColor, now());
      playerSimulationState = createQuakeMultiplayerRoomPlayerSimulationState({
        playerId: playerState.playerId,
        now: now(),
      });
      pickupDefinitions = new Map();
      pickupStates = new Map();
      worldDefinitions = new Map();
      clearTimers(targetDispatchTimers);
      clearTimers(moverStateTimers);
      moverStates.clear();
      moverShootHealth.clear();
      simulatedPlayerOverrides.clear();
      hurtNextTouchAtByEntity.clear();
      teleportActiveUntilByEntity.clear();
      triggerNextTouchAt.clear();
      triggerCounterRemaining.clear();
      triggerShootHealth.clear();
      lastFireAt = -Infinity;
      clientAuthorityState = null;
      roomReady = false;
      lastScheduledSnapshotAt = -Infinity;
      lastSeenAt = -Infinity;
      lastRoomPingAt = undefined;
      lastRoomPingId = undefined;
      currentStatus = {
        state: "connected",
        mode: "loopback",
        connectedAt: now(),
        roomKey,
      };
      return currentStatus;
    },
    disconnect: (reason?: string): void => {
      currentStatus = {
        state: "closed",
        mode: "loopback",
        disconnectedAt: now(),
        ...(reason ? { reason } : {}),
        ...(roomKey ? { roomKey } : {}),
      };
      roomKey = null;
      gameplayFacts = null;
      playerState = null;
      playerSimulationState = null;
      pickupDefinitions = new Map();
      pickupStates = new Map();
      worldDefinitions = new Map();
      clientAuthorityState = null;
      roomReady = false;
      stopSnapshotTicker();
      stopSimulationTicker();
      stopHeartbeatTicker();
      clearMatchRestartTimer();
      clearTimers(respawnTimers);
      clearTimers(pickupRespawnTimers);
      clearTimers(targetDispatchTimers);
      clearTimers(moverStateTimers);
      moverStates.clear();
      moverShootHealth.clear();
      simulatedPlayerOverrides.clear();
      hurtNextTouchAtByEntity.clear();
      teleportActiveUntilByEntity.clear();
      triggerNextTouchAt.clear();
      triggerCounterRemaining.clear();
      triggerShootHealth.clear();
    },
    send: (message: QuakeMultiplayerClientEnvelope): void => {
      if (!roomKey || currentStatus.state !== "connected") return;
      const validation = validateQuakeMultiplayerClientEnvelope(message, {
        roomKey,
        now: now(),
        maxMessageAgeMs: options.maxMessageAgeMs,
        maxFutureSkewMs: options.maxFutureSkewMs,
      });
      if (!validation.ok) {
        emitReject({
          code: validation.code,
          message: validation.reason,
          recoverable: validation.code === "stale",
          rejectedMessageId: message.messageId,
        });
        return;
      }
      const authority = validateQuakeMultiplayerClientAuthority(validation.envelope, clientAuthorityState, {
        now: now(),
      });
      if (!authority.ok) {
        emitReject(authority.reject);
        return;
      }
      lastSeenAt = now();
      clientAuthorityState = authority.state;
      handleClientEnvelope(validation.envelope);
    },
    subscribe: (listener: QuakeMultiplayerRoomMessageListener): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  function handleClientEnvelope(message: QuakeMultiplayerClientEnvelope): void {
    if (!roomKey) return;
    switch (message.type) {
      case "client.hello":
        if (!acceptGameplayFacts(message)) return;
        clientId = message.payload.clientId;
        displayName = message.payload.displayName;
        playerColor = message.payload.color;
        matchSettings = message.payload.matchSettings ?? matchSettings;
        presenceStatus = "active";
        const trustedDefinitions = trustedGameplayDefinitionsForRoom();
        const initialSpawn = quakeLoopbackInitialSpawnPoint(
          trustedDefinitions?.deathmatchSpawns ?? message.payload.deathmatchSpawns,
        );
        playerState = createLoopbackPlayerState(roomKey, clientId, displayName, playerColor, now(), initialSpawn);
        playerSimulationState = createQuakeMultiplayerRoomPlayerSimulationState({
          playerId: playerState.playerId,
          now: now(),
        });
        const pickupDefinitionsForRoom = trustedDefinitions?.pickupDefinitions ?? message.payload.pickupDefinitions;
        if (pickupDefinitionsForRoom?.length) {
          registerPickupDefinitions(pickupDefinitionsForRoom);
        }
        const worldDefinitionsForRoom = trustedWorldDefinitionsForRoom();
        if (worldDefinitionsForRoom?.length) {
          registerWorldDefinitions(worldDefinitionsForRoom);
        }
        emitSnapshot();
        roomReady = true;
        startSimulationTicker();
        startSnapshotTicker();
        startHeartbeatTicker();
        break;
      case "client.presence":
        presenceStatus = message.payload.status;
        if (!quakeMultiplayerPresenceAcceptsInput(presenceStatus)) {
          pauseLoopbackPlayerSimulation();
          requestSnapshot();
        } else {
          startSimulationTicker();
        }
        emitRoomEvent({
          eventType: "player.presence",
          eventId: `presence-${message.messageId}`,
          roomTime: currentRoomTime(),
          playerId: playerState?.playerId ?? loopbackPlayerId(message.payload.clientId),
          status: message.payload.status,
        });
        break;
      case "client.input":
        if (!quakeMultiplayerPresenceAcceptsInput(presenceStatus)) {
          pauseLoopbackPlayerSimulation();
          return;
        }
        if (playerState && playerSimulationState) {
          const result = queueQuakeMultiplayerRoomInput(playerSimulationState, message.payload.input);
          playerSimulationState = result.state;
          if (result.accepted) startSimulationTicker();
        }
        break;
      case "client.fire":
        advanceLoopbackSimulation(now());
        handleFireIntent(message);
        break;
      case "client.damage":
        emitReject(rejectQuakeMultiplayerClientDamageIntent(message));
        break;
      case "client.pickup":
        advanceLoopbackSimulation(now());
        handlePickupIntent(message);
        break;
      case "client.match":
        handleMatchIntent(message);
        break;
      case "client.world":
        handleWorldIntent(message);
        break;
      case "client.pose":
        if (playerState?.lastInputSequence || playerSimulationStateHasInput(playerSimulationState)) {
          playerState = {
            ...playerState,
            rotX: message.payload.pose.rotX,
            rotY: message.payload.pose.rotY,
            updatedAt: now(),
          };
        } else {
          playerState = createLoopbackPlayerStateFromPose(
            roomKey,
            message.payload.clientId,
            displayName || message.payload.clientId,
            playerColor,
            message.payload.pose,
            playerState,
            now(),
          );
          playerSimulationState = createQuakeMultiplayerRoomPlayerSimulationState({
            playerId: playerState.playerId,
            now: now(),
            lastAcceptedInputSequence: playerState.lastInputSequence,
          });
        }
        requestSnapshot();
        break;
      case "client.ping":
        emitRoomEnvelope("room.pong", {
          pingId: message.payload.pingId,
          sentAt: now(),
          echoedSentAt: message.payload.sentAt,
          responderTime: currentRoomTime(),
        });
        break;
      case "client.pong":
        handleClientPong(message);
        break;
    }
  }

  function acceptGameplayFacts(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.hello" }>,
  ): boolean {
    const trustedDefinitions = trustedGameplayDefinitionsForRoom();
    if (trustedDefinitions) {
      return acceptTrustedGameplayFacts(message, trustedDefinitions);
    }
    const incoming = message.payload.gameplayFacts;
    const suppliedGameplayDefinitions = Boolean(
      message.payload.deathmatchSpawns?.length ||
        message.payload.pickupDefinitions?.length,
    );
    if (!incoming && suppliedGameplayDefinitions) {
      emitReject({
        code: "wrong-map",
        message: "Multiplayer gameplay facts fingerprint is required when gameplay definitions are supplied.",
        recoverable: false,
        rejectedMessageId: message.messageId,
      });
      return false;
    }
    if (!gameplayFacts) {
      if (incoming) {
        const claim = checkQuakeMultiplayerGameplayFactsClaim(incoming, {
          deathmatchSpawns: message.payload.deathmatchSpawns,
          pickupDefinitions: message.payload.pickupDefinitions,
        }, {
          requireDefinitionsForNonEmptyFacts: true,
        });
        if (!claim.ok) {
          emitReject({
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
        gameplayFacts = incoming;
      }
      return true;
    }
    if (incoming && suppliedGameplayDefinitions) {
      const claim = checkQuakeMultiplayerGameplayFactsClaim(incoming, {
        deathmatchSpawns: message.payload.deathmatchSpawns,
        pickupDefinitions: message.payload.pickupDefinitions,
      });
      if (!claim.ok) {
        emitReject({
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
    if (sameQuakeMultiplayerGameplayFacts(gameplayFacts, incoming)) return true;
    emitReject({
      code: "wrong-map",
      message: "Multiplayer gameplay facts do not match this room.",
      recoverable: false,
      rejectedMessageId: message.messageId,
      details: {
        expectedFactsHash: gameplayFacts.factsHash,
        receivedFactsHash: incoming?.factsHash ?? "",
      },
    });
    return false;
  }

  function acceptTrustedGameplayFacts(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.hello" }>,
    trustedDefinitions: QuakeMultiplayerGameplayDefinitions,
  ): boolean {
    const incoming = message.payload.gameplayFacts;
    if (incoming && !sameQuakeMultiplayerGameplayFacts(trustedDefinitions.gameplayFacts, incoming)) {
      emitReject({
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
        emitReject({
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
    gameplayFacts = trustedDefinitions.gameplayFacts;
    return true;
  }

  function emitSnapshot(): void {
    if (!roomKey) return;
    enterIntermissionIfTimeLimitReached("snapshot");
    pruneExpiredPowerups();
    lastScheduledSnapshotAt = now();
    tick += 1;
    emitRoomEnvelope("room.snapshot", {
      roomId,
      tick,
      roomTime: currentRoomTime(),
      match: {
        status: matchStatus,
        clockMs: currentRoomTime(),
        ...matchSettings,
      },
      players: loopbackSnapshotPlayers(),
      pickups: [...pickupStates.values()],
      lastWorldEventSequence: worldEventSequence,
    });
  }

  function handleClientPong(message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.pong" }>): void {
    if (!playerState || message.payload.pingId !== lastRoomPingId) return;
    const pingMs = quakeMultiplayerPingMsFromPong(now(), message.payload.echoedSentAt);
    playerState = {
      ...playerState,
      pingMs,
      updatedAt: now(),
    };
    requestSnapshot();
  }

  function requestSnapshot(): void {
    if (snapshotIntervalMs === false) {
      emitSnapshot();
      return;
    }
    startSnapshotTicker();
  }

  function advanceLoopbackSimulation(timestamp = now()): boolean {
    if (
      !playerState ||
      !playerSimulationState ||
      simulationTickMs === false ||
      matchStatus !== "active" ||
      !quakeMultiplayerPresenceAcceptsInput(presenceStatus)
    ) {
      return false;
    }
    const result = advanceQuakeMultiplayerRoomPlayerSimulation(playerState, playerSimulationState, {
      now: timestamp,
      tickMs: simulationTickMs,
      collisionWorld: options.trustedSceneMovement?.collisionWorld,
      playerEyeHeight: options.trustedSceneMovement?.playerEyeHeight,
      radsuitActive: quakeMultiplayerPlayerPowerupActive(playerState, "radsuit_finished", timestamp),
    });
    playerState = result.player;
    playerSimulationState = result.state;
    let appliedHazardDamage = false;
    for (const hazard of result.hazardDamages) {
      appliedHazardDamage = applyLocalRoomDamage({
        damage: hazard.damage,
        damageSource: hazard.kind,
        eventId: `liquid-${hazard.kind}-${hazard.damagedAt}`,
      }) || appliedHazardDamage;
    }
    return result.advancedTicks > 0 || appliedHazardDamage;
  }

  function startSimulationTicker(): void {
    if (simulationTickMs === false || simulationTimer || !roomReady) return;
    simulationTimer = setInterval(() => {
      if (advanceLoopbackSimulation(now())) {
        requestSnapshot();
      }
    }, simulationTickMs);
    unrefTimer(simulationTimer);
  }

  function stopSimulationTicker(): void {
    if (!simulationTimer) return;
    clearInterval(simulationTimer);
    simulationTimer = null;
  }

  function startSnapshotTicker(): void {
    if (snapshotIntervalMs === false || snapshotTimer || !roomReady) return;
    snapshotTimer = setInterval(() => {
      const timestamp = now();
      const advanced = advanceLoopbackSimulation(timestamp);
      if (
        shouldEmitQuakeMultiplayerRoomSnapshot(timestamp, { lastSnapshotAt: lastScheduledSnapshotAt }, {
          connected: currentStatus.state === "connected" && Boolean(roomKey),
          playerCount: playerState ? 1 : 0,
          intervalMs: snapshotIntervalMs,
        })
      ) {
        emitSnapshot();
      } else if (advanced && snapshotIntervalMs === false) {
        emitSnapshot();
      }
    }, snapshotIntervalMs);
    unrefTimer(snapshotTimer);
  }

  function startHeartbeatTicker(): void {
    if (heartbeatIntervalMs === false || heartbeatTimer || !roomReady) return;
    heartbeatTimer = setInterval(() => {
      const timestamp = now();
      if (
        isQuakeMultiplayerClientStale(
          timestamp,
          lastSeenAt,
          options.staleClientMs ?? QUAKE_MULTIPLAYER_STALE_CLIENT_MS,
        )
      ) {
        adapter.disconnect("stale");
        return;
      }
      if (!roomKey || !shouldSendQuakeMultiplayerRoomPing(timestamp, lastRoomPingAt, heartbeatIntervalMs)) return;
      lastRoomPingAt = timestamp;
      lastRoomPingId = `loopback-ping-${timestamp}`;
      emitRoomEnvelope("room.ping", {
        pingId: lastRoomPingId,
        sentAt: timestamp,
      });
    }, heartbeatIntervalMs);
    unrefTimer(heartbeatTimer);
  }

  function stopHeartbeatTicker(): void {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function stopSnapshotTicker(): void {
    if (!snapshotTimer) return;
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }

  function loopbackSnapshotPlayers(): QuakeMultiplayerAuthoritativePlayerState[] {
    const players = new Map<string, QuakeMultiplayerAuthoritativePlayerState>();
    if (playerState) players.set(playerState.playerId, playerState);
    for (const player of options.simulatedPlayers?.() ?? []) {
      players.set(player.playerId, simulatedPlayerOverrides.get(player.playerId) ?? player);
    }
    if (
      options.includeDefaultSimulatedPlayer &&
      roomKey &&
      playerState &&
      !players.has(QUAKE_LOOPBACK_DEFAULT_REMOTE_PLAYER_ID)
    ) {
      const remotePlayer =
        simulatedPlayerOverrides.get(QUAKE_LOOPBACK_DEFAULT_REMOTE_PLAYER_ID) ??
        createLoopbackDefaultSimulatedPlayer(roomKey, playerState, now());
      players.set(remotePlayer.playerId, remotePlayer);
    }
    return [...players.values()];
  }

  function registerPickupDefinitions(definitions: readonly QuakeMultiplayerPickupDefinition[]): void {
    for (const definition of definitions) {
      if (pickupDefinitions.has(definition.entityIndex)) continue;
      pickupDefinitions.set(definition.entityIndex, definition);
      pickupStates.set(definition.entityIndex, {
        pickupId: definition.pickupId,
        entityIndex: definition.entityIndex,
        available: true,
        updatedAt: now(),
      });
    }
  }

  function registerWorldDefinitions(definitions: readonly QuakeMultiplayerWorldDefinition[]): void {
    for (const definition of definitions) {
      if (worldDefinitions.has(definition.entityIndex)) continue;
      worldDefinitions.set(definition.entityIndex, definition);
    }
  }

  function handleFireIntent(message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.fire" }>): void {
    if (!playerState) return;
    if (!acceptActivePresenceIntent(message.messageId)) return;
    if (!acceptActiveMatchIntent(message.messageId)) return;
    const timestamp = now();
    const attackerInventory = quakeMultiplayerPruneExpiredPowerups(
      quakeMultiplayerPlayerInventory(playerState),
      timestamp,
    );
    const authoritativeFire = quakeMultiplayerDeathmatchFireFromPlayer(
      quakeMultiplayerPlayerWithInventory(playerState, attackerInventory),
      message.payload.fire,
    );
    const cooldownMs = quakeMultiplayerDeathmatchWeaponCooldownMs(authoritativeFire.weapon);
    if (!Number.isFinite(cooldownMs)) {
      emitReject({
        code: "unsupported",
        message: `Weapon ${authoritativeFire.weapon} is not enabled for multiplayer damage yet.`,
        recoverable: true,
        rejectedMessageId: message.messageId,
      });
      return;
    }
    const nextFireAt = lastFireAt + cooldownMs;
    if (timestamp < nextFireAt) {
      emitReject({
        code: "stale",
        message: "Multiplayer fire intent arrived before weapon cooldown elapsed.",
        recoverable: true,
        rejectedMessageId: message.messageId,
        retryAfterMs: Math.max(0, nextFireAt - timestamp),
      });
      return;
    }
    const lightningDischarge = quakeMultiplayerDeathmatchLightningDischarge({
      attacker: quakeMultiplayerPlayerWithInventory(playerState, attackerInventory),
      collisionWorld: options.trustedSceneMovement?.collisionWorld,
      playerEyeHeight: options.trustedSceneMovement?.playerEyeHeight,
      players: loopbackSnapshotPlayers(),
    });
    if (lightningDischarge) {
      const inventory = quakeMultiplayerConsumeLightningDischargeCells(attackerInventory);
      if (!inventory) {
        emitReject({
          code: "unsupported",
          message: `Not enough ammo for ${authoritativeFire.weapon}.`,
          recoverable: true,
          rejectedMessageId: message.messageId,
        });
        return;
      }
      lastFireAt = timestamp;
      playerState = {
        ...quakeMultiplayerPlayerWithInventory(playerState, inventory),
        updatedAt: timestamp,
      };
      emitRoomEvent({
        eventType: "player.fired",
        eventId: `fire-${message.messageId}`,
        roomTime: currentRoomTime(),
        playerId: playerState.playerId,
        weapon: authoritativeFire.weapon,
        fireKind: authoritativeFire.fireKind,
        origin: authoritativeFire.origin,
        direction: authoritativeFire.direction,
      });
      const damageMultiplier = quakeMultiplayerDamageMultiplierForInventory(inventory, timestamp);
      for (const hit of lightningDischarge.hits) {
        if (hit.target.playerId === playerState.playerId) {
          applyLocalPlayerDamage(
            hit.damage * damageMultiplier,
            message,
            "lightning-discharge",
            playerState.origin,
          );
        } else {
          applySimulatedPlayerDamage(
            hit.target,
            hit.damage * damageMultiplier,
            message,
            "lightning-discharge",
            playerState.origin,
          );
        }
      }
      emitSnapshot();
      return;
    }
    const inventory = quakeMultiplayerConsumeWeaponAmmo(
      attackerInventory,
      authoritativeFire.weapon,
    );
    if (!inventory) {
      emitReject({
        code: "unsupported",
        message: `Not enough ammo for ${authoritativeFire.weapon}.`,
        recoverable: true,
        rejectedMessageId: message.messageId,
      });
      return;
    }
    lastFireAt = timestamp;
    playerState = {
      ...quakeMultiplayerPlayerWithInventory(playerState, inventory),
      updatedAt: timestamp,
    };
    emitRoomEvent({
      eventType: "player.fired",
      eventId: `fire-${message.messageId}`,
      roomTime: currentRoomTime(),
      playerId: playerState.playerId,
      weapon: authoritativeFire.weapon,
      fireKind: authoritativeFire.fireKind,
      origin: authoritativeFire.origin,
      direction: authoritativeFire.direction,
    });
    const hit = quakeMultiplayerDeathmatchHitscanHit(
      authoritativeFire,
      loopbackSnapshotPlayers(),
      playerState.playerId,
    );
    const worldHit = quakeMultiplayerShootableWorldHit(authoritativeFire, worldDefinitions.values());
    if (worldHit && (!hit || worldHit.distance <= hit.distance)) {
      const damage = quakeMultiplayerDeathmatchWeaponDamage(authoritativeFire.weapon) *
        quakeMultiplayerDamageMultiplierForInventory(inventory, timestamp);
      if (worldHit.definition.kind === "mover") {
        applyShootableMoverDamage(
          worldHit.definition,
          playerState.playerId,
          `mover-shoot-${message.messageId}-${worldHit.definition.entityIndex}`,
          damage,
        );
      } else {
        applyShootableTriggerDamage(
          worldHit.definition,
          playerState.playerId,
          `trigger-shoot-${message.messageId}-${worldHit.definition.entityIndex}`,
          damage,
        );
      }
      emitSnapshot();
      return;
    }
    if (hit) {
      const damageMultiplier = quakeMultiplayerDamageMultiplierForInventory(inventory, timestamp);
      for (const damageHit of quakeMultiplayerDeathmatchSplashHits(
        authoritativeFire,
        hit,
        loopbackSnapshotPlayers(),
        playerState.playerId,
      )) {
        if (damageHit.target.playerId === playerState.playerId) {
          applyLocalPlayerDamage(
            damageHit.damage * damageMultiplier,
            message,
            authoritativeFire.weapon,
            authoritativeFire.fireKind === "projectile" ? damageHit.impact : playerState.origin,
          );
        } else {
          applySimulatedPlayerDamage(
            damageHit.target,
            damageHit.damage * damageMultiplier,
            message,
            authoritativeFire.weapon,
            authoritativeFire.fireKind === "projectile" ? damageHit.impact : playerState.origin,
          );
        }
      }
    }
    emitSnapshot();
  }

  function applyLocalPlayerDamage(
    damage: number,
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.fire" }>,
    damageSource: string,
    inflictorOrigin?: QuakeMultiplayerVec3 | null,
  ): void {
    if (!playerState) return;
    applyLocalRoomDamage({
      attackerPlayerId: playerState.playerId,
      damage,
      damageSource,
      eventId: `${message.messageId}-${playerState.playerId}`,
      inflictorOrigin,
    });
  }

  function applyLocalRoomDamage(input: {
    attackerPlayerId?: string;
    damage: number;
    damageSource: string;
    eventId: string;
    inflictorOrigin?: QuakeMultiplayerVec3 | null;
  }): boolean {
    if (!playerState || !playerState.alive) return false;
    const damage = Math.max(0, input.damage);
    if (damage <= 0) return false;
    const timestamp = now();
    const playerInventory = quakeMultiplayerPruneExpiredPowerups(quakeMultiplayerPlayerInventory(playerState), timestamp);
    const invulnerable = quakeMultiplayerPlayerPowerupActive(playerState, "invincible_finished", timestamp);
    const inventory = quakeMultiplayerApplyDamageToInventory(
      playerInventory,
      damage,
      { applyHealth: !invulnerable },
    );
    const died = inventory.health <= 0;
    const fragDelta = died && input.attackerPlayerId
      ? quakeMultiplayerDeathmatchFragDeltaForKill({
          attackerPlayerId: input.attackerPlayerId,
          victimPlayerId: playerState.playerId,
        })
      : 0;
    const damagedPlayer = quakeMultiplayerDeathmatchPlayerWithDamageMomentum({
      player: quakeMultiplayerPlayerWithInventory(playerState, inventory),
      damage,
      inflictorOrigin: input.inflictorOrigin,
    });
    playerState = {
      ...damagedPlayer,
      alive: !died,
      frags: playerState.frags + fragDelta,
      deaths: died ? playerState.deaths + 1 : playerState.deaths,
      updatedAt: timestamp,
      ...(died ? { respawnAt: timestamp + QUAKE_MULTIPLAYER_DEATHMATCH_RESPAWN_DELAY_MS } : {}),
    };
    if (died) {
      clearPickupOwnership(playerState.playerId, timestamp);
      if (playerSimulationState) {
        playerSimulationState = pauseQuakeMultiplayerRoomPlayerSimulation(playerSimulationState, timestamp);
      }
      emitRoomEvent({
        eventType: "player.killed",
        eventId: `kill-${input.eventId}`,
        roomTime: currentRoomTime(),
        victimPlayerId: playerState.playerId,
        ...(input.attackerPlayerId ? { attackerPlayerId: input.attackerPlayerId } : {}),
        damageSource: input.damageSource,
      });
      scheduleLocalRespawn(playerState.respawnAt ?? timestamp);
    } else {
      emitRoomEvent({
        eventType: "player.damaged",
        eventId: `damage-${input.eventId}`,
        roomTime: currentRoomTime(),
        victimPlayerId: playerState.playerId,
        ...(input.attackerPlayerId ? { attackerPlayerId: input.attackerPlayerId } : {}),
        damage,
        health: playerState.health,
        armor: playerState.armor,
        damageSource: input.damageSource,
      });
    }
    return true;
  }

  function applySimulatedPlayerDamage(
    target: QuakeMultiplayerAuthoritativePlayerState,
    damage: number,
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.fire" }>,
    damageSource: string,
    inflictorOrigin?: QuakeMultiplayerVec3 | null,
  ): void {
    applySimulatedRoomDamage(target, {
      attackerPlayerId: playerState?.playerId,
      damage,
      damageSource,
      eventId: message.messageId,
      inflictorOrigin,
    });
  }

  function applySimulatedRoomDamage(
    target: QuakeMultiplayerAuthoritativePlayerState,
    input: {
      attackerPlayerId?: string;
      damage: number;
      damageSource: string;
      eventId: string;
      inflictorOrigin?: QuakeMultiplayerVec3 | null;
    },
  ): void {
    const timestamp = now();
    const damage = Math.max(0, input.damage);
    if (damage <= 0) return;
    const targetInventory = quakeMultiplayerPruneExpiredPowerups(quakeMultiplayerPlayerInventory(target), timestamp);
    const invulnerable = quakeMultiplayerPlayerPowerupActive(target, "invincible_finished", timestamp);
    const inventory = quakeMultiplayerApplyDamageToInventory(
      targetInventory,
      damage,
      { applyHealth: !invulnerable },
    );
    const died = inventory.health <= 0;
    const damagedTarget = quakeMultiplayerDeathmatchPlayerWithDamageMomentum({
      player: quakeMultiplayerPlayerWithInventory(target, inventory),
      damage,
      inflictorOrigin: input.inflictorOrigin,
    });
    const updatedTarget = {
      ...damagedTarget,
      alive: !died,
      deaths: died ? target.deaths + 1 : target.deaths,
      updatedAt: timestamp,
      ...(died ? { respawnAt: timestamp + QUAKE_MULTIPLAYER_DEATHMATCH_RESPAWN_DELAY_MS } : {}),
    };
    simulatedPlayerOverrides.set(target.playerId, updatedTarget);
    if (died) {
      if (playerState && input.attackerPlayerId === playerState.playerId) {
        const fragDelta = quakeMultiplayerDeathmatchFragDeltaForKill({
          attackerPlayerId: playerState.playerId,
          victimPlayerId: target.playerId,
        });
        playerState = {
          ...playerState,
          frags: playerState.frags + fragDelta,
          updatedAt: timestamp,
        };
      }
      clearPickupOwnership(target.playerId, timestamp);
      emitRoomEvent({
        eventType: "player.killed",
        eventId: `kill-${input.eventId}`,
        roomTime: currentRoomTime(),
        victimPlayerId: target.playerId,
        ...(input.attackerPlayerId ? { attackerPlayerId: input.attackerPlayerId } : {}),
        damageSource: input.damageSource,
      });
      const matchEnded = playerState && input.attackerPlayerId === playerState.playerId
        ? enterIntermissionIfFragLimitReached(playerState, input.eventId)
        : false;
      if (!matchEnded) scheduleSimulatedRespawn(target.playerId, updatedTarget.respawnAt ?? timestamp);
    } else {
      emitRoomEvent({
        eventType: "player.damaged",
        eventId: `damage-${input.eventId}`,
        roomTime: currentRoomTime(),
        victimPlayerId: target.playerId,
        ...(input.attackerPlayerId ? { attackerPlayerId: input.attackerPlayerId } : {}),
        damage,
        health: updatedTarget.health,
        armor: updatedTarget.armor,
        damageSource: input.damageSource,
      });
    }
  }

  function applyTeleportDeath(ownerPlayerId: string, destinationOrigin: QuakeMultiplayerVec3, eventId: string): void {
    if (!playerState || ownerPlayerId !== playerState.playerId) return;
    const timestamp = now();
    for (const victim of loopbackSnapshotPlayers()) {
      if (victim.playerId === ownerPlayerId) continue;
      if (!quakeMultiplayerPlayerIntersectsTelefragVolume(victim, destinationOrigin)) continue;
      if (quakeMultiplayerPlayerPowerupActive(victim, "invincible_finished", timestamp)) {
        applyLocalRoomDamage({
          attackerPlayerId: ownerPlayerId,
          damage: QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE,
          damageSource: "teledeath2",
          eventId: `telefrag-deflect-${eventId}-${victim.playerId}`,
        });
        continue;
      }
      applySimulatedRoomDamage(victim, {
        attackerPlayerId: ownerPlayerId,
        damage: QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE,
        damageSource: "teledeath",
        eventId: `telefrag-${eventId}-${victim.playerId}`,
      });
    }
  }

  function scheduleLocalRespawn(respawnAt: number): void {
    const playerId = playerState?.playerId;
    if (!playerId) return;
    const previous = respawnTimers.get(playerId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      respawnTimers.delete(playerId);
      if (!playerState || playerState.playerId !== playerId) return;
      clearPickupOwnership(playerId, now());
      playerState = {
        ...quakeMultiplayerPlayerWithInventory(playerState, createQuakeMultiplayerInitialInventory()),
        alive: true,
        velocity: [0, 0, 0],
        respawnAt: undefined,
        updatedAt: now(),
      };
      playerSimulationState = createQuakeMultiplayerRoomPlayerSimulationState({
        playerId: playerState.playerId,
        now: now(),
        lastAcceptedInputSequence: playerState.lastInputSequence,
      });
      emitRoomEvent({
        eventType: "player.respawned",
        eventId: `respawn-${playerId}-${now()}`,
        roomTime: currentRoomTime(),
        player: playerState,
      });
      emitSnapshot();
    }, Math.max(0, respawnAt - now()));
    respawnTimers.set(playerId, timer);
  }

  function scheduleSimulatedRespawn(playerId: string, respawnAt: number): void {
    const previous = respawnTimers.get(playerId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      respawnTimers.delete(playerId);
      const player = simulatedPlayerOverrides.get(playerId);
      if (!player) return;
      clearPickupOwnership(playerId, now());
      const respawned = {
        ...quakeMultiplayerPlayerWithInventory(player, createQuakeMultiplayerInitialInventory()),
        alive: true,
        velocity: [0, 0, 0],
        respawnAt: undefined,
        updatedAt: now(),
      };
      simulatedPlayerOverrides.set(playerId, respawned);
      emitRoomEvent({
        eventType: "player.respawned",
        eventId: `respawn-${playerId}-${now()}`,
        roomTime: currentRoomTime(),
        player: respawned,
      });
      emitSnapshot();
    }, Math.max(0, respawnAt - now()));
    respawnTimers.set(playerId, timer);
  }

  function handlePickupIntent(message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.pickup" }>): void {
    if (!playerState) return;
    if (!acceptActivePresenceIntent(message.messageId)) return;
    if (!acceptActiveMatchIntent(message.messageId)) return;
    const definition = pickupDefinitions.get(message.payload.pickup.entityIndex);
    const state = pickupStates.get(message.payload.pickup.entityIndex);
    if (!definition || !state) {
      emitPickupRejected(message, undefined, "unknown-pickup");
      return;
    }
    const ownerPlayerIds = new Set(state.ownerPlayerIds ?? []);
    if (!state.available || ownerPlayerIds.has(playerState.playerId)) {
      emitPickupRejected(message, definition, "unavailable");
      return;
    }
    if (!quakeMultiplayerPlayerCanReachPickup(playerState, definition)) {
      emitPickupRejected(message, definition, "too-far");
      return;
    }
    const timestamp = now();
    const inventory = quakeMultiplayerPruneExpiredPowerups(quakeMultiplayerPlayerInventory(playerState), timestamp);
    if (!quakeMultiplayerInventoryCanAcceptPickupEffect(inventory, definition.effect)) {
      emitPickupRejected(message, definition, "not-needed");
      return;
    }
    playerState = {
      ...quakeMultiplayerPlayerWithInventory(
        playerState,
        quakeMultiplayerApplyPickupEffect(inventory, definition.effect, timestamp),
      ),
      updatedAt: timestamp,
    };
    const leaveInPlace = definition.lifecycle?.action === "leave";
    const updatedState: QuakeMultiplayerAuthoritativePickupState = {
      ...state,
      available: leaveInPlace,
      updatedAt: timestamp,
      ...(leaveInPlace ? { ownerPlayerIds: [...ownerPlayerIds, playerState.playerId] } : {}),
      ...(!leaveInPlace && definition.lifecycle?.action === "respawn" && definition.lifecycle.delayMs !== undefined
        ? { respawnAt: timestamp + definition.lifecycle.delayMs }
        : {}),
    };
    pickupStates.set(definition.entityIndex, updatedState);
    emitRoomEvent({
      eventType: "pickup.taken",
      eventId: `pickup-${message.messageId}`,
      roomTime: currentRoomTime(),
      playerId: playerState.playerId,
      pickupId: definition.pickupId,
      entityIndex: definition.entityIndex,
      effect: definition.effect,
      leaveInPlace,
      ...(updatedState.respawnAt !== undefined ? { respawnAt: updatedState.respawnAt } : {}),
      ...(definition.feedback ? { feedback: definition.feedback } : {}),
    });
    if (!leaveInPlace && updatedState.respawnAt !== undefined) {
      schedulePickupRespawn(definition.entityIndex, updatedState.respawnAt);
    }
    const targetDispatch = pickupTargetDispatchSource(definition);
    if (targetDispatch) scheduleTargetDispatch(targetDispatch, playerState.playerId, `pickup-${message.messageId}`);
    emitSnapshot();
  }

  function pruneExpiredPowerups(): void {
    const timestamp = now();
    if (playerState) {
      const inventory = quakeMultiplayerPlayerInventory(playerState);
      const pruned = quakeMultiplayerPruneExpiredPowerups(inventory, timestamp);
      if (pruned.powerups.length !== inventory.powerups.length) {
        playerState = {
          ...quakeMultiplayerPlayerWithInventory(playerState, pruned),
          updatedAt: timestamp,
        };
      }
    }
    for (const [playerId, player] of simulatedPlayerOverrides) {
      const inventory = quakeMultiplayerPlayerInventory(player);
      const pruned = quakeMultiplayerPruneExpiredPowerups(inventory, timestamp);
      if (pruned.powerups.length === inventory.powerups.length) continue;
      simulatedPlayerOverrides.set(playerId, {
        ...quakeMultiplayerPlayerWithInventory(player, pruned),
        updatedAt: timestamp,
      });
    }
  }

  function emitPickupRejected(
    message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.pickup" }>,
    definition: QuakeMultiplayerPickupDefinition | undefined,
    reason: string,
  ): void {
    emitRoomEvent({
      eventType: "pickup.rejected",
      eventId: `pickup-reject-${message.messageId}`,
      roomTime: currentRoomTime(),
      playerId: playerState?.playerId ?? loopbackPlayerId(message.payload.clientId),
      ...(definition ? { pickupId: definition.pickupId } : {}),
      entityIndex: message.payload.pickup.entityIndex,
      reason,
    });
  }

  function handleMatchIntent(message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.match" }>): void {
    if (!acceptActivePresenceIntent(message.messageId)) return;
    if (matchStatus !== "intermission") {
      emitReject({
        code: "unsupported",
        message: "Multiplayer match can only be restarted during intermission.",
        recoverable: true,
        rejectedMessageId: message.messageId,
      });
      return;
    }
    restartMatch(message.messageId);
  }

  function handleWorldIntent(message: Extract<QuakeMultiplayerClientEnvelope, { type: "client.world" }>): void {
    if (!playerState) return;
    if (!message.payload.intent) {
      emitReject(rejectQuakeMultiplayerClientWorldEvent(message));
      return;
    }
    if (!acceptActivePresenceIntent(message.messageId)) return;
    if (!acceptActiveMatchIntent(message.messageId)) return;
    const resolution = resolveQuakeMultiplayerWorldIntent(
      playerState,
      message.payload.intent,
      worldDefinitions.values(),
      now(),
    );
    if (!resolution.ok) {
      emitReject({
        code: "unsupported",
        message: resolution.message,
        recoverable: true,
        rejectedMessageId: message.messageId,
        details: { reason: resolution.reason },
      });
      return;
    }
    if (resolution.kind === "teleport") {
      if (!acceptTeleportTouch(resolution.definition, now())) {
        emitReject({
          code: "unsupported",
          message: "Multiplayer teleporter is not active.",
          recoverable: true,
          rejectedMessageId: message.messageId,
          details: { reason: "teleport-inactive" },
        });
        return;
      }
      applyTeleportDeath(playerState.playerId, resolution.definition.destinationOrigin, message.messageId);
      playerState = {
        ...playerState,
        origin: resolution.player.origin,
        velocity: resolution.player.velocity,
        rotX: resolution.player.rotX,
        rotY: resolution.player.rotY,
        lastInputSequence: resolution.player.lastInputSequence,
        updatedAt: resolution.player.updatedAt,
      };
      if (playerState.alive) {
        const timestamp = now();
        playerSimulationState = createQuakeMultiplayerRoomPlayerSimulationState({
          playerId: playerState.playerId,
          now: timestamp,
          grounded: false,
          lastAcceptedInputSequence: playerState.lastInputSequence,
          teleportBackpedalLockUntil: timestamp + QUAKE_MULTIPLAYER_TELEPORT_BACKPEDAL_LOCK_MS,
        });
      } else if (playerSimulationState) {
        playerSimulationState = pauseQuakeMultiplayerRoomPlayerSimulation(playerSimulationState, now());
      }
      emitRoomEvent({
        eventType: "world.teleport",
        eventId: `teleport-${message.messageId}`,
        roomTime: currentRoomTime(),
        playerId: playerState.playerId,
        entityIndex: resolution.definition.entityIndex,
        origin: resolution.definition.destinationOrigin,
        velocity: resolution.player.velocity,
        destinationEntityIndex: resolution.definition.destinationEntityIndex,
      });
      emitSnapshot();
      return;
    }
    if (resolution.kind === "hurt") {
      if (!acceptHurtTouch(resolution.definition.entityIndex, now())) return;
      const applied = applyLocalRoomDamage({
        damage: resolution.damage,
        damageSource: "trigger_hurt",
        eventId: `world-${message.messageId}`,
      });
      if (applied) emitSnapshot();
      return;
    }
    if (resolution.kind === "push") {
      playerState = resolution.player;
      if (playerSimulationState) {
        const { floorZ: _floorZ, ...simulationState } = playerSimulationState;
        playerSimulationState = {
          ...simulationState,
          grounded: false,
        };
      }
      if (resolution.definition.oneShot) removeWorldDefinition(resolution.definition.entityIndex);
      emitRoomEvent({
        eventType: "world.push",
        eventId: `push-${message.messageId}`,
        roomTime: currentRoomTime(),
        playerId: playerState.playerId,
        entityIndex: resolution.definition.entityIndex,
        velocity: resolution.definition.velocity,
        oneShot: resolution.definition.oneShot,
      });
      emitSnapshot();
      return;
    }
    if (resolution.kind === "trigger") {
      if (!acceptTriggerTouch(resolution.definition, now())) return;
      if (resolution.definition.oneShot) removeWorldDefinition(resolution.definition.entityIndex);
      const eventId = `trigger-${message.messageId}`;
      emitRoomEvent({
        eventType: "world.trigger",
        eventId,
        roomTime: currentRoomTime(),
        playerId: playerState.playerId,
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
      scheduleTargetDispatch(resolution.definition, playerState.playerId, eventId);
      return;
    }
    if (resolution.kind === "mover") {
      activateMover(resolution.definition, playerState.playerId, `mover-${message.messageId}`, 0, "touch");
      return;
    }
    matchStatus = "intermission";
    clearTimers(respawnTimers);
    clearTimers(targetDispatchTimers);
    clearTimers(moverStateTimers);
    moverStates.clear();
    moverShootHealth.clear();
    emitRoomEvent({
      eventType: "level.transition",
      eventId: `level-transition-${message.messageId}`,
      roomTime: currentRoomTime(),
      playerId: playerState.playerId,
      entityIndex: resolution.definition.entityIndex,
      targetMap: resolution.definition.targetMap,
    });
    emitRoomEvent({
      eventType: "match.notice",
      eventId: `match-level-transition-${message.messageId}`,
      roomTime: currentRoomTime(),
      code: "level-transition",
      message: `Level transition requested: ${resolution.definition.targetMap}.`,
    });
    scheduleMatchRestart(message.messageId);
    emitSnapshot();
  }

  function schedulePickupRespawn(entityIndex: number, respawnAt: number): void {
    const previous = pickupRespawnTimers.get(entityIndex);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      pickupRespawnTimers.delete(entityIndex);
      const state = pickupStates.get(entityIndex);
      if (!state) return;
      const respawned = quakeMultiplayerPickupStateRespawned(state, now());
      pickupStates.set(entityIndex, respawned);
      emitRoomEvent({
        eventType: "pickup.respawned",
        eventId: `pickup-respawn-${entityIndex}-${now()}`,
        roomTime: currentRoomTime(),
        pickup: respawned,
      });
      emitSnapshot();
    }, Math.max(0, respawnAt - now()));
    pickupRespawnTimers.set(entityIndex, timer);
  }

  function clearPickupOwnership(playerId: string, timestamp = now()): void {
    for (const [entityIndex, state] of pickupStates) {
      const next = quakeMultiplayerPickupStateWithoutOwner(state, playerId, timestamp);
      if (next !== state) pickupStates.set(entityIndex, next);
    }
  }

  function trustedGameplayDefinitionsForRoom(): QuakeMultiplayerGameplayDefinitions | null {
    if (!roomKey) return null;
    const source = options.trustedGameplayDefinitions;
    if (!source) return null;
    return typeof source === "function" ? source(roomKey) ?? null : source;
  }

  function trustedWorldDefinitionsForRoom(): readonly QuakeMultiplayerWorldDefinition[] | null {
    if (!roomKey) return null;
    const source = options.trustedWorldDefinitions;
    if (!source) return null;
    return typeof source === "function" ? source(roomKey) ?? null : source;
  }

  function pauseLoopbackPlayerSimulation(): void {
    if (!playerSimulationState) return;
    playerSimulationState = pauseQuakeMultiplayerRoomPlayerSimulation(playerSimulationState, now());
    stopSimulationTicker();
  }

  function enterIntermissionIfFragLimitReached(
    player: QuakeMultiplayerAuthoritativePlayerState,
    eventIdSeed: string,
  ): boolean {
    const fragLimit = matchSettings.fragLimit;
    if (
      matchStatus !== "active" ||
      fragLimit === undefined ||
      fragLimit <= 0 ||
      player.frags < fragLimit
    ) {
      return false;
    }
    matchStatus = "intermission";
    clearTimers(respawnTimers);
    emitRoomEvent({
      eventType: "match.notice",
      eventId: `match-frag-limit-${eventIdSeed}`,
      roomTime: currentRoomTime(),
      code: "frag-limit",
      message: `${player.displayName} reached the frag limit.`,
    });
    scheduleMatchRestart(eventIdSeed);
    return true;
  }

  function enterIntermissionIfTimeLimitReached(eventIdSeed: string): boolean {
    const timeLimitMs = matchSettings.timeLimitMs;
    if (
      matchStatus !== "active" ||
      timeLimitMs === undefined ||
      timeLimitMs <= 0 ||
      currentRoomTime() < timeLimitMs
    ) {
      return false;
    }
    matchStatus = "intermission";
    clearTimers(respawnTimers);
    emitRoomEvent({
      eventType: "match.notice",
      eventId: `match-time-limit-${eventIdSeed}`,
      roomTime: currentRoomTime(),
      code: "time-limit",
      message: "Time limit reached.",
    });
    scheduleMatchRestart(eventIdSeed);
    return true;
  }

  function scheduleMatchRestart(eventIdSeed: string): void {
    clearMatchRestartTimer();
    const restartDelayMs = matchSettings.restartDelayMs;
    if (restartDelayMs === undefined || restartDelayMs <= 0) return;
    matchRestartTimer = setTimeout(() => {
      matchRestartTimer = null;
      restartMatch(eventIdSeed);
    }, restartDelayMs);
    unrefTimer(matchRestartTimer);
  }

  function clearMatchRestartTimer(): void {
    if (!matchRestartTimer) return;
    clearTimeout(matchRestartTimer);
    matchRestartTimer = null;
  }

  function restartMatch(eventIdSeed: string): void {
    if (!roomKey || matchStatus !== "intermission") return;
    const timestamp = now();
    clearMatchRestartTimer();
    matchStatus = "active";
    clearTimers(respawnTimers);
    clearTimers(pickupRespawnTimers);
    clearTimers(targetDispatchTimers);
    clearTimers(moverStateTimers);
    simulatedPlayerOverrides.clear();
    hurtNextTouchAtByEntity.clear();
    teleportActiveUntilByEntity.clear();
    triggerNextTouchAt.clear();
    triggerCounterRemaining.clear();
    triggerShootHealth.clear();
    moverStates.clear();
    moverShootHealth.clear();
    pickupStates = new Map();
    for (const definition of pickupDefinitions.values()) {
      pickupStates.set(definition.entityIndex, {
        pickupId: definition.pickupId,
        entityIndex: definition.entityIndex,
        available: true,
        updatedAt: timestamp,
      });
    }
    lastFireAt = -Infinity;
    currentStatus = {
      ...currentStatus,
      connectedAt: timestamp,
    };
    if (playerState) {
      playerState = {
        ...quakeMultiplayerPlayerWithInventory(playerState, createQuakeMultiplayerInitialInventory()),
        alive: true,
        frags: 0,
        deaths: 0,
        respawnAt: undefined,
        velocity: [0, 0, 0],
        lastInputSequence: 0,
        updatedAt: timestamp,
      };
      playerSimulationState = createQuakeMultiplayerRoomPlayerSimulationState({
        playerId: playerState.playerId,
        now: timestamp,
      });
    }
    emitRoomEvent({
      eventType: "match.notice",
      eventId: `match-restart-${eventIdSeed}-${timestamp}`,
      roomTime: currentRoomTime(),
      code: "restart",
      message: "Match restarted.",
    });
    emitSnapshot();
    if (quakeMultiplayerPresenceAcceptsInput(presenceStatus)) startSimulationTicker();
  }

  function acceptHurtTouch(entityIndex: number, timestamp: number): boolean {
    const nextAllowedAt = hurtNextTouchAtByEntity.get(entityIndex) ?? -Infinity;
    if (timestamp < nextAllowedAt) return false;
    hurtNextTouchAtByEntity.set(entityIndex, timestamp + QUAKE_MULTIPLAYER_TRIGGER_HURT_COOLDOWN_MS);
    return true;
  }

  function acceptTeleportTouch(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "teleport" }>,
    timestamp: number,
  ): boolean {
    if (!definition.touchRequiresActivation) return true;
    const activeUntil = teleportActiveUntilByEntity.get(definition.entityIndex) ?? -Infinity;
    return timestamp <= activeUntil;
  }

  function acceptTriggerTouch(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>,
    timestamp: number,
  ): boolean {
    const nextAllowedAt = triggerNextTouchAt.get(definition.entityIndex) ?? -Infinity;
    if (timestamp < nextAllowedAt) return false;
    if (definition.oneShot) {
      triggerNextTouchAt.set(definition.entityIndex, Infinity);
    } else if (definition.waitMs > 0) {
      triggerNextTouchAt.set(definition.entityIndex, timestamp + definition.waitMs);
    }
    return true;
  }

  function scheduleTargetDispatch(
    definition: QuakeMultiplayerLoopbackTargetDispatchSource,
    playerId: string,
    sourceEventId: string,
    cascadeDepth = 0,
    dispatchDelayMs = definition.delayMs,
  ): void {
    const dispatch = (): void => {
      targetDispatchTimers.delete(sourceEventId);
      if (!roomKey || matchStatus !== "active") return;
      for (const entityIndex of definition.killtargetEntityIndexes ?? []) {
        removeKilltargetEntity(entityIndex);
      }
      emitRoomEvent({
        eventType: "world.targets",
        eventId: `targets-${sourceEventId}`,
        roomTime: currentRoomTime(),
        sourceEventId,
        sourceEntityIndex: definition.entityIndex,
        playerId,
        targetEntityIndexes: definition.targetEntityIndexes,
        ...(definition.killtargetEntityIndexes ? { killtargetEntityIndexes: definition.killtargetEntityIndexes } : {}),
        delayMs: definition.delayMs,
        ...(definition.message ? { message: definition.message } : {}),
        ...(definition.soundPath ? { soundPath: definition.soundPath } : {}),
      });
      activateTargetReceivers(definition.targetEntityIndexes, playerId, sourceEventId, cascadeDepth + 1);
    };
    if (dispatchDelayMs <= 0) {
      dispatch();
      return;
    }
    const timer = setTimeout(dispatch, dispatchDelayMs);
    targetDispatchTimers.set(sourceEventId, timer);
    unrefTimer(timer);
  }

  function removeWorldDefinition(entityIndex: number): void {
    worldDefinitions.delete(entityIndex);
    teleportActiveUntilByEntity.delete(entityIndex);
    triggerCounterRemaining.delete(entityIndex);
    triggerShootHealth.delete(entityIndex);
    moverStates.delete(entityIndex);
    moverShootHealth.delete(entityIndex);
    clearMoverStateTimers(entityIndex);
  }

  function removeKilltargetEntity(entityIndex: number): void {
    removeWorldDefinition(entityIndex);
    pickupStates.delete(entityIndex);
    const pickupTimer = pickupRespawnTimers.get(entityIndex);
    if (pickupTimer) clearTimeout(pickupTimer);
    pickupRespawnTimers.delete(entityIndex);
  }

  function pickupTargetDispatchSource(
    definition: QuakeMultiplayerPickupDefinition,
  ): QuakeMultiplayerLoopbackTargetDispatchSource | null {
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

  function activateTargetReceivers(
    entityIndexes: readonly number[],
    playerId: string,
    sourceEventId: string,
    cascadeDepth: number,
  ): void {
    if (cascadeDepth > 8) return;
    for (const entityIndex of entityIndexes) {
      const definition = worldDefinitions.get(entityIndex);
      if (definition?.kind === "trigger" && definition.useActivates) {
        activateTargetTrigger(definition, playerId, sourceEventId, cascadeDepth);
      } else if (definition?.kind === "teleport" && definition.touchRequiresActivation) {
        activateTargetTeleport(definition, playerId, sourceEventId);
      } else if (definition?.kind === "mover" && definition.useActivates) {
        activateMover(definition, playerId, `mover-${sourceEventId}-${definition.entityIndex}`, cascadeDepth, "target");
      }
    }
  }

  function activateTargetTeleport(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "teleport" }>,
    playerId: string,
    sourceEventId: string,
  ): void {
    const activeForMs = definition.activationWindowMs ?? QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS;
    teleportActiveUntilByEntity.set(definition.entityIndex, now() + activeForMs);
    emitRoomEvent({
      eventType: "world.use",
      eventId: `teleport-use-${sourceEventId}-${definition.entityIndex}`,
      roomTime: currentRoomTime(),
      playerId,
      entityIndex: definition.entityIndex,
    });
  }

  function activateTargetTrigger(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>,
    playerId: string,
    sourceEventId: string,
    cascadeDepth: number,
  ): void {
    if (definition.classname === "trigger_counter") {
      const previous = triggerCounterRemaining.get(definition.entityIndex) ?? Math.max(0, definition.count ?? 2);
      if (previous <= 0) return;
      const remaining = Math.max(0, previous - 1);
      triggerCounterRemaining.set(definition.entityIndex, remaining);
      const complete = remaining === 0;
      const eventId = `trigger-${sourceEventId}-${definition.entityIndex}-${previous}`;
      emitTargetTriggerEvent(definition, playerId, eventId, remaining, complete);
      if (!complete) return;
      if (definition.oneShot) removeWorldDefinition(definition.entityIndex);
      scheduleTargetDispatch(definition, playerId, eventId, cascadeDepth);
      return;
    }
    if (quakeMultiplayerTriggerUsesMultiTrigger(definition)) {
      if (!acceptTriggerTouch(definition, now())) return;
      const eventId = `trigger-${sourceEventId}-${definition.entityIndex}`;
      if (definition.oneShot) removeWorldDefinition(definition.entityIndex);
      emitTargetTriggerEvent(definition, playerId, eventId, undefined, true);
      scheduleTargetDispatch(definition, playerId, eventId, cascadeDepth);
      return;
    }
    if (definition.classname !== "trigger_relay") return;
    const eventId = `trigger-${sourceEventId}-${definition.entityIndex}`;
    emitTargetTriggerEvent(definition, playerId, eventId, undefined, true);
    scheduleTargetDispatch(definition, playerId, eventId, cascadeDepth);
  }

  function activateMover(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    playerId: string,
    eventId: string,
    cascadeDepth: number,
    activation: "touch" | "target" | "shoot",
  ): void {
    if (definition.classname !== "func_button") return;
    const state = moverStates.get(definition.entityIndex) ?? "bottom";
    if (state === "moving-up" || state === "top") return;
    moverStates.set(definition.entityIndex, "moving-up");
    clearMoverStateTimers(definition.entityIndex);
    emitMoverEvent(definition, playerId, eventId, activation, "moving-up");
    scheduleMoverStateTransition(definition, playerId, eventId, activation, "top", definition.moveMs);
    if (definition.returnDelayMs !== undefined) {
      scheduleMoverStateTransition(
        definition,
        playerId,
        eventId,
        activation,
        "moving-down",
        definition.moveMs + definition.returnDelayMs,
      );
      scheduleMoverStateTransition(
        definition,
        playerId,
        eventId,
        activation,
        "bottom",
        definition.moveMs + definition.returnDelayMs + definition.moveMs,
      );
    }
    scheduleTargetDispatch(definition, playerId, eventId, cascadeDepth, definition.moveMs + definition.delayMs);
  }

  function emitMoverEvent(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    playerId: string,
    eventId: string,
    activation: "touch" | "target" | "shoot",
    state: QuakeMultiplayerLoopbackMoverState,
  ): void {
    const [fromOrigin, toOrigin] = quakeMultiplayerMoverStateOrigins(definition, state);
    emitRoomEvent({
      eventType: "world.mover",
      eventId,
      roomTime: currentRoomTime(),
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

  function quakeMultiplayerMoverStateOrigins(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    state: QuakeMultiplayerLoopbackMoverState,
  ): [typeof definition.fromOrigin, typeof definition.toOrigin] {
    if (state === "top") return [definition.toOrigin, definition.toOrigin];
    if (state === "moving-down") return [definition.toOrigin, definition.fromOrigin];
    if (state === "bottom") return [definition.fromOrigin, definition.fromOrigin];
    return [definition.fromOrigin, definition.toOrigin];
  }

  function applyShootableMoverDamage(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    playerId: string,
    eventId: string,
    damage: number,
  ): boolean {
    if (!definition.shootActivates) return false;
    const state = moverStates.get(definition.entityIndex) ?? "bottom";
    if (state === "moving-up" || state === "top") return true;
    const maxHealth = Math.max(1, Math.round(definition.shootHealth ?? 1));
    const previousHealth = moverShootHealth.get(definition.entityIndex) ?? maxHealth;
    const remaining = previousHealth - Math.max(0, damage);
    if (remaining > 0) {
      moverShootHealth.set(definition.entityIndex, remaining);
      return true;
    }
    moverShootHealth.set(definition.entityIndex, maxHealth);
    activateMover(definition, playerId, eventId, 0, "shoot");
    return true;
  }

  function applyShootableTriggerDamage(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "trigger" }>,
    playerId: string,
    eventId: string,
    damage: number,
  ): boolean {
    if (!definition.shootActivates) return false;
    const timestamp = now();
    const nextAllowedAt = triggerNextTouchAt.get(definition.entityIndex) ?? -Infinity;
    if (timestamp < nextAllowedAt) return true;
    const maxHealth = Math.max(1, Math.round(definition.shootHealth ?? 1));
    const previousHealth = triggerShootHealth.get(definition.entityIndex) ?? maxHealth;
    const remaining = previousHealth - Math.max(0, damage);
    if (remaining > 0) {
      triggerShootHealth.set(definition.entityIndex, remaining);
      return true;
    }
    if (!acceptTriggerTouch(definition, timestamp)) return true;
    triggerShootHealth.set(definition.entityIndex, maxHealth);
    if (definition.oneShot) removeWorldDefinition(definition.entityIndex);
    emitTargetTriggerEvent(definition, playerId, eventId, undefined, true, "shoot");
    scheduleTargetDispatch(definition, playerId, eventId);
    return true;
  }

  function scheduleMoverStateTransition(
    definition: Extract<QuakeMultiplayerWorldDefinition, { kind: "mover" }>,
    playerId: string,
    sourceEventId: string,
    activation: "touch" | "target" | "shoot",
    state: QuakeMultiplayerLoopbackMoverState,
    delayMs: number,
  ): void {
    const entityIndex = definition.entityIndex;
    const key = `${entityIndex}:${state}`;
    const timer = setTimeout(() => {
      moverStateTimers.delete(key);
      if (!worldDefinitions.has(entityIndex)) return;
      moverStates.set(entityIndex, state);
      emitMoverEvent(definition, playerId, `${sourceEventId}-${state}`, activation, state);
    }, Math.max(0, delayMs));
    moverStateTimers.set(key, timer);
    unrefTimer(timer);
  }

  function clearMoverStateTimers(entityIndex: number): void {
    for (const [key, timer] of moverStateTimers) {
      if (!key.startsWith(`${entityIndex}:`)) continue;
      clearTimeout(timer);
      moverStateTimers.delete(key);
    }
  }

  function emitTargetTriggerEvent(
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
    emitRoomEvent({
      eventType: "world.trigger",
      eventId,
      roomTime: currentRoomTime(),
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

  function acceptActiveMatchIntent(rejectedMessageId: string): boolean {
    const endedByTimeLimit = enterIntermissionIfTimeLimitReached(rejectedMessageId);
    if (endedByTimeLimit) emitSnapshot();
    if (matchStatus === "active") return true;
    rejectInactiveMatchIntent(rejectedMessageId);
    return false;
  }

  function rejectInactiveMatchIntent(rejectedMessageId: string): void {
    emitReject({
      code: "unsupported",
      message: "Multiplayer match is not active.",
      recoverable: true,
      rejectedMessageId,
    });
  }

  function acceptActivePresenceIntent(rejectedMessageId: string): boolean {
    if (quakeMultiplayerPresenceAcceptsInput(presenceStatus)) return true;
    pauseLoopbackPlayerSimulation();
    emitReject({
      code: "unsupported",
      message: "Multiplayer player input is paused.",
      recoverable: true,
      rejectedMessageId,
    });
    return false;
  }

  function emitRoomEvent(event: QuakeMultiplayerRoomEventPayload["event"]): void {
    if (!roomKey) return;
    tick += 1;
    worldEventSequence += 1;
    emitRoomEnvelope("room.event", {
      roomId,
      tick,
      sequence: worldEventSequence,
      event,
    });
  }

  function emitReject(payload: QuakeMultiplayerRoomRejectPayload): void {
    emitRoomEnvelope("room.reject", payload);
  }

  function emitRoomEnvelope<TType extends QuakeMultiplayerRoomMessageType>(
    type: TType,
    payload: RoomPayloadFor<TType>,
  ): void {
    if (!roomKey) return;
    const message = createQuakeMultiplayerEnvelope({
      direction: "room",
      type,
      roomKey,
      sequence: ++roomSequence,
      sentAt: now(),
      payload,
    }) as QuakeMultiplayerRoomEnvelope;
    emit(message);
  }

  function emit(message: QuakeMultiplayerRoomEnvelope): void {
    const dispatch = (): void => {
      for (const listener of listeners) listener(message);
    };
    if (options.asyncDispatch === false) {
      dispatch();
    } else {
      Promise.resolve().then(dispatch);
    }
  }

  function currentRoomTime(): number {
    const connectedAt = currentStatus.connectedAt ?? now();
    return Math.max(0, now() - connectedAt);
  }

  return adapter;
}

type RoomPayloadFor<TType extends QuakeMultiplayerRoomMessageType> =
  Extract<QuakeMultiplayerRoomEnvelope, { type: TType }>["payload"];

function createLoopbackPlayerState(
  roomKey: QuakeMultiplayerRoomCompatibilityKey,
  clientId: string,
  displayName: string,
  color: string | undefined,
  updatedAt: number,
  spawn?: QuakeMultiplayerSpawnPoint,
): QuakeMultiplayerAuthoritativePlayerState {
  const inventory = createQuakeMultiplayerInitialInventory();
  return {
    playerId: loopbackPlayerId(clientId),
    clientId,
    displayName,
    ...(color ? { color } : {}),
    mapName: roomKey.mapName,
    ...(spawn ? { spawnId: spawn.spawnId } : {}),
    origin: spawn?.origin ?? [0, 0, 0],
    velocity: [0, 0, 0],
    rotX: spawn?.rotX ?? 0,
    rotY: spawn?.rotY ?? 0,
    health: inventory.health,
    armor: inventory.armor,
    activeWeapon: inventory.activeWeapon,
    inventory,
    alive: true,
    frags: 0,
    deaths: 0,
    lastInputSequence: 0,
    updatedAt,
  };
}

function quakeLoopbackInitialSpawnPoint(
  spawns: readonly QuakeMultiplayerSpawnPoint[] | undefined,
): QuakeMultiplayerSpawnPoint | undefined {
  return spawns?.length ? quakeMultiplayerDeathmatchSpawnOrder(spawns)[0] : undefined;
}

function createLoopbackPlayerStateFromPose(
  roomKey: QuakeMultiplayerRoomCompatibilityKey,
  clientId: string,
  displayName: string,
  color: string | undefined,
  pose: QuakeMultiplayerPoseSample,
  previous: QuakeMultiplayerAuthoritativePlayerState | null,
  updatedAt: number,
): QuakeMultiplayerAuthoritativePlayerState {
  const inventory = previous?.inventory ?? createQuakeMultiplayerInitialInventory();
  return {
    playerId: previous?.playerId ?? loopbackPlayerId(clientId),
    clientId,
    displayName,
    ...(color ?? previous?.color ? { color: color ?? previous?.color } : {}),
    mapName: roomKey.mapName,
    origin: pose.origin,
    velocity: pose.velocity ?? [0, 0, 0],
    rotX: pose.rotX,
    rotY: pose.rotY,
    health: inventory.health,
    armor: inventory.armor,
    activeWeapon: inventory.activeWeapon,
    inventory,
    alive: pose.alive,
    frags: previous?.frags ?? 0,
    deaths: previous?.deaths ?? 0,
    lastInputSequence: previous?.lastInputSequence ?? 0,
    updatedAt,
  };
}

const QUAKE_LOOPBACK_DEFAULT_REMOTE_CLIENT_ID = "loopback-remote";
const QUAKE_LOOPBACK_DEFAULT_REMOTE_PLAYER_ID = "loopback:remote";

function createLoopbackDefaultSimulatedPlayer(
  roomKey: QuakeMultiplayerRoomCompatibilityKey,
  localPlayer: QuakeMultiplayerAuthoritativePlayerState,
  updatedAt: number,
): QuakeMultiplayerAuthoritativePlayerState {
  const inventory = createQuakeMultiplayerInitialInventory();
  const t = updatedAt / 1000;
  const orbitRadius = 1.6;
  const angularSpeed = 0.8;
  return {
    playerId: QUAKE_LOOPBACK_DEFAULT_REMOTE_PLAYER_ID,
    clientId: QUAKE_LOOPBACK_DEFAULT_REMOTE_CLIENT_ID,
    displayName: "Loopback",
    color: "#6fb7d8",
    mapName: roomKey.mapName,
    origin: [
      localPlayer.origin[0] + Math.cos(t * angularSpeed) * orbitRadius,
      localPlayer.origin[1] + Math.sin(t * angularSpeed) * orbitRadius,
      localPlayer.origin[2],
    ],
    velocity: [
      -Math.sin(t * angularSpeed) * orbitRadius * angularSpeed,
      Math.cos(t * angularSpeed) * orbitRadius * angularSpeed,
      0,
    ],
    rotX: localPlayer.rotX,
    rotY: (localPlayer.rotY + 180) % 360,
    health: inventory.health,
    armor: inventory.armor,
    activeWeapon: inventory.activeWeapon,
    inventory,
    alive: true,
    frags: 0,
    deaths: 0,
    lastInputSequence: 0,
    updatedAt,
  };
}

function loopbackPlayerId(clientId: string): string {
  return `loopback:${clientId}`;
}

function playerSimulationStateHasInput(state: QuakeMultiplayerRoomPlayerSimulationState | null): boolean {
  return Boolean(
    state &&
      (state.lastAcceptedInputSequence > 0 ||
        state.lastAcceptedInput ||
        state.pendingInputs.length > 0),
  );
}

function quakeMultiplayerPresenceAcceptsInput(status: QuakeMultiplayerPlayerPresenceStatus): boolean {
  return status === "active";
}

function clearTimers<TKey>(timers: Map<TKey, ReturnType<typeof setTimeout>>): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

function unrefTimer(timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>): void {
  (timer as { unref?: () => void }).unref?.();
}
