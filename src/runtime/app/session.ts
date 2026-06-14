import { createQuakeSceneFromPreparedScene } from "../../prepare/scene";
import type { QuakePreparedScene, QuakeScene } from "../../types/quake";
import {
  QUAKE_ASSETS_REGENERATING_ACTION,
  quakeLoadingProgressGroup,
  type QuakeLoadingProgressTracker,
} from "../loadingConsole";
import { preloadQuakeRenderBundleAssets } from "../renderBundleMesh";
import type { QuakeUrlUpdateMode, QuakeUrlView } from "../routeState";

export const QUAKE_ASSET_ROOT = "/q";
export const QUAKE_MANIFEST_URL = `${QUAKE_ASSET_ROOT}/manifest.json`;

export interface QuakeAssetManifestMap {
  mapName: string;
  title?: string;
  pakPath?: string;
  sceneUrl: string;
  selectable?: boolean;
  modelPaths?: string[];
}

export interface QuakeAssetManifest {
  version: number;
  assetRoot?: string;
  startMap: string;
  maps: QuakeAssetManifestMap[];
  assets: {
    weaponModelUrl: string;
    weaponModelUrls?: Record<string, string>;
    pickupModelsUrl: string;
    programMetadataUrl: string;
    soundManifestUrl?: string;
  };
}

export interface QuakeMapLoadOptions {
  loadingStatus?: string;
  preserveLoadingConsole?: boolean;
  urlMode?: QuakeUrlUpdateMode;
  resumeGameplay?: boolean;
  view?: QuakeUrlView | null;
}

export interface QuakeAppMapLoader<TView> {
  loadMap(mapName: string, options?: QuakeMapLoadOptions): Promise<void>;
}

export interface QuakeAppMapLoaderOptions<TView, TWeapon = unknown> {
  completeSceneReadiness(weaponPromise: Promise<TWeapon>, progress: QuakeLoadingProgressTracker): Promise<void>;
  createProgressTracker(status: string): QuakeLoadingProgressTracker;
  fetchScene(url: string, mapName: string, progress: QuakeLoadingProgressTracker): Promise<QuakeScene>;
  isDisposed(): boolean;
  mapLoadView(options: QuakeMapLoadOptions): TView | null;
  mountScene(scene: QuakeScene): void;
  onCurrentMapChange(mapName: string): void;
  preloadMapAssets(mapName: string, progress: QuakeLoadingProgressTracker): Promise<void>;
  preloadSceneAssets(scene: QuakeScene, progress: QuakeLoadingProgressTracker): Promise<void>;
  preloadWeapon(progress: QuakeLoadingProgressTracker): Promise<TWeapon>;
  resumeGameplayAfterMapLoad(): void;
  sceneUrl(mapName: string): string | undefined;
  setGameplayStarted(started: boolean): void;
  setLoading(active: boolean, status?: string, options?: { preserveConsole?: boolean }): void;
  syncUrlView(view: TView): void;
  updateUrl(mapName: string, mode: QuakeUrlUpdateMode, view: TView | null): void;
}

export class QuakeAssetsRegeneratingError extends Error {
  constructor(message = QUAKE_ASSETS_REGENERATING_ACTION) {
    super(message);
    this.name = "QuakeAssetsRegeneratingError";
  }
}

export const FALLBACK_QUAKE_ASSET_MANIFEST: QuakeAssetManifest = {
  version: 1,
  assetRoot: QUAKE_ASSET_ROOT,
  startMap: "e1m1",
  maps: [
    {
      mapName: "start",
      title: "Introduction",
      pakPath: "maps/start.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/start.json`,
      selectable: false,
    },
    {
      mapName: "e1m1",
      title: "the Slipgate Complex",
      pakPath: "maps/e1m1.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m1.json`,
      selectable: true,
    },
    {
      mapName: "e1m2",
      title: "Castle of the Damned",
      pakPath: "maps/e1m2.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m2.json`,
      selectable: true,
    },
    {
      mapName: "e1m3",
      title: "the Necropolis",
      pakPath: "maps/e1m3.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m3.json`,
      selectable: true,
    },
    {
      mapName: "e1m4",
      title: "the Grisly Grotto",
      pakPath: "maps/e1m4.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m4.json`,
      selectable: true,
    },
    {
      mapName: "e1m5",
      title: "Gloom Keep",
      pakPath: "maps/e1m5.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m5.json`,
      selectable: true,
    },
    {
      mapName: "e1m6",
      title: "The Door To Chthon",
      pakPath: "maps/e1m6.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m6.json`,
      selectable: true,
    },
    {
      mapName: "e1m7",
      title: "The House of Chthon",
      pakPath: "maps/e1m7.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m7.json`,
      selectable: true,
    },
    {
      mapName: "e1m8",
      title: "Ziggurat Vertigo",
      pakPath: "maps/e1m8.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m8.json`,
      selectable: true,
    },
  ],
  assets: {
    weaponModelUrl: `${QUAKE_ASSET_ROOT}/weapon.json`,
    weaponModelUrls: {
      "progs/v_shot.mdl": `${QUAKE_ASSET_ROOT}/weapon.json`,
    },
    pickupModelsUrl: `${QUAKE_ASSET_ROOT}/pickups.json`,
    programMetadataUrl: `${QUAKE_ASSET_ROOT}/progs.json`,
    soundManifestUrl: `${QUAKE_ASSET_ROOT}/sounds.json`,
  },
};

