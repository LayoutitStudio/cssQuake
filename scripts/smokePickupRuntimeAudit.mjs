import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const scenePath = process.argv[2] ?? path.join(projectRoot, "build/generated/public/q/e1m1.json");
const runtimePickupsPath = path.join(projectRoot, "src/runtime/pickups.ts");
const runtimeConstantsPath = path.join(projectRoot, "src/runtime/constants.ts");
const runtimeHazardsPath = path.join(projectRoot, "src/runtime/hazards.ts");
const runtimeHudPath = path.join(projectRoot, "src/runtime/hud.ts");
const runtimeWeaponsPath = path.join(projectRoot, "src/runtime/weapons.ts");
const generatedProgramFactsPath = path.join(projectRoot, "src/generated/quakeProgramFacts.ts");
const gameLogicFactsPath = path.join(projectRoot, "src/prepare/gameLogicFacts.ts");

const scene = await readScene(scenePath);
const {
  createQuakePickupController,
  quakeCanPickupForInventory,
  quakePickupAmmoBehaviorForEntity,
  quakePickupArmorBehaviorForEntity,
  quakePickupFiresTargetsForEntity,
  quakePickupHealthAcceptanceForEntity,
  quakePickupKeyBehaviorForEntity,
  quakePickupLifecycleActionForEntity,
  quakePickupLifecycleConditionMatches,
  quakePickupMegahealthRotDelayForEntity,
  quakePickupModelForEntity,
  quakePickupModelPath,
  quakePickupPowerupBehaviorForEntity,
} = await importBundledModule(runtimePickupsPath);
const { QUAKE_PROGRAM_FACTS } = await importBundledModule(generatedProgramFactsPath);
const { buildQuakeGameLogicFacts } = await importBundledModule(gameLogicFactsPath);
const {
  PLAYER_HEIGHT,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  STEP_HEIGHT,
} = await importBundledModule(runtimeConstantsPath);
const {
  quakeContentsDamage,
  quakePlayerWaterLevel,
  quakeRadsuitProtectedContentsDamage,
} = await importBundledModule(runtimeHazardsPath);
const {
  activateQuakeInventoryPowerup,
  applyQuakeInventoryDelta,
  applyQuakeDamageToInventory,
  clearQuakeInventoryPowerup,
  createInitialInventory,
} = await importBundledModule(runtimeHudPath);
const {
  createQuakeWeaponsController,
  quakeWeaponFireProfileAuditFacts,
} = await importBundledModule(runtimeWeaponsPath);

const mapName = path.basename(scenePath, ".json");
const gameLogic = scene.gameLogic;
const rebuiltGameLogic = buildQuakeGameLogicFacts({
  label: scene.label,
  entities: scene.entities ?? [],
  entityManifest: scene.entityManifest,
  models: scene.collision?.models ?? [],
  collision: scene.collision,
  programFacts: QUAKE_PROGRAM_FACTS,
});
const entityByIndex = new Map((scene.entities ?? []).map((entity) => [entity.index, entity]));
const logicEntityByIndex = new Map((gameLogic?.entities ?? []).map((entity) => [entity.entityIndex, entity]));
const pivot = scene.visibility?.pivot ?? { x: 0, y: 0, z: 0 };

const pickupAuditConfig = pickupAuditConfigForMap(mapName);
const pickupCases = pickupAuditConfig.pickupCases;

const checks = [];
let collisionChecks = 0;

for (const testCase of pickupCases) {
  const result = runPickupCollisionAudit(testCase.entityIndex);
  collisionChecks += 1;
  checks.push([
    result.effects.length === 1 &&
      pickupEffectMatchesExpected(testCase, result.effects[0]),
    `${testCase.label} should apply exactly one prebaked pickup effect, got ${JSON.stringify(result.effects)}`,
  ]);
  checks.push([
    result.modelPath === testCase.expectedModelPath,
    `${testCase.label} should resolve model ${testCase.expectedModelPath}, got ${result.modelPath}`,
  ]);
  checks.push([
    result.addMeshEntityIndexes.length === 1 && result.addMeshEntityIndexes[0] === testCase.entityIndex,
    `${testCase.label} should spawn one pickup mesh attempt, got ${JSON.stringify(result.addMeshEntityIndexes)}`,
  ]);
  checks.push([
    result.targetUseEntityIndexes.length === 1 && result.targetUseEntityIndexes[0] === testCase.entityIndex,
    `${testCase.label} should fire pickup targets once from lifecycle facts, got ${JSON.stringify(result.targetUseEntityIndexes)}`,
  ]);
  checks.push([
    testCase.expectedPowerup
      ? (
        result.powerupActivations.length === 1 &&
        powerupActivationMatches(result.powerupActivations[0], testCase.entityIndex, testCase.expectedPowerup)
      )
      : result.powerupActivations.length === 0,
    `${testCase.label} should start only fact-backed powerups, got ${JSON.stringify(result.powerupActivations)}`,
  ]);
}

if (pickupAuditConfig.disabledPickup) {
  const disabledPickup = runPickupCollisionAudit(pickupAuditConfig.disabledPickup.entityIndex);
  checks.push([
    disabledPickup.effects.length === 0 &&
      disabledPickup.addMeshEntityIndexes.length === 0 &&
      disabledPickup.modelPath === pickupAuditConfig.disabledPickup.expectedModelPath,
    `${pickupAuditConfig.disabledPickup.label} should keep fact model but not spawn/apply effects, got ${JSON.stringify(disabledPickup)}`,
  ]);
}

