import type {
  RGB,
  QuakeEntity,
  QuakeEntityManifest,
  QuakeEntityManifestCategory,
  QuakeEntityManifestEntry,
  QuakeEntityManifestLight,
  QuakeEntityManifestMover,
  QuakeEntityManifestPoint,
  QuakeEntityManifestTrigger,
  QuakeEntityRuntimeManifest,
  QuakeEntityRuntimeStatus,
  QuakeVertex,
} from "./scene";

export function buildEntityManifest(entities: QuakeEntity[]): QuakeEntityManifest {
  const targetnameIndex = new Map<string, number[]>();
  for (const entity of entities) {
    const targetname = entity.properties.targetname;
    if (!targetname) continue;
    const bucket = targetnameIndex.get(targetname);
    if (bucket) {
      bucket.push(entity.index);
    } else {
      targetnameIndex.set(targetname, [entity.index]);
    }
  }

  const manifest: QuakeEntityManifest = {
    totals: {
      entities: entities.length,
      active: 0,
      metadataOnly: 0,
      ignored: 0,
      byClassname: {},
      byCategory: {},
    },
    entries: [],
    starts: [],
    pickups: [],
    monsters: [],
    triggers: [],
    movers: [],
    teleporters: [],
    exits: [],
    lights: [],
    counters: [],
    secrets: [],
    inert: [],
    runtime: {
      targetEntities: Object.fromEntries([...targetnameIndex].map(([key, indexes]) => [key, [...indexes]])),
      triggerCounterCounts: [],
      damageableBrushEntityIndexes: [],
      fireballEmitterEntityIndexes: [],
      ambientEntityIndexes: [],
      pickupEntityIndexes: [],
      shootableEntityIndexes: [],
      moverEntityIndexes: [],
      moverSupportEntityIndexes: [],
    },
  };

  for (const entity of entities) {
    const category = quakeEntityManifestCategory(entity);
    const runtimeStatus = quakeEntityRuntimeStatus(entity, category);
    const spawnflags = quakeManifestInteger(entity, "spawnflags") ?? 0;
    const entry: QuakeEntityManifestEntry = {
      entityIndex: entity.index,
      classname: entity.classname,
      category,
      runtimeStatus,
      spawnflags,
      ...(entity.origin ? { origin: { ...entity.origin } } : {}),
      ...(entity.angle !== undefined ? { angle: entity.angle } : {}),
      ...(entity.model !== undefined ? { model: entity.model } : {}),
      ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
      ...(entity.properties.target ? { target: entity.properties.target } : {}),
      ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
      ...quakeEntityRuntimeReason(runtimeStatus, category),
    };

    manifest.entries.push(entry);
    incrementRecord(manifest.totals.byClassname, entity.classname || "(empty)");
    incrementRecord(manifest.totals.byCategory, category);
    if (runtimeStatus === "active") manifest.totals.active += 1;
    if (runtimeStatus === "metadata-only") manifest.totals.metadataOnly += 1;
    if (runtimeStatus === "ignored") manifest.totals.ignored += 1;
    if (runtimeStatus !== "active") manifest.inert.push(entry);
    addQuakeRuntimeEntityManifestEntry(manifest.runtime, entity, category);

    const point = quakeManifestPoint(entity, spawnflags);
    if (category === "player-start" && point) manifest.starts.push(point);
    if (category === "pickup" && point) manifest.pickups.push(point);
    if (category === "monster" && point) manifest.monsters.push(point);
    if (category === "light" && entity.origin) manifest.lights.push(quakeManifestLight(entity, spawnflags));

    if (entity.classname.startsWith("trigger_")) {
      const trigger = quakeManifestTrigger(entity, spawnflags);
      manifest.triggers.push(trigger);
      if (category === "counter") manifest.counters.push(trigger);
      if (category === "secret") manifest.secrets.push(trigger);
    }
    if (category === "mover") {
      manifest.movers.push(quakeManifestMover(entity, spawnflags));
      if (entity.classname === "func_door_secret") {
        manifest.secrets.push(quakeManifestTrigger(entity, spawnflags));
      }
    }
    if (category === "teleporter" && entity.properties.target) {
      manifest.teleporters.push({
        entityIndex: entity.index,
        ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
        target: entity.properties.target,
        destinationEntityIndexes: [...(targetnameIndex.get(entity.properties.target) ?? [])],
      });
    }
    if (category === "exit") {
      manifest.exits.push({
        entityIndex: entity.index,
        ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
        ...(entity.properties.map ? { map: entity.properties.map } : {}),
      });
    }
  }

  return manifest;
}

