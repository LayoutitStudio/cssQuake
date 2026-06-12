import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const runtimeAppPath = path.join(projectRoot, "src/App.ts");
const runtimeMoverInteractionPath = path.join(projectRoot, "src/runtime/app/moverInteractionFlow.ts");
const runtimeConstantsPath = path.join(projectRoot, "src/runtime/constants.ts");
const runtimeMoversPath = path.join(projectRoot, "src/runtime/movers.ts");
const generatedMonsterLogicPath = path.join(projectRoot, "src/generated/quakeMonsterLogic.ts");
const generatedMapDir = path.join(projectRoot, "build/generated/public/q");

const runtimeAppSource = fs.readFileSync(runtimeAppPath, "utf8");
const runtimeMoverInteractionSource = fs.readFileSync(runtimeMoverInteractionPath, "utf8");
const clock = installManualRuntimeClock();
const { QUAKE_COLLISION_UNIT_SCALE } = await importBundledModule(runtimeConstantsPath);
const {
  createQuakeMoversController,
  quakeMoverBlockDamage,
  quakeMoverBlockDamageCooldownMs,
} = await importBundledModule(runtimeMoversPath);
const { QUAKE_MONSTER_LOGIC } = await importBundledModule(generatedMonsterLogicPath);
const QUAKE_SHOOTABLE_COLLISION_EPSILON = 0.5 * QUAKE_COLLISION_UNIT_SCALE;

const checks = [];

const doorOpening = runBlockedDoorOpeningCase();
checks.push([
  doorOpening.playerBlocks === 1 &&
    doorOpening.mode === "closing" &&
    sameArray(doorOpening.offset, [0, 0, 0]) &&
    doorOpening.blockDamage === 2 &&
    doorOpening.blockCooldownMs === 0,
  `opening func_door block should roll back, call block handling, reverse toward closed, and use QuakeC dmg default, got ${
    JSON.stringify(doorOpening)
  }`,
]);

const doorClosing = runBlockedDoorClosingCase();
checks.push([
  doorClosing.playerBlocks === 1 &&
    doorClosing.mode === "opening" &&
    doorClosing.waitUntilMs > doorClosing.nowMs &&
    sameArray(doorClosing.offset, doorClosing.openOffset),
  `closing func_door block should roll back, reopen, and set the short QuakeC reopen hold, got ${
    JSON.stringify(doorClosing)
  }`,
]);

const doorNegativeWait = runBlockedDoorNegativeWaitCase();
checks.push([
  doorNegativeWait.playerBlocks === 1 &&
    doorNegativeWait.mode === "opening" &&
    sameArray(doorNegativeWait.offset, [0, 0, 0]) &&
    doorNegativeWait.blockDamage === 2 &&
    doorNegativeWait.blockCooldownMs === 0,
  `negative-wait func_door block should keep crushing without reversing, got ${
    JSON.stringify(doorNegativeWait)
  }`,
]);

const secretDoorOpening = runBlockedSecretDoorOpeningCase();
checks.push([
  secretDoorOpening.playerBlocks === 1 &&
    secretDoorOpening.mode === "opening" &&
    sameArray(secretDoorOpening.offset, [0, 0, 0]) &&
    secretDoorOpening.blockDamage === 2 &&
    secretDoorOpening.blockCooldownMs === 500 &&
    secretDoorOpening.prebakedSecretDoor === true,
  `func_door_secret block should consume prebaked secret_blocked no-reverse policy, got ${
    JSON.stringify(secretDoorOpening)
  }`,
]);

const platOpening = runBlockedPlatOpeningCase();
checks.push([
  platOpening.playerBlocks === 1 &&
    platOpening.mode === "closing" &&
    sameArray(platOpening.offset, platOpening.closedOffset) &&
    platOpening.blockDamage === 1 &&
    platOpening.blockCooldownMs === 0,
  `opening func_plat block should roll back, reverse downward, and use plat_crush damage, got ${
    JSON.stringify(platOpening)
  }`,
]);

