<script lang="ts">
  // The note colour picker: ten palettes, five pixel patterns, five slots of
  // your own (a colour or a pattern each), and a custom colour from three
  // sliders. Every one of them can be restyled in the same editor: tap the
  // one in use (or its pencil). The picker's own go back to their originals
  // with Reset. One component, used by the note pane and by the sticky
  // window's title bar, so the two can never drift apart.
  import { PALETTES, PATTERNS, builtinStart, getPalette, hslToHex, hexToHsl, type Palette } from '$lib/palettes';
  import {
    EMPTY_PX,
    PATTERN_SLOTS,
    customPatternId,
    getCustomPattern,
    getPaletteEdit,
    patternSvg,
    paletteFromSlot,
    type CustomPattern,
  } from '$lib/patterns.svelte';
  import { store } from '$lib/store.svelte';
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import PatternEditor from './PatternEditor.svelte';

  let { paletteId, onPick }: { paletteId: string; onPick: (id: string) => void } = $props();

  let pal = $derived(getPalette(paletteId));
  let isCustom = $derived(!!paletteId?.startsWith('custom:'));

  // Inline custom colour: hue + shade + saturation apply instantly — no native
  // colour-dialog chain. Read once, deliberately: the sliders start where the
  // note is and then own their values; re-seeding on every prop change would
  // fight the drag.
  const seed = untrack(() => (paletteId?.startsWith('custom:') ? hexToHsl(paletteId.slice(7)) : null));
  let custHue = $state(seed?.h ?? 45);
  let custSat = $state(seed ? Math.min(90, seed.s) : 70);
  let custLight = $state(seed ? Math.max(0, Math.min(100, seed.l)) : 82);

  function applyCustom() {
    onPick(`custom:${hslToHex(custHue, custSat, custLight)}`);
  }

  // ---- the five slots: a colour or a pattern each; empty opens the editor ---
  // The registry (patterns.ts) follows settings; reading settings here makes
  // this re-render when a slot changes.
  let slots = $derived(
    Array.from({ length: PATTERN_SLOTS }, (_, i) => {
      void store.settings.customPatterns;
      return getCustomPattern(i);
    })
  );
  let editing = $state<number | null>(null);

  /** What picking a slot gives the note. */
  const slotId = (p: CustomPattern, i: number) => (p.solid ? `custom:${p.bg ?? p.tint}` : customPatternId(i));
  /** Pick it; pick it again (it's the note's already) to edit it. */
  function pickSlot(p: CustomPattern, i: number) {
    if (paletteId === slotId(p, i)) editing = i;
    else onPick(slotId(p, i));
  }
  function chipStyle(p: CustomPattern) {
    const t = paletteFromSlot(p);
    return `--pat-base: ${t.header}; --pat-ink: ${t.inkStrong}; --pat-img: ${patternSvg(p.px, t.inkStrong)}`;
  }
  function writeSlots(list: (CustomPattern | null)[]) {
    void store.saveSettings({ customPatterns: list });
  }
  const allSlots = () => Array.from({ length: PATTERN_SLOTS }, (_, k) => store.settings.customPatterns?.[k] ?? null);
  function savePattern(i: number, p: CustomPattern) {
    const list = allSlots();
    list[i] = p;
    writeSlots(list);
    editing = null;
    onPick(slotId(p, i));
  }
  function removeSlot(i: number) {
    const list = allSlots();
    list[i] = null;
    writeSlots(list);
    editing = null;
  }

  // ---- the picker's own colours and patterns, restyled like a slot ----
  const BUILTINS: Palette[] = [...PALETTES, ...PATTERNS];
  let editingBuiltin = $state<Palette | null>(null);
  /** Pick it; pick it again (it's the note's already) to restyle it. */
  function pickBuiltin(p: Palette) {
    if (paletteId === p.id) editingBuiltin = p;
    else onPick(p.id);
  }
  /** A chip as it looks now: restyled, or the original. */
  function builtinChip(id: string): string {
    const e = getPalette(id);
    if (!e.pattern) return `background: ${e.bg}`;
    return `--pat-base: ${e.header}; --pat-ink: ${e.inkStrong ?? e.fg}${e.patternImage ? `; --pat-img: ${e.patternImage}` : ''}`;
  }
  function saveEdit(id: string, p: CustomPattern) {
    void store.saveSettings({ paletteEdits: { ...(store.settings.paletteEdits ?? {}), [id]: p } });
    editingBuiltin = null;
    onPick(id);
  }
  function resetEdit(id: string) {
    const rest = { ...(store.settings.paletteEdits ?? {}) };
    delete rest[id];
    void store.saveSettings({ paletteEdits: rest });
    editingBuiltin = null;
  }

  // The note's custom colour, kept in the first free slot.
  let currentHex = $derived(isCustom ? paletteId.slice(7) : null);
  let alreadySaved = $derived(!!currentHex && slots.some((p) => p?.solid && (p.bg ?? p.tint) === currentHex));
  let freeSlot = $derived(slots.indexOf(null));
  function saveColour() {
    if (!currentHex || alreadySaved || freeSlot < 0) return;
    const list = allSlots();
    list[freeSlot] = { px: EMPTY_PX, tint: currentHex, bg: currentHex, solid: true };
    writeSlots(list);
  }
