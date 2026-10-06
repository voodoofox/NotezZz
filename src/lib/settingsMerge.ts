// Settings merge setting by setting, the way notes merge field by field
// (noteMerge.ts). Settings used to be read once, at start, and written whole:
// a PC left running for days never saw a colour restyled or a slot painted on
// the phone, and its next settings write put its old copy of everything back.
// Now each setting remembers when it changed (settingsAt), the running app
// looks for changes, and every write reads, merges and writes.

import type { Settings } from './types';

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
 *  never before the newest change already seen, whatever the clock says). */
export function patchSettings(s: Settings, patch: Partial<Settings>, now = Date.now()): Settings {
  const t = Math.max(now, newest(s) + 1);
  const at = { ...(s.settingsAt ?? {}) };
  for (const k of Object.keys(patch)) if (k !== 'settingsAt') at[k] = t;
  return { ...s, ...patch, settingsAt: at };
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
    const v = tb > ta || (tb === ta && !(k in a)) ? (b as unknown as Bag)[k] : (a as unknown as Bag)[k];
    if (v !== undefined) out[k] = v;
    const t = Math.max(ta, tb);
    if (t) at[k] = t;
  }
  out.settingsAt = at;
  return out as unknown as Settings;
}

/** Does `a` hold a change `b` lacks: a setting it changed later, to something else? */
export function settingsNewerIn(a: Settings, b: Settings): boolean {
  for (const k of Object.keys(a.settingsAt ?? {})) {
    if (stampOf(a, k) <= stampOf(b, k)) continue;
    if (stable((a as unknown as Bag)[k]) !== stable((b as unknown as Bag)[k])) return true;
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
