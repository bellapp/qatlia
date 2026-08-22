import { NextResponse } from 'next/server';
import { z } from 'zod';

const VisionSchema = z.object({
  imageBase64: z.string().min(10),
  sheetMaterial: z.string().default('mdf'),
});

export const maxDuration = 60; // 60 secondes pour les appels vision IA sur Vercel
export const dynamic = 'force-dynamic';

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

    console.log(`[Vision API] Appel ${isUsingOpenRouter ? 'OpenRouter' : 'OpenAI'} avec model=${model}`);

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
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('AI error response:', errText);
      return NextResponse.json(
        { error: 'AI_SERVICE_ERROR', message: `Erreur du modèle IA (${res.status}): ${errText}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    
    // Nettoyage Markdown ```json ... ``` si présent
    let cleaned = rawContent.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsedContent: { pieces?: Array<{ name?: string; width: number; height: number; quantity?: number }>; confidence?: number; notes?: string } = {};
    try {
      parsedContent = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse AI JSON:', rawContent);
      return NextResponse.json(
        { error: 'AI_PARSE_ERROR', message: 'Le modèle IA n\'a pas renvoyé un format JSON lisible.' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      extractionId: 'ext_' + Date.now(),
      pieces: parsedContent.pieces || [],
      confidence: parsedContent.confidence || 0.9,
      creditsRemaining: 4,
      notes: parsedContent.notes || 'Extraction terminée',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    return NextResponse.json(
      { error: 'VISION_PROCESSING_FAILED', message },
      { status: 500 }
    );
  }
}
