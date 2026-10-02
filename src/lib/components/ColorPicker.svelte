<script lang="ts">
  // The note colour picker: nine palettes, five pixel patterns, five custom
  // patterns of your own, a custom colour from three sliders, and five slots
  // to keep custom colours in. One component, used by the note pane and by
  // the sticky window's title bar, so the two can never drift apart.
  import { PALETTES, PATTERNS, getPalette, hslToHex, hexToHsl } from '$lib/palettes';
  import {
    COLOR_SLOTS,
    PATTERN_SLOTS,
    customPatternId,
    getCustomPattern,
    patternSvg,
    paletteFromTint,
    type CustomPattern,
  } from '$lib/patterns.svelte';
  import { store } from '$lib/store.svelte';
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import PatternEditor from './PatternEditor.svelte';

  let { paletteId, onPick }: { paletteId: string; onPick: (id: string) => void } = $props();

  let pal = $derived(getPalette(paletteId));
  let isCustom = $derived(paletteId.startsWith('custom:'));

  // Inline custom colour: hue + shade + saturation apply instantly — no native
  // colour-dialog chain. Read once, deliberately: the sliders start where the
  // note is and then own their values; re-seeding on every prop change would
  // fight the drag.
  const seed = untrack(() => (paletteId.startsWith('custom:') ? hexToHsl(paletteId.slice(7)) : null));
  let custHue = $state(seed?.h ?? 45);
  let custSat = $state(seed ? Math.min(90, seed.s) : 70);
  let custLight = $state(seed ? Math.max(0, Math.min(100, seed.l)) : 82);

  function applyCustom() {
    onPick(`custom:${hslToHex(custHue, custSat, custLight)}`);
  }

  // ---- saved colours: five slots, first free one, then the oldest ----------
  let saved = $derived((store.settings.customColors ?? []).slice(0, COLOR_SLOTS));
  let currentHex = $derived(isCustom ? paletteId.slice(7) : null);
  let alreadySaved = $derived(!!currentHex && saved.includes(currentHex));
  function saveColour() {
    if (!currentHex || alreadySaved) return;
    const next = saved.length < COLOR_SLOTS ? [...saved, currentHex] : [...saved.slice(1), currentHex];
    void store.saveSettings({ customColors: next });
  }

  // ---- custom patterns: five slots; empty opens the editor -----------------
  // The registry (patterns.ts) follows settings; reading settings here makes
  // this re-render when a slot changes.
  let slots = $derived(
    Array.from({ length: PATTERN_SLOTS }, (_, i) => {
      void store.settings.customPatterns;
      return getCustomPattern(i);
    })
  );
  let editing = $state<number | null>(null);
  // The custom-colour sliders stay folded away unless the note already has
  // a custom colour: most picks are one of the chips.
  let showCustom = $state(untrack(() => paletteId.startsWith('custom:')));
  function chipStyle(p: CustomPattern): string {
    const t = paletteFromTint(p.tint);
    return `--pat-base: ${t.header}; --pat-ink: ${t.inkStrong}; --pat-img: ${patternSvg(p.px, t.inkStrong)}`;
  }
  function savePattern(i: number, p: CustomPattern) {
    const list = Array.from({ length: PATTERN_SLOTS }, (_, k) => store.settings.customPatterns?.[k] ?? null);
    list[i] = p;
    void store.saveSettings({ customPatterns: list });
    editing = null;
    onPick(customPatternId(i));
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
  <!-- Fourth row: your own patterns. -->
  {#each slots as p, i}
    {#if p}
      <span class="slot">
        <button
          class="pchip nz-pat-custom"
          data-testid="palette-chip"
          data-palette={customPatternId(i)}
          style={chipStyle(p)}
          title="Pattern {i + 1}"
          aria-label="Pattern {i + 1}"
          onclick={() => onPick(customPatternId(i))}
        >
          {#if paletteId === customPatternId(i)}
            <span class="pcheck" style="color: #2a2c2e"><Icon name="check" size={15} /></span>
          {/if}
        </button>
        <button class="edit" data-testid="pattern-edit" title="Edit pattern {i + 1}" aria-label="Edit pattern {i + 1}" onclick={() => (editing = i)}>
          <Icon name="draw" size={11} />
        </button>
      </span>
    {:else}
      <button
        class="pchip empty"
        data-testid="pattern-empty"
        title="New pattern in slot {i + 1}"
        aria-label="New pattern in slot {i + 1}"
        onclick={() => (editing = i)}
      >
        <Icon name="add" size={15} />
      </button>
    {/if}
  {/each}
  {#if isCustom}
    <span class="pchip current" style="background: {pal.bg}">
      <span class="pcheck" style="color: {pal.fg}"><Icon name="check" size={15} /></span>
    </span>
  {/if}
</div>
<!-- Saved colours: the five small chips, and the way into custom colour. -->
<div class="saved">
  {#each Array.from({ length: COLOR_SLOTS }) as _, i}
    {#if saved[i]}
      <button
        class="mini"
        data-testid="saved-color"
        data-hex={saved[i]}
        style="background: {saved[i]}"
        title="Saved colour {i + 1}"
        aria-label="Saved colour {i + 1}"
        onclick={() => onPick(`custom:${saved[i]}`)}
      ></button>
    {:else}
      <span class="mini hole" aria-hidden="true"></span>
    {/if}
  {/each}
  <button class="ctoggle" data-testid="custom-toggle" aria-expanded={showCustom} onclick={() => (showCustom = !showCustom)}>
    Custom colour
  </button>
</div>
{#if showCustom}
<label class="crow">
  <span class="clab">Hue</span>
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
  <span class="clab">Dark / light</span>
  <!-- The full range: all the way to black at the left, white at the right. -->
  <input
    class="shade"
    type="range" min="0" max="100" step="1"
    data-testid="custom-light"
    aria-label="Custom color lightness"
    style="--hue: {custHue}; --sat: {custSat}%"
    bind:value={custLight}
    oninput={applyCustom}
  />
</label>
<label class="crow">
  <span class="clab">Soft / vivid</span>
  <input
    class="desat"
    type="range" min="0" max="90" step="1"
    aria-label="Custom color saturation"
    style="--hue: {custHue}"
    bind:value={custSat}
    oninput={applyCustom}
  />
</label>
<button class="save" data-testid="save-color" disabled={!currentHex || alreadySaved} onclick={saveColour}>
  {alreadySaved ? 'Saved' : 'Save colour'}
</button>
{/if}

{#if editing !== null}
  <PatternEditor slot={editing} initial={slots[editing]} onSave={(p) => savePattern(editing!, p)} onClose={() => (editing = null)} />
{/if}

<style>
  .pgrid {
    display: grid;
    grid-template-columns: repeat(5, 34px);
    gap: 8px;
  }
  .pchip {
    width: 34px;
    height: 34px;
    border-radius: calc(34px * var(--btn-corner));
    border: none;
    /* The faintest edge, for the near-white chips on a white menu. */
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.07);
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
  /* An empty slot: a faint tile with a +, not a dashed outline. */
  .pchip.empty {
    background: color-mix(in srgb, var(--app-fg) 6%, transparent);
    box-shadow: none;
    color: var(--app-muted);
  }
  .pchip.empty:hover {
    background: color-mix(in srgb, var(--app-fg) 12%, transparent);
    color: var(--app-fg);
  }
  .slot {
    position: relative;
    display: inline-flex;
  }
  .edit {
    position: absolute;
    right: -5px;
    top: -5px;
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--app-border);
    background: var(--app-panel);
    color: var(--app-fg);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
  }
  .slot:hover .edit,
  .edit:focus-visible {
    opacity: 1;
  }
  .pcheck {
    display: inline-flex;
  }
  .pchip.nz-pat-checker .pcheck,
  .pchip.nz-pat-stripes .pcheck,
  .pchip.nz-pat-dots .pcheck,
  .pchip.nz-pat-stairs .pcheck,
  .pchip.nz-pat-bricks .pcheck,
  .pchip.nz-pat-custom .pcheck {
    background: var(--pat-base);
    border-radius: var(--radius-sm);
    padding: 1px;
  }
  /* Custom colour: hue wheel flattened into a slider, plus shade and saturation. */
  .crow {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .clab {
    font-size: 12px;
    color: var(--app-muted);
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
  /* Black, through the hue at its fullest, to white: the slider's ends are
     the ends of what it can make. */
  .shade {
    background: linear-gradient(
      to right,
      #000,
      hsl(var(--hue), var(--sat, 70%), 50%),
      #fff
    );
  }
  .desat {
    background: linear-gradient(
      to right,
      hsl(var(--hue), 0%, 75%),
      hsl(var(--hue), 90%, 75%)
    );
  }
  /* Chips on one line, the button on its own beneath: side by side they
     overran the 226px menu and the button clipped. */
  .savedrow {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .saved {
    display: flex;
    gap: 6px;
  }
  .mini {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: 1px solid rgba(0, 0, 0, 0.16);
    padding: 0;
    cursor: pointer;
  }
  .mini:hover {
    transform: scale(1.1);
  }
  .mini.hole {
    border: none;
    background: color-mix(in srgb, var(--app-fg) 6%, transparent);
  }
  .ctoggle {
    margin-left: auto;
    font: inherit;
    font-size: 13px;
    padding: 0 10px;
    height: 24px;
    border: none;
    border-radius: var(--btn-radius);
    background: color-mix(in srgb, var(--app-fg) 8%, transparent);
    color: var(--app-fg);
    cursor: pointer;
    white-space: nowrap;
  }
  .ctoggle[aria-expanded='true'] {
    background: var(--app-fg);
    color: var(--app-panel);
  }
  .save {
    width: 100%;
    font: inherit;
    font-size: 14px;
    min-height: 30px;
    padding: 0 10px;
    border: none;
    border-radius: var(--btn-radius);
    background: color-mix(in srgb, var(--app-fg) 9%, transparent);
    color: var(--app-fg);
    cursor: pointer;
    white-space: nowrap;
  }
  .save:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
