import {
  QUAKE_ASSETS_REGENERATING_ACTION,
  QUAKE_ASSETS_REGENERATING_STATUS,
  createQuakeLoadingConsole,
  type QuakeLoadingConsole,
  type QuakeLoadingProgressTracker,
} from "../loadingConsole";
import type { QuakeUrlRoute } from "../routeState";
import { addQuakeBodyClasses, removeQuakeBodyClasses } from "./dom";
import type { QuakeAppDomElements } from "./dom";
import type { QuakeAssetManifest, QuakeMapLoadOptions } from "./session";

const QUAKE_LOADING_READY_MIN_PRESENTED_FRAMES = 6;
const QUAKE_LOADING_READY_STABLE_PRESENTED_FRAMES = 3;
const QUAKE_LOADING_READY_FRAME_BUDGET_MS = 45;
const QUAKE_LOADING_READY_TIMEOUT_MS = 1500;

export interface QuakeLoadingReadinessSnapshot {
  elapsedMs: number;
  frames: number;
  maxFrameMs: number;
  maxIntervalMs: number;
  maxPresentDelayMs: number;
  slowFrames: number;
  stableFrames: number;
  timedOut: boolean;
}

export interface QuakeLoadingFlowOptions {
  dom: QuakeAppDomElements;
  initialLoading: boolean;
  previewEnabled: boolean;
  currentMapName(): string;
  hasCurrentResult(): boolean;
  isDisposed(): boolean;
  isGameplayStarted(): boolean;
  isLevelTransitionActive(): boolean;
  isMainMenuOpen(): boolean;
  isMenuPanelOpen(): boolean;
  clearAttackInput(): void;
  clearBonusOverlay(): void;
  clearCrosshairTarget(): void;
  clearCrouchInput(): void;
  clearDebugFlyInput(): void;
  clearMobileMoveInput(): void;
  clearMoveInput(): void;
  clearWeaponViewPunch(): void;
  hideStatsOverlay(): void;
  onLoadingChange(loading: boolean): void;
  renderBitmapText(element: HTMLElement): void;
  setControlsLoading(): void;
  syncCrosshairTarget(): void;
  syncDebugFlyMode(): void;
  syncStatsOverlayAvailability(): void;
  trace(kind: string, details?: Record<string, unknown>): void;
}

export interface QuakeLoadingFlow {
  readonly console: QuakeLoadingConsole;
  clearDeathOverlay(): void;
  completeSceneReadiness<T>(
    modelPromise: Promise<T>,
    mountModel: (modelPromise: Promise<T>, isCurrent: () => boolean) => Promise<void>,
    progress?: QuakeLoadingProgressTracker,
    isCurrent?: () => boolean,
  ): Promise<void>;
  createProgressTracker(status?: string): QuakeLoadingProgressTracker;
  handleGameplayStarted(started: boolean): void;
  hasDeathOverlay(): boolean;
  hidePersistedConsole(): void;
  isLoading(): boolean;
  loadStartup(options: QuakeLoadingStartupOptions): Promise<void>;
  setAssetsRegenerating(message?: string): void;
  setError(error?: unknown): void;
  setLoading(active: boolean, status?: string, options?: { preserveConsole?: boolean }): void;
  showDeathOverlay(): void;
  waitForReadiness(): Promise<QuakeLoadingReadinessSnapshot>;
}

export interface QuakeLoadingStartupOptions {
  fetchManifest(): Promise<QuakeAssetManifest>;
  initializedLine: string;
  onReady(): void;
  loadMap(mapName: string, options?: QuakeMapLoadOptions): Promise<boolean>;
  loadPickupModels(progress?: QuakeLoadingProgressTracker): Promise<void>;
  loadProgramMetadata(progress?: QuakeLoadingProgressTracker): Promise<void>;
  pakLine: string;
  preloadWeapon(progress?: QuakeLoadingProgressTracker): Promise<unknown>;
  routeFromLocation(): QuakeUrlRoute;
  routeIsDirect(route: QuakeUrlRoute): boolean;
  routeShouldNormalize(route: QuakeUrlRoute): boolean;
  sceneUrl(mapName: string): string | undefined;
  setAssetManifest(manifest: QuakeAssetManifest): void;
  setCurrentMapName(mapName: string): void;
  setMenuCurrentLevel(mapName: string): void;
  syncRoutePresentation(route: QuakeUrlRoute, options?: { preferMenu?: boolean }): void;
}

