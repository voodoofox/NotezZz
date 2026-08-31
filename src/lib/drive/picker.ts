// Google Picker: lets the user hand the app an existing Drive folder.
//
// Why this exists: the app holds the narrow `drive.file` scope, so it can only
// see files IT created. Notes written by the desktop app are uploaded by
// Google Drive for Desktop, so the web app is blind to them. Selecting the
// folder in the Picker grants access to that folder's contents — the
// sanctioned way to widen access without a broader (review-gated) scope.

import { GOOGLE_API_KEY } from '../googleConfig';
import { getValidToken } from './auth';

const GAPI_SRC = 'https://apis.google.com/js/api.js';

interface PickerDoc {
  id: string;
  name?: string;
}
interface PickerResponse {
  action: string;
  docs?: PickerDoc[];
}
interface PickerBuilderLike {
  setDeveloperKey(k: string): PickerBuilderLike;
  setOAuthToken(t: string): PickerBuilderLike;
  addView(v: unknown): PickerBuilderLike;
  setTitle(t: string): PickerBuilderLike;
  setCallback(cb: (d: PickerResponse) => void): PickerBuilderLike;
  build(): { setVisible(v: boolean): void };
}
interface DocsViewLike {
  setIncludeFolders(v: boolean): DocsViewLike;
  setSelectFolderEnabled(v: boolean): DocsViewLike;
  setMimeTypes(m: string): DocsViewLike;
}
interface PickerNamespace {
  DocsView: new (viewId?: unknown) => DocsViewLike;
  ViewId: { FOLDERS: unknown };
  PickerBuilder: new () => PickerBuilderLike;
  Action: { PICKED: string; CANCEL: string };
}

declare global {
  interface Window {
    gapi?: { load(name: string, cb: () => void): void };
  }
}

/** window.google is typed for GIS in auth.ts; the Picker adds its own branch. */
function pickerNs(): PickerNamespace {
  const ns = (window as unknown as { google?: { picker?: PickerNamespace } }).google?.picker;
  if (!ns) throw new Error('Google Picker unavailable');
  return ns;
}

let gapiPromise: Promise<void> | null = null;

function loadGapi(): Promise<void> {
  if (window.gapi) return Promise.resolve();
  if (!gapiPromise) {
    gapiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GAPI_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gapiPromise = null;
        reject(new Error('Failed to load Google Picker'));
      };
      document.head.appendChild(s);
    });
  }
  return gapiPromise;
}

/** Open the folder picker. Resolves to the chosen folder, or null if cancelled. */
export async function pickDriveFolder(): Promise<{ id: string; name: string } | null> {
  const token = await getValidToken();
  await loadGapi();
  await new Promise<void>((resolve) => window.gapi!.load('picker', () => resolve()));
  const picker = pickerNs();

  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');

    new picker.PickerBuilder()
      .setDeveloperKey(GOOGLE_API_KEY)
      .setOAuthToken(token)
      .addView(view)
      .setTitle('Select your NotezZz folder')
      .setCallback((data: PickerResponse) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name ?? 'NotezZz' } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
}