const trainOpening = runBlockedTrainOpeningCase();
checks.push([
  trainOpening.playerBlocks === 1 &&
    trainOpening.mode === "opening" &&
    sameArray(trainOpening.offset, trainOpening.closedOffset) &&
    trainOpening.blockDamage === 2 &&
    trainOpening.blockCooldownMs === 500,
  `func_train block should roll back without reversing and use train_blocked damage, got ${
    JSON.stringify(trainOpening)
  }`,
]);

const buttonOpening = runBlockedButtonOpeningCase();
checks.push([
  buttonOpening.playerBlocks === 1 &&
    buttonOpening.mode === "opening" &&
    sameArray(buttonOpening.offset, [0, 0, 0]),
  `func_button blocked callback is a source no-op; controller should roll back without mode reversal, got ${
    JSON.stringify(buttonOpening)
  }`,
]);

const appMonsterBlockerGate = inspectAppMonsterBlockerGate();
checks.push([
  appMonsterBlockerGate.usesSharedGate &&
    appMonsterBlockerGate.usesShootablePushQuery &&
    appMonsterBlockerGate.allowsDoor &&
    appMonsterBlockerGate.allowsSecretDoor &&
    appMonsterBlockerGate.allowsPlat &&
    appMonsterBlockerGate.allowsTrain &&
    !appMonsterBlockerGate.allowsButton,
  `App monster blocker gate should support active doors/secrets/plats/trains through the shared shootable push/block query and keep buttons skipped, got ${
    JSON.stringify(appMonsterBlockerGate)
  }`,
]);

const nonTrainMonsterCandidates = runNonTrainMonsterBlockerCandidateCases();
checks.push([
  nonTrainMonsterCandidates.present &&
    nonTrainMonsterCandidates.candidatePairCount === 5 &&
    nonTrainMonsterCandidates.uniqueBlockedMoverCount === 4 &&
    nonTrainMonsterCandidates.blockedPairCount === 5 &&
    nonTrainMonsterCandidates.allDamageSourceBacked &&
    nonTrainMonsterCandidates.allUnthrottled &&
    nonTrainMonsterCandidates.allNoReverse,
  `map-present non-train monster blocker candidates should block active negative-wait doors without reversing, got ${
    JSON.stringify(nonTrainMonsterCandidates)
  }`,
]);

const e1m4TrainCandidate = runE1m4TrainMonsterPusherCandidateCase();
checks.push([
  e1m4TrainCandidate.present &&
    e1m4TrainCandidate.trainDamage === 90 &&
    e1m4TrainCandidate.triggerCounterCount === 2 &&
    e1m4TrainCandidate.travelDirection === "down" &&
    e1m4TrainCandidate.closedOverlap === false &&
    e1m4TrainCandidate.currentOverlap === false &&
    e1m4TrainCandidate.openOverlap === true,
  `e1m4 train/monster pusher candidate should stay focused and source-explained, got ${
    JSON.stringify(e1m4TrainCandidate)
  }`,
]);

const e1m6SideDoorCandidate = runE1m6SideDoorMonsterPusherCandidateCase();
checks.push([
  e1m6SideDoorCandidate.present &&
    e1m6SideDoorCandidate.doorDamage === 2 &&
    e1m6SideDoorCandidate.travelDirection === "east" &&
    e1m6SideDoorCandidate.currentOverlapCount === 0 &&
    e1m6SideDoorCandidate.closedOverlapCount === 0 &&
    e1m6SideDoorCandidate.openOverlapCount === 3 &&
    e1m6SideDoorCandidate.travelOverlapCount === 3 &&
    e1m6SideDoorCandidate.acceptedMoveTravelOverlapCount === 3,
  `e1m6 side-door/ogre pusher candidate should stay focused and geometry-pinned, got ${
    JSON.stringify(e1m6SideDoorCandidate)
  }`,
]);

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

console.log(`Mover runtime audit smoke passed: ${checks.length} checks.`);

