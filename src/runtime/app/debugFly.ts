import type { Vec3 } from "@layoutit/polycss";
import { distanceSq3, normalizeVec3 } from "../math";

interface QuakeDebugFlyControlsUpdate {
  moveEnabled?: boolean;
  jumpEnabled?: boolean;
  crouchEnabled?: boolean;
  jumpVelocity?: number;
  gravity?: number;
}

export interface QuakeDebugFlyController {
  clearInput(): void;
  dispose(): void;
  handleKey(event: KeyboardEvent, pressed: boolean): boolean;
  isActive(): boolean;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  syncMode(): void;
}

export interface QuakeDebugFlyControllerOptions {
  canUseInput(): boolean;
  cameraRotation(): { rotX: number; rotY: number };
  clearCrouchInput(): void;
  clearMoveInput(): void;
  controlsOrigin(): Vec3;
  crouchKeyCodes: ReadonlySet<string>;
  dtClamp: number;
  fastMultiplier: number;
  initialEnabled: boolean;
  isDisposed(): boolean;
  isEditableTarget(target: EventTarget | null): boolean;
  jumpVelocity: number;
  moveKeyCodes: ReadonlySet<string>;
  onDisabledAfterActive(): void;
  setBodyClass(className: string, enabled: boolean): void;
  setDebugOrigin(origin: [number, number, number]): void;
  speed: number;
  syncOption(enabled: boolean): void;
  syncView(origin: [number, number, number]): void;
  updateControls(partial: QuakeDebugFlyControlsUpdate): void;
  viewForward(rotX: number, rotY: number): Vec3;
}

export function createQuakeDebugFlyController(options: QuakeDebugFlyControllerOptions): QuakeDebugFlyController {
  let enabled = options.initialEnabled;
  let active = false;
  let frame = 0;
  let lastFrameTime = 0;
  const keyCodesDown = new Set<string>();

  function isActive(): boolean {
    return enabled && options.canUseInput();
  }

  function clearInput(): void {
    keyCodesDown.clear();
    lastFrameTime = 0;
    if (!frame) return;
    window.cancelAnimationFrame(frame);
    frame = 0;
  }

  function dispose(): void {
    clearInput();
  }

  function setEnabled(nextEnabled: boolean): void {
    enabled = nextEnabled;
    syncMode();
  }

  function syncMode(): void {
    options.syncOption(enabled);
    const wasActive = active;
    active = enabled;
    options.setBodyClass("quake-debug-fly", enabled);
    if (enabled) {
      options.clearMoveInput();
      options.clearCrouchInput();
      options.updateControls({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
      scheduleFrame();
      return;
    }

    clearInput();
    if (wasActive) options.onDisabledAfterActive();
    options.updateControls({
      moveEnabled: false,
      jumpEnabled: false,
      crouchEnabled: false,
      jumpVelocity: options.jumpVelocity,
      gravity: 0,
    });
  }

  function handleKey(event: KeyboardEvent, pressed: boolean): boolean {
    if (!enabled || !debugFlyKeyCode(event.code)) return false;
    if (!options.canUseInput() || options.isEditableTarget(event.target)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (pressed) {
      keyCodesDown.add(event.code);
      scheduleFrame();
    } else {
      keyCodesDown.delete(event.code);
    }
    return true;
  }

  function scheduleFrame(): void {
    if (options.isDisposed() || frame || !enabled) return;
    frame = window.requestAnimationFrame(runFrame);
  }

  function runFrame(now: number): void {
    frame = 0;
    if (!enabled) {
      lastFrameTime = 0;
      return;
    }
    if (!isActive()) {
      lastFrameTime = now;
      scheduleFrame();
      return;
    }

    options.updateControls({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
    const dt = Math.min(options.dtClamp, lastFrameTime ? (now - lastFrameTime) / 1000 : 0.0167);
    lastFrameTime = now;
    const direction = currentDirection();
    if (distanceSq3(direction, [0, 0, 0]) > 0) {
      const origin = options.controlsOrigin();
      const speed = options.speed * (fastActive() ? options.fastMultiplier : 1);
      const nextOrigin: [number, number, number] = [
        origin[0] + direction[0] * speed * dt,
        origin[1] + direction[1] * speed * dt,
        origin[2] + direction[2] * speed * dt,
      ];
      options.setDebugOrigin(nextOrigin);
      options.updateControls({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
      options.syncView(nextOrigin);
    }
    scheduleFrame();
  }

  function currentDirection(): Vec3 {
    const { rotX, rotY } = options.cameraRotation();
    const forward = options.viewForward(rotX, rotY);
    const horizontalForward = options.viewForward(90, rotY);
    const right: Vec3 = [horizontalForward[1], -horizontalForward[0], 0];
    const direction: Vec3 = [0, 0, 0];

    if (keyCodesDown.has("KeyW") || keyCodesDown.has("ArrowUp")) {
      direction[0] += forward[0];
      direction[1] += forward[1];
      direction[2] += forward[2];
    }
    if (keyCodesDown.has("KeyS") || keyCodesDown.has("ArrowDown")) {
      direction[0] -= forward[0];
      direction[1] -= forward[1];
      direction[2] -= forward[2];
    }
    if (keyCodesDown.has("KeyD") || keyCodesDown.has("ArrowRight")) {
      direction[0] += right[0];
      direction[1] += right[1];
    }
    if (keyCodesDown.has("KeyA") || keyCodesDown.has("ArrowLeft")) {
      direction[0] -= right[0];
      direction[1] -= right[1];
    }
    if (keyCodesDown.has("Space")) direction[2] += 1;
    if (keyCodesDown.has("ControlLeft") || keyCodesDown.has("ControlRight") || keyCodesDown.has("KeyC")) {
      direction[2] -= 1;
    }

    return distanceSq3(direction, [0, 0, 0]) > 0 ? normalizeVec3(direction) : direction;
  }

  function fastActive(): boolean {
    return keyCodesDown.has("ShiftLeft") || keyCodesDown.has("ShiftRight");
  }

  function debugFlyKeyCode(code: string): boolean {
    return options.moveKeyCodes.has(code) ||
      options.crouchKeyCodes.has(code) ||
      code === "Space" ||
      code === "KeyC" ||
      code === "ShiftLeft" ||
      code === "ShiftRight";
  }

  return {
    clearInput,
    dispose,
    handleKey,
    isActive,
    isEnabled: () => enabled,
    setEnabled,
    syncMode,
  };
}
