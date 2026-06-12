import type { QuakeEntity, QuakeScene } from "../../types/quake";
import type { QuakeCollisionWorld } from "../collision";
import {
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  QUAKE_PLAYER_VIEW_Z,
} from "../constants";
import { quakePlayerWaterLevel } from "../hazards";
import type {
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerClientDamageEnvelope,
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
const QUAKE_MULTIPLAYER_DEATHMATCH_NAIL_COOLDOWN_MS = 100;
const QUAKE_MULTIPLAYER_DEATHMATCH_EXPLOSIVE_COOLDOWN_MS = 800;
const QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_COOLDOWN_MS = 100;
const QUAKE_MULTIPLAYER_DEATHMATCH_HIT_RADIUS = 0.7;
const QUAKE_MULTIPLAYER_DEATHMATCH_PROJECTILE_HIT_RADIUS = 0.95;
const QUAKE_MULTIPLAYER_DEATHMATCH_HIT_HEIGHT = 1.7;
const QUAKE_MULTIPLAYER_DEATHMATCH_MAX_HITSCAN_RANGE = 64;
const QUAKE_MULTIPLAYER_DEATHMATCH_MELEE_RANGE = 2.1;
const QUAKE_MULTIPLAYER_DEATHMATCH_SPLASH_RADIUS = 4.2;
const QUAKE_MULTIPLAYER_DEATHMATCH_MIN_FIRE_DIRECTION_LENGTH = 0.5;
const QUAKE_MULTIPLAYER_DEATHMATCH_CAN_DAMAGE_OFFSET = 15 * QUAKE_COLLISION_UNIT_SCALE;

export interface QuakeMultiplayerDeathmatchSpawnOptions {
  pointToPoly(point: { x: number; y: number; z: number }): QuakeMultiplayerVec3;
  playerEyeHeight: number;
  playerMinsZ: number;
}

export interface QuakeMultiplayerDeathmatchHit {
  target: QuakeMultiplayerAuthoritativePlayerState;
  damage: number;
  distance: number;
  impact: QuakeMultiplayerVec3;
  lateralMiss: number;
}

export interface QuakeMultiplayerDeathmatchSplashHit extends QuakeMultiplayerDeathmatchHit {
  direct: boolean;
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

export function quakeMultiplayerDeathmatchNearbySpawnOrder(
  spawns: readonly QuakeMultiplayerSpawnPoint[],
): QuakeMultiplayerSpawnPoint[] {
  if (spawns.length <= 2) return [...spawns];

  let firstIndex = 0;
  let secondIndex = 1;
  let bestDistance = quakeMultiplayerSpawnDistanceSq(spawns[0]!, spawns[1]!);
  for (let i = 0; i < spawns.length; i++) {
    for (let j = i + 1; j < spawns.length; j++) {
      const distance = quakeMultiplayerSpawnDistanceSq(spawns[i]!, spawns[j]!);
      if (distance < bestDistance) {
        firstIndex = i;
        secondIndex = j;
        bestDistance = distance;
      }
    }
  }

  const ordered = [spawns[firstIndex]!, spawns[secondIndex]!];
  const remaining = spawns
    .map((spawn, index) => ({ spawn, index }))
    .filter(({ index }) => index !== firstIndex && index !== secondIndex);
  while (remaining.length) {
    let bestRemainingIndex = 0;
    let bestRemainingDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const distance = Math.min(
        ...ordered.map((spawn) => quakeMultiplayerSpawnDistanceSq(candidate.spawn, spawn)),
      );
      if (distance < bestRemainingDistance) {
        bestRemainingIndex = i;
        bestRemainingDistance = distance;
      }
    }
    const [next] = remaining.splice(bestRemainingIndex, 1);
    if (next) ordered.push(next.spawn);
  }

  return ordered;
}

function quakeMultiplayerSpawnDistanceSq(
  a: QuakeMultiplayerSpawnPoint,
  b: QuakeMultiplayerSpawnPoint,
): number {
  const dx = a.origin[0] - b.origin[0];
  const dy = a.origin[1] - b.origin[1];
  const dz = a.origin[2] - b.origin[2];
  return dx * dx + dy * dy + dz * dz;
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

export function quakeMultiplayerDeathmatchWeaponCooldownMs(weapon: string): number {
  const normalized = weapon.trim().toLowerCase();
  if (normalized === "axe") return QUAKE_MULTIPLAYER_DEATHMATCH_AXE_COOLDOWN_MS;
  if (normalized === "shotgun") return QUAKE_MULTIPLAYER_DEATHMATCH_SHOTGUN_COOLDOWN_MS;
  if (normalized === "supershotgun") return QUAKE_MULTIPLAYER_DEATHMATCH_SUPER_SHOTGUN_COOLDOWN_MS;
  if (normalized === "nailgun" || normalized === "supernailgun") return QUAKE_MULTIPLAYER_DEATHMATCH_NAIL_COOLDOWN_MS;
  if (normalized === "grenadelauncher" || normalized === "rocketlauncher") return QUAKE_MULTIPLAYER_DEATHMATCH_EXPLOSIVE_COOLDOWN_MS;
  if (normalized === "lightning") return QUAKE_MULTIPLAYER_DEATHMATCH_LIGHTNING_COOLDOWN_MS;
  return Infinity;
}

export function quakeMultiplayerDeathmatchFragDeltaForKill(input: {
  attackerPlayerId?: string;
  victimPlayerId: string;
}): number {
  if (!input.attackerPlayerId) return 0;
  return input.attackerPlayerId === input.victimPlayerId ? -1 : 1;
}

export function quakeMultiplayerDeathmatchFireFromPlayer(
  player: QuakeMultiplayerAuthoritativePlayerState,
  fire: QuakeMultiplayerFireIntent,
): QuakeMultiplayerFireIntent {
  const weapon = player.inventory?.activeWeapon ?? player.activeWeapon;
  return {
    ...fire,
    weapon,
    fireKind: quakeMultiplayerDeathmatchFireKindForWeapon(weapon),
    range: quakeMultiplayerDeathmatchFireRangeForWeapon(weapon),
    origin: player.origin,
    direction: quakeMultiplayerDeathmatchForwardDirection(player.rotX, player.rotY),
  };
}

export function quakeMultiplayerDeathmatchFireKindForWeapon(
  weapon: string,
): QuakeMultiplayerFireIntent["fireKind"] {
  const normalized = weapon.trim().toLowerCase();
  if (normalized === "axe") return "melee";
  if (normalized === "grenadelauncher" || normalized === "rocketlauncher") return "projectile";
  if (normalized === "lightning") return "beam";
  return "hitscan";
}

export function quakeMultiplayerDeathmatchFireRangeForWeapon(weapon: string): number {
  const kind = quakeMultiplayerDeathmatchFireKindForWeapon(weapon);
  if (kind === "melee") return QUAKE_MULTIPLAYER_DEATHMATCH_MELEE_RANGE;
  return QUAKE_MULTIPLAYER_DEATHMATCH_MAX_HITSCAN_RANGE;
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
  if (
    fire.fireKind !== "hitscan" &&
    fire.fireKind !== "projectile" &&
    fire.fireKind !== "beam" &&
    fire.fireKind !== "melee"
  ) return null;
  const damage = quakeMultiplayerDeathmatchWeaponDamage(fire.weapon);
  if (damage <= 0) return null;
  const direction = normalizedFireDirection(fire.direction);
  if (!direction) return null;
  const maxRange = quakeMultiplayerDeathmatchFireRange(fire);
  const hitRadius = fire.fireKind === "projectile"
    ? QUAKE_MULTIPLAYER_DEATHMATCH_PROJECTILE_HIT_RADIUS
    : QUAKE_MULTIPLAYER_DEATHMATCH_HIT_RADIUS;
  let best: QuakeMultiplayerDeathmatchHit | null = null;
  for (const player of players) {
    if (player.playerId === attackerPlayerId || !player.alive) continue;
    const hit = quakeMultiplayerDeathmatchPlayerHit(fire.origin, direction, maxRange, player, damage, hitRadius);
    if (!hit) continue;
    if (!best || hit.distance < best.distance) best = hit;
  }
  return best;
}

export function quakeMultiplayerDeathmatchSplashHits(
  fire: QuakeMultiplayerFireIntent,
  directHit: QuakeMultiplayerDeathmatchHit,
  players: Iterable<QuakeMultiplayerAuthoritativePlayerState>,
  attackerPlayerId: string,
): QuakeMultiplayerDeathmatchSplashHit[] {
  if (fire.fireKind !== "projectile") return [{ ...directHit, direct: true }];
  if (!quakeMultiplayerDeathmatchWeaponHasSplash(fire.weapon)) return [{ ...directHit, direct: true }];
  const hits: QuakeMultiplayerDeathmatchSplashHit[] = [{ ...directHit, direct: true }];
  for (const player of players) {
    if (player.playerId === directHit.target.playerId || !player.alive) continue;
    const distance = distance3(player.origin, directHit.target.origin);
    if (distance > QUAKE_MULTIPLAYER_DEATHMATCH_SPLASH_RADIUS) continue;
    const damageScale = Math.max(0, 1 - distance / QUAKE_MULTIPLAYER_DEATHMATCH_SPLASH_RADIUS);
    const damage = Math.round(directHit.damage * damageScale);
    if (damage <= 0) continue;
    hits.push({
      target: player,
      damage,
      distance,
      impact: player.origin,
      lateralMiss: distance,
      direct: false,
    });
  }
  return hits;
}

export function quakeMultiplayerDeathmatchHitHasLineOfSight(
  fire: QuakeMultiplayerFireIntent,
  hit: QuakeMultiplayerDeathmatchHit,
  collisionWorld: Pick<QuakeCollisionWorld, "traceUse"> | null | undefined,
): boolean {
  if (!collisionWorld?.traceUse) return true;
  return collisionWorld.traceUse(fire.origin, hit.impact) === null;
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
  if (fire.fireKind === "melee") return Math.min(QUAKE_MULTIPLAYER_DEATHMATCH_MELEE_RANGE, fire.range);
  return Math.min(
    QUAKE_MULTIPLAYER_DEATHMATCH_MAX_HITSCAN_RANGE,
    Number.isFinite(fire.range) && fire.range > 0 ? fire.range : QUAKE_MULTIPLAYER_DEATHMATCH_MAX_HITSCAN_RANGE,
  );
}

function quakeMultiplayerDeathmatchWeaponHasSplash(weapon: string): boolean {
  const normalized = weapon.trim().toLowerCase();
  return normalized === "grenadelauncher" || normalized === "rocketlauncher";
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
): QuakeMultiplayerDeathmatchHit | null {
  const targetCenter = quakeMultiplayerDeathmatchPlayerDamageCenter(target);
  const delta: QuakeMultiplayerVec3 = [
    targetCenter[0] - origin[0],
    targetCenter[1] - origin[1],
    targetCenter[2] - origin[2],
  ];
  const distanceAlongRay = dotVec3(delta, direction);
  if (distanceAlongRay < 0 || distanceAlongRay > maxRange) return null;
  const closest: QuakeMultiplayerVec3 = [
    origin[0] + direction[0] * distanceAlongRay,
    origin[1] + direction[1] * distanceAlongRay,
    origin[2] + direction[2] * distanceAlongRay,
  ];
  const dx = targetCenter[0] - closest[0];
  const dy = targetCenter[1] - closest[1];
  const dz = targetCenter[2] - closest[2];
  const lateralMiss = Math.hypot(dx, dy, dz);
  return lateralMiss <= hitRadius
    ? { target, damage, distance: distanceAlongRay, impact: closest, lateralMiss }
    : null;
}

function quakeMultiplayerDeathmatchPlayerDamageCenter(
  player: QuakeMultiplayerAuthoritativePlayerState,
): QuakeMultiplayerVec3 {
  return [
    player.origin[0],
    player.origin[1],
    player.origin[2] - QUAKE_MULTIPLAYER_DEATHMATCH_HIT_HEIGHT * 0.5,
  ];
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

function dotVec3(a: QuakeMultiplayerVec3, b: QuakeMultiplayerVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distance3(a: QuakeMultiplayerVec3, b: QuakeMultiplayerVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