function runBlockedDoorOpeningCase() {
  let playerBlocks = 0;
  const controller = createController({
    playerBlocks: () => {
      playerBlocks++;
      return true;
    },
  });
  const entity = moverEntity(101, "func_door", { speed: "100", wait: "3" });
  controller.setup([entity], [brushModel(1)], { x: 0, y: 0, z: 0 }, null);
  controller.activateEntity(entity.index);
  clock.advanceFrames(1, 100);
  const state = controller.get(entity.index);
  controller.clear();
  return {
    blockDamage: state ? quakeMoverBlockDamage(state) : null,
    blockCooldownMs: state ? quakeMoverBlockDamageCooldownMs(state) : null,
    mode: state?.mode,
    offset: roundVec(state?.offset),
    playerBlocks,
  };
}

function runBlockedDoorClosingCase() {
  let playerBlocks = 0;
  let block = false;
  const controller = createController({
    playerBlocks: () => {
      if (!block) return false;
      playerBlocks++;
      return true;
    },
  });
  const entity = moverEntity(102, "func_door", { speed: "1000", wait: "0" });
  controller.setup([entity], [smallBrushModel(1)], { x: 0, y: 0, z: 0 }, null);
  controller.activateEntity(entity.index);
  clock.advanceFrames(2, 100);
  block = true;
  clock.advanceFrames(1, 100);
  const state = controller.get(entity.index);
  const result = {
    blockCooldownMs: state ? quakeMoverBlockDamageCooldownMs(state) : null,
    mode: state?.mode,
    nowMs: performance.now(),
    offset: roundVec(state?.offset),
    openOffset: roundVec(state?.openOffset),
    playerBlocks,
    waitUntilMs: state?.waitUntil ?? 0,
  };
  controller.clear();
  return result;
}

function runBlockedDoorNegativeWaitCase() {
  let playerBlocks = 0;
  const controller = createController({
    playerBlocks: () => {
      playerBlocks++;
      return true;
    },
  });
  const entity = moverEntity(108, "func_door", { speed: "100", wait: "-1" });
  controller.setup([entity], [brushModel(1)], { x: 0, y: 0, z: 0 }, null);
  controller.activateEntity(entity.index);
  clock.advanceFrames(1, 100);
  const state = controller.get(entity.index);
  const result = {
    blockDamage: state ? quakeMoverBlockDamage(state) : null,
    blockCooldownMs: state ? quakeMoverBlockDamageCooldownMs(state) : null,
    mode: state?.mode,
    offset: roundVec(state?.offset),
    playerBlocks,
  };
  controller.clear();
  return result;
}

function runBlockedSecretDoorOpeningCase() {
  let playerBlocks = 0;
  const controller = createController({
    playerBlocks: () => {
      playerBlocks++;
      return true;
    },
  });
  const entity = moverEntity(109, "func_door_secret", { angle: "90", spawnflags: "1" });
  controller.setup([entity], [brushModel(1)], { x: 0, y: 0, z: 0 }, {
    entities: [{
      entityIndex: entity.index,
      resolvedMover: {
        kind: "func_door_secret",
        blocker: {
          damage: 2,
          damageExpression: "self.dmg",
          damageField: "dmg",
          reverses: false,
          sourceFunction: "secret_blocked",
          throttleExpression: "time + 0.5",
          throttleField: "attack_finished",
          throttleSeconds: 0.5,
        },
        callbacks: { blocked: "secret_blocked" },
      },
    }],
  });
  controller.activateEntity(entity.index);
  clock.advanceFrames(1, 100);
  const state = controller.get(entity.index);
  const result = {
    blockDamage: state ? quakeMoverBlockDamage(state) : null,
    blockCooldownMs: state ? quakeMoverBlockDamageCooldownMs(state) : null,
    mode: state?.mode,
    offset: roundVec(state?.offset),
    playerBlocks,
    prebakedSecretDoor: Boolean(state?.prebakedSecretDoor),
  };
  controller.clear();
  return result;
}

