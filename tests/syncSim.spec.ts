import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { FakeDrive, openWithDrive, type Line } from './fakeDrive';

// Several devices on one account doing random things at once: new notes,
// edits, colours, archiving, folders, moves, reorders, deletes, restarts,
// spells with no connection, long waits, over a Drive that answers late so
// what they send crosses. Then everything is let through, and the devices
// and Drive must hold the same notes and settings, with nothing a device
// did lost: every field of every note as its last change left it, every
// folder made and not deleted still there, deleted things gone.
//
// Each sync bug found by hand so far had this shape: one piece of code took
// a copy for the whole truth while something else was changing. A test
// written for one such moment covers that moment; this one goes looking.
//
//   SIM_SEEDS=200 npx playwright test syncSim --workers=6     a long soak
//   SIM_FIRST=37 SIM_SEEDS=1 npx playwright test syncSim      one run again
//
// (The same seed takes the same steps, but not the same timing: a failure
// usually comes back within a few tries rather than every time.)

const SEEDS = Number(process.env.SIM_SEEDS ?? 3);
const FIRST = Number(process.env.SIM_FIRST ?? 1);
const STEPS = Number(process.env.SIM_STEPS ?? 60);

test.describe.configure({ mode: 'parallel' });

type Device = { name: string; ctx: BrowserContext; page: Page; line: Line; loads: number };

/** What one step did on its device: read back from the stamps it left, so
 *  it is what the app took the step to mean (filing an archived note also
 *  brings it back; deleting a folder also empties it). */
type Did = {
  /** The latest moment stamped (or the device's clock, if later). */
  t: number;
  what: string;
  stamped: [id: string, field: string, value: unknown][];
  made: string[];
  removed: string[];
  folders: { id: string; name: string; gone: boolean }[];
  order: string[] | null;
};

type Json = Record<string, unknown>;
type View = { name: string; notes: Map<string, Json>; settings: Json; list?: string[] };

/** What should be true at the end. */
class Model {
  notes = new Map<string, { fields: Json; gone: boolean; sure: boolean; touched: Map<string, number> }>();
  folders = new Map<string, { name: string; gone: boolean }>();
  order: string[] | null = null;
  /** How many times the devices have been brought into step. */
  round = 0;

  know(id: string) {
    if (!this.notes.has(id)) this.notes.set(id, { fields: {}, gone: false, sure: true, touched: new Map() });
    return this.notes.get(id)!;
  }

