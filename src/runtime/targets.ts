import type { QuakeEntity } from "../prepare/scene";
import { quakeEntityNumber } from "./entities";

export interface QuakeTargetsControllerOptions {
  activateEntity: (entityIndex: number, sourceEntityIndex?: number) => boolean | void;
}

export interface QuakeTargetsController {
  clear: () => void;
  setup: (entities: QuakeEntity[]) => void;
  entityIndexesFor: (targetname: string) => number[];
  fire: (targetname: string, sourceEntityIndex?: number) => void;
  useTargets: (entity: QuakeEntity) => boolean;
  disableEntity: (entityIndex: number) => void;
  isDisabled: (entityIndex: number) => boolean;
  activateCounter: (entity: QuakeEntity) => boolean;
}

export function createQuakeTargetsController(options: QuakeTargetsControllerOptions): QuakeTargetsController {
  let targetEntities = new Map<string, number[]>();
  let triggerCounterCounts = new Map<number, number>();
  let disabledEntities = new Set<number>();
  let pendingUseTimers: number[] = [];
  let dispatchDepth = 0;
  let dispatchActivations = 0;

  const QUAKE_TARGET_MAX_DEPTH = 32;
  const QUAKE_TARGET_MAX_ACTIVATIONS = 256;

  const clear = (): void => {
    for (const timer of pendingUseTimers) window.clearTimeout(timer);
    pendingUseTimers = [];
    targetEntities = new Map();
    triggerCounterCounts = new Map();
    disabledEntities = new Set();
  };

  const setup = (entities: QuakeEntity[]): void => {
    clear();

    for (const entity of entities) {
      const targetname = entity.properties.targetname;
      if (!targetname) continue;
      const bucket = targetEntities.get(targetname);
      if (bucket) {
        bucket.push(entity.index);
      } else {
        targetEntities.set(targetname, [entity.index]);
      }
    }

    for (const entity of entities) {
      if (entity.classname !== "trigger_counter") continue;
      triggerCounterCounts.set(entity.index, Math.max(1, Math.round(quakeEntityNumber(entity, "count", 2))));
    }
  };

  const entityIndexesFor = (targetname: string): number[] => (
    targetEntities.get(targetname) ?? []
  ).filter((entityIndex) => !disabledEntities.has(entityIndex));

  const fire = (targetname: string, sourceEntityIndex?: number): void => {
    if (dispatchDepth >= QUAKE_TARGET_MAX_DEPTH) return;
    const topLevel = dispatchDepth === 0;
    if (topLevel) dispatchActivations = 0;
    dispatchDepth++;
    try {
      for (const entityIndex of entityIndexesFor(targetname)) {
        if (dispatchActivations >= QUAKE_TARGET_MAX_ACTIVATIONS) return;
        if (entityIndex === sourceEntityIndex) continue;
        dispatchActivations++;
        options.activateEntity(entityIndex, sourceEntityIndex);
      }
    } finally {
      dispatchDepth--;
      if (topLevel) dispatchActivations = 0;
    }
  };

  const useTargets = (entity: QuakeEntity): boolean => {
    if (disabledEntities.has(entity.index)) return false;
    const delay = Math.max(0, quakeEntityNumber(entity, "delay", 0));
    if (delay > 0) {
      const timer = window.setTimeout(() => {
        pendingUseTimers = pendingUseTimers.filter((item) => item !== timer);
        useTargetsNow(entity, true);
      }, delay * 1000);
      pendingUseTimers.push(timer);
      return true;
    }
    return useTargetsNow(entity);
  };

  const useTargetsNow = (entity: QuakeEntity, allowDisabledSource = false): boolean => {
    if (!allowDisabledSource && disabledEntities.has(entity.index)) return false;
    if (entity.properties.killtarget) disableTargets(entity.properties.killtarget);
    if (!entity.properties.target) return Boolean(entity.properties.killtarget);
    fire(entity.properties.target, entity.index);
    return true;
  };

  const disableTargets = (targetname: string): void => {
    for (const entityIndex of targetEntities.get(targetname) ?? []) disableEntity(entityIndex);
  };

  const disableEntity = (entityIndex: number): void => {
    disabledEntities.add(entityIndex);
  };

  const isDisabled = (entityIndex: number): boolean => disabledEntities.has(entityIndex);

  const activateCounter = (entity: QuakeEntity): boolean => {
    if (disabledEntities.has(entity.index)) return false;
    const remaining = Math.max(0, (triggerCounterCounts.get(entity.index) ?? 1) - 1);
    triggerCounterCounts.set(entity.index, remaining);
    if (remaining > 0) return false;
    useTargets(entity);
    return true;
  };

  return {
    clear,
    setup,
    entityIndexesFor,
    fire,
    useTargets,
    disableEntity,
    isDisabled,
    activateCounter,
  };
}
