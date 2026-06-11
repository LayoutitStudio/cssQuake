export interface QuakeAttackInputController {
  clear(): void;
  dispose(): void;
  handlePointerEnd(event: PointerEvent): void;
  isDown(): boolean;
  schedule(): void;
  start(pointerId: number, now?: number): void;
}

export interface QuakeAttackInputControllerOptions {
  canUseInput(): boolean;
  fire(now: number): void;
  isDisposed(): boolean;
  releasePointerCapture(pointerId: number | null): void;
}

export function createQuakeAttackInputController(options: QuakeAttackInputControllerOptions): QuakeAttackInputController {
  let pointerId: number | null = null;
  let inputDown = false;
  let frame = 0;

  function start(nextPointerId: number, now = performance.now()): void {
    pointerId = nextPointerId;
    inputDown = true;
    runFrame(now);
  }

  function handlePointerEnd(event: PointerEvent): void {
    if (pointerId !== null && event.pointerId !== pointerId) return;
    clear();
  }

  function clear(): void {
    const releasedPointerId = pointerId;
    options.releasePointerCapture(releasedPointerId);
    inputDown = false;
    pointerId = null;
    if (!frame) return;
    window.cancelAnimationFrame(frame);
    frame = 0;
  }

  function schedule(): void {
    if (options.isDisposed() || !inputDown || frame) return;
    frame = window.requestAnimationFrame(runFrame);
  }

  function runFrame(now: number): void {
    frame = 0;
    if (!inputDown) return;
    if (!options.canUseInput()) {
      clear();
      return;
    }
    options.fire(now);
    if (options.canUseInput()) schedule();
  }

  function dispose(): void {
    clear();
  }

  return {
    clear,
    dispose,
    handlePointerEnd,
    isDown: () => inputDown,
    schedule,
    start,
  };
}
