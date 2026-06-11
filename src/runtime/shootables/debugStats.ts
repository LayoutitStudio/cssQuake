import type {
  QuakeShootablesVisibilityChurnStats,
  QuakeShootablesVisibilitySnapshot,
} from "../debug/churnStats";
import type { QuakeShootableState } from "./state";

export interface QuakeShootablesDebugStats {
  totalShootables: number;
  liveShootables: number;
  deadShootables: number;
  enemyShootables: number;
  liveEnemyShootables: number;
  visibleShootables: number;
  visibleEnemyShootables: number;
  mountedShootables: number;
  mountedEnemyShootables: number;
  prewarmedShootables: number;
  prewarmedEnemyShootables: number;
  meshHandles: number;
  frameHandles: number;
  enemyFrameHandles: number;
  desiredPrewarm: number;
  prewarmQueue: number;
  animationFramePrewarmQueue: number;
  visibilityChurn: QuakeShootablesVisibilityChurnStats;
}

export interface QuakeShootableDebugCullingEntry {
  entityIndex: number;
  classname: string;
  modelSource: string | null;
  origin: [number, number, number];
  leafIndex: number | null;
  enemy: boolean;
  dead: boolean;
  health: number;
  visible: boolean;
  mounted: boolean;
  prewarmed: boolean;
  inPvs: boolean | null;
  oversizedRenderVolume: boolean;
  distance: number;
  distanceSq: number;
  usingUnmountDistance: boolean;
  withinMountDistance: boolean;
  withinUnmountDistance: boolean;
  withinPrewarmDistance: boolean;
  inFrontOfCamera: boolean | null;
  visibleTargetCount: number | null;
  lineOfSightTargetCount: number | null;
  canMount: boolean;
  canPrewarm: boolean;
  strictMountCandidate: boolean;
  visibilityGrace: boolean;
  visibilityGraceRemainingMs: number;
  mountCandidate: boolean;
  prewarmCandidate: boolean;
  desiredMounted: boolean;
  desiredPrewarmed: boolean;
  budgetBlocked: boolean;
  blockReasons: string[];
  handleCount: number;
  frameHandles: number;
  yaw: number;
  animationFrame: number | null;
  animationMode: string | null;
  quakecChain: string | null;
  attackVisual: string | null;
  awake: boolean | null;
  pendingAttack: boolean;
  movetargetEntityIndex: number | null;
}

export interface QuakeShootablesDebugCullingSnapshot {
  visibleLeafCount: number | null;
  limits: {
    mountDistance: number;
    unmountDistance: number;
    prewarmDistance: number;
    visibilityGraceMs: number;
    maxMounted: number;
    maxMountedCorpses: number;
    maxPrewarmed: number;
  };
  mountedIndexes: number[];
  visibleIndexes: number[];
  prewarmedIndexes: number[];
  desiredMountedIndexes: number[];
  desiredPrewarmIndexes: number[];
  candidateIndexes: number[];
  prewarmCandidateIndexes: number[];
  entries: QuakeShootableDebugCullingEntry[];
}

export interface QuakeShootablesDebugStatsOptions {
  animationFramePrewarmQueue: number;
  desiredPrewarm: number;
  prewarmQueue: number;
  shootables: Iterable<QuakeShootableState>;
  visibilityChurn: QuakeShootablesVisibilityChurnStats;
  visibilitySnapshot: QuakeShootablesVisibilitySnapshot;
}

export function quakeShootablesDebugStats({
  animationFramePrewarmQueue,
  desiredPrewarm,
  prewarmQueue,
  shootables,
  visibilityChurn,
  visibilitySnapshot,
}: QuakeShootablesDebugStatsOptions): QuakeShootablesDebugStats {
  let deadShootables = 0;
  let enemyShootables = 0;
  let liveEnemyShootables = 0;
  let totalShootables = 0;
  for (const shootable of shootables) {
    totalShootables++;
    if (shootable.dead) deadShootables++;
    if (shootable.enemy) {
      enemyShootables++;
      if (!shootable.dead) liveEnemyShootables++;
    }
  }
  return {
    totalShootables,
    liveShootables: totalShootables - deadShootables,
    deadShootables,
    enemyShootables,
    liveEnemyShootables,
    visibleShootables: visibilitySnapshot.visibleIndexes.size,
    visibleEnemyShootables: visibilitySnapshot.visibleEnemies,
    mountedShootables: visibilitySnapshot.mountedIndexes.size,
    mountedEnemyShootables: visibilitySnapshot.mountedEnemies,
    prewarmedShootables: visibilitySnapshot.prewarmedIndexes.size,
    prewarmedEnemyShootables: visibilitySnapshot.prewarmedEnemies,
    meshHandles: visibilitySnapshot.meshHandles,
    frameHandles: visibilitySnapshot.frameHandles,
    enemyFrameHandles: visibilitySnapshot.enemyFrameHandles,
    desiredPrewarm,
    prewarmQueue,
    animationFramePrewarmQueue,
    visibilityChurn: { ...visibilityChurn },
  };
}
