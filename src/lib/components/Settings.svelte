<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/store.svelte';
  import { isTauri } from '$lib/storage/backend';
  import { chooseSyncFolder, getSyncFolder } from '$lib/desktop';
  import { PALETTES } from '$lib/palettes';

  let { onClose }: { onClose: () => void } = $props();

  let syncFolder = $state<string | null>(null);
  let autostartOn = $state(false);
  let busy = $state(false);

  const desktop = isTauri();

  onMount(async () => {
    if (!desktop) return;
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
      <button class="close" data-testid="settings-close" onclick={onClose}>✕</button>
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
      <section>
        <h3>Sync</h3>
        <p class="hint">Notes are stored as files here. Point this at your Google Drive folder to sync across devices.</p>
        <div class="folder">
          <code>{syncFolder ?? '(app default location)'}</code>
          <button onclick={pickFolder} disabled={busy}>Choose…</button>
        </div>
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
        {:else}
          <p class="hint">
            Offline mode — notes are stored in this browser only. Reload the page and sign in with
            Google to sync across devices.
          </p>
        {/if}
      </section>
    {/if}
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
    border-radius: 12px;
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
    border-radius: 7px;
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
    border-radius: 7px;
    padding: 7px 9px;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder button,
  .panel button:not(.close) {
    background: var(--app-accent);
    color: #fff;
    border: none;
    border-radius: 7px;
    padding: 7px 13px;
    font-size: 15px;
    cursor: pointer;
  }
  .folder button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
