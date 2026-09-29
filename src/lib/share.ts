// What arrives through "share to NotezZz". Text is passed as-is (the web
// share target and older Android builds only ever send text); a share with
// photos comes from the Android app as JSON marked by an "nzShare" key, with
// the images already downscaled to data URLs (SharedImages.kt).

export interface SharePayload {
  text: string;
  images: string[];
}

const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function parseShare(raw: string): SharePayload {
  if (raw.trimStart().startsWith('{') && raw.includes('"nzShare"')) {
    try {
      const o = JSON.parse(raw) as { nzShare?: unknown; text?: unknown; images?: unknown };
      if (o.nzShare) {
        const images = Array.isArray(o.images)
          ? o.images.filter((s): s is string => typeof s === 'string' && IMAGE.test(s))
          : [];
        return { text: typeof o.text === 'string' ? o.text : '', images };
      }
    } catch {
      /* someone shared text that merely looks like JSON */
    }
  }
  return { text: raw, images: [] };
}