export function cloneEntityManifest(manifest: QuakeEntityManifest): QuakeEntityManifest {
  return {
    totals: {
      entities: manifest.totals.entities,
      active: manifest.totals.active,
      metadataOnly: manifest.totals.metadataOnly,
      ignored: manifest.totals.ignored,
      byClassname: { ...manifest.totals.byClassname },
      byCategory: { ...manifest.totals.byCategory },
    },
    entries: manifest.entries.map(cloneEntityManifestEntry),
    starts: manifest.starts.map(cloneEntityManifestPoint),
    pickups: manifest.pickups.map(cloneEntityManifestPoint),
    monsters: manifest.monsters.map(cloneEntityManifestPoint),
    triggers: manifest.triggers.map(cloneEntityManifestTrigger),
    movers: manifest.movers.map(cloneEntityManifestMover),
    teleporters: manifest.teleporters.map((teleporter) => ({
      entityIndex: teleporter.entityIndex,
      ...(teleporter.modelIndex !== undefined ? { modelIndex: teleporter.modelIndex } : {}),
      target: teleporter.target,
      destinationEntityIndexes: [...teleporter.destinationEntityIndexes],
    })),
    exits: manifest.exits.map((exit) => ({
      entityIndex: exit.entityIndex,
      ...(exit.modelIndex !== undefined ? { modelIndex: exit.modelIndex } : {}),
      ...(exit.map ? { map: exit.map } : {}),
    })),
    lights: manifest.lights.map((light) => ({
      entityIndex: light.entityIndex,
      classname: light.classname,
      origin: { ...light.origin },
      spawnflags: light.spawnflags,
      ...(light.light !== undefined ? { light: light.light } : {}),
      ...(light.style !== undefined ? { style: light.style } : {}),
      ...(light.targetname ? { targetname: light.targetname } : {}),
      ...(light.delay !== undefined ? { delay: light.delay } : {}),
      ...(light.wait !== undefined ? { wait: light.wait } : {}),
      ...(light.mangle ? { mangle: { ...light.mangle } } : {}),
      ...(light.color ? { color: [...light.color] as RGB } : {}),
    })),
    counters: manifest.counters.map(cloneEntityManifestTrigger),
    secrets: manifest.secrets.map(cloneEntityManifestTrigger),
    inert: manifest.inert.map(cloneEntityManifestEntry),
    runtime: cloneEntityRuntimeManifest(manifest.runtime),
  };
}

function addQuakeRuntimeEntityManifestEntry(
  runtime: QuakeEntityRuntimeManifest,
  entity: QuakeEntity,
  category: QuakeEntityManifestCategory,
): void {
  if (category === "pickup") runtime.pickupEntityIndexes.push(entity.index);
  if (category === "monster" || isQuakeShootableDecorClassname(entity.classname)) {
    runtime.shootableEntityIndexes.push(entity.index);
  }
  if (category === "mover") runtime.moverEntityIndexes.push(entity.index);
  if (category === "path") runtime.moverSupportEntityIndexes.push(entity.index);
  if (entity.classname.startsWith("ambient_")) runtime.ambientEntityIndexes.push(entity.index);
  if (entity.classname === "misc_fireball") runtime.fireballEmitterEntityIndexes.push(entity.index);
  if (entity.classname === "trigger_counter") {
    runtime.triggerCounterCounts.push([
      entity.index,
      Math.max(1, Math.round(quakeManifestNumber(entity, "count") ?? 2)),
    ]);
  }
  if (isQuakeDamageableBrushClassname(entity.classname) && (quakeManifestNumber(entity, "health") ?? 0) > 0) {
    runtime.damageableBrushEntityIndexes.push(entity.index);
  }
}

function cloneEntityRuntimeManifest(runtime: QuakeEntityRuntimeManifest): QuakeEntityRuntimeManifest {
  return {
    targetEntities: Object.fromEntries(
      Object.entries(runtime.targetEntities).map(([key, indexes]) => [key, [...indexes]]),
    ),
    triggerCounterCounts: runtime.triggerCounterCounts.map(([entityIndex, count]) => [entityIndex, count] as [number, number]),
    damageableBrushEntityIndexes: [...runtime.damageableBrushEntityIndexes],
    fireballEmitterEntityIndexes: [...runtime.fireballEmitterEntityIndexes],
    ambientEntityIndexes: [...runtime.ambientEntityIndexes],
    pickupEntityIndexes: [...runtime.pickupEntityIndexes],
    shootableEntityIndexes: [...runtime.shootableEntityIndexes],
    moverEntityIndexes: [...runtime.moverEntityIndexes],
    moverSupportEntityIndexes: [...runtime.moverSupportEntityIndexes],
  };
}

