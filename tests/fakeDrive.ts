// A stand-in for the Google Drive API, answering the web app's calls from
// memory: folders, note files, uploads, and the changes feed with its page
// tokens. A test puts files in from the outside, as another device would,
// and reads back which calls the app made.
import type { Page, Route } from '@playwright/test';

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  modifiedTime: string;
  body: string;
  trashed: boolean;
};

type Change = { fileId: string; removed: boolean; file?: Omit<DriveFile, 'body'> };

export class FakeDrive {
  files = new Map<string, DriveFile>();
  /** Every change ever, oldest first; a page token is an index into it. */
  changes: Change[] = [];
  /** Calls the app made, in order: 'list' (the folder), 'find' (one file by
   *  name), 'changes', 'download', 'upload', 'about', or the raw path. */
  calls: string[] = [];
  /** When set, every page token is refused as Drive refuses one too old. */
  expireTokens = false;
  /** Files the folder listing and the search by name leave out, as Drive's
   *  search index does for a while after a file is made (a fetch by id and
   *  the changes feed still know them). */
  unlisted = new Set<string>();
  notesFolder: string;
  #n = 0;
  #clock = Date.UTC(2026, 10, 4, 12, 0, 0);

  constructor() {
    const root = this.#add('NotezZz', 'application/vnd.google-apps.folder', [], '');
    this.notesFolder = this.#add('notes', 'application/vnd.google-apps.folder', [root.id], '').id;
  }

  #tick(): string {
    this.#clock += 1000;
    return new Date(this.#clock).toISOString();
  }

  #add(name: string, mimeType: string, parents: string[], body: string): DriveFile {
    const f: DriveFile = { id: `f${++this.#n}`, name, mimeType, parents, modifiedTime: this.#tick(), body, trashed: false };
    this.files.set(f.id, f);
    this.#record(f);
    return f;
  }

  #record(f: DriveFile, removed = false) {
    const { body: _b, ...meta } = f;
    this.changes.push({ fileId: f.id, removed, file: removed ? undefined : meta });
  }

  /** Write a note the way another device does: a new file, or the old one
   *  with a new modified time. */
  putNote(note: Record<string, unknown>): DriveFile {
    const name = `${note.id}.json`;
    const body = JSON.stringify(note);
    const have = [...this.files.values()].find((f) => f.name === name && f.parents.includes(this.notesFolder) && !f.trashed);
    if (!have) return this.#add(name, 'application/json', [this.notesFolder], body);
    have.body = body;
    have.modifiedTime = this.#tick();
    this.#record(have);
    return have;
  }

  /** Put a note in the bin, as the Drive web UI or another device would. */
  trashNote(id: string) {
    const f = [...this.files.values()].find((x) => x.name === `${id}.json` && !x.trashed)!;
    f.trashed = true;
    f.modifiedTime = this.#tick();
    this.#record(f);
  }

  noteBody(id: string): Record<string, unknown> | null {
    const f = [...this.files.values()].find((x) => x.name === `${id}.json` && !x.trashed);
    return f ? JSON.parse(f.body) : null;
  }

  async install(page: Page) {
    await page.route('**://www.googleapis.com/**', (r) => this.#handle(r));
  }

  async #handle(r: Route) {
    const req = r.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname;
    const json = (body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/drive/v3/about') {
      this.calls.push('about');
      return json({ user: { emailAddress: 'me@example.com' } });
    }
    if (path === '/drive/v3/changes/startPageToken') {
      this.calls.push('startPageToken');
      return json({ startPageToken: String(this.changes.length + 1) });
    }
    if (path === '/drive/v3/changes') {
      this.calls.push('changes');
      const token = Number(url.searchParams.get('pageToken'));
      if (this.expireTokens || !Number.isInteger(token) || token < 1) {
        return json({ error: { code: 404, message: 'Invalid Change ID' } }, 404);
      }
      return json({
        changes: this.changes.slice(token - 1),
        newStartPageToken: String(this.changes.length + 1),
      });
    }
    if (path === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const name = /name='([^']+)'/.exec(q)?.[1];
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const mime = /mimeType='([^']+)'/.exec(q)?.[1];
      this.calls.push(name ? 'find' : parent === this.notesFolder ? 'list' : 'query');
      const files = [...this.files.values()].filter(
        (f) =>
          !f.trashed &&
          !this.unlisted.has(f.id) &&
          (!name || f.name === name) &&
          (!parent || f.parents.includes(parent)) &&
          (!mime || f.mimeType === mime)
      );
      return json({ files: files.map(({ body: _b, ...meta }) => meta) });
    }
    if (path === '/drive/v3/files' && method === 'POST') {
      this.calls.push('mkdir');
      const meta = JSON.parse(req.postData() ?? '{}');
      const f = this.#add(meta.name, meta.mimeType, meta.parents ?? [], '');
      return json({ id: f.id });
    }
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      this.calls.push('upload');
      const boundary = /boundary=(\S+)/.exec(req.headers()['content-type'] ?? '')?.[1] ?? '';
      const parts = (req.postData() ?? '').split(`--${boundary}`).map((p) => p.split('\r\n\r\n')[1]?.trimEnd() ?? '');
      const meta = JSON.parse(parts[1]);
      const f = this.#add(meta.name, meta.mimeType ?? 'application/json', meta.parents ?? [], parts[2]);
      return json({ id: f.id, modifiedTime: f.modifiedTime });
    }
    const one = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(path);
    if (one) {
      const f = this.files.get(one[1]);
      if (!f) return json({ error: { code: 404, message: 'File not found' } }, 404);
      if (method === 'DELETE') {
        this.calls.push('delete');
        this.files.delete(f.id);
        this.#record(f, true);
        return r.fulfill({ status: 204, body: '' });
      }
      if (method === 'PATCH' && path.startsWith('/upload/')) {
        this.calls.push('upload');
        f.body = req.postData() ?? '';
        f.modifiedTime = this.#tick();
        this.#record(f);
        return json({ modifiedTime: f.modifiedTime });
      }
      if (method === 'PATCH') {
        this.calls.push('move');
        const add = url.searchParams.get('addParents');
        const remove = url.searchParams.get('removeParents');
        f.parents = [...f.parents.filter((p) => p !== remove), ...(add ? [add] : [])];
        this.#record(f);
        return json({ id: f.id });
      }
      if (url.searchParams.get('alt') === 'media') {
        this.calls.push('download');
        return r.fulfill({ status: 200, contentType: 'application/json', body: f.body });
      }
      this.calls.push('meta');
      const { body: _b, ...meta } = f;
      return json(meta);
    }
    this.calls.push(`${method} ${path}`);
    return json({ error: { code: 404, message: `fake Drive: no ${method} ${path}` } }, 404);
  }
}

/** Open the app as a signed-in Drive user whose token is good for an hour,
 *  with Google Identity Services stubbed so nothing leaves the test. */
export async function openWithDrive(page: Page, drive: FakeDrive) {
  await page.addInitScript(() => {
    localStorage.setItem('notezzz:hasAuthed', '1');
    localStorage.setItem('notezzz:tok', JSON.stringify({ t: 'test-token', e: Date.now() + 3_600_000 }));
    localStorage.setItem('notezzz:acct', 'me@example.com');
    (window as unknown as { google: unknown }).google = {
      accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken: () => {} }) } },
    };
  });
  await drive.install(page);
  await page.goto('/');
}
