// The five custom slots: each holds a colour of your own or a pattern (an 8×8
// tile you paint, in a background and a dot colour you choose). They live in
// settings (so they sync); a pattern note refers to its slot as `upat:<n>` —
// restyle the slot, every note on it follows, the way a theme would. A colour
// slot is just a keeper: picking it gives the note `custom:<hex>`.

import { mixHex } from './palettes';

export const PATTERN_SLOTS = 5;
export const COLOR_SLOTS = 5;
export const TILE = 8;

export interface CustomPattern {
  /** 64 chars of '0'/'1', row-major, top-left first. */
  px: string;
  /** #rrggbb. Older patterns' single colour, their palette derived from it;
   *  kept (= bg) on new ones so older app versions still read them. */
  tint: string;
  /** The background (title bar and note) and the dots, chosen directly. */
  bg?: string;
  ink?: string;
  /** A plain colour kept in the slot: no dots; picking it gives custom:<bg>. */
  solid?: boolean;
}

/** Readable text on a background: dark on light, light on dark. */
export function textOn(bg: string): string {
  const n = parseInt(bg.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.55 ? '#ECEDEF' : '#26282B';
}

/** A slot's note palette: its own two colours, exactly (the title bar is the
 *  background as chosen, no darker), or an older slot's derived tint. */
export function paletteFromSlot(p: CustomPattern) {
  if (p.bg && p.ink) return { bg: p.bg, header: p.bg, fg: textOn(p.bg), ink: p.ink, inkStrong: p.ink };
  return paletteFromTint(p.tint);
}

export const EMPTY_PX = '0'.repeat(TILE * TILE);

/**
 * The tile as an SVG data URL: one <rect> per lit cell, crisp edges, no base
 * fill (the element's background-color is the base). At 16px per tile that is
 * two screen pixels per cell, matching the built-in patterns' 2px unit.
 */
export function patternSvg(px: string, ink: string): string {
  let rects = '';
  for (let i = 0; i < TILE * TILE; i++) {
    if (px[i] === '1') rects += `<rect x="${i % TILE}" y="${Math.floor(i / TILE)}" width="1" height="1"/>`;
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}" shape-rendering="crispEdges" fill="${ink}">` +
    rects +
    '</svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * One tint → a readable note. The background is a pale wash of the tint,
 * the header a little stronger, text stays dark, and the pixels are the tint
 * itself (softened a touch so a busy tile doesn't shout over the title).
 */
export function paletteFromTint(tint: string) {
  const paper = '#FBFAF6';
  const bg = mixHex(tint, paper, 0.16);
  const header = mixHex(tint, paper, 0.3);
  const ink = mixHex(tint, header, 0.72);
  const inkStrong = mixHex(tint, header, 0.9);
  return { bg, header, fg: '#2A2C2E', ink, inkStrong };
}

// ---- registry: the current slots, kept in step with settings by +layout ----
// Reactive state, so any $derived that calls getPalette() recomputes the
// moment a slot is painted or reset — without it, a note pointed at a
// brand-new slot stayed Paper until something else re-rendered it.
let slots = $state<(CustomPattern | null)[]>([]);

export function setCustomPatterns(list: (CustomPattern | null)[] | undefined): void {
  slots = Array.from({ length: PATTERN_SLOTS }, (_, i) => list?.[i] ?? null);
}

export function getCustomPattern(i: number): CustomPattern | null {
  return slots[i] ?? null;
}

export function customPatternId(i: number): string {
  return `upat:${i}`;
}

/** Slot index for a `upat:<n>` id, or -1. */
export function customPatternSlot(id: string): number {
  const m = /^upat:(\d)$/.exec(id ?? '');
  return m ? Number(m[1]) : -1;
}
