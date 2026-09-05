import assert from "node:assert/strict";
import { readPreparedScene } from "../assets/preparedAssets.mjs";
import { collectPageErrors, debugMapUrl, waitForDebugMapReady } from "./browserHarnessSupport.mjs";
import { assertNoPageErrors, defineBrowserFixture, runDebugMapFixture } from "./fixtureHarness.mjs";

export const loadingHistoryFixture = defineBrowserFixture({
  id: "loading-history", label: "History navigation during map loading", family: "loading",
  artifact: "bench/results/quake/loading-history.json", maps: ["e1m1", "e1m2"],
  run: async ({ browser, baseUrl, options }) => runDebugMapFixture({
    browser, baseUrl, options, mapName: "e1m1",
    run: async ({ page, pageErrors }) => {
      let release, requested;
      const held = new Promise(resolve => { release = resolve; });
      const requestStarted = new Promise(resolve => { requested = resolve; });
      await page.route("**/e1m2.json", async route => {
        requested();
        await held;
        await route.continue();
      });
      try {
        await page.evaluate(() => {
          history.pushState({}, "", "?debug=1&map=e1m2");
          history.pushState({}, "", "?debug=1&map=e1m3");
          history.back();
        });
        await Promise.race([requestStarted, page.waitForTimeout(options.timeoutMs).then(() => { throw new Error("History did not request e1m2"); })]);
        await page.evaluate(() => history.back());
        await waitForDebugMapReady(page, { ...options, mapName: "e1m1" });
        release();
        await page.waitForLoadState("networkidle");
        const state = await page.evaluate(() => ({ map: window.__cssQuakeDebug.stats().mapName, urlMap: new URL(location.href).searchParams.get("map"), loading: window.__cssQuakeDebug.stats().loading }));
        assert.deepEqual(state, { map: "e1m1", urlMap: "e1m1", loading: false });
        assertNoPageErrors(pageErrors);
        return { generatedAt: new Date().toISOString(), browser: browser.version(), state };
      } finally { release(); }
    },
  }),
});

