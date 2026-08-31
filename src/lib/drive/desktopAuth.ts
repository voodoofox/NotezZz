// Desktop half of Google auth. The Rust side owns the browser round-trip and
// refresh tokens (see src-tauri/src/gauth.rs); this is the thin JS bridge so
// DriveBackend can ask for a token the same way it does on the web.

import { invoke } from '@tauri-apps/api/core';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../googleConfig';

const creds = () => ({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET });

/** Is desktop sign-in available in this build? */
export function desktopAuthConfigured(): boolean {
  return GOOGLE_CLIENT_SECRET.length > 0;
}

/** Interactive sign-in: opens the system browser, resolves to the account. */
export function desktopSignIn(): Promise<string> {
  return invoke<string>('google_sign_in', creds());
}

/** Valid access token, refreshed silently by Rust when needed. */
export function desktopToken(): Promise<string> {
  return invoke<string>('google_token', creds());
}

/** Signed-in account address, or null. */
export async function desktopAccount(): Promise<string | null> {
  try {
    return (await invoke<string | null>('google_account')) ?? null;
  } catch {
    return null;
  }
}

export async function desktopSignOut(): Promise<void> {
  await invoke('google_sign_out');
}
