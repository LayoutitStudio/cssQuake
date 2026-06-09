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

const scene = await readScene(scenePath);
const {
  createQuakePickupController,
  quakeCanPickupForInventory,
  quakePickupArmorBehaviorForEntity,
  quakePickupFiresTargetsForEntity,
  quakePickupHealthAcceptanceForEntity,
  quakePickupLifecycleActionForEntity,
  quakePickupLifecycleConditionMatches,
  quakePickupMegahealthRotDelayForEntity,
  quakePickupModelForEntity,
  quakePickupModelPath,
  quakePickupPowerupBehaviorForEntity,
} = await importBundledModule(runtimePickupsPath);
const { PLAYER_HEIGHT, QUAKE_COLLISION_UNIT_SCALE, STEP_HEIGHT } = await importBundledModule(runtimeConstantsPath);
const {
  quakeContentsDamage,
  quakeRadsuitProtectedContentsDamage,
} = await importBundledModule(runtimeHazardsPath);
const {
  activateQuakeInventoryPowerup,
  applyQuakeDamageToInventory,
  clearQuakeInventoryPowerup,
  createInitialInventory,
} = await importBundledModule(runtimeHudPath);
const { createQuakeWeaponsController } = await importBundledModule(runtimeWeaponsPath);

const mapName = path.basename(scenePath, ".json");
const gameLogic = scene.gameLogic;
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
    JSON.stringify(result.effects) === JSON.stringify([testCase.expectedEffect]),
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
    JSON.stringify(result.powerupActivations) === JSON.stringify(testCase.expectedPowerup
      ? [{ entityIndex: testCase.entityIndex, powerup: testCase.expectedPowerup }]
      : []),
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
const armorAcceptance = runPickupArmorAcceptanceAudit();
const healthAcceptance = runPickupHealthAcceptanceAudit();
const lifecycleRespawn = runPickupLifecycleRespawnAudit();
const powerupCase = pickupCases.find((testCase) => testCase.expectedPowerup);
const powerupBehavior = powerupCase ? runPickupPowerupAudit(powerupCase.entityIndex) : null;
const powerupRuntime = powerupCase ? runPowerupRuntimeAudit(powerupCase.expectedPowerup) : null;
const radsuitHazard = runRadsuitHazardAudit();
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
  JSON.stringify(armorAcceptance.greenArmorBehavior) === JSON.stringify({
    armorType: 0.3,
    armorValue: 100,
    itemFlag: 8192,
    itemFlagExpression: "IT_ARMOR1",
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
      JSON.stringify(powerupBehavior.factBackedPowerup) === JSON.stringify(powerupCase.expectedPowerup) &&
      powerupBehavior.factBackedActivations.length === 1 &&
      JSON.stringify(powerupBehavior.factBackedActivations[0]) === JSON.stringify({
        entityIndex: powerupCase.entityIndex,
        powerup: powerupCase.expectedPowerup,
      }) &&
      powerupBehavior.factlessPowerup === undefined &&
      powerupBehavior.factlessActivations.length === 0
    ),
  `powerup pickup behavior should be source-fact backed, got ${JSON.stringify(powerupBehavior)}`,
]);
checks.push([
  !powerupCase ||
    (
      powerupRuntime.activeItemFlags === powerupCase.expectedPowerup.itemFlag &&
      powerupRuntime.activeFinishedField === powerupCase.expectedPowerup.finishedField &&
      powerupRuntime.activeFinishedAt === 30123 &&
      powerupRuntime.clearedItemFlags === 0 &&
      powerupRuntime.quadDamageAmount === 96 &&
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
    JSON.stringify(radsuitHazard.lavaProtected) === JSON.stringify({ amount: 10, kind: "lava" }),
  `radsuit contents protection should block slime without hiding lava, got ${JSON.stringify(radsuitHazard)}`,
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
    factlessPowerup: quakePickupPowerupBehaviorForEntity(entity, factlessLogic),
    factlessActivations: runPickupPowerupCollision(entity, factlessLogic),
  };
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
  const state = activateQuakeInventoryPowerup(inventory, powerup, 123);
  const activeFinishedField = Object.keys(inventory.powerups)[0];
  const activeItemFlags = inventory.itemFlags;
  clearQuakeInventoryPowerup(inventory, powerup.finishedField);

  const protectedInventory = createInitialInventory();
  protectedInventory.armor = 100;
  protectedInventory.armorType = 0.3;
  const protectedDamage = applyQuakeDamageToInventory(protectedInventory, 100, { applyHealth: false });

  return {
    activeFinishedAt: state?.finishedAt,
    activeFinishedField,
    activeItemFlags,
    clearedItemFlags: inventory.itemFlags,
    invulnerableArmorAfter: protectedInventory.armor,
    invulnerableArmorDamage: protectedDamage.armorDamage,
    invulnerableHealthAfter: protectedInventory.health,
    invulnerableHealthDamage: protectedDamage.healthDamage,
    quadDamageAmount: runQuadWeaponDamageAudit(),
  };
}

function runQuadWeaponDamageAudit() {
  const damageAmounts = [];
  let shells = 1;
  const targetEntity = { index: 9001, classname: "monster_army" };
  const controller = createQuakeWeaponsController({
    scene: { camera: { state: { rotX: 90, rotY: 0 } } },
    controls: { getOrigin: () => [0, 0, 0] },
    canUseGameplayInput: () => true,
    hasViewmodel: () => true,
    getCollisionWorld: () => null,
    getEntities: () => new Map([[targetEntity.index, targetEntity]]),
    getShootables: () => [{
      entity: targetEntity,
      dead: false,
      bounds: {
        min: [-1000, -1000, -1000],
        max: [1000, 1000, 1000],
      },
    }],
    getShells: () => shells,
    consumeShell: () => {
      shells = Math.max(0, shells - 1);
    },
    syncHud: () => undefined,
    playFireSound: () => undefined,
    playFireAnimation: () => undefined,
    damageShootable: (_entityIndex, amount) => {
      damageAmounts.push(amount);
      return true;
    },
    damageBrushEntity: () => false,
    damageMultiplier: () => 4,
    onHit: () => undefined,
    syncCrosshairTarget: () => undefined,
  });
  controller.fire(1000);
  return damageAmounts[0];
}

function runRadsuitHazardAudit() {
  const slime = quakeContentsDamage(-4);
  const lava = quakeContentsDamage(-5);
  return {
    slimeBlocked: quakeRadsuitProtectedContentsDamage(slime, true),
    slimeUnprotected: quakeRadsuitProtectedContentsDamage(slime, false),
    lavaProtected: quakeRadsuitProtectedContentsDamage(lava, true),
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
    normalRejectAt100: !quakeCanPickupForInventory(normalEntity, { health: 100 }, gameLogic, normalCase.expectedEffect),
    normalFactlessAllows100: quakeCanPickupForInventory(normalEntity, { health: 100 }, normalFactlessLogic, normalCase.expectedEffect),
    megaAcceptance: quakePickupHealthAcceptanceForEntity(megaEntity, gameLogic),
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

function runPickupRejectedCollision(entity, inventory) {
  if (!entity.origin) throw new Error(`Missing pickup origin for entity ${entity.index}.`);
  const effects = [];
  const megahealthRotDelays = [];
  const targetUseEntityIndexes = [];
  const controller = createController({
    addMesh: () => null,
    applyEffect: (effect) => effects.push(effect),
    canPickup: (effect, usedEntity) =>
      quakeCanPickupForInventory(usedEntity, inventory, gameLogic, effect),
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
