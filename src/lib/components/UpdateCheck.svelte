<script lang="ts">
  // Settings → Updates (desktop only). One button; the state below it says
  // what happened. Kept self-contained so Settings.svelte doesn't grow
  // another block of async state.
  import { checkForUpdate, installUpdate, relaunch, type UpdateState } from '$lib/updater';

  let state = $state<UpdateState>({ kind: 'idle' });

  async function check() {
    state = { kind: 'checking' };
    state = await checkForUpdate();
  }

  async function install() {
    state = { kind: 'installing', percent: 0 };
    state = await installUpdate((percent) => (state = { kind: 'installing', percent }));
  }
</script>

<section>
  <h3>Updates</h3>
  <p class="hint">
    {#if state.kind === 'idle'}
      NotezZz v{__APP_VERSION__}. Updates are downloaded from flatvoxel.com and verified before they install.
    {:else if state.kind === 'checking'}
      Checking…
    {:else if state.kind === 'none'}
      You're on the latest version (v{state.version}).
    {:else if state.kind === 'available'}
      Version {state.version} is available.
    {:else if state.kind === 'installing'}
      Installing… {state.percent}%
    {:else if state.kind === 'restart'}
      Installed. Restart NotezZz to finish.
    {:else if state.kind === 'error'}
      Couldn't check for updates: {state.message}
    {/if}
  </p>
  <div class="row">
    {#if state.kind === 'available'}
      <button data-testid="update-install" onclick={install}>Install v{state.version}</button>
    {:else if state.kind === 'restart'}
      <button data-testid="update-restart" onclick={relaunch}>Restart now</button>
    {:else}
      <button
        data-testid="update-check"
        onclick={check}
        disabled={state.kind === 'checking' || state.kind === 'installing'}
      >
        Check for updates
      </button>
    {/if}
  </div>
</section>

<style>
  .row {
    display: flex;
    gap: 8px;
  }
</style>
