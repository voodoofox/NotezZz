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

/** One device's connection: while `offline`, its requests fail as they do
 *  with no network, and an answer already on its way never arrives. */
export type Line = { offline: boolean };

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
  /** A wait before a download is answered: its content is read when it is
   *  asked for (as Drive does), and arrives after, as over a slow line. */
  holdDownload: ((f: DriveFile) => Promise<void> | undefined) | null = null;
  /** A wait before each request is read and again before its answer leaves,
   *  as over a slow line: what several devices send then crosses. */
  lag: (() => Promise<void>) | null = null;
  /** How many requests changed something (uploads, deletes, folders made). */
  writes = 0;
  /** The requests this picks are lost, as on a line that drops one request
   *  and carries the next. */
  drop: ((method: string, url: URL) => boolean) | null = null;
  /** The requests answered with an error, in order. */
  refused: string[] = [];
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

  /** Delete a note outright, as another device's delete does: its file
   *  answers "not found" from then on. */
  removeNote(id: string) {
    const f = [...this.files.values()].find((x) => x.name === `${id}.json`)!;
    this.files.delete(f.id);
    this.#record(f, true);
  }

  /** Change the stored settings, as another device's save does. */
  changeSettings(change: (s: Record<string, unknown>) => Record<string, unknown>) {
    const f = [...this.files.values()].find((x) => x.name === 'settings.json')!;
    f.body = JSON.stringify(change(JSON.parse(f.body)));
    f.modifiedTime = this.#tick();
    this.#record(f);
  }

  noteBody(id: string): Record<string, unknown> | null {
    const f = [...this.files.values()].find((x) => x.name === `${id}.json` && !x.trashed);
    return f ? JSON.parse(f.body) : null;
  }

  async install(page: Page, line?: Line) {
    await page.route('**://www.googleapis.com/**', async (r) => {
      try {
        if (line?.offline) return await r.abort('internetdisconnected');
        const req = r.request();
        if (this.drop?.(req.method(), new URL(req.url()))) return await r.abort('internetdisconnected');
        await this.lag?.();
        if (line?.offline) return await r.abort('internetdisconnected');
        await this.#handle(r, line);
      } catch {
        /* the page went away (a reload, the test's end) with the request out */
      }
    });
  }

  async #handle(r: Route, line?: Line) {
    const req = r.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname;
    if (method !== 'GET') this.writes += 1;
    const send = async (answer: Parameters<Route['fulfill']>[0]) => {
      await this.lag?.();
      // Done, and the device never hears of it: it tries again later.
      if (line?.offline) return r.abort('internetdisconnected');
      return r.fulfill(answer);
    };
    const json = (body: unknown, status = 200) => {
      if (status >= 400) this.refused.push(`${status} ${method} ${path}${url.search}`);
      return send({ status, contentType: 'application/json', body: JSON.stringify(body) });
    };

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
        return send({ status: 204, body: '' });
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
        const body = f.body;
        await this.holdDownload?.(f);
        return send({ status: 200, contentType: 'application/json', body });
      }
      this.calls.push('meta');
      const { body: _b, ...meta } = f;
      return json(meta);
    }
    this.calls.push(`${method} ${path}`);
    return json({ error: { code: 404, message: `fake Drive: no ${method} ${path}` } }, 404);
  }
}

/** Open the app as a signed-in Drive user whose token stays good, with
 *  Google Identity Services stubbed so nothing leaves the test. (The token's
 *  end is a fixed date, not "an hour from now": asking the time here, before
 *  Playwright's clock has heard of every jump the test made, set the clock
 *  of a reloaded page wrong, further ahead at each reload.) */
export async function openWithDrive(page: Page, drive: FakeDrive, line?: Line) {
  await page.addInitScript(() => {
    localStorage.setItem('notezzz:hasAuthed', '1');
    localStorage.setItem('notezzz:tok', JSON.stringify({ t: 'test-token', e: 4_102_444_800_000 }));
    localStorage.setItem('notezzz:acct', 'me@example.com');
    (window as unknown as { google: unknown }).google = {
      accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken: () => {} }) } },
    };
  });
  await drive.install(page, line);
  await page.goto('/');
}
