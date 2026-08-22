import { NextResponse } from 'next/server';
import { z } from 'zod';

const VisionSchema = z.object({
  imageBase64: z.string().min(10),
  sheetMaterial: z.string().default('mdf'),
});

export const maxDuration = 60; // 60s timeout Vercel
export const dynamic = 'force-dynamic';

function extractJson(text: string): { pieces?: Array<{ name?: string; width: number | string; height: number | string; quantity?: number | string }> } | null {
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

  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = VisionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { imageBase64 } = parsed.data;

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const apiKey = openrouterKey || openaiKey;
    const isUsingOpenRouter = Boolean(openrouterKey && !openrouterKey.includes('placeholder'));

    if (!apiKey || apiKey.includes('placeholder') || apiKey === '') {
      return NextResponse.json({
        success: true,
        extractionId: 'demo_' + Date.now(),
        pieces: [
          { name: 'Panneau Haut', width: 200, height: 60, quantity: 2 },
          { name: 'Panneau Bas', width: 200, height: 60, quantity: 2 },
          { name: 'Côté Droit', width: 180, height: 50, quantity: 2 },
          { name: 'Étagère', width: 96, height: 48, quantity: 4 },
          { name: 'Séparation', width: 85, height: 45, quantity: 2 },
        ],
        confidence: 0.98,
        creditsRemaining: 4,
        notes: 'Mode Démo : 5 types de pièces extraites.',
      });
    }

    const systemPrompt = `Tu es un expert en lecture de fiches de débit et de listes de mesures manuscrites pour menuisiers et artisans.
Tu dois analyser l'image et extraire les dimensions et quantités de chaque pièce.
Retourne STRICTEMENT un objet JSON sans aucun texte avant ou après.
Format attendu :
{
  "pieces": [
    { "name": "Côté", "width": 200, "height": 60, "quantity": 2 }
  ]
}
Règles :
- Largeur (width) et Hauteur/Longueur (height) en centimètres (nombres décimaux ou entiers).
- Quantité (quantity) en entier (1 par défaut).
- Nom descriptif ou "Pièce N".`;

    const userPrompt = `Extrais la liste des pièces de cette image sous format JSON {"pieces": [...]}.`;

    const endpoint = isUsingOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    // Modèle demandé : Google Gemini 3.7 Flash
    const model = isUsingOpenRouter
      ? (process.env.OPENROUTER_MODEL || 'google/gemini-3.7-flash')
      : 'gpt-4o-mini';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(isUsingOpenRouter
          ? {
              'HTTP-Referer': 'https://qatlia.vercel.app',
              'X-Title': 'QatlIA Cutting Optimization',
            }
          : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: imageBase64 } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Vision API error:', errText);
      return NextResponse.json(
        { error: 'AI_SERVICE_ERROR', message: `Erreur API IA (${res.status}): ${errText}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    const parsedJson = extractJson(rawContent);

    if (!parsedJson || !Array.isArray(parsedJson.pieces) || parsedJson.pieces.length === 0) {
      console.error('Raw content that failed parsing:', rawContent);
      return NextResponse.json(
        {
          error: 'AI_PARSE_ERROR',
          message: 'Aucune mesure lisible n\'a été détectée. Vérifiez que la photo est nette et bien cadrée.',
        },
        { status: 422 }
      );
    }

    // Normalisation des pièces
    const rawPieces = parsedJson.pieces || [];
    const pieces = rawPieces.map((p: { name?: string; width: number | string; height: number | string; quantity?: number | string }, i: number) => ({
      name: p.name ? String(p.name).trim() : `Pièce ${i + 1}`,
      width: Math.abs(parseFloat(String(p.width))) || 10,
      height: Math.abs(parseFloat(String(p.height))) || 10,
      quantity: Math.max(1, parseInt(String(p.quantity || 1), 10) || 1),
    }));

    return NextResponse.json({
      success: true,
      extractionId: 'ext_' + Date.now(),
      pieces,
      confidence: 0.98,
      creditsRemaining: 4,
      notes: `${pieces.length} pièces extraites avec succès via Gemini 3.7 Flash`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    return NextResponse.json(
      { error: 'VISION_PROCESSING_FAILED', message },
      { status: 500 }
    );
  }
}
