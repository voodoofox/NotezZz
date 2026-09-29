<script lang="ts">
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { store } from '$lib/store.svelte';
  import { logDiag } from '$lib/diag';
  import { isDesktop } from '$lib/storage/backend';
  import { getPalette } from '$lib/palettes';
  import ColorPicker from './ColorPicker.svelte';
  import { tuckState, requestTuck } from '$lib/tuck.svelte';
  import Editor from './Editor.svelte';
  import Icon from './Icon.svelte';

  import { popoverStyle } from '$lib/popover';

  let note = $derived(store.active);
  let pal = $derived(getPalette(note?.paletteId ?? ''));
  // Sticker opacity and tuck act on a sticky window; the pin itself is
  // cross-device (pin on the phone, it appears on the PC) and stays everywhere.
  const desktop = isDesktop();
  // Fullscreen is history state (see +page.svelte); read it from there rather
  // than store.mobileOpen so this pane never disagrees with the page.
  let fullscreen = $derived((page.state as { fs?: boolean }).fs === true);

  // Toolbar popovers (note color / base text size), fixed-positioned so the
  // toolbar's overflow can't clip them; any outside tap closes them.
  let openPop = $state<'pal' | 'size' | 'remind' | null>(null);
  let popStyle = $state('');
  let palWrap = $state<HTMLElement | null>(null);
  let sizeWrapEl = $state<HTMLElement | null>(null);
  let remindWrap = $state<HTMLElement | null>(null);

  function togglePop(which: 'pal' | 'size' | 'remind') {
    if (openPop === which) return void (openPop = null);
    const anchor = which === 'pal' ? palWrap : which === 'size' ? sizeWrapEl : remindWrap;
    if (anchor) popStyle = popoverStyle(anchor, which === 'pal' ? 226 : which === 'size' ? 270 : 250);
    openPop = which;
  }

  // ---- reminders --------------------------------------------------------
  const HOUR = 3_600_000;

  function at(day: Date, h: number): number {
    const d = new Date(day);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  }

  /** One-tap times, only the ones still ahead of us. */
  function quickTimes(): { label: string; at: number }[] {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const monday = new Date(now);
    monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
    const out = [{ label: 'In 1 hour', at: now.getTime() + HOUR }];
    if (now.getHours() < 17) out.push({ label: 'This evening', at: at(now, 18) });
    out.push({ label: 'Tomorrow 9:00', at: at(tomorrow, 9) });
    out.push({ label: 'Monday 9:00', at: at(monday, 9) });
    return out;
  }

  function fmtWhen(t: number): string {
    const d = new Date(t);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return sameDay ? `Today ${time}` : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
  }

  /** epoch ms -> the value a datetime-local input wants (local time, no zone). */
  function toLocalInput(t?: number): string {
    if (!t) return '';
    const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
    return d.toISOString().slice(0, 16);
  }

  function setRemind(t: number | null) {
    if (!note) return;
    store.setReminder(note.id, t);
    openPop = null;
  }

  function closePopsOutside(e: PointerEvent) {
    if (!openPop) return;
    const t = e.target as Node;
    if (!palWrap?.contains(t) && !sizeWrapEl?.contains(t) && !remindWrap?.contains(t)) openPop = null;
  }

  // Evidence for Diagnostics: a pattern that fails to paint on some machine
  // is a report we can't reproduce here, so record what the title bar
  // computes the moment a pattern is shown.
  $effect(() => {
    const id = pal.pattern ? pal.id : null;
    if (!id) return;
    requestAnimationFrame(() => {
      const tb = document.querySelector('.topbar');
      if (!tb) return;
      const cs = getComputedStyle(tb);
      logDiag(
        `PAT ${id} cls=${tb.className.includes('nz-pat-')} img=${cs.backgroundImage.slice(0, 14)} anim=${cs.animationName} ink=${cs.getPropertyValue('--pat-ink').trim()}`
      );
    });
  });

  /** Exit fullscreen via history; if the entry got lost (e.g. a reload while
   *  fullscreen), force the state clear so the button always works. Both
   *  paths change page.state — the page effect turns that into mobileOpen. */
  function exitFullscreen() {
    history.back();
    setTimeout(() => {
      if ((page.state as { fs?: boolean }).fs) replaceState('', {});
    }, 250);
  }

  function toggleArchive() {
    if (!note) return;
    const wasFullscreen = fullscreen;
    const archiving = !note.archived;
    store.setArchived(note.id, archiving);
    if (archiving && wasFullscreen) exitFullscreen();
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
      --note-ink: {pal.ink ?? pal.fg};
      --pat-img: {pal.patternImage ?? 'none'};
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
            <ColorPicker
              paletteId={note.paletteId}
              onPick={(id) => {
                store.update(note!.id, { paletteId: id });
                // Sliders keep the menu open (they're continuous); a chip closes it.
                if (!id.startsWith('custom:')) openPop = null;
              }}
            />
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

      <span class="twrap" bind:this={remindWrap}>
        <button
          class="icon"
          class:on={openPop === 'remind' || !!note.remindAt}
          data-testid="note-remind"
          title={note.remindAt ? `Reminder: ${fmtWhen(note.remindAt)}` : 'Remind me'}
          aria-label="Reminder"
          onclick={() => togglePop('remind')}
        ><Icon name="alarm" /></button>
        {#if openPop === 'remind'}
          <div class="pop panel remind" style={popStyle} data-testid="remind-pop">
            <div class="crowhead">
              <span>Remind me</span>
              {#if note.remindAt}
                <span class="val" data-testid="remind-when">
                  {note.remindAt < Date.now() ? 'Was due ' : ''}{fmtWhen(note.remindAt)}
                </span>
              {/if}
            </div>
            <div class="quick">
              {#each quickTimes() as q (q.label)}
                <button data-testid="remind-quick" onclick={() => setRemind(q.at)}>{q.label}</button>
              {/each}
            </div>
            <input
              type="datetime-local"
              data-testid="remind-at"
              value={toLocalInput(note.remindAt)}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                if (v) setRemind(new Date(v).getTime());
              }}
            />
            {#if note.remindAt}
              <button class="clear" data-testid="remind-clear" onclick={() => setRemind(null)}>Clear reminder</button>
            {/if}
            <p class="rhint">When it's time, your PC pins the note as a sticky and your phone shows a notification.</p>
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
      {#if note.pinned && desktop}
        <button
          class="icon"
          data-testid="pane-tuck"
          class:on={tuckState.byId[note.id]}
          aria-pressed={!!tuckState.byId[note.id]}
          title={tuckState.byId[note.id] ? 'Bring the sticky back' : 'Tuck the sticky to the screen edge'}
          aria-label="Tuck sticky away"
          onclick={() => void requestTuck(note!.id, !tuckState.byId[note!.id])}
        ><Icon name={tuckState.byId[note.id] ? 'untuck' : 'tuck'} /></button>
      {/if}
      <button
        class="icon"
        data-testid="note-archive"
        title={note.archived ? 'Move back to notes' : 'Archive note'}
        aria-label={note.archived ? 'Move back to notes' : 'Archive note'}
        onclick={toggleArchive}
      ><Icon name={note.archived ? 'unarchive' : 'archive'} /></button>
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
          noteId={note.id}
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
  :global(.app.stacked) > .pane {
    height: 70%;
    flex: none;
    width: 100%;
  }
  @media (max-width: 700px) {
    .mob {
      display: inline-flex;
    }
    .pane {
      height: 70%;
      flex: none;
      width: 100%;
    }
    /* .app.note-open, not just .note-open: the stacked rule above is as
       specific as .app.stacked, and on a phone both classes are set, so a
       weaker selector left the fullscreen note at 70% (0.22.0). */
    :global(.app.note-open) > .pane {
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
  .remind {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px 14px;
    width: 250px;
  }
  .remind .quick {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .remind button {
    font: inherit;
    font-size: 13px;
    padding: 7px 8px;
    border: 1px solid var(--app-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--app-fg);
    cursor: pointer;
  }
  .remind button:hover {
    border-color: var(--app-fg);
  }
  .remind input[type='datetime-local'] {
    font: inherit;
    font-size: 14px;
    padding: 6px 8px;
    border: 1px solid var(--app-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--app-fg);
    color-scheme: light dark;
  }
  .remind .rhint {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--app-muted);
  }
  .palmenu {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    width: 226px;
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
