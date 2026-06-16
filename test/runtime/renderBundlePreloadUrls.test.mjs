import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "../importTsModule.mjs";

const {
  quakeRenderBundleElementAssetUrls,
  quakeRenderBundlePreloadAssetUrls,
} = await importTsModule("src/runtime/renderBundleMesh.ts");

function renderBundle(overrides = {}) {
  return {
    version: 1,
    kind: "polycss-mesh",
    polycssVersion: "test",
    textureLighting: "baked",
    textureQuality: 1,
    meshHtml: "",
    assetUrls: [],
    leafMetadata: [],
    polygonCount: 0,
    leafCount: 0,
    atlasLeafCount: 0,
    ...overrides,
  };
}

test("complete render bundles preload declared asset URLs without scanning mesh HTML", () => {
  const urls = quakeRenderBundlePreloadAssetUrls(renderBundle({
    assetUrls: ["/q/b/e1m1/a0.png", "/q/b/e1m1/l0.png", "/q/b/e1m1/l0.png", ""],
    assetUrlsComplete: true,
    meshHtml: "<div><s style=\"background:url('/q/b/e1m1/unlisted.png')\"></s></div>",
    meshCss: ".mesh .leaf{background-image:url('/q/b/e1m1/unlisted-css.png')}",
  }));

  assert.deepEqual(urls, ["/q/b/e1m1/a0.png", "/q/b/e1m1/l0.png"]);
});

test("render bundles without complete asset URLs fail before runtime preload", () => {
  assert.throws(
    () => quakeRenderBundlePreloadAssetUrls(renderBundle({
      assetUrls: ["/q/b/e1m1/a0.png"],
      meshHtml: "<div><s style=\"background:url('/q/b/e1m1/l0.png')\"></s></div>",
    })),
    /assetUrls must be complete/,
  );
});

test("mounted render bundle leaves expose direct URLs and atlas root-var URLs for preload", () => {
  const window = new Window();
  const mesh = window.document.createElement("div");
  mesh.className = "polycss-mesh";
  mesh.style.setProperty("--bg0", 'url("/q/b/e1m1/a0.png")');

  const directLeaf = window.document.createElement("s");
  directLeaf.setAttribute(
    "style",
    'background:url("/q/b/e1m1/direct.png") 0px 0px / 64px 64px no-repeat',
  );
  const atlasLeaf = window.document.createElement("s");
  atlasLeaf.setAttribute(
    "style",
    "background:var(--bg0) 0px 0px / 64px 64px no-repeat",
  );
  const duplicateAtlasLeaf = window.document.createElement("s");
  duplicateAtlasLeaf.setAttribute(
    "style",
    "background-image:var(--bg0)",
  );

  assert.deepEqual(
    quakeRenderBundleElementAssetUrls(mesh, [directLeaf, atlasLeaf, duplicateAtlasLeaf]),
    ["/q/b/e1m1/direct.png", "/q/b/e1m1/a0.png"],
  );
});
