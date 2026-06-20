import {
  polyCssDistanceToWorld,
  worldDistanceToPolyCss,
  type Vec3,
} from "@layoutit/polycss";

import type { QuakeScene } from "../../types/quake";
import { QUAKE_COLLISION_UNIT_SCALE, QUAKE_PLAYER_MINS_Z } from "../constants";
import type { QuakePlayerDamageFeedback } from "../player";
import type { QuakeUrlView } from "../routeState";
import { normalizeQuakeUrlAngle } from "../routeState";
import { quakeRuntimeViewportCenterCss, quakeRuntimeViewportSize } from "../viewport";
import type { QuakeCameraFeedbackFlow, QuakeCameraOriginSyncMode } from "./cameraFeedbackFlow";
import type { QuakeCssView } from "./routeFlow";

const QUAKE_URL_PERSPECTIVE_MAX = 20000;
const QUAKE_URL_ZOOM_MAX = 1000;
const QUAKE_REFERENCE_FOV = 90;

interface QuakeCameraViewScene {
  cameraEl: HTMLElement;
  camera: {
    perspectiveStyle: string;
  };
}

export interface QuakeCameraViewConfig {
  perspective: number;
  zoom: number;
}

export interface QuakeCameraViewFlowOptions {
  cameraFeedback(): QuakeCameraFeedbackFlow;
  getPlayerOrigin(): Vec3;
  host: HTMLElement;
  modelPivot(): { x: number; y: number; z: number };
  playerEyeHeight(): number;
  playerSpawn(spawn: QuakeScene["spawn"]): void;
  renderSupersample: number;
  scene: QuakeCameraViewScene;
  sceneElement: HTMLElement;
  setCameraLookEnabledBodyClass(enabled: boolean): void;
  syncCrosshairTarget(): void;
  syncShootablesVisibility(origin: [number, number, number], force: boolean): void;
  syncViewmodelTransform(): void;
  syncWorldVisibility(force: boolean): void;
}

export interface QuakeCameraViewFlow {
  applySceneCameraAt(origin: Vec3, rotX: number, rotY: number): void;
  cameraPerspectiveStyle(): string;
  clearWeaponViewPunch(syncCamera?: boolean): void;
  compactCameraInlineStyle(): void;
  compactInlineStyle(element: HTMLElement): void;
  currentRenderOrigin(): Vec3;
  cssViewFromUrlView(view: QuakeUrlView): QuakeCssView;
  playDamageViewFeedback(feedback: QuakePlayerDamageFeedback | undefined): void;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  polyToPoint(origin: Vec3): { x: number; y: number; z: number };
  setCamera(spawn: QuakeScene["spawn"]): void;
  setFirstPersonControlsMounted(mounted: boolean): void;
  setLookEnabled(enabled: boolean): void;
  syncCameraOrigin(origin: [number, number, number], mode: QuakeCameraOriginSyncMode): void;
  syncDebugFlyView(origin: [number, number, number]): void;
  syncSceneCamera(rotX: number, rotY: number): void;
  syncSceneCameraAt(origin: Vec3, rotX: number, rotY: number): void;
  syncViewportProjection(): void;
  urlViewFromCssView(view: QuakeCssView): QuakeUrlView;
}

