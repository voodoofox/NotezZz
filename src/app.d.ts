// Build-time constants injected by vite.config.js `define`.
declare global {
  const __APP_VERSION__: string;
  const __BUILD_TIME__: string;
  /** Desktop-only OAuth secret; empty string in the public web build. */
  const __GOOGLE_CLIENT_SECRET__: string;
}

export {};
