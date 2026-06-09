import type {
  QuakeBrushCollisionKind,
  QuakeCollisionHull,
  QuakeEntity,
  QuakeEntityManifest,
  QuakeEntityManifestCategory,
  QuakeEntityRuntimeManifest,
  QuakeEntityRuntimeStatus,
  QuakePreparedBrushCollision,
  QuakePreparedCollision,
  QuakePreparedModel,
  QuakeVertex,
} from "./scene";

export type QuakeGameLogicSingleplayerMode =
  | "singleplayer:easy"
  | "singleplayer:normal"
  | "singleplayer:hard";

export type QuakeGameLogicUnsupportedMode = "multiplayer:deathmatch" | "multiplayer:coop";

export type QuakeGameLogicMode = QuakeGameLogicSingleplayerMode | QuakeGameLogicUnsupportedMode;

export type QuakeGameLogicProgramValue = number | string | readonly [number, number, number];

export type QuakeGameLogicTextLane = "notify" | "centerprint" | "console";

export type QuakeGameLogicTextSourceCall =
  | "sprint"
  | "centerprint"
  | "bprint"
  | "dprint"
  | "SUB_UseTargets";

export interface QuakeGameLogicTextFact {
  lane: QuakeGameLogicTextLane;
  text: string;
  sourceCall: QuakeGameLogicTextSourceCall;
  sourceFunction: string;
  sourceFile: string;
  sourceRef?: QuakeGameLogicProgramSourceRef;
}

export type QuakeGameLogicGeneratedTextReason =
  | "counter-complete"
  | "counter-remaining"
  | "door-key-required";

export type QuakeGameLogicDoorKey = "silver" | "gold";

export interface QuakeGameLogicGeneratedTextFact extends QuakeGameLogicTextFact {
  reason: QuakeGameLogicGeneratedTextReason;
  condition?: {
    key?: QuakeGameLogicDoorKey;
    minRemaining?: number;
    remaining?: number;
    spawnflagNotSet?: string;
    worldtype?: number;
  };
}

export interface QuakeGameLogicFacts {
  version: 1;
  sources: QuakeGameLogicSources;
  modes: {
    supported: readonly QuakeGameLogicSingleplayerMode[];
    unsupported: readonly QuakeGameLogicUnsupportedMode[];
    skillSpawnflagMasks: {
      notEasy: number;
      notNormal: number;
      notHard: number;
    };
    deathmatchSpawnflagMasks: {
      notDeathmatch: number;
    };
  };
  spawnSets: QuakeGameLogicSpawnSets;
  entities: QuakeGameLogicEntityFact[];
  targetGraph: Record<string, number[]>;
  runtimeIndexes: QuakeEntityRuntimeManifest;
  models: Record<string, QuakeGameLogicModelFact>;
  brushModels: Record<string, QuakeGameLogicBrushModelFact>;
  programFacts: QuakeGameLogicProgramFacts;
}

export interface QuakeGameLogicSources {
  bsp: {
    label: string;
    entityCount: number;
    modelCount: number;
    brushModelCount: number;
    worldtype?: number;
  };
  quakeC?: {
    repository: string;
    revision: string;
    sourceClassnames: string[];
  };
}

export interface QuakeGameLogicSpawnSets {
  singleplayerEasy: number[];
  singleplayerNormal: number[];
  singleplayerHard: number[];
}

export interface QuakeGameLogicModeEntityIndexSets {
  singleplayerEasy: number[];
  singleplayerNormal: number[];
  singleplayerHard: number[];
}

export interface QuakeGameLogicEntityFact {
  entityIndex: number;
  classname: string;
  category: QuakeEntityManifestCategory;
  runtimeStatus: QuakeEntityRuntimeStatus;
  spawnflags: number;
  modeMask: QuakeGameLogicMode[];
  properties: Record<string, number | string>;
  origin?: QuakeVertex;
  angle?: number;
  model?: string;
  modelIndex?: number;
  target?: string;
  targetname?: string;
  reason?: string;
  programClassname?: string;
  dependencyAssets?: QuakeGameLogicProgramAssetRef[];
  dependencyModels?: string[];
  dependencySounds?: string[];
  brushModel?: QuakeGameLogicEntityBrushModelRef;
  resolvedMover?: QuakeGameLogicResolvedMoverFact;
  resolvedPathCorner?: QuakeGameLogicResolvedPathCornerFact;
  resolvedPickup?: QuakeGameLogicResolvedPickupFact;
  resolvedTrigger?: QuakeGameLogicResolvedTriggerFact;
}

export interface QuakeGameLogicEntityBrushModelRef {
  modelIndex: number;
  kind: QuakeBrushCollisionKind;
  mins: QuakeVertex;
  maxs: QuakeVertex;
}

export type QuakeGameLogicResolvedMoverFact =
  | QuakeGameLogicResolvedFuncButtonFact
  | QuakeGameLogicResolvedFuncDoorFact
  | QuakeGameLogicResolvedFuncPlatFact
  | QuakeGameLogicResolvedFuncTrainFact;

export interface QuakeGameLogicResolvedFuncButtonFact {
  kind: "func_button";
  source: {
    spawnFunction: "func_button";
  };
  speed: number;
  wait: number;
  lip: number;
  sounds: number;
  activationSound?: string;
  damageable: boolean;
  health?: number;
  initialState: "bottom";
  pos1Origin: QuakeVertex;
  pos2Origin: QuakeVertex;
  initialOrigin: QuakeVertex;
  moveDirection: QuakeVertex;
  travelDistance: number;
  travelOffset: QuakeVertex;
  callbacks: {
    blocked?: string;
    use?: string;
    touch?: string;
    th_die?: string;
  };
}

export interface QuakeGameLogicResolvedFuncDoorFact {
  kind: "func_door";
  source: {
    spawnFunction: "func_door";
    linkFunction: "LinkDoors";
  };
  speed: number;
  wait: number;
  lip: number;
  dmg: number;
  sounds: number;
  startsOpen: boolean;
  spawnDoorTrigger: boolean;
  pos1Origin: QuakeVertex;
  pos2Origin: QuakeVertex;
  initialOrigin: QuakeVertex;
  moveDirection: QuakeVertex;
  travelDistance: number;
  travelOffset: QuakeVertex;
  requiredKey?: QuakeGameLogicDoorKey;
  generatedText?: QuakeGameLogicGeneratedTextFact[];
  linkedDoorGroup?: QuakeGameLogicFuncDoorGroupFact;
  trigger?: QuakeGameLogicFuncDoorTriggerFact;
  callbacks: {
    blocked?: string;
    touch?: string;
    use?: string;
    think?: string;
  };
}

export interface QuakeGameLogicFuncDoorGroupFact {
  sourceFunction: "LinkDoors";
  ownerEntityIndex: number;
  linkedEntityIndexes: number[];
  canSpawnTrigger: boolean;
}

export interface QuakeGameLogicFuncDoorTriggerFact {
  sourceFunction: "LinkDoors";
  ownerEntityIndex: number;
  modelIndex: number;
  linkedEntityIndexes: number[];
  expansion: {
    xy: number;
    z: number;
  };
  mins: QuakeVertex;
  maxs: QuakeVertex;
  touch: "door_touch";
}

export interface QuakeGameLogicResolvedFuncPlatFact {
  kind: "func_plat";
  source: {
    spawnFunction: "func_plat";
    triggerFunction: "plat_spawn_inside_trigger";
  };
  speed: number;
  waitAtTop: number;
  sounds: number;
  soundSet?: {
    move: string;
    stop: string;
  };
  startsTop: boolean;
  initialState: "bottom" | "top";
  topOrigin: QuakeVertex;
  bottomOrigin: QuakeVertex;
  initialOrigin: QuakeVertex;
  travelAxis: "z";
  travelDistance: number;
  travelOffset: QuakeVertex;
  trigger: QuakeGameLogicFuncPlatTriggerFact;
  callbacks: {
    blocked?: string;
    centerTouch: "plat_center_touch";
    use?: string;
  };
}

export interface QuakeGameLogicFuncPlatTriggerFact {
  sourceFunction: "plat_spawn_inside_trigger";
  ownerEntityIndex: number;
  modelIndex: number;
  lowTrigger: boolean;
  mins: QuakeVertex;
  maxs: QuakeVertex;
  touch: "plat_center_touch";
}

export interface QuakeGameLogicResolvedFuncTrainFact {
  kind: "func_train";
  source: {
    spawnFunction: "func_train";
    findFunction: "func_train_find";
    nextFunction: "train_next";
    waitFunction: "train_wait";
  };
  speed: number;
  dmg: number;
  sounds: number;
  soundSet?: {
    move: string;
    stop: string;
  };
  initialTarget?: string;
  initialTargetEntityIndexes: number[];
  firstPathCornerEntityIndex?: number;
  pathBaseOrigin?: QuakeVertex;
  quakeCInitialOrigin?: QuakeVertex;
  path: {
    cornerEntityIndexes: number[];
    loops: boolean;
    missingTargetnames: string[];
  };
  callbacks: {
    blocked?: string;
    use?: string;
    think?: string;
  };
}

export interface QuakeGameLogicResolvedPathCornerFact {
  kind: "path_corner";
  target?: string;
  targetname?: string;
  wait: number;
  origin: QuakeVertex;
  nextEntityIndexes: number[];
}

export type QuakeGameLogicPickupKey = "silver" | "gold";

export interface QuakeGameLogicPickupInventoryDeltaFact {
  health?: number;
  healthMax?: number;
  armor?: number;
  shells?: number;
  nails?: number;
  rockets?: number;
  cells?: number;
  key?: QuakeGameLogicPickupKey;
}

export type QuakeGameLogicAmmoInventoryField = "shells" | "nails" | "rockets" | "cells";

export type QuakeGameLogicResolvedPickupKind =
  | "ammo_cells"
  | "ammo_nails"
  | "ammo_rockets"
  | "ammo_shells"
  | "item_armor1"
  | "item_armor2"
  | "item_armorInv"
  | "item_artifact_envirosuit"
  | "item_artifact_invisibility"
  | "item_artifact_invulnerability"
  | "item_artifact_super_damage"
  | "item_cells"
  | "item_health"
  | "item_key1"
  | "item_key2"
  | "item_rockets"
  | "item_shells"
  | "item_sigil"
  | "item_spikes"
  | "item_weapon"
  | "key_gold"
  | "key_silver"
  | "weapon_grenadelauncher"
  | "weapon_lightning"
  | "weapon_nailgun"
  | "weapon_rocketlauncher"
  | "weapon_supernailgun"
  | "weapon_supershotgun";

export interface QuakeGameLogicResolvedPickupFact {
  kind: QuakeGameLogicResolvedPickupKind;
  source: {
    spawnFunction: string;
    startFunction?: "StartItem";
  };
  modelPath?: string;
  inventoryDelta: QuakeGameLogicPickupInventoryDeltaFact;
  behavior?: QuakeGameLogicResolvedPickupBehaviorFact;
  lifecycle?: QuakeGameLogicResolvedPickupLifecycleFact;
  feedback?: {
    sound?: string;
    message?: string;
    text?: QuakeGameLogicTextFact;
  };
  spawnflagChecks: QuakeGameLogicProgramSpawnflagCheck[];
  callbacks: {
    touch?: string;
  };
}

export interface QuakeGameLogicResolvedPickupLifecycleFact {
  pickup: {
    disablesTouch: boolean;
    firesTargets: boolean;
    hidesModel: boolean;
    hideCondition?: string;
  };
  respawn: {
    function?: "SUB_regen";
    rules: QuakeGameLogicResolvedPickupRespawnRuleFact[];
  };
}

export interface QuakeGameLogicResolvedPickupRespawnRuleFact {
  action: "leave" | "remove" | "respawn" | "rot";
  condition: string;
  delaySeconds?: number;
  think?: "item_megahealth_rot" | "SUB_regen";
}

export interface QuakeGameLogicResolvedPickupBehaviorFact {
  ammo?: {
    inventoryField: QuakeGameLogicAmmoInventoryField;
    playerField: string;
    amount: number;
    smallAmount: number;
    bigAmount: number;
    rejectAtOrAboveAmount: number;
    clampMaxAmount: number;
    box: "small" | "big";
    spawnflag: {
      name: "WEAPON_BIG2";
      value: number;
      set: boolean;
    };
    activeWeapon: {
      bestWeaponFunction: "W_BestWeapon";
      clampAmmoFunction: "bound_other_ammo";
      currentAmmoFunction: "W_SetCurrentAmmo";
      assignment: "self.weapon = W_BestWeapon()";
    };
  };
  armor?: {
    armorType: number;
    armorValue: number;
    replacementScore: number;
    replacesWhenCurrentScoreBelow: number;
    itemFlag: number;
    itemFlagExpression: string;
    clearsItemFlagExpression: "IT_ARMOR1 | IT_ARMOR2 | IT_ARMOR3";
  };
  health?: {
    healAmount: number;
    healFunction: "T_Heal";
    healType: 0 | 1 | 2;
    healthMax: number;
    ignoreMaxHealth: boolean;
    rejectAtOrAboveHealth: number;
    megahealth?: {
      itemFlagExpression: "IT_SUPERHEALTH";
      rotDelaySeconds: number;
      rotThink: "item_megahealth_rot";
    };
  };
  key?: {
    key: QuakeGameLogicDoorKey;
    itemFlag: number;
    itemFlagExpression: string;
    itemFlagMutation: {
      expression: "other.items | self.items";
      sourceField: "self.items";
      targetField: "other.items";
    };
    ownedKeyReject: {
      expression: "other.items & self.items";
      playerField: "items";
      sourceField: "self.items";
    };
  };
  powerup?: {
    activationField: string;
    activationValue: 1;
    durationSeconds: number;
    finishedExpression: string;
    finishedField: string;
    itemFlag: number;
    itemFlagExpression: string;
    itemFlagMutation: {
      expression: "other.items | self.items";
      sourceField: "self.items";
      targetField: "other.items";
    };
  };
  weapon?: {
    itemFlag: number;
    itemFlagExpression: string;
    ammoGrant: {
      inventoryField: QuakeGameLogicAmmoInventoryField;
      playerField: string;
      amount: number;
      hadAmmoPlayerField: string;
    };
    ownedWeaponReject: {
      condition: "deathmatch == 2 || coop";
      itemFlagExpression: string;
    };
    activeWeapon: {
      bestWeaponFunction: "W_BestWeapon";
      clampAmmoFunction: "bound_other_ammo";
      currentAmmoFunction: "W_SetCurrentAmmo";
      deathmatchFunction: "Deathmatch_Weapon";
      singleplayerAssignment: "self.weapon = new";
    };
  };
}

export type QuakeGameLogicResolvedTriggerKind =
  | "trigger_changelevel"
  | "trigger_counter"
  | "trigger_hurt"
  | "trigger_monsterjump"
  | "trigger_multiple"
  | "trigger_onlyregistered"
  | "trigger_once"
  | "trigger_push"
  | "trigger_relay"
  | "trigger_secret"
  | "trigger_setskill"
  | "trigger_teleport";

export interface QuakeGameLogicResolvedTriggerFact {
  kind: QuakeGameLogicResolvedTriggerKind;
  source: {
    spawnFunction: QuakeGameLogicResolvedTriggerKind;
    inheritedSpawnFunction?: "trigger_multiple";
    initFunction?: "InitTrigger";
  };
  targetUse: {
    delay: number;
    target?: string;
    targetEntityIndexes: number[];
    activeTargetEntityIndexesByMode: QuakeGameLogicModeEntityIndexSets;
    killtarget?: string;
    killtargetEntityIndexes?: number[];
    activeKilltargetEntityIndexesByMode?: QuakeGameLogicModeEntityIndexSets;
  };
  wait?: number;
  count?: number;
  dmg?: number;
  speed?: number;
  height?: number;
  sounds?: number;
  activationSound?: string;
  health?: number;
  message?: string;
  messageText?: QuakeGameLogicTextFact;
  generatedText?: QuakeGameLogicGeneratedTextFact[];
  skillValue?: number;
  moveDirection?: QuakeVertex;
  pushVelocityMultiplier?: number;
  registeredOnly?: boolean;
  damageable: boolean;
  oneShot: boolean;
  touchActivates: boolean;
  useActivates: boolean;
  requiresUseBeforeTouch?: boolean;
  destinationEntityIndexes?: number[];
  changelevelMap?: string;
  spawnflagChecks: QuakeGameLogicProgramSpawnflagCheck[];
  callbacks: {
    touch?: string;
    use?: string;
    th_die?: string;
  };
}

