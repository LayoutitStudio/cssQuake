import type { QuakeEntity, QuakeScene } from "../../types/quake";
import type { QuakeCollisionWorld } from "../collision";
import {
  COLLISION_EPSILON,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  QUAKE_PLAYER_VIEW_Z,
} from "../constants";
import { quakePlayerWaterLevel } from "../hazards";
import type {
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerClientDamageEnvelope,
  QuakeMultiplayerFireDecisionReason,
  QuakeMultiplayerFireIntent,
  QuakeMultiplayerRoomRejectPayload,
  QuakeMultiplayerSpawnPoint,
  QuakeMultiplayerVec3,
} from "./protocol";

export const QUAKE_MULTIPLAYER_DEATHMATCH_RESPAWN_DELAY_MS = 2_000;

const QUAKE_MULTIPLAYER_DEATHMATCH_SHOTGUN_DAMAGE = 24;
const QUAKE_MULTIPLAYER_DEATHMATCH_SUPER_SHOTGUN_DAMAGE = 56;
const QUAKE_MULTIPLAYER_DEATHMATCH_AXE_DAMAGE = 20;
const QUAKE_MULTIPLAYER_DEATHMATCH_NAIL_DAMAGE = 9;
const QUAKE_MULTIPLAYER_DEATHMATCH_SUPER_NAIL_DAMAGE = 18;
const QUAKE_MULTIPLAYER_DEATHMATCH_ROCKET_DAMAGE = 120;
const QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_DAMAGE = 30;
const QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_DISCHARGE_DAMAGE_PER_CELL = 35;
const QUAKE_MULTIPLAYER_DEATHMATCH_RADIUS_DAMAGE_EXTRA_RANGE = 40;
const QUAKE_MULTIPLAYER_DEATHMATCH_SHOTGUN_COOLDOWN_MS = 500;
const QUAKE_MULTIPLAYER_DEATHMATCH_SUPER_SHOTGUN_COOLDOWN_MS = 700;
const QUAKE_MULTIPLAYER_DEATHMATCH_AXE_COOLDOWN_MS = 500;
const QUAKE_MULTIPLAYER_DEATHMATCH_NAIL_COOLDOWN_MS = 200;
const QUAKE_MULTIPLAYER_DEATHMATCH_GRENADE_COOLDOWN_MS = 600;
const QUAKE_MULTIPLAYER_DEATHMATCH_ROCKET_COOLDOWN_MS = 800;
const QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_COOLDOWN_MS = 200;
const QUAKE_MULTIPLAYER_DEATHMATCH_HIT_RADIUS = 0.7;
const QUAKE_MULTIPLAYER_DEATHMATCH_PROJECTILE_HIT_RADIUS = 0.95;
const QUAKE_MULTIPLAYER_DEATHMATCH_HITSCAN_RANGE = 2048 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_DEATHMATCH_NAIL_RANGE = 1000 * 6 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_DEATHMATCH_GRENADE_RANGE = 600 * 2.5 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_DEATHMATCH_ROCKET_RANGE = 1000 * 5 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_RANGE = 600 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_DEATHMATCH_MELEE_RANGE = 2.1;
const QUAKE_MULTIPLAYER_DEATHMATCH_MIN_FIRE_DIRECTION_LENGTH = 0.5;
const QUAKE_MULTIPLAYER_DEATHMATCH_CAN_DAMAGE_OFFSET = 15 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_DEATHMATCH_TARGET_LOS_MIN_TRACE_FRACTION = 0.95;
const QUAKE_MULTIPLAYER_DEATHMATCH_FIRE_ORIGIN_HINT_MAX_HORIZONTAL_DRIFT = 3;
const QUAKE_MULTIPLAYER_DEATHMATCH_FIRE_ORIGIN_HINT_MAX_VERTICAL_DRIFT = 8;
const QUAKE_MULTIPLAYER_DEATHMATCH_REMOTE_RENDER_REWIND_MS = 100;
const QUAKE_MULTIPLAYER_DEATHMATCH_MAX_REWIND_MS = 250;
const QUAKE_MULTIPLAYER_DEATHMATCH_SPAWN_CLEAR_RADIUS = 84 * QUAKE_COLLISION_UNIT_SCALE;

export interface QuakeMultiplayerDeathmatchSpawnOptions {
  pointToPoly(point: { x: number; y: number; z: number }): QuakeMultiplayerVec3;
  playerEyeHeight: number;
  playerMinsZ: number;
}

export interface QuakeMultiplayerDeathmatchHitOptions {
  targetRewindMs?: number;
}

export interface QuakeMultiplayerDeathmatchHit {
  target: QuakeMultiplayerAuthoritativePlayerState;
  damage: number;
  distance: number;
  impact: QuakeMultiplayerVec3;
  lateralMiss: number;
}

