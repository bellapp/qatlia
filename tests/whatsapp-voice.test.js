const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Voice notes sent to the bot (plan 2026-11-20-whatsapp-vocal): downloaded
// like the photos, transcribed word for word by Gemini through OpenRouter,
// then answered like a typed question by the webhook.

const { transcribeVoice, hearVoice, MAX_VOICES_PER_DAY, VOICE_TIMEOUT_MS } = loadTsModule('src/lib/whatsapp/voice.ts');
const { getWhatsAppConfig } = loadTsModule('src/lib/whatsapp/config.ts');

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const NOW = new Date('2026-11-20T12:00:00Z');
const AUDIO = Buffer.from([7, 7, 7]).toString('base64');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (content, finish = 'stop') => json(200, { choices: [{ message: { content }, finish_reason: finish }] });

function openrouter(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
    return respond();
  };
  return { impl, calls };
}

const quietly = async (fn) => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    return { value: await fn(), logged };
  } finally {
    console.error = original;
  }
};

// --- transcribeVoice ---------------------------------------------------------

test('the request : the voice model, the audio as input_audio, a transcription-only prompt, temperature 0', async () => {
  const { impl, calls } = openrouter(() => answer('{"text":"شحال الثمن ديال الكريدي؟"}'));
  const result = await transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'or_key', model: 'google/gemini-3.7-flash', fetchImpl: impl });
  assert.deepEqual(result, { status: 'ok', text: 'شحال الثمن ديال الكريدي؟' });
  const [call] = calls;
  assert.equal(call.url, OPENROUTER);
  assert.equal(call.init.headers.Authorization, 'Bearer or_key');
  assert.equal(call.body.model, 'google/gemini-3.7-flash');
  assert.equal(call.body.temperature, 0);
  const parts = call.body.messages.at(-1).content;
  assert.deepEqual(parts.find((p) => p.type === 'input_audio'), { type: 'input_audio', input_audio: { data: AUDIO, format: 'ogg' } });
  const prompt = call.body.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join(' '))).join(' ');
  assert.match(prompt, /mot pour mot/i);
  assert.match(prompt, /darija/i);
  assert.match(prompt, /lettres arabes/i);
  assert.match(prompt, /ne réponds pas/i);
  assert.ok(call.init.signal instanceof AbortSignal);
});

test('a fenced JSON or a plain-text transcript is read too', async () => {
  for (const content of ['```json\n{"text": "Bonjour, combien ça coûte ?"}\n```', 'Bonjour, combien ça coûte ?']) {
    const { impl } = openrouter(() => answer(content));
    assert.deepEqual(await transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'k', model: 'm', fetchImpl: impl }), {
      status: 'ok',
      text: 'Bonjour, combien ça coûte ?',
    });
  }
});

test('no speech : empty, never an empty WhatsApp message', async () => {
  for (const content of ['{"text":""}', '{"text":"   "}', '{"text":"..."}', '{"text":"🎵"}', '', '{}']) {
    const { impl } = openrouter(() => answer(content));
    assert.deepEqual(await transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'k', model: 'm', fetchImpl: impl }), { status: 'empty' }, JSON.stringify(content));
  }
});

test('the transcript is capped at 1000 characters', async () => {
  const { impl } = openrouter(() => answer(JSON.stringify({ text: 'a'.repeat(1500) })));
  const result = await transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'k', model: 'm', fetchImpl: impl });
  assert.equal(result.text.length, 1000);
});

test('an OpenRouter error, a network failure or the deadline : error, with a reason code and no content in the logs', async () => {
  const http = await quietly(() => transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'k', model: 'm', fetchImpl: openrouter(() => json(400, { error: 'unsupported audio' })).impl }));
  assert.deepEqual(http.value, { status: 'error', reason: 'http_400' });
  assert.ok(http.logged.some((line) => line.includes('400')));
  assert.ok(http.logged.every((line) => !line.includes('unsupported audio')));

  const network = await quietly(() =>
    transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'k', model: 'm', fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
  );
  assert.deepEqual(network.value, { status: 'error', reason: 'request_failed' });

  const slow = await quietly(() =>
    transcribeVoice({
      audioBase64: AUDIO,
      format: 'ogg',
      apiKey: 'k',
      model: 'm',
      timeoutMs: 20,
      fetchImpl: (url, init) =>
        new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    }),
  );
  assert.deepEqual(slow.value, { status: 'error', reason: 'request_failed' });
  assert.equal(VOICE_TIMEOUT_MS, 15000);
});

test('the finish reason is logged when the answer is unusable', async () => {
  const { value, logged } = await quietly(() =>
    transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'k', model: 'm', fetchImpl: openrouter(() => json(200, { choices: [{ message: { content: null }, finish_reason: 'content_filter' }] })).impl }),
  );
  assert.deepEqual(value, { status: 'error', reason: 'unusable' });
  assert.ok(logged.some((line) => line.includes('content_filter')));
});

