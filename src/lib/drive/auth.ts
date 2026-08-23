// Google sign-in for the web build, using Google Identity Services (GIS) token
// client. Returns short-lived access tokens for the drive.file scope — no
// client secret, no server. Tokens last ~1h; we re-request on 401.

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPE } from '../googleConfig';

interface TokenResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: '' | 'none' | 'consent' }) => void;
  callback: (resp: TokenResponse) => void;
}
interface TokenClientError {
  type?: string;
  message?: string;
}
// Minimal shape of the global injected by the GIS script.
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: TokenResponse) => void;
            error_callback?: (err: TokenClientError) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Set after the first successful grant; later sign-ins skip the consent UI. */
const AUTH_FLAG = 'notezzz:hasAuthed';
/** Cached access token (+expiry). Tokens live ~1h; persisting them means a
 * share-launch or refresh within that window needs NO Google round-trip. */
const TOKEN_KEY = 'notezzz:tok';

let accessToken: string | null = null;
let expiresAt = 0;
let tokenClient: TokenClient | null = null;
/** Single-flight: concurrent callers (e.g. parallel 401 retries) share ONE
 * sign-in attempt instead of each opening its own Google popup. */
let inflight: Promise<string> | null = null;
/** Reject hook for the sign-in currently underway — GIS reports blocked /
 * closed popups through error_callback, not the token callback. */
let pendingReject: ((e: Error) => void) | null = null;

// Restore a still-valid token from the previous page load.
try {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw) {
      const { t, e } = JSON.parse(raw) as { t: string; e: number };
      if (t && e > Date.now()) {
        accessToken = t;
        expiresAt = e;
      }
    }
  }
} catch {
  /* corrupt/absent — sign in normally */
}

/** True if this browser has completed Google sign-in before. */
export function hasPriorAuth(): boolean {
  try {
    return localStorage.getItem(AUTH_FLAG) === '1';
  } catch {
    return false;
  }
}

let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  // Memoize by promise (NOT by DOM tag): listening on an already-loaded/failed
  // script tag waits for a load event that will never fire again.
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null; // allow a retry on the next attempt
        s.remove();
        reject(new Error('Failed to load Google sign-in'));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

async function ensureClient(): Promise<TokenClient> {
  await loadGis();
  if (!tokenClient) {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      callback: () => {}, // replaced per-request below
      // Fires when the auth popup is blocked or closed — without this the
      // sign-in promise hangs until its timeout.
      error_callback: (err) => {
        pendingReject?.(new Error(err?.message || err?.type || 'Sign-in was interrupted'));
      },
    });
  }
  return tokenClient;
}

/**
 * Sign in. The full consent UI only appears on the very first grant; after
 * that Google silently re-issues tokens (empty prompt), so refreshes don't
 * walk the user through the account/consent screens again.
 */
export function signIn(interactive = true): Promise<string> {
  // A sign-in is already underway — piggyback on it rather than opening a
  // second Google popup (parallel Drive requests all 401 at once on expiry).
  if (inflight) return inflight;

  inflight = new Promise<string>((resolve, reject) => {
    // Guard: even with error_callback, never hang forever.
    const timer = setTimeout(() => reject(new Error('Sign-in timed out')), 15_000);
    pendingReject = (e) => {
      clearTimeout(timer);
      reject(e);
    };
    ensureClient()
      .then((client) => {
        client.callback = (resp: TokenResponse) => {
          clearTimeout(timer);
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error ?? 'No access token'));
            return;
          }
          accessToken = resp.access_token;
          expiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000 - 60_000;
          try {
            localStorage.setItem(AUTH_FLAG, '1');
            localStorage.setItem(TOKEN_KEY, JSON.stringify({ t: accessToken, e: expiresAt }));
          } catch {
            /* private mode */
          }
          resolve(accessToken);
        };
        // consent UI only for a genuinely new user; '' = silent when possible
        const prompt = interactive && !hasPriorAuth() ? 'consent' : '';
        client.requestAccessToken({ prompt });
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  }).finally(() => {
    inflight = null;
    pendingReject = null;
  });
  return inflight;
}

/** Drop the cached token (memory + storage) after the server rejects it. */
export function markTokenStale(): void {
  accessToken = null;
  expiresAt = 0;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Return a valid token, refreshing silently if expired. */
export async function getValidToken(): Promise<string> {
  if (accessToken && Date.now() < expiresAt) return accessToken;
  return signIn(!accessToken); // silent if we had one before
}

export function isDriveAuthed(): boolean {
  return accessToken !== null;
}

export function signOut(): void {
  accessToken = null;
  expiresAt = 0;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AUTH_FLAG);
  } catch {
    /* ignore */
  }
}
