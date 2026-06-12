import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const generatedMonsterLogicPath = path.join(projectRoot, "src/generated/quakeMonsterLogic.ts");
const monsterStateRunnerPath = path.join(projectRoot, "src/runtime/quakeMonsterStateRunner.ts");
const runtimeConstantsPath = path.join(projectRoot, "src/runtime/constants.ts");
const runtimeShootablesPath = path.join(projectRoot, "src/runtime/shootables.ts");
const runtimeTriggerEffectsPath = path.join(projectRoot, "src/runtime/triggerEffects.ts");

const manualClock = installManualRuntimeClock();
const { QUAKE_COLLISION_UNIT_SCALE } = await importBundledModule(runtimeConstantsPath);
const QUAKE_TEST_CONTENTS_SOLID = -2;
const QUAKE_TEST_GROUNDED_MONSTER_ORIGIN_Z = 24 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_TEST_RAF_MS = 17;
const { QUAKE_MONSTER_LOGIC } = await importBundledModule(generatedMonsterLogicPath);
const { createQuakeMonsterStateRunner } = await importBundledModule(monsterStateRunnerPath);
const { quakeTriggerMonsterJumpActivation, quakeTriggerMonsterJumpRule } = await importBundledModule(runtimeTriggerEffectsPath);
const {
  createQuakeShootablesController,
  quakeMonsterCanAcquirePlayer,
  quakeShootableModelPath,
} = await importBundledModule(runtimeShootablesPath);

const monster = {
  index: 246,
  classname: "monster_army",
  origin: { x: 8, y: 1520, z: -200 },
  properties: { classname: "monster_army", origin: "8 1520 -200" },
};
const combatSoldier = {
  index: 30,
  classname: "monster_army",
  origin: { x: 0, y: 0, z: 0 },
  properties: { classname: "monster_army", origin: "0 0 0" },
};
const explobox = {
  index: 21,
  classname: "misc_explobox",
  origin: { x: 616, y: 72, z: 40 },
  properties: { classname: "misc_explobox", origin: "616 72 40" },
};
const targetedExplobox = {
  ...explobox,
  index: 22,
  properties: { ...explobox.properties, target: "explode_target" },
};
const radiusExplobox = {
  ...explobox,
  index: 23,
  origin: { x: 0, y: 0, z: 0 },
  properties: { classname: "misc_explobox", origin: "0 0 0" },
};
const nearRadiusExplobox = {
  ...explobox,
  index: 24,
  origin: { x: 1, y: 0, z: 0 },
  properties: { classname: "misc_explobox", origin: "1 0 0" },
};
const farRadiusExplobox = {
  ...explobox,
  index: 25,
  origin: { x: 10, y: 0, z: 0 },
  properties: { classname: "misc_explobox", origin: "10 0 0" },
};
const boss = {
  index: 109,
  classname: "monster_boss",
  origin: { x: -704, y: 1280, z: -110 },
  properties: {
    classname: "monster_boss",
    origin: "-704 1280 -110",
    target: "boss_dead",
    targetname: "t4",
  },
};
const crucifiedZombie = {
  index: 112,
  classname: "monster_zombie",
  origin: { x: 0, y: 0, z: 80 },
  properties: { classname: "monster_zombie", origin: "0 0 80", spawnflags: "1" },
};
const easyBoss = {
  ...boss,
  index: 110,
  properties: { ...boss.properties, target: "easy_boss_dead" },
};
const soldierModel = {
  source: "progs/soldier.mdl",
  bounds: {
    min: [-0.4, -0.4, 0],
    max: [0.4, 0.4, 1.2],
  },
};
const soldierAnimationModel = {
  ...soldierModel,
  animationFrames: Array.from({ length: 114 }, (_, frameIndex) => ({ name: `soldier_${frameIndex}` })),
  animationFrameSet: {
    frames: [],
    leafCount: 0,
    renderBundle: {},
  },
};
const bossModel = {
  source: "progs/boss.mdl",
  bounds: {
    min: [-2, -2, -0.375],
    max: [2, 2, 4],
  },
};
const monsterSpawnHealthFixtures = Object.entries(QUAKE_MONSTER_LOGIC)
  .map(([classname, logic], offset) => ({
    classname,
    health: logic.spawnProfile?.health,
    index: 300 + offset,
    modelPath: logic.spawnProfile?.modelPath,
  }))
  .filter(({ health, modelPath }) => typeof health === "number" && typeof modelPath === "string");
const monsterDeathOutputModelPaths = [
  ...new Set(
    Object.values(QUAKE_MONSTER_LOGIC)
      .flatMap((logic) => logic.deathOutput?.gib?.modelPaths ?? []),
  ),
].sort();
const monsterModelLibrary = {
  models: Object.fromEntries(
    [
      ...monsterSpawnHealthFixtures.map(({ modelPath }) => [modelPath, {
        source: modelPath,
        bounds: {
          min: [-0.5, -0.5, -0.75],
          max: [0.5, 0.5, 1.25],
        },
      }]),
      ["progs/boss.mdl", bossModel],
    ],
  ),
};
const monsterAnimationModelLibrary = {
  models: Object.fromEntries(
    [
      ...monsterSpawnHealthFixtures.map(({ classname, modelPath }) => [
        modelPath,
        monsterAnimationModel(classname, modelPath),
      ]),
      ...monsterDeathOutputModelPaths.map((modelPath) => [
        modelPath,
        staticDeathOutputModel(modelPath),
      ]),
    ],
  ),
};

const checks = [
  [
    quakeShootableModelPath(monster, null) === "progs/soldier.mdl",
    "monster_army should resolve the expected real model path",
  ],
];

const missingMonsterModel = captureSpawn(() => createController().spawn([monster], { models: {} }, null));
checks.push([
  quakeMonsterCanAcquirePlayer(false) === true && quakeMonsterCanAcquirePlayer(true) === false,
  "Ring of Shadows should block new monster target acquisition while active",
]);

checks.push([
  missingMonsterModel.threw &&
    missingMonsterModel.message.includes("progs/soldier.mdl") &&
    missingMonsterModel.message.includes("not a procedural fallback"),
  `missing monster model should throw a strict preload/asset error, got ${JSON.stringify(missingMonsterModel)}`,
]);

const availableMonsterModel = captureSpawn(() =>
  createController().spawn([monster], { models: { "progs/soldier.mdl": soldierModel } }, null)
);
checks.push([
  !availableMonsterModel.threw,
  `available monster model should spawn without strict fallback error, got ${JSON.stringify(availableMonsterModel)}`,
]);

const moverMonsterBounds = runMoverMonsterBoundsCase();
checks.push([
  moverMonsterBounds.firstHit === 130 &&
    moverMonsterBounds.killed === true &&
    moverMonsterBounds.afterKillHit === null &&
    moverMonsterBounds.farHit === 131 &&
    moverMonsterBounds.pushBlocker === null &&
    moverMonsterBounds.afterPushOriginalHit === null &&
    moverMonsterBounds.afterPushMovedHit === 132 &&
    moverMonsterBounds.blockedPushBlocker === 133 &&
    moverMonsterBounds.afterBlockedPushHit === 133 &&
    moverMonsterBounds.solidPushBlocker === 134 &&
    moverMonsterBounds.afterSolidPushHit === 134,
  `mover monster bounds query should find only live overlapping monsters, let existing damage kill them, and push clearable blockers before block/crush, got ${
    JSON.stringify(moverMonsterBounds)
  }`,
]);

const crucifiedZombieController = createController({ monsterRuntimeEnabled: () => true });
crucifiedZombieController.spawn([crucifiedZombie], monsterModelLibrary, null);
const crucifiedZombieStats = crucifiedZombieController.debugStats();
crucifiedZombieController.clear();
checks.push([
  crucifiedZombieStats.totalShootables === 1 &&
    crucifiedZombieStats.enemyShootables === 0 &&
    crucifiedZombieStats.liveEnemyShootables === 0,
  `monster_zombie spawnflag 1 should stay shootable but not enter enemy movement runtime, got ${
    JSON.stringify(crucifiedZombieStats)
  }`,
]);

const logicalTargetEntities = Array.from({ length: 13 }, (_, index) => ({
  index: 30200 + index,
  classname: "monster_army",
  origin: {
    x: ((index % 4) - 1.5) * 1.2,
    y: 6 + index * 0.5,
    z: 0,
  },
  properties: {
    classname: "monster_army",
    origin: `${((index % 4) - 1.5) * 1.2} ${6 + index * 0.5} 0`,
  },
}));
const logicalTargetController = createController({
  hasLineOfSight: () => true,
});
logicalTargetController.spawn(logicalTargetEntities, { models: { "progs/soldier.mdl": soldierModel } }, null);
const logicalTargetsDisabled = [...logicalTargetController.weaponTargets()];
logicalTargetController.setExpandedLogicalCombatEnabled(true);
logicalTargetController.syncVisibility([0, 0, 0], true);
const logicalTargetsEnabled = [...logicalTargetController.weaponTargets()];
const logicalTargetStatsEnabled = logicalTargetController.debugStats();
logicalTargetController.setExpandedLogicalCombatEnabled(false);
const logicalTargetsDisabledAgain = [...logicalTargetController.weaponTargets()];
const logicalTargetStatsDisabled = logicalTargetController.debugStats();
logicalTargetController.clear();
checks.push([
    logicalTargetsDisabled.length === 0 &&
    logicalTargetStatsEnabled.mountedEnemyShootables === 0 &&
    logicalTargetStatsEnabled.combatBudget.expandedLogicalCombatEnabled === true &&
    logicalTargetStatsEnabled.combatBudget.combatInterestSetSize === 12 &&
    logicalTargetsEnabled.length === 12 &&
    logicalTargetsEnabled.every((target) => !target.dead && target.entity.classname === "monster_army") &&
    logicalTargetStatsDisabled.combatBudget.expandedLogicalCombatEnabled === false &&
    logicalTargetStatsDisabled.combatBudget.combatInterestSetSize === 0 &&
    logicalTargetsDisabledAgain.length === 0,
  `expanded logical combat should expose only bounded live unmounted weapon targets, got ${
    JSON.stringify({
      disabled: logicalTargetsDisabled.map((target) => target.entity.index),
      disabledAgain: logicalTargetsDisabledAgain.map((target) => target.entity.index),
      enabled: logicalTargetsEnabled.map((target) => target.entity.index),
      statsDisabled: logicalTargetStatsDisabled.combatBudget,
      statsEnabled: logicalTargetStatsEnabled.combatBudget,
    })
  }`,
]);

const soldierCombatDamages = [];
const soldierCombatFrames = [];
const soldierCombatController = createController({
  addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameSetMeshHandle(frameIndex, soldierCombatFrames),
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  damagePlayer: (amount) => {
    soldierCombatDamages.push(amount);
    return true;
  },
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 0.75, 0.8],
  hasLineOfSight: () => true,
  monsterRuntimeEnabled: () => true,
});
soldierCombatController.spawn([combatSoldier], { models: { "progs/soldier.mdl": soldierAnimationModel } }, null);
const soldierCombatMounted = soldierCombatController.debugMountEntity(combatSoldier.index);
manualClock.advanceFrames(8, 100);
soldierCombatController.clear();
checks.push([
  soldierCombatMounted &&
    JSON.stringify(soldierCombatDamages) === JSON.stringify([16]) &&
    soldierCombatFrames.filter((frameIndex) => frameIndex === 85).length === 1,
  `monster_army runtime should consume QuakeC army_atk5 fire_bullets once, got ${
    JSON.stringify({ damages: soldierCombatDamages, frames: soldierCombatFrames })
  }`,
]);

