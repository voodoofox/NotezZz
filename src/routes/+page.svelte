<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { isTauri, isDesktop, isMobile } from '$lib/storage/backend';
  import { restoreStickies } from '$lib/desktop';
  import { scheduleWidgetSnapshot, takeWidgetAction, type WidgetAction } from '$lib/widget';
  import { pushState } from '$app/navigation';
  // Static, like desktop.ts's: a dynamic import of a module that is also
  // imported statically makes Vite warn, and warnings abort deploys.
  import { invoke } from '@tauri-apps/api/core';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import NotePane from '$lib/components/NotePane.svelte';
  import SignIn from '$lib/components/SignIn.svelte';
  import ShareIntake from '$lib/components/ShareIntake.svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import QuickSwitcher from '$lib/components/QuickSwitcher.svelte';
  import UndoToast from '$lib/components/UndoToast.svelte';
  import { page } from '$app/state';
  import { hasPriorAuth, isDriveAuthed, signIn, tokenExpiringSoon } from '$lib/drive/auth';
  import { scheduleUpdateChecks } from '$lib/update.svelte';
  import { hotkey } from '$lib/hotkey.svelte';

  /** Text arriving via the Android share sheet (see routes/share, pullMobileShare). */
  let sharedText = $state<string | null>(null);
  const SHARE_KEY = 'notezzz:pendingShare';
  /** First desktop/Android launch: the "where do notes live?" question (see maybeOnboard). */
  let showOnboarding = $state(false);
  /** Ctrl+K: the jump-to-note box (QuickSwitcher). */
  let showSwitcher = $state(false);

  function onGlobalKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault(); // the browser's own Ctrl+K is its search bar
      if (authed && store.notes.length) showSwitcher = !showSwitcher;
    }
  }
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

  // Android home-screen widgets read a file, not the store, so the file has
  // to follow the list. An effect here, rather than the outbox's settle
  // callback, because the widget must also reflect changes that never pass
  // through this device's outbox: the initial load, a poll that brings an
  // edit or a pin from the PC, a share appended by the chooser. Everything
  // the widget can show comes through store.notes; nothing else does.
  $effect(() => {
    scheduleWidgetSnapshot(store.notes, () => store.driveIds());
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
    // Back online (a phone waking, a train leaving a tunnel): sync now
    // instead of waiting for the next heartbeat.
    window.addEventListener('online', () => store.backOnline());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });

    // Edits made in a sticky window land here immediately, not on the poll.
    store.listenForChanges();

    if (isDesktop()) {
      // Tray, updater, stickies, global hotkey: a PC around the window. None
      // of it exists on Android, which is Tauri too — hence isDesktop().
      const { listen } = await import('@tauri-apps/api/event');
      await listen('tray-new-note', () => store.create());
      // Started from the taskbar's "New note" (jump list): make it now.
      const { invoke } = await import('@tauri-apps/api/core');
      if (await invoke<boolean>('take_launch_new_note').catch(() => false)) store.create();
      window.addEventListener('focus', () => void store.reload());
      // "Updates itself" has to mean it looks without being asked.
      scheduleUpdateChecks();
      // Reminders pin their note when due (store.fireDueReminders). On the
      // second: the app's native side wakes us (see the effect arming it);
      // checked now too, for any that came due while the PC was off, and
      // every 20s as a backstop.
      await listen('reminder-due', () => store.fireDueReminders());
      store.fireDueReminders();
      setInterval(() => store.fireDueReminders(), 20_000);
      // Ctrl+Alt+N from anywhere, when enabled (see hotkey.svelte.ts). Released on the
      // way out so a relaunch never finds the combo held by a dead handler.
      hotkeyArmed = true;
      window.addEventListener('beforeunload', () => void hotkey.release());
    } else if (isMobile()) {
      // Android hands a share to an app that is ALREADY running rather than
      // starting a fresh one, so the file has to be re-read on every return
      // to the foreground, not just at boot.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        void pullMobileShare();
        void pullWidgetAction();
      });
      // A tap while the app is already on screen (a reminder, say) brings no
      // return to the foreground to notice; MainActivity calls this instead.
      (window as unknown as { __nzPullAction?: () => void }).__nzPullAction = () => void pullWidgetAction();
      // Updates come from GitHub Releases here too (updater.ts).
      scheduleUpdateChecks();
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

  /**
   * Android only: text shared into the app via the system share sheet. The
   * Kotlin activity writes it to a file; take_pending_share returns and clears
   * it. Stashed under the same key the web share route uses, so from here on
   * the chooser, the reload guard in +layout and shareDone() behave exactly as
   * they do for a web share. A chooser that is already open keeps its text:
   * the new share stays in the file and is taken when that chooser closes.
   */
  async function pullMobileShare() {
    if (!isMobile() || sharedText) return;
    try {
      const text = await invoke<string | null>('take_pending_share');
      if (!text?.trim()) return;
      try {
        localStorage.setItem(SHARE_KEY, text);
      } catch {
        /* private mode: the chooser still shows; it just won't survive a reload */
      }
      sharedText = text;
    } catch (e) {
      console.error('take_pending_share', e);
    }
  }

  /**
   * Android only: a tap on a home-screen widget or a reminder notification.
   * MainActivity stashes it like a share; this takes it and carries it out
   * once its note is on screen (see runWidgetAction). Every action ends on the
   * note, fullscreen, because that is what the tap was for: reading it, or
   * writing, speaking or drawing into a fresh one.
   */
  async function pullWidgetAction() {
    const act = await takeWidgetAction();
    if (act) pendingAct = act;
    runWidgetAction();
  }

  // The tap being carried out, kept while its note may still be on its way:
  // a reminder's note opens from the cache at once, without waiting for
  // Drive, and one the cache doesn't have yet waits for the full load.
  let pendingAct: WidgetAction | null = null;
  let notesLoaded = false;

  function runWidgetAction() {
    const act = pendingAct;
    if (!act) return;
    if (act.action === 'show') {
      pendingAct = null; // "show" just brings the app up
      return;
    }
    if (act.action === 'open') {
      if (!act.id || !store.notes.some((n) => n.id === act.id)) {
        if (notesLoaded) pendingAct = null; // deleted since
        return;
      }
      pendingAct = null;
      store.activeId = act.id;
    } else {
      if (!notesLoaded) return; // a new note belongs in the real list
      pendingAct = null;
      const note = store.create();
      if (act.action === 'voice' || act.action === 'draw') {
        store.requestedTool = { id: note.id, tool: act.action };
      }
    }
    if ((page.state as { fs?: boolean }).fs !== true) pushState('', { fs: true });
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
      const pending = localStorage.getItem(SHARE_KEY);
      if (pending) {
        sharedText = pending;
        // Fills the "append to…" list from cache on the first frame. Drive
        // users only: local mode must never be shown another account's notes.
        if (hasPriorAuth()) store.showCachedNotes();
      }
    } catch {
      /* private mode */
    }
    // Android's share sheet arrives through Rust rather than a URL. Same
    // rule: before the load, so the question comes up at once.
    await pullMobileShare();

    // PC: the cached notes, and the pinned ones' stickies, at once; the
    // Drive load then only adds what's new. (Stickies used to wait for the
    // whole load, after a long blank pause.)
    if (await store.paintCachedNow()) {
      void restoreStickies(store.notes).catch((e) => console.error('restoreStickies', e));
      // Android: a reminder or widget tap opens its note from the cache now.
      await pullWidgetAction();
    }
    await store.init();
    notesLoaded = true;
    // A brand-new account gets a few notes explaining the app. Skipped under
    // ?local, which is the E2E suite's bypass and expects a clean slate.
    if (!localMode) await store.seedWelcome().catch((e) => console.error('seedWelcome', e));
    // Never let one failing step strand the ones below it — those wire up
    // saving, syncing and the share handoff. Only the stickies not already
    // open (pinned since the cache, or no cache at all).
    await restoreStickies(store.notes, { onlyMissing: true }).catch((e) => console.error('restoreStickies', e));

    // Background sync so changes from other devices (pins, new notes) appear
    // on their own. Desktop reads local files — cheap, so poll often; web and
    // Android hit the Drive API (or, signed out, a folder nobody else writes
    // to), so keep it gentle. (Self-resetting: safe to re-run.)
    store.startAutoSync(isDesktop() ? 6000 : 45000);

    await wireListeners();
    // A widget tap that started the app. After the load, so "open" finds its
    // note and a new one lands in the real list rather than an empty one.
    await pullWidgetAction();
    await maybeOnboard().catch((e) => console.error('onboarding', e));
  }

  /**
   * First launch of the desktop or Android app only: ask where the notes
   * should live. Both boot without a gate and both sign in through the same
   * Rust flow, so isTauri() is the right test. The web app has its own gate
   * (SignIn.svelte) and ?local is the test suite's blank slate, so neither
   * ever sees this. Someone already signed in has answered the question;
   * record that, so a later sign-out doesn't re-ask it.
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
      localStorage.removeItem(SHARE_KEY);
    } catch {
      /* ignore */
    }
    // A share that arrived while the chooser was up is waiting in the file.
    void pullMobileShare();
  }

  // PC: hand the next reminder's time to the native side, which wakes this
  // window the second it's due. A window hidden in the tray has its own
  // timers held back to about once a minute, so the phone rang first and
  // the sticky turned up a minute later.
  $effect(() => {
    if (!isDesktop()) return;
    const at = store.nextReminderAt;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('arm_reminder', { at }))
      .catch(() => {});
  });

  onMount(() => {
    if (authed) void boot();
    // The E2E suite's stand-in for the old "Sync now" button (dev server only).
    if (import.meta.env.DEV) {
      const w = window as unknown as { __nzSyncNow?: () => Promise<void>; __nzFireReminders?: () => void };
      w.__nzSyncNow = () => store.syncNow();
      // The desktop's reminder tick, callable where the desktop loop doesn't run.
      w.__nzFireReminders = () => store.fireDueReminders();
      // A widget or reminder tap, as MainActivity hands it over.
      (w as unknown as { __nzTap: (a: WidgetAction) => void }).__nzTap = (a) => {
        pendingAct = a;
        runWidgetAction();
      };
      // Sync progress, which ?local never shows on its own.
      (w as unknown as { __nzPulling: (on: boolean) => void }).__nzPulling = (on) => (store.pulling = on);
    }
  });

  function onSignedIn() {
    authed = true;
    void boot();
  }
