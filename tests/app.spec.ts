import { readFileSync } from 'node:fs';
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

/** Open an entry of the note's ⋯ menu (the same on every screen). */
async function menu(page: Page, item: 'color' | 'size' | 'opacity' | 'remind' | 'archive' | 'delete') {
  await page.getByTestId('note-more').click();
  await page.getByTestId(`menu-${item}`).click();
}

/** Delete the open note the way the app offers it: archive it, open it
 *  from the archive, delete it forever there. */
async function archiveAndDelete(page: Page) {
  await menu(page, 'archive');
  await page.getByTestId('archive-toggle').click();
  await page.getByTestId('note-pick').first().click();
  await menu(page, 'delete');
}

async function typeInEditor(page: Page, text: string) {
  const pm = page.locator('.ProseMirror');
  await pm.click();
  await pm.pressSequentially(text);
}

/**
 * Run a sync and wait for it to land. The app has no sync button any more
 * (it syncs by itself); the dev build exposes store.syncNow for tests, and
 * awaiting it is a deterministic "the refresh has landed" signal.
 */
async function syncAndSettle(page: Page) {
  await page.evaluate(() => (window as unknown as { __nzSyncNow: () => Promise<void> }).__nzSyncNow());
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
  await menu(page, 'color'); // open the color popover
  await page.locator('[data-testid="palette-chip"][data-palette="sky"]').click();
  await expect(pane).toHaveAttribute('data-palette', 'sky');
  // Sky bg (#C2D9F0) actually paints:
  await expect(pane).toHaveCSS('background-color', 'rgb(194, 217, 240)');
  // And the sidebar swatch recolors too:
  await expect(page.getByTestId('note-swatch')).toHaveCSS('background-color', 'rgb(194, 217, 240)');
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
  await menu(page, 'color');
  await page.getByTestId('custom-toggle').click();
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
  await menu(page, 'size');
  // A new note starts at 22, on a slider that stands upright.
  await expect(page.getByTestId('size-value')).toHaveText('22');
  const box = (await page.getByTestId('size-slider').boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width * 3);
  await page.getByTestId('size-slider').fill('28');
  await expect(page.getByTestId('size-value')).toHaveText('28');
  await page.getByTestId('note-more').click();
  await expect(page.getByTestId('menu-size')).toContainText('28');
});

test('an account still on the old default text size moves to 22, once', async ({ page }) => {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes('settings')) ?? 'notezzz:settings';
    const cur = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...cur, defaultFontSize: 18, settingsVersion: 1 }));
  });
  await page.reload();
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('set-fontsize')).toHaveValue('22');
  // A size someone picked themselves is left alone.
  await page.getByTestId('set-fontsize').fill('30');
  await page.getByTestId('set-fontsize').press('Tab');
  await page.reload();
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('set-fontsize')).toHaveValue('30');
});

test('delete is only offered in the archive', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('note-more').click();
  await expect(page.getByTestId('menu-archive')).toBeVisible();
  await expect(page.getByTestId('menu-delete')).toHaveCount(0);
  await page.getByTestId('menu-archive').click();
  await page.getByTestId('archive-toggle').click();
  await page.getByTestId('note-pick').first().click();
  await page.getByTestId('note-more').click();
  await expect(page.getByTestId('menu-delete')).toHaveText('Delete forever');
});

test('the desktop header is the phone header: title, pin, ⋯', async ({ page }) => {
  await createNote(page);
  for (const gone of ['note-color', 'tools-toggle', 'note-archive', 'note-delete', 'note-remind']) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  const more = (await page.getByTestId('note-more').boundingBox())!;
  await page.getByTestId('note-more').click();
  const box = (await page.getByTestId('note-menu').boundingBox())!;
  expect(Math.round(box.x + box.width)).toBe(Math.round(more.x + more.width));
  // It clears the bar by the same distance the button keeps from the bar's top.
  const bar = (await page.locator('.topbar').boundingBox())!;
  expect(Math.abs(box.y - (bar.y + bar.height) - (more.y - bar.y))).toBeLessThan(1);
});

test('the formatting toolbar sits at the bottom of the note, on the desktop too', async ({ page }) => {
  await createNote(page);
  const bar = (await page.getByTestId('fmt-bold').boundingBox())!;
  const text = (await page.locator('.ProseMirror').boundingBox())!;
  expect(bar.y).toBeGreaterThan(text.y);
});

test('a pinned note on the desktop has its own transparency control', async ({ page }) => {
  await createNote(page);
  await page.waitForTimeout(500); // per-note save debounce
  const id = await page.evaluate(
    () => Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!.slice('notezzz:note:'.length)
  );
  await page.goto(`/sticky?id=${id}`);
  await page.getByTestId('sticky-more').click(); // transparency lives in the sticky's ⋯, as on the note
  await page.getByTestId('sticky-opacity').click();
  const slider = page.getByTestId('sticky-opacity-slider');
  await expect(slider).toBeVisible();
  const b = (await slider.boundingBox())!;
  expect(b.height).toBeGreaterThan(b.width * 3); // upright
  await slider.fill('50');
  await page.waitForTimeout(600);
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(`notezzz:note:${k}`)!).opacity, id);
  expect(saved).toBe(0.5);
});

test('corners are concentric: a sticky hugs its corner buttons, the ⋯ menu its items', async ({ page }) => {
  await createNote(page);
  await page.waitForTimeout(500);
  const id = await page.evaluate(
    () => Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!.slice('notezzz:note:'.length)
  );
  const radius = (sel: string) =>
    page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).borderBottomLeftRadius));
  for (const width of [300, 420]) {
    await page.setViewportSize({ width, height: 400 });
    await page.goto(`/sticky?id=${id}`);
    const card = (await page.locator('.sticky').boundingBox())!;
    const btn = (await page.getByTestId('fmt-bold').boundingBox())!;
    const side = btn.x - card.x;
    const bottom = card.y + card.height - (btn.y + btn.height);
    expect(Math.abs(side - bottom), `width ${width}`).toBeLessThan(1);
    expect(Math.abs((await radius('.sticky')) - ((await radius('[data-testid="fmt-bold"]')) + side))).toBeLessThan(1);
  }
  // The same rule for a balloon that holds buttons.
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto('/?local');
  await page.getByTestId('note-item').first().click();
  await page.getByTestId('note-more').click();
  const menu = (await page.getByTestId('note-menu').boundingBox())!;
  const item = (await page.getByTestId('menu-color').boundingBox())!;
  const inset = item.x - menu.x - 1; // inside the 1px border
  const outer = await radius('[data-testid="note-menu"]');
  const inner = await radius('[data-testid="menu-color"]');
  expect(Math.abs(outer - (inner + inset + 1))).toBeLessThan(1.5);
  // Balloons: a short, tight shadow (no blur over 8px).
  const shadow = await page.getByTestId('note-menu').evaluate((el) => getComputedStyle(el).boxShadow);
  const blurs = [...shadow.matchAll(/(-?\d+(?:\.\d+)?)px (-?\d+(?:\.\d+)?)px (\d+(?:\.\d+)?)px/g)].map((m) => +m[3]);
  expect(Math.max(...blurs)).toBeLessThanOrEqual(8);
});

test('buttons have no outline', async ({ page }) => {
  for (const id of ['search-toggle', 'open-settings', 'new-note']) {
    const w = await page.getByTestId(id).evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(w, id).toBe('0px');
  }
});

test('the note header buttons match the formatting toolbar', async ({ page }) => {
  await createNote(page);
  const top = page.getByTestId('pane-pin');
  const bottom = page.getByTestId('fmt-bold');
  const [t, b] = await Promise.all([top.boundingBox(), bottom.boundingBox()]);
  expect(Math.round(t!.height)).toBe(Math.round(b!.height));
  expect(Math.round(t!.width)).toBe(Math.round(t!.height)); // square, not a rectangle
  expect(Math.round(b!.width)).toBe(Math.round(b!.height));
  const look = (l: typeof top) => l.evaluate((el) => {
    const cs = getComputedStyle(el);
    return `${cs.opacity} ${cs.color}`;
  });
  expect(await look(top)).toBe(await look(bottom));
});