const strictPickupModel = runPickupModelStrictnessAudit(pickupAuditConfig.strictModelEntityIndex);
const pickupTargetUse = runPickupTargetUseAudit(pickupAuditConfig.targetUseEntityIndex);
const megahealthRot = runPickupMegahealthRotAudit(pickupAuditConfig.megahealthEntityIndex);
const ammoAcceptance = runPickupAmmoAcceptanceAudit();
const armorAcceptance = runPickupArmorAcceptanceAudit();
const healthAcceptance = runPickupHealthAcceptanceAudit();
const keyAcceptance = runPickupKeyAcceptanceAudit();
const lifecycleRespawn = runPickupLifecycleRespawnAudit();
const powerupCase = pickupCases.find((testCase) => testCase.expectedPowerup);
const powerupBehavior = powerupCase ? runPickupPowerupAudit(powerupCase.entityIndex) : null;
const powerupRuntime = powerupCase ? runPowerupRuntimeAudit(powerupBehavior?.rebuiltPowerup ?? powerupCase.expectedPowerup) : null;
const weaponFactAdapter = quakeWeaponFireProfileAuditFacts();
const radsuitHazard = runRadsuitHazardAudit();
const runtimeBackpackPickup = runRuntimeBackpackPickupAudit();
checks.push([
  weaponFactAdapter.sourceRevision === QUAKE_PROGRAM_FACTS.source.revision &&
    weaponFactAdapter.profiles.shotgun?.ammoCost === QUAKE_PROGRAM_FACTS.playerWeapons.profiles.shotgun.ammo?.cost &&
    weaponFactAdapter.profiles.shotgun.pelletCount === QUAKE_PROGRAM_FACTS.playerWeapons.profiles.shotgun.hitscan?.pelletCount &&
    weaponFactAdapter.profiles.shotgun.pelletDamage === QUAKE_PROGRAM_FACTS.playerWeapons.profiles.shotgun.hitscan?.pelletDamage &&
    weaponFactAdapter.profiles.shotgun.spreadRight === QUAKE_PROGRAM_FACTS.playerWeapons.profiles.shotgun.hitscan?.spread?.[0] &&
    weaponFactAdapter.profiles.axe?.range === QUAKE_PROGRAM_FACTS.playerWeapons.profiles.axe.melee?.rangeUnits * QUAKE_COLLISION_UNIT_SCALE &&
    weaponFactAdapter.profiles.nailgun?.sourceZOffsetUnits ===
      QUAKE_PROGRAM_FACTS.playerWeapons.profiles.nailgun.projectile?.sourceOffsetUnits?.up &&
    weaponFactAdapter.profiles.grenadelauncher?.speed ===
      QUAKE_PROGRAM_FACTS.playerWeapons.profiles.grenadelauncher.projectile?.speedUnits * QUAKE_COLLISION_UNIT_SCALE &&
    weaponFactAdapter.profiles.grenadelauncher.sourceZOffsetUnits === 0 &&
    weaponFactAdapter.profiles.grenadelauncher.splashRadius ===
      QUAKE_PROGRAM_FACTS.playerWeapons.profiles.grenadelauncher.projectile?.radiusDamage?.radiusUnits *
        QUAKE_COLLISION_UNIT_SCALE &&
	    weaponFactAdapter.profiles.rocketlauncher?.sourceCooldownMs === 800 &&
	    weaponFactAdapter.profiles.rocketlauncher.cooldownMs ===
	      weaponFactAdapter.profiles.rocketlauncher.sourceCooldownMs &&
    weaponFactAdapter.profiles.rocketlauncher.sourceZOffsetUnits ===
      QUAKE_PROGRAM_FACTS.playerWeapons.profiles.rocketlauncher.projectile?.sourceOffsetUnits?.up &&
    weaponFactAdapter.profiles.rocketlauncher.speed ===
      QUAKE_PROGRAM_FACTS.playerWeapons.profiles.rocketlauncher.projectile?.speedUnits * QUAKE_COLLISION_UNIT_SCALE &&
    weaponFactAdapter.profiles.lightning?.range ===
      QUAKE_PROGRAM_FACTS.playerWeapons.profiles.lightning.beam?.rangeUnits * QUAKE_COLLISION_UNIT_SCALE &&
    weaponFactAdapter.profiles.lightning.soundCooldownMs ===
      QUAKE_PROGRAM_FACTS.playerWeapons.profiles.lightning.fireSound?.cooldownMs &&
    weaponFactAdapter.profiles.lightning.underwaterDischarge?.damagePerAmmoCell ===
      QUAKE_PROGRAM_FACTS.playerWeapons.profiles.lightning.unsupportedBranches?.[0]?.radiusDamage
        ?.damagePerAmmoCell &&
    weaponFactAdapter.profiles.lightning.underwaterDischarge?.clearsAmmoField === "cells" &&
    weaponFactAdapter.fallbackProfiles.supershotgunOneShell?.weapon === "supershotgun" &&
    weaponFactAdapter.fallbackProfiles.supershotgunOneShell.soundWeapon === "shotgun" &&
    weaponFactAdapter.fallbackProfiles.supershotgunOneShell.ammoCost === 1 &&
    weaponFactAdapter.fallbackProfiles.supernailgunOneNail?.weapon === "supernailgun" &&
    weaponFactAdapter.fallbackProfiles.supernailgunOneNail.soundWeapon === "nailgun" &&
    weaponFactAdapter.fallbackProfiles.supernailgunOneNail.ammoCost === 1,
  `weapon runtime fire profiles should be built from generated QuakeC facts without behavior drift, got ${JSON.stringify(weaponFactAdapter)}`,
]);
checks.push([
  pickupTargetUse.factBackedFiresTargets === true &&
    pickupTargetUse.factBackedTargetUseEntityIndexes.length === 1 &&
    pickupTargetUse.factlessFiresTargets === false &&
    pickupTargetUse.factlessTargetUseEntityIndexes.length === 0,
  `pickup target use should be lifecycle-fact backed, got ${JSON.stringify(pickupTargetUse)}`,
]);
checks.push([
  megahealthRot.factBackedRotDelay === 5 &&
    JSON.stringify(megahealthRot.factBackedRotDelays) === JSON.stringify([5]) &&
    megahealthRot.factlessRotDelay === undefined &&
    megahealthRot.factlessRotDelays.length === 0,
  `megahealth rot should be lifecycle-fact backed, got ${JSON.stringify(megahealthRot)}`,
]);
checks.push([
  ammoAcceptance.ammoBehavior?.inventoryField === ammoAcceptance.inventoryField &&
    ammoAcceptance.ammoBehavior.rejectAtOrAboveAmount === ammoAcceptance.rejectAtOrAboveAmount &&
    ammoAcceptance.allowsOneBelowCap &&
    ammoAcceptance.rejectsAtCap &&
    ammoAcceptance.rejectedAtCapEffects.length === 0 &&
    ammoAcceptance.rejectedAtCapTargetUseEntityIndexes.length === 0 &&
    JSON.stringify(ammoAcceptance.clampedInventory) === JSON.stringify({
      shells: 100,
      nails: 200,
      rockets: 100,
      cells: 100,
    }),
  `ammo pickup acceptance and caps should be source-fact backed, got ${JSON.stringify(ammoAcceptance)}`,
]);
checks.push([
  JSON.stringify(armorAcceptance.rebuiltGreenArmorBehavior) === JSON.stringify({
    armorType: 0.3,
    armorValue: 100,
    replacementScore: 30,
    replacesWhenCurrentScoreBelow: 30,
    itemFlag: 8192,
    itemFlagExpression: "IT_ARMOR1",
    clearsItemFlagExpression: "IT_ARMOR1 | IT_ARMOR2 | IT_ARMOR3",
  }) &&
    armorAcceptance.greenArmorEffectHasType &&
    armorAcceptance.greenArmorAllows99Green &&
    armorAcceptance.greenArmorRejects100Green &&
    armorAcceptance.greenArmorRejects150Yellow &&
    armorAcceptance.greenArmorFactlessAllows100Green &&
    armorAcceptance.rejectedGreenArmorEffects.length === 0 &&
    armorAcceptance.rejectedGreenArmorTargetUseEntityIndexes.length === 0,
  `armor pickup acceptance should be source-fact backed, got ${JSON.stringify(armorAcceptance)}`,
]);
checks.push([
  JSON.stringify(healthAcceptance.rebuiltNormalAcceptance) === JSON.stringify({
    healAmount: healthAcceptance.normalHealAmount,
    healFunction: "T_Heal",
    healType: healthAcceptance.normalHealType,
    healthMax: 100,
    ignoreMaxHealth: false,
    rejectAtOrAboveHealth: 100,
  }) &&
    JSON.stringify(healthAcceptance.rebuiltMegaAcceptance) === JSON.stringify({
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
    }) &&
    healthAcceptance.normalRejectAt100 &&
    healthAcceptance.normalFactlessAllows100 &&
    healthAcceptance.megaAllows249 &&
    healthAcceptance.megaRejects250 &&
    healthAcceptance.megaFactlessAllows250 &&
    healthAcceptance.rejectedNormalEffects.length === 0 &&
    healthAcceptance.rejectedNormalTargetUseEntityIndexes.length === 0 &&
    healthAcceptance.rejectedMegaEffects.length === 0 &&
    healthAcceptance.rejectedMegaRotDelays.length === 0 &&
    healthAcceptance.rejectedMegaTargetUseEntityIndexes.length === 0,
  `health pickup acceptance should be source-fact backed, got ${JSON.stringify(healthAcceptance)}`,
]);
checks.push([
  !keyAcceptance ||
    (
      keyBehaviorMatches(keyAcceptance.keyBehavior, keyAcceptance.expected) &&
      keyAcceptance.allowsMissingKey &&
      keyAcceptance.rejectsOwnedKey &&
      keyAcceptance.rejectedOwnedKeyEffects.length === 0 &&
      keyAcceptance.rejectedOwnedKeyTargetUseEntityIndexes.length === 0 &&
      keyAcceptance.appliedInventoryHasKey
    ),
  `key pickup ownership rejection should be source-fact backed, got ${JSON.stringify(keyAcceptance)}`,
]);
checks.push([
  lifecycleRespawn.singleplayerAction?.action === "remove" &&
    lifecycleRespawn.deathmatchAction?.action === "respawn" &&
    lifecycleRespawn.deathmatchAction?.delaySeconds === 20 &&
    lifecycleRespawn.deathmatchAction?.think === "SUB_regen" &&
    lifecycleRespawn.singleplayerRespawnSchedules.length === 0 &&
    lifecycleRespawn.deathmatchRespawnSchedules.length === 1 &&
    lifecycleRespawn.deathmatchRespawnSchedules[0].delaySeconds === 20 &&
    lifecycleRespawn.deathmatchTwoLeaveAction?.action === "leave" &&
    lifecycleRespawn.deathmatchTwoLeaveCollision.effects.length === 0 &&
    lifecycleRespawn.deathmatchTwoLeaveCollision.removedBeforeClear.length === 0 &&
    lifecycleRespawn.deathmatchTwoLeaveCollision.respawnSchedules.length === 0 &&
    lifecycleRespawn.conditions.deathmatchOne &&
    lifecycleRespawn.conditions.singleplayerRemove &&
    !lifecycleRespawn.conditions.deathmatchTwoRespawn &&
    lifecycleRespawn.conditions.deathmatchTwoLeave,
  `pickup respawn/no-respawn lifecycle should be source-fact backed, got ${JSON.stringify(lifecycleRespawn)}`,
]);
checks.push([
  !powerupCase ||
    (
      powerupBehaviorMatches(powerupBehavior.factBackedPowerup, powerupCase.expectedPowerup) &&
      powerupBehavior.factBackedActivations.length === 1 &&
      powerupActivationMatches(powerupBehavior.factBackedActivations[0], powerupCase.entityIndex, powerupCase.expectedPowerup) &&
      powerupBehaviorMatches(powerupBehavior.rebuiltPowerup, powerupCase.expectedPowerup, { requireMutation: true }) &&
      powerupBehavior.rebuiltActivations.length === 1 &&
      powerupActivationMatches(
        powerupBehavior.rebuiltActivations[0],
        powerupCase.entityIndex,
        powerupCase.expectedPowerup,
        { requireMutation: true },
      ) &&
      powerupBehavior.factlessPowerup === undefined &&
      powerupBehavior.factlessActivations.length === 0
    ),
  `powerup pickup behavior should be source-fact backed, got ${JSON.stringify(powerupBehavior)}`,
]);
checks.push([
  !powerupCase ||
    (
      powerupRuntime.activeItemFlags === powerupRuntime.baselineItemFlags + powerupCase.expectedPowerup.itemFlag &&
      powerupRuntime.activeFinishedField === powerupCase.expectedPowerup.finishedField &&
      powerupRuntime.activeFinishedAt === 30123 &&
      powerupRuntime.activeItemFlagMutationExpression === "other.items | self.items" &&
      powerupRuntime.clearedItemFlags === powerupRuntime.baselineItemFlags &&
      powerupRuntime.quadDamageAmount === 96 &&
      JSON.stringify(powerupRuntime.axeDamage) === JSON.stringify({
        activeWeaponAfter: "axe",
        damageAmount: 20,
        fired: true,
        fireSoundWeapon: "axe",
        hudSyncCount: 0,
        shellsAfter: 0,
      }) &&
      JSON.stringify(powerupRuntime.superShotgunDamage) === JSON.stringify({
        activeWeaponAfter: "supershotgun",
        damageAmount: 56,
        fired: true,
        fireSoundWeapon: "supershotgun",
        hudSyncCount: 1,
        shellsAfter: 0,
      }) &&
      JSON.stringify(powerupRuntime.superShotgunOneShellFallback) === JSON.stringify({
        activeWeaponAfter: "supershotgun",
        damageAmount: 24,
        fired: true,
        fireSoundWeapon: "shotgun",
        hudSyncCount: 1,
        shellsAfter: 0,
      }) &&
      JSON.stringify(powerupRuntime.noAmmoFallback) === JSON.stringify({
        activeWeaponAfter: "shotgun",
        damageAmount: null,
        fired: false,
        fireSoundWeapon: null,
        hudSyncCount: 1,
        shellsAfter: 1,
      }) &&
      JSON.stringify(powerupRuntime.nailgunProjectileDamage) === JSON.stringify({
        activeWeaponAfter: "nailgun",
        damageAmount: 9,
        fired: true,
        fireSoundWeapon: "nailgun",
        hudSyncCount: 1,
        hitCount: 1,
        nailsAfter: 0,
        shellsAfter: 0,
      }) &&
      JSON.stringify(powerupRuntime.superNailgunProjectileDamage) === JSON.stringify({
        activeWeaponAfter: "supernailgun",
        damageAmount: 18,
        fired: true,
        fireSoundWeapon: "supernailgun",
        hudSyncCount: 1,
        hitCount: 1,
        nailsAfter: 0,
        shellsAfter: 0,
      }) &&
      JSON.stringify(powerupRuntime.rocketProjectileDamage) === JSON.stringify({
        activeWeaponAfter: "rocketlauncher",
        damageAmount: 100,
        fired: true,
        fireSoundWeapon: "rocketlauncher",
        hudSyncCount: 1,
        hitCount: 1,
        damageAmounts: [100, 95],
        nailsAfter: 0,
        rocketsAfter: 0,
        shellsAfter: 0,
      }) &&
      JSON.stringify(powerupRuntime.rocketShamblerDamage) === JSON.stringify({
        activeWeaponAfter: "rocketlauncher",
        damageAmount: 50,
        fired: true,
        fireSoundWeapon: "rocketlauncher",
        hudSyncCount: 1,
        hitCount: 1,
        damageAmounts: [50],
        nailsAfter: 0,
        rocketsAfter: 0,
        shellsAfter: 0,
      }) &&
      Math.abs(powerupRuntime.rocketSelfDamage.playerDamageAmounts[0] - 57.5) < 1e-6 &&
      powerupRuntime.rocketSelfDamage.playerHealthAfter === 42 &&
      powerupRuntime.rocketSelfDamage.playerHudSyncCount === 1 &&
      powerupRuntime.rocketSelfDamage.rocketsAfter === 0 &&
      grenadeProjectileRuntimeMatches(powerupRuntime.grenadeProjectileDamage) &&
      powerupRuntime.grenadeSelfDamage.playerDamageAmounts.length === 1 &&
      powerupRuntime.grenadeSelfDamage.playerDamageAmounts[0] > 0 &&
      powerupRuntime.grenadeSelfDamage.playerDamageAmounts[0] < 60 &&
      powerupRuntime.grenadeSelfDamage.playerHealthAfter < 100 &&
      powerupRuntime.grenadeSelfDamage.playerHudSyncCount === 1 &&
      powerupRuntime.grenadeSelfDamage.rocketsAfter === 0 &&
      JSON.stringify(powerupRuntime.lightningBeamDamage) === JSON.stringify({
        activeWeaponAfter: "lightning",
        damageAmount: 30,
        fired: true,
        fireSoundWeapon: "lightning",
        hudSyncCount: 1,
        cellsAfter: 0,
        shellsAfter: 0,
      }) &&
      JSON.stringify({
        ...powerupRuntime.lightningUnderwaterDischarge,
        playerDamageAmounts: powerupRuntime.lightningUnderwaterDischarge.playerDamageAmounts.map((amount) =>
          Number(amount.toFixed(6))
        ),
      }) === JSON.stringify({
        activeWeaponAfter: "lightning",
        damageAmount: null,
        fired: true,
        fireSoundWeapon: null,
        hudSyncCount: 1,
        cellsAfter: 0,
        playerArmorAfter: 0,
        playerDamageAmounts: [Number(expectedLightningUnderwaterSelfDamage(4).toFixed(6))],
        playerHealthAfter: 31,
        playerHudSyncCount: 1,
        shellsAfter: 0,
      }) &&
      JSON.stringify(powerupRuntime.sourceCooldowns) === JSON.stringify({
        shotgun: {
          damageAmounts: [24, 24],
          fireResults: [true, false, true],
          shellsAfter: 1,
        },
        supershotgun: {
          damageAmounts: [56, 56],
          fireResults: [true, false, true],
          shellsAfter: 0,
        },
      }) &&
      powerupRuntime.invulnerableArmorDamage === 30 &&
      powerupRuntime.invulnerableArmorAfter === 70 &&
      powerupRuntime.invulnerableHealthAfter === 100 &&
      powerupRuntime.invulnerableHealthDamage === 0
    ),
  `powerup runtime state, Quad damage, and Pentagram damage blocking should stay source-aligned, got ${JSON.stringify(powerupRuntime)}`,
]);
checks.push([
  radsuitHazard.slimeBlocked === null &&
    JSON.stringify(radsuitHazard.slimeUnprotected) === JSON.stringify({ amount: 4, kind: "slime" }) &&
    JSON.stringify(radsuitHazard.lavaProtected) === JSON.stringify({ amount: 10, kind: "lava" }) &&
    radsuitHazard.waistDeepWaterLevel === 2,
  `radsuit contents protection should block slime without hiding lava, got ${JSON.stringify(radsuitHazard)}`,
]);
checks.push([
  runtimeBackpackPickup.added &&
    JSON.stringify(runtimeBackpackPickup.effects) === JSON.stringify([{ shells: 5 }]) &&
    JSON.stringify(runtimeBackpackPickup.feedbacks) === JSON.stringify([{
      message: "You get 5 shells",
      soundPath: "weapons/lock4.wav",
    }]) &&
    runtimeBackpackPickup.modelSource === "progs/backpack.mdl" &&
    runtimeBackpackPickup.pickupRemovedCount === 1 &&
    runtimeBackpackPickup.pickupTimerDelay === 120000 &&
    runtimeBackpackPickup.pickupTimerCleared &&
    runtimeBackpackPickup.timeoutAdded &&
    runtimeBackpackPickup.timeoutRemovedCount === 1 &&
    runtimeBackpackPickup.timeoutEffects.length === 0,
  `runtime backpack pickup should collect once and remove on QuakeC timeout, got ${JSON.stringify(runtimeBackpackPickup)}`,
]);
checks.push([
  strictPickupModel.available?.source === "progs/armor.mdl",
  `fact-backed pickup model should resolve from prepared library, got ${JSON.stringify(strictPickupModel)}`,
]);
checks.push([
  strictPickupModel.missingThrew &&
    strictPickupModel.missingMessage.includes("not a hardcoded pickup fallback"),
  `fact-backed missing pickup model should throw as an asset bug, got ${JSON.stringify(strictPickupModel)}`,
]);
checks.push([
  strictPickupModel.factlessFallback?.source === "progs/armor.mdl",
  `factless pickup model lookup should keep hardcoded fallback, got ${JSON.stringify(strictPickupModel)}`,
]);

