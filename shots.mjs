// Capture real product screenshots of the app for the marketing site.
// Runs against the dev server in ?local mode with seeded demo notes, so no
// personal data is involved and every pixel is the actual UI.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'site/shots';
mkdirSync(OUT, { recursive: true });

// A hand-drawn-looking sketch, in the same SVG form the DrawPad produces.
const sketch = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150" width="300" height="150">
    <path d="M14 96 C34 40 62 34 76 74 C88 108 108 112 122 78 C134 48 158 44 172 82 C182 110 204 114 218 84" fill="none" stroke="#21452A" stroke-width="7" stroke-linecap="round"/>
    <path d="M232 44 h50 v46 h-50 z" fill="none" stroke="#30A64E" stroke-width="6"/>
    <path d="M20 128 h214" fill="none" stroke="#21452A" stroke-width="5" stroke-linecap="round" opacity=".5"/>
  </svg>`
);
// Shortest valid silent WAV — enough for the audio player to render.
const wav =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

const now = Date.now();
const note = (i, o) => ({
  id: `demo${String(i).padStart(20, '0')}`,
  title: '',
  contentHtml: '',
  paletteId: 'paper',
  fontSize: 18,
  pinned: false,
  opacity: 1,
  win: null,
  createdAt: now - i * 6e5,
  updatedAt: now - i * 6e5,
  ...o,
});

const NOTES = [
  note(1, {
    title: 'Sprint planning',
    paletteId: 'sky',
    pinned: true,
    contentHtml:
      '<p><span style="font-size: 1.3333em"><strong>Thursday standup</strong></span></p>' +
      '<ul><li>Ship the export flow</li><li>Fix the avatar upload bug</li>' +
      '<li><em>Ask Marta about the API limits</em></li><li><s>Rewrite the onboarding copy</s></li></ul>' +
      '<p>Demo build due <strong>Friday 14:00</strong>. Send the invite once staging is green.</p>' +
      '<p><span style="font-size: 0.8889em">Parking lot: pricing page, changelog, the settings redesign nobody asked for.</span></p>' +
      '<ol><li>Cut the release branch</li><li>Smoke-test on the old laptop</li><li>Post notes in #general</li></ol>',
  }),
  note(2, {
    title: 'Layout idea',
    paletteId: 'mint',
    contentHtml: `<p>Rough shape for the landing section:</p><p><img src="data:image/svg+xml;utf8,${sketch}"></p>`,
  }),
  note(3, {
    title: 'Voice memo — kitchen',
    paletteId: 'rose',
    contentHtml: `<p>Thought on the way home:</p><audio src="${wav}" controls></audio>`,
  }),
  note(4, {
    title: 'Reading list',
    paletteId: 'lavender',
    contentHtml:
      '<ol><li>The Design of Everyday Things</li><li>Thinking in Systems</li><li>A Pattern Language</li></ol>',
  }),
  note(5, {
    title: 'Groceries',
    paletteId: 'sunflower',
    pinned: true,
    contentHtml: '<ul><li>Olive oil</li><li>Rye bread</li><li>Coffee beans</li><li>Lemons</li></ul>',
  }),
  note(6, { title: 'Trip packing', paletteId: 'coral', contentHtml: '<p>Passport, charger, adapter…</p>' }),
  note(7, { title: 'Book quotes', paletteId: 'teal', contentHtml: '<p>“Simplicity is a great virtue…”</p>' }),
];

const seed = (page, theme) =>
  page.evaluate(
    ([notes, appTheme]) => {
      localStorage.clear();
      for (const n of notes) localStorage.setItem(`notezzz:note:${n.id}`, JSON.stringify(n));
      localStorage.setItem(
        'notezzz:settings',
        JSON.stringify({
          defaultPaletteId: 'paper',
          defaultFontSize: 18,
          appTheme,
          autostart: false,
          syncFolder: null,
        })
      );
    },
    [NOTES, theme]
  );

const browser = await chromium.launch({ channel: 'chrome' });

// 1 — desktop, dark shell, a formatted note open
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 680 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:1420/?local');
  await seed(page, 'dark');
  await page.reload();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/app-dark.png` });
  await page.close();
}

// 2 — desktop, light shell, the sketch note
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 680 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:1420/?local');
  await seed(page, 'light');
  await page.reload();
  await page.waitForTimeout(700);
  await page.getByTestId('note-pick').filter({ hasText: 'Layout idea' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/app-drawing.png` });
  await page.close();
}

// 3 — phone, the 30/70 split
{
  const page = await browser.newPage({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 3 });
  await page.goto('http://localhost:1420/?local');
  await seed(page, 'dark');
  await page.reload();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/app-phone.png` });
  await page.close();
}

// 4 — a sticky note exactly as it floats on the desktop
{
  const page = await browser.newPage({ viewport: { width: 300, height: 300 }, deviceScaleFactor: 3 });
  await page.goto('http://localhost:1420/?local');
  await seed(page, 'light');
  await page.goto(`http://localhost:1420/sticky?id=${NOTES[4].id}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/sticky.png`, omitBackground: true });
  await page.close();
}

// 5 — the colour picker open
{
  const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:1420/?local');
  await seed(page, 'dark');
  await page.reload();
  await page.waitForTimeout(700);
  await page.getByTestId('note-color').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/app-colors.png` });
  await page.close();
}

await browser.close();
console.log('screenshots written to', OUT);