export interface QuakeGameLogicModelFact {
  modelIndex: number;
  mins: QuakeVertex;
  maxs: QuakeVertex;
  origin: QuakeVertex;
  headNodes: [number, number, number, number];
  hulls: QuakeGameLogicHullFact[];
  firstFace: number;
  faceCount: number;
}

export interface QuakeGameLogicBrushModelFact extends QuakeGameLogicModelFact {
  entityIndex: number;
  classname: string;
  kind: QuakeBrushCollisionKind;
  target?: string;
  targetname?: string;
}

export interface QuakeGameLogicHullFact {
  index: number;
  headNode: number;
  mins: QuakeVertex;
  maxs: QuakeVertex;
}

export interface QuakeGameLogicProgramFacts {
  version: 1;
  source?: {
    repository: string;
    revision: string;
  };
  entities: Record<string, QuakeGameLogicProgramEntityFact>;
  missingClassnames: string[];
}

export interface QuakeGameLogicProgramEntityFact {
  assetRefs: QuakeGameLogicProgramAssetRef[];
  callbackFacts?: Record<string, QuakeGameLogicProgramCallbackFact>;
  classname: string;
  functionName: string;
  kind: string;
  callbacks: Record<string, string>;
  calls: string[];
  dependencies: {
    models: string[];
    sounds: string[];
  };
  defaultAssignments: QuakeGameLogicProgramAssignment[];
  fieldAssignments: QuakeGameLogicProgramAssignment[];
  setmodels: QuakeGameLogicProgramSetmodel[];
  setsizes: QuakeGameLogicProgramSetsize[];
  source?: QuakeGameLogicProgramSourceMetadata;
  sourceRefs: QuakeGameLogicProgramSourceRef[];
  spawnflagChecks: QuakeGameLogicProgramSpawnflagCheck[];
}

export interface QuakeGameLogicProgramCallbackClassnameBranchFact {
  assignments: QuakeGameLogicProgramAssignment[];
  classname: string;
  sourceRef?: QuakeGameLogicProgramSourceRef;
}

export interface QuakeGameLogicProgramCallbackFact {
  assignments?: QuakeGameLogicProgramAssignment[];
  calls?: string[];
  classnameBranches?: QuakeGameLogicProgramCallbackClassnameBranchFact[];
  sourceRefs: QuakeGameLogicProgramSourceRef[];
}

export interface QuakeGameLogicProgramAssetRef {
  call: string;
  kind: string;
  path: string;
  sourceRef?: QuakeGameLogicProgramSourceRef;
}

export interface QuakeGameLogicProgramSourceMetadata {
  license?: string;
  repository?: string;
  revision?: string;
  sourceFile?: string;
  sourceSha256?: string;
  sourceUrl?: string;
}

export interface QuakeGameLogicProgramSourceRef {
  sourceFile: string;
  functionName: string;
  line: number;
}

export interface QuakeGameLogicProgramAssignment {
  condition?: string;
  expression: string;
  field: string;
  sourceRef?: QuakeGameLogicProgramSourceRef;
  value?: QuakeGameLogicProgramValue;
}

export interface QuakeGameLogicProgramSetmodel {
  expression: string;
  sourceRef?: QuakeGameLogicProgramSourceRef;
  value?: QuakeGameLogicProgramValue;
}

export interface QuakeGameLogicProgramSetsize {
  max?: QuakeGameLogicProgramValue;
  maxExpression: string;
  min?: QuakeGameLogicProgramValue;
  minExpression: string;
  sourceRef?: QuakeGameLogicProgramSourceRef;
}

export interface QuakeGameLogicProgramSpawnflagCheck {
  name: string;
  sourceRef?: QuakeGameLogicProgramSourceRef;
  value?: number;
}

export interface QuakeGameLogicProgramFactsInput {
  version?: number;
  source?: {
    repository?: unknown;
    revision?: unknown;
  };
  entities?: Record<string, unknown>;
}

export interface BuildQuakeGameLogicFactsInput {
  label: string;
  entities: QuakeEntity[];
  entityManifest: QuakeEntityManifest;
  models: QuakePreparedModel[];
  collision?: QuakePreparedCollision;
  programFacts?: QuakeGameLogicProgramFactsInput | null;
}

const QUAKE_SPAWNFLAG_NOT_EASY = 256;
const QUAKE_SPAWNFLAG_NOT_NORMAL = 512;
const QUAKE_SPAWNFLAG_NOT_HARD = 1024;
const QUAKE_SPAWNFLAG_NOT_DEATHMATCH = 2048;
const QUAKE_DOOR_START_OPEN = 1;
const QUAKE_DOOR_DONT_LINK = 4;
const QUAKE_DOOR_GOLD_KEY = 8;
const QUAKE_DOOR_SILVER_KEY = 16;
const QUAKE_DOOR_DEFAULT_SPEED = 100;
const QUAKE_DOOR_DEFAULT_WAIT = 3;
const QUAKE_DOOR_DEFAULT_LIP = 8;
const QUAKE_DOOR_DEFAULT_DMG = 2;
const QUAKE_DOOR_DEFAULT_SOUNDS = 0;
const QUAKE_DOOR_TRIGGER_XY = 60;
const QUAKE_DOOR_TRIGGER_Z = 8;
const QUAKE_DOOR_LINK_GAP = 1;
const QUAKE_BUTTON_DEFAULT_SPEED = 40;
const QUAKE_BUTTON_DEFAULT_WAIT = 1;
const QUAKE_BUTTON_DEFAULT_LIP = 4;
const QUAKE_BUTTON_DEFAULT_SOUNDS = 3;
const QUAKE_TRAIN_DEFAULT_SPEED = 100;
const QUAKE_TRAIN_DEFAULT_DMG = 2;
const QUAKE_TRAIN_DEFAULT_SOUNDS = 0;
const QUAKE_TRAIN_MAX_PATH_CORNERS = 128;
const QUAKE_TRIGGER_MULTIPLE_DEFAULT_WAIT = 0.2;
const QUAKE_TRIGGER_MULTIPLE_DEFAULT_SOUNDS = 3;
const QUAKE_TRIGGER_NOTOUCH = 1;
const QUAKE_TRIGGER_HURT_DEFAULT_DMG = 5;
const QUAKE_TRIGGER_SECRET_DEFAULT_MESSAGE = "You found a secret area!";
const QUAKE_TRIGGER_SECRET_DEFAULT_SOUNDS = 1;
const QUAKE_TRIGGER_COUNTER_DEFAULT_COUNT = 2;
const QUAKE_TRIGGER_COUNTER_NOMESSAGE = 1;
const QUAKE_TRIGGER_PUSH_DEFAULT_SPEED = 1000;
const QUAKE_TRIGGER_PUSH_VELOCITY_MULTIPLIER = 10;
const QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_SPEED = 200;
const QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_HEIGHT = 200;
const QUAKE_PICKUP_BIG = 1;
const QUAKE_HEALTH_ROTTEN = 1;
const QUAKE_HEALTH_MEGA = 2;
const QUAKE_PLAT_LOW_TRIGGER = 1;
const QUAKE_PLAT_DEFAULT_SPEED = 150;
const QUAKE_PLAT_DEFAULT_SOUNDS = 2;
const QUAKE_PLAT_WAIT_AT_TOP = 3;
const QUAKE_PLAT_TRIGGER_INSET = 25;
const QUAKE_PLAT_TRIGGER_MIN_SIDE = 50;
const QUAKE_PLAT_TRIGGER_TOP_EXTRA = 8;
const QUAKE_PLAT_TRIGGER_LOW_HEIGHT = 8;

const SUPPORTED_SINGLEPLAYER_MODES = [
  "singleplayer:easy",
  "singleplayer:normal",
  "singleplayer:hard",
] as const satisfies readonly QuakeGameLogicSingleplayerMode[];

const UNSUPPORTED_MODES = [
  "multiplayer:deathmatch",
  "multiplayer:coop",
] as const satisfies readonly QuakeGameLogicUnsupportedMode[];

const NORMALIZED_ENTITY_PROPERTY_KEYS = [
  "armorvalue",
  "count",
  "delay",
  "dmg",
  "health",
  "height",
  "items",
  "killtarget",
  "light",
  "lip",
  "map",
  "message",
  "noise",
  "noise1",
  "noise2",
  "noise3",
  "noise4",
  "speed",
  "sounds",
  "style",
  "target",
  "targetname",
  "wait",
  "worldtype",
] as const;

export function buildQuakeGameLogicFacts(input: BuildQuakeGameLogicFactsInput): QuakeGameLogicFacts {
  const manifestEntryByIndex = new Map(input.entityManifest.entries.map((entry) => [entry.entityIndex, entry]));
  const programFacts = buildQuakeGameLogicProgramFacts(input.programFacts, input.entities);
  const programFactByClassname = programFacts.entities;
  const targetGraph = input.entityManifest.runtime.targetEntities;
  const worldtype = quakeGameLogicWorldtype(input.entities);
  const brushModelByModelIndex = new Map(
    (input.collision?.brushModels ?? []).map((brushModel) => [brushModel.modelIndex, brushModel]),
  );
  const entities = input.entities.map((entity) => buildQuakeGameLogicEntityFact(
    entity,
    manifestEntryByIndex.get(entity.index),
    programFactByClassname[entity.classname],
    programFactByClassname,
    targetGraph,
    entity.modelIndex === undefined ? undefined : brushModelByModelIndex.get(entity.modelIndex),
    worldtype,
  ));
  resolveQuakeGameLogicDoorGroups(entities);
  resolveQuakeGameLogicTriggerTargetSets(entities);
  resolveQuakeGameLogicTrainPaths(entities);

  return {
    version: 1,
    sources: {
      bsp: {
        label: input.label,
        entityCount: input.entities.length,
        modelCount: input.models.length,
        brushModelCount: input.collision?.brushModels.length ?? 0,
        ...(worldtype !== undefined ? { worldtype } : {}),
      },
      ...(programFacts.source ? {
        quakeC: {
          repository: programFacts.source.repository,
          revision: programFacts.source.revision,
          sourceClassnames: Object.keys(programFacts.entities).sort(),
        },
      } : {}),
    },
    modes: {
      supported: [...SUPPORTED_SINGLEPLAYER_MODES],
      unsupported: [...UNSUPPORTED_MODES],
      skillSpawnflagMasks: {
        notEasy: QUAKE_SPAWNFLAG_NOT_EASY,
        notNormal: QUAKE_SPAWNFLAG_NOT_NORMAL,
        notHard: QUAKE_SPAWNFLAG_NOT_HARD,
      },
      deathmatchSpawnflagMasks: {
        notDeathmatch: QUAKE_SPAWNFLAG_NOT_DEATHMATCH,
      },
    },
    spawnSets: buildQuakeGameLogicSpawnSets(entities),
    entities,
    targetGraph: cloneTargetGraph(targetGraph),
    runtimeIndexes: cloneQuakeGameLogicRuntimeIndexes(input.entityManifest.runtime),
    models: buildQuakeGameLogicModelFacts(input.models),
    brushModels: buildQuakeGameLogicBrushModelFacts(input.collision?.brushModels ?? [], input.models),
    programFacts,
  };
}

export function cloneQuakeGameLogicFacts(facts: QuakeGameLogicFacts): QuakeGameLogicFacts {
  return JSON.parse(JSON.stringify(facts)) as QuakeGameLogicFacts;
}

export function indexQuakeGameLogicEntityFacts(
  facts: QuakeGameLogicFacts | null | undefined,
): Map<number, QuakeGameLogicEntityFact> {
  return new Map((facts?.entities ?? []).map((entity) => [entity.entityIndex, entity]));
}

export function quakeGameLogicEntityFact(
  facts: QuakeGameLogicFacts | null | undefined,
  entityIndex: number,
): QuakeGameLogicEntityFact | undefined {
  return indexQuakeGameLogicEntityFacts(facts).get(entityIndex);
}

export function quakeGameLogicResolvedMoverFact(
  facts: QuakeGameLogicFacts | null | undefined,
  entityIndex: number,
): QuakeGameLogicResolvedMoverFact | undefined {
  return quakeGameLogicEntityFact(facts, entityIndex)?.resolvedMover;
}

export function quakeGameLogicResolvedTriggerFact(
  facts: QuakeGameLogicFacts | null | undefined,
  entityIndex: number,
): QuakeGameLogicResolvedTriggerFact | undefined {
  return quakeGameLogicEntityFact(facts, entityIndex)?.resolvedTrigger;
}

export function quakeGameLogicResolvedPathCornerFact(
  facts: QuakeGameLogicFacts | null | undefined,
  entityIndex: number,
): QuakeGameLogicResolvedPathCornerFact | undefined {
  return quakeGameLogicEntityFact(facts, entityIndex)?.resolvedPathCorner;
}

export function quakeGameLogicResolvedPickupFact(
  facts: QuakeGameLogicFacts | null | undefined,
  entityIndex: number,
): QuakeGameLogicResolvedPickupFact | undefined {
  return quakeGameLogicEntityFact(facts, entityIndex)?.resolvedPickup;
}

function buildQuakeGameLogicEntityFact(
  entity: QuakeEntity,
  manifestEntry: QuakeEntityManifest["entries"][number] | undefined,
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  programFactByClassname: Record<string, QuakeGameLogicProgramEntityFact>,
  targetGraph: Record<string, number[]>,
  brushModel: QuakePreparedBrushCollision | undefined,
  worldtype: number | undefined,
): QuakeGameLogicEntityFact {
  const spawnflags = manifestEntry?.spawnflags ?? parseFiniteInteger(entity.properties.spawnflags) ?? 0;
  const resolvedMover = buildQuakeGameLogicResolvedMoverFact(entity, spawnflags, programFact, targetGraph, brushModel, worldtype);
  const resolvedPathCorner = buildQuakeGameLogicResolvedPathCornerFact(entity, targetGraph);
  const resolvedPickup = buildQuakeGameLogicResolvedPickupFact(
    entity,
    spawnflags,
    programFact,
    programFactByClassname,
    worldtype,
  );
  const resolvedTrigger = buildQuakeGameLogicResolvedTriggerFact(
    entity,
    spawnflags,
    programFact,
    programFactByClassname,
    targetGraph,
  );
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    category: manifestEntry?.category ?? "unknown",
    runtimeStatus: manifestEntry?.runtimeStatus ?? "metadata-only",
    spawnflags,
    modeMask: quakeGameLogicModeMask(entity, spawnflags),
    properties: normalizedEntityProperties(entity),
    ...(entity.origin ? { origin: { ...entity.origin } } : {}),
    ...(entity.angle !== undefined ? { angle: entity.angle } : {}),
    ...(entity.model !== undefined ? { model: entity.model } : {}),
    ...(entity.modelIndex !== undefined ? { modelIndex: entity.modelIndex } : {}),
    ...(manifestEntry?.target ? { target: manifestEntry.target } : {}),
    ...(manifestEntry?.targetname ? { targetname: manifestEntry.targetname } : {}),
    ...(manifestEntry?.reason ? { reason: manifestEntry.reason } : {}),
    ...(programFact ? {
      programClassname: programFact.classname,
      dependencyAssets: programFact.assetRefs.map(cloneProgramAssetRef),
      dependencyModels: [...programFact.dependencies.models],
      dependencySounds: [...programFact.dependencies.sounds],
    } : {}),
    ...(brushModel ? {
      brushModel: {
        modelIndex: brushModel.modelIndex,
        kind: brushModel.kind,
        mins: { ...brushModel.mins },
        maxs: { ...brushModel.maxs },
      },
    } : {}),
    ...(resolvedMover ? { resolvedMover } : {}),
    ...(resolvedPathCorner ? { resolvedPathCorner } : {}),
    ...(resolvedPickup ? { resolvedPickup } : {}),
    ...(resolvedTrigger ? { resolvedTrigger } : {}),
  };
}

