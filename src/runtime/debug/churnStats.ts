export type QuakeWorldVisibilitySyncReason = "force" | "leaf-change" | "no-handle" | "no-pvs" | "same-key";

export interface QuakeWorldSemanticResidencyStats {
  enabled: boolean;
  metadataAvailable: boolean;
  budget: number;
  frontierHops: number;
  currentLeafIndex: number | null;
  desiredLeaves: number;
  mountedDesiredLeaves: number;
  desiredMinusMounted: number;
  mountedMinusDesired: number;
  queuePending: number;
  maxQueuePending: number;
  converged: boolean;
  lastImmediateLeaves: number;
  lastFrontierLeaves: number;
  lastFarLeaves: number;
  lastSyncAddedLeaves: number;
  lastQueuedAddedLeaves: number;
  lastRemovedLeaves: number;
  totalQueuedAddedLeaves: number;
  totalSyncAddedLeaves: number;
  totalRemovedLeaves: number;
}

export interface QuakeWorldResidencyTransitionStats {
  prevLeafIndex: number | null;
  nextLeafIndex: number | null;
  prevVisibleFaceGroupKey: string | null;
  nextVisibleFaceGroupKey: string | null;
  transitionKey: string;
  transitionCacheHit: boolean;
  transitionCacheSize: number;
  planningMs: number;
  mutationJsMs: number;
  totalMs: number;
  scannedFaceLeafCount: number;
  visibleFaceCount: number | null;
  addCount: number;
  removeCount: number;
  deferCount: number;
  immediateAddCount: number;
  frontierAddCount: number;
  farAddCount: number;
  mountedLeafCountBefore: number;
  mountedLeafCountAfter: number;
  mountedLeafPeak: number;
  residencyQueueImmediateSize: number;
  residencyQueueFrontierSize: number;
  residencyQueueFarSize: number;
}

export interface QuakeWorldVisibilityChurnStats {
  syncCount: number;
  transitionCount: number;
  changedSyncCount: number;
  skippedSyncCount: number;
  forceSyncCount: number;
  noHandleSyncCount: number;
  noPvsSyncCount: number;
  totalSyncMs: number;
  totalTransitionPlanningMs: number;
  totalTransitionMutationJsMs: number;
  totalTransitionMs: number;
  maxSyncMs: number;
  maxTransitionTotalMs: number;
  lastSyncMs: number;
  lastTransitionPlanningMs: number;
  lastTransitionMutationJsMs: number;
  lastTransitionTotalMs: number;
  lastTransitionScannedFaceLeafCount: number;
  lastTransitionAddCount: number;
  lastTransitionRemoveCount: number;
  lastTransitionDeferCount: number;
  lastReason: QuakeWorldVisibilitySyncReason | null;
  lastPvsFaceCount: number | null;
  lastAddedLeaves: number;
  lastRemovedLeaves: number;
  lastChangedLeaves: number;
  totalAddedLeaves: number;
  totalRemovedLeaves: number;
  totalChangedLeaves: number;
  lastTransition?: QuakeWorldResidencyTransitionStats;
  semanticResidency?: QuakeWorldSemanticResidencyStats;
}

export function createQuakeWorldVisibilityChurnStats(): QuakeWorldVisibilityChurnStats {
  return {
    syncCount: 0,
    transitionCount: 0,
    changedSyncCount: 0,
    skippedSyncCount: 0,
    forceSyncCount: 0,
    noHandleSyncCount: 0,
    noPvsSyncCount: 0,
    totalSyncMs: 0,
    totalTransitionPlanningMs: 0,
    totalTransitionMutationJsMs: 0,
    totalTransitionMs: 0,
    maxSyncMs: 0,
    maxTransitionTotalMs: 0,
    lastSyncMs: 0,
    lastTransitionPlanningMs: 0,
    lastTransitionMutationJsMs: 0,
    lastTransitionTotalMs: 0,
    lastTransitionScannedFaceLeafCount: 0,
    lastTransitionAddCount: 0,
    lastTransitionRemoveCount: 0,
    lastTransitionDeferCount: 0,
    lastReason: null,
    lastPvsFaceCount: null,
    lastAddedLeaves: 0,
    lastRemovedLeaves: 0,
    lastChangedLeaves: 0,
    totalAddedLeaves: 0,
    totalRemovedLeaves: 0,
    totalChangedLeaves: 0,
  };
}

