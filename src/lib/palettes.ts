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

export const PALETTES: Palette[] = [
  { id: 'paper',     name: 'Paper',     bg: '#FBFAF6', header: '#F1EFE8', fg: '#2A2C2E', accent: '#5B7CFA' },
  { id: 'sunflower', name: 'Sunflower', bg: '#FDF2C0', header: '#F5E7A4', fg: '#46401F', accent: '#B98F0A' },
  { id: 'coral',     name: 'Coral',     bg: '#FCE4DB', header: '#F8D2C4', fg: '#54301F', accent: '#D96B48' },
  { id: 'mint',      name: 'Mint',      bg: '#E0F3E9', header: '#CCEADA', fg: '#1F4535', accent: '#2FA579' },
  { id: 'sky',       name: 'Sky',       bg: '#E1EEFA', header: '#CDE2F5', fg: '#1E3A52', accent: '#3E8FD8' },
  { id: 'lavender',  name: 'Lavender',  bg: '#EBE6F9', header: '#DDD4F4', fg: '#372C5A', accent: '#7C63E0' },
  { id: 'rose',      name: 'Rose',      bg: '#FAE4EE', header: '#F6D1E3', fg: '#522A40', accent: '#D8579B' },
  { id: 'graphite',  name: 'Graphite',  bg: '#292C31', header: '#32363C', fg: '#E6E8EB', accent: '#82A9F2', dark: true },
  { id: 'ink',       name: 'Ink',       bg: '#202B3A', header: '#28374A', fg: '#DBE5F1', accent: '#63C7F5', dark: true },
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
