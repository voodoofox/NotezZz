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
    // The handle's row moves in the page as the order changes, which can
    // drop the capture: a release anywhere still ends (and saves) the drag.
    window.addEventListener('pointerup', endDrag, { once: true });
    window.addEventListener('pointercancel', endDrag, { once: true });
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
  // The list's own scrollbar took width: rows stopped short of the edge and
  // their buttons fell off the line the header's and the note's share. It is
  // hidden, and this thin thumb floats over the rows instead.
  let thumb = $state<{ top: number; h: number } | null>(null);
  // Shown while the list moves, then it fades (as Android's own does); a
  // mouse over the list brings it back.
  let thumbAwake = $state(false);
  let thumbTimer: ReturnType<typeof setTimeout> | undefined;
  function wakeThumb() {
    thumbAwake = true;
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => (thumbAwake = false), 1200);
  }
  const syncScroll = () => {
    const el = listEl;
    if (!el) return;
    const { scrollTop, clientHeight, scrollHeight } = el;
    moreBelow = scrollTop + clientHeight < scrollHeight - 1;
    if (scrollHeight <= clientHeight + 1) {
      thumb = null;
      return;
    }
    const h = Math.max(24, (clientHeight * clientHeight) / scrollHeight);
    const top = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - h);
    // A plain variable, not `thumb`: this runs inside effects too, and
    // reading the state it then writes made one re-run itself forever.
    if (Math.abs(top - lastThumbTop) > 0.5) wakeThumb();
    lastThumbTop = top;
    thumb = { h, top };
  };
  let lastThumbTop = -1;

  /**
   * A note colour that nearly matches the list's own background (Paper on
   * the white panel, Graphite or Black on the dark one) gets a little of the
   * app's ink, so its bar and its selection still show.
   */
  function rowTone(c: string): string {
    const panel = store.settings.appTheme === 'dark' ? [0x1e, 0x21, 0x27] : [0xff, 0xff, 0xff];
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (!m) return c;
    const n = parseInt(m[1], 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const near = Math.max(...rgb.map((v, i) => Math.abs(v - panel[i]))) < 24;
    return near ? `color-mix(in srgb, ${c} 88%, var(--app-fg))` : c;
  }

  // Right-click (or long-press) on a row: what the row's buttons do, plus
  // archive, without opening the note first.
  let rowMenu = $state<{ id: string; x: number; y: number } | null>(null);
  let rowMenuNote = $derived(rowMenu ? store.notes.find((n) => n.id === rowMenu!.id) ?? null : null);
  function openRowMenu(e: MouseEvent, note: Note) {
    e.preventDefault();
    const w = 220;
    const h = 150;
    rowMenu = {
      id: note.id,
      x: Math.max(6, Math.min(e.clientX, window.innerWidth - w - 6)),
      y: Math.max(6, Math.min(e.clientY, window.innerHeight - h - 6)),
    };
  }
  function rowAction(run: (n: Note) => void) {
    const n = rowMenuNote;
    rowMenu = null;
    if (n) run(n);
  }
  /** Mouse drag on the thumb (touch scrolls the list itself). */
  function grabThumb(e: PointerEvent) {
    const el = listEl;
    if (!el || !thumb) return;
    e.preventDefault();
    const bar = e.currentTarget as HTMLElement;
    bar.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const s0 = el.scrollTop;
    const ratio = (el.scrollHeight - el.clientHeight) / Math.max(1, el.clientHeight - thumb.h);
    const move = (ev: PointerEvent) => (el.scrollTop = s0 + (ev.clientY - y0) * ratio);
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  }

  $effect(() => {
    const el = listEl;
    if (!el) return;
    const measure = () => {
      listH = el.clientHeight;
      listW = el.clientWidth;
      listMaxH = parseFloat(getComputedStyle(el).maxHeight) || 0; // 'none' beside the note
      syncScroll();
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
    syncScroll(); // rows came or went, or moved into columns: the box may not have resized
  });

  let columns = $derived.by(() => {
    if ((store.settings.layout ?? 'top') !== 'top') return 1;
    const set = store.settings.listColumns ?? 'auto';
    if (set !== 'auto') return set;
    const fit = Math.max(1, Math.floor(Math.max(listH, listMaxH) / (rowH || 40)));
    const byWidth = Math.max(1, Math.floor(listW / MIN_COL_PX));
    return Math.min(3, byWidth, Math.max(1, Math.ceil(visibleNotes.length / fit)));
  });

  $effect(() => {
    if (searching) searchInput?.focus();
  });
</script>

<svelte:window
  onpointerdown={(e) => {
    if (rowMenu && !(e.target as HTMLElement).closest?.('.rowmenu')) rowMenu = null;
  }}
  onkeydown={(e) => e.key === 'Escape' && (rowMenu = null)}
/>

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
    onscroll={syncScroll}
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
      {@const tone = rowTone(pal.pattern ? pal.header : pal.bg)}
      <div
        class="item"
        data-testid="note-item"
        role="listitem"
        class:active={note.id === store.activeId}
        class:dragging={dragId === note.id}
        style="--swatch: {tone}; --pat-img: {pal.patternImage ?? 'none'}; --row-fg: {pal.fg}"
        oncontextmenu={(e) => openRowMenu(e, note)}
      >
        <!-- The note's colour (or pattern) behind the row: as narrow as the
             swatch, and the full row once the note is selected. -->
        <span
          class="fill {pal.pattern ? `nz-pat-${pal.pattern}` : ''}"
          data-testid="note-fill"
          aria-hidden="true"
          style="background-color: {tone}; --pat-base: {pal.header}; --pat-ink: {pal.inkStrong ?? pal.fg}"
        ></span>
        <span
          class="swatch {pal.pattern ? `nz-pat-${pal.pattern}` : ''}"
          data-testid="note-swatch"
          role="button"
          tabindex="0"
          title="Drag to reorder (keyboard: Alt+Arrow Up/Down)"
          aria-label="Reorder {noteLabel(note)}: drag, or Alt+Arrow Up/Down"
          style="background-color: {tone}; --pat-base: {pal.header}; --pat-ink: {pal.inkStrong ?? pal.fg}"
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
        ><Icon name="pin" /></button>
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
          ><Icon name={note.tucked ? 'untuck' : 'tuck'} /></button>
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
  {#if thumb}
    <div
      class="thumb"
      class:awake={thumbAwake}
      style="top: {thumb.top}px; height: {thumb.h}px"
      onpointerdown={grabThumb}
      aria-hidden="true"
    ></div>
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

{#if rowMenu && rowMenuNote}
  <div class="rowmenu" role="menu" data-testid="row-menu" style="left: {rowMenu.x}px; top: {rowMenu.y}px">
    <button class="mi" role="menuitem" data-testid="row-menu-pin" onclick={() => rowAction((n) => store.update(n.id, { pinned: !n.pinned }))}>
      <Icon name="pin" /><span>{rowMenuNote.pinned ? 'Unpin from the desktop' : 'Pin to the desktop'}</span>
    </button>
    {#if rowMenuNote.pinned}
      <button class="mi" role="menuitem" onclick={() => rowAction((n) => store.update(n.id, { tucked: !n.tucked }))}>
        <Icon name={rowMenuNote.tucked ? 'untuck' : 'tuck'} /><span>{rowMenuNote.tucked ? 'Bring it back' : 'Tuck away'}</span>
      </button>
    {/if}
    <button class="mi" role="menuitem" data-testid="row-menu-archive" onclick={() => rowAction((n) => store.setArchived(n.id, !n.archived))}>
      <Icon name={rowMenuNote.archived ? 'unarchive' : 'archive'} /><span>{rowMenuNote.archived ? 'Unarchive' : 'Archive'}</span>
    </button>
  </div>
{/if}

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
    /* A bar like the note's: the buttons sit the edge in from its top,
       bottom and right, so the last one shares a centre line with each
       row's last button and the note's ⋯ below. As tall as --bar-h. */
    padding: var(--edge) var(--edge) var(--edge) 12px;
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
    background: transparent; /* the note's buttons: ink only, until hovered or on */
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
  @media (hover: hover) {
    .new:hover,
    .ico:hover {
      background: color-mix(in srgb, var(--app-fg) 8%, transparent);
    }
  }
  .new:active,
  .ico:active,
  .pin:active {
    background: color-mix(in srgb, var(--app-fg) 16%, transparent);
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
  /* Tinted like the app's buttons and fields, no outline. */
  .search {
    width: 100%;
    font: inherit;
    font-size: 15px;
    min-height: var(--btn);
    padding: 0 11px;
    border: none;
    border-radius: var(--btn-radius);
    background: color-mix(in srgb, var(--app-fg) 7%, transparent);
    color: var(--app-fg);
    outline: none;
  }
  .search:focus {
    background: color-mix(in srgb, var(--app-fg) 11%, transparent);
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
  /* Rows start right under the header and run to the edge: no padding,
     and no scrollbar of its own (the floating .thumb stands in). */
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    scrollbar-width: none;
  }
  .list::-webkit-scrollbar {
    display: none;
  }
  /* The floating scrollbar: a thin pill in the app's ink, in the edge strip
     right of each row's last button. A mouse can drag it. */
  .thumb {
    position: absolute;
    right: 0;
    z-index: auto; /* see the shade above */
    width: var(--edge);
    display: flex;
    justify-content: center;
    pointer-events: none;
    touch-action: none;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .thumb.awake {
    opacity: 1;
  }
  .thumb::before {
    content: '';
    width: 3px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-fg) 30%, transparent);
  }
  @media (pointer: fine) {
    .thumb {
      pointer-events: auto;
    }
    .listbox:hover .thumb {
      opacity: 1;
    }
    .thumb:hover::before {
      width: 4px;
      background: color-mix(in srgb, var(--app-fg) 50%, transparent);
    }
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
    /* auto, not 1: a z-index here lifted it over the whole note (the note
       is its own layer), full-screen draw pad included. Being after the
       rows in the page is enough to sit over them. */
    z-index: auto;
    height: calc(var(--bar-h) / 2);
    pointer-events: none;
    background: linear-gradient(
      to bottom,
      rgb(0 0 0 / 0),
      rgb(0 0 0 / calc(var(--list-shade) / 4)) 45%,
      rgb(0 0 0 / var(--list-shade))
    );
  }
  /* The row menu (right-click / long-press): a sticker like every menu. */
  .rowmenu {
    position: fixed;
    z-index: 60;
    width: 220px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--edge);
    background: var(--app-panel);
    border: 1px solid var(--app-border);
    border-radius: var(--sticker-radius);
    box-shadow: var(--sticker-shadow);
  }
  .rowmenu .mi {
    display: flex;
    align-items: center;
    gap: 12px;
    font: inherit;
    font-size: 15px;
    font-weight: 400;
    text-align: left;
    padding: 9px 10px;
    border: none;
    border-radius: var(--btn-radius);
    background: transparent;
    color: var(--app-fg);
    cursor: pointer;
  }
  .rowmenu .mi:hover,
  .rowmenu .mi:active {
    background: var(--app-bg);
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
    /* A touch larger and firmer than it was: a list title shouldn't read
       smaller than the note's own text. */
    font-size: 17px;
    font-weight: 450;
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
    opacity: 0.45;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* The pin: only on pinned notes, and filled like every "on" button (the
     note's header shows it the same way). A PC offers it on an unpinned
     row under the pointer; a phone pins from the note's header. */
  .pin.on:not(.tuck) {
    background: var(--app-fg);
    color: var(--app-panel);
  }
  .item.active .pin.on:not(.tuck) {
    background: var(--row-fg);
    color: var(--swatch);
  }
  .pin:not(.on):not(.tuck) {
    opacity: 0;
  }
  @media (hover: hover) {
    .item:hover .pin:not(.on):not(.tuck),
    .pin:not(.on):not(.tuck):focus-visible {
      opacity: 0.45;
    }
  }
  @media (hover: none) {
    .pin:not(.on):not(.tuck) {
      visibility: hidden; /* not a hidden target under a thumb */
    }
  }
  .pin:last-child {
    margin-right: var(--edge);
  }
  @media (hover: hover) {
    .pin:hover {
      opacity: 0.8;
    }
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
    border-right: none; /* and no line below: the note's own title bar parts them */
  }
  :global(.app.stacked) > .sidebar .listbox,
  :global(.app.stacked) > .sidebar .list {
    flex: none;
    /* The header and the list together: at most 30% of the app's height
       (the header is a bar, --bar-h tall),
       never under three rows. A search box or a sync/update banner adds
       to that rather than being squeezed out of sight. */
    max-height: calc(0.3 * (100dvh - var(--safe-top, 0px)) - var(--bar-h));
    min-height: calc(3 * var(--bar-h));
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
    }
    .listbox,
    .list {
      flex: none;
      /* The header and the list together: at most 30% of the app's height
         (the header is a bar, --bar-h tall),
         never under three rows. A search box or a sync/update banner adds
         to that rather than being squeezed out of sight. */
      max-height: calc(0.3 * (100dvh - var(--safe-top, 0px)) - var(--bar-h));
      min-height: calc(3 * var(--bar-h));
    }
    :global(.note-open) > .sidebar {
      display: none;
    }
  }
</style>
