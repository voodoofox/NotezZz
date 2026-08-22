<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { TextStyle } from '@tiptap/extension-text-style';
  import { FontSize } from '../editor/fontSize';

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
      extensions: [StarterKit, TextStyle, FontSize],
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

<div class="editor">
  <div class="toolbar">
    <button
      data-testid="fmt-bold"
      class:active={isActive('bold')}
      title="Bold (Ctrl+B)"
      onclick={() => editor?.chain().focus().toggleBold().run()}
    ><b>B</b></button>
    <button
      data-testid="fmt-italic"
      class:active={isActive('italic')}
      title="Italic (Ctrl+I)"
      onclick={() => editor?.chain().focus().toggleItalic().run()}
    ><i>I</i></button>
    <button
      data-testid="fmt-underline"
      class:active={isActive('underline')}
      title="Underline (Ctrl+U)"
      onclick={() => editor?.chain().focus().toggleUnderline().run()}
    ><u>U</u></button>
    <button
      data-testid="fmt-strike"
      class:active={isActive('strike')}
      title="Strikethrough"
      onclick={() => editor?.chain().focus().toggleStrike().run()}
    ><s>S</s></button>

    <span class="sep"></span>

    <button
      data-testid="fmt-bullet"
      class:active={isActive('bulletList')}
      title="Bullet list"
      onclick={() => editor?.chain().focus().toggleBulletList().run()}
    >•—</button>
    <button
      data-testid="fmt-ordered"
      class:active={isActive('orderedList')}
      title="Numbered list"
      onclick={() => editor?.chain().focus().toggleOrderedList().run()}
    >1.</button>

    <span class="sep"></span>

    <select
      data-testid="fmt-size"
      title="Font size"
      value={currentSize()}
      onchange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        if (v) editor?.chain().focus().setFontSize(`${v}px`).run();
        else editor?.chain().focus().unsetFontSize().run();
      }}
    >
      <option value="">Aa</option>
      {#each SIZES as s}
        <option value={s}>{s}</option>
      {/each}
    </select>
  </div>

  <div class="content" style="font-size: {baseSize}px" bind:this={element}></div>
</div>

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
    gap: 2px;
    padding: 4px 6px;
    flex-wrap: wrap;
    background: var(--note-header);
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }
  .toolbar button,
  .toolbar select {
    font: inherit;
    font-size: 14px;
    color: var(--note-fg);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 2px 7px;
    cursor: pointer;
    line-height: 1.4;
  }
  .toolbar button:hover,
  .toolbar select:hover {
    background: rgba(0, 0, 0, 0.06);
  }
  .toolbar button.active {
    background: var(--note-accent);
    color: #fff;
    border-color: var(--note-accent);
  }
  .sep {
    width: 1px;
    align-self: stretch;
    margin: 2px 4px;
    background: rgba(0, 0, 0, 0.12);
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
</style>
