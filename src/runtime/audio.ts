import type { QuakeGameLogicFacts } from "../prepare/gameLogicFacts";
import { quakeGameLogicResolvedPickupFact } from "../prepare/gameLogicFacts";
import type { QuakeEntity } from "../types/quake";

export interface QuakeSoundManifest {
  version: number;
  sounds: Record<string, string>;
}

export type QuakeSoundEvent =
  | "armorPickup"
  | "button"
  | "doorMove"
  | "doorStop"
  | "genericPickup"
  | "healthPickup"
  | "keyPickup"
  | "levelExit"
  | "pain"
  | "platMove"
  | "powerupPickup"
  | "teleport"
  | "weaponAxe"
  | "weaponGrenadeLauncher"
  | "weaponLightning"
  | "weaponNailgun"
  | "weaponPickup"
  | "weaponRocketLauncher"
  | "weaponShotgun"
  | "weaponSuperNailgun"
  | "weaponSuperShotgun";

export interface QuakeSoundPlayOptions {
  volume?: number;
}

export interface QuakeSoundController {
  dispose(): void;
  isMuted(): boolean;
  setManifest(manifest: QuakeSoundManifest | null): void;
  setMuted(muted: boolean): void;
  setPaused(paused: boolean): void;
  syncAmbientEntities(entities: QuakeEntity[]): void;
  toggleMuted(): boolean;
  unlock(): void;
  playEvent(event: QuakeSoundEvent, options?: QuakeSoundPlayOptions): boolean;
  playPickup(entity: QuakeEntity, gameLogic?: QuakeGameLogicFacts | null): boolean;
  playSound(soundPath: string, options?: QuakeSoundPlayOptions): boolean;
}

interface QuakeAmbientLoop {
  candidates: string[];
  volume: number;
}

const QUAKE_SOUND_EVENT_CANDIDATES: Record<QuakeSoundEvent, string[]> = {
  armorPickup: ["items/armor1.wav", "items/r_item1.wav", "items/itembk2.wav"],
  button: ["buttons/switch02.wav", "buttons/button3.wav", "buttons/airbut1.wav"],
  doorMove: ["doors/doormv1.wav", "doors/doormv2.wav", "doors/drclos4.wav"],
  doorStop: ["doors/drclos4.wav", "doors/hydro2.wav", "doors/doormv1.wav"],
  genericPickup: ["items/itembk2.wav", "items/r_item1.wav", "items/pkup.wav"],
  healthPickup: ["items/health1.wav", "items/r_item1.wav", "items/itembk2.wav"],
  keyPickup: ["items/r_item2.wav", "misc/medkey.wav", "misc/runekey.wav", "items/itembk2.wav"],
  levelExit: ["misc/trigger1.wav", "misc/secret.wav"],
  pain: ["player/pain1.wav", "player/pain2.wav", "player/pain3.wav", "player/pain4.wav"],
  platMove: ["plats/plat1.wav", "plats/plat2.wav", "doors/doormv1.wav"],
  powerupPickup: ["items/damage.wav", "items/protect.wav", "items/suit.wav", "items/itembk2.wav"],
  teleport: ["misc/r_tele1.wav", "misc/r_tele2.wav", "misc/teleport.wav"],
  weaponAxe: ["weapons/ax1.wav", "player/axhit2.wav"],
  weaponGrenadeLauncher: ["weapons/grenade.wav", "weapons/sgun1.wav"],
  weaponLightning: ["weapons/lhit.wav", "weapons/sgun1.wav"],
  weaponNailgun: ["weapons/rocket1i.wav", "weapons/tink1.wav"],
  weaponPickup: ["weapons/pkup.wav", "items/itembk2.wav", "items/r_item1.wav"],
  weaponRocketLauncher: ["weapons/sgun1.wav", "weapons/r_exp3.wav"],
  weaponShotgun: ["weapons/guncock.wav", "weapons/sgun1.wav"],
  weaponSuperNailgun: ["weapons/spike2.wav", "weapons/rocket1i.wav"],
  weaponSuperShotgun: ["weapons/shotgn2.wav", "weapons/guncock.wav", "weapons/sgun1.wav"],
};

const QUAKE_AMBIENT_SOUND_CANDIDATES: Record<string, string[]> = {
  ambient_comp_hum: ["ambience/comp1.wav", "ambience/comp_hum.wav"],
  ambient_drip: ["ambience/drip1.wav", "ambience/drip2.wav"],
  ambient_drone: ["ambience/drone6.wav", "ambience/drone1.wav"],
  ambient_suck_wind: ["ambience/wind2.wav", "ambience/wind1.wav"],
  ambient_swamp1: ["ambience/swamp1.wav"],
  ambient_swamp2: ["ambience/swamp2.wav"],
};

const QUAKE_MASTER_SOUND_VOLUME = 0.38;
const QUAKE_DEFAULT_SOUND_VOLUME = 0.38;
const QUAKE_AMBIENT_SOUND_VOLUME = 0.07;

