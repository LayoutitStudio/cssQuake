import type {
  ParseResult,
  Polygon,
  PolyMeshHandle,
  PolySceneHandle,
  Vec3,
} from "@layoutit/polycss";

import type { QuakeEntity } from "../../types/quake";
import { isQuakeDebugDomMetadataEnabled } from "../debug/traceMarks";
import { quakeEntityNumber } from "../entities";
import { quakeAliasModelRenderYaw, normalizeQuakeRenderYaw } from "../aliasModelOrientation";
import {
  quakePickupModelRenderBundle,
  quakePickupModelRenderBundleFrameSet,
  quakePickupPolygons,
  type QuakePickupModel,
} from "../pickups";
import {
  mountQuakeRenderBundleFrameSetMesh,
  mountQuakeRenderBundleMesh,
  stripPolyMeshMetadata,
  type QuakeRenderBundleFrameSetMountOptions,
} from "../renderBundleMesh";
import { quakeShootableFallbackPolygons } from "../shootables";

export interface QuakeEntityMeshMountFlowOptions {
  pixelate(handle?: PolyMeshHandle | null): void;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  scene: Pick<PolySceneHandle, "add">;
  sceneElement: HTMLElement;
  schedulePresentationResync(handle?: PolyMeshHandle | null): Promise<void>;
}

export interface QuakeEntityMeshMountFlow {
  addPickupMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex?: number): PolyMeshHandle | null;
  addShootableMesh(
    entity: QuakeEntity,
    model?: QuakePickupModel,
    frameIndex?: number,
    options?: QuakeEntityShootableMeshMountOptions,
  ): PolyMeshHandle | null;
}

export interface QuakeEntityShootableMeshMountOptions {
  frameSetMountOptions?: QuakeRenderBundleFrameSetMountOptions;
}

export function createQuakeEntityMeshMountFlow(
  options: QuakeEntityMeshMountFlowOptions,
): QuakeEntityMeshMountFlow {
  function addPickupMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex = 0): PolyMeshHandle | null {
    if (!entity.origin) return null;
    const handle = mountEntityModelMesh(options.sceneElement, model, frameIndex)
      ?? addProceduralPickupMesh(entity);
    if (!handle) return null;
    handle.element.classList.add("pickup");
    stripPolyMeshMetadata(handle.element);
    keepPickupBackfacesVisible(handle.element);
    if (isQuakeDebugDomMetadataEnabled()) {
      handle.element.dataset.entityIndex = String(entity.index);
      handle.element.dataset.classname = entity.classname;
    }
    const angle = entity.angle ?? quakeEntityNumber(entity, "angle", 0);
    handle.setTransform({
      position: options.pointToPoly(entity.origin),
      rotation: [0, 0, model ? quakeAliasModelRenderYaw(angle) : normalizeQuakeRenderYaw(angle)],
      scale: 1,
    });
    if (!model) {
      options.pixelate(handle);
      void options.schedulePresentationResync(handle);
    }
    return handle;
  }

  function addShootableMesh(
    entity: QuakeEntity,
    model?: QuakePickupModel,
    frameIndex = 0,
    mountOptions: QuakeEntityShootableMeshMountOptions = {},
  ): PolyMeshHandle | null {
    const handle = mountEntityModelMesh(options.sceneElement, model, frameIndex, mountOptions.frameSetMountOptions)
      ?? addProceduralShootableMesh(entity);
    if (!handle) return null;
    stripPolyMeshMetadata(handle.element);
    return handle;
  }

  function addProceduralShootableMesh(entity: QuakeEntity): PolyMeshHandle | null {
    const polygons = quakeShootableFallbackPolygons(entity);
    if (!polygons.length) return null;
    return options.scene.add(makeParseResult(polygons), {
      merge: false,
      meshResolution: "lossless",
      excludeFromAutoCenter: true,
    });
  }

  function addProceduralPickupMesh(entity: QuakeEntity): PolyMeshHandle | null {
    const polygons = quakePickupPolygons(entity);
    if (!polygons.length) return null;
    return options.scene.add(makeParseResult(polygons), {
      merge: false,
      meshResolution: "lossless",
      excludeFromAutoCenter: true,
    });
  }

  return {
    addPickupMesh,
    addShootableMesh,
  };
}

function mountEntityModelMesh(
  sceneElement: HTMLElement,
  model: QuakePickupModel | undefined,
  frameIndex: number,
  frameSetMountOptions?: QuakeRenderBundleFrameSetMountOptions,
): PolyMeshHandle | null {
  if (!model) return null;
  const frameSet = quakePickupModelRenderBundleFrameSet(model);
  return frameSet
    ? mountQuakeRenderBundleFrameSetMesh(sceneElement, frameSet, frameIndex, frameSetMountOptions)
    : mountQuakeRenderBundleMesh(sceneElement, quakePickupModelRenderBundle(model, frameIndex));
}

function keepPickupBackfacesVisible(element: HTMLElement): void {
  for (const leaf of element.querySelectorAll<HTMLElement>("b,i,s,u")) {
    leaf.style.backfaceVisibility = "visible";
  }
}

function makeParseResult(polygons: Polygon[]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => undefined };
}