const targetUseSoldier = {
  ...combatSoldier,
  index: 30130,
  properties: { ...combatSoldier.properties, targetname: "ambush" },
};
const monsterJumpTrigger = {
  index: 30131,
  classname: "trigger_monsterjump",
  modelIndex: 1,
  properties: { classname: "trigger_monsterjump", model: "*1" },
};
const monsterJumpSoldier = {
  ...combatSoldier,
  index: 30132,
  properties: { ...combatSoldier.properties, target: "jump_path" },
};
const monsterJumpPath = pathCornerEntity(30133, "jump_path", undefined, [
  0,
  4,
  QUAKE_TEST_GROUNDED_MONSTER_ORIGIN_Z,
]);
const monsterJumpTriggerModel = {
  index: 1,
  mins: { x: -64, y: 6, z: 0 },
  maxs: { x: 64, y: 160, z: 80 },
  origin: { x: 0, y: 0, z: 0 },
  headNodes: [0, 0, 0, 0],
  hulls: [],
  firstFace: 0,
  faceCount: 0,
};
const monsterJumpFacts = {
  entities: [{
    entityIndex: monsterJumpTrigger.index,
    classname: "trigger_monsterjump",
    properties: {},
    resolvedTrigger: {
      kind: "trigger_monsterjump",
      source: { spawnFunction: "trigger_monsterjump", initFunction: "InitTrigger" },
      targetUse: { delay: 0, targetEntityIndexes: [] },
      speed: 300,
      height: 240,
      moveDirection: { x: 1, y: 0, z: 0 },
      monsterJump: {
        source: { touchFunction: "trigger_monsterjump_touch", initFunction: "InitTrigger" },
        actorFilter: {
          expression: "other.flags & (FL_MONSTER | FL_FLY | FL_SWIM) != FL_MONSTER",
          requiredFlags: ["FL_MONSTER"],
          excludedFlags: ["FL_FLY", "FL_SWIM"],
        },
        horizontal: {
          speedField: "speed",
          speed: 300,
          moveDirection: { x: 1, y: 0, z: 0 },
          xExpression: "self.movedir_x * self.speed",
          yExpression: "self.movedir_y * self.speed",
          appliesBeforeGroundCheck: true,
        },
        vertical: {
          heightField: "height",
          height: 240,
          zExpression: "self.height",
          requiresGroundFlag: "FL_ONGROUND",
          clearsGroundFlag: true,
          clearGroundExpression: "other.flags - FL_ONGROUND",
        },
        defaultAngles: { x: 0, y: 360, z: 0 },
        modeMask: ["singleplayer:easy", "singleplayer:normal", "singleplayer:hard"],
      },
      damageable: false,
      oneShot: false,
      touchActivates: true,
      useActivates: false,
      spawnflagChecks: [],
      callbacks: { touch: "trigger_monsterjump_touch" },
    },
  }],
};
const monsterJumpRule = quakeTriggerMonsterJumpRule(monsterJumpTrigger, monsterJumpFacts);
const monsterJumpGrounded = quakeTriggerMonsterJumpActivation(monsterJumpTrigger, monsterJumpFacts, {
  isFlying: false,
  isMonster: true,
  isSwimming: false,
  onGround: true,
});
const monsterJumpAirborne = quakeTriggerMonsterJumpActivation(monsterJumpTrigger, monsterJumpFacts, {
  isFlying: false,
  isMonster: true,
  isSwimming: false,
  onGround: false,
});
const monsterJumpFlying = quakeTriggerMonsterJumpActivation(monsterJumpTrigger, monsterJumpFacts, {
  isFlying: true,
  isMonster: true,
  isSwimming: false,
  onGround: true,
});
const monsterJumpSwimming = quakeTriggerMonsterJumpActivation(monsterJumpTrigger, monsterJumpFacts, {
  isFlying: false,
  isMonster: true,
  isSwimming: true,
  onGround: true,
});
const monsterJumpNonMonster = quakeTriggerMonsterJumpActivation(monsterJumpTrigger, monsterJumpFacts, {
  isFlying: false,
  isMonster: false,
  isSwimming: false,
  onGround: true,
});
checks.push([
  JSON.stringify(monsterJumpRule) === JSON.stringify({ direction: [1, 0, 0], height: 240, speed: 300 }) &&
    JSON.stringify(monsterJumpGrounded?.velocity) === JSON.stringify([300, 0, 240]) &&
    monsterJumpGrounded?.verticalApplied === true &&
    JSON.stringify(monsterJumpAirborne?.velocity) === JSON.stringify([300, 0, 0]) &&
    monsterJumpAirborne?.verticalApplied === false &&
    monsterJumpFlying === null &&
    monsterJumpSwimming === null &&
    monsterJumpNonMonster === null,
  `trigger_monsterjump rule should match QuakeC actor and ground filters, got ${
    JSON.stringify({
      airborne: monsterJumpAirborne,
      flying: monsterJumpFlying,
      grounded: monsterJumpGrounded,
      nonMonster: monsterJumpNonMonster,
      rule: monsterJumpRule,
      swimming: monsterJumpSwimming,
    })
  }`,
]);
const dormantTargetTransforms = [];
const dormantTargetController = createController({
  addMesh: (_entity, _model, frameIndex = 0) =>
    createFakeFrameTransformMeshHandle(frameIndex, [], dormantTargetTransforms),
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 6, QUAKE_TEST_GROUNDED_MONSTER_ORIGIN_Z],
  hasLineOfSight: (_start, end) => end[1] < 3,
  monsterRuntimeEnabled: () => true,
});
dormantTargetController.spawn([targetUseSoldier], { models: { "progs/soldier.mdl": soldierAnimationModel } }, null);
const dormantTargetMounted = dormantTargetController.debugMountEntity(targetUseSoldier.index);
manualClock.advanceFrames(4, 100);
dormantTargetController.clear();

const activatedTargetTransforms = [];
const activatedTargetController = createController({
  addMesh: (_entity, _model, frameIndex = 0) =>
    createFakeFrameTransformMeshHandle(frameIndex, [], activatedTargetTransforms),
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 6, QUAKE_TEST_GROUNDED_MONSTER_ORIGIN_Z],
  hasLineOfSight: (_start, end) => end[1] < 3,
  monsterRuntimeEnabled: () => true,
});
activatedTargetController.spawn([targetUseSoldier], { models: { "progs/soldier.mdl": soldierAnimationModel } }, null);
const activatedTargetMounted = activatedTargetController.debugMountEntity(targetUseSoldier.index);
const targetMonsterActivated = activatedTargetController.activate(targetUseSoldier.index);
const targetMonsterAliveAfterActivate = activatedTargetController.has(targetUseSoldier.index);
manualClock.advanceFrames(4, 100);
activatedTargetController.clear();
checks.push([
  dormantTargetMounted &&
    activatedTargetMounted &&
    targetMonsterActivated &&
    targetMonsterAliveAfterActivate &&
    maxHorizontalTransformMove(dormantTargetTransforms) <= 0.001 &&
    maxHorizontalTransformMove(activatedTargetTransforms) > 0.01,
  `target use should wake a normal monster without destroying it, got ${
    JSON.stringify({
      dormantMove: maxHorizontalTransformMove(dormantTargetTransforms),
      activatedMove: maxHorizontalTransformMove(activatedTargetTransforms),
      targetMonsterActivated,
      targetMonsterAliveAfterActivate,
    })
  }`,
]);

const monsterJumpTransforms = [];
const monsterJumpController = createController({
  addMesh: (_entity, _model, frameIndex = 0) =>
    createFakeFrameTransformMeshHandle(frameIndex, [], monsterJumpTransforms),
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 8, QUAKE_TEST_GROUNDED_MONSTER_ORIGIN_Z],
  hasLineOfSight: (_start, end) => end[1] < 7,
  monsterRuntimeEnabled: () => true,
});
monsterJumpController.spawn([monsterJumpSoldier, monsterJumpPath], { models: { "progs/soldier.mdl": soldierAnimationModel } }, null);
monsterJumpController.setupMonsterJumpTriggers(
  [monsterJumpTrigger],
  [monsterJumpTriggerModel],
  { x: 0, y: 0, z: 0 },
  monsterJumpFacts,
);
const monsterJumpMounted = monsterJumpController.debugMountEntity(monsterJumpSoldier.index);
manualClock.advanceFrames(8, 100);
monsterJumpController.clear();
const monsterJumpInitial = monsterJumpTransforms[0]?.position ?? [0, 0, 0];
const monsterJumpLast = monsterJumpTransforms.at(-1)?.position ?? monsterJumpInitial;
checks.push([
  monsterJumpMounted &&
    monsterJumpLast[0] > monsterJumpInitial[0] + 0.1 &&
    monsterJumpLast[2] > monsterJumpInitial[2] + 0.05,
  `trigger_monsterjump should consume prebaked speed/height/movedir as monster-side velocity, got ${
    JSON.stringify({ initial: monsterJumpInitial, last: monsterJumpLast, mounted: monsterJumpMounted })
  }`,
]);

const soldierCheckAttackAudit = auditMonsterArmySoldierCheckAttackRuntime();
checks.push([
  soldierCheckAttackAudit.ok,
  `monster_army runtime should keep SoldierCheckAttack outcomes live for supported skills, got ${
    JSON.stringify(soldierCheckAttackAudit)
  }`,
]);

const ogreProjectileFrames = [];
const ogreProjectileMeshes = [];
const ogreProjectileController = createController({
  addMesh: (entity, model, frameIndex = 0) => {
    if (entity.classname === "enemy_projectile_grenade") {
      const projectile = {
        classname: entity.classname,
        modelSource: model?.source,
        transforms: [],
      };
      ogreProjectileMeshes.push(projectile);
      return createFakeTransformMeshHandle(projectile.transforms);
    }
    return createFakeFrameSetMeshHandle(frameIndex, ogreProjectileFrames);
  },
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 8, 0.8],
  hasLineOfSight: () => true,
  monsterRuntimeEnabled: () => true,
});
const ogreProjectileEntity = {
  index: 30,
  classname: "monster_ogre",
  origin: { x: 0, y: 0, z: 0 },
  properties: { classname: "monster_ogre", origin: "0 0 0" },
};
ogreProjectileController.spawn([ogreProjectileEntity], {
  models: {
    ...monsterAnimationModelLibrary.models,
    "progs/grenade.mdl": staticDeathOutputModel("progs/grenade.mdl"),
  },
}, null);
const ogreProjectileMounted = ogreProjectileController.debugMountEntity(ogreProjectileEntity.index);
manualClock.advanceFrames(6, 100);
ogreProjectileController.clear();
checks.push([
  ogreProjectileMounted &&
    ogreProjectileFrames.includes(63) &&
    ogreProjectileMeshes.length === 1 &&
    ogreProjectileMeshes[0].classname === "enemy_projectile_grenade" &&
    ogreProjectileMeshes[0].modelSource === "progs/grenade.mdl" &&
    ogreProjectileMeshes[0].transforms.some((transform) =>
      Array.isArray(transform.position) &&
        transform.position.length === 3 &&
        transform.position.every((value) => Number.isFinite(value)) &&
        transform.scale === 1
    ),
  `monster_ogre runtime should consume QuakeC OgreFireGrenade projectile event once, got ${
    JSON.stringify({ frames: ogreProjectileFrames, projectiles: ogreProjectileMeshes })
  }`,
]);

const ogreMeleeFrames = [];
const ogreMeleeDamages = [];
const ogreMeleeController = createController({
  addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameSetMeshHandle(frameIndex, ogreMeleeFrames),
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  damagePlayer: (amount) => {
    ogreMeleeDamages.push(amount);
    return true;
  },
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 1, 0.8],
  hasLineOfSight: () => true,
  monsterRuntimeEnabled: () => true,
});
const ogreMeleeEntity = {
  index: 31,
  classname: "monster_ogre",
  origin: { x: 0, y: 0, z: 0 },
  properties: { classname: "monster_ogre", origin: "0 0 0" },
};
ogreMeleeController.spawn([ogreMeleeEntity], monsterAnimationModelLibrary, null);
const ogreMeleeMounted = ogreMeleeController.debugMountEntity(ogreMeleeEntity.index);
manualClock.advanceFrames(11, 100);
ogreMeleeController.clear();
checks.push([
  ogreMeleeMounted &&
    [52, 53, 54, 55, 56, 57].every((frameIndex) => ogreMeleeFrames.includes(frameIndex)) &&
    ogreMeleeDamages.length === 6 &&
    ogreMeleeDamages.every((amount) => amount >= 0 && amount < 12),
  `monster_ogre runtime should consume QuakeC chainsaw melee frame events, got ${
    JSON.stringify({ damages: ogreMeleeDamages, frames: ogreMeleeFrames })
  }`,
]);

