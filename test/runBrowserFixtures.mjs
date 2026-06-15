#!/usr/bin/env node
import {
  hasFlag,
  loadChromium,
  parseCommonBrowserArgs,
  resolveBrowserTarget,
  writeJsonArtifact,
} from "./browserHarnessSupport.mjs";
import { assertAssetState } from "./checkAssetState.mjs";
import { browserFixtureById, browserFixtureFamilies, browserFixtures } from "./browserFixtureDefinitions.mjs";

const DEFAULT_PORT = 5184;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_VIEWPORT = "1280x800";

const args = process.argv.slice(2);
validateFixtureDefinitions(browserFixtures);
if (hasFlag(args, "help") || hasFlag(args, "h")) {
  printHelp();
  process.exit(0);
}
if (hasFlag(args, "list")) {
  printFixtureList();
  process.exit(0);
}

const common = parseCommonBrowserArgs(args, {
  port: DEFAULT_PORT,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  viewport: DEFAULT_VIEWPORT,
});
const selectedFixtures = selectFixtures(args);

console.log("Browser gameplay fixture gate");
console.log("validates: committed browser gameplay fixtures");
console.log("requires prepared assets: yes");
console.log("classification: acceptance");
console.log(`fixtures: ${selectedFixtures.map((fixture) => fixture.id).join(", ")}`);
console.log(`focused rerun: pnpm test:browser -- --fixture ${selectedFixtures.map((fixture) => fixture.id).join(",")}`);

for (const fixture of selectedFixtures) assertAssetState(fixture.requirements);

const chromium = await loadChromium();
const target = await resolveBrowserTarget({ ...common, forceDeps: hasFlag(args, "force-deps") });
const summaries = [];
let browser = await chromium.launch({ headless: !common.headed });
try {
  for (const fixture of selectedFixtures) {
    const summary = await runFixtureWithRetry({
      fixture,
      browser,
      baseUrl: target.url,
      options: common,
      restartBrowser: async () => {
        await browser.close();
        browser = await chromium.launch({ headless: !common.headed });
        return browser;
      },
    });
    await writeJsonArtifact(fixture.artifact, summary);
    summaries.push({ fixture: fixture.id, artifact: fixture.artifact, pass: true, summary });
  }
} finally {
  await browser.close();
  await target.close();
}

const aggregate = {
  generatedAt: new Date().toISOString(),
  kind: "cssquake-browser-fixture-aggregate",
  fixtures: summaries.map(({ fixture, artifact, pass }) => ({ fixture, artifact, pass })),
};
await writeJsonArtifact(common.jsonOut, aggregate);
console.log(`Browser gameplay fixtures passed: ${summaries.length}.`);

function printHelp() {
  console.log(`Usage:
  node test/runBrowserFixtures.mjs [options]

Options:
  --fixture <id[,id]>  Run only selected fixture ids. Repeatable.
  --family <name[,name]>  Run fixture families. Known: ${browserFixtureFamilies().join(", ")}
  --list              Print fixture ids.
  --url <url>         Use an already-running cssQuake dev server.
  --port <port>       Port for temporary Vite. Default: ${DEFAULT_PORT}
  --force-deps        Start Vite with --force.
  --headed            Run Chromium headed.
  --viewport <WxH>    Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>   Per-fixture readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>   Write aggregate result JSON. Per-fixture JSON uses fixture defaults.`);
}

function printFixtureList() {
  console.log("Browser gameplay fixtures");
  console.log("focused run: pnpm test:browser -- --fixture <id>");
  console.log("family run: pnpm test:browser -- --family <name>");
  for (const fixture of browserFixtures) {
    const maps = fixture.requirements?.requiredMaps?.join(",") || "-";
    console.log(`${fixture.id}\t${fixture.family}\t${fixture.label}\tmaps=${maps}\tartifact=${fixture.artifact}`);
  }
}

function validateFixtureDefinitions(fixtures) {
  const seenIds = new Set();
  const seenArtifacts = new Set();
  for (const fixture of fixtures) {
    if (!fixture?.id) throw new Error("Browser fixture is missing id.");
    if (seenIds.has(fixture.id)) throw new Error(`Duplicate browser fixture id "${fixture.id}".`);
    seenIds.add(fixture.id);
    if (!fixture.label) throw new Error(`Browser fixture "${fixture.id}" is missing label.`);
    if (!fixture.family) throw new Error(`Browser fixture "${fixture.id}" is missing family.`);
    if (!fixture.artifact) throw new Error(`Browser fixture "${fixture.id}" is missing artifact.`);
    if (seenArtifacts.has(fixture.artifact)) throw new Error(`Duplicate browser fixture artifact "${fixture.artifact}".`);
    seenArtifacts.add(fixture.artifact);
    if (!fixture.requirements) throw new Error(`Browser fixture "${fixture.id}" is missing requirements.`);
    if (typeof fixture.run !== "function") throw new Error(`Browser fixture "${fixture.id}" is missing run function.`);
  }
}

function selectFixtures(argv) {
  const rawSelections = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--fixture" && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      rawSelections.push(argv[index + 1]);
      index += 1;
    }
  }
  const prefixed = argv
    .filter((arg) => arg.startsWith("--fixture="))
    .map((arg) => arg.slice("--fixture=".length));
  const selectedIds = [...rawSelections, ...prefixed]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const selectedFamilies = selectedFixtureFamilies(argv);
  if (!selectedIds.length && !selectedFamilies.length) return browserFixtures;

  const fixtures = selectedIds.map((id) => {
    const fixture = browserFixtureById(id);
    if (!fixture) {
      throw new Error(`Unknown browser fixture "${id}". Known fixtures: ${browserFixtures.map((candidate) => candidate.id).join(", ")}`);
    }
    return fixture;
  });
  for (const family of selectedFamilies) {
    const familyFixtures = browserFixtures.filter((fixture) => fixture.family === family);
    if (!familyFixtures.length) {
      throw new Error(`Unknown browser fixture family "${family}". Known families: ${browserFixtureFamilies().join(", ")}`);
    }
    fixtures.push(...familyFixtures);
  }
  return [...new Map(fixtures.map((fixture) => [fixture.id, fixture])).values()];
}

function selectedFixtureFamilies(argv) {
  const rawSelections = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--family" && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      rawSelections.push(argv[index + 1]);
      index += 1;
    }
  }
  const prefixed = argv
    .filter((arg) => arg.startsWith("--family="))
    .map((arg) => arg.slice("--family=".length));
  return [...rawSelections, ...prefixed]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function runFixtureWithRetry({ fixture, browser, baseUrl, options, restartBrowser }) {
  try {
    return await runFixtureOnce(fixture, browser, baseUrl, options);
  } catch (error) {
    console.warn(`${fixture.label} failed once; retrying with a fresh browser process.`);
    console.warn(error instanceof Error ? error.message : String(error));
    console.warn(`Focused rerun: pnpm test:browser -- --fixture ${fixture.id}`);
    const freshBrowser = await restartBrowser();
    try {
      return await runFixtureOnce(fixture, freshBrowser, baseUrl, options);
    } catch (retryError) {
      console.error(`${fixture.label} failed after retry.`);
      console.error(`Focused rerun: pnpm test:browser -- --fixture ${fixture.id}`);
      throw retryError;
    }
  }
}

async function runFixtureOnce(fixture, browser, baseUrl, options) {
  console.log(`\n> ${fixture.label}`);
  console.log(`  id=${fixture.id} artifact=${fixture.artifact}`);
  return await fixture.run({ browser, baseUrl, options });
}
