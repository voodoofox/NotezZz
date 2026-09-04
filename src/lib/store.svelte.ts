// Central app store (Svelte 5 runes). Holds notes + settings in reactive state
// and persists changes through whichever StorageBackend is active.
//
// Writes go through the Outbox (./outbox.ts): one in flight per note, retried
// on failure, mirrored to localStorage. Every merge in this file asks the
// outbox whether a note's latest local change has landed, and keeps the local
// copy while it hasn't. Typing is debounced 400ms BEFORE it reaches the
// outbox — that debounce is a keystroke coalescer, not part of durability,
// which is why flush() exists for page-hide.

import { DEFAULT_SETTINGS, newNote, rollTilt, type Note, type Settings } from './types';
import { welcomeNotes } from './welcome';
import { Outbox, type OutboxOp } from './outbox';
import type { StorageBackend } from './storage/backend';
import { isTauri } from './storage/backend';
import { LocalBackend } from './storage/localBackend';
import { openSticky, closeSticky, broadcastChange, onRemoteChange } from './desktop';

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
function orderedBy(anchor: string[]): (a: Note, b: Note) => number {
  const pos = new Map(anchor.map((id, i) => [id, i]));
  return (a, b) => {
    const ai = pos.get(a.id);
    const bi = pos.get(b.id);
    if (ai === undefined && bi === undefined) return b.updatedAt - a.updatedAt;
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
/** Marks that this launch already retried itself — never reload twice. */
const REBOOT_KEY = 'notezzz:reboot';

class AppStore {
  notes = $state<Note[]>([]);
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  activeId = $state<string | null>(null);
  loaded = $state(false);

  // Sync status for the UI. 'local' = this-browser/device only (no cloud);
  // 'loading'/'saving'/'synced' = Drive; 'error' = last op failed.
  syncStatus = $state<'local' | 'loading' | 'saving' | 'synced' | 'error'>('local');
  syncError = $state<string>('');

  /** Phone layout: true while the note is expanded fullscreen (over the 40/60 split). */
  mobileOpen = $state(false);

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
      this.#fail(e);
      this.loaded = true;
      this.#markReady();
      return;
    }
    this.#clearReboot();
    const cloud = this.#backend.kind === 'drive';
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
      if (settings) this.settings = settings; // order lives here, so read it first
      this.notes = this.#merge(notes);
      if (!this.activeId && this.notes.length) this.activeId = this.notes[0].id;
      if (!this.#outbox.busy) this.syncStatus = cloud ? 'synced' : 'local';
      this.#cacheNotes();
    } catch (e) {
      this.#fail(e);
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

  /** Show the last known notes and settings from this device's cache. */
  #paintCache() {
    if (this.notes.length) return;
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]') as Note[];
      if (cached.length) {
        this.notes = dedupeById(cached);
        if (!this.activeId) this.activeId = this.notes[0]?.id ?? null;
        this.loaded = true;
      }
      const cachedSettings = localStorage.getItem(SETTINGS_CACHE_KEY);
      if (cachedSettings) this.settings = { ...this.settings, ...JSON.parse(cachedSettings) };
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
      localStorage.setItem(CACHE_KEY, JSON.stringify($state.snapshot(this.notes)));
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify($state.snapshot(this.settings)));
    } catch {
      /* quota — cache is best-effort */
    }
  }

  #fail(e: unknown) {
    this.syncStatus = 'error';
    this.syncError = e instanceof Error ? e.message : String(e);
    console.error('[NotezZz sync]', e);
  }

  /** User-initiated recovery from a sync error: interactive sign-in (allowed,
   *  it's a real click) followed by a full re-init. */
  async reconnect() {
    this.syncStatus = 'loading';
    this.syncError = '';
    try {
      if (isTauri()) {
        // Desktop tokens are managed by Rust — never the browser popup flow,
        // which simply fails inside the app window.
        const { desktopToken } = await import('./drive/desktopAuth');
        await desktopToken().catch(() => {}); // signed out -> local files
      } else if (this.#backend?.kind !== 'local') {
        // Local mode has no account to reconnect; re-init and retry is all
        // "Reconnect" can mean there.
        const { signIn } = await import('./drive/auth');
        await signIn(true);
      }
      this.#pollFailures = 0;
      this.#pollBackoffUntil = 0;
      await this.init();
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
    if (!ok) return this.#fail(e);
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

  /** Patch a note in place and schedule a debounced save. */
  update(id: string, patch: Partial<Note>) {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    // Each pin gets its own lean, so putting a note back up looks like
    // putting a note back up.
    if (patch.pinned && !this.notes[idx].pinned) patch = { ...patch, tilt: rollTilt() };
    const updated = { ...this.notes[idx], ...patch, updatedAt: Date.now() };
    this.notes[idx] = updated;
    // Pin/unpin spawns or closes the desktop sticky window (no-op on web).
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
      if (idx === -1 || n.updatedAt < this.notes[idx].updatedAt) return;
      this.notes[idx] = n;
    });
  }

  /** Commit a drag-and-drop rearrangement (one settings write, not N). */
  async reorder(ids: string[]) {
    const byId = new Map(this.notes.map((n) => [n.id, n]));
    this.notes = ids.map((id) => byId.get(id)).filter((n): n is Note => !!n);
    await this.saveSettings({ noteOrder: ids });
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
      this.#fail(e);
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
      // A background browser tab has no business polling Drive. A desktop
      // sticky is the opposite case: it sits on the user's screen showing a
      // note, and it is never the focused window, so gating it on visibility
      // is how it ends up displaying stale content indefinitely.
      if (!isTauri() && document.visibilityState !== 'visible') return;
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
    } catch (e) {
      // Back off doubling from 30s to 5min: a rate limit that is polled
      // through every 6s never clears.
      this.#pollFailures += 1;
      const wait = Math.min(30_000 * 2 ** (this.#pollFailures - 1), 300_000);
      this.#pollBackoffUntil = Date.now() + wait;
      this.#fail(e);
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
    // A manual arrangement wins; otherwise notes hold their current position.
    const anchor = this.settings.noteOrder?.length
      ? this.settings.noteOrder
      : this.notes.map((n) => n.id);
    return [...merged.values()].sort(orderedBy(anchor));
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
      // pinned on the phone becomes a sticky here on the next refresh.
      if (isTauri()) {
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
