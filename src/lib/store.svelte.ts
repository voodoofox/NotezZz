// Central app store (Svelte 5 runes). Holds notes + settings in reactive state
// and persists changes through whichever StorageBackend is active.
//
// Writes go through the Outbox (./outbox.ts): one in flight per note, retried
// on failure, mirrored to localStorage. Every merge in this file asks the
// outbox whether a note's latest local change has landed, and keeps the local
// copy while it hasn't. Typing is debounced 400ms BEFORE it reaches the
// outbox — that debounce is a keystroke coalescer, not part of durability,
// which is why flush() exists for page-hide.

import { isDriveAccessError } from './drive/driveAccess';
import { UNKNOWN_ACCOUNT } from './drive/account';
import { BASE_FONT_PX, DEFAULT_NOTE_PX, DEFAULT_SETTINGS, newNote, rollTilt, type Note, type Settings } from './types';
import { welcomeNotes } from './welcome';
import { Outbox, type OutboxOp } from './outbox';
import type { StorageBackend } from './storage/backend';
import { isTauri, isDesktop } from './storage/backend';
import { noteLabel } from './text';
import { LocalBackend } from './storage/localBackend';
import { openSticky, closeSticky, hideSticky, broadcastChange, onRemoteChange } from './desktop';

/**
 * Newest-first, one note per id. Duplicate ids (Drive "(1)" copies, file-sync
 * artifacts) would crash the keyed note list, so filter them defensively no
 * matter which backend produced the data.
 */
function dedupeById(notes: Note[]): Note[] {
  const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  const seen = new Set<string>();
  return sorted.filter((n) => !seen.has(n.id) && (seen.add(n.id), true));
}

/**
 * Sort by a remembered arrangement. Notes not in it lead, newest first, so a
 * new note never hides at the bottom. Used both for the user's manual order
 * and for holding the on-screen order steady across a refresh (any edit bumps
 * updatedAt, and a pure newest-first sort would yank the note you just
 * touched to the top while you're looking at it).
 */
/** Newest first: by when a note was made, never by when it was last edited
 *  (that moved notes around on every sync and every reload). */
const newestFirst = (a: Note, b: Note) => (b.createdAt || b.updatedAt) - (a.createdAt || a.updatedAt);

function orderedBy(anchor: string[]): (a: Note, b: Note) => number {
  const pos = new Map(anchor.map((id, i) => [id, i]));
  return (a, b) => {
    const ai = pos.get(a.id);
    const bi = pos.get(b.id);
    if (ai === undefined && bi === undefined) return newestFirst(a, b);
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    return ai - bi;
  };
}

async function pickBackend(): Promise<StorageBackend> {
  if (isTauri()) {
    // Signed in on desktop? Talk to Drive directly, so notes carry the app's
    // identity and are visible to every other device. Otherwise fall back to
    // the local sync folder (offline / not signed in).
    const { desktopAuthConfigured, desktopAccount } = await import('./drive/desktopAuth');
    if (desktopAuthConfigured() && (await desktopAccount())) {
      const { DriveBackend } = await import('./drive/driveBackend');
      return new DriveBackend();
    }
    const { FsBackend } = await import('./storage/fsBackend');
    return new FsBackend();
  }
  const { isDriveAuthed, hasPriorAuth } = await import('./drive/auth');
  // hasPriorAuth: even if the cached token expired, this browser IS a Drive
  // user — go Drive and let the token renew silently, instead of silently
  // dropping into an (empty) localStorage mode that looks like data loss.
  if (isDriveAuthed() || hasPriorAuth()) {
    const { DriveBackend } = await import('./drive/driveBackend');
    return new DriveBackend();
  }
  return new LocalBackend();
}

/** Local mirror of Drive notes so startup renders instantly from cache. */
const CACHE_KEY = 'notezzz:cache:notes';
/** Cached settings — theme/palette apply immediately, not after the network. */
const SETTINGS_CACHE_KEY = 'notezzz:cache:settings';
/** Whose notes the cache holds: it is only ever shown to that account. */
const CACHE_ACCOUNT_KEY = 'notezzz:cache:account';
/** Marks that this launch already retried itself — never reload twice. */
const REBOOT_KEY = 'notezzz:reboot';

/** How long network trouble lasts before it is mentioned (tests shorten it
 *  through a storage key, as with the other test hooks). */
function offlineGrace(): number {
  try {
    const t = localStorage.getItem('notezzz:test:offlineGrace');
    if (t !== null) return Number(t);
  } catch {
    /* no storage */
  }
  return 45_000;
}

/** What a run of network failures says, instead of the browser's wording. */
const OFFLINE_MESSAGE = "Can't reach Google Drive. Your notes are kept here and will sync when the connection is back.";

class AppStore {
  notes = $state<Note[]>([]);
  // The theme app.html chose before the first paint (from the cache)
  // carries over: applying the default 'light' first flashed a light app
  // for the moment until the cached settings were read.
  settings = $state<Settings>({ ...DEFAULT_SETTINGS, appTheme: earlyTheme() });
  activeId = $state<string | null>(null);
  loaded = $state(false);

