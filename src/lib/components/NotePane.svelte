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
  let palWrap = $state<HTMLDivElement | null>(null);
  let sizeWrapEl = $state<HTMLDivElement | null>(null);

  function togglePop(which: 'pal' | 'size') {
    if (openPop === which) return void (openPop = null);
    const anchor = which === 'pal' ? palWrap : sizeWrapEl;
    if (anchor) popStyle = popoverStyle(anchor, which === 'pal' ? 216 : 280);
    openPop = which;
  }

  function closePopsOutside(e: PointerEvent) {
    if (!openPop) return;
    const t = e.target as Node;
    if (!palWrap?.contains(t) && !sizeWrapEl?.contains(t)) openPop = null;
  }

  let isCustom = $derived(note?.paletteId.startsWith('custom:') ?? false);
  let customHex = $derived(isCustom ? note!.paletteId.slice(7) : '#fbfaf6');

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

    {#snippet noteTools()}
      <div class="tb-wrap" bind:this={palWrap}>
        <button
          class="tb-btn"
          class:active={openPop === 'pal'}
          data-testid="note-color"
          title="Note color"
          aria-label="Note color"
          onclick={() => togglePop('pal')}
        ><Icon name="palette" /></button>
        {#if openPop === 'pal'}
          <div class="pop palmenu" style={popStyle}>
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
            <label class="pchip picker" title="Custom color" aria-label="Custom color">
              <input
                type="color"
                data-testid="custom-color"
                value={customHex}
                oninput={(e) =>
                  store.update(note!.id, {
                    paletteId: `custom:${(e.currentTarget as HTMLInputElement).value}`,
                  })}
              />
              {#if isCustom}
                <span class="pcheck" style="color: {pal.fg}"><Icon name="check" size={15} /></span>
              {/if}
            </label>
          </div>
        {/if}
      </div>

      <div class="tb-wrap" bind:this={sizeWrapEl}>
        <button
          class="tb-btn"
          class:active={openPop === 'size'}
          data-testid="tools-toggle"
          title="Base text size{desktop ? ' & sticker opacity' : ''}"
          onclick={() => togglePop('size')}
        >Aa·{note.fontSize}</button>
        {#if openPop === 'size'}
          <div class="pop panel" style={popStyle}>
            <label class="ctl">
              <span>Text size</span>
              <input
                type="range" min="12" max="40" step="1"
                data-testid="size-slider"
                value={note.fontSize}
                oninput={(e) => store.update(note!.id, { fontSize: +(e.currentTarget as HTMLInputElement).value })}
              />
              <span class="val" data-testid="size-value">{note.fontSize}</span>
            </label>
            {#if desktop}
              <label class="ctl">
                <span>Sticker opacity</span>
                <input
                  type="range" min="0.2" max="1" step="0.05"
                  data-testid="opacity-slider"
                  value={note.opacity}
                  oninput={(e) => store.update(note!.id, { opacity: +(e.currentTarget as HTMLInputElement).value })}
                />
                <span class="val" data-testid="opacity-value">{Math.round(note.opacity * 100)}%</span>
              </label>
            {/if}
          </div>
        {/if}
      </div>
    {/snippet}

    <div class="editorWrap">
      {#key note.id}
        <Editor
          html={note.contentHtml}
          baseSize={note.fontSize}
          onChange={(html) => store.update(note!.id, { contentHtml: html })}
          extra={noteTools}
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
    padding: 6px 8px;
    border-radius: 7px;
    cursor: pointer;
    opacity: 0.55;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon:hover {
    background: rgba(0, 0, 0, 0.08);
    opacity: 1;
  }
  .icon.on {
    opacity: 1;
    background: rgba(0, 0, 0, 0.1);
  }
  /* Fullscreen/back toggles only exist in the phone layout. */
  .mob {
    display: none;
    font-size: 19px;
    opacity: 0.8;
  }
  @media (max-width: 700px) {
    .mob {
      display: block;
    }
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
    display: grid;
    grid-template-columns: repeat(5, 34px);
    gap: 8px;
    padding: 12px;
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
  .pcheck {
    display: inline-flex;
  }
  .pchip.picker {
    background: conic-gradient(#e0245e, #f2b705, #2fa579, #2f8fe0, #8b5cf6, #e0245e);
    overflow: hidden;
  }
  .pchip.picker input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    min-width: 240px;
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .ctl > span:first-child {
    width: 92px;
    flex-shrink: 0;
  }
  .ctl input[type='range'] {
    flex: 1;
    accent-color: var(--app-accent);
  }
  .val {
    min-width: 36px;
    text-align: right;
    opacity: 0.75;
  }
  .editorWrap {
    flex: 1;
    min-height: 0;
  }
</style>
