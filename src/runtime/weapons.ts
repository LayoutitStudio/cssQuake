import type { PolyFirstPersonControlsHandle, PolySceneHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../prepare/scene";
import type { QuakeAmmoField, QuakeWeaponId } from "./hud";
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
import {
  createQuakeProjectilesController,
  type QuakeProjectileState,
  type QuakeProjectileTrace,
} from "./projectiles";

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
  getActiveWeapon(): QuakeWeaponId;
  getAmmo(field: QuakeAmmoField): number;
  consumeAmmo(field: QuakeAmmoField, amount: number): void;
  selectBestWeapon(): QuakeWeaponId;
  syncHud(): void;
  playFireSound(weapon: QuakeWeaponFireSoundId): void;
  playFireAnimation(): void;
  damageShootable(entityIndex: number, amount: number): boolean;
  damageBrushEntity(entityIndex: number, amount: number): boolean;
  damageMultiplier?: () => number;
  random?: () => number;
  onHit(): void;
  syncCrosshairTarget(): void;
}

interface QuakeViewRay {
  origin: Vec3;
  direction: Vec3;
  end: Vec3;
  range: number;
}

export type QuakeWeaponFireSoundId =
  | "axe"
  | "shotgun"
  | "supershotgun"
  | "nailgun"
  | "supernailgun"
  | "grenadelauncher"
  | "rocketlauncher"
  | "lightning";

type QuakeWeaponFireKind = "hitscan-pellets" | "melee-trace" | "projectile" | "beam";

interface QuakeWeaponFireProfileBase {
  ammoCost: number;
  ammoField: QuakeAmmoField | null;
  cooldownMs: number;
  kind: QuakeWeaponFireKind;
  runtime: "supported" | "unsupported";
  soundCooldownMs?: number;
  soundWeapon: QuakeWeaponFireSoundId;
  sourceFunction: string;
  weapon: QuakeWeaponId;
}

interface QuakeHitscanPelletFireProfile extends QuakeWeaponFireProfileBase {
  kind: "hitscan-pellets";
  pelletCount: number;
  pelletDamage: number;
  runtime: "supported";
  spreadRight: number;
  spreadUp: number;
}

interface QuakeMeleeTraceFireProfile extends QuakeWeaponFireProfileBase {
  damage: number;
  kind: "melee-trace";
  range: number;
  runtime: "supported";
}

interface QuakeLinearProjectileFireProfile extends QuakeWeaponFireProfileBase {
  damage: number;
  forwardOffsetUnits: number;
  kind: "projectile";
  lifetimeMs: number;
  modelPath: string;
  rightOffsetUnits: number;
  runtime: "supported";
  speed: number;
  alternatingRightOffset?: boolean;
  bounce?: boolean;
  directDamageRandom?: number;
  explodeOnExpire?: boolean;
  gravity?: number;
  halfDamageClassnames?: readonly string[];
  sourceZOffsetUnits?: number;
  splashDamage?: number;
  splashIgnoresDirectHit?: boolean;
  splashRadius?: number;
  verticalVelocity?: number;
}

interface QuakeBeamFireProfile extends QuakeWeaponFireProfileBase {
  damage: number;
  damageEndForwardOffsetUnits: number;
  damageSourceZOffsetUnits: number;
  damageTraceOffsetUnits: number;
  kind: "beam";
  range: number;
  runtime: "supported";
  sourceZOffsetUnits: number;
}

interface QuakeUnsupportedProjectileFireProfile extends QuakeWeaponFireProfileBase {
  damage?: number;
  kind: "projectile";
  modelPath?: string;
  runtime: "unsupported";
  speed?: number;
}

interface QuakeUnsupportedBeamFireProfile extends QuakeWeaponFireProfileBase {
  damage: number;
  kind: "beam";
  range: number;
  runtime: "unsupported";
}

type QuakeRuntimeWeaponFireProfile =
  | QuakeHitscanPelletFireProfile
  | QuakeMeleeTraceFireProfile
  | QuakeLinearProjectileFireProfile
  | QuakeBeamFireProfile;
type QuakeWeaponFireProfile =
  | QuakeRuntimeWeaponFireProfile
  | QuakeUnsupportedProjectileFireProfile
  | QuakeUnsupportedBeamFireProfile;

