import type {
  PolyFirstPersonControlsHandle,
  PolyMeshHandle,
  PolySceneHandle,
  Vec3,
} from "@layoutit/polycss";

import type { QuakePreparedRenderBundle } from "../prepare/scene";
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
const QUAKE_WEAPON_RIGHT_OFFSET = 0.34;
const QUAKE_WEAPON_UP_OFFSET = -0.3;
const QUAKE_WEAPON_BASE_SCALE = 1.82;
const QUAKE_WEAPON_MIN_SCALE = 1.62;
const QUAKE_WEAPON_MAX_SCALE = 2.2;
const QUAKE_WEAPON_SCALE_VIEWPORT_EXPONENT = 0.38;
const QUAKE_WEAPON_REFERENCE_PLAYFIELD_WIDTH = 900;
const QUAKE_WEAPON_MIN_WIDTH_RATIO = 0.78;
const QUAKE_WEAPON_WIDTH_DAMPEN_EXPONENT = 0.65;
const QUAKE_WEAPON_REFERENCE_PLAYFIELD_HEIGHT = 580;
const QUAKE_WEAPON_SCREEN_OFFSET_SCALE = 0.095;
const QUAKE_WEAPON_MIN_SCREEN_OFFSET = -32;
const QUAKE_WEAPON_MAX_SCREEN_OFFSET = 96;
const QUAKE_WEAPON_FIRE_ANIMATION_MS = 360;

export function createQuakeViewmodelController({
  scene,
  controls,
  host,
  hud,
  layer,
  onMount,
}: QuakeViewmodelControllerOptions): QuakeViewmodelController {
  const stage = layer ? createQuakeViewmodelStage(layer) : null;
  let handle: PolyMeshHandle | null = null;
  let viewportSyncFrame = 0;
  let fireForwardKick = 0;
  let fireUpKick = 0;
  let fireAnimationTimer: number | null = null;
  let fireKickTimers: number[] = [];

  function mount(model: QuakeViewmodelModel): void {
    clearFireAnimation();
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
    handle?.remove();
    handle = null;
  }

  function hasWeapon(): boolean {
    return handle !== null;
  }

  function syncTransform(): void {
    if (!handle) return;
    const origin = controls.getOrigin();
    const rotX = scene.camera.state.rotX ?? 88;
    const rotY = scene.camera.state.rotY ?? 270;
    const weaponPitch = rotX - 90;
    const forward = forwardDirection(rotX, rotY);
    const right = rightDirection(rotY);
    const up = normalizeVec3(crossVec3(right, forward));
    const weaponForwardOffset = QUAKE_WEAPON_FORWARD_OFFSET + fireForwardKick;
    const weaponUpOffset = QUAKE_WEAPON_UP_OFFSET + fireUpKick;
    const position: Vec3 = [
      origin[0] + forward[0] * weaponForwardOffset + right[0] * QUAKE_WEAPON_RIGHT_OFFSET + up[0] * weaponUpOffset,
      origin[1] + forward[1] * weaponForwardOffset + right[1] * QUAKE_WEAPON_RIGHT_OFFSET + up[1] * weaponUpOffset,
      origin[2] + forward[2] * weaponForwardOffset + right[2] * QUAKE_WEAPON_RIGHT_OFFSET + up[2] * weaponUpOffset,
    ];
    handle.setTransform({
      position,
      rotation: [weaponPitch, 0, (rotY + 180) % 360],
      scale: weaponScale(),
    });
    syncLayer();
  }

  function queueViewportSync(): void {
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
    }, QUAKE_WEAPON_FIRE_ANIMATION_MS);

    clearKickTimers();
    setKick(-0.46, -0.08);
    fireKickTimers.push(
      window.setTimeout(() => setKick(-0.16, -0.03), 80),
      window.setTimeout(() => setKick(0, 0), 170),
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
      if (handle.element.dataset.nozzleVisible === "true") return;
      handle.element.dataset.nozzleVisible = "true";
    } else {
      if (handle.element.dataset.nozzleVisible === undefined) return;
      delete handle.element.dataset.nozzleVisible;
    }
  }

  function prepareNozzleLeaves(): void {
    if (!handle) return;
    let nozzleGroup = handle.element.querySelector<HTMLElement>("[data-nozzle-group]");
    if (!nozzleGroup) {
      nozzleGroup = handle.element.ownerDocument.createElement("span");
      nozzleGroup.dataset.nozzleGroup = "true";
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

  function syncLayer(): void {
    if (!layer || !stage) return;
    const mainSceneElement = scene.cameraEl.querySelector<HTMLElement>(".polycss-scene");
    const cameraStyle = getComputedStyle(scene.cameraEl);
    const perspective = cameraStyle.perspective && cameraStyle.perspective !== "none"
      ? cameraStyle.perspective
      : scene.camera.perspectiveStyle === "none"
        ? "1000000px"
        : scene.camera.perspectiveStyle;
    setStyleValue(layer, "perspective", perspective);
    setStyleValue(layer, "perspective-origin", cameraStyle.perspectiveOrigin);
    setStyleValue(stage, "top", `calc(50% + ${screenOffset().toFixed(3)}px)`);
    setStyleValue(stage, "transform", mainSceneElement?.style.transform ?? "");
    const zoom = mainSceneElement?.style.getPropertyValue("zoom") ?? "";
    setStyleValue(stage, "zoom", zoom);
  }

  function setStyleValue(element: HTMLElement, property: string, value: string): void {
    if (element.style.getPropertyValue(property) === value) return;
    if (value) {
      element.style.setProperty(property, value);
    } else {
      element.style.removeProperty(property);
    }
  }

  function playfieldHeight(): number {
    const hostRect = host.getBoundingClientRect();
    const hudHeight = hud?.getBoundingClientRect().height ?? 0;
    return Math.max(1, hostRect.height - hudHeight);
  }

  function screenOffset(): number {
    return clampNumber(
      (playfieldHeight() - QUAKE_WEAPON_REFERENCE_PLAYFIELD_HEIGHT) * QUAKE_WEAPON_SCREEN_OFFSET_SCALE,
      QUAKE_WEAPON_MIN_SCREEN_OFFSET,
      QUAKE_WEAPON_MAX_SCREEN_OFFSET,
    );
  }

  function weaponScale(): number {
    const hostRect = host.getBoundingClientRect();
    const playfieldRatio = playfieldHeight() / QUAKE_WEAPON_REFERENCE_PLAYFIELD_HEIGHT;
    const widthRatio = clampNumber(
      hostRect.width / QUAKE_WEAPON_REFERENCE_PLAYFIELD_WIDTH,
      QUAKE_WEAPON_MIN_WIDTH_RATIO,
      1,
    );
    const widthDampen = Math.pow(widthRatio, QUAKE_WEAPON_WIDTH_DAMPEN_EXPONENT);
    return clampNumber(
      QUAKE_WEAPON_BASE_SCALE * Math.pow(playfieldRatio, QUAKE_WEAPON_SCALE_VIEWPORT_EXPONENT) * widthDampen,
      QUAKE_WEAPON_MIN_SCALE,
      QUAKE_WEAPON_MAX_SCALE,
    );
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
