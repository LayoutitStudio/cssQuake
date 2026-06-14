import type { QuakeEntity } from "../types/quake";
import type { QuakeTouchedTrigger } from "./collision";
import { quakeEntityNumber } from "./entities";
import { normalizeVec3 } from "./math";
import type { QuakeCounterActivationResult } from "./targets";

export interface QuakeTriggersControllerOptions {
  activateCounter: (entity: QuakeEntity) => QuakeCounterActivationResult | null;
  activateEntity: (entityIndex: number) => boolean | void;
  activateTeleport: (entity: QuakeEntity) => boolean;
  completeLevel: (entity: QuakeEntity) => void;
  disableEntity: (entityIndex: number) => void;
  getEntity: (entityIndex: number) => QuakeEntity | undefined;
  getOrigin: () => [number, number, number];
  getTouchedTriggers: (origin: [number, number, number]) => QuakeTouchedTrigger[];
  isEntityDisabled: (entityIndex: number) => boolean;
  isOneShotTrigger: (entity: QuakeEntity, fallback: boolean) => boolean;
  onActiveKeyChange: (key: string) => void;
  requestTouch?: (entity: QuakeEntity) => boolean;
  triggerSpecial: (entity: QuakeEntity) => boolean;
  triggerWait: (entity: QuakeEntity, fallback: number) => number;
  transitionSerial: () => number;
  useTargets: (entity: QuakeEntity) => boolean;
}

export interface QuakeTriggersController {
  clear: () => void;
  debugStats: () => QuakeTriggersDebugStats;
  resetActive: () => void;
  setActive: (triggers: QuakeTouchedTrigger[]) => void;
  sync: (origin: [number, number, number]) => QuakeTouchedTrigger[];
  activateCounterEntity: (entity: QuakeEntity) => void;
  activateTeleporterEntity: (entity: QuakeEntity) => boolean;
}

export interface QuakeTriggersDebugStats {
  activeTriggerIndexes: number[];
  activeTeleporterIndexes: number[];
  cooldownTriggerIndexes: number[];
  triggerMultipleActivationCounts: { count: number; entityIndex: number }[];
  usedTriggerIndexes: number[];
}

const QUAKE_TRIGGER_MULTIPLE_DEFAULT_WAIT = 0.2;
const QUAKE_NAMED_TELEPORTER_ACTIVE_MS = 200;
const QUAKE_TRIGGER_MIN_FACING_DOT = 0.2;

