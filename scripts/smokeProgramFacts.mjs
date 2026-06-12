import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  deriveQuakeGameLogicAssetRefs,
  deriveQuakeGameLogicModelPreloads,
  deriveQuakeGameLogicSoundPreloads,
} from "../src/prepare/gameLogicPreloads.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const generatedFactsJsonPath = path.join(projectRoot, "src/generated/quakeProgramFacts.json");
const generatedFactsPath = path.join(projectRoot, "src/generated/quakeProgramFacts.ts");
const generatedMonsterLogicPath = path.join(projectRoot, "src/generated/quakeMonsterLogic.ts");
const pickupModelsPath = path.join(projectRoot, "build/generated/public/q/pickups.json");
const soundManifestPath = path.join(projectRoot, "build/generated/public/q/sounds.json");

async function importBundledModule(entryPath) {
  const { outputFiles } = await build({
    bundle: true,
    entryPoints: [entryPath],
    format: "esm",
    logLevel: "silent",
    platform: "node",
    write: false,
  });

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`;
  return import(moduleUrl);
}

async function readGeneratedJson(filePath, helpText) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    error.message = `${helpText}\n${error.message}`;
    throw error;
  }
}

const { QUAKE_PROGRAM_FACTS } = await importBundledModule(generatedFactsPath);
const {
  QUAKE_MONSTER_COMBAT_POLICIES,
  QUAKE_MONSTER_LOGIC,
  QUAKE_SHOOTABLE_LOGIC,
} = await importBundledModule(generatedMonsterLogicPath);
const entities = QUAKE_PROGRAM_FACTS.entities;
const jsonFacts = await readGeneratedJson(generatedFactsJsonPath, "Run pnpm prepare:quake-logic before this smoke.");
const jsonEntities = jsonFacts.entities;
const playerWeaponFacts = QUAKE_PROGRAM_FACTS.playerWeapons;
const playerWeaponProfiles = playerWeaponFacts?.profiles ?? {};
const jsonPlayerWeaponProfiles = jsonFacts.playerWeapons?.profiles ?? {};
const expectedWeaponViewModels = {
  axe: "progs/v_axe.mdl",
  shotgun: "progs/v_shot.mdl",
  supershotgun: "progs/v_shot2.mdl",
  nailgun: "progs/v_nail.mdl",
  supernailgun: "progs/v_nail2.mdl",
  grenadelauncher: "progs/v_rock.mdl",
  rocketlauncher: "progs/v_rock2.mdl",
  lightning: "progs/v_light.mdl",
};
const fireAnimation = (weapon) => playerWeaponProfiles[weapon]?.presentation?.fireAnimation;
const fireAnimationFrames = (weapon, variantIndex = 0) =>
  fireAnimation(weapon)?.variants?.[variantIndex]?.frames?.map((frame) => frame.weaponFrame);
const armorTouchBranch = (entity, classname) =>
  entity?.callbackFacts?.armor_touch?.classnameBranches?.find((branch) => branch.classname === classname);
const powerupTouchBranch = (entity, classname) =>
  entity?.callbackFacts?.powerup_touch?.classnameBranches?.find((branch) => branch.classname === classname);
const weaponTouchBranch = (entity, classname) =>
  entity?.callbackFacts?.weapon_touch?.classnameBranches?.find((branch) => branch.classname === classname);
const armorBranchValue = (branch, field) => branch?.assignments?.find((assignment) => assignment.field === field)?.value;
const armorBranchExpression = (branch, field) =>
  branch?.assignments?.find((assignment) => assignment.field === field)?.expression;
const callbackCalls = (entity, callbackName, call) => entity?.callbackFacts?.[callbackName]?.calls?.includes(call) ?? false;
const callbackAssetPaths = (entity, callbackName, kind) =>
  new Set(
    (entity?.callbackFacts?.[callbackName]?.assetRefs ?? [])
      .filter((asset) => !kind || asset.kind === kind)
      .map((asset) => asset.path),
  );
const callbackAssignmentExpression = (entity, callbackName, field) =>
  entity?.callbackFacts?.[callbackName]?.assignments?.find((assignment) => assignment.field === field)?.expression;
const derivedAssetRefs = deriveQuakeGameLogicAssetRefs({
  programFacts: QUAKE_PROGRAM_FACTS,
  entities: [
    { entityIndex: 1, classname: "light_globe" },
    { entityIndex: 2, classname: "trigger_push" },
    { entityIndex: 3, classname: "item_sigil" },
  ],
});
const derivedAssetRefKeys = new Set(
  derivedAssetRefs.assetRefs.map((asset) => `${asset.kind}:${asset.path}`),
);
const assetOnlyModelPreloads = deriveQuakeGameLogicModelPreloads({
  programFacts: {
    entities: {
      item_sigil: {
        assetRefs: entities.item_sigil?.assetRefs ?? [],
        dependencies: { models: [], sounds: [] },
      },
    },
  },
  entities: [
    { entityIndex: 4, classname: "item_sigil", spawnflags: 0 },
  ],
});
const assetOnlySoundPreloads = deriveQuakeGameLogicSoundPreloads({
  programFacts: {
    entities: {
      item_sigil: {
        assetRefs: entities.item_sigil?.assetRefs ?? [],
        dependencies: { models: [], sounds: [] },
      },
      trigger_push: {
        assetRefs: entities.trigger_push?.assetRefs ?? [],
        dependencies: { models: [], sounds: [] },
      },
    },
  },
  entities: [
    { entityIndex: 5, classname: "item_sigil" },
    { entityIndex: 6, classname: "trigger_push" },
  ],
});
const monsterCallbackSoundPreloads = deriveQuakeGameLogicSoundPreloads({
  programFacts: QUAKE_PROGRAM_FACTS,
  entities: [
    { entityIndex: 11, classname: "monster_army" },
    { entityIndex: 12, classname: "monster_zombie" },
  ],
});
const preparedSounds = await readGeneratedJson(soundManifestPath, "Run pnpm prepare:quake before this smoke.");
const preparedSoundPreloads = deriveQuakeGameLogicSoundPreloads({
  programFacts: QUAKE_PROGRAM_FACTS,
  entities: [
    { entityIndex: 7, classname: "item_sigil" },
    { entityIndex: 8, classname: "trigger_push" },
    { entityIndex: 9, classname: "monster_army" },
    { entityIndex: 10, classname: "item_health" },
  ],
}, {
  preparedSoundPaths: Object.keys(preparedSounds.sounds ?? {}),
});
const preparedPickups = await readGeneratedJson(pickupModelsPath, "Run pnpm prepare:quake before this smoke.");
const soldierLogic = QUAKE_MONSTER_LOGIC.monster_army;
const dogLogic = QUAKE_MONSTER_LOGIC.monster_dog;
const ogreLogic = QUAKE_MONSTER_LOGIC.monster_ogre;
const zombieLogic = QUAKE_MONSTER_LOGIC.monster_zombie;
const soldierAttackPolicy = QUAKE_MONSTER_COMBAT_POLICIES.monster_army?.attack;
const bossLogic = QUAKE_MONSTER_LOGIC.monster_boss;
const exploboxRadiusDamage = QUAKE_SHOOTABLE_LOGIC.misc_explobox?.death?.radiusDamage;
const explobox2RadiusDamage = QUAKE_SHOOTABLE_LOGIC.misc_explobox2?.death?.radiusDamage;
const rawExploboxRadiusDamage = entities.misc_explobox?.callbackFacts?.barrel_explode?.radiusDamage?.[0];
const expectedMonsterSpawnHealth = {
  monster_army: 30,
  monster_demon1: 300,
  monster_dog: 25,
  monster_knight: 75,
  monster_ogre: 200,
  monster_shambler: 600,
  monster_wizard: 80,
  monster_zombie: 60,
};
const generatedMonsterSpawnHealth = Object.fromEntries(
  Object.entries(QUAKE_MONSTER_LOGIC)
    .filter(([, logic]) => typeof logic.spawnProfile?.health === "number")
    .map(([classname, logic]) => [classname, logic.spawnProfile.health])
    .sort(([a], [b]) => a.localeCompare(b)),
);
const soldierModel = preparedPickups.models?.["progs/soldier.mdl"];
const soldierFrames = soldierModel?.animationFrames ?? [];
const soldierFrameNames = new Set(soldierFrames.map((frame) => frame.name));
const soldierFrameStates = Object.entries(soldierLogic?.chains ?? {}).flatMap(([chainName, chain]) =>
  (chain.states ?? []).map((state) => ({ chainName, state })),
);
const soldierUniqueFrameStateNames = new Set(soldierFrameStates.map(({ state }) => state.name));
const soldierChainLengths = Object.fromEntries(
  Object.entries(soldierLogic?.chains ?? {}).map(([name, chain]) => [name, chain.states?.length ?? 0]),
);
const expectedSoldierChainLengths = {
  attack: 9,
  death_a: 10,
  death_c: 11,
  missile: 9,
  pain_a: 6,
  pain_b: 14,
  pain_c: 13,
  run: 8,
  stand: 8,
  walk: 24,
};
const expectedBestWeaponOrder = ["lightning", "supernailgun", "supershotgun", "nailgun", "shotgun", "axe"];
const soldierAttackFireEvents = (soldierLogic?.chains?.attack?.states ?? []).flatMap((state) =>
  (state.events ?? []).map((event) => ({ state, event })),
);
const soldierArmyFireEvent = soldierAttackFireEvents.find(({ state, event }) =>
  state.name === "army_atk5" &&
  event.call === "army_fire" &&
  event.type === "fire_bullets"
);
const ogreAttackProjectileEvents = (ogreLogic?.chains?.attack?.states ?? []).flatMap((state) =>
  (state.events ?? []).map((event) => ({ state, event })),
);
const ogreGrenadeEvent = ogreAttackProjectileEvents.find(({ state, event }) =>
  state.name === "ogre_nail4" &&
  event.call === "OgreFireGrenade" &&
  event.type === "projectile"
);
const ogreMeleeDamageEvents = (ogreLogic?.chains?.melee?.states ?? []).flatMap((state) =>
  (state.events ?? []).map((event) => ({ state, event })),
);
const zombieProjectileEvent = (zombieLogic?.chains?.attack?.states ?? [])
  .flatMap((state) => (state.events ?? []).map((event) => ({ state, event })))
  .find(({ state, event }) =>
    state.name === "zombie_atta13" &&
    event.call === "ZombieFireGrenade" &&
    event.type === "projectile"
  );
const zombiePainDownStates = zombieLogic?.chains?.pain_down?.states ?? [];
const knightMeleeDamageEvents = (QUAKE_MONSTER_LOGIC.monster_knight?.chains?.attack?.states ?? []).flatMap((state) =>
  (state.events ?? []).map((event) => ({ state, event })),
);
const wizardProjectileEvents = (QUAKE_MONSTER_LOGIC.monster_wizard?.chains?.attack?.states ?? []).flatMap((state) =>
  (state.events ?? []).map((event) => ({ state, event })),
);
const soldierRefireState = soldierLogic?.chains?.attack?.states?.find((state) => state.name === "army_atk7");
const soldierMissingModelFrames = soldierFrameStates.filter(({ state }) => !soldierFrameNames.has(state.frame));
const soldierMismatchedFrameIndexes = soldierFrameStates.filter(({ state }) => {
  if (!Number.isInteger(state.frameIndex)) return true;
  return soldierFrames[state.frameIndex]?.name !== state.frame;
});
const soldierMissingRenderBundles = soldierFrames.filter(
  (frame) =>
    !frame.renderBundle?.leafFrameStylesUrl ||
    !Number.isInteger(frame.renderBundle.leafFrameStylesIndex),
);

const checks = [
  [
    entities.worldspawn?.functionName === "worldspawn" &&
      entities.worldspawn.kind === "worldspawn" &&
      entities.worldspawn.source?.sourceFile === "qcc/v101qc/world.qc" &&
      entities.worldspawn.assetRefs.length === 0 &&
      entities.worldspawn.dependencies.models.length === 0 &&
      entities.worldspawn.dependencies.sounds.length === 0 &&
      entities.worldspawn.calls.includes("InitBodyQue") &&
      entities.worldspawn.calls.includes("W_Precache") &&
      entities.worldspawn.calls.includes("lightstyle"),
    "worldspawn should expose compact source/call facts without broad precache asset refs",
  ],
  [
    entities.monster_army?.dependencies.models.some((dep) => dep.path === "progs/soldier.mdl"),
    "monster_army should include progs/soldier.mdl",
  ],
  [
    entities.monster_army?.assetRefs.some((dep) => dep.kind === "model" && dep.path === "progs/soldier.mdl"),
    "monster_army should classify progs/soldier.mdl as a model asset",
  ],
  [
    ["progs/h_guard.mdl", "progs/gib1.mdl", "progs/gib2.mdl", "progs/gib3.mdl"].every((modelPath) =>
      callbackAssetPaths(entities.monster_army, "army_die", "model").has(modelPath)
    ) &&
      callbackAssetPaths(entities.monster_army, "army_die", "sound").has("player/udeath.wav"),
    "monster_army army_die callback facts should expose source-backed head/gib model and death sound assets",
  ],
  [
    entities.monster_dog?.dependencies.models.some((dep) => dep.path === "progs/dog.mdl"),
    "monster_dog should include progs/dog.mdl",
  ],
  [
    ["progs/h_dog.mdl", "progs/gib3.mdl"].every((modelPath) =>
      callbackAssetPaths(jsonEntities.monster_dog, "dog_die", "model").has(modelPath)
    ) &&
      callbackAssetPaths(jsonEntities.monster_dog, "dog_die", "sound").has("player/udeath.wav"),
    "monster_dog dog_die JSON callback facts should expose source-backed head/gib model and death sound assets",
  ],
  [
    entities.monster_dog?.setsizes.some((setsize) =>
      JSON.stringify(setsize.min) === JSON.stringify([-32, -32, -24]) &&
      JSON.stringify(setsize.max) === JSON.stringify([32, 32, 40])
    ),
    "monster_dog should include QuakeC setsize bounds",
  ],
  [
    entities.item_health?.spawnflagChecks.some((flag) => flag.name === "H_ROTTEN" && flag.value === 1),
    "item_health should include H_ROTTEN=1",
  ],
  [
    entities.item_health?.spawnflagChecks.some((flag) => flag.name === "H_MEGA" && flag.value === 2),
    "item_health should include H_MEGA=2",
  ],
  [
    entities.item_health?.assetRefs.some((dep) => dep.kind === "bsp" && dep.path === "maps/b_bh25.bsp"),
    "item_health should classify maps/b_bh25.bsp as a BSP asset",
  ],
  [
    armorBranchValue(armorTouchBranch(entities.item_armor1, "item_armor1"), "type") === 0.3 &&
      armorBranchValue(armorTouchBranch(entities.item_armor1, "item_armor2"), "type") === 0.6 &&
      armorBranchValue(armorTouchBranch(entities.item_armor1, "item_armorInv"), "type") === 0.8 &&
      armorBranchValue(armorTouchBranch(entities.item_armor1, "item_armorInv"), "value") === 200 &&
      armorBranchExpression(armorTouchBranch(entities.item_armor1, "item_armorInv"), "bit") === "IT_ARMOR3",
    "item armor source facts should expose armor_touch classname branch values",
  ],
  [
    callbackAssignmentExpression(entities.item_armor1, "armor_touch", "self.model") === "string_null" &&
      callbackAssignmentExpression(entities.item_armor1, "armor_touch", "self.solid") === "SOLID_NOT" &&
      callbackAssignmentExpression(entities.item_armor1, "armor_touch", "self.think") === "SUB_regen" &&
      callbackAssignmentExpression(entities.item_armor1, "armor_touch", "self.nextthink") === "time + 20" &&
      callbackCalls(entities.item_armor1, "armor_touch", "SUB_UseTargets"),
    "item armor source facts should expose pickup removal, respawn, and target-use assignments",
  ],
  [
    callbackAssignmentExpression(entities.weapon_rocketlauncher, "weapon_touch", "self.nextthink") === "time + 30" &&
      callbackAssignmentExpression(entities.item_rockets, "ammo_touch", "self.nextthink") === "time + 30" &&
      callbackAssignmentExpression(entities.item_key1, "key_touch", "self.model") === "string_null" &&
      callbackAssignmentExpression(entities.item_key1, "key_touch", "other.items") === "other.items | self.items" &&
      callbackCalls(entities.item_key1, "key_touch", "SUB_UseTargets"),
    "weapon, ammo, and key source facts should expose pickup lifecycle and item mutation callback summaries",
  ],
  [
    armorBranchValue(weaponTouchBranch(entities.weapon_rocketlauncher, "weapon_nailgun"), "new") === 4 &&
      armorBranchExpression(weaponTouchBranch(entities.weapon_rocketlauncher, "weapon_nailgun"), "new") === "IT_NAILGUN" &&
      armorBranchExpression(
        weaponTouchBranch(entities.weapon_rocketlauncher, "weapon_nailgun"),
        "other.ammo_nails",
      ) === "other.ammo_nails + 30" &&
      armorBranchValue(weaponTouchBranch(entities.weapon_rocketlauncher, "weapon_rocketlauncher"), "new") === 32 &&
      armorBranchExpression(
        weaponTouchBranch(entities.weapon_rocketlauncher, "weapon_rocketlauncher"),
        "other.ammo_rockets",
      ) === "other.ammo_rockets + 5" &&
      armorBranchExpression(
        weaponTouchBranch(entities.weapon_rocketlauncher, "weapon_lightning"),
        "other.ammo_cells",
      ) === "other.ammo_cells + 15" &&
      callbackCalls(entities.weapon_rocketlauncher, "weapon_touch", "Deathmatch_Weapon") &&
      callbackCalls(entities.weapon_rocketlauncher, "weapon_touch", "W_SetCurrentAmmo"),
    "weapon_touch source facts should expose weapon item flags, ammo grants, and active-weapon calls",
  ],
  [
    armorBranchValue(powerupTouchBranch(entities.item_artifact_super_damage, "item_artifact_super_damage"), "other.super_time") === 1 &&
      armorBranchExpression(
        powerupTouchBranch(entities.item_artifact_super_damage, "item_artifact_super_damage"),
        "other.super_damage_finished",
      ) === "time + 30" &&
      armorBranchValue(powerupTouchBranch(entities.item_artifact_envirosuit, "item_artifact_envirosuit"), "other.rad_time") === 1 &&
      armorBranchExpression(
        powerupTouchBranch(entities.item_artifact_invisibility, "item_artifact_invisibility"),
        "other.invisible_finished",
      ) === "time + 30",
    "item artifact source facts should expose powerup_touch timer branches",
  ],
  [
    callbackAssignmentExpression(entities.item_artifact_super_damage, "powerup_touch", "other.items") ===
      "other.items | self.items",
    "item artifact source facts should expose powerup item flag mutation",
  ],
  [
    callbackAssignmentExpression(entities.item_artifact_super_damage, "powerup_touch", "self.nextthink") === "time + 60*5" &&
      entities.item_artifact_super_damage.callbackFacts?.powerup_touch?.assignments?.some((assignment) =>
        assignment.field === "self.nextthink" && assignment.expression === "time + 60"
      ) &&
      callbackAssignmentExpression(entities.item_artifact_super_damage, "powerup_touch", "self.think") === "SUB_regen" &&
      callbackCalls(entities.item_artifact_super_damage, "powerup_touch", "SUB_UseTargets"),
    "item artifact source facts should expose powerup respawn and target-use callback summaries",
  ],
  [
    monsterCallbackSoundPreloads.entities.some((entry) =>
      entry.entityIndex === 11 &&
      entry.soundPaths.includes("player/udeath.wav")
    ) &&
      monsterCallbackSoundPreloads.entities.some((entry) =>
        entry.entityIndex === 12 &&
        entry.soundPaths.includes("zombie/z_gib.wav")
      ),
    `source-backed callback sound preloads should include monster death sounds: ${
      JSON.stringify(monsterCallbackSoundPreloads.entities)
    }`,
  ],
  [
    entities.light_globe?.assetRefs.some((dep) => dep.kind === "sprite" && dep.path === "progs/s_light.spr") &&
      entities.light_globe?.dependencies.models.some((dep) => dep.path === "progs/s_light.spr"),
    "light_globe should classify progs/s_light.spr as a sprite asset while preserving legacy model dependencies",
  ],
  [
    entities.func_plat?.defaultAssignments.some((assignment) => assignment.field === "speed" && assignment.value === 150),
    "func_plat should default speed to 150",
  ],
  [
    entities.func_plat?.callbacks.blocked === "plat_crush",
    "func_plat should expose plat_crush blocked callback",
  ],
  [
    entities.func_plat?.dependencies.sounds.some((dep) => dep.path === "plats/medplat1.wav"),
    "func_plat should include medium platform sound dependencies",
  ],
  [
    !entities.func_plat?.fieldAssignments.some((assignment) => assignment.expression.includes("= 0)") || assignment.expression.includes("= 1)")),
    "func_plat field assignments should not parse equality checks as assignments",
  ],
  [
    entities.func_door?.defaultAssignments.some((assignment) => assignment.field === "wait" && assignment.value === 3),
    "func_door should default wait to 3",
  ],
  [
    entities.func_train?.defaultAssignments.some((assignment) => assignment.field === "speed" && assignment.value === 100) &&
      entities.func_train?.defaultAssignments.some((assignment) => assignment.field === "dmg" && assignment.value === 2),
    "func_train should include QuakeC speed and damage defaults",
  ],
  [
    entities.func_train?.callbacks.blocked === "train_blocked" &&
      entities.func_train?.callbacks.use === "train_use" &&
      entities.func_train?.callbacks.think === "func_train_find",
    "func_train should expose blocked/use/think callbacks",
  ],
  [
    entities.func_train?.dependencies.sounds.some((dep) => dep.path === "misc/null.wav") &&
      entities.func_train?.dependencies.sounds.some((dep) => dep.path === "plats/train1.wav") &&
      entities.func_train?.dependencies.sounds.some((dep) => dep.path === "plats/train2.wav"),
    "func_train should include QuakeC train sound dependencies",
  ],
  [
    entities.trigger_multiple?.defaultAssignments.some((assignment) => assignment.field === "wait" && assignment.value === 0.2),
    "trigger_multiple should default wait to 0.2",
  ],
  [
    entities.trigger_once?.fieldAssignments.some((assignment) => assignment.field === "wait" && assignment.value === -1),
    "trigger_once should set wait to -1",
  ],
  [
    entities.trigger_secret?.fieldAssignments.some((assignment) => assignment.field === "wait" && assignment.value === -1) &&
      entities.trigger_secret?.defaultAssignments.some((assignment) => assignment.field === "message" && assignment.value === "You found a secret area!") &&
      entities.trigger_secret?.defaultAssignments.some((assignment) => assignment.field === "sounds" && assignment.value === 1),
    "trigger_secret should set wait to -1 and include QuakeC message/sound defaults",
  ],
  [
    entities.trigger_secret?.dependencies.sounds.some((dep) => dep.path === "misc/secret.wav") &&
      entities.trigger_secret?.dependencies.sounds.some((dep) => dep.path === "misc/talk.wav") &&
      entities.trigger_secret?.calls.includes("trigger_multiple"),
    "trigger_secret should include secret/talk sounds and trigger_multiple delegation",
  ],
  [
    entities.trigger_counter?.callbacks.use === "counter_use" &&
      entities.trigger_counter?.defaultAssignments.some((assignment) => assignment.field === "count" && assignment.value === 2) &&
      entities.trigger_counter?.fieldAssignments.some((assignment) => assignment.field === "wait" && assignment.value === -1),
    "trigger_counter should expose counter_use, count default, and wait -1",
  ],
  [
    entities.trigger_relay?.callbacks.use === "SUB_UseTargets",
    "trigger_relay should expose SUB_UseTargets use callback",
  ],
  [
    entities.trigger_onlyregistered?.callbacks.touch === "trigger_onlyregistered_touch" &&
      entities.trigger_onlyregistered?.calls.includes("InitTrigger") &&
      entities.trigger_onlyregistered?.dependencies.sounds.some((dep) => dep.path === "misc/talk.wav"),
    "trigger_onlyregistered should expose touch callback, InitTrigger, and talk sound",
  ],
  [
    entities.trigger_setskill?.callbacks.touch === "trigger_skill_touch" &&
      entities.trigger_setskill?.calls.includes("InitTrigger"),
    "trigger_setskill should expose skill touch callback and InitTrigger",
  ],
  [
    entities.trigger_hurt?.defaultAssignments.some((assignment) => assignment.field === "dmg" && assignment.value === 5),
    "trigger_hurt should default dmg to 5",
  ],
  [
    entities.trigger_teleport?.callbacks.touch === "teleport_touch" &&
      entities.trigger_teleport?.callbacks.use === "teleport_use",
    "trigger_teleport should expose touch/use callbacks",
  ],
  [
    entities.trigger_teleport?.spawnflagChecks.some((flag) => flag.name === "SILENT" && flag.value === 2),
    "trigger_teleport should include SILENT spawnflag",
  ],
  [
    entities.trigger_push?.callbacks.touch === "trigger_push_touch" &&
      entities.trigger_push?.defaultAssignments.some((assignment) => assignment.field === "speed" && assignment.value === 1000) &&
      entities.trigger_push?.dependencies.sounds.some((dep) => dep.path === "ambience/windfly.wav"),
    "trigger_push should expose touch callback, speed default, and windfly sound",
  ],
  [
    entities.trigger_push?.assetRefs.some((dep) => dep.kind === "sound" && dep.path === "ambience/windfly.wav"),
    "trigger_push should classify ambience/windfly.wav as a sound asset",
  ],
  [
    derivedAssetRefKeys.has("sprite:progs/s_light.spr") &&
      derivedAssetRefKeys.has("sound:ambience/windfly.wav") &&
      derivedAssetRefKeys.has("model:progs/end1.mdl"),
    "gameLogic preload asset refs should derive model, sprite, and sound paths from source program facts",
  ],
  [
    derivedAssetRefs.assetPathsByKind.sprite?.includes("progs/s_light.spr") &&
      derivedAssetRefs.assetPathsByKind.sound?.includes("ambience/windfly.wav") &&
      derivedAssetRefs.assetPathsByKind.model?.includes("progs/end1.mdl"),
    "gameLogic preload asset refs should expose stable per-kind path summaries",
  ],
  [
    assetOnlyModelPreloads.entities.some((entry) =>
      entry.entityIndex === 4 &&
      entry.classname === "item_sigil" &&
      entry.modelPaths.includes("progs/end1.mdl")
    ),
    "gameLogic model preloads should consume normalized source asset refs before legacy model dependency arrays",
  ],
  [
    assetOnlySoundPreloads.soundPaths.includes("misc/runekey.wav") &&
      assetOnlySoundPreloads.soundPaths.includes("ambience/windfly.wav") &&
      assetOnlySoundPreloads.entities.some((entry) =>
        entry.entityIndex === 6 &&
        entry.classname === "trigger_push" &&
        entry.soundPaths.includes("ambience/windfly.wav")
    ),
    "gameLogic sound preloads should consume normalized source asset refs before legacy sound dependency arrays",
  ],
  [
    preparedSoundPreloads.soundPaths.includes("misc/runekey.wav") &&
      preparedSoundPreloads.soundPaths.includes("ambience/windfly.wav") &&
      preparedSoundPreloads.soundPaths.includes("soldier/death1.wav") &&
      preparedSoundPreloads.soundPaths.includes("items/health1.wav") &&
      preparedSoundPreloads.soundPaths.every((soundPath) => preparedSounds.sounds?.[soundPath]),
    "gameLogic sound preloads should match representative prepared sound manifest entries",
  ],
  [
    entities.trigger_monsterjump?.callbacks.touch === "trigger_monsterjump_touch" &&
      entities.trigger_monsterjump?.defaultAssignments.some((assignment) => assignment.field === "speed" && assignment.value === 200) &&
      entities.trigger_monsterjump?.defaultAssignments.some((assignment) => assignment.field === "height" && assignment.value === 200),
    "trigger_monsterjump should expose touch callback and speed/height defaults",
  ],
  [
    entities.trigger_changelevel?.callbacks.touch === "changelevel_touch",
    "trigger_changelevel should expose changelevel_touch",
  ],
  [
    jsonEntities.monster_army?.dependencies.models.some((dep) => dep.path === "progs/soldier.mdl"),
    "JSON facts should include monster_army progs/soldier.mdl",
  ],
  [
    jsonEntities.light_globe?.assetRefs.some((dep) => dep.kind === "sprite" && dep.path === "progs/s_light.spr"),
    "JSON facts should include light_globe sprite asset refs",
  ],
  [
    jsonEntities.monster_dog?.dependencies.models.some((dep) => dep.path === "progs/dog.mdl"),
    "JSON facts should include monster_dog progs/dog.mdl",
  ],
  [
    jsonEntities.func_plat?.defaultAssignments.some((assignment) => assignment.field === "speed" && assignment.value === 150),
    "JSON facts should include func_plat speed default",
  ],
  [
    jsonEntities.func_train?.defaultAssignments.some((assignment) => assignment.field === "speed" && assignment.value === 100) &&
      jsonEntities.func_train?.callbacks.blocked === "train_blocked",
    "JSON facts should include func_train defaults and callbacks",
  ],
  [
    armorBranchValue(armorTouchBranch(jsonEntities.item_armor2, "item_armor2"), "value") === 150 &&
      armorBranchValue(armorTouchBranch(jsonEntities.item_armor2, "item_armor2"), "bit") === 16384,
    "JSON facts should include armor_touch branch assignments",
  ],
  [
    armorBranchExpression(
      powerupTouchBranch(jsonEntities.item_artifact_invulnerability, "item_artifact_invulnerability"),
      "other.invincible_finished",
    ) === "time + 30",
    "JSON facts should include powerup_touch timer branch assignments",
  ],
  [
    callbackAssignmentExpression(jsonEntities.item_artifact_invulnerability, "powerup_touch", "other.items") ===
      "other.items | self.items",
    "JSON facts should include powerup item flag mutation assignment",
  ],
  [
    callbackAssignmentExpression(jsonEntities.weapon_rocketlauncher, "weapon_touch", "self.nextthink") === "time + 30" &&
      callbackCalls(jsonEntities.item_key2, "key_touch", "SUB_UseTargets") &&
      callbackAssignmentExpression(jsonEntities.item_key2, "key_touch", "other.items") === "other.items | self.items" &&
      armorBranchExpression(
        weaponTouchBranch(jsonEntities.weapon_rocketlauncher, "weapon_supershotgun"),
        "other.ammo_shells",
      ) === "other.ammo_shells + 5",
    "JSON facts should include pickup lifecycle callback summaries and key item mutation",
  ],
  [
    jsonEntities.trigger_secret?.defaultAssignments.some((assignment) => assignment.field === "sounds" && assignment.value === 1) &&
      jsonEntities.trigger_counter?.callbacks.use === "counter_use" &&
      jsonEntities.trigger_push?.defaultAssignments.some((assignment) => assignment.field === "speed" && assignment.value === 1000),
    "JSON facts should include expanded source-backed trigger defaults",
  ],
  [
    JSON.stringify(jsonFacts.source) === JSON.stringify(QUAKE_PROGRAM_FACTS.source),
    "JSON and TS facts should use the same source metadata",
  ],
  [
    playerWeaponFacts?.radiusDamageSemantics?.attackerSelfScale === 0.5 &&
      playerWeaponFacts.radiusDamageSemantics.distanceScale === 0.5 &&
      playerWeaponFacts.radiusDamageSemantics.radiusAddUnits === 40 &&
      playerWeaponFacts.radiusDamageSemantics.requiresCanDamage === true &&
      playerWeaponFacts.radiusDamageSemantics.shamblerScale === 0.5 &&
      JSON.stringify(playerWeaponFacts.noAmmoFallback.bestWeaponOrder.map((entry) => entry.weapon)) ===
        JSON.stringify(expectedBestWeaponOrder),
    "player weapon facts should expose source-backed radius damage semantics and W_BestWeapon order",
  ],
  [
    Object.entries(expectedWeaponViewModels).every(([weapon, modelPath]) =>
      playerWeaponProfiles[weapon]?.presentation?.sourceFunction === "W_SetCurrentAmmo" &&
        playerWeaponProfiles[weapon].presentation.viewModelPath === modelPath &&
        playerWeaponProfiles[weapon].presentation.weaponFrame === 0
    ) &&
      playerWeaponProfiles.axe?.presentation?.currentAmmoExpression === "0" &&
      playerWeaponProfiles.shotgun?.presentation?.currentAmmoField === "shells" &&
      playerWeaponProfiles.shotgun.presentation.activeAmmoItemFlag === "IT_SHELLS" &&
      playerWeaponProfiles.nailgun?.presentation?.currentAmmoField === "nails" &&
      playerWeaponProfiles.grenadelauncher?.presentation?.currentAmmoField === "rockets" &&
      playerWeaponProfiles.lightning?.presentation?.currentAmmoField === "cells" &&
      playerWeaponProfiles.lightning.presentation.sourceRef?.line === 826,
    "player weapon facts should expose W_SetCurrentAmmo viewmodel, current ammo, and weaponframe presentation facts",
  ],
  [
    fireAnimation("shotgun")?.kind === "sequence" &&
      fireAnimation("shotgun")?.frameIntervalMs === 100 &&
      JSON.stringify(fireAnimationFrames("shotgun")) === JSON.stringify([1, 2, 3, 4, 5, 6]) &&
      JSON.stringify(fireAnimationFrames("supershotgun")) === JSON.stringify([1, 2, 3, 4, 5, 6]) &&
      JSON.stringify(fireAnimationFrames("grenadelauncher")) === JSON.stringify([1, 2, 3, 4, 5, 6]) &&
      JSON.stringify(fireAnimationFrames("rocketlauncher")) === JSON.stringify([1, 2, 3, 4, 5, 6]) &&
      fireAnimation("nailgun")?.kind === "cycle" &&
      fireAnimation("nailgun").firstWeaponFrame === 1 &&
      fireAnimation("nailgun").lastWeaponFrame === 8 &&
      fireAnimation("nailgun").wrapAtWeaponFrame === 9 &&
      fireAnimation("lightning")?.kind === "cycle" &&
      fireAnimation("lightning").firstWeaponFrame === 1 &&
      fireAnimation("lightning").lastWeaponFrame === 4 &&
      fireAnimation("lightning").wrapAtWeaponFrame === 5 &&
      fireAnimation("axe")?.kind === "sequence" &&
      fireAnimation("axe").variants?.length === 4 &&
      fireAnimation("axe").variants[0]?.randomLessThan === 0.25 &&
      fireAnimation("axe").variants[3]?.otherwise === true &&
      jsonPlayerWeaponProfiles.lightning?.presentation?.fireAnimation?.kind === "cycle",
    "player weapon facts should expose source-backed viewmodel fire animation sequences and held-fire cycles",
  ],
  [
    playerWeaponProfiles.axe?.runtimeKind === "melee-trace" &&
      playerWeaponProfiles.axe.cooldownMs === 500 &&
      playerWeaponProfiles.axe.fireSound?.path === "weapons/ax1.wav" &&
      playerWeaponProfiles.axe.fireSound?.sourceRef?.line === 913 &&
      playerWeaponProfiles.axe.melee?.damage === 20 &&
      playerWeaponProfiles.axe.melee.rangeUnits === 64 &&
      playerWeaponProfiles.axe.melee.wallImpactSoundPath === "player/axhit2.wav",
    "player weapon facts should expose source-backed axe trace damage, range, cooldown, and sounds",
  ],
  [
    playerWeaponProfiles.shotgun?.runtimeKind === "hitscan-pellets" &&
      playerWeaponProfiles.shotgun.ammo?.field === "shells" &&
      playerWeaponProfiles.shotgun.ammo.cost === 1 &&
      playerWeaponProfiles.shotgun.cooldownMs === 500 &&
      playerWeaponProfiles.shotgun.fireSound?.path === "weapons/guncock.wav" &&
      playerWeaponProfiles.shotgun.hitscan?.aimRangeUnits === 100000 &&
      playerWeaponProfiles.shotgun.hitscan.pelletCount === 6 &&
      playerWeaponProfiles.shotgun.hitscan.pelletDamage === 4 &&
      playerWeaponProfiles.shotgun.hitscan.traceRangeUnits === 2048 &&
      JSON.stringify(playerWeaponProfiles.shotgun.hitscan.spread) === JSON.stringify([0.04, 0.04, 0]) &&
      playerWeaponProfiles.supershotgun?.ammo?.cost === 2 &&
      playerWeaponProfiles.supershotgun.cooldownMs === 700 &&
      playerWeaponProfiles.supershotgun.fallback?.profile === "shotgun" &&
      playerWeaponProfiles.supershotgun.hitscan?.pelletCount === 14 &&
      JSON.stringify(playerWeaponProfiles.supershotgun.hitscan.spread) === JSON.stringify([0.14, 0.08, 0]),
    "player weapon facts should expose shotgun and super shotgun FireBullets profile facts",
  ],
  [
    playerWeaponProfiles.nailgun?.runtimeKind === "projectile" &&
      playerWeaponProfiles.nailgun.ammo?.field === "nails" &&
      playerWeaponProfiles.nailgun.ammo.cost === 1 &&
      playerWeaponProfiles.nailgun.cooldownMs === 200 &&
      playerWeaponProfiles.nailgun.fireSound?.path === "weapons/rocket1i.wav" &&
      playerWeaponProfiles.nailgun.projectile?.damage === 9 &&
      playerWeaponProfiles.nailgun.projectile.lifetimeMs === 6000 &&
      playerWeaponProfiles.nailgun.projectile.modelPath === "progs/spike.mdl" &&
      playerWeaponProfiles.nailgun.projectile.speedUnits === 1000 &&
      JSON.stringify(playerWeaponProfiles.nailgun.projectile.sourceOffsetUnits?.alternatingRight) === JSON.stringify([4, -4]) &&
      playerWeaponProfiles.supernailgun?.ammo?.cost === 2 &&
      playerWeaponProfiles.supernailgun.fallback?.profile === "nailgun" &&
      playerWeaponProfiles.supernailgun.projectile?.damage === 18 &&
      playerWeaponProfiles.supernailgun.projectile.modelPath === "progs/s_spike.mdl",
    "player weapon facts should expose nailgun and super nailgun projectile facts",
  ],
  [
    playerWeaponProfiles.grenadelauncher?.ammo?.field === "rockets" &&
      playerWeaponProfiles.grenadelauncher.ammo.cost === 1 &&
      playerWeaponProfiles.grenadelauncher.cooldownMs === 600 &&
      playerWeaponProfiles.grenadelauncher.fireSound?.path === "weapons/grenade.wav" &&
      playerWeaponProfiles.grenadelauncher.projectile?.movetype === "MOVETYPE_BOUNCE" &&
      playerWeaponProfiles.grenadelauncher.projectile.speedUnits === 600 &&
      playerWeaponProfiles.grenadelauncher.projectile.verticalVelocityUnits === 200 &&
      playerWeaponProfiles.grenadelauncher.projectile.lifetimeMs === 2500 &&
      playerWeaponProfiles.grenadelauncher.projectile.radiusDamage?.damageUnits === 120 &&
      playerWeaponProfiles.grenadelauncher.projectile.radiusDamage.radiusUnits === 160 &&
      playerWeaponProfiles.grenadelauncher.projectile.radiusDamage.ignore === "world" &&
      playerWeaponProfiles.grenadelauncher.projectile.bounceSoundPath === "weapons/bounce.wav",
    "player weapon facts should expose grenade launcher projectile, fuse, bounce, and splash facts",
  ],
  [
    playerWeaponProfiles.rocketlauncher?.ammo?.field === "rockets" &&
      playerWeaponProfiles.rocketlauncher.ammo.cost === 1 &&
      playerWeaponProfiles.rocketlauncher.cooldownMs === 800 &&
      playerWeaponProfiles.rocketlauncher.fireSound?.path === "weapons/sgun1.wav" &&
      playerWeaponProfiles.rocketlauncher.projectile?.modelPath === "progs/missile.mdl" &&
      playerWeaponProfiles.rocketlauncher.projectile.speedUnits === 1000 &&
      playerWeaponProfiles.rocketlauncher.projectile.lifetimeMs === 5000 &&
      playerWeaponProfiles.rocketlauncher.projectile.directDamage?.base === 100 &&
      playerWeaponProfiles.rocketlauncher.projectile.directDamage.randomAdd === 20 &&
      playerWeaponProfiles.rocketlauncher.projectile.directDamage.halfDamageClassnames?.includes("monster_shambler") &&
      playerWeaponProfiles.rocketlauncher.projectile.radiusDamage?.damageUnits === 120 &&
      playerWeaponProfiles.rocketlauncher.projectile.radiusDamage.radiusUnits === 160 &&
      playerWeaponProfiles.rocketlauncher.projectile.radiusDamage.ignore === "other" &&
      playerWeaponProfiles.rocketlauncher.projectile.sourceOffsetUnits?.forward === 8 &&
      playerWeaponProfiles.rocketlauncher.projectile.sourceOffsetUnits?.up === 16,
    "player weapon facts should expose rocket launcher direct damage, source offset, and splash facts",
  ],
  [
    playerWeaponProfiles.lightning?.runtimeKind === "beam" &&
      playerWeaponProfiles.lightning.ammo?.field === "cells" &&
      playerWeaponProfiles.lightning.ammo.cost === 1 &&
      playerWeaponProfiles.lightning.cooldownMs === 200 &&
      playerWeaponProfiles.lightning.attackStartCooldownMs === 100 &&
      playerWeaponProfiles.lightning.startSound?.path === "weapons/lstart.wav" &&
      playerWeaponProfiles.lightning.fireSound?.path === "weapons/lhit.wav" &&
      playerWeaponProfiles.lightning.fireSound.cooldownMs === 600 &&
      playerWeaponProfiles.lightning.beam?.damage === 30 &&
      playerWeaponProfiles.lightning.beam.rangeUnits === 600 &&
      playerWeaponProfiles.lightning.beam.damageTraceOffsetUnits === 16 &&
      playerWeaponProfiles.lightning.beam.damageEndForwardOffsetUnits === 4 &&
      playerWeaponProfiles.lightning.beam.tempEntity === "TE_LIGHTNING2" &&
      playerWeaponProfiles.lightning.unsupportedBranches?.[0]?.id === "lightning-underwater-discharge" &&
      playerWeaponProfiles.lightning.unsupportedBranches[0].radiusDamage?.damagePerAmmoCell === 35 &&
      playerWeaponProfiles.lightning.unsupportedBranches[0].clearsAmmoField === "cells",
    "player weapon facts should expose lightning beam cadence, damage, temp entity, and underwater branch metadata",
  ],
  [
    jsonPlayerWeaponProfiles.shotgun?.hitscan?.pelletCount === playerWeaponProfiles.shotgun?.hitscan?.pelletCount &&
      jsonPlayerWeaponProfiles.grenadelauncher?.projectile?.speedUnits === 600 &&
      jsonPlayerWeaponProfiles.rocketlauncher?.projectile?.radiusDamage?.radiusUnits === 160 &&
      jsonPlayerWeaponProfiles.lightning?.unsupportedBranches?.[0]?.radiusDamage?.damageExpression === "35*self.ammo_cells" &&
      jsonPlayerWeaponProfiles.lightning?.presentation?.viewModelPath === "progs/v_light.mdl",
    "JSON player weapon facts should preserve representative generated weapon fire profile values",
  ],
  [
    soldierLogic?.spawnProfile?.modelPath === "progs/soldier.mdl",
    "monster_army generated logic should point at progs/soldier.mdl",
  ],
  [
    soldierLogic?.deathOutput?.gib?.sourceFunction === "army_die" &&
      soldierLogic.deathOutput.gib.healthBelow === -35 &&
      soldierLogic.deathOutput.gib.soundPath === "player/udeath.wav" &&
      soldierLogic.deathOutput.gib.headModelPath === "progs/h_guard.mdl" &&
      JSON.stringify(soldierLogic.deathOutput.gib.gibModelPaths) === JSON.stringify([
        "progs/gib1.mdl",
        "progs/gib2.mdl",
        "progs/gib3.mdl",
      ]) &&
      soldierLogic.deathOutput.backpack?.modelPath === "progs/backpack.mdl" &&
      soldierLogic.deathOutput.backpack?.pickupSoundPath === "weapons/lock4.wav" &&
      soldierLogic.deathOutput.backpack?.removeAfterSeconds === 120 &&
      JSON.stringify(soldierLogic.deathOutput.backpack?.originOffsetUnits) === JSON.stringify([0, 0, -24]) &&
      soldierLogic.deathOutput.backpackDrops?.some((drop) => drop.chain === "death_a" && drop.ammo?.shells === 5),
    "monster_army generated logic should expose QuakeC army_die gib and backpack-drop facts",
  ],
  [
    jsonEntities.monster_army?.callbackFacts?.army_die?.assetRefs?.some((asset) =>
      asset.call === "DropBackpack" &&
      asset.path === "progs/backpack.mdl" &&
      asset.sourceRef?.sourceFile === "qcc/v101qc/items.qc"
    ) &&
      jsonEntities.monster_ogre?.callbackFacts?.ogre_die?.assetRefs?.some((asset) =>
        asset.call === "BackpackTouch" &&
        asset.path === "weapons/lock4.wav" &&
        asset.sourceRef?.sourceFile === "qcc/v101qc/items.qc"
      ),
    "monster death callback facts should link DropBackpack/BackpackTouch assets from items.qc",
  ],
  [
    dogLogic?.deathOutput?.gib?.healthBelow === -35 &&
      dogLogic.deathOutput.gib.headModelPath === "progs/h_dog.mdl" &&
      JSON.stringify(dogLogic.deathOutput.gib.gibModelPaths) === JSON.stringify([
        "progs/gib3.mdl",
        "progs/gib3.mdl",
        "progs/gib3.mdl",
      ]) &&
      ogreLogic?.deathOutput?.backpack?.modelPath === "progs/backpack.mdl" &&
      ogreLogic?.deathOutput?.backpackDrops?.some((drop) => drop.chain === "death_a" && drop.ammo?.rockets === 2) &&
      zombieLogic?.deathOutput?.gib?.sourceFunction === "zombie_die" &&
      zombieLogic.deathOutput.gib.damageAtLeast === 60 &&
      zombieLogic.deathOutput.gib.soundPath === "zombie/z_gib.wav" &&
      zombieLogic.deathOutput.gib.headModelPath === "progs/h_zombie.mdl",
    "generated monster logic should expose dog/ogre/zombie QuakeC death-output facts",
  ],
  [
    JSON.stringify(generatedMonsterSpawnHealth) === JSON.stringify(expectedMonsterSpawnHealth),
    `generated monster logic should expose exact QuakeC spawn health for ordinary monsters, got ${
      JSON.stringify(generatedMonsterSpawnHealth)
    }`,
  ],
  [
    bossLogic?.scriptedLifecycle?.spawnUseFunction === "boss_awake" &&
      bossLogic.scriptedLifecycle.awake.modelPath === "progs/boss.mdl" &&
      JSON.stringify(bossLogic.scriptedLifecycle.awake.bounds) === JSON.stringify({
        min: [-128, -128, -24],
        max: [128, 128, 256],
      }) &&
      JSON.stringify(bossLogic.scriptedLifecycle.awake.healthBySkill) === JSON.stringify({
        easy: 1,
        normal: 3,
        hard: 3,
      }) &&
      bossLogic.scriptedLifecycle.lightning.useFunction === "lightning_use" &&
      bossLogic.scriptedLifecycle.lightning.eventClassname === "event_lightning" &&
      bossLogic.scriptedLifecycle.lightning.damagePerUse === 1 &&
      bossLogic.scriptedLifecycle.lightning.fireIntervalMs === 100 &&
      bossLogic.scriptedLifecycle.lightning.painSoundPath === "boss1/pain.wav" &&
      bossLogic.scriptedLifecycle.lightning.resetAfterMs === 1000 &&
      bossLogic.scriptedLifecycle.lightning.resetFunction === "door_go_down" &&
      bossLogic.scriptedLifecycle.lightning.soundPath === "misc/power.wav" &&
      bossLogic.scriptedLifecycle.lightning.tempEntity === "TE_LIGHTNING3" &&
      JSON.stringify(bossLogic.scriptedLifecycle.lightning.alignment) === JSON.stringify({
        damageState: "STATE_TOP",
        requiresMatchingState: true,
        targetField: "target",
        validStates: ["STATE_TOP", "STATE_BOTTOM"],
      }) &&
      JSON.stringify(bossLogic.scriptedLifecycle.lightning.painBranches) === JSON.stringify([
        { afterHealthMin: 2, chain: "pain", functionName: "boss_shocka1" },
        { afterHealth: 1, chain: "shock_b", functionName: "boss_shockb1" },
        { afterHealth: 0, chain: "shock_c", functionName: "boss_shockc1" },
      ]) &&
      bossLogic.scriptedLifecycle.death.terminalState === "boss_death10" &&
      bossLogic.scriptedLifecycle.death.usesTargets === true &&
      bossLogic.scriptedLifecycle.death.removesSelf === true,
    "monster_boss generated logic should expose QuakeC boss_awake/lightning/death lifecycle facts",
  ],
  [
    JSON.stringify(rawExploboxRadiusDamage) === JSON.stringify({
      attacker: "self",
      call: "T_RadiusDamage",
      damageUnits: 160,
      ignore: "world",
      inflictor: "self",
      sourceRef: {
        sourceFile: "qcc/v101qc/misc.qc",
        functionName: "barrel_explode",
        line: 238,
      },
    }) &&
      JSON.stringify(exploboxRadiusDamage) === JSON.stringify({
        attacker: "self",
        call: "T_RadiusDamage",
        damageUnits: 160,
        ignore: "world",
        inflictor: "self",
        sourceRef: {
          sourceFile: "qcc/v101qc/misc.qc",
          functionName: "barrel_explode",
          line: 238,
        },
        attackerSelfScale: 0.5,
        distanceScale: 0.5,
        radiusAddUnits: 40,
        requiresCanDamage: true,
        shamblerScale: 0.5,
        radiusUnits: 200,
      }) &&
      JSON.stringify(explobox2RadiusDamage) === JSON.stringify(exploboxRadiusDamage),
    "misc_explobox generated logic should expose QuakeC barrel_explode radius damage facts",
  ],
  [
    soldierModel?.source === "progs/soldier.mdl",
    "prepared pickups should include source metadata for progs/soldier.mdl",
  ],
  [
    soldierAttackPolicy?.chain === "attack" &&
      soldierAttackPolicy.usesFrameEvents === true &&
      soldierAttackPolicy.requiresClearShot === true &&
      soldierAttackPolicy.cooldownMs === 1000 &&
      soldierAttackPolicy.cooldownRandomAddMs === 1000 &&
      soldierAttackPolicy.damage === 16 &&
      soldierAttackPolicy.rangeUnits.melee === 120 &&
      soldierAttackPolicy.rangeUnits.near === 500 &&
      soldierAttackPolicy.rangeUnits.mid === 1000 &&
      soldierAttackPolicy.rangeChances.far === 0 &&
      soldierAttackPolicy.rangeChances.melee === 0.9 &&
      soldierAttackPolicy.rangeChances.near === 0.4 &&
      soldierAttackPolicy.rangeChances.mid === 0.05,
    "monster_army generated combat policy should expose SoldierCheckAttack chances and cooldown",
  ],
  [
    soldierArmyFireEvent?.state.frame === "shoot5" &&
      soldierArmyFireEvent.state.frameIndex === 85 &&
      soldierArmyFireEvent.event.pellets === 4 &&
      soldierArmyFireEvent.event.pelletDamage === 4 &&
      soldierArmyFireEvent.event.traceRangeUnits === 2048 &&
      JSON.stringify(soldierArmyFireEvent.event.spread) === JSON.stringify([0.1, 0.1, 0]),
    "monster_army generated attack chain should expose army_atk5 FireBullets(4, dir, '0.1 0.1 0')",
  ],
  [
    ogreGrenadeEvent?.state.frame === "shoot3" &&
      ogreGrenadeEvent.state.frameIndex === 63 &&
      ogreGrenadeEvent.event.classname === "enemy_projectile_grenade" &&
      ogreGrenadeEvent.event.damage === 40 &&
      ogreGrenadeEvent.event.lifetimeMs === 2500 &&
      ogreGrenadeEvent.event.modelPath === "progs/grenade.mdl" &&
      ogreGrenadeEvent.event.radiusUnits === 36 &&
      ogreGrenadeEvent.event.speedUnits === 600 &&
      ogreGrenadeEvent.event.verticalVelocityUnits === 200,
    "monster_ogre generated attack chain should expose ogre_nail4 OgreFireGrenade projectile facts",
  ],
  [
    ogreMeleeDamageEvents.length === 6 &&
      ogreMeleeDamageEvents.every(({ state, event }, index) =>
        state.name === `ogre_smash${index + 6}` &&
        state.frame === `smash${index + 6}` &&
        state.frameIndex === 52 + index &&
        event.call === "chainsaw" &&
        event.type === "melee_damage" &&
        event.rangeUnits === 100 &&
        event.requiresCanDamage === true &&
        JSON.stringify(event.damageRandomTerms) === JSON.stringify([4, 4, 4])
      ),
    "monster_ogre generated melee chain should expose six chainsaw damage frame events",
  ],
  [
    zombieProjectileEvent?.state.frame === "atta13" &&
      zombieProjectileEvent.state.frameIndex === 64 &&
      zombieProjectileEvent.event.classname === "enemy_projectile_zombie_grenade" &&
      zombieProjectileEvent.event.damage === 10 &&
      zombieProjectileEvent.event.modelPath === "progs/zom_gib.mdl" &&
      zombieProjectileEvent.event.speedUnits === 600 &&
      zombieProjectileEvent.event.verticalVelocityUnits === 200,
    "monster_zombie generated attack chain should expose ZombieFireGrenade projectile facts",
  ],
  [
    zombiePainDownStates.length === 30 &&
      zombiePainDownStates[0]?.name === "zombie_paine1" &&
      zombiePainDownStates[0]?.frameIndex === 162 &&
      zombiePainDownStates[9]?.name === "zombie_paine10" &&
      zombiePainDownStates[9]?.sounds.includes("zombie/z_fall.wav") &&
      zombiePainDownStates[10]?.name === "zombie_paine11" &&
      zombiePainDownStates[11]?.name === "zombie_paine12" &&
      zombiePainDownStates[11]?.calls.includes("walkmove") &&
      zombiePainDownStates[11]?.sounds.includes("zombie/z_idle.wav") &&
      zombiePainDownStates[29]?.name === "zombie_paine30" &&
      zombiePainDownStates[29]?.next === "zombie_run1",
    "monster_zombie generated pain_down chain should expose fall, five-second hold point, stand-up check, and run recovery states",
  ],
  [
    knightMeleeDamageEvents.length === 3 &&
      knightMeleeDamageEvents.every(({ state, event }, index) =>
        state.name === `knight_atk${index + 6}` &&
        state.frame === `attackb${index + 6}` &&
        state.frameIndex === 48 + index &&
        event.call === "ai_melee" &&
        event.type === "melee_damage" &&
        event.rangeUnits === 60 &&
        JSON.stringify(event.damageRandomTerms) === JSON.stringify([3, 3, 3])
      ),
    "monster_knight generated attack chain should expose three ai_melee damage frame events",
  ],
  [
    wizardProjectileEvents.length === 2 &&
      wizardProjectileEvents.every(({ state, event }) =>
        state.name === "wiz_fast1" &&
        state.frame === "magatt1" &&
        state.frameIndex === 29 &&
        event.call === "Wiz_FastFire" &&
        event.classname === "enemy_projectile_spike" &&
        event.damage === 9 &&
        event.lifetimeMs === 6000 &&
        event.modelPath === "progs/w_spike.mdl" &&
        event.radiusUnits === 28 &&
        event.speedUnits === 600 &&
        event.type === "projectile"
      ) &&
      JSON.stringify(wizardProjectileEvents.map(({ event }) => event.delayMs).sort((a, b) => a - b)) === JSON.stringify([300, 800]) &&
      JSON.stringify(wizardProjectileEvents.map(({ event }) => event.originOffsetUnits?.right).sort((a, b) => a - b)) === JSON.stringify([-14, 14]) &&
      JSON.stringify(wizardProjectileEvents.map(({ event }) => event.targetOffsetUnits?.right).sort((a, b) => a - b)) === JSON.stringify([-13, 13]),
    "monster_wizard generated attack chain should expose two delayed Wiz_FastFire spike projectiles",
  ],
  [
    soldierRefireState?.frame === "shoot7" &&
      soldierRefireState.frameIndex === 87 &&
      soldierRefireState.next === "army_atk8" &&
      soldierRefireState.calls.includes("SUB_CheckRefire"),
    "monster_army generated attack chain should expose army_atk7 SUB_CheckRefire",
  ],
  [
    soldierFrames.length === 114,
    "prepared progs/soldier.mdl should expose 114 animation frames",
  ],
  [
    Object.entries(expectedSoldierChainLengths).every(([chainName, length]) => soldierChainLengths[chainName] === length),
    "monster_army generated chains should keep QuakeC soldier frame counts",
  ],
  [
    soldierFrameStates.length === 112,
    "monster_army generated logic should expose 112 chain entries including attack/missile aliases",
  ],
  [
    soldierUniqueFrameStateNames.size === 103,
    "monster_army generated logic should reference 103 unique QuakeC frame states",
  ],
  [
    soldierMissingModelFrames.length === 0,
    `monster_army generated frames should exist in progs/soldier.mdl: ${soldierMissingModelFrames.map(({ chainName, state }) => `${chainName}:${state.frame}`).join(", ")}`,
  ],
  [
    soldierMismatchedFrameIndexes.length === 0,
    `monster_army generated frame indexes should match progs/soldier.mdl: ${soldierMismatchedFrameIndexes.map(({ chainName, state }) => `${chainName}:${state.frame}@${state.frameIndex}`).join(", ")}`,
  ],
  [
    soldierMissingRenderBundles.length === 0,
    `prepared progs/soldier.mdl frames should include render bundles: ${soldierMissingRenderBundles.map((frame) => frame.name).join(", ")}`,
  ],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

console.log(`Quake program facts smoke passed: ${checks.length} checks.`);
