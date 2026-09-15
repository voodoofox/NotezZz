// Core data model. These shapes are what get persisted (as one JSON file per
// note on desktop, or one Drive file per note on web). Keep them serializable.

/** Default body font size (px). The FontSize extension renders sizes as em
 *  relative to this, so the base-size slider is a true text zoom. */
export const BASE_FONT_PX = 18;

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
  /** Sticky tilt in degrees, rolled fresh each time the note is pinned. */
  tilt?: number;
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
  /** Note ids in the order the user arranged them; unlisted notes lead. */
  noteOrder?: string[];
  /** First-run welcome notes have been written; never write them again. */
  seeded?: boolean;
  /** Ctrl+Alt+N anywhere on the desktop drops a new sticky under the cursor. Off unless asked for. */
  hotkeyNewNote?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultPaletteId: 'paper',
  defaultFontSize: BASE_FONT_PX,
  appTheme: 'light',
  autostart: false,
  syncFolder: null,
  stickyTilt: false,
  hotkeyNewNote: false,
};

/**
 * A fresh sticky angle, rolled when a note is pinned — so re-pinning gives it
 * a new lean, the way putting a note back on a wall would. Range -1.8° to
 * +1.8°: enough to read as hand-placed, little enough to stay legible.
 */
export function rollTilt(): number {
  return Math.round((Math.random() * 3.6 - 1.8) * 10) / 10;
}

export function newNote(partial: Partial<Note> = {}): Note {
  const now = Date.now();
  return {
    id: cryptoId(),
    title: '',
    contentHtml: '',
    paletteId: 'paper',
    fontSize: BASE_FONT_PX,
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
