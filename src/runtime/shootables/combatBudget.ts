export interface QuakeCombatBudgetLimits {
  combatInterestSet: number;
  unmountedAiActiveSet: number;
  unmountedAiCadenceHz: number;
  lineOfSightChecksPerFrame: number;
  lineOfSightChecksPerSecond: number;
  attackChainChecksPerFrame: number;
  domReads: number;
}

export interface QuakeCombatBudgetCounters {
  combatInterestAddsTotal: number;
  combatInterestEvictionsTotal: number;
  enemyLoopFramesTotal: number;
  enemyUpdateCandidatesTotal: number;
  mountedVisibleEnemyUpdatesTotal: number;
  skippedUnmountedEnemyUpdatesTotal: number;
  unmountedAiTicksTotal: number;
  lineOfSightChecksTotal: number;
  lineOfSightChecksUnframedTotal: number;
  attackChainChecksTotal: number;
  weaponTargetQueriesTotal: number;
  weaponTargetCandidatesTotal: number;
  weaponTargetsYieldedTotal: number;
  capDeferralsTotal: number;
  disableSwitchActivationsTotal: number;
  domReadsTotal: number;
  unmountedAiTickDeferralsTotal: number;
}

export interface QuakeCombatBudgetFrameStats {
  attackChainChecks: number;
  lineOfSightChecks: number;
  startedAtMs: number;
}

export interface QuakeCombatBudgetSecondStats {
  attackChainChecks: number;
  lineOfSightChecks: number;
  startedAtMs: number;
}

export interface QuakeCombatBudgetDebugStats {
  limits: QuakeCombatBudgetLimits;
  expandedLogicalCombatEnabled: boolean;
  unmountedAiEnabled: boolean;
  combatInterestSetSize: number;
  unmountedAiActiveSetSize: number;
  combatInterestEntityIndexes: number[];
  unmountedAiActiveEntityIndexes: number[];
  counters: QuakeCombatBudgetCounters;
  currentFrame: QuakeCombatBudgetFrameStats;
  maxFrame: Omit<QuakeCombatBudgetFrameStats, "startedAtMs">;
  currentSecond: QuakeCombatBudgetSecondStats;
  maxPerSecond: Omit<QuakeCombatBudgetSecondStats, "startedAtMs">;
}

export interface QuakeCombatBudgetRuntime {
  beginEnemyFrame(now?: number): void;
  beginFrame(now?: number): void;
  clearCombatInterest(): void;
  completeUnmountedAiTick(entityIndex: number): void;
  debugStats(): QuakeCombatBudgetDebugStats;
  expandedLogicalCombatEnabled(): boolean;
  hasCombatInterest(entityIndex: number): boolean;
  recordAttackChainCheck(now?: number): void;
  recordCapDeferral(): void;
  recordCombatInterest(entityIndex: number, now?: number): QuakeCombatInterestResult;
  recordEnemyUpdate(kind: "mounted-visible" | "skipped-unmounted"): void;
  recordLineOfSightCheck(now?: number): void;
  recordWeaponTargetCandidate(): void;
  recordWeaponTargetQuery(): void;
  recordWeaponTargetYield(): void;
  reset(): void;
  setExpandedLogicalCombatEnabled(enabled: boolean): void;
  setUnmountedAiEnabled(enabled: boolean): void;
  tryRecordLineOfSightCheck(now?: number): boolean;
  tryStartUnmountedAiTick(entityIndex: number, now?: number): QuakeUnmountedAiTickResult;
}

export interface QuakeCombatInterestResult {
  accepted: boolean;
  evictedEntityIndex: number | null;
}

export interface QuakeUnmountedAiTickResult {
  accepted: boolean;
  reason: "accepted" | "disabled" | "not-interested" | "cadence" | "capacity";
}

interface QuakeCombatInterestEntry {
  entityIndex: number;
  lastTouchedAtMs: number;
  sequence: number;
}

export interface QuakeCombatLogicalTargetCandidate {
  combatInterested: boolean;
  entityIndex: number;
  inLineOfFire: boolean;
  live: boolean;
  mounted: boolean;
  visible: boolean;
}

