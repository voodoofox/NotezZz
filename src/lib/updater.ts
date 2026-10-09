// Self-update for the apps, both fed by GitHub Releases.
//
// Desktop: the check and install run in Rust (src-tauri/src/updates.rs), which
// reads the release's signed latest.json and runs the installer.
// Android: the page reads the latest release from GitHub's API, and the
// Kotlin side downloads its APK and opens Android's installer (ApkUpdater.kt);
// Android verifies the APK is signed with our key. No-op on the web, which
// reloads onto new deploys by itself.

import { isDesktop, isMobile } from './storage/backend';
import { androidBridge, androidCall, fromPlay } from './android';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; version: string }
  | { kind: 'available'; version: string; notes?: string }
  | { kind: 'installing'; percent: number }
  | { kind: 'restart' }
  /** Android: the system installer is on screen; the user finishes there. */
  | { kind: 'handoff' }
  | { kind: 'error'; message: string };

type Info = { version: string; body?: string | null } | null;

const LATEST_RELEASE = 'https://api.github.com/repos/voodoofox/NotezZz/releases/latest';

/** "0.20.3" > "0.20.2"; numeric per part, missing parts count as 0. */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** The APK attached to the newest release, when it is newer than this app. */
let androidApk: { version: string; url: string } | null = null;

async function checkAndroid(): Promise<UpdateState> {
  if (typeof androidBridge()?.installApk !== 'function' || fromPlay()) return { kind: 'idle' };
  try {
    const res = await fetch(`${LATEST_RELEASE}?ts=${Date.now()}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const rel = (await res.json()) as {
      tag_name: string;
      body?: string;
      assets: { name: string; browser_download_url: string }[];
    };
    const version = rel.tag_name.replace(/^v/, '');
    // A release gets its APK a little after the desktop build; until then
    // there is nothing for a phone to install.
    const apk = rel.assets.find((a) => /android.*\.apk$/i.test(a.name));
    if (!apk || !isNewer(version, __APP_VERSION__)) {
      androidApk = null;
      return { kind: 'none', version: __APP_VERSION__ };
    }
    androidApk = { version, url: apk.browser_download_url };
    return { kind: 'available', version, notes: rel.body };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

async function installAndroid(onProgress: (percent: number) => void): Promise<UpdateState> {
  if (!androidApk) {
    const r = await checkAndroid();
    if (r.kind !== 'available') return r;
  }
  const { url } = androidApk!;
  try {
    await androidCall((b, id) => b.installApk!(id, url), onProgress);
    return { kind: 'handoff' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'permission') {
      return {
        kind: 'error',
        message: 'Allow NotezZz to install updates in the screen that opened, then tap Install again.',
      };
    }
    return { kind: 'error', message: msg };
  }
}

/** Ask whether a newer build exists. */
export async function checkForUpdate(): Promise<UpdateState> {
  if (isMobile()) return checkAndroid();
  if (!isDesktop()) return { kind: 'idle' };
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
 * On Android it resolves once the system installer is showing.
 */
export async function installUpdate(onProgress: (percent: number) => void): Promise<UpdateState> {
  if (isMobile()) return installAndroid(onProgress);
  if (!isDesktop()) return { kind: 'idle' };
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
  if (!isDesktop()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
