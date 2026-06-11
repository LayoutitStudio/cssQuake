import type { QuakeEntity } from "../../types/quake";
import type { QuakeProgramMetadata } from "../pickups";
import type { QuakeMonsterAnimationProfile, QuakeShootableState } from "./state";

export function quakeShootableModelPath(
  entity: QuakeEntity,
  programMetadata: QuakeProgramMetadata | null = null,
): string | null {
  if (entity.classname === "misc_explobox") return "maps/b_explob.bsp";
  if (entity.classname === "misc_explobox2") return "maps/b_exbox2.bsp";
  if (entity.classname.startsWith("monster_")) {
    return preferredMonsterModelPath(entity, programMetadata);
  }
  return null;
}

export function isRequiredShootableModel(entity: QuakeEntity, modelPath: string): boolean {
  return entity.classname.startsWith("monster_") && modelPath.startsWith("progs/") && modelPath.endsWith(".mdl");
}

export function missingRequiredShootableModelError(entity: QuakeEntity, modelPath: string): Error {
  return new Error(
    `Missing prepared Quake model ${modelPath} for ${entity.classname} #${entity.index}. ` +
      "This is a preload or asset bug, not a procedural fallback.",
  );
}

export function canUseShootableFallback(entity: QuakeEntity): boolean {
  return entity.classname === "misc_explobox" ||
    entity.classname === "misc_explobox2";
}

export function quakeMonsterAnimationProfile(
  shootable: QuakeShootableState,
): QuakeMonsterAnimationProfile | undefined {
  return QUAKE_MONSTER_ANIMATION_PROFILES[shootable.entity.classname];
}

function preferredMonsterModelPath(entity: QuakeEntity, programMetadata: QuakeProgramMetadata | null): string | null {
  const programModels = programMetadata?.modelsByClassname[entity.classname] ?? [];
  const expected = QUAKE_MONSTER_MODEL_PATHS[entity.classname];
  if (expected && (programModels.length === 0 || programModels.includes(expected))) return expected;
  return programModels.find(isQuakeMonsterBodyModel) ??
    programModels.find((model) => model.startsWith("progs/") && model.endsWith(".mdl")) ??
    expected ??
    null;
}

function isQuakeMonsterBodyModel(modelPath: string): boolean {
  const filename = modelPath.split("/").pop()?.toLowerCase() ?? "";
  return modelPath.startsWith("progs/") &&
    modelPath.endsWith(".mdl") &&
    !filename.startsWith("h_") &&
    !filename.includes("gib") &&
    !["bolt.mdl", "grenade.mdl", "k_spike.mdl", "lavaball.mdl", "laser.mdl", "s_light.mdl", "v_spike.mdl", "w_spike.mdl", "zom_gib.mdl"].includes(filename);
}

const QUAKE_MONSTER_ANIMATION_PROFILES: Record<string, QuakeMonsterAnimationProfile> = {
  monster_army: {
    attack: { start: 81, end: 89 },
    attackFps: 10,
    death: { start: 8, end: 17 },
    deathFps: 10,
    fps: 8,
    idle: { start: 0, end: 7 },
    pain: { start: 40, end: 45 },
    painFps: 10,
    walk: { start: 73, end: 80 },
  },
  monster_dog: {
    attack: { start: 0, end: 7 },
    attackFps: 12,
    death: { start: 8, end: 16 },
    deathFps: 10,
    idle: { start: 69, end: 77 },
    idleFps: 8,
    pain: { start: 26, end: 31 },
    painFps: 10,
    walk: { start: 48, end: 59 },
    walkFps: 10,
  },
  monster_demon1: {
    attack: { start: 54, end: 68 },
    attackFps: 10,
    death: { start: 45, end: 53 },
    deathFps: 10,
    idle: { start: 0, end: 12 },
    idleFps: 7,
    pain: { start: 39, end: 44 },
    painFps: 10,
    walk: { start: 21, end: 26 },
    walkFps: 10,
  },
  monster_knight: {
    attack: { start: 42, end: 52 },
    attackFps: 10,
    death: { start: 76, end: 85 },
    deathFps: 10,
    idle: { start: 0, end: 8 },
    idleFps: 7,
    pain: { start: 28, end: 30 },
    painFps: 10,
    walk: { start: 53, end: 66 },
    walkFps: 10,
  },
  monster_ogre: {
    attack: { start: 61, end: 66 },
    attackFps: 10,
    death: { start: 112, end: 125 },
    deathFps: 10,
    idle: { start: 0, end: 8 },
    idleFps: 7,
    pain: { start: 67, end: 71 },
    painFps: 10,
    walk: { start: 9, end: 24 },
    walkFps: 9,
  },
  monster_shambler: {
    attack: { start: 65, end: 76 },
    attackFps: 10,
    death: { start: 83, end: 93 },
    deathFps: 10,
    idle: { start: 0, end: 16 },
    idleFps: 7,
    pain: { start: 77, end: 82 },
    painFps: 10,
    walk: { start: 17, end: 28 },
    walkFps: 9,
  },
  monster_wizard: {
    attack: { start: 29, end: 41 },
    attackFps: 10,
    death: { start: 46, end: 53 },
    deathFps: 10,
    idle: { start: 0, end: 14 },
    idleFps: 8,
    pain: { start: 42, end: 45 },
    painFps: 10,
    walk: { start: 15, end: 28 },
    walkFps: 10,
  },
  monster_zombie: {
    attack: { start: 52, end: 64 },
    attackFps: 10,
    death: { start: 162, end: 191 },
    deathFps: 10,
    idle: { start: 0, end: 14 },
    idleFps: 7,
    pain: { start: 91, end: 102 },
    painFps: 10,
    walk: { start: 15, end: 33 },
    walkFps: 8,
  },
  monster_boss: {
    attack: { start: 57, end: 79 },
    attackFps: 10,
    death: { start: 48, end: 56 },
    deathFps: 10,
    idle: { start: 17, end: 47 },
    idleFps: 7,
    walk: { start: 17, end: 47 },
    walkFps: 7,
  },
};

const QUAKE_MONSTER_MODEL_PATHS: Record<string, string> = {
  monster_army: "progs/soldier.mdl",
  monster_dog: "progs/dog.mdl",
  monster_enforcer: "progs/enforcer.mdl",
  monster_fish: "progs/fish.mdl",
  monster_knight: "progs/knight.mdl",
  monster_ogre: "progs/ogre.mdl",
  monster_wizard: "progs/wizard.mdl",
  monster_zombie: "progs/zombie.mdl",
  monster_demon1: "progs/demon.mdl",
  monster_hell_knight: "progs/hknight.mdl",
  monster_shalrath: "progs/shalrath.mdl",
  monster_shambler: "progs/shambler.mdl",
  monster_tarbaby: "progs/tarbaby.mdl",
  monster_boss: "progs/boss.mdl",
  monster_oldone: "progs/oldone.mdl",
};
