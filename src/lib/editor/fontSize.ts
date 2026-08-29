// TipTap extension: per-selection font size, layered on top of TextStyle.
// Adds editor.commands.setFontSize('24px') / unsetFontSize().

import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
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
            // to the 18px default, so the note's base font-size slider scales
            // ALL text proportionally — a text zoom, not just unformatted text.
            parseHTML: (el) => {
              const v = el.style.fontSize;
              if (!v) return null;
              if (v.endsWith('em')) return `${Math.round(parseFloat(v) * 18)}px`;
              return v;
            },
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              const px = parseFloat(attrs.fontSize);
              if (!Number.isFinite(px)) return {};
              return { style: `font-size: ${(px / 18).toFixed(4)}em` };
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
    };
  },
});
