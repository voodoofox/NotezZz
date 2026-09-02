import { test, expect, type Page } from '@playwright/test';

// Start each test on a clean slate: local mode + empty storage.
test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // auto-accept the delete confirm()
  await page.goto('/?local');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('open-settings')).toBeVisible(); // app mounted
});

/** Create a note and return the ProseMirror editor locator. */
async function createNote(page: Page) {
  await page.getByTestId('new-note').click();
  await expect(page.getByTestId('note-pane')).toBeVisible();
  return page.locator('.ProseMirror');
}

async function typeInEditor(page: Page, text: string) {
  const pm = page.locator('.ProseMirror');
  await pm.click();
  await pm.pressSequentially(text);
}

test('starts with an empty state', async ({ page }) => {
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('pane-empty')).toBeVisible();
  await expect(page.getByTestId('note-item')).toHaveCount(0);
});

test('creates a note and opens the editor', async ({ page }) => {
  await createNote(page);
  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await expect(page.getByTestId('pane-empty')).toBeHidden();
  await expect(page.locator('.ProseMirror')).toBeVisible();
});

test('typing a title updates the sidebar live (reactivity regression)', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Groceries');
  await expect(page.getByTestId('note-title')).toHaveText('Groceries');
});

test('typing in the editor is reflected and previewed in the sidebar', async ({ page }) => {
  await createNote(page);
  await typeInEditor(page, 'buy milk');
  await expect(page.locator('.ProseMirror')).toContainText('buy milk');
  await expect(page.getByTestId('note-title')).toHaveText('buy milk');
});

test('bold formatting wraps the selection', async ({ page }) => {
  await createNote(page);
  await typeInEditor(page, 'important');
  await page.locator('.ProseMirror').press('ControlOrMeta+a');
  await page.getByTestId('fmt-bold').click();
  await expect(page.locator('.ProseMirror strong')).toHaveText('important');
});

test('italic and underline apply', async ({ page }) => {
  await createNote(page);
  await typeInEditor(page, 'styled');
  await page.locator('.ProseMirror').press('ControlOrMeta+a');
  await page.getByTestId('fmt-italic').click();
  await page.getByTestId('fmt-underline').click();
  await expect(page.locator('.ProseMirror em')).toHaveCount(1);
  await expect(page.locator('.ProseMirror u')).toHaveCount(1);
});

test('bullet list toggles', async ({ page }) => {
  await createNote(page);
  await typeInEditor(page, 'item one');
  await page.getByTestId('fmt-bullet').click();
  await expect(page.locator('.ProseMirror ul li')).toHaveCount(1);
});

test('changing palette updates the note color live (the frozen-UI bug)', async ({ page }) => {
  await createNote(page);
  const pane = page.getByTestId('note-pane');
  await expect(pane).toHaveAttribute('data-palette', 'paper');
  await page.getByTestId('note-color').click(); // open the color popover
  await page.locator('[data-testid="palette-chip"][data-palette="mint"]').click();
  await expect(pane).toHaveAttribute('data-palette', 'mint');
  // Mint bg (#C2F0CD) actually paints:
  await expect(pane).toHaveCSS('background-color', 'rgb(194, 240, 205)');
  // And the sidebar swatch recolors too:
  await expect(page.getByTestId('note-swatch')).toHaveCSS('background-color', 'rgb(194, 240, 205)');
});

test('image import inserts a picture into the note', async ({ page }) => {
  await createNote(page);
  // 1x1 red PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.getByTestId('image-input').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: png,
  });
  const img = page.locator('.ProseMirror img');
  await expect(img).toHaveCount(1);
  expect(await img.getAttribute('src')).toContain('data:image/png');
});

test('custom color sliders recolor the note', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('note-color').click();
  await page.getByTestId('custom-hue').fill('200');
  await expect(page.getByTestId('note-pane')).toHaveAttribute('data-palette', /custom:#/);
});

test('voice memo: record inserts a playable audio track', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('fmt-record').click();
  await expect(page.getByTestId('fmt-record')).toHaveClass(/recording/);
  await page.waitForTimeout(1500);
  await page.getByTestId('fmt-record').click();
  // The custom player replaces the browser widget; the <audio> lives in the
  // saved HTML rather than the DOM.
  const player = page.locator('.ProseMirror .nz-audio');
  await expect(player).toHaveCount(1);
  await expect(player.locator('.nz-audio-play')).toBeVisible();
  await expect(player.locator('.nz-audio-track')).toBeVisible();
  // Persists across reload like all note content.
  await page.goto('/?local');
  await expect(page.locator('.ProseMirror .nz-audio')).toHaveCount(1);
});