function runBlockedPlatOpeningCase() {
  let playerBlocks = 0;
  const controller = createController({
    playerBlocks: () => {
      playerBlocks++;
      return true;
    },
  });
  const entity = moverEntity(103, "func_plat", { speed: "150" });
  controller.setup([entity], [tallBrushModel(1)], { x: 0, y: 0, z: 0 }, null);
  controller.activateEntity(entity.index);
  clock.advanceFrames(1, 100);
  const state = controller.get(entity.index);
  const result = {
    blockDamage: state ? quakeMoverBlockDamage(state) : null,
    blockCooldownMs: state ? quakeMoverBlockDamageCooldownMs(state) : null,
    closedOffset: roundVec(state?.closedOffset),
    mode: state?.mode,
    offset: roundVec(state?.offset),
    playerBlocks,
  };
  controller.clear();
  return result;
}

function runBlockedTrainOpeningCase() {
  let playerBlocks = 0;
  const controller = createController({
    playerBlocks: () => {
      playerBlocks++;
      return true;
    },
  });
  const train = moverEntity(104, "func_train", { dmg: "2", speed: "100", target: "path_a" });
  const pathA = pathCornerEntity(105, "path_a", "path_b", [0, 0, 0]);
  const pathB = pathCornerEntity(106, "path_b", undefined, [64, 0, 0]);
  controller.setup([train, pathA, pathB], [brushModel(1)], { x: 0, y: 0, z: 0 }, null);
  clock.advanceFrames(1, 100);
  const state = controller.get(train.index);
  const result = {
    blockDamage: state ? quakeMoverBlockDamage(state) : null,
    blockCooldownMs: state ? quakeMoverBlockDamageCooldownMs(state) : null,
    closedOffset: roundVec(state?.closedOffset),
    mode: state?.mode,
    offset: roundVec(state?.offset),
    playerBlocks,
  };
  controller.clear();
  return result;
}

function runBlockedButtonOpeningCase() {
  let playerBlocks = 0;
  const controller = createController({
    playerBlocks: () => {
      playerBlocks++;
      return true;
    },
  });
  const entity = moverEntity(107, "func_button", { speed: "40" });
  controller.setup([entity], [brushModel(1)], { x: 0, y: 0, z: 0 }, null);
  controller.activateEntity(entity.index);
  clock.advanceFrames(1, 100);
  const state = controller.get(entity.index);
  const result = {
    blockDamage: state ? quakeMoverBlockDamage(state) : null,
    mode: state?.mode,
    offset: roundVec(state?.offset),
    playerBlocks,
  };
  controller.clear();
  return result;
}

function runE1m4TrainMonsterPusherCandidateCase() {
  const mapPath = path.join(generatedMapDir, "e1m4.json");
  if (!fs.existsSync(mapPath)) return { present: false, reason: "missing-e1m4-json" };
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const pivot = map.collision?.pivot ?? map.visibility?.pivot ?? { x: 0, y: 0, z: 0 };
  const controller = createController();
  controller.setup(map.entities ?? [], map.collision?.models ?? [], pivot, map.gameLogic ?? null);

  const train = controller.get(57);
  const entitiesByIndex = new Map((map.entities ?? []).map((entity) => [entity.index, entity]));
  const knight = entitiesByIndex.get(552);
  const targetCorner = (map.entities ?? []).find((entity) =>
    entity.classname === "path_corner" &&
    entity.properties?.targetname === knight?.properties?.target
  );
  const triggerCounter = (map.entities ?? []).find((entity) =>
    entity.classname === "trigger_counter" &&
    entity.properties?.target === train?.entity.properties?.targetname
  );

  if (!train || !knight?.origin || !targetCorner?.origin) {
    controller.clear();
    return {
      present: false,
      reason: "missing-train-knight-or-target-corner",
      hasTrain: Boolean(train),
      hasKnight: Boolean(knight?.origin),
      hasTargetCorner: Boolean(targetCorner?.origin),
    };
  }

  const spawnProfile = QUAKE_MONSTER_LOGIC[knight.classname]?.spawnProfile;
  if (!spawnProfile?.bounds) {
    controller.clear();
    return { present: false, reason: "missing-knight-spawn-profile" };
  }

  const bounds = scaledSpawnBounds(spawnProfile);
  const targetOrigin = quakePointToPoly(targetCorner.origin, pivot);
  const monsterAtPathTarget = boundsAtOrigin(targetOrigin, bounds);
  const currentBounds = moverBoundsForState(train, train.offset, pivot);
  const closedBounds = moverBoundsForState(train, train.closedOffset, pivot);
  const openBounds = moverBoundsForState(train, train.openOffset, pivot);
  const result = {
    present: true,
    map: "e1m4",
    trainEntity: train.entity.index,
    trainClassname: train.entity.classname,
    monsterEntity: knight.index,
    monsterClassname: knight.classname,
    targetCornerEntity: targetCorner.index,
    triggerCounterEntity: triggerCounter?.index ?? null,
    triggerCounterCount: Number(triggerCounter?.properties?.count ?? 0) || 0,
    trainDamage: quakeMoverBlockDamage(train),
    travelDirection: dominantTravelDirection(train.closedOffset, train.openOffset),
    travelUnits: roundNumber(distance3(train.closedOffset, train.openOffset) / QUAKE_COLLISION_UNIT_SCALE),
    currentOverlap: boundsOverlap(monsterAtPathTarget, currentBounds),
    closedOverlap: boundsOverlap(monsterAtPathTarget, closedBounds),
    openOverlap: boundsOverlap(monsterAtPathTarget, openBounds),
    targetOrigin: roundVec(targetOrigin),
    monsterAtPathTarget: roundBounds(monsterAtPathTarget),
    trainClosedBounds: roundBounds(closedBounds),
    trainOpenBounds: roundBounds(openBounds),
  };
  controller.clear();
  return result;
}

