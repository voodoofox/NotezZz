// Central app store (Svelte 5 runes). Holds notes + settings in reactive state
// and persists changes through whichever StorageBackend is active. Saves are
// debounced per note so fast typing doesn't hammer the disk / Drive.

import { DEFAULT_SETTINGS, newNote, type Note, type Settings } from './types';
import type { StorageBackend } from './storage/backend';
import { isTauri } from './storage/backend';
import { LocalBackend } from './storage/localBackend';
import { openSticky, closeSticky } from './desktop';

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
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #reloading = false;
  #inflight = 0;
  #lastReload = 0;
  #autoTimer: ReturnType<typeof setInterval> | undefined;
  /** Ids with a save currently in flight — must survive a refresh. */
  #saving = new Set<string>();

  active = $derived(this.notes.find((n) => n.id === this.activeId) ?? null);

  get isCloud(): boolean {
    return this.#backend?.kind === 'drive';
  }

  async init() {
    this.#backend = await pickBackend();
    const cloud = this.#backend.kind === 'drive';
    this.syncStatus = cloud ? 'loading' : 'local';
    // Cloud mode: paint cached notes + settings instantly; the Drive refresh
    // replaces them when it lands. Kills the startup loading screen and the
    // late theme/palette flip.
    if (cloud && !this.notes.length) {
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
        /* corrupt cache — network load will rebuild it */
      }
    }
    try {
      // Watchdog: whatever goes wrong below, "Loading…" may never be forever —
      // surface an error (with its Reconnect button) instead.
      const load = Promise.all([this.#backend.listNotes(), this.#backend.loadSettings()]);
      const watchdog = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('Loading timed out — check your connection and retry.')), 45_000)
      );
      const [notes, settings] = await Promise.race([load, watchdog]);
      this.notes = dedupeById(notes);
      if (settings) this.settings = settings;
      if (!this.activeId && this.notes.length) this.activeId = this.notes[0].id;
      this.syncStatus = cloud ? 'synced' : 'local';
      this.#cacheNotes();
    } catch (e) {
      this.#fail(e);
    }
    this.loaded = true;
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
      } else {
        const { signIn } = await import('./drive/auth');
        await signIn(true);
      }
      await this.init();
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

  /** Save through the backend, tracking cloud sync status. */
  async #save(note: Note) {
    if (!this.#backend) return;
    if (this.#backend.kind !== 'drive') return void this.#backend.saveNote(note);
    this.#cacheNotes(); // instant-start cache stays current even if Drive lags
    this.#inflight += 1;
    this.#saving.add(note.id);
    this.syncStatus = 'saving';
    try {
      await this.#backend.saveNote(note);
      if (--this.#inflight === 0) this.syncStatus = 'synced';
    } catch (e) {
      this.#inflight = Math.max(0, this.#inflight - 1);
      this.#fail(e);
    } finally {
      this.#saving.delete(note.id);
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
    const updated = { ...this.notes[idx], ...patch, updatedAt: Date.now() };
    this.notes[idx] = updated;
    this.#persistNote(updated);
    // Pin/unpin spawns or closes the desktop sticky window (no-op on web).
    if ('pinned' in patch) {
      void (patch.pinned ? openSticky(updated) : closeSticky(updated.id));
    }
  }

  /** Manual "sync now" — bypasses the focus throttle. */
  async syncNow() {
    this.#lastReload = 0;
    await this.reload();
  }

  /**
   * Background sync: pick up changes made on other devices (or in sticky
   * windows) without the user touching anything. Skipped while edits are
   * pending or the window is hidden, so it never fights the typist.
   */
  startAutoSync(intervalMs: number) {
    if (this.#autoTimer) clearInterval(this.#autoTimer);
    this.#autoTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      // Never refresh over work that hasn't landed yet: debounced edits or
      // uploads still in flight (this is what made a fresh note flicker away
      // and stole editor focus).
      if (this.#timers.size || this.#saving.size) return;
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
    } catch (e) {
      this.#fail(e);
    } finally {
      this.#reloading = false;
    }
  }

  async #doReload() {
    if (!this.#backend) return;
    // Flush pending debounced writes to disk first so we don't lose fresh edits.
    const pendingIds = [...this.#timers.keys()];
    for (const [, t] of this.#timers) clearTimeout(t);
    this.#timers.clear();
    for (const id of pendingIds) {
      const n = this.notes.find((x) => x.id === id);
      if (n) await this.#backend.saveNote($state.snapshot(n));
    }
    const prevPinned = new Set(this.notes.filter((n) => n.pinned).map((n) => n.id));
    const fetched = await this.#backend.listNotes();

    // Merge rather than replace. A note created/edited moments ago may not be
    // on the server yet (upload in flight, or another device hasn't seen it):
    // blindly taking the server list made new notes flicker away and reverted
    // fresh pin toggles. Local wins while it is newer or still uploading.
    const merged = new Map(fetched.map((n) => [n.id, n]));
    const FRESH_MS = 20_000;
    for (const local of this.notes) {
      const remote = merged.get(local.id);
      const stillLanding = this.#saving.has(local.id) || this.#timers.has(local.id);
      const recent = Date.now() - local.updatedAt < FRESH_MS;
      if (!remote) {
        if (stillLanding || recent) merged.set(local.id, $state.snapshot(local));
      } else if (local.updatedAt > remote.updatedAt) {
        merged.set(local.id, $state.snapshot(local));
      }
    }
    const notes = dedupeById([...merged.values()]);

    // Skip the update when nothing actually changed — reassigning the array
    // remounts the editor and steals focus mid-typing.
    const sig = (list: Note[]) => list.map((n) => `${n.id}:${n.updatedAt}`).join('|');
    if (sig(notes) === sig(this.notes)) return;

    this.notes = notes;
    if (this.activeId && !this.notes.some((n) => n.id === this.activeId)) {
      this.activeId = this.notes[0]?.id ?? null;
    }
    this.#cacheNotes();
    // Desktop: honor pin changes that arrived from other devices — a note
    // pinned on the phone becomes a sticky here on the next refresh.
    if (isTauri()) {
      for (const n of this.notes) {
        if (n.pinned && !prevPinned.has(n.id)) void openSticky(n);
        if (!n.pinned && prevPinned.has(n.id)) void closeSticky(n.id);
      }
    }
  }

  async remove(id: string) {
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.activeId === id) {
      this.activeId = this.notes[0]?.id ?? null;
      this.mobileOpen = false; // drop out of fullscreen after deleting on phones
    }
    this.#timers.delete(id);
    this.#cacheNotes();
    try {
      await this.#backend?.deleteNote(id);
    } catch (e) {
      this.#fail(e);
    }
  }

  async saveSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    this.#cacheNotes();
    try {
      await this.#backend?.saveSettings(this.settings);
    } catch (e) {
      this.#fail(e);
    }
  }

  /** Immediately write all pending debounced edits (call before page unload). */
  flush() {
    for (const [id, t] of this.#timers) {
      clearTimeout(t);
      const n = this.notes.find((x) => x.id === id);
      if (n) void this.#save($state.snapshot(n));
    }
    this.#timers.clear();
  }

  #persistNote(note: Note, immediate = false) {
    const flush = () => {
      this.#timers.delete(note.id);
      void this.#save($state.snapshot(this.notes.find((n) => n.id === note.id) ?? note));
    };
    const existing = this.#timers.get(note.id);
    if (existing) clearTimeout(existing);
    if (immediate) return flush();
    this.#timers.set(note.id, setTimeout(flush, 400));
  }
}

export const store = new AppStore();
