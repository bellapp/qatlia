/**
 * Verification of Meta's `X-Hub-Signature-256` header.
 *
 * The HMAC must be computed over the raw request body exactly as received;
 * a re-serialised body would never match.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith(PREFIX)) return false;
  const received = header.slice(PREFIX.length);
  if (!/^[0-9a-f]+$/i.test(received)) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const receivedBuffer = Buffer.from(received.toLowerCase(), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
