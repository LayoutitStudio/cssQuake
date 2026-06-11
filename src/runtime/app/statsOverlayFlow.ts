import { mountQuakeStatsOverlay } from "../debug/statsPanel";

export interface QuakeStatsOverlayFlowOptions {
  isDisposed(): boolean;
  isLoading(): boolean;
  isMobileAvailable(): boolean;
  root: HTMLElement;
  showFpsEnabled(): boolean;
}

export interface QuakeStatsOverlayFlow {
  hide(): void;
  show(): void;
  syncAvailability(): void;
}

export function createQuakeStatsOverlayFlow(
  options: QuakeStatsOverlayFlowOptions,
): QuakeStatsOverlayFlow {
  let disposeStatsOverlay: (() => void) | null = null;

  function show(): void {
    if (disposeStatsOverlay || options.isDisposed() || options.isMobileAvailable()) return;
    disposeStatsOverlay = mountQuakeStatsOverlay(options.root);
  }

  function hide(): void {
    disposeStatsOverlay?.();
    disposeStatsOverlay = null;
  }

  function syncAvailability(): void {
    if (!options.showFpsEnabled() || options.isDisposed() || options.isLoading() || options.isMobileAvailable()) {
      hide();
      return;
    }
    show();
  }

  return {
    hide,
    show,
    syncAvailability,
  };
}
