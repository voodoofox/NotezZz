import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { FakeDrive, openWithDrive, type Line } from './fakeDrive';

// Folders: one level of them, under the main list's notes. A note's folder
// is a field of the note; the folders themselves are a setting.

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.route('**://accounts.google.com/**', (r) => r.abort());
  await page.goto('/?local');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('open-settings')).toBeVisible();
});

async function newNote(page: Page, title: string) {
  await page.getByTestId('new-note').click();
  await expect(page.getByTestId('note-pane')).toBeVisible();
  await page.getByTestId('title-input').fill(title);
}

const row = (page: Page, title: string) => page.getByTestId('note-item').filter({ hasText: title });

/** Right-click the note's row: Move to folder… → New folder…, named. */
async function moveToNewFolder(page: Page, title: string, folder: string) {
  await row(page, title).click({ button: 'right' });
  await page.getByTestId('row-menu-folder').click();
  await page.getByTestId('folder-new').click();
  await page.getByTestId('folder-new-name').fill(folder);
  await page.keyboard.press('Enter');
}

/** A mouse drag from the middle of one thing to the middle of another. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('a note moved into a folder leaves the list; the folder sits under the notes, and + inside it adds there', async ({ page }) => {
  await newNote(page, 'Groceries');
  await newNote(page, 'Q4 plan');
  await moveToNewFolder(page, 'Q4 plan', 'Work');

  await expect(page.getByTestId('note-title')).toHaveText(['Groceries']);
  await expect(page.getByTestId('folder-title')).toHaveText(['Work']);
  await expect(page.getByTestId('folder-count')).toHaveText('1');
  const noteBox = (await row(page, 'Groceries').boundingBox())!;
  const folderBox = (await page.getByTestId('folder-item').boundingBox())!;
  expect(folderBox.y).toBeGreaterThan(noteBox.y);

  // Inside: its notes, and a new one lands there.
  await page.getByTestId('folder-open').click();
  await expect(page.getByTestId('folder-name')).toHaveText('Work');
  await expect(page.getByTestId('note-title')).toHaveText(['Q4 plan']);
  await expect(page.getByTestId('folder-item')).toHaveCount(0);
  await expect(page.getByTestId('archive-toggle')).toHaveCount(0);
  await newNote(page, 'Budget');
  await expect(page.getByTestId('note-item')).toHaveCount(2);

  await page.getByTestId('folder-back').click();
  await expect(page.getByTestId('folder-name')).toHaveCount(0);
  await expect(page.getByTestId('note-title')).toHaveText(['Groceries']);
  await expect(page.getByTestId('folder-count')).toHaveText('2');

  // A search reaches into folders and says which one.
  await page.getByTestId('search-toggle').click();
  await page.getByTestId('search-input').fill('budget');
  await expect(page.getByTestId('note-title')).toHaveText(['Budget']);
  await expect(page.getByTestId('note-folder')).toHaveText('Work');
  await page.getByTestId('search-toggle').click();

  // Kept.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId('folder-count')).toHaveText('2');
  await expect(page.getByTestId('note-title')).toHaveText(['Groceries']);
});

test("the note's own menu moves it too; a folder renames, and deleting it puts its notes back", async ({ page }) => {
  await newNote(page, 'Q4');
  await page.getByTestId('note-more').click();
  await page.getByTestId('menu-folder').click();
  await page.getByTestId('folder-new').click();
  await page.getByTestId('folder-new-name').fill('Wrok');
  await page.keyboard.press('Enter');
  // Moved from its own menu: the list goes with it, into the folder.
  await expect(page.getByTestId('folder-name')).toHaveText('Wrok');
  await expect(page.getByTestId('note-title')).toHaveText(['Q4']);
  await page.getByTestId('folder-back').click();
  await expect(page.getByTestId('note-item')).toHaveCount(0);
  await expect(page.getByTestId('folder-title')).toHaveText(['Wrok']);
  // Every note in a folder is no empty list.
  await expect(page.getByTestId('empty-state')).toHaveCount(0);
  // The menu says where the note is.
  await page.getByTestId('note-more').click();
  await expect(page.getByTestId('menu-folder')).toContainText('Wrok');
  await page.getByTestId('note-more').click();

  await page.getByTestId('folder-item').click({ button: 'right' });
  await page.getByTestId('folder-menu-rename').click();
  await page.getByTestId('folder-rename-input').fill('Work');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('folder-title')).toHaveText(['Work']);

  await page.getByTestId('folder-open').click();
  await page.getByTestId('folder-more').click();
  await page.getByTestId('folder-menu-delete').click();
  await expect(page.getByTestId('folder-name')).toHaveCount(0);
  await expect(page.getByTestId('folder-item')).toHaveCount(0);
  await expect(page.getByTestId('note-title')).toHaveText(['Q4']);
});

test('back leaves the folder, not the app', async ({ page }) => {
  await newNote(page, 'Letter');
  await moveToNewFolder(page, 'Letter', 'Inbox');
  await page.getByTestId('folder-open').click();
  await expect(page.getByTestId('folder-name')).toHaveText('Inbox');
  await page.goBack();
  await expect(page.getByTestId('folder-name')).toHaveCount(0);
  await expect(page.getByTestId('folder-title')).toHaveText(['Inbox']);
  await expect(page).toHaveURL(/\?local/);
});

test("a note dragged onto a folder goes in; dragged onto the folder's header, out", async ({ page }) => {
  await newNote(page, 'Stays');
  await newNote(page, 'Goes in');
  await newNote(page, 'Already in');
  await moveToNewFolder(page, 'Already in', 'Box');
  await expect(page.getByTestId('folder-count')).toHaveText('1');

  await drag(page, row(page, 'Goes in').getByTestId('note-swatch'), page.getByTestId('folder-item'));
  await expect(page.getByTestId('note-title')).toHaveText(['Stays']);
  await expect(page.getByTestId('folder-count')).toHaveText('2');

  await page.getByTestId('folder-open').click();
  await drag(page, row(page, 'Goes in').getByTestId('note-swatch'), page.getByTestId('folder-head'));
  await expect(page.getByTestId('note-title')).toHaveText(['Already in']);
  await page.getByTestId('folder-back').click();
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  await expect(page.getByTestId('folder-count')).toHaveText('1');
});

test('an archived note filed in a folder comes back out of the archive, into the folder', async ({ page }) => {
  await newNote(page, 'Stays');
  await newNote(page, 'Brahmi');
  await page.getByTestId('note-more').click();
  await page.getByTestId('menu-archive').click();
  await page.getByTestId('archive-toggle').click();
  await row(page, 'Brahmi').click({ button: 'right' });
  await page.getByTestId('row-menu-folder').click();
  await expect(page.getByTestId('folder-pick-unarchives')).toBeVisible();
  await page.getByTestId('folder-new').click();
  await page.getByTestId('folder-new-name').fill('Health');
  await page.keyboard.press('Enter');
  // The archive emptied: back to the main list, the note in its folder.
  await expect(page.getByTestId('archive-toggle')).toHaveCount(0);
  await expect(page.getByTestId('note-title')).toHaveText(['Stays']);
  await expect(page.getByTestId('folder-count')).toHaveText('1');
  await page.getByTestId('folder-open').click();
  await expect(page.getByTestId('note-title')).toHaveText(['Brahmi']);
});

test("a folder whose notes are all archived says where they are", async ({ page }) => {
  await newNote(page, 'Old');
  await moveToNewFolder(page, 'Old', 'Box');
  await page.getByTestId('folder-open').click();
  await page.getByTestId('note-pick').click();
  await page.getByTestId('note-more').click();
  await page.getByTestId('menu-archive').click();
  await expect(page.getByTestId('folder-empty')).toContainText('archived note');
});

test('the list shows where the open note lives: its folder, or the archive', async ({ page }) => {
  await newNote(page, 'Filed');
  await newNote(page, 'Loose');
  await moveToNewFolder(page, 'Filed', 'Work');
  await newNote(page, 'Put away');
  await page.getByTestId('note-more').click();
  await page.getByTestId('menu-archive').click();
  await expect(page.getByTestId('note-title')).toHaveText(['Loose']);
  await expect(page.getByTestId('title-input')).toHaveValue('Loose');

  // Opened from a search: the folder it is in.
  await page.getByTestId('search-toggle').click();
  await page.getByTestId('search-input').fill('filed');
  await page.getByTestId('note-pick').click();
  await page.getByTestId('search-toggle').click();
  await expect(page.getByTestId('folder-name')).toHaveText('Work');
  await expect(page.getByTestId('note-title')).toHaveText(['Filed']);

  // An archived one: the archive, so it reads as archived.
  await page.getByTestId('search-toggle').click();
  await page.getByTestId('search-input').fill('put away');
  await page.getByTestId('note-pick').click();
  await page.getByTestId('search-toggle').click();
  await expect(page.getByTestId('archive-toggle')).toHaveText(/Back to notes/);
  await expect(page.getByTestId('note-title')).toHaveText(['Put away']);

  // Brought back from the archive: the list follows it home.
  await page.getByTestId('note-more').click();
  await page.getByTestId('menu-archive').click();
  await expect(page.getByTestId('note-title')).toHaveText(['Put away', 'Loose']);
  await expect(page.getByTestId('folder-item')).toHaveCount(1);

  // Moved from its own menu: the list goes with it.
  await page.getByTestId('note-more').click();
  await page.getByTestId('menu-folder').click();
  await page.getByTestId('folder-pick').filter({ hasText: 'Work' }).click();
  await expect(page.getByTestId('folder-name')).toHaveText('Work');
  await expect(page.getByTestId('note-title')).toHaveText(['Put away', 'Filed']);

  // A folder left by hand stays left, whatever note is showing.
  await page.getByTestId('folder-back').click();
  await expect(page.getByTestId('folder-name')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('folder-name')).toHaveCount(0);
});

test('filing the open note from the list keeps the list where it is', async ({ page }) => {
  await newNote(page, 'Other');
  await newNote(page, 'Open one');
  await moveToNewFolder(page, 'Open one', 'Box');
  await expect(page.getByTestId('folder-name')).toHaveCount(0);
  await expect(page.getByTestId('note-title')).toHaveText(['Other']);
});

test('archiving the open note in a folder opens the next one there, not one elsewhere', async ({ page }) => {
  await newNote(page, 'Elsewhere');
  await newNote(page, 'A');
  await newNote(page, 'B');
  await moveToNewFolder(page, 'A', 'Box');
  await row(page, 'B').click({ button: 'right' });
  await page.getByTestId('row-menu-folder').click();
  await page.getByTestId('folder-pick').filter({ hasText: 'Box' }).click();
  await page.getByTestId('folder-open').click();
  await row(page, 'A').getByTestId('note-pick').click();
  await page.getByTestId('note-more').click();
  await page.getByTestId('menu-archive').click();
  await expect(page.getByTestId('folder-name')).toHaveText('Box');
  await expect(page.getByTestId('title-input')).toHaveValue('B');
});

test('an empty folder says how to fill it', async ({ page }) => {
  await newNote(page, 'Only');
  await moveToNewFolder(page, 'Only', 'Box');
  await page.getByTestId('folder-open').click();
  await row(page, 'Only').click({ button: 'right' });
  await page.getByTestId('row-menu-folder').click();
  await page.getByTestId('folder-pick-none').click();
  await expect(page.getByTestId('folder-empty')).toBeVisible();
});

const note = (id: string, title: string) => ({
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

test('a folder made while the app is still loading stays, here and on Drive', async ({ page }) => {
  const drive = new FakeDrive();
  drive.putNote(note('n1', 'Plan'));
  drive.putNote(note('n2', 'Loose'));
  await openWithDrive(page, drive);
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  const settingsFile = () => [...drive.files.values()].find((f) => f.name === 'settings.json');
  await expect.poll(settingsFile).toBeTruthy();
  await expect(page.getByTestId('sync-arrows')).toHaveCount(0);

  // Launched again, the settings download of the load is slow: the list is
  // up from the cache, and a folder is made before the load has landed.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let held = false;
  drive.holdDownload = (f) => {
    if (f.name !== 'settings.json' || held) return;
    held = true;
    return gate;
  };
  await page.reload();
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  await expect.poll(() => held).toBe(true);
  await moveToNewFolder(page, 'Plan', 'Work');
  await expect.poll(() => settingsFile()!.body).toContain('Work');

  // The load lands, with the copy from before the folder.
  release();
  await expect(page.getByTestId('list-loading')).toHaveCount(0);
  await expect(page.getByTestId('sync-arrows')).toHaveCount(0);
  await expect(page.getByTestId('folder-title')).toHaveText(['Work']);
  await expect(page.getByTestId('note-title')).toHaveText(['Loose']);
  await page.evaluate(() => (window as unknown as { __nzSyncNow: () => Promise<void> }).__nzSyncNow());
  await expect(page.getByTestId('folder-title')).toHaveText(['Work']);
  expect(settingsFile()!.body).toContain('Work');
});

test('folders reach the other device, with their notes in them', async ({ page, browser }) => {
  const drive = new FakeDrive();
  drive.putNote(note('n1', 'Plan'));
  drive.putNote(note('n2', 'Loose'));
  await openWithDrive(page, drive);
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  await moveToNewFolder(page, 'Plan', 'Work');
  await expect.poll(() => drive.noteBody('n1')?.folder).toBeTruthy();
  await expect(page.getByTestId('sync-arrows')).toHaveCount(0);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.route('**://accounts.google.com/**', (r) => r.abort());
  await openWithDrive(other, drive);
  await expect(other.getByTestId('folder-title')).toHaveText(['Work']);
  await expect(other.getByTestId('folder-count')).toHaveText('1');
  await expect(other.getByTestId('note-title')).toHaveText(['Loose']);
  await ctx.close();
});

// ---- two devices, and a connection that comes and goes -------------------
// Each of these went wrong before the folders merged one by one (found by
// the many-devices run, tests/syncSim.spec.ts).

/** Another device on the same Drive, with a connection of its own. */
async function device(browser: Browser, drive: FakeDrive) {
  const line: Line = { offline: false };
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.route('**://accounts.google.com/**', (r) => r.abort());
  await openWithDrive(page, drive, line);
  return { ctx, page, line };
}

