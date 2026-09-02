/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline shell for the installed PWA.
//
// Without this, an installed NotezZz could not even open without a network:
// Apache serves index.html no-cache (deliberately — a stale index kept people
// on old builds for hours), so a phone on a dead radio got a blank page, and
// share-to-NotezZz failed outright. Notes themselves already live in
// localStorage (the instant-start cache and the write queue); this just makes
// the app shell available to read them.
//
// Strategy:
//   - hashed build assets: cache-first (they are immutable by name)
//   - navigations (index.html): network-first, fall back to the cached shell
//     so the self-update check in +layout still sees a fresh index whenever
//     the network is there
//   - everything else (Google APIs, fonts from data:): untouched

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `notezzz-${version}`;
// Dotfiles in static/ (.htaccess) are served as 403 by Apache; one failed
// request would make cache.addAll reject and the whole install fail.
const ASSETS = [...build, ...files.filter((f) => !/\/\.[^/]*$/.test(f))];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // Drive, Google sign-in: never intercepted

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Keep the newest shell for the next offline launch.
          const copy = res.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(request)) ??
            (await cache.match(`${url.pathname.split('/').slice(0, 2).join('/')}/index.html`)) ??
            (await cache.match(new Request(url.origin + url.pathname.replace(/\/[^/]*$/, '/')))) ??
            Response.error()
          );
        })
    );
    return;
  }

  if (ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => (await cache.match(request)) ?? fetch(request))
    );
  }
});
