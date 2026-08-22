<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { restoreStickies } from '$lib/desktop';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import NotePane from '$lib/components/NotePane.svelte';
  import SignIn from '$lib/components/SignIn.svelte';

  import { hasPriorAuth, signIn } from '$lib/drive/auth';

  // Desktop never gates. Web waits for Google sign-in, unless "local mode" is
  // chosen (offline, localStorage) — also used by the E2E test suite via ?local.
  const localMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('local');
  let authed = $state(isTauri() || localMode);
  // Returning users skip the gate: try a silent token grab first.
  let autoSigningIn = $state(!isTauri() && !localMode && hasPriorAuth());

  async function boot() {
    await store.init();
    await restoreStickies(store.notes);

    // Persist any pending debounced edits before the page/app goes away, so a
    // quick reload or close never loses the last few keystrokes.
    const flush = () => store.flush();
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });

    if (isTauri()) {
      const { listen } = await import('@tauri-apps/api/event');
      await listen('tray-new-note', () => store.create());
      window.addEventListener('focus', () => void store.reload());
    }
  }

  onMount(() => {
    if (authed) return void boot();
    if (autoSigningIn) {
      // Silent re-auth for returning users — no Google screens on refresh.
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), 8000)
      );
      Promise.race([signIn(false), timeout])
        .then(() => {
          authed = true;
          void boot();
        })
        .catch(() => {
          /* fall back to the sign-in gate */
        })
        .finally(() => (autoSigningIn = false));
    }
  });

  function onSignedIn() {
    authed = true;
    void boot();
  }
</script>

{#if authed}
  <main class="app" class:note-open={store.mobileOpen}>
    <Sidebar />
    <NotePane />
  </main>
{:else if autoSigningIn}
  <div class="connecting">Connecting…</div>
{:else}
  <SignIn {onSignedIn} onLocal={() => (authed = true)} />
{/if}

<style>
  .connecting {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    color: var(--app-muted);
    font-size: 18px;
  }
  .app {
    display: flex;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }
  /* Phone: stacked split — list on top (40%), note below (60%).
     .note-open expands the note fullscreen. */
  @media (max-width: 700px) {
    .app {
      flex-direction: column;
    }
    .app :global(.sidebar) {
      width: 100%;
      height: 40%;
      border-right: none;
      border-bottom: 2px solid var(--app-border);
    }
    .app :global(.pane) {
      height: 60%;
      flex: none;
      width: 100%;
    }
    .app.note-open :global(.sidebar) {
      display: none;
    }
    .app.note-open :global(.pane) {
      height: 100%;
    }
  }
</style>
