import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { localDebugSitePlugin } from "./src/site/localDebugSitePlugin";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

function cssQuakeVersion(): string {
  try {
    const commitCount = execSync("git rev-list --count HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return `0.${commitCount}`;
  } catch {
    return "0.0";
  }
}

function polyCssVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(CONFIG_DIR, "node_modules/@layoutit/polycss/package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function localDebugSiteEnabled(): boolean {
  return process.env.CSSQUAKE_LOCAL_DEBUG_SITE === "1";
}

export default defineConfig({
  plugins: localDebugSiteEnabled() ? [localDebugSitePlugin()] : [],
  define: {
    __CSSQUAKE_VERSION__: JSON.stringify(cssQuakeVersion()),
    __POLYCSS_VERSION__: JSON.stringify(polyCssVersion()),
  },
  publicDir: "build/generated/public",
  server: {
    host: "127.0.0.1",
  },
});
