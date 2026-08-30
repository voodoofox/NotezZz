<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { restoreStickies } from '$lib/desktop';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import NotePane from '$lib/components/NotePane.svelte';
  import SignIn from '$lib/components/SignIn.svelte';
  import ShareIntake from '$lib/components/ShareIntake.svelte';
  import { page } from '$app/state';
  import { hasPriorAuth, isDriveAuthed, signIn, tokenExpiringSoon } from '$lib/drive/auth';

  /** Text arriving via the Android share sheet (see routes/share). */
  let sharedText = $state<string | null>(null);

  // Fullscreen note view is history-backed shallow state, so the system back
  // button/gesture exits fullscreen instead of leaving the app.
  $effect(() => {
    store.mobileOpen = (page.state as { fs?: boolean }).fs === true;
  });

  // If loading failed because the Google session is dead (revoked token,
  // blocked silent popup, auth timeout), drop back to the sign-in gate — one
  // real tap re-auths cleanly, which background code is not allowed to do.
  $effect(() => {
    if (
      store.syncStatus === 'error' &&
      /401|access token|interrupt|timed out|popup/i.test(store.syncError) &&
      !isTauri() &&
      !localMode
    ) {
      void import('$lib/drive/auth').then(({ markTokenStale }) => markTokenStale());
      booted = false;
      authed = false;
    }
  });

  // Desktop never gates. Web waits for Google sign-in, unless "local mode" is
  // chosen (offline, localStorage) — also used by the E2E test suite via ?local.
  // Returning Drive users boot straight into the app (cached notes paint
  // instantly, token renews in the background) — no "Connecting…" screen.
  const localMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('local');
  let authed = $state(isTauri() || localMode || hasPriorAuth());

  let booted = false;
  async function boot() {
    if (booted) return; // silent-auth resolution and a gate click can race
    booted = true;
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
    } else if (!localMode) {
      // Renew the Google token when the user RETURNS to the app if it's close
      // to expiry — the silent-refresh popup blink happens at open, not while
      // they're mid-edit ("screen blinked like it was logging in").
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isDriveAuthed() && tokenExpiringSoon()) {
          void signIn(false).catch(() => {});
        }
      });
    }

    // Text shared in from Android lands here after the /share redirect.
    try {
      const pending = localStorage.getItem('notezzz:pendingShare');
      if (pending) sharedText = pending;
    } catch {
      /* private mode */
    }
  }

  function shareDone() {
    sharedText = null;
    try {
      localStorage.removeItem('notezzz:pendingShare');
    } catch {
      /* ignore */
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
  <main class="app" class:note-open={store.mobileOpen}>
    <Sidebar />
    <NotePane />
  </main>
  {#if sharedText}
    <ShareIntake text={sharedText} onDone={shareDone} />
  {/if}
{:else}
  <SignIn {onSignedIn} onLocal={() => (authed = true)} />
{/if}

<style>
  .app {
    display: flex;
    height: 100vh;
    height: 100dvh; /* tracks the keyboard-resized viewport on mobile */
    width: 100vw;
    overflow: hidden;
  }
  /* Phone: stacked split — list on top (30%), note below (70%).
     .note-open expands the note fullscreen. */
  @media (max-width: 700px) {
    .app {
      flex-direction: column;
    }
    .app :global(.sidebar) {
      width: 100%;
      height: 30%;
      border-right: none;
      border-bottom: 2px solid var(--app-border);
    }
    .app :global(.pane) {
      height: 70%;
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