</script>

<svelte:window onkeydown={onGlobalKey} />

{#if authed}
  <main class="app" class:note-open={store.mobileOpen} class:stacked={(store.settings.layout ?? 'top') === 'top'}>
    <Sidebar />
    <NotePane />
  </main>
  {#if sharedText}
    <ShareIntake text={sharedText} onDone={shareDone} />
  {/if}
  <UndoToast />
  {#if showSwitcher}
    <QuickSwitcher onClose={() => (showSwitcher = false)} />
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
    /* Android app only: room for the status bar (see +layout). 0 elsewhere. */
    padding-top: var(--safe-top, 0px);
    box-sizing: border-box;
    /* Seen only in that strip: the colour of the app's top bar, so the
       status bar and the header read as one. */
    background: var(--app-panel);
  }
  /* Phone: stacked split — list on top, note below; .note-open expands the
     note fullscreen. The panels size themselves (Sidebar/NotePane @media). */
  @media (max-width: 700px) {
    .app {
      flex-direction: column;
    }
    /* A note open full screen runs up under the status bar itself (its
       title bar takes the room, see NotePane): the strip is the note's. */
    .app.note-open {
      padding-top: 0;
    }
  }
  /* Settings -> "Note list above the note": the phone arrangement at any
     width. Same 30/70 split; the panels size themselves (Sidebar/NotePane). */
  .app.stacked {
    flex-direction: column;
  }
</style>
