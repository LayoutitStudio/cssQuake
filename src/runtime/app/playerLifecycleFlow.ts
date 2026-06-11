import type { QuakeScene } from "../../types/quake";
import type { QuakePlayerController } from "../player";
import type { QuakeMapLoadOptions } from "./session";

const QUAKE_DEATH_UNLOCK_MENU_SUPPRESS_MS = 1000;
const QUAKE_DEATH_UNLOCK_CONTROLS_END_TRACE_SUPPRESS_MS = 1000;
const QUAKE_MENU_RESUME_CONTROLS_END_SUPPRESS_MS = 350;

export interface QuakePlayerLifecycleFlowOptions {
  addBodyClasses(...classNames: string[]): void;
  appLoading(): boolean;
  clearAttackInput(): void;
  clearBonusOverlay(): void;
  clearCrosshairHit(): void;
  clearCrosshairTarget(): void;
  clearCrouchInput(): void;
  clearDeathDamageFeedback(): void;
  clearDeathOverlay(): void;
  clearDebugFlyInput(): void;
  clearGameRoute(): void;
  clearLevelLoadTimer(): void;
  clearMegahealthRot(): void;
  clearMobileMoveInput(): void;
  clearMoveInput(): void;
  clearPowerups(): void;
  clearText(): void;
  clearTextCenterPrint(): void;
  clearWeaponViewPunch(syncCamera?: boolean): void;
  controls: QuakePlayerLifecycleControls;
  currentCollisionWorld(): unknown | null;
  currentMapName(): string;
  currentResult(): QuakeScene | null;
  exitPointerLockIfHost(): void;
  focusHost(): void;
  gameplayStarted(): boolean;
  hasBodyClass(className: string): boolean;
  hasDeathOverlay(): boolean;
  hideMainMenu(): void;
  isMainMenuOpen(): boolean;
  isMenuPanelOpen(): boolean;
  jumpVelocity: number;
  loadMap(mapName: string, options?: QuakeMapLoadOptions): Promise<void>;
  player(): Pick<QuakePlayerController, "respawn">;
  pointerTrace(kind: string, details: Record<string, unknown>): void;
  removeBodyClasses(...classNames: string[]): void;
  setGameplayStarted(started: boolean): void;
  setLoading(active: boolean): void;
  setPlayerDead(dead: boolean): void;
  showDeathDamageFeedback(): void;
  showDeathOverlay(): void;
  showMainMenu(): void;
  startMap(): string;
  syncPlayerCollision(): void;
  trace(kind: string, details?: Record<string, unknown>): void;
  viewmodel: Pick<QuakePlayerLifecycleViewmodel, "clearFireAnimation">;
}

interface QuakePlayerLifecycleControls {
  lock(): void;
  unlock(): void;
  update(partial: Record<string, unknown>): void;
}

interface QuakePlayerLifecycleViewmodel {
  clearFireAnimation(): void;
}

export interface QuakePlayerLifecycleFlow {
  canUseGameplayInput(): boolean;
  clearLevelComplete(): void;
  clearDeathUnlockControlsEndTraceSuppression(): void;
  clearMainMenuControlsEndSuppression(): void;
  clearPlayerDeath(): void;
  isDeathUnlockControlsEndTraceSuppressed(now?: number): boolean;
  isLevelTransitionActive(): boolean;
  isPlayerDead(): boolean;
  quitToMainMenu(): void;
  respawnFromDeath(): boolean;
  respawnFromFlyMode(): boolean;
  resumeGameplayAfterMapLoad(): void;
  shouldOpenMainMenuOnControlsEnd(): boolean;
  shouldResumeMainMenuOnEscape(): boolean;
  showPlayerDeath(): void;
  startNewGame(): Promise<void>;
  suppressMainMenuOnResumeControlsEnd(): void;
}

