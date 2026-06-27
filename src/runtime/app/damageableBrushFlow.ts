import type { QuakeEntity } from "../../types/quake";
import { quakeEntityNumber } from "../entities";
import type { CssQuakeDamageableBrushProgressSnapshot } from "../saveLoad";

export interface QuakeDamageableBrushFlowOptions {
  activateEntity(entityIndex: number): boolean;
  activateSecretTrigger(entity: QuakeEntity): void;
  disableEntity(entityIndex: number): void;
  getEntity(entityIndex: number): QuakeEntity | undefined;
  isEntityDisabled(entityIndex: number): boolean;
  isPaused(): boolean;
  pausedTimerPollMs: number;
  useTargets(entity: QuakeEntity): boolean;
  triggerOneShot(entity: QuakeEntity, fallback: boolean): boolean;
}

export interface QuakeDamageableBrushFlow {
  clear(): void;
  damage(entityIndex: number, amount: number): boolean;
  restore(snapshot: CssQuakeDamageableBrushProgressSnapshot | undefined): void;
  setup(entityIndexes: readonly number[]): void;
  snapshot(): CssQuakeDamageableBrushProgressSnapshot;
}

export function createQuakeDamageableBrushFlow(
  options: QuakeDamageableBrushFlowOptions,
): QuakeDamageableBrushFlow {
  let health = new Map<number, number>();
  let resetTimers: number[] = [];

  function snapshot(): CssQuakeDamageableBrushProgressSnapshot {
    return {
      brushes: [...health].map(([entityIndex, brushHealth]) => ({
        entityIndex,
        health: brushHealth,
      })),
    };
  }

  function restore(snapshotValue: CssQuakeDamageableBrushProgressSnapshot | undefined): void {
    for (const timer of resetTimers) window.clearTimeout(timer);
    resetTimers = [];
    const savedHealth = new Map<number, number>();
    for (const entry of Array.isArray(snapshotValue?.brushes) ? snapshotValue.brushes : []) {
      if (!Number.isInteger(entry.entityIndex) || !Number.isFinite(entry.health)) continue;
      savedHealth.set(entry.entityIndex, Math.max(1, entry.health));
    }
    for (const entityIndex of entityIndexes()) {
      const entity = options.getEntity(entityIndex);
      if (!entity || !isDamageableBrushEntity(entity)) continue;
      if (options.isEntityDisabled(entity.index)) {
        health.delete(entity.index);
        continue;
      }
      health.set(
        entity.index,
        savedHealth.get(entity.index) ?? damageableBrushMaxHealth(entity),
      );
    }
  }

  function setup(entityIndexes: readonly number[]): void {
    clear();
    for (const entityIndex of entityIndexes) {
      const entity = options.getEntity(entityIndex);
      if (!entity) continue;
      health.set(entity.index, damageableBrushMaxHealth(entity));
    }
  }

  function clear(): void {
    for (const timer of resetTimers) window.clearTimeout(timer);
    resetTimers = [];
    health = new Map();
  }

  function damage(entityIndex: number, amount: number): boolean {
    if (options.isEntityDisabled(entityIndex)) return false;
    const entity = options.getEntity(entityIndex);
    if (!entity || !isDamageableBrushEntity(entity)) return false;
    const brushHealth = health.get(entity.index);
    if (brushHealth === undefined) return false;
    const remaining = brushHealth - Math.max(0, amount);
    if (remaining > 0) {
      health.set(entity.index, remaining);
      return true;
    }
    health.delete(entity.index);
    return activateDamageableBrush(entity);
  }

  function activateDamageableBrush(entity: QuakeEntity): boolean {
    if (entity.classname === "trigger_once" || entity.classname === "trigger_secret") {
      if (entity.classname === "trigger_secret") options.activateSecretTrigger(entity);
      const activated = options.useTargets(entity);
      if (options.triggerOneShot(entity, true)) options.disableEntity(entity.index);
      return activated;
    }
    if (entity.classname === "trigger_multiple") {
      const activated = options.useTargets(entity);
      scheduleDamageableBrushReset(entity);
      return activated;
    }
    if (entity.classname === "func_button") {
      const moverActivated = options.activateEntity(entity.index);
      const targetActivated = !moverActivated && damageableBrushHasTargets(entity)
        ? options.useTargets(entity)
        : false;
      scheduleDamageableBrushReset(entity);
      return moverActivated || targetActivated;
    }
    const activated = options.activateEntity(entity.index);
    scheduleDamageableBrushReset(entity);
    return activated;
  }

  function scheduleDamageableBrushReset(entity: QuakeEntity): void {
    const wait = damageableBrushResetWait(entity);
    if (wait < 0) {
      options.disableEntity(entity.index);
      return;
    }
    let timer = 0;
    const resetBrush = (): void => {
      resetTimers = resetTimers.filter((item) => item !== timer);
      if (options.isPaused()) {
        timer = window.setTimeout(resetBrush, options.pausedTimerPollMs);
        resetTimers.push(timer);
        return;
      }
      if (!options.isEntityDisabled(entity.index)) {
        health.set(entity.index, damageableBrushMaxHealth(entity));
      }
    };
    timer = window.setTimeout(resetBrush, wait * 1000);
    resetTimers.push(timer);
  }

  function entityIndexes(): number[] {
    return [...health.keys()];
  }

  return {
    clear,
    damage,
    restore,
    setup,
    snapshot,
  };
}

function damageableBrushResetWait(entity: QuakeEntity): number {
  if (entity.classname === "func_button") return quakeEntityNumber(entity, "wait", 1);
  if (entity.classname === "func_door" || entity.classname === "func_door_secret") {
    return quakeEntityNumber(entity, "wait", 3);
  }
  return quakeEntityNumber(entity, "wait", 0.2);
}

function damageableBrushMaxHealth(entity: QuakeEntity): number {
  return Math.max(1, Math.round(quakeEntityNumber(entity, "health", 1)));
}

function damageableBrushHasTargets(entity: QuakeEntity): boolean {
  return Boolean(entity.properties.target || entity.properties.killtarget);
}

function isDamageableBrushEntity(entity: QuakeEntity): boolean {
  if (quakeEntityNumber(entity, "health", 0) <= 0) return false;
  return entity.classname === "func_button" ||
    entity.classname === "func_door" ||
    entity.classname === "func_door_secret" ||
    entity.classname === "trigger_multiple" ||
    entity.classname === "trigger_once" ||
    entity.classname === "trigger_secret";
}
