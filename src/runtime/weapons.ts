import type { PolyFirstPersonControlsHandle, PolySceneHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../prepared/preparedScene";
import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE } from "./constants";
import type { QuakeCollisionWorld, QuakeUseTrace } from "./collision";
import { quakeEntityNumber } from "./entities";
import { normalizeVec3 } from "./math";

export interface QuakeWeaponShootableTarget {
  entity: QuakeEntity;
  dead: boolean;
  bounds: {
    min: Vec3;
    max: Vec3;
  };
}

export interface QuakeWeaponsController {
  reset(): void;
  fire(): void;
  viewTraceAtCrosshair(range: number): QuakeUseTrace | null;
  weaponTraceAtCrosshair(): QuakeUseTrace | null;
  traceIsActionable(trace: QuakeUseTrace | null): trace is QuakeUseTrace;
  traceIsShootable(trace: QuakeUseTrace | null): trace is QuakeUseTrace;
}

export interface QuakeWeaponsControllerOptions {
  scene: PolySceneHandle;
  controls: Pick<PolyFirstPersonControlsHandle, "getOrigin">;
  canUseGameplayInput(): boolean;
  hasViewmodel(): boolean;
  getCollisionWorld(): QuakeCollisionWorld | null;
  getEntities(): ReadonlyMap<number, QuakeEntity>;
  getShootables(): Iterable<QuakeWeaponShootableTarget>;
  getShells(): number;
  consumeShell(): void;
  syncHud(): void;
  playFireAnimation(): void;
  destroyShootable(entityIndex: number): boolean;
  activateEntity(entityIndex: number): void;
  syncCrosshairTarget(): void;
}

interface QuakeViewRay {
  origin: Vec3;
  direction: Vec3;
  end: Vec3;
  range: number;
}

const QUAKE_WEAPON_FIRE_COOLDOWN_MS = 420;
const QUAKE_WEAPON_TRACE_RANGE = 2048 * QUAKE_COLLISION_UNIT_SCALE;

