<script lang="ts">
  // Edit one of the five slots: paint an 8x8 tile, choose its background and
  // its dots (the same sliders as the colour picker, black to white), watch
  // it animate, save. No dots painted = a plain colour kept in the slot.
  // Click or drag over cells; the first cell you press decides whether the
  // drag paints or erases, so a stroke never flickers.
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import { hslToHex, hexToHsl } from '$lib/palettes';
  import { TILE, EMPTY_PX, patternSvg, paletteFromSlot, textOn, type CustomPattern } from '$lib/patterns.svelte';

  let {
    slot,
    initial,
    onSave,
    onRemove,
    onClose,
  }: {
    slot: number;
    initial: CustomPattern | null;
    onSave: (p: CustomPattern) => void;
    /** Only for a filled slot: empty it. */
    onRemove?: () => void;
    onClose: () => void;
  } = $props();

  // Read once, deliberately: the editor starts from the slot and then owns
  // its cells and colours; re-seeding on prop changes would fight the paint.
  const start = untrack(() => initial);
  let cells = $state<boolean[]>(
    (start?.px ?? EMPTY_PX)
      .padEnd(TILE * TILE, '0')
      .split('')
      .map((c) => c === '1')
  );
  // Two colours. An older pattern (one tint) starts from what its tint gave.
  const was = start ? paletteFromSlot(start) : null;
  let bg = $state(start?.bg ?? was?.header ?? '#c9dcef');
  let ink = $state(start?.ink ?? was?.ink ?? '#3f6f9e');
  // Which one the sliders move.
  let which = $state<'bg' | 'ink'>(start?.solid ? 'bg' : 'ink');

  const s0 = untrack(() => hexToHsl(start?.solid ? bg : ink)) ?? { h: 210, s: 60, l: 45 };
  let hue = $state(s0.h);
  let sat = $state(Math.min(90, s0.s));
  let light = $state(s0.l);

  function choose(w: 'bg' | 'ink') {
    which = w;
    const h = hexToHsl(w === 'bg' ? bg : ink);
    if (!h) return;
    hue = h.h;
    sat = Math.min(90, h.s);
    light = h.l;
  }
  function apply() {
    const hex = hslToHex(hue, sat, light);
    if (which === 'bg') bg = hex;
    else ink = hex;
  }

  let px = $derived(cells.map((c) => (c ? '1' : '0')).join(''));
  let lit = $derived(cells.filter(Boolean).length);

  let painting: boolean | null = null; // what the current drag sets cells to
  function press(i: number) {
    painting = !cells[i];
    cells[i] = painting;
  }
  function enter(i: number, e: PointerEvent) {
    if (painting === null || !(e.buttons & 1)) return;
    cells[i] = painting;
  }
  function release() {
    painting = null;
  }

  function clear() {
    cells = cells.map(() => false);
  }
  function save() {
    // tint = bg keeps the slot readable by older app versions.
    onSave(lit ? { px, tint: bg, bg, ink } : { px: EMPTY_PX, tint: bg, bg, solid: true });
  }
</script>

<svelte:window onpointerup={release} />