const allActive = runPickupSpawnAudit(scene.entities ?? []);
const expectedActivePickupCount = (gameLogic?.entities ?? [])
  .filter((entity) => entity.resolvedPickup && entity.modeMask?.includes("singleplayer:normal"))
  .length;
checks.push([
  allActive.addMeshEntityIndexes.length === expectedActivePickupCount,
  `normal-skill pickup spawn should attempt ${expectedActivePickupCount} active pickups, got ${allActive.addMeshEntityIndexes.length}`,
]);

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

console.log(
  `Pickup runtime audit smoke passed: ${checks.length} checks, ` +
    `${collisionChecks} collision cases, ${allActive.addMeshEntityIndexes.length} active pickups (${mapName}).`,
);

function pickupAuditConfigForMap(inputMapName) {
  if (inputMapName === "e1m1") {
    return {
      strictModelEntityIndex: 20,
      targetUseEntityIndex: 20,
      megahealthEntityIndex: 200,
      disabledPickup: {
        entityIndex: 201,
        expectedModelPath: "progs/g_rock2.mdl",
        label: "skill-disabled rocket launcher",
      },
      pickupCases: [
        {
          entityIndex: 20,
          expectedEffect: { armor: 100, armorType: 0.3 },
          expectedModelPath: "progs/armor.mdl",
          label: "armor",
        },
        {
          entityIndex: 226,
          expectedEffect: { nails: 50 },
          expectedModelPath: "maps/b_nail1.bsp",
          label: "large nails",
        },
        {
          entityIndex: 208,
          expectedEffect: { health: 15, healthMax: 100 },
          expectedModelPath: "maps/b_bh10.bsp",
          label: "rotten health",
        },
        {
          entityIndex: 272,
          expectedEffect: { shells: 5 },
          expectedModelPath: "progs/g_shot.mdl",
          label: "super shotgun",
        },
        {
          entityIndex: 251,
          expectedEffect: {},
          expectedModelPath: "progs/suit.mdl",
          expectedPowerup: {
            activationField: "rad_time",
            durationSeconds: 30,
            finishedField: "radsuit_finished",
            itemFlag: 2097152,
            itemFlagExpression: "IT_SUIT",
          },
          label: "environment suit",
        },
      ],
    };
  }
  if (inputMapName === "e1m2") {
    return {
      strictModelEntityIndex: 430,
      targetUseEntityIndex: 114,
      megahealthEntityIndex: 295,
      pickupCases: [
        {
          entityIndex: 430,
          expectedEffect: { armor: 100, armorType: 0.3 },
          expectedModelPath: "progs/armor.mdl",
          label: "armor",
        },
        {
          entityIndex: 463,
          expectedEffect: { nails: 50 },
          expectedModelPath: "maps/b_nail1.bsp",
          label: "large nails",
        },
        {
          entityIndex: 81,
          expectedEffect: { health: 15, healthMax: 100 },
          expectedModelPath: "maps/b_bh10.bsp",
          label: "rotten health",
        },
        {
          entityIndex: 284,
          expectedEffect: { shells: 5 },
          expectedModelPath: "progs/g_shot.mdl",
          label: "super shotgun",
        },
        {
          entityIndex: 114,
          expectedEffect: { key: "silver" },
          expectedModelPath: "progs/w_s_key.mdl",
          label: "targeted silver key",
        },
        {
          entityIndex: 295,
          expectedEffect: { health: 100, healthMax: 250 },
          expectedModelPath: "maps/b_bh100.bsp",
          label: "megahealth",
        },
      ],
    };
  }
  throw new Error(`Pickup runtime audit does not have fixture cases for ${inputMapName}.`);
}

