<script lang="ts">
  // An upright slider drawn by the app: a thin track filled from the bottom
  // in the note's ink, a round thumb, no outline. Still a native range input
  // underneath, so the keyboard, screen readers and tests work as before.
  let {
    value,
    min,
    max,
    step = 1,
    label,
    testid,
    valueTestid,
    display,
    onInput,
  }: {
    value: number;
    min: number;
    max: number;
    step?: number;
    label: string;
    testid?: string;
    valueTestid?: string;
    /** What to show above the slider; the value itself by default. */
    display?: string;
    onInput: (v: number) => void;
  } = $props();

  const pct = $derived(((value - min) / (max - min)) * 100);
</script>

<label class="vctl">
  <span class="vval" data-testid={valueTestid}>{display ?? value}</span>
  <input
    class="vrange"
    type="range"
    {min}
    {max}
    {step}
    {value}
    aria-label={label}
    data-testid={testid}
    style="--pct: {pct}%"
    oninput={(e) => onInput(+(e.currentTarget as HTMLInputElement).value)}
  />
  <span class="vlab">{label}</span>
</label>

<style>
  .vctl {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: color-mix(in srgb, var(--note-fg) 70%, transparent);
  }
  .vval {
    font-size: 16px;
    color: var(--note-fg);
    font-variant-numeric: tabular-nums;
  }
  /* Logical sizes throughout: in a vertical writing mode the inline axis is
     the slider's length and the block axis its thickness. */
  .vrange {
    -webkit-appearance: none;
    appearance: none;
    writing-mode: vertical-lr;
    direction: rtl; /* low at the bottom */
    inline-size: 100px;
    block-size: 20px;
    margin: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  .vrange:focus {
    outline: none;
  }
  .vrange:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--note-fg) 35%, transparent);
  }
  .vrange::-webkit-slider-runnable-track {
    inline-size: 100%;
    block-size: 4px;
    border: none;
    border-radius: 2px;
    background: linear-gradient(
      to top,
      var(--note-fg) var(--pct),
      color-mix(in srgb, var(--note-fg) 22%, transparent) var(--pct)
    );
  }
  .vrange::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    inline-size: 16px;
    block-size: 16px;
    margin-block-start: -6px;
    border: none;
    border-radius: 50%;
    background: var(--note-fg);
  }
  .vrange::-moz-range-track {
    inline-size: 100%;
    block-size: 4px;
    border: none;
    border-radius: 2px;
    background: color-mix(in srgb, var(--note-fg) 22%, transparent);
  }
  .vrange::-moz-range-progress {
    block-size: 4px;
    border-radius: 2px;
    background: var(--note-fg);
  }
  .vrange::-moz-range-thumb {
    inline-size: 16px;
    block-size: 16px;
    border: none;
    border-radius: 50%;
    background: var(--note-fg);
  }
</style>
