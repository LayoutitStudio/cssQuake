import type {
  QuakeGameLogicEntityFact,
  QuakeGameLogicFacts,
  QuakeGameLogicResolvedTriggerFact,
  QuakeGameLogicResolvedTriggerKind,
  QuakeGameLogicSingleplayerMode,
} from "../prepare/gameLogicFacts";
import type { QuakeEntity, QuakeEntityRuntimeManifest, QuakeVertex } from "../prepare/scene";
import type { QuakeTouchedTrigger } from "./collision";
import { quakeEntityNumber, quakeEntitySpawnflags } from "./entities";
import { quakeTriggerHurtDamage } from "./hazards";
import { normalizeVec3 } from "./math";
import { createQuakeTargetsController, type QuakeTargetsController } from "./targets";
import {
  quakeTriggerChangelevelMap,
  quakeTriggerHurtDamageAmount,
  quakeTriggerOnlyRegisteredActivation,
  quakeTriggerOneShot,
  quakeTriggerPushActivation,
  quakeTriggerSetSkillValue,
  quakeTriggerWait,
} from "./triggerEffects";
import { createQuakeTriggersController, type QuakeTriggersController } from "./triggers";

export type QuakeTriggerRuntimeAuditSeverity = "error" | "warning" | "info";

export interface QuakeTriggerRuntimeAuditFinding {
  severity: QuakeTriggerRuntimeAuditSeverity;
  code: string;
  message: string;
  entityIndex?: number;
  classname?: string;
  expected?: unknown;
  actual?: unknown;
}

export interface QuakeTriggerRuntimeAuditCoverage {
  checkedTriggers: number;
  callbackConsumptionChecks: number;
  controllerTouchChecks: number;
  triggerWaitChecks: number;
  useChecks: number;
  counterChecks: number;
  teleporterChecks: number;
  teleporterGateChecks: number;
  hazardChecks: number;
  oneShotDisableChecks: number;
  repeatCooldownChecks: number;
  changelevelChecks: number;
  specialChecks: number;
  targetUseChecks: number;
  targetMonsterUseChecks: number;
  targetMonsterActivationChecks: number;
  targetMonsterImmediateActivationChecks: number;
  targetMonsterDelayedActivationChecks: number;
  targetMonsterKilltargetFilteredChecks: number;
  targetMonsterSelfFilteredChecks: number;
  unsupportedPlayerTouchChecks: number;
}

export interface QuakeTriggerRuntimeAuditReport {
  mapLabel: string;
  findings: QuakeTriggerRuntimeAuditFinding[];
  coverage: QuakeTriggerRuntimeAuditCoverage;
}

export interface QuakeTriggerRuntimeAuditInput {
  mapLabel?: string;
  entities: readonly QuakeEntity[];
  runtime: QuakeEntityRuntimeManifest;
  gameLogic: QuakeGameLogicFacts | null | undefined;
  mode?: QuakeGameLogicSingleplayerMode;
  sharewareRegistered?: boolean;
}

type QuakeTriggerRuntimeAuditEvent =
  | { type: "activate-entity"; entityIndex: number; classname?: string; sourceEntityIndex?: number }
  | { type: "complete-level"; entityIndex: number; map?: string }
  | { type: "counter-complete"; entityIndex: number }
  | { type: "disable"; entityIndex: number }
  | { type: "push"; entityIndex: number; velocity: [number, number, number] }
  | { type: "registered-only"; entityIndex: number; allowed: boolean; message?: string }
  | { type: "setskill"; entityIndex: number; skillValue: number }
  | { type: "teleport"; entityIndex: number; target?: string }
  | { type: "use-targets"; entityIndex: number; result: boolean }
  | { type: "use-targets-message"; entityIndex: number; text: string; sourceCall: string; sourceFunction: string };

interface QuakeTriggerRuntimeAuditHarness {
  events: QuakeTriggerRuntimeAuditEvent[];
  targetSystem: QuakeTargetsController;
  triggerSystem: QuakeTriggersController;
  activateEntity(entityIndex: number, sourceEntityIndex?: number): boolean;
  flushTimers(): void;
  touchEntity(entity: QuakeEntity): void;
  disabledEntityIndexes(): number[];
}

interface QuakeTriggerRuntimeBranch {
  damageable: boolean;
  oneShot: boolean;
  touchActivates: boolean;
  useActivates: boolean;
  wait?: number;
  count?: number;
  dmg?: number;
  speed?: number;
  height?: number;
  skillValue?: number;
  moveDirection?: QuakeVertex;
  pushVelocityMultiplier?: number;
  requiresUseBeforeTouch?: boolean;
}

type QuakeTriggerCallbackName = keyof QuakeGameLogicResolvedTriggerFact["callbacks"];
type QuakeTriggerAuditWindow = Window & {
  __quakeTriggerAuditFlushTimers?: () => void;
};

const QUAKE_TRIGGER_MULTIPLE_DEFAULT_WAIT = 0.2;
const QUAKE_TRIGGER_COUNTER_DEFAULT_COUNT = 2;
const QUAKE_TRIGGER_HURT_DEFAULT_DMG = 5;
const QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_SPEED = 200;
const QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_HEIGHT = 200;
const QUAKE_TRIGGER_NOTOUCH = 1;
const QUAKE_TRIGGER_PUSH_ONCE = 1;

