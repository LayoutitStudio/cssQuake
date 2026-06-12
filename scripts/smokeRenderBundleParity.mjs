import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import sharp from "sharp";

import {
  buildQuakeAnimatedRenderBundleHappyDom,
  buildQuakeRenderBundleHappyDom,
} from "../src/prepare/renderBundleHappyDom.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const bundleEntryPath = path.join(projectRoot, "src/prepare/bundle.mjs");
const textureUrl = "/q/parity/t/0.png";
const candidateName = process.env.QUAKE_RENDER_BUNDLE_CANDIDATE?.trim() || "playwright";

const tempDir = await mkdtemp(path.join(tmpdir(), "cssquake-render-parity-"));

try {
  const texture = await createParityTexture();
  const staticInput = {
    polygons: createParityPolygons(textureUrl),
    textureQuality: 1,
    extractLeafStyles: true,
    styleClassName: "rparity",
    tightenAtlasLeaves: true,
    adaptiveAtlasLeafSize: false,
    optimizeAtlasLeafBasis: true,
    optimizeAtlasLeafHomography: false,
    optimizeAtlasTriangleBasis: false,
  };
  const animatedInput = {
    frames: [
      {
        bundleName: "parity/f0",
        styleClassName: "rframe0",
        polygons: createParityPolygons(textureUrl),
      },
      {
        bundleName: "parity/f1",
        styleClassName: "rframe1",
        polygons: createParityPolygons(textureUrl, { zOffset: 0.08 }),
      },
    ],
    textureQuality: 1,
    extractLeafStyles: true,
    tightenAtlasLeaves: true,
    adaptiveAtlasLeafSize: false,
    optimizeAtlasLeafBasis: true,
    optimizeAtlasLeafHomography: false,
    optimizeAtlasTriangleBasis: false,
  };

  const staticOracle = await buildStaticWithPlaywright(staticInput, texture);
  const staticCandidate = await buildStaticWithCandidate(candidateName, staticInput, texture);
  const animatedOracle = await buildAnimatedWithPlaywright(animatedInput, texture);
  const animatedCandidate = await buildAnimatedWithCandidate(candidateName, animatedInput, texture);

  const comparison = await compareAllRenderBundleResults([
    ["static", staticOracle, staticCandidate],
    ...animatedOracle.frames.map((frame, index) => [
      `animated:${index}`,
      frame,
      animatedCandidate.frames[index],
    ]),
  ]);
  if (!comparison.acceptable && process.env.QUAKE_RENDER_BUNDLE_PARITY_DEBUG_DIR?.trim()) {
    await writeDebugAssets(
      process.env.QUAKE_RENDER_BUNDLE_PARITY_DEBUG_DIR.trim(),
      staticOracle.assets ?? [],
      staticCandidate.assets ?? [],
    );
  }
  if (!comparison.acceptable) {
    console.error(formatComparisonFailure(comparison));
    process.exitCode = 1;
  } else {
    const mode = comparison.equal ? "exact" : "semantic";
    console.log(`Render bundle parity passed (${candidateName}, ${mode}): ${comparison.hash}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function buildStaticWithCandidate(name, input, texture) {
  if (name === "playwright") return buildStaticWithPlaywright(input, texture);
  if (name === "happy-dom") {
    return buildQuakeRenderBundleHappyDom(input, {
      readTextureUrl: async (url) => {
        if (url !== textureUrl) throw new Error(`Unexpected texture URL ${url}`);
        return texture;
      },
      contentTypeForTextureUrl: () => "image/png",
    });
  }
  throw new Error(`Unknown render bundle candidate ${JSON.stringify(name)}.`);
}

async function buildAnimatedWithCandidate(name, input, texture) {
  if (name === "playwright") return buildAnimatedWithPlaywright(input, texture);
  if (name === "happy-dom") {
    return buildQuakeAnimatedRenderBundleHappyDom(input, {
      readTextureUrl: async (url) => {
        if (url !== textureUrl) throw new Error(`Unexpected texture URL ${url}`);
        return texture;
      },
      contentTypeForTextureUrl: () => "image/png",
    });
  }
  throw new Error(`Unknown render bundle candidate ${JSON.stringify(name)}.`);
}

async function buildStaticWithPlaywright(input, texture) {
  return buildWithPlaywright(input, texture, "static");
}

async function buildAnimatedWithPlaywright(input, texture) {
  return buildWithPlaywright(input, texture, "animated");
}

async function buildWithPlaywright(input, texture, mode) {
  const bundlePath = path.join(tempDir, "quakeRenderBundle.bundle.js");
  await build({
    entryPoints: [bundleEntryPath],
    outfile: bundlePath,
    bundle: true,
    define: {
      "process.env": "{}",
    },
    platform: "browser",
    format: "iife",
    globalName: "QuakeRenderBundleEntry",
    absWorkingDir: projectRoot,
    logLevel: "silent",
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (error) => {
      console.error(error);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    page.on("crash", () => {
      console.error("Playwright oracle page crashed.");
    });
    await page.addInitScript(() => {
      window.__quakeRenderBundleImageInfo = async (url) => {
        const response = await fetch(url);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        bitmap.close?.();
        return {
          width: canvas.width,
          height: canvas.height,
          data,
        };
      };
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.resourceType() === "document") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><html><head></head><body></body></html>",
        });
        return;
      }
      if (url.pathname === textureUrl) {
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: texture,
        });
        return;
      }
      await route.fulfill({ status: 204, body: "" });
    });
    await page.goto("http://quake-render-bundle.local/");
    await page.addScriptTag({ path: bundlePath });
    return await page.evaluate(
      async ({ renderInput, renderMode }) => renderMode === "animated"
        ? window.__buildQuakeAnimatedRenderBundle(renderInput)
        : window.__buildQuakeRenderBundle(renderInput),
      { renderInput: input, renderMode: mode },
    );
  } finally {
    await browser.close();
  }
}

async function createParityTexture() {
  const width = 16;
  const height = 16;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      rgba[offset] = x * 16;
      rgba[offset + 1] = y * 16;
      rgba[offset + 2] = (x + y) * 8;
      rgba[offset + 3] = x < 2 || y < 2 ? 96 : 255;
    }
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function createParityPolygons(texture, options = {}) {
  const zOffset = options.zOffset ?? 0;
  return [
    {
      vertices: [
        [-1.2, -1.2, zOffset],
        [1.2, -1.2, zOffset],
        [1.2, 1.2, zOffset],
        [-1.2, 1.2, zOffset],
      ],
      color: "#ffffff",
      texture,
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      textureAlphaMode: "masked",
      data: { "tex": "parity" },
    },
    {
      vertices: [
        [-0.6, -0.6, 0.3 + zOffset],
        [0.8, -0.4, 0.3 + zOffset],
        [0.1, 0.9, 0.3 + zOffset],
      ],
      color: "#cc8844",
      data: { "solid": "triangle" },
    },
  ];
}

async function compareRenderBundleResults(oracle, candidate) {
  const normalizedOracle = normalizeRenderBundleResult(oracle);
  const normalizedCandidate = normalizeRenderBundleResult(candidate);
  const oracleAssetPixels = await assetPixelFingerprints(oracle.assets ?? []);
  const candidateAssetPixels = await assetPixelFingerprints(candidate.assets ?? []);
  const assetPixelDiffs = await compareAssetPixels(oracle.assets ?? [], candidate.assets ?? []);
  const oracleText = JSON.stringify(normalizedOracle);
  const candidateText = JSON.stringify(normalizedCandidate);
  const fieldEqual = {
    meshHtml: normalizedOracle.meshHtml === normalizedCandidate.meshHtml,
    meshCss: normalizedOracle.meshCss === normalizedCandidate.meshCss,
    meshCssWhitespaceNormalized:
      normalizeCssWhitespace(normalizedOracle.meshCss) === normalizeCssWhitespace(normalizedCandidate.meshCss),
    assets: JSON.stringify(normalizedOracle.assets) === JSON.stringify(normalizedCandidate.assets),
    assetPixels: JSON.stringify(oracleAssetPixels) === JSON.stringify(candidateAssetPixels),
    leafMetadata: JSON.stringify(normalizedOracle.leafMetadata) === JSON.stringify(normalizedCandidate.leafMetadata),
    leafFrameStyles: JSON.stringify(normalizedOracle.leafFrameStyles) === JSON.stringify(normalizedCandidate.leafFrameStyles),
    leafFrameStylesWhitespaceNormalized:
      JSON.stringify(normalizeLeafFrameStyles(normalizedOracle.leafFrameStyles)) ===
      JSON.stringify(normalizeLeafFrameStyles(normalizedCandidate.leafFrameStyles)),
    counts: normalizedOracle.polygonCount === normalizedCandidate.polygonCount &&
      normalizedOracle.leafCount === normalizedCandidate.leafCount &&
      normalizedOracle.atlasLeafCount === normalizedCandidate.atlasLeafCount,
  };
  const acceptable = fieldEqual.meshHtml &&
    fieldEqual.meshCssWhitespaceNormalized &&
    fieldEqual.assetPixels &&
    fieldEqual.leafMetadata &&
    fieldEqual.leafFrameStylesWhitespaceNormalized &&
    fieldEqual.counts;
  return {
    equal: oracleText === candidateText,
    acceptable,
    hash: createHash("sha256").update(oracleText).digest("hex"),
    fieldEqual,
    assetPixels: {
      oracle: oracleAssetPixels,
      candidate: candidateAssetPixels,
      diffs: assetPixelDiffs,
    },
    oracle: normalizedOracle,
    candidate: normalizedCandidate,
    firstDifference: firstDifference(oracleText, candidateText),
  };
}

async function compareAllRenderBundleResults(cases) {
  const comparisons = [];
  for (const [name, oracle, candidate] of cases) {
    comparisons.push({
      name,
      ...await compareRenderBundleResults(oracle, candidate),
    });
  }
  const firstFailed = comparisons.find((comparison) => !comparison.acceptable) ?? null;
  const representative = firstFailed ?? comparisons[0];
  return {
    ...representative,
    equal: comparisons.every((comparison) => comparison.equal),
    acceptable: comparisons.every((comparison) => comparison.acceptable),
    hash: createHash("sha256")
      .update(comparisons.map((comparison) => comparison.hash).join("\n"))
      .digest("hex"),
    cases: comparisons.map((comparison) => ({
      name: comparison.name,
      equal: comparison.equal,
      acceptable: comparison.acceptable,
      fieldEqual: comparison.fieldEqual,
      assetPixels: comparison.assetPixels,
    })),
  };
}

function normalizeRenderBundleResult(result) {
  return {
    meshHtml: result.meshHtml,
    meshCss: result.meshCss ?? "",
    assets: (result.assets ?? []).map((asset) => ({
      placeholder: asset.placeholder,
      mime: asset.mime,
      sha256: createHash("sha256").update(Buffer.from(asset.base64, "base64")).digest("hex"),
      byteLength: Buffer.from(asset.base64, "base64").byteLength,
    })),
    leafMetadata: result.leafMetadata ?? [],
    leafFrameStyles: result.leafFrameStyles ?? [],
    polygonCount: result.polygonCount,
    leafCount: result.leafCount,
    atlasLeafCount: result.atlasLeafCount,
    atlasLeafBasisOptimizationStats: result.atlasLeafBasisOptimizationStats ?? null,
    atlasLeafHomographyOptimizationStats: result.atlasLeafHomographyOptimizationStats ?? null,
    adaptiveAtlasLeafSizeStats: result.adaptiveAtlasLeafSizeStats ?? null,
    transformSnapStats: result.transformSnapStats ?? null,
    atlasBackgroundSnapStats: result.atlasBackgroundSnapStats ?? null,
  };
}

async function assetPixelFingerprints(assets) {
  return Promise.all(assets.map(async (asset) => {
    const buffer = Buffer.from(asset.base64, "base64");
    try {
      const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return {
        placeholder: asset.placeholder,
        width: info.width,
        height: info.height,
        channels: info.channels,
        sha256: createHash("sha256").update(data).digest("hex"),
      };
    } catch {
      return {
        placeholder: asset.placeholder,
        decodeError: true,
        encodedSha256: createHash("sha256").update(buffer).digest("hex"),
      };
    }
  }));
}

async function compareAssetPixels(oracleAssets, candidateAssets) {
  const diffs = [];
  const count = Math.min(oracleAssets.length, candidateAssets.length);
  for (let index = 0; index < count; index++) {
    const oracle = await decodeAssetPixels(oracleAssets[index]);
    const candidate = await decodeAssetPixels(candidateAssets[index]);
    if (!oracle || !candidate) continue;
    if (oracle.width !== candidate.width || oracle.height !== candidate.height || oracle.channels !== candidate.channels) {
      diffs.push({
        index,
        dimensionsEqual: false,
        oracle: { width: oracle.width, height: oracle.height, channels: oracle.channels },
        candidate: { width: candidate.width, height: candidate.height, channels: candidate.channels },
      });
      continue;
    }
    let differingPixels = 0;
    let differingChannels = 0;
    let maxChannelDelta = 0;
    let totalChannelDelta = 0;
    for (let offset = 0; offset < oracle.data.length; offset += oracle.channels) {
      let pixelDiffers = false;
      for (let channel = 0; channel < oracle.channels; channel++) {
        const delta = Math.abs(oracle.data[offset + channel] - candidate.data[offset + channel]);
        if (!delta) continue;
        pixelDiffers = true;
        differingChannels++;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        totalChannelDelta += delta;
      }
      if (pixelDiffers) differingPixels++;
    }
    diffs.push({
      index,
      dimensionsEqual: true,
      totalPixels: oracle.width * oracle.height,
      differingPixels,
      differingChannels,
      maxChannelDelta,
      totalChannelDelta,
    });
  }
  return diffs;
}

async function decodeAssetPixels(asset) {
  try {
    const { data, info } = await sharp(Buffer.from(asset.base64, "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  } catch {
    return null;
  }
}

function firstDifference(a, b) {
  const max = Math.min(a.length, b.length);
  for (let index = 0; index < max; index++) {
    if (a[index] !== b[index]) return {
      index,
      oracle: a.slice(Math.max(0, index - 160), index + 240),
      candidate: b.slice(Math.max(0, index - 160), index + 240),
    };
  }
  if (a.length !== b.length) {
    return {
      index: max,
      oracle: a.slice(Math.max(0, max - 160), max + 240),
      candidate: b.slice(Math.max(0, max - 160), max + 240),
    };
  }
  return null;
}

function formatComparisonFailure(comparison) {
  return [
    "Render bundle parity failed.",
    `Field equality: ${JSON.stringify(comparison.fieldEqual)}`,
    `Oracle leaves/assets: ${comparison.oracle.leafCount}/${comparison.oracle.assets.length}`,
    `Candidate leaves/assets: ${comparison.candidate.leafCount}/${comparison.candidate.assets.length}`,
    `Asset pixels: ${JSON.stringify(comparison.assetPixels)}`,
    `Oracle CSS: ${comparison.oracle.meshCss}`,
    `Candidate CSS: ${comparison.candidate.meshCss}`,
    `First diff: ${JSON.stringify(comparison.firstDifference, null, 2)}`,
  ].join("\n");
}

function normalizeCssWhitespace(css) {
  return String(css)
    .replace(/#([0-9a-f]{6})\b/gi, (_match, hex) => {
      const value = Number.parseInt(hex, 16);
      return `rgb(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255})`;
    })
    .replace(/\s*([{}:;,/])\s*/g, "$1")
    .replace(/;}/g, "}")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLeafFrameStyles(styles) {
  return styles.map(([leafClass, frameStyle]) => [
    leafClass,
    Array.isArray(frameStyle)
      ? frameStyle.map((part) => typeof part === "string" ? normalizeCssWhitespace(part) : part)
      : frameStyle,
  ]);
}

async function writeDebugAssets(outputDir, oracleAssets, candidateAssets) {
  await mkdir(outputDir, { recursive: true });
  for (let index = 0; index < Math.max(oracleAssets.length, candidateAssets.length); index++) {
    if (oracleAssets[index]) {
      await writeFile(
        path.join(outputDir, `oracle-${index}.png`),
        Buffer.from(oracleAssets[index].base64, "base64"),
      );
    }
    if (candidateAssets[index]) {
      await writeFile(
        path.join(outputDir, `candidate-${index}.png`),
        Buffer.from(candidateAssets[index].base64, "base64"),
      );
    }
  }
}
