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

  // Always whole on screen: the Editor centres it on the selection, which
  // near an edge pushed half of it off. Measured, then kept inside what is
  // visible; under pinch-zoom it stays its normal size (counter-scaled).
  let w = $state(0);
  const place = $derived.by(() => {
    void x;
    const vv = window.visualViewport;
    const s = vv?.scale ?? 1;
    const ox = vv?.offsetLeft ?? 0;
    const vw = vv?.width ?? window.innerWidth;
    const shown = w / s;
    const left = Math.min(Math.max(x - shown / 2, ox + 6 / s), ox + vw - shown - 6 / s);
    return { left: Math.round(left), s };
  });

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
  style="left: {place.left}px; top: {y}px; transform: scale({1 / place.s})"
  bind:offsetWidth={w}
  onpointerdown={(e) => e.preventDefault()}
>
  <button aria-label="Bold" aria-pressed={isActive('bold')} class:active={isActive('bold')} onclick={() => editor?.chain().focus().toggleBold().run()}><Icon name="bold" /></button>
  <button aria-label="Italic" aria-pressed={isActive('italic')} class:active={isActive('italic')} onclick={() => editor?.chain().focus().toggleItalic().run()}><Icon name="italic" /></button>
  <button aria-label="Underline" aria-pressed={isActive('underline')} class:active={isActive('underline')} onclick={() => editor?.chain().focus().toggleUnderline().run()}><Icon name="underline" /></button>
  <button aria-label="Strikethrough" aria-pressed={isActive('strike')} class:active={isActive('strike')} onclick={() => editor?.chain().focus().toggleStrike().run()}><Icon name="strike" /></button>
  <span class="bsep"></span>
  <button class="atext" aria-label="Smaller text" onclick={() => bumpSize(-1)}>A−</button>
  <button class="atext" aria-label="Larger text" onclick={() => bumpSize(1)}>A+</button>
</div>

<style>
  /* A balloon like the note's menus: a small sticker on the app panel,
     its buttons the same rounded squares as everywhere, the active one
     inverted. Floats below the selection (Android's own menu sits above). */
  .bubble {
    position: fixed;
    transform-origin: 0 0;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: var(--btn-gap);
    padding: var(--edge);
    border-radius: var(--sticker-radius);
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    box-shadow: var(--sticker-shadow);
  }
  .bubble button {
    border: none;
    background: transparent;
    color: inherit;
    width: var(--btn);
    height: var(--btn);
    padding: 0;
    border-radius: var(--btn-radius);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font: inherit;
    font-size: 15px;
  }
  @media (hover: hover) {
    .bubble button:hover {
      background: color-mix(in srgb, var(--app-fg) 8%, transparent);
    }
  }
  .bubble button:active {
    background: color-mix(in srgb, var(--app-fg) 16%, transparent);
  }
  .bubble button.active {
    background: var(--app-fg);
    color: var(--app-panel);
  }
  .bubble .atext {
    font-weight: 600;
  }
  .bsep {
    width: 1px;
    height: 20px;
    background: currentColor;
    opacity: 0.16;
    margin: 0 5px;
  }
</style>
