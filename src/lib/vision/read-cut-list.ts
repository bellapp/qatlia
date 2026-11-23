/**
 * Reads a photographed cut list with the vision model: the request, the JSON
 * extraction and the piece normalisation the site's scan (/api/vision) has
 * always used, shared with the WhatsApp bot. Billing, auth and the demo mode
 * stay with each caller.
 *
 * `readPanel` (the bot only) appends one instruction asking for the stock
 * panel size when the sheet states one. Without it the request is exactly the
 * site's (pinned by tests/fixtures/vision-request.json).
 *
 * `classifyPhoto` (the bot only) is asked only after a read found no pieces:
 * was the photo a drawing of the furniture, or the furniture itself?
 */

import { isPlaceholder } from '@/lib/billing/config';
import { edgesFromCounts } from '@/lib/pieces/edge-marks';
import type { EdgeBandingConfig } from '@/lib/cutting/binpacking';

export interface ReadPiece {
  name: string;
  height: number;
  width: number;
  quantity: number;
  edges?: EdgeBandingConfig;
}

export interface ReadSheet {
  height: number;
  width: number;
}

/** What the bot's photo showed instead of a list (classifyPhoto). */
export type NotAListKind = 'drawing' | 'furniture';

export type ReadResult =
  | { status: 'ok'; pieces: ReadPiece[]; sheet: ReadSheet | null }
  | { status: 'unreadable' }
  | { status: 'unavailable' }
  | { status: 'error'; rateLimited: boolean; httpStatus: number };

export const SYSTEM_PROMPT = `Tu es un expert en lecture de fiches de débit pour menuisiers et artisans.
Tu dois analyser attentivement l'image et extraire les dimensions EXACTES de chaque ligne sous la convention : HAUTEUR (Y) × LARGEUR (X) = QUANTITÉ en CENTIMÈTRES (cm).

Règles impératives :
1. Extrais les cotes en centimètres (cm). Si l'image contient des millimètres (ex: 2300 x 1200 ou 418.00 x 380.00), convertis en centimètres (ex: 230 x 120, 41.8 x 38).
2. La quantité est le nombre à droite (ex: "418 x 380   7" -> height: 41.8, width: 38, quantity: 7). Si la fiche a une colonne de quantité (العدد, Qté, Nb), la quantité est TOUJOURS le nombre de cette colonne : un trait dans une colonne de chants n'est jamais une quantité, même s'il ressemble à un "1".
3. "name" : le libellé écrit sur la ligne (ex: "Côté G"), recopié tel quel. Si la ligne n'en a pas, mets "" : n'invente jamais de nom.
4. Chants (bandes de chant) : UNIQUEMENT si la fiche a une colonne dédiée aux chants (en-tête حواف, تسفيط, Chants ou équivalent). Pour chaque ligne, compte les chants marqués dans cette colonne :
   - "edgesHeight" = nombre de chants le long de la HAUTEUR (côtés de la première cote) : "|" = 1, "||" = 2 ;
   - "edgesWidth" = nombre de chants le long de la LARGEUR (côtés de la deuxième cote) : "—" = 1, "=" = 2 ;
   - un rectangle "□" = 4 chants : edgesHeight 2 et edgesWidth 2 ; "⊐" ou "[" = 3 chants : edgesHeight 1 et edgesWidth 2 ;
   - case vide, marque illisible, ou fiche sans colonne de chants : edgesHeight 0 et edgesWidth 0. Les lignes du quadrillage ne sont jamais des chants. N'invente jamais de chant.
   - SEULES les marques écrites DANS la colonne des chants comptent. Un signe « = » écrit sur la ligne des cotes, entre les dimensions et la quantité (ex: "88 x 32 = 4"), est un signe égal qui sépare la quantité : ce n'est JAMAIS un chant. De même, un « x », « × », « - » ou « / » entre deux cotes n'est jamais un chant.
5. Retourne STRICTEMENT un objet JSON :
{
  "pieces": [
    { "name": "", "height": 230, "width": 120, "quantity": 2, "edgesHeight": 0, "edgesWidth": 0 },
    { "name": "", "height": 118, "width": 48, "quantity": 1, "edgesHeight": 1, "edgesWidth": 0 },
    { "name": "Côté G", "height": 41.8, "width": 38, "quantity": 7, "edgesHeight": 2, "edgesWidth": 0 },
    { "name": "", "height": 53.1, "width": 48, "quantity": 4, "edgesHeight": 0, "edgesWidth": 1 },
    { "name": "", "height": 51.3, "width": 48, "quantity": 2, "edgesHeight": 2, "edgesWidth": 2 }
  ]
}`;

