import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "../..");

const quakeToolsRevision = "c0d1b91c74eb654365ac7755bc837e497caaca73";
const quakeToolsRepositoryUrl = "https://github.com/id-Software/Quake-Tools";
const quakeToolsRawBaseUrl =
  `https://raw.githubusercontent.com/id-Software/Quake-Tools/${quakeToolsRevision}`;

const monsterLogicReportPath = path.join(projectRoot, "notes/quake-logic-monsters-report.md");
const programFactsReportPath = path.join(projectRoot, "notes/quake-logic-program-facts-report.md");
const soldierReportPath = path.join(projectRoot, "notes/quake-logic-soldier-report.md");
const generatedLogicPath = path.join(projectRoot, "src/generated/quakeMonsterLogic.ts");
const generatedProgramFactsJsonPath = path.join(projectRoot, "src/generated/quakeProgramFacts.json");
const generatedProgramFactsPath = path.join(projectRoot, "src/generated/quakeProgramFacts.ts");

const quakeVectorConstants = new Map([
  ["VEC_ORIGIN", [0, 0, 0]],
  ["VEC_HULL_MIN", [-16, -16, -24]],
  ["VEC_HULL_MAX", [16, 16, 32]],
  ["VEC_HULL2_MIN", [-32, -32, -24]],
  ["VEC_HULL2_MAX", [32, 32, 64]],
]);

const monsterTargets = [
  {
    checkAttackFunction: "SoldierCheckAttack",
    classname: "monster_army",
    label: "soldier",
    modelPath: "progs/soldier.mdl",
    sourcePath: "qcc/v101qc/soldier.qc",
    spawnFunction: "monster_army",
    extraChains: [
      ["pain_b", "army_painb1"],
      ["pain_c", "army_painc1"],
      ["death_c", "army_cdie1"],
    ],
    reactionProfile: {
      pain: {
        sourceFunction: "army_pain",
        branches: [
          { chain: "pain_a", randomLessThan: 0.2, cooldownMs: 600 },
          { chain: "pain_b", randomLessThan: 0.6, cooldownMs: 1100 },
          { chain: "pain_c", otherwise: true, cooldownMs: 1100 },
        ],
      },
      death: {
        sourceFunction: "army_die",
        gibHealthBelow: -35,
        regularBranches: [
          { chain: "death_a", randomLessThan: 0.5 },
          { chain: "death_c", otherwise: true },
        ],
      },
    },
  },
  {
    checkAttackFunction: "DogCheckAttack",
    classname: "monster_dog",
    label: "dog",
    modelPath: "progs/dog.mdl",
    primaryAttackCallback: "th_missile",
    sourcePath: "qcc/v101qc/dog.qc",
    spawnFunction: "monster_dog",
    extraChains: [
      ["pain_b", "dog_painb1"],
      ["death_b", "dog_dieb1"],
    ],
    reactionProfile: {
      pain: {
        sourceFunction: "dog_pain",
        branches: [
          { chain: "pain_a", randomGreaterThan: 0.5 },
          { chain: "pain_b", otherwise: true },
        ],
      },
      death: {
        sourceFunction: "dog_die",
        gibHealthBelow: -35,
        regularBranches: [
          { chain: "death_a", randomGreaterThan: 0.5 },
          { chain: "death_b", otherwise: true },
        ],
      },
    },
  },
  {
    classname: "monster_knight",
    label: "knight",
    modelPath: "progs/knight.mdl",
    sourcePath: "qcc/v101qc/knight.qc",
    spawnFunction: "monster_knight",
    extraChains: [
      ["pain_b", "knight_painb1"],
      ["death_b", "knight_dieb1"],
    ],
    reactionProfile: {
      pain: {
        sourceFunction: "knight_pain",
        cooldownMs: 1000,
        branches: [
          { chain: "pain_a", randomLessThan: 0.85 },
          { chain: "pain_b", otherwise: true },
        ],
      },
      death: {
        sourceFunction: "knight_die",
        gibHealthBelow: -40,
        regularBranches: [
          { chain: "death_a", randomLessThan: 0.5 },
          { chain: "death_b", otherwise: true },
        ],
      },
    },
  },
  {
    checkAttackFunction: "OgreCheckAttack",
    classname: "monster_ogre",
    label: "ogre",
    modelPath: "progs/ogre.mdl",
    primaryAttackCallback: "th_missile",
    sourcePath: "qcc/v101qc/ogre.qc",
    spawnFunction: "monster_ogre",
    extraChains: [
      ["pain_b", "ogre_painb1"],
      ["pain_c", "ogre_painc1"],
      ["pain_d", "ogre_paind1"],
      ["pain_e", "ogre_paine1"],
      ["death_b", "ogre_bdie1"],
    ],
    reactionProfile: {
      pain: {
        sourceFunction: "ogre_pain",
        branches: [
          { chain: "pain_a", randomLessThan: 0.25, cooldownMs: 1000 },
          { chain: "pain_b", randomLessThan: 0.5, cooldownMs: 1000 },
          { chain: "pain_c", randomLessThan: 0.75, cooldownMs: 1000 },
          { chain: "pain_d", randomLessThan: 0.88, cooldownMs: 2000 },
          { chain: "pain_e", otherwise: true, cooldownMs: 2000 },
        ],
      },
      death: {
        sourceFunction: "ogre_die",
        gibHealthBelow: -80,
        regularBranches: [
          { chain: "death_a", randomLessThan: 0.5 },
          { chain: "death_b", otherwise: true },
        ],
      },
    },
  },
  {
    checkAttackFunction: "DemonCheckAttack",
    classname: "monster_demon1",
    label: "demon",
    modelPath: "progs/demon.mdl",
    primaryAttackCallback: "th_missile",
    sourcePath: "qcc/v101qc/demon.qc",
    spawnFunction: "monster_demon1",
    reactionProfile: {
      pain: {
        sourceFunction: "demon1_pain",
        cooldownMs: 1000,
        cooldownOnFailedFlinch: true,
        flinchDamageRandomScale: 200,
        branches: [{ chain: "pain_a" }],
      },
      death: {
        sourceFunction: "demon_die",
        gibHealthBelow: -80,
        regularBranches: [{ chain: "death_a" }],
      },
    },
  },
  {
    checkAttackFunction: "WizardCheckAttack",
    classname: "monster_wizard",
    label: "wizard",
    modelPath: "progs/wizard.mdl",
    sourcePath: "qcc/v101qc/wizard.qc",
    spawnFunction: "monster_wizard",
    reactionProfile: {
      pain: {
        sourceFunction: "Wiz_Pain",
        flinchDamageRandomScale: 70,
        branches: [{ chain: "pain_a" }],
      },
      death: {
        sourceFunction: "wiz_die",
        gibHealthBelow: -40,
        regularBranches: [{ chain: "death_a" }],
      },
    },
  },
  {
    checkAttackFunction: "ShamCheckAttack",
    classname: "monster_shambler",
    label: "shambler",
    modelPath: "progs/shambler.mdl",
    primaryAttackCallback: "th_missile",
    sourcePath: "qcc/v101qc/shambler.qc",
    spawnFunction: "monster_shambler",
    extraChains: [
      ["melee_smash", "sham_smash1"],
      ["melee_swing_left", "sham_swingl1"],
      ["melee_swing_right", "sham_swingr1"],
    ],
    reactionProfile: {
      pain: {
        sourceFunction: "sham_pain",
        cooldownMs: 2000,
        flinchDamageRandomScale: 400,
        branches: [{ chain: "pain_a" }],
      },
      death: {
        sourceFunction: "sham_die",
        gibHealthBelow: -60,
        regularBranches: [{ chain: "death_a" }],
      },
    },
  },
  {
    classname: "monster_zombie",
    label: "zombie",
    modelPath: "progs/zombie.mdl",
    attackChainChoicesFunction: "zombie_missile",
    sourcePath: "qcc/v101qc/zombie.qc",
    spawnFunction: "monster_zombie",
    extraChains: [
      ["attack_b", "zombie_attb1"],
      ["attack_c", "zombie_attc1"],
      ["pain_light_a", "zombie_paina1"],
      ["pain_light_b", "zombie_painb1"],
      ["pain_light_c", "zombie_painc1"],
      ["pain_light_d", "zombie_paind1"],
      ["pain_down", "zombie_paine1"],
    ],
    deathOutputFunction: "zombie_die",
    deathOutputGibDamageAtLeast: 60,
  },
  {
    callbackOverrides: {
      th_die: "boss_death1",
      th_missile: "boss_missile1",
      th_pain: "boss_shocka1",
      th_run: "boss_idle1",
      th_stand: "boss_idle1",
      th_walk: "boss_idle1",
    },
    classname: "monster_boss",
    label: "boss",
    modelPath: "progs/boss.mdl",
    sourcePath: "qcc/v101qc/boss.qc",
    spawnFunction: "monster_boss",
    extraChains: [
      ["rise", "boss_rise1"],
      ["shock_b", "boss_shockb1"],
      ["shock_c", "boss_shockc1"],
    ],
  },
];

const programFactTargets = [
  {
    classname: "worldspawn",
    functionName: "worldspawn",
    includeAssets: false,
    kind: "worldspawn",
    sourcePath: "qcc/v101qc/world.qc",
  },
  {
    callbackFactFunctions: ["army_die"],
    classname: "monster_army",
    functionName: "monster_army",
    kind: "monster",
    sourcePath: "qcc/v101qc/soldier.qc",
  },
  {
    callbackFactFunctions: ["dog_die"],
    classname: "monster_dog",
    functionName: "monster_dog",
    kind: "monster",
    sourcePath: "qcc/v101qc/dog.qc",
  },
  {
    callbackFactFunctions: ["knight_die"],
    classname: "monster_knight",
    functionName: "monster_knight",
    kind: "monster",
    sourcePath: "qcc/v101qc/knight.qc",
  },
  {
    callbackFactFunctions: ["ogre_die"],
    classname: "monster_ogre",
    functionName: "monster_ogre",
    kind: "monster",
    sourcePath: "qcc/v101qc/ogre.qc",
  },
  {
    callbackFactFunctions: ["demon_die"],
    classname: "monster_demon1",
    functionName: "monster_demon1",
    kind: "monster",
    sourcePath: "qcc/v101qc/demon.qc",
  },
  {
    callbackFactFunctions: ["wiz_die"],
    classname: "monster_wizard",
    functionName: "monster_wizard",
    kind: "monster",
    sourcePath: "qcc/v101qc/wizard.qc",
  },
  {
    callbackFactFunctions: ["sham_die"],
    classname: "monster_shambler",
    functionName: "monster_shambler",
    kind: "monster",
    sourcePath: "qcc/v101qc/shambler.qc",
  },
  {
    callbackFactFunctions: ["zombie_die"],
    classname: "monster_zombie",
    functionName: "monster_zombie",
    kind: "monster",
    sourcePath: "qcc/v101qc/zombie.qc",
  },
  {
    classname: "monster_boss",
    functionName: "monster_boss",
    kind: "monster",
    sourcePath: "qcc/v101qc/boss.qc",
  },
  {
    callbackFactFunctions: ["health_touch"],
    classname: "item_health",
    functionName: "item_health",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    classname: "item_armor1",
    callbackFactFunctions: ["armor_touch"],
    functionName: "item_armor1",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    classname: "item_armor2",
    callbackFactFunctions: ["armor_touch"],
    functionName: "item_armor2",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    classname: "item_armorInv",
    callbackFactFunctions: ["armor_touch"],
    functionName: "item_armorInv",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["weapon_touch"],
    classname: "weapon_supershotgun",
    functionName: "weapon_supershotgun",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["weapon_touch"],
    classname: "weapon_nailgun",
    functionName: "weapon_nailgun",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["weapon_touch"],
    classname: "weapon_supernailgun",
    functionName: "weapon_supernailgun",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["weapon_touch"],
    classname: "weapon_grenadelauncher",
    functionName: "weapon_grenadelauncher",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["weapon_touch"],
    classname: "weapon_rocketlauncher",
    functionName: "weapon_rocketlauncher",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["weapon_touch"],
    classname: "weapon_lightning",
    functionName: "weapon_lightning",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["ammo_touch"],
    classname: "item_shells",
    functionName: "item_shells",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["ammo_touch"],
    classname: "item_spikes",
    functionName: "item_spikes",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["ammo_touch"],
    classname: "item_rockets",
    functionName: "item_rockets",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["ammo_touch"],
    classname: "item_cells",
    functionName: "item_cells",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["ammo_touch"],
    classname: "item_weapon",
    functionName: "item_weapon",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["key_touch"],
    classname: "item_key1",
    functionName: "item_key1",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["key_touch"],
    classname: "item_key2",
    functionName: "item_key2",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    classname: "item_sigil",
    functionName: "item_sigil",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["powerup_touch"],
    classname: "item_artifact_invulnerability",
    functionName: "item_artifact_invulnerability",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["powerup_touch"],
    classname: "item_artifact_envirosuit",
    functionName: "item_artifact_envirosuit",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["powerup_touch"],
    classname: "item_artifact_invisibility",
    functionName: "item_artifact_invisibility",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    callbackFactFunctions: ["powerup_touch"],
    classname: "item_artifact_super_damage",
    functionName: "item_artifact_super_damage",
    kind: "pickup",
    sourcePath: "qcc/v101qc/items.qc",
  },
  {
    classname: "light_globe",
    functionName: "light_globe",
    kind: "misc",
    sourcePath: "qcc/v101qc/misc.qc",
  },
  {
    callbackFactFunctions: ["movetarget_f", "t_movetarget"],
    classname: "path_corner",
    functionName: "path_corner",
    kind: "misc",
    sourcePath: "qcc/v101qc/ai.qc",
  },
  {
    classname: "info_teleport_destination",
    functionName: "info_teleport_destination",
    kind: "misc",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    callbackFactFunctions: ["fire_fly", "fire_touch"],
    classname: "misc_fireball",
    functionName: "misc_fireball",
    kind: "misc",
    sourcePath: "qcc/v101qc/misc.qc",
  },
  {
    callbackFactFunctions: ["barrel_explode"],
    classname: "misc_explobox",
    functionName: "misc_explobox",
    kind: "shootable",
    sourcePath: "qcc/v101qc/misc.qc",
  },
  {
    callbackFactFunctions: ["barrel_explode"],
    classname: "misc_explobox2",
    functionName: "misc_explobox2",
    kind: "shootable",
    sourcePath: "qcc/v101qc/misc.qc",
  },
  {
    callbackFactFunctions: ["spikeshooter_use"],
    classname: "trap_spikeshooter",
    functionName: "trap_spikeshooter",
    kind: "misc",
    sourcePath: "qcc/v101qc/misc.qc",
  },
  {
    callbackFactFunctions: ["func_wall_use"],
    classname: "func_wall",
    functionName: "func_wall",
    kind: "misc",
    sourcePath: "qcc/v101qc/misc.qc",
  },
  {
    callbackFactFunctions: [
      "fd_secret_done",
      "fd_secret_move1",
      "fd_secret_move2",
      "fd_secret_move3",
      "fd_secret_move4",
      "fd_secret_move5",
      "fd_secret_move6",
      "fd_secret_use",
      "secret_blocked",
      "secret_touch",
    ],
    classname: "func_door_secret",
    functionName: "func_door_secret",
    kind: "mover",
    sourcePath: "qcc/v101qc/doors.qc",
  },
  {
    callbackFactFunctions: ["func_wall_use"],
    classname: "func_episodegate",
    functionName: "func_episodegate",
    kind: "misc",
    sourcePath: "qcc/v101qc/misc.qc",
  },
  {
    callbackFactFunctions: ["func_wall_use"],
    classname: "func_bossgate",
    functionName: "func_bossgate",
    kind: "misc",
    sourcePath: "qcc/v101qc/misc.qc",
  },
  {
    classname: "func_plat",
    functionName: "func_plat",
    kind: "mover",
    sourcePath: "qcc/v101qc/plats.qc",
  },
  {
    callbackFactFunctions: ["door_touch"],
    classname: "func_door",
    functionName: "func_door",
    kind: "mover",
    sourcePath: "qcc/v101qc/doors.qc",
  },
  {
    classname: "func_button",
    functionName: "func_button",
    kind: "mover",
    sourcePath: "qcc/v101qc/buttons.qc",
  },
  {
    classname: "func_train",
    functionName: "func_train",
    kind: "mover",
    sourcePath: "qcc/v101qc/plats.qc",
  },
  {
    classname: "trigger_multiple",
    functionName: "trigger_multiple",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    classname: "trigger_once",
    functionName: "trigger_once",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    classname: "trigger_secret",
    functionName: "trigger_secret",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    callbackFactFunctions: ["counter_use"],
    classname: "trigger_counter",
    functionName: "trigger_counter",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    classname: "trigger_relay",
    functionName: "trigger_relay",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    classname: "trigger_onlyregistered",
    functionName: "trigger_onlyregistered",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    classname: "trigger_setskill",
    functionName: "trigger_setskill",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    classname: "trigger_hurt",
    functionName: "trigger_hurt",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    classname: "trigger_teleport",
    functionName: "trigger_teleport",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    classname: "trigger_push",
    functionName: "trigger_push",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    callbackFactFunctions: ["trigger_monsterjump_touch"],
    classname: "trigger_monsterjump",
    functionName: "trigger_monsterjump",
    kind: "trigger",
    sourcePath: "qcc/v101qc/triggers.qc",
  },
  {
    classname: "trigger_changelevel",
    functionName: "trigger_changelevel",
    kind: "trigger",
    sourcePath: "qcc/v101qc/client.qc",
  },
];

const sharedProgramFactSourcePaths = [
  "qcc/v101qc/defs.qc",
];

const sourceTextCache = new Map();

const sharedSources = {
  combat: await fetchSourceText("qcc/v101qc/combat.qc"),
  fight: await fetchSourceText("qcc/v101qc/fight.qc"),
  items: await fetchSourceText("qcc/v101qc/items.qc"),
  player: await fetchSourceText("qcc/v101qc/player.qc"),
  weapons: await fetchSourceText("qcc/v101qc/weapons.qc"),
};
const extractedMonsters = [];
for (const target of monsterTargets) {
  extractedMonsters.push(await extractMonsterLogic(target, sharedSources));
}

const programFacts = await extractProgramFacts(programFactTargets, sharedSources);
const shootableLogic = extractShootableLogic(programFacts, sharedSources.combat);
const generatedLogic = renderGeneratedLogic(extractedMonsters, shootableLogic);
const generatedProgramFacts = renderGeneratedProgramFacts(programFacts);
const monstersReport = renderMonstersReport(extractedMonsters);
const programFactsReport = renderProgramFactsReport(programFacts);
const soldierReport = renderSingleMonsterReport(extractedMonsters[0]);

await mkdir(path.dirname(monsterLogicReportPath), { recursive: true });
await writeFile(monsterLogicReportPath, monstersReport);
await writeFile(programFactsReportPath, programFactsReport);
await writeFile(soldierReportPath, soldierReport);
await mkdir(path.dirname(generatedLogicPath), { recursive: true });
await writeFile(generatedLogicPath, generatedLogic);
await writeFile(generatedProgramFactsJsonPath, `${json(programFacts)}\n`);
await writeFile(generatedProgramFactsPath, generatedProgramFacts);