test('opacity control is desktop-only (hidden on web)', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('pane-pin').click();
  await menu(page, 'size');
  await expect(page.getByTestId('size-slider')).toBeVisible();
  await expect(page.getByTestId('opacity-slider')).toHaveCount(0);
  await page.getByTestId('note-more').click();
  await expect(page.getByTestId('menu-opacity')).toHaveCount(0);
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
  await archiveAndDelete(page);
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
  await page.getByTestId('set-theme').locator('[data-value="dark"]').click();
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
    const more = (await page.getByTestId('note-more').boundingBox())!;
    // The last button sits inside the pane, never clipped.
    expect(more.x + more.width).toBeLessThanOrEqual(pane.x + pane.width);
  });

  test('the title keeps its room: the other actions live in the ⋯ menu', async ({ page }) => {
    await page.getByTestId('new-note').click();
    const title = (await page.getByTestId('title-input').boundingBox())!;
    expect(title.width).toBeGreaterThan(200); // was ~40px with seven buttons
    await expect(page.getByTestId('note-color')).toHaveCount(0);
    await expect(page.getByTestId('note-archive')).toHaveCount(0);
    await page.getByTestId('note-more').click();
    const menu = page.getByTestId('note-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('menu-delete')).toHaveCount(0); // not outside the archive
    // A panel opened from the menu replaces it.
    await page.getByTestId('menu-size').click();
    await expect(page.getByTestId('note-menu')).toHaveCount(0);
    await expect(page.getByTestId('size-value')).toHaveText('22');
    await page.getByTestId('size-slider').fill('30');
    await expect(page.getByTestId('size-value')).toHaveText('30');
    await page.getByTestId('note-more').click();
    await page.getByTestId('menu-color').click();
    await expect(page.getByTestId('note-menu')).toHaveCount(0);
    await expect(page.locator('.palmenu')).toBeVisible();
  });

  test('archiving in fullscreen returns to the split view', async ({ page }) => {
    await page.getByTestId('new-note').click();
    await page.getByTestId('note-fullscreen').click();
    await page.getByTestId('note-more').click();
    await page.getByTestId('menu-archive').click();
    await expect(page.getByTestId('new-note')).toBeVisible();
    await expect(page.getByTestId('note-item')).toHaveCount(0);
  });

  test('delete forever, from the archive, through the menu', async ({ page }) => {
    await page.getByTestId('new-note').click();
    await page.getByTestId('note-more').click();
    await page.getByTestId('menu-archive').click();
    await page.getByTestId('archive-toggle').click();
    await page.getByTestId('note-pick').first().click();
    await page.getByTestId('note-more').click();
    await page.getByTestId('menu-delete').click();
    await expect(page.getByTestId('note-item')).toHaveCount(0);
    await expect(page.getByTestId('archive-toggle')).toHaveCount(0);
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
  // In the logo's colours, in its order: blue, yellow, pink.
  const fills = await page.getByTestId('note-fill').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(fills).toEqual(['rgb(155, 235, 255)', 'rgb(255, 246, 168)', 'rgb(255, 106, 213)']);

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

  await syncAndSettle(page);
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

test('a Google sign-in without the Drive permission is refused, then accepted once granted', async ({
  page,
}) => {
  // Google lists permissions as checkboxes when an app asks for several; a
  // friend left Drive unticked, "signed in", and every Drive call failed with
  // a raw 403. The app asks for Drive alone now, and still checks the grant.
  await page.addInitScript(() => {
    const w = window as unknown as { google: unknown; __grants: string[]; __prompts: string[] };
    w.__grants = ['openid email', 'https://www.googleapis.com/auth/drive.file'];
    w.__prompts = [];
    w.google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: { scope: string }) => {
            const client = {
              scope: cfg.scope,
              callback: (_r: unknown) => {},
              requestAccessToken(opts?: { prompt?: string }) {
                w.__prompts.push(opts?.prompt ?? '');
                const scope = w.__grants.shift() ?? '';
                setTimeout(() => client.callback({ access_token: 'tok-' + scope.length, expires_in: 3600, scope }), 10);
              },
            };
            (window as unknown as { __client: unknown }).__client = client;
            return client;
          },
        },
      },
    };
  });
  // Drive, once reached, holds an empty account.
  await page.route('**://www.googleapis.com/**', (r) => {
    const url = r.request().url();
    if (url.includes('/about')) return r.fulfill({ json: { user: { emailAddress: 'friend@example.com' } } });
    if (r.request().method() === 'GET') return r.fulfill({ json: { files: [] } });
    return r.fulfill({ json: { id: 'f' + Math.random().toString(36).slice(2), modifiedTime: new Date().toISOString() } });
  });
  await page.goto('/');

  // The app asks Google for Drive and nothing else.
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  expect(await page.evaluate(() => (window as unknown as { __client: { scope: string } }).__client.scope)).toBe(
    'https://www.googleapis.com/auth/drive.file'
  );
  // First answer: signed in, but without Drive. Refused, in plain words.
  await expect(page.getByText("Google didn't give NotezZz access to Google Drive")).toBeVisible();
  await expect(page.getByTestId('open-local')).toBeVisible(); // still at the gate
  expect(await page.evaluate(() => localStorage.getItem('notezzz:hasAuthed'))).toBeNull();

  // Second answer grants Drive: past the gate. Both attempts showed Google's
  // consent screen, since the refused one wasn't remembered as a sign-in.
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.getByTestId('open-local')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('notezzz:hasAuthed'))).toBe('1');
  expect(await page.evaluate(() => (window as unknown as { __prompts: string[] }).__prompts)).toEqual([
    'consent',
    'consent',
  ]);
});

test('Drive refusing a token that lacks the Drive permission shows a plain message and Reconnect', async ({
  page,
}) => {
  // A sign-in from before the fix: the token works, but carries no Drive.
  await page.addInitScript(() => {
    localStorage.setItem('notezzz:hasAuthed', '1');
    localStorage.setItem('notezzz:tok', JSON.stringify({ t: 'no-drive', e: Date.now() + 3_600_000 }));
  });
  await page.route('**://www.googleapis.com/**', (r) =>
    r.fulfill({
      status: 403,
      body: JSON.stringify({
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      }),
    })
  );
  await page.goto('/');

  await expect(page.getByTestId('sync-error')).toContainText("Google didn't give NotezZz access to Google Drive");
  await expect(page.getByTestId('sync-error')).not.toContainText('PERMISSION_DENIED');
  await expect(page.getByTestId('reconnect')).toBeVisible();
  // The useless grant is forgotten, so Reconnect shows Google's screen again.
  expect(await page.evaluate(() => localStorage.getItem('notezzz:tok'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('notezzz:hasAuthed'))).toBeNull();
});

test('deleting a note right after typing in it does not bring it back', async ({ page }) => {
  // The debounce timer used to outlive the delete: it fired 400ms later,
  // found the note gone, and wrote its captured copy straight back.
  await createNote(page);
  await typeInEditor(page, 'gone');
  await archiveAndDelete(page);
  await expect(page.getByTestId('note-item')).toHaveCount(0);
  await expect(page.getByTestId('archive-toggle')).toHaveCount(0);
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

test('a pixel pattern paints the title bar and the selected row', async ({ page }) => {
  await createNote(page);
  await menu(page, 'color');
  await expect(page.locator('[data-testid="palette-chip"][data-palette^="pattern:"]')).toHaveCount(5);
  await page.locator('[data-testid="palette-chip"][data-palette="pattern:checker"]').click();

  const pane = page.getByTestId('note-pane');
  await expect(pane).toHaveAttribute('data-palette', 'pattern:checker');
  // The body stays flat; the pattern lives on the title bar...
  const topbar = pane.locator('.topbar');
  await expect(topbar).toHaveClass(/nz-pat-checker/);
  expect(await topbar.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('conic-gradient');
  expect(await topbar.evaluate((el) => getComputedStyle(el).animationName)).toBe('nz-drift-diag');
  // ...and on the note's row in the list, which is selected right now: its
  // fill (the full row while selected) is the pattern.
  const row = page.getByTestId('note-item').first();
  await expect(row).toHaveClass(/active/);
  expect(await row.getByTestId('note-fill').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('conic-gradient');
  // Retired palette ids still open (they fall back to Paper).
  await page.waitForTimeout(500); // let the debounced save land before rewriting storage
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!;
    const n = JSON.parse(localStorage.getItem(key)!);
    n.paletteId = 'mint';
    localStorage.setItem(key, JSON.stringify(n));
  });
  await page.goto('/?local');
  await expect(page.getByTestId('note-pane')).toHaveCSS('background-color', 'rgb(251, 250, 246)');
});

/**
 * Read a store-only ZIP (what src/lib/zip.ts writes): walk the local headers,
 * hand back each entry's name and text, and check every CRC on the way, so
 * the test proves the archive is well-formed rather than merely PK-prefixed.
 */
function readStoredZip(buf: Buffer): { name: string; text: string }[] {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const entries: { name: string; text: string }[] = [];
  let pos = 0;
  while (buf.readUInt32LE(pos) === 0x04034b50) {
    const crc = buf.readUInt32LE(pos + 14);
    const size = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.subarray(pos + 30, pos + 30 + nameLen).toString('utf8');
    const start = pos + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + size);
    expect(crc32(data), `crc of ${name}`).toBe(crc);
    entries.push({ name, text: data.toString('utf8') });
    pos = start + size;
  }
  // The central directory follows, then the end record names the count.
  expect(buf.readUInt32LE(pos)).toBe(0x02014b50);
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  expect(buf.readUInt16LE(end + 10)).toBe(entries.length);
  return entries;
}

test('export: downloads a ZIP with every note as JSON and Markdown', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Groceries');
  await typeInEditor(page, 'buy milk');
  await page.locator('.ProseMirror').press('ControlOrMeta+a');
  await page.getByTestId('fmt-bold').click();
  await page.getByTestId('new-note').click();
  await page.getByTestId('title-input').fill('Work plan');
  await expect(page.getByTestId('note-item')).toHaveCount(2);

  await page.getByTestId('open-settings').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-all').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^notezzz-export-\d{4}-\d{2}-\d{2}\.zip$/);

  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  const entries = readStoredZip(bytes);
  const names = entries.map((e) => e.name).sort();
  expect(names).toHaveLength(5); // 2 raw + 2 markdown + settings
  expect(names).toContain('settings.json');
  expect(names).toContain('markdown/Groceries.md');
  expect(names).toContain('markdown/Work plan.md');
  expect(names.filter((n) => /^notes\/[0-9a-f]+\.json$/.test(n))).toHaveLength(2);

  // Markdown: title as the heading, formatting carried over.
  const md = entries.find((e) => e.name === 'markdown/Groceries.md')!.text;
  expect(md).toContain('# Groceries');
  expect(md).toContain('**buy milk**');
  // Raw JSON is the note as stored.
  const raw = entries.filter((e) => e.name.startsWith('notes/')).map((e) => JSON.parse(e.text));
  expect(raw.map((n) => n.title).sort()).toEqual(['Groceries', 'Work plan']);
  expect(JSON.parse(entries.find((e) => e.name === 'settings.json')!.text)).toHaveProperty('appTheme');
});

test('settings: the new-sticky shortcut is off by default and sticks when enabled', async ({ page }) => {
  await page.getByTestId('open-settings').click();
  await expect(page.getByRole('dialog')).toContainText('Ctrl+Alt+N');
  const box = page.getByTestId('hotkey-newnote');
  await expect(box).not.toBeChecked(); // a global shortcut is opt-in
  await box.check();
  await expect(box).toBeChecked();

  // A setting, not a session flag: it survives a relaunch.
  await page.goto('/?local');
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('hotkey-newnote')).toBeChecked();
});

