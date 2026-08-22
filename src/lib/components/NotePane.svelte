<script lang="ts">
  import { store } from '$lib/store.svelte';
  import { PALETTES, getPalette } from '$lib/palettes';
  import Editor from './Editor.svelte';

  let note = $derived(store.active);
  let pal = $derived(note ? getPalette(note.paletteId) : PALETTES[0]);
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
      <button
        class="icon back"
        data-testid="back-to-list"
        title="Back to notes"
        onclick={() => (store.mobileOpen = false)}
      >←</button>
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
        onclick={() => { if (confirm('Delete this note?')) store.remove(note!.id); }}
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

      <label class="ctl">
        Size
        <input
          type="range" min="12" max="40" step="1"
          data-testid="size-slider"
          value={note.fontSize}
          oninput={(e) => store.update(note!.id, { fontSize: +(e.currentTarget as HTMLInputElement).value })}
        />
        <span class="val" data-testid="size-value">{note.fontSize}</span>
      </label>

      <label class="ctl">
        Opacity
        <input
          type="range" min="0.2" max="1" step="0.05"
          data-testid="opacity-slider"
          value={note.opacity}
          oninput={(e) => store.update(note!.id, { opacity: +(e.currentTarget as HTMLInputElement).value })}
        />
        <span class="val" data-testid="opacity-value">{Math.round(note.opacity * 100)}%</span>
      </label>
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
  /* Back button only exists in the phone single-pane flow. */
  .back {
    display: none;
    font-size: 20px;
    opacity: 0.8;
  }
  @media (max-width: 700px) {
    .back {
      display: block;
    }
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    padding: 7px 12px;
    background: var(--note-header);
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    font-size: 14px;
  }
  .palettes {
    display: flex;
    gap: 4px;
  }
  .chip {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .chip.sel {
    border-color: var(--note-fg);
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--note-fg);
  }
  .ctl input[type='range'] {
    width: 90px;
    accent-color: var(--note-accent);
  }
  .val {
    min-width: 34px;
    opacity: 0.75;
  }
  .editorWrap {
    flex: 1;
    min-height: 0;
  }
</style>
