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

const QUAKE_MONSTER_PROJECTILE_MODEL_PATHS = {
  monster_boss: "progs/lavaball.mdl",
  monster_hell_knight: "progs/k_spike.mdl",
  monster_ogre: "progs/grenade.mdl",
  monster_shalrath: "progs/v_spike.mdl",
  monster_wizard: "progs/w_spike.mdl",
  monster_zombie: "progs/zom_gib.mdl",
};

export function deriveQuakeGameLogicAssetRefs(gameLogic, options = {}) {
  const allowedKinds = options.kinds ? new Set(options.kinds) : null;
  const assets = new Map();
  const entities = [];
  for (const entity of gameLogic?.entities ?? []) {
    const entityAssets = quakeGameLogicEntityAssetRefs(entity, gameLogic)
      .filter((asset) => !allowedKinds || allowedKinds.has(asset.kind));
    const uniqueEntityAssets = dedupeAssetRefs(entityAssets);
    if (!uniqueEntityAssets.length) continue;
    entities.push({
      entityIndex: entity.entityIndex,
      classname: entity.classname,
      assetRefs: uniqueEntityAssets,
    });
    for (const asset of uniqueEntityAssets) {
      assets.set(quakeAssetRefKey(asset), asset);
    }
  }
  const assetRefs = [...assets.values()].sort(compareAssetRefs);
  return {
    assetRefs,
    assetPathsByKind: quakeAssetPathsByKind(assetRefs),
    entities,
  };
}

export function deriveQuakeGameLogicModelPreloads(gameLogic, options = {}) {
  const preparedModelPaths = options.preparedModelPaths
    ? new Set([...options.preparedModelPaths].map((modelPath) => modelPath.toLowerCase()))
    : null;
  const modelPaths = new Set();
  const entities = [];
  for (const entity of gameLogic?.entities ?? []) {
    const entityModelPaths = quakeGameLogicEntityModelPaths(entity, gameLogic)
      .filter(isPreparedModelPath)
      .filter((modelPath) => !preparedModelPaths || preparedModelPaths.has(modelPath.toLowerCase()));
    const uniqueEntityModelPaths = [...new Set(entityModelPaths)].sort();
    if (uniqueEntityModelPaths.length) {
      entities.push({
        entityIndex: entity.entityIndex,
        classname: entity.classname,
        modelPaths: uniqueEntityModelPaths,
      });
      for (const modelPath of uniqueEntityModelPaths) modelPaths.add(modelPath);
    }
  }
  return {
    modelPaths: [...modelPaths].sort(),
    entities,
  };
}

export function deriveQuakeGameLogicSoundPreloads(gameLogic, options = {}) {
  const preparedSoundPaths = options.preparedSoundPaths
    ? new Set([...options.preparedSoundPaths].map(normalizeQuakeSoundPath).filter(Boolean))
    : null;
  const includeRegisteredOnlySounds = options.includeRegisteredOnlySounds === true;
  const soundPaths = new Set();
  const entities = [];
  for (const entity of gameLogic?.entities ?? []) {
    const entitySoundPaths = quakeGameLogicEntityAssetRefs(entity, gameLogic)
      .filter((asset) => asset.kind === "sound")
      .filter((asset) => includeRegisteredOnlySounds || asset.call !== "precache_sound2")
      .map((asset) => normalizeQuakeSoundPath(asset.path))
      .filter(Boolean)
      .filter((soundPath) => !preparedSoundPaths || preparedSoundPaths.has(soundPath));
    const uniqueEntitySoundPaths = [...new Set(entitySoundPaths)].sort();
    if (!uniqueEntitySoundPaths.length) continue;
    entities.push({
      entityIndex: entity.entityIndex,
      classname: entity.classname,
      soundPaths: uniqueEntitySoundPaths,
    });
    for (const soundPath of uniqueEntitySoundPaths) soundPaths.add(soundPath);
  }
  return {
    soundPaths: [...soundPaths].sort(),
    entities,
  };
}

function quakeGameLogicEntityModelPaths(entity, gameLogic) {
  if (isQuakePickupClassname(entity.classname)) return quakeGameLogicPickupModelPaths(entity, gameLogic);
  if (entity.classname === "misc_explobox") return ["maps/b_explob.bsp"];
  if (entity.classname === "misc_explobox2") return ["maps/b_exbox2.bsp"];
  if (entity.classname.startsWith("monster_")) return quakeGameLogicMonsterModelPaths(entity, gameLogic);
  return [];
}

