import {
  BASE_TILE,
  type PolyFirstPersonControlsHandle,
  type PolySceneHandle,
  type Vec3,
} from "@layoutit/polycss";

import { QUAKE_COLLISION_UNIT_SCALE } from "./constants";
import { crossVec3, normalizeVec3 } from "./math";
import {
  createQuakeViewmodelRasterLayer,
  type QuakeViewmodelRasterLayer,
  type QuakeViewmodelRasterModel,
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
  playFireAnimation(): void;
  clearFireAnimation(): void;
}

export interface QuakeViewmodelSyncOptions {
  stable?: boolean;
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
  perspectiveScale: 0.8,
  stageOffsetPx: QUAKE_WEAPON_REFERENCE_STAGE_OFFSET_PX,
  perspectiveOriginXOffsetPx: 0,
  perspectiveOriginYOffsetPx: 0,
};
const QUAKE_WEAPON_SCREEN_ROT_X = 90;
const QUAKE_WEAPON_MUZZLE_FLASH_MS = 45;
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
  let fireKickTimers: number[] = [];
  let tuning: QuakeResolvedViewmodelTuning = { ...QUAKE_WEAPON_DEFAULT_TUNING };
  let appliedLocalTransform = "";
  let walkBob = 0;
  let walkBobOrigin: Vec3 | null = null;
  let walkBobAt = 0;
  let visible = true;

  if (typeof ResizeObserver !== "undefined") {
    hostResizeObserver = new ResizeObserver(() => {
      invalidateViewportLayer();
      queueViewportSync();
    });
    hostResizeObserver.observe(host);
  }

  function mount(model: QuakeViewmodelModel): void {
    clearFireAnimation();
    resetWalkBob();
    invalidateViewportLayer();
    carrier?.remove();
    if (!stage) throw new Error("Quake viewmodel mount requires a viewmodel stage.");
    carrier = createQuakeViewmodelTransformCarrier(stage);
    appliedLocalTransform = "";
    if (!raster) throw new Error("Quake viewmodel raster mount requires a viewmodel layer.");
    raster.mount(model.rasterModel);
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
    const weapon = debugWeaponTransform(weaponTransform(origin, rotX, rotY, walkBob));
    const sceneElement = scene.cameraEl.querySelector<HTMLElement>(".polycss-scene");
    const stageTransform = weaponStageTransform(sceneElement?.style.transform ?? "");
    const target = roundDebugVec3(weaponStageTarget(origin, rotX, rotY));
    return {
      mounted: carrier !== null,
      tuning: getTuning(),
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
        stageOffsetPx: roundDebugNumber(tuning.stageOffsetPx),
        perspectiveOriginXOffsetPx: roundDebugNumber(tuning.perspectiveOriginXOffsetPx),
        perspectiveOriginYOffsetPx: roundDebugNumber(tuning.perspectiveOriginYOffsetPx),
        baseScale: QUAKE_WEAPON_REFERENCE_BASE_SCALE,
      },
      weapon,
      layer: layer ? elementDebugSnapshot(layer) : null,
      stage: stage ? {
        ...elementDebugSnapshot(stage),
        target,
        lookOffset: roundDebugNumber(weaponPerspectivePx() / BASE_TILE),
        cameraScale: readCameraScale(sceneElement?.style.transform ?? ""),
        cameraTranslateZ: readCameraTranslateZ(sceneElement?.style.transform ?? ""),
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

  function playFireAnimation(): void {
    setNozzleVisible(true);
    if (fireAnimationTimer !== null) window.clearTimeout(fireAnimationTimer);
    fireAnimationTimer = window.setTimeout(() => {
      setNozzleVisible(false);
      fireAnimationTimer = null;
    }, QUAKE_WEAPON_MUZZLE_FLASH_MS);

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
    clearKickTimers();
    fireForwardKick = 0;
    fireUpKick = 0;
    setNozzleVisible(false);
    if (viewportSyncFrame) {
      window.cancelAnimationFrame(viewportSyncFrame);
      viewportSyncFrame = 0;
    }
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
    raster?.setFrameIndex(visible ? 1 : 0);
  }

  function syncRasterLayer(rotY: number): void {
    if (!raster || !layer || !stage || !carrier) return;
    raster.sync({
      width: QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX,
      height: QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX,
      stageLeftPx: QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2,
      stageTopPx: QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX / 2 + tuning.stageOffsetPx,
      stageTransform: stage.style.transform,
      meshTransform: carrier.style.transform,
      perspectivePx: weaponPerspectivePx(),
      perspectiveOriginX: QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2 + tuning.perspectiveOriginXOffsetPx,
      perspectiveOriginY: QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX / 2 + tuning.perspectiveOriginYOffsetPx,
      rotY,
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
    const sceneElement = scene.cameraEl.querySelector<HTMLElement>(".polycss-scene");
    syncViewportLayer();
    setStyleValue(stage, "transform", weaponStageTransform(sceneElement?.style.transform ?? ""));
    const zoom = sceneElement?.style.getPropertyValue("zoom") ?? "";
    setStyleValue(stage, "zoom", zoom);
  }

  function syncViewportLayer(): void {
    if (!layerViewportDirty || !layer || !stage) return;
    const layerScale = refreshWeaponLayerScale();
    setStyleValue(
      layer,
      "left",
      `calc(50% - ${QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2}px + ${tuning.screenXOffsetPx * layerScale}px)`,
    );
    setStyleValue(
      layer,
      "top",
      `calc(100% - ${QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX}px + ${tuning.screenYOffsetPx * layerScale}px)`,
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
      `${QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2 + tuning.perspectiveOriginXOffsetPx}px ` +
        `${QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX / 2 + tuning.perspectiveOriginYOffsetPx}px`,
    );
    setStyleValue(stage, "top", `calc(50% + ${tuning.stageOffsetPx}px)`);
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
    return [
      QUAKE_WEAPON_REFERENCE_BASE_SCALE * tuning.horizontalScale,
      QUAKE_WEAPON_REFERENCE_BASE_SCALE * tuning.verticalScale,
      QUAKE_WEAPON_REFERENCE_BASE_SCALE * tuning.depthScale,
    ];
  }

  function weaponTransform(origin: Vec3, rotX: number, rotY: number, bob: number): QuakeViewmodelDebugSnapshot["weapon"] {
    const forward = forwardDirection(rotX, rotY);
    const right = rightDirection(rotY);
    const up = normalizeVec3(crossVec3(right, forward));
    const forwardOffset = tuning.forwardOffset + fireForwardKick + bob * QUAKE_WEAPON_BOB_FORWARD_SCALE;
    const upOffset = tuning.upOffset + fireUpKick;
    const position: Vec3 = [
      origin[0] + forward[0] * forwardOffset + right[0] * tuning.rightOffset + up[0] * upOffset,
      origin[1] + forward[1] * forwardOffset + right[1] * tuning.rightOffset + up[1] * upOffset,
      origin[2] + forward[2] * forwardOffset + right[2] * tuning.rightOffset + up[2] * upOffset + bob,
    ];
    return {
      position,
      rotation: [rotX - 90, 0, (rotY + 180) % 360],
      scale: weaponScaleVec(),
      forwardOffset,
      rightOffset: tuning.rightOffset,
      upOffset,
      forward,
      right,
      up,
    };
  }

  function weaponPerspectivePx(): number {
    return QUAKE_WEAPON_REFERENCE_SCENE_PERSPECTIVE_PX * tuning.perspectiveScale;
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
    const transforms = [
      Math.abs(tuning.screenScaleX - 1) > 0.001 ? `scaleX(${tuning.screenScaleX})` : "",
      Math.abs(tuning.screenScaleY - 1) > 0.001 ? `scaleY(${tuning.screenScaleY})` : "",
      Number.isFinite(scale) && Math.abs(scale - 1) > 0.001 ? `scale(${scale})` : "",
    ];
    return transforms.filter(Boolean).join(" ");
  }

  function weaponStageTransform(transform: string): string {
    const scale = readCameraScale(transform);
    const translateZ = readCameraTranslateZ(transform);
    const origin = getRenderOrigin?.() ?? controls.getOrigin();
    const rotX = weaponViewRotX(scene.camera.state.rotX ?? 88);
    const rotY = scene.camera.state.rotY ?? 270;
    const target = weaponStageTarget(origin, rotX, rotY);
    const parts = [
      translateZ ? `translateZ(${translateZ}px)` : "",
      `scale(${scale})`,
      `rotateX(${rotX}deg)`,
      `rotate(${rotY}deg)`,
      `translate3d(${-target[1] * BASE_TILE}px, ${-target[0] * BASE_TILE}px, ${-target[2] * BASE_TILE}px)`,
    ];
    return parts.filter(Boolean).join(" ");
  }

  function weaponStageTarget(origin: Vec3, rotX: number, rotY: number): Vec3 {
    const forward = forwardDirection(rotX, rotY);
    const lookOffset = weaponPerspectivePx() / BASE_TILE;
    return [
      origin[0] + forward[0] * lookOffset,
      origin[1] + forward[1] * lookOffset,
      origin[2] + forward[2] * lookOffset,
    ];
  }

  function syncCarrierTransform(weapon: QuakeViewmodelDebugSnapshot["weapon"]): void {
    if (!carrier) return;
    const baseTransform = weaponTransformCss(weapon);
    const localTransform = weaponLocalTransform(tuning);
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

function readCameraScale(transform: string): number {
  const match = /\bscale\(([-+0-9.eE]+)\)/.exec(transform);
  const scale = match ? Number.parseFloat(match[1]) : 1;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function readCameraTranslateZ(transform: string): number {
  const match = /\btranslateZ\(([-+0-9.eE]+)px\)/.exec(transform);
  const translateZ = match ? Number.parseFloat(match[1]) : 0;
  return Number.isFinite(translateZ) ? translateZ : 0;
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

function weaponTransformCss(weapon: QuakeViewmodelDebugSnapshot["weapon"]): string {
  const [x, y, z] = weapon.position;
  const [rotX, rotY, rotZ] = weapon.rotation;
  const [scaleX, scaleY, scaleZ] = weapon.scale;
  return [
    `translate3d(${y * BASE_TILE}px, ${x * BASE_TILE}px, ${z * BASE_TILE}px)`,
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
