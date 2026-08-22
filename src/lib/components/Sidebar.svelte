<script lang="ts">
  import { store } from '$lib/store.svelte';
  import { getPalette } from '$lib/palettes';
  import Settings from './Settings.svelte';

  let showSettings = $state(false);

  function preview(html: string): string {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || 'Empty note';
  }
</script>

<aside class="sidebar">
  <div class="head">
    <span class="brand">NotezZz</span>
    <div class="head-actions">
      <button class="ico" data-testid="open-settings" onclick={() => (showSettings = true)} title="Settings">⚙</button>
      <button class="new" data-testid="new-note" onclick={() => store.create()} title="New note">＋</button>
    </div>
  </div>

  <div class="list">
    {#each store.notes as note (note.id)}
      {@const pal = getPalette(note.paletteId)}
      <div class="item" data-testid="note-item" class:active={note.id === store.activeId} style="--swatch: {pal.bg}">
        <button class="pick" data-testid="note-pick" onclick={() => (store.activeId = note.id)}>
          <span class="swatch" data-testid="note-swatch" style="background: {pal.bg}"></span>
          <span class="title" data-testid="note-title">{note.title || preview(note.contentHtml)}</span>
        </button>
        <button
          class="pin"
          data-testid="note-pin"
          class:on={note.pinned}
          title={note.pinned ? 'Pinned to desktop (click to unpin)' : 'Pin to desktop as always-on-top sticker'}
          onclick={() => store.update(note.id, { pinned: !note.pinned })}
        >📌</button>
      </div>
    {/each}

    {#if store.loaded && store.notes.length === 0}
      <p class="empty" data-testid="empty-state">No notes yet.<br />Hit ＋ to create one.</p>
    {/if}
  </div>

  <div class="sync" data-testid="sync-status" data-status={store.syncStatus}>
    <span class="dot"></span>
    <span class="label">
      {#if store.syncStatus === 'local'}Local only
      {:else if store.syncStatus === 'loading'}Loading…
      {:else if store.syncStatus === 'saving'}Saving…
      {:else if store.syncStatus === 'synced'}Synced to Drive
      {:else if store.syncStatus === 'error'}Sync error{/if}
    </span>
  </div>
  {#if store.syncStatus === 'error' && store.syncError}
    <div class="sync-err" data-testid="sync-error" title={store.syncError}>{store.syncError}</div>
  {/if}
</aside>

{#if showSettings}
  <Settings onClose={() => (showSettings = false)} />
{/if}

<style>
  .sidebar {
    width: 230px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--app-panel);
    border-right: 1px solid var(--app-border);
    height: 100%;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--app-border);
  }
  .brand {
    font-weight: 700;
    font-size: 20px;
    letter-spacing: 0.3px;
  }
  .head-actions {
    display: flex;
    gap: 6px;
  }
  .new,
  .ico {
    width: 28px;
    height: 28px;
    font-size: 18px;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    background: var(--app-bg);
    color: var(--app-fg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .ico {
    font-size: 15px;
  }
  .new:hover,
  .ico:hover {
    border-color: var(--app-accent);
    color: var(--app-accent);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    width: 100%;
    margin-bottom: 3px;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--app-fg);
  }
  .item:hover {
    background: var(--app-bg);
  }
  .item.active {
    background: var(--app-bg);
    border-color: var(--app-accent);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: 8px 4px 8px 9px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    flex-shrink: 0;
    background: var(--swatch);
    border: 1px solid rgba(0, 0, 0, 0.15);
  }
  .title {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pin {
    border: none;
    background: transparent;
    font-size: 13px;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 6px;
    filter: grayscale(1);
    opacity: 0.35;
  }
  .pin:hover {
    opacity: 0.8;
  }
  .pin.on {
    filter: none;
    opacity: 1;
  }
  .empty {
    color: var(--app-muted);
    text-align: center;
    font-size: 15px;
    margin-top: 30px;
    line-height: 1.5;
  }
  .sync {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 12px;
    border-top: 1px solid var(--app-border);
    font-size: 13px;
    color: var(--app-muted);
    flex-shrink: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--app-muted);
    flex-shrink: 0;
  }
  .sync[data-status='synced'] .dot {
    background: #2ea043;
  }
  .sync[data-status='saving'] .dot,
  .sync[data-status='loading'] .dot {
    background: #d29922;
  }
  .sync[data-status='error'] .dot {
    background: #e0245e;
  }
  .sync-err {
    padding: 0 12px 10px;
    font-size: 12px;
    color: #e0245e;
    word-break: break-word;
    max-height: 80px;
    overflow: auto;
    flex-shrink: 0;
  }
</style>
