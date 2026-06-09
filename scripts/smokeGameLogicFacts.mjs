import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const scenePath = process.argv[2] ?? path.join(projectRoot, "build/generated/public/q/e1m1.json");
const generatedProgramFactsPath = path.join(projectRoot, "src/generated/quakeProgramFacts.ts");
const gameLogicFactsPath = path.join(projectRoot, "src/prepare/gameLogicFacts.ts");
const gameLogicPreloadsPath = path.join(projectRoot, "src/prepare/gameLogicPreloads.mjs");
const runtimeAudioPath = path.join(projectRoot, "src/runtime/audio.ts");
const runtimeMoversPath = path.join(projectRoot, "src/runtime/movers.ts");
const runtimePickupsPath = path.join(projectRoot, "src/runtime/pickups.ts");
const runtimeTargetsPath = path.join(projectRoot, "src/runtime/targets.ts");
const runtimeTriggerEffectsPath = path.join(projectRoot, "src/runtime/triggerEffects.ts");
const runtimeTriggersPath = path.join(projectRoot, "src/runtime/triggers.ts");
const QUAKE_BUTTON_DEFAULT_SPEED = 40;
const QUAKE_BUTTON_DEFAULT_WAIT = 1;
const QUAKE_BUTTON_DEFAULT_LIP = 4;
const QUAKE_BUTTON_DEFAULT_SOUNDS = 3;
const QUAKE_PLAT_LOW_TRIGGER = 1;
const QUAKE_PLAT_TRIGGER_INSET = 25;
const QUAKE_PLAT_TRIGGER_TOP_EXTRA = 8;
const QUAKE_PLAT_TRIGGER_LOW_HEIGHT = 8;
const QUAKE_PLAT_TRIGGER_MIN_SIDE = 50;
const WEAPON_PICKUP_CLASSNAMES = [
  "weapon_nailgun",
  "weapon_supernailgun",
  "weapon_supershotgun",
  "weapon_grenadelauncher",
  "weapon_rocketlauncher",
  "weapon_lightning",
];
const AMMO_PICKUP_CLASSNAMES = [
  "item_shells",
  "item_spikes",
  "item_rockets",
  "item_cells",
];

const scene = await readScene(scenePath);
const { QUAKE_UNIT_SCALE: QUAKE_COLLISION_UNIT_SCALE } = await import(
  pathToFileURL(path.join(projectRoot, "src/quakeScale.js")).href
);
const { quakePickupSoundPath } = await importBundledModule(runtimeAudioPath);
const { createQuakeMoversController, quakeMoverBlockDamage } = await importBundledModule(runtimeMoversPath);
const { quakePickupEffectForEntity, quakePickupMessageForEntity, quakePickupModelPath } =
  await importBundledModule(runtimePickupsPath);
const { createQuakeTargetsController } = await importBundledModule(runtimeTargetsPath);
const {
  quakeTriggerChangelevelMap,
  quakeTriggerHurtDamageAmount,
  quakeTriggerOnlyRegisteredActivation,
  quakeTriggerOneShot,
  quakeTriggerPushActivation,
  quakeTriggerSecretActivation,
  quakeTriggerSetSkillValue,
  quakeTriggerTeleportDestination,
} = await importBundledModule(runtimeTriggerEffectsPath);
const { createQuakeTriggersController } = await importBundledModule(runtimeTriggersPath);
const { QUAKE_PROGRAM_FACTS } = await importBundledModule(generatedProgramFactsPath);
const {
  buildQuakeGameLogicFacts,
  indexQuakeGameLogicEntityFacts,
  quakeGameLogicResolvedMoverFact,
  quakeGameLogicResolvedPathCornerFact,
} = await importBundledModule(gameLogicFactsPath);
const { deriveQuakeGameLogicSoundPreloads } = await import(pathToFileURL(gameLogicPreloadsPath).href);
const logic = scene.gameLogic;
const rebuiltLogic = buildQuakeGameLogicFacts({
  label: scene.label,
  entities: scene.entities ?? [],
  entityManifest: scene.entityManifest,
  models: scene.collision?.models ?? [],
  collision: scene.collision,
  programFacts: QUAKE_PROGRAM_FACTS,
});
const entities = Array.isArray(logic?.entities) ? logic.entities : [];
const rebuiltEntities = Array.isArray(rebuiltLogic?.entities) ? rebuiltLogic.entities : [];
const startScene = await readSiblingScene("start");
const e1m2Scene = await readSiblingScene("e1m2");
const e1m3Scene = await readSiblingScene("e1m3");
const e1m4Scene = await readSiblingScene("e1m4");
const e1m6Scene = await readSiblingScene("e1m6");
const e1m8Scene = await readSiblingScene("e1m8");
const rebuiltStartLogic = buildRebuiltGameLogic(startScene);
const rebuiltE1M2Logic = buildRebuiltGameLogic(e1m2Scene);
const rebuiltE1M3Logic = buildRebuiltGameLogic(e1m3Scene);
const rebuiltE1M4Logic = buildRebuiltGameLogic(e1m4Scene);
const rebuiltE1M6Logic = buildRebuiltGameLogic(e1m6Scene);
const startEntities = sceneGameLogicEntities(startScene);
const rebuiltStartEntities = Array.isArray(rebuiltStartLogic?.entities) ? rebuiltStartLogic.entities : [];
const e1m2Entities = sceneGameLogicEntities(e1m2Scene);
const rebuiltE1M2Entities = Array.isArray(rebuiltE1M2Logic?.entities) ? rebuiltE1M2Logic.entities : [];
const e1m3Entities = sceneGameLogicEntities(e1m3Scene);
const rebuiltE1M3Entities = Array.isArray(rebuiltE1M3Logic?.entities) ? rebuiltE1M3Logic.entities : [];
const e1m4Entities = sceneGameLogicEntities(e1m4Scene);
const rebuiltE1M4Entities = Array.isArray(rebuiltE1M4Logic?.entities) ? rebuiltE1M4Logic.entities : [];
const e1m6Entities = sceneGameLogicEntities(e1m6Scene);
const rebuiltE1M6Entities = Array.isArray(rebuiltE1M6Logic?.entities) ? rebuiltE1M6Logic.entities : [];
const e1m8Entities = sceneGameLogicEntities(e1m8Scene);
const funcPlats = entities.filter((entity) => entity.classname === "func_plat");
const funcDoors = entities.filter((entity) => entity.classname === "func_door");
const funcButtons = entities.filter((entity) => entity.classname === "func_button");
const rebuiltWorldspawn = rebuiltEntities.find((entity) => entity.entityIndex === 0 && entity.classname === "worldspawn");
const sourceBackedTriggers = entities.filter((entity) =>
  entity.classname === "trigger_counter" ||
  entity.classname === "trigger_multiple" ||
  entity.classname === "trigger_once" ||
  entity.classname === "trigger_secret" ||
  entity.classname === "trigger_hurt" ||
  entity.classname === "trigger_teleport" ||
  entity.classname === "trigger_changelevel"
);
const funcPlat = entities.find((entity) => entity.entityIndex === 70 && entity.classname === "func_plat");
const lowTriggerPlat = entities.find((entity) => entity.entityIndex === 188 && entity.classname === "func_plat");
const door14 = entities.find((entity) => entity.entityIndex === 14 && entity.classname === "func_door");
const door15 = entities.find((entity) => entity.entityIndex === 15 && entity.classname === "func_door");
const door46 = entities.find((entity) => entity.entityIndex === 46 && entity.classname === "func_door");
const door47 = entities.find((entity) => entity.entityIndex === 47 && entity.classname === "func_door");
const startOpenDoor = entities.find((entity) => entity.entityIndex === 83 && entity.classname === "func_door");
const button30 = entities.find((entity) => entity.entityIndex === 30 && entity.classname === "func_button");
const button88 = entities.find((entity) => entity.entityIndex === 88 && entity.classname === "func_button");
const button148 = entities.find((entity) => entity.entityIndex === 148 && entity.classname === "func_button");
const triggerOnce98 = entities.find((entity) => entity.entityIndex === 98 && entity.classname === "trigger_once");
const shootableTrigger138 = entities.find((entity) => entity.entityIndex === 138 && entity.classname === "trigger_multiple");
const triggerTeleport178 = entities.find((entity) => entity.entityIndex === 178 && entity.classname === "trigger_teleport");
const triggerCounter214 = entities.find((entity) => entity.entityIndex === 214 && entity.classname === "trigger_counter");
const rebuiltTriggerCounter214 = rebuiltEntities.find((entity) => entity.entityIndex === 214 && entity.classname === "trigger_counter");
const triggerSecret312 = entities.find((entity) => entity.entityIndex === 312 && entity.classname === "trigger_secret");
const rebuiltTriggerSecret312 = rebuiltEntities.find((entity) => entity.entityIndex === 312 && entity.classname === "trigger_secret");
const messageTrigger338 = entities.find((entity) => entity.entityIndex === 338 && entity.classname === "trigger_multiple");
const rebuiltMessageTrigger338 = rebuiltEntities.find((entity) => entity.entityIndex === 338 && entity.classname === "trigger_multiple");
const changelevelTrigger345 = entities.find((entity) => entity.entityIndex === 345 && entity.classname === "trigger_changelevel");
const tutorialTrigger352 = entities.find((entity) => entity.entityIndex === 352 && entity.classname === "trigger_once");
const tutorialTrigger353 = entities.find((entity) => entity.entityIndex === 353 && entity.classname === "trigger_once");
const startRegistered213 = startEntities.find((entity) => entity.entityIndex === 213 && entity.classname === "trigger_onlyregistered");
const rebuiltStartRegistered213 = rebuiltStartEntities.find((entity) =>
  entity.entityIndex === 213 && entity.classname === "trigger_onlyregistered"
);
const startSkill214 = startEntities.find((entity) => entity.entityIndex === 214 && entity.classname === "trigger_setskill");
const startSkill303 = startEntities.find((entity) => entity.entityIndex === 303 && entity.classname === "trigger_setskill");
const startRegisteredKill373 = startEntities.find((entity) => entity.entityIndex === 373 && entity.classname === "trigger_onlyregistered");
const startRegisteredKill378 = startEntities.find((entity) => entity.entityIndex === 378 && entity.classname === "trigger_onlyregistered");
const e1m3FirstOnce = e1m3Entities.find((entity) => entity.classname === "trigger_once");
const e1m1TeleportDestination204 = rebuiltEntities.find((entity) =>
  entity.entityIndex === 204 && entity.classname === "info_teleport_destination"
);
const e1m1SecretDoor97 = rebuiltEntities.find((entity) => entity.entityIndex === 97 && entity.classname === "func_door_secret");
const e1m1SecretDoor132 = rebuiltEntities.find((entity) => entity.entityIndex === 132 && entity.classname === "func_door_secret");
const e1m2Train186 = e1m2Entities.find((entity) => entity.entityIndex === 186 && entity.classname === "func_train");
const e1m2Train190 = e1m2Entities.find((entity) => entity.entityIndex === 190 && entity.classname === "func_train");
const e1m2PathCorner175 = e1m2Entities.find((entity) => entity.entityIndex === 175 && entity.classname === "path_corner");
const e1m2PathCorner176 = e1m2Entities.find((entity) => entity.entityIndex === 176 && entity.classname === "path_corner");
const e1m2PathCorner182 = e1m2Entities.find((entity) => entity.entityIndex === 182 && entity.classname === "path_corner");
const rebuiltE1M2SecretDoor460 = rebuiltE1M2Entities.find((entity) =>
  entity.entityIndex === 460 && entity.classname === "func_door_secret"
);
const rebuiltE1M2TrapSpikeshooter419 = rebuiltE1M2Entities.find((entity) =>
  entity.entityIndex === 419 && entity.classname === "trap_spikeshooter"
);
const e1m2PreparedKey114 = e1m2Entities.find((entity) => entity.entityIndex === 114 && entity.classname === "item_key1");
const e1m2Key114 = rebuiltE1M2Logic.entities.find((entity) => entity.entityIndex === 114 && entity.classname === "item_key1");
const e1m2SilverDoor413 = rebuiltE1M2Logic.entities.find((entity) => entity.entityIndex === 413 && entity.classname === "func_door");
const sceneE1M2Key114 = e1m2Scene.entities?.find((entity) => entity.index === 114 && entity.classname === "item_key1");
const syntheticBaseKeycardLogic = buildSyntheticBaseKeycardLogic(e1m2Scene, sceneE1M2Key114);
const syntheticBaseKeycard114 = syntheticBaseKeycardLogic.entities.find((entity) =>
  entity.entityIndex === 114 && entity.classname === "item_key1"
);
const e1m4Counter445 = e1m4Entities.find((entity) => entity.entityIndex === 445 && entity.classname === "trigger_counter");
const rebuiltE1M4Counter410 = rebuiltE1M4Entities.find((entity) => entity.entityIndex === 410 && entity.classname === "trigger_counter");
const e1m4Relay482 = e1m4Entities.find((entity) => entity.entityIndex === 482 && entity.classname === "trigger_relay");
const e1m6Train157 = e1m6Entities.find((entity) => entity.entityIndex === 157 && entity.classname === "func_train");
const e1m6Monsterjump367 = e1m6Entities.find((entity) => entity.entityIndex === 367 && entity.classname === "trigger_monsterjump");
const e1m6PreparedKey19 = e1m6Entities.find((entity) => entity.entityIndex === 19 && entity.classname === "item_key2");
const e1m6Key19 = rebuiltE1M6Logic.entities.find((entity) => entity.entityIndex === 19 && entity.classname === "item_key2");
const e1m6GoldRuneDoor8 = rebuiltE1M6Logic.entities.find((entity) => entity.entityIndex === 8 && entity.classname === "func_door");
const sceneE1M6Key19 = e1m6Scene.entities?.find((entity) => entity.index === 19 && entity.classname === "item_key2");
const e1m6PreparedKey49 = e1m6Entities.find((entity) => entity.entityIndex === 49 && entity.classname === "item_key1");
const e1m6Key49 = rebuiltE1M6Logic.entities.find((entity) => entity.entityIndex === 49 && entity.classname === "item_key1");
const sceneE1M6Key49 = e1m6Scene.entities?.find((entity) => entity.index === 49 && entity.classname === "item_key1");
const rebuiltE1M6Fireball149 = rebuiltE1M6Entities.find((entity) =>
  entity.entityIndex === 149 && entity.classname === "misc_fireball"
);
const rebuiltE1M6TrapSpikeshooter234 = rebuiltE1M6Entities.find((entity) =>
  entity.entityIndex === 234 && entity.classname === "trap_spikeshooter"
);
const e1m8FirstSecret = e1m8Entities.find((entity) => entity.classname === "trigger_secret");
const rebuiltStartFireball54 = rebuiltStartEntities.find((entity) =>
  entity.entityIndex === 54 && entity.classname === "misc_fireball"
);
const rebuiltStartBossGate310 = rebuiltStartEntities.find((entity) =>
  entity.entityIndex === 310 && entity.classname === "func_bossgate"
);
const rebuiltStartEpisodeGate344 = rebuiltStartEntities.find((entity) =>
  entity.entityIndex === 344 && entity.classname === "func_episodegate"
);
const deathmatchStarts = entities.filter((entity) => entity.classname === "info_player_deathmatch");
const coopStarts = entities.filter((entity) => entity.classname === "info_player_coop");
const hardOnlyMonster = entities.find((entity) => entity.entityIndex === 21 && entity.classname === "monster_army");
const normalHardMonster = entities.find((entity) => entity.entityIndex === 245 && entity.classname === "monster_army");
const singleplayerDisabledPickup = entities.find(
  (entity) => entity.entityIndex === 201 && entity.classname === "weapon_rocketlauncher",
);
const startArmorInv271 = startEntities.find((entity) => entity.entityIndex === 271 && entity.classname === "item_armorInv");
const armorPickup20 = entities.find((entity) => entity.entityIndex === 20 && entity.classname === "item_armor1");
const armorPickup354 = entities.find((entity) => entity.entityIndex === 354 && entity.classname === "item_armor2");
const rebuiltArmorPickup20 = rebuiltEntities.find((entity) => entity.entityIndex === 20 && entity.classname === "item_armor1");
const quadPickup141 = entities.find((entity) => entity.entityIndex === 141 && entity.classname === "item_artifact_super_damage");
const rebuiltQuadPickup141 = rebuiltEntities.find((entity) => entity.entityIndex === 141 && entity.classname === "item_artifact_super_damage");
const invulnerabilityPickup244 = entities.find((entity) =>
  entity.entityIndex === 244 && entity.classname === "item_artifact_invulnerability"
);
const rebuiltInvulnerabilityPickup244 = rebuiltEntities.find((entity) =>
  entity.entityIndex === 244 && entity.classname === "item_artifact_invulnerability"
);
const envirosuitPickup251 = entities.find((entity) =>
  entity.entityIndex === 251 && entity.classname === "item_artifact_envirosuit"
);
const rebuiltEnvirosuitPickup251 = rebuiltEntities.find((entity) =>
  entity.entityIndex === 251 && entity.classname === "item_artifact_envirosuit"
);
const e1m3Invisibility543 = e1m3Entities.find((entity) =>
  entity.entityIndex === 543 && entity.classname === "item_artifact_invisibility"
);
const rebuiltE1M3Invisibility543 = rebuiltE1M3Entities.find((entity) =>
  entity.entityIndex === 543 && entity.classname === "item_artifact_invisibility"
);
const megaHealthPickup200 = entities.find((entity) => entity.entityIndex === 200 && entity.classname === "item_health");
const rebuiltMegaHealthPickup200 = rebuiltEntities.find((entity) => entity.entityIndex === 200 && entity.classname === "item_health");
const rocketAmmoPickup203 = entities.find((entity) => entity.entityIndex === 203 && entity.classname === "item_rockets");
const rebuiltRocketAmmoPickup203 = rebuiltEntities.find((entity) => entity.entityIndex === 203 && entity.classname === "item_rockets");
const shellPickup207 = entities.find((entity) => entity.entityIndex === 207 && entity.classname === "item_shells");
const rottenHealthPickup208 = entities.find((entity) => entity.entityIndex === 208 && entity.classname === "item_health");
const rebuiltRottenHealthPickup208 = rebuiltEntities.find((entity) => entity.entityIndex === 208 && entity.classname === "item_health");
const rebuiltRocketWeapon201 = rebuiltEntities.find((entity) =>
  entity.entityIndex === 201 && entity.classname === "weapon_rocketlauncher"
);
const sceneArmorPickup20 = scene.entities?.find((entity) => entity.index === 20 && entity.classname === "item_armor1");
const sceneQuadPickup141 = scene.entities?.find((entity) =>
  entity.index === 141 && entity.classname === "item_artifact_super_damage"
);
const sceneMegaHealthPickup200 = scene.entities?.find((entity) => entity.index === 200 && entity.classname === "item_health");
const sceneRocketWeapon201 = scene.entities?.find((entity) =>
  entity.index === 201 && entity.classname === "weapon_rocketlauncher"
);
const sceneRocketAmmoPickup203 = scene.entities?.find((entity) =>
  entity.index === 203 && entity.classname === "item_rockets"
);
const sceneRottenHealthPickup208 = scene.entities?.find((entity) => entity.index === 208 && entity.classname === "item_health");
const sourceWorldspawn = rebuiltLogic?.programFacts?.entities?.worldspawn;
const sourceFuncPlat = logic?.programFacts?.entities?.func_plat;
const sourceFuncDoor = rebuiltLogic?.programFacts?.entities?.func_door ?? logic?.programFacts?.entities?.func_door;
const sourceFuncButton = logic?.programFacts?.entities?.func_button;
const sourceFuncTrain = rebuiltE1M2Logic?.programFacts?.entities?.func_train ?? e1m2Scene.gameLogic?.programFacts?.entities?.func_train;
const sourceFuncDoorSecret = rebuiltLogic?.programFacts?.entities?.func_door_secret ??
  rebuiltE1M2Logic?.programFacts?.entities?.func_door_secret;
