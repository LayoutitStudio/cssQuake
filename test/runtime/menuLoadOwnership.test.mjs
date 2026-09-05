import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { importTsModule } from "../importTsModule.mjs";

const { createQuakeMenuController } = await importTsModule("src/runtime/menu.ts");
const window = new Window();
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "HTMLButtonElement"]) {
  globalThis[key] = key === "window" ? window : key === "document" ? window.document : window[key];
}
test.after(async () => { await window.happyDOM.abort(); });

for (const action of ["new-game", "load", "level"]) {
  for (const completed of [false, true]) {
    test(`${action} ${completed ? "completion" : "supersession"} ${completed ? "locks" : "does not steal"} controls`, async () => {
      let finish, locks = 0, calls = 0;
      const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
      document.body.innerHTML = `<div id="host" tabindex="0"></div><div id="menu"></div>
        <section id="single"><button class="quake-single-player-button" data-quake-single-player-action="${action}"></button></section>
        <section id="level"><button class="quake-level-button" value="e1m1"></button></section>`;
      const menu = createQuakeMenuController({
        enabled: true, host: document.querySelector("#host"), mainMenu: document.querySelector("#menu"),
        singlePlayerPanel: document.querySelector("#single"), levelPanel: document.querySelector("#level"),
        controls: { update() {}, lock: () => locks++, addEventListener() {}, removeEventListener() {} },
        onSelectNewGame: load, onLoadGame: load, onSelectLevel: load, canLoadGame: () => true,
        clearCrosshairTarget() {}, syncCrosshairTarget() {},
      });
      try {
        document.querySelector(action === "level" ? "#level button" : "#single button").click();
        assert.equal(calls, 1);
        finish(completed);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(locks, completed ? 1 : 0);
      } finally { menu.dispose(); }
    });
  }
}
