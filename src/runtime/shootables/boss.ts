import {
  QUAKE_MONSTER_LOGIC,
  type QuakeMonsterScriptedLifecycle,
} from "../../generated/quakeMonsterLogic";

export type QuakeBossLifecycleSkillKey = keyof QuakeMonsterScriptedLifecycle["awake"]["healthBySkill"];

interface QuakeBossChainRunner {
  hasChain(chainName: string): boolean;
}

export interface QuakeBossRuntimeChainState {
  enemy?: {
    quakecRunner: QuakeBossChainRunner | null;
  };
}

export function quakeBossScriptedLifecycle(classname: string): QuakeMonsterScriptedLifecycle | null {
  const lifecycle = QUAKE_MONSTER_LOGIC[classname]?.scriptedLifecycle;
  return lifecycle?.kind === "boss" ? lifecycle : null;
}

export function quakeBossHealthForSkill(
  lifecycle: QuakeMonsterScriptedLifecycle,
  skill: number | undefined,
): number {
  return lifecycle.awake.healthBySkill[quakeBossSkillKey(skill)];
}

export function quakeBossSkillKey(skill: number | undefined): QuakeBossLifecycleSkillKey {
  const numericSkill = typeof skill === "number" && Number.isFinite(skill) ? skill : 1;
  const normalized = Math.max(0, Math.round(numericSkill));
  if (normalized <= 0) return "easy";
  if (normalized >= 2) return "hard";
  return "normal";
}

export function quakeBossPainBranchForHealth(
  lifecycle: QuakeMonsterScriptedLifecycle,
  health: number,
): QuakeMonsterScriptedLifecycle["lightning"]["painBranches"][number] | undefined {
  return lifecycle.lightning.painBranches.find((branch) =>
    (branch.afterHealth !== undefined && health === branch.afterHealth) ||
    (branch.afterHealthMin !== undefined && health >= branch.afterHealthMin)
  );
}

export function quakeBossRuntimeChainName(shootable: QuakeBossRuntimeChainState, chainName: string): string {
  const runner = shootable.enemy?.quakecRunner;
  if (!runner || runner.hasChain(chainName)) return chainName;
  if (chainName === "pain" && runner.hasChain("pain_a")) return "pain_a";
  return chainName;
}
