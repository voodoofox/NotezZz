<script lang="ts">
  import { pushState } from '$app/navigation';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { PALETTES, getPalette } from '$lib/palettes';
  import Editor from './Editor.svelte';
  import Icon from './Icon.svelte';

  import { popoverStyle } from '$lib/popover';

  let note = $derived(store.active);
  let pal = $derived(note ? getPalette(note.paletteId) : PALETTES[0]);
  const desktop = isTauri();

  // Toolbar popovers (note color / base text size), fixed-positioned so the
  // toolbar's overflow can't clip them; any outside tap closes them.
  let openPop = $state<'pal' | 'size' | null>(null);
  let popStyle = $state('');
  let palWrap = $state<HTMLElement | null>(null);
  let sizeWrapEl = $state<HTMLElement | null>(null);

  function togglePop(which: 'pal' | 'size') {
    if (openPop === which) return void (openPop = null);
    const anchor = which === 'pal' ? palWrap : sizeWrapEl;
    if (anchor) popStyle = popoverStyle(anchor, which === 'pal' ? 226 : 270);
    openPop = which;
  }

  function closePopsOutside(e: PointerEvent) {
    if (!openPop) return;
    const t = e.target as Node;
    if (!palWrap?.contains(t) && !sizeWrapEl?.contains(t)) openPop = null;
  }

  let isCustom = $derived(note?.paletteId.startsWith('custom:') ?? false);

  // Inline custom color: hue + shade sliders apply instantly — no native
  // color-dialog chain.
  let custHue = $state(45);
  let custLight = $state(82);

  function hslToHex(h: number, s: number, l: number): string {
    const a = (s * Math.min(l, 100 - l)) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const c = (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) / 100;
      return Math.round(255 * c)
        .toString(16)
        .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function applyCustom() {
    if (note) store.update(note.id, { paletteId: `custom:${hslToHex(custHue, 70, custLight)}` });
  }

  function deleteNote() {
    if (!note || !confirm('Delete this note?')) return;
    const wasFullscreen = store.mobileOpen;
    void store.remove(note.id);
    if (wasFullscreen) history.back(); // drop the fullscreen history entry
  }
</script>

<svelte:window onpointerdown={closePopsOutside} />

{#if note}
  <section
    class="pane"
    data-testid="note-pane"
    data-palette={note.paletteId}
    style="
      --note-bg: {pal.bg};
      --note-header: {pal.header};
      --note-fg: {pal.fg};
      --note-accent: {pal.accent};
    "
  >
    <div class="topbar">
      {#if store.mobileOpen}
        <button
          class="icon mob"
          data-testid="exit-fullscreen"
          title="Back to split view"
          aria-label="Back to split view"
          onclick={() => history.back()}
        ><Icon name="back" /></button>
      {:else}
        <button
          class="icon mob"
          data-testid="note-fullscreen"
          title="Expand note fullscreen"
          aria-label="Expand note fullscreen"
          onclick={() => pushState('', { fs: true })}
        ><Icon name="fullscreen" /></button>
      {/if}
      <input
        class="title"
        data-testid="title-input"
        placeholder="Title…"
        value={note.title}
        oninput={(e) => store.update(note!.id, { title: (e.currentTarget as HTMLInputElement).value })}
      />
      <span class="twrap" bind:this={palWrap}>
        <button
          class="icon"
          class:on={openPop === 'pal'}
          data-testid="note-color"
          title="Note color"
          aria-label="Note color"
          onclick={() => togglePop('pal')}
        ><Icon name="palette" /></button>
        {#if openPop === 'pal'}
          <div class="pop palmenu" style={popStyle}>
            <div class="pgrid">
              {#each PALETTES as p}
                <button
                  class="pchip"
                  data-testid="palette-chip"
                  data-palette={p.id}
                  style="background: {p.bg}"
                  title={p.name}
                  aria-label={p.name}
                  onclick={() => {
                    store.update(note!.id, { paletteId: p.id });
                    openPop = null;
                  }}
                >
                  {#if note.paletteId === p.id}
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
                style="--hue: {custHue}"
                bind:value={custLight}
                oninput={applyCustom}
              />
            </label>
          </div>
        {/if}
      </span>

      <span class="twrap" bind:this={sizeWrapEl}>
        <button
          class="icon aa"
          class:on={openPop === 'size'}
          data-testid="tools-toggle"
          title="Base text size{desktop ? ' & sticker opacity' : ''}"
          onclick={() => togglePop('size')}
        >Aa·{note.fontSize}</button>
        {#if openPop === 'size'}
          <div class="pop panel" style={popStyle}>
            <div class="ctl">
              <div class="crowhead">
                <span>Text size</span>
                <span class="val" data-testid="size-value">{note.fontSize}</span>
              </div>
              <input
                type="range" min="12" max="40" step="1"
                data-testid="size-slider"
                value={note.fontSize}
                oninput={(e) => store.update(note!.id, { fontSize: +(e.currentTarget as HTMLInputElement).value })}
              />
            </div>
            {#if desktop}
              <div class="ctl">
                <div class="crowhead">
                  <span>Sticker opacity</span>
                  <span class="val" data-testid="opacity-value">{Math.round(note.opacity * 100)}%</span>
                </div>
                <input
                  type="range" min="0.2" max="1" step="0.05"
                  data-testid="opacity-slider"
                  value={note.opacity}
                  oninput={(e) => store.update(note!.id, { opacity: +(e.currentTarget as HTMLInputElement).value })}
                />
              </div>
            {/if}
          </div>
        {/if}
      </span>

      <button
        class="icon"
        data-testid="pane-pin"
        class:on={note.pinned}
        title={note.pinned ? 'Unpin from desktop' : 'Pin as desktop sticky'}
        aria-label="Pin note"
        onclick={() => store.update(note!.id, { pinned: !note!.pinned })}
      ><Icon name="pin" /></button>
      <button
        class="icon danger"
        data-testid="note-delete"
        title="Delete note"
        aria-label="Delete note"
        onclick={deleteNote}
      ><Icon name="trash" /></button>
    </div>

    <div class="editorWrap">
      {#key note.id}
        <Editor
          html={note.contentHtml}
          baseSize={note.fontSize}
          onChange={(html) => store.update(note!.id, { contentHtml: html })}
        />
      {/key}
    </div>
  </section>
{:else}
  <section class="pane empty" data-testid="pane-empty">
    <p>No note selected.</p>
    <button class="bignew" data-testid="empty-new" onclick={() => store.create()}>＋ New note</button>
  </section>
{/if}

<style>
  .pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--note-bg);
    color: var(--note-fg);
    height: 100%;
  }
  .pane.empty {
    flex-direction: column;
    gap: 14px;
    align-items: center;
    justify-content: center;
    color: var(--app-muted);
    background: var(--app-bg);
  }
  .bignew {
    font: inherit;
    font-size: 17px;
    padding: 9px 18px;
    border: none;
    border-radius: 9px;
    background: var(--app-accent);
    color: #fff;
    cursor: pointer;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: var(--note-header);
  }
  .title {
    flex: 1;
    font-size: 20px;
    font-weight: 700;
    color: var(--note-fg);
    background: transparent;
    border: none;
    outline: none;
    padding: 4px 2px;
  }
  .title::placeholder {
    color: var(--note-fg);
    opacity: 0.45;
  }
  .icon {
    border: none;
    background: transparent;
    color: var(--note-fg);
    height: 34px;
    min-width: 34px;
    padding: 0 8px;
    border-radius: 7px;
    cursor: pointer;
    opacity: 0.55;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .icon:hover {
    background: rgba(0, 0, 0, 0.08);
    opacity: 1;
  }
  /* Monochrome active state: invert the note's colors. */
  .icon.on {
    opacity: 1;
    background: var(--note-fg);
    color: var(--note-bg);
  }
  /* Fullscreen/back toggles only exist in the phone layout. */
  .mob {
    display: none;
    opacity: 0.8;
  }
  @media (max-width: 700px) {
    .mob {
      display: inline-flex;
    }
  }
  .twrap {
    position: relative;
    display: inline-flex;
  }
  /* Popovers are fixed-positioned via inline style (see popoverStyle). */
  .pop {
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
  }
  .palmenu {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    width: 226px;
  }
  .pgrid {
    display: grid;
    grid-template-columns: repeat(5, 34px);
    gap: 8px;
  }
  .pchip {
    width: 34px;
    height: 34px;
    border-radius: 9px;
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
  .pcheck {
    display: inline-flex;
  }
  /* Inline custom color: hue wheel flattened into a slider + shade. */
  .crow {
    display: block;
  }
  .crow input[type='range'] {
    width: 100%;
    height: 22px;
    appearance: none;
    -webkit-appearance: none;
    border-radius: 11px;
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
      hsl(var(--hue), 70%, 30%),
      hsl(var(--hue), 70%, 94%)
    );
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px 16px;
    width: 270px;
  }
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .crowhead {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    color: var(--app-muted);
  }
  .ctl input[type='range'] {
    width: 100%;
    accent-color: var(--app-fg);
  }
  .icon.aa {
    font-size: 14px;
    white-space: nowrap;
    width: auto;
    padding: 0 10px;
  }
  .editorWrap {
    flex: 1;
    min-height: 0;
  }
</style>
