<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { restoreStickies } from '$lib/desktop';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import NotePane from '$lib/components/NotePane.svelte';
  import SignIn from '$lib/components/SignIn.svelte';
  import ShareIntake from '$lib/components/ShareIntake.svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import { page } from '$app/state';
  import { hasPriorAuth, isDriveAuthed, signIn, tokenExpiringSoon } from '$lib/drive/auth';
  import { scheduleUpdateChecks } from '$lib/update.svelte';
  import { hotkey } from '$lib/hotkey.svelte';

  /** Text arriving via the Android share sheet (see routes/share). */
  let sharedText = $state<string | null>(null);
  /** First desktop launch: the "where do notes live?" question (see maybeOnboard). */
  let showOnboarding = $state(false);
  const ONBOARDED_KEY = 'notezzz:onboarded';
  /** Set once the desktop listeners are wired; the hotkey effect waits on it. */
  let hotkeyArmed = $state(false);

  // Desktop never gates. Web waits for Google sign-in, unless "local mode" is
  // chosen (offline, localStorage) — also used by the E2E test suite via ?local.
  // Returning Drive users boot straight into the app (cached notes paint
  // instantly, token renews in the background) — no "Connecting…" screen.
  const localMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('local');
  let authed = $state(isTauri() || localMode || hasPriorAuth());

  let booted = false;
  let listenersWired = false;

  // Fullscreen note view is history-backed shallow state, so the system back
  // button/gesture exits fullscreen instead of leaving the app. This effect
  // is the ONLY writer of store.mobileOpen on the page side; everything that
  // wants to leave fullscreen goes through history (see NotePane).
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

  // The global shortcut follows its setting wherever the change comes from:
  // the switch in Settings here, or the same switch flipped on another device
  // and arriving through sync. Re-applying is idempotent, and a combo that
  // was unavailable gets another try each time (the other app may have quit).
  $effect(() => {
    if (!hotkeyArmed) return;
    void hotkey.apply(store.settings.hotkeyNewNote ?? false);
  });

  /**
   * Window/document listeners that must exist exactly once. boot() can run
   * again (the effect above drops to the gate and the gate re-boots), and
   * registering these inside it doubled them — two token renewals raced on
   * the next foreground, and every flush ran twice.
   */
  async function wireListeners() {
    if (listenersWired) return;
    listenersWired = true;

    // Persist any pending debounced edits before the page/app goes away, so a
    // quick reload or close never loses the last few keystrokes.
    const flush = () => store.flush();
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });

    // Edits made in a sticky window land here immediately, not on the poll.
    store.listenForChanges();

    if (isTauri()) {
      const { listen } = await import('@tauri-apps/api/event');
      await listen('tray-new-note', () => store.create());
      window.addEventListener('focus', () => void store.reload());
      // "Updates itself" has to mean it looks without being asked.
      scheduleUpdateChecks();
      // Ctrl+Alt+N from anywhere, when enabled (see hotkey.svelte.ts). Released on the
      // way out so a relaunch never finds the combo held by a dead handler.
      hotkeyArmed = true;
      window.addEventListener('beforeunload', () => void hotkey.release());
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

    // Background sync so changes from other devices (pins, new notes) appear
    // on their own. Desktop reads local files — cheap, so poll often; web
    // hits the Drive API, so keep it gentle. (Self-resetting: safe to re-run.)
    store.startAutoSync(isTauri() ? 6000 : 45000);

    await wireListeners();
    await maybeOnboard().catch((e) => console.error('onboarding', e));
  }

  /**
   * First desktop launch only: ask where the notes should live. The web app
   * has its own gate (SignIn.svelte) and ?local is the test suite's blank
   * slate, so neither ever sees this. Someone already signed in has answered
   * the question; record that, so a later sign-out doesn't re-ask it.
   */
  async function maybeOnboard() {
    if (!isTauri() || localMode) return;
    try {
      if (localStorage.getItem(ONBOARDED_KEY)) return;
    } catch {
      return; // nowhere to remember the answer: don't ask every launch
    }
    const { desktopAuthConfigured, desktopAccount } = await import('$lib/drive/desktopAuth');
    if (!desktopAuthConfigured()) return;
    if (await desktopAccount()) return onboardingDone();
    showOnboarding = true;
  }

  /** Either answer settles it; the flag is what keeps the question asked once. */
  function onboardingDone() {
    showOnboarding = false;
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
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
  {#if showOnboarding}
    <Onboarding onDone={onboardingDone} />
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
  /* Phone: stacked split — list on top, note below; .note-open expands the
     note fullscreen. The panels size themselves (Sidebar/NotePane @media). */
  @media (max-width: 700px) {
    .app {
      flex-direction: column;
    }
  }
</style>
