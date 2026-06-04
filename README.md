# cssQuake

<img src="public/cssquake-logo.png" alt="cssQuake" width="360">

Quake levels, rendered as DOM. Powered by [PolyCSS](https://github.com/LayoutitStudio/polycss).

cssQuake is a standalone browser renderer for Quake 1.06 shareware maps. It preprocesses the original game data into browser-ready JSON and PNG assets, then renders playable levels as inspectable HTML/CSS instead of WebGL or canvas.

## Includes

- Quake maps `e1m1` through `e1m8`.
- BSP, WAD, MDL, LMP, HUD, menu, pickup, and weapon preprocessing.
- First-person runtime systems for collision, doors, pickups, hazards, HUD, weapon feedback, and level transitions.
- Chrome trace tooling for measuring browser frame work.

## How It Works

[PolyCSS](https://github.com/LayoutitStudio/polycss) is the rendering layer behind cssQuake. It is a CSS polygon mesh library: Quake BSP faces become PolyCSS polygons, and PolyCSS emits real HTML elements transformed with CSS `matrix3d(...)`.

cssQuake supplies the Quake-specific side of the system:

- BSP parsing and face merging.
- WAD texture extraction through the Quake palette.
- Generated PNG textures and animated texture strips.
- Entity, visibility, collision, model, HUD, menu, pickup, and weapon data.
- Runtime behavior for movement, doors, triggers, pickups, hazards, and map transitions.

The browser loads prepared JSON and PNG files. It does not parse the original PAK or BSP files while the game is running.

## Preparation

`scripts/prepare-quake.mjs` reads `public/quake/resource.1`, extracts `ID1/PAK0.PAK`, and writes generated assets under `public/local/quake`.

BSP faces are parsed into PolyCSS `Polygon[]` data. WAD textures are decoded into PNG assets. Animated water, slime, lava, buttons, and other texture sequences become generated CSS animation inputs.

Generated game assets are intentionally ignored by Git.

## Rendering And Runtime

`src/quake/QuakeApp.ts` loads a prepared map, hydrates its texture references, and adds the polygons to a PolyCSS scene. PolyCSS mounts a `.polycss-scene`, mesh wrappers, and one leaf element per visible polygon.

cssQuake keeps Quake metadata on those leaves with attributes such as `data-quake-face`, `data-quake-model`, and `data-quake-entity`. Runtime systems use those attributes to update specific BSP faces or brush models.

Most presentation remains DOM/CSS:

- Texture PNGs are applied as CSS backgrounds.
- `image-rendering: pixelated` keeps textures crisp.
- Lightstyles render as a second, slightly offset PolyCSS overlay mesh.
- The HUD, menu, crosshair, damage flash, status bar digits, keys, and view weapon are DOM/CSS layers too.

JavaScript handles the game side: input, player movement, collision hulls, triggers, doors, pickups, hazards, weapon feedback, and level transitions. When a brush model moves, cssQuake updates the transforms for the PolyCSS leaves that belong to that model.

PolyCSS renders through the DOM, so mounted leaf count matters. cssQuake uses prepared BSP visibility data to mount only the faces visible from the player's current position.

## Run

Requires Node 22 and pnpm.

```sh
pnpm install
pnpm prepare:quake
pnpm dev
```

Open the Vite URL, usually `http://127.0.0.1:5173/`.

If `public/local/quake` already exists locally, `pnpm dev` is enough.

## Build

```sh
pnpm build
```

The `prebuild` step installs Playwright's Chromium binary for render bundle generation. The build then runs TypeScript typechecking, verifies `public/quake/resource.1`, generates deploy assets under `public/local/quake`, and runs `vite build`.

## Deploy

Netlify can build this repo directly from Git. Configure the site in the
Netlify UI with:

```text
Build command: pnpm build
Publish directory: dist
Node version: 22
```

## Trace

With the dev server running at `http://127.0.0.1:5173/`:

```sh
pnpm trace:quake
```

Trace summaries and raw Chrome traces are written under ignored `bench/` paths.

## License

cssQuake source code is GPL-2.0.

Quake game data is separate. `public/quake/resource.1` is unmodified Quake 1.06 shareware data used to generate ignored assets under `public/local/quake`; it is not covered by this repository's GPL license.

Quake and original game assets are copyright id Software LLC / Microsoft. This project is unaffiliated with id Software or Microsoft.
