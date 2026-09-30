// Google auth for the Tauri apps. On the desktop the Rust side owns the
// browser round-trip and refresh tokens (see src-tauri/src/gauth.rs); on
// Android, Play services does (androidAuth.ts, GoogleSignIn.kt). This is the
// one surface the rest of the app uses, so DriveBackend asks for a token the
// same way everywhere.

import { invoke } from '@tauri-apps/api/core';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../googleConfig';
import { isMobile } from '../storage/backend';
import {
  androidAccount,
  androidAuthAvailable,
  androidDropToken,
  androidSignIn,
  androidSignOut,
  androidToken,
} from './androidAuth';
import { DRIVE_NOT_GRANTED, DriveAccessError } from './driveAccess';

/** gauth.rs reports a grant without Drive as a bare code; give it words. */
function explain(e: unknown): never {
  if (String(e) === DRIVE_NOT_GRANTED) throw new DriveAccessError();
  throw e;
}

const creds = () => ({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET });

/** Android app with native sign-in. */
const native = () => isMobile() && androidAuthAvailable();

/** Is Google sign-in available in this build? */
export function desktopAuthConfigured(): boolean {
  return native() || GOOGLE_CLIENT_SECRET.length > 0;
}

/** Interactive sign-in: the system browser (desktop) or account sheet (Android). Resolves to the account. */
export async function desktopSignIn(): Promise<string> {
  if (native()) return (await androidSignIn()) || UNKNOWN_ACCOUNT;
  return invoke<string>('google_sign_in', creds()).catch(explain);
}

/** Valid access token, refreshed silently when needed. */
export function desktopToken(): Promise<string> {
  if (native()) return androidToken();
  return invoke<string>('google_token', creds()).catch(explain);
}

/**
 * Drive refused the token for lacking the Drive permission. Drop it: on
 * Android the next request invalidates it and asks again; on the desktop the
 * stored tokens go, so Reconnect runs a real sign-in with Google's screen.
 */
export async function desktopDropGrant(): Promise<void> {
  if (native()) return androidDropToken();
  await invoke('google_sign_out').catch(() => {});
}

/** A new token after Drive rejected the current one (a 401). */
export function desktopTokenFresh(): Promise<string> {
  if (native()) return androidToken({ fresh: true });
  return desktopToken();
}

/** Shown when tokens exist but the userinfo lookup failed at sign-in. */
export const UNKNOWN_ACCOUNT = 'Google account (email unavailable)';

/** Signed-in account address, or null when signed out. */
export async function desktopAccount(): Promise<string | null> {
  try {
    const email = native() ? await androidAccount() : await invoke<string | null>('google_account');
    if (email == null) return null;
    // Rust stores the tokens even when it couldn't read the email (gauth.rs).
    // An empty string used to read as "signed out" here, so a working
    // sign-in fell back to local files. Signed in = tokens exist.
    return email || UNKNOWN_ACCOUNT;
  } catch {
    return null;
  }
}

export async function desktopSignOut(): Promise<void> {
  if (native()) return androidSignOut();
  await invoke('google_sign_out');
}
