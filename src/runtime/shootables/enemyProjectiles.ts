import type { PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type {
  QuakeMonsterProjectileFrameEvent,
  QuakeMonsterProjectileOffsetUnits,
} from "../../generated/quakeMonsterLogic";
import type { QuakeEntity } from "../../types/quake";
import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import { normalizeVec3, subtractVec3 } from "../math";
import type { QuakePickupModel, QuakePickupModelLibrary } from "../pickups";
import {
  inflateBounds,
  pointToAabbDistanceSq,
  segmentAabbIntersectionDistance,
  type QuakeBounds,
} from "./bounds";
import type { QuakeMonsterCombatProfile, QuakeMonsterProjectileOffset } from "./combatFacts";
import type {
  QuakeDamageTraceResult,
  QuakeEnemyProjectile,
  QuakeEnemyState,
  QuakeShootableState,
} from "./state";

const QUAKE_MONSTER_PROJECTILE_LIFETIME_MS = 3200;
const QUAKE_MONSTER_PROJECTILE_AIM_DROP = 18 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_AIM_ERROR = 24 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_VERTICAL_AIM_ERROR = 8 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_RADIUS = 28 * QUAKE_COLLISION_UNIT_SCALE;

type QuakeEnemyProjectileTraceDetails = Record<string, boolean | number | string | null | undefined>;

export interface QuakeEnemyProjectileRuntimeOptions {
  addMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex?: number): PolyMeshHandle | null;
  boundsCenter(bounds: QuakeBounds): Vec3;
  currentModelLibrary(): QuakePickupModelLibrary | null;
  damagePlayer(amount: number): boolean;
  hasLineOfSight(start: Vec3, end: Vec3): boolean;
  markTrace(kind: string, details?: QuakeEnemyProjectileTraceDetails): void;
  offsetPoint(
    origin: Vec3,
    start: Vec3,
    target: Vec3,
    offset: QuakeMonsterProjectileOffset | undefined,
  ): Vec3;
  pixelate(handle: PolyMeshHandle): void;
  playerDamageBounds(origin: [number, number, number] | Vec3): QuakeBounds;
  randomRange(enemy: QuakeEnemyState, min: number, max: number): number;
  schedulePresentationResync(handle: PolyMeshHandle): void;
}

export interface QuakeEnemyProjectileRuntime {
  activeCount(): number;
  clear(): void;
  projectiles(): readonly QuakeEnemyProjectile[];
  spawn(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    start: Vec3,
    target: Vec3,
    profile: QuakeMonsterCombatProfile,
    now: number,
  ): void;
  update(playerOrigin: [number, number, number], dt: number, now: number): void;
}

