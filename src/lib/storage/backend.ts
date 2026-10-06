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
  /**
   * Before a write: the stored copy if it may hold changes this device hasn't
   * seen, 'seen' if it can't (nobody wrote it since we last read or wrote
   * it), null if there is none. Backends without it use getNote.
   */
  storedCopy?(id: string): Promise<Note | null | 'seen'>;
  saveNote(note: Note): Promise<void>;
  deleteNote(id: string): Promise<void>;
  loadSettings(): Promise<Settings | null>;
  saveSettings(settings: Settings): Promise<void>;
  /** Drive only: where the notes live, for the Android background refresh. */
  driveIds?(): { notesFolderId: string | null; settingsId: string | null };
}

// Three platforms, two questions. isTauri() answers "is Rust on the other
// side?" — fs backend, Rust-managed Google auth, no web sign-in gate, no
// service worker. isDesktop() answers "is this a PC?" — sticky windows, tray,
// global hotkey, self-updater, autostart, sync-folder picker. The Android app
// is Tauri but not desktop; before isMobile() existed every isTauri() check
// meant both, and the phone build would have tried to open WebviewWindows.

/** True inside any Tauri shell: the Windows desktop app or the Android app. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Tauri on a phone or tablet: one fullscreen window, no desktop to pin to. */
export function isMobile(): boolean {
  return isTauri() && /Android|iPhone|iPad/i.test(navigator.userAgent);
}

/** Tauri on a PC — the only place window, tray and updater APIs exist. */
export function isDesktop(): boolean {
  return isTauri() && !isMobile();
}
