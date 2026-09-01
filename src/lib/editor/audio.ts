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

  /**
   * The browser's own audio widget is an opaque grey slab that ignores the
   * note's colours entirely. This replaces it with a player built from the
   * same parts as the rest of the app: a monochrome control that inherits the
   * note's ink. The <audio> element still does the work, just unseen.
   */
  addNodeView() {
    return ({ node }) => {
      const PLAY = 'M8 5v14l11-7z';
      const PAUSE = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
      const fmt = (s: number) =>
        Number.isFinite(s)
          ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
          : '0:00';

      const dom = document.createElement('div');
      dom.className = 'nz-audio';
      dom.contentEditable = 'false';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nz-audio-play';
      button.setAttribute('aria-label', 'Play');
      button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="${PLAY}"/></svg>`;

      const track = document.createElement('div');
      track.className = 'nz-audio-track';
      const fill = document.createElement('div');
      fill.className = 'nz-audio-fill';
      track.appendChild(fill);

      const time = document.createElement('span');
      time.className = 'nz-audio-time';
      time.textContent = '0:00';

      dom.append(button, track, time);

      const audio = new Audio(node.attrs.src);
      audio.preload = 'metadata';

      // MediaRecorder's WebM has no duration in its header, so browsers report
      // Infinity until the file is seeked to the end. Nudge it once, then jump
      // back, and the real length appears.
      let measured = 0;
      const measure = () => {
        if (audio.duration !== Infinity) return;
        const done = () => {
          measured = audio.duration === Infinity ? audio.currentTime : audio.duration;
          audio.removeEventListener('timeupdate', done);
          audio.currentTime = 0;
          paint();
        };
        audio.addEventListener('timeupdate', done);
        audio.currentTime = 1e6;
      };
      const total = () => (Number.isFinite(audio.duration) ? audio.duration : measured);

      const setIcon = (playing: boolean) => {
        button.querySelector('path')?.setAttribute('d', playing ? PAUSE : PLAY);
        button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      };
      // Shows time remaining while playing, total length when idle.
      const paint = () => {
        const len = total();
        fill.style.width = `${len ? (audio.currentTime / len) * 100 : 0}%`;
        time.textContent = fmt(audio.paused || !audio.currentTime ? len : audio.currentTime);
      };

      button.addEventListener('click', () => (audio.paused ? void audio.play() : audio.pause()));
      audio.addEventListener('play', () => setIcon(true));
      audio.addEventListener('pause', () => setIcon(false));
      audio.addEventListener('ended', () => {
        setIcon(false);
        audio.currentTime = 0;
        paint();
      });
      audio.addEventListener('timeupdate', paint);
      audio.addEventListener('loadedmetadata', () => {
        measure();
        paint();
      });
      track.addEventListener('pointerdown', (e) => {
        const r = track.getBoundingClientRect();
        const len = total();
        if (len) audio.currentTime = ((e.clientX - r.left) / r.width) * len;
      });

      return {
        dom,
        // Atomic node: nothing inside is editable, so ignore mutations.
        ignoreMutation: () => true,
        destroy: () => {
          audio.pause();
          audio.src = '';
        },
      };
    };
  },
});
