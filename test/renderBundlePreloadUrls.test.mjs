import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
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
