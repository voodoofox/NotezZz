<script lang="ts">
  // The formatting strip above (desktop) / below (phones) the note body.
  // Owns the size menu, the image picker and the record button's UI; the
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

  let showSizes = $state(false);
  let sizeWrap = $state<HTMLDivElement | null>(null);
  let barEl = $state<HTMLElement | null>(null);
  let sizeMenuStyle = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

  function toggleSizes() {
    if (!showSizes && sizeWrap) sizeMenuStyle = popoverStyle(sizeWrap, 168, 'center', barEl);
    showSizes = !showSizes;
  }

  // Tapping anywhere else (including the text) closes the size menu.
  function onGlobalPointerDown(e: PointerEvent) {
    if (showSizes && sizeWrap && !sizeWrap.contains(e.target as Node)) showSizes = false;
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
  <button
    data-testid="fmt-underline"
    class:active={isActive('underline')}
    aria-pressed={isActive('underline')}
    title="Underline (Ctrl+U)"
    aria-label="Underline"
    onclick={() => editor?.chain().focus().toggleUnderline().run()}
  ><Icon name="underline" /></button>
  <button
    data-testid="fmt-strike"
    class:active={isActive('strike')}
    aria-pressed={isActive('strike')}
    title="Strikethrough"
    aria-label="Strikethrough"
    onclick={() => editor?.chain().focus().toggleStrike().run()}
  ><Icon name="strike" /></button>

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
    data-testid="fmt-ordered"
    class:active={isActive('orderedList')}
    aria-pressed={isActive('orderedList')}
    title="Numbered list"
    aria-label="Numbered list"
    onclick={() => editor?.chain().focus().toggleOrderedList().run()}
  ><Icon name="orderedList" /></button>
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

  <span class="sep"></span>

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
    {#if showSizes}
      <div class="sizemenu" style={sizeMenuStyle} data-testid="size-menu">
        <button
          class="sopt"
          class:cur={currentSize() === ''}
          onclick={() => {
            editor?.chain().focus().unsetFontSize().run();
            showSizes = false;
          }}
        >Auto</button>
        {#each FONT_SIZES as s}
          <button
            class="sopt"
            class:cur={currentSize() === String(s)}
            onclick={() => {
              editor?.chain().focus().setFontSize(`${s}px`).run();
              showSizes = false;
            }}
          >{s}</button>
        {/each}
      </div>
    {/if}
  </div>

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
  .toolbar button:hover {
    background: color-mix(in srgb, var(--note-fg) 8%, transparent);
  }
  /* Monochrome active state: invert the note's own colors. */
  .toolbar button.active {
    background: var(--note-fg);
    color: var(--note-bg);
  }
  .sizewrap {
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
  /* Recording state: semantic red dot allowed (functional, not decorative).
     It also shows the seconds, so it may grow past one button. */
  .rec.recording {
    width: auto;
    padding: 0 8px;
    background: var(--app-danger);
    color: #fff;
  }
  .rectime {
    font-size: 12px;
    margin-left: 4px;
  }

  /* Phones: formatting tools live at the BOTTOM (thumb-reach, and Android's
     text-selection bubble — which always appears above the selection — can
     never cover them). Buttons stretch to equal widths filling the full row,
     Material-style. */
  @media (max-width: 700px) {
    .toolbar {
      padding: var(--edge) var(--edge) calc(var(--edge) + max(env(safe-area-inset-bottom), var(--safe-bottom, 0px)));
    }
    .sep {
      display: none;
    }
  }
</style>