function quakeGameLogicPickupModelPaths(entity, gameLogic) {
  const programModels = quakeGameLogicProgramModelPaths(entity, gameLogic);
  const spawnflags = quakeGameLogicEntitySpawnflags(entity);
  const large = Boolean(spawnflags & 1);
  if (entity.classname === "item_health") {
    if (spawnflags & 2) return [quakeProgramModelPathMatching(programModels, "maps/b_bh100.bsp") ?? "maps/b_bh100.bsp"];
    return [spawnflags & 1
      ? quakeProgramModelPathMatching(programModels, "maps/b_bh10.bsp") ?? "maps/b_bh10.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_bh25.bsp") ?? "maps/b_bh25.bsp"];
  }
  if (entity.classname === "item_shells" || entity.classname === "ammo_shells") {
    return [large ? "maps/b_shell1.bsp" : "maps/b_shell0.bsp"];
  }
  if (entity.classname === "item_spikes" || entity.classname === "ammo_nails") {
    return [large ? "maps/b_nail1.bsp" : "maps/b_nail0.bsp"];
  }
  if (entity.classname === "item_rockets" || entity.classname === "ammo_rockets") {
    return [large ? "maps/b_rock1.bsp" : "maps/b_rock0.bsp"];
  }
  if (entity.classname === "item_cells" || entity.classname === "ammo_cells") {
    return [large ? "maps/b_batt1.bsp" : "maps/b_batt0.bsp"];
  }
  return [quakePreferredProgramPickupModelPath(programModels) ?? QUAKE_PICKUP_MODEL_PATHS[entity.classname]]
    .filter(Boolean);
}

function quakeGameLogicMonsterModelPaths(entity, gameLogic) {
  const programModels = quakeGameLogicProgramModelPaths(entity, gameLogic);
  const expected = QUAKE_MONSTER_MODEL_PATHS[entity.classname];
  const bodyModelPath = expected && (programModels.length === 0 || programModels.includes(expected))
    ? expected
    : programModels.find(isQuakeMonsterBodyModel) ??
      programModels.find((modelPath) => modelPath.startsWith("progs/") && modelPath.endsWith(".mdl")) ??
      expected;
  const sourceExtraModelPaths = programModels.filter((modelPath) => modelPath !== bodyModelPath);
  return [
    bodyModelPath,
    ...sourceExtraModelPaths,
    QUAKE_MONSTER_PROJECTILE_MODEL_PATHS[entity.classname],
  ].filter(Boolean);
}

function quakeGameLogicProgramModelPaths(entity, gameLogic) {
  const assetModelPaths = quakeGameLogicEntityAssetRefs(entity, gameLogic)
    .filter((asset) => asset.kind === "model" || asset.kind === "bsp")
    .map((asset) => asset.path)
    .filter(isPreparedModelPath);
  if (assetModelPaths.length) return [...new Set(assetModelPaths)];
  const classname = quakeProgramClassnameAlias(entity.classname);
  const sourceFact = gameLogic?.programFacts?.entities?.[entity.classname] ??
    gameLogic?.programFacts?.entities?.[classname];
  return sourceFact?.dependencies?.models ?? entity.dependencyModels ?? [];
}

function quakeGameLogicEntityAssetRefs(entity, gameLogic) {
  const classname = quakeProgramClassnameAlias(entity.classname);
  const sourceFact = gameLogic?.programFacts?.entities?.[entity.classname] ??
    gameLogic?.programFacts?.entities?.[classname];
  const sourceAssets = normalizeAssetRefs(sourceFact?.assetRefs);
  const callbackAssets = normalizeCallbackAssetRefs(sourceFact?.callbackFacts);
  const behaviorAssets = quakeGameLogicEntityBehaviorAssetRefs(entity);
  if (sourceAssets.length || callbackAssets.length) {
    return dedupeAssetRefs([...sourceAssets, ...callbackAssets, ...behaviorAssets]);
  }
  const entityAssets = normalizeAssetRefs(entity.dependencyAssets);
  if (entityAssets.length) return dedupeAssetRefs([...entityAssets, ...behaviorAssets]);
  return dedupeAssetRefs([
    ...legacyAssetRefs(sourceFact?.dependencies?.models ?? entity.dependencyModels, "model"),
    ...legacyAssetRefs(sourceFact?.dependencies?.sounds ?? entity.dependencySounds, "sound"),
    ...behaviorAssets,
  ]);
}

