<script lang="ts">
  import { store } from '$lib/store.svelte';
  import { getPalette } from '$lib/palettes';
  import Settings from './Settings.svelte';
  import Icon from './Icon.svelte';

  let showSettings = $state(false);
  let searching = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);

  /** List label: real text if present, else describe the media it holds —
   *  a note containing only a sketch/photo/memo is not an "empty note". */
  function preview(html: string): string {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) return text;
    if (/<audio/i.test(html)) return 'Voice note';
    if (/<img[^>]+data:image\/svg/i.test(html)) return 'Drawing';
    if (/<img/i.test(html)) return 'Image';
    return 'Empty note';
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

  // ---- drag to rearrange -----------------------------------------------
  // The colour bar doubles as the grab handle: it is already the note's
  // identity in the list, and it keeps the whole row tappable for opening.
  let dragId = $state<string | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  function startDrag(e: PointerEvent, id: string) {
    if (searching) return; // order is meaningless while filtered
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragId = id;
  }

  function moveDrag(e: PointerEvent) {
    if (!dragId || !listEl) return;
    const rows = [...listEl.querySelectorAll<HTMLElement>('[data-testid="note-item"]')];
    const from = store.notes.findIndex((n) => n.id === dragId);
    if (from === -1) return;
    // Drop where the pointer sits relative to each row's midpoint.
    let to = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return e.clientY < b.top + b.height / 2;
    });
    if (to === -1) to = rows.length - 1;
    else if (to > from) to -= 1;
    if (to !== from && to >= 0) {
      const next = [...store.notes];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      store.notes = next; // live feedback; committed on release
    }
  }

  function endDrag() {
    if (!dragId) return;
    dragId = null;
    void store.reorder(store.notes.map((n) => n.id));
  }

  let syncing = $state(false);
  async function syncNow() {
    syncing = true;
    try {
      await store.syncNow();
    } finally {
      // Brief minimum spin so a fast sync still reads as "it did something".
      setTimeout(() => (syncing = false), 400);
    }
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
        class:busy={syncing}
        data-testid="sync-now"
        onclick={syncNow}
        title="Sync now"
        aria-label="Sync now"
      ><Icon name="sync" size={17} /></button>
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

  <div
    class="list"
    role="list"
    bind:this={listEl}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  >
    {#if !store.loaded}
      <div class="loadrow" data-testid="list-loading">
        <span class="spin"></span> Loading notes…
      </div>
    {/if}
    {#each visibleNotes as note (note.id)}
      {@const pal = getPalette(note.paletteId)}
      <div
        class="item"
        data-testid="note-item"
        class:active={note.id === store.activeId}
        class:dragging={dragId === note.id}
        style="--swatch: {pal.bg}"
      >
        <span
          class="swatch"
          data-testid="note-swatch"
          role="button"
          tabindex="-1"
          title="Drag to reorder"
          aria-label="Drag to reorder"
          style="background: {pal.bg}"
          onpointerdown={(e) => startDrag(e, note.id)}
        ></span>
        <button class="pick" data-testid="note-pick" onclick={() => (store.activeId = note.id)}>
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
  .ico.busy :global(svg) {
    animation: spin 0.8s linear infinite;
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
    padding: 4px 0;
  }
  /* Rows are full-bleed: selection and the color block run edge to edge. */
  .item {
    display: flex;
    align-items: stretch;
    width: 100%;
    color: var(--app-fg);
  }
  .item:hover {
    background: var(--app-bg);
  }
  /* Monochrome selection: full inversion — light theme gets a dark card,
     dark theme gets a white card with dark text. */
  .item.active {
    background: var(--app-fg);
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
    gap: 11px;
    padding-left: 11px;
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  /* The note color is a narrow full-height bar flush with the row start. */
  /* The colour bar doubles as the drag handle for rearranging the list. */
  .swatch {
    width: 10px;
    align-self: stretch;
    min-height: 38px;
    flex-shrink: 0;
    background: var(--swatch);
    cursor: grab;
    touch-action: none; /* a touch here drags the row instead of scrolling */
  }
  .swatch:hover {
    box-shadow: inset 0 0 0 2px var(--app-fg);
  }
  .item.dragging {
    opacity: 0.65;
  }
  .item.dragging .swatch {
    cursor: grabbing;
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
    padding: 0 12px 0 8px;
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
  .loadrow {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    padding: 18px 0;
    font-size: 14px;
    color: var(--app-muted);
  }
  .spin {
    width: 14px;
    height: 14px;
    border: 2px solid var(--app-border);
    border-top-color: var(--app-fg);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
