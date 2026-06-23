import type { QuakeCollisionWorld } from "../collision";
import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import {
  quakeMultiplayerDeathmatchProjectileSplashHitsAtImpact,
  quakeMultiplayerDeathmatchSplashHits,
  quakeMultiplayerDeathmatchVisibleHitDecision,
  type QuakeMultiplayerDeathmatchSplashHit,
} from "./deathmatch";
import type {
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerFireIntent,
  QuakeMultiplayerVec3,
} from "./protocol";

const QUAKE_MULTIPLAYER_PROJECTILE_NAIL_SPEED = 1000 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_PROJECTILE_GRENADE_SPEED = 600 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_PROJECTILE_ROCKET_SPEED = 1000 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_PROJECTILE_NAIL_LIFETIME_MS = 6_000;
const QUAKE_MULTIPLAYER_PROJECTILE_GRENADE_LIFETIME_MS = 2_500;
const QUAKE_MULTIPLAYER_PROJECTILE_ROCKET_LIFETIME_MS = 5_000;
const QUAKE_MULTIPLAYER_PROJECTILE_GRENADE_VERTICAL_VELOCITY = 200 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_PROJECTILE_GRENADE_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_PROJECTILE_BOUNCE_OVERBOUNCE = 1.5;
const QUAKE_MULTIPLAYER_PROJECTILE_BOUNCE_STOP_EPSILON = 0.1 * QUAKE_COLLISION_UNIT_SCALE;

export interface QuakeMultiplayerServerProjectile {
  direction: QuakeMultiplayerVec3;
  expiresAt: number;
  fire: QuakeMultiplayerFireIntent;
  gravity: number;
  origin: QuakeMultiplayerVec3;
  ownerPlayerId: string;
  projectileId: string;
  spawnedAt: number;
  speed: number;
  updatedAt: number;
  velocity: QuakeMultiplayerVec3;
  weapon: string;
}

export type QuakeMultiplayerServerProjectileImpactKind = "player" | "world";

export interface QuakeMultiplayerServerProjectileImpact {
  damageHits: QuakeMultiplayerDeathmatchSplashHit[];
  kind: QuakeMultiplayerServerProjectileImpactKind;
  origin: QuakeMultiplayerVec3;
  targetPlayerId?: string;
}

export type QuakeMultiplayerServerProjectileAdvanceResult =
  | {
      type: "active";
      projectile: QuakeMultiplayerServerProjectile;
    }
  | {
      type: "expired";
      projectile: QuakeMultiplayerServerProjectile;
    }
  | {
      type: "impact";
      impact: QuakeMultiplayerServerProjectileImpact;
      projectile: QuakeMultiplayerServerProjectile;
    };

export function quakeMultiplayerServerProjectileWeaponSupported(weapon: string): boolean {
  const normalized = weapon.trim().toLowerCase();
  return normalized === "nailgun" ||
    normalized === "supernailgun" ||
    normalized === "grenadelauncher" ||
    normalized === "rocketlauncher";
}

export function createQuakeMultiplayerServerProjectile(input: {
  fire: QuakeMultiplayerFireIntent;
  now: number;
  ownerPlayerId: string;
  projectileId: string;
}): QuakeMultiplayerServerProjectile | null {
  const speed = quakeMultiplayerServerProjectileSpeed(input.fire.weapon);
  const lifetimeMs = quakeMultiplayerServerProjectileLifetimeMs(input.fire.weapon);
  const direction = normalizedVec3(input.fire.direction);
  if (!direction || speed <= 0 || lifetimeMs <= 0 || input.fire.fireKind !== "projectile") return null;
  const velocity = quakeMultiplayerServerProjectileVelocity(input.fire.weapon, direction, speed);
  return {
    direction,
    expiresAt: input.now + lifetimeMs,
    fire: {
      ...input.fire,
      direction,
    },
    gravity: quakeMultiplayerServerProjectileGravity(input.fire.weapon),
    origin: [...input.fire.origin] as QuakeMultiplayerVec3,
    ownerPlayerId: input.ownerPlayerId,
    projectileId: input.projectileId,
    spawnedAt: input.now,
    speed,
    updatedAt: input.now,
    velocity,
    weapon: input.fire.weapon,
  };
}

