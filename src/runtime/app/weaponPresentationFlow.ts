import type { ParseResult, Polygon, PolyMeshHandle, PolySceneHandle, Vec3 } from "@layoutit/polycss";

import { COLLISION_EPSILON } from "../constants";
import type { QuakeWeaponId } from "../hud";
import { addVec3, crossVec3, normalizeVec3, subtractVec3 } from "../math";
import {
  quakePickupModelRenderBundle,
  quakePickupModelRenderBundleFrameSet,
  type QuakePickupModelLibrary,
} from "../pickups";
import {
  mountQuakeRenderBundleFrameSetMesh,
  mountQuakeRenderBundleMesh,
  stripPolyMeshMetadata,
} from "../renderBundleMesh";
import type { QuakeViewmodelFireAnimation } from "../viewmodel";
import type {
  QuakeWeaponLightningBeamVisual,
  QuakeWeaponProjectileVisualHandle,
} from "../weapons";

const QUAKE_CROSSHAIR_HIT_MS = 110;
const QUAKE_LIGHTNING_BEAM_VISUAL_MS = 180;
const QUAKE_LIGHTNING_BEAM_INNER_RADIUS = 0.018;
const QUAKE_LIGHTNING_BEAM_OUTER_RADIUS = 0.045;

export interface QuakeWeaponPresentationFlowOptions {
  addBodyClasses(...classNames: string[]): void;
  currentModelLibrary(): QuakePickupModelLibrary | null;
  playWeaponFireFeedback(animation?: QuakeViewmodelFireAnimation): void;
  removeBodyClasses(...classNames: string[]): void;
  scene: Pick<PolySceneHandle, "add">;
  sceneElement: HTMLElement;
}

export interface QuakeWeaponPresentationFlow {
  addProjectileMesh(modelPath: string, weapon: QuakeWeaponId): QuakeWeaponProjectileVisualHandle | null;
  clear(): void;
  clearCrosshairHit(): void;
  clearLightningBeams(): void;
  flashCrosshairHit(): void;
  playFireAnimation(animation?: QuakeViewmodelFireAnimation): void;
  showLightningBeam(beam: QuakeWeaponLightningBeamVisual): void;
}

export function createQuakeWeaponPresentationFlow(
  options: QuakeWeaponPresentationFlowOptions,
): QuakeWeaponPresentationFlow {
  const lightningBeamHandles = new Set<PolyMeshHandle>();
  const lightningBeamTimers = new Map<PolyMeshHandle, number>();
  let crosshairHitTimer: number | null = null;

  function addProjectileMesh(
    modelPath: string,
    weapon: QuakeWeaponId,
  ): QuakeWeaponProjectileVisualHandle | null {
    const model = options.currentModelLibrary()?.models[modelPath];
    if (!model) return null;
    const frameSet = quakePickupModelRenderBundleFrameSet(model);
    const handle = frameSet
      ? mountQuakeRenderBundleFrameSetMesh(options.sceneElement, frameSet, 0)
      : mountQuakeRenderBundleMesh(options.sceneElement, quakePickupModelRenderBundle(model, 0));
    if (!handle) return null;
    handle.element.classList.add("player-projectile", `player-projectile-${weapon}`);
    stripPolyMeshMetadata(handle.element);
    return {
      handle,
      scale: model.renderScale ? 1 / model.renderScale : 1,
    };
  }

  function showLightningBeam(beam: QuakeWeaponLightningBeamVisual): void {
    if (beam.tempEntity !== "TE_LIGHTNING2") return;
    const polygons = lightningBeamPolygons(beam.start, beam.end);
    if (!polygons.length) return;
    const handle = options.scene.add(makeParseResult(polygons), {
      merge: false,
      meshResolution: "lossless",
      excludeFromAutoCenter: true,
    });
    handle.element.classList.add("player-lightning-beam", `player-lightning-beam-${beam.weapon}`);
    handle.element.dataset.tempEntity = beam.tempEntity;
    stripPolyMeshMetadata(handle.element);
    lightningBeamHandles.add(handle);
    const timer = window.setTimeout(() => removeLightningBeam(handle), QUAKE_LIGHTNING_BEAM_VISUAL_MS);
    lightningBeamTimers.set(handle, timer);
  }

  function removeLightningBeam(handle: PolyMeshHandle): void {
    const timer = lightningBeamTimers.get(handle);
    if (timer !== undefined) window.clearTimeout(timer);
    lightningBeamTimers.delete(handle);
    if (!lightningBeamHandles.delete(handle)) return;
    handle.remove();
  }

  function clearLightningBeams(): void {
    for (const handle of [...lightningBeamHandles]) removeLightningBeam(handle);
  }

  function flashCrosshairHit(): void {
    clearCrosshairHitTimer();
    options.addBodyClasses("quake-crosshair-hit");
    crosshairHitTimer = window.setTimeout(clearCrosshairHit, QUAKE_CROSSHAIR_HIT_MS);
  }

  function clearCrosshairHit(): void {
    clearCrosshairHitTimer();
    options.removeBodyClasses("quake-crosshair-hit");
  }

  function clearCrosshairHitTimer(): void {
    if (crosshairHitTimer === null) return;
    window.clearTimeout(crosshairHitTimer);
    crosshairHitTimer = null;
  }

  function clear(): void {
    clearCrosshairHit();
    clearLightningBeams();
  }

  return {
    addProjectileMesh,
    clear,
    clearCrosshairHit,
    clearLightningBeams,
    flashCrosshairHit,
    playFireAnimation: options.playWeaponFireFeedback,
    showLightningBeam,
  };
}

function lightningBeamPolygons(start: Vec3, end: Vec3): Polygon[] {
  const delta = subtractVec3(end, start);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (length <= COLLISION_EPSILON) return [];
  const direction = normalizeVec3(delta);
  const reference: Vec3 = Math.abs(direction[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const side = scaleVec3(normalizeVec3(crossVec3(direction, reference)), QUAKE_LIGHTNING_BEAM_OUTER_RADIUS);
  const up = scaleVec3(normalizeVec3(crossVec3(side, direction)), QUAKE_LIGHTNING_BEAM_INNER_RADIUS);
  return [
    lightningBeamQuad(start, end, side, "#d9ffff"),
    lightningBeamQuad(start, end, up, "#66f8ff"),
  ];
}

function lightningBeamQuad(start: Vec3, end: Vec3, offset: Vec3, color: string): Polygon {
  return {
    color,
    vertices: [
      subtractVec3(start, offset),
      subtractVec3(end, offset),
      addVec3(end, offset),
      addVec3(start, offset),
    ],
  };
}

function scaleVec3(value: Vec3, scale: number): Vec3 {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

function makeParseResult(polygons: Polygon[]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => undefined };
}
