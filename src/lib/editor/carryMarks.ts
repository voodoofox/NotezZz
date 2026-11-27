// A new line starts in the format the last one ended in: its size, bold and
// the rest. Enter does that already (the marks at the cursor are held for
// the next thing typed), but only when the editor gets to handle Enter.
//
// On a phone it often doesn't. The keyboard corrects or commits the word
// being typed and breaks the line in one go; the editor sees a paragraph
// that changed and split at once, takes it as it stands in the page, and
// the empty new line has no format to hold. And what is held is dropped by
// anything else that happens before the first letter (the cursor being
// re-read from the page is enough). So text set to a size came out at the
// note's own on the next line: sometimes, as it looked.
//
// Here the empty line itself remembers. When one appears under the cursor
// by a split nobody gave marks to, it gets the marks the cursor had; and
// while the cursor is in it, they are held again whenever they were let go.
// A format chosen on the empty line (a size from the menu, bold switched
// off) replaces what it remembers.

import { Extension } from '@tiptap/core';
import type { Mark, Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';

/** An empty line and the marks its text is to have. */
interface Kept {
  /** The position just before the line. */
  pos: number;
  marks: readonly Mark[];
}

const key = new PluginKey<Kept | null>('carryMarks');

/** The cursor is in an empty line: the position before it, else null. */
function emptyLineAt(state: EditorState): number | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const { $from } = sel;
  return $from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth > 0 ? $from.before() : null;
}

function lines(doc: Node): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.isTextblock) n++;
    return !node.isTextblock;
  });
  return n;
}

export const CarryMarks = Extension.create({
  name: 'carryMarks',

  addProseMirrorPlugins() {
    const carried = (marks: readonly Mark[]) => {
      const ok = this.editor.extensionManager.splittableMarks;
      return marks.filter((m) => ok.includes(m.type.name));
    };
    return [
      new Plugin<Kept | null>({
        key,
        state: {
          init: () => null,
          apply(tr, kept, _old, state) {
            const at = emptyLineAt(state);
            // Marks set with the cursor in an empty line: by Enter, by this
            // plugin, or by a button. That is what the line is to have.
            if (at !== null && tr.storedMarksSet) return tr.storedMarks ? { pos: at, marks: tr.storedMarks } : null;
            if (!kept || !tr.docChanged) return kept;
            const pos = tr.mapping.map(kept.pos, 1);
            const line = pos <= state.doc.content.size ? state.doc.nodeAt(pos) : null;
            return line?.isTextblock && line.content.size === 0 ? { pos, marks: kept.marks } : null;
          },
        },
        appendTransaction(trs, old, state) {
          if (state.storedMarks) return null;
          const at = emptyLineAt(state);
          if (at === null) return null;
          const kept = key.getState(state);
          if (kept && kept.pos === at) return kept.marks.length ? state.tr.setStoredMarks(kept.marks) : null;
          // A line broken in two without Enter's own handling (see above):
          // one line more than there was, the cursor in the new, empty one,
          // and before that at the end of some text.
          if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta('paste') || tr.getMeta('uiEvent') === 'drop')) {
            return null;
          }
          const was = old.selection;
          if (!was.empty || !was.$to.parentOffset || !was.$to.parent.isTextblock) return null;
          if (lines(state.doc) !== lines(old.doc) + 1) return null;
          const marks = carried(old.storedMarks ?? was.$from.marks());
          return marks.length ? state.tr.setStoredMarks(marks) : null;
        },
      }),
    ];
  },
});