const EMPTY_COVERAGE: QuakeTriggerRuntimeAuditCoverage = {
  checkedTriggers: 0,
  callbackConsumptionChecks: 0,
  controllerTouchChecks: 0,
  triggerWaitChecks: 0,
  useChecks: 0,
  counterChecks: 0,
  teleporterChecks: 0,
  teleporterGateChecks: 0,
  hazardChecks: 0,
  oneShotDisableChecks: 0,
  repeatCooldownChecks: 0,
  changelevelChecks: 0,
  specialChecks: 0,
  targetUseChecks: 0,
  targetMonsterUseChecks: 0,
  targetMonsterActivationChecks: 0,
  targetMonsterImmediateActivationChecks: 0,
  targetMonsterDelayedActivationChecks: 0,
  targetMonsterKilltargetFilteredChecks: 0,
  targetMonsterSelfFilteredChecks: 0,
  unsupportedPlayerTouchChecks: 0,
};

export function auditQuakeTriggerRuntimeFacts(
  input: QuakeTriggerRuntimeAuditInput,
): QuakeTriggerRuntimeAuditReport {
  return withQuakeTriggerAuditWindow(() => auditQuakeTriggerRuntimeFactsWithWindow(input));
}

function auditQuakeTriggerRuntimeFactsWithWindow(
  input: QuakeTriggerRuntimeAuditInput,
): QuakeTriggerRuntimeAuditReport {
  const mapLabel = input.mapLabel ?? input.gameLogic?.sources.bsp.label ?? "unknown";
  const findings: QuakeTriggerRuntimeAuditFinding[] = [];
  const coverage = { ...EMPTY_COVERAGE };

  if (!input.gameLogic) {
    findings.push({
      severity: "error",
      code: "missing-game-logic",
      message: "Scene is missing prebaked game logic facts.",
    });
    return { mapLabel, findings, coverage };
  }

  const entityByIndex = new Map(input.entities.map((entity) => [entity.index, entity]));
  const factByIndex = new Map(input.gameLogic.entities.map((entity) => [entity.entityIndex, entity]));
  const triggerFacts = input.gameLogic.entities.filter(
    (entity): entity is QuakeGameLogicEntityFact & { resolvedTrigger: QuakeGameLogicResolvedTriggerFact } =>
      Boolean(entity.resolvedTrigger),
  );

  for (const factEntity of triggerFacts) {
    const entity = entityByIndex.get(factEntity.entityIndex);
    coverage.checkedTriggers += 1;
    if (!entity) {
      findings.push(finding("error", "missing-runtime-entity", factEntity, "Trigger fact has no prepared runtime entity."));
      continue;
    }
    if (entity.classname !== factEntity.classname) {
      findings.push(finding(
        "error",
        "classname-mismatch",
        factEntity,
        "Trigger fact classname does not match the prepared entity.",
        factEntity.classname,
        entity.classname,
      ));
      continue;
    }

    auditBranchFacts(findings, coverage, input.gameLogic, entity, factEntity.resolvedTrigger);
    auditTargetUseFacts(findings, coverage, input, input.runtime, factByIndex, factEntity, input.mode ?? "singleplayer:normal");
    auditRuntimeControllerBehavior(findings, coverage, input, entity, factEntity.resolvedTrigger);
    auditCallbackConsumption(findings, coverage, entity, factEntity.resolvedTrigger);
  }

  return { mapLabel, findings, coverage };
}

function withQuakeTriggerAuditWindow<T>(callback: () => T): T {
  const auditGlobal = globalThis as typeof globalThis & { window?: Window };
  if (auditGlobal.window) return callback();
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  auditGlobal.window = {
    setTimeout: ((handler: TimerHandler) => {
      const id = nextTimer++;
      if (typeof handler === "function") timers.set(id, handler as () => void);
      return id;
    }) as unknown as Window["setTimeout"],
    clearTimeout: ((id?: number) => {
      if (typeof id === "number") timers.delete(id);
    }) as unknown as Window["clearTimeout"],
    __quakeTriggerAuditFlushTimers: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const timer of callbacks) timer();
    },
  } as QuakeTriggerAuditWindow;
  try {
    return callback();
  } finally {
    delete auditGlobal.window;
  }
}

function auditBranchFacts(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  gameLogic: QuakeGameLogicFacts | null | undefined,
  entity: QuakeEntity,
  trigger: QuakeGameLogicResolvedTriggerFact,
): void {
  const runtime = runtimeBranchForTrigger(entity, gameLogic);
  compare(findings, entity, "damageable-mismatch", trigger.damageable, runtime.damageable);
  compare(findings, entity, "one-shot-mismatch", trigger.oneShot, runtime.oneShot);
  compare(findings, entity, "touch-activation-mismatch", trigger.touchActivates, runtime.touchActivates);
  compare(findings, entity, "use-activation-mismatch", trigger.useActivates, runtime.useActivates);
  if (trigger.wait !== undefined) coverage.triggerWaitChecks += 1;
  compareOptionalNumber(findings, entity, "wait-mismatch", trigger.wait, runtime.wait);
  compareOptionalNumber(findings, entity, "count-mismatch", trigger.count, runtime.count);
  compareOptionalNumber(findings, entity, "damage-mismatch", trigger.dmg, runtime.dmg);
  compareOptionalNumber(findings, entity, "speed-mismatch", trigger.speed, runtime.speed);
  compareOptionalNumber(findings, entity, "height-mismatch", trigger.height, runtime.height);
  compareOptionalNumber(findings, entity, "skill-value-mismatch", trigger.skillValue, runtime.skillValue);
  compareOptionalNumber(
    findings,
    entity,
    "push-velocity-multiplier-mismatch",
    trigger.pushVelocityMultiplier,
    runtime.pushVelocityMultiplier,
  );
  compare(findings, entity, "requires-use-before-touch-mismatch", trigger.requiresUseBeforeTouch, runtime.requiresUseBeforeTouch);
  if (trigger.moveDirection || runtime.moveDirection) {
    compare(findings, entity, "move-direction-mismatch", trigger.moveDirection, runtime.moveDirection);
  }

  if (trigger.kind === "trigger_hurt") coverage.hazardChecks += 1;
  if (trigger.kind === "trigger_push" || trigger.kind === "trigger_setskill" || trigger.kind === "trigger_onlyregistered") {
    coverage.specialChecks += 1;
  }
  if (trigger.kind === "trigger_monsterjump") {
    coverage.unsupportedPlayerTouchChecks += 1;
    findings.push(finding(
      "info",
      "monsterjump-player-touch-not-consumed",
      entity,
      "trigger_monsterjump player touch is intentionally ignored; monster-side runtime consumes the source-shaped jump rule.",
    ));
  }
}

