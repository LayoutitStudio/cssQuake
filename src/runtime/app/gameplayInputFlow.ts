import { createQuakeParentKeyRelay } from "./parentKeyRelay";

const QUAKE_GAMEPLAY_KEY_CODES = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ControlLeft",
  "ControlRight",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "KeyA",
  "KeyD",
  "KeyS",
  "KeyW",
  "ShiftLeft",
  "ShiftRight",
  "Space",
]);
const QUAKE_MOVE_KEY_CODES = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "KeyA", "KeyD", "KeyS", "KeyW"]);
const QUAKE_SPEED_KEY_CODES = new Set(["ShiftLeft", "ShiftRight"]);
const QUAKE_CROUCH_KEY_CODES = new Set(["ControlLeft", "ControlRight"]);
const QUAKE_WEAPON_KEY_IMPULSES = new Map<string, number>([
  ["Digit1", 1],
  ["Digit2", 2],
  ["Digit3", 3],
  ["Digit4", 4],
  ["Digit5", 5],
  ["Digit6", 6],
  ["Digit7", 7],
  ["Digit8", 8],
]);

export interface QuakeGameplayInputFlowOptions {
  canUseGameplayInput(): boolean;
  changeWeaponByImpulse(impulse: number): boolean;
  clearMobileLookInput(): void;
  clearMobileMoveInput(): void;
  debugFlyEnabled(): boolean;
  player(): QuakeGameplayInputPlayer | null;
}

interface QuakeGameplayInputPlayer {
  clearMoveInput(): void;
  handleMoveKey(code: string, pressed: boolean): boolean;
  isCrouching(): boolean;
  setCrouching(crouching: boolean): void;
}

export interface QuakeGameplayInputFlow {
  readonly crouchKeyCodes: ReadonlySet<string>;
  readonly moveKeyCodes: ReadonlySet<string>;
  readonly speedKeyCodes: ReadonlySet<string>;
  clearCrouchInput(): void;
  clearMoveInput(): void;
  clearParentKeyRelay(): void;
  handleCrouchKey(event: KeyboardEvent, pressed: boolean): boolean;
  handleMoveKey(event: KeyboardEvent, pressed: boolean): boolean;
  handleWeaponKey(event: KeyboardEvent): boolean;
  isEditableTarget(target: EventTarget | null): boolean;
  parentKeyRelay(event: KeyboardEvent, pressed: boolean): void;
  shouldPreventGameplayKeyDefault(event: KeyboardEvent): boolean;
}

export function createQuakeGameplayInputFlow(
  options: QuakeGameplayInputFlowOptions,
): QuakeGameplayInputFlow {
  const parentKeyRelay = createQuakeParentKeyRelay({
    canUseInput: options.canUseGameplayInput,
    gameplayKeyCodes: QUAKE_GAMEPLAY_KEY_CODES,
    isEditableTarget,
  });
  const crouchKeyCodesDown = new Set<string>();

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable]") !== null;
  }

  function shouldPreventGameplayKeyDefault(event: KeyboardEvent): boolean {
    return (
      QUAKE_GAMEPLAY_KEY_CODES.has(event.code) &&
      !isEditableTarget(event.target)
    );
  }

  function clearParentKeyRelay(): void {
    parentKeyRelay.clear();
  }

  function parentKeyRelayEvent(event: KeyboardEvent, pressed: boolean): void {
    parentKeyRelay.handle(event, pressed);
  }

  function syncCrouchInput(): void {
    const currentPlayer = options.player();
    if (!currentPlayer) return;
    currentPlayer.setCrouching(options.canUseGameplayInput() && crouchKeyCodesDown.size > 0);
  }

  function clearMoveInput(): void {
    clearParentKeyRelay();
    options.player()?.clearMoveInput();
    options.clearMobileMoveInput();
    options.clearMobileLookInput();
  }

  function handleMoveKey(event: KeyboardEvent, pressed: boolean): boolean {
    if (options.debugFlyEnabled()) return false;
    if (!QUAKE_MOVE_KEY_CODES.has(event.code) && !QUAKE_SPEED_KEY_CODES.has(event.code) && event.code !== "Space") {
      return false;
    }
    if (pressed && (!options.canUseGameplayInput() || isEditableTarget(event.target))) return false;
    return options.player()?.handleMoveKey(event.code, pressed) ?? false;
  }

  function clearCrouchInput(): void {
    const currentPlayer = options.player();
    if (crouchKeyCodesDown.size === 0 && !currentPlayer?.isCrouching()) return;
    crouchKeyCodesDown.clear();
    currentPlayer?.setCrouching(false);
  }

  function handleCrouchKey(event: KeyboardEvent, pressed: boolean): boolean {
    if (options.debugFlyEnabled()) return false;
    if (!QUAKE_CROUCH_KEY_CODES.has(event.code)) return false;
    if (pressed) {
      if (!options.canUseGameplayInput() || isEditableTarget(event.target)) return false;
      crouchKeyCodesDown.add(event.code);
    } else {
      crouchKeyCodesDown.delete(event.code);
    }
    syncCrouchInput();
    return true;
  }

  function handleWeaponKey(event: KeyboardEvent): boolean {
    if (event.repeat || options.debugFlyEnabled()) return false;
    const impulse = quakeWeaponImpulseForGameplayKeyCode(event.code);
    if (impulse === null) return false;
    if (!options.canUseGameplayInput() || isEditableTarget(event.target)) return false;
    return options.changeWeaponByImpulse(impulse);
  }

  return {
    crouchKeyCodes: QUAKE_CROUCH_KEY_CODES,
    moveKeyCodes: QUAKE_MOVE_KEY_CODES,
    speedKeyCodes: QUAKE_SPEED_KEY_CODES,
    clearCrouchInput,
    clearMoveInput,
    clearParentKeyRelay,
    handleCrouchKey,
    handleMoveKey,
    handleWeaponKey,
    isEditableTarget,
    parentKeyRelay: parentKeyRelayEvent,
    shouldPreventGameplayKeyDefault,
  };
}

export function quakeWeaponImpulseForGameplayKeyCode(code: string): number | null {
  return QUAKE_WEAPON_KEY_IMPULSES.get(code) ?? null;
}
