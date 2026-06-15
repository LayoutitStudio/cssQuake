import type {
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerVec3,
} from "./protocol";

export type QuakeMultiplayerLocalCorrectionDecision =
  | {
      action: "none";
      reason: "not-alive" | "no-authoritative-input" | "already-handled" | "within-threshold";
      drift: number;
      inputSequence: number;
    }
  | {
      action: "snap";
      reason: "drift";
      drift: number;
      inputSequence: number;
      origin: QuakeMultiplayerVec3;
    }
  | {
      action: "blend";
      reason: "drift";
      drift: number;
      inputSequence: number;
      origin: QuakeMultiplayerVec3;
      authoritativeOrigin: QuakeMultiplayerVec3;
    };

export interface QuakeMultiplayerLocalCorrectionOptions {
  hardSnapDistance: number;
  softCorrectionDistance?: number;
  blendFraction?: number;
  maxBlendDistance?: number;
}

export function decideQuakeMultiplayerLocalCorrection(
  localOrigin: QuakeMultiplayerVec3,
  authoritative: QuakeMultiplayerAuthoritativePlayerState,
  lastHandledInputSequence: number,
  options: QuakeMultiplayerLocalCorrectionOptions,
): QuakeMultiplayerLocalCorrectionDecision {
  const inputSequence = authoritative.lastInputSequence;
  const drift = distance3(localOrigin, authoritative.origin);
  if (!authoritative.alive) {
    return { action: "none", reason: "not-alive", drift, inputSequence };
  }
  if (inputSequence <= 0) {
    return { action: "none", reason: "no-authoritative-input", drift, inputSequence };
  }
  if (inputSequence <= lastHandledInputSequence) {
    return { action: "none", reason: "already-handled", drift, inputSequence };
  }
  const hardSnapDistance = Math.max(0, options.hardSnapDistance);
  const requestedSoftCorrectionDistance = Math.max(0, options.softCorrectionDistance ?? hardSnapDistance);
  const softCorrectionDistance = Math.min(requestedSoftCorrectionDistance, hardSnapDistance);
  if (drift < softCorrectionDistance) {
    return { action: "none", reason: "within-threshold", drift, inputSequence };
  }
  if (drift < hardSnapDistance) {
    return {
      action: "blend",
      reason: "drift",
      drift,
      inputSequence,
      origin: blendedCorrectionOrigin(localOrigin, authoritative.origin, drift, options),
      authoritativeOrigin: authoritative.origin,
    };
  }
  return {
    action: "snap",
    reason: "drift",
    drift,
    inputSequence,
    origin: authoritative.origin,
  };
}

function blendedCorrectionOrigin(
  localOrigin: QuakeMultiplayerVec3,
  authoritativeOrigin: QuakeMultiplayerVec3,
  drift: number,
  options: QuakeMultiplayerLocalCorrectionOptions,
): QuakeMultiplayerVec3 {
  if (drift <= 0) return localOrigin;
  const fraction = clampNumber(options.blendFraction ?? 0.35, 0, 1);
  const maxBlendDistance = Math.max(0, options.maxBlendDistance ?? drift);
  const distance = Math.min(drift * fraction, maxBlendDistance);
  const scale = distance / drift;
  return [
    localOrigin[0] + (authoritativeOrigin[0] - localOrigin[0]) * scale,
    localOrigin[1] + (authoritativeOrigin[1] - localOrigin[1]) * scale,
    localOrigin[2] + (authoritativeOrigin[2] - localOrigin[2]) * scale,
  ];
}

function distance3(a: QuakeMultiplayerVec3, b: QuakeMultiplayerVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