function pickupEffectMatchesExpected(testCase, effect) {
  if (!effect) return false;
  const entity = entityByIndex.get(testCase.entityIndex);
  const fact = logicEntityByIndex.get(testCase.entityIndex);
  if (!entity?.classname?.startsWith("weapon_")) {
    return JSON.stringify(effect) === JSON.stringify(testCase.expectedEffect);
  }

  const weapon = fact?.resolvedPickup?.behavior?.weapon;
  return (
    JSON.stringify(ammoOnlyInventoryEffect(effect)) === JSON.stringify(testCase.expectedEffect) &&
    effect.weapon?.id === weaponIdForPickupClassname(entity.classname) &&
    effect.weapon?.itemFlag === weapon?.itemFlag &&
    effect.weapon?.itemFlagExpression === weapon?.itemFlagExpression
  );
}

function ammoOnlyInventoryEffect(effect) {
  return ["shells", "nails", "rockets", "cells"].reduce((out, field) => {
    if (typeof effect?.[field] === "number") out[field] = effect[field];
    return out;
  }, {});
}

function weaponIdForPickupClassname(classname) {
  if (classname === "weapon_supershotgun") return "supershotgun";
  if (classname === "weapon_nailgun") return "nailgun";
  if (classname === "weapon_supernailgun") return "supernailgun";
  if (classname === "weapon_grenadelauncher") return "grenadelauncher";
  if (classname === "weapon_rocketlauncher") return "rocketlauncher";
  if (classname === "weapon_lightning") return "lightning";
  return undefined;
}

function runRuntimeBackpackPickupAudit() {
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const nativeWindow = globalThis.window;
  const timers = [];
  const intervals = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = {
      callback,
      cleared: false,
      delay,
    };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer) timer.cleared = true;
  };
  globalThis.window = {
    ...(nativeWindow ?? {}),
    clearInterval: (interval) => {
      if (interval) interval.cleared = true;
    },
    setInterval: (_callback, delay) => {
      const interval = {
        cleared: false,
        delay,
      };
      intervals.push(interval);
      return interval;
    },
  };

  try {
    const effects = [];
    const feedbacks = [];
    let pickupHandle = null;
    const controller = createController({
      addMesh: (_entity, model) => {
        pickupHandle = createFakePickupHandle(model?.source);
        return pickupHandle;
      },
      applyEffect: (effect, _entity, feedback) => {
        effects.push(effect);
        feedbacks.push(feedback);
      },
    });
    controller.spawn([], { models: { "progs/backpack.mdl": backpackModel() } }, [0, 0, 0]);
    const added = controller.addRuntimePickup({
      effect: { shells: 5 },
      entity: runtimeBackpackEntity(-301001),
      feedback: {
        message: "You get 5 shells",
        soundPath: "weapons/lock4.wav",
      },
      modelPath: "progs/backpack.mdl",
      origin: [0, 0, 0],
      removeAfterSeconds: 120,
      visibilityOrigin: [0, -1, 0],
    });
    const pickupTimer = timers.at(-1);
    controller.syncCollision([0, 0, 0], PLAYER_HEIGHT, STEP_HEIGHT);
    controller.clear();

    const timeoutEffects = [];
    let timeoutHandle = null;
    const timeoutController = createController({
      addMesh: (_entity, model) => {
        timeoutHandle = createFakePickupHandle(model?.source);
        return timeoutHandle;
      },
      applyEffect: (effect) => {
        timeoutEffects.push(effect);
      },
    });
    timeoutController.spawn([], { models: { "progs/backpack.mdl": backpackModel() } }, [0, 0, 0]);
    const timeoutAdded = timeoutController.addRuntimePickup({
      effect: { rockets: 2 },
      entity: runtimeBackpackEntity(-301002),
      modelPath: "progs/backpack.mdl",
      origin: [0, 0, 0],
      removeAfterSeconds: 120,
      visibilityOrigin: [0, -1, 0],
    });
    const timeoutTimer = timers.at(-1);
    timeoutTimer?.callback();
    timeoutController.syncCollision([0, 0, 0], PLAYER_HEIGHT, STEP_HEIGHT);
    timeoutController.clear();

    return {
      added,
      effects,
      feedbacks,
      modelSource: pickupHandle?.modelSource,
      pickupRemovedCount: pickupHandle?.removedCount ?? 0,
      pickupTimerCleared: pickupTimer?.cleared === true,
      pickupTimerDelay: pickupTimer?.delay,
      timeoutAdded,
      timeoutEffects,
      timeoutRemovedCount: timeoutHandle?.removedCount ?? 0,
    };
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
    if (nativeWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = nativeWindow;
    }
  }
}

function runtimeBackpackEntity(index) {
  return {
    index,
    classname: "item_backpack",
    origin: { x: 0, y: 0, z: 0 },
    properties: {
      classname: "item_backpack",
      origin: "0 0 0",
    },
  };
}

function backpackModel() {
  return {
    source: "progs/backpack.mdl",
    bounds: {
      min: [-0.25, -0.25, 0],
      max: [0.25, 0.25, 0.875],
    },
  };
}

function createFakePickupHandle(modelSource = null) {
  const handle = {
    element: {
      hidden: false,
    },
    modelSource,
    removedCount: 0,
    remove: () => {
      handle.removedCount += 1;
    },
    setTransform: () => undefined,
  };
  return handle;
}

function runPickupCollisionAudit(entityIndex) {
  const entity = entityByIndex.get(entityIndex);
  if (!entity?.origin) throw new Error(`Missing pickup entity ${entityIndex}.`);
  const effects = [];
  const addMeshEntityIndexes = [];
  const targetUseEntityIndexes = [];
  const megahealthRotDelays = [];
  const powerupActivations = [];
  const controller = createController({
    addMesh: (spawnedEntity) => {
      addMeshEntityIndexes.push(spawnedEntity.index);
      return null;
    },
    applyEffect: (effect) => effects.push(effect),
    startPowerup: (usedEntity, powerup) => powerupActivations.push({
      entityIndex: usedEntity.index,
      powerup,
    }),
    startMegahealthRot: (_entity, delaySeconds) => megahealthRotDelays.push(delaySeconds),
    useTargets: (usedEntity) => targetUseEntityIndexes.push(usedEntity.index),
  });
  controller.spawn([entity], null);
  const pickupOrigin = pointToPoly(entity.origin);
  const playerOrigin = [pickupOrigin[0], pickupOrigin[1], pickupOrigin[2] + PLAYER_HEIGHT];
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  return {
    addMeshEntityIndexes,
    effects,
    megahealthRotDelays,
    modelPath: quakePickupModelPath(entity, null, gameLogic),
    powerupActivations,
    targetUseEntityIndexes,
  };
}

function runPickupSpawnAudit(entities) {
  const addMeshEntityIndexes = [];
  const controller = createController({
    addMesh: (spawnedEntity) => {
      addMeshEntityIndexes.push(spawnedEntity.index);
      return null;
    },
    applyEffect: () => undefined,
  });
  controller.spawn(entities, null);
  return { addMeshEntityIndexes };
}

