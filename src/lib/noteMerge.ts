// Field-by-field merging of two copies of one note.
//
// A save used to carry the whole note and the newest save won outright, so a
// window or device holding an old copy undid changes it never made: the main
// window saving a stale "tucked" over a sticky just brought back, a phone's
// colour change putting back yesterday's text. Now every note remembers when
// each of its fields last changed (fieldAt), and wherever two copies meet —
// a poll, another window, the write to storage — each field comes from the
// copy that changed it last. Two edits to different things both survive.
// The same field changed on two devices at once still goes to the later one:
// that is the text of one note typed on two devices in the same moment.

import type { Note } from './types';

/** Not merged as fields: identity, bookkeeping, and the share log. */
const SKIP = new Set(['id', 'updatedAt', 'fieldAt', 'appliedShares']);

/** How many applied share ids a note keeps (enough to outlive any retry). */
const SHARE_LOG = 20;

/**
 * When a field last changed. Every write that stamps also stamps at least one
 * field with its own time, so the newest stamp equals updatedAt. A copy whose
 * updatedAt is later than all its stamps was written by an app from before
 * fieldAt, which carried the old stamps along untouched while rewriting the
 * whole note: like a copy with no stamps at all, it changed every field when
 * it was saved. Otherwise a field it never stamped is one it never had, and
 * loses to any copy that set it.
 */
export function stampOf(n: Note, field: string): number {
  const at = n.fieldAt;
  if (!at || !stampsCurrent(n)) return n.updatedAt;
  return at[field] ?? 0;
}

function stampsCurrent(n: Note): boolean {
  let newest = 0;
  for (const t of Object.values(n.fieldAt ?? {})) if (t > newest) newest = t;
  return newest >= n.updatedAt;
}

/** Every field of the note, stamped with its current time (see stampOf). */
export function stampsOf(n: Note): Record<string, number> {
  const at: Record<string, number> = {};
  for (const k of Object.keys(n)) if (!SKIP.has(k)) at[k] = stampOf(n, k);
  return at;
}

/**
 * The note with `patch` applied and the patched fields stamped now — and
 * never earlier than the copy it was made on: a change made after seeing
 * another device's edit comes after it, even if this device's clock runs
 * behind that one's.
 */
export function patchNote(n: Note, patch: Partial<Note>, now = Date.now()): Note {
  const t = Math.max(now, n.updatedAt + 1);
  const at = stampsOf(n);
  for (const k of Object.keys(patch)) if (!SKIP.has(k)) at[k] = t;
  return { ...n, ...patch, updatedAt: t, fieldAt: at };
}

/**
 * Both copies in one: each field from whichever copy changed it last, ties
 * going to `a` (callers pass their own copy first). Shares applied by either
 * are applied in the result.
 */
export function mergeNotes(a: Note, b: Note): Note {
  if (a === b) return a;
  const out: Record<string, unknown> = { id: a.id };
  const at: Record<string, number> = {};
  const keys = new Set([
    ...Object.keys(a),
    ...Object.keys(b),
    ...Object.keys(a.fieldAt ?? {}),
    ...Object.keys(b.fieldAt ?? {}),
  ]);
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    const ta = stampOf(a, k);
    const tb = stampOf(b, k);
    const v = tb > ta ? (b as unknown as Record<string, unknown>)[k] : (a as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
    at[k] = Math.max(ta, tb);
  }
  const shares = [...new Set([...(a.appliedShares ?? []), ...(b.appliedShares ?? [])])];
  if (shares.length) out.appliedShares = shares.slice(-SHARE_LOG);
  out.updatedAt = Math.max(a.updatedAt, b.updatedAt);
  out.fieldAt = at;
  return out as unknown as Note;
}

/** The note after a share added `html` to it, recorded under `shareId` so a
 *  retried share can see it already landed. */
export function withShare(n: Note, html: string, shareId: string | undefined, pin: boolean, tilt: () => number, now = Date.now()): Note {
  const patch: Partial<Note> = { contentHtml: (n.contentHtml || '') + html };
  if (pin && !n.pinned) Object.assign(patch, { pinned: true, tilt: tilt() });
  const next = patchNote(n, patch, now);
  if (shareId) next.appliedShares = [...(n.appliedShares ?? []), shareId].slice(-SHARE_LOG);
  return next;
}

/** Does `a` hold a change `b` lacks: a field it changed later, to something else? */
export function newerIn(a: Note, b: Note): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(a.fieldAt ?? {})]);
  for (const k of keys) {
    if (SKIP.has(k) || stampOf(a, k) <= stampOf(b, k)) continue;
    const va = (a as unknown as Record<string, unknown>)[k];
    const vb = (b as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(va) !== JSON.stringify(vb)) return true;
  }
  return false;
}

/** A short fingerprint that changes whenever any field of the note does
 *  (in any key order: equal copies must compare equal, or every poll would
 *  look like news and redraw the open editor). */
export function noteRev(n: Note): string {
  const at = n.fieldAt ? Object.entries(n.fieldAt).sort(([x], [y]) => (x < y ? -1 : 1)) : [];
  return `${n.updatedAt}:${at.map(([k, t]) => `${k}=${t}`).join(',')}`;
}
