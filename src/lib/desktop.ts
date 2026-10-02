// Desktop-only helpers (sticky windows, sync folder). Every function is a no-op
// off the desktop, so the same UI code runs unchanged in the browser/web AND
// in the Android app — which is Tauri too, but has no windows to open: a pin
// there means "show it on my PC", and the PC opens the sticky on its next poll.

import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './storage/backend';
import type { Note, Settings } from './types';

function stickyLabel(id: string): string {
  return `sticky-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

// ---- cross-window bus --------------------------------------------------
// Every window runs its own store and would otherwise only learn about an
// edit on its next poll — up to six seconds of a sticky showing the wrong
// colour, title or lean. These push it across immediately.

const BUS = 'notezzz:changed';
/** Identifies this window, so it can ignore the echo of its own broadcast. */
const senderId = Math.random().toString(36).slice(2);

export type Change = { from?: string; note?: Note; settings?: Settings };

export async function broadcastChange(change: Change): Promise<void> {
  if (!isDesktop()) return;
  const { emit } = await import('@tauri-apps/api/event');
  await emit(BUS, { ...change, from: senderId });
}

export async function onRemoteChange(cb: (c: Change) => void): Promise<void> {
  if (!isDesktop()) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen<Change>(BUS, (e) => {
    if (e.payload && e.payload.from !== senderId) cb(e.payload);
  });
}

/** Where this machine last put the sticky (device-local, never synced). */
function savedGeometry(id: string): { x: number; y: number; w: number; h: number } | null {
  try {
    const raw = localStorage.getItem(`notezzz:win:${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * A new sticky's size: wide enough for the whole formatting toolbar (389px
 * at the desktop's button size) and the header with room to spare, and tall
 * enough to read a note without scrolling. Was 260 x 260, where the toolbar
 * had to scroll. A sticky that was resized keeps its own size.
 */
export const STICKY_SIZE = { w: 420, h: 460 };

/**
 * `near` (logical px): where to put a sticky that has no remembered place —
 * a note created from another sticky's + button lands beside that sticky,
 * not wherever the default happens to be.
 */
export async function openSticky(note: Note, near?: { x: number; y: number }): Promise<void> {
  if (!isDesktop()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = stickyLabel(note.id);
  // Fall back to the note's legacy `win` field for stickies placed before
  // geometry moved out of the note.
  const geom = savedGeometry(note.id) ?? note.win;

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }

  // Creating the window from the frontend dispatches correctly to the event
  // loop (unlike a Rust command, which deadlocks on window creation).
  const win = new WebviewWindow(label, {
    // Versioned for the same reason the main window's URL is (see lib.rs):
    // WebView2 caches the app's pages across updates.
    url: `sticky?v=${__APP_VERSION__}`,
    title: 'NotezZz',
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    width: geom?.w ?? STICKY_SIZE.w,
    height: geom?.h ?? STICKY_SIZE.h,
    x: geom?.x ?? near?.x,
    y: geom?.y ?? near?.y,
    minWidth: 170,
    minHeight: 130,
  });
  win.once('tauri://error', (e) => console.error('sticky window error', e.payload));
}

/** Hide a sticky at once; used while its last write lands before closing. */
export async function hideSticky(id: string): Promise<void> {
  if (!isDesktop()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = await WebviewWindow.getByLabel(stickyLabel(id));
  if (win) await win.hide();
}

export async function closeSticky(id: string): Promise<void> {
  if (!isDesktop()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = await WebviewWindow.getByLabel(stickyLabel(id));
  if (win) await win.close();
}

/** Open sticky windows for every pinned note (called once at startup). */
export async function restoreStickies(notes: Note[], opts: { onlyMissing?: boolean } = {}): Promise<void> {
  if (!isDesktop()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  for (const n of notes) {
    if (!n.pinned) continue;
    // A second pass must not re-show and re-focus stickies already up.
    if (opts.onlyMissing && (await WebviewWindow.getByLabel(stickyLabel(n.id)))) continue;
    await openSticky(n);
  }
}

/** Prompt for a sync folder and persist it. Returns the chosen path or null. */
export async function chooseSyncFolder(): Promise<string | null> {
  if (!isDesktop()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: 'Choose sync folder' });
  if (typeof picked !== 'string') return null;
  await invoke('set_sync_folder', { path: picked });
  return picked;
}

export async function getSyncFolder(): Promise<string | null> {
  if (!isDesktop()) return null;
  return (await invoke<string | null>('get_sync_folder')) ?? null;
}
