// Tiny on-device diagnostics: capture recent errors into a ring buffer that
// Settings can display — the only practical way to debug the installed PWA on
// a phone (no devtools there; a screenshot of Settings carries the evidence).

const buf: string[] = [];
let installed = false;

function push(line: string) {
  buf.push(`${new Date().toISOString().slice(11, 19)} ${line}`.slice(0, 220));
  if (buf.length > 12) buf.shift();
}

export function initDiag(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => push(`ERR ${e.message || String(e.error)}`));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | undefined;
    push(`REJ ${r?.message ?? String(e.reason)}`);
  });
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    push(`CE ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')}`);
    orig(...args);
  };
}

/** Leave a line for the Diagnostics panel (update checks, sync milestones). */
export function logDiag(line: string): void {
  push(line);
}

export function getDiag(): readonly string[] {
  return buf;
}
