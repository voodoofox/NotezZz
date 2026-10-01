<script lang="ts">
  // "Archived · Undo", floating over the app for a few seconds after a note
  // is archived. Archiving takes the note out of view at once, so this is
  // the easy way back from a mis-tap (the Archive entry in the list is the
  // slow way). A newer archive replaces the older offer.
  import { store } from '$lib/store.svelte';

  const SHOW_MS = 6000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const offer = store.undoArchive;
    clearTimeout(timer);
    if (!offer) return;
    timer = setTimeout(() => {
      if (store.undoArchive === offer) store.undoArchive = null;
    }, SHOW_MS);
    return () => clearTimeout(timer);
  });
</script>

{#if store.undoArchive}
  <div class="toast" role="status" data-testid="undo-toast">
    <span class="msg">Archived “{store.undoArchive.label}”</span>
    <button data-testid="undo-archive" onclick={() => store.restoreArchived()}>Undo</button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(24px + var(--safe-bottom, 0px));
    transform: translateX(-50%);
    z-index: 55;
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: calc(100vw - 32px);
    padding: 10px 10px 10px 16px;
    border-radius: var(--radius-lg);
    background: var(--app-fg);
    color: var(--app-panel);
    box-shadow: var(--sticker-shadow);
    font-size: 15px;
    animation: rise 180ms ease-out;
  }
  .msg {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  button {
    flex: none;
    font: inherit;
    font-weight: 700;
    padding: 6px 12px;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  button:hover,
  button:focus-visible {
    background: color-mix(in srgb, var(--app-panel) 16%, transparent);
  }
  /* Phones: clear of the note's bottom toolbar. */
  @media (max-width: 700px) {
    .toast {
      bottom: calc(76px + var(--safe-bottom, 0px));
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
