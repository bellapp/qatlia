// Shrinks the logo an artisan picks on the account page before it is saved:
// a phone photo of a sign is several megabytes, a printed logo needs a few
// hundred pixels. The server validates the result again (AtelierSchema and
// validateLogoDataUrl), so this is only about keeping the upload small.

export const LOGO_MAX_SIDE_PX = 600;

const JPEG_QUALITY = 0.85;
// The server refuses a logo above 500 KB once decoded; stay safely under it.
export const LOGO_MAX_BYTES = 450 * 1024;
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

/** Pure: the decoded size, in bytes, of a base64 data URL (0 when it is not one). */
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma === -1) return 0;
  const payload = dataUrl.slice(comma + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
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
 * (a logo cut out on a clear background) unless that is too heavy, then a JPEG
 * on a white background. Rejects when the file is not a readable image or the
 * result is still too large to save.
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

  let dataUrl: string;
  if (hasTransparentPixel(context, width, height)) {
    dataUrl = canvas.toDataURL('image/png');
    if (dataUrlByteLength(dataUrl) > LOGO_MAX_BYTES) {
      // Too heavy as a PNG: flatten onto white (printed pages are white) and keep it as a JPEG.
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    }
  } else {
    dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }
  if (!/^data:image\/(png|jpeg);base64,/.test(dataUrl) || dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error('LOGO_TOO_LARGE');
  }
  return dataUrl;
}