  take(dev: string, did: Did) {
    for (const id of did.made) this.know(id);
    for (const [id, field, value] of did.stamped) {
      const n = this.know(id);
      n.fields[field] = value;
      n.touched.set(dev, this.round);
      // Changed on a device that hasn't heard of the delete: the note may
      // come back with the change (it is then on every device, or none).
      if (n.gone) n.sure = false;
    }
    for (const id of did.removed) {
      const n = this.know(id);
      n.gone = true;
      // Deleted for certain only if no other device has a change to it that
      // the deleting one might not have seen.
      n.sure = ![...n.touched].some(([d, round]) => d !== dev && round === this.round);
    }
    for (const f of did.folders) this.folders.set(f.id, { name: f.name, gone: f.gone });
    if (did.order) this.order = did.order;
  }
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Equal things as equal text, whatever order their keys came in. */
function canon(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const o = v as Json;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(',')}}`;
}

/** A note as it compares: what it says. When each field was set is left
 *  out: two devices that set the same thing at different moments hold the
 *  same note, and neither has anything to send the other. */
function plain(n: Json): Json {
  const { fieldAt: _at, updatedAt: _t, ...says } = n;
  return says;
}

const seedNote = (id: string, title: string) => ({
  id,
  title,
  contentHtml: `<p>${title}</p>`,
  paletteId: 'paper',
  fontSize: 18,
  pinned: false,
  opacity: 1,
  win: null,
  createdAt: 1,
  updatedAt: 1,
});

type Hooks = { __nzStore?: { loaded: boolean; unsettled: string[] } };

async function boot(browser: Browser, drive: FakeDrive, name: string): Promise<Device> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // A clock the test can move on: the app's long waits (a note missing from
  // Drive is kept for 20 s, a delete remembered for two minutes, a failed
  // write tried again after up to two) pass in a moment.
  await page.clock.install({ time: new Date() });
  const line: Line = { offline: false };
  await openWithDrive(page, drive, line);
  const d = { name, ctx, page, line, loads: 0 };
  page.on('load', () => (d.loads += 1));
  await up(d);
  return d;
}

/** The app is showing notes (from the device's own copy, or the load). */
async function up(d: Device) {
  await expect
    .poll(() => d.page.evaluate(() => !!(window as unknown as Hooks).__nzStore?.loaded).catch(() => false), {
      timeout: 30_000,
      intervals: [25, 50, 100],
    })
    .toBe(true);
}

/** The app has chosen its storage: the first thing a launch does, with 20
 *  seconds to do it in before it gives up and loads itself again (once; the
 *  second time it waits for Reconnect). The clock is not moved on under
 *  that. */
async function chosen(d: Device) {
  await expect
    .poll(
      () =>
        d.page
          .evaluate(() => {
            const s = (window as unknown as Hooks).__nzStore;
            return !!s?.loaded && !s.unsettled.includes('choosing storage');
          })
          .catch(() => false),
      { timeout: 30_000, intervals: [25, 50, 100] }
    )
    .toBe(true);
}

/**
 * Wait until nothing is on its way to Drive or back. Returns what is still
 * owed and waiting for its next try (a write that failed, settings the
 * network dropped): nothing, when the device is at rest.
 */
async function rest(d: Device): Promise<string> {
  let left = '';
  await expect
    .poll(
      async () => {
        const all = await d.page
          .evaluate(() => (window as unknown as Hooks).__nzStore?.unsettled ?? ['no app'])
          .catch(() => ['no page']);
        left = all.filter((u) => u === 'failed writes' || u === 'settings owed').join(', ');
        return all.filter((u) => u !== 'failed writes' && u !== 'settings owed').join(', ');
      },
      { timeout: 30_000, intervals: [15, 30, 60], message: `${d.name} never came to rest` }
    )
    .toBe('');
  return left;
}

/** One step. It waits for its device's clock to pass the last change made
 *  anywhere, which takes a moment; a step that takes much longer says what
 *  the clocks read instead of running the whole test out. */
async function act(d: Device, kind: string, r: number[], k: number, lastT: number): Promise<Did> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stuck = new Promise<never>((_, rej) => {
    timer = setTimeout(async () => {
      const now = await d.page.evaluate(() => Date.now()).catch(() => NaN);
      rej(new Error(`step ${k} (${d.name} ${kind}) never finished: its clock reads ${now}, the last change was made at ${lastT}`));
    }, 20_000);
  });
  try {
    return await Promise.race([actInPage(d, kind, r, k, lastT), stuck]);
  } finally {
    clearTimeout(timer);
  }
}

/** One step, in the page. */
async function actInPage(d: Device, kind: string, r: number[], k: number, lastT: number): Promise<Did> {
  await up(d);
  return d.page.evaluate(
    async ({ kind, r, tag, lastT }) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const s = (window as any).__nzStore;
      // After every change made so far, by this device's clock: the later
      // change must be the one that stays, and a tie has no later.
      while (Date.now() <= lastT + 2) await new Promise((res) => setTimeout(res, 1));
      const pick = <T,>(list: T[], x: number): T | undefined => list[Math.floor(x * list.length)];
      const before = new Map<string, Record<string, number>>(s.notes.map((n: any) => [n.id, { ...(n.fieldAt ?? {}) }]));
      const foldersBefore = new Map<string, number>((s.settings.folders ?? []).map((f: any) => [f.id, f.at ?? 0]));
      const orderBefore = s.settings.settingsAt?.noteOrder ?? 0;
      const folders: any[] = s.folders;
      const note: any = pick([...s.notes], r[0]);
      let what = kind;
      if (kind === 'new') {
        const f = r[1] < 0.3 ? pick(folders, r[2]) : undefined;
        const n = s.create(f?.id ?? null);
        s.update(n.id, { title: `T ${tag}` });
        what = `new ${n.id}${f ? ` in ${f.id}` : ''}`;
      } else if (kind === 'folder') {
        what = `folder ${s.createFolder(`F ${tag}`)?.id}`;
      } else if (kind === 'rename' || kind === 'unfolder') {
        const f = pick(folders, r[1]);
        if (f && kind === 'rename') s.renameFolder(f.id, `F ${tag}`);
        if (f && kind === 'unfolder') s.deleteFolder(f.id);
        what = `${kind} ${f?.id ?? '(none)'}`;
      } else if (kind === 'sync') {
        void s.syncNow();
      } else if (kind === 'reorder') {
        const ids: string[] = s.notes.map((n: any) => n.id);
        let x = Math.floor(r[1] * 2 ** 31) || 1;
        for (let i = ids.length - 1; i > 0; i--) {
          x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
          const j = x % (i + 1);
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        void s.reorder(ids);
      } else if (note) {
        what = `${kind} ${note.id}`;
        if (kind === 'title') s.update(note.id, { title: `T ${tag}` });
        if (kind === 'body') s.update(note.id, { contentHtml: `<p>B ${tag}</p>` });
        if (kind === 'colour') s.update(note.id, { paletteId: pick(['paper', 'coral', 'lime', 'teal', 'sky', 'rose'], r[1]) });
        if (kind === 'archive') s.setArchived(note.id, !note.archived);
        if (kind === 'open') s.activeId = note.id;
        if (kind === 'delete') void s.remove(note.id);
        if (kind === 'move') {
          const f = r[1] < 0.25 ? undefined : pick(folders, r[2]);
          s.moveToFolder(note.id, f?.id ?? null);
          what += ` to ${f?.id ?? 'the main list'}`;
        }
      } else what += ' (no note)';

      let t = Date.now();
      const stamped: [string, string, unknown][] = [];
      const made: string[] = [];
      for (const n of s.notes as any[]) {
        const was = before.get(n.id);
        if (!was) made.push(n.id);
        for (const [field, at] of Object.entries((n.fieldAt ?? {}) as Record<string, number>)) {
          if (was && was[field] === at) continue;
          stamped.push([n.id, field, n[field] === undefined ? null : JSON.parse(JSON.stringify(n[field]))]);
          if (at > t) t = at;
        }
      }
      const removed = [...before.keys()].filter((id) => !s.notes.some((n: any) => n.id === id));
      const changed = ((s.settings.folders ?? []) as any[]).filter((f) => foldersBefore.get(f.id) !== (f.at ?? 0));
      for (const f of changed) if (f.at > t) t = f.at;
      const orderAt = s.settings.settingsAt?.noteOrder ?? 0;
      for (const at of Object.values((s.settings.settingsAt ?? {}) as Record<string, number>)) if (at > t) t = at;
      return {
        t,
        what,
        stamped,
        made,
        removed,
        folders: changed.map((f) => ({ id: f.id, name: f.name, gone: !!f.gone })),
        order: orderAt !== orderBefore ? [...(s.settings.noteOrder ?? [])] : null,
      };
    },
    { kind, r, tag: `${d.name}${k}`, lastT }
  );
}

async function view(d: Device): Promise<View> {
  const got = await d.page.evaluate(() => {
    const s = (window as any).__nzStore;
    return JSON.parse(JSON.stringify({ notes: s.notes, settings: s.settings }));
  });
  const notes = got.notes as Json[];
  return {
    name: d.name,
    notes: new Map(notes.map((n) => [n.id as string, plain(n)])),
    settings: got.settings,
    list: notes.map((n) => n.id as string),
  };
}

function driveView(drive: FakeDrive): View {
  const notes = new Map<string, Json>();
  let settings: Json = {};
  for (const f of drive.files.values()) {
    if (f.trashed || !f.name.endsWith('.json')) continue;
    if (f.name === 'settings.json') settings = JSON.parse(f.body);
    else if (f.parents.includes(drive.notesFolder)) {
      const n = JSON.parse(f.body) as Json;
      if (!n.deleted) notes.set(n.id as string, plain(n));
    }
  }
  return { name: 'Drive', notes, settings };
}

/** Where the copies differ from each other (nothing: they are in step). */
function apart(views: View[]): string[] {
  const out: string[] = [];
  const [first, ...rest] = views;
  for (const v of rest) {
    for (const id of new Set([...first.notes.keys(), ...v.notes.keys()])) {
      const a = first.notes.get(id);
      const b = v.notes.get(id);
      if (!a || !b) out.push(`note ${id}: on ${a ? first.name : v.name}, not on ${a ? v.name : first.name}`);
      else if (canon(a) !== canon(b)) {
        const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => canon(a[k]) !== canon(b[k]));
        out.push(
          `note ${id}: ${first.name} and ${v.name} differ in ` +
            fields.map((k) => `${k} (${canon(a[k]).slice(0, 80)} / ${canon(b[k]).slice(0, 80)})`).join(', ')
        );
      }
    }
    if (canon(first.settings) !== canon(v.settings)) {
      const keys = [...new Set([...Object.keys(first.settings), ...Object.keys(v.settings)])];
      out.push(
        `settings: ${first.name} and ${v.name} differ in ` +
          keys
            .filter((k) => canon(first.settings[k]) !== canon(v.settings[k]))
            .map((k) => `${k} (${canon(first.settings[k]).slice(0, 160)} / ${canon(v.settings[k]).slice(0, 160)})`)
            .join(', ')
      );
    }
    if (first.list && v.list && first.list.join() !== v.list.join()) {
      out.push(`the list's order: ${first.name} ${first.list.join(' ')} / ${v.name} ${v.list.join(' ')}`);
    }
  }
  return out;
}