const sourcePathCorner = rebuiltLogic?.programFacts?.entities?.path_corner ??
  rebuiltE1M2Logic?.programFacts?.entities?.path_corner;
const sourceInfoTeleportDestination = rebuiltLogic?.programFacts?.entities?.info_teleport_destination ??
  rebuiltE1M2Logic?.programFacts?.entities?.info_teleport_destination;
const sourceMiscFireball = rebuiltE1M6Logic?.programFacts?.entities?.misc_fireball ??
  rebuiltStartLogic?.programFacts?.entities?.misc_fireball;
const sourceTrapSpikeshooter = rebuiltE1M2Logic?.programFacts?.entities?.trap_spikeshooter ??
  rebuiltE1M6Logic?.programFacts?.entities?.trap_spikeshooter;
const sourceFuncEpisodegate = rebuiltStartLogic?.programFacts?.entities?.func_episodegate;
const sourceFuncBossgate = rebuiltStartLogic?.programFacts?.entities?.func_bossgate;
const sourceItemArmor1 = logic?.programFacts?.entities?.item_armor1;
const sourceItemArmor2 = logic?.programFacts?.entities?.item_armor2;
const sourceItemArmorInv = startScene.gameLogic?.programFacts?.entities?.item_armorInv;
const sourceItemShells = logic?.programFacts?.entities?.item_shells;
const sourceWeaponRocketLauncher = logic?.programFacts?.entities?.weapon_rocketlauncher;
const sourceQuadDamage = logic?.programFacts?.entities?.item_artifact_super_damage;
const sourceInvulnerability = logic?.programFacts?.entities?.item_artifact_invulnerability;
const sourceEnvirosuit = logic?.programFacts?.entities?.item_artifact_envirosuit;
const sourceInvisibility = e1m3Scene.gameLogic?.programFacts?.entities?.item_artifact_invisibility;
const e1m2FactIndex = indexQuakeGameLogicEntityFacts(e1m2Scene.gameLogic);
const monsterArmy = entities.find((entity) => entity.classname === "monster_army");
const monsterDog = entities.find((entity) => entity.classname === "monster_dog");
const postLiftMonsterArmy = entities.find((entity) => entity.entityIndex === 246 && entity.classname === "monster_army");
const postLiftMonsterDog = entities.find((entity) => entity.entityIndex === 247 && entity.classname === "monster_dog");
const rebuiltPostLiftMonsterArmy = rebuiltEntities.find((entity) => entity.entityIndex === 246 && entity.classname === "monster_army");
const rebuiltPostLiftMonsterDog = rebuiltEntities.find((entity) => entity.entityIndex === 247 && entity.classname === "monster_dog");
const triggerOnce = entities.find((entity) => entity.classname === "trigger_once");
const triggerTeleport = entities.find((entity) => entity.classname === "trigger_teleport");
const triggerChangelevel = entities.find((entity) => entity.classname === "trigger_changelevel");
const sourceMonsterDog = logic?.programFacts?.entities?.monster_dog;
const sourceTriggerOnce = logic?.programFacts?.entities?.trigger_once;
const sourceTriggerMultiple = logic?.programFacts?.entities?.trigger_multiple;
const sourceTriggerSecret = logic?.programFacts?.entities?.trigger_secret;
const sourceTriggerCounter = rebuiltLogic?.programFacts?.entities?.trigger_counter ?? logic?.programFacts?.entities?.trigger_counter;
const sourceTriggerTeleport = logic?.programFacts?.entities?.trigger_teleport;
const sourceTriggerChangelevel = logic?.programFacts?.entities?.trigger_changelevel;
const runtimeMoverStates = buildRuntimeMoverStates(createQuakeMoversController, scene, logic);
const runtimeFuncPlat = runtimeMoverStates.get(70);
const runtimeLowTriggerPlat = runtimeMoverStates.get(188);
const runtimeDoor14 = runtimeMoverStates.get(14);
const runtimeDoor29 = runtimeMoverStates.get(29);
const runtimeDoor46 = runtimeMoverStates.get(46);
const runtimeStartOpenDoor = runtimeMoverStates.get(83);
const runtimeButton30 = runtimeMoverStates.get(30);
const runtimeButton88 = runtimeMoverStates.get(88);
const runtimeButton148 = runtimeMoverStates.get(148);
const runtimeE1M1SecretDoorStates = buildRuntimeMoverStates(
  createQuakeMoversController,
  scene,
  logic,
  [97, 132, 133, 186, 189],
);
const runtimeE1M1SecretDoor97 = runtimeE1M1SecretDoorStates.get(97);
const runtimeE1M1SecretDoor132 = runtimeE1M1SecretDoorStates.get(132);
const runtimeE1M2TrainStates = buildRuntimeMoverStatesForIndexes(
  createQuakeMoversController,
  e1m2Scene,
  e1m2Scene.gameLogic,
  [186, 190, 174, 175, 176, 178, 181, 182, 183, 184],
);
const runtimeE1M2Train186 = runtimeE1M2TrainStates.get(186);
const runtimeE1M2Train190 = runtimeE1M2TrainStates.get(190);
const runtimeE1M2ManifestTrainStates = buildRuntimeMoverStates(
  createQuakeMoversController,
  e1m2Scene,
  e1m2Scene.gameLogic,
  [186, 190],
);
const runtimeE1M6ManifestTrainStates = buildRuntimeMoverStates(
  createQuakeMoversController,
  e1m6Scene,
  e1m6Scene.gameLogic,
  [157],
);
const runtimeCounter214 = buildRuntimeCounterAudit(createQuakeTargetsController, scene, logic, 214);
const runtimeRelay482 = buildRuntimeRelayAudit(createQuakeTargetsController, e1m4Scene, e1m4Scene.gameLogic, 482);
const runtimeMessage338 = buildRuntimeUseTargetsMessageAudit(createQuakeTargetsController, scene, logic, 338);
const runtimeSetSkill214 = buildRuntimeSetSkillAudit(quakeTriggerSetSkillValue, startScene, startScene.gameLogic, 214);
const runtimeOnlyRegistered213 = buildRuntimeOnlyRegisteredActivationAudit(
  quakeTriggerOnlyRegisteredActivation,
  startScene,
  startScene.gameLogic,
  213,
);
const runtimeOnlyRegisteredTarget213 = buildRuntimeOnlyRegisteredTargetAudit(
  createQuakeTargetsController,
  startScene,
  startScene.gameLogic,
  213,
);
const runtimeOnlyRegisteredKill373 = buildRuntimeOnlyRegisteredKilltargetAudit(
  createQuakeTargetsController,
  startScene,
  startScene.gameLogic,
  373,
  [372, 373],
);
const runtimeSecret312 = buildRuntimeSecretAudit(
  createQuakeTriggersController,
  quakeTriggerOneShot,
  quakeTriggerSecretActivation,
  scene,
  logic,
  312,
);
const runtimeTeleport178 = buildRuntimeTeleportAudit(quakeTriggerTeleportDestination, scene, logic, 178);
const runtimeChangelevel345 = buildRuntimeChangelevelAudit(quakeTriggerChangelevelMap, scene, logic, 345);
const runtimeSpikeshooterTargetT121 = buildRuntimeTargetFireAudit(
  createQuakeTargetsController,
  e1m2Scene,
  e1m2Scene.gameLogic,
  "t121",
);
const runtimeHurtSynthetic = buildRuntimeTriggerHurtAudit(quakeTriggerHurtDamageAmount);
const runtimePushSynthetic = buildRuntimeTriggerPushAudit(quakeTriggerPushActivation);
const runtimeArmorPickup20 = buildRuntimePickupAudit(quakePickupEffectForEntity, quakePickupModelPath, scene, logic, 20);
const runtimeRocketWeapon201 = buildRuntimePickupAudit(quakePickupEffectForEntity, quakePickupModelPath, scene, logic, 201);
const runtimeRocketWeaponGrantEffect = ammoInventoryEffect(
  rebuiltRocketWeapon201?.resolvedPickup?.behavior?.weapon?.ammoGrant,
);
const runtimeRocketAmmo203 = buildRuntimePickupAudit(quakePickupEffectForEntity, quakePickupModelPath, scene, logic, 203);
const runtimeRottenHealth208 = buildRuntimePickupAudit(quakePickupEffectForEntity, quakePickupModelPath, scene, logic, 208);
const syntheticAmmoScene = buildSyntheticAmmoPickupScene(scene);
const syntheticAmmoLogic = buildRebuiltGameLogic(syntheticAmmoScene);
const syntheticAmmoPickupAudits = AMMO_PICKUP_CLASSNAMES.flatMap((classname, index) =>
  [false, true].map((big) =>
    buildSyntheticAmmoPickupAudit(
      quakePickupEffectForEntity,
      quakePickupModelPath,
      syntheticAmmoScene,
      syntheticAmmoLogic,
      classname,
      index,
      big,
    )
  )
);
const syntheticWeaponScene = buildSyntheticWeaponPickupScene(scene);
const syntheticWeaponLogic = buildRebuiltGameLogic(syntheticWeaponScene);
const syntheticWeaponPickupAudits = WEAPON_PICKUP_CLASSNAMES.map((classname, index) =>
  buildSyntheticWeaponPickupAudit(
    quakePickupEffectForEntity,
    quakePickupModelPath,
    syntheticWeaponScene,
    syntheticWeaponLogic,
    classname,
    index,
  )
);
const runtimeDoor14BlockDamage = buildRuntimeMoverBlockDamageAudit(quakeMoverBlockDamage, runtimeDoor14);
const runtimeDoor29BlockDamage = buildRuntimeMoverBlockDamageAudit(quakeMoverBlockDamage, runtimeDoor29);
const runtimePlat70BlockDamage = buildRuntimeMoverBlockDamageAudit(quakeMoverBlockDamage, runtimeFuncPlat);
const runtimeE1M6Train157BlockDamage = buildRuntimeMoverBlockDamageAudit(
  quakeMoverBlockDamage,
  runtimeE1M6ManifestTrainStates.get(157),
);
const rebuiltE1M2SoundPreloads = deriveQuakeGameLogicSoundPreloads(rebuiltE1M2Logic);
const rebuiltE1M6SoundPreloads = deriveQuakeGameLogicSoundPreloads(rebuiltE1M6Logic);

