import type { QuakeSoundController, QuakeSoundManifest } from "../audio";
import type { QuakeAssetManifest } from "./session";

export interface QuakeSoundManifestFlowOptions {
  assetManifest(): QuakeAssetManifest;
  audio: QuakeSoundController;
  isDisposed(): boolean;
}

export interface QuakeSoundManifestFlow {
  ensureLoaded(): Promise<void>;
}

export function createQuakeSoundManifestFlow(
  options: QuakeSoundManifestFlowOptions,
): QuakeSoundManifestFlow {
  let soundManifestPromise: Promise<void> | null = null;

  function ensureLoaded(): Promise<void> {
    soundManifestPromise ??= loadSoundManifest();
    return soundManifestPromise;
  }

  async function loadSoundManifest(): Promise<void> {
    const url = options.assetManifest().assets.soundManifestUrl;
    if (!url) {
      options.audio.setManifest(null);
      return;
    }
    try {
      const response = await fetch(url);
      if (response.status === 404) {
        options.audio.setManifest(null);
        return;
      }
      if (!response.ok) throw new Error(`Could not load ${url}.`);
      const manifest = normalizeQuakeSoundManifest(await response.json());
      if (options.isDisposed()) return;
      options.audio.setManifest(manifest);
    } catch (error) {
      console.warn(error);
      options.audio.setManifest(null);
    }
  }

  return {
    ensureLoaded,
  };
}

function normalizeQuakeSoundManifest(value: unknown): QuakeSoundManifest {
  const sounds: Record<string, string> = {};
  if (isRecord(value) && isRecord(value.sounds)) {
    for (const [key, url] of Object.entries(value.sounds)) {
      if (typeof url === "string") sounds[key] = url;
    }
  }
  return {
    version: isRecord(value) && typeof value.version === "number" ? value.version : 1,
    sounds,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
