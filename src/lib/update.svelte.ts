// "The app updates itself" means it looks without being asked. Checked a
// little after launch (so startup isn't competing with the sync) and every
// few hours after; the Sidebar shows a banner when something is waiting.
// Every check leaves a line in Diagnostics, so "it didn't offer the update"
// is answerable from a Settings screenshot.

import { checkForUpdate } from './updater';
import { logDiag } from './diag';
import { isTauri } from './storage/backend';

export const updates = $state<{ available: { version: string } | null; dismissed: boolean }>({
  available: null,
  dismissed: false,
});

export async function pollForUpdates(): Promise<void> {
  const r = await checkForUpdate();
  if (r.kind === 'available') {
    if (updates.available?.version !== r.version) updates.dismissed = false;
    updates.available = { version: r.version };
    logDiag(`UPD ${r.version} available`);
  } else if (r.kind === 'none') {
    updates.available = null;
    logDiag(`UPD up to date (${r.version})`);
  } else if (r.kind === 'error') {
    logDiag(`UPD check failed: ${r.message}`);
  }
}

let scheduled = false;
export function scheduleUpdateChecks(): void {
  if (scheduled || !isTauri()) return;
  scheduled = true;
  setTimeout(() => void pollForUpdates(), 20_000);
  setInterval(() => void pollForUpdates(), 6 * 60 * 60 * 1000);
}
