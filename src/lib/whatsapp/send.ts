/**
 * Sends a text message through the WhatsApp Cloud API (Meta Graph API).
 *
 * Never throws: the caller is a webhook that must answer 200 whatever happens.
 * Failures are logged with the HTTP status or the error name only, never the
 * access token nor the response body.
 */

import type { WhatsAppConfig } from '@/lib/whatsapp/config';

const SEND_TIMEOUT_MS = 10000;

/** Returns the id of the sent message (`messages[0].id`), or `null` on any failure. */
export async function sendText(
  config: WhatsAppConfig,
  to: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body, preview_url: true },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[whatsapp] send failed (HTTP ${res.status})`);
      return null;
    }

    const json = (await res.json()) as { messages?: Array<{ id?: unknown }> };
    const id = json?.messages?.[0]?.id;
    if (typeof id !== 'string' || !id) {
      console.error('[whatsapp] send failed (no message id in the response)');
      return null;
    }
    return id;
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown error';
    console.error(`[whatsapp] send failed (${reason})`);
    return null;
  }
}
