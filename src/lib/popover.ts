// Fixed-position popover placement. Toolbar containers scroll/clip, so menus
// must be position:fixed — this computes where, opening upward when the
// anchor sits in the lower half of the viewport (e.g. the bottom toolbar).

export function popoverStyle(anchor: HTMLElement, width = 240): string {
  const r = anchor.getBoundingClientRect();
  const spaceAbove = r.top - 14;
  const spaceBelow = window.innerHeight - r.bottom - 14;
  // Open toward whichever side has more room, and never taller than that
  // space — in a short window a tall menu used to be clipped away entirely.
  const up = spaceAbove > spaceBelow;
  const maxH = Math.max(120, Math.round(up ? spaceAbove : spaceBelow));
  // Centered over the anchor, clamped to the viewport.
  const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
  const vert = up
    ? `bottom:${Math.round(window.innerHeight - r.top + 6)}px`
    : `top:${Math.round(r.bottom + 6)}px`;
  return `position:fixed;left:${Math.round(left)}px;width:${width}px;${vert};max-height:${maxH}px;overflow:auto;z-index:70;`;
}
