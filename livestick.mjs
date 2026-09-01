import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('https://flatvoxel.com/notezzz/?cachebust=' + Date.now(), { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const info = await p.evaluate(() => {
  const el = document.querySelector('.pinned');
  if (!el) return { err: 'no .pinned element' };
  const cs = getComputedStyle(el);
  // any ancestor with overflow set breaks position:sticky
  const bad = [];
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (['auto','scroll','hidden','clip'].includes(s.overflowY) || ['auto','scroll','hidden','clip'].includes(s.overflowX))
      bad.push(`${n.tagName}.${(n.className||'').toString().split(' ')[0]} overflow=${s.overflowX}/${s.overflowY}`);
  }
  return { position: cs.position, top: cs.top, parentH: el.parentElement.getBoundingClientRect().height,
           ownH: el.getBoundingClientRect().height, badAncestors: bad };
});
console.log(info);
for (const y of [0, 500, 1000, 1500]) {
  await p.evaluate(v => window.scrollTo(0, v), y); await p.waitForTimeout(300);
  const box = await p.locator('.pinned').boundingBox();
  console.log(`scroll ${String(y).padStart(4)} -> y=${box ? Math.round(box.y) : 'gone'}`);
}
await b.close();
