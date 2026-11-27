<script lang="ts">
  // The row that comes up over the toolbar while text is selected, on a
  // phone or a sticky: the size of the selection, a step at a time. It
  // belongs to the note and stays where it is. (It was a balloon that
  // followed the selection: under a long selection it ended up wherever
  // there was room, over the list as often as not, and had to be looked
  // for. Bold and the rest were on it too; they are on the toolbar, right
  // below.)
  import type { Editor } from '@tiptap/core';
  import { FONT_SIZES } from '../editor/fontSize';

  interface Props {
    editor: Editor | null;
    /** Bumped by the Editor on every transaction so the size re-reads. */
    tick: number;
    baseSize: number;
  }
  let { editor, tick, baseSize }: Props = $props();

  /** The selection's size, or the note's own where none is set. */
  function size(): number {
    void tick;
    return parseInt(editor?.getAttributes('textStyle').fontSize ?? '') || baseSize;
  }

  /** The next size of FONT_SIZES up or down from the selection's, if any. */
  function step(dir: 1 | -1): number | undefined {
    const cur = size();
    return dir === 1 ? FONT_SIZES.find((s) => s > cur) : FONT_SIZES.findLast((s) => s < cur);
  }

  function bumpSize(dir: 1 | -1) {
    const to = step(dir);
    if (editor && to) editor.chain().focus().setFontSize(`${to}px`).run();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fmtrow" data-testid="format-row" onpointerdown={(e) => e.preventDefault()}>
  <button aria-label="Smaller text" disabled={!step(-1)} onclick={() => bumpSize(-1)}>A−</button>
  <span class="size" data-testid="format-row-size">{size()}</span>
  <button aria-label="Larger text" disabled={!step(1)} onclick={() => bumpSize(1)}>A+</button>
</div>

<style>
  /* A second strip of the toolbar: its colours, its line, its buttons. */
  .fmtrow {
    order: 2;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--btn-gap);
    padding: var(--edge);
    color: var(--note-fg);
    background: color-mix(in srgb, var(--note-header) var(--note-chin-mix), transparent);
    border-top: 1px solid color-mix(in srgb, var(--note-fg) var(--note-chin-line), transparent);
  }
  .fmtrow button {
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: var(--btn-radius);
    width: var(--btn);
    height: var(--btn);
    padding: 0;
    cursor: pointer;
    line-height: 1;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  @media (hover: hover) {
    .fmtrow button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--note-fg) 8%, transparent);
    }
  }
  .fmtrow button:active:not(:disabled) {
    background: color-mix(in srgb, var(--note-fg) 16%, transparent);
  }
  .fmtrow button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .size {
    min-width: var(--btn);
    text-align: center;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
  }
</style>
