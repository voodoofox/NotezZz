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
  { id: 'sunflower', name: 'Sunflower', bg: '#FFF4B8', header: '#FCE98A', fg: '#3B3418', accent: '#C79A00' },
  { id: 'coral',     name: 'Coral',     bg: '#FFD9CE', header: '#FFC2B0', fg: '#4A2419', accent: '#E05A38' },
  { id: 'mint',      name: 'Mint',      bg: '#CFF3E1', header: '#B5EAD1', fg: '#123A2C', accent: '#159C6B' },
  { id: 'sky',       name: 'Sky',       bg: '#D3EBFF', header: '#B9DEFF', fg: '#12324A', accent: '#2F8FE0' },
  { id: 'lavender',  name: 'Lavender',  bg: '#E4DBFF', header: '#D4C6FF', fg: '#2E2450', accent: '#7A5AF0' },
  { id: 'rose',      name: 'Rose',      bg: '#FFD6E8', header: '#FFBFDA', fg: '#4A1B32', accent: '#E23C86' },
  { id: 'sand',      name: 'Sand',      bg: '#EDE3D3', header: '#E0D2BB', fg: '#3D3323', accent: '#B08A4F' },
  { id: 'graphite',  name: 'Graphite',  bg: '#2B2E33', header: '#34383E', fg: '#E8EAED', accent: '#7FB2FF', dark: true },
  { id: 'ink',       name: 'Ink',       bg: '#1E2A3A', header: '#26374C', fg: '#DCE6F2', accent: '#66D0FF', dark: true },
];

export const PALETTE_MAP = new Map(PALETTES.map((p) => [p.id, p]));

export function getPalette(id: string): Palette {
  return PALETTE_MAP.get(id) ?? PALETTES[0];
}