const checks = [
  [
    logic?.version === 1,
    "prepared scene should include gameLogic version 1",
  ],
  [
    logic?.sources?.bsp?.label === scene.label,
    "gameLogic BSP source label should match the prepared scene",
  ],
  [
    rebuiltLogic.sources?.bsp?.worldtype === 2 &&
      rebuiltE1M2Logic.sources?.bsp?.worldtype === 0 &&
      rebuiltE1M6Logic.sources?.bsp?.worldtype === 1,
    "rebuilt map facts should expose worldspawn worldtype as a BSP source fact",
  ],
  [
    sourceWorldspawn?.functionName === "worldspawn" &&
      sourceWorldspawn.assetRefs?.length === 0 &&
      sourceWorldspawn.calls?.includes("InitBodyQue") &&
      sourceWorldspawn.calls?.includes("W_Precache") &&
      rebuiltWorldspawn?.programClassname === "worldspawn" &&
      rebuiltWorldspawn.category === "worldspawn" &&
      rebuiltWorldspawn.runtimeStatus === "active" &&
      rebuiltWorldspawn.properties?.message === "the Slipgate Complex" &&
      rebuiltWorldspawn.properties?.worldtype === rebuiltLogic.sources?.bsp?.worldtype,
    "rebuilt worldspawn facts should join compact QuakeC provenance to BSP world metadata",
  ],
  [
    entities.length === scene.entities?.length,
    "gameLogic entity facts should cover every prepared entity",
  ],
  [
    logic?.spawnSets?.singleplayerEasy?.length > 0 &&
      logic.spawnSets.singleplayerNormal?.length > 0 &&
      logic.spawnSets.singleplayerHard?.length > 0,
    "gameLogic should include singleplayer skill spawn sets",
  ],
  [
    JSON.stringify(logic?.modes?.supported) === JSON.stringify([
      "singleplayer:easy",
      "singleplayer:normal",
      "singleplayer:hard",
    ]),
    "gameLogic should expose supported singleplayer modes",
  ],
  [
    JSON.stringify(logic?.modes?.unsupported) === JSON.stringify([
      "multiplayer:deathmatch",
      "multiplayer:coop",
    ]),
    "gameLogic should expose unsupported multiplayer modes",
  ],
  [
    JSON.stringify(logic?.modes?.skillSpawnflagMasks) === JSON.stringify({
      notEasy: 256,
      notNormal: 512,
      notHard: 1024,
    }),
    "gameLogic should expose Quake skill spawnflag masks",
  ],
  [
    JSON.stringify(logic?.modes?.deathmatchSpawnflagMasks) === JSON.stringify({
      notDeathmatch: 2048,
    }),
    "gameLogic should expose Quake deathmatch spawnflag masks",
  ],
  [
    deathmatchStarts.length === 5 &&
      deathmatchStarts.every((entity) =>
        entity.category === "multiplayer" &&
        entity.runtimeStatus === "ignored" &&
        JSON.stringify(entity.modeMask) === JSON.stringify(["multiplayer:deathmatch"])
      ),
    "E1M1 deathmatch starts should be marked as unsupported multiplayer metadata",
  ],
  [
    coopStarts.length === 3 &&
      coopStarts.every((entity) =>
        entity.category === "multiplayer" &&
        entity.runtimeStatus === "ignored" &&
        JSON.stringify(entity.modeMask) === JSON.stringify(["multiplayer:coop"])
      ),
    "E1M1 coop starts should be marked as unsupported multiplayer metadata",
  ],
  [
    hardOnlyMonster?.spawnflags === 768 &&
      JSON.stringify(hardOnlyMonster.modeMask) === JSON.stringify(["singleplayer:hard"]),
    "E1M1 hard-only monster should expose the not-easy/not-normal mode mask",
  ],
  [
    normalHardMonster?.spawnflags === 256 &&
      JSON.stringify(normalHardMonster.modeMask) === JSON.stringify([
        "singleplayer:normal",
        "singleplayer:hard",
      ]),
    "E1M1 normal-or-hard monster should expose the not-easy mode mask",
  ],
  [
    singleplayerDisabledPickup?.spawnflags === 1792 &&
      JSON.stringify(singleplayerDisabledPickup.modeMask) === JSON.stringify([]),
    "E1M1 all-skill-disabled pickup should expose an empty singleplayer mode mask",
  ],
  [
    sourceItemArmor1?.callbacks?.touch === "armor_touch" &&
      sourceItemArmor1.dependencies?.models?.includes("progs/armor.mdl") &&
      sourceItemArmor1.calls?.includes("StartItem"),
    "source-backed item_armor1 facts should expose touch callback, model, and StartItem",
  ],
  [
    programBranchValue(sourceItemArmor1, "armor_touch", "item_armor1", "type") === 0.3 &&
      programBranchValue(sourceItemArmor2, "armor_touch", "item_armor2", "type") === 0.6 &&
      programBranchValue(sourceItemArmorInv, "armor_touch", "item_armorInv", "type") === 0.8 &&
      programBranchValue(sourceItemArmorInv, "armor_touch", "item_armorInv", "value") === 200 &&
      programBranchExpression(sourceItemArmorInv, "armor_touch", "item_armorInv", "bit") === "IT_ARMOR3",
    "source-backed armor pickup facts should expose armor_touch type/value/item branches",
  ],
  [
    sourceItemShells?.callbacks?.touch === "ammo_touch" &&
      sourceItemShells.dependencies?.models?.includes("maps/b_shell0.bsp") &&
      sourceItemShells.dependencies?.models?.includes("maps/b_shell1.bsp") &&
      sourceItemShells.spawnflagChecks?.some((check) => check.name === "WEAPON_BIG2" && check.value === 1),
    "source-backed item_shells facts should expose ammo callback, small/large models, and big spawnflag",
  ],
  [
    sourceWeaponRocketLauncher?.callbacks?.touch === "weapon_touch" &&
      sourceWeaponRocketLauncher.dependencies?.models?.includes("progs/g_rock2.mdl") &&
      sourceWeaponRocketLauncher.fieldAssignments?.some((assignment) => assignment.field === "netname" && assignment.value === "Rocket Launcher"),
    "source-backed weapon_rocketlauncher facts should expose weapon callback, model, and netname",
  ],
  [
    programBranchValue(sourceWeaponRocketLauncher, "weapon_touch", "weapon_rocketlauncher", "new") === 32 &&
      programBranchExpression(
        sourceWeaponRocketLauncher,
        "weapon_touch",
        "weapon_rocketlauncher",
        "new",
      ) === "IT_ROCKET_LAUNCHER" &&
      programBranchExpression(
        sourceWeaponRocketLauncher,
        "weapon_touch",
        "weapon_rocketlauncher",
        "other.ammo_rockets",
      ) === "other.ammo_rockets + 5" &&
      programBranchValue(sourceWeaponRocketLauncher, "weapon_touch", "weapon_lightning", "new") === 64 &&
      programBranchExpression(
        sourceWeaponRocketLauncher,
        "weapon_touch",
        "weapon_lightning",
        "other.ammo_cells",
      ) === "other.ammo_cells + 15",
    "source-backed weapon_touch facts should expose weapon item flags and ammo grants",
  ],
  [
    sourceQuadDamage?.callbacks?.touch === "powerup_touch" &&
      sourceQuadDamage.dependencies?.models?.includes("progs/quaddama.mdl") &&
      sourceQuadDamage.dependencies?.sounds?.includes("items/damage.wav"),
    "source-backed quad damage facts should expose powerup callback, model, and sounds",
  ],
  [
    programBranchValue(
      sourceQuadDamage,
      "powerup_touch",
      "item_artifact_super_damage",
      "other.super_time",
    ) === 1 &&
      programBranchExpression(
        sourceQuadDamage,
        "powerup_touch",
        "item_artifact_super_damage",
        "other.super_damage_finished",
      ) === "time + 30" &&
      programBranchValue(
        sourceInvulnerability,
        "powerup_touch",
        "item_artifact_invulnerability",
        "other.invincible_time",
      ) === 1 &&
      programBranchExpression(
        sourceInvulnerability,
        "powerup_touch",
        "item_artifact_invulnerability",
        "other.invincible_finished",
      ) === "time + 30" &&
      programBranchValue(
        sourceEnvirosuit,
        "powerup_touch",
        "item_artifact_envirosuit",
        "other.rad_time",
      ) === 1 &&
      programBranchExpression(
        sourceInvisibility,
        "powerup_touch",
        "item_artifact_invisibility",
        "other.invisible_finished",
      ) === "time + 30",
    "source-backed powerup pickup facts should expose powerup_touch timer branches",
  ],
  [
    armorPickup20?.resolvedPickup?.kind === "item_armor1" &&
      armorPickup20.resolvedPickup.modelPath === "progs/armor.mdl" &&
      JSON.stringify(armorPickup20.resolvedPickup.inventoryDelta) === JSON.stringify({ armor: 100 }) &&
      armorPickup20.resolvedPickup.behavior?.armor?.armorType === 0.3 &&
      armorPickup20.resolvedPickup.behavior.armor.armorValue === 100 &&
      armorPickup20.resolvedPickup.behavior.armor.itemFlagExpression === "IT_ARMOR1" &&
      armorPickup20.resolvedPickup.feedback?.message === "You got armor" &&
      armorPickup20.resolvedPickup.callbacks.touch === "armor_touch",
    "E1M1 item_armor1 should resolve model, armor behavior/effect, message, and callback facts",
  ],
  [
    JSON.stringify(armorPickup20?.resolvedPickup?.lifecycle) === JSON.stringify({
      pickup: {
        disablesTouch: true,
        firesTargets: true,
        hidesModel: true,
      },
      respawn: {
        function: "SUB_regen",
        rules: [
          {
            action: "respawn",
            condition: "deathmatch == 1",
            delaySeconds: 20,
            think: "SUB_regen",
          },
          {
            action: "remove",
            condition: "singleplayer || deathmatch != 1",
          },
        ],
      },
    }),
    "E1M1 armor should resolve QuakeC pickup lifecycle removal and deathmatch respawn facts",
  ],
  [
    JSON.stringify(rebuiltArmorPickup20?.resolvedPickup?.behavior?.armor) === JSON.stringify({
      armorType: 0.3,
      armorValue: 100,
      replacementScore: 30,
      replacesWhenCurrentScoreBelow: 30,
      itemFlag: 8192,
      itemFlagExpression: "IT_ARMOR1",
      clearsItemFlagExpression: "IT_ARMOR1 | IT_ARMOR2 | IT_ARMOR3",
    }) &&
      JSON.stringify(armorPickup354?.resolvedPickup?.behavior?.armor) === JSON.stringify({
      armorType: 0.6,
      armorValue: 150,
      itemFlag: 16384,
      itemFlagExpression: "IT_ARMOR2",
    }) &&
      JSON.stringify(startArmorInv271?.resolvedPickup?.behavior?.armor) === JSON.stringify({
        armorType: 0.8,
        armorValue: 200,
        itemFlag: 32768,
        itemFlagExpression: "IT_ARMOR3",
      }),
    "prepared yellow and red armor facts should resolve QuakeC armor behavior branches",
  ],
  [
    rebuiltArmorPickup20?.resolvedPickup?.feedback?.message === "You got armor" &&
      sceneArmorPickup20 &&
      quakePickupMessageForEntity(sceneArmorPickup20, rebuiltLogic) === "You got armor",
    "rebuilt E1M1 armor should resolve QuakeC pickup message facts",
  ],
  [
    pickupNotifyTextFactMatches(rebuiltArmorPickup20, "armor_touch") &&
      pickupNotifyTextFactMatches(e1m2Key114, "key_touch") &&
      pickupNotifyTextFactMatches(rebuiltRocketWeapon201, "weapon_touch") &&
      pickupNotifyTextFactMatches(rebuiltQuadPickup141, "powerup_touch"),
    "rebuilt pickup text facts should identify QuakeC sprint as top-left notify text",
  ],
  [
    megaHealthPickup200?.resolvedPickup?.kind === "item_health" &&
      megaHealthPickup200.resolvedPickup.modelPath === "maps/b_bh100.bsp" &&
      megaHealthPickup200.resolvedPickup.feedback?.message === "You receive 100 health" &&
      JSON.stringify(megaHealthPickup200.resolvedPickup.inventoryDelta) === JSON.stringify({ health: 100, healthMax: 250 }),
    "E1M1 megahealth should resolve QuakeC model, message, and health/max facts",
  ],
  [
    JSON.stringify(rebuiltMegaHealthPickup200?.resolvedPickup?.behavior?.health) === JSON.stringify({
        healAmount: 100,
        healFunction: "T_Heal",
        healType: 2,
        healthMax: 250,
        ignoreMaxHealth: true,
        rejectAtOrAboveHealth: 250,
        megahealth: {
          itemFlagExpression: "IT_SUPERHEALTH",
          rotDelaySeconds: 5,
          rotThink: "item_megahealth_rot",
        },
      }),
    "rebuilt E1M1 megahealth should expose explicit QuakeC health behavior facts",
  ],
  [
    rebuiltMegaHealthPickup200?.resolvedPickup?.feedback?.sound === "items/r_item2.wav" &&
      rebuiltMegaHealthPickup200.resolvedPickup.feedback.message === "You receive 100 health" &&
      sceneMegaHealthPickup200 &&
      quakePickupSoundPath(sceneMegaHealthPickup200, rebuiltLogic) === "items/r_item2.wav" &&
      quakePickupMessageForEntity(sceneMegaHealthPickup200, rebuiltLogic) === "You receive 100 health",
    "rebuilt E1M1 megahealth should resolve QuakeC feedback sound and message facts",
  ],
  [
    rottenHealthPickup208?.resolvedPickup?.kind === "item_health" &&
      rottenHealthPickup208.resolvedPickup.modelPath === "maps/b_bh10.bsp" &&
      JSON.stringify(rottenHealthPickup208.resolvedPickup.inventoryDelta) === JSON.stringify({ health: 15, healthMax: 100 }),
    "E1M1 rotten health should resolve QuakeC model and 15-health fact",
  ],
  [
    JSON.stringify(rebuiltRottenHealthPickup208?.resolvedPickup?.behavior?.health) === JSON.stringify({
        healAmount: 15,
        healFunction: "T_Heal",
        healType: 0,
        healthMax: 100,
        ignoreMaxHealth: false,
        rejectAtOrAboveHealth: 100,
      }),
    "rebuilt E1M1 rotten health should expose explicit QuakeC health behavior facts",
  ],
  [
    rebuiltRottenHealthPickup208?.resolvedPickup?.feedback?.sound === "items/r_item1.wav" &&
      rebuiltRottenHealthPickup208.resolvedPickup.feedback.message === "You receive 15 health" &&
      sceneRottenHealthPickup208 &&
      quakePickupSoundPath(sceneRottenHealthPickup208, rebuiltLogic) === "items/r_item1.wav" &&
      quakePickupMessageForEntity(sceneRottenHealthPickup208, rebuiltLogic) === "You receive 15 health",
    "rebuilt E1M1 rotten health should resolve QuakeC feedback sound and message facts",
  ],
  [
    e1m2PreparedKey114?.resolvedPickup?.feedback?.message === "You got the silver key" &&
      e1m6PreparedKey19?.resolvedPickup?.feedback?.message === "You got the gold runekey" &&
      e1m6PreparedKey49?.resolvedPickup?.feedback?.message === "You got the silver runekey",
    "prepared key pickup facts should include rebaked worldtype-aware messages",
  ],
  [
    JSON.stringify(e1m2PreparedKey114?.resolvedPickup?.lifecycle) === JSON.stringify({
      pickup: {
        disablesTouch: true,
        firesTargets: true,
        hidesModel: true,
        hideCondition: "!coop",
      },
      respawn: {
        rules: [
          {
            action: "leave",
            condition: "coop",
          },
          {
            action: "remove",
            condition: "!coop",
          },
        ],
      },
    }),
    "prepared key pickup facts should resolve QuakeC coop leave and non-coop removal lifecycle rules",
  ],
  [
    keyBehaviorMatches(e1m2Key114?.resolvedPickup?.behavior?.key, {
      key: "silver",
      itemFlag: 131072,
      itemFlagExpression: "IT_KEY1",
    }) &&
      keyBehaviorMatches(e1m6Key19?.resolvedPickup?.behavior?.key, {
        key: "gold",
        itemFlag: 262144,
        itemFlagExpression: "IT_KEY2",
      }),
    "rebuilt key pickup behavior facts should expose QuakeC item mutation and owned-key rejection",
  ],
  [
    e1m2Key114?.resolvedPickup?.feedback?.sound === "misc/medkey.wav" &&
      e1m2Key114.resolvedPickup.feedback.message === "You got the silver key" &&
      sceneE1M2Key114 &&
      quakePickupSoundPath(sceneE1M2Key114, rebuiltE1M2Logic) === "misc/medkey.wav" &&
      quakePickupMessageForEntity(sceneE1M2Key114, rebuiltE1M2Logic) === "You got the silver key" &&
      rebuiltE1M2SoundPreloads.soundPaths.includes("misc/medkey.wav"),
    "rebuilt E1M2 key should resolve worldtype 0 feedback sound, message, and preload dependency",
  ],
  [
    syntheticBaseKeycard114?.resolvedPickup?.feedback?.sound === "misc/basekey.wav" &&
      syntheticBaseKeycard114.resolvedPickup.feedback.message === "You got the silver keycard",
    "synthetic worldtype 2 key should resolve QuakeC base keycard feedback facts",
  ],
  [
    e1m6Key19?.resolvedPickup?.feedback?.message === "You got the gold runekey" &&
      sceneE1M6Key19 &&
      quakePickupMessageForEntity(sceneE1M6Key19, rebuiltE1M6Logic) === "You got the gold runekey",
    "rebuilt E1M6 gold key should resolve worldtype 1 pickup message facts",
  ],
  [
    e1m6Key49?.resolvedPickup?.feedback?.sound === "misc/runekey.wav" &&
      e1m6Key49.resolvedPickup.feedback.message === "You got the silver runekey" &&
      sceneE1M6Key49 &&
      quakePickupSoundPath(sceneE1M6Key49, rebuiltE1M6Logic) === "misc/runekey.wav" &&
      quakePickupMessageForEntity(sceneE1M6Key49, rebuiltE1M6Logic) === "You got the silver runekey" &&
      rebuiltE1M6SoundPreloads.soundPaths.includes("misc/runekey.wav"),
    "rebuilt E1M6 key should resolve worldtype 1 feedback sound, message, and preload dependency",
  ],
  [
    rocketAmmoPickup203?.resolvedPickup?.kind === "item_rockets" &&
      rocketAmmoPickup203.resolvedPickup.modelPath === "maps/b_rock1.bsp" &&
      JSON.stringify(rocketAmmoPickup203.resolvedPickup.inventoryDelta) === JSON.stringify({ rockets: 10 }),
    "E1M1 large rocket ammo should resolve QuakeC large-box model and ammo fact",
  ],
  [
    JSON.stringify(rocketAmmoPickup203?.resolvedPickup?.lifecycle?.respawn) === JSON.stringify({
      function: "SUB_regen",
      rules: [
        {
          action: "respawn",
          condition: "deathmatch == 1",
          delaySeconds: 30,
          think: "SUB_regen",
        },
        {
          action: "remove",
          condition: "singleplayer || deathmatch != 1",
        },
      ],
    }),
    "E1M1 rocket ammo should resolve QuakeC pickup lifecycle deathmatch respawn facts",
  ],
  [
    rebuiltRocketAmmoPickup203?.resolvedPickup?.feedback?.message === "You got the rockets" &&
      sceneRocketAmmoPickup203 &&
      quakePickupMessageForEntity(sceneRocketAmmoPickup203, rebuiltLogic) === "You got the rockets",
    "rebuilt E1M1 large rocket ammo should resolve QuakeC pickup message facts",
  ],
  [
    shellPickup207?.resolvedPickup?.kind === "item_shells" &&
      shellPickup207.resolvedPickup.modelPath === "maps/b_shell0.bsp" &&
      JSON.stringify(shellPickup207.resolvedPickup.inventoryDelta) === JSON.stringify({ shells: 20 }),
    "E1M1 small shell ammo should resolve QuakeC small-box model and ammo fact",
  ],
  [
    singleplayerDisabledPickup?.resolvedPickup?.kind === "weapon_rocketlauncher" &&
      singleplayerDisabledPickup.resolvedPickup.modelPath === "progs/g_rock2.mdl" &&
      JSON.stringify(singleplayerDisabledPickup.resolvedPickup.inventoryDelta) === JSON.stringify({ rockets: 5 }),
    "E1M1 rocket launcher pickup should resolve source-backed model and ammo fact even when skill-disabled",
  ],
  [
    JSON.stringify(rebuiltRocketWeapon201?.resolvedPickup?.behavior?.weapon) === JSON.stringify({
      itemFlag: 32,
      itemFlagExpression: "IT_ROCKET_LAUNCHER",
      ammoGrant: {
        inventoryField: "rockets",
        playerField: "ammo_rockets",
        amount: 5,
        hadAmmoPlayerField: "ammo_rockets",
      },
      ownedWeaponReject: {
        condition: "deathmatch == 2 || coop",
        itemFlagExpression: "IT_ROCKET_LAUNCHER",
      },
      activeWeapon: {
        bestWeaponFunction: "W_BestWeapon",
        clampAmmoFunction: "bound_other_ammo",
        currentAmmoFunction: "W_SetCurrentAmmo",
        deathmatchFunction: "Deathmatch_Weapon",
        singleplayerAssignment: "self.weapon = new",
      },
    }),
    "rebuilt weapon pickup facts should resolve QuakeC item flag, ammo grant, owned rejection, and weapon switch facts",
  ],
  [
    rebuiltRocketWeapon201?.resolvedPickup?.feedback?.message === "You got the Rocket Launcher" &&
      sceneRocketWeapon201 &&
      quakePickupMessageForEntity(sceneRocketWeapon201, rebuiltLogic) === "You got the Rocket Launcher",
    "rebuilt E1M1 rocket launcher pickup should resolve QuakeC pickup message facts",
  ],
  [
    JSON.stringify(rebuiltRocketWeapon201?.resolvedPickup?.lifecycle) === JSON.stringify({
      pickup: {
        disablesTouch: true,
        firesTargets: true,
        hidesModel: true,
        hideCondition: "!(deathmatch == 2 || coop)",
      },
      respawn: {
        function: "SUB_regen",
        rules: [
          {
            action: "leave",
            condition: "deathmatch == 2 || coop",
          },
          {
            action: "respawn",
            condition: "deathmatch == 1",
            delaySeconds: 30,
            think: "SUB_regen",
          },
          {
            action: "remove",
            condition: "singleplayer",
          },
        ],
      },
    }),
    "E1M1 rocket launcher should resolve QuakeC leave, removal, and deathmatch respawn lifecycle rules",
  ],
  [
    quadPickup141?.resolvedPickup?.kind === "item_artifact_super_damage" &&
      quadPickup141.resolvedPickup.modelPath === "progs/quaddama.mdl" &&
      JSON.stringify(quadPickup141.resolvedPickup.inventoryDelta) === JSON.stringify({}) &&
      quadPickup141.resolvedPickup.callbacks.touch === "powerup_touch" &&
      powerupBehaviorMatches(quadPickup141.resolvedPickup.behavior?.powerup, {
        activationField: "super_time",
        durationSeconds: 30,
        finishedField: "super_damage_finished",
        itemFlag: 4194304,
        itemFlagExpression: "IT_QUAD",
      }),
    "E1M1 quad damage should resolve powerup model, callback, and behavior facts",
  ],
  [
    JSON.stringify(quadPickup141?.resolvedPickup?.lifecycle?.respawn) === JSON.stringify({
      function: "SUB_regen",
      rules: [
        {
          action: "respawn",
          condition: "deathmatch",
          delaySeconds: 60,
          think: "SUB_regen",
        },
        {
          action: "remove",
          condition: "!deathmatch",
        },
      ],
    }) &&
      JSON.stringify(invulnerabilityPickup244?.resolvedPickup?.lifecycle?.respawn) === JSON.stringify({
        function: "SUB_regen",
        rules: [
          {
            action: "respawn",
            condition: "deathmatch",
            delaySeconds: 300,
            think: "SUB_regen",
          },
          {
            action: "remove",
            condition: "!deathmatch",
          },
        ],
      }),
    "prepared powerup facts should resolve QuakeC short and long deathmatch respawn lifecycle rules",
  ],
  [
    powerupBehaviorMatches(invulnerabilityPickup244?.resolvedPickup?.behavior?.powerup, {
      activationField: "invincible_time",
      durationSeconds: 30,
      finishedField: "invincible_finished",
      itemFlag: 1048576,
      itemFlagExpression: "IT_INVULNERABILITY",
    }) &&
      powerupBehaviorMatches(envirosuitPickup251?.resolvedPickup?.behavior?.powerup, {
        activationField: "rad_time",
        durationSeconds: 30,
        finishedField: "radsuit_finished",
        itemFlag: 2097152,
        itemFlagExpression: "IT_SUIT",
      }) &&
      powerupBehaviorMatches(e1m3Invisibility543?.resolvedPickup?.behavior?.powerup, {
        activationField: "invisible_time",
        durationSeconds: 30,
        finishedField: "invisible_finished",
        itemFlag: 524288,
        itemFlagExpression: "IT_INVISIBILITY",
      }),
    "prepared powerup facts should resolve QuakeC timer and item flag behavior branches",
  ],
  [
    powerupBehaviorMatches(rebuiltQuadPickup141?.resolvedPickup?.behavior?.powerup, {
      activationField: "super_time",
      durationSeconds: 30,
      finishedField: "super_damage_finished",
      itemFlag: 4194304,
      itemFlagExpression: "IT_QUAD",
    }, { requireMutation: true }) &&
      powerupBehaviorMatches(rebuiltInvulnerabilityPickup244?.resolvedPickup?.behavior?.powerup, {
        activationField: "invincible_time",
        durationSeconds: 30,
        finishedField: "invincible_finished",
        itemFlag: 1048576,
        itemFlagExpression: "IT_INVULNERABILITY",
      }, { requireMutation: true }) &&
      powerupBehaviorMatches(rebuiltEnvirosuitPickup251?.resolvedPickup?.behavior?.powerup, {
        activationField: "rad_time",
        durationSeconds: 30,
        finishedField: "radsuit_finished",
        itemFlag: 2097152,
        itemFlagExpression: "IT_SUIT",
      }, { requireMutation: true }) &&
      powerupBehaviorMatches(rebuiltE1M3Invisibility543?.resolvedPickup?.behavior?.powerup, {
        activationField: "invisible_time",
        durationSeconds: 30,
        finishedField: "invisible_finished",
        itemFlag: 524288,
        itemFlagExpression: "IT_INVISIBILITY",
      }, { requireMutation: true }),
    "rebuilt powerup behavior facts should expose QuakeC item mutation and timer source expressions",
  ],
  [
    rebuiltQuadPickup141?.resolvedPickup?.feedback?.message === "You got the Quad Damage" &&
      sceneQuadPickup141 &&
      quakePickupMessageForEntity(sceneQuadPickup141, rebuiltLogic) === "You got the Quad Damage",
    "rebuilt E1M1 quad damage should resolve QuakeC pickup message facts",
  ],
  [
    runtimeArmorPickup20.factModelPath === "progs/armor.mdl" &&
      runtimeArmorPickup20.fallbackModelPath === "progs/armor.mdl" &&
      JSON.stringify(runtimeArmorPickup20.factEffect) === JSON.stringify({ armor: 100, armorType: 0.3 }) &&
      JSON.stringify(runtimeArmorPickup20.poisonedFactEffect) === JSON.stringify({ armor: 100, armorType: 0.3 }),
    "runtime pickup helper should prefer prebaked armor facts with fallback-compatible output",
  ],
  [
    runtimeRocketWeapon201.factModelPath === "progs/g_rock2.mdl" &&
      runtimeRocketWeapon201.fallbackModelPath === "progs/g_rock2.mdl" &&
      JSON.stringify(runtimeRocketWeapon201.factEffect) === JSON.stringify({ rockets: 5 }) &&
      JSON.stringify(runtimeRocketWeapon201.poisonedFactEffect) === JSON.stringify({ rockets: 5 }),
    "runtime pickup helper should prefer prebaked weapon facts with fallback-compatible output",
  ],
  [
    JSON.stringify(runtimeRocketWeaponGrantEffect) === JSON.stringify({ rockets: 5 }) &&
      JSON.stringify(runtimeRocketWeapon201.factEffect) === JSON.stringify(runtimeRocketWeaponGrantEffect) &&
      JSON.stringify(runtimeRocketWeapon201.poisonedFactEffect) === JSON.stringify(runtimeRocketWeaponGrantEffect),
    "runtime pickup helper weapon output should match source-backed weapon ammo grant facts",
  ],
  [
    syntheticWeaponPickupAudits.length === WEAPON_PICKUP_CLASSNAMES.length &&
      syntheticWeaponPickupAudits.every((item) =>
        item.factEntity?.resolvedPickup?.behavior?.weapon &&
          JSON.stringify(item.factEntity.resolvedPickup.inventoryDelta) === JSON.stringify(item.grantEffect) &&
          JSON.stringify(item.audit.factEffect) === JSON.stringify(item.grantEffect) &&
          JSON.stringify(item.audit.fallbackEffect) === JSON.stringify(item.grantEffect) &&
          JSON.stringify(item.audit.poisonedFactEffect) === JSON.stringify(item.grantEffect) &&
          JSON.stringify(item.audit.poisonedFallbackEffect) === JSON.stringify(item.grantEffect)
      ),
    "runtime pickup helper weapon output should match source-backed ammo grant facts for every weapon branch",
  ],
  [
    runtimeRocketAmmo203.factModelPath === "maps/b_rock1.bsp" &&
      runtimeRocketAmmo203.fallbackModelPath === "maps/b_rock1.bsp" &&
      JSON.stringify(runtimeRocketAmmo203.factEffect) === JSON.stringify({ rockets: 10 }) &&
      JSON.stringify(runtimeRocketAmmo203.poisonedFactEffect) === JSON.stringify({ rockets: 10 }) &&
      JSON.stringify(runtimeRocketAmmo203.poisonedFallbackEffect) === JSON.stringify({ rockets: 5 }),
    "runtime pickup helper should prefer prebaked large ammo facts over poisoned entity spawnflags",
  ],
  [
    syntheticAmmoPickupAudits.length === AMMO_PICKUP_CLASSNAMES.length * 2 &&
      syntheticAmmoPickupAudits.every((item) =>
        item.factEntity?.resolvedPickup?.behavior?.ammo &&
          JSON.stringify(item.factEntity.resolvedPickup.inventoryDelta) === JSON.stringify(item.grantEffect) &&
          JSON.stringify(item.audit.factEffect) === JSON.stringify(item.grantEffect) &&
          JSON.stringify(item.audit.fallbackEffect) === JSON.stringify(item.grantEffect) &&
          JSON.stringify(item.audit.poisonedFactEffect) === JSON.stringify(item.grantEffect) &&
          JSON.stringify(item.audit.poisonedFallbackEffect) === JSON.stringify(item.poisonedFallbackEffect)
      ),
    "runtime pickup helper ammo output should match source-backed small and big ammo facts for every ammo branch",
  ],
  [
    runtimeRottenHealth208.factModelPath === "maps/b_bh10.bsp" &&
      runtimeRottenHealth208.fallbackModelPath === "maps/b_bh10.bsp" &&
      JSON.stringify(runtimeRottenHealth208.factEffect) === JSON.stringify({ health: 15, healthMax: 100 }) &&
      JSON.stringify(runtimeRottenHealth208.poisonedFactEffect) === JSON.stringify({ health: 15, healthMax: 100 }) &&
      JSON.stringify(runtimeRottenHealth208.poisonedFallbackEffect) === JSON.stringify({ health: 25, healthMax: 100 }),
    "runtime pickup helper should prefer prebaked rotten health facts over poisoned entity spawnflags",
  ],
  [
    !!funcPlat,
    "E1M1 gameLogic should include first func_plat entity 70",
  ],
  [
    funcPlat?.model === "*7" && funcPlat?.modelIndex === 7,
    "E1M1 first func_plat should resolve to BSP model *7",
  ],
  [
    !!funcPlat && !!logic?.brushModels?.[String(funcPlat.modelIndex)],
    "E1M1 first func_plat gameLogic entity should resolve to a baked brush model",
  ],
  [
    JSON.stringify(funcPlat?.brushModel?.mins) === JSON.stringify({ x: -591, y: 2625, z: -127 }) &&
      JSON.stringify(funcPlat?.brushModel?.maxs) === JSON.stringify({ x: -497, y: 2687, z: 31 }),
    "E1M1 first func_plat should expose expected Quake-space brush bounds",
  ],
  [
    funcPlat?.resolvedMover?.kind === "func_plat" &&
      funcPlat.resolvedMover.speed === 150 &&
      funcPlat.resolvedMover.waitAtTop === 3 &&
      funcPlat.resolvedMover.sounds === 1 &&
      funcPlat.resolvedMover.soundSet?.move === "plats/plat1.wav" &&
      funcPlat.resolvedMover.soundSet?.stop === "plats/plat2.wav",
    "E1M1 first func_plat should resolve QuakeC defaults and selected sound set",
  ],
  [
    funcPlat?.resolvedMover?.initialState === "bottom" &&
      JSON.stringify(funcPlat.resolvedMover.topOrigin) === JSON.stringify({ x: 0, y: 0, z: 0 }) &&
      JSON.stringify(funcPlat.resolvedMover.bottomOrigin) === JSON.stringify({ x: 0, y: 0, z: -150 }) &&
      funcPlat.resolvedMover.travelDistance === 150 &&
      JSON.stringify(funcPlat.resolvedMover.travelOffset) === JSON.stringify({ x: 0, y: 0, z: -150 }),
    "E1M1 first func_plat should resolve top/bottom positions and travel distance",
  ],
  [
    JSON.stringify(funcPlat?.resolvedMover?.trigger?.mins) === JSON.stringify({ x: -566, y: 2650, z: -119 }) &&
      JSON.stringify(funcPlat?.resolvedMover?.trigger?.maxs) === JSON.stringify({ x: -522, y: 2662, z: 39 }) &&
      funcPlat?.resolvedMover?.trigger?.touch === "plat_center_touch" &&
      funcPlat?.resolvedMover?.trigger?.lowTrigger === false,
    "E1M1 first func_plat should resolve QuakeC inside-trigger bounds",
  ],
  [
    runtimeFuncPlat?.prebakedPlat?.trigger?.ownerEntityIndex === 70 &&
      runtimeFuncPlat.speed === 150 * QUAKE_COLLISION_UNIT_SCALE &&
      runtimeFuncPlat.wait === 3 &&
      runtimeFuncPlat.mode === "closed" &&
      sameArray(runtimeFuncPlat.closedOffset, [0, 0, -150 * QUAKE_COLLISION_UNIT_SCALE]) &&
      sameArray(runtimeFuncPlat.openOffset, [0, 0, 0]),
    "runtime movers should consume first func_plat prebaked travel and defaults",
  ],
  [
    lowTriggerPlat?.resolvedMover?.trigger?.lowTrigger === true &&
      lowTriggerPlat.resolvedMover.travelDistance === 400 &&
      JSON.stringify(lowTriggerPlat.resolvedMover.trigger.maxs) === JSON.stringify({ x: 806, y: 518, z: -313 }),
    "E1M1 low-trigger func_plat should resolve low trigger height and explicit travel",
  ],
  [
    runtimeLowTriggerPlat?.prebakedPlat?.trigger?.lowTrigger === true &&
      runtimeLowTriggerPlat.speed === 150 * QUAKE_COLLISION_UNIT_SCALE &&
      runtimeLowTriggerPlat.wait === 3 &&
      sameArray(runtimeLowTriggerPlat.closedOffset, [0, 0, -400 * QUAKE_COLLISION_UNIT_SCALE]) &&
      sameArray(runtimeLowTriggerPlat.openOffset, [0, 0, 0]),
    "runtime movers should consume low-trigger func_plat prebaked travel and defaults",
  ],
  [
    !!sourceFuncPlat?.defaultAssignments?.some((assignment) => assignment.field === "speed" && assignment.value === 150),
    "source-backed func_plat facts should include speed default 150",
  ],
  [
    sourceFuncPlat?.callbacks?.blocked === "plat_crush" &&
      sourceFuncPlat?.callbacks?.use === "plat_use" &&
      sourceFuncPlat?.calls?.includes("plat_spawn_inside_trigger"),
    "source-backed func_plat facts should expose blocked/use callbacks and inside-trigger spawn call",
  ],
  [
    !!sourceFuncPlat?.dependencies?.sounds?.includes("plats/medplat1.wav"),
    "source-backed func_plat facts should include medium platform sounds",
  ],
  [
    funcDoors.length === 14,
    `E1M1 should include 14 func_door entities, found ${funcDoors.length}`,
  ],
  [
    sourceFuncDoor?.defaultAssignments?.some((assignment) => assignment.field === "speed" && assignment.value === 100) &&
      sourceFuncDoor.defaultAssignments?.some((assignment) => assignment.field === "wait" && assignment.value === 3) &&
      sourceFuncDoor.defaultAssignments?.some((assignment) => assignment.field === "lip" && assignment.value === 8) &&
      sourceFuncDoor.defaultAssignments?.some((assignment) => assignment.field === "dmg" && assignment.value === 2),
    "source-backed func_door facts should include speed/wait/lip/dmg defaults",
  ],
  [
    sourceFuncDoor?.callbacks?.blocked === "door_blocked" &&
      sourceFuncDoor?.callbacks?.touch === "door_touch" &&
      sourceFuncDoor?.callbacks?.use === "door_use" &&
      sourceFuncDoor?.callbacks?.think === "LinkDoors",
    "source-backed func_door facts should expose blocked/touch/use/think callbacks",
  ],
  [
    sourceFuncDoor?.callbackFacts?.door_touch?.calls?.includes("centerprint") &&
      sourceFuncDoor.callbackFacts.door_touch.sourceRefs?.[0]?.functionName === "door_touch",
    "source-backed func_door facts should include door_touch centerprint callback facts",
  ],
  [
    doorGeneratedTextFactMatches(e1m2SilverDoor413, "silver", 0, "You need the silver key") &&
      doorGeneratedTextFactMatches(e1m6GoldRuneDoor8, "gold", 1, "You need the gold runekey"),
    "rebuilt key door generated text facts should identify door_touch centerprint routing",
  ],
  [
    door14?.resolvedMover?.kind === "func_door" &&
      door14.resolvedMover.speed === 400 &&
      door14.resolvedMover.wait === 3 &&
      door14.resolvedMover.lip === 8 &&
      door14.resolvedMover.dmg === 2 &&
      closeVector(door14.resolvedMover.travelOffset, { x: 0, y: -94, z: 0 }) &&
      door14.resolvedMover.linkedDoorGroup?.ownerEntityIndex === 14 &&
      sameArray(door14.resolvedMover.linkedDoorGroup.linkedEntityIndexes, [14, 15]),
    "E1M1 first linked func_door should resolve travel/defaults and group membership",
  ],
  [
    door15?.resolvedMover?.kind === "func_door" &&
      closeVector(door15.resolvedMover.travelOffset, { x: 0, y: 92, z: 0 }) &&
      door15.resolvedMover.linkedDoorGroup?.ownerEntityIndex === 14 &&
      sameArray(door15.resolvedMover.linkedDoorGroup.linkedEntityIndexes, [14, 15]),
    "E1M1 second linked func_door should resolve travel and shared group membership",
  ],
  [
    JSON.stringify(door14?.resolvedMover?.trigger?.mins) === JSON.stringify({ x: 149, y: 453, z: -7 }) &&
      JSON.stringify(door14?.resolvedMover?.trigger?.maxs) === JSON.stringify({ x: 315, y: 699, z: 135 }) &&
      door14?.resolvedMover?.trigger?.touch === "door_touch" &&
      sameArray(door14.resolvedMover.trigger.linkedEntityIndexes, [14, 15]),
    "E1M1 first linked func_door group should resolve LinkDoors trigger bounds",
  ],
  [
    JSON.stringify(door46?.resolvedMover?.trigger?.mins) === JSON.stringify({ x: 5, y: 1717, z: -215 }) &&
      JSON.stringify(door46?.resolvedMover?.trigger?.maxs) === JSON.stringify({ x: 251, y: 1883, z: -73 }) &&
      door46?.resolvedMover?.trigger?.touch === "door_touch" &&
      sameArray(door46.resolvedMover.trigger.linkedEntityIndexes, [46, 47]) &&
      door47?.resolvedMover?.trigger?.ownerEntityIndex === 46,
    "E1M1 second linked func_door group should resolve shared LinkDoors trigger bounds",
  ],
  [
    startOpenDoor?.resolvedMover?.kind === "func_door" &&
      startOpenDoor.resolvedMover.startsOpen === true &&
      startOpenDoor.resolvedMover.wait === -1 &&
      startOpenDoor.resolvedMover.trigger === undefined,
    "E1M1 targetnamed start-open func_door should not spawn an automatic door trigger",
  ],
  [
    runtimeDoor14?.prebakedDoor?.trigger?.ownerEntityIndex === 14 &&
      runtimeDoor14.speed === 400 * QUAKE_COLLISION_UNIT_SCALE &&
      runtimeDoor14.wait === 3 &&
      sameArray(runtimeDoor14.openOffset, scaledVector(door14?.resolvedMover?.travelOffset)),
    "runtime movers should consume first linked func_door prebaked travel/defaults/trigger",
  ],
  [
    runtimeDoor46?.prebakedDoor?.trigger?.ownerEntityIndex === 46 &&
      runtimeDoor46.speed === 400 * QUAKE_COLLISION_UNIT_SCALE &&
      runtimeDoor46.wait === 3 &&
      sameArray(runtimeDoor46.openOffset, scaledVector(door46?.resolvedMover?.travelOffset)),
    "runtime movers should consume second linked func_door prebaked travel/defaults/trigger",
  ],
  [
    runtimeStartOpenDoor?.prebakedDoor?.startsOpen === true &&
      runtimeStartOpenDoor.wait === -1 &&
      sameArray(runtimeStartOpenDoor.closedOffset, scaledVector(startOpenDoor?.resolvedMover?.travelOffset)) &&
      sameArray(runtimeStartOpenDoor.openOffset, [0, 0, 0]),
    "runtime movers should consume start-open func_door prebaked travel with fallback-compatible offsets",
  ],
  [
    runtimeDoor14BlockDamage.factDamage === 2 &&
      runtimeDoor14BlockDamage.poisonedFactDamage === 2 &&
      runtimeDoor14BlockDamage.fallbackDamage === 2 &&
      runtimeDoor14BlockDamage.poisonedFallbackDamage === 99,
    "runtime mover block damage should prefer prebaked default func_door damage with entity fallback",
  ],
  [
    runtimeDoor29BlockDamage.factDamage === 10 &&
      runtimeDoor29BlockDamage.poisonedFactDamage === 10 &&
      runtimeDoor29BlockDamage.fallbackDamage === 10 &&
      runtimeDoor29BlockDamage.poisonedFallbackDamage === 99,
    "runtime mover block damage should prefer prebaked explicit func_door damage with entity fallback",
  ],
  [
    funcButtons.length === 6,
    `E1M1 should include 6 func_button entities, found ${funcButtons.length}`,
  ],
  [
    sourceFuncButton?.defaultAssignments?.some((assignment) => assignment.field === "speed" && assignment.value === 40) &&
      sourceFuncButton.defaultAssignments?.some((assignment) => assignment.field === "wait" && assignment.value === 1) &&
      sourceFuncButton.defaultAssignments?.some((assignment) => assignment.field === "lip" && assignment.value === 4),
    "source-backed func_button facts should include speed/wait/lip defaults",
  ],
  [
    sourceFuncButton?.callbacks?.blocked === "button_blocked" &&
      sourceFuncButton?.callbacks?.use === "button_use" &&
      sourceFuncButton?.callbacks?.touch === "button_touch" &&
      sourceFuncButton?.callbacks?.th_die === "button_killed",
    "source-backed func_button facts should expose blocked/use/touch/death callbacks",
  ],
  [
    !!sourceFuncButton?.dependencies?.sounds?.includes("buttons/switch02.wav") &&
      !!sourceFuncButton.dependencies.sounds.includes("buttons/airbut1.wav"),
    "source-backed func_button facts should include QuakeC button sounds",
  ],
  [
    sourceFuncTrain?.defaultAssignments?.some((assignment) => assignment.field === "speed" && assignment.value === 100) &&
      sourceFuncTrain.defaultAssignments?.some((assignment) => assignment.field === "dmg" && assignment.value === 2) &&
      sourceFuncTrain.callbacks?.blocked === "train_blocked" &&
      sourceFuncTrain.callbacks?.use === "train_use" &&
      sourceFuncTrain.callbacks?.think === "func_train_find",
    "source-backed func_train facts should include QuakeC defaults and callbacks",
  ],
  [
    sourceFuncTrain?.dependencies?.sounds?.includes("misc/null.wav") &&
      sourceFuncTrain.dependencies.sounds.includes("plats/train1.wav") &&
      sourceFuncTrain.dependencies.sounds.includes("plats/train2.wav"),
    "source-backed func_train facts should include train sound dependencies",
  ],
  [
    sourceFuncDoorSecret?.defaultAssignments?.some((assignment) => assignment.field === "wait" && assignment.value === 5) &&
      sourceFuncDoorSecret.defaultAssignments?.some((assignment) => assignment.field === "dmg" && assignment.value === 2) &&
      sourceFuncDoorSecret.defaultAssignments?.some((assignment) => assignment.field === "sounds" && assignment.value === 3) &&
      sourceFuncDoorSecret.callbacks?.touch === "secret_touch" &&
      sourceFuncDoorSecret.callbacks?.blocked === "secret_blocked" &&
      sourceFuncDoorSecret.callbacks?.use === "fd_secret_use",
    "source-backed func_door_secret facts should include QuakeC defaults and callbacks",
  ],
  [
    sourceFuncDoorSecret?.dependencies?.sounds?.includes("doors/latch2.wav") &&
      sourceFuncDoorSecret.dependencies.sounds.includes("doors/winch2.wav") &&
      sourceFuncDoorSecret.dependencies.sounds.includes("doors/basesec1.wav") &&
      sourceFuncDoorSecret.callbackFacts?.fd_secret_use?.calls?.includes("sound") &&
      sourceFuncDoorSecret.callbackFacts?.fd_secret_done?.assignments?.some((assignment) =>
        assignment.field === "self.th_pain" && assignment.expression === "fd_secret_use"
      ),
    "source-backed func_door_secret facts should include secret-door sounds and callback-chain facts",
  ],
  [
    e1m1SecretDoor97?.programClassname === "func_door_secret" &&
      e1m1SecretDoor97.category === "mover" &&
      e1m1SecretDoor97.runtimeStatus === "active" &&
      rebuiltE1M2SecretDoor460?.programClassname === "func_door_secret" &&
      rebuiltE1M2SecretDoor460.category === "mover" &&
      rebuiltE1M2SecretDoor460.runtimeStatus === "active",
    "rebuilt map facts should classify func_door_secret entities as active movers",
  ],
  [
    runtimeE1M1SecretDoor97?.kind === "secret-door" &&
      runtimeE1M1SecretDoor97.wait === 5 &&
      runtimeE1M1SecretDoor97.speed === 100 * QUAKE_COLLISION_UNIT_SCALE &&
      runtimeE1M1SecretDoor97.once === true &&
      !runtimeE1M1SecretDoor97.prebakedDoor &&
      runtimeE1M1SecretDoor132?.kind === "secret-door" &&
      runtimeE1M1SecretDoor132.wait === 5 &&
      runtimeE1M1SecretDoor132.once === false &&
      !runtimeE1M1SecretDoor132.prebakedDoor,
    "runtime mover setup should consume func_door_secret as classname-backed secret-door states",
  ],
  [
    sourcePathCorner?.calls?.includes("movetarget_f") &&
      sourcePathCorner.callbackFacts?.movetarget_f?.assignments?.some((assignment) =>
        assignment.field === "self.touch" && assignment.expression === "t_movetarget"
      ) &&
      sourcePathCorner.callbackFacts?.movetarget_f?.calls?.includes("setsize"),
    "source-backed path_corner facts should include movetarget setup and touch callback facts",
  ],
  [
    sourceInfoTeleportDestination?.fieldAssignments?.some((assignment) =>
      assignment.field === "mangle" && assignment.expression === "self.angles"
    ) &&
      sourceInfoTeleportDestination.fieldAssignments?.some((assignment) =>
        assignment.field === "origin" && assignment.expression === "self.origin + '0 0 27'"
      ) &&
      e1m1TeleportDestination204?.programClassname === "info_teleport_destination" &&
      e1m1TeleportDestination204.runtimeStatus === "metadata-only" &&
      e1m1TeleportDestination204.properties?.targetname === "t6",
    "source-backed info_teleport_destination facts should preserve QuakeC destination adjustments and map targetname",
  ],
  [
    sourceMiscFireball?.callbacks?.think === "fire_fly" &&
      sourceMiscFireball.dependencies?.models?.includes("progs/lavaball.mdl") &&
      sourceMiscFireball.callbackFacts?.fire_fly?.calls?.includes("spawn") &&
      sourceMiscFireball.callbackFacts?.fire_fly?.calls?.includes("setmodel") &&
      sourceMiscFireball.callbackFacts?.fire_fly?.assignments?.some((assignment) =>
        assignment.field === "self.think" && assignment.expression === "fire_fly"
      ) &&
      sourceMiscFireball.callbackFacts?.fire_touch?.calls?.includes("T_Damage") &&
      !sourceMiscFireball.defaultAssignments?.some((assignment) => assignment.field === "speed"),
    "source-backed misc_fireball facts should include fire_fly behavior without inventing a speed default",
  ],
  [
    rebuiltE1M6Fireball149?.programClassname === "misc_fireball" &&
      rebuiltE1M6Fireball149.dependencyModels?.includes("progs/lavaball.mdl") &&
      rebuiltStartFireball54?.programClassname === "misc_fireball" &&
      rebuiltStartFireball54.dependencyModels?.includes("progs/lavaball.mdl") &&
      sameArray(e1m6Scene.entityManifest?.runtime?.fireballEmitterEntityIndexes?.slice(0, 3), [149, 150, 151]) &&
      sameArray(startScene.entityManifest?.runtime?.fireballEmitterEntityIndexes, [54, 123, 124]),
    "rebuilt map facts and runtime indexes should expose misc_fireball emitters for App point hazards",
  ],
  [
    sourceTrapSpikeshooter?.callbacks?.use === "spikeshooter_use" &&
      sourceTrapSpikeshooter.dependencies?.models?.includes("progs/laser.mdl") &&
      sourceTrapSpikeshooter.dependencies?.sounds?.includes("weapons/spike2.wav") &&
      sourceTrapSpikeshooter.callbackFacts?.spikeshooter_use?.calls?.includes("launch_spike") &&
      rebuiltE1M2TrapSpikeshooter419?.programClassname === "trap_spikeshooter" &&
      rebuiltE1M2TrapSpikeshooter419.dependencyModels?.includes("progs/laser.mdl") &&
      rebuiltE1M6TrapSpikeshooter234?.programClassname === "trap_spikeshooter",
    "source-backed trap_spikeshooter facts should expose use callback, assets, and map entities",
  ],
  [
    sameArray(runtimeSpikeshooterTargetT121.directEntityIndexes, [419, 420, 491, 502, 503]) &&
      sameArray(runtimeSpikeshooterTargetT121.activatedTargets.map((item) => item.entityIndex), [419, 420, 491, 502, 503]),
    "runtime target controller should fire prebaked trap_spikeshooter target sets",
  ],
  [
    sourceFuncEpisodegate?.callbacks?.use === "func_wall_use" &&
      sourceFuncEpisodegate.fieldAssignments?.some((assignment) => assignment.field === "solid" && assignment.value === 4) &&
      sourceFuncEpisodegate.fieldAssignments?.some((assignment) => assignment.field === "movetype" && assignment.value === 7) &&
      sourceFuncBossgate?.callbacks?.use === "func_wall_use" &&
      sourceFuncBossgate.fieldAssignments?.some((assignment) => assignment.field === "solid" && assignment.value === 4) &&
      sourceFuncBossgate.fieldAssignments?.some((assignment) => assignment.field === "movetype" && assignment.value === 7),
    "source-backed episode/boss gate facts should include solid BSP setup and func_wall use callback",
  ],
  [
    rebuiltStartEpisodeGate344?.programClassname === "func_episodegate" &&
      rebuiltStartEpisodeGate344.runtimeStatus === "active" &&
      rebuiltStartEpisodeGate344.properties?.message === "The Doomed Dimension\\nhas been completed!" &&
      rebuiltStartBossGate310?.programClassname === "func_bossgate" &&
      rebuiltStartBossGate310.runtimeStatus === "active",
    "rebuilt start map facts should expose episode and boss gates as active solid gate entities",
  ],
  [
    button30?.resolvedMover?.kind === "func_button" &&
      button30.resolvedMover.speed === 40 &&
      button30.resolvedMover.wait === 1 &&
      button30.resolvedMover.lip === 4 &&
      button30.resolvedMover.sounds === 1 &&
      button30.resolvedMover.activationSound === "buttons/airbut1.wav" &&
      closeVector(button30.resolvedMover.travelOffset, { x: -2, y: 0, z: 0 }) &&
      button30.resolvedMover.callbacks.touch === "button_touch",
    "E1M1 first func_button should resolve QuakeC defaults, sound, callbacks, and travel",
  ],
  [
    button88?.resolvedMover?.kind === "func_button" &&
      button88.resolvedMover.speed === 50 &&
      button88.resolvedMover.wait === -1 &&
      button88.resolvedMover.sounds === 1 &&
      closeVector(button88.resolvedMover.travelOffset, { x: 0, y: -2, z: 0 }),
    "E1M1 wait-forever func_button should resolve explicit speed/wait and travel",
  ],
  [
    button148?.resolvedMover?.kind === "func_button" &&
      button148.resolvedMover.speed === 40 &&
      button148.resolvedMover.wait === 1 &&
      button148.resolvedMover.sounds === 3 &&
      button148.resolvedMover.activationSound === "buttons/switch02.wav" &&
      closeVector(button148.resolvedMover.travelOffset, { x: 0, y: -2, z: 0 }),
    "E1M1 default-sound func_button should resolve QuakeC sound default and travel",
  ],
  [
    runtimeButton30?.prebakedButton?.activationSound === "buttons/airbut1.wav" &&
      runtimeButton30.speed === 40 * QUAKE_COLLISION_UNIT_SCALE &&
      runtimeButton30.wait === 1 &&
      sameArray(runtimeButton30.openOffset, scaledVector(button30?.resolvedMover?.travelOffset)),
    "runtime movers should consume first func_button prebaked travel/defaults",
  ],
  [
    runtimeButton88?.prebakedButton?.wait === -1 &&
      runtimeButton88.once === true &&
      runtimeButton88.speed === 50 * QUAKE_COLLISION_UNIT_SCALE &&
      sameArray(runtimeButton88.openOffset, scaledVector(button88?.resolvedMover?.travelOffset)),
    "runtime movers should consume wait-forever func_button prebaked travel/defaults",
  ],
  [
    runtimeButton148?.prebakedButton?.sounds === 3 &&
      runtimeButton148.wait === 1 &&
      sameArray(runtimeButton148.openOffset, scaledVector(button148?.resolvedMover?.travelOffset)),
    "runtime movers should consume default-sound func_button prebaked travel/defaults",
  ],
  [
    e1m2Train186?.resolvedMover?.kind === "func_train" &&
      e1m2Train186.resolvedMover.speed === 50 &&
      e1m2Train186.resolvedMover.dmg === 2 &&
      e1m2Train186.resolvedMover.sounds === 1 &&
      e1m2Train186.resolvedMover.soundSet?.move === "plats/train2.wav" &&
      e1m2Train186.resolvedMover.soundSet?.stop === "plats/train1.wav" &&
      e1m2Train186.resolvedMover.callbacks.blocked === "train_blocked" &&
      e1m2Train186.resolvedMover.callbacks.use === "train_use" &&
      e1m2Train186.resolvedMover.callbacks.think === "func_train_find",
    "E1M2 first func_train should resolve QuakeC defaults, map speed/sounds, and callbacks",
  ],
  [
    e1m2Train186?.resolvedMover?.kind === "func_train" &&
      sameArray(e1m2Train186.resolvedMover.initialTargetEntityIndexes, [174]) &&
      e1m2Train186.resolvedMover.firstPathCornerEntityIndex === 174 &&
      sameArray(e1m2Train186.resolvedMover.path.cornerEntityIndexes, [174, 175, 176, 178]) &&
      e1m2Train186.resolvedMover.path.loops === true &&
      sameArray(e1m2Train186.resolvedMover.path.missingTargetnames, []) &&
      sameVector(e1m2Train186.resolvedMover.pathBaseOrigin, { x: -12, y: 312, z: 264 }) &&
      sameVector(e1m2Train186.resolvedMover.quakeCInitialOrigin, { x: -9, y: 135, z: -173 }),
    "E1M2 first func_train should resolve QuakeC initial origin and path-corner loop",
  ],
  [
    e1m2Train190?.resolvedMover?.kind === "func_train" &&
      sameArray(e1m2Train190.resolvedMover.initialTargetEntityIndexes, [181]) &&
      sameArray(e1m2Train190.resolvedMover.path.cornerEntityIndexes, [181, 182, 183, 184]) &&
      e1m2Train190.resolvedMover.path.loops === true &&
      sameVector(e1m2Train190.resolvedMover.quakeCInitialOrigin, { x: -25, y: 135, z: -173 }),
    "E1M2 second func_train should resolve its paired path-corner loop",
  ],
  [
    e1m2PathCorner176?.resolvedPathCorner?.kind === "path_corner" &&
      e1m2PathCorner176.resolvedPathCorner.wait === -1 &&
      e1m2PathCorner176.resolvedPathCorner.target === "t66" &&
      sameArray(e1m2PathCorner176.resolvedPathCorner.nextEntityIndexes, [178]),
    "E1M2 path_corner should resolve wait and next target indexes",
  ],
  [
    e1m6Train157?.resolvedMover?.kind === "func_train" &&
      e1m6Train157.resolvedMover.speed === 50 &&
      e1m6Train157.resolvedMover.dmg === 1000 &&
      sameArray(e1m6Train157.resolvedMover.initialTargetEntityIndexes, [158]) &&
      sameArray(e1m6Train157.resolvedMover.path.cornerEntityIndexes, [158, 159, 162]) &&
      e1m6Train157.resolvedMover.path.loops === true &&
      sameVector(e1m6Train157.resolvedMover.quakeCInitialOrigin, { x: -1, y: -1, z: 7 }),
    "E1M6 func_train should resolve explicit damage and three-corner loop",
  ],
  [
    e1m2FactIndex.get(186)?.resolvedMover?.kind === "func_train" &&
      quakeGameLogicResolvedMoverFact(e1m2Scene.gameLogic, 186)?.kind === "func_train" &&
      quakeGameLogicResolvedPathCornerFact(e1m2Scene.gameLogic, 176)?.wait === -1,
    "typed gameLogic fact helpers should resolve train and path-corner facts by entity index",
  ],
  [
    e1m2Train186?.category === "mover" &&
      e1m2Train190?.category === "mover" &&
      e1m6Train157?.category === "mover" &&
      e1m2Scene.entityManifest?.runtime?.moverEntityIndexes?.includes(186) &&
      e1m2Scene.entityManifest.runtime.moverEntityIndexes.includes(190) &&
      e1m2Scene.gameLogic?.runtimeIndexes?.moverEntityIndexes?.includes(186) &&
      e1m2Scene.gameLogic.runtimeIndexes.moverEntityIndexes.includes(190) &&
      e1m6Scene.entityManifest?.runtime?.moverEntityIndexes?.includes(157) &&
      e1m6Scene.gameLogic?.runtimeIndexes?.moverEntityIndexes?.includes(157),
    "prepared runtime indexes should expose func_train entities as active movers",
  ],
  [
    runtimeE1M2Train186?.prebakedTrain?.kind === "func_train" &&
      runtimeE1M2Train186.mode === "closed" &&
      runtimeE1M2Train186.speed === 50 * QUAKE_COLLISION_UNIT_SCALE &&
      runtimeE1M2Train186.pathCurrentTarget === "t62" &&
      runtimeE1M2Train186.pathNextTarget === "t63" &&
      sameArray(runtimeE1M2Train186.closedOffset, scaledVector(e1m2Train186?.resolvedMover?.quakeCInitialOrigin)) &&
      sameArray(runtimeE1M2Train186.offset, scaledVector(e1m2Train186?.resolvedMover?.quakeCInitialOrigin)) &&
      sameArray(runtimeE1M2Train186.openOffset, scaledTrainPathOffset(e1m2Train186?.resolvedMover, e1m2PathCorner175)),
    "runtime func_train should consume prebaked QuakeC initial origin and first path delta",
  ],
  [
    runtimeE1M2Train190?.prebakedTrain?.kind === "func_train" &&
      runtimeE1M2Train190.mode === "closed" &&
      runtimeE1M2Train190.pathCurrentTarget === "t70" &&
      runtimeE1M2Train190.pathNextTarget === "t67" &&
      sameArray(runtimeE1M2Train190.closedOffset, scaledVector(e1m2Train190?.resolvedMover?.quakeCInitialOrigin)) &&
      sameArray(runtimeE1M2Train190.openOffset, scaledTrainPathOffset(e1m2Train190?.resolvedMover, e1m2PathCorner182)),
    "runtime second func_train should consume its own prebaked origin/path pair",
  ],
  [
    runtimeE1M2ManifestTrainStates.get(186)?.prebakedTrain?.kind === "func_train" &&
      sameArray(runtimeE1M2ManifestTrainStates.get(186)?.closedOffset, scaledVector(e1m2Train186?.resolvedMover?.quakeCInitialOrigin)) &&
      runtimeE1M2ManifestTrainStates.get(190)?.prebakedTrain?.kind === "func_train" &&
      sameArray(runtimeE1M2ManifestTrainStates.get(190)?.closedOffset, scaledVector(e1m2Train190?.resolvedMover?.quakeCInitialOrigin)) &&
      runtimeE1M6ManifestTrainStates.get(157)?.prebakedTrain?.kind === "func_train" &&
      sameArray(runtimeE1M6ManifestTrainStates.get(157)?.closedOffset, scaledVector(e1m6Train157?.resolvedMover?.quakeCInitialOrigin)),
    "runtime mover setup should create func_train states from generated runtime indexes",
  ],
  [
    runtimePlat70BlockDamage.factDamage === 1 &&
      runtimePlat70BlockDamage.fallbackDamage === 1 &&
      runtimePlat70BlockDamage.poisonedFallbackDamage === 99,
    "runtime mover block damage should keep func_plat crush damage fallback",
  ],
  [
    runtimeE1M6Train157BlockDamage.factDamage === 1000 &&
      runtimeE1M6Train157BlockDamage.poisonedFactDamage === 1000 &&
      runtimeE1M6Train157BlockDamage.fallbackDamage === 1000 &&
      runtimeE1M6Train157BlockDamage.poisonedFallbackDamage === 99,
    "runtime mover block damage should prefer prebaked explicit func_train damage with entity fallback",
  ],
  [
    !!monsterArmy?.programClassname && monsterArmy.dependencyModels?.includes("progs/soldier.mdl"),
    "monster_army entity facts should reference source-backed soldier model dependencies",
  ],
  [
    !!monsterDog?.programClassname && monsterDog.dependencyModels?.includes("progs/dog.mdl"),
    "monster_dog entity facts should reference source-backed dog model dependencies",
  ],
  [
    JSON.stringify(postLiftMonsterArmy?.origin) === JSON.stringify({ x: 8, y: 1520, z: -200 }) &&
      postLiftMonsterArmy?.dependencyModels?.includes("progs/soldier.mdl"),
    "E1M1 post-lift monster_army entity 246 should keep source-backed soldier dependency",
  ],
  [
    JSON.stringify(postLiftMonsterDog?.origin) === JSON.stringify({ x: 88, y: 1520, z: -200 }) &&
      postLiftMonsterDog?.dependencyModels?.includes("progs/dog.mdl"),
    "E1M1 post-lift monster_dog entity 247 should keep source-backed dog dependency",
  ],
  [
    hasDependencyAsset(rebuiltPostLiftMonsterArmy, "model", "progs/soldier.mdl") &&
      hasDependencyAsset(rebuiltPostLiftMonsterArmy, "sound", "soldier/death1.wav") &&
      hasDependencyAsset(rebuiltPostLiftMonsterDog, "model", "progs/dog.mdl"),
    "rebuilt E1M1 map facts should project normalized monster model/sound dependencyAssets from current source facts",
  ],
  [
    hasDependencyAsset(rebuiltMegaHealthPickup200, "bsp", "maps/b_bh100.bsp") &&
      hasDependencyAsset(rebuiltMegaHealthPickup200, "sound", "items/health1.wav"),
    "rebuilt E1M1 map facts should project normalized pickup BSP/sound dependencyAssets from current source facts",
  ],
  [
    !!sourceMonsterDog?.setsizes?.some((setsize) =>
      JSON.stringify(setsize.min) === JSON.stringify([-32, -32, -24]) &&
      JSON.stringify(setsize.max) === JSON.stringify([32, 32, 40])
    ),
    "source-backed monster_dog facts should include QuakeC setsize bounds",
  ],
  [
    !!triggerOnce?.programClassname &&
      sourceTriggerOnce?.fieldAssignments?.some((assignment) => assignment.field === "wait" && assignment.value === -1),
    "trigger_once map facts should join source-backed wait -1 behavior",
  ],
  [
    sourceTriggerMultiple?.defaultAssignments?.some((assignment) => assignment.field === "wait" && assignment.value === 0.2) &&
      sourceTriggerMultiple?.callbacks?.touch === "multi_touch" &&
      sourceTriggerMultiple?.callbacks?.use === "multi_use" &&
      sourceTriggerMultiple?.callbacks?.th_die === "multi_killed" &&
      sourceTriggerMultiple?.spawnflagChecks?.some((check) => check.name === "SPAWNFLAG_NOTOUCH" && check.value === 1),
    "source-backed trigger_multiple facts should include wait default, callbacks, and NOTOUCH spawnflag",
  ],
  [
    sourceTriggerSecret?.defaultAssignments?.some((assignment) => assignment.field === "message" && assignment.value === "You found a secret area!") &&
      sourceTriggerSecret.defaultAssignments?.some((assignment) => assignment.field === "sounds" && assignment.value === 1) &&
      sourceTriggerSecret.calls?.includes("trigger_multiple") &&
      sourceTriggerSecret.dependencies?.sounds?.includes("misc/secret.wav"),
    "source-backed trigger_secret facts should include QuakeC defaults and trigger_multiple delegation",
  ],
  [
    sourceTriggerCounter?.callbacks?.use === "counter_use" &&
      sourceTriggerCounter.defaultAssignments?.some((assignment) => assignment.field === "count" && assignment.value === 2) &&
      sourceTriggerCounter.fieldAssignments?.some((assignment) => assignment.field === "wait" && assignment.value === -1),
    "source-backed trigger_counter facts should include use callback, count default, and wait -1",
  ],
  [
    sourceTriggerCounter?.callbackFacts?.counter_use?.calls?.includes("centerprint") &&
      sourceTriggerCounter.callbackFacts.counter_use.sourceRefs?.[0]?.functionName === "counter_use",
    "source-backed trigger_counter facts should include counter_use centerprint callback facts",
  ],
  [
    counterGeneratedTextFactsMatch(rebuiltTriggerCounter214, [
      "There are more to go...",
      "Only 3 more to go...",
      "Only 2 more to go...",
      "Only 1 more to go...",
      "Sequence completed!",
    ]) &&
      counterGeneratedTextFactsMatch(rebuiltE1M4Counter410, [
        "There are more to go...",
        "Only 3 more to go...",
        "Only 2 more to go...",
        "Only 1 more to go...",
        "Sequence completed!",
      ]),
    "rebuilt trigger_counter generated text facts should identify counter_use centerprint routing",
  ],
  [
    !!triggerTeleport?.programClassname &&
      sourceTriggerTeleport?.callbacks?.touch === "teleport_touch" &&
      sourceTriggerTeleport?.callbacks?.use === "teleport_use",
    "trigger_teleport map facts should join source-backed touch/use callbacks",
  ],
  [
    !!triggerChangelevel?.programClassname &&
      sourceTriggerChangelevel?.callbacks?.touch === "changelevel_touch",
    "trigger_changelevel map facts should join source-backed touch callback",
  ],
  [
    sourceBackedTriggers.length === 26 &&
      sourceBackedTriggers.every((entity) => entity.resolvedTrigger?.kind === entity.classname),
    `E1M1 should resolve source-backed trigger facts for 26 entities, found ${sourceBackedTriggers.length}`,
  ],
  [
    triggerCounter214?.resolvedTrigger?.kind === "trigger_counter" &&
      triggerCounter214.resolvedTrigger.wait === -1 &&
      triggerCounter214.resolvedTrigger.count === 3 &&
      triggerCounter214.resolvedTrigger.oneShot === true &&
      triggerCounter214.resolvedTrigger.touchActivates === false &&
      triggerCounter214.resolvedTrigger.useActivates === true &&
      triggerCounter214.resolvedTrigger.callbacks.use === "counter_use" &&
      triggerCounter214.resolvedTrigger.spawnflagChecks.some((check) => check.name === "SPAWNFLAG_NOMESSAGE" && check.value === 1) &&
      sameArray(triggerCounter214.resolvedTrigger.targetUse.targetEntityIndexes, [215]) &&
      sameModeTargetSets(triggerCounter214.resolvedTrigger.targetUse.activeTargetEntityIndexesByMode, {
        singleplayerEasy: [215],
        singleplayerNormal: [215],
        singleplayerHard: [215],
      }),
    "E1M1 trigger_counter should resolve use-only count and target facts",
  ],
  [
    runtimeCounter214.fireCount === 1 &&
      runtimeCounter214.activationsBeforeFire === 2 &&
      runtimeCounter214.activatedTargets.length === 1 &&
      runtimeCounter214.activatedTargets[0]?.entityIndex === 215,
    "runtime target controller should consume prebaked trigger_counter count over manifest count",
  ],
  [
    triggerSecret312?.resolvedTrigger?.kind === "trigger_secret" &&
      triggerSecret312.resolvedTrigger.source.inheritedSpawnFunction === "trigger_multiple" &&
      triggerSecret312.resolvedTrigger.wait === -1 &&
      triggerSecret312.resolvedTrigger.sounds === 1 &&
      triggerSecret312.resolvedTrigger.activationSound === "misc/secret.wav" &&
      triggerSecret312.resolvedTrigger.message === "You found a secret area!" &&
      triggerSecret312.resolvedTrigger.oneShot === true &&
      triggerSecret312.resolvedTrigger.touchActivates === true &&
      triggerSecret312.resolvedTrigger.useActivates === true &&
      triggerSecret312.resolvedTrigger.callbacks.touch === "multi_touch" &&
      triggerSecret312.resolvedTrigger.callbacks.use === "multi_use",
    "E1M1 trigger_secret should resolve QuakeC defaults and inherited trigger_multiple callbacks",
  ],
  [
    triggerCenterprintTextFactMatches(rebuiltTriggerSecret312, "SUB_UseTargets", "multi_touch") &&
      rebuiltTriggerSecret312.resolvedTrigger.message === "You found a secret area!",
    "rebuilt trigger_secret text facts should identify SUB_UseTargets centerprint routing",
  ],
  [
    runtimeSecret312.factActivation.message === "FACT SECRET" &&
      runtimeSecret312.factActivation.sound === "fact/secret.wav" &&
      runtimeSecret312.factActivation.oneShot === false &&
      runtimeSecret312.fallbackActivation.message === "ENTITY SECRET" &&
      runtimeSecret312.fallbackActivation.sound === "misc/secret.wav" &&
      runtimeSecret312.fallbackActivation.oneShot === true,
    "runtime trigger_secret helper should prefer prebaked message/sound/one-shot facts with entity fallback",
  ],
  [
    runtimeSecret312.touchUseTargets === 1 &&
      runtimeSecret312.touchDisableCalls === 0,
    "runtime trigger controller should respect fact-backed trigger_secret one-shot behavior",
  ],
  [
    triggerOnce98?.resolvedTrigger?.kind === "trigger_once" &&
      triggerOnce98.resolvedTrigger.source.inheritedSpawnFunction === "trigger_multiple" &&
      triggerOnce98.resolvedTrigger.wait === -1 &&
      triggerOnce98.resolvedTrigger.oneShot === true &&
      triggerOnce98.resolvedTrigger.sounds === 3 &&
      triggerOnce98.resolvedTrigger.activationSound === "misc/trigger1.wav" &&
      triggerOnce98.resolvedTrigger.callbacks.touch === "multi_touch" &&
      triggerOnce98.resolvedTrigger.callbacks.use === "multi_use" &&
      sameArray(triggerOnce98.resolvedTrigger.targetUse.targetEntityIndexes, [91, 92, 93, 94, 95, 97]) &&
      sameModeTargetSets(triggerOnce98.resolvedTrigger.targetUse.activeTargetEntityIndexesByMode, {
        singleplayerEasy: [97],
        singleplayerNormal: [97],
        singleplayerHard: [97],
      }),
    "E1M1 trigger_once should resolve inherited trigger_multiple behavior and exact raw/active target indexes",
  ],
  [
    shootableTrigger138?.resolvedTrigger?.kind === "trigger_multiple" &&
      shootableTrigger138.resolvedTrigger.wait === 0.2 &&
      shootableTrigger138.resolvedTrigger.health === 1 &&
      shootableTrigger138.resolvedTrigger.damageable === true &&
      shootableTrigger138.resolvedTrigger.touchActivates === false &&
      shootableTrigger138.resolvedTrigger.useActivates === true &&
      sameArray(shootableTrigger138.resolvedTrigger.targetUse.targetEntityIndexes, [137]),
    "E1M1 shootable trigger_multiple should resolve damage activation and target indexes",
  ],
  [
    triggerTeleport178?.resolvedTrigger?.kind === "trigger_teleport" &&
      triggerTeleport178.resolvedTrigger.callbacks.touch === "teleport_touch" &&
      triggerTeleport178.resolvedTrigger.callbacks.use === "teleport_use" &&
      triggerTeleport178.resolvedTrigger.touchActivates === true &&
      triggerTeleport178.resolvedTrigger.useActivates === true &&
      sameModeTargetSets(triggerTeleport178.resolvedTrigger.targetUse.activeTargetEntityIndexesByMode, {
        singleplayerEasy: [],
        singleplayerNormal: [],
        singleplayerHard: [],
      }) &&
      sameArray(triggerTeleport178.resolvedTrigger.destinationEntityIndexes, [204]) &&
      triggerTeleport178.resolvedTrigger.spawnflagChecks.some((check) => check.name === "SILENT" && check.value === 2),
    "E1M1 trigger_teleport should resolve destination indexes and source spawnflags",
  ],
  [
    runtimeTeleport178.factDestinationEntityIndex === 204 &&
      runtimeTeleport178.fallbackDestinationEntityIndex === 204 &&
      runtimeTeleport178.poisonedFallbackDestinationEntityIndex === null,
    "runtime trigger_teleport helper should prefer prebaked destination indexes with targetname fallback",
  ],
  [
    messageTrigger338?.resolvedTrigger?.kind === "trigger_multiple" &&
      messageTrigger338.resolvedTrigger.wait === 5 &&
      messageTrigger338.resolvedTrigger.sounds === 2 &&
      messageTrigger338.resolvedTrigger.activationSound === "misc/talk.wav" &&
      sameArray(messageTrigger338.resolvedTrigger.targetUse.targetEntityIndexes, []),
    "E1M1 message trigger_multiple should resolve explicit wait, sound, and empty target set",
  ],
  [
    rebuiltMessageTrigger338?.resolvedTrigger?.message === "You can jump across..." &&
      triggerCenterprintTextFactMatches(rebuiltMessageTrigger338, "SUB_UseTargets", "multi_touch"),
    "rebuilt trigger_multiple entity messages should identify SUB_UseTargets centerprint routing",
  ],
  [
    runtimeMessage338.useTargetsMessages.length === 1 &&
      runtimeMessage338.useTargetsMessages[0]?.text === "You can jump across..." &&
      runtimeMessage338.useTargetsMessages[0]?.sourceCall === "SUB_UseTargets" &&
      runtimeMessage338.useTargetsMessages[0]?.sourceFunction === "multi_touch",
    "runtime target controller should emit prebaked SUB_UseTargets centerprint message facts",
  ],
  [
    changelevelTrigger345?.resolvedTrigger?.kind === "trigger_changelevel" &&
      changelevelTrigger345.resolvedTrigger.changelevelMap === "e1m2" &&
      changelevelTrigger345.resolvedTrigger.callbacks.touch === "changelevel_touch" &&
      changelevelTrigger345.resolvedTrigger.oneShot === true &&
      changelevelTrigger345.resolvedTrigger.touchActivates === true &&
      changelevelTrigger345.resolvedTrigger.useActivates === false,
    "E1M1 trigger_changelevel should resolve destination map and source touch callback",
  ],
  [
    runtimeChangelevel345.factMap === "e1m2" &&
      runtimeChangelevel345.fallbackMap === "e1m2" &&
      runtimeChangelevel345.poisonedFallbackMap === "poisoned",
    "runtime trigger_changelevel helper should prefer prebaked destination maps with entity fallback",
  ],
  [
    runtimeHurtSynthetic.factDamage === 17 &&
      runtimeHurtSynthetic.fallbackDamage === 5 &&
      runtimeHurtSynthetic.poisonedFallbackDamage === 99,
    "runtime trigger_hurt helper should prefer prebaked damage with QuakeC entity fallback",
  ],
  [
    tutorialTrigger352?.resolvedTrigger?.kind === "trigger_once" &&
      sameArray(tutorialTrigger352.resolvedTrigger.targetUse.targetEntityIndexes, [339]) &&
      sameModeTargetSets(tutorialTrigger352.resolvedTrigger.targetUse.activeTargetEntityIndexesByMode, {
        singleplayerEasy: [339],
        singleplayerNormal: [339],
        singleplayerHard: [],
      }),
    "E1M1 tutorial trigger 352 should expose mode-filtered active targets",
  ],
  [
    tutorialTrigger353?.resolvedTrigger?.kind === "trigger_once" &&
      sameArray(tutorialTrigger353.resolvedTrigger.targetUse.targetEntityIndexes, [338]) &&
      sameModeTargetSets(tutorialTrigger353.resolvedTrigger.targetUse.activeTargetEntityIndexesByMode, {
        singleplayerEasy: [338],
        singleplayerNormal: [338],
        singleplayerHard: [],
      }),
    "E1M1 tutorial trigger 353 should expose mode-filtered active targets",
  ],
  [
    startRegistered213?.resolvedTrigger?.kind === "trigger_onlyregistered" &&
      startRegistered213.resolvedTrigger.source.initFunction === "InitTrigger" &&
      startRegistered213.resolvedTrigger.message === "For registered users only!\\nPlay episode 1\\nthen call 1-800-idgames" &&
      startRegistered213.resolvedTrigger.registeredOnly === true &&
      startRegistered213.resolvedTrigger.touchActivates === true &&
      startRegistered213.resolvedTrigger.useActivates === false &&
      startRegistered213.resolvedTrigger.callbacks.touch === "trigger_onlyregistered_touch" &&
      startRegistered213.dependencySounds?.includes("misc/talk.wav") &&
      sameArray(startRegistered213.resolvedTrigger.targetUse.targetEntityIndexes, [191]) &&
      sameModeTargetSets(startRegistered213.resolvedTrigger.targetUse.activeTargetEntityIndexesByMode, {
        singleplayerEasy: [191],
        singleplayerNormal: [191],
        singleplayerHard: [191],
      }),
    "start trigger_onlyregistered should resolve registered-only touch behavior and active target facts",
  ],
  [
    triggerCenterprintTextFactMatches(rebuiltStartRegistered213, "centerprint", "trigger_onlyregistered_touch") &&
      rebuiltStartRegistered213.resolvedTrigger.message ===
        "For registered users only!\\nPlay episode 1\\nthen call 1-800-idgames",
    "rebuilt trigger_onlyregistered text facts should identify direct centerprint routing",
  ],
  [
    startSkill214?.resolvedTrigger?.kind === "trigger_setskill" &&
      startSkill214.resolvedTrigger.skillValue === 0 &&
      startSkill214.resolvedTrigger.callbacks.touch === "trigger_skill_touch" &&
      startSkill214.resolvedTrigger.touchActivates === true &&
      startSkill303?.resolvedTrigger?.kind === "trigger_setskill" &&
      startSkill303.resolvedTrigger.skillValue === 3,
    "start trigger_setskill entities should resolve QuakeC skill values and touch callback",
  ],
  [
    runtimeSetSkill214.factSkillValue === 0 &&
      runtimeSetSkill214.fallbackSkillValue === 0 &&
      runtimeSetSkill214.poisonedFallbackSkillValue === 99,
    "runtime trigger_setskill helper should prefer prebaked skill values with entity fallback",
  ],
  [
    runtimeOnlyRegistered213.factBlocked?.allowed === false &&
      runtimeOnlyRegistered213.factBlocked.message === "FACT REGISTERED" &&
      runtimeOnlyRegistered213.fallbackBlocked?.allowed === false &&
      runtimeOnlyRegistered213.fallbackBlocked.message === "ENTITY REGISTERED" &&
      runtimeOnlyRegistered213.factAllowed?.allowed === true,
    "runtime trigger_onlyregistered helper should prefer prebaked message/registered facts with entity fallback",
  ],
  [
    sameArray(runtimeOnlyRegisteredTarget213.factActivatedEntityIndexes, [191]) &&
      sameArray(runtimeOnlyRegisteredTarget213.fallbackActivatedEntityIndexes, [191]) &&
      sameArray(runtimeOnlyRegisteredTarget213.poisonedFallbackActivatedEntityIndexes, []),
    "runtime target controller should consume prebaked trigger_onlyregistered target indexes with targetname fallback",
  ],
  [
    startRegisteredKill373?.resolvedTrigger?.kind === "trigger_onlyregistered" &&
      sameArray(startRegisteredKill373.resolvedTrigger.targetUse.killtargetEntityIndexes, [372, 373]) &&
      sameModeTargetSets(startRegisteredKill373.resolvedTrigger.targetUse.activeKilltargetEntityIndexesByMode, {
        singleplayerEasy: [372],
        singleplayerNormal: [372],
        singleplayerHard: [372],
      }) &&
      startRegisteredKill378?.resolvedTrigger?.kind === "trigger_onlyregistered" &&
      sameArray(startRegisteredKill378.resolvedTrigger.targetUse.killtargetEntityIndexes, [379]) &&
      sameModeTargetSets(startRegisteredKill378.resolvedTrigger.targetUse.activeKilltargetEntityIndexesByMode, {
        singleplayerEasy: [],
        singleplayerNormal: [],
        singleplayerHard: [],
      }),
    "start registered triggers should resolve raw and active killtarget sets",
  ],
  [
    sameArray(runtimeOnlyRegisteredKill373.factDisabledEntityIndexes, [372, 373]) &&
      sameArray(runtimeOnlyRegisteredKill373.fallbackDisabledEntityIndexes, [372, 373]) &&
      sameArray(runtimeOnlyRegisteredKill373.poisonedFallbackDisabledEntityIndexes, []),
    "runtime target controller should consume prebaked trigger_onlyregistered killtarget indexes with targetname fallback",
  ],
  [
    e1m4Counter445?.resolvedTrigger?.kind === "trigger_counter" &&
      e1m4Counter445.resolvedTrigger.count === 2 &&
      sameArray(e1m4Counter445.resolvedTrigger.targetUse.targetEntityIndexes, [439, 457]) &&
      sameModeTargetSets(e1m4Counter445.resolvedTrigger.targetUse.activeTargetEntityIndexesByMode, {
        singleplayerEasy: [439, 457],
        singleplayerNormal: [439, 457],
        singleplayerHard: [439, 457],
      }),
    "E1M4 default-count trigger_counter should resolve active target sets",
  ],
  [
    e1m4Relay482?.resolvedTrigger?.kind === "trigger_relay" &&
      e1m4Relay482.resolvedTrigger.callbacks.use === "SUB_UseTargets" &&
      e1m4Relay482.resolvedTrigger.touchActivates === false &&
      e1m4Relay482.resolvedTrigger.useActivates === true &&
      sameArray(e1m4Relay482.resolvedTrigger.targetUse.targetEntityIndexes, [478, 479]) &&
      sameModeTargetSets(e1m4Relay482.resolvedTrigger.targetUse.activeTargetEntityIndexesByMode, {
        singleplayerEasy: [478],
        singleplayerNormal: [478],
        singleplayerHard: [478],
      }),
    "E1M4 trigger_relay should resolve use callback and mode-filtered active targets",
  ],
  [
    sameArray(runtimeRelay482.factActivatedEntityIndexes, [478, 479]) &&
      sameArray(runtimeRelay482.fallbackActivatedEntityIndexes, [478, 479]) &&
      sameArray(runtimeRelay482.poisonedFallbackActivatedEntityIndexes, []),
    "runtime target controller should consume prebaked trigger_relay target indexes with targetname fallback",
  ],
  [
    e1m6Monsterjump367?.resolvedTrigger?.kind === "trigger_monsterjump" &&
      e1m6Monsterjump367.resolvedTrigger.source.initFunction === "InitTrigger" &&
      e1m6Monsterjump367.resolvedTrigger.speed === 200 &&
      e1m6Monsterjump367.resolvedTrigger.height === 200 &&
      closeVector(e1m6Monsterjump367.resolvedTrigger.moveDirection, { x: 1, y: 0, z: 0 }) &&
      e1m6Monsterjump367.resolvedTrigger.callbacks.touch === "trigger_monsterjump_touch" &&
      e1m6Monsterjump367.resolvedTrigger.touchActivates === true &&
      e1m6Monsterjump367.resolvedTrigger.useActivates === false,
    "E1M6 trigger_monsterjump should resolve QuakeC speed/height defaults and touch callback",
  ],
  [
    runtimePushSynthetic.factSpeed === 350 &&
      runtimePushSynthetic.factOneShot === true &&
      sameArray(runtimePushSynthetic.factVelocity, [0, 3500, 0]) &&
      runtimePushSynthetic.fallbackSpeed === 1000 &&
      runtimePushSynthetic.fallbackOneShot === false &&
      sameArray(runtimePushSynthetic.poisonedFallbackVelocity, [0, 0, 990]),
    "runtime trigger_push helper should prefer prebaked speed/direction/one-shot facts with entity fallback",
  ],
  [
    e1m3Entities.filter((entity) => entity.classname === "trigger_multiple").length === 0 &&
      e1m3Scene.gameLogic?.sources?.quakeC?.sourceClassnames?.includes("trigger_multiple") &&
      e1m3FirstOnce?.resolvedTrigger?.kind === "trigger_once" &&
      e1m3FirstOnce.resolvedTrigger.source.inheritedSpawnFunction === "trigger_multiple" &&
      e1m3FirstOnce.resolvedTrigger.callbacks.touch === "multi_touch",
    "E1M3 trigger_once should retain inherited trigger_multiple facts without a local trigger_multiple entity",
  ],
  [
    e1m8Entities.filter((entity) => entity.classname === "trigger_multiple").length === 0 &&
      e1m8Scene.gameLogic?.sources?.quakeC?.sourceClassnames?.includes("trigger_multiple") &&
      e1m8FirstSecret?.resolvedTrigger?.kind === "trigger_secret" &&
      e1m8FirstSecret.resolvedTrigger.source.inheritedSpawnFunction === "trigger_multiple" &&
      e1m8FirstSecret.resolvedTrigger.callbacks.touch === "multi_touch" &&
      e1m8FirstSecret.resolvedTrigger.message === "You found a secret area!",
    "E1M8 trigger_secret should retain inherited trigger_multiple facts without a local trigger_multiple entity",
  ],
  [
    JSON.stringify(logic?.targetGraph ?? {}) === JSON.stringify(scene.entityManifest?.runtime?.targetEntities ?? {}),
    "gameLogic target graph should mirror the entity manifest target graph",
  ],
];