test('settings: the note list can move above the note, in columns', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('set-layout').locator('[data-value="top"]').click();
  await page.getByTestId('set-columns').selectOption('3');
  await page.getByTestId('settings-close').click();

  const app = page.locator('main.app');
  await expect(app).toHaveClass(/stacked/);
  expect(await page.locator('.list').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);

  // It is a setting: back to the side layout and it stays.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('set-layout').locator('[data-value="side"]').click();
  await page.getByTestId('settings-close').click();
  await expect(app).not.toHaveClass(/stacked/);
});

test('a sticky can be renamed in place with a double-click on its title', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Before');
  await page.waitForTimeout(500); // per-note save debounce
  const id = await page.evaluate(
    () => Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!.slice('notezzz:note:'.length)
  );
  await page.goto(`/sticky?id=${id}`);
  await page.getByTestId('sticky-title').dblclick();
  await page.getByTestId('sticky-title-input').fill('After');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sticky-title')).toHaveText('After');
  await page.waitForTimeout(500);
  await page.goto('/?local');
  await expect(page.getByTestId('note-title')).toHaveText('After');
});

test('a custom colour can be saved to a slot and reset from Settings', async ({ page }) => {
  await createNote(page);
  await menu(page, 'color');
  await page.getByTestId('custom-toggle').click();
  await page.getByTestId('custom-hue').fill('120');
  await expect(page.getByTestId('note-pane')).toHaveAttribute('data-palette', /custom:#/);
  await page.getByTestId('save-color').click();
  await expect(page.getByTestId('saved-color')).toHaveCount(1);
  const hex = await page.getByTestId('saved-color').getAttribute('data-hex');
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);

  await page.getByTestId('open-settings').click();
  await page.getByTestId('reset-colors').click();
  await page.getByTestId('settings-close').click();
  await menu(page, 'color');
  await expect(page.getByTestId('saved-color')).toHaveCount(0);
});

test('a painted pattern lands in a slot, styles the note, and survives a reload', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Painted');
  await menu(page, 'color');
  await expect(page.getByTestId('pattern-empty')).toHaveCount(5);
  await page.getByTestId('pattern-empty').first().click();
  await expect(page.getByTestId('pattern-editor')).toBeVisible();
  const cells = page.getByTestId('pat-cell');
  await cells.nth(0).click();
  await cells.nth(9).click();
  await cells.nth(18).click();
  await page.getByTestId('pat-save').click();
  await expect(page.getByTestId('pattern-editor')).toBeHidden();

  const pane = page.getByTestId('note-pane');
  await expect(pane).toHaveAttribute('data-palette', 'upat:0');
  const topbar = pane.locator('.topbar');
  await expect(topbar).toHaveClass(/nz-pat-custom/);
  expect(await topbar.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('data:image/svg+xml');
  expect(await topbar.evaluate((el) => getComputedStyle(el).animationName)).toBe('nz-drift-diag16');

  await page.waitForTimeout(500); // per-note save debounce
  await page.goto('/?local');
  await expect(page.getByTestId('note-pane')).toHaveAttribute('data-palette', 'upat:0');
  await menu(page, 'color');
  await expect(page.getByTestId('pattern-empty')).toHaveCount(4);
});

test('auto list columns: one column while the notes fit, more as the list fills', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const seed = (count: number) =>
    page.evaluate((n) => {
      for (let i = 0; i < n; i++) {
        const id = `seed${i}`;
        const now = Date.now() - i * 1000;
        localStorage.setItem(
          `notezzz:note:${id}`,
          JSON.stringify({
            id, title: `Note ${i}`, contentHtml: '', paletteId: 'paper', fontSize: 18,
            pinned: false, opacity: 1, win: null, createdAt: now, updatedAt: now,
          })
        );
      }
    }, count);
  const cols = () =>
    page.locator('.list').evaluate((el) => {
      const t = getComputedStyle(el).gridTemplateColumns;
      return t === 'none' ? 1 : t.split(' ').length;
    });

  // Defaults: list above the note, automatic columns.
  await seed(2);
  await page.reload();
  await expect(page.locator('main.app')).toHaveClass(/stacked/);
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  expect(await cols()).toBe(1);

  await seed(40);
  await page.reload();
  await expect(page.getByTestId('note-item')).toHaveCount(40);
  await expect.poll(cols).toBe(3);
});

test('checklists: toggle from the toolbar, tick an item, and it survives a reload', async ({ page }) => {
  await createNote(page);
  await page.locator('.ProseMirror').click();
  await page.getByTestId('fmt-checklist').click();
  await page.keyboard.type('milk');
  await page.keyboard.press('Enter');
  await page.keyboard.type('bread');
  const items = page.locator('.ProseMirror ul[data-type="taskList"] > li');
  await expect(items).toHaveCount(2);
  await items.first().locator('input[type="checkbox"]').check();
  await expect(items.first()).toHaveAttribute('data-checked', 'true');
  await page.waitForTimeout(600); // the note's save debounce (400ms) has no observable hook
  await page.reload();
  await page.getByTestId('note-pick').first().click();
  await expect(page.locator('.ProseMirror ul[data-type="taskList"] > li').first()).toHaveAttribute('data-checked', 'true');
  await expect(page.locator('.ProseMirror ul[data-type="taskList"] > li').nth(1)).toHaveAttribute('data-checked', 'false');
});

test('archive: a note leaves the list, waits in the archive, and comes back', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Keep');
  await page.getByTestId('new-note').click();
  await page.getByTestId('title-input').fill('Old idea');
  await menu(page, 'archive');

  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await expect(page.getByTestId('note-title')).toHaveText('Keep');
  await expect(page.getByTestId('archive-toggle')).toHaveText(/Archive \(1\)/);

  // Search still finds it.
  await page.getByTestId('search-toggle').click();
  await page.getByTestId('search-input').fill('old');
  await expect(page.getByTestId('note-title')).toHaveText('Old idea');
  await page.getByTestId('search-toggle').click();

  await page.getByTestId('archive-toggle').click();
  await expect(page.getByTestId('note-title')).toHaveText('Old idea');
  await page.getByTestId('note-pick').click();
  await menu(page, 'archive');

  // Last one restored: back in the list, the archive entry gone.
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  await expect(page.getByTestId('archive-toggle')).toHaveCount(0);
});

test('Ctrl+K jumps to a note by typing part of it', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Groceries');
  await page.getByTestId('new-note').click();
  await page.getByTestId('title-input').fill('Work plan');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('switcher-input')).toBeFocused();
  await page.keyboard.type('groc');
  await expect(page.getByTestId('switcher-item')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('switcher')).toHaveCount(0);
  await expect(page.getByTestId('title-input')).toHaveValue('Groceries');
});

test('share intake: a shared photo lands in the new note', async ({ page }) => {
  // 1x1 PNG, as the Android app would hand it over after downscaling.
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await page.evaluate(
    (src) =>
      localStorage.setItem(
        'notezzz:pendingShare',
        JSON.stringify({ nzShare: 1, text: 'from the gallery', images: [src] })
      ),
    png
  );
  await page.reload();
  await expect(page.getByTestId('share-overlay')).toBeVisible();
  await expect(page.locator('#share-title')).toHaveText('Add shared image');
  await expect(page.getByTestId('share-images').locator('img')).toHaveCount(1);
  await page.getByTestId('share-new').click();
  await expect(page.locator('.ProseMirror')).toContainText('from the gallery');
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
});

