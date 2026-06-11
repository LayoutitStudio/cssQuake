import type { Vec3 } from "@layoutit/polycss";

import type { QuakeUseTrace } from "../collision";
import { normalizeQuakeUrlAngle } from "../routeState";
import { createQuakeAttackInputController } from "./attackInput";
import { QUAKE_CAMERA_ROT_X_MAX, QUAKE_CAMERA_ROT_X_MIN } from "./cameraFeedbackFlow";
import { createQuakeMobileControls } from "../mobileControls";

const QUAKE_POINTER_LOCK_RETRY_MS = 500;
const QUAKE_MOBILE_MOVE_SPEED = 5.4;
const QUAKE_MOBILE_MOVE_DEADZONE = 0.08;
const QUAKE_MOBILE_MOVE_DT_CLAMP = 0.035;
const QUAKE_MOBILE_LOOK_SENSITIVITY = 0.12;
const QUAKE_MOBILE_LOOK_EPSILON = 0.01;

interface QuakePointerGameplayControls {
  getOrigin(): Vec3;
  lock(): void;
  update(partial: {
    crouchEnabled?: boolean;
    gravity?: number;
    jumpEnabled?: boolean;
    moveEnabled?: boolean;
  }): void;
  addEventListener(type: "start" | "end", listener: () => void): void;
  removeEventListener(type: "start" | "end", listener: () => void): void;
}

export interface QuakePointerGameplayFlowOptions {
  activeElement(): Element | null;
  applyCameraAt(origin: Vec3, rotX: number, rotY: number): void;
  audioUnlock(): void;
  canUseGameplayInput(): boolean;
  clearDeathUnlockControlsEndTraceSuppression(): void;
  clearMainMenuControlsEndSuppression(): void;
  clearParentKeyRelay(): void;
  controls: QuakePointerGameplayControls;
  currentCameraRenderOrigin(): Vec3;
  eventTargetLabel(target: EventTarget | null): string;
  fireWeapon(now: number): void;
  focusHost(): void;
  forwardDirection(rotX: number, rotY: number): Vec3;
  hidePersistedLoadingConsole(): void;
  host: HTMLElement;
  invertMouse(): boolean;
  isDebugFlyModeActive(): boolean;
  isDeathUnlockControlsEndTraceSuppressed(): boolean;
  isDisposed(): boolean;
  isPlayerDead(): boolean;
  mobileRoot: HTMLElement;
  onAvailabilityChange(): void;
  pointerLockElement(): Element | null;
  queueCrosshairTargetSync(): void;
  renderSupersample: number;
  respawnPlayerFromDeath(): boolean;
  rotation(): { rotX: number; rotY: number };
  setAnalogMove(x: number, y: number): void;
  setDebugOrigin(origin: [number, number, number]): void;
  syncDebugFlyView(origin: [number, number, number]): void;
  syncInteractionPresentation(): void;
  trace(kind: string, details?: Record<string, unknown>): void;
  traceActionAtCrosshair(): QuakeUseTrace | null;
  traceUserActivationDetails(): Record<string, unknown>;
  tryActivateCrosshairAction(trace: QuakeUseTrace | null): boolean;
  viewmodelSyncTransform(): void;
}

export interface QuakePointerGameplayFlow {
  attach(): void;
  clearAttackInput(): void;
  clearMobileLookInput(): void;
  clearMobileMoveInput(): void;
  dispose(): void;
  isAttackDown(): boolean;
  isMobileAvailable(): boolean;
  isMobileTarget(target: EventTarget | null): boolean;
}

