import type {
  QuakeShootablesVisibilityChurnStats,
  QuakeShootablesVisibilitySnapshot,
} from "../debug/churnStats";
import type { QuakeCombatBudgetDebugStats } from "./combatBudget";
import type { QuakeShootableState } from "./state";

export interface QuakeShootablesDebugStats {
  combatBudget: QuakeCombatBudgetDebugStats;
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
  inPrewarmPvs: boolean | null;
  pvsSource: "current" | "prewarm-extra" | "oversized" | "none" | "unknown";
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
  quakecIdealYaw: number | null;
  quakecMovementCall: string | null;
  quakecMovementHandledStep: boolean | null;
  quakecMovementStateName: string | null;
  quakecMovementUnitsRemaining: number | null;
  quakecPartialGround: boolean | null;
  quakecStateCalls: string[];
  quakecStateChain: string | null;
  quakecStateChainCycleEnd: boolean | null;
  quakecStateFrame: string | null;
  quakecStateFrameIndex: number | null;
  quakecStateName: string | null;
  quakecStateNext: string | null;
  attackVisual: string | null;
  awake: boolean | null;
  currentTarget: string | null;
  oldTarget: string | null;
  pendingAttack: boolean;
  pendingAttackFireInMs: number | null;
  pendingAttackQuakecChain: string | null;
  pendingAttackTarget: [number, number, number] | null;
  movetargetEntityIndex: number | null;
  movetargetOrigin: [number, number, number] | null;
  movetargetTarget: string | null;
  movetargetTargetname: string | null;
  monsterJumpTouchedTriggerEntityIndex: number | null;
  moveGoalDecisions: QuakeShootableDebugMoveGoalDecision[];
}

export interface QuakeShootableDebugMoveGoalDecision {
  atMs: number;
  details: Record<string, boolean | number | string | null>;
  kind: string;
}

export interface QuakeShootablesDebugVisibilitySyncSnapshot {
  atMs: number;
  force: boolean;
  origin: [number, number, number];
  visibleLeafCount: number | null;
  prewarmLeafCount: number | null;
  prewarmExtraLeafCount: number | null;
  visibleLeafIndexes: number[] | null;
  prewarmLeafIndexes: number[] | null;
  prewarmExtraLeafIndexes: number[] | null;
  candidateIndexes: number[];
  corpseCandidateIndexes: number[];
  prewarmCandidateIndexes: number[];
  desiredMountedIndexes: number[];
  desiredPrewarmIndexes: number[];
  beforeMountedIndexes: number[];
  beforeVisibleIndexes: number[];
  beforePrewarmedIndexes: number[];
  afterMountedIndexes: number[];
  afterVisibleIndexes: number[];
  afterPrewarmedIndexes: number[];
  selectionChanged: boolean;
  selectionApplied: boolean;
  meshHandlesCreated: number;
  meshHandlesRemoved: number;
  frameHandlesCreated: number;
  frameHandlesRemoved: number;
}

export interface QuakeShootablesDebugCullingSnapshot {
  visibleLeafCount: number | null;
  prewarmLeafCount: number | null;
  prewarmExtraLeafCount: number | null;
  visibleLeafIndexes: number[] | null;
  prewarmLeafIndexes: number[] | null;
  prewarmExtraLeafIndexes: number[] | null;
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
  lastVisibilitySync: QuakeShootablesDebugVisibilitySyncSnapshot | null;
  entries: QuakeShootableDebugCullingEntry[];
}

export interface QuakeShootablesDebugStatsOptions {
  animationFramePrewarmQueue: number;
  combatBudget: QuakeCombatBudgetDebugStats;
  desiredPrewarm: number;
  prewarmQueue: number;
  shootables: Iterable<QuakeShootableState>;
  visibilityChurn: QuakeShootablesVisibilityChurnStats;
  visibilitySnapshot: QuakeShootablesVisibilitySnapshot;
}

export function quakeShootablesDebugStats({
  animationFramePrewarmQueue,
  combatBudget,
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
    combatBudget,
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
