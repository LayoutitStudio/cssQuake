#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const command = argv[0] ?? "help";
const rest = argv.slice(1);

const RUNNERS = new Map([
  ["generic", "capture-trace.mjs"],
  ["capture", "capture-trace.mjs"],
]);

function printHelp() {
  console.log(`Usage:
  node scripts/chrome-trace/trace.mjs <command> [options]

Commands:
  generic         Generic Chrome trace around a URL/action.
  report          Create a Markdown report from one summary JSON.
  compare         Compare two summary JSON files and print Markdown.

Aliases:
  capture         -> generic

Examples:
  node scripts/chrome-trace/trace.mjs generic --url http://127.0.0.1:5173/ --action wait --sample 3000
  node scripts/chrome-trace/trace.mjs generic --url http://127.0.0.1:5173/ --action drag --selector "#quake-host" --drag "480,0"
  node scripts/chrome-trace/trace.mjs generic --url http://127.0.0.1:5173/ --ready-js "document.querySelectorAll('.polycss-mesh').length > 0" --action wait --summary-out bench/results/quake/idle-summary.json --trace-out bench/results/quake/idle.trace.json --report --markdown-out bench/results/quake/idle.md
  node scripts/chrome-trace/trace.mjs report bench/results/quake/idle-summary.json --markdown-out bench/results/quake/idle.md
  node scripts/chrome-trace/trace.mjs compare before-summary.json after-summary.json --markdown-out compare.md
`);
}

function runScript(scriptName, args) {
  const scriptPath = resolve(scriptDir, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function stripTraceOptions(args) {
  const out = [];
  let report = false;
  let markdownOut = "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--report") {
      report = true;
      continue;
    }
    if (arg === "--markdown-out") {
      markdownOut = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--markdown-out=")) {
      markdownOut = arg.slice("--markdown-out=".length);
      continue;
    }
    out.push(arg);
  }
  return { childArgs: out, report, markdownOut };
}

function argValue(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : "";
}

function positionalArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      out.push(arg);
      continue;
    }
    if (!arg.includes("=") && args[i + 1] && !args[i + 1].startsWith("--")) i += 1;
  }
  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function firstRun(summary) {
  return Array.isArray(summary.runs) ? summary.runs[0] : summary;
}

function frameMetrics(summary) {
  const run = firstRun(summary);
  const frames = run.frames ?? run;
  return {
    kind: summary.kind ?? run.kind ?? "",
    label: summary.label ?? run.label ?? summary.mesh ?? run.mesh ?? "",
    fps_p50: numberOrNull(frames.fps_p50),
    fps_p95: numberOrNull(frames.fps_p95),
    frame_time_p50_ms: numberOrNull(frames.frame_time_p50_ms),
    frame_time_p95_ms: numberOrNull(frames.frame_time_p95_ms),
    frame_time_p99_ms: numberOrNull(frames.frame_time_p99_ms),
    frame_count: numberOrNull(frames.count ?? frames.sample_count),
    poly_count: numberOrNull(run.polyCount ?? summary.polyCount),
  };
}

function numberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function groupMsPerFrame(summary) {
  const run = firstRun(summary);
  if (Array.isArray(run.buckets)) {
    const totals = new Map();
    let frameCount = 0;
    for (const bucket of run.buckets) {
      const count = Number(bucket.frameCount) || 0;
      frameCount += count;
      for (const [group, value] of Object.entries(bucket.groups_ms_per_frame ?? {})) {
        totals.set(group, (totals.get(group) ?? 0) + (Number(value) || 0) * count);
      }
    }
    return Object.fromEntries([...totals.entries()].map(([group, total]) => [group, frameCount ? total / frameCount : 0]));
  }

  const frames = frameMetrics(summary).frame_count ?? 0;
  const groups = summary.trace?.groups ?? run.trace?.groups ?? {};
  return Object.fromEntries(Object.entries(groups).map(([group, value]) => {
    if (Number.isFinite(value?.ms_per_frame)) return [group, Number(value.ms_per_frame)];
    if (Number.isFinite(value?.duration_ms) && frames > 0) return [group, Number(value.duration_ms) / frames];
    return [group, 0];
  }));
}

function sortedGroups(summary) {
  return Object.entries(groupMsPerFrame(summary))
    .filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => b[1] - a[1]);
}

