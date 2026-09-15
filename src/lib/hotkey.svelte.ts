// The desktop-wide "new sticky" shortcut: Ctrl+Shift+N from any app, even
// with the main window hidden in the tray, drops a pinned note under the
// cursor. Registered by the main window only — every sticky window runs the
// same code, and registering from each would fire N notes per press. Off the
// Tauri shell every call is a no-op.

import { isTauri } from './storage/backend';
import { logDiag } from './diag';
import { store } from './store.svelte';

export const NEW_NOTE_SHORTCUT = 'CommandOrControl+Shift+N';
/** How the Settings row spells it (Windows is the only desktop build). */
export const NEW_NOTE_SHORTCUT_LABEL = 'Ctrl+Shift+N';

/** `unavailable`: another app owns the combo, so the OS refused it to us. */
export type HotkeyStatus = 'off' | 'on' | 'unavailable';

class Hotkey {
  status = $state<HotkeyStatus>('off');
  /** A held key auto-repeats; one press must make one note. */
  #firing = false;

  /** Register or release the shortcut to match the setting. Safe to repeat. */
  async apply(enabled: boolean): Promise<void> {
    if (!isTauri()) return;
    if (!enabled) return this.release();
    if (this.status === 'on') return;
    try {
      const gs = await import('@tauri-apps/plugin-global-shortcut');
      // A reloaded webview (dev) leaves the previous page's registration
      // alive in Rust with a dead handler; registering over it fails.
      if (await gs.isRegistered(NEW_NOTE_SHORTCUT)) await gs.unregister(NEW_NOTE_SHORTCUT);
      await gs.register(NEW_NOTE_SHORTCUT, (e) => {
        if (e.state === 'Pressed') void this.#fire();
      });
      this.status = 'on';
    } catch (e) {
      // Not fatal: the app works without it. Settings says why the switch
      // does nothing, and the Diagnostics panel keeps the actual reason.
      this.status = 'unavailable';
      logDiag(`hotkey ${NEW_NOTE_SHORTCUT} unavailable: ${e instanceof Error ? e.message : e}`);
    }
  }

  async release(): Promise<void> {
    if (this.status === 'on') {
      const gs = await import('@tauri-apps/plugin-global-shortcut');
      await gs.unregister(NEW_NOTE_SHORTCUT).catch(() => {});
    }
    this.status = 'off';
  }

  async #fire(): Promise<void> {
    if (this.#firing) return;
    this.#firing = true;
    try {
      const { cursorPosition, getCurrentWindow } = await import('@tauri-apps/api/window');
      // The cursor comes back in physical pixels; the sticky's window position
      // is logical, so scale it by this window's factor.
      const [pos, scale] = await Promise.all([cursorPosition(), getCurrentWindow().scaleFactor()]);
      const p = pos.toLogical(scale);
      // Nudged up and left so the cursor lands on the new sticky's title bar
      // rather than on its exact corner.
      await store.createPinned({ x: Math.round(p.x) - 24, y: Math.round(p.y) - 12 });
    } catch (e) {
      console.error('hotkey new note', e);
    } finally {
      this.#firing = false;
    }
  }
}

export const hotkey = new Hotkey();