export interface QuakeMultiplayerDeathmatchVisibleHitDecision {
  blockedCandidateCount: number;
  candidateCount: number;
  hit: QuakeMultiplayerDeathmatchHit | null;
  reason: Extract<QuakeMultiplayerFireDecisionReason, "line-of-sight-blocked" | "no-candidate" | "player-direct">;
}

export interface QuakeMultiplayerDeathmatchSplashHit extends QuakeMultiplayerDeathmatchHit {
  direct: boolean;
}

export interface QuakeMultiplayerDeathmatchProjectileImpact {
  distance: number;
  origin: QuakeMultiplayerVec3;
}

export interface QuakeMultiplayerDeathmatchLightningDischargeHit {
  target: QuakeMultiplayerAuthoritativePlayerState;
  damage: number;
  distance: number;
  selfDamage: boolean;
}

export interface QuakeMultiplayerDeathmatchLightningDischarge {
  cells: number;
  damage: number;
  radius: number;
  waterLevel: number;
  hits: QuakeMultiplayerDeathmatchLightningDischargeHit[];
}

export interface QuakeMultiplayerDeathmatchDamageMomentumOptions {
  damage: number;
  inflictorOrigin?: QuakeMultiplayerVec3 | null;
  player: QuakeMultiplayerAuthoritativePlayerState;
}

export interface QuakeMultiplayerDeathmatchSpawnSelection {
  nextCursor: number;
  spawn: QuakeMultiplayerSpawnPoint;
}

export interface QuakeMultiplayerDeathmatchSpawnSelectionOptions {
  random?: () => number;
}

export function quakeMultiplayerDeathmatchSpawnsFromScene(
  scene: QuakeScene,
  options: QuakeMultiplayerDeathmatchSpawnOptions,
): QuakeMultiplayerSpawnPoint[] {
  const deathmatchSpawns = scene.entities
    .filter((entity) => entity.classname === "info_player_deathmatch")
    .map((entity) => quakeMultiplayerSpawnPointFromEntity(entity, options))
    .filter((spawn): spawn is QuakeMultiplayerSpawnPoint => Boolean(spawn));
  if (deathmatchSpawns.length) return deathmatchSpawns;
  return [{
    spawnId: "spawn:singleplayer:start",
    classname: "info_player_start",
    origin: scene.spawn.origin,
    rotX: scene.spawn.rotX,
    rotY: scene.spawn.rotY,
  }];
}

export function quakeMultiplayerDeathmatchSpawnOrder(
  spawns: readonly QuakeMultiplayerSpawnPoint[],
): QuakeMultiplayerSpawnPoint[] {
  return [...spawns];
}

export function quakeMultiplayerDeathmatchSelectSpawnPoint(
  spawns: readonly QuakeMultiplayerSpawnPoint[],
  players: Iterable<Pick<QuakeMultiplayerAuthoritativePlayerState, "origin">>,
  cursorOrOptions: number | QuakeMultiplayerDeathmatchSpawnSelectionOptions = {},
): QuakeMultiplayerDeathmatchSpawnSelection | null {
  if (!spawns.length) return null;
  const playerList = [...players];
  const options = typeof cursorOrOptions === "number" ? {} : cursorOrOptions;
  const random = options.random ?? Math.random;
  const clearSpawns: QuakeMultiplayerSpawnPoint[] = [];
  for (const spawn of spawns) {
    if (quakeMultiplayerDeathmatchSpawnIsClear(spawn, playerList)) clearSpawns.unshift(spawn);
  }
  const candidates = clearSpawns.length ? clearSpawns : [...spawns];
  const spawn = candidates[quakeMultiplayerDeathmatchRandomSpawnIndex(candidates.length, random)] ?? candidates[0];
  const sourceIndex = Math.max(0, spawns.indexOf(spawn));
  return { spawn, nextCursor: sourceIndex + 1 };
}

function quakeMultiplayerSpawnPointFromEntity(
  entity: QuakeEntity,
  options: QuakeMultiplayerDeathmatchSpawnOptions,
): QuakeMultiplayerSpawnPoint | null {
  if (!entity.origin) return null;
  const origin = options.pointToPoly(entity.origin);
  return {
    spawnId: `entity:${entity.index}`,
    classname: entity.classname as QuakeMultiplayerSpawnPoint["classname"],
    origin: [
      origin[0],
      origin[1],
      origin[2] + options.playerMinsZ + options.playerEyeHeight,
    ],
    rotX: 90,
    rotY: quakeMultiplayerSpawnYaw(entity),
    sourceEntityIndex: entity.index,
  };
}

function quakeMultiplayerSpawnYaw(entity: QuakeEntity): number {
  const value = typeof entity.angle === "number"
    ? entity.angle
    : Number(entity.properties.angle);
  const angle = Number.isFinite(value) ? value : 0;
  return (180 + angle + 360) % 360;
}

