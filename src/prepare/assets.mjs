import { build } from "esbuild";
import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import sharp from "sharp";

import {
  deriveQuakeGameLogicModelPreloads,
  deriveQuakeGameLogicSoundPreloads,
} from "./gameLogicPreloads.mjs";
import { replaceQuakeRenderBundleWorldAtlas } from "./deterministicAtlas.mjs";
import { QUAKE_UNIT_SCALE } from "../quakeScale.js";

const require = createRequire(import.meta.url);
const { path7z } = require("7z-bin");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "../..");
let inlineHappyDomRenderBundleModulePromise = null;
const generatedPublicDir = process.env.QUAKE_GENERATED_PUBLIC_DIR?.trim()
  ? path.resolve(projectRoot, process.env.QUAKE_GENERATED_PUBLIC_DIR.trim())
  : path.join(projectRoot, "build/generated/public");
const quakePublicPath = "/q";
const quakeOutputDir = path.join(generatedPublicDir, quakePublicPath.slice(1));
const quakeAssetVersion = normalizeQuakeAssetVersion(process.env.QUAKE_ASSET_VERSION) ||
  cssQuakeAssetVersion();
const quakeAssetPublicPath = `${quakePublicPath}/${quakeAssetVersion}`;
const quakeTexturePublicPath = `${quakeAssetPublicPath}/t`;
const quakeRenderBundlePublicPath = `${quakeAssetPublicPath}/b`;
const quakeAssetOutputDir = path.join(quakeOutputDir, quakeAssetVersion);
const legacyQuakeOutputDir = path.join(generatedPublicDir, "local/quake");
const socialImageSourcePath = path.join(projectRoot, "src/assets/cssquake-social.webp");
const socialImageOutputPath = path.join(generatedPublicDir, "assets/cssquake-social.webp");
const staticPublicAssets = [
  [socialImageSourcePath, socialImageOutputPath],
  [path.join(projectRoot, "src/assets/apple-touch-icon.png"), path.join(generatedPublicDir, "assets/apple-touch-icon.png")],
  [path.join(projectRoot, "src/assets/app-icon-192.png"), path.join(generatedPublicDir, "assets/app-icon-192.png")],
  [path.join(projectRoot, "src/assets/app-icon-512.png"), path.join(generatedPublicDir, "assets/app-icon-512.png")],
  [path.join(projectRoot, "src/assets/maskable-icon-512.png"), path.join(generatedPublicDir, "assets/maskable-icon-512.png")],
  [path.join(projectRoot, "src/assets/site.webmanifest"), path.join(generatedPublicDir, "manifest.webmanifest")],
];
const menuTitleLevelSelectSourcePath = path.join(projectRoot, "src/assets/menu-title-level-select-source.png");
const quakeMapNames = ["start", "e1m1", "e1m2", "e1m3", "e1m4", "e1m5", "e1m6", "e1m7", "e1m8"];
const quakeRenderBundleDefaultMapNames = quakeMapNames;
const quakeStartMap = "e1m1";
const quakeSelectableMapNames = new Set(quakeMapNames.filter((mapName) => mapName !== "start"));
const quakeMapTitles = new Map([
  ["start", "Introduction"],
  ["e1m1", "the Slipgate Complex"],
  ["e1m2", "Castle of the Damned"],
  ["e1m3", "the Necropolis"],
  ["e1m4", "the Grisly Grotto"],
  ["e1m5", "Gloom Keep"],
  ["e1m6", "The Door To Chthon"],
  ["e1m7", "The House of Chthon"],
  ["e1m8", "Ziggurat Vertigo"],
]);
const mapOutputPaths = new Map(quakeMapNames.map((mapName) => [
  `maps/${mapName}.bsp`,
  path.join(quakeOutputDir, `${mapName}.json`),
]));
const manifestOutputPath = path.join(quakeOutputDir, "manifest.json");
const hudOutputPath = path.join(quakeOutputDir, "hud.png");
const hudBaseOutputPath = path.join(quakeOutputDir, "hud-base.png");
const hudInventoryOutputPath = path.join(quakeOutputDir, "hud-inventory.png");
const hudIconsOutputPath = path.join(quakeOutputDir, "hud-icons.png");
const hudNumbersOutputPath = path.join(quakeOutputDir, "hud-numbers.png");
const hudDamageNumbersOutputPath = path.join(quakeOutputDir, "hud-numbers-damage.png");
const mainMenuOutputPath = path.join(quakeOutputDir, "main-menu.png");
const mainMenuMultiplayerOutputPath = path.join(quakeOutputDir, "main-menu-multiplayer.png");
const mainMenuActiveOutputPath = path.join(quakeOutputDir, "main-menu-active.png");
const mainMenuActiveOutputPaths = [
  mainMenuActiveOutputPath,
  path.join(quakeOutputDir, "main-menu-active-level-select.png"),
  path.join(quakeOutputDir, "main-menu-active-options.png"),
  path.join(quakeOutputDir, "main-menu-active-help.png"),
];
const mainMenuCursorOutputPath = path.join(quakeOutputDir, "main-menu-cursor.png");
const aboutOutputPath = path.join(quakeOutputDir, "about.png");
const menuPanelTextureOutputPath = path.join(quakeOutputDir, "menu-panel-texture.png");
const QUAKE_MENU_PANEL_TEXTURE_NAMES = [
  "wbrick1_5",
  "wiz1_4",
  "stone1_3",
  "wizmet1_2",
];
const menuTitleLevelSelectOutputPath = path.join(quakeOutputDir, "menu-title-level-select.png");
const menuTitleOptionsOutputPath = path.join(quakeOutputDir, "menu-title-options.png");
const menuTitleHelpOutputPath = path.join(quakeOutputDir, "menu-title-help.png");
const concharsOutputPath = path.join(quakeOutputDir, "conchars.png");
const weaponOutputPath = path.join(quakeOutputDir, "weapon.json");
const pickupOutputPath = path.join(quakeOutputDir, "pickups.json");
const progsOutputPath = path.join(quakeOutputDir, "progs.json");
const soundManifestOutputPath = path.join(quakeOutputDir, "sounds.json");
const sourceProgramFactsInputPath = path.join(projectRoot, "src/generated/quakeProgramFacts.json");
const sourcePath = path.join(projectRoot, "src/prepare/scene.ts");
const textureOutputDir = path.join(quakeAssetOutputDir, "t");
const soundOutputDir = path.join(quakeOutputDir, "s");
const renderBundleOutputDir = path.join(quakeAssetOutputDir, "b");
const quakeRenderBundleAvifQuality = Number.parseInt(process.env.QUAKE_RENDER_BUNDLE_AVIF_QUALITY ?? "70", 10);
const quakeRenderBundleAvifEffort = Number.parseInt(process.env.QUAKE_RENDER_BUNDLE_AVIF_EFFORT ?? "4", 10);
const quakeRenderBundleConcurrency = Number.parseInt(process.env.QUAKE_RENDER_BUNDLE_CONCURRENCY ?? "", 10);
const quakeRenderBundleModelConcurrency = Number.parseInt(process.env.QUAKE_RENDER_BUNDLE_MODEL_CONCURRENCY ?? "", 10);
const quakeRenderBundleEngine = normalizeQuakeRenderBundleEngine(process.env.QUAKE_RENDER_BUNDLE_ENGINE ?? "happy-dom");
const quakeRenderBundleFastFrameStyles = process.env.QUAKE_RENDER_BUNDLE_FAST_FRAME_STYLES !== "0";
const quakePrepareMapOnly = process.env.QUAKE_PREPARE_MAP_ONLY === "1";
const quakePrepareOnly = normalizeQuakePrepareOnly(process.env.QUAKE_PREPARE_ONLY ?? "");
const quakePrepareModelsOnly = quakePrepareOnly === "models";
const quakePrepareModelOnly = parseQuakePrepareModelOnly(process.env.QUAKE_PREPARE_MODEL_ONLY ?? "");
const quakePrepareReferencedModelsOnly = process.env.QUAKE_PREPARE_REFERENCED_MODELS_ONLY !== "0";
const quakeRenderBundleAdaptiveAtlasLeafSize = process.env.QUAKE_RENDER_BUNDLE_ADAPTIVE_ATLAS_LEAF_SIZE === "1";
const quakePrepareMapOnlyAllowNewManifest = process.env.QUAKE_PREPARE_MAP_ONLY_ALLOW_NEW_MANIFEST === "1";
const quakeDomTighteningTargets = parseQuakeDomTighteningTargets(process.env.QUAKE_DOM_TIGHTENING ?? "all");
const quakeTriangleAtlasBasis = process.env.QUAKE_TRIANGLE_ATLAS_BASIS === "1";
const quakeDeterministicWorldAtlas = process.env.QUAKE_DETERMINISTIC_WORLD_ATLAS !== "0";
const quakeDeferDeterministicWorldAtlasWrites = process.env.QUAKE_DEFER_DETERMINISTIC_WORLD_ATLAS_WRITES !== "0";
const quakeDeterministicWorldAtlasImagePolicy =
  process.env.QUAKE_DETERMINISTIC_WORLD_ATLAS_IMAGE_POLICY?.trim().toLowerCase() ?? "atlas";
const quakeAliasRebakeMerge = process.env.QUAKE_ALIAS_REBAKE_MERGE === "1";
const quakeAliasRebakeMergeAffineEpsilon = Number.parseFloat(
  process.env.QUAKE_ALIAS_REBAKE_MERGE_AFFINE_EPSILON ?? "",
);
const quakeLightmapBake = process.env.QUAKE_LIGHTMAP_BAKE !== "0";
const quakeLightmapBakeDetailTarget = Number.parseFloat(process.env.QUAKE_LIGHTMAP_BAKE_DETAIL_TARGET ?? "");
const quakeLightmapBakeLightSupersample = Number.parseInt(process.env.QUAKE_LIGHTMAP_BAKE_LIGHT_SUPERSAMPLE ?? "", 10);
const quakeLightmapBakeMaxSide = Number.parseInt(process.env.QUAKE_LIGHTMAP_BAKE_MAX_SIDE ?? "", 10);
const quakeLightmapBakeMaxTotalTexels = Number.parseInt(process.env.QUAKE_LIGHTMAP_BAKE_MAX_TOTAL_TEXELS ?? "", 10);
const quakeLightmapBakeMinDisplaySide = Number.parseFloat(process.env.QUAKE_LIGHTMAP_BAKE_MIN_DISPLAY_SIDE ?? "");
const quakeLightmapBakeMinTextureScale = Number.parseFloat(process.env.QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SCALE ?? "");
const quakeLightmapBakeMinTextureSide = Number.parseInt(process.env.QUAKE_LIGHTMAP_BAKE_MIN_TEXTURE_SIDE ?? "", 10);
const quakeLightmapBakeTextureFallbackOverlay = process.env.QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY === "1";
const quakeLightmapBakeTextureFallbackOverlayMaxExtraRatio = Number.parseFloat(
  process.env.QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_RATIO ?? "",
);
const quakeLightmapBakeTextureFallbackOverlayMaxSide = Number.parseInt(
  process.env.QUAKE_LIGHTMAP_BAKE_TEXTURE_FALLBACK_OVERLAY_MAX_SIDE ?? "",
  10,
);
const quakeLightmapBakeMergedOverlay = process.env.QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY === "1";
const quakeLightmapBakeMergedOverlayMaxExtraRatio = Number.parseFloat(
  process.env.QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_RATIO ?? "",
);
const quakeLightmapBakeMergedOverlayMaxSide = Number.parseInt(
  process.env.QUAKE_LIGHTMAP_BAKE_MERGED_OVERLAY_MAX_SIDE ?? "",
  10,
);
const quakeLightmapBakeMinRange = Number.parseFloat(process.env.QUAKE_LIGHTMAP_BAKE_MIN_RANGE ?? "");
const quakeLightmapOverlay = process.env.QUAKE_LIGHTMAP_OVERLAY === "1";
const quakeLightmapOverlayMaxExtraRatio = Number.parseFloat(process.env.QUAKE_LIGHTMAP_OVERLAY_MAX_EXTRA_RATIO ?? "");
const quakeLightmapOverlayMaxSide = Number.parseInt(process.env.QUAKE_LIGHTMAP_OVERLAY_MAX_SIDE ?? "", 10);
const quakeLightmapOverlayMinRange = Number.parseFloat(process.env.QUAKE_LIGHTMAP_OVERLAY_MIN_RANGE ?? "");
const renderBundleMapNames = new Set(
  (process.env.QUAKE_RENDER_BUNDLE_MAPS ?? quakeRenderBundleDefaultMapNames.join(","))
    .split(",")
    .map((mapName) => mapName.trim().toLowerCase())
    .filter(Boolean),
);
const polycssPackage = JSON.parse(await readFile(
  path.join(projectRoot, "node_modules/@layoutit/polycss/package.json"),
  "utf8",
));
const EXPECTED_RESOURCE_SIZE = 9_086_574;
const EXPECTED_RESOURCE_SHA256 = "c192c9c71bee41750dd7d14c99378766d61e077977b9d13d1a457b8d9eabe34a";
const QUAKE_HUD_TRANSPARENT = 255;
const QUAKE_HUD_WIDTH = 320;
const QUAKE_HUD_HEIGHT = 24;
const QUAKE_HUD_ICON_SLOT_SIZE = 24;
const QUAKE_HUD_ICON_QPICS = [
  "sb_armor1",
  "sb_armor2",
  "sb_armor3",
  "face1",
  "face_invis",
  "face_invul2",
  "face_inv2",
  "face_quad",
  "sb_shells",
  "sb_nails",
  "sb_rocket",
  "sb_cells",
  "sb_key1",
  "sb_key2",
  "sb_invis",
  "sb_invuln",
  "sb_suit",
  "sb_quad",
];
const QUAKE_MENU_WIDTH = 320;
const QUAKE_MENU_HEIGHT = 200;
const QUAKE_ABOUT_WIDTH = 320;
const QUAKE_ABOUT_HEIGHT = 200;
const QUAKE_MENU_FRAME_COUNT = 6;
const QUAKE_MENU_CURSOR_WIDTH = 16;
const QUAKE_MENU_CURSOR_HEIGHT = 24;
const QUAKE_MAIN_MENU_ITEM_X = 72;
const QUAKE_MAIN_MENU_ROW_HEIGHT = 20;
const QUAKE_MAIN_MENU_ACTIVE_ROW_WIDTH = 240;
const QUAKE_MAIN_MENU_ROW_TOPS = [28, 52, 76, 100, 126];
const QUAKE_MAIN_MENU_LEVEL_LABEL = "LEVEL SELECT";
const QUAKE_MAIN_MENU_LEVEL_LABEL_SCALE = 2;
const QUAKE_PICKUP_MODEL_SCALE = QUAKE_UNIT_SCALE;
const QUAKE_WEAPON_MODEL_PIVOT = [1.0, 0, 0];
const QUAKE_ENEMY_ALIAS_MODEL_RENDER_SCALE = 4;
const QUAKE_ANIMATION_FRAME_SET_MIN_COMMON_LEAF_RATIO = 0.95;
const QUAKE_ALIAS_MERGE_MAX_NONPLANAR_DISTANCE = 0.03;
const QUAKE_ALIAS_MERGE_UV_EPSILON = 1e-6;
const QUAKE_ALIAS_MERGE_GEOMETRY_EPSILON = 1e-8;
const QUAKE_ALIAS_REBAKE_MERGE_AFFINE_EPSILON = Number.isFinite(quakeAliasRebakeMergeAffineEpsilon)
  ? Math.max(0, quakeAliasRebakeMergeAffineEpsilon)
  : 0.0025;
const QUAKE_ALIAS_SKIN_PADDING_RADIUS = 4;
const QUAKE_ALIAS_SKIN_FILLER_INDEX = 208;
const QUAKE_DEBUG_OUTLINE_WIDTH = 0.5;
const QUAKE_DEBUG_OUTLINE_DEFAULT_ATLAS_SIZE = 64;
const QUAKE_DEBUG_OUTLINE_COLORS = {
  world: "#008000",
  sky: "#00ffff",
  special: "#00ffff",
  animated: "#00ffff",
  lit: "#008000",
  brush: "#ffff00",
  entity: "#ffff00",
  pickup: "#ffff00",
  enemy: "#ff0000",
  lightstyle: "#00ffff",
  viewmodel: "#ffff00",
};
const QUAKE_PICKUP_MODEL_PATHS = {
  item_armor1: "progs/armor.mdl",
  item_armor2: "progs/armor.mdl",
  item_key1: "progs/w_s_key.mdl",
  item_key2: "progs/w_g_key.mdl",
  item_artifact_super_damage: "progs/quaddama.mdl",
  item_artifact_invulnerability: "progs/invulner.mdl",
  item_artifact_envirosuit: "progs/suit.mdl",
  item_artifact_invisibility: "progs/invisibl.mdl",
  weapon_nailgun: "progs/g_nail.mdl",
  weapon_supernailgun: "progs/g_nail2.mdl",
  weapon_supershotgun: "progs/g_shot.mdl",
  weapon_grenadelauncher: "progs/g_rock.mdl",
  weapon_rocketlauncher: "progs/g_rock2.mdl",
  key_silver: "progs/w_s_key.mdl",
  key_gold: "progs/w_g_key.mdl",
};
const QUAKE_PICKUP_BSP_MODEL_PATHS = [
  "maps/b_batt0.bsp",
  "maps/b_batt1.bsp",
  "maps/b_bh10.bsp",
  "maps/b_bh100.bsp",
  "maps/b_bh25.bsp",
  "maps/b_nail0.bsp",
  "maps/b_nail1.bsp",
  "maps/b_rock0.bsp",
  "maps/b_rock1.bsp",
  "maps/b_shell0.bsp",
  "maps/b_shell1.bsp",
  "maps/b_exbox2.bsp",
  "maps/b_explob.bsp",
];
const QUAKE_MONSTER_MODEL_PATHS = {
  monster_army: "progs/soldier.mdl",
  monster_dog: "progs/dog.mdl",
  monster_enforcer: "progs/enforcer.mdl",
  monster_fish: "progs/fish.mdl",
  monster_knight: "progs/knight.mdl",
  monster_ogre: "progs/ogre.mdl",
  monster_wizard: "progs/wizard.mdl",
  monster_zombie: "progs/zombie.mdl",
  monster_demon1: "progs/demon.mdl",
  monster_hell_knight: "progs/hknight.mdl",
  monster_shalrath: "progs/shalrath.mdl",
  monster_shambler: "progs/shambler.mdl",
  monster_tarbaby: "progs/tarbaby.mdl",
  monster_boss: "progs/boss.mdl",
  monster_oldone: "progs/oldone.mdl",
};
const QUAKE_ANIMATED_MONSTER_ALIAS_MODEL_PATHS = [
  "progs/boss.mdl",
  "progs/demon.mdl",
  "progs/dog.mdl",
  "progs/knight.mdl",
  "progs/ogre.mdl",
  "progs/shambler.mdl",
  "progs/soldier.mdl",
  "progs/wizard.mdl",
  "progs/zombie.mdl",
];
const QUAKE_PROJECTILE_ALIAS_MODEL_PATHS = [
  "progs/bolt.mdl",
  "progs/grenade.mdl",
  "progs/k_spike.mdl",
  "progs/laser.mdl",
  "progs/lavaball.mdl",
  "progs/v_spike.mdl",
  "progs/w_spike.mdl",
  "progs/zom_gib.mdl",
];
const QUAKE_MONSTER_PROJECTILE_MODEL_PATHS = {
  monster_boss: "progs/lavaball.mdl",
  monster_hell_knight: "progs/k_spike.mdl",
  monster_ogre: "progs/grenade.mdl",
  monster_shalrath: "progs/v_spike.mdl",
  monster_wizard: "progs/w_spike.mdl",
  monster_zombie: "progs/zom_gib.mdl",
};

const tempDir = await mkdtemp(path.join(tmpdir(), "polycss-quake-preparse-"));
const bundlePath = path.join(tempDir, "quakePreparedScene.bundle.mjs");
const sharewareDownloadPath = path.join(tempDir, "quake-shareware-download");
const sharewareExtractDir = path.join(tempDir, "quake-shareware");
const resourcePath = path.join(tempDir, "resource.1");
const extractedPakPath = path.join(tempDir, "ID1/PAK0.PAK");
let renderBundleBuilder = null;
const textureFileUrlByHash = new Map();
const texturePngByPublicPath = new Map();
const deferredRenderBundleAssetsSymbol = Symbol("deferredRenderBundleAssets");

function normalizeQuakeAssetVersion(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    throw new Error(`Unsafe QUAKE_ASSET_VERSION ${JSON.stringify(value)}.`);
  }
  return normalized;
}

