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

let accessToken: string | null = null;
let expiresAt = 0;
let tokenClient: TokenClient | null = null;

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

/** Interactive sign-in (shows Google consent/account popup). */
export function signIn(interactive = true): Promise<string> {
  return new Promise((resolve, reject) => {
    ensureClient()
      .then((client) => {
        client.callback = (resp: TokenResponse) => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error ?? 'No access token'));
            return;
          }
          accessToken = resp.access_token;
          expiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000 - 60_000;
          resolve(accessToken);
        };
        client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      })
      .catch(reject);
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