function quakeMultiplayerDeathmatchSpawnIsClear(
  spawn: QuakeMultiplayerSpawnPoint,
  players: readonly Pick<QuakeMultiplayerAuthoritativePlayerState, "origin">[],
): boolean {
  return players.every((player) =>
    distance3(spawn.origin, player.origin) > QUAKE_MULTIPLAYER_DEATHMATCH_SPAWN_CLEAR_RADIUS
  );
}

function quakeMultiplayerDeathmatchRandomSpawnIndex(count: number, random: () => number): number {
  if (count <= 1) return 0;
  const value = random();
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0;
  return Math.max(0, Math.min(count - 1, Math.round(normalized * (count - 1))));
}

export function quakeMultiplayerDeathmatchWeaponDamage(weapon: string): number {
  const normalized = weapon.trim().toLowerCase();
  if (normalized === "axe") return QUAKE_MULTIPLAYER_DEATHMATCH_AXE_DAMAGE;
  if (normalized === "shotgun") return QUAKE_MULTIPLAYER_DEATHMATCH_SHOTGUN_DAMAGE;
  if (normalized === "supershotgun") return QUAKE_MULTIPLAYER_DEATHMATCH_SUPER_SHOTGUN_DAMAGE;
  if (normalized === "nailgun") return QUAKE_MULTIPLAYER_DEATHMATCH_NAIL_DAMAGE;
  if (normalized === "supernailgun") return QUAKE_MULTIPLAYER_DEATHMATCH_SUPER_NAIL_DAMAGE;
  if (normalized === "grenadelauncher" || normalized === "rocketlauncher") return QUAKE_MULTIPLAYER_DEATHMATCH_ROCKET_DAMAGE;
  if (normalized === "lightning") return QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_DAMAGE;
  return 0;
}

export function quakeMultiplayerDeathmatchLagCompensationMs(
  attacker: Pick<QuakeMultiplayerAuthoritativePlayerState, "pingMs">,
): number {
  const pingMs = Number.isFinite(attacker.pingMs) && attacker.pingMs !== undefined
    ? Math.max(0, attacker.pingMs)
    : 0;
  return Math.min(
    QUAKE_MULTIPLAYER_DEATHMATCH_MAX_REWIND_MS,
    QUAKE_MULTIPLAYER_DEATHMATCH_REMOTE_RENDER_REWIND_MS + pingMs * 0.5,
  );
}

export function quakeMultiplayerDeathmatchWeaponCooldownMs(weapon: string): number {
  const normalized = weapon.trim().toLowerCase();
  if (normalized === "axe") return QUAKE_MULTIPLAYER_DEATHMATCH_AXE_COOLDOWN_MS;
  if (normalized === "shotgun") return QUAKE_MULTIPLAYER_DEATHMATCH_SHOTGUN_COOLDOWN_MS;
  if (normalized === "supershotgun") return QUAKE_MULTIPLAYER_DEATHMATCH_SUPER_SHOTGUN_COOLDOWN_MS;
  if (normalized === "nailgun" || normalized === "supernailgun") return QUAKE_MULTIPLAYER_DEATHMATCH_NAIL_COOLDOWN_MS;
  if (normalized === "grenadelauncher") return QUAKE_MULTIPLAYER_DEATHMATCH_GRENADE_COOLDOWN_MS;
  if (normalized === "rocketlauncher") return QUAKE_MULTIPLAYER_DEATHMATCH_ROCKET_COOLDOWN_MS;
  if (normalized === "lightning") return QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_COOLDOWN_MS;
  return Infinity;
}

export function quakeMultiplayerDeathmatchFragDeltaForKill(input: {
  attackerPlayerId?: string;
  victimPlayerId: string;
}): number {
  if (!input.attackerPlayerId) return -1;
  return input.attackerPlayerId === input.victimPlayerId ? -1 : 1;
}

export function quakeMultiplayerDeathmatchFireFromPlayer(
  player: QuakeMultiplayerAuthoritativePlayerState,
  fire: QuakeMultiplayerFireIntent,
): QuakeMultiplayerFireIntent {
  const weapon = player.inventory?.activeWeapon ?? player.activeWeapon;
  const direction = normalizedFireDirection(fire.direction) ??
    quakeMultiplayerDeathmatchForwardDirection(player.rotX, player.rotY);
  return {
    ...fire,
    weapon,
    fireKind: quakeMultiplayerDeathmatchFireKindForWeapon(weapon),
    range: quakeMultiplayerDeathmatchFireRangeForWeapon(weapon),
    origin: quakeMultiplayerDeathmatchFireOrigin(player.origin, fire.origin),
    direction,
  };
}

export function quakeMultiplayerDeathmatchFireKindForWeapon(
  weapon: string,
): QuakeMultiplayerFireIntent["fireKind"] {
  const normalized = weapon.trim().toLowerCase();
  if (normalized === "axe") return "melee";
  if (
    normalized === "nailgun" ||
    normalized === "supernailgun" ||
    normalized === "grenadelauncher" ||
    normalized === "rocketlauncher"
  ) return "projectile";
  if (normalized === "lightning") return "beam";
  return "hitscan";
}