function auditCallbackConsumption(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  entity: QuakeEntity,
  trigger: QuakeGameLogicResolvedTriggerFact,
): void {
  const consumedCallbacks = runtimeConsumedTriggerCallbacks(trigger);
  for (const callbackName of activeTriggerCallbacks(trigger)) {
    coverage.callbackConsumptionChecks += 1;
    if (consumedCallbacks.has(callbackName)) continue;
    findings.push(finding(
      "warning",
      "supported-trigger-callback-not-consumed",
      entity,
      "Prebaked trigger facts expose an active QuakeC callback that the current runtime audit does not recognize as consumed.",
      callbackName,
      [...consumedCallbacks].sort(),
    ));
  }
}

function activeTriggerCallbacks(trigger: QuakeGameLogicResolvedTriggerFact): QuakeTriggerCallbackName[] {
  const callbacks: QuakeTriggerCallbackName[] = [];
  if (trigger.callbacks.touch && trigger.touchActivates) callbacks.push("touch");
  if (trigger.callbacks.use && trigger.useActivates) callbacks.push("use");
  if (trigger.callbacks.th_die && trigger.damageable) callbacks.push("th_die");
  return callbacks;
}

function runtimeConsumedTriggerCallbacks(trigger: QuakeGameLogicResolvedTriggerFact): Set<QuakeTriggerCallbackName> {
  const callbacks = new Set<QuakeTriggerCallbackName>();
  if (trigger.touchActivates) callbacks.add("touch");
  if (trigger.useActivates) callbacks.add("use");
  if (
    trigger.damageable &&
    (trigger.kind === "trigger_multiple" || trigger.kind === "trigger_once" || trigger.kind === "trigger_secret")
  ) {
    callbacks.add("th_die");
  }
  return callbacks;
}

function auditTargetUseFacts(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  input: QuakeTriggerRuntimeAuditInput,
  runtime: QuakeEntityRuntimeManifest,
  factByIndex: Map<number, QuakeGameLogicEntityFact>,
  factEntity: QuakeGameLogicEntityFact & { resolvedTrigger: QuakeGameLogicResolvedTriggerFact },
  mode: QuakeGameLogicSingleplayerMode,
): void {
  const trigger = factEntity.resolvedTrigger;
  const targetUse = trigger.targetUse;
  if (targetUse.target) {
    coverage.targetUseChecks += 1;
    coverage.targetMonsterUseChecks += monsterTargetIndexes(input, targetUse.targetEntityIndexes).length;
    const runtimeTargetIndexes = runtime.targetEntities[targetUse.target] ?? [];
    compare(findings, factEntity, "target-index-mismatch", targetUse.targetEntityIndexes, runtimeTargetIndexes);
    const active = targetUse.activeTargetEntityIndexesByMode[modeEntityIndexSetKey(mode)];
    if (active.length !== targetUse.targetEntityIndexes.filter((index) => index !== factEntity.entityIndex).length) {
      const inactiveTargets = targetUse.targetEntityIndexes.filter((index) => {
        if (index === factEntity.entityIndex) return false;
        const target = factByIndex.get(index);
        return !target || target.runtimeStatus !== "active" || !target.modeMask.includes(mode);
      });
      if (inactiveTargets.length) {
        findings.push(finding(
          "info",
          "target-graph-has-filtered-indexes",
          factEntity,
          "Runtime target graph is raw; prebaked facts also expose mode-filtered active target indexes for future consumers.",
          active,
          targetUse.targetEntityIndexes,
        ));
      }
    }
  }
  if (targetUse.killtarget) {
    coverage.targetUseChecks += 1;
    compare(
      findings,
      factEntity,
      "killtarget-index-mismatch",
      targetUse.killtargetEntityIndexes ?? [],
      runtime.targetEntities[targetUse.killtarget] ?? [],
    );
  }
  if (trigger.kind === "trigger_counter") {
    const runtimeCount = new Map(runtime.triggerCounterCounts).get(factEntity.entityIndex);
    compareOptionalNumber(findings, factEntity, "counter-runtime-count-mismatch", trigger.count, runtimeCount);
  }
}

