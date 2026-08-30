// TipTap node for voice memos: an atomic block rendering a playable
// <audio controls> element. The src is an opus data URL recorded in-app.

import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    audioNote: {
      insertAudio: (src: string) => ReturnType;
    };
  }
}

export const AudioNote = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute('src'),
        renderHTML: (attrs) => (attrs.src ? { src: attrs.src } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'audio' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(HTMLAttributes, { controls: 'true', preload: 'metadata' })];
  },

  addCommands() {
    return {
      insertAudio:
        (src) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs: { src } }).run(),
    };
  },
});