export const loadingAssetRetryFixture = defineBrowserFixture({
  id: "loading-asset-retry", label: "Prepared texture retry without page reload", family: "loading",
  artifact: "bench/results/quake/loading-asset-retry.json", mapName: "e1m1",
  run: async ({ browser, baseUrl, options }) => {
    const scene = readPreparedScene("e1m1");
    const assetUrl = scene.renderBundle.assetUrls.find(url => url.includes("-floor-"));
    assert.ok(assetUrl, "The real prepared world must have a floor texture");
    const page = await browser.newPage({ viewport: options.viewport });
    const errors = [];
    let attempts = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route(`**${assetUrl}`, async route => {
      if (++attempts === 1) await route.abort("failed");
      else await route.continue();
    });
    try {
      await page.goto(debugMapUrl(baseUrl, "e1m1"), { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
      await page.waitForFunction(() => document.querySelector('.quake-loading-console-persisted[aria-busy="false"]'), null, { timeout: options.timeoutMs });
      assert.equal(attempts, 1);
      // Real browser history is also available while the error overlay is displayed.
      await page.evaluate(() => { history.pushState({}, "", "?debug=1&map=e1m2"); history.back(); });
      await waitForDebugMapReady(page, { ...options, mapName: "e1m1" });
      assert.equal(attempts, 2);
      assertNoPageErrors(errors);
      const weapon = await page.evaluate(() => window.__cssQuakeDebug.viewmodel());
      return { generatedAt: new Date().toISOString(), browser: browser.version(), attempts, weapon };
    } finally { await page.close(); }
  },
});

export const loadingGameplayFixture = defineBrowserFixture({
  id: "loading-gameplay", label: "New game, movement, combat, respawn and save/load with touch controls", family: "loading",
  artifact: "bench/results/quake/loading-gameplay.json", mapName: "e1m1",
  run: async ({ browser, baseUrl, options }) => {
    // Touch availability uses the product input path without headless pointer-lock support.
    const page = await browser.newPage({ viewport: options.viewport, hasTouch: true });
    const errors = collectPageErrors(page);
    const snapshot = () => page.evaluate(() => {
      const stats = window.__cssQuakeDebug.stats();
      return { origin: stats.origin, health: stats.playerHealth, shells: stats.playerShells, weapon: stats.activeWeapon, map: stats.mapName, loading: stats.loading, bodyClasses: document.body.className, move: stats.playerMove, focused: document.activeElement?.id, locked: document.pointerLockElement?.id };
    });
    try {
      await page.goto(debugMapUrl(baseUrl), { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
      await page.waitForFunction(() => window.__cssQuakeDebug && !window.__cssQuakeDebug.stats().loading, null, { timeout: options.timeoutMs });
      await page.locator('[data-quake-main-menu-action="single-player"]').click();
      await page.locator('[data-quake-single-player-action="new-game"]').click();
      await waitForDebugMapReady(page, { ...options, mapName: "e1m1" });
      const spawned = await snapshot();
      assert.equal(spawned.health, 100);
      await page.keyboard.down("w");
      await page.waitForTimeout(250);
      await page.keyboard.up("w");
      const moved = await snapshot();
      assert.ok(Math.hypot(moved.origin[0] - spawned.origin[0], moved.origin[1] - spawned.origin[1]) > 0.1, `Keyboard movement must work after map readiness: ${JSON.stringify({ spawned, moved })}`);
      await page.keyboard.down("Space");
      await page.waitForTimeout(120);
      const jumped = await snapshot();
      await page.keyboard.up("Space");
      assert.ok(jumped.origin[2] > moved.origin[2] + 0.05, "Jump must work after map readiness");
      await page.waitForTimeout(650);
      const fired = await page.evaluate(() => window.__cssQuakeDebug.fire());
      assert.equal(fired, true);
      const shot = await snapshot();
      assert.equal(shot.shells, moved.shells - 1);
      await page.keyboard.press("1");
      await page.waitForFunction(() => window.__cssQuakeDebug.stats().activeWeapon === "axe");
      await page.keyboard.press("2");
      await page.waitForFunction(() => window.__cssQuakeDebug.stats().activeWeapon === "shotgun");
      await page.evaluate(() => window.__cssQuakeDebug.damage(1000));
      await page.waitForFunction(() => window.__cssQuakeDebug.stats().playerHealth <= 0);
      await page.touchscreen.tap(Math.round(options.viewport.width / 2), Math.round(options.viewport.height / 2));
      await page.waitForFunction(() => window.__cssQuakeDebug.stats().playerHealth === 100);
      const respawned = await snapshot();
      assert.equal(respawned.map, "e1m1");
      assert.equal(respawned.loading, false);
      await page.waitForTimeout(650); // The preceding shot still owns its source weapon cooldown.
      assert.equal(await page.evaluate(() => window.__cssQuakeDebug.fire()), true);
      const openSinglePlayer = async () => {
        await page.waitForTimeout(1100); // Let the existing death/resume menu suppression expire.
        await page.keyboard.press("Escape");
        await page.locator('[data-quake-main-menu-action="single-player"]').click();
      };
      await page.evaluate(() => window.__cssQuakeDebug.damage(17));
      await openSinglePlayer();
      await page.locator('[data-quake-single-player-action="save"]').click();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cssquake.save.v1")));
      assert.equal(saved.mapName, "e1m1");
      const savedState = await snapshot();
      assert.equal(savedState.health, 83);
      await page.waitForTimeout(650);
      assert.equal(await page.evaluate(() => window.__cssQuakeDebug.fire()), true);
      assert.equal((await snapshot()).shells, savedState.shells - 1);
      await openSinglePlayer();
      await page.locator('[data-quake-single-player-action="load"]').click();
      await page.waitForFunction(health => window.__cssQuakeDebug.stats().playerHealth === health && !document.body.classList.contains("quake-menu-open"), savedState.health);
      const restoredSameMap = await snapshot();
      assert.equal(restoredSameMap.shells, savedState.shells);
      assert.equal(restoredSameMap.weapon, savedState.weapon);
      assert.equal(await page.evaluate(() => window.__cssQuakeDebug.loadMap("e1m2")), true);
      await waitForDebugMapReady(page, { ...options, mapName: "e1m2" });
      await openSinglePlayer();
      await page.locator('[data-quake-single-player-action="load"]').click();
      await waitForDebugMapReady(page, { ...options, mapName: "e1m1" });
      await page.waitForFunction(health => window.__cssQuakeDebug.stats().playerHealth === health, savedState.health);
      const restoredOtherMap = await snapshot();
      assert.equal(restoredOtherMap.shells, savedState.shells);
      assert.equal(restoredOtherMap.weapon, savedState.weapon);
      assert.ok(Math.hypot(...restoredOtherMap.origin.map((value, axis) => value - saved.view.origin[axis])) < 0.1, "Load Game must restore the saved camera/player location");
      await openSinglePlayer();
      await page.locator('[data-quake-single-player-action="new-game"]').click();
      await page.waitForFunction(() => window.__cssQuakeDebug.stats().playerHealth === 100);
      const restarted = await snapshot();
      assert.equal(restarted.map, "e1m1");
      assert.equal(restarted.shells, spawned.shells);
      // Existing menu/respawn lock calls are unsupported in headless Chromium. Keep that
      // limitation visible, and fail on every other console or page error.
      const unsupportedPointerLock = errors.filter(error => error === "The root document of this element is not valid for pointer lock.");
      assertNoPageErrors(errors.filter(error => !unsupportedPointerLock.includes(error)));
      return { generatedAt: new Date().toISOString(), browser: browser.version(), inputMode: "touch-capable browser with keyboard movement", unsupportedPointerLock, spawned, moved, jumped, shot, respawned, savedState, restoredSameMap, restoredOtherMap, restarted };
    } finally { await page.close(); }
  },
});

export const loadingCollisionPreflightFixture = defineBrowserFixture({
  id: "loading-collision-preflight", label: "Invalid collision preserves the mounted map", family: "loading",
  artifact: "bench/results/quake/loading-collision-preflight.json", maps: ["e1m1", "e1m2"],
  run: async ({ browser, baseUrl, options }) => runDebugMapFixture({
    browser, baseUrl, options, mapName: "e1m1",
    run: async ({ page, pageErrors }) => {
      // Keep the old player and its actual world DOM; corrupt only the next map response.
      const before = await page.evaluate(() => {
        const stats = window.__cssQuakeDebug.stats();
        window.__retainedWorldProbe = document.querySelector(".quake-world-mesh");
        return { map: stats.mapName, origin: stats.origin, health: stats.playerHealth };
      });
      let intercepted = false;
      await page.route("**/e1m2.json", async route => {
        const response = await route.fetch();
        const scene = await response.json();
        scene.collision = null;
        intercepted = true;
        await route.fulfill({ response, json: scene });
      });
      const result = await page.evaluate(async () => {
        let error;
        try { await window.__cssQuakeDebug.loadMap("e1m2"); } catch (cause) { error = cause.message; }
        const stats = window.__cssQuakeDebug.stats();
        return { error, map: stats.mapName, origin: stats.origin, health: stats.playerHealth,
          retainedWorld: window.__retainedWorldProbe?.isConnected === true,
          loading: stats.loading };
      });
      assert.equal(intercepted, true);
      assert.match(result.error, /missing collision data/);
      assert.deepEqual(result, { error: result.error, ...before, retainedWorld: true, loading: false });
      await page.unroute("**/e1m2.json");
      assert.equal(await page.evaluate(() => window.__cssQuakeDebug.loadMap("e1m2")), true);
      await waitForDebugMapReady(page, { ...options, mapName: "e1m2" });
      assertNoPageErrors(pageErrors);
      return { generatedAt: new Date().toISOString(), browser: browser.version(), before, result, retry: "e1m2" };
    },
  }),
});
