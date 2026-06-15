import {
  buildPolySceneTransform,
  polyCssDistanceToWorld,
  type PolyFirstPersonControlsHandle,
  type PolySceneHandle,
  type Vec3,
  worldPositionToPolyCss,
} from "@layoutit/polycss";

import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE } from "./constants";
import { crossVec3, normalizeVec3 } from "./math";
import {
  createQuakeViewmodelRasterLayer,
  type QuakeViewmodelRasterLayer,
  type QuakeViewmodelRasterModel,
  type QuakeViewmodelRasterPostTransform,
} from "./viewmodelRaster";

export interface QuakeViewmodelController {
  mount(model: QuakeViewmodelModel): void;
  remove(): void;
  hasWeapon(): boolean;
  setVisible(visible: boolean): void;
  debugSnapshot(): QuakeViewmodelDebugSnapshot;
  getTuning(): QuakeResolvedViewmodelTuning;
  setTuning(tuning: QuakeViewmodelTuning): QuakeResolvedViewmodelTuning;
  resetTuning(): QuakeResolvedViewmodelTuning;
  syncTransform(options?: QuakeViewmodelSyncOptions): void;
  queueViewportSync(): void;
  playFireAnimation(animation?: QuakeViewmodelFireAnimation): void;
  clearFireAnimation(): void;
}

export interface QuakeViewmodelSyncOptions {
  stable?: boolean;
}

export interface QuakeViewmodelFireAnimation {
  frameIntervalMs: number;
  frames: readonly number[];
  firstFrameMuzzleFlash?: boolean;
}

export interface QuakeViewmodelTuning {
  forwardOffset?: number;
  rightOffset?: number;
  upOffset?: number;
  horizontalScale?: number;
  verticalScale?: number;
  depthScale?: number;
  localYOffsetPx?: number;
  localPitchDeg?: number;
  localPivotXPx?: number;
  localPivotYPx?: number;
  localPivotZPx?: number;
  screenXOffsetPx?: number;
  screenYOffsetPx?: number;
  screenScaleX?: number;
  screenScaleY?: number;
  rasterPostOriginXPx?: number;
  rasterPostOriginYPx?: number;
  rasterPostTranslateXPx?: number;
  rasterPostTranslateYPx?: number;
  rasterPostRotateDeg?: number;
  rasterPostSkewXDeg?: number;
  rasterPostSkewYDeg?: number;
  rasterPostScaleX?: number;
  rasterPostScaleY?: number;
  perspectiveScale?: number;
  stageOffsetPx?: number;
  perspectiveOriginXOffsetPx?: number;
  perspectiveOriginYOffsetPx?: number;
}

export type QuakeResolvedViewmodelTuning = Required<QuakeViewmodelTuning>;

export interface QuakeViewmodelModel {
  source: string;
  rasterModel: QuakeViewmodelRasterModel;
}

export interface QuakeViewmodelDebugSnapshot {
  mounted: boolean;
  source: string | null;
  tuning: QuakeResolvedViewmodelTuning;
  camera: {
    rotX: number;
    rotY: number;
    weaponRotX: number;
    weaponPitch: number;
  };
  origin: Vec3;
  renderOrigin: Vec3;
  bob: {
    walk: number;
    fireForwardKick: number;
    fireUpKick: number;
  };
  viewport: {
    layerScale: number;
    referenceWidth: number;
    referenceHeight: number;
    perspectivePx: number;
    stageOffsetPx: number;
    perspectiveOriginXOffsetPx: number;
    perspectiveOriginYOffsetPx: number;
    baseScale: number;
  };
  weapon: {
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
    forwardOffset: number;
    rightOffset: number;
    upOffset: number;
    forward: Vec3;
    right: Vec3;
    up: Vec3;
  };
  layer: QuakeViewmodelElementDebugSnapshot | null;
  stage: (QuakeViewmodelElementDebugSnapshot & {
    target: Vec3;
    lookOffset: number;
    cameraScale: number;
    cameraTranslateZ: number;
  }) | null;
  mesh: (QuakeViewmodelElementDebugSnapshot & {
    localTransform: string;
    leafCount: number;
    leafTagCounts: Record<"b" | "i" | "s" | "u", number>;
    leafBounds: QuakeViewmodelDebugRect | null;
  }) | null;
}

export interface QuakeViewmodelElementDebugSnapshot {
  id: string | null;
  className: string;
  rect: QuakeViewmodelDebugRect;
  inlineStyle: QuakeViewmodelDebugStyleSnapshot;
  computedStyle: QuakeViewmodelDebugStyleSnapshot;
}

export interface QuakeViewmodelDebugStyleSnapshot {
  left: string;
  top: string;
  width: string;
  height: string;
  transform: string | null;
  transformOrigin: string;
  perspective: string;
  perspectiveOrigin: string;
  zoom: string;
}

export interface QuakeViewmodelDebugRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface QuakeViewmodelControllerOptions {
  scene: PolySceneHandle;
  controls: Pick<PolyFirstPersonControlsHandle, "getOrigin">;
  getRenderOrigin?: () => Vec3;
  host: HTMLElement;
  layer: HTMLElement | null;
}

const QUAKE_WEAPON_FORWARD_OFFSET = 3.1;
const QUAKE_WEAPON_RIGHT_OFFSET = 0;
const QUAKE_WEAPON_UP_OFFSET = -0.3;
const QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX = 1280;
const QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX = 720;
const QUAKE_WEAPON_REFERENCE_SCENE_PERSPECTIVE_PX = 745.1083333333332;
const QUAKE_WEAPON_REFERENCE_STAGE_OFFSET_PX = 30.887;
const QUAKE_WEAPON_REFERENCE_BASE_SCALE = 1.7046145833333335;
const QUAKE_WEAPON_DEFAULT_TUNING: QuakeResolvedViewmodelTuning = {
  forwardOffset: QUAKE_WEAPON_FORWARD_OFFSET,
  rightOffset: QUAKE_WEAPON_RIGHT_OFFSET,
  upOffset: QUAKE_WEAPON_UP_OFFSET,
  horizontalScale: 1.612,
  verticalScale: 0.96,
  depthScale: 1.38,
  localYOffsetPx: -25,
  localPitchDeg: 13,
  localPivotXPx: 0,
  localPivotYPx: 0,
  localPivotZPx: 0,
  screenXOffsetPx: -1,
  screenYOffsetPx: 12.5,
  screenScaleX: 0.98,
  screenScaleY: 1,
  rasterPostOriginXPx: 640,
  rasterPostOriginYPx: 360,
  rasterPostTranslateXPx: 0,
  rasterPostTranslateYPx: 0,
  rasterPostRotateDeg: 0,
  rasterPostSkewXDeg: 0,
  rasterPostSkewYDeg: 0,
  rasterPostScaleX: 1,
  rasterPostScaleY: 1,
  perspectiveScale: 0.8,
  stageOffsetPx: QUAKE_WEAPON_REFERENCE_STAGE_OFFSET_PX,
  perspectiveOriginXOffsetPx: 0,
  perspectiveOriginYOffsetPx: 0,
};
const QUAKE_WEAPON_MODEL_TUNING_OVERRIDES: Record<string, QuakeViewmodelTuning> = {
  "progs/v_axe.mdl": {
    localPitchDeg: 11,
    screenXOffsetPx: -4,
    screenYOffsetPx: 15,
    screenScaleX: 0.866,
    screenScaleY: 0.972,
    // The axe head exposes a small residual canvas/vkQuake alias projection drift.
    rasterPostOriginXPx: 767,
    rasterPostOriginYPx: 455,
    rasterPostTranslateXPx: -1.3,
    rasterPostTranslateYPx: 1.1,
    rasterPostRotateDeg: -1.5,
    rasterPostSkewYDeg: -6.5,
    rasterPostScaleX: 0.97,
    rasterPostScaleY: 1.03,
  },
  "progs/v_shot2.mdl": {
    screenScaleX: 1.149,
    screenScaleY: 1.394,
  },
  "progs/v_nail.mdl": {
    screenScaleX: 0.907,
    screenScaleY: 0.871,
  },
  "progs/v_nail2.mdl": {
    screenScaleX: 0.894,
    screenScaleY: 0.864,
  },
  "progs/v_rock.mdl": {
    screenScaleX: 0.96,
    screenScaleY: 0.971,
  },
  "progs/v_rock2.mdl": {
    screenScaleX: 0.87,
    screenScaleY: 0.835,
  },
  "progs/v_light.mdl": {
    screenScaleX: 0.916,
    screenScaleY: 0.922,
    rasterPostOriginXPx: 637,
    rasterPostOriginYPx: 508,
    rasterPostTranslateXPx: 0.6,
    rasterPostTranslateYPx: 1.8,
    rasterPostScaleX: 0.967,
    rasterPostScaleY: 0.995,
  },
};
const QUAKE_WEAPON_SCREEN_ROT_X = 90;
const QUAKE_WEAPON_MUZZLE_FLASH_MS = 45;
const QUAKE_WEAPON_FIRE_ANIMATION_FRAME_MS = QUAKE_WEAPON_MUZZLE_FLASH_MS;
const QUAKE_WEAPON_DEFAULT_FIRE_ANIMATION: QuakeViewmodelFireAnimation = {
  frameIntervalMs: QUAKE_WEAPON_MUZZLE_FLASH_MS,
  frames: [1],
};
const QUAKE_WEAPON_KICK_SETTLE_MS = 160;
const QUAKE_WEAPON_KICK_RECOVER_MS = 280;
const QUAKE_WEAPON_BOB = 0.02;
const QUAKE_WEAPON_BOB_CYCLE_SECONDS = 0.6;
const QUAKE_WEAPON_BOB_UP = 0.5;
const QUAKE_WEAPON_BOB_FORWARD_SCALE = 0.4;
const QUAKE_WEAPON_BOB_MIN_DT = 1 / 120;
const QUAKE_WEAPON_BOB_STOP_SPEED = 1 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_WEAPON_BOB_TELEPORT_DISTANCE = 128 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_WEAPON_BOB_MIN = -7 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_WEAPON_BOB_MAX = 4 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_WEAPON_SHORT_LANDSCAPE_MAX_HEIGHT_PX = 560;

