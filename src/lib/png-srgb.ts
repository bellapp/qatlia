/**
 * An sRGB color profile for a PNG drawn on the server.
 *
 * YCloud refuses an image message without an embedded color profile ("An
 * embedded color profile is required", docs.ycloud.com, image messages). The
 * plan image (src/app/(site)/w/[code]/plan.png) is rendered without one, so the
 * sRGB profile of the example cut list, which YCloud delivers, goes in as an iCCP chunk.
 *
 * Server-only (node:zlib). Pure otherwise.
 */

import { deflateSync } from 'node:zlib';
import { SRGB_ICC_BASE64 } from '@/lib/srgb-icc';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;

/** The CRC-32 PNG chunks carry (ISO 3309, as in zlib). */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

class Writer {
  private bytes: number[] = [];
  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }
  u16(value: number): this {
    return this.u8(value >>> 8).u8(value);
  }
  u32(value: number): this {
    return this.u16(value >>> 16).u16(value);
  }
  ascii(text: string): this {
    for (const char of text) this.u8(char.charCodeAt(0));
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

let profile: Uint8Array | null = null;

/** The sRGB profile the example cut list already carries (src/lib/srgb-icc.ts). */
export function srgbIccProfile(): Uint8Array {
  if (!profile) profile = Uint8Array.from(Buffer.from(SRGB_ICC_BASE64, 'base64'));
  return profile;
}

function readU32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function chunkType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
}

/** The PNG with the sRGB profile as an iCCP chunk right after IHDR; unchanged when it already states one. */
export function withSrgbProfile(png: Uint8Array): Uint8Array {
  if (png.length < 33 || PNG_SIGNATURE.some((byte, i) => png[i] !== byte) || chunkType(png, 8) !== 'IHDR') {
    throw new Error('withSrgbProfile: not a PNG');
  }

  for (let at = 8; at + 12 <= png.length; at += 12 + readU32(png, at)) {
    const type = chunkType(png, at);
    if (type === 'iCCP' || type === 'sRGB') return png;
    if (type === 'IDAT') break;
  }

  const name = 'sRGB';
  const compressed = deflateSync(srgbIccProfile());
  const body = new Writer().ascii('iCCP').ascii(name).u8(0).u8(0).done();
  const typed = new Uint8Array(body.length + compressed.length);
  typed.set(body);
  typed.set(compressed, body.length);
  const chunk = new Writer()
    .u32(typed.length - 4)
    .done();
  const crc = new Writer().u32(crc32(typed)).done();

  const afterIhdr = 8 + 12 + readU32(png, 8);
  const out = new Uint8Array(png.length + chunk.length + typed.length + crc.length);
  out.set(png.subarray(0, afterIhdr), 0);
  out.set(chunk, afterIhdr);
  out.set(typed, afterIhdr + chunk.length);
  out.set(crc, afterIhdr + chunk.length + typed.length);
  out.set(png.subarray(afterIhdr), afterIhdr + chunk.length + typed.length + crc.length);
  return out;
}
