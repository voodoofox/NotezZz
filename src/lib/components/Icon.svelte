<script lang="ts">
  import { icons, type IconName } from '$lib/icons';
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<!-- flex:none — as a flex child inside narrow toolbar buttons the SVG would
     otherwise be squashed horizontally (measured 10.8x20 instead of 20x20). -->
<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
  focusable="false"
  style="flex: none"
><path d={icons[name]} /></svg>
