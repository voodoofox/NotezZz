<script lang="ts">
  // Android share-target landing: the OS opens this URL with the shared
  // title/text/url as query params. Stash them and hand off to the main app,
  // which shows the "new note or append?" chooser after it boots (that way
  // auth/storage bootstrapping lives in exactly one place).
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';

  onMount(() => {
    const p = new URLSearchParams(window.location.search);
    const shared = [p.get('title'), p.get('text'), p.get('url')]
      .filter((s): s is string => !!s?.trim())
      .join('\n');
    if (shared) {
      try {
        localStorage.setItem('notezzz:pendingShare', shared);
      } catch {
        /* private mode */
      }
    }
    void goto(`${base}/`, { replaceState: true });
  });
</script>

<p class="fwd">Adding to NotezZz…</p>

<style>
  .fwd {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    margin: 0;
    color: var(--app-muted);
    font-size: 17px;
  }
</style>
