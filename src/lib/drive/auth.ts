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

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in')));
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google sign-in'));
    document.head.appendChild(s);
  });
}

async function ensureClient(): Promise<TokenClient> {
  await loadGis();
  if (!tokenClient) {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      callback: () => {}, // replaced per-request below
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
    // Guard: a blocked popup / closed iframe can otherwise hang forever.
    const timer = setTimeout(() => reject(new Error('Sign-in timed out')), 30_000);
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
  });
  return inflight;
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
