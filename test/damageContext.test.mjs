import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  quakeDamageRetargetDecision,
} = await importTsModule("src/runtime/shootables/damage.ts");

const player = { classname: "player", id: "player", kind: "player" };
const world = { classname: "world", id: "world", kind: "world" };

function monsterActor(classname, entityIndex) {
  return { classname, entityIndex, id: entityIndex, kind: "shootable" };
}

function monsterTarget(classname, entityIndex = 10) {
  return { classname, entityIndex, monster: true };
}

test("Quake damage retargets monsters to a different-class attacker", () => {
  const decision = quakeDamageRetargetDecision({
    attacker: monsterActor("monster_dog", 20),
    currentEnemy: player,
    target: monsterTarget("monster_ogre"),
  });

  assert.equal(decision.retarget, true);
  assert.equal(decision.reason, "retarget");
  assert.equal(decision.preserveOldEnemy, true);
  assert.deepEqual(decision.target, {
    classname: "monster_dog",
    entityIndex: 20,
    id: 20,
    kind: "shootable",
  });
});

test("Quake damage keeps same-class monsters calm except soldiers", () => {
  const sameOgre = quakeDamageRetargetDecision({
    attacker: monsterActor("monster_ogre", 20),
    currentEnemy: player,
    target: monsterTarget("monster_ogre"),
  });
  const sameSoldier = quakeDamageRetargetDecision({
    attacker: monsterActor("monster_army", 21),
    currentEnemy: player,
    target: monsterTarget("monster_army"),
  });

  assert.equal(sameOgre.retarget, false);
  assert.equal(sameOgre.reason, "same-class");
  assert.equal(sameSoldier.retarget, true);
  assert.equal(sameSoldier.reason, "retarget");
  assert.equal(sameSoldier.target.entityIndex, 21);
});

test("Quake damage does not retarget to world, self, or current enemy", () => {
  const cases = [
    {
      expected: "world",
      input: { attacker: world, target: monsterTarget("monster_army") },
    },
    {
      expected: "attacker-is-self",
      input: { attacker: monsterActor("monster_dog", 10), target: monsterTarget("monster_dog", 10) },
    },
    {
      expected: "attacker-is-current-enemy",
      input: {
        attacker: monsterActor("monster_dog", 20),
        currentEnemy: { classname: "monster_dog", entityIndex: 20, id: 20, kind: "shootable" },
        target: monsterTarget("monster_ogre"),
      },
    },
  ];

  for (const entry of cases) {
    const decision = quakeDamageRetargetDecision(entry.input);
    assert.equal(decision.retarget, false);
    assert.equal(decision.reason, entry.expected);
    assert.equal(decision.target, null);
  }
});
