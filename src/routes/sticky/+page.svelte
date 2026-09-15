<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { getPalette } from '$lib/palettes';
  import Editor from '$lib/components/Editor.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let noteId = $state<string | null>(null);
  let note = $derived(noteId ? store.notes.find((n) => n.id === noteId) ?? null : null);
  let pal = $derived(note ? getPalette(note.paletteId) : getPalette(''));
  // Optional hand-placed look. The window itself stays rectangular, so the
  // card is inset before rotating — otherwise its corners clip.
  let tilt = $derived(store.settings.stickyTilt ? (note?.tilt ?? 0) : 0);

  // Convert a solid hex bg into rgba using the note's opacity so the window
  // (created transparent) shows a translucent sticker while text stays solid.
  function bgRgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  onMount(() => {
    (async () => {
      // The id is carried in the window label ("sticky-<id>"). Outside Tauri
      // (plain browser, e.g. previews and screenshots) that API throws, so
      // fall back to the query string instead of failing to load at all.
      let win: import('@tauri-apps/api/window').Window | null = null;
      let label = '';
      try {
        const mod = await import('@tauri-apps/api/window');
        win = mod.getCurrentWindow();
        label = win.label;
      } catch {
        win = null;
      }
      noteId = label.startsWith('sticky-')
        ? label.slice('sticky-'.length)
        : new URLSearchParams(window.location.search).get('id');

      await store.init();
      // A sticky can sit open for hours. Without this it keeps whatever it
      // loaded at open time, and any write from it republishes that stale
      // copy over newer edits made elsewhere.
      // Edits reach a sticky over the cross-window bus the moment the main
      // window learns of them; this poll is only a fallback for when the main
      // window isn't running. At 6s it was a full Drive fetch per sticky.
      store.startAutoSync(60_000);
      // ...and pick up edits from the main window the moment they're saved,
      // rather than on the next poll.
      store.listenForChanges();
      // Clicking a sticky should show current content, the same way clicking
      // the main window does.
      window.addEventListener('focus', () => void store.reload());

      // This window has its own store instance, so flush its own debounced
      // edits when it closes/hides — otherwise unpinning right after typing
      // loses the last keystrokes.
      const flush = () => store.flush();
      window.addEventListener('beforeunload', flush);
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });

      if (!win) return; // plain browser: no window geometry to track
      winRef = win;
      hasWin = true;

      // Window geometry is device-local: where a sticky sits on THIS screen
      // means nothing on a phone or another PC. It used to be saved onto the
      // note, which meant a nudge of the window republished the sticky's
      // whole (possibly stale) copy over newer edits from another device.
      const scale = await win.scaleFactor();
      scaleRef = scale;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const saveGeom = async () => {
        if (!noteId) return;
        const pos = await win.outerPosition();
        const size = await win.innerSize();
        try {
          const key = `notezzz:win:${noteId}`;
          const prev = JSON.parse(localStorage.getItem(key) ?? '{}'); // keeps tucked/home
          localStorage.setItem(
            key,
            JSON.stringify({
              ...prev,
              x: Math.round(pos.x / scale),
              y: Math.round(pos.y / scale),
              w: Math.round(size.width / scale),
              h: Math.round(size.height / scale),
            })
          );
        } catch {
          /* private mode — the sticky just opens at the default spot */
        }
      };
      const debounced = () => {
        clearTimeout(timer);
        timer = setTimeout(saveGeom, 500);
      };
      // Windows moves any mostly-off-screen window back on-screen when
      // displays reconnect (sleep, monitor wake). A tucked note is exactly
      // that, and it came back fully revealed while the app still believed
      // it was tucked — only a hover-and-leave put it away again. If we are
      // tucked and something other than our own slide moved us, go back.
      let retuck: ReturnType<typeof setTimeout> | undefined;
      await win.onMoved(() => {
        debounced();
        if (!tucked || sliding || peeking) return;
        clearTimeout(retuck);
        retuck = setTimeout(async () => {
          if (!tucked || sliding || peeking) return;
          const spot = await tuckedSpot();
          const pos = await win.outerPosition();
          if (spot && (Math.abs(pos.x - spot.x) > 4 || Math.abs(pos.y - spot.y) > 4)) {
            await slideTo(spot.x, spot.y);
          }
        }, 900);
      });
      await win.onResized(debounced);

      // Reopen tucked if it was tucked when the app last closed.
      try {
        const saved = JSON.parse(localStorage.getItem(`notezzz:win:${noteId}`) ?? '{}');
        if (saved.tucked && saved.home) {
          home = { x: Math.round(saved.home.x * scale), y: Math.round(saved.home.y * scale) };
          tucked = true;
          const spot = await tuckedSpot();
          if (spot) {
            const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
            await win.setPosition(new PhysicalPosition(spot.x, spot.y));
          }
        }
      } catch {
        /* nothing saved */
      }
      document.addEventListener('pointerenter', onPointerEnter);
      document.addEventListener('pointerleave', onPointerLeave);
    })();
  });

  // ---- tuck away -----------------------------------------------------------
  // A pinned note you want out of the way but not gone: it slides to the
  // nearer side of the screen until only a sliver of card shows, slides in
  // while the pointer is over that sliver, and comes back for good from the
  // same button. Device-local, like window position.
  let winRef: import('@tauri-apps/api/window').Window | null = null;
  let scaleRef = 1;
  let hasWin = $state(false);
  let tucked = $state(false);
  let peeking = $state(false);
  let sliding = false;
  /** Physical position the note returns to. */
  let home: { x: number; y: number } | null = null;
  const PEEK_PX = 20;
  /** How much of the note shows while the pointer hovers a tucked one. */
  const PEEK_FRACTION = 0.5;
  let tuckSide = $state<'left' | 'right'>('right');

  async function slideTo(x: number, y: number, ms = 340) {
    if (!winRef) return;
    const { invoke } = await import('@tauri-apps/api/core');
    sliding = true;
    try {
      await invoke('slide_window', { x, y, ms });
    } finally {
      sliding = false;
    }
  }

  /**
   * Where the note sits hanging off the nearer side edge with `visible`
   * physical pixels of window showing. Tucked = a sliver; hovered = a third.
   */
  async function edgeSpot(visible: number): Promise<{ x: number; y: number } | null> {
    if (!winRef) return null;
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const mon = await currentMonitor();
    if (!mon) return null;
    const size = await winRef.outerSize();
    const base = home ?? (await winRef.outerPosition());
    const onRight = base.x + size.width / 2 > mon.position.x + mon.size.width / 2;
    tuckSide = onRight ? 'right' : 'left';
    return {
      x: onRight ? mon.position.x + mon.size.width - visible : mon.position.x - size.width + visible,
      y: base.y,
    };
  }
  async function sliverPx(): Promise<number> {
    // A tilted card is inset from the window edge, so show that much more.
    return Math.round((PEEK_PX + (tilt !== 0 ? 14 : 0)) * scaleRef);
  }
  async function tuckedSpot() {
    return edgeSpot(await sliverPx());
  }
  async function peekSpot() {
    if (!winRef) return null;
    const size = await winRef.outerSize();
    return edgeSpot(Math.max(await sliverPx(), Math.round(size.width * PEEK_FRACTION)));
  }

  function persistTuck() {
    if (!noteId) return;
    try {
      const key = `notezzz:win:${noteId}`;
      const prev = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(
        key,
        JSON.stringify({
          ...prev,
          tucked,
          home: home ? { x: Math.round(home.x / scaleRef), y: Math.round(home.y / scaleRef) } : undefined,
        })
      );
    } catch {
      /* private mode */
    }
  }

  async function tuck() {
    if (!winRef || sliding) return;
    home = await winRef.outerPosition();
    const spot = await tuckedSpot();
    if (!spot) return;
    tucked = true;
    peeking = false;
    persistTuck();
    await slideTo(spot.x, spot.y);
  }

  async function untuck() {
    if (!winRef || sliding || !home) return;
    tucked = false;
    peeking = false;
    persistTuck();
    await slideTo(home.x, home.y);
  }

  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  async function onPointerEnter() {
    clearTimeout(leaveTimer);
    if (!tucked || peeking || sliding || !home) return;
    const spot = await peekSpot();
    if (!spot) return;
    peeking = true;
    await slideTo(spot.x, spot.y, 300);
  }
  function onPointerLeave() {
    if (!tucked || !peeking) return;
    clearTimeout(leaveTimer);
    // A short grace period: the window moving under a still pointer fires
    // leave/enter pairs that would otherwise make it jitter.
    leaveTimer = setTimeout(async () => {
      if (!tucked || sliding) return;
      const spot = await tuckedSpot();
      if (!spot) return;
      peeking = false;
      await slideTo(spot.x, spot.y, 300);
    }, 250);
  }

  /** The + on the bar: a new note, already pinned, opened beside this one. */
  async function addPinned() {
    let near: { x: number; y: number } | undefined;
    if (winRef) {
      const p = await winRef.outerPosition();
      near = { x: Math.round(p.x / scaleRef) + 28, y: Math.round(p.y / scaleRef) + 28 };
    }
    await store.createPinned(near);
  }

  /**
   * Resize from the card, not the window. The OS resize edges follow the
   * rectangular window, so on a tilted note they sit in the transparent
   * margin, nowhere near the card's corner. This grip lives on the card and
   * hands the drag to the OS, so the cursor and the resize itself are native.
   */
  type Corner = 'NorthWest' | 'NorthEast' | 'SouthWest' | 'SouthEast';
  async function startResize(e: PointerEvent, corner: Corner) {
    if (!winRef || e.button !== 0) return;
    e.preventDefault();
    await winRef.startResizeDragging(corner);
  }

  async function unpin() {
    if (noteId) store.update(noteId, { pinned: false }); // closes this window
  }
