/**
 * Sends a text message, through the Meta Graph API or through YCloud.
 *
 * YCloud is used when it is configured: the bot number was onboarded with it,
 * and Meta only lets YCloud send from that number. Inbound messages still
 * arrive through the Meta webhook either way.
 *
 * Never throws: the caller is a webhook that must answer 200 whatever happens.
 * Failures are logged with the HTTP status, the error name or a provider error
 * code only, never a token, an API key nor a response body.
 */

import type { WhatsAppConfig, YCloudConfig } from '@/lib/whatsapp/config';

const SEND_TIMEOUT_MS = 10000;
const YCLOUD_SEND_URL = 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly';

function logFailure(error: unknown): null {
  const reason = error instanceof Error ? error.name : 'unknown error';
  console.error(`[whatsapp] send failed (${reason})`);
  return null;
}

async function sendViaMeta(
  config: WhatsAppConfig,
  to: string,
  body: string,
  fetchImpl: typeof fetch,
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
    return logFailure(error);
  }
}

async function sendViaYCloud(
  ycloud: YCloudConfig,
  to: string,
  body: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(YCLOUD_SEND_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': ycloud.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ycloud.from,
        to: to.startsWith('+') ? to : `+${to}`,
        type: 'text',
        text: { body, previewUrl: true },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[whatsapp] send failed (YCloud HTTP ${res.status})`);
      return null;
    }

    const json = (await res.json()) as { id?: unknown; wamid?: unknown; status?: unknown; errorCode?: unknown };
    if (json?.status === 'failed') {
      const code = typeof json.errorCode === 'string' || typeof json.errorCode === 'number' ? String(json.errorCode) : 'unknown';
      console.error(`[whatsapp] send failed (YCloud error ${code.slice(0, 40)})`);
      return null;
    }
    // The WhatsApp id lets the store recognise this message; the YCloud id is a
    // unique stand-in when WhatsApp has not assigned one yet.
    if (typeof json?.wamid === 'string' && json.wamid) return json.wamid;
    if (typeof json?.id === 'string' && json.id) return `ycloud:${json.id}`;
    console.error('[whatsapp] send failed (no message id in the YCloud response)');
    return null;
  } catch (error) {
    return logFailure(error);
  }
}

/** Returns the id of the sent message, or `null` on any failure. */
export async function sendText(
  config: WhatsAppConfig,
  to: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  return config.ycloud
    ? sendViaYCloud(config.ycloud, to, body, fetchImpl)
    : sendViaMeta(config, to, body, fetchImpl);
}