export function quakeMultiplayerDeathmatchFireRangeForWeapon(weapon: string): number {
  const normalized = weapon.trim().toLowerCase();
  if (normalized === "axe") return QUAKE_MULTIPLAYER_DEATHMATCH_MELEE_RANGE;
  if (normalized === "nailgun" || normalized === "supernailgun") return QUAKE_MULTIPLAYER_DEATHMATCH_NAIL_RANGE;
  if (normalized === "grenadelauncher") return QUAKE_MULTIPLAYER_DEATHMATCH_GRENADE_RANGE;
  if (normalized === "rocketlauncher") return QUAKE_MULTIPLAYER_DEATHMATCH_ROCKET_RANGE;
  if (normalized === "lightning") return QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_RANGE;
  return QUAKE_MULTIPLAYER_DEATHMATCH_HITSCAN_RANGE;
}

export function rejectQuakeMultiplayerClientDamageIntent(
  message: QuakeMultiplayerClientDamageEnvelope,
): QuakeMultiplayerRoomRejectPayload {
  return {
    code: "unsupported",
    message: `Client-originated damage "${message.payload.damage.source}" is not authoritative yet.`,
    recoverable: true,
    rejectedMessageId: message.messageId,
  };
}

export function quakeMultiplayerDeathmatchHitscanHit(
  fire: QuakeMultiplayerFireIntent,
  players: Iterable<QuakeMultiplayerAuthoritativePlayerState>,
  attackerPlayerId: string,
): QuakeMultiplayerDeathmatchHit | null {
  return quakeMultiplayerDeathmatchHitscanHits(fire, players, attackerPlayerId)[0] ?? null;
}

export function quakeMultiplayerDeathmatchVisibleHit(
  fire: QuakeMultiplayerFireIntent,
  players: Iterable<QuakeMultiplayerAuthoritativePlayerState>,
  attackerPlayerId: string,
  collisionWorld: Pick<QuakeCollisionWorld, "traceUse"> | null | undefined,
  options: QuakeMultiplayerDeathmatchHitOptions = {},
): QuakeMultiplayerDeathmatchHit | null {
  return quakeMultiplayerDeathmatchVisibleHitDecision(fire, players, attackerPlayerId, collisionWorld, options).hit;
}

export function quakeMultiplayerDeathmatchVisibleHitDecision(
  fire: QuakeMultiplayerFireIntent,
  players: Iterable<QuakeMultiplayerAuthoritativePlayerState>,
  attackerPlayerId: string,
  collisionWorld: Pick<QuakeCollisionWorld, "traceUse"> | null | undefined,
  options: QuakeMultiplayerDeathmatchHitOptions = {},
): QuakeMultiplayerDeathmatchVisibleHitDecision {
  const hits = quakeMultiplayerDeathmatchHitscanHits(fire, players, attackerPlayerId, options);
  let blockedCandidateCount = 0;
  for (const hit of hits) {
    if (quakeMultiplayerDeathmatchHitHasLineOfSight(fire, hit, collisionWorld)) {
      return {
        blockedCandidateCount,
        candidateCount: hits.length,
        hit,
        reason: "player-direct",
      };
    }
    blockedCandidateCount += 1;
  }
  return {
    blockedCandidateCount,
    candidateCount: hits.length,
    hit: null,
    reason: hits.length > 0 ? "line-of-sight-blocked" : "no-candidate",
  };
}

export function quakeMultiplayerDeathmatchHitscanHits(
  fire: QuakeMultiplayerFireIntent,
  players: Iterable<QuakeMultiplayerAuthoritativePlayerState>,
  attackerPlayerId: string,
  options: QuakeMultiplayerDeathmatchHitOptions = {},
): QuakeMultiplayerDeathmatchHit[] {
  if (
    fire.fireKind !== "hitscan" &&
    fire.fireKind !== "projectile" &&
    fire.fireKind !== "beam" &&
    fire.fireKind !== "melee"
  ) return [];
  const damage = quakeMultiplayerDeathmatchWeaponDamage(fire.weapon);
  if (damage <= 0) return [];
  const direction = normalizedFireDirection(fire.direction);
  if (!direction) return [];
  const maxRange = quakeMultiplayerDeathmatchFireRange(fire);
  const hitRadius = fire.fireKind === "projectile"
    ? QUAKE_MULTIPLAYER_DEATHMATCH_PROJECTILE_HIT_RADIUS
    : QUAKE_MULTIPLAYER_DEATHMATCH_HIT_RADIUS;
  const hits: QuakeMultiplayerDeathmatchHit[] = [];
  for (const player of players) {
    if (player.playerId === attackerPlayerId || !player.alive) continue;
    const hit = quakeMultiplayerDeathmatchPlayerHit(
      fire.origin,
      direction,
      maxRange,
      player,
      damage,
      hitRadius,
      options.targetRewindMs,
    );
    if (!hit) continue;
    hits.push(hit);
  }
  hits.sort((left, right) => left.distance - right.distance);
  return hits;
}