function cssQuakeAssetVersion() {
  let baseVersion = "0";
  try {
    const commitCount = execSync("git rev-list --count HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^\d+$/.test(commitCount)) baseVersion = commitCount;
  } catch {
    // Netlify invalidates each deploy, so a fixed local fallback is still cache-safe there.
  }
  return baseVersion;
}

function normalizeQuakeRenderBundleEngine(value) {
  const normalized = String(value ?? "happy-dom").trim().toLowerCase();
  if (!normalized || normalized === "happy-dom" || normalized === "happydom") return "happy-dom";
  throw new Error(
    `Unsupported QUAKE_RENDER_BUNDLE_ENGINE ${JSON.stringify(value)}. ` +
    `Use "happy-dom".`,
  );
}

function normalizeQuakePrepareOnly(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all") return "";
  if (normalized === "model") return "models";
  if (normalized === "models") return "models";
  throw new Error(
    `Unsupported QUAKE_PREPARE_ONLY ${JSON.stringify(value)}. ` +
    `Use "models" for focused model bundle runs, or leave it unset for the full prepare.`,
  );
}

function parseQuakePrepareModelOnly(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function quakePrepareModelOnlyMatches(source) {
  if (quakePrepareModelOnly.size === 0) return true;
  const normalized = String(source ?? "").trim().toLowerCase();
  const basename = path.basename(normalized);
  const stem = basename.replace(/\.(?:mdl|bsp)$/i, "");
  return quakePrepareModelOnly.has(normalized) ||
    quakePrepareModelOnly.has(basename) ||
    quakePrepareModelOnly.has(stem);
}

function selectedQuakeMapEntries() {
  if (quakePrepareModelsOnly) return [];
  const entries = quakePrepareMapOnly
    ? [...mapOutputPaths].filter(([mapPath]) => shouldBuildRenderBundleForMap(mapNameFromPakPath(mapPath)))
    : [...mapOutputPaths];
  if (entries.length > 0) return entries;
  throw new Error(
    "QUAKE_PREPARE_MAP_ONLY=1 needs at least one map in QUAKE_RENDER_BUNDLE_MAPS, " +
    "for example QUAKE_RENDER_BUNDLE_MAPS=e1m1.",
  );
}

function shouldBuildRenderBundleForMap(mapName) {
  return renderBundleMapNames.has(mapName) ||
    renderBundleMapNames.has("*") ||
    renderBundleMapNames.has("all");
}

function parseQuakeDomTighteningTargets(value) {
  if (value === undefined) return null;
  const targets = new Set();
  for (let token of value.split(",")) {
    token = token.trim().toLowerCase();
    if (!token || token === "0" || token === "off" || token === "false" || token === "none") continue;
    if (token === "pickup") token = "pickups";
    if (token === "monster") token = "monsters";
    if (token === "models") {
      targets.add("pickups");
      targets.add("monsters");
      continue;
    }
    if (!["all", "world", "pickups", "monsters", "other"].includes(token)) {
      throw new Error(
        `Unknown QUAKE_DOM_TIGHTENING target ${JSON.stringify(token)}. ` +
        "Use world,pickups,monsters,models,all,none.",
      );
    }
    targets.add(token);
  }
  return targets;
}

function quakeDomTighteningEnabled(target, fallback) {
  if (!quakeDomTighteningTargets) return fallback;
  return quakeDomTighteningTargets.has("all") || quakeDomTighteningTargets.has(target);
}

async function readStableQuakeAssetManifestForMapOnly() {
  let text = "";
  try {
    text = await readFile(manifestOutputPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" && quakePrepareMapOnlyAllowNewManifest) return null;
    if (error?.code === "ENOENT") {
      throw new Error("QUAKE_PREPARE_MAP_ONLY=1 requires an existing full Quake manifest. Run pnpm prepare:quake once first.");
    }
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error("QUAKE_PREPARE_MAP_ONLY=1 found an invalid existing Quake manifest. Run a full pnpm prepare:quake first.");
  }
  if (manifest?.status === "regenerating") {
    if (quakePrepareMapOnlyAllowNewManifest) return null;
    throw new Error("QUAKE_PREPARE_MAP_ONLY=1 found a regenerating manifest. Let the current prepare finish or run a full prepare.");
  }
  if (!Array.isArray(manifest?.maps) || !manifest?.assets) {
    if (quakePrepareMapOnlyAllowNewManifest) return null;
    throw new Error("QUAKE_PREPARE_MAP_ONLY=1 found an incomplete manifest. Run a full pnpm prepare:quake first.");
  }
  return text;
}

async function removeSelectedQuakeMapOutputs(mapEntries) {
  await Promise.all(mapEntries.flatMap(([mapPath]) => {
    const mapName = mapNameFromPakPath(mapPath);
    return [
      rm(mapOutputPaths.get(mapPath), { force: true }),
      rm(path.join(renderBundleOutputDir, mapName), { recursive: true, force: true }),
      rm(path.join(renderBundleOutputDir, `${mapName}l`), { recursive: true, force: true }),
    ];
  }));
}

try {
  const stableManifestJson = quakePrepareMapOnly
    ? await readStableQuakeAssetManifestForMapOnly()
    : "";
  const mapEntriesToPrepare = selectedQuakeMapEntries();
  if (!quakePrepareModelsOnly) {
    await writeQuakeAssetRegenerationManifest({
      mode: quakePrepareMapOnly ? "map-only" : "full",
      mapNames: mapEntriesToPrepare.map(([mapPath]) => mapNameFromPakPath(mapPath)),
    });
  }
  await runPrepareStep("pak", async () => {
    if (process.env.QUAKE_PAK_PATH?.trim()) {
      await copyQuakePakFromPath(process.env.QUAKE_PAK_PATH.trim());
    } else {
      await downloadQuakeResource();
      await verifyQuakeResource();
      await extractQuakePak();
    }
  });
  if (quakePrepareMapOnly) {
    await removeSelectedQuakeMapOutputs(mapEntriesToPrepare);
    await rm(textureOutputDir, { recursive: true, force: true });
    console.log(
      `Preparing map-only Quake assets for ${mapEntriesToPrepare.map(([mapPath]) => mapNameFromPakPath(mapPath)).join(", ")}`,
    );
  } else if (quakePrepareModelsOnly) {
    console.log(
      `Preparing model-only Quake assets` +
      `${quakePrepareModelOnly.size ? ` for ${[...quakePrepareModelOnly].join(", ")}` : ""}`,
    );
  } else {
    await rm(legacyQuakeOutputDir, { recursive: true, force: true });
    await removeLegacyQuakeJsonFiles();
    await removeGeneratedQuakeAssetVersionDirs();
    await rm(textureOutputDir, { recursive: true, force: true });
    await rm(soundOutputDir, { recursive: true, force: true });
    await rm(renderBundleOutputDir, { recursive: true, force: true });
    await rm(path.join(quakeOutputDir, "t"), { recursive: true, force: true });
    await rm(path.join(quakeOutputDir, "b"), { recursive: true, force: true });
    await rm(path.join(quakeOutputDir, "p"), { recursive: true, force: true });
    await copyStaticPublicAssets();
  }

  await runPrepareStep("scene compiler bundle", () => build({
    entryPoints: [sourcePath],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    absWorkingDir: projectRoot,
    logLevel: "silent",
  }));

  renderBundleBuilder = await runPrepareStep("render engine init", () => createQuakeRenderBundleBuilder({
    concurrency: quakePrepareModelsOnly
      ? normalizedQuakeRenderBundleModelConcurrency()
      : normalizedQuakeRenderBundleConcurrency(),
    engine: quakeRenderBundleEngine,
  }));

  const {
    buildQuakeLightstyleOverlayPolygons,
    createQuakeSceneFromPreparedScene,
    createQuakePreparedSceneFromPakBuffer,
    parseQuakePakDirectory,
  } = await import(pathToFileURL(bundlePath).href);
  const pak = await readFile(extractedPakPath);
  const buffer = pak.buffer.slice(pak.byteOffset, pak.byteOffset + pak.byteLength);
  const sourceProgramFacts = await loadQuakeSourceProgramFacts();

  if (quakePrepareModelsOnly) {
    const uiAssets = loadQuakeHudAssets(pak, parseQuakePakDirectory);
    const programMetadata = buildQuakeProgramMetadata(uiAssets, sourceProgramFacts);
    const pickupModels = await runPrepareStep("model bundles", () => buildQuakePickupModels(
      uiAssets,
      async (mapPath) => createQuakeSceneFromPreparedScene(await createQuakePreparedSceneFromPakBuffer(buffer, {
        encodeTextureUrl: encodeTextureFileUrl,
        gameLogicProgramFacts: sourceProgramFacts,
        mapPath,
      })),
      programMetadata,
      renderBundleBuilder,
      { concurrency: normalizedQuakeRenderBundleModelConcurrency() },
    ));
    const outputPickupModels = quakePrepareModelOnly.size > 0
      ? await mergeQuakePickupModelOutput(pickupModels)
      : pickupModels;
    await mkdir(path.dirname(pickupOutputPath), { recursive: true });
    await writeFile(pickupOutputPath, JSON.stringify(outputPickupModels));
    const modelCount = Object.keys(pickupModels.models).length;
    console.log(`Prepared ${modelCount} model bundle${modelCount === 1 ? "" : "s"}`);
    console.log(`Wrote ${path.relative(projectRoot, pickupOutputPath)}`);
  } else {
    const preparedMaps = await runPrepareStep("maps", () => mapConcurrently(
      mapEntriesToPrepare,
      normalizedQuakeRenderBundleConcurrency(),
      async ([mapPath, outputPath]) => {
        const mapName = mapNameFromPakPath(mapPath);
        const deterministicRenderBundleMap = quakeDeterministicWorldAtlas && shouldBuildRenderBundleForMap(mapName);
        return runPrepareStep(`map ${mapName}`, async () => {
          const prepared = await createQuakePreparedSceneFromPakBuffer(buffer, {
            encodeTextureUrl: encodeTextureFileUrl,
            gameLogicProgramFacts: sourceProgramFacts,
            lightmapBake: quakeLightmapBake,
            ...(Number.isFinite(quakeLightmapBakeDetailTarget)
              ? { lightmapBakeDetailTarget: quakeLightmapBakeDetailTarget }
              : {}),
            ...(Number.isFinite(quakeLightmapBakeLightSupersample)
              ? { lightmapBakeLightSupersample: quakeLightmapBakeLightSupersample }
              : {}),
            ...(Number.isFinite(quakeLightmapBakeMaxSide) ? { lightmapBakeMaxSide: quakeLightmapBakeMaxSide } : {}),
            ...(Number.isFinite(quakeLightmapBakeMaxTotalTexels)
              ? { lightmapBakeMaxTotalTexels: quakeLightmapBakeMaxTotalTexels }
              : {}),
            ...(Number.isFinite(quakeLightmapBakeMinDisplaySide)
              ? { lightmapBakeMinDisplaySide: quakeLightmapBakeMinDisplaySide }
              : {}),
            ...(Number.isFinite(quakeLightmapBakeMinTextureScale)
              ? { lightmapBakeMinTextureScale: quakeLightmapBakeMinTextureScale }
              : {}),
            ...(Number.isFinite(quakeLightmapBakeMinTextureSide)
              ? { lightmapBakeMinTextureSide: quakeLightmapBakeMinTextureSide }
              : {}),
            lightmapBakeTextureEncoding: !deterministicRenderBundleMap,
            lightmapBakeTextureFallbackOverlay: quakeLightmapBakeTextureFallbackOverlay,
            ...(Number.isFinite(quakeLightmapBakeTextureFallbackOverlayMaxExtraRatio)
              ? { lightmapBakeTextureFallbackOverlayMaxExtraRatio: quakeLightmapBakeTextureFallbackOverlayMaxExtraRatio }
              : {}),
            ...(Number.isFinite(quakeLightmapBakeTextureFallbackOverlayMaxSide)
              ? { lightmapBakeTextureFallbackOverlayMaxSide: quakeLightmapBakeTextureFallbackOverlayMaxSide }
              : {}),
            lightmapBakeMergedOverlay: quakeLightmapBakeMergedOverlay,
            ...(Number.isFinite(quakeLightmapBakeMergedOverlayMaxExtraRatio)
              ? { lightmapBakeMergedOverlayMaxExtraRatio: quakeLightmapBakeMergedOverlayMaxExtraRatio }
              : {}),
            ...(Number.isFinite(quakeLightmapBakeMergedOverlayMaxSide)
              ? { lightmapBakeMergedOverlayMaxSide: quakeLightmapBakeMergedOverlayMaxSide }
              : {}),
            ...(Number.isFinite(quakeLightmapBakeMinRange) ? { lightmapBakeMinRange: quakeLightmapBakeMinRange } : {}),
            lightmapOverlay: quakeLightmapOverlay,
            ...(Number.isFinite(quakeLightmapOverlayMaxExtraRatio)
              ? { lightmapOverlayMaxExtraRatio: quakeLightmapOverlayMaxExtraRatio }
              : {}),
            ...(Number.isFinite(quakeLightmapOverlayMaxSide) ? { lightmapOverlayMaxSide: quakeLightmapOverlayMaxSide } : {}),
            ...(Number.isFinite(quakeLightmapOverlayMinRange) ? { lightmapOverlayMinRange: quakeLightmapOverlayMinRange } : {}),
            litTextureEncoding: !deterministicRenderBundleMap,
            litTextureEncodingTextureNames: QUAKE_MENU_PANEL_TEXTURE_NAMES,
            mapPath,
          });
          const menuPanelTextureMap = {
            prepared: {
              label: prepared.label,
              textures: prepared.textures,
              polygons: prepared.polygons,
            },
          };
          if (shouldBuildRenderBundleForMap(mapName)) {
            const scene = await createQuakeSceneFromPreparedScene(prepared);
            const lightstyleOverlayPolygons = buildQuakeLightstyleOverlayPolygons(scene.polygons);
            const tightenWorldDom = quakeDomTighteningEnabled("world", false);
            const tightenWorldAtlasLeaves = tightenWorldDom && !quakeDeterministicWorldAtlas;
            prepared.renderBundle = await renderBundleBuilder.build({
              mapName,
              polygons: scene.polygons,
              deferAssetWrites: quakeDeterministicWorldAtlas && quakeDeferDeterministicWorldAtlasWrites,
              layoutOnly: quakeDeterministicWorldAtlas,
              tightenAtlasLeaves: tightenWorldAtlasLeaves,
              optimizeAtlasLeafBasis: tightenWorldDom,
              optimizeAtlasLeafHomography: tightenWorldDom,
            });
            if (quakeDeterministicWorldAtlas) {
              delete prepared.renderBundle.debugOutlineAssetUrls;
              delete prepared.renderBundle.debugTransparentOutlineAssetUrls;
              const deterministicAtlasStats = await replaceQuakeRenderBundleWorldAtlas({
                imagePolicy: quakeDeterministicWorldAtlasImagePolicy,
                mapPath,
                name: mapName,
                optimizeAtlasLeafBasis: tightenWorldDom,
                outputDir: path.join(renderBundleOutputDir, mapName),
                pakBuffer: pak,
                polygons: scene.polygons,
                publicPath: `${quakeRenderBundlePublicPath}/${mapName}`,
                readTextureUrl: readGeneratedPublicTextureFile,
                renderBundle: prepared.renderBundle,
                visibility: prepared.visibility,
              });
              prepared.renderBundle.deterministicWorldAtlasStats = deterministicAtlasStats;
              assertNoDeferredQuakeRenderBundleAssetReferences(prepared.renderBundle, deterministicAtlasStats);
              await addQuakeRenderBundleDebugOutlineAssets(prepared.renderBundle, {
                outlineKind: quakeRenderBundleDebugOutlineKindForName(mapName),
              });
              console.log(
                `Deterministic world atlas for ${mapName}: ` +
                `${deterministicAtlasStats.replacedLeaves} replaced, ` +
                `${deterministicAtlasStats.skippedLeaves} skipped, ` +
                `${deterministicAtlasStats.pageCount ?? 0} png pages, ` +
                `${deterministicAtlasStats.leafImageCount ?? 0} leaf images, ` +
                `${formatBytes(deterministicAtlasStats.pageBytes ?? 0)}`,
              );
            }
            if (lightstyleOverlayPolygons.length) {
              prepared.lightstyleRenderBundle = await renderBundleBuilder.build({
                bundleName: `${mapName}l`,
                polygons: lightstyleOverlayPolygons,
                tightenAtlasLeaves: tightenWorldDom,
                optimizeAtlasLeafBasis: tightenWorldDom,
                optimizeAtlasLeafHomography: tightenWorldDom,
              });
            } else {
              delete prepared.lightstyleRenderBundle;
            }
            stripPreparedRenderBundleFallbackTextures(prepared);
          }
          return { mapName, mapPath, outputPath, prepared, menuPanelTextureMap };
        });
      },
    ));
  const menuPanelTextureMaps = preparedMaps.map((item) => item.menuPanelTextureMap);

  for (const item of preparedMaps) {
    const { outputPath, prepared } = item;
    const preparedJson = JSON.stringify(prepared);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, preparedJson);
    item.size = Buffer.byteLength(preparedJson);
  }

  if (quakePrepareMapOnly) {
    await pruneUnreferencedTextureFiles(
      preparedMaps.map((item) => item.outputPath),
      { removeUnreferenced: false },
    );
    await writeFileAtomic(
      manifestOutputPath,
      stableManifestJson ?? JSON.stringify(buildQuakeAssetManifest(preparedMaps, {}, { models: {} })),
    );
    for (const { outputPath, prepared, size } of preparedMaps) {
      console.log(`Wrote ${path.relative(projectRoot, outputPath)} (${formatBytes(size)})`);
      console.log(`${prepared.label}: ${prepared.faceCount}/${prepared.sourceFaceCount} faces, ${prepared.textureCount} textures`);
    }
    console.log(
      `${stableManifestJson ? "Restored" : "Wrote"} ${path.relative(projectRoot, manifestOutputPath)} ` +
      "after map-only prepare",
    );
  } else {
    const uiAssets = loadQuakeHudAssets(pak, parseQuakePakDirectory);
    await runPrepareStep("ui assets", async () => {
      await writeFile(hudBaseOutputPath, await buildQuakeHudBasePng(uiAssets));
      await writeFile(hudInventoryOutputPath, await buildQuakeHudInventoryPng(uiAssets));
      await writeFile(hudIconsOutputPath, await buildQuakeHudIconsPng(uiAssets));
      await writeFile(hudNumbersOutputPath, await buildQuakeHudNumbersPng(uiAssets));
      await writeFile(hudDamageNumbersOutputPath, await buildQuakeHudNumbersPng(uiAssets, { damageTint: true }));
      await writeFile(hudOutputPath, await buildQuakeHudPng(uiAssets));
      await writeFile(mainMenuOutputPath, await buildQuakeMainMenuPng(uiAssets));
      await writeFile(mainMenuMultiplayerOutputPath, await buildQuakeMainMenuMultiplayerPng(uiAssets));
    });
    const menuTitlePaletteColors = buildQuakeMenuTitlePaletteColors(uiAssets);
    const mainMenuActivePngs = await buildQuakeMainMenuActivePngs(uiAssets);
    mainMenuActivePngs[1] = await buildCustomMenuTitlePng(menuTitleLevelSelectSourcePath, {
      height: 20,
      paletteColors: menuTitlePaletteColors,
    });
    for (let index = 0; index < mainMenuActivePngs.length; index++) {
      await writeFile(mainMenuActiveOutputPaths[index], mainMenuActivePngs[index]);
    }
    await writeFile(mainMenuCursorOutputPath, await buildQuakeMainMenuCursorPng(uiAssets));
    await writeFile(aboutOutputPath, await buildQuakeAboutPng(uiAssets));
    await writeFile(menuPanelTextureOutputPath, await buildQuakeMenuPanelTexturePng(menuPanelTextureMaps));
    await writeFile(menuTitleLevelSelectOutputPath, await buildCustomMenuTitlePng(menuTitleLevelSelectSourcePath, {
      height: 20,
      paletteColors: menuTitlePaletteColors,
    }));
    await writeFile(menuTitleOptionsOutputPath, await buildPakQpicCropPng(uiAssets, "gfx/mainmenu.lmp", 0, 40, 124, 20));
    await writeFile(menuTitleHelpOutputPath, await buildPakQpicCropPng(uiAssets, "gfx/mainmenu.lmp", 1, 60, 75, 20));
    await writeFile(concharsOutputPath, await buildQuakeConcharsPng(uiAssets));
    const programMetadata = buildQuakeProgramMetadata(uiAssets, sourceProgramFacts);
    await writeFile(weaponOutputPath, JSON.stringify(await runPrepareStep(
      "weapon model",
      () => buildQuakeWeaponModel(uiAssets, renderBundleBuilder),
    )));
    await writeFile(progsOutputPath, JSON.stringify(programMetadata));
    const modelRenderBundleConcurrency = normalizedQuakeRenderBundleModelConcurrency();
    if (modelRenderBundleConcurrency !== normalizedQuakeRenderBundleConcurrency()) {
      await renderBundleBuilder?.close?.();
      renderBundleBuilder = await runPrepareStep("model render engine init", () => createQuakeRenderBundleBuilder({
        concurrency: modelRenderBundleConcurrency,
        engine: quakeRenderBundleEngine,
      }));
    }
    let referencedModelPaths = quakePrepareReferencedModelsOnly
      ? quakeReferencedModelPathsForPreparedMaps(
          preparedMaps,
          programMetadata,
          quakePickupModelCandidatePaths(uiAssets, programMetadata),
        )
      : null;
    if (quakePrepareReferencedModelsOnly && referencedModelPaths.size === 0) {
      console.warn("Referenced model filter found no prepared map model paths; building all model bundles.");
      referencedModelPaths = null;
    }
    const pickupModels = await runPrepareStep("model bundles", () => buildQuakePickupModels(
      uiAssets,
      async (mapPath) => createQuakeSceneFromPreparedScene(await createQuakePreparedSceneFromPakBuffer(buffer, {
        encodeTextureUrl: encodeTextureFileUrl,
        gameLogicProgramFacts: sourceProgramFacts,
        mapPath,
      })),
      programMetadata,
      renderBundleBuilder,
      {
        concurrency: modelRenderBundleConcurrency,
        referencedModelPaths,
      },
    ));
    await writeFile(pickupOutputPath, JSON.stringify(pickupModels));
    const soundManifest = await runPrepareStep("sounds", () => exportQuakeSounds(pak, parseQuakePakDirectory));
    await writeFile(soundManifestOutputPath, JSON.stringify(soundManifest));
    await writeFileAtomic(manifestOutputPath, JSON.stringify(buildQuakeAssetManifest(
      preparedMaps,
      programMetadata,
      pickupModels,
      soundManifest,
    )));
    await pruneUnreferencedTextureFiles([
      ...preparedMaps.map((item) => item.outputPath),
      weaponOutputPath,
      pickupOutputPath,
    ]);
    for (const { outputPath, prepared, size } of preparedMaps) {
      console.log(`Wrote ${path.relative(projectRoot, outputPath)} (${formatBytes(size)})`);
      console.log(`${prepared.label}: ${prepared.faceCount}/${prepared.sourceFaceCount} faces, ${prepared.textureCount} textures`);
    }
    console.log(`Wrote ${path.relative(projectRoot, hudBaseOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, hudInventoryOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, hudIconsOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, hudNumbersOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, hudDamageNumbersOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, hudOutputPath)}`);
    for (const [, outputPath] of staticPublicAssets) {
      console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
    }
    console.log(`Wrote ${path.relative(projectRoot, mainMenuOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, mainMenuMultiplayerOutputPath)}`);
    for (const outputPath of mainMenuActiveOutputPaths) {
      console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
    }
    console.log(`Wrote ${path.relative(projectRoot, mainMenuCursorOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, aboutOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, menuPanelTextureOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, menuTitleLevelSelectOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, menuTitleOptionsOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, menuTitleHelpOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, concharsOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, weaponOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, progsOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, pickupOutputPath)}`);
    console.log(`Wrote ${path.relative(projectRoot, soundManifestOutputPath)} (${Object.keys(soundManifest.sounds).length} sounds)`);
    console.log(`Wrote ${path.relative(projectRoot, manifestOutputPath)}`);
  }
  }
} finally {
  await renderBundleBuilder?.close?.();
  await rm(tempDir, { recursive: true, force: true });
}

async function createQuakeRenderBundleBuilder({ concurrency, engine }) {
  const workerCount = Number.isFinite(concurrency)
    ? Math.max(1, Math.trunc(concurrency))
    : normalizedQuakeRenderBundleConcurrency();
  const renderBundleEngine = await createQuakeRenderBundleEngine({ concurrency: workerCount, engine });
  console.log(`Using ${workerCount} render bundle worker${workerCount === 1 ? "" : "s"}`);

  async function writeRenderBundleResult({
    name,
    result,
    styleClassName = "",
    sharedAssets,
    writeStyle = true,
    includeLeafFrameStyles = false,
    outlineKind,
    deferAssetWrites = false,
  }) {
    const assetDir = path.join(renderBundleOutputDir, name);
    await rm(assetDir, { recursive: true, force: true });
    await mkdir(assetDir, { recursive: true });

    let meshHtml = result.meshHtml;
    let meshCss = result.meshCss ?? "";
    const leafFrameStylesByClass = (result.leafFrameStyles ?? []).map(([leafClass, frameStyle]) => [
      leafClass,
      Array.isArray(frameStyle) ? [...frameStyle] : [],
    ]);
    const assetUrls = [];
    const deferredAssets = [];
    let writtenAssetCount = 0;
    let reusedAssetCount = 0;

    for (let index = 0; index < result.assets.length; index++) {
      const asset = result.assets[index];
      const buffer = typeof asset.base64 === "string" ? Buffer.from(asset.base64, "base64") : null;
      if (!buffer && !deferAssetWrites) {
        throw new Error(`Render bundle asset ${index} for ${name} is missing its payload.`);
      }
      if (!buffer && sharedAssets) {
        throw new Error(`Shared render bundle asset ${index} for ${name} is missing its payload.`);
      }
      const hash = buffer ? createHash("sha256").update(buffer).digest("hex") : "";
      const assetKey = buffer ? `${asset.mime}:${hash}` : "";
      let sharedAsset = assetKey ? sharedAssets?.get(assetKey) : null;

      if (!sharedAsset) {
        const primaryMime = deferAssetWrites
          ? deferredQuakeRenderBundlePrimaryAssetMime(asset.mime)
          : null;
        const primaryAsset = deferAssetWrites || !buffer
          ? null
          : await encodeQuakeRenderBundlePrimaryAsset(buffer, asset.mime);
        const extension = mimeExtension(primaryMime ?? primaryAsset.mime);
        const filename = `${index}.${extension}`;
        const outputPath = path.join(assetDir, filename);
        const assetUrl = `${quakeRenderBundlePublicPath}/${name}/${filename}`;
        if (deferAssetWrites) {
          deferredAssets.push({
            ...(buffer ? { buffer } : {}),
            mime: asset.mime,
            outputPath,
            skippedPayload: Boolean(asset.skippedPayload || !buffer),
            sourceUrl: assetUrl,
          });
        } else {
          await writeFile(outputPath, primaryAsset.buffer);
        }

        sharedAsset = { sourceUrl: assetUrl, variants: [] };
        if (assetKey) sharedAssets?.set(assetKey, sharedAsset);
        writtenAssetCount++;
      } else {
        reusedAssetCount++;
      }

      meshHtml = meshHtml.split(asset.placeholder).join(sharedAsset.sourceUrl);
      meshCss = meshCss.split(asset.placeholder).join(sharedAsset.sourceUrl);
      replaceQuakeRenderBundleLeafFrameStylePlaceholder(
        leafFrameStylesByClass,
        asset.placeholder,
        sharedAsset.sourceUrl,
      );
      assetUrls.push(sharedAsset.sourceUrl);
    }

    if (
      meshHtml.includes("__QUAKE_RENDER_BUNDLE_ASSET_") ||
      meshCss.includes("__QUAKE_RENDER_BUNDLE_ASSET_") ||
      JSON.stringify(leafFrameStylesByClass).includes("__QUAKE_RENDER_BUNDLE_ASSET_")
    ) {
      throw new Error(`Unresolved render bundle asset placeholder for ${name}.`);
    }

    let styleUrl = "";
    if (meshCss && writeStyle) {
      const cssBuffer = Buffer.from(meshCss);
      const filename = "0.css";
      await writeFile(path.join(assetDir, filename), cssBuffer);
      styleUrl = `${quakeRenderBundlePublicPath}/${name}/${filename}`;
    }

    const renderBundle = {
      version: 1,
      kind: "polycss-mesh",
      polycssVersion: polycssPackage.version,
      textureLighting: "baked",
      textureQuality: 1,
      meshHtml,
      ...(styleUrl ? { styleUrl } : {}),
      ...(styleClassName ? { styleClassName } : {}),
      assetUrls,
      ...(includeLeafFrameStyles && leafFrameStylesByClass.length ? { leafFrameStylesByClass } : {}),
      leafMetadata: result.leafMetadata,
      polygonCount: result.polygonCount,
      leafCount: result.leafCount,
      atlasLeafCount: result.atlasLeafCount,
    };
    if (deferredAssets.length) {
      Object.defineProperty(renderBundle, deferredRenderBundleAssetsSymbol, {
        configurable: true,
        value: deferredAssets,
      });
    }
    if (!deferAssetWrites) {
      await addQuakeRenderBundleDebugOutlineAssets(renderBundle, {
        outlineKind: outlineKind ?? quakeRenderBundleDebugOutlineKindForName(name),
        lightstyle: quakeRenderBundleNameIsLightstyle(name),
        meshCss,
      });
    }

    return {
      renderBundle,
      meshCss,
      writtenAssetCount,
      reusedAssetCount,
      deferredAssetCount: deferredAssets.length,
    };
  }

  return {
    async build({
      bundleName,
      mapName,
      polygons,
      textureQuality = 1,
      extractLeafStyles = false,
      tightenAtlasLeaves = false,
      optimizeAtlasLeafBasis = false,
      optimizeAtlasLeafHomography = false,
      optimizeAtlasTriangleBasis = false,
      outlineKind,
      deferAssetWrites = false,
      layoutOnly = false,
    }) {
      const name = bundleName ?? mapName;
      if (!name) throw new Error("Render bundle build requires a bundleName or mapName.");
      const styleClassName = extractLeafStyles ? quakeRenderBundleStyleClassName(name) : "";
      const adaptiveAtlasLeafSize = quakeRenderBundleAdaptiveAtlasLeafSize && Boolean(mapName);
      const renderInput = {
        polygons,
        textureQuality,
        extractLeafStyles,
        styleClassName,
        tightenAtlasLeaves,
        adaptiveAtlasLeafSize,
        optimizeAtlasLeafBasis,
        optimizeAtlasLeafHomography,
        optimizeAtlasTriangleBasis,
        layoutOnly,
      };
      const result = shouldBuildStaticRenderBundleInline(name, renderInput)
        ? await buildInlineHappyDomRenderBundle(renderInput)
        : await renderBundleEngine.build(renderInput);
      const written = await writeRenderBundleResult({
        name,
        result,
        styleClassName,
        outlineKind,
        deferAssetWrites,
      });
      console.log(
        `Built render bundle for ${name}: ${result.leafCount} leaves, ` +
        `${written.writtenAssetCount} atlas assets` +
        `${written.deferredAssetCount ? " deferred" : ""}` +
        `${renderBundleAtlasLeafBasisLog(result)}` +
        `${renderBundleAtlasLeafHomographyLog(result)}` +
        `${renderBundleAdaptiveAtlasLeafSizeLog(result)}`,
      );
      return written.renderBundle;
    },
    async buildAnimatedFrameSet({
      bundleName,
      frames,
      textureQuality = 1,
      extractLeafStyles = true,
      tightenAtlasLeaves = false,
      optimizeAtlasLeafBasis = false,
      optimizeAtlasLeafHomography = false,
      optimizeAtlasTriangleBasis = false,
      outlineKind,
    }) {
      if (!bundleName) throw new Error("Animated render bundle build requires a bundleName.");
      if (!Array.isArray(frames) || frames.length <= 1) {
        throw new Error(`Animated render bundle build for ${bundleName} requires multiple frames.`);
      }
      const frameInputs = frames.map((frame, index) => {
        const name = frame.bundleName ?? `${bundleName}/f${index}`;
        return {
          name,
          styleClassName: extractLeafStyles ? quakeRenderBundleStyleClassName(name) : "",
          polygons: frame.polygons,
        };
      });
      const result = await renderBundleEngine.buildAnimatedFrameSet({
        frames: frameInputs,
        textureQuality,
        extractLeafStyles,
        tightenAtlasLeaves,
        adaptiveAtlasLeafSize: false,
        fastFrameStyles: quakeRenderBundleFastFrameStyles,
        optimizeAtlasLeafBasis,
        optimizeAtlasLeafHomography,
        optimizeAtlasTriangleBasis,
      });
      const sharedAssets = new Map();
      const frameBundles = [];
      let writtenAssetCount = 0;
      let reusedAssetCount = 0;
      const firstFrameResult = result.frames[0];
      const firstWritten = await writeRenderBundleResult({
        name: firstFrameResult.name,
        result: firstFrameResult,
        styleClassName: firstFrameResult.styleClassName,
        sharedAssets,
        writeStyle: false,
        includeLeafFrameStyles: true,
        outlineKind,
      });
      writtenAssetCount += firstWritten.writtenAssetCount;
      frameBundles.push(firstWritten.renderBundle);
      for (const frameResult of result.frames.slice(1)) {
        reusedAssetCount += firstWritten.renderBundle.assetUrls.length;
        frameBundles.push(createQuakeRenderBundleFrameStyleBundle(
          firstWritten.renderBundle,
          frameResult,
        ));
      }
      const firstFrame = result.frames[0];
      console.log(
        `Built animated render bundle for ${bundleName}: ${result.frames.length} frames, ` +
        `${firstFrame?.leafCount ?? 0} leaves, ${writtenAssetCount} atlas assets ` +
        `${renderBundleAtlasLeafBasisLog(firstFrame)} ` +
        `${renderBundleAtlasLeafHomographyLog(firstFrame)} ` +
        `${renderBundleTriangleAtlasBasisLog(firstFrame)} ` +
        `${renderBundleAdaptiveAtlasLeafSizeLog(firstFrame)} ` +
        `(${reusedAssetCount} frame references reused)`,
      );
      return frameBundles;
    },
    close: () => renderBundleEngine.close(),
  };
}

function shouldBuildStaticRenderBundleInline(name, input) {
  return quakeRenderBundleNameIsLightstyle(name) &&
    !input.layoutOnly &&
    Array.isArray(input.polygons) &&
    input.polygons.length > 0 &&
    input.polygons.every((polygon) => typeof polygon?.texture !== "string");
}

async function buildInlineHappyDomRenderBundle(input) {
  inlineHappyDomRenderBundleModulePromise ??= import("./renderBundleHappyDom.mjs");
  const { buildQuakeRenderBundleHappyDom } = await inlineHappyDomRenderBundleModulePromise;
  return buildQuakeRenderBundleHappyDom(input, {
    contentTypeForTextureUrl: contentTypeForPath,
    readTextureUrl: readHappyDomRenderBundleTextureUrl,
  });
}

async function readHappyDomRenderBundleTextureUrl(url) {
  if (typeof url !== "string" || url.startsWith("data:") || url.startsWith("blob:")) return url;
  const textureBytes = texturePngByPublicPath.get(url);
  if (textureBytes) return textureBytes;
  if (!url.startsWith(`${quakePublicPath}/`)) return url;
  return readGeneratedPublicTextureFile(url);
}

async function createQuakeRenderBundleEngine({ concurrency, engine }) {
  if (engine === "happy-dom") return createHappyDomQuakeRenderBundleEngine({ concurrency });
  throw new Error(`Unsupported render bundle engine ${JSON.stringify(engine)}.`);
}

async function createHappyDomQuakeRenderBundleEngine({ concurrency }) {
  const workerPath = path.join(scriptDir, "renderBundleHappyDomWorker.mjs");
  const workerCount = Number.isFinite(concurrency)
    ? Math.max(1, Math.trunc(concurrency))
    : normalizedQuakeRenderBundleConcurrency();
  const workers = Array.from({ length: workerCount }, () => createHappyDomRenderBundleWorker(workerPath));
  const availableWorkers = [...workers];
  const workerWaiters = [];
  let closed = false;

  return {
    build: (input) => withHappyDomRenderBundleWorker(
      availableWorkers,
      workerWaiters,
      () => closed,
      (worker) => requestHappyDomRenderBundleWorker(worker, "static", input),
    ),
    buildAnimatedFrameSet: (input) => withHappyDomRenderBundleWorker(
      availableWorkers,
      workerWaiters,
      () => closed,
      (worker) => requestHappyDomRenderBundleWorker(worker, "animated", input),
    ),
    async close() {
      closed = true;
      for (const waiter of workerWaiters.splice(0)) {
        waiter.reject(new Error("Happy-dom render bundle engine closed."));
      }
      await Promise.allSettled(workers.map((worker) => worker.thread.terminate()));
    },
  };

  function createHappyDomRenderBundleWorker(filename) {
    const thread = new Worker(pathToFileURL(filename), {
      workerData: {
        generatedPublicDir,
        quakePublicPath,
      },
    });
    const worker = {
      broken: false,
      nextRequestId: 0,
      requests: new Map(),
      thread,
    };
    thread.on("message", (message) => {
      const request = worker.requests.get(message.id);
      if (!request) return;
      worker.requests.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message);
        if (message.error.stack) error.stack = message.error.stack;
        request.reject(error);
      } else {
        request.resolve(message.result);
      }
    });
    thread.on("error", (error) => {
      failHappyDomRenderBundleWorker(worker, error);
    });
    thread.on("exit", (code) => {
      if (!closed && code !== 0) {
        failHappyDomRenderBundleWorker(worker, new Error(`Happy-dom render worker exited with code ${code}.`));
      }
    });
    return worker;
  }
}