const zombieProjectileFrames = [];
const zombieProjectileMeshes = [];
const zombieProjectileController = createController({
  addMesh: (entity, model, frameIndex = 0) => {
    if (entity.classname === "enemy_projectile_zombie_grenade") {
      const projectile = {
        classname: entity.classname,
        modelSource: model?.source,
        transforms: [],
      };
      zombieProjectileMeshes.push(projectile);
      return createFakeTransformMeshHandle(projectile.transforms);
    }
    return createFakeFrameSetMeshHandle(frameIndex, zombieProjectileFrames);
  },
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 1, 0.8],
  hasLineOfSight: () => true,
  monsterRuntimeEnabled: () => true,
});
const zombieProjectileEntity = {
  index: 32,
  classname: "monster_zombie",
  origin: { x: 0, y: 0, z: 0 },
  properties: { classname: "monster_zombie", origin: "0 0 0" },
};
zombieProjectileController.spawn([zombieProjectileEntity], {
  models: {
    ...monsterAnimationModelLibrary.models,
    "progs/zom_gib.mdl": staticDeathOutputModel("progs/zom_gib.mdl"),
  },
}, null);
const zombieProjectileMounted = zombieProjectileController.debugMountEntity(zombieProjectileEntity.index);
manualClock.advanceFrames(16, 100);
zombieProjectileController.clear();
checks.push([
  zombieProjectileMounted &&
    zombieProjectileFrames.includes(64) &&
    zombieProjectileMeshes.length === 1 &&
    zombieProjectileMeshes[0].classname === "enemy_projectile_zombie_grenade" &&
    zombieProjectileMeshes[0].modelSource === "progs/zom_gib.mdl" &&
    zombieProjectileMeshes[0].transforms.length > 0,
  `monster_zombie runtime should consume QuakeC ZombieFireGrenade projectile event once, got ${
    JSON.stringify({ frames: zombieProjectileFrames, projectiles: zombieProjectileMeshes })
  }`,
]);

const zombieResurrectionFrames = [];
const zombieResurrectionController = createController({
  addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameSetMeshHandle(frameIndex, zombieResurrectionFrames),
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 2, 0.8],
  hasLineOfSight: () => true,
  monsterRuntimeEnabled: () => true,
});
const zombieResurrectionEntity = {
  index: 35,
  classname: "monster_zombie",
  origin: { x: 0, y: 0, z: 0 },
  properties: { classname: "monster_zombie", origin: "0 0 0" },
};
zombieResurrectionController.spawn([zombieResurrectionEntity], monsterAnimationModelLibrary, null);
const zombieResurrectionMounted = zombieResurrectionController.debugMountEntity(zombieResurrectionEntity.index);
const zombieDropStarted = zombieResurrectionController.damage(zombieResurrectionEntity.index, 25);
const zombieSolidWhileFalling = zombieResurrectionController.has(zombieResurrectionEntity.index);
manualClock.advanceFrames(10, 100);
const zombieNonSolidAfterFall = !zombieResurrectionController.has(zombieResurrectionEntity.index);
const zombieWeaponTargetDuringFall = [...zombieResurrectionController.weaponTargets()]
  .find((target) => target.entity.index === zombieResurrectionEntity.index);
const zombieIgnoredDamageWhileDown = zombieResurrectionController.damage(zombieResurrectionEntity.index, 25);
manualClock.advanceFrames(52, 100);
const zombieSolidAfterHold = zombieResurrectionController.has(zombieResurrectionEntity.index);
manualClock.advanceFrames(20, 100);
const zombieRecovered = zombieResurrectionController.has(zombieResurrectionEntity.index);
zombieResurrectionController.clear();
checks.push([
  zombieResurrectionMounted &&
    zombieDropStarted &&
    zombieSolidWhileFalling &&
    zombieNonSolidAfterFall &&
    zombieWeaponTargetDuringFall?.dead === true &&
    zombieIgnoredDamageWhileDown &&
    zombieSolidAfterHold &&
    zombieRecovered &&
    [162, 171, 173, 191].every((frameIndex) => zombieResurrectionFrames.includes(frameIndex)),
  `monster_zombie runtime should consume QuakeC pain_down non-solid hold and resurrection lifecycle, got ${
    JSON.stringify({
      frames: zombieResurrectionFrames,
      ignoredDamage: zombieIgnoredDamageWhileDown,
      nonSolidAfterFall: zombieNonSolidAfterFall,
      recovered: zombieRecovered,
      solidAfterHold: zombieSolidAfterHold,
      solidWhileFalling: zombieSolidWhileFalling,
      weaponTargetDuringFall: zombieWeaponTargetDuringFall,
    })
  }`,
]);

const knightMeleeFrames = [];
const knightMeleeDamages = [];
const knightMeleeController = createController({
  addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameSetMeshHandle(frameIndex, knightMeleeFrames),
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  damagePlayer: (amount) => {
    knightMeleeDamages.push(amount);
    return true;
  },
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 1, 0.8],
  hasLineOfSight: () => true,
  monsterRuntimeEnabled: () => true,
});
const knightMeleeEntity = {
  index: 33,
  classname: "monster_knight",
  origin: { x: 0, y: 0, z: 0 },
  properties: { classname: "monster_knight", origin: "0 0 0" },
};
knightMeleeController.spawn([knightMeleeEntity], monsterAnimationModelLibrary, null);
const knightMeleeMounted = knightMeleeController.debugMountEntity(knightMeleeEntity.index);
manualClock.advanceFrames(9, 100);
knightMeleeController.clear();
checks.push([
  knightMeleeMounted &&
    [48, 49, 50].every((frameIndex) => knightMeleeFrames.includes(frameIndex)) &&
    knightMeleeDamages.length === 3 &&
    knightMeleeDamages.every((amount) => amount >= 3 && amount < 9),
  `monster_knight runtime should consume QuakeC ai_melee frame events, got ${
    JSON.stringify({ damages: knightMeleeDamages, frames: knightMeleeFrames })
  }`,
]);

const wizardProjectileFrames = [];
const wizardProjectileMeshes = [];
const wizardProjectileTimeouts = installWindowTimeoutCapture();
let wizardProjectileMounted = false;
const wizardProjectileController = createController({
  addMesh: (entity, model, frameIndex = 0) => {
    if (entity.classname === "enemy_projectile_spike") {
      const projectile = {
        classname: entity.classname,
        modelSource: model?.source,
        transforms: [],
      };
      wizardProjectileMeshes.push(projectile);
      return createFakeTransformMeshHandle(projectile.transforms);
    }
    return createFakeFrameSetMeshHandle(frameIndex, wizardProjectileFrames);
  },
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  getPlayerEyeHeight: () => 1.4,
  getPlayerOrigin: () => [0, 1, 0.8],
  hasLineOfSight: () => true,
  monsterRuntimeEnabled: () => true,
});
try {
  const wizardProjectileEntity = {
    index: 34,
    classname: "monster_wizard",
    origin: { x: 0, y: 0, z: 0 },
    properties: { classname: "monster_wizard", origin: "0 0 0" },
  };
  wizardProjectileController.spawn([wizardProjectileEntity], {
    models: {
      ...monsterAnimationModelLibrary.models,
      "progs/w_spike.mdl": staticDeathOutputModel("progs/w_spike.mdl"),
    },
  }, null);
  wizardProjectileMounted = wizardProjectileController.debugMountEntity(wizardProjectileEntity.index);
  manualClock.advanceFrames(3, 100);
  wizardProjectileTimeouts.flushAll();
} finally {
  wizardProjectileController.clear();
  wizardProjectileTimeouts.restore();
}
checks.push([
  wizardProjectileMounted &&
    wizardProjectileFrames.includes(29) &&
    JSON.stringify(wizardProjectileTimeouts.delays().sort((a, b) => a - b)) === JSON.stringify([300, 800]) &&
    wizardProjectileMeshes.length === 2 &&
    wizardProjectileMeshes.every((projectile) =>
      projectile.classname === "enemy_projectile_spike" &&
      projectile.modelSource === "progs/w_spike.mdl" &&
      projectile.transforms.length > 0
    ),
  `monster_wizard runtime should consume QuakeC Wiz_FastFire delayed spike projectiles, got ${
    JSON.stringify({
      delays: wizardProjectileTimeouts.delays(),
      frames: wizardProjectileFrames,
      projectiles: wizardProjectileMeshes,
    })
  }`,
]);

const monsterTacticalMovementAudit = auditMonsterTacticalMovement();
checks.push([
  monsterTacticalMovementAudit.ok,
  `normal monster tactical movement should use source-backed QuakeC ai_run distances, got ${
    JSON.stringify(monsterTacticalMovementAudit)
  }`,
]);

const monsterBlockedMovegoalAudit = auditMonsterMoveGoalWallFollow();
checks.push([
  monsterBlockedMovegoalAudit.ok,
  `normal monster movetogoal wall-following should escape a blocked direct movement ray, got ${
    JSON.stringify(monsterBlockedMovegoalAudit)
  }`,
]);

const monsterYawGateAudit = auditMonsterMoveGoalYawGate();
checks.push([
  monsterYawGateAudit.ok,
  `normal monster SV_StepDirection-style yaw gating should turn before moving when far off ideal yaw, got ${
    JSON.stringify(monsterYawGateAudit)
  }`,
]);

const monsterNewChaseDirAudit = auditMonsterNewChaseDirSourceOrder();
checks.push([
  monsterNewChaseDirAudit.ok,
  `normal monster SV_NewChaseDir source order should prefer fresh diagonal/cardinal directions over stale ideal_yaw, got ${
    JSON.stringify(monsterNewChaseDirAudit)
  }`,
]);

const monsterCloseEnoughAudit = auditMonsterMoveGoalCloseEnoughBounds();
checks.push([
  monsterCloseEnoughAudit.ok,
  `normal monster movetogoal should honor Quake SV_CloseEnough-style bounds when chasing a hidden enemy, got ${
    JSON.stringify(monsterCloseEnoughAudit)
  }`,
]);

const monsterCheckBottomAudit = auditMonsterMoveGoalCheckBottom();
checks.push([
  monsterCheckBottomAudit.ok,
  `normal monster movetogoal should refuse first partial-bottom ledge steps, then allow source partial-ground recovery, got ${
    JSON.stringify(monsterCheckBottomAudit)
  }`,
]);

const monsterLostLosHuntAudit = auditMonsterLostLosHuntState();
checks.push([
  monsterLostLosHuntAudit.ok,
  `normal monster hunt state should chase live enemy position after LOS is lost without attacking, got ${
    JSON.stringify(monsterLostLosHuntAudit)
  }`,
]);

const monsterPathCornerAudit = auditMonsterPathCornerRouting();
checks.push([
  monsterPathCornerAudit.ok,
  `normal monster path_corner routing should follow authored movetargets until combat acquisition overrides them, got ${
    JSON.stringify(monsterPathCornerAudit)
  }`,
]);

const monsterAttackBeforeMoveAudit = auditMonsterAttackBeforeMoveOrdering();
checks.push([
  monsterAttackBeforeMoveAudit.ok,
  `normal monster ai_run ordering should check attacks before consuming movement, got ${
    JSON.stringify(monsterAttackBeforeMoveAudit)
  }`,
]);

const dogLeapAudit = auditMonsterAttackDamage({
  classname: "monster_dog",
  expectedFrame: 61,
  minDamage: 10,
  playerOrigin: [0, 2.75, 0.8],
});
checks.push([
  dogLeapAudit.ok,
  `monster_dog runtime should consume QuakeC leap touch-damage events, got ${JSON.stringify(dogLeapAudit)}`,
]);

const demonLeapAudit = auditMonsterAttackDamage({
  classname: "monster_demon1",
  expectedFrame: 30,
  minDamage: 40,
  playerOrigin: [0, 3.5, 0.8],
});
checks.push([
  demonLeapAudit.ok,
  `monster_demon1 runtime should consume QuakeC leap touch-damage events, got ${JSON.stringify(demonLeapAudit)}`,
]);

const shamblerLightningAudit = auditMonsterAttackDamage({
  classname: "monster_shambler",
  expectedDamageCount: 0,
  expectedFrames: [70, 73, 74],
  playerOrigin: [0, 6, 0.8],
});
checks.push([
  shamblerLightningAudit.ok,
  `monster_shambler runtime should consume QuakeC CastLightning frame events, got ${
    JSON.stringify(shamblerLightningAudit)
  }`,
]);

const fallbackShootable = createController();
const fallbackResult = captureSpawn(() => fallbackShootable.spawn([explobox], { models: {} }, null));
checks.push([
  !fallbackResult.threw && fallbackShootable.has(explobox.index),
  `non-monster shootable fallback should remain available, got ${JSON.stringify(fallbackResult)}`,
]);

const damagedExplobox = createController();
damagedExplobox.spawn([explobox], { models: {} }, null);
const survivesPartialDamage = damagedExplobox.damage(explobox.index, 19);
checks.push([
  survivesPartialDamage && damagedExplobox.has(explobox.index),
  "misc_explobox should survive damage below its QuakeC health threshold",
]);

