// Plain-text views of note HTML, shared by every list that previews or
// searches notes (Sidebar, ShareIntake). One implementation so the two lists
// always agree on what a note is called.

import type { Note } from './types';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};

/**
 * Strip tags AND decode the entities TipTap emits. Tags go first so an
 * escaped "&lt;b&gt;" in the text is decoded to "<b>" rather than stripped.
 * Without the decode step "Tom & Jerry" previewed as "Tom &amp; Jerry" and a
 * search for "&" never matched anything.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * List label: the title, else the note's text, else describe the media it
 * holds — a note containing only a sketch/photo/memo is not an "empty note"
 * (it used to be labelled that way and looked like a sync failure).
 */
export function noteLabel(note: Pick<Note, 'title' | 'contentHtml'>): string {
  if (note.title) return note.title;
  const html = note.contentHtml;
  const text = htmlToText(html);
  if (text) return text;
  if (/<audio/i.test(html)) return 'Voice note';
  if (/<img[^>]+data:image\/svg/i.test(html)) return 'Drawing';
  if (/<img/i.test(html)) return 'Image';
  return 'Empty note';
}

/** Live filter: title + note text, case-insensitive. Empty query = all. */
export function filterNotes<T extends Pick<Note, 'title' | 'contentHtml'>>(
  notes: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) => `${n.title} ${htmlToText(n.contentHtml)}`.toLowerCase().includes(q));
}