async function withHappyDomRenderBundleWorker(availableWorkers, workerWaiters, isClosed, callback) {
  const worker = await acquireHappyDomRenderBundleWorker(availableWorkers, workerWaiters, isClosed);
  try {
    return await callback(worker);
  } finally {
    releaseHappyDomRenderBundleWorker(worker, availableWorkers, workerWaiters);
  }
}

function acquireHappyDomRenderBundleWorker(availableWorkers, workerWaiters, isClosed) {
  if (isClosed()) throw new Error("Happy-dom render bundle engine is closed.");
  while (availableWorkers.length) {
    const worker = availableWorkers.pop();
    if (!worker.broken) return Promise.resolve(worker);
  }
  return new Promise((resolve, reject) => workerWaiters.push({ resolve, reject }));
}

function releaseHappyDomRenderBundleWorker(worker, availableWorkers, workerWaiters) {
  if (worker.broken) return;
  const waiter = workerWaiters.shift();
  if (waiter) {
    waiter.resolve(worker);
  } else {
    availableWorkers.push(worker);
  }
}

function requestHappyDomRenderBundleWorker(worker, mode, input) {
  if (worker.broken) throw new Error("Happy-dom render bundle worker is not available.");
  const id = ++worker.nextRequestId;
  const textures = renderBundleTexturePayload(input);
  return new Promise((resolve, reject) => {
    worker.requests.set(id, { resolve, reject });
    worker.thread.postMessage({ id, input, mode, textures });
  });
}

function failHappyDomRenderBundleWorker(worker, error) {
  worker.broken = true;
  for (const request of worker.requests.values()) {
    request.reject(error);
  }
  worker.requests.clear();
}

function renderBundleTexturePayload(input) {
  const urls = new Set();
  for (const polygon of input?.polygons ?? []) collectRenderBundleTextureUrl(urls, polygon);
  for (const frame of input?.frames ?? []) {
    for (const polygon of frame?.polygons ?? []) collectRenderBundleTextureUrl(urls, polygon);
  }
  const payload = [];
  for (const url of urls) {
    const png = texturePngByPublicPath.get(url);
    if (png) payload.push([url, png]);
  }
  return payload;
}

function collectRenderBundleTextureUrl(urls, polygon) {
  const texture = polygon?.texture;
  if (typeof texture === "string" && texture.startsWith(`${quakePublicPath}/`)) urls.add(texture);
}

function renderBundleAdaptiveAtlasLeafSizeLog(result) {
  const stats = result?.adaptiveAtlasLeafSizeStats;
  if (!stats?.resizedLeaves) return "";
  return `, adaptive ${stats.resizedLeaves}/${stats.totalLeaves} leaves ` +
    `${stats.beforeArea}->${stats.afterArea} local px`;
}

function renderBundleAtlasLeafBasisLog(result) {
  const stats = result?.atlasLeafBasisOptimizationStats;
  if (!stats?.rotatedPolygons) return "";
  return `, basis ${stats.rotatedPolygons}/${stats.candidatePolygons} textured polygons ` +
    `${stats.beforeArea}->${stats.afterArea} local px`;
}

function renderBundleAtlasLeafHomographyLog(result) {
  const stats = result?.atlasLeafHomographyOptimizationStats;
  if (!stats?.optimizedLeaves && !stats?.candidateLeaves) return "";
  return `, homography ${stats.optimizedLeaves}/${stats.candidateLeaves} leaves ` +
    `${stats.beforeArea}->${stats.afterArea} local px`;
}

function renderBundleTriangleAtlasBasisLog(result) {
  const stats = result?.triangleAtlasBasisOptimizationStats;
  if (!stats?.optimizedLeaves) return "";
  return `, triangle-basis ${stats.optimizedLeaves}/${stats.triangleLeaves} leaves ` +
    `${stats.beforeArea}->${stats.afterArea} local px`;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KiB`;
  return `${bytes}B`;
}

function formatInteger(value) {
  const integer = Math.trunc(Number(value) || 0);
  return String(integer).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function addQuakeRenderBundleDebugOutlineAssets(renderBundle, options = {}) {
  if (!renderBundle?.assetUrls?.length || !renderBundle.meshHtml) return;
  const leaves = quakeRenderBundleOutlineLeaves(renderBundle, options);
  if (!leaves.length) return;

  const leavesByAsset = new Map();
  for (const leaf of leaves) {
    const bucket = leavesByAsset.get(leaf.assetIndex);
    if (bucket) {
      bucket.push(leaf);
    } else {
      leavesByAsset.set(leaf.assetIndex, [leaf]);
    }
  }
  if (!leavesByAsset.size) return;

  const debugOutlineAssetUrls = [];
  const debugTransparentOutlineAssetUrls = [];
  for (let index = 0; index < renderBundle.assetUrls.length; index++) {
    const sourceUrl = renderBundle.assetUrls[index];
    const sourcePath = quakePublicUrlOutputPath(sourceUrl);
    const pageLeaves = leavesByAsset.get(index) ?? [];
    if (!sourcePath || pageLeaves.length === 0) {
      debugOutlineAssetUrls[index] = sourceUrl;
      debugTransparentOutlineAssetUrls[index] = sourceUrl;
      continue;
    }

    const image = sharp(sourcePath);
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) continue;

    const extension = path.extname(sourcePath);
    const basename = sourcePath.slice(0, -extension.length);
    const outlinePath = `${basename}-outline${extension}`;
    const outlineRgba = quakeDebugOutlineRgba(width, height, pageLeaves);
    const outlineImage = outlineRgba
      ? sharp(outlineRgba, { raw: { width, height, channels: 4 } })
      : sharp({
          create: {
            width,
            height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
        .composite([{ input: Buffer.from(quakeDebugOutlineSvg(width, height, pageLeaves)), blend: "over" }]);
    await writeQuakeRenderBundleOutlineAsset(outlineImage, outlinePath);

    debugOutlineAssetUrls[index] = quakeOutputPathPublicUrl(outlinePath);
    debugTransparentOutlineAssetUrls[index] = debugOutlineAssetUrls[index];
  }

  if (debugOutlineAssetUrls.some(Boolean) && debugTransparentOutlineAssetUrls.some(Boolean)) {
    renderBundle.debugOutlineAssetUrls = debugOutlineAssetUrls;
    renderBundle.debugTransparentOutlineAssetUrls = debugTransparentOutlineAssetUrls;
  }
}

async function writeQuakeRenderBundleOutlineAsset(image, outputPath) {
  if (path.extname(outputPath).toLowerCase() === ".avif") {
    await image
      .avif({
        quality: normalizedQuakeRenderBundleAvifQuality(),
        effort: normalizedQuakeRenderBundleAvifEffort(),
        chromaSubsampling: "4:4:4",
      })
      .toFile(outputPath);
    return;
  }
  await image.toFile(outputPath);
}

function quakeRenderBundleOutlineLeaves(renderBundle, options) {
  const leaves = [];
  const stylesByClass = quakeRenderBundleCssLeafStyles(options.meshCss);
  let leafIndex = 0;
  for (const match of renderBundle.meshHtml.matchAll(/<(b|i|s|u)\b([^>]*)>/g)) {
    const tagName = match[1];
    const attributes = match[2] ?? "";
    const metadata = renderBundle.leafMetadata?.[leafIndex];
    leafIndex++;
    if (tagName !== "s" || !metadata) continue;
    const style = quakeRenderBundleLeafStyle(attributes, stylesByClass);
    if (!style) continue;
    const leaf = quakeDebugOutlineLeafFromStyle(style, renderBundle, metadata, options);
    if (leaf) leaves.push(leaf);
  }
  return leaves;
}

function quakeRenderBundleLeafStyle(attributes, stylesByClass) {
  const inlineStyle = quakeHtmlAttributeValue(attributes, "style");
  if (inlineStyle) return inlineStyle;
  const classValue = quakeHtmlAttributeValue(attributes, "class");
  if (!classValue) return "";
  return classValue
    .split(/\s+/)
    .map((className) => stylesByClass.get(className) ?? "")
    .filter(Boolean)
    .join(";");
}

function quakeRenderBundleCssLeafStyles(meshCss = "") {
  const styles = new Map();
  for (const match of meshCss.matchAll(/\.r[a-f0-9]+\s+\.([a-z0-9_-]+)\s*\{([^}]*)\}/gi)) {
    const className = match[1];
    const style = match[2]?.trim();
    if (className && style) styles.set(className, style);
  }
  return styles;
}

function quakeDebugOutlineLeafFromStyle(style, renderBundle, metadata, options) {
  const declarations = quakeCssDeclarations(style);
  const background = declarations.get("background") ?? "";
  const assetIndex = quakeDebugOutlineBackgroundAssetIndex(background);
  if (assetIndex === undefined || !renderBundle.assetUrls[assetIndex]) return null;
  const positionAndSize = quakeDebugOutlineBackgroundPositionAndSize(background);
  if (!positionAndSize) return null;
  const atlasSize = quakeCssPx(declarations.get("--polycss-atlas-size")) ?? QUAKE_DEBUG_OUTLINE_DEFAULT_ATLAS_SIZE;
  const localWidth = quakeCssPx(declarations.get("width")) ?? atlasSize;
  const localHeight = quakeCssPx(declarations.get("height")) ?? atlasSize;
  if (localWidth <= 0 || localHeight <= 0) return null;
  return {
    assetIndex,
    color: quakeDebugOutlineColor(metadata, options),
    backgroundPositionX: positionAndSize.positionX,
    backgroundPositionY: positionAndSize.positionY,
    backgroundWidth: positionAndSize.sizeWidth,
    backgroundHeight: positionAndSize.sizeHeight,
    localWidth,
    localHeight,
  };
}

function quakeDebugOutlineBackgroundAssetIndex(background) {
  const match = background.match(/var\(--bg(\d+)\)/);
  if (!match) return undefined;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function quakeDebugOutlineBackgroundPositionAndSize(background) {
  const match = background.match(/var\(--bg\d+\)\s+(-?\d*\.?\d+)px\s+(-?\d*\.?\d+)px\s*\/\s*(-?\d*\.?\d+)px\s+(-?\d*\.?\d+)px/);
  if (!match) return null;
  const values = match.slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [positionX, positionY, sizeWidth, sizeHeight] = values;
  if (sizeWidth <= 0 || sizeHeight <= 0) return null;
  return { positionX, positionY, sizeWidth, sizeHeight };
}

function quakeDebugOutlineColor(metadata, options) {
  const kind = options.outlineKind ?? (options.lightstyle ? "lightstyle" : quakeDebugOutlineKind(metadata));
  return QUAKE_DEBUG_OUTLINE_COLORS[kind] ?? QUAKE_DEBUG_OUTLINE_COLORS.world;
}

function quakeDebugOutlineKind(metadata) {
  const textureName = String(metadata.t ?? "").toLowerCase();
  if (textureName.startsWith("sky")) return "sky";
  if (textureName.startsWith("*")) return "special";
  if (textureName.startsWith("+")) return "animated";
  if (metadata.m !== undefined && metadata.m !== 0) return "brush";
  if (metadata.e !== undefined && metadata.e > 0) return "entity";
  if (metadata.l !== undefined) return "lit";
  return "world";
}

function quakeDebugOutlineSvg(width, height, leaves) {
  const rects = [];
  for (const leaf of leaves) {
    const color = escapeXml(leaf.color);
    for (const rect of quakeDebugOutlineLeafRects(width, height, leaf)) {
      rects.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${color}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${rects.join("")}</svg>`;
}

function quakeDebugOutlineRgba(width, height, leaves) {
  const entries = [];
  for (const leaf of leaves) {
    const rects = quakeDebugOutlineLeafRects(width, height, leaf);
    if (!rects.every(quakeDebugOutlineRectIsPixelAligned)) return null;
    entries.push({ color: leaf.color, rects });
  }

  const rgba = Buffer.alloc(width * height * 4);
  const colorCache = new Map();
  for (const entry of entries) {
    const color = quakeDebugOutlineColorRgba(entry.color, colorCache);
    for (const rect of entry.rects) {
      paintQuakeDebugOutlineRect(rgba, width, height, rect, color);
    }
  }
  return rgba;
}