const USER_PROMPT = `Extrais la liste des pièces de cette image sous format JSON {"pieces": [...]}.`;

/** Appended for the bot: the panel size written on the sheet, never counted as a piece. */
const PANEL_INSTRUCTION = `

Format du panneau : si la fiche indique le format du panneau à découper (ex : "panneau 280x207", "plaque 244 x 122", "لوحة 280×207"), ajoute au même objet JSON un champ "sheet": { "height": 280, "width": 207 } en centimètres (convertis les millimètres), et ne compte JAMAIS cette ligne comme une pièce. Si la fiche n'indique aucun format de panneau, n'ajoute pas de champ "sheet".`;

type RawPiece = {
  name?: string;
  height?: number | string;
  width?: number | string;
  quantity?: number | string;
  edgesHeight?: unknown;
  edgesWidth?: unknown;
};

function extractJson(text: string): { pieces?: RawPiece[]; sheet?: unknown } | null {
  let cleaned = text.trim();
  // Strip Markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Find first { and last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const substr = cleaned.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(substr);
    } catch {}
  }

  // Find [ ... ] if array returned
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const substr = cleaned.substring(firstBracket, lastBracket + 1);
    try {
      const arr = JSON.parse(substr);
      return { pieces: arr };
    } catch {}
  }

  // Truncated generation (finish_reason "length"): close the dangling JSON so
  // complete rows already written are salvageable instead of discarding the
  // whole analysis. The tail is cut back to the last complete piece object.
  if (cleaned.includes('"pieces"')) {
    const start = cleaned.indexOf('{');
    if (start !== -1) {
      const tail = cleaned.slice(start);
      // Keep only fully-written piece objects: from the opening piece brace to
      // the last complete `}` that closes one (followed by optional comma/space).
      const piecesStart = tail.indexOf('[', tail.indexOf('"pieces"'));
      if (piecesStart !== -1) {
        const inner = tail.slice(piecesStart + 1);
        let lastComplete = -1;
        let depth = 0;
        for (let i = 0; i < inner.length; i++) {
          const ch = inner[i];
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) lastComplete = i;
          }
        }
        if (lastComplete > 0) {
          const salvage = tail.slice(0, piecesStart + 1) + inner.slice(0, lastComplete + 1) + ']}';
          try {
            const parsed = JSON.parse(salvage);
            if (parsed && Array.isArray(parsed.pieces) && parsed.pieces.length > 0) {
              return parsed;
            }
          } catch {}
        }
      }
    }
  }

  return null;
}

/** A positive size in cm on both sides, or null. */
function readSheet(value: unknown): ReadSheet | null {
  if (!value || typeof value !== 'object') return null;
  const { height, width } = value as { height?: unknown; width?: unknown };
  const h = typeof height === 'number' ? height : typeof height === 'string' ? Number(height) : NaN;
  const w = typeof width === 'number' ? width : typeof width === 'string' ? Number(width) : NaN;
  return Number.isFinite(h) && Number.isFinite(w) && h > 0 && w > 0 ? { height: h, width: w } : null;
}

function normalizePiece(p: RawPiece): ReadPiece {
  // Edge marks read from the chants column; absent when the line has none,
  // so a piece without edges keeps exactly the shape it had before.
  const edges = edgesFromCounts(p.edgesHeight, p.edgesWidth);
  return {
    // An unnamed line comes back with an empty name: the atelier numbers it in
    // the artisan's own language. A generic "Pièce 3" invented by the model counts as unnamed.
    name: p.name && !/^pi[eè]ce\s*\d+$/i.test(String(p.name).trim()) ? String(p.name).trim() : '',
    height: Math.abs(parseFloat(String(p.height || 10))),
    width: Math.abs(parseFloat(String(p.width || 10))),
    quantity: Math.max(1, parseInt(String(p.quantity || 1), 10) || 1),
    ...(edges ? { edges } : {}),
  };
}

