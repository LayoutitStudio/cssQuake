import type { QuakeEntity } from "../prepared/preparedScene";
import type { QuakeTouchedTrigger } from "./collision";

export interface QuakeTriggersControllerOptions {
  activateCounter: (entity: QuakeEntity) => boolean;
  activateEntity: (entityIndex: number) => void;
  activateTeleport: (entity: QuakeEntity) => boolean;
  completeLevel: (entity: QuakeEntity) => void;
  fireTarget: (targetname: string, sourceEntityIndex?: number) => void;
  getEntity: (entityIndex: number) => QuakeEntity | undefined;
  getOrigin: () => [number, number, number];
  getTouchedTriggers: (origin: [number, number, number]) => QuakeTouchedTrigger[];
  onActiveKeyChange: (key: string) => void;
  transitionSerial: () => number;
}

export interface QuakeTriggersController {
  clear: () => void;
  resetActive: () => void;
  setActive: (triggers: QuakeTouchedTrigger[]) => void;
  sync: (origin: [number, number, number]) => QuakeTouchedTrigger[];
  activateCounterEntity: (entity: QuakeEntity) => void;
}

export function createQuakeTriggersController(options: QuakeTriggersControllerOptions): QuakeTriggersController {
  let activeTriggers = new Set<number>();
  let usedTriggers = new Set<number>();
  let activeTriggerKey = "";

  const clear = (): void => {
    activeTriggers = new Set();
    usedTriggers = new Set();
    setActiveKey("");
  };

  const resetActive = (): void => {
    activeTriggers = new Set();
    setActiveKey("");
  };

  const setActive = (triggers: QuakeTouchedTrigger[]): void => {
    activeTriggers = new Set(triggers.map((trigger) => trigger.entityIndex));
    const key = [...activeTriggers].sort((a, b) => a - b).join(",");
    setActiveKey(key);
  };

  const sync = (origin: [number, number, number]): QuakeTouchedTrigger[] => {
    const triggers = options.getTouchedTriggers(origin);
    const transitionSerial = options.transitionSerial();
    for (const trigger of triggers) {
      if (trigger.contact === "door-trigger" || !activeTriggers.has(trigger.entityIndex)) {
        activateTouch(trigger);
        if (options.transitionSerial() !== transitionSerial) return options.getTouchedTriggers(options.getOrigin());
      }
    }
    setActive(triggers);
    return triggers;
  };

  const activateTouch = (trigger: QuakeTouchedTrigger): boolean => {
    const entity = options.getEntity(trigger.entityIndex);
    if (!entity) return false;
    if (trigger.contact === "door-trigger" && entity.classname === "func_door") {
      options.activateEntity(entity.index);
      return false;
    }
    if (usedTriggers.has(entity.index)) return false;
    if (entity.classname === "trigger_teleport") {
      return options.activateTeleport(entity);
    }
    if (entity.classname === "trigger_changelevel") {
      usedTriggers.add(entity.index);
      options.completeLevel(entity);
      return true;
    }
    if (entity.classname === "trigger_once" || entity.classname === "trigger_secret") {
      usedTriggers.add(entity.index);
    }
    if (entity.properties.target) options.fireTarget(entity.properties.target, entity.index);
    return false;
  };

  const activateCounterEntity = (entity: QuakeEntity): void => {
    if (usedTriggers.has(entity.index)) return;
    if (!options.activateCounter(entity)) return;
    usedTriggers.add(entity.index);
  };

  const setActiveKey = (key: string): void => {
    if (key === activeTriggerKey) return;
    activeTriggerKey = key;
    options.onActiveKeyChange(key);
  };

  return {
    clear,
    resetActive,
    setActive,
    sync,
    activateCounterEntity,
  };
}