function quakeEntityManifestCategory(entity: QuakeEntity): QuakeEntityManifestCategory {
  const classname = entity.classname;
  if (classname === "worldspawn") return "worldspawn";
  if (classname === "info_player_start") return "player-start";
  if (classname === "info_player_deathmatch" || classname === "info_player_coop") return "multiplayer";
  if (isQuakePickupClassname(classname)) return "pickup";
  if (classname.startsWith("monster_")) return "monster";
  if (classname === "trigger_teleport") return "teleporter";
  if (classname === "trigger_changelevel") return "exit";
  if (classname === "trigger_counter") return "counter";
  if (classname === "trigger_secret") return "secret";
  if (classname.startsWith("trigger_")) return "trigger";
  if (isQuakeMoverClassname(classname)) return "mover";
  if (classname.startsWith("func_")) return "brush";
  if (classname === "light" || classname.startsWith("light_")) return "light";
  if (classname === "path_corner" || classname.startsWith("info_intermission")) return "path";
  if (classname.startsWith("ambient_")) return "ambient";
  if (classname.startsWith("misc_")) return "decor";
  return "unknown";
}

function quakeEntityRuntimeStatus(
  entity: QuakeEntity,
  category: QuakeEntityManifestCategory,
): QuakeEntityRuntimeStatus {
  if (category === "multiplayer" || category === "ambient") return "ignored";
  if (
    category === "worldspawn" ||
    category === "player-start" ||
    category === "pickup" ||
    category === "teleporter" ||
    category === "exit" ||
    category === "counter" ||
    category === "secret" ||
    category === "mover"
  ) return "active";
  if (category === "trigger" && isQuakeActiveTriggerClassname(entity.classname)) return "active";
  if (category === "brush" && entity.modelIndex !== undefined) return "active";
  if (category === "decor" && isQuakeShootableDecorClassname(entity.classname)) return "active";
  return "metadata-only";
}

function quakeEntityRuntimeReason(
  runtimeStatus: QuakeEntityRuntimeStatus,
  category: QuakeEntityManifestCategory,
): Pick<QuakeEntityManifestEntry, "reason"> {
  if (runtimeStatus === "active") return {};
  if (category === "multiplayer") return { reason: "multiplayer unsupported" };
  if (category === "ambient") return { reason: "sound disabled" };
  if (category === "monster") return { reason: "monster behavior not implemented" };
  if (category === "light") return { reason: "BSP lightmaps are baked; point light entities are metadata only" };
  if (category === "decor") return { reason: "decor model spawning not implemented" };
  return { reason: "runtime behavior not implemented" };
}

function isQuakePickupClassname(classname: string): boolean {
  return classname.startsWith("item_") ||
    classname.startsWith("weapon_") ||
    classname.startsWith("ammo_") ||
    classname.startsWith("key_");
}

function isQuakeMoverClassname(classname: string): boolean {
  return classname === "func_button" ||
    classname === "func_door" ||
    classname === "func_door_secret" ||
    classname === "func_plat" ||
    classname === "func_train";
}

function isQuakeActiveTriggerClassname(classname: string): boolean {
  return classname === "trigger_hurt" ||
    classname === "trigger_multiple" ||
    classname === "trigger_once";
}

function isQuakeShootableDecorClassname(classname: string): boolean {
  return classname === "misc_explobox" ||
    classname === "misc_explobox2";
}

function isQuakeDamageableBrushClassname(classname: string): boolean {
  return classname === "func_button" ||
    classname === "func_door" ||
    classname === "func_door_secret" ||
    classname === "trigger_multiple" ||
    classname === "trigger_once" ||
    classname === "trigger_secret";
}

function quakeManifestPoint(entity: QuakeEntity, spawnflags: number): QuakeEntityManifestPoint | null {
  if (!entity.origin) return null;
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    origin: { ...entity.origin },
    spawnflags,
    ...(entity.angle !== undefined ? { angle: entity.angle } : {}),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
  };
}

function quakeManifestTrigger(entity: QuakeEntity, spawnflags: number): QuakeEntityManifestTrigger {
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
    spawnflags,
    ...(entity.properties.target ? { target: entity.properties.target } : {}),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
    ...quakeManifestOptionalNumber(entity, "delay"),
    ...quakeManifestOptionalNumber(entity, "wait"),
    ...quakeManifestOptionalNumber(entity, "count"),
    ...quakeManifestOptionalNumber(entity, "dmg"),
    ...(entity.properties.message ? { message: entity.properties.message } : {}),
  };
}

