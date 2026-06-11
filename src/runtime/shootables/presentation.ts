import type { PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeShootableState, QuakeShootableTransformSnapshot } from "./state";

export interface QuakeShootableLifecycleClassState {
  deathAnimating: boolean;
  persistentCorpse: boolean;
}

export interface QuakeShootableHandleRemovalStats {
  frameHandles: number;
  handles: number;
}

const QUAKE_SHOOTABLE_PREWARMED_CLASS = "quake-shootable-prewarmed";
const QUAKE_SHOOTABLE_FRAME_HIDDEN_CLASS = "quake-frame-hidden";
const QUAKE_SHOOTABLE_DYING_CLASS = "quake-shootable-dying";
const QUAKE_SHOOTABLE_CORPSE_CLASS = "quake-shootable-corpse";
const QUAKE_SHOOTABLE_DEAD_CLASS = "quake-shootable-dead";
const QUAKE_SHOOTABLE_HURT_CLASS = "quake-shootable-hurt";
const quakeShootableTransformSnapshots = new WeakMap<PolyMeshHandle, QuakeShootableTransformSnapshot>();

export function forEachQuakeShootableHandle(
  shootable: QuakeShootableState,
  callback: (handle: PolyMeshHandle) => void,
): void {
  const handles = new Set(shootable.frameHandles.values());
  if (shootable.handle) handles.add(shootable.handle);
  for (const handle of handles) callback(handle);
}

export function countQuakeShootableHandles(shootable: QuakeShootableState): number {
  const handles = new Set(shootable.frameHandles.values());
  if (shootable.handle) handles.add(shootable.handle);
  return handles.size;
}

export function removeQuakeShootableHandles(shootable: QuakeShootableState): QuakeShootableHandleRemovalStats {
  const handles = countQuakeShootableHandles(shootable);
  const frameHandles = shootable.frameHandles.size;
  forEachQuakeShootableHandle(shootable, (handle) => handle.remove());
  shootable.handle = null;
  shootable.frameHandles.clear();
  shootable.visible = false;
  return { handles, frameHandles };
}

export function syncQuakeShootableHandleVisibility(
  shootable: QuakeShootableState,
  lifecycle: QuakeShootableLifecycleClassState,
): void {
  forEachQuakeShootableHandle(shootable, (handle) => {
    syncQuakeShootableLifecycleClasses(shootable, handle, lifecycle);
    const active = handle === shootable.handle;
    if (!shootable.visible) {
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

export function syncQuakeShootableLifecycleClassesForShootable(
  shootable: QuakeShootableState,
  lifecycle: QuakeShootableLifecycleClassState,
): void {
  forEachQuakeShootableHandle(shootable, (handle) => syncQuakeShootableLifecycleClasses(shootable, handle, lifecycle));
}

export function flashQuakeShootable(shootable: QuakeShootableState): void {
  const element = shootable.handle?.element;
  if (!element) return;
  element.classList.remove(QUAKE_SHOOTABLE_HURT_CLASS);
  void element.offsetWidth;
  element.classList.add(QUAKE_SHOOTABLE_HURT_CLASS);
  window.setTimeout(() => {
    if (element.isConnected) element.classList.remove(QUAKE_SHOOTABLE_HURT_CLASS);
  }, 120);
}

export function setQuakeShootableHandleTransformIfChanged(
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
  shootable: QuakeShootableState,
  handle: PolyMeshHandle,
  lifecycle: QuakeShootableLifecycleClassState,
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
  previous: QuakeShootableTransformSnapshot,
  next: QuakeShootableTransformSnapshot,
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