test('reminders: set one from the note, see when, clear it', async ({ page }) => {
  await createNote(page);
  await menu(page, 'remind');
  await expect(page.getByTestId('remind-pop')).toBeVisible();
  await page.getByTestId('remind-quick').filter({ hasText: 'Tomorrow 9:00' }).click();
  await expect(page.getByTestId('remind-pop')).toHaveCount(0);
  await expect(page.getByTestId('note-remind')).toHaveClass(/(^|\s)on(\s|$)/);

  await page.getByTestId('note-remind').click();
  await expect(page.getByTestId('remind-when')).toContainText(/9:00|09:00/);
  await page.getByTestId('remind-clear').click();
  await expect(page.getByTestId('note-remind')).toHaveCount(0);
});

test('reminders: a due reminder pins its note once and clears itself', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Call the dentist');
  await page.waitForTimeout(600); // save debounce
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!;
    const note = JSON.parse(localStorage.getItem(key)!);
    note.remindAt = Date.now() - 1000;
    note.updatedAt = Date.now() + 60_000;
    localStorage.setItem(key, JSON.stringify(note));
  });
  await syncAndSettle(page);
  await expect(page.getByTestId('note-remind')).toHaveClass(/(^|\s)on(\s|$)/);
  await page.evaluate(() => (window as unknown as { __nzFireReminders: () => void }).__nzFireReminders());
  await expect(page.getByTestId('note-pin')).toHaveClass(/(^|\s)on(\s|$)/);
  await expect(page.getByTestId('note-remind')).toHaveCount(0);
});

test('archive: Undo on the floating button brings the note straight back', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Keep');
  await page.getByTestId('new-note').click();
  await page.getByTestId('title-input').fill('Oops');
  await menu(page, 'archive');
  await expect(page.getByTestId('undo-toast')).toContainText('Oops');
  await expect(page.getByTestId('note-item')).toHaveCount(1);
  await page.getByTestId('undo-archive').click();
  await expect(page.getByTestId('undo-toast')).toHaveCount(0);
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  await expect(page.getByTestId('title-input')).toHaveValue('Oops');
  await expect(page.getByTestId('archive-toggle')).toHaveCount(0);
});

test.describe('touch phone', () => {
  test.use({ viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('pinching a note you are typing in does not jump back to the cursor', async ({ page }) => {
    // The keep-the-caret-in-view handler ran on every visual-viewport resize,
    // and a pinch is one: each pinch step scrolled the note back to the
    // cursor, so zooming and scrolling a focused note "stopped working".
    await page.getByTestId('new-note').click();
    const pm = page.locator('.ProseMirror');
    await pm.click();
    for (let i = 0; i < 50; i++) await pm.pressSequentially(`line ${i}\n`);
    const scroller = page.locator('.editorWrap .content');
    await scroller.evaluate((el) => (el.scrollTop = 0)); // caret stays at the end
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizePinchGesture', {
      x: 200, y: 600, scaleFactor: 1.6, relativeSpeed: 400, gestureSourceType: 'default',
    });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => visualViewport!.scale)).toBeGreaterThan(1.3);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(40);
  });
});

test.describe("phone: the logo's design rules", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  test('every button is the same rounded square, 2px from its neighbour', async ({ page }) => {
    await page.getByTestId('new-note').click();
    await page.getByTestId('pane-pin').click(); // brings the tuck button into the bar
    const ids = ['pane-pin', 'pane-tuck', 'note-more', 'fmt-bold', 'fmt-record', 'new-note', 'search-toggle'];
    const boxes = await Promise.all(ids.map((id) => page.getByTestId(id).boundingBox()));
    const w = Math.round(boxes[0]!.width);
    for (const [i, b] of boxes.entries()) {
      expect(Math.round(b!.width), ids[i]).toBe(w);
      expect(Math.round(b!.height), ids[i]).toBe(w);
    }
    // 2px apart in the header.
    const [pin, tuck, more] = boxes;
    expect(Math.round(tuck!.x - (pin!.x + pin!.width))).toBe(2);
    expect(Math.round(more!.x - (tuck!.x + tuck!.width))).toBe(2);
    // Corners rounded like the logo's squares: 23.5% of the side.
    const radius = await page.getByTestId('pane-pin').evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    expect(radius / w).toBeGreaterThan(0.2);
    expect(radius / w).toBeLessThan(0.27);
    // The toolbar's buttons spread over the row: the mic ends the edge (6px)
    // in from the screen's right, like the note's ⋯ and the header's +.
    const mic = boxes[4]!;
    expect(Math.round(400 - (mic.x + mic.width))).toBe(6);
  });

  test('the ⋯ menu lines up with the right edge of its button', async ({ page }) => {
    await page.getByTestId('new-note').click();
    await page.getByTestId('note-more').click();
    const more = (await page.getByTestId('note-more').boundingBox())!;
    const menu = (await page.getByTestId('note-menu').boundingBox())!;
    expect(Math.round(menu.x + menu.width)).toBe(Math.round(more.x + more.width));
    const bar = (await page.locator('.topbar').boundingBox())!;
    expect(Math.abs(menu.y - (bar.y + bar.height) - (more.y - bar.y))).toBeLessThan(1);
    await expect(page.getByTestId('menu-tuck')).toHaveCount(0); // tuck is in the bar, not here
  });

  test("the text-size sticker is three buttons wide: white, the slider in the note's colour", async ({ page }) => {
    await page.getByTestId('new-note').click();
    await page.getByTestId('note-more').click();
    await page.getByTestId('menu-size').click();
    const panel = page.locator('.sizepanel');
    const box = (await panel.boundingBox())!;
    const btn = (await page.getByTestId('note-more').boundingBox())!;
    expect(Math.round(box.width)).toBe(Math.round(btn.width * 3 + 4));
    expect(Math.round(box.x + box.width)).toBe(Math.round(btn.x + btn.width));
    expect(box.height).toBeLessThan(200);
    expect(await panel.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    // The number and the slider in the note's colour, deep enough to read on
    // white (Paper is near white, so it is deepened towards its ink).
    const ink = await page.getByTestId('size-value').evaluate((el) => getComputedStyle(el).color);
    const lum = await page.evaluate((c) => {
      const [r, g, b] = c.match(/\d+/g)!.map(Number).map((v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }, ink);
    expect(lum).toBeLessThanOrEqual(0.31);
    // The slider sits in the middle of it.
    const slider = (await page.getByTestId('size-slider').boundingBox())!;
    expect(Math.abs(slider.x + slider.width / 2 - (box.x + box.width / 2))).toBeLessThan(2);
  });
});

test.describe('themes', () => {
  const rootVar = (page: Page, name: string) =>
    page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

  test('Daylight is the default look; Flat takes the light, shade and grain away', async ({ page }) => {
    await createNote(page);
    const pane = page.getByTestId('note-pane');
    const image = () => pane.evaluate((el) => getComputedStyle(el).backgroundImage);
    // Halves of one very wide ellipse centred on the note: the shade on top…
    expect(await image()).toContain('radial-gradient(350% 100% at 50% 100%');
    // The grain is a layer of its own above both, so it dithers them.
    const grain = () => pane.evaluate((el) => getComputedStyle(el, '::after').backgroundImage);
    expect(await grain()).toContain('data:image/svg+xml');
    // The light from below is ADDED (plus-lighter), on a layer of its own,
    // reaching 60% up the note.
    const light = await pane.evaluate((el) => {
      const cs = getComputedStyle(el, '::before');
      return { blend: cs.mixBlendMode, image: cs.backgroundImage };
    });
    expect(light.blend).toBe('plus-lighter');
    expect(light.image).toContain('radial-gradient(350% 100% at 50% 0%'); // …the light below
    expect(await rootVar(page, '--note-header-mix')).toBe('7.5%');
    expect(await rootVar(page, '--note-chin-mix')).toBe('0%');
    // The adhesive strip under the title darkens it.
    const strip = await page.locator('.topbar').evaluate((el) => getComputedStyle(el).boxShadow);
    expect(strip).toContain('inset');
    await page.getByTestId('open-settings').click();
    await page.getByTestId('theme-pick').filter({ hasText: 'Flat' }).click();
    await page.getByTestId('settings-close').click();
    expect(await image()).toBe('none, none'); // no shade, no wear
    expect(await grain()).toBe('none');
    expect(await rootVar(page, '--note-header-mix')).toBe('100%');
  });

  test('a shared theme comes in as JSON, applies, goes back out, and can be removed', async ({ page }) => {
    await page.getByTestId('open-settings').click();
    await page.getByTestId('theme-import-toggle').click();
    await page.getByTestId('theme-json').fill(
      JSON.stringify({
        format: 'notezzz-theme',
        version: 1,
        name: 'Dusk',
        note: { shade: { color: '#203040', strength: 0.3, reach: 0.5 }, header: 0.5, toolbar: 0.2 },
        buttons: { corner: 0.5, edge: 8, gap: 4 },
      })
    );
    await page.getByTestId('theme-add').click();
    await expect(page.getByTestId('theme-pick').filter({ hasText: 'Dusk' })).toHaveAttribute('aria-pressed', 'true');
    expect(await rootVar(page, '--note-header-mix')).toBe('50%');
    expect(await rootVar(page, '--edge')).toBe('8px');
    expect(await rootVar(page, '--note-shade')).toContain('rgba(32, 48, 64, 0.3');
    // It travels with the settings (and so to every device).
    const saved = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.includes('settings'))!;
      return JSON.parse(localStorage.getItem(key)!).themes?.map((t: { name: string }) => t.name);
    });
    expect(saved).toContain('Dusk');
    await page.getByTestId('theme-delete').click();
    await expect(page.getByTestId('theme-pick').filter({ hasText: 'Dusk' })).toHaveCount(0);
    await expect(page.getByTestId('theme-pick').filter({ hasText: 'Daylight' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a theme that is not one is refused in plain words', async ({ page }) => {
    await page.getByTestId('open-settings').click();
    await page.getByTestId('theme-import-toggle').click();
    await page.getByTestId('theme-json').fill('not json at all');
    await page.getByTestId('theme-add').click();
    await expect(page.getByTestId('theme-error')).toHaveText("That isn't a theme: it isn't valid JSON.");
    await page.getByTestId('theme-json').fill('{"format":"other-app","note":{}}');
    await page.getByTestId('theme-add').click();
    await expect(page.getByTestId('theme-error')).toHaveText("That isn't a NotezZz theme.");
    await page.getByTestId('theme-json').fill('{"format":"notezzz-theme","version":9,"note":{}}');
    await page.getByTestId('theme-add').click();
    await expect(page.getByTestId('theme-error')).toContainText('newer NotezZz');
  });

  test('a theme can only bring colours and numbers: nothing reaches CSS as text', async ({ page }) => {
    await page.getByTestId('open-settings').click();
    await page.getByTestId('theme-import-toggle').click();
    await page.getByTestId('theme-json').fill(
      JSON.stringify({
        name: '<b>Bad</b>',
        note: {
          light: { color: 'red;background:url(https://evil.example/x)', strength: 9, reach: -2 },
          header: 'url(x)',
          grain: 3,
        },
        buttons: { corner: 'calc(1px)', edge: 900 },
      })
    );
    await page.getByTestId('theme-add').click();
    await expect(page.getByTestId('theme-pick').filter({ hasText: 'bBad/b' })).toHaveCount(1); // tags stripped
    expect(await rootVar(page, '--note-light')).toBe('none'); // reach clamped to 0
    expect(await rootVar(page, '--note-header-mix')).toBe('100%'); // not a number: default
    expect(await rootVar(page, '--edge')).toBe('16px'); // clamped
    expect(await rootVar(page, '--btn-corner')).toBe('0.235'); // not a number: default
    const all = await page.evaluate(() => document.documentElement.getAttribute('style') ?? '');
    expect(all).not.toContain('evil.example');
  });
});

test("a note's title, text and first toolbar glyph share one left edge", async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Biology');
  await typeInEditor(page, 'Transport from particle to ribosome.');
  await page.waitForTimeout(500);
  const id = await page.evaluate(
    () => Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!.slice('notezzz:note:'.length)
  );
  const textLeft = () =>
    page.locator('.ProseMirror p').first().evaluate((p) => {
      const r = document.createRange();
      r.selectNodeContents(p);
      return r.getClientRects()[0].left;
    });
  const glyphLeft = () => page.getByTestId('fmt-bold').locator('path').evaluate((el) => el.getBoundingClientRect().left);
  for (const width of [300, 460]) {
    await page.setViewportSize({ width, height: 400 });
    await page.goto(`/sticky?id=${id}`);
    const title = (await page.getByTestId('sticky-title').boundingBox())!.x;
    const text = await textLeft();
    const glyph = await glyphLeft();
    expect(Math.abs(title - text), `title vs text at ${width}`).toBeLessThan(1);
    expect(Math.abs(glyph - text), `glyph vs text at ${width}`).toBeLessThan(1);
  }
  // The full app, too.
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto('/?local');
  await page.getByTestId('note-item').first().click();
  const titleInput = await page.getByTestId('title-input').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left + parseFloat(getComputedStyle(el).paddingLeft);
  });
  expect(Math.abs(titleInput - (await textLeft()))).toBeLessThan(1);
  expect(Math.abs((await glyphLeft()) - (await textLeft()))).toBeLessThan(1);
});

