// Google Drive backend for the web build. Stores one JSON file per note inside
// a single app-created folder (FOLDER_NAME), plus settings.json — the same
// file layout the desktop app writes to the local Drive folder, so the two
// sides converge through Google Drive.

import type { Note, Settings } from '../types';
import type { StorageBackend } from '../storage/backend';
import { FOLDER_NAME } from '../googleConfig';
import { getValidToken, markTokenStale, signIn } from './auth';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getValidToken();
  const withAuth = (t: string): RequestInit => ({
    ...opts,
    headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${t}` },
  });
  let res = await fetch(url, withAuth(token));
  if (res.status === 401) {
    // Server says the token is dead (revoked / Testing-mode expiry) even if
    // its local timestamp looked fine. Drop it and retry ONCE silently.
    // Never fall back to an interactive popup here — background code has no
    // user gesture, the browser blocks the popup, and everything hangs.
    // If silent fails we throw; the UI offers a Reconnect button instead.
    markTokenStale();
    const t2 = await signIn(false);
    res = await fetch(url, withAuth(t2));
  }
  if (!res.ok) {
    throw new Error(`Drive API ${res.status}: ${await res.text().catch(() => '')}`);
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

  /**
   * Notes live in a `notes/` subfolder — the exact layout the desktop app uses
   * for its sync folder, so Google Drive for Desktop can mirror one tree that
   * both sides read/write. (settings.json stays at the NotezZz root.)
   */
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

  async #create(name: string, folderId: string, content: unknown): Promise<string> {
    const metadata = { name, parents: [folderId], mimeType: 'application/json' };
    const boundary = 'notezzzBoundary1337';
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
      JSON.stringify(content) +
      `\r\n--${boundary}--`;
    const res = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await res.json()).id;
  }

  async #update(fileId: string, content: unknown): Promise<void> {
    await authFetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    });
  }

  async listNotes(): Promise<Note[]> {
    const folderId = await this.#notesFolder();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await authFetch(`${API}/files?q=${q}&fields=files(id,name)&pageSize=1000`);
    const { files } = await res.json();
    this.#ids.clear();
    const noteFiles = (files ?? []).filter((f: { id: string; name: string }) =>
      String(f.name).endsWith('.json')
    );
    // Download all note files concurrently — sequential fetches make startup
    // painfully slow once there are more than a handful of notes.
    const notes = (
      await Promise.all(
        noteFiles.map(async (f: { id: string; name: string }) => {
          try {
            const c = await authFetch(`${API}/files/${f.id}?alt=media`);
            const note = (await c.json()) as Note;
            if (note?.id) this.#ids.set(note.id, f.id);
            return note && !note.deleted ? note : null;
          } catch {
            return null; // one corrupt/unreadable file must not sink the list
          }
        })
      )
    ).filter((n: Note | null): n is Note => n !== null);
    return notes.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveNote(note: Note): Promise<void> {
    const folderId = await this.#notesFolder();
    let fileId = this.#ids.get(note.id) ?? (await this.#findByName(`${note.id}.json`, folderId));
    if (fileId) await this.#update(fileId, note);
    else fileId = await this.#create(`${note.id}.json`, folderId, note);
    this.#ids.set(note.id, fileId);
  }

  async deleteNote(id: string): Promise<void> {
    const folderId = await this.#notesFolder();
    const fileId = this.#ids.get(id) ?? (await this.#findByName(`${id}.json`, folderId));
    if (fileId) await authFetch(`${API}/files/${fileId}`, { method: 'DELETE' });
    this.#ids.delete(id);
  }

  async loadSettings(): Promise<Settings | null> {
    const folderId = await this.#folder();
    const id = this.#settingsId ?? (await this.#findByName('settings.json', folderId));
    if (!id) return null;
    this.#settingsId = id;
    const res = await authFetch(`${API}/files/${id}?alt=media`);
    return (await res.json()) as Settings;
  }

  async saveSettings(settings: Settings): Promise<void> {
    const folderId = await this.#folder();
    if (this.#settingsId) await this.#update(this.#settingsId, settings);
    else this.#settingsId = await this.#create('settings.json', folderId, settings);
  }
}