export function createQuakeViewmodelController({
  scene,
  controls,
  getRenderOrigin,
  host,
  layer,
}: QuakeViewmodelControllerOptions): QuakeViewmodelController {
  const stage = layer ? createQuakeViewmodelStage(layer) : null;
  const raster: QuakeViewmodelRasterLayer | null = layer ? createQuakeViewmodelRasterLayer(layer) : null;
  let carrier: HTMLElement | null = null;
  let viewportSyncFrame = 0;
  let cachedLayerScale = 1;
  let layerViewportDirty = true;
  let hostResizeObserver: ResizeObserver | null = null;
  let fireForwardKick = 0;
  let fireUpKick = 0;
  let fireAnimationTimer: number | null = null;
  let fireFrameTimers: number[] = [];
  let fireKickTimers: number[] = [];
  let tuning: QuakeResolvedViewmodelTuning = { ...QUAKE_WEAPON_DEFAULT_TUNING };
  let appliedLocalTransform = "";
  let walkBob = 0;
  let walkBobOrigin: Vec3 | null = null;
  let walkBobAt = 0;
  let mountedSource: string | null = null;
  let visible = true;

  if (typeof ResizeObserver !== "undefined") {
    hostResizeObserver = new ResizeObserver(() => {
      invalidateViewportLayer();
      queueViewportSync();
    });
    hostResizeObserver.observe(host);
  }

  function mount(model: QuakeViewmodelModel): void {
    const source = normalizedViewmodelSource(model.source);
    if (carrier && mountedSource === source) {
      syncTransform();
      return;
    }
    clearFireAnimation();
    resetWalkBob();
    invalidateViewportLayer();
    carrier?.remove();
    if (!stage) throw new Error("Quake viewmodel mount requires a viewmodel stage.");
    carrier = createQuakeViewmodelTransformCarrier(stage);
    appliedLocalTransform = "";
    if (!raster) throw new Error("Quake viewmodel raster mount requires a viewmodel layer.");
    raster.mount(model.rasterModel);
    mountedSource = source;
    syncTransform();
    setNozzleVisible(false);
  }

  function remove(): void {
    clearFireAnimation();
    resetWalkBob();
    carrier?.remove();
    carrier = null;
    raster?.remove();
    appliedLocalTransform = "";
    mountedSource = null;
  }

  function hasWeapon(): boolean {
    return carrier !== null;
  }

  function setVisible(nextVisible: boolean): void {
    visible = nextVisible;
    if (layer) layer.hidden = !visible;
  }

  function debugSnapshot(): QuakeViewmodelDebugSnapshot {
    const movementOrigin = controls.getOrigin();
    const origin = getRenderOrigin?.() ?? movementOrigin;
    const rotX = weaponViewRotX(scene.camera.state.rotX ?? 88);
    const rotY = scene.camera.state.rotY ?? 270;
    const currentTuning = activeTuning();
    const weapon = debugWeaponTransform(weaponTransform(origin, rotX, rotY, walkBob));
    const stageTransform = weaponStageTransform();
    const target = roundDebugVec3(weaponStageTarget(origin, rotX, rotY));
    return {
      mounted: carrier !== null,
      source: mountedSource,
      tuning: currentTuning,
      camera: {
        rotX: scene.camera.state.rotX ?? 88,
        rotY,
        weaponRotX: rotX,
        weaponPitch: rotX - 90,
      },
      origin: [movementOrigin[0], movementOrigin[1], movementOrigin[2]],
      renderOrigin: [origin[0], origin[1], origin[2]],
      bob: {
        walk: roundDebugNumber(walkBob),
        fireForwardKick: roundDebugNumber(fireForwardKick),
        fireUpKick: roundDebugNumber(fireUpKick),
      },
      viewport: {
        layerScale: roundDebugNumber(cachedLayerScale),
        referenceWidth: QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX,
        referenceHeight: QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX,
        perspectivePx: roundDebugNumber(weaponPerspectivePx()),
        stageOffsetPx: roundDebugNumber(currentTuning.stageOffsetPx),
        perspectiveOriginXOffsetPx: roundDebugNumber(currentTuning.perspectiveOriginXOffsetPx),
        perspectiveOriginYOffsetPx: roundDebugNumber(currentTuning.perspectiveOriginYOffsetPx),
        baseScale: QUAKE_WEAPON_REFERENCE_BASE_SCALE,
      },
      weapon,
      layer: layer ? elementDebugSnapshot(layer) : null,
      stage: stage ? {
        ...elementDebugSnapshot(stage),
        target,
        lookOffset: roundDebugNumber(polyCssDistanceToWorld(weaponPerspectivePx())),
        cameraScale: roundDebugNumber(polyCssDistanceToWorld(scene.camera.state.zoom ?? 1)),
        cameraTranslateZ: roundDebugNumber(-(scene.camera.state.distance ?? 0)),
        inlineStyle: {
          ...elementInlineStyleSnapshot(stage),
          transform: stageTransform || null,
        },
      } : null,
      mesh: carrier ? {
        ...elementDebugSnapshot(carrier),
        localTransform: appliedLocalTransform,
        ...meshLeafDebugSnapshot(carrier),
      } : null,
    };
  }

  function getTuning(): QuakeResolvedViewmodelTuning {
    return { ...tuning };
  }

  function activeTuning(): QuakeResolvedViewmodelTuning {
    const override = mountedSource ? QUAKE_WEAPON_MODEL_TUNING_OVERRIDES[mountedSource] : undefined;
    return override ? sanitizeViewmodelTuning(override, tuning) : tuning;
  }

  function setTuning(next: QuakeViewmodelTuning): QuakeResolvedViewmodelTuning {
    tuning = sanitizeViewmodelTuning(next, tuning);
    invalidateViewportLayer();
    syncTransform({ stable: true });
    return getTuning();
  }

  function resetTuning(): QuakeResolvedViewmodelTuning {
    tuning = { ...QUAKE_WEAPON_DEFAULT_TUNING };
    invalidateViewportLayer();
    syncTransform({ stable: true });
    return getTuning();
  }

  function syncTransform(options: QuakeViewmodelSyncOptions = {}): void {
    if (!carrier) return;
    if (options.stable) resetWalkBob();
    const movementOrigin = controls.getOrigin();
    const origin = getRenderOrigin?.() ?? movementOrigin;
    const bob = updateWalkBob(movementOrigin);
    const rotX = weaponViewRotX(scene.camera.state.rotX ?? 88);
    const rotY = scene.camera.state.rotY ?? 270;
    const weapon = weaponTransform(origin, rotX, rotY, bob);
    syncCarrierTransform(weapon);
    syncLayer();
    syncRasterLayer(rotY);
  }

  function queueViewportSync(): void {
    invalidateViewportLayer();
    if (viewportSyncFrame) return;
    viewportSyncFrame = window.requestAnimationFrame(() => {
      viewportSyncFrame = 0;
      syncTransform();
    });
  }

  function playFireAnimation(animation: QuakeViewmodelFireAnimation = QUAKE_WEAPON_DEFAULT_FIRE_ANIMATION): void {
    const frames = sanitizeFireAnimationFrames(animation.frames);
    const frameIntervalMs = Math.min(
      sanitizeFireAnimationFrameInterval(animation.frameIntervalMs),
      QUAKE_WEAPON_FIRE_ANIMATION_FRAME_MS,
    );
    const firstFrameDurationMs = animation.firstFrameMuzzleFlash
      ? Math.min(QUAKE_WEAPON_MUZZLE_FLASH_MS, frameIntervalMs)
      : frameIntervalMs;
    clearFrameTimers();
    setWeaponFrameIndex(frames[0] ?? 1);
    frames.slice(1).forEach((frame, index) => {
      fireFrameTimers.push(window.setTimeout(() => setWeaponFrameIndex(frame), firstFrameDurationMs + frameIntervalMs * index));
    });
    if (fireAnimationTimer !== null) window.clearTimeout(fireAnimationTimer);
    fireAnimationTimer = window.setTimeout(() => {
      setWeaponFrameIndex(0);
      fireAnimationTimer = null;
    }, firstFrameDurationMs + frameIntervalMs * Math.max(0, frames.length - 1));

    clearKickTimers();
    setKick(-0.52, -0.1);
    fireKickTimers.push(
      window.setTimeout(() => setKick(-0.22, -0.04), QUAKE_WEAPON_KICK_SETTLE_MS),
      window.setTimeout(() => setKick(0, 0), QUAKE_WEAPON_KICK_RECOVER_MS),
    );
  }

  function clearFireAnimation(): void {
    if (fireAnimationTimer !== null) {
      window.clearTimeout(fireAnimationTimer);
      fireAnimationTimer = null;
    }
    clearFrameTimers();
    clearKickTimers();
    fireForwardKick = 0;
    fireUpKick = 0;
    setNozzleVisible(false);
    if (viewportSyncFrame) {
      window.cancelAnimationFrame(viewportSyncFrame);
      viewportSyncFrame = 0;
    }
  }

  function clearFrameTimers(): void {
    for (const timer of fireFrameTimers) window.clearTimeout(timer);
    fireFrameTimers = [];
  }

  function clearKickTimers(): void {
    for (const timer of fireKickTimers) window.clearTimeout(timer);
    fireKickTimers = [];
  }

  function setKick(forward: number, up: number): void {
    fireForwardKick = forward;
    fireUpKick = up;
    syncTransform();
  }

  function setNozzleVisible(visible: boolean): void {
    setWeaponFrameIndex(visible ? 1 : 0);
  }

  function setWeaponFrameIndex(frameIndex: number): void {
    raster?.setFrameIndex(frameIndex);
  }

  function syncRasterLayer(rotY: number): void {
    if (!raster || !layer || !stage || !carrier) return;
    const currentTuning = activeTuning();
    raster.sync({
      width: QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX,
      height: QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX,
      stageLeftPx: QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2,
      stageTopPx: QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX / 2 + currentTuning.stageOffsetPx,
      stageTransform: stage.style.transform,
      meshTransform: carrier.style.transform,
      perspectivePx: weaponPerspectivePx(),
      perspectiveOriginX: QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2 + currentTuning.perspectiveOriginXOffsetPx,
      perspectiveOriginY: QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX / 2 + currentTuning.perspectiveOriginYOffsetPx,
      rotY,
      postTransform: weaponRasterPostTransform(currentTuning),
    });
  }

  function updateWalkBob(origin: Vec3): number {
    const now = performance.now();
    if (!walkBobOrigin || !Number.isFinite(now)) {
      syncWalkBobOrigin(origin, now);
      walkBob = 0;
      return walkBob;
    }

    const elapsed = (now - walkBobAt) / 1000;
    const horizontalDistance = Math.hypot(origin[0] - walkBobOrigin[0], origin[1] - walkBobOrigin[1]);
    syncWalkBobOrigin(origin, now);
    if (horizontalDistance <= COLLISION_EPSILON && elapsed < QUAKE_WEAPON_BOB_MIN_DT) {
      return walkBob;
    }
    if (
      !Number.isFinite(elapsed) ||
      elapsed <= 0 ||
      elapsed > 0.5 ||
      horizontalDistance > QUAKE_WEAPON_BOB_TELEPORT_DISTANCE
    ) {
      walkBob = 0;
      return walkBob;
    }

    const speed = horizontalDistance / Math.max(elapsed, QUAKE_WEAPON_BOB_MIN_DT);
    if (speed <= QUAKE_WEAPON_BOB_STOP_SPEED) {
      walkBob = 0;
      return walkBob;
    }

    const cycle = bobCycle((now / 1000) % QUAKE_WEAPON_BOB_CYCLE_SECONDS);
    const baseBob = speed * QUAKE_WEAPON_BOB;
    walkBob = clampNumber(
      baseBob * 0.3 + baseBob * 0.7 * Math.sin(cycle),
      QUAKE_WEAPON_BOB_MIN,
      QUAKE_WEAPON_BOB_MAX,
    );
    return walkBob;
  }

  function bobCycle(cycleTime: number): number {
    const cycle = cycleTime / QUAKE_WEAPON_BOB_CYCLE_SECONDS;
    return cycle < QUAKE_WEAPON_BOB_UP
      ? Math.PI * cycle / QUAKE_WEAPON_BOB_UP
      : Math.PI + Math.PI * (cycle - QUAKE_WEAPON_BOB_UP) / (1 - QUAKE_WEAPON_BOB_UP);
  }

  function syncWalkBobOrigin(origin: Vec3, now: number): void {
    walkBobOrigin = [origin[0], origin[1], origin[2]];
    walkBobAt = now;
  }

  function resetWalkBob(): void {
    walkBob = 0;
    walkBobOrigin = null;
    walkBobAt = 0;
  }

  function syncLayer(): void {
    if (!layer || !stage) return;
    const sceneElement = scene.sceneElement;
    syncViewportLayer();
    setStyleValue(stage, "transform", weaponStageTransform());
    const zoom = sceneElement.style.getPropertyValue("zoom");
    setStyleValue(stage, "zoom", zoom);
  }

  function syncViewportLayer(): void {
    if (!layerViewportDirty || !layer || !stage) return;
    const currentTuning = activeTuning();
    const layerScale = refreshWeaponLayerScale();
    setStyleValue(
      layer,
      "left",
      `calc(50% - ${QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2}px + ${currentTuning.screenXOffsetPx * layerScale}px)`,
    );
    setStyleValue(
      layer,
      "top",
      `calc(100% - ${QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX}px + ${currentTuning.screenYOffsetPx * layerScale}px)`,
    );
    setStyleValue(layer, "right", "auto");
    setStyleValue(layer, "bottom", "auto");
    setStyleValue(layer, "width", `${QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX}px`);
    setStyleValue(layer, "height", `${QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX}px`);
    setStyleValue(layer, "transform-origin", "50% 100%");
    setStyleValue(layer, "transform", weaponLayerTransform(layerScale));
    setStyleValue(layer, "perspective", `${weaponPerspectivePx()}px`);
    setStyleValue(
      layer,
      "perspective-origin",
      `${QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2 + currentTuning.perspectiveOriginXOffsetPx}px ` +
        `${QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX / 2 + currentTuning.perspectiveOriginYOffsetPx}px`,
    );
    setStyleValue(stage, "top", `calc(50% + ${currentTuning.stageOffsetPx}px)`);
    layerViewportDirty = false;
  }

  function invalidateViewportLayer(): void {
    layerViewportDirty = true;
  }

  function setStyleValue(element: HTMLElement, property: string, value: string): void {
    if (element.style.getPropertyValue(property) === value) return;
    if (value) {
      element.style.setProperty(property, value);
    } else {
      element.style.removeProperty(property);
    }
  }

  function weaponScaleVec(): Vec3 {
    const currentTuning = activeTuning();
    return [
      QUAKE_WEAPON_REFERENCE_BASE_SCALE * currentTuning.horizontalScale,
      QUAKE_WEAPON_REFERENCE_BASE_SCALE * currentTuning.verticalScale,
      QUAKE_WEAPON_REFERENCE_BASE_SCALE * currentTuning.depthScale,
    ];
  }

  function weaponTransform(origin: Vec3, rotX: number, rotY: number, bob: number): QuakeViewmodelDebugSnapshot["weapon"] {
    const currentTuning = activeTuning();
    const forward = forwardDirection(rotX, rotY);
    const right = rightDirection(rotY);
    const up = normalizeVec3(crossVec3(right, forward));
    const forwardOffset = currentTuning.forwardOffset + fireForwardKick + bob * QUAKE_WEAPON_BOB_FORWARD_SCALE;
    const upOffset = currentTuning.upOffset + fireUpKick;
    const position: Vec3 = [
      origin[0] + forward[0] * forwardOffset + right[0] * currentTuning.rightOffset + up[0] * upOffset,
      origin[1] + forward[1] * forwardOffset + right[1] * currentTuning.rightOffset + up[1] * upOffset,
      origin[2] + forward[2] * forwardOffset + right[2] * currentTuning.rightOffset + up[2] * upOffset + bob,
    ];
    return {
      position,
      rotation: [rotX - 90, 0, (rotY + 180) % 360],
      scale: weaponScaleVec(),
      forwardOffset,
      rightOffset: currentTuning.rightOffset,
      upOffset,
      forward,
      right,
      up,
    };
  }

  function weaponPerspectivePx(): number {
    return QUAKE_WEAPON_REFERENCE_SCENE_PERSPECTIVE_PX * activeTuning().perspectiveScale;
  }

  function refreshWeaponLayerScale(): number {
    const hostRect = host.getBoundingClientRect();
    const viewportWidth = hostRect.width || window.innerWidth;
    const viewportHeight = hostRect.height || window.innerHeight;
    const heightScale = viewportHeight / QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX;
    if (viewportWidth <= viewportHeight || viewportHeight > QUAKE_WEAPON_SHORT_LANDSCAPE_MAX_HEIGHT_PX) {
      cachedLayerScale = heightScale;
      return cachedLayerScale;
    }
    cachedLayerScale = Math.max(heightScale, viewportWidth / QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX);
    return cachedLayerScale;
  }

  function weaponLayerTransform(scale: number): string {
    const currentTuning = activeTuning();
    const transforms = [
      Math.abs(currentTuning.screenScaleX - 1) > 0.001 ? `scaleX(${currentTuning.screenScaleX})` : "",
      Math.abs(currentTuning.screenScaleY - 1) > 0.001 ? `scaleY(${currentTuning.screenScaleY})` : "",
      Number.isFinite(scale) && Math.abs(scale - 1) > 0.001 ? `scale(${scale})` : "",
    ];
    return transforms.filter(Boolean).join(" ");
  }

  function weaponStageTransform(): string {
    const origin = getRenderOrigin?.() ?? controls.getOrigin();
    const rotX = weaponViewRotX(scene.camera.state.rotX ?? 88);
    const rotY = scene.camera.state.rotY ?? 270;
    return buildPolySceneTransform({
      target: weaponStageTarget(origin, rotX, rotY),
      rotX,
      rotY,
      zoom: scene.camera.state.zoom ?? 1,
      distance: scene.camera.state.distance ?? 0,
    });
  }

  function weaponStageTarget(origin: Vec3, rotX: number, rotY: number): Vec3 {
    const forward = forwardDirection(rotX, rotY);
    const lookOffset = polyCssDistanceToWorld(weaponPerspectivePx());
    return [
      origin[0] + forward[0] * lookOffset,
      origin[1] + forward[1] * lookOffset,
      origin[2] + forward[2] * lookOffset,
    ];
  }

  function syncCarrierTransform(weapon: QuakeViewmodelDebugSnapshot["weapon"]): void {
    if (!carrier) return;
    const baseTransform = weaponTransformCss(weapon);
    const localTransform = weaponLocalTransform(activeTuning());
    appliedLocalTransform = localTransform;
    const nextTransform = baseTransform ? `${baseTransform} ${localTransform}` : localTransform;
    if (carrier.style.transform !== nextTransform) {
      carrier.style.transform = nextTransform;
    }
  }

  return {
    mount,
    remove,
    hasWeapon,
    setVisible,
    debugSnapshot,
    getTuning,
    setTuning,
    resetTuning,
    syncTransform,
    queueViewportSync,
    playFireAnimation,
    clearFireAnimation,
  };
}

