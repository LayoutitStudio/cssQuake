import {
  syncQuakeHud as syncQuakeHudElements,
  type QuakeHudElements,
  type QuakePlayerInventory,
} from "../hud";
import type { QuakePlayerDamageFeedback } from "../player";

const DEFAULT_QUAKE_HUD_DAMAGE_CUE_MS = 900;
const DEFAULT_QUAKE_BONUS_FLASH_HOLD_MS = 80;

type QuakeHudTraceDetails = Record<string, unknown>;

export interface QuakeHudFlowOptions {
  bonusFlashHoldMs?: number;
  bonusOverlay: HTMLElement | null;
  classicHud: HTMLElement | null;
  damageCueMs?: number;
  damageOverlay: HTMLElement | null;
  hudElements: QuakeHudElements;
  inventory: () => QuakePlayerInventory;
  isPlayerDead: () => boolean;
  playDamageViewFeedback: (feedback: QuakePlayerDamageFeedback | undefined) => void;
  playPainSound: () => void;
  syncActiveWeaponViewModel: () => void;
  trace: (label: string, details?: QuakeHudTraceDetails) => void;
}

export interface QuakeHudFlow {
  clearBonusOverlay: () => void;
  clearDeathDamageFeedback: () => void;
  dispose: () => void;
  flashBonusOverlay: () => void;
  onDamageFlash: (active: boolean, feedback?: QuakePlayerDamageFeedback) => void;
  showDeathDamageFeedback: () => void;
  sync: () => void;
}

export function createQuakeHudFlow(options: QuakeHudFlowOptions): QuakeHudFlow {
  const damageCueMs = options.damageCueMs ?? DEFAULT_QUAKE_HUD_DAMAGE_CUE_MS;
  const bonusFlashHoldMs = options.bonusFlashHoldMs ?? DEFAULT_QUAKE_BONUS_FLASH_HOLD_MS;
  let damageTimer: number | null = null;
  let damageSerial = 0;
  let damageCueActive = false;
  let bonusTimer: number | null = null;
  let bonusSerial = 0;

  function clearDamageTimer(): void {
    if (damageTimer === null) return;
    window.clearTimeout(damageTimer);
    damageTimer = null;
  }

  function setDamageCue(active: boolean): void {
    if (damageCueActive === active) return;
    damageCueActive = active;
    options.trace("hud-damage-cue", { active });
    if (active) {
      options.classicHud?.classList.add("quake-hud-damage");
    } else {
      options.classicHud?.classList.remove("quake-hud-damage");
    }
  }

  function setDamageOverlay(active: boolean): void {
    const overlay = options.damageOverlay;
    if (!overlay) return;
    const wasActive = overlay.classList.contains("quake-damage-overlay-active");
    if (wasActive === active) return;
    options.trace("hud-damage-overlay", { active });
    if (active) {
      overlay.classList.add("quake-damage-overlay-active");
    } else {
      overlay.classList.remove("quake-damage-overlay-active");
    }
  }

  function onDamageFlash(active: boolean, feedback?: QuakePlayerDamageFeedback): void {
    if (!active) {
      if (!options.isPlayerDead()) {
        setDamageOverlay(false);
        if (damageTimer === null) setDamageCue(false);
      }
      return;
    }

    setDamageOverlay(true);
    options.playDamageViewFeedback(feedback);
    const damageCueWasTimed = damageTimer !== null;
    clearDamageTimer();
    const serial = ++damageSerial;
    if (!damageCueWasTimed) setDamageCue(true);
    damageTimer = window.setTimeout(() => {
      if (serial !== damageSerial) return;
      setDamageCue(false);
      damageTimer = null;
    }, damageCueMs);
    options.playPainSound();
  }

  function flashBonusOverlay(): void {
    const overlay = options.bonusOverlay;
    if (!overlay) return;
    bonusSerial += 1;
    if (bonusTimer !== null) {
      window.clearTimeout(bonusTimer);
      bonusTimer = null;
    }
    overlay.classList.add("quake-bonus-overlay-active");
    options.trace("hud-bonus-overlay", { active: true });
    const serial = bonusSerial;
    bonusTimer = window.setTimeout(() => {
      if (serial !== bonusSerial) return;
      bonusTimer = null;
      overlay.classList.remove("quake-bonus-overlay-active");
      options.trace("hud-bonus-overlay", { active: false });
    }, bonusFlashHoldMs);
  }

  function clearBonusOverlay(): void {
    bonusSerial += 1;
    if (bonusTimer !== null) {
      window.clearTimeout(bonusTimer);
      bonusTimer = null;
    }
    if (!options.bonusOverlay?.classList.contains("quake-bonus-overlay-active")) return;
    options.bonusOverlay.classList.remove("quake-bonus-overlay-active");
    options.trace("hud-bonus-overlay", { active: false });
  }

  function showDeathDamageFeedback(): void {
    clearDamageTimer();
    damageSerial += 1;
    setDamageOverlay(true);
    setDamageCue(true);
  }

  function clearDeathDamageFeedback(): void {
    clearDamageTimer();
    damageSerial += 1;
    setDamageCue(false);
    setDamageOverlay(false);
  }

  function sync(): void {
    const inventory = options.inventory();
    options.trace("hud-sync", {
      health: inventory.health,
      armor: inventory.armor,
      itemFlags: inventory.itemFlags,
      powerups: Object.keys(inventory.powerups),
      activeWeapon: inventory.activeWeapon,
      weapons: [...inventory.weapons],
      shells: inventory.shells,
    });
    syncQuakeHudElements(options.hudElements, inventory);
    options.syncActiveWeaponViewModel();
  }

  function dispose(): void {
    clearBonusOverlay();
    clearDeathDamageFeedback();
  }

  return {
    clearBonusOverlay,
    clearDeathDamageFeedback,
    dispose,
    flashBonusOverlay,
    onDamageFlash,
    showDeathDamageFeedback,
    sync,
  };
}
