<script lang="ts">
  // Chooser shown after an Android "share to NotezZz": put the shared text in
  // a brand-new note, or append it to the end of an existing one.
  import { store } from '$lib/store.svelte';
  import Icon from './Icon.svelte';

  let { text, onDone }: { text: string; onDone: () => void } = $props();

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

  function toNew() {
    const note = store.create();
    store.update(note.id, { contentHtml: asHtml() });
    onDone();
  }

  function appendTo(id: string) {
    const note = store.notes.find((n) => n.id === id);
    if (note) {
      store.update(id, { contentHtml: (note.contentHtml || '') + asHtml() });
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

    <button class="new" data-testid="share-new" onclick={toNew}>＋ New note</button>

    {#if store.notes.length}
      <p class="or">…or append to:</p>
      <div class="list">
        {#each store.notes as n (n.id)}
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
    border-radius: 14px;
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
    border-left: 3px solid var(--app-accent);
    background: var(--app-bg);
    border-radius: 6px;
    font-size: 15px;
    color: var(--app-muted);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .new {
    width: 100%;
    font: inherit;
    font-size: 16px;
    padding: 10px;
    border: none;
    border-radius: 9px;
    background: var(--app-accent);
    color: #fff;
    cursor: pointer;
  }
  .or {
    margin: 14px 0 6px;
    font-size: 13px;
    color: var(--app-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .target {
    text-align: left;
    font: inherit;
    font-size: 15px;
    padding: 9px 11px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    color: var(--app-fg);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .target:hover {
    border-color: var(--app-accent);
  }
</style>
