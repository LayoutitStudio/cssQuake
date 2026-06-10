#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "../..");
const generatedPublicDir = process.env.QUAKE_GENERATED_PUBLIC_DIR?.trim()
  ? path.resolve(projectRoot, process.env.QUAKE_GENERATED_PUBLIC_DIR.trim())
  : path.join(projectRoot, "build/generated/public");
const quakeGeneratedDir = path.join(generatedPublicDir, "q");
const pickupModelsPath = path.join(quakeGeneratedDir, "pickups.json");
const programMetadataPath = path.join(quakeGeneratedDir, "progs.json");
const generatedJsonPath = path.join(projectRoot, "src/generated/quakeModelRenderCostFacts.json");
const generatedTsPath = path.join(projectRoot, "src/generated/quakeModelRenderCostFacts.ts");

const tierRank = {
  static: 0,
  low: 1,
  medium: 2,
  high: 3,
  extreme: 4,
};

function json(value) {
  return JSON.stringify(value, null, 2);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function publicUrlToFilePath(url) {
  return path.join(generatedPublicDir, String(url).replace(/^\/+/, ""));
}

function stableLeafFrameStylesRef(url) {
  const match = String(url).match(/^\/?q\/[^/]+\/b\/(.+)$/);
  if (match) return match[1];
  return String(url).replace(/^\/+/, "");
}

function renderBundleForModel(model) {
  return model.animationFrameSet?.renderBundle ?? model.renderBundle ?? model.animationFrames?.[0]?.renderBundle ?? null;
}

function animationFrameCount(model) {
  return Array.isArray(model.animationFrames) && model.animationFrames.length ? model.animationFrames.length : 1;
}

function modelLeafCount(model, renderBundle) {
  return Number(model.animationFrameSet?.leafCount ?? renderBundle?.leafCount ?? 0) || 0;
}

function modelPolygonCount(renderBundle) {
  return Number(renderBundle?.polygonCount ?? 0) || 0;
}

function costTierFor(avgChangedMatrixLeaves, leafCount, frameCount) {
  if (frameCount <= 1 || leafCount <= 0) return "static";
  if (avgChangedMatrixLeaves >= 400 || leafCount >= 500) return "extreme";
  if (avgChangedMatrixLeaves >= 240 || leafCount >= 256) return "high";
  if (avgChangedMatrixLeaves >= 120 || leafCount >= 128) return "medium";
  return "low";
}

function footprintTierFor(frameStyleByteLength, leafSlots) {
  if (leafSlots <= 0 || frameStyleByteLength <= 0) return "static";
  if (frameStyleByteLength >= 2_500_000 || leafSlots >= 50_000) return "extreme";
  if (frameStyleByteLength >= 1_000_000 || leafSlots >= 25_000) return "high";
  if (frameStyleByteLength >= 250_000 || leafSlots >= 8_000) return "medium";
  return "low";
}

function maxTier(left, right) {
  return tierRank[left] >= tierRank[right] ? left : right;
}

function packedLeafStyle(frames, frameIndex, leafIndex) {
  const frame = frames[frameIndex];
  const style = frame?.[leafIndex];
  return Array.isArray(style) ? style : [];
}

function matrixAt(frames, frameIndex, leafIndex) {
  return packedLeafStyle(frames, frameIndex, leafIndex)[0] ?? "";
}

function analyzePackedLeafFrameStyles(frames, declaredLeafCount, frameStyleByteLength) {
  const frameCount = frames.length;
  const leafCount = Math.max(
    declaredLeafCount,
    ...frames.map((frame) => Array.isArray(frame) ? frame.length : 0),
  );
  const leafSlots = frameCount * leafCount;
  let matrixSetLeafSlots = 0;
  let baselineBackgroundLeafSlots = 0;
  let baselineExtraStyleLeafSlots = 0;
  let dynamicBackgroundChangeLeafSlots = 0;
  let dynamicExtraStyleChangeLeafSlots = 0;
  let dynamicBackgroundPreserveBaseLeafSlots = 0;
  const transitionChangedMatrixLeaves = [];

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
      const style = packedLeafStyle(frames, frameIndex, leafIndex);
      if (style[0]) matrixSetLeafSlots += 1;
      if (frameIndex === 0) {
        if (style[1]) baselineBackgroundLeafSlots += 1;
        if (style[2]) baselineExtraStyleLeafSlots += 1;
        continue;
      }
      if (style.length >= 2 && style[1] === null) dynamicBackgroundPreserveBaseLeafSlots += 1;
      if (style.length >= 2 && style[1] !== null) dynamicBackgroundChangeLeafSlots += 1;
      if (style.length >= 3) dynamicExtraStyleChangeLeafSlots += 1;
    }
  }

  for (let frameIndex = 1; frameIndex < frameCount; frameIndex += 1) {
    let changed = 0;
    for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
      if (matrixAt(frames, frameIndex, leafIndex) !== matrixAt(frames, frameIndex - 1, leafIndex)) changed += 1;
    }
    transitionChangedMatrixLeaves.push(changed);
  }

  const transitionCount = transitionChangedMatrixLeaves.length;
  const totalChangedMatrixLeaves = transitionChangedMatrixLeaves.reduce((sum, value) => sum + value, 0);
  const avgChangedMatrixLeaves = transitionCount ? totalChangedMatrixLeaves / transitionCount : 0;
  const maxChangedMatrixLeaves = transitionChangedMatrixLeaves.length
    ? Math.max(...transitionChangedMatrixLeaves)
    : 0;
  const minChangedMatrixLeaves = transitionChangedMatrixLeaves.length
    ? Math.min(...transitionChangedMatrixLeaves)
    : 0;
  const dynamicStyleChangeLeafSlots = dynamicBackgroundChangeLeafSlots + dynamicExtraStyleChangeLeafSlots;
  const dynamicLeafSlots = Math.max(0, (frameCount - 1) * leafCount);
  const mutationKind = frameCount <= 1
    ? "static"
    : dynamicStyleChangeLeafSlots > 0
      ? "transform-and-style"
      : "transform-only-after-mount";
  const perFrameMutationTier = costTierFor(avgChangedMatrixLeaves, leafCount, frameCount);
  const packedStyleFootprintTier = footprintTierFor(frameStyleByteLength, leafSlots);

  return {
    allTransitionsChangeAllLeaves: transitionCount > 0 && transitionChangedMatrixLeaves.every((value) => value === leafCount),
    avgChangedMatrixLeafPct: round(leafCount ? avgChangedMatrixLeaves / leafCount : 0, 4),
    avgChangedMatrixLeaves: round(avgChangedMatrixLeaves, 2),
    baselineBackgroundLeafSlots,
    baselineExtraStyleLeafSlots,
    dynamicBackgroundChangeLeafSlots,
    dynamicBackgroundPreserveBaseLeafSlots,
    dynamicExtraStyleChangeLeafSlots,
    dynamicStyleChangeLeafPct: round(dynamicLeafSlots ? dynamicStyleChangeLeafSlots / (dynamicLeafSlots * 2) : 0, 4),
    frameStyleByteLength,
    leafSlots,
    matrixSetLeafSlotPct: round(leafSlots ? matrixSetLeafSlots / leafSlots : 0, 4),
    maxChangedMatrixLeafPct: round(leafCount ? maxChangedMatrixLeaves / leafCount : 0, 4),
    maxChangedMatrixLeaves,
    minChangedMatrixLeafPct: round(leafCount ? minChangedMatrixLeaves / leafCount : 0, 4),
    minChangedMatrixLeaves,
    mutationKind,
    packedStyleFootprintTier,
    perFrameMutationTier,
    transitionCount,
  };
}