/** The model provider from the environment (OpenRouter first), or null without a real key. */
function provider(): { endpoint: string; model: string; headers: Record<string, string> } | null {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const apiKey = openrouterKey || openaiKey;
  const isUsingOpenRouter = !isPlaceholder(openrouterKey);
  if (isPlaceholder(apiKey)) return null;
  return {
    endpoint: isUsingOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions',
    model: isUsingOpenRouter ? process.env.OPENROUTER_MODEL || 'google/gemini-3.7-flash' : 'gpt-4o-mini',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(isUsingOpenRouter
        ? {
            'HTTP-Referer': 'https://qatlia.vercel.app',
            'X-Title': 'QatliA Cutting Optimization',
          }
        : {}),
    },
  };
}

/**
 * `timeoutMs` (the bot only) puts a deadline on the model call; running out
 * of time is then an 'error' result. The site passes none, so its request and
 * its failures stay exactly as they were.
 */
export async function readCutList(
  imageDataUrl: string,
  options: { readPanel?: boolean; timeoutMs?: number } = {},
): Promise<ReadResult> {
  const chosen = provider();
  if (!chosen) return { status: 'unavailable' };
  const { endpoint, model } = chosen;
  const systemPrompt = options.readPanel ? SYSTEM_PROMPT + PANEL_INSTRUCTION : SYSTEM_PROMPT;

  const request: RequestInit = {
    method: 'POST',
    headers: chosen.headers,
    body: JSON.stringify({
      model,
      // Large cut lists (30+ rows) need room: each row is ~50 output tokens,
      // and vision models may spend hidden reasoning tokens first. 8000
      // covers a full A4 cut list without the truncation that used to yield
      // an unusable unterminated JSON (reported as "no readable measures").
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER_PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  };
  if (options.timeoutMs) request.signal = AbortSignal.timeout(options.timeoutMs);

  let res: Response;
  try {
    res = await fetch(endpoint, request);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (options.timeoutMs && (name === 'TimeoutError' || name === 'AbortError')) {
      return { status: 'error', rateLimited: false, httpStatus: 0 };
    }
    throw error;
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error('Vision API error:', errText);
    return { status: 'error', rateLimited: errText.includes('rate limit') || errText.includes('429'), httpStatus: res.status };
  }

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content || '';
  const parsed = extractJson(rawContent);
  if (!parsed || !Array.isArray(parsed.pieces) || parsed.pieces.length === 0) return { status: 'unreadable' };

  return {
    status: 'ok',
    pieces: parsed.pieces.map(normalizePiece),
    sheet: options.readPanel ? readSheet(parsed.sheet) : null,
  };
}

/**
 * The bot only: measurements a prospect types in WhatsApp instead of a photo
 * (22/11/2026: « 180x160/140x120/260x60 », a carpenter giving his doors one
 * message at a time). Same model and same JSON as a photo read, text only.
 */
export const TYPED_SYSTEM_PROMPT = `Tu lis un message WhatsApp où un menuisier marocain tape les mesures des pièces à couper, en darija, en arabe ou en français, parfois en plusieurs messages.
Extrais chaque pièce sous la convention : HAUTEUR × LARGEUR = QUANTITÉ, en CENTIMÈTRES (cm).

Règles impératives :
1. Une pièce a deux cotes. Une cote seule, une épaisseur (سمك, épaisseur, 18 mm) ou un prix ne sont jamais des pièces.
2. Les cotes sont en centimètres. Si elles sont visiblement en millimètres (ex : 2300 x 1200, 450 x 1950), convertis en centimètres (230 x 120, 45 x 195). Des mètres (2.80) se convertissent aussi (280).
3. La quantité : "x2" ou "× 2" après les deux cotes, "= 2", "2 حبات", "زوج" (2), "4 بيبان", "2 pièces"… Sans quantité, mets 1.
4. "name" : le nom donné à la pièce s'il y en a un (ex : "باب", "جنب", "Côté G"), sinon "". N'invente jamais de nom.
5. Le format du panneau (ex : "panneau 280x207", "لوحة 244*122", "بلاكة 2.80 × 2.07", "البانو 2800/2100") n'est JAMAIS une pièce : mets-le dans le champ "sheet": {"height": 280, "width": 207}, en cm. Une seule paire de cotes de la taille d'un panneau entier (244 x 122, 280 x 207, 300 x 122 ou plus), sans autre pièce, est le format du panneau.
6. Les dimensions d'un meuble entier (ماريو, دولاب, placard, armoire, cuisine : "ماريوا 200 الطول العرض 100") ne sont pas des pièces à couper : ignore-les.
7. N'invente jamais une pièce ni une cote. Si le message ne donne aucune pièce complète, retourne {"pieces": []}.
8. Retourne STRICTEMENT un objet JSON, sans "sheet" si aucun format de panneau n'est donné :
{
  "pieces": [
    { "name": "باب", "height": 195, "width": 45, "quantity": 4 },
    { "name": "", "height": 180, "width": 160, "quantity": 1 }
  ],
  "sheet": { "height": 280, "width": 207 }
}`;

export async function readTypedCutList(text: string, options: { timeoutMs?: number } = {}): Promise<ReadResult> {
  const chosen = provider();
  if (!chosen) return { status: 'unavailable' };
  const request: RequestInit = {
    method: 'POST',
    headers: chosen.headers,
    body: JSON.stringify({
      model: chosen.model,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: TYPED_SYSTEM_PROMPT },
        { role: 'user', content: `Message du menuisier :\n${text}` },
      ],
    }),
  };
  if (options.timeoutMs) request.signal = AbortSignal.timeout(options.timeoutMs);

  // The bot falls back to its assistant on any failure: never a throw.
  let res: Response;
  try {
    res = await fetch(chosen.endpoint, request);
  } catch {
    return { status: 'error', rateLimited: false, httpStatus: 0 };
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { status: 'error', rateLimited: errText.includes('rate limit') || errText.includes('429'), httpStatus: res.status };
  }
  const data = await res.json().catch(() => null);
  const parsed = extractJson(data?.choices?.[0]?.message?.content || '');
  if (!parsed || !Array.isArray(parsed.pieces) || parsed.pieces.length === 0) return { status: 'unreadable' };
  return { status: 'ok', pieces: parsed.pieces.map(normalizePiece), sheet: readSheet(parsed.sheet) };
}

