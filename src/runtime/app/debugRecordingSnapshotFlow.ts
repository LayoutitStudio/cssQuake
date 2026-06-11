import type {
  QuakeDebugRecordingSnapshot,
  QuakeDebugRecordingView,
} from "../debug/recording";
import type { QuakeTouchedTrigger } from "../collision";

export interface QuakeDebugRecordingSnapshotFlowOptions {
  currentMapName(): string;
  currentView(): QuakeDebugRecordingView;
  flags(): Record<string, unknown>;
  gameplay(): Record<string, unknown>;
  hazards(): Record<string, unknown>;
  input(): Record<string, unknown>;
  isLoading(): boolean;
  isPaused(): boolean;
  isPointerLocked(): boolean;
  moversStats(): Record<string, unknown>;
  playerMovement(): Record<string, unknown>;
  playerProgress(): Record<string, unknown>;
  shootableCulling(origin: [number, number, number]): QuakeDebugRecordingSnapshot["shootableCulling"];
  shootablesStats(): QuakeDebugRecordingSnapshot["shootables"];
  targets(): Record<string, unknown>;
  touchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[];
  triggersStats(): Record<string, unknown>;
  viewUrl(view: QuakeDebugRecordingView): string;
  viewmodel(): Record<string, unknown>;
  worldStats(): QuakeDebugRecordingSnapshot["world"];
}

export interface QuakeDebugRecordingSnapshotFlow {
  capture(): QuakeDebugRecordingSnapshot;
}

export function createQuakeDebugRecordingSnapshotFlow(
  options: QuakeDebugRecordingSnapshotFlowOptions,
): QuakeDebugRecordingSnapshotFlow {
  function capture(): QuakeDebugRecordingSnapshot {
    const view = options.currentView();
    return {
      mapName: options.currentMapName(),
      view,
      viewUrl: options.viewUrl(view),
      loading: options.isLoading(),
      paused: options.isPaused(),
      pointerLocked: options.isPointerLocked(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        visualWidth: window.visualViewport?.width ?? null,
        visualHeight: window.visualViewport?.height ?? null,
      },
      world: options.worldStats(),
      player: {
        movement: options.playerMovement(),
        progress: options.playerProgress(),
      },
      shootables: options.shootablesStats(),
      shootableCulling: options.shootableCulling(view.origin),
      pickups: capturePickupSnapshot(),
      movers: options.moversStats(),
      triggers: {
        ...options.triggersStats(),
        touched: options.touchedTriggers(view.origin).map(triggerSnapshot),
      },
      targets: options.targets(),
      hazards: options.hazards(),
      viewmodel: options.viewmodel(),
      input: options.input(),
      gameplay: options.gameplay(),
      dom: captureDomSnapshot(),
      flags: options.flags(),
      performance: capturePerformanceSnapshot(),
    };
  }

  return { capture };
}

function capturePickupSnapshot(): Record<string, unknown> {
  const pickupMeshes = Array.from(document.querySelectorAll<HTMLElement>(".polycss-mesh.pickup"));
  return {
    active: pickupMeshes.filter((element) => !element.hidden).length,
    hidden: pickupMeshes.filter((element) => element.hidden).length,
    total: pickupMeshes.length,
  };
}

function captureDomSnapshot(): Record<string, unknown> {
  const allMeshes = Array.from(document.querySelectorAll<HTMLElement>("#quake-app .polycss-mesh"));
  const shootableMeshes = allMeshes.filter((element) => element.classList.contains("shootable"));
  const enemyMeshes = shootableMeshes.filter((element) => element.classList.contains("enemy"));
  const pickupMeshes = allMeshes.filter((element) => element.classList.contains("pickup"));
  const worldMeshes = allMeshes.filter(
    (element) => !element.classList.contains("shootable") && !element.classList.contains("pickup"),
  );
  return {
    meshes: {
      total: allMeshes.length,
      world: worldMeshes.length,
      shootables: shootableMeshes.length,
      enemies: enemyMeshes.length,
      pickups: pickupMeshes.length,
      prewarmedEnemies: enemyMeshes.filter((element) => element.classList.contains("quake-shootable-prewarmed")).length,
      hiddenEnemyFrames: enemyMeshes.filter((element) => element.classList.contains("quake-frame-hidden")).length,
    },
    leaves: {
      total: countMeshLeaves(allMeshes),
      world: countMeshLeaves(worldMeshes),
      enemies: countMeshLeaves(enemyMeshes),
      pickups: countMeshLeaves(pickupMeshes),
    },
    enemyEntityIndexes: enemyMeshes
      .map((element) => Number(element.dataset.entityIndex))
      .filter((entityIndex) => Number.isFinite(entityIndex))
      .sort((a, b) => a - b),
    bodyClass: document.body.className,
  };
}

function countMeshLeaves(meshes: HTMLElement[]): number {
  return meshes.reduce((total, element) => total + element.querySelectorAll("b,i,s,u").length, 0);
}

function triggerSnapshot(trigger: QuakeTouchedTrigger): Record<string, unknown> {
  return {
    entityIndex: trigger.entityIndex,
    modelIndex: trigger.modelIndex,
    classname: trigger.classname,
    contact: trigger.contact ?? null,
    target: trigger.target ?? null,
    targetname: trigger.targetname ?? null,
  };
}

function capturePerformanceSnapshot(): Record<string, unknown> {
  const memory = (performance as Performance & {
    memory?: {
      jsHeapSizeLimit?: number;
      totalJSHeapSize?: number;
      usedJSHeapSize?: number;
    };
  }).memory;
  return {
    now: performance.now(),
    timeOrigin: performance.timeOrigin,
    documentHidden: document.hidden,
    visibilityState: document.visibilityState,
    memory: memory
      ? {
          jsHeapSizeLimit: memory.jsHeapSizeLimit ?? null,
          totalJSHeapSize: memory.totalJSHeapSize ?? null,
          usedJSHeapSize: memory.usedJSHeapSize ?? null,
        }
      : null,
  };
}
