<script lang="ts">
  import { signIn } from '$lib/drive/auth';
  import Lockup from './Lockup.svelte';

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
    <h1><Lockup height={46} /></h1>
    <p class="tag">Fast notes, synced to your Google Drive.</p>
    <!-- Google's own button design (their branding rules): the four-colour
         G on white (dark: on near-black), their wording. -->
    <button class="google" onclick={go} disabled={busy}>
      <svg class="g" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      <span>{busy ? 'Connecting…' : 'Sign in with Google'}</span>
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
  /* A sticker like every balloon. */
  .card {
    text-align: center;
    padding: 40px 34px 32px;
    background: var(--app-panel);
    border-radius: calc(var(--sticker-radius) * 2);
    box-shadow: var(--sticker-shadow), 0 12px 40px rgba(0, 0, 0, 0.08);
    max-width: 340px;
    margin: 16px;
  }
  h1 {
    margin: 0;
    display: flex;
    justify-content: center;
    color: var(--app-fg);
  }
  .tag {
    color: var(--app-muted);
    margin: 6px 0 24px;
    font-size: 17px;
  }
  .google {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 16px 0 12px;
    font-family: Roboto, Arial, sans-serif;
    font-weight: 500;
    font-size: 14px;
    letter-spacing: 0.25px;
    color: #1f1f1f;
    background: #fff;
    border: 1px solid #747775;
    border-radius: 20px;
    cursor: pointer;
  }
  .google:hover {
    background: #f8faff;
  }
  :global(:root[data-theme='dark']) .google {
    color: #e3e3e3;
    background: #131314;
    border-color: #8e918f;
  }
  .g {
    flex: none;
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
