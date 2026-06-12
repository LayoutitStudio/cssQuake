#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const MODEL_ALIASES = {
  army: "soldier",
};
const MONSTER_CORPUS = [
  "dog",
  "soldier",
  "ogre",
  "knight",
  "demon",
  "wizard",
  "zombie",
  "shambler",
  "boss",
];
const MATRIX_MODES = ["static", "frame", "camera", "both"];
const ALLOWED_MODES = [
  ...MATRIX_MODES,
  "scene",
  "scenesolid",
  "scenesolidfacecolor",
  "scenesolidgradient",
  "scenesolidimage",
  "scenecrop",
  "scenesolidtail25",
  "scenesolidtail",
  "scenesolidtail75",
  "scenesolidhot",
  "scenemotion",
  "scenesolidtailmotion",
  "scenesolidtail75motion",
  "scenesolidmotion",
  "scenesolidtailclassmotion",
  "scenesolidtail75classmotion",
  "scenesolidclassmotion",
  "scenecycle",
  "scenesolidtailclasscycle",
  "scenesolidtail75classcycle",
  "scenesolidtailclassdelaycycle",
  "scenesolidtail75classdelaycycle",
  "scenesolidtailclasslongcycle",
  "scenesolidtail75classlongcycle",
  "scenelongidlecycle",
  "scenesolidtailclassidlecycle",
  "scenesolidtail75classidlecycle",
  "scenesolidtailclasschunkidlecycle",
  "scenesolidtail75classchunkidlecycle",
  "scenesolidsourcetail25classchunkidlecycle",
  "scenesolidsourcetailclasschunkidlecycle",
  "scenesolidsourcetail75classchunkidlecycle",
  "scenesolidfacecolortailclasschunkidlecycle",
  "scenesolidfacecolortail75classchunkidlecycle",
  "scenesolidsourcefacecolortail25classchunkidlecycle",
  "scenesolidsourcefacecolortailclasschunkidlecycle",
  "scenesolidsourcefacecolortail75classchunkidlecycle",
  "scenesolidsourcedetailfacecolortailclasschunkidlecycle",
  "scenesplit",
  "scenesplithide",
  "scenesplitfacecolor",
  "scenesplitfacecolortail",
  "scenesplit010",
  "scenesplithide010",
  "scenesplitfacecolor010",
  "scenesplitfacecolortail010",
  "scenevar",
  "scenerotate",
  "sceneinner",
  "orbit",
  "meshscene",
  "framechanged",
  "bothchanged",
];

const explicitModel = hasOpt("model");
const explicitModels = hasOpt("models");
const corpusRequested = has("corpus") || has("full-corpus") || (!explicitModel && !explicitModels);
const models = parseModels(opt("models", corpusRequested ? "corpus" : opt("model", "dog")));
const mode = opt("mode", "both");
const runModes = parseModes(opt("modes", matrixArg() ? MATRIX_MODES.join(",") : mode));
const count = opt("count", "1");
const durationMs = Number(opt("duration-ms", opt("duration", "1800")));
const port = Number(opt("port", "5182"));
const fps = opt("fps", "10");
const scale = opt("scale", "1");
const perspective = opt("perspective", "600");
const cameraSpeed = opt("camera-speed", "38");
const yawSpeed = opt("yaw-speed", "0");
const sampleMs = opt("sample-ms", opt("sampleMs", "0"));
const viewport = opt("viewport", "1280x800");
const keepServer = has("keep-server");
const noServer = has("no-server");
const report = !has("no-report");
const matrix = matrixArg();
const domMetadata = has("dom-metadata") || has("domMetadata");
const printPlan = has("print-plan");
const label = opt("label", `${models.length > 1 ? "corpus" : models[0]}-${matrix ? "matrix" : runModes.join("-")}-count${count}`);
const outDir = resolve(opt("out-dir", "bench/results/quake/monster-lab"));
const warmupMs = opt("warmup", "700");
const settleMs = opt("settle", "250");

const generatedAssets = preflight();
mkdirSync(outDir, { recursive: true });