export function createQuakeWeaponsController({
  scene,
  controls,
  canUseGameplayInput,
  hasViewmodel,
  getCollisionWorld,
  getEntities,
  getShootables,
  getShells,
  consumeShell,
  syncHud,
  playFireAnimation,
  destroyShootable,
  activateEntity,
  syncCrosshairTarget,
}: QuakeWeaponsControllerOptions): QuakeWeaponsController {
  let lastFireAt = -Infinity;

  function reset(): void {
    lastFireAt = -Infinity;
  }

  function fire(): void {
    if (!canUseGameplayInput() || !hasViewmodel()) return;
    const now = performance.now();
    if (now - lastFireAt < QUAKE_WEAPON_FIRE_COOLDOWN_MS) return;
    if (getShells() <= 0) return;
    lastFireAt = now;
    consumeShell();
    syncHud();
    playFireAnimation();
    handleWeaponHit(weaponTraceAtCrosshair());
    syncCrosshairTarget();
  }

  function viewTraceAtCrosshair(range: number): QuakeUseTrace | null {
    const collisionWorld = getCollisionWorld();
    if (!collisionWorld?.traceUse) return null;
    const ray = viewRayAtCrosshair(range);
    return collisionWorld.traceUse(ray.origin, ray.end);
  }

  function weaponTraceAtCrosshair(): QuakeUseTrace | null {
    const ray = viewRayAtCrosshair(QUAKE_WEAPON_TRACE_RANGE);
    const worldTrace = getCollisionWorld()?.traceUse?.(ray.origin, ray.end) ?? null;
    const shootableTrace = traceShootables(ray, worldTrace?.fraction ?? 1);
    return shootableTrace ?? worldTrace;
  }

  function traceIsActionable(trace: QuakeUseTrace | null): trace is QuakeUseTrace {
    if (trace?.classname !== "func_button" || trace.entityIndex === undefined) return false;
    const entity = getEntities().get(trace.entityIndex);
    return Boolean(entity && !isShootableButton(entity));
  }

  function traceIsShootable(trace: QuakeUseTrace | null): trace is QuakeUseTrace {
    if (trace?.entityIndex === undefined) return false;
    for (const shootable of getShootables()) {
      if (!shootable.dead && shootable.entity.index === trace.entityIndex) return true;
    }
    const entity = getEntities().get(trace.entityIndex);
    return Boolean(entity && isShootableButton(entity));
  }

  function viewRayAtCrosshair(range: number): QuakeViewRay {
    const origin = controls.getOrigin();
    const rotX = scene.camera.state.rotX ?? 88;
    const rotY = scene.camera.state.rotY ?? 270;
    const direction = normalizeVec3(forwardDirection(rotX, rotY));
    return {
      origin,
      direction,
      end: [
        origin[0] + direction[0] * range,
        origin[1] + direction[1] * range,
        origin[2] + direction[2] * range,
      ],
      range,
    };
  }

  function traceShootables(ray: QuakeViewRay, maxFraction: number): QuakeUseTrace | null {
    let best: QuakeUseTrace | null = null;
    for (const shootable of getShootables()) {
      if (shootable.dead) continue;
      const trace = rayTraceAabb(ray, shootable.bounds.min, shootable.bounds.max, maxFraction, shootable.entity);
      if (!trace) continue;
      if (!best || trace.fraction < best.fraction) best = trace;
    }
    return best;
  }

  function handleWeaponHit(trace: QuakeUseTrace | null): boolean {
    if (trace?.entityIndex === undefined) return false;
    for (const shootable of getShootables()) {
      if (shootable.entity.index !== trace.entityIndex) continue;
      destroyShootable(trace.entityIndex);
      return true;
    }
    const entity = getEntities().get(trace.entityIndex);
    if (!entity) return false;
    if (isShootableButton(entity)) {
      activateEntity(entity.index);
      return true;
    }
    return false;
  }

  return {
    reset,
    fire,
    viewTraceAtCrosshair,
    weaponTraceAtCrosshair,
    traceIsActionable,
    traceIsShootable,
  };
}

function rayTraceAabb(
  ray: QuakeViewRay,
  min: Vec3,
  max: Vec3,
  maxFraction: number,
  entity: QuakeEntity,
): QuakeUseTrace | null {
  let enter = 0;
  let exit = ray.range;
  let normal: Vec3 | null = null;

  for (let axis = 0; axis < 3; axis++) {
    const origin = ray.origin[axis];
    const direction = ray.direction[axis];
    if (Math.abs(direction) <= COLLISION_EPSILON) {
      if (origin < min[axis] || origin > max[axis]) return null;
      continue;
    }
    let near = (min[axis] - origin) / direction;
    let far = (max[axis] - origin) / direction;
    const nearNormal: Vec3 = [0, 0, 0];
    nearNormal[axis] = direction > 0 ? -1 : 1;
    if (near > far) {
      const temp = near;
      near = far;
      far = temp;
      nearNormal[axis] *= -1;
    }
    if (near > enter) {
      enter = near;
      normal = nearNormal;
    }
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }

  if (exit < 0 || enter > ray.range) return null;
  const distance = Math.max(0, enter);
  const fraction = distance / ray.range;
  if (fraction > maxFraction + COLLISION_EPSILON) return null;
  return {
    fraction,
    end: [
      ray.origin[0] + ray.direction[0] * distance,
      ray.origin[1] + ray.direction[1] * distance,
      ray.origin[2] + ray.direction[2] * distance,
    ],
    planeNormal: normal ?? [-ray.direction[0], -ray.direction[1], -ray.direction[2]],
    entityIndex: entity.index,
    classname: entity.classname,
  };
}

function isShootableButton(entity: QuakeEntity): boolean {
  return entity.classname === "func_button" && quakeEntityNumber(entity, "health", 0) > 0;
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
