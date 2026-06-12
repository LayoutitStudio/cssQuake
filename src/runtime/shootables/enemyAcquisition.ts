import type { Vec3 } from "@layoutit/polycss";

export type QuakeEnemyAcquisitionRange = "melee" | "near" | "mid" | "far";
export type QuakeEnemyAcquisitionEntityId = number | string;

export type QuakeEnemyAcquisitionRejectReason =
  | "acquired"
  | "behind-mid"
  | "behind-near"
  | "dead-target"
  | "far"
  | "invisibility"
  | "los-budget"
  | "no-client"
  | "non-player-proxy"
  | "not-visible"
  | "notarget"
  | "same-enemy";

export interface QuakeEnemyAcquisitionActor {
  classname: string;
  currentEnemyId?: QuakeEnemyAcquisitionEntityId | null;
  id: QuakeEnemyAcquisitionEntityId;
  origin: Vec3;
  spawnflags?: number;
  viewOffset?: Vec3;
  yaw?: number;
}

export interface QuakeEnemyAcquisitionTarget {
  classname: string;
  enemy?: QuakeEnemyAcquisitionTarget | null;
  flags?: number;
  health?: number;
  id: QuakeEnemyAcquisitionEntityId;
  inPvs?: boolean;
  invisible?: boolean;
  items?: number;
  notarget?: boolean;
  origin: Vec3;
  showHostileUntilSeconds?: number;
  viewOffset?: Vec3;
}

export interface QuakeEnemyAcquisitionSightEntity {
  entity: QuakeEnemyAcquisitionTarget;
  seenAtSeconds: number;
}

export interface QuakeEnemyAcquisitionInput {
  checkClient?: QuakeEnemyAcquisitionTarget | null;
  hasLineOfSight(start: Vec3, end: Vec3, candidate: QuakeEnemyAcquisitionTarget): boolean;
  monster: QuakeEnemyAcquisitionActor;
  nowSeconds: number;
  sightEntity?: QuakeEnemyAcquisitionSightEntity | null;
  sourceUnitScale?: number;
  trySpendLineOfSightCheck?: () => boolean;
  visibilityCache?: QuakeEnemyAcquisitionVisibilityCache;
}

export interface QuakeEnemyAcquisitionDecision {
  acquired: boolean;
  candidateId: QuakeEnemyAcquisitionEntityId | null;
  deferred: boolean;
  inFront: boolean | null;
  lineOfSight: "budget-denied" | "cached" | "computed" | "not-needed";
  range: QuakeEnemyAcquisitionRange | null;
  reason: QuakeEnemyAcquisitionRejectReason;
  target: QuakeEnemyAcquisitionTarget | null;
  targetId: QuakeEnemyAcquisitionEntityId | null;
  usedSightEntity: boolean;
  visible: boolean | null;
}

export interface QuakeEnemyAcquisitionVisibilityCache {
  clear(): void;
  get(
    monster: QuakeEnemyAcquisitionActor,
    candidate: QuakeEnemyAcquisitionTarget,
    nowSeconds: number,
  ): boolean | undefined;
  set(
    monster: QuakeEnemyAcquisitionActor,
    candidate: QuakeEnemyAcquisitionTarget,
    nowSeconds: number,
    visible: boolean,
  ): void;
  size(): number;
}

export interface QuakeEnemyAcquisitionVisibilityCacheOptions {
  maxEntries?: number;
  ttlSeconds?: number;
}

interface QuakeEnemyAcquisitionClientSelection {
  candidate: QuakeEnemyAcquisitionTarget | null;
  reason: "checkclient" | "no-client" | "sight-entity";
}

interface QuakeEnemyVisibilityCacheEntry {
  lastTouchedAtSeconds: number;
  sequence: number;
  visible: boolean;
}

const QUAKE_FL_NOTARGET = 128;
const QUAKE_IT_INVISIBILITY = 524_288;
const QUAKE_FINDTARGET_SIGHT_ENTITY_WINDOW_SECONDS = 0.1;
const QUAKE_FINDTARGET_AMBUSH_OR_ZOMBIE_CRUCIFIED_FLAGS = 3;
const QUAKE_ACQUISITION_CACHE_DEFAULT_TTL_SECONDS = 0.1;
const QUAKE_ACQUISITION_CACHE_DEFAULT_MAX_ENTRIES = 64;
const QUAKE_ACQUISITION_EPSILON = 0.0001;
const QUAKE_INFRONT_DOT_MIN = 0.3;

