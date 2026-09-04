import { test, expect, type Page } from '@playwright/test';

// Start each test on a clean slate: local mode + empty storage.
test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // auto-accept the delete confirm()
  // Keep the suite offline: tests that hit '/' (no ?local) would otherwise
  // pull the real Google Identity Services script. Nothing here needs it --
  // ?local never signs in, and the one test that exercises GIS stubs
  // window.google itself, which makes the loader skip the script tag.
  await page.route('**://accounts.google.com/**', (r) => r.abort());
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

/**
 * Click "Sync now" and wait for the sync to finish. The button carries .busy
 * from the click until the store's sync resolves (plus a short minimum spin),
 * so busy-then-not-busy is a deterministic "the refresh has landed" signal.
 */
async function syncAndSettle(page: Page) {
  const btn = page.getByTestId('sync-now');
  await btn.click();
  await expect(btn).toHaveClass(/busy/);
  await expect(btn).not.toHaveClass(/busy/);
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
  await page.waitForTimeout(1500); // not a UI wait: actually records 1.5s of (fake) audio
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
  for (let i = 0; i < 3; i++) await syncAndSettle(page);

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
  await expect(page.getByTestId('note-title')).toHaveText(['Beta', 'Alpha', 'Gamma']);

  // A sync must not undo it, and neither must a reload.
  await syncAndSettle(page);
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
  await syncAndSettle(page);

  expect(await order()).toEqual(before);
  await expect(page.getByTestId('note-pin').nth(1)).toHaveClass(/on/);
});

test('a background sync preserves a fresh pin toggle', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('note-pin').click();
  await expect(page.getByTestId('note-pin')).toHaveClass(/on/);
  await syncAndSettle(page);
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
  // The store gives storage 20s before it gives up, so this test must outlive
  // the suite's default 20s budget.
  test.setTimeout(45_000);
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

test('the share chooser appears without waiting for storage', async ({ page }) => {
  // Someone sharing from Android wants one question answered. It used to be
  // asked only after sign-in and a full Drive fetch had finished; the chooser
  // needs neither, so a storage layer that never loads must not delay it.
  await page.addInitScript(() => localStorage.setItem('notezzz:hasAuthed', '1'));
  let release: (() => void) | undefined;
  await page.route('**/driveBackend*', async (r) => {
    await new Promise<void>((resolve) => (release = resolve));
    await r.abort();
  });
  await page.evaluate(() => localStorage.setItem('notezzz:pendingShare', 'shared while offline'));

  await page.goto('/');
  await expect(page.getByTestId('share-overlay')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('share-overlay')).toContainText('shared while offline');

  release?.();
});

test('a note created from a share survives the load that lands after it', async ({ page }) => {
  // The write is scheduled before init has a backend. Both the queued save and
  // the list the load returns must leave the shared text intact.
  await page.goto('/?local');
  await page.evaluate(() => localStorage.setItem('notezzz:pendingShare', 'do not lose me'));
  await page.reload();
  await page.getByTestId('share-new').click();

  await expect(page.locator('.ProseMirror')).toContainText('do not lose me');
  await page.goto('/?local'); // reload: it must have actually persisted
  await expect(page.getByTestId('note-title')).toHaveText('do not lose me');
});

test('an edit made elsewhere lands in an editor that is already open', async ({ page }) => {
  // The symptom behind the stale sticky: a window holding a note open must
  // show content that arrived from another device, not just the copy it read
  // when it opened.
  await createNote(page);
  await typeInEditor(page, 'original');
  await expect(page.getByTestId('note-title')).toHaveText('original');
  // Genuine debounce wait with no observable hook: the store's per-note save
  // timer (store.svelte.ts, setTimeout(flush, 400)) must fire so the edit
  // below rewrites the stored note rather than being overwritten by it.
  await page.waitForTimeout(500);

  // Rewrite the note in storage the way a sync from another device would.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!;
    const note = JSON.parse(localStorage.getItem(key)!);
    note.contentHtml = '<p>original</p><p>added from my phone</p>';
    note.updatedAt = Date.now() + 60_000;
    localStorage.setItem(key, JSON.stringify(note));
  });

  await page.getByTestId('sync-now').click();
  await expect(page.locator('.ProseMirror')).toContainText('added from my phone');
});