/** The connection is back, as the browser tells the app. */
const online = (page: Page) => page.evaluate(() => void window.dispatchEvent(new Event('online')));

const settingsOn = (drive: FakeDrive) => [...drive.files.values()].find((f) => f.name === 'settings.json');

/** The folders in Drive's copy of the settings, deleted ones left out. */
function foldersOn(drive: FakeDrive): string[] {
  const body = settingsOn(drive)?.body;
  const all = body ? ((JSON.parse(body).folders ?? []) as { name: string; gone?: boolean }[]) : [];
  return all
    .filter((f) => !f.gone)
    .map((f) => f.name)
    .sort();
}

/** A Drive with two notes, open here and at rest. */
async function twoNotes(page: Page, line?: Line) {
  const drive = new FakeDrive();
  drive.putNote(note('n1', 'Plan'));
  drive.putNote(note('n2', 'Loose'));
  await openWithDrive(page, drive, line);
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  await expect.poll(() => settingsOn(drive)).toBeTruthy();
  await expect(page.getByTestId('sync-arrows')).toHaveCount(0);
  return drive;
}

test('a folder made on each of two devices, before either heard of the other: both keep both', async ({ page, browser }) => {
  const drive = await twoNotes(page);
  const phone = await device(browser, drive);
  await expect(phone.page.getByTestId('note-item')).toHaveCount(2);
  await expect(phone.page.getByTestId('sync-arrows')).toHaveCount(0);
  // (The phone has the note it files open, not the one the PC does: the
  // list goes where the open note is filed, whoever files it.)
  await row(phone.page, 'Loose').getByTestId('note-pick').click();

  // The phone is out of reach, and a folder is made on each.
  phone.line.offline = true;
  await moveToNewFolder(page, 'Plan', 'Recipes');
  await expect.poll(() => foldersOn(drive)).toEqual(['Recipes']);
  await moveToNewFolder(phone.page, 'Loose', 'Trips');
  await expect(phone.page.getByTestId('folder-title')).toHaveText(['Trips']);

  // Back in reach, the phone sends its folder: added to the list, not put
  // in its place (the later save used to be the whole list).
  phone.line.offline = false;
  await online(phone.page);
  await expect.poll(() => foldersOn(drive)).toEqual(['Recipes', 'Trips']);
  await expect(phone.page.getByTestId('folder-title')).toHaveText(['Recipes', 'Trips']);
  await expect(phone.page.getByTestId('note-item')).toHaveCount(0);
  await expect.poll(() => drive.noteBody('n2')?.folder).toBeTruthy();
  await page.evaluate(() => (window as unknown as { __nzSyncNow: () => Promise<void> }).__nzSyncNow());
  await expect(page.getByTestId('folder-title')).toHaveText(['Recipes', 'Trips']);
  await expect(page.getByTestId('note-item')).toHaveCount(0);
  await phone.ctx.close();
});

