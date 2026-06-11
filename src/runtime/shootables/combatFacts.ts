import {
  QUAKE_MONSTER_COMBAT_POLICIES,
  QUAKE_MONSTER_LOGIC,
  type QuakeMonsterCombatPolicy,
  type QuakeMonsterFrameState,
} from "../../generated/quakeMonsterLogic";
import { QUAKE_COLLISION_UNIT_SCALE } from "../constants";

const QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS = 100;
const QUAKE_MONSTER_QUAKEC_AI_FRAME_RATE = 1000 / QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
const QUAKEC_SOLDIER_AI_RUN_SPEED = 108.75 * QUAKE_COLLISION_UNIT_SCALE;

const quakeMonsterCombatPolicies = QUAKE_MONSTER_COMBAT_POLICIES as Readonly<Record<string, QuakeMonsterCombatPolicy>>;
const quakeMonsterLogicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, {
  chains: Record<string, { states: QuakeMonsterFrameState[] }>;
}>>;

export interface QuakeMonsterCombatProfile {
  burstCount?: number;
  burstIntervalMs?: number;
  cooldownRandomAddMs?: number;
  chaseStopDistance?: number;
  chaseSpeed?: number;
  cooldownJitterMs?: number;
  damage: number;
  cooldownMs: number;
  kind?: "hitscan" | "projectile" | "touch";
  projectileAimError?: number;
  projectileGravity?: number;
  projectileOriginOffset?: QuakeMonsterProjectileOffset;
  projectileClassname?: string;
  projectileLifetimeMs?: number;
  projectileModelPath?: string;
  projectileRadius?: number;
  projectileScale?: number;
  projectileSpeed?: number;
  projectileSplashDamage?: number;
  projectileSplashOnExpire?: boolean;
  projectileSplashRadius?: number;
  projectileTargetOffset?: QuakeMonsterProjectileOffset;
  projectileVerticalAimError?: number;
  projectileVerticalVelocity?: number;
  range: number;
  wakeDelayJitterMs?: number;
  wakeDelayMs?: number;
  windupMs?: number;
  projectileAimDrop?: number;
}

export interface QuakeMonsterProjectileOffset {
  forward?: number;
  right?: number;
  up?: number;
}

const QUAKEC_SOLDIER_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_army?.attack;
const QUAKEC_DOG_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_dog?.attack;
const QUAKEC_DEMON_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_demon1?.attack;
const QUAKEC_KNIGHT_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_knight?.attack;
const QUAKEC_OGRE_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_ogre?.attack;
const QUAKEC_SHAMBLER_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_shambler?.attack;
const QUAKEC_WIZARD_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_wizard?.attack;
const QUAKEC_ZOMBIE_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_zombie?.attack;
const QUAKEC_BOSS_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_boss?.attack;