const firedTargets = [];
const targetedExploboxController = createController({
  fireTarget: (targetname, sourceEntityIndex) => {
    firedTargets.push({ targetname, sourceEntityIndex });
  },
});
targetedExploboxController.spawn([targetedExplobox], { models: {} }, null);
const killedByRemainingDamage = targetedExploboxController.damage(targetedExplobox.index, 20);
const repeatedDamageIgnored = targetedExploboxController.damage(targetedExplobox.index, 1);
checks.push([
  killedByRemainingDamage &&
    !repeatedDamageIgnored &&
    !targetedExploboxController.has(targetedExplobox.index) &&
    JSON.stringify(firedTargets) === JSON.stringify([{ targetname: "explode_target", sourceEntityIndex: 22 }]),
  "misc_explobox runtime should destroy at 20 health and fire its target once",
]);

const radiusPlayerDamages = [];
const radiusExploboxController = createController({
  damagePlayer: (amount) => {
    radiusPlayerDamages.push(amount);
    return true;
  },
  hasLineOfSight: () => true,
});
radiusExploboxController.spawn([radiusExplobox, nearRadiusExplobox, farRadiusExplobox], { models: {} }, null);
const radiusSourceKilled = radiusExploboxController.damage(radiusExplobox.index, 20);
checks.push([
  radiusSourceKilled &&
    !radiusExploboxController.has(radiusExplobox.index) &&
    !radiusExploboxController.has(nearRadiusExplobox.index) &&
    radiusExploboxController.has(farRadiusExplobox.index) &&
    radiusPlayerDamages.length >= 1 &&
    radiusPlayerDamages.every((amount) => amount > 0),
  `misc_explobox radius damage should damage the player and chain only nearby shootables, got ${
    JSON.stringify({
      farAlive: radiusExploboxController.has(farRadiusExplobox.index),
      nearAlive: radiusExploboxController.has(nearRadiusExplobox.index),
      playerDamages: radiusPlayerDamages,
      sourceAlive: radiusExploboxController.has(radiusExplobox.index),
    })
  }`,
]);

checks.push([
  monsterSpawnHealthFixtures.length === 8 &&
    !monsterSpawnHealthFixtures.some(({ classname }) => classname === "monster_boss"),
  `ordinary monster spawn-health facts should cover 8 classes and exclude event-driven monster_boss, got ${
    JSON.stringify(monsterSpawnHealthFixtures.map(({ classname }) => classname))
  }`,
]);

const monsterLifecycleTargets = [];
for (const fixture of monsterSpawnHealthFixtures) {
  const entity = {
    index: fixture.index,
    classname: fixture.classname,
    origin: { x: fixture.index, y: 0, z: 0 },
    properties: {
      classname: fixture.classname,
      origin: `${fixture.index} 0 0`,
      target: `dead_${fixture.classname}`,
    },
  };
  checks.push([
    quakeShootableModelPath(entity, null) === fixture.modelPath,
    `${fixture.classname} should resolve its QuakeC spawn model path ${fixture.modelPath}`,
  ]);
  const controller = createController({
    fireTarget: (targetname, sourceEntityIndex) => {
      monsterLifecycleTargets.push({ targetname, sourceEntityIndex });
    },
  });
  controller.spawn([entity], monsterModelLibrary, null);
  const partialDamage = Math.max(1, fixture.health - 1);
  const survivesPartialDamage = controller.damage(entity.index, partialDamage);
  const stillAlive = controller.has(entity.index);
  const killDamage = fixture.classname === "monster_zombie" ? fixture.health : 1;
  const killed = controller.damage(entity.index, killDamage);
  const repeatedDamageIgnored = controller.damage(entity.index, fixture.health);
  checks.push([
    survivesPartialDamage &&
      stillAlive &&
      killed &&
      !repeatedDamageIgnored &&
      !controller.has(entity.index),
    `${fixture.classname} should use QuakeC spawn health ${fixture.health} for shootable lifecycle`,
  ]);
}

checks.push([
  JSON.stringify(monsterLifecycleTargets) === JSON.stringify(monsterSpawnHealthFixtures.map(({ classname, index }) => ({
    targetname: `dead_${classname}`,
    sourceEntityIndex: index,
  }))),
  `monster death target firing should follow the shootable lifecycle once, got ${JSON.stringify(monsterLifecycleTargets)}`,
]);

const monsterReactionAudit = auditMonsterReactionAnimations();
checks.push([
  monsterReactionAudit.ok,
  `monster pain/death reactions should consume generated QuakeC branch facts, got ${JSON.stringify(monsterReactionAudit)}`,
]);

const monsterDeathOutputAudit = auditMonsterDeathOutputs();
checks.push([
  monsterDeathOutputAudit.ok,
  `monster overkill deaths should consume generated QuakeC death-output facts, got ${JSON.stringify(monsterDeathOutputAudit)}`,
]);

const monsterBackpackDropAudit = auditMonsterBackpackDrops();
checks.push([
  monsterBackpackDropAudit.ok,
  `monster regular deaths should emit source-backed backpack drops, got ${JSON.stringify(monsterBackpackDropAudit)}`,
]);

const bossAnimationAudit = auditBossAnimationScript();
checks.push([
  bossAnimationAudit.ok,
  `monster_boss runtime should consume QuakeC rise, shock, and death animation script chains, got ${
    JSON.stringify(bossAnimationAudit)
  }`,
]);

const bossTargets = [];
const bossDischarges = [];
const bossSounds = [];
let bossElectrodesReady = false;
const bossController = createController({
  bossLightningDischarge: (targetName, lightning) => {
    bossDischarges.push({
      targetName,
      fireIntervalMs: lightning.fireIntervalMs,
      resetAfterMs: lightning.resetAfterMs,
      resetFunction: lightning.resetFunction,
      tempEntity: lightning.tempEntity,
    });
  },
  bossLightningElectrodesReady: (targetName, alignment) =>
    targetName === "lightning" &&
    alignment.damageState === "STATE_TOP" &&
    alignment.requiresMatchingState === true &&
    bossElectrodesReady,
  fireTarget: (targetname, sourceEntityIndex) => {
    bossTargets.push({ targetname, sourceEntityIndex });
  },
  playSound: (soundPath) => {
    bossSounds.push(soundPath);
    return true;
  },
});
bossController.spawn([boss], monsterModelLibrary, null);
const bossTriggerBeforeAwake = bossController.triggerBossLightning({ skill: 1 });
const bossWeaponDamageIgnored = bossController.damage(boss.index, 500);
const bossAliveAfterWeaponDamage = bossController.has(boss.index);
const bossActivated = bossController.activate(boss.index, { skill: 1 });
const bossTriggerBeforeElectrodesReady = bossController.triggerBossLightning({ skill: 1 });
bossElectrodesReady = true;
const bossFirstShock = bossController.triggerBossLightning({ skill: 1 });
const bossSecondShock = bossController.triggerBossLightning({ skill: 1 });
const bossThirdShock = bossController.triggerBossLightning({ skill: 1 });
const bossFourthShockIgnored = bossController.triggerBossLightning({ skill: 1 });
checks.push([
  !bossTriggerBeforeAwake &&
    !bossWeaponDamageIgnored &&
    bossAliveAfterWeaponDamage &&
    bossActivated &&
    !bossTriggerBeforeElectrodesReady &&
    bossFirstShock &&
    bossSecondShock &&
    bossThirdShock &&
    !bossFourthShockIgnored &&
    !bossController.has(boss.index) &&
    JSON.stringify(bossTargets) === JSON.stringify([{ targetname: "boss_dead", sourceEntityIndex: boss.index }]) &&
    JSON.stringify(bossDischarges) === JSON.stringify([0, 1, 2].map(() => ({
      targetName: "lightning",
      fireIntervalMs: 100,
      resetAfterMs: 1000,
      resetFunction: "door_go_down",
      tempEntity: "TE_LIGHTNING3",
    }))) &&
    JSON.stringify(bossSounds) === JSON.stringify([
      "misc/power.wav",
      "boss1/pain.wav",
      "misc/power.wav",
      "boss1/pain.wav",
      "misc/power.wav",
      "boss1/pain.wav",
    ]),
  `monster_boss normal-skill lifecycle should wake by target use and die after three lightning uses, got ${
    JSON.stringify({ bossDischarges, bossSounds, bossTargets, has: bossController.has(boss.index) })
  }`,
]);

const easyBossTargets = [];
const easyBossController = createController({
  bossLightningElectrodesReady: (targetName, alignment) =>
    targetName === "lightning" &&
    alignment.damageState === "STATE_TOP" &&
    alignment.requiresMatchingState === true,
  fireTarget: (targetname, sourceEntityIndex) => {
    easyBossTargets.push({ targetname, sourceEntityIndex });
  },
});
easyBossController.spawn([easyBoss], monsterModelLibrary, null);
const easyBossActivated = easyBossController.activate(easyBoss.index, { skill: 0 });
const easyBossFirstShock = easyBossController.triggerBossLightning({ skill: 0 });
const easyBossSecondShockIgnored = easyBossController.triggerBossLightning({ skill: 0 });
checks.push([
  easyBossActivated &&
    easyBossFirstShock &&
    !easyBossSecondShockIgnored &&
    !easyBossController.has(easyBoss.index) &&
    JSON.stringify(easyBossTargets) === JSON.stringify([{ targetname: "easy_boss_dead", sourceEntityIndex: easyBoss.index }]),
  `monster_boss easy-skill lifecycle should die after one lightning use, got ${
    JSON.stringify({ easyBossTargets, has: easyBossController.has(easyBoss.index) })
  }`,
]);

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

console.log(`Shootable runtime audit smoke passed: ${checks.length} checks.`);

function auditMonsterTacticalMovement() {
  const reports = [];
  const classnames = monsterSpawnHealthFixtures
    .map((fixture) => fixture.classname)
    .filter((classname) => classname !== "monster_boss");
  for (const classname of classnames) {
    const frames = [];
    const transforms = [];
    const controller = createController({
      addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameTransformMeshHandle(frameIndex, frames, transforms),
      createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
      getPlayerEyeHeight: () => 1.4,
      getPlayerOrigin: () => [0, 50, 0.8],
      hasLineOfSight: () => true,
      monsterRuntimeEnabled: () => true,
    });
    const entity = {
      index: 42000 + reports.length,
      classname,
      origin: { x: 0, y: 0, z: 0 },
      properties: { classname, origin: "0 0 0" },
    };
    controller.spawn([entity], monsterAnimationModelLibrary, null);
    const mounted = controller.debugMountEntity(entity.index);
    manualClock.advanceFrames(36, QUAKE_TEST_RAF_MS);
    controller.clear();
    const yPositions = transforms
      .map((transform) => transform.position?.[1])
      .filter((value) => typeof value === "number" && Number.isFinite(value));
    const movedY = yPositions.at(-1) ?? 0;
    const movementSteps = [];
    for (let index = 1; index < yPositions.length; index += 1) {
      const step = Math.max(0, yPositions[index] - yPositions[index - 1]);
      if (step > 0.000001) movementSteps.push(step);
    }
    const sourceRunFrameUnits = sourceRunFrameMovementDistances(classname);
    const firstSourceFrameUnits = sourceRunFrameUnits[0] ?? null;
    const maxSourceFrameUnits = Math.max(0, ...sourceRunFrameUnits);
    const firstSourceFrameExpectedY = typeof firstSourceFrameUnits === "number"
      ? firstSourceFrameUnits * QUAKE_COLLISION_UNIT_SCALE
      : null;
    const maxSourceFrameStepY = maxSourceFrameUnits > 0
      ? maxSourceFrameUnits * QUAKE_COLLISION_UNIT_SCALE
      : null;
    const lowerBound = typeof firstSourceFrameExpectedY === "number"
      ? firstSourceFrameExpectedY - 0.000001
      : null;
    const maxStepY = Math.max(0, ...movementSteps);
    const maxSmoothStepY = typeof maxSourceFrameStepY === "number"
      ? maxSourceFrameStepY * 0.75
      : null;
    const ok = mounted &&
      typeof firstSourceFrameExpectedY === "number" &&
      typeof maxSourceFrameStepY === "number" &&
      movedY > 0 &&
      movedY >= lowerBound &&
      movementSteps.length >= 4 &&
      maxStepY > 0 &&
      maxStepY < maxSmoothStepY;
    reports.push({
      classname,
      firstSourceFrameExpectedY,
      lowerBound,
      maxSourceFrameStepY,
      maxSmoothStepY,
      maxStepY,
      mounted,
      movedY,
      movementSteps: movementSteps.length,
      ok,
      frameChanges: frames.length,
      firstSourceFrameUnits,
      maxSourceFrameUnits,
    });
  }
  return {
    ok: reports.length === 8 && reports.every((report) => report.ok),
    reports,
  };
}