test('share intake: "pin it to my desktop" creates a pinned note', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('notezzz:pendingShare', 'send this to the big screen'));
  await page.reload();
  await expect(page.getByTestId('share-overlay')).toBeVisible();
  await page.getByTestId('share-pin').check();
  await page.getByTestId('share-new').click();
  await expect(page.getByTestId('note-pin')).toHaveClass(/on/);
  await expect(page.locator('.ProseMirror')).toContainText('send this to the big screen');
});

test('share intake: search filters append targets', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Groceries');
  await page.getByTestId('new-note').click();
  await page.getByTestId('title-input').fill('Work plan');
  await page.evaluate(() => localStorage.setItem('notezzz:pendingShare', 'find me a home'));
  await page.reload();
  await expect(page.getByTestId('share-append-item')).toHaveCount(2);
  await page.getByTestId('share-search').fill('work');
  await expect(page.getByTestId('share-append-item')).toHaveCount(1);
  await expect(page.getByTestId('share-append-item')).toContainText('Work plan');
  await page.getByTestId('share-cancel').click();
});

test('search filters the note list live', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Groceries');
  await page.getByTestId('new-note').click();
  await page.getByTestId('title-input').fill('Work plan');
  await expect(page.getByTestId('note-item')).toHaveCount(2);

  await page.getByTestId('search-toggle').click();
  await page.getByTestId('search-input').fill('groc');
  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await expect(page.getByTestId('note-title')).toHaveText('Groceries');

  // Toggling search off restores the full list.
  await page.getByTestId('search-toggle').click();
  await expect(page.getByTestId('note-item')).toHaveCount(2);
});

test('base font-size slider (in tools popover) updates its readout', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('tools-toggle').click();
  await page.getByTestId('size-slider').fill('28');
  await expect(page.getByTestId('size-value')).toHaveText('28');
  await expect(page.getByTestId('tools-toggle')).toContainText('28');
});

test('opacity control is desktop-only (hidden on web)', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('tools-toggle').click();
  await expect(page.getByTestId('size-slider')).toBeVisible();
  await expect(page.getByTestId('opacity-slider')).toHaveCount(0);
});

test('share intake: shared text goes into a new note', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('notezzz:pendingShare', 'shared hello\nline two'));
  await page.reload();
  await expect(page.getByTestId('share-overlay')).toBeVisible();
  await page.getByTestId('share-new').click();
  await expect(page.getByTestId('share-overlay')).toBeHidden();
  await expect(page.locator('.ProseMirror')).toContainText('shared hello');
  await expect(page.locator('.ProseMirror')).toContainText('line two');
});

test('share intake: append to an existing note', async ({ page }) => {
  await createNote(page);
  await typeInEditor(page, 'original');
  await page.evaluate(() => localStorage.setItem('notezzz:pendingShare', 'appended bit'));
  await page.reload();
  await expect(page.getByTestId('share-overlay')).toBeVisible();
  await page.getByTestId('share-append-item').first().click();
  await expect(page.locator('.ProseMirror')).toContainText('original');
  await expect(page.locator('.ProseMirror')).toContainText('appended bit');
});

test('drawing: a sketch becomes an image in the note', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('fmt-draw').click();
  const surface = page.getByTestId('draw-surface');
  await expect(surface).toBeVisible();

  // Draw a squiggle.
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 200, { steps: 12 });
  await page.mouse.move(box.x + 320, box.y + 130, { steps: 12 });
  await page.mouse.up();

  await page.getByTestId('draw-done').click();
  await expect(surface).toBeHidden();
  const img = page.locator('.ProseMirror img');
  await expect(img).toHaveCount(1);
  expect(await img.getAttribute('src')).toContain('data:image/svg+xml');

  // The sketch survives a reload (persisted in contentHtml).
  await page.goto('/?local');
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
});

test('drawing: eraser removes a stroke', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('fmt-draw').click();
  const surface = page.getByTestId('draw-surface');
  const box = (await surface.boundingBox())!;

  // Draw a line…
  await page.mouse.move(box.x + 100, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 150, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('draw-done')).toBeEnabled();

  // …then erase through it.
  await page.getByTestId('tool-erase').click();
  await page.mouse.move(box.x + 170, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 200, { steps: 10 });
  await page.mouse.up();

  // No strokes left -> Done disables again.
  await expect(page.getByTestId('draw-done')).toBeDisabled();
  await page.getByTestId('draw-cancel').click();
});

