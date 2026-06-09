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
const { QUAKE_MONSTER_LOGIC } = await importBundledModule(generatedMonsterLogicPath);
const entities = QUAKE_PROGRAM_FACTS.entities;
const jsonFacts = await readGeneratedJson(generatedFactsJsonPath, "Run pnpm prepare:quake-logic before this smoke.");
const jsonEntities = jsonFacts.entities;
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
    entities.monster_dog?.dependencies.models.some((dep) => dep.path === "progs/dog.mdl"),
    "monster_dog should include progs/dog.mdl",
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
    soldierLogic?.spawnProfile?.modelPath === "progs/soldier.mdl",
    "monster_army generated logic should point at progs/soldier.mdl",
  ],
  [
    soldierModel?.source === "progs/soldier.mdl",
    "prepared pickups should include source metadata for progs/soldier.mdl",
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
