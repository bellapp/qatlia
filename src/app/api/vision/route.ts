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

    const systemPrompt = `Tu es un expert en lecture de fiches de débit et de listes de mesures manuscrites pour menuisiers et artisans du bois.
Analyse attentivement l'image et extrais TOUTES les pièces à découper.
Chaque ligne manuscrite contient généralement :
- Des dimensions (longueur / hauteur × largeur en centimètres)
- Une quantité (souvent notée "x2", "2 pcs", "= 4", ou un chiffre dans une colonne quantité)
- Éventuellement un nom de pièce (ex: "étagère", "porte", "côté", "socle", "tiroir")

Règles impératives :
1. Dimensions en CENTIMÈTRES (ex: 237 cm, 59.5 cm).
2. Si une quantité n'est pas spécifiée, mets 1 par défaut.
3. Si un nom n'est pas précisé, nomme-le "Pièce 1", "Pièce 2", etc.
4. Réponds UNIQUEMENT en JSON strict valide sans texte avant ou après.`;

    const userPrompt = `Analyse cette image de mesures et extrais la liste complète des pièces sous ce format JSON exact :
{
  "pieces": [
    { "name": "Panneau Latéral", "width": 237, "height": 56, "quantity": 1 },
    { "name": "Étagère", "width": 88, "height": 88, "quantity": 2 }
  ],
  "confidence": 0.98,
  "notes": "Toutes les mesures manuscrites ont été extraites avec précision."
}`;

    const endpoint = isUsingOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const model = isUsingOpenRouter
      ? (process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash')
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
