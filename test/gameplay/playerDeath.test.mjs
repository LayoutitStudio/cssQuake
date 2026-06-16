import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const player = await importTsModule("src/runtime/player.ts");
const constants = await importTsModule("src/runtime/constants.ts");
const lifecycle = await importTsModule("src/runtime/app/playerLifecycleFlow.ts");

test("player death sound selection follows QuakeC rint(random()*4+1)", () => {
  assert.equal(player.quakePlayerDeathSoundIndexFromRandom(0), 1);
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0), "player/death1.wav");
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0.1249), "player/death1.wav");
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0.125), "player/death2.wav");
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0.3749), "player/death2.wav");
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0.375), "player/death3.wav");
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0.6249), "player/death3.wav");
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0.625), "player/death4.wav");
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0.8749), "player/death4.wav");
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0.875), "player/death5.wav");
  assert.equal(player.quakePlayerDeathSoundPathFromRandom(0.999), "player/death5.wav");
});

test("player gib death sound selection follows QuakeC random split", () => {
  assert.equal(player.quakePlayerGibSoundPathFromRandom(0), "player/gib.wav");
  assert.equal(player.quakePlayerGibSoundPathFromRandom(0.4999), "player/gib.wav");
  assert.equal(player.quakePlayerGibSoundPathFromRandom(0.5), "player/udeath.wav");
  assert.equal(player.quakePlayerGibSoundPathFromRandom(0.999), "player/udeath.wav");
});

test("player death toss consumes random only below QuakeC velocity_z threshold", () => {
  const scale = constants.QUAKE_COLLISION_UNIT_SCALE;
  assert.equal(player.quakePlayerDeathNeedsTossRandom([0, 0, 9 * scale]), true);
  assert.equal(player.quakePlayerDeathNeedsTossRandom([0, 0, 10 * scale]), false);

  assert.deepEqual(
    player.quakePlayerDeathTossVelocity([1, 2, 9 * scale], 0.5),
    [1, 2, (9 + 150) * scale],
  );
  assert.deepEqual(
    player.quakePlayerDeathTossVelocity([1, 2, 10 * scale], 0.5),
    [1, 2, 10 * scale],
  );
});

test("player damage momentum follows QuakeC dir * damage * 8", () => {
  const scale = constants.QUAKE_COLLISION_UNIT_SCALE;

  assert.deepEqual(
    player.quakePlayerDamageMomentumImpulse([10 * scale, 0, 0], [0, 0, 0], 5),
    [40 * scale, 0, 0],
  );
  assert.deepEqual(
    player.quakePlayerDamageMomentumImpulse([0, 0, 10 * scale], [0, 0, 0], 2),
    [0, 0, 16 * scale],
  );
  assert.equal(player.quakePlayerDamageMomentumImpulse([0, 0, 0], [0, 0, 0], 10), null);
  assert.equal(player.quakePlayerDamageMomentumImpulse([0, 0, 0], null, 10), null);
  assert.equal(player.quakePlayerDamageMomentumImpulse([1, 0, 0], [0, 0, 0], 0), null);
});

test("player lifecycle plays the source-selected death sound once", () => {
  const playedSounds = [];
  const traces = [];
  const bodyClasses = new Set();
  const flow = lifecycle.createQuakePlayerLifecycleFlow({
    addBodyClasses: (...classNames) => classNames.forEach((className) => bodyClasses.add(className)),
    appLoading: () => false,
    clearAttackInput: () => undefined,
    clearBonusOverlay: () => undefined,
    clearCrosshairHit: () => undefined,
    clearCrosshairTarget: () => undefined,
    clearCrouchInput: () => undefined,
    clearDeathDamageFeedback: () => undefined,
    clearDeathOverlay: () => undefined,
    clearDebugFlyInput: () => undefined,
    clearGameRoute: () => undefined,
    clearLevelLoadTimer: () => undefined,
    clearMegahealthRot: () => undefined,
    clearMobileMoveInput: () => undefined,
    clearMoveInput: () => undefined,
    clearPowerups: () => undefined,
    clearText: () => undefined,
    clearTextCenterPrint: () => undefined,
    clearWeaponViewPunch: () => undefined,
    controls: {
      lock: () => undefined,
      unlock: () => undefined,
      update: () => undefined,
    },
    currentCollisionWorld: () => ({}),
    currentMapName: () => "e1m1",
    currentResult: () => null,
    exitPointerLockIfHost: () => undefined,
    focusHost: () => undefined,
    gameplayStarted: () => true,
    hasBodyClass: (className) => bodyClasses.has(className),
    hasDeathOverlay: () => false,
    hideMainMenu: () => undefined,
    isMainMenuOpen: () => false,
    isMenuPanelOpen: () => false,
    jumpVelocity: 4,
    loadMap: async () => undefined,
    player: () => ({ respawn: () => undefined }),
    playDeathSound: (soundPath) => {
      playedSounds.push(soundPath);
      return true;
    },
    pointerTrace: () => undefined,
    removeBodyClasses: (...classNames) => classNames.forEach((className) => bodyClasses.delete(className)),
    setGameplayStarted: () => undefined,
    setLoading: () => undefined,
    setPlayerDead: () => undefined,
    showDeathDamageFeedback: () => undefined,
    showDeathOverlay: () => undefined,
    showMainMenu: () => undefined,
    startMap: () => "e1m1",
    syncPlayerCollision: () => undefined,
    trace: (kind, details = {}) => traces.push({ kind, details }),
    viewmodel: {
      clearFireAnimation: () => undefined,
    },
  });

  const result = flow.showPlayerDeath({
    gibbed: false,
    soundPath: "player/death3.wav",
  });
  flow.showPlayerDeath({
    gibbed: false,
    soundPath: "player/death4.wav",
  });

  assert.equal(result?.soundPlayed, true);
  assert.deepEqual(playedSounds, ["player/death3.wav"]);
  assert.equal(flow.isPlayerDead(), true);
  assert.deepEqual(
    traces.filter((entry) => entry.kind === "player-death-sound").map((entry) => entry.details),
    [{ gibbed: false, played: true, soundPath: "player/death3.wav" }],
  );
});
