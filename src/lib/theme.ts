// Themes: how a note looks as a surface — light from below, shade from
// above, a little grain, how solid the title strip (the "adhesive") and the
// formatting bar are — and how buttons are shaped. A theme is plain JSON
// that people can pass around. Everything in it is a colour or a number;
// parseTheme() checks and clamps each one, and themeVars() turns them into
// CSS custom properties. Nothing from a theme file is ever written into CSS
// as text, so a shared theme can't smuggle styles (or URLs) into the app.

export interface Fade {
  /** #rrggbb */
  color: string;
  /** Opacity at the note's edge, 0..1. */
  strength: number;
  /** How far in from its edge it reaches, as a share of its part of the
   *  note: 1 = all the way to the centre (where it is clear). */
  reach: number;
}

export interface ThemeDef {
  /** 'daylight' | 'flat' | 'custom:…' */
  id: string;
  name: string;
  author?: string;
  note: {
    /** From the bottom edge: the lower part catching more light. ADDED to
     *  the note's colour (strength x white), so every colour brightens by
     *  the same amount: a plain overlay lifted dark notes far more than
     *  light ones. */
    light: Fade;
    /** From the top edge: the upper part curling away from it. */
    shade: Fade;
    /** How fast the fades fall off: 0 is a straight fade, higher is a
     *  steeper exponential curve. */
    curve: number;
    /** How much of the light a black note gets, relative to a white one
     *  (0..1). The light is added evenly to every colour; below 1 it eases
     *  off on darker notes, so light ones can glow without dark ones going
     *  milky. 1 = the same amount everywhere. */
    lightOnDark: number;
    /** Where the light and shade meet (clear), as a share of the note's
     *  height from the top: 0.5 = the middle, 0.75 = three quarters down,
     *  so the shade covers the upper three quarters and the light the rest. */
    center: number;
    /** Light and shade are halves of one ellipse centred on the note; this
     *  is its horizontal radius in note widths. Wide = contours that barely
     *  curve, like light on a gently bowed sheet. */
    spread: number;
    /** Paper grain over the whole note, 0..0.5 opacity. */
    grain: number;
    /** What the grain is: an even fine 'grain', or 'paper' (fibres and a
     *  soft cloudiness, with faint spots when worn). */
    texture: 'grain' | 'paper';
    /** Wear, 0..1: aged, slightly darker edges and a few faint spots. */
    wear: number;
    /** The title strip's opacity, 0..1 (1 = a solid band of the header colour). */
    header: number;
    /** The adhesive: a tint laid over the title strip (black darkens it on
     *  any note colour, light or dark). Strength 0 = none. */
    strip: { color: string; strength: number };
    /** The formatting bar's background, 0..1 (0 = just the buttons). */
    toolbar: number;
  };
  /** The app around the notes: 'standard', or 'mono' (black and white only;
   *  the notes keep their colours). */
  ui: 'standard' | 'mono';
  buttons: {
    /** Corner radius as a share of the button's side (the logo: 0.235). */
    corner: number;
    /** Distance from buttons to the edge of what holds them, px. */
    edge: number;
    /** Space between buttons, px. */
    gap: number;
  };
}

const FLAT_NOTE: ThemeDef['note'] = {
  light: { color: '#ffffff', strength: 0, reach: 1 },
  shade: { color: '#000000', strength: 0, reach: 1 },
  curve: 4,
  spread: 3.5,
  center: 0.5,
  lightOnDark: 1,
  grain: 0,
  texture: 'grain',
  wear: 0,
  header: 1,
  strip: { color: '#000000', strength: 0 },
  toolbar: 1,
};
const LOGO_BUTTONS: ThemeDef['buttons'] = { corner: 0.235, edge: 6, gap: 2 };

