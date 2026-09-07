<script lang="ts">
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { PALETTES, PATTERNS, getPalette, hslToHex, hexToHsl } from '$lib/palettes';
  import Editor from './Editor.svelte';
  import Icon from './Icon.svelte';

  import { popoverStyle } from '$lib/popover';

  let note = $derived(store.active);
  let pal = $derived(note ? getPalette(note.paletteId) : PALETTES[0]);
  const desktop = isTauri();
  // Fullscreen is history state (see +page.svelte); read it from there rather
  // than store.mobileOpen so this pane never disagrees with the page.
  let fullscreen = $derived((page.state as { fs?: boolean }).fs === true);

  // Toolbar popovers (note color / base text size), fixed-positioned so the
  // toolbar's overflow can't clip them; any outside tap closes them.
  let openPop = $state<'pal' | 'size' | null>(null);
  let popStyle = $state('');
  let palWrap = $state<HTMLElement | null>(null);
  let sizeWrapEl = $state<HTMLElement | null>(null);

  function togglePop(which: 'pal' | 'size') {
    if (openPop === which) return void (openPop = null);
    const anchor = which === 'pal' ? palWrap : sizeWrapEl;
    if (anchor) popStyle = popoverStyle(anchor, which === 'pal' ? 226 : 270);
    // Open ON the note's current custom colour: with the sliders at their
    // defaults, the first nudge used to snap the note to a different colour.
    if (which === 'pal' && note?.paletteId.startsWith('custom:')) {
      const hsl = hexToHsl(note.paletteId.slice(7));
      if (hsl) {
        custHue = hsl.h;
        custSat = Math.min(90, hsl.s);
        custLight = Math.max(30, Math.min(94, hsl.l));
      }
    }
    openPop = which;
  }

  function closePopsOutside(e: PointerEvent) {
    if (!openPop) return;
    const t = e.target as Node;
    if (!palWrap?.contains(t) && !sizeWrapEl?.contains(t)) openPop = null;
  }

  let isCustom = $derived(note?.paletteId.startsWith('custom:') ?? false);

  // Inline custom color: hue + shade sliders apply instantly — no native
  // color-dialog chain.
  let custHue = $state(45);
  let custLight = $state(82);
  let custSat = $state(70);

  function applyCustom() {
    if (note) store.update(note.id, { paletteId: `custom:${hslToHex(custHue, custSat, custLight)}` });
  }

  /** Exit fullscreen via history; if the entry got lost (e.g. a reload while
   *  fullscreen), force the state clear so the button always works. Both
   *  paths change page.state — the page effect turns that into mobileOpen. */
  function exitFullscreen() {
    history.back();
    setTimeout(() => {
      if ((page.state as { fs?: boolean }).fs) replaceState('', {});
    }, 250);
  }

  function deleteNote() {
    if (!note || !confirm('Delete this note?')) return;
    const wasFullscreen = fullscreen;
    void store.remove(note.id);
    if (wasFullscreen) exitFullscreen(); // drop the fullscreen history entry
  }
</script>

<svelte:window onpointerdown={closePopsOutside} />