</script>

{#if note}
  <div
    class="sticky"
    class:tilted={tilt !== 0}
    style="
      --tilt: {tilt}deg;
      --note-bg: {bgRgba(pal.bg, note.opacity)};
      --note-header: {bgRgba(pal.header, Math.min(1, note.opacity + 0.08))};
      --note-fg: {pal.fg};
      --note-ink: {pal.ink ?? pal.fg};
      --note-accent: {pal.accent};
    "
  >
    <header class="bar {pal.pattern ? `nz-pat-${pal.pattern}` : ''}" data-tauri-drag-region>
      {#if hasWin && tucked && tuckSide === 'right'}
        <!-- Tucked to the right edge, only the left of the bar shows: the
             way back has to live there. -->
        <button class="x" data-testid="sticky-tuck" title="Bring it back" aria-label="Bring it back" aria-pressed="true" onclick={() => void untuck()}>
          <Icon name="untuck" size={15} />
        </button>
      {/if}
      <span class="ttl" data-tauri-drag-region>{note.title || 'Note'}</span>
      {#if hasWin && !tucked}
        <button class="x" data-testid="sticky-add" title="New pinned note" aria-label="New pinned note" onclick={addPinned}>
          <Icon name="add" size={15} />
        </button>
      {/if}
      {#if hasWin && !(tucked && tuckSide === 'right')}
        <button
          class="x"
          data-testid="sticky-tuck"
          title={tucked ? 'Bring it back' : 'Tuck away to the screen edge'}
          aria-label={tucked ? 'Bring it back' : 'Tuck away'}
          aria-pressed={tucked}
          onclick={() => void (tucked ? untuck() : tuck())}
        >
          <Icon name={tucked ? 'untuck' : 'tuck'} size={15} />
        </button>
      {/if}
      <button class="x" title="Unpin (close sticker)" aria-label="Unpin" onclick={unpin}>
        <Icon name="close" size={15} />
      </button>
    </header>
    {#if hasWin}
      <!-- Invisible 10px handles on every card corner (the OS edges are on the
           window, which on a tilted note is nowhere near the card); the
           bottom-right one also draws a small grip as the hint. -->
      <div class="corner nw" aria-hidden="true" onpointerdown={(e) => startResize(e, 'NorthWest')}></div>
      <div class="corner ne" aria-hidden="true" onpointerdown={(e) => startResize(e, 'NorthEast')}></div>
      <div class="corner sw" aria-hidden="true" onpointerdown={(e) => startResize(e, 'SouthWest')}></div>
      <div class="corner se grip" title="Resize" aria-hidden="true" onpointerdown={(e) => startResize(e, 'SouthEast')}></div>
    {/if}
    <div class="body">
      {#key note.id}
        <Editor
          html={note.contentHtml}
          baseSize={note.fontSize}
          onChange={(html) => noteId && store.update(noteId, { contentHtml: html })}
        />
      {/key}
    </div>
  </div>
{:else}
  <div class="loading">Loading note…<br /><small>{noteId ?? 'no id'}</small></div>
{/if}

<style>
  /* The sticky window is transparent; only the rounded card paints. */
  :global(html),
  :global(body) {
    background: transparent !important;
  }
  /* Tilted stickies inset themselves so the rotated corners stay inside the
     (rectangular) window instead of being clipped. */
  .sticky.tilted {
    inset: 14px;
    transform: rotate(var(--tilt));
  }
  .sticky {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--note-bg);
    color: var(--note-fg);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 10px;
    /* -color, not the shorthand: the shorthand would wipe a pattern's background-image */
    background-color: var(--note-header);
    cursor: move;
    user-select: none;
  }
  .ttl {
    flex: 1;
    font-weight: 700;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .x {
    border: none;
    background: transparent;
    color: var(--note-fg);
    opacity: 0.55;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
  }
  .x:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.12);
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .corner {
    position: absolute;
    width: 10px;
    height: 10px;
    z-index: 2;
  }
  .corner.nw { left: 0; top: 0; cursor: nwse-resize; }
  .corner.ne { right: 0; top: 0; cursor: nesw-resize; }
  .corner.sw { left: 0; bottom: 0; cursor: nesw-resize; }
  .corner.se { right: 0; bottom: 0; cursor: nwse-resize; }
  /* Two short diagonal hairlines in the bottom-right corner, drawn with the
     note's ink: the one visible hint that the card resizes. */
  .grip {
    opacity: 0.3;
    background: linear-gradient(
      135deg,
      transparent 0 50%,
      var(--note-fg) 50% 56%,
      transparent 56% 72%,
      var(--note-fg) 72% 78%,
      transparent 78%
    );
    background-size: 12px 12px;
    background-position: 100% 100%;
    background-repeat: no-repeat;
  }
  .grip:hover {
    opacity: 0.7;
  }
  .loading {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    background: #fbfaf6;
    color: #8a8a82;
    border-radius: var(--radius-lg);
    font-size: 15px;
  }
</style>
