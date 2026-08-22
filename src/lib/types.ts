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
}

export const DEFAULT_SETTINGS: Settings = {
  defaultPaletteId: 'sunflower',
  defaultFontSize: 18,
  appTheme: 'light',
  autostart: false,
  syncFolder: null,
};

export function newNote(partial: Partial<Note> = {}): Note {
  const now = Date.now();
  return {
    id: cryptoId(),
    title: '',
    contentHtml: '',
    paletteId: 'sunflower',
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