function runE1m6SideDoorMonsterPusherCandidateCase() {
  const mapPath = path.join(generatedMapDir, "e1m6.json");
  if (!fs.existsSync(mapPath)) return { present: false, reason: "missing-e1m6-json" };
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const pivot = map.collision?.pivot ?? map.visibility?.pivot ?? { x: 0, y: 0, z: 0 };
  const controller = createController();
  controller.setup(map.entities ?? [], map.collision?.models ?? [], pivot, map.gameLogic ?? null);

  const door = controller.get(264);
  const monsterIndexes = [168, 169, 242];
  const entitiesByIndex = new Map((map.entities ?? []).map((entity) => [entity.index, entity]));
  const monsters = monsterIndexes.map((index) => entitiesByIndex.get(index));
  const missingMonsterIndexes = monsterIndexes.filter((_, index) => !monsters[index]?.origin);
  const missingBoundsIndexes = monsters
    .map((monster, index) => QUAKE_MONSTER_LOGIC[monster?.classname]?.spawnProfile?.bounds ? null : monsterIndexes[index])
    .filter((index) => index !== null);

  if (!door || missingMonsterIndexes.length || missingBoundsIndexes.length) {
    controller.clear();
    return {
      present: false,
      reason: "missing-door-monsters-or-bounds",
      hasDoor: Boolean(door),
      missingMonsterIndexes,
      missingBoundsIndexes,
    };
  }

  const currentBounds = moverBoundsForState(door, door.offset, pivot);
  const closedBounds = moverBoundsForState(door, door.closedOffset, pivot);
  const openBounds = moverBoundsForState(door, door.openOffset, pivot);
  const travelBounds = unionBounds(closedBounds, openBounds);
  const monsterResults = monsters.map((monster) => {
    const spawnProfile = QUAKE_MONSTER_LOGIC[monster.classname].spawnProfile;
    const bounds = scaledSpawnBounds(spawnProfile);
    const spawnOrigin = quakePointToPoly(monster.origin, pivot);
    const spawnBounds = boundsAtOrigin(spawnOrigin, bounds);
    const acceptedMoveOrigin = [spawnOrigin[0] + QUAKE_COLLISION_UNIT_SCALE * 2, spawnOrigin[1], spawnOrigin[2]];
    const acceptedMoveBounds = boundsAtOrigin(acceptedMoveOrigin, bounds);
    return {
      entity: monster.index,
      classname: monster.classname,
      spawnOrigin: roundVec(spawnOrigin),
      currentOverlap: boundsOverlap(spawnBounds, currentBounds),
      closedOverlap: boundsOverlap(spawnBounds, closedBounds),
      openOverlap: boundsOverlap(spawnBounds, openBounds),
      travelOverlap: boundsOverlap(spawnBounds, travelBounds),
      acceptedMoveTravelOverlap: boundsOverlap(acceptedMoveBounds, travelBounds),
    };
  });
  const count = (field) => monsterResults.filter((result) => result[field]).length;
  const result = {
    present: true,
    map: "e1m6",
    doorEntity: door.entity.index,
    doorClassname: door.entity.classname,
    monsterEntities: monsterResults.map((monster) => monster.entity),
    doorDamage: quakeMoverBlockDamage(door),
    travelDirection: dominantTravelDirection(door.closedOffset, door.openOffset),
    travelUnits: roundNumber(distance3(door.closedOffset, door.openOffset) / QUAKE_COLLISION_UNIT_SCALE),
    currentOverlapCount: count("currentOverlap"),
    closedOverlapCount: count("closedOverlap"),
    openOverlapCount: count("openOverlap"),
    travelOverlapCount: count("travelOverlap"),
    acceptedMoveTravelOverlapCount: count("acceptedMoveTravelOverlap"),
    doorClosedBounds: roundBounds(closedBounds),
    doorOpenBounds: roundBounds(openBounds),
    doorTravelBounds: roundBounds(travelBounds),
    monsters: monsterResults,
  };
  controller.clear();
  return result;
}

