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
      await win.onMoved(debounced);
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
  const PEEK_PX = 12;
  const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  async function slideTo(x: number, y: number, ms = 380) {
    if (!winRef) return;
    const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
    const from = await winRef.outerPosition();
    sliding = true;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = (now: number) => {
        const k = easeInOutQuad(Math.min(1, (now - t0) / ms));
        void winRef!.setPosition(
          new PhysicalPosition(Math.round(from.x + (x - from.x) * k), Math.round(from.y + (y - from.y) * k))
        );
        if (k < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    sliding = false;
  }

  /** Where a tucked note sits: off the nearer side edge, PEEK_PX of card showing. */
  async function tuckedSpot(): Promise<{ x: number; y: number } | null> {
    if (!winRef) return null;
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const mon = await currentMonitor();
    if (!mon) return null;
    const size = await winRef.outerSize();
    const base = home ?? (await winRef.outerPosition());
    // A tilted card is inset from the window edge, so show that much more.
    const inset = tilt !== 0 ? 14 : 0;
    const peek = Math.round((PEEK_PX + inset) * scaleRef);
    const onRight = base.x + size.width / 2 > mon.position.x + mon.size.width / 2;
    return {
      x: onRight ? mon.position.x + mon.size.width - peek : mon.position.x - size.width + peek,
      y: base.y,
    };
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
    peeking = true;
    await slideTo(home.x, home.y, 300);
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
      --note-accent: {pal.accent};
    "
  >
    <header class="bar {pal.pattern ? `nz-pat-${pal.pattern}` : ''}" data-tauri-drag-region>
      <span class="ttl" data-tauri-drag-region>{note.title || 'Note'}</span>
      {#if hasWin}
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
