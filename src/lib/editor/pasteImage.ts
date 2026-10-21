/**
 * Images pasted or dropped into a note. A note is one JSON document (on
 * Drive, in the device cache, in every open sticky), so a picture goes in
 * as a data URL and is shrunk first: a 4K screenshot would otherwise add
 * megabytes to a note. Long edge capped, re-encoded as WebP (keeps
 * transparency; a browser that can't encode WebP falls back to PNG).
 */

/** Longest edge, CSS pixels: plenty for a note, small enough to sync. */
export const MAX_EDGE = 1600;
const QUALITY = 0.85;
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

function decode(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('not an image'));
    };
    img.src = url;
  });
}

/** A data URL for the note: the file as is when small, else shrunk. */
export async function imageToDataUrl(file: Blob): Promise<string> {
  const img = await decode(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const lossless = /^image\/(png|gif|webp)$/.test(file.type);
  if (scale === 1 && lossless && file.size <= KEEP_BYTES) return readAsDataUrl(file);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return readAsDataUrl(file);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', QUALITY);
}
