#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const args = process.argv.slice(2);

const models = listOpt("models", "dog,shambler,boss");
const port = opt("port", "5182");
const outDir = path.resolve(opt("out-dir", "bench/results/quake/monster-lab/visual-selective-face-color-20260611"));
const scale = opt("scale", "4");
const count = opt("count", "4");
const durationMs = opt("duration-ms", "3600");
const viewport = opt("viewport", "1280x800");
const [viewportWidth, viewportHeight] = viewport.split("x").map((value) => Number(value));

const modes = parseModes(opt("modes", ""));

if (!modes.length) modes.push(
  ["textured", "scenelongidlecycle"],
  ["global-solid", "scenesolidtail75classchunkidlecycle"],
  ["projection-sampled", "scenesolidfacecolortail75classchunkidlecycle"],
  ["source-sampled", "scenesolidsourcefacecolortail75classchunkidlecycle"],
);

mkdirSync(outDir, { recursive: true });

const base = `http://127.0.0.1:${port}/bench/monster-lab/monster-lab.html`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: {
    height: Number.isFinite(viewportHeight) ? viewportHeight : 800,
    width: Number.isFinite(viewportWidth) ? viewportWidth : 1280,
  },
});

const shots = [];
for (const model of models) {
  for (const [label, mode] of modes) {
    const url = new URL(base);
    url.searchParams.set("model", model);
    url.searchParams.set("mode", mode);
    url.searchParams.set("count", count);
    url.searchParams.set("durationMs", durationMs);
    url.searchParams.set("fps", "10");
    url.searchParams.set("scale", scale);
    url.searchParams.set("perspective", "600");
    url.searchParams.set("cameraSpeed", "38");
    url.searchParams.set("yawSpeed", "0");
    url.searchParams.set("sampleMs", "0");
    url.searchParams.set("ui", "0");

    await page.goto(url.toString(), { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__monsterLab?.ready === true, null, { timeout: 30000 });
    await page.evaluate(() => window.__monsterLab.start());
    await page.waitForTimeout(250);

    const file = `${model}-${label}.png`;
    await page.locator("#quake-app").screenshot({ path: path.join(outDir, file) });
    const stats = await page.evaluate(() => window.__monsterLab.stats());
    const material = stats.materialProfile ?? {};
    shots.push({
      file,
      label,
      mode,
      model,
      stats: {
        bboxPct: stats.geometry.bboxViewportPct,
        largestLeafPct: stats.geometry.largestLeafViewportPct,
        leafPct: stats.geometry.leafAreaViewportPct,
        materialPhase: material.phase ?? "none",
        solidLeafPct: material.motionSolidLeafPct ?? 0,
        solidProjPct: material.motionSolidProjectedLeafPct ?? 0,
        textureProjPct: material.motionTexturedProjectedLeafPct ?? 0,
        visibleLeaves: stats.geometry.visibleLeafCount,
      },
    });
  }
}

await browser.close();

const manifest = {
  base,
  count,
  durationMs,
  generatedAt: new Date().toISOString(),
  modes,
  models,
  scale,
  shots,
  viewport,
};
writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

await writeContactSheet({
  cropped: false,
  fileName: "contact-sheet.png",
  modes,
  models,
  outDir,
  tileHeight: 200,
  tileWidth: 320,
});
await writeContactSheet({
  cropped: true,
  fileName: "contact-sheet-cropped.png",
  modes,
  models,
  outDir,
  tileHeight: 240,
  tileWidth: 240,
});

console.log(outDir);
console.log(JSON.stringify(shots, null, 2));

async function writeContactSheet({
  cropped,
  fileName,
  modes,
  models,
  outDir,
  tileHeight,
  tileWidth,
}) {
  const labelHeight = 28;
  const headerHeight = 34;
  const rowLabelWidth = 82;
  const gap = 8;
  const width = rowLabelWidth + modes.length * tileWidth + (modes.length + 1) * gap;
  const height = headerHeight + models.length * (labelHeight + tileHeight) + (models.length + 1) * gap;
  const composites = [];

  for (let col = 0; col < modes.length; col += 1) {
    composites.push({
      input: labelSvg(modes[col][0], tileWidth, headerHeight, 15),
      left: rowLabelWidth + gap + col * (tileWidth + gap),
      top: 0,
    });
  }

  for (let row = 0; row < models.length; row += 1) {
    const model = models[row];
    const rowTop = headerHeight + gap + row * (labelHeight + tileHeight + gap);
    composites.push({
      input: labelSvg(model, rowLabelWidth, labelHeight + tileHeight, 16),
      left: 0,
      top: rowTop,
    });

    for (let col = 0; col < modes.length; col += 1) {
      const [label] = modes[col];
      const file = path.join(outDir, `${model}-${label}.png`);
      const image = await tileImage(file, tileWidth, tileHeight, cropped);
      const left = rowLabelWidth + gap + col * (tileWidth + gap);
      composites.push({ input: labelSvg(label, tileWidth, labelHeight, 13), left, top: rowTop });
      composites.push({ input: image, left, top: rowTop + labelHeight });
    }
  }

  await sharp({ create: { background: "#08090a", channels: 4, height, width } })
    .composite(composites)
    .png()
    .toFile(path.join(outDir, fileName));
}

async function tileImage(file, width, height, cropped) {
  let source = sharp(file);
  if (cropped) {
    try {
      const trimmed = await source.trim({ background: "#000000", threshold: 12 }).png().toBuffer();
      source = sharp(trimmed);
    } catch {
      source = sharp(file);
    }
  }
  return source.resize(width, height, {
    background: "#08090a",
    fit: "contain",
    kernel: cropped ? "nearest" : "lanczos3",
  }).png().toBuffer();
}

function labelSvg(text, width, height, size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#101214"/>
  <text x="${width / 2}" y="${Math.round(height / 2 + size / 3)}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="#e6e2d6" text-anchor="middle">${escapeSvg(text)}</text>
</svg>`);
}

function escapeSvg(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function listOpt(name, fallback) {
  return opt(name, fallback).split(",").map((value) => value.trim()).filter(Boolean);
}

function parseModes(value) {
  if (!value.trim()) return [];
  return value.split(",").map((entry) => {
    const [label, mode] = entry.split(":").map((part) => part.trim());
    if (!label || !mode) throw new Error(`Invalid --modes entry: ${entry}`);
    return [label, mode];
  });
}

function opt(name, fallback) {
  const long = `--${name}`;
  const prefixed = `${long}=`;
  const index = args.indexOf(long);
  if (index >= 0) return args[index + 1] ?? fallback;
  const arg = args.find((value) => value.startsWith(prefixed));
  return arg ? arg.slice(prefixed.length) : fallback;
}
