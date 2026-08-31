import { defineConfig, loadEnv } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { readFileSync, writeFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));
// Human-readable build stamp, baked in at build time (shown in Settings).
const buildStamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
// Written into static/ (config runs before the static copy), so the deployed
// site carries a version.json that exactly matches this build's __BUILD_TIME__.
// The app polls it to detect new deploys — entry-chunk hashes are NOT a usable
// fingerprint (start.*.js is a tiny stub whose hash rarely changes).
writeFileSync(
  new URL("./static/version.json", import.meta.url),
  JSON.stringify({ version: pkg.version, built: buildStamp })
);

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => ({
  plugins: [sveltekit()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(buildStamp),
    // Desktop-only OAuth secret. Injected for the dev server and the
    // `desktop` build mode ONLY — the public web bundle (plain `vite build`)
    // always gets an empty string, so the secret never reaches flatvoxel.com.
    // Value comes from .env.local (git-ignored), never from source.
    __GOOGLE_CLIENT_SECRET__: JSON.stringify(
      command === "serve" || mode === "desktop"
        ? (loadEnv(mode, process.cwd(), "").GOOGLE_CLIENT_SECRET ?? "")
        : ""
    ),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
