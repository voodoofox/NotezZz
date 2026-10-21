<script lang="ts">
  // The formatting strip at the bottom of the note. Owns the size menu, the
  // image picker and the record button's UI; the TipTap instance and the
  // recorder are the Editor's.
  //
  // The tools are a list, so a note too narrow for all of them (a small
  // sticky, a squeezed pane) shows as many as fit and folds the rest into
  // a ⋯ at the end, instead of scrolling them off the edge unseen.
  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import { FONT_SIZES } from '../editor/fontSize';
  import type { VoiceRecorder } from '../editor/recorder.svelte';
  import { downscaleImage } from '$lib/image';
  import { popoverStyle } from '$lib/popover';
  import type { IconName } from '$lib/icons';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor | null;
    /** Bumped by the Editor on every transaction so active states re-read. */
    tick: number;
    recorder: VoiceRecorder;
    onRecord: () => void;
    onDraw: () => void;
  }
  let { editor, tick, recorder, onRecord, onDraw }: Props = $props();

  let showSizes = $state(false);
  let sizeWrap = $state<HTMLDivElement | null>(null);
  let barEl = $state<HTMLElement | null>(null);
  let sizeMenuStyle = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

  /** How many tools the bar shows; the rest live in the ⋯ menu. */
  let fit = $state(Number.MAX_SAFE_INTEGER);
  let showMore = $state(false);
  let moreWrap = $state<HTMLDivElement | null>(null);
  let moreStyle = $state('');
  /** The ⋯ menu lists the folded tools, or the sizes once "Text size" is picked there. */
  let moreView = $state<'list' | 'size'>('list');

  interface Tool {
    id: string;
    icon: IconName;
    label: string;
    title?: string;
    /** A divider before this tool in the bar. */
    sep?: boolean;
    run: () => void;
    active?: () => boolean;
  }

  function isActive(name: string, attrs?: Record<string, unknown>) {
    void tick; // establish reactive dependency
    return editor?.isActive(name, attrs) ?? false;
  }

  const tools: Tool[] = [
    { id: 'bold', icon: 'bold', label: 'Bold', title: 'Bold (Ctrl+B)', run: () => editor?.chain().focus().toggleBold().run(), active: () => isActive('bold') },
    { id: 'italic', icon: 'italic', label: 'Italic', title: 'Italic (Ctrl+I)', run: () => editor?.chain().focus().toggleItalic().run(), active: () => isActive('italic') },
    { id: 'underline', icon: 'underline', label: 'Underline', title: 'Underline (Ctrl+U)', run: () => editor?.chain().focus().toggleUnderline().run(), active: () => isActive('underline') },
    { id: 'strike', icon: 'strike', label: 'Strikethrough', run: () => editor?.chain().focus().toggleStrike().run(), active: () => isActive('strike') },
    { id: 'bullet', icon: 'bulletList', label: 'Bullet list', sep: true, run: () => editor?.chain().focus().toggleBulletList().run(), active: () => isActive('bulletList') },
    { id: 'checklist', icon: 'checklist', label: 'Checklist', run: () => editor?.chain().focus().toggleTaskList().run(), active: () => isActive('taskList') },
    { id: 'draw', icon: 'draw', label: 'Draw', title: 'Draw a sketch', sep: true, run: () => onDraw() },
    { id: 'size', icon: 'textSize', label: 'Text size', sep: true, run: () => toggleSizes(), active: () => showSizes },
    { id: 'image', icon: 'image', label: 'Insert image', run: () => fileInput?.click() },
    { id: 'record', icon: 'mic', label: 'Record voice memo', run: () => onRecord(), active: () => recorder.recording },
  ];

  // .sep is 1px with 5px margins; phones hide it (see the media query below).
  const SEP_W = 11;

  /** Count the tools that fit the bar, leaving room for ⋯ when not all do. */
  function measure() {
    if (!barEl) return;
    const first = barEl.querySelector('button');
    if (!first) return;
    const cs = getComputedStyle(barEl);
    const avail = barEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap) || 0;
    const btn = first.getBoundingClientRect().width;
    const sepW = matchMedia('(max-width: 700px)').matches ? 0 : SEP_W;
    const width = (n: number) => {
      let w = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) w += gap;
        if (i > 0 && tools[i].sep) w += sepW + gap;
        w += btn;
      }
      return w;
    };
    if (width(tools.length) <= avail + 0.5) {
      fit = tools.length;
      return;
    }
    let k = tools.length - 1;
    while (k > 0 && width(k) + gap + btn > avail + 0.5) k--;
    fit = k;
  }

  onMount(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (barEl) ro.observe(barEl);
    return () => ro.disconnect();
  });

  // Nothing folded, nothing to show in ⋯.
  $effect(() => {
    if (fit >= tools.length) {
      showMore = false;
      moreView = 'list';
    }
  });

  function toggleSizes() {
    if (!showSizes && sizeWrap) sizeMenuStyle = popoverStyle(sizeWrap, 168, 'center', barEl);
    showSizes = !showSizes;
  }

  function toggleMore() {
    if (!showMore && moreWrap) moreStyle = popoverStyle(moreWrap, 200, 'end', barEl);
    moreView = 'list';
    showMore = !showMore;
  }

  function pick(t: Tool) {
    if (t.id === 'size') {
      moreView = 'size';
      return;
    }
    showMore = false;
    t.run();
  }

  function closeSizes() {
    showSizes = false;
    showMore = false;
    moreView = 'list';
  }

  // Tapping anywhere else (including the text) closes the menus.
  function onGlobalPointerDown(e: PointerEvent) {
    const t = e.target as Node;
    if (showSizes && sizeWrap && !sizeWrap.contains(t)) showSizes = false;
    if (showMore && moreWrap && !moreWrap.contains(t)) showMore = false;
  }

  /** Insert a photo/image, downscaled so notes stay reasonably sized. */
  async function importImage(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !editor) return;
    const scaled = await downscaleImage(file, 1280);
    if (scaled && editor && !editor.isDestroyed) {
      editor.chain().focus().insertContent({ type: 'image', attrs: { src: scaled.src } }).run();
    }
  }

  function currentSize(): string {
    void tick;
    return (editor?.getAttributes('textStyle').fontSize ?? '').replace('px', '');
  }

  function recordLabel(): string {
    return recorder.recording ? 'Stop recording' : 'Record voice memo';
  }
  function recordTitle(): string {
    return recorder.recording ? `Stop recording (${recorder.seconds}s)` : 'Record voice memo';
  }

  // Format buttons leave the focus in the text. Taking it, they handed it
  // back a frame later (TipTap's focus()), and keys typed in that gap were
  // lost; on a phone the keyboard bounced.
  function keepFocus(e: MouseEvent) {
    e.preventDefault();
  }
