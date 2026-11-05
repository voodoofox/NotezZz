// Ticked items sink: a checklist item goes to the end of its list when its
// box is ticked, and back to where it was when it is unticked, so what is
// left to do stays together at the top. A note can keep its order instead
// (Note.keepTicked, from the ⋯ menu): a recipe's steps are ticked off in
// place.
//
// Where it was is kept on the item (data-sink-from, its place in the list
// at the tick), so the note's other devices put it back the same. The
// place is the best there is once the list has changed meanwhile: never
// below an item still ticked, never past the end.
//
// The move is part of the same edit as the tick: one undo takes both back,
// and one save carries both to the other devices. Only an item whose box
// flipped in the edit moves — never one that was typed in, pasted, or
// brought in by a sync — so a list arranged by hand is left as it is until
// something in it is ticked.

import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, Selection, type Transaction } from '@tiptap/pm/state';

export interface ChecklistSinkOptions {
  /** Asked at every edit: the note's current setting, not the one at load. */
  enabled: () => boolean;
}

/** The item with its remembered place set (or cleared, with null). */
function remembering(item: Node, sinkFrom: number | null): Node {
  return item.type.create({ ...item.attrs, sinkFrom }, item.content, item.marks);
}

type Entry = { index: number; checked: boolean; from: number | null; size: number };

/**
 * The list as it was before anything sank: the unticked items in their
 * order, each ticked one put back at the place it remembers. Where an
 * item "was" is its place in this list, not its index at the tick — by
 * then the items ticked before it had already left their places above it.
 */
function pristine(entries: Entry[]): Entry[] {
  const order = entries.filter((e) => !e.checked);
  const sunk = entries.filter((e) => e.checked).sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity));
  for (const e of sunk) order.splice(Math.min(e.from ?? order.length, order.length), 0, e);
  return order;
}

/** Move the task item at `pos` to where its box says it belongs. */
function sink(tr: Transaction, pos: number) {
  const item = tr.doc.nodeAt(pos);
  if (!item || item.type.name !== 'taskItem') return;
  const $pos = tr.doc.resolve(pos);
  const list = $pos.parent;
  if (list.type.name !== 'taskList') return;
  const index = $pos.index();
  const all: Entry[] = [];
  for (let i = 0; i < list.childCount; i++) {
    const n = list.child(i);
    const from = n.attrs.sinkFrom;
    all.push({ index: i, checked: !!n.attrs.checked, from: typeof from === 'number' ? from : null, size: n.nodeSize });
  }
  const me = all[index];
  const others = all.filter((e) => e !== me);
  // Its place among the other items: a ticked one after all of them, an
  // unticked one back where it was — among the unticked, never below one
  // still ticked.
  let to: number;
  let next: Node;
  if (item.attrs.checked) {
    // Where it was: its place in the list before anything sank, itself
    // counted as unticked, which it was until now.
    const asWas = { ...me, checked: false };
    const was = pristine(all.map((e) => (e === me ? asWas : e))).indexOf(asWas);
    to = others.length;
    next = remembering(item, was);
  } else {
    // Back to its remembered place, counted among the unticked: the ones
    // the pristine list has above it. (No place remembered: the end of the
    // unticked run.)
    const asSunk = { ...me, checked: true };
    const order = pristine([...others, asSunk]);
    to = order.slice(0, order.indexOf(asSunk)).filter((e) => !e.checked).length;
    next = remembering(item, null);
  }
  if (to === index && next.attrs.sinkFrom === item.attrs.sinkFrom) return;

  const from = pos;
  const end = pos + item.nodeSize;
  // The caret, if it was in the item, goes along at the same offset.
  const sel = tr.selection;
  const carried = sel.from >= from && sel.from < end ? sel.from - from : -1;
  tr.delete(from, end);
  let at = $pos.start();
  for (let i = 0; i < to; i++) at += others[i].size;
  tr.insert(at, next);
  if (carried >= 0) tr.setSelection(Selection.near(tr.doc.resolve(at + carried)));
}

export const ChecklistSink = Extension.create<ChecklistSinkOptions>({
  name: 'checklistSink',

  addOptions() {
    return { enabled: () => true };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['taskItem'],
        attributes: {
          /** Where a ticked item was before it sank: its index in its list. */
          sinkFrom: {
            default: null,
            parseHTML: (el) => {
              const v = el.getAttribute('data-sink-from');
              return v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
            },
            renderHTML: (attrs) =>
              attrs.sinkFrom === null || attrs.sinkFrom === undefined ? {} : { 'data-sink-from': String(attrs.sinkFrom) },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const enabled = () => this.options.enabled();
    return [
      new Plugin({
        appendTransaction: (trs, oldState, newState) => {
          if (!enabled() || !trs.some((t) => t.docChanged)) return null;
          // Content put in from outside (a sync, a note switch) is not an
          // edit: whatever order it carries is the order it has.
          if (trs.some((t) => t.getMeta('preventUpdate'))) return null;
          // Items whose box flipped: each item from before, followed to
          // where the edit left it; the same item (same text) with its box
          // the other way.
          const flipped: number[] = [];
          oldState.doc.descendants((was, pos) => {
            if (was.type.name !== 'taskItem') return;
            let now = pos;
            for (const t of trs) now = t.mapping.map(now);
            const is = newState.doc.nodeAt(now);
            if (!is || is.type.name !== 'taskItem' || is.textContent !== was.textContent) return;
            if (!!is.attrs.checked !== !!was.attrs.checked) flipped.push(now);
          });
          if (!flipped.length) return null;
          const tr = newState.tr;
          for (const pos of flipped) sink(tr, tr.mapping.map(pos));
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