export function createQuakeEnemyProjectileRuntime(
  options: QuakeEnemyProjectileRuntimeOptions,
): QuakeEnemyProjectileRuntime {
  let projectiles: QuakeEnemyProjectile[] = [];

  function activeCount(): number {
    return projectiles.length;
  }

  function clear(): void {
    for (const projectile of projectiles) remove(projectile);
    projectiles = [];
  }

  function spawn(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    start: Vec3,
    target: Vec3,
    profile: QuakeMonsterCombatProfile,
    now: number,
  ): void {
    const speed = profile.projectileSpeed ?? 420 * QUAKE_COLLISION_UNIT_SCALE;
    const radius = profile.projectileRadius ?? QUAKE_MONSTER_PROJECTILE_RADIUS;
    const direction = normalizeVec3(subtractVec3(aimTarget(start, target, profile, enemy), start));
    const velocity: Vec3 = [
      direction[0] * speed,
      direction[1] * speed,
      direction[2] * speed,
    ];
    if (profile.projectileVerticalVelocity !== undefined) velocity[2] = profile.projectileVerticalVelocity;
    const projectile: QuakeEnemyProjectile = {
      damage: profile.damage,
      expiresAt: now + (profile.projectileLifetimeMs ?? QUAKE_MONSTER_PROJECTILE_LIFETIME_MS),
      handle: null,
      origin: [...start] as Vec3,
      profile,
      radius,
      radiusSq: radius * radius,
      sourceEntityIndex: shootable.entity.index,
      velocity,
    };
    projectile.handle = addMesh(projectile);
    projectiles.push(projectile);
  }

  function aimTarget(
    start: Vec3,
    target: Vec3,
    profile: QuakeMonsterCombatProfile,
    enemy: QuakeEnemyState,
  ): Vec3 {
    const offsetTarget = options.offsetPoint(target, start, target, profile.projectileTargetOffset);
    const dx = offsetTarget[0] - start[0];
    const dy = offsetTarget[1] - start[1];
    const horizontalLength = Math.hypot(dx, dy);
    const right: Vec3 = horizontalLength > COLLISION_EPSILON
      ? [-dy / horizontalLength, dx / horizontalLength, 0]
      : [1, 0, 0];
    const aimError = Math.max(0, profile.projectileAimError ?? QUAKE_MONSTER_PROJECTILE_AIM_ERROR);
    const verticalAimError = Math.max(
      0,
      profile.projectileVerticalAimError ?? QUAKE_MONSTER_PROJECTILE_VERTICAL_AIM_ERROR,
    );
    const horizontalOffset = options.randomRange(enemy, -aimError, aimError);
    const verticalOffset = options.randomRange(enemy, -verticalAimError, verticalAimError);
    return [
      offsetTarget[0] + right[0] * horizontalOffset,
      offsetTarget[1] + right[1] * horizontalOffset,
      offsetTarget[2] - (profile.projectileAimDrop ?? QUAKE_MONSTER_PROJECTILE_AIM_DROP) + verticalOffset,
    ];
  }

  function update(
    playerOrigin: [number, number, number],
    dt: number,
    now: number,
  ): void {
    if (!projectiles.length) return;
    const active: QuakeEnemyProjectile[] = [];
    for (const projectile of projectiles) {
      if (projectile.expiresAt <= now) {
        if (projectile.profile.projectileSplashOnExpire) {
          applySplashDamage(projectile, projectile.origin, playerOrigin, now, "expire");
        }
        remove(projectile);
        continue;
      }
      const gravity = Math.max(0, projectile.profile.projectileGravity ?? 0);
      const nextVelocity: Vec3 = gravity > 0
        ? [
          projectile.velocity[0],
          projectile.velocity[1],
          projectile.velocity[2] - gravity * dt,
        ]
        : projectile.velocity;
      const nextOrigin: Vec3 = [
        projectile.origin[0] + projectile.velocity[0] * dt,
        projectile.origin[1] + projectile.velocity[1] * dt,
        projectile.origin[2] + (projectile.velocity[2] - gravity * dt * 0.5) * dt,
      ];
      if (!options.hasLineOfSight(projectile.origin, nextOrigin)) {
        applySplashDamage(projectile, nextOrigin, playerOrigin, now, "blocked");
        options.markTrace("enemy-projectile-blocked", {
          damage: projectile.damage,
          projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
          source: projectile.sourceEntityIndex,
          splash: projectile.profile.projectileSplashDamage ?? null,
        });
        remove(projectile);
        continue;
      }
      const hit = hitsPlayer(projectile, nextOrigin, playerOrigin);
      projectile.origin = nextOrigin;
      projectile.velocity = nextVelocity;
      syncMesh(projectile);
      if (hit.hit) {
        options.damagePlayer(projectile.damage);
        options.markTrace("enemy-projectile-hit", {
          damage: projectile.damage,
          distance: hit.distance,
          projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
          source: projectile.sourceEntityIndex,
        });
        remove(projectile);
        continue;
      }
      active.push(projectile);
    }
    projectiles = active;
  }

  function hitsPlayer(
    projectile: QuakeEnemyProjectile,
    nextOrigin: Vec3,
    playerOrigin: [number, number, number],
  ): QuakeDamageTraceResult {
    const playerBounds = inflateBounds(options.playerDamageBounds(playerOrigin), projectile.radius);
    const distance = segmentAabbIntersectionDistance(projectile.origin, nextOrigin, playerBounds);
    if (distance === null) {
      return { distance: 0, hit: false, hitPoint: nextOrigin, reason: "miss" };
    }
    const travel = Math.hypot(
      nextOrigin[0] - projectile.origin[0],
      nextOrigin[1] - projectile.origin[1],
      nextOrigin[2] - projectile.origin[2],
    ) || 1;
    const t = Math.max(0, Math.min(1, distance / travel));
    const hitPoint: Vec3 = [
      projectile.origin[0] + (nextOrigin[0] - projectile.origin[0]) * t,
      projectile.origin[1] + (nextOrigin[1] - projectile.origin[1]) * t,
      projectile.origin[2] + (nextOrigin[2] - projectile.origin[2]) * t,
    ];
    return { distance, hit: true, hitPoint, reason: "hit" };
  }

  function applySplashDamage(
    projectile: QuakeEnemyProjectile,
    origin: Vec3,
    playerOrigin: [number, number, number],
    now: number,
    reason: string,
  ): boolean {
    const splashDamage = projectile.profile.projectileSplashDamage;
    const splashRadius = projectile.profile.projectileSplashRadius;
    if (!splashDamage || !splashRadius) return false;
    const distanceSq = pointToAabbDistanceSq(origin, options.playerDamageBounds(playerOrigin));
    if (distanceSq > splashRadius * splashRadius) {
      options.markTrace("enemy-projectile-splash", {
        damage: 0,
        hit: false,
        projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
        reason: "range",
        source: projectile.sourceEntityIndex,
        trigger: reason,
      });
      return false;
    }
    const playerBounds = options.playerDamageBounds(playerOrigin);
    const playerCenter = options.boundsCenter(playerBounds);
    if (!options.hasLineOfSight(origin, playerCenter)) {
      options.markTrace("enemy-projectile-splash", {
        damage: 0,
        hit: false,
        projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
        reason: "blocked",
        source: projectile.sourceEntityIndex,
        trigger: reason,
      });
      return false;
    }
    const distanceUnits = Math.sqrt(distanceSq) / QUAKE_COLLISION_UNIT_SCALE;
    const damage = Math.max(1, splashDamage - distanceUnits * 0.5);
    options.damagePlayer(damage);
    options.markTrace("enemy-projectile-splash", {
      damage,
      hit: true,
      projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
      reason: "hit",
      source: projectile.sourceEntityIndex,
      time: now,
      trigger: reason,
    });
    return true;
  }

  function addMesh(projectile: QuakeEnemyProjectile): PolyMeshHandle | null {
    const classname = projectile.profile.projectileClassname ?? "enemy_projectile_magic";
    const model = projectile.profile.projectileModelPath
      ? options.currentModelLibrary()?.models[projectile.profile.projectileModelPath]
      : undefined;
    const entity: QuakeEntity = {
      index: -100000 - projectiles.length,
      classname,
      properties: {},
      origin: { x: 0, y: 0, z: 0 },
    };
    const handle = options.addMesh(entity, model);
    if (!handle) return null;
    handle.element.classList.add("enemy-projectile");
    syncMesh(projectile, handle);
    if (!model) {
      options.pixelate(handle);
      options.schedulePresentationResync(handle);
    }
    return handle;
  }

  function syncMesh(
    projectile: QuakeEnemyProjectile,
    handle = projectile.handle,
  ): void {
    if (!handle) return;
    const yaw = (Math.atan2(projectile.velocity[1], projectile.velocity[0]) * 180) / Math.PI;
    const model = projectile.profile.projectileModelPath
      ? options.currentModelLibrary()?.models[projectile.profile.projectileModelPath]
      : undefined;
    handle.setTransform({
      position: projectile.origin,
      rotation: [0, 0, normalizeProjectileYaw(yaw)],
      scale: projectile.profile.projectileScale ?? (model?.renderScale ? 1 / model.renderScale : 1),
    });
  }

  function remove(projectile: QuakeEnemyProjectile): void {
    projectile.handle?.remove();
    projectile.handle = null;
  }

  return {
    activeCount,
    clear,
    projectiles: () => projectiles,
    spawn,
    update,
  };
}