function sourceRunFrameMovementDistances(classname) {
  const states = QUAKE_MONSTER_LOGIC[classname]?.chains?.run?.states ?? [];
  return states
    .flatMap((state) => state.movement ?? [])
    .filter((movement) => movement.call === "ai_run" && typeof movement.distanceUnits === "number")
    .map((movement) => movement.distanceUnits);
}

function auditMonsterMoveGoalWallFollow() {
  const reports = [];
  const classnames = monsterSpawnHealthFixtures
    .map((fixture) => fixture.classname)
    .filter((classname) => classname !== "monster_boss");
  const playerOrigin = [0, 300, 0.8];
  for (const classname of classnames) {
    const transforms = [];
    const controller = createController({
      addMesh: () => createFakeTransformMeshHandle(transforms),
      createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
      getPlayerEyeHeight: () => 1.4,
      getPlayerOrigin: () => playerOrigin,
      hasLineOfSight: (_start, end) => {
        if (Math.abs(end[0] - playerOrigin[0]) < 0.000001 &&
          Math.abs(end[1] - playerOrigin[1]) < 0.000001
        ) {
          return true;
        }
        return !(Math.abs(end[0]) < 0.000001 && end[1] > 0);
      },
      monsterRuntimeEnabled: () => true,
    });
    const entity = {
      index: 43000 + reports.length,
      classname,
      origin: { x: 0, y: 0, z: 0 },
      properties: { classname, origin: "0 0 0" },
    };
    controller.spawn([entity], monsterAnimationModelLibrary, null);
    const mounted = controller.debugMountEntity(entity.index);
    manualClock.advanceFrames(24, 100);
    controller.clear();
    const initial = [0, 0, 0];
    const last = transforms.at(-1);
    const movedX = (last?.position?.[0] ?? 0) - initial[0];
    const movedY = (last?.position?.[1] ?? 0) - initial[1];
    const movedDistance = Math.hypot(movedX, movedY);
    const escapedBlockedDirectRay = Math.abs(movedX) > 0.000001;
    reports.push({
      classname,
      escapedBlockedDirectRay,
      mounted,
      movedDistance,
      movedX,
      movedY,
      ok: mounted &&
        movedDistance > 0 &&
        escapedBlockedDirectRay,
    });
  }
  return {
    ok: reports.length === 8 && reports.every((report) => report.ok),
    reports,
  };
}

function auditMonsterMoveGoalYawGate() {
  const classname = "monster_dog";
  const transforms = [];
  const playerOrigin = [100, 100, 0.8];
  const pathOrigin = [0, 50, testMonsterPathTargetZ(classname)];
  const controller = createController({
    addMesh: () => createFakeTransformMeshHandle(transforms),
    createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
    getPlayerEyeHeight: () => 1.4,
    getPlayerOrigin: () => playerOrigin,
    hasLineOfSight: (_start, end) => {
      if (Math.abs(end[0] - playerOrigin[0]) < 0.000001 &&
        Math.abs(end[1] - playerOrigin[1]) < 0.000001
      ) {
        return false;
      }
      return true;
    },
    monsterRuntimeEnabled: () => true,
  });
  const entity = {
    index: 43090,
    classname,
    origin: { x: 0, y: 0, z: 0 },
    properties: { classname, origin: "0 0 0", target: "yaw_gate_path" },
  };
  const path = pathCornerEntity(43091, "yaw_gate_path", undefined, pathOrigin);
  controller.spawn([entity, path], monsterAnimationModelLibrary, null);
  const mounted = controller.debugMountEntity(entity.index);
  const first = transforms[0] ?? { position: [0, 0, 0], rotation: [0, 0, 0] };
  manualClock.advanceFrames(1, 100);
  const afterFirstFrame = transforms.at(-1) ?? first;
  manualClock.advanceFrames(3, 100);
  controller.clear();
  const last = transforms.at(-1) ?? first;
  const firstFrameMovedDistance = Math.hypot(
    (afterFirstFrame.position?.[0] ?? 0) - (first.position?.[0] ?? 0),
    (afterFirstFrame.position?.[1] ?? 0) - (first.position?.[1] ?? 0),
  );
  const movedDistance = Math.hypot(
    (last.position?.[0] ?? 0) - (first.position?.[0] ?? 0),
    (last.position?.[1] ?? 0) - (first.position?.[1] ?? 0),
  );
  const firstFrameYaw = afterFirstFrame.rotation?.[2] ?? 0;
  const lastYaw = last.rotation?.[2] ?? 0;
  return {
    firstFrameMovedDistance,
    firstFrameYaw,
    lastYaw,
    mounted,
    movedDistance,
    ok: mounted &&
      firstFrameMovedDistance <= 0.000001 &&
      firstFrameYaw > 0 &&
      firstFrameYaw < 45 &&
      movedDistance > 0,
  };
}

function auditMonsterNewChaseDirSourceOrder() {
  const classname = "monster_dog";
  const transforms = [];
  let playerOrigin = [50, 0, 0.8];
  const controller = createController({
    addMesh: () => createFakeTransformMeshHandle(transforms),
    createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
    getPlayerEyeHeight: () => 1.4,
    getPlayerOrigin: () => playerOrigin,
    hasLineOfSight: () => true,
    monsterRuntimeEnabled: () => true,
  });
  const entity = {
    index: 43081,
    classname,
    origin: { x: 0, y: 0, z: 0 },
    properties: { classname, origin: "0 0 0" },
  };
  controller.spawn([entity], monsterAnimationModelLibrary, null);
  const mounted = controller.debugMountEntity(entity.index);
  manualClock.advanceFrames(1, 100);
  const beforeRetarget = transforms.at(-1)?.position ?? [0, 0, 0];
  playerOrigin = [beforeRetarget[0] + 50, beforeRetarget[1] + 50, 0.8];
  manualClock.advanceFrames(1, 100);
  controller.clear();
  const last = transforms.at(-1)?.position ?? beforeRetarget;
  const movedX = last[0] - beforeRetarget[0];
  const movedY = last[1] - beforeRetarget[1];
  return {
    beforeRetarget,
    last,
    mounted,
    movedX,
    movedY,
    ok: mounted &&
      movedX > 0 &&
      movedY > 0 &&
      Math.abs(movedX - movedY) <= Math.max(0.000001, Math.abs(movedX) * 0.05),
  };
}

function auditMonsterMoveGoalCloseEnoughBounds() {
  const classname = "monster_dog";
  const frames = [];
  const transforms = [];
  let playerOrigin = [0, 50, 0.8];
  let playerVisible = true;
  const controller = createController({
    addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameTransformMeshHandle(frameIndex, frames, transforms),
    createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
    getPlayerEyeHeight: () => 1.4,
    getPlayerOrigin: () => playerOrigin,
    hasLineOfSight: (_start, end) => {
      if (Math.abs(end[0] - playerOrigin[0]) < 0.000001 &&
        Math.abs(end[1] - playerOrigin[1]) < 0.000001
      ) {
        return playerVisible;
      }
      return true;
    },
    monsterRuntimeEnabled: () => true,
  });
  const entity = {
    index: 43100,
    classname,
    origin: { x: 0, y: 0, z: 0 },
    properties: { classname, origin: "0 0 0" },
  };
  controller.spawn([entity], monsterAnimationModelLibrary, null);
  const mounted = controller.debugMountEntity(entity.index);
  manualClock.advanceFrames(1, 100);
  const afterAcquire = transforms.at(-1)?.position ?? [0, 0, 0];
  const closeEnoughCenterGap = 56 * QUAKE_COLLISION_UNIT_SCALE;
  playerOrigin = [afterAcquire[0], afterAcquire[1] + closeEnoughCenterGap, 0.8];
  playerVisible = false;
  manualClock.advanceFrames(1, 100);
  controller.clear();
  const last = transforms.at(-1)?.position ?? afterAcquire;
  const movedAfterHidden = Math.hypot(last[0] - afterAcquire[0], last[1] - afterAcquire[1]);
  const hiddenAttackFrames = frames.slice(1).some((frameIndex) =>
    attackFrameIndexes(classname).has(frameIndex)
  );
  return {
    closeEnoughCenterGap,
    hiddenAttackFrames,
    last,
    mounted,
    movedAfterHidden,
    ok: mounted &&
      movedAfterHidden <= 0.000001 &&
      !hiddenAttackFrames,
  };
}

function auditMonsterMoveGoalCheckBottom() {
  const classname = "monster_dog";
  const transforms = [];
  const floorSamples = [];
  const playerOrigin = [0, 50, 0.8];
  const controller = createController({
    addMesh: () => createFakeTransformMeshHandle(transforms),
    createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
    floorAt: (x, y) => {
      floorSamples.push([x, y]);
      return Math.abs(x) < 0.1 ? 0 : null;
    },
    getPlayerEyeHeight: () => 1.4,
    getPlayerOrigin: () => playerOrigin,
    hasLineOfSight: (_start, end) => {
      if (Math.abs(end[0] - playerOrigin[0]) < 0.000001 &&
        Math.abs(end[1] - playerOrigin[1]) < 0.000001
      ) {
        return true;
      }
      return Math.abs(end[0]) < 0.000001 && end[1] > 0;
    },
    monsterRuntimeEnabled: () => true,
  });
  const entity = {
    index: 43150,
    classname,
    angle: 90,
    origin: { x: 0, y: 0, z: 0 },
    properties: { angle: "90", classname, origin: "0 0 0" },
  };
  controller.spawn([entity], monsterAnimationModelLibrary, null);
  const mounted = controller.debugMountEntity(entity.index);
  const first = transforms[0]?.position ?? [0, 0, 0];
  manualClock.advanceFrames(1, 100);
  const afterFirstFrame = transforms.at(-1)?.position ?? first;
  manualClock.advanceFrames(2, 100);
  controller.clear();
  const last = transforms.at(-1)?.position ?? first;
  const firstFrameMovedDistance = Math.hypot(afterFirstFrame[0] - first[0], afterFirstFrame[1] - first[1]);
  const movedDistance = Math.hypot(last[0] - first[0], last[1] - first[1]);
  const sampledUnsupportedCorner = floorSamples.some(([x]) => Math.abs(x) >= 0.1);
  return {
    afterFirstFrame,
    firstFrameMovedDistance,
    floorSamples: floorSamples.length,
    last,
    mounted,
    movedDistance,
    sampledUnsupportedCorner,
    ok: mounted &&
      firstFrameMovedDistance <= 0.000001 &&
      movedDistance > 0 &&
      sampledUnsupportedCorner,
  };
}

