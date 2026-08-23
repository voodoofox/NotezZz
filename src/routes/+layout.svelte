<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
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
  // On launch + whenever the app regains focus, compare our entry-chunk hash
  // against the server's fresh index.html and reload if a newer build shipped.
  onMount(() => {
    if (isTauri() || import.meta.env.DEV) return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const res = await fetch(`${base}/`, { cache: 'no-store' });
        const html = await res.text();
        const server = html.match(/entry\/start\.[\w-]+\.js/)?.[0];
        const local = [...document.querySelectorAll<HTMLLinkElement>('link[href]')]
          .map((l) => l.href)
          .find((h) => h.includes('/entry/start.'));
        if (server && local && !local.includes(server)) {
          store.flush(); // don't lose in-flight edits to the reload
          location.reload();
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