console.log(`Wrote ${path.relative(projectRoot, monsterLogicReportPath)}`);
console.log(`Wrote ${path.relative(projectRoot, programFactsReportPath)}`);
console.log(`Wrote ${path.relative(projectRoot, soldierReportPath)}`);
console.log(`Wrote ${path.relative(projectRoot, generatedLogicPath)}`);
console.log(`Wrote ${path.relative(projectRoot, generatedProgramFactsJsonPath)}`);
console.log(`Wrote ${path.relative(projectRoot, generatedProgramFactsPath)}`);

async function extractProgramFacts(targets, shared = {}) {
  const sharedConstants = new Map();
  for (const sourcePath of sharedProgramFactSourcePaths) {
    const source = await fetchSourceText(sourcePath);
    for (const [name, value] of parseQuakeConstants(source)) {
      sharedConstants.set(name, value);
    }
  }
  const entities = {};
  for (const target of targets) {
    const entityFact = await extractProgramEntityFact(target, sharedConstants, shared);
    entities[entityFact.classname] = entityFact;
  }
  return {
    version: 1,
    source: {
      repository: quakeToolsRepositoryUrl,
      revision: quakeToolsRevision,
    },
    playerWeapons: extractPlayerWeaponFireFacts(shared),
    entities,
  };
}

async function extractProgramEntityFact(target, sharedConstants, shared = {}) {
  const source = await fetchSourceText(target.sourcePath);
  const functionDefinition = extractFunctionDefinition(source, target.functionName);
  if (!functionDefinition) {
    throw new Error(`Could not find QuakeC function ${target.functionName} in ${target.sourcePath}.`);
  }
  const constants = new Map([
    ...sharedConstants,
    ...parseQuakeConstants(source),
  ]);
  const body = functionDefinition.body;
  const assignments = extractSelfAssignments(body, functionDefinition, target, constants);
  const callbacks = extractCallbackAssignments(assignments);
  const assetRefs = target.includeAssets === false ? [] : extractProgramAssetRefs(body, functionDefinition, target);
  const callbackFacts = extractProgramCallbackFacts(source, target, constants, callbacks, shared);
  return {
    assetRefs,
    ...(Object.keys(callbackFacts).length ? { callbackFacts } : {}),
    callbacks,
    calls: extractCalls(body),
    classname: target.classname,
    defaultAssignments: extractDefaultAssignments(body, functionDefinition, target, constants),
    dependencies: {
      models: legacyProgramDependencyRefs(assetRefs, "model"),
      sounds: legacyProgramDependencyRefs(assetRefs, "sound"),
    },
    fieldAssignments: assignments,
    functionName: target.functionName,
    kind: target.kind,
    setmodels: extractSetmodelRefs(body, functionDefinition, target, constants),
    setsizes: extractSetsizeRefs(body, functionDefinition, target, constants),
    sourceRefs: [sourceRefForBodyIndex(functionDefinition, target, 0)],
    source: {
      license: "GPL-2.0-or-later header in source file",
      repository: quakeToolsRepositoryUrl,
      revision: quakeToolsRevision,
      sourceFile: target.sourcePath,
      sourceSha256: sha256(source),
      sourceUrl: sourceUrlFor(target.sourcePath),
    },
    spawnflagChecks: extractSpawnflagChecks(body, functionDefinition, target, constants),
  };
}

async function extractMonsterLogic(target, shared) {
  const sourceUrl = sourceUrlFor(target.sourcePath);
  const source = await fetchSourceText(target.sourcePath);
  const frameMap = parseFrameMap(source);
  const states = parseStates(source, frameMap);
  const callbacks = {
    ...parseMonsterCallbacks(source, target.spawnFunction),
    ...(target.callbackOverrides ?? {}),
  };
  const spawnProfile = extractMonsterSpawnProfile(source, target);
  const scriptedLifecycle = extractMonsterScriptedLifecycle(source, states, target);
  const eventSemantics = {
    fireBullets: extractFireBulletsSemantics(shared.weapons),
    sharedFightSource: shared.fight,
  };
  const chains = buildMonsterChains({ callbacks, eventSemantics, source, states, target });
  const combatPolicy = buildCombatPolicy({ callbacks, chains, shared, source, target });
  const deathOutput = extractMonsterDeathOutput(source, states, chains, target, shared.items);
  return {
    callbacks,
    chains,
    combatPolicy,
    deathOutput,
    frameMap,
    source,
    sourceMetadata: {
      license: "GPL-2.0-or-later header in source file",
      repository: quakeToolsRepositoryUrl,
      revision: quakeToolsRevision,
      sourceFile: target.sourcePath,
      sourceSha256: sha256(source),
      sourceUrl,
    },
    scriptedLifecycle,
    spawnProfile,
    states,
    target,
  };
}

async function fetchSourceText(sourcePath) {
  const url = sourceUrlFor(sourcePath);
  if (!sourceTextCache.has(url)) {
    sourceTextCache.set(url, fetchText(url));
  }
  return await sourceTextCache.get(url);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

function sourceUrlFor(sourcePath) {
  return `${quakeToolsRawBaseUrl}/${sourcePath}`;
}

function parseFrameMap(sourceText) {
  const frames = [];
  for (const line of sourceText.split(/\r?\n/)) {
    const match = line.match(/^\s*\$frame\s+(.+)$/);
    if (!match) continue;
    for (const frame of match[1].trim().split(/\s+/).filter(Boolean)) {
      frames.push(frame);
    }
  }
  return new Map(frames.map((frame, index) => [frame, index]));
}

function parseStates(sourceText, frames) {
  const states = new Map();
  const statePattern = /void\s*\(\s*\)\s+(\w+)\s*=\s*\[\s*\$(\w+)\s*,\s*(\w+)\s*\]\s*\{([\s\S]*?)\}\s*;/g;
  for (const match of sourceText.matchAll(statePattern)) {
    const [, name, frame, next, body] = match;
    const conditionalSounds = extractConditionalSounds(body);
    states.set(name, {
      body: normalizeBody(body),
      calls: extractCalls(body),
      conditionalSounds,
      frame,
      frameIndex: frames.get(frame) ?? null,
      movement: extractAiMovementCalls(body),
      name,
      next,
      sounds: extractUnconditionalSounds(body, conditionalSounds),
    });
  }
  return states;
}

function parseMonsterCallbacks(sourceText, functionName) {
  const monsterBody = extractFunctionBody(sourceText, functionName) ?? "";
  const callbacks = {};
  const callbackPattern = /self\.(th_\w+)\s*=\s*(\w+)\s*;/g;
  for (const match of monsterBody.matchAll(callbackPattern)) {
    callbacks[match[1]] = match[2];
  }
  return callbacks;
}

function extractMonsterSpawnProfile(sourceText, target) {
  const body = extractFunctionBody(sourceText, target.spawnFunction) ?? "";
  const modelPath = /setmodel\s*\(\s*self\s*,\s*"([^"]+)"\s*\)/.exec(body)?.[1] ?? target.modelPath;
  const setsize = /setsize\s*\(\s*self\s*,\s*([^,]+)\s*,\s*([^)]+)\)/.exec(body);
  const bounds = setsize ? {
    min: parseQuakeVectorExpression(setsize[1]),
    max: parseQuakeVectorExpression(setsize[2]),
  } : null;
  const health = extractMonsterSpawnHealth(body);
  const startKind = monsterStartKind(body);
  return {
    ...(bounds?.min && bounds?.max ? { bounds } : {}),
    dropToFloor: startKind === "walk",
    ...(health !== null ? { health } : {}),
    modelPath,
    startKind,
  };
}

function extractMonsterSpawnHealth(body) {
  const match = /self\.health\s*=\s*([-+]?[0-9.]+)\s*;/.exec(body);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractMonsterDeathOutput(sourceText, states, chains, target, itemsSource = "") {
  const sourceFunction = target.reactionProfile?.death?.sourceFunction ?? target.deathOutputFunction;
  const functionDefinition = sourceFunction ? extractFunctionDefinition(sourceText, sourceFunction) : null;
  const gib = functionDefinition ? extractMonsterDeathGibOutput(functionDefinition, target) : null;
  const backpackDrops = extractMonsterDeathBackpackDrops(states, chains);
  const backpack = backpackDrops.length ? extractMonsterDeathBackpackProfile(itemsSource) : null;
  const solidNotStates = extractMonsterDeathSolidNotStates(states, chains);
  if (!gib && backpackDrops.length === 0 && solidNotStates.length === 0) return null;
  return {
    ...(backpack ? { backpack } : {}),
    ...(gib ? { gib } : {}),
    ...(backpackDrops.length ? { backpackDrops } : {}),
    ...(solidNotStates.length ? { solidNotStates } : {}),
  };
}

function extractMonsterDeathGibOutput(functionDefinition, target) {
  const calls = extractDeathOutputModelCalls(functionDefinition.body);
  const gibModelPaths = calls
    .filter((call) => call.call === "ThrowGib")
    .map((call) => call.modelPath);
  const headModelPath = calls.find((call) => call.call === "ThrowHead")?.modelPath;
  if (!headModelPath && gibModelPaths.length === 0) return null;
  const modelPaths = [...new Set([headModelPath, ...gibModelPaths].filter(Boolean))].sort();
  const soundPath = extractRuntimeSoundPath(functionDefinition.body);
  return {
    sourceFunction: functionDefinition.functionName,
    ...(typeof target.reactionProfile?.death?.gibHealthBelow === "number"
      ? { healthBelow: target.reactionProfile.death.gibHealthBelow }
      : {}),
    ...(typeof target.deathOutputGibDamageAtLeast === "number"
      ? { damageAtLeast: target.deathOutputGibDamageAtLeast }
      : {}),
    ...(soundPath ? { soundPath } : {}),
    ...(headModelPath ? { headModelPath } : {}),
    gibModelPaths,
    modelPaths,
    pieces: calls,
  };
}

function extractDeathOutputModelCalls(body) {
  const calls = [];
  for (const match of body.matchAll(/\b(ThrowHead|ThrowGib)\s*\(\s*"([^"]+)"\s*,/g)) {
    calls.push({
      call: match[1],
      modelPath: match[2].toLowerCase(),
    });
  }
  return calls;
}

function extractRuntimeSoundPath(body) {
  return /\bsound\s*\([^,]+,\s*[^,]+,\s*"([^"]+)"/.exec(body)?.[1]?.toLowerCase() ?? null;
}

function extractMonsterDeathBackpackDrops(states, chains) {
  const out = [];
  for (const [chainName, chain] of Object.entries(chains)) {
    if (!chainName.startsWith("death")) continue;
    for (const [frameIndex, state] of (chain.states ?? []).entries()) {
      if (!state.calls?.includes("DropBackpack")) continue;
      const rawState = states.get(state.name);
      out.push({
        chain: chainName,
        stateName: state.name,
        frameIndex,
        ...monsterBackpackAmmoFact(rawState?.body ?? ""),
      });
    }
  }
  return out;
}

function monsterBackpackAmmoFact(body) {
  const ammo = {};
  for (const match of body.matchAll(/\bself\.ammo_([A-Za-z_]\w*)\s*=\s*([-+]?[0-9.]+)\s*;/g)) {
    const amount = Number(match[2]);
    if (Number.isFinite(amount)) ammo[match[1]] = amount;
  }
  return Object.keys(ammo).length ? { ammo } : {};
}

function extractMonsterDeathBackpackProfile(itemsSource) {
  const dropDefinition = extractFunctionDefinition(itemsSource, "DropBackpack");
  const touchDefinition = extractFunctionDefinition(itemsSource, "BackpackTouch");
  if (!dropDefinition) return null;
  const modelPath = /setmodel\s*\(\s*item\s*,\s*"([^"]+)"/.exec(dropDefinition.body)?.[1]?.toLowerCase();
  if (!modelPath) return null;
  const originOffsetUnits = extractBackpackOriginOffsetUnits(dropDefinition.body);
  const bounds = extractBackpackBounds(dropDefinition.body);
  const removeAfterSeconds = extractBackpackRemoveAfterSeconds(dropDefinition.body);
  const pickupSoundPath = touchDefinition
    ? extractRuntimeSoundPath(touchDefinition.body)
    : null;
  return {
    sourceFunction: "DropBackpack",
    touchFunction: "BackpackTouch",
    modelPath,
    ...(pickupSoundPath ? { pickupSoundPath } : {}),
    ...(Number.isFinite(removeAfterSeconds) ? { removeAfterSeconds } : {}),
    ...(originOffsetUnits ? { originOffsetUnits } : {}),
    ...(bounds ? { bounds } : {}),
  };
}

function extractBackpackOriginOffsetUnits(body) {
  const match = /item\.origin\s*=\s*self\.origin\s*-\s*('[^']+')/.exec(body);
  const vector = match ? parseQuakeVectorExpression(match[1]) : null;
  if (!vector) return null;
  return vector.map((value) => -value);
}

function extractBackpackBounds(body) {
  const match = /setsize\s*\(\s*item\s*,\s*([^,]+)\s*,\s*([^)]+)\)/.exec(body);
  if (!match) return null;
  const min = parseQuakeVectorExpression(match[1]);
  const max = parseQuakeVectorExpression(match[2]);
  return min && max ? { min, max } : null;
}

function extractBackpackRemoveAfterSeconds(body) {
  const match = /item\.nextthink\s*=\s*time\s*\+\s*([-+]?[0-9.]+)/.exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : null;
}

function extractMonsterDeathSolidNotStates(states, chains) {
  const out = [];
  for (const [chainName, chain] of Object.entries(chains)) {
    if (!chainName.startsWith("death")) continue;
    for (const [frameIndex, state] of (chain.states ?? []).entries()) {
      if (!/\bself\.solid\s*=\s*SOLID_NOT\s*;/.test(states.get(state.name)?.body ?? "")) continue;
      out.push({
        chain: chainName,
        stateName: state.name,
        frameIndex,
      });
    }
  }
  return out;
}

function monsterStartKind(body) {
  if (/\bwalkmonster_start\s*\(/.test(body)) return "walk";
  if (/\bflymonster_start\s*\(/.test(body)) return "fly";
  if (/\bswimmonster_start\s*\(/.test(body)) return "swim";
  return "unknown";
}

function extractMonsterScriptedLifecycle(sourceText, states, target) {
  if (target.classname !== "monster_boss") return null;
  return extractBossScriptedLifecycle(sourceText, states);
}

function extractBossScriptedLifecycle(sourceText, states) {
  const spawnBody = extractFunctionBody(sourceText, "monster_boss") ?? "";
  const awakeBody = extractFunctionBody(sourceText, "boss_awake") ?? "";
  const lightningBody = extractFunctionBody(sourceText, "lightning_use") ?? "";
  const lightningFireBody = extractFunctionBody(sourceText, "lightning_fire") ?? "";
  const deathState = states.get("boss_death10");
  const spawnUseFunction = /self\.use\s*=\s*(\w+)\s*;/.exec(spawnBody)?.[1];
  const healthBySkill = extractBossAwakeHealthBySkill(awakeBody);
  const awakeModelPath = /setmodel\s*\(\s*self\s*,\s*"([^"]+)"\s*\)/.exec(awakeBody)?.[1];
  const awakeSetsize = /setsize\s*\(\s*self\s*,\s*([^,]+)\s*,\s*([^)]+)\)/.exec(awakeBody);
  const awakeBounds = awakeSetsize ? {
    min: parseQuakeVectorExpression(awakeSetsize[1]),
    max: parseQuakeVectorExpression(awakeSetsize[2]),
  } : null;
  const damagePerUse = Number(/self\.health\s*=\s*self\.health\s*-\s*([-+]?[0-9.]+)\s*;/.exec(lightningBody)?.[1] ?? 0);
  const resetAfterSeconds = Number(/lightning_end\s*=\s*time\s*\+\s*([-+]?[0-9.]+)\s*;/.exec(lightningBody)?.[1] ?? 0);
  const fireIntervalSeconds = Number(/self\.nextthink\s*=\s*time\s*\+\s*([-+]?[0-9.]+)\s*;/.exec(lightningFireBody)?.[1] ?? 0);
  if (!spawnUseFunction || !healthBySkill || !awakeModelPath || !Number.isFinite(damagePerUse) || damagePerUse <= 0) {
    return null;
  }
  return {
    kind: "boss",
    spawnUseFunction,
    awake: {
      functionName: "boss_awake",
      ...(awakeBounds?.min && awakeBounds?.max ? { bounds: awakeBounds } : {}),
      healthBySkill,
      modelPath: awakeModelPath,
      startFunction: "boss_rise1",
      takedamage: "DAMAGE_NO",
    },
    lightning: {
      alignment: {
        damageState: "STATE_TOP",
        requiresMatchingState: /\ble1\.state\s*!=\s*le2\.state\b/.test(lightningBody),
        targetField: "target",
        validStates: ["STATE_TOP", "STATE_BOTTOM"],
      },
      bossLookupClassname: "monster_boss",
      damagePerUse,
      electrodeTargetName: "lightning",
      eventClassname: "event_lightning",
      ...(fireIntervalSeconds > 0 ? { fireIntervalMs: fireIntervalSeconds * 1000 } : {}),
      painBranches: [
        { afterHealthMin: 2, chain: "pain", functionName: "boss_shocka1" },
        { afterHealth: 1, chain: "shock_b", functionName: "boss_shockb1" },
        { afterHealth: 0, chain: "shock_c", functionName: "boss_shockc1" },
      ],
      painSoundPath: /"boss1\/pain\.wav"/.test(lightningBody) ? "boss1/pain.wav" : undefined,
      resetAfterMs: resetAfterSeconds > 0 ? resetAfterSeconds * 1000 : undefined,
      resetFunction: /\bdoor_go_down\s*\(/.test(lightningFireBody) ? "door_go_down" : undefined,
      soundPath: /sound\s*\(\s*self\s*,\s*CHAN_VOICE\s*,\s*"([^"]+)"/.exec(lightningBody)?.[1],
      tempEntity: /\bTE_LIGHTNING3\b/.exec(lightningFireBody)?.[0],
      useFunction: "lightning_use",
    },
    death: {
      incrementsKilledMonsters: deathState?.body.includes("killed_monsters = killed_monsters + 1") === true,
      removesSelf: deathState?.calls.includes("remove") === true,
      terminalState: "boss_death10",
      usesTargets: deathState?.calls.includes("SUB_UseTargets") === true,
    },
  };
}

function extractBossAwakeHealthBySkill(body) {
  const match = /if\s*\(\s*skill\s*==\s*0\s*\)\s*self\.health\s*=\s*([-+]?[0-9.]+)\s*;\s*else\s*self\.health\s*=\s*([-+]?[0-9.]+)\s*;/m.exec(body);
  if (!match) return null;
  const easy = Number(match[1]);
  const normalHard = Number(match[2]);
  if (!Number.isFinite(easy) || !Number.isFinite(normalHard)) return null;
  return {
    easy,
    normal: normalHard,
    hard: normalHard,
  };
}

function parseQuakeVectorExpression(expression) {
  const text = expression.trim().replace(/;$/, "");
  const constant = quakeVectorConstants.get(text);
  if (constant) return constant;
  const literal = /^'([^']+)'$/.exec(text);
  if (!literal) return null;
  const vector = parseVectorLiteral(literal[1]);
  return vector.every(Number.isFinite) ? vector : null;
}

