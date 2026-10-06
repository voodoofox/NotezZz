// Google Drive backend for the web build. Stores one JSON file per note inside
// a single app-created folder (FOLDER_NAME), plus settings.json — the same
// file layout the desktop app writes to the local Drive folder, so the two
// sides converge through Google Drive.

import type { Note, Settings } from '../types';
import type { StorageBackend } from '../storage/backend';
import { FOLDER_ID_KEY, FOLDER_NAME } from '../googleConfig';
import { forgetGrant, getValidToken, markTokenStale, signIn } from './auth';
import { isTauri } from '../storage/backend';
import { desktopDropGrant, desktopToken, desktopTokenFresh } from './desktopAuth';
import { DriveAccessError, isScopeRejection } from './driveAccess';

/** Token source: Rust-managed on desktop, GIS in the browser. */
async function token(): Promise<string> {
  return isTauri() ? desktopToken() : getValidToken();
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Long enough for a note carrying voice memos and photos (megabytes) to
 *  arrive over mobile data: the limit covers the whole body, not just the
 *  first byte, and at 20s such notes failed on every try. */
const BIG = 120_000;

async function authFetch(url: string, opts: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  const tok = await token();
  const withAuth = (t: string): RequestInit => ({
    ...opts,
    headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${t}` },
    // A wedged mobile connection must become an error, not an eternal hang.
    signal: AbortSignal.timeout(timeoutMs),
  });
  let res = await fetch(url, withAuth(tok));
  if (res.status === 401) {
    // Server says the token is dead (revoked / Testing-mode expiry) even if
    // its local timestamp looked fine. Drop it and retry ONCE silently.
    // Never fall back to an interactive popup here — background code has no
    // user gesture, the browser blocks the popup, and everything hangs.
    // If silent fails we throw; the UI offers a Reconnect button instead.
    if (isTauri()) {
      res = await fetch(url, withAuth(await desktopTokenFresh()));
    } else {
      markTokenStale();
      const t2 = await signIn(false);
      res = await fetch(url, withAuth(t2));
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // A sign-in Google granted without Drive. Retrying can't help; drop it,
    // so Reconnect asks Google again, and say what's wrong in plain words.
    if (isScopeRejection(res.status, body)) {
      if (isTauri()) await desktopDropGrant();
      else forgetGrant();
      throw new DriveAccessError();
    }
    // Quota errors get a plain label: the store backs its polling off on any
    // failure, but a human reading the banner should see "rate limited", not
    // a JSON blob.
    if (res.status === 429 || (res.status === 403 && /rate|quota/i.test(body))) {
      throw new Error(`Drive rate limit (${res.status}) — syncing will slow down and retry`);
    }
    throw new Error(`Drive API ${res.status}: ${body}`);
  }
  return res;
}

export class DriveBackend implements StorageBackend {
  readonly kind = 'drive' as const;

  #folderId: string | null = null;
  #folderPromise: Promise<string> | null = null;
  #notesFolderId: string | null = null;
  #notesFolderPromise: Promise<string> | null = null;
  #settingsId: string | null = null;
  #ids = new Map<string, string>(); // noteId -> Drive fileId

  // Memoize folder resolution so concurrent callers (listNotes + loadSettings
  // run in parallel at startup) can't each create a duplicate NotezZz folder.
  async #folder(): Promise<string> {
    if (this.#folderId) return this.#folderId;
    if (!this.#folderPromise) this.#folderPromise = this.#resolveFolder();
    this.#folderId = await this.#folderPromise;
    return this.#folderId;
  }

  async #resolveFolder(): Promise<string> {
    // A folder adopted through the Google Picker wins: it grants access to
    // files the app didn't create (i.e. notes written by the desktop app).
    // If it has since been deleted or unshared, forget it and fall back
    // rather than failing every sync forever.
    // Forget the adoption ONLY when Drive says the folder is gone (404 or
    // trashed). It used to be dropped on any non-OK response — an expired
    // token, a 500, a rate limit — after which the name search picked a
    // different folder and every note appeared to vanish until re-adopted.
    let adopted: string | null = null;
    try {
      adopted = localStorage.getItem(FOLDER_ID_KEY);
    } catch {
      /* private mode */
    }
    if (adopted) {
      try {
        const check = await authFetch(`${API}/files/${adopted}?fields=id,trashed`);
        if (!(await check.json()).trashed) return adopted;
        this.#forgetAdopted();
      } catch (e) {
        if (/Drive API 404/.test(String(e))) this.#forgetAdopted();
        else throw e; // transient: keep the adoption, let the caller retry
      }
    }
    const q = encodeURIComponent(
      `mimeType='${FOLDER_MIME}' and name='${FOLDER_NAME}' and trashed=false`
    );
    const res = await authFetch(`${API}/files?q=${q}&fields=files(id,name)&orderBy=createdTime`);
    const { files } = await res.json();
    if (files?.length) return files[0].id; // oldest existing folder wins
    const cres = await authFetch(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    return (await cres.json()).id;
  }

  #forgetAdopted() {
    try {
      localStorage.removeItem(FOLDER_ID_KEY);
      localStorage.removeItem(FOLDER_ID_KEY + ':name');
    } catch {
      /* private mode */
    }
  }

  /**
   * Notes live in a `notes/` subfolder — the exact layout the desktop app uses
   * for its sync folder, so Google Drive for Desktop can mirror one tree that
   * both sides read/write. (settings.json stays at the NotezZz root.)
   */
  driveIds() {
    return { notesFolderId: this.#notesFolderId, settingsId: this.#settingsId };
  }

  async #notesFolder(): Promise<string> {
    if (this.#notesFolderId) return this.#notesFolderId;
    if (!this.#notesFolderPromise) this.#notesFolderPromise = this.#resolveNotesFolder();
    this.#notesFolderId = await this.#notesFolderPromise;
    return this.#notesFolderId;
  }

  async #resolveNotesFolder(): Promise<string> {
    const parent = await this.#folder();
    const q = encodeURIComponent(
      `'${parent}' in parents and mimeType='${FOLDER_MIME}' and name='notes' and trashed=false`
    );
    const res = await authFetch(`${API}/files?q=${q}&fields=files(id)&orderBy=createdTime`);
    const { files } = await res.json();
    let id: string;
    if (files?.length) {
      id = files[0].id;
    } else {
      const cres = await authFetch(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'notes', mimeType: FOLDER_MIME, parents: [parent] }),
      });
      id = (await cres.json()).id;
    }
    await this.#migrateFlatNotes(parent, id);
    return id;
  }

  /** One-time move of legacy flat note files (NotezZz/*.json) into notes/. */
  async #migrateFlatNotes(parent: string, notesFolder: string): Promise<void> {
    try {
      const q = encodeURIComponent(`'${parent}' in parents and trashed=false`);
      const res = await authFetch(`${API}/files?q=${q}&fields=files(id,name,mimeType)`);
      const { files } = await res.json();
      const strays = (files ?? []).filter(
        (f: { name: string; mimeType: string }) =>
          f.mimeType !== FOLDER_MIME && f.name.endsWith('.json') && f.name !== 'settings.json'
      );
      for (const f of strays) {
        await authFetch(
          `${API}/files/${f.id}?addParents=${notesFolder}&removeParents=${parent}&fields=id`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }
        );
      }
    } catch {
      // migration is best-effort; notes stay readable where they are next run
    }
  }

  async #findByName(name: string, folderId: string): Promise<string | null> {
    const q = encodeURIComponent(`'${folderId}' in parents and name='${name}' and trashed=false`);
    const res = await authFetch(`${API}/files?q=${q}&fields=files(id)`);
    const { files } = await res.json();
    return files?.[0]?.id ?? null;
  }

  async #create(
    name: string,
    folderId: string,
    content: unknown
  ): Promise<{ id: string; modifiedTime: string }> {
    const metadata = { name, parents: [folderId], mimeType: 'application/json' };
    const boundary = 'notezzzBoundary1337';
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
      JSON.stringify(content) +
      `\r\n--${boundary}--`;
    const res = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }, BIG);
    return (await res.json()) as { id: string; modifiedTime: string };
  }

  async #update(fileId: string, content: unknown): Promise<string> {
    const res = await authFetch(`${UPLOAD}/files/${fileId}?uploadType=media&fields=modifiedTime`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    }, BIG);
    return ((await res.json()) as { modifiedTime: string }).modifiedTime;
  }

  /**
   * Per-file cache keyed by Drive fileId. A poll lists the folder (one call)
   * and downloads only files whose modifiedTime changed. Before this, every
   * poll — every 6s, from every window — re-downloaded every note in full,
   * base64 images and voice memos included: about a megabyte per poll per
   * window on a sixteen-note account.
   */
  #files = new Map<string, { modifiedTime: string; note: Note }>();

  async listNotes(): Promise<Note[]> {
    const folderId = await this.#notesFolder();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    type Meta = { id: string; name: string; modifiedTime: string };
    const listed: Meta[] = [];
    let pageToken: string | undefined;
    do {
      const page = pageToken ? `&pageToken=${pageToken}` : '';
      const res = await authFetch(
        `${API}/files?q=${q}&fields=nextPageToken,files(id,name,modifiedTime)&pageSize=1000${page}`
      );
      const body = (await res.json()) as { files?: Meta[]; nextPageToken?: string };
      listed.push(...(body.files ?? []).filter((f) => String(f.name).endsWith('.json')));
      pageToken = body.nextPageToken;
    } while (pageToken);

    // Forget files that are no longer there, then fetch what changed.
    const liveIds = new Set(listed.map((f) => f.id));
    for (const id of this.#files.keys()) if (!liveIds.has(id)) this.#files.delete(id);

    const changed = listed.filter((f) => this.#files.get(f.id)?.modifiedTime !== f.modifiedTime);
    // A few at a time: all at once split a phone's bandwidth until the big
    // ones couldn't finish.
    const results: Array<'ok' | 'failed' | 'failed-net' | 'corrupt'> = [];
    for (let i = 0; i < changed.length; i += 3) {
      results.push(...(await Promise.all(changed.slice(i, i + 3).map((f) => this.#download(f)))));
    }
    const failed = results.filter((r) => r === 'failed' || r === 'failed-net').length;
    // A file that couldn't be downloaded is NOT a file that was deleted. If we
    // returned the partial list, the store would drop the note, close its
    // sticky, and wipe it from the cache until the next successful poll.
    // Retryable either way (the store retries quietly before saying so);
    // all-network failures say so, in the store's words.
    if (failed) {
      const err = new Error(`Couldn't download ${failed} note(s) — will retry`);
      err.name = results.every((r) => r !== 'failed') ? 'NetworkError' : 'RetryableError';
      throw err;
    }

    // Dedupe by note id — a save racing the folder migration can leave
    // "name.json" + "name (1).json" both holding the same note. Duplicate ids
    // crash Svelte's keyed list, so keep the newest and delete the strays.
    const byId = new Map<string, { note: Note; fileId: string }>();
    const stale: string[] = [];
    for (const [fileId, { note }] of this.#files) {
      const prev = byId.get(note.id);
      if (!prev) byId.set(note.id, { note, fileId });
      else if (note.updatedAt > prev.note.updatedAt) {
        stale.push(prev.fileId);
        byId.set(note.id, { note, fileId });
      } else stale.push(fileId);
    }
    if (stale.length) {
      for (const id of stale) this.#files.delete(id);
      void Promise.allSettled(
        stale.map((id) => authFetch(`${API}/files/${id}`, { method: 'DELETE' }))
      );
    }

    const notes: Note[] = [];
    for (const { note, fileId } of byId.values()) {
      this.#ids.set(note.id, fileId);
      if (!note.deleted) notes.push(note);
    }
    return notes.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Fetch one file into the cache. Retries once; a corrupt file is skipped. */
  async #download(f: { id: string; modifiedTime: string }): Promise<'ok' | 'failed' | 'failed-net' | 'corrupt'> {
    let net = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await authFetch(`${API}/files/${f.id}?alt=media`, {}, BIG);
        const text = await res.text();
        let note: Note | null = null;
        try {
          note = JSON.parse(text) as Note;
        } catch {
          console.warn('[NotezZz] skipping unreadable note file', f.id);
          this.#files.delete(f.id);
          return 'corrupt';
        }
        if (!note?.id) return 'corrupt';
        this.#files.set(f.id, { modifiedTime: f.modifiedTime, note });
        return 'ok';
      } catch (e) {
        // A timeout or a dropped connection, or something Drive refused?
        const name = (e as { name?: string } | null)?.name ?? '';
        net = net && (name === 'TimeoutError' || name === 'AbortError' || e instanceof TypeError);
        /* try once more */
      }
    }
    return net ? 'failed-net' : 'failed';
  }

  async getNote(id: string): Promise<Note | null> {
    const folderId = await this.#notesFolder();
    const fileId = this.#ids.get(id) ?? (await this.#findByName(`${id}.json`, folderId));
    if (!fileId) return null;
    const res = await authFetch(`${API}/files/${fileId}?alt=media`, {}, BIG);
    const note = (await res.json()) as Note;
    this.#ids.set(id, fileId);
    return note?.id ? note : null;
  }

  /**
   * Before a write: one small request for the file's modified time. Unchanged
   * since this device last read or wrote it means we already hold everything
   * in it; otherwise it is downloaded to merge with (a note with images can
   * be megabytes, so only then).
   */
  async storedCopy(id: string): Promise<Note | null | 'seen'> {
    const folderId = await this.#notesFolder();
    const fileId = this.#ids.get(id) ?? (await this.#findByName(`${id}.json`, folderId));
    if (!fileId) return null;
    this.#ids.set(id, fileId);
    const res = await authFetch(`${API}/files/${fileId}?fields=modifiedTime`);
    const { modifiedTime } = (await res.json()) as { modifiedTime: string };
    if (modifiedTime && this.#files.get(fileId)?.modifiedTime === modifiedTime) return 'seen';
    const got = await this.#download({ id: fileId, modifiedTime });
    if (got === 'corrupt') return null; // unreadable: ours replaces it
    if (got !== 'ok') {
      const err = new Error(`Couldn't read note ${id} before saving it — will retry`);
      err.name = got === 'failed-net' ? 'NetworkError' : 'RetryableError';
      throw err;
    }
    return this.#files.get(fileId)?.note ?? null;
  }

  async saveNote(note: Note): Promise<void> {
    const folderId = await this.#notesFolder();
    let fileId = this.#ids.get(note.id) ?? (await this.#findByName(`${note.id}.json`, folderId));
    let modifiedTime: string;
    if (fileId) modifiedTime = await this.#update(fileId, note);
    else ({ id: fileId, modifiedTime } = await this.#create(`${note.id}.json`, folderId, note));
    this.#ids.set(note.id, fileId);
    // Our own write must not look like a remote change on the next poll.
    this.#files.set(fileId, { modifiedTime, note });
  }

  async deleteNote(id: string): Promise<void> {
    const folderId = await this.#notesFolder();
    const fileId = this.#ids.get(id) ?? (await this.#findByName(`${id}.json`, folderId));
    if (fileId) {
      await authFetch(`${API}/files/${fileId}`, { method: 'DELETE' });
      this.#files.delete(fileId);
    }
    this.#ids.delete(id);
  }

  /** settings.json's modified time when this device last read or wrote it. */
  #settingsSeen: string | null = null;

  async loadSettings(): Promise<Settings | null> {
    const folderId = await this.#folder();
    const id = this.#settingsId ?? (await this.#findByName('settings.json', folderId));
    if (!id) return null;
    this.#settingsId = id;
    const meta = await authFetch(`${API}/files/${id}?fields=modifiedTime`);
    const { modifiedTime } = (await meta.json()) as { modifiedTime?: string };
    const res = await authFetch(`${API}/files/${id}?alt=media`, {}, BIG);
    const settings = (await res.json()) as Settings;
    this.#settingsSeen = modifiedTime ?? null;
    return settings;
  }

  /** One small request; the file itself only when someone else wrote it. */
  async storedSettings(): Promise<Settings | null | 'seen'> {
    const folderId = await this.#folder();
    const id = this.#settingsId ?? (await this.#findByName('settings.json', folderId));
    if (!id) return null;
    this.#settingsId = id;
    const meta = await authFetch(`${API}/files/${id}?fields=modifiedTime`);
    const { modifiedTime } = (await meta.json()) as { modifiedTime?: string };
    if (modifiedTime && modifiedTime === this.#settingsSeen) return 'seen';
    return this.loadSettings();
  }

  async saveSettings(settings: Settings): Promise<void> {
    const folderId = await this.#folder();
    if (this.#settingsId) this.#settingsSeen = await this.#update(this.#settingsId, settings);
    else {
      const made = await this.#create('settings.json', folderId, settings);
      this.#settingsId = made.id;
      this.#settingsSeen = made.modifiedTime;
    }
  }
}