const baseUrl = `http://127.0.0.1:${port}`;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const safeLabel = label.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "monster-lab";
const runCases = models.flatMap((runModel) => runModes.map((runMode) => ({ model: runModel, mode: runMode })));
const manifestOut = `${outDir}/${stamp}-${safeLabel}-run-manifest.json`;
const manifestMarkdownOut = `${outDir}/${stamp}-${safeLabel}-run-manifest.md`;
const startedAt = new Date().toISOString();
const runManifest = {
  kind: "monster-lab-run-manifest",
  startedAt,
  completedAt: null,
  status: "planned",
  cwd: process.cwd(),
  argv: ["node", "scripts/trace-monster-lab.mjs", ...args],
  baseUrl,
  generatedAssets,
  corpus: {
    defaultedToCorpus: corpusRequested && !has("corpus") && !has("full-corpus"),
    requested: corpusRequested,
    models,
    modes: runModes,
    expectedRuns: runCases.length,
  },
  params: {
    count: Number(count),
    durationMs,
    fps: Number(fps),
    scale: Number(scale),
    perspective: Number(perspective),
    cameraSpeed: Number(cameraSpeed),
    yawSpeed: Number(yawSpeed),
    sampleMs: Number(sampleMs),
    viewport,
    warmupMs: Number(warmupMs),
    settleMs: Number(settleMs),
    domMetadata,
  },
  plan: runCases.map((runCase, index) => ({
    index,
    model: runCase.model,
    mode: runCase.mode,
  })),
  artifacts: [],
};

if (printPlan) {
  console.log(JSON.stringify(runManifest, null, 2));
  process.exit(0);
}
writeRunManifest("planned");

let server = null;
const artifactSets = [];
try {
  if (!noServer) {
    server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => process.stderr.write(chunk));
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    await waitForServer(baseUrl);
  }

  for (let index = 0; index < runCases.length; index++) {
    const runCase = runCases[index];
    const artifacts = outputPaths(runCase);
    const labUrl = labUrlForCase(runCase);
    const evalBody = [
      "return (async () => {",
      `  return await window.__monsterLab.runTrace({ durationMs: ${JSON.stringify(durationMs)}, mode: ${JSON.stringify(runCase.mode)}, sampleMs: ${JSON.stringify(Number(sampleMs))} });`,
      "})();",
    ].join("\n");
    const command = [
      "node",
      ".agents/skills/chrome-trace/scripts/trace.mjs",
      "generic",
      "--url",
      labUrl.href,
      "--ready-js",
      "window.__monsterLab && window.__monsterLab.ready === true",
      "--action",
      "eval",
      "--eval",
      evalBody,
      "--warmup",
      warmupMs,
      "--settle",
      settleMs,
      "--viewport",
      viewport,
      "--gpu-details",
      "light",
      "--summary-out",
      artifacts.summaryOut,
      "--trace-out",
      artifacts.traceOut,
    ];
    console.error(`Monster lab [${index + 1}/${runCases.length}]: ${runCase.model} ${runCase.mode}`);
    console.error(`Monster lab URL: ${labUrl.href}`);
    console.error(`Trace summary: ${artifacts.summaryOut}`);
    const status = await run(command[0], command.slice(1));
    if (status !== 0) {
      runManifest.artifacts.push({
        ...artifactRecord(runCase, artifacts, labUrl, command, index),
        status: "failed",
        exitCode: status,
      });
      writeRunManifest("failed");
      process.exit(status);
    }
    annotateSummary({
      artifacts,
      command,
      index,
      labUrl,
      runCase,
    });
    if (report) {
      const reportCommand = [
        "node",
        ".agents/skills/chrome-trace/scripts/trace.mjs",
        "report",
        artifacts.summaryOut,
        "--markdown-out",
        artifacts.markdownOut,
      ];
      const reportStatus = await run(reportCommand[0], reportCommand.slice(1));
      if (reportStatus !== 0) {
        runManifest.artifacts.push({
          ...artifactRecord(runCase, artifacts, labUrl, command, index),
          status: "report-failed",
          exitCode: reportStatus,
        });
        writeRunManifest("failed");
        process.exit(reportStatus);
      }
      appendMonsterLabMarkdown(artifacts.summaryOut, artifacts.markdownOut);
    }
    const record = {
      ...artifactRecord(runCase, artifacts, labUrl, command, index),
      status: "completed",
      reportGenerated: report,
    };
    artifactSets.push(record);
    runManifest.artifacts.push(record);
    writeRunManifest("running");
  }
  writeRunManifest("completed");
  console.log("\nArtifacts:");
  console.log(`- ${manifestOut}`);
  console.log(`- ${manifestMarkdownOut}`);
  for (const artifacts of artifactSets) {
    console.log(`- ${artifacts.summaryOut}`);
    console.log(`- ${artifacts.traceOut}`);
    if (report) console.log(`- ${artifacts.markdownOut}`);
  }
} finally {
  if (server && !keepServer) server.kill("SIGINT");
}

