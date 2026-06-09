import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const appSource = readText("src/App.ts");
const html = readText("index.html");
const css = readText("src/quake.css");
const packageJson = readText("package.json");
const textSource = readText("src/runtime/text.ts");
const targetsSource = readText("src/runtime/targets.ts");
const gameLogicFactsSource = readText("src/prepare/gameLogicFacts.ts");

assert(packageJson.includes('"check:text"'), "package.json must expose pnpm check:text.");
assert(html.includes('id="quake-notify"'), "index.html must include the Quake notify text root.");
assert(html.includes('id="quake-centerprint"'), "index.html must include the Quake centerprint text root.");
assert(!html.includes('id="quake-hud-status"'), "Old mixed-purpose quake-hud-status root must not return.");

assert(appSource.includes('createQuakeTextController'), "App must create the Quake text controller.");
assert(!appSource.includes("showQuakeHudMessage"), "Old mixed-purpose showQuakeHudMessage must not return.");
assert(!appSource.includes("setQuakeHudStatus"), "Old mixed-purpose setQuakeHudStatus must not return.");
assert(!appSource.includes("quake-hud-message"), "Old mixed-purpose quake-hud-message body class must not return.");

const pickupApplyEffectBody = extractObjectFunctionBody(appSource, "applyEffect");
assert(
  pickupApplyEffectBody.includes("showQuakeNotifyText(pickupMessage)"),
  "Pickup feedback must route through top-left Quake notify text.",
);
assert(
  !pickupApplyEffectBody.includes("showQuakeCenterPrint(pickupMessage)"),
  "Pickup feedback must not route through centerprint.",
);

assert(textSource.includes("mountQuakeBitmapText"), "Quake text runtime must render through bitmap glyphs.");
assert(
  textSource.includes("quake-bm-label quake-bm-anywhere"),
  "Gameplay notify/centerprint text must render through normal Quake conchars.",
);
assert(
  !textSource.includes("quake-bm-label quake-bm-alt quake-bm-anywhere"),
  "Gameplay notify/centerprint text must not force the alternate colored conchars bank.",
);
for (const pattern of ["requestAnimationFrame", "setInterval", "getBoundingClientRect", "getComputedStyle", "offsetWidth", "offsetHeight"]) {
  assert(!textSource.includes(pattern), `src/runtime/text.ts must not use ${pattern}.`);
}
assert(textSource.includes("window.setTimeout"), "Text lanes should use sparse one-shot timeouts for expiry.");

assert(
  gameLogicFactsSource.includes("export interface QuakeGameLogicTextFact"),
  "Game logic facts must expose source-backed text facts.",
);
assert(
  gameLogicFactsSource.includes('export type QuakeGameLogicTextLane = "notify" | "centerprint" | "console"'),
  "Game logic text facts must identify the Quake text lane.",
);
assert(
  gameLogicFactsSource.includes("text?: QuakeGameLogicTextFact"),
  "Pickup feedback facts must carry optional source-backed text metadata.",
);
assert(
  gameLogicFactsSource.includes("messageText?: QuakeGameLogicTextFact"),
  "Trigger facts must carry optional source-backed centerprint metadata.",
);
assert(
  gameLogicFactsSource.includes('lane: "notify"') && gameLogicFactsSource.includes('sourceCall: "sprint"'),
  "Pickup text facts must classify QuakeC sprint as notify text.",
);
assert(
  gameLogicFactsSource.includes('lane: "centerprint"') &&
    gameLogicFactsSource.includes('"SUB_UseTargets"') &&
    gameLogicFactsSource.includes('"centerprint"'),
  "Trigger text facts must classify SUB_UseTargets/direct centerprint as centerprint text.",
);
assert(
  gameLogicFactsSource.includes("generatedText?: QuakeGameLogicGeneratedTextFact[]"),
  "Resolved mover/trigger facts must expose generated QuakeC-derived text facts.",
);
assert(
  appSource.includes("showQuakeCounterGeneratedText") &&
    appSource.includes("showQuakeDoorRequirementText") &&
    appSource.includes("showQuakeUseTargetsMessageText") &&
    appSource.includes("showQuakeDirectCenterPrintMessageText") &&
    appSource.includes("quakeGameLogicEntityFact"),
  "Runtime must consume generated text facts only from event handlers.",
);
assert(
  appSource.includes('text.sourceCall !== "centerprint"') &&
    appSource.includes("showQuakeDirectCenterPrintMessageText(entity)"),
  "Direct QuakeC centerprint facts must be consumed before registered-trigger fallback text.",
);
assert(
  targetsSource.includes("onUseTargetsMessage") &&
    targetsSource.includes('text.sourceCall === "SUB_UseTargets"'),
  "SUB_UseTargets message facts must be emitted from the target-use event path.",
);

for (const selector of ["#quake-notify", "#quake-centerprint"]) {
  assert(css.includes(`${selector} .quake-bitmap-text`), `${selector} must style bitmap glyph output.`);
  assert(css.includes(`${selector} .quake-bitmap-glyph`) || css.includes("#quake-notify .quake-bitmap-glyph,\n#quake-centerprint .quake-bitmap-glyph"), `${selector} must style bitmap glyphs.`);
}
for (const selector of ["#quake-notify", "#quake-centerprint"]) {
  const block = extractCssBlock(css, selector);
  for (const pattern of ["font-family", "font-size:", "border:", "background:", "text-shadow"]) {
    assert(!block.includes(pattern), `${selector} must not use browser text panel styling: ${pattern}`);
  }
}
assert(css.includes("--quake-notify-stack-height"), "Text overlap guard must reserve the notify stack height in CSS.");
assert(
  css.includes("--quake-centerprint-safe-top: max(35%,") &&
    extractCssBlock(css, "#quake-centerprint").includes("top: var(--quake-centerprint-safe-top)"),
  "Centerprint must use a CSS-only safe top guard instead of JS layout checks.",
);

console.log("Quake text fast-path check passed: notify and centerprint lanes are glyph-only and event-driven.");

function readText(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function extractObjectFunctionBody(source, propertyName) {
  const start = source.indexOf(`${propertyName}:`);
  assert(start >= 0, `${propertyName} property was not found.`);
  const arrow = source.indexOf("=>", start);
  assert(arrow >= 0, `${propertyName} arrow function was not found.`);
  const braceStart = source.indexOf("{", arrow);
  assert(braceStart >= 0, `${propertyName} function body was not found.`);
  return balancedBlockBody(source, braceStart, propertyName);
}

function extractCssBlock(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert(start >= 0, `${selector} CSS block was not found.`);
  const braceStart = source.indexOf("{", start);
  assert(braceStart >= 0, `${selector} CSS block body was not found.`);
  return balancedBlockBody(source, braceStart, selector);
}

function balancedBlockBody(source, braceStart, label) {
  let depth = 0;
  for (let index = braceStart; index < source.length; index++) {
    const char = source[index];
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, index);
    }
  }
  throw new Error(`${label} block did not terminate.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
