# cssQuake

<img src="public/cssquake-logo.png" alt="cssQuake" width="360">

Quake levels, rendered as DOM. Powered by PolyCSS.

cssQuake is a standalone browser renderer for Quake levels. It turns the original map data into a playable, inspectable scene built from browser primitives instead of a WebGL canvas.

## What Is In Here

- Quake 1.06 maps: `e1m1` through `e1m8`.
- BSP, WAD, MDL, LMP, HUD, menu, pickup, and weapon preprocessing.
- A first-person runtime with collision, doors, pickups, hazards, HUD, weapon feedback, and level transitions.
- Chrome trace tooling under `scripts/chrome-trace` for measuring browser frame work.

## PolyCSS

[PolyCSS](https://github.com/LayoutitStudio/polycss) is the rendering layer behind cssQuake: a CSS polygon mesh library, and effectively a 3D engine for the DOM.

In cssQuake, Quake BSP faces become PolyCSS polygons. PolyCSS emits real HTML elements transformed with CSS `matrix3d(...)`. Solid faces can stay as cheap CSS primitives; textured faces use generated PNG texture assets and atlas-backed background slices. Camera movement is scene transform work, so the browser is compositing DOM rather than repainting a canvas every frame.

cssQuake supplies the Quake-specific side of the system: BSP parsing, WAD texture extraction, asset preparation, collision, triggers, doors, pickups, hazards, HUD state, weapon feedback, and level changes.

## How It Works

cssQuake prepares Quake data, then hands the renderable geometry to PolyCSS.

### Preparation

`scripts/prepare-quake.mjs` reads `public/quake/resource.1`, extracts `ID1/PAK0.PAK`, and writes browser-ready assets under `public/local/quake`.

BSP faces are parsed and merged into PolyCSS `Polygon[]` data. WAD textures are decoded through the Quake palette into PNG assets. Animated textures become sprite strips. Entity, visibility, collision, model, HUD, menu, pickup, and weapon data is serialized for the runtime.

The browser loads the prepared JSON and PNG files. It does not parse the original PAK or BSP files while the game is running.

### PolyCSS Rendering

`src/quake/QuakeApp.ts` loads a prepared map, hydrates the texture references, and adds the polygons to a PolyCSS scene:

```ts
scene.add(makeParseResult(polygons), {
  id: "quake-texture-poc",
  merge: false,
  meshResolution: "lossless",
  excludeFromAutoCenter: true,
});
```

PolyCSS mounts a `.polycss-scene`, `.polycss-mesh` wrappers, and one leaf element per visible polygon. The leaf type is chosen by PolyCSS. Solid rectangles, triangles, clipped polygons, and textured surfaces can use different DOM/CSS strategies, but they all end up as inspectable elements in the page.

A textured Quake face ends up roughly like this:

```html
<b
  data-quake-face="1234"
  style="
    transform: ...;
    background-image: url('/local/quake/...');
    background-position: ...;
    background-size: ...;
    image-rendering: pixelated;
  "
></b>
```

cssQuake keeps Quake metadata on those leaves with attributes such as `data-quake-face`, `data-quake-model`, and `data-quake-entity`, so runtime systems can find the DOM nodes for a specific BSP face or brush model.

### CSS And Runtime State

PolyCSS handles the mesh-to-DOM projection, camera transforms, and per-face CSS placement. cssQuake adds Quake-specific presentation:

- `image-rendering: pixelated` keeps textures crisp.
- Texture PNGs are applied as CSS backgrounds.
- Animated water, slime, lava, buttons, and other texture sequences use generated CSS `@keyframes`.
- Lightstyles render as a second, slightly offset PolyCSS overlay mesh with animated opacity.
- The HUD, menu, crosshair, damage flash, status bar digits, keys, and view weapon are DOM/CSS layers too.

JavaScript runs the game side: input, player movement, collision hulls, triggers, doors, pickups, hazards, weapon feedback, and map transitions. When a Quake brush model moves, cssQuake finds the PolyCSS leaves for that model and prepends an extra `translate3d(...)` to their existing transforms. When a button changes state, its leaves can swap CSS background images.

### Visibility

PolyCSS renders through the DOM, so mounted leaf count matters. cssQuake uses prepared BSP visibility data to decide which face leaves should be mounted for the player's current position. Invisible faces are removed from the DOM and reinserted at saved anchors when they come back into view.

The result is Quake map data rendered as PolyCSS-generated HTML and CSS: generated PNG textures, CSS transforms, CSS animation, browser compositing, no WebGL, and no canvas render loop.

## Run

From a clean checkout:

```sh
pnpm install
pnpm prepare:quake
pnpm dev
```

Open the Vite URL, usually `http://127.0.0.1:5173/`.

`pnpm prepare:quake` generates ignored JSON/PNG assets under `public/local/quake`. If those files already exist locally, `pnpm dev` is enough.

## Build

```sh
pnpm build
```

The build runs TypeScript typechecking, verifies `public/quake/resource.1`, extracts `ID1/PAK0.PAK` into a temporary directory, generates deploy assets under `public/local/quake`, then runs `vite build`.

Generated game assets and trace output are intentionally not versioned.

## Deploy

Netlify can build this repo directly from Git:

```toml
[build]
  command = "pnpm build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "22"
```

Those settings are checked in as `netlify.toml`.

## Trace

With the dev server running:

```sh
pnpm trace:quake
```

Trace summaries and raw Chrome traces are written under `bench/`, which is ignored.

## License

cssQuake source code is GPL-2.0.

Quake game data is separate. `public/quake/resource.1` is unmodified Quake 1.06 shareware data used to generate ignored assets under `public/local/quake`; it is not covered by this repository's GPL license.

Quake and original game assets are copyright id Software LLC / Microsoft. This project is unaffiliated with id Software or Microsoft. See the [id Software Quake GPL source release](https://github.com/id-Software/Quake) for the source/data distinction.
