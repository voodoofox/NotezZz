// Fixed-position popover placement. Toolbar containers scroll/clip, so menus
// must be position:fixed — this computes where, opening upward when the
// anchor sits in the lower half of the viewport (e.g. the bottom toolbar).

/**
 * `align: 'end'` lines the popover's right edge up with the anchor's (menus
 * opened from the last button in a bar); the default centres it.
 *
 * `bar`: the bar the anchor sits in. The popover then clears the bar's edge
 * by the same distance the button keeps from the bar's edge, so the balloon
 * sits off the bar the way the button sits inside it.
 */
export function popoverStyle(
  anchor: HTMLElement,
  width = 240,
  align: 'center' | 'end' = 'center',
  bar?: HTMLElement | null
): string {
  const r = anchor.getBoundingClientRect();
  const b = bar?.getBoundingClientRect();
  const inset = b ? Math.max(0, r.top - b.top) : 4;
  const from = b ? { top: b.top - inset, bottom: b.bottom + inset } : { top: r.top - 4, bottom: r.bottom + 4 };
  const spaceAbove = from.top - 10;
  const spaceBelow = window.innerHeight - from.bottom - 10;
  // Open toward whichever side has more room, and never taller than that
  // space — in a short window a tall menu used to be clipped away entirely.
  const up = spaceAbove > spaceBelow;
  const maxH = Math.max(120, Math.round(up ? spaceAbove : spaceBelow));
  // Centred over the anchor (or right-aligned to it), kept on screen.
  const want = align === 'end' ? r.right - width : r.left + r.width / 2 - width / 2;
  const left = Math.max(4, Math.min(want, window.innerWidth - width - 4));
  const vert = up
    ? `bottom:${Math.round(window.innerHeight - from.top)}px`
    : `top:${Math.round(from.bottom)}px`;
  return `position:fixed;left:${Math.round(left)}px;width:${width}px;${vert};max-height:${maxH}px;overflow:auto;z-index:70;`;
}
