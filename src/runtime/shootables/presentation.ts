import type { PolyMeshHandle, Vec3 } from "@layoutit/polycss";
import type { QuakeEntity } from "../../types/quake";
import { quakeAliasModelRenderYaw, normalizeQuakeRenderYaw } from "../aliasModelOrientation";
import { COLLISION_EPSILON } from "../constants";
import { isQuakeDebugDomMetadataEnabled, markQuakeTrace } from "../debug/traceMarks";
import { quakeEntityNumber } from "../entities";
import type { QuakePickupModel } from "../pickups";
import {
  isQuakeRenderBundleFrameSetHandle,
  markQuakeRenderBundleFrameSetHandleMotionMaterial,
  setQuakeRenderBundleFrameSetHandleFrame,
  stripPolyMeshMetadata,
  type QuakeRenderBundleFrameSetMotionMaterialOptions,
  type QuakeRenderBundleFrameSetMountOptions,
} from "../renderBundleMesh";
import { quakeMonsterUsesEnemyRuntime } from "./bounds";
import type { QuakeShootableState, QuakeEnemyTargetReference } from "./state";

type Shootable = Readonly<QuakeShootableState>;
type TraceDetails = Record<string, boolean | number | string | null | undefined>;
interface RenderRecord {
  handle: PolyMeshHandle | null;
  frameHandles: Map<number, PolyMeshHandle>;
  visible: boolean;
}
type FrameBackend = "frameset" | "pool" | "replace";
interface TransformSnapshot { x: number; y: number; z: number; yaw: number; scale: number }
interface Lifecycle { deathAnimating: boolean; persistentCorpse: boolean }
interface HandleChanges {
  totalMeshHandlesCreated?: number;
  totalMeshHandlesRemoved?: number;
  totalFrameHandlesCreated?: number;
  totalFrameHandlesRemoved?: number;
}
export interface QuakeShootablePresentationOptions {
  addMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex?: number,
    options?: { frameSetMountOptions?: QuakeRenderBundleFrameSetMountOptions }): PolyMeshHandle | null;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  pixelate(handle: PolyMeshHandle): void;
  schedulePresentationResync(handle: PolyMeshHandle): void;
  enemyMotionMaterial?: QuakeRenderBundleFrameSetMotionMaterialOptions | null;
  lifecycle(shootable: Shootable): Lifecycle;
  nextFrameIndex(shootable: Shootable): number | undefined;
  markTrace(kind: string, shootable: Shootable, details?: TraceDetails): void;
  onHandlesChanged(changes: HandleChanges): void;
}

const QUAKE_SHOOTABLE_ANIMATION_FRAME_POOL_SIZE = 3;
const QUAKE_SHOOTABLE_TRANSFORM_EPSILON = COLLISION_EPSILON;

