import type { QuakeEntity } from "../../types/quake";
import {
  activateQuakeInventoryPowerup,
  clearQuakeInventoryPowerup,
  clearQuakeInventoryPowerups,
  type QuakeInventoryPowerupBehavior,
  type QuakePlayerInventory,
} from "../hud";

const QUAKE_PLAYER_DEFAULT_MAX_HEALTH = 100;
const QUAKE_MEGAHEALTH_ROT_INTERVAL_MS = 1000;
const QUAKE_QUAD_DAMAGE_MULTIPLIER = 4;

type QuakePowerupTraceDetails = Record<string, boolean | number | string | null | undefined>;

export interface QuakePowerupFlowOptions {
  getInventory(): QuakePlayerInventory | null;
  hasCurrentScene(): boolean;
  isDisposed(): boolean;
  isPaused(): boolean;
  isPlayerDead(): boolean;
  syncHud(): void;
  trace(kind: string, details?: QuakePowerupTraceDetails): void;
}

export interface QuakePowerupFlow {
  clearMegahealthRot(): void;
  clearPowerupTimers(): void;
  clearPowerups(): void;
  damageMultiplier(): number;
  isInvulnerable(): boolean;
  isInvisible(): boolean;
  powerupActive(finishedField: string): boolean;
  reschedulePowerupTimers(): void;
  resumeAfterPause(pausedForMs: number): void;
  pauseTimers(): void;
  startMegahealthRot(entity: QuakeEntity, delaySeconds: number): void;
  startPowerup(entity: QuakeEntity, powerup: QuakeInventoryPowerupBehavior): void;
}

