import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  createQuakeEnemyCombatRuntime,
  quakeEnemyWakeDelayMs,
  quakeShootableAttackHasBranchSightCheck,
  quakeShootableAttackUsesCanDamage,
  selectQuakeEnemyAttackChain,
} = await importTsModule("src/runtime/shootables/enemyCombat.ts");
const {
  QUAKE_MONSTER_HUNT_TARGET_ATTACK_DELAY_MS,
  quakeMonsterCombatProfile,
  quakeMonsterSightSoundPath,
} = await importTsModule("src/runtime/shootables/combatFacts.ts");
const {
  createQuakeRandomStream,
  createEnemyState,
} = await importTsModule("src/runtime/shootables/enemyStateFactory.ts");
const {
  QUAKE_COLLISION_UNIT_SCALE,
} = await importTsModule("src/runtime/constants.ts");

function createCombatRuntime(options = {}) {
  const sounds = [];
  const traces = [];
  const runtime = createQuakeEnemyCombatRuntime({
    damagePlayer: options.damagePlayer ?? (() => true),
    getPlayerOrigin: () => [0, 0, 0],
    hasLineOfSight: () => true,
    markTrace: (kind, shootable, details) => {
      traces.push({ kind, entityIndex: shootable.entity.index, details });
    },
    nextRandom: options.nextRandom ?? (() => 0),
    playerDamageBounds: options.playerDamageBounds ?? ((origin) => ({
      min: [origin[0] - 1, origin[1] - 1, origin[2] - 1],
      max: [origin[0] + 1, origin[1] + 1, origin[2] + 1],
    })),
    playSound: (soundPath, options) => {
      sounds.push({ soundPath, options });
      return true;
    },
    randomRange: (_enemy, min, max) => (min + max) * 0.5,
    shootableBoundsForDamage: () => ({
      min: [-1, -1, -1],
      max: [1, 1, 1],
    }),
    shootableEyeOrigin: (shootable) => shootable.origin,
    spawnProjectile: () => undefined,
    syncEnemyDatasets: () => undefined,
  });
  return { runtime, sounds, traces };
}

test("QuakeC random stream follows source seed and is shared across enemies", () => {
  const stream = createQuakeRandomStream(12345);
  const enemyA = createEnemyState(1, {}, null, 0);
  const enemyB = createEnemyState(2, {}, null, 0);
  const nextForEnemy = (_enemy) => stream.next();

  assert.equal(roundRandom(nextForEnemy(enemyA)), 0.845596313);
  assert.equal(roundRandom(nextForEnemy(enemyB)), 0.239395142);
  assert.equal(roundRandom(nextForEnemy(enemyA)), 0.85295105);
  assert.ok(Math.abs(stream.range(1000, 3000) - 2744.720459) < 0.000001);
});

test("wizard attack start plays the QuakeC Wiz_StartFast sound", () => {
  const { runtime, sounds, traces } = createCombatRuntime();
  const shootable = {
    entity: { index: 7, classname: "monster_wizard" },
    origin: [0, 0, 0],
  };

  runtime.runFrameSounds(
    shootable,
    {
      calls: ["ai_face", "Wiz_StartFast"],
      chain: "attack",
      chainCycleEnd: false,
      classname: "monster_wizard",
      events: [],
      frame: "magatt1",
      frameIndex: 29,
      movement: [],
      next: "wiz_fast2",
      sounds: [],
      stateName: "wiz_fast1",
    },
    "attack",
    1234,
  );

  assert.deepEqual(sounds.map((sound) => sound.soundPath), ["wizard/wattack.wav"]);
  assert.equal(traces[0]?.kind, "enemy-quakec-sound");
  assert.equal(traces[0]?.details.sound, "wizard/wattack.wav");
});

