<script lang="ts">
  import { signIn } from '$lib/drive/auth';

  let { onSignedIn, onLocal }: { onSignedIn: () => void; onLocal: () => void } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function go() {
    busy = true;
    error = null;
    try {
      await signIn(true);
      onSignedIn();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="gate">
  <div class="card">
    <h1>NotezZz</h1>
    <p class="tag">Fast notes, synced to your Google Drive.</p>
    <button class="google" onclick={go} disabled={busy}>
      {busy ? 'Connecting…' : 'Sign in with Google'}
    </button>
    {#if error}<p class="err">{error}</p>{/if}
    <button class="local" data-testid="open-local" onclick={onLocal}>Open without signing in</button>
    <p class="fine">
      Sign-in syncs to a private <b>NotezZz</b> folder in your Drive — nothing else is accessed.
      Offline mode keeps notes in this browser only.
    </p>
  </div>
</div>

<style>
  .gate {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    width: 100vw;
    background: var(--app-bg);
  }
  .card {
    text-align: center;
    padding: 40px 34px;
    background: var(--app-panel);
    border: 1px solid var(--app-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
    max-width: 340px;
  }
  h1 {
    margin: 0;
    font-size: 40px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .tag {
    color: var(--app-muted);
    margin: 6px 0 24px;
    font-size: 17px;
  }
  .google {
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
    margin-top: 14px;
  }
  .fine {
    color: var(--app-muted);
    font-size: 13px;
    margin: 22px 0 0;
    line-height: 1.5;
  }
</style>
