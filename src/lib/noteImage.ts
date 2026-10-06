// A note as one picture, for sharing: its title bar and the whole of its
// text, however long, laid out off-screen at full length and drawn into a
// JPEG. JPEG: every app takes it, and the themes' light, shade and grain
// would make a PNG of a long note several times the size.

import { toJpeg } from 'html-to-image';
import { androidBridge, androidCall } from './android';

/** Device pixels: taller than this and the drawing scale steps down, where
 *  phones start refusing to make the canvas. */
const MAX_PX = 16_000;

/** The note pane, drawn: a data: URL of a JPEG. */
export async function noteToJpeg(pane: HTMLElement): Promise<string> {
  const width = Math.round(pane.getBoundingClientRect().width);
  const copy = pane.cloneNode(true) as HTMLElement;

  // What cloning loses: a checkbox's tick and a field's text are properties.
  const was = pane.querySelectorAll('input');
  copy.querySelectorAll('input').forEach((c, i) => {
    const o = was[i] as HTMLInputElement | undefined;
    if (!o) return;
    if (o.type === 'checkbox') c.toggleAttribute('checked', o.checked);
    else c.setAttribute('value', o.value);
  });
  // The title as plain text (no field, no "Title…" placeholder).
  for (const t of copy.querySelectorAll<HTMLInputElement>('input.title')) {
    const span = document.createElement('span');
    span.className = t.className;
    span.textContent = t.value;
    t.replaceWith(span);
  }
  // The note only: none of the app's buttons, toolbars or menus around it.
  for (const el of copy.querySelectorAll('button, .toolbar, [role="menu"], .pop')) {
    if (!el.closest('.ProseMirror')) el.remove();
  }
  copy.querySelector('.ProseMirror')?.removeAttribute('contenteditable');

  // Laid out off-screen at the pane's width and at full length.
  Object.assign(copy.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${width}px`,
    height: 'auto',
    maxHeight: 'none',
    transform: 'translateX(-300vw)',
    pointerEvents: 'none',
  });
  document.body.appendChild(copy);
  try {
    // Every box that scrolled or clipped grows to its content instead, and
    // the boxes stacked in a column (which shared out the screen's height)
    // take their own. Only those: the title stretches along its row, and
    // without that it shrank to its narrowest, a word a line.
    for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
      if (el.closest('.ProseMirror')) continue;
      const cs = getComputedStyle(el);
      const up = el.parentElement ? getComputedStyle(el.parentElement) : null;
      const stacked = !!up && up.display.includes('flex') && up.flexDirection.startsWith('column');
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowY)) {
        Object.assign(el.style, { overflow: 'visible', height: 'auto', maxHeight: 'none' });
      }
      if (stacked) Object.assign(el.style, { flex: 'none', minHeight: '0' });
    }
    await document.fonts.ready;
    const height = Math.ceil(copy.scrollHeight);
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 2, 2.5, MAX_PX / height));
    return await toJpeg(copy, {
      quality: 0.92,
      pixelRatio: ratio,
      width,
      height,
      backgroundColor: getComputedStyle(pane).backgroundColor,
      // The drawing is of the copy in place, not where it hides.
      style: { transform: 'none', position: 'relative' },
    });
  } finally {
    copy.remove();
  }
}

/** Hand the picture to the phone's share sheet; in a browser that can't
 *  share files, download it. */
export async function sharePicture(dataUrl: string, title: string): Promise<void> {
  const name = (title.trim() || 'Note').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60).trim() || 'Note';
  if (androidBridge()?.shareImage) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    await androidCall((b, id) => b.shareImage!(id, base64, name));
    return;
  }
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return;
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${name}.jpg`;
  a.click();
}