function runNonTrainMonsterBlockerCandidateCases() {
  const cases = [
    { mapName: "e1m3", moverEntity: 213, monsterEntity: 214 },
    { mapName: "e1m3", moverEntity: 213, monsterEntity: 215 },
    { mapName: "e1m3", moverEntity: 220, monsterEntity: 222 },
    { mapName: "e1m4", moverEntity: 277, monsterEntity: 278 },
    { mapName: "e1m6", moverEntity: 264, monsterEntity: 242 },
  ];
  const results = cases.map(runNonTrainMonsterBlockerCandidateCase);
  const present = results.every((result) => result.present);
  const blocked = results.filter((result) => result.blocked);
  const uniqueMovers = new Set(blocked.map((result) => `${result.map}:${result.moverEntity}`));
  return {
    present,
    candidatePairCount: results.length,
    blockedPairCount: blocked.length,
    uniqueBlockedMoverCount: uniqueMovers.size,
    allDamageSourceBacked: present && results.every((result) => result.blockDamage === 2),
    allUnthrottled: present && results.every((result) => result.blockCooldownMs === 0),
    allNoReverse: present && results.every((result) => result.finalMode === "opening"),
    results,
  };
}

function runNonTrainMonsterBlockerCandidateCase(candidate) {
  const mapPath = path.join(generatedMapDir, `${candidate.mapName}.json`);
  if (!fs.existsSync(mapPath)) return { ...candidate, present: false, reason: "missing-map-json" };
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const pivot = map.collision?.pivot ?? map.visibility?.pivot ?? { x: 0, y: 0, z: 0 };
  const entitiesByIndex = new Map((map.entities ?? []).map((entity) => [entity.index, entity]));
  const moverEntity = entitiesByIndex.get(candidate.moverEntity);
  const monsterEntity = entitiesByIndex.get(candidate.monsterEntity);
  const spawnProfile = monsterEntity ? QUAKE_MONSTER_LOGIC[monsterEntity.classname]?.spawnProfile : null;
  if (!moverEntity || !monsterEntity?.origin || !spawnProfile?.bounds) {
    return {
      ...candidate,
      present: false,
      reason: "missing-mover-monster-or-bounds",
      hasMover: Boolean(moverEntity),
      hasMonster: Boolean(monsterEntity?.origin),
      hasBounds: Boolean(spawnProfile?.bounds),
    };
  }

  let blockChecks = 0;
  let blocked = false;
  let overlapOffset = null;
  const monsterBounds = boundsAtOrigin(quakePointToPoly(monsterEntity.origin, pivot), scaledSpawnBounds(spawnProfile));
  const controller = createController({
    playerBlocks: (state, nextOffset) => {
      if (state.entity.index !== candidate.moverEntity || blocked) return false;
      blockChecks++;
      const moverBounds = inflateBounds(moverBoundsForState(state, nextOffset, pivot), QUAKE_SHOOTABLE_COLLISION_EPSILON);
      if (!boundsOverlap(monsterBounds, moverBounds)) return false;
      blocked = true;
      overlapOffset = [...nextOffset];
      return true;
    },
  });
  controller.setup(map.entities ?? [], map.collision?.models ?? [], pivot, map.gameLogic ?? null);
  const mover = controller.get(candidate.moverEntity);
  if (!mover) {
    controller.clear();
    return { ...candidate, present: false, reason: "missing-runtime-mover" };
  }
  controller.activateEntity(candidate.moverEntity);
  for (let frame = 0; frame < 720 && !blocked; frame += 1) clock.advanceFrames(1, 16.67);
  const finalState = controller.get(candidate.moverEntity);
  const result = {
    present: true,
    map: candidate.mapName,
    moverEntity: candidate.moverEntity,
    moverClassname: moverEntity.classname,
    monsterEntity: candidate.monsterEntity,
    monsterClassname: monsterEntity.classname,
    blockChecks,
    blocked,
    blockDamage: finalState ? quakeMoverBlockDamage(finalState) : null,
    blockCooldownMs: finalState ? quakeMoverBlockDamageCooldownMs(finalState) : null,
    finalMode: finalState?.mode ?? null,
    finalOffset: roundVec(finalState?.offset),
    overlapOffset: roundVec(overlapOffset),
    wait: finalState?.wait ?? null,
  };
  controller.clear();
  return result;
}

