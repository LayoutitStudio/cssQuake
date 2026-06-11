import type {
  QuakeShootableDebugCullingEntry,
  QuakeShootablesDebugCullingSnapshot,
  QuakeShootablesDebugStats,
} from "../shootables";
import type { QuakeWorldDebugStats } from "../world";

const QUAKE_DEBUG_RECORDING_SAMPLE_MS = 125;
const QUAKE_DEBUG_RECORDING_MAX_SAMPLES = 6000;
const QUAKE_DEBUG_RECORDING_MAX_EVENTS = 10000;
const QUAKE_DEBUG_FRAME_BUDGET_60HZ_MS = 1000 / 60;
const QUAKE_DEBUG_FRAME_BUDGET_30HZ_MS = 1000 / 30;
const QUAKE_DEBUG_FRAME_BUDGET_20HZ_MS = 1000 / 20;
const QUAKE_DEBUG_FRAME_HITCH_THRESHOLD_MS = QUAKE_DEBUG_FRAME_BUDGET_30HZ_MS;

export interface QuakeDebugRecordingView {
  origin: [number, number, number];
  rotX: number;
  rotY: number;
}

export interface QuakeDebugRecordingSnapshot {
  mapName: string;
  view: QuakeDebugRecordingView;
  viewUrl: string;
  loading: boolean;
  paused: boolean;
  pointerLocked: boolean;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
    visualWidth: number | null;
    visualHeight: number | null;
  };
  world: QuakeWorldDebugStats;
  player: Record<string, unknown>;
  shootables: QuakeShootablesDebugStats;
  shootableCulling: QuakeShootablesDebugCullingSnapshot;
  pickups: Record<string, unknown>;
  movers: Record<string, unknown>;
  triggers: Record<string, unknown>;
  targets: Record<string, unknown>;
  hazards: Record<string, unknown>;
  viewmodel: Record<string, unknown>;
  input: Record<string, unknown>;
  gameplay: Record<string, unknown>;
  dom: Record<string, unknown>;
  flags: Record<string, unknown>;
  performance: Record<string, unknown>;
}

export interface QuakeDebugRecordingFrameStats {
  averageMs: number;
  elapsedMs: number;
  frames: number;
  longFramesOver16Ms: number;
  longFramesOver33Ms: number;
  longFramesOver50Ms: number;
  maxMs: number;
  minMs: number;
  p95Ms: number;
  p99Ms: number;
}

export interface QuakeDebugRecordingSample {
  sequence: number;
  reason: "start" | "sample" | "stop" | "limit";
  elapsedMs: number;
  wallTime: string;
  captureMs: number;
  frame: QuakeDebugRecordingFrameStats;
  snapshot: QuakeDebugRecordingSnapshot;
}

export interface QuakeDebugRecordingCullingEvent {
  type: "shootable-culling-change";
  elapsedMs: number;
  sequence: number;
  entityIndex: number;
  classname: string;
  changed: string[];
  previous: QuakeDebugRecordingCullingEventState | null;
  next: QuakeDebugRecordingCullingEventState;
}

export interface QuakeDebugRecordingCullingEventState {
  animationFrame: number | null;
  animationMode: string | null;
  blockReasons: string[];
  budgetBlocked: boolean;
  canMount: boolean;
  desiredMounted: boolean;
  desiredPrewarmed: boolean;
  distance: number;
  health: number;
  inPvs: boolean | null;
  leafIndex: number | null;
  mounted: boolean;
  mountCandidate: boolean;
  prewarmed: boolean;
  strictMountCandidate: boolean;
  visible: boolean;
  visibilityGrace: boolean;
}

export interface QuakeDebugRecordingStateEvent {
  type: "game-state-change";
  elapsedMs: number;
  sequence: number;
  changed: string[];
  previous: Record<string, unknown>;
  next: Record<string, unknown>;
}

export interface QuakeDebugRecordingFrameHitchEvent {
  type: "frame-hitch";
  elapsedMs: number;
  sequence: number;
  thresholdMs: number;
  frame: QuakeDebugRecordingFrameStats;
  context: Record<string, unknown>;
}

export type QuakeDebugRecordingEvent =
  | QuakeDebugRecordingCullingEvent
  | QuakeDebugRecordingFrameHitchEvent
  | QuakeDebugRecordingStateEvent;