function runPickupModelStrictnessAudit(entityIndex) {
  const entity = entityByIndex.get(entityIndex);
  if (!entity) throw new Error(`Missing pickup entity ${entityIndex}.`);
  const model = {
    source: "progs/armor.mdl",
    bounds: {
      min: [-1, -1, -1],
      max: [1, 1, 1],
    },
  };
  const available = quakePickupModelForEntity(entity, {
    models: {
      "progs/armor.mdl": model,
    },
  }, null, gameLogic);

  const poisonedLogic = poisonResolvedPickupModelPath(gameLogic, entityIndex, "progs/missing.mdl");
  let missingThrew = false;
  let missingMessage = "";
  try {
    quakePickupModelForEntity(entity, {
      models: {
        "progs/armor.mdl": model,
      },
    }, null, poisonedLogic);
  } catch (error) {
    missingThrew = true;
    missingMessage = String(error?.message ?? error);
  }

  const factlessFallback = quakePickupModelForEntity(entity, {
    models: {
      "progs/armor.mdl": model,
    },
  }, null, stripResolvedPickupFacts(gameLogic, entityIndex));

  return {
    available,
    missingThrew,
    missingMessage,
    factlessFallback,
  };
}

function runPickupTargetUseAudit(entityIndex) {
  const entity = entityByIndex.get(entityIndex);
  if (!entity?.origin) throw new Error(`Missing pickup entity ${entityIndex}.`);
  const factBackedTargetUseEntityIndexes = runPickupTargetUseCollision(entity, gameLogic);
  const factlessLogic = stripResolvedPickupFacts(gameLogic, entityIndex);
  const factlessTargetUseEntityIndexes = runPickupTargetUseCollision(entity, factlessLogic);
  return {
    factBackedFiresTargets: quakePickupFiresTargetsForEntity(entity, gameLogic),
    factBackedTargetUseEntityIndexes,
    factlessFiresTargets: quakePickupFiresTargetsForEntity(entity, factlessLogic),
    factlessTargetUseEntityIndexes,
  };
}

function runPickupMegahealthRotAudit(entityIndex) {
  const entity = entityByIndex.get(entityIndex);
  if (!entity?.origin) throw new Error(`Missing pickup entity ${entityIndex}.`);
  const factBackedRotDelays = runPickupMegahealthRotCollision(entity, gameLogic);
  const factlessLogic = stripResolvedPickupFacts(gameLogic, entityIndex);
  const factlessRotDelays = runPickupMegahealthRotCollision(entity, factlessLogic);
  return {
    factBackedRotDelay: quakePickupMegahealthRotDelayForEntity(entity, gameLogic),
    factBackedRotDelays,
    factlessRotDelay: quakePickupMegahealthRotDelayForEntity(entity, factlessLogic),
    factlessRotDelays,
  };
}

function runPickupPowerupAudit(entityIndex) {
  const entity = entityByIndex.get(entityIndex);
  if (!entity?.origin) throw new Error(`Missing powerup fixture entity ${entityIndex}.`);
  const factlessLogic = stripResolvedPickupFacts(gameLogic, entityIndex);
  return {
    factBackedPowerup: quakePickupPowerupBehaviorForEntity(entity, gameLogic),
    factBackedActivations: runPickupPowerupCollision(entity, gameLogic),
    rebuiltPowerup: quakePickupPowerupBehaviorForEntity(entity, rebuiltGameLogic),
    rebuiltActivations: runPickupPowerupCollision(entity, rebuiltGameLogic),
    factlessPowerup: quakePickupPowerupBehaviorForEntity(entity, factlessLogic),
    factlessActivations: runPickupPowerupCollision(entity, factlessLogic),
  };
}

function powerupActivationMatches(actual, entityIndex, expectedPowerup, options = {}) {
  return Boolean(
    actual &&
      actual.entityIndex === entityIndex &&
      powerupBehaviorMatches(actual.powerup, expectedPowerup, options),
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

function runPickupPowerupCollision(entity, controllerGameLogic) {
  const powerupActivations = [];
  const controller = createController({
    addMesh: () => null,
    applyEffect: () => undefined,
    gameLogic: () => controllerGameLogic,
    startPowerup: (usedEntity, powerup) => powerupActivations.push({
      entityIndex: usedEntity.index,
      powerup,
    }),
  });
  controller.spawn([entity], null);
  const pickupOrigin = pointToPoly(entity.origin);
  const playerOrigin = [pickupOrigin[0], pickupOrigin[1], pickupOrigin[2] + PLAYER_HEIGHT];
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  return powerupActivations;
}

function runPowerupRuntimeAudit(powerup) {
  const inventory = createInitialInventory();
  const baselineItemFlags = inventory.itemFlags;
  const state = activateQuakeInventoryPowerup(inventory, powerup, 123);
  const activeFinishedField = Object.keys(inventory.powerups)[0];
  const activeItemFlags = inventory.itemFlags;
  clearQuakeInventoryPowerup(inventory, powerup.finishedField);

  const protectedInventory = createInitialInventory();
  protectedInventory.armor = 100;
  protectedInventory.armorType = 0.3;
  const protectedDamage = applyQuakeDamageToInventory(protectedInventory, 100, { applyHealth: false });

  return {
    baselineItemFlags,
    activeFinishedAt: state?.finishedAt,
    activeFinishedField,
    activeItemFlags,
    activeItemFlagMutationExpression: state?.itemFlagMutation?.expression,
    clearedItemFlags: inventory.itemFlags,
    invulnerableArmorAfter: protectedInventory.armor,
    invulnerableArmorDamage: protectedDamage.armorDamage,
    invulnerableHealthAfter: protectedInventory.health,
    invulnerableHealthDamage: protectedDamage.healthDamage,
    axeDamage: runAxeDamageAudit(),
    grenadeProjectileDamage: runGrenadeProjectileDamageAudit(),
    lightningBeamDamage: runLightningBeamDamageAudit(),
    lightningUnderwaterDischarge: runLightningUnderwaterDischargeAudit(),
    quadDamageAmount: runQuadWeaponDamageAudit(),
    nailgunProjectileDamage: runNailgunProjectileDamageAudit(),
    noAmmoFallback: runNoAmmoFallbackAudit(),
    rocketProjectileDamage: runRocketProjectileDamageAudit(),
    rocketShamblerDamage: runRocketShamblerDamageAudit(),
    rocketSelfDamage: runRocketSelfDamageAudit(),
    sourceCooldowns: runSourceCooldownAudit(),
    superNailgunProjectileDamage: runSuperNailgunProjectileDamageAudit(),
    superShotgunDamage: runSuperShotgunDamageAudit(2),
    superShotgunOneShellFallback: runSuperShotgunDamageAudit(1),
    grenadeSelfDamage: runGrenadeSelfDamageAudit(),
  };
}

function runQuadWeaponDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "shotgun",
    damageMultiplier: 4,
    shells: 1,
  }).damageAmount;
}

function runSuperShotgunDamageAudit(shells) {
  return runWeaponDamageAudit({
    activeWeapon: "supershotgun",
    damageMultiplier: 1,
    shells,
  });
}

function runAxeDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "axe",
    damageMultiplier: 1,
    shells: 0,
  });
}

function runNoAmmoFallbackAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "nailgun",
    bestWeapon: "shotgun",
    damageMultiplier: 1,
    nails: 0,
    shells: 1,
  });
}

function runNailgunProjectileDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "nailgun",
    damageMultiplier: 1,
    nails: 1,
    projectileFrameTimes: [1100],
    shells: 0,
    targetBounds: {
      min: [-1000, -1000, -1000],
      max: [1000, 1000, 1000],
    },
  });
}

function runSuperNailgunProjectileDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "supernailgun",
    damageMultiplier: 1,
    nails: 2,
    projectileFrameTimes: [1100],
    shells: 0,
    targetBounds: {
      min: [-1000, -1000, -1000],
      max: [1000, 1000, 1000],
    },
  });
}

function runGrenadeProjectileDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "grenadelauncher",
    bestWeapon: "grenadelauncher",
    damageMultiplier: 1,
    includeDamageAmounts: true,
    includeRocketsAfter: true,
    projectileFrameTimes: [1100, 1200],
    rockets: 1,
    shells: 0,
    targetBounds: {
      min: [-1.1, -0.05, -0.25],
      max: [-1.0, 0.05, -0.05],
    },
    extraShootables: [{
      entity: { index: 9002, classname: "monster_army" },
      dead: false,
      bounds: {
        min: [-1.02, 0.98, -0.18],
        max: [-0.98, 1.02, -0.14],
      },
    }],
  });
}

function runGrenadeSelfDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "grenadelauncher",
    bestWeapon: "grenadelauncher",
    damageMultiplier: 1,
    includePlayerDamage: true,
    includeRocketsAfter: true,
    playerEyeHeight: PLAYER_HEIGHT * 0.5,
    projectileFrameTimes: [1100, 3600],
    rockets: 1,
    shells: 0,
    targetBounds: null,
  });
}

function runLightningBeamDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "lightning",
    bestWeapon: "lightning",
    cells: 1,
    damageMultiplier: 1,
    includeCellsAfter: true,
    shells: 0,
    targetBounds: {
      min: [-1.1, -0.05, -0.45],
      max: [-1.0, 0.05, -0.15],
    },
  });
}

function runLightningUnderwaterDischargeAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "lightning",
    bestWeapon: "lightning",
    cells: 4,
    damageMultiplier: 1,
    includeCellsAfter: true,
    includePlayerDamage: true,
    playerEyeHeight: PLAYER_HEIGHT,
    playerWaterLevel: 2,
    shells: 0,
    targetBounds: {
      min: [-6.1, -0.05, -0.45],
      max: [-6.0, 0.05, -0.15],
    },
  });
}

