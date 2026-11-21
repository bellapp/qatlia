/**
 * An sRGB color profile for a PNG drawn on the server.
 *
 * YCloud refuses an image message without an embedded color profile ("An
 * embedded color profile is required", docs.ycloud.com, image messages). The
 * plan image (src/app/(site)/w/[code]/plan.png) is rendered without one, so a
 * small ICC v2 sRGB profile is built here and inserted as an iCCP chunk.
 *
 * Server-only (node:zlib). Pure otherwise.
 */

import { deflateSync } from 'node:zlib';

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
  get length(): number {
    return this.bytes.length;
  }
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
  zeros(count: number): this {
    for (let i = 0; i < count; i++) this.u8(0);
    return this;
  }
  /** Pads with zeros to a multiple of 4, as ICC tag data must start aligned. */
  align(): this {
    while (this.bytes.length % 4 !== 0) this.u8(0);
    return this;
  }
  raw(other: Writer): this {
    this.bytes.push(...other.bytes);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** ICC s15Fixed16Number. */
const s15 = (value: number) => Math.round(value * 65536) >>> 0;

const xyz = (x: number, y: number, z: number) => new Writer().ascii('XYZ ').zeros(4).u32(s15(x)).u32(s15(y)).u32(s15(z));

let profile: Uint8Array | null = null;

/**
 * A minimal ICC v2 sRGB display profile: the sRGB primaries adapted to D50
 * (as in the reference sRGB profiles) and a 2.2 gamma curve, close enough to
 * the sRGB curve for a drawing of flat colors.
 */
export function srgbIccProfile(): Uint8Array {
  if (profile) return profile;

  const description = 'sRGB';
  const desc = new Writer()
    .ascii('desc')
    .zeros(4)
    .u32(description.length + 1)
    .ascii(description)
    .u8(0)
    .zeros(4 + 4) // Unicode language code and count
    .zeros(2 + 1 + 67); // ScriptCode code, count and the fixed 67 bytes
  const cprt = new Writer().ascii('text').zeros(4).ascii('No copyright, use freely').u8(0);
  const trc = new Writer().ascii('curv').zeros(4).u32(1).u16(Math.round(2.2 * 256));

  const blocks: Array<{ sigs: string[]; data: Writer }> = [
    { sigs: ['desc'], data: desc },
    { sigs: ['cprt'], data: cprt },
    { sigs: ['wtpt'], data: xyz(0.9642, 1, 0.8249) },
    { sigs: ['rXYZ'], data: xyz(0.4360747, 0.2225045, 0.0139322) },
    { sigs: ['gXYZ'], data: xyz(0.3850649, 0.7168786, 0.0971045) },
    { sigs: ['bXYZ'], data: xyz(0.1430804, 0.0606169, 0.7141733) },
    // One curve shared by the three channels.
    { sigs: ['rTRC', 'gTRC', 'bTRC'], data: trc },
  ];
  const tagCount = blocks.reduce((sum, block) => sum + block.sigs.length, 0);

  const table = new Writer().u32(tagCount);
  const data = new Writer();
  let offset = 128 + 4 + tagCount * 12;
  for (const block of blocks) {
    for (const sig of block.sigs) table.ascii(sig).u32(offset).u32(block.data.length);
    data.raw(block.data).align();
    offset = 128 + 4 + tagCount * 12 + data.length;
  }

  const size = 128 + table.length + data.length;
  const header = new Writer()
    .u32(size)
    .zeros(4) // preferred CMM
    .u32(0x02100000) // version 2.1
    .ascii('mntr')
    .ascii('RGB ')
    .ascii('XYZ ')
    .u16(2026).u16(1).u16(1).u16(0).u16(0).u16(0)
    .ascii('acsp')
    .zeros(4 + 4 + 4 + 4 + 8) // platform, flags, manufacturer, model, attributes
    .u32(0) // perceptual
    .u32(s15(0.9642)).u32(s15(1)).u32(s15(0.8249)) // D50
    .zeros(4) // creator
    .zeros(44); // profile id and reserved, to 128 bytes

  profile = new Writer().raw(header).raw(table).raw(data).done();
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