test('the colour picker offers a completely black note', async ({ page }) => {
  await createNote(page);
  await menu(page, 'color');
  await page.locator('[data-testid="palette-chip"][data-palette="black"]').click();
  const pane = page.getByTestId('note-pane');
  await expect(pane).toHaveAttribute('data-palette', 'black');
  expect(await pane.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)');
  // Light text on it.
  expect(await page.getByTestId('title-input').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(230, 232, 235)');
});

test('Daylight lights every note the same; a theme can ease it off on dark ones', async ({ page }) => {
  await createNote(page);
  const lightOpacity = () =>
    page.getByTestId('note-pane').evaluate((el) => +getComputedStyle(el, '::before').opacity);
  const pick = async (pal: string) => {
    await menu(page, 'color');
    await page.locator(`[data-testid="palette-chip"][data-palette="${pal}"]`).click();
  };
  await pick('sunflower');
  expect(await lightOpacity()).toBeCloseTo(1, 2);
  await pick('black');
  expect(await lightOpacity()).toBeCloseTo(1, 2);
  // lightOnDark < 1: a black note gets that share of the light.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('theme-import-toggle').click();
  await page.getByTestId('theme-json').fill('{"note":{"light":{"strength":0.2},"lightOnDark":0.5}}');
  await page.getByTestId('theme-add').click();
  await page.getByTestId('settings-close').click();
  expect(await lightOpacity()).toBeCloseTo(0.5, 2);
});

test('Daylight: light and shade meet three quarters down; grain on top, blended around neutral', async ({ page }) => {
  await createNote(page);
  const cs = await page.getByTestId('note-pane').evaluate((el) => {
    const s = getComputedStyle(el);
    const b = getComputedStyle(el, '::before');
    const a = getComputedStyle(el, '::after');
    return { size: s.backgroundSize, lightSize: b.backgroundSize, grainBlend: a.mixBlendMode };
  });
  expect(cs.size).toContain('75%'); // the shade, top to centre
  expect(cs.lightSize).toContain('43.8%'); // the light: its quarter, reaching 75% further up
  expect(cs.grainBlend).toBe('hard-light');
});

/** Settings -> where the list sits, and how many columns it gets. */
async function listLayout(page: Page, layout: 'top' | 'side', columns?: 'auto' | '1' | '2' | '3') {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('set-layout').locator(`[data-value="${layout}"]`).click();
  if (columns) await page.getByTestId('set-columns').selectOption(columns);
  await page.getByTestId('settings-close').click();
}

test('list above the note: fits its notes, at least three rows, at most 30% of the height', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await createNote(page);
  await listLayout(page, 'top', '1');
  const app = page.locator('main.app');
  await expect(app).toHaveClass(/stacked/);
  const share = async () => {
    const [a, s] = await Promise.all([app.boundingBox(), page.locator('.sidebar').boundingBox()]);
    return s!.height / a!.height;
  };
  const rowH = await page.getByTestId('note-item').first().evaluate((el) => el.getBoundingClientRect().height);
  const listH = () => page.locator('.list').evaluate((el) => el.getBoundingClientRect().height);

  // One note: three rows' worth, not 30%.
  expect(Math.abs((await listH()) - 3 * rowH)).toBeLessThan(2);
  expect(await share()).toBeLessThan(0.28);

  // It grows with the notes…
  for (let i = 0; i < 3; i++) await createNote(page);
  expect(Math.abs((await listH()) - 4 * rowH)).toBeLessThan(2);

  // …up to 30% of the height; past that it scrolls. The note takes the rest.
  for (let i = 0; i < 4; i++) await createNote(page);
  expect(Math.abs((await share()) - 0.3)).toBeLessThan(0.01);
  const [sideBox, paneBox, appBox] = await Promise.all([
    page.locator('.sidebar').boundingBox(),
    page.getByTestId('note-pane').boundingBox(),
    app.boundingBox(),
  ]);
  expect(Math.abs(sideBox!.height + paneBox!.height - appBox!.height)).toBeLessThan(1);

  // A short window still shows three rows.
  await page.setViewportSize({ width: 1000, height: 400 });
  expect((await listH()) + 1).toBeGreaterThan(3 * rowH);
});

test('list above the note, auto columns: grows taller first, then adds columns', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await createNote(page);
  await listLayout(page, 'top', 'auto');
  const cols = () => page.locator('.list').evaluate((el) => (el.className.match(/cols-(\d)/) ?? [])[1]);
  const rowH = await page.getByTestId('note-item').first().evaluate((el) => el.getBoundingClientRect().height);
  const listH = () => page.locator('.list').evaluate((el) => el.getBoundingClientRect().height);
  for (let i = 0; i < 3; i++) await createNote(page);
  expect(await cols()).toBe('1'); // five toolbar-tall rows fit under the 30% cap
  expect(Math.abs((await listH()) - 4 * rowH)).toBeLessThan(2);
  for (let i = 0; i < 7; i++) await createNote(page);
  expect(await cols()).toBe('3');
});

test('list beside the note: 30% of the window width, following it', async ({ page }) => {
  await createNote(page);
  await listLayout(page, 'side');
  await expect(page.locator('main.app')).not.toHaveClass(/stacked/);
  const share = async () => {
    const [a, s] = await Promise.all([page.locator('main.app').boundingBox(), page.locator('.sidebar').boundingBox()]);
    return s!.width / a!.width;
  };
  await page.setViewportSize({ width: 1400, height: 800 });
  expect(Math.abs((await share()) - 0.3)).toBeLessThan(0.01);
  await page.setViewportSize({ width: 900, height: 800 });
  expect(Math.abs((await share()) - 0.3)).toBeLessThan(0.01);
});

