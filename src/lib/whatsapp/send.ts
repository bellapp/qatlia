/**
 * Sends a text message, a text with reply buttons, or an image, through the Meta Graph
 * API or through YCloud.
 *
 * YCloud is used when it is configured: the bot number was onboarded with it,
 * and Meta only lets YCloud send from that number. Inbound messages still
 * arrive through the Meta webhook either way.
 *
 * Never throws: the caller is a webhook that must answer 200 whatever happens.
 * Failures are logged with the HTTP status, the error name or a provider error
 * code only, never a token, an API key nor a response body.
 *
 * A send is tried a second time when the first one surely did not go out (the
 * connection failed, or the provider answered 429 or 503). A timeout, a 500,
 * 502 or 504 is not retried: the message may have left, and the prospect
 * would get it twice.
 */

import type { WhatsAppConfig, YCloudConfig } from '@/lib/whatsapp/config';
import type { MenuButton } from '@/lib/whatsapp/copy';

const SEND_TIMEOUT_MS = 10000;
export const SEND_RETRY_DELAY_MS = 500;
const YCLOUD_SEND_URL = 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly';

/**
 * A picture with a button under it that opens a link (WhatsApp "cta_url"):
 * a WhatsApp image opens full screen and never a link (owner, 21/11/2026:
 * « l'image cliquable pour renvoyer vers le site »).
 */
export interface PlanCard {
  /** Public link of the picture shown on top. */
  image: string;
  /** Up to 1024 characters. */
  body: string;
  /** The button's label, up to 20 characters. */
  button: string;
  url: string;
}

type Message =
  | { body: string; buttons?: readonly MenuButton[] }
  | { image: { link: string; caption: string } }
  | { card: PlanCard };

/** One attempt: the message id, or whether trying again is safe. */
type Attempt = { id: string } | { id: null; retry: boolean };

const sent = (id: string): Attempt => ({ id });
const failed = (retry: boolean): Attempt => ({ id: null, retry });

/**
 * Too many requests, or the provider unavailable: it did not take the message.
 * Other 5xx (often a gateway timeout) may come after the message was accepted.
 */
function retryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

/**
 * A business-scoped user id ("MA.1163870366035687"): a user who hid their phone
 * number behind a WhatsApp username. Both APIs take it as `recipient`, not `to`.
 */
export function isBusinessScopedId(id: string): boolean {
  return /^[A-Z]{2}\.[A-Za-z0-9.]+$/.test(id);
}

/** The type-specific part of a send request. Both APIs share the interactive shape; only the link preview flag differs. */
function content(message: Message, previewKey: 'preview_url' | 'previewUrl'): Record<string, unknown> {
  // An image by link: both APIs take the same shape.
  if ('image' in message) return { type: 'image', image: { link: message.image.link, caption: message.image.caption } };
  if ('card' in message) {
    const { card } = message;
    return {
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        header: { type: 'image', image: { link: card.image } },
        body: { text: card.body },
        action: { name: 'cta_url', parameters: { display_text: card.button, url: card.url } },
      },
    };
  }
  if (!message.buttons) return { type: 'text', text: { body: message.body, [previewKey]: true } };
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: message.body },
      action: {
        buttons: message.buttons.map((button) => ({ type: 'reply', reply: { id: button.id, title: button.title } })),
      },
    },
  };
}

/** A thrown fetch: a connection failure is safe to retry, a timeout or an abort is not. */
function logFailure(error: unknown): Attempt {
  const reason = error instanceof Error ? error.name : 'unknown error';
  console.error(`[whatsapp] send failed (${reason})`);
  return failed(reason !== 'TimeoutError' && reason !== 'AbortError');
}