/** Owns mesh lifetime and publication. Simulation state never contains a mesh or frame pool. */
export function createQuakeShootablePresentation(options: QuakeShootablePresentationOptions) {
  const { addMesh, pointToPoly, pixelate, schedulePresentationResync, enemyMotionMaterial,
    markTrace: markShootableTrace, lifecycle: shootableLifecycleClassState,
    nextFrameIndex: nextShootableAnimationFrameIndex } = options;
  const records = new WeakMap<Shootable, RenderRecord>();
  function stateFor(shootable: Shootable): RenderRecord {
    let state = records.get(shootable);
    if (!state) {
      state = { handle: null, frameHandles: new Map(), visible: false };
      records.set(shootable, state);
    }
    return state;
  }
  function hasHandle(shootable: Shootable): boolean { return records.get(shootable)?.handle != null; }
  function isVisible(shootable: Shootable): boolean { return records.get(shootable)?.visible ?? false; }
  function frameHandleCount(shootable: Shootable): number { return records.get(shootable)?.frameHandles.size ?? 0; }
  function hasFrame(shootable: Shootable, frame: number): boolean { return records.get(shootable)?.frameHandles.has(frame) ?? false; }
  function setVisible(shootable: Shootable, visible: boolean): void {
    const state = stateFor(shootable);
    state.visible = state.handle !== null && visible;
    syncShootableHandleVisibility(shootable);
  }
  function canUseShootableAnimationFrameSet(shootable: Shootable): boolean {
    return Boolean(shootable.enemy && shootable.model?.animationFrames?.length && shootable.model.animationFrameSet);
  }

  function ensureShootableAnimationFrameHandle(
    shootable: Shootable,
    frameIndex: number,
  ): PolyMeshHandle | null {
    const state = stateFor(shootable);
    const existing = state.frameHandles.get(frameIndex);
    if (existing) return existing;
    const handle = addShootableMesh(shootable.entity, shootable.model, frameIndex);
    if (!handle) return null;
    state.frameHandles.set(frameIndex, handle);
    options.onHandlesChanged({ totalFrameHandlesCreated: 1 });
    markShootableTrace("shootable-frame-handle-create", shootable, {
      requestedFrame: frameIndex,
      handles: countShootableHandles(shootable),
    });
    syncShootableTransformForHandle(shootable, handle);
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDataset(shootable, handle, frameIndex);
    return handle;
  }

  function setActiveShootableAnimationFrameHandle(
    shootable: Shootable,
    frameIndex: number,
    handle: PolyMeshHandle,
  ): void {
    const state = stateFor(shootable);
    state.frameHandles.delete(frameIndex);
    state.frameHandles.set(frameIndex, handle);
    state.handle = handle;
    syncShootableTransform(shootable);
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDatasets(shootable);
    trimShootableAnimationFrameHandles(shootable);
  }

  function syncShootableHandleVisibility(shootable: Shootable): void {
    syncQuakeShootableHandleVisibility(shootable, shootableLifecycleClassState(shootable));
  }

  function trimShootableAnimationFrameHandles(shootable: Shootable): void {
    const state = stateFor(shootable);
    if (state.frameHandles.size <= QUAKE_SHOOTABLE_ANIMATION_FRAME_POOL_SIZE) return;
    const keepFrameIndex = enemyAnimationFrameIndex(shootable);
    const nextFrameIndex = nextShootableAnimationFrameIndex(shootable);
    for (const [frameIndex, handle] of state.frameHandles) {
      if (state.frameHandles.size <= QUAKE_SHOOTABLE_ANIMATION_FRAME_POOL_SIZE) return;
      if (handle === state.handle || frameIndex === keepFrameIndex || frameIndex === nextFrameIndex) continue;
      handle.remove();
      options.onHandlesChanged({ totalMeshHandlesRemoved: 1 });
      options.onHandlesChanged({ totalFrameHandlesRemoved: 1 });
      state.frameHandles.delete(frameIndex);
    }
  }

  function forEachShootableHandle(shootable: Shootable, callback: (handle: PolyMeshHandle) => void): void {
    forEachQuakeShootableHandle(shootable, callback);
  }

  function countShootableHandles(shootable: Shootable): number {
    return countQuakeShootableHandles(shootable);
  }

  function removeShootableHandles(shootable: Shootable): void {
    const removed = removeQuakeShootableHandles(shootable);
    options.onHandlesChanged({ totalMeshHandlesRemoved: removed.handles });
    options.onHandlesChanged({ totalFrameHandlesRemoved: removed.frameHandles });
  }

  function addShootableMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex = 0): PolyMeshHandle | null {
    if (!entity.origin) return null;
    const usesEnemyRuntime = quakeMonsterUsesEnemyRuntime(entity);
    const handle = addMesh(
      entity,
      model,
      frameIndex,
      usesEnemyRuntime && enemyMotionMaterial
        ? { frameSetMountOptions: { motionMaterial: enemyMotionMaterial } }
        : undefined,
    );
    if (!handle) return null;
    options.onHandlesChanged({ totalMeshHandlesCreated: 1 });
    handle.element.classList.add("shootable");
    if (usesEnemyRuntime) handle.element.classList.add("enemy");
    stripPolyMeshMetadata(handle.element);
    if (isQuakeDebugDomMetadataEnabled()) {
      handle.element.dataset.entityIndex = String(entity.index);
      handle.element.dataset.classname = entity.classname;
    }
    markQuakeTrace("shootable-mesh-create", {
      entity: entity.index,
      class: entity.classname,
      enemy: usesEnemyRuntime,
      frame: frameIndex,
      leaves: handle.element.querySelectorAll("b,i,s,u").length,
      model: Boolean(model),
    });
    handle.setTransform({
      position: pointToPoly(entity.origin),
      rotation: [
        0,
        0,
        normalizeShootableYaw(entity.angle ?? quakeEntityNumber(entity, "angle", 0), Boolean(model)),
      ],
      scale: model?.renderScale ? 1 / model.renderScale : 1,
    });
    if (!model) {
      pixelate(handle);
      schedulePresentationResync(handle);
    }
    return handle;
  }

  function replaceShootableAnimationFrame(shootable: Shootable, frameIndex: number): void {
    const state = stateFor(shootable);
    const previousHandle = state.handle;
    if (!previousHandle) return;
    const nextHandle = addShootableMesh(shootable.entity, shootable.model, frameIndex);
    if (!nextHandle) return;
    previousHandle.remove();
    options.onHandlesChanged({ totalMeshHandlesRemoved: 1 });
    state.handle = nextHandle;
    syncShootableTransform(shootable);
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDatasets(shootable);
  }

  function syncShootableEnemyDatasets(shootable: Shootable): void {
    const state = stateFor(shootable);
    if (!isQuakeDebugDomMetadataEnabled()) return;
    for (const [frameIndex, handle] of state.frameHandles) {
      syncShootableEnemyDataset(shootable, handle, frameIndex);
    }
    if (state.handle && ![...state.frameHandles.values()].includes(state.handle)) {
      syncShootableEnemyDataset(shootable, state.handle, enemyAnimationFrameIndex(shootable));
    }
  }

  function syncShootableEnemyDataset(
    shootable: Shootable,
    handle: PolyMeshHandle,
    frameIndex: number,
  ): void {
    if (!isQuakeDebugDomMetadataEnabled()) return;
    const enemy = shootable.enemy;
    if (!enemy) return;
    if (enemy.awake) {
      setElementDatasetValue(handle.element, "awake", "true");
    } else {
      removeElementDatasetValue(handle.element, "awake");
    }
    if (enemy.attackVisual) {
      setElementDatasetValue(handle.element, "attack", enemy.attackVisual);
    } else {
      removeElementDatasetValue(handle.element, "attack");
    }
    setElementDatasetValue(handle.element, "originX", shootable.origin[0].toFixed(4));
    setElementDatasetValue(handle.element, "originY", shootable.origin[1].toFixed(4));
    setElementDatasetValue(handle.element, "originZ", shootable.origin[2].toFixed(4));
    setElementDatasetValue(handle.element, "yaw", shootable.yaw.toFixed(3));
    if (enemy.currentTarget) {
      setElementDatasetValue(handle.element, "target", enemyTargetTraceLabel(enemy.currentTarget) ?? "");
    } else {
      removeElementDatasetValue(handle.element, "target");
    }
    setElementDatasetValue(handle.element, "animationMode", enemy.animationMode);
    setElementDatasetValue(handle.element, "animationFrame", String(frameIndex));
    if (enemy.quakecLastState) {
      setElementDatasetValue(handle.element, "quakecChain", enemy.quakecLastState.chain);
      setElementDatasetValue(handle.element, "quakecState", enemy.quakecLastState.stateName);
      setElementDatasetValue(handle.element, "quakecFrame", enemy.quakecLastState.frame);
      setElementDatasetValue(handle.element, "quakecCalls", enemy.quakecLastState.calls.join(","));
    } else {
      removeElementDatasetValue(handle.element, "quakecChain");
      removeElementDatasetValue(handle.element, "quakecState");
      removeElementDatasetValue(handle.element, "quakecFrame");
      removeElementDatasetValue(handle.element, "quakecCalls");
    }
  }

  function setElementDatasetValue(element: HTMLElement, key: string, value: string): void {
    if (element.dataset[key] === value) return;
    element.dataset[key] = value;
  }

  function removeElementDatasetValue(element: HTMLElement, key: string): void {
    if (element.dataset[key] === undefined) return;
    delete element.dataset[key];
  }

  function syncShootableTransformForHandle(
    shootable: Shootable,
    handle: PolyMeshHandle,
    yaw = shootable.yaw,
  ): void {
    const state = stateFor(shootable);
    const renderPosition = shootable.origin;
    const scale = shootable.model?.renderScale ? 1 / shootable.model.renderScale : 1;
    const renderYaw = normalizeShootableYaw(yaw, Boolean(shootable.model));
    if (isQuakeDebugDomMetadataEnabled() && shootable.enemy) {
      setElementDatasetValue(handle.element, "yaw", yaw.toFixed(3));
    }
    if (!setQuakeShootableHandleTransformIfChanged(
      handle,
      renderPosition,
      renderYaw,
      scale,
      QUAKE_SHOOTABLE_TRANSFORM_EPSILON,
    )) return;
    if (shootable.enemy && state.visible && handle === state.handle) {
      markShootableTrace("enemy-transform", shootable, {
        renderYaw,
        yaw,
        x: renderPosition[0],
        y: renderPosition[1],
        z: renderPosition[2],
      });
    }
  }

  function markEnemyMotionMaterial(
    shootable: Shootable,
    handle: PolyMeshHandle | null,
    reason: string,
  ): boolean {
    const state = stateFor(shootable);
    if (
      !enemyMotionMaterial ||
      !shootable.enemy ||
      shootable.dead ||
      !state.visible ||
      handle !== state.handle
    ) {
      return false;
    }
    return markQuakeRenderBundleFrameSetHandleMotionMaterial(handle, reason);
  }

  function enemyTargetTraceLabel(target: QuakeEnemyTargetReference | null): string | null {
    if (!target) return null;
    return target.kind === "shootable" ? `${target.classname}:${target.entityIndex}` : target.kind;
  }

  function enemyAnimationFrameIndex(shootable: Shootable): number {
    return shootable.enemy?.animationFrameIndex ?? 0;
  }

  function normalizeShootableYaw(yaw: number, hasAliasModel = false): number {
    return hasAliasModel ? quakeAliasModelRenderYaw(yaw) : normalizeQuakeRenderYaw(yaw);
  }

  function mount(shootable: Shootable, poolFrames: boolean): FrameBackend | null {
    const state = stateFor(shootable);
    if (state.handle) {
      return isQuakeRenderBundleFrameSetHandle(state.handle) ? "frameset" : state.frameHandles.size ? "pool" : "replace";
    }
    if (canUseShootableAnimationFrameSet(shootable)) {
      state.handle = addShootableMesh(shootable.entity, shootable.model, enemyAnimationFrameIndex(shootable));
      markShootableTrace("shootable-mount", shootable, {
        backend: "frameset",
        handles: countShootableHandles(shootable),
      });
      syncShootableTransform(shootable);
      syncShootableHandleVisibility(shootable);
      syncShootableEnemyDatasets(shootable);
      return "frameset";
    }
    if (poolFrames) {
      const frameIndex = enemyAnimationFrameIndex(shootable);
      const handle = ensureShootableAnimationFrameHandle(shootable, frameIndex);
      if (!handle) return null;
      setActiveShootableAnimationFrameHandle(shootable, frameIndex, handle);
      markShootableTrace("shootable-mount", shootable, {
        backend: "pool",
        handles: countShootableHandles(shootable),
      });

      return "pool";
    }
    state.handle = addShootableMesh(shootable.entity, shootable.model, enemyAnimationFrameIndex(shootable));
    markShootableTrace("shootable-mount", shootable, {
      backend: "replace",
      handles: countShootableHandles(shootable),
    });
    syncShootableTransform(shootable);
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDatasets(shootable);
    return "replace";
  }

  function activateFrame(shootable: Shootable, frameIndex: number, poolFrames: boolean): FrameBackend | null {
    const state = stateFor(shootable);
    if (!state.handle || !state.visible) return null;
    if (isQuakeRenderBundleFrameSetHandle(state.handle)) {
      if (setQuakeRenderBundleFrameSetHandleFrame(state.handle, frameIndex)) {
        syncShootableEnemyDatasets(shootable);
        markShootableTrace("enemy-animation-frame", shootable, {
          backend: "frameset",
          requestedFrame: frameIndex,
          handles: countShootableHandles(shootable),
        });
      }
      return "frameset";
    }
    if (!poolFrames) {
      replaceShootableAnimationFrame(shootable, frameIndex);
      markShootableTrace("enemy-animation-frame", shootable, {
        backend: "replace",
        requestedFrame: frameIndex,
        handles: countShootableHandles(shootable),
      });
      return "replace";
    }
    const handle = ensureShootableAnimationFrameHandle(shootable, frameIndex);
    if (!handle) return null;
    setActiveShootableAnimationFrameHandle(shootable, frameIndex, handle);
    markShootableTrace("enemy-animation-frame", shootable, {
      backend: "pool",
      requestedFrame: frameIndex,
      handles: countShootableHandles(shootable),
    });
    return "pool";
  }

  function syncShootableTransform(
    shootable: Shootable,
    yaw = shootable.yaw,
  ): void {
    forEachShootableHandle(shootable, (handle) => syncShootableTransformForHandle(shootable, handle, yaw));
  }

  const QUAKE_SHOOTABLE_PREWARMED_CLASS = "quake-shootable-prewarmed";
  const QUAKE_SHOOTABLE_FRAME_HIDDEN_CLASS = "quake-frame-hidden";
  const QUAKE_SHOOTABLE_DYING_CLASS = "quake-shootable-dying";
  const QUAKE_SHOOTABLE_CORPSE_CLASS = "quake-shootable-corpse";
  const QUAKE_SHOOTABLE_DEAD_CLASS = "quake-shootable-dead";
  const QUAKE_SHOOTABLE_HURT_CLASS = "quake-shootable-hurt";
  const QUAKE_SHOOTABLE_HURT_FLASH_MS = 120;
  const quakeShootableTransformSnapshots = new WeakMap<PolyMeshHandle, TransformSnapshot>();
  const quakeShootableHurtFlashTimers = new WeakMap<HTMLElement, number>();

  function forEachQuakeShootableHandle(
    shootable: Shootable,
    callback: (handle: PolyMeshHandle) => void,
  ): void {
    const state = stateFor(shootable);
    const handles = new Set(state.frameHandles.values());
    if (state.handle) handles.add(state.handle);
    for (const handle of handles) callback(handle);
  }

  function countQuakeShootableHandles(shootable: Shootable): number {
    const state = stateFor(shootable);
    const handles = new Set(state.frameHandles.values());
    if (state.handle) handles.add(state.handle);
    return handles.size;
  }

  function removeQuakeShootableHandles(shootable: Shootable): { frameHandles: number; handles: number } {
    const state = stateFor(shootable);
    const handles = countQuakeShootableHandles(shootable);
    const frameHandles = state.frameHandles.size;
    forEachQuakeShootableHandle(shootable, (handle) => handle.remove());
    state.handle = null;
    state.frameHandles.clear();
    state.visible = false;
    return { handles, frameHandles };
  }

  function syncQuakeShootableHandleVisibility(
    shootable: Shootable,
    lifecycle: Lifecycle,
  ): void {
    const state = stateFor(shootable);
    forEachQuakeShootableHandle(shootable, (handle) => {
      syncQuakeShootableLifecycleClasses(shootable, handle, lifecycle);
      const active = handle === state.handle;
      if (!state.visible) {
        handle.element.classList.add(QUAKE_SHOOTABLE_PREWARMED_CLASS);
        if (active) handle.element.classList.remove(QUAKE_SHOOTABLE_FRAME_HIDDEN_CLASS);
        handle.element.setAttribute("aria-hidden", "true");
        return;
      }
      handle.element.classList.remove(QUAKE_SHOOTABLE_PREWARMED_CLASS);
      if (active) {
        handle.element.classList.remove(QUAKE_SHOOTABLE_FRAME_HIDDEN_CLASS);
        handle.element.removeAttribute("aria-hidden");
      } else {
        handle.element.classList.add(QUAKE_SHOOTABLE_FRAME_HIDDEN_CLASS);
        handle.element.setAttribute("aria-hidden", "true");
      }
    });
  }

  function syncQuakeShootableLifecycleClassesForShootable(
    shootable: Shootable,
    lifecycle: Lifecycle,
  ): void {
    forEachQuakeShootableHandle(shootable, (handle) => syncQuakeShootableLifecycleClasses(shootable, handle, lifecycle));
  }

  function flashQuakeShootable(shootable: Shootable): void {
    const state = stateFor(shootable);
    const element = state.handle?.element;
    if (!element) return;
    const previousTimer = quakeShootableHurtFlashTimers.get(element);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    element.classList.remove(QUAKE_SHOOTABLE_HURT_CLASS);
    void element.offsetWidth;
    element.classList.add(QUAKE_SHOOTABLE_HURT_CLASS);
    const timer = window.setTimeout(() => {
      quakeShootableHurtFlashTimers.delete(element);
      if (element.isConnected) element.classList.remove(QUAKE_SHOOTABLE_HURT_CLASS);
    }, QUAKE_SHOOTABLE_HURT_FLASH_MS);
    quakeShootableHurtFlashTimers.set(element, timer);
  }

  function setQuakeShootableHandleTransformIfChanged(
    handle: PolyMeshHandle,
    renderPosition: Vec3,
    yaw: number,
    scale: number,
    epsilon: number,
  ): boolean {
    const next = {
      x: renderPosition[0],
      y: renderPosition[1],
      z: renderPosition[2],
      yaw,
      scale,
    };
    const previous = quakeShootableTransformSnapshots.get(handle);
    if (previous && quakeShootableTransformSnapshotEquals(previous, next, epsilon)) return false;
    quakeShootableTransformSnapshots.set(handle, next);
    handle.setTransform({
      position: renderPosition,
      rotation: [0, 0, yaw],
      scale,
    });
    return true;
  }

  function syncQuakeShootableLifecycleClasses(
    shootable: Shootable,
    handle: PolyMeshHandle,
    lifecycle: Lifecycle,
  ): void {
    if (!shootable.dead) {
      handle.element.classList.remove(
        QUAKE_SHOOTABLE_CORPSE_CLASS,
        QUAKE_SHOOTABLE_DEAD_CLASS,
        QUAKE_SHOOTABLE_DYING_CLASS,
      );
      return;
    }
    handle.element.classList.remove(QUAKE_SHOOTABLE_HURT_CLASS);
    if (lifecycle.deathAnimating) {
      handle.element.classList.add(QUAKE_SHOOTABLE_DYING_CLASS);
      handle.element.classList.remove(QUAKE_SHOOTABLE_CORPSE_CLASS, QUAKE_SHOOTABLE_DEAD_CLASS);
      return;
    }
    handle.element.classList.remove(QUAKE_SHOOTABLE_DYING_CLASS);
    if (lifecycle.persistentCorpse) {
      handle.element.classList.add(QUAKE_SHOOTABLE_CORPSE_CLASS);
      handle.element.classList.remove(QUAKE_SHOOTABLE_DEAD_CLASS);
      return;
    }
    handle.element.classList.add(QUAKE_SHOOTABLE_DEAD_CLASS);
    handle.element.classList.remove(QUAKE_SHOOTABLE_CORPSE_CLASS);
  }

  function quakeShootableTransformSnapshotEquals(
    previous: TransformSnapshot,
    next: TransformSnapshot,
    epsilon: number,
  ): boolean {
    return quakeTransformNumberEquals(previous.x, next.x, epsilon) &&
      quakeTransformNumberEquals(previous.y, next.y, epsilon) &&
      quakeTransformNumberEquals(previous.z, next.z, epsilon) &&
      quakeTransformNumberEquals(previous.yaw, next.yaw, epsilon) &&
      quakeTransformNumberEquals(previous.scale, next.scale, epsilon);
  }

  function quakeTransformNumberEquals(previous: number, next: number, epsilon: number): boolean {
    return Math.abs(previous - next) <= epsilon;
  }

  return {
    hasHandle, isVisible, frameHandleCount, hasFrame, setVisible, mount, activateFrame,
    supportsFrameSet: canUseShootableAnimationFrameSet,
    ensureFrame: (shootable: Shootable, frame: number) => { ensureShootableAnimationFrameHandle(shootable, frame); },
    trimFrames: trimShootableAnimationFrameHandles,
    handleCount: countShootableHandles,
    remove: removeShootableHandles,
    syncTransform: syncShootableTransform,
    syncDatasets: syncShootableEnemyDatasets,
    syncLifecycle: (shootable: Shootable) => syncQuakeShootableLifecycleClassesForShootable(shootable, shootableLifecycleClassState(shootable)),
    flash: flashQuakeShootable,
    markMotionMaterial: (shootable: Shootable, reason: string) => markEnemyMotionMaterial(shootable, stateFor(shootable).handle, reason),
  };
}
