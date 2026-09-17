<script lang="ts">
  // Paint an 8×8 tile, pick its tint, watch it animate, save it to a slot.
  // Click or drag over cells to set them; the first cell you press decides
  // whether the drag paints or erases, so a stroke never flickers.
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import { hslToHex, hexToHsl } from '$lib/palettes';
  import { TILE, EMPTY_PX, patternSvg, paletteFromTint, type CustomPattern } from '$lib/patterns.svelte';

  let {
    slot,
    initial,
    onSave,
    onClose,
  }: {
    slot: number;
    initial: CustomPattern | null;
    onSave: (p: CustomPattern) => void;
    onClose: () => void;
  } = $props();

  // Read once, deliberately: the editor starts from the slot's current tile
  // and then owns its cells; re-seeding on prop changes would fight the paint.
  const start = untrack(() => initial);
  let cells = $state<boolean[]>(
    (start?.px ?? EMPTY_PX)
      .padEnd(TILE * TILE, '0')
      .split('')
      .map((c) => c === '1')
  );
  const seed = start ? hexToHsl(start.tint) : null;
  let hue = $state(seed?.h ?? 210);
  let sat = $state(seed ? Math.min(90, seed.s) : 60);
  let light = $state(seed ? Math.max(25, Math.min(70, seed.l)) : 45);
  let tint = $derived(hslToHex(hue, sat, light));
  let pal = $derived(paletteFromTint(tint));
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
    onSave({ px, tint });
  }
</script>

<svelte:window onpointerup={release} />

<Modal labelledby="pat-title" {onClose} testid="pattern-editor">
  <div class="card">
    <div class="head">
      <h2 id="pat-title">Pattern {slot + 1}</h2>
      <button class="x" aria-label="Close" onclick={onClose}>✕</button>
    </div>

    <div class="work">
      <div class="grid" role="grid" aria-label="Pattern cells, 8 by 8" style="--tint: {tint}">
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
           title bar will use, so what you see here is what you get. -->
      <div
        class="preview nz-pat-custom"
        data-testid="pat-preview"
        style="--pat-base: {pal.header}; --pat-ink: {pal.ink}; --pat-img: {patternSvg(px, pal.ink)}; --pat-tile-bg: {pal.bg}"
      >
        <span class="bar">Title</span>
        <span class="body"></span>
      </div>
    </div>

    <label class="crow">
      <input class="hue" type="range" min="0" max="360" step="1" aria-label="Tint hue" bind:value={hue} />
    </label>
    <label class="crow">
      <input
        class="shade"
        type="range" min="25" max="70" step="1"
        aria-label="Tint shade"
        style="--hue: {hue}; --sat: {sat}%"
        bind:value={light}
      />
    </label>
    <label class="crow">
      <input class="desat" type="range" min="10" max="90" step="1" aria-label="Tint saturation" style="--hue: {hue}" bind:value={sat} />
    </label>

    <div class="acts">
      <button class="ghost" onclick={clear} disabled={lit === 0}>Clear</button>
      <button class="solid" data-testid="pat-save" onclick={save} disabled={lit === 0}>Save to slot {slot + 1}</button>
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
  .cell {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--app-border);
    border-radius: 2px;
    background: var(--app-panel);
    cursor: crosshair;
  }
  .cell.on {
    background: var(--tint);
    border-color: var(--tint);
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
  .shade {
    background: linear-gradient(to right, hsl(var(--hue), var(--sat, 60%), 25%), hsl(var(--hue), var(--sat, 60%), 70%));
  }
  .desat {
    background: linear-gradient(to right, hsl(var(--hue), 10%, 45%), hsl(var(--hue), 90%, 45%));
  }
  .acts {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
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
