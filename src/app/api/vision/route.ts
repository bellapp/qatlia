import { NextResponse } from 'next/server';
import { z } from 'zod';

const VisionSchema = z.object({
  imageBase64: z.string().min(10),
  sheetMaterial: z.string().default('mdf'),
});

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

    // Détection de la clé (OpenRouter prioritaire, sinon OpenAI)
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    const apiKey = openrouterKey || openaiKey;
    const isUsingOpenRouter = Boolean(openrouterKey && !openrouterKey.includes('placeholder'));

    // Mode démo si aucune clé n'est configurée
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
        notes: 'Mode Démo : 5 types de pièces extraites avec succès.',
      });
    }

    const systemPrompt = `Tu es un assistant spécialisé dans la lecture de listes de mesures manuscrites pour menuisiers et artisans.
Extrais UNIQUEMENT les dimensions et quantités. Format de sortie : JSON strict.
Chaque ligne : largeur × hauteur = quantité (en centimètres).
Ignore les lignes barrées. Si une ligne est illisible, omets-la.
Ne jamais inventer des dimensions non visibles dans l'image.`;

    const userPrompt = `Lis cette image et extrais la liste de toutes les pièces à découper.
Retourne un JSON avec le format exact suivant, rien d'autre :
{
  "pieces": [
    { "name": "Pièce 1", "width": 246, "height": 59.5, "quantity": 1 },
    { "name": "Pièce 2", "width": 246, "height": 7, "quantity": 5 }
  ],
  "confidence": 0.95,
  "notes": "Mesures manuscrites extraites"
}`;

    const endpoint = isUsingOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const model = isUsingOpenRouter
      ? (process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini')
      : 'gpt-4o-mini';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(isUsingOpenRouter
          ? {
              'HTTP-Referer': 'https://qatlia.app',
              'X-Title': 'QatlIA Cutting Optimization',
            }
          : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
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
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: 'AI_SERVICE_ERROR', message: errText },
        { status: 502 }
      );
    }

    const data = await res.json();
    const content = JSON.parse(data.choices[0].message.content);

    return NextResponse.json({
      success: true,
      extractionId: 'ext_' + Date.now(),
      pieces: content.pieces || [],
      confidence: content.confidence || 0.9,
      creditsRemaining: 4,
      notes: content.notes || 'Extraction terminée',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    return NextResponse.json(
      { error: 'VISION_PROCESSING_FAILED', message },
      { status: 500 }
    );
  }
}