test("conditional QuakeC frame sounds consume shared random and only play on chance hit", () => {
  const rolls = [0.21, 0.19];
  const { runtime, sounds, traces } = createCombatRuntime({
    nextRandom: () => rolls.shift(),
  });
  const shootable = {
    enemy: createEnemyState(9, {}, null, 0),
    entity: { index: 9, classname: "monster_ogre" },
    origin: [0, 0, 0],
  };
  const step = {
    calls: ["ai_run", "sound"],
    chain: "run",
    chainCycleEnd: false,
    classname: "monster_ogre",
    conditionalSounds: [{ chance: 0.2, soundPath: "ogre/ogidle2.wav" }],
    events: [],
    frame: "run1",
    frameIndex: 25,
    movement: [],
    next: "ogre_run2",
    sounds: [],
    stateName: "ogre_run1",
  };

  runtime.runFrameSounds(shootable, step, "walk", 1000);
  runtime.runFrameSounds(shootable, step, "walk", 1100);

  assert.deepEqual(sounds.map((sound) => sound.soundPath), ["ogre/ogidle2.wav"]);
  assert.deepEqual(
    traces
      .filter((trace) => trace.kind === "enemy-quakec-conditional-sound")
      .map((trace) => ({
        chance: trace.details.chance,
        played: trace.details.played,
        roll: trace.details.roll,
        sound: trace.details.sound,
        state: trace.details.state,
      })),
    [
      {
        chance: 0.2,
        played: false,
        roll: 0.21,
        sound: "ogre/ogidle2.wav",
        state: "ogre_run1",
      },
      {
        chance: 0.2,
        played: true,
        roll: 0.19,
        sound: "ogre/ogidle2.wav",
        state: "ogre_run1",
      },
    ],
  );
});