test('drawing: cancel inserts nothing', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('fmt-draw').click();
  await page.getByTestId('draw-cancel').click();
  await expect(page.locator('.ProseMirror img')).toHaveCount(0);
});

test('pinning a note marks it active in the list', async ({ page }) => {
  await createNote(page);
  const pin = page.getByTestId('note-pin');
  await expect(pin).not.toHaveClass(/on/);
  await pin.click();
  await expect(pin).toHaveClass(/on/);
  await pin.click();
  await expect(pin).not.toHaveClass(/on/);
});

test('selecting a different note switches the editor content', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('First');
  await page.getByTestId('new-note').click();
  await page.getByTestId('title-input').fill('Second');
  await expect(page.getByTestId('note-item')).toHaveCount(2);

  // Click the row titled "First" and confirm the editor pane shows it.
  await page.getByTestId('note-pick').filter({ hasText: 'First' }).click();
  await expect(page.getByTestId('title-input')).toHaveValue('First');
});

test('deleting a note removes it', async ({ page }) => {
  await createNote(page);
  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await page.getByTestId('note-delete').click();
  await expect(page.getByTestId('note-item')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible();
});

test('settings shows the version/build stamp', async ({ page }) => {
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('app-version')).toContainText(/v\d+\.\d+\.\d+ · built \d{4}-/);
});

test('settings: switching theme updates the document', async ({ page }) => {
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings-close')).toBeVisible();
  await page.getByTestId('set-theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('settings-close').click();
});

test('settings: default palette applies to newly created notes', async ({ page }) => {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('set-palette').selectOption('sky');
  await page.getByTestId('settings-close').click();
  await createNote(page);
  await expect(page.getByTestId('note-pane')).toHaveAttribute('data-palette', 'sky');
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 400, height: 800 } });

  test('stacked split: list and note both visible', async ({ page }) => {
    await page.getByTestId('new-note').click();
    // 40/60 split: list (with the new-note button) AND editor pane visible.
    await expect(page.getByTestId('note-pane')).toBeVisible();
    await expect(page.getByTestId('new-note')).toBeVisible();
    await expect(page.getByTestId('note-item')).toBeVisible();
    // List sits above the pane (stacked layout).
    const list = await page.getByTestId('note-item').boundingBox();
    const pane = await page.getByTestId('note-pane').boundingBox();
    expect(list!.y).toBeLessThan(pane!.y);
  });

  test('fullscreen expands the note and back restores the split', async ({ page }) => {
    await page.getByTestId('new-note').click();
    await page.getByTestId('note-fullscreen').click();
    await expect(page.getByTestId('new-note')).toBeHidden(); // list gone
    await expect(page.getByTestId('note-pane')).toBeVisible();
    await page.getByTestId('exit-fullscreen').click();
    await expect(page.getByTestId('new-note')).toBeVisible(); // split back
  });

  test('selection shows the floating format bubble; bold works from it', async ({ page }) => {
    await page.getByTestId('new-note').click();
    await typeInEditor(page, 'bubble me');
    await expect(page.getByTestId('format-bubble')).toBeHidden();
    await page.locator('.ProseMirror').press('ControlOrMeta+a');
    await expect(page.getByTestId('format-bubble')).toBeVisible();
    await page.getByTestId('format-bubble').getByRole('button', { name: 'Bold' }).click();
    await expect(page.locator('.ProseMirror strong')).toHaveText('bubble me');
  });

  test('topbar buttons stay inside the pane (no overflow)', async ({ page }) => {
    await page.getByTestId('new-note').click();
    await page.getByTestId('title-input').fill('A very long note title that would push buttons out');
    const pane = (await page.getByTestId('note-pane').boundingBox())!;
    const del = (await page.getByTestId('note-delete').boundingBox())!;
    // Delete must sit inside the pane with breathing room, never clipped.
    expect(del.x + del.width).toBeLessThanOrEqual(pane.x + pane.width - 8);
  });

  test('deleting in fullscreen returns to the split view', async ({ page }) => {
    await page.getByTestId('new-note').click();
    await page.getByTestId('note-fullscreen').click();
    await page.getByTestId('note-delete').click();
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });
});

