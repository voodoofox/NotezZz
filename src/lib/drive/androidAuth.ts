// Android half of Google auth: native sign-in through Play services
// (GoogleSignIn.kt). Android's own account sheet asks once; after that tokens
// arrive silently, with no browser trip and no client secret in the app.
//
// Builds before 0.21 signed in through the desktop's browser flow, whose
// tokens Rust still holds. Such a phone counts as signed in, and its first
// token request shows the consent sheet once; the Rust tokens are then
// dropped. desktopAuth.ts routes here on Android.

import { invoke } from '@tauri-apps/api/core';
import { androidBridge, androidCall } from '../android';
import { DRIVE_NOT_GRANTED, DriveAccessError } from './driveAccess';

/** Play services hands out ~1h tokens; reuse one well inside that. */
const TOKEN_TTL_MS = 45 * 60 * 1000;

/** Kept across launches for its short life: a relaunch within it needs no
 *  Google round-trip at all (each one could flash Play services' window). */
const SAVED_KEY = 'notezzz:android:tok';
function loadSaved(): { token: string; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as { token?: string; at?: number } | null;
    return v?.token && typeof v.at === 'number' ? { token: v.token, at: v.at } : null;
  } catch {
    return null;
  }
}
let cached: { token: string; at: number } | null = loadSaved();
/** Every change to the token goes through here, so the saved copy follows. */
function setCached(v: { token: string; at: number } | null): void {
  cached = v;
  try {
    if (v) localStorage.setItem(SAVED_KEY, JSON.stringify(v));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    /* no storage: memory only */
  }
}
let inflight: Promise<string> | null = null;
/** A token Drive refused for lacking the Drive permission: invalidated in
 * Play services' cache on the next request. */
let dropped = '';

/** Is this the Android app with native sign-in? (False on older app builds.) */
export function androidAuthAvailable(): boolean {
  return typeof androidBridge()?.googleAccount === 'function';
}

function nativeAccount(): { signedIn: boolean; email: string } {
  try {
    return JSON.parse(androidBridge()?.googleAccount?.() ?? '{}');
  } catch {
    return { signedIn: false, email: '' };
  }
}

/** The account signed in with the old browser flow, if any (Rust's tokens). */
async function legacyAccount(): Promise<string | null> {
  return invoke<string | null>('google_account').catch(() => null);
}

/** Signed-in address; '' when signed in but the address couldn't be read; null when signed out. */
export async function androidAccount(): Promise<string | null> {
  const a = nativeAccount();
  if (a.signedIn) return a.email;
  return legacyAccount();
}

async function request(interactive: boolean, invalidate: string): Promise<{ token: string; email: string }> {
  try {
    const raw = await androidCall((b, id) => b.googleToken!(id, interactive, invalidate));
    return JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'consent_required') {
      throw new Error('Google access needs to be granted again (access token unavailable). Tap Reconnect.');
    }
    if (msg === 'cancelled') throw new Error('Google sign-in was cancelled.');
    if (msg === DRIVE_NOT_GRANTED) throw new DriveAccessError();
    throw new Error(`Google sign-in failed: ${msg}`);
  }
}

/**
 * A valid access token. `fresh` is for a token Drive just rejected: it is
 * dropped from Play services' cache and a new one fetched.
 */
export function androidToken(opts: { fresh?: boolean } = {}): Promise<string> {
  if (!opts.fresh && cached && Date.now() - cached.at < TOKEN_TTL_MS) return Promise.resolve(cached.token);
  // Startup fires several Drive calls at once; they share one request.
  if (inflight && !opts.fresh) return inflight;
  const stale = (opts.fresh ? (cached?.token ?? '') : '') || dropped;
  dropped = '';
  setCached(null);
  const run = (async () => {
    let interactive = false;
    if (!nativeAccount().signedIn) {
      if ((await legacyAccount()) == null) {
        throw new Error('Not signed in to Google (access token unavailable).');
      }
      interactive = true; // the one-time move from the old browser sign-in
    }
    const r = await request(interactive, stale);
    setCached({ token: r.token, at: Date.now() });
    if (interactive) void invoke('google_sign_out').catch(() => {});
    return r.token;
  })();
  inflight = run;
  run.finally(() => {
    if (inflight === run) inflight = null;
  }).catch(() => {});
  return run;
}

/** Interactive sign-in: Android's account sheet. Resolves to the address ('' if unreadable). */
export async function androidSignIn(): Promise<string> {
  const r = await request(true, '');
  setCached({ token: r.token, at: Date.now() });
  void invoke('google_sign_out').catch(() => {}); // any old browser-flow tokens
  return r.email;
}

/** Forget the current token: Drive refused it for lacking the Drive permission. */
export function androidDropToken(): void {
  dropped = cached?.token ?? dropped;
  setCached(null);
}

export async function androidSignOut(): Promise<void> {
  const token = cached?.token ?? '';
  setCached(null);
  await androidCall((b, id) => b.googleSignOut!(id, token));
  await invoke('google_sign_out').catch(() => {});
}
