import {
  BASE_TILE,
  type PolyFirstPersonControlsHandle,
  type PolyMeshHandle,
  type PolySceneHandle,
  type Vec3,
} from "@layoutit/polycss";

import type { QuakePreparedRenderBundle } from "../prepare/scene";
import { QUAKE_COLLISION_UNIT_SCALE } from "./constants";
import { crossVec3, normalizeVec3 } from "./math";
import { mountQuakeRenderBundleMesh, stripPolyMeshMetadata } from "./renderBundleMesh";

export interface QuakeViewmodelController {
  mount(model: QuakeViewmodelModel): void;
  remove(): void;
  hasWeapon(): boolean;
  syncTransform(): void;
  queueViewportSync(): void;
  playFireAnimation(): void;
  clearFireAnimation(): void;
}

export interface QuakeViewmodelModel {
  renderBundle: QuakePreparedRenderBundle;
}

export interface QuakeViewmodelControllerOptions {
  scene: PolySceneHandle;
  controls: Pick<PolyFirstPersonControlsHandle, "getOrigin">;
  host: HTMLElement;
  hud: HTMLElement | null;
  layer: HTMLElement | null;
  onMount?(handle: PolyMeshHandle): void;
}

const QUAKE_WEAPON_FORWARD_OFFSET = 4.88;
const QUAKE_WEAPON_RIGHT_OFFSET = 0;
const QUAKE_WEAPON_UP_OFFSET = -0.3;
const QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX = 1280;
const QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX = 720;
const QUAKE_WEAPON_REFERENCE_SCENE_PERSPECTIVE_PX = 745.1083333333332;
const QUAKE_WEAPON_REFERENCE_STAGE_OFFSET_PX = 30.887;
const QUAKE_WEAPON_REFERENCE_BASE_SCALE = 1.7046145833333335;
const QUAKE_WEAPON_HORIZONTAL_SCALE = 1.612;
const QUAKE_WEAPON_VERTICAL_SCALE = 0.96;
const QUAKE_WEAPON_DEPTH_SCALE = 1.38;
const QUAKE_WEAPON_LOCAL_Y_OFFSET_PX = -25;
const QUAKE_WEAPON_LOCAL_PITCH_DEG = 13;
const QUAKE_WEAPON_SCREEN_X_OFFSET_PX = 0;
const QUAKE_WEAPON_PERSPECTIVE_SCALE = 1.08;
const QUAKE_WEAPON_MIN_ROT_X = 10;
const QUAKE_WEAPON_MAX_ROT_X = 170;
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
  host,
  layer,
  onMount,
}: QuakeViewmodelControllerOptions): QuakeViewmodelController {
  const stage = layer ? createQuakeViewmodelStage(layer) : null;
  let handle: PolyMeshHandle | null = null;
  let viewportSyncFrame = 0;
  let cachedLayerScale = 1;
  let layerViewportDirty = true;
  let hostResizeObserver: ResizeObserver | null = null;
  let fireForwardKick = 0;
  let fireUpKick = 0;
  let fireAnimationTimer: number | null = null;
  let fireKickTimers: number[] = [];
  let walkBob = 0;
  let walkBobOrigin: Vec3 | null = null;
  let walkBobAt = 0;

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
    handle?.remove();
    if (!stage) throw new Error("Quake viewmodel render bundle mount requires a viewmodel stage.");
    handle = mountQuakeRenderBundleMesh(stage, model.renderBundle);
    handle.element.classList.add("viewmodel");
    stripPolyMeshMetadata(handle.element);
    onMount?.(handle);
    prepareNozzleLeaves();
    syncTransform();
    setNozzleVisible(false);
  }

  function remove(): void {
    clearFireAnimation();
    resetWalkBob();
    handle?.remove();
    handle = null;
  }

  function hasWeapon(): boolean {
    return handle !== null;
  }

  function syncTransform(): void {
    if (!handle) return;
    const origin = controls.getOrigin();
    const bob = updateWalkBob(origin);
    const rotX = weaponViewRotX(scene.camera.state.rotX ?? 88);
    const rotY = scene.camera.state.rotY ?? 270;
    const weaponPitch = rotX - 90;
    const forward = forwardDirection(rotX, rotY);
    const right = rightDirection(rotY);
    const up = normalizeVec3(crossVec3(right, forward));
    const weaponForwardOffset = QUAKE_WEAPON_FORWARD_OFFSET + fireForwardKick + bob * QUAKE_WEAPON_BOB_FORWARD_SCALE;
    const weaponUpOffset = QUAKE_WEAPON_UP_OFFSET + fireUpKick;
    const position: Vec3 = [
      origin[0] + forward[0] * weaponForwardOffset + right[0] * QUAKE_WEAPON_RIGHT_OFFSET + up[0] * weaponUpOffset,
      origin[1] + forward[1] * weaponForwardOffset + right[1] * QUAKE_WEAPON_RIGHT_OFFSET + up[1] * weaponUpOffset,
      origin[2] + forward[2] * weaponForwardOffset + right[2] * QUAKE_WEAPON_RIGHT_OFFSET + up[2] * weaponUpOffset + bob,
    ];
    handle.setTransform({
      position,
      rotation: [weaponPitch, 0, (rotY + 180) % 360],
      scale: weaponScaleVec(),
    });
    syncLocalWeaponTransform();
    syncLayer();
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
    if (!handle) return;
    if (visible) {
      if (handle.element.classList.contains("quake-nozzle-visible")) return;
      handle.element.classList.add("quake-nozzle-visible");
    } else {
      if (!handle.element.classList.contains("quake-nozzle-visible")) return;
      handle.element.classList.remove("quake-nozzle-visible");
    }
  }

  function prepareNozzleLeaves(): void {
    if (!handle) return;
    let nozzleGroup = handle.element.querySelector<HTMLElement>(".quake-nozzle-group");
    if (!nozzleGroup) {
      nozzleGroup = handle.element.ownerDocument.createElement("span");
      nozzleGroup.className = "quake-nozzle-group";
    }
    for (const leaf of handle.element.querySelectorAll<HTMLElement>("[data-weapon]")) {
      leaf.removeAttribute("data-weapon");
    }
    for (const leaf of handle.element.querySelectorAll<HTMLElement>("[data-nozzle]")) {
      nozzleGroup.appendChild(leaf);
      leaf.removeAttribute("data-nozzle");
    }
    handle.element.appendChild(nozzleGroup);
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
      `calc(50% - ${QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2}px + ${QUAKE_WEAPON_SCREEN_X_OFFSET_PX * layerScale}px)`,
    );
    setStyleValue(layer, "top", `calc(100% - ${QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX}px)`);
    setStyleValue(layer, "right", "auto");
    setStyleValue(layer, "bottom", "auto");
    setStyleValue(layer, "width", `${QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX}px`);
    setStyleValue(layer, "height", `${QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX}px`);
    setStyleValue(layer, "transform-origin", "50% 100%");
    setStyleValue(layer, "transform", weaponLayerTransform(layerScale));
    setStyleValue(layer, "perspective", weaponPerspective());
    setStyleValue(
      layer,
      "perspective-origin",
      `${QUAKE_WEAPON_REFERENCE_VIEWPORT_WIDTH_PX / 2}px ${QUAKE_WEAPON_REFERENCE_VIEWPORT_HEIGHT_PX / 2}px`,
    );
    setStyleValue(stage, "top", `calc(50% + ${QUAKE_WEAPON_REFERENCE_STAGE_OFFSET_PX}px)`);
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
      QUAKE_WEAPON_REFERENCE_BASE_SCALE * QUAKE_WEAPON_HORIZONTAL_SCALE,
      QUAKE_WEAPON_REFERENCE_BASE_SCALE * QUAKE_WEAPON_VERTICAL_SCALE,
      QUAKE_WEAPON_REFERENCE_BASE_SCALE * QUAKE_WEAPON_DEPTH_SCALE,
    ];
  }

  function weaponPerspective(): string {
    return `${QUAKE_WEAPON_REFERENCE_SCENE_PERSPECTIVE_PX * QUAKE_WEAPON_PERSPECTIVE_SCALE}px`;
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
    return Number.isFinite(scale) && Math.abs(scale - 1) > 0.001 ? `scale(${scale})` : "";
  }

  function weaponStageTransform(transform: string): string {
    const scale = readCameraScale(transform);
    const translateZ = readCameraTranslateZ(transform);
    const origin = controls.getOrigin();
    const rotX = weaponViewRotX(scene.camera.state.rotX ?? 88);
    const rotY = scene.camera.state.rotY ?? 270;
    const forward = forwardDirection(rotX, rotY);
    const lookOffset = QUAKE_WEAPON_REFERENCE_SCENE_PERSPECTIVE_PX / BASE_TILE;
    const target: Vec3 = [
      origin[0] + forward[0] * lookOffset,
      origin[1] + forward[1] * lookOffset,
      origin[2] + forward[2] * lookOffset,
    ];
    const parts = [
      translateZ ? `translateZ(${translateZ}px)` : "",
      `scale(${scale})`,
      `rotateX(${rotX}deg)`,
      `rotate(${rotY}deg)`,
      `translate3d(${-target[1] * BASE_TILE}px, ${-target[0] * BASE_TILE}px, ${-target[2] * BASE_TILE}px)`,
    ];
    return parts.filter(Boolean).join(" ");
  }

  function syncLocalWeaponTransform(): void {
    if (!handle) return;
    const localTransform = weaponLocalTransform();
    let baseTransform = handle.element.style.transform.trim();
    while (baseTransform.endsWith(localTransform)) {
      baseTransform = baseTransform.slice(0, -localTransform.length).trim();
    }
    const nextTransform = baseTransform ? `${baseTransform} ${localTransform}` : localTransform;
    if (handle.element.style.transform !== nextTransform) {
      handle.element.style.transform = nextTransform;
    }
  }

  return {
    mount,
    remove,
    hasWeapon,
    syncTransform,
    queueViewportSync,
    playFireAnimation,
    clearFireAnimation,
  };
}

function weaponViewRotX(rotX: number): number {
  return clampNumber(rotX, QUAKE_WEAPON_MIN_ROT_X, QUAKE_WEAPON_MAX_ROT_X);
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

function weaponLocalTransform(): string {
  return [
    `translate3d(0px, ${QUAKE_WEAPON_LOCAL_Y_OFFSET_PX}px, 0px)`,
    `rotateX(${QUAKE_WEAPON_LOCAL_PITCH_DEG}deg)`,
  ].join(" ");
}

function createQuakeViewmodelStage(layer: HTMLElement): HTMLElement {
  const stage = document.createElement("div");
  stage.id = "quake-viewmodel-stage";
  stage.className = "polycss-scene";
  layer.appendChild(stage);
  return stage;
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