test('a list row is as tall as the formatting toolbar, on a phone and on a PC', async ({ page }) => {
  await createNote(page);
  const heights = () =>
    page.evaluate(() => ({
      row: document.querySelector('[data-testid="note-item"]')!.getBoundingClientRect().height,
      bar: document.querySelector('.toolbar')!.getBoundingClientRect().height,
    }));
  for (const vp of [{ width: 412, height: 915 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(vp);
    const h = await heights();
    expect(Math.abs(h.row - h.bar)).toBeLessThan(0.5);
  }
});

test('a list with more below shades its bottom edge into the note; at the end it stops', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const list = page.locator('.listbox');
  const line = () => page.locator('.sidebar').evaluate((el) => getComputedStyle(el).borderBottomColor);
  await createNote(page);
  await expect(list).not.toHaveClass(/more-below/); // one note: nothing to scroll
  const plain = await line();
  for (let i = 0; i < 7; i++) await createNote(page);
  await expect(list).toHaveClass(/more-below/);
  // Across the whole width, the scrollbar included.
  const shade = await list.evaluate((el) => {
    const a = getComputedStyle(el, '::after');
    return { position: a.position, width: parseFloat(a.width), box: el.getBoundingClientRect().width };
  });
  expect(shade.position).toBe('absolute');
  expect(Math.abs(shade.width - shade.box)).toBeLessThan(0.5);
  await page.locator('.list').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(list).not.toHaveClass(/more-below/);
  void plain;
});

test('the selected row fills with its note colour, grown out of the colour bar', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // no growth animation to wait for
  await createNote(page);
  await menu(page, 'color');
  await page.locator('[data-testid="palette-chip"][data-palette="sunflower"]').click();
  await createNote(page); // selected now; the sunflower note is not
  const [selected, other] = [page.getByTestId('note-item').nth(0), page.getByTestId('note-item').nth(1)];
  const fill = (row: typeof selected) =>
    row.evaluate((el) => {
      const f = el.querySelector('[data-testid="note-fill"]')!;
      return { w: f.getBoundingClientRect().width, row: el.getBoundingClientRect().width, bg: getComputedStyle(f).backgroundColor };
    });
  expect((await fill(other)).w).toBe(10); // just the bar
  await other.getByTestId('note-pick').click();
  const f = await fill(other);
  expect(Math.abs(f.w - f.row)).toBeLessThan(0.5);
  expect(f.bg).toBe('rgb(240, 231, 194)'); // Sunflower
  expect(await other.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(69, 62, 33)'); // its ink
  expect((await fill(selected)).w).toBe(10);
});

test.describe('phone: one line of buttons down the right', () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("the header's +, each row's last button, the note's ⋯ and the toolbar's mic share a centre", async ({ page }) => {
    for (let i = 0; i < 8; i++) await createNote(page); // enough to scroll the list
    await page.getByTestId('note-item').first().getByTestId('note-pin').click(); // a row with a tuck button too
    const cx = async (l: ReturnType<Page['locator']>) => {
      const b = (await l.boundingBox())!;
      return b.x + b.width / 2;
    };
    const line = await cx(page.getByTestId('new-note'));
    expect(Math.abs((await cx(page.getByTestId('note-more'))) - line)).toBeLessThan(0.5);
    expect(Math.abs((await cx(page.getByTestId('fmt-record'))) - line)).toBeLessThan(0.5);
    const rows = page.getByTestId('note-item');
    for (let i = 0; i < 3; i++) {
      const last = rows.nth(i).locator('button').last();
      expect(Math.abs((await cx(last)) - line)).toBeLessThan(0.5);
    }
    // The list's scrollbar floats over the rows instead of taking width.
    const [row, box] = await Promise.all([rows.first().boundingBox(), page.locator('.listbox').boundingBox()]);
    expect(Math.abs(row!.x + row!.width - (box!.x + box!.width))).toBeLessThan(0.5);
    await expect(page.locator('.thumb')).toHaveCount(1);
  });

  test('the list starts right under the header, which is as tall as the toolbar', async ({ page }) => {
    await createNote(page);
    const [head, row, bar] = await Promise.all([
      page.locator('.head').boundingBox(),
      page.getByTestId('note-item').first().boundingBox(),
      page.locator('.toolbar').boundingBox(),
    ]);
    expect(Math.abs(row!.y - (head!.y + head!.height))).toBeLessThan(0.5);
    expect(Math.abs(head!.height - bar!.height)).toBeLessThan(0.5);
  });

  test("under Android's status bar: the header's colour, or a full-screen note's own", async ({ page }) => {
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '24px'));
    await createNote(page);
    const [appBg, panel] = await Promise.all([
      page.locator('main.app').evaluate((el) => getComputedStyle(el).backgroundColor),
      page.locator('.sidebar').evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(appBg).toBe(panel);
    await page.getByTestId('note-fullscreen').click();
    await expect(page.locator('main.app')).toHaveClass(/note-open/);
    const pane = (await page.getByTestId('note-pane').boundingBox())!;
    expect(pane.y).toBe(0); // the note itself runs up under the status bar
    const pad = await page.locator('.topbar').evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
    expect(pad).toBe(30); // the edge plus the status bar
  });
});

test('while recording, the mic button stays red even under the pointer (a phone keeps :hover after a tap)', async ({ page }) => {
  await createNote(page);
  const rec = page.getByTestId('fmt-record');
  await rec.click();
  await expect(rec).toHaveAttribute('aria-pressed', 'true');
  await rec.hover();
  const [bg, danger] = await Promise.all([
    rec.evaluate((el) => getComputedStyle(el).backgroundColor),
    page.evaluate(() => {
      const d = document.createElement('div');
      d.style.color = 'var(--app-danger)';
      document.body.append(d);
      const c = getComputedStyle(d).color;
      d.remove();
      return c;
    }),
  ]);
  expect(bg).toBe(danger);
  await rec.click(); // stop
});

test('the toolbar: no numbered list, no ⋯; recording shows red with no seconds', async ({ page }) => {
  await createNote(page);
  await expect(page.getByTestId('fmt-ordered')).toHaveCount(0);
  await expect(page.getByTestId('fmt-more')).toHaveCount(0);
  for (const id of ['fmt-underline', 'fmt-strike', 'fmt-size']) await expect(page.getByTestId(id)).toBeVisible();
  const rec = page.getByTestId('fmt-record');
  const w = (await rec.boundingBox())!.width;
  await rec.click();
  await expect(rec).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1200);
  expect(await rec.innerText()).toBe(''); // the icon only
  expect(Math.round((await rec.boundingBox())!.width)).toBe(Math.round(w)); // still one button
  await rec.click();
});

test('a horizontal line is the ink at half strength', async ({ page }) => {
  await createNote(page);
  const pm = page.locator('.ProseMirror');
  await pm.click();
  await page.keyboard.type('above');
  await page.keyboard.press('Enter');
  await page.keyboard.type('---');
  await expect(pm.locator('hr')).toHaveCount(1);
  const c = await pm.locator('hr').evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(c).toMatch(/rgba?\(.*0\.5\)|color\(srgb .* \/ 0\.5\)/);
});

test('checklist boxes follow the text size and the button shape', async ({ page }) => {
  await createNote(page);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('milk');
  await page.getByTestId('fmt-checklist').click();
  const box = await page.locator('.ProseMirror input[type=checkbox]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: r.width, font: parseFloat(cs.fontSize), radius: parseFloat(cs.borderTopLeftRadius), border: cs.borderTopStyle };
  });
  expect(box.w).toBeGreaterThan(18); // 0.9em of the 22px text, not the browser's 13px
  expect(Math.abs(box.w - box.font * 0.9)).toBeLessThan(0.6);
  expect(box.radius / box.w).toBeGreaterThan(0.2);
  expect(box.border).toBe('none');
});

test('a dropped connection is retried quietly; only lasting trouble is said, in words', async ({ page }) => {
  await createNote(page);
  const sync = () => page.evaluate(() => (window as unknown as { __nzSyncNow: () => Promise<void> }).__nzSyncNow());
  await page.evaluate(() => localStorage.setItem('notezzz:test:failLoads', '1'));
  // A blip: several failures within seconds say nothing (the grace is 45s).
  for (let i = 0; i < 4; i++) await sync();
  await expect(page.getByTestId('sync-error')).toHaveCount(0);
  // Lasting trouble (grace shortened for the test): said, in words.
  await page.evaluate(() => localStorage.setItem('notezzz:test:offlineGrace', '0'));
  await sync();
  await expect(page.getByTestId('sync-error')).toBeVisible();
  await expect(page.getByTestId('sync-error')).toContainText("Can't reach Google Drive");
  await expect(page.getByTestId('sync-error')).not.toContainText('signal timed out');
  // Back: it retries by itself (no Reconnect) and the message goes.
  await page.evaluate(() => localStorage.removeItem('notezzz:test:failLoads'));
  await expect(page.getByTestId('sync-error')).toHaveCount(0, { timeout: 12_000 });
});