checks.push([
  funcPlats.length === 2,
  `E1M1 should include two func_plat entities, found ${funcPlats.length}.`,
]);
for (const entity of funcPlats) {
  const model = logic?.models?.[String(entity.modelIndex)];
  const expected = model ? runtimeStyleFuncPlatFacts(entity, model) : null;
  const resolved = entity.resolvedMover;
  checks.push([
    !!model,
    `func_plat ${entity.entityIndex} should resolve a prepared model.`,
  ]);
  checks.push([
    resolved?.kind === "func_plat",
    `func_plat ${entity.entityIndex} should include resolvedMover facts.`,
  ]);
  if (!expected || !resolved) continue;
  checks.push([
    resolved.speed === expected.speed &&
      resolved.waitAtTop === expected.waitAtTop &&
      resolved.initialState === expected.initialState &&
      resolved.startsTop === expected.startsTop,
    `func_plat ${entity.entityIndex} runtime-style state should match resolved facts.`,
  ]);
  checks.push([
    sameVector(resolved.travelOffset, expected.travelOffset) &&
      resolved.travelDistance === expected.travelDistance &&
      sameVector(resolved.topOrigin, expected.topOrigin) &&
      sameVector(resolved.bottomOrigin, expected.bottomOrigin) &&
      sameVector(resolved.initialOrigin, expected.initialOrigin),
    `func_plat ${entity.entityIndex} runtime-style travel should match resolved facts.`,
  ]);
  checks.push([
    resolved.trigger.lowTrigger === expected.trigger.lowTrigger &&
      sameVector(resolved.trigger.mins, expected.trigger.mins) &&
      sameVector(resolved.trigger.maxs, expected.trigger.maxs),
    `func_plat ${entity.entityIndex} runtime-style trigger bounds should match resolved facts.`,
  ]);
}

