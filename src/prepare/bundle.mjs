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
    const leaves = [...mesh.querySelectorAll("s[data-quake-texture]")];
    const pending = leaves.filter((leaf) => {
      const style = leaf.getAttribute("style") ?? "";
      return !style.includes("background-image:");
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

function stripRenderBundleMeshMetadata(mesh) {
  mesh.removeAttribute("data-poly-mesh-id");
  mesh.removeAttribute("data-poly-mesh-index");
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
