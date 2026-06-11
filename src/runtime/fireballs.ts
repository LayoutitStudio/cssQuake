import type { Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../types/quake";
import { QUAKE_COLLISION_UNIT_SCALE } from "./constants";
import { quakeEntityNumber } from "./entities";
import type { QuakeHazardDamage } from "./hazards";

export interface QuakePointHazard {
  entityIndex: number;
  origin: Vec3;
  radiusSq: number;
  damage: number;
  kind: QuakeHazardDamage["kind"];
  velocity?: Vec3;
  expiresAt?: number;
}

export interface QuakeFireballEmitter {
  entityIndex: number;
  origin: Vec3;
  speed: number;
  nextSpawnAt: number;
}

export const QUAKE_FIREBALL_RADIUS = 56 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_FIREBALL_DEFAULT_SPEED = 1000;
export const QUAKE_FIREBALL_DAMAGE = 20;
export const QUAKE_FIREBALL_LIFETIME_MS = 5000;
export const QUAKE_FIREBALL_INITIAL_DELAY_MS = 5000;
export const QUAKE_FIREBALL_MIN_WAIT_MS = 3000;
export const QUAKE_FIREBALL_WAIT_JITTER_MS = 5000;
export const QUAKE_FIREBALL_DRIFT_SPEED = 50 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_FIREBALL_SPEED_JITTER = 200 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_POINT_HAZARD_DT_CLAMP = 0.05;

export function quakeFireballEmitterFromEntity(
  entity: QuakeEntity,
  pointToPoly: (point: { x: number; y: number; z: number }) => Vec3,
  now: number,
  random = Math.random,
): QuakeFireballEmitter | null {
  if (!entity.origin) return null;
  const rawSpeed = quakeEntityNumber(entity, "speed", QUAKE_FIREBALL_DEFAULT_SPEED);
  return {
    entityIndex: entity.index,
    origin: pointToPoly(entity.origin),
    speed: quakeFireballSpeed(rawSpeed),
    nextSpawnAt: now + random() * QUAKE_FIREBALL_INITIAL_DELAY_MS,
  };
}

export function quakeFireballSpeed(rawSpeed: number): number {
  return (rawSpeed > 0 ? rawSpeed : QUAKE_FIREBALL_DEFAULT_SPEED) * QUAKE_COLLISION_UNIT_SCALE;
}

export function quakeSpawnDueFireballs(
  emitters: QuakeFireballEmitter[],
  hazards: QuakePointHazard[],
  now: number,
  isDisabled: (entityIndex: number) => boolean,
  random = Math.random,
): number {
  let spawned = 0;
  for (const emitter of emitters) {
    if (isDisabled(emitter.entityIndex)) continue;
    if (now < emitter.nextSpawnAt) continue;
    hazards.push(quakeCreateFireballHazard(emitter, now, random));
    emitter.nextSpawnAt = now + QUAKE_FIREBALL_MIN_WAIT_MS + random() * QUAKE_FIREBALL_WAIT_JITTER_MS;
    spawned += 1;
  }
  return spawned;
}

export function quakeCreateFireballHazard(
  emitter: QuakeFireballEmitter,
  now: number,
  random = Math.random,
): QuakePointHazard {
  return {
    entityIndex: emitter.entityIndex,
    origin: [...emitter.origin] as Vec3,
    radiusSq: QUAKE_FIREBALL_RADIUS * QUAKE_FIREBALL_RADIUS,
    damage: QUAKE_FIREBALL_DAMAGE,
    kind: "fireball",
    velocity: [
      quakeRandomRange(-QUAKE_FIREBALL_DRIFT_SPEED, QUAKE_FIREBALL_DRIFT_SPEED, random),
      quakeRandomRange(-QUAKE_FIREBALL_DRIFT_SPEED, QUAKE_FIREBALL_DRIFT_SPEED, random),
      emitter.speed + random() * QUAKE_FIREBALL_SPEED_JITTER,
    ],
    expiresAt: now + QUAKE_FIREBALL_LIFETIME_MS,
  };
}

export function quakeMovePointHazards(
  hazards: readonly QuakePointHazard[],
  dt: number,
  now: number,
  gravity: number,
  isDisabled: (entityIndex: number) => boolean,
): QuakePointHazard[] {
  const active: QuakePointHazard[] = [];
  for (const hazard of hazards) {
    if (isDisabled(hazard.entityIndex)) continue;
    if (hazard.expiresAt !== undefined && hazard.expiresAt <= now) continue;
    if (hazard.velocity) {
      hazard.velocity[2] -= gravity * dt;
      hazard.origin = [
        hazard.origin[0] + hazard.velocity[0] * dt,
        hazard.origin[1] + hazard.velocity[1] * dt,
        hazard.origin[2] + hazard.velocity[2] * dt,
      ];
    }
    active.push(hazard);
  }
  return active;
}

function quakeRandomRange(min: number, max: number, random: () => number): number {
  return min + random() * (max - min);
}