function modeEntityIndexSetKey(
  mode: QuakeGameLogicSingleplayerMode,
): "singleplayerEasy" | "singleplayerNormal" | "singleplayerHard" {
  if (mode === "singleplayer:easy") return "singleplayerEasy";
  if (mode === "singleplayer:hard") return "singleplayerHard";
  return "singleplayerNormal";
}

function auditRuntimeControllerBehavior(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  input: QuakeTriggerRuntimeAuditInput,
  entity: QuakeEntity,
  trigger: QuakeGameLogicResolvedTriggerFact,
): void {
  if (trigger.kind === "trigger_hurt") {
    const damage = quakeTriggerHurtDamage(entity, input.gameLogic);
    compare(findings, entity, "trigger-hurt-damage-mismatch", trigger.dmg ?? 0, damage?.amount ?? 0);
    return;
  }

  if (trigger.kind === "trigger_counter") {
    auditCounterUse(findings, coverage, input, entity, trigger);
    return;
  }

  if (trigger.kind === "trigger_relay") {
    auditUseTargets(findings, coverage, input, entity, trigger);
    return;
  }

  if (trigger.kind === "trigger_teleport") {
    auditTeleporterTouch(findings, coverage, input, entity, trigger);
    return;
  }

  if (trigger.kind === "trigger_monsterjump") {
    auditMonsterJumpPlayerTouchIgnored(findings, coverage, input, entity);
    return;
  }

  if (trigger.touchActivates) {
    auditTouchActivation(findings, coverage, input, entity, trigger);
  }

  if (trigger.useActivates && !trigger.requiresUseBeforeTouch) {
    auditUseTargets(findings, coverage, input, entity, trigger);
  }
}

function auditMonsterJumpPlayerTouchIgnored(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  input: QuakeTriggerRuntimeAuditInput,
  entity: QuakeEntity,
): void {
  coverage.controllerTouchChecks += 1;
  const harness = createAuditHarness(input);
  harness.touchEntity(entity);
  const unexpectedEvents = harness.events.filter((event) =>
    event.type === "activate-entity" ||
    event.type === "push" ||
    event.type === "use-targets"
  );
  if (unexpectedEvents.length === 0) return;
  findings.push(finding(
    "error",
    "monsterjump-player-touch-consumed",
    entity,
    "Player trigger dispatch must not consume monster-only trigger_monsterjump touch behavior.",
    [],
    unexpectedEvents,
  ));
}

function auditTouchActivation(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  input: QuakeTriggerRuntimeAuditInput,
  entity: QuakeEntity,
  trigger: QuakeGameLogicResolvedTriggerFact,
): void {
  coverage.controllerTouchChecks += 1;
  const harness = createAuditHarness(input);
  harness.touchEntity(entity);
  const events = harness.events;
  if (trigger.kind === "trigger_changelevel") {
    coverage.changelevelChecks += 1;
    const event = events.find((item): item is Extract<QuakeTriggerRuntimeAuditEvent, { type: "complete-level" }> =>
      item.type === "complete-level"
    );
    if (!event) {
      requireEvent(findings, entity, events, "complete-level");
      return;
    }
    compare(findings, entity, "changelevel-touch-map-mismatch", trigger.changelevelMap, event.map);
    return;
  }
  if (trigger.kind === "trigger_push") {
    const event = events.find((item): item is Extract<QuakeTriggerRuntimeAuditEvent, { type: "push" }> =>
      item.type === "push"
    );
    if (!event) {
      requireEvent(findings, entity, events, "push");
      return;
    }
    const expectedVelocity = trigger.moveDirection && trigger.speed !== undefined && trigger.pushVelocityMultiplier !== undefined
      ? [
          trigger.moveDirection.x * trigger.speed * trigger.pushVelocityMultiplier,
          trigger.moveDirection.y * trigger.speed * trigger.pushVelocityMultiplier,
          trigger.moveDirection.z * trigger.speed * trigger.pushVelocityMultiplier,
        ]
      : undefined;
    if (expectedVelocity) compare(findings, entity, "trigger-push-velocity-mismatch", expectedVelocity, event.velocity);
    if (trigger.oneShot) auditOneShotDisabled(findings, coverage, entity, harness.disabledEntityIndexes());
    return;
  }
  if (trigger.kind === "trigger_setskill") {
    const event = events.find((item): item is Extract<QuakeTriggerRuntimeAuditEvent, { type: "setskill" }> =>
      item.type === "setskill"
    );
    if (!event) {
      requireEvent(findings, entity, events, "setskill");
      return;
    }
    compare(findings, entity, "setskill-touch-value-mismatch", trigger.skillValue, event.skillValue);
    return;
  }
  if (trigger.kind === "trigger_onlyregistered") {
    const event = events.find((item): item is Extract<QuakeTriggerRuntimeAuditEvent, { type: "registered-only" }> =>
      item.type === "registered-only"
    );
    if (!event) {
      requireEvent(findings, entity, events, "registered-only");
      return;
    }
    const expectedAllowed = (input.sharewareRegistered ?? false) || trigger.registeredOnly !== true;
    compare(findings, entity, "registered-only-allowed-mismatch", expectedAllowed, event.allowed);
    if (!expectedAllowed) {
      compare(
        findings,
        entity,
        "registered-only-message-mismatch",
        quakeAuditMessage(trigger.message, "REGISTERED VERSION ONLY"),
        event.message,
      );
    }
    return;
  }
  if (trigger.oneShot) auditOneShotDisabled(findings, coverage, entity, harness.disabledEntityIndexes());
  auditUseTargetsMessage(findings, entity, trigger, events);
  if (trigger.kind === "trigger_multiple" && (trigger.wait ?? 0) > 0) {
    coverage.repeatCooldownChecks += 1;
    const before = targetActivationEvents(events).length;
    harness.triggerSystem.resetActive();
    harness.touchEntity(entity);
    const after = targetActivationEvents(events).length;
    if (after !== before) {
      findings.push(finding(
        "error",
        "trigger-multiple-cooldown-mismatch",
        entity,
        "trigger_multiple touched again before wait elapsed.",
        before,
        after,
      ));
    }
  }
}

