import { build } from "esbuild";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { path7z } = require("7z-bin");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "../..");
const generatedPublicDir = path.join(projectRoot, "build/generated/public");
const quakePublicPath = "/q";
const quakeTexturePublicPath = `${quakePublicPath}/t`;
const quakeRenderBundlePublicPath = `${quakePublicPath}/b`;
const quakeOutputDir = path.join(generatedPublicDir, quakePublicPath.slice(1));
const legacyQuakeOutputDir = path.join(generatedPublicDir, "local/quake");
const socialImageSourcePath = path.join(projectRoot, "src/assets/cssquake-social.png");
const socialImageOutputPath = path.join(generatedPublicDir, "assets/cssquake-social.png");
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
const hudNumbersOutputPath = path.join(quakeOutputDir, "hud-numbers.png");
const mainMenuOutputPath = path.join(quakeOutputDir, "main-menu.png");
const mainMenuActiveOutputPath = path.join(quakeOutputDir, "main-menu-active.png");
const mainMenuCursorOutputPath = path.join(quakeOutputDir, "main-menu-cursor.png");
const aboutOutputPath = path.join(quakeOutputDir, "about.png");
const menuPanelTextureOutputPath = path.join(quakeOutputDir, "menu-panel-texture.png");
const menuTitleOptionsOutputPath = path.join(quakeOutputDir, "menu-title-options.png");
const menuTitleHelpOutputPath = path.join(quakeOutputDir, "menu-title-help.png");
const concharsOutputPath = path.join(quakeOutputDir, "conchars.png");
const weaponOutputPath = path.join(quakeOutputDir, "weapon.json");
const pickupOutputPath = path.join(quakeOutputDir, "pickups.json");
const progsOutputPath = path.join(quakeOutputDir, "progs.json");
const soundManifestOutputPath = path.join(quakeOutputDir, "sounds.json");
const sourcePath = path.join(projectRoot, "src/prepare/scene.ts");
const textureOutputDir = path.join(quakeOutputDir, "t");
const soundOutputDir = path.join(quakeOutputDir, "s");
const renderBundleScriptPath = path.join(scriptDir, "bundle.mjs");
const renderBundleOutputDir = path.join(quakeOutputDir, "b");
const quakeRenderBundleAvifQuality = Number.parseInt(process.env.QUAKE_RENDER_BUNDLE_AVIF_QUALITY ?? "80", 10);
const quakeRenderBundleAvifEffort = Number.parseInt(process.env.QUAKE_RENDER_BUNDLE_AVIF_EFFORT ?? "4", 10);
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
const QUAKE_MENU_WIDTH = 320;
const QUAKE_MENU_HEIGHT = 200;
const QUAKE_ABOUT_WIDTH = 320;
const QUAKE_ABOUT_HEIGHT = 200;
const QUAKE_MENU_FRAME_COUNT = 6;
const QUAKE_MENU_CURSOR_WIDTH = 16;
const QUAKE_MENU_CURSOR_HEIGHT = 24;
const QUAKE_MAIN_MENU_ROW_TOPS = [28, 52, 76, 100, 126];
const QUAKE_MAIN_MENU_ACTIVE_FRAME_COUNT = 5;
const QUAKE_MAIN_MENU_LEVEL_LABEL = "LEVEL SELECT";
const QUAKE_MAIN_MENU_LEVEL_LABEL_SCALE = 2;
const QUAKE_PICKUP_MODEL_SCALE = 1 / 48;
const QUAKE_WEAPON_MODEL_PIVOT = [1.0, 0, 0];
const QUAKE_ENEMY_ALIAS_MODEL_RENDER_SCALE = 4;
const QUAKE_ANIMATION_FRAME_SET_MIN_COMMON_LEAF_RATIO = 0.95;
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
  "progs/dog.mdl",
  "progs/knight.mdl",
  "progs/ogre.mdl",
  "progs/soldier.mdl",
];
const QUAKE_PROJECTILE_ALIAS_MODEL_PATHS = [
  "progs/bolt.mdl",
  "progs/grenade.mdl",
  "progs/k_spike.mdl",
  "progs/laser.mdl",
  "progs/lavaball.mdl",
  "progs/v_spike.mdl",
  "progs/w_spike.mdl",
];
const QUAKE_MONSTER_PROJECTILE_MODEL_PATHS = {
  monster_hell_knight: "progs/k_spike.mdl",
  monster_ogre: "progs/grenade.mdl",
  monster_shalrath: "progs/v_spike.mdl",
  monster_wizard: "progs/w_spike.mdl",
};

