// Sticky-note color palettes. Each note picks one by id. Colors are chosen to be
// legible with dark text; `dark` palettes carry light text via `fg`.

export interface Palette {
  id: string;
  name: string;
  /** Note background (solid). */
  bg: string;
  /** Slightly darker header/toolbar strip. */
  header: string;
  /** Text color. */
  fg: string;
  /** Palette data only — UI chrome never uses it (active states invert fg/bg). */
  accent: string;
  /** True for dark-on-light inversion. */
  dark?: boolean;
  /** Pixel pattern painted over the header and list selection (see app.css). */
  pattern?: PatternId;
  /** Pattern pixel colour on the header (fg mixed into header). Precomputed:
   *  the paint path must not depend on color-mix() resolving at runtime. */
  ink?: string;
  /** Stronger mix for small areas (list swatch, picker chip). */
  inkStrong?: string;
}

export type PatternId = 'checker' | 'stripes' | 'dots' | 'stairs' | 'bricks';

// The seven hues are evenly stepped around the color wheel (15° → 330°) with
// IDENTICAL saturation/lightness (hsl S60 L85 bg, S55 L78 header, S35 L20
// hue-matched text) — a color-theory-consistent set. Paper and Graphite
// bookend it as the neutral light/dark options.
export const PALETTES: Palette[] = [
  { id: 'paper',     name: 'Paper',     bg: '#FBFAF6', header: '#F1EFE8', fg: '#2A2C2E', accent: '#5B7CFA' },
  { id: 'coral',     name: 'Coral',     bg: '#F0CDC2', header: '#E6B7A8', fg: '#452A21', accent: '#A64E30' },
  { id: 'sunflower', name: 'Sunflower', bg: '#F0E7C2', header: '#E6D9A8', fg: '#453E21', accent: '#A68E30' },
  { id: 'lime',      name: 'Lime',      bg: '#D9F0C2', header: '#C7E6A8', fg: '#334521', accent: '#6BA630' },
  { id: 'teal',      name: 'Teal',      bg: '#C2F0EC', header: '#A8E6E1', fg: '#214542', accent: '#30A69C' },
  { id: 'sky',       name: 'Sky',       bg: '#C2D9F0', header: '#A8C7E6', fg: '#213345', accent: '#306BA6' },
  { id: 'lavender',  name: 'Lavender',  bg: '#D3C2F0', header: '#BFA8E6', fg: '#2E2145', accent: '#5B30A6' },
  { id: 'rose',      name: 'Rose',      bg: '#F0C2D9', header: '#E6A8C7', fg: '#452133', accent: '#A6306B' },
  { id: 'graphite',  name: 'Graphite',  bg: '#292C31', header: '#32363C', fg: '#E6E8EB', accent: '#82A9F2', dark: true },
];

export const PALETTE_MAP = new Map(PALETTES.map((p) => [p.id, p]));

/**
 * Patterns: the third row of the picker. Each is a pixel texture (drawn in
 * app.css as `.nz-pat-<id>`) that animates across the note's title bar and
 * its row in the list when selected. The body stays a flat colour so text
 * stays readable; the pattern is the note's identity, not its wallpaper.
 * Ids are `pattern:<id>`, alongside `custom:<hex>`.
 */
export const PATTERNS: Palette[] = [
  { id: 'pattern:checker', name: 'Checker', pattern: 'checker', bg: '#D3C2F0', header: '#C3AEE6', fg: '#2E2145', accent: '#2E2145' },
  { id: 'pattern:stripes', name: 'Stripes', pattern: 'stripes', bg: '#F0E7C2', header: '#E3D6A0', fg: '#453E21', accent: '#453E21' },
  { id: 'pattern:dots',    name: 'Dots',    pattern: 'dots',    bg: '#F0C2D9', header: '#E3A4C1', fg: '#452133', accent: '#452133' },
  { id: 'pattern:stairs',  name: 'Stairs',  pattern: 'stairs',  bg: '#C2D9F0', header: '#A3C2E2', fg: '#213345', accent: '#213345' },
  { id: 'pattern:bricks',  name: 'Bricks',  pattern: 'bricks',  bg: '#F0CDC2', header: '#E2B1A2', fg: '#452A21', accent: '#452A21' },
];
for (const p of PATTERNS) {
  p.ink = mixHex(p.fg, p.header, 0.28);
  p.inkStrong = mixHex(p.fg, p.header, 0.42);
}
const PATTERN_MAP = new Map(PATTERNS.map((p) => [p.id, p]));

/** `t` of colour a mixed into colour b, both #rrggbb. */
function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return (
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(ch(a, i) * t + ch(b, i) * (1 - t))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

export function getPalette(id: string): Palette {
  if (id?.startsWith('custom:')) return customPalette(id.slice(7));
  // Retired ids (mint) fall back to Paper rather than breaking old notes.
  return PALETTE_MAP.get(id) ?? PATTERN_MAP.get(id) ?? PALETTES[0];
}

/** Any hex from the color picker becomes a full note palette: contrast-safe
 * text color and a slightly shifted header derived automatically. */
function customPalette(hex: string): Palette {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const dark = lum < 0.55;
  const shift = dark ? 18 : -14; // lighten dark headers, darken light ones
  const clamp = (v: number) => Math.max(0, Math.min(255, v + shift));
  const header = `#${[clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
  const fg = dark ? '#ECEDEF' : '#26282B';
  return { id: `custom:${hex}`, name: 'Custom', bg: hex, header, fg, accent: fg, dark };
}

/** HSL (0-360, 0-100, 0-100) → "#rrggbb". Drives the custom colour sliders. */
export function hslToHex(h: number, s: number, l: number): string {
  const a = (s * Math.min(l, 100 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) / 100;
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Inverse of hslToHex, so the sliders can open ON the note's current custom
 * colour instead of their defaults (which used to snap the note to a
 * different colour on the first nudge). Null for anything that isn't #rrggbb.
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}
