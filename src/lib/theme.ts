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
  /** How far up (or down) the note it reaches, as a share of its height. */
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
    /** The fades are ellipses centred on the bottom and top edges; this is
     *  their horizontal radius in note widths. Wide = edges that barely
     *  curve, like light on a gently bowed sheet. */
    spread: number;
    /** Paper grain over the whole note, 0..0.5 opacity. */
    grain: number;
    /** The title strip's opacity, 0..1 (1 = a solid band of the header colour). */
    header: number;
    /** The adhesive: a tint laid over the title strip (black darkens it on
     *  any note colour, light or dark). Strength 0 = none. */
    strip: { color: string; strength: number };
    /** The formatting bar's background, 0..1 (0 = just the buttons). */
    toolbar: number;
  };
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
  light: { color: '#ffffff', strength: 0, reach: 0.4 },
  shade: { color: '#000000', strength: 0, reach: 0.4 },
  curve: 4,
  spread: 2,
  grain: 0,
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
      light: { color: '#ffffff', strength: 0.096, reach: 0.6 },
      shade: { color: '#000000', strength: 0.16, reach: 0.4 },
      curve: 4,
      spread: 2,
      grain: 0.07,
      header: 0.075,
      strip: { color: '#000000', strength: 0.075 },
      toolbar: 0,
    },
    buttons: { ...LOGO_BUTTONS },
  },
  {
    id: 'flat',
    name: 'Flat',
    author: 'NotezZz',
    note: structuredClone(FLAT_NOTE),
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
    { format: FORMAT, version: VERSION, name: t.name, author: t.author, note: t.note, buttons: t.buttons },
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
    reach: clamp(o.reach, 0, 1, base.reach),
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
      grain: clamp(n.grain, 0, 0.5, FLAT_NOTE.grain),
      header: clamp(n.header, 0, 1, FLAT_NOTE.header),
      strip: {
        color: hex(obj(n.strip).color, FLAT_NOTE.strip.color),
        strength: clamp(obj(n.strip).strength, 0, 1, FLAT_NOTE.strip.strength),
      },
      toolbar: clamp(n.toolbar, 0, 1, FLAT_NOTE.toolbar),
    },
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
 * A fade from one edge of the note: `strength` at the edge, nothing at
 * `reach`, falling off along an exponential curve (straight when curve≈0).
 * It's an ellipse centred on that edge, `spread` note-widths wide and
 * `reach` tall, so its contours bow very slightly toward the corners.
 * CSS gradients only interpolate in straight lines, so the curve is laid
 * down as a run of stops.
 */
export function fadeGradient(edge: 'bottom' | 'top', f: Fade, curve: number, spread = 2): string {
  if (f.strength <= 0 || f.reach <= 0) return 'none';
  const [r, g, b] = rgb(f.color);
  const k = curve;
  const at = (t: number) => (k < 0.01 ? 1 - t : (Math.exp(-k * t) - Math.exp(-k)) / (1 - Math.exp(-k)));
  const steps = 12;
  const stops: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stops.push(`rgba(${r}, ${g}, ${b}, ${(f.strength * at(t)).toFixed(4)}) ${(t * 100).toFixed(2)}%`);
  }
  const size = `${+(spread * 100).toFixed(1)}% ${+(f.reach * 100).toFixed(1)}%`;
  return `radial-gradient(${size} at 50% ${edge === 'bottom' ? '100%' : '0%'}, ${stops.join(', ')})`;
}

/** Paper grain: a grey noise tile at the given opacity. */
export function grainImage(opacity: number): string {
  if (opacity <= 0) return 'none';
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>` +
    `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix type='saturate' values='0'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#g)' opacity='${opacity.toFixed(3)}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;

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
    '--note-grain': grainImage(n.grain),
    '--note-header-mix': pct(n.header),
    // Painted as an inset shadow, so it lies over the strip's colour AND any
    // pattern on it (both are background) and under the title and buttons.
    '--note-strip': stripShadow(n.strip),
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
}