export function recordQuakeWorldVisibilitySync(
  stats: QuakeWorldVisibilityChurnStats,
  reason: QuakeWorldVisibilitySyncReason,
  startedAt: number,
  details: {
    force?: boolean;
    pvsFaceCount?: number | null;
    addedLeaves?: number;
    removedLeaves?: number;
  } = {},
): void {
  const addedLeaves = details.addedLeaves ?? 0;
  const removedLeaves = details.removedLeaves ?? 0;
  const changedLeaves = addedLeaves + removedLeaves;
  const elapsed = performance.now() - startedAt;
  stats.syncCount++;
  if (details.force) stats.forceSyncCount++;
  if (reason === "no-handle") stats.noHandleSyncCount++;
  if (reason === "no-pvs") stats.noPvsSyncCount++;
  if (changedLeaves > 0) {
    stats.changedSyncCount++;
  } else {
    stats.skippedSyncCount++;
  }
  stats.totalSyncMs += elapsed;
  stats.maxSyncMs = Math.max(stats.maxSyncMs, elapsed);
  stats.lastSyncMs = elapsed;
  stats.lastReason = reason;
  stats.lastPvsFaceCount = details.pvsFaceCount ?? null;
  stats.lastAddedLeaves = addedLeaves;
  stats.lastRemovedLeaves = removedLeaves;
  stats.lastChangedLeaves = changedLeaves;
  stats.totalAddedLeaves += addedLeaves;
  stats.totalRemovedLeaves += removedLeaves;
  stats.totalChangedLeaves += changedLeaves;
}

export function recordQuakeWorldResidencyTransition(
  stats: QuakeWorldVisibilityChurnStats,
  transition: QuakeWorldResidencyTransitionStats,
): void {
  stats.transitionCount++;
  stats.totalTransitionPlanningMs += transition.planningMs;
  stats.totalTransitionMutationJsMs += transition.mutationJsMs;
  stats.totalTransitionMs += transition.totalMs;
  stats.maxTransitionTotalMs = Math.max(stats.maxTransitionTotalMs, transition.totalMs);
  stats.lastTransitionPlanningMs = transition.planningMs;
  stats.lastTransitionMutationJsMs = transition.mutationJsMs;
  stats.lastTransitionTotalMs = transition.totalMs;
  stats.lastTransitionScannedFaceLeafCount = transition.scannedFaceLeafCount;
  stats.lastTransitionAddCount = transition.addCount;
  stats.lastTransitionRemoveCount = transition.removeCount;
  stats.lastTransitionDeferCount = transition.deferCount;
  stats.lastTransition = { ...transition };
}

type QuakeShootablesVisibilitySyncReason = "force" | "same-selection" | "selection-change";

export interface QuakeShootablesVisibilityChurnStats {
  syncCount: number;
  changedSyncCount: number;
  skippedSyncCount: number;
  forceSyncCount: number;
  selectionChangedSyncCount: number;
  totalSyncMs: number;
  maxSyncMs: number;
  lastSyncMs: number;
  lastReason: QuakeShootablesVisibilitySyncReason | null;
  lastCandidates: number;
  lastPrewarmCandidates: number;
  lastDesiredMounted: number;
  lastDesiredPrewarm: number;
  lastMountedShootables: number;
  lastVisibleShootables: number;
  lastPrewarmedShootables: number;
  lastMountedShootablesAdded: number;
  lastMountedShootablesRemoved: number;
  lastVisibleShootablesAdded: number;
  lastVisibleShootablesRemoved: number;
  lastMeshHandlesCreated: number;
  lastMeshHandlesRemoved: number;
  lastFrameHandlesCreated: number;
  lastFrameHandlesRemoved: number;
  totalMountedShootablesAdded: number;
  totalMountedShootablesRemoved: number;
  totalVisibleShootablesAdded: number;
  totalVisibleShootablesRemoved: number;
  totalMeshHandlesCreated: number;
  totalMeshHandlesRemoved: number;
  totalFrameHandlesCreated: number;
  totalFrameHandlesRemoved: number;
}

export interface QuakeShootablesVisibilitySnapshot {
  mountedIndexes: Set<number>;
  visibleIndexes: Set<number>;
  prewarmedIndexes: Set<number>;
  meshHandles: number;
  frameHandles: number;
  enemyFrameHandles: number;
  mountedEnemies: number;
  visibleEnemies: number;
  prewarmedEnemies: number;
}

