import type { Vec3 } from "@layoutit/polycss";

import { QUAKE_BUTTON_USE_RANGE, COLLISION_EPSILON } from "../constants";
import type { QuakeUseTrace } from "../collision";
import { distanceSq3 } from "../math";

interface QuakeCrosshairTargetCache {
  actionTrace: QuakeUseTrace | null;
  shootableTrace: QuakeUseTrace | null;
  origin: Vec3 | null;
  rotX: number;
  rotY: number;
  mapName: string;
  valid: boolean;
}

export interface QuakeCrosshairInteractionWeapons {
  traceIsActionable(trace: QuakeUseTrace | null): trace is QuakeUseTrace;
  traceIsShootable(trace: QuakeUseTrace | null): trace is QuakeUseTrace;
  viewTraceAtCrosshair(range: number): QuakeUseTrace | null;
  weaponTraceAtCrosshair(): QuakeUseTrace | null;
}

export interface QuakeCrosshairInteractionFlowOptions {
  activateEntity(entityIndex: number): void;
  addBodyClasses(...classNames: string[]): void;
  canUseInput(): boolean;
  currentMapName(): string;
  getOrigin(): Vec3;
  isDisposed(): boolean;
  removeBodyClasses(...classNames: string[]): void;
  rotation(): { rotX: number; rotY: number };
  weapons: QuakeCrosshairInteractionWeapons;
}

export interface QuakeCrosshairInteractionFlow {
  activateButtonAtTrace(trace: QuakeUseTrace | null): boolean;
  clear(): void;
  dispose(): void;
  pointerActionTrace(): QuakeUseTrace | null;
  queueSync(): void;
  sync(): void;
}

export function createQuakeCrosshairInteractionFlow(
  options: QuakeCrosshairInteractionFlowOptions,
): QuakeCrosshairInteractionFlow {
  const cache: QuakeCrosshairTargetCache = {
    actionTrace: null,
    shootableTrace: null,
    origin: null,
    rotX: 0,
    rotY: 0,
    mapName: "",
    valid: false,
  };
  let syncFrame = 0;

  function activateButtonAtTrace(trace: QuakeUseTrace | null): boolean {
    if (!options.weapons.traceIsActionable(trace) || trace.entityIndex === undefined) return false;
    options.activateEntity(trace.entityIndex);
    return true;
  }

  function pointerActionTrace(): QuakeUseTrace | null {
    if (isCacheFresh()) return cache.actionTrace;
    const trace = options.weapons.viewTraceAtCrosshair(QUAKE_BUTTON_USE_RANGE);
    cacheActionProbe(trace);
    return cache.actionTrace;
  }

  function sync(): void {
    cancelQueuedSync();
    if (!options.canUseInput()) {
      invalidate();
      return;
    }
    const trace = options.weapons.viewTraceAtCrosshair(QUAKE_BUTTON_USE_RANGE);
    if (options.weapons.traceIsActionable(trace)) {
      cacheTarget(trace, null);
      options.addBodyClasses("quake-action");
      return;
    }
    const weaponTrace = options.weapons.weaponTraceAtCrosshair();
    if (options.weapons.traceIsShootable(weaponTrace)) {
      cacheTarget(null, weaponTrace);
      options.addBodyClasses("quake-action");
      return;
    }
    cacheTarget(null, null);
    options.removeBodyClasses("quake-action");
  }

  function queueSync(): void {
    if (options.isDisposed() || syncFrame) return;
    syncFrame = window.requestAnimationFrame(() => {
      syncFrame = 0;
      sync();
    });
  }

  function clear(): void {
    invalidate();
  }

  function dispose(): void {
    cancelQueuedSync();
    invalidate();
  }

  function cancelQueuedSync(): void {
    if (!syncFrame) return;
    window.cancelAnimationFrame(syncFrame);
    syncFrame = 0;
  }

  function invalidate(): void {
    cache.actionTrace = null;
    cache.shootableTrace = null;
    cache.origin = null;
    cache.valid = false;
    options.removeBodyClasses("quake-action");
  }

  function cacheActionProbe(trace: QuakeUseTrace | null): void {
    const actionTrace = options.weapons.traceIsActionable(trace) ? trace : null;
    cacheTarget(actionTrace, null);
    if (actionTrace) {
      options.addBodyClasses("quake-action");
    } else {
      options.removeBodyClasses("quake-action");
      queueSync();
    }
  }

  function cacheTarget(actionTrace: QuakeUseTrace | null, shootableTrace: QuakeUseTrace | null): void {
    const origin = options.getOrigin();
    const rotation = options.rotation();
    cache.actionTrace = actionTrace;
    cache.shootableTrace = shootableTrace;
    cache.origin = [origin[0], origin[1], origin[2]];
    cache.rotX = rotation.rotX;
    cache.rotY = rotation.rotY;
    cache.mapName = options.currentMapName();
    cache.valid = true;
  }

  function isCacheFresh(): boolean {
    if (!cache.valid || !cache.origin) return false;
    if (cache.mapName !== options.currentMapName()) return false;
    const origin = options.getOrigin();
    if (distanceSq3(origin, cache.origin) > COLLISION_EPSILON * COLLISION_EPSILON) return false;
    const rotation = options.rotation();
    return Math.abs(rotation.rotX - cache.rotX) <= COLLISION_EPSILON &&
      Math.abs(rotation.rotY - cache.rotY) <= COLLISION_EPSILON;
  }

  return {
    activateButtonAtTrace,
    clear,
    dispose,
    pointerActionTrace,
    queueSync,
    sync,
  };
}