function labUrlForCase(runCase) {
  const labUrl = new URL("/bench/monster-lab/monster-lab.html", baseUrl);
  labUrl.searchParams.set("model", runCase.model);
  labUrl.searchParams.set("mode", runCase.mode);
  labUrl.searchParams.set("count", count);
  labUrl.searchParams.set("durationMs", String(durationMs));
  labUrl.searchParams.set("fps", fps);
  labUrl.searchParams.set("scale", scale);
  labUrl.searchParams.set("perspective", perspective);
  labUrl.searchParams.set("cameraSpeed", cameraSpeed);
  labUrl.searchParams.set("yawSpeed", yawSpeed);
  labUrl.searchParams.set("sampleMs", sampleMs);
  if (domMetadata) labUrl.searchParams.set("domMetadata", "1");
  labUrl.searchParams.set("ui", "0");
  return labUrl;
}

function outputPaths(runCase) {
  const modelLabel = models.length > 1 ? safeName(runCase.model) : "";
  const modeLabel = runModes.length > 1 ? runCase.mode : "";
  const suffix = [safeLabel, modelLabel, modeLabel].filter(Boolean).join("-");
  const prefix = `${outDir}/${stamp}-${suffix}`;
  return {
    markdownOut: `${prefix}.md`,
    mode: runCase.mode,
    model: runCase.model,
    summaryOut: `${prefix}-summary.json`,
    traceOut: `${prefix}.trace.json`,
  };
}

function artifactRecord(runCase, artifacts, labUrl, command, index) {
  return {
    index,
    model: runCase.model,
    mode: runCase.mode,
    labUrl: labUrl.href,
    command,
    summaryOut: artifacts.summaryOut,
    traceOut: artifacts.traceOut,
    markdownOut: report ? artifacts.markdownOut : null,
  };
}

function annotateSummary({ artifacts, command, index, labUrl, runCase }) {
  const summary = JSON.parse(readFileSync(artifacts.summaryOut, "utf8"));
  summary.monsterLabRun = {
    version: 1,
    index,
    expectedRuns: runCases.length,
    model: runCase.model,
    mode: runCase.mode,
    labUrl: labUrl.href,
    wrapperCommand: ["node", "scripts/trace-monster-lab.mjs", ...args],
    traceCommand: command,
    generatedAssets,
    corpus: runManifest.corpus,
    params: runManifest.params,
    artifacts: {
      summary: artifacts.summaryOut,
      trace: artifacts.traceOut,
      markdown: report ? artifacts.markdownOut : null,
      runManifest: manifestOut,
      runManifestMarkdown: manifestMarkdownOut,
    },
  };
  summary.outputFiles = {
    ...(summary.outputFiles ?? {}),
    markdown: report ? artifacts.markdownOut : undefined,
    runManifest: manifestOut,
    runManifestMarkdown: manifestMarkdownOut,
  };
  writeFileSync(artifacts.summaryOut, `${JSON.stringify(summary, null, 2)}\n`);
}