const QUAKEC_MONSTER_COMBAT_PROFILES: Record<string, QuakeMonsterCombatProfile> = {
  monster_army: {
    chaseSpeed: quakecMonsterRunSpeed("monster_army", QUAKEC_SOLDIER_AI_RUN_SPEED),
    chaseStopDistance: 160 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_SOLDIER_ATTACK_POLICY?.cooldownMs ?? 1000,
    cooldownRandomAddMs: QUAKEC_SOLDIER_ATTACK_POLICY?.cooldownRandomAddMs ?? 1000,
    damage: QUAKEC_SOLDIER_ATTACK_POLICY?.damage ?? 16,
    kind: "hitscan",
    range: (QUAKEC_SOLDIER_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 4 * QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS,
  },
  monster_dog: {
    chaseSpeed: quakecMonsterRunSpeed("monster_dog", 320 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 80 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_DOG_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_DOG_ATTACK_POLICY?.cooldownRandomAddMs ?? 0,
    damage: QUAKEC_DOG_ATTACK_POLICY?.damage ?? 24,
    kind: "touch",
    range: 150 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_demon1: {
    chaseSpeed: quakecMonsterRunSpeed("monster_demon1", 260 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 120 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_DEMON_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_DEMON_ATTACK_POLICY?.cooldownRandomAddMs ?? 0,
    damage: QUAKEC_DEMON_ATTACK_POLICY?.damage ?? 50,
    kind: "touch",
    range: 200 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_knight: {
    chaseSpeed: quakecMonsterRunSpeed("monster_knight", 180 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 140 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_KNIGHT_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_KNIGHT_ATTACK_POLICY?.cooldownRandomAddMs ?? 0,
    damage: QUAKEC_KNIGHT_ATTACK_POLICY?.damage ?? 9,
    kind: "touch",
    range: (QUAKEC_KNIGHT_ATTACK_POLICY?.rangeUnits.melee ?? 120) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_ogre: {
    chaseSpeed: quakecMonsterRunSpeed("monster_ogre", 180 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 180 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_OGRE_ATTACK_POLICY?.cooldownMs ?? 1000,
    cooldownRandomAddMs: QUAKEC_OGRE_ATTACK_POLICY?.cooldownRandomAddMs ?? 2000,
    damage: QUAKEC_OGRE_ATTACK_POLICY?.damage ?? 40,
    kind: "projectile",
    range: (QUAKEC_OGRE_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_shambler: {
    chaseSpeed: quakecMonsterRunSpeed("monster_shambler", 160 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 220 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_SHAMBLER_ATTACK_POLICY?.cooldownMs ?? 2000,
    cooldownRandomAddMs: QUAKEC_SHAMBLER_ATTACK_POLICY?.cooldownRandomAddMs ?? 2000,
    damage: QUAKEC_SHAMBLER_ATTACK_POLICY?.damage ?? 120,
    kind: "hitscan",
    range: 600 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_wizard: {
    chaseSpeed: quakecMonsterRunSpeed("monster_wizard", 160 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 220 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_WIZARD_ATTACK_POLICY?.cooldownMs ?? 2000,
    cooldownRandomAddMs: QUAKEC_WIZARD_ATTACK_POLICY?.cooldownRandomAddMs ?? 0,
    damage: QUAKEC_WIZARD_ATTACK_POLICY?.damage ?? 9,
    kind: "projectile",
    range: (QUAKEC_WIZARD_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_zombie: {
    chaseSpeed: quakecMonsterRunSpeed("monster_zombie", 120 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 180 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_ZOMBIE_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_ZOMBIE_ATTACK_POLICY?.cooldownRandomAddMs ?? 2000,
    damage: QUAKEC_ZOMBIE_ATTACK_POLICY?.damage ?? 10,
    kind: "projectile",
    range: (QUAKEC_ZOMBIE_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_boss: {
    cooldownMs: QUAKEC_BOSS_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_BOSS_ATTACK_POLICY?.cooldownRandomAddMs ?? 2000,
    damage: QUAKEC_BOSS_ATTACK_POLICY?.damage ?? 120,
    kind: "projectile",
    range: (QUAKEC_BOSS_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
};

export function quakeMonsterCombatProfile(classname: string): QuakeMonsterCombatProfile | undefined {
  return QUAKEC_MONSTER_COMBAT_PROFILES[classname];
}

export function quakeMonsterRunSpeedUnitsPerSecond(classname: string): number | null {
  const distances = quakecMonsterRunMovementDistances(classname);
  if (!distances.length) return null;
  const total = distances.reduce((sum, distance) => sum + distance, 0);
  return (total / distances.length) * QUAKE_MONSTER_QUAKEC_AI_FRAME_RATE;
}

export function quakecMonsterHasRunMovement(classname: string): boolean {
  return quakecMonsterRunMovementDistances(classname).length > 0;
}

export function quakecMonsterHasMovement(classname: string, callName: "ai_run" | "ai_walk"): boolean {
  const chain = callName === "ai_run" ? "run" : "walk";
  return quakecMonsterMovementDistances(classname, chain, callName).length > 0;
}

export function quakeMonsterCanAcquirePlayer(playerInvisible: boolean): boolean {
  return !playerInvisible;
}

function quakecMonsterRunSpeed(classname: string, fallback: number): number {
  const sourceUnitsPerSecond = quakeMonsterRunSpeedUnitsPerSecond(classname);
  return typeof sourceUnitsPerSecond === "number"
    ? sourceUnitsPerSecond * QUAKE_COLLISION_UNIT_SCALE
    : fallback;
}

function quakecMonsterRunMovementDistances(classname: string): number[] {
  return quakecMonsterMovementDistances(classname, "run", "ai_run");
}

function quakecMonsterMovementDistances(
  classname: string,
  chain: string,
  callName: "ai_run" | "ai_walk",
): number[] {
  const states = quakeMonsterLogicByClassname[classname]?.chains[chain]?.states ?? [];
  return states.flatMap((state) => quakeMonsterAiMovementDistances(state, callName));
}

function quakeMonsterAiMovementDistances(
  state: QuakeMonsterFrameState,
  callName: "ai_run" | "ai_walk",
): number[] {
  return (state.movement ?? [])
    .filter((movement) => movement.call === callName && typeof movement.distanceUnits === "number")
    .map((movement) => movement.distanceUnits as number);
}
