/**
 * Images pasted or dropped into a note. A note is one JSON document (on
 * Drive, in the device cache, in every open sticky), so a picture goes in
 * as a data URL and is shrunk first (src/lib/image.ts, as the toolbar's
 * image button does): a 4K screenshot would otherwise add megabytes.
 */
import { downscaleImage } from '$lib/image';

/** Longest edge, CSS pixels: plenty for a note, small enough to sync. */
export const MAX_EDGE = 1600;
/** Below this, a PNG/GIF/WebP file goes in untouched (a GIF keeps moving). */
const KEEP_BYTES = 400_000;

/** The image files in a paste or drop, if any (screenshots arrive as files). */
export function imageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const f of Array.from(data.files)) if (f.type.startsWith('image/')) out.push(f);
  if (out.length === 0) {
    for (const it of Array.from(data.items ?? [])) {
      if (it.kind !== 'file' || !it.type.startsWith('image/')) continue;
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/** A data URL for the note: a small lossless file as is, else shrunk. */
export async function imageToDataUrl(file: File): Promise<string> {
  if (/^image\/(png|gif|webp)$/.test(file.type) && file.size <= KEEP_BYTES) {
    const probe = await downscaleImage(file, MAX_EDGE);
    if (!probe) throw new Error('not an image');
    // Already small enough on both counts: keep the original bytes.
    if (probe.width < MAX_EDGE && probe.height < MAX_EDGE) return readAsDataUrl(file);
    return probe.src;
  }
  const scaled = await downscaleImage(file, MAX_EDGE);
  if (!scaled) throw new Error('not an image');
  return scaled.src;
}