export function quakeAssetManifestSelectableLevels(manifest: QuakeAssetManifest): QuakeAssetManifestMap[] {
  return manifest.maps.filter((level) => level.selectable !== false);
}

export function quakeAssetManifestMapTitle(level: QuakeAssetManifestMap): string {
  return level.title?.trim() || level.mapName.toUpperCase();
}

export function quakeAssetManifestSceneUrlMap(manifest: QuakeAssetManifest): Map<string, string> {
  return new Map(manifest.maps.map((map) => [map.mapName, map.sceneUrl]));
}

export async function fetchQuakeAssetManifest(): Promise<QuakeAssetManifest> {
  const response = await fetch(QUAKE_MANIFEST_URL, { cache: "no-store" });
  if (response.status === 404) return FALLBACK_QUAKE_ASSET_MANIFEST;
  if (!response.ok) throw new Error(`Could not load ${QUAKE_MANIFEST_URL}.`);
  let rawManifest: unknown;
  try {
    rawManifest = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new QuakeAssetsRegeneratingError();
    throw error;
  }
  if (isQuakeAssetManifestRegenerating(rawManifest)) {
    const message = typeof rawManifest.message === "string"
      ? rawManifest.message
      : QUAKE_ASSETS_REGENERATING_ACTION;
    throw new QuakeAssetsRegeneratingError(message);
  }
  return normalizeQuakeAssetManifest(rawManifest);
}

export async function fetchQuakeScene(
  url: string,
  mapName?: string,
  progress?: QuakeLoadingProgressTracker,
): Promise<QuakeScene> {
  const worldStatus = mapName ? `World ${mapName.toLowerCase()}.bsp` : "World BSP";
  const worldProgress = quakeLoadingProgressGroup(progress, worldStatus);
  const completeSceneTask = progress?.startTask(worldStatus);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const prepared = await response.json() as QuakePreparedScene;
  if (mapName && !prepared.renderBundle) {
    throw new Error(`Prepared Quake map ${mapName.toUpperCase()} is missing its render bundle.`);
  }
  const renderBundlePreloads = [
    ...(prepared.renderBundle
      ? [preloadQuakeRenderBundleAssets(prepared.renderBundle, worldProgress, { preloadImages: false })]
      : []),
    ...(prepared.lightstyleRenderBundle
      ? [preloadQuakeRenderBundleAssets(prepared.lightstyleRenderBundle, worldProgress, { preloadImages: false })]
      : []),
  ];
  completeSceneTask?.();
  await Promise.all(renderBundlePreloads);
  return createQuakeSceneFromPreparedScene(prepared);
}

export function createQuakeAppMapLoader<TView, TWeapon = unknown>(
  options: QuakeAppMapLoaderOptions<TView, TWeapon>,
): QuakeAppMapLoader<TView> {
  return {
    async loadMap(mapName: string, loadOptions: QuakeMapLoadOptions = {}): Promise<void> {
      const nextMapName = mapName.trim().toLowerCase();
      const url = options.sceneUrl(nextMapName);
      if (!url) throw new Error(`No prepared Quake map registered for ${nextMapName}.`);
      const loadingStatus = loadOptions.loadingStatus ?? `World ${nextMapName}.bsp`;
      const progress = options.createProgressTracker(loadingStatus);
      options.setLoading(true, loadingStatus, { preserveConsole: loadOptions.preserveLoadingConsole });
      try {
        const scenePromise = options.fetchScene(url, nextMapName, progress);
        const weaponPromise = options.preloadWeapon(progress);
        const scene = await scenePromise;
        if (options.isDisposed()) return;
        await options.preloadSceneAssets(scene, progress);
        await options.preloadMapAssets(nextMapName, progress);
        if (options.isDisposed()) return;
        options.onCurrentMapChange(nextMapName);
        options.mountScene(scene);
        const routeView = options.mapLoadView(loadOptions);
        if (routeView) options.syncUrlView(routeView);
        options.updateUrl(nextMapName, loadOptions.urlMode ?? "push", routeView);
        if (options.isDisposed()) return;
        await options.completeSceneReadiness(weaponPromise, progress);
        if (options.isDisposed()) return;
        if (loadOptions.resumeGameplay) options.resumeGameplayAfterMapLoad();
        options.setGameplayStarted(true);
      } catch (error) {
        if (!options.isDisposed()) options.setLoading(false);
        throw error;
      }
    },
  };
}

