import type { PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type {
  QuakeMonsterProjectileFrameEvent,
  QuakeMonsterProjectileOffsetUnits,
} from "../../generated/quakeMonsterLogic";
import type { QuakeEntity } from "../../types/quake";
import { quakeAliasModelRenderYaw, normalizeQuakeRenderYaw } from "../aliasModelOrientation";
import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import { distanceSq3, dotVec3, normalizeVec3, subtractVec3 } from "../math";
import type { QuakePlayerDamageContext } from "../player";
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
const QUAKE_MONSTER_PROJECTILE_BOUNCE_OVERBOUNCE = 1.5;
const QUAKE_MONSTER_PROJECTILE_BOUNCE_STOP_EPSILON = 0.1 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_BOUNCE_GROUND_NORMAL_Z = 0.7;
const QUAKE_MONSTER_PROJECTILE_BOUNCE_GROUND_STOP_SPEED = 60 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_ENEMY_PROJECTILE_DEBUG_CAPTURE_LIMIT = 4096;

type QuakeEnemyProjectileTraceDetails = Record<string, boolean | number | string | null | undefined>;

export interface QuakeEnemyProjectileSoundOptions {
  volume?: number;
}

export interface QuakeEnemyProjectileWorldTrace {
  fraction: number;
  end: Vec3;
  planeNormal: Vec3 | null;
  entityIndex?: number;
  modelIndex?: number;
  classname?: string;
}

export interface QuakeEnemyProjectileRuntimeOptions {
  addMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex?: number): PolyMeshHandle | null;
  boundsCenter(bounds: QuakeBounds): Vec3;
  consumePlayerPainRandom?(details: QuakeEnemyProjectilePlayerPainRandomDetails): number | null;
  currentModelLibrary(): QuakePickupModelLibrary | null;
  damagePlayer(amount: number, context?: QuakePlayerDamageContext): boolean;
  hasLineOfSight(start: Vec3, end: Vec3): boolean;
  markTrace(kind: string, details?: QuakeEnemyProjectileTraceDetails): void;
  onExplosion?(event: QuakeEnemyProjectileExplosionEvent): void;
  offsetPoint(
    origin: Vec3,
    start: Vec3,
    target: Vec3,
    offset: QuakeMonsterProjectileOffset | undefined,
  ): Vec3;
  pixelate(handle: PolyMeshHandle): void;
  playerDamageBounds(origin: [number, number, number] | Vec3): QuakeBounds;
  playerDamageOrigin(origin: [number, number, number] | Vec3): Vec3;
  playSound?(soundPath: string, options?: QuakeEnemyProjectileSoundOptions): boolean;
  randomRange(enemy: QuakeEnemyState, min: number, max: number): number;
  schedulePresentationResync(handle: PolyMeshHandle): void;
  traceLine?(start: Vec3, end: Vec3): QuakeEnemyProjectileWorldTrace | null;
}

export interface QuakeEnemyProjectileExplosionEvent {
  flavor: "grenade" | "lava" | "rocket";
  origin: Vec3;
  projectile: string;
  radiusUnits?: number;
  sourceEntityIndex?: number;
}

export interface QuakeEnemyProjectilePlayerPainRandomDetails {
  damage: number;
  projectile: string;
  reason: string;
  sourceEntityIndex?: number;
}

export interface QuakeEnemyProjectileDebugCapture {
  activeCount: number;
  enabled: boolean;
  events: QuakeEnemyProjectileDebugEvent[];
}

export interface QuakeEnemyProjectileDebugEvent {
  seq: number;
  at: number;
  type: "spawn" | "move" | "impact" | "expire" | "remove";
  damage?: number;
  expiresAt?: number;
  impactResult?: "keep" | "remove" | "stop";
  modelPath?: string;
  origin?: Vec3;
  projectile: string;
  projectileId: number;
  radiusQuakeUnits?: number;
  sourceEntityIndex?: number;
  splashDamage?: number;
  splashRadiusQuakeUnits?: number;
  trace?: {
    classname: string | null;
    end: Vec3;
    entityIndex: number | null;
    fraction: number;
  };
  velocity?: Vec3;
}

