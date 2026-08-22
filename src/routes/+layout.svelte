<script lang="ts">
  import '../app.css';
  import { store } from '$lib/store.svelte';
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

  // Apply the app theme to the document root.
  $effect(() => {
    document.documentElement.dataset.theme = store.settings.appTheme;
  });
</script>

<svelte:head>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html `<style>${fontFaces}</style>`}
</svelte:head>

{@render children()}
