# Bot WhatsApp — écouter les messages vocaux

## Pourquoi

Dans les conversations YCloud (82 conversations, 147 messages reçus au 20/11/2026), 3 vocaux viennent de 2 prospects arrivés par la pub. Dans les deux cas, le vocal **est leur question**, juste après l'accueil. Le bot répond « Je ne peux pas encore écouter… » ; l'un des deux renvoie un second vocal au lieu d'écrire, puis on le perd. Le trafic de la pub va grandir, et beaucoup de prospects marocains parlent plutôt qu'ils n'écrivent.

Accord du propriétaire : « Oui » à « un vocal devient une question écrite », conception, plan, code, revue et PR sans validation intermédiaire.

## Ce qui est construit

Un vocal reçu est transcrit, puis traité comme un message tapé : même assistant, mêmes faits, même passage au conseiller.

1. Le router envoie `audio` vers une nouvelle action `voice`, à la place de `mediaHandoff`, aux mêmes conditions qu'un texte libre : silence pendant un handoff, accueil d'abord pour un premier contact, conseiller quand le plafond quotidien de l'assistant (20) est atteint. Vidéo, document, localisation et contact gardent `mediaHandoff`.
2. Le webhook télécharge le vocal par l'API Graph (comme les photos) : `audio/ogg` (notes vocales, Opus), `audio/mpeg`, `audio/aac` (`audio/mp4` et `audio/amr` refusés : Gemini ne les liste pas), 1 Mo au plus.
3. Gemini (OpenRouter, Chat Completions, `input_audio` en base64) transcrit mot pour mot : darija et arabe en lettres arabes, français en lettres latines, sans traduction ni résumé ; un texte vide s'il n'y a pas de parole compréhensible. Modèle : `WHATSAPP_VOICE_MODEL`, par défaut `google/gemini-3.7-flash` (indépendant du modèle texte du bot, qui pourrait ne pas comprendre l'audio).
4. La transcription est écrite dans le `body` du message entrant (elle entre dans l'historique de l'assistant), la langue du contact est détectée sur elle, puis l'assistant répond exactement comme à un texte.
5. Tout échec (pas de clé, média refusé ou trop gros, format non pris, délai, transcription vide, plus de 10 vocaux du même numéro sur 24 h) donne un message honnête : « Je n'ai pas bien compris votre message vocal 🙏 Écrivez-moi votre question en quelques mots, ou un conseiller vous répond très vite. » (et l'équivalent en darija), avec le même passage au conseiller qu'aujourd'hui. Un échec ne fait donc jamais pire que le comportement actuel.

## Contraintes

- Le vocal n'est jamais stocké ; seule la transcription l'est, comme un texte tapé.
- Aucun contenu dans les logs : seulement des codes de raison.
- Budget de la route : 60 s. Graph 2 × 5 s, transcription 15 s, puis l’assistant reçoit le temps restant d’un budget de 35 s (15 s au plus) ; sous 4 s, le message de repli part à sa place.
- `mediaHandoff` ne dit plus « écouter » (il ne couvre plus l'audio).

## Approches écartées

- **Donner l'audio directement à l'assistant, en un seul appel** : l'historique n'aurait pas de texte pour ce message, et l'assistant devrait devenir multimodal. Deux appels coûtent un peu plus mais gardent un seul chemin de réponse.
- **Endpoint `/audio/transcriptions` (Whisper)** : la darija y est moins bien transcrite, et ce serait un modèle et un format de plus à configurer.
- **Dictée de pièces → plan de coupe** : aucun prospect ne l'a fait ; à reconsidérer si ça apparaît.

## Laissé au constructeur

Noms des modules et des fonctions, forme exacte des codes d'erreur, découpage des tests.