test.describe('phone: the selection balloon', () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test('stays whole on screen, buttons like every other', async ({ page }) => {
    await createNote(page);
    const pm = page.locator('.ProseMirror');
    await pm.click();
    await page.keyboard.type('amplify this word');
    // Select the first word, at the far left of the line.
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ControlOrMeta+ArrowRight');
    const bubble = page.getByTestId('format-bubble');
    await expect(bubble).toBeVisible();
    const b = (await bubble.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(5);
    expect(b.x + b.width).toBeLessThanOrEqual(412 - 5);
    const [btn, bar] = await Promise.all([
      bubble.locator('button').first().boundingBox(),
      page.getByTestId('fmt-bold').boundingBox(),
    ]);
    expect(Math.round(btn!.width)).toBe(Math.round(bar!.width));
    expect(Math.round(btn!.height)).toBe(Math.round(bar!.height));
  });

  test('settings fill the screen', async ({ page }) => {
    await page.getByTestId('open-settings').click();
    const p = (await page.locator('.panel').boundingBox())!;
    expect(Math.round(p.width)).toBe(412);
    expect(Math.round(p.height)).toBe(915);
  });
});

test('sign-in: the logo and Google’s own button', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.gate .nz-logo')).toBeVisible();
  const g = page.locator('.google');
  await expect(g).toContainText('Sign in with Google');
  await expect(g.locator('svg path[fill="#4285F4"]')).toHaveCount(1);
  expect(await g.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
});

test('the list shows a pin only on pinned notes, as a plain icon', async ({ page }) => {
  await createNote(page);
  await createNote(page);
  const rows = page.getByTestId('note-item');
  const pinOf = (i: number) => rows.nth(i).getByTestId('note-pin');
  await page.mouse.move(5, 790); // away from the list
  expect(await pinOf(1).evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await pinOf(1).click({ force: true });
  await expect(pinOf(1)).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(5, 790);
  const on = await pinOf(1).evaluate((el) => ({ o: getComputedStyle(el).opacity, bg: getComputedStyle(el).backgroundColor }));
  expect(on.o).toBe('1');
  expect(on.bg).toBe('rgba(0, 0, 0, 0)'); // no filled tile: a long pinned list stays light
});

test('right-click on a row: pin and archive without opening the note', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('title-input').fill('Errands');
  const row = page.getByTestId('note-item').first();
  await row.click({ button: 'right' });
  await expect(page.getByTestId('row-menu')).toBeVisible();
  await page.getByTestId('row-menu-pin').click();
  await expect(row.getByTestId('note-pin')).toHaveAttribute('aria-pressed', 'true');
  await row.click({ button: 'right' });
  await page.getByTestId('row-menu-archive').click();
  await expect(page.getByTestId('note-item')).toHaveCount(0);
});

test('a dark note keeps a visible title strip; long lines stop near 70 characters', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await createNote(page);
  await menu(page, 'color');
  await page.locator('[data-testid="palette-chip"][data-palette="black"]').click();
  const strip = await page.locator('.topbar').evaluate((el) => getComputedStyle(el).boxShadow);
  expect(strip).toContain('255, 255, 255');
  const pad = await page.locator('.ProseMirror').evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
  expect(pad).toBeGreaterThan(100);
});

test('the sticky header: add, pinned, tuck and ⋯ (colour and transparency inside)', async ({ page }) => {
  await createNote(page);
  await page.waitForTimeout(500);
  const id = await page.evaluate(
    () => Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!.slice('notezzz:note:'.length)
  );
  await page.goto(`/sticky?id=${id}`);
  await expect(page.getByTestId('sticky-unpin')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('sticky-more').click();
  await expect(page.getByTestId('sticky-color')).toBeVisible();
  await expect(page.getByTestId('sticky-opacity')).toBeVisible();
  await page.getByTestId('sticky-color').click();
  await expect(page.getByTestId('palette-chip').first()).toBeVisible();
});

test("undo and redo from the note's ⋯ menu", async ({ page }) => {
  await createNote(page);
  await typeInEditor(page, 'first');
  await page.waitForTimeout(600); // a separate history step
  await page.keyboard.type(' second');
  await expect(page.locator('.ProseMirror')).toContainText('first second');
  await page.getByTestId('note-more').click();
  await page.getByTestId('menu-undo').click();
  await expect(page.locator('.ProseMirror')).not.toContainText('second');
  await expect(page.getByTestId('note-menu')).toBeVisible(); // stays open for another step
  await page.getByTestId('menu-redo').click();
  await expect(page.locator('.ProseMirror')).toContainText('first second');
});

test('no tap flash; a quiet search box; no line between list and note', async ({ page }) => {
  await createNote(page);
  expect(await page.getByTestId('note-pick').first().evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-tap-highlight-color'))).toBe('rgba(0, 0, 0, 0)');
  await page.getByTestId('search-toggle').click();
  const s = await page.locator('.search').evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(s).toBe('none');
  expect(await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).borderBottomStyle)).toBe('none');
});

test('a voice memo: selected, its play tile fills the player and Delete appears', async ({ page }) => {
  await createNote(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!;
    const n = JSON.parse(localStorage.getItem(k)!);
    n.contentHtml = '<p>memo:</p><audio src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="></audio><p>after</p>';
    localStorage.setItem(k, JSON.stringify(n));
  });
  await page.goto('/?local');
  const player = page.locator('.nz-audio');
  await expect(player).toHaveCount(1);
  const tile = () => player.evaluate((el) => parseFloat(getComputedStyle(el, '::before').width));
  const btn = (await page.locator('.nz-audio-play').boundingBox())!.width;
  expect(Math.abs((await tile()) - btn)).toBeLessThan(0.5);
  await expect(page.locator('.nz-audio-del')).toBeHidden();
  await player.locator('.nz-audio-time').click(); // tapping the player selects it
  await expect(player).toHaveClass(/selected/);
  await page.waitForTimeout(400);
  expect(await player.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  expect(Math.abs((await tile()) - (await player.boundingBox())!.width)).toBeLessThan(1);
  await page.locator('.nz-audio-del').click();
  await expect(page.locator('.nz-audio')).toHaveCount(0);
  await expect(page.locator('.ProseMirror')).toContainText('after');
});

test('the draw pad sits over everything, its swatches all visible, its bar never scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  for (let i = 0; i < 9; i++) await page.getByTestId('new-note').click(); // a list long enough to shade
  await expect(page.locator('.listbox')).toHaveClass(/more-below/);
  await page.getByTestId('fmt-draw').click();
  const surface = page.getByTestId('draw-surface');
  await expect(surface).toBeVisible();
  // Nothing from the list paints over the pad.
  const shadeBox = (await page.locator('.listbox').boundingBox())!;
  const topAt = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement).closest('.pad') !== null, [200, shadeBox.y + shadeBox.height - 4]);
  expect(topAt).toBe(true);
  expect(await page.locator('.listbox').evaluate((el) => getComputedStyle(el, '::after').zIndex)).toBe('auto');
  // Every swatch has a ring; the bar fits without scrolling.
  const rings = await page.locator('.pad .dot').evaluateAll((els) => els.map((e) => getComputedStyle(e).boxShadow));
  for (const r of rings) expect(r).toContain('inset');
  const bar = await page.locator('.pad .bar').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(bar).toBeLessThanOrEqual(1);
});

test('the size balloon: white on a dark note, the menu panel on a light note in the dark theme', async ({ page }) => {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('set-theme').locator('[data-value="dark"]').click();
  await page.getByTestId('settings-close').click();
  await createNote(page);
  const bg = async () => {
    await menu(page, 'size');
    const c = await page.locator('.sizepanel').evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 790);
    return c;
  };
  expect(await bg()).not.toBe('rgb(255, 255, 255)'); // Paper is light: the dark panel
  await menu(page, 'color');
  await page.locator('[data-testid="palette-chip"][data-palette="black"]').click();
  expect(await bg()).toBe('rgb(255, 255, 255)');
});

test("a phone keyboard's Backspace (an input event, not a key) selects, then deletes a voice memo", async ({ page }) => {
  await createNote(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!;
    const n = JSON.parse(localStorage.getItem(k)!);
    n.contentHtml = '<audio src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="></audio><p>after</p>';
    localStorage.setItem(k, JSON.stringify(n));
  });
  await page.goto('/?local');
  await expect(page.locator('.nz-audio')).toHaveCount(1);
  // Caret at the start of "after", as a tap would leave it.
  await page.locator('.ProseMirror p').click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  const androidBackspace = () =>
    page.locator('.ProseMirror').evaluate((el) =>
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }))
    );
  await androidBackspace();
  await expect(page.locator('.nz-audio')).toHaveClass(/selected/); // first press: selected
  await androidBackspace();
  await expect(page.locator('.nz-audio')).toHaveCount(0); // second: gone
  await expect(page.locator('.ProseMirror')).toContainText('after');
});


test("in the note's ⋯ menu, Redo sits beneath Undo", async ({ page }) => {
  await createNote(page);
  await page.getByTestId('note-more').click();
  const [u, r] = await Promise.all([page.getByTestId('menu-undo').boundingBox(), page.getByTestId('menu-redo').boundingBox()]);
  expect(Math.round(r!.x)).toBe(Math.round(u!.x));
  expect(r!.y).toBeGreaterThan(u!.y + u!.height - 1);
});