function auditUseTargets(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  input: QuakeTriggerRuntimeAuditInput,
  entity: QuakeEntity,
  trigger: QuakeGameLogicResolvedTriggerFact,
): void {
  coverage.useChecks += 1;
  const harness = createAuditHarness(input);
  harness.activateEntity(entity.index);
  if (trigger.oneShot) auditOneShotDisabled(findings, coverage, entity, harness.disabledEntityIndexes());
  auditUseTargetsMessage(findings, entity, trigger, harness.events);
  auditTargetActivationIndexes(findings, coverage, input, entity, trigger, harness);
}

function auditUseTargetsMessage(
  findings: QuakeTriggerRuntimeAuditFinding[],
  entity: QuakeEntity,
  trigger: QuakeGameLogicResolvedTriggerFact,
  events: readonly QuakeTriggerRuntimeAuditEvent[],
): void {
  const text = trigger.messageText;
  if (!text || text.sourceCall !== "SUB_UseTargets" || trigger.targetUse.delay > 0) return;
  const event = events.find((item): item is Extract<QuakeTriggerRuntimeAuditEvent, { type: "use-targets-message" }> =>
    item.type === "use-targets-message" && item.entityIndex === entity.index
  );
  if (!event) {
    requireEvent(findings, entity, events, "use-targets-message");
    return;
  }
  compare(findings, entity, "use-targets-message-text-mismatch", text.text, event.text);
  compare(findings, entity, "use-targets-message-source-call-mismatch", text.sourceCall, event.sourceCall);
  compare(findings, entity, "use-targets-message-source-function-mismatch", text.sourceFunction, event.sourceFunction);
}

function auditCounterUse(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  input: QuakeTriggerRuntimeAuditInput,
  entity: QuakeEntity,
  trigger: QuakeGameLogicResolvedTriggerFact,
): void {
  coverage.counterChecks += 1;
  const harness = createAuditHarness(input);
  const count = Math.max(1, Math.round(trigger.count ?? QUAKE_TRIGGER_COUNTER_DEFAULT_COUNT));
  for (let i = 0; i < count - 1; i++) {
    harness.activateEntity(entity.index);
    if (harness.events.some((event) => event.type === "counter-complete")) {
      findings.push(finding(
        "error",
        "trigger-counter-fired-early",
        entity,
        "trigger_counter completed before its prebaked count was reached.",
        count,
        i + 1,
      ));
      return;
    }
  }
  harness.activateEntity(entity.index);
  requireEvent(findings, entity, harness.events, "counter-complete");
  auditTargetActivationIndexes(findings, coverage, input, entity, trigger, harness);
  const completed = harness.events.filter((event) => event.type === "counter-complete").length;
  harness.activateEntity(entity.index);
  const completedAfterReuse = harness.events.filter((event) => event.type === "counter-complete").length;
  if (completedAfterReuse !== completed) {
    findings.push(finding(
      "error",
      "trigger-counter-reused",
      entity,
      "trigger_counter fired again after completing once.",
      completed,
      completedAfterReuse,
    ));
  }
}

function auditTeleporterTouch(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  input: QuakeTriggerRuntimeAuditInput,
  entity: QuakeEntity,
  trigger: QuakeGameLogicResolvedTriggerFact,
): void {
  coverage.teleporterChecks += 1;
  const harness = createAuditHarness(input);
  harness.touchEntity(entity);
  const firstTouchTeleports = harness.events.some((event) => event.type === "teleport");
  if (trigger.requiresUseBeforeTouch) {
    coverage.teleporterGateChecks += 1;
    if (firstTouchTeleports) {
      findings.push(finding(
        "error",
        "named-teleporter-touch-gate-mismatch",
        entity,
        "Named trigger_teleport activated before use enabled it.",
        false,
        true,
      ));
      return;
    }
    harness.activateEntity(entity.index);
    harness.touchEntity(entity);
    requireEvent(findings, entity, harness.events, "teleport");
  } else if (!firstTouchTeleports) {
    requireEvent(findings, entity, harness.events, "teleport");
  }
}

function auditOneShotDisabled(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  entity: QuakeEntity,
  disabledEntityIndexes: readonly number[],
): void {
  coverage.oneShotDisableChecks += 1;
  requireDisabled(findings, entity, disabledEntityIndexes);
}