export const BUILTIN_THEMES: ThemeDef[] = [
  {
    id: 'daylight',
    name: 'Daylight',
    author: 'NotezZz',
    note: {
      light: { color: '#ffffff', strength: 0.0768, reach: 1.75 },
      shade: { color: '#000000', strength: 0.112, reach: 1 },
      curve: 2.5,
      spread: 3.5,
      center: 0.75,
      lightOnDark: 1,
      grain: 0.02,
      texture: 'grain',
      wear: 0,
      header: 0.075,
      strip: { color: '#000000', strength: 0.075 },
      toolbar: 0,
    },
    ui: 'standard',
    buttons: { ...LOGO_BUTTONS },
  },
  {
    // Daylight's light and shade on real-looking paper: fibres, a soft
    // cloudiness, and a little wear (faint spots, aged edges).
    id: 'paper',
    name: 'Paper',
    author: 'NotezZz',
    note: {
      light: { color: '#ffffff', strength: 0.0768, reach: 1.75 },
      shade: { color: '#000000', strength: 0.112, reach: 1 },
      curve: 2.5,
      spread: 3.5,
      center: 0.75,
      lightOnDark: 1,
      grain: 0.07,
      texture: 'paper',
      wear: 0.45,
      header: 0.075,
      strip: { color: '#000000', strength: 0.075 },
      toolbar: 0,
    },
    ui: 'standard',
    buttons: { ...LOGO_BUTTONS },
  },
  {
    // The app in black and white only; the notes are the one colour.
    id: 'mono',
    name: 'Mono',
    author: 'NotezZz',
    note: structuredClone(FLAT_NOTE),
    ui: 'mono',
    buttons: { ...LOGO_BUTTONS },
  },
  {
    id: 'flat',
    name: 'Flat',
    author: 'NotezZz',
    note: structuredClone(FLAT_NOTE),
    ui: 'standard',
    buttons: { ...LOGO_BUTTONS },
  },
];

export const DEFAULT_THEME_ID = 'daylight';

export function findTheme(id: string | undefined, custom: ThemeDef[] = []): ThemeDef {
  const builtin = BUILTIN_THEMES.find((t) => t.id === id);
  if (builtin) return builtin;
  // Custom themes come back from settings.json: checked again on the way in.
  const mine = custom.find((t) => t?.id === id);
  return mine ? normalizeTheme(mine, mine.id) : BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

// ---- exchange format ---------------------------------------------------

const FORMAT = 'notezzz-theme';
const VERSION = 1;

/** The JSON people share: everything but the local id. */
export function exportTheme(t: ThemeDef): string {
  return JSON.stringify(
    { format: FORMAT, version: VERSION, name: t.name, author: t.author, note: t.note, ui: t.ui, buttons: t.buttons },
    null,
    2
  );
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const hex = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback;
const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) : '';
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function fade(v: unknown, base: Fade): Fade {
  const o = obj(v);
  return {
    color: hex(o.color, base.color),
    strength: clamp(o.strength, 0, 1, base.strength),
    // Up to 2: past 1 the layer reaches beyond the centre into the other
    // half (each still clear along its own edge, so no seam).
    reach: clamp(o.reach, 0, 2, base.reach),
  };
}

/**
 * Read a shared theme. Throws an Error whose message can be shown as it is.
 * Missing values fall back to the plain (Flat) look; out-of-range ones are
 * clamped; anything that isn't a colour or a number is ignored.
 */
export function parseTheme(json: string): ThemeDef {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("That isn't a theme: it isn't valid JSON.");
  }
  const o = obj(raw);
  if (!Object.keys(o).length) throw new Error("That isn't a theme: it's empty or not an object.");
  if (o.format !== undefined && o.format !== FORMAT) throw new Error("That isn't a NotezZz theme.");
  if (!('note' in o) && !('buttons' in o)) throw new Error("That isn't a theme: it has no note or buttons section.");
  if (typeof o.version === 'number' && o.version > VERSION) {
    throw new Error('This theme was made for a newer NotezZz. Update the app, then try again.');
  }
  return normalizeTheme(o, `custom:${Math.random().toString(36).slice(2, 10)}`);
}