export function createQuakeTriggersController(options: QuakeTriggersControllerOptions): QuakeTriggersController {
  let activeTriggers = new Set<number>();
  let usedTriggers = new Set<number>();
  let triggerCooldownUntil = new Map<number, number>();
  let triggerMultipleActivationCounts = new Map<number, number>();
  let activeTeleportersUntil = new Map<number, number>();
  let lastOrigin: [number, number, number] | null = null;
  let activeTriggerKey = "";

  const clear = (): void => {
    activeTriggers = new Set();
    usedTriggers = new Set();
    triggerCooldownUntil = new Map();
    triggerMultipleActivationCounts = new Map();
    activeTeleportersUntil = new Map();
    lastOrigin = null;
    setActiveKey("");
  };

  const resetActive = (): void => {
    activeTriggers = new Set();
    lastOrigin = null;
    setActiveKey("");
  };

  const setActive = (triggers: QuakeTouchedTrigger[]): void => {
    activeTriggers = new Set(
      triggers
        .map((trigger) => trigger.entityIndex)
        .filter((entityIndex) => !options.isEntityDisabled(entityIndex)),
    );
    const key = [...activeTriggers].sort((a, b) => a - b).join(",");
    setActiveKey(key);
  };

  const sync = (origin: [number, number, number]): QuakeTouchedTrigger[] => {
    const triggers = options.getTouchedTriggers(origin);
    const transitionSerial = options.transitionSerial();
    const movement = lastOrigin ? subtractOrigin(origin, lastOrigin) : null;
    for (const trigger of triggers) {
      if (options.isEntityDisabled(trigger.entityIndex)) continue;
      if (trigger.contact === "door-trigger" || !activeTriggers.has(trigger.entityIndex) || isContinuousTouchTrigger(trigger)) {
        activateTouch(trigger, movement);
        if (options.transitionSerial() !== transitionSerial) return options.getTouchedTriggers(options.getOrigin());
      }
    }
    setActive(triggers);
    lastOrigin = origin;
    return triggers;
  };

  const activateTouch = (trigger: QuakeTouchedTrigger, movement: [number, number, number] | null): boolean => {
    const entity = options.getEntity(trigger.entityIndex);
    if (!entity) return false;
    if (options.isEntityDisabled(entity.index)) return false;
    if (trigger.contact === "door-trigger" && entity.classname === "func_door") {
      options.activateEntity(entity.index);
      return false;
    }
    if (trigger.contact === "plat-trigger" && entity.classname === "func_plat") {
      options.activateEntity(entity.index);
      return false;
    }
    if (usedTriggers.has(entity.index)) return false;
    if (!triggerFacingMatches(entity, movement)) return false;
    if (isShootableTrigger(entity)) return false;
    if (options.triggerSpecial(entity)) return false;
    if (entity.classname === "trigger_monsterjump") return false;
    if (entity.classname === "trigger_teleport") {
      if (!teleporterTouchEnabled(entity)) return false;
      return options.activateTeleport(entity);
    }
    if (entity.classname === "trigger_changelevel") {
      usedTriggers.add(entity.index);
      options.completeLevel(entity);
      return true;
    }
    if (isRoomAuthoritativeTouchTrigger(entity) && options.requestTouch?.(entity)) return true;
    if (entity.classname === "trigger_once" || entity.classname === "trigger_secret") {
      options.useTargets(entity);
      if (options.isOneShotTrigger(entity, true)) options.disableEntity(entity.index);
      return false;
    }
    if (entity.classname === "trigger_multiple") {
      if (!markTriggerMultipleUse(entity)) return false;
      options.useTargets(entity);
      if (options.triggerWait(entity, QUAKE_TRIGGER_MULTIPLE_DEFAULT_WAIT) < 0) {
        options.disableEntity(entity.index);
      }
      return false;
    }
    options.useTargets(entity);
    return false;
  };

  const isContinuousTouchTrigger = (trigger: QuakeTouchedTrigger): boolean => {
    return trigger.classname === "trigger_push" || trigger.contact === "plat-trigger";
  };

  const isRoomAuthoritativeTouchTrigger = (entity: QuakeEntity): boolean => {
    return entity.classname === "trigger_once" ||
      entity.classname === "trigger_multiple" ||
      entity.classname === "trigger_secret";
  };

  const activateCounterEntity = (entity: QuakeEntity): void => {
    if (options.isEntityDisabled(entity.index)) return;
    if (usedTriggers.has(entity.index)) return;
    const result = options.activateCounter(entity);
    if (!result?.completed) return;
    usedTriggers.add(entity.index);
  };

  const activateTeleporterEntity = (entity: QuakeEntity): boolean => {
    if (options.isEntityDisabled(entity.index) || entity.classname !== "trigger_teleport") return false;
    activeTeleportersUntil.set(entity.index, performance.now() + QUAKE_NAMED_TELEPORTER_ACTIVE_MS);
    activeTriggers.delete(entity.index);
    return true;
  };

  const teleporterTouchEnabled = (entity: QuakeEntity): boolean => {
    if (!entity.properties.targetname) return true;
    const activeUntil = activeTeleportersUntil.get(entity.index) ?? 0;
    if (performance.now() <= activeUntil) return true;
    activeTeleportersUntil.delete(entity.index);
    return false;
  };

  const markTriggerMultipleUse = (entity: QuakeEntity): boolean => {
    const now = performance.now();
    const cooldownUntil = triggerCooldownUntil.get(entity.index) ?? 0;
    if (now < cooldownUntil) return false;
    const wait = options.triggerWait(entity, QUAKE_TRIGGER_MULTIPLE_DEFAULT_WAIT);
    if (wait >= 0) {
      triggerCooldownUntil.set(entity.index, now + Math.max(0, wait) * 1000);
    }
    triggerMultipleActivationCounts.set(entity.index, (triggerMultipleActivationCounts.get(entity.index) ?? 0) + 1);
    return true;
  };

  const triggerFacingMatches = (
    entity: QuakeEntity,
    movement: [number, number, number] | null,
  ): boolean => {
    if (entity.properties.angle === undefined && entity.angle === undefined) return true;
    if (!movement || Math.hypot(movement[0], movement[1], movement[2]) <= 0.0001) return true;
    const direction = quakeTriggerMoveDirection(entity);
    const velocity = normalizeVec3(movement);
    return velocity[0] * direction[0] + velocity[1] * direction[1] + velocity[2] * direction[2] >= QUAKE_TRIGGER_MIN_FACING_DOT;
  };

  const isShootableTrigger = (entity: QuakeEntity): boolean => {
    if (quakeEntityNumber(entity, "health", 0) <= 0) return false;
    return entity.classname === "trigger_once" ||
      entity.classname === "trigger_multiple" ||
      entity.classname === "trigger_secret";
  };

  const setActiveKey = (key: string): void => {
    if (key === activeTriggerKey) return;
    activeTriggerKey = key;
    options.onActiveKeyChange(key);
  };

  return {
    clear,
    debugStats: () => ({
      activeTriggerIndexes: sortedTriggerIndexes(activeTriggers),
      activeTeleporterIndexes: sortedTriggerIndexes(activeTeleportersUntil),
      cooldownTriggerIndexes: activeCooldownTriggerIndexes(triggerCooldownUntil),
      triggerMultipleActivationCounts: [...triggerMultipleActivationCounts]
        .map(([entityIndex, count]) => ({ count, entityIndex }))
        .sort((a, b) => a.entityIndex - b.entityIndex),
      usedTriggerIndexes: sortedTriggerIndexes(usedTriggers),
    }),
    resetActive,
    setActive,
    sync,
    activateCounterEntity,
    activateTeleporterEntity,
  };
}

function activeCooldownTriggerIndexes(values: Map<number, number>): number[] {
  const now = performance.now();
  return [...values]
    .filter(([, cooldownUntil]) => now < cooldownUntil)
    .map(([entityIndex]) => entityIndex)
    .sort((a, b) => a - b);
}

function sortedTriggerIndexes(values: Set<number> | Map<number, unknown>): number[] {
  return [...values.keys()].sort((a, b) => a - b);
}

function subtractOrigin(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function quakeTriggerMoveDirection(entity: QuakeEntity): [number, number, number] {
  const angle = quakeEntityNumber(entity, "angle", entity.angle ?? 0);
  if (angle === -1) return [0, 0, 1];
  if (angle === -2) return [0, 0, -1];
  const radians = (angle * Math.PI) / 180;
  return normalizeVec3([Math.cos(radians), Math.sin(radians), 0]);
}