function parseQuakeConstants(sourceText) {
  const constants = new Map();
  for (const match of sourceText.matchAll(/\bfloat\s+([A-Za-z_]\w*)\s*=\s*([-+]?[0-9.]+)\s*;/g)) {
    constants.set(match[1], Number(match[2]));
  }
  for (const match of sourceText.matchAll(/^\s*#define\s+([A-Za-z_]\w*)\s+([-+]?[0-9.]+)\b/gm)) {
    constants.set(match[1], Number(match[2]));
  }
  for (const [name, value] of quakeVectorConstants) {
    constants.set(name, value);
  }
  return constants;
}

function extractProgramAssetRefs(body, functionDefinition, target, options = {}) {
  const refs = [];
  const patterns = [
    /\b(precache_model2?)\s*\(\s*"([^"]+)"\s*\)/g,
    /\b(setmodel)\s*\(\s*[^,]+,\s*"([^"]+)"\s*\)/g,
    /\b(precache_sound2?)\s*\(\s*"([^"]+)"\s*\)/g,
  ];
  if (options.includeRuntimeCalls) {
    patterns.push(
      /\b(ThrowHead|ThrowGib)\s*\(\s*"([^"]+)"\s*,/g,
    );
  }
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const call = match[1];
      const path = match[2].toLowerCase();
      refs.push({
        call,
        kind: quakeProgramAssetKind(path, call),
        path,
        sourceRef: sourceRefForBodyIndex(functionDefinition, target, match.index ?? 0),
      });
    }
  }
  if (options.includeRuntimeCalls) {
    refs.push(...extractDeathOutputSoundAssetRefs(body, functionDefinition, target));
  }
  return dedupeProgramRefs(refs);
}

function extractDeathOutputSoundAssetRefs(body, functionDefinition, target) {
  const firstDeathOutputCall = firstDeathOutputCallIndex(body);
  if (firstDeathOutputCall === null) return [];
  const refs = [];
  const prefix = body.slice(0, firstDeathOutputCall);
  for (const match of prefix.matchAll(/\b(sound)\s*\([^,]+,\s*[^,]+,\s*"([^"]+)"/g)) {
    const path = match[2].toLowerCase();
    refs.push({
      call: match[1],
      kind: quakeProgramAssetKind(path, match[1]),
      path,
      sourceRef: sourceRefForBodyIndex(functionDefinition, target, match.index ?? 0),
    });
  }
  return refs;
}

function firstDeathOutputCallIndex(body) {
  const indexes = [];
  for (const match of body.matchAll(/\b(?:ThrowHead|ThrowGib)\s*\(/g)) {
    if (Number.isInteger(match.index)) indexes.push(match.index);
  }
  return indexes.length ? Math.min(...indexes) : null;
}

function legacyProgramDependencyRefs(assetRefs, kind) {
  return assetRefs
    .filter((ref) => kind === "sound" ? ref.kind === "sound" : ref.call === "setmodel" || ref.call.startsWith("precache_model"))
    .map(({ call, path, sourceRef }) => ({ call, path, sourceRef }));
}

function quakeProgramAssetKind(assetPath, call) {
  if (call.startsWith("precache_sound") || assetPath.endsWith(".wav")) return "sound";
  if (assetPath.startsWith("maps/") && assetPath.endsWith(".bsp")) return "bsp";
  if (assetPath.startsWith("progs/") && assetPath.endsWith(".spr")) return "sprite";
  if (assetPath.endsWith(".mdl")) return "model";
  if (assetPath.endsWith(".bsp")) return "bsp";
  if (assetPath.endsWith(".spr")) return "sprite";
  if (call === "setmodel" || call.startsWith("precache_model")) return "model";
  return "unknown";
}

function dedupeProgramRefs(refs) {
  const out = [];
  const seen = new Set();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.call}:${ref.path}:${ref.sourceRef.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function extractSelfAssignments(body, functionDefinition, target, constants) {
  const assignments = [];
  for (const match of body.matchAll(/\bself\.([A-Za-z_]\w*)\s*=(?!=)\s*([^;]+);/g)) {
    const expression = normalizeQuakeExpression(match[2]);
    assignments.push({
      field: match[1],
      expression,
      ...parsedProgramValueField(expression, constants),
      sourceRef: sourceRefForBodyIndex(functionDefinition, target, match.index ?? 0),
    });
  }
  return assignments;
}

function extractCallbackAssignments(assignments) {
  const callbacks = {};
  for (const assignment of assignments) {
    if (!isQuakeCallbackField(assignment.field)) continue;
    if (!/^[A-Za-z_]\w*$/.test(assignment.expression)) continue;
    callbacks[assignment.field] = assignment.expression;
  }
  return callbacks;
}

function extractProgramCallbackFacts(source, target, constants, callbacks, shared = {}) {
  const facts = {};
  if (!target.callbackFactFunctions?.length) return facts;
  const allowedCallbacks = new Set(target.callbackFactFunctions);
  const callbackNames = [
    ...new Set([
      ...Object.values(callbacks).filter((callbackName) => allowedCallbacks.has(callbackName)),
      ...target.callbackFactFunctions,
    ]),
  ].sort();
  for (const callbackName of callbackNames) {
    const functionDefinition = extractFunctionDefinition(source, callbackName);
    if (!functionDefinition) continue;
    const callbackTarget = { ...target, functionName: callbackName };
    const assignments = extractLocalAssignments(functionDefinition.body, functionDefinition, callbackTarget, constants);
    const calls = extractCalls(functionDefinition.body);
    const classnameBranches = extractClassnameBranchAssignments(functionDefinition, callbackTarget, constants);
    const radiusDamage = extractRadiusDamageCalls(functionDefinition, callbackTarget);
    const assetRefs = dedupeProgramRefs([
      ...extractProgramAssetRefs(functionDefinition.body, functionDefinition, callbackTarget, {
        includeRuntimeCalls: true,
      }),
      ...extractProgramLinkedRuntimeAssetRefs(source, functionDefinition, shared),
    ]);
    if (!assignments.length && !calls.length && !classnameBranches.length && !radiusDamage.length && !assetRefs.length) continue;
    facts[callbackName] = {
      assignments,
      ...(assetRefs.length ? { assetRefs } : {}),
      calls,
      ...(classnameBranches.length ? { classnameBranches } : {}),
      ...(radiusDamage.length ? { radiusDamage } : {}),
      sourceRefs: [sourceRefForBodyIndex(functionDefinition, callbackTarget, 0)],
    };
  }
  return facts;
}

function extractProgramLinkedRuntimeAssetRefs(source, functionDefinition, shared = {}) {
  const refs = [];
  if (shared.items && callbackStateChainsIncludeCall(source, functionDefinition, "DropBackpack")) {
    refs.push(...extractDropBackpackAssetRefs(shared.items));
  }
  return refs;
}

function callbackStateChainsIncludeCall(source, functionDefinition, callName) {
  const states = parseStates(source, parseFrameMap(source));
  if (!states.size) return false;
  const starts = extractCalls(functionDefinition.body).filter((call) => states.has(call));
  for (const start of starts) {
    if (chainFrom(states, start).some((state) => state.calls?.includes(callName))) return true;
  }
  return false;
}

function extractDropBackpackAssetRefs(itemsSource) {
  const refs = [];
  const dropDefinition = extractFunctionDefinition(itemsSource, "DropBackpack");
  const touchDefinition = extractFunctionDefinition(itemsSource, "BackpackTouch");
  if (dropDefinition) {
    const target = { sourcePath: "qcc/v101qc/items.qc", functionName: "DropBackpack" };
    for (const match of dropDefinition.body.matchAll(/\b(setmodel)\s*\(\s*item\s*,\s*"([^"]+)"/g)) {
      const path = match[2].toLowerCase();
      refs.push({
        call: "DropBackpack",
        kind: quakeProgramAssetKind(path, match[1]),
        path,
        sourceRef: sourceRefForBodyIndex(dropDefinition, target, match.index ?? 0),
      });
    }
  }
  if (touchDefinition) {
    const target = { sourcePath: "qcc/v101qc/items.qc", functionName: "BackpackTouch" };
    for (const match of touchDefinition.body.matchAll(/\b(sound)\s*\([^,]+,\s*[^,]+,\s*"([^"]+)"/g)) {
      const path = match[2].toLowerCase();
      refs.push({
        call: "BackpackTouch",
        kind: quakeProgramAssetKind(path, match[1]),
        path,
        sourceRef: sourceRefForBodyIndex(touchDefinition, target, match.index ?? 0),
      });
    }
  }
  return dedupeProgramRefs(refs);
}

function extractRadiusDamageCalls(functionDefinition, target) {
  const out = [];
  const pattern = /\bT_RadiusDamage\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([-+]?[0-9.]+)\s*,\s*([^)]+)\)\s*;/g;
  for (const match of functionDefinition.body.matchAll(pattern)) {
    const damage = Number(match[3]);
    if (!Number.isFinite(damage)) continue;
    out.push({
      attacker: match[2].trim(),
      call: "T_RadiusDamage",
      damageUnits: damage,
      ignore: match[4].trim(),
      inflictor: match[1].trim(),
      sourceRef: sourceRefForBodyIndex(functionDefinition, target, match.index ?? 0),
    });
  }
  return out;
}