export function quakeEnemyProjectileAttackOrigin(
  shootable: QuakeShootableState,
  eyeOrigin: Vec3,
  playerOrigin: [number, number, number],
  profile: QuakeMonsterCombatProfile,
): Vec3 {
  const offset = profile.projectileOriginOffset;
  if (!offset) return eyeOrigin;
  const dx = playerOrigin[0] - shootable.origin[0];
  const dy = playerOrigin[1] - shootable.origin[1];
  const length = Math.hypot(dx, dy) || 1;
  const forward: Vec3 = [dx / length, dy / length, 0];
  const right: Vec3 = [-forward[1], forward[0], 0];
  return [
    eyeOrigin[0] + forward[0] * (offset.forward ?? 0) + right[0] * (offset.right ?? 0),
    eyeOrigin[1] + forward[1] * (offset.forward ?? 0) + right[1] * (offset.right ?? 0),
    eyeOrigin[2] + (offset.up ?? 0),
  ];
}

export function quakeEnemyProjectileOffsetPoint(
  origin: Vec3,
  basisOrigin: Vec3,
  basisTarget: Vec3,
  offset: QuakeMonsterProjectileOffset | undefined,
): Vec3 {
  if (!offset) return [...origin] as Vec3;
  const dx = basisTarget[0] - basisOrigin[0];
  const dy = basisTarget[1] - basisOrigin[1];
  const length = Math.hypot(dx, dy) || 1;
  const forward: Vec3 = [dx / length, dy / length, 0];
  const right: Vec3 = [-forward[1], forward[0], 0];
  return [
    origin[0] + forward[0] * (offset.forward ?? 0) + right[0] * (offset.right ?? 0),
    origin[1] + forward[1] * (offset.forward ?? 0) + right[1] * (offset.right ?? 0),
    origin[2] + (offset.up ?? 0),
  ];
}

