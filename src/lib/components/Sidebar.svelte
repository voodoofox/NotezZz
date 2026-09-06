<script lang="ts">
  import { store } from '$lib/store.svelte';
  import { getPalette } from '$lib/palettes';
  import { filterNotes, noteLabel } from '$lib/text';
  import type { Note } from '$lib/types';
  import Settings from './Settings.svelte';
  import Icon from './Icon.svelte';
  import { updates } from '$lib/update.svelte';
  import { installUpdate } from '$lib/updater';

  let showSettings = $state(false);
  let searching = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);

  /** Live-filtered list: title + note text, case-insensitive. While a drag
   *  is in progress the local snapshot is shown instead (see startDrag). */
  let visibleNotes = $derived.by(() => {
    if (dragOrder) return dragOrder;
    if (!searching) return store.notes;
    return filterNotes(store.notes, query);
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
  // The order being dragged, held locally until release. Writing store.notes
  // live let a background poll (which replaces the list) reorder the rows
  // under the pointer mid-drag.
  let dragOrder = $state<Note[] | null>(null);

  function startDrag(e: PointerEvent, id: string) {
    if (searching) return; // order is meaningless while filtered
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragId = id;
    dragOrder = [...store.notes];
  }

  function moveDrag(e: PointerEvent) {
    if (!dragId || !listEl || !dragOrder) return;
    const rows = [...listEl.querySelectorAll<HTMLElement>('[data-testid="note-item"]')];
    const from = dragOrder.findIndex((n) => n.id === dragId);
    if (from === -1) return;
    // Drop where the pointer sits relative to each row's midpoint.
    let to = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return e.clientY < b.top + b.height / 2;
    });
    if (to === -1) to = rows.length - 1;
    else if (to > from) to -= 1;
    if (to !== from && to >= 0) {
      const next = [...dragOrder];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      dragOrder = next; // live feedback; committed on release
    }
  }

  function endDrag() {
    if (!dragId) return;
    dragId = null;
    const order = dragOrder;
    dragOrder = null;
    if (!order) return;
    // Notes that arrived during the drag are not in the snapshot; they lead,
    // the same way #applyOrder treats unlisted notes.
    const seen = new Set(order.map((n) => n.id));
    const ids = [...store.notes.filter((n) => !seen.has(n.id)), ...order].map((n) => n.id);
    void store.reorder(ids);
  }

  /** Keyboard counterpart of the drag: Alt+ArrowUp/Down moves the note. */
  function keyMove(e: KeyboardEvent, id: string) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || searching) return;
    e.preventDefault();
    const ids = store.notes.map((n) => n.id);
    const i = ids.indexOf(id);
    const j = i + (e.key === 'ArrowDown' ? 1 : -1);
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void store.reorder(ids);
  }

  let installing = $state<number | null>(null);
  let installError = $state('');
  async function installNow() {
    store.flush(); // the process exits as the installer starts
    installing = 0;
    installError = '';
    const r = await installUpdate((p) => (installing = p));
    if (r.kind === 'error') installError = r.message;
    installing = null;
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
        aria-label="Search notes"
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
        class="item {note.id === store.activeId && pal.pattern ? `nz-pat-${pal.pattern}` : ''}"
        data-testid="note-item"
        role="listitem"
        class:active={note.id === store.activeId}
        class:dragging={dragId === note.id}
        style="--swatch: {pal.pattern ? pal.header : pal.bg}"
      >
        <span
          class="swatch {pal.pattern ? `nz-pat-${pal.pattern}` : ''}"
          data-testid="note-swatch"
          role="button"
          tabindex="0"
          title="Drag to reorder (keyboard: Alt+Arrow Up/Down)"
          aria-label="Reorder {noteLabel(note)}: drag, or Alt+Arrow Up/Down"
          style="background-color: {pal.pattern ? pal.header : pal.bg}; --pat-base: {pal.header}; --pat-ink: color-mix(in srgb, {pal.fg} 42%, {pal.header})"
          onpointerdown={(e) => startDrag(e, note.id)}
          onkeydown={(e) => keyMove(e, note.id)}
        ></span>
        <button class="pick" data-testid="note-pick" onclick={() => (store.activeId = note.id)}>
          <span class="title" data-testid="note-title">{noteLabel(note)}</span>
        </button>
        <button
          class="pin"
          data-testid="note-pin"
          class:on={note.pinned}
          aria-pressed={note.pinned}
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
  {#if updates.available && !updates.dismissed}
    <div class="sync-err update" data-testid="update-banner">
      {#if installing !== null}
        Installing v{updates.available.version}… {installing}%
      {:else}
        NotezZz v{updates.available.version} is ready to install.
        {#if installError}<br />{installError}{/if}
        <span class="row">
          <button class="reconnect" data-testid="update-banner-install" onclick={installNow}>Install</button>
          <button class="later" onclick={() => (updates.dismissed = true)}>Later</button>
        </span>
      {/if}
    </div>
  {/if}
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
    background-color: var(--app-bg);
  }
  /* Monochrome selection: full inversion — light theme gets a dark card,
     dark theme gets a white card with dark text. */
  .item.active {
    /* -color, not the shorthand: a selected pattern note paints its texture
       here through the global .nz-pat-* rules, in these two tones. */
    background-color: var(--app-fg);
    color: var(--app-bg);
    --pat-base: var(--app-fg);
    --pat-ink: color-mix(in srgb, var(--app-bg) 34%, var(--app-fg));
  }
  .item.active .pick,
  .item.active .pin {
    color: var(--app-bg);
  }
  .item.active:hover {
    background-color: var(--app-fg);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 11px;
    flex: 1;
    min-width: 0;
    text-align: left;
    /* 10px swatch + 10px = text starts at 20px, the same x as the note
       pane's fullscreen glyph, so the two columns line up on phones. */
    padding: 0 0 0 10px;
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
    background-color: var(--swatch);
    cursor: grab;
    touch-action: none; /* a touch here drags the row instead of scrolling */
  }
  .swatch:hover,
  .swatch:focus-visible {
    box-shadow: inset 0 0 0 2px var(--app-fg);
    outline: none;
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
  /* An update is news, not an error: app ink instead of the danger colour. */
  .sync-err.update {
    color: var(--app-fg);
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .row .reconnect {
    margin-top: 6px;
  }
  .later {
    margin-top: 6px;
    font: inherit;
    font-size: 13px;
    padding: 5px 10px;
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--app-fg);
    cursor: pointer;
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
  /* Phone: the list is the upper 30% of the stacked split and disappears in
     fullscreen (.note-open on the page's <main>). */
  @media (max-width: 700px) {
    .sidebar {
      width: 100%;
      height: 30%;
      border-right: none;
      border-bottom: 2px solid var(--app-border);
    }
    :global(.note-open) > .sidebar {
      display: none;
    }
  }
</style>
