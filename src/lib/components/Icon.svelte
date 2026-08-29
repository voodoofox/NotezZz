<script lang="ts">
  import { icons, type IconName } from '$lib/icons';
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
><path d={icons[name]} /></svg>