function quakeDebugOutlineLeafRects(width, height, leaf) {
  const scaleX = width / leaf.backgroundWidth;
  const scaleY = height / leaf.backgroundHeight;
  const x = clampNumber((-leaf.backgroundPositionX / leaf.backgroundWidth) * width, 0, width);
  const y = clampNumber((-leaf.backgroundPositionY / leaf.backgroundHeight) * height, 0, height);
  const w = clampNumber((leaf.localWidth / leaf.backgroundWidth) * width, 0, width - x);
  const h = clampNumber((leaf.localHeight / leaf.backgroundHeight) * height, 0, height - y);
  const tx = Math.max(1, QUAKE_DEBUG_OUTLINE_WIDTH * scaleX);
  const ty = Math.max(1, QUAKE_DEBUG_OUTLINE_WIDTH * scaleY);
  if (w <= 0 || h <= 0) return [];
  return [
    { x: roundSvg(x), y: roundSvg(y), width: roundSvg(w), height: roundSvg(Math.min(ty, h)) },
    { x: roundSvg(x), y: roundSvg(y + Math.max(0, h - ty)), width: roundSvg(w), height: roundSvg(Math.min(ty, h)) },
    { x: roundSvg(x), y: roundSvg(y), width: roundSvg(Math.min(tx, w)), height: roundSvg(h) },
    { x: roundSvg(x + Math.max(0, w - tx)), y: roundSvg(y), width: roundSvg(Math.min(tx, w)), height: roundSvg(h) },
  ];
}

function quakeDebugOutlineRectIsPixelAligned(rect) {
  return numberIsPixelAligned(rect.x) &&
    numberIsPixelAligned(rect.y) &&
    numberIsPixelAligned(rect.x + rect.width) &&
    numberIsPixelAligned(rect.y + rect.height);
}

function numberIsPixelAligned(value) {
  return Math.abs(value - Math.round(value)) <= 1e-6;
}

function quakeDebugOutlineColorRgba(color, cache) {
  const cached = cache.get(color);
  if (cached) return cached;
  const match = String(color).match(/^#([0-9a-f]{6})$/i);
  const rgba = match
    ? [
        Number.parseInt(match[1].slice(0, 2), 16),
        Number.parseInt(match[1].slice(2, 4), 16),
        Number.parseInt(match[1].slice(4, 6), 16),
        255,
      ]
    : [0, 0, 0, 255];
  cache.set(color, rgba);
  return rgba;
}

function paintQuakeDebugOutlineRect(rgba, width, height, rect, color) {
  const x0 = clampInteger(Math.round(rect.x), 0, width);
  const y0 = clampInteger(Math.round(rect.y), 0, height);
  const x1 = clampInteger(Math.round(rect.x + rect.width), 0, width);
  const y1 = clampInteger(Math.round(rect.y + rect.height), 0, height);
  if (x1 <= x0 || y1 <= y0) return;

  const row = Buffer.alloc((x1 - x0) * 4);
  for (let offset = 0; offset < row.length; offset += 4) {
    row[offset] = color[0];
    row[offset + 1] = color[1];
    row[offset + 2] = color[2];
    row[offset + 3] = color[3];
  }
  for (let y = y0; y < y1; y++) {
    row.copy(rgba, (y * width + x0) * 4);
  }
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function quakeRenderBundleNameIsLightstyle(name) {
  return quakeMapNames.some((mapName) => name === `${mapName}l`);
}

function quakeRenderBundleDebugOutlineKindForName(name) {
  return name === "w" ? "viewmodel" : undefined;
}

function quakePublicUrlOutputPath(url) {
  if (!url?.startsWith("/")) return null;
  return path.join(generatedPublicDir, url.slice(1));
}

function quakeOutputPathPublicUrl(outputPath) {
  return `/${path.relative(generatedPublicDir, outputPath).split(path.sep).join("/")}`;
}

function quakeHtmlAttributeValue(attributes, name) {
  const match = attributes.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeHtmlAttribute(match[1]) : "";
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function quakeCssDeclarations(style) {
  const declarations = new Map();
  for (const part of style.split(";")) {
    const separator = part.indexOf(":");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value) declarations.set(name, value);
  }
  return declarations;
}

function quakeCssPx(value) {
  const match = String(value ?? "").trim().match(/^(-?\d*\.?\d+)px$/);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : undefined;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundSvg(value) {
  return Number(value.toFixed(4));
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[char]);
}

function quakeRenderBundleStyleClassName(name) {
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `r${hash}`;
}

function replaceQuakeRenderBundleLeafFrameStylePlaceholder(leafFrameStylesByClass, placeholder, replacement) {
  for (const [, frameStyle] of leafFrameStylesByClass) {
    for (let index = 0; index < frameStyle.length; index++) {
      if (typeof frameStyle[index] === "string") {
        frameStyle[index] = frameStyle[index].split(placeholder).join(replacement);
      }
    }
  }
}

function createQuakeRenderBundleFrameStyleBundle(baseRenderBundle, frameResult) {
  return {
    ...baseRenderBundle,
    ...(frameResult.styleClassName ? { styleClassName: frameResult.styleClassName } : {}),
    assetUrls: [...baseRenderBundle.assetUrls],
    leafMetadata: baseRenderBundle.leafMetadata.map((leaf) => ({ ...leaf })),
    leafFrameStylesByClass: (frameResult.leafFrameStyles ?? []).map(([leafClass, frameStyle]) => [
      leafClass,
      Array.isArray(frameStyle) ? [...frameStyle] : [],
    ]),
    polygonCount: frameResult.polygonCount,
    leafCount: frameResult.leafCount,
    atlasLeafCount: frameResult.atlasLeafCount,
  };
}

function assertNoDeferredQuakeRenderBundleAssetReferences(renderBundle, deterministicAtlasStats) {
  const deferredAssets = renderBundle?.[deferredRenderBundleAssetsSymbol];
  if (!Array.isArray(deferredAssets) || deferredAssets.length === 0) return 0;
  const referencedUrls = new Set(renderBundle.assetUrls ?? []);
  const referencedDeferredAssets = deferredAssets.filter((asset) => referencedUrls.has(asset.sourceUrl));
  deferredAssets.length = 0;
  if (referencedDeferredAssets.length) {
    const skipped = deterministicAtlasStats?.skippedLeaves ?? "?";
    const skippedKinds = JSON.stringify(deterministicAtlasStats?.skipped ?? {});
    throw new Error(
      `Deterministic atlas left ${referencedDeferredAssets.length} old render bundle atlas asset` +
      `${referencedDeferredAssets.length === 1 ? "" : "s"} referenced ` +
      `(${skipped} skipped leaves, skipped=${skippedKinds}). ` +
      `The old atlas fallback is disabled; fix deterministic replacement instead.`,
    );
  }
  return 0;
}

function deferredQuakeRenderBundlePrimaryAssetMime(mime) {
  if (mime === "image/avif") return mime;
  if (mime?.startsWith("image/")) return "image/avif";
  return mime;
}

async function encodeQuakeRenderBundlePrimaryAsset(buffer, mime) {
  if (mime === "image/avif") {
    return {
      buffer,
      mime,
    };
  }
  if (mime?.startsWith("image/")) {
    return {
      buffer: await sharp(buffer)
        .avif({
          quality: normalizedQuakeRenderBundleAvifQuality(),
          effort: normalizedQuakeRenderBundleAvifEffort(),
          chromaSubsampling: "4:4:4",
        })
        .toBuffer(),
      mime: "image/avif",
    };
  }
  return {
    buffer,
    mime,
  };
}

function mimeExtension(mime) {
  if (mime === "image/avif") return "avif";
  if (mime === "image/jpeg") return "jpg";
  return "png";
}

function contentTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".avif") return "image/avif";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function runConcurrently(items, concurrency, worker) {
  await mapConcurrently(items, concurrency, async (item, index) => {
    await worker(item, index);
    return undefined;
  });
}

async function mapConcurrently(items, concurrency, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

async function runPrepareStep(_label, callback) {
  return await callback();
}

function normalizedQuakeRenderBundleConcurrency(value = quakeRenderBundleConcurrency) {
  const maxParallelism = Math.max(1, availableParallelism());
  if (Number.isFinite(value)) {
    return Math.max(1, Math.min(maxParallelism, Math.trunc(value)));
  }
  return Math.min(3, maxParallelism);
}

function normalizedQuakeRenderBundleModelConcurrency() {
  const maxParallelism = Math.max(1, availableParallelism());
  if (Number.isFinite(quakeRenderBundleModelConcurrency)) {
    return normalizedQuakeRenderBundleConcurrency(quakeRenderBundleModelConcurrency);
  }
  if (Number.isFinite(quakeRenderBundleConcurrency)) {
    return normalizedQuakeRenderBundleConcurrency(quakeRenderBundleConcurrency);
  }
  if (maxParallelism >= 12) return Math.min(6, maxParallelism);
  if (maxParallelism >= 8) return 4;
  return normalizedQuakeRenderBundleConcurrency();
}

function normalizedQuakeRenderBundleAvifQuality() {
  return Number.isFinite(quakeRenderBundleAvifQuality)
    ? Math.max(1, Math.min(100, quakeRenderBundleAvifQuality))
    : 80;
}

function normalizedQuakeRenderBundleAvifEffort() {
  return Number.isFinite(quakeRenderBundleAvifEffort)
    ? Math.max(0, Math.min(9, quakeRenderBundleAvifEffort))
    : 4;
}

function mapNameFromPakPath(mapPath) {
  return path.basename(mapPath, path.extname(mapPath)).toLowerCase();
}

async function exportQuakeSounds(pak, parsePakDirectory) {
  const sounds = {};
  const entries = parsePakDirectory(pak)
    .filter(isQuakeSoundEntry)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const key = quakeSoundManifestKey(entry.name);
    const outputPath = path.join(soundOutputDir, ...key.split("/"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, pak.subarray(entry.offset, entry.offset + entry.size));
    sounds[key] = generatedPublicUrl(outputPath);
  }

  return {
    version: 1,
    sounds,
  };
}

function isQuakeSoundEntry(entry) {
  return /^sound\/[^.].*\.wav$/i.test(entry.name) &&
    !entry.name.split("/").some((part) => part === ".." || part === "");
}

function quakeSoundManifestKey(pakPath) {
  return pakPath.replace(/^sound\//i, "").toLowerCase();
}

async function loadQuakeSourceProgramFacts() {
  try {
    const text = await readFile(sourceProgramFactsInputPath, "utf8");
    const facts = JSON.parse(text);
    if (!facts || typeof facts !== "object" || !facts.entities || typeof facts.entities !== "object") {
      throw new Error("Invalid Quake source program facts JSON.");
    }
    return facts;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function buildQuakeAssetManifest(preparedMaps, programMetadata, pickupModels, soundManifest) {
  const preparedModelPaths = new Set(Object.keys(pickupModels?.models ?? {}));
  const preparedSoundPaths = new Set(Object.keys(soundManifest?.sounds ?? {}));
  const maps = preparedMaps.map(({ mapName, mapPath, outputPath, prepared }) => {
    const hasGameLogicFacts = Boolean(prepared?.gameLogic);
    const gameLogicModelPaths = quakeGameLogicMapModelPaths(prepared, preparedModelPaths);
    const gameLogicSoundPaths = quakeGameLogicMapSoundPaths(prepared, preparedSoundPaths);
    const modelPaths = hasGameLogicFacts
      ? gameLogicModelPaths
      : quakeMapModelPaths(outputPath, preparedMaps, programMetadata)
        .filter((modelPath) => preparedModelPaths.has(modelPath));
    return {
      mapName,
      title: quakeMapTitles.get(mapName) ?? mapName.toUpperCase(),
      pakPath: mapPath,
      sceneUrl: generatedPublicUrl(outputPath),
      selectable: quakeSelectableMapNames.has(mapName),
      modelPaths,
      ...(gameLogicSoundPaths.length ? { soundPaths: gameLogicSoundPaths } : {}),
    };
  });
  const mapNames = new Set(maps.map((map) => map.mapName));
  return {
    version: 1,
    assetRoot: quakePublicPath,
    startMap: mapNames.has(quakeStartMap) ? quakeStartMap : maps[0]?.mapName ?? quakeStartMap,
    maps,
    assets: {
      weaponModelUrl: generatedPublicUrl(weaponOutputPath),
      pickupModelsUrl: generatedPublicUrl(pickupOutputPath),
      programMetadataUrl: generatedPublicUrl(progsOutputPath),
      soundManifestUrl: generatedPublicUrl(soundManifestOutputPath),
    },
  };
}

async function mergeQuakePickupModelOutput(pickupModels) {
  let existing = { models: {} };
  try {
    existing = JSON.parse(await readFile(pickupOutputPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    ...existing,
    models: {
      ...(existing.models ?? {}),
      ...(pickupModels.models ?? {}),
    },
  };
}

function quakeGameLogicMapModelPaths(prepared, preparedModelPaths) {
  if (!prepared?.gameLogic) return [];
  return deriveQuakeGameLogicModelPreloads(prepared.gameLogic, {
    preparedModelPaths,
  }).modelPaths;
}

function quakeGameLogicMapSoundPaths(prepared, preparedSoundPaths) {
  if (!prepared?.gameLogic || preparedSoundPaths.size === 0) return [];
  return deriveQuakeGameLogicSoundPreloads(prepared.gameLogic, {
    preparedSoundPaths,
  }).soundPaths;
}

function quakeReferencedModelPathsForPreparedMaps(preparedMaps, programMetadata, candidateModelPaths) {
  const candidateByPath = new Map(
    [...candidateModelPaths].map((modelPath) => [modelPath.toLowerCase(), modelPath]),
  );
  const preparedModelPaths = new Set(candidateByPath.keys());
  const referencedModelPaths = new Set();
  for (const { outputPath, prepared } of preparedMaps) {
    const mapModelPaths = new Set(quakeMapModelPaths(outputPath, preparedMaps, programMetadata));
    if (prepared?.gameLogic) {
      for (const modelPath of quakeGameLogicMapModelPaths(prepared, preparedModelPaths)) {
        mapModelPaths.add(modelPath);
      }
    }
    for (const modelPath of mapModelPaths) {
      const candidate = candidateByPath.get(modelPath.toLowerCase());
      if (candidate) referencedModelPaths.add(candidate);
    }
  }
  return referencedModelPaths;
}

async function writeQuakeAssetRegenerationManifest({ mode = "full", mapNames = [] } = {}) {
  await mkdir(quakeOutputDir, { recursive: true });
  await writeFileAtomic(manifestOutputPath, JSON.stringify({
    version: 1,
    status: "regenerating",
    mode,
    ...(mapNames.length ? { maps: mapNames } : {}),
    assetRoot: quakePublicPath,
    message: mode === "map-only"
      ? `Quake map assets are regenerating (${mapNames.join(", ")}). Wait for pnpm prepare:quake to finish, then reload.`
      : "Quake assets are regenerating. Wait for pnpm prepare:quake to finish, then reload.",
    startedAt: new Date().toISOString(),
  }));
}

async function writeFileAtomic(outputPath, contents) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(tempPath, contents);
  await rename(tempPath, outputPath);
}

function quakeMapModelPaths(outputPath, preparedMaps, programMetadata) {
  const prepared = preparedMaps.find((item) => item.outputPath === outputPath)?.prepared;
  const modelPaths = new Set();
  for (const entity of prepared?.entities ?? []) {
    for (const modelPath of quakeEntityModelPaths(entity, programMetadata)) {
      modelPaths.add(modelPath);
    }
  }
  return [...modelPaths].sort();
}

function quakeEntityModelPaths(entity, programMetadata) {
  const paths = [];
  if (isQuakePickupClassname(entity.classname)) {
    const modelPath = quakePickupEntityModelPath(entity, programMetadata);
    const fallbackModelPath = QUAKE_PICKUP_MODEL_PATHS[entity.classname];
    if (modelPath) paths.push(modelPath);
    if (fallbackModelPath && fallbackModelPath !== modelPath) paths.push(fallbackModelPath);
  }
  if (entity.classname === "misc_explobox") paths.push("maps/b_explob.bsp");
  if (entity.classname === "misc_explobox2") paths.push("maps/b_exbox2.bsp");
  if (entity.classname.startsWith("monster_")) {
    const bodyModelPath = quakeMonsterEntityModelPath(entity, programMetadata);
    const projectileModelPath = QUAKE_MONSTER_PROJECTILE_MODEL_PATHS[entity.classname];
    if (bodyModelPath) paths.push(bodyModelPath);
    if (projectileModelPath) paths.push(projectileModelPath);
  }
  return paths.filter(isPreparedModelPath);
}

function isPreparedModelPath(modelPath) {
  return /^(maps|progs)\/.+\.(bsp|mdl)$/i.test(modelPath);
}

function isQuakePickupClassname(classname) {
  return classname.startsWith("item_") ||
    classname.startsWith("weapon_") ||
    classname.startsWith("ammo_") ||
    classname.startsWith("key_");
}

function quakePickupEntityModelPath(entity, programMetadata) {
  const programModels = quakeProgramModelPathsForEntity(entity, programMetadata);
  const spawnflags = quakeEntitySpawnflags(entity);
  const large = Boolean(spawnflags & 1);
  if (entity.classname === "item_health") {
    if (spawnflags & 2) return quakeProgramModelPathMatching(programModels, "maps/b_bh100.bsp") ?? "maps/b_bh100.bsp";
    return spawnflags & 1
      ? quakeProgramModelPathMatching(programModels, "maps/b_bh10.bsp") ?? "maps/b_bh10.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_bh25.bsp") ?? "maps/b_bh25.bsp";
  }
  if (entity.classname === "item_shells" || entity.classname === "ammo_shells") {
    return large
      ? quakeProgramModelPathMatching(programModels, "maps/b_shell1.bsp") ?? "maps/b_shell1.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_shell0.bsp") ?? "maps/b_shell0.bsp";
  }
  if (entity.classname === "item_spikes" || entity.classname === "ammo_nails") {
    return large
      ? quakeProgramModelPathMatching(programModels, "maps/b_nail1.bsp") ?? "maps/b_nail1.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_nail0.bsp") ?? "maps/b_nail0.bsp";
  }
  if (entity.classname === "item_rockets" || entity.classname === "ammo_rockets") {
    return large
      ? quakeProgramModelPathMatching(programModels, "maps/b_rock1.bsp") ?? "maps/b_rock1.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_rock0.bsp") ?? "maps/b_rock0.bsp";
  }
  if (entity.classname === "item_cells" || entity.classname === "ammo_cells") {
    return large
      ? quakeProgramModelPathMatching(programModels, "maps/b_batt1.bsp") ?? "maps/b_batt1.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_batt0.bsp") ?? "maps/b_batt0.bsp";
  }
  return quakePreferredProgramPickupModelPath(programModels) ?? QUAKE_PICKUP_MODEL_PATHS[entity.classname];
}

function quakeMonsterEntityModelPath(entity, programMetadata) {
  const programModels = programMetadata?.modelsByClassname?.[entity.classname] ?? [];
  const expected = QUAKE_MONSTER_MODEL_PATHS[entity.classname];
  if (expected && (programModels.length === 0 || programModels.includes(expected))) return expected;
  return programModels.find(isQuakeMonsterBodyModel) ??
    programModels.find((model) => model.startsWith("progs/") && model.endsWith(".mdl")) ??
    expected ??
    null;
}

function quakeProgramModelPathsForEntity(entity, programMetadata) {
  if (!programMetadata) return [];
  return programMetadata.modelsByClassname?.[entity.classname] ??
    programMetadata.modelsByClassname?.[quakeProgramClassnameAlias(entity.classname)] ??
    [];
}

function quakeProgramClassnameAlias(classname) {
  if (classname === "ammo_shells") return "item_shells";
  if (classname === "ammo_nails") return "item_spikes";
  if (classname === "ammo_rockets") return "item_rockets";
  if (classname === "ammo_cells") return "item_cells";
  if (classname === "key_silver") return "item_key1";
  if (classname === "key_gold") return "item_key2";
  return classname;
}

function quakeProgramModelPathMatching(models, expected) {
  const normalized = expected.toLowerCase();
  return models.find((model) => model.toLowerCase() === normalized);
}

function quakePreferredProgramPickupModelPath(models) {
  return models.find((model) => model.startsWith("progs/") && model.endsWith(".mdl")) ??
    models.find((model) => model.startsWith("maps/") && model.endsWith(".bsp"));
}

function quakeEntitySpawnflags(entity) {
  const value = Number(entity.properties?.spawnflags ?? 0);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function generatedPublicUrl(outputPath) {
  return `/${path.relative(generatedPublicDir, outputPath).split(path.sep).join("/")}`;
}

function stripPreparedRenderBundleFallbackTextures(prepared) {
  const skyTexture = typeof prepared.skyTexture === "number"
    ? prepared.textures?.[prepared.skyTexture]
    : prepared.skyTexture;
  prepared.textures = [];
  if (skyTexture) {
    prepared.skyTexture = skyTexture;
  } else {
    delete prepared.skyTexture;
  }
  const polygons = prepared.polygons.map((polygon) => {
    const {
      texture: _texture,
      textureWrap: _textureWrap,
      textureAlphaMode: _textureAlphaMode,
      uvs: _uvs,
      textureTriangles: _textureTriangles,
      data,
      ...rest
    } = polygon;
    const strippedData = stripPreparedRenderBundleFallbackData(data);
    return {
      ...rest,
      ...(strippedData ? { data: strippedData } : {}),
    };
  });
  if (prepared.collision && prepared.renderBundle) {
    delete prepared.polygons;
    if (prepared.collision.models) delete prepared.models;
    return;
  }
  prepared.polygons = polygons;
}

function stripPreparedRenderBundleFallbackData(data) {
  if (!data) return undefined;
  const out = {};
  for (const key of [
    "f",
    "m",
    "e",
    "ls-anim",
    "ls-pattern",
  ]) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return Object.keys(out).length ? out : undefined;
}

async function copyStaticPublicAssets() {
  for (const [sourcePath, outputPath] of staticPublicAssets) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await copyFile(sourcePath, outputPath);
  }
}

async function removeLegacyQuakeJsonFiles() {
  await Promise.all([
    ...quakeMapNames.map((mapName) => rm(path.join(quakeOutputDir, `${mapName}.preparsed.json`), { force: true })),
    rm(path.join(quakeOutputDir, "weapon-shotgun.preparsed.json"), { force: true }),
    rm(path.join(quakeOutputDir, "pickups.preparsed.json"), { force: true }),
    rm(path.join(quakeOutputDir, "progs.preparsed.json"), { force: true }),
  ]);
}

async function removeGeneratedQuakeAssetVersionDirs() {
  let entries;
  try {
    entries = await readdir(quakeOutputDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => rm(path.join(quakeOutputDir, entry.name), { recursive: true, force: true })));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function pruneUnreferencedTextureFiles(jsonPaths, options = {}) {
  const removeUnreferenced = options.removeUnreferenced !== false;
  const referenced = new Set();
  const textureUrlPattern = new RegExp(`${escapeRegExp(quakeTexturePublicPath)}/([^"'\\\\)\\s]+)`, "g");
  for (const jsonPath of jsonPaths) {
    const text = await readFile(jsonPath, "utf8");
    for (const match of text.matchAll(textureUrlPattern)) {
      if (match[1]) referenced.add(match[1]);
    }
  }

  let written = 0;
  await mkdir(textureOutputDir, { recursive: true });
  for (const file of referenced) {
    const urlPath = `${quakeTexturePublicPath}/${file}`;
    const png = texturePngByPublicPath.get(urlPath);
    if (!png) continue;
    await writeTextureFileIfMissing(path.join(textureOutputDir, file), png);
    written++;
  }

  let removed = 0;
  if (removeUnreferenced) {
    let files;
    try {
      files = await readdir(textureOutputDir);
    } catch {
      files = [];
    }
    for (const file of files) {
      if (referenced.has(file)) continue;
      await rm(path.join(textureOutputDir, file), { force: true });
      removed++;
    }
  }
  if (written > 0) {
    console.log(`Wrote ${written} referenced generated texture files`);
  }
  if (removed > 0) {
    console.log(`Removed ${removed} unreferenced generated texture files`);
  }
}

async function verifyQuakeResource() {
  const resource = await readFile(resourcePath);
  const actualSize = resource.byteLength;
  const actualHash = createHash("sha256").update(resource).digest("hex");
  if (actualSize !== EXPECTED_RESOURCE_SIZE) {
    throw new Error(`Unexpected resource.1 size: expected ${EXPECTED_RESOURCE_SIZE}, got ${actualSize}.`);
  }
  if (actualHash !== EXPECTED_RESOURCE_SHA256) {
    throw new Error(`Unexpected resource.1 SHA-256: expected ${EXPECTED_RESOURCE_SHA256}, got ${actualHash}.`);
  }
  console.log(`Verified Quake 1.06 shareware resource.1 (${actualHash})`);
}

async function extractQuakePak() {
  if (path7z !== "7z") await chmod(path7z, 0o755).catch(() => undefined);
  await run(path7z, [
    "x",
    "-y",
    `-o${tempDir}`,
    resourcePath,
    "ID1/PAK0.PAK",
  ]);
}

async function copyQuakePakFromPath(source) {
  const sourcePath = source.startsWith("file:") ? fileURLToPath(source) : path.resolve(projectRoot, source);
  const pak = await readFile(sourcePath);
  if (readFixedString(pak, 0, 4) !== "PACK") {
    throw new Error(`QUAKE_PAK_PATH does not point to a Quake PAK file: ${source}`);
  }
  await mkdir(path.dirname(extractedPakPath), { recursive: true });
  await writeFile(extractedPakPath, pak);
  console.log(`Using Quake PAK from ${sourcePath}`);
}

async function downloadQuakeResource() {
  const source = process.env.QUAKE_SHAREWARE_URL?.trim();
  if (!source) {
    throw new Error(
      "QUAKE_SHAREWARE_URL is required. Set it to a Quake 1.06 shareware zip URL before running prepare:quake.",
    );
  }

  await downloadSharewareSource(source, sharewareDownloadPath);
  if (await copyIfExpectedQuakeResource(sharewareDownloadPath)) {
    console.log(`Downloaded Quake shareware resource from ${source}`);
    return;
  }

  await mkdir(sharewareExtractDir, { recursive: true });
  if (path7z !== "7z") await chmod(path7z, 0o755).catch(() => undefined);
  await run(path7z, [
    "x",
    "-y",
    `-o${sharewareExtractDir}`,
    sharewareDownloadPath,
  ]);

  const extractedResourcePath = await findFileCaseInsensitive(sharewareExtractDir, "resource.1");
  if (!extractedResourcePath) {
    throw new Error(`Downloaded Quake shareware archive from ${source} did not contain resource.1.`);
  }
  await writeFile(resourcePath, await readFile(extractedResourcePath));
  console.log(`Downloaded Quake shareware archive from ${source}`);
}

async function downloadSharewareSource(source, outputPath) {
  if (source.startsWith("file:")) {
    await writeFile(outputPath, await readFile(fileURLToPath(source)));
    return;
  }
  if (!/^https?:\/\//i.test(source)) {
    await writeFile(outputPath, await readFile(path.resolve(projectRoot, source)));
    return;
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Could not download ${source}: HTTP ${response.status} ${response.statusText}`);
  }
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function copyIfExpectedQuakeResource(inputPath) {
  const resource = await readFile(inputPath);
  if (resource.byteLength !== EXPECTED_RESOURCE_SIZE) return false;
  const hash = createHash("sha256").update(resource).digest("hex");
  if (hash !== EXPECTED_RESOURCE_SHA256) return false;
  await writeFile(resourcePath, resource);
  return true;
}

async function findFileCaseInsensitive(dir, filename) {
  const wanted = filename.toLowerCase();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findFileCaseInsensitive(entryPath, filename);
      if (found) return found;
    } else if (entry.isFile() && entry.name.toLowerCase() === wanted) {
      return entryPath;
    }
  }
  return undefined;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}.`));
      }
    });
  });
}

