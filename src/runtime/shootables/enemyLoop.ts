import type { QuakeEnemyProjectile, QuakeEnemyState } from "./state";

export interface QuakeEnemyLoopOptions {
  dtClampSeconds: number;
  enemies(): Iterable<QuakeEnemyState>;
  enemiesFrozen?: () => boolean;
  getPlayerOrigin(): [number, number, number];
  hasLiveEnemies(now: number): boolean;
  hasProjectiles(): boolean;
  isPaused?: () => boolean;
  projectiles(): Iterable<QuakeEnemyProjectile>;
  runtimeEnabled(): boolean;
  tickMs: number;
  updateEnemies(playerOrigin: [number, number, number], dt: number, now: number): void;
  updateProjectiles(playerOrigin: [number, number, number], dt: number, now: number): void;
}

export interface QuakeEnemyLoop {
  resetPause(): void;
  start(): void;
  stop(): void;
}

export function createQuakeEnemyLoop({
  dtClampSeconds,
  enemies,
  enemiesFrozen,
  getPlayerOrigin,
  hasLiveEnemies,
  hasProjectiles,
  isPaused,
  projectiles,
  runtimeEnabled,
  tickMs,
  updateEnemies,
  updateProjectiles,
}: QuakeEnemyLoopOptions): QuakeEnemyLoop {
  let frame: number | null = null;
  let lastTickTime = 0;
  let pausedAt = 0;
  let enemiesFrozenAt = 0;

  const start = (): void => {
    if (frame !== null) return;
    lastTickTime = 0;
    frame = window.requestAnimationFrame(tick);
  };

  const stop = (): void => {
    if (frame === null) return;
    window.cancelAnimationFrame(frame);
    frame = null;
    lastTickTime = 0;
    enemiesFrozenAt = 0;
  };

  const resetPause = (): void => {
    pausedAt = 0;
  };

  const tick = (_rafNow: number): void => {
    const now = performance.now();
    if (isPaused?.()) {
      pausedAt ||= now;
      lastTickTime = 0;
      frame = window.requestAnimationFrame(tick);
      return;
    }
    if (pausedAt) {
      const pausedDurationMs = now - pausedAt;
      shiftEnemyRuntimeDeadlines(enemies(), projectiles(), pausedDurationMs);
      if (enemiesFrozenAt) enemiesFrozenAt += pausedDurationMs;
      pausedAt = 0;
      lastTickTime = now;
    }
    if (!runtimeEnabled() || (!hasLiveEnemies(now) && !hasProjectiles())) {
      stop();
      return;
    }

    if (lastTickTime && now - lastTickTime < tickMs) {
      frame = window.requestAnimationFrame(tick);
      return;
    }

    const dt = Math.min(dtClampSeconds, lastTickTime ? (now - lastTickTime) / 1000 : tickMs / 1000);
    lastTickTime = now;
    const playerOrigin = getPlayerOrigin();
    const frozen = enemiesFrozen?.() === true;
    if (frozen) {
      enemiesFrozenAt ||= now;
    } else if (enemiesFrozenAt) {
      shiftEnemyRuntimeDeadlines(enemies(), [], now - enemiesFrozenAt);
      enemiesFrozenAt = 0;
    }
    updateProjectiles(playerOrigin, dt, now);
    if (!frozen) updateEnemies(playerOrigin, dt, now);
    frame = window.requestAnimationFrame(tick);
  };

  return { resetPause, start, stop };
}

function shiftEnemyRuntimeDeadlines(
  enemies: Iterable<QuakeEnemyState>,
  projectiles: Iterable<QuakeEnemyProjectile>,
  durationMs: number,
): void {
  if (durationMs <= 0) return;
  for (const enemy of enemies) {
    enemy.animationLockUntil = shiftEnemyTimestamp(enemy.animationLockUntil, durationMs);
    enemy.deathAnimationUntil = shiftEnemyTimestamp(enemy.deathAnimationUntil, durationMs);
    enemy.nextAnimationFrameAt = shiftEnemyTimestamp(enemy.nextAnimationFrameAt, durationMs);
    enemy.quakecPainFinishedUntil = shiftEnemyTimestamp(enemy.quakecPainFinishedUntil, durationMs);
    enemy.nextAttackAt = shiftEnemyTimestamp(enemy.nextAttackAt, durationMs);
    enemy.zombieNonSolidAt = shiftEnemyTimestamp(enemy.zombieNonSolidAt, durationMs);
    enemy.zombiePainRepeatUntil = shiftEnemyTimestamp(enemy.zombiePainRepeatUntil, durationMs);
    enemy.zombieRecoverUntil = shiftEnemyTimestamp(enemy.zombieRecoverUntil, durationMs);
    enemy.zombieSolidAt = shiftEnemyTimestamp(enemy.zombieSolidAt, durationMs);
    if (enemy.pendingAttack) enemy.pendingAttack.fireAt += durationMs;
    if (enemy.quakecActiveTouchDamage) enemy.quakecActiveTouchDamage.expiresAt += durationMs;
  }
  for (const projectile of projectiles) projectile.expiresAt += durationMs;
}

function shiftEnemyTimestamp(value: number, durationMs: number): number {
  return Number.isFinite(value) && value > 0 ? value + durationMs : value;
}
