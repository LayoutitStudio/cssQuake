import type {
  QuakeGameLogicFacts,
  QuakeGameLogicGeneratedTextFact,
  QuakeGameLogicTextFact,
} from "../../prepare/gameLogicFacts";
import { quakeGameLogicEntityFact } from "../../prepare/gameLogicFacts";
import type { QuakeEntity } from "../../types/quake";
import type { QuakeCounterActivationResult } from "../targets";
import type { QuakeTextController } from "../text";

const QUAKE_NOTIFY_TEXT_MS = 3000;
const QUAKE_CENTERPRINT_MS = 2600;

export interface QuakeTextPresentationFlowOptions {
  currentGameLogic(): QuakeGameLogicFacts | null | undefined;
  hudAvailable(): boolean;
  isPlayerDead(): boolean;
  text: QuakeTextController;
}

export interface QuakeTextPresentationFlow {
  centerPrint(message: string, duration?: number): void;
  clear(): void;
  clearCenterPrint(): void;
  generatedCenterPrintTextForEntityIndexes(
    entityIndexes: readonly number[],
    reason: QuakeGameLogicGeneratedTextFact["reason"],
    matches: (fact: QuakeGameLogicGeneratedTextFact) => boolean,
  ): string | null;
  hasUseTargetsMessageText(entity: QuakeEntity): boolean;
  notify(message: string, duration?: number): void;
  setCenterPrint(text: string): void;
  showCounterGeneratedText(entity: QuakeEntity, result: QuakeCounterActivationResult): void;
  showDirectCenterPrintMessageText(entity: QuakeEntity): boolean;
  showUseTargetsMessageText(entity: QuakeEntity, text: QuakeGameLogicTextFact): void;
}

export function createQuakeTextPresentationFlow(
  options: QuakeTextPresentationFlowOptions,
): QuakeTextPresentationFlow {
  function notify(message: string, duration = QUAKE_NOTIFY_TEXT_MS): void {
    const text = message.trim();
    if (!text || !options.hudAvailable() || options.isPlayerDead()) return;
    options.text.notify(text, { durationMs: duration });
  }

  function centerPrint(message: string, duration = QUAKE_CENTERPRINT_MS): void {
    const text = message.trim();
    if (!text || !options.hudAvailable() || options.isPlayerDead()) return;
    options.text.centerPrint(text, { durationMs: duration });
  }

  function setCenterPrint(text: string): void {
    if (!text.trim() || !options.hudAvailable()) return;
    options.text.setCenterPrint(text);
  }

  function showUseTargetsMessageText(_entity: QuakeEntity, text: QuakeGameLogicTextFact): void {
    if (text.lane !== "centerprint" || text.sourceCall !== "SUB_UseTargets") return;
    centerPrint(text.text);
  }

  function showDirectCenterPrintMessageText(entity: QuakeEntity): boolean {
    const text = quakeGameLogicEntityFact(options.currentGameLogic(), entity.index)?.resolvedTrigger?.messageText;
    if (text?.lane !== "centerprint" || text.sourceCall !== "centerprint") return false;
    centerPrint(text.text);
    return true;
  }

  function showCounterGeneratedText(entity: QuakeEntity, result: QuakeCounterActivationResult): void {
    const reason = result.completed ? "counter-complete" : "counter-remaining";
    const text = generatedCenterPrintTextForEntityIndexes(
      [entity.index],
      reason,
      (fact) => counterGeneratedTextMatches(fact, result),
    );
    if (text) centerPrint(text);
  }

  function generatedCenterPrintTextForEntityIndexes(
    entityIndexes: readonly number[],
    reason: QuakeGameLogicGeneratedTextFact["reason"],
    matches: (fact: QuakeGameLogicGeneratedTextFact) => boolean,
  ): string | null {
    const gameLogic = options.currentGameLogic();
    if (!gameLogic) return null;
    const seen = new Set<number>();
    for (const entityIndex of entityIndexes) {
      if (seen.has(entityIndex)) continue;
      seen.add(entityIndex);
      const entityFact = quakeGameLogicEntityFact(gameLogic, entityIndex);
      const moverText = generatedCenterPrintText(entityFact?.resolvedMover?.generatedText, reason, matches);
      if (moverText) return moverText;
      const triggerText = generatedCenterPrintText(entityFact?.resolvedTrigger?.generatedText, reason, matches);
      if (triggerText) return triggerText;
    }
    return null;
  }

  function hasUseTargetsMessageText(entity: QuakeEntity): boolean {
    const text = quakeGameLogicEntityFact(options.currentGameLogic(), entity.index)?.resolvedTrigger?.messageText;
    return text?.lane === "centerprint" && text.sourceCall === "SUB_UseTargets" && text.text.trim().length > 0;
  }

  return {
    centerPrint,
    clear: () => options.text.clear(),
    clearCenterPrint: () => options.text.clearCenterPrint(),
    generatedCenterPrintTextForEntityIndexes,
    hasUseTargetsMessageText,
    notify,
    setCenterPrint,
    showCounterGeneratedText,
    showDirectCenterPrintMessageText,
    showUseTargetsMessageText,
  };
}

function counterGeneratedTextMatches(
  fact: QuakeGameLogicGeneratedTextFact,
  result: QuakeCounterActivationResult,
): boolean {
  const condition = fact.condition;
  if (condition?.remaining !== undefined) return condition.remaining === result.remaining;
  if (condition?.minRemaining !== undefined) return result.remaining >= condition.minRemaining;
  return true;
}

function generatedCenterPrintText(
  facts: readonly QuakeGameLogicGeneratedTextFact[] | undefined,
  reason: QuakeGameLogicGeneratedTextFact["reason"],
  matches: (fact: QuakeGameLogicGeneratedTextFact) => boolean,
): string | null {
  for (const fact of facts ?? []) {
    if (fact.lane === "centerprint" && fact.reason === reason && matches(fact)) return fact.text;
  }
  return null;
}
