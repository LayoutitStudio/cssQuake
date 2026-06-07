import type { PolyFirstPersonControlsHandle, PolySceneHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../prepare/scene";
import {
  COLLISION_EPSILON,
  PLAYER_HEIGHT,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  QUAKE_PLAYER_VIEW_Z,
} from "./constants";
import type { QuakeCollisionWorld, QuakeUseTrace } from "./collision";
import { quakeEntityNumber } from "./entities";
import { crossVec3, dotVec3, normalizeVec3 } from "./math";

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
  canFire(now?: number): boolean;
  fire(now?: number): boolean;
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
  playFireSound(): void;
  playFireAnimation(): void;
  damageShootable(entityIndex: number, amount: number): boolean;
  damageBrushEntity(entityIndex: number, amount: number): boolean;
  onHit(): void;
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
const QUAKE_WEAPON_SOURCE_FORWARD_OFFSET = 10 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_WEAPON_SOURCE_Z_OFFSET = QUAKE_PLAYER_MINS_Z + PLAYER_HEIGHT * 0.7 - QUAKE_PLAYER_VIEW_Z;
const QUAKE_SHOTGUN_PELLET_COUNT = 6;
const QUAKE_SHOTGUN_PELLET_DAMAGE = 4;
const QUAKE_SHOTGUN_SPREAD_RIGHT = 0.04;
const QUAKE_SHOTGUN_SPREAD_UP = 0.04;
const QUAKE_WEAPON_AIM_DOT = 0.93;
const QUAKE_WEAPON_AIM_POINT_Z = 0.6;

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
  playFireSound,
  playFireAnimation,
  damageShootable,
  damageBrushEntity,
  onHit,
  syncCrosshairTarget,
}: QuakeWeaponsControllerOptions): QuakeWeaponsController {
  let lastFireAt = -Infinity;

  function reset(): void {
    lastFireAt = -Infinity;
  }

  function canFire(now = performance.now()): boolean {
    if (!canUseGameplayInput() || !hasViewmodel()) return false;
    if (now - lastFireAt < QUAKE_WEAPON_FIRE_COOLDOWN_MS) return false;
    return getShells() > 0;
  }

  function fire(now = performance.now()): boolean {
    if (!canFire(now)) return false;
    lastFireAt = now;
    consumeShell();
    syncHud();
    playFireSound();
    const hit = fireShotgunPellets();
    playFireAnimation();
    if (hit) onHit();
    syncCrosshairTarget();
    return true;
  }

  function viewTraceAtCrosshair(range: number): QuakeUseTrace | null {
    const collisionWorld = getCollisionWorld();
    if (!collisionWorld?.traceUse) return null;
    const ray = viewRayAtCrosshair(range);
    return collisionWorld.traceUse(ray.origin, ray.end);
  }

  function weaponTraceAtCrosshair(): QuakeUseTrace | null {
    return weaponTraceForFire();
  }

  function weaponTraceForFire(): QuakeUseTrace | null {
    return weaponAimForFire().trace;
  }

  function weaponAimForFire(): { ray: QuakeViewRay; direction: Vec3; trace: QuakeUseTrace | null } {
    const ray = weaponRayAtCrosshair(QUAKE_WEAPON_TRACE_RANGE);
    const directTrace = traceWeaponRay(ray);
    if (traceIsShootable(directTrace)) {
      return { ray, direction: ray.direction, trace: directTrace };
    }

    const aimTrace = quakeAimTrace(ray);
    if (aimTrace) {
      return {
        ray,
        direction: normalizeVec3([
          aimTrace.end[0] - ray.origin[0],
          aimTrace.end[1] - ray.origin[1],
          aimTrace.end[2] - ray.origin[2],
        ]),
        trace: aimTrace,
      };
    }

    return { ray, direction: ray.direction, trace: directTrace };
  }

  function traceIsActionable(trace: QuakeUseTrace | null): trace is QuakeUseTrace {
    if (trace?.classname !== "func_button" || trace.entityIndex === undefined) return false;
    const entity = getEntities().get(trace.entityIndex);
    return Boolean(entity && !isShootableBrushEntity(entity));
  }

  function traceIsShootable(trace: QuakeUseTrace | null): trace is QuakeUseTrace {
    if (trace?.entityIndex === undefined) return false;
    for (const shootable of getShootables()) {
      if (!shootable.dead && shootable.entity.index === trace.entityIndex) return true;
    }
    const entity = getEntities().get(trace.entityIndex);
    return Boolean(entity && isShootableBrushEntity(entity));
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

  function weaponRayAtCrosshair(range: number): QuakeViewRay {
    const origin = controls.getOrigin();
    const rotX = scene.camera.state.rotX ?? 88;
    const rotY = scene.camera.state.rotY ?? 270;
    const direction = normalizeVec3(forwardDirection(rotX, rotY));
    return viewRayFromDirection(weaponSourceOrigin(origin, direction), direction, range);
  }

  function weaponSpreadAxes(): { right: Vec3; up: Vec3 } {
    const rotX = scene.camera.state.rotX ?? 88;
    const rotY = scene.camera.state.rotY ?? 270;
    const forward = normalizeVec3(forwardDirection(rotX, rotY));
    const right = normalizeVec3(rightDirection(rotY));
    return { right, up: normalizeVec3(crossVec3(right, forward)) };
  }

  function traceWeaponRay(ray: QuakeViewRay): QuakeUseTrace | null {
    const worldTrace = getCollisionWorld()?.traceUse?.(ray.origin, ray.end) ?? null;
    return traceShootables(ray, worldTrace?.fraction ?? 1) ?? worldTrace;
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

  function quakeAimTrace(ray: QuakeViewRay): QuakeUseTrace | null {
    const collisionWorld = getCollisionWorld();
    let best: { score: number; trace: QuakeUseTrace } | null = null;
    for (const shootable of getShootables()) {
      if (shootable.dead) continue;
      const target = shootableAimPoint(shootable);
      const targetDirection = normalizeVec3([
        target[0] - ray.origin[0],
        target[1] - ray.origin[1],
        target[2] - ray.origin[2],
      ]);
      const score = dotVec3(targetDirection, ray.direction);
      if (score < QUAKE_WEAPON_AIM_DOT) continue;

      const aimDirection = verticalAimDirection(ray, target);
      const aimRay = viewRayFromDirection(ray.origin, aimDirection, ray.range);
      const shootableTrace = rayTraceAabb(aimRay, shootable.bounds.min, shootable.bounds.max, 1, shootable.entity);
      if (!shootableTrace) continue;
      const obstruction = collisionWorld?.traceUse?.(aimRay.origin, aimRay.end) ?? null;
      if (obstruction && obstruction.fraction + COLLISION_EPSILON < shootableTrace.fraction) continue;
      if (!best || score > best.score) best = { score, trace: shootableTrace };
    }
    return best?.trace ?? null;
  }

  function fireShotgunPellets(): boolean {
    const aim = weaponAimForFire();
    const damageByEntity = new Map<number, number>();
    const { right, up } = weaponSpreadAxes();

    for (let pellet = 0; pellet < QUAKE_SHOTGUN_PELLET_COUNT; pellet++) {
      const direction = spreadWeaponDirection(aim.direction, right, up);
      const trace = traceWeaponRay(viewRayFromDirection(aim.ray.origin, direction, QUAKE_WEAPON_TRACE_RANGE));
      if (!traceIsShootable(trace) || trace.entityIndex === undefined) continue;
      damageByEntity.set(trace.entityIndex, (damageByEntity.get(trace.entityIndex) ?? 0) + QUAKE_SHOTGUN_PELLET_DAMAGE);
    }

    let hit = false;
    for (const [entityIndex, damage] of damageByEntity) {
      if (damageWeaponEntity(entityIndex, damage)) hit = true;
    }
    return hit;
  }

  function damageWeaponEntity(entityIndex: number, amount: number): boolean {
    for (const shootable of getShootables()) {
      if (shootable.dead || shootable.entity.index !== entityIndex) continue;
      return damageShootable(entityIndex, amount);
    }
    const entity = getEntities().get(entityIndex);
    if (!entity) return false;
    if (isShootableBrushEntity(entity)) {
      return damageBrushEntity(entity.index, amount);
    }
    return false;
  }

  return {
    reset,
    canFire,
    fire,
    viewTraceAtCrosshair,
    weaponTraceAtCrosshair,
    traceIsActionable,
    traceIsShootable,
  };
}

function viewRayFromDirection(origin: Vec3, direction: Vec3, range: number): QuakeViewRay {
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

function shootableAimPoint(shootable: QuakeWeaponShootableTarget): Vec3 {
  return [
    (shootable.bounds.min[0] + shootable.bounds.max[0]) * 0.5,
    (shootable.bounds.min[1] + shootable.bounds.max[1]) * 0.5,
    shootable.bounds.min[2] + (shootable.bounds.max[2] - shootable.bounds.min[2]) * QUAKE_WEAPON_AIM_POINT_Z,
  ];
}

function verticalAimDirection(ray: QuakeViewRay, target: Vec3): Vec3 {
  const horizontalLength = Math.hypot(ray.direction[0], ray.direction[1]);
  if (horizontalLength <= COLLISION_EPSILON) return normalizeVec3([
    target[0] - ray.origin[0],
    target[1] - ray.origin[1],
    target[2] - ray.origin[2],
  ]);

  const targetDx = target[0] - ray.origin[0];
  const targetDy = target[1] - ray.origin[1];
  const forwardX = ray.direction[0] / horizontalLength;
  const forwardY = ray.direction[1] / horizontalLength;
  const targetHorizontalDistance = Math.max(COLLISION_EPSILON, targetDx * forwardX + targetDy * forwardY);
  return normalizeVec3([
    forwardX * targetHorizontalDistance,
    forwardY * targetHorizontalDistance,
    target[2] - ray.origin[2],
  ]);
}

function weaponSourceOrigin(viewOrigin: Vec3, viewDirection: Vec3): Vec3 {
  return [
    viewOrigin[0] + viewDirection[0] * QUAKE_WEAPON_SOURCE_FORWARD_OFFSET,
    viewOrigin[1] + viewDirection[1] * QUAKE_WEAPON_SOURCE_FORWARD_OFFSET,
    viewOrigin[2] + QUAKE_WEAPON_SOURCE_Z_OFFSET,
  ];
}

function spreadWeaponDirection(aimDirection: Vec3, right: Vec3, up: Vec3): Vec3 {
  const rightSpread = crandom() * QUAKE_SHOTGUN_SPREAD_RIGHT;
  const upSpread = crandom() * QUAKE_SHOTGUN_SPREAD_UP;
  return normalizeVec3([
    aimDirection[0] + rightSpread * right[0] + upSpread * up[0],
    aimDirection[1] + rightSpread * right[1] + upSpread * up[1],
    aimDirection[2] + rightSpread * right[2] + upSpread * up[2],
  ]);
}

function crandom(): number {
  return Math.random() * 2 - 1;
}

function isShootableBrushEntity(entity: QuakeEntity): boolean {
  if (quakeEntityNumber(entity, "health", 0) <= 0) return false;
  return entity.classname === "func_button" ||
    entity.classname === "func_door" ||
    entity.classname === "trigger_multiple" ||
    entity.classname === "trigger_once" ||
    entity.classname === "trigger_secret";
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