// --- hearVoice ---------------------------------------------------------------

const CONFIG = { accessToken: 'tok', graphVersion: 'v23.0', openrouterKey: 'or_key', voiceModel: 'google/gemini-3.7-flash' };
const EVENT = { waId: '212600000001', wamid: 'wamid.V1', kind: 'audio', mediaId: 'MEDIA9', text: null };
const LOOKUP = 'https://graph.facebook.com/v23.0/MEDIA9';

function everything({ mime = 'audio/ogg; codecs=opus', transcript = '{"text":"Salam, bghit nchouf taman"}', lookupStatus = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(String(url));
    if (String(url) === LOOKUP) return lookupStatus === 200 ? json(200, { url: 'https://lookaside.example/v', mime_type: mime, file_size: 3 }) : json(lookupStatus, {});
    if (String(url) === OPENROUTER) return answer(transcript);
    return new Response(Buffer.from([7, 7, 7]), { status: 200 });
  };
  return { impl, calls };
}

const counter = (n) => {
  const seen = [];
  const fn = async (since) => {
    seen.push(since);
    return n;
  };
  fn.seen = seen;
  return fn;
};

test('a voice note is downloaded, sent as ogg, and heard', async () => {
  const net = everything();
  const countVoices = counter(1);
  const result = await hearVoice({ config: CONFIG, event: EVENT, now: NOW, countVoices, fetchImpl: net.impl });
  assert.deepEqual(result, { status: 'heard', text: 'Salam, bghit nchouf taman' });
  assert.deepEqual(net.calls, [LOOKUP, 'https://lookaside.example/v', OPENROUTER]);
  assert.equal(countVoices.seen[0].toISOString(), new Date(NOW.getTime() - 24 * 3600 * 1000).toISOString());
});

test('mp3 and aac are sent with their own format', async () => {
  for (const [mime, format] of [['audio/mpeg', 'mp3'], ['audio/aac', 'aac']]) {
    const bodies = [];
    const net = everything({ mime });
    const impl = async (url, init) => {
      if (String(url) === OPENROUTER) bodies.push(JSON.parse(init.body));
      return net.impl(url, init);
    };
    await hearVoice({ config: CONFIG, event: EVENT, now: NOW, countVoices: counter(1), fetchImpl: impl });
    assert.equal(bodies[0].messages.at(-1).content.find((p) => p.type === 'input_audio').input_audio.format, format);
  }
});

test(`more than ${MAX_VOICES_PER_DAY} voice notes from one number in 24 hours : unheard, nothing downloaded`, async () => {
  assert.equal(MAX_VOICES_PER_DAY, 10);
  const net = everything();
  assert.equal((await hearVoice({ config: CONFIG, event: EVENT, now: NOW, countVoices: counter(10), fetchImpl: net.impl })).status, 'heard');
  const over = everything();
  const { value } = await quietly(() => hearVoice({ config: CONFIG, event: EVENT, now: NOW, countVoices: counter(11), fetchImpl: over.impl }));
  assert.deepEqual(value, { status: 'unheard', reason: 'daily_cap' });
  assert.equal(over.calls.length, 0);
});

test('no media id or no OpenRouter key : unheard, nothing called', async () => {
  for (const [config, event, reason] of [
    [CONFIG, { ...EVENT, mediaId: null }, 'no_media'],
    [{ ...CONFIG, openrouterKey: null }, EVENT, 'no_key'],
  ]) {
    const net = everything();
    const { value } = await quietly(() => hearVoice({ config, event, now: NOW, countVoices: counter(1), fetchImpl: net.impl }));
    assert.deepEqual(value, { status: 'unheard', reason });
    assert.equal(net.calls.length, 0);
  }
});

test('a download refused, a type Gemini does not take, or an empty transcript : unheard with its reason', async () => {
  const cases = [
    [{ lookupStatus: 403 }, 'media_lookup_refused'],
    [{ mime: 'audio/amr' }, 'media_bad_type'],
    [{ transcript: '{"text":""}' }, 'empty'],
    [{ transcript: '' }, 'empty'],
  ];
  for (const [over, reason] of cases) {
    const { value, logged } = await quietly(() => hearVoice({ config: CONFIG, event: EVENT, now: NOW, countVoices: counter(1), fetchImpl: everything(over).impl }));
    assert.deepEqual(value, { status: 'unheard', reason }, reason);
    assert.ok(logged.some((line) => line.includes(reason)), `${reason} is logged`);
    assert.ok(logged.every((line) => !line.includes('212600000001')), 'no phone number in the logs');
  }
});