async function buildQuakeHudNumbersPng(assets, options = {}) {
  const width = 24 * 10;
  const height = 24;
  const rgba = Buffer.alloc(width * height * 4);
  for (let digit = 0; digit <= 9; digit++) {
    drawWadQpicTo(rgba, assets, `num_${digit}`, digit * 24, 0, width, height, QUAKE_HUD_TRANSPARENT);
  }
  if (options.damageTint) tintQuakeHudDamageNumbers(rgba);
  return sharp(rgba, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
}

function tintQuakeHudDamageNumbers(rgba) {
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index + 3] === 0) continue;
    const light = Math.max(rgba[index], rgba[index + 1], rgba[index + 2]);
    rgba[index] = Math.min(255, Math.round(light * 1.15));
    rgba[index + 1] = Math.round(light * 0.16);
    rgba[index + 2] = Math.round(light * 0.08);
  }
}

async function buildQuakeHudBasePng(assets) {
  const rgba = Buffer.alloc(QUAKE_HUD_WIDTH * QUAKE_HUD_HEIGHT * 4);
  drawQpic(rgba, assets, "sbar", 0, 0);
  return sharp(rgba, {
    raw: { width: QUAKE_HUD_WIDTH, height: QUAKE_HUD_HEIGHT, channels: 4 },
  }).png().toBuffer();
}

async function buildQuakeHudInventoryPng(assets) {
  const rgba = Buffer.alloc(QUAKE_HUD_WIDTH * QUAKE_HUD_HEIGHT * 4);
  drawQpic(rgba, assets, "ibar", 0, 0);
  return sharp(rgba, {
    raw: { width: QUAKE_HUD_WIDTH, height: QUAKE_HUD_HEIGHT, channels: 4 },
  }).png().toBuffer();
}

async function buildQuakeHudIconsPng(assets) {
  const width = QUAKE_HUD_ICON_QPICS.length * QUAKE_HUD_ICON_SLOT_SIZE;
  const rgba = Buffer.alloc(width * QUAKE_HUD_HEIGHT * 4);
  for (let index = 0; index < QUAKE_HUD_ICON_QPICS.length; index++) {
    drawWadQpicTo(
      rgba,
      assets,
      QUAKE_HUD_ICON_QPICS[index],
      index * QUAKE_HUD_ICON_SLOT_SIZE,
      0,
      width,
      QUAKE_HUD_HEIGHT,
      QUAKE_HUD_TRANSPARENT,
    );
  }
  return sharp(rgba, {
    raw: { width, height: QUAKE_HUD_HEIGHT, channels: 4 },
  }).png().toBuffer();
}

async function buildQuakeHudPng(assets) {
  const rgba = Buffer.alloc(QUAKE_HUD_WIDTH * QUAKE_HUD_HEIGHT * 4);

  drawQpic(rgba, assets, "sbar", 0, 0);
  drawNumber(rgba, assets, 24, 0, 0, 3);
  drawQpic(rgba, assets, "face1", 112, 0, QUAKE_HUD_TRANSPARENT);
  drawNumber(rgba, assets, 136, 0, 100, 3);
  drawQpic(rgba, assets, "sb_shells", 224, 0, QUAKE_HUD_TRANSPARENT);
  drawNumber(rgba, assets, 248, 0, 25, 3);

  return sharp(rgba, {
    raw: { width: QUAKE_HUD_WIDTH, height: QUAKE_HUD_HEIGHT, channels: 4 },
  }).png().toBuffer();
}

async function buildQuakeMainMenuPng(assets) {
  const rgba = Buffer.alloc(QUAKE_MENU_WIDTH * QUAKE_MENU_HEIGHT * 4);

  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 0, 240, QUAKE_MAIN_MENU_ROW_HEIGHT, QUAKE_MAIN_MENU_ITEM_X, QUAKE_MAIN_MENU_ROW_TOPS[0], QUAKE_MENU_WIDTH, QUAKE_MENU_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawMainMenuLevelSelectLabel(rgba, assets, QUAKE_MAIN_MENU_ITEM_X, QUAKE_MAIN_MENU_ROW_TOPS[1], QUAKE_MENU_WIDTH, QUAKE_MENU_HEIGHT);
  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 40, 124, QUAKE_MAIN_MENU_ROW_HEIGHT, QUAKE_MAIN_MENU_ITEM_X, QUAKE_MAIN_MENU_ROW_TOPS[2], QUAKE_MENU_WIDTH, QUAKE_MENU_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 1, 60, 75, QUAKE_MAIN_MENU_ROW_HEIGHT, QUAKE_MAIN_MENU_ITEM_X, QUAKE_MAIN_MENU_ROW_TOPS[3], QUAKE_MENU_WIDTH, QUAKE_MENU_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 84, 70, QUAKE_MAIN_MENU_ROW_HEIGHT, QUAKE_MAIN_MENU_ITEM_X, QUAKE_MAIN_MENU_ROW_TOPS[4], QUAKE_MENU_WIDTH, QUAKE_MENU_HEIGHT, QUAKE_HUD_TRANSPARENT);

  return sharp(rgba, {
    raw: { width: QUAKE_MENU_WIDTH, height: QUAKE_MENU_HEIGHT, channels: 4 },
  }).png().toBuffer();
}

async function buildQuakeMainMenuCursorPng(assets) {
  const width = QUAKE_MENU_CURSOR_WIDTH * QUAKE_MENU_FRAME_COUNT;
  const rgba = Buffer.alloc(width * QUAKE_MENU_CURSOR_HEIGHT * 4);

  for (let frame = 0; frame < QUAKE_MENU_FRAME_COUNT; frame++) {
    drawPakQpic(
      rgba,
      assets,
      `gfx/menudot${frame + 1}.lmp`,
      frame * QUAKE_MENU_CURSOR_WIDTH,
      0,
      width,
      QUAKE_MENU_CURSOR_HEIGHT,
      QUAKE_HUD_TRANSPARENT,
    );
  }

  return sharp(rgba, {
    raw: { width, height: QUAKE_MENU_CURSOR_HEIGHT, channels: 4 },
  }).png().toBuffer();
}

async function buildQuakeMainMenuMultiplayerPng(assets) {
  const width = QUAKE_MAIN_MENU_ACTIVE_ROW_WIDTH;
  const height = QUAKE_MAIN_MENU_ROW_HEIGHT;
  const rgba = Buffer.alloc(width * height * 4);
  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 20, 240, height, 0, 0, width, height, QUAKE_HUD_TRANSPARENT);
  const trimmed = trimTransparentRgba(rgba, width, height);
  return sharp(trimmed.rgba, {
    raw: { width: trimmed.width, height: trimmed.height, channels: 4 },
  }).png().toBuffer();
}

async function buildQuakeMainMenuActivePngs(assets) {
  const width = QUAKE_MAIN_MENU_ACTIVE_ROW_WIDTH;
  const height = QUAKE_MAIN_MENU_ROW_HEIGHT;
  const frames = [
    (rgba) => drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 0, 240, height, 0, 0, width, height, QUAKE_HUD_TRANSPARENT),
    (rgba) => drawMainMenuLevelSelectLabel(rgba, assets, 0, 0, width, height),
    (rgba) => drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 40, 124, height, 0, 0, width, height, QUAKE_HUD_TRANSPARENT),
    (rgba) => drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 1, 60, 75, height, 0, 0, width, height, QUAKE_HUD_TRANSPARENT),
  ];

  return Promise.all(frames.map(async (drawFrame) => {
    const rgba = Buffer.alloc(width * height * 4);
    drawFrame(rgba);
    const trimmed = trimTransparentRgba(rgba, width, height);
    return sharp(trimmed.rgba, {
      raw: { width: trimmed.width, height: trimmed.height, channels: 4 },
    }).png().toBuffer();
  }));
}

function drawMainMenuLevelSelectLabel(rgba, assets, x, rowTop, targetWidth, targetHeight) {
  const scale = QUAKE_MAIN_MENU_LEVEL_LABEL_SCALE;
  const y = rowTop + Math.round((QUAKE_MAIN_MENU_ROW_HEIGHT - 8 * scale) / 2);
  drawConcharsTextScaled(
    rgba,
    assets,
    QUAKE_MAIN_MENU_LEVEL_LABEL,
    x,
    y,
    true,
    scale,
    targetWidth,
    targetHeight,
  );
}

function trimTransparentRgba(rgba, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return { rgba: Buffer.alloc(4), width: 1, height: 1 };
  }

  const trimmedWidth = maxX - minX + 1;
  const trimmedHeight = maxY - minY + 1;
  const trimmedRgba = Buffer.alloc(trimmedWidth * trimmedHeight * 4);
  for (let y = 0; y < trimmedHeight; y++) {
    const sourceStart = ((minY + y) * width + minX) * 4;
    const sourceEnd = sourceStart + trimmedWidth * 4;
    rgba.copy(trimmedRgba, y * trimmedWidth * 4, sourceStart, sourceEnd);
  }

  return { rgba: trimmedRgba, width: trimmedWidth, height: trimmedHeight };
}

