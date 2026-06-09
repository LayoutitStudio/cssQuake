import { readFile } from "node:fs/promises";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import {
  buildQuakeAnimatedRenderBundleHappyDom,
  buildQuakeRenderBundleHappyDom,
} from "./renderBundleHappyDom.mjs";

const generatedPublicDir = workerData?.generatedPublicDir;
const quakePublicPath = workerData?.quakePublicPath ?? "/q";

parentPort?.on("message", async (message) => {
  const textureBytesByUrl = new Map((message.textures ?? []).map(([url, bytes]) => [url, Buffer.from(bytes)]));
  const options = {
    readTextureUrl: async (url) => {
      if (typeof url !== "string" || url.startsWith("data:") || url.startsWith("blob:")) return url;
      const textureBytes = textureBytesByUrl.get(url);
      if (textureBytes) return textureBytes;
      if (!url.startsWith(`${quakePublicPath}/`)) return url;
      return readGeneratedPublicTextureFile(url);
    },
    contentTypeForTextureUrl: contentTypeForPath,
  };
  try {
    const result = message.mode === "animated"
      ? await buildQuakeAnimatedRenderBundleHappyDom(message.input, options)
      : await buildQuakeRenderBundleHappyDom(message.input, options);
    parentPort.postMessage({ id: message.id, result });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      error: {
        message: String(error?.message ?? error),
        stack: error?.stack ? String(error.stack) : "",
      },
    });
  }
});

async function readGeneratedPublicTextureFile(url) {
  const filePath = generatedPublicFilePath(url);
  return readFile(filePath);
}

function generatedPublicFilePath(url) {
  if (!generatedPublicDir) throw new Error("Missing generatedPublicDir for happy-dom render worker.");
  const relative = String(url).replace(/^\/+/, "");
  const resolved = path.resolve(generatedPublicDir, relative);
  const root = path.resolve(generatedPublicDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to read generated asset outside output dir: ${url}`);
  }
  return resolved;
}

function contentTypeForPath(value) {
  const extension = path.extname(String(value).split("?")[0] ?? "").toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".avif") return "image/avif";
  if (extension === ".css") return "text/css";
  return "application/octet-stream";
}
