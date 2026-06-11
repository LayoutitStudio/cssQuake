import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

export async function importTsModule(relativePath) {
  const entryPath = path.join(projectRoot, relativePath);
  const { outputFiles } = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [entryPath],
    format: "esm",
    logLevel: "silent",
    platform: "node",
    write: false,
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`;
  return import(moduleUrl);
}
