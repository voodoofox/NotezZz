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

  // The Google session dies roughly hourly, so most launches begin with a
  // silent renewal — and background code is not allowed to open the
  // interactive flow, so that renewal can simply fail. Mark the token stale
  // so the next attempt re-auths properly, but do NOT put the sign-in screen
  // in front of someone who has notes on screen: that flash, over content
  // that was already usable, is the whole complaint. The sync banner's
  // Reconnect button is the way back, and a real tap is allowed to be
  // interactive. Gate only when there is genuinely nothing to show.
  $effect(() => {
    if (
      store.syncStatus === 'error' &&
      /401|access token|interrupt|timed out|popup/i.test(store.syncError) &&
      !isTauri() &&
      !localMode
    ) {
      void import('$lib/drive/auth').then(({ markTokenStale }) => markTokenStale());
      if (store.notes.length) return;
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

    // Text shared in from Android. Read it FIRST: the chooser is the only
    // thing that person came here for, and it needs neither the notes nor a
    // Google token to appear. Waiting for the load put a sign-in and a full
    // Drive fetch between the share sheet and the question. Writes made
    // before the store is ready queue behind init rather than being dropped.
    try {
      const pending = localStorage.getItem('notezzz:pendingShare');
      if (pending) {
        sharedText = pending;
        // Fills the "append to…" list from cache on the first frame. Drive
        // users only: local mode must never be shown another account's notes.
        if (hasPriorAuth()) store.showCachedNotes();
      }
    } catch {
      /* private mode */
    }

    await store.init();
    // A brand-new account gets a few notes explaining the app. Skipped under
    // ?local, which is the E2E suite's bypass and expects a clean slate.
    if (!localMode) await store.seedWelcome().catch((e) => console.error('seedWelcome', e));
    // Never let one failing step strand the ones below it — those wire up
    // saving, syncing and the share handoff.
    await restoreStickies(store.notes).catch((e) => console.error('restoreStickies', e));

    // Persist any pending debounced edits before the page/app goes away, so a
    // quick reload or close never loses the last few keystrokes.
    const flush = () => store.flush();
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });

    // Background sync so changes from other devices (pins, new notes) appear
    // on their own. Desktop reads local files — cheap, so poll often; web
    // hits the Drive API, so keep it gentle.
    store.startAutoSync(isTauri() ? 6000 : 45000);
    // Edits made in a sticky window land here immediately, not on the poll.
    store.listenForChanges();

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
  <!-- Both ways past the gate must start the app: opening the pane without
       booting the store leaves it on its loading spinner forever. -->
  <SignIn {onSignedIn} onLocal={onSignedIn} />
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