export function createQuakeCameraViewFlow(
  options: QuakeCameraViewFlowOptions,
): QuakeCameraViewFlow {
  const cameraConfig = quakeInitialCameraViewConfig(options.renderSupersample);
  let firstPersonControlsMounted = false;
  let cameraLookEnabled = true;
  let cameraPerspectiveStyle = options.scene.camera.perspectiveStyle;

  function syncViewportProjection(): void {
    const viewport = quakeRuntimeViewportSize();
    const perspective = quakeCameraPerspectiveForViewport(viewport.width, viewport.height, cameraConfig.zoom);
    cameraPerspectiveStyle = `${Number(perspective.toFixed(6))}px`;
    if (firstPersonControlsMounted) {
      options.host.style.setProperty("--polycss-fpv-perspective", cameraPerspectiveStyle);
      options.host.style.removeProperty("perspective");
    } else {
      options.host.style.perspective = cameraPerspectiveStyle;
    }
    const centerX = quakeRuntimeViewportCenterCss(viewport, "x");
    const centerY = quakeRuntimeViewportCenterCss(viewport, "y");
    options.scene.cameraEl.style.perspectiveOrigin = `${centerX} ${centerY}`;
    options.sceneElement.style.left = centerX;
    options.sceneElement.style.top = centerY;
    compactCameraInlineStyle();
  }

  function setFirstPersonControlsMounted(mounted: boolean): void {
    firstPersonControlsMounted = mounted;
  }

  function setLookEnabled(enabled: boolean): void {
    cameraLookEnabled = enabled;
  }

  function compactCameraInlineStyle(): void {
    options.setCameraLookEnabledBodyClass(cameraLookEnabled);
    options.host.style.removeProperty("cursor");
    if (firstPersonControlsMounted) {
      options.host.style.setProperty("--polycss-fpv-perspective", cameraPerspectiveStyle);
      options.host.style.removeProperty("perspective");
    }
    const perspective = options.host.style.getPropertyValue("perspective").trim();
    const perspectiveOrigin = options.host.style.getPropertyValue("perspective-origin").trim();
    const fpvPerspective = options.host.style.getPropertyValue("--polycss-fpv-perspective").trim();
    const declarations = [
      ...(perspective ? [`perspective:${perspective}`] : []),
      ...(perspectiveOrigin ? [`perspective-origin:${perspectiveOrigin}`] : []),
      ...(fpvPerspective ? [`--polycss-fpv-perspective:${fpvPerspective}`] : []),
    ];
    if (declarations.length) {
      options.host.setAttribute("style", declarations.join(";"));
    } else {
      options.host.removeAttribute("style");
    }
  }

  function currentCameraPerspectiveStyle(): string {
    return cameraPerspectiveStyle;
  }

  function compactInlineStyle(element: HTMLElement): void {
    const style = element.getAttribute("style");
    if (!style) return;
    const order = new Map([
      ["transform", 0],
      ["width", 1],
      ["height", 2],
      ["background", 3],
    ]);
    const declarations = style
      .split(";")
      .map((part, index) => {
        const separator = part.indexOf(":");
        if (separator <= 0) return null;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        return value ? { index, name, value } : null;
      })
      .filter((part): part is { index: number; name: string; value: string } => part !== null);
    const nextStyle = declarations
      .sort((a, b) => {
        const aOrder = order.get(a.name);
        const bOrder = order.get(b.name);
        if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
        if (aOrder !== undefined) return -1;
        if (bOrder !== undefined) return 1;
        return a.index - b.index;
      })
      .map((part) => `${part.name}:${part.value}`)
      .join(";");
    if (nextStyle && nextStyle !== style) element.setAttribute("style", nextStyle);
  }

  function pointToPoly(point: { x: number; y: number; z: number }): Vec3 {
    const pivot = options.modelPivot();
    return [
      (point.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
      (point.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
      (point.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
    ];
  }

  function polyToPoint(origin: Vec3): { x: number; y: number; z: number } {
    const pivot = options.modelPivot();
    return {
      x: origin[0] / QUAKE_COLLISION_UNIT_SCALE + pivot.x,
      y: origin[1] / QUAKE_COLLISION_UNIT_SCALE + pivot.y,
      z: origin[2] / QUAKE_COLLISION_UNIT_SCALE + pivot.z,
    };
  }

  function urlViewFromCssView(view: QuakeCssView): QuakeUrlView {
    const point = polyToPoint([
      view.origin[0],
      view.origin[1],
      view.origin[2] - QUAKE_PLAYER_MINS_Z - options.playerEyeHeight(),
    ]);
    return {
      origin: [point.x, point.y, point.z],
      pitch: 90 - view.rotX,
      yaw: normalizeQuakeUrlAngle(view.rotY - 180),
      roll: 0,
    };
  }

  function cssViewFromUrlView(view: QuakeUrlView): QuakeCssView {
    const origin = pointToPoly({
      x: view.origin[0],
      y: view.origin[1],
      z: view.origin[2],
    });
    return {
      origin: [
        origin[0],
        origin[1],
        origin[2] + QUAKE_PLAYER_MINS_Z + options.playerEyeHeight(),
      ],
      rotX: 90 - view.pitch,
      rotY: normalizeQuakeUrlAngle(180 + view.yaw),
    };
  }

  function setCamera(spawn: QuakeScene["spawn"]): void {
    clearWeaponViewPunch(false);
    options.playerSpawn(spawn);
    syncSceneCamera(spawn.rotX, spawn.rotY);
    options.syncCrosshairTarget();
  }

  function syncSceneCamera(rotX: number, rotY: number): void {
    syncSceneCameraAt(options.getPlayerOrigin(), rotX, rotY);
  }

  function syncSceneCameraAt(origin: Vec3, rotX: number, rotY: number): void {
    const feedback = options.cameraFeedback();
    feedback.resetStepSmoothing(origin);
    feedback.applyAt(origin, rotX, rotY);
  }

  function currentRenderOrigin(): Vec3 {
    return options.cameraFeedback().currentRenderOrigin();
  }

  function syncCameraOrigin(origin: [number, number, number], mode: QuakeCameraOriginSyncMode): void {
    options.cameraFeedback().syncOrigin(origin, mode);
  }

  function applySceneCameraAt(origin: Vec3, rotX: number, rotY: number): void {
    options.cameraFeedback().applyAt(origin, rotX, rotY);
  }

  function clearWeaponViewPunch(syncCamera = true): void {
    options.cameraFeedback().clearWeaponViewPunch(syncCamera);
  }

  function playDamageViewFeedback(feedback: QuakePlayerDamageFeedback | undefined): void {
    options.cameraFeedback().playDamageViewFeedback(feedback);
  }

  function syncDebugFlyView(origin: [number, number, number]): void {
    options.syncShootablesVisibility(origin, true);
    options.syncViewmodelTransform();
    options.syncWorldVisibility(true);
    options.syncCrosshairTarget();
  }

  return {
    applySceneCameraAt,
    cameraPerspectiveStyle: currentCameraPerspectiveStyle,
    clearWeaponViewPunch,
    compactCameraInlineStyle,
    compactInlineStyle,
    currentRenderOrigin,
    cssViewFromUrlView,
    playDamageViewFeedback,
    pointToPoly,
    polyToPoint,
    setCamera,
    setFirstPersonControlsMounted,
    setLookEnabled,
    syncCameraOrigin,
    syncDebugFlyView,
    syncSceneCamera,
    syncSceneCameraAt,
    syncViewportProjection,
    urlViewFromCssView,
  };
}

export function quakeInitialCameraViewConfig(renderSupersample: number): QuakeCameraViewConfig {
  const zoom = quakeCameraZoomFromUrl() ?? worldDistanceToPolyCss(0.65) / renderSupersample;
  const { width, height } = quakeRuntimeViewportSize();
  return {
    perspective: quakeCameraPerspectiveForViewport(width, height, zoom),
    zoom,
  };
}

function quakeCameraPerspectiveForViewport(width: number, height: number, zoom: number): number {
  const perspectiveOverride = quakeCameraPerspectiveFromUrl();
  return (
    perspectiveOverride ??
    quakeReferencePerspectiveForViewport(width, height, QUAKE_REFERENCE_FOV) /
      polyCssDistanceToWorld(zoom)
  );
}

function quakeReferencePerspectiveForViewport(width: number, height: number, fov: number): number {
  const aspect = width / Math.max(1, height);
  const fovX = 2 * Math.atan(aspect * 0.75 * Math.tan((fov * Math.PI) / 360));
  return width / (2 * Math.tan(fovX / 2));
}

function quakeCameraPerspectiveFromUrl(): number | null {
  const rawValue = new URLSearchParams(window.location.search).get("perspective");
  if (rawValue === null) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 && value <= QUAKE_URL_PERSPECTIVE_MAX ? value : null;
}

function quakeCameraZoomFromUrl(): number | null {
  const rawValue = new URLSearchParams(window.location.search).get("zoom");
  if (rawValue === null) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 && value <= QUAKE_URL_ZOOM_MAX ? value : null;
}