export const QUAKE_ENEMY_ACQUISITION_RANGE_UNITS = Object.freeze({
  far: 1000,
  melee: 120,
  mid: 500,
});

export function createQuakeEnemyAcquisitionVisibilityCache(
  options: QuakeEnemyAcquisitionVisibilityCacheOptions = {},
): QuakeEnemyAcquisitionVisibilityCache {
  const ttlSeconds = Math.max(0, options.ttlSeconds ?? QUAKE_ACQUISITION_CACHE_DEFAULT_TTL_SECONDS);
  const maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? QUAKE_ACQUISITION_CACHE_DEFAULT_MAX_ENTRIES));
  const entries = new Map<string, QuakeEnemyVisibilityCacheEntry>();
  let sequence = 0;

  return {
    clear: () => entries.clear(),
    get: (monster, candidate, nowSeconds) => {
      const key = quakeEnemyAcquisitionVisibilityCacheKey(monster, candidate);
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (nowSeconds - entry.lastTouchedAtSeconds > ttlSeconds) {
        entries.delete(key);
        return undefined;
      }
      entry.lastTouchedAtSeconds = nowSeconds;
      entry.sequence = ++sequence;
      return entry.visible;
    },
    set: (monster, candidate, nowSeconds, visible) => {
      const key = quakeEnemyAcquisitionVisibilityCacheKey(monster, candidate);
      entries.set(key, {
        lastTouchedAtSeconds: nowSeconds,
        sequence: ++sequence,
        visible,
      });
      while (entries.size > maxEntries) {
        const oldestKey = quakeEnemyAcquisitionOldestCacheKey(entries);
        if (!oldestKey) break;
        entries.delete(oldestKey);
      }
    },
    size: () => entries.size,
  };
}

export function quakeEnemyAcquisitionRangeFromSourceUnits(distanceUnits: number): QuakeEnemyAcquisitionRange {
  if (distanceUnits < QUAKE_ENEMY_ACQUISITION_RANGE_UNITS.melee) return "melee";
  if (distanceUnits < QUAKE_ENEMY_ACQUISITION_RANGE_UNITS.mid) return "near";
  if (distanceUnits < QUAKE_ENEMY_ACQUISITION_RANGE_UNITS.far) return "mid";
  return "far";
}

export function quakeEnemyAcquisitionRange(
  monster: Pick<QuakeEnemyAcquisitionActor, "origin" | "viewOffset">,
  target: Pick<QuakeEnemyAcquisitionTarget, "origin" | "viewOffset">,
  options: { sourceUnitScale?: number } = {},
): QuakeEnemyAcquisitionRange {
  const distance = Math.sqrt(quakeEnemyAcquisitionDistanceSq3(
    quakeEnemyAcquisitionEyeOrigin(monster),
    quakeEnemyAcquisitionEyeOrigin(target),
  ));
  return quakeEnemyAcquisitionRangeFromSourceUnits(distance / quakeEnemyAcquisitionSourceUnitScale(options.sourceUnitScale));
}

export function quakeEnemyAcquisitionInFront(
  monster: Pick<QuakeEnemyAcquisitionActor, "origin" | "yaw">,
  target: Pick<QuakeEnemyAcquisitionTarget, "origin">,
): boolean {
  const direction = quakeEnemyAcquisitionNormalizeVec3(quakeEnemyAcquisitionSubtractVec3(target.origin, monster.origin));
  const yawRadians = ((monster.yaw ?? 0) * Math.PI) / 180;
  const forward: Vec3 = [Math.cos(yawRadians), Math.sin(yawRadians), 0];
  return quakeEnemyAcquisitionDotVec3(direction, forward) > QUAKE_INFRONT_DOT_MIN;
}

