// Core data model. These shapes are what get persisted (as one JSON file per
// note on desktop, or one Drive file per note on web). Keep them serializable.

export interface Note {
  id: string;
  title: string;
  /** Rich text stored as HTML (TipTap output). */
  contentHtml: string;
  /** Id of a palette from src/lib/palettes.ts */
  paletteId: string;
  /** Base font size in px applied to the note body. */
  fontSize: number;
  /** Pinned notes float on the desktop as always-on-top sticky windows. */
  pinned: boolean;
  /** Window opacity 0.2 - 1 for the sticky window (desktop only). */
  opacity: number;
  /** Desktop sticky window geometry (nullable until first pinned). */
  win: { x: number; y: number; w: number; h: number } | null;
  createdAt: number;
  updatedAt: number;
  /** Soft-delete flag so sync can propagate deletions safely. */
  deleted?: boolean;
}

export interface Settings {
  /** Default palette for new notes. */
  defaultPaletteId: string;
  /** Default font size for new notes. */
  defaultFontSize: number;
  /** App-wide theme for the management window. */
  appTheme: 'light' | 'dark';
  /** Launch on system startup (desktop). */
  autostart: boolean;
  /** Absolute path to the Drive sync folder (desktop). */
  syncFolder: string | null;
  /** Tilt pinned stickies by a small per-note angle (desktop only). */
  stickyTilt?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultPaletteId: 'paper',
  defaultFontSize: 18,
  appTheme: 'light',
  autostart: false,
  syncFolder: null,
  stickyTilt: false,
};

/**
 * A small, stable tilt for a pinned sticky, derived from its id — so a note
 * keeps the same angle forever and across devices without storing anything.
 * Range is -1.8° to +1.8°, and the hash is properly avalanched: a plain
 * multiply-add over similar ids clustered on one side, so every sticky
 * leaned the same way.
 */
export function tiltFor(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h >>>= 0;
  return ((h % 37) - 18) / 10;
}

export function newNote(partial: Partial<Note> = {}): Note {
  const now = Date.now();
  return {
    id: cryptoId(),
    title: '',
    contentHtml: '',
    paletteId: 'paper',
    fontSize: 18,
    pinned: false,
    opacity: 1,
    win: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** URL-safe unique id without external deps. */
function cryptoId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
