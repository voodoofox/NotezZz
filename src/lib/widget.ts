// Android home-screen widgets. The widget process never runs this app: it
// reads a snapshot file the Rust side owns (write_widget_snapshot), so the
// frontend has to hand over what the widgets may show every time the notes
// change. That is every note, in list order: the list widget scrolls through
// them all and the one-note widget picks any of them. No-op off Android.

import { invoke } from '@tauri-apps/api/core';
import { isMobile } from './storage/backend';
import { getPalette, PALETTES, PATTERNS } from './palettes';
import { customPatternId, PATTERN_SLOTS } from './patterns.svelte';
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
  /** Epoch ms; the Android app schedules a notification for it. */
  remindAt?: number;
}

/**
 * widget.json. Besides the notes it carries what the Android background
 * refresh (NotesRefreshWorker.kt) needs to rebuild the notes from Drive with
 * the app closed: where they live, and each colour id's resolved colours.
 */
export interface WidgetSnapshot {
  v: 2;
  drive: { notesFolderId: string | null; settingsId: string | null } | null;
  palettes: Record<string, { bg: string; fg: string }>;
  notes: WidgetNote[];
}

const TEXT_CHARS = 600;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** Note HTML as widget text: one line per paragraph or item, checklists as ☐ / ☑. */
export function widgetText(html: string): string {
  return html
    .replace(/<li[^>]*data-checked="(true|false)"[^>]*>/g, (_, c: string) => (c === 'true' ? '\n☑ ' : '\n☐ '))
    .replace(/<li[^>]*>/g, '\n• ')
    .replace(/<(br|\/p|\/h\d|\/li|\/div|\/blockquote)[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && l !== '•' && l !== '☐' && l !== '☑')
    .join('\n');
}
/** Typing restamps the note on every keystroke; the file is written once
 *  the keys go quiet, not on each one. */
const DEBOUNCE_MS = 1000;

export function widgetNotes(notes: Note[]): WidgetNote[] {
  return notes.filter((n) => !n.archived).map((n) => {
    const pal = getPalette(n.paletteId);
    return {
      id: n.id,
      title: n.title,
      text: widgetText(n.contentHtml).slice(0, TEXT_CHARS),
      bg: pal.bg,
      fg: pal.fg,
      pinned: !!n.pinned,
      ...(n.remindAt ? { remindAt: n.remindAt } : {}),
    };
  });
}

/** Every named colour, plus the painted pattern slots, as the widgets draw them. */
function paletteTable(): Record<string, { bg: string; fg: string }> {
  const table: Record<string, { bg: string; fg: string }> = {};
  for (const { id } of [...PALETTES, ...PATTERNS]) {
    const p = getPalette(id); // as restyled, if it is
    table[id] = { bg: p.bg, fg: p.fg };
  }
  for (let i = 0; i < PATTERN_SLOTS; i++) {
    const id = customPatternId(i);
    const p = getPalette(id);
    table[id] = { bg: p.bg, fg: p.fg };
  }
  return table;
}

export function widgetSnapshot(
  notes: Note[],
  drive: WidgetSnapshot['drive']
): WidgetSnapshot {
  return { v: 2, drive, palettes: paletteTable(), notes: widgetNotes(notes) };
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
export function scheduleWidgetSnapshot(
  notes: Note[],
  drive: () => WidgetSnapshot['drive'] = () => null
): void {
  if (!isMobile()) return;
  const stamp = notes.map((n) => `${n.id}:${n.updatedAt}:${n.pinned}`).join('|');
  if (stamp === lastStamp) return; // a reload that changed nothing
  clearTimeout(timer);
  timer = setTimeout(async () => {
    lastStamp = stamp;
    try {
      await invoke('write_widget_snapshot', { json: JSON.stringify(widgetSnapshot(notes, drive())) });
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