export interface QuakeEnemyProjectileRuntime {
  activeCount(): number;
  clear(): void;
  debugClearProjectileCapture(): void;
  debugProjectileCapture(): QuakeEnemyProjectileDebugCapture;
  debugSetProjectileCaptureEnabled(enabled: boolean): void;
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
  let projectileDebugCaptureEnabled = false;
  let projectileDebugCaptureEvents: QuakeEnemyProjectileDebugEvent[] = [];
  let projectileDebugEventSeq = 0;
  let nextProjectileDebugId = 0;

  function activeCount(): number {
    return projectiles.length;
  }

  function clear(): void {
    for (const projectile of projectiles) remove(projectile);
    projectiles = [];
  }

  function debugClearProjectileCapture(): void {
    projectileDebugCaptureEvents = [];
    projectileDebugEventSeq = 0;
  }

  function debugProjectileCapture(): QuakeEnemyProjectileDebugCapture {
    return {
      activeCount: activeCount(),
      enabled: projectileDebugCaptureEnabled,
      events: projectileDebugCaptureEvents.map((event) => ({
        ...event,
        origin: event.origin ? [...event.origin] as Vec3 : undefined,
        trace: event.trace ? {
          ...event.trace,
          end: [...event.trace.end] as Vec3,
        } : undefined,
        velocity: event.velocity ? [...event.velocity] as Vec3 : undefined,
      })),
    };
  }

