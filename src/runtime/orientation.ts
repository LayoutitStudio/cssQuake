export type QuakeLandscapeRequestReason =
  | "already-landscape"
  | "locked"
  | "lock-failed"
  | "not-mobile"
  | "orientation-unsupported";

export interface QuakeLandscapeRequestResult {
  fullscreenRequested: boolean;
  reason: QuakeLandscapeRequestReason;
}

interface QuakeLandscapeRequestTarget {
  ownerDocument?: Document | null;
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
}

interface QuakeLandscapeRequestEnvironment {
  matchMedia?: Window["matchMedia"];
  screen?: Screen;
}

const QUAKE_LANDSCAPE_LOCK_MOBILE_QUERY = "(any-pointer: coarse), (max-width: 960px)";

export async function requestQuakeLandscapeOnMobile(
  target: QuakeLandscapeRequestTarget,
  environment: QuakeLandscapeRequestEnvironment = window,
): Promise<QuakeLandscapeRequestResult> {
  if (!environment.matchMedia?.(QUAKE_LANDSCAPE_LOCK_MOBILE_QUERY).matches) {
    return { fullscreenRequested: false, reason: "not-mobile" };
  }
  const orientation = environment.screen?.orientation;
  if (!orientation || typeof orientation.lock !== "function") {
    return { fullscreenRequested: false, reason: "orientation-unsupported" };
  }
  if (orientation.type?.startsWith("landscape")) {
    return { fullscreenRequested: false, reason: "already-landscape" };
  }

  let fullscreenRequested = false;
  const document = target.ownerDocument;
  if (document?.fullscreenEnabled && !document.fullscreenElement && typeof target.requestFullscreen === "function") {
    try {
      fullscreenRequested = true;
      await target.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // Orientation lock may still work in installed/PWA contexts. Try it before giving up.
    }
  }

  try {
    await orientation.lock("landscape");
    return { fullscreenRequested, reason: "locked" };
  } catch {
    return { fullscreenRequested, reason: "lock-failed" };
  }
}
