# cssQuake

A port of id Software's [Quake](https://github.com/id-software/quake) that uses the [PolyCSS](https://github.com/LayoutitStudio/polycss) engine instead of webGL. cssQuake preprocesses the original data into browser-ready JSON and image assets, then renders the game as real HTML/CSS 3D geometry. 

Play the live version: [cssquake.com](https://cssquake.com) 🕹️

<img width="2075" height="1000" alt="cssquake-social" src="https://github.com/user-attachments/assets/0b441e86-1385-44bd-b01e-04238119fd45" />

## How to Run

Install dependencies and build the generated Quake assets:

```sh
pnpm install
export QUAKE_SHAREWARE_URL="<Quake 1.06 shareware zip URL>"
pnpm build
```

After the build succeeds, run the local dev server:

```sh
pnpm dev
```

If `build/generated/public/q` already exists locally, you can skip `pnpm build` and run `pnpm dev` directly.

## How It Works

cssQuake is built around the [PolyCSS](https://github.com/LayoutitStudio/polycss) 3D DOM rendering layer. This turns Quake geometry into real HTML elements: world faces are positioned with CSS `matrix3d(...)` transforms, textured with pixelated CSS backgrounds, and grouped into meshes instead of being drawn on a `<canvas>`.

`src/App.ts` loads generated map/model JSON from `/q`, mounts prebuilt PolyCSS render bundles, and indexes compact metadata before stripping browser-facing attributes that runtime systems no longer need. Gameplay systems still connect rendered surfaces back to visibility, lightstyles, doors, buttons, brush-model movement, pickups, hazards, weapon feedback, HUD/menu state, and level transitions.

The browser does not parse the original PAK or BSP files while the game is running. Generated game assets are intentionally ignored by Git.

## Asset Pipeline

`src/prepare/assets.mjs` downloads the Quake 1.06 shareware archive from `QUAKE_SHAREWARE_URL`, verifies the extracted `resource.1`, extracts `ID1/PAK0.PAK`, parses the original BSP, WAD, MDL, LMP, entity, visibility, collision, HUD, menu, pickup, and weapon data, then writes browser-ready assets under the `build/generated/public/q` folder.

Textures are decoded through the Quake palette into generated PNG assets, animated texture sequences become CSS animation inputs, and episode maps get prebuilt PolyCSS render bundles. Those bundles let the browser attach the prepared world DOM directly instead of rebuilding every surface at startup.