function auditMonsterLostLosHuntState() {
  const reports = [];
  const classnames = monsterSpawnHealthFixtures
    .map((fixture) => fixture.classname)
    .filter((classname) => classname !== "monster_boss");
  const visiblePlayerOrigin = [0, 50, 0.8];
  const hiddenPlayerOrigin = [50, 0, 0.8];
  for (const classname of classnames) {
    const frames = [];
    const damages = [];
    const projectiles = [];
    const transforms = [];
    let playerOrigin = visiblePlayerOrigin;
    let playerVisible = true;
    const controller = createController({
      addMesh: (entity, model, frameIndex = 0) => {
        if (entity.classname.startsWith("enemy_projectile_")) {
          projectiles.push({ classname: entity.classname, modelSource: model?.source });
          return createFakeTransformMeshHandle([]);
        }
        return createFakeFrameTransformMeshHandle(frameIndex, frames, transforms);
      },
      createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
      damagePlayer: (amount) => {
        damages.push(amount);
        return true;
      },
      getPlayerEyeHeight: () => 1.4,
      getPlayerOrigin: () => playerOrigin,
      hasLineOfSight: (_start, end) => {
        if (Math.abs(end[0] - playerOrigin[0]) < 0.000001 &&
          Math.abs(end[1] - playerOrigin[1]) < 0.000001
        ) {
          return playerVisible;
        }
        return true;
      },
      monsterRuntimeEnabled: () => true,
    });
    const entity = {
      index: 44000 + reports.length,
      classname,
      origin: { x: 0, y: 0, z: 0 },
      properties: { classname, origin: "0 0 0" },
    };
    controller.spawn([entity], {
      models: {
        ...monsterAnimationModelLibrary.models,
        "progs/grenade.mdl": staticDeathOutputModel("progs/grenade.mdl"),
        "progs/w_spike.mdl": staticDeathOutputModel("progs/w_spike.mdl"),
        "progs/zom_gib.mdl": staticDeathOutputModel("progs/zom_gib.mdl"),
      },
    }, null);
    const mounted = controller.debugMountEntity(entity.index);
    manualClock.advanceFrames(1, 100);
    const afterAcquire = transforms.at(-1)?.position ?? [0, 0, 0];
    playerOrigin = hiddenPlayerOrigin;
    playerVisible = false;
    const framesBeforeHidden = frames.length;
    manualClock.advanceFrames(12, 100);
    controller.clear();
    const last = transforms.at(-1)?.position ?? afterAcquire;
    const movedXAfterLostLos = last[0] - afterAcquire[0];
    const movedYAfterLostLos = last[1] - afterAcquire[1];
    const movedAfterLostLos = Math.hypot(movedXAfterLostLos, movedYAfterLostLos);
    const movedTowardHiddenPlayer = movedXAfterLostLos > 0;
    const hiddenAttackFrames = frames.slice(framesBeforeHidden).some((frameIndex) =>
      attackFrameIndexes(classname).has(frameIndex)
    );
    reports.push({
      classname,
      damages,
      hiddenAttackFrames,
      mounted,
      movedAfterLostLos,
      movedTowardHiddenPlayer,
      movedXAfterLostLos,
      movedYAfterLostLos,
      ok: mounted &&
        movedAfterLostLos > 0 &&
        movedTowardHiddenPlayer &&
        !hiddenAttackFrames &&
        damages.length === 0 &&
        projectiles.length === 0,
      projectiles,
    });
  }
  return {
    ok: reports.length === 8 && reports.every((report) => report.ok),
    reports,
  };
}

function auditMonsterPathCornerRouting() {
  const reports = [];
  const classnames = monsterSpawnHealthFixtures
    .map((fixture) => fixture.classname)
    .filter((classname) => classname !== "monster_boss");
  const frameCount = 36;
  const touchRadius = 16 * QUAKE_COLLISION_UNIT_SCALE;
  for (const classname of classnames) {
    const sourceWalkUnits = sourceFrameMovementUnits(classname, "walk", "ai_walk", frameCount);
    const firstY = touchRadius * 1.05;
    const secondX = touchRadius * 1.05;
    const targetZ = testMonsterPathTargetZ(classname);
    const frames = [];
    const transforms = [];
    const controller = createController({
      addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameTransformMeshHandle(frameIndex, frames, transforms),
      createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
      getPlayerEyeHeight: () => 1.4,
      getPlayerOrigin: () => [0, 50, 0.8],
      hasLineOfSight: (_start, end) => {
        if (Math.abs(end[0]) < 0.000001 && Math.abs(end[1] - 50) < 0.000001) return false;
        return true;
      },
      monsterRuntimeEnabled: () => true,
    });
    const monster = {
      index: 45000 + reports.length,
      classname,
      origin: { x: 0, y: 0, z: 0 },
      properties: { classname, origin: "0 0 0", target: "path_a" },
    };
    const pathA = pathCornerEntity(45100 + reports.length * 2, "path_a", "path_b", [
      0,
      firstY,
      targetZ,
    ]);
    const pathB = pathCornerEntity(45101 + reports.length * 2, "path_b", undefined, [
      secondX,
      firstY,
      targetZ,
    ]);
    controller.spawn([monster, pathA, pathB], monsterAnimationModelLibrary, null);
    const mounted = controller.debugMountEntity(monster.index);
    manualClock.advanceFrames(Math.ceil((frameCount * 100) / QUAKE_TEST_RAF_MS), QUAKE_TEST_RAF_MS);
    controller.clear();
    const first = transforms[0]?.position ?? [0, 0, 0];
    const last = transforms.at(-1)?.position ?? first;
    const maxX = Math.max(...transforms.map((transform) => transform.position?.[0] ?? first[0]));
    const maxY = Math.max(...transforms.map((transform) => transform.position?.[1] ?? first[1]));
    const movedAlongFirstPath = maxY > first[1] + touchRadius * 0.1;
    const advancedToNextPath = maxX > first[0] + touchRadius * 0.1;
    reports.push({
      advancedToNextPath,
      classname,
      firstY,
      frameChanges: frames.length,
      last,
      maxX,
      maxY,
      mounted,
      movedAlongFirstPath,
      ok: mounted && movedAlongFirstPath && advancedToNextPath,
      sourceWalkUnits,
    });
  }

  const combatOverride = auditMonsterPathCombatOverride();
  const wallFollow = auditMonsterPathCornerWallFollow();
  return {
    combatOverride,
    ok: reports.length === 8 && reports.every((report) => report.ok) && combatOverride.ok && wallFollow.ok,
    reports,
    wallFollow,
  };
}

function auditMonsterPathCombatOverride() {
  const transforms = [];
  const playerOrigin = [50, 0, 0.8];
  const controller = createController({
    addMesh: () => createFakeTransformMeshHandle(transforms),
    createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
    getPlayerEyeHeight: () => 1.4,
    getPlayerOrigin: () => playerOrigin,
    hasLineOfSight: () => true,
    monsterRuntimeEnabled: () => true,
  });
  const monster = {
    index: 45200,
    classname: "monster_army",
    origin: { x: 0, y: 0, z: 0 },
    properties: { classname: "monster_army", origin: "0 0 0", target: "path_a" },
  };
  const pathA = pathCornerEntity(45201, "path_a", undefined, [0, 4, QUAKE_TEST_GROUNDED_MONSTER_ORIGIN_Z]);
  controller.spawn([monster, pathA], monsterAnimationModelLibrary, null);
  const mounted = controller.debugMountEntity(monster.index);
  manualClock.advanceFrames(8, 100);
  controller.clear();
  const first = transforms[0]?.position ?? [0, 0, 0];
  const last = transforms.at(-1)?.position ?? first;
  const movedTowardPlayer = last[0] > first[0] && Math.abs(last[0] - first[0]) > Math.abs(last[1] - first[1]);
  return {
    last,
    mounted,
    movedTowardPlayer,
    ok: mounted && movedTowardPlayer,
  };
}

function auditMonsterPathCornerWallFollow() {
  const reports = [];
  const classnames = monsterSpawnHealthFixtures
    .map((fixture) => fixture.classname)
    .filter((classname) => classname !== "monster_boss");
  const playerOrigin = [80, 80, 0.8];
  const pathTargetY = 48 * QUAKE_COLLISION_UNIT_SCALE;
  for (const classname of classnames) {
    const targetZ = testMonsterPathTargetZ(classname);
    const transforms = [];
    const controller = createController({
      addMesh: () => createFakeTransformMeshHandle(transforms),
      createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
      getPlayerEyeHeight: () => 1.4,
      getPlayerOrigin: () => playerOrigin,
      hasLineOfSight: (_start, end) => {
        if (Math.abs(end[0] - playerOrigin[0]) < 0.000001 &&
          Math.abs(end[1] - playerOrigin[1]) < 0.000001
        ) {
          return false;
        }
        return !(Math.abs(end[0]) < 0.000001 && end[1] > 0);
      },
      monsterRuntimeEnabled: () => true,
    });
    const monster = {
      index: 45300 + reports.length,
      classname,
      origin: { x: 0, y: 0, z: 0 },
      properties: { classname, origin: "0 0 0", target: "path_blocked" },
    };
    const path = pathCornerEntity(45400 + reports.length, "path_blocked", undefined, [
      0,
      pathTargetY,
      targetZ,
    ]);
    controller.spawn([monster, path], monsterAnimationModelLibrary, null);
    const mounted = controller.debugMountEntity(monster.index);
    manualClock.advanceFrames(3, 100);
    controller.clear();
    const first = transforms[0]?.position ?? [0, 0, 0];
    const last = transforms.at(-1)?.position ?? first;
    const movedX = last[0] - first[0];
    const movedY = last[1] - first[1];
    const movedDistance = Math.hypot(movedX, movedY);
    const escapedBlockedDirectRay = Math.abs(movedX) > 0.000001;
    reports.push({
      classname,
      escapedBlockedDirectRay,
      last,
      mounted,
      movedDistance,
      movedX,
      movedY,
      ok: mounted &&
        movedDistance > 0 &&
        escapedBlockedDirectRay,
    });
  }
  return {
    ok: reports.length === 8 && reports.every((report) => report.ok),
    reports,
  };
}

function testMonsterPathTargetZ(classname) {
  return QUAKE_MONSTER_LOGIC[classname]?.spawnProfile?.dropToFloor === false
    ? 0
    : QUAKE_TEST_GROUNDED_MONSTER_ORIGIN_Z;
}

function pathCornerEntity(index, targetname, target, origin) {
  const originString = `${origin[0]} ${origin[1]} ${origin[2]}`;
  return {
    index,
    classname: "path_corner",
    origin: { x: origin[0], y: origin[1], z: origin[2] },
    properties: {
      classname: "path_corner",
      origin: originString,
      ...(target ? { target } : {}),
      targetname,
    },
  };
}

function sourceFrameMovementUnits(classname, chainName, callName, frameCount) {
  const states = QUAKE_MONSTER_LOGIC[classname]?.chains?.[chainName]?.states ?? [];
  if (!states.length) return 0;
  let total = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const state = states[index % states.length];
    for (const movement of state.movement ?? []) {
      if (movement.call === callName && typeof movement.distanceUnits === "number") {
        total += movement.distanceUnits;
      }
    }
  }
  return total;
}

function attackFrameIndexes(classname) {
  const attackChains = ["attack", "melee", "missile"];
  return new Set(
    attackChains.flatMap((chain) =>
      (QUAKE_MONSTER_LOGIC[classname]?.chains?.[chain]?.states ?? []).map((state) => state.frameIndex)
    ),
  );
}

function auditMonsterAttackBeforeMoveOrdering() {
  const cases = [
    { classname: "monster_army", expectedFrames: [85], frames: 8, index: 30, playerOrigin: [0, 0.75, 0.8] },
    { classname: "monster_dog", expectedFrames: [61], frames: 8, index: 31, playerOrigin: [0, 2.75, 0.8] },
    { classname: "monster_demon1", expectedFrames: [30], frames: 8, index: 32, playerOrigin: [0, 3.5, 0.8] },
    { classname: "monster_knight", expectedFrames: [48], frames: 9, index: 33, playerOrigin: [0, 1, 0.8] },
    {
      classname: "monster_ogre",
      expectedFrames: [52],
      frames: 8,
      index: 34,
      playerOrigin: [0, 1, 0.8],
    },
    { classname: "monster_shambler", expectedFrames: [70], frames: 8, index: 35, playerOrigin: [0, 6, 0.8] },
    {
      classname: "monster_wizard",
      expectedFrames: [29],
      extraModels: { "progs/w_spike.mdl": staticDeathOutputModel("progs/w_spike.mdl") },
      frames: 4,
      index: 36,
      playerOrigin: [0, 1, 0.8],
    },
    {
      classname: "monster_zombie",
      expectedFrames: [64],
      extraModels: { "progs/zom_gib.mdl": staticDeathOutputModel("progs/zom_gib.mdl") },
      frames: 16,
      index: 37,
      playerOrigin: [0, 1, 0.8],
    },
  ];
  const reports = cases.map((testCase) => {
    const frames = [];
    const damages = [];
    const projectiles = [];
    const transforms = [];
    const controller = createController({
      addMesh: (entity, model, frameIndex = 0) => {
        if (entity.classname.startsWith("enemy_projectile_")) {
          projectiles.push({ classname: entity.classname, modelSource: model?.source });
          return createFakeTransformMeshHandle([]);
        }
        return createFakeFrameTransformMeshHandle(frameIndex, frames, transforms);
      },
      createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
      damagePlayer: (amount) => {
        damages.push(amount);
        return true;
      },
      getPlayerEyeHeight: () => 1.4,
      getPlayerOrigin: () => testCase.playerOrigin,
      hasLineOfSight: () => true,
      monsterRuntimeEnabled: () => true,
    });
    const entity = {
      index: testCase.index,
      classname: testCase.classname,
      origin: { x: 0, y: 0, z: 0 },
      properties: { classname: testCase.classname, origin: "0 0 0" },
    };
    controller.spawn([entity], {
      models: {
        ...monsterAnimationModelLibrary.models,
        ...(testCase.extraModels ?? {}),
      },
    }, null);
    const mounted = controller.debugMountEntity(entity.index);
    manualClock.advanceFrames(testCase.frames, 100);
    controller.clear();
    const initial = transforms[0]?.position ?? [0, 0, 0];
    const maxMove = transforms.reduce((max, transform) => {
      const position = transform.position ?? initial;
      return Math.max(max, Math.hypot(position[0] - initial[0], position[1] - initial[1]));
    }, 0);
    const attackSeen = testCase.expectedFrames.every((frameIndex) => frames.includes(frameIndex));
    return {
      attackSeen,
      classname: testCase.classname,
      damages,
      expectedFrames: testCase.expectedFrames,
      frames,
      maxMove,
      mounted,
      ok: mounted && attackSeen && maxMove <= 0.000001,
      projectiles,
    };
  });
  return {
    ok: reports.length === cases.length && reports.every((report) => report.ok),
    reports,
  };
}

