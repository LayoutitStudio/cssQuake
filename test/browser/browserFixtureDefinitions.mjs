import { combatBudgetFixture, logicalTargetabilityFixture } from "./browserFixtureCombat.mjs";
import { liquidDamageFixture, mapLogicFixture, pickupFixture } from "./browserFixtureMapLogic.mjs";
import { monsterDomFixture } from "./browserFixtureMonster.mjs";
import { loadingAssetRetryFixture, loadingGameplayFixture, loadingHistoryFixture, loadingCollisionPreflightFixture } from "./browserFixtureLoading.mjs";
import {
  ogreGrenadeChainFixture,
  ogreGrenadeBounceFixture,
  ogreGrenadeLifecycleFixture,
  rocketFireFixture,
  rocketTouchFixture,
  wizardSpikeChainFixture,
  zombieProjectileChainFixture,
  zombieProjectileStopFixture,
} from "./browserFixtureProjectile.mjs";

export const browserFixtures = [
  monsterDomFixture,
  combatBudgetFixture,
  logicalTargetabilityFixture,
  rocketFireFixture,
  rocketTouchFixture,
  ogreGrenadeChainFixture,
  ogreGrenadeBounceFixture,
  ogreGrenadeLifecycleFixture,
  wizardSpikeChainFixture,
  zombieProjectileChainFixture,
  zombieProjectileStopFixture,
  mapLogicFixture,
  liquidDamageFixture,
  pickupFixture,
  loadingHistoryFixture,
  loadingCollisionPreflightFixture,
  loadingAssetRetryFixture,
  loadingGameplayFixture,
];

export function browserFixtureById(id) {
  return browserFixtures.find((fixture) => fixture.id === id) ?? null;
}

export function browserFixtureFamilies() {
  return [...new Set(browserFixtures.map((fixture) => fixture.family))].sort();
}