export function quakeCombatLogicalWeaponTargetIndexes(
  candidates: Iterable<QuakeCombatLogicalTargetCandidate>,
  limit = QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet,
): number[] {
  const targetIndexes: number[] = [];
  for (const candidate of candidates) {
    if (targetIndexes.length >= limit) break;
    if (!candidate.live || !candidate.inLineOfFire) continue;
    if ((candidate.mounted && candidate.visible) || candidate.combatInterested) {
      targetIndexes.push(candidate.entityIndex);
    }
  }
  return targetIndexes;
}

export const QUAKE_COMBAT_BUDGET_LIMITS: Readonly<QuakeCombatBudgetLimits> = Object.freeze({
  attackChainChecksPerFrame: 8,
  combatInterestSet: 12,
  domReads: 0,
  lineOfSightChecksPerFrame: 8,
  lineOfSightChecksPerSecond: 200,
  unmountedAiActiveSet: 4,
  unmountedAiCadenceHz: 5,
});

export function createQuakeCombatBudgetRuntime(): QuakeCombatBudgetRuntime {
  let counters = createCounters();
  let currentFrame = createFrameStats(0);
  let currentSecond = createSecondStats(0);
  let maxFrame = { attackChainChecks: 0, lineOfSightChecks: 0 };
  let maxPerSecond = { attackChainChecks: 0, lineOfSightChecks: 0 };
  let expandedLogicalCombatEnabled = false;
  let unmountedAiEnabled = false;
  let interestSequence = 0;
  const combatInterest = new Map<number, QuakeCombatInterestEntry>();
  const unmountedAiActive = new Set<number>();
  const unmountedAiLastTickAt = new Map<number, number>();

  function reset(): void {
    counters = createCounters();
    currentFrame = createFrameStats(0);
    currentSecond = createSecondStats(0);
    maxFrame = { attackChainChecks: 0, lineOfSightChecks: 0 };
    maxPerSecond = { attackChainChecks: 0, lineOfSightChecks: 0 };
    expandedLogicalCombatEnabled = false;
    unmountedAiEnabled = false;
    interestSequence = 0;
    combatInterest.clear();
    unmountedAiActive.clear();
    unmountedAiLastTickAt.clear();
  }

  function beginEnemyFrame(now = combatBudgetNowMs()): void {
    counters.enemyLoopFramesTotal++;
    beginFrame(now);
  }

  function beginFrame(now = combatBudgetNowMs()): void {
    currentFrame = createFrameStats(now);
    rollSecondWindow(now);
  }

  function tryRecordLineOfSightCheck(now = combatBudgetNowMs()): boolean {
    rollSecondWindow(now);
    if (currentFrame.lineOfSightChecks >= QUAKE_COMBAT_BUDGET_LIMITS.lineOfSightChecksPerFrame) {
      recordCapDeferral();
      return false;
    }
    if (currentSecond.lineOfSightChecks >= QUAKE_COMBAT_BUDGET_LIMITS.lineOfSightChecksPerSecond) {
      recordCapDeferral();
      return false;
    }
    recordLineOfSightCheck(now);
    return true;
  }

  function recordLineOfSightCheck(now = combatBudgetNowMs()): void {
    counters.lineOfSightChecksTotal++;
    if (currentFrame.startedAtMs <= 0) counters.lineOfSightChecksUnframedTotal++;
    rollSecondWindow(now);
    currentFrame.lineOfSightChecks++;
    currentSecond.lineOfSightChecks++;
    if (currentFrame.lineOfSightChecks > maxFrame.lineOfSightChecks) {
      maxFrame.lineOfSightChecks = currentFrame.lineOfSightChecks;
    }
    if (currentSecond.lineOfSightChecks > maxPerSecond.lineOfSightChecks) {
      maxPerSecond.lineOfSightChecks = currentSecond.lineOfSightChecks;
    }
  }

  function recordAttackChainCheck(now = combatBudgetNowMs()): void {
    counters.attackChainChecksTotal++;
    rollSecondWindow(now);
    currentFrame.attackChainChecks++;
    currentSecond.attackChainChecks++;
    if (currentFrame.attackChainChecks > maxFrame.attackChainChecks) {
      maxFrame.attackChainChecks = currentFrame.attackChainChecks;
    }
    if (currentSecond.attackChainChecks > maxPerSecond.attackChainChecks) {
      maxPerSecond.attackChainChecks = currentSecond.attackChainChecks;
    }
  }

  function recordEnemyUpdate(kind: "mounted-visible" | "skipped-unmounted"): void {
    counters.enemyUpdateCandidatesTotal++;
    if (kind === "mounted-visible") counters.mountedVisibleEnemyUpdatesTotal++;
    else counters.skippedUnmountedEnemyUpdatesTotal++;
  }

  function recordCombatInterest(entityIndex: number, now = combatBudgetNowMs()): QuakeCombatInterestResult {
    const existing = combatInterest.get(entityIndex);
    if (existing) {
      existing.lastTouchedAtMs = now;
      existing.sequence = ++interestSequence;
      return { accepted: true, evictedEntityIndex: null };
    }

    let evictedEntityIndex: number | null = null;
    if (combatInterest.size >= QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet) {
      evictedEntityIndex = oldestCombatInterestEntityIndex();
      if (evictedEntityIndex !== null) {
        combatInterest.delete(evictedEntityIndex);
        unmountedAiActive.delete(evictedEntityIndex);
        unmountedAiLastTickAt.delete(evictedEntityIndex);
        counters.combatInterestEvictionsTotal++;
      }
    }

    combatInterest.set(entityIndex, {
      entityIndex,
      lastTouchedAtMs: now,
      sequence: ++interestSequence,
    });
    counters.combatInterestAddsTotal++;
    return { accepted: true, evictedEntityIndex };
  }

  function clearCombatInterest(): void {
    combatInterest.clear();
    unmountedAiActive.clear();
    unmountedAiLastTickAt.clear();
  }

  function setExpandedLogicalCombatEnabled(enabled: boolean): void {
    if (expandedLogicalCombatEnabled === enabled) return;
    expandedLogicalCombatEnabled = enabled;
    counters.disableSwitchActivationsTotal++;
    if (!enabled) {
      unmountedAiEnabled = false;
      unmountedAiActive.clear();
      clearCombatInterest();
    }
  }

  function setUnmountedAiEnabled(enabled: boolean): void {
    const nextEnabled = enabled && expandedLogicalCombatEnabled;
    if (unmountedAiEnabled === nextEnabled) return;
    unmountedAiEnabled = nextEnabled;
    counters.disableSwitchActivationsTotal++;
    if (!nextEnabled) unmountedAiActive.clear();
  }

  function tryStartUnmountedAiTick(entityIndex: number, now = combatBudgetNowMs()): QuakeUnmountedAiTickResult {
    if (!expandedLogicalCombatEnabled || !unmountedAiEnabled) return deferUnmountedAiTick("disabled");
    if (!combatInterest.has(entityIndex)) return deferUnmountedAiTick("not-interested");
    if (!unmountedAiActive.has(entityIndex) &&
      unmountedAiActive.size >= QUAKE_COMBAT_BUDGET_LIMITS.unmountedAiActiveSet) {
      return deferUnmountedAiTick("capacity", true);
    }
    const minIntervalMs = 1000 / QUAKE_COMBAT_BUDGET_LIMITS.unmountedAiCadenceHz;
    const lastTickAt = unmountedAiLastTickAt.get(entityIndex) ?? -Infinity;
    if (now - lastTickAt < minIntervalMs) return deferUnmountedAiTick("cadence");

    unmountedAiActive.add(entityIndex);
    unmountedAiLastTickAt.set(entityIndex, now);
    counters.unmountedAiTicksTotal++;
    return { accepted: true, reason: "accepted" };
  }

  function completeUnmountedAiTick(entityIndex: number): void {
    unmountedAiActive.delete(entityIndex);
  }

  function recordCapDeferral(): void {
    counters.capDeferralsTotal++;
  }

  function recordWeaponTargetQuery(): void {
    counters.weaponTargetQueriesTotal++;
  }

  function recordWeaponTargetCandidate(): void {
    counters.weaponTargetCandidatesTotal++;
  }

  function recordWeaponTargetYield(): void {
    counters.weaponTargetsYieldedTotal++;
  }

  function hasCombatInterest(entityIndex: number): boolean {
    return combatInterest.has(entityIndex);
  }

  function isExpandedLogicalCombatEnabled(): boolean {
    return expandedLogicalCombatEnabled;
  }

  function debugStats(): QuakeCombatBudgetDebugStats {
    return {
      combatInterestEntityIndexes: [...combatInterest.keys()],
      combatInterestSetSize: combatInterest.size,
      counters: { ...counters },
      currentFrame: { ...currentFrame },
      currentSecond: { ...currentSecond },
      expandedLogicalCombatEnabled,
      limits: { ...QUAKE_COMBAT_BUDGET_LIMITS },
      maxFrame: { ...maxFrame },
      maxPerSecond: { ...maxPerSecond },
      unmountedAiActiveEntityIndexes: [...unmountedAiActive],
      unmountedAiActiveSetSize: unmountedAiActive.size,
      unmountedAiEnabled,
    };
  }

  function oldestCombatInterestEntityIndex(): number | null {
    let oldest: QuakeCombatInterestEntry | null = null;
    for (const entry of combatInterest.values()) {
      if (!oldest ||
        entry.lastTouchedAtMs < oldest.lastTouchedAtMs ||
        (entry.lastTouchedAtMs === oldest.lastTouchedAtMs && entry.sequence < oldest.sequence)
      ) {
        oldest = entry;
      }
    }
    return oldest?.entityIndex ?? null;
  }

  function deferUnmountedAiTick(
    reason: Exclude<QuakeUnmountedAiTickResult["reason"], "accepted">,
    capDeferral = false,
  ): QuakeUnmountedAiTickResult {
    counters.unmountedAiTickDeferralsTotal++;
    if (capDeferral) counters.capDeferralsTotal++;
    return { accepted: false, reason };
  }

  function rollSecondWindow(now: number): void {
    if (currentSecond.startedAtMs <= 0 || now - currentSecond.startedAtMs >= 1000) {
      currentSecond = createSecondStats(now);
    }
  }

  return {
    beginEnemyFrame,
    beginFrame,
    clearCombatInterest,
    completeUnmountedAiTick,
    debugStats,
    expandedLogicalCombatEnabled: isExpandedLogicalCombatEnabled,
    hasCombatInterest,
    recordAttackChainCheck,
    recordCapDeferral,
    recordCombatInterest,
    recordEnemyUpdate,
    recordLineOfSightCheck,
    recordWeaponTargetCandidate,
    recordWeaponTargetQuery,
    recordWeaponTargetYield,
    reset,
    setExpandedLogicalCombatEnabled,
    setUnmountedAiEnabled,
    tryRecordLineOfSightCheck,
    tryStartUnmountedAiTick,
  };
}