for (const entity of funcButtons) {
  const model = logic?.models?.[String(entity.modelIndex)];
  const expected = model ? runtimeStyleFuncButtonFacts(entity, model) : null;
  const resolved = entity.resolvedMover;
  checks.push([
    !!model,
    `func_button ${entity.entityIndex} should resolve a prepared model.`,
  ]);
  checks.push([
    resolved?.kind === "func_button",
    `func_button ${entity.entityIndex} should include resolvedMover facts.`,
  ]);
  if (!expected || !resolved) continue;
  checks.push([
    resolved.speed === expected.speed &&
      resolved.wait === expected.wait &&
      resolved.lip === expected.lip &&
      resolved.sounds === expected.sounds &&
      resolved.activationSound === expected.activationSound &&
      resolved.initialState === "bottom",
    `func_button ${entity.entityIndex} runtime-style state should match resolved facts.`,
  ]);
  checks.push([
    resolved.travelDistance === expected.travelDistance &&
      closeVector(resolved.travelOffset, expected.travelOffset) &&
      closeVector(resolved.pos1Origin, expected.pos1Origin) &&
      closeVector(resolved.pos2Origin, expected.pos2Origin) &&
      closeVector(resolved.initialOrigin, expected.initialOrigin),
    `func_button ${entity.entityIndex} runtime-style travel should match resolved facts.`,
  ]);
}

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

