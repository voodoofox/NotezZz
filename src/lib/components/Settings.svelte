<script lang="ts">
  // Static, like Onboarding's: a dynamic import here made Vite warn that the
  // module couldn't be split, and the warning (on stderr) aborted deploys.
  import { signInDesktopAndMigrate, signInSummary } from '$lib/desktopFlow';
  import UpdateCheck from './UpdateCheck.svelte';
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { getDiag } from '$lib/diag';
  import Icon from './Icon.svelte';
  import { chooseSyncFolder, getSyncFolder } from '$lib/desktop';
  import { PALETTES } from '$lib/palettes';
  import { hotkey, NEW_NOTE_SHORTCUT_LABEL } from '$lib/hotkey.svelte';
  import { buildExport, downloadBlob, exportFileName } from '$lib/export';

  let { onClose }: { onClose: () => void } = $props();

  let syncFolder = $state<string | null>(null);
  let autostartOn = $state(false);
  let busy = $state(false);
  let picking = $state(false);
  let adoptedName = $state<string | null>(null);
  let gAuthAvailable = $state(false);
  let gAccount = $state<string | null>(null);
  let gBusy = $state(false);

  async function signInDesktop() {
    gBusy = true;
    try {
      // The same sequence the first-run dialog runs (desktopFlow.ts).
            const result = await signInDesktopAndMigrate();
      gAccount = result.account;
      const summary = signInSummary(result);
      if (summary) alert(summary);
    } catch (e) {
      alert(`Sign-in failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      gBusy = false;
    }
  }

  async function signOutDesktop() {
    gBusy = true;
    try {
      const { desktopSignOut } = await import('$lib/drive/desktopAuth');
      await desktopSignOut();
      gAccount = null;
      await store.reconnect(); // back to local files
    } finally {
      gBusy = false;
    }
  }

  /** Adopt an existing Drive folder so desktop-written notes become visible. */
  async function adoptDriveFolder() {
    picking = true;
    try {
      const { pickDriveFolder } = await import('$lib/drive/picker');
      const { FOLDER_ID_KEY } = await import('$lib/googleConfig');
      const folder = await pickDriveFolder();
      if (folder) {
        localStorage.setItem(FOLDER_ID_KEY, folder.id);
        localStorage.setItem(FOLDER_ID_KEY + ':name', folder.name);
        adoptedName = folder.name;
        await store.reconnect(); // re-init against the adopted folder
      }
    } catch (e) {
      alert(`Could not open the folder picker: ${e instanceof Error ? e.message : e}`);
    } finally {
      picking = false;
    }
  }

  const desktop = isTauri();

  onMount(async () => {
    try {
      adoptedName = localStorage.getItem('notezzz:driveFolderId:name');
    } catch {
      /* private mode */
    }
    if (!desktop) return;
    const { desktopAuthConfigured, desktopAccount } = await import('$lib/drive/desktopAuth');
    gAuthAvailable = desktopAuthConfigured();
    if (gAuthAvailable) gAccount = await desktopAccount();
    syncFolder = await getSyncFolder();
    try {
      const { isEnabled } = await import('@tauri-apps/plugin-autostart');
      autostartOn = await isEnabled();
    } catch {
      /* plugin unavailable */
    }
  });

  async function pickFolder() {
    busy = true;
    try {
      const chosen = await chooseSyncFolder();
      if (chosen) {
        syncFolder = chosen;
        await store.saveSettings({ syncFolder: chosen });
        await store.reload(); // notes now come from the new folder
      }
    } finally {
      busy = false;
    }
  }

  async function toggleAutostart() {
    const { enable, disable } = await import('@tauri-apps/plugin-autostart');
    if (autostartOn) {
      await disable();
      autostartOn = false;
    } else {
      await enable();
      autostartOn = true;
    }
    await store.saveSettings({ autostart: autostartOn });
  }

  /** Everything, as files the user can open anywhere (see export.ts). */
  function exportAll() {
    const blob = buildExport($state.snapshot(store.notes), $state.snapshot(store.settings));
    downloadBlob(blob, exportFileName());
  }
</script>

<div
  class="overlay"
  role="button"
  tabindex="-1"
  onclick={onClose}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
>
  <div
    class="panel"
    role="dialog"
    tabindex="0"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <div class="head">
      <h2>Settings</h2>
      <button class="close" data-testid="settings-close" aria-label="Close" onclick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>

    <section>
      <h3>Appearance</h3>
      <label class="row">
        <span>App theme</span>
        <select
          data-testid="set-theme"
          value={store.settings.appTheme}
          onchange={(e) => store.saveSettings({ appTheme: (e.currentTarget as HTMLSelectElement).value as 'light' | 'dark' })}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>

      <label class="row">
        <span>Default palette</span>
        <select
          data-testid="set-palette"
          value={store.settings.defaultPaletteId}
          onchange={(e) => store.saveSettings({ defaultPaletteId: (e.currentTarget as HTMLSelectElement).value })}
        >
          {#each PALETTES as p}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </label>

      <label class="row">
        <span>Default font size</span>
        <input
          type="number" min="12" max="40"
          data-testid="set-fontsize"
          value={store.settings.defaultFontSize}
          onchange={(e) => store.saveSettings({ defaultFontSize: +(e.currentTarget as HTMLInputElement).value })}
        />
      </label>
    </section>

    {#if desktop}
      <UpdateCheck />
      <section>
        <h3>Sync</h3>
        {#if gAuthAvailable}
          <p class="hint">
            {gAccount
              ? `Signed in as ${gAccount} — notes sync straight to Google Drive, visible on every device.`
              : 'Sign in to sync notes with your phone and the web app directly through Google Drive.'}
          </p>
          <div class="folder">
            <code>{gAccount ?? 'Not signed in'}</code>
            <button data-testid="desktop-signin" onclick={gAccount ? signOutDesktop : signInDesktop} disabled={gBusy}>
              {gBusy ? 'Working…' : gAccount ? 'Sign out' : 'Sign in with Google'}
            </button>
          </div>
        {/if}
        <p class="hint">
          {gAccount
            ? 'Local folder (offline copy / used when signed out):'
            : 'Notes are stored as files here. Point this at your Google Drive folder to sync across devices.'}
        </p>
        <div class="folder">
          <code>{syncFolder ?? '(app default location)'}</code>
          <button onclick={pickFolder} disabled={busy}>Choose…</button>
        </div>
      </section>

      <section>
        <h3>Sticky notes</h3>
        <label class="row">
          <span>Tilt pinned notes</span>
          <input
            type="checkbox"
            data-testid="sticky-tilt"
            checked={store.settings.stickyTilt ?? false}
            onchange={(e) =>
              store.saveSettings({ stickyTilt: (e.currentTarget as HTMLInputElement).checked })}
          />
        </label>
        <p class="hint">Each sticky gets a small angle of its own, as if placed by hand.</p>
      </section>

      <section>
        <h3>Startup</h3>
        <label class="row">
          <span>Launch on system startup</span>
          <input type="checkbox" checked={autostartOn} onchange={toggleAutostart} />
        </label>
      </section>
    {:else}
      <section>
        <h3>Sync</h3>
        {#if store.isCloud}
          <p class="hint">
            Signed in with Google — notes sync to a private <b>NotezZz</b> folder in your Drive.
          </p>
          <p class="hint">
            Notes created in the <b>desktop app</b> are uploaded by Google Drive itself, so this
            app can't see them until you point it at the folder once.
          </p>
          <div class="folder">
            <code>{adoptedName ?? 'Using the app-created folder'}</code>
            <button data-testid="pick-folder" onclick={adoptDriveFolder} disabled={picking}>
              {picking ? 'Opening…' : 'Connect folder…'}
            </button>
          </div>
        {:else}
          <p class="hint">
            Offline mode — notes are stored in this browser only. Reload the page and sign in with
            Google to sync across devices.
          </p>
        {/if}
      </section>
    {/if}

    <!-- Shown on every build, not just desktop: settings travel with the
         account, so the switch flipped here on a phone is the switch the PC
         reads. Only the wording differs. -->
    <section>
      <h3>Shortcuts</h3>
      <label class="row">
        <span><kbd>{NEW_NOTE_SHORTCUT_LABEL}</kbd> — new sticky note under the cursor</span>
        <input
          type="checkbox"
          data-testid="hotkey-newnote"
          checked={store.settings.hotkeyNewNote ?? true}
          onchange={(e) =>
            store.saveSettings({ hotkeyNewNote: (e.currentTarget as HTMLInputElement).checked })}
        />
      </label>
      {#if hotkey.status === 'unavailable'}
        <p class="hint warn" data-testid="hotkey-unavailable">unavailable — in use by another app</p>
      {:else}
        <p class="hint">
          {desktop
            ? 'Works from any app, even while this window sits in the tray.'
            : 'Used by the desktop app.'}
        </p>
      {/if}
    </section>

    <section>
      <h3>Your files</h3>
      <p class="hint">
        Every note as JSON and as Markdown, plus your settings, in one ZIP — yours to keep, open
        anywhere.
      </p>
      <div class="folder">
        <button data-testid="export-all" onclick={exportAll} disabled={!store.loaded}>
          Export all notes
        </button>
      </div>
    </section>

    <section>
      <h3>Diagnostics</h3>
      <p class="hint diagline">
        sync: <b>{store.syncStatus}</b>{store.syncError ? ` — ${store.syncError}` : ''}
      </p>
      {#if getDiag().length}
        <pre class="diag">{getDiag().join('\n')}</pre>
      {:else}
        <p class="hint">No recent errors.</p>
      {/if}
    </section>

    <p class="version" data-testid="app-version">
      NotezZz v{__APP_VERSION__} · built {__BUILD_TIME__}
    </p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .panel {
    width: 440px;
    max-width: 92vw;
    max-height: 88vh;
    overflow-y: auto;
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-lg);
    padding: 4px 20px 20px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    background: var(--app-panel);
    padding-top: 16px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
  }
  h3 {
    margin: 18px 0 8px;
    font-size: 15px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--app-muted);
  }
  .close {
    border: none;
    background: transparent;
    color: var(--app-fg);
    font-size: 16px;
    cursor: pointer;
    opacity: 0.6;
  }
  .close:hover {
    opacity: 1;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 0;
    font-size: 16px;
  }
  .row select,
  .row input[type='number'] {
    background: var(--app-bg);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    padding: 5px 8px;
    font-size: 15px;
  }
  .row input[type='number'] {
    width: 72px;
  }
  .hint {
    font-size: 14px;
    color: var(--app-muted);
    margin: 4px 0 10px;
    line-height: 1.4;
  }
  .hint.warn {
    color: var(--app-danger);
  }
  kbd {
    font: inherit;
    font-size: 14px;
    padding: 1px 6px;
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    background: var(--app-bg);
  }
  .folder {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .folder code {
    flex: 1;
    min-width: 0;
    background: var(--app-bg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    padding: 7px 9px;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder button,
  .panel button:not(.close) {
    background: var(--app-fg);
    color: var(--app-panel);
    border: none;
    border-radius: var(--radius-sm);
    padding: 7px 13px;
    font-size: 15px;
    cursor: pointer;
  }
  .folder button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .diagline {
    word-break: break-word;
  }
  .diag {
    background: var(--app-bg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    font-family: monospace;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 160px;
    overflow-y: auto;
    user-select: text;
  }
  .version {
    margin: 22px 0 0;
    font-size: 12px;
    color: var(--app-muted);
    text-align: center;
    user-select: text;
  }
</style>
