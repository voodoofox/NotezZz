// Fixed-position popover placement. Toolbar containers scroll/clip, so menus
// must be position:fixed — this computes where, opening upward when the
// anchor sits in the lower half of the viewport (e.g. the bottom toolbar).

/**
 * `align: 'end'` lines the popover's right edge up with the anchor's (menus
 * opened from the last button in a bar); the default centres it.
 */
export function popoverStyle(anchor: HTMLElement, width = 240, align: 'center' | 'end' = 'center'): string {
  const r = anchor.getBoundingClientRect();
  const spaceAbove = r.top - 14;
  const spaceBelow = window.innerHeight - r.bottom - 14;
  // Open toward whichever side has more room, and never taller than that
  // space — in a short window a tall menu used to be clipped away entirely.
  const up = spaceAbove > spaceBelow;
  const maxH = Math.max(120, Math.round(up ? spaceAbove : spaceBelow));
  // Centred over the anchor (or right-aligned to it), kept on screen.
  const want = align === 'end' ? r.right - width : r.left + r.width / 2 - width / 2;
  const left = Math.max(4, Math.min(want, window.innerWidth - width - 4));
  const vert = up
    ? `bottom:${Math.round(window.innerHeight - r.top + 4)}px`
    : `top:${Math.round(r.bottom + 4)}px`;
  return `position:fixed;left:${Math.round(left)}px;width:${width}px;${vert};max-height:${maxH}px;overflow:auto;z-index:70;`;
}
