import type {
  QuakeMultiplayerRemoteInterpolationSample,
  QuakeMultiplayerRemoteInterpolationState,
  QuakeMultiplayerVec3,
} from "./protocol";

export function interpolateQuakeMultiplayerRemoteState(
  playerId: string,
  samples: readonly QuakeMultiplayerRemoteInterpolationSample[],
  renderAt: number,
  staleAfterMs = 1_000,
): QuakeMultiplayerRemoteInterpolationState | null {
  if (!samples.length) return null;
  const ordered = [...samples].sort((a, b) => a.sampledAt - b.sampledAt);
  const latest = ordered[ordered.length - 1];
  let previous = ordered[0];
  let next = latest;
  for (let i = 0; i < ordered.length; i++) {
    const sample = ordered[i];
    if (!sample) continue;
    if (sample.sampledAt <= renderAt) previous = sample;
    if (sample.sampledAt >= renderAt) {
      next = sample;
      break;
    }
  }
  const span = next.sampledAt - previous.sampledAt;
  const t = span > 0 ? clamp01((renderAt - previous.sampledAt) / span) : 0;
  return {
    playerId,
    renderAt,
    renderOrigin: lerpVec3(previous.origin, next.origin, t),
    renderVelocity: lerpVec3(previous.velocity, next.velocity, t),
    renderRotX: lerp(previous.rotX, next.rotX, t),
    renderRotY: lerp(previous.rotY, next.rotY, t),
    alive: next.alive,
    previous,
    next,
    stale: renderAt - latest.sampledAt > staleAfterMs,
  };
}

function lerpVec3(a: QuakeMultiplayerVec3, b: QuakeMultiplayerVec3, t: number): QuakeMultiplayerVec3 {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
