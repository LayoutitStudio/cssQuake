import nipplejs from "nipplejs";

import { markQuakeTrace } from "./debug/traceMarks";

export const QUAKE_MOBILE_CONTROLS_QUERY =
  "(any-pointer: coarse) and (orientation: landscape), (max-width: 960px) and (orientation: landscape)";

interface QuakeMobileMoveStickEvent {
  data: {
    raw?: {
      position?: {
        x: number;
        y: number;
      };
    };
    vector?: {
      x: number;
      y: number;
    };
  };
}

interface QuakeMobileControlsOptions {
  root: HTMLElement;
  moveDeadzone: number;
  moveDtClamp: number;
  canUseInput: () => boolean;
  isAttackDown: () => boolean;
  isDisposed: () => boolean;
  useMoveFrame: () => boolean;
  onAvailabilityChange: () => void;
  onMoveIntent: () => void;
  onAnalogMove: (x: number, y: number) => void;
  onMoveFrame: (dt: number, x: number, y: number) => void;
  onLookStart: (event: PointerEvent) => boolean;
  onLookDelta: (deltaX: number, deltaY: number, pointerId: number) => void;
  onFireDown: (event: PointerEvent) => boolean;
  onFireEnd: (event: PointerEvent) => void;
}

export interface QuakeMobileControls {
  attach(): void;
  clearLookInput(): void;
  clearMoveInput(): void;
  destroy(): void;
  dispose(): void;
  isAvailable(): boolean;
  isTarget(target: EventTarget | null): boolean;
  releaseFirePointerCapture(pointerId: number | null): void;
  setup(): void;
  syncAvailability(): void;
}

