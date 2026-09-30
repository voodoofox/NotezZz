// Google can sign a user in WITHOUT the Drive permission: its consent screen
// lists permissions one by one when an app asks for several, and a user who
// leaves Drive unticked still "signs in". A token like that can't touch a
// single note, and Drive answers every call with 403
// ACCESS_TOKEN_SCOPE_INSUFFICIENT. The app now asks for Drive alone (one
// permission, one Allow button), and every sign-in checks what was granted;
// this module is the shared vocabulary for that check.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** What the native sides (GoogleSignIn.kt, gauth.rs) report for a grant without Drive. */
export const DRIVE_NOT_GRANTED = 'drive_not_granted';

export const DRIVE_ACCESS_MESSAGE =
  "Google didn't give NotezZz access to Google Drive, so your notes can't sync. " +
  'Sign in again and allow access. If Google shows a Google Drive checkbox, tick it.';

export class DriveAccessError extends Error {
  constructor() {
    super(DRIVE_ACCESS_MESSAGE);
    this.name = 'DriveAccessError';
  }
}

export function isDriveAccessError(e: unknown): boolean {
  return e instanceof DriveAccessError || String(e) === DRIVE_NOT_GRANTED;
}

/** Does a granted-scope list (space-separated, as Google returns it) include Drive? */
export function grantsDrive(scope: string | undefined): boolean {
  return (scope ?? '').split(/\s+/).includes(DRIVE_SCOPE);
}

/** Drive's answer to a token that was granted without the Drive permission. */
export function isScopeRejection(status: number, body: string): boolean {
  return status === 403 && /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(body);
}

/**
 * The signed-in address, asked of Drive itself. The app no longer requests
 * Google's "email" permission (a second permission is what makes Google show
 * checkboxes), and Drive reports the account's own address to any app it
 * lets in.
 */
export async function driveAccountEmail(token: string): Promise<string | null> {
  try {
    const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const info = (await r.json()) as { user?: { emailAddress?: string } };
    return info.user?.emailAddress || null;
  } catch {
    return null;
  }
}