function auditTargetActivationIndexes(
  findings: QuakeTriggerRuntimeAuditFinding[],
  coverage: QuakeTriggerRuntimeAuditCoverage,
  input: QuakeTriggerRuntimeAuditInput,
  entity: QuakeEntity,
  trigger: QuakeGameLogicResolvedTriggerFact,
  harness: QuakeTriggerRuntimeAuditHarness,
): void {
  if (!trigger.targetUse.target) return;
  const events = harness.events;
  const targetMonsterIndexes = monsterTargetIndexes(input, trigger.targetUse.targetEntityIndexes);
  const killtargetIndexes = new Set(trigger.targetUse.killtargetEntityIndexes ?? []);
  const selfFilteredMonsterIndexes = targetMonsterIndexes.filter((index) => index === entity.index);
  const killtargetFilteredMonsterIndexes = targetMonsterIndexes.filter((index) =>
    index !== entity.index && killtargetIndexes.has(index)
  );
  coverage.targetMonsterSelfFilteredChecks += selfFilteredMonsterIndexes.length;
  coverage.targetMonsterKilltargetFilteredChecks += killtargetFilteredMonsterIndexes.length;

  if (trigger.targetUse.delay > 0) {
    const delayedUseAccepted = events.some((event) =>
      event.type === "use-targets" &&
      event.entityIndex === entity.index &&
      event.result === true
    );
    if (!delayedUseAccepted) {
      findings.push(finding(
        "error",
        "delayed-target-use-not-accepted",
        entity,
        "Runtime did not accept a delayed target use.",
        true,
        false,
      ));
      return;
    }
    harness.flushTimers();
  }
  const expected = trigger.targetUse.targetEntityIndexes.filter((index) =>
    index !== entity.index && !killtargetIndexes.has(index)
  );
  if (trigger.targetUse.targetEntityIndexes.some((index) => killtargetIndexes.has(index))) {
    findings.push(finding(
      "info",
      "target-disabled-by-killtarget-before-fire",
      entity,
      "Runtime disables killtargets before firing targets; overlapping target indexes are not activated.",
      trigger.targetUse.targetEntityIndexes,
      expected,
    ));
  }
  const actual = targetActivationEvents(events)
    .filter((event) => event.sourceEntityIndex === entity.index)
    .map((event) => event.entityIndex);
  compare(findings, entity, "runtime-target-activation-index-mismatch", expected, actual);
  const expectedMonsterIndexes = monsterTargetIndexes(input, expected);
  if (!expectedMonsterIndexes.length) return;
  const actualMonsterIndexes = actual.filter((index) => expectedMonsterIndexes.includes(index));
  coverage.targetMonsterActivationChecks += actualMonsterIndexes.length;
  if (trigger.targetUse.delay > 0) {
    coverage.targetMonsterDelayedActivationChecks += actualMonsterIndexes.length;
  } else {
    coverage.targetMonsterImmediateActivationChecks += actualMonsterIndexes.length;
  }
  compare(findings, entity, "runtime-monster-target-activation-mismatch", expectedMonsterIndexes, actualMonsterIndexes);
}

function monsterTargetIndexes(input: QuakeTriggerRuntimeAuditInput, indexes: readonly number[]): number[] {
  const entityByIndex = new Map(input.entities.map((entity) => [entity.index, entity]));
  return indexes.filter((index) => entityByIndex.get(index)?.classname.startsWith("monster_"));
}