export function createQuakeSoundController(): QuakeSoundController {
  let unlocked = false;
  let muted = true;
  let paused = false;
  let sounds = new Map<string, string>();
  const desiredAmbientLoops = new Map<string, QuakeAmbientLoop>();
  const ambientAudio = new Map<string, HTMLAudioElement>();

  function setManifest(manifest: QuakeSoundManifest | null): void {
    sounds = normalizeSoundManifest(manifest);
    syncAmbientPlayback();
  }

  function isMuted(): boolean {
    return muted;
  }

  function setMuted(nextMuted: boolean): void {
    if (muted === nextMuted) return;
    muted = nextMuted;
    syncAmbientPlayback();
  }

  function setPaused(nextPaused: boolean): void {
    if (paused === nextPaused) return;
    paused = nextPaused;
    syncAmbientPlayback();
  }

  function toggleMuted(): boolean {
    setMuted(!muted);
    return muted;
  }

  function unlock(): void {
    if (unlocked) return;
    unlocked = true;
    syncAmbientPlayback();
  }

  function playEvent(event: QuakeSoundEvent, options: QuakeSoundPlayOptions = {}): boolean {
    return playFirst(QUAKE_SOUND_EVENT_CANDIDATES[event], options);
  }

  function playPickup(entity: QuakeEntity, gameLogic: QuakeGameLogicFacts | null = null): boolean {
    return playFirst(quakePickupSoundCandidates(entity, gameLogic), {});
  }

  function playSound(soundPath: string, options: QuakeSoundPlayOptions = {}): boolean {
    return playFirst([soundPath], options);
  }

  function syncAmbientEntities(entities: QuakeEntity[]): void {
    desiredAmbientLoops.clear();
    for (const entity of entities) {
      const candidates = QUAKE_AMBIENT_SOUND_CANDIDATES[entity.classname];
      if (!candidates || desiredAmbientLoops.has(entity.classname)) continue;
      desiredAmbientLoops.set(entity.classname, {
        candidates,
        volume: QUAKE_AMBIENT_SOUND_VOLUME,
      });
    }
    syncAmbientPlayback();
  }

  function dispose(): void {
    desiredAmbientLoops.clear();
    stopAmbientPlayback();
    sounds = new Map();
  }

  function playFirst(candidates: string[], options: QuakeSoundPlayOptions): boolean {
    if (!unlocked || muted || paused) return false;
    const url = soundUrlFor(candidates);
    if (!url) return false;
    const audio = new Audio(url);
    audio.volume = outputVolume(options.volume ?? QUAKE_DEFAULT_SOUND_VOLUME);
    void audio.play().catch(() => undefined);
    return true;
  }

  function syncAmbientPlayback(): void {
    if (!unlocked || muted || paused || sounds.size === 0) {
      stopAmbientPlayback();
      return;
    }

    for (const key of ambientAudio.keys()) {
      if (!desiredAmbientLoops.has(key)) stopAmbientLoop(key);
    }

    for (const [key, loop] of desiredAmbientLoops) {
      if (ambientAudio.has(key)) continue;
      const url = soundUrlFor(loop.candidates);
      if (!url) continue;
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = outputVolume(loop.volume);
      ambientAudio.set(key, audio);
      void audio.play().catch(() => undefined);
    }
  }

  function stopAmbientPlayback(): void {
    for (const key of [...ambientAudio.keys()]) stopAmbientLoop(key);
  }

  function stopAmbientLoop(key: string): void {
    const audio = ambientAudio.get(key);
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    ambientAudio.delete(key);
  }

  function soundUrlFor(candidates: string[]): string | null {
    for (const candidate of candidates) {
      const url = sounds.get(soundKey(candidate));
      if (url) return url;
    }
    return null;
  }

  return {
    dispose,
    isMuted,
    setManifest,
    setMuted,
    setPaused,
    syncAmbientEntities,
    toggleMuted,
    unlock,
    playEvent,
    playPickup,
    playSound,
  };
}

function normalizeSoundManifest(manifest: QuakeSoundManifest | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!manifest || !isRecord(manifest.sounds)) return out;
  for (const [key, url] of Object.entries(manifest.sounds)) {
    if (typeof url !== "string" || !url) continue;
    out.set(soundKey(key), url);
  }
  return out;
}

export function quakePickupSoundPath(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): string {
  return quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.feedback?.sound ??
    QUAKE_SOUND_EVENT_CANDIDATES[pickupSoundEvent(entity)][0];
}

function quakePickupSoundCandidates(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null,
): string[] {
  const eventCandidates = QUAKE_SOUND_EVENT_CANDIDATES[pickupSoundEvent(entity)];
  const factSound = quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.feedback?.sound;
  if (!factSound) return eventCandidates;
  return [factSound, ...eventCandidates.filter((candidate) => soundKey(candidate) !== soundKey(factSound))];
}

function pickupSoundEvent(entity: QuakeEntity): QuakeSoundEvent {
  const classname = entity.classname;
  if (classname === "item_health") return "healthPickup";
  if (classname.startsWith("item_armor")) return "armorPickup";
  if (classname.startsWith("key_") || classname === "item_key1" || classname === "item_key2") return "keyPickup";
  if (classname.startsWith("weapon_")) return "weaponPickup";
  if (classname.startsWith("item_artifact_")) return "powerupPickup";
  return "genericPickup";
}

function soundKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^sound\//, "");
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : QUAKE_DEFAULT_SOUND_VOLUME));
}

function outputVolume(value: number): number {
  return clampVolume(value) * QUAKE_MASTER_SOUND_VOLUME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
