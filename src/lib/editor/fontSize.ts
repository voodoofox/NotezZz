// TipTap extension: per-selection font size, layered on top of TextStyle.
// Adds editor.commands.setFontSize('24px') / unsetFontSize() / stepFontSize(1).

import { Extension } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { BASE_FONT_PX } from '../types';

/**
 * The sizes the toolbar's two steps go through. BASE_FONT_PX is one of them:
 * that is text with no size of its own, and a step that lands there takes
 * the size off again.
 */
export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48];

/** The next size up or down the list from `px`, if there is one. */
export function nextSize(px: number, dir: 1 | -1): number | undefined {
  return dir === 1 ? FONT_SIZES.find((s) => s > px) : FONT_SIZES.findLast((s) => s < px);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
      /** One size up (1) or down (-1), each part of the selection from its own. */
      stepFontSize: (dir: 1 | -1) => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            // Attr is stored as a px label ("24px") but RENDERED as em relative
            // to the BASE_FONT_PX default, so the note's base font-size slider scales
            // ALL text proportionally — a text zoom, not just unformatted text.
            parseHTML: (el) => {
              const v = el.style.fontSize;
              if (!v) return null;
              if (v.endsWith('em')) return `${Math.round(parseFloat(v) * BASE_FONT_PX)}px`;
              return v;
            },
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              const px = parseFloat(attrs.fontSize);
              if (!Number.isFinite(px)) return {};
              return { style: `font-size: ${(px / BASE_FONT_PX).toFixed(4)}em` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
      // A heading and the text under it, selected together, both move a
      // step and stay as far apart as they were. With nothing selected the
      // step is for what is typed next. False where nothing can move: no
      // text in the selection, or all of it at the end of the list.
      stepFontSize:
        (dir) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.marks.textStyle;
          const sizeIn = (marks: readonly Mark[]) =>
            parseInt(type.isInSet(marks)?.attrs.fontSize ?? '') || BASE_FONT_PX;
          /** The mark for `px` on text that has `marks`; null where none is left to set. */
          const sized = (marks: readonly Mark[], px: number) => {
            const attrs = { ...(type.isInSet(marks)?.attrs ?? {}), fontSize: px === BASE_FONT_PX ? null : `${px}px` };
            return Object.values(attrs).some((v) => v != null) ? type.create(attrs) : null;
          };
          const sel = state.selection;
          if (sel.empty) {
            const marks = state.storedMarks ?? sel.$from.marks();
            const px = nextSize(sizeIn(marks), dir);
            if (!px) return false;
            if (dispatch) {
              const mark = sized(marks, px);
              if (mark) tr.addStoredMark(mark);
              else tr.removeStoredMark(type);
            }
            return true;
          }
          let any = false;
          for (const range of sel.ranges) {
            const from = range.$from.pos;
            const to = range.$to.pos;
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (!node.isText) return;
              const px = nextSize(sizeIn(node.marks), dir);
              if (!px) return;
              any = true;
              if (!dispatch) return;
              const a = Math.max(pos, from);
              const b = Math.min(pos + node.nodeSize, to);
              const mark = sized(node.marks, px);
              if (mark) tr.addMark(a, b, mark);
              else tr.removeMark(a, b, type);
            });
          }
          return any;
        },
    };
  },
});
