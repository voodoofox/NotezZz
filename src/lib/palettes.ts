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
  /** Accent for links / active toolbar buttons. */
  accent: string;
  /** True for dark-on-light inversion. */
  dark?: boolean;
}

// The seven hues are evenly stepped around the color wheel (15° → 330°) with
// IDENTICAL saturation/lightness (hsl S60 L85 bg, S55 L78 header, S35 L20
// hue-matched text) — a color-theory-consistent set. Paper and Graphite
// bookend it as the neutral light/dark options.
export const PALETTES: Palette[] = [
  { id: 'paper',     name: 'Paper',     bg: '#FBFAF6', header: '#F1EFE8', fg: '#2A2C2E', accent: '#5B7CFA' },
  { id: 'coral',     name: 'Coral',     bg: '#F0CDC2', header: '#E6B7A8', fg: '#452A21', accent: '#A64E30' },
  { id: 'sunflower', name: 'Sunflower', bg: '#F0E7C2', header: '#E6D9A8', fg: '#453E21', accent: '#A68E30' },
  { id: 'mint',      name: 'Mint',      bg: '#C2F0CD', header: '#A8E6B7', fg: '#21452A', accent: '#30A64E' },
  { id: 'teal',      name: 'Teal',      bg: '#C2F0EC', header: '#A8E6E1', fg: '#214542', accent: '#30A69C' },
  { id: 'sky',       name: 'Sky',       bg: '#C2D9F0', header: '#A8C7E6', fg: '#213345', accent: '#306BA6' },
  { id: 'lavender',  name: 'Lavender',  bg: '#D3C2F0', header: '#BFA8E6', fg: '#2E2145', accent: '#5B30A6' },
  { id: 'rose',      name: 'Rose',      bg: '#F0C2D9', header: '#E6A8C7', fg: '#452133', accent: '#A6306B' },
  { id: 'graphite',  name: 'Graphite',  bg: '#292C31', header: '#32363C', fg: '#E6E8EB', accent: '#82A9F2', dark: true },
];

export const PALETTE_MAP = new Map(PALETTES.map((p) => [p.id, p]));

export function getPalette(id: string): Palette {
  if (id?.startsWith('custom:')) return customPalette(id.slice(7));
  return PALETTE_MAP.get(id) ?? PALETTES[0];
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