function createAuditHarness(input: QuakeTriggerRuntimeAuditInput): QuakeTriggerRuntimeAuditHarness {
  const entityByIndex = new Map(input.entities.map((entity) => [entity.index, entity]));
  const events: QuakeTriggerRuntimeAuditEvent[] = [];
  const disabled = new Set<number>();
  let touchedEntity: QuakeEntity | null = null;
  let triggerSystem: QuakeTriggersController;

  const disableEntity = (entityIndex: number): void => {
    disabled.add(entityIndex);
    targetSystem.disableEntity(entityIndex);
    events.push({ type: "disable", entityIndex });
  };

  const activateEntity = (entityIndex: number, sourceEntityIndex?: number): boolean => {
    if (targetSystem.isDisabled(entityIndex)) return false;
    const entity = entityByIndex.get(entityIndex);
    events.push({ type: "activate-entity", entityIndex, ...(entity ? { classname: entity.classname } : {}), ...(sourceEntityIndex !== undefined ? { sourceEntityIndex } : {}) });
    if (!entity) return false;
    if (activateSpecial(entity)) return true;
    if (entity.classname === "trigger_counter") {
      triggerSystem.activateCounterEntity(entity);
      return true;
    }
    if (entity.classname === "trigger_relay") return recordUseTargets(entity);
    if (entity.classname === "trigger_once" || entity.classname === "trigger_secret") {
      const activated = recordUseTargets(entity);
      if (quakeTriggerOneShot(entity, input.gameLogic, true)) disableEntity(entity.index);
      return activated;
    }
    if (entity.classname === "trigger_multiple") return recordUseTargets(entity);
    if (entity.classname === "trigger_teleport") return triggerSystem.activateTeleporterEntity(entity);
    return true;
  };

  const targetSystem = createQuakeTargetsController({
    activateEntity,
    onUseTargetsMessage: (entity, text) => {
      events.push({
        type: "use-targets-message",
        entityIndex: entity.index,
        text: text.text,
        sourceCall: text.sourceCall,
        sourceFunction: text.sourceFunction,
      });
    },
  });
  targetSystem.setup(input.runtime, input.gameLogic);

  const recordUseTargets = (entity: QuakeEntity): boolean => {
    const result = targetSystem.useTargets(entity);
    events.push({ type: "use-targets", entityIndex: entity.index, result });
    return result;
  };

  const activateSpecial = (entity: QuakeEntity): boolean => {
    if (entity.classname === "trigger_push") {
      const activation = quakeTriggerPushActivation(entity, input.gameLogic);
      if (!activation) return false;
      events.push({
        type: "push",
        entityIndex: entity.index,
        velocity: activation.velocity,
      });
      if (activation.oneShot) disableEntity(entity.index);
      return true;
    }
    if (entity.classname === "trigger_setskill") {
      const skillValue = quakeTriggerSetSkillValue(entity, input.gameLogic);
      events.push({
        type: "setskill",
        entityIndex: entity.index,
        skillValue: skillValue ?? 1,
      });
      return true;
    }
    if (entity.classname === "trigger_onlyregistered") {
      const activation = quakeTriggerOnlyRegisteredActivation(entity, {
        fallbackMessage: "REGISTERED VERSION ONLY",
        gameLogic: input.gameLogic,
        registered: input.sharewareRegistered ?? false,
      });
      if (!activation) return false;
      events.push({
        type: "registered-only",
        entityIndex: entity.index,
        allowed: activation.allowed,
        ...(activation.message ? { message: activation.message } : {}),
      });
      if (activation.allowed) recordUseTargets(entity);
      return true;
    }
    return false;
  };

  triggerSystem = createQuakeTriggersController({
    activateCounter: (entity) => {
      const result = targetSystem.activateCounter(entity);
      if (result?.completed) events.push({ type: "counter-complete", entityIndex: entity.index });
      return result;
    },
    activateEntity,
    activateTeleport: (entity) => {
      events.push({ type: "teleport", entityIndex: entity.index, ...(entity.properties.target ? { target: entity.properties.target } : {}) });
      return true;
    },
    completeLevel: (entity) => {
      const map = quakeTriggerChangelevelMap(entity, input.gameLogic);
      events.push({ type: "complete-level", entityIndex: entity.index, ...(map ? { map } : {}) });
    },
    disableEntity,
    getEntity: (entityIndex) => entityByIndex.get(entityIndex),
    getOrigin: () => [0, 0, 0],
    getTouchedTriggers: () => touchedEntity ? [touchedTriggerForEntity(touchedEntity)] : [],
    isEntityDisabled: targetSystem.isDisabled,
    isOneShotTrigger: (entity, fallback) => quakeTriggerOneShot(entity, input.gameLogic, fallback),
    onActiveKeyChange: () => undefined,
    triggerSpecial: activateSpecial,
    triggerWait: (entity, fallback) => quakeTriggerWait(entity, input.gameLogic, fallback),
    transitionSerial: () => 0,
    useTargets: recordUseTargets,
  });

  return {
    events,
    targetSystem,
    triggerSystem,
    activateEntity,
    flushTimers() {
      (window as QuakeTriggerAuditWindow).__quakeTriggerAuditFlushTimers?.();
    },
    touchEntity(entity) {
      touchedEntity = entity;
      triggerSystem.sync([0, 0, 0]);
    },
    disabledEntityIndexes() {
      return [...disabled].sort((a, b) => a - b);
    },
  };
}

function runtimeBranchForTrigger(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
): QuakeTriggerRuntimeBranch {
  const classname = entity.classname as QuakeGameLogicResolvedTriggerKind;
  const spawnflags = quakeEntitySpawnflags(entity);
  const damageable = isDamageableRuntimeTrigger(entity);
  const fallbackWait = classname === "trigger_multiple"
    ? QUAKE_TRIGGER_MULTIPLE_DEFAULT_WAIT
    : (classname === "trigger_once" || classname === "trigger_secret" || classname === "trigger_counter" ? -1 : undefined);
  const wait = fallbackWait !== undefined ? quakeTriggerWait(entity, gameLogic, fallbackWait) : undefined;
  return {
    damageable,
    oneShot: quakeTriggerOneShot(entity, gameLogic, runtimeTriggerOneShot(classname, spawnflags, wait)),
    touchActivates: runtimeTriggerTouchActivates(classname, damageable, Boolean(spawnflags & QUAKE_TRIGGER_NOTOUCH)),
    useActivates: runtimeTriggerUseActivates(classname),
    ...(wait !== undefined ? { wait } : {}),
    ...(classname === "trigger_counter"
      ? { count: Math.max(1, Math.round(quakeEntityNumber(entity, "count", QUAKE_TRIGGER_COUNTER_DEFAULT_COUNT))) }
      : {}),
    ...(classname === "trigger_hurt"
      ? { dmg: quakeTriggerHurtDamageAmount(entity, gameLogic) ?? 0 }
      : {}),
    ...runtimeTriggerPushBranch(entity, gameLogic),
    ...(classname === "trigger_monsterjump"
      ? {
          speed: Math.max(1, quakeEntityNumber(entity, "speed", QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_SPEED)),
          height: Math.max(0, quakeEntityNumber(entity, "height", QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_HEIGHT)),
          moveDirection: quakeEntityDirection(entity),
        }
      : {}),
    ...(classname === "trigger_setskill"
      ? { skillValue: quakeTriggerSetSkillValue(entity, gameLogic) ?? 1 }
      : {}),
    ...(classname === "trigger_teleport" && entity.properties.targetname
      ? { requiresUseBeforeTouch: true }
      : {}),
  };
}

function runtimeTriggerTouchActivates(
  classname: QuakeGameLogicResolvedTriggerKind,
  damageable: boolean,
  notouch: boolean,
): boolean {
  if (classname === "trigger_multiple" || classname === "trigger_once" || classname === "trigger_secret") {
    return !damageable && !notouch;
  }
  return classname === "trigger_hurt" ||
    classname === "trigger_teleport" ||
    classname === "trigger_changelevel" ||
    classname === "trigger_push" ||
    classname === "trigger_setskill" ||
    classname === "trigger_onlyregistered" ||
    classname === "trigger_monsterjump";
}

