// Android home-screen widgets. The widget process never runs this app: it
// reads a snapshot file the Rust side owns (write_widget_snapshot), so the
// frontend has to hand over what the widgets may show every time the notes
// change. That is every note, in list order: the list widget scrolls through
// them all and the one-note widget picks any of them. No-op off Android.

import { invoke } from '@tauri-apps/api/core';
import { isMobile } from './storage/backend';
import { getPalette } from './palettes';
import { htmlToText } from './text';
import type { Note } from './types';

/** One note as a widget sees it. Colours are resolved here: the widget has no palette table. */
export interface WidgetNote {
  id: string;
  title: string;
  /** Plain text, first ~600 chars — enough to fill a large one-note widget. */
  text: string;
  bg: string;
  fg: string;
  pinned: boolean;
}

const TEXT_CHARS = 600;
/** Typing restamps the note on every keystroke; the file is written once
 *  the keys go quiet, not on each one. */
const DEBOUNCE_MS = 1000;

export function widgetNotes(notes: Note[]): WidgetNote[] {
  return notes.map((n) => {
    const pal = getPalette(n.paletteId);
    return {
      id: n.id,
      title: n.title,
      text: htmlToText(n.contentHtml).slice(0, TEXT_CHARS),
      bg: pal.bg,
      fg: pal.fg,
      pinned: !!n.pinned,
    };
  });
}

type Bridge = { refreshWidgets?: () => void };

let timer: ReturnType<typeof setTimeout> | undefined;
let lastStamp = '';

/**
 * Rewrite the widget file to match `notes`, a second after the last call,
 * then ask Android to redraw the widgets. Reads id/updatedAt/pinned of every
 * note synchronously, so a $effect that calls this re-runs on any edit
 * (store.update restamps updatedAt on every change, text and colour
 * included); the heavier text extraction waits for the timer. Pass the live
 * store list: the timer reads it when it fires.
 */
export function scheduleWidgetSnapshot(notes: Note[]): void {
  if (!isMobile()) return;
  const stamp = notes.map((n) => `${n.id}:${n.updatedAt}:${n.pinned}`).join('|');
  if (stamp === lastStamp) return; // a reload that changed nothing
  clearTimeout(timer);
  timer = setTimeout(async () => {
    lastStamp = stamp;
    try {
      await invoke('write_widget_snapshot', { json: JSON.stringify(widgetNotes(notes)) });
      (window as unknown as { NotezzzAndroid?: Bridge }).NotezzzAndroid?.refreshWidgets?.();
    } catch (e) {
      console.error('widget snapshot', e);
    }
  }, DEBOUNCE_MS);
}

/** A home-screen widget tap, handed over by MainActivity (take_pending_action). */
export interface WidgetAction {
  action: 'open' | 'new' | 'voice' | 'draw' | 'show';
  id?: string;
}

/** Take the widget tap waiting for the app, if any. Android only. */
export async function takeWidgetAction(): Promise<WidgetAction | null> {
  if (!isMobile()) return null;
  try {
    const raw = await invoke<string | null>('take_pending_action');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WidgetAction;
    return typeof parsed?.action === 'string' ? parsed : null;
  } catch (e) {
    console.error('take_pending_action', e);
    return null;
  }
}
