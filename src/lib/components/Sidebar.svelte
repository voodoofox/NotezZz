<script lang="ts">
  import { store } from '$lib/store.svelte';
  import { getPalette } from '$lib/palettes';
  import { filterNotes, noteLabel } from '$lib/text';
  import type { Note } from '$lib/types';
  import Settings from './Settings.svelte';
  import Icon from './Icon.svelte';
  import Lockup from './Lockup.svelte';
  import { updates } from '$lib/update.svelte';
  import { installUpdate } from '$lib/updater';
  import { isDesktop } from '$lib/storage/backend';

  let showSettings = $state(false);
  let searching = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);

  /** Live-filtered list: title + note text, case-insensitive. While a drag
   *  is in progress the local snapshot is shown instead (see startDrag). */
  /** The archive view: archived notes only, with a way back. */
  let showArchive = $state(false);
  let archivedCount = $derived(store.notes.filter((n) => n.archived).length);
  // Leaving the archive empty (the last note restored) returns to the list.
  $effect(() => {
    if (showArchive && archivedCount === 0) showArchive = false;
  });

  let visibleNotes = $derived.by(() => {
    if (dragOrder) return dragOrder;
    // Search reaches everything, archived notes included.
    if (searching && query.trim()) return filterNotes(store.notes, query);
    return store.notes.filter((n) => !!n.archived === showArchive);
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

  /** The tuck button acts on the PC's sticky from anywhere; say so off the PC. */
  const tuckTitle = (on: boolean | undefined) =>
    isDesktop()
      ? on ? 'Bring the sticky back' : 'Tuck the sticky to the screen edge'
      : on ? 'Bring the sticky back on your PC' : 'Tuck the sticky away on your PC';

  function startDrag(e: PointerEvent, id: string) {
    if (searching) return; // order is meaningless while filtered
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragId = id;
    dragOrder = [...visibleNotes];
  }

  function moveDrag(e: PointerEvent) {
    if (!dragId || !listEl || !dragOrder) return;
    const rows = [...listEl.querySelectorAll<HTMLElement>('[data-testid="note-item"]')];
    const from = dragOrder.findIndex((n) => n.id === dragId);
    if (from === -1) return;
    // Drop on the row under the pointer (works for the multi-column grid);
    // between rows, fall back to "above the midpoint" as before.
    const under = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
      '[data-testid="note-item"]'
    );
    let to = under ? rows.indexOf(under) : -1;
    if (to === -1) {
      to = rows.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return e.clientY < b.top + b.height / 2;
      });
      if (to === -1) to = rows.length - 1;
      else if (to > from) to -= 1;
    }
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
    // Swap within what is on screen; notes out of view (the other side of
    // the archive) keep their places ahead of it.
    const shown = visibleNotes.map((n) => n.id);
    const i = shown.indexOf(id);
    const j = i + (e.key === 'ArrowDown' ? 1 : -1);
    if (i === -1 || j < 0 || j >= shown.length) return;
    [shown[i], shown[j]] = [shown[j], shown[i]];
    const inView = new Set(shown);
    void store.reorder([...store.notes.filter((n) => !inView.has(n.id)).map((n) => n.id), ...shown]);
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

  // ---- list columns ----------------------------------------------------
  // With the list above the note, 'auto' starts at one column and adds one
  // each time the rows stop fitting the strip, up to three; a column is never
  // narrower than MIN_COL_PX, so a phone-width list stays single. The strip
  // fits its rows up to a cap (see the CSS), so "fitting" is measured against
  // that cap: the list grows taller first, then wider.
  const MIN_COL_PX = 220;
  let listH = $state(0);
  let listMaxH = $state(0);
  let listW = $state(0);
  let rowH = $state(0);
  // More notes below the visible part: the list's bottom edge fades out.
  let moreBelow = $state(false);
  const checkMore = () => {
    const el = listEl;
    if (el) moreBelow = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  };

  $effect(() => {
    const el = listEl;
    if (!el) return;
    const measure = () => {
      listH = el.clientHeight;
      listW = el.clientWidth;
      listMaxH = parseFloat(getComputedStyle(el).maxHeight) || 0; // 'none' beside the note
      checkMore();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The cap follows the window even while the list itself keeps its size.
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  // Row height, re-read when rows appear (the observer only sees the list box).
  $effect(() => {
    void visibleNotes.length;
    void columns;
    const row = listEl?.querySelector<HTMLElement>('[data-testid="note-item"]');
    if (row && row.offsetHeight) rowH = row.offsetHeight;
    checkMore(); // rows came or went, or moved into columns: the box may not have resized
  });

  let columns = $derived.by(() => {
    if ((store.settings.layout ?? 'top') !== 'top') return 1;
    const set = store.settings.listColumns ?? 'auto';
    if (set !== 'auto') return set;
    const fit = Math.max(1, Math.floor((Math.max(listH, listMaxH) - 8) / (rowH || 40)));
    const byWidth = Math.max(1, Math.floor(listW / MIN_COL_PX));
    return Math.min(3, byWidth, Math.max(1, Math.ceil(visibleNotes.length / fit)));
  });

  $effect(() => {
    if (searching) searchInput?.focus();
  });
</script>

<aside class="sidebar">
  <div class="head">
    <span class="brand"><Lockup height={24} /></span>
    <div class="head-actions">
      <button
        class="ico"
        class:on={searching}
        data-testid="search-toggle"
        onclick={toggleSearch}
        title="Search notes"
        aria-label="Search notes"
      ><Icon name="search" /></button>
      <button class="ico" data-testid="open-settings" onclick={() => (showSettings = true)} title="Settings" aria-label="Settings">
        <Icon name="settings" />
      </button>
      <button class="new" data-testid="new-note" onclick={() => store.create()} title="New note" aria-label="New note">
        <Icon name="add" />
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

  <div class="listbox" class:more-below={moreBelow}>
  <div
    class="list cols-{columns}"
    role="list"
    bind:this={listEl}
    onscroll={checkMore}
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
        role="listitem"
        class:active={note.id === store.activeId}
        class:dragging={dragId === note.id}
        style="--swatch: {pal.pattern ? pal.header : pal.bg}; --pat-img: {pal.patternImage ?? 'none'}; --row-fg: {pal.fg}"
      >
        <!-- The note's colour (or pattern) behind the row: as narrow as the
             swatch, and the full row once the note is selected. -->
        <span
          class="fill {pal.pattern ? `nz-pat-${pal.pattern}` : ''}"
          data-testid="note-fill"
          aria-hidden="true"
          style="background-color: {pal.pattern ? pal.header : pal.bg}; --pat-base: {pal.header}; --pat-ink: {pal.inkStrong ?? pal.fg}"
        ></span>
        <span
          class="swatch {pal.pattern ? `nz-pat-${pal.pattern}` : ''}"
          data-testid="note-swatch"
          role="button"
          tabindex="0"
          title="Drag to reorder (keyboard: Alt+Arrow Up/Down)"
          aria-label="Reorder {noteLabel(note)}: drag, or Alt+Arrow Up/Down"
          style="background-color: {pal.pattern ? pal.header : pal.bg}; --pat-base: {pal.header}; --pat-ink: {pal.inkStrong ?? pal.fg}"
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
        <!-- The sticky lives on the PC, but the flag is on the note: tucking
             from the phone slides the PC's sticky away (or brings it back). -->
        {#if note.pinned}
          <button
            class="pin tuck"
            data-testid="note-tuck"
            class:on={!!note.tucked}
            aria-pressed={!!note.tucked}
            title={tuckTitle(note.tucked)}
            aria-label={tuckTitle(note.tucked)}
            onclick={() => store.update(note.id, { tucked: !note.tucked })}
          ><Icon name={note.tucked ? 'untuck' : 'tuck'} size={16} /></button>
        {/if}
      </div>
    {/each}

    {#if store.loaded && store.notes.length === 0}
      <p class="empty" data-testid="empty-state">No notes yet.<br />Hit + to create one.</p>
    {:else if store.loaded && !visibleNotes.length && !showArchive && !(searching && query.trim())}
      <p class="empty" data-testid="empty-state">Everything is archived.<br />Hit + for a fresh note.</p>
    {/if}

    {#if archivedCount && !(searching && query.trim())}
      <button class="archive-toggle" data-testid="archive-toggle" onclick={() => (showArchive = !showArchive)}>
        <Icon name={showArchive ? 'back' : 'archive'} size={16} />
        {showArchive ? 'Back to notes' : `Archive (${archivedCount})`}
      </button>
    {/if}
  </div>
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
    /* Beside the note: 30% of the window's width, the same share the
       list gets of the height when it sits above the note. */
    width: 30%;
    min-width: 200px;
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
    display: inline-flex;
    align-items: center;
    color: var(--app-fg);
  }
  .head-actions {
    display: flex;
    gap: var(--btn-gap);
  }
  .new,
  .ico {
    width: var(--btn);
    height: var(--btn);
    font-size: 18px;
    border: none;
    border-radius: var(--btn-radius);
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
    background: color-mix(in srgb, var(--app-fg) 10%, var(--app-bg));
  }
  .ico.on {
    background: var(--app-fg);
    color: var(--app-panel);
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
  /* The list and, over its bottom edge, the shade below. A box of its own
     so the shade spans the scrollbar too (inside the scrolling list it
     would stop short of it). */
  .listbox {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  /* There is more below: a soft shade over the last half row, as if the
     list ran on under the edge, so a cut-off row reads as "scroll" rather
     than as a clipped layout. Gone once the end is in view. */
  .listbox.more-below::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
    height: calc(var(--bar-h) / 2);
    pointer-events: none;
    background: linear-gradient(
      to bottom,
      rgb(0 0 0 / 0),
      rgb(0 0 0 / calc(var(--list-shade) / 4)) 45%,
      rgb(0 0 0 / var(--list-shade))
    );
  }
  /* Rows are full-bleed: selection and the color block run edge to edge. */
  .item {
    position: relative;
    isolation: isolate; /* the fill sits behind the row's contents */
    display: flex;
    align-items: stretch;
    width: 100%;
    color: var(--app-fg);
    transition: color 0.28s;
  }
  .item:hover {
    background-color: var(--app-bg);
  }
  /* Selection in the note's own colour: the fill grows out of the swatch
     on the left to the full row, and the text takes the note's ink. A
     pattern note's fill is its pattern, like the swatch. */
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 10px; /* the swatch's width: at rest the fill is the colour bar */
    z-index: -1;
    pointer-events: none;
    transition: width 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .item.active .fill {
    width: 100%;
  }
  .item.active,
  .item.active .pick,
  .item.active .pin {
    color: var(--row-fg);
  }
  .pick,
  .pin {
    transition: color 0.28s;
  }
  @media (prefers-reduced-motion: reduce) {
    .item,
    .fill,
    .pick,
    .pin {
      transition: none;
    }
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
    min-height: var(--bar-h); /* rows are as tall as the toolbar */
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
    width: var(--btn);
    height: var(--btn);
    align-self: center;
    flex: none;
    padding: 0;
    border-radius: var(--btn-radius);
    opacity: 0.3;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .pin:last-child {
    margin-right: var(--edge);
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
  /* Quiet by design: the archive is somewhere you go, not something shown. */
  .archive-toggle {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    margin-top: 6px;
    border: none;
    border-top: 1px solid var(--app-border);
    background: none;
    color: var(--app-muted);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
    text-align: left;
  }
  .archive-toggle:hover {
    color: var(--app-fg);
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
  .pin.tuck {
    padding-left: 0;
  }
  /* "List above the note" at any width: the list fits its notes, growing
     with them up to 30% of the window's height (then it scrolls), and
     never shorter than three rows; the note takes the rest. */
  :global(.app.stacked) > .sidebar {
    width: 100%;
    height: auto;
    flex: none;
    border-right: none;
    border-bottom: 2px solid var(--app-border);
  }
  :global(.app.stacked) > .sidebar .listbox,
  :global(.app.stacked) > .sidebar .list {
    flex: none;
    /* The header and the list together: at most 30% of the app's height
       (header = button + 2 x 10px padding + 1px line; 2px line below),
       never under three rows. A search box or a sync/update banner adds
       to that rather than being squeezed out of sight. */
    max-height: calc(0.3 * (100dvh - var(--safe-top, 0px)) - var(--btn) - 23px);
    min-height: calc(3 * var(--bar-h) + 8px);
  }
  /* While the list has more below (see .more-below), the line under it
     takes the shade's darkest tone, so the shade runs right into the note.
     After the rules above that draw the line, so it wins over them. */
  .sidebar:has(> .listbox.more-below) {
    border-bottom-color: color-mix(in srgb, #000 var(--list-shade), var(--app-panel));
  }
  /* Columns only make sense in the wide strip. Rows keep their full-bleed
     look inside each column; the grid supplies the columns. */
  .list.cols-2,
  .list.cols-3 {
    display: grid;
    align-content: start;
    column-gap: 2px;
  }
  .list.cols-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .list.cols-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .list.cols-2 .loadrow,
  .list.cols-3 .loadrow,
  .list.cols-2 .empty,
  .list.cols-3 .empty {
    grid-column: 1 / -1;
  }
  @media (max-width: 700px) {
    .sidebar {
      width: 100%;
      min-width: 0;
      height: auto;
      flex: none;
      border-right: none;
      border-bottom: 2px solid var(--app-border);
    }
    .listbox,
    .list {
      flex: none;
      /* The header and the list together: at most 30% of the app's height
         (header = button + 2 x 10px padding + 1px line; 2px line below),
         never under three rows. A search box or a sync/update banner adds
         to that rather than being squeezed out of sight. */
      max-height: calc(0.3 * (100dvh - var(--safe-top, 0px)) - var(--btn) - 23px);
      min-height: calc(3 * var(--bar-h) + 8px);
    }
    :global(.note-open) > .sidebar {
      display: none;
    }
  }
</style>
