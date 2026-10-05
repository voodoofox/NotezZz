// Pattern drift, a pixel at a time. It used to be a CSS animation of
// background-position, which the browser services every frame (60 a second)
// for as long as a pattern is on screen: on the PC, always-on-top stickies
// and the list kept most of a CPU core busy. The patterns are pixel art, so
// whole-pixel steps look the same; this moves each one only when its next
// pixel is due (3 to 6 times a second) and leaves it alone in between. The
// CSS reads the step from --pat-step (app.css).

/** Per pattern: its tile, in px, and the speed the old animation had. */
const DRIFT: Record<string, { tile: number; pxPerSec: number }> = {
  'nz-pat-checker': { tile: 8, pxPerSec: 8 / 2.4 },
  'nz-pat-stripes': { tile: 10, pxPerSec: 10 / 1.6 },
  'nz-pat-dots': { tile: 8, pxPerSec: 8 / 3 },
  'nz-pat-stairs': { tile: 8, pxPerSec: 8 / 2 },
  'nz-pat-bricks': { tile: 12, pxPerSec: 12 / 4 },
  'nz-pat-custom': { tile: 16, pxPerSec: 16 / 3.2 },
};
const SELECTOR = Object.keys(DRIFT)
  .map((c) => `.${c}`)
  .join(',');

function tick() {
  const t = performance.now() / 1000;
  for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
    let d: (typeof DRIFT)[string] | undefined;
    for (const c of el.classList) if ((d = DRIFT[c])) break;
    if (!d) continue;
    const step = String(Math.floor(t * d.pxPerSec) % d.tile);
    // Only a real change touches the element: that is the whole saving.
    if (el.style.getPropertyValue('--pat-step') !== step) el.style.setProperty('--pat-step', step);
  }
}

/** Start the drift; returns the stop. A hidden window's timers slow down
 *  on their own, and so does the drift with them. */
export function startPatternMotion(): () => void {
  tick();
  const timer = setInterval(tick, 50);
  return () => clearInterval(timer);
}