test('a folder deleted on one device stays deleted when another, which still had it, changes its folders', async ({ page, browser }) => {
  const drive = await twoNotes(page);
  await moveToNewFolder(page, 'Plan', 'Work');
  await expect.poll(() => foldersOn(drive)).toEqual(['Work']);
  await expect.poll(() => drive.noteBody('n1')?.folder).toBeTruthy();
  await expect(page.getByTestId('sync-arrows')).toHaveCount(0);
  const phone = await device(browser, drive);
  await expect(phone.page.getByTestId('folder-title')).toHaveText(['Work']);
  await expect(phone.page.getByTestId('sync-arrows')).toHaveCount(0);

  // Deleted here, with the phone out of reach...
  phone.line.offline = true;
  await page.getByTestId('folder-item').click({ button: 'right' });
  await page.getByTestId('folder-menu-delete').click();
  await expect(page.getByTestId('folder-item')).toHaveCount(0);
  await expect.poll(() => foldersOn(drive)).toEqual([]);
  await expect.poll(() => drive.noteBody('n1')?.folder ?? null).toBeNull();

  // ...where a folder is made, in a list that still has the deleted one.
  await moveToNewFolder(phone.page, 'Loose', 'Trips');
  await expect(phone.page.getByTestId('folder-title')).toHaveText(['Trips', 'Work']);
  phone.line.offline = false;
  await online(phone.page);
  await expect.poll(() => foldersOn(drive)).toEqual(['Trips']);
  await expect(phone.page.getByTestId('folder-title')).toHaveText(['Trips']);
  await expect(phone.page.getByTestId('note-title')).toHaveText(['Plan']);
  await page.evaluate(() => (window as unknown as { __nzSyncNow: () => Promise<void> }).__nzSyncNow());
  await expect(page.getByTestId('folder-title')).toHaveText(['Trips']);
  await expect(page.getByTestId('note-title')).toHaveText(['Plan']);
  await phone.ctx.close();
});

