const QUAKE_SPAWNFLAG_NOT_EASY = 256;
const QUAKE_SPAWNFLAG_NOT_MEDIUM = 512;
const QUAKE_SPAWNFLAG_NOT_HARD = 1024;
const QUAKE_SPAWNFLAG_NOT_DEATHMATCH = 2048;
const QUAKE_SINGLE_PLAYER_SKILL = 0;

export const QUAKE_PREPARED_SCENE_MODES = ["singleplayer", "deathmatch"];

export function quakePreparedSceneModeOutputPath(outputPath, mode) {
  if (mode === "singleplayer") return outputPath;
  if (mode === "deathmatch") return outputPath.replace(/\.json$/i, ".deathmatch.json");
  throw new Error(`Unsupported Quake prepared scene mode ${String(mode)}.`);
}

export function quakePreparedSceneVariant(prepared, mode) {
  const activeEntityIndexes = quakePreparedSceneActiveEntityIndexes(prepared, mode);
  const variant = cloneJson(prepared);
  variant.entities = (variant.entities ?? []).filter((entity) => activeEntityIndexes.has(entity.index));
  if (variant.entityManifest) {
    variant.entityManifest = quakeEntityManifestVariant(variant.entityManifest, activeEntityIndexes);
  }
  if (variant.gameLogic) {
    variant.gameLogic = quakeGameLogicVariant(variant.gameLogic, activeEntityIndexes);
  }
  if (variant.collision) {
    variant.collision = quakePreparedCollisionVariant(variant.collision, activeEntityIndexes);
  }
  if (variant.visibility?.brushModels) {
    variant.visibility.brushModels = variant.visibility.brushModels
      .filter((brushModel) =>
        brushModel.entityIndex === undefined || activeEntityIndexes.has(brushModel.entityIndex)
      );
  }
  if (variant.renderBundle) {
    variant.renderBundle = quakePreparedRenderBundleVariant(variant.renderBundle, activeEntityIndexes);
  }
  if (variant.lightstyleRenderBundle) {
    variant.lightstyleRenderBundle = quakePreparedRenderBundleVariant(variant.lightstyleRenderBundle, activeEntityIndexes);
  }
  return variant;
}

export function quakePreparedSceneActiveEntityIndexes(prepared, mode) {
  return new Set(
    (prepared.entities ?? [])
      .filter((entity) => quakePreparedSceneEntityActive(entity, mode))
      .map((entity) => entity.index),
  );
}

export function quakePreparedSceneEntityActive(entity, mode) {
  if (mode === "singleplayer") {
    if (entity.classname === "info_player_deathmatch" || entity.classname === "info_player_coop") return false;
    const spawnflags = quakeEntitySpawnflags(entity);
    if (QUAKE_SINGLE_PLAYER_SKILL <= 0 && (spawnflags & QUAKE_SPAWNFLAG_NOT_EASY)) return false;
    if (QUAKE_SINGLE_PLAYER_SKILL === 1 && (spawnflags & QUAKE_SPAWNFLAG_NOT_MEDIUM)) return false;
    if (QUAKE_SINGLE_PLAYER_SKILL >= 2 && (spawnflags & QUAKE_SPAWNFLAG_NOT_HARD)) return false;
    return true;
  }
  if (mode === "deathmatch") {
    if (entity.classname === "info_player_coop") return false;
    return (quakeEntitySpawnflags(entity) & QUAKE_SPAWNFLAG_NOT_DEATHMATCH) === 0;
  }
  throw new Error(`Unsupported Quake prepared scene mode ${String(mode)}.`);
}