console.log(`Quake gameLogic facts smoke passed: ${checks.length} checks (${path.relative(projectRoot, scenePath)}).`);

async function readSiblingScene(mapName) {
  return readScene(path.join(path.dirname(scenePath), `${mapName}.json`));
}

function sceneGameLogicEntities(inputScene) {
  return Array.isArray(inputScene?.gameLogic?.entities) ? inputScene.gameLogic.entities : [];
}

function pickupNotifyTextFactMatches(entity, sourceFunction) {
  const feedback = entity?.resolvedPickup?.feedback;
  const text = feedback?.text;
  return Boolean(
    feedback?.message &&
      text?.lane === "notify" &&
      text.text === feedback.message &&
      text.sourceCall === "sprint" &&
      text.sourceFunction === sourceFunction &&
      text.sourceFile &&
      text.sourceRef?.functionName === sourceFunction,
  );
}

function powerupBehaviorMatches(actual, expected, options = {}) {
  const baseMatches = Boolean(
    actual &&
      actual.activationField === expected.activationField &&
      actual.durationSeconds === expected.durationSeconds &&
      actual.finishedField === expected.finishedField &&
      actual.itemFlag === expected.itemFlag &&
      actual.itemFlagExpression === expected.itemFlagExpression,
  );
  if (!baseMatches) return false;
  if (!options.requireMutation) return true;
  return actual.activationValue === 1 &&
    actual.finishedExpression === "time + 30" &&
    actual.itemFlagMutation?.expression === "other.items | self.items" &&
    actual.itemFlagMutation?.sourceField === "self.items" &&
    actual.itemFlagMutation?.targetField === "other.items";
}

