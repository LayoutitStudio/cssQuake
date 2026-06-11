import type { Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../../types/quake";
import {
  QUAKE_POINT_HAZARD_DT_CLAMP,
  quakeFireballEmitterFromEntity,
  quakeMovePointHazards,
  quakeSpawnDueFireballs,
  type QuakeFireballEmitter,
  type QuakePointHazard,
} from "../fireballs";
import type { QuakeHazardDamage } from "../hazards";
import { distanceSq3 } from "../math";

export interface QuakePointHazardFlowOptions {
  getEntity(entityIndex: number): QuakeEntity | undefined;
  gravity: number;
  hasCurrentScene(): boolean;
  isEntityDisabled(entityIndex: number): boolean;
  isPaused(): boolean;
  onHazardsChanged(): void;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
}

export interface QuakePointHazardFlow {
  clear(): void;
  counts(): { emitters: number; hazards: number };
  hazardAt(origin: Vec3): QuakeHazardDamage | null;
  resumeAfterPause(durationMs: number): void;
  setup(entityIndexes: readonly number[]): void;
}

export function createQuakePointHazardFlow(
  options: QuakePointHazardFlowOptions,
): QuakePointHazardFlow {
  let hazards: QuakePointHazard[] = [];
  let emitters: QuakeFireballEmitter[] = [];
  let frame: number | null = null;
  let frameTime = 0;

  function clear(): void {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    hazards = [];
    emitters = [];
    frameTime = 0;
  }

  function setup(entityIndexes: readonly number[]): void {
    clear();
    const now = performance.now();
    for (const entityIndex of entityIndexes) {
      const entity = options.getEntity(entityIndex);
      if (!entity || options.isEntityDisabled(entity.index) || !entity.origin) continue;
      const emitter = quakeFireballEmitterFromEntity(entity, options.pointToPoly, now);
      if (emitter) emitters.push(emitter);
    }
    if (emitters.length) start();
  }

  function start(): void {
    if (frame !== null) return;
    frameTime = 0;
    frame = window.requestAnimationFrame(tick);
  }

  function tick(_frameNow: number): void {
    if (!options.hasCurrentScene() || (!emitters.length && !hazards.length)) {
      clear();
      return;
    }

    const now = performance.now();
    if (options.isPaused()) {
      frameTime = 0;
      frame = window.requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(QUAKE_POINT_HAZARD_DT_CLAMP, frameTime ? (now - frameTime) / 1000 : 0.0167);
    frameTime = now;
    quakeSpawnDueFireballs(
      emitters,
      hazards,
      now,
      options.isEntityDisabled,
    );
    hazards = quakeMovePointHazards(
      hazards,
      dt,
      now,
      options.gravity,
      options.isEntityDisabled,
    );
    if (hazards.length) options.onHazardsChanged();
    frame = window.requestAnimationFrame(tick);
  }

  function resumeAfterPause(durationMs: number): void {
    for (const emitter of emitters) emitter.nextSpawnAt += durationMs;
    for (const hazard of hazards) {
      if (hazard.expiresAt !== undefined) hazard.expiresAt += durationMs;
    }
  }

  function hazardAt(origin: Vec3): QuakeHazardDamage | null {
    let hazard: QuakeHazardDamage | null = null;
    const now = performance.now();
    for (const pointHazard of hazards) {
      if (options.isEntityDisabled(pointHazard.entityIndex)) continue;
      if (pointHazard.expiresAt !== undefined && pointHazard.expiresAt <= now) continue;
      if (distanceSq3(origin, pointHazard.origin) > pointHazard.radiusSq) continue;
      pointHazard.expiresAt = now;
      hazard = strongerHazard(hazard, {
        amount: pointHazard.damage,
        kind: pointHazard.kind,
      });
    }
    return hazard;
  }

  function counts(): { emitters: number; hazards: number } {
    return {
      emitters: emitters.length,
      hazards: hazards.length,
    };
  }

  return {
    clear,
    counts,
    hazardAt,
    resumeAfterPause,
    setup,
  };
}

function strongerHazard(a: QuakeHazardDamage | null, b: QuakeHazardDamage | null): QuakeHazardDamage | null {
  if (!a) return b;
  if (!b) return a;
  return b.amount > a.amount ? b : a;
}
