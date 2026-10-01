<script lang="ts">
  // The formatting strip at the bottom of the note. Owns its ⋯ menu (and
  // the size grid behind it), the image picker and the record button's UI; the
  // TipTap instance and the recorder are the Editor's.
  import type { Editor } from '@tiptap/core';
  import { FONT_SIZES } from '../editor/fontSize';
  import type { VoiceRecorder } from '../editor/recorder.svelte';
  import { downscaleImage } from '$lib/image';
  import { popoverStyle } from '$lib/popover';
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

  // The ⋯ at the end of the bar: the less used tools, and from there the
  // size grid for the selected text (like the note's own ⋯ menu).
  let open = $state<null | 'menu' | 'size'>(null);
  let moreWrap = $state<HTMLDivElement | null>(null);
  let barEl = $state<HTMLElement | null>(null);
  let menuStyle = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

  function show(which: 'menu' | 'size') {
    if (moreWrap) menuStyle = popoverStyle(moreWrap, which === 'menu' ? 230 : 168, 'end', barEl);
    open = which;
  }
  function toggleMore() {
    if (open) open = null;
    else show('menu');
  }
  /** Run a formatting command from the menu, then close it. */
  function fromMenu(run: (e: Editor) => void) {
    if (editor) run(editor);
    open = null;
  }

  // Tapping anywhere else (including the text) closes the menu.
  function onGlobalPointerDown(e: PointerEvent) {
    if (open && moreWrap && !moreWrap.contains(e.target as Node)) open = null;
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

  function isActive(name: string, attrs?: Record<string, unknown>) {
    void tick; // establish reactive dependency
    return editor?.isActive(name, attrs) ?? false;
  }

  function currentSize(): string {
    void tick;
    return (editor?.getAttributes('textStyle').fontSize ?? '').replace('px', '');
  }
</script>

<svelte:window onpointerdown={onGlobalPointerDown} />

<div class="toolbar" bind:this={barEl}>
  <button
    data-testid="fmt-bold"
    class:active={isActive('bold')}
    aria-pressed={isActive('bold')}
    title="Bold (Ctrl+B)"
    aria-label="Bold"
    onclick={() => editor?.chain().focus().toggleBold().run()}
  ><Icon name="bold" /></button>
  <button
    data-testid="fmt-italic"
    class:active={isActive('italic')}
    aria-pressed={isActive('italic')}
    title="Italic (Ctrl+I)"
    aria-label="Italic"
    onclick={() => editor?.chain().focus().toggleItalic().run()}
  ><Icon name="italic" /></button>
  <span class="sep"></span>

  <button
    data-testid="fmt-bullet"
    class:active={isActive('bulletList')}
    aria-pressed={isActive('bulletList')}
    title="Bullet list"
    aria-label="Bullet list"
    onclick={() => editor?.chain().focus().toggleBulletList().run()}
  ><Icon name="bulletList" /></button>
  <button
    data-testid="fmt-checklist"
    class:active={isActive('taskList')}
    aria-pressed={isActive('taskList')}
    title="Checklist"
    aria-label="Checklist"
    onclick={() => editor?.chain().focus().toggleTaskList().run()}
  ><Icon name="checklist" /></button>

  <span class="sep"></span>

  <button data-testid="fmt-draw" title="Draw a sketch" aria-label="Draw" onclick={onDraw}>
    <Icon name="draw" />
  </button>
  <button
    data-testid="fmt-image"
    title="Insert image"
    aria-label="Insert image"
    onclick={() => fileInput?.click()}
  ><Icon name="image" /></button>
  <button
    data-testid="fmt-record"
    class="rec"
    class:recording={recorder.recording}
    aria-pressed={recorder.recording}
    title={recorder.recording ? `Stop recording (${recorder.seconds}s)` : 'Record voice memo'}
    aria-label={recorder.recording ? 'Stop recording' : 'Record voice memo'}
    onclick={onRecord}
  >
    <Icon name={recorder.recording ? 'stop' : 'mic'} />
    {#if recorder.recording}<span class="rectime">{recorder.seconds}s</span>{/if}
  </button>

  <span class="sep end"></span>

  <div class="morewrap" bind:this={moreWrap}>
    <button
      data-testid="fmt-more"
      class:active={open !== null}
      aria-expanded={open !== null}
      title="More formatting"
      aria-label="More formatting"
      onclick={toggleMore}
    ><Icon name="more" /></button>
    {#if open === 'menu'}
      <div class="tmenu" role="menu" style={menuStyle} data-testid="fmt-menu">
        <button
          class="mi"
          class:on={isActive('underline')}
          role="menuitemcheckbox"
          aria-checked={isActive('underline')}
          data-testid="fmt-underline"
          onclick={() => fromMenu((e) => e.chain().focus().toggleUnderline().run())}
        ><Icon name="underline" /><span>Underline</span></button>
        <button
          class="mi"
          class:on={isActive('strike')}
          role="menuitemcheckbox"
          aria-checked={isActive('strike')}
          data-testid="fmt-strike"
          onclick={() => fromMenu((e) => e.chain().focus().toggleStrike().run())}
        ><Icon name="strike" /><span>Strikethrough</span></button>
        <button
          class="mi"
          class:on={isActive('orderedList')}
          role="menuitemcheckbox"
          aria-checked={isActive('orderedList')}
          data-testid="fmt-ordered"
          onclick={() => fromMenu((e) => e.chain().focus().toggleOrderedList().run())}
        ><Icon name="orderedList" /><span>Numbered list</span></button>
        <button class="mi" role="menuitem" data-testid="fmt-size" onclick={() => show('size')}>
          <Icon name="textSize" /><span>Size of selected text</span><span class="mv">{currentSize() || 'Auto'}</span>
        </button>
      </div>
    {:else if open === 'size'}
      <div class="sizemenu" style={menuStyle} data-testid="size-menu">
        <button
          class="sopt"
          class:cur={currentSize() === ''}
          onclick={() => fromMenu((e) => e.chain().focus().unsetFontSize().run())}
        >Auto</button>
        {#each FONT_SIZES as sz}
          <button
            class="sopt"
            class:cur={currentSize() === String(sz)}
            onclick={() => fromMenu((e) => e.chain().focus().setFontSize(`${sz}px`).run())}
          >{sz}</button>
        {/each}
      </div>
    {/if}
  </div>
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
  /* The bar's own buttons (not the ones inside its menus). */
  .toolbar > button,
  .morewrap > button {
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
  /* Only with a real pointer: a phone keeps :hover on whatever was tapped
     last, which hid the recording state behind the hover tint. */
  @media (hover: hover) {
    .toolbar > button:hover,
    .morewrap > button:hover {
      background: color-mix(in srgb, var(--note-fg) 8%, transparent);
    }
  }
  /* Monochrome active state: invert the note's own colors. */
  .toolbar > button.active,
  .morewrap > button.active {
    background: var(--note-fg);
    color: var(--note-bg);
  }
  .morewrap {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }
  /* The ⋯ menu: a small sticker like the note's own ⋯ menu. */
  .tmenu {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--edge);
    background: var(--app-panel);
    border: 1px solid var(--app-border);
    border-radius: var(--sticker-radius);
    box-shadow: var(--sticker-shadow);
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
  /* On (the selection is underlined, …): inverted, like every active state. */
  .mi.on {
    background: var(--app-fg);
    color: var(--app-panel);
  }
  .mi .mv {
    margin-left: auto;
    font-size: 13px;
    color: var(--app-muted);
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
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 5px;
    background: color-mix(in srgb, var(--note-fg) 16%, transparent);
    flex-shrink: 0;
  }
  /* The ⋯ sits at the bar's far end, under the note's own ⋯. */
  .sep.end {
    margin-left: auto;
    background: transparent;
  }
  /* Recording state: semantic red dot allowed (functional, not decorative).
     It also shows the seconds, so it may grow past one button. */
  .rec.recording,
  .rec.recording:hover {
    width: auto;
    padding: 0 10px;
    background: var(--app-danger);
    color: #fff;
  }
  .rectime {
    font-size: 14px;
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
  }

  /* Phones: formatting tools live at the BOTTOM (thumb-reach, and Android's
     text-selection bubble — which always appears above the selection — can
     never cover them). Buttons stretch to equal widths filling the full row,
     Material-style. */
  @media (max-width: 700px) {
    .toolbar {
      padding: var(--edge) var(--edge) calc(var(--edge) + max(env(safe-area-inset-bottom), var(--safe-bottom, 0px)));
    }
    /* Groups (B I, lists, things to add, ⋯) spread across the row with
       the spare room shared between them. */
    .sep,
    .sep.end {
      flex: 1 1 0;
      min-width: var(--btn-gap);
      width: auto;
      margin: 0;
      background: transparent;
    }
  }
</style>