const tempDir = await mkdtemp(path.join(tmpdir(), "polycss-quake-preparse-"));
const bundlePath = path.join(tempDir, "quakePreparedScene.bundle.mjs");
const renderBundleBuildPath = path.join(tempDir, "quakeRenderBundle.bundle.js");
const sharewareDownloadPath = path.join(tempDir, "quake-shareware-download");
const sharewareExtractDir = path.join(tempDir, "quake-shareware");
const resourcePath = path.join(tempDir, "resource.1");
const extractedPakPath = path.join(tempDir, "ID1/PAK0.PAK");
let renderBundleBuilder = null;
const textureFileUrlByHash = new Map();
const texturePngByPublicPath = new Map();

try {
  if (process.env.QUAKE_PAK_PATH?.trim()) {
    await copyQuakePakFromPath(process.env.QUAKE_PAK_PATH.trim());
  } else {
    await downloadQuakeResource();
    await verifyQuakeResource();
    await extractQuakePak();
  }
  await rm(legacyQuakeOutputDir, { recursive: true, force: true });
  await removeLegacyQuakeJsonFiles();
  await rm(textureOutputDir, { recursive: true, force: true });
  await rm(soundOutputDir, { recursive: true, force: true });
  await rm(renderBundleOutputDir, { recursive: true, force: true });
  await copyStaticPublicAssets();

  await build({
    entryPoints: [sourcePath],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    absWorkingDir: projectRoot,
    logLevel: "silent",
  });

  await build({
    entryPoints: [renderBundleScriptPath],
    outfile: renderBundleBuildPath,
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "QuakeRenderBundleEntry",
    absWorkingDir: projectRoot,
    logLevel: "silent",
  });
  renderBundleBuilder = await createQuakeRenderBundleBuilder(renderBundleBuildPath);

  const {
    buildQuakeLightstyleOverlayPolygons,
    createQuakeSceneFromPreparedScene,
    createQuakePreparedSceneFromPakBuffer,
    parseQuakePakDirectory,
  } = await import(pathToFileURL(bundlePath).href);
  const pak = await readFile(extractedPakPath);
  const buffer = pak.buffer.slice(pak.byteOffset, pak.byteOffset + pak.byteLength);

  const preparedMaps = [];
  const menuPanelTextureMaps = [];
  for (const [mapPath, outputPath] of mapOutputPaths) {
    const prepared = await createQuakePreparedSceneFromPakBuffer(buffer, {
      encodeTextureUrl: encodeTextureFileUrl,
      mapPath,
    });
    menuPanelTextureMaps.push({
      prepared: {
        label: prepared.label,
        textures: prepared.textures,
        polygons: prepared.polygons,
      },
    });
    const mapName = mapNameFromPakPath(mapPath);
    if (renderBundleMapNames.has(mapName)) {
      const scene = createQuakeSceneFromPreparedScene(prepared);
      prepared.renderBundle = await renderBundleBuilder.build({
        mapName,
        polygons: scene.polygons,
      });
      const lightstyleOverlayPolygons = buildQuakeLightstyleOverlayPolygons(scene.polygons);
      if (lightstyleOverlayPolygons.length) {
        prepared.lightstyleRenderBundle = await renderBundleBuilder.build({
          bundleName: `${mapName}-lightstyle`,
          polygons: lightstyleOverlayPolygons,
        });
      } else {
        delete prepared.lightstyleRenderBundle;
      }
      stripPreparedRenderBundleFallbackTextures(prepared);
    }
    const preparedJson = JSON.stringify(prepared);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, preparedJson);
    preparedMaps.push({ mapName, mapPath, outputPath, prepared, size: Buffer.byteLength(preparedJson) });
  }

  const uiAssets = loadQuakeHudAssets(pak, parseQuakePakDirectory);
  await writeFile(hudBaseOutputPath, await buildQuakeHudBasePng(uiAssets));
  await writeFile(hudNumbersOutputPath, await buildQuakeHudNumbersPng(uiAssets));
  await writeFile(hudOutputPath, await buildQuakeHudPng(uiAssets));
  await writeFile(mainMenuOutputPath, await buildQuakeMainMenuPng(uiAssets));
  await writeFile(mainMenuActiveOutputPath, await buildQuakeMainMenuActivePng(uiAssets));
  await writeFile(mainMenuCursorOutputPath, await buildQuakeMainMenuCursorPng(uiAssets));
  await writeFile(aboutOutputPath, await buildQuakeAboutPng(uiAssets));
  await writeFile(menuPanelTextureOutputPath, await buildQuakeMenuPanelTexturePng(menuPanelTextureMaps));
  await writeFile(menuTitleOptionsOutputPath, await buildPakQpicCropPng(uiAssets, "gfx/mainmenu.lmp", 0, 40, 124, 20));
  await writeFile(menuTitleHelpOutputPath, await buildPakQpicCropPng(uiAssets, "gfx/mainmenu.lmp", 1, 60, 75, 20));
  await writeFile(concharsOutputPath, await buildQuakeConcharsPng(uiAssets));
  const programMetadata = buildQuakeProgramMetadata(uiAssets);
  await writeFile(weaponOutputPath, JSON.stringify(await buildQuakeWeaponModel(uiAssets, renderBundleBuilder)));
  await writeFile(progsOutputPath, JSON.stringify(programMetadata));
  const pickupModels = await buildQuakePickupModels(
    uiAssets,
    async (mapPath) => createQuakeSceneFromPreparedScene(await createQuakePreparedSceneFromPakBuffer(buffer, {
      encodeTextureUrl: encodeTextureFileUrl,
      mapPath,
    })),
    programMetadata,
    renderBundleBuilder,
  );
  await writeFile(pickupOutputPath, JSON.stringify(pickupModels));
  const soundManifest = await exportQuakeSounds(pak, parseQuakePakDirectory);
  await writeFile(soundManifestOutputPath, JSON.stringify(soundManifest));
  await writeFile(manifestOutputPath, JSON.stringify(buildQuakeAssetManifest(
    preparedMaps,
    programMetadata,
    pickupModels,
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
  console.log(`Wrote ${path.relative(projectRoot, hudNumbersOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, hudOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, socialImageOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, mainMenuOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, mainMenuActiveOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, mainMenuCursorOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, aboutOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, menuPanelTextureOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, menuTitleOptionsOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, menuTitleHelpOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, concharsOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, weaponOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, progsOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, pickupOutputPath)}`);
  console.log(`Wrote ${path.relative(projectRoot, soundManifestOutputPath)} (${Object.keys(soundManifest.sounds).length} sounds)`);
  console.log(`Wrote ${path.relative(projectRoot, manifestOutputPath)}`);
} finally {
  await renderBundleBuilder?.close?.();
  await rm(tempDir, { recursive: true, force: true });
}

async function createQuakeRenderBundleBuilder(bundlePath) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => {
    console.error(error);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() === "document") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><head></head><body></body></html>",
      });
      return;
    }
    if (url.pathname.startsWith(`${quakeTexturePublicPath}/`)) {
      await route.fulfill({
        status: 200,
        contentType: contentTypeForPath(url.pathname),
        body: await readGeneratedPublicFile(url.pathname),
      });
      return;
    }
    await route.fulfill({ status: 404, body: "" });
  });
  await page.goto("http://quake-render-bundle.local/");
  await page.addScriptTag({ path: bundlePath });

  async function writeRenderBundleResult({
    name,
    result,
    styleClassName = "",
    startedAt,
    sharedAssets,
    writeStyle = true,
    includeLeafFrameStyles = false,
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
    const assetVariants = [];
    let writtenAssetCount = 0;
    let reusedAssetCount = 0;

    for (let index = 0; index < result.assets.length; index++) {
      const asset = result.assets[index];
      const buffer = Buffer.from(asset.base64, "base64");
      const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
      const assetKey = `${asset.mime}:${hash}`;
      let sharedAsset = sharedAssets?.get(assetKey);

      if (!sharedAsset) {
        const extension = mimeExtension(asset.mime);
        const filename = `atlas-${String(index).padStart(2, "0")}-${hash}.${extension}`;
        const outputPath = path.join(assetDir, filename);
        await writeFile(outputPath, buffer);
        const assetUrl = `${quakeRenderBundlePublicPath}/${name}/${filename}`;
        const variants = [];

        if (asset.mime === "image/webp") {
          const avifBuffer = await sharp(buffer)
            .avif({
              quality: normalizedQuakeRenderBundleAvifQuality(),
              effort: normalizedQuakeRenderBundleAvifEffort(),
              chromaSubsampling: "4:4:4",
            })
            .toBuffer();
          const avifHash = createHash("sha256").update(avifBuffer).digest("hex").slice(0, 12);
          const avifFilename = `atlas-${String(index).padStart(2, "0")}-${avifHash}.avif`;
          await writeFile(path.join(assetDir, avifFilename), avifBuffer);
          variants.push({
            sourceUrl: assetUrl,
            url: `${quakeRenderBundlePublicPath}/${name}/${avifFilename}`,
            mime: "image/avif",
          });
        }

        sharedAsset = { sourceUrl: assetUrl, variants };
        sharedAssets?.set(assetKey, sharedAsset);
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
      assetVariants.push(...sharedAsset.variants.map((variant) => ({ ...variant })));
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
      const hash = createHash("sha256").update(cssBuffer).digest("hex").slice(0, 12);
      const filename = `mesh-${hash}.css`;
      await writeFile(path.join(assetDir, filename), cssBuffer);
      styleUrl = `${quakeRenderBundlePublicPath}/${name}/${filename}`;
    }

    return {
      renderBundle: {
        version: 1,
        kind: "polycss-mesh",
        polycssVersion: polycssPackage.version,
        textureLighting: "baked",
        textureQuality: 1,
        meshHtml,
        ...(styleUrl ? { styleUrl } : {}),
        ...(styleClassName ? { styleClassName } : {}),
        assetUrls,
        ...(assetVariants.length ? { assetVariants } : {}),
        ...(includeLeafFrameStyles && leafFrameStylesByClass.length ? { leafFrameStylesByClass } : {}),
        leafMetadata: result.leafMetadata,
        polygonCount: result.polygonCount,
        leafCount: result.leafCount,
        atlasLeafCount: result.atlasLeafCount,
      },
      meshCss,
      writtenAssetCount,
      reusedAssetCount,
      elapsed: startedAt ? Date.now() - startedAt : 0,
    };
  }

  return {
    async build({ bundleName, mapName, polygons, textureQuality = 1, extractLeafStyles = false }) {
      const name = bundleName ?? mapName;
      if (!name) throw new Error("Render bundle build requires a bundleName or mapName.");
      const styleClassName = extractLeafStyles ? quakeRenderBundleStyleClassName(name) : "";
      const startedAt = Date.now();
      const result = await page.evaluate(
        async (input) => window.__buildQuakeRenderBundle(input),
        { polygons, textureQuality, extractLeafStyles, styleClassName },
      );
      const written = await writeRenderBundleResult({
        name,
        result,
        styleClassName,
        startedAt,
      });
      console.log(
        `Built render bundle for ${name}: ${result.leafCount} leaves, ` +
        `${written.writtenAssetCount} atlas assets in ${written.elapsed}ms`,
      );
      return written.renderBundle;
    },
    async buildAnimatedFrameSet({ bundleName, frames, textureQuality = 1, extractLeafStyles = true }) {
      if (!bundleName) throw new Error("Animated render bundle build requires a bundleName.");
      if (!Array.isArray(frames) || frames.length <= 1) {
        throw new Error(`Animated render bundle build for ${bundleName} requires multiple frames.`);
      }
      const frameInputs = frames.map((frame, index) => {
        const name = frame.bundleName ?? `${bundleName}/frame-${String(index).padStart(3, "0")}`;
        return {
          name,
          styleClassName: extractLeafStyles ? quakeRenderBundleStyleClassName(name) : "",
          polygons: frame.polygons,
        };
      });
      const startedAt = Date.now();
      const result = await page.evaluate(
        async (input) => window.__buildQuakeAnimatedRenderBundle(input),
        { frames: frameInputs, textureQuality, extractLeafStyles },
      );
      const sharedAssets = new Map();
      const frameBundles = [];
      let writtenAssetCount = 0;
      let reusedAssetCount = 0;
      for (const frameResult of result.frames) {
        const written = await writeRenderBundleResult({
          name: frameResult.name,
          result: frameResult,
          styleClassName: frameResult.styleClassName,
          sharedAssets,
          writeStyle: false,
          includeLeafFrameStyles: true,
        });
        writtenAssetCount += written.writtenAssetCount;
        reusedAssetCount += written.reusedAssetCount;
        frameBundles.push(written.renderBundle);
      }
      const elapsed = Date.now() - startedAt;
      const firstFrame = result.frames[0];
      console.log(
        `Built animated render bundle for ${bundleName}: ${result.frames.length} frames, ` +
        `${firstFrame?.leafCount ?? 0} leaves, ${writtenAssetCount} atlas assets ` +
        `(${reusedAssetCount} reused) in ${elapsed}ms`,
      );
      return frameBundles;
    },
    close: () => browser.close(),
  };
}

function quakeRenderBundleStyleClassName(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "bundle";
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `qrb-${slug}-${hash}`;
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

function mimeExtension(mime) {
  if (mime === "image/avif") return "avif";
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  return "png";
}

function contentTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".avif") return "image/avif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
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

function buildQuakeAssetManifest(preparedMaps, programMetadata, pickupModels) {
  const preparedModelPaths = new Set(Object.keys(pickupModels?.models ?? {}));
  const maps = preparedMaps.map(({ mapName, mapPath, outputPath }) => ({
    mapName,
    title: quakeMapTitles.get(mapName) ?? mapName.toUpperCase(),
    pakPath: mapPath,
    sceneUrl: generatedPublicUrl(outputPath),
    selectable: quakeSelectableMapNames.has(mapName),
    modelPaths: quakeMapModelPaths(outputPath, preparedMaps, programMetadata)
      .filter((modelPath) => preparedModelPaths.has(modelPath)),
  }));
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
  await mkdir(path.dirname(socialImageOutputPath), { recursive: true });
  await copyFile(socialImageSourcePath, socialImageOutputPath);
}

async function removeLegacyQuakeJsonFiles() {
  await Promise.all([
    ...quakeMapNames.map((mapName) => rm(path.join(quakeOutputDir, `${mapName}.preparsed.json`), { force: true })),
    rm(path.join(quakeOutputDir, "weapon-shotgun.preparsed.json"), { force: true }),
    rm(path.join(quakeOutputDir, "pickups.preparsed.json"), { force: true }),
    rm(path.join(quakeOutputDir, "progs.preparsed.json"), { force: true }),
  ]);
}

async function pruneUnreferencedTextureFiles(jsonPaths) {
  let files;
  try {
    files = await readdir(textureOutputDir);
  } catch {
    return;
  }

  const referenced = new Set();
  const textureUrlPattern = /\/q\/t\/([^"'\\)\s]+)/g;
  for (const jsonPath of jsonPaths) {
    const text = await readFile(jsonPath, "utf8");
    for (const match of text.matchAll(textureUrlPattern)) {
      if (match[1]) referenced.add(match[1]);
    }
  }

  let removed = 0;
  for (const file of files) {
    if (referenced.has(file)) continue;
    await rm(path.join(textureOutputDir, file), { force: true });
    removed++;
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

async function buildQuakeHudNumbersPng(assets) {
  const width = 24 * 10;
  const height = 24;
  const rgba = Buffer.alloc(width * height * 4);
  for (let digit = 0; digit <= 9; digit++) {
    drawWadQpicTo(rgba, assets, `num_${digit}`, digit * 24, 0, width, height, QUAKE_HUD_TRANSPARENT);
  }
  return sharp(rgba, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
}

async function buildQuakeHudBasePng(assets) {
  const rgba = Buffer.alloc(QUAKE_HUD_WIDTH * QUAKE_HUD_HEIGHT * 4);
  drawQpic(rgba, assets, "sbar", 0, 0);
  return sharp(rgba, {
    raw: { width: QUAKE_HUD_WIDTH, height: QUAKE_HUD_HEIGHT, channels: 4 },
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

  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 0, 240, 20, 72, QUAKE_MAIN_MENU_ROW_TOPS[0], QUAKE_MENU_WIDTH, QUAKE_MENU_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawMainMenuLevelSelectLabel(rgba, assets, 0, QUAKE_MENU_WIDTH);
  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 40, 124, 20, 72, QUAKE_MAIN_MENU_ROW_TOPS[2], QUAKE_MENU_WIDTH, QUAKE_MENU_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 1, 60, 75, 20, 72, QUAKE_MAIN_MENU_ROW_TOPS[3], QUAKE_MENU_WIDTH, QUAKE_MENU_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 84, 70, 20, 72, QUAKE_MAIN_MENU_ROW_TOPS[4], QUAKE_MENU_WIDTH, QUAKE_MENU_HEIGHT, QUAKE_HUD_TRANSPARENT);

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

async function buildQuakeMainMenuActivePng(assets) {
  const width = QUAKE_MENU_WIDTH * QUAKE_MAIN_MENU_ACTIVE_FRAME_COUNT;
  const rgba = Buffer.alloc(width * QUAKE_MENU_HEIGHT * 4);

  drawPakQpicCrop(rgba, assets, "gfx/mainmenu.lmp", 0, 0, 240, 20, 72, QUAKE_MAIN_MENU_ROW_TOPS[0], width, QUAKE_MENU_HEIGHT, QUAKE_HUD_TRANSPARENT);
  drawMainMenuLevelSelectLabel(rgba, assets, QUAKE_MENU_WIDTH, width);
  drawPakQpicCrop(
    rgba,
    assets,
    "gfx/mainmenu.lmp",
    0,
    40,
    124,
    20,
    QUAKE_MENU_WIDTH * 2 + 72,
    QUAKE_MAIN_MENU_ROW_TOPS[2],
    width,
    QUAKE_MENU_HEIGHT,
    QUAKE_HUD_TRANSPARENT,
  );
  drawPakQpicCrop(
    rgba,
    assets,
    "gfx/mainmenu.lmp",
    1,
    60,
    75,
    20,
    QUAKE_MENU_WIDTH * 3 + 72,
    QUAKE_MAIN_MENU_ROW_TOPS[3],
    width,
    QUAKE_MENU_HEIGHT,
    QUAKE_HUD_TRANSPARENT,
  );
  drawPakQpicCrop(
    rgba,
    assets,
    "gfx/mainmenu.lmp",
    0,
    84,
    70,
    20,
    QUAKE_MENU_WIDTH * 4 + 72,
    QUAKE_MAIN_MENU_ROW_TOPS[4],
    width,
    QUAKE_MENU_HEIGHT,
    QUAKE_HUD_TRANSPARENT,
  );

  return sharp(rgba, {
    raw: { width, height: QUAKE_MENU_HEIGHT, channels: 4 },
  }).png().toBuffer();
}

function drawMainMenuLevelSelectLabel(rgba, assets, frameX, targetWidth) {
  const scale = QUAKE_MAIN_MENU_LEVEL_LABEL_SCALE;
  const x = frameX + 72;
  const y = QUAKE_MAIN_MENU_ROW_TOPS[1] + Math.round((20 - 8 * scale) / 2);
  drawConcharsTextScaled(
    rgba,
    assets,
    QUAKE_MAIN_MENU_LEVEL_LABEL,
    x,
    y,
    true,
    scale,
    targetWidth,
    QUAKE_MENU_HEIGHT,
  );
}

async function buildPakQpicCropPng(assets, pakPath, sourceX, sourceY, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  drawPakQpicCrop(rgba, assets, pakPath, sourceX, sourceY, width, height, 0, 0, width, height, QUAKE_HUD_TRANSPARENT);
  return sharp(rgba, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
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
  const textureNames = [
    "wbrick1_5",
    "wiz1_4",
    "stone1_3",
    "wizmet1_2",
  ];
  for (const textureName of textureNames) {
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
  return readGeneratedPublicFile(texture);
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
    pixels: model.skin,
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

  return {
    source: modelPath,
    renderBundle: await renderBundleBuilder.build({
      bundleName: "weapon-shotgun",
      polygons: anchorQuakeWeaponPolygons(polygons),
      extractLeafStyles: true,
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

async function buildQuakePickupModels(assets, buildBspModel, programMetadata, renderBundleBuilder) {
  const models = {};
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
  const aliasModelPaths = new Set([
    ...animatedAliasModelPaths,
    ...enemyAliasModelPaths,
    ...projectileAliasModelPaths,
  ]);
  const bspModelPaths = new Set([
    ...QUAKE_PICKUP_BSP_MODEL_PATHS,
    ...programPickupModels.filter((model) => model.endsWith(".bsp")),
  ].filter((model) => assets.entries.has(model)));
  for (const source of aliasModelPaths) {
    const model = parseQuakeAliasModel(assets, source);
    if (!model.frames[0]) throw new Error(`${source} has no frames.`);
    const texture = await encodeTextureFileUrl({
      width: model.skinWidth,
      height: model.skinHeight,
      pixels: model.skin,
      palette: assets.palette,
      brightness: 1.22,
    });
    const includeAnimationFrames = animatedAliasModelPaths.has(source) || animatedMonsterAliasModelPaths.has(source);
    const renderScale = enemyAliasModelPaths.has(source) ? QUAKE_ENEMY_ALIAS_MODEL_RENDER_SCALE : 1;
    const animationFrames = model.frames.map((frame) => ({
      name: frame.name,
      polygons: model.triangles.map((triangle) => ({
        vertices: triangle.indices.map((index) => quakePickupVertex(frame.vertices[index])),
        uvs: triangle.indices.map((index) => quakeAliasUv(model, triangle, index)),
      })),
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
      ...(includeAnimationFrames && renderAnimationFrames.length > 1 ? { animationFrames: renderAnimationFrames } : {}),
      ...(renderScale !== 1 ? { renderScale } : {}),
      bounds: polygonBounds(animationFrames[0].polygons),
    };
    await addQuakePickupModelRenderBundles(prepared, renderBundleBuilder);
    if (!hasRenderableQuakePickupModelBundle(prepared)) continue;
    stripQuakePickupModelFallbackGeometry(prepared);
    models[source] = prepared;
  }
  for (const source of bspModelPaths) {
    const model = await buildBspModel(source);
    const polygons = model.polygons;
    const prepared = {
      source,
      polygons,
      bounds: polygonBounds(polygons),
    };
    await addQuakePickupModelRenderBundles(prepared, renderBundleBuilder);
    stripQuakePickupModelFallbackGeometry(prepared);
    models[source] = prepared;
  }
  return { models };
}

function hasRenderableQuakePickupModelBundle(model) {
  const bundles = model.animationFrames?.map((frame) => frame.renderBundle) ?? [model.renderBundle];
  return bundles.some((bundle) => Number(bundle?.leafCount) > 0 || bundle?.meshHtml?.includes("<s"));
}

async function addQuakePickupModelRenderBundles(model, renderBundleBuilder, textureQuality = 1) {
  const baseName = quakeModelBundleName(model.source);
  if (model.animationFrames?.length > 1) {
    const frameBundles = await renderBundleBuilder.buildAnimatedFrameSet({
      bundleName: baseName,
      frames: model.animationFrames.map((_frame, index) => ({
        bundleName: `${baseName}/frame-${String(index).padStart(3, "0")}`,
        polygons: quakePickupModelRenderBundlePolygons(model, index),
      })),
      textureQuality,
      extractLeafStyles: true,
    });
    for (let index = 0; index < model.animationFrames.length; index++) {
      model.animationFrames[index].renderBundle = frameBundles[index];
    }
    const animationFrameSet = quakePickupModelAnimationFrameSet(model);
    if (!animationFrameSet) {
      throw new Error(`Animated model ${model.source} could not be built as a stable topology frame set.`);
    }
    model.animationFrameSet = animationFrameSet;
    await writeQuakeAnimationFrameStyles(baseName, model);
    return;
  }
  model.renderBundle = await renderBundleBuilder.build({
    bundleName: baseName,
    polygons: quakePickupModelRenderBundlePolygons(model, 0),
    textureQuality,
    extractLeafStyles: true,
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

function attachQuakeRenderBundleDirectFrameStyles(renderBundle, leafClasses) {
  const stylesByClass = new Map(renderBundle.leafFrameStylesByClass ?? []);
  const leafFrameStyles = leafClasses.map((leafClass) => stylesByClass.get(leafClass) ?? []);
  if (leafFrameStyles.some((frameStyle) => frameStyle.length > 0)) {
    renderBundle.leafFrameStyles = leafFrameStyles;
  }
  delete renderBundle.leafFrameStylesByClass;
  delete renderBundle.meshCss;
  delete renderBundle.styleUrl;
  delete renderBundle.styleClassName;
}

async function writeQuakeAnimationFrameStyles(bundleName, model) {
  const frames = model.animationFrames ?? [];
  const frameStyles = frames.map((frame) => frame.renderBundle?.leafFrameStyles ?? []);
  if (!frameStyles.some((styles) => styles.length > 0)) return;
  const body = JSON.stringify({
    version: 1,
    frames: frameStyles,
  });
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  const styleDir = path.join(renderBundleOutputDir, bundleName);
  await mkdir(styleDir, { recursive: true });
  const filename = `frame-styles-${hash}.json`;
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

function quakeRenderBundleLeafHasClass(attributes, leafClasses) {
  const classMatch = attributes.match(/\bclass="([^"]*)"/);
  if (!classMatch) return false;
  return classMatch[1].split(/\s+/).some((leafClass) => leafClasses.has(leafClass));
}

function stripQuakePickupModelFallbackGeometry(model) {
  delete model.texture;
  delete model.polygons;
  for (const frame of model.animationFrames ?? []) {
    delete frame.polygons;
  }
}

function quakePickupModelRenderBundlePolygons(model, frameIndex) {
  const frame = model.animationFrames?.[frameIndex];
  const polygons = frame?.polygons ?? model.polygons;
  return polygons.map(({ data: _data, ...polygon }) => ({
    ...polygon,
    ...(model.texture ? { texture: model.texture, textureAlphaMode: "opaque" } : {}),
  }));
}

function quakeModelBundleName(source) {
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "model";
  return slug;
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
    !["bolt.mdl", "grenade.mdl", "k_spike.mdl", "lavaball.mdl", "laser.mdl", "s_light.mdl", "v_spike.mdl", "w_spike.mdl"].includes(filename);
}

function buildQuakeProgramMetadata(assets) {
  const entry = assets.entries.get("progs.dat");
  if (!entry) throw new Error("Missing Quake progs.dat.");
  const progs = assets.pak.subarray(entry.offset, entry.offset + entry.length);
  const header = parseQuakeProgramHeader(progs);
  const stringsOffset = header.ofsStrings;
  const readProgramString = (offset) => readNullTerminatedString(progs, stringsOffset + offset);

  const modelStringByGlobalOffset = new Map();
  for (let i = 0; i < header.numGlobalDefs; i++) {
    const offset = header.ofsGlobalDefs + i * 8;
    const type = progs.readUInt16LE(offset) & 0x7fff;
    if (type !== 1) continue;
    const globalOffset = progs.readUInt16LE(offset + 2);
    const stringOffset = progs.readInt32LE(header.ofsGlobals + globalOffset * 4);
    const value = readProgramString(stringOffset);
    if (/^(maps|progs)\/.+\.(bsp|mdl|spr)$/i.test(value)) {
      modelStringByGlobalOffset.set(globalOffset, value.toLowerCase());
    }
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
  for (const fn of functions) {
    if (!isQuakeEntityFunctionName(fn.name) || fn.firstStatement <= 0) continue;
    const endStatement = functionEndByIndex.get(fn.index) ?? header.numStatements;
    const models = quakeFunctionModelReferences(progs, header, fn.firstStatement, endStatement, modelStringByGlobalOffset);
    if (models.length === 0) continue;
    entityFunctions.push({
      classname: fn.name,
      file: fn.file,
      models,
    });
    modelsByClassname[fn.name] = models.map((entry) => entry.path);
  }

  entityFunctions.sort((a, b) => a.classname.localeCompare(b.classname));
  return {
    version: 1,
    crc: header.crc,
    entityFunctions,
    modelsByClassname,
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

function quakeFunctionModelReferences(progs, header, firstStatement, endStatement, modelStringByGlobalOffset) {
  const models = [];
  const seen = new Set();
  for (let statement = firstStatement; statement < endStatement; statement++) {
    const offset = header.ofsStatements + statement * 8;
    for (const operandOffset of [offset + 2, offset + 4, offset + 6]) {
      const model = modelStringByGlobalOffset.get(progs.readInt16LE(operandOffset));
      if (!model || seen.has(model)) continue;
      seen.add(model);
      models.push({ path: model, statement });
    }
  }
  return models;
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
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((vertex) => [
      vertex[0] * scale,
      vertex[1] * scale,
      vertex[2] * scale,
    ]),
  }));
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
  const hash = createHash("sha256").update(png).digest("hex").slice(0, 16);
  const filename = `tex-${hash}.png`;
  const outputPath = path.join(textureOutputDir, filename);
  const url = `${quakeTexturePublicPath}/${filename}`;
  texturePngByPublicPath.set(url, png);
  const cached = textureFileUrlByHash.get(hash);
  if (cached) {
    await cached;
    await writeTextureFileIfMissing(outputPath, png);
    return url;
  }
  const task = (async () => {
    await writeTextureFileIfMissing(outputPath, png);
    return url;
  })();
  textureFileUrlByHash.set(hash, task);
  const resolvedUrl = await task;
  textureFileUrlByHash.set(hash, resolvedUrl);
  return resolvedUrl;
}

async function writeTextureFileIfMissing(outputPath, png) {
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, png, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function encodeTexturePng({ width, height, pixels, palette, brightness, alpha }) {
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

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