export interface QuakeDebugRecording {
  schemaVersion: 2;
  metadata: {
    appVersion: string;
    sampleIntervalMs: number;
    maxSamples: number;
    recordingKind: "debug-state";
    startedAt: string;
    pageUrl: string;
    userAgent: string;
    mapName: string;
  };
  stoppedAt?: string;
  durationMs?: number;
  stopReason?: "stop" | "limit" | "dispose";
  samples: QuakeDebugRecordingSample[];
  events: QuakeDebugRecordingEvent[];
  summary?: Record<string, unknown>;
}

export interface QuakeDebugRecorderOptions {
  appVersion: string;
  button: HTMLButtonElement | null;
  statusElement: HTMLElement | null;
  currentMapName: () => string;
  snapshot: () => QuakeDebugRecordingSnapshot;
}

export interface QuakeDebugRecorder {
  dispose(): void;
  isRecording(): boolean;
  start(): boolean;
  stop(reason?: "stop" | "limit" | "dispose"): QuakeDebugRecording | null;
}

interface QuakeDebugRecordingWindow extends Window {
  __cssQuakeLastRecording?: QuakeDebugRecording;
}

export function createQuakeDebugRecorder(options: QuakeDebugRecorderOptions): QuakeDebugRecorder {
  let recording: QuakeDebugRecording | null = null;
  let timer: number | null = null;
  let frameHandle: number | null = null;
  let lastFrameAt = 0;
  let sampleFrameWindowStartedAt = 0;
  let sampleFrameTimes: number[] = [];
  let startedAt = 0;

  function isRecording(): boolean {
    return recording !== null;
  }

  function start(): boolean {
    if (recording) return false;
    startedAt = performance.now();
    recording = {
      schemaVersion: 2,
      metadata: {
        appVersion: options.appVersion,
        sampleIntervalMs: QUAKE_DEBUG_RECORDING_SAMPLE_MS,
        maxSamples: QUAKE_DEBUG_RECORDING_MAX_SAMPLES,
        recordingKind: "debug-state",
        startedAt: new Date().toISOString(),
        pageUrl: window.location.href,
        userAgent: navigator.userAgent,
        mapName: options.currentMapName(),
      },
      samples: [],
      events: [],
    };
    startFrameSampler();
    updatePresentation();
    captureSample("start");
    timer = window.setInterval(() => {
      if (!recording) return;
      if (recording.samples.length >= QUAKE_DEBUG_RECORDING_MAX_SAMPLES) {
        stop("limit");
        return;
      }
      captureSample("sample");
    }, QUAKE_DEBUG_RECORDING_SAMPLE_MS);
    return true;
  }

  function stop(reason: "stop" | "limit" | "dispose" = "stop"): QuakeDebugRecording | null {
    if (!recording) return null;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (reason !== "dispose") captureSample(reason === "limit" ? "limit" : "stop");
    stopFrameSampler();
    const finished = recording;
    finished.stoppedAt = new Date().toISOString();
    finished.durationMs = Math.max(0, performance.now() - startedAt);
    finished.stopReason = reason;
    finished.summary = buildRecordingSummary(finished);
    (window as QuakeDebugRecordingWindow).__cssQuakeLastRecording = finished;
    recording = null;
    updatePresentation(finished);
    if (reason !== "dispose") downloadRecording(finished);
    return finished;
  }

  function captureSample(reason: QuakeDebugRecordingSample["reason"]): void {
    if (!recording) return;
    const captureStartedAt = performance.now();
    const frame = consumeFrameStats(captureStartedAt);
    const snapshot = options.snapshot();
    const captureMs = performance.now() - captureStartedAt;
    const sample: QuakeDebugRecordingSample = {
      sequence: recording.samples.length,
      reason,
      elapsedMs: Math.max(0, captureStartedAt - startedAt),
      wallTime: new Date().toISOString(),
      captureMs,
      frame,
      snapshot,
    };
    const previous = recording.samples[recording.samples.length - 1] ?? null;
    recording.samples.push(sample);
    appendRecordingEvents(recording, buildPerformanceEvents(sample));
    if (previous) appendRecordingEvents(recording, buildStateEvents(previous, sample));
    if (previous) appendRecordingEvents(recording, buildCullingEvents(previous, sample));
    updatePresentation();
  }

  function startFrameSampler(): void {
    stopFrameSampler();
    lastFrameAt = performance.now();
    sampleFrameWindowStartedAt = lastFrameAt;
    sampleFrameTimes = [];
    frameHandle = window.requestAnimationFrame(tickFrameSampler);
  }

  function stopFrameSampler(): void {
    if (frameHandle !== null) {
      window.cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }
    lastFrameAt = 0;
    sampleFrameWindowStartedAt = 0;
    sampleFrameTimes = [];
  }

  function tickFrameSampler(now: number): void {
    if (!recording) {
      frameHandle = null;
      return;
    }
    if (lastFrameAt > 0) sampleFrameTimes.push(Math.max(0, now - lastFrameAt));
    lastFrameAt = now;
    frameHandle = window.requestAnimationFrame(tickFrameSampler);
  }

  function consumeFrameStats(now: number): QuakeDebugRecordingFrameStats {
    const elapsedMs = sampleFrameWindowStartedAt > 0 ? Math.max(0, now - sampleFrameWindowStartedAt) : 0;
    const times = sampleFrameTimes;
    sampleFrameTimes = [];
    sampleFrameWindowStartedAt = now;
    if (!times.length) {
      return {
        averageMs: 0,
        elapsedMs,
        frames: 0,
        longFramesOver16Ms: 0,
        longFramesOver33Ms: 0,
        longFramesOver50Ms: 0,
        maxMs: 0,
        minMs: 0,
        p95Ms: 0,
        p99Ms: 0,
      };
    }
    const sorted = [...times].sort((a, b) => a - b);
    return {
      averageMs: times.reduce((total, value) => total + value, 0) / times.length,
      elapsedMs,
      frames: times.length,
      longFramesOver16Ms: times.filter((value) => value > QUAKE_DEBUG_FRAME_BUDGET_60HZ_MS).length,
      longFramesOver33Ms: times.filter((value) => value > QUAKE_DEBUG_FRAME_BUDGET_30HZ_MS).length,
      longFramesOver50Ms: times.filter((value) => value > QUAKE_DEBUG_FRAME_BUDGET_20HZ_MS).length,
      maxMs: Math.max(...times),
      minMs: Math.min(...times),
      p95Ms: percentileSorted(sorted, 0.95),
      p99Ms: percentileSorted(sorted, 0.99),
    };
  }

  function dispose(): void {
    stop("dispose");
    options.button?.removeEventListener("click", handleClick);
  }

  function handleClick(): void {
    if (recording) {
      stop();
    } else {
      start();
    }
  }

  function updatePresentation(finished?: QuakeDebugRecording): void {
    if (options.button) {
      options.button.textContent = recording ? "STOP" : "RECORD";
      options.button.dataset.recording = recording ? "true" : "false";
      options.button.setAttribute("aria-pressed", recording ? "true" : "false");
      options.button.setAttribute("aria-label", recording ? "Stop debug recording" : "Record debug data");
      if (recording) {
        delete options.button.dataset.lastSamples;
        delete options.button.dataset.lastEvents;
        delete options.button.dataset.lastCullingEntries;
      } else if (finished) {
        options.button.dataset.lastSamples = String(finished.samples.length);
        options.button.dataset.lastEvents = String(finished.events.length);
        options.button.dataset.lastCullingEntries = String(
          finished.samples[finished.samples.length - 1]?.snapshot.shootableCulling.entries.length ?? 0,
        );
      }
    }
    if (!options.statusElement) return;
    if (recording) {
      const duration = Math.max(0, performance.now() - startedAt) / 1000;
      options.statusElement.textContent = `${duration.toFixed(1)}s, ${recording.samples.length} samples`;
      return;
    }
    if (finished) {
      const duration = (finished.durationMs ?? 0) / 1000;
      options.statusElement.textContent = `saved ${duration.toFixed(1)}s, ${finished.samples.length} samples`;
      return;
    }
    options.statusElement.textContent = "-";
  }

  options.button?.addEventListener("click", handleClick);
  updatePresentation();

  return {
    dispose,
    isRecording,
    start,
    stop,
  };
}

