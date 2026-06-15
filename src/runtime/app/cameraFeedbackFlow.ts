import { polyCssDistanceToWorld, type Vec3 } from "@layoutit/polycss";

import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import type { QuakePlayerDamageFeedback } from "../player";
import type { QuakeViewmodelFireAnimation } from "../viewmodel";

const QUAKE_WEAPON_VIEW_PUNCH_DEG = 2;
const QUAKE_WEAPON_VIEW_PUNCH_MAX_DEG = 4;
const QUAKE_WEAPON_VIEW_PUNCH_DECAY_MS = 55;
const QUAKE_WEAPON_VIEW_PUNCH_EPSILON_DEG = 0.001;
const QUAKE_WEAPON_VIEW_PUNCH_EXTERNAL_EPSILON_DEG = 0.05;
export const QUAKE_CAMERA_ROT_X_MIN = 5;
export const QUAKE_CAMERA_ROT_X_MAX = 175;
const QUAKE_CAMERA_STEP_SMOOTH_SPEED = 80 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_CAMERA_STEP_SMOOTH_MAX_OFFSET = 12 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_CAMERA_STEP_SMOOTH_DT_CLAMP = 0.05;
const QUAKE_DAMAGE_VIEW_PITCH_SCALE = 0.035;
const QUAKE_DAMAGE_VIEW_PITCH_MAX_DEG = 2;

export type QuakeCameraOriginSyncMode = "move" | "reset" | "smooth-step";

export type QuakeRenderCameraOriginPolicy = (origin: Vec3, rotX: number, rotY: number) => Vec3;

interface QuakeCameraFeedbackScene {
  camera: {
    perspectiveStyle: string;
    state: {
      rotX?: number;
      rotY?: number;
    };
    update(update: {
      rotX: number;
      rotY: number;
      target: Vec3;
    }): void;
  };
  applyCamera(): void;
}

interface QuakeCameraFeedbackControls {
  getOrigin(): Vec3;
}

interface QuakeCameraFeedbackViewmodel {
  playFireAnimation(animation?: QuakeViewmodelFireAnimation): void;
  syncTransform(): void;
}

export interface QuakeCameraFeedbackFlowOptions {
  canUseGameplayInput(): boolean;
  cameraPerspectiveStyle(): string;
  controls: QuakeCameraFeedbackControls;
  hasCurrentScene(): boolean;
  isDisposed(): boolean;
  queueCrosshairTargetSync(): void;
  renderOriginPolicy?: QuakeRenderCameraOriginPolicy | null;
  scene: QuakeCameraFeedbackScene;
  viewmodel: QuakeCameraFeedbackViewmodel;
}

export interface QuakeCameraFeedbackFlow {
  applyAt(origin: Vec3, rotX: number, rotY: number): void;
  clearWeaponViewPunch(syncCamera?: boolean): void;
  currentRenderOrigin(): Vec3;
  dispose(): void;
  playDamageViewFeedback(feedback: QuakePlayerDamageFeedback | undefined): void;
  playWeaponFireFeedback(animation?: QuakeViewmodelFireAnimation): void;
  resetStepSmoothing(origin: Vec3): void;
  syncOrigin(origin: Vec3, mode: QuakeCameraOriginSyncMode): void;
}

