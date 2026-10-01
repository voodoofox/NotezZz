<script lang="ts">
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { store } from '$lib/store.svelte';
  import { logDiag } from '$lib/diag';
  import { isDesktop } from '$lib/storage/backend';
  import { getPalette } from '$lib/palettes';
  import ColorPicker from './ColorPicker.svelte';
  import Editor from './Editor.svelte';
  import Icon from './Icon.svelte';

  import { popoverStyle } from '$lib/popover';
  import VSlider from './VSlider.svelte';
  import { luminance } from '$lib/theme';

  let note = $derived(store.active);
  let pal = $derived(getPalette(note?.paletteId ?? ''));
  // Sticker opacity and tuck act on a sticky window; the pin itself is
  // cross-device (pin on the phone, it appears on the PC) and stays everywhere.
  const desktop = isDesktop();
  // Fullscreen is history state (see +page.svelte); read it from there rather
  // than store.mobileOpen so this pane never disagrees with the page.
  let fullscreen = $derived((page.state as { fs?: boolean }).fs === true);

  /** The tuck button acts on the PC's sticky from anywhere; say so off the PC. */
  const tuckTitle = (on: boolean | undefined) =>
    desktop
      ? on ? 'Bring the sticky back' : 'Tuck the sticky to the screen edge'
      : on ? 'Bring the sticky back on your PC' : 'Tuck the sticky away on your PC';

  // The bar is the same on every screen: the title gets the room; the pin,
  // tuck (while pinned) and reminder (while one is set) stay in it, and
  // everything else lives in the ⋯ menu.

  // Header popovers (colour, text size, transparency, reminder, the ⋯
  // menu), fixed-positioned so nothing clips them; any outside tap closes
  // them. All of them hang from the ⋯ button, right edges lined up.
  type Pop = 'pal' | 'size' | 'opacity' | 'remind' | 'more';
  let openPop = $state<Pop | null>(null);
  let popStyle = $state('');
  let remindWrap = $state<HTMLElement | null>(null);
  let barEl = $state<HTMLElement | null>(null);
  let moreWrap = $state<HTMLElement | null>(null);
  let popEl = $state<HTMLElement | null>(null);

  /** Three buttons and the two gaps between them, measured off a real button. */
  const threeButtons = (a: HTMLElement) => {
    // getBoundingClientRect, not offsetWidth: on phones the size is fractional.
    const btn = (a.querySelector('button') ?? a).getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(a).getPropertyValue('--btn-gap')) || 0;
    return btn * 3 + gap * 2;
  };
  const popWidth = (which: Pop, a: HTMLElement) =>
    which === 'pal' ? 226 : which === 'size' || which === 'opacity' ? threeButtons(a) : which === 'remind' ? 250 : 236;

  function togglePop(which: Pop) {
    if (openPop === which) return void (openPop = null);
    if (moreWrap) popStyle = popoverStyle(moreWrap, popWidth(which, moreWrap), 'end', barEl);
    openPop = which;
  }

  /** A ⋯ menu entry that opens a panel: the panel takes the menu's place. */
  function fromMenu(which: 'pal' | 'size' | 'opacity' | 'remind') {
    openPop = null;
    togglePop(which);
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
    if ([remindWrap, moreWrap, popEl].some((el) => el?.contains(t))) return;
    openPop = null;
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
    openPop = null;
    const wasFullscreen = fullscreen;
    const archiving = !note.archived;
    store.setArchived(note.id, archiving);
    if (archiving && wasFullscreen) exitFullscreen();
  }

  /** Only offered in the archive: archiving is the everyday way to put a
   *  note away (with Undo), deleting is the deliberate second step. */
  function deleteNote() {
    openPop = null;
    if (!note || !confirm("Delete this note forever? This can't be undone.")) return;
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
      --note-lum: {luminance(pal.bg)};
      --note-header: {pal.header};
      --note-fg: {pal.fg};
      --note-ink: {pal.ink ?? pal.fg};
      --pat-img: {pal.patternImage ?? 'none'};
      color-scheme: {pal.dark ? 'dark' : 'light'};
    "
  >
    <div class="topbar {pal.pattern ? `nz-pat-${pal.pattern}` : ''}" bind:this={barEl}>
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
{#if note.remindAt}
        <span class="twrap" bind:this={remindWrap}>
          <button
            class="icon on"
            data-testid="note-remind"
            title={`Reminder: ${fmtWhen(note.remindAt)}`}
            aria-label="Reminder"
            onclick={() => togglePop('remind')}
          ><Icon name="alarm" /></button>
        </span>
      {/if}

      <button
        class="icon"
        data-testid="pane-pin"
        class:on={note.pinned}
        aria-pressed={note.pinned}
        title={note.pinned ? 'Unpin from desktop' : 'Pin as desktop sticky'}
        aria-label="Pin note"
        onclick={() => store.update(note!.id, { pinned: !note!.pinned })}
      ><Icon name="pin" /></button>

      {#if note.pinned}
        <button
          class="icon"
          data-testid="pane-tuck"
          class:on={!!note.tucked}
          aria-pressed={!!note.tucked}
          title={tuckTitle(note.tucked)}
          aria-label={tuckTitle(note.tucked)}
          onclick={() => store.update(note!.id, { tucked: !note!.tucked })}
        ><Icon name={note.tucked ? 'untuck' : 'tuck'} /></button>
      {/if}

      <span class="twrap" bind:this={moreWrap}>
        <button
          class="icon"
          class:on={openPop === 'more'}
          data-testid="note-more"
          title="More"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={openPop === 'more'}
          onclick={() => togglePop('more')}
        ><Icon name="more" /></button>
      </span>

      <!-- One popover at a time, outside the buttons' wrappers: a panel
           opened from the ⋯ menu belongs to no visible button. -->
      {#if openPop}
        <div class="popwrap" bind:this={popEl}>
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
          {:else if openPop === 'size'}
            <div class="pop panel sizepanel" style={popStyle}>
              <VSlider
                value={note.fontSize}
                min={12}
                max={40}
                label="Text size"
                testid="size-slider"
                valueTestid="size-value"
                onInput={(v) => store.update(note!.id, { fontSize: v })}
              />
            </div>
          {:else if openPop === 'opacity'}
            <div class="pop panel sizepanel" style={popStyle}>
              <VSlider
                value={Math.round(note.opacity * 100)}
                min={20}
                max={100}
                step={5}
                label="Opacity"
                testid="opacity-slider"
                valueTestid="opacity-value"
                display="{Math.round(note.opacity * 100)}%"
                onInput={(v) => store.update(note!.id, { opacity: v / 100 })}
              />
            </div>
          {:else if openPop === 'remind'}
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
          {:else if openPop === 'more'}
            <div class="pop menu" role="menu" style={popStyle} data-testid="note-menu">
              <button class="mi" role="menuitem" data-testid="menu-color" onclick={() => fromMenu('pal')}>
                <Icon name="palette" /><span>Note color</span>
              </button>
              <button class="mi" role="menuitem" data-testid="menu-size" onclick={() => fromMenu('size')}>
                <Icon name="noteSize" /><span>Text size</span><span class="mv">{note.fontSize}</span>
              </button>
              <button class="mi" role="menuitem" data-testid="menu-remind" onclick={() => fromMenu('remind')}>
                <Icon name="alarm" /><span>{note.remindAt ? 'Reminder' : 'Remind me'}</span>
                {#if note.remindAt}<span class="mv">{fmtWhen(note.remindAt)}</span>{/if}
              </button>
              {#if desktop && note.pinned}
                <button class="mi" role="menuitem" data-testid="menu-opacity" onclick={() => fromMenu('opacity')}>
                  <Icon name="opacity" /><span>Transparency</span>
                  <span class="mv">{Math.round(note.opacity * 100)}%</span>
                </button>
              {/if}
              <button class="mi" role="menuitem" data-testid="menu-archive" onclick={toggleArchive}>
                <Icon name={note.archived ? 'unarchive' : 'archive'} />
                <span>{note.archived ? 'Move back to notes' : 'Archive'}</span>
              </button>
              {#if note.archived}
                <button class="mi danger" role="menuitem" data-testid="menu-delete" onclick={deleteNote}>
                  <Icon name="deleteForever" /><span>Delete forever</span>
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
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
    /* The note as a surface: the theme's grain and shade from above over
       the note's colour; the light from below is added by ::before. */
    position: relative;
    isolation: isolate;
    background-color: var(--note-bg);
    /* The shade: the ellipse's part above its centre. */
    background-image: var(--note-shade);
    background-size: var(--note-shade-size);
    background-position: center top;
    background-repeat: no-repeat;
    color: var(--note-fg);
    height: 100%;
  }
  /* The theme's light from below, ADDED to the note's colour (plus-lighter):
     the same lift on every colour, where a plain white overlay brightened
     dark notes far more than light ones. Under the note's contents. */
  .pane::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background-image: var(--note-light);
    background-size: var(--note-light-size); /* the ellipse below its centre */
    background-position: center bottom;
    background-repeat: no-repeat;
    /* Full on a white note, lightOnDark of it on a black one. */
    opacity: calc(var(--note-light-on-dark) + (1 - var(--note-light-on-dark)) * var(--note-lum, 1));
    mix-blend-mode: plus-lighter;
  }
  /* The grain, on top of the shade AND the light, so it dithers both (a
     faint gradient across a big note otherwise steps in visible bands).
     hard-light around neutral grey: it lightens and darkens the colour
     without greying it. Under the note's contents, like the light. */
  .pane::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background-image: var(--note-grain);
    mix-blend-mode: hard-light;
  }
  .pane.empty::before,
  .pane.empty::after {
    display: none;
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
    gap: var(--btn-gap);
    /* The title (2px into its input) in line with the note's text. */
    padding: var(--edge) var(--edge) var(--edge) calc(var(--text-inset) - 2px);
    /* The title strip is the note's adhesive: as solid as the theme says.
       -color, not the shorthand: the shorthand would wipe a pattern's
       background-image, which these two variables tone down with it. */
    background-color: color-mix(in srgb, var(--note-header) var(--note-header-mix), transparent);
    --pat-base: color-mix(in srgb, var(--note-header) var(--note-header-mix), transparent);
    --pat-ink: color-mix(in srgb, var(--note-ink) var(--note-pat-mix), transparent);
    box-shadow: var(--note-strip); /* the adhesive tint */
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
  /* The same buttons as the formatting toolbar below: size, ink and hover.
     (They used to be smaller and faded to 55%, so the two bars disagreed.) */
  .icon {
    border: none;
    background: transparent;
    color: var(--note-fg);
    width: var(--btn);
    height: var(--btn);
    padding: 0;
    border-radius: var(--btn-radius);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .icon:hover {
    /* Mixed from the note's ink so dark palettes get a visible hover. */
    background: color-mix(in srgb, var(--note-fg) 8%, transparent);
  }
  /* Monochrome active state: invert the note's colors. */
  .icon.on {
    background: var(--note-fg);
    color: var(--note-bg);
  }
  /* Fullscreen/back toggles only exist in the phone layout. */
  .mob {
    display: none;
  }
  /* Phone: the pane is the lower 70% of the stacked split, or all of it in
     fullscreen (.note-open on the page's <main>). */
  :global(.app.stacked) > .pane {
    flex: 1;
    min-height: 0;
    width: 100%;
  }
  @media (max-width: 700px) {
    .mob {
      display: inline-flex;
    }
    .topbar {
      padding: var(--edge);
    }
    .pane {
      flex: 1;
      min-height: 0;
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
  .popwrap {
    display: contents;
  }
  /* Popovers are fixed-positioned via inline style (see popoverStyle). */
  /* Balloons are small stickers. */
  .pop {
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: var(--sticker-radius);
    box-shadow: var(--sticker-shadow);
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
  .crowhead {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    color: var(--app-muted);
  }
  /* Text size (and, on the PC, sticker opacity): vertical sliders, low at
     the bottom, the value on top. */
  /* The text-size sticker is cut from the note itself: same colour, no
     edge, no shadow, so only the slider shows. Three buttons wide (set
     inline), 30% shorter than it was. */
  .sizepanel {
    flex-direction: row;
    justify-content: center;
    gap: 6px;
    padding: 10px 0 8px;
    background: var(--note-bg);
    color: var(--note-fg);
    border: none;
    box-shadow: none;
  }
  /* The ⋯ menu. */
  .menu {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--edge);
  }
  .mi {
    display: flex;
    align-items: center;
    gap: 12px;
    font: inherit;
    font-size: 15px;
    text-align: left;
    padding: 10px 12px;
    border: none;
    border-radius: var(--btn-radius);
    background: transparent;
    color: var(--app-fg);
    cursor: pointer;
  }
  .mi:hover {
    background: var(--app-bg);
  }
  .mi .mv {
    margin-left: auto;
    font-size: 13px;
    color: var(--app-muted);
  }
  .mi.danger {
    color: var(--app-danger);
  }
  .editorWrap {
    flex: 1;
    min-height: 0;
  }
</style>