function appendRecordingEvents(
  recording: QuakeDebugRecording,
  events: QuakeDebugRecordingEvent[],
): void {
  const remaining = QUAKE_DEBUG_RECORDING_MAX_EVENTS - recording.events.length;
  if (remaining <= 0 || events.length === 0) return;
  recording.events.push(...events.slice(0, remaining));
}

function buildPerformanceEvents(sample: QuakeDebugRecordingSample): QuakeDebugRecordingFrameHitchEvent[] {
  if (sample.frame.longFramesOver33Ms <= 0) return [];
  return [{
    type: "frame-hitch",
    elapsedMs: sample.elapsedMs,
    sequence: sample.sequence,
    thresholdMs: QUAKE_DEBUG_FRAME_HITCH_THRESHOLD_MS,
    frame: sample.frame,
    context: frameHitchContext(sample),
  }];
}

function buildStateEvents(
  previous: QuakeDebugRecordingSample,
  next: QuakeDebugRecordingSample,
): QuakeDebugRecordingStateEvent[] {
  const previousState = recordingStateSummary(previous);
  const nextState = recordingStateSummary(next);
  const changed = Object.keys(nextState).filter((key) => previousState[key] !== nextState[key]);
  if (!changed.length) return [];
  return [{
    type: "game-state-change",
    elapsedMs: next.elapsedMs,
    sequence: next.sequence,
    changed,
    previous: pickRecord(previousState, changed),
    next: pickRecord(nextState, changed),
  }];
}

