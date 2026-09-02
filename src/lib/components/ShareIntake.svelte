<script lang="ts">
  // Chooser shown after an Android "share to NotezZz": put the shared text in
  // a brand-new note, or append it to the end of an existing one.
  import { store } from '$lib/store.svelte';
  import { filterNotes, noteLabel } from '$lib/text';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let { text, onDone }: { text: string; onDone: () => void } = $props();

  let query = $state('');
  let targets = $derived(filterNotes(store.notes, query));

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function asHtml(): string {
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => `<p>${esc(l)}</p>`)
      .join('');
  }

  /** Send it straight to the desktop as a sticky note. */
  let pinIt = $state(false);

  /** A brand-new note can't conflict with anything, so it needs no waiting. */
  function toNew() {
    const note = store.create();
    store.update(note.id, { contentHtml: asHtml(), pinned: pinIt });
    onDone();
  }

  /**
   * Appending is the one action that can't run on cached content: the copy
   * shown in this list may predate an edit made on another device, and
   * writing old text back with new text on the end would erase it. So wait
   * for the real note to land — the user has already chosen by then.
   */
  let appending = $state<string | null>(null);
  async function appendTo(id: string) {
    appending = id;
    await store.whenReady();
    const note = store.notes.find((n) => n.id === id);
    if (note) {
      store.update(id, {
        contentHtml: (note.contentHtml || '') + asHtml(),
        ...(pinIt ? { pinned: true } : {}),
      });
      store.activeId = id;
    }
    appending = null;
    onDone();
  }
</script>

<Modal labelledby="share-title" onClose={onDone} testid="share-overlay">
  <div class="card">
    <div class="head">
      <h2 id="share-title">Add shared text</h2>
      <button class="x" data-testid="share-cancel" title="Discard" aria-label="Discard" onclick={onDone}>
        <Icon name="close" size={18} />
      </button>
    </div>
    <blockquote class="preview">{text.length > 220 ? text.slice(0, 220) + '…' : text}</blockquote>

    <label class="pinopt" class:on={pinIt}>
      <input type="checkbox" data-testid="share-pin" bind:checked={pinIt} />
      <Icon name="pin" size={17} />
      <span>Pin it to my desktop</span>
    </label>

    <button class="new" data-testid="share-new" onclick={toNew}>
      <Icon name="add" size={17} /> New note
    </button>

    {#if store.notes.length}
      <p class="or">…or append to:</p>
      <input
        class="ssearch"
        data-testid="share-search"
        placeholder="Search notes…"
        aria-label="Search notes to append to"
        bind:value={query}
      />
      <div class="list">
        {#each targets as n (n.id)}
          <button
            class="target"
            data-testid="share-append-item"
            disabled={appending !== null}
            onclick={() => appendTo(n.id)}
          >
            {noteLabel(n)}
            {#if appending === n.id}<span class="wait">adding…</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</Modal>

<style>
  .card {
    width: 400px;
    max-width: 100%;
    max-height: 84vh;
    overflow-y: auto;
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-lg);
    padding: 16px 18px 18px;
    box-shadow: 0 14px 44px rgba(0, 0, 0, 0.32);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 20px;
  }
  .x {
    border: none;
    background: transparent;
    color: var(--app-fg);
    opacity: 0.6;
    font-size: 16px;
    cursor: pointer;
  }
  .preview {
    margin: 12px 0;
    padding: 8px 12px;
    border-left: 3px solid var(--app-fg);
    background: var(--app-bg);
    border-radius: var(--radius-sm);
    font-size: 15px;
    color: var(--app-muted);
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* Sending something to the other screen is the point of sharing here, so
     the option sits above the actions rather than hidden in settings. */
  .pinopt {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 12px;
    margin-bottom: 10px;
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    background: var(--app-bg);
    font-size: 16px;
    cursor: pointer;
    user-select: none;
  }
  .pinopt.on {
    border-color: var(--app-fg);
  }
  .pinopt input {
    width: 17px;
    height: 17px;
    accent-color: var(--app-fg);
    margin: 0;
  }
  .new {
    width: 100%;
    font: inherit;
    font-size: 16px;
    padding: 10px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--app-fg);
    color: var(--app-panel);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .or {
    margin: 14px 0 6px;
    font-size: 13px;
    color: var(--app-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .ssearch {
    width: 100%;
    font: inherit;
    font-size: 15px;
    padding: 8px 12px;
    margin-bottom: 8px;
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    background: var(--app-bg);
    color: var(--app-fg);
    outline: none;
  }
  .ssearch:focus {
    border-color: var(--app-fg);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 46vh;
    min-height: 0;
    overflow-y: auto;
    /* room for the scrollbar so long titles aren't clipped by it */
    padding-right: 2px;
  }
  .target {
    /* flex children shrink by default: without this the rows squash into
       each other as soon as the list overflows. */
    flex: 0 0 auto;
    text-align: left;
    font: inherit;
    font-size: 16px;
    line-height: 1.35;
    padding: 11px 13px;
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    background: var(--app-bg);
    color: var(--app-fg);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .target:hover {
    border-color: var(--app-fg);
  }
  /* The tapped row keeps full contrast; the rest recede while it works. */
  .target:disabled {
    cursor: default;
    opacity: 0.45;
  }
  .target:disabled:has(.wait) {
    opacity: 1;
    border-color: var(--app-fg);
  }
  .wait {
    color: var(--app-muted);
    font-size: 14px;
    margin-left: 8px;
  }
</style>