function weaponViewRotX(rotX: number): number {
  if (!Number.isFinite(rotX)) return QUAKE_WEAPON_SCREEN_ROT_X;
  return QUAKE_WEAPON_SCREEN_ROT_X;
}

function normalizedViewmodelSource(source: string): string {
  return source.trim().toLowerCase();
}

function sanitizeFireAnimationFrames(frames: readonly number[]): number[] {
  const sanitized = frames
    .map((frame) => Math.max(0, Math.floor(frame)))
    .filter((frame) => Number.isFinite(frame));
  return sanitized.length ? sanitized : [1];
}

function sanitizeFireAnimationFrameInterval(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, value) : QUAKE_WEAPON_MUZZLE_FLASH_MS;
}

function sanitizeViewmodelTuning(
  next: QuakeViewmodelTuning,
  current: QuakeResolvedViewmodelTuning,
): QuakeResolvedViewmodelTuning {
  const sanitized = { ...current };
  for (const key of Object.keys(QUAKE_WEAPON_DEFAULT_TUNING) as Array<keyof QuakeResolvedViewmodelTuning>) {
    const value = next[key];
    if (typeof value === "number" && Number.isFinite(value)) sanitized[key] = value;
  }
  return sanitized;
}

function weaponLocalTransform(tuning: QuakeResolvedViewmodelTuning): string {
  const hasPivot =
    Math.abs(tuning.localPivotXPx) > 0.001 ||
    Math.abs(tuning.localPivotYPx) > 0.001 ||
    Math.abs(tuning.localPivotZPx) > 0.001;
  return [
    `translate3d(0px, ${tuning.localYOffsetPx}px, 0px)`,
    hasPivot ? `translate3d(${tuning.localPivotXPx}px, ${tuning.localPivotYPx}px, ${tuning.localPivotZPx}px)` : "",
    `rotateX(${tuning.localPitchDeg}deg)`,
    hasPivot ? `translate3d(${-tuning.localPivotXPx}px, ${-tuning.localPivotYPx}px, ${-tuning.localPivotZPx}px)` : "",
  ].filter(Boolean).join(" ");
}

