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
const soldierReportPath = path.join(projectRoot, "notes/quake-logic-soldier-report.md");
const generatedLogicPath = path.join(projectRoot, "src/generated/quakeMonsterLogic.ts");

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
  },
  {
    checkAttackFunction: "DogCheckAttack",
    classname: "monster_dog",
    label: "dog",
    modelPath: "progs/dog.mdl",
    primaryAttackCallback: "th_missile",
    sourcePath: "qcc/v101qc/dog.qc",
    spawnFunction: "monster_dog",
  },
  {
    classname: "monster_knight",
    label: "knight",
    modelPath: "progs/knight.mdl",
    sourcePath: "qcc/v101qc/knight.qc",
    spawnFunction: "monster_knight",
  },
  {
    checkAttackFunction: "OgreCheckAttack",
    classname: "monster_ogre",
    label: "ogre",
    modelPath: "progs/ogre.mdl",
    primaryAttackCallback: "th_missile",
    sourcePath: "qcc/v101qc/ogre.qc",
    spawnFunction: "monster_ogre",
  },
  {
    checkAttackFunction: "DemonCheckAttack",
    classname: "monster_demon1",
    label: "demon",
    modelPath: "progs/demon.mdl",
    primaryAttackCallback: "th_missile",
    sourcePath: "qcc/v101qc/demon.qc",
    spawnFunction: "monster_demon1",
  },
  {
    checkAttackFunction: "WizardCheckAttack",
    classname: "monster_wizard",
    label: "wizard",
    modelPath: "progs/wizard.mdl",
    sourcePath: "qcc/v101qc/wizard.qc",
    spawnFunction: "monster_wizard",
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
  },
  {
    classname: "monster_zombie",
    label: "zombie",
    modelPath: "progs/zombie.mdl",
    sourcePath: "qcc/v101qc/zombie.qc",
    spawnFunction: "monster_zombie",
    extraChains: [
      ["pain_light_a", "zombie_paina1"],
      ["pain_light_b", "zombie_painb1"],
      ["pain_light_c", "zombie_painc1"],
      ["pain_light_d", "zombie_paind1"],
      ["pain_down", "zombie_paine1"],
    ],
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

const sharedSources = {
  fight: await fetchText(sourceUrlFor("qcc/v101qc/fight.qc")),
  weapons: await fetchText(sourceUrlFor("qcc/v101qc/weapons.qc")),
};
const extractedMonsters = [];
for (const target of monsterTargets) {
  extractedMonsters.push(await extractMonsterLogic(target, sharedSources));
}

const generatedLogic = renderGeneratedLogic(extractedMonsters);
const monstersReport = renderMonstersReport(extractedMonsters);
const soldierReport = renderSingleMonsterReport(extractedMonsters[0]);

await mkdir(path.dirname(monsterLogicReportPath), { recursive: true });
await writeFile(monsterLogicReportPath, monstersReport);
await writeFile(soldierReportPath, soldierReport);
await mkdir(path.dirname(generatedLogicPath), { recursive: true });
await writeFile(generatedLogicPath, generatedLogic);

console.log(`Wrote ${path.relative(projectRoot, monsterLogicReportPath)}`);
console.log(`Wrote ${path.relative(projectRoot, soldierReportPath)}`);
console.log(`Wrote ${path.relative(projectRoot, generatedLogicPath)}`);

async function extractMonsterLogic(target, shared) {
  const sourceUrl = sourceUrlFor(target.sourcePath);
  const source = await fetchText(sourceUrl);
  const frameMap = parseFrameMap(source);
  const states = parseStates(source, frameMap);
  const callbacks = {
    ...parseMonsterCallbacks(source, target.spawnFunction),
    ...(target.callbackOverrides ?? {}),
  };
  const eventSemantics = {
    fireBullets: extractFireBulletsSemantics(shared.weapons),
    sharedFightSource: shared.fight,
  };
  const chains = buildMonsterChains({ callbacks, eventSemantics, source, states, target });
  const combatPolicy = buildCombatPolicy({ callbacks, chains, shared, source, target });
  return {
    callbacks,
    chains,
    combatPolicy,
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
    states,
    target,
  };
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
    states.set(name, {
      body: normalizeBody(body),
      calls: extractCalls(body),
      frame,
      frameIndex: frames.get(frame) ?? null,
      name,
      next,
      sounds: extractSounds(body),
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
      ...(damage > 0 ? { damage } : {}),
      usesFrameEvents: true,
    },
  };
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
  const hasRangeChance = Object.values(rangeChances).some((chance) => chance > 0);
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
  const signaturePattern = new RegExp(`(?:void|float)\\s*(?:\\([^)]*\\))?\\s*${escapeRegExp(functionName)}\\s*=\\s*\\{`, "m");
  const signature = signaturePattern.exec(sourceText);
  if (!signature) return null;
  const bodyStart = signature.index + signature[0].lastIndexOf("{");
  const bodyEnd = findMatchingBrace(sourceText, bodyStart);
  if (bodyEnd < 0) return null;
  return sourceText.slice(bodyStart + 1, bodyEnd);
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
  const calls = [];
  for (const match of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const call = match[1];
    if (!ignored.has(call) && !calls.includes(call)) calls.push(call);
  }
  return calls;
}

function extractSounds(body) {
  const sounds = [];
  for (const match of body.matchAll(/"([^"]+\.wav)"/g)) {
    if (!sounds.includes(match[1])) sounds.push(match[1]);
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

function renderGeneratedLogic(extracted) {
  const sources = Object.fromEntries(
    extracted.map(({ sourceMetadata, target }) => [target.classname, sourceMetadata]),
  );
  const combatPolicies = Object.fromEntries(
    extracted
      .filter(({ combatPolicy }) => Boolean(combatPolicy))
      .map(({ combatPolicy, target }) => [target.classname, combatPolicy]),
  );
  const monsters = Object.fromEntries(
    extracted.map(({ callbacks, chains, target }) => [
      target.classname,
      {
        callbacks,
        chains,
        classname: target.classname,
        modelPath: target.modelPath,
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

export interface QuakeMonsterAttackPolicy {
  branches?: readonly QuakeMonsterAttackBranchPolicy[];
  chain: string;
  cooldownMs: number;
  cooldownRandomAddMs?: number;
  damage?: number;
  rangeChances: QuakeMonsterAttackRangeChances;
  rangeUnits: QuakeMonsterAttackRangeUnits;
  requiresClearShot?: boolean;
  usesFrameEvents?: boolean;
}

export interface QuakeMonsterCombatPolicy {
  attack?: QuakeMonsterAttackPolicy;
}

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
  events?: readonly QuakeMonsterFrameEvent[];
  frame: string;
  frameIndex: number;
  name: string;
  next: string;
  sounds: readonly string[];
}

export interface QuakeMonsterStateChain {
  start: string;
  states: readonly QuakeMonsterFrameState[];
}

export interface QuakeMonsterLogicDefinition {
  callbacks: Readonly<Record<string, string>>;
  chains: Readonly<Record<string, QuakeMonsterStateChain>>;
  classname: string;
  modelPath: string;
}

export const QUAKE_MONSTER_LOGIC_SOURCES = ${json(sources)} as const satisfies Readonly<Record<string, QuakeMonsterLogicSourceMetadata>>;

export const QUAKE_MONSTER_LOGIC_SOURCE = QUAKE_MONSTER_LOGIC_SOURCES.monster_army;

export const QUAKE_MONSTER_COMBAT_POLICIES = ${json(combatPolicies)} as const satisfies Readonly<Record<string, QuakeMonsterCombatPolicy>>;

export const QUAKE_MONSTER_LOGIC = ${json(monsters)} as const satisfies Readonly<Record<string, QuakeMonsterLogicDefinition>>;
`;
}

function generatedState(state, source, eventSemantics) {
  const events = [
    ...generatedFrameEventsForStateBody(state.name, state.body, source, eventSemantics),
    ...state.calls.flatMap((call) => generatedFrameEventsForCall(call, source, eventSemantics)),
  ];
  return {
    calls: state.calls,
    ...(events.length > 0 ? { events } : {}),
    frame: state.frame,
    frameIndex: state.frameIndex,
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
