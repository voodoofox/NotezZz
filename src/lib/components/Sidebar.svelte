<script lang="ts">
  import { store } from '$lib/store.svelte';
  import { getPalette } from '$lib/palettes';
  import Settings from './Settings.svelte';
  import Icon from './Icon.svelte';

  let showSettings = $state(false);
  let searching = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);

  function preview(html: string): string {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text || 'Empty note';
  }

  /** Live-filtered list: title + note text, case-insensitive. */
  let visibleNotes = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!searching || !q) return store.notes;
    return store.notes.filter((n) =>
      `${n.title} ${n.contentHtml.replace(/<[^>]+>/g, ' ')}`.toLowerCase().includes(q)
    );
  });

  function toggleSearch() {
    searching = !searching;
    query = '';
  }

  $effect(() => {
    if (searching) searchInput?.focus();
  });
</script>

<aside class="sidebar">
  <div class="head">
    <span class="brand">NotezZz</span>
    <div class="head-actions">
      <button
        class="ico"
        class:on={searching}
        data-testid="search-toggle"
        onclick={toggleSearch}
        title="Search notes"
        aria-label="Search notes"
      ><Icon name="search" size={18} /></button>
      <button class="ico" data-testid="open-settings" onclick={() => (showSettings = true)} title="Settings" aria-label="Settings">
        <Icon name="settings" size={18} />
      </button>
      <button class="new" data-testid="new-note" onclick={() => store.create()} title="New note" aria-label="New note">
        <Icon name="add" size={19} />
      </button>
    </div>
  </div>

  {#if searching}
    <div class="searchrow">
      <input
        class="search"
        data-testid="search-input"
        placeholder="Search notes…"
        bind:this={searchInput}
        bind:value={query}
      />
    </div>
  {/if}

  <div class="list">
    {#each visibleNotes as note (note.id)}
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
          aria-label="Pin note"
          onclick={() => store.update(note.id, { pinned: !note.pinned })}
        ><Icon name="pin" size={16} /></button>
      </div>
    {/each}

    {#if store.loaded && store.notes.length === 0}
      <p class="empty" data-testid="empty-state">No notes yet.<br />Hit + to create one.</p>
    {/if}
  </div>

  <!-- Sync is invisible when healthy; only problems earn screen space
       (full status always available in Settings -> Diagnostics). -->
  {#if store.syncStatus === 'error'}
    <div class="sync-err" data-testid="sync-error" title={store.syncError}>
      {store.syncError || 'Sync failed.'}
      <button class="reconnect" data-testid="reconnect" onclick={() => store.reconnect()}>
        Reconnect
      </button>
    </div>
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
    border-radius: var(--radius-sm);
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
    border-color: var(--app-fg);
  }
  .ico.on {
    background: var(--app-fg);
    color: var(--app-panel);
    border-color: var(--app-fg);
  }
  .searchrow {
    padding: 8px 10px 4px;
  }
  .search {
    width: 100%;
    font: inherit;
    font-size: 15px;
    padding: 7px 11px;
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    background: var(--app-bg);
    color: var(--app-fg);
    outline: none;
  }
  .search:focus {
    border-color: var(--app-fg);
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
    border-radius: var(--radius-sm);
    color: var(--app-fg);
  }
  .item:hover {
    background: var(--app-bg);
  }
  /* Monochrome selection: full inversion — light theme gets a dark card,
     dark theme gets a white card with dark text. */
  .item.active {
    background: var(--app-fg);
    border-color: var(--app-fg);
    color: var(--app-bg);
  }
  .item.active .pick,
  .item.active .pin {
    color: var(--app-bg);
  }
  .item.active:hover {
    background: var(--app-fg);
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
    border-radius: var(--radius-sm);
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
    color: var(--app-fg);
    cursor: pointer;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    opacity: 0.3;
    display: inline-flex;
    align-items: center;
  }
  .pin:hover {
    opacity: 0.7;
  }
  .pin.on {
    opacity: 1;
  }
  .empty {
    color: var(--app-muted);
    text-align: center;
    font-size: 15px;
    margin-top: 30px;
    line-height: 1.5;
  }
  .sync-err {
    border-top: 1px solid var(--app-border);
    padding: 8px 12px 10px;
    font-size: 12px;
    color: var(--app-danger);
    word-break: break-word;
    max-height: 110px;
    overflow: auto;
    flex-shrink: 0;
  }
  .reconnect {
    display: block;
    margin-top: 6px;
    font: inherit;
    font-size: 13px;
    padding: 5px 12px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--app-fg);
    color: var(--app-panel);
    cursor: pointer;
  }
</style>