function dominantGroup(summary) {
  return sortedGroups(summary).find(([, value]) => value > 0) ?? null;
}

function groupHint(group) {
  const hints = {
    script: "main-thread JavaScript/input work",
    style: "style recalculation or CSS variable invalidation",
    layout: "layout work",
    prePaint: "pre-paint lifecycle work",
    paint: "paint work",
    raster: "raster or image decode work",
    compositorMain: "main-thread compositing setup",
    compositorImpl: "compositor impl-thread work",
    gpuViz: "GPU/viz drawing pipeline",
    gpuVizRenderPass: "GPU/viz render pass drawing",
    gpuVizQuads: "GPU/viz quad emission or drawing",
    gpuVizTiles: "tile/raster scheduling and playback",
    gpuVizSkia: "Skia/GPU drawing backend work",
    gpuVizGpuService: "GPU service or swap-buffer work",
  };
  return hints[group] ?? "trace event work";
}

function quickRead(summary) {
  const frames = frameMetrics(summary);
  const dominant = dominantGroup(summary);
  const lines = [];
  if (Number.isFinite(frames.frame_time_p95_ms)) {
    lines.push(`- p95 frame time: ${fmt(frames.frame_time_p95_ms)}ms.`);
  }
  if (dominant) {
    lines.push(`- Dominant trace group: \`${dominant[0]}\` at ${fmt(dominant[1], 4)}ms/frame, pointing at ${groupHint(dominant[0])}.`);
  } else {
    lines.push("- No non-zero trace group cost was attributed in the measured window.");
  }
  return lines;
}

function topEvents(summary, limit = 12) {
  const run = firstRun(summary);
  const raw = summary.trace?.topEvents ?? run.trace?.topEvents ?? run.eventTotals ?? [];
  const frames = frameMetrics(summary).frame_count ?? 0;
  return raw
    .map((event) => ({
      name: event.name ?? event.event ?? "",
      count: numberOrNull(event.count),
      duration_ms: numberOrNull(event.duration_ms),
      ms_per_frame: numberOrNull(event.ms_per_frame) ??
        (Number.isFinite(event.duration_ms) && frames > 0 ? Number(event.duration_ms) / frames : null),
    }))
    .filter((event) => event.name)
    .slice(0, limit);
}

function frameDetails(summary) {
  const run = firstRun(summary);
  if (summary.frameDetails) return summary.frameDetails;
  if (run.frameDetails) return run.frameDetails;
  if (summary.trace?.slowestFrames) {
    return {
      frameCount: summary.frames?.count ?? null,
      slowestFrames: summary.trace.slowestFrames,
      topEvents: summary.trace.topEvents,
    };
  }
  return null;
}

function layerDetails(summary) {
  const run = firstRun(summary);
  return summary.layerDetails ?? run.layerDetails ?? null;
}

function frameGroups(frame) {
  return frame.groups_ms ?? frame.groups ?? {};
}

function frameTopEvent(frame) {
  const event = frame.topEvents?.[0];
  if (!event) return "";
  const name = event.name ?? event.event ?? "";
  const duration = fmt(numberOrNull(event.duration_ms), 3);
  return duration ? `${name} (${duration}ms)` : name;
}

function summaryMetadata(summary) {
  const run = firstRun(summary);
  const action = summary.action?.kind ? `${summary.action.kind}` : "";
  return {
    kind: summary.kind ?? run.kind ?? "",
    page: summary.page ?? run.page ?? "",
    mesh: summary.mesh ?? run.mesh ?? "",
    renderer: summary.renderer ?? run.renderer ?? "",
    variant: summary.variant ?? run.variant ?? "",
    mode: summary.mode ?? run.mode ?? "",
    motion: summary.motion ?? run.motion ?? "",
    gpuDetails: summary.gpuDetails ?? run.gpuDetails ?? "",
    traceAligned: summary.traceAligned ?? run.traceAligned ?? "",
    traceAlignmentSource: run.traceAlignmentSource ?? summary.traceAlignmentSource ?? "",
    action,
    url: summary.url ?? run.url ?? "",
  };
}

function fmt(value, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : Number(value).toFixed(digits);
}

function fmtDelta(before, after, digits = 3) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return "";
  const delta = after - before;
  const sign = delta > 0 ? "+" : "";
  const pct = before === 0 ? "" : ` (${sign}${((delta / before) * 100).toFixed(1)}%)`;
  return `${sign}${delta.toFixed(digits)}${pct}`;
}