test('a folder made with no connection, and the app closed before it was back, is there at the next launch', async ({ page }) => {
  const line: Line = { offline: false };
  const drive = await twoNotes(page, line);

  line.offline = true;
  await moveToNewFolder(page, 'Plan', 'Work');
  await expect(page.getByTestId('folder-title')).toHaveText(['Work']);
  expect(foldersOn(drive)).toEqual([]);

  // Launched again, in reach of Drive: its copy of the settings has no such
  // folder, and used to be taken as it was.
  line.offline = false;
  await page.reload();
  await expect(page.getByTestId('folder-title')).toHaveText(['Work']);
  await expect.poll(() => foldersOn(drive)).toEqual(['Work']);
  await expect.poll(() => drive.noteBody('n1')?.folder).toBeTruthy();
  await expect(page.getByTestId('list-loading')).toHaveCount(0);
  await expect(page.getByTestId('sync-arrows')).toHaveCount(0);
  await expect(page.getByTestId('folder-title')).toHaveText(['Work']);
  await expect(page.getByTestId('note-title')).toHaveText(['Loose']);
});

// ---- settings read from Drive are never read for nothing -------------------
// Drive's copy is fetched again only when it has changed since this device
// last read it. So a copy that was read must be taken in there and then:
// dropped (the rest of that load failed, the write it was read for failed),
// it was never fetched again.