async function buildPakQpicCropPng(assets, pakPath, sourceX, sourceY, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  drawPakQpicCrop(rgba, assets, pakPath, sourceX, sourceY, width, height, 0, 0, width, height, QUAKE_HUD_TRANSPARENT);
  return sharp(rgba, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
}

async function buildCustomMenuTitlePng(sourcePath, options = {}) {
  const height = options.height ?? 20;
  const resized = await sharp(sourcePath)
    .resize({ height, kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = options.paletteColors
    ? snapRgbaToPalette(resized.data, options.paletteColors)
    : resized.data;
  softenCustomMenuTitleTopBand(rgba, resized.info.width, resized.info.height);
  repairCustomMenuTitleFirstSTop(rgba, resized.info.width, resized.info.height);
  repairCustomMenuTitleLArtifacts(rgba, resized.info.width, resized.info.height);

  return sharp(rgba, {
    raw: { width: resized.info.width, height: resized.info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

function buildQuakeMenuTitlePaletteColors(assets) {
  const width = QUAKE_MAIN_MENU_ACTIVE_ROW_WIDTH;
  const height = QUAKE_MAIN_MENU_ROW_HEIGHT;
  const rgba = Buffer.alloc(width * height * 4);
  const colors = new Map();
  const addColor = (r, g, b) => colors.set(`${r},${g},${b}`, [r, g, b]);
  const collectColors = () => {
    for (let offset = 0; offset < rgba.length; offset += 4) {
      if (rgba[offset + 3] !== 255) continue;
      addColor(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
    }
    rgba.fill(0);
  };

  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 0, 240, height, 0, 0, width, height, QUAKE_HUD_TRANSPARENT);
  collectColors();
  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 40, 124, height, 0, 0, width, height, QUAKE_HUD_TRANSPARENT);
  collectColors();
  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 1, 60, 75, height, 0, 0, width, height, QUAKE_HUD_TRANSPARENT);
  collectColors();

  return [...colors.values()];
}

function snapRgbaToPalette(rgba, paletteColors) {
  const snapped = Buffer.alloc(rgba.length);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] <= 32) continue;
    const [r, g, b] = nearestRgbColor(
      rgba[offset],
      rgba[offset + 1],
      rgba[offset + 2],
      paletteColors,
    );
    snapped[offset] = r;
    snapped[offset + 1] = g;
    snapped[offset + 2] = b;
    snapped[offset + 3] = 255;
  }
  return snapped;
}

function softenCustomMenuTitleTopBand(rgba, width, height) {
  if (height < 7) return;
  const row = 5;
  const sourceRow = 6;
  for (let x = 0; x < width; x++) {
    const offset = (row * width + x) * 4;
    if (rgba[offset + 3] === 0) continue;
    const brightness = rgba[offset] + rgba[offset + 1] + rgba[offset + 2];
    if (brightness <= 230) continue;

    const sourceOffset = (sourceRow * width + x) * 4;
    if (rgba[sourceOffset + 3] === 0) continue;
    rgba[offset] = rgba[sourceOffset];
    rgba[offset + 1] = rgba[sourceOffset + 1];
    rgba[offset + 2] = rgba[sourceOffset + 2];
  }
}

function repairCustomMenuTitleFirstSTop(rgba, width, height) {
  if (width < 18 || height < 2) return;
  const row = 1;
  const pixels = [
    [59, 31, 15, 255],
    [39, 31, 23, 255],
    [175, 99, 47, 255],
    [175, 99, 47, 255],
    [175, 99, 47, 255],
    [175, 99, 47, 255],
    [159, 79, 51, 255],
    [35, 19, 7, 255],
    [0, 0, 0, 0],
    [35, 19, 7, 255],
    [159, 79, 51, 255],
    [159, 79, 51, 255],
    [159, 79, 51, 255],
    [175, 99, 47, 255],
    [159, 79, 51, 255],
    [35, 19, 7, 255],
  ];
  for (let index = 0; index < pixels.length; index++) {
    const offset = (row * width + index + 2) * 4;
    const pixel = pixels[index];
    rgba[offset] = pixel[0];
    rgba[offset + 1] = pixel[1];
    rgba[offset + 2] = pixel[2];
    rgba[offset + 3] = pixel[3];
  }
}

function repairCustomMenuTitleLArtifacts(rgba, width, height) {
  const pixels = [
    [124, 2, 159, 79, 51],
    [40, 9, 87, 43, 23],
    [40, 10, 87, 43, 23],
    [40, 11, 87, 43, 23],
    [43, 8, 75, 35, 19],
    [43, 9, 75, 35, 19],
    [43, 11, 75, 35, 19],
    [43, 12, 75, 35, 19],
    [43, 13, 75, 35, 19],
    [196, 11, 87, 43, 23],
    [197, 9, 87, 43, 23],
    [197, 10, 87, 43, 23],
    [197, 11, 87, 43, 23],
    [198, 9, 87, 43, 23],
    [198, 10, 87, 43, 23],
    [198, 11, 87, 43, 23],
  ];

  for (const [x, y, r, g, b] of pixels) {
    if (x >= width || y >= height) continue;
    const offset = (y * width + x) * 4;
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = 255;
  }
}

function nearestRgbColor(r, g, b, paletteColors) {
  let nearest = paletteColors[0] ?? [r, g, b];
  let nearestDistance = Infinity;
  for (const color of paletteColors) {
    const distance =
      (r - color[0]) ** 2 +
      (g - color[1]) ** 2 +
      (b - color[2]) ** 2;
    if (distance >= nearestDistance) continue;
    nearest = color;
    nearestDistance = distance;
  }
  return nearest;
}

async function buildQuakeAboutPng(assets) {
  const rgba = Buffer.alloc(QUAKE_ABOUT_WIDTH * QUAKE_ABOUT_HEIGHT * 4);

  drawPakBox(rgba, assets, 24, 22, 272, 156);
  fillIndexedRect(rgba, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, assets.palette, 36, 34, 248, 132, 0, 132);

  drawConcharsCentered(rgba, assets, "CSSQUAKE V0.0.1", 38, true);
  drawConcharsCentered(rgba, assets, "POLYCSS PROOF OF CONCEPT", 58, true);
  drawConcharsCentered(rgba, assets, "E1M1 BSP SURFACES RENDERED", 78, false);
  drawConcharsCentered(rgba, assets, "AS REAL DOM NODES.", 90, false);
  drawConcharsCentered(rgba, assets, "TEXTURES ARE PACKED INTO CSS", 112, false);
  drawConcharsCentered(rgba, assets, "ATLAS SLICES AND COMPOSITED", 124, false);
  drawConcharsCentered(rgba, assets, "BY THE BROWSER.", 136, false);
  drawConcharsCentered(rgba, assets, "NO WEBGL. NO CANVAS LOOP.", 150, false);
  drawConcharsCentered(rgba, assets, "BACK", 164, true);

  return sharp(rgba, {
    raw: { width: QUAKE_ABOUT_WIDTH, height: QUAKE_ABOUT_HEIGHT, channels: 4 },
  }).png().toBuffer();
}

async function buildQuakeMenuPanelTexturePng(preparedMaps) {
  for (const textureName of QUAKE_MENU_PANEL_TEXTURE_NAMES) {
    const textureBuffer = await findPreparedTextureBuffer(preparedMaps, textureName);
    if (!textureBuffer) continue;
    return sharp(textureBuffer)
      .modulate({ brightness: 1.12, saturation: 0.92 })
      .png({ palette: true })
      .toBuffer();
  }
  throw new Error("Could not find a Quake texture for menu-panel-texture.png.");
}

async function buildQuakeConcharsPng(assets) {
  const width = 128;
  const height = 128;
  const lump = assets.lumps.get("conchars");
  if (!lump || lump.type !== 68) throw new Error("Missing Quake CONCHARS.");

  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < width * height; offset++) {
    const colorIndex = assets.wad.readUInt8(lump.filepos + offset);
    if (colorIndex === 0) continue;
    const paletteOffset = colorIndex * 3;
    const imageOffset = offset * 4;
    rgba[imageOffset] = assets.palette[paletteOffset] ?? 0;
    rgba[imageOffset + 1] = assets.palette[paletteOffset + 1] ?? 0;
    rgba[imageOffset + 2] = assets.palette[paletteOffset + 2] ?? 0;
    rgba[imageOffset + 3] = 255;
  }

  return sharp(rgba, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
}

async function findPreparedTextureBuffer(preparedMaps, textureName) {
  const target = textureName.toLowerCase();
  const maps = [
    ...preparedMaps.filter((item) => item.prepared?.label === "maps/e1m2.bsp"),
    ...preparedMaps,
  ];
  for (const { prepared } of maps) {
    for (const polygon of prepared.polygons ?? []) {
      if (String(polygon.data?.["tex"] ?? "").toLowerCase() !== target) continue;
      const texture = typeof polygon.texture === "number"
        ? prepared.textures?.[polygon.texture]
        : polygon.texture;
      if (typeof texture === "string") return readPreparedTextureBuffer(texture);
    }
  }
  return undefined;
}

async function readPreparedTextureBuffer(texture) {
  if (!texture.startsWith(`${quakePublicPath}/`)) return undefined;
  return readGeneratedPublicTextureFile(texture);
}

async function readGeneratedPublicTextureFile(urlPath) {
  return texturePngByPublicPath.get(urlPath) ?? readGeneratedPublicFile(urlPath);
}

async function readGeneratedPublicFile(urlPath, attempts = 8) {
  const filePath = path.join(generatedPublicDir, urlPath.replace(/^\//, ""));
  for (let attempt = 1; ; attempt++) {
    try {
      return await readFile(filePath);
    } catch (error) {
      if (error?.code === "ENOENT" && await restoreGeneratedTextureFile(urlPath, filePath)) continue;
      if (error?.code !== "ENOENT" || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }
}

async function restoreGeneratedTextureFile(urlPath, filePath) {
  const png = texturePngByPublicPath.get(urlPath);
  if (!png) return false;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, png);
  return true;
}

async function buildQuakeWeaponModel(assets, renderBundleBuilder) {
  const modelPath = "progs/v_shot.mdl";
  const model = parseQuakeAliasModel(assets, modelPath);
  const idleFrame = model.frames[0];
  const fireFrame = model.frames[1] ?? idleFrame;
  const textureBrightness = 1.5;
  if (!idleFrame) throw new Error("Quake weapon viewmodel has no frames.");
  const texture = await encodeTextureFileUrl({
    width: model.skinWidth,
    height: model.skinHeight,
    pixels: quakeAliasPaddedSkin(model),
    palette: assets.palette,
    brightness: textureBrightness,
  });

  const polygons = model.triangles.map((triangle) => {
    const uvs = triangle.indices.map((index) => quakeAliasUv(model, triangle, index));
    const isNozzle = isQuakeWeaponNozzlePolygon(uvs);
    const frame = isNozzle ? fireFrame : idleFrame;
    const vertices = triangle.indices.map((index) => quakeWeaponVertex(frame.vertices[index]));
    if (isNozzle) {
      return {
        vertices,
        color: quakeWeaponNozzleColor(vertices),
        data: { "nozzle": true },
      };
    }
    return {
      vertices,
      texture,
      textureAlphaMode: "opaque",
      uvs,
    };
  });

  const tightenWeaponDom = quakeDomTighteningEnabled("other", false);
  return {
    source: modelPath,
    renderBundle: await renderBundleBuilder.build({
      bundleName: "w",
      polygons: anchorQuakeWeaponPolygons(polygons),
      extractLeafStyles: true,
      tightenAtlasLeaves: tightenWeaponDom,
      optimizeAtlasLeafBasis: tightenWeaponDom,
      optimizeAtlasLeafHomography: tightenWeaponDom,
    }),
  };
}

function quakeWeaponNozzleColor(vertices) {
  const x = vertices.reduce((sum, vertex) => sum + vertex[0], 0) / vertices.length;
  if (x > 4.3) return "#fff4bf";
  if (x > 4.1) return "#ffd02a";
  if (x > 3.8) return "#ff6a13";
  return "#d71916";
}

function anchorQuakeWeaponPolygons(polygons) {
  const [px, py, pz] = QUAKE_WEAPON_MODEL_PIVOT;
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((vertex) => [
      vertex[0] - px,
      vertex[1] - py,
      vertex[2] - pz,
    ]),
  }));
}

async function buildQuakePickupModels(assets, buildBspModel, programMetadata, renderBundleBuilder, options = {}) {
  const models = {};
  const modelPathSets = quakePickupModelPathSets(assets, programMetadata);
  const {
    animatedAliasModelPaths,
    projectileAliasModelPaths,
    enemyAliasModelPaths,
    animatedMonsterAliasModelPaths,
  } = modelPathSets;
  let aliasModelPaths = new Set(modelPathSets.aliasModelPaths);
  let bspModelPaths = new Set(modelPathSets.bspModelPaths);
  const concurrency = Number.isFinite(options.concurrency)
    ? Math.max(1, Math.trunc(options.concurrency))
    : normalizedQuakeRenderBundleConcurrency();
  const referencedModelPaths = normalizeQuakeModelPathSet(options.referencedModelPaths);
  if (referencedModelPaths) {
    const modelCountBeforeFilter = aliasModelPaths.size + bspModelPaths.size;
    aliasModelPaths = filterQuakeModelPathSet(aliasModelPaths, referencedModelPaths);
    bspModelPaths = filterQuakeModelPathSet(bspModelPaths, referencedModelPaths);
    const modelCountAfterFilter = aliasModelPaths.size + bspModelPaths.size;
    console.log(
      `Referenced model filter: ${modelCountAfterFilter}/${modelCountBeforeFilter} model bundles selected` +
      `${modelCountAfterFilter === modelCountBeforeFilter ? "" : ` (${modelCountBeforeFilter - modelCountAfterFilter} skipped)`}.`,
    );
  }
  if (quakePrepareModelOnly.size > 0) {
    aliasModelPaths = new Set([...aliasModelPaths].filter(quakePrepareModelOnlyMatches));
    bspModelPaths = new Set([...bspModelPaths].filter(quakePrepareModelOnlyMatches));
    if (aliasModelPaths.size === 0 && bspModelPaths.size === 0) {
      throw new Error(
        `QUAKE_PREPARE_MODEL_ONLY did not match any prepared model: ${[...quakePrepareModelOnly].join(", ")}`,
      );
    }
  }
  const aliasModelItems = [];
  for (const source of aliasModelPaths) {
    const model = parseQuakeAliasModel(assets, source);
    if (!model.frames[0]) throw new Error(`${source} has no frames.`);
    const texture = await encodeTextureFileUrl({
      width: model.skinWidth,
      height: model.skinHeight,
      pixels: quakeAliasPaddedSkin(model),
      palette: assets.palette,
      brightness: 1.22,
    });
    const includeAnimationFrames = animatedAliasModelPaths.has(source) || animatedMonsterAliasModelPaths.has(source);
    const renderScale = enemyAliasModelPaths.has(source) ? QUAKE_ENEMY_ALIAS_MODEL_RENDER_SCALE : 1;
    const twoSidedTriangleIndices = quakeAliasTwoSidedTriangleIndices(model);
    const polygonPlan = buildQuakeAliasPolygonPlan(model, twoSidedTriangleIndices);
    if (polygonPlan.mergedPairCount > 0) {
      console.log(
        `Merged ${source}: ${model.triangles.length} triangles -> ` +
        `${polygonPlan.entries.length} alias polygons (${polygonPlan.mergedPairCount} pairs` +
        `${polygonPlan.rebakedPairCount ? `, ${polygonPlan.rebakedPairCount} rebaked` : ""}).`,
      );
    }
    const animationFrames = model.frames.map((frame) => ({
      name: frame.name,
      polygons: polygonPlan.entries.map((entry) => quakeAliasPolygonFromPlan(model, frame, entry)),
    }));
    const renderAnimationFrames = renderScale === 1
      ? animationFrames
      : animationFrames.map((frame) => ({
          ...frame,
          polygons: scaleQuakeModelPolygons(frame.polygons, renderScale),
        }));
    const prepared = {
      source,
      texture,
      polygons: renderAnimationFrames[0].polygons,
      domTighteningTarget: quakeAliasModelDomTighteningTarget(source, {
        animatedAliasModelPaths,
        enemyAliasModelPaths,
        projectileAliasModelPaths,
      }),
      debugOutlineKind: quakeAliasModelDebugOutlineKind(source, {
        enemyAliasModelPaths,
      }),
      ...(includeAnimationFrames && renderAnimationFrames.length > 1 ? { animationFrames: renderAnimationFrames } : {}),
      ...(renderScale !== 1 ? { renderScale } : {}),
      bounds: polygonBounds(animationFrames[0].polygons),
    };
    aliasModelItems.push({ source, prepared });
  }

  const aliasModelResults = await mapConcurrently(
    aliasModelItems,
    concurrency,
    async ({ source, prepared }) => runPrepareStep(`model ${source}`, async () => {
      await addQuakePickupModelRenderBundles(prepared, renderBundleBuilder);
      if (!hasRenderableQuakePickupModelBundle(prepared)) return null;
      stripQuakePickupModelFallbackGeometry(prepared);
      return [source, prepared];
    }),
  );
  for (const result of aliasModelResults) {
    if (!result) continue;
    models[result[0]] = result[1];
  }

  const bspModelResults = await mapConcurrently(
    [...bspModelPaths],
    concurrency,
    async (source) => runPrepareStep(`model ${source}`, async () => {
      const model = await buildBspModel(source);
      const polygons = model.polygons;
      const prepared = {
        source,
        polygons,
        disableDomTightening: true,
        domTighteningTarget: "pickups",
        debugOutlineKind: "pickup",
        bounds: polygonBounds(polygons),
      };
      await addQuakePickupModelRenderBundles(prepared, renderBundleBuilder);
      stripQuakePickupModelFallbackGeometry(prepared);
      return [source, prepared];
    }),
  );
  for (const result of bspModelResults) {
    models[result[0]] = result[1];
  }
  return { models };
}

function quakePickupModelCandidatePaths(assets, programMetadata) {
  return quakePickupModelPathSets(assets, programMetadata).modelPaths;
}

function quakePickupModelPathSets(assets, programMetadata) {
  const programPickupModels = quakeProgramPickupModelPaths(programMetadata)
    .filter((model) => assets.entries.has(model));
  const programEnemyModels = quakeProgramEnemyModelPaths(programMetadata)
    .filter((model) => assets.entries.has(model));
  const animatedAliasModelPaths = new Set([
    ...Object.values(QUAKE_PICKUP_MODEL_PATHS),
    ...programPickupModels.filter((model) => model.endsWith(".mdl")),
  ].filter((model) => assets.entries.has(model)));
  const projectileAliasModelPaths = new Set(
    QUAKE_PROJECTILE_ALIAS_MODEL_PATHS.filter((model) => assets.entries.has(model)),
  );
  const enemyAliasModelPaths = new Set(
    programEnemyModels
      .filter((model) => model.endsWith(".mdl") &&
        !animatedAliasModelPaths.has(model) &&
        !projectileAliasModelPaths.has(model)),
  );
  const animatedMonsterAliasModelPaths = new Set(
    QUAKE_ANIMATED_MONSTER_ALIAS_MODEL_PATHS.filter((model) => enemyAliasModelPaths.has(model)),
  );
  let aliasModelPaths = new Set([
    ...animatedAliasModelPaths,
    ...enemyAliasModelPaths,
    ...projectileAliasModelPaths,
  ]);
  let bspModelPaths = new Set([
    ...QUAKE_PICKUP_BSP_MODEL_PATHS,
    ...programPickupModels.filter((model) => model.endsWith(".bsp")),
  ].filter((model) => assets.entries.has(model)));
  return {
    animatedAliasModelPaths,
    projectileAliasModelPaths,
    enemyAliasModelPaths,
    animatedMonsterAliasModelPaths,
    aliasModelPaths,
    bspModelPaths,
    modelPaths: new Set([...aliasModelPaths, ...bspModelPaths]),
  };
}

function normalizeQuakeModelPathSet(modelPaths) {
  if (!modelPaths) return null;
  return new Set([...modelPaths].map((modelPath) => modelPath.toLowerCase()));
}

function filterQuakeModelPathSet(modelPaths, allowedModelPaths) {
  return new Set([...modelPaths].filter((modelPath) => allowedModelPaths.has(modelPath.toLowerCase())));
}

function hasRenderableQuakePickupModelBundle(model) {
  const bundles = [
    model.renderBundle,
    model.animationFrameSet?.renderBundle,
    ...(model.animationFrames?.map((frame) => frame.renderBundle) ?? []),
  ];
  return bundles.some((bundle) => Number(bundle?.leafCount) > 0 || bundle?.meshHtml?.includes("<s"));
}

function quakeAliasModelDomTighteningTarget(source, sets) {
  if (sets.animatedAliasModelPaths?.has(source)) return "pickups";
  if (sets.enemyAliasModelPaths?.has(source) || sets.projectileAliasModelPaths?.has(source)) return "monsters";
  return "other";
}

function quakeAliasModelDebugOutlineKind(source, sets) {
  return sets.enemyAliasModelPaths?.has(source) ? "enemy" : "pickup";
}

async function addQuakePickupModelRenderBundles(model, renderBundleBuilder, textureQuality = 1) {
  const baseName = quakeModelBundleName(model.source);
  const domTighteningTarget = model.domTighteningTarget ?? "other";
  const outlineKind = model.debugOutlineKind ?? "pickup";
  const tightenAtlasLeaves = model.disableDomTightening === true
    ? false
    : quakeDomTighteningEnabled(domTighteningTarget, true);
  const optimizeAtlasLeafBasis = model.disableDomTightening === true
    ? false
    : quakeDomTighteningEnabled(domTighteningTarget, false);
  const optimizeAtlasLeafHomography = tightenAtlasLeaves && domTighteningTarget !== "pickups";
  if (model.animationFrames?.length > 1) {
    const frameBundles = await renderBundleBuilder.buildAnimatedFrameSet({
      bundleName: baseName,
      frames: model.animationFrames.map((_frame, index) => ({
        bundleName: `${baseName}/f${index}`,
        polygons: quakePickupModelRenderBundlePolygons(model, index),
      })),
      textureQuality,
      extractLeafStyles: true,
      tightenAtlasLeaves,
      optimizeAtlasLeafBasis,
      optimizeAtlasLeafHomography,
      optimizeAtlasTriangleBasis: quakeTriangleAtlasBasis && optimizeAtlasLeafBasis,
      outlineKind,
    });
    for (let index = 0; index < model.animationFrames.length; index++) {
      model.animationFrames[index].renderBundle = frameBundles[index];
    }
    const animationFrameSet = quakePickupModelAnimationFrameSet(model);
    if (!animationFrameSet) {
      console.warn(`Animated model ${model.source} has no lossless stable topology frame set; using per-frame bundles.`);
      for (const frame of model.animationFrames) {
        const leafClasses = quakeRenderBundleLeafClassesInOrder(frame.renderBundle);
        attachQuakeRenderBundleDirectFrameStyles(frame.renderBundle, leafClasses);
      }
      await writeQuakeAnimationFrameStyles(baseName, model);
      return;
    }
    model.animationFrameSet = animationFrameSet;
    await writeQuakeAnimationFrameStyles(baseName, model);
    compactQuakeAnimationFrameRenderBundles(model);
    return;
  }
  model.renderBundle = await renderBundleBuilder.build({
    bundleName: baseName,
    polygons: quakePickupModelRenderBundlePolygons(model, 0),
    textureQuality,
    extractLeafStyles: true,
    tightenAtlasLeaves,
    optimizeAtlasLeafBasis,
    optimizeAtlasLeafHomography,
    outlineKind,
  });
}

function quakePickupModelAnimationFrameSet(model) {
  const frames = model.animationFrames ?? [];
  if (frames.length <= 1) return null;
  const frameClassSets = frames.map((frame) => quakeRenderBundleLeafClasses(frame.renderBundle));
  if (frameClassSets.some((classes) => classes.size === 0)) return null;
  const commonLeafClasses = new Set(frameClassSets[0]);
  for (const classes of frameClassSets.slice(1)) {
    for (const leafClass of [...commonLeafClasses]) {
      if (!classes.has(leafClass)) commonLeafClasses.delete(leafClass);
    }
  }
  const maxLeafCount = Math.max(...frames.map((frame) => Number(frame.renderBundle?.leafCount) || 0));
  if (maxLeafCount <= 0) return null;
  if (commonLeafClasses.size / maxLeafCount < QUAKE_ANIMATION_FRAME_SET_MIN_COMMON_LEAF_RATIO) return null;
  const renderBundle = quakeRenderBundleWithLeafClasses(frames[0].renderBundle, commonLeafClasses);
  const leafClasses = quakeRenderBundleLeafClassesInOrder(renderBundle);
  attachQuakeRenderBundleDirectFrameStyles(renderBundle, leafClasses);
  for (const frame of frames) {
    attachQuakeRenderBundleDirectFrameStyles(frame.renderBundle, leafClasses);
  }
  return {
    leafCount: commonLeafClasses.size,
    droppedLeafCount: maxLeafCount - commonLeafClasses.size,
    renderBundle,
  };
}

function quakeRenderBundleLeafClasses(renderBundle) {
  if (renderBundle?.leafFrameStylesByClass?.length) {
    return new Set(renderBundle.leafFrameStylesByClass.map(([leafClass]) => leafClass));
  }
  return new Set(quakeRenderBundleLeafClassesInOrder(renderBundle));
}

function quakeRenderBundleLeafClassesInOrder(renderBundle) {
  const classes = new Set();
  const ordered = [];
  if (!renderBundle?.meshHtml) return ordered;
  for (const match of renderBundle.meshHtml.matchAll(/<([bisu])\b[^>]*\bclass="([^"]*)"[^>]*><\/\1>/g)) {
    const leafClass = match[2].split(/\s+/).find((className) => /^q[a-z0-9]+$/i.test(className));
    if (!leafClass || classes.has(leafClass)) continue;
    classes.add(leafClass);
    ordered.push(leafClass);
  }
  return ordered;
}

function quakeRenderBundleWithLeafClasses(renderBundle, leafClasses) {
  let leafCount = 0;
  let atlasLeafCount = 0;
  const leafMetadata = [];
  let sourceLeafIndex = 0;
  const meshHtml = renderBundle.meshHtml.replace(
    /<([bisu])\b([^>]*)><\/\1>/g,
    (html, tagName, attributes) => {
      const sourceLeafMetadata = renderBundle.leafMetadata?.[sourceLeafIndex];
      sourceLeafIndex++;
      if (!quakeRenderBundleLeafHasClass(attributes, leafClasses)) return "";
      leafCount++;
      if (tagName === "s") atlasLeafCount++;
      if (sourceLeafMetadata) leafMetadata.push(sourceLeafMetadata);
      return html;
    },
  );
  return {
    ...renderBundle,
    meshHtml,
    leafMetadata,
    leafCount,
    atlasLeafCount,
  };
}

function attachQuakeRenderBundleDirectFrameStyles(renderBundle, leafClasses, options = {}) {
  const stylesByClass = new Map(renderBundle.leafFrameStylesByClass ?? []);
  const missingLeafFrameStyle = options.missingLeafFrameStyle ?? [];
  const leafFrameStyles = leafClasses.map((leafClass) => stylesByClass.get(leafClass) ?? missingLeafFrameStyle);
  if (leafFrameStyles.some((frameStyle) => frameStyle.length > 0)) {
    renderBundle.leafFrameStyles = leafFrameStyles;
  }
  delete renderBundle.leafFrameStylesByClass;
  delete renderBundle.meshCss;
  delete renderBundle.styleUrl;
  delete renderBundle.styleClassName;
}

function compactQuakeAnimationFrameRenderBundles(model) {
  if (!model.animationFrameSet || !model.animationFrames?.length) return;
  for (const frame of model.animationFrames) {
    const renderBundle = frame.renderBundle;
    if (!renderBundle) continue;
    frame.renderBundle = {
      version: renderBundle.version,
      kind: renderBundle.kind,
      polycssVersion: renderBundle.polycssVersion,
      textureLighting: renderBundle.textureLighting,
      textureQuality: renderBundle.textureQuality,
      meshHtml: quakeRenderBundleRootOnlyHtml(renderBundle),
      assetUrls: [...renderBundle.assetUrls],
      leafMetadata: [],
      polygonCount: 0,
      leafCount: 0,
      atlasLeafCount: 0,
      ...(renderBundle.leafFrameStylesUrl ? { leafFrameStylesUrl: renderBundle.leafFrameStylesUrl } : {}),
      ...(renderBundle.leafFrameStylesIndex !== undefined ? {
        leafFrameStylesIndex: renderBundle.leafFrameStylesIndex,
      } : {}),
    };
  }
}

function quakeRenderBundleRootOnlyHtml(renderBundle) {
  const attributes = renderBundle.meshHtml.match(/^<div\b([^>]*)>/)?.[1] ?? "";
  const style = attributes.match(/\sstyle="([^"]*)"/)?.[1];
  return `<div class="polycss-mesh"${style ? ` style="${style}"` : ""}></div>`;
}

async function writeQuakeAnimationFrameStyles(bundleName, model) {
  const frames = model.animationFrames ?? [];
  const frameStyles = frames.map((frame) => frame.renderBundle?.leafFrameStyles ?? []);
  if (!frameStyles.some((styles) => styles.length > 0)) return;
  const body = JSON.stringify({
    version: 3,
    frames: compactQuakeAnimationFrameStyles(frameStyles),
  });
  const styleDir = path.join(renderBundleOutputDir, bundleName);
  await mkdir(styleDir, { recursive: true });
  const filename = "0.json";
  await writeFile(path.join(styleDir, filename), body);
  const styleUrl = `${quakeRenderBundlePublicPath}/${bundleName}/${filename}`;
  for (let index = 0; index < frames.length; index++) {
    const renderBundle = frames[index].renderBundle;
    if (!renderBundle) continue;
    renderBundle.leafFrameStylesUrl = styleUrl;
    renderBundle.leafFrameStylesIndex = index;
    delete renderBundle.leafFrameStyles;
  }
  if (model.animationFrameSet?.renderBundle) {
    model.animationFrameSet.renderBundle.leafFrameStylesUrl = styleUrl;
    model.animationFrameSet.renderBundle.leafFrameStylesIndex = 0;
    delete model.animationFrameSet.renderBundle.leafFrameStyles;
  }
}

function compactQuakeAnimationFrameStyles(frames) {
  const baseFrameStyles = frames[0] ?? [];
  return frames.map((frameStyles, frameIndex) => {
    if (frameIndex === 0) return frameStyles;
    return frameStyles.map((frameStyle = [], leafIndex) => {
      const baseFrameStyle = baseFrameStyles[leafIndex] ?? [];
      const matrix = frameStyle[0] ?? "";
      const background = frameStyle[1] ?? "";
      const extraStyle = frameStyle[2] ?? "";
      const backgroundChanged = background !== (baseFrameStyle[1] ?? "");
      const extraStyleChanged = extraStyle !== (baseFrameStyle[2] ?? "");
      if (extraStyleChanged) return [matrix, backgroundChanged ? background : null, extraStyle];
      if (backgroundChanged) return [matrix, background];
      return [matrix];
    });
  });
}

function quakeRenderBundleLeafHasClass(attributes, leafClasses) {
  const classMatch = attributes.match(/\bclass="([^"]*)"/);
  if (!classMatch) return false;
  return classMatch[1].split(/\s+/).some((leafClass) => leafClasses.has(leafClass));
}

function stripQuakePickupModelFallbackGeometry(model) {
  delete model.disableDomTightening;
  delete model.debugOutlineKind;
  delete model.domTighteningTarget;
  delete model.texture;
  delete model.polygons;
  for (const frame of model.animationFrames ?? []) {
    delete frame.polygons;
  }
}

function quakePickupModelRenderBundlePolygons(model, frameIndex) {
  const frame = model.animationFrames?.[frameIndex];
  const polygons = frame?.polygons ?? model.polygons;
  return polygons.map(({ data, ...polygon }) => ({
    ...polygon,
    ...(data?.["two-sided"] ? { data: { "two-sided": true } } : {}),
    ...(model.texture ? { texture: model.texture, textureAlphaMode: "opaque" } : {}),
  }));
}

function quakeModelBundleName(source) {
  let basename = path.basename(source, path.extname(source)).toLowerCase();
  basename = basename.replace(/^b[_-]/, "");
  return basename
    .replace(/[^a-z0-9]+/g, "") || "m";
}

function quakeProgramPickupModelPaths(programMetadata) {
  if (!programMetadata) return [];
  const paths = [];
  for (const entry of programMetadata.entityFunctions) {
    if (!/^(item|weapon|ammo|key)_/.test(entry.classname)) continue;
    for (const model of entry.models) {
      if (/^(maps|progs)\/.+\.(bsp|mdl)$/i.test(model.path)) paths.push(model.path);
    }
  }
  return [...new Set(paths)];
}

function quakeProgramEnemyModelPaths(programMetadata) {
  if (!programMetadata) return [];
  const paths = [];
  for (const entry of programMetadata.entityFunctions) {
    if (!entry.classname.startsWith("monster_")) continue;
    const models = entry.models.map((model) => model.path).filter((model) => /^progs\/.+\.mdl$/i.test(model));
    const preferred = QUAKE_MONSTER_MODEL_PATHS[entry.classname];
    const modelPath = preferred && models.includes(preferred)
      ? preferred
      : models.find(isQuakeMonsterBodyModel) ?? models[0];
    if (modelPath) paths.push(modelPath);
  }
  return [...new Set(paths)];
}

function isQuakeMonsterBodyModel(modelPath) {
  const filename = path.basename(modelPath).toLowerCase();
  return !filename.startsWith("h_") &&
    !filename.includes("gib") &&
    !["bolt.mdl", "grenade.mdl", "k_spike.mdl", "lavaball.mdl", "laser.mdl", "s_light.mdl", "v_spike.mdl", "w_spike.mdl", "zom_gib.mdl"].includes(filename);
}

