import { markQuakeTrace } from "./debug/traceMarks";

export const QUAKE_MOBILE_CONTROLS_QUERY =
  "(any-pointer: coarse) and (orientation: landscape), (max-width: 960px) and (orientation: landscape)";

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
  let moveStick: HTMLElement | null = null;
  let moveStickBack: HTMLElement | null = null;
  let moveStickFront: HTMLElement | null = null;
  let lookZone: HTMLElement | null = null;
  let fireButton: HTMLButtonElement | null = null;
  let moveFrame = 0;
  let moveTime = 0;
  let moveX = 0;
  let moveY = 0;
  let movePointerId: number | null = null;
  let moveStartedAt = 0;
  let moveSampleCount = 0;
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
    const nextMoveStick = document.createElement("div");
    nextMoveStick.className = "joystick";
    const nextMoveStickBack = document.createElement("div");
    nextMoveStickBack.className = "back";
    const nextMoveStickFront = document.createElement("div");
    nextMoveStickFront.className = "front";
    nextMoveStick.append(nextMoveStickBack, nextMoveStickFront);
    nextMoveZone.append(nextMoveStick);

    const nextFireButton = document.createElement("button");
    nextFireButton.id = "quake-mobile-fire";
    nextFireButton.type = "button";
    nextFireButton.setAttribute("aria-label", "Fire");

    controlsRoot.append(nextLookZone, nextMoveZone, nextFireButton);
    options.root.append(controlsRoot);

    root = controlsRoot;
    lookZone = nextLookZone;
    moveZone = nextMoveZone;
    moveStick = nextMoveStick;
    moveStickBack = nextMoveStickBack;
    moveStickFront = nextMoveStickFront;
    fireButton = nextFireButton;
    syncMoveStickVisual(0, 0, false);
    nextMoveZone.addEventListener("pointerdown", handleMovePointerDown);
    nextMoveZone.addEventListener("pointermove", handleMovePointerMove);
    nextMoveZone.addEventListener("pointerup", handleMovePointerEnd);
    nextMoveZone.addEventListener("pointercancel", handleMovePointerEnd);
    nextMoveZone.addEventListener("lostpointercapture", handleMovePointerEnd);
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
    moveZone?.removeEventListener("pointerdown", handleMovePointerDown);
    moveZone?.removeEventListener("pointermove", handleMovePointerMove);
    moveZone?.removeEventListener("pointerup", handleMovePointerEnd);
    moveZone?.removeEventListener("pointercancel", handleMovePointerEnd);
    moveZone?.removeEventListener("lostpointercapture", handleMovePointerEnd);
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
    moveStick = null;
    moveStickBack = null;
    moveStickFront = null;
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

  function handleMovePointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      markQuakeTrace("mobile-pointer-conflict", {
        pointerId: event.pointerId,
        reason: "move-button",
        target: "move",
      });
      return;
    }
    if (movePointerId !== null) {
      markQuakeTrace("mobile-pointer-conflict", {
        pointerId: event.pointerId,
        reason: "move-active",
        target: "move",
      });
      return;
    }
    if (!options.canUseInput()) {
      markQuakeTrace("mobile-pointer-conflict", {
        pointerId: event.pointerId,
        reason: "move-cannot-input",
        target: "move",
      });
      return;
    }
    movePointerId = event.pointerId;
    moveStartedAt = performance.now();
    moveSampleCount = 0;
    markQuakeTrace("mobile-move-start", {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    try {
      moveZone?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the pointer ended during the same frame.
    }
    handleMovePointerPosition(event, "start");
  }

  function handleMovePointerMove(event: PointerEvent): void {
    if (event.pointerId !== movePointerId) return;
    event.preventDefault();
    event.stopPropagation();
    handleMovePointerPosition(event, "move");
  }

  function handleMovePointerEnd(event: PointerEvent): void {
    if (event.pointerId !== movePointerId) return;
    event.preventDefault();
    event.stopPropagation();
    clearMoveInput("end");
  }

  function handleMovePointerPosition(event: PointerEvent, phase: "start" | "move"): void {
    if (!options.canUseInput()) {
      clearMoveInput("cannot-input");
      return;
    }
    const zone = moveZone;
    if (!zone) {
      clearMoveInput("missing-zone");
      return;
    }
    const rect = zone.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) / 2;
    if (radius <= 0) {
      clearMoveInput("missing-radius");
      return;
    }
    moveSampleCount++;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    setMoveInput((event.clientX - centerX) / radius, (centerY - event.clientY) / radius, phase);
  }

  function setMoveInput(x: number, y: number, source: "start" | "move"): void {
    const length = Math.hypot(x, y);
    if (length < options.moveDeadzone) {
      markQuakeTrace("mobile-move-input", {
        length,
        source,
        x,
        y,
      });
      syncMoveStickVisual(0, 0, true);
      clearMoveVector();
      return;
    }
    if (options.canUseInput()) options.onMoveIntent();
    const scale = length > 1 ? 1 / length : 1;
    moveX = x * scale;
    moveY = y * scale;
    syncMoveStickVisual(moveX, moveY, true);
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
    const pointerId = movePointerId;
    if (moveX || moveY) {
      markQuakeTrace("mobile-move-clear", {
        durationMs: moveStartedAt ? performance.now() - moveStartedAt : 0,
        lastX: moveX,
        lastY: moveY,
        pointerId,
        reason,
        sampleCount: moveSampleCount,
      });
    }
    if (pointerId !== null && moveZone?.hasPointerCapture(pointerId)) {
      try {
        moveZone.releasePointerCapture(pointerId);
      } catch {
        // The browser may already have released capture on pointer cancellation.
      }
    }
    movePointerId = null;
    moveX = 0;
    moveY = 0;
    moveTime = 0;
    moveStartedAt = 0;
    moveSampleCount = 0;
    syncMoveStickVisual(0, 0, false);
    options.onAnalogMove(0, 0);
    if (!moveFrame) return;
    window.cancelAnimationFrame(moveFrame);
    moveFrame = 0;
  }

  function clearMoveVector(): void {
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
    if (!options.canUseInput()) {
      clearMoveInput("cannot-input");
      return;
    }
    const dt = Math.min(options.moveDtClamp, moveTime ? (now - moveTime) / 1000 : 0.0167);
    options.onMoveFrame(dt, moveX, moveY);
    moveTime = now;
    scheduleMoveFrame();
  }

  function syncMoveStickVisual(x: number, y: number, active: boolean): void {
    const stick = moveStick;
    const back = moveStickBack;
    const front = moveStickFront;
    if (!stick || !back || !front) return;
    const stickSize = 108;
    const frontSize = 54;
    const frontTravel = stickSize / 4;
    stick.style.position = "absolute";
    stick.style.display = "block";
    stick.style.left = "50%";
    stick.style.top = "50%";
    stick.style.width = `${stickSize}px`;
    stick.style.height = `${stickSize}px`;
    stick.style.marginLeft = `${-stickSize / 2}px`;
    stick.style.marginTop = `${-stickSize / 2}px`;
    stick.style.opacity = active ? "1" : "0.58";
    stick.style.touchAction = "none";
    stick.style.userSelect = "none";
    stick.style.pointerEvents = "none";
    stick.style.zIndex = "999";

    back.style.position = "absolute";
    back.style.display = "block";
    back.style.left = "0px";
    back.style.top = "0px";
    back.style.width = `${stickSize}px`;
    back.style.height = `${stickSize}px`;
    back.style.marginLeft = "0px";
    back.style.marginTop = "0px";
    back.style.borderRadius = "50%";
    back.style.background = "rgba(10, 9, 7, 0.34)";
    back.style.boxSizing = "border-box";
    back.style.border = "2px solid rgba(245, 232, 200, 0.42)";
    back.style.pointerEvents = "none";

    front.style.position = "absolute";
    front.style.display = "block";
    front.style.left = "50%";
    front.style.top = "50%";
    front.style.width = `${frontSize}px`;
    front.style.height = `${frontSize}px`;
    front.style.marginLeft = `${-frontSize / 2}px`;
    front.style.marginTop = `${-frontSize / 2}px`;
    front.style.borderRadius = "50%";
    front.style.background = "rgba(245, 232, 200, 0.18)";
    front.style.opacity = "0.5";
    front.style.boxSizing = "border-box";
    front.style.border = "2px solid rgba(245, 232, 200, 0.48)";
    front.style.pointerEvents = "none";
    front.style.transform = `translate(${x * frontTravel}px, ${-y * frontTravel}px)`;
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