export function quakeEnemyFindTarget(input: QuakeEnemyAcquisitionInput): QuakeEnemyAcquisitionDecision {
  const selected = quakeEnemyAcquisitionSelectClient(input);
  if (!selected.candidate) {
    return quakeEnemyAcquisitionDecision(input, null, {
      reason: "no-client",
      usedSightEntity: false,
    });
  }

  const candidate = selected.candidate;
  const usedSightEntity = selected.reason === "sight-entity";
  if (usedSightEntity && candidate.enemy?.id === input.monster.currentEnemyId) {
    return quakeEnemyAcquisitionDecision(input, candidate, {
      reason: "same-enemy",
      usedSightEntity,
    });
  }
  if (candidate.id === input.monster.currentEnemyId) {
    return quakeEnemyAcquisitionDecision(input, candidate, {
      reason: "same-enemy",
      usedSightEntity,
    });
  }

  if ((candidate.health ?? 1) <= 0) {
    return quakeEnemyAcquisitionDecision(input, candidate, {
      reason: "dead-target",
      usedSightEntity,
    });
  }
  if (candidate.notarget || ((candidate.flags ?? 0) & QUAKE_FL_NOTARGET) !== 0) {
    return quakeEnemyAcquisitionDecision(input, candidate, {
      reason: "notarget",
      usedSightEntity,
    });
  }
  if (candidate.invisible || ((candidate.items ?? 0) & QUAKE_IT_INVISIBILITY) !== 0) {
    return quakeEnemyAcquisitionDecision(input, candidate, {
      reason: "invisibility",
      usedSightEntity,
    });
  }

  const target = quakeEnemyAcquisitionResolvedPlayerTarget(candidate);
  if (!target) {
    return quakeEnemyAcquisitionDecision(input, candidate, {
      reason: "non-player-proxy",
      usedSightEntity,
    });
  }

  const range = quakeEnemyAcquisitionRange(input.monster, candidate, {
    sourceUnitScale: input.sourceUnitScale,
  });
  if (range === "far") {
    return quakeEnemyAcquisitionDecision(input, candidate, {
      range,
      reason: "far",
      target,
      usedSightEntity,
    });
  }

  let inFront: boolean | null = null;
  if (range === "near" && (candidate.showHostileUntilSeconds ?? 0) < input.nowSeconds) {
    inFront = quakeEnemyAcquisitionInFront(input.monster, candidate);
    if (!inFront) {
      return quakeEnemyAcquisitionDecision(input, candidate, {
        inFront,
        range,
        reason: "behind-near",
        target,
        usedSightEntity,
      });
    }
  } else if (range === "mid") {
    inFront = quakeEnemyAcquisitionInFront(input.monster, candidate);
    if (!inFront) {
      return quakeEnemyAcquisitionDecision(input, candidate, {
        inFront,
        range,
        reason: "behind-mid",
        target,
        usedSightEntity,
      });
    }
  }

  const visibility = quakeEnemyAcquisitionVisible(input, candidate);
  if (visibility.deferred) {
    return quakeEnemyAcquisitionDecision(input, candidate, {
      inFront,
      lineOfSight: "budget-denied",
      range,
      reason: "los-budget",
      target,
      usedSightEntity,
      visible: null,
    });
  }
  if (!visibility.visible) {
    return quakeEnemyAcquisitionDecision(input, candidate, {
      inFront,
      lineOfSight: visibility.lineOfSight,
      range,
      reason: "not-visible",
      target,
      usedSightEntity,
      visible: false,
    });
  }

  return quakeEnemyAcquisitionDecision(input, candidate, {
    inFront,
    lineOfSight: visibility.lineOfSight,
    range,
    reason: "acquired",
    target,
    usedSightEntity,
    visible: true,
  });
}

function quakeEnemyAcquisitionSelectClient(
  input: QuakeEnemyAcquisitionInput,
): QuakeEnemyAcquisitionClientSelection {
  const sightEntity = input.sightEntity;
  if (
    sightEntity &&
    sightEntity.seenAtSeconds >= input.nowSeconds - QUAKE_FINDTARGET_SIGHT_ENTITY_WINDOW_SECONDS &&
    ((input.monster.spawnflags ?? 0) & QUAKE_FINDTARGET_AMBUSH_OR_ZOMBIE_CRUCIFIED_FLAGS) === 0
  ) {
    return { candidate: sightEntity.entity, reason: "sight-entity" };
  }
  if (!input.checkClient || input.checkClient.inPvs === false) {
    return { candidate: null, reason: "no-client" };
  }
  return { candidate: input.checkClient, reason: "checkclient" };
}

function quakeEnemyAcquisitionResolvedPlayerTarget(
  candidate: QuakeEnemyAcquisitionTarget,
): QuakeEnemyAcquisitionTarget | null {
  if (candidate.classname === "player") return candidate;
  const enemy = candidate.enemy ?? null;
  return enemy?.classname === "player" ? enemy : null;
}

