// Shrinks the logo an artisan picks on the account page before it is saved:
// a phone photo of a sign is several megabytes, a printed logo needs a few
// hundred pixels. The server validates the result again (AtelierSchema and
// validateLogoDataUrl), so this is only about keeping the upload small.

export const LOGO_MAX_SIDE_PX = 600;

const JPEG_QUALITY = 0.85;
// Same bound as LogoDataUrlSchema: a result the server would refuse is refused here.
const MAX_DATA_URL_LENGTH = Math.ceil(((500 * 1024) / 3) * 4) + 100;

/** Pure: the size of an image scaled down (never up) so its longest side is at most maxSide. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function hasTransparentPixel(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

function decode(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('LOGO_UNREADABLE'));
    };
    image.src = url;
  });
}

/**
 * Browser only. Returns a PNG data URL when the picture has transparency
 * (a logo cut out on a clear background), a JPEG one otherwise. Rejects when
 * the file is not a readable image or the result is still too large to save.
 */
export async function resizeLogoFile(file: File): Promise<string> {
  const image = await decode(file);
  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, LOGO_MAX_SIDE_PX);
  if (!width || !height) throw new Error('LOGO_UNREADABLE');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('LOGO_UNREADABLE');
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = hasTransparentPixel(context, width, height)
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  if (!/^data:image\/(png|jpeg);base64,/.test(dataUrl) || dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error('LOGO_TOO_LARGE');
  }
  return dataUrl;
}