export function createQuakeShootablesVisibilityChurnStats(): QuakeShootablesVisibilityChurnStats {
  return {
    syncCount: 0,
    changedSyncCount: 0,
    skippedSyncCount: 0,
    forceSyncCount: 0,
    selectionChangedSyncCount: 0,
    totalSyncMs: 0,
    maxSyncMs: 0,
    lastSyncMs: 0,
    lastReason: null,
    lastCandidates: 0,
    lastPrewarmCandidates: 0,
    lastDesiredMounted: 0,
    lastDesiredPrewarm: 0,
    lastMountedShootables: 0,
    lastVisibleShootables: 0,
    lastPrewarmedShootables: 0,
    lastMountedShootablesAdded: 0,
    lastMountedShootablesRemoved: 0,
    lastVisibleShootablesAdded: 0,
    lastVisibleShootablesRemoved: 0,
    lastMeshHandlesCreated: 0,
    lastMeshHandlesRemoved: 0,
    lastFrameHandlesCreated: 0,
    lastFrameHandlesRemoved: 0,
    totalMountedShootablesAdded: 0,
    totalMountedShootablesRemoved: 0,
    totalVisibleShootablesAdded: 0,
    totalVisibleShootablesRemoved: 0,
    totalMeshHandlesCreated: 0,
    totalMeshHandlesRemoved: 0,
    totalFrameHandlesCreated: 0,
    totalFrameHandlesRemoved: 0,
  };
}

export function recordQuakeShootablesVisibilitySync(
  stats: QuakeShootablesVisibilityChurnStats,
  startedAt: number,
  details: {
    force: boolean;
    selectionChanged: boolean;
    before: QuakeShootablesVisibilitySnapshot;
    after: QuakeShootablesVisibilitySnapshot;
    candidates: number;
    prewarmCandidates: number;
    desiredMounted: number;
    desiredPrewarm: number;
    meshHandlesCreated: number;
    meshHandlesRemoved: number;
    frameHandlesCreated: number;
    frameHandlesRemoved: number;
  },
): void {
  const mountedAdded = countSetAdded(details.after.mountedIndexes, details.before.mountedIndexes);
  const mountedRemoved = countSetAdded(details.before.mountedIndexes, details.after.mountedIndexes);
  const visibleAdded = countSetAdded(details.after.visibleIndexes, details.before.visibleIndexes);
  const visibleRemoved = countSetAdded(details.before.visibleIndexes, details.after.visibleIndexes);
  const changed = mountedAdded + mountedRemoved + visibleAdded + visibleRemoved +
    details.meshHandlesCreated + details.meshHandlesRemoved +
    details.frameHandlesCreated + details.frameHandlesRemoved;
  const elapsed = performance.now() - startedAt;
  stats.syncCount++;
  if (details.force) stats.forceSyncCount++;
  if (details.selectionChanged) stats.selectionChangedSyncCount++;
  if (changed > 0) {
    stats.changedSyncCount++;
  } else {
    stats.skippedSyncCount++;
  }
  stats.totalSyncMs += elapsed;
  stats.maxSyncMs = Math.max(stats.maxSyncMs, elapsed);
  stats.lastSyncMs = elapsed;
  stats.lastReason = details.force
    ? "force"
    : details.selectionChanged
      ? "selection-change"
      : "same-selection";
  stats.lastCandidates = details.candidates;
  stats.lastPrewarmCandidates = details.prewarmCandidates;
  stats.lastDesiredMounted = details.desiredMounted;
  stats.lastDesiredPrewarm = details.desiredPrewarm;
  stats.lastMountedShootables = details.after.mountedIndexes.size;
  stats.lastVisibleShootables = details.after.visibleIndexes.size;
  stats.lastPrewarmedShootables = details.after.prewarmedIndexes.size;
  stats.lastMountedShootablesAdded = mountedAdded;
  stats.lastMountedShootablesRemoved = mountedRemoved;
  stats.lastVisibleShootablesAdded = visibleAdded;
  stats.lastVisibleShootablesRemoved = visibleRemoved;
  stats.lastMeshHandlesCreated = details.meshHandlesCreated;
  stats.lastMeshHandlesRemoved = details.meshHandlesRemoved;
  stats.lastFrameHandlesCreated = details.frameHandlesCreated;
  stats.lastFrameHandlesRemoved = details.frameHandlesRemoved;
  stats.totalMountedShootablesAdded += mountedAdded;
  stats.totalMountedShootablesRemoved += mountedRemoved;
  stats.totalVisibleShootablesAdded += visibleAdded;
  stats.totalVisibleShootablesRemoved += visibleRemoved;
}

export function shootableVisibilitySelectionKey(mountedIndexes: Set<number>, prewarmedIndexes: Set<number>): string {
  return `${sortedNumberSetKey(mountedIndexes)}|${sortedNumberSetKey(prewarmedIndexes)}`;
}

function sortedNumberSetKey(values: Set<number>): string {
  return [...values].sort((a, b) => a - b).join(",");
}

function countSetAdded(next: Set<number>, previous: Set<number>): number {
  let added = 0;
  for (const value of next) {
    if (!previous.has(value)) added++;
  }
  return added;
}
