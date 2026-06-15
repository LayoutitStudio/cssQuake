import type { QuakeIdleDeadline, QuakeWindowWithIdle } from "./state";

interface QuakePrewarmShootableState {
  dead: boolean;
  entity: { index: number };
  frameHandles: Map<number, unknown>;
  handle: unknown | null;
  visible: boolean;
}

const QUAKE_SHOOTABLE_PREWARM_MIN_IDLE_MS = 4;
const QUAKE_SHOOTABLE_PREWARM_MAX_DRAIN_PER_CALLBACK = 3;

export interface QuakeShootablePrewarmQueues<TShootable extends QuakePrewarmShootableState> {
  animationFrameQueueLength(): number;
  cancel(): void;
  desiredCount(): number;
  hasQueuedPrewarm(entityIndex: number): boolean;
  prewarmQueueLength(): number;
  reset(): void;
  scheduleAnimationFrame(shootable: TShootable, frameIndex: number): void;
  scheduleShootable(shootable: TShootable): void;
  setDesiredPrewarmIndexes(indexes: Set<number>): void;
}

export interface QuakeShootablePrewarmQueueOptions<TShootable extends QuakePrewarmShootableState> {
  canPoolAnimationFrame(shootable: TShootable): boolean;
  canPrewarmShootable(shootable: TShootable): boolean;
  ensureAnimationFrame(shootable: TShootable, frameIndex: number): void;
  getShootable(entityIndex: number): TShootable | undefined;
  mountShootable(shootable: TShootable): void;
  setShootableVisible(shootable: TShootable, visible: boolean): void;
  timeoutMs: number;
  trimAnimationFrameHandles(shootable: TShootable): void;
}

