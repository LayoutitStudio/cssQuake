import type { PolyFirstPersonControlsHandle, PolyMeshHandle, PolySceneHandle, Vec3 } from "@layoutit/polycss";

import {
  QUAKE_PLAYER_WEAPON_FIRE_FACTS,
  QUAKE_PROGRAM_SOURCE_FACTS,
  type QuakePlayerWeaponFireProfileFact,
} from "../generated/quakeProgramFacts";
import type { QuakeEntity } from "../types/quake";
import type { QuakeAmmoField, QuakeWeaponId } from "./hud";
import type { QuakeViewmodelFireAnimation } from "./viewmodel";
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
import {
  quakecCanDamageAnyTracePointClear,
  quakecCanDamageTracePointsForRuntimeOrigin,
} from "./shootables/damage";

export interface QuakeWeaponShootableTarget {
  entity: QuakeEntity;
  dead: boolean;
  origin: Vec3;
  bounds: {
    min: Vec3;
    max: Vec3;
  };
}

export interface QuakeWeaponsController {
  reset(): void;
  canFire(now?: number): boolean;
  debugProjectileImpact(
    weapon: QuakeWeaponId,
    entityIndex: number,
    origin: Vec3,
    directDamage?: number,
  ): QuakeWeaponProjectileImpactDebugResult | null;
  fire(now?: number): boolean;
  viewTraceAtCrosshair(range: number): QuakeUseTrace | null;
  weaponTraceAtCrosshair(): QuakeUseTrace | null;
  traceIsActionable(trace: QuakeUseTrace | null): trace is QuakeUseTrace;
  traceIsShootable(trace: QuakeUseTrace | null): trace is QuakeUseTrace;
}

export interface QuakeWeaponFireEvent {
  firedAt: number;
  fireKind: "hitscan" | "melee" | "projectile" | "beam";
  weapon: QuakeWeaponId;
  origin: Vec3;
  direction: Vec3;
  range: number;
}

export interface QuakeWeaponsControllerOptions {
  scene: PolySceneHandle;
  controls: Pick<PolyFirstPersonControlsHandle, "getOrigin">;
  addProjectileMesh?(modelPath: string, weapon: QuakeWeaponId): QuakeWeaponProjectileVisualHandle | null;
  canUseGameplayInput(): boolean;
  hasViewmodel(): boolean;
  getCollisionWorld(): QuakeCollisionWorld | null;
  getEntities(): ReadonlyMap<number, QuakeEntity>;
  getShootables(): Iterable<QuakeWeaponShootableTarget>;
  getPlayerEyeHeight(): number;
  getPlayerWaterLevel(): number;
  getActiveWeapon(): QuakeWeaponId;
  getAmmo(field: QuakeAmmoField): number;
  consumeAmmo(field: QuakeAmmoField, amount: number): void;
  selectBestWeapon(): QuakeWeaponId;
  syncHud(): void;
  playFireSound(weapon: QuakeWeaponFireSoundId): void;
  playFireAnimation(animation?: QuakeViewmodelFireAnimation): void;
  damageShootable(entityIndex: number, amount: number): boolean;
  damageBrushEntity(entityIndex: number, amount: number): boolean;
  damagePlayer(amount: number): boolean;
  canDamageTargetOrigin?(start: Vec3, targetOrigin: Vec3): boolean;
  damageMultiplier?: () => number;
  random?: () => number;
  onFire?(event: QuakeWeaponFireEvent): void;
  onHit(): void;
  showLightningBeam?(beam: QuakeWeaponLightningBeamVisual): void;
  syncCrosshairTarget(): void;
}

export interface QuakeWeaponProjectileVisualHandle {
  handle: PolyMeshHandle;
  scale: number;
}

export interface QuakeWeaponLightningBeamVisual {
  end: Vec3;
  start: Vec3;
  tempEntity: string;
  weapon: QuakeWeaponId;
}

