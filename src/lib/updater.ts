// Desktop self-update. The check and install run in Rust (src-tauri/src/
// updates.rs) so the manifest URL can be cache-busted past the site's front
// proxy; this file is the thin client. No-op off the desktop.

import { isTauri } from './storage/backend';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; version: string }
  | { kind: 'available'; version: string; notes?: string }
  | { kind: 'installing'; percent: number }
  | { kind: 'restart' }
  | { kind: 'error'; message: string };

type Info = { version: string; body?: string | null } | null;

/** Ask the site whether a newer build exists. */
export async function checkForUpdate(): Promise<UpdateState> {
  if (!isTauri()) return { kind: 'idle' };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const info = await invoke<Info>('check_update');
    if (!info) return { kind: 'none', version: __APP_VERSION__ };
    return { kind: 'available', version: info.version, notes: info.body ?? undefined };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Download, verify and install, reporting progress. On Windows the process
 * exits as the installer starts and the installer relaunches the app, so a
 * resolved promise here means the install was declined or failed to start.
 */
export async function installUpdate(onProgress: (percent: number) => void): Promise<UpdateState> {
  if (!isTauri()) return { kind: 'idle' };
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const stop = await listen<{ done: number; total: number | null }>('update-progress', (e) => {
    const { done, total } = e.payload;
    if (total) onProgress(Math.min(99, Math.round((done / total) * 100)));
  });
  try {
    await invoke('install_update');
    onProgress(100);
    return { kind: 'restart' };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  } finally {
    stop();
  }
}

export async function relaunch(): Promise<void> {
  if (!isTauri()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
