<script lang="ts">
  // "Move to folder": the folders, a way out of the one the note is in, and
  // a new folder named on the spot (the note goes straight into it). Shared
  // by the list's row menu and the note's ⋯ menu.
  import { store } from '$lib/store.svelte';
  import Icon from './Icon.svelte';

  let {
    noteId,
    onDone,
    beforeMove,
  }: {
    noteId: string;
    onDone: () => void;
    /** Told first, with where the note goes (the list's own menu keeps the list still). */
    beforeMove?: (folderId: string | null) => void;
  } = $props();

  let note = $derived(store.notes.find((n) => n.id === noteId) ?? null);
  let current = $derived(note ? (store.folderOf(note)?.id ?? null) : null);
  let naming = $state(false);
  let name = $state('');
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (naming) input?.focus();
  });

  function pick(id: string | null) {
    beforeMove?.(id);
    store.moveToFolder(noteId, id);
    onDone();
  }

  function create() {
    const folder = store.createFolder(name);
    if (folder) pick(folder.id);
  }
</script>

<div class="picker" data-testid="folder-picker">
  <p class="head">Move to folder</p>
  {#if note?.archived}
    <p class="hint" data-testid="folder-pick-unarchives">It comes back out of the archive.</p>
  {/if}
  {#each store.folders as f (f.id)}
    <button
      class="mi"
      role="menuitemradio"
      aria-checked={current === f.id}
      data-testid="folder-pick"
      onclick={() => pick(f.id)}
    >
      <Icon name="folder" /><span class="nm">{f.name}</span>
      {#if current === f.id}<span class="mv"><Icon name="check" size={18} /></span>{/if}
    </button>
  {/each}
  {#if current}
    <button class="mi" role="menuitem" data-testid="folder-pick-none" onclick={() => pick(null)}>
      <Icon name="close" /><span class="nm">No folder</span>
    </button>
  {/if}
  {#if naming}
    <form
      class="newrow"
      onsubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <input
        bind:this={input}
        bind:value={name}
        data-testid="folder-new-name"
        placeholder="Folder name"
        aria-label="New folder name"
        maxlength="60"
        onkeydown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            naming = false;
            name = '';
          }
        }}
      />
      <button class="ok" type="submit" data-testid="folder-new-ok" disabled={!name.trim()} aria-label="Create folder">
        <Icon name="check" size={18} />
      </button>
    </form>
  {:else}
    <button class="mi" role="menuitem" data-testid="folder-new" onclick={() => (naming = true)}>
      <Icon name="newFolder" /><span class="nm">New folder…</span>
    </button>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: min(60vh, 420px);
    overflow-y: auto;
  }
  .head {
    margin: 2px 0 4px;
    padding: 0 10px;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--app-muted);
  }
  .hint {
    margin: -2px 0 4px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--app-muted);
  }
  .mi {
    display: flex;
    align-items: center;
    gap: 12px;
    font: inherit;
    font-size: 15px;
    font-weight: 400;
    text-align: left;
    padding: 9px 10px;
    border: none;
    border-radius: var(--btn-radius);
    background: transparent;
    color: var(--app-fg);
    cursor: pointer;
  }
  .mi:hover,
  .mi:active {
    background: var(--app-bg);
  }
  .nm {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mv {
    display: inline-flex;
    margin-left: auto;
  }
  .newrow {
    display: flex;
    gap: 6px;
    padding: 4px 4px 2px;
  }
  .newrow input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 15px;
    padding: 7px 9px;
    border: 1px solid var(--app-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--app-fg);
  }
  .newrow input:focus {
    outline: none;
    border-color: var(--app-fg);
  }
  .ok {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--app-fg);
    color: var(--app-panel);
    cursor: pointer;
  }
  .ok:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
