// Desktop "Sign in with Google" as one flow, shared by Settings and the
// first-run dialog: sign in, lift local-only notes into Drive, switch the
// store over. Two callers, one sequence — a fix to the order of these steps
// must not have to be made twice.

import { store } from './store.svelte';

export interface DesktopSignInResult {
  account: string;
  /** Local-only notes uploaded to Drive on the way in. */
  moved: number;
  /** Signed in, but the account-email lookup failed: the message to relay. */
  warning: string;
}

export async function signInDesktopAndMigrate(): Promise<DesktopSignInResult> {
  const { desktopSignIn, desktopAccount } = await import('./drive/desktopAuth');
  let account: string;
  let warning = '';
  try {
    account = await desktopSignIn();
  } catch (e) {
    // gauth.rs keeps the tokens when only the account-email lookup fails, so
    // an error here is a real failure only if we are still signed out.
    // Otherwise carry on and just say the email is unknown.
    const fallback = await desktopAccount();
    if (!fallback) throw e;
    account = fallback;
    warning = e instanceof Error ? e.message : String(e);
  }
  // Lift local-only notes into Drive before switching backends, so nothing
  // drops out of the list and every note becomes app-owned.
  const moved = await store.migrateLocalToDrive().catch(() => 0);
  await store.reconnect();
  return { account, moved, warning };
}

/** What to tell the user afterwards, or null when there is nothing to say. */
export function signInSummary({ moved, warning }: DesktopSignInResult): string | null {
  const uploaded = moved ? ` ${moved} local note(s) uploaded to Google Drive.` : '';
  if (warning) return `Signed in, but ${warning}.${uploaded}`;
  return moved ? `Signed in.${uploaded}` : null;
}
