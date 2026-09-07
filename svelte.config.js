// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    // Desktop serves at root (BASE_PATH unset); the web host serves the app
    // under /NotezZz. Set BASE_PATH=/NotezZz when building the web bundle.
    paths: {
      base: process.env.BASE_PATH ?? "",
    },
    // The offline shell is for the installed PWA only. Auto-registration put
    // it in the desktop app too, where it pinned the main window to the build
    // it first cached (WebView2 never let it update): every release after
    // 0.17.0 ran on desktop with 0.17.0's shell. +layout registers it on web.
    serviceWorker: {
      register: false,
    },
  },
};

export default config;
