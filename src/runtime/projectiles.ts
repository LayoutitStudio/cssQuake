import type { Vec3 } from "@layoutit/polycss";

import { COLLISION_EPSILON } from "./constants";

export interface QuakeProjectileTrace {
  fraction: number;
  end: Vec3;
  planeNormal: Vec3 | null;
  entityIndex?: number;
  classname?: string;
}

export interface QuakeProjectileState<Profile> {
  direction: Vec3;
  expiresAt: number;
  gravity?: number;
  origin: Vec3;
  profile: Profile;
  speed: number;
  velocity?: Vec3;
}

type QuakeProjectileImpactResult = "keep" | "remove" | void;

export interface QuakeProjectilesControllerOptions<Projectile extends QuakeProjectileState<unknown>> {
  canSimulate(): boolean;
  onExpire?(projectile: Projectile, now: number): void;
  onImpact(projectile: Projectile, trace: QuakeProjectileTrace, now: number): QuakeProjectileImpactResult;
  onMove?(projectile: Projectile): void;
  onRemove?(projectile: Projectile): void;
  onSpawn?(projectile: Projectile): void;
  trace(projectile: Projectile, start: Vec3, end: Vec3): QuakeProjectileTrace | null;
}

export interface QuakeProjectilesController<Projectile extends QuakeProjectileState<unknown>> {
  activeCount(): number;
  reset(): void;
  spawn(projectile: Projectile): void;
}

export function createQuakeProjectilesController<Projectile extends QuakeProjectileState<unknown>>({
  canSimulate,
  onExpire,
  onImpact,
  onMove,
  onRemove,
  onSpawn,
  trace,
}: QuakeProjectilesControllerOptions<Projectile>): QuakeProjectilesController<Projectile> {
  let animationFrame: number | null = null;
  let lastFrameAt = 0;
  let projectiles: Projectile[] = [];

  function activeCount(): number {
    return projectiles.length;
  }

  function reset(): void {
    lastFrameAt = 0;
    for (const projectile of projectiles) onRemove?.(projectile);
    projectiles = [];
    cancelFrame();
  }

  function spawn(projectile: Projectile): void {
    if (!projectiles.length) lastFrameAt = 0;
    projectiles.push(projectile);
    onSpawn?.(projectile);
    startFrame();
  }

  function startFrame(): void {
    if (animationFrame !== null || typeof window === "undefined") return;
    animationFrame = window.requestAnimationFrame(tick);
  }

  function cancelFrame(): void {
    if (animationFrame === null || typeof window === "undefined") return;
    window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function tick(frameNow: number): void {
    animationFrame = null;
    if (!projectiles.length) {
      lastFrameAt = 0;
      return;
    }
    if (!canSimulate()) {
      lastFrameAt = 0;
      startFrame();
      return;
    }
    const dt = lastFrameAt > 0 ? Math.max(0, (frameNow - lastFrameAt) / 1000) : 0.0167;
    lastFrameAt = frameNow;
    moveProjectiles(frameNow, dt);
    if (projectiles.length) startFrame();
  }

  function moveProjectiles(now: number, dt: number): void {
    const active: Projectile[] = [];
    for (const projectile of projectiles) {
      if (now >= projectile.expiresAt) {
        onExpire?.(projectile, now);
        onRemove?.(projectile);
        continue;
      }
      const motion = projectileMotion(projectile, dt);
      const distance = Math.hypot(
        motion.end[0] - projectile.origin[0],
        motion.end[1] - projectile.origin[1],
        motion.end[2] - projectile.origin[2],
      );
      if (distance <= COLLISION_EPSILON) {
        active.push(projectile);
        continue;
      }
      const impact = trace(projectile, projectile.origin, motion.end);
      if (impact && impact.fraction < 1) {
        projectile.origin = impact.end;
        if (projectile.velocity || projectile.gravity) projectile.velocity = motion.velocity;
        if (onImpact(projectile, impact, now) === "keep") {
          onMove?.(projectile);
          active.push(projectile);
        } else {
          onRemove?.(projectile);
        }
        continue;
      }
      projectile.origin = motion.end;
      if (projectile.velocity || projectile.gravity) projectile.velocity = motion.velocity;
      onMove?.(projectile);
      active.push(projectile);
    }
    projectiles = active;
  }

  return {
    activeCount,
    reset,
    spawn,
  };
}

function projectileMotion<Projectile extends QuakeProjectileState<unknown>>(
  projectile: Projectile,
  dt: number,
): { end: Vec3; velocity: Vec3 } {
  const velocity = projectile.velocity ?? [
    projectile.direction[0] * projectile.speed,
    projectile.direction[1] * projectile.speed,
    projectile.direction[2] * projectile.speed,
  ];
  const gravity = Math.max(0, projectile.gravity ?? 0);
  if (gravity <= 0) {
    return {
      end: [
        projectile.origin[0] + velocity[0] * dt,
        projectile.origin[1] + velocity[1] * dt,
        projectile.origin[2] + velocity[2] * dt,
      ],
      velocity,
    };
  }

  return {
    end: [
      projectile.origin[0] + velocity[0] * dt,
      projectile.origin[1] + velocity[1] * dt,
      projectile.origin[2] + velocity[2] * dt - 0.5 * gravity * dt * dt,
    ],
    velocity: [
      velocity[0],
      velocity[1],
      velocity[2] - gravity * dt,
    ],
  };
}