function buildCullingEvents(
  previous: QuakeDebugRecordingSample,
  next: QuakeDebugRecordingSample,
): QuakeDebugRecordingCullingEvent[] {
  const previousEntries = new Map(
    previous.snapshot.shootableCulling.entries.map((entry) => [entry.entityIndex, entry]),
  );
  const events: QuakeDebugRecordingCullingEvent[] = [];
  for (const nextEntry of next.snapshot.shootableCulling.entries) {
    const previousEntry = previousEntries.get(nextEntry.entityIndex) ?? null;
    const changed = changedCullingFields(previousEntry, nextEntry);
    if (!changed.length) continue;
    events.push({
      type: "shootable-culling-change",
      elapsedMs: next.elapsedMs,
      sequence: next.sequence,
      entityIndex: nextEntry.entityIndex,
      classname: nextEntry.classname,
      changed,
      previous: previousEntry ? cullingEventState(previousEntry) : null,
      next: cullingEventState(nextEntry),
    });
  }
  return events;
}

function changedCullingFields(
  previous: QuakeShootableDebugCullingEntry | null,
  next: QuakeShootableDebugCullingEntry,
): string[] {
  if (!previous) return ["created"];
  const fields: Array<keyof QuakeDebugRecordingCullingEventState> = [
    "animationFrame",
    "animationMode",
    "budgetBlocked",
    "canMount",
    "desiredMounted",
    "desiredPrewarmed",
    "health",
    "inPvs",
    "leafIndex",
    "mounted",
    "mountCandidate",
    "prewarmed",
    "strictMountCandidate",
    "visible",
    "visibilityGrace",
  ];
  const previousState = cullingEventState(previous);
  const nextState = cullingEventState(next);
  const changed = fields.filter((field) => previousState[field] !== nextState[field]).map(String);
  if (previousState.blockReasons.join("|") !== nextState.blockReasons.join("|")) changed.push("blockReasons");
  return changed;
}

function cullingEventState(entry: QuakeShootableDebugCullingEntry): QuakeDebugRecordingCullingEventState {
  return {
    animationFrame: entry.animationFrame,
    animationMode: entry.animationMode,
    blockReasons: entry.blockReasons,
    budgetBlocked: entry.budgetBlocked,
    canMount: entry.canMount,
    desiredMounted: entry.desiredMounted,
    desiredPrewarmed: entry.desiredPrewarmed,
    distance: entry.distance,
    health: entry.health,
    inPvs: entry.inPvs,
    leafIndex: entry.leafIndex,
    mounted: entry.mounted,
    mountCandidate: entry.mountCandidate,
    prewarmed: entry.prewarmed,
    strictMountCandidate: entry.strictMountCandidate,
    visible: entry.visible,
    visibilityGrace: entry.visibilityGrace,
  };
}

