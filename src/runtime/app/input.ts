export interface QuakeAppInputController {
  attach(): void;
  dispose(): void;
}

export interface QuakeAppInputControllerOptions {
  audioUnlock(): void;
  clearAttackInput(): void;
  clearCrouchInput(): void;
  clearDebugFlyInput(): void;
  clearMobileMoveInput(): void;
  clearMoveInput(): void;
  clearWeaponViewPunch(): void;
  focusHost(): void;
  gameplayMoveKeyCodes: ReadonlySet<string>;
  gameplaySpeedKeyCodes: ReadonlySet<string>;
  handleCrouchKey(event: KeyboardEvent, pressed: boolean): boolean;
  handleDebugFlyKey(event: KeyboardEvent, pressed: boolean): boolean;
  handleMenuKeyDown(event: KeyboardEvent): boolean;
  handleMoveKey(event: KeyboardEvent, pressed: boolean): boolean;
  hidePersistedLoadingConsole(): void;
  isEditableTarget(target: EventTarget | null): boolean;
  isLoading(): boolean;
  isPointerUnlocked(): boolean;
  menuIsMainOpen(): boolean;
  menuIsPanelOpen(): boolean;
  parentKeyRelay(event: KeyboardEvent, pressed: boolean): void;
  requestIntermissionAdvance(event: KeyboardEvent): boolean;
  shouldOpenMainMenuOnEscape(): boolean;
  shouldPreventGameplayKeyDefault(event: KeyboardEvent): boolean;
  showMainMenu(): void;
  syncViewmodelTransform(): void;
  toggleAudioMuted(): void;
  toggleDebugRecording(): void;
  toggleDebugMode(): void;
}

export function createQuakeAppInputController(options: QuakeAppInputControllerOptions): QuakeAppInputController {
  let attached = false;

  function handleWindowKeyDown(event: KeyboardEvent): void {
    options.audioUnlock();
    if (event.code === "KeyM" && !options.isEditableTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      options.toggleAudioMuted();
      return;
    }
    if (event.code === "KeyO" && !options.isEditableTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) options.toggleDebugRecording();
      return;
    }
    if (options.isLoading()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.code === "KeyX" && !options.isEditableTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      options.toggleDebugMode();
      return;
    }
    if (!event.repeat && options.requestIntermissionAdvance(event)) {
      event.preventDefault();
      event.stopPropagation();
      options.clearMoveInput();
      options.clearCrouchInput();
      options.clearAttackInput();
      return;
    }
    if (options.handleMenuKeyDown(event)) {
      options.clearMoveInput();
      options.clearCrouchInput();
      options.clearAttackInput();
      return;
    }
    if (
      event.code === "Escape" &&
      !options.isEditableTarget(event.target) &&
      options.isPointerUnlocked() &&
      !options.menuIsMainOpen() &&
      !options.menuIsPanelOpen()
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (options.shouldOpenMainMenuOnEscape()) {
        options.clearMoveInput();
        options.clearCrouchInput();
        options.clearAttackInput();
        options.showMainMenu();
      }
      return;
    }
    if (options.handleDebugFlyKey(event, true)) {
      options.hidePersistedLoadingConsole();
      return;
    }
    if (options.shouldPreventGameplayKeyDefault(event)) {
      event.preventDefault();
    }
    const handledMoveKey = options.handleMoveKey(event, true);
    const handledCrouchKey = options.handleCrouchKey(event, true);
    if (handledMoveKey || handledCrouchKey) {
      options.parentKeyRelay(event, true);
      options.hidePersistedLoadingConsole();
    }
    if (event.code === "KeyF") {
      event.preventDefault();
      options.focusHost();
    }
  }

  function handleWindowKeyUp(event: KeyboardEvent): void {
    options.parentKeyRelay(event, false);
    if (options.handleDebugFlyKey(event, false)) return;
    if (options.shouldPreventGameplayKeyDefault(event)) {
      event.preventDefault();
    }
    options.handleMoveKey(event, false);
    options.handleCrouchKey(event, false);
    if (
      (options.gameplayMoveKeyCodes.has(event.code) || options.gameplaySpeedKeyCodes.has(event.code)) &&
      !options.isEditableTarget(event.target)
    ) {
      options.syncViewmodelTransform();
    }
  }

  function handleWindowBlur(): void {
    options.clearAttackInput();
    options.clearDebugFlyInput();
    options.clearMoveInput();
    options.clearMobileMoveInput();
    options.clearWeaponViewPunch();
    options.clearCrouchInput();
  }

  function attach(): void {
    if (attached) return;
    attached = true;
    window.addEventListener("keydown", handleWindowKeyDown, { capture: true });
    window.addEventListener("keyup", handleWindowKeyUp, { capture: true });
    window.addEventListener("blur", handleWindowBlur);
  }

  function dispose(): void {
    if (!attached) return;
    attached = false;
    window.removeEventListener("keydown", handleWindowKeyDown, { capture: true });
    window.removeEventListener("keyup", handleWindowKeyUp, { capture: true });
    window.removeEventListener("blur", handleWindowBlur);
  }

  return { attach, dispose };
}
