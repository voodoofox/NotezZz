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

let accessToken: string | null = null;
let expiresAt = 0;
let tokenClient: TokenClient | null = null;

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
  return new Promise((resolve, reject) => {
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
  });
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
}