export interface QuakeWeaponProjectileImpactDebugResult {
  directDamage: number;
  directEntityIndex: number;
  directEntityClassname: string | null;
  impactResult: "keep" | "remove";
  origin: Vec3;
  splashDamage: number;
  splashIgnoresDirectHit: boolean;
  splashRadius: number;
  splashRadiusQuakeUnits: number;
  splashRequiresCanDamage: boolean;
  weapon: QuakeWeaponId;
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

interface QuakeWeaponFireAnimationSequenceVariant {
  firstFrameMuzzleFlash?: boolean;
  frames: readonly number[];
  otherwise?: boolean;
  randomLessThan?: number;
}

interface QuakeWeaponFireAnimationSequenceProfile {
  frameIntervalMs: number;
  kind: "sequence";
  variants: readonly QuakeWeaponFireAnimationSequenceVariant[];
}

interface QuakeWeaponFireAnimationCycleProfile {
  firstWeaponFrame: number;
  frameIntervalMs: number;
  kind: "cycle";
  lastWeaponFrame: number;
}

type QuakeWeaponFireAnimationProfile =
  | QuakeWeaponFireAnimationCycleProfile
  | QuakeWeaponFireAnimationSequenceProfile;

interface QuakeBeamUnderwaterDischargeProfile {
  attackerSelfScale: number;
  damagePerAmmoCell: number;
  distanceScale: number;
  radiusAddUnits: number;
  clearsAmmoField: QuakeAmmoField;
  requiresCanDamage: boolean;
  shamblerScale?: number;
}

interface QuakeWeaponFireProfileBase {
  ammoCost: number;
  ammoField: QuakeAmmoField | null;
  cooldownMs: number;
  fireAnimation?: QuakeWeaponFireAnimationProfile;
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
  sourceZOffsetUnits: number;
  splashDamage?: number;
  splashIgnoresDirectHit?: boolean;
  splashRequiresCanDamage?: boolean;
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
  tempEntity: string;
  underwaterDischarge?: QuakeBeamUnderwaterDischargeProfile;
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

const QUAKE_PLAYER_WEAPON_FIRE_FACT_PROFILES = QUAKE_PLAYER_WEAPON_FIRE_FACTS.profiles;
const QUAKE_SHOTGUN_FIRE_FACT = quakePlayerWeaponFireFact("shotgun");
const QUAKE_WEAPON_TRACE_RANGE = quakeUnitsToCollisionUnits(
  requiredNumber(QUAKE_SHOTGUN_FIRE_FACT.hitscan?.traceRangeUnits, "shotgun trace range"),
);
const QUAKE_WEAPON_SOURCE_FORWARD_OFFSET = quakeUnitsToCollisionUnits(
  requiredNumber(QUAKE_SHOTGUN_FIRE_FACT.hitscan?.sourceOffsetUnits?.forward, "shotgun source forward offset"),
);
const QUAKE_WEAPON_SOURCE_Z_OFFSET = quakeHitscanSourceZOffset(QUAKE_SHOTGUN_FIRE_FACT);
// Runtime aim assist, not QuakeC logic: keeps CSS hit-feel stable without a recurring correction loop.
const QUAKE_WEAPON_AIM_DOT = 0.93;
const QUAKE_WEAPON_AIM_POINT_Z = 0.6;
// Runtime projectile physics constants owned by this TypeScript simulation, not weapon fire-profile source facts.
const QUAKE_PROJECTILE_BOUNCE_OVERBOUNCE = 1.5;
const QUAKE_PROJECTILE_BOUNCE_STOP_EPSILON = 0.1 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_GRENADE_PROJECTILE_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_SHOTGUN_FIRE_PROFILE = quakeHitscanFireProfile("shotgun");
const QUAKE_SUPER_SHOTGUN_FIRE_PROFILE = quakeHitscanFireProfile("supershotgun");
const QUAKE_SUPER_SHOTGUN_ONE_SHELL_FIRE_PROFILE: QuakeHitscanPelletFireProfile = {
  ...QUAKE_SHOTGUN_FIRE_PROFILE,
  cooldownMs: QUAKE_SUPER_SHOTGUN_FIRE_PROFILE.cooldownMs,
  sourceFunction: "W_FireSuperShotgun -> W_FireShotgun",
  weapon: "supershotgun",
};
const QUAKE_SUPER_NAILGUN_ONE_NAIL_FIRE_PROFILE: QuakeLinearProjectileFireProfile = {
  ...quakeProjectileFireProfile("nailgun"),
  soundWeapon: "nailgun",
  sourceFunction: "W_FireSpikes",
  weapon: "supernailgun",
};
const QUAKE_WEAPON_FIRE_PROFILES: Record<QuakeWeaponId, QuakeWeaponFireProfile> = {
  axe: quakeMeleeFireProfile("axe"),
  shotgun: QUAKE_SHOTGUN_FIRE_PROFILE,
  supershotgun: QUAKE_SUPER_SHOTGUN_FIRE_PROFILE,
  nailgun: quakeProjectileFireProfile("nailgun"),
  supernailgun: quakeProjectileFireProfile("supernailgun"),
  grenadelauncher: quakeProjectileFireProfile("grenadelauncher", {
    gravity: QUAKE_GRENADE_PROJECTILE_GRAVITY,
  }),
  rocketlauncher: quakeProjectileFireProfile("rocketlauncher"),
  lightning: quakeBeamFireProfile("lightning"),
};

function quakePlayerWeaponFireFact(weapon: QuakeWeaponId): QuakePlayerWeaponFireProfileFact {
  const fact = QUAKE_PLAYER_WEAPON_FIRE_FACT_PROFILES[weapon];
  if (!fact) throw new Error(`Missing generated QuakeC player weapon fire fact for ${weapon}.`);
  return fact;
}

function quakeHitscanFireProfile(weapon: QuakeWeaponId): QuakeHitscanPelletFireProfile {
  const fact = quakePlayerWeaponFireFact(weapon);
  const hitscan = fact.hitscan;
  if (fact.runtimeKind !== "hitscan-pellets" || !hitscan) {
    throw new Error(`Generated QuakeC weapon fact for ${weapon} is not a hitscan profile.`);
  }
  const spread = hitscan.spread;
  if (!spread) throw new Error(`Generated QuakeC hitscan weapon fact for ${weapon} is missing spread.`);
  return {
    ammoCost: fact.ammo?.cost ?? 0,
    ammoField: quakeRuntimeAmmoField(fact),
    cooldownMs: fact.cooldownMs,
    fireAnimation: quakeWeaponFireAnimationProfile(fact),
    kind: "hitscan-pellets",
    pelletCount: hitscan.pelletCount,
    pelletDamage: hitscan.pelletDamage,
    runtime: "supported",
    soundWeapon: quakeRuntimeFireSoundWeapon(fact),
    sourceFunction: fact.sourceFunction,
    spreadRight: spread[0],
    spreadUp: spread[1],
    weapon,
  };
}

function quakeMeleeFireProfile(weapon: QuakeWeaponId): QuakeMeleeTraceFireProfile {
  const fact = quakePlayerWeaponFireFact(weapon);
  const melee = fact.melee;
  if (fact.runtimeKind !== "melee-trace" || !melee) {
    throw new Error(`Generated QuakeC weapon fact for ${weapon} is not a melee profile.`);
  }
  return {
    ammoCost: fact.ammo?.cost ?? 0,
    ammoField: quakeRuntimeAmmoField(fact),
    cooldownMs: fact.cooldownMs,
    damage: melee.damage,
    fireAnimation: quakeWeaponFireAnimationProfile(fact),
    kind: "melee-trace",
    range: quakeUnitsToCollisionUnits(melee.rangeUnits),
    runtime: "supported",
    soundWeapon: quakeRuntimeFireSoundWeapon(fact),
    sourceFunction: fact.sourceFunction,
    weapon,
  };
}

function quakeProjectileFireProfile(
  weapon: QuakeWeaponId,
  overrides: Partial<QuakeLinearProjectileFireProfile> = {},
): QuakeLinearProjectileFireProfile {
  const fact = quakePlayerWeaponFireFact(weapon);
  const projectile = fact.projectile;
  if (fact.runtimeKind !== "projectile" || !projectile) {
    throw new Error(`Generated QuakeC weapon fact for ${weapon} is not a projectile profile.`);
  }
  const radiusDamage = projectile.radiusDamage;
  const sourceOffset = projectile.sourceOffsetUnits;
  if (!sourceOffset) throw new Error(`Generated QuakeC projectile weapon fact for ${weapon} is missing source offset.`);
  const alternatingRight = sourceOffset?.alternatingRight;
  const directDamage = projectile.directDamage;
  const profile: QuakeLinearProjectileFireProfile = {
    ammoCost: fact.ammo?.cost ?? 0,
    ammoField: quakeRuntimeAmmoField(fact),
    cooldownMs: fact.cooldownMs,
    damage: projectile.damage ?? directDamage?.base ?? 0,
    fireAnimation: quakeWeaponFireAnimationProfile(fact),
    kind: "projectile",
    lifetimeMs: requiredNumber(projectile.lifetimeMs, `${weapon} projectile lifetime`),
    modelPath: requiredString(projectile.modelPath, `${weapon} projectile model`),
    forwardOffsetUnits: sourceOffset?.forward ?? 0,
    rightOffsetUnits: alternatingRight?.[0] ?? sourceOffset?.right ?? 0,
    runtime: "supported",
    soundWeapon: quakeRuntimeFireSoundWeapon(fact),
    sourceFunction: fact.sourceFunction,
    sourceZOffsetUnits: sourceOffset.up ?? 0,
    speed: quakeUnitsToCollisionUnits(requiredNumber(projectile.speedUnits, `${weapon} projectile speed`)),
    weapon,
    ...(alternatingRight?.length ? { alternatingRightOffset: true } : {}),
    ...(projectile.movetype === "MOVETYPE_BOUNCE" ? { bounce: true } : {}),
    ...(directDamage?.randomAdd !== undefined ? { directDamageRandom: directDamage.randomAdd } : {}),
    ...(projectile.explodeFunction ? { explodeOnExpire: true } : {}),
    ...(directDamage?.halfDamageClassnames ? { halfDamageClassnames: directDamage.halfDamageClassnames } : {}),
    ...(radiusDamage?.damageUnits !== undefined ? { splashDamage: radiusDamage.damageUnits } : {}),
    ...(radiusDamage?.ignore === "world" ? { splashIgnoresDirectHit: false } : {}),
    ...(radiusDamage?.requiresCanDamage ? { splashRequiresCanDamage: true } : {}),
    ...(radiusDamage?.radiusUnits !== undefined
      ? { splashRadius: quakeUnitsToCollisionUnits(radiusDamage.radiusUnits) }
      : {}),
    ...(projectile.verticalVelocityUnits !== undefined
      ? { verticalVelocity: quakeUnitsToCollisionUnits(projectile.verticalVelocityUnits) }
      : {}),
  };
  return { ...profile, ...overrides };
}

function quakeBeamFireProfile(
  weapon: QuakeWeaponId,
  overrides: Partial<QuakeBeamFireProfile> = {},
): QuakeBeamFireProfile {
  const fact = quakePlayerWeaponFireFact(weapon);
  const beam = fact.beam;
  if (fact.runtimeKind !== "beam" || !beam) {
    throw new Error(`Generated QuakeC weapon fact for ${weapon} is not a beam profile.`);
  }
  const underwaterDischarge = quakeBeamUnderwaterDischargeProfile(fact);
  const profile: QuakeBeamFireProfile = {
    ammoCost: fact.ammo?.cost ?? 0,
    ammoField: quakeRuntimeAmmoField(fact),
    cooldownMs: fact.cooldownMs,
    damage: requiredNumber(beam.damage, `${weapon} beam damage`),
    damageEndForwardOffsetUnits: requiredNumber(
      beam.damageEndForwardOffsetUnits,
      `${weapon} beam damage end offset`,
    ),
    damageSourceZOffsetUnits: 0,
    damageTraceOffsetUnits: requiredNumber(beam.damageTraceOffsetUnits, `${weapon} beam damage trace offset`),
    fireAnimation: quakeWeaponFireAnimationProfile(fact),
    kind: "beam",
    range: quakeUnitsToCollisionUnits(requiredNumber(beam.rangeUnits, `${weapon} beam range`)),
    runtime: "supported",
    soundCooldownMs: fact.fireSound?.cooldownMs,
    soundWeapon: quakeRuntimeFireSoundWeapon(fact),
    sourceFunction: fact.sourceFunction,
    sourceZOffsetUnits: beam.sourceOffsetUnits?.up ?? 0,
    tempEntity: requiredString(beam.tempEntity, `${weapon} beam temp entity`),
    ...(underwaterDischarge ? { underwaterDischarge } : {}),
    weapon,
  };
  return { ...profile, ...overrides };
}

function quakeBeamUnderwaterDischargeProfile(
  fact: QuakePlayerWeaponFireProfileFact,
): QuakeBeamUnderwaterDischargeProfile | undefined {
  const branch = fact.unsupportedBranches?.find((candidate) => candidate.id === "lightning-underwater-discharge");
  const radiusDamage = branch?.radiusDamage;
  if (!branch?.clearsAmmoField || !radiusDamage) return undefined;
  if (radiusDamage.call !== "T_RadiusDamage") return undefined;
  const damagePerAmmoCell = requiredNumber(
    radiusDamage.damagePerAmmoCell,
    `${fact.weapon} underwater discharge damage per ammo cell`,
  );
  return {
    attackerSelfScale: radiusDamage.attackerSelfScale ?? 1,
    clearsAmmoField: branch.clearsAmmoField as QuakeAmmoField,
    damagePerAmmoCell,
    distanceScale: radiusDamage.distanceScale ?? 0.5,
    radiusAddUnits: radiusDamage.radiusAddUnits ?? 0,
    requiresCanDamage: radiusDamage.requiresCanDamage === true,
    ...(radiusDamage.shamblerScale !== undefined ? { shamblerScale: radiusDamage.shamblerScale } : {}),
  };
}

function quakeRuntimeAmmoField(fact: QuakePlayerWeaponFireProfileFact): QuakeAmmoField | null {
  return (fact.ammo?.field ?? null) as QuakeAmmoField | null;
}

function quakeRuntimeFireSoundWeapon(fact: QuakePlayerWeaponFireProfileFact): QuakeWeaponFireSoundId {
  return fact.weapon as QuakeWeaponFireSoundId;
}

function quakeWeaponFireAnimationProfile(
  fact: QuakePlayerWeaponFireProfileFact,
): QuakeWeaponFireAnimationProfile | undefined {
  const animation = fact.presentation?.fireAnimation;
  if (!animation) return undefined;
  if (animation.kind === "cycle") {
    return {
      firstWeaponFrame: requiredNumber(animation.firstWeaponFrame, `${fact.weapon} fire animation first frame`),
      frameIntervalMs: requiredNumber(animation.frameIntervalMs, `${fact.weapon} fire animation frame interval`),
      kind: "cycle",
      lastWeaponFrame: requiredNumber(animation.lastWeaponFrame, `${fact.weapon} fire animation last frame`),
    };
  }
  const variants = animation.variants
    .map((variant) => {
      const frames = variant.frames
        .map((frame) => ({
          muzzleFlash: frame.muzzleFlash === true,
          weaponFrame: frame.weaponFrame,
        }))
        .filter((frame): frame is { muzzleFlash: boolean; weaponFrame: number } =>
          typeof frame.weaponFrame === "number" && Number.isFinite(frame.weaponFrame),
        );
      return {
        frames: frames.map((frame) => frame.weaponFrame),
        ...(frames[0]?.muzzleFlash ? { firstFrameMuzzleFlash: true } : {}),
        ...(variant.otherwise ? { otherwise: true } : {}),
        ...(typeof variant.randomLessThan === "number" ? { randomLessThan: variant.randomLessThan } : {}),
      };
    })
    .filter((variant) => variant.frames.length > 0);
  if (!variants.length) return undefined;
  return {
    frameIntervalMs: requiredNumber(animation.frameIntervalMs, `${fact.weapon} fire animation frame interval`),
    kind: "sequence",
    variants,
  };
}

function quakeHitscanSourceZOffset(fact: QuakePlayerWeaponFireProfileFact): number {
  const zExpression = fact.hitscan?.sourceOffsetUnits?.zExpression;
  if (zExpression !== "self.absmin_z + self.size_z * 0.7") {
    throw new Error(`Unsupported generated QuakeC hitscan source Z expression: ${zExpression ?? "missing"}.`);
  }
  return QUAKE_PLAYER_MINS_Z + PLAYER_HEIGHT * 0.7 - QUAKE_PLAYER_VIEW_Z;
}

function quakeUnitsToCollisionUnits(units: number): number {
  return units * QUAKE_COLLISION_UNIT_SCALE;
}

function requiredNumber(value: number | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing generated QuakeC numeric weapon fact: ${label}.`);
  }
  return value;
}

function requiredString(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing generated QuakeC string weapon fact: ${label}.`);
  return value;
}

function quakeProjectileRenderYaw(yaw: number): number {
  return ((yaw % 360) + 360) % 360;
}

export function quakeWeaponFireProfileAuditFacts() {
  return {
    sourceRevision: QUAKE_PROGRAM_SOURCE_FACTS.revision,
    profiles: Object.fromEntries(
      Object.entries(QUAKE_WEAPON_FIRE_PROFILES).map(([weapon, profile]) => [
        weapon,
        quakeWeaponFireProfileAuditFact(weapon as QuakeWeaponId, profile),
      ]),
    ),
    fallbackProfiles: {
      supernailgunOneNail: quakeWeaponFireProfileAuditFact("supernailgun", QUAKE_SUPER_NAILGUN_ONE_NAIL_FIRE_PROFILE),
      supershotgunOneShell: quakeWeaponFireProfileAuditFact("supershotgun", QUAKE_SUPER_SHOTGUN_ONE_SHELL_FIRE_PROFILE),
    },
  };
}

function quakeWeaponFireProfileAuditFact(weapon: QuakeWeaponId, profile: QuakeWeaponFireProfile) {
  const sourceFact = quakePlayerWeaponFireFact(weapon);
  return {
    ammoCost: profile.ammoCost,
    ammoField: profile.ammoField,
    cooldownMs: profile.cooldownMs,
    fireAnimation: profile.fireAnimation,
    kind: profile.kind,
    runtime: profile.runtime,
    soundCooldownMs: profile.soundCooldownMs,
    soundWeapon: profile.soundWeapon,
    sourceCooldownMs: sourceFact.cooldownMs,
    sourceFunction: profile.sourceFunction,
    weapon: profile.weapon,
    ...(profile.kind === "hitscan-pellets"
      ? {
          pelletCount: profile.pelletCount,
          pelletDamage: profile.pelletDamage,
          spreadRight: profile.spreadRight,
          spreadUp: profile.spreadUp,
        }
      : {}),
    ...(profile.kind === "melee-trace" ? { damage: profile.damage, range: profile.range } : {}),
    ...(profile.kind === "projectile"
      ? {
          bounce: profile.bounce,
          damage: profile.damage,
          directDamageRandom: profile.directDamageRandom,
          explodeOnExpire: profile.explodeOnExpire,
          forwardOffsetUnits: profile.forwardOffsetUnits,
          gravity: profile.gravity,
          lifetimeMs: profile.lifetimeMs,
          modelPath: profile.modelPath,
          rightOffsetUnits: profile.rightOffsetUnits,
          sourceZOffsetUnits: profile.sourceZOffsetUnits,
          speed: profile.speed,
          splashDamage: profile.splashDamage,
          splashIgnoresDirectHit: profile.splashIgnoresDirectHit,
          splashRadius: profile.splashRadius,
          verticalVelocity: profile.verticalVelocity,
        }
      : {}),
    ...(profile.kind === "beam"
      ? {
          damage: profile.damage,
          damageEndForwardOffsetUnits: profile.damageEndForwardOffsetUnits,
          damageSourceZOffsetUnits: profile.damageSourceZOffsetUnits,
          damageTraceOffsetUnits: profile.damageTraceOffsetUnits,
          range: profile.range,
          sourceZOffsetUnits: profile.sourceZOffsetUnits,
          tempEntity: profile.tempEntity,
          underwaterDischarge: profile.underwaterDischarge,
        }
      : {}),
  };
}

interface QuakeWeaponProjectile extends QuakeProjectileState<QuakeLinearProjectileFireProfile> {
  damage: number;
  visual?: QuakeWeaponProjectileVisualHandle | null;
}

export function createQuakeWeaponsController({
  scene,
  controls,
  addProjectileMesh,
  canUseGameplayInput,
  hasViewmodel,
  getCollisionWorld,
  getEntities,
  getShootables,
  getPlayerEyeHeight,
  getPlayerWaterLevel,
  getActiveWeapon,
  getAmmo,
  consumeAmmo,
  selectBestWeapon,
  syncHud,
  playFireSound,
  playFireAnimation,
  damageShootable,
  damageBrushEntity,
  damagePlayer,
  canDamageTargetOrigin,
  damageMultiplier,
  random = Math.random,
  onFire,
  onHit,
  showLightningBeam,
  syncCrosshairTarget,
}: QuakeWeaponsControllerOptions): QuakeWeaponsController {
  let nextFireAt = -Infinity;
  let nextNailRightSign = 1;
  const nextSoundAtByWeapon = new Map<QuakeWeaponId, number>();
  const nextCycleAnimationFrameByWeapon = new Map<QuakeWeaponId, number>();
  const projectiles = createQuakeProjectilesController<QuakeWeaponProjectile>({
    canSimulate: canUseGameplayInput,
    onExpire: handleProjectileExpire,
    onImpact: handleProjectileImpact,
    onMove: syncProjectileVisual,
    onRemove: removeProjectileVisual,
    onSpawn: addProjectileVisual,
    trace: traceProjectilePath,
  });

  function reset(): void {
    nextFireAt = -Infinity;
    nextNailRightSign = 1;
    nextSoundAtByWeapon.clear();
    nextCycleAnimationFrameByWeapon.clear();
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
    if (profile.kind === "beam" && profile.underwaterDischarge && getPlayerWaterLevel() > 1) {
      const hit = fireBeamUnderwaterDischarge(profile.underwaterDischarge);
      playWeaponFireAnimation(profile);
      if (hit) onHit();
      syncCrosshairTarget();
      return true;
    }
    consumeWeaponAmmo(profile);
    playWeaponFireSound(profile, now);
    const hit = fireWeaponProfile(profile, now);
    playWeaponFireAnimation(profile);
    onFire?.(quakeWeaponFireEvent(profile, now));
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

  function debugProjectileImpact(
    weapon: QuakeWeaponId,
    entityIndex: number,
    origin: Vec3,
    directDamage?: number,
  ): QuakeWeaponProjectileImpactDebugResult | null {
    const profile = QUAKE_WEAPON_FIRE_PROFILES[weapon];
    if (!Number.isFinite(entityIndex) || !vec3IsFinite(origin)) return null;
    if (!profile || !quakeWeaponFireProfileIsRuntimeSupported(profile) || profile.kind !== "projectile") return null;
    const directEntityIndex = Math.round(entityIndex);
    const entity = getEntities().get(directEntityIndex);
    if (!entity) return null;
    const damage = Number.isFinite(directDamage) ? Math.max(0, directDamage) : projectileDirectDamage(profile);
    const direction: Vec3 = [0, -1, 0];
    const impactOrigin = [...origin] as Vec3;
    const velocity: Vec3 = [
      direction[0] * profile.speed,
      direction[1] * profile.speed,
      direction[2] * profile.speed,
    ];
    const projectile: QuakeWeaponProjectile = {
      damage,
      direction,
      expiresAt: performance.now() + profile.lifetimeMs,
      origin: impactOrigin,
      profile,
      speed: profile.speed,
      velocity,
    };
    const trace: QuakeProjectileTrace = {
      classname: entity.classname,
      end: impactOrigin,
      entityIndex: directEntityIndex,
      fraction: 0,
      planeNormal: null,
    };
    const impactResult = handleProjectileImpact(projectile, trace);
    return {
      directDamage: damage,
      directEntityClassname: entity.classname ?? null,
      directEntityIndex,
      impactResult,
      origin: impactOrigin,
      splashDamage: profile.splashDamage ?? 0,
      splashIgnoresDirectHit: profile.splashIgnoresDirectHit !== false,
      splashRadius: profile.splashRadius ?? 0,
      splashRadiusQuakeUnits: (profile.splashRadius ?? 0) / QUAKE_COLLISION_UNIT_SCALE,
      splashRequiresCanDamage: profile.splashRequiresCanDamage === true,
      weapon,
    };
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

  function playWeaponFireAnimation(profile: QuakeRuntimeWeaponFireProfile): void {
    playFireAnimation(viewmodelFireAnimation(profile));
  }

  function viewmodelFireAnimation(profile: QuakeRuntimeWeaponFireProfile): QuakeViewmodelFireAnimation | undefined {
    const animation = profile.fireAnimation;
    if (!animation) return undefined;
    if (animation.kind === "cycle") {
      const frame = nextCycleAnimationFrameByWeapon.get(profile.weapon) ?? animation.firstWeaponFrame;
      const nextFrame = frame >= animation.lastWeaponFrame ? animation.firstWeaponFrame : frame + 1;
      nextCycleAnimationFrameByWeapon.set(profile.weapon, nextFrame);
      return {
        frameIntervalMs: animation.frameIntervalMs,
        frames: [frame],
      };
    }
    const variant = chooseFireAnimationVariant(animation);
    return {
      frameIntervalMs: animation.frameIntervalMs,
      frames: variant.frames,
      ...(variant.firstFrameMuzzleFlash ? { firstFrameMuzzleFlash: true } : {}),
    };
  }

  function chooseFireAnimationVariant(
    animation: QuakeWeaponFireAnimationSequenceProfile,
  ): QuakeWeaponFireAnimationSequenceVariant {
    if (animation.variants.length <= 1) return animation.variants[0];
    const value = random();
    return animation.variants.find((variant) => variant.randomLessThan !== undefined && value < variant.randomLessThan) ??
      animation.variants.find((variant) => variant.otherwise) ??
      animation.variants[animation.variants.length - 1];
  }

  function consumeWeaponAmmo(profile: QuakeRuntimeWeaponFireProfile): void {
    if (!profile.ammoField || profile.ammoCost <= 0) return;
    consumeAmmo(profile.ammoField, profile.ammoCost);
    syncHud();
  }

  function quakeWeaponFireEvent(profile: QuakeRuntimeWeaponFireProfile, now: number): QuakeWeaponFireEvent {
    const aim = weaponAimForFire();
    return {
      firedAt: now,
      fireKind: quakeMultiplayerFireKind(profile),
      weapon: profile.weapon,
      origin: aim.ray.origin,
      direction: aim.direction,
      range: quakeWeaponFireEventRange(profile),
    };
  }

  function quakeMultiplayerFireKind(profile: QuakeRuntimeWeaponFireProfile): QuakeWeaponFireEvent["fireKind"] {
    if (profile.kind === "hitscan-pellets") return "hitscan";
    if (profile.kind === "melee-trace") return "melee";
    return profile.kind;
  }

  function quakeWeaponFireEventRange(profile: QuakeRuntimeWeaponFireProfile): number {
    if (profile.kind === "hitscan-pellets") return QUAKE_WEAPON_TRACE_RANGE;
    if (profile.kind === "melee-trace" || profile.kind === "beam") return profile.range;
    return profile.speed * (profile.lifetimeMs / 1000);
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
    showLightningBeam?.({
      end: sourceEnd,
      start: sourceOrigin,
      tempEntity: profile.tempEntity,
      weapon: profile.weapon,
    });
    const damageOrigin = weaponQuakeSourceOrigin(controls.getOrigin(), profile.damageSourceZOffsetUnits);
    const damageEndOffset = profile.damageEndForwardOffsetUnits * QUAKE_COLLISION_UNIT_SCALE;
    const damageEnd: Vec3 = [
      sourceEnd[0] + direction[0] * damageEndOffset,
      sourceEnd[1] + direction[1] * damageEndOffset,
      sourceEnd[2] + direction[2] * damageEndOffset,
    ];
    return damageBeamTraces(profile, damageOrigin, damageEnd);
  }

  function fireBeamUnderwaterDischarge(profile: QuakeBeamUnderwaterDischargeProfile): boolean {
    const ammoCells = Math.max(0, getAmmo(profile.clearsAmmoField));
    if (ammoCells <= 0) return false;
    consumeAmmo(profile.clearsAmmoField, ammoCells);
    syncHud();
    const damageUnits = profile.damagePerAmmoCell * ammoCells;
    const radius = quakeUnitsToCollisionUnits(damageUnits + profile.radiusAddUnits);
    const origin = playerQuakeEntityOrigin();
    let hit = false;
    for (const shootable of getShootables()) {
      if (shootable.dead) continue;
      const distance = distanceToShootableCenter(origin, shootable);
      if (distance > radius) continue;
      if (!radiusDamageCanDamage(origin, shootable.origin, profile.requiresCanDamage)) continue;
      let damage = radiusDamageAtDistance(damageUnits, distance, profile.distanceScale);
      if (damage <= 0) continue;
      if (profile.shamblerScale !== undefined && shootable.entity.classname === "monster_shambler") {
        damage *= profile.shamblerScale;
      }
      if (damageShootable(shootable.entity.index, scaledWeaponDamage(damage))) hit = true;
    }
    if (damagePlayerRadiusDamage(origin, damageUnits, radius, profile)) hit = true;
    return hit;
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

  function addProjectileVisual(projectile: QuakeWeaponProjectile): void {
    projectile.visual = addProjectileMesh?.(projectile.profile.modelPath, projectile.profile.weapon) ?? null;
    syncProjectileVisual(projectile);
  }

  function syncProjectileVisual(projectile: QuakeWeaponProjectile): void {
    const visual = projectile.visual;
    if (!visual) return;
    const velocity = projectile.velocity ?? [
      projectile.direction[0] * projectile.speed,
      projectile.direction[1] * projectile.speed,
      projectile.direction[2] * projectile.speed,
    ];
    visual.handle.setTransform({
      position: projectile.origin,
      rotation: [0, 0, quakeProjectileRenderYaw((Math.atan2(velocity[1], velocity[0]) * 180) / Math.PI)],
      scale: visual.scale,
    });
  }

  function removeProjectileVisual(projectile: QuakeWeaponProjectile): void {
    projectile.visual?.handle.remove();
    projectile.visual = null;
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
      if (!radiusDamageCanDamage(origin, shootable.origin, profile.splashRequiresCanDamage === true)) continue;
      let damage = projectileSplashDamageAtDistance(profile, distance);
      if (damage <= 0) continue;
      if (profile.halfDamageClassnames?.includes(shootable.entity.classname)) damage *= 0.5;
      if (damageShootable(entityIndex, scaledWeaponDamage(damage))) hit = true;
    }
    if (damagePlayerProjectileSplash(origin, profile)) hit = true;
    return hit;
  }

  function damagePlayerProjectileSplash(origin: Vec3, profile: QuakeLinearProjectileFireProfile): boolean {
    if (!profile.splashDamage || !profile.splashRadius) return false;
    const distance = distanceToPlayerCenter(origin);
    if (distance > profile.splashRadius) return false;
    if (!radiusDamageCanDamage(origin, playerQuakeEntityOrigin(), profile.splashRequiresCanDamage === true)) return false;
    const damage = projectileSplashDamageAtDistance(profile, distance) * 0.5;
    if (damage <= 0) return false;
    return damagePlayer(scaledWeaponDamage(damage));
  }

  function damagePlayerRadiusDamage(
    origin: Vec3,
    damageUnits: number,
    radius: number,
    profile: Pick<QuakeBeamUnderwaterDischargeProfile, "attackerSelfScale" | "distanceScale" | "requiresCanDamage">,
  ): boolean {
    const distance = distanceToPlayerCenter(origin);
    if (distance > radius) return false;
    if (!radiusDamageCanDamage(origin, playerQuakeEntityOrigin(), profile.requiresCanDamage)) return false;
    const damage = radiusDamageAtDistance(damageUnits, distance, profile.distanceScale) * profile.attackerSelfScale;
    if (damage <= 0) return false;
    return damagePlayer(scaledWeaponDamage(damage));
  }

  function distanceToPlayerCenter(origin: Vec3): number {
    const center = playerDamageCenter();
    return Math.hypot(
      origin[0] - center[0],
      origin[1] - center[1],
      origin[2] - center[2],
    );
  }

  function playerDamageCenter(): Vec3 {
    const origin = controls.getOrigin();
    const eyeHeight = Math.max(0, getPlayerEyeHeight());
    return [
      origin[0],
      origin[1],
      origin[2] - eyeHeight + PLAYER_HEIGHT * 0.5,
    ];
  }

  function playerQuakeEntityOrigin(): Vec3 {
    const origin = controls.getOrigin();
    const eyeHeight = Math.max(0, getPlayerEyeHeight());
    return [
      origin[0],
      origin[1],
      origin[2] - eyeHeight - QUAKE_PLAYER_MINS_Z,
    ];
  }

  function radiusDamageCanDamage(start: Vec3, targetOrigin: Vec3, required: boolean): boolean {
    if (!required) return true;
    if (canDamageTargetOrigin) return canDamageTargetOrigin(start, targetOrigin);
    const collisionWorld = getCollisionWorld();
    if (!collisionWorld?.traceUse) return true;
    return quakecCanDamageAnyTracePointClear(
      start,
      quakecCanDamageTracePointsForRuntimeOrigin(targetOrigin),
      (traceStart, traceEnd) => collisionWorld.traceUse(traceStart, traceEnd) === null,
    );
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
    debugProjectileImpact,
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

function vec3IsFinite(value: Vec3): boolean {
  return value.every(Number.isFinite);
}

function weaponProjectileSourceOrigin(
  viewOrigin: Vec3,
  direction: Vec3,
  right: Vec3,
  offsets: { forwardOffsetUnits: number; rightOffsetUnits: number; sourceZOffsetUnits: number },
): Vec3 {
  const forwardOffset = offsets.forwardOffsetUnits * QUAKE_COLLISION_UNIT_SCALE;
  const rightOffset = offsets.rightOffsetUnits * QUAKE_COLLISION_UNIT_SCALE;
  const sourceZOffset = (
    offsets.sourceZOffsetUnits - QUAKE_PLAYER_VIEW_Z / QUAKE_COLLISION_UNIT_SCALE
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

function projectileSplashDamageAtDistance(profile: QuakeLinearProjectileFireProfile, distance: number): number {
  return radiusDamageAtDistance(profile.splashDamage ?? 0, distance, 0.5);
}

function radiusDamageAtDistance(damageUnits: number, distance: number, distanceScale: number): number {
  return damageUnits - distanceScale * (distance / QUAKE_COLLISION_UNIT_SCALE);
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