function auditMonsterArmySoldierCheckAttackRuntime() {
  const attackFrames = new Set([81, 82, 83, 84, 85, 86, 87, 88, 89]);
  const cases = [
    {
      name: "clear-shot-near-hit",
      expectedDamage: [16],
      expectedFrame: 85,
      frames: 8,
      lineOfSight: true,
      playerOrigin: [0, 0.75, 0.8],
      soldierIndex: 30,
    },
    {
      name: "blocked-clear-shot",
      expectedDamage: [],
      frames: 8,
      lineOfSight: false,
      playerOrigin: [0, 0.75, 0.8],
      rejectAttackFrames: true,
      soldierIndex: 30,
    },
    {
      name: "far-range",
      expectedDamage: [],
      frames: 8,
      lineOfSight: true,
      playerOrigin: [0, 100, 0.8],
      rejectAttackFrames: true,
      soldierIndex: 30,
    },
    {
      name: "mid-range-chance-miss",
      expectedDamage: [],
      frames: 1,
      lineOfSight: true,
      playerOrigin: [0, 8, 0.8],
      rejectAttackFrames: true,
      soldierIndex: 60,
    },
  ];
  const reports = cases.map((testCase) => {
    const frames = [];
    const damages = [];
    const controller = createController({
      addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameSetMeshHandle(frameIndex, frames),
      createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
      damagePlayer: (amount) => {
        damages.push(amount);
        return true;
      },
      getPlayerEyeHeight: () => 1.4,
      getPlayerOrigin: () => testCase.playerOrigin,
      hasLineOfSight: () => testCase.lineOfSight,
      monsterRuntimeEnabled: () => true,
    });
    const entity = {
      index: testCase.soldierIndex,
      classname: "monster_army",
      origin: { x: 0, y: 0, z: 0 },
      properties: { classname: "monster_army", origin: "0 0 0" },
    };
    controller.spawn([entity], { models: { "progs/soldier.mdl": soldierAnimationModel } }, null);
    const mounted = controller.debugMountEntity(entity.index);
    manualClock.advanceFrames(testCase.frames, 100);
    controller.clear();
    const attackFrameHits = frames.filter((frameIndex) => attackFrames.has(frameIndex));
    const ok = mounted &&
      JSON.stringify(damages) === JSON.stringify(testCase.expectedDamage) &&
      (testCase.expectedFrame === undefined || frames.includes(testCase.expectedFrame)) &&
      (!testCase.rejectAttackFrames || attackFrameHits.length === 0);
    return {
      attackFrameHits,
      damages,
      frames,
      mounted,
      name: testCase.name,
      ok,
    };
  });
  return {
    ok: reports.every((report) => report.ok),
    reports,
  };
}

function auditMonsterAttackDamage({
  classname,
  exactDamage,
  expectedDamageCount = 1,
  expectedFrame,
  expectedFrames,
  minDamage = 1,
  playerOrigin,
}) {
  const frames = [];
  const damages = [];
  const spawnFixture = monsterSpawnHealthFixtures.find((fixture) => fixture.classname === classname);
  const controller = createController({
    addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameSetMeshHandle(frameIndex, frames),
    createMonsterStateRunner: (name) => createQuakeMonsterStateRunner(name, { enabled: true }),
    damagePlayer: (amount) => {
      damages.push(amount);
      return true;
    },
    getPlayerEyeHeight: () => 1.4,
    getPlayerOrigin: () => playerOrigin,
    hasLineOfSight: () => true,
    monsterRuntimeEnabled: () => true,
  });
  const entity = {
    index: 43000 + monsterSpawnHealthFixtures.findIndex((fixture) => fixture.classname === classname),
    classname,
    origin: { x: 0, y: 0, z: 0 },
    properties: { classname, origin: "0 0 0" },
  };
  if (!spawnFixture) {
    return { classname, ok: false, reason: "missing spawn fixture" };
  }
  controller.spawn([entity], monsterAnimationModelLibrary, null);
  const mounted = controller.debugMountEntity(entity.index);
  manualClock.advanceFrames(16, 100);
  controller.clear();
  const damageMatches = typeof exactDamage === "number"
    ? damages.length === expectedDamageCount && damages.every((amount) => amount === exactDamage)
    : expectedDamageCount === 0
      ? true
      : damages.length >= expectedDamageCount && damages.every((amount) => amount >= minDamage);
  const requiredFrames = expectedFrames ?? [expectedFrame];
  const framesMatch = requiredFrames.every((frameIndex) => frames.includes(frameIndex));
  return {
    classname,
    damages,
    expectedDamageCount,
    expectedFrames: requiredFrames,
    frames,
    mounted,
    ok: mounted && framesMatch && damageMatches,
  };
}

function auditMonsterReactionAnimations() {
  const reports = [];
  for (const fixture of monsterSpawnHealthFixtures) {
    const reactionProfile = QUAKE_MONSTER_LOGIC[fixture.classname]?.reactionProfile;
    if (!reactionProfile) continue;
    if (reactionProfile.pain) {
      reports.push(auditMonsterReactionMode(fixture, "pain", reactionProfile.pain.branches));
    }
    if (reactionProfile.death) {
      reports.push(auditMonsterReactionMode(fixture, "death", reactionProfile.death.regularBranches));
    }
  }
  return {
    ok: reports.length >= 14 && reports.every((report) => report.ok),
    reports,
  };
}

function auditMonsterDeathOutputs() {
  const reports = [];
  for (const fixture of monsterSpawnHealthFixtures) {
    const gib = QUAKE_MONSTER_LOGIC[fixture.classname]?.deathOutput?.gib;
    if (!gib) continue;
    const index = reactionEntityIndex(fixture.classname, "death", 900);
    const frames = [];
    const outputs = [];
    const controller = createController({
      addMesh: (entity, model, frameIndex = 0) => {
        if (entity.classname === "monster_death_output") {
          outputs.push(model?.source);
          return createFakeFrameSetMeshHandle(frameIndex, []);
        }
        return createFakeFrameSetMeshHandle(frameIndex, frames);
      },
      createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
      monsterRuntimeEnabled: () => true,
    });
    const entity = {
      index,
      classname: fixture.classname,
      origin: { x: index, y: 0, z: 0 },
      properties: {
        classname: fixture.classname,
        origin: `${index} 0 0`,
      },
    };
    controller.spawn([entity], monsterAnimationModelLibrary, null);
    const mounted = controller.debugMountEntity(index);
    const damage = fixture.classname === "monster_zombie"
      ? gib.damageAtLeast ?? 60
      : fixture.health + Math.abs(gib.healthBelow ?? -1) + 1;
    const killed = controller.damage(index, damage);
    const expectedModels = (gib.pieces?.length
      ? gib.pieces.map((piece) => piece.modelPath)
      : [
          gib.headModelPath,
          ...gib.gibModelPaths,
        ].filter(Boolean));
    reports.push({
      classname: fixture.classname,
      mounted,
      killed,
      alive: controller.has(index),
      expectedModels,
      outputs,
      ok: mounted &&
        killed &&
        !controller.has(index) &&
        JSON.stringify(outputs) === JSON.stringify(expectedModels),
    });
    controller.clear();
  }
  return {
    ok: reports.length === 8 && reports.every((report) => report.ok),
    reports,
  };
}

function auditMonsterBackpackDrops() {
  const reports = [];
  const fixtures = [
    {
      classname: "monster_army",
      expectedAmmo: { shells: 5 },
      expectedMessage: "You get 5 shells",
    },
    {
      classname: "monster_ogre",
      expectedAmmo: { rockets: 2 },
      expectedMessage: "You get 2 rockets",
    },
  ];
  for (const fixture of fixtures) {
    const spawnFixture = monsterSpawnHealthFixtures.find((entry) => entry.classname === fixture.classname);
    const backpack = QUAKE_MONSTER_LOGIC[fixture.classname]?.deathOutput?.backpack;
    if (!spawnFixture || !backpack) {
      reports.push({
        classname: fixture.classname,
        ok: false,
        reason: "missing backpack facts",
      });
      continue;
    }
    const index = reactionEntityIndex(fixture.classname, "death", 720);
    const frames = [];
    const drops = [];
    const controller = createController({
      addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameSetMeshHandle(frameIndex, frames),
      createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
      dropBackpack: (drop) => {
        drops.push({
          ammo: drop.ammo,
          message: drop.message,
          modelPath: drop.modelPath,
          origin: drop.origin,
          removeAfterSeconds: drop.removeAfterSeconds,
          soundPath: drop.soundPath,
          sourceEntityIndex: drop.sourceEntity.index,
        });
        return true;
      },
      monsterRuntimeEnabled: () => true,
    });
    const entity = {
      index,
      classname: fixture.classname,
      origin: { x: index, y: 0, z: 48 },
      properties: {
        classname: fixture.classname,
        origin: `${index} 0 48`,
      },
    };
    controller.spawn([entity], monsterAnimationModelLibrary, null);
    const mounted = controller.debugMountEntity(index);
    const killed = controller.damage(index, spawnFixture.health);
    manualClock.advanceFrames(8, 100);
    const expectedOrigin = [index, 0, 48 - 24 * QUAKE_COLLISION_UNIT_SCALE];
    reports.push({
      classname: fixture.classname,
      drops,
      killed,
      mounted,
      ok: mounted &&
        killed &&
        drops.length === 1 &&
        JSON.stringify(drops[0].ammo) === JSON.stringify(fixture.expectedAmmo) &&
        drops[0].message === fixture.expectedMessage &&
        drops[0].modelPath === "progs/backpack.mdl" &&
        drops[0].soundPath === "weapons/lock4.wav" &&
        drops[0].removeAfterSeconds === 120 &&
        drops[0].sourceEntityIndex === index &&
        vectorAlmostEqual(drops[0].origin, expectedOrigin),
    });
    controller.clear();
  }
  return {
    ok: reports.every((report) => report.ok),
    reports,
  };
}

function auditBossAnimationScript() {
  const frames = [];
  const discharges = [];
  const controller = createController({
    addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameSetMeshHandle(frameIndex, frames),
    bossLightningDischarge: (targetName, lightning) => {
      discharges.push({
        targetName,
        tempEntity: lightning.tempEntity,
      });
    },
    bossLightningElectrodesReady: () => true,
    createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
    monsterRuntimeEnabled: () => true,
  });
  controller.spawn([boss], {
    models: {
      "progs/boss.mdl": monsterAnimationModel("monster_boss", "progs/boss.mdl"),
    },
  }, null);
  const mounted = controller.debugMountEntity(boss.index);
  const activated = controller.activate(boss.index, { skill: 1 });
  manualClock.advanceFrames(2, 100);
  const firstShock = controller.triggerBossLightning({ skill: 1 });
  manualClock.advanceFrames(2, 100);
  const secondShock = controller.triggerBossLightning({ skill: 1 });
  manualClock.advanceFrames(2, 100);
  const thirdShock = controller.triggerBossLightning({ skill: 1 });
  manualClock.advanceFrames(2, 100);
  controller.clear();
  return {
    activated,
    discharges,
    firstShock,
    frames,
    mounted,
    ok: mounted &&
      activated &&
      firstShock &&
      secondShock &&
      thirdShock &&
      frames.includes(0) &&
      frames.includes(80) &&
      frames.includes(90) &&
      frames.includes(48) &&
      discharges.length === 3 &&
      discharges.every((item) => item.targetName === "lightning" && item.tempEntity === "TE_LIGHTNING3"),
    secondShock,
    thirdShock,
  };
}