export function advanceQuakeMultiplayerServerProjectile(
  projectile: QuakeMultiplayerServerProjectile,
  input: {
    collisionWorld?: Pick<QuakeCollisionWorld, "traceUse"> | null;
    now: number;
    players: Iterable<QuakeMultiplayerAuthoritativePlayerState>;
  },
): QuakeMultiplayerServerProjectileAdvanceResult {
  const players = [...input.players];
  if (input.now >= projectile.expiresAt) {
    if (quakeMultiplayerServerProjectileExplodesOnExpire(projectile.weapon)) {
      return {
        type: "impact",
        projectile: { ...projectile, updatedAt: input.now },
        impact: {
          damageHits: quakeMultiplayerDeathmatchProjectileSplashHitsAtImpact(
            projectile.fire,
            projectile.origin,
            players,
            projectile.ownerPlayerId,
            input.collisionWorld,
            undefined,
          ),
          kind: "world",
          origin: projectile.origin,
        },
      };
    }
    return { type: "expired", projectile: { ...projectile, updatedAt: input.now } };
  }
  const dt = Math.max(0, (input.now - projectile.updatedAt) / 1000);
  if (dt <= 0) return { type: "active", projectile };
  const nextVelocity: QuakeMultiplayerVec3 = [
    projectile.velocity[0],
    projectile.velocity[1],
    projectile.velocity[2] - projectile.gravity * dt,
  ];
  const nextOrigin: QuakeMultiplayerVec3 = [
    projectile.origin[0] + nextVelocity[0] * dt,
    projectile.origin[1] + nextVelocity[1] * dt,
    projectile.origin[2] + nextVelocity[2] * dt,
  ];
  const segmentDistance = distance3(projectile.origin, nextOrigin);
  if (segmentDistance <= 0) {
    return {
      type: "active",
      projectile: {
        ...projectile,
        updatedAt: input.now,
        velocity: nextVelocity,
      },
    };
  }
  const segmentDirection = normalizedVec3([
    nextOrigin[0] - projectile.origin[0],
    nextOrigin[1] - projectile.origin[1],
    nextOrigin[2] - projectile.origin[2],
  ]) ?? projectile.direction;
  const segmentFire: QuakeMultiplayerFireIntent = {
    ...projectile.fire,
    direction: segmentDirection,
    origin: projectile.origin,
    range: segmentDistance,
  };
  const hitDecision = quakeMultiplayerDeathmatchVisibleHitDecision(
    segmentFire,
    players,
    projectile.ownerPlayerId,
    input.collisionWorld,
  );
  const worldImpact = quakeMultiplayerServerProjectileWorldImpact(
    projectile.origin,
    nextOrigin,
    input.collisionWorld,
  );
  const hit = hitDecision.hit;
  if (worldImpact && (!hit || worldImpact.distance <= hit.distance)) {
    if (quakeMultiplayerServerProjectileBounces(projectile.weapon)) {
      return {
        type: "active",
        projectile: quakeMultiplayerServerProjectileBounced(projectile, worldImpact, nextVelocity, input.now),
      };
    }
    const damageHits = quakeMultiplayerDeathmatchProjectileSplashHitsAtImpact(
      segmentFire,
      worldImpact.origin,
      players,
      projectile.ownerPlayerId,
      input.collisionWorld,
      undefined,
    );
    return {
      type: "impact",
      projectile: {
        ...projectile,
        origin: worldImpact.origin,
        updatedAt: input.now,
        velocity: nextVelocity,
      },
      impact: {
        damageHits,
        kind: "world",
        origin: worldImpact.origin,
      },
    };
  }
  if (hit) {
    const damageHits = quakeMultiplayerDeathmatchSplashHits(
      segmentFire,
      hit,
      players,
      projectile.ownerPlayerId,
      input.collisionWorld,
    );
    return {
      type: "impact",
      projectile: {
        ...projectile,
        origin: hit.impact,
        updatedAt: input.now,
        velocity: nextVelocity,
      },
      impact: {
        damageHits,
        kind: "player",
        origin: hit.impact,
        targetPlayerId: hit.target.playerId,
      },
    };
  }
  return {
    type: "active",
    projectile: {
      ...projectile,
      direction: normalizedVec3(nextVelocity) ?? projectile.direction,
      origin: nextOrigin,
      speed: Math.hypot(nextVelocity[0], nextVelocity[1], nextVelocity[2]),
      updatedAt: input.now,
      velocity: nextVelocity,
    },
  };
}

function quakeMultiplayerServerProjectileSpeed(weapon: string): number {
  const normalized = weapon.trim().toLowerCase();
  if (normalized === "nailgun" || normalized === "supernailgun") return QUAKE_MULTIPLAYER_PROJECTILE_NAIL_SPEED;
  if (normalized === "grenadelauncher") return QUAKE_MULTIPLAYER_PROJECTILE_GRENADE_SPEED;
  if (normalized === "rocketlauncher") return QUAKE_MULTIPLAYER_PROJECTILE_ROCKET_SPEED;
  return 0;
}

function quakeMultiplayerServerProjectileLifetimeMs(weapon: string): number {
  const normalized = weapon.trim().toLowerCase();
  if (normalized === "nailgun" || normalized === "supernailgun") return QUAKE_MULTIPLAYER_PROJECTILE_NAIL_LIFETIME_MS;
  if (normalized === "grenadelauncher") return QUAKE_MULTIPLAYER_PROJECTILE_GRENADE_LIFETIME_MS;
  if (normalized === "rocketlauncher") return QUAKE_MULTIPLAYER_PROJECTILE_ROCKET_LIFETIME_MS;
  return 0;
}