/** A folder made on another device: in Drive's copy of the settings. */
function folderFromElsewhere(drive: FakeDrive, name: string) {
  const at = Date.now();
  drive.changeSettings((s) => ({
    ...s,
    folders: [...((s.folders as unknown[]) ?? []), { id: `else-${name}`, name, at }],
    settingsAt: { ...(s.settingsAt as Record<string, number>), folders: at },
  }));
}

test('settings that arrive at a launch whose notes do not are taken in all the same', async ({ page }) => {
  const drive = await twoNotes(page);
  folderFromElsewhere(drive, 'Trips');

  // Launched on a bad line: the settings arrive, the list of notes doesn't.
  drive.drop = (_method, url) => {
    const q = url.searchParams.get('q') ?? '';
    return q.includes(`'${drive.notesFolder}' in parents`) && !q.includes('name=');
  };
  const failed = page.waitForEvent('requestfailed', (r) => r.url().includes('googleapis.com'));
  await page.reload();
  await failed;
  await expect(page.getByTestId('folder-title')).toHaveText(['Trips']);

  drive.drop = null;
  await online(page);
  await expect(page.getByTestId('sync-arrows')).toHaveCount(0);
  await expect(page.getByTestId('folder-title')).toHaveText(['Trips']);
  expect(foldersOn(drive)).toEqual(['Trips']);
});