function buildQuakeProgramMetadata(assets, sourceProgramFacts = null) {
  const entry = assets.entries.get("progs.dat");
  if (!entry) throw new Error("Missing Quake progs.dat.");
  const progs = assets.pak.subarray(entry.offset, entry.offset + entry.length);
  const header = parseQuakeProgramHeader(progs);
  const stringsOffset = header.ofsStrings;
  const readProgramString = (offset) => readNullTerminatedString(progs, stringsOffset + offset);

  const assetStringByGlobalOffset = new Map();
  for (let i = 0; i < header.numGlobalDefs; i++) {
    const offset = header.ofsGlobalDefs + i * 8;
    const type = progs.readUInt16LE(offset) & 0x7fff;
    if (type !== 1) continue;
    const globalOffset = progs.readUInt16LE(offset + 2);
    const stringOffset = progs.readInt32LE(header.ofsGlobals + globalOffset * 4);
    const value = readProgramString(stringOffset);
    const asset = quakeProgramAssetString(value);
    if (asset) assetStringByGlobalOffset.set(globalOffset, asset);
  }

  const functions = [];
  for (let i = 0; i < header.numFunctions; i++) {
    const offset = header.ofsFunctions + i * 36;
    functions.push({
      index: i,
      firstStatement: progs.readInt32LE(offset),
      name: readProgramString(progs.readInt32LE(offset + 16)),
      file: readProgramString(progs.readInt32LE(offset + 20)),
    });
  }

  const executableFunctions = functions
    .filter((fn) => fn.firstStatement > 0)
    .sort((a, b) => a.firstStatement - b.firstStatement);
  const functionEndByIndex = new Map();
  for (let i = 0; i < executableFunctions.length; i++) {
    functionEndByIndex.set(
      executableFunctions[i].index,
      i + 1 < executableFunctions.length ? executableFunctions[i + 1].firstStatement : header.numStatements,
    );
  }

  const entityFunctions = [];
  const modelsByClassname = {};
  const soundsByClassname = {};
  for (const fn of functions) {
    if (!isQuakeEntityFunctionName(fn.name) || fn.firstStatement <= 0) continue;
    const endStatement = functionEndByIndex.get(fn.index) ?? header.numStatements;
    const models = quakeFunctionAssetReferences(progs, header, fn.firstStatement, endStatement, assetStringByGlobalOffset, "model");
    const sounds = quakeFunctionAssetReferences(progs, header, fn.firstStatement, endStatement, assetStringByGlobalOffset, "sound");
    if (models.length === 0 && sounds.length === 0) continue;
    entityFunctions.push({
      classname: fn.name,
      file: fn.file,
      models,
      ...(sounds.length ? { sounds } : {}),
      dependencies: {
        models,
        sounds,
      },
    });
    if (models.length) modelsByClassname[fn.name] = models.map((entry) => entry.path);
    if (sounds.length) soundsByClassname[fn.name] = sounds.map((entry) => entry.path);
  }

  entityFunctions.sort((a, b) => a.classname.localeCompare(b.classname));
  const sourceFactChecks = sourceProgramFacts
    ? buildQuakeProgramSourceFactChecks(sourceProgramFacts, { modelsByClassname, soundsByClassname })
    : null;
  return {
    version: 1,
    crc: header.crc,
    entityFunctions,
    modelsByClassname,
    soundsByClassname,
    ...(sourceFactChecks ? { sourceFactChecks } : {}),
  };
}

function parseQuakeProgramHeader(progs) {
  return {
    version: progs.readInt32LE(0),
    crc: progs.readInt32LE(4),
    ofsStatements: progs.readInt32LE(8),
    numStatements: progs.readInt32LE(12),
    ofsGlobalDefs: progs.readInt32LE(16),
    numGlobalDefs: progs.readInt32LE(20),
    ofsFieldDefs: progs.readInt32LE(24),
    numFieldDefs: progs.readInt32LE(28),
    ofsFunctions: progs.readInt32LE(32),
    numFunctions: progs.readInt32LE(36),
    ofsStrings: progs.readInt32LE(40),
    numStrings: progs.readInt32LE(44),
    ofsGlobals: progs.readInt32LE(48),
    numGlobals: progs.readInt32LE(52),
    entityFields: progs.readInt32LE(56),
  };
}

function quakeProgramAssetString(value) {
  const path = value.trim().toLowerCase();
  if (/^(maps|progs)\/.+\.(bsp|mdl|spr)$/i.test(path)) {
    return { kind: "model", path };
  }
  if (/^(?:sound\/)?[a-z0-9_/-]+\.wav$/i.test(path)) {
    return { kind: "sound", path: path.replace(/^sound\//i, "") };
  }
  return null;
}

function quakeFunctionAssetReferences(progs, header, firstStatement, endStatement, assetStringByGlobalOffset, kind) {
  const assets = [];
  const seen = new Set();
  for (let statement = firstStatement; statement < endStatement; statement++) {
    const offset = header.ofsStatements + statement * 8;
    for (const operandOffset of [offset + 2, offset + 4, offset + 6]) {
      const asset = assetStringByGlobalOffset.get(progs.readInt16LE(operandOffset));
      if (!asset || asset.kind !== kind || seen.has(asset.path)) continue;
      seen.add(asset.path);
      assets.push({ path: asset.path, statement });
    }
  }
  return assets;
}

function buildQuakeProgramSourceFactChecks(sourceProgramFacts, compiledMetadata) {
  const checks = [];
  const mismatches = [];
  let matchedModels = 0;
  let matchedSounds = 0;
  for (const [classname, sourceFact] of Object.entries(sourceProgramFacts.entities ?? {})) {
    const sourceModels = quakeSourceDependencyPaths(sourceFact, "models");
    const sourceSounds = quakeSourceDependencyPaths(sourceFact, "sounds").map((soundPath) => soundPath.replace(/^sound\//i, ""));
    const compiledModels = new Set(compiledMetadata.modelsByClassname[classname] ?? []);
    const compiledSounds = new Set(compiledMetadata.soundsByClassname[classname] ?? []);
    const missingModels = sourceModels.filter((modelPath) => !compiledModels.has(modelPath));
    const missingSounds = sourceSounds.filter((soundPath) => !compiledSounds.has(soundPath));
    matchedModels += sourceModels.length - missingModels.length;
    matchedSounds += sourceSounds.length - missingSounds.length;
    const check = {
      classname,
      sourceModels,
      sourceSounds,
      matchedModels: sourceModels.length - missingModels.length,
      matchedSounds: sourceSounds.length - missingSounds.length,
      missingModels,
      missingSounds,
      status: missingModels.length || missingSounds.length ? "mismatch" : "matched",
    };
    checks.push(check);
    if (check.status === "mismatch") mismatches.push(check);
  }
  return {
    version: 1,
    sourceRevision: sourceProgramFacts.source?.revision ?? "",
    status: mismatches.length ? "mismatch" : "matched",
    checkedClassnames: checks.map((check) => check.classname),
    matchedModels,
    matchedSounds,
    checks,
    mismatches,
  };
}

function quakeSourceDependencyPaths(sourceFact, key) {
  const dependencies = Array.isArray(sourceFact?.dependencies?.[key])
    ? sourceFact.dependencies[key]
    : [];
  return [...new Set(
    dependencies
      .map((dependency) => typeof dependency?.path === "string" ? dependency.path.trim().toLowerCase() : "")
      .filter(Boolean),
  )].sort();
}

function isQuakeEntityFunctionName(name) {
  return /^(item|weapon|ammo|key|monster|trigger|func|info|light|misc|path)_/.test(name) ||
    name === "worldspawn";
}

function isQuakeWeaponNozzlePolygon(uvs) {
  const minU = Math.min(...uvs.map((uv) => uv[0]));
  const maxU = Math.max(...uvs.map((uv) => uv[0]));
  const maxV = Math.max(...uvs.map((uv) => uv[1]));
  return maxV < 0.35 && (
    (minU < 0.22 && maxU < 0.22) ||
    (minU > 0.5 && maxU < 0.72)
  );
}

function loadQuakeHudAssets(pak, parsePakDirectory) {
  const entries = new Map(parsePakDirectory(pak).map((entry) => [
    entry.name,
    {
      offset: entry.offset,
      length: entry.size,
    },
  ]));

  const wadEntry = entries.get("gfx.wad");
  const paletteEntry = entries.get("gfx/palette.lmp");
  if (!wadEntry || !paletteEntry) throw new Error("Quake HUD assets are missing from the PAK.");

  const wad = pak.subarray(wadEntry.offset, wadEntry.offset + wadEntry.length);
  if (readFixedString(wad, 0, 4) !== "WAD2") throw new Error("gfx.wad is not a WAD2 file.");
  const numLumps = wad.readInt32LE(4);
  const lumpTableOffset = wad.readInt32LE(8);
  const lumps = new Map();
  for (let i = 0; i < numLumps; i++) {
    const offset = lumpTableOffset + i * 32;
    const name = readFixedString(wad, offset + 16, 16).toLowerCase();
    lumps.set(name, {
      filepos: wad.readInt32LE(offset),
      type: wad.readUInt8(offset + 12),
    });
  }

  return {
    pak,
    entries,
    wad,
    palette: pak.subarray(paletteEntry.offset, paletteEntry.offset + paletteEntry.length),
    lumps,
  };
}

function parseQuakeAliasModel(assets, pakPath) {
  const entry = assets.entries.get(pakPath);
  if (!entry) throw new Error(`Missing Quake alias model ${pakPath}.`);
  const mdl = assets.pak.subarray(entry.offset, entry.offset + entry.length);
  if (readFixedString(mdl, 0, 4) !== "IDPO" || mdl.readInt32LE(4) !== 6) {
    throw new Error(`Unsupported Quake alias model ${pakPath}.`);
  }

  const scale = [mdl.readFloatLE(8), mdl.readFloatLE(12), mdl.readFloatLE(16)];
  const translate = [mdl.readFloatLE(20), mdl.readFloatLE(24), mdl.readFloatLE(28)];
  const numSkins = mdl.readInt32LE(48);
  const skinWidth = mdl.readInt32LE(52);
  const skinHeight = mdl.readInt32LE(56);
  const numVerts = mdl.readInt32LE(60);
  const numTris = mdl.readInt32LE(64);
  const numFrames = mdl.readInt32LE(68);
  let offset = 84;

  let skin = null;
  for (let skinIndex = 0; skinIndex < numSkins; skinIndex++) {
    const type = mdl.readInt32LE(offset);
    offset += 4;
    if (type !== 0) throw new Error(`Grouped Quake alias skins are not supported for ${pakPath}.`);
    if (skinIndex === 0) skin = mdl.subarray(offset, offset + skinWidth * skinHeight);
    offset += skinWidth * skinHeight;
  }
  if (!skin) throw new Error(`Missing skin for Quake alias model ${pakPath}.`);

  const texcoords = [];
  for (let i = 0; i < numVerts; i++) {
    texcoords.push({
      onseam: mdl.readInt32LE(offset),
      s: mdl.readInt32LE(offset + 4),
      t: mdl.readInt32LE(offset + 8),
    });
    offset += 12;
  }

  const triangles = [];
  for (let i = 0; i < numTris; i++) {
    triangles.push({
      facesfront: mdl.readInt32LE(offset),
      indices: [mdl.readInt32LE(offset + 4), mdl.readInt32LE(offset + 8), mdl.readInt32LE(offset + 12)],
    });
    offset += 16;
  }

  const frames = [];
  for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
    const type = mdl.readInt32LE(offset);
    offset += 4;
    if (type === 0) {
      const frame = readQuakeAliasSimpleFrame(mdl, offset, numVerts, scale, translate);
      offset = frame.offset;
      frames.push({ name: frame.name, vertices: frame.vertices });
    } else if (type === 1) {
      offset += 8;
      const groupFrameCount = mdl.readInt32LE(offset);
      offset += 4 + groupFrameCount * 4;
      for (let groupFrameIndex = 0; groupFrameIndex < groupFrameCount; groupFrameIndex++) {
        const frame = readQuakeAliasSimpleFrame(mdl, offset, numVerts, scale, translate);
        offset = frame.offset;
        if (groupFrameIndex === 0) frames.push({ name: frame.name, vertices: frame.vertices });
      }
    } else {
      throw new Error(`Unsupported Quake alias frame type ${type} for ${pakPath}.`);
    }
  }

  return { skinWidth, skinHeight, skin, texcoords, triangles, frames };
}

function readQuakeAliasSimpleFrame(mdl, offset, numVerts, scale, translate) {
  offset += 8;
  const name = readFixedString(mdl, offset, 16);
  offset += 16;
  const vertices = [];
  for (let i = 0; i < numVerts; i++) {
    vertices.push([
      mdl[offset] * scale[0] + translate[0],
      mdl[offset + 1] * scale[1] + translate[1],
      mdl[offset + 2] * scale[2] + translate[2],
    ]);
    offset += 4;
  }
  return { name, offset, vertices };
}

function quakeWeaponVertex(vertex) {
  const [x, y, z] = vertex;
  return [x * 0.16, y * 0.16, z * 0.16];
}

function quakePickupVertex(vertex) {
  const [x, y, z] = vertex;
  return [x * QUAKE_PICKUP_MODEL_SCALE, y * QUAKE_PICKUP_MODEL_SCALE, z * QUAKE_PICKUP_MODEL_SCALE];
}

function scaleQuakeModelPolygons(polygons, scale) {
  const scaleVertex = (vertex) => [
    vertex[0] * scale,
    vertex[1] * scale,
    vertex[2] * scale,
  ];
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map(scaleVertex),
    ...(Array.isArray(polygon.textureTriangles) ? {
      textureTriangles: polygon.textureTriangles.map((triangle) => ({
        vertices: triangle.vertices.map(scaleVertex),
        uvs: triangle.uvs.map((uv) => [...uv]),
      })),
    } : {}),
  }));
}

function buildQuakeAliasPolygonPlan(model, twoSidedTriangleIndices) {
  const candidateEntries = quakeAliasMergedPolygonCandidates(model, twoSidedTriangleIndices, {
    rebakeUvSeams: quakeAliasRebakeMerge,
  });
  const candidateCountsByTriangleIndex = new Map();
  for (const entry of candidateEntries) {
    for (const triangleIndex of entry.triangleIndices) {
      candidateCountsByTriangleIndex.set(
        triangleIndex,
        (candidateCountsByTriangleIndex.get(triangleIndex) ?? 0) + 1,
      );
    }
  }

  candidateEntries.sort((a, b) =>
    quakeAliasCandidatePairScore(a, candidateCountsByTriangleIndex) -
      quakeAliasCandidatePairScore(b, candidateCountsByTriangleIndex) ||
    a.triangleIndices[0] - b.triangleIndices[0] ||
    a.triangleIndices[1] - b.triangleIndices[1],
  );

  const mergedTriangleIndices = new Set();
  const mergedEntriesByFirstTriangleIndex = new Map();
  for (const entry of candidateEntries) {
    if (entry.triangleIndices.some((triangleIndex) => mergedTriangleIndices.has(triangleIndex))) continue;
    for (const triangleIndex of entry.triangleIndices) mergedTriangleIndices.add(triangleIndex);
    mergedEntriesByFirstTriangleIndex.set(Math.min(...entry.triangleIndices), entry);
  }

  const entries = [];
  for (let triangleIndex = 0; triangleIndex < model.triangles.length; triangleIndex++) {
    const mergedEntry = mergedEntriesByFirstTriangleIndex.get(triangleIndex);
    if (mergedEntry) {
      entries.push(mergedEntry);
      continue;
    }
    if (mergedTriangleIndices.has(triangleIndex)) continue;
    entries.push(quakeAliasSingleTrianglePlan(model, twoSidedTriangleIndices, triangleIndex));
  }

  return {
    entries,
    mergedPairCount: mergedEntriesByFirstTriangleIndex.size,
    rebakedPairCount: entries.filter((entry) => entry.rebakedTextureTriangles).length,
  };
}

function quakeAliasSingleTrianglePlan(model, twoSidedTriangleIndices, triangleIndex) {
  const triangle = model.triangles[triangleIndex];
  return {
    triangleIndices: [triangleIndex],
    indexOrder: [...triangle.indices],
    uvs: triangle.indices.map((index) => quakeAliasUv(model, triangle, index)),
    ...(twoSidedTriangleIndices.has(triangleIndex) ? { data: { "two-sided": true } } : {}),
  };
}

function quakeAliasMergedPolygonCandidates(model, twoSidedTriangleIndices, options = {}) {
  const edgeTriangleIndices = quakeAliasEdgeTriangleIndices(model.triangles);
  const candidateEntries = [];
  const candidateKeys = new Set();
  for (let triangleIndex = 0; triangleIndex < model.triangles.length; triangleIndex++) {
    const triangle = model.triangles[triangleIndex];
    for (const [a, b] of quakeAliasTriangleEdges(triangle.indices)) {
      const neighborTriangleIndices = edgeTriangleIndices.get(quakeAliasEdgeKey(a, b));
      if (!neighborTriangleIndices || neighborTriangleIndices.length !== 2) continue;
      const otherTriangleIndex = neighborTriangleIndices[0] === triangleIndex
        ? neighborTriangleIndices[1]
        : neighborTriangleIndices[0];
      if (otherTriangleIndex <= triangleIndex) continue;
      const candidateKey = `${triangleIndex}:${otherTriangleIndex}`;
      if (candidateKeys.has(candidateKey)) continue;
      candidateKeys.add(candidateKey);
      const mergedEntry = quakeAliasMergedPolygonPlan(
        model,
        twoSidedTriangleIndices,
        triangleIndex,
        otherTriangleIndex,
        options,
      );
      if (mergedEntry) candidateEntries.push(mergedEntry);
    }
  }
  return candidateEntries;
}

function quakeAliasCandidatePairScore(entry, candidateCountsByTriangleIndex) {
  return entry.triangleIndices.reduce(
    (sum, triangleIndex) => sum + (candidateCountsByTriangleIndex.get(triangleIndex) ?? 0),
    0,
  );
}

function quakeAliasMergedPolygonPlan(model, twoSidedTriangleIndices, triangleIndexA, triangleIndexB, options = {}) {
  const triangleA = model.triangles[triangleIndexA];
  const triangleB = model.triangles[triangleIndexB];
  const sharedIndices = triangleA.indices.filter((index) => triangleB.indices.includes(index));
  const uniqueIndices = new Set([...triangleA.indices, ...triangleB.indices]);
  if (sharedIndices.length !== 2 || uniqueIndices.size !== 4) return null;
  const sharedEdgeUvsMatch = quakeAliasSharedEdgeUvsMatch(model, triangleA, triangleB, sharedIndices);
  if (!sharedEdgeUvsMatch && !options.rebakeUvSeams) return null;

  const cycle = quakeAliasBoundaryIndexCycle(triangleA.indices, triangleB.indices);
  if (!cycle) return null;
  const indexOrder = quakeAliasOrientMergedIndexOrder(model, triangleIndexA, triangleIndexB, cycle);
  if (!quakeAliasMergedPolygonFramesAreSafe(model, triangleIndexA, triangleIndexB, indexOrder)) return null;
  if (!sharedEdgeUvsMatch && !quakeAliasMergedPolygonFramesShareAffineShape(model, indexOrder)) return null;

  const twoSided = twoSidedTriangleIndices.has(triangleIndexA) || twoSidedTriangleIndices.has(triangleIndexB);
  return {
    triangleIndices: [triangleIndexA, triangleIndexB],
    indexOrder,
    ...(sharedEdgeUvsMatch
      ? { uvs: indexOrder.map((index) => quakeAliasPlanUv(model, triangleA, triangleB, index)) }
      : {
          rebakedTextureTriangles: true,
          textureTriangles: [
            quakeAliasTextureTrianglePlan(model, triangleA),
            quakeAliasTextureTrianglePlan(model, triangleB),
          ],
        }),
    ...(twoSided ? { data: { "two-sided": true } } : {}),
  };
}

function quakeAliasSharedEdgeUvsMatch(model, triangleA, triangleB, sharedIndices) {
  return sharedIndices.every((index) =>
    quakeAliasSameUv(
      quakeAliasUv(model, triangleA, index),
      quakeAliasUv(model, triangleB, index),
    ),
  );
}

function quakeAliasPlanUv(model, triangleA, triangleB, index) {
  return quakeAliasUv(
    model,
    triangleA.indices.includes(index) ? triangleA : triangleB,
    index,
  );
}

function quakeAliasPolygonFromPlan(model, frame, entry) {
  return {
    vertices: entry.indexOrder.map((index) => quakePickupVertex(frame.vertices[index])),
    ...(entry.uvs ? { uvs: entry.uvs.map((uv) => [...uv]) } : {}),
    ...(entry.textureTriangles ? {
      textureTriangles: entry.textureTriangles.map((triangle) => ({
        vertices: triangle.indices.map((index) => quakePickupVertex(frame.vertices[index])),
        uvs: triangle.uvs.map((uv) => [...uv]),
      })),
    } : {}),
    ...(entry.data ? { data: { ...entry.data } } : {}),
  };
}

function quakeAliasTextureTrianglePlan(model, triangle) {
  return {
    indices: [...triangle.indices],
    uvs: triangle.indices.map((index) => quakeAliasUv(model, triangle, index)),
  };
}

function quakeAliasEdgeTriangleIndices(triangles) {
  const edgeTriangleIndices = new Map();
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex++) {
    for (const [a, b] of quakeAliasTriangleEdges(triangles[triangleIndex].indices)) {
      const key = quakeAliasEdgeKey(a, b);
      const triangleIndices = edgeTriangleIndices.get(key);
      if (triangleIndices) {
        triangleIndices.push(triangleIndex);
      } else {
        edgeTriangleIndices.set(key, [triangleIndex]);
      }
    }
  }
  return edgeTriangleIndices;
}

function quakeAliasTriangleEdges(indices) {
  return [
    [indices[0], indices[1]],
    [indices[1], indices[2]],
    [indices[2], indices[0]],
  ];
}

function quakeAliasEdgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function quakeAliasBoundaryIndexCycle(indicesA, indicesB) {
  const edgeCounts = new Map();
  const edgeEndpoints = new Map();
  for (const indices of [indicesA, indicesB]) {
    for (const [a, b] of quakeAliasTriangleEdges(indices)) {
      const key = quakeAliasEdgeKey(a, b);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      edgeEndpoints.set(key, [a, b]);
    }
  }

  const boundaryEdges = [...edgeCounts]
    .filter(([, count]) => count === 1)
    .map(([key]) => edgeEndpoints.get(key));
  if (boundaryEdges.length !== 4) return null;

  const adjacency = new Map();
  for (const [a, b] of boundaryEdges) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }
  if (adjacency.size !== 4 || [...adjacency.values()].some((neighbors) => neighbors.length !== 2)) {
    return null;
  }

  const start = Math.min(...adjacency.keys());
  const cycle = [start];
  let previous = null;
  let current = start;
  for (let step = 0; step < 3; step++) {
    const neighbors = [...adjacency.get(current)].sort((a, b) => a - b);
    const next = neighbors.find((index) => index !== previous);
    if (next === undefined || cycle.includes(next)) return null;
    cycle.push(next);
    previous = current;
    current = next;
  }
  return adjacency.get(current).includes(start) ? cycle : null;
}

function quakeAliasOrientMergedIndexOrder(model, triangleIndexA, triangleIndexB, indexOrder) {
  const frame = model.frames[0];
  const quadNormal = quakePolygonUnitNormal(
    indexOrder.map((index) => quakePickupVertex(frame.vertices[index])),
  );
  const triangleNormalA = quakeAliasTriangleUnitNormal(model, frame, triangleIndexA);
  const triangleNormalB = quakeAliasTriangleUnitNormal(model, frame, triangleIndexB);
  if (!quadNormal || !triangleNormalA || !triangleNormalB) return indexOrder;
  const referenceNormal = quakeVectorNormalize([
    triangleNormalA[0] + triangleNormalB[0],
    triangleNormalA[1] + triangleNormalB[1],
    triangleNormalA[2] + triangleNormalB[2],
  ]);
  if (!referenceNormal || quakeVectorDot(quadNormal, referenceNormal) >= 0) return indexOrder;
  return [indexOrder[0], indexOrder[3], indexOrder[2], indexOrder[1]];
}

