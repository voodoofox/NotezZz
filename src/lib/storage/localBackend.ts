// Browser localStorage backend. Used for dev preview and as an offline fallback
// for the web build before Drive sign-in. One key per note keeps writes cheap.

import type { Note, Settings } from '../types';
import type { StorageBackend } from './backend';

const NOTE_PREFIX = 'notezzz:note:';
const SETTINGS_KEY = 'notezzz:settings';

export class LocalBackend implements StorageBackend {
  readonly kind = 'local' as const;

  async listNotes(): Promise<Note[]> {
    const notes: Note[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(NOTE_PREFIX)) {
        try {
          const note = JSON.parse(localStorage.getItem(key)!) as Note;
          if (!note.deleted) notes.push(note);
        } catch {
          // Skip corrupt entries rather than crash the whole list.
        }
      }
    }
    return notes.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveNote(note: Note): Promise<void> {
    localStorage.setItem(NOTE_PREFIX + note.id, JSON.stringify(note));
  }

  async deleteNote(id: string): Promise<void> {
    localStorage.removeItem(NOTE_PREFIX + id);
  }

  async loadSettings(): Promise<Settings | null> {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Settings) : null;
  }

  async saveSettings(settings: Settings): Promise<void> {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
}
