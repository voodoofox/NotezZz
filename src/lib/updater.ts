// Desktop self-update (tauri-plugin-updater). The app asks the site for
// latest.json, verifies the installer's signature against the public key baked
// into tauri.conf.json, and installs. No-op off the desktop.

import { isTauri } from './storage/backend';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; version: string }
  | { kind: 'available'; version: string; notes?: string }
  | { kind: 'installing'; percent: number }
  | { kind: 'restart' }
  | { kind: 'error'; message: string };

/** Ask the site whether a newer build exists. */
export async function checkForUpdate(): Promise<UpdateState> {
  if (!isTauri()) return { kind: 'idle' };
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 15_000 });
    if (!update) return { kind: 'none', version: __APP_VERSION__ };
    return { kind: 'available', version: update.version, notes: update.body ?? undefined };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Download, verify and install the update, reporting progress. Resolves
 * with 'restart' once the installer has run; the caller offers a relaunch.
 */
export async function installUpdate(onProgress: (percent: number) => void): Promise<UpdateState> {
  if (!isTauri()) return { kind: 'idle' };
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 15_000 });
    if (!update) return { kind: 'none', version: __APP_VERSION__ };
    let total = 0;
    let done = 0;
    await update.downloadAndInstall((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
      else if (ev.event === 'Progress') {
        done += ev.data.chunkLength;
        if (total) onProgress(Math.min(99, Math.round((done / total) * 100)));
      } else if (ev.event === 'Finished') onProgress(100);
    });
    return { kind: 'restart' };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

export async function relaunch(): Promise<void> {
  if (!isTauri()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