/** Where a copy differs from what the steps should have left. */
function lost(model: Model, views: View[]): string[] {
  const out: string[] = [];
  for (const v of views) {
    for (const [id, want] of model.notes) {
      const have = v.notes.get(id);
      if (want.gone) {
        if (want.sure && have) out.push(`${v.name}: note ${id} was deleted and is back`);
        continue;
      }
      if (!have) {
        out.push(`${v.name}: note ${id} is missing`);
        continue;
      }
      for (const [field, value] of Object.entries(want.fields)) {
        if (canon(have[field] ?? null) !== canon(value)) {
          out.push(`${v.name}: note ${id} ${field} is ${canon(have[field]).slice(0, 80)}, last set to ${canon(value).slice(0, 80)}`);
        }
      }
    }
    for (const id of v.notes.keys()) if (!model.notes.has(id)) out.push(`${v.name}: a note nobody made, ${id}`);
    const live = new Map(
      ((v.settings.folders ?? []) as { id: string; name: string; gone?: boolean }[]).filter((f) => !f.gone).map((f) => [f.id, f.name])
    );
    for (const [id, want] of model.folders) {
      const name = live.get(id);
      if (want.gone && name !== undefined) out.push(`${v.name}: folder ${id} was deleted and is back`);
      if (!want.gone && name === undefined) out.push(`${v.name}: folder ${id} (${want.name}) is missing`);
      if (!want.gone && name !== undefined && name !== want.name) out.push(`${v.name}: folder ${id} is called ${name}, last named ${want.name}`);
    }
    for (const id of live.keys()) if (!model.folders.has(id)) out.push(`${v.name}: a folder nobody made, ${id}`);
    if (model.order && canon(v.settings.noteOrder) !== canon(model.order)) out.push(`${v.name}: the order is not the last one set`);
  }
  return out;
}