  // Sync status for the UI. 'local' = this-browser/device only (no cloud);
  // 'loading'/'saving'/'synced' = Drive; 'error' = last op failed.
  syncStatus = $state<'local' | 'loading' | 'saving' | 'synced' | 'error'>('local');
  syncError = $state<string>('');

  /** Phone layout: true while the note is expanded fullscreen (over the 40/60 split). */
  mobileOpen = $state(false);
  /**
   * A tool the next editor for this note should open by itself: the voice and
   * draw buttons on the Android quick-add widget. The Editor showing note
   * `id` takes it (and clears it) once it has mounted.
   */
  requestedTool = $state<{ id: string; tool: 'voice' | 'draw' } | null>(null);

  #backend: StorageBackend | null = null;
  /** Keystroke debounce per note — edits waiting to enter the outbox. */
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #outbox = new Outbox(
    (op) => this.#perform(op),
    (ok, e) => this.#settled(ok, e)
  );
  #reloading = false;
  #lastReload = 0;
  #autoTimer: ReturnType<typeof setInterval> | undefined;
  /** Refresh backoff after failed polls, so a rate limit isn't hammered. */
  #pollFailures = 0;
  #pollBackoffUntil = 0;
  /**
   * Tombstones for deletes that have LANDED: the backend may take a moment to
   * stop listing the file, and a refresh in that window would resurrect it.
   * A delete that hasn't landed is still in the outbox, which is the durable
   * tombstone.
   */
  #deleted = new Map<string, number>();
  static #TOMBSTONE_MS = 120_000;
  /** Resolves once init has settled, so writes can queue behind it. */
  #markReady!: () => void;
  #ready = new Promise<void>((resolve) => (this.#markReady = resolve));

  active = $derived(this.notes.find((n) => n.id === this.activeId) ?? null);

  get isCloud(): boolean {
    return this.#backend?.kind === 'drive';
  }

  /** True while this note has a local change that hasn't landed in storage. */
  #pending(id: string): boolean {
    return this.#timers.has(id) || this.#outbox.has(id);
  }

  #isDeleted(id: string): boolean {
    return this.#deleted.has(id) || this.#outbox.isDeleting(id);
  }

  async init() {
    // A returning Drive user's notes are already on this device. Paint them
    // BEFORE anything that can touch the network: choosing the backend below
    // is a chunk fetch, and on a phone with a slow radio it can take the
    // whole 20s guard — during which the screen used to be a bare spinner
    // over an empty list, indistinguishable from the app being broken.
    if (!isTauri()) {
      const { hasPriorAuth } = await import('./drive/auth'); // static elsewhere: no fetch
      this.#account = webAccount();
      if (hasPriorAuth()) this.#paintCache();
    } else {
      // The apps the same: signed in (tokens on this device, a local check,
      // no network) means a Drive user whose notes are cached here. Before,
      // the PC showed nothing until the whole Drive list had arrived.
      await this.paintCachedNow();
    }
    // Choosing a backend does dynamic imports, which are network fetches: on a
    // phone waking with the radio asleep — or on a page restored from cache
    // after a deploy, whose chunks are gone from the server — this rejects or
    // never settles. It used to sit outside any guard, so the app was left on
    // its "Loading notes…" spinner with no error and no way out.
    try {
      this.#backend = await Promise.race([
        pickBackend(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("Couldn't reach storage — tap Reconnect.")), 20_000)
        ),
      ]);
    } catch (e) {
      // A reload is what the user would (and did) do by hand, and it fixes
      // both causes. Do it for them, once, before giving up and showing why.
      if (this.#rebootOnce()) return;
      this.#paintCache();
      this.#fail(e, this.notes.length > 0);
      this.loaded = true;
      this.#markReady();
      return;
    }
    this.#clearReboot();
    const cloud = this.#backend.kind === 'drive';
    if (cloud && !this.#account) {
      // Who is this? (PC/Android: the stored sign-in; web: the email Drive
      // reported, once known.)
      if (isTauri()) {
        const { desktopAccount } = await import('./drive/desktopAuth');
        this.#account = await desktopAccount().catch(() => null);
      } else {
        this.#account = webAccount();
      }
    }
    this.syncStatus = cloud ? 'loading' : 'local';
    // Cloud mode: paint cached notes + settings instantly; the Drive refresh
    // replaces them when it lands. Kills the startup loading screen and the
    // late theme/palette flip.
    if (cloud) this.#paintCache();
    // Writes a previous page load never finished (closed mid-upload, offline)
    // go first, so the list we fetch below already reflects them where it can.
    this.#outbox.restore();
    // Let them land before we read, or the list comes back without them and
    // the screen shows the old copy until the next poll. Bounded: offline,
    // they fail fast and the merge keeps them as pending instead.
    await this.#outbox.idle(3000);
    try {
      // Watchdog: whatever goes wrong below, "Loading…" may never be forever —
      // surface an error (with its Reconnect button) instead.
      const load = Promise.all([this.#backend.listNotes(), this.#backend.loadSettings()]);
      const watchdog = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('Loading timed out — check your connection and retry.')), 45_000)
      );
      const [notes, settings] = await Promise.race([load, watchdog]);
      // Order lives here, so read it first. Not over changes of ours the
      // network dropped (a reorder, say): those win and are sent again.
      if (settings && !this.#settingsOwed) this.settings = settings;
      this.#migrateSettings();
      this.notes = this.#merge(notes);
      if (!this.activeId && this.notes.length) this.activeId = this.notes[0].id;
      if (!this.#outbox.busy) this.syncStatus = cloud ? 'synced' : 'local';
      this.#cacheNotes();
      this.#recovered();
    } catch (e) {
      this.#fail(e, this.notes.length > 0);
    }
    this.loaded = true;
    this.#markReady();
  }

  /**
   * First run only: leave a few notes that explain the app. Call after init.
   *
   * The guards matter more than the notes do — seeding into an account that
   * already has notes would scatter three files across the user's Drive for
   * them to clean up, so anything short of "we definitely saw an empty
   * account" declines and tries again next launch.
   */
  async seedWelcome() {
    if (this.settings.seeded || !this.loaded) return;
    if (this.syncStatus === 'error') return; // empty because the load FAILED
    if (this.notes.length) return void this.saveSettings({ seeded: true });

    const notes = welcomeNotes(this.settings.defaultFontSize, this.isCloud);
    this.notes = notes;
    this.activeId ??= notes[0].id;
    await Promise.all(notes.map((note) => this.#save(note)));
    await this.saveSettings({ seeded: true });
  }

  /**
   * Paint this device's cached notes without touching the network. The share
   * sheet uses it so its "append to..." list is there on the first frame,
   * before any sign-in or Drive fetch. Cloud users only — a local-mode user
   * must never be shown notes from an account they didn't open.
   */
  showCachedNotes() {
    this.#paintCache();
  }

  /** Resolves when init has settled (either way). */
  whenReady(): Promise<void> {
    return this.#ready;
  }

  /**
   * The app (PC, Android): paint the cached notes now if this device is
   * signed in to Drive. Cheap and safe to call more than once; the page
   * calls it first so pinned stickies can open from the cache at once.
   */
  async paintCachedNow(): Promise<boolean> {
    if (!isTauri() || this.notes.length) return this.notes.length > 0;
    // Android: the account is a synchronous bridge call, so the cache is
    // painted before anything async (the first frame used to be an empty
    // "Loading notes…" list for the round-trip's length).
    const b = (window as unknown as { NotezzzAndroid?: { googleAccount?(): string } }).NotezzzAndroid;
    if (typeof b?.googleAccount === 'function') {
      try {
        const a = JSON.parse(b.googleAccount()) as { signedIn?: boolean; email?: string };
        if (a.signedIn) {
          this.#account = a.email || UNKNOWN_ACCOUNT;
          this.#paintCache();
        }
        return this.notes.length > 0;
      } catch {
        /* fall through to the async path */
      }
    }
    try {
      const { desktopAccount } = await import('./drive/desktopAuth');
      this.#account = await desktopAccount();
      if (this.#account) this.#paintCache();
    } catch {
      /* no account: the load decides */
    }
    return this.notes.length > 0;
  }

  /** Show the last known notes and settings from this device's cache. */
  #paintCache() {
    if (this.notes.length) return;
    try {
      // Another account's notes and settings (its "welcome notes done", its
      // order) must never be shown — or kept — for this one: a new account
      // signed in on a used device got no welcome notes. A cache with no
      // owner (written before owners were recorded) is skipped the same way.
      const owner = localStorage.getItem(CACHE_ACCOUNT_KEY);
      if (!this.#account || owner !== this.#account) {
        if (owner && this.#account && owner !== this.#account) {
          localStorage.removeItem(CACHE_KEY);
          localStorage.removeItem(SETTINGS_CACHE_KEY);
          localStorage.removeItem(CACHE_ACCOUNT_KEY);
        }
        return;
      }
      // Settings first: the order lives there.
      const cachedSettings = localStorage.getItem(SETTINGS_CACHE_KEY);
      if (cachedSettings) this.settings = { ...this.settings, ...JSON.parse(cachedSettings) };
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]') as Note[];
      if (cached.length) {
        // In the order the list settles on after the load, so the load only
        // adds and updates; it never reshuffles what is already showing.
        this.notes = dedupeById(cached).sort(orderedBy(this.settings.noteOrder ?? []));
        if (!this.activeId) this.activeId = this.notes[0]?.id ?? null;
        this.loaded = true;
      }
    } catch {
      /* corrupt cache — the network load will rebuild it */
    }
  }

  /**
   * Reload the page once per launch to shake off a startup that couldn't get
   * off the ground. Guarded by sessionStorage so a persistent failure shows
   * its error instead of reloading forever.
   */
  #rebootOnce(): boolean {
    try {
      if (sessionStorage.getItem(REBOOT_KEY)) return false;
      sessionStorage.setItem(REBOOT_KEY, '1');
      location.reload();
      return true;
    } catch {
      return false; // private mode: fall through to the visible error
    }
  }

  #clearReboot() {
    try {
      sessionStorage.removeItem(REBOOT_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  /** Keep the instant-start cache in step with reality (cloud mode only). */
  #cacheNotes() {
    if (this.#backend?.kind !== 'drive') return;
    try {
      // Unknown owner, no cache: it could end up shown to someone else.
      if (!this.#account) return;
      localStorage.setItem(CACHE_ACCOUNT_KEY, this.#account);
      localStorage.setItem(CACHE_KEY, JSON.stringify($state.snapshot(this.notes)));
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify($state.snapshot(this.settings)));
    } catch {
      /* quota — cache is best-effort */
    }
  }

  /** The signed-in account (its email), owner of what gets cached. */
  #account: string | null = null;

  /** Network failures since the connection last worked. */
  #offlineStreak = 0;
  /** When that run of failures began (0 = the connection is fine). */
  #offlineSince = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #retryStep = 0;
  /** A settings save the network dropped, sent again once it's back. */
  #settingsOwed = false;

  /**
   * Show a sync error. Network trouble on background work (polls, queued
   * writes, settings, a start-up with notes already on screen) is retried
   * quickly and only said once it has lasted: a connection that drops for
   * a second, while a few notes happen to be syncing, used to fail three
   * requests at once and put the message up at once. Refusals (sign-in,
   * permissions) show straight away. Network trouble is said in words.
   */
  #fail(e: unknown, background = false) {
    console.error('[NotezZz sync]', e);
    const transient = isTransient(e);
    if (transient && background) {
      this.#offlineStreak += 1;
      if (!this.#offlineSince) this.#offlineSince = Date.now();
      this.#retrySoon();
      if (this.#offlineStreak < 3 || Date.now() - this.#offlineSince < offlineGrace()) return;
    }
    this.syncStatus = 'error';
    // A retryable failure that wasn't the network (a few notes Drive would
    // not hand over) keeps its own words; network trouble gets ours.
    const own = (e as { name?: string } | null)?.name === 'RetryableError';
    this.syncError = transient && !own ? OFFLINE_MESSAGE : e instanceof Error ? e.message : String(e);
  }

  /** The connection is back: send what's owed and catch up, now. */
  backOnline() {
    this.#outbox.retryAll();
    void this.syncNow();
  }

  /** Try again soon after a dropped connection (3s, 8s, 15s, then every
   *  30s while it lasts), not on the slower heartbeat. */
  #retrySoon() {
    if (this.#retryTimer) return;
    const delays = [3_000, 8_000, 15_000, 30_000];
    const wait = delays[Math.min(this.#retryStep++, delays.length - 1)];
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.backOnline();
    }, wait);
  }

  /** Drive answered: the run of failures is over, and its message with it. */
  #recovered() {
    this.#offlineStreak = 0;
    this.#offlineSince = 0;
    this.#retryStep = 0;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    if (this.#settingsOwed) {
      this.#settingsOwed = false;
      void this.saveSettings({});
    }
    if (this.syncError === OFFLINE_MESSAGE && !this.#outbox.failedCount) {
      this.syncError = '';
      if (this.syncStatus === 'error') this.syncStatus = this.isCloud ? 'synced' : 'local';
    }
  }

  /** User-initiated recovery from a sync error: interactive sign-in (allowed,
   *  it's a real click) followed by a full re-init. */
  async reconnect() {
    this.syncStatus = 'loading';
    this.syncError = '';
    let driveRefused: unknown = null;
    try {
      if (isTauri()) {
        // Desktop tokens are managed by Rust — never the browser popup flow,
        // which simply fails inside the app window.
        const { desktopToken, desktopSignIn, desktopAuthConfigured } = await import('./drive/desktopAuth');
        // A dead refresh token can't be refreshed; Reconnect is a real click,
        // so it may open the system browser for a fresh sign-in. Declining
        // that (or being offline) falls back to local files below.
        await desktopToken().catch(async () => {
          if (desktopAuthConfigured()) {
            await desktopSignIn().catch((e) => {
              // Signed in without Drive: say so after the re-init below,
              // instead of quietly settling for local files.
              if (isDriveAccessError(e)) driveRefused = e;
            });
          }
        });
      } else if (this.#backend?.kind !== 'local') {
        // Local mode has no account to reconnect; re-init and retry is all
        // "Reconnect" can mean there.
        const { signIn } = await import('./drive/auth');
        await signIn(true);
      }
      this.#pollFailures = 0;
      this.#pollBackoffUntil = 0;
      await this.init();
      if (driveRefused) {
        this.#fail(driveRefused);
        return;
      }
      // The user asked, so retry everything that failed without waiting out
      // its backoff.
      this.#outbox.retryAll();
    } catch (e) {
      this.#fail(e);
    }
  }

  /**
   * First desktop sign-in: push notes that only exist as local files up to
   * Drive, so nothing disappears when the app switches backends (and so the
   * app — not Google Drive for Desktop — becomes their owner, which is what
   * makes them visible on other devices).
   */
  async migrateLocalToDrive(): Promise<number> {
    if (!isTauri()) return 0;
    const { FsBackend } = await import('./storage/fsBackend');
    const { DriveBackend } = await import('./drive/driveBackend');
    const local = await new FsBackend().listNotes();
    if (!local.length) return 0;
    const drive = new DriveBackend();
    const remote = new Set((await drive.listNotes()).map((n) => n.id));
    let moved = 0;
    for (const note of local) {
      if (remote.has(note.id)) continue;
      await drive.saveNote(note);
      moved += 1;
    }
    return moved;
  }

  // ---- writes ---------------------------------------------------------------

  /** Queue a note write. Resolves when the outbox has drained past it. */
  #save(note: Note): Promise<void> {
    // Mirror into this app's other windows straight away — they must not wait
    // on the cloud round-trip, or on their own poll, to show current state.
    void broadcastChange({ note });
    if (this.isCloud) this.syncStatus = 'saving';
    return this.#outbox.push({ kind: 'save', note });
  }

  /** The outbox's executor: the only place that calls the backend to write. */
  async #perform(op: OutboxOp) {
    // A write can be queued before init has picked a backend — the share
    // sheet lets the user act on the first paint. Wait rather than drop.
    if (!this.#backend) await this.#ready;
    if (!this.#backend) throw new Error('No storage available');
    if (op.kind === 'delete') return this.#backend.deleteNote(op.id);
    if (op.kind === 'append') return this.#performAppend(op);
    // A save that was queued before the note was deleted must not resurrect
    // it: this was the "deleted notes come back" bug in its original form.
    if (this.#isDeleted(op.note.id)) return;
    this.#cacheNotes(); // instant-start cache stays current even if Drive lags
    await this.#backend.saveNote(op.note);
  }

  /**
   * Fetch the note as storage has it NOW, add the text, write it back. Never
   * from the on-screen list: an op restored on a fresh launch runs before the
   * list has loaded, and the screen copy can be stale on any launch.
   */
  async #performAppend(op: Extract<OutboxOp, { kind: 'append' }>) {
    if (!this.#backend || this.#isDeleted(op.id)) return;
    const fresh = this.#backend.getNote
      ? await this.#backend.getNote(op.id)
      : ((await this.#backend.listNotes()).find((n) => n.id === op.id) ?? null);
    if (!fresh) return; // deleted elsewhere meanwhile: nothing to append to
    const next: Note = {
      ...$state.snapshot(fresh),
      contentHtml: (fresh.contentHtml || '') + op.html,
      pinned: fresh.pinned || op.pin,
      updatedAt: Date.now(),
    };
    if (op.pin && !fresh.pinned) next.tilt = rollTilt();
    await this.#backend.saveNote(next);
    // Show the result and tell the other windows; a pin arriving this way
    // needs its sticky opened, same as one that arrived from another device.
    const idx = this.notes.findIndex((n) => n.id === op.id);
    if (idx !== -1) this.notes[idx] = next;
    this.#cacheNotes();
    void broadcastChange({ note: next });
    if (op.pin && !fresh.pinned) void openSticky(next);
  }

  /**
   * Append text to a note without waiting for anything: the share sheet's
   * "…or append to" path. Queued like any write, so it lands when the
   * network does and survives the page closing.
   */
  appendTo(id: string, html: string, pin = false): Promise<void> {
    if (this.isCloud) this.syncStatus = 'saving';
    // Optimistic paint so the note reads right immediately; the queued op
    // re-derives from fresh content when it runs.
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx !== -1) {
      const n = this.notes[idx];
      this.notes[idx] = { ...n, contentHtml: (n.contentHtml || '') + html, pinned: n.pinned || pin };
    }
    return this.#outbox.push({ kind: 'append', id, html, pin });
  }

  #settled(ok: boolean, e?: unknown) {
    if (!ok) return this.#fail(e, true);
    this.#recovered();
    // One success doesn't clear the error while other writes are still failed;
    // a fully drained queue does.
    if (!this.#outbox.busy && this.#outbox.failedCount === 0 && this.isCloud) {
      this.syncStatus = 'synced';
    }
  }

  create(): Note {
    const note = newNote({
      paletteId: this.settings.defaultPaletteId,
      fontSize: this.settings.defaultFontSize,
    });
    this.notes = [note, ...this.notes];
    this.activeId = note.id;
    this.#persistNote(note, /* immediate */ true);
    return note;
  }

  /**
   * A note born pinned: the + on a sticky's title bar. Written before its
   * window is created, like any pin, and opened beside the sticky that asked.
   */
  async createPinned(near?: { x: number; y: number }): Promise<Note> {
    const note = newNote({
      paletteId: this.settings.defaultPaletteId,
      fontSize: this.settings.defaultFontSize,
      pinned: true,
      tilt: rollTilt(),
    });
    this.notes = [note, ...this.notes];
    const saved = this.#save(note);
    // Cloud: the write's first step puts the note in this device's cache,
    // synchronously, and a sticky paints from that cache as it boots — so the
    // window can open now instead of after the upload round-trip (the "delay
    // when adding" from a sticky). Local files have no cache: wait there.
    if (!this.isCloud) await saved;
    await openSticky(note, near);
    return note;
  }

  /** Patch a note in place and schedule a debounced save. */
  update(id: string, patch: Partial<Note>) {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    // Each pin gets its own lean, so putting a note back up looks like
    // putting a note back up.
    if (patch.pinned && !this.notes[idx].pinned) patch = { ...patch, tilt: rollTilt() };
    // Unpinned is untucked: pinning it again brings the sticky up in full.
    if ('pinned' in patch && !patch.pinned && this.notes[idx].tucked) patch = { ...patch, tucked: false };
    const updated = { ...this.notes[idx], ...patch, updatedAt: Date.now() };
    this.notes[idx] = updated;
    // Pin/unpin spawns or closes the desktop sticky window (no-op on web and
    // Android: the window calls in desktop.ts return early off the desktop).
    if (!('pinned' in patch)) return this.#persistNote(updated);
    void (patch.pinned ? this.#pin(updated) : this.#unpin(updated));
  }

  /**
   * A sticky window loads its own copy of the note from storage as it boots,
   * so the note has to be written BEFORE the window is created. Under the
   * usual debounced save the write is still pending when the sticky reads,
   * and it opens showing the previous state — most visibly the old lean,
   * which then snaps to the new one whenever its first sync lands.
   */
  async #pin(note: Note) {
    this.#cancelDebounce(note.id);
    await this.#save($state.snapshot(note));
    await openSticky(note);
  }

  /**
   * The mirror image: the sticky calls this from inside the window being
   * closed, and closing it destroys the webview mid-request. Write first, so
   * the server doesn't keep `pinned: true` and bring the sticky back on the
   * next launch.
   */
  async #unpin(note: Note) {
    this.#cancelDebounce(note.id);
    // Off the screen immediately; the window is destroyed only once the
    // write has landed (closing it mid-request would abort the request).
    void hideSticky(note.id);
    await this.#save($state.snapshot(note));
    await closeSticky(note.id);
  }

  #cancelDebounce(id: string) {
    const t = this.#timers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      this.#timers.delete(id);
    }
  }

  /** Mirror an edit made in another window of this app (desktop only). */
  listenForChanges() {
    void onRemoteChange((change) => {
      if (change.settings) this.settings = { ...this.settings, ...change.settings };
      const n = change.note;
      if (!n) return;
      // Same rule as the sync merge: never let an incoming copy clobber edits
      // this window hasn't written yet.
      if (this.#pending(n.id)) return;
      const idx = this.notes.findIndex((x) => x.id === n.id);
      // A note this window has never seen (created from a sticky's + button)
      // joins the list now rather than on the next poll.
      if (idx === -1) {
        if (!this.#isDeleted(n.id)) this.notes = [n, ...this.notes];
        return;
      }
      if (n.updatedAt < this.notes[idx].updatedAt) return;
      this.notes[idx] = n;
    });
  }

  /** Commit a drag-and-drop rearrangement (one settings write, not N). */
  async reorder(ids: string[]) {
    const byId = new Map(this.notes.map((n) => [n.id, n]));
    this.notes = ids.map((id) => byId.get(id)).filter((n): n is Note => !!n);
    await this.saveSettings({ noteOrder: ids });
  }

  /** Drive folder and settings file ids, when syncing through Drive (Android widgets). */
  driveIds(): { notesFolderId: string | null; settingsId: string | null } | null {
    return this.#backend?.driveIds?.() ?? null;
  }

  /** Set or clear (null) a note's reminder. */
  setReminder(id: string, at: number | null) {
    this.update(id, { remindAt: at ?? undefined });
  }

  /**
   * PC app: reminders that have come due pin their note as a sticky, once.
   * Clearing remindAt in the same write is what makes it once, on every
   * device. Only the desktop acts; phones notify but leave the note alone,
   * so a phone that fires first can't steal the pin from the PC.
   */
  fireDueReminders(now = Date.now()) {
    for (const n of this.notes) {
      if (!n.remindAt || n.remindAt > now || n.archived) continue;
      this.update(n.id, n.pinned ? { remindAt: undefined } : { pinned: true, remindAt: undefined });
    }
  }

  /**
   * Archive or restore a note. An archived note leaves the list, the widgets
   * and the share targets but stays searchable; a pinned one comes down off
   * the desktop first. The selection moves on to the next note in view.
   */
  setArchived(id: string, on: boolean) {
    const note = this.notes.find((n) => n.id === id);
    if (!note) return;
    const patch: Partial<Note> = { archived: on };
    if (on && note.pinned) patch.pinned = false;
    // What Undo puts back: visible again, and on the desktop if it was.
    this.undoArchive = on ? { id, label: noteLabel(note), pinned: !!note.pinned } : null;
    this.update(id, patch);
    if (on && this.activeId === id) {
      this.activeId = this.notes.find((n) => !n.archived && n.id !== id)?.id ?? null;
      this.mobileOpen = false;
    }
  }

  /** The note just archived, while its Undo is on offer (UndoToast). */
  undoArchive = $state<{ id: string; label: string; pinned: boolean } | null>(null);

  /** Undo the last archive: back in the list, selected, re-pinned if it was. */
  restoreArchived() {
    const offer = this.undoArchive;
    this.undoArchive = null;
    if (!offer || !this.notes.some((n) => n.id === offer.id)) return;
    this.update(offer.id, offer.pinned ? { archived: false, pinned: true } : { archived: false });
    this.activeId = offer.id;
  }

  async remove(id: string) {
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.activeId === id) {
      this.activeId = this.notes[0]?.id ?? null;
      this.mobileOpen = false; // drop out of fullscreen after deleting on phones
    }
    // The debounce timer MUST die here. Left alive, it fired 400ms later,
    // found the note gone from the list, and wrote its captured copy back.
    this.#cancelDebounce(id);
    void closeSticky(id); // a deleted note must not leave a sticky behind
    this.#cacheNotes();
    // The queued delete is the tombstone until it lands; the in-memory one
    // covers the backend's propagation lag afterwards.
    await this.#outbox.push({ kind: 'delete', id });
    this.#deleted.set(id, Date.now());
  }

  async saveSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    this.#cacheNotes();
    void broadcastChange({ settings: $state.snapshot(this.settings) });
    try {
      await this.#backend?.saveSettings(this.settings);
    } catch (e) {
      // Dropped by the network: kept here, sent again once Drive answers.
      if (isTransient(e)) this.#settingsOwed = true;
      this.#fail(e, isTransient(e));
    }
  }

  /**
   * Move every debounced edit into the outbox right now (page hide, window
   * close). The outbox mirrors itself to localStorage synchronously on push,
   * so even if the page dies before the request completes, the write runs on
   * the next launch.
   */
  flush() {
    for (const id of [...this.#timers.keys()]) this.#flushOne(id);
  }

  #flushOne(id: string) {
    this.#cancelDebounce(id);
    const n = this.notes.find((x) => x.id === id);
    if (n) void this.#save($state.snapshot(n));
  }

  #persistNote(note: Note, immediate = false) {
    this.#cancelDebounce(note.id);
    if (immediate) return this.#flushOne(note.id);
    this.#timers.set(
      note.id,
      setTimeout(() => this.#flushOne(note.id), 400)
    );
  }

  // ---- reads ----------------------------------------------------------------

  /**
   * Settings changes that must reach accounts which already saved the old
   * value, once each. Runs only after a successful load, so an offline start
   * can never write defaults over the real settings. v1 (0.22): list above
   * the note with automatic columns, and sticky tilt off. v2 (0.27): new
   * notes start at text size 22 instead of 18, unless someone chose
   * another size themselves.
   */
  #migrateSettings() {
    const v = this.settings.settingsVersion ?? 0;
    if (v >= 3) return;
    const patch: Partial<Settings> = { settingsVersion: 3 };
    if (v < 1) Object.assign(patch, { layout: 'top', listColumns: 'auto', stickyTilt: false });
    if (v < 2 && this.settings.defaultFontSize === BASE_FONT_PX) patch.defaultFontSize = DEFAULT_NOTE_PX;
    // v3: saved colours share the five custom slots with patterns. They
    // move into the free slots in order; notes keep their custom:<hex>.
    const colours = this.settings.customColors ?? [];
    if (colours.length) {
      const slots = Array.from({ length: 5 }, (_, i) => this.settings.customPatterns?.[i] ?? null);
      for (const hex of colours) {
        const free = slots.indexOf(null);
        if (free < 0) break;
        slots[free] = { px: '0'.repeat(64), tint: hex, bg: hex, solid: true };
      }
      patch.customPatterns = slots;
      patch.customColors = [];
    }
    void this.saveSettings(patch);
  }

  /** Manual "sync now" — bypasses the focus throttle and any backoff. */
  async syncNow() {
    this.#lastReload = 0;
    this.#pollBackoffUntil = 0;
    await this.reload();
  }

  /**
   * Background sync: pick up changes made on other devices (or in sticky
   * windows) without the user touching anything. Skipped while edits are
   * pending, so it never fights the typist.
   */
  startAutoSync(intervalMs: number) {
    if (this.#autoTimer) clearInterval(this.#autoTimer);
    this.#autoTimer = setInterval(() => {
      // A background browser tab — or the Android app behind another app —
      // has no business polling Drive. A desktop sticky is the opposite case:
      // it sits on the user's screen showing a note, and it is never the
      // focused window, so gating it on visibility is how it ends up
      // displaying stale content indefinitely.
      if (!isDesktop() && document.visibilityState !== 'visible') return;
      // Failed writes get their retry here, on the app's heartbeat.
      this.#outbox.retryDue();
      // Never refresh over work that hasn't landed yet: debounced edits or
      // uploads still in flight (this is what made a fresh note flicker away
      // and stole editor focus). Failed-and-waiting writes don't block a
      // refresh — offline for an hour must not also mean blind for an hour.
      if (this.#timers.size || this.#outbox.busy) return;
      if (Date.now() < this.#pollBackoffUntil) return;
      this.#lastReload = 0;
      void this.reload();
    }, intervalMs);
  }

  /** Re-read notes from the backend (e.g. after a sticky window edited a file). */
  async reload() {
    if (!this.#backend || this.#reloading) return;
    // Focus events fire in bursts (main <-> sticky windows trade focus);
    // reloading on each is churn the app doesn't need.
    if (Date.now() - this.#lastReload < 3000) return;
    this.#lastReload = Date.now();
    this.#reloading = true;
    try {
      await this.#doReload();
      this.#pollFailures = 0;
      this.#recovered();
    } catch (e) {
      // Back off doubling from 30s to 5min: a rate limit that is polled
      // through every 6s never clears.
      this.#pollFailures += 1;
      const wait = Math.min(30_000 * 2 ** (this.#pollFailures - 1), 300_000);
      this.#pollBackoffUntil = Date.now() + wait;
      this.#fail(e, true);
    } finally {
      this.#reloading = false;
    }
  }

  /**
   * Merge a fetched list into what's on screen rather than replacing it. A
   * note created/edited moments ago may not be on the server yet (upload in
   * flight, or another device hasn't seen it): blindly taking the server list
   * made new notes flicker away and reverted fresh pin toggles. Local wins
   * while it is newer or still unlanded; deleted ids never come back.
   */
  #merge(fetched: Note[]): Note[] {
    const merged = new Map(
      dedupeById(fetched.filter((n) => !this.#isDeleted(n.id))).map((n) => [n.id, n])
    );
    const FRESH_MS = 20_000;
    // Writes the outbox still owes count as local copies too — otherwise a
    // save restored from a previous page load stays invisible until it lands
    // AND the next poll comes round.
    const owed = this.#outbox.pendingNotes().filter((n) => !this.notes.some((l) => l.id === n.id));
    for (const local of [...this.notes, ...owed]) {
      const remote = merged.get(local.id);
      const unlanded = this.#pending(local.id);
      const recent = Date.now() - local.updatedAt < FRESH_MS;
      if (!remote) {
        if (unlanded || recent) merged.set(local.id, $state.snapshot(local));
      } else if (unlanded || local.updatedAt > remote.updatedAt) {
        merged.set(local.id, $state.snapshot(local));
      }
    }
    // A manual arrangement wins; otherwise newest first. Never "where it was
    // on screen": that depended on what happened to be painted at the time,
    // so a reconnect or a cold start could show a different order.
    return [...merged.values()].sort(orderedBy(this.settings.noteOrder ?? []));
  }

  async #doReload() {
    if (!this.#backend) return;
    // Debounced edits enter the outbox before we fetch, so the merge sees them
    // as unlanded and keeps them. (They used to be written straight to the
    // backend here, outside the queue: no retry, and the first failure
    // abandoned every edit after it.)
    this.flush();
    const prevPinned = new Set(this.notes.filter((n) => n.pinned).map((n) => n.id));
    const prevStamp = new Map(this.notes.map((n) => [n.id, n.updatedAt]));
    const prevIds = new Set(this.notes.map((n) => n.id));
    for (const [id, at] of this.#deleted) {
      if (Date.now() - at > AppStore.#TOMBSTONE_MS) this.#deleted.delete(id);
    }
    const notes = this.#merge(await this.#backend.listNotes());

    // Skip the update when nothing actually changed — reassigning the array
    // remounts the editor and steals focus mid-typing.
    const sig = (list: Note[]) => list.map((n) => `${n.id}:${n.updatedAt}:${n.pinned}`).join('|');
    if (sig(notes) !== sig(this.notes)) {
      this.notes = notes;
      if (this.activeId && !this.notes.some((n) => n.id === this.activeId)) {
        this.activeId = this.notes[0]?.id ?? null;
      }
      this.#cacheNotes();
      // Hand what we just learned to this app's other windows. Whichever
      // window notices a remote edit first updates the rest, so an open
      // sticky no longer depends on its own poll coming round.
      for (const n of this.notes) {
        if (prevStamp.get(n.id) !== n.updatedAt) void broadcastChange({ note: $state.snapshot(n) });
      }
      // Desktop: honor pin changes that arrived from other devices — a note
      // pinned on the phone becomes a sticky here on the next refresh. (The
      // phone itself has no windows; its pins are for the PC to pick up.)
      if (isDesktop()) {
        const liveIds = new Set(this.notes.map((n) => n.id));
        for (const n of this.notes) {
          if (n.pinned && !prevPinned.has(n.id)) void openSticky(n);
          if (!n.pinned && prevPinned.has(n.id)) void closeSticky(n.id);
        }
        // A note deleted elsewhere disappears from the list entirely, so its
        // sticky window has to be closed here too.
        for (const id of prevIds) if (!liveIds.has(id)) void closeSticky(id);
      }
    }
    // A successful poll with nothing unlanded means we're in sync — the error
    // badge used to stick until the next successful WRITE, however many polls
    // succeeded in between.
    if (this.isCloud && !this.#outbox.busy && this.#outbox.failedCount === 0) {
      this.syncStatus = 'synced';
    }
  }
}

export const store = new AppStore();

/** The theme app.html's early script set from the cache ('' when none). */
function earlyTheme(): 'light' | 'dark' {
  try {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The web sign-in's account email (auth.ts remembers it), if known yet. */
function webAccount(): string | null {
  try {
    return localStorage.getItem('notezzz:acct');
  } catch {
    return null;
  }
}

/**
 * The network failing (a timeout, no connection, a dropped request) rather
 * than Google refusing something. Worth retrying quietly: a phone waking up
 * often sends its first request before its connection is back.
 */
function isTransient(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const name = (e as { name?: string } | null)?.name ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    name === 'NetworkError' ||
    name === 'RetryableError' ||
    /timed out|failed to fetch|network ?error|load failed|connection/i.test(msg)
  );
}