  function debugSetProjectileCaptureEnabled(enabled: boolean): void {
    projectileDebugCaptureEnabled = Boolean(enabled);
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
      debugId: ++nextProjectileDebugId,
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
    playProjectileSound(projectileLaunchSound(projectile.profile), projectile);
    options.markTrace("enemy-projectile-spawn", {
      damage: projectile.damage,
      modelPath: projectile.profile.projectileModelPath ?? null,
      projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
      projectileId: projectile.debugId,
      source: projectile.sourceEntityIndex,
      splash: projectile.profile.projectileSplashDamage ?? null,
    });
    recordProjectileDebugEvent("spawn", projectileDebugEventPayload(projectile));
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
        recordProjectileDebugEvent("expire", projectileDebugEventPayload(projectile));
        if (projectile.profile.projectileSplashOnExpire) {
          applySplashDamage(projectile, projectile.origin, playerOrigin, now, "expire");
          emitProjectileExplosion(projectile, projectile.origin);
          playProjectileSound(projectileExplosionSound(projectile.profile), projectile);
        }
        recordProjectileDebugEvent("remove", projectileDebugEventPayload(projectile));
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
        projectile.origin[0] + nextVelocity[0] * dt,
        projectile.origin[1] + nextVelocity[1] * dt,
        projectile.origin[2] + nextVelocity[2] * dt,
      ];
      const hit = hitsPlayer(projectile, nextOrigin, playerOrigin);
      const worldTrace = traceProjectileWorld(projectile.origin, nextOrigin);
      if (worldTrace && worldTouchPrecedesPlayerHit(projectile.origin, nextOrigin, worldTrace, hit)) {
        if (handleWorldTouch(projectile, worldTrace, nextVelocity, playerOrigin, now)) {
          active.push(projectile);
          continue;
        }
        continue;
      }
      projectile.origin = nextOrigin;
      projectile.velocity = nextVelocity;
      syncMesh(projectile);
      recordProjectileDebugEvent("move", projectileDebugEventPayload(projectile));
      if (hit.hit) {
        if (projectile.profile.projectileSplashDamage && projectile.profile.projectileSplashRadius) {
          applySplashDamage(projectile, hit.hitPoint, playerOrigin, now, "hit");
          emitProjectileExplosion(projectile, hit.hitPoint);
          playProjectileSound(projectileExplosionSound(projectile.profile), projectile);
        } else {
          const died = options.damagePlayer(projectile.damage, { inflictorOrigin: hit.hitPoint });
          if (!died) consumePlayerPainRandom(projectile, projectile.damage, "hit");
          playProjectileSound(projectileHitSound(projectile.profile), projectile);
        }
        options.markTrace("enemy-projectile-hit", {
          damage: projectile.damage,
          distance: hit.distance,
          projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
          source: projectile.sourceEntityIndex,
        });
        recordProjectileDebugEvent("impact", {
          ...projectileDebugEventPayload(projectile),
          impactResult: "remove",
        });
        recordProjectileDebugEvent("remove", projectileDebugEventPayload(projectile));
        remove(projectile);
        continue;
      }
      active.push(projectile);
    }
    projectiles = active;
  }

  function traceProjectileWorld(
    start: Vec3,
    end: Vec3,
  ): QuakeEnemyProjectileWorldTrace | null {
    if (options.traceLine) return options.traceLine(start, end);
    return options.hasLineOfSight(start, end) ? null : {
      fraction: 0,
      end,
      planeNormal: null,
    };
  }

  function worldTouchPrecedesPlayerHit(
    start: Vec3,
    end: Vec3,
    trace: QuakeEnemyProjectileWorldTrace,
    hit: QuakeDamageTraceResult,
  ): boolean {
    if (!hit.hit) return true;
    return traceTravelDistance(start, end, trace) <= hit.distance;
  }

  function handleWorldTouch(
    projectile: QuakeEnemyProjectile,
    trace: QuakeEnemyProjectileWorldTrace,
    nextVelocity: Vec3,
    playerOrigin: [number, number, number],
    now: number,
  ): boolean {
    const behavior = projectileWorldTouchBehavior(projectile.profile);
    if (behavior === "bounce" && bounceProjectile(projectile, trace, nextVelocity)) {
      playProjectileSound(projectileWorldTouchSound(projectile.profile), projectile);
      options.markTrace("enemy-projectile-bounce", {
        entity: trace.entityIndex ?? null,
        fraction: trace.fraction,
        projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
        source: projectile.sourceEntityIndex,
      });
      syncMesh(projectile);
      recordProjectileDebugEvent("impact", {
        ...projectileDebugEventPayload(projectile),
        impactResult: "keep",
        trace: projectileDebugTrace(trace),
      });
      return true;
    }
    if (behavior === "stop") {
      projectile.origin = [...trace.end] as Vec3;
      projectile.velocity = [0, 0, 0];
      playProjectileSound(projectileWorldTouchSound(projectile.profile), projectile);
      options.markTrace("enemy-projectile-stop", {
        entity: trace.entityIndex ?? null,
        fraction: trace.fraction,
        projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
        source: projectile.sourceEntityIndex,
      });
      syncMesh(projectile);
      recordProjectileDebugEvent("impact", {
        ...projectileDebugEventPayload(projectile),
        impactResult: "stop",
        trace: projectileDebugTrace(trace),
      });
      return true;
    }
    applySplashDamage(projectile, trace.end, playerOrigin, now, "blocked");
    emitProjectileExplosion(projectile, trace.end);
    playProjectileSound(projectileWorldTouchSound(projectile.profile), projectile);
    options.markTrace("enemy-projectile-blocked", {
      damage: projectile.damage,
      entity: trace.entityIndex ?? null,
      projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
      source: projectile.sourceEntityIndex,
      splash: projectile.profile.projectileSplashDamage ?? null,
    });
    recordProjectileDebugEvent("impact", {
      ...projectileDebugEventPayload(projectile),
      impactResult: "remove",
      trace: projectileDebugTrace(trace),
    });
    recordProjectileDebugEvent("remove", projectileDebugEventPayload(projectile));
    remove(projectile);
    return false;
  }

  function emitProjectileExplosion(projectile: QuakeEnemyProjectile, origin: Vec3): void {
    if (!projectile.profile.projectileSplashDamage || !projectile.profile.projectileSplashRadius) return;
    const projectileClassname = projectile.profile.projectileClassname ?? "enemy_projectile_magic";
    options.onExplosion?.({
      flavor: enemyProjectileExplosionFlavor(projectileClassname),
      origin: [...origin] as Vec3,
      projectile: projectileClassname,
      radiusUnits: projectile.profile.projectileSplashRadius / QUAKE_COLLISION_UNIT_SCALE,
      sourceEntityIndex: projectile.sourceEntityIndex,
    });
  }

  function enemyProjectileExplosionFlavor(projectileClassname: string): QuakeEnemyProjectileExplosionEvent["flavor"] {
    if (projectileClassname === "enemy_projectile_lavaball") return "lava";
    if (projectileClassname === "enemy_projectile_grenade") return "grenade";
    return "rocket";
  }

  function bounceProjectile(
    projectile: QuakeEnemyProjectile,
    trace: QuakeEnemyProjectileWorldTrace,
    velocity: Vec3,
  ): boolean {
    const normal = trace.planeNormal;
    if (!normal) return false;
    projectile.origin = [
      trace.end[0] + normal[0] * COLLISION_EPSILON,
      trace.end[1] + normal[1] * COLLISION_EPSILON,
      trace.end[2] + normal[2] * COLLISION_EPSILON,
    ];
    const nextProjectileVelocity = stopTinyVelocity(clipVelocity(
      velocity,
      normal,
      QUAKE_MONSTER_PROJECTILE_BOUNCE_OVERBOUNCE,
    ));
    projectile.velocity = normal[2] > QUAKE_MONSTER_PROJECTILE_BOUNCE_GROUND_NORMAL_Z &&
      dotVec3(normal, nextProjectileVelocity) < QUAKE_MONSTER_PROJECTILE_BOUNCE_GROUND_STOP_SPEED
      ? [0, 0, 0]
      : nextProjectileVelocity;
    return true;
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
    const playerDamageOrigin = options.playerDamageOrigin(playerOrigin);
    const rawDistance = Math.sqrt(distanceSq3(origin, playerDamageOrigin));
    const compensatedDistance = reason === "hit" ? Math.max(0, rawDistance - projectile.radius) : rawDistance;
    if (compensatedDistance > splashRadius) {
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
    if (!options.hasLineOfSight(origin, playerDamageOrigin)) {
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
    const distanceUnits = compensatedDistance / QUAKE_COLLISION_UNIT_SCALE;
    const damage = Math.max(1, splashDamage - distanceUnits * 0.5);
    const died = options.damagePlayer(damage, { inflictorOrigin: origin });
    if (!died) consumePlayerPainRandom(projectile, damage, reason);
    options.markTrace("enemy-projectile-splash", {
      damage,
      distanceUnits,
      hit: true,
      projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
      radiusCompensationUnits: reason === "hit" ? projectile.radius / QUAKE_COLLISION_UNIT_SCALE : 0,
      rawDistanceUnits: rawDistance / QUAKE_COLLISION_UNIT_SCALE,
      reason: "hit",
      source: projectile.sourceEntityIndex,
      time: now,
      trigger: reason,
    });
    return true;
  }

  function consumePlayerPainRandom(
    projectile: QuakeEnemyProjectile,
    damage: number,
    reason: string,
  ): void {
    options.consumePlayerPainRandom?.({
      damage,
      projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
      reason,
      sourceEntityIndex: projectile.sourceEntityIndex,
    });
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
      rotation: [0, 0, normalizeProjectileYaw(yaw, Boolean(model))],
      scale: projectile.profile.projectileScale ?? (model?.renderScale ? 1 / model.renderScale : 1),
    });
  }

  function remove(projectile: QuakeEnemyProjectile): void {
    projectile.handle?.remove();
    projectile.handle = null;
  }

  function playProjectileSound(soundPath: string | null, projectile: QuakeEnemyProjectile): void {
    if (!soundPath) return;
    const volume = projectileSoundVolume(projectile.profile);
    const played = options.playSound?.(soundPath, { volume }) === true;
    options.markTrace("enemy-projectile-sound", {
      played,
      projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
      source: projectile.sourceEntityIndex,
      sound: soundPath,
      volume,
    });
  }

  function projectileHitSound(profile: QuakeMonsterCombatProfile): string | null {
    if (profile.projectileClassname === "enemy_projectile_zombie_grenade") return "zombie/z_hit.wav";
    return null;
  }

  function projectileExplosionSound(profile: QuakeMonsterCombatProfile): string | null {
    if (profile.projectileClassname === "enemy_projectile_grenade") return "weapons/r_exp3.wav";
    return projectileHitSound(profile);
  }

  function projectileLaunchSound(profile: QuakeMonsterCombatProfile): string | null {
    if (profile.projectileClassname === "enemy_projectile_grenade") return "weapons/grenade.wav";
    if (profile.projectileClassname === "enemy_projectile_zombie_grenade") return "zombie/z_shot1.wav";
    if (profile.projectileModelPath === "progs/w_spike.mdl") return "wizard/wattack.wav";
    if (profile.projectileModelPath === "progs/lavaball.mdl") return "boss1/throw.wav";
    return null;
  }

  function projectileWorldTouchSound(profile: QuakeMonsterCombatProfile): string | null {
    if (profile.projectileClassname === "enemy_projectile_grenade") return "weapons/bounce.wav";
    if (profile.projectileClassname === "enemy_projectile_zombie_grenade") return "zombie/z_miss.wav";
    return null;
  }

  function projectileSoundVolume(_profile: QuakeMonsterCombatProfile): number {
    return 1;
  }

  function projectileDebugEventPayload(projectile: QuakeEnemyProjectile): Omit<
    QuakeEnemyProjectileDebugEvent,
    "at" | "seq" | "type"
  > {
    const splashRadius = projectile.profile.projectileSplashRadius;
    return {
      damage: projectile.damage,
      expiresAt: projectile.expiresAt,
      modelPath: projectile.profile.projectileModelPath,
      origin: [...projectile.origin] as Vec3,
      projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
      projectileId: projectile.debugId,
      radiusQuakeUnits: projectile.radius / QUAKE_COLLISION_UNIT_SCALE,
      sourceEntityIndex: projectile.sourceEntityIndex,
      splashDamage: projectile.profile.projectileSplashDamage,
      splashRadiusQuakeUnits: splashRadius === undefined ? undefined : splashRadius / QUAKE_COLLISION_UNIT_SCALE,
      velocity: [...projectile.velocity] as Vec3,
    };
  }

  function projectileDebugTrace(
    trace: QuakeEnemyProjectileWorldTrace,
  ): QuakeEnemyProjectileDebugEvent["trace"] {
    return {
      classname: trace.classname ?? null,
      end: [...trace.end] as Vec3,
      entityIndex: trace.entityIndex ?? null,
      fraction: trace.fraction,
    };
  }

  function recordProjectileDebugEvent(
    type: QuakeEnemyProjectileDebugEvent["type"],
    payload: Omit<QuakeEnemyProjectileDebugEvent, "at" | "seq" | "type">,
  ): void {
    if (!projectileDebugCaptureEnabled) return;
    projectileDebugCaptureEvents.push({
      seq: projectileDebugEventSeq++,
      at: performance.now(),
      type,
      ...payload,
    });
    if (projectileDebugCaptureEvents.length > QUAKE_ENEMY_PROJECTILE_DEBUG_CAPTURE_LIMIT) {
      projectileDebugCaptureEvents = projectileDebugCaptureEvents.slice(-QUAKE_ENEMY_PROJECTILE_DEBUG_CAPTURE_LIMIT);
    }
  }

  return {
    activeCount,
    clear,
    debugClearProjectileCapture,
    debugProjectileCapture,
    debugSetProjectileCaptureEnabled,
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
    projectileWorldTouch: quakecProjectileWorldTouch(event),
    range: baseProfile.range,
    wakeDelayMs: baseProfile.wakeDelayMs,
    windupMs: baseProfile.windupMs,
  };
}