function normalizeQuakeAssetManifest(value: unknown): QuakeAssetManifest {
  if (!isRecord(value)) throw new Error("Invalid Quake asset manifest.");
  const rawMaps = Array.isArray(value.maps) ? value.maps : [];
  const maps = rawMaps.map(normalizeQuakeAssetManifestMap).filter((map): map is QuakeAssetManifestMap => Boolean(map));
  if (!maps.length) throw new Error("Quake asset manifest has no maps.");
  const mapNames = new Set(maps.map((map) => map.mapName));
  const requestedStartMap = typeof value.startMap === "string" ? value.startMap.trim().toLowerCase() : "";
  const startMap = mapNames.has(requestedStartMap)
    ? requestedStartMap
    : mapNames.has(FALLBACK_QUAKE_ASSET_MANIFEST.startMap)
      ? FALLBACK_QUAKE_ASSET_MANIFEST.startMap
      : maps[0].mapName;
  return {
    version: typeof value.version === "number" ? value.version : 1,
    ...(typeof value.assetRoot === "string" ? { assetRoot: value.assetRoot } : {}),
    startMap,
    maps,
    assets: normalizeQuakeAssetManifestAssets(value.assets),
  };
}

function isQuakeAssetManifestRegenerating(value: unknown): value is { message?: unknown; status: string } {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  const status = value.status.trim().toLowerCase();
  return status === "regenerating" || status === "generating";
}

function normalizeQuakeAssetManifestMap(value: unknown): QuakeAssetManifestMap | null {
  if (!isRecord(value) || typeof value.mapName !== "string" || typeof value.sceneUrl !== "string") return null;
  const mapName = value.mapName.trim().toLowerCase();
  const sceneUrl = value.sceneUrl.trim();
  if (!mapName || !sceneUrl) return null;
  return {
    mapName,
    sceneUrl,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.pakPath === "string" ? { pakPath: value.pakPath } : {}),
    ...(typeof value.selectable === "boolean" ? { selectable: value.selectable } : {}),
    ...(Array.isArray(value.modelPaths) ? {
      modelPaths: value.modelPaths
        .filter((modelPath): modelPath is string => typeof modelPath === "string")
        .map((modelPath) => modelPath.trim().toLowerCase())
        .filter(Boolean),
    } : {}),
  };
}

function normalizeQuakeAssetManifestAssets(value: unknown): QuakeAssetManifest["assets"] {
  const fallback = FALLBACK_QUAKE_ASSET_MANIFEST.assets;
  if (!isRecord(value)) return fallback;
  const weaponModelUrl = typeof value.weaponModelUrl === "string" ? value.weaponModelUrl : fallback.weaponModelUrl;
  const weaponModelUrls: Record<string, string> = {
    ...(fallback.weaponModelUrls ?? {}),
    "progs/v_shot.mdl": weaponModelUrl,
  };
  if (isRecord(value.weaponModelUrls)) {
    for (const [modelPath, modelUrl] of Object.entries(value.weaponModelUrls)) {
      const normalizedModelPath = modelPath.trim().toLowerCase();
      if (!normalizedModelPath || typeof modelUrl !== "string") continue;
      const normalizedModelUrl = modelUrl.trim();
      if (normalizedModelUrl) weaponModelUrls[normalizedModelPath] = normalizedModelUrl;
    }
  }
  return {
    weaponModelUrl,
    weaponModelUrls,
    pickupModelsUrl: typeof value.pickupModelsUrl === "string" ? value.pickupModelsUrl : fallback.pickupModelsUrl,
    programMetadataUrl: typeof value.programMetadataUrl === "string" ? value.programMetadataUrl : fallback.programMetadataUrl,
    soundManifestUrl: typeof value.soundManifestUrl === "string" ? value.soundManifestUrl : fallback.soundManifestUrl,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
