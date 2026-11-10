// Settings merge setting by setting, the way notes merge field by field
// (noteMerge.ts). Settings used to be read once, at start, and written whole:
// a PC left running for days never saw a colour restyled or a slot painted on
// the phone, and its next settings write put its old copy of everything back.
// Now each setting remembers when it changed (settingsAt), the running app
// looks for changes, and every write reads, merges and writes.
//
// A setting that is a list of the user's things (the folders) merges item by
// item as well: as one value, a folder made on the phone and one made on the
// PC before either had heard of the other left one folder, the later save's.

import type { Folder, Settings } from './types';

type Bag = Record<string, unknown>;

/** When a setting last changed; 0 for one never changed since stamps exist. */
function stampOf(s: Settings, key: string): number {
  return s.settingsAt?.[key] ?? 0;
}

function newest(s: Settings): number {
  let t = 0;
  for (const v of Object.values(s.settingsAt ?? {})) if (v > t) t = v;
  return t;
}

/** The settings with `patch` applied and the patched ones stamped now (and
 *  never before the newest change already seen, whatever the clock says).
 *  One the patch leaves as it was has not changed, and keeps its stamp: a
 *  note dropped back where it was picked up used to count as a reorder, a
 *  later one than the order another device had just made, which it undid. */
export function patchSettings(s: Settings, patch: Partial<Settings>, now = Date.now()): Settings {
  const t = Math.max(now, newest(s) + 1);
  const at = { ...(s.settingsAt ?? {}) };
  const was = s as unknown as Bag;
  for (const [k, v] of Object.entries(patch)) if (k !== 'settingsAt' && stable(v) !== stable(was[k])) at[k] = t;
  return { ...s, ...patch, settingsAt: at };
}

/** Does folder `x` win over `y`, another copy of it: changed later; at the
 *  same moment, the same one whichever copy asks (a delete, then by name). */
function folderWins(x: Folder, y: Folder): boolean {
  const tx = x.at ?? 0;
  const ty = y.at ?? 0;
  if (tx !== ty) return tx > ty;
  if (!!x.gone !== !!y.gone) return !!x.gone;
  return x.name > y.name;
}

/**
 * Two copies of the folder list in one: every folder either has, each from
 * the copy that changed it last. A deleted folder stays in the list as
 * deleted, so it beats older copies of itself instead of coming back from
 * them. In order of id, so that equal lists compare equal.
 */
export function mergeFolders(a: Folder[] | undefined, b: Folder[] | undefined): Folder[] {
  const byId = new Map<string, Folder>();
  for (const f of [...(a ?? []), ...(b ?? [])]) {
    if (!f || typeof f.id !== 'string') continue;
    const have = byId.get(f.id);
    if (!have || folderWins(f, have)) byId.set(f.id, f);
  }
  return [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Does the list `a` hold a folder, or a change to one, that `b` lacks? */
function foldersNewerIn(a: Folder[] | undefined, b: Folder[] | undefined): boolean {
  const theirs = new Map((b ?? []).map((f) => [f.id, f]));
  return (a ?? []).some((f) => {
    const have = theirs.get(f.id);
    return !have || folderWins(f, have);
  });
}

/** Both copies in one: each setting from whichever changed it last; on a tie
 *  `a`'s (callers pass their own first), unless `a` never had it at all. */
export function mergeSettings(a: Settings, b: Settings): Settings {
  const out: Bag = {};
  const at: Record<string, number> = {};
  const keys = new Set([
    ...Object.keys(a),
    ...Object.keys(b),
    ...Object.keys(a.settingsAt ?? {}),
    ...Object.keys(b.settingsAt ?? {}),
  ]);
  for (const k of keys) {
    if (k === 'settingsAt') continue;
    const ta = stampOf(a, k);
    const tb = stampOf(b, k);
    if (k === 'folders') {
      const both = mergeFolders(a.folders, b.folders);
      out.folders = both;
      // A list neither copy had as it is now counts as changed after both:
      // an app from before this merge takes a setting whole, by its stamp,
      // and with the stamp of the later copy it would keep that copy.
      const top = Math.max(ta, tb);
      const settled =
        (ta < top || !foldersNewerIn(both, a.folders)) && (tb < top || !foldersNewerIn(both, b.folders));
      if (top || !settled) at[k] = settled ? top : top + 1;
      continue;
    }
    const v = tb > ta || (tb === ta && !(k in a)) ? (b as unknown as Bag)[k] : (a as unknown as Bag)[k];
    if (v !== undefined) out[k] = v;
    const t = Math.max(ta, tb);
    if (t) at[k] = t;
  }
  out.settingsAt = at;
  return out as unknown as Settings;
}

/** Does `a` hold a change `b` lacks: a setting it changed later? Later even
 *  to what `b` has too (the same change made on two devices): the copies are
 *  to end up alike, dates and all, and that one was left out, for good. */
export function settingsNewerIn(a: Settings, b: Settings): boolean {
  if (foldersNewerIn(a.folders, b.folders)) return true;
  for (const k of Object.keys(a.settingsAt ?? {})) {
    if (k !== 'folders' && stampOf(a, k) > stampOf(b, k)) return true;
  }
  return false;
}

/** Equal settings, whatever order their keys came in. */
export function sameSettings(a: Settings, b: Settings): boolean {
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Bag;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}
