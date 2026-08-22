<script lang="ts">
  import { pushState } from '$app/navigation';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { PALETTES, getPalette } from '$lib/palettes';
  import Editor from './Editor.svelte';

  let note = $derived(store.active);
  let pal = $derived(note ? getPalette(note.paletteId) : PALETTES[0]);
  const desktop = isTauri();

  function deleteNote() {
    if (!note || !confirm('Delete this note?')) return;
    const wasFullscreen = store.mobileOpen;
    void store.remove(note.id);
    if (wasFullscreen) history.back(); // drop the fullscreen history entry
  }
</script>

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
          onclick={() => history.back()}
        >←</button>
      {:else}
        <button
          class="icon mob"
          data-testid="note-fullscreen"
          title="Expand note fullscreen"
          onclick={() => pushState('', { fs: true })}
        >⛶</button>
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
        onclick={() => store.update(note!.id, { pinned: !note!.pinned })}
      >📌</button>
      <button
        class="icon danger"
        data-testid="note-delete"
        title="Delete note"
        onclick={deleteNote}
      >🗑</button>
    </div>

    <div class="controls">
      <div class="palettes">
        {#each PALETTES as p}
          <button
            class="chip"
            data-testid="palette-chip"
            data-palette={p.id}
            class:sel={p.id === note.paletteId}
            style="background: {p.bg}"
            title={p.name}
            aria-label={p.name}
            onclick={() => store.update(note!.id, { paletteId: p.id })}
          ></button>
        {/each}
      </div>

      <details class="tools">
        <summary data-testid="tools-toggle" title="Text size{desktop ? ' & sticker opacity' : ''}">
          Aa·{note.fontSize}
        </summary>
        <div class="panel">
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
      </details>
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
    font-size: 16px;
    padding: 4px 7px;
    border-radius: 6px;
    cursor: pointer;
    opacity: 0.55;
  }
  .icon:hover {
    background: rgba(0, 0, 0, 0.08);
    opacity: 1;
  }
  .icon.on {
    opacity: 1;
    background: rgba(0, 0, 0, 0.12);
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
  .controls {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    background: var(--note-header);
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    font-size: 14px;
  }
  .palettes {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 2px;
    flex: 1;
    min-width: 0;
  }
  .palettes::-webkit-scrollbar {
    display: none;
  }
  .chip {
    width: 20px;
    height: 20px;
    min-width: 20px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.14);
    cursor: pointer;
    padding: 0;
    transition: transform 0.1s;
  }
  .chip:hover {
    transform: scale(1.15);
  }
  .chip.sel {
    outline: 2px solid var(--note-fg);
    outline-offset: 1px;
  }
  .tools {
    flex-shrink: 0;
  }
  .tools summary {
    list-style: none;
    cursor: pointer;
    padding: 4px 10px;
    border-radius: 7px;
    font-size: 14px;
    color: var(--note-fg);
    background: rgba(0, 0, 0, 0.06);
    user-select: none;
    white-space: nowrap;
  }
  .tools summary::-webkit-details-marker {
    display: none;
  }
  .tools[open] summary {
    background: var(--note-accent);
    color: #fff;
  }
  .panel {
    position: absolute;
    right: 10px;
    top: calc(100% + 4px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
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