function weaponRasterPostTransform(tuning: QuakeResolvedViewmodelTuning): QuakeViewmodelRasterPostTransform | null {
  if (
    Math.abs(tuning.rasterPostTranslateXPx) <= 0.001 &&
    Math.abs(tuning.rasterPostTranslateYPx) <= 0.001 &&
    Math.abs(tuning.rasterPostRotateDeg) <= 0.001 &&
    Math.abs(tuning.rasterPostSkewXDeg) <= 0.001 &&
    Math.abs(tuning.rasterPostSkewYDeg) <= 0.001 &&
    Math.abs(tuning.rasterPostScaleX - 1) <= 0.001 &&
    Math.abs(tuning.rasterPostScaleY - 1) <= 0.001
  ) {
    return null;
  }
  return {
    originX: tuning.rasterPostOriginXPx,
    originY: tuning.rasterPostOriginYPx,
    translateX: tuning.rasterPostTranslateXPx,
    translateY: tuning.rasterPostTranslateYPx,
    rotateDeg: tuning.rasterPostRotateDeg,
    skewXDeg: tuning.rasterPostSkewXDeg,
    skewYDeg: tuning.rasterPostSkewYDeg,
    scaleX: tuning.rasterPostScaleX,
    scaleY: tuning.rasterPostScaleY,
  };
}