export function quakeMultiplayerDeathmatchSplashHits(
  fire: QuakeMultiplayerFireIntent,
  directHit: QuakeMultiplayerDeathmatchHit,
  players: Iterable<QuakeMultiplayerAuthoritativePlayerState>,
  attackerPlayerId: string,
  collisionWorld?: Pick<QuakeCollisionWorld, "traceUse"> | null,
  options: QuakeMultiplayerDeathmatchHitOptions = {},
): QuakeMultiplayerDeathmatchSplashHit[] {
  if (fire.fireKind !== "projectile") return [{ ...directHit, direct: true }];
  if (!quakeMultiplayerDeathmatchWeaponHasSplash(fire.weapon)) return [{ ...directHit, direct: true }];
  const splashOrigin = directHit.impact;
  if (fire.weapon.trim().toLowerCase() === "grenadelauncher") {
    return quakeMultiplayerDeathmatchProjectileSplashHitsAtImpact(
      fire,
      splashOrigin,
      players,
      attackerPlayerId,
      collisionWorld,
      undefined,
      options,
    );
  }
  return [
    { ...directHit, damage: quakeMultiplayerDeathmatchDirectHitDamage(fire), direct: true },
    ...quakeMultiplayerDeathmatchProjectileSplashHitsAtImpact(
      fire,
      splashOrigin,
      players,
      attackerPlayerId,
      collisionWorld,
      directHit.target.playerId,
      options,
    ),
  ];
}

export function quakeMultiplayerDeathmatchProjectileWorldSplashHits(
  fire: QuakeMultiplayerFireIntent,
  players: Iterable<QuakeMultiplayerAuthoritativePlayerState>,
  attackerPlayerId: string,
  collisionWorld?: Pick<QuakeCollisionWorld, "traceUse"> | null,
  options: QuakeMultiplayerDeathmatchHitOptions = {},
): QuakeMultiplayerDeathmatchSplashHit[] {
  const impact = quakeMultiplayerDeathmatchProjectileWorldImpact(fire, collisionWorld);
  if (!impact) return [];
  return quakeMultiplayerDeathmatchProjectileSplashHitsAtImpact(
    fire,
    impact.origin,
    players,
    attackerPlayerId,
    collisionWorld,
    undefined,
    options,
  );
}

export function quakeMultiplayerDeathmatchProjectileSplashHitsAtImpact(
  fire: QuakeMultiplayerFireIntent,
  splashOrigin: QuakeMultiplayerVec3,
  players: Iterable<QuakeMultiplayerAuthoritativePlayerState>,
  attackerPlayerId: string,
  collisionWorld?: Pick<QuakeCollisionWorld, "traceUse"> | null,
  ignoredPlayerId?: string,
  options: QuakeMultiplayerDeathmatchHitOptions = {},
): QuakeMultiplayerDeathmatchSplashHit[] {
  if (fire.fireKind !== "projectile") return [];
  if (!quakeMultiplayerDeathmatchWeaponHasSplash(fire.weapon)) return [];
  const baseDamage = quakeMultiplayerDeathmatchWeaponDamage(fire.weapon);
  if (baseDamage <= 0) return [];
  const splashRadius = quakeMultiplayerDeathmatchSplashRadius(baseDamage);
  const hits: QuakeMultiplayerDeathmatchSplashHit[] = [];
  for (const player of players) {
    if (player.playerId === ignoredPlayerId || !player.alive) continue;
    const target = {
      ...player,
      origin: quakeMultiplayerDeathmatchRewoundPlayerOrigin(player, options.targetRewindMs),
    };
    if (!quakeMultiplayerDeathmatchRadiusDamageHasLineOfSight(splashOrigin, target, collisionWorld)) continue;
    const targetCenter = quakeMultiplayerDeathmatchPlayerDamageCenter(target);
    const distance = distance3(targetCenter, splashOrigin);
    if (distance > splashRadius) continue;
    const damage = quakeMultiplayerDeathmatchSplashDamage(
      baseDamage,
      distance,
      player.playerId,
      attackerPlayerId,
    );
    if (damage <= 0) continue;
    hits.push({
      target: player,
      damage,
      distance,
      impact: splashOrigin,
      lateralMiss: distance,
      direct: false,
    });
  }
  return hits;
}