function quakeMultiplayerServerProjectileGravity(weapon: string): number {
  return weapon.trim().toLowerCase() === "grenadelauncher"
    ? QUAKE_MULTIPLAYER_PROJECTILE_GRENADE_GRAVITY
    : 0;
}

function quakeMultiplayerServerProjectileVelocity(
  weapon: string,
  direction: QuakeMultiplayerVec3,
  speed: number,
): QuakeMultiplayerVec3 {
  if (weapon.trim().toLowerCase() !== "grenadelauncher") {
    return [
      direction[0] * speed,
      direction[1] * speed,
      direction[2] * speed,
    ];
  }
  return [
    direction[0] * speed,
    direction[1] * speed,
    direction[2] * speed + QUAKE_MULTIPLAYER_PROJECTILE_GRENADE_VERTICAL_VELOCITY,
  ];
}

function quakeMultiplayerServerProjectileBounces(weapon: string): boolean {
  return weapon.trim().toLowerCase() === "grenadelauncher";
}

function quakeMultiplayerServerProjectileExplodesOnExpire(weapon: string): boolean {
  return weapon.trim().toLowerCase() === "grenadelauncher";
}

function quakeMultiplayerServerProjectileBounced(
  projectile: QuakeMultiplayerServerProjectile,
  worldImpact: { normal?: QuakeMultiplayerVec3; origin: QuakeMultiplayerVec3 },
  velocity: QuakeMultiplayerVec3,
  updatedAt: number,
): QuakeMultiplayerServerProjectile {
  const normal = worldImpact.normal;
  if (!normal) {
    return {
      ...projectile,
      direction: [0, 0, 0],
      origin: worldImpact.origin,
      speed: 0,
      updatedAt,
      velocity: [0, 0, 0],
    };
  }
  const bounced = clipVelocity(velocity, normal, QUAKE_MULTIPLAYER_PROJECTILE_BOUNCE_OVERBOUNCE);
  const speed = Math.hypot(bounced[0], bounced[1], bounced[2]);
  const origin: QuakeMultiplayerVec3 = [
    worldImpact.origin[0] + normal[0] * COLLISION_EPSILON,
    worldImpact.origin[1] + normal[1] * COLLISION_EPSILON,
    worldImpact.origin[2] + normal[2] * COLLISION_EPSILON,
  ];
  if (speed <= COLLISION_EPSILON) {
    return {
      ...projectile,
      direction: [0, 0, 0],
      origin,
      speed: 0,
      updatedAt,
      velocity: [0, 0, 0],
    };
  }
  return {
    ...projectile,
    direction: normalizedVec3(bounced) ?? projectile.direction,
    origin,
    speed,
    updatedAt,
    velocity: bounced,
  };
}

function quakeMultiplayerServerProjectileWorldImpact(
  origin: QuakeMultiplayerVec3,
  end: QuakeMultiplayerVec3,
  collisionWorld?: Pick<QuakeCollisionWorld, "traceUse"> | null,
): { distance: number; normal?: QuakeMultiplayerVec3; origin: QuakeMultiplayerVec3 } | null {
  if (!collisionWorld?.traceUse) return null;
  const trace = collisionWorld.traceUse(origin, end);
  if (!trace || trace.fraction >= 1) return null;
  return {
    distance: distance3(origin, trace.end),
    ...(trace.planeNormal ? { normal: [trace.planeNormal[0], trace.planeNormal[1], trace.planeNormal[2]] } : {}),
    origin: [trace.end[0], trace.end[1], trace.end[2]],
  };
}

function normalizedVec3(value: QuakeMultiplayerVec3): QuakeMultiplayerVec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= 0) return null;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function distance3(a: QuakeMultiplayerVec3, b: QuakeMultiplayerVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function clipVelocity(
  velocity: QuakeMultiplayerVec3,
  normal: QuakeMultiplayerVec3,
  overbounce: number,
): QuakeMultiplayerVec3 {
  const backoff = dot3(velocity, normal) * overbounce;
  return [
    stopTinyVelocity(velocity[0] - normal[0] * backoff),
    stopTinyVelocity(velocity[1] - normal[1] * backoff),
    stopTinyVelocity(velocity[2] - normal[2] * backoff),
  ];
}

function stopTinyVelocity(value: number): number {
  return Math.abs(value) < QUAKE_MULTIPLAYER_PROJECTILE_BOUNCE_STOP_EPSILON ? 0 : value;
}

function dot3(a: QuakeMultiplayerVec3, b: QuakeMultiplayerVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
