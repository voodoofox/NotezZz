<script lang="ts">
  // Chooser shown after an Android "share to NotezZz": put the shared text in
  // a brand-new note, or append it to the end of an existing one.
  import { store } from '$lib/store.svelte';
  import Icon from './Icon.svelte';

  let { text, onDone }: { text: string; onDone: () => void } = $props();

  let query = $state('');
  let targets = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.notes;
    return store.notes.filter((n) =>
      `${n.title} ${n.contentHtml.replace(/<[^>]+>/g, ' ')}`.toLowerCase().includes(q)
    );
  });

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

  function toNew() {
    const note = store.create();
    store.update(note.id, { contentHtml: asHtml(), pinned: pinIt });
    onDone();
  }

  function appendTo(id: string) {
    const note = store.notes.find((n) => n.id === id);
    if (note) {
      store.update(id, {
        contentHtml: (note.contentHtml || '') + asHtml(),
        ...(pinIt ? { pinned: true } : {}),
      });
      store.activeId = id;
    }
    onDone();
  }

  function label(n: { title: string; contentHtml: string }): string {
    const t = n.title || n.contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return t || 'Empty note';
  }
</script>

<div class="overlay" data-testid="share-overlay">
  <div class="card">
    <div class="head">
      <h2>Add shared text</h2>
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
        bind:value={query}
      />
      <div class="list">
        {#each targets as n (n.id)}
          <button class="target" data-testid="share-append-item" onclick={() => appendTo(n.id)}>
            {label(n)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
    padding: 16px;
  }
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
</style>