export function quakeMultiplayerDeathmatchProjectileWorldImpact(
  fire: QuakeMultiplayerFireIntent,
  collisionWorld?: Pick<QuakeCollisionWorld, "traceUse"> | null,
): QuakeMultiplayerDeathmatchProjectileImpact | null {
  if (fire.fireKind !== "projectile") return null;
  if (!quakeMultiplayerDeathmatchWeaponHasSplash(fire.weapon)) return null;
  if (!collisionWorld?.traceUse) return null;
  const direction = normalizedFireDirection(fire.direction);
  if (!direction) return null;
  const maxRange = quakeMultiplayerDeathmatchFireRange(fire);
  if (maxRange <= 0) return null;
  const end: QuakeMultiplayerVec3 = [
    fire.origin[0] + direction[0] * maxRange,
    fire.origin[1] + direction[1] * maxRange,
    fire.origin[2] + direction[2] * maxRange,
  ];
  const trace = collisionWorld.traceUse(fire.origin, end);
  if (!trace) return null;
  const distance = distance3(fire.origin, trace.end);
  if (!Number.isFinite(distance) || distance > maxRange + 1e-6) return null;
  return {
    distance,
    origin: [trace.end[0], trace.end[1], trace.end[2]],
  };
}

export function quakeMultiplayerDeathmatchHitHasLineOfSight(
  fire: QuakeMultiplayerFireIntent,
  hit: QuakeMultiplayerDeathmatchHit,
  collisionWorld: Pick<QuakeCollisionWorld, "traceUse"> | null | undefined,
): boolean {
  if (!collisionWorld?.traceUse) return true;
  const trace = collisionWorld.traceUse(fire.origin, hit.impact);
  if (!trace) return true;
  const targetSkin = quakeMultiplayerDeathmatchTargetLosSkin(fire);
  return trace.fraction >= QUAKE_MULTIPLAYER_DEATHMATCH_TARGET_LOS_MIN_TRACE_FRACTION &&
    distance3(trace.end, hit.impact) <= targetSkin;
}

export function quakeMultiplayerDeathmatchLightningDischarge(input: {
  attacker: QuakeMultiplayerAuthoritativePlayerState;
  collisionWorld?: Pick<QuakeCollisionWorld, "contentsAt" | "traceUse"> | null;
  playerEyeHeight?: number;
  players: Iterable<QuakeMultiplayerAuthoritativePlayerState>;
}): QuakeMultiplayerDeathmatchLightningDischarge | null {
  const weapon = input.attacker.inventory?.activeWeapon ?? input.attacker.activeWeapon;
  if (weapon.trim().toLowerCase() !== "lightning") return null;
  const contentsAt = input.collisionWorld?.contentsAt;
  if (!input.attacker.alive || !contentsAt) return null;
  const cells = Math.floor(input.attacker.inventory?.cells ?? 0);
  if (cells < 1) return null;
  const playerEyeHeight = normalizePlayerEyeHeight(input.playerEyeHeight);
  const waterLevel = quakePlayerWaterLevel(
    contentsAt,
    input.attacker.origin as QuakeMultiplayerVec3,
    playerEyeHeight,
  );
  if (waterLevel <= 1) return null;

  const damage = QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_DISCHARGE_DAMAGE_PER_CELL * cells;
  const radius = (damage + QUAKE_MULTIPLAYER_DEATHMATCH_RADIUS_DAMAGE_EXTRA_RANGE) *
    QUAKE_COLLISION_UNIT_SCALE;
  const hits: QuakeMultiplayerDeathmatchLightningDischargeHit[] = [];
  for (const player of input.players) {
    if (!player.alive) continue;
    const targetCenter = quakeMultiplayerDeathmatchPlayerDamageCenter(player);
    const distance = distance3(input.attacker.origin, targetCenter);
    if (distance > radius) continue;
    if (!quakeMultiplayerDeathmatchRadiusDamageHasLineOfSight(
      input.attacker.origin,
      player,
      input.collisionWorld,
    )) continue;
    const selfDamage = player.playerId === input.attacker.playerId;
    const quakeDistance = distance / QUAKE_COLLISION_UNIT_SCALE;
    const points = Math.max(0, damage - 0.5 * quakeDistance);
    const finalDamage = selfDamage ? points * 0.5 : points;
    if (finalDamage <= 0) continue;
    hits.push({
      target: player,
      damage: finalDamage,
      distance,
      selfDamage,
    });
  }
  return {
    cells,
    damage,
    radius,
    waterLevel,
    hits,
  };
}

export function quakeMultiplayerDeathmatchPlayerWithDamageMomentum(
  options: QuakeMultiplayerDeathmatchDamageMomentumOptions,
): QuakeMultiplayerAuthoritativePlayerState {
  const damage = Number.isFinite(options.damage) ? Math.max(0, options.damage) : 0;
  if (damage <= 0 || !options.inflictorOrigin) return options.player;
  const direction = normalizedDamageDirection(options.player.origin, options.inflictorOrigin);
  if (!direction) return options.player;
  const impulse = damage * 8 * QUAKE_COLLISION_UNIT_SCALE;
  return {
    ...options.player,
    velocity: [
      options.player.velocity[0] + direction[0] * impulse,
      options.player.velocity[1] + direction[1] * impulse,
      options.player.velocity[2] + direction[2] * impulse,
    ],
  };
}