</script>

<div class="pgrid">
  <!-- The picker's own: ten colours, then five patterns. Each as restyled. -->
  {#each BUILTINS as p (p.id)}
    {@const e = getPalette(p.id)}
    <span class="slot">
      <button
        class="pchip {e.pattern ? `nz-pat-${e.pattern}` : ''}"
        data-testid="palette-chip"
        data-palette={p.id}
        data-edited={getPaletteEdit(p.id) ? '' : undefined}
        style={builtinChip(p.id)}
        title={p.name}
        aria-label={p.name}
        onclick={() => pickBuiltin(p)}
      >
        {#if paletteId === p.id}
          <span class="pcheck" style="color: {e.fg}"><Icon name="check" size={15} /></span>
        {/if}
      </button>
      <button class="edit" data-testid="palette-edit" title="Restyle {p.name}" aria-label="Restyle {p.name}" onclick={() => (editingBuiltin = p)}>
        <Icon name="draw" size={11} />
      </button>
    </span>
  {/each}
  <!-- Fourth row: your five slots, a colour or a pattern each. Tap to use;
       tap the one in use (or its pencil) to edit; + makes a new one. -->
  {#each slots as p, i}
    {#if p}
      <span class="slot">
        {#if p.solid}
          <button
            class="pchip"
            data-testid="saved-color"
            data-hex={p.bg ?? p.tint}
            style="background: {p.bg ?? p.tint}"
            title="Colour {i + 1}"
            aria-label="Colour {i + 1}"
            onclick={() => pickSlot(p, i)}
          >
            {#if paletteId === slotId(p, i)}
              <span class="pcheck" style="color: {paletteFromSlot({ ...p, ink: p.bg ?? p.tint }).fg}"><Icon name="check" size={15} /></span>
            {/if}
          </button>
        {:else}
          <button
            class="pchip nz-pat-custom"
            data-testid="palette-chip"
            data-palette={customPatternId(i)}
            style={chipStyle(p)}
            title="Pattern {i + 1}"
            aria-label="Pattern {i + 1}"
            onclick={() => pickSlot(p, i)}
          >
            {#if paletteId === customPatternId(i)}
              <span class="pcheck" style="color: {paletteFromSlot(p).fg}"><Icon name="check" size={15} /></span>
            {/if}
          </button>
        {/if}
        <button class="edit" data-testid="pattern-edit" title="Edit slot {i + 1}" aria-label="Edit slot {i + 1}" onclick={() => (editing = i)}>
          <Icon name="draw" size={11} />
        </button>
      </span>
    {:else}
      <button
        class="pchip empty"
        data-testid="pattern-empty"
        title="New colour or pattern in slot {i + 1}"
        aria-label="New colour or pattern in slot {i + 1}"
        onclick={() => (editing = i)}
      >
        <Icon name="add" size={15} />
      </button>
    {/if}
  {/each}
  {#if isCustom && !alreadySaved}
    <span class="pchip current" style="background: {pal.bg}">
      <span class="pcheck" style="color: {pal.fg}"><Icon name="check" size={15} /></span>
    </span>
  {/if}
</div>
<!-- A custom colour: hue, dark to light, soft to vivid (the tracks say which). -->
<label class="crow">
  <input
    class="hue"
    type="range" min="0" max="360" step="1"
    data-testid="custom-hue"
    aria-label="Custom colour hue"
    bind:value={custHue}
    oninput={applyCustom}
  />
</label>
<label class="crow">
  <!-- The full range: all the way to black at the left, white at the right. -->
  <input
    class="shade"
    type="range" min="0" max="100" step="1"
    data-testid="custom-light"
    aria-label="Custom colour lightness"
    style="--hue: {custHue}; --sat: {custSat}%"
    bind:value={custLight}
    oninput={applyCustom}
  />
</label>
<label class="crow">
  <input
    class="desat"
    type="range" min="0" max="90" step="1"
    aria-label="Custom colour saturation"
    style="--hue: {custHue}"
    bind:value={custSat}
    oninput={applyCustom}
  />
</label>
<button class="save" data-testid="save-color" disabled={!currentHex || alreadySaved || freeSlot < 0} onclick={saveColour}>
  {alreadySaved ? 'Saved' : freeSlot < 0 ? 'Slots full' : 'Save colour'}
</button>

{#if editing !== null}
  <PatternEditor
    slot={editing}
    initial={slots[editing]}
    onSave={(p) => savePattern(editing!, p)}
    onRemove={slots[editing] ? () => removeSlot(editing!) : undefined}
    onClose={() => (editing = null)}
  />
{/if}
{#if editingBuiltin}
  {@const base = editingBuiltin}
  <PatternEditor
    name={base.name}
    builtinPattern={base.pattern}
    initial={getPaletteEdit(base.id) ?? builtinStart(base)}
    onSave={(p) => saveEdit(base.id, p)}
    onRemove={getPaletteEdit(base.id) ? () => resetEdit(base.id) : undefined}
    onClose={() => (editingBuiltin = null)}
  />
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
