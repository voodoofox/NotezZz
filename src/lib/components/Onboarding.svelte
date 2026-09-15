<script lang="ts">
  // First desktop launch: one question, asked once — where should the notes
  // live? Desktop never gates on sign-in (the app is usable with local files
  // from the first second), which is why a person could otherwise use it for
  // months without learning that sync exists.
  import Modal from './Modal.svelte';
  import { signInDesktopAndMigrate, signInSummary } from '$lib/desktopFlow';

  /** Called whichever way the dialog closes; the caller records the choice. */
  let { onDone }: { onDone: () => void } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function google() {
    busy = true;
    error = null;
    try {
      const summary = signInSummary(await signInDesktopAndMigrate());
      if (summary) alert(summary);
      onDone();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal labelledby="onboard-title" onClose={onDone} testid="onboarding">
  <div class="card">
    <h2 id="onboard-title">Where should your notes live?</h2>
    <p>
      Sign in and every note is a small file in a <b>NotezZz</b> folder in your own Google Drive:
      the same notes on your phone and in the web app, and yours to keep if you ever stop using
      this app.
    </p>
    <p>Or keep them on this PC only. Either way, Settings can change it later.</p>
    <button class="google" data-testid="onboard-google" onclick={google} disabled={busy}>
      {busy ? 'Connecting…' : 'Sign in with Google'}
    </button>
    {#if error}<p class="err">{error}</p>{/if}
    <button class="local" data-testid="onboard-local" onclick={onDone} disabled={busy}>
      Keep notes on this PC
    </button>
  </div>
</Modal>

<style>
  .card {
    width: 380px;
    max-width: 100%;
    background: var(--app-panel);
    color: var(--app-fg);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-lg);
    padding: 22px 24px 24px;
    box-shadow: 0 14px 44px rgba(0, 0, 0, 0.32);
    text-align: center;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 22px;
  }
  p {
    margin: 0 0 12px;
    font-size: 15px;
    line-height: 1.5;
    color: var(--app-muted);
  }
  .google {
    width: 100%;
    margin-top: 8px;
    font: inherit;
    font-size: 17px;
    padding: 11px 22px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--app-fg);
    color: var(--app-panel);
    cursor: pointer;
  }
  .google:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .local {
    display: block;
    margin: 14px auto 0;
    background: none;
    border: none;
    color: var(--app-muted);
    font: inherit;
    font-size: 14px;
    text-decoration: underline;
    cursor: pointer;
  }
  .local:hover {
    color: var(--app-fg);
  }
  .err {
    color: var(--app-danger);
    font-size: 14px;
    margin: 12px 0 0;
  }
</style>
