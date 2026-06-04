import type { QuakeEntity } from "../prepare/prepared-scene";
import { quakeEntityNumber } from "./entities";

export interface QuakeTargetsControllerOptions {
  activateEntity: (entityIndex: number, sourceEntityIndex?: number) => void;
}

export interface QuakeTargetsController {
  clear: () => void;
  setup: (entities: QuakeEntity[]) => void;
  entityIndexesFor: (targetname: string) => number[];
  fire: (targetname: string, sourceEntityIndex?: number) => void;
  activateCounter: (entity: QuakeEntity) => boolean;
}

export function createQuakeTargetsController(options: QuakeTargetsControllerOptions): QuakeTargetsController {
  let targetEntities = new Map<string, number[]>();
  let triggerCounterCounts = new Map<number, number>();

  const clear = (): void => {
    targetEntities = new Map();
    triggerCounterCounts = new Map();
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

  const entityIndexesFor = (targetname: string): number[] => targetEntities.get(targetname) ?? [];

  const fire = (targetname: string, sourceEntityIndex?: number): void => {
    for (const entityIndex of entityIndexesFor(targetname)) {
      if (entityIndex === sourceEntityIndex) continue;
      options.activateEntity(entityIndex, sourceEntityIndex);
    }
  };

  const activateCounter = (entity: QuakeEntity): boolean => {
    const remaining = Math.max(0, (triggerCounterCounts.get(entity.index) ?? 1) - 1);
    triggerCounterCounts.set(entity.index, remaining);
    if (remaining > 0) return false;
    if (entity.properties.target) fire(entity.properties.target, entity.index);
    return true;
  };

  return {
    clear,
    setup,
    entityIndexesFor,
    fire,
    activateCounter,
  };
}