export function createQuakeLoadingFlow(options: QuakeLoadingFlowOptions): QuakeLoadingFlow {
  const dom = options.dom;
  let loading = options.initialLoading;
  const loadingConsole = createQuakeLoadingConsole({
    overlay: dom.loadingOverlay,
    status: dom.loadingStatus,
    progress: dom.loadingProgress,
    progressFill: dom.loadingProgressFill,
    action: dom.loadingAction,
    hasCurrentResult: options.hasCurrentResult,
    isLoading: () => loading,
    renderBitmapText: options.renderBitmapText,
  });

  function setLoadingState(active: boolean): void {
    loading = active;
    options.onLoadingChange(active);
  }

  function isLoading(): boolean {
    return loading;
  }

  function createProgressTracker(status = "Loading"): QuakeLoadingProgressTracker {
    return loadingConsole.createProgressTracker(status);
  }

  async function loadStartup(startup: QuakeLoadingStartupOptions): Promise<void> {
    const progress = createProgressTracker("Loading");
    setLoading(true);
    const completeManifestTask = progress.startTask("Manifest");
    let hasPakAssets = false;
    try {
      const manifest = await startup.fetchManifest();
      startup.setAssetManifest(manifest);
      hasPakAssets = manifest.maps.some((map) => map.pakPath);
    } finally {
      completeManifestTask();
    }
    const programMetadataPromise = startup.loadProgramMetadata(progress);
    const pickupModelsPromise = startup.loadPickupModels(progress);
    const weaponPromise = startup.preloadWeapon(progress);
    if (hasPakAssets) loadingConsole.queueLine(startup.pakLine);
    await Promise.all([programMetadataPromise, pickupModelsPromise, weaponPromise]);
    if (options.isDisposed()) return;
    // Finish bootstrap before accepting map requests; read the latest browser route.
    const preparedRoute = startup.routeFromLocation();
    if (!startup.routeIsDirect(preparedRoute) && !(preparedRoute.mapParamPresent && !preparedRoute.mapParamValid)) {
      loadingConsole.queueLine(startup.initializedLine);
      await loadingConsole.waitForQueue();
      if (options.isDisposed()) return;
    }
    startup.onReady();
    const startupRoute = startup.routeFromLocation();
    const startMap = startupRoute.mapName;
    if (!startup.sceneUrl(startMap)) throw new Error(`No prepared Quake start map registered for ${startMap}.`);
    startup.setCurrentMapName(startMap);
    startup.setMenuCurrentLevel(startMap);
    const shouldPrimeInvalidMapFallback = startupRoute.mapParamPresent && !startupRoute.mapParamValid;
    if (startup.routeIsDirect(startupRoute) || shouldPrimeInvalidMapFallback) {
      const loaded = await startup.loadMap(startMap, {
        urlMode: startup.routeIsDirect(startupRoute) && startup.routeShouldNormalize(startupRoute) ? "replace" : "none",
        view: startup.routeIsDirect(startupRoute) ? startupRoute.view : null,
      });
      if (!loaded || options.isDisposed()) return;
      startup.syncRoutePresentation(startupRoute, { preferMenu: shouldPrimeInvalidMapFallback });
      return;
    }
    setLoading(false);
    if (options.isDisposed()) return;
    startup.syncRoutePresentation(startupRoute);
  }

  function handleGameplayStarted(started: boolean): void {
    if (!started || !dom.loadingOverlay?.classList.contains("quake-loading-console-persisted")) return;
    if (!options.previewEnabled) {
      hidePersistedConsole();
      return;
    }
    removeQuakeBodyClasses("quake-loading");
    dom.loadingOverlay.hidden = false;
    dom.loadingOverlay.setAttribute("aria-busy", "false");
  }

  function hidePersistedConsole(): void {
    if (!dom.loadingOverlay?.classList.contains("quake-loading-console-persisted")) return;
    removeQuakeBodyClasses("quake-loading");
    dom.loadingOverlay.hidden = true;
    dom.loadingOverlay.removeAttribute("aria-busy");
    dom.loadingOverlay.classList.remove("quake-loading-console-persisted");
    loadingConsole.clearQueue();
  }

  function clearRuntimeInputForLoading(): void {
    options.clearAttackInput();
    options.clearDebugFlyInput();
    options.clearMoveInput();
    options.clearMobileMoveInput();
    options.clearCrouchInput();
    options.clearWeaponViewPunch();
    options.clearBonusOverlay();
  }

  function setLoading(active: boolean, status = "Loading", flowOptions: { preserveConsole?: boolean } = {}): void {
    const wasLoading = loading;
    setLoadingState(active);
    if (active) {
      if (!wasLoading) {
        options.trace("loading-start", { map: options.currentMapName(), status });
      }
      clearRuntimeInputForLoading();
      options.hideStatsOverlay();
      addQuakeBodyClasses("quake-loading");
      dom.loadingOverlay?.classList.remove("quake-loading-console-persisted");
      if (!flowOptions.preserveConsole) loadingConsole.reset(status);
      if (!(status === "Loading" && !options.hasCurrentResult())) {
        loadingConsole.updateDisplay(status, { completed: 0, total: 0 });
      }
      loadingConsole.hideAction();
      loadingConsole.showProgress();
      if (dom.loadingOverlay) {
        dom.loadingOverlay.hidden = false;
        dom.loadingOverlay.setAttribute("aria-busy", "true");
      }
      options.setControlsLoading();
      options.clearCrosshairTarget();
      return;
    }

    if (options.previewEnabled || !options.isGameplayStarted()) {
      addQuakeBodyClasses("quake-loading");
      if (dom.loadingOverlay) {
        dom.loadingOverlay.hidden = false;
        dom.loadingOverlay.setAttribute("aria-busy", "false");
        dom.loadingOverlay.classList.add("quake-loading-console-persisted");
      }
    } else {
      removeQuakeBodyClasses("quake-loading");
      if (dom.loadingOverlay) {
        dom.loadingOverlay.hidden = true;
        dom.loadingOverlay.removeAttribute("aria-busy");
        dom.loadingOverlay.classList.remove("quake-loading-console-persisted");
      }
    }
    loadingConsole.completeQueue();
    loadingConsole.hideAction();
    if (!options.isMainMenuOpen() && !options.isMenuPanelOpen() && !options.isLevelTransitionActive()) {
      options.setControlsLoading();
    }
    options.syncDebugFlyMode();
    options.syncCrosshairTarget();
    options.syncStatsOverlayAvailability();
  }

  function hideMainMenuForLoadingError(): void {
    removeQuakeBodyClasses("quake-menu-open", "quake-main-menu-pending");
    addQuakeBodyClasses("quake-main-menu-deferred");
    if (dom.mainMenu) dom.mainMenu.hidden = true;
    dom.singlePlayerPanel?.setAttribute("hidden", "");
    dom.levelPanel?.setAttribute("hidden", "");
    dom.aboutPanel?.setAttribute("hidden", "");
    dom.optionsPanel?.setAttribute("hidden", "");
  }

  function setError(error?: unknown): void {
    setLoadingState(true);
    clearRuntimeInputForLoading();
    addQuakeBodyClasses("quake-loading");
    hideMainMenuForLoadingError();
    if (dom.loadingOverlay) {
      dom.loadingOverlay.hidden = false;
      dom.loadingOverlay.setAttribute("aria-busy", "false");
      dom.loadingOverlay.classList.add("quake-loading-console-persisted");
    }
    loadingConsole.reset("Load failed");
    loadingConsole.updateDisplay("Load failed", { completed: 0, total: 0 });
    loadingConsole.completeQueue();
    loadingConsole.appendLinesNow(loadingConsole.errorLines(error));
    loadingConsole.hideAction();
    loadingConsole.hideProgress();
    options.setControlsLoading();
    options.clearCrosshairTarget();
  }

  function setAssetsRegenerating(message = QUAKE_ASSETS_REGENERATING_ACTION): void {
    setLoadingState(true);
    clearRuntimeInputForLoading();
    addQuakeBodyClasses("quake-loading");
    loadingConsole.reset(QUAKE_ASSETS_REGENERATING_STATUS);
    loadingConsole.updateDisplay(QUAKE_ASSETS_REGENERATING_STATUS, { completed: 0, total: 0 });
    loadingConsole.showAction(message);
    if (dom.loadingOverlay) {
      dom.loadingOverlay.hidden = false;
      dom.loadingOverlay.setAttribute("aria-busy", "true");
    }
    options.setControlsLoading();
    options.clearCrosshairTarget();
  }

  function hasDeathOverlay(): boolean {
    return dom.loadingOverlay?.classList.contains("quake-loading-death") === true;
  }

  function showDeathOverlay(): void {
    if (!dom.loadingOverlay) return;
    loadingConsole.clearQueue();
    dom.loadingOverlay.hidden = false;
    dom.loadingOverlay.classList.add("quake-loading-death");
    dom.loadingOverlay.setAttribute("aria-busy", "false");
    loadingConsole.setLines(["you died"]);
    loadingConsole.hideProgress();
    loadingConsole.hideAction();
  }

  function clearDeathOverlay(): void {
    if (!hasDeathOverlay() || !dom.loadingOverlay) return;
    dom.loadingOverlay.classList.remove("quake-loading-death");
    loadingConsole.hideAction();
    loadingConsole.showProgress();
    if (!loading && !options.previewEnabled) {
      dom.loadingOverlay.hidden = true;
      dom.loadingOverlay.removeAttribute("aria-busy");
    }
  }

  async function completeSceneReadiness<T>(
    modelPromise: Promise<T>,
    mountModel: (modelPromise: Promise<T>, isCurrent: () => boolean) => Promise<void>,
    progress?: QuakeLoadingProgressTracker,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (options.isDisposed() || !isCurrent()) return;
    await mountModel(modelPromise, isCurrent);
    if (options.isDisposed() || !isCurrent()) return;
    const completeReadinessTask = progress?.startTask("Rendered first frame");
    const readiness = await waitForReadiness();
    if (options.isDisposed() || !isCurrent()) return;
    completeReadinessTask?.();
    const completeFunReminderTask = progress?.startTask("Don't forget to have fun!");
    completeFunReminderTask?.();
    if (options.isDisposed()) return;
    options.trace("loading-ready", {
      map: options.currentMapName(),
      elapsedMs: readiness.elapsedMs,
      frames: readiness.frames,
      maxFrameMs: readiness.maxFrameMs,
      maxIntervalMs: readiness.maxIntervalMs,
      maxPresentDelayMs: readiness.maxPresentDelayMs,
      slowFrames: readiness.slowFrames,
      stableFrames: readiness.stableFrames,
      timedOut: readiness.timedOut,
    });
    options.trace("loading-release", { map: options.currentMapName(), timedOut: readiness.timedOut });
    setLoading(false);
  }

  async function waitForReadiness(): Promise<QuakeLoadingReadinessSnapshot> {
    const startedAt = performance.now();
    let frames = 0;
    let maxFrameMs = 0;
    let maxIntervalMs = 0;
    let maxPresentDelayMs = 0;
    let previousRafAt: number | null = null;
    let slowFrames = 0;
    let stableFrames = 0;

    while (true) {
      const frame = await waitForPresentedFrame();
      frames++;

      const intervalMs = previousRafAt === null ? 0 : Math.max(0, frame.rafAt - previousRafAt);
      const presentDelayMs = Math.max(0, frame.presentedAt - frame.rafAt);
      const frameMs = Math.max(intervalMs, presentDelayMs);
      previousRafAt = frame.rafAt;

      maxFrameMs = Math.max(maxFrameMs, frameMs);
      maxIntervalMs = Math.max(maxIntervalMs, intervalMs);
      maxPresentDelayMs = Math.max(maxPresentDelayMs, presentDelayMs);

      if (frameMs <= QUAKE_LOADING_READY_FRAME_BUDGET_MS) {
        stableFrames++;
      } else {
        slowFrames++;
        stableFrames = 0;
        options.trace("loading-warmup-slow-frame", {
          map: options.currentMapName(),
          frame: frames,
          frameMs,
          intervalMs,
          presentDelayMs,
        });
      }

      const elapsedMs = performance.now() - startedAt;
      if (
        frames >= QUAKE_LOADING_READY_MIN_PRESENTED_FRAMES &&
        stableFrames >= QUAKE_LOADING_READY_STABLE_PRESENTED_FRAMES
      ) {
        return loadingReadinessSnapshot({
          elapsedMs,
          frames,
          maxFrameMs,
          maxIntervalMs,
          maxPresentDelayMs,
          slowFrames,
          stableFrames,
          timedOut: false,
        });
      }
      if (elapsedMs >= QUAKE_LOADING_READY_TIMEOUT_MS) {
        return loadingReadinessSnapshot({
          elapsedMs,
          frames,
          maxFrameMs,
          maxIntervalMs,
          maxPresentDelayMs,
          slowFrames,
          stableFrames,
          timedOut: true,
        });
      }
    }
  }

  return {
    console: loadingConsole,
    clearDeathOverlay,
    completeSceneReadiness,
    createProgressTracker,
    handleGameplayStarted,
    hasDeathOverlay,
    hidePersistedConsole,
    isLoading,
    loadStartup,
    setAssetsRegenerating,
    setError,
    setLoading,
    showDeathOverlay,
    waitForReadiness,
  };
}

function waitForPresentedFrame(): Promise<{ presentedAt: number; rafAt: number }> {
  return new Promise((resolve) => {
    window.requestAnimationFrame((rafAt) => {
      window.setTimeout(() => {
        resolve({ rafAt, presentedAt: performance.now() });
      }, 0);
    });
  });
}

function loadingReadinessSnapshot(snapshot: QuakeLoadingReadinessSnapshot): QuakeLoadingReadinessSnapshot {
  return {
    elapsedMs: roundLoadingReadinessMs(snapshot.elapsedMs),
    frames: snapshot.frames,
    maxFrameMs: roundLoadingReadinessMs(snapshot.maxFrameMs),
    maxIntervalMs: roundLoadingReadinessMs(snapshot.maxIntervalMs),
    maxPresentDelayMs: roundLoadingReadinessMs(snapshot.maxPresentDelayMs),
    slowFrames: snapshot.slowFrames,
    stableFrames: snapshot.stableFrames,
    timedOut: snapshot.timedOut,
  };
}

function roundLoadingReadinessMs(value: number): number {
  return Math.round(value * 10) / 10;
}
