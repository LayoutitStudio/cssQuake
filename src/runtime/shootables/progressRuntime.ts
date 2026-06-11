import type { Vec3 } from "@layoutit/polycss";

import {
  quakeShootableDestroyedEntityIndexes,
  quakeShootableProgressEntries,
  quakeShootableProgressVec3,
  type QuakeShootablesProgressSnapshot,
} from "./progress";
import type { QuakeShootableState } from "./state";

export interface QuakeShootablesProgressRuntimeOptions {
  clearAttackState(shootable: QuakeShootableState): void;
  clearDeathOutputHandles(): void;
  clearDeathTimers(): void;
  clearEnemyRuntime(): void;
  destroyedEntityIndexes(): Set<number>;
  leafIndexAt(origin: Vec3): number | undefined;
  markVisibilitySelectionDirty(): void;
  removeHandles(shootable: QuakeShootableState): void;
  resetEnemyRuntime(shootable: QuakeShootableState): void;
  resetPrewarm(): void;
  replaceDestroyedEntityIndexes(indexes: Set<number>): void;
  shootables(): Iterable<QuakeShootableState>;
  stopEnemyLoop(): void;
  syncEnemyDatasets(shootable: QuakeShootableState): void;
  syncLifecycleClasses(shootable: QuakeShootableState): void;
  syncMonsterRuntime(): void;
  syncTransform(shootable: QuakeShootableState): void;
}

export interface QuakeShootablesProgressRuntime {
  restore(snapshot: QuakeShootablesProgressSnapshot): void;
  snapshot(): QuakeShootablesProgressSnapshot;
}

export function createQuakeShootablesProgressRuntime(
  options: QuakeShootablesProgressRuntimeOptions,
): QuakeShootablesProgressRuntime {
  return {
    restore,
    snapshot,
  };

  function snapshot(): QuakeShootablesProgressSnapshot {
    return {
      destroyedEntityIndexes: [...options.destroyedEntityIndexes()],
      shootables: [...options.shootables()].map((shootable) => ({
        dead: shootable.dead,
        entityIndex: shootable.entity.index,
        health: shootable.health,
        origin: [...shootable.origin] as Vec3,
        yaw: shootable.yaw,
      })),
    };
  }

  function restore(snapshot: QuakeShootablesProgressSnapshot): void {
    options.stopEnemyLoop();
    options.clearEnemyRuntime();
    options.resetPrewarm();
    options.clearDeathTimers();
    options.clearDeathOutputHandles();
    const entries = quakeShootableProgressEntries(snapshot);
    const destroyedEntityIndexes = quakeShootableDestroyedEntityIndexes(snapshot);
    options.replaceDestroyedEntityIndexes(destroyedEntityIndexes);
    for (const shootable of options.shootables()) {
      const entry = entries.get(shootable.entity.index);
      options.resetEnemyRuntime(shootable);
      const destroyed = destroyedEntityIndexes.has(shootable.entity.index);
      if (entry) {
        shootable.origin = quakeShootableProgressVec3(entry.origin, shootable.origin);
        shootable.leafIndex = options.leafIndexAt(shootable.origin);
        shootable.yaw = Number.isFinite(entry.yaw) ? entry.yaw : shootable.yaw;
        shootable.health = Number.isFinite(entry.health) ? entry.health : shootable.health;
      }
      shootable.dead = destroyed || Boolean(entry?.dead) || shootable.health <= 0;
      options.clearAttackState(shootable);
      if (shootable.dead) {
        shootable.health = Math.min(0, shootable.health);
        options.removeHandles(shootable);
        continue;
      }
      options.syncTransform(shootable);
      options.syncLifecycleClasses(shootable);
      options.syncEnemyDatasets(shootable);
    }
    options.markVisibilitySelectionDirty();
    options.syncMonsterRuntime();
  }
}