export function createQuakeShootablePrewarmQueues<TShootable extends QuakePrewarmShootableState>(
  options: QuakeShootablePrewarmQueueOptions<TShootable>,
): QuakeShootablePrewarmQueues<TShootable> {
  let desiredPrewarmIndexes = new Set<number>();
  let prewarmQueue: number[] = [];
  let queuedPrewarmIndexes = new Set<number>();
  let prewarmIdleHandle: number | null = null;
  let animationFramePrewarmQueue: Array<{ entityIndex: number; frameIndex: number }> = [];
  let queuedAnimationFramePrewarms = new Set<string>();
  let animationFramePrewarmIdleHandle: number | null = null;

  function reset(): void {
    cancel();
    desiredPrewarmIndexes = new Set();
    prewarmQueue = [];
    queuedPrewarmIndexes = new Set();
    animationFramePrewarmQueue = [];
    queuedAnimationFramePrewarms = new Set();
  }

  function cancel(): void {
    cancelPrewarmDrain();
    cancelAnimationFramePrewarmDrain();
  }

  function setDesiredPrewarmIndexes(indexes: Set<number>): void {
    desiredPrewarmIndexes = indexes;
  }

  function scheduleShootable(shootable: TShootable): void {
    if (queuedPrewarmIndexes.has(shootable.entity.index)) return;
    queuedPrewarmIndexes.add(shootable.entity.index);
    prewarmQueue.push(shootable.entity.index);
    schedulePrewarmDrain();
  }

  function schedulePrewarmDrain(): void {
    if (prewarmIdleHandle !== null) return;
    const idleWindow = window as QuakeWindowWithIdle;
    if (idleWindow.requestIdleCallback) {
      prewarmIdleHandle = idleWindow.requestIdleCallback(drainPrewarmQueue, {
        timeout: options.timeoutMs,
      });
      return;
    }
    prewarmIdleHandle = window.setTimeout(() => {
      drainPrewarmQueue({ didTimeout: true, timeRemaining: () => 0 });
    }, options.timeoutMs);
  }

  function cancelPrewarmDrain(): void {
    if (prewarmIdleHandle === null) return;
    const idleWindow = window as QuakeWindowWithIdle;
    if (idleWindow.cancelIdleCallback) {
      idleWindow.cancelIdleCallback(prewarmIdleHandle);
    } else {
      window.clearTimeout(prewarmIdleHandle);
    }
    prewarmIdleHandle = null;
  }

  function drainPrewarmQueue(deadline: QuakeIdleDeadline): void {
    prewarmIdleHandle = null;
    let mounted = 0;
    while (prewarmQueue.length > 0) {
      const entityIndex = prewarmQueue.shift() as number;
      queuedPrewarmIndexes.delete(entityIndex);
      if (!desiredPrewarmIndexes.has(entityIndex)) continue;
      const shootable = options.getShootable(entityIndex);
      if (!shootable || shootable.dead || shootable.handle) continue;
      if (!options.canPrewarmShootable(shootable)) continue;
      options.mountShootable(shootable);
      options.setShootableVisible(shootable, false);
      mounted++;
      if (mounted >= QUAKE_SHOOTABLE_PREWARM_MAX_DRAIN_PER_CALLBACK || !canContinuePrewarmDrain(deadline)) break;
    }
    if (prewarmQueue.length > 0) schedulePrewarmDrain();
  }

  function scheduleAnimationFrame(shootable: TShootable, frameIndex: number): void {
    if (!shootable.visible || !options.canPoolAnimationFrame(shootable)) return;
    if (shootable.frameHandles.has(frameIndex)) return;
    const key = animationFramePrewarmKey(shootable.entity.index, frameIndex);
    if (queuedAnimationFramePrewarms.has(key)) return;
    queuedAnimationFramePrewarms.add(key);
    animationFramePrewarmQueue.push({ entityIndex: shootable.entity.index, frameIndex });
    scheduleAnimationFramePrewarmDrain();
  }

  function scheduleAnimationFramePrewarmDrain(): void {
    if (animationFramePrewarmIdleHandle !== null) return;
    const idleWindow = window as QuakeWindowWithIdle;
    if (idleWindow.requestIdleCallback) {
      animationFramePrewarmIdleHandle = idleWindow.requestIdleCallback(drainAnimationFramePrewarmQueue, {
        timeout: options.timeoutMs,
      });
      return;
    }
    animationFramePrewarmIdleHandle = window.setTimeout(() => {
      drainAnimationFramePrewarmQueue({ didTimeout: true, timeRemaining: () => 0 });
    }, options.timeoutMs);
  }

  function cancelAnimationFramePrewarmDrain(): void {
    if (animationFramePrewarmIdleHandle === null) return;
    const idleWindow = window as QuakeWindowWithIdle;
    if (idleWindow.cancelIdleCallback) {
      idleWindow.cancelIdleCallback(animationFramePrewarmIdleHandle);
    } else {
      window.clearTimeout(animationFramePrewarmIdleHandle);
    }
    animationFramePrewarmIdleHandle = null;
  }

  function drainAnimationFramePrewarmQueue(deadline: QuakeIdleDeadline): void {
    animationFramePrewarmIdleHandle = null;
    let prepared = 0;
    while (animationFramePrewarmQueue.length > 0) {
      const item = animationFramePrewarmQueue.shift();
      if (!item) break;
      queuedAnimationFramePrewarms.delete(animationFramePrewarmKey(item.entityIndex, item.frameIndex));
      const shootable = options.getShootable(item.entityIndex);
      if (!shootable || shootable.dead || !shootable.visible || !options.canPoolAnimationFrame(shootable)) continue;
      if (shootable.frameHandles.has(item.frameIndex)) continue;
      options.ensureAnimationFrame(shootable, item.frameIndex);
      options.trimAnimationFrameHandles(shootable);
      prepared++;
      if (prepared >= QUAKE_SHOOTABLE_PREWARM_MAX_DRAIN_PER_CALLBACK || !canContinuePrewarmDrain(deadline)) break;
    }
    if (animationFramePrewarmQueue.length > 0) scheduleAnimationFramePrewarmDrain();
  }

  function canContinuePrewarmDrain(deadline: QuakeIdleDeadline): boolean {
    return deadline.didTimeout || deadline.timeRemaining() >= QUAKE_SHOOTABLE_PREWARM_MIN_IDLE_MS;
  }

  function animationFramePrewarmKey(entityIndex: number, frameIndex: number): string {
    return `${entityIndex}:${frameIndex}`;
  }

  return {
    animationFrameQueueLength: () => animationFramePrewarmQueue.length,
    cancel,
    desiredCount: () => desiredPrewarmIndexes.size,
    hasQueuedPrewarm: (entityIndex) => queuedPrewarmIndexes.has(entityIndex),
    prewarmQueueLength: () => prewarmQueue.length,
    reset,
    scheduleAnimationFrame,
    scheduleShootable,
    setDesiredPrewarmIndexes,
  };
}
