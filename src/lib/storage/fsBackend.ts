// Desktop filesystem backend. Delegates to Rust commands that read/write the
// sync (Google Drive) folder — one JSON file per note under notes/, plus
// settings.json. Google Drive Desktop then syncs those files everywhere.

import { invoke } from '@tauri-apps/api/core';
import type { Note, Settings } from '../types';
import type { StorageBackend } from './backend';

export class FsBackend implements StorageBackend {
  readonly kind = 'fs' as const;

  async listNotes(): Promise<Note[]> {
    return await invoke<Note[]>('list_notes');
  }

  async saveNote(note: Note): Promise<void> {
    await invoke('save_note', { note });
  }

  async deleteNote(id: string): Promise<void> {
    await invoke('delete_note', { id });
  }

  async loadSettings(): Promise<Settings | null> {
    return (await invoke<Settings | null>('load_settings')) ?? null;
  }

  async saveSettings(settings: Settings): Promise<void> {
    await invoke('save_settings', { settings });
  }
}