function appendMonsterLabMarkdown(summaryOut, markdownOut) {
  const summary = JSON.parse(readFileSync(summaryOut, "utf8"));
  const result = summary.action?.result ?? {};
  const profile = result.profile ?? {};
  const frameSet = profile.frameSet ?? {};
  const styleDiff = result.styleDiff ?? {};
  const geometry = result.geometry ?? {};
  const geometrySamples = result.geometrySamples ?? {};
  const materialProfile = result.materialProfile ?? {};
  const overBudgetText = formatOverBudgetCounts(geometry.overBudgetLeafCounts);
  const maxOverBudgetText = formatOverBudgetCounts(geometrySamples.maxOverBudgetLeafCounts);
  const topProjectedText = formatTopProjectedLeaves(geometry.topProjectedLeaves);
  const sampleTopProjectedText = formatTopProjectedLeaves(geometrySamples.topProjectedLeaves);
  const rendererTotals = summary.trace?.renderer?.totals ?? {};
  const renderPasses = rendererTotals.renderPasses ?? {};
  const doDrawQuad = rendererTotals.doDrawQuad ?? {};
  const paint = rendererTotals.paint ?? {};
  const paintImage = rendererTotals.paintImage ?? {};
  const markers = summary.trace?.appMarkers?.countsByKind ?? [];
  const markerText = markers.map((entry) => `${entry.name}=${entry.count}`).join(", ");
  const dqPerQuad = renderPasses.total_quads ? doDrawQuad.count / renderPasses.total_quads : 0;
  const profileRatio = frameSet.polygonCount ? frameSet.leafCount / frameSet.polygonCount : 0;
  const lines = [
    "## Monster Lab Metadata",
    "",
    "| key | value |",
    "| --- | --- |",
    `| corpus run | ${escapeMd(`${summary.monsterLabRun?.index + 1 ?? "?"}/${summary.monsterLabRun?.expectedRuns ?? "?"}`)} |`,
    `| model | ${escapeMd(result.modelPath ?? summary.monsterLabRun?.model ?? "")} |`,
    `| mode | ${escapeMd(result.mode ?? summary.monsterLabRun?.mode ?? "")} |`,
    `| count / scale | ${escapeMd(`${result.count ?? ""} / ${result.scale ?? ""}`)} |`,
    `| animation fps / frames | ${escapeMd(`${result.animationFps ?? ""} / ${result.frames ?? ""}`)} |`,
    `| profile polys/leaves/atlas | ${escapeMd(`${frameSet.polygonCount ?? ""}/${frameSet.leafCount ?? ""}/${frameSet.atlasLeafCount ?? ""}`)} |`,
    `| leaf per polygon | ${formatNumber(profileRatio)} |`,
    `| render scale | ${escapeMd(String(result.renderScale ?? ""))} |`,
    `| frame diff avg/max any | ${escapeMd(`${profile.frameDiff?.avgChangedAnyLeaves ?? ""}/${profile.frameDiff?.maxChangedAnyLeaves ?? ""}`)} |`,
    `| final diff matrix/bg/extra | ${escapeMd(`${styleDiff.changedMatrixLeaves ?? ""}/${styleDiff.changedBackgroundLeaves ?? ""}/${styleDiff.changedExtraStyleLeaves ?? ""}`)} |`,
    `| visible leaves / instances | ${escapeMd(`${result.visibleLeafCount ?? ""}/${geometry.visibleInstances ?? ""}`)} |`,
    `| leaf pct / bbox pct | ${escapeMd(`${geometry.leafAreaViewportPct ?? ""}/${geometry.bboxViewportPct ?? ""}`)} |`,
    `| largest leaf px / pct | ${escapeMd(`${geometry.largestLeafAreaPx ?? 0}/${geometry.largestLeafViewportPct ?? 0}`)} |`,
    `| over-budget leaves | ${escapeMd(overBudgetText)} |`,
    `| top projected leaves | ${escapeMd(topProjectedText)} |`,
    `| rendered leaves / leaf pct | ${escapeMd(`${geometry.renderedLeafCount ?? ""}/${geometry.renderedLeafAreaViewportPct ?? ""}`)} |`,
    `| rendered largest pct | ${escapeMd(String(geometry.renderedLargestLeafViewportPct ?? ""))} |`,
    `| rendered over-budget leaves | ${escapeMd(formatOverBudgetCounts(geometry.renderedOverBudgetLeafCounts))} |`,
    `| split source leaves / children | ${escapeMd(`${geometry.splitSourceLeafCount ?? 0}/${geometry.splitChildCount ?? 0}`)} |`,
    `| material phase / switches | ${escapeMd(`${materialProfile.phase ?? ""}/${materialProfile.switches ?? 0}`)} |`,
    `| motion solid leaves / projected pct | ${escapeMd(`${materialProfile.motionSolidLeafCount ?? 0}/${materialProfile.motionSolidProjectedLeafPct ?? 0}`)} |`,
    `| motion textured leaves / projected pct | ${escapeMd(`${materialProfile.motionTexturedLeafCount ?? 0}/${materialProfile.motionTexturedProjectedLeafPct ?? 0}`)} |`,
    `| restore changed leaves | ${escapeMd(String(materialProfile.restoreChangedLeaves ?? 0))} |`,
    `| sample count / max leaf pct | ${escapeMd(`${geometrySamples.count ?? 0}/${geometrySamples.maxLeafAreaViewportPct ?? 0}`)} |`,
    `| sample max largest leaf pct | ${escapeMd(String(geometrySamples.maxLargestLeafViewportPct ?? 0))} |`,
    `| sample max over-budget leaves | ${escapeMd(maxOverBudgetText)} |`,
    `| sample top projected leaves | ${escapeMd(sampleTopProjectedText)} |`,
    `| render passes / max quads / total quads | ${escapeMd(`${renderPasses.count ?? 0}/${renderPasses.max_quads ?? 0}/${renderPasses.total_quads ?? 0}`)} |`,
    `| DoDrawQuad count / ms / per quad | ${escapeMd(`${doDrawQuad.count ?? 0}/${formatNumber(doDrawQuad.duration_ms)}/${formatNumber(dqPerQuad)}`)} |`,
    `| Paint / PaintImage count | ${escapeMd(`${paint.count ?? 0}/${paintImage.count ?? 0}`)} |`,
    `| app markers | ${escapeMd(markerText)} |`,
    `| summary | ${escapeMd(summaryOut)} |`,
    `| trace | ${escapeMd(summary.outputFiles?.trace ?? "")} |`,
    `| run manifest | ${escapeMd(manifestOut)} |`,
  ];
  const existing = readFileSync(markdownOut, "utf8");
  writeFileSync(markdownOut, `${existing.trimEnd()}\n\n${lines.join("\n")}\n`);
}