async function sendViaMeta(
  config: WhatsAppConfig,
  to: string,
  message: Message,
  fetchImpl: typeof fetch,
): Promise<Attempt> {
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
        ...(isBusinessScopedId(to) ? { recipient: to } : { to }),
        ...content(message, 'preview_url'),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[whatsapp] send failed (HTTP ${res.status})`);
      return failed(retryableStatus(res.status));
    }

    const json = (await res.json()) as { messages?: Array<{ id?: unknown }> };
    const id = json?.messages?.[0]?.id;
    if (typeof id !== 'string' || !id) {
      console.error('[whatsapp] send failed (no message id in the response)');
      return failed(false);
    }
    return sent(id);
  } catch (error) {
    return logFailure(error);
  }
}

/**
 * Why YCloud refused a message: the code and message of its error body, and
 * WhatsApp's own when YCloud relays it. Only those fields, cut short: the body
 * is never logged whole.
 */
async function ycloudErrorDetail(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as {
      error?: { code?: unknown; message?: unknown; whatsappApiError?: { code?: unknown; message?: unknown } };
    };
    const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 200) : '');
    const error = json?.error;
    const parts = [text(error?.code), text(error?.message)];
    const whatsapp = error?.whatsappApiError;
    if (whatsapp) parts.push(`WhatsApp ${text(whatsapp.code)} ${text(whatsapp.message)}`.trim());
    const detail = parts.filter(Boolean).join(' · ');
    return detail ? `: ${detail}` : '';
  } catch {
    return '';
  }
}

async function sendViaYCloud(
  ycloud: YCloudConfig,
  to: string,
  message: Message,
  fetchImpl: typeof fetch,
): Promise<Attempt> {
  try {
    const res = await fetchImpl(YCLOUD_SEND_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': ycloud.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ycloud.from,
        ...(isBusinessScopedId(to) ? { recipient: to } : { to: to.startsWith('+') ? to : `+${to}` }),
        ...content(message, 'previewUrl'),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[whatsapp] send failed (YCloud HTTP ${res.status}${await ycloudErrorDetail(res)})`);
      return failed(retryableStatus(res.status));
    }

    const json = (await res.json()) as { id?: unknown; wamid?: unknown; status?: unknown; errorCode?: unknown };
    if (json?.status === 'failed') {
      const code = typeof json.errorCode === 'string' || typeof json.errorCode === 'number' ? String(json.errorCode) : 'unknown';
      console.error(`[whatsapp] send failed (YCloud error ${code.slice(0, 40)})`);
      return failed(false);
    }
    // The WhatsApp id lets the store recognise this message; the YCloud id is a
    // unique stand-in when WhatsApp has not assigned one yet.
    if (typeof json?.wamid === 'string' && json.wamid) return sent(json.wamid);
    if (typeof json?.id === 'string' && json.id) return sent(`ycloud:${json.id}`);
    console.error('[whatsapp] send failed (no message id in the YCloud response)');
    return failed(false);
  } catch (error) {
    return logFailure(error);
  }
}

function attempt(config: WhatsAppConfig, to: string, message: Message, fetchImpl: typeof fetch): Promise<Attempt> {
  return config.ycloud
    ? sendViaYCloud(config.ycloud, to, message, fetchImpl)
    : sendViaMeta(config, to, message, fetchImpl);
}

async function send(config: WhatsAppConfig, to: string, message: Message, fetchImpl: typeof fetch): Promise<string | null> {
  const first = await attempt(config, to, message, fetchImpl);
  if (first.id !== null) return first.id;
  if (!first.retry) return null;
  await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_DELAY_MS));
  return (await attempt(config, to, message, fetchImpl)).id;
}

/** Returns the id of the sent message, or `null` on any failure. */
export async function sendText(
  config: WhatsAppConfig,
  to: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  return send(config, to, { body }, fetchImpl);
}

/** Sends `body` with up to 3 reply buttons under it. Returns the message id, or `null` on any failure. */
export async function sendButtons(
  config: WhatsAppConfig,
  to: string,
  body: string,
  buttons: readonly MenuButton[],
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  return send(config, to, { body, buttons }, fetchImpl);
}

/** Sends the image at the public `link` with its caption. Returns the message id, or `null` on any failure. */
export async function sendImage(
  config: WhatsAppConfig,
  to: string,
  link: string,
  caption: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  return send(config, to, { image: { link, caption } }, fetchImpl);
}

/** Sends the picture with its button to `card.url`. Returns the message id, or `null` on any failure. */
export async function sendPlanCard(
  config: WhatsAppConfig,
  to: string,
  card: PlanCard,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  return send(config, to, { card }, fetchImpl);
}