export function createQuakeMobileControls(options: QuakeMobileControlsOptions): QuakeMobileControls {
  const media = window.matchMedia(QUAKE_MOBILE_CONTROLS_QUERY);
  let root: HTMLElement | null = null;
  let moveZone: HTMLElement | null = null;
  let lookZone: HTMLElement | null = null;
  let fireButton: HTMLButtonElement | null = null;
  let moveStick: ReturnType<typeof nipplejs.create> | null = null;
  let moveFrame = 0;
  let moveTime = 0;
  let moveX = 0;
  let moveY = 0;
  let lookPointerId: number | null = null;
  let lookLastX = 0;
  let lookLastY = 0;
  let lookMoveCount = 0;
  let lookStartedAt = 0;
  let fireStartedAt = 0;
  let attached = false;

  function attach(): void {
    if (attached) return;
    attached = true;
    media.addEventListener("change", syncAvailability);
    syncAvailability();
  }

  function dispose(): void {
    if (attached) {
      media.removeEventListener("change", syncAvailability);
      attached = false;
    }
    destroy();
  }

  function isAvailable(): boolean {
    return media.matches;
  }

  function isTarget(target: EventTarget | null): boolean {
    return target instanceof Node && root?.contains(target) === true;
  }

  function syncAvailability(): void {
    if (media.matches) {
      setup();
    } else {
      destroy();
    }
    options.onAvailabilityChange();
  }

  function setup(): void {
    if (root) return;
    const controlsRoot = document.createElement("div");
    controlsRoot.id = "quake-mobile-controls";
    controlsRoot.setAttribute("aria-hidden", "true");

    const nextLookZone = document.createElement("div");
    nextLookZone.id = "quake-mobile-look-zone";

    const nextMoveZone = document.createElement("div");
    nextMoveZone.id = "quake-mobile-move-zone";

    const nextFireButton = document.createElement("button");
    nextFireButton.id = "quake-mobile-fire";
    nextFireButton.type = "button";
    nextFireButton.setAttribute("aria-label", "Fire");

    controlsRoot.append(nextLookZone, nextMoveZone, nextFireButton);
    options.root.append(controlsRoot);

    root = controlsRoot;
    lookZone = nextLookZone;
    moveZone = nextMoveZone;
    fireButton = nextFireButton;
    moveStick = nipplejs.create({
      zone: nextMoveZone,
      mode: "static",
      position: { left: "72px", top: "72px" },
      size: 108,
      threshold: options.moveDeadzone,
      dynamicPage: true,
      restOpacity: 0.58,
      fadeTime: 80,
      color: {
        front: "rgba(245, 232, 200, 0.18)",
        back: "rgba(10, 9, 7, 0.34)",
      },
    });
    moveStick.on("move", handleMoveStickMove);
    moveStick.on("end", () => clearMoveInput("end"));
    nextLookZone.addEventListener("pointerdown", handleLookPointerDown);
    nextLookZone.addEventListener("pointermove", handleLookPointerMove);
    nextLookZone.addEventListener("pointerup", handleLookPointerEnd);
    nextLookZone.addEventListener("pointercancel", handleLookPointerEnd);
    nextLookZone.addEventListener("lostpointercapture", handleLookPointerEnd);
    nextFireButton.addEventListener("pointerdown", handleFirePointerDown);
    nextFireButton.addEventListener("pointerup", handleFirePointerEnd);
    nextFireButton.addEventListener("pointercancel", handleFirePointerEnd);
    nextFireButton.addEventListener("lostpointercapture", handleFirePointerEnd);
  }

  function destroy(): void {
    clearLookInput();
    clearMoveInput();
    moveStick?.destroy();
    moveStick = null;
    lookZone?.removeEventListener("pointerdown", handleLookPointerDown);
    lookZone?.removeEventListener("pointermove", handleLookPointerMove);
    lookZone?.removeEventListener("pointerup", handleLookPointerEnd);
    lookZone?.removeEventListener("pointercancel", handleLookPointerEnd);
    lookZone?.removeEventListener("lostpointercapture", handleLookPointerEnd);
    fireButton?.removeEventListener("pointerdown", handleFirePointerDown);
    fireButton?.removeEventListener("pointerup", handleFirePointerEnd);
    fireButton?.removeEventListener("pointercancel", handleFirePointerEnd);
    fireButton?.removeEventListener("lostpointercapture", handleFirePointerEnd);
    root?.remove();
    root = null;
    lookZone = null;
    moveZone = null;
    fireButton = null;
  }

  function handleLookPointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      markQuakeTrace("mobile-pointer-conflict", {
        pointerId: event.pointerId,
        reason: "look-button",
        target: "look",
      });
      return;
    }
    if (lookPointerId !== null) {
      markQuakeTrace("mobile-pointer-conflict", {
        pointerId: event.pointerId,
        reason: "look-active",
        target: "look",
      });
      return;
    }
    if (!options.onLookStart(event)) {
      markQuakeTrace("mobile-pointer-conflict", {
        pointerId: event.pointerId,
        reason: "look-cannot-input",
        target: "look",
      });
      return;
    }
    lookPointerId = event.pointerId;
    lookLastX = event.clientX;
    lookLastY = event.clientY;
    lookMoveCount = 0;
    lookStartedAt = performance.now();
    const rect = lookZone?.getBoundingClientRect();
    markQuakeTrace("mobile-look-start", {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      zoneH: rect?.height,
      zoneW: rect?.width,
    });
    try {
      lookZone?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the pointer ended during the same frame.
    }
  }

  function handleLookPointerMove(event: PointerEvent): void {
    if (event.pointerId !== lookPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!options.canUseInput()) {
      clearLookInput();
      return;
    }
    const deltaX = event.clientX - lookLastX;
    const deltaY = event.clientY - lookLastY;
    lookLastX = event.clientX;
    lookLastY = event.clientY;
    lookMoveCount++;
    options.onLookDelta(deltaX, deltaY, event.pointerId);
  }

  function handleLookPointerEnd(event: PointerEvent): void {
    if (event.pointerId !== lookPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    clearLookInput();
  }

  function clearLookInput(): void {
    const pointerId = lookPointerId;
    if (pointerId !== null) {
      markQuakeTrace("mobile-look-end", {
        durationMs: lookStartedAt ? performance.now() - lookStartedAt : 0,
        moveCount: lookMoveCount,
        pointerId,
      });
    }
    if (pointerId !== null && lookZone?.hasPointerCapture(pointerId)) {
      try {
        lookZone.releasePointerCapture(pointerId);
      } catch {
        // The browser may already have released capture on pointer cancellation.
      }
    }
    lookPointerId = null;
    lookLastX = 0;
    lookLastY = 0;
    lookMoveCount = 0;
    lookStartedAt = 0;
  }

  function handleMoveStickMove(event: QuakeMobileMoveStickEvent): void {
    const zone = moveZone;
    const rawPosition = event.data.raw?.position;
    if (zone && rawPosition && Number.isFinite(rawPosition.x) && Number.isFinite(rawPosition.y)) {
      const rect = zone.getBoundingClientRect();
      const radius = Math.min(rect.width, rect.height) / 2;
      if (radius > 0) {
        const centerX = rect.left + window.scrollX + rect.width / 2;
        const centerY = rect.top + window.scrollY + rect.height / 2;
        setMoveInput((rawPosition.x - centerX) / radius, (centerY - rawPosition.y) / radius, "raw");
        return;
      }
    }

    const vector = event.data.vector;
    if (!vector) {
      clearMoveInput("missing-vector");
      return;
    }
    setMoveInput(vector.x, vector.y, "vector");
  }

  function setMoveInput(x: number, y: number, source: "raw" | "vector"): void {
    const length = Math.hypot(x, y);
    if (length < options.moveDeadzone) {
      markQuakeTrace("mobile-move-input", {
        length,
        source,
        x,
        y,
      });
      clearMoveInput("deadzone");
      return;
    }
    if (options.canUseInput()) options.onMoveIntent();
    const scale = length > 1 ? 1 / length : 1;
    moveX = x * scale;
    moveY = y * scale;
    const rect = moveZone?.getBoundingClientRect();
    markQuakeTrace("mobile-move-input", {
      length: Math.hypot(moveX, moveY),
      source,
      x: moveX,
      y: moveY,
      zoneH: rect?.height,
      zoneW: rect?.width,
    });
    if (options.useMoveFrame()) {
      scheduleMoveFrame();
    } else {
      options.onAnalogMove(moveX, moveY);
    }
  }

  function clearMoveInput(reason = "end"): void {
    if (moveX || moveY) {
      markQuakeTrace("mobile-move-clear", {
        lastX: moveX,
        lastY: moveY,
        reason,
      });
    }
    moveX = 0;
    moveY = 0;
    moveTime = 0;
    options.onAnalogMove(0, 0);
    if (!moveFrame) return;
    window.cancelAnimationFrame(moveFrame);
    moveFrame = 0;
  }

  function scheduleMoveFrame(): void {
    if (options.isDisposed() || moveFrame) return;
    if (Math.hypot(moveX, moveY) < options.moveDeadzone) return;
    moveFrame = window.requestAnimationFrame(runMoveFrame);
  }

  function runMoveFrame(now: number): void {
    moveFrame = 0;
    if (Math.hypot(moveX, moveY) < options.moveDeadzone) {
      moveTime = 0;
      return;
    }
    if (options.canUseInput()) {
      const dt = Math.min(options.moveDtClamp, moveTime ? (now - moveTime) / 1000 : 0.0167);
      options.onMoveFrame(dt, moveX, moveY);
    }
    moveTime = now;
    scheduleMoveFrame();
  }

  function handleFirePointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      markQuakeTrace("mobile-pointer-conflict", {
        pointerId: event.pointerId,
        reason: "fire-button",
        target: "fire",
      });
      return;
    }
    if (!options.onFireDown(event)) {
      markQuakeTrace("mobile-pointer-conflict", {
        pointerId: event.pointerId,
        reason: "fire-cannot-input",
        target: "fire",
      });
      return;
    }
    fireStartedAt = performance.now();
    markQuakeTrace("mobile-fire-down", {
      accepted: true,
      attackDown: options.isAttackDown(),
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    try {
      fireButton?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the pointer ended during the same frame.
    }
  }

  function handleFirePointerEnd(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    options.onFireEnd(event);
    markQuakeTrace("mobile-fire-up", {
      attackDown: options.isAttackDown(),
      durationMs: fireStartedAt ? performance.now() - fireStartedAt : 0,
      pointerId: event.pointerId,
    });
    fireStartedAt = 0;
  }

  function releaseFirePointerCapture(pointerId: number | null): void {
    if (pointerId === null || !fireButton?.hasPointerCapture(pointerId)) return;
    try {
      fireButton.releasePointerCapture(pointerId);
    } catch {
      // The browser may already have released capture on pointer cancellation.
    }
  }

  return {
    attach,
    clearLookInput,
    clearMoveInput,
    destroy,
    dispose,
    isAvailable,
    isTarget,
    releaseFirePointerCapture,
    setup,
    syncAvailability,
  };
}