function writeRunManifest(status) {
  runManifest.status = status;
  runManifest.completedAt = status === "completed" || status === "failed" ? new Date().toISOString() : null;
  writeFileSync(manifestOut, `${JSON.stringify(runManifest, null, 2)}\n`);
  writeFileSync(manifestMarkdownOut, runManifestMarkdown());
}

function runManifestMarkdown() {
  const columns = ["index", "model", "mode", "status", "summary", "trace", "report"];
  const rows = runManifest.plan.map((planned) => {
    const artifact = runManifest.artifacts.find((entry) => entry.index === planned.index);
    return {
      index: planned.index + 1,
      model: planned.model,
      mode: planned.mode,
      status: artifact?.status ?? "planned",
      summary: artifact?.summaryOut ?? "",
      trace: artifact?.traceOut ?? "",
      report: artifact?.markdownOut ?? "",
    };
  });
  return [
    "# Monster Lab Run Manifest",
    "",
    `Status: ${runManifest.status}`,
    "",
    `Started: ${runManifest.startedAt}`,
    "",
    `Models: ${runManifest.corpus.models.join(", ")}`,
    "",
    `Modes: ${runManifest.corpus.modes.join(", ")}`,
    "",
    `Expected runs: ${runManifest.corpus.expectedRuns}`,
    "",
    `Generated assets: status=${generatedAssets.status}, assetRoot=${generatedAssets.assetRoot}, version=${generatedAssets.version}`,
    "",
    "Command:",
    "",
    "```sh",
    runManifest.argv.map(shellQuote).join(" "),
    "```",
    "",
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((key) => escapeMd(row[key])).join(" | ")} |`),
    "",
  ].join("\n");
}

function opt(name, fallback = "") {
  const exact = args.indexOf(`--${name}`);
  if (exact >= 0) return args[exact + 1] ?? fallback;
  const prefixed = args.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : fallback;
}

function hasOpt(name) {
  return args.includes(`--${name}`) || args.some((arg) => arg.startsWith(`--${name}=`));
}

function has(name) {
  return args.includes(`--${name}`) || args.includes(`--${name}=true`);
}

function matrixArg() {
  return has("matrix");
}

function parseModels(value) {
  const tokens = value.split(",").map((token) => token.trim()).filter(Boolean);
  if (!tokens.length || tokens.some((token) => token === "all" || token === "corpus" || token === "monsters")) {
    return MONSTER_CORPUS;
  }
  return tokens.map((token) => MODEL_ALIASES[token] ?? token);
}

function parseModes(value) {
  const modes = value.split(",").map((token) => token.trim()).filter(Boolean);
  const out = modes.length ? modes : ["both"];
  for (const runMode of out) {
    if (!ALLOWED_MODES.includes(runMode)) {
      throw new Error(`Unknown monster lab mode: ${runMode}`);
    }
  }
  return out;
}

function preflight() {
  const manifestPath = "build/generated/public/q/manifest.json";
  if (!existsSync(manifestPath)) {
    throw new Error(`${manifestPath} is missing. Run asset prepare only if you intentionally need to publish generated assets.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const status = manifest.status ?? "ready";
  if (status !== "ready") {
    throw new Error(`Generated asset manifest is not ready: ${status}`);
  }
  const pickupsPath = "build/generated/public/q/pickups.json";
  if (!existsSync(pickupsPath)) {
    throw new Error(`${pickupsPath} is missing. Check asset status before blaming runtime code.`);
  }
  const pickups = JSON.parse(readFileSync(pickupsPath, "utf8"));
  const modelPaths = Object.keys(pickups.models ?? {});
  const missing = models
    .map((runModel) => modelPathFor(runModel))
    .filter((modelPath) => !modelPaths.includes(modelPath));
  if (missing.length) {
    throw new Error(`Generated pickups.json is missing requested monster models: ${missing.join(", ")}`);
  }
  return {
    manifestPath,
    pickupsPath,
    status,
    assetRoot: manifest.assetRoot ?? "/q",
    version: manifest.version ?? null,
    mapCount: Object.keys(manifest.maps ?? {}).length,
    modelCount: modelPaths.length,
  };
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      throw new Error(`Vite exited before ${baseUrl} became reachable.`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok || response.status === 404) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.`);
}

function run(command, commandArgs) {
  return new Promise((resolveRun) => {
    const child = spawn(command, commandArgs, { stdio: "inherit" });
    child.on("exit", (code) => resolveRun(code ?? 1));
  });
}

function modelPathFor(runModel) {
  return runModel.includes("/") ? runModel : `progs/${runModel}.mdl`;
}

function safeName(value) {
  return value.replace(/^progs\//, "").replace(/\.mdl$/, "").replace(/[^a-zA-Z0-9_.-]+/g, "-");
}

function escapeMd(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=,-]+$/.test(value)) return value;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(3)
    : String(value ?? "");
}

function formatOverBudgetCounts(counts) {
  const entries = Object.entries(counts ?? {}).filter(([, value]) => value);
  return entries.length
    ? entries.map(([key, value]) => `${key}:${value}`).join(",")
    : "0";
}

function formatTopProjectedLeaves(leaves) {
  if (!Array.isArray(leaves) || !leaves.length) return "";
  return leaves
    .slice(0, 5)
    .map((leaf) => `${leaf.instanceIndex ?? "?"}:${leaf.leafIndex ?? "?"}=${formatNumber(leaf.areaViewportPct)}%`)
    .join(",");
}