function quakeEntityManifestVariant(manifest, activeEntityIndexes) {
  const entries = (manifest.entries ?? []).filter((entry) => activeEntityIndexes.has(entry.entityIndex));
  const filterEntityIndexArray = (items = []) => items.filter((item) => activeEntityIndexes.has(item.entityIndex));
  const runtime = manifest.runtime
    ? quakeEntityRuntimeManifestVariant(manifest.runtime, activeEntityIndexes)
    : manifest.runtime;
  return {
    ...manifest,
    totals: quakeEntityManifestTotals(entries),
    entries,
    starts: filterEntityIndexArray(manifest.starts),
    pickups: filterEntityIndexArray(manifest.pickups),
    monsters: filterEntityIndexArray(manifest.monsters),
    triggers: filterEntityIndexArray(manifest.triggers),
    movers: filterEntityIndexArray(manifest.movers),
    teleporters: filterEntityIndexArray(manifest.teleporters)
      .map((teleporter) => ({
        ...teleporter,
        destinationEntityIndexes: filterIndexes(teleporter.destinationEntityIndexes, activeEntityIndexes),
      })),
    exits: filterEntityIndexArray(manifest.exits),
    ...(manifest.intermissions ? { intermissions: filterEntityIndexArray(manifest.intermissions) } : {}),
    lights: filterEntityIndexArray(manifest.lights),
    counters: filterEntityIndexArray(manifest.counters),
    secrets: filterEntityIndexArray(manifest.secrets),
    inert: filterEntityIndexArray(manifest.inert),
    ...(runtime ? { runtime } : {}),
  };
}

function quakeEntityManifestTotals(entries) {
  const byClassname = {};
  const byCategory = {};
  let active = 0;
  let metadataOnly = 0;
  let ignored = 0;
  for (const entry of entries) {
    byClassname[entry.classname] = (byClassname[entry.classname] ?? 0) + 1;
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
    if (entry.runtimeStatus === "active") active++;
    if (entry.runtimeStatus === "metadata-only") metadataOnly++;
    if (entry.runtimeStatus === "ignored") ignored++;
  }
  return {
    entities: entries.length,
    active,
    metadataOnly,
    ignored,
    byClassname,
    byCategory,
  };
}

function quakeEntityRuntimeManifestVariant(runtime, activeEntityIndexes) {
  return {
    ...runtime,
    targetEntities: Object.fromEntries(
      Object.entries(runtime.targetEntities ?? {})
        .map(([targetname, indexes]) => [targetname, filterIndexes(indexes, activeEntityIndexes)])
        .filter(([, indexes]) => indexes.length > 0),
    ),
    triggerCounterCounts: (runtime.triggerCounterCounts ?? [])
      .filter(([entityIndex]) => activeEntityIndexes.has(entityIndex))
      .map(([entityIndex, count]) => [entityIndex, count]),
    damageableBrushEntityIndexes: filterIndexes(runtime.damageableBrushEntityIndexes, activeEntityIndexes),
    fireballEmitterEntityIndexes: filterIndexes(runtime.fireballEmitterEntityIndexes, activeEntityIndexes),
    ambientEntityIndexes: filterIndexes(runtime.ambientEntityIndexes, activeEntityIndexes),
    pickupEntityIndexes: filterIndexes(runtime.pickupEntityIndexes, activeEntityIndexes),
    shootableEntityIndexes: filterIndexes(runtime.shootableEntityIndexes, activeEntityIndexes),
    moverEntityIndexes: filterIndexes(runtime.moverEntityIndexes, activeEntityIndexes),
    moverSupportEntityIndexes: filterIndexes(runtime.moverSupportEntityIndexes, activeEntityIndexes),
  };
}

function quakeGameLogicVariant(gameLogic, activeEntityIndexes) {
  return filterEntityReferences({
    ...gameLogic,
    spawnSets: Object.fromEntries(
      Object.entries(gameLogic.spawnSets ?? {})
        .map(([key, indexes]) => [key, filterIndexes(indexes, activeEntityIndexes)]),
    ),
    entities: (gameLogic.entities ?? []).filter((entity) => activeEntityIndexes.has(entity.entityIndex)),
  }, activeEntityIndexes);
}

function quakePreparedCollisionVariant(collision, activeEntityIndexes) {
  const runtime = collision.runtime
    ? quakePreparedRuntimeCollisionVariant(collision.runtime, activeEntityIndexes)
    : collision.runtime;
  return {
    ...collision,
    brushModels: (collision.brushModels ?? []).filter((brushModel) =>
      brushModel.entityIndex === undefined || activeEntityIndexes.has(brushModel.entityIndex)
    ),
    ...(runtime ? { runtime } : {}),
  };
}