function cloneProgramAssetRef(ref: QuakeGameLogicProgramAssetRef): QuakeGameLogicProgramAssetRef {
  return {
    call: ref.call,
    kind: ref.kind,
    path: ref.path,
    ...(ref.sourceRef ? { sourceRef: { ...ref.sourceRef } } : {}),
  };
}

function buildQuakeGameLogicResolvedMoverFact(
  entity: QuakeEntity,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  targetGraph: Record<string, number[]>,
  brushModel: QuakePreparedBrushCollision | undefined,
  worldtype: number | undefined,
): QuakeGameLogicResolvedMoverFact | undefined {
  if (entity.classname === "func_plat") {
    if (!brushModel || brushModel.kind !== "solid") return undefined;
    return buildQuakeGameLogicResolvedFuncPlatFact(entity, spawnflags, programFact, brushModel);
  }
  if (entity.classname === "func_door") {
    if (!brushModel || brushModel.kind !== "solid") return undefined;
    return buildQuakeGameLogicResolvedFuncDoorFact(entity, spawnflags, programFact, brushModel, worldtype);
  }
  if (entity.classname === "func_button") {
    if (!brushModel || brushModel.kind !== "solid") return undefined;
    return buildQuakeGameLogicResolvedFuncButtonFact(entity, programFact, brushModel);
  }
  if (entity.classname === "func_train") {
    if (!brushModel || brushModel.kind !== "solid") return undefined;
    return buildQuakeGameLogicResolvedFuncTrainFact(entity, programFact, targetGraph, brushModel);
  }
  return undefined;
}