async function readLeafFrameStyleAnalysis(renderBundle, leafCount) {
  const url = renderBundle?.leafFrameStylesUrl;
  if (!url) {
    return {
      frameStyleStatus: "none",
      leafFrameStylesRef: "",
      styleAnalysis: null,
    };
  }
  const file = publicUrlToFilePath(url);
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return {
      frameStyleStatus: "missing",
      leafFrameStylesRef: stableLeafFrameStylesRef(url),
      styleAnalysis: null,
    };
  }
  const parsed = JSON.parse(raw);
  if (parsed?.version !== 3 || !Array.isArray(parsed.frames)) {
    return {
      frameStyleStatus: "unsupported",
      leafFrameStylesRef: stableLeafFrameStylesRef(url),
      styleAnalysis: null,
    };
  }
  return {
    frameStyleStatus: "loaded",
    leafFrameStyleVersion: parsed.version,
    leafFrameStylesRef: stableLeafFrameStylesRef(url),
    styleAnalysis: analyzePackedLeafFrameStyles(parsed.frames, leafCount, byteLength(raw)),
  };
}

async function modelRenderCostFact(modelPath, model) {
  const renderBundle = renderBundleForModel(model);
  const frameCount = animationFrameCount(model);
  const leafCount = modelLeafCount(model, renderBundle);
  const polygonCount = modelPolygonCount(renderBundle);
  const frameSet = Boolean(model.animationFrameSet);
  const frameStyle = await readLeafFrameStyleAnalysis(renderBundle, leafCount);
  const styleAnalysis = frameStyle.styleAnalysis;
  const staticTier = frameCount <= 1 ? "static" : "low";
  const perFrameMutationTier = styleAnalysis?.perFrameMutationTier ?? staticTier;
  const packedStyleFootprintTier = styleAnalysis?.packedStyleFootprintTier ?? staticTier;

  return {
    modelPath,
    source: model.source ?? modelPath,
    renderBackend: frameSet ? "frame-set" : renderBundle ? "static-bundle" : "unknown",
    frameCount,
    leafCount,
    polygonCount,
    atlasLeafCount: Number(renderBundle?.atlasLeafCount ?? 0) || 0,
    assetCount: Array.isArray(renderBundle?.assetUrls) ? renderBundle.assetUrls.length : 0,
    meshHtmlByteLength: byteLength(renderBundle?.meshHtml ?? ""),
    hasLeafFrameStyles: frameStyle.frameStyleStatus === "loaded",
    frameStyleStatus: frameStyle.frameStyleStatus,
    ...(frameStyle.leafFrameStyleVersion ? { leafFrameStyleVersion: frameStyle.leafFrameStyleVersion } : {}),
    ...(frameStyle.leafFrameStylesRef ? { leafFrameStylesRef: frameStyle.leafFrameStylesRef } : {}),
    mutationKind: styleAnalysis?.mutationKind ?? (frameCount <= 1 ? "static" : "unknown"),
    perFrameMutationTier,
    packedStyleFootprintTier,
    costTier: maxTier(perFrameMutationTier, packedStyleFootprintTier),
    avgChangedMatrixLeaves: styleAnalysis?.avgChangedMatrixLeaves ?? 0,
    avgChangedMatrixLeafPct: styleAnalysis?.avgChangedMatrixLeafPct ?? 0,
    maxChangedMatrixLeaves: styleAnalysis?.maxChangedMatrixLeaves ?? 0,
    maxChangedMatrixLeafPct: styleAnalysis?.maxChangedMatrixLeafPct ?? 0,
    minChangedMatrixLeaves: styleAnalysis?.minChangedMatrixLeaves ?? 0,
    minChangedMatrixLeafPct: styleAnalysis?.minChangedMatrixLeafPct ?? 0,
    allTransitionsChangeAllLeaves: Boolean(styleAnalysis?.allTransitionsChangeAllLeaves),
    dynamicStyleChangeLeafPct: styleAnalysis?.dynamicStyleChangeLeafPct ?? 0,
    dynamicBackgroundChangeLeafSlots: styleAnalysis?.dynamicBackgroundChangeLeafSlots ?? 0,
    dynamicExtraStyleChangeLeafSlots: styleAnalysis?.dynamicExtraStyleChangeLeafSlots ?? 0,
    dynamicBackgroundPreserveBaseLeafSlots: styleAnalysis?.dynamicBackgroundPreserveBaseLeafSlots ?? 0,
    baselineBackgroundLeafSlots: styleAnalysis?.baselineBackgroundLeafSlots ?? 0,
    baselineExtraStyleLeafSlots: styleAnalysis?.baselineExtraStyleLeafSlots ?? 0,
    frameStyleByteLength: styleAnalysis?.frameStyleByteLength ?? 0,
    leafFrameStyleSlots: styleAnalysis?.leafSlots ?? 0,
    matrixSetLeafSlotPct: styleAnalysis?.matrixSetLeafSlotPct ?? 0,
    transitionCount: styleAnalysis?.transitionCount ?? 0,
  };
}