function weaponTransformCss(weapon: QuakeViewmodelDebugSnapshot["weapon"]): string {
  const [x, y, z] = weapon.position;
  const cssPosition = worldPositionToPolyCss([x, y, z]);
  const [rotX, rotY, rotZ] = weapon.rotation;
  const [scaleX, scaleY, scaleZ] = weapon.scale;
  return [
    `translate3d(${cssPosition[0]}px, ${cssPosition[1]}px, ${cssPosition[2]}px)`,
    Math.abs(rotX) > 0.001 ? `rotateY(${-rotX}deg)` : "",
    Math.abs(rotY) > 0.001 ? `rotateX(${rotY}deg)` : "",
    Math.abs(rotZ) > 0.001 ? `rotateZ(${-rotZ}deg)` : "",
    `scale3d(${scaleX}, ${scaleY}, ${scaleZ})`,
  ].filter(Boolean).join(" ");
}

function elementDebugSnapshot(element: HTMLElement): QuakeViewmodelElementDebugSnapshot {
  return {
    id: element.id || null,
    className: element.className,
    rect: debugRect(element.getBoundingClientRect()),
    inlineStyle: elementInlineStyleSnapshot(element),
    computedStyle: elementComputedStyleSnapshot(element),
  };
}

function elementInlineStyleSnapshot(element: HTMLElement): QuakeViewmodelDebugStyleSnapshot {
  return styleDebugSnapshot(element.style);
}

