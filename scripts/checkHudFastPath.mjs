import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const hudSource = readText("src/runtime/hud.ts");
const html = readText("index.html");
const css = readText("src/quake.css");
const prepareSource = readText("src/prepare/assets.mjs");

const slotDefinitions = [...hudSource.matchAll(/quake(?:Status|Inventory)HudSlot\("([^"]+)", "([^"]+)", (\d+),/g)]
  .map((match) => ({
    id: match[1],
    qpic: match[2],
    sheetIndex: Number.parseInt(match[3], 10),
  }));
const slotIds = slotDefinitions.map((slot) => slot.id);
const qpics = parsePrepareQpicList();

assert(slotDefinitions.length > 0, "No HUD slot definitions found.");
assertUnique(slotIds, "HUD slot ids");
assertUnique(qpics, "HUD icon qpics");
assert(qpics.length === slotDefinitions.length, `HUD qpic count ${qpics.length} does not match slot count ${slotDefinitions.length}.`);

for (const slot of slotDefinitions) {
  assert(
    qpics[slot.sheetIndex] === slot.qpic,
    `HUD slot ${slot.id} expects qpic ${slot.qpic} at sheet index ${slot.sheetIndex}, found ${qpics[slot.sheetIndex] ?? "none"}.`,
  );
  assert(
    html.includes(`data-quake-hud-slot="${slot.id}"`),
    `HUD markup is missing data-quake-hud-slot="${slot.id}".`,
  );
}

const sheetWidthMatch = hudSource.match(/QUAKE_HUD_ICON_SHEET_WIDTH = QUAKE_HUD_ICON_SLOT_SIZE \* (\d+)/);
assert(sheetWidthMatch, "HUD icon sheet width constant was not found.");
assert(
  Number.parseInt(sheetWidthMatch[1], 10) === qpics.length,
  `HUD icon sheet width slot count should be ${qpics.length}.`,
);

assert(css.includes('url("/q/hud-icons.png")'), "HUD CSS must reference the generated HUD icon sheet.");
assert(css.includes('url("/q/hud-inventory.png")'), "HUD CSS must reference the generated HUD inventory row.");
assert(css.includes('url("/q/conchars.png")'), "HUD/status bitmap text must reference Quake conchars.");
assert(prepareSource.includes("hudIconsOutputPath"), "prepare:quake must define hud-icons output.");
assert(prepareSource.includes("hudInventoryOutputPath"), "prepare:quake must define hud-inventory output.");

const obsoleteKeyTextPatterns = [
  "quake-hud-keys",
  "quake-hud-key-silver-active",
  "quake-hud-key-gold-active",
  ">S</span>",
  ">G</span>",
];
for (const pattern of obsoleteKeyTextPatterns) {
  assert(!html.includes(pattern), `Obsolete text key marker remains in HUD markup: ${pattern}`);
  assert(!css.includes(pattern), `Obsolete text key marker remains in HUD CSS: ${pattern}`);
  assert(!hudSource.includes(pattern), `Obsolete text key marker remains in HUD runtime: ${pattern}`);
}

const syncBody = extractFunctionBody(hudSource, "syncQuakeHud");
for (const pattern of [
  "querySelector",
  "querySelectorAll",
  "getBoundingClientRect",
  "getComputedStyle",
  "offsetWidth",
  "offsetHeight",
  "requestAnimationFrame",
  "setInterval",
]) {
  assert(!syncBody.includes(pattern), `syncQuakeHud must not use ${pattern}.`);
}

for (const pattern of ["requestAnimationFrame", "setInterval"]) {
  assert(!hudSource.includes(pattern), `src/runtime/hud.ts must not introduce ${pattern}.`);
}

console.log(`HUD fast-path check passed: ${slotDefinitions.length} slots, ${qpics.length} qpics.`);

function readText(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function parsePrepareQpicList() {
  const match = prepareSource.match(/const QUAKE_HUD_ICON_QPICS = \[([\s\S]*?)\];/);
  assert(match, "QUAKE_HUD_ICON_QPICS was not found.");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function extractFunctionBody(source, functionName) {
  const prefixes = [`export function ${functionName}`, `function ${functionName}`];
  const start = prefixes.reduce((found, prefix) => {
    const index = source.indexOf(prefix);
    if (index < 0) return found;
    return found < 0 || index < found ? index : found;
  }, -1);
  assert(start >= 0, `${functionName} was not found.`);
  const braceStart = source.indexOf("{", start);
  assert(braceStart >= 0, `${functionName} body was not found.`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index++) {
    const char = source[index];
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, index);
    }
  }
  throw new Error(`${functionName} body did not terminate.`);
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert(!seen.has(value), `Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
