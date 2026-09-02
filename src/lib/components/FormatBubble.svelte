<script lang="ts">
  // Floating format bubble that follows the selection on phones: Android's
  // selection sheets/keyboard cover the bottom toolbar, so the essential
  // tools travel with the selection instead. Positioned by the Editor.
  import type { Editor } from '@tiptap/core';
  import { FONT_SIZES } from '../editor/fontSize';
  import Icon from './Icon.svelte';

  interface Props {
    editor: Editor | null;
    /** Bumped by the Editor on every transaction so active states re-read. */
    tick: number;
    x: number;
    y: number;
    baseSize: number;
  }
  let { editor, tick, x, y, baseSize }: Props = $props();

  function isActive(name: string) {
    void tick;
    return editor?.isActive(name) ?? false;
  }

  function bumpSize(dir: 1 | -1) {
    if (!editor) return;
    const cur = parseInt(editor.getAttributes('textStyle').fontSize ?? '') || baseSize;
    let i = FONT_SIZES.reduce(
      (best, s, idx) => (Math.abs(s - cur) < Math.abs(FONT_SIZES[best] - cur) ? idx : best),
      0
    );
    i = Math.max(0, Math.min(FONT_SIZES.length - 1, i + dir));
    editor.chain().focus().setFontSize(`${FONT_SIZES[i]}px`).run();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="bubble"
  data-testid="format-bubble"
  style="left: {x}px; top: {y}px"
  onpointerdown={(e) => e.preventDefault()}
>
  <button aria-label="Bold" aria-pressed={isActive('bold')} class:active={isActive('bold')} onclick={() => editor?.chain().focus().toggleBold().run()}><Icon name="bold" size={17} /></button>
  <button aria-label="Italic" aria-pressed={isActive('italic')} class:active={isActive('italic')} onclick={() => editor?.chain().focus().toggleItalic().run()}><Icon name="italic" size={17} /></button>
  <button aria-label="Underline" aria-pressed={isActive('underline')} class:active={isActive('underline')} onclick={() => editor?.chain().focus().toggleUnderline().run()}><Icon name="underline" size={17} /></button>
  <button aria-label="Strikethrough" aria-pressed={isActive('strike')} class:active={isActive('strike')} onclick={() => editor?.chain().focus().toggleStrike().run()}><Icon name="strike" size={17} /></button>
  <span class="bsep"></span>
  <button class="atext" aria-label="Smaller text" onclick={() => bumpSize(-1)}>A−</button>
  <button class="atext" aria-label="Larger text" onclick={() => bumpSize(1)}>A+</button>
</div>

<style>
  /* Monochrome inverted pill floating below the selection. */
  .bubble {
    position: fixed;
    transform: translateX(-50%);
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    border-radius: var(--radius-md); /* squared-with-rounded-edges, matching the buttons */
    background: var(--app-fg);
    color: var(--app-bg);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.3);
  }
  .bubble button {
    border: none;
    background: transparent;
    color: inherit;
    min-width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font: inherit;
    font-size: 14px;
    padding: 0 6px;
  }
  .bubble button.active {
    background: var(--app-bg);
    color: var(--app-fg);
  }
  .bubble .atext {
    font-weight: 600;
  }
  .bsep {
    width: 1px;
    height: 18px;
    background: currentColor;
    opacity: 0.3;
    margin: 0 3px;
  }
</style>