function quakeEnemyAcquisitionVisible(
  input: QuakeEnemyAcquisitionInput,
  candidate: QuakeEnemyAcquisitionTarget,
): { deferred: boolean; lineOfSight: "cached" | "computed"; visible: boolean } | { deferred: true } {
  const cached = input.visibilityCache?.get(input.monster, candidate, input.nowSeconds);
  if (cached !== undefined) return { deferred: false, lineOfSight: "cached", visible: cached };
  if (input.trySpendLineOfSightCheck && !input.trySpendLineOfSightCheck()) return { deferred: true };
  const visible = input.hasLineOfSight(
    quakeEnemyAcquisitionEyeOrigin(input.monster),
    quakeEnemyAcquisitionEyeOrigin(candidate),
    candidate,
  );
  input.visibilityCache?.set(input.monster, candidate, input.nowSeconds, visible);
  return { deferred: false, lineOfSight: "computed", visible };
}

function quakeEnemyAcquisitionDecision(
  input: QuakeEnemyAcquisitionInput,
  candidate: QuakeEnemyAcquisitionTarget | null,
  options: {
    inFront?: boolean | null;
    lineOfSight?: QuakeEnemyAcquisitionDecision["lineOfSight"];
    range?: QuakeEnemyAcquisitionRange | null;
    reason: QuakeEnemyAcquisitionRejectReason;
    target?: QuakeEnemyAcquisitionTarget | null;
    usedSightEntity: boolean;
    visible?: boolean | null;
  },
): QuakeEnemyAcquisitionDecision {
  const acquired = options.reason === "acquired";
  const target = options.target ?? (candidate ? quakeEnemyAcquisitionResolvedPlayerTarget(candidate) : null);
  return {
    acquired,
    candidateId: candidate?.id ?? null,
    deferred: options.reason === "los-budget",
    inFront: options.inFront ?? null,
    lineOfSight: options.lineOfSight ?? "not-needed",
    range: options.range ?? (candidate
      ? quakeEnemyAcquisitionRange(input.monster, candidate, { sourceUnitScale: input.sourceUnitScale })
      : null),
    reason: options.reason,
    target: acquired ? target : null,
    targetId: acquired ? target?.id ?? null : null,
    usedSightEntity: options.usedSightEntity,
    visible: options.visible ?? null,
  };
}

function quakeEnemyAcquisitionEyeOrigin(
  actor: Pick<QuakeEnemyAcquisitionActor | QuakeEnemyAcquisitionTarget, "origin" | "viewOffset">,
): Vec3 {
  return actor.viewOffset ? quakeEnemyAcquisitionAddVec3(actor.origin, actor.viewOffset) : actor.origin;
}

function quakeEnemyAcquisitionVisibilityCacheKey(
  monster: QuakeEnemyAcquisitionActor,
  candidate: QuakeEnemyAcquisitionTarget,
): string {
  const start = quakeEnemyAcquisitionEyeOrigin(monster);
  const end = quakeEnemyAcquisitionEyeOrigin(candidate);
  return `${monster.id}:${candidate.id}:${quakeEnemyAcquisitionPointKey(start)}:${quakeEnemyAcquisitionPointKey(end)}`;
}

function quakeEnemyAcquisitionPointKey(point: Vec3): string {
  return point.map((value) => Math.round(value / Math.max(QUAKE_ACQUISITION_EPSILON, 0.01))).join(",");
}

function quakeEnemyAcquisitionOldestCacheKey(entries: Map<string, QuakeEnemyVisibilityCacheEntry>): string | null {
  let oldest: { key: string; value: QuakeEnemyVisibilityCacheEntry } | null = null;
  for (const [key, value] of entries) {
    if (!oldest ||
      value.lastTouchedAtSeconds < oldest.value.lastTouchedAtSeconds ||
      (value.lastTouchedAtSeconds === oldest.value.lastTouchedAtSeconds && value.sequence < oldest.value.sequence)
    ) {
      oldest = { key, value };
    }
  }
  return oldest?.key ?? null;
}

function quakeEnemyAcquisitionSourceUnitScale(scale: number | undefined): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function quakeEnemyAcquisitionAddVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function quakeEnemyAcquisitionDistanceSq3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function quakeEnemyAcquisitionDotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function quakeEnemyAcquisitionNormalizeVec3(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length > QUAKE_ACQUISITION_EPSILON
    ? [vector[0] / length, vector[1] / length, vector[2] / length]
    : [0, 0, 1];
}

function quakeEnemyAcquisitionSubtractVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
