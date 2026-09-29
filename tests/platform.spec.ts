import { test, expect } from '@playwright/test';

// Platform gating, as far as a plain browser can exercise it. In here
// isTauri() is false, so isDesktop() and isMobile() are false too: the same
// answers the Android build gets for every "is there a PC around this
// window?" question. What this suite pins down is that the app is complete
// and quiet under those answers — no window API reached, no desktop-only
// section on screen — at a phone-sized viewport. (Stubbing
// window.__TAURI_INTERNALS__ to fake the Tauri side is not an option: every
// invoke() would then be routed to a bridge that isn't there.)

test.use({ viewport: { width: 400, height: 800 } });

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.route('**://accounts.google.com/**', (r) => r.abort());
  await page.goto('/?local');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('open-settings')).toBeVisible();
});

test('off the desktop, Settings shows only what the device can act on', async ({ page }) => {
  await page.getByTestId('open-settings').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // What every build has.
  for (const heading of ['Appearance', 'Sync', 'Your files', 'Diagnostics']) {
    await expect(dialog.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(page.getByTestId('export-all')).toBeVisible();

  // What only a PC has: window tilt, autostart, the self-updater, the folder
  // picker and the Rust sign-in button. None of it may leak off the desktop.
  for (const heading of ['Sticky notes', 'Startup', 'Updates']) {
    await expect(dialog.getByRole('heading', { name: heading })).toHaveCount(0);
  }
  await expect(page.getByTestId('sticky-tilt')).toHaveCount(0);
  await expect(page.getByTestId('update-check')).toHaveCount(0);
  await expect(page.getByTestId('desktop-signin')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Choose…' })).toHaveCount(0);
});

test('a phone-sized window stays stacked and pins without touching window APIs', async ({
  page,
}) => {
  // A pin off the desktop is a flag for the PC to pick up. On Android the
  // window helpers must return before reaching WebviewWindow; here they must
  // return before reaching anything at all — either way, no error.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.getByTestId('new-note').click();
  await expect(page.getByTestId('note-pane')).toBeVisible();
  const list = (await page.getByTestId('note-item').boundingBox())!;
  const pane = (await page.getByTestId('note-pane').boundingBox())!;
  expect(list.y).toBeLessThan(pane.y); // list above the note

  await page.getByTestId('pane-pin').click();
  await expect(page.getByTestId('note-pin')).toHaveClass(/on/);
  // The tuck button is here too: it flags the note, and the PC's sticky
  // follows. Off the PC it says so.
  await expect(page.getByTestId('pane-tuck')).toHaveAttribute('title', 'Tuck the sticky away on your PC');
  await page.getByTestId('pane-tuck').click();
  await expect(page.getByTestId('note-tuck')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('pane-tuck')).toHaveAttribute('title', 'Bring the sticky back on your PC');
  // Unpinning also untucks, so a later pin brings the sticky up in full.
  await page.getByTestId('pane-pin').click();
  await expect(page.getByTestId('pane-tuck')).toHaveCount(0);
  await page.getByTestId('pane-pin').click();
  await expect(page.getByTestId('pane-tuck')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('pane-pin').click();
  await expect(page.getByTestId('note-pin')).not.toHaveClass(/on/);

  // It is a setting on the note, so it survives a relaunch like any edit.
  await page.getByTestId('note-pin').click();
  await page.waitForTimeout(500); // per-note save debounce
  await page.goto('/?local');
  await expect(page.getByTestId('note-pin')).toHaveClass(/on/);
  expect(errors).toEqual([]);
});

test('on a phone, a fullscreen note fills the whole screen', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto('/?local');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('new-note').click();
  await page.getByTestId('note-fullscreen').click();
  await expect(page.getByTestId('exit-fullscreen')).toBeVisible();
  const [app, pane] = await Promise.all([
    page.locator('main.app').boundingBox(),
    page.getByTestId('note-pane').boundingBox(),
  ]);
  expect(Math.abs(pane!.height - app!.height)).toBeLessThan(2);
});
