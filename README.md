# cssQuake

<img src="public/cssquake-logo.png" alt="cssQuake" width="360">

Quake levels, rendered as DOM. Powered by [PolyCSS](https://github.com/LayoutitStudio/polycss).

cssQuake is a standalone browser renderer for Quake 1.06 shareware maps. It preprocesses the original game data into browser-ready JSON and image assets, then renders playable levels as inspectable HTML/CSS instead of WebGL or canvas.

## Includes

- Quake maps `e1m1` through `e1m8`.
- BSP, WAD, MDL, LMP, HUD, menu, pickup, and weapon preprocessing.
- First-person runtime systems for collision, doors, pickups, hazards, HUD, weapon feedback, and level transitions.
- Chrome trace tooling for measuring browser frame work.

## Architecture

`scripts/prepare-quake.mjs` reads `public/quake/resource.1`, extracts `ID1/PAK0.PAK`, and writes generated assets under `public/local/quake`.

At build time, cssQuake parses BSP, WAD, MDL, LMP, entity, visibility, collision, HUD, menu, pickup, and weapon data. WAD textures are decoded through the Quake palette into generated PNG assets, animated texture sequences become CSS animation inputs, and episode maps get prebuilt PolyCSS render bundles so startup does not need to bake the full world DOM in the browser.

At runtime, `src/quake/QuakeApp.ts` loads the prepared map JSON and mounts it into a PolyCSS scene. [PolyCSS](https://github.com/LayoutitStudio/polycss) is the DOM rendering layer: Quake faces become real HTML elements transformed with CSS `matrix3d(...)`, with texture images applied as pixelated CSS backgrounds.

cssQuake keeps Quake metadata on those elements with attributes such as `data-quake-face`, `data-quake-model`, and `data-quake-entity`. Runtime systems use those attributes for visibility, lightstyles, doors, buttons, brush-model movement, pickups, hazards, weapon feedback, HUD/menu state, and level transitions.

The browser does not parse the original PAK or BSP files while the game is running. Generated game assets are intentionally ignored by Git.

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