test('draw pad swatches are buttons: same size and corner, the chosen one checked', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 }); // the phone layout had its own, smaller sizes
  await createNote(page);
  await page.getByTestId('fmt-draw').click();
  const dots = page.locator('.pad .dot');
  const [d, sz, op] = await Promise.all([
    dots.first().boundingBox(),
    page.locator('.pad .sz').first().boundingBox(),
    page.getByTestId('tool-pen').boundingBox(),
  ]);
  const btn = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pad .op')!).width));
  for (const b of [d, sz, op]) {
    expect(Math.abs(b!.width - btn)).toBeLessThan(0.5);
    expect(Math.abs(b!.height - btn)).toBeLessThan(0.5);
  }
  expect(btn).toBeGreaterThan(33); // --btn on a 412px phone, not the old 22-32px
  const r = await dots.first().evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) / el.getBoundingClientRect().width);
  expect(r).toBeGreaterThan(0.2);
  expect(r).toBeLessThan(0.27);
  await expect(page.locator('.pad .dot[aria-pressed="true"] svg')).toHaveCount(1);
  await dots.nth(2).click();
  await expect(dots.nth(2).locator('svg')).toHaveCount(1);
  await expect(page.locator('.pad .dot svg')).toHaveCount(1);
});

test('a link in a note opens outside the app; the app stays where it was', async ({ page, context }) => {
  await context.route('https://example.org/**', (r) => r.fulfill({ status: 200, body: 'elsewhere' }));
  await createNote(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!;
    const n = JSON.parse(localStorage.getItem(k)!);
    n.contentHtml = '<p>see <a href="https://example.org/post/1">this post</a></p>';
    localStorage.setItem(k, JSON.stringify(n));
  });
  await page.goto('/?local');
  const before = page.url();
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('.ProseMirror a').click()]);
  expect(popup.url()).toContain('example.org/post/1');
  expect(page.url()).toBe(before); // the app itself never navigated
  await expect(page.getByTestId('note-pane')).toBeVisible();
});


test.describe('phone: buttons line up in columns', () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("header, a pinned row and the note's title bar share their button columns", async ({ page }) => {
    await createNote(page);
    await page.getByTestId('pane-pin').click(); // pinned: the row gets pin + tuck, the note pin + tuck + ⋯
    const cx = async (l: ReturnType<Page['locator']>) => {
      const b = (await l.boundingBox())!;
      return b.x + b.width / 2;
    };
    const row = page.getByTestId('note-item').first();
    const cols = {
      right: [page.getByTestId('new-note'), row.getByTestId('note-tuck'), page.getByTestId('note-more')],
      second: [page.getByTestId('open-settings'), row.getByTestId('note-pin'), page.getByTestId('pane-tuck')],
      third: [page.getByTestId('search-toggle'), page.getByTestId('pane-pin')],
    };
    for (const [name, list] of Object.entries(cols)) {
      const xs = await Promise.all(list.map(cx));
      for (const x of xs) expect(Math.abs(x - xs[0]), name).toBeLessThan(0.5);
    }
  });
});

test('list beside the note: no line or seam between them', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 }); // 30% = 409.8px
  await createNote(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('set-layout').locator('[data-value="side"]').click();
  await page.getByTestId('settings-close').click();
  const [side, pane] = await Promise.all([page.locator('.sidebar').boundingBox(), page.getByTestId('note-pane').boundingBox()]);
  expect(Number.isInteger(side!.width)).toBe(true);
  expect(pane!.x).toBe(side!.x + side!.width);
  expect(await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).borderRightStyle)).toBe('none');
});


test('a new sticky (Windows) opens big enough to show the whole toolbar and header', async ({ page }) => {
  const { STICKY_SIZE } = await import('../src/lib/desktop');
  await createNote(page);
  await page.getByTestId('title-input').fill('Groceries for the weekend');
  await page.waitForTimeout(500);
  const id = await page.evaluate(
    () => Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!.slice('notezzz:note:'.length)
  );
  await page.setViewportSize({ width: STICKY_SIZE.w, height: STICKY_SIZE.h });
  await page.goto(`/sticky?id=${id}`);
  const tb = page.locator('.toolbar');
  await expect(tb).toBeVisible();
  expect(await tb.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const mic = (await page.getByTestId('fmt-record').boundingBox())!;
  expect(mic.x + mic.width).toBeLessThanOrEqual(STICKY_SIZE.w);
  await expect(page.getByTestId('sticky-more')).toBeInViewport();
});

test('the list stays newest first: editing an older note or reloading never moves it', async ({ page }) => {
  for (const t of ['Oldest', 'Middle', 'Newest']) {
    await page.getByTestId('new-note').click();
    await page.getByTestId('title-input').fill(t);
    await page.waitForTimeout(30);
  }
  const order = () => page.getByTestId('note-title').allTextContents();
  expect(await order()).toEqual(['Newest', 'Middle', 'Oldest']);
  await page.getByTestId('note-item').filter({ hasText: 'Oldest' }).getByTestId('note-pick').click();
  await typeInEditor(page, 'edited later');
  await page.waitForTimeout(600);
  await syncAndSettle(page);
  expect(await order()).toEqual(['Newest', 'Middle', 'Oldest']);
  // A cold start with nothing cached on screen still lands newest first.
  await page.goto('/?local');
  await expect(page.getByTestId('note-item')).toHaveCount(3);
  expect(await order()).toEqual(['Newest', 'Middle', 'Oldest']);
});

test('a note with a reminder shows a small alarm in the list', async ({ page }) => {
  await createNote(page);
  await createNote(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const k = Object.keys(localStorage).filter((k) => k.startsWith('notezzz:note:'))[0];
    const n = JSON.parse(localStorage.getItem(k)!);
    n.remindAt = Date.now() + 86_400_000;
    localStorage.setItem(k, JSON.stringify(n));
  });
  await page.goto('/?local');
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  await expect(page.getByTestId('note-alarm')).toHaveCount(1);
});

test('Paper: Daylight on a paper texture with light wear', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('theme-pick').filter({ hasText: 'Paper' }).click();
  await page.getByTestId('settings-close').click();
  const layer = await page.getByTestId('note-pane').evaluate((el) => {
    const a = getComputedStyle(el, '::after');
    return { img: a.backgroundImage, blend: a.mixBlendMode };
  });
  expect(layer.img).toContain('textures/paper.webp'); // a real texture, not noise
  expect(layer.blend).toBe('hard-light');
  expect(await page.getByTestId('note-pane').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
    'radial-gradient(' // the aged edges, on the note's own surface
  );
  const res = await page.request.get(layer.img.match(/url\("(.*)"\)/)![1]);
  expect(res.ok()).toBe(true);
});

test('Mono: the app in black and white only, the note keeps its colour', async ({ page }) => {
  await createNote(page);
  await menu(page, 'color');
  await page.locator('[data-testid="palette-chip"][data-palette="sunflower"]').click();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('theme-pick').filter({ hasText: 'Mono' }).click();
  await page.getByTestId('settings-close').click();
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'mono');
  const bw = /^rgba?\((0, 0, 0|255, 255, 255)(, 1)?\)$|^rgba\(0, 0, 0, 0\)$/;
  const colours = await page.evaluate(() => {
    const cs = (s: string, p: string) => getComputedStyle(document.querySelector(s)!).getPropertyValue(p);
    return [
      cs('.sidebar', 'background-color'),
      cs('.head', 'color'),
      cs('[data-testid="new-note"]', 'background-color'),
      cs('[data-testid="open-settings"]', 'color'),
    ];
  });
  for (const c of colours) expect(c).toMatch(bw);
  // The note is still the note's colour.
  expect(await page.getByTestId('note-pane').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(240, 231, 194)');
  // And it goes away with the theme.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('theme-pick').filter({ hasText: 'Daylight' }).click();
  await page.getByTestId('settings-close').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-ui', 'mono');
});

test('Mono draws no divider lines', async ({ page }) => {
  await createNote(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('theme-pick').filter({ hasText: 'Mono' }).click();
  await page.getByTestId('settings-close').click();
  const line = await page.locator('.head').evaluate((el) => getComputedStyle(el).borderBottomColor);
  expect(line).toBe('rgba(0, 0, 0, 0)');
});

test.describe('phone: the alarm sits in a button column', () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("a pinned row's alarm lines up with the header's search button", async ({ page }) => {
    await createNote(page);
    await page.getByTestId('pane-pin').click();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const k = Object.keys(localStorage).find((k) => k.startsWith('notezzz:note:'))!;
      const n = JSON.parse(localStorage.getItem(k)!);
      n.remindAt = Date.now() + 86_400_000;
      localStorage.setItem(k, JSON.stringify(n));
    });
    await page.goto('/?local');
    const [alarm, search] = await Promise.all([
      page.getByTestId('note-alarm').boundingBox(),
      page.getByTestId('search-toggle').boundingBox(),
    ]);
    expect(Math.abs(alarm!.x + alarm!.width / 2 - (search!.x + search!.width / 2))).toBeLessThan(0.5);
  });
});

