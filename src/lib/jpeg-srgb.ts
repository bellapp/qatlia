/**
 * PNG → JPEG with the sRGB profile, for the WhatsApp plan picture.
 *
 * WhatsApp refused the PNG plan picture, as a card's header ("(#131053) Media
 * upload error") and alone (never delivered), while the example JPEG goes
 * through (21/11/2026). next/og only draws PNG: it is decoded and encoded
 * again, in plain JavaScript (pngjs, jpeg-js), then given the same sRGB
 * profile as the PNG (src/lib/png-srgb.ts) in an APP2 "ICC_PROFILE" segment.
 */

import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { srgbIccProfile } from '@/lib/png-srgb';

const ICC_MARKER = 'ICC_PROFILE\0';

/** The APP2 segment holding `icc` whole (one chunk of one). */
function iccSegment(icc: Uint8Array): Uint8Array {
  const length = 2 + ICC_MARKER.length + 2 + icc.length;
  const segment = new Uint8Array(2 + length);
  segment[0] = 0xff;
  segment[1] = 0xe2;
  segment[2] = length >> 8;
  segment[3] = length & 0xff;
  for (let i = 0; i < ICC_MARKER.length; i++) segment[4 + i] = ICC_MARKER.charCodeAt(i);
  segment[4 + ICC_MARKER.length] = 1;
  segment[5 + ICC_MARKER.length] = 1;
  segment.set(icc, 6 + ICC_MARKER.length);
  return segment;
}

export function pngToJpeg(png: Uint8Array, quality = 88): Uint8Array {
  const image = PNG.sync.read(Buffer.from(png));
  // Transparency is laid on white: a JPEG has no alpha.
  const data = Buffer.from(image.data);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha === 1) continue;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * alpha + 255 * (1 - alpha));
    data[i + 3] = 255;
  }
  const encoded = jpeg.encode({ data, width: image.width, height: image.height }, quality).data;

  // SOI, the profile, then the rest as jpeg-js wrote it.
  const segment = iccSegment(srgbIccProfile());
  const out = new Uint8Array(encoded.length + segment.length);
  out.set(encoded.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(encoded.subarray(2), 2 + segment.length);
  return out;
}
