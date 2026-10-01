<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { replaceState } from '$app/navigation';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { initDiag } from '$lib/diag';
  import { setCustomPatterns } from '$lib/patterns.svelte';
  import { applyTheme, findTheme } from '$lib/theme';
  import { getPalette } from '$lib/palettes';
  import { isDesktop } from '$lib/storage/backend';

  initDiag(); // start capturing errors as early as possible
  // Custom pattern slots live in settings; getPalette() reads them from a
  // registry so it can stay a plain function. Every route (main, sticky) runs
  // this layout, so every window's registry follows its store.
  $effect(() => setCustomPatterns(store.settings.customPatterns));
  // Vite resolves these to hashed, base-path-aware URLs.
  import fontRegular from '$lib/assets/SofiaSansCondensed.ttf';
  import fontItalic from '$lib/assets/SofiaSansCondensed-Italic.ttf';

  let { children } = $props();

  // Default body weight is 324 per spec; Bold selects a heavier instance from
  // the same variable file, Italic uses the italic file.
  const fontFaces = `
    @font-face {
      font-family: 'Sofia Sans Condensed';
      src: url('${fontRegular}') format('truetype');
      font-weight: 1 1000; font-style: normal; font-display: swap;
    }
    @font-face {
      font-family: 'Sofia Sans Condensed';
      src: url('${fontItalic}') format('truetype');
      font-weight: 1 1000; font-style: italic; font-display: swap;
    }
  `;

  // Installed PWAs relaunch from HTTP cache and can linger on a stale build.
  // Service worker: web only. On desktop, evict one if it exists — the
  // page you are reading this from may itself have been served by a stale
  // worker (see svelte.config.js), so after unregistering, reload.
  onMount(() => {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
    if (isTauri()) {
      void (async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (!regs.length) return;
        await Promise.all(regs.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        location.reload();
      })();
      return;
    }
    // Versioned URL: the host's front proxy caches by URL and ignores cache
    // headers, so a fixed /service-worker.js kept handing every phone the same
    // days-old worker (seen: age 411178s), and Chrome's update check has no
    // way past that. A new URL per build is a new registration on the same
    // scope, which replaces the old worker.
    void navigator.serviceWorker.register(`${base}/service-worker.js?v=${encodeURIComponent(__BUILD_TIME__)}`);
  });

  // Android app: the webview draws under the status bar and the navigation
  // bar (Android 15 forces edge-to-edge), so the page pads its top and its
  // bottom toolbars by the bars' heights and paints its own colours behind
  // them. Insets can arrive after first paint and change on rotation and with
  // the keyboard (which resizes the view), so read on mount, shortly after,
  // and on every resize.
  onMount(() => {
    const bridge = (
      window as unknown as { NotezzzAndroid?: { safeTop(): number; safeBottom?(): number } }
    ).NotezzzAndroid;
    if (!bridge) return;
    const apply = () => {
      const root = document.documentElement.style;
      root.setProperty('--safe-top', `${bridge.safeTop()}px`);
      root.setProperty('--safe-bottom', `${bridge.safeBottom?.() ?? 0}px`);
    };
    apply();
    const t = setTimeout(apply, 400);
    window.addEventListener('resize', apply);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', apply);
    };
  });

  // On launch + every return to foreground, poll version.json (cache-busted —
  // the host's front proxy ignores request cache headers) and reload onto the
  // new build when the stamp differs from our baked-in __BUILD_TIME__.
  onMount(() => {
    if (isTauri() || import.meta.env.DEV) return;

    // Clean the ?v= cache-buster left by a previous self-update reload.
    // MUST go through SvelteKit's replaceState — raw history.replaceState
    // wipes the router's internal state and breaks shallow-routing back
    // navigation (the fullscreen note's back button stopped working).
    const url = new URL(location.href);
    if (url.searchParams.has('v')) {
      url.searchParams.delete('v');
      const qs = url.searchParams.toString();
      replaceState(url.pathname + (qs ? `?${qs}` : '') + url.hash, {});
    }

    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      // Never reload out from under a share in progress. It lands ~2.5s in —
      // exactly when the chooser is on screen — and restarts the whole boot,
      // sign-in included, turning a share into a long wait through two of
      // them. The update can wait for a launch that isn't mid-task.
      try {
        if (localStorage.getItem('notezzz:pendingShare')) return;
      } catch {
        /* private mode: nothing pending to protect */
      }
      busy = true;
      try {
        const res = await fetch(`${base}/version.json?ts=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const info = (await res.json()) as { built?: string };
          if (info.built && info.built !== __BUILD_TIME__) {
            store.flush(); // don't lose in-flight edits to the reload
            location.replace(`${base}/?v=${encodeURIComponent(info.built)}`);
          }
        }
      } catch {
        /* offline — try again next focus */
      } finally {
        busy = false;
      }
    };
    setTimeout(check, 2500);
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  });

  // Apply the app theme to the document root, and keep the browser/PWA title
  // bar (theme-color) in step with it.
  $effect(() => {
    const theme = store.settings.appTheme;
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#16181d' : '#f4f5f7');
    // Windows 11: the main window's title bar takes the colour of the app's
    // own top bar, so the two read as one (older Windows ignores it).
    if (isDesktop()) {
      requestAnimationFrame(() => {
        const cs = getComputedStyle(document.documentElement);
        const caption = cs.getPropertyValue('--app-panel').trim();
        const text = cs.getPropertyValue('--app-fg').trim();
        if (!/^#[0-9a-f]{6}$/i.test(caption) || !/^#[0-9a-f]{6}$/i.test(text)) return;
        void import('@tauri-apps/api/core')
          .then(({ invoke }) => invoke('set_titlebar_color', { caption, text }))
          .catch(() => {});
      });
    }
  });

  // Android app: the status-bar icons follow what is under them, the app's
  // top bar (its theme) or, with a note open full screen on a phone, that
  // note (MainActivity's bridge; absent everywhere else).
  $effect(() => {
    const bridge = (window as unknown as { NotezzzAndroid?: { setDarkTheme(d: boolean): void } }).NotezzzAndroid;
    const dark = store.settings.appTheme === 'dark';
    const open = store.mobileOpen && matchMedia('(max-width: 700px)').matches;
    const note = open ? store.notes.find((n) => n.id === store.activeId) : undefined;
    bridge?.setDarkTheme(note ? !!getPalette(note.paletteId).dark : dark);
  });

  // The note theme (light, shade, grain, title strip, buttons): CSS
  // custom properties on the root, in every window, stickies included.
  $effect(() => {
    applyTheme(findTheme(store.settings.themeId, store.settings.themes));
  });
</script>

<svelte:head>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html `<style>${fontFaces}</style>`}
</svelte:head>

{@render children()}