function classifyClassname(classname) {
  if (classname === "worldspawn") return "world";
  if (classname.startsWith("monster_")) return "monster";
  if (classname.startsWith("weapon_") || classname.startsWith("item_")) return "pickup";
  if (classname.startsWith("trigger_")) return "trigger";
  if (classname.startsWith("func_")) return "mover";
  if (classname.startsWith("light_")) return "light";
  return "misc";
}

function classModelSource(pathname, directModels, runtimeModels) {
  const direct = directModels.includes(pathname);
  const runtime = runtimeModels.includes(pathname);
  if (direct && runtime) return "precache+runtime";
  if (runtime) return "runtime";
  return "precache";
}

function primaryModelPathForClass(classname, modelPaths, modelFacts) {
  const existing = modelPaths.filter((modelPath) => modelFacts[modelPath]);
  if (!existing.length) return "";
  if (classname.startsWith("monster_")) {
    const animated = existing.find((modelPath) => modelFacts[modelPath].frameCount > 1);
    if (animated) return animated;
  }
  return existing[0];
}

function buildClassModelFacts(programMetadata, modelFacts) {
  const directByClass = programMetadata.modelsByClassname ?? {};
  const runtimeByClass = programMetadata.sourceRuntimeModelsByClassname ?? {};
  const classnames = new Set([...Object.keys(directByClass), ...Object.keys(runtimeByClass)]);
  const entries = [];
  for (const classname of classnames) {
    const directModels = Array.isArray(directByClass[classname]) ? directByClass[classname] : [];
    const runtimeModels = Array.isArray(runtimeByClass[classname]) ? runtimeByClass[classname] : [];
    const modelPaths = [...new Set([...directModels, ...runtimeModels])].filter((modelPath) => modelFacts[modelPath]);
    const primaryModelPath = primaryModelPathForClass(classname, modelPaths, modelFacts);
    entries.push([
      classname,
      {
        classname,
        kind: classifyClassname(classname),
        primaryModelPath,
        primaryCostTier: primaryModelPath ? modelFacts[primaryModelPath].costTier : "unknown",
        models: modelPaths.map((modelPath) => ({
          modelPath,
          source: classModelSource(modelPath, directModels, runtimeModels),
          costTier: modelFacts[modelPath].costTier,
          frameCount: modelFacts[modelPath].frameCount,
          leafCount: modelFacts[modelPath].leafCount,
        })),
      },
    ]);
  }
  return sortedObject(entries);
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function summaryFacts(modelFacts, classModelFacts) {
  const costTierCounts = new Map();
  const primaryClassCostTierCounts = new Map();
  const classKindCounts = new Map();
  const models = Object.values(modelFacts);
  const classes = Object.values(classModelFacts);
  for (const fact of models) increment(costTierCounts, fact.costTier);
  for (const fact of classes) {
    increment(primaryClassCostTierCounts, fact.primaryCostTier);
    increment(classKindCounts, fact.kind);
  }
  const topAnimatedModelsByAvgChangedLeaves = models
    .filter((fact) => fact.frameCount > 1)
    .sort((left, right) => right.avgChangedMatrixLeaves - left.avgChangedMatrixLeaves)
    .slice(0, 12)
    .map((fact) => ({
      modelPath: fact.modelPath,
      costTier: fact.costTier,
      frameCount: fact.frameCount,
      leafCount: fact.leafCount,
      avgChangedMatrixLeaves: fact.avgChangedMatrixLeaves,
      avgChangedMatrixLeafPct: fact.avgChangedMatrixLeafPct,
    }));

  return {
    animatedFrameSetModelCount: models.filter((fact) => fact.renderBackend === "frame-set").length,
    classModelFactCount: classes.length,
    classKindCounts: Object.fromEntries([...classKindCounts].sort(([left], [right]) => left.localeCompare(right))),
    costTierCounts: Object.fromEntries([...costTierCounts].sort(([left], [right]) => tierRank[left] - tierRank[right])),
    modelCount: models.length,
    primaryClassCostTierCounts: Object.fromEntries(
      [...primaryClassCostTierCounts].sort(([left], [right]) => (tierRank[left] ?? 99) - (tierRank[right] ?? 99)),
    ),
    staticModelCount: models.filter((fact) => fact.frameCount <= 1).length,
    topAnimatedModelsByAvgChangedLeaves,
  };
}

function renderGeneratedTs() {
  return `// Generated by src/prepare/modelRenderCostFacts.mjs. Do not edit by hand.
// Derived from existing prepared cssQuake render bundles and QuakeC model metadata.

import facts from "./quakeModelRenderCostFacts.json";

export type QuakeModelRenderBackend = "frame-set" | "static-bundle" | "unknown";

export type QuakeModelRenderCostTier = "static" | "low" | "medium" | "high" | "extreme" | "unknown";

export type QuakeModelRenderMutationKind =
  | "static"
  | "transform-only-after-mount"
  | "transform-and-style"
  | "unknown";

export type QuakeModelRenderClassKind =
  | "light"
  | "misc"
  | "monster"
  | "mover"
  | "pickup"
  | "trigger"
  | "world";

export interface QuakeModelRenderCostFact {
  allTransitionsChangeAllLeaves: boolean;
  assetCount: number;
  atlasLeafCount: number;
  avgChangedMatrixLeafPct: number;
  avgChangedMatrixLeaves: number;
  baselineBackgroundLeafSlots: number;
  baselineExtraStyleLeafSlots: number;
  costTier: QuakeModelRenderCostTier;
  dynamicBackgroundChangeLeafSlots: number;
  dynamicBackgroundPreserveBaseLeafSlots: number;
  dynamicExtraStyleChangeLeafSlots: number;
  dynamicStyleChangeLeafPct: number;
  frameCount: number;
  frameStyleByteLength: number;
  frameStyleStatus: "loaded" | "missing" | "none" | "unsupported";
  hasLeafFrameStyles: boolean;
  leafCount: number;
  leafFrameStyleSlots: number;
  leafFrameStyleVersion?: number;
  leafFrameStylesRef?: string;
  matrixSetLeafSlotPct: number;
  maxChangedMatrixLeafPct: number;
  maxChangedMatrixLeaves: number;
  meshHtmlByteLength: number;
  minChangedMatrixLeafPct: number;
  minChangedMatrixLeaves: number;
  modelPath: string;
  mutationKind: QuakeModelRenderMutationKind;
  packedStyleFootprintTier: QuakeModelRenderCostTier;
  perFrameMutationTier: QuakeModelRenderCostTier;
  polygonCount: number;
  renderBackend: QuakeModelRenderBackend;
  source: string;
  transitionCount: number;
}

export interface QuakeModelRenderClassModelRef {
  costTier: QuakeModelRenderCostTier;
  frameCount: number;
  leafCount: number;
  modelPath: string;
  source: "precache" | "precache+runtime" | "runtime";
}

export interface QuakeModelRenderClassFact {
  classname: string;
  kind: QuakeModelRenderClassKind;
  models: readonly QuakeModelRenderClassModelRef[];
  primaryCostTier: QuakeModelRenderCostTier;
  primaryModelPath: string;
}

export interface QuakeModelRenderCostFactsFile {
  version: 1;
  source: {
    modelLibrary: string;
    programMetadata: string;
  };
  summary: {
    animatedFrameSetModelCount: number;
    classModelFactCount: number;
    classKindCounts: Readonly<Record<string, number>>;
    costTierCounts: Readonly<Record<string, number>>;
    modelCount: number;
    primaryClassCostTierCounts: Readonly<Record<string, number>>;
    staticModelCount: number;
    topAnimatedModelsByAvgChangedLeaves: readonly Pick<
      QuakeModelRenderCostFact,
      "avgChangedMatrixLeafPct" | "avgChangedMatrixLeaves" | "costTier" | "frameCount" | "leafCount" | "modelPath"
    >[];
  };
  models: Readonly<Record<string, QuakeModelRenderCostFact>>;
  classModels: Readonly<Record<string, QuakeModelRenderClassFact>>;
}

export const QUAKE_MODEL_RENDER_COST_FACTS = facts as QuakeModelRenderCostFactsFile;
export const QUAKE_MODEL_RENDER_COST_FACTS_BY_MODEL = QUAKE_MODEL_RENDER_COST_FACTS.models;
export const QUAKE_MODEL_RENDER_COST_FACTS_BY_CLASS = QUAKE_MODEL_RENDER_COST_FACTS.classModels;
`;
}

const pickupModels = await readJson(pickupModelsPath);
const programMetadata = await readJson(programMetadataPath);
const models = isRecord(pickupModels.models) ? pickupModels.models : {};
const modelEntries = [];

for (const [modelPath, model] of Object.entries(models).sort(([left], [right]) => left.localeCompare(right))) {
  if (!isRecord(model)) continue;
  modelEntries.push([modelPath, await modelRenderCostFact(modelPath, model)]);
}

const modelFacts = sortedObject(modelEntries);
const classModelFacts = buildClassModelFacts(programMetadata, modelFacts);
const facts = {
  version: 1,
  source: {
    modelLibrary: "build/generated/public/q/pickups.json",
    programMetadata: "build/generated/public/q/progs.json",
  },
  summary: summaryFacts(modelFacts, classModelFacts),
  models: modelFacts,
  classModels: classModelFacts,
};

await mkdir(path.dirname(generatedJsonPath), { recursive: true });
await writeFile(generatedJsonPath, `${json(facts)}\n`);
await writeFile(generatedTsPath, renderGeneratedTs());

console.log(`Wrote ${path.relative(projectRoot, generatedJsonPath)}`);
console.log(`Wrote ${path.relative(projectRoot, generatedTsPath)}`);
