// Ticked items sink: a checklist item goes to the end of its list when its
// box is ticked, and back up among the unticked ones when it is unticked,
// so what is left to do stays together at the top. A note can keep its
// order instead (Note.keepTicked, from the ⋯ menu): a recipe's steps are
// ticked off in place.
//
// The move is part of the same edit as the tick: one undo takes both back,
// and one save carries both to the other devices. Only an item whose box
// flipped in the edit moves — never one that was typed in, pasted, or
// brought in by a sync — so a list arranged by hand is left as it is until
// something in it is ticked.

import { Extension } from '@tiptap/core';
import { Plugin, Selection, type Transaction } from '@tiptap/pm/state';

export interface ChecklistSinkOptions {
  /** Asked at every edit: the note's current setting, not the one at load. */
  enabled: () => boolean;
}

/** Move the task item at `pos` to where its box says it belongs. */
function sink(tr: Transaction, pos: number) {
  const item = tr.doc.nodeAt(pos);
  if (!item || item.type.name !== 'taskItem') return;
  const $pos = tr.doc.resolve(pos);
  const list = $pos.parent;
  if (list.type.name !== 'taskList') return;
  const index = $pos.index();
  // Its place among the other items: a ticked one after all of them, an
  // unticked one at the end of the unticked run, just above the first
  // ticked one.
  const others: { checked: boolean; size: number }[] = [];
  for (let i = 0; i < list.childCount; i++) {
    if (i !== index) others.push({ checked: !!list.child(i).attrs.checked, size: list.child(i).nodeSize });
  }
  let to = others.length;
  if (!item.attrs.checked) {
    to = others.findIndex((o) => o.checked);
    if (to === -1) to = others.length;
  }
  if (to === index) return;

  const from = pos;
  const end = pos + item.nodeSize;
  // The caret, if it was in the item, goes along at the same offset.
  const sel = tr.selection;
  const carried = sel.from >= from && sel.from < end ? sel.from - from : -1;
  tr.delete(from, end);
  let at = $pos.start();
  for (let i = 0; i < to; i++) at += others[i].size;
  tr.insert(at, item);
  if (carried >= 0) tr.setSelection(Selection.near(tr.doc.resolve(at + carried)));
}

export const ChecklistSink = Extension.create<ChecklistSinkOptions>({
  name: 'checklistSink',

  addOptions() {
    return { enabled: () => true };
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
