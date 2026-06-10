import {
  indexQuakeGameLogicEntityFacts,
  type QuakeGameLogicFacts,
  type QuakeGameLogicTextFact,
  type QuakeGameLogicResolvedTriggerFact,
} from "../prepare/gameLogicFacts";
import type { QuakeEntity, QuakeEntityRuntimeManifest } from "../prepare/scene";
import { quakeEntityNumber } from "./entities";

export interface QuakeTargetsControllerOptions {
  activateEntity: (entityIndex: number, sourceEntityIndex?: number) => boolean | void;
  isGameplayPaused?: () => boolean;
  onCounterStateChange?: (entity: QuakeEntity, result: QuakeCounterActivationResult) => void;
  onUseTargetsMessage?: (entity: QuakeEntity, text: QuakeGameLogicTextFact) => void;
}

export interface QuakeCounterActivationResult {
  completed: boolean;
  remaining: number;
}

export interface QuakeTargetsController {
  clear: () => void;
  setup: (runtime: QuakeEntityRuntimeManifest, gameLogic?: QuakeGameLogicFacts | null) => void;
  entityIndexesFor: (targetname: string) => number[];
  fire: (targetname: string, sourceEntityIndex?: number) => void;
  useTargets: (entity: QuakeEntity) => boolean;
  disableEntity: (entityIndex: number) => void;
  isDisabled: (entityIndex: number) => boolean;
  activateCounter: (entity: QuakeEntity) => QuakeCounterActivationResult | null;
}