export function createQuakeCameraFeedbackFlow(
  options: QuakeCameraFeedbackFlowOptions,
): QuakeCameraFeedbackFlow {
  let cameraRenderOrigin: Vec3 = [0, 0, 1.72];
  let cameraAppliedRenderOrigin: Vec3 = [0, 0, 1.72];
  let cameraStepSmoothFrame = 0;
  let cameraStepSmoothAt = 0;
  let weaponViewPunchFrame = 0;
  let weaponViewPunchOffset = 0;
  let weaponViewPunchAt = 0;
  let weaponViewPunchBaseRotX: number | null = null;

  function currentRenderOrigin(): Vec3 {
    return cameraAppliedRenderOrigin;
  }

  function syncOrigin(origin: Vec3, mode: QuakeCameraOriginSyncMode): void {
    if (mode === "reset") {
      resetStepSmoothing(origin);
      return;
    }

    const active = Math.abs(cameraRenderOrigin[2] - origin[2]) > COLLISION_EPSILON || cameraStepSmoothFrame !== 0;
    if (!active && mode !== "smooth-step") {
      cameraRenderOrigin = [origin[0], origin[1], origin[2]];
      cameraStepSmoothAt = 0;
      return;
    }

    const now = performance.now();
    if (active) advanceStepSmoothing(origin[2], now);
    else cameraStepSmoothAt = now;
    if (mode === "smooth-step") {
      cameraRenderOrigin[2] = clampNumber(
        cameraRenderOrigin[2],
        origin[2] - QUAKE_CAMERA_STEP_SMOOTH_MAX_OFFSET,
        origin[2],
      );
    }
    cameraRenderOrigin[0] = origin[0];
    cameraRenderOrigin[1] = origin[1];
    applyAt(
      cameraRenderOrigin,
      options.scene.camera.state.rotX ?? 88,
      options.scene.camera.state.rotY ?? 270,
    );
    options.viewmodel.syncTransform();
    if (Math.abs(cameraRenderOrigin[2] - origin[2]) > COLLISION_EPSILON) {
      scheduleStepSmoothingFrame();
    } else {
      cancelStepSmoothingFrame();
      cameraStepSmoothAt = 0;
    }
  }

  function scheduleStepSmoothingFrame(): void {
    if (options.isDisposed() || cameraStepSmoothFrame) return;
    cameraStepSmoothFrame = window.requestAnimationFrame(runStepSmoothingFrame);
  }

  function runStepSmoothingFrame(now: number): void {
    cameraStepSmoothFrame = 0;
    const origin = options.controls.getOrigin();
    cameraRenderOrigin[0] = origin[0];
    cameraRenderOrigin[1] = origin[1];
    const active = advanceStepSmoothing(origin[2], now);
    applyAt(
      cameraRenderOrigin,
      options.scene.camera.state.rotX ?? 88,
      options.scene.camera.state.rotY ?? 270,
    );
    options.viewmodel.syncTransform();
    if (active) scheduleStepSmoothingFrame();
  }

  function advanceStepSmoothing(originZ: number, now: number): boolean {
    const dz = originZ - cameraRenderOrigin[2];
    if (dz <= COLLISION_EPSILON) {
      cameraRenderOrigin[2] = originZ;
      cameraStepSmoothAt = 0;
      return false;
    }
    const dt = Math.min(
      QUAKE_CAMERA_STEP_SMOOTH_DT_CLAMP,
      cameraStepSmoothAt ? Math.max(0, (now - cameraStepSmoothAt) / 1000) : 0,
    );
    cameraStepSmoothAt = now;
    const step = QUAKE_CAMERA_STEP_SMOOTH_SPEED * dt;
    if (step > 0) {
      cameraRenderOrigin[2] = Math.min(originZ, cameraRenderOrigin[2] + step);
    }
    if (originZ - cameraRenderOrigin[2] > QUAKE_CAMERA_STEP_SMOOTH_MAX_OFFSET) {
      cameraRenderOrigin[2] = originZ - QUAKE_CAMERA_STEP_SMOOTH_MAX_OFFSET;
    }
    return originZ - cameraRenderOrigin[2] > COLLISION_EPSILON;
  }

  function resetStepSmoothing(origin: Vec3): void {
    cancelStepSmoothingFrame();
    cameraStepSmoothAt = 0;
    cameraRenderOrigin = [origin[0], origin[1], origin[2]];
    cameraAppliedRenderOrigin = [origin[0], origin[1], origin[2]];
  }

  function applyAt(origin: Vec3, rotX: number, rotY: number): void {
    const renderOrigin = options.renderOriginPolicy?.(origin, rotX, rotY) ?? origin;
    cameraAppliedRenderOrigin = [renderOrigin[0], renderOrigin[1], renderOrigin[2]];
    const forward = quakeCameraForwardDirection(rotX, rotY);
    const distance = lookOffset();
    options.scene.camera.update({
      rotX,
      rotY,
      target: [
        renderOrigin[0] + forward[0] * distance,
        renderOrigin[1] + forward[1] * distance,
        renderOrigin[2] + forward[2] * distance,
      ],
    });
    options.scene.applyCamera();
  }

  function playWeaponFireFeedback(animation?: QuakeViewmodelFireAnimation): void {
    options.viewmodel.playFireAnimation(animation);
    punchWeaponView();
  }

  function punchWeaponView(amount = QUAKE_WEAPON_VIEW_PUNCH_DEG, now = performance.now()): void {
    const nextOffset = Math.min(QUAKE_WEAPON_VIEW_PUNCH_MAX_DEG, weaponViewPunchOffset + Math.max(0, amount));
    syncWeaponViewPunchOffset(nextOffset);
    weaponViewPunchAt = now;
    scheduleWeaponViewPunchFrame();
  }

  function scheduleWeaponViewPunchFrame(): void {
    if (options.isDisposed() || weaponViewPunchFrame || weaponViewPunchOffset <= 0) return;
    weaponViewPunchFrame = window.requestAnimationFrame(runWeaponViewPunchFrame);
  }

  function runWeaponViewPunchFrame(now: number): void {
    weaponViewPunchFrame = 0;
    if (weaponViewPunchOffset <= 0) return;
    if (!options.canUseGameplayInput()) {
      clearWeaponViewPunch();
      return;
    }

    const dt = Math.min(100, Math.max(0, now - weaponViewPunchAt || 16.7));
    weaponViewPunchAt = now;
    const nextOffset = weaponViewPunchOffset * Math.exp(-dt / QUAKE_WEAPON_VIEW_PUNCH_DECAY_MS);
    const snappedOffset = nextOffset <= QUAKE_WEAPON_VIEW_PUNCH_EPSILON_DEG ? 0 : nextOffset;
    syncWeaponViewPunchOffset(snappedOffset);
    if (weaponViewPunchOffset > 0) {
      scheduleWeaponViewPunchFrame();
    } else {
      options.queueCrosshairTargetSync();
    }
  }

  function clearWeaponViewPunch(syncCamera = true): void {
    if (weaponViewPunchFrame) {
      window.cancelAnimationFrame(weaponViewPunchFrame);
      weaponViewPunchFrame = 0;
    }
    if (syncCamera && Math.abs(weaponViewPunchOffset) > QUAKE_WEAPON_VIEW_PUNCH_EPSILON_DEG && options.hasCurrentScene()) {
      syncWeaponViewPunchOffset(0);
    }
    weaponViewPunchOffset = 0;
    weaponViewPunchAt = 0;
    weaponViewPunchBaseRotX = null;
  }

  function syncWeaponViewPunchOffset(nextOffset: number): void {
    const currentRotX = clampNumber(options.scene.camera.state.rotX ?? 88, QUAKE_CAMERA_ROT_X_MIN, QUAKE_CAMERA_ROT_X_MAX);
    const rotY = options.scene.camera.state.rotY ?? 270;
    let baseRotX = weaponViewPunchBaseRotX;
    if (baseRotX === null) {
      baseRotX = currentRotX - weaponViewPunchOffset;
    } else if (Math.abs(currentRotX - (baseRotX + weaponViewPunchOffset)) > QUAKE_WEAPON_VIEW_PUNCH_EXTERNAL_EPSILON_DEG) {
      baseRotX = currentRotX - weaponViewPunchOffset;
    }

    baseRotX = clampNumber(baseRotX, QUAKE_CAMERA_ROT_X_MIN, QUAKE_CAMERA_ROT_X_MAX);
    weaponViewPunchOffset = nextOffset;
    weaponViewPunchBaseRotX = nextOffset > 0 ? baseRotX : null;
    applyAt(
      cameraRenderOrigin,
      clampNumber(baseRotX + nextOffset, QUAKE_CAMERA_ROT_X_MIN, QUAKE_CAMERA_ROT_X_MAX),
      rotY,
    );
  }

  function playDamageViewFeedback(feedback: QuakePlayerDamageFeedback | undefined): void {
    const amount = Math.max(10, feedback?.amount ?? 10);
    punchWeaponView(Math.min(QUAKE_DAMAGE_VIEW_PITCH_MAX_DEG, amount * QUAKE_DAMAGE_VIEW_PITCH_SCALE));
  }

  function lookOffset(): number {
    const perspectiveStyle = options.cameraPerspectiveStyle() || options.scene.camera.perspectiveStyle;
    const value = Number.parseFloat(perspectiveStyle);
    return polyCssDistanceToWorld(Number.isFinite(value) && value > 0 ? value : 900);
  }

  function cancelStepSmoothingFrame(): void {
    if (!cameraStepSmoothFrame) return;
    window.cancelAnimationFrame(cameraStepSmoothFrame);
    cameraStepSmoothFrame = 0;
  }

  function dispose(): void {
    clearWeaponViewPunch(false);
    cancelStepSmoothingFrame();
  }

  return {
    applyAt,
    clearWeaponViewPunch,
    currentRenderOrigin,
    dispose,
    playDamageViewFeedback,
    playWeaponFireFeedback,
    resetStepSmoothing,
    syncOrigin,
  };
}

export function quakeCameraForwardDirection(rotX: number, rotY: number): Vec3 {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  return [
    -Math.sin(rx) * Math.cos(ry),
    -Math.sin(rx) * Math.sin(ry),
    -Math.cos(rx),
  ];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