export function quakecProjectileCombatProfile(
  event: QuakeMonsterProjectileFrameEvent,
  baseProfile: QuakeMonsterCombatProfile,
): QuakeMonsterCombatProfile {
  const splash = quakecProjectileSplashProfile(event);
  return {
    cooldownMs: baseProfile.cooldownMs,
    cooldownRandomAddMs: baseProfile.cooldownRandomAddMs,
    damage: event.damage,
    kind: "projectile",
    projectileAimError: 0,
    projectileAimDrop: 0,
    projectileClassname: event.classname,
    ...(quakecProjectileUsesGravity(event) ? { projectileGravity: QUAKE_MONSTER_PROJECTILE_GRAVITY } : {}),
    projectileLifetimeMs: event.lifetimeMs,
    projectileModelPath: event.modelPath,
    projectileRadius: quakecScaleUnits(event.radiusUnits),
    projectileSpeed: quakecScaleUnits(event.speedUnits),
    ...(splash ? {
      projectileSplashDamage: splash.damage,
      projectileSplashOnExpire: splash.onExpire,
      projectileSplashRadius: quakecScaleUnits(splash.radiusUnits),
    } : {}),
    projectileTargetOffset: quakecScaleOffset(event.targetOffsetUnits),
    projectileVerticalAimError: 0,
    ...(event.verticalVelocityUnits !== undefined
      ? { projectileVerticalVelocity: quakecScaleUnits(event.verticalVelocityUnits) }
      : {}),
    range: baseProfile.range,
    wakeDelayMs: baseProfile.wakeDelayMs,
    windupMs: baseProfile.windupMs,
  };
}

function quakecProjectileSplashProfile(
  event: QuakeMonsterProjectileFrameEvent,
): { damage: number; onExpire: boolean; radiusUnits: number } | null {
  if (event.classname === "enemy_projectile_grenade") return { damage: 40, onExpire: true, radiusUnits: 80 };
  if (event.classname === "enemy_projectile_lavaball") return { damage: 120, onExpire: false, radiusUnits: 160 };
  return null;
}

function quakecProjectileUsesGravity(event: QuakeMonsterProjectileFrameEvent): boolean {
  return event.classname === "enemy_projectile_grenade" ||
    event.classname === "enemy_projectile_zombie_grenade";
}

function quakecScaleOffset(
  offset: QuakeMonsterProjectileOffsetUnits | undefined,
): QuakeMonsterProjectileOffset | undefined {
  if (!offset) return undefined;
  return {
    ...(offset.forward !== undefined ? { forward: quakecScaleUnits(offset.forward) } : {}),
    ...(offset.right !== undefined ? { right: quakecScaleUnits(offset.right) } : {}),
    ...(offset.up !== undefined ? { up: quakecScaleUnits(offset.up) } : {}),
  };
}

function quakecScaleUnits(value: number): number {
  return value * QUAKE_COLLISION_UNIT_SCALE;
}

function normalizeProjectileYaw(yaw: number): number {
  return ((yaw % 360) + 360) % 360;
}
