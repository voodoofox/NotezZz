<script lang="ts">
  // TipTap lifecycle + the html sync effect + onChange. The toolbar and the
  // phone format bubble are their own components (EditorToolbar,
  // FormatBubble); this file owns everything with a lifetime.
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { TextStyle } from '@tiptap/extension-text-style';
  import { Image } from '@tiptap/extension-image';
  import { FontSize } from '../editor/fontSize';
  import { AudioNote } from '../editor/audio';
  import { VoiceRecorder } from '../editor/recorder.svelte';
  import { BASE_FONT_PX } from '$lib/types';
  import DrawPad from './DrawPad.svelte';
  import EditorToolbar from './EditorToolbar.svelte';
  import FormatBubble from './FormatBubble.svelte';

  interface Props {
    html: string;
    onChange: (html: string) => void;
    /** Base font size (px) for the note body. */
    baseSize?: number;
  }

  let { html, onChange, baseSize = BASE_FONT_PX }: Props = $props();

  let element: HTMLDivElement;
  let editor = $state<Editor | null>(null);
  // Bumped on every transaction so toolbar active-states stay reactive.
  let tick = $state(0);
  let showDraw = $state(false);
  let drawBg = $state<string | undefined>();
  let drawInk = $state<string | undefined>();

  // ---- Voice memo recording -------------------------------------------------
  // Owned here (not in the toolbar) because onDestroy must cancel it: this
  // component is remounted on every note switch, and a recorder left behind
  // kept the mic open and inserted into a destroyed editor.
  const recorder = new VoiceRecorder();

  async function toggleRecord() {
    if (recorder.recording) return recorder.stop();
    try {
      await recorder.start((dataUrl) => {
        if (editor && !editor.isDestroyed) editor.chain().focus().insertAudio(dataUrl).run();
      });
    } catch {
      alert('Microphone unavailable or permission denied.');
    }
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

  // Floating format bubble position (phones); null = hidden.
  let bubble = $state<{ x: number; y: number } | null>(null);

  function setBubble(next: { x: number; y: number } | null) {
    // Only reassign on a real change: this runs on every transaction, and a
    // fresh object each time re-rendered the bubble on every keystroke.
    if (next === null ? bubble === null : bubble && bubble.x === next.x && bubble.y === next.y) return;
    bubble = next;
  }

  function updateBubble() {
    if (!editor || editor.isDestroyed || window.innerWidth > 700) return setBubble(null);
    const sel = editor.state.selection;
    const { from, to, empty } = sel;
    // Only for selected TEXT. Selecting a block — tapping the audio player or
    // an image — is a node selection, where formatting buttons mean nothing.
    if (empty || 'node' in sel) return setBubble(null);
    try {
      const a = editor.view.coordsAtPos(from);
      const b = editor.view.coordsAtPos(to);
      // Under pinch-zoom the visual viewport is a window onto the layout
      // viewport; position:fixed coordinates are layout-relative, so the
      // visible box starts at the viewport's offset, not at 0.
      const vv = window.visualViewport;
      const ox = vv?.offsetLeft ?? 0;
      const oy = vv?.offsetTop ?? 0;
      const vw = vv?.width ?? window.innerWidth;
      const vh = vv?.height ?? window.innerHeight;
      const x = Math.min(Math.max((a.left + b.left) / 2, ox + 110), ox + vw - 110);
      // BELOW the selection: Android's own Translate/Cut/Copy menu owns the
      // space above it and would cover us. +30 clears the selection handles.
      const below = Math.max(a.bottom, b.bottom) + 30;
      const y =
        below + 44 <= oy + vh - 8
          ? below
          : Math.max(oy + 8, Math.min(a.top, b.top) - 110); // no room: go high above the OS menu
      setBubble({ x: Math.round(x), y: Math.round(y) });
    } catch {
      setBubble(null);
    }
  }

  onMount(() => {
    syncedHtml = html;
    editor = new Editor({
      element,
      extensions: [StarterKit, TextStyle, FontSize, AudioNote, Image.configure({ allowBase64: true })],
      content: html || '<p></p>',
      onTransaction: () => {
        tick += 1;
        updateBubble();
      },
      onUpdate: ({ editor }) => {
        const out = editor.getHTML();
        syncedHtml = out; // remember our own output so the effect won't push it back
        onChange(out);
      },
    });
  });

  // Held so onDestroy can clear it: it fired after the editor was destroyed
  // when a note switch landed inside its 60ms window.
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;

  // The keyboard opens AFTER a selection is made (focus), resizing the
  // viewport and invalidating the bubble's position — it then overlapped
  // Android's own selection menu. Re-anchor on every viewport change.
  onMount(() => {
    const vv = window.visualViewport;
    // When the keyboard opens the viewport shrinks under whatever you were
    // looking at; bring the caret back onto screen.
    const keepInView = () => {
      updateBubble();
      if (editor && !editor.isDestroyed && editor.isFocused) {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          if (editor && !editor.isDestroyed) editor.commands.scrollIntoView();
        }, 60);
      }
    };
    vv?.addEventListener('resize', keepInView);
    vv?.addEventListener('scroll', updateBubble);
    window.addEventListener('resize', updateBubble);
    return () => {
      vv?.removeEventListener('resize', keepInView);
      vv?.removeEventListener('scroll', updateBubble);
      window.removeEventListener('resize', updateBubble);
    };
  });

  onDestroy(() => {
    clearTimeout(scrollTimer);
    recorder.cancel();
    editor?.destroy();
  });

  // Push ONLY external content changes (e.g. switching notes) into the editor.
  $effect(() => {
    const next = html;
    if (!editor || editor.isDestroyed) return;
    if (next === syncedHtml) return; // this html came from the editor itself
    syncedHtml = next;
    editor.commands.setContent(next || '<p></p>', { emitUpdate: false });
  });