// --- config --------------------------------------------------------------------

const ENV = {
  WHATSAPP_APP_SECRET: 's',
  WHATSAPP_VERIFY_TOKEN: 'v',
  WHATSAPP_ACCESS_TOKEN: 'a',
  WHATSAPP_PHONE_NUMBER_ID: 'p',
};

test('voice : on by default with the Gemini flash model; WHATSAPP_VOICE_ENABLED=false turns it off; the model is its own', () => {
  const base = getWhatsAppConfig(ENV);
  assert.equal(base.voiceEnabled, true);
  assert.equal(base.voiceModel, 'google/gemini-3.7-flash');
  assert.equal(getWhatsAppConfig({ ...ENV, WHATSAPP_VOICE_ENABLED: 'false' }).voiceEnabled, false);
  assert.equal(getWhatsAppConfig({ ...ENV, WHATSAPP_VOICE_ENABLED: 'true' }).voiceEnabled, true);
  const own = getWhatsAppConfig({ ...ENV, WHATSAPP_BOT_MODEL: 'some/text-only-model', WHATSAPP_VOICE_MODEL: 'google/gemini-other' });
  assert.equal(own.voiceModel, 'google/gemini-other');
  assert.equal(getWhatsAppConfig({ ...ENV, WHATSAPP_BOT_MODEL: 'some/text-only-model' }).voiceModel, 'google/gemini-3.7-flash');
});

// --- review fixes ----------------------------------------------------------------

const { assistantBudgetMs, VOICE_MEDIA_TIMEOUT_MS } = loadTsModule('src/lib/whatsapp/voice.ts');

test('the transcript is asked as plain text: a long note cut by the token limit is still heard, and the cut is logged', async () => {
  const { impl, calls } = openrouter(() => answer('Salam, bghit nsowel 3la les panneaux dyal', 'length'));
  const { value, logged } = await quietly(() => transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'k', model: 'm', fetchImpl: impl }));
  assert.deepEqual(value, { status: 'ok', text: 'Salam, bghit nsowel 3la les panneaux dyal' });
  assert.ok(logged.some((line) => line.includes('length')));
  assert.ok(calls[0].body.max_tokens >= 4000, 'room for reasoning tokens');
  const prompt = calls[0].body.messages[0].content.find((p) => p.type === 'text').text;
  assert.doesNotMatch(prompt, /JSON/);
});

test('a JSON object cut in the middle keeps the text it had', async () => {
  const { impl } = openrouter(() => answer('{"text": "Bonjour, je voudrais savoir le prix', 'length'));
  const { value } = await quietly(() => transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'k', model: 'm', fetchImpl: impl }));
  assert.deepEqual(value, { status: 'ok', text: 'Bonjour, je voudrais savoir le prix' });
});

test('a label for non-speech ([musique], (silence)) is empty, not a question', async () => {
  for (const content of ['[musique]', '(silence)', '[bruit] (inaudible)']) {
    const { impl } = openrouter(() => answer(content));
    assert.deepEqual(await transcribeVoice({ audioBase64: AUDIO, format: 'ogg', apiKey: 'k', model: 'm', fetchImpl: impl }), { status: 'empty' }, content);
  }
});

test('a failing count does not stop the hearing (the assistant cap still bounds the cost)', async () => {
  const net = everything();
  const { value } = await quietly(() =>
    hearVoice({ config: CONFIG, event: EVENT, now: NOW, countVoices: async () => { throw new Error('db down'); }, fetchImpl: net.impl }),
  );
  assert.equal(value.status, 'heard');
});

test('the 60-second route budget: shorter media and transcription deadlines, and the assistant gets only what is left', () => {
  assert.equal(VOICE_MEDIA_TIMEOUT_MS, 5000);
  assert.equal(VOICE_TIMEOUT_MS, 15000);
  assert.equal(assistantBudgetMs(1000), 15000);
  assert.equal(assistantBudgetMs(25000), 10000);
  assert.equal(assistantBudgetMs(31500), null, 'not enough left: the fallback goes out instead');
});

test('the audio download uses the shorter deadline', async () => {
  const signals = [];
  const net = everything();
  const impl = async (url, init) => {
    signals.push(init?.signal);
    return net.impl(url, init);
  };
  const realTimeout = AbortSignal.timeout;
  const asked = [];
  AbortSignal.timeout = (ms) => {
    asked.push(ms);
    return realTimeout.call(AbortSignal, ms);
  };
  try {
    await hearVoice({ config: CONFIG, event: EVENT, now: NOW, countVoices: counter(1), fetchImpl: impl });
  } finally {
    AbortSignal.timeout = realTimeout;
  }
  assert.deepEqual(asked, [5000, 5000]);
});
