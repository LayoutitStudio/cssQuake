import { defineConfig } from "vite";
import { execSync } from "node:child_process";

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

export default defineConfig({
  define: {
    __CSSQUAKE_VERSION__: JSON.stringify(cssQuakeVersion()),
  },
  publicDir: "build/generated/public",
  server: {
    host: "127.0.0.1",
  },
});
