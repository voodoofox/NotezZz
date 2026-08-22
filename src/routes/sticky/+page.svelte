<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { getPalette } from '$lib/palettes';
  import Editor from '$lib/components/Editor.svelte';

  let noteId = $state<string | null>(null);
  let note = $derived(noteId ? store.notes.find((n) => n.id === noteId) ?? null : null);
  let pal = $derived(note ? getPalette(note.paletteId) : getPalette(''));

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
      // The id is carried in the window label ("sticky-<id>").
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const label = win.label;
      noteId = label.startsWith('sticky-')
        ? label.slice('sticky-'.length)
        : new URLSearchParams(window.location.search).get('id');

      await store.init();

      // This window has its own store instance, so flush its own debounced
      // edits when it closes/hides — otherwise unpinning right after typing
      // loses the last keystrokes.
      const flush = () => store.flush();
      window.addEventListener('beforeunload', flush);
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });

      // Persist window geometry (in logical px) as the user moves/resizes.
      const scale = await win.scaleFactor();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const saveGeom = async () => {
        if (!noteId) return;
        const pos = await win.outerPosition();
        const size = await win.innerSize();
        store.update(noteId, {
          win: {
            x: Math.round(pos.x / scale),
            y: Math.round(pos.y / scale),
            w: Math.round(size.width / scale),
            h: Math.round(size.height / scale),
          },
        });
      };
      const debounced = () => {
        clearTimeout(timer);
        timer = setTimeout(saveGeom, 500);
      };
      await win.onMoved(debounced);
      await win.onResized(debounced);
    })();
  });

  async function unpin() {
    if (noteId) store.update(noteId, { pinned: false }); // closes this window
  }
</script>

{#if note}
  <div
    class="sticky"
    style="
      --note-bg: {bgRgba(pal.bg, note.opacity)};
      --note-header: {bgRgba(pal.header, Math.min(1, note.opacity + 0.08))};
      --note-fg: {pal.fg};
      --note-accent: {pal.accent};
    "
  >
    <header class="bar" data-tauri-drag-region>
      <span class="ttl" data-tauri-drag-region>{note.title || 'Note'}</span>
      <button class="x" title="Unpin (close sticker)" onclick={unpin}>✕</button>
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
  .sticky {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--note-bg);
    color: var(--note-fg);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 10px;
    background: var(--note-header);
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
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 5px;
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
    background: #fff4b8;
    color: #6b6440;
    border-radius: 12px;
    font-size: 15px;
  }
</style>