</script>

<div class="editor">
  <EditorToolbar {editor} {tick} {recorder} onRecord={toggleRecord} onDraw={openDraw} />
  <div class="content" style="font-size: {baseSize}px" bind:this={element}></div>
</div>

{#if bubble && !showDraw}
  <FormatBubble {editor} {tick} x={bubble.x} y={bubble.y} {baseSize} />
{/if}

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
  /* Voice memo player — no panel, no chrome: a line of controls in the
     note's own ink, so it reads as part of the note rather than a widget
     dropped into it. */
  .content :global(.nz-audio) {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 420px;
    margin: 10px 0;
    color: var(--note-fg);
  }
  .content :global(.nz-audio-play) {
    flex: none;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1.5px solid currentColor;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .content :global(.nz-audio-play:hover) {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .content :global(.nz-audio-track) {
    flex: 1;
    height: 3px;
    border-radius: 999px; /* pill: a hairline's ends should be round, not token-radiused */
    background: color-mix(in srgb, currentColor 22%, transparent);
    cursor: pointer;
    position: relative;
    outline: none;
  }
  .content :global(.nz-audio-track:focus-visible) {
    outline: 2px solid currentColor;
    outline-offset: 6px;
  }
  .content :global(.nz-audio-fill) {
    height: 100%;
    width: 0;
    border-radius: 999px;
    background: currentColor;
  }
  .content :global(.nz-audio-time) {
    flex: none;
    font-size: 13px;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
  .content :global(.nz-audio.ProseMirror-selectednode) {
    outline: 2px solid var(--note-fg);
    outline-offset: 4px;
    border-radius: var(--radius-sm);
  }

  /* Links stay ink-colored — just underlined, no browser blue. */
  .content :global(.ProseMirror a) {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .content :global(.ProseMirror img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
  }
  .content :global(.ProseMirror img.ProseMirror-selectednode) {
    outline: 2px solid var(--note-fg);
  }

  /* Phones: the toolbar moves to the bottom (see EditorToolbar); extra top
     padding keeps the bubble for the first line over empty space instead of
     the palette row. */
  @media (max-width: 700px) {
    .content {
      order: 1;
      padding-top: 22px;
    }
  }
</style>
