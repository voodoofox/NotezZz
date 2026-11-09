import { test, expect, type Locator, type Page } from '@playwright/test';
import { FakeDrive, openWithDrive } from './fakeDrive';

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

test('an empty folder says how to fill it', async ({ page }) => {
  await newNote(page, 'Only');
  await moveToNewFolder(page, 'Only', 'Box');
  await page.getByTestId('folder-open').click();
  await row(page, 'Only').click({ button: 'right' });
  await page.getByTestId('row-menu-folder').click();
  await page.getByTestId('folder-pick-none').click();
  await expect(page.getByTestId('folder-empty')).toBeVisible();
});

test('folders reach the other device, with their notes in them', async ({ page, browser }) => {
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