function buildRecordingSummary(recording: QuakeDebugRecording): Record<string, unknown> {
  const first = recording.samples[0];
  const last = recording.samples[recording.samples.length - 1];
  const captureTimes = recording.samples.map((sample) => sample.captureMs);
  return {
    durationMs: recording.durationMs ?? 0,
    sampleCount: recording.samples.length,
    eventCount: recording.events.length,
    captureMs: {
      average: captureTimes.length
        ? captureTimes.reduce((total, value) => total + value, 0) / captureTimes.length
        : 0,
      max: Math.max(0, ...captureTimes),
    },
    worldVisibilityChurnDelta: first && last
      ? numericDeltaRecord(first.snapshot.world.visibilityChurn, last.snapshot.world.visibilityChurn)
      : {},
    shootablesVisibilityChurnDelta: first && last
      ? numericDeltaRecord(first.snapshot.shootables.visibilityChurn, last.snapshot.shootables.visibilityChurn)
      : {},
    eventsByType: countEventsByType(recording.events),
    frameMs: frameSummary(recording.samples),
    frameHitches: frameHitchSummary(recording.events),
    shootableEventsByEntity: countEventsByEntity(recording.events),
  };
}

function frameSummary(samples: QuakeDebugRecordingSample[]): Record<string, number> {
  const frames = samples.reduce((total, sample) => total + sample.frame.frames, 0);
  const averageMs = frames
    ? samples.reduce((total, sample) => total + sample.frame.averageMs * sample.frame.frames, 0) / frames
    : 0;
  return {
    averageMs,
    frames,
    longFramesOver16Ms: samples.reduce((total, sample) => total + sample.frame.longFramesOver16Ms, 0),
    longFramesOver33Ms: samples.reduce((total, sample) => total + sample.frame.longFramesOver33Ms, 0),
    longFramesOver50Ms: samples.reduce((total, sample) => total + sample.frame.longFramesOver50Ms, 0),
    maxMs: Math.max(0, ...samples.map((sample) => sample.frame.maxMs)),
    maxP95Ms: Math.max(0, ...samples.map((sample) => sample.frame.p95Ms)),
    maxP99Ms: Math.max(0, ...samples.map((sample) => sample.frame.p99Ms)),
  };
}

function numericDeltaRecord(
  first: Record<string, unknown>,
  last: Record<string, unknown>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(last)) {
    const firstValue = first[key];
    const lastValue = last[key];
    if (typeof firstValue === "number" && typeof lastValue === "number") {
      out[key] = lastValue - firstValue;
    }
  }
  return out;
}

function countEventsByType(events: QuakeDebugRecordingEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of events) {
    out[event.type] = (out[event.type] ?? 0) + 1;
  }
  return out;
}