function quakeMultiplayerDeathmatchFireRange(fire: QuakeMultiplayerFireIntent): number {
  const maxRange = quakeMultiplayerDeathmatchFireRangeForWeapon(fire.weapon);
  if (fire.fireKind === "melee") return Math.min(maxRange, fire.range);
  return Math.min(
    maxRange,
    Number.isFinite(fire.range) && fire.range > 0 ? fire.range : maxRange,
  );
}

function quakeMultiplayerDeathmatchTargetLosSkin(fire: QuakeMultiplayerFireIntent): number {
  return fire.fireKind === "projectile"
    ? QUAKE_MULTIPLAYER_DEATHMATCH_PROJECTILE_HIT_RADIUS
    : QUAKE_MULTIPLAYER_DEATHMATCH_HIT_RADIUS;
}

function quakeMultiplayerDeathmatchFireOrigin(
  authoritativeOrigin: QuakeMultiplayerVec3,
  originHint: QuakeMultiplayerVec3,
): QuakeMultiplayerVec3 {
  return quakeMultiplayerDeathmatchFireOriginHintWithinDrift(authoritativeOrigin, originHint)
    ? originHint
    : authoritativeOrigin;
}

function quakeMultiplayerDeathmatchFireOriginHintWithinDrift(
  authoritativeOrigin: QuakeMultiplayerVec3,
  originHint: QuakeMultiplayerVec3,
): boolean {
  const horizontalDrift = Math.hypot(
    authoritativeOrigin[0] - originHint[0],
    authoritativeOrigin[1] - originHint[1],
  );
  const verticalDrift = Math.abs(authoritativeOrigin[2] - originHint[2]);
  return horizontalDrift <= QUAKE_MULTIPLAYER_DEATHMATCH_FIRE_ORIGIN_HINT_MAX_HORIZONTAL_DRIFT &&
    verticalDrift <= QUAKE_MULTIPLAYER_DEATHMATCH_FIRE_ORIGIN_HINT_MAX_VERTICAL_DRIFT;
}

function quakeMultiplayerDeathmatchWeaponHasSplash(weapon: string): boolean {
  const normalized = weapon.trim().toLowerCase();
  return normalized === "grenadelauncher" || normalized === "rocketlauncher";
}

function quakeMultiplayerDeathmatchSplashDamage(
  baseDamage: number,
  distance: number,
  playerId: string,
  attackerPlayerId: string,
): number {
  const quakeDistance = Math.max(0, distance / QUAKE_COLLISION_UNIT_SCALE);
  const points = Math.max(0, baseDamage - 0.5 * quakeDistance);
  const selfDamageScale = playerId === attackerPlayerId ? 0.5 : 1;
  return Math.round(points * selfDamageScale);
}

function quakeMultiplayerDeathmatchDirectHitDamage(fire: QuakeMultiplayerFireIntent): number {
  const normalized = fire.weapon.trim().toLowerCase();
  if (normalized !== "rocketlauncher") return quakeMultiplayerDeathmatchWeaponDamage(fire.weapon);
  return 100 + quakeMultiplayerDeathmatchFireRandom01(fire) * 20;
}