function normalizeCallbackAssetRefs(callbackFacts) {
  if (!callbackFacts || typeof callbackFacts !== "object") return [];
  return Object.values(callbackFacts).flatMap((fact) => {
    const assets = normalizeAssetRefs(fact?.assetRefs);
    const hasDeathOutputAsset = assets.some((asset) =>
      asset.kind === "model" && (
        asset.call === "DropBackpack" ||
        asset.call === "ThrowHead" ||
        asset.call === "ThrowGib"
      ) ||
      asset.kind === "sound" && asset.call === "BackpackTouch"
    );
    return hasDeathOutputAsset ? assets : [];
  });
}

function quakeGameLogicEntityBehaviorAssetRefs(entity) {
  const pickupSound = normalizeQuakeSoundPath(entity?.resolvedPickup?.feedback?.sound);
  return pickupSound
    ? [{
        call: "pickup-feedback",
        kind: "sound",
        path: pickupSound,
      }]
    : [];
}

function normalizeAssetRefs(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const asset of input) {
    const path = typeof asset?.path === "string" ? asset.path.toLowerCase() : "";
    const kind = typeof asset?.kind === "string" ? asset.kind : "";
    if (!path || !kind) continue;
    out.push({
      call: typeof asset.call === "string" ? asset.call : "source",
      kind,
      path,
      ...(asset.sourceRef ? { sourceRef: asset.sourceRef } : {}),
    });
  }
  return dedupeAssetRefs(out);
}

function legacyAssetRefs(paths, fallbackKind) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.map((path) => typeof path === "string" ? path.toLowerCase() : "").filter(Boolean))]
    .map((path) => ({
      call: "legacy-dependency",
      kind: fallbackKind === "model" ? quakeLegacyModelAssetKind(path) : fallbackKind,
      path,
    }));
}

function quakeLegacyModelAssetKind(path) {
  if (path.endsWith(".bsp")) return "bsp";
  if (path.endsWith(".spr")) return "sprite";
  return "model";
}

function normalizeQuakeSoundPath(path) {
  return typeof path === "string" ? path.toLowerCase().replace(/^sound\//, "") : "";
}

function dedupeAssetRefs(assetRefs) {
  const out = [];
  const seen = new Set();
  for (const asset of assetRefs) {
    const key = quakeAssetRefKey(asset);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(asset);
  }
  return out;
}

function quakeAssetRefKey(asset) {
  return `${asset.kind}:${asset.path}:${asset.call}`;
}

function compareAssetRefs(a, b) {
  return quakeAssetRefKey(a).localeCompare(quakeAssetRefKey(b));
}

function quakeAssetPathsByKind(assetRefs) {
  const byKind = {};
  for (const asset of assetRefs) {
    (byKind[asset.kind] ??= new Set()).add(asset.path);
  }
  return Object.fromEntries(
    Object.entries(byKind).map(([kind, paths]) => [kind, [...paths].sort()]),
  );
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
  return models.find((modelPath) => modelPath.toLowerCase() === normalized);
}

function quakePreferredProgramPickupModelPath(models) {
  return models.find((modelPath) => modelPath.startsWith("progs/") && modelPath.endsWith(".mdl")) ??
    models.find((modelPath) => modelPath.startsWith("maps/") && modelPath.endsWith(".bsp"));
}

function quakeGameLogicEntitySpawnflags(entity) {
  const value = Number(entity.spawnflags ?? entity.properties?.spawnflags ?? 0);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function isQuakePickupClassname(classname) {
  return classname.startsWith("item_") ||
    classname.startsWith("weapon_") ||
    classname.startsWith("ammo_") ||
    classname.startsWith("key_");
}

function isQuakeMonsterBodyModel(modelPath) {
  const filename = modelPath.split("/").pop()?.toLowerCase() ?? "";
  return modelPath.startsWith("progs/") &&
    modelPath.endsWith(".mdl") &&
    !filename.startsWith("h_") &&
    !filename.includes("gib");
}

function isPreparedModelPath(modelPath) {
  return /^(maps|progs)\/.+\.(bsp|mdl)$/i.test(modelPath);
}