test('a settings save that read Drive\'s copy, and then failed, still has that copy at the next try', async ({ page }) => {
  const drive = await twoNotes(page);
  folderFromElsewhere(drive, 'Trips');

  // A folder made here. Its save reads Drive's copy first (the one with
  // Trips), merges, and the upload is lost. The next try used to send this
  // device's folders alone: Drive's copy had been read, so it was not read
  // again, and what was in it had been kept nowhere.
  const file = settingsOn(drive)!;
  let lost = 0;
  drive.drop = (method, url) => method === 'PATCH' && url.pathname.endsWith(`/${file.id}`) && lost++ === 0;
  await moveToNewFolder(page, 'Plan', 'Work');
  await expect.poll(() => lost).toBeGreaterThan(0);
  await online(page);
  await expect.poll(() => foldersOn(drive)).toEqual(['Trips', 'Work']);
  await expect(page.getByTestId('folder-title')).toHaveText(['Trips', 'Work']);
});

// ---- a setting is dated when it changes, and the dates end up alike ---------

type OrderStore = { notes: { id: string }[]; reorder(ids: string[]): Promise<void> };
const orderOn = (drive: FakeDrive) => {
  const s = JSON.parse(settingsOn(drive)!.body) as { noteOrder?: string[]; settingsAt?: Record<string, number> };
  return { order: s.noteOrder ?? [], at: s.settingsAt?.noteOrder ?? 0 };
};
/** Another device puts the notes in this order, at `at`. */
function orderFromElsewhere(drive: FakeDrive, order: string[], at: number) {
  drive.changeSettings((s) => ({
    ...s,
    noteOrder: order,
    settingsAt: { ...(s.settingsAt as Record<string, number>), noteOrder: at },
  }));
}

test('a note dropped back where it was is no reorder: the order another device has just made stays', async ({ page }) => {
  const drive = await twoNotes(page);
  await expect(page.getByTestId('note-title')).toHaveText(['Plan', 'Loose']);
  orderFromElsewhere(drive, ['n2', 'n1'], Date.now() - 1000);

  // Before this device has heard of it, a note is picked up and put down
  // where it was. That used to be dated as a change, the later of the two.
  await page.evaluate(() => {
    const s = (window as unknown as { __nzStore: OrderStore }).__nzStore;
    void s.reorder(s.notes.map((n) => n.id));
  });
  await page.evaluate(() => (window as unknown as { __nzSyncNow: () => Promise<void> }).__nzSyncNow());
  await expect(page.getByTestId('note-title')).toHaveText(['Loose', 'Plan']);
  await expect(page.getByTestId('sync-arrows')).toHaveCount(0);
  expect(orderOn(drive).order).toEqual(['n2', 'n1']);
});

test('the same change made here and on another device ends up with one date, here and on Drive', async ({ page }) => {
  const line: Line = { offline: false };
  const drive = await twoNotes(page, line);

  // Here with no connection, and the app closed before there is one...
  line.offline = true;
  await page.evaluate(() => void (window as unknown as { __nzStore: OrderStore }).__nzStore.reorder(['n2', 'n1']));
  await expect(page.getByTestId('note-title')).toHaveText(['Loose', 'Plan']);
  const mine = () =>
    page.evaluate(() => (JSON.parse(localStorage.getItem('notezzz:cache:settings') ?? '{}').settingsAt?.noteOrder ?? 0) as number);
  const at = await mine();
  // ...and the same order on another device, a little earlier.
  orderFromElsewhere(drive, ['n2', 'n1'], at - 500);

  line.offline = false;
  await page.reload();
  await expect(page.getByTestId('note-title')).toHaveText(['Loose', 'Plan']);
  await expect.poll(() => orderOn(drive).at).toBe(at);
  expect(await mine()).toBe(at);
});

test('a setting set to what it already is keeps its date', async ({ page }) => {
  await page.goto('/');
  const at = await page.evaluate(async () => {
    const m = await import(/* @vite-ignore */ String('/src/lib/settingsMerge.ts'));
    const was = { layout: 'top', noteOrder: ['a', 'b'], settingsAt: { layout: 5, noteOrder: 6 } };
    const same = m.patchSettings(was, { layout: 'top', noteOrder: ['a', 'b'] }, 100).settingsAt;
    const other = m.patchSettings(was, { layout: 'side', noteOrder: ['b', 'a'] }, 100).settingsAt;
    return { same, other };
  });
  expect(at.same).toEqual({ layout: 5, noteOrder: 6 });
  expect(at.other).toEqual({ layout: 100, noteOrder: 100 });
});