export function createQuakeTargetsController(options: QuakeTargetsControllerOptions): QuakeTargetsController {
  let targetEntities = new Map<string, number[]>();
  let triggerTargetUseFacts = new Map<number, QuakeGameLogicResolvedTriggerFact>();
  let triggerCounterCounts = new Map<number, number>();
  let disabledEntities = new Set<number>();
  let pendingUseTimers: number[] = [];
  let dispatchDepth = 0;
  let dispatchActivations = 0;

  const QUAKE_TARGET_MAX_DEPTH = 32;
  const QUAKE_TARGET_MAX_ACTIVATIONS = 256;
  const QUAKE_TARGET_PAUSED_TIMER_POLL_MS = 100;

  const clear = (): void => {
    for (const timer of pendingUseTimers) window.clearTimeout(timer);
    pendingUseTimers = [];
    targetEntities = new Map();
    triggerTargetUseFacts = new Map();
    triggerCounterCounts = new Map();
    disabledEntities = new Set();
  };

  const setup = (runtime: QuakeEntityRuntimeManifest, gameLogic?: QuakeGameLogicFacts | null): void => {
    clear();
    targetEntities = new Map(
      Object.entries(runtime.targetEntities).map(([targetname, indexes]) => [targetname, [...indexes]]),
    );
    triggerTargetUseFacts = quakeTriggerTargetUseFacts(gameLogic);
    triggerCounterCounts = quakeTriggerCounterCounts(runtime, gameLogic);
  };

  const entityIndexesFor = (targetname: string): number[] => (
    targetEntities.get(targetname) ?? []
  ).filter((entityIndex) => !disabledEntities.has(entityIndex));

  const fire = (targetname: string, sourceEntityIndex?: number): void => {
    fireEntityIndexes(entityIndexesFor(targetname), sourceEntityIndex);
  };

  const fireEntityIndexes = (entityIndexes: readonly number[], sourceEntityIndex?: number): void => {
    if (dispatchDepth >= QUAKE_TARGET_MAX_DEPTH) return;
    const topLevel = dispatchDepth === 0;
    if (topLevel) dispatchActivations = 0;
    dispatchDepth++;
    try {
      for (const entityIndex of entityIndexes) {
        if (dispatchActivations >= QUAKE_TARGET_MAX_ACTIVATIONS) return;
        if (disabledEntities.has(entityIndex)) continue;
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
    const triggerFact = triggerTargetUseFacts.get(entity.index);
    const delay = Math.max(0, triggerFact?.targetUse.delay ?? quakeEntityNumber(entity, "delay", 0));
    if (delay > 0) {
      let timer = 0;
      const fireDelayedUse = (): void => {
        pendingUseTimers = pendingUseTimers.filter((item) => item !== timer);
        if (options.isGameplayPaused?.()) {
          timer = window.setTimeout(fireDelayedUse, QUAKE_TARGET_PAUSED_TIMER_POLL_MS);
          pendingUseTimers.push(timer);
          return;
        }
        useTargetsNow(entity, true, triggerFact);
      };
      timer = window.setTimeout(fireDelayedUse, delay * 1000);
      pendingUseTimers.push(timer);
      return true;
    }
    return useTargetsNow(entity, false, triggerFact);
  };

  const useTargetsNow = (
    entity: QuakeEntity,
    allowDisabledSource = false,
    triggerFact?: QuakeGameLogicResolvedTriggerFact,
  ): boolean => {
    if (!allowDisabledSource && disabledEntities.has(entity.index)) return false;
    emitUseTargetsMessage(entity, triggerFact);
    if (triggerFact && quakeTriggerUsesPrebakedTargets(triggerFact)) return usePrebakedTriggerTargets(entity, triggerFact);
    if (entity.properties.killtarget) disableTargets(entity.properties.killtarget);
    if (!entity.properties.target) return Boolean(entity.properties.killtarget);
    fire(entity.properties.target, entity.index);
    return true;
  };

  const emitUseTargetsMessage = (
    entity: QuakeEntity,
    triggerFact?: QuakeGameLogicResolvedTriggerFact,
  ): void => {
    const text = triggerFact?.messageText;
    if (text?.lane === "centerprint" && text.sourceCall === "SUB_UseTargets") {
      options.onUseTargetsMessage?.(entity, text);
    }
  };

  const usePrebakedTriggerTargets = (
    entity: QuakeEntity,
    triggerFact: QuakeGameLogicResolvedTriggerFact,
  ): boolean => {
    const targetUse = triggerFact.targetUse;
    if (targetUse.killtargetEntityIndexes?.length) {
      for (const entityIndex of targetUse.killtargetEntityIndexes) disableEntity(entityIndex);
    } else if (targetUse.killtarget) {
      disableTargets(targetUse.killtarget);
    }
    if (!targetUse.target && targetUse.targetEntityIndexes.length === 0) return Boolean(targetUse.killtarget);
    fireEntityIndexes(targetUse.targetEntityIndexes, entity.index);
    return true;
  };

  const disableTargets = (targetname: string): void => {
    for (const entityIndex of targetEntities.get(targetname) ?? []) disableEntity(entityIndex);
  };

  const disableEntity = (entityIndex: number): void => {
    disabledEntities.add(entityIndex);
  };

  const isDisabled = (entityIndex: number): boolean => disabledEntities.has(entityIndex);

  const activateCounter = (entity: QuakeEntity): QuakeCounterActivationResult | null => {
    if (disabledEntities.has(entity.index)) return null;
    const remaining = Math.max(0, (triggerCounterCounts.get(entity.index) ?? 1) - 1);
    triggerCounterCounts.set(entity.index, remaining);
    const result = { completed: remaining <= 0, remaining };
    options.onCounterStateChange?.(entity, result);
    if (!result.completed) return result;
    useTargets(entity);
    return result;
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

function quakeTriggerCounterCounts(
  runtime: QuakeEntityRuntimeManifest,
  gameLogic?: QuakeGameLogicFacts | null,
): Map<number, number> {
  const counts = new Map(runtime.triggerCounterCounts);
  for (const [entityIndex, entity] of indexQuakeGameLogicEntityFacts(gameLogic)) {
    const trigger = entity.resolvedTrigger;
    if (trigger?.kind !== "trigger_counter") continue;
    counts.set(entityIndex, Math.max(1, Math.round(trigger.count ?? 1)));
  }
  return counts;
}

function quakeTriggerTargetUseFacts(
  gameLogic?: QuakeGameLogicFacts | null,
): Map<number, QuakeGameLogicResolvedTriggerFact> {
  const facts = new Map<number, QuakeGameLogicResolvedTriggerFact>();
  for (const [entityIndex, entity] of indexQuakeGameLogicEntityFacts(gameLogic)) {
    const trigger = entity.resolvedTrigger;
    if (trigger && (quakeTriggerUsesPrebakedTargets(trigger) || trigger.messageText)) facts.set(entityIndex, trigger);
  }
  return facts;
}

function quakeTriggerUsesPrebakedTargets(trigger: QuakeGameLogicResolvedTriggerFact): boolean {
  return trigger.kind === "trigger_relay" ||
    trigger.kind === "trigger_onlyregistered";
}
