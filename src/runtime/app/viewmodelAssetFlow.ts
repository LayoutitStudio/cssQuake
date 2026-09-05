import { QUAKE_PLAYER_WEAPON_FIRE_FACTS } from "../../generated/quakeProgramFacts";
import type { QuakeWeaponId } from "../hud";
import type { QuakeLoadingProgressTracker } from "../loadingConsole";
import type { QuakeViewmodelController, QuakeViewmodelModel } from "../viewmodel";
import type { QuakeAssetManifest } from "./session";

const QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH = "progs/v_shot.mdl";

export interface QuakeViewmodelAssetFlowOptions {
  activeWeapon(): QuakeWeaponId | null;
  assetManifest(): QuakeAssetManifest;
  isDisposed(): boolean;
  trace(kind: string, details?: Record<string, unknown>): void;
  viewmodel: QuakeViewmodelController;
}

export interface QuakeViewmodelAssetFlow {
  clearMountedState(): void;
  mount(modelPromise?: Promise<QuakeViewmodelModel>, isCurrent?: () => boolean): Promise<void>;
  preload(progress?: QuakeLoadingProgressTracker, modelPath?: string): Promise<QuakeViewmodelModel>;
  syncActiveWeaponViewModel(): void;
}

export function createQuakeViewmodelAssetFlow(options: QuakeViewmodelAssetFlowOptions): QuakeViewmodelAssetFlow {
  const modelPromises = new Map<string, Promise<QuakeViewmodelModel>>();
  let mountedModelPath: string | null = null;
  let pendingModelPath: string | null = null;

  function clearMountedState(): void {
    mountedModelPath = null;
    pendingModelPath = null;
  }

  function preload(
    progress?: QuakeLoadingProgressTracker,
    modelPath = QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH,
  ): Promise<QuakeViewmodelModel> {
    const normalizedPath = normalizeViewModelPath(modelPath) ?? QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH;
    let promise = modelPromises.get(normalizedPath);
    if (!promise) {
      promise = fetchViewModel(normalizedPath, progress).catch((error: unknown) => {
        modelPromises.delete(normalizedPath);
        throw error;
      });
      modelPromises.set(normalizedPath, promise);
    }
    return promise;
  }

  async function fetchViewModel(
    modelPath = QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH,
    progress?: QuakeLoadingProgressTracker,
  ): Promise<QuakeViewmodelModel> {
    const completeWeaponTask = progress?.startTask("Weapon model");
    const url = viewModelUrl(modelPath);
    if (!url) throw new Error(`No prepared Quake weapon viewmodel registered for ${modelPath}.`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}.`);
    const model = await response.json() as QuakeViewmodelModel;
    const modelSource = normalizeViewModelPath(model.source);
    if (modelSource && modelSource !== modelPath) {
      throw new Error(`Prepared Quake weapon viewmodel ${url} is ${model.source}, expected ${modelPath}.`);
    }
    completeWeaponTask?.();
    return model;
  }

  async function mount(modelPromise = preload(), isCurrent: () => boolean = () => true): Promise<void> {
    const model = await modelPromise;
    if (options.isDisposed() || !isCurrent()) return;
    mountModel(model);
    syncActiveWeaponViewModel();
  }

  function mountModel(model: QuakeViewmodelModel): void {
    mountedModelPath = normalizeViewModelPath(model.source);
    options.viewmodel.mount(model);
  }

  function syncActiveWeaponViewModel(): void {
    const activeWeapon = options.activeWeapon();
    if (!activeWeapon || !options.viewmodel.hasWeapon()) return;
    const modelPath = activeWeaponViewModelPath(activeWeapon);
    if (!modelPath || modelPath === mountedModelPath || modelPath === pendingModelPath) return;
    if (!viewModelUrl(modelPath)) return;
    pendingModelPath = modelPath;
    options.trace("viewmodel-switch-request", {
      from: mountedModelPath,
      to: modelPath,
      weapon: activeWeapon,
    });
    void preload(undefined, modelPath)
      .then((model) => {
        if (options.isDisposed() || pendingModelPath !== modelPath) return;
        pendingModelPath = null;
        const activeWeapon = options.activeWeapon();
        if (!activeWeapon || activeWeaponViewModelPath(activeWeapon) !== modelPath) {
          syncActiveWeaponViewModel();
          return;
        }
        mountModel(model);
        options.trace("viewmodel-switch-complete", {
          source: mountedModelPath,
          weapon: activeWeapon,
        });
      })
      .catch((error: unknown) => {
        if (pendingModelPath === modelPath) pendingModelPath = null;
        console.warn(error);
      });
  }

  function activeWeaponViewModelPath(weapon: QuakeWeaponId): string | null {
    return normalizeViewModelPath(
      QUAKE_PLAYER_WEAPON_FIRE_FACTS.profiles[weapon]?.presentation?.viewModelPath ??
        QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH,
    );
  }

  function viewModelUrl(modelPath: string): string | null {
    const normalizedPath = normalizeViewModelPath(modelPath);
    if (!normalizedPath) return null;
    const assetManifest = options.assetManifest();
    return assetManifest.assets.weaponModelUrls?.[normalizedPath] ??
      (normalizedPath === QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH ? assetManifest.assets.weaponModelUrl : null);
  }

  return {
    clearMountedState,
    mount,
    preload,
    syncActiveWeaponViewModel,
  };
}

function normalizeViewModelPath(modelPath: string | undefined): string | null {
  const normalizedPath = modelPath?.trim().toLowerCase() ?? "";
  return normalizedPath ? normalizedPath : null;
}