function expectedLightningUnderwaterSelfDamage(cells) {
  const distanceUnits = Math.abs((QUAKE_PLAYER_MINS_Z + PLAYER_HEIGHT * 0.5) / QUAKE_COLLISION_UNIT_SCALE);
  return (35 * cells - 0.5 * distanceUnits) * 0.5;
}

function grenadeProjectileRuntimeMatches(result) {
  return result.activeWeaponAfter === "grenadelauncher" &&
    result.fired === true &&
    result.fireSoundWeapon === "grenadelauncher" &&
    result.hudSyncCount === 1 &&
    result.hitCount === 1 &&
    result.rocketsAfter === 0 &&
    result.shellsAfter === 0 &&
    result.nailsAfter === 0 &&
    result.damageAmounts.length === 2 &&
    result.damageAmounts[0] > 110 &&
    result.damageAmounts[0] <= 120 &&
    result.damageAmounts[1] > 90 &&
    result.damageAmounts[1] < result.damageAmounts[0];
}

function runRocketProjectileDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "rocketlauncher",
    bestWeapon: "rocketlauncher",
    damageMultiplier: 1,
    includeDamageAmounts: true,
    includeRocketsAfter: true,
    projectileFrameTimes: [1100, 1200],
    random: () => 0,
    rockets: 1,
    shells: 0,
    targetBounds: {
      min: [-1.1, -0.05, -0.2],
      max: [-1.0, 0.05, 0.05],
    },
    extraShootables: [{
      entity: { index: 9002, classname: "monster_army" },
      dead: false,
      bounds: {
        min: [-1.02, 0.98, -0.14],
        max: [-0.98, 1.02, -0.1],
      },
    }],
  });
}

function runRocketSelfDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "rocketlauncher",
    bestWeapon: "rocketlauncher",
    damageMultiplier: 1,
    includePlayerDamage: true,
    includeRocketsAfter: true,
    playerEyeHeight: PLAYER_HEIGHT * 0.5,
    projectileFrameTimes: [1100],
    random: () => 0,
    rockets: 1,
    shells: 0,
    targetBounds: {
      min: [-1000, -1000, -1000],
      max: [1000, 1000, 1000],
    },
  });
}

function runRocketShamblerDamageAudit() {
  return runWeaponDamageAudit({
    activeWeapon: "rocketlauncher",
    bestWeapon: "rocketlauncher",
    damageMultiplier: 1,
    includeDamageAmounts: true,
    includeRocketsAfter: true,
    projectileFrameTimes: [1100, 1200],
    random: () => 0,
    rockets: 1,
    shells: 0,
    targetBounds: {
      min: [-1.1, -0.05, -0.2],
      max: [-1.0, 0.05, 0.05],
    },
    targetClassname: "monster_shambler",
  });
}

function runSourceCooldownAudit() {
  return {
    shotgun: runWeaponCooldownCase({
      activeWeapon: "shotgun",
      fireTimes: [1000, 1499, 1500],
      shells: 3,
    }),
    supershotgun: runWeaponCooldownCase({
      activeWeapon: "supershotgun",
      fireTimes: [1000, 1699, 1700],
      shells: 4,
    }),
  };
}

function runWeaponCooldownCase({ activeWeapon, fireTimes, shells }) {
  const result = runWeaponDamageAudit({
    activeWeapon,
    damageMultiplier: 1,
    fireTimes,
    shells,
  });
  return {
    damageAmounts: result.damageAmounts,
    fireResults: result.fireResults,
    shellsAfter: result.shellsAfter,
  };
}

function runWeaponDamageAudit({
  activeWeapon,
  bestWeapon = activeWeapon,
  cells = 0,
  damageMultiplier,
  extraShootables = [],
  fireTimes = [1000],
  includeDamageAmounts = false,
  includeCellsAfter = false,
  includeNailsAfter = false,
  includePlayerDamage = false,
  includeRocketsAfter = false,
  nails = 0,
  playerArmor = 0,
  playerArmorType = 0,
  playerEyeHeight = PLAYER_HEIGHT,
  playerHealth = 100,
  playerOrigin = [0, 0, 0],
  playerWaterLevel = 0,
  projectileFrameTimes = [],
  random = Math.random,
  rockets = 0,
  shells,
  targetBounds = {
    min: [-1000, -1000, -1000],
    max: [1000, 1000, 1000],
  },
  targetClassname = "monster_army",
}) {
  const nativeWindow = globalThis.window;
  const pendingFrames = [];
  const damageAmounts = [];
  const fireSoundWeapons = [];
  const playerDamageAmounts = [];
  let currentActiveWeapon = activeWeapon;
  const playerInventory = createInitialInventory();
  playerInventory.health = playerHealth;
  playerInventory.armor = playerArmor;
  playerInventory.armorType = playerArmorType;
  const ammo = {
    cells,
    nails,
    rockets,
    shells,
  };
  const fireResults = [];
  let hitCount = 0;
  let hudSyncCount = 0;
  let playerHudSyncCount = 0;
  const targetEntity = { index: 9001, classname: targetClassname };
  const shootables = [
    ...(targetBounds ? [{
      entity: targetEntity,
      dead: false,
      bounds: targetBounds,
    }] : []),
    ...extraShootables,
  ];
  const entities = new Map(shootables.map((shootable) => [shootable.entity.index, shootable.entity]));

  if (projectileFrameTimes.length) {
    globalThis.window = {
      ...(nativeWindow ?? {}),
      cancelAnimationFrame: (id) => {
        const frame = pendingFrames.find((entry) => entry.id === id);
        if (frame) frame.cancelled = true;
      },
      requestAnimationFrame: (callback) => {
        const frame = {
          callback,
          cancelled: false,
          id: pendingFrames.length + 1,
        };
        pendingFrames.push(frame);
        return frame.id;
      },
    };
  }

  try {
    const controller = createQuakeWeaponsController({
      scene: { camera: { state: { rotX: 90, rotY: 0 } } },
      controls: { getOrigin: () => playerOrigin },
      canUseGameplayInput: () => true,
      hasViewmodel: () => true,
      getCollisionWorld: () => null,
      getEntities: () => entities,
      getPlayerEyeHeight: () => playerEyeHeight,
      getPlayerWaterLevel: () => playerWaterLevel,
      getActiveWeapon: () => currentActiveWeapon,
      getAmmo: (field) => ammo[field] ?? 0,
      consumeAmmo: (field, amount) => {
        ammo[field] = Math.max(0, (ammo[field] ?? 0) - amount);
      },
      getShootables: () => shootables,
      selectBestWeapon: () => {
        currentActiveWeapon = bestWeapon;
        return currentActiveWeapon;
      },
      syncHud: () => {
        hudSyncCount += 1;
      },
      playFireSound: (weapon) => {
        fireSoundWeapons.push(weapon);
      },
      playFireAnimation: () => undefined,
      damageShootable: (_entityIndex, amount) => {
        damageAmounts.push(amount);
        return true;
      },
      damageBrushEntity: () => false,
      damagePlayer: (amount) => {
        playerDamageAmounts.push(amount);
        const damage = applyQuakeDamageToInventory(playerInventory, amount);
        if (damage.changed) playerHudSyncCount += 1;
        return damage.changed;
      },
      damageMultiplier: () => damageMultiplier,
      random,
      onHit: () => {
        hitCount += 1;
      },
      syncCrosshairTarget: () => undefined,
    });
    for (const fireTime of fireTimes) {
      fireResults.push(controller.fire(fireTime));
    }
    for (const frameTime of projectileFrameTimes) {
      const frame = pendingFrames.shift();
      if (frame && !frame.cancelled) frame.callback(frameTime);
    }
    return {
      activeWeaponAfter: currentActiveWeapon,
      damageAmount: damageAmounts[0] ?? null,
      fired: fireResults[0] ?? false,
      fireSoundWeapon: fireSoundWeapons[0] ?? null,
      hudSyncCount,
      ...(projectileFrameTimes.length ? { hitCount } : {}),
      ...(includeDamageAmounts ? { damageAmounts } : {}),
      ...(includeCellsAfter ? { cellsAfter: ammo.cells } : {}),
      ...(includeNailsAfter || projectileFrameTimes.length ? { nailsAfter: ammo.nails } : {}),
      ...(includePlayerDamage
        ? {
            playerArmorAfter: playerInventory.armor,
            playerDamageAmounts,
            playerHealthAfter: playerInventory.health,
            playerHudSyncCount,
          }
        : {}),
      ...(includeRocketsAfter ? { rocketsAfter: ammo.rockets } : {}),
      ...(fireTimes.length > 1 ? { damageAmounts, fireResults } : {}),
      shellsAfter: ammo.shells,
    };
  } finally {
    if (projectileFrameTimes.length) {
      if (nativeWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = nativeWindow;
      }
    }
  }
}

function runRadsuitHazardAudit() {
  const slime = quakeContentsDamage(-4);
  const lava = quakeContentsDamage(-5);
  const waistZ = -PLAYER_HEIGHT * 0.5;
  return {
    slimeBlocked: quakeRadsuitProtectedContentsDamage(slime, true),
    slimeUnprotected: quakeRadsuitProtectedContentsDamage(slime, false),
    lavaProtected: quakeRadsuitProtectedContentsDamage(lava, true),
    waistDeepWaterLevel: quakePlayerWaterLevel((point) => point[2] <= waistZ ? -3 : 0, [0, 0, 0], PLAYER_HEIGHT),
  };
}

