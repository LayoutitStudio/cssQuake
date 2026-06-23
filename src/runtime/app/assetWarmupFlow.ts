import type { QuakeEntity, QuakePreparedRenderBundle, QuakeScene } from "../../types/quake";
import { shouldSpawnQuakeEntityForCurrentGame } from "../entities";
import { markQuakeTrace } from "../debug/traceMarks";
import {
  quakeLoadingProgressGroup,
  type QuakeLoadingProgressTracker,
} from "../loadingConsole";
import {
  quakePickupModelPath,
  quakePickupModelRenderBundleFrameSet,
  type QuakePickupModelLibrary,
  type QuakeProgramMetadata,
} from "../pickups";
import { preloadQuakeRenderBundleAssets } from "../renderBundleMesh";
import { quakeShootableModelPath } from "../shootables";
import type { QuakeAssetManifest } from "./session";

export interface QuakeAssetWarmupFlowOptions {
  assetManifest(): QuakeAssetManifest;
  isDisposed(): boolean;
  onPickupModelLibrary(library: QuakePickupModelLibrary): void;
  onProgramMetadata(metadata: QuakeProgramMetadata): void;
  shouldSpawnPickup?(entity: QuakeEntity): boolean;
  shouldSpawnShootable?(entity: QuakeEntity): boolean;
}

export interface QuakeAssetWarmupFlow {
  loadPickupModels(progress?: QuakeLoadingProgressTracker): Promise<void>;
  loadProgramMetadata(progress?: QuakeLoadingProgressTracker): Promise<void>;
  modelLibrary(): QuakePickupModelLibrary | null;
  preloadMapModelAssets(mapName: string, progress?: QuakeLoadingProgressTracker): Promise<void>;
  preloadSceneModelAssets(scene: QuakeScene, progress?: QuakeLoadingProgressTracker): Promise<void>;
  programMetadata(): QuakeProgramMetadata | null;
}

export function createQuakeAssetWarmupFlow(options: QuakeAssetWarmupFlowOptions): QuakeAssetWarmupFlow {
  let currentModelLibrary: QuakePickupModelLibrary | null = null;
  let currentProgramMetadata: QuakeProgramMetadata | null = null;

  function modelLibrary(): QuakePickupModelLibrary | null {
    return currentModelLibrary;
  }

  function programMetadata(): QuakeProgramMetadata | null {
    return currentProgramMetadata;
  }

  async function loadPickupModels(progress?: QuakeLoadingProgressTracker): Promise<void> {
    const completePickupTask = progress?.startTask("Pickup definitions");
    const url = options.assetManifest().assets.pickupModelsUrl;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}.`);
    const library = await response.json() as QuakePickupModelLibrary;
    if (options.isDisposed()) return;
    currentModelLibrary = library;
    options.onPickupModelLibrary(library);
    completePickupTask?.();
  }

  async function loadProgramMetadata(progress?: QuakeLoadingProgressTracker): Promise<void> {
    const completeMetadataTask = progress?.startTask("Game logic");
    const url = options.assetManifest().assets.programMetadataUrl;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}.`);
    const metadata = await response.json() as QuakeProgramMetadata;
    if (options.isDisposed()) return;
    currentProgramMetadata = metadata;
    options.onProgramMetadata(metadata);
    completeMetadataTask?.();
  }

  async function preloadMapModelAssets(
    mapName: string,
    progress?: QuakeLoadingProgressTracker,
  ): Promise<void> {
    const library = currentModelLibrary;
    if (!library) return;
    const map = options.assetManifest().maps.find((item) => item.mapName === mapName);
    const modelPaths = map?.modelPaths;
    if (!modelPaths) return;
    await preloadPickupModelRenderBundleAssets(
      library,
      modelPaths,
      quakeLoadingProgressGroup(progress, "Map model assets"),
    );
  }

  async function preloadSceneModelAssets(
    scene: QuakeScene,
    progress?: QuakeLoadingProgressTracker,
  ): Promise<void> {
    const library = currentModelLibrary;
    if (!library) return;
    const pickupModelPaths = new Set<string>();
    const monsterModelPaths = new Set<string>();
    const runtime = scene.entityManifest.runtime;
    const entitiesByIndex = new Map(scene.entities.map((entity) => [entity.index, entity]));
    const pickupEntities = sceneEntitiesForIndexes(entitiesByIndex, runtime.pickupEntityIndexes);
    for (const entity of pickupEntities) {
      if (!shouldSpawnPickup(entity)) continue;
      const modelPath = quakePickupModelPath(entity, currentProgramMetadata, scene.gameLogic);
      if (modelPath) pickupModelPaths.add(modelPath);
    }
    const shootableEntities = sceneEntitiesForIndexes(entitiesByIndex, runtime.shootableEntityIndexes);
    for (const entity of shootableEntities) {
      if (!shouldSpawnShootable(entity)) continue;
      const modelPath = quakeShootableModelPath(entity, currentProgramMetadata);
      if (modelPath) monsterModelPaths.add(modelPath);
    }
    await Promise.all([
      preloadOptionalModelRenderBundleAssets(
        "pickup",
        library,
        pickupModelPaths,
        quakeLoadingProgressGroup(progress, "Pickup models"),
      ),
      preloadOptionalModelRenderBundleAssets(
        "monster",
        library,
        monsterModelPaths,
        quakeLoadingProgressGroup(progress, "Monster models"),
      ),
    ]);
  }

  function shouldSpawnPickup(entity: QuakeEntity): boolean {
    return options.shouldSpawnPickup?.(entity) ?? shouldSpawnQuakeEntityForCurrentGame(entity);
  }

  function shouldSpawnShootable(entity: QuakeEntity): boolean {
    return options.shouldSpawnShootable?.(entity) ?? shouldSpawnQuakeEntityForCurrentGame(entity);
  }

  return {
    loadPickupModels,
    loadProgramMetadata,
    modelLibrary,
    preloadMapModelAssets,
    preloadSceneModelAssets,
    programMetadata,
  };
}

function sceneEntitiesForIndexes(
  entitiesByIndex: ReadonlyMap<number, QuakeEntity>,
  indexes: readonly number[],
): QuakeEntity[] {
  const out: QuakeEntity[] = [];
  const seen = new Set<number>();
  for (const index of indexes) {
    if (seen.has(index)) continue;
    seen.add(index);
    const entity = entitiesByIndex.get(index);
    if (entity) out.push(entity);
  }
  return out;
}

async function preloadPickupModelRenderBundleAssets(
  library: QuakePickupModelLibrary,
  modelPaths: Iterable<string>,
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  const bundles = new Set<QuakePreparedRenderBundle>();
  for (const modelPath of modelPaths) {
    const model = library.models[modelPath];
    if (!model) continue;
    if (model.renderBundle) bundles.add(model.renderBundle);
    const frameSet = quakePickupModelRenderBundleFrameSet(model);
    if (frameSet) {
      bundles.add(frameSet.renderBundle);
    }
    for (const frame of model.animationFrames ?? []) bundles.add(frame.renderBundle);
  }
  await Promise.all([...bundles].map((renderBundle) => preloadQuakeRenderBundleAssets(renderBundle, progress)));
}

async function preloadOptionalModelRenderBundleAssets(
  kind: "monster" | "pickup",
  library: QuakePickupModelLibrary,
  modelPaths: Iterable<string>,
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  try {
    await preloadPickupModelRenderBundleAssets(library, modelPaths, progress);
  } catch (error) {
    markQuakeTrace("asset-warmup-skip", {
      kind,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