function auditMonsterReactionMode(fixture, mode, branches) {
  const expectedFrames = reactionBranchStartFrames(fixture.classname, branches);
  const sampleCount = expectedFrames.length > 1 ? 64 : 1;
  const seenFrames = new Set();
  const failures = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const index = reactionEntityIndex(fixture.classname, mode, sample);
    const frames = [];
    const controller = createController({
      addMesh: (_entity, _model, frameIndex = 0) => createFakeFrameSetMeshHandle(frameIndex, frames),
      createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
      monsterRuntimeEnabled: () => true,
    });
    const entity = {
      index,
      classname: fixture.classname,
      origin: { x: index, y: 0, z: 0 },
      properties: {
        classname: fixture.classname,
        origin: `${index} 0 0`,
      },
    };
    controller.spawn([entity], monsterAnimationModelLibrary, null);
    const mounted = controller.debugMountEntity(index);
    const frameOffset = frames.length;
    const acted = mode === "pain"
      ? controller.damage(index, guaranteedPainDamage(fixture))
      : controller.damage(index, fixture.health);
    const observedFrame = frames.slice(frameOffset).find((frameIndex) => expectedFrames.includes(frameIndex));
    if (observedFrame !== undefined) seenFrames.add(observedFrame);
    if (!mounted || !acted || observedFrame === undefined) {
      failures.push({
        index,
        mounted,
        acted,
        frames: frames.slice(frameOffset),
      });
    }
    controller.clear();
  }
  return {
    classname: fixture.classname,
    mode,
    expectedFrames,
    seenFrames: [...seenFrames].sort((a, b) => a - b),
    ok: failures.length === 0 && expectedFrames.every((frameIndex) => seenFrames.has(frameIndex)),
    ...(failures.length ? { failures: failures.slice(0, 3) } : {}),
  };
}

function reactionBranchStartFrames(classname, branches) {
  return [
    ...new Set(
      branches
        .map((branch) => QUAKE_MONSTER_LOGIC[classname]?.chains?.[branch.chain]?.states?.[0]?.frameIndex)
        .filter((frameIndex) => typeof frameIndex === "number"),
    ),
  ].sort((a, b) => a - b);
}

function guaranteedPainDamage(fixture) {
  const scale = QUAKE_MONSTER_LOGIC[fixture.classname]?.reactionProfile?.pain?.flinchDamageRandomScale;
  const preferredDamage = typeof scale === "number" ? Math.ceil(scale) + 1 : 1;
  return Math.max(1, Math.min(fixture.health - 1, preferredDamage));
}

function reactionEntityIndex(classname, mode, sample) {
  const classnameIndex = monsterSpawnHealthFixtures.findIndex((fixture) => fixture.classname === classname);
  const modeOffset = mode === "pain" ? 0 : 500;
  return 5000 + classnameIndex * 1000 + modeOffset + sample;
}

function vectorAlmostEqual(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => Math.abs(value - expected[index]) < 1e-9);
}

function monsterAnimationModel(classname, modelPath) {
  const frameCount = maxMonsterFrameIndex(classname) + 1;
  return {
    source: modelPath,
    bounds: {
      min: [-0.5, -0.5, -0.75],
      max: [0.5, 0.5, 1.25],
    },
    animationFrames: Array.from({ length: frameCount }, (_, frameIndex) => ({ name: `${classname}_${frameIndex}` })),
    animationFrameSet: {
      frames: [],
      leafCount: 0,
      renderBundle: {},
    },
  };
}

function staticDeathOutputModel(modelPath) {
  return {
    source: modelPath,
    bounds: {
      min: [-0.25, -0.25, -0.25],
      max: [0.25, 0.25, 0.25],
    },
  };
}

function maxMonsterFrameIndex(classname) {
  const chains = Object.values(QUAKE_MONSTER_LOGIC[classname]?.chains ?? {});
  return Math.max(
    0,
    ...chains.flatMap((chain) => chain.states.map((state) => state.frameIndex).filter((frameIndex) => typeof frameIndex === "number")),
  );
}

function captureSpawn(callback) {
  try {
    callback();
    return { threw: false, message: "" };
  } catch (error) {
    return { threw: true, message: String(error?.message ?? error) };
  }
}

function installManualRuntimeClock() {
  let now = 0;
  let nextRafId = 1;
  const rafCallbacks = new Map();
  const nativePerformance = globalThis.performance ?? {};
  globalThis.performance = {
    ...nativePerformance,
    mark: typeof nativePerformance.mark === "function" ? nativePerformance.mark.bind(nativePerformance) : () => undefined,
    now: () => now,
  };
  globalThis.window = {
    __chromeCaptureTraceSampling: false,
    __cssQuakeDebugDomMetadata: false,
    cancelAnimationFrame: (id) => {
      rafCallbacks.delete(id);
    },
    clearTimeout: () => undefined,
    requestAnimationFrame: (callback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    },
    setTimeout: () => 0,
  };
  return {
    advanceFrames(count, stepMs) {
      for (let frame = 0; frame < count; frame += 1) {
        const callbacks = [...rafCallbacks.entries()];
        rafCallbacks.clear();
        if (!callbacks.length) return;
        now += stepMs;
        for (const [, callback] of callbacks) callback(now);
      }
    },
  };
}

function installWindowTimeoutCapture() {
  const nativeSetTimeout = globalThis.window.setTimeout;
  const nativeClearTimeout = globalThis.window.clearTimeout;
  const timers = new Map();
  const scheduledDelays = [];
  let nextTimerId = 1;

  globalThis.window.setTimeout = (callback, delay = 0) => {
    const id = nextTimerId++;
    scheduledDelays.push(delay);
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.window.clearTimeout = (id) => {
    timers.delete(id);
  };

  return {
    delays: () => [...scheduledDelays],
    flushAll: () => {
      const callbacks = [...timers.values()].sort((a, b) => a.delay - b.delay);
      timers.clear();
      for (const { callback } of callbacks) callback();
    },
    restore: () => {
      globalThis.window.setTimeout = nativeSetTimeout;
      globalThis.window.clearTimeout = nativeClearTimeout;
    },
  };
}

function createFakeFrameSetMeshHandle(frameIndex, frames) {
  let activeFrameIndex = frameIndex;
  frames.push(activeFrameIndex);
  return {
    element: createFakeElement(),
    getFrameIndex: () => activeFrameIndex,
    remove: () => undefined,
    setFrameIndex: (nextFrameIndex) => {
      activeFrameIndex = nextFrameIndex;
      frames.push(activeFrameIndex);
      return true;
    },
    setTransform: () => undefined,
  };
}

function createFakeFrameTransformMeshHandle(frameIndex, frames, transforms) {
  let activeFrameIndex = frameIndex;
  frames.push(activeFrameIndex);
  return {
    element: createFakeElement(),
    getFrameIndex: () => activeFrameIndex,
    remove: () => undefined,
    setFrameIndex: (nextFrameIndex) => {
      activeFrameIndex = nextFrameIndex;
      frames.push(activeFrameIndex);
      return true;
    },
    setTransform: (transform) => {
      transforms.push(transform);
    },
  };
}

function createFakeTransformMeshHandle(transforms) {
  return {
    element: createFakeElement(),
    remove: () => undefined,
    setTransform: (transform) => {
      transforms.push(transform);
    },
  };
}

function maxHorizontalTransformMove(transforms) {
  const initial = transforms[0]?.position ?? [0, 0, 0];
  return transforms.reduce((max, transform) => {
    const position = transform.position ?? initial;
    return Math.max(max, Math.hypot(position[0] - initial[0], position[1] - initial[1]));
  }, 0);
}

function createFakeElement() {
  const classes = new Set();
  return {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    dataset: {},
    isConnected: true,
    querySelectorAll: () => [],
    removeAttribute: () => undefined,
    setAttribute: () => undefined,
    style: {},
  };
}

function runMoverMonsterBoundsCase() {
  const nearMonster = {
    ...combatSoldier,
    index: 130,
    origin: { x: 0, y: 0, z: 0 },
    properties: { classname: "monster_army", origin: "0 0 0" },
  };
  const farMonster = {
    ...combatSoldier,
    index: 131,
    origin: { x: 8, y: 0, z: 0 },
    properties: { classname: "monster_army", origin: "8 0 0" },
  };
  const controller = createController();
  controller.spawn(
    [nearMonster, farMonster],
    { models: { "progs/soldier.mdl": soldierModel } },
    null,
  );
  const nearBounds = {
    min: [-0.5, -0.5, 0],
    max: [0.5, 0.5, 1],
  };
  const farBounds = {
    min: [7.5, -0.5, 0],
    max: [8.5, 0.5, 1],
  };
  const firstHit = controller.firstMonsterOverlappingBounds(nearBounds);
  const killed = firstHit !== null ? controller.damage(firstHit, 90) : false;
  const pushDelta = [2, 0, 0];
  const pushedBounds = offsetBounds(nearBounds, pushDelta);
  const pushController = createController({ hasLineOfSight: () => true });
  pushController.spawn(
    [
      {
        ...combatSoldier,
        index: 132,
        origin: { x: 0, y: 0, z: 0 },
        properties: { classname: "monster_army", origin: "0 0 0" },
      },
    ],
    { models: { "progs/soldier.mdl": soldierModel } },
    null,
  );
  const pushBlocker = pushController.pushMonsterBlockers(nearBounds, pushDelta);
  const afterPushOriginalHit = pushController.firstMonsterOverlappingBounds(nearBounds);
  const afterPushMovedHit = pushController.firstMonsterOverlappingBounds(pushedBounds);
  pushController.clear();

  const blockedPushController = createController({ hasLineOfSight: () => false });
  blockedPushController.spawn(
    [
      {
        ...combatSoldier,
        index: 133,
        origin: { x: 0, y: 0, z: 0 },
        properties: { classname: "monster_army", origin: "0 0 0" },
      },
    ],
    { models: { "progs/soldier.mdl": soldierModel } },
    null,
  );
  const blockedPushBlocker = blockedPushController.pushMonsterBlockers(nearBounds, pushDelta);
  const afterBlockedPushHit = blockedPushController.firstMonsterOverlappingBounds(nearBounds);
  blockedPushController.clear();

  const solidPushController = createController({
    contentsAt: ([x]) => (x > 1 ? QUAKE_TEST_CONTENTS_SOLID : 0),
    hasLineOfSight: () => true,
  });
  solidPushController.spawn(
    [
      {
        ...combatSoldier,
        index: 134,
        origin: { x: 0, y: 0, z: 0 },
        properties: { classname: "monster_army", origin: "0 0 0" },
      },
    ],
    { models: { "progs/soldier.mdl": soldierModel } },
    null,
  );
  const solidPushBlocker = solidPushController.pushMonsterBlockers(nearBounds, pushDelta);
  const afterSolidPushHit = solidPushController.firstMonsterOverlappingBounds(nearBounds);
  solidPushController.clear();
  return {
    firstHit,
    killed,
    afterKillHit: controller.firstMonsterOverlappingBounds(nearBounds),
    farHit: controller.firstMonsterOverlappingBounds(farBounds),
    pushBlocker,
    afterPushOriginalHit,
    afterPushMovedHit,
    blockedPushBlocker,
    afterBlockedPushHit,
    solidPushBlocker,
    afterSolidPushHit,
  };
}

function offsetBounds(bounds, delta) {
  return {
    min: [
      bounds.min[0] + delta[0],
      bounds.min[1] + delta[1],
      bounds.min[2] + delta[2],
    ],
    max: [
      bounds.max[0] + delta[0],
      bounds.max[1] + delta[1],
      bounds.max[2] + delta[2],
    ],
  };
}

function createController(overrides = {}) {
  return createQuakeShootablesController({
    addMesh: () => null,
    createMonsterStateRunner: () => null,
    damagePlayer: () => false,
    fireTarget: () => undefined,
    floorAt: flatFloorAt,
    getPlayerEyeHeight: () => 1,
    getPlayerForward: () => [0, 1, 0],
    getPlayerOrigin: () => [0, 0, 0],
    hasLineOfSight: () => false,
    isInPlayerView: () => true,
    leafIndexAt: () => undefined,
    monsterRuntimeEnabled: () => false,
    pixelate: () => undefined,
    pointToPoly: (point) => [point.x, point.y, point.z],
    schedulePresentationResync: () => undefined,
    shouldSpawn: () => true,
    visibleLeavesAt: () => null,
    ...overrides,
  });
}

function flatFloorAt(_x, _y, maxZ = Infinity, minZ = -Infinity) {
  return minZ <= 0 && maxZ >= 0 ? 0 : null;
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
