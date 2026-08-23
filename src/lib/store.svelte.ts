// Central app store (Svelte 5 runes). Holds notes + settings in reactive state
// and persists changes through whichever StorageBackend is active. Saves are
// debounced per note so fast typing doesn't hammer the disk / Drive.

import { DEFAULT_SETTINGS, newNote, type Note, type Settings } from './types';
import type { StorageBackend } from './storage/backend';
import { isTauri } from './storage/backend';
import { LocalBackend } from './storage/localBackend';
import { openSticky, closeSticky } from './desktop';

async function pickBackend(): Promise<StorageBackend> {
  // Desktop: local sync-folder files. Web: Google Drive once signed in,
  // otherwise localStorage (offline/not-yet-authed).
  if (isTauri()) {
    const { FsBackend } = await import('./storage/fsBackend');
    return new FsBackend();
  }
  const { isDriveAuthed } = await import('./drive/auth');
  if (isDriveAuthed()) {
    const { DriveBackend } = await import('./drive/driveBackend');
    return new DriveBackend();
  }
  return new LocalBackend();
}

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

  active = $derived(this.notes.find((n) => n.id === this.activeId) ?? null);

  get isCloud(): boolean {
    return this.#backend?.kind === 'drive';
  }

  async init() {
    this.#backend = await pickBackend();
    const cloud = this.#backend.kind === 'drive';
    this.syncStatus = cloud ? 'loading' : 'local';
    try {
      // Watchdog: whatever goes wrong below, "Loading…" may never be forever —
      // surface an error (with its Reconnect button) instead.
      const load = Promise.all([this.#backend.listNotes(), this.#backend.loadSettings()]);
      const watchdog = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('Loading timed out — check your connection and retry.')), 45_000)
      );
      const [notes, settings] = await Promise.race([load, watchdog]);
      this.notes = notes.sort((a, b) => b.updatedAt - a.updatedAt);
      if (settings) this.settings = settings;
      if (!this.activeId && this.notes.length) this.activeId = this.notes[0].id;
      this.syncStatus = cloud ? 'synced' : 'local';
    } catch (e) {
      this.#fail(e);
    }
    this.loaded = true;
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
      const { signIn } = await import('./drive/auth');
      await signIn(true);
      await this.init();
    } catch (e) {
      this.#fail(e);
    }
  }

  /** Save through the backend, tracking cloud sync status. */
  async #save(note: Note) {
    if (!this.#backend) return;
    if (this.#backend.kind !== 'drive') return void this.#backend.saveNote(note);
    this.#inflight += 1;
    this.syncStatus = 'saving';
    try {
      await this.#backend.saveNote(note);
      if (--this.#inflight === 0) this.syncStatus = 'synced';
    } catch (e) {
      this.#inflight = Math.max(0, this.#inflight - 1);
      this.#fail(e);
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

  /** Re-read notes from the backend (e.g. after a sticky window edited a file). */
  async reload() {
    if (!this.#backend || this.#reloading) return;
    this.#reloading = true;
    try {
      await this.#doReload();
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
    const notes = await this.#backend.listNotes();
    this.notes = notes.sort((a, b) => b.updatedAt - a.updatedAt);
    if (this.activeId && !this.notes.some((n) => n.id === this.activeId)) {
      this.activeId = this.notes[0]?.id ?? null;
    }
  }

  async remove(id: string) {
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.activeId === id) {
      this.activeId = this.notes[0]?.id ?? null;
      this.mobileOpen = false; // drop out of fullscreen after deleting on phones
    }
    this.#timers.delete(id);
    try {
      await this.#backend?.deleteNote(id);
    } catch (e) {
      this.#fail(e);
    }
  }

  async saveSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
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