function runPickupMegahealthRotCollision(entity, controllerGameLogic) {
  const megahealthRotDelays = [];
  const controller = createController({
    addMesh: () => null,
    applyEffect: () => undefined,
    gameLogic: () => controllerGameLogic,
    startMegahealthRot: (_usedEntity, delaySeconds) => megahealthRotDelays.push(delaySeconds),
  });
  controller.spawn([entity], null);
  const pickupOrigin = pointToPoly(entity.origin);
  const playerOrigin = [pickupOrigin[0], pickupOrigin[1], pickupOrigin[2] + PLAYER_HEIGHT];
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  return megahealthRotDelays;
}

function runPickupHealthAcceptanceAudit() {
  const normalCase = pickupCases.find((testCase) =>
    typeof testCase.expectedEffect.health === "number" &&
    testCase.expectedEffect.healthMax === 100
  );
  if (!normalCase) throw new Error(`Missing capped health fixture for ${mapName}.`);
  const normalEntity = entityByIndex.get(normalCase.entityIndex);
  const megaEntity = entityByIndex.get(pickupAuditConfig.megahealthEntityIndex);
  if (!normalEntity || !megaEntity) throw new Error(`Missing health acceptance fixtures for ${mapName}.`);
  const normalFactlessLogic = stripResolvedPickupFacts(gameLogic, normalEntity.index);
  const megaFactlessLogic = stripResolvedPickupFacts(gameLogic, megaEntity.index);
  const rejectedNormal = runPickupRejectedCollision(normalEntity, { health: 100 });
  const rejectedMega = runPickupRejectedCollision(megaEntity, { health: 250 });
  return {
    normalAcceptance: quakePickupHealthAcceptanceForEntity(normalEntity, gameLogic),
    rebuiltNormalAcceptance: quakePickupHealthAcceptanceForEntity(normalEntity, rebuiltGameLogic),
    normalHealAmount: normalCase.expectedEffect.health,
    normalHealType: normalCase.expectedEffect.health === 15 ? 0 : 1,
    normalRejectAt100: !quakeCanPickupForInventory(normalEntity, { health: 100 }, gameLogic, normalCase.expectedEffect),
    normalFactlessAllows100: quakeCanPickupForInventory(normalEntity, { health: 100 }, normalFactlessLogic, normalCase.expectedEffect),
    megaAcceptance: quakePickupHealthAcceptanceForEntity(megaEntity, gameLogic),
    rebuiltMegaAcceptance: quakePickupHealthAcceptanceForEntity(megaEntity, rebuiltGameLogic),
    megaAllows249: quakeCanPickupForInventory(megaEntity, { health: 249 }, gameLogic, { health: 100, healthMax: 250 }),
    megaRejects250: !quakeCanPickupForInventory(megaEntity, { health: 250 }, gameLogic, { health: 100, healthMax: 250 }),
    megaFactlessAllows250: quakeCanPickupForInventory(megaEntity, { health: 250 }, megaFactlessLogic, { health: 100, healthMax: 250 }),
    rejectedNormalEffects: rejectedNormal.effects,
    rejectedNormalTargetUseEntityIndexes: rejectedNormal.targetUseEntityIndexes,
    rejectedMegaEffects: rejectedMega.effects,
    rejectedMegaRotDelays: rejectedMega.megahealthRotDelays,
    rejectedMegaTargetUseEntityIndexes: rejectedMega.targetUseEntityIndexes,
  };
}

function runPickupAmmoAcceptanceAudit() {
  const ammoCase = pickupCases.find((testCase) =>
    ["shells", "nails", "rockets", "cells"].some((field) => typeof testCase.expectedEffect[field] === "number")
  );
  if (!ammoCase) throw new Error(`Missing ammo fixture for ${mapName}.`);
  const ammoEntity = entityByIndex.get(ammoCase.entityIndex);
  if (!ammoEntity) throw new Error(`Missing ammo acceptance fixture ${ammoCase.entityIndex}.`);
  const ammoBehavior = quakePickupAmmoBehaviorForEntity(ammoEntity, rebuiltGameLogic);
  if (!ammoBehavior) throw new Error(`Missing source-backed ammo behavior for ${ammoCase.entityIndex}.`);
  const inventoryField = ammoBehavior.inventoryField;
  const oneBelowCapInventory = fullPickupInventory({
    [inventoryField]: ammoBehavior.rejectAtOrAboveAmount - 1,
  });
  const atCapInventory = fullPickupInventory({
    [inventoryField]: ammoBehavior.rejectAtOrAboveAmount,
  });
  const rejectedAtCap = runPickupRejectedCollision(ammoEntity, atCapInventory, rebuiltGameLogic);
  const clamped = createInitialInventory();
  clamped.shells = 99;
  clamped.nails = 199;
  clamped.rockets = 99;
  clamped.cells = 99;
  applyQuakeInventoryDelta(clamped, { shells: 10, nails: 10, rockets: 10, cells: 10 });
  return {
    ammoBehavior,
    inventoryField,
    rejectAtOrAboveAmount: ammoBehavior.rejectAtOrAboveAmount,
    allowsOneBelowCap: quakeCanPickupForInventory(ammoEntity, oneBelowCapInventory, rebuiltGameLogic, ammoCase.expectedEffect),
    rejectsAtCap: !quakeCanPickupForInventory(ammoEntity, atCapInventory, rebuiltGameLogic, ammoCase.expectedEffect),
    rejectedAtCapEffects: rejectedAtCap.effects,
    rejectedAtCapTargetUseEntityIndexes: rejectedAtCap.targetUseEntityIndexes,
    clampedInventory: {
      shells: clamped.shells,
      nails: clamped.nails,
      rockets: clamped.rockets,
      cells: clamped.cells,
    },
  };
}

function runPickupArmorAcceptanceAudit() {
  const armorCase = pickupCases.find((testCase) =>
    typeof testCase.expectedEffect.armor === "number" &&
    typeof testCase.expectedEffect.armorType === "number"
  );
  if (!armorCase) throw new Error(`Missing armor fixture for ${mapName}.`);
  const armorEntity = entityByIndex.get(armorCase.entityIndex);
  if (!armorEntity) throw new Error(`Missing armor acceptance fixture ${armorCase.entityIndex}.`);
  const armorFactlessLogic = stripResolvedPickupFacts(gameLogic, armorEntity.index);
  const rejectedGreenArmor = runPickupRejectedCollision(armorEntity, {
    armor: 100,
    armorType: 0.3,
    health: 100,
  });
  return {
    greenArmorBehavior: quakePickupArmorBehaviorForEntity(armorEntity, gameLogic),
    rebuiltGreenArmorBehavior: quakePickupArmorBehaviorForEntity(armorEntity, rebuiltGameLogic),
    greenArmorEffectHasType: JSON.stringify(armorCase.expectedEffect) === JSON.stringify({ armor: 100, armorType: 0.3 }),
    greenArmorAllows99Green: quakeCanPickupForInventory(
      armorEntity,
      { armor: 99, armorType: 0.3, health: 100 },
      gameLogic,
      armorCase.expectedEffect,
    ),
    greenArmorRejects100Green: !quakeCanPickupForInventory(
      armorEntity,
      { armor: 100, armorType: 0.3, health: 100 },
      gameLogic,
      armorCase.expectedEffect,
    ),
    greenArmorRejects150Yellow: !quakeCanPickupForInventory(
      armorEntity,
      { armor: 150, armorType: 0.6, health: 100 },
      gameLogic,
      armorCase.expectedEffect,
    ),
    greenArmorFactlessAllows100Green: quakeCanPickupForInventory(
      armorEntity,
      { armor: 100, armorType: 0.3, health: 100 },
      armorFactlessLogic,
      { armor: 100 },
    ),
    rejectedGreenArmorEffects: rejectedGreenArmor.effects,
    rejectedGreenArmorTargetUseEntityIndexes: rejectedGreenArmor.targetUseEntityIndexes,
  };
}

function runPickupKeyAcceptanceAudit() {
  const keyCase = pickupCases.find((testCase) => typeof testCase.expectedEffect.key === "string");
  const fixture = keyCase ? pickupKeyAcceptanceFixture(keyCase) : syntheticKeyAcceptanceFixture();
  const { entity: keyEntity, expectedEffect, gameLogic: keyGameLogic } = fixture;
  const keyBehavior = quakePickupKeyBehaviorForEntity(keyEntity, keyGameLogic);
  if (!keyBehavior) throw new Error(`Missing source-backed key behavior for ${keyEntity.index}.`);
  const missingKeyInventory = fullPickupInventory({ keys: new Set() });
  const ownedKeyInventory = fullPickupInventory({ keys: new Set([keyBehavior.key]) });
  const rejectedOwnedKey = runPickupRejectedCollision(keyEntity, ownedKeyInventory, keyGameLogic);
  const appliedInventory = createInitialInventory();
  applyQuakeInventoryDelta(appliedInventory, expectedEffect);
  return {
    keyBehavior,
    expected: {
      key: expectedEffect.key,
      itemFlag: keyBehavior.itemFlag,
      itemFlagExpression: keyBehavior.itemFlagExpression,
    },
    allowsMissingKey: quakeCanPickupForInventory(keyEntity, missingKeyInventory, keyGameLogic, expectedEffect),
    rejectsOwnedKey: !quakeCanPickupForInventory(keyEntity, ownedKeyInventory, keyGameLogic, expectedEffect),
    rejectedOwnedKeyEffects: rejectedOwnedKey.effects,
    rejectedOwnedKeyTargetUseEntityIndexes: rejectedOwnedKey.targetUseEntityIndexes,
    appliedInventoryHasKey: appliedInventory.keys.has(keyBehavior.key),
  };
}

