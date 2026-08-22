// Desktop-only helpers (sticky windows, sync folder). Every function is a no-op
// off the Tauri shell, so the same UI code runs unchanged in the browser/web.

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './storage/backend';
import type { Note } from './types';

function stickyLabel(id: string): string {
  return `sticky-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export async function openSticky(note: Note): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = stickyLabel(note.id);

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }

  // Creating the window from the frontend dispatches correctly to the event
  // loop (unlike a Rust command, which deadlocks on window creation).
  const win = new WebviewWindow(label, {
    url: 'sticky',
    title: 'NotezZz',
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    width: note.win?.w ?? 260,
    height: note.win?.h ?? 260,
    x: note.win?.x,
    y: note.win?.y,
    minWidth: 170,
    minHeight: 130,
  });
  win.once('tauri://error', (e) => console.error('sticky window error', e.payload));
}

export async function closeSticky(id: string): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = await WebviewWindow.getByLabel(stickyLabel(id));
  if (win) await win.close();
}

/** Open sticky windows for every pinned note (called once at startup). */
export async function restoreStickies(notes: Note[]): Promise<void> {
  if (!isTauri()) return;
  for (const n of notes) {
    if (n.pinned) await openSticky(n);
  }
}

/** Prompt for a sync folder and persist it. Returns the chosen path or null. */
export async function chooseSyncFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: 'Choose sync folder' });
  if (typeof picked !== 'string') return null;
  await invoke('set_sync_folder', { path: picked });
  return picked;
}

export async function getSyncFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  return (await invoke<string | null>('get_sync_folder')) ?? null;
}