function inspectAppMonsterBlockerGate() {
  const gateSource = runtimeMoverInteractionSource.match(/function moverCanBeBlockedByMonster[\s\S]*?\n  }/)?.[0] ?? "";
  const compactMoverInteractionSource = runtimeMoverInteractionSource.replace(/\s+/g, "");
  return {
    allowsButton: /state\.kind === "button"/.test(gateSource),
    allowsDoor: /state\.kind === "door"/.test(gateSource),
    allowsPlat: /state\.kind === "plat"/.test(gateSource),
    allowsSecretDoor: /state\.kind === "secret-door"/.test(gateSource),
    allowsTrain: /state\.kind === "train"/.test(gateSource),
    usesSharedGate: /!moverCanBeBlockedByMonster\(state\)/.test(runtimeMoverInteractionSource),
    usesShootablePushQuery: compactMoverInteractionSource.includes(
      "options.shootables.pushMonsterBlockers(moverBoundsAtOffsetBounds(state,nextOffset),delta)",
    ),
  };
}

function createController(overrides = {}) {
  return createQuakeMoversController({
    applyState: () => undefined,
    fireTarget: () => undefined,
    groupUnlocked: () => true,
    playerBlocks: () => false,
    ...overrides,
  });
}

function moverEntity(index, classname, properties = {}) {
  return {
    index,
    classname,
    modelIndex: 1,
    properties: {
      classname,
      model: "*1",
      ...properties,
    },
  };
}

function pathCornerEntity(index, targetname, target, origin) {
  return {
    index,
    classname: "path_corner",
    origin: { x: origin[0], y: origin[1], z: origin[2] },
    properties: {
      classname: "path_corner",
      origin: origin.join(" "),
      targetname,
      ...(target ? { target } : {}),
    },
  };
}

function brushModel(index) {
  return modelWithBounds(index, { x: 0, y: 0, z: 0 }, { x: 100, y: 64, z: 64 });
}

function smallBrushModel(index) {
  return modelWithBounds(index, { x: 0, y: 0, z: 0 }, { x: 10, y: 64, z: 64 });
}

function tallBrushModel(index) {
  return modelWithBounds(index, { x: 0, y: 0, z: 0 }, { x: 64, y: 64, z: 80 });
}