/** Every field checked, clamped or defaulted: the only way a theme gets in. */
export function normalizeTheme(raw: unknown, id: string): ThemeDef {
  const o = obj(raw);
  const n = obj(o.note);
  const b = obj(o.buttons);
  return {
    id,
    name: text(o.name, 40) || 'Imported theme',
    author: text(o.author, 40) || undefined,
    note: {
      light: fade(n.light, FLAT_NOTE.light),
      shade: fade(n.shade, FLAT_NOTE.shade),
      curve: clamp(n.curve, 0, 8, FLAT_NOTE.curve),
      spread: clamp(n.spread, 0.5, 20, FLAT_NOTE.spread),
      center: clamp(n.center, 0.05, 0.95, FLAT_NOTE.center),
      lightOnDark: clamp(n.lightOnDark, 0, 1, FLAT_NOTE.lightOnDark),
      grain: clamp(n.grain, 0, 0.5, FLAT_NOTE.grain),
      // Names from a short list, never text that reaches CSS.
      texture: n.texture === 'paper' ? 'paper' : 'grain',
      wear: clamp(n.wear, 0, 1, FLAT_NOTE.wear),
      header: clamp(n.header, 0, 1, FLAT_NOTE.header),
      strip: {
        color: hex(obj(n.strip).color, FLAT_NOTE.strip.color),
        strength: clamp(obj(n.strip).strength, 0, 1, FLAT_NOTE.strip.strength),
      },
      toolbar: clamp(n.toolbar, 0, 1, FLAT_NOTE.toolbar),
    },
    ui: o.ui === 'mono' ? 'mono' : 'standard',
    buttons: {
      corner: clamp(b.corner, 0, 0.5, LOGO_BUTTONS.corner),
      edge: clamp(b.edge, 0, 16, LOGO_BUTTONS.edge),
      gap: clamp(b.gap, 0, 12, LOGO_BUTTONS.gap),
    },
  };
}

// ---- to CSS ------------------------------------------------------------

function rgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * One half of the note's light or shade. Both are pieces of one wide
 * ellipse centred on the middle of the note: clear at the centre, growing
 * to `strength` at the top or bottom edge, along an exponential curve
 * (straight when curve≈0). The ellipse is `spread` note-widths across and
 * reaches the edge, so its contours bow only slightly and the corners come
 * out a touch stronger than the middle of the edge. `reach` (up to half the
 * note's height) is how far in from the edge the fade starts.
 *
 * The image is drawn for one HALF of the note (see the background-size and
 * -position next to --note-light / --note-shade): the top half for the
 * shade, the bottom half for the light, centred on the shared edge.
 * CSS gradients only interpolate in straight lines, so the curve is laid
 * down as a run of stops.
 *
 * Along the line where the halves meet, the ellipse is only clear at the
 * very centre: towards the sides the shade above and the light below both
 * show a little, which drew a straight seam across the note. So the curve
 * is lowered by its value at the ends of that line (and rescaled to keep
 * full strength at the edge): both halves are clear along all of it.
 */
export function fadeGradient(edge: 'bottom' | 'top', f: Fade, curve: number, spread = 3.5): string {
  if (f.strength <= 0 || f.reach <= 0) return 'none';
  const [r, g, b] = rgb(f.color);
  const k = curve;
  // From the edge (t = 0) inward to where the fade ends (t = 1).
  const at = (t: number) => (k < 0.01 ? 1 - t : (Math.exp(-k * t) - Math.exp(-k)) / (1 - Math.exp(-k)));
  // Radial position: 0 = the note's centre, 100% = the edge.
  const start = 1 - Math.min(1, f.reach);
  // The ends of the line where the halves meet: half a note-width out on
  // an ellipse `spread` widths wide. Clear from there in.
  const seam = Math.min(0.5 / spread, 0.99);
  const clearTo = Math.max(start, seam);
  const atSeam = seam > start ? at((1 - seam) / (1 - start)) : 0;
  const alpha = (u: number) => Math.max(0, at((1 - u) / (1 - start)) - atSeam) / (1 - atSeam);
  // Many short straight runs: with a dozen, their joins showed as faint
  // lines (Mach bands) on the larger notes.
  const steps = 32;
  const stops: string[] = [`rgba(${r}, ${g}, ${b}, 0) 0%`];
  for (let i = steps; i >= 0; i--) {
    const u = 1 - (i / steps) * (1 - clearTo); // i = steps: clear; 0: the edge
    stops.push(`rgba(${r}, ${g}, ${b}, ${(f.strength * alpha(u)).toFixed(4)}) ${(u * 100).toFixed(2)}%`);
  }
  const size = `${+(spread * 100).toFixed(1)}% 100%`;
  // The light's half is the bottom one, so the centre is its top edge; the
  // shade's half is the top one, centred on its bottom edge.
  return `radial-gradient(${size} at 50% ${edge === 'bottom' ? '0%' : '100%'}, ${stops.join(', ')})`;
}

/**
 * Grain: an even, seamlessly tiling texture of small soft clumps (two fine
 * noise scales, nothing coarse, so it never reads as stains), as a neutral
 * grey tile laid on with hard-light (see the note's background-blend-mode):
 * 50% grey changes nothing, lighter specks lighten the note's colour and
 * darker ones darken it, so the grain never greys the colour out and shows
 * on black too. `opacity` is the layer's strength. Each turbulence is
 * reduced to one opaque grey channel first: its own alpha would otherwise
 * premultiply the noise and darken the result.
 */
export function grainImage(opacity: number): string {
  if (opacity <= 0) return 'none';
  const grey = (name: string) =>
    `<feColorMatrix type='matrix' values='1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1' result='${name}'/>`;
  const fn = (c: string) => `<feFunc${c} type='linear' slope='2.6' intercept='-0.8'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>` +
    `<filter id='g' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2' seed='3' stitchTiles='stitch'/>${grey('a')}` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.4' numOctaves='2' seed='8' stitchTiles='stitch'/>${grey('b')}` +
    `<feComposite in='a' in2='b' operator='arithmetic' k1='0' k2='0.6' k3='0.5' k4='-0.05'/>` +
    `<feComponentTransfer>${fn('R')}${fn('G')}${fn('B')}<feFuncA type='linear' slope='0' intercept='${opacity.toFixed(3)}'/></feComponentTransfer>` +
    `</filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;

/** Relative luminance of #rrggbb, 0 (black) .. 1 (white): how light a note
 *  is, for easing the theme's light off on darker ones. */
/**
 * The note's colour as ink on a white balloon: the colour itself when it
 * reads there (3:1 against white), otherwise mixed towards the note's own
 * text colour just until it does, so a pale note gets a deeper shade of
 * its own hue instead of a slider that vanishes.
 */
export function inkOnWhite(bg: string, fg: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(bg) || !/^#[0-9a-f]{6}$/i.test(fg)) return fg;
  const a = rgb(bg);
  const b = rgb(fg);
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const hex = `#${a.map((v, k) => Math.round(v + (b[k] - v) * t).toString(16).padStart(2, '0')).join('')}`;
    if (luminance(hex) <= 0.3) return hex;
  }
  return fg;
}

export function luminance(h: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(h)) return 0.5;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(h);
  return +(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)).toFixed(3);
}

function stripShadow(s: { color: string; strength: number }): string {
  if (s.strength <= 0) return 'none';
  const [r, g, b] = rgb(s.color);
  return `inset 0 0 0 100vmax rgba(${r}, ${g}, ${b}, ${s.strength.toFixed(3)})`;
}