<Modal labelledby="pat-title" {onClose} testid="pattern-editor">
  <div class="card">
    <div class="head">
      <h2 id="pat-title">Slot {slot + 1}</h2>
      <button class="x" aria-label="Close" onclick={onClose}>✕</button>
    </div>

    <div class="work">
      <div class="grid" role="grid" aria-label="Pattern cells, 8 by 8" style="--bg: {bg}; --ink: {ink}">
        {#each cells as on, i}
          <button
            type="button"
            class="cell"
            class:on
            role="gridcell"
            aria-selected={on}
            aria-label="cell {i % TILE + 1},{Math.floor(i / TILE) + 1}"
            data-testid="pat-cell"
            onpointerdown={(e) => {
              e.preventDefault();
              press(i);
            }}
            onpointerenter={(e) => enter(i, e)}
          ></button>
        {/each}
      </div>

      <!-- The preview is the real thing: the same class and variables the
           title bar uses, in exactly these two colours. -->
      <div
        class="preview nz-pat-custom"
        data-testid="pat-preview"
        style="--pat-base: {bg}; --pat-ink: {ink}; --pat-img: {lit ? patternSvg(px, ink) : 'none'}; --pat-tile-bg: {bg}"
      >
        <span class="bar" style="color: {textOn(bg)}">Title</span>
        <span class="body"></span>
      </div>
    </div>

    <!-- Which colour the sliders move. -->
    <div class="seg" role="radiogroup" aria-label="Colour to set">
      <button role="radio" aria-checked={which === 'bg'} class:on={which === 'bg'} data-testid="pat-which-bg" onclick={() => choose('bg')}>
        <span class="sw" style="background: {bg}"></span>Background
      </button>
      <button role="radio" aria-checked={which === 'ink'} class:on={which === 'ink'} data-testid="pat-which-ink" onclick={() => choose('ink')}>
        <span class="sw" style="background: {ink}"></span>Dots
      </button>
    </div>
    <label class="crow">
      <input class="hue" type="range" min="0" max="360" step="1" aria-label="Hue" bind:value={hue} oninput={apply} />
    </label>
    <label class="crow">
      <input
        class="shade"
        type="range" min="0" max="100" step="1"
        aria-label="Lightness, black to white"
        data-testid="pat-light"
        style="--hue: {hue}; --sat: {sat}%"
        bind:value={light}
        oninput={apply}
      />
    </label>
    <label class="crow">
      <input class="desat" type="range" min="0" max="90" step="1" aria-label="Saturation" style="--hue: {hue}" bind:value={sat} oninput={apply} />
    </label>

    <div class="acts">
      {#if onRemove}
        <button class="ghost" data-testid="pat-remove" onclick={onRemove}>Remove</button>
      {/if}
      <span class="grow"></span>
      <button class="ghost" onclick={clear} disabled={lit === 0}>Clear</button>
      <button class="solid" data-testid="pat-save" onclick={save}>Save to slot {slot + 1}</button>
    </div>
  </div>
</Modal>

<style>
  .card {
    width: 360px;
    max-width: 100%;
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-lg);
    padding: 16px 18px 18px;
    box-shadow: 0 14px 44px rgba(0, 0, 0, 0.32);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .x {
    border: none;
    background: transparent;
    color: var(--app-fg);
    opacity: 0.6;
    font-size: 16px;
    cursor: pointer;
  }
  .work {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(8, 22px);
    gap: 2px;
    padding: 6px;
    background: var(--app-bg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-md);
    touch-action: none;
    user-select: none;
  }
  /* The cells in the pattern's own two colours. */
  .cell {
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 2px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 18%, transparent);
    cursor: crosshair;
  }
  .cell.on {
    background: var(--ink);
  }
  .preview {
    flex: 1;
    min-height: 120px;
    border-radius: var(--radius-md);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--app-border);
  }
  .preview .bar {
    padding: 8px 10px;
    font-weight: 700;
    color: #2a2c2e;
  }
  .preview .body {
    flex: 1;
    background: var(--pat-tile-bg);
  }
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
      hsl(0, 70%, 50%),
      hsl(60, 70%, 50%),
      hsl(120, 70%, 50%),
      hsl(180, 70%, 50%),
      hsl(240, 70%, 50%),
      hsl(300, 70%, 50%),
      hsl(360, 70%, 50%)
    );
  }
  /* As in the colour picker: black, through the hue, to white. */
  .shade {
    background: linear-gradient(to right, #000, hsl(var(--hue), var(--sat, 60%), 50%), #fff);
  }
  .desat {
    background: linear-gradient(to right, hsl(var(--hue), 0%, 50%), hsl(var(--hue), 90%, 50%));
  }
  .seg {
    display: flex;
    gap: var(--btn-gap);
    padding: 2px;
    border-radius: calc(var(--btn-radius) + 2px);
    background: color-mix(in srgb, var(--app-fg) 7%, transparent);
  }
  .seg button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: calc(var(--btn) - 4px);
    font: inherit;
    font-size: 15px;
    border: none;
    border-radius: var(--btn-radius);
    background: transparent;
    color: var(--app-fg);
    cursor: pointer;
  }
  .seg button.on {
    background: var(--app-fg);
    color: var(--app-panel);
  }
  .sw {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 40%, transparent);
  }
  .grow {
    flex: 1;
  }
  .acts {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .acts button {
    font: inherit;
    font-size: 15px;
    padding: 8px 14px;
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .ghost {
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-fg);
  }
  .solid {
    border: none;
    background: var(--app-fg);
    color: var(--app-panel);
  }
  .acts button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
