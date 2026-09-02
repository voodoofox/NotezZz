<script lang="ts">
  // One dialog shell for every overlay (share chooser, draw pad, …): a single
  // backdrop style, focus moved in on open and handed back to the opener on
  // close, Escape to dismiss. Escape is handled ON the dialog element rather
  // than on the backdrop — a child that stops propagation (Settings' panel
  // does, to keep its own keys) starved a backdrop-level handler entirely.
  import { onMount, type Snippet } from 'svelte';
  import { afterNavigate } from '$app/navigation';

  interface Props {
    /** id of the element that names the dialog (aria-labelledby). */
    labelledby: string;
    onClose: () => void;
    children: Snippet;
    /** Stretch the dialog edge to edge (draw pad) instead of a centred card. */
    fill?: boolean;
    zIndex?: number;
    testid?: string;
  }
  let { labelledby, onClose, children, fill = false, zIndex = 60, testid }: Props = $props();

  let dialog = $state<HTMLDivElement | null>(null);

  // SvelteKit's reset_focus() runs when the INITIAL navigation settles and
  // focuses <body>, blurring a dialog that opened during boot (the share
  // chooser does — Escape then went nowhere). afterNavigate fires after that
  // reset, so take focus back there; a dialog opened later never sees it.
  afterNavigate(() => {
    if (dialog && document.activeElement === document.body) dialog.focus();
  });

  onMount(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog?.focus();
    return () => {
      // Only hand focus back when nothing else has claimed it. The draw pad's
      // Done focuses the editor before this teardown runs; yanking focus to
      // the toolbar button then would steal the caret the user just got.
      const cur = document.activeElement;
      if (cur && cur !== document.body && !dialog?.contains(cur)) return;
      if (opener && opener.isConnected && opener !== document.body) opener.focus();
    };
  });
</script>

<div class="backdrop" class:fill style="z-index: {zIndex}" data-testid={testid}>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={labelledby}
    tabindex="-1"
    bind:this={dialog}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }}
  >
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .backdrop.fill {
    padding: 0;
  }
  .dialog {
    outline: none;
    max-width: 100%;
    max-height: 100%;
    display: flex;
    min-height: 0;
  }
  .fill .dialog {
    position: absolute;
    inset: 0;
  }
</style>
