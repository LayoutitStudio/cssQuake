import {
  BASE_TILE,
  createPolyPerspectiveCamera,
  createPolyScene,
} from "@layoutit/polycss";

const QUAKE_RENDER_SUPERSAMPLE = 1;
const QUAKE_CAMERA_ZOOM = (BASE_TILE * 0.65) / QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_RENDER_BUNDLE_TIMEOUT_MS = 30000;
const QUAKE_RENDER_BUNDLE_ASSET_MIME = "image/webp";
const QUAKE_RENDER_BUNDLE_ASSET_QUALITY = 0.92;

window.__buildQuakeRenderBundle = async function buildQuakeRenderBundle({ polygons }) {
  const host = document.createElement("main");
  host.style.position = "absolute";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = "1280px";
  host.style.height = "720px";
  document.body.appendChild(host);

  try {
    const camera = createPolyPerspectiveCamera({
      perspective: 900,
      zoom: QUAKE_CAMERA_ZOOM,
      rotX: 88,
      rotY: 270,
      target: [0, 0, 1.72],
    });
    const scene = createPolyScene(host, {
      camera,
      ambientLight: { color: "#ffffff", intensity: Math.PI },
      directionalLight: { direction: [-0.4, -0.55, -0.65], color: "#ffffff", intensity: 0 },
      textureLighting: "baked",
      textureQuality: 1,
      autoCenter: false,
    });
    const handle = scene.add(
      { polygons, objectUrls: [], warnings: [], dispose: () => undefined },
      {
        merge: false,
        meshResolution: "lossless",
        excludeFromAutoCenter: true,
      },
    );

    await waitForBakedTextureLeaves(handle.element);
    const { meshHtml, assets } = await serializeMeshWithAssets(handle.element);
    return {
      meshHtml,
      assets,
      leafCount: handle.element.querySelectorAll("b,i,s,u").length,
      atlasLeafCount: handle.element.querySelectorAll("s").length,
      polygonCount: polygons.length,
    };
  } finally {
    host.remove();
  }
};

