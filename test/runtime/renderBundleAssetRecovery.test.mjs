import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { Window } from "happy-dom";
import { importTsModule } from "../importTsModule.mjs";

const window = new Window({ url: "http://localhost/", settings: { disableCSSFileLoading: false } });
for (const key of ["window", "document", "HTMLElement", "HTMLLinkElement", "HTMLTemplateElement"]) {
  globalThis[key] = key === "window" ? window : key === "document" ? window.document : window[key];
}
test.after(async () => { await window.happyDOM.abort(); });
const { preloadQuakeRenderBundleAssets: preload } = await importTsModule("src/runtime/renderBundleMesh.ts");
const bundle = (extra = {}) => ({
  version: 1, kind: "polycss-mesh", polycssVersion: "0.2.6", textureLighting: "baked", textureQuality: 1,
  meshHtml: '<div class="polycss-mesh"><s></s></div>', assetUrls: [], assetUrlsComplete: true,
  leafMetadata: [], polygonCount: 1, leafCount: 1, atlasLeafCount: 1, ...extra,
});

test("stylesheet failure rejects all waiters and retry creates a fresh link", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    const first = ++requests === 1;
    response.writeHead(first ? 503 : 200, { "Content-Type": "text/css" });
    response.end(first ? "unavailable" : ".polycss-mesh { display: block; }");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const value = bundle({ styleUrl: `http://127.0.0.1:${server.address().port}/retry.css` });
    const first = preload(value);
    const joined = preload(value);
    const failed = document.querySelector("link");
    await Promise.all([assert.rejects(first, /retry.css/), assert.rejects(joined, /retry.css/)]);
    assert.equal(failed.isConnected, false);
    const retry = preload(value);
    const replacement = document.querySelector("link");
    assert.notEqual(replacement, failed);
    await retry;
    await preload(value);
    assert.equal(document.querySelectorAll("link").length, 1);
    assert.equal(requests, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("image failure rejects and the next attempt retries; successful requests stay shared", async () => {
  let created = 0;
  const original = globalThis.Image;
  globalThis.Image = class {
    constructor() { this.attempt = ++created; }
    decode() { return Promise.resolve(); }
    set src(_url) { queueMicrotask(() => this.attempt === 1 ? this.onerror() : this.onload()); }
  };
  try {
    const value = bundle({ assetUrls: ["/q/retry.png"] });
    await assert.rejects(preload(value), /retry.png/);
    await Promise.all([preload(value), preload(value)]);
    await preload(value);
    assert.equal(created, 2);
  } finally { globalThis.Image = original; }
});

for (const failure of ["http", "json", "version", "frame"]) {
  test(`frame bank ${failure} failure can recover without reloading the page`, async () => {
    let attempts = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      const failed = ++attempts === 1;
      return {
        ok: !(failed && failure === "http"),
        json: async () => {
          if (failed && failure === "json") throw new Error("bad JSON");
          return { version: failed && failure === "version" ? 2 : 3,
            frames: failed && failure === "frame" ? [] : [[['1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1', "", ""]]] };
        },
      };
    };
    try {
      const value = bundle({ leafFrameStylesUrl: `/q/retry-${failure}.json` });
      await assert.rejects(preload(value));
      await preload(value);
      assert.equal(attempts, 2);
      assert.equal(value.leafFrameStyles.length, 1);
    } finally { globalThis.fetch = original; }
  });
}