function quakeManifestMover(entity: QuakeEntity, spawnflags: number): QuakeEntityManifestMover {
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
    spawnflags,
    ...(entity.properties.target ? { target: entity.properties.target } : {}),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
    ...quakeManifestOptionalNumber(entity, "speed"),
    ...quakeManifestOptionalNumber(entity, "wait"),
    ...quakeManifestOptionalNumber(entity, "lip"),
    ...quakeManifestOptionalNumber(entity, "height"),
  };
}

function quakeManifestLight(entity: QuakeEntity, spawnflags: number): QuakeEntityManifestLight {
  const mangle = quakeManifestVector(entity.properties.mangle);
  const color = quakeManifestColor(entity.properties._color);
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    origin: { ...(entity.origin ?? { x: 0, y: 0, z: 0 }) },
    spawnflags,
    ...quakeManifestOptionalNumber(entity, "light"),
    ...quakeManifestOptionalNumber(entity, "style"),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
    ...quakeManifestOptionalNumber(entity, "delay"),
    ...quakeManifestOptionalNumber(entity, "wait"),
    ...(mangle ? { mangle } : {}),
    ...(color ? { color } : {}),
  };
}

function cloneEntityManifestEntry(entry: QuakeEntityManifestEntry): QuakeEntityManifestEntry {
  return {
    entityIndex: entry.entityIndex,
    classname: entry.classname,
    category: entry.category,
    runtimeStatus: entry.runtimeStatus,
    spawnflags: entry.spawnflags,
    ...(entry.origin ? { origin: { ...entry.origin } } : {}),
    ...(entry.angle !== undefined ? { angle: entry.angle } : {}),
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    ...(entry.modelIndex !== undefined ? { modelIndex: entry.modelIndex } : {}),
    ...(entry.target ? { target: entry.target } : {}),
    ...(entry.targetname ? { targetname: entry.targetname } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
  };
}

function cloneEntityManifestPoint(point: QuakeEntityManifestPoint): QuakeEntityManifestPoint {
  return {
    entityIndex: point.entityIndex,
    classname: point.classname,
    origin: { ...point.origin },
    spawnflags: point.spawnflags,
    ...(point.angle !== undefined ? { angle: point.angle } : {}),
    ...(point.targetname ? { targetname: point.targetname } : {}),
  };
}

function cloneEntityManifestTrigger(trigger: QuakeEntityManifestTrigger): QuakeEntityManifestTrigger {
  return {
    entityIndex: trigger.entityIndex,
    classname: trigger.classname,
    ...(trigger.modelIndex !== undefined ? { modelIndex: trigger.modelIndex } : {}),
    spawnflags: trigger.spawnflags,
    ...(trigger.target ? { target: trigger.target } : {}),
    ...(trigger.targetname ? { targetname: trigger.targetname } : {}),
    ...(trigger.delay !== undefined ? { delay: trigger.delay } : {}),
    ...(trigger.wait !== undefined ? { wait: trigger.wait } : {}),
    ...(trigger.count !== undefined ? { count: trigger.count } : {}),
    ...(trigger.dmg !== undefined ? { dmg: trigger.dmg } : {}),
    ...(trigger.message ? { message: trigger.message } : {}),
  };
}

function cloneEntityManifestMover(mover: QuakeEntityManifestMover): QuakeEntityManifestMover {
  return {
    ...cloneEntityManifestTrigger(mover),
    ...(mover.speed !== undefined ? { speed: mover.speed } : {}),
    ...(mover.lip !== undefined ? { lip: mover.lip } : {}),
    ...(mover.height !== undefined ? { height: mover.height } : {}),
  };
}

function quakeManifestOptionalNumber(entity: QuakeEntity, key: string): Record<string, number> {
  const value = quakeManifestNumber(entity, key);
  return value === undefined ? {} : { [key]: value };
}

function quakeManifestInteger(entity: QuakeEntity, key: string): number | undefined {
  const value = quakeManifestNumber(entity, key);
  return value === undefined ? undefined : Math.trunc(value);
}

function quakeManifestNumber(entity: QuakeEntity, key: string): number | undefined {
  const value = parseManifestFiniteNumber(entity.properties[key]);
  return value === null ? undefined : value;
}

function quakeManifestVector(value: string | undefined): QuakeVertex | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/).map((part) => parseManifestFiniteNumber(part));
  if (parts.length < 3 || parts.some((part) => part === null)) return undefined;
  return { x: parts[0] ?? 0, y: parts[1] ?? 0, z: parts[2] ?? 0 };
}

function quakeManifestColor(value: string | undefined): RGB | undefined {
  const vector = quakeManifestVector(value);
  if (!vector) return undefined;
  return [vector.x, vector.y, vector.z];
}

function parseManifestFiniteNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function incrementRecord(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}
