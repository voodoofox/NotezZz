// Fixed-position popover placement. Toolbar containers scroll/clip, so menus
// must be position:fixed — this computes where, opening upward when the
// anchor sits in the lower half of the viewport (e.g. the bottom toolbar).

export function popoverStyle(anchor: HTMLElement, width = 240): string {
  const r = anchor.getBoundingClientRect();
  const up = r.top > window.innerHeight / 2;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  const vert = up
    ? `bottom:${Math.round(window.innerHeight - r.top + 6)}px`
    : `top:${Math.round(r.bottom + 6)}px`;
  return `position:fixed;left:${Math.round(left)}px;${vert};z-index:70;`;
}