function roundRandom(value) {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

test("monster wake delay follows source attack_finished usage", () => {
  const { runtime } = createCombatRuntime();
  const delayedMonsters = [
    "monster_army",
    "monster_demon1",
    "monster_knight",
    "monster_ogre",
    "monster_shambler",
    "monster_wizard",
    "monster_zombie",
  ];

  for (const classname of delayedMonsters) {
    const profile = quakeMonsterCombatProfile(classname);
    const enemy = createEnemyState(100, {}, null, 0);
    assert.equal(profile?.wakeDelayMs, QUAKE_MONSTER_HUNT_TARGET_ATTACK_DELAY_MS, classname);
    assert.equal(quakeEnemyWakeDelayMs(runtime, profile, enemy), QUAKE_MONSTER_HUNT_TARGET_ATTACK_DELAY_MS, classname);
  }

  assert.equal(quakeMonsterCombatProfile("monster_dog")?.wakeDelayMs, 0);
  assert.equal(quakeEnemyWakeDelayMs(runtime, quakeMonsterCombatProfile("monster_dog"), createEnemyState(100, {}, null, 0)), 0);
  assert.equal(quakeMonsterCombatProfile("monster_boss")?.wakeDelayMs, 0);
});

test("monster sight sounds follow QuakeC SightSound mapping", () => {
  assert.deepEqual(
    Object.fromEntries([
      "monster_army",
      "monster_dog",
      "monster_demon1",
      "monster_knight",
      "monster_ogre",
      "monster_shambler",
      "monster_wizard",
      "monster_zombie",
    ].map((classname) => [classname, quakeMonsterSightSoundPath(classname)])),
    {
      monster_army: "soldier/sight1.wav",
      monster_demon1: "demon/sight2.wav",
      monster_dog: "dog/dsight.wav",
      monster_knight: "knight/ksight.wav",
      monster_ogre: "ogre/ogwake.wav",
      monster_shambler: "shambler/ssight.wav",
      monster_wizard: "wizard/wsight.wav",
      monster_zombie: "zombie/z_idle.wav",
    },
  );
  assert.equal(quakeMonsterSightSoundPath("monster_boss"), null);
});

test("ogre missile branch starts QuakeC attack cooldown on selection", () => {
  const { runtime, traces } = createCombatRuntime();
  const enemy = createEnemyState(11, {}, null, 0);
  const shootable = {
    collisionBounds: {
      min: [-16, -16, -24],
      max: [16, 16, 40],
    },
    enemy,
    entity: { index: 11, classname: "monster_ogre" },
    origin: [0, 0, 0],
  };
  const now = 5000;
  const chain = selectQuakeEnemyAttackChain(
    {
      ...runtime,
      nextRandom: () => 0.99,
      randomRange: () => 2000,
    },
    shootable,
    enemy,
    300 * QUAKE_COLLISION_UNIT_SCALE,
    [300 * QUAKE_COLLISION_UNIT_SCALE, 0, 0],
    now,
  );

  assert.equal(chain, "missile");
  assert.equal(enemy.nextAttackAt, now + 3000);
  assert.equal(quakeShootableAttackHasBranchSightCheck(shootable), true);
  assert.deepEqual(
    traces
      .filter((trace) => trace.kind === "enemy-quakec-attack-cooldown" || trace.kind === "enemy-quakec-attack-select")
      .map((trace) => ({
        branchKind: trace.details.branchKind,
        chain: trace.details.chain,
        cooldownMs: trace.details.cooldownMs,
        kind: trace.kind,
        randomMs: trace.details.randomMs,
      })),
    [
      {
        branchKind: "missile",
        chain: "missile",
        cooldownMs: 3000,
        kind: "enemy-quakec-attack-cooldown",
        randomMs: 2000,
      },
      {
        branchKind: "missile",
        chain: "missile",
        cooldownMs: 3000,
        kind: "enemy-quakec-attack-select",
        randomMs: undefined,
      },
    ],
  );

  enemy.pendingAttack = {
    fireAt: Infinity,
    quakecChain: "missile",
    target: [300 * QUAKE_COLLISION_UNIT_SCALE, 0, 0],
  };
  runtime.finishAttack(
    shootable,
    {
      cooldownMs: 1000,
      cooldownRandomAddMs: 2000,
      damage: 40,
      kind: "projectile",
      range: 1000 * QUAKE_COLLISION_UNIT_SCALE,
    },
    now + 700,
  );

  assert.equal(enemy.nextAttackAt, now + 3000);
});

test("ogre melee branch uses QuakeC CanDamage offset traces", () => {
  const { runtime } = createCombatRuntime();
  const enemy = createEnemyState(12, {}, null, 0);
  const shootable = {
    collisionBounds: {
      min: [-16, -16, -24],
      max: [16, 16, 40],
    },
    enemy,
    entity: { index: 12, classname: "monster_ogre" },
    origin: [0, 0, 0],
  };
  const traceEnds = [];
  const target = [80 * QUAKE_COLLISION_UNIT_SCALE, 0, 0];
  const chain = selectQuakeEnemyAttackChain(
    {
      ...runtime,
      hasLineOfSight: (_start, end) => {
        traceEnds.push(end);
        return Math.abs(end[1]) > 0;
      },
      nextRandom: () => 0.99,
      randomRange: () => 2000,
    },
    shootable,
    enemy,
    80 * QUAKE_COLLISION_UNIT_SCALE,
    target,
    5000,
  );

  assert.equal(quakeShootableAttackUsesCanDamage(shootable), true);
  assert.equal(quakeShootableAttackHasBranchSightCheck(shootable), true);
  assert.equal(chain, "melee");
  assert.equal(traceEnds[0][0], target[0]);
  assert.equal(traceEnds[0][1], target[1]);
  assert.ok(traceEnds.some((end) => Math.abs(end[1]) === 15 * QUAKE_COLLISION_UNIT_SCALE));
});

test("zombie missile attack selects source random attack variants before cooldown", () => {
  const { runtime } = createCombatRuntime();
  const cases = [
    { roll: 0.2, chain: "attack" },
    { roll: 0.45, chain: "attack_b" },
    { roll: 0.8, chain: "attack_c" },
  ];

  for (const testCase of cases) {
    const enemy = createEnemyState(20, {}, null, 0);
    const shootable = {
      collisionBounds: {
        min: [-16, -16, -24],
        max: [16, 16, 40],
      },
      enemy,
      entity: { index: 20, classname: "monster_zombie" },
      origin: [0, 0, 0],
    };
    const draws = [
      ["chance", 0.1],
      ["chain", testCase.roll],
    ];
    const observedOrder = [];
    const now = 9000;
    const chain = selectQuakeEnemyAttackChain(
      {
        ...runtime,
        nextRandom: () => {
          const [label, value] = draws.shift();
          observedOrder.push(label);
          return value;
        },
        randomRange: () => {
          observedOrder.push("cooldown");
          return 1200;
        },
      },
      shootable,
      enemy,
      300 * QUAKE_COLLISION_UNIT_SCALE,
      [0, 300 * QUAKE_COLLISION_UNIT_SCALE, 0],
      now,
    );

    assert.equal(chain, testCase.chain);
    assert.equal(enemy.nextAttackAt, now + 1200);
    assert.deepEqual(observedOrder, ["chance", "chain", "cooldown"]);
  }
});

test("wizard wiz_fast10 applies source SUB_AttackFinished cooldown", () => {
  const { runtime, traces } = createCombatRuntime();
  const enemy = createEnemyState(12, {}, null, 0);
  const shootable = {
    enemy,
    entity: { index: 12, classname: "monster_wizard" },
    origin: [0, 0, 0],
  };

  runtime.runFrameEvents(
    shootable,
    {
      calls: ["ai_face", "SUB_AttackFinished", "WizardAttackFinished"],
      chain: "missile",
      chainCycleEnd: false,
      classname: "monster_wizard",
      events: [],
      frame: "magatt2",
      frameIndex: 30,
      movement: [],
      next: "wiz_run1",
      sounds: [],
      stateName: "wiz_fast10",
    },
    "attack",
    7000,
    {
      enemyEye: [0, 0, 0],
      playerOrigin: [1, 0, 0],
      profile: {
        cooldownMs: 0,
        damage: 9,
        kind: "projectile",
        range: 100,
      },
    },
  );

  assert.equal(enemy.nextAttackAt, 9000);
  assert.equal(traces.at(-1)?.kind, "enemy-quakec-attack-finished");
  assert.equal(traces.at(-1)?.details.cooldownMs, 2000);

  enemy.pendingAttack = {
    fireAt: Infinity,
    quakecChain: "missile",
    target: [1, 0, 0],
  };
  runtime.finishAttack(
    shootable,
    {
      cooldownMs: 0,
      damage: 9,
      kind: "projectile",
      range: 100,
    },
    7100,
  );

  assert.equal(enemy.nextAttackAt, 9000);
});

test("shambler lightning targets the Quake entity origin, not the browser eye origin", () => {
  const hits = [];
  const playerEyeOrigin = [100 * QUAKE_COLLISION_UNIT_SCALE, 0, 56 * QUAKE_COLLISION_UNIT_SCALE];
  const { runtime, traces } = createCombatRuntime({
    damagePlayer: (amount) => {
      hits.push(amount);
      return false;
    },
    playerDamageBounds: (origin) => ({
      min: [
        origin[0] - 16 * QUAKE_COLLISION_UNIT_SCALE,
        origin[1] - 16 * QUAKE_COLLISION_UNIT_SCALE,
        origin[2] - 56 * QUAKE_COLLISION_UNIT_SCALE,
      ],
      max: [
        origin[0] + 16 * QUAKE_COLLISION_UNIT_SCALE,
        origin[1] + 16 * QUAKE_COLLISION_UNIT_SCALE,
        origin[2],
      ],
    }),
  });
  const enemy = createEnemyState(31, {}, null, 0);
  const shootable = {
    enemy,
    entity: { index: 31, classname: "monster_shambler" },
    origin: [0, 0, 32 * QUAKE_COLLISION_UNIT_SCALE],
  };

  runtime.runFrameEvents(
    shootable,
    {
      calls: ["CastLightning"],
      chain: "missile",
      chainCycleEnd: false,
      classname: "monster_shambler",
      events: [{
        call: "CastLightning",
        damage: 10,
        originOffsetUnits: { up: 40 },
        rangeUnits: 600,
        target: "enemy",
        targetOffsetUnits: { up: 16 },
        type: "lightning_damage",
      }],
      frame: "magic6",
      frameIndex: 70,
      movement: [],
      next: "sham_magic9",
      sounds: [],
      stateName: "sham_magic6",
    },
    "attack",
    1200,
    {
      enemyEye: [0, 0, 0],
      playerOrigin: playerEyeOrigin,
      profile: {
        cooldownMs: 2000,
        damage: 120,
        kind: "hitscan",
        range: 600 * QUAKE_COLLISION_UNIT_SCALE,
      },
    },
  );

  assert.deepEqual(hits, [10]);
  const eventTrace = traces.find((trace) => trace.kind === "enemy-quakec-event");
  assert.equal(eventTrace?.details.call, "CastLightning");
  assert.equal(eventTrace?.details.hit, true);
  assert.equal(eventTrace?.details.reason, "hit");
});
