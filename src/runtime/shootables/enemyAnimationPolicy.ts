import { QUAKE_MONSTER_LOGIC, type QuakeMonsterLogicDefinition, type QuakeMonsterPainReactionProfile, type QuakeMonsterRandomBranch } from "../../generated/quakeMonsterLogic";
import type { QuakePickupModel } from "../pickups";
import { quakeShootableAttackChain } from "./enemyCombat";
import type {
  QuakeEnemyState,
  QuakeMonsterAnimationMode,
  QuakeMonsterAnimationProfile,
  QuakeMonsterAnimationRange,
  QuakeShootableState,
} from "./state";

const quakeMonsterLogicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, QuakeMonsterLogicDefinition>>;

export function boundedAnimationRange(
  range: QuakeMonsterAnimationRange,
  model: QuakePickupModel,
): QuakeMonsterAnimationRange {
  const maxFrameIndex = Math.max(0, (model.animationFrames?.length ?? 1) - 1);
  const start = Math.max(0, Math.min(maxFrameIndex, range.start));
  const end = Math.max(start, Math.min(maxFrameIndex, range.end));
  return { start, end };
}

export function enemyAnimationFrameDuration(
  profile: QuakeMonsterAnimationProfile,
  mode: QuakeMonsterAnimationMode,
): number {
  const fps = enemyAnimationFps(profile, mode);
  return 1000 / Math.max(1, fps ?? 8);
}

export function enemyAnimationModeLoops(mode: QuakeMonsterAnimationMode): boolean {
  return mode === "idle" || mode === "path" || mode === "walk";
}

export function enemyOptionalAnimationRange(
  profile: QuakeMonsterAnimationProfile,
  mode: QuakeMonsterAnimationMode,
): QuakeMonsterAnimationRange | undefined {
  if (mode === "attack") return profile.attack;
  if (mode === "death") return profile.death;
  if (mode === "pain") return profile.pain;
  if (mode === "path") return profile.walk ?? profile.idle;
  if (mode === "walk") return profile.walk ?? profile.idle;
  return profile.idle;
}

export function enemyAnimationRange(
  profile: QuakeMonsterAnimationProfile,
  mode: QuakeMonsterAnimationMode,
): QuakeMonsterAnimationRange {
  return enemyOptionalAnimationRange(profile, mode) ?? profile.idle;
}

export function enemyAnimationFps(
  profile: QuakeMonsterAnimationProfile,
  mode: QuakeMonsterAnimationMode,
): number | undefined {
  if (mode === "attack") return profile.attackFps ?? profile.fps;
  if (mode === "death") return profile.deathFps ?? profile.fps;
  if (mode === "pain") return profile.painFps ?? profile.fps;
  if (mode === "path") return profile.walkFps ?? profile.fps;
  if (mode === "walk") return profile.walkFps ?? profile.fps;
  return profile.idleFps ?? profile.fps;
}

export function quakecAnimationChainForMode(shootable: QuakeShootableState, mode: QuakeMonsterAnimationMode): string {
  if (mode === "attack") {
    return shootable.enemy?.pendingAttack?.quakecChain ?? quakeShootableAttackChain(shootable) ?? "attack";
  }
  if (mode === "death") return shootable.enemy?.quakecDeathChain ?? "death_a";
  if (mode === "pain") return shootable.enemy?.quakecPainChain ?? "pain_a";
  if (mode === "path") return "walk";
  if (mode === "walk") return "run";
  return "stand";
}

export function selectEnemyPainReactionChain(
  shootable: QuakeShootableState,
  enemy: QuakeEnemyState,
  now: number,
  damageAmount: number,
  nextRandom: (enemy: QuakeEnemyState) => number,
): string | null {
  const policy = quakeMonsterPainReactionPolicy(shootable.entity.classname);
  if (!policy) return quakeMonsterChainOrFallback(shootable.entity.classname, "pain_a", "pain_a");
  if (enemy.quakecPainFinishedUntil > now) return null;
  const flinchScale = policy.flinchDamageRandomScale;
  if (typeof flinchScale === "number" && nextRandom(enemy) * flinchScale > damageAmount) {
    if (policy.cooldownOnFailedFlinch && policy.cooldownMs) {
      enemy.quakecPainFinishedUntil = now + policy.cooldownMs;
    }
    return null;
  }
  const branch = selectQuakeMonsterReactionBranch(policy.branches, enemy, nextRandom);
  const chain = branch?.chain ?? "pain_a";
  const cooldownMs = branch?.cooldownMs ?? policy.cooldownMs ?? 0;
  if (cooldownMs > 0) enemy.quakecPainFinishedUntil = now + cooldownMs;
  return quakeMonsterChainOrFallback(shootable.entity.classname, chain, "pain_a");
}

function selectQuakeMonsterReactionBranch(
  branches: readonly QuakeMonsterRandomBranch[],
  enemy: QuakeEnemyState,
  nextRandom: (enemy: QuakeEnemyState) => number,
): QuakeMonsterRandomBranch | undefined {
  if (branches.length <= 1) return branches[0];
  const roll = nextRandom(enemy);
  return branches.find((branch) => quakeMonsterReactionBranchMatches(branch, roll)) ?? branches[branches.length - 1];
}

function quakeMonsterReactionBranchMatches(branch: QuakeMonsterRandomBranch, roll: number): boolean {
  if (branch.otherwise) return true;
  if (typeof branch.randomLessThan === "number" && roll < branch.randomLessThan) return true;
  if (typeof branch.randomGreaterThan === "number" && roll > branch.randomGreaterThan) return true;
  return branch.randomLessThan === undefined && branch.randomGreaterThan === undefined;
}

function quakeMonsterPainReactionPolicy(classname: string): QuakeMonsterPainReactionProfile | undefined {
  return quakeMonsterLogicByClassname[classname]?.reactionProfile?.pain;
}

function quakeMonsterChainOrFallback(classname: string, chain: string, fallback: string): string {
  const chains = quakeMonsterLogicByClassname[classname]?.chains;
  if (chains?.[chain]?.states.length) return chain;
  if (chains?.[fallback]?.states.length) return fallback;
  return chain;
}
