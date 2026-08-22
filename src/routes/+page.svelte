<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { restoreStickies } from '$lib/desktop';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import NotePane from '$lib/components/NotePane.svelte';
  import SignIn from '$lib/components/SignIn.svelte';

  // Desktop never gates. Web waits for Google sign-in, unless "local mode" is
  // chosen (offline, localStorage) — also used by the E2E test suite via ?local.
  const localMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('local');
  let authed = $state(isTauri() || localMode);

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
    if (authed) void boot();
  });

  function onSignedIn() {
    authed = true;
    void boot();
  }
</script>

{#if authed}
  <main class="app">
    <Sidebar />
    <NotePane />
  </main>
{:else}
  <SignIn {onSignedIn} onLocal={() => (authed = true)} />
{/if}

<style>
  .app {
    display: flex;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }
</style>
