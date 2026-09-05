import {
  parseQuakeUrlRouteFromLocation,
  quakeUrlForMapView,
  quakeUrlRouteIsDirect,
  quakeUrlView,
  type QuakeUrlRoute,
  type QuakeUrlUpdateMode,
  type QuakeUrlView,
} from "../routeState";
import { QuakeAssetsRegeneratingError, type QuakeMapLoadOptions } from "./session";

export interface QuakeCssView {
  origin: [number, number, number];
  rotX: number;
  rotY: number;
}

export interface QuakeRouteFlowOptions<TView> {
  applyView(view: TView): void;
  canLoadMap(): boolean;
  clearStartupState(): void;
  currentMapName(): string;
  currentView(): TView;
  hasCurrentScene(): boolean;
  hideMainMenu(): void;
  isDisposed(): boolean;
  isLoading(): boolean;
  loadMap(mapName: string, options: QuakeMapLoadOptions): Promise<boolean>;
  mapExists(mapName: string): boolean;
  menuEnabled: boolean;
  compactMultiplayerInviteMapName?: (inviteId: string) => string | null;
  setAssetsRegenerating(message: string): void;
  setGameplayStarted(started: boolean): void;
  setLoadingError(error?: unknown): void;
  showMainMenu(): void;
  startMap(): string;
  viewFromUrlView(view: QuakeUrlView): TView;
  viewToUrlView(view: TView): QuakeUrlView;
}

export interface QuakeRouteFlow<TView> {
  clearDebugUrlParams(): void;
  clearGameRoute(): void;
  currentViewUrl(): string;
  handlePopState(): void;
  mapLoadView(options: QuakeMapLoadOptions): TView | null;
  routeFromLocation(): QuakeUrlRoute;
  routeView(route: QuakeUrlRoute): TView | null;
  syncPresentation(route: QuakeUrlRoute, options?: { preferMenu?: boolean }): void;
  updateUrl(mapName: string, mode: QuakeUrlUpdateMode, view?: TView | null): void;
  urlFor(mapName: string, view?: TView | null): URL;
}

export function createQuakeRouteFlow<TView>(
  options: QuakeRouteFlowOptions<TView>,
): QuakeRouteFlow<TView> {
  let navigationGeneration = 0;

  function routeFromLocation(): QuakeUrlRoute {
    return parseQuakeUrlRouteFromLocation(window.location, {
      compactMultiplayerInviteMapName: options.compactMultiplayerInviteMapName,
      mapExists: options.mapExists,
      startMap: options.startMap(),
    });
  }

  function updateUrl(mapName: string, mode: QuakeUrlUpdateMode, view: TView | null = null): void {
    if (mode === "none") return;
    const url = urlFor(mapName, view);
    const state = { cssQuake: true, mapName, view };
    if (url.href === window.location.href) {
      window.history.replaceState(state, "", url);
      return;
    }
    if (mode === "replace") {
      window.history.replaceState(state, "", url);
    } else {
      window.history.pushState(state, "", url);
    }
  }

  function clearGameRoute(): void {
    const url = new URL(window.location.href);
    const hadGameRoute = url.searchParams.has("map") || url.searchParams.has("view") || url.searchParams.has("room");
    url.searchParams.delete("map");
    url.searchParams.delete("view");
    url.searchParams.delete("room");
    if (!hadGameRoute && url.href === window.location.href) return;
    window.history.replaceState({ cssQuake: true, mapName: null, view: null }, "", url);
  }

  function clearDebugUrlParams(): void {
    const url = new URL(window.location.href);
    const hadDebugParams = url.searchParams.has("debugPolys");
    if (!hadDebugParams) return;
    url.searchParams.delete("debugPolys");
    window.history.replaceState(
      { cssQuake: true, mapName: options.currentMapName(), view: quakeUrlView(url.searchParams) },
      "",
      url,
    );
  }

  function urlFor(mapName: string, view: TView | null = null): URL {
    return quakeUrlForMapView(window.location.href, mapName, view ? options.viewToUrlView(view) : null);
  }

  function currentViewUrl(): string {
    return urlFor(options.currentMapName(), options.currentView()).href;
  }

  function routeView(route: QuakeUrlRoute): TView | null {
    return route.view ? options.viewFromUrlView(route.view) : null;
  }

  function mapLoadView(loadOptions: QuakeMapLoadOptions): TView | null {
    return loadOptions.view ? options.viewFromUrlView(loadOptions.view) : null;
  }

  function syncPresentation(route: QuakeUrlRoute, syncOptions: { preferMenu?: boolean } = {}): void {
    options.clearStartupState();
    if (options.menuEnabled && (syncOptions.preferMenu || !quakeUrlRouteIsDirect(route))) {
      options.showMainMenu();
    } else {
      options.setGameplayStarted(true);
      options.hideMainMenu();
    }
  }

  function handlePopState(): void {
    if (options.isDisposed() || !options.canLoadMap()) return;
    ++navigationGeneration;
    const route = routeFromLocation();
    if (!options.isLoading() && options.currentMapName() === route.mapName && options.hasCurrentScene()) {
      const currentRouteView = routeView(route);
      if (currentRouteView) {
        options.applyView(currentRouteView);
        syncPresentation(route);
        return;
      }
      if (route.mapParamPresent) {
        navigateToRoute(route);
        return;
      }
      syncPresentation(route);
      return;
    }
    navigateToRoute(route);
  }

  function navigateToRoute(route: QuakeUrlRoute): void {
    const generation = navigationGeneration;
    const isCurrent = () => !options.isDisposed() && generation === navigationGeneration;
    void options.loadMap(route.mapName, { urlMode: "none", view: route.view })
      .then((loaded) => {
        if (loaded && isCurrent() && !options.isLoading() && options.currentMapName() === route.mapName) {
          syncPresentation(route);
        }
      })
      .catch((error) => {
        if (!isCurrent()) return;
        console.error(error);
        if (error instanceof QuakeAssetsRegeneratingError) {
          options.setAssetsRegenerating(error.message);
        } else {
          options.setLoadingError(error);
        }
      });
  }

  return {
    clearDebugUrlParams,
    clearGameRoute,
    currentViewUrl,
    handlePopState,
    mapLoadView,
    routeFromLocation,
    routeView,
    syncPresentation,
    updateUrl,
    urlFor,
  };
}
