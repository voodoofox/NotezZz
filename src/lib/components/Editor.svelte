<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { TextStyle } from '@tiptap/extension-text-style';
  import { Image } from '@tiptap/extension-image';
  import { FontSize } from '../editor/fontSize';
  import DrawPad from './DrawPad.svelte';
  import Icon from './Icon.svelte';

  import { popoverStyle } from '$lib/popover';

  interface Props {
    html: string;
    onChange: (html: string) => void;
    /** Base font size (px) for the note body. */
    baseSize?: number;
  }

  let { html, onChange, baseSize = 18 }: Props = $props();

  let element: HTMLDivElement;
  let editor = $state<Editor | null>(null);
  // Bumped on every transaction so toolbar active-states stay reactive.
  let tick = $state(0);
  let showDraw = $state(false);
  let drawBg = $state<string | undefined>();
  let drawInk = $state<string | undefined>();
  let showSizes = $state(false);
  let sizeWrap = $state<HTMLDivElement | null>(null);
  let sizeMenuStyle = $state('');

  function toggleSizes() {
    if (!showSizes && sizeWrap) sizeMenuStyle = popoverStyle(sizeWrap, 96);
    showSizes = !showSizes;
  }

  // Tapping anywhere else (including the text) closes the size menu.
  function onGlobalPointerDown(e: PointerEvent) {
    if (showSizes && sizeWrap && !sizeWrap.contains(e.target as Node)) showSizes = false;
  }

  let fileInput = $state<HTMLInputElement | null>(null);

  /** Insert a photo/image, downscaled so notes stay reasonably sized. */
  async function importImage(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !editor) return;
    const dataUrl = await scaleImage(file, 1280);
    if (dataUrl) editor.chain().focus().insertContent({ type: 'image', attrs: { src: dataUrl } }).run();
  }

  function scaleImage(file: File, max: number): Promise<string | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        // PNGs keep transparency; everything else compresses well as JPEG.
        resolve(
          file.type === 'image/png'
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL('image/jpeg', 0.85)
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function openDraw() {
    // Draw on the note's real colors, with guaranteed-contrast default ink.
    const cs = getComputedStyle(element);
    drawBg = cs.getPropertyValue('--note-bg').trim() || undefined;
    drawInk = cs.getPropertyValue('--note-fg').trim() || undefined;
    showDraw = true;
  }

  function drawDone(svgDataUrl: string | null) {
    showDraw = false;
    if (svgDataUrl && editor) {
      editor.chain().focus().insertContent({ type: 'image', attrs: { src: svgDataUrl } }).run();
    }
  }
  // Plain (non-reactive) guard: the last HTML pushed to or received from the
  // editor. Without this, the sync effect fights the editor's own onUpdate —
  // ProseMirror's serialized HTML never exactly equals the stored string, so
  // setContent runs forever, tripping Svelte's effect_update_depth_exceeded and
  // freezing ALL reactivity on the page.
  let syncedHtml = '';

  const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48];

  onMount(() => {
    syncedHtml = html;
    editor = new Editor({
      element,
      extensions: [StarterKit, TextStyle, FontSize, Image.configure({ allowBase64: true })],
      content: html || '<p></p>',
      onTransaction: () => (tick += 1),
      onUpdate: ({ editor }) => {
        const out = editor.getHTML();
        syncedHtml = out; // remember our own output so the effect won't push it back
        onChange(out);
      },
    });
  });

  onDestroy(() => editor?.destroy());

  // Push ONLY external content changes (e.g. switching notes) into the editor.
  $effect(() => {
    const next = html;
    if (!editor || editor.isDestroyed) return;
    if (next === syncedHtml) return; // this html came from the editor itself
    syncedHtml = next;
    editor.commands.setContent(next || '<p></p>', { emitUpdate: false });
  });

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

