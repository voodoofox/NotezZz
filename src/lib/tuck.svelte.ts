// Tucked-or-not for every sticky, as seen from the main window. The sticky
// owns the state (it is device-local, saved with its window geometry); this
// mirrors it so the list and the note pane can offer the same tuck button a
// sticky has, and stays current through two events on the Tauri bus:
//   notezzz:tuck    main -> sticky  { id, tucked }  "please tuck/untuck"
//   notezzz:tucked  sticky -> main  { id, tucked }  "I did"

import { isTauri } from './storage/backend';

export const tuckState = $state<{ byId: Record<string, boolean> }>({ byId: {} });

/** Seed from what stickies saved on this device, then follow their events. */
export async function watchTuckState(): Promise<void> {
  if (!isTauri()) return;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith('notezzz:win:')) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? '{}');
      if (v.tucked) tuckState.byId[k.slice('notezzz:win:'.length)] = true;
    }
  } catch {
    /* private mode */
  }
  const { listen } = await import('@tauri-apps/api/event');
  await listen<{ id: string; tucked: boolean }>('notezzz:tucked', (e) => {
    tuckState.byId[e.payload.id] = e.payload.tucked;
  });
}

/** Ask a sticky to tuck away or come back. */
export async function requestTuck(id: string, tucked: boolean): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import('@tauri-apps/api/event');
  await emit('notezzz:tuck', { id, tucked });
}