function countEventsByEntity(events: QuakeDebugRecordingEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of events) {
    if (event.type !== "shootable-culling-change") continue;
    const key = `${event.entityIndex}:${event.classname}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function frameHitchSummary(events: QuakeDebugRecordingEvent[]): Record<string, number> {
  const hitches = events.filter((event): event is QuakeDebugRecordingFrameHitchEvent => event.type === "frame-hitch");
  return {
    count: hitches.length,
    maxMs: Math.max(0, ...hitches.map((event) => event.frame.maxMs)),
    longFramesOver33Ms: hitches.reduce((total, event) => total + event.frame.longFramesOver33Ms, 0),
    longFramesOver50Ms: hitches.reduce((total, event) => total + event.frame.longFramesOver50Ms, 0),
  };
}

function recordingStateSummary(sample: QuakeDebugRecordingSample): Record<string, string | number | boolean | null> {
  const { snapshot } = sample;
  const player = asRecord(snapshot.player);
  const movement = asRecord(player.movement);
  const progress = asRecord(player.progress);
  const inventory = asRecord(progress.inventory);
  const movers = asRecord(snapshot.movers);
  const triggers = asRecord(snapshot.triggers);
  const targets = asRecord(snapshot.targets);
  const hazards = asRecord(snapshot.hazards);
  const viewmodel = asRecord(snapshot.viewmodel);
  const input = asRecord(snapshot.input);
  const gameplay = asRecord(snapshot.gameplay);
  const performanceSnapshot = asRecord(snapshot.performance);
  const dom = asRecord(snapshot.dom);
  const domMeshes = asRecord(dom.meshes);
  const domLeaves = asRecord(dom.leaves);

  return {
    mapName: snapshot.mapName,
    loading: snapshot.loading,
    paused: snapshot.paused,
    pointerLocked: snapshot.pointerLocked,
    viewport: viewportKey(snapshot),
    documentHidden: booleanValue(performanceSnapshot.documentHidden),
    visibilityState: stringValue(performanceSnapshot.visibilityState),
    currentScene: booleanValue(gameplay.currentScene),
    collisionReady: booleanValue(gameplay.collisionReady),
    multiplayerInputPaused: booleanValue(gameplay.multiplayerInputPaused),
    playerDead: booleanValue(gameplay.playerDead),
    transitionSerial: numberValue(gameplay.transitionSerial),
    leafIndex: snapshot.world.currentLeafIndex,
    visibleLeafCount: snapshot.world.visibleLeafCount,
    pvsFaceCount: snapshot.world.pvsFaceCount,
    renderFaceCount: snapshot.world.renderFaceCount,
    mountedLeaves: snapshot.world.mountedLeaves,
    mountedSkyTextureLeaves: snapshot.world.mountedSkyTextureLeaves,
    mountedSpecialTextureLeaves: snapshot.world.mountedSpecialTextureLeaves,
    mountedTextureAnimatedLeaves: snapshot.world.mountedTextureAnimatedLeaves,
    mountedLightstyleLeaves: snapshot.world.mountedLightstyleLeaves,
    mountedBrushModelLeaves: snapshot.world.mountedBrushModelLeaves,
    mountedEntityLeaves: snapshot.world.mountedEntityLeaves,
    visibleEnemies: snapshot.shootables.visibleEnemyShootables,
    mountedEnemies: snapshot.shootables.mountedEnemyShootables,
    prewarmedEnemies: snapshot.shootables.prewarmedEnemyShootables,
    meshHandles: snapshot.shootables.meshHandles,
    frameHandles: snapshot.shootables.frameHandles,
    enemyFrameHandles: snapshot.shootables.enemyFrameHandles,
    desiredPrewarm: snapshot.shootables.desiredPrewarm,
    prewarmQueue: snapshot.shootables.prewarmQueue,
    animationFramePrewarmQueue: snapshot.shootables.animationFramePrewarmQueue,
    cullingVisibleIndexes: numberArrayKey(snapshot.shootableCulling.visibleIndexes),
    cullingMountedIndexes: numberArrayKey(snapshot.shootableCulling.mountedIndexes),
    cullingPrewarmedIndexes: numberArrayKey(snapshot.shootableCulling.prewarmedIndexes),
    health: numberValue(inventory.health),
    armor: numberValue(inventory.armor),
    armorType: numberValue(inventory.armorType),
    activeWeapon: stringValue(inventory.activeWeapon),
    shells: numberValue(inventory.shells),
    nails: numberValue(inventory.nails),
    rockets: numberValue(inventory.rockets),
    cells: numberValue(inventory.cells),
    weapons: stringArrayKey(inventory.weapons),
    keys: stringArrayKey(inventory.keys),
    powerups: recordKey(inventory.powerups),
    crouching: booleanValue(progress.crouching),
    grounded: booleanValue(movement.grounded),
    groundEntity: numberValue(movement.currentGroundEntity),
    moveKeys: stringArrayKey(movement.keys),
    moveFrameActive: booleanValue(movement.moveFrameActive),
    jumpQueued: booleanValue(movement.jumpQueued),
    activeMoverCount: numberValue(movers.activeMoverCount),
    movers: moverStateKey(movers.movers),
    activeTriggers: numberArrayKey(triggers.activeTriggerIndexes),
    activeTeleporters: numberArrayKey(triggers.activeTeleporterIndexes),
    cooldownTriggers: numberArrayKey(triggers.cooldownTriggerIndexes),
    usedTriggers: numberArrayKey(triggers.usedTriggerIndexes),
    touchedTriggers: triggerTouchedKey(triggers.touched),
    disabledEntities: numberArrayKey(targets.disabledEntityIndexes),
    triggerCounters: triggerCounterKey(targets.triggerCounters),
    hazardEmitters: numberValue(hazards.emitters),
    hazards: numberValue(hazards.hazards),
    viewmodelMounted: booleanValue(viewmodel.mounted),
    viewmodelSource: stringValue(viewmodel.source),
    animationsEnabled: booleanValue(input.animationsEnabled),
    attackDown: booleanValue(input.attackDown),
    debugFly: booleanValue(input.debugFly),
    mobileControls: booleanValue(input.mobileControls),
    domMeshes: numberValue(domMeshes.total),
    domEnemyMeshes: numberValue(domMeshes.enemies),
    domHiddenEnemyFrames: numberValue(domMeshes.hiddenEnemyFrames),
    domLeaves: numberValue(domLeaves.total),
    domEnemyLeaves: numberValue(domLeaves.enemies),
    domEnemyEntityIndexes: numberArrayKey(dom.enemyEntityIndexes),
  };
}

function frameHitchContext(sample: QuakeDebugRecordingSample): Record<string, unknown> {
  const state = recordingStateSummary(sample);
  const memory = asRecord(asRecord(sample.snapshot.performance).memory);
  return {
    mapName: state.mapName,
    leafIndex: state.leafIndex,
    pvsFaceCount: state.pvsFaceCount,
    renderFaceCount: state.renderFaceCount,
    mountedLeaves: state.mountedLeaves,
    mountedSkyTextureLeaves: state.mountedSkyTextureLeaves,
    mountedSpecialTextureLeaves: state.mountedSpecialTextureLeaves,
    visibleEnemies: state.visibleEnemies,
    mountedEnemies: state.mountedEnemies,
    meshHandles: state.meshHandles,
    frameHandles: state.frameHandles,
    worldLastSyncMs: roundNumber(sample.snapshot.world.visibilityChurn.lastSyncMs),
    shootablesLastSyncMs: roundNumber(sample.snapshot.shootables.visibilityChurn.lastSyncMs),
    worldLastChangedLeaves: sample.snapshot.world.visibilityChurn.lastChangedLeaves,
    shootablesLastMountedAdded: sample.snapshot.shootables.visibilityChurn.lastMountedShootablesAdded,
    shootablesLastMountedRemoved: sample.snapshot.shootables.visibilityChurn.lastMountedShootablesRemoved,
    heapUsedMB: bytesToMegabytes(memory.usedJSHeapSize),
    heapTotalMB: bytesToMegabytes(memory.totalJSHeapSize),
    documentHidden: state.documentHidden,
    visibilityState: state.visibilityState,
  };
}

function pickRecord(
  record: Record<string, string | number | boolean | null>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = record[key] ?? null;
  return out;
}

function viewportKey(snapshot: QuakeDebugRecordingSnapshot): string {
  return `${snapshot.viewport.width}x${snapshot.viewport.height}@${snapshot.viewport.devicePixelRatio}` +
    `/visual:${snapshot.viewport.visualWidth ?? "null"}x${snapshot.viewport.visualHeight ?? "null"}`;
}

function moverStateKey(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => {
      const mover = asRecord(entry);
      return [
        numberValue(mover.entityIndex),
        stringValue(mover.classname),
        stringValue(mover.kind),
        stringValue(mover.mode),
        vecKey(mover.offset),
        booleanValue(mover.targetedPlatPrimed),
      ].join(":");
    })
    .sort()
    .join("|");
}

function triggerTouchedKey(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => {
      const trigger = asRecord(entry);
      return [
        numberValue(trigger.entityIndex),
        stringValue(trigger.classname),
        stringValue(trigger.contact),
        stringValue(trigger.target),
        stringValue(trigger.targetname),
      ].join(":");
    })
    .sort()
    .join("|");
}

function triggerCounterKey(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => {
      const counter = asRecord(entry);
      return `${numberValue(counter.entityIndex)}:${numberValue(counter.remaining)}`;
    })
    .sort()
    .join("|");
}

function vecKey(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .slice(0, 3)
    .map((part) => typeof part === "number" && Number.isFinite(part) ? roundNumber(part) : "null")
    .join(",");
}

function numberArrayKey(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .filter((part): part is number => typeof part === "number" && Number.isFinite(part))
    .sort((a, b) => a - b)
    .join(",");
}

function stringArrayKey(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map(String)
    .sort()
    .join(",");
}

function recordKey(value: unknown): string {
  return Object.keys(asRecord(value)).sort().join(",");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? roundNumber(value) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function bytesToMegabytes(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? roundNumber(value / 1048576)
    : null;
}

function roundNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function percentileSorted(values: number[], percentile: number): number {
  if (!values.length) return 0;
  const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * percentile) - 1));
  return values[index] ?? 0;
}

function downloadRecording(recording: QuakeDebugRecording): void {
  const blob = new Blob([JSON.stringify(recording, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = debugRecordingFilename(recording);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function debugRecordingFilename(recording: QuakeDebugRecording): string {
  const mapName = recording.metadata.mapName.replace(/[^a-z0-9_-]/gi, "-") || "map";
  const stamp = recording.metadata.startedAt.replace(/[:.]/g, "-");
  return `cssquake-debug-${mapName}-${stamp}.json`;
}