/**
 * Asked only after a bot photo read found no pieces (23/11/2026: a hand drawing
 * of a kitchen, a fitted kitchen, a cupboard were all told « take the photo
 * again »). A separate call, so the reads that work are left exactly as they
 * were. Null for a list, or anything else, or on any failure: never a throw.
 */
export const CLASSIFY_PROMPT = `Un menuisier a envoyé cette image au lieu de la liste des pièces à couper. Dis ce qu'elle montre.
- "drawing" : un dessin, un croquis ou un plan de meuble, de cuisine ou de placard (même avec des cotes : longueur totale, largeurs des caissons).
- "furniture" : la photo d'un meuble, d'une cuisine, d'un placard ou d'une pièce de la maison.
- "list" : une liste ou un tableau de pièces avec leurs mesures, même mal photographié.
- "other" : autre chose.
Retourne STRICTEMENT un objet JSON : {"kind": "drawing"}`;

export async function classifyPhoto(imageDataUrl: string, options: { timeoutMs: number }): Promise<NotAListKind | null> {
  const chosen = provider();
  if (!chosen) return null;
  try {
    const res = await fetch(chosen.endpoint, {
      method: 'POST',
      headers: chosen.headers,
      signal: AbortSignal.timeout(options.timeoutMs),
      body: JSON.stringify({
        model: chosen.model,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: CLASSIFY_PROMPT },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = extractJson(data?.choices?.[0]?.message?.content || '') as { kind?: unknown } | null;
    return parsed?.kind === 'drawing' || parsed?.kind === 'furniture' ? parsed.kind : null;
  } catch {
    return null;
  }
}