const QUAKE_WEAPON_TRACE_RANGE = 2048 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_WEAPON_SOURCE_FORWARD_OFFSET = 10 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_WEAPON_SOURCE_Z_OFFSET = QUAKE_PLAYER_MINS_Z + PLAYER_HEIGHT * 0.7 - QUAKE_PLAYER_VIEW_Z;
const QUAKE_SHOTGUN_PELLET_DAMAGE = 4;
const QUAKE_WEAPON_AIM_DOT = 0.93;
const QUAKE_WEAPON_AIM_POINT_Z = 0.6;
const QUAKE_SHOTGUN_COOLDOWN_MS = 500;
const QUAKE_SUPER_SHOTGUN_COOLDOWN_MS = 700;
const QUAKE_FAST_REPEAT_WEAPON_COOLDOWN_MS = 200;
const QUAKE_ROCKET_WEAPON_COOLDOWN_MS = 600;
const QUAKE_AXE_COOLDOWN_MS = 500;
const QUAKE_AXE_RANGE = 64 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PROJECTILE_DEFAULT_SOURCE_Z_OFFSET_UNITS = 16;
const QUAKE_PROJECTILE_BOUNCE_OVERBOUNCE = 1.5;
const QUAKE_PROJECTILE_BOUNCE_STOP_EPSILON = 0.1 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_SPIKE_PROJECTILE_LIFETIME_MS = 6000;
const QUAKE_SPIKE_PROJECTILE_SPEED = 1000 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_SPIKE_PROJECTILE_RIGHT_OFFSET = 4;
const QUAKE_ROCKET_PROJECTILE_LIFETIME_MS = 5000;
const QUAKE_ROCKET_PROJECTILE_SPEED = 1000 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_ROCKET_PROJECTILE_FORWARD_OFFSET = 8;
const QUAKE_ROCKET_SPLASH_DAMAGE = 120;
const QUAKE_ROCKET_SPLASH_RADIUS = (QUAKE_ROCKET_SPLASH_DAMAGE + 40) * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_GRENADE_PROJECTILE_LIFETIME_MS = 2500;
const QUAKE_GRENADE_PROJECTILE_SPEED = 600 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_GRENADE_PROJECTILE_VERTICAL_VELOCITY = 200 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_GRENADE_PROJECTILE_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_GRENADE_SPLASH_DAMAGE = 120;
const QUAKE_GRENADE_SPLASH_RADIUS = (QUAKE_GRENADE_SPLASH_DAMAGE + 40) * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_LIGHTNING_DAMAGE = 30;
const QUAKE_LIGHTNING_DAMAGE_END_FORWARD_OFFSET = 4;
const QUAKE_LIGHTNING_DAMAGE_SOURCE_Z_OFFSET_UNITS = 0;
const QUAKE_LIGHTNING_DAMAGE_TRACE_OFFSET_UNITS = 16;
const QUAKE_LIGHTNING_RANGE = 600 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_LIGHTNING_SOUND_COOLDOWN_MS = 600;
const QUAKE_LIGHTNING_SOURCE_Z_OFFSET_UNITS = 16;
const QUAKE_SHOTGUN_FIRE_PROFILE: QuakeHitscanPelletFireProfile = {
  ammoCost: 1,
  ammoField: "shells",
  cooldownMs: QUAKE_SHOTGUN_COOLDOWN_MS,
  kind: "hitscan-pellets",
  pelletCount: 6,
  pelletDamage: QUAKE_SHOTGUN_PELLET_DAMAGE,
  runtime: "supported",
  soundWeapon: "shotgun",
  sourceFunction: "W_FireShotgun",
  spreadRight: 0.04,
  spreadUp: 0.04,
  weapon: "shotgun",
};
const QUAKE_SUPER_SHOTGUN_FIRE_PROFILE: QuakeHitscanPelletFireProfile = {
  ammoCost: 2,
  ammoField: "shells",
  cooldownMs: QUAKE_SUPER_SHOTGUN_COOLDOWN_MS,
  kind: "hitscan-pellets",
  pelletCount: 14,
  pelletDamage: QUAKE_SHOTGUN_PELLET_DAMAGE,
  runtime: "supported",
  soundWeapon: "supershotgun",
  sourceFunction: "W_FireSuperShotgun",
  spreadRight: 0.14,
  spreadUp: 0.08,
  weapon: "supershotgun",
};
const QUAKE_SUPER_SHOTGUN_ONE_SHELL_FIRE_PROFILE: QuakeHitscanPelletFireProfile = {
  ...QUAKE_SHOTGUN_FIRE_PROFILE,
  cooldownMs: QUAKE_SUPER_SHOTGUN_COOLDOWN_MS,
  sourceFunction: "W_FireSuperShotgun -> W_FireShotgun",
  weapon: "supershotgun",
};
const QUAKE_SUPER_NAILGUN_ONE_NAIL_FIRE_PROFILE: QuakeLinearProjectileFireProfile = {
  alternatingRightOffset: true,
  ammoCost: 1,
  ammoField: "nails",
  cooldownMs: QUAKE_FAST_REPEAT_WEAPON_COOLDOWN_MS,
  damage: 9,
  kind: "projectile",
  lifetimeMs: QUAKE_SPIKE_PROJECTILE_LIFETIME_MS,
  modelPath: "progs/spike.mdl",
  forwardOffsetUnits: 0,
  rightOffsetUnits: QUAKE_SPIKE_PROJECTILE_RIGHT_OFFSET,
  runtime: "supported",
  soundWeapon: "nailgun",
  sourceFunction: "W_FireSpikes",
  speed: QUAKE_SPIKE_PROJECTILE_SPEED,
  weapon: "supernailgun",
};
const QUAKE_WEAPON_FIRE_PROFILES: Record<QuakeWeaponId, QuakeWeaponFireProfile> = {
  axe: {
    ammoCost: 0,
    ammoField: null,
    cooldownMs: QUAKE_AXE_COOLDOWN_MS,
    damage: 20,
    kind: "melee-trace",
    range: QUAKE_AXE_RANGE,
    runtime: "supported",
    soundWeapon: "axe",
    sourceFunction: "W_FireAxe",
    weapon: "axe",
  },
  shotgun: QUAKE_SHOTGUN_FIRE_PROFILE,
  supershotgun: QUAKE_SUPER_SHOTGUN_FIRE_PROFILE,
  nailgun: {
    alternatingRightOffset: true,
    ammoCost: 1,
    ammoField: "nails",
    cooldownMs: QUAKE_FAST_REPEAT_WEAPON_COOLDOWN_MS,
    damage: 9,
    kind: "projectile",
    lifetimeMs: QUAKE_SPIKE_PROJECTILE_LIFETIME_MS,
    modelPath: "progs/spike.mdl",
    forwardOffsetUnits: 0,
    rightOffsetUnits: QUAKE_SPIKE_PROJECTILE_RIGHT_OFFSET,
    runtime: "supported",
    soundWeapon: "nailgun",
    sourceFunction: "W_FireSpikes",
    speed: QUAKE_SPIKE_PROJECTILE_SPEED,
    weapon: "nailgun",
  },
  supernailgun: {
    ammoCost: 2,
    ammoField: "nails",
    cooldownMs: QUAKE_FAST_REPEAT_WEAPON_COOLDOWN_MS,
    damage: 18,
    kind: "projectile",
    lifetimeMs: QUAKE_SPIKE_PROJECTILE_LIFETIME_MS,
    modelPath: "progs/s_spike.mdl",
    forwardOffsetUnits: 0,
    rightOffsetUnits: 0,
    runtime: "supported",
    soundWeapon: "supernailgun",
    sourceFunction: "W_FireSuperSpikes",
    speed: QUAKE_SPIKE_PROJECTILE_SPEED,
    weapon: "supernailgun",
  },
  grenadelauncher: {
    ammoCost: 1,
    ammoField: "rockets",
    bounce: true,
    cooldownMs: QUAKE_ROCKET_WEAPON_COOLDOWN_MS,
    damage: 0,
    explodeOnExpire: true,
    forwardOffsetUnits: 0,
    gravity: QUAKE_GRENADE_PROJECTILE_GRAVITY,
    kind: "projectile",
    lifetimeMs: QUAKE_GRENADE_PROJECTILE_LIFETIME_MS,
    modelPath: "progs/grenade.mdl",
    rightOffsetUnits: 0,
    runtime: "supported",
    soundWeapon: "grenadelauncher",
    sourceFunction: "W_FireGrenade",
    sourceZOffsetUnits: 0,
    speed: QUAKE_GRENADE_PROJECTILE_SPEED,
    splashDamage: QUAKE_GRENADE_SPLASH_DAMAGE,
    splashIgnoresDirectHit: false,
    splashRadius: QUAKE_GRENADE_SPLASH_RADIUS,
    verticalVelocity: QUAKE_GRENADE_PROJECTILE_VERTICAL_VELOCITY,
    weapon: "grenadelauncher",
  },
  rocketlauncher: {
    ammoCost: 1,
    ammoField: "rockets",
    cooldownMs: QUAKE_ROCKET_WEAPON_COOLDOWN_MS,
    damage: 100,
    directDamageRandom: 20,
    forwardOffsetUnits: QUAKE_ROCKET_PROJECTILE_FORWARD_OFFSET,
    halfDamageClassnames: ["monster_shambler"],
    kind: "projectile",
    lifetimeMs: QUAKE_ROCKET_PROJECTILE_LIFETIME_MS,
    modelPath: "progs/missile.mdl",
    rightOffsetUnits: 0,
    runtime: "supported",
    soundWeapon: "rocketlauncher",
    sourceFunction: "W_FireRocket",
    speed: QUAKE_ROCKET_PROJECTILE_SPEED,
    splashDamage: QUAKE_ROCKET_SPLASH_DAMAGE,
    splashRadius: QUAKE_ROCKET_SPLASH_RADIUS,
    weapon: "rocketlauncher",
  },
  lightning: {
    ammoCost: 1,
    ammoField: "cells",
    cooldownMs: QUAKE_FAST_REPEAT_WEAPON_COOLDOWN_MS,
    damage: QUAKE_LIGHTNING_DAMAGE,
    damageEndForwardOffsetUnits: QUAKE_LIGHTNING_DAMAGE_END_FORWARD_OFFSET,
    damageSourceZOffsetUnits: QUAKE_LIGHTNING_DAMAGE_SOURCE_Z_OFFSET_UNITS,
    damageTraceOffsetUnits: QUAKE_LIGHTNING_DAMAGE_TRACE_OFFSET_UNITS,
    kind: "beam",
    range: QUAKE_LIGHTNING_RANGE,
    runtime: "supported",
    soundCooldownMs: QUAKE_LIGHTNING_SOUND_COOLDOWN_MS,
    soundWeapon: "lightning",
    sourceFunction: "W_FireLightning",
    sourceZOffsetUnits: QUAKE_LIGHTNING_SOURCE_Z_OFFSET_UNITS,
    weapon: "lightning",
  },
};

