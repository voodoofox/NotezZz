<script lang="ts">
  // TipTap lifecycle + the html sync effect + onChange. The toolbar and the
  // row over it while text is selected are their own components
  // (EditorToolbar, FormatRow); this file owns everything with a lifetime.
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { TextStyle } from '@tiptap/extension-text-style';
  import { Image } from '@tiptap/extension-image';
  import { TaskList, TaskItem } from '@tiptap/extension-list';
  import { ChecklistSink } from '$lib/editor/checklistSink';
  import { FontSize } from '../editor/fontSize';
  import { AudioNote } from '../editor/audio';
  import { AtomDelete } from '../editor/atomDelete';
  import { VoiceRecorder } from '../editor/recorder.svelte';
  import { imageFiles, imageToDataUrl } from '../editor/pasteImage';
  import { BASE_FONT_PX } from '$lib/types';
  import DrawPad from './DrawPad.svelte';
  import EditorToolbar from './EditorToolbar.svelte';
  import FormatRow from './FormatRow.svelte';
  import { store } from '$lib/store.svelte';

  interface Props {
    html: string;
    onChange: (html: string) => void;
    /** Base font size (px) for the note body. */
    baseSize?: number;
    /** The note shown, so a tool requested for it (store.requestedTool) opens here. */
    noteId?: string;
    /** Checklist items stay put when ticked (Note.keepTicked); off, they sink. */
    keepTicked?: boolean;
  }

  let { html, onChange, baseSize = BASE_FONT_PX, noteId, keepTicked = false }: Props = $props();

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

  // The quick-add widget's Voice and Draw: start the tool as soon as this
  // editor for that note exists. Cleared first so it runs exactly once.
  $effect(() => {
    const req = store.requestedTool;
    if (!req || !editor || !noteId || req.id !== noteId) return;
    store.requestedTool = null;
    if (req.tool === 'voice') void toggleRecord();
    else openDraw();
  });

  async function insertImages(files: File[], at?: number) {
    for (const f of files) {
      let src: string;
      try {
        src = await imageToDataUrl(f);
      } catch {
        continue; // not something the browser can decode
      }
      if (!editor) return;
      const node = { type: 'image', attrs: { src } };
      if (at !== undefined) editor.chain().focus().insertContentAt(at, node).run();
      else editor.chain().focus().insertContent(node).run();
      at = undefined; // the rest follow the first
    }
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

  // Text is selected, on a phone or a sticky: the size row is up (FormatRow).
  let selRow = $state(false);

  function updateRow() {
    if (!editor || editor.isDestroyed || window.innerWidth > 700) return void (selRow = false);
    const sel = editor.state.selection;
    // Only for selected TEXT. Selecting a block — tapping the audio player or
    // an image — is a node selection, where a text size means nothing.
    selRow = !sel.empty && !('node' in sel);
  }

  // The row takes its height off the bottom of the text. Where the selection
  // ends under it, the text moves up by as much, so what was just selected
  // is not the thing it covers.
  $effect(() => {
    if (!selRow || !editor || editor.isDestroyed) return;
    const view = editor.view;
    const frame = requestAnimationFrame(() => {
      if (view.isDestroyed) return;
      try {
        const over = view.coordsAtPos(view.state.selection.to).bottom - element.getBoundingClientRect().bottom;
        if (over > 0) element.scrollTop += over + 8;
      } catch {
        /* the selection is gone again */
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  onMount(() => {
    syncedHtml = html;
    editor = new Editor({
      element,
      extensions: [
        // Links are opened by the app (see +layout), not by the editor.
        StarterKit.configure({ link: { openOnClick: false } }),
        TextStyle,
        FontSize,
        AudioNote,
        AtomDelete,
        Image.configure({ allowBase64: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        ChecklistSink.configure({ enabled: () => !keepTicked }),
      ],
      content: html || '<p></p>',
      editorProps: {
        // A screenshot or picture pasted or dropped in lands in the note as a
        // (shrunk) data URL. Files first: an image copied off a web page also
        // comes as HTML pointing at the site, which the app's CSP won't load.
        handlePaste: (_view, event) => {
          const files = imageFiles(event.clipboardData);
          if (files.length === 0) return false;
          void insertImages(files);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = imageFiles(event.dataTransfer);
          if (files.length === 0) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertImages(files, at);
          return true;
        },
      },
      onTransaction: () => {
        tick += 1;
        updateRow();
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

  onMount(() => {
    const vv = window.visualViewport;
    let lastHeight = vv?.height ?? 0;
    // When the keyboard opens the viewport shrinks under whatever you were
    // looking at; bring the caret back onto screen. ONLY then: a pinch also
    // resizes the visual viewport, and snapping back to the caret on every
    // pinch step made zooming and scrolling a note you were typing in
    // impossible (it jumped straight back to the cursor).
    const keepInView = () => {
      if (!vv) return;
      const keyboardOpened = vv.height < lastHeight - 60 && vv.scale <= 1.01;
      lastHeight = vv.height;
      if (!keyboardOpened) return;
      if (editor && !editor.isDestroyed && editor.isFocused) {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          if (editor && !editor.isDestroyed) editor.commands.scrollIntoView();
        }, 60);
      }
    };
    vv?.addEventListener('resize', keepInView);
    // A window dragged across the phone width gains or loses the row.
    window.addEventListener('resize', updateRow);
    return () => {
      vv?.removeEventListener('resize', keepInView);
      window.removeEventListener('resize', updateRow);
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

  /** Undo / redo for the note's ⋯ menu. No focus: on a phone that would
   *  bring the keyboard up just to take a word back. */
  export function history(dir: 'undo' | 'redo') {
    if (!editor || editor.isDestroyed) return;
    if (dir === 'undo') editor.commands.undo();
    else editor.commands.redo();
  }
  export function canHistory(dir: 'undo' | 'redo'): boolean {
    if (!editor || editor.isDestroyed) return false;
    return dir === 'undo' ? editor.can().undo() : editor.can().redo();
  }
</script>

<div class="editor">
  {#if selRow}
    <FormatRow {editor} {tick} {baseSize} />
  {/if}
  <EditorToolbar {editor} {tick} {recorder} onRecord={toggleRecord} onDraw={openDraw} />
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
  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px var(--text-inset); /* in line with the title and the toolbar's first glyph */
  }
  .content :global(.ProseMirror) {
    outline: none;
    min-height: 100%;
    /* On a wide window, lines stop at a readable ~70 characters; the rest
       is padding, so a click there still lands in the note. */
    padding-right: max(0px, calc(100% - 70ch));
  }
  .content :global(.ProseMirror p) {
    margin: 0 0 0.5em;
  }
  .content :global(.ProseMirror ul),
  .content :global(.ProseMirror ol) {
    margin: 0 0 0.5em;
    padding-left: 1.4em;
  }
  /* Checklists: a box in the note's ink instead of a bullet; ticked items
     fade and strike through, so what's left stands out. */
  .content :global(.ProseMirror ul[data-type='taskList']) {
    list-style: none;
    padding-left: 0.2em;
  }
  .content :global(ul[data-type='taskList'] > li) {
    display: flex;
    align-items: flex-start;
    gap: 0.5em;
  }
  .content :global(ul[data-type='taskList'] > li > label) {
    flex: none;
    display: flex;
    align-items: center;
    height: 1.45em;
    user-select: none;
    /* A thumb-sized target around the box, without moving the text. */
    padding: 0 0.3em;
    margin: 0 -0.3em;
    cursor: pointer;
  }
  .content :global(ul[data-type='taskList'] > li > div) {
    flex: 1;
    min-width: 0;
  }
  /* The box: a rounded square like every button (the logo's corner),
     tinted rather than outlined, filled with the ink once ticked. Sized by
     the text (inputs don't inherit font-size: it was 13px at any size). */
  .content :global(ul[data-type='taskList'] > li input[type='checkbox']) {
    appearance: none;
    font-size: inherit;
    width: 0.9em;
    height: 0.9em;
    margin: 0;
    border: none;
    border-radius: calc(0.9em * var(--btn-corner));
    background: color-mix(in srgb, var(--note-fg) 16%, transparent);
    cursor: pointer;
    display: grid;
    place-content: center;
  }
  .content :global(ul[data-type='taskList'] > li input[type='checkbox']::after) {
    content: '';
    width: 0.45em;
    height: 0.24em;
    border-left: max(2px, 0.1em) solid var(--note-bg, #fff);
    border-bottom: max(2px, 0.1em) solid var(--note-bg, #fff);
    transform: translateY(-0.05em) rotate(-45deg);
    visibility: hidden;
  }
  .content :global(ul[data-type='taskList'] > li input[type='checkbox']:checked) {
    background: var(--note-fg);
  }
  .content :global(ul[data-type='taskList'] > li input[type='checkbox']:checked::after) {
    visibility: visible;
  }
  .content :global(ul[data-type='taskList'] > li[data-checked='true'] > div) {
    text-decoration: line-through;
    opacity: 0.55;
  }
  /* A horizontal line (typed as ---): the note's ink at half strength,
     a divider rather than a bar. */
  .content :global(.ProseMirror hr) {
    border: none;
    border-top: 1.5px solid color-mix(in srgb, var(--note-fg) 50%, transparent);
    margin: 0.8em 0;
  }
  .content :global(.ProseMirror hr.ProseMirror-selectednode) {
    border-top-color: var(--note-fg);
  }
  /* Voice memo player — no panel, no chrome: a line of controls in the
     note's own ink, so it reads as part of the note rather than a widget
     dropped into it. */
  .content :global(.nz-audio) {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 420px;
    margin: 10px 0;
    color: var(--note-fg);
  }
  /* The play button's tile, drawn behind the player: one button wide at
     rest; selected, it grows to the whole player (like a list row filling
     from its colour bar). No outline. */
  .content :global(.nz-audio::before) {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--btn);
    z-index: -1;
    border-radius: var(--btn-radius);
    background: color-mix(in srgb, currentColor 10%, transparent);
    transition: width 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .content :global(.nz-audio.selected::before) {
    width: 100%;
  }
  .content :global(.nz-audio-play) {
    flex: none;
    width: var(--btn);
    height: var(--btn);
    padding: 0;
    border: none;
    border-radius: var(--btn-radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .content :global(.nz-audio-play:hover),
  .content :global(.nz-audio-play:active) {
    background: color-mix(in srgb, currentColor 18%, transparent);
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
    margin-left: 6px; /* room after the track: 18px, not 12 */
    padding-right: 4px;
    font-size: 13px;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
  .content :global(.nz-audio-del) {
    display: none;
    flex: none;
    width: var(--btn);
    height: var(--btn);
    margin-left: -6px; /* the time keeps its room; the button sits at the end */
    padding: 0;
    border: none;
    border-radius: var(--btn-radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
    align-items: center;
    justify-content: center;
  }
  .content :global(.nz-audio.selected .nz-audio-del) {
    display: inline-flex;
  }
  .content :global(.nz-audio-del:active),
  .content :global(.nz-audio-del:hover) {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  @media (prefers-reduced-motion: reduce) {
    .content :global(.nz-audio::before) {
      transition: none;
    }
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

  /* Phones: the text sits over the toolbar (see EditorToolbar), with some
     air between its first line and the palette row. */
  @media (max-width: 700px) {
    .content {
      order: 1;
      padding-top: 22px;
    }
  }
</style>
