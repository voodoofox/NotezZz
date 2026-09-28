// Android home-screen widgets. The widget process never runs this app: it
// reads a snapshot file the Rust side owns (write_widget_snapshot), so the
// frontend has to hand over what the widget should show every time the notes
// change. Pinned notes are the ones the user asked to see at a glance; with
// none pinned, the five most recent stand in so a fresh install's widget is
// not an empty square. No-op off Android.

import { invoke } from '@tauri-apps/api/core';
import { isMobile } from './storage/backend';
import { getPalette } from './palettes';
import { htmlToText } from './text';
import type { Note } from './types';

/** One widget row. Colours are resolved here: the widget has no palette table. */
export interface WidgetNote {
  id: string;
  title: string;
  /** Plain text, first ~160 chars — a widget cell, not the note. */
  text: string;
  bg: string;
  fg: string;
}

const TEXT_CHARS = 160;
const FALLBACK_COUNT = 5;
/** Typing restamps the note on every keystroke; the file is written once
 *  the keys go quiet, not on each one. */
const DEBOUNCE_MS = 1000;

export function widgetNotes(notes: Note[]): WidgetNote[] {
  const pinned = notes.filter((n) => n.pinned);
  const chosen = pinned.length
    ? pinned
    : [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, FALLBACK_COUNT);
  return chosen.map((n) => {
    const pal = getPalette(n.paletteId);
    return {
      id: n.id,
      title: n.title,
      text: htmlToText(n.contentHtml).slice(0, TEXT_CHARS),
      bg: pal.bg,
      fg: pal.fg,
    };
  });
}

let timer: ReturnType<typeof setTimeout> | undefined;
let lastStamp = '';

/**
 * Rewrite the widget file to match `notes`, a second after the last call.
 * Reads id/updatedAt/pinned of every note synchronously, so a $effect that
 * calls this re-runs on any edit (store.update restamps updatedAt on every
 * change, text and colour included); the heavier text extraction waits for
 * the timer. Pass the live store list: the timer reads it when it fires.
 */
export function scheduleWidgetSnapshot(notes: Note[]): void {
  if (!isMobile()) return;
  const stamp = notes.map((n) => `${n.id}:${n.updatedAt}:${n.pinned}`).join('|');
  if (stamp === lastStamp) return; // a reload that changed nothing
  clearTimeout(timer);
  timer = setTimeout(() => {
    lastStamp = stamp;
    invoke('write_widget_snapshot', { json: JSON.stringify(widgetNotes(notes)) }).catch((e) =>
      console.error('widget snapshot', e)
    );
  }, DEBOUNCE_MS);
}