interface QuakeWeaponProjectile extends QuakeProjectileState<QuakeLinearProjectileFireProfile> {
  damage: number;
}

export function createQuakeWeaponsController({
  scene,
  controls,
  canUseGameplayInput,
  hasViewmodel,
  getCollisionWorld,
  getEntities,
  getShootables,
  getActiveWeapon,
  getAmmo,
  consumeAmmo,
  selectBestWeapon,
  syncHud,
  playFireSound,
  playFireAnimation,
  damageShootable,
  damageBrushEntity,
  damageMultiplier,
  random = Math.random,
  onHit,
  syncCrosshairTarget,
}: QuakeWeaponsControllerOptions): QuakeWeaponsController {
  let nextFireAt = -Infinity;
  let nextNailRightSign = 1;
  const nextSoundAtByWeapon = new Map<QuakeWeaponId, number>();
  const projectiles = createQuakeProjectilesController<QuakeWeaponProjectile>({
    canSimulate: canUseGameplayInput,
    onExpire: handleProjectileExpire,
    onImpact: handleProjectileImpact,
    trace: traceProjectilePath,
  });

  function reset(): void {
    nextFireAt = -Infinity;
    nextNailRightSign = 1;
    nextSoundAtByWeapon.clear();
    projectiles.reset();
  }

  function canFire(now = performance.now()): boolean {
    if (!canUseGameplayInput() || !hasViewmodel()) return false;
    if (now < nextFireAt) return false;
    const profile = activeWeaponFireProfile();
    return Boolean(profile && quakeWeaponFireProfileIsRuntimeSupported(profile));
  }

  function fire(now = performance.now()): boolean {
    if (!canAttemptWeaponAction(now)) return false;
    const profile = activeWeaponFireProfile();
    if (!profile) {
      switchNoAmmoWeapon();
      return false;
    }
    if (!quakeWeaponFireProfileIsRuntimeSupported(profile)) return false;
    nextFireAt = now + profile.cooldownMs;
    consumeWeaponAmmo(profile);
    playWeaponFireSound(profile, now);
    const hit = fireWeaponProfile(profile, now);
    playFireAnimation();
    if (hit) onHit();
    syncCrosshairTarget();
    return true;
  }

  function canAttemptWeaponAction(now: number): boolean {
    if (!canUseGameplayInput() || !hasViewmodel()) return false;
    return now >= nextFireAt;
  }

  function switchNoAmmoWeapon(): void {
    const activeWeapon = getActiveWeapon();
    const profile = QUAKE_WEAPON_FIRE_PROFILES[activeWeapon];
    if (!profile?.ammoField || getAmmo(profile.ammoField) > 0) return;
    const nextWeapon = selectBestWeapon();
    if (nextWeapon !== activeWeapon) syncHud();
  }

  function activeWeaponFireProfile(): QuakeWeaponFireProfile | null {
    return quakeWeaponFireProfile(getActiveWeapon(), getAmmo);
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
    const direction = viewForwardDirection();
    return viewRayFromDirection(weaponSourceOrigin(origin, direction), direction, range);
  }

  function viewForwardDirection(): Vec3 {
    const rotX = scene.camera.state.rotX ?? 88;
    const rotY = scene.camera.state.rotY ?? 270;
    return normalizeVec3(forwardDirection(rotX, rotY));
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

  function fireWeaponProfile(profile: QuakeRuntimeWeaponFireProfile, now: number): boolean {
    if (profile.kind === "hitscan-pellets") return fireShotgunPellets(profile);
    if (profile.kind === "projectile") {
      fireLinearProjectile(profile, now);
      return false;
    }
    if (profile.kind === "beam") return fireBeam(profile);
    return fireMeleeTrace(profile);
  }

  function playWeaponFireSound(profile: QuakeRuntimeWeaponFireProfile, now: number): void {
    const soundCooldownMs = profile.soundCooldownMs ?? 0;
    if (soundCooldownMs > 0 && now <= (nextSoundAtByWeapon.get(profile.weapon) ?? -Infinity)) return;
    playFireSound(profile.soundWeapon);
    if (soundCooldownMs > 0) nextSoundAtByWeapon.set(profile.weapon, now + soundCooldownMs);
  }

  function consumeWeaponAmmo(profile: QuakeRuntimeWeaponFireProfile): void {
    if (!profile.ammoField || profile.ammoCost <= 0) return;
    consumeAmmo(profile.ammoField, profile.ammoCost);
    syncHud();
  }

  function fireShotgunPellets(profile: QuakeHitscanPelletFireProfile): boolean {
    const aim = weaponAimForFire();
    const damageByEntity = new Map<number, number>();
    const { right, up } = weaponSpreadAxes();

    for (let pellet = 0; pellet < profile.pelletCount; pellet++) {
      const direction = spreadWeaponDirection(aim.direction, right, up, profile);
      const trace = traceWeaponRay(viewRayFromDirection(aim.ray.origin, direction, QUAKE_WEAPON_TRACE_RANGE));
      if (!traceIsShootable(trace) || trace.entityIndex === undefined) continue;
      damageByEntity.set(trace.entityIndex, (damageByEntity.get(trace.entityIndex) ?? 0) + profile.pelletDamage);
    }

    let hit = false;
    for (const [entityIndex, damage] of damageByEntity) {
      if (damageWeaponEntity(entityIndex, damage)) hit = true;
    }
    return hit;
  }

  function fireMeleeTrace(profile: QuakeMeleeTraceFireProfile): boolean {
    const ray = weaponRayAtCrosshair(profile.range);
    const trace = traceWeaponRay(ray);
    if (!traceIsShootable(trace) || trace.entityIndex === undefined) return false;
    return damageWeaponEntity(trace.entityIndex, profile.damage);
  }

  function fireBeam(profile: QuakeBeamFireProfile): boolean {
    const direction = viewForwardDirection();
    const sourceOrigin = weaponQuakeSourceOrigin(controls.getOrigin(), profile.sourceZOffsetUnits);
    const sourceTrace = traceWeaponRay(viewRayFromDirection(sourceOrigin, direction, profile.range));
    const sourceEnd = sourceTrace?.end ?? [
      sourceOrigin[0] + direction[0] * profile.range,
      sourceOrigin[1] + direction[1] * profile.range,
      sourceOrigin[2] + direction[2] * profile.range,
    ];
    const damageOrigin = weaponQuakeSourceOrigin(controls.getOrigin(), profile.damageSourceZOffsetUnits);
    const damageEndOffset = profile.damageEndForwardOffsetUnits * QUAKE_COLLISION_UNIT_SCALE;
    const damageEnd: Vec3 = [
      sourceEnd[0] + direction[0] * damageEndOffset,
      sourceEnd[1] + direction[1] * damageEndOffset,
      sourceEnd[2] + direction[2] * damageEndOffset,
    ];
    return damageBeamTraces(profile, damageOrigin, damageEnd);
  }

  function fireLinearProjectile(profile: QuakeLinearProjectileFireProfile, now: number): void {
    const aim = weaponAimForFire();
    const { right, up } = weaponSpreadAxes();
    const rightOffsetUnits = projectileRightOffsetUnits(profile);
    const origin = weaponProjectileSourceOrigin(controls.getOrigin(), aim.direction, right, {
      forwardOffsetUnits: profile.forwardOffsetUnits,
      rightOffsetUnits,
      sourceZOffsetUnits: profile.sourceZOffsetUnits,
    });
    projectiles.spawn({
      damage: projectileDirectDamage(profile),
      direction: aim.direction,
      expiresAt: now + profile.lifetimeMs,
      gravity: profile.gravity,
      origin,
      profile,
      speed: profile.speed,
      velocity: projectileVelocity(profile, aim.direction, up),
    });
  }

  function projectileRightOffsetUnits(profile: QuakeLinearProjectileFireProfile): number {
    if (!profile.alternatingRightOffset) return profile.rightOffsetUnits;
    const offset = profile.rightOffsetUnits * nextNailRightSign;
    nextNailRightSign *= -1;
    return offset;
  }

  function projectileDirectDamage(profile: QuakeLinearProjectileFireProfile): number {
    return profile.damage + (profile.directDamageRandom ?? 0) * random();
  }

  function projectileVelocity(profile: QuakeLinearProjectileFireProfile, direction: Vec3, up: Vec3): Vec3 | undefined {
    if (!profile.gravity && !profile.verticalVelocity) return undefined;
    const verticalVelocity = profile.verticalVelocity ?? 0;
    return [
      direction[0] * profile.speed + up[0] * verticalVelocity,
      direction[1] * profile.speed + up[1] * verticalVelocity,
      direction[2] * profile.speed + up[2] * verticalVelocity,
    ];
  }

  function traceProjectilePath(_projectile: QuakeWeaponProjectile, start: Vec3, end: Vec3): QuakeProjectileTrace | null {
    const delta: Vec3 = [
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ];
    const range = Math.hypot(delta[0], delta[1], delta[2]);
    if (range <= COLLISION_EPSILON) return null;
    return traceWeaponRay(viewRayFromDirection(start, normalizeVec3(delta), range)) as QuakeProjectileTrace | null;
  }

  function handleProjectileImpact(projectile: QuakeWeaponProjectile, trace: QuakeProjectileTrace): "keep" | "remove" {
    if (projectile.profile.bounce && !traceIsShootable(trace)) {
      bounceWeaponProjectile(projectile, trace);
      return "keep";
    }

    let hit = false;
    const directEntityIndex = trace.entityIndex;
    if (projectile.damage > 0 && directEntityIndex !== undefined && traceIsShootable(trace) && damageWeaponEntity(
      directEntityIndex,
      projectileDamageForEntity(projectile.damage, projectile.profile, directEntityIndex),
    )) {
      hit = true;
    }
    if (projectile.profile.splashDamage && projectile.profile.splashRadius) {
      const ignoredEntityIndex = projectile.profile.splashIgnoresDirectHit === false ? undefined : directEntityIndex;
      if (damageProjectileSplash(trace.end, projectile.profile, ignoredEntityIndex)) hit = true;
    }
    if (hit) onHit();
    return "remove";
  }

  function handleProjectileExpire(projectile: QuakeWeaponProjectile): void {
    if (!projectile.profile.explodeOnExpire) return;
    if (damageProjectileSplash(projectile.origin, projectile.profile, undefined)) onHit();
  }

  function bounceWeaponProjectile(projectile: QuakeWeaponProjectile, trace: QuakeProjectileTrace): void {
    const normal = trace.planeNormal;
    if (!normal) {
      projectile.origin = trace.end;
      projectile.velocity = [0, 0, 0];
      projectile.speed = 0;
      return;
    }

    const velocity = projectile.velocity ?? [
      projectile.direction[0] * projectile.speed,
      projectile.direction[1] * projectile.speed,
      projectile.direction[2] * projectile.speed,
    ];
    const bounced = clipVelocity(velocity, normal, QUAKE_PROJECTILE_BOUNCE_OVERBOUNCE);
    const speed = Math.hypot(bounced[0], bounced[1], bounced[2]);
    projectile.origin = [
      trace.end[0] + normal[0] * COLLISION_EPSILON,
      trace.end[1] + normal[1] * COLLISION_EPSILON,
      trace.end[2] + normal[2] * COLLISION_EPSILON,
    ];
    if (speed <= COLLISION_EPSILON) {
      projectile.velocity = [0, 0, 0];
      projectile.speed = 0;
      return;
    }
    projectile.direction = normalizeVec3(bounced);
    projectile.speed = speed;
    projectile.velocity = bounced;
  }

  function projectileDamageForEntity(
    damage: number,
    profile: QuakeLinearProjectileFireProfile,
    entityIndex: number,
  ): number {
    const entity = getEntities().get(entityIndex);
    if (entity && profile.halfDamageClassnames?.includes(entity.classname)) return damage * 0.5;
    return damage;
  }

  function damageProjectileSplash(
    origin: Vec3,
    profile: QuakeLinearProjectileFireProfile,
    ignoredEntityIndex: number | undefined,
  ): boolean {
    if (!profile.splashDamage || !profile.splashRadius) return false;
    let hit = false;
    for (const shootable of getShootables()) {
      const entityIndex = shootable.entity.index;
      if (shootable.dead || entityIndex === ignoredEntityIndex) continue;
      const distance = distanceToShootableCenter(origin, shootable);
      if (distance > profile.splashRadius) continue;
      let damage = profile.splashDamage - 0.5 * (distance / QUAKE_COLLISION_UNIT_SCALE);
      if (damage <= 0) continue;
      if (profile.halfDamageClassnames?.includes(shootable.entity.classname)) damage *= 0.5;
      if (damageShootable(entityIndex, scaledWeaponDamage(damage))) hit = true;
    }
    return hit;
  }

  function damageBeamTraces(profile: QuakeBeamFireProfile, start: Vec3, end: Vec3): boolean {
    const offset = lightningDamageOffset(start, end, profile.damageTraceOffsetUnits);
    const offsets: Vec3[] = [
      [0, 0, 0],
      offset,
      [-offset[0], -offset[1], -offset[2]],
    ];
    const damagedEntityIndexes = new Set<number>();
    let hit = false;
    for (const beamOffset of offsets) {
      const trace = traceDamageBeamOffset(start, end, beamOffset);
      if (!traceIsShootable(trace) || trace.entityIndex === undefined || damagedEntityIndexes.has(trace.entityIndex)) {
        continue;
      }
      damagedEntityIndexes.add(trace.entityIndex);
      if (damageWeaponEntity(trace.entityIndex, profile.damage)) hit = true;
    }
    return hit;
  }

  function traceDamageBeamOffset(start: Vec3, end: Vec3, offset: Vec3): QuakeUseTrace | null {
    const origin: Vec3 = [
      start[0] + offset[0],
      start[1] + offset[1],
      start[2] + offset[2],
    ];
    const target: Vec3 = [
      end[0] + offset[0],
      end[1] + offset[1],
      end[2] + offset[2],
    ];
    const delta: Vec3 = [
      target[0] - origin[0],
      target[1] - origin[1],
      target[2] - origin[2],
    ];
    const range = Math.hypot(delta[0], delta[1], delta[2]);
    if (range <= COLLISION_EPSILON) return null;
    return traceWeaponRay(viewRayFromDirection(origin, normalizeVec3(delta), range));
  }

  function damageWeaponEntity(entityIndex: number, amount: number): boolean {
    const damageAmount = scaledWeaponDamage(amount);
    for (const shootable of getShootables()) {
      if (shootable.dead || shootable.entity.index !== entityIndex) continue;
      return damageShootable(entityIndex, damageAmount);
    }
    const entity = getEntities().get(entityIndex);
    if (!entity) return false;
    if (isShootableBrushEntity(entity)) {
      return damageBrushEntity(entity.index, damageAmount);
    }
    return false;
  }

  function scaledWeaponDamage(amount: number): number {
    const multiplier = damageMultiplier?.() ?? 1;
    return amount * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
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

function weaponQuakeSourceOrigin(viewOrigin: Vec3, sourceZOffsetUnits: number): Vec3 {
  return [
    viewOrigin[0],
    viewOrigin[1],
    viewOrigin[2] + (sourceZOffsetUnits - QUAKE_PLAYER_VIEW_Z / QUAKE_COLLISION_UNIT_SCALE) *
      QUAKE_COLLISION_UNIT_SCALE,
  ];
}

function quakeWeaponFireProfile(
  weapon: QuakeWeaponId,
  getAmmo: (field: QuakeAmmoField) => number,
): QuakeWeaponFireProfile | null {
  const profile = QUAKE_WEAPON_FIRE_PROFILES[weapon];
  if (!profile) return null;
  const ammo = profile.ammoField ? getAmmo(profile.ammoField) : Infinity;
  if (weapon === "supershotgun") {
    if (ammo >= QUAKE_SUPER_SHOTGUN_FIRE_PROFILE.ammoCost) return QUAKE_SUPER_SHOTGUN_FIRE_PROFILE;
    if (ammo === 1) return QUAKE_SUPER_SHOTGUN_ONE_SHELL_FIRE_PROFILE;
    return null;
  }
  if (weapon === "supernailgun") {
    if (ammo >= profile.ammoCost) return profile;
    if (ammo === 1) return QUAKE_SUPER_NAILGUN_ONE_NAIL_FIRE_PROFILE;
    return null;
  }
  return ammo >= profile.ammoCost ? profile : null;
}

function quakeWeaponFireProfileIsRuntimeSupported(
  profile: QuakeWeaponFireProfile,
): profile is QuakeRuntimeWeaponFireProfile {
  return profile.runtime === "supported";
}

function weaponProjectileSourceOrigin(
  viewOrigin: Vec3,
  direction: Vec3,
  right: Vec3,
  offsets: { forwardOffsetUnits: number; rightOffsetUnits: number; sourceZOffsetUnits?: number },
): Vec3 {
  const forwardOffset = offsets.forwardOffsetUnits * QUAKE_COLLISION_UNIT_SCALE;
  const rightOffset = offsets.rightOffsetUnits * QUAKE_COLLISION_UNIT_SCALE;
  const sourceZOffset = (
    (offsets.sourceZOffsetUnits ?? QUAKE_PROJECTILE_DEFAULT_SOURCE_Z_OFFSET_UNITS) -
    QUAKE_PLAYER_VIEW_Z / QUAKE_COLLISION_UNIT_SCALE
  ) * QUAKE_COLLISION_UNIT_SCALE;
  return [
    viewOrigin[0] + direction[0] * forwardOffset + right[0] * rightOffset,
    viewOrigin[1] + direction[1] * forwardOffset + right[1] * rightOffset,
    viewOrigin[2] + sourceZOffset + direction[2] * forwardOffset + right[2] * rightOffset,
  ];
}

function clipVelocity(velocity: Vec3, normal: Vec3, overbounce: number): Vec3 {
  const backoff = dotVec3(velocity, normal) * overbounce;
  return [
    stopTinyVelocity(velocity[0] - normal[0] * backoff),
    stopTinyVelocity(velocity[1] - normal[1] * backoff),
    stopTinyVelocity(velocity[2] - normal[2] * backoff),
  ];
}

function stopTinyVelocity(value: number): number {
  return Math.abs(value) < QUAKE_PROJECTILE_BOUNCE_STOP_EPSILON ? 0 : value;
}

function distanceToShootableCenter(origin: Vec3, shootable: QuakeWeaponShootableTarget): number {
  return Math.hypot(
    origin[0] - (shootable.bounds.min[0] + shootable.bounds.max[0]) * 0.5,
    origin[1] - (shootable.bounds.min[1] + shootable.bounds.max[1]) * 0.5,
    origin[2] - (shootable.bounds.min[2] + shootable.bounds.max[2]) * 0.5,
  );
}

function lightningDamageOffset(start: Vec3, end: Vec3, offsetUnits: number): Vec3 {
  const direction = normalizeVec3([
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ]);
  const offset = offsetUnits * QUAKE_COLLISION_UNIT_SCALE;
  // QuakeC mutates f_x before assigning f_y in LightningDamage; preserve that source shape.
  const x = -direction[1];
  const y = x;
  return [x * offset, y * offset, 0];
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

function spreadWeaponDirection(
  aimDirection: Vec3,
  right: Vec3,
  up: Vec3,
  profile: QuakeHitscanPelletFireProfile,
): Vec3 {
  const rightSpread = crandom() * profile.spreadRight;
  const upSpread = crandom() * profile.spreadUp;
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
