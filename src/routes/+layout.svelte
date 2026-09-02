<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { replaceState } from '$app/navigation';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { initDiag } from '$lib/diag';

  initDiag(); // start capturing errors as early as possible
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
  });
</script>

<svelte:head>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html `<style>${fontFaces}</style>`}
</svelte:head>

{@render children()}