{#if note}
  <section
    class="pane"
    data-testid="note-pane"
    data-palette={note.paletteId}
    style="
      --note-bg: {pal.bg};
      --note-header: {pal.header};
      --note-fg: {pal.fg};
      color-scheme: {pal.dark ? 'dark' : 'light'};
    "
  >
    <div class="topbar {pal.pattern ? `nz-pat-${pal.pattern}` : ''}">
      {#if fullscreen}
        <button
          class="icon mob"
          data-testid="exit-fullscreen"
          title="Back to split view"
          aria-label="Back to split view"
          onclick={exitFullscreen}
        ><Icon name="back" /></button>
      {:else}
        <button
          class="icon mob"
          data-testid="note-fullscreen"
          title="Expand note fullscreen"
          aria-label="Expand note fullscreen"
          onclick={() => pushState('', { fs: true })}
        ><Icon name="fullscreen" /></button>
      {/if}
      <input
        class="title"
        data-testid="title-input"
        placeholder="Title…"
        aria-label="Note title"
        value={note.title}
        oninput={(e) => store.update(note!.id, { title: (e.currentTarget as HTMLInputElement).value })}
      />
      <span class="twrap" bind:this={palWrap}>
        <button
          class="icon"
          class:on={openPop === 'pal'}
          data-testid="note-color"
          title="Note color"
          aria-label="Note color"
          onclick={() => togglePop('pal')}
        ><Icon name="palette" /></button>
        {#if openPop === 'pal'}
          <div class="pop palmenu" style={popStyle}>
            <div class="pgrid">
              {#each PALETTES as p}
                <button
                  class="pchip"
                  data-testid="palette-chip"
                  data-palette={p.id}
                  style="background: {p.bg}"
                  title={p.name}
                  aria-label={p.name}
                  onclick={() => {
                    store.update(note!.id, { paletteId: p.id });
                    openPop = null;
                  }}
                >
                  {#if note.paletteId === p.id}
                    <span class="pcheck" style="color: {p.fg}"><Icon name="check" size={15} /></span>
                  {/if}
                </button>
              {/each}
              <!-- Nine colours in a five-wide grid: this holds the tenth slot so
                   the patterns are the whole third row, not a wrapped tail. -->
              <span class="pchip spacer" aria-hidden="true"></span>
              {#each PATTERNS as p}
                <button
                  class="pchip nz-pat-{p.pattern}"
                  data-testid="palette-chip"
                  data-palette={p.id}
                  style="--pat-base: {p.header}; --pat-ink: color-mix(in srgb, {p.fg} 34%, {p.header})"
                  title={p.name}
                  aria-label={p.name}
                  onclick={() => {
                    store.update(note!.id, { paletteId: p.id });
                    openPop = null;
                  }}
                >
                  {#if note.paletteId === p.id}
                    <span class="pcheck" style="color: {p.fg}"><Icon name="check" size={15} /></span>
                  {/if}
                </button>
              {/each}
              {#if isCustom}
                <span class="pchip current" style="background: {pal.bg}">
                  <span class="pcheck" style="color: {pal.fg}"><Icon name="check" size={15} /></span>
                </span>
              {/if}
            </div>
            <label class="crow">
              <input
                class="hue"
                type="range" min="0" max="360" step="1"
                data-testid="custom-hue"
                aria-label="Custom color hue"
                bind:value={custHue}
                oninput={applyCustom}
              />
            </label>
            <label class="crow">
              <input
                class="shade"
                type="range" min="30" max="94" step="1"
                aria-label="Custom color shade"
                style="--hue: {custHue}; --sat: {custSat}%"
                bind:value={custLight}
                oninput={applyCustom}
              />
            </label>
            <label class="crow">
              <input
                class="desat"
                type="range" min="0" max="90" step="1"
                aria-label="Custom color saturation"
                style="--hue: {custHue}"
                bind:value={custSat}
                oninput={applyCustom}
              />
            </label>
          </div>
        {/if}
      </span>

      <span class="twrap" bind:this={sizeWrapEl}>
        <button
          class="icon aa"
          class:on={openPop === 'size'}
          data-testid="tools-toggle"
          title="Base text size{desktop ? ' & sticker opacity' : ''}"
          onclick={() => togglePop('size')}
        >Aa·{note.fontSize}</button>
        {#if openPop === 'size'}
          <div class="pop panel" style={popStyle}>
            <div class="ctl">
              <div class="crowhead">
                <span>Text size</span>
                <span class="val" data-testid="size-value">{note.fontSize}</span>
              </div>
              <input
                type="range" min="12" max="40" step="1"
                data-testid="size-slider"
                value={note.fontSize}
                oninput={(e) => store.update(note!.id, { fontSize: +(e.currentTarget as HTMLInputElement).value })}
              />
            </div>
            {#if desktop}
              <div class="ctl">
                <div class="crowhead">
                  <span>Sticker opacity</span>
                  <span class="val" data-testid="opacity-value">{Math.round(note.opacity * 100)}%</span>
                </div>
                <input
                  type="range" min="0.2" max="1" step="0.05"
                  data-testid="opacity-slider"
                  value={note.opacity}
                  oninput={(e) => store.update(note!.id, { opacity: +(e.currentTarget as HTMLInputElement).value })}
                />
              </div>
            {/if}
          </div>
        {/if}
      </span>

      <button
        class="icon"
        data-testid="pane-pin"
        class:on={note.pinned}
        aria-pressed={note.pinned}
        title={note.pinned ? 'Unpin from desktop' : 'Pin as desktop sticky'}
        aria-label="Pin note"
        onclick={() => store.update(note!.id, { pinned: !note!.pinned })}
      ><Icon name="pin" /></button>
      <button
        class="icon danger"
        data-testid="note-delete"
        title="Delete note"
        aria-label="Delete note"
        onclick={deleteNote}
      ><Icon name="trash" /></button>
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
    <button class="bignew" data-testid="empty-new" onclick={() => store.create()}>
      <Icon name="add" size={18} /> New note
    </button>
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
    border-radius: var(--radius-md);
    background: var(--app-fg);
    color: var(--app-bg);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px 8px 12px; /* insets: left matches list, right keeps trash off the edge */
    /* -color, not the shorthand: the shorthand would wipe a pattern's background-image */
    background-color: var(--note-header);
  }
  .title {
    flex: 1 1 0;
    /* An <input> has an intrinsic min width; without this the topbar can't
       shrink and pushes the right-hand buttons off-screen entirely. */
    min-width: 0;
    width: 0;
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
    color: var(--note-fg);
    height: 34px;
    min-width: 34px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0.55;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .icon:hover {
    /* Mixed from the note's ink so dark palettes get a visible hover. */
    background: color-mix(in srgb, var(--note-fg) 9%, transparent);
    opacity: 1;
  }
  /* Monochrome active state: invert the note's colors. */
  .icon.on {
    opacity: 1;
    background: var(--note-fg);
    color: var(--note-bg);
  }
  /* Fullscreen/back toggles only exist in the phone layout. */
  .mob {
    display: none;
    opacity: 0.8;
  }
  /* Phone: the pane is the lower 70% of the stacked split, or all of it in
     fullscreen (.note-open on the page's <main>). */
  @media (max-width: 700px) {
    .mob {
      display: inline-flex;
    }
    .pane {
      height: 70%;
      flex: none;
      width: 100%;
    }
    :global(.note-open) > .pane {
      height: 100%;
    }
  }
  .twrap {
    position: relative;
    display: inline-flex;
  }
  /* Popovers are fixed-positioned via inline style (see popoverStyle). */
  .pop {
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
  }
  .palmenu {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    width: 226px;
  }
  .pgrid {
    display: grid;
    grid-template-columns: repeat(5, 34px);
    gap: 8px;
  }
  .pchip {
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(0, 0, 0, 0.16);
    cursor: pointer;
    padding: 0;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .pchip:hover {
    transform: scale(1.08);
  }
  .pchip.current {
    cursor: default;
  }
  .pchip.spacer {
    visibility: hidden;
  }
  .pcheck {
    display: inline-flex;
  }
  .pchip.nz-pat-checker .pcheck,
  .pchip.nz-pat-stripes .pcheck,
  .pchip.nz-pat-dots .pcheck,
  .pchip.nz-pat-stairs .pcheck,
  .pchip.nz-pat-bricks .pcheck {
    background: var(--pat-base);
    border-radius: var(--radius-sm);
    padding: 1px;
  }
  /* Inline custom color: hue wheel flattened into a slider + shade. */
  .crow {
    display: block;
  }
  .crow input[type='range'] {
    width: 100%;
    height: 22px;
    appearance: none;
    -webkit-appearance: none;
    border-radius: var(--radius-md);
    outline: none;
    cursor: pointer;
  }
  .crow input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--app-panel);
    border: 2px solid var(--app-fg);
  }
  .hue {
    background: linear-gradient(
      to right,
      hsl(0, 70%, 70%),
      hsl(60, 70%, 70%),
      hsl(120, 70%, 70%),
      hsl(180, 70%, 70%),
      hsl(240, 70%, 70%),
      hsl(300, 70%, 70%),
      hsl(360, 70%, 70%)
    );
  }
  .shade {
    background: linear-gradient(
      to right,
      hsl(var(--hue), var(--sat, 70%), 30%),
      hsl(var(--hue), var(--sat, 70%), 94%)
    );
  }
  .desat {
    background: linear-gradient(
      to right,
      hsl(var(--hue), 0%, 75%),
      hsl(var(--hue), 90%, 75%)
    );
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px 16px;
    width: 270px;
  }
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .crowhead {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    color: var(--app-muted);
  }
  .ctl input[type='range'] {
    width: 100%;
    accent-color: var(--app-fg);
  }
  .icon.aa {
    font-size: 14px;
    white-space: nowrap;
    width: auto;
    padding: 0 10px;
  }
  .editorWrap {
    flex: 1;
    min-height: 0;
  }
</style>
