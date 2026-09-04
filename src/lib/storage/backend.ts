// Storage abstraction. Three implementations share this interface:
//   - localStorage (browser dev / fallback)      -> ./localBackend.ts
//   - Tauri filesystem (desktop, local Drive dir) -> ./fsBackend.ts   (later)
//   - Google Drive API (web build)                -> ./driveBackend.ts (later)
//
// The Drive folder is the single source of truth; desktop reads it as local
// files (synced by Google Drive Desktop) and web reads it via the Drive API.

import type { Note, Settings } from '../types';

export interface StorageBackend {
  readonly kind: 'local' | 'fs' | 'drive';
  listNotes(): Promise<Note[]>;
  /** One note, fresh from storage. Backends without a cheap single read may omit it. */
  getNote?(id: string): Promise<Note | null>;
  saveNote(note: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  loadSettings(): Promise<Settings | null>;
  saveSettings(settings: Settings): Promise<void>;
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
