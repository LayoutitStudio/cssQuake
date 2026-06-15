import {
  debugMapUrl,
  openDebugMapPage,
  waitForDebugMapReady,
} from "./browserHarnessSupport.mjs";

const REPRESENTATIVE_MONSTERS = [
  { map: "e1m1", classname: "monster_army", entity: 298 },
  { map: "e1m1", classname: "monster_dog", entity: 247 },
  { map: "e1m2", classname: "monster_knight", entity: 99 },
  { map: "e1m2", classname: "monster_ogre", entity: 80 },
  { map: "e1m5", classname: "monster_demon1", entity: 205 },
  { map: "e1m3", classname: "monster_wizard", entity: 294 },
  { map: "e1m6", classname: "monster_shambler", entity: 396 },
  { map: "e1m3", classname: "monster_zombie", entity: 272 },
  { map: "e1m7", classname: "monster_boss", entity: 28 },
];
const MONSTER_FOCUS_YAWS = [0, 45, 90, 135, 180, 225, 270, 315];
const MONSTER_FOCUS_DISTANCES = [2.35, 3.5, 5, 8, 12];

export const monsterDomFixture = {
  id: "monster-dom",
  label: "DOM monster browser fixture",
  artifact: "bench/results/quake/monster-dom-smoke-summary.json",
  family: "monster",
  requirements: { requiredMaps: unique(REPRESENTATIVE_MONSTERS.map((monster) => monster.map)), requireRenderBundle: true },
  run: runMonsterDomFixture,
};

async function runMonsterDomFixture({ browser, baseUrl, options }) {
  let page = null;
  let pageErrors = [];
  const results = [];
  try {
    let currentMap = "";
    for (const monster of REPRESENTATIVE_MONSTERS) {
      if (monster.map !== currentMap) {
        if (!page) {
          ({ page, pageErrors } = await openDebugMapPage(browser, baseUrl, monster.map, options));
        } else {
          await page.goto(debugMapUrl(baseUrl, monster.map), { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
          await waitForDebugMapReady(page, { mapName: monster.map, timeoutMs: options.timeoutMs });
        }
        currentMap = monster.map;
      }
      const result = await validateMonster(page, monster);
      results.push(result);
      const status = result.pass ? "PASS" : "FAIL";
      const attempt = result.attempt;
      console.log(`${status} ${monster.map} ${monster.classname} #${monster.entity}` +
        (attempt ? ` distance=${attempt.distance} yaw=${attempt.yaw} leaves=${attempt.leafCount}` : ""));
    }
  } finally {
    await page?.close();
  }
  const failed = results.filter((result) => !result.pass);
  if (pageErrors.length || failed.length) {
    throw new Error(`DOM monster browser fixture failed: ${results.length - failed.length}/${results.length} passed.\n${pageErrors.join("\n")}`);
  }
  return {
    kind: "cssquake-monster-dom-smoke",
    startedAt: new Date().toISOString(),
    viewport: options.viewport,
    total: results.length,
    passed: results.length,
    failed: 0,
    results,
  };
}

async function validateMonster(page, monster) {
  let lastAttempt = null;
  for (const distance of MONSTER_FOCUS_DISTANCES) {
    for (const yaw of MONSTER_FOCUS_YAWS) {
      const attempt = await page.evaluate(async ({ entity, expectedClassname, distance, yaw }) => {
        const debug = window.__cssQuakeDebug;
        const ok = debug.focusEntity(entity, distance, 90, yaw);
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 120));
        const selector = `.polycss-mesh.shootable.enemy[data-entity-index="${entity}"]`;
        const element = document.querySelector(selector);
        const active = Boolean(
          element &&
          element.getAttribute("aria-hidden") !== "true" &&
          !element.classList.contains("quake-shootable-prewarmed") &&
          !element.classList.contains("quake-frame-hidden")
        );
        const stats = debug.stats();
        return {
          distance,
          yaw,
          focusOk: ok,
          mounted: Boolean(element),
          active,
          classname: element?.dataset.classname ?? null,
          classnameOk: element?.dataset.classname === expectedClassname,
          leafCount: element ? element.querySelectorAll("b,i,s,u").length : 0,
          animationFrame: element?.dataset.animationFrame ?? null,
          quakecState: element?.dataset.quakecState ?? null,
          stats: {
            activeEnemyMeshes: stats.activeEnemyMeshes,
            mountedEnemyShootables: stats.shootables?.mountedEnemyShootables ?? null,
            visibleEnemyShootables: stats.shootables?.visibleEnemyShootables ?? null,
          },
        };
      }, { entity: monster.entity, expectedClassname: monster.classname, distance, yaw });
      lastAttempt = attempt;
      if (attempt.active && attempt.classnameOk && attempt.leafCount > 0) {
        return { ...monster, pass: true, naturalVisibility: true, attempt };
      }
    }
  }
  return { ...monster, pass: false, naturalVisibility: false, attempt: lastAttempt };
}

function unique(values) {
  return [...new Set(values)].sort();
}