function quakecProjectileWorldTouch(
  event: QuakeMonsterProjectileFrameEvent,
): QuakeMonsterCombatProfile["projectileWorldTouch"] {
  if (event.classname === "enemy_projectile_grenade") return "bounce";
  if (event.classname === "enemy_projectile_zombie_grenade") return "stop";
  return undefined;
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

function projectileWorldTouchBehavior(profile: QuakeMonsterCombatProfile): "bounce" | "explode" | "stop" {
  return profile.projectileWorldTouch ?? "explode";
}

function traceTravelDistance(
  start: Vec3,
  end: Vec3,
  trace: QuakeEnemyProjectileWorldTrace,
): number {
  const travel = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) || 1;
  return travel * Math.max(0, Math.min(1, trace.fraction));
}

function clipVelocity(velocity: Vec3, normal: Vec3, overbounce: number): Vec3 {
  const backoff = dotVec3(velocity, normal) * overbounce;
  return [
    velocity[0] - normal[0] * backoff,
    velocity[1] - normal[1] * backoff,
    velocity[2] - normal[2] * backoff,
  ];
}

function stopTinyVelocity(velocity: Vec3): Vec3 {
  return velocity.map((value) =>
    Math.abs(value) < QUAKE_MONSTER_PROJECTILE_BOUNCE_STOP_EPSILON ? 0 : value
  ) as Vec3;
}

function normalizeProjectileYaw(yaw: number, hasAliasModel = false): number {
  return hasAliasModel ? quakeAliasModelRenderYaw(yaw) : normalizeQuakeRenderYaw(yaw);
}