function extractRadiusDamageSemantics(combatSource) {
  const body = extractFunctionBody(combatSource, "T_RadiusDamage") ?? "";
  const radiusAdd = Number(/findradius\s*\(\s*inflictor\.origin\s*,\s*damage\s*\+\s*([-+]?[0-9.]+)\s*\)/.exec(body)?.[1] ?? 0);
  const distanceScale = Number(/points\s*=\s*([-+]?[0-9.]+)\s*\*\s*vlen\s*\(/.exec(body)?.[1] ?? 1);
  const attackerSelfScale = Number(/head\s*==\s*attacker[\s\S]*?points\s*=\s*points\s*\*\s*([-+]?[0-9.]+)/.exec(body)?.[1] ?? 1);
  const shamblerScale = Number(/head\.classname\s*==\s*"monster_shambler"[\s\S]*?points\s*\*\s*([-+]?[0-9.]+)/.exec(body)?.[1] ?? 1);
  return {
    attackerSelfScale: Number.isFinite(attackerSelfScale) ? attackerSelfScale : 1,
    distanceScale: Number.isFinite(distanceScale) ? distanceScale : 1,
    radiusAddUnits: Number.isFinite(radiusAdd) ? radiusAdd : 0,
    requiresCanDamage: /\bCanDamage\s*\(\s*head\s*,\s*inflictor\s*\)/.test(body),
    shamblerScale: Number.isFinite(shamblerScale) ? shamblerScale : 1,
  };
}

function extractShootableLogic(programFacts, combatSource) {
  const semantics = extractRadiusDamageSemantics(combatSource);
  const out = {};
  for (const classname of ["misc_explobox", "misc_explobox2"]) {
    const entity = programFacts.entities[classname];
    const deathCallback = entity?.callbacks?.th_die;
    const radiusDamage = deathCallback
      ? entity?.callbackFacts?.[deathCallback]?.radiusDamage?.[0]
      : null;
    if (!entity || !deathCallback || !radiusDamage) continue;
    out[classname] = {
      classname,
      death: {
        callback: deathCallback,
        radiusDamage: {
          ...radiusDamage,
          ...semantics,
          radiusUnits: radiusDamage.damageUnits + semantics.radiusAddUnits,
        },
      },
    };
  }
  return out;
}

function extractPlayerWeaponFireFacts(shared) {
  const weaponsSource = shared.weapons ?? "";
  const playerSource = shared.player ?? "";
  const radiusDamageSemantics = extractRadiusDamageSemantics(shared.combat ?? "");
  const fireBullets = extractFireBulletsSemantics(weaponsSource);
  const attackFacts = extractPlayerWeaponAttackFacts(weaponsSource);
  const presentationFacts = extractPlayerWeaponPresentationFacts(weaponsSource);
  const fireAnimationFacts = extractPlayerWeaponFireAnimationFacts(weaponsSource, playerSource);
  const nailFrameFacts = extractPlayerNailFrameFacts(playerSource);
  const lightningFrameFacts = extractPlayerLightningFrameFacts(playerSource);

  const defs = Object.fromEntries(
    [
      "W_FireAxe",
      "W_FireShotgun",
      "W_FireSuperShotgun",
      "W_FireSpikes",
      "W_FireSuperSpikes",
      "spike_touch",
      "superspike_touch",
      "W_FireRocket",
      "T_MissileTouch",
      "W_FireGrenade",
      "GrenadeExplode",
      "GrenadeTouch",
      "W_FireLightning",
      "LightningDamage",
    ].map((functionName) => [functionName, requireFunctionDefinition(weaponsSource, functionName, "qcc/v101qc/weapons.qc")]),
  );
  const launchSpike = requireFunctionDefinition(weaponsSource, "launch_spike", "qcc/v101qc/weapons.qc");

  const missileTouchRadiusDamage = enrichedRadiusDamageFact(
    extractRadiusDamageCalls(defs.T_MissileTouch, sourceTarget("qcc/v101qc/weapons.qc", "T_MissileTouch"))[0],
    radiusDamageSemantics,
  );
  const grenadeRadiusDamage = enrichedRadiusDamageFact(
    extractRadiusDamageCalls(defs.GrenadeExplode, sourceTarget("qcc/v101qc/weapons.qc", "GrenadeExplode"))[0],
    radiusDamageSemantics,
  );

  return {
    radiusDamageSemantics,
    noAmmoFallback: extractNoAmmoFallbackFacts(weaponsSource),
    profiles: {
      axe: {
        weapon: "axe",
        itemFlag: "IT_AXE",
        runtimeKind: "melee-trace",
        sourceFunction: "W_FireAxe",
        cooldownMs: attackFacts.axe.cooldownMs,
        fireSound: attackFacts.axe.fireSound,
        presentation: playerWeaponPresentationFact(presentationFacts.axe, fireAnimationFacts.axe),
        melee: {
          damage: extractDamageCallUnits(defs.W_FireAxe.body, "T_Damage") ?? 20,
          rangeUnits: extractTraceRangeUnits(defs.W_FireAxe.body, "v_forward") ?? 64,
          sourceOffsetUnits: { up: 16 },
          wallImpactSoundPath: extractSoundPath(defs.W_FireAxe.body),
        },
        sourceRefs: profileSourceRefs(defs.W_FireAxe, attackFacts.axe.sourceRef),
      },
      shotgun: {
        weapon: "shotgun",
        itemFlag: "IT_SHOTGUN",
        runtimeKind: "hitscan-pellets",
        sourceFunction: "W_FireShotgun",
        ammo: extractWeaponAmmoSpend(defs.W_FireShotgun.body),
        cooldownMs: attackFacts.shotgun.cooldownMs,
        fireSound: extractWeaponFireSound(defs.W_FireShotgun, "qcc/v101qc/weapons.qc"),
        presentation: playerWeaponPresentationFact(presentationFacts.shotgun, fireAnimationFacts.shotgun),
        hitscan: {
          aimRangeUnits: extractAimRangeUnits(defs.W_FireShotgun.body),
          ...extractFireBulletsCall(defs.W_FireShotgun.body, fireBullets),
          sourceOffsetUnits: {
            forward: 10,
            zExpression: "self.absmin_z + self.size_z * 0.7",
          },
        },
        sourceRefs: profileSourceRefs(defs.W_FireShotgun, attackFacts.shotgun.sourceRef),
      },
      supershotgun: {
        weapon: "supershotgun",
        itemFlag: "IT_SUPER_SHOTGUN",
        runtimeKind: "hitscan-pellets",
        sourceFunction: "W_FireSuperShotgun",
        ammo: extractWeaponAmmoSpend(defs.W_FireSuperShotgun.body),
        cooldownMs: attackFacts.supershotgun.cooldownMs,
        fireSound: extractWeaponFireSound(defs.W_FireSuperShotgun, "qcc/v101qc/weapons.qc"),
        presentation: playerWeaponPresentationFact(presentationFacts.supershotgun, fireAnimationFacts.supershotgun),
        fallback: {
          condition: "self.currentammo == 1",
          sourceFunction: "W_FireShotgun",
          profile: "shotgun",
        },
        hitscan: {
          aimRangeUnits: extractAimRangeUnits(defs.W_FireSuperShotgun.body),
          ...extractFireBulletsCall(defs.W_FireSuperShotgun.body, fireBullets),
          sourceOffsetUnits: {
            forward: 10,
            zExpression: "self.absmin_z + self.size_z * 0.7",
          },
        },
        sourceRefs: profileSourceRefs(defs.W_FireSuperShotgun, attackFacts.supershotgun.sourceRef),
      },
      nailgun: {
        weapon: "nailgun",
        itemFlag: "IT_NAILGUN",
        runtimeKind: "projectile",
        sourceFunction: "W_FireSpikes",
        ammo: extractWeaponAmmoSpend(defs.W_FireSpikes.body),
        cooldownMs: nailFrameFacts.cooldownMs ?? parseSelfAttackFinishedCooldownMs(defs.W_FireSpikes.body),
        fireSound: extractWeaponFireSound(defs.W_FireSpikes, "qcc/v101qc/weapons.qc"),
        presentation: playerWeaponPresentationFact(presentationFacts.nailgun, fireAnimationFacts.nailgun),
        projectile: {
          damage: extractTouchDamageUnits(defs.spike_touch?.body ?? "") ?? 9,
          lifetimeMs: extractNextThinkLifetimeMs(launchSpike.body, "newmis"),
          modelPath: extractSetmodelPathForVar(launchSpike.body, "newmis"),
          movetype: extractAssignmentExpression(launchSpike.body, "newmis.movetype"),
          sourceOffsetUnits: {
            up: 16,
            alternatingRight: nailFrameFacts.offsets,
          },
          speedUnits: extractVelocityScaleUnits(launchSpike.body, "newmis.velocity"),
          touchFunction: "spike_touch",
        },
        sourceRefs: profileSourceRefs(defs.W_FireSpikes, launchSpike, ...nailFrameFacts.sourceRefs),
      },
      supernailgun: {
        weapon: "supernailgun",
        itemFlag: "IT_SUPER_NAILGUN",
        runtimeKind: "projectile",
        sourceFunction: "W_FireSuperSpikes",
        ammo: extractWeaponAmmoSpend(defs.W_FireSuperSpikes.body),
        cooldownMs: parseSelfAttackFinishedCooldownMs(defs.W_FireSuperSpikes.body),
        fireSound: extractWeaponFireSound(defs.W_FireSuperSpikes, "qcc/v101qc/weapons.qc"),
        presentation: playerWeaponPresentationFact(presentationFacts.supernailgun, fireAnimationFacts.supernailgun),
        fallback: {
          condition: "self.ammo_nails < 2",
          sourceFunction: "W_FireSpikes",
          profile: "nailgun",
        },
        projectile: {
          damage: extractTouchDamageUnits(defs.superspike_touch?.body ?? "") ?? 18,
          lifetimeMs: extractNextThinkLifetimeMs(launchSpike.body, "newmis"),
          modelPath: extractSetmodelPathForVar(defs.W_FireSuperSpikes.body, "newmis"),
          movetype: extractAssignmentExpression(launchSpike.body, "newmis.movetype"),
          sourceOffsetUnits: { up: 16 },
          speedUnits: extractVelocityScaleUnits(launchSpike.body, "newmis.velocity"),
          touchFunction: "superspike_touch",
        },
        sourceRefs: profileSourceRefs(defs.W_FireSuperSpikes, launchSpike),
      },
      grenadelauncher: {
        weapon: "grenadelauncher",
        itemFlag: "IT_GRENADE_LAUNCHER",
        runtimeKind: "projectile",
        sourceFunction: "W_FireGrenade",
        ammo: extractWeaponAmmoSpend(defs.W_FireGrenade.body),
        cooldownMs: attackFacts.grenadelauncher.cooldownMs,
        fireSound: extractWeaponFireSound(defs.W_FireGrenade, "qcc/v101qc/weapons.qc"),
        presentation: playerWeaponPresentationFact(presentationFacts.grenadelauncher, fireAnimationFacts.grenadelauncher),
        projectile: {
          angularVelocityUnits: parseQuakeVectorExpression("'300 300 300'"),
          bounceSoundPath: extractSoundPath(defs.GrenadeTouch.body),
          classname: extractAssignmentString(defs.W_FireGrenade.body, "missile.classname"),
          explodeFunction: "GrenadeExplode",
          lifetimeMs: extractNextThinkLifetimeMs(defs.W_FireGrenade.body, "missile"),
          modelPath: extractSetmodelPathForVar(defs.W_FireGrenade.body, "missile"),
          movetype: extractAssignmentExpression(defs.W_FireGrenade.body, "missile.movetype"),
          radiusDamage: grenadeRadiusDamage,
          randomVelocityUnits: { right: 10, up: 10 },
          speedUnits: extractVelocityScaleUnits(defs.W_FireGrenade.body, "missile.velocity") ?? 600,
          sourceOffsetUnits: {},
          touchFunction: "GrenadeTouch",
          verticalVelocityUnits: extractVelocityZUnits(defs.W_FireGrenade.body, "missile.velocity_z") ?? 200,
        },
        sourceRefs: profileSourceRefs(defs.W_FireGrenade, defs.GrenadeTouch, defs.GrenadeExplode, attackFacts.grenadelauncher.sourceRef),
      },
      rocketlauncher: {
        weapon: "rocketlauncher",
        itemFlag: "IT_ROCKET_LAUNCHER",
        runtimeKind: "projectile",
        sourceFunction: "W_FireRocket",
        ammo: extractWeaponAmmoSpend(defs.W_FireRocket.body),
        cooldownMs: attackFacts.rocketlauncher.cooldownMs,
        fireSound: extractWeaponFireSound(defs.W_FireRocket, "qcc/v101qc/weapons.qc"),
        presentation: playerWeaponPresentationFact(presentationFacts.rocketlauncher, fireAnimationFacts.rocketlauncher),
        projectile: {
          directDamage: extractRocketDirectDamage(defs.T_MissileTouch.body),
          lifetimeMs: extractNextThinkLifetimeMs(defs.W_FireRocket.body, "missile"),
          modelPath: extractSetmodelPathForVar(defs.W_FireRocket.body, "missile"),
          movetype: extractAssignmentExpression(defs.W_FireRocket.body, "missile.movetype"),
          radiusDamage: missileTouchRadiusDamage,
          speedUnits: extractVelocityScaleUnits(defs.W_FireRocket.body, "missile.velocity"),
          sourceOffsetUnits: { forward: 8, up: 16 },
          touchFunction: "T_MissileTouch",
        },
        sourceRefs: profileSourceRefs(defs.W_FireRocket, defs.T_MissileTouch, attackFacts.rocketlauncher.sourceRef),
      },
      lightning: {
        weapon: "lightning",
        itemFlag: "IT_LIGHTNING",
        runtimeKind: "beam",
        sourceFunction: "W_FireLightning",
        ammo: extractWeaponAmmoSpend(defs.W_FireLightning.body),
        cooldownMs: lightningFrameFacts.cooldownMs ?? attackFacts.lightning.cooldownMs,
        attackStartCooldownMs: attackFacts.lightning.cooldownMs,
        startSound: attackFacts.lightning.fireSound,
        presentation: playerWeaponPresentationFact(presentationFacts.lightning, fireAnimationFacts.lightning),
        fireSound: {
          ...extractWeaponFireSound(defs.W_FireLightning, "qcc/v101qc/weapons.qc"),
          cooldownMs: extractTimeWidthCooldownMs(defs.W_FireLightning.body),
        },
        beam: {
          damage: extractLightningDamageUnits(defs.W_FireLightning.body),
          damageEndForwardOffsetUnits: extractLightningDamageEndOffsetUnits(defs.W_FireLightning.body),
          damageTraceOffsetUnits: extractLightningTraceOffsetUnits(defs.LightningDamage.body),
          duplicateEntitySuppression: true,
          rangeUnits: extractTraceRangeUnits(defs.W_FireLightning.body, "v_forward"),
          sourceOffsetUnits: { up: 16 },
          startOffsetUnits: {},
          tempEntity: extractTempEntity(defs.W_FireLightning.body),
          traceCount: 3,
        },
        unsupportedBranches: [extractLightningUnderwaterBranch(defs.W_FireLightning, radiusDamageSemantics)].filter(Boolean),
        sourceRefs: profileSourceRefs(defs.W_FireLightning, defs.LightningDamage, ...lightningFrameFacts.sourceRefs),
      },
    },
  };
}

function sourceTarget(sourcePath, functionName) {
  return { sourcePath, functionName };
}

function requireFunctionDefinition(sourceText, functionName, sourcePath) {
  const definition = extractFunctionDefinition(sourceText, functionName);
  if (!definition) throw new Error(`Could not find QuakeC function ${functionName} in ${sourcePath}.`);
  return definition;
}

function profileSourceRefs(...items) {
  const out = [];
  const seen = new Set();
  for (const item of items.flat()) {
    const sourceRef = item?.bodyStartIndex !== undefined
      ? sourceRefForBodyIndex(item, sourceTarget("qcc/v101qc/weapons.qc", item.functionName), 0)
      : item;
    if (!sourceRef?.sourceFile || !sourceRef?.functionName || !sourceRef?.line) continue;
    const key = `${sourceRef.sourceFile}:${sourceRef.functionName}:${sourceRef.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sourceRef);
  }
  return out;
}

function extractPlayerWeaponAttackFacts(weaponsSource) {
  const definition = requireFunctionDefinition(weaponsSource, "W_Attack", "qcc/v101qc/weapons.qc");
  const byWeapon = {};
  for (const [weapon, itemFlag] of Object.entries({
    axe: "IT_AXE",
    shotgun: "IT_SHOTGUN",
    supershotgun: "IT_SUPER_SHOTGUN",
    nailgun: "IT_NAILGUN",
    supernailgun: "IT_SUPER_NAILGUN",
    grenadelauncher: "IT_GRENADE_LAUNCHER",
    rocketlauncher: "IT_ROCKET_LAUNCHER",
    lightning: "IT_LIGHTNING",
  })) {
    const branch = extractIfBlock(definition.body, new RegExp(`self\\.weapon\\s*==\\s*${itemFlag}`));
    const sourceRef = branch
      ? sourceRefForBodyIndex(definition, sourceTarget("qcc/v101qc/weapons.qc", "W_Attack"), branch.index)
      : sourceRefForBodyIndex(definition, sourceTarget("qcc/v101qc/weapons.qc", "W_Attack"), 0);
    const branchDefinition = branch
      ? {
          ...definition,
          body: branch.body,
          bodyStartIndex: definition.bodyStartIndex + branch.bodyIndex,
          functionName: "W_Attack",
        }
      : null;
    byWeapon[weapon] = {
      cooldownMs: branch ? parseSelfAttackFinishedCooldownMs(branch.body) : 0,
      fireSound: branchDefinition ? extractWeaponFireSound(branchDefinition, "qcc/v101qc/weapons.qc") : undefined,
      sourceRef,
    };
  }
  return byWeapon;
}

function extractPlayerWeaponPresentationFacts(weaponsSource) {
  const definition = requireFunctionDefinition(weaponsSource, "W_SetCurrentAmmo", "qcc/v101qc/weapons.qc");
  const byWeapon = {};
  for (const [weapon, itemFlag] of Object.entries({
    axe: "IT_AXE",
    shotgun: "IT_SHOTGUN",
    supershotgun: "IT_SUPER_SHOTGUN",
    nailgun: "IT_NAILGUN",
    supernailgun: "IT_SUPER_NAILGUN",
    grenadelauncher: "IT_GRENADE_LAUNCHER",
    rocketlauncher: "IT_ROCKET_LAUNCHER",
    lightning: "IT_LIGHTNING",
  })) {
    const branch = extractIfBlock(definition.body, new RegExp(`self\\.weapon\\s*==\\s*${itemFlag}`));
    if (!branch) continue;
    const currentAmmoExpression = extractAssignmentExpression(branch.body, "self.currentammo");
    const sourceAmmoField = /^self\.ammo_([A-Za-z_]\w*)$/.exec(currentAmmoExpression ?? "")?.[1];
    const weaponFrameExpression = extractAssignmentExpression(branch.body, "self.weaponframe");
    const weaponFrame = Number(weaponFrameExpression);
    const activeAmmoItemFlag = /\bself\.items\s*=\s*self\.items\s*\|\s*(IT_[A-Z_]+)/.exec(branch.body)?.[1];
    byWeapon[weapon] = {
      sourceFunction: "W_SetCurrentAmmo",
      currentAmmoExpression,
      ...(sourceAmmoField ? { currentAmmoField: quakeAmmoFieldName(sourceAmmoField) } : {}),
      ...(activeAmmoItemFlag ? { activeAmmoItemFlag } : {}),
      viewModelPath: extractAssignmentString(branch.body, "self.weaponmodel") ?? "",
      ...(Number.isFinite(weaponFrame) ? { weaponFrame } : {}),
      sourceRef: sourceRefForBodyIndex(definition, sourceTarget("qcc/v101qc/weapons.qc", "W_SetCurrentAmmo"), branch.index),
    };
  }
  return byWeapon;
}

function playerWeaponPresentationFact(presentation, fireAnimation) {
  if (!presentation) return undefined;
  return {
    ...presentation,
    ...(fireAnimation ? { fireAnimation } : {}),
  };
}

function extractPlayerWeaponFireAnimationFacts(weaponsSource, playerSource) {
  const definition = requireFunctionDefinition(weaponsSource, "W_Attack", "qcc/v101qc/weapons.qc");
  const states = parseStates(playerSource, parseFrameMap(playerSource));
  const byWeapon = {};
  for (const [weapon, itemFlag] of Object.entries({
    axe: "IT_AXE",
    shotgun: "IT_SHOTGUN",
    supershotgun: "IT_SUPER_SHOTGUN",
    nailgun: "IT_NAILGUN",
    supernailgun: "IT_SUPER_NAILGUN",
    grenadelauncher: "IT_GRENADE_LAUNCHER",
    rocketlauncher: "IT_ROCKET_LAUNCHER",
    lightning: "IT_LIGHTNING",
  })) {
    const branch = extractIfBlock(definition.body, new RegExp(`self\\.weapon\\s*==\\s*${itemFlag}`));
    if (!branch) continue;
    const startStates = extractPlayerAnimationStartStates(branch.body, states);
    const sourceRef = sourceRefForBodyIndex(definition, sourceTarget("qcc/v101qc/weapons.qc", "W_Attack"), branch.index);
    const fact = playerWeaponFireAnimationFact(startStates, states, playerSource, sourceRef);
    if (fact) byWeapon[weapon] = fact;
  }
  return byWeapon;
}

function extractPlayerAnimationStartStates(body, states) {
  const out = [];
  for (const match of body.matchAll(/\b(player_[A-Za-z0-9_]+)\s*\(\s*\)/g)) {
    const stateName = match[1];
    if (!states.has(stateName) || out.includes(stateName)) continue;
    out.push(stateName);
  }
  return out;
}

function playerWeaponFireAnimationFact(startStates, states, playerSource, attackSourceRef) {
  if (!startStates.length) return null;
  const variants = startStates
    .map((startState, index) => playerWeaponFireAnimationVariant(startState, states, playerSource, index))
    .filter(Boolean);
  if (!variants.length) return null;
  const cycle = variants.length === 1 ? playerWeaponFireAnimationCycle(variants[0]) : null;
  if (cycle) {
    return {
      frameIntervalMs: 100,
      kind: "cycle",
      sourceFunction: "W_Attack",
      sourceRefs: [attackSourceRef, ...cycle.sourceRefs],
      ...cycle.fact,
    };
  }
  return {
    frameIntervalMs: 100,
    kind: "sequence",
    sourceFunction: "W_Attack",
    sourceRefs: sourceRefsForAnimationVariants(attackSourceRef, variants),
    variants: variants.map(({ fact }) => fact),
  };
}

function playerWeaponFireAnimationVariant(startState, states, playerSource, index) {
  const chain = chainFrom(states, startState).filter((state) => state.body);
  if (!chain.length) return null;
  const frames = chain
    .map((state) => playerWeaponFireAnimationFrameFact(state, playerSource))
    .filter(Boolean);
  const sourceRefs = frames.map((frame) => frame.sourceRef);
  return {
    fact: {
      startState,
      ...(axeAnimationRandomBranch(index)),
      frames,
    },
    sourceRefs,
  };
}

function playerWeaponFireAnimationFrameFact(state, playerSource) {
  const weaponFrame = directWeaponFrameAssignment(state.body);
  const increment = weaponFrameIncrementFact(state.body);
  if (weaponFrame === null && !increment) return null;
  const sourceRef = {
    sourceFile: "qcc/v101qc/player.qc",
    functionName: state.name,
    line: lineNumberForState(playerSource, state.name) ?? 0,
  };
  return {
    calls: state.calls,
    frame: state.frame,
    playerFrameIndex: state.frameIndex,
    sourceRef,
    state: state.name,
    ...(state.body.includes("EF_MUZZLEFLASH") ? { muzzleFlash: true } : {}),
    ...(weaponFrame !== null ? { weaponFrame } : {}),
    ...(increment ? { increment } : {}),
  };
}

function playerWeaponFireAnimationCycle(variant) {
  const incrementFrames = variant.fact.frames.filter((frame) => frame.increment);
  if (!incrementFrames.length || incrementFrames.length !== variant.fact.frames.length) return null;
  const first = incrementFrames[0].increment;
  if (
    !incrementFrames.every((frame) =>
      frame.increment.add === first.add &&
      frame.increment.resetTo === first.resetTo &&
      frame.increment.wrapAt === first.wrapAt
    )
  ) {
    return null;
  }
  return {
    fact: {
      firstWeaponFrame: first.resetTo,
      lastWeaponFrame: first.wrapAt - 1,
      startState: variant.fact.startState,
      stateNames: incrementFrames.map((frame) => frame.state),
      wrapAtWeaponFrame: first.wrapAt,
    },
    sourceRefs: variant.sourceRefs,
  };
}

function directWeaponFrameAssignment(body) {
  const match = /self\.weaponframe\s*=\s*([-+]?[0-9.]+)\s*;/.exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : null;
}

function weaponFrameIncrementFact(body) {
  const incrementMatch = /self\.weaponframe\s*=\s*self\.weaponframe\s*\+\s*([-+]?[0-9.]+)\s*;/.exec(body);
  const wrapMatch =
    /if\s*\(\s*self\.weaponframe\s*==\s*([-+]?[0-9.]+)\s*\)\s*self\.weaponframe\s*=\s*([-+]?[0-9.]+)\s*;/.exec(
      body,
    );
  const add = Number(incrementMatch?.[1]);
  const wrapAt = Number(wrapMatch?.[1]);
  const resetTo = Number(wrapMatch?.[2]);
  if (!Number.isFinite(add) || !Number.isFinite(wrapAt) || !Number.isFinite(resetTo)) return null;
  return { add, resetTo, wrapAt };
}

function axeAnimationRandomBranch(index) {
  if (index === 0) return { randomLessThan: 0.25 };
  if (index === 1) return { randomLessThan: 0.5 };
  if (index === 2) return { randomLessThan: 0.75 };
  if (index === 3) return { otherwise: true };
  return {};
}

function sourceRefsForAnimationVariants(attackSourceRef, variants) {
  const out = [attackSourceRef];
  const seen = new Set(out.map(sourceRefKey));
  for (const variant of variants) {
    for (const sourceRef of variant.sourceRefs) {
      const key = sourceRefKey(sourceRef);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sourceRef);
    }
  }
  return out;
}

function sourceRefKey(sourceRef) {
  return `${sourceRef.sourceFile}:${sourceRef.functionName}:${sourceRef.line}`;
}

function extractIfBlock(body, conditionPattern) {
  const source = stripQuakeLineComments(body);
  for (const match of source.matchAll(/(?:^|\belse\s+)?if\s*\(([^)]*)\)\s*\{/g)) {
    if (!conditionPattern.test(match[1])) continue;
    const braceIndex = (match.index ?? 0) + match[0].lastIndexOf("{");
    const end = findMatchingBrace(source, braceIndex);
    if (end < 0) continue;
    return {
      body: source.slice(braceIndex + 1, end),
      bodyIndex: braceIndex + 1,
      index: match.index ?? 0,
    };
  }
  return null;
}

function extractPlayerNailFrameFacts(playerSource) {
  const states = parseStates(playerSource, parseFrameMap(playerSource));
  const sourceRefs = [];
  const offsets = [];
  let cooldownMs = 0;
  for (const stateName of ["player_nail1", "player_nail2"]) {
    const state = states.get(stateName);
    if (!state) continue;
    const offset = Number(/W_FireSpikes\s*\(\s*([-+]?[0-9.]+)\s*\)/.exec(state.body)?.[1]);
    if (Number.isFinite(offset)) offsets.push(offset);
    cooldownMs = Math.max(cooldownMs, parseSelfAttackFinishedCooldownMs(state.body));
    const line = lineNumberForState(playerSource, stateName);
    if (line) sourceRefs.push({ sourceFile: "qcc/v101qc/player.qc", functionName: stateName, line });
  }
  return {
    cooldownMs,
    offsets,
    sourceRefs,
  };
}

function extractPlayerLightningFrameFacts(playerSource) {
  const states = parseStates(playerSource, parseFrameMap(playerSource));
  const sourceRefs = [];
  let cooldownMs = 0;
  for (const stateName of ["player_light1", "player_light2"]) {
    const state = states.get(stateName);
    if (!state) continue;
    cooldownMs = Math.max(cooldownMs, parseSelfAttackFinishedCooldownMs(state.body));
    const line = lineNumberForState(playerSource, stateName);
    if (line) sourceRefs.push({ sourceFile: "qcc/v101qc/player.qc", functionName: stateName, line });
  }
  return {
    cooldownMs,
    sourceRefs,
  };
}

function lineNumberForState(sourceText, stateName) {
  const match = new RegExp(`\\bvoid\\s*\\(\\s*\\)\\s*${escapeRegExp(stateName)}\\b`).exec(sourceText);
  return match ? lineNumberAt(sourceText, match.index) : null;
}

function extractWeaponAmmoSpend(body) {
  const match = /self\.currentammo\s*=\s*self\.(ammo_[A-Za-z_]\w*)\s*=\s*self\.\1\s*-\s*([-+]?[0-9.]+)/.exec(body);
  if (!match) return undefined;
  const cost = Number(match[2]);
  return {
    cost: Number.isFinite(cost) ? cost : 0,
    field: quakeAmmoFieldName(match[1]),
    sourceField: match[1],
  };
}

function quakeAmmoFieldName(sourceField) {
  return sourceField.replace(/^ammo_/, "");
}

function extractWeaponFireSound(functionDefinition, sourcePath) {
  const match = /\bsound\s*\(\s*self\s*,\s*(CHAN_[A-Z_]+)\s*,\s*"([^"]+)"/.exec(functionDefinition.body);
  if (!match) return undefined;
  return {
    channel: match[1],
    path: match[2],
    sourceRef: sourceRefForBodyIndex(functionDefinition, sourceTarget(sourcePath, functionDefinition.functionName), match.index ?? 0),
  };
}

function extractSoundPath(body) {
  return /\bsound\s*\([^,]+,\s*[^,]+,\s*"([^"]+)"/.exec(body)?.[1];
}

function parseSelfAttackFinishedCooldownMs(body) {
  const match = /self\.attack_finished\s*=\s*time\s*\+\s*([-+]?[0-9.]+)/.exec(body);
  const seconds = Number(match?.[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

function extractTimeWidthCooldownMs(body) {
  const match = /self\.t_width\s*=\s*time\s*\+\s*([-+]?[0-9.]+)/.exec(body);
  const seconds = Number(match?.[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

function extractFireBulletsCall(body, semantics) {
  const match = /FireBullets\s*\(\s*([-+]?[0-9.]+)\s*,[^,]+,\s*('[^']+')\s*\)/.exec(body);
  const spread = match ? parseQuakeVectorExpression(match[2]) : null;
  return {
    pelletCount: Number(match?.[1] ?? 0),
    pelletDamage: semantics.pelletDamage,
    spread,
    traceRangeUnits: semantics.traceRangeUnits,
  };
}

function extractAimRangeUnits(body) {
  const match = /\baim\s*\(\s*self\s*,\s*([-+]?[0-9.]+)/.exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractTraceRangeUnits(body, vectorName) {
  const match = new RegExp(`${escapeRegExp(vectorName)}\\s*\\*\\s*([-+]?[0-9.]+)`).exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractDamageCallUnits(body, callName) {
  const match = new RegExp(`${escapeRegExp(callName)}\\s*\\([^)]*,\\s*([-+]?[0-9.]+)\\s*\\)`).exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractTouchDamageUnits(body) {
  const match = /\bT_Damage\s*\([^,]+,[^,]+,[^,]+,\s*([-+]?[0-9.]+)\s*\)/.exec(body) ??
    /\bspawn_touchblood\s*\(\s*([-+]?[0-9.]+)/.exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractSetmodelPathForVar(body, variableName) {
  const match = new RegExp(`\\bsetmodel\\s*\\(\\s*${escapeRegExp(variableName)}\\s*,\\s*"([^"]+)"`).exec(body);
  return match?.[1];
}