function pickupKeyAcceptanceFixture(keyCase) {
  const keyEntity = entityByIndex.get(keyCase.entityIndex);
  if (!keyEntity) throw new Error(`Missing key acceptance fixture ${keyCase.entityIndex}.`);
  return {
    entity: keyEntity,
    expectedEffect: keyCase.expectedEffect,
    gameLogic: rebuiltGameLogic,
  };
}

function syntheticKeyAcceptanceFixture() {
  const entity = {
    index: 9700,
    classname: "item_key1",
    origin: { x: 0, y: 0, z: 0 },
    properties: {
      spawnflags: "0",
    },
  };
  const worldspawn = scene.entities?.find((candidate) => candidate.classname === "worldspawn");
  return {
    entity,
    expectedEffect: { key: "silver" },
    gameLogic: buildQuakeGameLogicFacts({
      label: `${scene.label ?? mapName}-synthetic-key-pickup`,
      entities: [
        ...(worldspawn ? [worldspawn] : []),
        entity,
      ],
      entityManifest: scene.entityManifest,
      models: scene.collision?.models ?? [],
      collision: scene.collision,
      programFacts: QUAKE_PROGRAM_FACTS,
    }),
  };
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

function fullPickupInventory(overrides = {}) {
  return {
    armor: 0,
    armorType: 0,
    health: 100,
    shells: 0,
    nails: 0,
    rockets: 0,
    cells: 0,
    ...overrides,
  };
}

function runPickupLifecycleRespawnAudit() {
  const armorCase = pickupCases.find((testCase) =>
    typeof testCase.expectedEffect.armor === "number" &&
    typeof testCase.expectedEffect.armorType === "number"
  );
  const weaponCase = pickupCases.find((testCase) =>
    entityByIndex.get(testCase.entityIndex)?.classname.startsWith("weapon_")
  );
  if (!armorCase) throw new Error(`Missing armor fixture for ${mapName}.`);
  if (!weaponCase) throw new Error(`Missing weapon lifecycle fixture for ${mapName}.`);
  const armorEntity = entityByIndex.get(armorCase.entityIndex);
  const weaponEntity = entityByIndex.get(weaponCase.entityIndex);
  if (!armorEntity) throw new Error(`Missing armor lifecycle fixture ${armorCase.entityIndex}.`);
  if (!weaponEntity) throw new Error(`Missing weapon lifecycle fixture ${weaponCase.entityIndex}.`);
  return {
    singleplayerAction: quakePickupLifecycleActionForEntity(armorEntity, gameLogic, { singleplayer: true }),
    deathmatchAction: quakePickupLifecycleActionForEntity(armorEntity, gameLogic, { deathmatch: 1 }),
    deathmatchTwoLeaveAction: quakePickupLifecycleActionForEntity(weaponEntity, gameLogic, { deathmatch: 2 }),
    singleplayerRespawnSchedules: runPickupRespawnCollision(armorEntity, { singleplayer: true }),
    deathmatchRespawnSchedules: runPickupRespawnCollision(armorEntity, { deathmatch: 1 }),
    deathmatchTwoLeaveCollision: runPickupLeaveCollision(weaponEntity, { deathmatch: 2 }),
    conditions: {
      deathmatchOne: quakePickupLifecycleConditionMatches("deathmatch == 1", { deathmatch: 1 }),
      deathmatchTwoRespawn: quakePickupLifecycleConditionMatches("deathmatch == 1", { deathmatch: 2 }),
      deathmatchTwoLeave: quakePickupLifecycleConditionMatches("deathmatch == 2 || coop", { deathmatch: 2 }),
      singleplayerRemove: quakePickupLifecycleConditionMatches("singleplayer || deathmatch != 1", {
        singleplayer: true,
      }),
    },
  };
}

function runPickupRespawnCollision(entity, gameMode) {
  if (!entity.origin) throw new Error(`Missing pickup origin for entity ${entity.index}.`);
  const respawnSchedules = [];
  const controller = createController({
    addMesh: () => null,
    applyEffect: () => undefined,
    gameMode: () => gameMode,
    onRespawnScheduled: (usedEntity, delaySeconds) => respawnSchedules.push({
      delaySeconds,
      entityIndex: usedEntity.index,
    }),
  });
  controller.spawn([entity], null);
  const pickupOrigin = pointToPoly(entity.origin);
  const playerOrigin = [pickupOrigin[0], pickupOrigin[1], pickupOrigin[2] + PLAYER_HEIGHT];
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  controller.clear();
  return respawnSchedules;
}

function runPickupLeaveCollision(entity, gameMode) {
  if (!entity.origin) throw new Error(`Missing pickup origin for entity ${entity.index}.`);
  const effects = [];
  const removedEntityIndexes = [];
  const respawnSchedules = [];
  const controller = createController({
    addMesh: (spawnedEntity) => ({
      element: { hidden: true },
      remove: () => removedEntityIndexes.push(spawnedEntity.index),
    }),
    applyEffect: (effect) => effects.push(effect),
    gameMode: () => gameMode,
    onRespawnScheduled: (usedEntity, delaySeconds) => respawnSchedules.push({
      delaySeconds,
      entityIndex: usedEntity.index,
    }),
  });
  controller.spawn([entity], null);
  const pickupOrigin = pointToPoly(entity.origin);
  const playerOrigin = [pickupOrigin[0], pickupOrigin[1], pickupOrigin[2] + PLAYER_HEIGHT];
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  const removedBeforeClear = [...removedEntityIndexes];
  controller.clear();
  return {
    effects,
    removedBeforeClear,
    removedIncludingClear: removedEntityIndexes,
    respawnSchedules,
  };
}

function runPickupRejectedCollision(entity, inventory, controllerGameLogic = gameLogic) {
  if (!entity.origin) throw new Error(`Missing pickup origin for entity ${entity.index}.`);
  const effects = [];
  const megahealthRotDelays = [];
  const targetUseEntityIndexes = [];
  const controller = createController({
    addMesh: () => null,
    applyEffect: (effect) => effects.push(effect),
    canPickup: (effect, usedEntity) =>
      quakeCanPickupForInventory(usedEntity, inventory, controllerGameLogic, effect),
    gameLogic: () => controllerGameLogic,
    startMegahealthRot: (_usedEntity, delaySeconds) => megahealthRotDelays.push(delaySeconds),
    useTargets: (usedEntity) => targetUseEntityIndexes.push(usedEntity.index),
  });
  controller.spawn([entity], null);
  const pickupOrigin = pointToPoly(entity.origin);
  const playerOrigin = [pickupOrigin[0], pickupOrigin[1], pickupOrigin[2] + PLAYER_HEIGHT];
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  return {
    effects,
    megahealthRotDelays,
    targetUseEntityIndexes,
  };
}

function runPickupTargetUseCollision(entity, controllerGameLogic) {
  const targetUseEntityIndexes = [];
  const controller = createController({
    addMesh: () => null,
    applyEffect: () => undefined,
    gameLogic: () => controllerGameLogic,
    useTargets: (usedEntity) => targetUseEntityIndexes.push(usedEntity.index),
  });
  controller.spawn([entity], null);
  const pickupOrigin = pointToPoly(entity.origin);
  const playerOrigin = [pickupOrigin[0], pickupOrigin[1], pickupOrigin[2] + PLAYER_HEIGHT];
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  controller.syncCollision(playerOrigin, PLAYER_HEIGHT, STEP_HEIGHT);
  return targetUseEntityIndexes;
}

function poisonResolvedPickupModelPath(logic, entityIndex, modelPath) {
  if (!logic) return null;
  return {
    ...logic,
    entities: (logic.entities ?? []).map((entity) => {
      if (entity.entityIndex !== entityIndex || !entity.resolvedPickup) return entity;
      return {
        ...entity,
        resolvedPickup: {
          ...entity.resolvedPickup,
          modelPath,
        },
      };
    }),
  };
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

function createController(overrides) {
  return createQuakePickupController({
    addMesh: overrides.addMesh,
    applyEffect: overrides.applyEffect,
    canPickup: overrides.canPickup,
    gameMode: overrides.gameMode,
    gameLogic: overrides.gameLogic ?? (() => gameLogic),
    leafIndexAt: () => undefined,
    playerForward: () => [0, 1, 0],
    playerViewDot: () => 1,
    pointToPoly,
    programMetadata: () => null,
    shouldSpawn: shouldSpawnNormalSingleplayer,
    startMegahealthRot: overrides.startMegahealthRot,
    startPowerup: overrides.startPowerup,
    onRespawnScheduled: overrides.onRespawnScheduled,
    useTargets: overrides.useTargets,
    visibleLeavesAt: () => null,
  });
}

function shouldSpawnNormalSingleplayer(entity) {
  const fact = logicEntityByIndex.get(entity.index);
  return fact?.modeMask?.includes("singleplayer:normal") ?? true;
}

function pointToPoly(point) {
  return [
    (point.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
    (point.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
    (point.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
  ];
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