test('a dead Google session does not flash the sign-in screen over cached notes', async ({
  page,
}) => {
  // Restarting on mobile after the token has aged out: the renewal happens in
  // the background, and when it fails the app used to jump to the full
  // sign-in screen -- over notes it could already show. Sign-in belongs
  // behind a deliberate tap, not in front of the notes.
  await page.addInitScript(() => {
    localStorage.setItem('notezzz:hasAuthed', '1');
    localStorage.setItem('notezzz:tok', JSON.stringify({ t: 'stale', e: Date.now() + 3_600_000 }));
    localStorage.setItem(
      'notezzz:cache:notes',
      JSON.stringify([
        {
          id: 'cached-1',
          title: 'From yesterday',
          contentHtml: '<p>still here</p>',
          paletteId: 'paper',
          fontSize: 18,
          pinned: false,
          opacity: 1,
          win: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ])
    );
  });
  // Stand in for Google Identity Services reporting an interrupted silent
  // renewal -- what actually happens when the session has aged out and
  // background code (no user gesture) asks for a token.
  await page.addInitScript(() => {
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: { error_callback?: (e: unknown) => void }) => ({
            requestAccessToken: () =>
              setTimeout(() => cfg.error_callback?.({ type: 'popup_closed_by_user' }), 10),
          }),
        },
      },
    };
  });
  await page.route('**://www.googleapis.com/**', (r) =>
    r.fulfill({ status: 401, body: '{"error":"invalid_credentials"}' })
  );

  await page.goto('/');

  await expect(page.getByTestId('note-title')).toHaveText('From yesterday');
  await expect(page.getByTestId('open-local')).toBeHidden();
  // The way back is a real tap on Reconnect, which is allowed to be interactive.
  await expect(page.getByTestId('reconnect')).toBeVisible();
});

test('deleting a note right after typing in it does not bring it back', async ({ page }) => {
  // The debounce timer used to outlive the delete: it fired 400ms later,
  // found the note gone, and wrote its captured copy straight back.
  await createNote(page);
  await typeInEditor(page, 'gone');
  await page.getByTestId('note-delete').click();
  await expect(page.getByTestId('note-item')).toHaveCount(0);
  await page.waitForTimeout(700); // the whole window the old timer could fire in
  await page.goto('/?local');
  await expect(page.getByTestId('note-item')).toHaveCount(0);
});

test('a write that fails is kept and retried, never discarded', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('keep me');
  await expect(page.getByTestId('note-title')).toHaveText('keep me');
  await page.waitForTimeout(500); // per-note save debounce

  await page.evaluate(() => localStorage.setItem('notezzz:test:failSaves', '1'));
  await page.getByTestId('title-input').fill('keep me please');
  await expect(page.getByTestId('sync-error')).toBeVisible();

  // A refresh while the write is still owed must not replace the edit with
  // the server's older copy -- that was the "silently discarded" path.
  await syncAndSettle(page);
  await expect(page.getByTestId('note-title')).toHaveText('keep me please');

  // Storage recovers; Reconnect retries everything owed at once.
  await page.evaluate(() => localStorage.removeItem('notezzz:test:failSaves'));
  await page.getByTestId('reconnect').click();
  await expect(page.getByTestId('sync-error')).toBeHidden();
  await page.goto('/?local');
  await expect(page.getByTestId('note-title')).toHaveText('keep me please');
});

test('a write that never landed survives closing the page', async ({ page }) => {
  await createNote(page);
  await page.evaluate(() => localStorage.setItem('notezzz:test:failSaves', '1'));
  await page.getByTestId('title-input').fill('written after restart');
  await expect(page.getByTestId('sync-error')).toBeVisible();

  await page.evaluate(() => localStorage.removeItem('notezzz:test:failSaves'));
  await page.goto('/?local'); // a fresh page load: the queue restores and drains
  await expect(page.getByTestId('note-title')).toHaveText('written after restart');
  await page.goto('/?local'); // and it actually reached storage
  await expect(page.getByTestId('note-title')).toHaveText('written after restart');
});