<div class="editor">
  <div class="toolbar">
    <button
      data-testid="fmt-bold"
      class:active={isActive('bold')}
      title="Bold (Ctrl+B)"
      aria-label="Bold"
      onclick={() => editor?.chain().focus().toggleBold().run()}
    ><Icon name="bold" /></button>
    <button
      data-testid="fmt-italic"
      class:active={isActive('italic')}
      title="Italic (Ctrl+I)"
      aria-label="Italic"
      onclick={() => editor?.chain().focus().toggleItalic().run()}
    ><Icon name="italic" /></button>
    <button
      data-testid="fmt-underline"
      class:active={isActive('underline')}
      title="Underline (Ctrl+U)"
      aria-label="Underline"
      onclick={() => editor?.chain().focus().toggleUnderline().run()}
    ><Icon name="underline" /></button>
    <button
      data-testid="fmt-strike"
      class:active={isActive('strike')}
      title="Strikethrough"
      aria-label="Strikethrough"
      onclick={() => editor?.chain().focus().toggleStrike().run()}
    ><Icon name="strike" /></button>

    <span class="sep"></span>

    <button
      data-testid="fmt-bullet"
      class:active={isActive('bulletList')}
      title="Bullet list"
      aria-label="Bullet list"
      onclick={() => editor?.chain().focus().toggleBulletList().run()}
    ><Icon name="bulletList" /></button>
    <button
      data-testid="fmt-ordered"
      class:active={isActive('orderedList')}
      title="Numbered list"
      aria-label="Numbered list"
      onclick={() => editor?.chain().focus().toggleOrderedList().run()}
    ><Icon name="orderedList" /></button>

    <span class="sep"></span>

    <button data-testid="fmt-draw" title="Draw a sketch" aria-label="Draw" onclick={openDraw}>
      <Icon name="draw" />
    </button>

    <span class="sep"></span>

    <div class="sizewrap" bind:this={sizeWrap}>
      <button
        data-testid="fmt-size"
        class:active={showSizes}
        title="Text size"
        aria-label="Text size"
        onclick={toggleSizes}
      ><Icon name="textSize" size={22} /></button>
      {#if showSizes}
        <div class="sizemenu" style={sizeMenuStyle}>
          <button
            class="sopt"
            class:cur={currentSize() === ''}
            onclick={() => {
              editor?.chain().focus().unsetFontSize().run();
              showSizes = false;
            }}
          >Auto</button>
          {#each SIZES as s}
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
    <input
      type="file"
      accept="image/*"
      data-testid="image-input"
      hidden
      bind:this={fileInput}
      onchange={importImage}
    />
  </div>

  <div class="content" style="font-size: {baseSize}px" bind:this={element}></div>
</div>

{#if showDraw}
  <DrawPad onDone={drawDone} bg={drawBg} ink={drawInk} />
{/if}

<style>
  .editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 5px 8px;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    background: var(--note-header);
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
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
    border-radius: 7px;
    min-width: 32px;
    height: 30px;
    padding: 0 8px;
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .toolbar button:hover {
    background: rgba(0, 0, 0, 0.07);
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
       clipping made absolutely-positioned menus invisible. */
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    background: var(--app-panel);
    border: 1px solid var(--app-border);
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.22);
  }
  .sopt {
    font: inherit;
    font-size: 17px;
    min-width: 88px;
    padding: 10px 16px;
    border: none;
    border-radius: 7px;
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
    background: rgba(0, 0, 0, 0.14);
    flex-shrink: 0;
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 14px;
  }
  .content :global(.ProseMirror) {
    outline: none;
    min-height: 100%;
  }
  .content :global(.ProseMirror p) {
    margin: 0 0 0.5em;
  }
  .content :global(.ProseMirror ul),
  .content :global(.ProseMirror ol) {
    margin: 0 0 0.5em;
    padding-left: 1.4em;
  }
  .content :global(.ProseMirror:focus) {
    outline: none;
  }
  .content :global(.ProseMirror img) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
  }
  .content :global(.ProseMirror img.ProseMirror-selectednode) {
    outline: 2px solid var(--note-accent);
  }
  /* Phones: formatting tools live at the BOTTOM (thumb-reach, and Android's
     text-selection bubble — which always appears above the selection — can
     never cover them). Buttons stretch to equal widths filling the full row,
     Material-style. Extra top padding keeps the bubble for the first line
     over empty space instead of the palette row. */
  @media (max-width: 700px) {
    .toolbar {
      order: 2;
      border-bottom: none;
      border-top: 1px solid rgba(0, 0, 0, 0.08);
      gap: 0;
      padding: 4px 4px calc(4px + env(safe-area-inset-bottom));
    }
    .toolbar button {
      flex: 1 1 0;
      min-width: 0;
      height: 42px;
    }
    .sizewrap {
      flex: 1 1 0;
      min-width: 0;
    }
    .sizewrap button {
      width: 100%;
    }
    .sep {
      display: none;
    }
    .content {
      order: 1;
      padding-top: 22px;
    }
  }
</style>
