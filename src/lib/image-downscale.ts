/**
 * Downscales an image dataURL to fit within `maxSide` pixels and re-encodes
 * as JPEG at the given quality. Used to persist a lightweight thumbnail of
 * the scanned cut-list photo with the project (the original full-res image
 * never leaves the device except for the analysis call itself).
 */
export async function downscaleDataUrl(
  dataUrl: string,
  maxSide = 900,
  quality = 0.72
): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    if (scale >= 1 && dataUrl.startsWith('data:image/jpeg')) return dataUrl; // already small jpeg
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}