async function waitForBakedTextureLeaves(mesh) {
  const startedAt = performance.now();
  while (true) {
    const leaves = [...mesh.querySelectorAll("s")];
    const pending = leaves.filter((leaf) => {
      const style = leaf.getAttribute("style") ?? "";
      return !/background(?:-image)?\s*:/.test(style);
    });
    if (leaves.length === 0 || pending.length === 0) return;
    if (performance.now() - startedAt > QUAKE_RENDER_BUNDLE_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${pending.length}/${leaves.length} baked texture leaves.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

async function serializeMeshWithAssets(mesh) {
  const serializableMesh = mesh.cloneNode(true);
  stripRenderBundleMeshMetadata(serializableMesh);
  const assetByBlobUrl = new Map();
  const styleElements = [serializableMesh, ...serializableMesh.querySelectorAll("[style]")];
  for (const element of styleElements) {
    const style = element.getAttribute("style");
    if (!style || !style.includes("blob:")) continue;
    const nextStyle = style.replace(/url\((['\"]?)(blob:[^)'\"]+)\1\)/g, (_match, _quote, blobUrl) => {
      let asset = assetByBlobUrl.get(blobUrl);
      if (!asset) {
        asset = {
          blobUrl,
          placeholder: `__QUAKE_RENDER_BUNDLE_ASSET_${assetByBlobUrl.size}__`,
        };
        assetByBlobUrl.set(blobUrl, asset);
      }
      return `url("${asset.placeholder}")`;
    });
    element.setAttribute("style", nextStyle);
  }
  hoistRenderBundleBackgroundImages(serializableMesh);

  const assets = [];
  for (const asset of assetByBlobUrl.values()) {
    const response = await fetch(asset.blobUrl);
    const sourceBlob = await response.blob();
    const blob = await transcodeImageBlob(
      sourceBlob,
      QUAKE_RENDER_BUNDLE_ASSET_MIME,
      QUAKE_RENDER_BUNDLE_ASSET_QUALITY,
    );
    assets.push({
      placeholder: asset.placeholder,
      mime: blob.type || "image/png",
      base64: await blobToBase64(blob),
    });
  }

  return {
    meshHtml: serializableMesh.outerHTML,
    assets,
  };
}

function hoistRenderBundleBackgroundImages(mesh) {
  const varByImage = new Map();
  const elements = [...mesh.querySelectorAll("[style]")];
  const imageUseCounts = renderBundleBackgroundImageUseCounts(elements);
  for (const element of elements) {
    const style = element.getAttribute("style") ?? "";
    if (!style.includes("background")) continue;
    const nextStyle = compactRenderBundleBackgroundStyle(
      style.replace(/(background(?:-image)?):\s*url\(([^)]+)\)/g, (_match, property, image) => {
        if ((imageUseCounts.get(image) ?? 0) <= 1) return _match;
        let varName = varByImage.get(image);
        if (!varName) {
          varName = `--bg${varByImage.size}`;
          varByImage.set(image, varName);
        }
        return `${property}:var(${varName})`;
      }),
    );
    if (nextStyle !== style) element.setAttribute("style", nextStyle);
  }

  const usedVarNames = renderBundleBackgroundVarNames(elements);
  setRenderBundleBackgroundVars(mesh, varByImage, usedVarNames);
}

function renderBundleBackgroundImageUseCounts(elements) {
  const counts = new Map();
  for (const element of elements) {
    const style = element.getAttribute("style") ?? "";
    if (!style.includes("background")) continue;
    for (const match of style.matchAll(/background(?:-image)?:\s*url\(([^)]+)\)/g)) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
  return counts;
}

function renderBundleBackgroundVarNames(elements) {
  const names = new Set();
  for (const element of elements) {
    const style = element.getAttribute("style") ?? "";
    if (!style.includes("var(--bg")) continue;
    for (const match of style.matchAll(/var\(--bg(\d+)\)/g)) {
      names.add(`--bg${match[1]}`);
    }
  }
  return names;
}

function setRenderBundleBackgroundVars(mesh, varByImage, usedVarNames) {
  const declarations = [...varByImage]
    .filter(([_image, varName]) => usedVarNames.has(varName))
    .map(([image, varName]) => `${varName}:url(${image})`);
  const style = (mesh.getAttribute("style") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !/^--bg\d+\s*:/.test(part));
  const nextStyle = [...declarations, ...style].join(";");
  if (nextStyle) {
    mesh.setAttribute("style", nextStyle);
  } else {
    mesh.removeAttribute("style");
  }
}

function compactRenderBundleBackgroundStyle(style) {
  const declarations = style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const separator = part.indexOf(":");
      return separator > 0
        ? { index, name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() }
        : null;
    })
    .filter((part) => part && part.value);
  const image = declarations.find((part) => part.name === "background-image");
  const position = declarations.find((part) => part.name === "background-position");
  const size = declarations.find((part) => part.name === "background-size");
  if (!image || !position || !size) return style;
  const background = {
    index: Math.min(image.index, position.index, size.index),
    name: "background",
    value: `${image.value} ${position.value}/${size.value}`,
  };
  return [...declarations.filter((part) => ![
    "background-image",
    "background-position",
    "background-size",
    "background-repeat",
  ].includes(part.name)), background]
    .sort((a, b) => a.index - b.index)
    .map((part) => `${part.name}:${part.value}`)
    .join(";");
}

function stripRenderBundleMeshMetadata(mesh) {
  mesh.removeAttribute("data-poly-mesh-id");
  mesh.removeAttribute("data-poly-mesh-index");
  for (const leaf of mesh.querySelectorAll("[data-poly-index]")) {
    leaf.removeAttribute("data-poly-index");
  }
  for (const element of mesh.querySelectorAll("[style]")) {
    const style = element.getAttribute("style") ?? "";
    if (
      !style.includes("--pn") &&
      !style.includes("--polycss-atlas-size") &&
      !style.includes("background-repeat")
    ) continue;
    const nextStyle = stripRenderBundleStyleMetadata(style);
    if (nextStyle) {
      element.setAttribute("style", nextStyle);
    } else {
      element.removeAttribute("style");
    }
  }
}

function stripRenderBundleStyleMetadata(style) {
  return style
    .split(";")
    .map((part) => part.trim())
    .filter((part) =>
      part &&
      !/^--pn[xyz]\s*:/.test(part) &&
      !/^--polycss-atlas-size\s*:\s*64px$/i.test(part) &&
      !/^background-repeat\s*:\s*no-repeat$/i.test(part)
    )
    .join(";");
}

async function transcodeImageBlob(blob, mime, quality) {
  if (!mime || blob.type === mime) return blob;
  if (typeof createImageBitmap !== "function") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return blob;
    context.drawImage(bitmap, 0, 0);
    const converted = await new Promise((resolve) => {
      canvas.toBlob(resolve, mime, quality);
    });
    return converted || blob;
  } finally {
    bitmap.close?.();
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read blob.")));
    reader.readAsDataURL(blob);
  });
}