/**
 * Everyone back on line, and round after round of "time passes, sync" until
 * a whole round changes nothing on Drive and all the copies are the same,
 * twice running. Returns what still differs if that never comes.
 */
async function settle(devs: Device[], drive: FakeDrive): Promise<string[]> {
  for (const d of devs) d.line.offline = false;
  const refusedBefore = drive.refused.length;
  let quiet = 0;
  let differ: string[] = [];
  let owed: string[] = [];
  for (let round = 0; round < 30 && quiet < 2; round++) {
    const writes = drive.writes;
    owed = [];
    for (const d of devs) {
      await chosen(d);
      await d.page.clock.fastForward(31_000);
      await d.page.evaluate(() => {
        const s = (window as any).__nzStore;
        s.flush();
        s.backOnline();
      });
      const left = await rest(d);
      if (left) owed.push(`${d.name}: ${left}`);
    }
    differ = apart([...(await Promise.all(devs.map(view))), driveView(drive)]);
    quiet = drive.writes === writes && !differ.length && !owed.length ? quiet + 1 : 0;
  }
  if (quiet >= 2) return [];
  const why = [...owed, ...differ];
  if (!why.length) why.push('the devices kept writing to Drive, round after round');
  for (const d of devs) {
    const queue = await d.page.evaluate(() => localStorage.getItem('notezzz:outbox')).catch(() => null);
    if (queue) why.push(`${d.name} still owes: ${queue.slice(0, 600)}`);
  }
  const refused = drive.refused.slice(refusedBefore);
  if (refused.length) why.push(`Drive refused: ${refused.slice(-6).join(' | ')}`);
  return why;
}

