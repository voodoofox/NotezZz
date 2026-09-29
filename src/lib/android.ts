// The Android app's JavaScript bridge (MainActivity.Bridge, window.NotezzzAndroid).
// Quick answers come back directly; slow ones (Google sign-in, an update
// download) take a request id and answer later through window.__nzReply, which
// settles the promise registered here. Absent everywhere but the Android app.

export interface AndroidBridge {
  safeTop(): number;
  safeBottom?(): number;
  setDarkTheme(dark: boolean): void;
  refreshWidgets?(): void;
  googleAccount?(): string;
  googleToken?(id: number, interactive: boolean, invalidate: string): void;
  googleSignOut?(id: number, token: string): void;
  installApk?(id: number, url: string): void;
}

type Pending = {
  resolve: (value: string) => void;
  reject: (e: Error) => void;
  progress?: (percent: number) => void;
};

type Hooks = {
  NotezzzAndroid?: AndroidBridge;
  __nzReply?: (id: number, ok: boolean, value: string) => void;
  __nzProgress?: (id: number, percent: number) => void;
};

const pending = new Map<number, Pending>();
let seq = 0;

export function androidBridge(): AndroidBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Hooks).NotezzzAndroid;
}

function hooks() {
  const w = window as unknown as Hooks;
  w.__nzReply ??= (id, ok, value) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(value);
    else p.reject(new Error(value));
  };
  w.__nzProgress ??= (id, percent) => pending.get(id)?.progress?.(percent);
}

/**
 * Call an async bridge method: `start(id)` fires it, the promise settles when
 * Kotlin replies with that id. Rejects at once if the method is missing (an
 * older app build).
 */
export function androidCall(
  start: (bridge: AndroidBridge, id: number) => void,
  progress?: (percent: number) => void
): Promise<string> {
  const bridge = androidBridge();
  if (!bridge) return Promise.reject(new Error('Not running in the Android app'));
  hooks();
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    try {
      start(bridge, id);
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