function keyBehaviorMatches(actual, expected) {
  return Boolean(
    actual &&
      actual.key === expected.key &&
      actual.itemFlag === expected.itemFlag &&
      actual.itemFlagExpression === expected.itemFlagExpression &&
      actual.itemFlagMutation?.expression === "other.items | self.items" &&
      actual.itemFlagMutation?.sourceField === "self.items" &&
      actual.itemFlagMutation?.targetField === "other.items" &&
      actual.ownedKeyReject?.expression === "other.items & self.items" &&
      actual.ownedKeyReject?.playerField === "items" &&
      actual.ownedKeyReject?.sourceField === "self.items",
  );
}

function triggerCenterprintTextFactMatches(entity, sourceCall, sourceFunction) {
  const trigger = entity?.resolvedTrigger;
  const text = trigger?.messageText;
  return Boolean(
    trigger?.message &&
      text?.lane === "centerprint" &&
      text.text === trigger.message &&
      text.sourceCall === sourceCall &&
      text.sourceFunction === sourceFunction &&
      text.sourceFile &&
      (!text.sourceRef || text.sourceRef.functionName === sourceFunction),
  );
}

function doorGeneratedTextFactMatches(entity, key, worldtype, message) {
  const mover = entity?.resolvedMover;
  const text = mover?.generatedText?.find((fact) => fact.reason === "door-key-required");
  return Boolean(
    mover?.kind === "func_door" &&
      mover.requiredKey === key &&
      text?.lane === "centerprint" &&
      text.text === message &&
      text.sourceCall === "centerprint" &&
      text.sourceFunction === "door_touch" &&
      text.condition?.key === key &&
      text.condition?.worldtype === worldtype &&
      text.sourceFile &&
      (!text.sourceRef || text.sourceRef.functionName === "door_touch"),
  );
}

function counterGeneratedTextFactsMatch(entity, messages) {
  const trigger = entity?.resolvedTrigger;
  const generatedText = trigger?.generatedText ?? [];
  return Boolean(
    trigger?.kind === "trigger_counter" &&
      messages.every((message) => {
        const text = generatedText.find((fact) => fact.text === message);
        return text?.lane === "centerprint" &&
          text.sourceCall === "centerprint" &&
          text.sourceFunction === "counter_use" &&
          text.condition?.spawnflagNotSet === "SPAWNFLAG_NOMESSAGE" &&
          text.sourceFile &&
          (!text.sourceRef || text.sourceRef.functionName === "counter_use");
      }),
  );
}

function buildRebuiltGameLogic(inputScene) {
  return buildQuakeGameLogicFacts({
    label: inputScene.label,
    entities: inputScene.entities ?? [],
    entityManifest: inputScene.entityManifest,
    models: inputScene.collision?.models ?? [],
    collision: inputScene.collision,
    programFacts: QUAKE_PROGRAM_FACTS,
  });
}

function buildSyntheticBaseKeycardLogic(inputScene, keyEntity) {
  const worldspawn = inputScene.entities?.find((entity) => entity.classname === "worldspawn");
  if (!worldspawn || !keyEntity) {
    return {
      entities: [],
    };
  }
  return buildRebuiltGameLogic({
    ...inputScene,
    label: `${inputScene.label ?? "synthetic"}-base-keycard`,
    entities: [
      {
        ...worldspawn,
        properties: {
          ...worldspawn.properties,
          worldtype: "2",
        },
      },
      keyEntity,
    ],
  });
}