function extractAssignmentExpression(body, field) {
  const match = new RegExp(`\\b${escapeRegExp(field)}\\s*=\\s*([^;]+);`).exec(body);
  return match ? normalizeQuakeExpression(match[1]) : undefined;
}

function extractAssignmentString(body, field) {
  const expression = extractAssignmentExpression(body, field);
  return /^"([^"]+)"$/.exec(expression ?? "")?.[1];
}

function extractNextThinkLifetimeMs(body, variableName) {
  const match = new RegExp(`\\b${escapeRegExp(variableName)}\\.nextthink\\s*=\\s*time\\s*\\+\\s*([-+]?[0-9.]+)`).exec(body);
  const seconds = Number(match?.[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

function extractVelocityScaleUnits(body, field) {
  const selfScale = Number(
    new RegExp(`\\b${escapeRegExp(field)}\\s*=\\s*${escapeRegExp(field)}\\s*\\*\\s*([-+]?[0-9.]+)\\s*;`).exec(body)?.[1],
  );
  if (Number.isFinite(selfScale)) return selfScale;

  const directScale = Number(
    new RegExp(`\\b${escapeRegExp(field)}\\s*=\\s*[^;]*?\\*\\s*([-+]?[0-9.]+)\\b[^;]*;`).exec(body)?.[1],
  );
  return Number.isFinite(directScale) ? directScale : undefined;
}

function extractVelocityZUnits(body, field) {
  const match = new RegExp(`\\b${escapeRegExp(field)}\\s*=\\s*([-+]?[0-9.]+)\\s*;`).exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function enrichedRadiusDamageFact(radiusDamage, semantics) {
  if (!radiusDamage) return undefined;
  return {
    ...radiusDamage,
    ...semantics,
    radiusUnits: radiusDamage.damageUnits + semantics.radiusAddUnits,
  };
}

function extractRocketDirectDamage(body) {
  const match = /damg\s*=\s*([-+]?[0-9.]+)\s*\+\s*random\s*\(\s*\)\s*\*\s*([-+]?[0-9.]+)/.exec(body);
  return {
    base: Number(match?.[1] ?? 0),
    randomAdd: Number(match?.[2] ?? 0),
    halfDamageClassnames: body.includes("monster_shambler") ? ["monster_shambler"] : [],
  };
}

function extractLightningDamageUnits(body) {
  const match = /LightningDamage\s*\([^,]+,[^,]+,[^,]+,\s*([-+]?[0-9.]+)\s*\)/.exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractLightningDamageEndOffsetUnits(body) {
  const match = /trace_endpos\s*\+\s*v_forward\s*\*\s*([-+]?[0-9.]+)/.exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractLightningTraceOffsetUnits(body) {
  const match = /\bf\s*=\s*f\s*\*\s*([-+]?[0-9.]+)/.exec(body);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractTempEntity(body) {
  return /\bWriteByte\s*\(\s*MSG_BROADCAST\s*,\s*(TE_[A-Z0-9_]+)\s*\)/.exec(body)?.[1];
}

function extractLightningUnderwaterBranch(functionDefinition, semantics) {
  const branch = extractIfBlock(functionDefinition.body, /self\.waterlevel\s*>\s*1/);
  if (!branch) return null;
  const radiusMatch = /T_RadiusDamage\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\)/.exec(branch.body);
  const damagePerCell = Number(/([-+]?[0-9.]+)\s*\*\s*self\.ammo_cells/.exec(radiusMatch?.[3] ?? "")?.[1]);
  return {
    id: "lightning-underwater-discharge",
    condition: "self.waterlevel > 1",
    runtime: "unsupported-modeled-branch",
    radiusDamage: {
      attacker: radiusMatch?.[2]?.trim() ?? "self",
      call: "T_RadiusDamage",
      damageExpression: normalizeQuakeExpression(radiusMatch?.[3] ?? "35*self.ammo_cells"),
      ...(Number.isFinite(damagePerCell) ? { damagePerAmmoCell: damagePerCell } : {}),
      ignore: radiusMatch?.[4]?.trim() ?? "world",
      inflictor: radiusMatch?.[1]?.trim() ?? "self",
      ...semantics,
    },
    clearsAmmoField: "cells",
    calls: extractCalls(branch.body),
    sourceRef: sourceRefForBodyIndex(functionDefinition, sourceTarget("qcc/v101qc/weapons.qc", "W_FireLightning"), branch.index),
  };
}

function extractNoAmmoFallbackFacts(weaponsSource) {
  const checkDefinition = requireFunctionDefinition(weaponsSource, "W_CheckNoAmmo", "qcc/v101qc/weapons.qc");
  return {
    sourceFunction: "W_CheckNoAmmo",
    currentAmmoPassCondition: "self.currentammo > 0",
    axeAlwaysAllowed: /self\.weapon\s*==\s*IT_AXE[\s\S]*?return\s+TRUE/.test(checkDefinition.body),
    fallbackFunction: "W_BestWeapon",
    setCurrentAmmoFunction: "W_SetCurrentAmmo",
    bestWeaponOrder: extractBestWeaponOrder(weaponsSource),
    sourceRefs: [
      sourceRefForBodyIndex(checkDefinition, sourceTarget("qcc/v101qc/weapons.qc", "W_CheckNoAmmo"), 0),
      sourceRefForBodyIndex(
        requireFunctionDefinition(weaponsSource, "W_BestWeapon", "qcc/v101qc/weapons.qc"),
        sourceTarget("qcc/v101qc/weapons.qc", "W_BestWeapon"),
        0,
      ),
    ],
  };
}

function extractBestWeaponOrder(weaponsSource) {
  const definition = requireFunctionDefinition(weaponsSource, "W_BestWeapon", "qcc/v101qc/weapons.qc");
  const body = stripQuakeLineComments(definition.body.replace(/\/\*[\s\S]*?\*\//g, ""));
  const out = [];
  for (const match of body.matchAll(/self\.ammo_([A-Za-z_]\w*)\s*>=\s*([-+]?[0-9.]+)\s*&&\s*\(\s*it\s*&\s*(IT_[A-Z_]+)\s*\)[\s\S]*?return\s+(IT_[A-Z_]+)/g)) {
    out.push({
      ammoField: match[1],
      minAmmo: Number(match[2]),
      itemFlag: match[3],
      returns: match[4],
      weapon: playerWeaponIdForItemFlag(match[4]),
    });
  }
  const fallback = /return\s+(IT_[A-Z_]+)\s*;/.exec(body.slice(body.lastIndexOf("return")));
  if (fallback) {
    out.push({
      itemFlag: fallback[1],
      returns: fallback[1],
      weapon: playerWeaponIdForItemFlag(fallback[1]),
      fallback: true,
    });
  }
  return out;
}

function playerWeaponIdForItemFlag(itemFlag) {
  return ({
    IT_AXE: "axe",
    IT_SHOTGUN: "shotgun",
    IT_SUPER_SHOTGUN: "supershotgun",
    IT_NAILGUN: "nailgun",
    IT_SUPER_NAILGUN: "supernailgun",
    IT_GRENADE_LAUNCHER: "grenadelauncher",
    IT_ROCKET_LAUNCHER: "rocketlauncher",
    IT_LIGHTNING: "lightning",
  })[itemFlag] ?? itemFlag;
}

function extractClassnameBranchAssignments(functionDefinition, target, constants) {
  const branches = [];
  const pattern = /if\s*\(\s*self\.classname\s*==\s*"([^"]+)"\s*\)\s*\{/g;
  for (const match of functionDefinition.body.matchAll(pattern)) {
    const bodyStart = (match.index ?? 0) + match[0].lastIndexOf("{");
    const bodyEnd = findMatchingBrace(functionDefinition.body, bodyStart);
    if (bodyEnd < 0) continue;
    const branchBody = functionDefinition.body.slice(bodyStart + 1, bodyEnd);
    const assignments = extractLocalAssignments(branchBody, functionDefinition, target, constants, bodyStart + 1);
    if (!assignments.length) continue;
    branches.push({
      classname: match[1],
      assignments,
      sourceRef: sourceRefForBodyIndex(functionDefinition, target, match.index ?? 0),
    });
  }
  return branches;
}

function extractLocalAssignments(body, functionDefinition, target, constants, bodyOffset = 0) {
  const assignments = [];
  for (const match of body.matchAll(/(?<!\.)\b(?:(self(?:\.[A-Za-z_]\w*)*|other(?:\.[A-Za-z_]\w*)*)\.\s*)?([A-Za-z_]\w*)\s*=(?!=)\s*([^;]+);/g)) {
    const owner = match[1];
    const field = owner ? `${owner}.${match[2]}` : match[2];
    const expression = normalizeQuakeExpression(match[3]);
    assignments.push({
      field,
      expression,
      ...parsedProgramValueField(expression, constants),
      sourceRef: sourceRefForBodyIndex(functionDefinition, target, bodyOffset + (match.index ?? 0)),
    });
  }
  return dedupeProgramAssignments(assignments);
}

function isQuakeCallbackField(field) {
  return field === "blocked" ||
    field === "touch" ||
    field === "use" ||
    field === "think" ||
    field.startsWith("th_");
}

function extractDefaultAssignments(body, functionDefinition, target, constants) {
  const defaults = [];
  const guardedPatterns = [
    /if\s*\(\s*!\s*self\.([A-Za-z_]\w*)\s*\)\s*self\.\1\s*=(?!=)\s*([^;]+);/g,
    /if\s*\(\s*self\.([A-Za-z_]\w*)\s*==\s*0\s*\)\s*self\.\1\s*=(?!=)\s*([^;]+);/g,
  ];
  for (const pattern of guardedPatterns) {
    for (const match of body.matchAll(pattern)) {
      const expression = normalizeQuakeExpression(match[2]);
      defaults.push({
        condition: normalizeQuakeExpression(match[0].slice(0, match[0].indexOf(")") + 1)),
        field: match[1],
        expression,
        ...parsedProgramValueField(expression, constants),
        sourceRef: sourceRefForBodyIndex(functionDefinition, target, match.index ?? 0),
      });
    }
  }
  return dedupeProgramAssignments(defaults);
}

function dedupeProgramAssignments(assignments) {
  const out = [];
  const seen = new Set();
  for (const assignment of assignments) {
    const key = `${assignment.field}:${assignment.expression}:${assignment.sourceRef.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(assignment);
  }
  return out;
}

function extractSpawnflagChecks(body, functionDefinition, target, constants) {
  const checks = [];
  for (const match of body.matchAll(/\bself\.spawnflags\s*&\s*([A-Za-z_]\w*)/g)) {
    const name = match[1];
    checks.push({
      name,
      ...(constants.has(name) ? { value: constants.get(name) } : {}),
      sourceRef: sourceRefForBodyIndex(functionDefinition, target, match.index ?? 0),
    });
  }
  return dedupeSpawnflagChecks(checks);
}

function dedupeSpawnflagChecks(checks) {
  const out = [];
  const seen = new Set();
  for (const check of checks) {
    const key = `${check.name}:${check.value ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(check);
  }
  return out;
}

function extractSetmodelRefs(body, functionDefinition, target, constants) {
  const refs = [];
  for (const match of body.matchAll(/\bsetmodel\s*\(\s*self\s*,\s*([^)]+)\)/g)) {
    const expression = normalizeQuakeExpression(match[1]);
    refs.push({
      expression,
      ...parsedProgramValueField(expression, constants),
      sourceRef: sourceRefForBodyIndex(functionDefinition, target, match.index ?? 0),
    });
  }
  return refs;
}

function extractSetsizeRefs(body, functionDefinition, target, constants) {
  const refs = [];
  for (const match of body.matchAll(/\bsetsize\s*\(\s*self\s*,\s*([^,]+)\s*,\s*([^)]+)\)/g)) {
    const minExpression = normalizeQuakeExpression(match[1]);
    const maxExpression = normalizeQuakeExpression(match[2]);
    refs.push({
      minExpression,
      ...parsedProgramValueField(minExpression, constants, "min"),
      maxExpression,
      ...parsedProgramValueField(maxExpression, constants, "max"),
      sourceRef: sourceRefForBodyIndex(functionDefinition, target, match.index ?? 0),
    });
  }
  return refs;
}

function parsedProgramValueField(expression, constants, key = "value") {
  const value = parseProgramLiteralValue(expression, constants);
  return value === undefined ? {} : { [key]: value };
}

function parseProgramLiteralValue(expression, constants) {
  const text = normalizeQuakeExpression(expression);
  if (constants.has(text)) return constants.get(text);
  const quoted = /^"([^"]*)"$/.exec(text);
  if (quoted) return quoted[1];
  const vector = parseQuakeVectorExpression(text);
  if (vector) return vector;
  if (/^[-+]?[0-9.]+$/.test(text)) {
    const number = Number(text);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function normalizeQuakeExpression(expression) {
  return expression.trim().replace(/\s+/g, " ");
}

function buildMonsterChains({ callbacks, eventSemantics, source, states, target }) {
  const chainStarts = new Map();
  addResolvedChain(chainStarts, "stand", callbacks.th_stand, source, states);
  addResolvedChain(chainStarts, "walk", callbacks.th_walk, source, states);
  addResolvedChain(chainStarts, "run", callbacks.th_run, source, states);

  const primaryAttackCallback = target.primaryAttackCallback
    ? callbacks[target.primaryAttackCallback]
    : callbacks.th_missile ?? callbacks.th_melee;
  addResolvedChain(chainStarts, "attack", primaryAttackCallback, source, states);
  addResolvedChain(chainStarts, "missile", callbacks.th_missile, source, states);
  addResolvedChain(chainStarts, "melee", callbacks.th_melee, source, states);
  addResolvedChain(chainStarts, "pain_a", callbacks.th_pain, source, states);
  addResolvedChain(chainStarts, "death_a", callbacks.th_die, source, states);

  for (const [label, start] of target.extraChains ?? []) {
    addResolvedChain(chainStarts, label, start, source, states);
  }

  return Object.fromEntries(
    [...chainStarts.entries()].map(([label, start]) => [
      label,
      {
        start,
        states: chainFrom(states, start)
          .filter((state) => !state.exitsTo && !state.loopsTo && !state.missing)
          .map((state) => generatedState(state, source, eventSemantics)),
      },
    ]),
  );
}

function buildCombatPolicy({ callbacks, chains, shared, source, target }) {
  const damage = maxFrameEventDamage(Object.values(chains).flatMap((chain) => chain.states));
  const chainChoices = extractAttackChainChoices({ chains, source, target });
  const eventTypes = new Set(
    Object.values(chains)
      .flatMap((chain) => chain.states)
      .flatMap((state) => (state.events ?? []).map((event) => event.type)),
  );
  const hasRangedFrameEvents =
    eventTypes.has("fire_bullets") ||
    eventTypes.has("lightning_damage") ||
    eventTypes.has("projectile");
  if (!target.checkAttackFunction) {
    if (damage <= 0) return null;
    const genericAttack = hasRangedFrameEvents
      ? extractGenericCheckAttackPolicy(shared.fight, Boolean(callbacks.th_melee))
      : null;
    return {
      attack: {
        chain: "attack",
        cooldownMs: genericAttack?.cooldownMs ?? 0,
        cooldownRandomAddMs: genericAttack?.cooldownRandomAddMs ?? 0,
        damage,
        rangeChances: genericAttack?.rangeChances ?? {
          far: 0,
          melee: 1,
          mid: 0,
          near: 0,
        },
        rangeUnits: genericAttack?.rangeUnits ?? {
          melee: 120,
          mid: 1000,
          near: 500,
        },
        ...(genericAttack?.requiresClearShot ? { requiresClearShot: true } : {}),
        ...(chainChoices.length ? { chainChoices } : {}),
        usesFrameEvents: true,
      },
    };
  }
  const attack = extractCheckAttackPolicy(shared.fight, target.checkAttackFunction, source);
  if (!attack) return null;
  const branches = extractAttackBranches({
    checkAttackFunction: target.checkAttackFunction,
    shared,
    source,
  });
  return {
    attack: {
      ...attack,
      chain: "attack",
      ...(branches.length > 0 ? { branches } : {}),
      ...(chainChoices.length ? { chainChoices } : {}),
      ...(damage > 0 ? { damage } : {}),
      ...attackSideEffectRandomChecks(shared.fight, target.checkAttackFunction, source),
      usesFrameEvents: true,
    },
  };
}

function extractAttackChainChoices({ chains, source, target }) {
  if (!target.attackChainChoicesFunction) return [];
  const body = extractFunctionBody(source, target.attackChainChoicesFunction);
  if (!body || !/\brandom\s*\(\s*\)/.test(body)) return [];
  const randomVariable = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*random\s*\(\s*\)\s*;/.exec(body)?.[1];
  if (!randomVariable) return [];
  const startToChain = new Map();
  for (const [chainName, chain] of Object.entries(chains)) {
    if (!chain?.start || startToChain.has(chain.start)) continue;
    startToChain.set(chain.start, chainName);
  }
  const choices = [];
  const choiceRe = new RegExp(
    `(?:if|else\\s+if)\\s*\\(\\s*${randomVariable}\\s*<\\s*([0-9.]+)\\s*\\)\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\(\\s*\\)\\s*;|else\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\(\\s*\\)\\s*;`,
    "g",
  );
  for (const match of body.matchAll(choiceRe)) {
    const startFunction = match[2] ?? match[3];
    const chain = startToChain.get(startFunction);
    if (!chain) continue;
    if (match[1] !== undefined) {
      const randomLessThan = Number(match[1]);
      if (Number.isFinite(randomLessThan)) choices.push({ chain, randomLessThan });
    } else {
      choices.push({ chain, otherwise: true });
    }
  }
  return choices.length > 1 ? choices : [];
}

function extractGenericCheckAttackPolicy(sourceText, hasMelee) {
  const attack = extractCheckAttackPolicy(sourceText, "CheckAttack");
  if (!attack) return null;
  if (hasMelee) return attack;
  return {
    ...attack,
    rangeChances: {
      ...attack.rangeChances,
      mid: 0.1,
      near: 0.4,
    },
  };
}

function extractCheckAttackPolicy(sourceText, functionName, fallbackSourceText = "") {
  const body = extractFunctionBody(sourceText, functionName) ?? extractFunctionBody(fallbackSourceText, functionName);
  if (!body) return null;
  const rangeChances = {
    far: chanceForRange(body, "FAR"),
    melee: chanceForRange(body, "MELEE"),
    mid: chanceForRange(body, "MID"),
    near: chanceForRange(body, "NEAR"),
  };
  const cooldown = parseAttackFinishedCooldown(body);
  return {
    cooldownMs: cooldown.cooldownMs,
    cooldownRandomAddMs: cooldown.cooldownRandomAddMs,
    rangeChances,
    rangeUnits: {
      melee: 120,
      mid: 1000,
      near: 500,
    },
    ...(body.includes("trace_ent != targ") ? { requiresClearShot: true } : {}),
  };
}

function attackSideEffectRandomChecks(sourceText, functionName, fallbackSourceText = "") {
  const body = extractFunctionBody(sourceText, functionName) ?? extractFunctionBody(fallbackSourceText, functionName);
  if (!body) return {};
  const checks = [];
  for (const match of body.matchAll(/if\s*\(\s*random\s*\(\s*\)\s*<\s*([0-9.]+)\s*\)\s*self\.([A-Za-z_]\w*)\s*=\s*!\s*self\.\2\s*;/g)) {
    checks.push({
      chance: Number(match[1]),
      field: match[2],
      effect: "toggle",
      runtime: "rng-only",
    });
  }
  return checks.length > 0 ? { sideEffectRandomChecks: checks } : {};
}

function extractAttackBranches({ checkAttackFunction, shared, source }) {
  const body = extractFunctionBody(source, checkAttackFunction) ??
    extractFunctionBody(shared.fight, checkAttackFunction) ??
    "";
  if (!body) return [];
  if (checkAttackFunction === "DogCheckAttack") {
    return [
      meleeBranch({ source, helper: "CheckDogMelee", chain: "melee" }),
      jumpBranch({ source, helper: "CheckDogJump", chain: "missile" }),
    ].filter(Boolean);
  }
  if (checkAttackFunction === "DemonCheckAttack") {
    return [
      meleeBranch({ source, helper: "CheckDemonMelee", chain: "melee" }),
      jumpBranch({ source, helper: "CheckDemonJump", chain: "missile" }),
    ].filter(Boolean);
  }
  if (checkAttackFunction === "ShamCheckAttack") {
    return [
      meleeBranch({ body, chain: "melee" }),
      missileBranch({ body, chain: "missile", maxDistanceUnits: 600 }),
    ].filter(Boolean);
  }
  if (checkAttackFunction === "OgreCheckAttack") {
    return [
      meleeBranch({ body, chain: "melee" }),
      missileBranch({ body, chain: "missile" }),
    ].filter(Boolean);
  }
  if (checkAttackFunction === "WizardCheckAttack") {
    return [
      missileBranch({ body, chain: "missile" }),
    ].filter(Boolean);
  }
  return [];
}

function meleeBranch({ body, chain, helper, source }) {
  const helperBody = helper ? extractFunctionBody(source, helper) : body;
  if (!helperBody?.includes("RANGE_MELEE")) return null;
  return {
    chain,
    kind: "melee",
    maxRangeUnits: 120,
    ...(helperBody.includes("CanDamage") ? { requiresCanDamage: true } : {}),
  };
}

function jumpBranch({ chain, helper, source }) {
  const helperBody = extractFunctionBody(source, helper);
  if (!helperBody) return null;
  const minRangeUnits = Number(/if\s*\(\s*d\s*<\s*([0-9.]+)\s*\)\s*return\s+FALSE/.exec(helperBody)?.[1] ?? 0);
  const maxRangeUnits = Number(/if\s*\(\s*d\s*>\s*([0-9.]+)\s*\)\s*(?:return\s+FALSE|\{)/.exec(helperBody)?.[1] ?? 0);
  const rejectChance = Number(/if\s*\(\s*random\s*\(\s*\)\s*<\s*([0-9.]+)\s*\)\s*return\s+FALSE/.exec(helperBody)?.[1] ?? 0);
  return {
    chain,
    kind: "missile",
    ...(minRangeUnits > 0 ? { minRangeUnits } : {}),
    ...(maxRangeUnits > 0 && rejectChance <= 0 ? { maxRangeUnits } : {}),
    ...(rejectChance > 0 ? { chanceBeyondMaxRange: roundedChance(Math.max(0, 1 - rejectChance)) } : {}),
    ...(maxRangeUnits > 0 && rejectChance > 0 ? { chanceRangeUnits: maxRangeUnits } : {}),
    requiresVerticalOverlap: true,
  };
}

function roundedChance(value) {
  return Math.round(value * 1000) / 1000;
}

function missileBranch({ body, chain, maxDistanceUnits }) {
  if (!body.includes("AS_MISSILE") && !body.includes("self.th_missile")) return null;
  const cooldown = parseAttackFinishedCooldown(body);
  const rangeChances = {
    far: chanceForRange(body, "FAR"),
    melee: chanceForRange(body, "MELEE"),
    mid: chanceForRange(body, "MID"),
    near: chanceForRange(body, "NEAR"),
  };
  const appliesRangeChance = /\brandom\s*\(\s*\)\s*<\s*chance\b/.test(body);
  const hasRangeChance = appliesRangeChance && Object.values(rangeChances).some((chance) => chance > 0);
  const tracedMaxDistanceUnits = maxDistanceUnits ??
    Number(/vlen\s*\(\s*spot1\s*-\s*spot2\s*\)\s*>\s*([0-9.]+)/.exec(body)?.[1] ?? 0);
  return {
    chain,
    kind: "missile",
    cooldownMs: cooldown.cooldownMs,
    cooldownRandomAddMs: cooldown.cooldownRandomAddMs,
    ...(tracedMaxDistanceUnits > 0 ? { maxDistanceUnits: tracedMaxDistanceUnits } : {}),
    ...(body.includes("RANGE_FAR") ? { maxRangeUnits: 1000 } : {}),
    ...(body.includes("trace_ent != targ") ? { requiresClearShot: true } : {}),
    ...(hasRangeChance ? { rangeChances } : {}),
  };
}

function chanceForRange(body, rangeName) {
  const pattern = new RegExp(
    `(?:if|else\\s+if)\\s*\\(\\s*enemy_range\\s*==\\s*RANGE_${rangeName}\\s*\\)\\s*(?:\\{\\s*)?chance\\s*=\\s*([0-9.]+)`,
    "m",
  );
  const match = pattern.exec(body);
  return match ? Number(match[1]) : 0;
}

function parseAttackFinishedCooldown(body) {
  const scaledRandomAddMatch = /SUB_AttackFinished\s*\(\s*([0-9.]+)\s*\+\s*([0-9.]+)\s*\*\s*random\s*\(\s*\)\s*\)/.exec(body);
  if (scaledRandomAddMatch) {
    return {
      cooldownMs: Math.round(Number(scaledRandomAddMatch[1]) * 1000),
      cooldownRandomAddMs: Math.round(Number(scaledRandomAddMatch[2]) * 1000),
    };
  }
  const randomAddMatch = /SUB_AttackFinished\s*\(\s*([0-9.]+)\s*\+\s*random\s*\(\s*\)\s*\)/.exec(body);
  if (randomAddMatch) {
    return {
      cooldownMs: Math.round(Number(randomAddMatch[1]) * 1000),
      cooldownRandomAddMs: 1000,
    };
  }
  const scaledRandomMatch = /SUB_AttackFinished\s*\(\s*([0-9.]+)\s*\*\s*random\s*\(\s*\)\s*\)/.exec(body);
  if (scaledRandomMatch) {
    return {
      cooldownMs: 0,
      cooldownRandomAddMs: Math.round(Number(scaledRandomMatch[1]) * 1000),
    };
  }
  const fixedMatch = /SUB_AttackFinished\s*\(\s*([0-9.]+)\s*\)/.exec(body);
  if (fixedMatch) {
    return {
      cooldownMs: Math.round(Number(fixedMatch[1]) * 1000),
      cooldownRandomAddMs: 0,
    };
  }
  return {
    cooldownMs: 0,
    cooldownRandomAddMs: 0,
  };
}

function extractFireBulletsSemantics(weaponsSource) {
  const body = extractFunctionBody(weaponsSource, "FireBullets") ?? "";
  const pelletDamage = Number(/TraceAttack\s*\(\s*([0-9.]+)\s*,/.exec(body)?.[1] ?? 4);
  const traceRangeUnits = Number(/direction\s*\*\s*([0-9.]+)/.exec(body)?.[1] ?? 2048);
  return { pelletDamage, traceRangeUnits };
}

function maxFrameEventDamage(states) {
  return Math.max(0, ...states.flatMap((state) => (state.events ?? []).map(frameEventDamage)));
}

function frameEventDamage(event) {
  if (event.type === "fire_bullets") return event.pellets * event.pelletDamage;
  if (event.type === "lightning_damage") return event.damage;
  if (event.type === "melee_damage") return event.damageBase + event.damageRandomTerms.reduce((total, term) => total + term, 0);
  if (event.type === "projectile") return event.damage;
  if (event.type === "touch_damage") return event.damageBase + event.damageRandomTerms.reduce((total, term) => total + term, 0);
  return 0;
}

function addResolvedChain(chainStarts, label, candidate, source, states) {
  const start = resolveStateStart(candidate, source, states);
  if (!start || chainStarts.has(label)) return;
  chainStarts.set(label, start);
}

function resolveStateStart(candidate, source, states) {
  if (!candidate) return null;
  if (states.has(candidate)) return candidate;
  const body = extractFunctionBody(source, candidate);
  if (!body) return null;
  return stateCallsIn(body, states)[0] ?? null;
}

function stateCallsIn(body, states) {
  const calls = [];
  for (const match of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const call = match[1];
    if (states.has(call) && !calls.includes(call)) calls.push(call);
  }
  return calls;
}

function extractFunctionBody(sourceText, functionName) {
  return extractFunctionDefinition(sourceText, functionName)?.body ?? null;
}

function extractFunctionDefinition(sourceText, functionName) {
  const signaturePattern = new RegExp(`(?:void|float)\\s*(?:\\([^)]*\\))?\\s*${escapeRegExp(functionName)}\\s*=\\s*\\{`, "m");
  const signature = signaturePattern.exec(sourceText);
  if (!signature) return null;
  const bodyStart = signature.index + signature[0].lastIndexOf("{");
  const bodyEnd = findMatchingBrace(sourceText, bodyStart);
  if (bodyEnd < 0) return null;
  return {
    body: sourceText.slice(bodyStart + 1, bodyEnd),
    bodyStartIndex: bodyStart + 1,
    endLine: lineNumberAt(sourceText, bodyEnd),
    functionName,
    sourceText,
    startLine: lineNumberAt(sourceText, signature.index),
  };
}

function sourceRefForBodyIndex(functionDefinition, target, bodyIndex) {
  return {
    sourceFile: target.sourcePath,
    functionName: target.functionName,
    line: lineNumberAt(functionDefinition.sourceText, functionDefinition.bodyStartIndex + bodyIndex),
  };
}

function lineNumberAt(text, index) {
  return text.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function findMatchingBrace(text, startIndex) {
  let depth = 0;
  let quote = null;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === "\"") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function normalizeBody(body) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function extractCalls(body) {
  const ignored = new Set(["if", "local", "normalize", "random"]);
  const source = stripQuakeLineComments(body);
  const calls = [];
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    if (source[(match.index ?? 0) - 1] === ".") continue;
    const call = match[1];
    if (!ignored.has(call) && !calls.includes(call)) calls.push(call);
  }
  return calls;
}

function extractAiMovementCalls(body) {
  const source = stripQuakeLineComments(body);
  return [...source.matchAll(/\b(ai_(?:back|charge|face|forward|melee|pain|painforward|run|stand|walk))\s*\(([^)]*)\)/g)]
    .map((match) => {
      const distance = Number(match[2].split(",")[0]?.trim() ?? "");
      return {
        call: match[1],
        ...(Number.isFinite(distance) ? { distanceUnits: distance } : {}),
      };
    });
}

function stripQuakeLineComments(source) {
  return source.replace(/\/\/.*$/gm, (match) => " ".repeat(match.length));
}

function extractSounds(body) {
  const sounds = [];
  for (const match of body.matchAll(/"([^"]+\.wav)"/g)) {
    if (!sounds.includes(match[1])) sounds.push(match[1]);
  }
  return sounds;
}

function extractUnconditionalSounds(body, conditionalSounds) {
  const conditional = new Set(conditionalSounds.map((sound) => sound.soundPath));
  return extractSounds(body).filter((soundPath) => !conditional.has(soundPath));
}

function extractConditionalSounds(body) {
  const sounds = [];
  const source = stripQuakeLineComments(body);
  const pattern = /if\s*\(\s*random\s*\(\s*\)\s*([<>])\s*([0-9.]+)\s*\)\s*(?:\{\s*)?sound\s*\([^,]+,\s*[^,]+,\s*"([^"]+\.wav)"/g;
  for (const match of source.matchAll(pattern)) {
    const [, operator, thresholdText, soundPath] = match;
    const threshold = Number(thresholdText);
    if (!Number.isFinite(threshold)) continue;
    const chance = operator === "<" ? threshold : 1 - threshold;
    sounds.push({
      chance: Math.max(0, Math.min(1, chance)),
      soundPath,
    });
  }
  return sounds;
}

function chainFrom(states, startState) {
  const chain = [];
  const seen = new Set();
  const prefix = statePrefix(startState);
  let current = startState;
  let exited = false;
  while (current && !seen.has(current)) {
    const state = states.get(current);
    if (!state) {
      chain.push({ missing: true, name: current });
      break;
    }
    chain.push(state);
    seen.add(current);
    if (!state.next.startsWith(prefix)) {
      chain.push({ exitsTo: state.next, name: state.next });
      exited = true;
      break;
    }
    current = state.next;
  }
  if (!exited && current && seen.has(current)) chain.push({ loopsTo: current, name: current });
  return chain;
}

function statePrefix(stateName) {
  return stateName.replace(/\d+$/, "");
}

function renderMonstersReport(extracted) {
  const rows = extracted.map((entry) => {
    const { target } = entry;
    return [
      target.label,
      `\`${target.classname}\``,
      `\`${target.sourcePath}\``,
      entry.frameMap.size,
      entry.states.size,
      Object.keys(entry.chains).map((chain) => `\`${chain}\``).join(", "),
    ];
  });
  return `# QuakeC Monster Logic Extraction Report

Generated by \`src/prepare/quakecLogic.mjs\`.

## Source

| Field | Value |
| --- | --- |
| Repository | ${quakeToolsRepositoryUrl} |
| Revision | \`${quakeToolsRevision}\` |
| License | GPL-2.0-or-later header in source files |

## Extraction Scope

Parsed for all generated animated monster targets:

- \`$frame\` declarations
- \`void() state = [ $frame, next_state ] { body; };\` declarations
- spawn-function \`self.th_*\` callback assignments when present
- spawn-function \`setmodel\`, \`setsize\`, and \`walkmonster_start\` / \`flymonster_start\` / \`swimmonster_start\` metadata
- dispatch functions that call state starts, such as \`army_die\`, \`Wiz_Missile\`, and \`demon_die\`
- frame call names and sound references
- currently supported executable event payloads such as \`FireBullets\`, frame-timed \`T_Damage\` melee calls, projectile spawns, easy-skill shambler lightning, and armed \`self.touch\` damage callbacks
- currently supported attack policies such as \`SoldierCheckAttack\` and generated melee-only frame-event policies

Not parsed as executable semantics yet:

- full QuakeC expression evaluation
- exact \`ai_*\` movement, except supported \`ai_melee\` / \`ai_melee_side\` damage events
- exact projectile bounce/radius behavior, grenade arcs, and full QuakeC touch physics
- medium/hard/nightmare-only skill branches
- boss map-script semantics

## Extracted Targets

| Monster | Classname | Source | Frames | States | Generated chains |
| --- | --- | --- | ---: | ---: | --- |
${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}

## Runtime Implication

The generated data can now drive QuakeC frame-chain selection for all 9 generated animated monsters. cssQuake does not use hand-authored monster combat fallback; monsters without generated executable combat coverage should remain non-combat until QuakeC-derived support is added.
`;
}

function renderProgramFactsReport(programFacts) {
  const entities = Object.values(programFacts.entities);
  const rows = entities.map((entity) => [
    `\`${entity.classname}\``,
    entity.kind,
    `\`${entity.source.sourceFile}:${entity.sourceRefs[0]?.line ?? ""}\``,
    entity.assetRefs.length,
    entity.dependencies.models.length,
    entity.dependencies.sounds.length,
    Object.keys(entity.callbacks).map((callback) => `\`${callback}\``).join(", "),
    entity.defaultAssignments.map((assignment) => `\`${assignment.field}=${assignment.expression}\``).join(", "),
    entity.spawnflagChecks.map((check) => `\`${check.name}${check.value !== undefined ? `:${check.value}` : ""}\``).join(", "),
  ]);
  const playerWeaponRows = Object.values(programFacts.playerWeapons?.profiles ?? {}).map((profile) => [
    `\`${profile.weapon}\``,
    profile.runtimeKind,
    `\`${profile.sourceFunction}\``,
    profile.ammo ? `\`${profile.ammo.field}:${profile.ammo.cost}\`` : "",
    profile.cooldownMs,
    profile.fireSound?.path ? `\`${profile.fireSound.path}\`` : "",
    profile.hitscan
      ? `pellets:${profile.hitscan.pelletCount}`
      : profile.projectile
        ? `projectile:${profile.projectile.modelPath ?? profile.projectile.touchFunction ?? ""}`
        : profile.beam
          ? `beam:${profile.beam.rangeUnits ?? ""}`
          : profile.melee
            ? `melee:${profile.melee.rangeUnits}`
            : "",
  ]);

  return `# QuakeC Program Facts Extraction Report

Generated by \`src/prepare/quakecLogic.mjs\`.

## Source

| Field | Value |
| --- | --- |
| Repository | ${quakeToolsRepositoryUrl} |
| Revision | \`${quakeToolsRevision}\` |
| License | GPL-2.0-or-later header in source files |

## Extraction Scope

This first pass extracts source-derived facts only. It does not execute QuakeC and does not change runtime behavior.

Parsed for representative entities:

- spawn function source refs
- direct \`self.*\` assignments
- callback assignments such as \`self.touch\`, \`self.use\`, \`self.blocked\`, and \`self.th_*\`
- guarded defaults such as \`if (!self.speed) self.speed = 150\`
- normalized asset refs from \`precache_model\`, \`precache_sound\`, and \`setmodel\`, including BSPs, MDLs, sprites, and sounds
- legacy model/sound dependency arrays preserved for current consumers
- \`setsize\`
- spawnflag checks with constant values when available in the same source or shared \`defs.qc\`
- player weapon fire profile facts from \`weapons.qc\` and player firing frame cadence from \`player.qc\`

Not parsed as executable semantics yet:

- arbitrary expression evaluation
- branch-specific assignment conditions beyond simple guarded defaults
- target graph resolution
- BSP brush model bounds
- runtime mover or trigger behavior
- selected weapon attacks, sampled spread/random damage, projectile flight outcomes, line of sight, collision, and other playthrough outcomes

## Player Weapon Fire Facts

| Weapon | Kind | Source function | Ammo | Cooldown ms | Fire sound | Shape |
| --- | --- | --- | --- | ---: | --- | --- |
${playerWeaponRows.map((row) => `| ${row.join(" | ")} |`).join("\n")}

## Extracted Entities

| Classname | Kind | Source | Assets | Models | Sounds | Callbacks | Defaults | Spawnflags |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}

## Runtime Implication

None yet. These facts are generated for audit and fixtures before runtime systems consume them.
`;
}

function renderSingleMonsterReport(entry) {
  const { callbacks, chains, frameMap, sourceMetadata, states, target } = entry;
  const frameRows = [...frameMap.entries()]
    .map(([frame, index]) => `| ${index} | \`${frame}\` |`)
    .join("\n");
  const chainSections = Object.entries(chains)
    .map(([label, chain]) => renderChainSection(label, chain.start, chainFrom(states, chain.start)))
    .join("\n\n");

  return `# QuakeC ${titleCase(target.label)} Logic Extraction Report

Generated by \`src/prepare/quakecLogic.mjs\`.

## Source

| Field | Value |
| --- | --- |
| Repository | ${quakeToolsRepositoryUrl} |
| Revision | \`${quakeToolsRevision}\` |
| Source file | \`${sourceMetadata.sourceFile}\` |
| Raw URL | ${sourceMetadata.sourceUrl} |
| Source SHA-256 | \`${sourceMetadata.sourceSha256}\` |
| License | ${sourceMetadata.license} |

## Monster Callback Entry Points

| Callback | State/function |
| --- | --- |
${Object.entries(callbacks).map(([key, value]) => `| \`${key}\` | \`${value}\` |`).join("\n")}

## Frame Map

| MDL frame index | QC frame |
| --- | --- |
${frameRows}

## State Chains

${chainSections}
`;
}

function renderChainSection(label, start, chain) {
  return `### ${label}: \`${start}\`

| State | Frame | Index | Next | Calls | Sounds |
| --- | --- | ---: | --- | --- | --- |
${chain.map(renderChainRow).join("\n")}`;
}

function renderChainRow(state) {
  if (state.missing) return `| \`${state.name}\` | Missing |  |  |  |  |`;
  if (state.exitsTo) return `| exits |  |  | \`${state.exitsTo}\` |  |  |`;
  if (state.loopsTo) return `| loops |  |  | \`${state.loopsTo}\` |  |  |`;
  return `| \`${state.name}\` | \`${state.frame}\` | ${state.frameIndex ?? ""} | \`${state.next}\` | ${formatInlineList(state.calls)} | ${formatInlineList(state.sounds)} |`;
}

function renderGeneratedLogic(extracted, shootableLogic = {}) {
  const sources = Object.fromEntries(
    extracted.map(({ sourceMetadata, target }) => [target.classname, sourceMetadata]),
  );
  const combatPolicies = Object.fromEntries(
    extracted
      .filter(({ combatPolicy }) => Boolean(combatPolicy))
      .map(({ combatPolicy, target }) => [target.classname, combatPolicy]),
  );
  const monsters = Object.fromEntries(
    extracted.map(({ callbacks, chains, deathOutput, scriptedLifecycle, spawnProfile, target }) => [
      target.classname,
      {
        callbacks,
        chains,
        classname: target.classname,
        ...(deathOutput ? { deathOutput } : {}),
        modelPath: target.modelPath,
        ...(target.reactionProfile ? { reactionProfile: target.reactionProfile } : {}),
        ...(scriptedLifecycle ? { scriptedLifecycle } : {}),
        spawnProfile,
      },
    ]),
  );

  return `// Generated by src/prepare/quakecLogic.mjs. Do not edit by hand.
// Derived from id Software QuakeC source in Quake-Tools qcc/v101qc.
// Source license: GPL-2.0-or-later header in the source files.
// cssQuake distribution license: GPL-2.0-only.
// Source revision: ${quakeToolsRevision}

export interface QuakeMonsterLogicSourceMetadata {
  license: string;
  repository: string;
  revision: string;
  sourceFile: string;
  sourceSha256: string;
  sourceUrl: string;
}

export interface QuakeMonsterAttackRangeChances {
  far: number;
  melee: number;
  mid: number;
  near: number;
}

export interface QuakeMonsterAttackRangeUnits {
  melee: number;
  mid: number;
  near: number;
}

export interface QuakeMonsterAttackSideEffectRandomCheck {
  chance: number;
  effect: "toggle";
  field: string;
  runtime: "rng-only";
}

export interface QuakeMonsterAttackBranchPolicy {
  chain: string;
  chanceBeyondMaxRange?: number;
  chanceRangeUnits?: number;
  cooldownMs?: number;
  cooldownRandomAddMs?: number;
  kind: "melee" | "missile";
  maxDistanceUnits?: number;
  maxRangeUnits?: number;
  minRangeUnits?: number;
  rangeChances?: QuakeMonsterAttackRangeChances;
  requiresCanDamage?: boolean;
  requiresClearShot?: boolean;
  requiresVerticalOverlap?: boolean;
}

export interface QuakeMonsterAttackChainChoice {
  chain: string;
  otherwise?: boolean;
  randomLessThan?: number;
}

export interface QuakeMonsterAttackPolicy {
  branches?: readonly QuakeMonsterAttackBranchPolicy[];
  chain: string;
  chainChoices?: readonly QuakeMonsterAttackChainChoice[];
  cooldownMs: number;
  cooldownRandomAddMs?: number;
  damage?: number;
  rangeChances: QuakeMonsterAttackRangeChances;
  rangeUnits: QuakeMonsterAttackRangeUnits;
  requiresClearShot?: boolean;
  sideEffectRandomChecks?: readonly QuakeMonsterAttackSideEffectRandomCheck[];
  usesFrameEvents?: boolean;
}

export interface QuakeMonsterCombatPolicy {
  attack?: QuakeMonsterAttackPolicy;
}

export interface QuakeMonsterAiMovementCall {
  call: string;
  distanceUnits?: number;
}

export interface QuakeMonsterConditionalFrameSound {
  chance: number;
  soundPath: string;
}

export type QuakeMonsterStartKind = "fly" | "swim" | "unknown" | "walk";

export interface QuakeMonsterBoundsUnits {
  max: readonly [number, number, number];
  min: readonly [number, number, number];
}

export interface QuakeMonsterSpawnProfile {
  bounds?: QuakeMonsterBoundsUnits;
  dropToFloor: boolean;
  health?: number;
  modelPath: string;
  startKind: QuakeMonsterStartKind;
}

export interface QuakeShootableRadiusDamageFact {
  attacker: string;
  attackerSelfScale: number;
  call: "T_RadiusDamage";
  damageUnits: number;
  distanceScale: number;
  ignore: string;
  inflictor: string;
  radiusAddUnits: number;
  radiusUnits: number;
  requiresCanDamage: boolean;
  shamblerScale: number;
  sourceRef?: {
    sourceFile: string;
    functionName: string;
    line: number;
  };
}

export interface QuakeShootableLogicDefinition {
  classname: string;
  death?: {
    callback: string;
    radiusDamage?: QuakeShootableRadiusDamageFact;
  };
}

export interface QuakeMonsterBossLifecycleHealthBySkill {
  easy: number;
  normal: number;
  hard: number;
}

export interface QuakeMonsterBossLifecyclePainBranch {
  afterHealth?: number;
  afterHealthMin?: number;
  chain: string;
  functionName: string;
}

export interface QuakeMonsterBossScriptedLifecycle {
  kind: "boss";
  spawnUseFunction: string;
  awake: {
    bounds?: QuakeMonsterBoundsUnits;
    functionName: "boss_awake";
    healthBySkill: QuakeMonsterBossLifecycleHealthBySkill;
    modelPath: string;
    startFunction: "boss_rise1";
    takedamage: "DAMAGE_NO";
  };
  lightning: {
    alignment: {
      damageState: "STATE_TOP";
      requiresMatchingState: boolean;
      targetField: "target";
      validStates: readonly ["STATE_TOP", "STATE_BOTTOM"];
    };
    bossLookupClassname: "monster_boss";
    damagePerUse: number;
    electrodeTargetName: "lightning";
    eventClassname: "event_lightning";
    fireIntervalMs?: number;
    painBranches: readonly QuakeMonsterBossLifecyclePainBranch[];
    painSoundPath?: string;
    resetAfterMs?: number;
    resetFunction?: "door_go_down";
    soundPath?: string;
    tempEntity?: "TE_LIGHTNING3";
    useFunction: "lightning_use";
  };
  death: {
    incrementsKilledMonsters: boolean;
    removesSelf: boolean;
    terminalState: "boss_death10";
    usesTargets: boolean;
  };
}

export type QuakeMonsterScriptedLifecycle = QuakeMonsterBossScriptedLifecycle;

export interface QuakeMonsterFireBulletsFrameEvent {
  call: string;
  pelletDamage: number;
  pellets: number;
  spread: readonly [number, number, number];
  traceRangeUnits: number;
  type: "fire_bullets";
}

export interface QuakeMonsterProjectileOffsetUnits {
  forward?: number;
  right?: number;
  up?: number;
}

export interface QuakeMonsterLightningDamageFrameEvent {
  call: string;
  damage: number;
  originOffsetUnits?: QuakeMonsterProjectileOffsetUnits;
  rangeUnits: number;
  target: "enemy";
  targetOffsetUnits?: QuakeMonsterProjectileOffsetUnits;
  type: "lightning_damage";
}

export interface QuakeMonsterMeleeDamageFrameEvent {
  call: string;
  damageBase: number;
  damageRandomTerms: readonly number[];
  rangeUnits?: number;
  requiresCanDamage?: boolean;
  target: "enemy";
  type: "melee_damage";
}

export interface QuakeMonsterProjectileFrameEvent {
  call: string;
  classname: string;
  damage: number;
  delayMs?: number;
  lifetimeMs: number;
  modelPath: string;
  originOffsetUnits?: QuakeMonsterProjectileOffsetUnits;
  radiusUnits: number;
  speedUnits: number;
  target: "enemy";
  targetOffsetUnits?: QuakeMonsterProjectileOffsetUnits;
  type: "projectile";
  verticalVelocityUnits?: number;
}

export interface QuakeMonsterTouchDamageFrameEvent {
  call: string;
  damageBase: number;
  damageRandomTerms: readonly number[];
  durationMs: number;
  minVelocityUnits?: number;
  rangeUnits: number;
  target: "touching";
  type: "touch_damage";
}

export type QuakeMonsterFrameEvent =
  QuakeMonsterFireBulletsFrameEvent |
  QuakeMonsterLightningDamageFrameEvent |
  QuakeMonsterMeleeDamageFrameEvent |
  QuakeMonsterProjectileFrameEvent |
  QuakeMonsterTouchDamageFrameEvent;

export interface QuakeMonsterFrameState {
  calls: readonly string[];
  conditionalSounds?: readonly QuakeMonsterConditionalFrameSound[];
  events?: readonly QuakeMonsterFrameEvent[];
  frame: string;
  frameIndex: number;
  movement?: readonly QuakeMonsterAiMovementCall[];
  name: string;
  next: string;
  sounds: readonly string[];
}

export interface QuakeMonsterStateChain {
  start: string;
  states: readonly QuakeMonsterFrameState[];
}

export interface QuakeMonsterDeathGibOutput {
  damageAtLeast?: number;
  gibModelPaths: readonly string[];
  headModelPath?: string;
  healthBelow?: number;
  modelPaths: readonly string[];
  pieces: readonly QuakeMonsterDeathOutputPiece[];
  soundPath?: string;
  sourceFunction: string;
}

export interface QuakeMonsterDeathOutputPiece {
  call: "ThrowGib" | "ThrowHead";
  modelPath: string;
}

export interface QuakeMonsterDeathBackpackProfile {
  bounds?: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  };
  modelPath: string;
  originOffsetUnits?: readonly [number, number, number];
  pickupSoundPath?: string;
  removeAfterSeconds?: number;
  sourceFunction: "DropBackpack";
  touchFunction: "BackpackTouch";
}

export interface QuakeMonsterDeathBackpackDrop {
  ammo?: Readonly<Record<string, number>>;
  chain: string;
  frameIndex: number;
  stateName: string;
}

export interface QuakeMonsterDeathSolidNotState {
  chain: string;
  frameIndex: number;
  stateName: string;
}

export interface QuakeMonsterDeathOutputProfile {
  backpack?: QuakeMonsterDeathBackpackProfile;
  backpackDrops?: readonly QuakeMonsterDeathBackpackDrop[];
  gib?: QuakeMonsterDeathGibOutput;
  solidNotStates?: readonly QuakeMonsterDeathSolidNotState[];
}

export interface QuakeMonsterRandomBranch {
  chain: string;
  cooldownMs?: number;
  otherwise?: boolean;
  randomGreaterThan?: number;
  randomLessThan?: number;
}

export interface QuakeMonsterPainReactionProfile {
  branches: readonly QuakeMonsterRandomBranch[];
  cooldownMs?: number;
  cooldownOnFailedFlinch?: boolean;
  flinchDamageRandomScale?: number;
  sourceFunction: string;
}

export interface QuakeMonsterDeathReactionProfile {
  gibHealthBelow?: number;
  regularBranches: readonly QuakeMonsterRandomBranch[];
  sourceFunction: string;
}

export interface QuakeMonsterReactionProfile {
  death?: QuakeMonsterDeathReactionProfile;
  pain?: QuakeMonsterPainReactionProfile;
}

export interface QuakeMonsterLogicDefinition {
  callbacks: Readonly<Record<string, string>>;
  chains: Readonly<Record<string, QuakeMonsterStateChain>>;
  classname: string;
  deathOutput?: QuakeMonsterDeathOutputProfile;
  modelPath: string;
  reactionProfile?: QuakeMonsterReactionProfile;
  scriptedLifecycle?: QuakeMonsterScriptedLifecycle;
  spawnProfile: QuakeMonsterSpawnProfile;
}

export const QUAKE_MONSTER_LOGIC_SOURCES = ${json(sources)} as const satisfies Readonly<Record<string, QuakeMonsterLogicSourceMetadata>>;

export const QUAKE_MONSTER_LOGIC_SOURCE = QUAKE_MONSTER_LOGIC_SOURCES.monster_army;

export const QUAKE_MONSTER_COMBAT_POLICIES = ${json(combatPolicies)} as const satisfies Readonly<Record<string, QuakeMonsterCombatPolicy>>;

export const QUAKE_SHOOTABLE_LOGIC = ${json(shootableLogic)} as const satisfies Readonly<Record<string, QuakeShootableLogicDefinition>>;

export const QUAKE_MONSTER_LOGIC = ${json(monsters)} as const satisfies Readonly<Record<string, QuakeMonsterLogicDefinition>>;
`;
}

function renderGeneratedProgramFacts(programFacts) {
  return `// Generated by src/prepare/quakecLogic.mjs. Do not edit by hand.
// Derived from id Software QuakeC source in Quake-Tools qcc/v101qc.
// Source license: GPL-2.0-or-later header in the source files.
// cssQuake distribution license: GPL-2.0-only.
// Source revision: ${quakeToolsRevision}

export type QuakeProgramEntityKind = "misc" | "monster" | "mover" | "pickup" | "shootable" | "trigger";

export type QuakeProgramAssetKind = "bsp" | "model" | "sound" | "sprite" | "unknown";

export type QuakeProgramFactValue = number | string | readonly [number, number, number];

export interface QuakeProgramLogicSourceMetadata {
  license: string;
  repository: string;
  revision: string;
  sourceFile: string;
  sourceSha256: string;
  sourceUrl: string;
}

export interface QuakeProgramSourceRef {
  sourceFile: string;
  functionName: string;
  line: number;
}

export interface QuakeProgramDependencyRef {
  call: string;
  path: string;
  sourceRef: QuakeProgramSourceRef;
}

export interface QuakeProgramAssetRef {
  call: string;
  kind: QuakeProgramAssetKind;
  path: string;
  sourceRef: QuakeProgramSourceRef;
}

export interface QuakeProgramFieldAssignment {
  condition?: string;
  expression: string;
  field: string;
  sourceRef: QuakeProgramSourceRef;
  value?: QuakeProgramFactValue;
}

export interface QuakeProgramSetmodelRef {
  expression: string;
  sourceRef: QuakeProgramSourceRef;
  value?: QuakeProgramFactValue;
}

export interface QuakeProgramSetsizeRef {
  max?: QuakeProgramFactValue;
  maxExpression: string;
  min?: QuakeProgramFactValue;
  minExpression: string;
  sourceRef: QuakeProgramSourceRef;
}

export interface QuakeProgramSpawnflagCheck {
  name: string;
  sourceRef: QuakeProgramSourceRef;
  value?: number;
}

export interface QuakeProgramEntityFact {
  assetRefs: readonly QuakeProgramAssetRef[];
  callbackFacts?: Readonly<Record<string, QuakeProgramCallbackFact>>;
  callbacks: Readonly<Record<string, string>>;
  calls: readonly string[];
  classname: string;
  defaultAssignments: readonly QuakeProgramFieldAssignment[];
  dependencies: {
    models: readonly QuakeProgramDependencyRef[];
    sounds: readonly QuakeProgramDependencyRef[];
  };
  fieldAssignments: readonly QuakeProgramFieldAssignment[];
  functionName: string;
  kind: QuakeProgramEntityKind;
  setmodels: readonly QuakeProgramSetmodelRef[];
  setsizes: readonly QuakeProgramSetsizeRef[];
  source: QuakeProgramLogicSourceMetadata;
  sourceRefs: readonly QuakeProgramSourceRef[];
  spawnflagChecks: readonly QuakeProgramSpawnflagCheck[];
}

export interface QuakeProgramCallbackClassnameBranchFact {
  assignments: readonly QuakeProgramFieldAssignment[];
  classname: string;
  sourceRef: QuakeProgramSourceRef;
}

export interface QuakeProgramCallbackFact {
  assignments?: readonly QuakeProgramFieldAssignment[];
  assetRefs?: readonly QuakeProgramAssetRef[];
  calls?: readonly string[];
  classnameBranches?: readonly QuakeProgramCallbackClassnameBranchFact[];
  radiusDamage?: readonly QuakeProgramRadiusDamageFact[];
  sourceRefs: readonly QuakeProgramSourceRef[];
}

export interface QuakeProgramRadiusDamageFact {
  attacker: string;
  call: "T_RadiusDamage";
  damageUnits: number;
  ignore: string;
  inflictor: string;
  sourceRef: QuakeProgramSourceRef;
}

export type QuakePlayerWeaponId =
  "axe" |
  "shotgun" |
  "supershotgun" |
  "nailgun" |
  "supernailgun" |
  "grenadelauncher" |
  "rocketlauncher" |
  "lightning";

export type QuakePlayerAmmoField = "cells" | "nails" | "rockets" | "shells";

export type QuakePlayerWeaponRuntimeKind = "beam" | "hitscan-pellets" | "melee-trace" | "projectile";

export interface QuakePlayerWeaponAmmoFact {
  cost: number;
  field: QuakePlayerAmmoField;
  sourceField: string;
}

export interface QuakePlayerWeaponSoundFact {
  channel: string;
  cooldownMs?: number;
  path: string;
  sourceRef?: QuakeProgramSourceRef;
}

export interface QuakePlayerWeaponOffsetFact {
  alternatingRight?: readonly number[];
  forward?: number;
  right?: number;
  up?: number;
  zExpression?: string;
}

export interface QuakePlayerWeaponRadiusDamageFact {
  attacker: string;
  attackerSelfScale?: number;
  call: "T_RadiusDamage";
  damageExpression?: string;
  damagePerAmmoCell?: number;
  damageUnits?: number;
  distanceScale?: number;
  ignore: string;
  inflictor: string;
  radiusAddUnits?: number;
  radiusUnits?: number;
  requiresCanDamage?: boolean;
  shamblerScale?: number;
  sourceRef?: QuakeProgramSourceRef;
}

export interface QuakePlayerWeaponHitscanFact {
  aimRangeUnits?: number;
  pelletCount: number;
  pelletDamage: number;
  sourceOffsetUnits?: QuakePlayerWeaponOffsetFact;
  spread: readonly [number, number, number] | null;
  traceRangeUnits: number;
}

export interface QuakePlayerWeaponMeleeFact {
  damage: number;
  rangeUnits: number;
  sourceOffsetUnits?: QuakePlayerWeaponOffsetFact;
  wallImpactSoundPath?: string;
}

export interface QuakePlayerWeaponDirectDamageFact {
  base: number;
  halfDamageClassnames?: readonly string[];
  randomAdd?: number;
}

export interface QuakePlayerWeaponProjectileFact {
  angularVelocityUnits?: readonly [number, number, number] | null;
  bounceSoundPath?: string;
  classname?: string;
  directDamage?: QuakePlayerWeaponDirectDamageFact;
  damage?: number;
  explodeFunction?: string;
  lifetimeMs?: number;
  modelPath?: string;
  movetype?: string;
  radiusDamage?: QuakePlayerWeaponRadiusDamageFact;
  randomVelocityUnits?: {
    right?: number;
    up?: number;
  };
  sourceOffsetUnits?: QuakePlayerWeaponOffsetFact;
  speedUnits?: number;
  touchFunction?: string;
  verticalVelocityUnits?: number;
}

export interface QuakePlayerWeaponBeamFact {
  damage?: number;
  damageEndForwardOffsetUnits?: number;
  damageTraceOffsetUnits?: number;
  duplicateEntitySuppression?: boolean;
  rangeUnits?: number;
  sourceOffsetUnits?: QuakePlayerWeaponOffsetFact;
  startOffsetUnits?: QuakePlayerWeaponOffsetFact;
  tempEntity?: string;
  traceCount?: number;
}

export interface QuakePlayerWeaponFallbackFact {
  condition: string;
  profile: QuakePlayerWeaponId;
  sourceFunction: string;
}

export interface QuakePlayerWeaponUnsupportedBranchFact {
  calls?: readonly string[];
  clearsAmmoField?: QuakePlayerAmmoField;
  condition: string;
  id: string;
  radiusDamage?: QuakePlayerWeaponRadiusDamageFact;
  runtime: "unsupported-modeled-branch";
  sourceRef?: QuakeProgramSourceRef;
}

export interface QuakePlayerWeaponFireAnimationIncrementFact {
  add: number;
  resetTo: number;
  wrapAt: number;
}

export interface QuakePlayerWeaponFireAnimationFrameFact {
  calls?: readonly string[];
  frame: string;
  increment?: QuakePlayerWeaponFireAnimationIncrementFact;
  muzzleFlash?: boolean;
  playerFrameIndex: number | null;
  sourceRef: QuakeProgramSourceRef;
  state: string;
  weaponFrame?: number;
}

export interface QuakePlayerWeaponFireAnimationVariantFact {
  frames: readonly QuakePlayerWeaponFireAnimationFrameFact[];
  otherwise?: boolean;
  randomLessThan?: number;
  startState: string;
}

export interface QuakePlayerWeaponFireAnimationSequenceFact {
  frameIntervalMs: number;
  kind: "sequence";
  sourceFunction: "W_Attack";
  sourceRefs: readonly QuakeProgramSourceRef[];
  variants: readonly QuakePlayerWeaponFireAnimationVariantFact[];
}

export interface QuakePlayerWeaponFireAnimationCycleFact {
  firstWeaponFrame: number;
  frameIntervalMs: number;
  kind: "cycle";
  lastWeaponFrame: number;
  sourceFunction: "W_Attack";
  sourceRefs: readonly QuakeProgramSourceRef[];
  startState: string;
  stateNames: readonly string[];
  wrapAtWeaponFrame: number;
}

export type QuakePlayerWeaponFireAnimationFact =
  | QuakePlayerWeaponFireAnimationCycleFact
  | QuakePlayerWeaponFireAnimationSequenceFact;

export interface QuakePlayerWeaponPresentationFact {
  activeAmmoItemFlag?: string;
  currentAmmoExpression?: string;
  currentAmmoField?: QuakePlayerAmmoField;
  fireAnimation?: QuakePlayerWeaponFireAnimationFact;
  sourceFunction: "W_SetCurrentAmmo";
  sourceRef: QuakeProgramSourceRef;
  viewModelPath: string;
  weaponFrame?: number;
}

export interface QuakePlayerWeaponFireProfileFact {
  ammo?: QuakePlayerWeaponAmmoFact;
  attackStartCooldownMs?: number;
  beam?: QuakePlayerWeaponBeamFact;
  cooldownMs: number;
  fallback?: QuakePlayerWeaponFallbackFact;
  fireSound?: QuakePlayerWeaponSoundFact;
  hitscan?: QuakePlayerWeaponHitscanFact;
  itemFlag: string;
  melee?: QuakePlayerWeaponMeleeFact;
  presentation?: QuakePlayerWeaponPresentationFact;
  projectile?: QuakePlayerWeaponProjectileFact;
  runtimeKind: QuakePlayerWeaponRuntimeKind;
  sourceFunction: string;
  sourceRefs: readonly QuakeProgramSourceRef[];
  startSound?: QuakePlayerWeaponSoundFact;
  unsupportedBranches?: readonly QuakePlayerWeaponUnsupportedBranchFact[];
  weapon: QuakePlayerWeaponId;
}

export interface QuakePlayerWeaponBestWeaponEntry {
  ammoField?: string;
  fallback?: boolean;
  itemFlag: string;
  minAmmo?: number;
  returns: string;
  weapon: QuakePlayerWeaponId | string;
}

export interface QuakePlayerWeaponNoAmmoFallbackFact {
  axeAlwaysAllowed: boolean;
  bestWeaponOrder: readonly QuakePlayerWeaponBestWeaponEntry[];
  currentAmmoPassCondition: string;
  fallbackFunction: "W_BestWeapon";
  setCurrentAmmoFunction: "W_SetCurrentAmmo";
  sourceFunction: "W_CheckNoAmmo";
  sourceRefs: readonly QuakeProgramSourceRef[];
}

export interface QuakePlayerWeaponRadiusDamageSemanticsFact {
  attackerSelfScale: number;
  distanceScale: number;
  radiusAddUnits: number;
  requiresCanDamage: boolean;
  shamblerScale: number;
}

export interface QuakePlayerWeaponFireFacts {
  noAmmoFallback: QuakePlayerWeaponNoAmmoFallbackFact;
  profiles: Readonly<Record<QuakePlayerWeaponId, QuakePlayerWeaponFireProfileFact>>;
  radiusDamageSemantics: QuakePlayerWeaponRadiusDamageSemanticsFact;
}

export interface QuakeProgramFacts {
  version: 1;
  source: {
    repository: string;
    revision: string;
  };
  playerWeapons: QuakePlayerWeaponFireFacts;
  entities: Readonly<Record<string, QuakeProgramEntityFact>>;
}

export const QUAKE_PROGRAM_SOURCE_FACTS = ${json(programFacts.source)} as const;

export const QUAKE_PLAYER_WEAPON_FIRE_FACTS = ${json(programFacts.playerWeapons)} as const satisfies QuakePlayerWeaponFireFacts;

export const QUAKE_PROGRAM_FACTS = ${json(programFacts)} as const satisfies QuakeProgramFacts;

export const QUAKE_PROGRAM_ENTITY_FACTS = QUAKE_PROGRAM_FACTS.entities;
`;
}

function generatedState(state, source, eventSemantics) {
  const events = [
    ...generatedFrameEventsForStateBody(state.name, state.body, source, eventSemantics),
    ...state.calls.flatMap((call) => generatedFrameEventsForCall(call, source, eventSemantics)),
  ];
  return {
    calls: state.calls,
    ...(state.conditionalSounds?.length ? { conditionalSounds: state.conditionalSounds } : {}),
    ...(events.length > 0 ? { events } : {}),
    frame: state.frame,
    frameIndex: state.frameIndex,
    ...(state.movement?.length ? { movement: state.movement } : {}),
    name: state.name,
    next: state.next,
    sounds: state.sounds,
  };
}

function generatedFrameEventsForCall(call, source, eventSemantics) {
  const body = extractFunctionBody(source, call) ?? extractFunctionBody(eventSemantics.sharedFightSource, call);
  if (!body) return [];
  const events = generatedFrameEventsForBody(call, body, eventSemantics);
  events.push(...generatedProjectileFrameEventsForCall(call));
  const fireBulletsMatch = /FireBullets\s*\(\s*([0-9.]+)\s*,[^,]+,\s*'([^']+)'\s*\)/.exec(body);
  if (fireBulletsMatch) {
    events.push({
      call,
      pelletDamage: eventSemantics.fireBullets.pelletDamage,
      pellets: Number(fireBulletsMatch[1]),
      spread: parseVectorLiteral(fireBulletsMatch[2]),
      traceRangeUnits: eventSemantics.fireBullets.traceRangeUnits,
      type: "fire_bullets",
    });
  }
  return events;
}

function generatedFrameEventsForBody(call, body) {
  const damageEvent = extractMeleeDamageFrameEvent(call, body);
  return damageEvent ? [damageEvent] : [];
}

function generatedFrameEventsForStateBody(call, body, source, eventSemantics) {
  const events = generatedFrameEventsForBody(call, body);
  events.push(...generatedProjectileFrameEventsForStateBody(body));
  events.push(...generatedLightningFrameEventsForStateBody(body));
  const touchMatch = /self\.touch\s*=\s*([A-Za-z_]\w*)\s*;/.exec(body);
  if (!touchMatch) return events;
  const touchEvent = extractTouchDamageFrameEvent(touchMatch[1], source);
  return touchEvent ? [...events, touchEvent] : events;
}

function generatedProjectileFrameEventsForCall(call) {
  if (call === "OgreFireGrenade") {
    return [
      {
        call,
        classname: "enemy_projectile_grenade",
        damage: 40,
        lifetimeMs: 2500,
        modelPath: "progs/grenade.mdl",
        radiusUnits: 36,
        speedUnits: 600,
        target: "enemy",
        type: "projectile",
        verticalVelocityUnits: 200,
      },
    ];
  }
  if (call === "Wiz_StartFast") {
    return [
      {
        call: "Wiz_FastFire",
        classname: "enemy_projectile_spike",
        damage: 9,
        delayMs: 800,
        lifetimeMs: 6000,
        modelPath: "progs/w_spike.mdl",
        originOffsetUnits: { forward: 14, right: 14, up: 30 },
        radiusUnits: 28,
        speedUnits: 600,
        target: "enemy",
        targetOffsetUnits: { right: -13 },
        type: "projectile",
      },
      {
        call: "Wiz_FastFire",
        classname: "enemy_projectile_spike",
        damage: 9,
        delayMs: 300,
        lifetimeMs: 6000,
        modelPath: "progs/w_spike.mdl",
        originOffsetUnits: { forward: 14, right: -14, up: 30 },
        radiusUnits: 28,
        speedUnits: 600,
        target: "enemy",
        targetOffsetUnits: { right: 13 },
        type: "projectile",
      },
    ];
  }
  return [];
}

function generatedProjectileFrameEventsForStateBody(body) {
  const events = [];
  for (const match of body.matchAll(/ZombieFireGrenade\s*\(\s*'([^']+)'\s*\)/g)) {
    const [forward, right, up] = parseVectorLiteral(match[1]);
    events.push({
      call: "ZombieFireGrenade",
      classname: "enemy_projectile_zombie_grenade",
      damage: 10,
      lifetimeMs: 2500,
      modelPath: "progs/zom_gib.mdl",
      originOffsetUnits: { forward, right, up: up - 24 },
      radiusUnits: 28,
      speedUnits: 600,
      target: "enemy",
      type: "projectile",
      verticalVelocityUnits: 200,
    });
  }
  for (const match of body.matchAll(/boss_missile\s*\(\s*'([^']+)'\s*\)/g)) {
    const [forward, right, up] = parseVectorLiteral(match[1]);
    events.push({
      call: "boss_missile",
      classname: "enemy_projectile_lavaball",
      damage: 120,
      lifetimeMs: 6000,
      modelPath: "progs/lavaball.mdl",
      originOffsetUnits: { forward, right, up },
      radiusUnits: 42,
      speedUnits: 300,
      target: "enemy",
      type: "projectile",
    });
  }
  return events;
}

function generatedLightningFrameEventsForStateBody(body) {
  if (!/\bCastLightning\s*\(\s*\)/.test(body)) return [];
  if (/\bskill\s*==\s*3\b/.test(body)) return [];
  return [
    {
      call: "CastLightning",
      damage: 10,
      originOffsetUnits: { up: 40 },
      rangeUnits: 600,
      target: "enemy",
      targetOffsetUnits: { up: 16 },
      type: "lightning_damage",
    },
  ];
}

function extractMeleeDamageFrameEvent(call, body) {
  const damageCall = /T_Damage\s*\(\s*(self\.enemy)\s*,\s*self\s*,\s*self\s*,\s*([^)]+)\)/.exec(body);
  if (!damageCall) return null;
  const expression = resolveDamageExpression(body, damageCall.index, damageCall[2]);
  const damage = parseDamageExpression(expression);
  if (!damage) return null;
  const rangeUnits = Number(/vlen\s*\(\s*delta\s*\)\s*>\s*([0-9.]+)/.exec(body)?.[1] ?? 0);
  return {
    call,
    damageBase: damage.base,
    damageRandomTerms: damage.randomTerms,
    ...(rangeUnits > 0 ? { rangeUnits } : {}),
    ...(body.includes("CanDamage") ? { requiresCanDamage: true } : {}),
    target: "enemy",
    type: "melee_damage",
  };
}

function extractTouchDamageFrameEvent(call, source) {
  const body = extractFunctionBody(source, call);
  if (!body) return null;
  const damageCall = /T_Damage\s*\(\s*other\s*,\s*self\s*,\s*self\s*,\s*([^)]+)\)/.exec(body);
  if (!damageCall) return null;
  const expression = resolveDamageExpression(body, damageCall.index, damageCall[1]);
  const damage = parseDamageExpression(expression);
  if (!damage) return null;
  const minVelocityUnits = Number(/vlen\s*\(\s*self\.velocity\s*\)\s*>\s*([0-9.]+)/.exec(body)?.[1] ?? 0);
  return {
    call,
    damageBase: damage.base,
    damageRandomTerms: damage.randomTerms,
    durationMs: 900,
    ...(minVelocityUnits > 0 ? { minVelocityUnits } : {}),
    rangeUnits: touchDamageRangeUnits(call),
    target: "touching",
    type: "touch_damage",
  };
}

function touchDamageRangeUnits(call) {
  if (call === "Dog_JumpTouch") return 150;
  if (call === "Demon_JumpTouch") return 200;
  return 120;
}

function resolveDamageExpression(body, maxIndex, expression) {
  const trimmed = expression.trim();
  if (!/^[A-Za-z_]\w*$/.test(trimmed)) return trimmed;
  let resolved = trimmed;
  const assignmentPattern = new RegExp(`${escapeRegExp(trimmed)}\\s*=\\s*([^;]+);`, "g");
  for (const match of body.matchAll(assignmentPattern)) {
    if (match.index >= maxIndex) break;
    resolved = match[1].trim();
  }
  return resolved;
}

function parseDamageExpression(expression) {
  let text = expression.replace(/\s+/g, " ").trim();
  const randomTerms = [];
  text = text.replace(
    /\((\s*random\s*\(\s*\)\s*(?:\+\s*random\s*\(\s*\)\s*)*)\)\s*\*\s*([0-9.]+)/g,
    (_match, group, scaleText) => {
      const scale = Number(scaleText);
      const count = group.match(/random\s*\(\s*\)/g)?.length ?? 0;
      for (let index = 0; index < count; index += 1) randomTerms.push(scale);
      return "0";
    },
  );
  text = text.replace(/([0-9.]+)\s*\*\s*random\s*\(\s*\)/g, (_match, scaleText) => {
    randomTerms.push(Number(scaleText));
    return "0";
  });
  text = text.replace(/random\s*\(\s*\)\s*\*\s*([0-9.]+)/g, (_match, scaleText) => {
    randomTerms.push(Number(scaleText));
    return "0";
  });
  text = text.replace(/random\s*\(\s*\)/g, () => {
    randomTerms.push(1);
    return "0";
  });
  const base = text
    .split("+")
    .map((part) => Number(part.replace(/[()]/g, "").trim()))
    .filter(Number.isFinite)
    .reduce((total, value) => total + value, 0);
  if (!Number.isFinite(base) || randomTerms.some((term) => !Number.isFinite(term))) return null;
  return { base, randomTerms };
}

function parseVectorLiteral(value) {
  const parts = value.trim().split(/\s+/).map((part) => Number(part));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function formatInlineList(values) {
  if (!values.length) return "";
  return values.map((value) => `\`${value}\``).join(", ");
}

function titleCase(text) {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