const STEP_ODDS: [kind: string, odds: number][] = [
  ['new', 10],
  ['title', 14],
  ['body', 14],
  ['colour', 5],
  ['archive', 8],
  ['move', 12],
  ['delete', 4],
  ['folder', 6],
  ['rename', 4],
  ['unfolder', 3],
  ['reorder', 5],
  ['open', 5],
  ['sync', 10],
  ['restart', 5],
  ['line', 7],
  ['pause', 10],
  ['later', 3],
  ['instep', 2],
];

for (let i = 0; i < SEEDS; i++) {
  const seed = FIRST + i;
  test(`devices doing things at once end up the same, with nothing lost (run ${seed})`, async ({ browser }, info) => {
    test.setTimeout(240_000);
    const rand = rng(seed);
    const lagRand = rng(seed ^ 0x5bd1e995);
    const drive = new FakeDrive();
    const model = new Model();
    for (const [id, title] of [['seed1', 'Seed one'], ['seed2', 'Seed two']]) {
      drive.putNote(seedNote(id, title));
      model.know(id);
    }
    // One device first: an account's first launch (welcome notes, the
    // settings file made) is its own subject.
    const devs = [await boot(browser, drive, 'A')];
    await rest(devs[0]);
    devs.push(await boot(browser, drive, 'B'), await boot(browser, drive, 'C'));
    expect(await settle(devs, drive), 'in step before anything is done').toEqual([]);
    drive.lag = () => new Promise((r) => setTimeout(r, Math.floor(lagRand() * 30)));

    const trace: string[] = [];
    const total = STEP_ODDS.reduce((sum, [, odds]) => sum + odds, 0);
    let lastT = 0;
    let problems: string[] = [];
    try {
      for (let k = 1; k <= STEPS && !problems.length; k++) {
        const d = devs[Math.floor(rand() * devs.length)];
        let x = rand() * total;
        const kind = STEP_ODDS.find(([, odds]) => (x -= odds) < 0)![0];
        const r = [rand(), rand(), rand()];
        for (const each of devs) {
          if (each.loads > 1) trace.push(`  (${each.name} loaded itself again)`);
          each.loads = Math.min(each.loads, 1);
        }
        if (kind === 'restart') {
          trace.push(`${k} ${d.name} restart`);
          d.loads = 0;
          await d.page.reload();
          await up(d);
        } else if (kind === 'line') {
          d.line.offline = !d.line.offline;
          trace.push(`${k} ${d.name} ${d.line.offline ? 'loses its connection' : 'is back on line'}`);
          if (!d.line.offline) await d.page.evaluate(() => (window as any).__nzStore.backOnline());
        } else if (kind === 'pause') {
          trace.push(`${k} a pause`);
          await d.page.waitForTimeout(50 + Math.floor(r[0] * 500));
        } else if (kind === 'later') {
          trace.push(`${k} half a minute later`);
          for (const each of devs) {
            await chosen(each);
            await each.page.clock.fastForward(25_000);
          }
        } else if (kind === 'instep') {
          trace.push(`${k} everything let through`);
          problems = await settle(devs, drive);
          model.round += 1;
          for (const each of devs) each.line.offline = false;
        } else {
          const did = await act(d, kind, r, k, lastT);
          lastT = Math.max(lastT, did.t);
          model.take(d.name, did);
          trace.push(`${k} ${d.name}${d.line.offline ? ' (off line)' : ''} ${did.what}`);
        }
      }
      if (!problems.length) problems = await settle(devs, drive);
      if (!problems.length) problems = lost(model, [...(await Promise.all(devs.map(view))), driveView(drive)]);
    } finally {
      await info.attach('steps', { body: trace.join('\n'), contentType: 'text/plain' });
      for (const d of devs) await d.ctx.close().catch(() => {});
    }
    expect(problems, `run ${seed}, steps:\n${trace.join('\n')}`).toEqual([]);
  });
}
