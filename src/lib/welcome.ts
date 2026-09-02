// First-run notes. They teach the app by being notes in it: the reader can
// edit, colour, pin and delete them, which is the whole tutorial.
//
// Keep them short — a note is not a manual — and keep the wording matched to
// the actual buttons, so a reader can follow along without hunting.

import { newNote, type Note } from './types';

/**
 * Where the notes actually are. Telling someone in local mode that their
 * notes are safe in Google Drive would be a lie worth losing data over, so
 * the signed-out copy invites instead of claiming.
 */
const SYNC_CLOUD =
  '<p>Your notes live in your own Google Drive, in a folder called <strong>NotezZz</strong>. They are plain files. If you ever stop using this app, they are still there.</p>';
const SYNC_LOCAL =
  '<p>These notes are on this device only. <strong>Sign in with Google</strong> and they sync to a folder in your own Drive — same notes on your phone and your PC, as plain files you own.</p>';

/**
 * Fixed ids: if two devices ever seed at once (signed in on the phone and the
 * PC before the first sync lands), they produce the same three ids and the
 * store's dedupe collapses them instead of leaving six notes.
 */
const welcome = (cloud: boolean): Array<Pick<Note, 'id' | 'title' | 'contentHtml' | 'paletteId'>> => [
  {
    id: 'welcome-start',
    title: 'Start here',
    paletteId: 'sunflower',
    contentHtml: [
      '<p>This is a note. Type in it — there is no save button, it saves as you go.</p>',
      '<p><strong>+</strong> at the top makes a new one. The coloured bar down the left of each row in the list is its handle: <strong>drag it</strong> to reorder.</p>',
      cloud ? SYNC_CLOUD : SYNC_LOCAL,
    ].join(''),
  },
  {
    id: 'welcome-pin',
    title: 'Pin it to your desktop',
    paletteId: 'mint',
    contentHtml: [
      '<p>Tap the <strong>pin</strong> on any note in the list and it becomes a sticker on your PC desktop — always on top, out of the way of everything else.</p>',
      '<p>The good part: pin it <strong>from your phone</strong> and it appears on your PC. Share something to NotezZz from any Android app, tick <em>Pin it to my desktop</em>, and it is waiting on your screen when you sit down.</p>',
      '<p>Drag a sticker by its title bar. Unpin it with the <strong>×</strong>. Settings has a tilt option if you like them hand-placed.</p>',
    ].join(''),
  },
  {
    id: 'welcome-tools',
    title: 'More than typing',
    paletteId: 'sky',
    contentHtml: [
      '<p>The toolbar under a note does more than <strong>bold</strong> and <em>italic</em>:</p>',
      '<ul>',
      '<li><p><strong>Pencil</strong> — sketch by hand. Smooth strokes, and an eraser.</p></li>',
      '<li><p><strong>Mic</strong> — record a voice memo straight into the note.</p></li>',
      '<li><p><strong>Image</strong> — drop in a photo.</p></li>',
      '<li><p><strong>Palette</strong> — recolour this note. <strong>Aa</strong> sets its text size.</p></li>',
      '</ul>',
      '<p>Everything you add is part of the note, and travels with it.</p>',
    ].join(''),
  },
];

/**
 * Built fresh each call so the timestamps are the moment of first run, and
 * ordered so "Start here" sits at the top of the list.
 */
export function welcomeNotes(fontSize: number, cloud: boolean): Note[] {
  const now = Date.now();
  return welcome(cloud).map((w, i) =>
    newNote({
      ...w,
      fontSize,
      // Descending, so the newest-first list puts them in reading order.
      createdAt: now - i,
      updatedAt: now - i,
    })
  );
}