function quakeMultiplayerDeathmatchFireRandom01(fire: QuakeMultiplayerFireIntent): number {
  let value = Math.max(0, Math.floor(fire.fireSequence ?? 0)) || 1;
  value = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

function quakeMultiplayerDeathmatchSplashRadius(baseDamage: number): number {
  return Math.max(0, baseDamage + QUAKE_MULTIPLAYER_DEATHMATCH_RADIUS_DAMAGE_EXTRA_RANGE) *
    QUAKE_COLLISION_UNIT_SCALE;
}

function normalizePlayerEyeHeight(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? value
    : QUAKE_PLAYER_VIEW_Z - QUAKE_PLAYER_MINS_Z;
}

function quakeMultiplayerDeathmatchPlayerHit(
  origin: QuakeMultiplayerVec3,
  direction: QuakeMultiplayerVec3,
  maxRange: number,
  target: QuakeMultiplayerAuthoritativePlayerState,
  damage: number,
  hitRadius: number,
  rewindMs = 0,
): QuakeMultiplayerDeathmatchHit | null {
  const targetOrigin = quakeMultiplayerDeathmatchRewoundPlayerOrigin(target, rewindMs);
  const bounds = quakeMultiplayerDeathmatchPlayerHitBounds(targetOrigin, hitRadius);
  const trace = rayAabbIntersection(origin, direction, maxRange, bounds.min, bounds.max);
  if (!trace) return null;
  const center = quakeMultiplayerDeathmatchPlayerDamageCenter({ ...target, origin: targetOrigin });
  return {
    target,
    damage,
    distance: trace.distance,
    impact: trace.impact,
    lateralMiss: distance3(trace.impact, center),
  };
}

function quakeMultiplayerDeathmatchPlayerDamageCenter(
  player: QuakeMultiplayerAuthoritativePlayerState,
): QuakeMultiplayerVec3 {
  const eyeHeight = normalizePlayerEyeHeight(undefined);
  return [
    player.origin[0],
    player.origin[1],
    player.origin[2] - eyeHeight + PLAYER_HEIGHT * 0.5,
  ];
}

function quakeMultiplayerDeathmatchRewoundPlayerOrigin(
  player: QuakeMultiplayerAuthoritativePlayerState,
  rewindMs: number | undefined,
): QuakeMultiplayerVec3 {
  const clampedMs = Number.isFinite(rewindMs)
    ? Math.max(0, Math.min(QUAKE_MULTIPLAYER_DEATHMATCH_MAX_REWIND_MS, rewindMs ?? 0))
    : 0;
  if (clampedMs <= 0) return player.origin;
  const seconds = clampedMs / 1000;
  return [
    player.origin[0] - player.velocity[0] * seconds,
    player.origin[1] - player.velocity[1] * seconds,
    player.origin[2] - player.velocity[2] * seconds,
  ];
}

function quakeMultiplayerDeathmatchPlayerHitBounds(
  origin: QuakeMultiplayerVec3,
  hitRadius: number,
): { min: QuakeMultiplayerVec3; max: QuakeMultiplayerVec3 } {
  const eyeHeight = normalizePlayerEyeHeight(undefined);
  const horizontalSkin = Math.max(0, hitRadius - PLAYER_RADIUS);
  const verticalSkin = Math.max(0, hitRadius - PLAYER_RADIUS);
  const radius = PLAYER_RADIUS + horizontalSkin;
  const minZ = origin[2] - eyeHeight - verticalSkin;
  const maxZ = minZ + PLAYER_HEIGHT + verticalSkin * 2;
  return {
    min: [origin[0] - radius, origin[1] - radius, minZ],
    max: [origin[0] + radius, origin[1] + radius, maxZ],
  };
}

function quakeMultiplayerDeathmatchRadiusDamageHasLineOfSight(
  origin: QuakeMultiplayerVec3,
  target: QuakeMultiplayerAuthoritativePlayerState,
  collisionWorld: Pick<QuakeCollisionWorld, "traceUse"> | null | undefined,
): boolean {
  if (!collisionWorld?.traceUse) return true;
  const offset = QUAKE_MULTIPLAYER_DEATHMATCH_CAN_DAMAGE_OFFSET;
  const targetPoints: QuakeMultiplayerVec3[] = [
    target.origin,
    [target.origin[0] + offset, target.origin[1] + offset, target.origin[2]],
    [target.origin[0] - offset, target.origin[1] - offset, target.origin[2]],
    [target.origin[0] - offset, target.origin[1] + offset, target.origin[2]],
    [target.origin[0] + offset, target.origin[1] - offset, target.origin[2]],
  ];
  return targetPoints.some((point) => collisionWorld.traceUse?.(origin, point) === null);
}

function normalizedFireDirection(direction: QuakeMultiplayerVec3): QuakeMultiplayerVec3 | null {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length < QUAKE_MULTIPLAYER_DEATHMATCH_MIN_FIRE_DIRECTION_LENGTH) return null;
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function normalizedDamageDirection(
  targetOrigin: QuakeMultiplayerVec3,
  inflictorOrigin: QuakeMultiplayerVec3,
): QuakeMultiplayerVec3 | null {
  const dx = targetOrigin[0] - inflictorOrigin[0];
  const dy = targetOrigin[1] - inflictorOrigin[1];
  const dz = targetOrigin[2] - inflictorOrigin[2];
  const length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(length) || length <= 0) return null;
  return [dx / length, dy / length, dz / length];
}

function quakeMultiplayerDeathmatchForwardDirection(rotX: number, rotY: number): QuakeMultiplayerVec3 {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  return [
    -Math.sin(rx) * Math.cos(ry),
    -Math.sin(rx) * Math.sin(ry),
    -Math.cos(rx),
  ];
}

function distance3(a: QuakeMultiplayerVec3, b: QuakeMultiplayerVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function rayAabbIntersection(
  origin: QuakeMultiplayerVec3,
  direction: QuakeMultiplayerVec3,
  maxRange: number,
  min: QuakeMultiplayerVec3,
  max: QuakeMultiplayerVec3,
): { distance: number; impact: QuakeMultiplayerVec3 } | null {
  let enter = 0;
  let exit = maxRange;
  for (let axis = 0; axis < 3; axis += 1) {
    const rayOrigin = origin[axis];
    const rayDirection = direction[axis];
    if (Math.abs(rayDirection) <= COLLISION_EPSILON) {
      if (rayOrigin < min[axis] || rayOrigin > max[axis]) return null;
      continue;
    }
    let near = (min[axis] - rayOrigin) / rayDirection;
    let far = (max[axis] - rayOrigin) / rayDirection;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  if (exit < 0 || enter > maxRange) return null;
  const distance = Math.max(0, enter);
  return {
    distance,
    impact: [
      origin[0] + direction[0] * distance,
      origin[1] + direction[1] * distance,
      origin[2] + direction[2] * distance,
    ],
  };
}
