import type { QuakeEntity } from "../types/quake";

export type QuakeSolidGateKind = "boss" | "episode";

export interface QuakeSolidGateActivation {
  kind: QuakeSolidGateKind;
  message: string;
}

export function quakeSolidGateActivation(entity: QuakeEntity): QuakeSolidGateActivation | null {
  if (entity.classname === "func_episodegate") {
    return {
      kind: "episode",
      message: quakeSolidGateMessage(entity, "THIS EPISODE IS LOCKED"),
    };
  }
  if (entity.classname === "func_bossgate") {
    return {
      kind: "boss",
      message: quakeSolidGateMessage(entity, "YOU MUST COMPLETE THE EPISODES FIRST"),
    };
  }
  return null;
}

function quakeSolidGateMessage(entity: QuakeEntity, fallback: string): string {
  const message = entity.properties.message;
  return String(message || fallback).replace(/\\n/g, "\n");
}