test('Escape closes the share chooser and focus is not left on a removed node', async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem('notezzz:pendingShare', 'escape me'));
  await page.reload();
  const overlay = page.getByTestId('share-overlay');
  await expect(overlay).toBeVisible();
  // The dialog takes focus on open, so Escape reaches it without a click.
  // (document.activeElement rather than toBeFocused: a freshly reloaded
  // headless page has no window focus yet, which toBeFocused reports as
  // "inactive" even though the element IS the active one.)
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('role')))
    .toBe('dialog');
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  // Focus went back to what had it before (the page itself) — never left on
  // an element that no longer exists.
  expect(await page.evaluate(() => document.activeElement?.isConnected)).toBe(true);
  // The share was discarded, not silently applied.
  await expect(page.getByTestId('note-item')).toHaveCount(0);
});

test('Escape closes the draw pad and returns focus to the button that opened it', async ({
  page,
}) => {
  await createNote(page);
  await page.getByTestId('fmt-draw').click();
  await expect(page.getByTestId('draw-surface')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('draw-surface')).toBeHidden();
  await expect(page.getByTestId('fmt-draw')).toBeFocused();
  await expect(page.locator('.ProseMirror img')).toHaveCount(0);
});

test('sidebar preview decodes HTML entities, and search matches the decoded text', async ({
  page,
}) => {
  await createNote(page);
  await typeInEditor(page, 'Tom & Jerry <3');
  // TipTap stores "&amp;" / "&lt;"; the list must show the real characters,
  // not the escaped source ("Tom &amp; Jerry" was the old preview).
  await expect(page.getByTestId('note-title')).toHaveText('Tom & Jerry <3');
  await page.getByTestId('search-toggle').click();
  await page.getByTestId('search-input').fill('&');
  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await page.getByTestId('search-input').fill('<3');
  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await page.getByTestId('search-input').fill('&amp;');
  await expect(page.getByTestId('note-item')).toHaveCount(0);
});

test('switching notes mid-recording stops the recording cleanly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await createNote(page);
  await page.getByTestId('title-input').fill('First');
  await page.getByTestId('fmt-record').click();
  await expect(page.getByTestId('fmt-record')).toHaveClass(/recording/);
  await page.waitForTimeout(1200); // let the recorder actually run a tick

  // A new note remounts the editor; the old recorder must go with it.
  await page.getByTestId('new-note').click();
  await expect(page.getByTestId('fmt-record')).not.toHaveClass(/recording/);
  await expect(page.getByTestId('fmt-record')).toHaveAttribute('aria-pressed', 'false');
  // Give the orphaned onstop/interval (if any survived) time to misbehave.
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('fmt-record')).not.toHaveClass(/recording/);
  // Nothing was inserted into either note by a stray onstop.
  await expect(page.locator('.ProseMirror .nz-audio')).toHaveCount(0);
  await page.getByTestId('note-pick').filter({ hasText: 'First' }).click();
  await expect(page.locator('.ProseMirror .nz-audio')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('appending a share closes at once and lands on the note', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Target');
  await page.waitForTimeout(500); // per-note save debounce
  await page.evaluate(() => localStorage.setItem('notezzz:pendingShare', 'appended line'));
  await page.reload();
  await page.getByTestId('share-append-item').first().click();
  await expect(page.getByTestId('share-overlay')).toBeHidden();
  await expect(page.locator('.ProseMirror')).toContainText('appended line');
  await page.goto('/?local'); // it reached storage, not just the screen
  await expect(page.locator('.ProseMirror')).toContainText('appended line');
});

test('an append queued while storage is down lands when it recovers', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Target');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    localStorage.setItem('notezzz:pendingShare', 'late arrival');
    localStorage.setItem('notezzz:test:failSaves', '1');
  });
  await page.reload();
  await page.getByTestId('share-append-item').first().click();
  await expect(page.getByTestId('share-overlay')).toBeHidden();
  await expect(page.getByTestId('sync-error')).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('notezzz:test:failSaves'));
  await page.goto('/?local'); // queue restores and drains on the next launch
  await expect(page.locator('.ProseMirror')).toContainText('late arrival');
});
