// Canvas downscale for imported photos, shared by the editor's image button
// and the DrawPad. Notes are synced as JSON, so a 12MP photo must never land
// in one at full size.

export interface ScaledImage {
  /** Data URL: WebP (keeps transparency, smaller than JPEG); where the
   *  browser can't encode WebP (Safari), PNG stays PNG, the rest is JPEG. */
  src: string;
  width: number;
  height: number;
}

/**
 * Resolves null when the file is not a decodable image. Always revokes the
 * object URL — on error too — so a rejected file doesn't leak a blob.
 */
function encode(canvas: HTMLCanvasElement, type: string): string {
  const webp = canvas.toDataURL('image/webp', 0.85);
  if (webp.startsWith('data:image/webp')) return webp;
  return type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
}

export function downscaleImage(file: File, maxPx: number): Promise<ScaledImage | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ src: encode(canvas, file.type), width: canvas.width, height: canvas.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
