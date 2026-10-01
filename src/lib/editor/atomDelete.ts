// Backspace / Delete next to a voice memo or an image, as phone keyboards
// send them.
//
// A PC keyboard sends a Backspace keydown, which ProseMirror's keymap turns
// into "select the block before, then delete it". Android's keyboards send
// keyCode 229 and a `beforeinput` of deleteContentBackward instead, and
// ProseMirror only learns of the edit from the DOM change that follows; next
// to a block with no text inside (contenteditable=false) there is no such
// change, so nothing happened and the memo could not be deleted.
//
// Here the input event itself is answered, with the PC's behaviour: a
// selected block is deleted; a caret right after (or before) one selects it
// first, so a second press deletes it.

import { Extension } from '@tiptap/core';
import { Plugin, NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

function handle(view: EditorView, e: InputEvent): boolean {
  const back = e.inputType === 'deleteContentBackward';
  if (!back && e.inputType !== 'deleteContentForward') return false;
  const { state } = view;
  const sel = state.selection;

  if (sel instanceof NodeSelection) {
    view.dispatch(state.tr.deleteSelection().scrollIntoView());
    return true;
  }
  if (!(sel instanceof TextSelection) || !sel.empty) return false;

  const $pos = sel.$from;
  const atEdge = back ? $pos.parentOffset === 0 : $pos.parentOffset === $pos.parent.content.size;
  if (!atEdge || !$pos.parent.isTextblock) return false;

  // The block next to this paragraph (at the same depth).
  const edge = back ? $pos.before() : $pos.after();
  const $edge = state.doc.resolve(edge);
  const next = back ? $edge.nodeBefore : $edge.nodeAfter;
  if (!next || !next.isAtom || next.isInline) return false;

  const at = back ? edge - next.nodeSize : edge;
  // An empty paragraph after the block just goes, and the block is selected
  // (where the caret was is gone anyway); otherwise only select it.
  let tr = state.tr;
  if (back && $pos.parent.content.size === 0) {
    tr = tr.delete($pos.before(), $pos.after());
  }
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView());
  return true;
}

export const AtomDelete = Extension.create({
  name: 'atomDelete',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            beforeinput: (view, e) => {
              if (!handle(view, e as InputEvent)) return false;
              e.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});