function modelWithBounds(index, mins, maxs) {
  return {
    index,
    mins,
    maxs,
    origin: { x: 0, y: 0, z: 0 },
    headNodes: [0, 0, 0, 0],
    hulls: [],
    firstFace: 0,
    faceCount: 0,
  };
}

function scaledSpawnBounds(spawnProfile) {
  return {
    min: spawnProfile.bounds.min.map((value) => value * QUAKE_COLLISION_UNIT_SCALE),
    max: spawnProfile.bounds.max.map((value) => value * QUAKE_COLLISION_UNIT_SCALE),
  };
}

function quakePointToPoly(point, pivot) {
  return [
    (point.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
    (point.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
    (point.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
  ];
}

function boundsAtOrigin(origin, bounds) {
  return {
    minX: origin[0] + bounds.min[0],
    maxX: origin[0] + bounds.max[0],
    minY: origin[1] + bounds.min[1],
    maxY: origin[1] + bounds.max[1],
    minZ: origin[2] + bounds.min[2],
    maxZ: origin[2] + bounds.max[2],
  };
}

function moverBoundsForState(state, offset, pivot) {
  return {
    minX: (state.model.mins.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE + offset[0],
    maxX: (state.model.maxs.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE + offset[0],
    minY: (state.model.mins.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE + offset[1],
    maxY: (state.model.maxs.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE + offset[1],
    minZ: (state.model.mins.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE + offset[2],
    maxZ: (state.model.maxs.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE + offset[2],
  };
}

function inflateBounds(bounds, amount) {
  return {
    minX: bounds.minX - amount,
    maxX: bounds.maxX + amount,
    minY: bounds.minY - amount,
    maxY: bounds.maxY + amount,
    minZ: bounds.minZ - amount,
    maxZ: bounds.maxZ + amount,
  };
}

function unionBounds(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function boundsOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
    a.minY <= b.maxY && a.maxY >= b.minY &&
    a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function dominantTravelDirection(from, to) {
  const delta = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const axis = Math.abs(delta[0]) > Math.abs(delta[1]) && Math.abs(delta[0]) > Math.abs(delta[2])
    ? 0
    : Math.abs(delta[1]) > Math.abs(delta[2])
      ? 1
      : 2;
  if (axis === 2) return delta[2] < 0 ? "down" : "up";
  if (axis === 1) return delta[1] < 0 ? "south" : "north";
  return delta[0] < 0 ? "west" : "east";
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function roundBounds(bounds) {
  return {
    minX: roundNumber(bounds.minX),
    maxX: roundNumber(bounds.maxX),
    minY: roundNumber(bounds.minY),
    maxY: roundNumber(bounds.maxY),
    minZ: roundNumber(bounds.minZ),
    maxZ: roundNumber(bounds.maxZ),
  };
}

function roundVec(vector) {
  return (vector ?? [NaN, NaN, NaN]).map((value) => Math.round(value * 1_000_000) / 1_000_000);
}

function roundNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 1_000_000) / 1_000_000
    : value;
}

function sameArray(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => Math.abs(value - b[index]) <= QUAKE_COLLISION_UNIT_SCALE * 0.001);
}

function installManualRuntimeClock() {
  let now = 0;
  let nextRafId = 1;
  const callbacks = new Map();
  const nativePerformance = globalThis.performance ?? {};
  globalThis.performance = {
    ...nativePerformance,
    now: () => now,
  };
  globalThis.window = {
    cancelAnimationFrame: (id) => {
      callbacks.delete(id);
    },
    requestAnimationFrame: (callback) => {
      const id = nextRafId++;
      callbacks.set(id, callback);
      return id;
    },
  };
  return {
    advanceFrames(count, stepMs) {
      for (let frame = 0; frame < count; frame += 1) {
        const pending = [...callbacks.entries()];
        callbacks.clear();
        if (!pending.length) return;
        now += stepMs;
        for (const [, callback] of pending) callback(now);
      }
    },
  };
}

async function importBundledModule(entryPath) {
  const { outputFiles } = await build({
    bundle: true,
    entryPoints: [entryPath],
    format: "esm",
    logLevel: "silent",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const source = outputFiles[0].text;
  const encoded = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}