function buildQuakeGameLogicResolvedPickupFact(
  entity: QuakeEntity,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  programFactByClassname: Record<string, QuakeGameLogicProgramEntityFact>,
  worldtype: number | undefined,
): QuakeGameLogicResolvedPickupFact | undefined {
  if (!isQuakeGameLogicResolvedPickupKind(entity.classname)) return undefined;
  const sourceProgramFact = programFact ?? programFactByClassname[quakeGameLogicPickupProgramClassnameAlias(entity.classname)];
  if (!sourceProgramFact) return undefined;
  const behavior = quakeResolvedPickupBehavior(entity.classname, spawnflags, sourceProgramFact);
  const inventoryDelta = quakeResolvedPickupInventoryDelta(entity.classname, spawnflags, sourceProgramFact, behavior);
  const modelPath = quakeResolvedPickupModelPath(entity.classname, spawnflags, sourceProgramFact);
  const lifecycle = quakeResolvedPickupLifecycle(entity.classname, spawnflags, sourceProgramFact);
  const feedback = quakeResolvedPickupFeedback(entity.classname, spawnflags, sourceProgramFact, worldtype, inventoryDelta);
  return {
    kind: entity.classname,
    source: {
      spawnFunction: sourceProgramFact.functionName,
      ...(sourceProgramFact.calls.includes("StartItem") ? { startFunction: "StartItem" as const } : {}),
    },
    ...(modelPath ? { modelPath } : {}),
    inventoryDelta,
    ...(behavior ? { behavior } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(feedback ? { feedback } : {}),
    spawnflagChecks: sourceProgramFact.spawnflagChecks.map(cloneProgramSpawnflagCheck),
    callbacks: {
      ...(sourceProgramFact.callbacks.touch ? { touch: sourceProgramFact.callbacks.touch } : {}),
    },
  };
}

function isQuakeGameLogicResolvedPickupKind(classname: string): classname is QuakeGameLogicResolvedPickupKind {
  return classname === "ammo_cells" ||
    classname === "ammo_nails" ||
    classname === "ammo_rockets" ||
    classname === "ammo_shells" ||
    classname === "item_armor1" ||
    classname === "item_armor2" ||
    classname === "item_armorInv" ||
    classname === "item_artifact_envirosuit" ||
    classname === "item_artifact_invisibility" ||
    classname === "item_artifact_invulnerability" ||
    classname === "item_artifact_super_damage" ||
    classname === "item_cells" ||
    classname === "item_health" ||
    classname === "item_key1" ||
    classname === "item_key2" ||
    classname === "item_rockets" ||
    classname === "item_shells" ||
    classname === "item_sigil" ||
    classname === "item_spikes" ||
    classname === "item_weapon" ||
    classname === "key_gold" ||
    classname === "key_silver" ||
    classname === "weapon_grenadelauncher" ||
    classname === "weapon_lightning" ||
    classname === "weapon_nailgun" ||
    classname === "weapon_rocketlauncher" ||
    classname === "weapon_supernailgun" ||
    classname === "weapon_supershotgun";
}

function quakeGameLogicPickupProgramClassnameAlias(classname: QuakeGameLogicResolvedPickupKind): string {
  if (classname === "ammo_shells") return "item_shells";
  if (classname === "ammo_nails") return "item_spikes";
  if (classname === "ammo_rockets") return "item_rockets";
  if (classname === "ammo_cells") return "item_cells";
  if (classname === "key_silver") return "item_key1";
  if (classname === "key_gold") return "item_key2";
  return classname;
}

function quakeResolvedPickupInventoryDelta(
  classname: QuakeGameLogicResolvedPickupKind,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact,
  behavior?: QuakeGameLogicResolvedPickupBehaviorFact,
): QuakeGameLogicPickupInventoryDeltaFact {
  const big = (spawnflags & QUAKE_PICKUP_BIG) !== 0;
  if (classname === "item_health") {
    if ((spawnflags & QUAKE_HEALTH_ROTTEN) !== 0) {
      return {
        health: quakeProgramFieldNumberMatching(programFact, "healamount", 15),
        healthMax: 100,
      };
    }
    if ((spawnflags & QUAKE_HEALTH_MEGA) !== 0) {
      return {
        health: quakeProgramFieldNumberMatching(programFact, "healamount", 100),
        healthMax: 250,
      };
    }
    return { health: quakeProgramFieldNumberMatching(programFact, "healamount", 25), healthMax: 100 };
  }
  if (classname === "item_armor1" || classname === "item_armor2" || classname === "item_armorInv") {
    return { armor: behavior?.armor?.armorValue ?? quakeFallbackArmorValue(classname) };
  }
  const ammoInventoryDelta = quakeResolvedAmmoPickupInventoryDelta(behavior?.ammo);
  if (ammoInventoryDelta) return ammoInventoryDelta;
  if (classname === "item_shells" || classname === "ammo_shells") return { shells: big ? 40 : 20 };
  if (classname === "item_spikes" || classname === "ammo_nails") return { nails: big ? 50 : 25 };
  if (classname === "item_rockets" || classname === "ammo_rockets") return { rockets: big ? 10 : 5 };
  if (classname === "item_cells" || classname === "ammo_cells") return { cells: big ? 12 : 6 };
  const weaponInventoryDelta = quakeResolvedAmmoPickupInventoryDelta(behavior?.weapon?.ammoGrant);
  if (weaponInventoryDelta) return weaponInventoryDelta;
  if (classname === "weapon_nailgun" || classname === "weapon_supernailgun") return { nails: 30 };
  if (classname === "weapon_supershotgun") return { shells: 5 };
  if (classname === "weapon_grenadelauncher" || classname === "weapon_rocketlauncher") return { rockets: 5 };
  if (classname === "weapon_lightning") return { cells: 15 };
  if (classname === "item_key1" || classname === "key_silver") return { key: "silver" };
  if (classname === "item_key2" || classname === "key_gold") return { key: "gold" };
  return {};
}

function quakeResolvedPickupBehavior(
  classname: QuakeGameLogicResolvedPickupKind,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact,
): QuakeGameLogicResolvedPickupBehaviorFact | undefined {
  const ammo = quakeResolvedAmmoPickupBehavior(classname, spawnflags, programFact);
  const armor = quakeResolvedArmorPickupBehavior(classname, programFact);
  const health = quakeResolvedHealthPickupBehavior(classname, spawnflags, programFact);
  const key = quakeResolvedKeyPickupBehavior(classname, programFact);
  const powerup = quakeResolvedPowerupPickupBehavior(classname, programFact);
  const weapon = quakeResolvedWeaponPickupBehavior(classname, programFact);
  if (!ammo && !armor && !health && !key && !powerup && !weapon) return undefined;
  return {
    ...(ammo ? { ammo } : {}),
    ...(armor ? { armor } : {}),
    ...(health ? { health } : {}),
    ...(key ? { key } : {}),
    ...(powerup ? { powerup } : {}),
    ...(weapon ? { weapon } : {}),
  };
}

function quakeResolvedPickupLifecycle(
  classname: QuakeGameLogicResolvedPickupKind,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact,
): QuakeGameLogicResolvedPickupLifecycleFact | undefined {
  const touchCallback = programFact.callbacks.touch;
  if (!touchCallback) return undefined;
  const callbackFact = programFact.callbackFacts?.[touchCallback];
  if (!callbackFact) return undefined;
  const hidesModel = quakeProgramCallbackHasAssignment(callbackFact, "self.model", "string_null");
  const disablesTouch = quakeProgramCallbackHasAssignment(callbackFact, "self.solid", "SOLID_NOT");
  const firesTargets = quakeProgramCallbackCalls(callbackFact, "SUB_UseTargets");
  if (!hidesModel && !disablesTouch && !firesTargets) return undefined;
  const rules = quakeResolvedPickupRespawnRules(classname, spawnflags, touchCallback, callbackFact);
  const usesRegenThink = quakeProgramCallbackHasAssignment(callbackFact, "self.think", "SUB_regen") &&
    rules.some((rule) => rule.think === "SUB_regen");
  const hideCondition = quakeResolvedPickupHideCondition(touchCallback);
  return {
    pickup: {
      disablesTouch,
      firesTargets,
      hidesModel,
      ...(hideCondition ? { hideCondition } : {}),
    },
    respawn: {
      ...(usesRegenThink ? { function: "SUB_regen" as const } : {}),
      rules,
    },
  };
}

function quakeResolvedPickupHideCondition(touchCallback: string): string | undefined {
  if (touchCallback === "key_touch") return "!coop";
  if (touchCallback === "weapon_touch") return "!(deathmatch == 2 || coop)";
  return undefined;
}

function quakeResolvedPickupRespawnRules(
  classname: QuakeGameLogicResolvedPickupKind,
  spawnflags: number,
  touchCallback: string,
  callbackFact: QuakeGameLogicProgramCallbackFact,
): QuakeGameLogicResolvedPickupRespawnRuleFact[] {
  if (touchCallback === "health_touch") {
    if ((spawnflags & QUAKE_HEALTH_MEGA) !== 0) {
      const rotDelay = quakeProgramCallbackNextthinkOffsetSeconds(callbackFact, "time + 5");
      return rotDelay === undefined ? [] : [
        {
          action: "rot",
          condition: "pickup",
          delaySeconds: rotDelay,
          think: "item_megahealth_rot",
        },
      ];
    }
    const delaySeconds = quakeProgramCallbackNextthinkOffsetSeconds(callbackFact, "time + 20");
    return [
      ...(delaySeconds === undefined ? [] : [{
        action: "respawn" as const,
        condition: "deathmatch && deathmatch != 2",
        delaySeconds,
        think: "SUB_regen" as const,
      }]),
      {
        action: "remove",
        condition: "singleplayer || deathmatch == 2",
      },
    ];
  }
  if (touchCallback === "armor_touch") {
    return quakePickupRespawnOrRemoveRules(callbackFact, "time + 20", "deathmatch == 1", "singleplayer || deathmatch != 1");
  }
  if (touchCallback === "ammo_touch") {
    return quakePickupRespawnOrRemoveRules(callbackFact, "time + 30", "deathmatch == 1", "singleplayer || deathmatch != 1");
  }
  if (touchCallback === "weapon_touch") {
    return [
      {
        action: "leave",
        condition: "deathmatch == 2 || coop",
      },
      ...quakePickupRespawnOrRemoveRules(callbackFact, "time + 30", "deathmatch == 1", "singleplayer"),
    ];
  }
  if (touchCallback === "key_touch") {
    return [
      {
        action: "leave",
        condition: "coop",
      },
      {
        action: "remove",
        condition: "!coop",
      },
    ];
  }
  if (touchCallback === "powerup_touch") {
    const respawnExpression = classname === "item_artifact_invulnerability" || classname === "item_artifact_invisibility"
      ? "time + 60*5"
      : "time + 60";
    return quakePickupRespawnOrRemoveRules(callbackFact, respawnExpression, "deathmatch", "!deathmatch");
  }
  return [];
}

function quakePickupRespawnOrRemoveRules(
  callbackFact: QuakeGameLogicProgramCallbackFact,
  respawnExpression: string,
  respawnCondition: string,
  removeCondition: string,
): QuakeGameLogicResolvedPickupRespawnRuleFact[] {
  const delaySeconds = quakeProgramCallbackNextthinkOffsetSeconds(callbackFact, respawnExpression);
  return [
    ...(delaySeconds === undefined ? [] : [{
      action: "respawn" as const,
      condition: respawnCondition,
      delaySeconds,
      think: "SUB_regen" as const,
    }]),
    {
      action: "remove",
      condition: removeCondition,
    },
  ];
}

function quakeResolvedAmmoPickupBehavior(
  classname: QuakeGameLogicResolvedPickupKind,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact,
): NonNullable<QuakeGameLogicResolvedPickupBehaviorFact["ammo"]> | undefined {
  if (programFact.callbacks.touch !== "ammo_touch") return undefined;
  const callbackFact = programFact.callbackFacts?.ammo_touch;
  if (!callbackFact) return undefined;
  const inventoryField = quakeAmmoInventoryFieldForPickup(classname, programFact);
  const amounts = quakeProgramAmmoBoxAmounts(programFact);
  const spawnflag = programFact.spawnflagChecks.find((check) => check.name === "WEAPON_BIG2");
  const playerField = inventoryField ? `ammo_${inventoryField}` : undefined;
  const writesInventoryField = playerField && callbackFact.assignments?.some((assignment) =>
    assignment.field === `other.${playerField}` &&
    assignment.expression === `other.${playerField} + self.aflag`
  );
  const hasActiveWeaponFacts = quakeProgramCallbackCalls(callbackFact, "W_BestWeapon") &&
    quakeProgramCallbackCalls(callbackFact, "bound_other_ammo") &&
    quakeProgramCallbackCalls(callbackFact, "W_SetCurrentAmmo") &&
    quakeProgramCallbackHasAssignment(callbackFact, "self.weapon", "W_BestWeapon()");

  if (
    inventoryField === undefined ||
    playerField === undefined ||
    amounts === undefined ||
    spawnflag === undefined ||
    !writesInventoryField ||
    !hasActiveWeaponFacts
  ) {
    return undefined;
  }

  const big = (spawnflags & spawnflag.value) !== 0;
  return {
    inventoryField,
    playerField,
    amount: big ? amounts.bigAmount : amounts.smallAmount,
    smallAmount: amounts.smallAmount,
    bigAmount: amounts.bigAmount,
    rejectAtOrAboveAmount: quakeAmmoPickupRejectAtOrAboveAmount(inventoryField),
    clampMaxAmount: quakeAmmoClampMaxAmount(inventoryField),
    box: big ? "big" : "small",
    spawnflag: {
      name: "WEAPON_BIG2",
      value: spawnflag.value,
      set: big,
    },
    activeWeapon: {
      bestWeaponFunction: "W_BestWeapon",
      clampAmmoFunction: "bound_other_ammo",
      currentAmmoFunction: "W_SetCurrentAmmo",
      assignment: "self.weapon = W_BestWeapon()",
    },
  };
}

function quakeAmmoInventoryFieldForPickup(
  classname: QuakeGameLogicResolvedPickupKind,
  programFact: QuakeGameLogicProgramEntityFact,
): QuakeGameLogicAmmoInventoryField | undefined {
  const netname = quakeProgramFieldString(programFact, "netname");
  if (netname === "shells") return "shells";
  if (netname === "nails") return "nails";
  if (netname === "rockets") return "rockets";
  if (netname === "cells") return "cells";
  if (classname === "ammo_shells") return "shells";
  if (classname === "ammo_nails") return "nails";
  if (classname === "ammo_rockets") return "rockets";
  if (classname === "ammo_cells") return "cells";
  return undefined;
}

function quakeProgramAmmoBoxAmounts(
  programFact: QuakeGameLogicProgramEntityFact,
): { smallAmount: number; bigAmount: number } | undefined {
  const values = programFact.fieldAssignments
    .filter((assignment) => assignment.field === "aflag" && typeof assignment.value === "number")
    .map((assignment) => assignment.value)
    .filter((value) => Number.isFinite(value));
  if (values.length < 2) return undefined;
  return {
    smallAmount: Math.min(...values),
    bigAmount: Math.max(...values),
  };
}

function quakeAmmoPickupRejectAtOrAboveAmount(field: QuakeGameLogicAmmoInventoryField): number {
  if (field === "nails" || field === "cells") return 200;
  return 100;
}

function quakeAmmoClampMaxAmount(field: QuakeGameLogicAmmoInventoryField): number {
  if (field === "nails") return 200;
  return 100;
}

function quakeResolvedArmorPickupBehavior(
  classname: QuakeGameLogicResolvedPickupKind,
  programFact: QuakeGameLogicProgramEntityFact,
): NonNullable<QuakeGameLogicResolvedPickupBehaviorFact["armor"]> | undefined {
  if (programFact.callbacks.touch !== "armor_touch") return undefined;
  const branch = quakeProgramCallbackClassnameBranch(programFact, "armor_touch", classname);
  if (!branch) return undefined;
  const armorType = quakeProgramBranchFieldNumber(branch, "type");
  const armorValue = quakeProgramBranchFieldNumber(branch, "value");
  const itemFlag = quakeProgramBranchFieldNumber(branch, "bit");
  const itemFlagExpression = quakeProgramBranchFieldExpression(branch, "bit");
  if (
    armorType === undefined ||
    armorValue === undefined ||
    itemFlag === undefined ||
    itemFlagExpression === undefined
  ) {
    return undefined;
  }
  return {
    armorType,
    armorValue,
    replacementScore: armorType * armorValue,
    replacesWhenCurrentScoreBelow: armorType * armorValue,
    itemFlag,
    itemFlagExpression,
    clearsItemFlagExpression: "IT_ARMOR1 | IT_ARMOR2 | IT_ARMOR3",
  };
}

function quakeFallbackArmorValue(classname: QuakeGameLogicResolvedPickupKind): number {
  if (classname === "item_armor2") return 150;
  if (classname === "item_armorInv") return 200;
  return 100;
}

function quakeResolvedHealthPickupBehavior(
  classname: QuakeGameLogicResolvedPickupKind,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact,
): NonNullable<QuakeGameLogicResolvedPickupBehaviorFact["health"]> | undefined {
  if (classname !== "item_health") return undefined;
  if (programFact.callbacks.touch !== "health_touch") return undefined;
  const callbackFact = programFact.callbackFacts?.health_touch;
  if (!callbackFact || !quakeProgramCallbackCalls(callbackFact, "T_Heal")) return undefined;
  const expectedHealtype = (spawnflags & QUAKE_HEALTH_MEGA) !== 0
    ? 2
    : (spawnflags & QUAKE_HEALTH_ROTTEN) !== 0
    ? 0
    : 1;
  const hasSourceHealtype = programFact.fieldAssignments.some((assignment) =>
    assignment.field === "healtype" &&
    assignment.value === expectedHealtype
  );
  if (!hasSourceHealtype) return undefined;
  const expectedHealAmount = expectedHealtype === 2 ? 100 : expectedHealtype === 0 ? 15 : 25;
  const healAmount = quakeProgramFieldNumberMatching(programFact, "healamount", expectedHealAmount);
  if (!Number.isFinite(healAmount)) return undefined;
  const ignoreMaxHealth = expectedHealtype === 2;
  const rotDelaySeconds = quakeProgramCallbackNextthinkOffsetSeconds(callbackFact, "time + 5");
  return {
    healAmount,
    healFunction: "T_Heal",
    healType: expectedHealtype,
    healthMax: ignoreMaxHealth ? 250 : 100,
    ignoreMaxHealth,
    rejectAtOrAboveHealth: ignoreMaxHealth ? 250 : 100,
    ...(ignoreMaxHealth && rotDelaySeconds !== undefined ? {
      megahealth: {
        itemFlagExpression: "IT_SUPERHEALTH",
        rotDelaySeconds,
        rotThink: "item_megahealth_rot",
      },
    } : {}),
  };
}

function quakeResolvedPowerupPickupBehavior(
  classname: QuakeGameLogicResolvedPickupKind,
  programFact: QuakeGameLogicProgramEntityFact,
): NonNullable<QuakeGameLogicResolvedPickupBehaviorFact["powerup"]> | undefined {
  if (programFact.callbacks.touch !== "powerup_touch") return undefined;
  const callbackFact = programFact.callbackFacts?.powerup_touch;
  const branch = quakeProgramCallbackClassnameBranch(programFact, "powerup_touch", classname);
  if (!callbackFact || !branch) return undefined;
  const itemFlag = quakeProgramFieldNumber(programFact, "items", Number.NaN);
  const itemFlagExpression = quakeProgramFieldExpression(programFact, "items");
  const itemFlagMutation = callbackFact.assignments.find((assignment) =>
    assignment.field === "other.items" &&
    assignment.expression === "other.items | self.items"
  );
  const activationAssignment = branch.assignments.find((assignment) =>
    assignment.field.startsWith("other.") &&
    assignment.field.endsWith("_time") &&
    assignment.value === 1
  );
  const finishedAssignment = branch.assignments.find((assignment) =>
    assignment.field.startsWith("other.") &&
    assignment.field.endsWith("_finished")
  );
  const durationSeconds = quakeProgramTimeOffsetSeconds(finishedAssignment?.expression);
  if (
    !Number.isFinite(itemFlag) ||
    itemFlagExpression === undefined ||
    itemFlagMutation === undefined ||
    activationAssignment === undefined ||
    finishedAssignment === undefined ||
    finishedAssignment.expression === undefined ||
    durationSeconds === undefined
  ) {
    return undefined;
  }
  return {
    activationField: quakeProgramOtherFieldName(activationAssignment.field),
    activationValue: 1,
    durationSeconds,
    finishedExpression: finishedAssignment.expression,
    finishedField: quakeProgramOtherFieldName(finishedAssignment.field),
    itemFlag,
    itemFlagExpression,
    itemFlagMutation: {
      expression: "other.items | self.items",
      sourceField: "self.items",
      targetField: "other.items",
    },
  };
}

function quakeResolvedKeyPickupBehavior(
  classname: QuakeGameLogicResolvedPickupKind,
  programFact: QuakeGameLogicProgramEntityFact,
): NonNullable<QuakeGameLogicResolvedPickupBehaviorFact["key"]> | undefined {
  if (programFact.callbacks.touch !== "key_touch") return undefined;
  const callbackFact = programFact.callbackFacts?.key_touch;
  if (!callbackFact) return undefined;
  const key = classname === "item_key1" || classname === "key_silver"
    ? "silver"
    : classname === "item_key2" || classname === "key_gold"
      ? "gold"
      : undefined;
  const itemFlag = quakeProgramFieldNumber(programFact, "items", Number.NaN);
  const itemFlagExpression = quakeProgramFieldExpression(programFact, "items");
  const itemFlagMutation = callbackFact.assignments.find((assignment) =>
    assignment.field === "other.items" &&
    assignment.expression === "other.items | self.items"
  );
  if (!key || !Number.isFinite(itemFlag) || itemFlagExpression === undefined || itemFlagMutation === undefined) {
    return undefined;
  }
  return {
    key,
    itemFlag,
    itemFlagExpression,
    itemFlagMutation: {
      expression: "other.items | self.items",
      sourceField: "self.items",
      targetField: "other.items",
    },
    ownedKeyReject: {
      expression: "other.items & self.items",
      playerField: "items",
      sourceField: "self.items",
    },
  };
}

function quakeProgramOtherFieldName(field: string): string {
  return field.startsWith("other.") ? field.slice("other.".length) : field;
}

function quakeResolvedWeaponPickupBehavior(
  classname: QuakeGameLogicResolvedPickupKind,
  programFact: QuakeGameLogicProgramEntityFact,
): NonNullable<QuakeGameLogicResolvedPickupBehaviorFact["weapon"]> | undefined {
  if (programFact.callbacks.touch !== "weapon_touch") return undefined;
  const callbackFact = programFact.callbackFacts?.weapon_touch;
  const branch = quakeProgramCallbackClassnameBranch(programFact, "weapon_touch", classname);
  if (!callbackFact || !branch) return undefined;

  const itemFlag = quakeProgramBranchFieldNumber(branch, "new");
  const itemFlagExpression = quakeProgramBranchFieldExpression(branch, "new");
  const ammoAssignment = branch.assignments.find((assignment) => assignment.field.startsWith("other.ammo_"));
  const ammoAmount = quakeProgramAmmoGrantAmount(ammoAssignment);
  const playerField = ammoAssignment?.field.startsWith("other.") ? ammoAssignment.field.slice("other.".length) : undefined;
  const inventoryField = quakeAmmoInventoryFieldForPlayerField(playerField);
  const hadAmmoExpression = branch.assignments.find((assignment) => assignment.field === "hadammo")?.expression;
  const hadAmmoPlayerField = hadAmmoExpression?.startsWith("other.") ? hadAmmoExpression.slice("other.".length) : undefined;
  const hasLeaveMode = callbackFact.assignments?.some((assignment) => assignment.field === "leave" && assignment.value === 1) &&
    callbackFact.assignments?.some((assignment) => assignment.field === "leave" && assignment.value === 0);
  const hasActiveWeaponFacts = quakeProgramCallbackCalls(callbackFact, "W_BestWeapon") &&
    quakeProgramCallbackCalls(callbackFact, "bound_other_ammo") &&
    quakeProgramCallbackCalls(callbackFact, "W_SetCurrentAmmo") &&
    quakeProgramCallbackCalls(callbackFact, "Deathmatch_Weapon") &&
    quakeProgramCallbackHasAssignment(callbackFact, "other.items", "other.items | new") &&
    quakeProgramCallbackHasAssignment(callbackFact, "self.weapon", "new");

  if (
    itemFlag === undefined ||
    itemFlagExpression === undefined ||
    ammoAmount === undefined ||
    playerField === undefined ||
    inventoryField === undefined ||
    hadAmmoPlayerField === undefined ||
    !hasLeaveMode ||
    !hasActiveWeaponFacts
  ) {
    return undefined;
  }

  return {
    itemFlag,
    itemFlagExpression,
    ammoGrant: {
      inventoryField,
      playerField,
      amount: ammoAmount,
      hadAmmoPlayerField,
    },
    ownedWeaponReject: {
      condition: "deathmatch == 2 || coop",
      itemFlagExpression,
    },
    activeWeapon: {
      bestWeaponFunction: "W_BestWeapon",
      clampAmmoFunction: "bound_other_ammo",
      currentAmmoFunction: "W_SetCurrentAmmo",
      deathmatchFunction: "Deathmatch_Weapon",
      singleplayerAssignment: "self.weapon = new",
    },
  };
}

function quakeProgramAmmoGrantAmount(
  assignment: QuakeGameLogicProgramAssignment | undefined,
): number | undefined {
  if (!assignment?.field.startsWith("other.ammo_")) return undefined;
  const pattern = new RegExp(`^${escapeRegExp(assignment.field)}\\s*\\+\\s*([-+]?[0-9.]+)$`);
  const match = pattern.exec(assignment.expression);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function quakeAmmoInventoryFieldForPlayerField(playerField: string | undefined): QuakeGameLogicAmmoInventoryField | undefined {
  if (playerField === "ammo_shells") return "shells";
  if (playerField === "ammo_nails") return "nails";
  if (playerField === "ammo_rockets") return "rockets";
  if (playerField === "ammo_cells") return "cells";
  return undefined;
}

function quakeResolvedAmmoPickupInventoryDelta(
  ammoGrant: { inventoryField: QuakeGameLogicAmmoInventoryField; amount: number } | undefined,
): QuakeGameLogicPickupInventoryDeltaFact | undefined {
  if (!ammoGrant) return undefined;
  if (ammoGrant.inventoryField === "shells") return { shells: ammoGrant.amount };
  if (ammoGrant.inventoryField === "nails") return { nails: ammoGrant.amount };
  if (ammoGrant.inventoryField === "rockets") return { rockets: ammoGrant.amount };
  return { cells: ammoGrant.amount };
}

function quakeProgramTimeOffsetSeconds(expression: string | undefined): number | undefined {
  const match = /^time\s*\+\s*(.+)$/.exec(expression ?? "");
  if (!match) return undefined;
  const value = quakeProgramNumericExpressionSeconds(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function quakeProgramNumericExpressionSeconds(expression: string): number {
  const normalized = expression.trim();
  if (/^[-+]?[0-9.]+$/.test(normalized)) return Number(normalized);
  const product = /^([-+]?[0-9.]+)\s*\*\s*([-+]?[0-9.]+)$/.exec(normalized);
  if (product) return Number(product[1]) * Number(product[2]);
  return Number.NaN;
}

function quakeResolvedPickupModelPath(
  classname: QuakeGameLogicResolvedPickupKind,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact,
): string | undefined {
  const setmodelPaths = programFact.setmodels
    .map((setmodel) => typeof setmodel.value === "string" ? setmodel.value.trim().toLowerCase() : "")
    .filter(Boolean);
  const matching = (path: string): string | undefined => setmodelPaths.find((modelPath) => modelPath === path) ?? path;
  const big = (spawnflags & QUAKE_PICKUP_BIG) !== 0;
  if (classname === "item_health") {
    if ((spawnflags & QUAKE_HEALTH_ROTTEN) !== 0) return matching("maps/b_bh10.bsp");
    if ((spawnflags & QUAKE_HEALTH_MEGA) !== 0) return matching("maps/b_bh100.bsp");
    return matching("maps/b_bh25.bsp");
  }
  if (classname === "item_shells" || classname === "ammo_shells") {
    return big ? matching("maps/b_shell1.bsp") : matching("maps/b_shell0.bsp");
  }
  if (classname === "item_spikes" || classname === "ammo_nails") {
    return big ? matching("maps/b_nail1.bsp") : matching("maps/b_nail0.bsp");
  }
  if (classname === "item_rockets" || classname === "ammo_rockets") {
    return big ? matching("maps/b_rock1.bsp") : matching("maps/b_rock0.bsp");
  }
  if (classname === "item_cells" || classname === "ammo_cells") {
    return big ? matching("maps/b_batt1.bsp") : matching("maps/b_batt0.bsp");
  }
  return setmodelPaths.find((modelPath) => modelPath.startsWith("progs/") && modelPath.endsWith(".mdl")) ??
    setmodelPaths.find((modelPath) => modelPath.startsWith("maps/") && modelPath.endsWith(".bsp"));
}

function quakeResolvedPickupFeedback(
  classname: QuakeGameLogicResolvedPickupKind,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact,
  worldtype: number | undefined,
  inventoryDelta: QuakeGameLogicPickupInventoryDeltaFact,
): NonNullable<QuakeGameLogicResolvedPickupFact["feedback"]> | undefined {
  const sound = quakeResolvedPickupSound(classname, spawnflags, programFact, worldtype);
  const message = quakeResolvedPickupMessage(classname, programFact, worldtype, inventoryDelta);
  if (!sound && !message) return undefined;
  return {
    ...(sound ? { sound } : {}),
    ...(message ? {
      message,
      text: quakePickupTextFact(message, programFact),
    } : {}),
  };
}

function quakePickupTextFact(
  message: string,
  programFact: QuakeGameLogicProgramEntityFact,
): QuakeGameLogicTextFact {
  const sourceFunction = programFact.callbacks.touch ?? programFact.functionName;
  return quakeGameLogicTextFact({
    lane: "notify",
    programFact,
    sourceCall: "sprint",
    sourceFunction,
    text: message,
  });
}

function quakeResolvedPickupSound(
  classname: QuakeGameLogicResolvedPickupKind,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact,
  worldtype: number | undefined,
): string | undefined {
  if (classname === "item_health") {
    if ((spawnflags & QUAKE_HEALTH_ROTTEN) !== 0) return "items/r_item1.wav";
    if ((spawnflags & QUAKE_HEALTH_MEGA) !== 0) return "items/r_item2.wav";
    return "items/health1.wav";
  }
  const touchCallback = programFact.callbacks.touch;
  if (touchCallback === "armor_touch") return "items/armor1.wav";
  if (touchCallback === "ammo_touch") return "weapons/lock4.wav";
  if (touchCallback === "weapon_touch") return "weapons/pkup.wav";
  if (touchCallback === "key_touch") return quakeKeyPickupSound(worldtype);
  if (touchCallback === "powerup_touch") {
    return quakeProgramFieldString(programFact, "noise") ?? "items/itembk2.wav";
  }
  return undefined;
}

function quakeResolvedPickupMessage(
  classname: QuakeGameLogicResolvedPickupKind,
  programFact: QuakeGameLogicProgramEntityFact,
  worldtype: number | undefined,
  inventoryDelta: QuakeGameLogicPickupInventoryDeltaFact,
): string | undefined {
  const touchCallback = programFact.callbacks.touch;
  if (classname === "item_health") {
    return typeof inventoryDelta.health === "number" ? `You receive ${inventoryDelta.health} health` : undefined;
  }
  if (touchCallback === "armor_touch") return "You got armor";
  if (
    touchCallback === "ammo_touch" ||
    touchCallback === "weapon_touch" ||
    touchCallback === "key_touch" ||
    touchCallback === "powerup_touch"
  ) {
    const netname = touchCallback === "key_touch"
      ? quakeKeyPickupNetname(classname, worldtype) ?? quakeProgramFieldDisplayString(programFact, "netname")
      : quakeProgramFieldDisplayString(programFact, "netname");
    return netname ? `You got the ${netname}` : undefined;
  }
  return undefined;
}

function quakeKeyPickupSound(worldtype: number | undefined): string | undefined {
  if (worldtype === 0) return "misc/medkey.wav";
  if (worldtype === 1) return "misc/runekey.wav";
  if (worldtype === 2) return "misc/basekey.wav";
  return undefined;
}

function quakeKeyPickupNetname(
  classname: QuakeGameLogicResolvedPickupKind,
  worldtype: number | undefined,
): string | undefined {
  const keyColor = classname === "item_key1" || classname === "key_silver"
    ? "silver"
    : classname === "item_key2" || classname === "key_gold"
      ? "gold"
      : undefined;
  if (!keyColor) return undefined;
  if (worldtype === 0) return `${keyColor} key`;
  if (worldtype === 1) return `${keyColor} runekey`;
  if (worldtype === 2) return `${keyColor} keycard`;
  return undefined;
}

function buildQuakeGameLogicResolvedTriggerFact(
  entity: QuakeEntity,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  programFactByClassname: Record<string, QuakeGameLogicProgramEntityFact>,
  targetGraph: Record<string, number[]>,
): QuakeGameLogicResolvedTriggerFact | undefined {
  if (!isQuakeGameLogicResolvedTriggerKind(entity.classname) || !programFact) return undefined;

  const inheritedProgramFact = entity.classname === "trigger_once" || entity.classname === "trigger_secret"
    ? programFactByClassname.trigger_multiple
    : undefined;
  const behaviorProgramFact = inheritedProgramFact ?? programFact;
  const health = quakeEntityNumber(entity, "health", 0);
  const damageable = health > 0 &&
    (entity.classname === "trigger_multiple" ||
      entity.classname === "trigger_once" ||
      entity.classname === "trigger_secret");
  const delay = Math.max(0, quakeEntityNumber(entity, "delay", 0));
  const target = entity.properties.target;
  const killtarget = entity.properties.killtarget;
  const targetEntityIndexes = target ? [...(targetGraph[target] ?? [])] : [];
  const killtargetEntityIndexes = killtarget ? [...(targetGraph[killtarget] ?? [])] : undefined;
  const notouch = Boolean(spawnflags & QUAKE_TRIGGER_NOTOUCH);
  const touchActivates = triggerTouchActivates(entity.classname, damageable, notouch);
  const useActivates = triggerUseActivates(entity.classname);
  const wait = quakeResolvedTriggerWait(entity, programFact, behaviorProgramFact);
  const sounds = quakeResolvedTriggerSounds(entity.classname, entity);
  const count = entity.classname === "trigger_counter"
    ? quakeEntityDefaultedNumber(
        entity,
        "count",
        quakeProgramDefaultNumber(programFact, "count", QUAKE_TRIGGER_COUNTER_DEFAULT_COUNT),
      )
    : undefined;
  const dmg = entity.classname === "trigger_hurt"
    ? quakeEntityDefaultedNumber(
        entity,
        "dmg",
        quakeProgramDefaultNumber(programFact, "dmg", QUAKE_TRIGGER_HURT_DEFAULT_DMG),
      )
    : undefined;
  const speed = quakeResolvedTriggerSpeed(entity, programFact);
  const height = entity.classname === "trigger_monsterjump"
    ? quakeEntityDefaultedNumber(
        entity,
        "height",
        quakeProgramDefaultNumber(programFact, "height", QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_HEIGHT),
      )
    : undefined;
  const message = quakeResolvedTriggerMessage(entity, behaviorProgramFact);
  const generatedText = quakeTriggerGeneratedTextFacts(entity.classname, spawnflags, behaviorProgramFact);

  return {
    kind: entity.classname,
    source: {
      spawnFunction: entity.classname,
      ...(inheritedProgramFact ? { inheritedSpawnFunction: "trigger_multiple" as const } : {}),
      ...(behaviorProgramFact.calls.includes("InitTrigger") ? { initFunction: "InitTrigger" as const } : {}),
    },
    targetUse: {
      delay,
      ...(target ? { target } : {}),
      targetEntityIndexes,
      activeTargetEntityIndexesByMode: emptyQuakeGameLogicModeEntityIndexSets(),
      ...(killtarget ? { killtarget } : {}),
      ...(killtargetEntityIndexes ? { killtargetEntityIndexes } : {}),
      ...(killtargetEntityIndexes ? {
        activeKilltargetEntityIndexesByMode: emptyQuakeGameLogicModeEntityIndexSets(),
      } : {}),
    },
    ...(wait !== undefined ? { wait } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(dmg !== undefined ? { dmg } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(sounds !== undefined ? { sounds, ...quakeTriggerActivationSound(sounds) } : {}),
    ...(damageable ? { health } : {}),
    ...(message !== undefined
      ? {
        message,
        messageText: quakeTriggerMessageTextFact(
          message,
          entity.classname,
          programFact,
          behaviorProgramFact,
          touchActivates,
          useActivates,
        ),
      }
      : {}),
    ...(generatedText.length ? { generatedText } : {}),
    ...(entity.classname === "trigger_setskill"
      ? { skillValue: quakeEntityNumber(entity, "message", 1) }
      : {}),
    ...(entity.classname === "trigger_push" || entity.classname === "trigger_monsterjump"
      ? { moveDirection: quakeGameLogicMoveDirection(entity) }
      : {}),
    ...(entity.classname === "trigger_push"
      ? { pushVelocityMultiplier: QUAKE_TRIGGER_PUSH_VELOCITY_MULTIPLIER }
      : {}),
    ...(entity.classname === "trigger_onlyregistered" ? { registeredOnly: true } : {}),
    damageable,
    oneShot: triggerOneShot(entity.classname, spawnflags, wait),
    touchActivates,
    useActivates,
    ...(entity.classname === "trigger_teleport" && entity.properties.targetname
      ? { requiresUseBeforeTouch: true }
      : {}),
    ...(entity.classname === "trigger_teleport" ? { destinationEntityIndexes: targetEntityIndexes } : {}),
    ...(entity.classname === "trigger_changelevel" && entity.properties.map
      ? { changelevelMap: entity.properties.map.toLowerCase() }
      : {}),
    spawnflagChecks: quakeResolvedTriggerSpawnflagChecks(entity.classname, behaviorProgramFact),
    callbacks: {
      ...(behaviorProgramFact.callbacks.touch ? { touch: behaviorProgramFact.callbacks.touch } : {}),
      ...(behaviorProgramFact.callbacks.use ? { use: behaviorProgramFact.callbacks.use } : {}),
      ...(behaviorProgramFact.callbacks.th_die ? { th_die: behaviorProgramFact.callbacks.th_die } : {}),
    },
  };
}

function isQuakeGameLogicResolvedTriggerKind(classname: string): classname is QuakeGameLogicResolvedTriggerKind {
  return classname === "trigger_changelevel" ||
    classname === "trigger_counter" ||
    classname === "trigger_hurt" ||
    classname === "trigger_monsterjump" ||
    classname === "trigger_multiple" ||
    classname === "trigger_onlyregistered" ||
    classname === "trigger_once" ||
    classname === "trigger_push" ||
    classname === "trigger_relay" ||
    classname === "trigger_secret" ||
    classname === "trigger_setskill" ||
    classname === "trigger_teleport";
}

function triggerTouchActivates(
  classname: QuakeGameLogicResolvedTriggerKind,
  damageable: boolean,
  notouch: boolean,
): boolean {
  if (
    classname === "trigger_multiple" ||
    classname === "trigger_once" ||
    classname === "trigger_secret"
  ) return !damageable && !notouch;
  if (
    classname === "trigger_hurt" ||
    classname === "trigger_teleport" ||
    classname === "trigger_changelevel" ||
    classname === "trigger_push" ||
    classname === "trigger_setskill" ||
    classname === "trigger_onlyregistered" ||
    classname === "trigger_monsterjump"
  ) {
    return true;
  }
  return false;
}

function triggerUseActivates(classname: QuakeGameLogicResolvedTriggerKind): boolean {
  return classname === "trigger_multiple" ||
    classname === "trigger_once" ||
    classname === "trigger_secret" ||
    classname === "trigger_counter" ||
    classname === "trigger_relay" ||
    classname === "trigger_teleport";
}

function quakeResolvedTriggerWait(
  entity: QuakeEntity,
  programFact: QuakeGameLogicProgramEntityFact,
  behaviorProgramFact: QuakeGameLogicProgramEntityFact,
): number | undefined {
  if (entity.classname === "trigger_once") {
    return quakeProgramFieldNumber(programFact, "wait", -1);
  }
  if (entity.classname === "trigger_secret" || entity.classname === "trigger_counter") {
    return quakeProgramFieldNumber(programFact, "wait", -1);
  }
  if (entity.classname === "trigger_multiple") {
    return quakeEntityDefaultedNumber(
      entity,
      "wait",
      quakeProgramDefaultNumber(behaviorProgramFact, "wait", QUAKE_TRIGGER_MULTIPLE_DEFAULT_WAIT),
    );
  }
  return undefined;
}

function quakeResolvedTriggerSounds(classname: string, entity: QuakeEntity): number | undefined {
  if (classname === "trigger_secret") {
    return quakeEntityDefaultedNumber(entity, "sounds", QUAKE_TRIGGER_SECRET_DEFAULT_SOUNDS);
  }
  if (classname !== "trigger_multiple" && classname !== "trigger_once") return undefined;
  const rawSounds = quakeEntityNumber(entity, "sounds", 0);
  return rawSounds === 0 ? QUAKE_TRIGGER_MULTIPLE_DEFAULT_SOUNDS : rawSounds;
}

function quakeResolvedTriggerSpeed(
  entity: QuakeEntity,
  programFact: QuakeGameLogicProgramEntityFact,
): number | undefined {
  if (entity.classname === "trigger_push") {
    return quakeEntityDefaultedNumber(
      entity,
      "speed",
      quakeProgramDefaultNumber(programFact, "speed", QUAKE_TRIGGER_PUSH_DEFAULT_SPEED),
    );
  }
  if (entity.classname === "trigger_monsterjump") {
    return quakeEntityDefaultedNumber(
      entity,
      "speed",
      quakeProgramDefaultNumber(programFact, "speed", QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_SPEED),
    );
  }
  return undefined;
}

function quakeResolvedTriggerMessage(
  entity: QuakeEntity,
  behaviorProgramFact: QuakeGameLogicProgramEntityFact,
): string | undefined {
  if (entity.classname === "trigger_secret") {
    return entity.properties.message || QUAKE_TRIGGER_SECRET_DEFAULT_MESSAGE;
  }
  if (entity.classname === "trigger_onlyregistered") return entity.properties.message;
  if (entity.properties.message && quakeTriggerCallsUseTargets(behaviorProgramFact)) {
    return entity.properties.message;
  }
  return undefined;
}

function quakeTriggerMessageTextFact(
  message: string,
  classname: QuakeGameLogicResolvedTriggerKind,
  programFact: QuakeGameLogicProgramEntityFact,
  behaviorProgramFact: QuakeGameLogicProgramEntityFact,
  touchActivates: boolean,
  useActivates: boolean,
): QuakeGameLogicTextFact {
  const sourceCall = classname === "trigger_onlyregistered" ? "centerprint" : "SUB_UseTargets";
  const sourceFunction = classname === "trigger_onlyregistered"
    ? behaviorProgramFact.callbacks.touch ?? behaviorProgramFact.functionName
    : quakeTriggerUseTargetsSourceFunction(behaviorProgramFact, touchActivates, useActivates);
  return quakeGameLogicTextFact({
    lane: "centerprint",
    programFact: behaviorProgramFact.sourceRefs.length ? behaviorProgramFact : programFact,
    sourceCall,
    sourceFunction,
    text: message,
  });
}

function quakeTriggerUseTargetsSourceFunction(
  programFact: QuakeGameLogicProgramEntityFact,
  touchActivates: boolean,
  useActivates: boolean,
): string {
  const callbackCandidates = [
    ...(touchActivates && programFact.callbacks.touch ? [programFact.callbacks.touch] : []),
    ...(useActivates && programFact.callbacks.use ? [programFact.callbacks.use] : []),
    ...(programFact.callbacks.touch ? [programFact.callbacks.touch] : []),
    ...(programFact.callbacks.use ? [programFact.callbacks.use] : []),
  ];
  for (const callbackName of callbackCandidates) {
    if (quakeKnownUseTargetsCallback(callbackName)) return callbackName;
    const callbackFact = programFact.callbackFacts?.[callbackName];
    if (callbackFact && quakeProgramCallbackCalls(callbackFact, "SUB_UseTargets")) return callbackName;
  }
  return programFact.calls.includes("SUB_UseTargets") ? "SUB_UseTargets" : programFact.functionName;
}

function quakeTriggerCallsUseTargets(programFact: QuakeGameLogicProgramEntityFact): boolean {
  if (programFact.calls.includes("SUB_UseTargets")) return true;
  return Object.values(programFact.callbacks).some((callbackName) => {
    if (quakeKnownUseTargetsCallback(callbackName)) return true;
    const callbackFact = programFact.callbackFacts?.[callbackName];
    return callbackFact ? quakeProgramCallbackCalls(callbackFact, "SUB_UseTargets") : false;
  });
}

function quakeKnownUseTargetsCallback(callbackName: string): boolean {
  return callbackName === "SUB_UseTargets" ||
    callbackName === "multi_touch" ||
    callbackName === "multi_use" ||
    callbackName === "counter_use";
}

function quakeGameLogicTextFact(input: {
  lane: QuakeGameLogicTextLane;
  programFact: QuakeGameLogicProgramEntityFact;
  sourceCall: QuakeGameLogicTextSourceCall;
  sourceFunction: string;
  text: string;
}): QuakeGameLogicTextFact {
  const sourceRef = quakeProgramSourceRefForFunction(input.programFact, input.sourceFunction);
  const sourceFile = sourceRef?.sourceFile ?? input.programFact.source?.sourceFile ?? input.programFact.sourceRefs[0]?.sourceFile ?? "unknown";
  return {
    lane: input.lane,
    text: input.text,
    sourceCall: input.sourceCall,
    sourceFunction: input.sourceFunction,
    sourceFile,
    ...(sourceRef ? { sourceRef: cloneProgramSourceRef(sourceRef) } : {}),
  };
}

function quakeGameLogicGeneratedTextFact(input: {
  condition?: QuakeGameLogicGeneratedTextFact["condition"];
  programFact: QuakeGameLogicProgramEntityFact;
  reason: QuakeGameLogicGeneratedTextReason;
  sourceCall: QuakeGameLogicTextSourceCall;
  sourceFunction: string;
  text: string;
}): QuakeGameLogicGeneratedTextFact {
  return {
    ...quakeGameLogicTextFact({
      lane: "centerprint",
      programFact: input.programFact,
      sourceCall: input.sourceCall,
      sourceFunction: input.sourceFunction,
      text: input.text,
    }),
    reason: input.reason,
    ...(input.condition ? { condition: input.condition } : {}),
  };
}

function quakeTriggerGeneratedTextFacts(
  classname: QuakeGameLogicResolvedTriggerKind,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact,
): QuakeGameLogicGeneratedTextFact[] {
  if (classname !== "trigger_counter" || (spawnflags & QUAKE_TRIGGER_COUNTER_NOMESSAGE) !== 0) return [];
  const base = {
    programFact,
    sourceCall: "centerprint" as const,
    sourceFunction: "counter_use",
  };
  return [
    quakeGameLogicGeneratedTextFact({
      ...base,
      condition: {
        minRemaining: 4,
        spawnflagNotSet: "SPAWNFLAG_NOMESSAGE",
      },
      reason: "counter-remaining",
      text: "There are more to go...",
    }),
    quakeGameLogicGeneratedTextFact({
      ...base,
      condition: {
        remaining: 3,
        spawnflagNotSet: "SPAWNFLAG_NOMESSAGE",
      },
      reason: "counter-remaining",
      text: "Only 3 more to go...",
    }),
    quakeGameLogicGeneratedTextFact({
      ...base,
      condition: {
        remaining: 2,
        spawnflagNotSet: "SPAWNFLAG_NOMESSAGE",
      },
      reason: "counter-remaining",
      text: "Only 2 more to go...",
    }),
    quakeGameLogicGeneratedTextFact({
      ...base,
      condition: {
        remaining: 1,
        spawnflagNotSet: "SPAWNFLAG_NOMESSAGE",
      },
      reason: "counter-remaining",
      text: "Only 1 more to go...",
    }),
    quakeGameLogicGeneratedTextFact({
      ...base,
      condition: {
        remaining: 0,
        spawnflagNotSet: "SPAWNFLAG_NOMESSAGE",
      },
      reason: "counter-complete",
      text: "Sequence completed!",
    }),
  ];
}

function quakeProgramSourceRefForFunction(
  programFact: QuakeGameLogicProgramEntityFact,
  functionName: string,
): QuakeGameLogicProgramSourceRef | undefined {
  return programFact.callbackFacts?.[functionName]?.sourceRefs[0] ??
    programFact.sourceRefs.find((sourceRef) => sourceRef.functionName === functionName);
}

function cloneProgramSourceRef(sourceRef: QuakeGameLogicProgramSourceRef): QuakeGameLogicProgramSourceRef {
  return { ...sourceRef };
}

function triggerOneShot(
  classname: QuakeGameLogicResolvedTriggerKind,
  spawnflags: number,
  wait: number | undefined,
): boolean {
  if (
    classname === "trigger_once" ||
    classname === "trigger_secret" ||
    classname === "trigger_changelevel" ||
    classname === "trigger_counter"
  ) {
    return true;
  }
  if (classname === "trigger_push" && (spawnflags & 1) !== 0) return true;
  return wait === -1;
}

function quakeResolvedTriggerSpawnflagChecks(
  classname: QuakeGameLogicResolvedTriggerKind,
  programFact: QuakeGameLogicProgramEntityFact,
): QuakeGameLogicProgramSpawnflagCheck[] {
  const out = programFact.spawnflagChecks.map(cloneProgramSpawnflagCheck);
  if (classname === "trigger_counter" && !out.some((check) => check.name === "SPAWNFLAG_NOMESSAGE")) {
    out.push({ name: "SPAWNFLAG_NOMESSAGE", value: 1 });
  }
  if (classname === "trigger_push" && !out.some((check) => check.name === "PUSH_ONCE")) {
    out.push({ name: "PUSH_ONCE", value: 1 });
  }
  return out;
}

function buildQuakeGameLogicResolvedFuncTrainFact(
  entity: QuakeEntity,
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  targetGraph: Record<string, number[]>,
  brushModel: QuakePreparedBrushCollision,
): QuakeGameLogicResolvedFuncTrainFact {
  const speed = quakeEntityDefaultedNumber(
    entity,
    "speed",
    quakeProgramDefaultNumber(programFact, "speed", QUAKE_TRAIN_DEFAULT_SPEED),
  );
  const dmg = quakeEntityDefaultedNumber(
    entity,
    "dmg",
    quakeProgramDefaultNumber(programFact, "dmg", QUAKE_TRAIN_DEFAULT_DMG),
  );
  const sounds = quakeEntityNumber(
    entity,
    "sounds",
    quakeProgramDefaultNumber(programFact, "sounds", QUAKE_TRAIN_DEFAULT_SOUNDS),
  );
  const initialTarget = entity.properties.target;
  return {
    kind: "func_train",
    source: {
      spawnFunction: "func_train",
      findFunction: "func_train_find",
      nextFunction: "train_next",
      waitFunction: "train_wait",
    },
    speed,
    dmg,
    sounds,
    ...quakeTrainSoundSet(sounds),
    ...(initialTarget ? { initialTarget } : {}),
    initialTargetEntityIndexes: initialTarget ? [...(targetGraph[initialTarget] ?? [])] : [],
    path: {
      cornerEntityIndexes: [],
      loops: false,
      missingTargetnames: [],
    },
    callbacks: {
      ...(programFact?.callbacks.blocked ? { blocked: programFact.callbacks.blocked } : {}),
      ...(programFact?.callbacks.use ? { use: programFact.callbacks.use } : {}),
      ...(programFact?.callbacks.think ? { think: programFact.callbacks.think } : {}),
    },
  };
}

function buildQuakeGameLogicResolvedPathCornerFact(
  entity: QuakeEntity,
  targetGraph: Record<string, number[]>,
): QuakeGameLogicResolvedPathCornerFact | undefined {
  if (entity.classname !== "path_corner" || !entity.origin) return undefined;
  const target = entity.properties.target;
  return {
    kind: "path_corner",
    ...(target ? { target } : {}),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
    wait: quakeEntityNumber(entity, "wait", 0),
    origin: { ...entity.origin },
    nextEntityIndexes: target ? [...(targetGraph[target] ?? [])] : [],
  };
}

function resolveQuakeGameLogicTrainPaths(entities: QuakeGameLogicEntityFact[]): void {
  const entityByIndex = new Map(entities.map((entity) => [entity.entityIndex, entity]));
  const pathCornerByTargetname = new Map<string, QuakeGameLogicEntityFact>();
  for (const entity of entities) {
    if (entity.resolvedPathCorner?.targetname) {
      pathCornerByTargetname.set(entity.resolvedPathCorner.targetname, entity);
    }
  }

  for (const entity of entities) {
    if (entity.resolvedMover?.kind !== "func_train") continue;
    const resolvedTrain = entity.resolvedMover;
    const path = quakeGameLogicTrainPath(resolvedTrain.initialTarget, pathCornerByTargetname);
    resolvedTrain.path = path;
    const firstCornerIndex = path.cornerEntityIndexes[0];
    const firstCorner = firstCornerIndex === undefined ? undefined : entityByIndex.get(firstCornerIndex)?.resolvedPathCorner;
    if (firstCornerIndex !== undefined) resolvedTrain.firstPathCornerEntityIndex = firstCornerIndex;
    if (firstCorner?.origin) {
      resolvedTrain.pathBaseOrigin = { ...firstCorner.origin };
      if (entity.brushModel) {
        resolvedTrain.quakeCInitialOrigin = {
          x: firstCorner.origin.x - entity.brushModel.mins.x,
          y: firstCorner.origin.y - entity.brushModel.mins.y,
          z: firstCorner.origin.z - entity.brushModel.mins.z,
        };
      }
    }
  }
}

function quakeGameLogicTrainPath(
  initialTarget: string | undefined,
  pathCornerByTargetname: Map<string, QuakeGameLogicEntityFact>,
): QuakeGameLogicResolvedFuncTrainFact["path"] {
  const cornerEntityIndexes: number[] = [];
  const missingTargetnames: string[] = [];
  const seen = new Set<string>();
  let currentTarget = initialTarget;
  let loops = false;

  for (let step = 0; step < QUAKE_TRAIN_MAX_PATH_CORNERS && currentTarget; step++) {
    if (seen.has(currentTarget)) {
      loops = true;
      break;
    }
    seen.add(currentTarget);
    const corner = pathCornerByTargetname.get(currentTarget);
    if (!corner?.resolvedPathCorner) {
      missingTargetnames.push(currentTarget);
      break;
    }
    cornerEntityIndexes.push(corner.entityIndex);
    currentTarget = corner.resolvedPathCorner.target;
  }

  return {
    cornerEntityIndexes,
    loops,
    missingTargetnames,
  };
}

function resolveQuakeGameLogicTriggerTargetSets(entities: QuakeGameLogicEntityFact[]): void {
  const entityByIndex = new Map(entities.map((entity) => [entity.entityIndex, entity]));
  for (const entity of entities) {
    const targetUse = entity.resolvedTrigger?.targetUse;
    if (!targetUse) continue;
    targetUse.activeTargetEntityIndexesByMode = quakeGameLogicActiveTargetSets(
      targetUse.targetEntityIndexes,
      entityByIndex,
      entity.entityIndex,
    );
    if (targetUse.killtargetEntityIndexes) {
      targetUse.activeKilltargetEntityIndexesByMode = quakeGameLogicActiveTargetSets(
        targetUse.killtargetEntityIndexes,
        entityByIndex,
      );
    }
  }
}

function quakeGameLogicActiveTargetSets(
  indexes: readonly number[],
  entityByIndex: Map<number, QuakeGameLogicEntityFact>,
  sourceEntityIndex?: number,
): QuakeGameLogicModeEntityIndexSets {
  return {
    singleplayerEasy: quakeGameLogicActiveTargetIndexesForMode(
      indexes,
      entityByIndex,
      "singleplayer:easy",
      sourceEntityIndex,
    ),
    singleplayerNormal: quakeGameLogicActiveTargetIndexesForMode(
      indexes,
      entityByIndex,
      "singleplayer:normal",
      sourceEntityIndex,
    ),
    singleplayerHard: quakeGameLogicActiveTargetIndexesForMode(
      indexes,
      entityByIndex,
      "singleplayer:hard",
      sourceEntityIndex,
    ),
  };
}

function quakeGameLogicActiveTargetIndexesForMode(
  indexes: readonly number[],
  entityByIndex: Map<number, QuakeGameLogicEntityFact>,
  mode: QuakeGameLogicSingleplayerMode,
  sourceEntityIndex?: number,
): number[] {
  return indexes.filter((index) => {
    if (index === sourceEntityIndex) return false;
    const target = entityByIndex.get(index);
    return target?.runtimeStatus === "active" && target.modeMask.includes(mode);
  });
}

function emptyQuakeGameLogicModeEntityIndexSets(): QuakeGameLogicModeEntityIndexSets {
  return {
    singleplayerEasy: [],
    singleplayerNormal: [],
    singleplayerHard: [],
  };
}

function buildQuakeGameLogicResolvedFuncButtonFact(
  entity: QuakeEntity,
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  brushModel: QuakePreparedBrushCollision,
): QuakeGameLogicResolvedFuncButtonFact {
  const origin = entity.origin ?? brushModel.origin ?? { x: 0, y: 0, z: 0 };
  const size = quakeBoundsSize(brushModel.mins, brushModel.maxs);
  const speed = quakeEntityDefaultedNumber(
    entity,
    "speed",
    quakeProgramDefaultNumber(programFact, "speed", QUAKE_BUTTON_DEFAULT_SPEED),
  );
  const wait = quakeEntityDefaultedNumber(
    entity,
    "wait",
    quakeProgramDefaultNumber(programFact, "wait", QUAKE_BUTTON_DEFAULT_WAIT),
  );
  const lip = quakeEntityDefaultedNumber(
    entity,
    "lip",
    quakeProgramDefaultNumber(programFact, "lip", QUAKE_BUTTON_DEFAULT_LIP),
  );
  const rawSounds = quakeEntityNumber(entity, "sounds", 0);
  const sounds = rawSounds === 0 ? QUAKE_BUTTON_DEFAULT_SOUNDS : rawSounds;
  const moveDirection = quakeGameLogicMoveDirection(entity);
  const travelDistance = Math.max(
    0,
    Math.abs(moveDirection.x) * size.x +
      Math.abs(moveDirection.y) * size.y +
      Math.abs(moveDirection.z) * size.z -
      lip,
  );
  const travelOffset = {
    x: moveDirection.x * travelDistance,
    y: moveDirection.y * travelDistance,
    z: moveDirection.z * travelDistance,
  };
  const damageableHealth = quakeEntityNumber(entity, "health", 0);
  const damageable = damageableHealth > 0;
  return {
    kind: "func_button",
    source: {
      spawnFunction: "func_button",
    },
    speed,
    wait,
    lip,
    sounds,
    ...quakeButtonActivationSound(sounds),
    damageable,
    ...(damageable ? { health: damageableHealth } : {}),
    initialState: "bottom",
    pos1Origin: { ...origin },
    pos2Origin: quakeAddVertices(origin, travelOffset),
    initialOrigin: { ...origin },
    moveDirection,
    travelDistance,
    travelOffset,
    callbacks: {
      ...(programFact?.callbacks.blocked ? { blocked: programFact.callbacks.blocked } : {}),
      ...(programFact?.callbacks.use ? { use: programFact.callbacks.use } : {}),
      ...(!damageable && programFact?.callbacks.touch ? { touch: programFact.callbacks.touch } : {}),
      ...(damageable && programFact?.callbacks.th_die ? { th_die: programFact.callbacks.th_die } : {}),
    },
  };
}

function buildQuakeGameLogicResolvedFuncDoorFact(
  entity: QuakeEntity,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  brushModel: QuakePreparedBrushCollision,
  worldtype: number | undefined,
): QuakeGameLogicResolvedFuncDoorFact {
  const origin = entity.origin ?? brushModel.origin ?? { x: 0, y: 0, z: 0 };
  const size = quakeBoundsSize(brushModel.mins, brushModel.maxs);
  const speed = quakeEntityNumber(
    entity,
    "speed",
    quakeProgramDefaultNumber(programFact, "speed", QUAKE_DOOR_DEFAULT_SPEED),
  );
  const wait = quakeEntityNumber(
    entity,
    "wait",
    quakeProgramDefaultNumber(programFact, "wait", QUAKE_DOOR_DEFAULT_WAIT),
  );
  const lip = quakeEntityNumber(
    entity,
    "lip",
    quakeProgramDefaultNumber(programFact, "lip", QUAKE_DOOR_DEFAULT_LIP),
  );
  const dmg = quakeEntityNumber(
    entity,
    "dmg",
    quakeProgramDefaultNumber(programFact, "dmg", QUAKE_DOOR_DEFAULT_DMG),
  );
  const sounds = quakeEntityNumber(entity, "sounds", QUAKE_DOOR_DEFAULT_SOUNDS);
  const moveDirection = quakeGameLogicMoveDirection(entity);
  const travelDistance = Math.max(
    0,
    Math.abs(moveDirection.x) * size.x +
      Math.abs(moveDirection.y) * size.y +
      Math.abs(moveDirection.z) * size.z -
      lip,
  );
  const travelOffset = {
    x: moveDirection.x * travelDistance,
    y: moveDirection.y * travelDistance,
    z: moveDirection.z * travelDistance,
  };
  const closedOrigin = { ...origin };
  const openOrigin = quakeAddVertices(origin, travelOffset);
  const startsOpen = Boolean(spawnflags & QUAKE_DOOR_START_OPEN);
  const requiredKey = quakeDoorRequiredKey(spawnflags);
  const generatedText = quakeDoorGeneratedTextFacts(requiredKey, worldtype, programFact);
  return {
    kind: "func_door",
    source: {
      spawnFunction: "func_door",
      linkFunction: "LinkDoors",
    },
    speed,
    wait,
    lip,
    dmg,
    sounds,
    startsOpen,
    spawnDoorTrigger: !entity.properties.targetname && !entity.properties.health,
    pos1Origin: startsOpen ? openOrigin : closedOrigin,
    pos2Origin: startsOpen ? closedOrigin : openOrigin,
    initialOrigin: startsOpen ? openOrigin : closedOrigin,
    moveDirection,
    travelDistance,
    travelOffset,
    ...(requiredKey ? { requiredKey } : {}),
    ...(generatedText.length ? { generatedText } : {}),
    callbacks: {
      ...(programFact?.callbacks.blocked ? { blocked: programFact.callbacks.blocked } : {}),
      ...(programFact?.callbacks.touch ? { touch: programFact.callbacks.touch } : {}),
      ...(programFact?.callbacks.use ? { use: programFact.callbacks.use } : {}),
      ...(programFact?.callbacks.think ? { think: programFact.callbacks.think } : {}),
    },
  };
}

function quakeDoorRequiredKey(spawnflags: number): QuakeGameLogicDoorKey | undefined {
  if ((spawnflags & QUAKE_DOOR_GOLD_KEY) !== 0) return "gold";
  if ((spawnflags & QUAKE_DOOR_SILVER_KEY) !== 0) return "silver";
  return undefined;
}

function quakeDoorGeneratedTextFacts(
  requiredKey: QuakeGameLogicDoorKey | undefined,
  worldtype: number | undefined,
  programFact: QuakeGameLogicProgramEntityFact | undefined,
): QuakeGameLogicGeneratedTextFact[] {
  if (!requiredKey || !programFact) return [];
  const message = quakeDoorRequiredKeyMessage(requiredKey, worldtype);
  if (!message) return [];
  return [
    quakeGameLogicGeneratedTextFact({
      condition: {
        key: requiredKey,
        ...(worldtype !== undefined ? { worldtype } : {}),
      },
      programFact,
      reason: "door-key-required",
      sourceCall: "centerprint",
      sourceFunction: "door_touch",
      text: message,
    }),
  ];
}

function quakeDoorRequiredKeyMessage(
  requiredKey: QuakeGameLogicDoorKey,
  worldtype: number | undefined,
): string | undefined {
  if (worldtype === 0) return `You need the ${requiredKey} key`;
  if (worldtype === 1) return `You need the ${requiredKey} runekey`;
  if (worldtype === 2) return `You need the ${requiredKey} keycard`;
  return undefined;
}

function resolveQuakeGameLogicDoorGroups(entities: QuakeGameLogicEntityFact[]): void {
  const doors = entities.filter((entity) =>
    entity.resolvedMover?.kind === "func_door" &&
    entity.brushModel &&
    (entity.spawnflags & QUAKE_DOOR_DONT_LINK) === 0
  );
  const groups = new Map<number, number>();
  for (const door of doors) groups.set(door.entityIndex, door.entityIndex);

  const find = (index: number): number => {
    const parent = groups.get(index) ?? index;
    if (parent === index) return parent;
    const root = find(parent);
    groups.set(index, root);
    return root;
  };
  const join = (a: number, b: number): void => {
    const ar = find(a);
    const br = find(b);
    if (ar !== br) groups.set(br, ar);
  };

  for (let i = 0; i < doors.length; i++) {
    const a = doors[i];
    if (!a) continue;
    for (let j = i + 1; j < doors.length; j++) {
      const b = doors[j];
      if (!b) continue;
      if (quakeDoorBoundsTouch(quakeDoorRuntimeBounds(a), quakeDoorRuntimeBounds(b))) {
        join(a.entityIndex, b.entityIndex);
      }
    }
  }

  const grouped = new Map<number, QuakeGameLogicEntityFact[]>();
  for (const door of doors) {
    const root = find(door.entityIndex);
    const bucket = grouped.get(root);
    if (bucket) {
      bucket.push(door);
    } else {
      grouped.set(root, [door]);
    }
  }

  for (const linked of grouped.values()) {
    const first = linked[0];
    if (!first) continue;
    const linkedEntityIndexes = linked.map((door) => door.entityIndex);
    const canSpawnTrigger = linked.every(quakeDoorCanSpawnTrigger);
    const group: QuakeGameLogicFuncDoorGroupFact = {
      sourceFunction: "LinkDoors",
      ownerEntityIndex: first.entityIndex,
      linkedEntityIndexes,
      canSpawnTrigger,
    };
    const trigger = canSpawnTrigger ? quakeGameLogicFuncDoorTrigger(first, linked) : undefined;
    for (const door of linked) {
      if (door.resolvedMover?.kind !== "func_door") continue;
      door.resolvedMover.linkedDoorGroup = group;
      if (trigger) door.resolvedMover.trigger = trigger;
    }
  }
}

function quakeGameLogicFuncDoorTrigger(
  owner: QuakeGameLogicEntityFact,
  linked: QuakeGameLogicEntityFact[],
): QuakeGameLogicFuncDoorTriggerFact | undefined {
  if (owner.modelIndex === undefined) return undefined;
  const firstBounds = quakeDoorRuntimeBounds(linked[0] ?? owner);
  const bounds = linked.slice(1).reduce(
    (acc, door) => quakeUnionBounds(acc, quakeDoorRuntimeBounds(door)),
    firstBounds,
  );
  return {
    sourceFunction: "LinkDoors",
    ownerEntityIndex: owner.entityIndex,
    modelIndex: owner.modelIndex,
    linkedEntityIndexes: linked.map((door) => door.entityIndex),
    expansion: {
      xy: QUAKE_DOOR_TRIGGER_XY,
      z: QUAKE_DOOR_TRIGGER_Z,
    },
    mins: {
      x: bounds.mins.x - QUAKE_DOOR_TRIGGER_XY,
      y: bounds.mins.y - QUAKE_DOOR_TRIGGER_XY,
      z: bounds.mins.z - QUAKE_DOOR_TRIGGER_Z,
    },
    maxs: {
      x: bounds.maxs.x + QUAKE_DOOR_TRIGGER_XY,
      y: bounds.maxs.y + QUAKE_DOOR_TRIGGER_XY,
      z: bounds.maxs.z + QUAKE_DOOR_TRIGGER_Z,
    },
    touch: "door_touch",
  };
}

function quakeDoorCanSpawnTrigger(entity: QuakeGameLogicEntityFact): boolean {
  return entity.properties.targetname === undefined &&
    entity.properties.health === undefined;
}

function quakeDoorRuntimeBounds(entity: QuakeGameLogicEntityFact): { mins: QuakeVertex; maxs: QuakeVertex } {
  const brushModel = entity.brushModel;
  const resolvedMover = entity.resolvedMover;
  if (!brushModel || resolvedMover?.kind !== "func_door") {
    return {
      mins: { x: 0, y: 0, z: 0 },
      maxs: { x: 0, y: 0, z: 0 },
    };
  }
  const closedOffset = resolvedMover.startsOpen
    ? resolvedMover.travelOffset
    : { x: 0, y: 0, z: 0 };
  return {
    mins: quakeAddVertices(brushModel.mins, closedOffset),
    maxs: quakeAddVertices(brushModel.maxs, closedOffset),
  };
}

function quakeDoorBoundsTouch(
  a: { mins: QuakeVertex; maxs: QuakeVertex },
  b: { mins: QuakeVertex; maxs: QuakeVertex },
): boolean {
  return a.mins.x <= b.maxs.x + QUAKE_DOOR_LINK_GAP &&
    a.maxs.x + QUAKE_DOOR_LINK_GAP >= b.mins.x &&
    a.mins.y <= b.maxs.y + QUAKE_DOOR_LINK_GAP &&
    a.maxs.y + QUAKE_DOOR_LINK_GAP >= b.mins.y &&
    a.mins.z <= b.maxs.z + QUAKE_DOOR_LINK_GAP &&
    a.maxs.z + QUAKE_DOOR_LINK_GAP >= b.mins.z;
}

function quakeUnionBounds(
  a: { mins: QuakeVertex; maxs: QuakeVertex },
  b: { mins: QuakeVertex; maxs: QuakeVertex },
): { mins: QuakeVertex; maxs: QuakeVertex } {
  return {
    mins: {
      x: Math.min(a.mins.x, b.mins.x),
      y: Math.min(a.mins.y, b.mins.y),
      z: Math.min(a.mins.z, b.mins.z),
    },
    maxs: {
      x: Math.max(a.maxs.x, b.maxs.x),
      y: Math.max(a.maxs.y, b.maxs.y),
      z: Math.max(a.maxs.z, b.maxs.z),
    },
  };
}

function buildQuakeGameLogicResolvedFuncPlatFact(
  entity: QuakeEntity,
  spawnflags: number,
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  brushModel: QuakePreparedBrushCollision,
): QuakeGameLogicResolvedFuncPlatFact {
  const origin = entity.origin ?? brushModel.origin ?? { x: 0, y: 0, z: 0 };
  const size = quakeBoundsSize(brushModel.mins, brushModel.maxs);
  const height = quakeEntityNumber(entity, "height", Math.max(0, size.z - QUAKE_PLAT_TRIGGER_TOP_EXTRA));
  const speed = quakeEntityNumber(
    entity,
    "speed",
    quakeProgramDefaultNumber(programFact, "speed", QUAKE_PLAT_DEFAULT_SPEED),
  );
  const sounds = quakeEntityNumber(
    entity,
    "sounds",
    quakeProgramDefaultNumber(programFact, "sounds", QUAKE_PLAT_DEFAULT_SOUNDS),
  );
  const startsTop = Boolean(entity.properties.targetname);
  const topOrigin = { ...origin };
  const bottomOrigin = { x: origin.x, y: origin.y, z: origin.z - height };
  const initialOrigin = startsTop ? topOrigin : bottomOrigin;
  return {
    kind: "func_plat",
    source: {
      spawnFunction: "func_plat",
      triggerFunction: "plat_spawn_inside_trigger",
    },
    speed,
    waitAtTop: QUAKE_PLAT_WAIT_AT_TOP,
    sounds,
    ...quakePlatSoundSet(sounds),
    startsTop,
    initialState: startsTop ? "top" : "bottom",
    topOrigin,
    bottomOrigin,
    initialOrigin,
    travelAxis: "z",
    travelDistance: height,
    travelOffset: { x: 0, y: 0, z: -height },
    trigger: quakeGameLogicFuncPlatTrigger(entity, spawnflags, brushModel, topOrigin, bottomOrigin),
    callbacks: {
      ...(programFact?.callbacks.blocked ? { blocked: programFact.callbacks.blocked } : {}),
      centerTouch: "plat_center_touch",
      ...(programFact?.callbacks.use ? { use: programFact.callbacks.use } : {}),
    },
  };
}

function quakeGameLogicFuncPlatTrigger(
  entity: QuakeEntity,
  spawnflags: number,
  brushModel: QuakePreparedBrushCollision,
  topOrigin: QuakeVertex,
  bottomOrigin: QuakeVertex,
): QuakeGameLogicFuncPlatTriggerFact {
  const size = quakeBoundsSize(brushModel.mins, brushModel.maxs);
  let minX = brushModel.mins.x + QUAKE_PLAT_TRIGGER_INSET;
  let maxX = brushModel.maxs.x - QUAKE_PLAT_TRIGGER_INSET;
  let minY = brushModel.mins.y + QUAKE_PLAT_TRIGGER_INSET;
  let maxY = brushModel.maxs.y - QUAKE_PLAT_TRIGGER_INSET;
  if (size.x <= QUAKE_PLAT_TRIGGER_MIN_SIDE) {
    minX = (brushModel.mins.x + brushModel.maxs.x) / 2;
    maxX = minX + 1;
  }
  if (size.y <= QUAKE_PLAT_TRIGGER_MIN_SIDE) {
    minY = (brushModel.mins.y + brushModel.maxs.y) / 2;
    maxY = minY + 1;
  }

  const travel = Math.abs(topOrigin.z - bottomOrigin.z);
  const triggerTopZ = brushModel.maxs.z + QUAKE_PLAT_TRIGGER_TOP_EXTRA;
  const triggerBottomZ = triggerTopZ - (travel + QUAKE_PLAT_TRIGGER_TOP_EXTRA);
  const lowTrigger = Boolean(spawnflags & QUAKE_PLAT_LOW_TRIGGER);
  const maxZ = lowTrigger ? triggerBottomZ + QUAKE_PLAT_TRIGGER_LOW_HEIGHT : triggerTopZ;
  return {
    sourceFunction: "plat_spawn_inside_trigger",
    ownerEntityIndex: entity.index,
    modelIndex: brushModel.modelIndex,
    lowTrigger,
    mins: { x: minX, y: minY, z: triggerBottomZ },
    maxs: { x: maxX, y: maxY, z: maxZ },
    touch: "plat_center_touch",
  };
}

function quakeGameLogicMoveDirection(entity: QuakeEntity): QuakeVertex {
  const angle = quakeEntityNumber(entity, "angle", entity.angle ?? 0);
  if (angle === -1) return { x: 0, y: 0, z: 1 };
  if (angle === -2) return { x: 0, y: 0, z: -1 };
  const radians = (angle * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians), z: 0 };
}

function quakeAddVertices(a: QuakeVertex, b: QuakeVertex): QuakeVertex {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function quakeBoundsSize(mins: QuakeVertex, maxs: QuakeVertex): QuakeVertex {
  return {
    x: Math.max(0, maxs.x - mins.x),
    y: Math.max(0, maxs.y - mins.y),
    z: Math.max(0, maxs.z - mins.z),
  };
}

function quakeProgramDefaultNumber(
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  field: string,
  fallback: number,
): number {
  const value = programFact?.defaultAssignments.find((assignment) => assignment.field === field)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function quakeProgramFieldNumber(
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  field: string,
  fallback: number,
): number {
  const value = programFact?.fieldAssignments.find((assignment) => assignment.field === field)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function quakeProgramFieldNumberMatching(
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  field: string,
  fallback: number,
): number {
  const value = programFact?.fieldAssignments.find((assignment) =>
    assignment.field === field &&
    assignment.value === fallback
  )?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function quakeProgramFieldString(
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  field: string,
): string | undefined {
  const value = programFact?.fieldAssignments.find((assignment) => assignment.field === field)?.value;
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

function quakeProgramFieldDisplayString(
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  field: string,
): string | undefined {
  const value = programFact?.fieldAssignments.find((assignment) => assignment.field === field)?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function quakeProgramFieldExpression(
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  field: string,
): string | undefined {
  return programFact?.fieldAssignments.find((assignment) => assignment.field === field)?.expression;
}

function quakeProgramCallbackClassnameBranch(
  programFact: QuakeGameLogicProgramEntityFact | undefined,
  callbackName: string,
  classname: string,
): QuakeGameLogicProgramCallbackClassnameBranchFact | undefined {
  return programFact?.callbackFacts?.[callbackName]?.classnameBranches?.find((branch) => branch.classname === classname);
}

function quakeProgramCallbackCalls(
  callbackFact: QuakeGameLogicProgramCallbackFact,
  call: string,
): boolean {
  return callbackFact.calls?.includes(call) ?? false;
}

function quakeProgramCallbackHasAssignment(
  callbackFact: QuakeGameLogicProgramCallbackFact,
  field: string,
  expression: string,
): boolean {
  return callbackFact.assignments?.some((assignment) =>
    assignment.field === field &&
    assignment.expression === expression
  ) ?? false;
}

function quakeProgramCallbackNextthinkOffsetSeconds(
  callbackFact: QuakeGameLogicProgramCallbackFact,
  expression: string,
): number | undefined {
  const assignment = callbackFact.assignments?.find((candidate) =>
    candidate.field === "self.nextthink" &&
    candidate.expression === expression
  );
  return quakeProgramTimeOffsetSeconds(assignment?.expression);
}

function quakeProgramBranchFieldNumber(
  branch: QuakeGameLogicProgramCallbackClassnameBranchFact,
  field: string,
): number | undefined {
  const value = branch.assignments.find((assignment) => assignment.field === field)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function quakeProgramBranchFieldExpression(
  branch: QuakeGameLogicProgramCallbackClassnameBranchFact,
  field: string,
): string | undefined {
  return branch.assignments.find((assignment) => assignment.field === field)?.expression;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quakeEntityNumber(entity: QuakeEntity, key: string, fallback: number): number {
  const value = Number.parseFloat(entity.properties[key] ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function quakeEntityDefaultedNumber(entity: QuakeEntity, key: string, fallback: number): number {
  const value = quakeEntityNumber(entity, key, Number.NaN);
  return Number.isFinite(value) && value !== 0 ? value : fallback;
}

function quakeButtonActivationSound(sounds: number): Pick<QuakeGameLogicResolvedFuncButtonFact, "activationSound"> {
  if (sounds === 1) return { activationSound: "buttons/airbut1.wav" };
  if (sounds === 2) return { activationSound: "buttons/switch21.wav" };
  if (sounds === 3) return { activationSound: "buttons/switch02.wav" };
  if (sounds === 4) return { activationSound: "buttons/switch04.wav" };
  return {};
}

function quakeTriggerActivationSound(sounds: number): Pick<QuakeGameLogicResolvedTriggerFact, "activationSound"> {
  if (sounds === 1) return { activationSound: "misc/secret.wav" };
  if (sounds === 2) return { activationSound: "misc/talk.wav" };
  if (sounds === 3) return { activationSound: "misc/trigger1.wav" };
  return {};
}

function quakeTrainSoundSet(sounds: number): Pick<QuakeGameLogicResolvedFuncTrainFact, "soundSet"> {
  if (sounds === 0) return { soundSet: { move: "misc/null.wav", stop: "misc/null.wav" } };
  if (sounds === 1) return { soundSet: { move: "plats/train2.wav", stop: "plats/train1.wav" } };
  return {};
}

function quakePlatSoundSet(sounds: number): Pick<QuakeGameLogicResolvedFuncPlatFact, "soundSet"> {
  if (sounds === 1) {
    return { soundSet: { move: "plats/plat1.wav", stop: "plats/plat2.wav" } };
  }
  if (sounds === 2) {
    return { soundSet: { move: "plats/medplat1.wav", stop: "plats/medplat2.wav" } };
  }
  return {};
}

function quakeGameLogicModeMask(entity: QuakeEntity, spawnflags: number): QuakeGameLogicMode[] {
  if (entity.classname === "info_player_deathmatch") return ["multiplayer:deathmatch"];
  if (entity.classname === "info_player_coop") return ["multiplayer:coop"];
  const modes: QuakeGameLogicMode[] = [];
  if ((spawnflags & QUAKE_SPAWNFLAG_NOT_EASY) === 0) modes.push("singleplayer:easy");
  if ((spawnflags & QUAKE_SPAWNFLAG_NOT_NORMAL) === 0) modes.push("singleplayer:normal");
  if ((spawnflags & QUAKE_SPAWNFLAG_NOT_HARD) === 0) modes.push("singleplayer:hard");
  return modes;
}

function quakeGameLogicWorldtype(entities: QuakeEntity[]): number | undefined {
  const worldspawn = entities.find((entity) => entity.classname === "worldspawn");
  const worldtype = parseFiniteInteger(worldspawn?.properties.worldtype);
  return worldtype === undefined ? undefined : Math.max(0, worldtype);
}

function normalizedEntityProperties(entity: QuakeEntity): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const key of NORMALIZED_ENTITY_PROPERTY_KEYS) {
    const value = entity.properties[key];
    if (value === undefined) continue;
    const numeric = Number.parseFloat(value);
    out[key] = Number.isFinite(numeric) && String(numeric) === value.trim() ? numeric : value;
  }
  return out;
}

function buildQuakeGameLogicSpawnSets(entities: QuakeGameLogicEntityFact[]): QuakeGameLogicSpawnSets {
  return {
    singleplayerEasy: entities
      .filter((entity) => entity.modeMask.includes("singleplayer:easy"))
      .map((entity) => entity.entityIndex),
    singleplayerNormal: entities
      .filter((entity) => entity.modeMask.includes("singleplayer:normal"))
      .map((entity) => entity.entityIndex),
    singleplayerHard: entities
      .filter((entity) => entity.modeMask.includes("singleplayer:hard"))
      .map((entity) => entity.entityIndex),
  };
}

function buildQuakeGameLogicModelFacts(models: QuakePreparedModel[]): Record<string, QuakeGameLogicModelFact> {
  return Object.fromEntries(models.map((model) => [String(model.index), cloneQuakeGameLogicModelFact(model)]));
}

function buildQuakeGameLogicBrushModelFacts(
  brushModels: QuakePreparedBrushCollision[],
  models: QuakePreparedModel[],
): Record<string, QuakeGameLogicBrushModelFact> {
  const modelByIndex = new Map(models.map((model) => [model.index, model]));
  return Object.fromEntries(brushModels.map((brushModel) => {
    const model = modelByIndex.get(brushModel.modelIndex);
    const base = model
      ? cloneQuakeGameLogicModelFact(model)
      : {
          modelIndex: brushModel.modelIndex,
          mins: { ...brushModel.mins },
          maxs: { ...brushModel.maxs },
          origin: { ...brushModel.origin },
          headNodes: [...brushModel.headNodes] as [number, number, number, number],
          hulls: brushModel.hulls.map(cloneQuakeGameLogicHullFact),
          firstFace: 0,
          faceCount: 0,
        };
    return [String(brushModel.modelIndex), {
      ...base,
      entityIndex: brushModel.entityIndex,
      classname: brushModel.classname,
      kind: brushModel.kind,
      ...(brushModel.target ? { target: brushModel.target } : {}),
      ...(brushModel.targetname ? { targetname: brushModel.targetname } : {}),
    }];
  }));
}

function cloneQuakeGameLogicModelFact(model: QuakePreparedModel): QuakeGameLogicModelFact {
  return {
    modelIndex: model.index,
    mins: { ...model.mins },
    maxs: { ...model.maxs },
    origin: { ...model.origin },
    headNodes: [...model.headNodes] as [number, number, number, number],
    hulls: model.hulls.map(cloneQuakeGameLogicHullFact),
    firstFace: model.firstFace,
    faceCount: model.faceCount,
  };
}

function cloneQuakeGameLogicHullFact(hull: QuakeCollisionHull): QuakeGameLogicHullFact {
  return {
    index: hull.index,
    headNode: hull.headNode,
    mins: { ...hull.mins },
    maxs: { ...hull.maxs },
  };
}

function buildQuakeGameLogicProgramFacts(
  programFactsInput: QuakeGameLogicProgramFactsInput | null | undefined,
  entities: QuakeEntity[],
): QuakeGameLogicProgramFacts {
  const sourceEntities = programFactsInput?.entities ?? {};
  const classnames = quakeGameLogicProgramClassnames(entities);
  const facts: Record<string, QuakeGameLogicProgramEntityFact> = {};
  const missingClassnames: string[] = [];
  for (const classname of classnames) {
    const sourceFact = sourceEntities[classname];
    const normalized = normalizeProgramEntityFact(sourceFact);
    if (normalized) {
      facts[classname] = normalized;
    } else {
      missingClassnames.push(classname);
    }
  }
  const repository = asString(programFactsInput?.source?.repository);
  const revision = asString(programFactsInput?.source?.revision);
  return {
    version: 1,
    ...(repository && revision ? { source: { repository, revision } } : {}),
    entities: facts,
    missingClassnames,
  };
}

function quakeGameLogicProgramClassnames(entities: QuakeEntity[]): string[] {
  const classnames = new Set(entities.map((entity) => entity.classname).filter(Boolean));
  if (classnames.has("trigger_once") || classnames.has("trigger_secret")) {
    classnames.add("trigger_multiple");
  }
  return [...classnames].sort();
}

function normalizeProgramEntityFact(sourceFact: unknown): QuakeGameLogicProgramEntityFact | null {
  if (!sourceFact || typeof sourceFact !== "object") return null;
  const record = sourceFact as Record<string, unknown>;
  const classname = asString(record.classname);
  const functionName = asString(record.functionName);
  if (!classname || !functionName) return null;
  const source = normalizeProgramSourceMetadata(record.source);
  const callbackFacts = normalizedProgramCallbackFacts(record.callbackFacts);
  return {
    assetRefs: normalizedProgramAssetRefs(record.assetRefs),
    ...(callbackFacts.length ? { callbackFacts: Object.fromEntries(callbackFacts) } : {}),
    classname,
    functionName,
    kind: asString(record.kind) ?? "unknown",
    callbacks: normalizedStringRecord(record.callbacks),
    calls: normalizedStringArray(record.calls),
    dependencies: {
      models: normalizedDependencyPaths((record.dependencies as Record<string, unknown> | undefined)?.models),
      sounds: normalizedDependencyPaths((record.dependencies as Record<string, unknown> | undefined)?.sounds),
    },
    defaultAssignments: normalizedProgramAssignments(record.defaultAssignments),
    fieldAssignments: normalizedProgramAssignments(record.fieldAssignments),
    setmodels: normalizedProgramSetmodels(record.setmodels),
    setsizes: normalizedProgramSetsizes(record.setsizes),
    ...(source ? { source } : {}),
    sourceRefs: normalizedSourceRefs(record.sourceRefs),
    spawnflagChecks: normalizedSpawnflagChecks(record.spawnflagChecks),
  };
}

function normalizedProgramCallbackFacts(input: unknown): [string, QuakeGameLogicProgramCallbackFact][] {
  if (!input || typeof input !== "object") return [];
  const out: [string, QuakeGameLogicProgramCallbackFact][] = [];
  for (const [callbackName, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    out.push([callbackName, {
      assignments: normalizedProgramAssignments(record.assignments),
      calls: normalizedStringArray(record.calls),
      classnameBranches: normalizedProgramCallbackClassnameBranches(record.classnameBranches),
      sourceRefs: normalizedSourceRefs(record.sourceRefs),
    }]);
  }
  return out;
}

function normalizedProgramCallbackClassnameBranches(input: unknown): QuakeGameLogicProgramCallbackClassnameBranchFact[] {
  if (!Array.isArray(input)) return [];
  const out: QuakeGameLogicProgramCallbackClassnameBranchFact[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const classname = asString(record.classname);
    if (!classname) continue;
    const sourceRef = normalizeSourceRef(record.sourceRef);
    out.push({
      assignments: normalizedProgramAssignments(record.assignments),
      classname,
      ...(sourceRef ? { sourceRef } : {}),
    });
  }
  return out;
}

function normalizedProgramAssetRefs(input: unknown): QuakeGameLogicProgramAssetRef[] {
  if (!Array.isArray(input)) return [];
  const out: QuakeGameLogicProgramAssetRef[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const call = asString(record.call);
    const kind = asString(record.kind);
    const assetPath = asString(record.path);
    if (!call || !kind || !assetPath) continue;
    const sourceRef = normalizeSourceRef(record.sourceRef);
    out.push({
      call,
      kind,
      path: assetPath,
      ...(sourceRef ? { sourceRef } : {}),
    });
  }
  return out;
}

function normalizedProgramAssignments(input: unknown): QuakeGameLogicProgramAssignment[] {
  if (!Array.isArray(input)) return [];
  const out: QuakeGameLogicProgramAssignment[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const expression = asString(record.expression);
    const field = asString(record.field);
    if (!expression || !field) continue;
    const condition = asString(record.condition);
    const sourceRef = normalizeSourceRef(record.sourceRef);
    const value = programFactValue(record.value);
    out.push({
      ...(condition ? { condition } : {}),
      expression,
      field,
      ...(sourceRef ? { sourceRef } : {}),
      ...(value !== undefined ? { value } : {}),
    });
  }
  return out;
}

function normalizedProgramSetmodels(input: unknown): QuakeGameLogicProgramSetmodel[] {
  if (!Array.isArray(input)) return [];
  const out: QuakeGameLogicProgramSetmodel[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const expression = asString(record.expression);
    if (!expression) continue;
    const sourceRef = normalizeSourceRef(record.sourceRef);
    const value = programFactValue(record.value);
    out.push({
      expression,
      ...(sourceRef ? { sourceRef } : {}),
      ...(value !== undefined ? { value } : {}),
    });
  }
  return out;
}

function normalizedProgramSetsizes(input: unknown): QuakeGameLogicProgramSetsize[] {
  if (!Array.isArray(input)) return [];
  const out: QuakeGameLogicProgramSetsize[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const minExpression = asString(record.minExpression);
    const maxExpression = asString(record.maxExpression);
    if (!minExpression || !maxExpression) continue;
    const max = programFactValue(record.max);
    const min = programFactValue(record.min);
    const sourceRef = normalizeSourceRef(record.sourceRef);
    out.push({
      maxExpression,
      minExpression,
      ...(max !== undefined ? { max } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(sourceRef ? { sourceRef } : {}),
    });
  }
  return out;
}

function normalizedSpawnflagChecks(input: unknown): QuakeGameLogicProgramSpawnflagCheck[] {
  if (!Array.isArray(input)) return [];
  const out: QuakeGameLogicProgramSpawnflagCheck[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = asString(record.name);
    if (!name) continue;
    const value = typeof record.value === "number" && Number.isFinite(record.value) ? record.value : undefined;
    const sourceRef = normalizeSourceRef(record.sourceRef);
    out.push({
      name,
      ...(sourceRef ? { sourceRef } : {}),
      ...(value !== undefined ? { value } : {}),
    });
  }
  return out;
}

function cloneProgramSpawnflagCheck(check: QuakeGameLogicProgramSpawnflagCheck): QuakeGameLogicProgramSpawnflagCheck {
  return {
    name: check.name,
    ...(check.value !== undefined ? { value: check.value } : {}),
    ...(check.sourceRef ? { sourceRef: { ...check.sourceRef } } : {}),
  };
}

function normalizeProgramSourceMetadata(input: unknown): QuakeGameLogicProgramSourceMetadata | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const license = asString(record.license);
  const repository = asString(record.repository);
  const revision = asString(record.revision);
  const sourceFile = asString(record.sourceFile);
  const sourceSha256 = asString(record.sourceSha256);
  const sourceUrl = asString(record.sourceUrl);
  const out = {
    ...(license ? { license } : {}),
    ...(repository ? { repository } : {}),
    ...(revision ? { revision } : {}),
    ...(sourceFile ? { sourceFile } : {}),
    ...(sourceSha256 ? { sourceSha256 } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizedSourceRefs(input: unknown): QuakeGameLogicProgramSourceRef[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeSourceRef).filter((ref): ref is QuakeGameLogicProgramSourceRef => !!ref);
}

function normalizeSourceRef(input: unknown): QuakeGameLogicProgramSourceRef | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const sourceFile = asString(record.sourceFile);
  const functionName = asString(record.functionName);
  const line = typeof record.line === "number" && Number.isFinite(record.line) ? Math.trunc(record.line) : undefined;
  if (!sourceFile || !functionName || line === undefined) return undefined;
  return { sourceFile, functionName, line };
}

function normalizedDependencyPaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const paths = input
    .map((item) => item && typeof item === "object" ? asString((item as Record<string, unknown>).path) : null)
    .filter((item): item is string => !!item);
  return [...new Set(paths)].sort();
}

function normalizedStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map(asString).filter((item): item is string => !!item);
}

function normalizedStringRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = asString(value);
    if (normalized) out[key] = normalized;
  }
  return out;
}

function programFactValue(input: unknown): QuakeGameLogicProgramValue | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") return input;
  if (Array.isArray(input) && input.length === 3 && input.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return [input[0], input[1], input[2]];
  }
  return undefined;
}

function cloneTargetGraph(targetGraph: Record<string, number[]>): Record<string, number[]> {
  return Object.fromEntries(Object.entries(targetGraph).map(([key, indexes]) => [key, [...indexes]]));
}

function cloneQuakeGameLogicRuntimeIndexes(runtime: QuakeEntityRuntimeManifest): QuakeEntityRuntimeManifest {
  return {
    targetEntities: cloneTargetGraph(runtime.targetEntities),
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

function parseFiniteInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