function quakeAliasMergedPolygonFramesAreSafe(model, triangleIndexA, triangleIndexB, indexOrder) {
  for (const frame of model.frames) {
    const vertices = indexOrder.map((index) => quakePickupVertex(frame.vertices[index]));
    if (!quakeQuadPlanarEnough(vertices) || !quakeQuadConvexEnough(vertices)) return false;
    const quadNormal = quakePolygonUnitNormal(vertices);
    const triangleNormalA = quakeAliasTriangleUnitNormal(model, frame, triangleIndexA);
    const triangleNormalB = quakeAliasTriangleUnitNormal(model, frame, triangleIndexB);
    if (!quadNormal || !triangleNormalA || !triangleNormalB) return false;
    if (quakeVectorDot(quadNormal, triangleNormalA) <= 0 || quakeVectorDot(quadNormal, triangleNormalB) <= 0) {
      return false;
    }
  }
  return true;
}

function quakeAliasMergedPolygonFramesShareAffineShape(model, indexOrder) {
  const baseFrame = model.frames[0];
  if (!baseFrame) return false;
  const baseVertices = indexOrder.map((index) => quakePickupVertex(baseFrame.vertices[index]));
  const fourthVertexCoords = quakeAffineCoordsInTriangle(
    baseVertices[0],
    baseVertices[1],
    baseVertices[2],
    baseVertices[3],
  );
  if (!fourthVertexCoords) return false;

  for (const frame of model.frames) {
    const vertices = indexOrder.map((index) => quakePickupVertex(frame.vertices[index]));
    const predicted = [
      vertices[0][0] +
        (vertices[1][0] - vertices[0][0]) * fourthVertexCoords[0] +
        (vertices[2][0] - vertices[0][0]) * fourthVertexCoords[1],
      vertices[0][1] +
        (vertices[1][1] - vertices[0][1]) * fourthVertexCoords[0] +
        (vertices[2][1] - vertices[0][1]) * fourthVertexCoords[1],
      vertices[0][2] +
        (vertices[1][2] - vertices[0][2]) * fourthVertexCoords[0] +
        (vertices[2][2] - vertices[0][2]) * fourthVertexCoords[1],
    ];
    if (quakeVectorDistance(predicted, vertices[3]) > QUAKE_ALIAS_REBAKE_MERGE_AFFINE_EPSILON) {
      return false;
    }
  }
  return true;
}

function quakeAffineCoordsInTriangle(a, b, c, point) {
  const ab = quakeVectorSubtract(b, a);
  const ac = quakeVectorSubtract(c, a);
  const ap = quakeVectorSubtract(point, a);
  const abAb = quakeVectorDot(ab, ab);
  const abAc = quakeVectorDot(ab, ac);
  const acAc = quakeVectorDot(ac, ac);
  const apAb = quakeVectorDot(ap, ab);
  const apAc = quakeVectorDot(ap, ac);
  const determinant = abAb * acAc - abAc * abAc;
  if (Math.abs(determinant) <= QUAKE_ALIAS_MERGE_GEOMETRY_EPSILON) return null;
  return [
    (apAb * acAc - apAc * abAc) / determinant,
    (apAc * abAb - apAb * abAc) / determinant,
  ];
}

function quakeAliasTriangleUnitNormal(model, frame, triangleIndex) {
  const triangle = model.triangles[triangleIndex];
  return quakePolygonUnitNormal(triangle.indices.map((index) => quakePickupVertex(frame.vertices[index])));
}

function quakeQuadPlanarEnough(vertices) {
  const normal = quakePolygonUnitNormal(vertices);
  if (!normal) return false;
  const distance = Math.abs(quakeVectorDot(quakeVectorSubtract(vertices[3], vertices[0]), normal));
  return distance <= QUAKE_ALIAS_MERGE_MAX_NONPLANAR_DISTANCE;
}

function quakeQuadConvexEnough(vertices) {
  const normal = quakePolygonUnitNormal(vertices);
  if (!normal) return false;
  const normalAxis = normal.map((value) => Math.abs(value));
  const dropAxis = normalAxis[0] >= normalAxis[1] && normalAxis[0] >= normalAxis[2]
    ? 0
    : normalAxis[1] >= normalAxis[2] ? 1 : 2;
  const points = vertices.map((vertex) => {
    if (dropAxis === 0) return [vertex[1], vertex[2]];
    if (dropAxis === 1) return [vertex[0], vertex[2]];
    return [vertex[0], vertex[1]];
  });

  let sign = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const crossZ = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(crossZ) <= QUAKE_ALIAS_MERGE_GEOMETRY_EPSILON) continue;
    const currentSign = Math.sign(crossZ);
    if (sign !== 0 && currentSign !== sign) return false;
    sign = currentSign;
  }
  return sign !== 0;
}

function quakePolygonUnitNormal(vertices) {
  if (vertices.length < 3) return null;
  const normal = quakeVectorCross(
    quakeVectorSubtract(vertices[1], vertices[0]),
    quakeVectorSubtract(vertices[2], vertices[0]),
  );
  return quakeVectorNormalize(normal);
}

function quakeVectorSubtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function quakeVectorCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function quakeVectorDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function quakeVectorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function quakeVectorNormalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= QUAKE_ALIAS_MERGE_GEOMETRY_EPSILON) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function quakeAliasSameUv(a, b) {
  return Math.abs(a[0] - b[0]) <= QUAKE_ALIAS_MERGE_UV_EPSILON &&
    Math.abs(a[1] - b[1]) <= QUAKE_ALIAS_MERGE_UV_EPSILON;
}

function quakeAliasTwoSidedTriangleIndices(model) {
  const edgeTriangleIndices = new Map();
  for (let triangleIndex = 0; triangleIndex < model.triangles.length; triangleIndex++) {
    const indices = model.triangles[triangleIndex].indices;
    for (const [a, b] of [
      [indices[0], indices[1]],
      [indices[1], indices[2]],
      [indices[2], indices[0]],
    ]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const triangleIndices = edgeTriangleIndices.get(key);
      if (triangleIndices) {
        triangleIndices.push(triangleIndex);
      } else {
        edgeTriangleIndices.set(key, [triangleIndex]);
      }
    }
  }

  const twoSidedTriangleIndices = new Set();
  for (const triangleIndices of edgeTriangleIndices.values()) {
    if (triangleIndices.length === 2) continue;
    for (const triangleIndex of triangleIndices) twoSidedTriangleIndices.add(triangleIndex);
  }
  return twoSidedTriangleIndices;
}

function polygonBounds(polygons) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      min[0] = Math.min(min[0], vertex[0]);
      min[1] = Math.min(min[1], vertex[1]);
      min[2] = Math.min(min[2], vertex[2]);
      max[0] = Math.max(max[0], vertex[0]);
      max[1] = Math.max(max[1], vertex[1]);
      max[2] = Math.max(max[2], vertex[2]);
    }
  }
  return {
    min: min.map((value) => Number.isFinite(value) ? value : 0),
    max: max.map((value) => Number.isFinite(value) ? value : 0),
  };
}

function quakeAliasUv(model, triangle, index) {
  const texcoord = model.texcoords[index];
  const s = !triangle.facesfront && texcoord.onseam ? texcoord.s + model.skinWidth / 2 : texcoord.s;
  return [(s + 0.5) / model.skinWidth, 1 - (texcoord.t + 0.5) / model.skinHeight];
}

// Alias skins can contain bright filler outside UV islands; pad from real UV pixels before atlas bleed samples it.
function quakeAliasPaddedSkin(model, radius = QUAKE_ALIAS_SKIN_PADDING_RADIUS) {
  if (radius <= 0) return model.skin;
  const mask = new Uint8Array(model.skinWidth * model.skinHeight);
  for (const triangle of model.triangles) markQuakeAliasSkinTriangle(mask, model, triangle);
  const padded = dilateIndexedPixels(model.skin, model.skinWidth, model.skinHeight, mask, radius);
  return replaceIndexedFillerPixels(padded, model.skinWidth, model.skinHeight, QUAKE_ALIAS_SKIN_FILLER_INDEX);
}

function markQuakeAliasSkinTriangle(mask, model, triangle) {
  const points = triangle.indices.map((index) => quakeAliasSkinPoint(model, triangle, index));
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point[0]))));
  const maxX = Math.min(model.skinWidth - 1, Math.ceil(Math.max(...points.map((point) => point[0]))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))));
  const maxY = Math.min(model.skinHeight - 1, Math.ceil(Math.max(...points.map((point) => point[1]))));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (pointInTriangle2d(x, y, points)) mask[y * model.skinWidth + x] = 1;
    }
  }
  for (let index = 0; index < points.length; index++) {
    markQuakeAliasSkinLine(mask, model.skinWidth, model.skinHeight, points[index], points[(index + 1) % points.length]);
  }
}

function quakeAliasSkinPoint(model, triangle, index) {
  const texcoord = model.texcoords[index];
  const s = !triangle.facesfront && texcoord.onseam ? texcoord.s + model.skinWidth / 2 : texcoord.s;
  return [s, texcoord.t];
}

function markQuakeAliasSkinLine(mask, width, height, a, b) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const x = Math.round(a[0] + (b[0] - a[0]) * t);
    const y = Math.round(a[1] + (b[1] - a[1]) * t);
    if (x >= 0 && x < width && y >= 0 && y < height) mask[y * width + x] = 1;
  }
}

function pointInTriangle2d(x, y, points) {
  const [a, b, c] = points;
  const ab = signedTriangleEdge(x, y, a, b);
  const bc = signedTriangleEdge(x, y, b, c);
  const ca = signedTriangleEdge(x, y, c, a);
  const hasNegative = ab < -1e-6 || bc < -1e-6 || ca < -1e-6;
  const hasPositive = ab > 1e-6 || bc > 1e-6 || ca > 1e-6;
  return !(hasNegative && hasPositive);
}

function signedTriangleEdge(x, y, a, b) {
  return (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
}

function dilateIndexedPixels(pixels, width, height, sourceMask, radius) {
  const out = Uint8Array.from(pixels);
  let filled = Uint8Array.from(sourceMask);
  for (let pass = 0; pass < radius; pass++) {
    const nextFilled = Uint8Array.from(filled);
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (filled[index]) continue;
        const sourceIndex = nearestFilledNeighborIndex(filled, width, height, x, y);
        if (sourceIndex === -1) continue;
        out[index] = out[sourceIndex];
        nextFilled[index] = 1;
        changed = true;
      }
    }
    if (!changed) break;
    filled = nextFilled;
  }
  return out;
}

function nearestFilledNeighborIndex(filled, width, height, x, y) {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const index = ny * width + nx;
      if (!filled[index]) continue;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }
  return bestIndex;
}

function replaceIndexedFillerPixels(pixels, width, height, fillerIndex) {
  const out = Uint8Array.from(pixels);
  let filler = new Uint8Array(out.length);
  let remaining = 0;
  for (let index = 0; index < out.length; index++) {
    if (out[index] !== fillerIndex) continue;
    filler[index] = 1;
    remaining++;
  }
  while (remaining > 0) {
    const nextFiller = Uint8Array.from(filler);
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (!filler[index]) continue;
        const sourceIndex = nearestNonFillerNeighborIndex(filler, width, height, x, y);
        if (sourceIndex === -1) continue;
        out[index] = out[sourceIndex];
        nextFiller[index] = 0;
        remaining--;
        changed = true;
      }
    }
    if (!changed) break;
    filler = nextFiller;
  }
  return out;
}

function nearestNonFillerNeighborIndex(filler, width, height, x, y) {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const index = ny * width + nx;
      if (filler[index]) continue;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }
  return bestIndex;
}

function drawQpic(rgba, assets, name, x, y, transparentIndex) {
  drawWadQpicTo(rgba, assets, name, x, y, QUAKE_HUD_WIDTH, QUAKE_HUD_HEIGHT, transparentIndex);
}

function drawWadQpicTo(rgba, assets, name, x, y, targetWidth, targetHeight, transparentIndex) {
  const lump = assets.lumps.get(name);
  if (!lump || lump.type !== 66) throw new Error(`Missing Quake qpic ${name}.`);
  const width = assets.wad.readInt32LE(lump.filepos);
  const height = assets.wad.readInt32LE(lump.filepos + 4);
  const dataOffset = lump.filepos + 8;
  drawIndexedImage(
    rgba,
    assets.palette,
    assets.wad,
    dataOffset,
    width,
    height,
    x,
    y,
    targetWidth,
    targetHeight,
    transparentIndex,
  );
}

function drawPakQpic(rgba, assets, pakPath, x, y, targetWidth, targetHeight, transparentIndex) {
  const entry = assets.entries.get(pakPath);
  if (!entry) throw new Error(`Missing Quake qpic ${pakPath}.`);
  const width = assets.pak.readInt32LE(entry.offset);
  const height = assets.pak.readInt32LE(entry.offset + 4);
  const dataOffset = entry.offset + 8;
  drawIndexedImage(
    rgba,
    assets.palette,
    assets.pak,
    dataOffset,
    width,
    height,
    x,
    y,
    targetWidth,
    targetHeight,
    transparentIndex,
  );
}

function drawIndexedImage(
  rgba,
  palette,
  indexed,
  dataOffset,
  width,
  height,
  x,
  y,
  targetWidth,
  targetHeight,
  transparentIndex,
) {
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const colorIndex = indexed.readUInt8(dataOffset + row * width + col);
      if (transparentIndex !== undefined && colorIndex === transparentIndex) continue;
      setIndexedPixel(rgba, targetWidth, targetHeight, palette, x + col, y + row, colorIndex);
    }
  }
}

function drawPakQpicCrop(
  rgba,
  assets,
  pakPath,
  sourceX,
  sourceY,
  sourceWidth,
  sourceHeight,
  x,
  y,
  targetWidth,
  targetHeight,
  transparentIndex,
) {
  const entry = assets.entries.get(pakPath);
  if (!entry) throw new Error(`Missing Quake qpic ${pakPath}.`);
  const width = assets.pak.readInt32LE(entry.offset);
  const height = assets.pak.readInt32LE(entry.offset + 4);
  const dataOffset = entry.offset + 8;
  const maxX = Math.min(width, sourceX + sourceWidth);
  const maxY = Math.min(height, sourceY + sourceHeight);
  for (let row = sourceY; row < maxY; row++) {
    for (let col = sourceX; col < maxX; col++) {
      const colorIndex = assets.pak.readUInt8(dataOffset + row * width + col);
      if (transparentIndex !== undefined && colorIndex === transparentIndex) continue;
      setIndexedPixel(
        rgba,
        targetWidth,
        targetHeight,
        assets.palette,
        x + col - sourceX,
        y + row - sourceY,
        colorIndex,
      );
    }
  }
}

function tileWadQpic(rgba, assets, name, x, y, width, height) {
  const lump = assets.lumps.get(name);
  if (!lump || lump.type !== 66) throw new Error(`Missing Quake qpic ${name}.`);
  const sourceWidth = assets.wad.readInt32LE(lump.filepos);
  const sourceHeight = assets.wad.readInt32LE(lump.filepos + 4);
  for (let row = y; row < y + height; row += sourceHeight) {
    for (let col = x; col < x + width; col += sourceWidth) {
      drawWadQpicTo(rgba, assets, name, col, row, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT);
    }
  }
}

function drawPakBox(rgba, assets, x, y, width, height) {
  fillIndexedRect(rgba, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, assets.palette, x + 8, y + 8, width - 16, height - 16, 0, 156);
  drawPakQpic(rgba, assets, "gfx/box_tl.lmp", x, y, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawPakQpic(rgba, assets, "gfx/box_tr.lmp", x + width - 8, y, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawPakQpic(rgba, assets, "gfx/box_bl.lmp", x, y + height - 8, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawPakQpic(rgba, assets, "gfx/box_br.lmp", x + width - 8, y + height - 8, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, QUAKE_HUD_TRANSPARENT);

  for (let col = x + 8; col < x + width - 8; col += 16) {
    drawPakQpic(rgba, assets, "gfx/box_tm.lmp", col, y, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, QUAKE_HUD_TRANSPARENT);
    drawPakQpic(rgba, assets, "gfx/box_bm.lmp", col, y + height - 8, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, QUAKE_HUD_TRANSPARENT);
  }

  for (let row = y + 8; row < y + height - 8; row += 8) {
    drawPakQpic(rgba, assets, "gfx/box_ml.lmp", x, row, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, QUAKE_HUD_TRANSPARENT);
    drawPakQpic(rgba, assets, "gfx/box_mr.lmp", x + width - 8, row, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT, QUAKE_HUD_TRANSPARENT);
  }
}

function drawConcharsCentered(rgba, assets, text, y, alt) {
  drawConcharsText(rgba, assets, text, Math.round((QUAKE_ABOUT_WIDTH - text.length * 8) / 2), y, alt);
}

function drawConcharsText(rgba, assets, text, x, y, alt) {
  let cursorX = x;
  for (const char of text) {
    if (char !== " ") drawConchar(rgba, assets, char, cursorX, y, alt);
    cursorX += 8;
  }
}

function drawConcharsTextScaled(rgba, assets, text, x, y, alt, scale, targetWidth, targetHeight) {
  let cursorX = x;
  for (const char of text) {
    if (char !== " ") drawConcharScaled(rgba, assets, char, cursorX, y, alt, scale, targetWidth, targetHeight);
    cursorX += 8 * scale;
  }
}

function drawConchar(rgba, assets, char, x, y, alt) {
  drawConcharScaled(rgba, assets, char, x, y, alt, 1, QUAKE_ABOUT_WIDTH, QUAKE_ABOUT_HEIGHT);
}

function drawConcharScaled(rgba, assets, char, x, y, alt, scale, targetWidth, targetHeight) {
  const lump = assets.lumps.get("conchars");
  if (!lump || lump.type !== 68) throw new Error("Missing Quake CONCHARS.");
  const glyph = (char.charCodeAt(0) & 127) + (alt ? 128 : 0);
  const sourceX = (glyph & 15) * 8;
  const sourceY = (glyph >> 4) * 8;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const colorIndex = assets.wad.readUInt8(lump.filepos + (sourceY + row) * 128 + sourceX + col);
      if (colorIndex === 0) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          setIndexedPixel(
            rgba,
            targetWidth,
            targetHeight,
            assets.palette,
            x + col * scale + dx,
            y + row * scale + dy,
            colorIndex,
          );
        }
      }
    }
  }
}

function drawNumber(rgba, assets, x, y, value, digits) {
  const text = String(Math.trunc(value));
  const clipped = text.length > digits ? text.slice(text.length - digits) : text;
  let cursorX = x + Math.max(0, digits - clipped.length) * 24;
  for (const char of clipped) {
    const name = char === "-" ? "num_minus" : `num_${char}`;
    drawQpic(rgba, assets, name, cursorX, y, QUAKE_HUD_TRANSPARENT);
    cursorX += 24;
  }
}

function setIndexedPixel(rgba, width, height, palette, x, y, colorIndex) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const paletteOffset = colorIndex * 3;
  const imageOffset = (y * width + x) * 4;
  rgba[imageOffset] = palette[paletteOffset] ?? 0;
  rgba[imageOffset + 1] = palette[paletteOffset + 1] ?? 0;
  rgba[imageOffset + 2] = palette[paletteOffset + 2] ?? 0;
  rgba[imageOffset + 3] = 255;
}

function blendIndexedPixel(rgba, width, height, palette, x, y, colorIndex, alpha) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const paletteOffset = colorIndex * 3;
  const imageOffset = (y * width + x) * 4;
  const sourceAlpha = alpha / 255;
  rgba[imageOffset] = clampByte((palette[paletteOffset] ?? 0) * sourceAlpha + rgba[imageOffset] * (1 - sourceAlpha));
  rgba[imageOffset + 1] = clampByte((palette[paletteOffset + 1] ?? 0) * sourceAlpha + rgba[imageOffset + 1] * (1 - sourceAlpha));
  rgba[imageOffset + 2] = clampByte((palette[paletteOffset + 2] ?? 0) * sourceAlpha + rgba[imageOffset + 2] * (1 - sourceAlpha));
  rgba[imageOffset + 3] = 255;
}

function fillIndexedRect(rgba, width, height, palette, x, y, w, h, colorIndex, alpha = 255) {
  const minX = Math.max(0, x);
  const minY = Math.max(0, y);
  const maxX = Math.min(width, x + w);
  const maxY = Math.min(height, y + h);
  for (let row = minY; row < maxY; row++) {
    for (let col = minX; col < maxX; col++) {
      if (alpha >= 255) setIndexedPixel(rgba, width, height, palette, col, row, colorIndex);
      else blendIndexedPixel(rgba, width, height, palette, col, row, colorIndex, alpha);
    }
  }
}

function dimIndexedPixels(rgba, width, height, x, y, w, h, factor) {
  const minX = Math.max(0, x);
  const minY = Math.max(0, y);
  const maxX = Math.min(width, x + w);
  const maxY = Math.min(height, y + h);
  for (let row = minY; row < maxY; row++) {
    for (let col = minX; col < maxX; col++) {
      const offset = (row * width + col) * 4;
      if (rgba[offset + 3] === 0) continue;
      rgba[offset] = clampByte(rgba[offset] * factor);
      rgba[offset + 1] = clampByte(rgba[offset + 1] * factor);
      rgba[offset + 2] = clampByte(rgba[offset + 2] * factor);
    }
  }
}

function clearPixels(rgba, width, height, x, y, w, h) {
  const minX = Math.max(0, x);
  const minY = Math.max(0, y);
  const maxX = Math.min(width, x + w);
  const maxY = Math.min(height, y + h);
  for (let row = minY; row < maxY; row++) {
    for (let col = minX; col < maxX; col++) {
      rgba.fill(0, (row * width + col) * 4, (row * width + col) * 4 + 4);
    }
  }
}

function readFixedString(buffer, offset, length) {
  let out = "";
  for (let i = 0; i < length; i++) {
    const code = buffer[offset + i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function readNullTerminatedString(buffer, offset) {
  let out = "";
  for (let i = offset; i < buffer.length; i++) {
    const code = buffer[i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

async function encodeTextureFileUrl(input) {
  const png = await encodeTexturePng(input);
  const hash = createHash("sha256").update(png).digest("hex");
  const cached = textureFileUrlByHash.get(hash);
  if (cached) return cached;
  const filename = `${hash}.png`;
  const url = `${quakeTexturePublicPath}/${filename}`;
  texturePngByPublicPath.set(url, png);
  textureFileUrlByHash.set(hash, url);
  return url;
}

async function writeTextureFileIfMissing(outputPath, png) {
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, png, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function encodeTexturePng({ width, height, pixels, palette, brightness, alpha, rgba: sourceRgba }) {
  if (sourceRgba) {
    return sharp(sourceRgba, {
      raw: { width, height, channels: 4 },
    }).png().toBuffer();
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const paletteIndex = pixels[i] ?? 0;
    const [r, g, b] = paletteRgbAt(palette, paletteIndex);
    const light = paletteIndex >= 224 ? 1 : brightness;
    const offset = i * 4;
    rgba[offset] = clampByte(r * light);
    rgba[offset + 1] = clampByte(g * light);
    rgba[offset + 2] = clampByte(b * light);
    rgba[offset + 3] = alpha?.[i] ?? 255;
  }
  const png = await sharp(rgba, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  return png;
}

function paletteRgbAt(palette, paletteIndex) {
  const entry = palette[paletteIndex];
  if (Array.isArray(entry)) return entry;
  const offset = paletteIndex * 3;
  return [
    palette[offset] ?? 0,
    palette[offset + 1] ?? 0,
    palette[offset + 2] ?? 0,
  ];
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