async function readScene(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${path.relative(projectRoot, filePath)}. Run pnpm prepare:quake first.`);
    }
    throw error;
  }
}

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

function buildRuntimeMoverStates(createController, scene, logic, resultIndexes = [30, 88, 148, 14, 29, 46, 83, 70, 188]) {
  return buildRuntimeMoverStatesForIndexes(
    createController,
    scene,
    logic,
    [
      ...(scene.entityManifest?.runtime?.moverEntityIndexes ?? []),
      ...(scene.entityManifest?.runtime?.moverSupportEntityIndexes ?? []),
    ],
    resultIndexes,
  );
}

function buildRuntimeMoverStatesForIndexes(createController, scene, logic, setupIndexes, resultIndexes = setupIndexes) {
  const originalWindow = globalThis.window;
  if (!globalThis.window) {
    globalThis.window = {
      cancelAnimationFrame: () => undefined,
      requestAnimationFrame: () => 0,
    };
  }
  try {
    const controller = createController({
      applyState: () => undefined,
      fireTarget: () => undefined,
      groupUnlocked: () => true,
      playerBlocks: () => false,
    });
    controller.setup(
      quakeEntitiesForIndexes(setupIndexes, scene.entities ?? []),
      scene.models ?? scene.collision?.models ?? [],
      scene.collision?.pivot ?? { x: 0, y: 0, z: 0 },
      logic,
    );
    return new Map(resultIndexes.map((index) => [index, controller.get(index)]));
  } finally {
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }
}

function buildRuntimeCounterAudit(createController, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) return { activationsBeforeFire: -1, fireCount: 0, activatedTargets: [] };
  const originalWindow = globalThis.window;
  if (!globalThis.window) {
    globalThis.window = {
      clearTimeout: () => undefined,
      setTimeout: () => 0,
    };
  }
  try {
    const activatedTargets = [];
    const controller = createController({
      activateEntity: (targetEntityIndex, sourceEntityIndex) => {
        activatedTargets.push({ entityIndex: targetEntityIndex, sourceEntityIndex });
        return true;
      },
    });
    const runtime = JSON.parse(JSON.stringify(scene.entityManifest.runtime));
    runtime.triggerCounterCounts = runtime.triggerCounterCounts.map(([index]) =>
      index === entityIndex ? [index, 1] : [index, 1],
    );
    controller.setup(runtime, logic);
    let activationsBeforeFire = 0;
    let fireCount = 0;
    for (let i = 0; i < 3; i++) {
      const result = controller.activateCounter(entity);
      if (result?.completed) {
        fireCount++;
      } else {
        activationsBeforeFire++;
      }
    }
    return { activationsBeforeFire, fireCount, activatedTargets };
  } finally {
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }
}

function buildRuntimeRelayAudit(createController, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) {
    return {
      factActivatedEntityIndexes: [],
      fallbackActivatedEntityIndexes: [],
      poisonedFallbackActivatedEntityIndexes: [],
    };
  }
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.target = "poisoned-target";
  return {
    factActivatedEntityIndexes: useTargetsActivatedEntityIndexes(createController, scene, logic, testEntity, {
      poisonRuntimeTargetGraph: true,
    }),
    fallbackActivatedEntityIndexes: useTargetsActivatedEntityIndexes(createController, scene, null, entity),
    poisonedFallbackActivatedEntityIndexes: useTargetsActivatedEntityIndexes(createController, scene, null, testEntity, {
      poisonRuntimeTargetGraph: true,
    }),
  };
}

function buildRuntimeTargetFireAudit(createController, scene, logic, targetname) {
  const originalWindow = globalThis.window;
  if (!globalThis.window) {
    globalThis.window = {
      clearTimeout: () => undefined,
      setTimeout: () => 0,
    };
  }
  try {
    const activatedTargets = [];
    const controller = createController({
      activateEntity: (targetEntityIndex, sourceEntityIndex) => {
        activatedTargets.push({ entityIndex: targetEntityIndex, sourceEntityIndex });
        return true;
      },
    });
    controller.setup(scene.entityManifest.runtime, logic);
    const directEntityIndexes = controller.entityIndexesFor(targetname);
    controller.fire(targetname, 0);
    return { directEntityIndexes, activatedTargets };
  } finally {
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }
}

function buildRuntimeUseTargetsMessageAudit(createController, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) return { activatedEntityIndexes: [], disabledEntityIndexes: [], useTargetsMessages: [] };
  return useTargetsAudit(createController, scene, logic, entity);
}

function buildRuntimeSetSkillAudit(setSkillValueForTrigger, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) {
    return {
      factSkillValue: null,
      fallbackSkillValue: null,
      poisonedFallbackSkillValue: null,
    };
  }
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.message = "99";
  return {
    factSkillValue: setSkillValueForTrigger(testEntity, logic),
    fallbackSkillValue: setSkillValueForTrigger(entity, null),
    poisonedFallbackSkillValue: setSkillValueForTrigger(testEntity, null),
  };
}

function buildRuntimeOnlyRegisteredActivationAudit(onlyRegisteredActivationForTrigger, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) {
    return {
      factBlocked: null,
      fallbackBlocked: null,
      factAllowed: null,
    };
  }
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.message = "ENTITY REGISTERED";
  const testLogic = JSON.parse(JSON.stringify(logic));
  const factEntity = testLogic.entities.find((item) => item.entityIndex === entityIndex);
  if (factEntity?.resolvedTrigger?.kind === "trigger_onlyregistered") {
    factEntity.resolvedTrigger.message = "FACT REGISTERED";
  }
  return {
    factBlocked: onlyRegisteredActivationForTrigger(testEntity, {
      fallbackMessage: "FALLBACK REGISTERED",
      gameLogic: testLogic,
      registered: false,
    }),
    fallbackBlocked: onlyRegisteredActivationForTrigger(testEntity, {
      fallbackMessage: "FALLBACK REGISTERED",
      gameLogic: null,
      registered: false,
    }),
    factAllowed: onlyRegisteredActivationForTrigger(testEntity, {
      fallbackMessage: "FALLBACK REGISTERED",
      gameLogic: testLogic,
      registered: true,
    }),
  };
}

function buildRuntimeOnlyRegisteredTargetAudit(createController, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) {
    return {
      factActivatedEntityIndexes: [],
      fallbackActivatedEntityIndexes: [],
      poisonedFallbackActivatedEntityIndexes: [],
    };
  }
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.target = "poisoned-target";
  return {
    factActivatedEntityIndexes: useTargetsActivatedEntityIndexes(createController, scene, logic, testEntity, {
      poisonRuntimeTargetGraph: true,
    }),
    fallbackActivatedEntityIndexes: useTargetsActivatedEntityIndexes(createController, scene, null, entity),
    poisonedFallbackActivatedEntityIndexes: useTargetsActivatedEntityIndexes(createController, scene, null, testEntity, {
      poisonRuntimeTargetGraph: true,
    }),
  };
}

function buildRuntimeOnlyRegisteredKilltargetAudit(createController, scene, logic, entityIndex, disabledProbeIndexes) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) {
    return {
      factDisabledEntityIndexes: [],
      fallbackDisabledEntityIndexes: [],
      poisonedFallbackDisabledEntityIndexes: [],
    };
  }
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.killtarget = "poisoned-killtarget";
  return {
    factDisabledEntityIndexes: useTargetsAudit(createController, scene, logic, testEntity, {
      disabledProbeIndexes,
      poisonRuntimeTargetGraph: true,
    }).disabledEntityIndexes,
    fallbackDisabledEntityIndexes: useTargetsAudit(createController, scene, null, entity, {
      disabledProbeIndexes,
    }).disabledEntityIndexes,
    poisonedFallbackDisabledEntityIndexes: useTargetsAudit(createController, scene, null, testEntity, {
      disabledProbeIndexes,
      poisonRuntimeTargetGraph: true,
    }).disabledEntityIndexes,
  };
}

function useTargetsActivatedEntityIndexes(createController, scene, logic, entity, options = {}) {
  return useTargetsAudit(createController, scene, logic, entity, options).activatedEntityIndexes;
}

function useTargetsAudit(createController, scene, logic, entity, options = {}) {
  const activatedEntityIndexes = [];
  const useTargetsMessages = [];
  const originalWindow = globalThis.window;
  if (!globalThis.window) {
    globalThis.window = {
      clearTimeout: () => undefined,
      setTimeout: () => 0,
    };
  }
  try {
    const controller = createController({
      activateEntity: (targetEntityIndex) => {
        activatedEntityIndexes.push(targetEntityIndex);
        return true;
      },
      onUseTargetsMessage: (_entity, text) => {
        useTargetsMessages.push(text);
      },
    });
    const runtime = JSON.parse(JSON.stringify(scene.entityManifest.runtime));
    if (options.poisonRuntimeTargetGraph) runtime.targetEntities = {};
    controller.setup(runtime, logic);
    controller.useTargets(entity);
    return {
      activatedEntityIndexes,
      disabledEntityIndexes: (options.disabledProbeIndexes ?? []).filter((entityIndex) => controller.isDisabled(entityIndex)),
      useTargetsMessages,
    };
  } finally {
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }
}

function buildRuntimeSecretAudit(createTriggerController, oneShotForTrigger, secretActivationForTrigger, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) {
    return {
      factActivation: {},
      fallbackActivation: {},
      touchDisableCalls: -1,
      touchUseTargets: -1,
    };
  }
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.message = "ENTITY SECRET";
  const testLogic = JSON.parse(JSON.stringify(logic));
  const factEntity = testLogic.entities.find((item) => item.entityIndex === entityIndex);
  if (factEntity?.resolvedTrigger?.kind === "trigger_secret") {
    factEntity.resolvedTrigger.message = "FACT SECRET";
    factEntity.resolvedTrigger.activationSound = "fact/secret.wav";
    factEntity.resolvedTrigger.oneShot = false;
  }
  const factActivation = secretActivationForTrigger(testEntity, testLogic) ?? {};
  const fallbackActivation = secretActivationForTrigger(testEntity, null) ?? {};

  let touchDisableCalls = 0;
  let touchUseTargets = 0;
  const controller = createTriggerController({
    activateCounter: () => null,
    activateEntity: () => false,
    activateTeleport: () => false,
    completeLevel: () => undefined,
    disableEntity: () => {
      touchDisableCalls++;
    },
    getEntity: (index) => index === entityIndex ? testEntity : undefined,
    getOrigin: () => [0, 0, 0],
    getTouchedTriggers: () => [{
      entityIndex,
      modelIndex: testEntity.modelIndex ?? -1,
      classname: testEntity.classname,
      contact: "trigger",
    }],
    isEntityDisabled: () => false,
    isOneShotTrigger: (inputEntity, fallback) => oneShotForTrigger(inputEntity, testLogic, fallback),
    onActiveKeyChange: () => undefined,
    triggerSpecial: () => false,
    transitionSerial: () => 0,
    useTargets: () => {
      touchUseTargets++;
      return true;
    },
  });
  controller.sync([0, 0, 0]);

  return {
    factActivation,
    fallbackActivation,
    touchDisableCalls,
    touchUseTargets,
  };
}

function buildRuntimeTeleportAudit(teleportDestinationForTrigger, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) {
    return {
      factDestinationEntityIndex: null,
      fallbackDestinationEntityIndex: null,
      poisonedFallbackDestinationEntityIndex: null,
    };
  }
  const entityByIndex = new Map(scene.entities.map((item) => [item.index, item]));
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.target = "poisoned-target";
  const factDestination = teleportDestinationForTrigger(testEntity, {
    gameLogic: logic,
    getEntity: (index) => entityByIndex.get(index),
    targetEntityIndexesFor: () => [],
  });
  const fallbackDestination = teleportDestinationForTrigger(entity, {
    gameLogic: null,
    getEntity: (index) => entityByIndex.get(index),
    targetEntityIndexesFor: (targetname) => scene.entityManifest.runtime.targetEntities[targetname] ?? [],
  });
  const poisonedFallbackDestination = teleportDestinationForTrigger(testEntity, {
    gameLogic: null,
    getEntity: (index) => entityByIndex.get(index),
    targetEntityIndexesFor: () => [],
  });
  return {
    factDestinationEntityIndex: factDestination?.index ?? null,
    fallbackDestinationEntityIndex: fallbackDestination?.index ?? null,
    poisonedFallbackDestinationEntityIndex: poisonedFallbackDestination?.index ?? null,
  };
}

function buildRuntimeChangelevelAudit(changelevelMapForTrigger, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) {
    return {
      factMap: null,
      fallbackMap: null,
      poisonedFallbackMap: null,
    };
  }
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.map = "poisoned";
  return {
    factMap: changelevelMapForTrigger(testEntity, logic),
    fallbackMap: changelevelMapForTrigger(entity, null),
    poisonedFallbackMap: changelevelMapForTrigger(testEntity, null),
  };
}

function buildRuntimeTriggerHurtAudit(hurtDamageForTrigger) {
  const entity = {
    classname: "trigger_hurt",
    index: 9001,
    properties: {},
  };
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.dmg = "99";
  const logic = syntheticTriggerLogic(9001, {
    kind: "trigger_hurt",
    dmg: 17,
  });
  return {
    factDamage: hurtDamageForTrigger(testEntity, logic),
    fallbackDamage: hurtDamageForTrigger(entity, null),
    poisonedFallbackDamage: hurtDamageForTrigger(testEntity, null),
  };
}

function buildRuntimeTriggerPushAudit(pushActivationForTrigger) {
  const entity = {
    angle: 180,
    classname: "trigger_push",
    index: 9002,
    properties: {
      speed: "0",
    },
  };
  const testEntity = JSON.parse(JSON.stringify(entity));
  testEntity.properties.angle = "-1";
  testEntity.properties.speed = "99";
  const logic = syntheticTriggerLogic(9002, {
    kind: "trigger_push",
    moveDirection: { x: 0, y: 1, z: 0 },
    oneShot: true,
    pushVelocityMultiplier: 10,
    speed: 350,
  });
  const factActivation = pushActivationForTrigger(testEntity, logic);
  const fallbackActivation = pushActivationForTrigger(entity, null);
  const poisonedFallbackActivation = pushActivationForTrigger(testEntity, null);
  return {
    factOneShot: factActivation?.oneShot,
    factSpeed: factActivation?.speed,
    factVelocity: factActivation?.velocity,
    fallbackOneShot: fallbackActivation?.oneShot,
    fallbackSpeed: fallbackActivation?.speed,
    fallbackVelocity: fallbackActivation?.velocity,
    poisonedFallbackVelocity: poisonedFallbackActivation?.velocity,
  };
}

function buildRuntimeMoverBlockDamageAudit(blockDamageForMover, state) {
  if (!state) {
    return {
      factDamage: null,
      fallbackDamage: null,
      poisonedFactDamage: null,
      poisonedFallbackDamage: null,
    };
  }
  const poisonedState = {
    ...state,
    entity: {
      ...state.entity,
      properties: {
        ...state.entity.properties,
        dmg: "99",
      },
    },
  };
  return {
    factDamage: blockDamageForMover(state),
    fallbackDamage: blockDamageForMover(stripPrebakedMoverFacts(state)),
    poisonedFactDamage: blockDamageForMover(poisonedState),
    poisonedFallbackDamage: blockDamageForMover(stripPrebakedMoverFacts(poisonedState)),
  };
}

function buildRuntimePickupAudit(effectForPickup, modelPathForPickup, scene, logic, entityIndex) {
  const entity = scene.entities?.find((item) => item.index === entityIndex);
  if (!entity) {
    return {
      factEffect: null,
      factModelPath: null,
      fallbackEffect: null,
      fallbackModelPath: null,
      poisonedFactEffect: null,
      poisonedFallbackEffect: null,
      poisonedFallbackModelPath: null,
    };
  }
  const poisonedEntity = JSON.parse(JSON.stringify(entity));
  poisonedEntity.properties.spawnflags = "0";
  const fallbackLogic = stripResolvedPickupFacts(logic, entityIndex);
  return {
    factEffect: effectForPickup(entity, logic),
    factModelPath: modelPathForPickup(entity, null, logic),
    fallbackEffect: effectForPickup(entity, fallbackLogic),
    fallbackModelPath: modelPathForPickup(entity, null, fallbackLogic),
    poisonedFactEffect: effectForPickup(poisonedEntity, logic),
    poisonedFactModelPath: modelPathForPickup(poisonedEntity, null, logic),
    poisonedFallbackEffect: effectForPickup(poisonedEntity, fallbackLogic),
    poisonedFallbackModelPath: modelPathForPickup(poisonedEntity, null, fallbackLogic),
  };
}

function buildSyntheticAmmoPickupAudit(effectForPickup, modelPathForPickup, scene, logic, classname, index, big) {
  const entityIndex = syntheticAmmoPickupEntityIndex(index, big);
  const factEntity = logic.entities.find((entity) => entity.entityIndex === entityIndex && entity.classname === classname);
  const ammo = factEntity?.resolvedPickup?.behavior?.ammo;
  return {
    classname,
    big,
    factEntity,
    grantEffect: ammoInventoryEffect(ammo),
    poisonedFallbackEffect: ammoInventoryEffect(ammo ? { ...ammo, amount: ammo.smallAmount } : undefined),
    audit: buildRuntimePickupAudit(effectForPickup, modelPathForPickup, scene, logic, entityIndex),
  };
}

function buildSyntheticAmmoPickupScene(inputScene) {
  const worldspawn = inputScene.entities?.find((entity) => entity.classname === "worldspawn");
  return {
    ...inputScene,
    label: `${inputScene.label ?? "synthetic"}-ammo-pickups`,
    entities: [
      ...(worldspawn ? [worldspawn] : []),
      ...AMMO_PICKUP_CLASSNAMES.flatMap((classname, index) =>
        [false, true].map((big) => ({
          index: syntheticAmmoPickupEntityIndex(index, big),
          classname,
          origin: { x: index * 16, y: big ? 16 : 0, z: 0 },
          properties: {
            spawnflags: big ? "1" : "0",
          },
        }))
      ),
    ],
  };
}

function syntheticAmmoPickupEntityIndex(index, big) {
  return 9400 + index * 2 + (big ? 1 : 0);
}

function buildSyntheticWeaponPickupAudit(effectForPickup, modelPathForPickup, scene, logic, classname, index) {
  const entityIndex = syntheticWeaponPickupEntityIndex(index);
  const factEntity = logic.entities.find((entity) => entity.entityIndex === entityIndex && entity.classname === classname);
  return {
    classname,
    factEntity,
    grantEffect: ammoInventoryEffect(factEntity?.resolvedPickup?.behavior?.weapon?.ammoGrant),
    audit: buildRuntimePickupAudit(effectForPickup, modelPathForPickup, scene, logic, entityIndex),
  };
}

function buildSyntheticWeaponPickupScene(inputScene) {
  const worldspawn = inputScene.entities?.find((entity) => entity.classname === "worldspawn");
  return {
    ...inputScene,
    label: `${inputScene.label ?? "synthetic"}-weapon-pickups`,
    entities: [
      ...(worldspawn ? [worldspawn] : []),
      ...WEAPON_PICKUP_CLASSNAMES.map((classname, index) => ({
        index: syntheticWeaponPickupEntityIndex(index),
        classname,
        origin: { x: index * 16, y: 0, z: 0 },
        properties: {},
      })),
    ],
  };
}

function syntheticWeaponPickupEntityIndex(index) {
  return 9300 + index;
}

function ammoInventoryEffect(ammoGrant) {
  if (!ammoGrant) return null;
  return { [ammoGrant.inventoryField]: ammoGrant.amount };
}

function stripResolvedPickupFacts(logic, entityIndex) {
  if (!logic) return null;
  return {
    ...logic,
    entities: (logic.entities ?? []).map((entity) => {
      if (entity.entityIndex !== entityIndex) return entity;
      const { resolvedPickup: _resolvedPickup, ...rest } = entity;
      return rest;
    }),
  };
}

function stripPrebakedMoverFacts(state) {
  const {
    prebakedButton: _prebakedButton,
    prebakedDoor: _prebakedDoor,
    prebakedPlat: _prebakedPlat,
    prebakedTrain: _prebakedTrain,
    ...rest
  } = state;
  return rest;
}

function syntheticTriggerLogic(entityIndex, triggerOverrides) {
  const kind = triggerOverrides.kind;
  return {
    entities: [{
      classname: kind,
      entityIndex,
      resolvedTrigger: {
        callbacks: {},
        damageable: false,
        kind,
        oneShot: false,
        source: { spawnFunction: kind },
        spawnflagChecks: [],
        targetUse: {
          activeTargetEntityIndexesByMode: emptyModeEntityIndexSets(),
          delay: 0,
          targetEntityIndexes: [],
        },
        touchActivates: true,
        useActivates: false,
        ...triggerOverrides,
      },
    }],
  };
}

function emptyModeEntityIndexSets() {
  return {
    singleplayerEasy: [],
    singleplayerNormal: [],
    singleplayerHard: [],
  };
}

function quakeEntitiesForIndexes(indexes, entities) {
  const entityByIndex = new Map(entities.map((entity) => [entity.index, entity]));
  const out = [];
  const seen = new Set();
  for (const index of indexes) {
    if (seen.has(index)) continue;
    seen.add(index);
    const entity = entityByIndex.get(index);
    if (entity) out.push(entity);
  }
  return out;
}

function runtimeStyleFuncPlatFacts(entity, model) {
  const origin = entity.origin ?? model.origin ?? { x: 0, y: 0, z: 0 };
  const height = quakeEntityNumber(entity, "height", Math.max(0, model.maxs.z - model.mins.z - QUAKE_PLAT_TRIGGER_TOP_EXTRA));
  const startsTop = Boolean(entity.targetname);
  const topOrigin = { ...origin };
  const bottomOrigin = { x: origin.x, y: origin.y, z: origin.z - height };
  return {
    speed: quakeEntityNumber(entity, "speed", 150),
    waitAtTop: 3,
    startsTop,
    initialState: startsTop ? "top" : "bottom",
    topOrigin,
    bottomOrigin,
    initialOrigin: startsTop ? topOrigin : bottomOrigin,
    travelDistance: height,
    travelOffset: { x: 0, y: 0, z: -height },
    trigger: runtimeStylePlatTrigger(entity, model, height),
  };
}

function runtimeStyleFuncButtonFacts(entity, model) {
  const origin = entity.origin ?? model.origin ?? { x: 0, y: 0, z: 0 };
  const speed = quakeEntityDefaultedNumber(entity, "speed", QUAKE_BUTTON_DEFAULT_SPEED);
  const wait = quakeEntityDefaultedNumber(entity, "wait", QUAKE_BUTTON_DEFAULT_WAIT);
  const lip = quakeEntityDefaultedNumber(entity, "lip", QUAKE_BUTTON_DEFAULT_LIP);
  const rawSounds = quakeEntityNumber(entity, "sounds", 0);
  const sounds = rawSounds === 0 ? QUAKE_BUTTON_DEFAULT_SOUNDS : rawSounds;
  const direction = quakeEntityMoveDirection(entity);
  const size = {
    x: Math.max(0, model.maxs.x - model.mins.x),
    y: Math.max(0, model.maxs.y - model.mins.y),
    z: Math.max(0, model.maxs.z - model.mins.z),
  };
  const travelDistance = Math.max(
    0,
    Math.abs(direction.x) * size.x +
      Math.abs(direction.y) * size.y +
      Math.abs(direction.z) * size.z -
      lip,
  );
  const travelOffset = {
    x: direction.x * travelDistance,
    y: direction.y * travelDistance,
    z: direction.z * travelDistance,
  };
  return {
    speed,
    wait,
    lip,
    sounds,
    ...quakeButtonActivationSound(sounds),
    initialState: "bottom",
    pos1Origin: { ...origin },
    pos2Origin: {
      x: origin.x + travelOffset.x,
      y: origin.y + travelOffset.y,
      z: origin.z + travelOffset.z,
    },
    initialOrigin: { ...origin },
    travelDistance,
    travelOffset,
  };
}

function runtimeStylePlatTrigger(entity, model, travel) {
  let minX = model.mins.x + QUAKE_PLAT_TRIGGER_INSET;
  let maxX = model.maxs.x - QUAKE_PLAT_TRIGGER_INSET;
  let minY = model.mins.y + QUAKE_PLAT_TRIGGER_INSET;
  let maxY = model.maxs.y - QUAKE_PLAT_TRIGGER_INSET;
  const sizeX = model.maxs.x - model.mins.x;
  const sizeY = model.maxs.y - model.mins.y;
  if (sizeX <= QUAKE_PLAT_TRIGGER_MIN_SIDE) {
    minX = (model.mins.x + model.maxs.x) / 2;
    maxX = minX + 1;
  }
  if (sizeY <= QUAKE_PLAT_TRIGGER_MIN_SIDE) {
    minY = (model.mins.y + model.maxs.y) / 2;
    maxY = minY + 1;
  }
  const triggerTopZ = model.maxs.z + QUAKE_PLAT_TRIGGER_TOP_EXTRA;
  const triggerBottomZ = triggerTopZ - (travel + QUAKE_PLAT_TRIGGER_TOP_EXTRA);
  const lowTrigger = Boolean((entity.spawnflags ?? 0) & QUAKE_PLAT_LOW_TRIGGER);
  return {
    lowTrigger,
    mins: { x: minX, y: minY, z: triggerBottomZ },
    maxs: {
      x: maxX,
      y: maxY,
      z: lowTrigger ? triggerBottomZ + QUAKE_PLAT_TRIGGER_LOW_HEIGHT : triggerTopZ,
    },
  };
}

function quakeEntityNumber(entity, key, fallback) {
  const value = Number(entity.properties?.[key] ?? Number.NaN);
  return Number.isFinite(value) ? value : fallback;
}

function quakeEntityDefaultedNumber(entity, key, fallback) {
  const value = quakeEntityNumber(entity, key, Number.NaN);
  return Number.isFinite(value) && value !== 0 ? value : fallback;
}

function quakeEntityMoveDirection(entity) {
  const angle = quakeEntityNumber(entity, "angle", entity.angle ?? 0);
  if (angle === -1) return { x: 0, y: 0, z: 1 };
  if (angle === -2) return { x: 0, y: 0, z: -1 };
  const radians = (angle * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians), z: 0 };
}

function quakeButtonActivationSound(sounds) {
  if (sounds === 1) return { activationSound: "buttons/airbut1.wav" };
  if (sounds === 2) return { activationSound: "buttons/switch21.wav" };
  if (sounds === 3) return { activationSound: "buttons/switch02.wav" };
  if (sounds === 4) return { activationSound: "buttons/switch04.wav" };
  return {};
}

function sameVector(actual, expected) {
  return actual?.x === expected?.x && actual?.y === expected?.y && actual?.z === expected?.z;
}

function closeVector(actual, expected) {
  return actual &&
    expected &&
    Math.abs(actual.x - expected.x) <= 0.000001 &&
    Math.abs(actual.y - expected.y) <= 0.000001 &&
    Math.abs(actual.z - expected.z) <= 0.000001;
}

function scaledVector(vector) {
  if (!vector) return [];
  return [
    vector.x * QUAKE_COLLISION_UNIT_SCALE,
    vector.y * QUAKE_COLLISION_UNIT_SCALE,
    vector.z * QUAKE_COLLISION_UNIT_SCALE,
  ];
}

function scaledTrainPathOffset(resolvedTrain, corner) {
  if (!resolvedTrain?.quakeCInitialOrigin || !resolvedTrain.pathBaseOrigin || !corner?.origin) return [];
  return [
    (resolvedTrain.quakeCInitialOrigin.x + corner.origin.x - resolvedTrain.pathBaseOrigin.x) * QUAKE_COLLISION_UNIT_SCALE,
    (resolvedTrain.quakeCInitialOrigin.y + corner.origin.y - resolvedTrain.pathBaseOrigin.y) * QUAKE_COLLISION_UNIT_SCALE,
    (resolvedTrain.quakeCInitialOrigin.z + corner.origin.z - resolvedTrain.pathBaseOrigin.z) * QUAKE_COLLISION_UNIT_SCALE,
  ];
}

function sameModeTargetSets(actual, expected) {
  return Boolean(actual && expected) &&
    sameArray(actual.singleplayerEasy, expected.singleplayerEasy) &&
    sameArray(actual.singleplayerNormal, expected.singleplayerNormal) &&
    sameArray(actual.singleplayerHard, expected.singleplayerHard);
}

function hasDependencyAsset(entity, kind, assetPath) {
  return entity?.dependencyAssets?.some((asset) => asset.kind === kind && asset.path === assetPath);
}

function programCallbackBranch(programFact, callbackName, classname) {
  return programFact?.callbackFacts?.[callbackName]?.classnameBranches?.find((branch) => branch.classname === classname);
}

function programBranchValue(programFact, callbackName, classname, field) {
  return programCallbackBranch(programFact, callbackName, classname)
    ?.assignments?.find((assignment) => assignment.field === field)
    ?.value;
}

function programBranchExpression(programFact, callbackName, classname, field) {
  return programCallbackBranch(programFact, callbackName, classname)
    ?.assignments?.find((assignment) => assignment.field === field)
    ?.expression;
}

function sameArray(actual, expected) {
  return Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => Math.abs(value - expected[index]) <= 0.000001);
}