function runtimeTriggerUseActivates(classname: QuakeGameLogicResolvedTriggerKind): boolean {
  return classname === "trigger_multiple" ||
    classname === "trigger_once" ||
    classname === "trigger_secret" ||
    classname === "trigger_counter" ||
    classname === "trigger_relay" ||
    classname === "trigger_teleport";
}

function runtimeTriggerOneShot(
  classname: QuakeGameLogicResolvedTriggerKind,
  spawnflags: number,
  wait: number | undefined,
): boolean {
  if (classname === "trigger_once" || classname === "trigger_secret" || classname === "trigger_changelevel" || classname === "trigger_counter") {
    return true;
  }
  if (classname === "trigger_push" && (spawnflags & QUAKE_TRIGGER_PUSH_ONCE) !== 0) return true;
  return wait === -1;
}

function runtimeTriggerPushBranch(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
): Pick<QuakeTriggerRuntimeBranch, "speed" | "moveDirection" | "pushVelocityMultiplier"> {
  if (entity.classname !== "trigger_push") return {};
  const activation = quakeTriggerPushActivation(entity, gameLogic);
  if (!activation) return {};
  return {
    speed: activation.speed,
    moveDirection: {
      x: activation.direction[0],
      y: activation.direction[1],
      z: activation.direction[2],
    },
    pushVelocityMultiplier: activation.multiplier,
  };
}

function isDamageableRuntimeTrigger(entity: QuakeEntity): boolean {
  if (quakeEntityNumber(entity, "health", 0) <= 0) return false;
  return entity.classname === "trigger_once" ||
    entity.classname === "trigger_multiple" ||
    entity.classname === "trigger_secret";
}

function touchedTriggerForEntity(entity: QuakeEntity): QuakeTouchedTrigger {
  return {
    entityIndex: entity.index,
    modelIndex: entity.modelIndex ?? -1,
    classname: entity.classname,
    contact: "trigger",
    ...(entity.properties.target ? { target: entity.properties.target } : {}),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
  };
}

function quakeAuditMessage(message: string | undefined, fallback: string): string {
  return (message || fallback).replace(/\\n/g, "\n");
}

function quakeEntityDirection(entity: QuakeEntity): QuakeVertex {
  const angle = quakeEntityNumber(entity, "angle", entity.angle ?? 0);
  if (angle === -1) return { x: 0, y: 0, z: 1 };
  if (angle === -2) return { x: 0, y: 0, z: -1 };
  const radians = (angle * Math.PI) / 180;
  const [x, y, z] = normalizeVec3([Math.cos(radians), Math.sin(radians), 0]);
  return { x, y, z };
}

function targetActivationEvents(events: readonly QuakeTriggerRuntimeAuditEvent[]): Extract<QuakeTriggerRuntimeAuditEvent, { type: "activate-entity" }>[] {
  return events.filter((event): event is Extract<QuakeTriggerRuntimeAuditEvent, { type: "activate-entity" }> =>
    event.type === "activate-entity"
  );
}

function requireEvent(
  findings: QuakeTriggerRuntimeAuditFinding[],
  entity: QuakeEntity,
  events: readonly QuakeTriggerRuntimeAuditEvent[],
  type: QuakeTriggerRuntimeAuditEvent["type"],
): void {
  if (events.some((event) => event.type === type)) return;
  findings.push(finding(
    "error",
    "missing-runtime-event",
    entity,
    `Expected runtime trigger simulation to emit ${type}.`,
    type,
    events.map((event) => event.type),
  ));
}

function requireDisabled(
  findings: QuakeTriggerRuntimeAuditFinding[],
  entity: QuakeEntity,
  disabledEntityIndexes: readonly number[],
): void {
  if (disabledEntityIndexes.includes(entity.index)) return;
  findings.push(finding(
    "error",
    "missing-runtime-disable",
    entity,
    "Expected runtime trigger simulation to disable a one-shot trigger.",
    entity.index,
    disabledEntityIndexes,
  ));
}

function compareOptionalNumber(
  findings: QuakeTriggerRuntimeAuditFinding[],
  entity: QuakeEntity | QuakeGameLogicEntityFact,
  code: string,
  expected: number | undefined,
  actual: number | undefined,
): void {
  if (expected === undefined && actual === undefined) return;
  compare(findings, entity, code, expected, actual);
}

function compare(
  findings: QuakeTriggerRuntimeAuditFinding[],
  entity: QuakeEntity | QuakeGameLogicEntityFact,
  code: string,
  expected: unknown,
  actual: unknown,
): void {
  if (sameValue(expected, actual)) return;
  findings.push(finding("error", code, entity, "Prebaked trigger facts differ from current runtime trigger behavior.", expected, actual));
}

function finding(
  severity: QuakeTriggerRuntimeAuditSeverity,
  code: string,
  entity: QuakeEntity | QuakeGameLogicEntityFact,
  message: string,
  expected?: unknown,
  actual?: unknown,
): QuakeTriggerRuntimeAuditFinding {
  const entityIndex = "entityIndex" in entity ? entity.entityIndex : entity.index;
  return {
    severity,
    code,
    message,
    entityIndex,
    classname: entity.classname,
    ...(expected !== undefined ? { expected } : {}),
    ...(actual !== undefined ? { actual } : {}),
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 0.000001;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