</script>

<svelte:window onpointerdown={onGlobalPointerDown} />

{#snippet sizes(inline: boolean)}
  <div class="sizemenu" class:inline style={inline ? '' : sizeMenuStyle} data-testid="size-menu">
    <button
      class="sopt"
      class:cur={currentSize() === ''}
      onclick={() => {
        editor?.chain().focus().unsetFontSize().run();
        closeSizes();
      }}
    >Auto</button>
    {#each FONT_SIZES as s}
      <button
        class="sopt"
        class:cur={currentSize() === String(s)}
        onclick={() => {
          editor?.chain().focus().setFontSize(`${s}px`).run();
          closeSizes();
        }}
      >{s}</button>
    {/each}
  </div>
{/snippet}

<div class="toolbar" bind:this={barEl}>
  {#each tools as t, i (t.id)}
    {#if i < fit}
      {#if t.sep && i > 0}<span class="sep"></span>{/if}
      {#if t.id === 'size'}
        <div class="sizewrap" bind:this={sizeWrap}>
          <button
            data-testid="fmt-size"
            class:active={showSizes}
            aria-pressed={showSizes}
            aria-expanded={showSizes}
            title="Text size"
            aria-label="Text size"
            onclick={toggleSizes}
          ><Icon name="textSize" /></button>
          {#if showSizes}{@render sizes(false)}{/if}
        </div>
      {:else if t.id === 'record'}
        <button
          data-testid="fmt-record"
          class="rec"
          class:recording={recorder.recording}
          aria-pressed={recorder.recording}
          title={recordTitle()}
          aria-label={recordLabel()}
          onclick={onRecord}
        >
          <Icon name={recorder.recording ? 'stop' : 'mic'} />
        </button>
      {:else}
        <button
          data-testid="fmt-{t.id}"
          onmousedown={keepFocus}
          class:active={t.active?.() ?? false}
          aria-pressed={t.active ? t.active() : undefined}
          title={t.title ?? t.label}
          aria-label={t.label}
          onclick={t.run}
        ><Icon name={t.icon} /></button>
      {/if}
    {/if}
  {/each}

  {#if fit < tools.length}
    <div class="morewrap" bind:this={moreWrap}>
      <button
        data-testid="fmt-overflow"
        onmousedown={keepFocus}
        class:active={showMore}
        class:recording={recorder.recording}
        aria-expanded={showMore}
        aria-haspopup="menu"
        title="More tools"
        aria-label="More tools"
        onclick={toggleMore}
      ><Icon name="more" /></button>
      {#if showMore}
        <div class="moremenu" style={moreStyle} role="menu" data-testid="fmt-overflow-menu">
          {#if moreView === 'size'}
            {@render sizes(true)}
          {:else}
            {#each tools.slice(fit) as t (t.id)}
              <button
                class="mi"
                class:active={t.id !== 'size' && (t.active?.() ?? false)}
                class:recording={t.id === 'record' && recorder.recording}
                role="menuitem"
                data-testid="fmt-{t.id}"
                onmousedown={keepFocus}
                onclick={() => pick(t)}
              >
                <Icon name={t.id === 'record' && recorder.recording ? 'stop' : t.icon} />
                <span>{t.id === 'record' ? recordLabel() : t.label}</span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <input
    type="file"
    accept="image/*"
    data-testid="image-input"
    hidden
    bind:this={fileInput}
    onchange={importImage}
  />
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--btn-gap);
    padding: var(--edge);
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    /* As solid as the theme says (Daylight: none, just the buttons). */
    background: color-mix(in srgb, var(--note-header) var(--note-chin-mix), transparent);
    /* At the bottom of the note everywhere (phones, stickies and the full
       app alike): within thumb reach, and Android's text-selection bubble,
       which appears above a selection, can never cover it. Tints are mixed
       from the note's own ink so dark palettes get a visible line too. */
    order: 2;
    border-top: 1px solid color-mix(in srgb, var(--note-fg) var(--note-chin-line), transparent);
  }
  .toolbar::-webkit-scrollbar {
    display: none;
  }
  .toolbar button {
    font: inherit;
    font-size: 15px;
    color: var(--note-fg);
    background: transparent;
    border: none;
    border-radius: var(--btn-radius);
    width: var(--btn);
    height: var(--btn);
    padding: 0;
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* Hover only with a real pointer: a phone keeps :hover on whatever was
     tapped last. A press shows on every device. */
  @media (hover: hover) {
    .toolbar button:hover {
      background: color-mix(in srgb, var(--note-fg) 8%, transparent);
    }
  }
  .toolbar button:active {
    background: color-mix(in srgb, var(--note-fg) 16%, transparent);
  }
  /* Monochrome active state: invert the note's own colors. */
  .toolbar button.active {
    background: var(--note-fg);
    color: var(--note-bg);
  }
  .sizewrap,
  .morewrap {
    position: relative;
    display: inline-flex;
  }
  .sizemenu {
    /* position:fixed via inline popoverStyle — the toolbar's overflow
       clipping made absolutely-positioned menus invisible. Two columns keep
       it short enough to fit in small windows. */
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: var(--edge);
    background: var(--app-panel);
    border: 1px solid var(--app-border);
    border-radius: var(--sticker-radius);
    box-shadow: var(--sticker-shadow);
  }
  /* The same grid as a page of the ⋯ menu: no second balloon. */
  .sizemenu.inline {
    position: static;
    border: none;
    box-shadow: none;
    padding: 0;
  }
  .sopt {
    font: inherit;
    font-size: 17px;
    min-width: 0;
    padding: 10px 6px;
    border: none;
    border-radius: var(--btn-radius);
    background: transparent;
    color: var(--app-fg);
    cursor: pointer;
    text-align: center;
  }
  .sopt:hover {
    background: var(--app-bg);
  }
  .sopt.cur {
    background: var(--app-fg);
    color: var(--app-panel);
  }
  /* The ⋯ menu: the folded tools as rows, icon then name, in the app's
     panel colours like every other menu. */
  .moremenu {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--edge);
    background: var(--app-panel);
    border: 1px solid var(--app-border);
    border-radius: var(--sticker-radius);
    box-shadow: var(--sticker-shadow);
  }
  .toolbar .mi {
    width: 100%;
    height: auto;
    justify-content: flex-start;
    gap: 10px;
    padding: 8px 10px;
    color: var(--app-fg);
    text-align: left;
    white-space: nowrap;
  }
  @media (hover: hover) {
    .toolbar .mi:hover {
      background: var(--app-bg);
    }
  }
  .toolbar .mi.active {
    background: var(--app-fg);
    color: var(--app-panel);
  }
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 5px;
    background: color-mix(in srgb, var(--note-fg) 16%, transparent);
    flex-shrink: 0;
  }
  /* Recording: the button turns red (functional colour, not decoration),
     stays one button wide, and stays red under a touch's sticky :hover.
     Folded into ⋯ while recording, the ⋯ carries the red instead. */
  .toolbar .recording,
  .toolbar .recording:hover,
  .toolbar .recording:active {
    background: var(--app-danger);
    color: #fff;
  }

  /* Phones: formatting tools live at the BOTTOM (thumb-reach, and Android's
     text-selection bubble — which always appears above the selection — can
     never cover them). Buttons stretch to equal widths filling the full row,
     Material-style. */
  @media (max-width: 700px) {
    .toolbar {
      padding: var(--edge) var(--edge) calc(var(--edge) + max(env(safe-area-inset-bottom), var(--safe-bottom, 0px)));
    }
    /* The buttons spread evenly over the whole row, the last one on the
       line the note's ⋯ and the header's + share. */
    .toolbar {
      justify-content: space-between;
    }
    .sep {
      display: none;
    }
  }
</style>