export function createQuakePlayerLifecycleFlow(
  options: QuakePlayerLifecycleFlowOptions,
): QuakePlayerLifecycleFlow {
  let playerDead = false;
  let deathUnlockMenuSuppressUntil = 0;
  let deathUnlockControlsEndTraceSuppressUntil = 0;
  let menuResumeControlsEndSuppressUntil = 0;

  function isPlayerDead(): boolean {
    return playerDead;
  }

  function setPlayerDead(dead: boolean): void {
    playerDead = dead;
    options.setPlayerDead(dead);
  }

  function quitToMainMenu(): void {
    if (!options.gameplayStarted()) return;
    options.clearMoveInput();
    options.clearAttackInput();
    options.clearCrouchInput();
    options.clearMobileMoveInput();
    options.clearDebugFlyInput();
    options.clearWeaponViewPunch();
    clearLevelComplete();
    options.clearDeathOverlay();
    options.exitPointerLockIfHost();
    options.clearGameRoute();
    options.setGameplayStarted(false);
    options.setLoading(false);
    options.showMainMenu();
  }

  function respawnFromFlyMode(): boolean {
    if (!options.currentResult() || options.appLoading()) return false;
    options.clearMegahealthRot();
    options.player().respawn();
    return true;
  }

  function clearLevelComplete(): void {
    options.clearAttackInput();
    options.clearDebugFlyInput();
    options.clearMoveInput();
    options.clearWeaponViewPunch();
    options.removeBodyClasses("quake-level-complete");
    options.clearTextCenterPrint();
    options.controls.update({
      moveEnabled: false,
      jumpEnabled: false,
      crouchEnabled: false,
      jumpVelocity: options.jumpVelocity,
      gravity: 0,
    });
  }

  function suppressMainMenuOnNextControlsEnd(): void {
    deathUnlockMenuSuppressUntil = performance.now() + QUAKE_DEATH_UNLOCK_MENU_SUPPRESS_MS;
  }

  function suppressControlsEndTraceOnDeathUnlock(): void {
    deathUnlockControlsEndTraceSuppressUntil =
      performance.now() + QUAKE_DEATH_UNLOCK_CONTROLS_END_TRACE_SUPPRESS_MS;
  }

  function isDeathUnlockControlsEndTraceSuppressed(now = performance.now()): boolean {
    return playerDead && now <= deathUnlockControlsEndTraceSuppressUntil;
  }

  function clearDeathUnlockControlsEndTraceSuppression(): void {
    deathUnlockControlsEndTraceSuppressUntil = 0;
  }

  function suppressMainMenuOnResumeControlsEnd(): void {
    menuResumeControlsEndSuppressUntil = performance.now() + QUAKE_MENU_RESUME_CONTROLS_END_SUPPRESS_MS;
  }

  function clearMainMenuControlsEndSuppression(): void {
    deathUnlockMenuSuppressUntil = 0;
  }

  function shouldOpenMainMenuOnControlsEnd(): boolean {
    if (options.appLoading()) {
      options.pointerTrace("controls-end-menu-gate", { allow: false, reason: "loading" });
      return false;
    }
    if (isLevelTransitionActive()) {
      options.pointerTrace("controls-end-menu-gate", { allow: false, reason: "level-transition" });
      return false;
    }
    if (menuResumeControlsEndSuppressUntil > 0) {
      const suppress = performance.now() <= menuResumeControlsEndSuppressUntil;
      menuResumeControlsEndSuppressUntil = 0;
      if (suppress) {
        options.pointerTrace("controls-end-menu-gate", { allow: false, reason: "resume-suppress" });
        return false;
      }
    }
    if (deathUnlockMenuSuppressUntil > 0) {
      const suppress = performance.now() <= deathUnlockMenuSuppressUntil;
      deathUnlockMenuSuppressUntil = 0;
      if (suppress) {
        if (!isDeathUnlockControlsEndTraceSuppressed()) {
          options.pointerTrace("controls-end-menu-gate", { allow: false, reason: "death-suppress" });
        }
        return false;
      }
    }
    const allow = !playerDead;
    options.pointerTrace("controls-end-menu-gate", { allow, reason: allow ? "allow" : "dead" });
    return allow;
  }

  function showPlayerDeath(): void {
    if (playerDead) return;
    setPlayerDead(true);
    options.clearMegahealthRot();
    options.clearPowerups();
    options.clearMoveInput();
    options.clearAttackInput();
    options.clearDebugFlyInput();
    options.clearMobileMoveInput();
    options.clearWeaponViewPunch();
    options.clearBonusOverlay();
    options.trace("hud-death", { active: true });
    options.clearText();
    options.clearCrosshairHit();
    options.clearCrosshairTarget();
    options.viewmodel.clearFireAnimation();
    options.addBodyClasses("quake-dead");
    options.showDeathOverlay();
    options.showDeathDamageFeedback();
    options.controls.update({ lookEnabled: false, moveEnabled: false, jumpEnabled: false, gravity: 0 });
    suppressMainMenuOnNextControlsEnd();
    suppressControlsEndTraceOnDeathUnlock();
    options.controls.unlock();
  }

  function clearPlayerDeath(): void {
    if (!playerDead && !options.hasBodyClass("quake-dead") && !options.hasDeathOverlay()) return;
    setPlayerDead(false);
    options.trace("hud-death", { active: false });
    deathUnlockControlsEndTraceSuppressUntil = 0;
    options.removeBodyClasses("quake-dead");
    options.clearDeathOverlay();
    options.clearDeathDamageFeedback();
    options.controls.update({
      lookEnabled: true,
      moveEnabled: false,
      jumpEnabled: false,
      crouchEnabled: false,
      jumpVelocity: options.jumpVelocity,
      gravity: 0,
    });
  }

  function respawnFromDeath(): boolean {
    if (!playerDead || !options.currentResult()) return false;
    options.clearMegahealthRot();
    options.clearPowerups();
    options.player().respawn();
    if (!playerDead) {
      options.focusHost();
      options.controls.lock();
    }
    return true;
  }

  async function startNewGame(): Promise<void> {
    const startMap = options.startMap();
    if (!options.currentResult() || options.currentMapName() !== startMap) {
      await options.loadMap(startMap, {
        loadingStatus: `World ${startMap}.bsp`,
        preserveLoadingConsole: true,
        urlMode: "push",
      });
      return;
    }
    options.clearMegahealthRot();
    options.clearPowerups();
    options.clearMoveInput();
    options.clearAttackInput();
    options.clearMobileMoveInput();
    clearLevelComplete();
    options.player().respawn();
    options.setGameplayStarted(true);
  }

  function resumeGameplayAfterMapLoad(): void {
    if (!options.currentResult() || options.appLoading() || playerDead) return;
    options.setGameplayStarted(true);
    options.hideMainMenu();
    options.syncPlayerCollision();
  }

  function isLevelTransitionActive(): boolean {
    return options.hasBodyClass("quake-level-complete");
  }

  function canUseGameplayInput(): boolean {
    return !options.appLoading() &&
      !options.isMainMenuOpen() &&
      !options.isMenuPanelOpen() &&
      !isLevelTransitionActive() &&
      !playerDead &&
      options.currentCollisionWorld() !== null;
  }

  function shouldResumeMainMenuOnEscape(): boolean {
    return options.gameplayStarted() &&
      !options.appLoading() &&
      options.currentResult() !== null &&
      options.currentCollisionWorld() !== null &&
      !isLevelTransitionActive() &&
      !playerDead;
  }

  return {
    canUseGameplayInput,
    clearDeathUnlockControlsEndTraceSuppression,
    clearLevelComplete,
    clearMainMenuControlsEndSuppression,
    clearPlayerDeath,
    isDeathUnlockControlsEndTraceSuppressed,
    isLevelTransitionActive,
    isPlayerDead,
    quitToMainMenu,
    respawnFromDeath,
    respawnFromFlyMode,
    resumeGameplayAfterMapLoad,
    shouldOpenMainMenuOnControlsEnd,
    shouldResumeMainMenuOnEscape,
    showPlayerDeath,
    startNewGame,
    suppressMainMenuOnResumeControlsEnd,
  };
}