export function createQuakePowerupFlow(options: QuakePowerupFlowOptions): QuakePowerupFlow {
  let powerupTimers = new Map<string, number>();
  let megahealthRotTimer: number | null = null;
  let megahealthRotDueAt: number | null = null;

  function pauseTimers(): void {
    cancelMegahealthRotTimer();
    clearPowerupTimers();
  }

  function resumeAfterPause(pausedForMs: number): void {
    if (pausedForMs > 0) {
      shiftPowerupDeadlines(pausedForMs);
      if (megahealthRotDueAt !== null) megahealthRotDueAt += pausedForMs;
    }
    scheduleMegahealthRotTimer();
    reschedulePowerupTimers();
  }

  function shiftPowerupDeadlines(durationMs: number): void {
    const inventory = options.getInventory();
    if (!inventory) return;
    for (const state of Object.values(inventory.powerups)) {
      state.finishedAt += durationMs;
    }
  }

  function reschedulePowerupTimers(): void {
    const inventory = options.getInventory();
    if (!inventory) return;
    for (const finishedField of Object.keys(inventory.powerups)) {
      schedulePowerupTimer(finishedField);
    }
  }

  function startMegahealthRot(entity: QuakeEntity, delaySeconds: number): void {
    clearMegahealthRot();
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) return;
    options.trace("pickup-megahealth-rot-start", { entityIndex: entity.index, delaySeconds });
    megahealthRotDueAt = performance.now() + delaySeconds * 1000;
    scheduleMegahealthRotTimer();
  }

  function runMegahealthRot(): void {
    megahealthRotTimer = null;
    megahealthRotDueAt = null;
    if (options.isPaused()) return;
    if (options.isDisposed() || !options.hasCurrentScene() || options.isPlayerDead()) return;
    const inventory = options.getInventory();
    if (!inventory || inventory.health <= QUAKE_PLAYER_DEFAULT_MAX_HEALTH) return;
    inventory.health = Math.max(QUAKE_PLAYER_DEFAULT_MAX_HEALTH, inventory.health - 1);
    options.trace("pickup-megahealth-rot", { health: inventory.health });
    options.syncHud();
    if (inventory.health > QUAKE_PLAYER_DEFAULT_MAX_HEALTH) {
      megahealthRotDueAt = performance.now() + QUAKE_MEGAHEALTH_ROT_INTERVAL_MS;
      scheduleMegahealthRotTimer();
    }
  }

  function scheduleMegahealthRotTimer(): void {
    cancelMegahealthRotTimer();
    if (megahealthRotDueAt === null || options.isPaused()) return;
    megahealthRotTimer = window.setTimeout(
      runMegahealthRot,
      Math.max(0, megahealthRotDueAt - performance.now()),
    );
  }

  function cancelMegahealthRotTimer(): void {
    if (megahealthRotTimer === null) return;
    window.clearTimeout(megahealthRotTimer);
    megahealthRotTimer = null;
  }

  function clearMegahealthRot(): void {
    cancelMegahealthRotTimer();
    megahealthRotDueAt = null;
  }

  function startPowerup(entity: QuakeEntity, powerup: QuakeInventoryPowerupBehavior): void {
    const inventory = options.getInventory();
    if (!inventory) return;
    const now = performance.now();
    clearPowerupTimer(powerup.finishedField);
    const state = activateQuakeInventoryPowerup(inventory, powerup, now);
    if (!state) return;
    schedulePowerupTimer(powerup.finishedField);
    options.trace("pickup-powerup-start", {
      activationField: powerup.activationField,
      durationSeconds: powerup.durationSeconds,
      entityIndex: entity.index,
      finishedField: powerup.finishedField,
      itemFlag: powerup.itemFlag,
      itemFlagExpression: powerup.itemFlagExpression,
      itemFlagMutationExpression: powerup.itemFlagMutation?.expression,
    });
    options.syncHud();
  }

  function finishPowerup(finishedField: string, reason: string): void {
    clearPowerupTimer(finishedField);
    if (options.isPaused()) return;
    const inventory = options.getInventory();
    if (!inventory) return;
    const state = clearQuakeInventoryPowerup(inventory, finishedField);
    if (!state) return;
    options.trace("pickup-powerup-end", {
      activationField: state.activationField,
      finishedField,
      itemFlag: state.itemFlag,
      itemFlagExpression: state.itemFlagExpression,
      itemFlagMutationExpression: state.itemFlagMutation?.expression,
      reason,
    });
    options.syncHud();
  }

  function schedulePowerupTimer(finishedField: string): void {
    clearPowerupTimer(finishedField);
    if (options.isPaused()) return;
    const state = options.getInventory()?.powerups[finishedField];
    if (!state) return;
    powerupTimers.set(
      finishedField,
      window.setTimeout(
        () => finishPowerup(finishedField, "timer"),
        Math.max(0, state.finishedAt - performance.now()),
      ),
    );
  }

  function clearPowerupTimer(finishedField: string): void {
    const timer = powerupTimers.get(finishedField);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    powerupTimers.delete(finishedField);
  }

  function clearPowerupTimers(): void {
    for (const timer of powerupTimers.values()) window.clearTimeout(timer);
    powerupTimers = new Map();
  }

  function clearPowerups(): void {
    clearPowerupTimers();
    const inventory = options.getInventory();
    if (!inventory) return;
    const hadPowerups = Object.keys(inventory.powerups).length > 0;
    clearQuakeInventoryPowerups(inventory);
    if (hadPowerups) options.syncHud();
  }

  function powerupActive(finishedField: string): boolean {
    const state = options.getInventory()?.powerups[finishedField];
    if (!state) return false;
    if (state.finishedAt > performance.now()) return true;
    finishPowerup(finishedField, "expired");
    return false;
  }

  function damageMultiplier(): number {
    return powerupActive("super_damage_finished") ? QUAKE_QUAD_DAMAGE_MULTIPLIER : 1;
  }

  function isInvulnerable(): boolean {
    return powerupActive("invincible_finished");
  }

  function isInvisible(): boolean {
    return powerupActive("invisible_finished");
  }

  return {
    clearMegahealthRot,
    clearPowerupTimers,
    clearPowerups,
    damageMultiplier,
    isInvulnerable,
    isInvisible,
    powerupActive,
    reschedulePowerupTimers,
    resumeAfterPause,
    pauseTimers,
    startMegahealthRot,
    startPowerup,
  };
}
