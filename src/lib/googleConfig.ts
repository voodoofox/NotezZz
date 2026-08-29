// Google Drive integration config for the WEB build.
//
// The client id is a PUBLIC identifier — safe to ship in frontend code. Auth
// uses OAuth 2.0 with PKCE (no client secret in the browser).
//
// Scope `drive.file` restricts the app to only files/folders it creates or that
// the user explicitly opens with it — it cannot see the rest of the user's
// Drive. On first sign-in the app creates (or reuses) a single folder named
// FOLDER_NAME and stores every note file inside it.

export const GOOGLE_CLIENT_ID =
  '570390928051-1tmck90tci0fo7jhvrsibrug6bd96elg.apps.googleusercontent.com';

// openid+email lets the app learn WHICH account signed in, so later silent
// renewals carry a login hint and skip Google's account-chooser screen.
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';

/** Folder the app creates in the user's Drive to hold all note files. */
export const FOLDER_NAME = 'NotezZz';
