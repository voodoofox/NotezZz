<script lang="ts">
  // The note colour picker: nine palettes, five pixel patterns, and a custom
  // colour from three sliders. One component, used by the note pane and by
  // the sticky window's title bar, so the two can never drift apart.
  import { PALETTES, PATTERNS, getPalette, hslToHex, hexToHsl } from '$lib/palettes';
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';

  let { paletteId, onPick }: { paletteId: string; onPick: (id: string) => void } = $props();

  let pal = $derived(getPalette(paletteId));
  let isCustom = $derived(paletteId.startsWith('custom:'));

  // Inline custom colour: hue + shade + saturation apply instantly — no native
  // colour-dialog chain. Seeded from the note's current custom colour so the
  // first nudge doesn't snap it somewhere else.
  // Read once, deliberately: the sliders start where the note is and then
  // own their values; re-seeding on every prop change would fight the drag.
  const seed = untrack(() => (paletteId.startsWith('custom:') ? hexToHsl(paletteId.slice(7)) : null));
  let custHue = $state(seed?.h ?? 45);
  let custSat = $state(seed ? Math.min(90, seed.s) : 70);
  let custLight = $state(seed ? Math.max(30, Math.min(94, seed.l)) : 82);

  function applyCustom() {
    onPick(`custom:${hslToHex(custHue, custSat, custLight)}`);
  }
</script>

<div class="pgrid">
  {#each PALETTES as p}
    <button
      class="pchip"
      data-testid="palette-chip"
      data-palette={p.id}
      style="background: {p.bg}"
      title={p.name}
      aria-label={p.name}
      onclick={() => onPick(p.id)}
    >
      {#if paletteId === p.id}
        <span class="pcheck" style="color: {p.fg}"><Icon name="check" size={15} /></span>
      {/if}
    </button>
  {/each}
  <!-- Nine colours in a five-wide grid: this holds the tenth slot so the
       patterns are the whole third row, not a wrapped tail. -->
  <span class="pchip spacer" aria-hidden="true"></span>
  {#each PATTERNS as p}
    <button
      class="pchip nz-pat-{p.pattern}"
      data-testid="palette-chip"
      data-palette={p.id}
      style="--pat-base: {p.header}; --pat-ink: {p.inkStrong}"
      title={p.name}
      aria-label={p.name}
      onclick={() => onPick(p.id)}
    >
      {#if paletteId === p.id}
        <span class="pcheck" style="color: {p.fg}"><Icon name="check" size={15} /></span>
      {/if}
    </button>
  {/each}
  {#if isCustom}
    <span class="pchip current" style="background: {pal.bg}">
      <span class="pcheck" style="color: {pal.fg}"><Icon name="check" size={15} /></span>
    </span>
  {/if}
</div>
<label class="crow">
  <input
    class="hue"
    type="range" min="0" max="360" step="1"
    data-testid="custom-hue"
    aria-label="Custom color hue"
    bind:value={custHue}
    oninput={applyCustom}
  />
</label>
<label class="crow">
  <input
    class="shade"
    type="range" min="30" max="94" step="1"
    aria-label="Custom color shade"
    style="--hue: {custHue}; --sat: {custSat}%"
    bind:value={custLight}
    oninput={applyCustom}
  />
</label>
<label class="crow">
  <input
    class="desat"
    type="range" min="0" max="90" step="1"
    aria-label="Custom color saturation"
    style="--hue: {custHue}"
    bind:value={custSat}
    oninput={applyCustom}
  />
</label>

<style>
  .pgrid {
    display: grid;
    grid-template-columns: repeat(5, 34px);
    gap: 8px;
  }
  .pchip {
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(0, 0, 0, 0.16);
    cursor: pointer;
    padding: 0;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .pchip:hover {
    transform: scale(1.08);
  }
  .pchip.current {
    cursor: default;
  }
  .pchip.spacer {
    visibility: hidden;
  }
  .pcheck {
    display: inline-flex;
  }
  .pchip.nz-pat-checker .pcheck,
  .pchip.nz-pat-stripes .pcheck,
  .pchip.nz-pat-dots .pcheck,
  .pchip.nz-pat-stairs .pcheck,
  .pchip.nz-pat-bricks .pcheck {
    background: var(--pat-base);
    border-radius: var(--radius-sm);
    padding: 1px;
  }
  /* Custom colour: hue wheel flattened into a slider, plus shade and saturation. */
  .crow {
    display: block;
  }
  .crow input[type='range'] {
    width: 100%;
    height: 22px;
    appearance: none;
    -webkit-appearance: none;
    border-radius: var(--radius-md);
    outline: none;
    cursor: pointer;
  }
  .crow input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--app-panel);
    border: 2px solid var(--app-fg);
  }
  .hue {
    background: linear-gradient(
      to right,
      hsl(0, 70%, 70%),
      hsl(60, 70%, 70%),
      hsl(120, 70%, 70%),
      hsl(180, 70%, 70%),
      hsl(240, 70%, 70%),
      hsl(300, 70%, 70%),
      hsl(360, 70%, 70%)
    );
  }
  .shade {
    background: linear-gradient(
      to right,
      hsl(var(--hue), var(--sat, 70%), 30%),
      hsl(var(--hue), var(--sat, 70%), 94%)
    );
  }
  .desat {
    background: linear-gradient(
      to right,
      hsl(var(--hue), 0%, 75%),
      hsl(var(--hue), 90%, 75%)
    );
  }
</style>
