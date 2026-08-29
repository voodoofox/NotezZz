<script lang="ts">
  // Fullscreen sketch pad. Strokes are smoothed by perfect-freehand into
  // ink-like outlines, rendered live as SVG. "Done" hands back a cropped,
  // transparent-background SVG data URL that gets embedded in the note.
  import { getStroke } from 'perfect-freehand';
  import Icon from './Icon.svelte';

  interface Props {
    onDone: (svgDataUrl: string | null) => void;
    /** The note's background — the pad draws on the real thing. */
    bg?: string;
    /** The note's text color — guaranteed-contrast default ink. */
    ink?: string;
  }
  let { onDone, bg, ink }: Props = $props();

  interface Stroke {
    points: [number, number, number][];
    color: string;
    size: number;
  }

  // Default ink = the note's own text color, so dark notes start with light
  // ink and vice versa — never invisible ink. Props are captured once by
  // design: the pad is remounted fresh on every open.
  // svelte-ignore state_referenced_locally
  const inkAtOpen = ink;
  const COLORS = [
    ...(inkAtOpen ? [inkAtOpen] : []),
    '#1f2328',
    '#ffffff',
    '#e0245e',
    '#2f8fe0',
    '#2fa579',
    '#f2b705',
  ].filter((c, i, a) => a.indexOf(c) === i);
  const SIZES = [4, 8, 14];

  let strokes = $state<Stroke[]>([]);
  let current = $state<Stroke | null>(null);
  let color = $state(inkAtOpen || '#1f2328');
  let penSize = $state(SIZES[1]);
  let tool = $state<'pen' | 'erase'>('pen');
  let surface: SVGSVGElement;

  const OPTS = { thinning: 0.55, smoothing: 0.6, streamline: 0.5 };

  /** perfect-freehand outline -> SVG path data. */
  function pathOf(s: Stroke): string {
    const pts = getStroke(s.points, { ...OPTS, size: s.size });
    if (pts.length < 2) return '';
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += `L${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
    return d + 'Z';
  }

  function pos(e: PointerEvent): [number, number, number] {
    const r = surface.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, e.pressure || 0.5];
  }

  /** Stroke eraser: remove any stroke passing near the pointer. */
  function eraseAt([x, y]: [number, number, number]) {
    const r = 18;
    strokes = strokes.filter(
      (s) => !s.points.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < r * r)
    );
  }

  let erasing = false;

  function down(e: PointerEvent) {
    surface.setPointerCapture(e.pointerId);
    if (tool === 'erase') {
      erasing = true;
      eraseAt(pos(e));
      return;
    }
    current = { points: [pos(e)], color, size: penSize };
  }

  function move(e: PointerEvent) {
    // Coalesced events give the full-resolution trail on high-Hz styluses.
    const events = e.getCoalescedEvents?.() ?? [e];
    if (erasing) {
      for (const ev of events) eraseAt(pos(ev));
      return;
    }
    if (!current) return;
    for (const ev of events) current.points.push(pos(ev));
  }

  function up() {
    erasing = false;
    if (current && current.points.length > 1) strokes.push(current);
    current = null;
  }

  function undo() {
    strokes.pop();
  }

  function finish() {
    if (!strokes.length) return onDone(null);
    // Crop to the ink's bounding box (with padding) so the inserted image
    // is exactly as big as the sketch, not the whole screen.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const outlines = strokes.map((s) => {
      const pts = getStroke(s.points, { ...OPTS, size: s.size });
      for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return { s, pts };
    });
    const pad = 10;
    const w = Math.max(1, Math.ceil(maxX - minX + pad * 2));
    const h = Math.max(1, Math.ceil(maxY - minY + pad * 2));
    const paths = outlines
      .map(({ s, pts }) => {
        if (pts.length < 2) return '';
        let d = `M${(pts[0][0] - minX + pad).toFixed(1)} ${(pts[0][1] - minY + pad).toFixed(1)}`;
        for (let i = 1; i < pts.length; i++)
          d += `L${(pts[i][0] - minX + pad).toFixed(1)} ${(pts[i][1] - minY + pad).toFixed(1)}`;
        return `<path d="${d}Z" fill="${s.color}"/>`;
      })
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${paths}</svg>`;
    onDone(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
  }
</script>

<div class="pad">
  <div class="bar">
    <div class="swatches">
      {#each COLORS as c}
        <button
          class="dot"
          class:sel={c === color}
          style="background: {c}"
          aria-label="Ink color"
          onclick={() => (color = c)}
        ></button>
      {/each}
    </div>
    <div class="sizes">
      {#each SIZES as s}
        <button
          class="sz"
          class:sel={s === penSize}
          aria-label="Pen size {s}"
          title="Pen size"
          onclick={() => (penSize = s)}
        >
          <span style="width: {s + 4}px; height: {s + 4}px; background: {color}"></span>
        </button>
      {/each}
    </div>
    <div class="tools">
      <button
        class="op"
        class:sel={tool === 'pen'}
        data-testid="tool-pen"
        title="Pen"
        aria-label="Pen"
        onclick={() => (tool = 'pen')}
      ><Icon name="draw" /></button>
      <button
        class="op"
        class:sel={tool === 'erase'}
        data-testid="tool-erase"
        title="Eraser (removes whole strokes)"
        aria-label="Eraser"
        onclick={() => (tool = 'erase')}
      ><Icon name="eraser" /></button>
    </div>
    <div class="ops">
      <button class="op" onclick={undo} disabled={!strokes.length} title="Undo" aria-label="Undo">
        <Icon name="undo" />
      </button>
      <button
        class="op"
        onclick={() => (strokes = [])}
        disabled={!strokes.length}
        title="Clear"
        aria-label="Clear"
      ><Icon name="trash" /></button>
    </div>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    class="surface"
    class:erase={tool === 'erase'}
    data-testid="draw-surface"
    bind:this={surface}
    role="img"
    aria-label="Drawing area"
    style={bg ? `background: ${bg}` : ''}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    {#each strokes as s}
      <path d={pathOf(s)} fill={s.color} />
    {/each}
    {#if current}
      <path d={pathOf(current)} fill={current.color} />
    {/if}
  </svg>

  <div class="actions">
    <button class="cancel" data-testid="draw-cancel" onclick={() => onDone(null)}>Cancel</button>
    <button class="done" data-testid="draw-done" onclick={finish} disabled={!strokes.length}>
      ✓ Done
    </button>
  </div>
</div>

<style>
  .pad {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    flex-direction: column;
    background: var(--app-panel);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--app-border);
    flex-wrap: wrap;
  }
  .swatches,
  .sizes,
  .ops {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .dot.sel {
    outline: 2px solid var(--app-fg);
    outline-offset: 2px;
  }
  .sz {
    width: 34px;
    height: 34px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }
  .sz.sel {
    border-color: var(--app-accent);
    border-width: 2px;
  }
  .sz span {
    border-radius: 50%;
    display: block;
  }
  .tools {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }
  .op {
    width: 40px;
    height: 36px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg);
    color: var(--app-fg);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .op.sel {
    border-color: var(--app-accent);
    border-width: 2px;
    background: color-mix(in srgb, var(--app-accent) 14%, var(--app-bg));
  }
  .op:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .surface {
    flex: 1;
    width: 100%;
    touch-action: none; /* fingers draw, they don't scroll */
    cursor: crosshair;
    background: var(--app-bg);
  }
  .surface.erase {
    cursor: cell;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 16px;
    border-top: 1px solid var(--app-border);
  }
  .cancel,
  .done {
    font: inherit;
    font-size: 16px;
    padding: 9px 20px;
    border-radius: 9px;
    border: 1px solid var(--app-border);
    background: var(--app-bg);
    color: var(--app-fg);
    cursor: pointer;
  }
  .done {
    background: var(--app-accent);
    border-color: var(--app-accent);
    color: #fff;
  }
  .done:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
