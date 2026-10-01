<script lang="ts">
  // Static, like Onboarding's: a dynamic import here made Vite warn that the
  // module couldn't be split, and the warning (on stderr) aborted deploys.
  import { signInDesktopAndMigrate, signInSummary } from '$lib/desktopFlow';
  import UpdateCheck from './UpdateCheck.svelte';
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { isTauri, isDesktop, isMobile } from '$lib/storage/backend';
  import { getDiag } from '$lib/diag';
  import Icon from './Icon.svelte';
  import { chooseSyncFolder, getSyncFolder } from '$lib/desktop';
  import { PALETTES } from '$lib/palettes';
  import { hotkey, NEW_NOTE_SHORTCUT_LABEL } from '$lib/hotkey.svelte';
  import { buildExport, downloadBlob, exportFileName } from '$lib/export';
  import {
    BUILTIN_THEMES,
    DEFAULT_THEME_ID,
    exportTheme,
    findTheme,
    parseTheme,
    themeVars,
    type ThemeDef,
  } from '$lib/theme';

  let { onClose }: { onClose: () => void } = $props();

  // ---- themes: pick, share as JSON, bring one in ---------------------------
  const MAX_THEMES = 20;
  let allThemes = $derived([...BUILTIN_THEMES, ...(store.settings.themes ?? [])]);
  let activeTheme = $derived(findTheme(store.settings.themeId, store.settings.themes));
  let importing = $state(false);
  let themeText = $state('');
  let themeError = $state('');
  let copied = $state(false);

  /** A little note in the theme's light, on a sunflower page. */
  function themePreview(t: ThemeDef): string {
    const v = themeVars(t);
    return (
      `background-color: #f0e7c2; background-image: ${v['--note-grain']}, ${v['--note-shade']};` +
      'background-size: auto, 100% 50%; background-position: 0 0, center top; background-repeat: repeat, no-repeat;'
    );
  }
  const lightPreview = (t: ThemeDef) =>
    `background-image: ${themeVars(t)['--note-light']}; background-size: 100% 50%; background-position: center bottom; background-repeat: no-repeat;`;

  async function copyTheme() {
    const json = exportTheme(activeTheme);
    try {
      await navigator.clipboard.writeText(json);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      // No clipboard here (some webviews): put it where it can be copied by hand.
      themeText = json;
      importing = true;
      themeError = "This device didn't allow copying. The theme is in the box below.";
    }
  }

  function saveThemeFile() {
    const slug = activeTheme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';
    downloadBlob(new Blob([exportTheme(activeTheme)], { type: 'application/json' }), `${slug}.notezzz-theme.json`);
  }

  function addTheme(json: string) {
    themeError = '';
    if ((store.settings.themes ?? []).length >= MAX_THEMES) {
      themeError = `You already have ${MAX_THEMES} themes. Remove one first.`;
      return;
    }
    try {
      const t = parseTheme(json);
      void store.saveSettings({ themes: [...(store.settings.themes ?? []), t], themeId: t.id });
      themeText = '';
      importing = false;
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    }
  }

  async function readThemeFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 64_000) {
      themeError = "That file is too big to be a theme.";
      return;
    }
    themeText = await file.text();
    addTheme(themeText);
  }

  function removeTheme(id: string) {
    const rest = (store.settings.themes ?? []).filter((t) => t.id !== id);
    void store.saveSettings({
      themes: rest,
      ...(store.settings.themeId === id ? { themeId: DEFAULT_THEME_ID } : {}),
    });
  }

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

  // Three builds share this panel. `tauri`: Rust owns storage and Google
  // auth (desktop AND Android). `desktop`: there is a PC around it — sticky
  // windows, a folder to pick, autostart, a self-updater. `mobile`: a phone,
  // always stacked, with no keyboard shortcut to offer.
  const tauri = isTauri();
  const desktop = isDesktop();
  const mobile = isMobile();

  onMount(async () => {
    try {
      adoptedName = localStorage.getItem('notezzz:driveFolderId:name');
    } catch {
      /* private mode */
    }
    if (!tauri) return;
    const { desktopAuthConfigured, desktopAccount } = await import('$lib/drive/desktopAuth');
    gAuthAvailable = desktopAuthConfigured();
    if (gAuthAvailable) gAccount = await desktopAccount();
    if (!desktop) return; // no folder picker or autostart plugin on Android
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

      <!-- A phone is always stacked (the layout is a wide-screen choice), and
           the setting syncs: showing it there would offer a switch that does
           nothing here and rearranges the PC. -->
      {#if !mobile}
        <label class="row">
          <span>Note list</span>
          <select
            data-testid="set-layout"
            value={store.settings.layout ?? 'top'}
            onchange={(e) => store.saveSettings({ layout: (e.currentTarget as HTMLSelectElement).value as 'side' | 'top' })}
          >
            <option value="top">Above the note (like the phone)</option>
            <option value="side">Beside the note</option>
          </select>
        </label>
        {#if (store.settings.layout ?? 'top') === 'top'}
          <label class="row">
            <span>List columns</span>
            <select
              data-testid="set-columns"
              value={String(store.settings.listColumns ?? 'auto')}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                store.saveSettings({ listColumns: v === 'auto' ? 'auto' : (+v as 1 | 2 | 3) });
              }}
            >
              <option value="auto">Auto (grows to 3 as the list fills)</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
        {/if}
      {/if}

      <div class="row">
        <span>Saved colours &amp; patterns</span>
        <span class="btns">
          <button data-testid="reset-colors" onclick={() => store.saveSettings({ customColors: [] })}>Reset colours</button>
          <button data-testid="reset-patterns" onclick={() => store.saveSettings({ customPatterns: [] })}>Reset patterns</button>
        </span>
      </div>

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

    <section data-testid="theme-section">
      <h3>Theme</h3>
      <div class="themes">
        {#each allThemes as t (t.id)}
          <div class="theme" class:cur={t.id === activeTheme.id}>
            <button
              class="tpick"
              data-testid="theme-pick"
              aria-pressed={t.id === activeTheme.id}
              onclick={() => store.saveSettings({ themeId: t.id })}
            >
              <span class="tprev" style={themePreview(t)}>
                <span class="tlight" style={lightPreview(t)}></span>
                <span class="tstrip" style="opacity: {t.note.header}"></span>
              </span>
              <span class="tname">{t.name}</span>
            </button>
            {#if t.id.startsWith('custom:')}
              <button
                class="tdel"
                data-testid="theme-delete"
                title="Remove {t.name}"
                aria-label="Remove {t.name}"
                onclick={() => removeTheme(t.id)}
              ><Icon name="close" size={14} /></button>
            {/if}
          </div>
        {/each}
      </div>
      <div class="row">
        <span>Share this theme</span>
        <span class="btns">
          <button data-testid="theme-copy" onclick={copyTheme}>{copied ? 'Copied' : 'Copy'}</button>
          <button data-testid="theme-save" onclick={saveThemeFile}>Save file</button>
          <button data-testid="theme-import-toggle" onclick={() => (importing = !importing)}>Import…</button>
        </span>
      </div>
      {#if importing}
        <div class="timport">
          <textarea
            data-testid="theme-json"
            rows="6"
            spellcheck="false"
            placeholder="Paste a theme someone shared, or choose its file"
            bind:value={themeText}
          ></textarea>
          <span class="btns">
            <label class="tfile">
              Choose file
              <input type="file" accept=".json,application/json" onchange={readThemeFile} />
            </label>
            <button data-testid="theme-add" onclick={() => addTheme(themeText)} disabled={!themeText.trim()}>Add theme</button>
          </span>
          {#if themeError}<p class="hint warn" data-testid="theme-error">{themeError}</p>{/if}
        </div>
      {/if}
      <p class="hint">A theme is how a note looks: light and shade, grain, the title strip and the buttons. It's a small text file you can share.</p>
    </section>

    {#if tauri}
      <UpdateCheck />
    {/if}

    {#if tauri}
      <section>
        <h3>Sync</h3>
        <!-- Desktop: the system browser comes back to a loopback port the app
             listens on (gauth.rs). Android: the phone's own Google account
             sheet (GoogleSignIn.kt). Same buttons either way. -->
        {#if gAuthAvailable}
          <p class="hint">
            {gAccount
              ? `Signed in as ${gAccount} — notes sync straight to Google Drive, visible on every device.`
              : 'Sign in to sync notes with your other devices and the web app directly through Google Drive.'}
          </p>
          <div class="folder">
            <code>{gAccount ?? 'Not signed in'}</code>
            <button data-testid="desktop-signin" onclick={gAccount ? signOutDesktop : signInDesktop} disabled={gBusy}>
              {gBusy ? 'Working…' : gAccount ? 'Sign out' : 'Sign in with Google'}
            </button>
          </div>
        {/if}
        {#if desktop}
          <p class="hint">
            {gAccount
              ? 'Local folder (offline copy / used when signed out):'
              : 'Notes are stored as files here. Point this at your Google Drive folder to sync across devices.'}
          </p>
          <div class="folder">
            <code>{syncFolder ?? '(app default location)'}</code>
            <button onclick={pickFolder} disabled={busy}>Choose…</button>
          </div>
        {:else if !gAccount}
          <p class="hint">Notes are stored on this device only until you sign in.</p>
        {/if}
      </section>
    {/if}

    {#if desktop}
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
    {/if}

    {#if !tauri}
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

    <!-- Shown on the desktop and the web (a PC browser), not just the desktop
         app: settings travel with the account, so the switch flipped in the
         browser is the switch the PC app reads. Only the wording differs. A
         phone has no keyboard to offer a combo on, so it gets no section. -->
    {#if !mobile}
      <section>
        <h3>Shortcuts</h3>
        <label class="row">
          <span><kbd>{NEW_NOTE_SHORTCUT_LABEL}</kbd> — new sticky note under the cursor</span>
          <input
            type="checkbox"
            data-testid="hotkey-newnote"
            checked={store.settings.hotkeyNewNote ?? false}
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
    {/if}

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
  .themes {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 4px;
  }
  .theme {
    position: relative;
  }
  .panel button.tpick {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 6px;
    background: transparent;
    color: var(--app-fg);
    border-radius: var(--radius-md);
    font-size: 13px;
  }
  .theme.cur .tpick {
    background: color-mix(in srgb, var(--app-fg) 10%, transparent);
  }
  .tprev {
    position: relative;
    display: block;
    width: 56px;
    height: 56px;
    border-radius: var(--sticker-radius);
    overflow: hidden;
    box-shadow: var(--sticker-shadow);
  }
  .tprev {
    isolation: isolate;
  }
  .tlight {
    position: absolute;
    inset: 0;
    mix-blend-mode: plus-lighter;
  }
  .tstrip {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 12px;
    background: #e6d9a8;
  }
  .panel button.tdel {
    position: absolute;
    top: 0;
    right: 0;
    width: 22px;
    height: 22px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--app-bg);
    color: var(--app-fg);
  }
  .timport {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 4px 0 8px;
  }
  .timport textarea {
    font: 13px/1.4 ui-monospace, Consolas, monospace;
    color: var(--app-fg);
    background: var(--app-bg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-sm);
    padding: 8px;
    resize: vertical;
  }
  .tfile {
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    padding: 7px 13px;
    font-size: 15px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--app-fg) 12%, transparent);
    cursor: pointer;
  }
  .tfile input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .panel button:disabled {
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
  .btns {
    display: flex;
    gap: 6px;
  }
</style>