/** The custom properties a theme sets on the document root. */
export function themeVars(t: ThemeDef): Record<string, string> {
  const n = t.note;
  return {
    '--note-light': fadeGradient('bottom', n.light, n.curve, n.spread),
    '--note-shade': fadeGradient('top', n.shade, n.curve, n.spread),
    '--note-grain': n.texture === 'paper' ? paperImage(n.grain, n.wear) : grainImage(n.grain),
    '--note-wear': wearImage(n.wear),
    '--note-light-on-dark': String(n.lightOnDark),
    // The shade paints the note down to the centre, the light from there on.
    '--note-shade-size': `100% ${pct(n.center * Math.max(1, n.shade.reach))}`,
    '--note-light-size': `100% ${pct((1 - n.center) * Math.max(1, n.light.reach))}`,
    '--note-header-mix': pct(n.header),
    // Painted as an inset shadow, so it lies over the strip's colour AND any
    // pattern on it (both are background) and under the title and buttons.
    '--note-strip': stripShadow(n.strip),
    // On a dark note a darkening strip vanishes: the same strength in white.
    '--note-strip-dark': stripShadow({ color: '#ffffff', strength: n.strip.strength }),
    // Pattern pixels on a faint strip stay a little stronger than the strip.
    '--note-pat-mix': pct(Math.min(1, n.header + 0.25)),
    '--note-chin-mix': pct(n.toolbar),
    '--note-chin-line': pct(n.toolbar * 0.1),
    '--btn-corner': String(t.buttons.corner),
    '--edge': `${t.buttons.edge}px`,
    '--btn-gap': `${t.buttons.gap}px`,
  };
}

export function applyTheme(t: ThemeDef, root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
  // The app's own colours (app.css): black and white only under 'mono'.
  if (t.ui === 'mono') root.dataset.ui = 'mono';
  else delete root.dataset.ui;
}

/**
 * Paper: what real paper shows, with no weave or grid. A fine surface
 * tooth, the soft clumpy "formation" of its fibres (the cloudiness seen when
 * paper is held to the light) and a slow overall variation, as a seamlessly
 * tiling grey tile laid on with hard-light like the grain (50% grey changes
 * nothing). With wear, a few faint darker spots (foxing). Every noise
 * stitches, so the tile has no seams.
 */
export function paperImage(opacity: number, wear: number): string {
  if (opacity <= 0) return 'none';
  const grey = (name: string) =>
    `<feColorMatrix type='matrix' values='1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1' result='${name}'/>`;
  const fn = (c: string) => `<feFunc${c} type='linear' slope='1.9' intercept='-0.45'/>`;
  const spot = `<feFunc$C type='discrete' tableValues='0.36 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5'/>`;
  const spots = wear > 0
    ? `<feTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='2' seed='21' stitchTiles='stitch'/>${grey('s0')}` +
      // Only the darkest few percent of that noise become spots.
      `<feComponentTransfer in='s0' result='spots'>${['R', 'G', 'B'].map((c) => spot.replace('$C', c)).join('')}</feComponentTransfer>` +
      `<feComposite in='p' in2='spots' operator='arithmetic' k1='0' k2='1' k3='${(wear * 0.8).toFixed(2)}' k4='${(-wear * 0.4).toFixed(3)}' result='p2'/>`
    : `<feComposite in='p' in2='p' operator='arithmetic' k1='0' k2='1' k3='0' k4='0' result='p2'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='384' height='384'>` +
    `<filter id='p' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='2' stitchTiles='stitch'/>${grey('tooth')}` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.035' numOctaves='4' seed='9' stitchTiles='stitch'/>${grey('form')}` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.008' numOctaves='3' seed='17' stitchTiles='stitch'/>${grey('cloud')}` +
    `<feComposite in='tooth' in2='form' operator='arithmetic' k1='0' k2='0.45' k3='0.55' k4='0' result='fine'/>` +
    `<feComposite in='fine' in2='cloud' operator='arithmetic' k1='0' k2='0.75' k3='0.25' k4='0' result='raw'/>` +
    `<feComponentTransfer in='raw' result='p'>${fn('R')}${fn('G')}${fn('B')}</feComponentTransfer>` +
    spots +
    `<feComponentTransfer in='p2'><feFuncA type='linear' slope='0' intercept='${opacity.toFixed(3)}'/></feComponentTransfer>` +
    `</filter><rect width='100%' height='100%' filter='url(#p)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Wear's aged edges: a warm darkening that gathers at the note's edges,
 *  over the whole note (not tiled), in the same hard-light layer. */
export function wearImage(wear: number): string {
  if (wear <= 0) return 'none';
  const a = (0.42 * wear).toFixed(3);
  return `radial-gradient(ellipse 72% 68% at 50% 46%, rgba(128, 128, 128, 0) 62%, rgba(92, 74, 50, ${a}) 100%)`;
}