test('a background sync does not drop a just-created note or steal focus', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Fresh note');
  await page.locator('.ProseMirror').click();
  await page.locator('.ProseMirror').pressSequentially('typing');

  // Force refreshes like the auto-sync timer does, mid-work.
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('sync-now').click();
    await page.waitForTimeout(150);
  }

  // The note survives, stays selected, and the text is intact.
  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await expect(page.getByTestId('title-input')).toHaveValue('Fresh note');
  await expect(page.locator('.ProseMirror')).toContainText('typing');
});

test('notes can be dragged into a new order, and it sticks', async ({ page }) => {
  for (const title of ['Alpha', 'Beta', 'Gamma']) {
    await page.getByTestId('new-note').click();
    await page.getByTestId('title-input').fill(title);
  }
  const order = async () => page.getByTestId('note-title').allTextContents();
  expect(await order()).toEqual(['Gamma', 'Beta', 'Alpha']);

  // Drag the top note's colour bar down past the last row.
  const handle = page.getByTestId('note-swatch').first();
  const from = (await handle.boundingBox())!;
  const last = (await page.getByTestId('note-item').last().boundingBox())!;
  await page.mouse.move(from.x + 5, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, last.y + last.height, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await order()).toEqual(['Beta', 'Alpha', 'Gamma']);

  // A sync must not undo it, and neither must a reload.
  await page.getByTestId('sync-now').click();
  await page.waitForTimeout(400);
  expect(await order()).toEqual(['Beta', 'Alpha', 'Gamma']);
  await page.goto('/?local');
  await expect(page.getByTestId('note-item')).toHaveCount(3);
  expect(await order()).toEqual(['Beta', 'Alpha', 'Gamma']);
});

test('pinning does not reshuffle the list when a sync lands', async ({ page }) => {
  for (const title of ['First', 'Second', 'Third']) {
    await page.getByTestId('new-note').click();
    await page.getByTestId('title-input').fill(title);
  }
  const order = async () => page.getByTestId('note-title').allTextContents();
  const before = await order();

  // Pin the middle note, then force the refresh that used to reorder things.
  await page.getByTestId('note-pin').nth(1).click();
  await page.getByTestId('sync-now').click();
  await page.waitForTimeout(400);

  expect(await order()).toEqual(before);
  await expect(page.getByTestId('note-pin').nth(1)).toHaveClass(/on/);
});

test('a background sync preserves a fresh pin toggle', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('note-pin').click();
  await expect(page.getByTestId('note-pin')).toHaveClass(/on/);
  await page.getByTestId('sync-now').click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('note-pin')).toHaveClass(/on/);
});

test('notes persist across a reload', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Remember me');
  await expect(page.getByTestId('note-title')).toHaveText('Remember me');
  await page.goto('/?local'); // full reload
  await expect(page.getByTestId('note-title')).toHaveText('Remember me');
});

test('a storage layer that fails to load never strands the app on its spinner', async ({
  page,
}) => {
  // A returning Drive user fetches the storage chunk on every launch. When
  // that fetch dies (radio asleep on wake, or a cached page whose chunks are
  // gone after a deploy) the app used to sit on "Loading notes…" forever,
  // with no error and no way out but relaunching by hand.
  await page.addInitScript(() => localStorage.setItem('notezzz:hasAuthed', '1'));
  await page.route('**/driveBackend*', (r) => r.abort());

  await page.goto('/');

  await expect(page.getByTestId('list-loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('sync-error')).toBeVisible();
  await expect(page.getByTestId('reconnect')).toBeVisible();
});

test('a first run leaves welcome notes, and only once', async ({ page }) => {
  // No ?local here: that is the suite's blank-slate bypass. This is the real
  // first-run path a person takes.
  await page.goto('/');
  await page.getByTestId('open-local').click();

  await expect(page.getByTestId('note-item')).toHaveCount(3);
  await expect(page.getByTestId('note-title').first()).toHaveText('Start here');

  // Seeding again on every launch would be the app nagging. (Local mode is
  // not remembered on web, so the gate is part of the relaunch.)
  await page.reload();
  await page.getByTestId('open-local').click();
  await expect(page.getByTestId('note-item')).toHaveCount(3);
});

test('welcome notes are never written over notes that already exist', async ({ page }) => {
  // The dangerous case: an account WITH notes whose first launch on this
  // device is a fresh one. Seeding there would litter the user's Drive.
  await page.goto('/?local');
  await createNote(page);
  await page.getByTestId('title-input').fill('Mine');

  await page.goto('/'); // same storage, but the first-run path
  await page.getByTestId('open-local').click();

  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await expect(page.getByTestId('note-title')).toHaveText('Mine');
});