function metricRow(name, before, after, digits = 3) {
  return `| ${name} | ${fmt(before, digits)} | ${fmt(after, digits)} | ${fmtDelta(before, after, digits)} |`;
}

function summaryMarkdown(summary, file = "") {
  const meta = summaryMetadata(summary);
  const frames = frameMetrics(summary);
  const groups = groupMsPerFrame(summary);
  const events = topEvents(summary);
  const details = frameDetails(summary);
  const layers = layerDetails(summary);
  const contextRows = Object.entries(meta).filter(([, value]) => value);
  const groupRows = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const slowestFrames = details?.slowestFrames?.slice?.(0, 12) ?? [];
  const topPageOps = details?.topPageOps?.slice?.(0, 12) ?? [];
  const topLayers = layers?.topLayers?.slice?.(0, 12) ?? [];
  const layerAggregates = layers?.layerAggregates?.slice?.(0, 16) ?? [];

  const lines = [
    "# Chrome Trace Report",
    "",
    ...(file ? [`Source: \`${file}\``, ""] : []),
    "## Quick Read",
    "",
    ...quickRead(summary),
    "",
    "## Context",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...contextRows.map(([name, value]) => `| ${name} | ${String(value).replaceAll("|", "\\|")} |`),
    "",
    "## Frame Metrics",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| fps_p50 | ${fmt(frames.fps_p50, 2)} |`,
    `| fps_p95 | ${fmt(frames.fps_p95, 2)} |`,
    `| frame_time_p50_ms | ${fmt(frames.frame_time_p50_ms)} |`,
    `| frame_time_p95_ms | ${fmt(frames.frame_time_p95_ms)} |`,
    `| frame_time_p99_ms | ${fmt(frames.frame_time_p99_ms)} |`,
    `| frame_count | ${fmt(frames.frame_count, 0)} |`,
    `| poly_count | ${fmt(frames.poly_count, 0)} |`,
    "",
    "## Trace Groups",
    "",
    "Chrome trace durations are inclusive and can contain nested events, so group totals can exceed wall-clock frame time. Use them for attribution and deltas, not as exclusive time slices.",
    "",
    "| Group | ms/frame |",
    "| --- | ---: |",
    ...groupRows.map(([group, value]) => `| ${group} | ${fmt(value, 4)} |`),
    "",
    "## Top Events",
    "",
    "| Event | Count | Duration ms | ms/frame |",
    "| --- | ---: | ---: | ---: |",
    ...events.map((event) =>
      `| ${event.name.replaceAll("|", "\\|")} | ${fmt(event.count, 0)} | ${fmt(event.duration_ms)} | ${fmt(event.ms_per_frame, 4)} |`
    ),
    "",
    ...(details ? [
      "## Frame Details",
      "",
      `Frame details captured: ${fmt(details.frameCount, 0) || "unknown"} frames.`,
      "",
      ...(topPageOps.length ? [
        "### Page Work",
        "",
        "| Operation | Count | Duration ms | ms/frame |",
        "| --- | ---: | ---: | ---: |",
        ...topPageOps.map((op) => {
          const name = op.operation ?? op.name ?? "";
          const duration = numberOrNull(op.duration_ms);
          const count = numberOrNull(op.count);
          const perFrame = Number.isFinite(duration) && Number.isFinite(details.frameCount) && details.frameCount > 0
            ? duration / details.frameCount
            : null;
          return `| ${String(name).replaceAll("|", "\\|")} | ${fmt(count, 0)} | ${fmt(duration)} | ${fmt(perFrame, 4)} |`;
        }),
        "",
      ] : []),
      ...(slowestFrames.length ? [
        "### Slowest Frames",
        "",
        "| Frame | Bucket | dt ms | script | compositorMain | compositorImpl | gpuViz | top event |",
        "| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |",
        ...slowestFrames.map((frame) => {
          const fg = frameGroups(frame);
          return [
            `| ${fmt(numberOrNull(frame.index), 0)}`,
            frame.bucket ?? "",
            fmt(numberOrNull(frame.dt_ms)),
            fmt(numberOrNull(fg.script), 4),
            fmt(numberOrNull(fg.compositorMain), 4),
            fmt(numberOrNull(fg.compositorImpl), 4),
            fmt(numberOrNull(fg.gpuViz), 4),
            `${frameTopEvent(frame).replaceAll("|", "\\|")} |`,
          ].join(" | ");
        }),
        "",
      ] : []),
    ] : []),
    ...(layers ? [
      "## Layer Details",
      "",
      "| Metric | Value |",
      "| --- | ---: |",
      `| layerCount | ${fmt(numberOrNull(layers.layerCount), 0)} |`,
      `| aggregatedLayerCount | ${fmt(numberOrNull(layers.aggregatedLayerCount), 0)} |`,
      `| inspectedLayerCount | ${fmt(numberOrNull(layers.inspectedLayerCount), 0)} |`,
      `| drawsContentCount | ${fmt(numberOrNull(layers.drawsContentCount), 0)} |`,
      `| invisibleCount | ${fmt(numberOrNull(layers.invisibleCount), 0)} |`,
      `| maxArea | ${fmt(numberOrNull(layers.maxArea), 0)} |`,
      "",
      ...(layerAggregates.length ? [
        "### Layer Aggregates",
        "",
        "| Group | Layers | Draws | Total area | Max area | Paints | Top reasons |",
        "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
        ...layerAggregates.map((entry) => {
          const reasons = (entry.reasonCounts ?? [])
            .slice(0, 3)
            .map((reason) => `${reason.reason} (${reason.count})`)
            .join("; ");
          return [
            `| ${String(entry.group).replaceAll("|", "\\|")}`,
            fmt(numberOrNull(entry.layerCount), 0),
            fmt(numberOrNull(entry.drawsContentCount), 0),
            fmt(numberOrNull(entry.totalArea), 0),
            fmt(numberOrNull(entry.maxArea), 0),
            fmt(numberOrNull(entry.paintCountTotal), 0),
            `${reasons.replaceAll("|", "\\|")} |`,
          ].join(" | ");
        }),
        "",
      ] : []),
      ...(layers.reasonCounts?.length ? [
        "### Compositing Reasons",
        "",
        "| Reason | Count |",
        "| --- | ---: |",
        ...layers.reasonCounts.slice(0, 12).map((entry) =>
          `| ${String(entry.reason).replaceAll("|", "\\|")} | ${fmt(numberOrNull(entry.count), 0)} |`
        ),
        "",
      ] : []),
      ...(topLayers.length ? [
        "### Largest Layers",
        "",
        "| Layer | Node | Size | Draws | Paints | Reasons |",
        "| --- | --- | ---: | --- | ---: | --- |",
        ...topLayers.map((layer) => {
          const node = layer.node
            ? `${layer.node.nodeName}${layer.node.id ? `#${layer.node.id}` : ""}${layer.node.className ? `.${String(layer.node.className).split(/\s+/).filter(Boolean).join(".")}` : ""}`
            : "";
          const reasons = (layer.compositingReasons ?? []).slice(0, 3).join("; ");
          return `| ${layer.layerId} | ${node.replaceAll("|", "\\|")} | ${fmt(numberOrNull(layer.width), 0)}x${fmt(numberOrNull(layer.height), 0)} | ${layer.drawsContent ? "yes" : "no"} | ${fmt(numberOrNull(layer.paintCount), 0)} | ${reasons.replaceAll("|", "\\|")} |`;
        }),
        "",
      ] : []),
    ] : []),
  ];

  return `${lines.join("\n")}\n`;
}

function writeOrPrintMarkdown(markdown, outFile) {
  if (outFile) writeFileSync(outFile, markdown);
  process.stdout.write(markdown);
}

function reportSummary(args) {
  const positions = positionalArgs(args);
  const file = argValue(args, "summary") || positions[0];
  if (!file) throw new Error("report requires a summary JSON file.");
  writeOrPrintMarkdown(summaryMarkdown(readJson(file), file), argValue(args, "markdown-out"));
}

function compareSummaries(args) {
  const positions = positionalArgs(args);
  const beforeFile = argValue(args, "before") || positions[0];
  const afterFile = argValue(args, "after") || positions[1];
  if (!beforeFile || !afterFile) {
    throw new Error("compare requires before and after JSON files.");
  }

  const before = readJson(beforeFile);
  const after = readJson(afterFile);
  const beforeFrames = frameMetrics(before);
  const afterFrames = frameMetrics(after);
  const beforeGroups = groupMsPerFrame(before);
  const afterGroups = groupMsPerFrame(after);
  const groupNames = [...new Set([...Object.keys(beforeGroups), ...Object.keys(afterGroups)])].sort();
  const groupDeltas = groupNames
    .map((group) => ({ group, before: beforeGroups[group] ?? 0, after: afterGroups[group] ?? 0 }))
    .map((entry) => ({ ...entry, delta: entry.after - entry.before }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const dominantDelta = groupDeltas.find((entry) => Math.abs(entry.delta) > 0.00005) ?? null;
  const p95Delta = Number.isFinite(beforeFrames.frame_time_p95_ms) && Number.isFinite(afterFrames.frame_time_p95_ms)
    ? afterFrames.frame_time_p95_ms - beforeFrames.frame_time_p95_ms
    : null;

  const lines = [
    "# Chrome Trace Compare",
    "",
    `Before: \`${beforeFile}\``,
    `After: \`${afterFile}\``,
    "",
    "## Quick Read",
    "",
    ...(Number.isFinite(p95Delta)
      ? [`- p95 frame time delta: ${fmtDelta(beforeFrames.frame_time_p95_ms, afterFrames.frame_time_p95_ms)}.`]
      : []),
    ...(dominantDelta
      ? [`- Largest trace-group movement: \`${dominantDelta.group}\` ${fmtDelta(dominantDelta.before, dominantDelta.after, 4)}, pointing at ${groupHint(dominantDelta.group)}.`]
      : ["- No comparable trace-group movement was found."]),
    "",
    "## Frame Metrics",
    "",
    "| Metric | Before | After | Delta |",
    "| --- | ---: | ---: | ---: |",
    metricRow("fps_p50", beforeFrames.fps_p50, afterFrames.fps_p50, 2),
    metricRow("fps_p95", beforeFrames.fps_p95, afterFrames.fps_p95, 2),
    metricRow("frame_time_p50_ms", beforeFrames.frame_time_p50_ms, afterFrames.frame_time_p50_ms),
    metricRow("frame_time_p95_ms", beforeFrames.frame_time_p95_ms, afterFrames.frame_time_p95_ms),
    metricRow("frame_time_p99_ms", beforeFrames.frame_time_p99_ms, afterFrames.frame_time_p99_ms),
    metricRow("frame_count", beforeFrames.frame_count, afterFrames.frame_count, 0),
    metricRow("poly_count", beforeFrames.poly_count, afterFrames.poly_count, 0),
    "",
    "## Trace Groups",
    "",
    "| Group | Before ms/frame | After ms/frame | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...groupNames.map((group) => metricRow(group, beforeGroups[group] ?? 0, afterGroups[group] ?? 0, 4)),
    "",
  ];

  const markdown = `${lines.join("\n")}\n`;
  const outFile = argValue(args, "markdown-out");
  if (outFile) writeFileSync(outFile, markdown);
  process.stdout.write(markdown);
}

function inferSummaryPath(cmd, args) {
  const summaryOut = argValue(args, "summary-out");
  if (summaryOut) return resolve(summaryOut);

  if (cmd === "generic" || cmd === "capture") {
    return resolve(argValue(args, "summary-out") || "chrome-trace-summary.json");
  }

  return "";
}

function ensureReportSummaryPath(cmd, args) {
  if (argValue(args, "summary-out")) return { childArgs: args, summaryPath: inferSummaryPath(cmd, args) };

  return { childArgs: args, summaryPath: inferSummaryPath(cmd, args) };
}

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "report") {
    reportSummary(rest);
  } else if (command === "compare") {
    compareSummaries(rest);
  } else if (RUNNERS.has(command)) {
    const { childArgs, report, markdownOut } = stripTraceOptions(rest);
    const prepared = report ? ensureReportSummaryPath(command, childArgs) : { childArgs, summaryPath: "" };
    const status = runScript(RUNNERS.get(command), prepared.childArgs);
    if (status !== 0) process.exit(status);
    if (report) writeOrPrintMarkdown(summaryMarkdown(readJson(prepared.summaryPath), prepared.summaryPath), markdownOut);
  } else {
    printHelp();
    throw new Error(`Unknown trace command: ${command}`);
  }
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