function elementComputedStyleSnapshot(element: HTMLElement): QuakeViewmodelDebugStyleSnapshot {
  return styleDebugSnapshot(getComputedStyle(element));
}

function styleDebugSnapshot(style: CSSStyleDeclaration): QuakeViewmodelDebugStyleSnapshot {
  return {
    left: style.getPropertyValue("left"),
    top: style.getPropertyValue("top"),
    width: style.getPropertyValue("width"),
    height: style.getPropertyValue("height"),
    transform: debugTransformValue(style.getPropertyValue("transform")),
    transformOrigin: style.getPropertyValue("transform-origin"),
    perspective: style.getPropertyValue("perspective"),
    perspectiveOrigin: style.getPropertyValue("perspective-origin"),
    zoom: style.getPropertyValue("zoom"),
  };
}

function debugTransformValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed && trimmed !== "none" ? trimmed : null;
}

function meshLeafDebugSnapshot(element: HTMLElement): {
  leafCount: number;
  leafTagCounts: Record<"b" | "i" | "s" | "u", number>;
  leafBounds: QuakeViewmodelDebugRect | null;
} {
  const leaves = Array.from(element.querySelectorAll<HTMLElement>("b,i,s,u"));
  const leafTagCounts: Record<"b" | "i" | "s" | "u", number> = { b: 0, i: 0, s: 0, u: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const leaf of leaves) {
    const tag = leaf.tagName.toLowerCase();
    if (tag === "b" || tag === "i" || tag === "s" || tag === "u") leafTagCounts[tag] += 1;
    const rect = leaf.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return {
    leafCount: leaves.length,
    leafTagCounts,
    leafBounds: right > left && bottom > top
      ? debugRectFromEdges(left, top, right, bottom)
      : null,
  };
}

function debugRect(rect: DOMRect): QuakeViewmodelDebugRect {
  return debugRectFromEdges(rect.left, rect.top, rect.right, rect.bottom);
}

function debugRectFromEdges(left: number, top: number, right: number, bottom: number): QuakeViewmodelDebugRect {
  return {
    x: roundDebugNumber(left),
    y: roundDebugNumber(top),
    width: roundDebugNumber(right - left),
    height: roundDebugNumber(bottom - top),
    right: roundDebugNumber(right),
    bottom: roundDebugNumber(bottom),
  };
}

function roundDebugVec3(value: Vec3): Vec3 {
  return [
    roundDebugNumber(value[0]),
    roundDebugNumber(value[1]),
    roundDebugNumber(value[2]),
  ];
}

function debugWeaponTransform(
  weapon: QuakeViewmodelDebugSnapshot["weapon"],
): QuakeViewmodelDebugSnapshot["weapon"] {
  return {
    position: roundDebugVec3(weapon.position),
    rotation: roundDebugVec3(weapon.rotation),
    scale: roundDebugVec3(weapon.scale),
    forwardOffset: roundDebugNumber(weapon.forwardOffset),
    rightOffset: roundDebugNumber(weapon.rightOffset),
    upOffset: roundDebugNumber(weapon.upOffset),
    forward: roundDebugVec3(weapon.forward),
    right: roundDebugVec3(weapon.right),
    up: roundDebugVec3(weapon.up),
  };
}

function roundDebugNumber(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function createQuakeViewmodelStage(layer: HTMLElement): HTMLElement {
  const stage = document.createElement("div");
  stage.id = "quake-viewmodel-stage";
  stage.className = "polycss-scene";
  layer.appendChild(stage);
  return stage;
}

function createQuakeViewmodelTransformCarrier(stage: HTMLElement): HTMLElement {
  const carrier = stage.ownerDocument.createElement("div");
  carrier.className = "polycss-mesh viewmodel quake-viewmodel-transform";
  stage.appendChild(carrier);
  return carrier;
}

function forwardDirection(rotX: number, rotY: number): Vec3 {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  return [
    -Math.sin(rx) * Math.cos(ry),
    -Math.sin(rx) * Math.sin(ry),
    -Math.cos(rx),
  ];
}

function rightDirection(rotY: number): Vec3 {
  const ry = (rotY * Math.PI) / 180;
  return [-Math.sin(ry), Math.cos(ry), 0];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