function quakePreparedRuntimeCollisionVariant(runtime, activeEntityIndexes) {
  const sourceBrushes = runtime.brushes ?? [];
  const brushIndexMap = new Map();
  const brushes = [];
  for (let index = 0; index < sourceBrushes.length; index++) {
    const brush = sourceBrushes[index];
    if (brush.entityIndex !== undefined && !activeEntityIndexes.has(brush.entityIndex)) continue;
    brushIndexMap.set(index, brushes.length);
    brushes.push(brush);
  }
  return {
    ...runtime,
    brushes,
    solidBrushIndexes: remapBrushIndexes(runtime.solidBrushIndexes, brushIndexMap),
    triggerBrushIndexes: remapBrushIndexes(runtime.triggerBrushIndexes, brushIndexMap),
  };
}

export function quakePreparedRenderBundleVariant(renderBundle, activeEntityIndexes) {
  const keptLeafIndexes = [];
  const leafMetadata = [];
  let sourceLeafIndex = 0;
  let leafCount = 0;
  let atlasLeafCount = 0;
  const meshHtml = (renderBundle.meshHtml ?? "").replace(
    /<([bisu])\b([^>]*)><\/\1>/g,
    (html, tagName) => {
      const metadata = renderBundle.leafMetadata?.[sourceLeafIndex];
      const keep = !metadata || metadata.e === undefined || activeEntityIndexes.has(metadata.e);
      if (keep) {
        keptLeafIndexes.push(sourceLeafIndex);
        leafMetadata.push(metadata);
        leafCount++;
        if (tagName === "s") atlasLeafCount++;
      }
      sourceLeafIndex++;
      return keep ? html : "";
    },
  );
  return {
    ...renderBundle,
    meshHtml,
    leafMetadata,
    ...(renderBundle.debugOutlineBackgrounds
      ? { debugOutlineBackgrounds: pickByIndexes(renderBundle.debugOutlineBackgrounds, keptLeafIndexes) }
      : {}),
    ...(renderBundle.debugTransparentOutlineBackgrounds
      ? {
          debugTransparentOutlineBackgrounds: pickByIndexes(
            renderBundle.debugTransparentOutlineBackgrounds,
            keptLeafIndexes,
          ),
        }
      : {}),
    ...(renderBundle.leafFrameStyles
      ? { leafFrameStyles: pickByIndexes(renderBundle.leafFrameStyles, keptLeafIndexes) }
      : {}),
    ...(renderBundle.atlasResidency
      ? { atlasResidency: quakeRenderBundleAtlasResidencyVariant(renderBundle.atlasResidency, keptLeafIndexes) }
      : {}),
    leafCount,
    atlasLeafCount,
  };
}

function quakeRenderBundleAtlasResidencyVariant(atlasResidency, keptLeafIndexes) {
  return {
    ...atlasResidency,
    leafPageIndexes: pickByIndexes(atlasResidency.leafPageIndexes, keptLeafIndexes),
  };
}

function filterEntityReferences(value, activeEntityIndexes, key = "") {
  if (Array.isArray(value)) {
    if (/EntityIndexes$/.test(key)) return filterIndexes(value, activeEntityIndexes);
    return value.map((item) => filterEntityReferences(item, activeEntityIndexes));
  }
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (/EntityIndex$/.test(entryKey) && typeof entryValue === "number") {
      if (!activeEntityIndexes.has(entryValue)) continue;
      out[entryKey] = entryValue;
      continue;
    }
    out[entryKey] = filterEntityReferences(entryValue, activeEntityIndexes, entryKey);
  }
  return out;
}

function filterIndexes(indexes = [], activeEntityIndexes) {
  return indexes.filter((entityIndex) => activeEntityIndexes.has(entityIndex));
}

function remapBrushIndexes(indexes = [], brushIndexMap) {
  return indexes
    .map((index) => brushIndexMap.get(index))
    .filter((index) => Number.isInteger(index));
}

function pickByIndexes(items, indexes) {
  return indexes.map((index) => items[index]);
}

function quakeEntitySpawnflags(entity) {
  const value = Number.parseFloat(entity?.properties?.spawnflags ?? "");
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
