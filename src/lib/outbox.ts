// The write queue between the store and whatever backend is active.
//
// Every write the user makes goes through here, and the queue answers the one
// question every merge has to ask: "has this note's latest local change
// landed yet?" Before this existed, three in-memory sets tried to answer it
// between them and got it wrong in ways that cost real notes — a debounce
// timer outliving a delete and writing the note back, a failed upload being
// silently replaced by the server copy on the next refresh, two saves of a
// brand-new note racing each other into two Drive files.
//
// Guarantees:
//   - one write in flight per note id, ever (later writes coalesce behind it)
//   - a failed write stays queued and is retried with backoff, never dropped
//   - the queue is mirrored to localStorage, so closing the page mid-upload
//     loses nothing: the write runs on the next launch

import type { Note } from './types';

export type OutboxOp =
  | { kind: 'save'; note: Note }
  | { kind: 'delete'; id: string }
  /**
   * Add HTML to the end of a note, whatever it currently says. Performed
   * against a freshly fetched copy, so the share sheet can close the moment
   * the user taps instead of waiting for a full sync — and so appending on a
   * phone can never write yesterday's cached text back over today's edits.
   */
  | { kind: 'append'; id: string; html: string; pin: boolean };

type Failed = { op: OutboxOp; attempts: number; nextAt: number };

const KEY = 'notezzz:outbox';
/** Retry delays by attempt. Long enough to ride out a dead radio, short
 *  enough that a blip costs seconds, not a visit to Reconnect. */
const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000];

function opId(op: OutboxOp): string {
  return op.kind === 'save' ? op.note.id : op.id;
}

export class Outbox {
  /** Latest op waiting per id. A newer save replaces an older one outright. */
  #queued = new Map<string, OutboxOp>();
  /** Ids whose op is executing right now, and the op itself (it must be
   *  persisted too: a page closed mid-upload has to redo this write). */
  #running = new Map<string, Promise<void>>();
  #active = new Map<string, OutboxOp>();
  /** Ops that threw, waiting for their retry window. */
  #failed = new Map<string, Failed>();
  #perform: (op: OutboxOp) => Promise<void>;
  #onSettle: (ok: boolean, error?: unknown) => void;

  constructor(
    perform: (op: OutboxOp) => Promise<void>,
    onSettle: (ok: boolean, error?: unknown) => void = () => {}
  ) {
    this.#perform = perform;
    this.#onSettle = onSettle;
  }

  /** True while this id has anything unlanded: queued, running, or failed. */
  has(id: string): boolean {
    return this.#queued.has(id) || this.#running.has(id) || this.#failed.has(id);
  }

  /** True while any op is queued or executing (failed-and-waiting doesn't count:
   *  a refresh must still run while the app is offline). */
  get busy(): boolean {
    return this.#queued.size > 0 || this.#running.size > 0;
  }

  get failedCount(): number {
    return this.#failed.size;
  }

  /**
   * Notes with a save still owed (queued, running, or failed). The store
   * merges these over whatever the backend returned: a write restored from a
   * previous page load must be on screen now, not after it lands.
   */
  pendingNotes(): Note[] {
    const byId = new Map<string, Note>();
    for (const op of this.#active.values()) if (op.kind === 'save') byId.set(op.note.id, op.note);
    for (const f of this.#failed.values()) if (f.op.kind === 'save') byId.set(f.op.note.id, f.op.note);
    for (const op of this.#queued.values()) if (op.kind === 'save') byId.set(op.note.id, op.note);
    return [...byId.values()];
  }

  /** A pending delete for this id — the persistent form of a tombstone. */
  isDeleting(id: string): boolean {
    const op = this.#queued.get(id) ?? this.#failed.get(id)?.op;
    return op?.kind === 'delete';
  }

  /**
   * Enqueue. Resolves once the id's queue has drained past this op (or a later
   * one that superseded it) — success or failure; check `has()` for the
   * latter. Callers that need the write to have landed before acting (opening
   * a sticky window that will read it) await this.
   */
  push(op: OutboxOp): Promise<void> {
    const id = opId(op);
    this.#queued.set(id, op);
    this.#failed.delete(id); // a fresh write supersedes a failed one
    this.#persist();
    return this.#running.get(id) ?? this.#drain(id);
  }

  /** Re-queue failed ops whose retry window has opened. */
  retryDue(now = Date.now()): void {
    for (const [id, f] of this.#failed) {
      if (f.nextAt <= now && !this.#queued.has(id)) {
        this.#queued.set(id, f.op);
        void this.#drain(id);
      }
    }
  }

  /** Re-queue everything that failed, regardless of backoff (user pressed Reconnect). */
  retryAll(): void {
    for (const f of this.#failed.values()) f.nextAt = 0;
    this.retryDue();
  }

  /**
   * Resolves once nothing is queued or executing, or after maxMs. Failed ops
   * waiting on backoff don't count: offline must not stall the caller.
   */
  async idle(maxMs: number): Promise<void> {
    const until = Date.now() + maxMs;
    while (this.busy && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Bring back whatever a previous page load left unlanded. */
  restore(): void {
    let ops: OutboxOp[] = [];
    try {
      ops = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    } catch {
      return;
    }
    for (const op of ops) void this.push(op);
  }

  async #drain(id: string): Promise<void> {
    const run = (async () => {
      while (this.#queued.has(id)) {
        const op = this.#queued.get(id)!;
        this.#queued.delete(id);
        const prior = this.#failed.get(id)?.attempts ?? 0;
        this.#active.set(id, op);
        this.#persist();
        try {
          await this.#perform(op);
          this.#failed.delete(id);
          this.#onSettle(true);
        } catch (e) {
          const attempts = prior + 1;
          const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
          // Only remember the failure if nothing newer replaced it meanwhile.
          if (!this.#queued.has(id)) {
            this.#failed.set(id, { op, attempts, nextAt: Date.now() + wait });
          }
          this.#onSettle(false, e);
        } finally {
          this.#active.delete(id);
        }
        this.#persist();
      }
    })();
    this.#running.set(id, run);
    try {
      await run;
    } finally {
      if (this.#running.get(id) === run) this.#running.delete(id);
    }
  }

  #persist(): void {
    // Latest per id wins on restore, so queued ops come after active ones.
    const byId = new Map<string, OutboxOp>();
    for (const op of this.#active.values()) byId.set(opId(op), op);
    for (const f of this.#failed.values()) byId.set(opId(f.op), f.op);
    for (const op of this.#queued.values()) byId.set(opId(op), op);
    const ops = [...byId.values()];
    try {
      if (ops.length) localStorage.setItem(KEY, JSON.stringify(ops));
      else localStorage.removeItem(KEY);
    } catch {
      /* quota or private mode: the queue still works for this page's lifetime */
    }
  }
}
