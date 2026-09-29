<script lang="ts">
  // Ctrl+K: jump to any note by typing part of its title or text. Arrow keys
  // move, Enter opens, Escape closes. Archived notes are included (marked),
  // since this is also the fastest way back to one.
  import Modal from './Modal.svelte';
  import { store } from '$lib/store.svelte';
  import { filterNotes, noteLabel } from '$lib/text';
  import { getPalette } from '$lib/palettes';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  let query = $state('');
  let index = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  const MAX = 30;
  let results = $derived(filterNotes(store.notes, query).slice(0, MAX));

  // A new query starts from the top result.
  $effect(() => {
    void query;
    index = 0;
  });

  $effect(() => {
    input?.focus();
  });

  function open(id: string) {
    store.activeId = id;
    onClose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      index = (index + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      listEl?.children[index]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[index];
      if (hit) open(hit.id);
    }
  }
</script>

<Modal labelledby="switcher-title" {onClose} testid="switcher" zIndex={70}>
  <div class="card">
    <h2 id="switcher-title" class="sr-only">Go to note</h2>
    <input
      class="q"
      data-testid="switcher-input"
      placeholder="Go to note…"
      aria-label="Go to note"
      autocomplete="off"
      spellcheck="false"
      bind:this={input}
      bind:value={query}
      onkeydown={onKey}
    />
    <div class="results" role="listbox" aria-label="Notes" bind:this={listEl}>
      {#each results as note, i (note.id)}
        {@const pal = getPalette(note.paletteId)}
        <button
          class="hit"
          class:sel={i === index}
          role="option"
          aria-selected={i === index}
          data-testid="switcher-item"
          onpointermove={() => (index = i)}
          onclick={() => open(note.id)}
        >
          <span class="dot" style="background: {pal.pattern ? pal.header : pal.bg}"></span>
          <span class="label">{noteLabel(note)}</span>
          {#if note.archived}<span class="tag">archived</span>{/if}
        </button>
      {:else}
        <p class="none">No note matches “{query}”.</p>
      {/each}
    </div>
    <p class="keys"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</p>
  </div>
</Modal>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .card {
    width: 520px;
    max-width: 100%;
    max-height: min(560px, 80vh);
    display: flex;
    flex-direction: column;
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 14px 44px rgba(0, 0, 0, 0.32);
    overflow: hidden;
    align-self: flex-start;
    margin-top: 12vh;
  }
  .q {
    font: inherit;
    font-size: 18px;
    padding: 14px 16px;
    border: none;
    border-bottom: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-fg);
    outline: none;
  }
  .results {
    overflow-y: auto;
    padding: 6px 0;
  }
  .hit {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 16px;
    border: none;
    background: none;
    color: var(--app-fg);
    font: inherit;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
  }
  .hit.sel {
    background: var(--app-fg);
    color: var(--app-panel);
  }
  .dot {
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-fg) 18%, transparent);
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tag {
    flex: none;
    font-size: 12px;
    opacity: 0.7;
  }
  .none {
    margin: 10px 16px;
    color: var(--app-muted);
  }
  .keys {
    margin: 0;
    padding: 8px 16px;
    border-top: 1px solid var(--app-border);
    font-size: 12px;
    color: var(--app-muted);
  }
  kbd {
    font: inherit;
    padding: 0 4px;
    margin-right: 2px;
    border: 1px solid var(--app-border);
    border-radius: 4px;
  }
</style>