function createCounters(): QuakeCombatBudgetCounters {
  return {
    attackChainChecksTotal: 0,
    capDeferralsTotal: 0,
    combatInterestAddsTotal: 0,
    combatInterestEvictionsTotal: 0,
    disableSwitchActivationsTotal: 0,
    domReadsTotal: 0,
    enemyLoopFramesTotal: 0,
    enemyUpdateCandidatesTotal: 0,
    lineOfSightChecksTotal: 0,
    lineOfSightChecksUnframedTotal: 0,
    mountedVisibleEnemyUpdatesTotal: 0,
    skippedUnmountedEnemyUpdatesTotal: 0,
    unmountedAiTickDeferralsTotal: 0,
    unmountedAiTicksTotal: 0,
    weaponTargetCandidatesTotal: 0,
    weaponTargetQueriesTotal: 0,
    weaponTargetsYieldedTotal: 0,
  };
}

function createFrameStats(startedAtMs: number): QuakeCombatBudgetFrameStats {
  return { attackChainChecks: 0, lineOfSightChecks: 0, startedAtMs };
}

function createSecondStats(startedAtMs: number): QuakeCombatBudgetSecondStats {
  return { attackChainChecks: 0, lineOfSightChecks: 0, startedAtMs };
}

function combatBudgetNowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