export function createQuakePointerGameplayFlow(
  options: QuakePointerGameplayFlowOptions,
): QuakePointerGameplayFlow {
  let pointerLockRetryAt = -Infinity;
  let attached = false;

  const mobileControls = createQuakeMobileControls({
    root: options.mobileRoot,
    moveDeadzone: QUAKE_MOBILE_MOVE_DEADZONE,
    moveDtClamp: QUAKE_MOBILE_MOVE_DT_CLAMP,
    canUseInput: options.canUseGameplayInput,
    isDisposed: options.isDisposed,
    useMoveFrame: options.isDebugFlyModeActive,
    onAvailabilityChange: options.onAvailabilityChange,
    onMoveIntent: options.hidePersistedLoadingConsole,
    onAnalogMove: options.setAnalogMove,
    onMoveFrame: moveFromMobileStick,
    onLookStart: startMobileLookInput,
    onLookDelta: applyMobileLookDelta,
    onFireDown: handleMobileFirePointerDown,
    onFireEnd: handleMobileFirePointerEnd,
  });

  const attackInput = createQuakeAttackInputController({
    canUseInput: options.canUseGameplayInput,
    fire: options.fireWeapon,
    isDisposed: options.isDisposed,
    releasePointerCapture: (pointerId) => mobileControls.releaseFirePointerCapture(pointerId),
  });

  function attach(): void {
    if (attached) return;
    attached = true;
    window.addEventListener("pointerup", handleAttackPointerEnd, { capture: true });
    window.addEventListener("pointercancel", handleAttackPointerEnd, { capture: true });
    document.addEventListener("pointerlockchange", options.syncInteractionPresentation);
    document.addEventListener("pointerlockerror", handlePointerLockError);
    options.host.addEventListener("pointerdown", handleUsePointerDown, { capture: true });
    options.controls.addEventListener("start", handleControlsStart);
    options.controls.addEventListener("end", handleControlsEndTrace);
    options.controls.addEventListener("end", clearAttackInput);
    mobileControls.attach();
  }

  function dispose(): void {
    if (attached) {
      window.removeEventListener("pointerup", handleAttackPointerEnd, { capture: true });
      window.removeEventListener("pointercancel", handleAttackPointerEnd, { capture: true });
      document.removeEventListener("pointerlockchange", options.syncInteractionPresentation);
      document.removeEventListener("pointerlockerror", handlePointerLockError);
      options.host.removeEventListener("pointerdown", handleUsePointerDown, { capture: true });
      options.controls.removeEventListener("start", handleControlsStart);
      options.controls.removeEventListener("end", handleControlsEndTrace);
      options.controls.removeEventListener("end", clearAttackInput);
      attached = false;
    }
    mobileControls.dispose();
    attackInput.dispose();
  }

  function handleUsePointerDown(event: PointerEvent): void {
    options.trace("host-pointerdown", {
      button: event.button,
      primary: event.isPrimary,
      pointerId: event.pointerId,
      target: options.eventTargetLabel(event.target),
      defaultPrevented: event.defaultPrevented,
    });
    if (mobileControls.isTarget(event.target)) {
      options.trace("host-pointerdown-ignored", { pointerId: event.pointerId, reason: "mobile-controls" });
      return;
    }
    if (event.button !== 0 || !event.isPrimary) {
      options.trace("host-pointerdown-ignored", {
        button: event.button,
        primary: event.isPrimary,
        reason: "button-or-non-primary",
      });
      return;
    }
    if (options.isPlayerDead()) {
      options.trace("host-pointerdown-respawn", { pointerId: event.pointerId });
      event.preventDefault();
      event.stopPropagation();
      clearAttackInput();
      options.audioUnlock();
      options.respawnPlayerFromDeath();
      return;
    }
    if (!options.canUseGameplayInput()) {
      options.trace("host-pointerdown-ignored", { pointerId: event.pointerId, reason: "cannot-input" });
      return;
    }
    options.hidePersistedLoadingConsole();
    event.preventDefault();
    const now = performance.now();
    if (options.pointerLockElement() !== options.host) {
      clearAttackInput();
      engagePointerControls(now);
      options.queueCrosshairTargetSync();
      return;
    }
    if (attackInput.isDown()) {
      attackInput.schedule();
      return;
    }
    const actionTrace = options.traceActionAtCrosshair();
    if (options.tryActivateCrosshairAction(actionTrace)) {
      clearAttackInput();
      engagePointerControls(now);
      options.queueCrosshairTargetSync();
      return;
    }
    engagePointerControls(now);
    attackInput.start(event.pointerId, now);
  }

  function engagePointerControls(now = performance.now()): void {
    options.audioUnlock();
    if (options.activeElement() !== options.host) options.focusHost();
    if (options.pointerLockElement() !== options.host && now >= pointerLockRetryAt) {
      pointerLockRetryAt = now + QUAKE_POINTER_LOCK_RETRY_MS;
      options.trace("controls-lock-request", {
        retryAt: Math.round(pointerLockRetryAt * 10) / 10,
        ...options.traceUserActivationDetails(),
      });
      options.controls.lock();
    }
  }

  function handlePointerLockError(event: Event): void {
    options.trace("pointerlockerror", { target: options.eventTargetLabel(event.target) });
  }

  function handleControlsStart(): void {
    options.syncInteractionPresentation();
    options.trace("controls-start");
    options.clearMainMenuControlsEndSuppression();
  }

  function handleControlsEndTrace(): void {
    options.syncInteractionPresentation();
    options.clearParentKeyRelay();
    if (options.isDeathUnlockControlsEndTraceSuppressed()) {
      options.clearDeathUnlockControlsEndTraceSuppression();
      return;
    }
    options.clearDeathUnlockControlsEndTraceSuppression();
    options.trace("controls-end");
  }

  function handleAttackPointerEnd(event: PointerEvent): void {
    attackInput.handlePointerEnd(event);
  }

  function clearAttackInput(): void {
    attackInput.clear();
  }

  function clearMobileLookInput(): void {
    mobileControls.clearLookInput();
  }

  function clearMobileMoveInput(): void {
    mobileControls.clearMoveInput();
  }

  function startMobileLookInput(_event: PointerEvent): boolean {
    options.audioUnlock();
    if (!options.canUseGameplayInput()) return false;
    options.hidePersistedLoadingConsole();
    if (options.activeElement() !== options.host) options.focusHost();
    return true;
  }

  function applyMobileLookDelta(deltaX: number, deltaY: number): void {
    if (Math.abs(deltaX) <= QUAKE_MOBILE_LOOK_EPSILON && Math.abs(deltaY) <= QUAKE_MOBILE_LOOK_EPSILON) return;
    const { rotX: currentRotX, rotY: currentRotY } = options.rotation();
    const pitchDirection = options.invertMouse() ? 1 : -1;
    const nextRotX = clampNumber(
      currentRotX + deltaY * QUAKE_MOBILE_LOOK_SENSITIVITY * pitchDirection,
      QUAKE_CAMERA_ROT_X_MIN,
      QUAKE_CAMERA_ROT_X_MAX,
    );
    const nextRotY = normalizeQuakeUrlAngle(currentRotY - deltaX * QUAKE_MOBILE_LOOK_SENSITIVITY);
    options.applyCameraAt(options.currentCameraRenderOrigin(), nextRotX, nextRotY);
    options.viewmodelSyncTransform();
    options.queueCrosshairTargetSync();
  }

  function moveFromMobileStick(dt: number, moveX: number, moveY: number): void {
    const origin = options.controls.getOrigin();
    const { rotX: cameraRotX, rotY } = options.rotation();
    const rotX = options.isDebugFlyModeActive() ? cameraRotX : 90;
    const forward = options.forwardDirection(rotX, rotY);
    const horizontalForward = options.forwardDirection(90, rotY);
    const right: Vec3 = [horizontalForward[1], -horizontalForward[0], 0];
    const step = QUAKE_MOBILE_MOVE_SPEED * options.renderSupersample * dt;
    const nextOrigin: [number, number, number] = [
      origin[0] + (forward[0] * moveY + right[0] * moveX) * step,
      origin[1] + (forward[1] * moveY + right[1] * moveX) * step,
      origin[2] + (options.isDebugFlyModeActive() ? forward[2] * moveY * step : 0),
    ];
    if (options.isDebugFlyModeActive()) {
      options.setDebugOrigin(nextOrigin);
      options.controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
      options.syncDebugFlyView(nextOrigin);
    } else {
      options.setAnalogMove(moveX, moveY);
    }
  }

  function handleMobileFirePointerDown(event: PointerEvent): boolean {
    options.audioUnlock();
    if (options.isPlayerDead()) {
      clearAttackInput();
      options.respawnPlayerFromDeath();
      return false;
    }
    if (!options.canUseGameplayInput()) return false;
    options.hidePersistedLoadingConsole();
    if (options.activeElement() !== options.host) options.focusHost();
    if (attackInput.isDown()) {
      attackInput.schedule();
      return true;
    }
    attackInput.start(event.pointerId, performance.now());
    return true;
  }

  function handleMobileFirePointerEnd(event: PointerEvent): void {
    attackInput.handlePointerEnd(event);
  }

  return {
    attach,
    clearAttackInput,
    clearMobileLookInput,
    clearMobileMoveInput,
    dispose,
    isAttackDown: () => attackInput.isDown(),
    isMobileAvailable: () => mobileControls.isAvailable(),
    isMobileTarget: (target) => mobileControls.isTarget(target),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
