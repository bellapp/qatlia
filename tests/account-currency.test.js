const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// One currency per account (user decision, 2026-11-15): dirham in Morocco,
// euro in Europe, dollar elsewhere, assigned from the country on the first
// visit and changeable by the customer. A euro account pays Creem's euro
// products; transfer and cash stay for dirham accounts.

const UUID = '11111111-2222-4333-8444-555555555555';

const USD = {
  starter: 'prod_usd_starter',
  standard: 'prod_usd_standard',
  pro: 'prod_usd_pro',
  atelier_max: 'prod_usd_max',
};
const EUR = {
  starter: 'prod_eur_starter',
  standard: 'prod_eur_standard',
  pro: 'prod_eur_pro',
  atelier_max: 'prod_eur_max',
};

const BASE_ENV = {
  CREEM_API_KEY: 'creem_test_realkey',
  CREEM_PRODUCT_STARTER: USD.starter,
  CREEM_PRODUCT_STANDARD: USD.standard,
  CREEM_PRODUCT_PRO: USD.pro,
  CREEM_PRODUCT_ATELIER_MAX: USD.atelier_max,
  NEXT_PUBLIC_APP_URL: 'https://qatlia.example',
  NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real',
};
const EUR_ENV = {
  CREEM_PRODUCT_STARTER_EUR: EUR.starter,
  CREEM_PRODUCT_STANDARD_EUR: EUR.standard,
  CREEM_PRODUCT_PRO_EUR: EUR.pro,
  CREEM_PRODUCT_ATELIER_MAX_EUR: EUR.atelier_max,
};

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test('the country decides the currency: Morocco dirham, Europe euro, elsewhere dollar', () => {
  const { currencyForCountry } = loadTsModule('src/lib/currency.ts');
  for (const [country, expected] of [
    ['MA', 'MAD'],
    ['FR', 'EUR'],
    ['fr', 'EUR'],
    ['BE', 'EUR'],
    ['ES', 'EUR'],
    ['DE', 'EUR'],
    ['BG', 'EUR'],
    ['CH', 'EUR'],
    ['GB', 'EUR'],
    ['US', 'USD'],
    ['CA', 'USD'],
    ['SA', 'USD'],
    ['DZ', 'USD'],
    [null, 'MAD'],
    ['', 'MAD'],
    ['XYZ', 'MAD'],
  ]) {
    assert.equal(currencyForCountry(country), expected, String(country));
  }
});

test('a saved account currency beats a hand-picked one, which beats the country', () => {
  const { resolveCurrency } = loadTsModule('src/lib/currency.ts');
  assert.equal(resolveCurrency({ saved: 'USD', cookie: 'EUR', country: 'MA' }), 'USD');
  assert.equal(resolveCurrency({ saved: null, cookie: 'EUR', country: 'MA' }), 'EUR');
  assert.equal(resolveCurrency({ saved: 'GBP', cookie: 'nope', country: 'FR' }), 'EUR');
  assert.equal(resolveCurrency({}), 'MAD');
});

test('cards are charged in euros only for a euro account with the euro products', () => {
  const { cardCurrencyFor, offersManualPayment } = loadTsModule('src/lib/currency.ts');
  assert.equal(cardCurrencyFor('EUR', true), 'EUR');
  assert.equal(cardCurrencyFor('EUR', false), 'USD');
  assert.equal(cardCurrencyFor('MAD', true), 'USD');
  assert.equal(cardCurrencyFor('USD', true), 'USD');
  assert.equal(offersManualPayment('MAD'), true);
  assert.equal(offersManualPayment('EUR'), false);
  assert.equal(offersManualPayment('USD'), false);
});

test('pack prices are read from the catalog in the account currency', () => {
  const { CREDIT_PACKS, packPrice, formatPrice } = loadTsModule('src/lib/billing/catalog.ts');
  const starter = CREDIT_PACKS.starter;
  assert.equal(formatPrice(packPrice(starter, 'MAD'), 'MAD'), '50 DH');
  assert.equal(formatPrice(packPrice(starter, 'EUR'), 'EUR'), '4,99 €');
  assert.equal(formatPrice(packPrice(starter, 'USD'), 'USD'), '$4.99');
});

test('the euro products are used only when all four are configured', () => {
  const { getCreemConfig, creemProductsFor, creemProductIdsByPack } = loadTsModule('src/lib/billing/config.ts');

  const usdOnly = getCreemConfig(BASE_ENV);
  assert.equal(usdOnly.productsEUR, null);
  assert.deepEqual(creemProductsFor(usdOnly, 'EUR'), USD, 'no euro products: the dollar ones are sold');

  const partial = getCreemConfig({ ...BASE_ENV, CREEM_PRODUCT_STARTER_EUR: EUR.starter });
  assert.equal(partial.productsEUR, null, 'some euro packs only would strand the others');

  const both = getCreemConfig({ ...BASE_ENV, ...EUR_ENV });
  assert.deepEqual(both.productsEUR, EUR);
  assert.deepEqual(creemProductsFor(both, 'EUR'), EUR);
  assert.deepEqual(creemProductsFor(both, 'USD'), USD);
  assert.deepEqual(creemProductIdsByPack(both).pro, [USD.pro, EUR.pro]);
  assert.deepEqual(creemProductIdsByPack(usdOnly).pro, [USD.pro]);
});

test('a paid euro order credits its pack and records the euro amount', () => {
  const { resolveCreemGrant } = loadTsModule('src/lib/billing/creem.ts');
  const { getCreemConfig, creemProductIdsByPack } = loadTsModule('src/lib/billing/config.ts');
  const products = creemProductIdsByPack(getCreemConfig({ ...BASE_ENV, ...EUR_ENV }));

  const event = {
    eventType: 'checkout.completed',
    object: {
      product: { id: EUR.standard },
      metadata: { userId: UUID, packId: 'standard' },
      order: { status: 'paid', type: 'onetime', transaction: 'tran_eur_1', amount_paid: 999, currency: 'EUR' },
    },
  };
  const resolved = resolveCreemGrant(event, products);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.grant.packId, 'standard');
  assert.equal(resolved.grant.credits, 80);
  assert.equal(resolved.grant.amountPaid, 9.99);
  assert.equal(resolved.grant.currency, 'EUR');
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

let fake;
const auth = { user: null };
const fetchCalls = [];

stubModule('@/lib/supabase/server', {
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: auth.user }, error: null }) } }),
});
stubModule('@supabase/supabase-js', { createClient: () => fake.client });

function reset({ user = { id: UUID, email: 'artisan@example.com' }, profile = { currency: 'MAD' } } = {}) {
  fake = createFakeSupabase();
  fake.state.tables.profiles = profile;
  auth.user = user;
  fetchCalls.length = 0;
}

async function withEnv(env, fn) {
  const keys = [...new Set([...Object.keys(BASE_ENV), ...Object.keys(EUR_ENV), 'NODE_ENV', 'STRIPE_SECRET_KEY'])];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const savedFetch = global.fetch;
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, env);
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ checkout_url: 'https://creem.io/test/checkout/x' }), { status: 200 });
  };
  try {
    return await fn();
  } finally {
    global.fetch = savedFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const json = (url, body, headers = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function checkoutProduct(headers) {
  const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
  const res = await POST(json('https://qatlia.example/api/credits/checkout', { packId: 'starter' }, headers));
  assert.equal(res.status, 200);
  return JSON.parse(fetchCalls[0].init.body).product_id;
}

test('a euro account is sent to the euro product, every other account to the dollar one', async () => {
  reset({ profile: { currency: 'EUR' } });
  assert.equal(await withEnv({ ...BASE_ENV, ...EUR_ENV }, () => checkoutProduct()), EUR.starter);

  reset({ profile: { currency: 'EUR' } });
  assert.equal(await withEnv(BASE_ENV, () => checkoutProduct()), USD.starter, 'no euro products yet: dollar price');

  reset({ profile: { currency: 'MAD' } });
  assert.equal(await withEnv({ ...BASE_ENV, ...EUR_ENV }, () => checkoutProduct()), USD.starter);

  reset({ profile: { currency: 'USD' } });
  assert.equal(await withEnv({ ...BASE_ENV, ...EUR_ENV }, () => checkoutProduct()), USD.starter);
});

test('the account currency is read from the profile, never from the request body', async () => {
  reset({ profile: { currency: 'MAD' } });
  const product = await withEnv({ ...BASE_ENV, ...EUR_ENV }, async () => {
    const { POST } = loadTsModule('src/app/api/credits/checkout/route.ts');
    await POST(json('https://qatlia.example/api/credits/checkout', { packId: 'starter', currency: 'EUR' }, { cookie: 'qatlia-currency=EUR' }));
    return JSON.parse(fetchCalls[0].init.body).product_id;
  });
  assert.equal(product, USD.starter);
});

test('an account without a currency gets its country one, saved once', async () => {
  reset({ profile: { currency: null } });
  const product = await withEnv({ ...BASE_ENV, ...EUR_ENV }, () => checkoutProduct({ 'x-vercel-ip-country': 'FR' }));
  assert.equal(product, EUR.starter);

  const [[saved]] = fake.ops('profiles', 'update');
  assert.deepEqual(saved, { currency: 'EUR' });
  const update = fake.state.fromCalls.find((c) => c.table === 'profiles' && c.ops.some(([op]) => op === 'update'));
  assert.deepEqual(
    update.ops.filter(([op]) => op === 'eq' || op === 'is').map(([op, args]) => [op, ...args]),
    [['eq', 'id', UUID], ['is', 'currency', null]],
    'only an empty currency is filled, and only on this account'
  );
});

test('a database without the currency column prices by country and saves nothing', async () => {
  reset();
  fake.state.tableErrors.profiles = { message: 'column profiles.currency does not exist' };
  const product = await withEnv({ ...BASE_ENV, ...EUR_ENV }, () => checkoutProduct({ 'x-vercel-ip-country': 'DE' }));
  assert.equal(product, EUR.starter);
  assert.equal(fake.ops('profiles', 'update').length, 0);
});

test('transfer and cash are refused to an account that is not in dirhams', async () => {
  reset({ profile: { currency: 'EUR' } });
  fake.state.tables.manual_payments = null;
  const res = await withEnv(BASE_ENV, async () => {
    const { POST } = loadTsModule('src/app/api/credits/manual/route.ts');
    return POST(json('https://qatlia.example/api/credits/manual', { packId: 'starter', method: 'manual' }));
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'MANUAL_PAYMENT_MAD_ONLY');
  assert.equal(fake.ops('manual_payments', 'insert').length, 0);
});

test('the refusal reads in every language', () => {
  const { checkoutErrorKey } = loadTsModule('src/i18n/domain.ts');
  const { translate } = loadTsModule('src/i18n/index.ts');
  const key = checkoutErrorKey('MANUAL_PAYMENT_MAD_ONLY');
  assert.equal(key, 'creditsPage.errors.manualMadOnly');
  for (const locale of ['fr', 'en', 'ar']) assert.notEqual(translate(locale, key), key, locale);
});

test('changing the currency saves it on the account and in a cookie', async () => {
  reset();
  const res = await withEnv(BASE_ENV, async () => {
    const { POST } = loadTsModule('src/app/api/currency/route.ts');
    return POST(json('https://qatlia.example/api/currency', { currency: 'USD' }));
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { currency: 'USD' });
  const [[saved]] = fake.ops('profiles', 'update');
  assert.deepEqual(saved, { currency: 'USD' });
  const call = fake.state.fromCalls.find((c) => c.table === 'profiles');
  assert.deepEqual(call.ops.filter(([op]) => op === 'eq').map(([, args]) => args), [['id', UUID]]);
  assert.match(res.headers.get('set-cookie') || '', /qatlia-currency=USD/);
});

test('a visitor without an account keeps their choice in a cookie only', async () => {
  reset({ user: null });
  const res = await withEnv(BASE_ENV, async () => {
    const { POST } = loadTsModule('src/app/api/currency/route.ts');
    return POST(json('https://qatlia.example/api/currency', { currency: 'EUR' }));
  });
  assert.equal(res.status, 200);
  assert.equal(fake.state.fromCalls.length, 0);
  assert.match(res.headers.get('set-cookie') || '', /qatlia-currency=EUR/);
});

test('an unknown currency is refused', async () => {
  reset();
  for (const body of [{ currency: 'GBP' }, { currency: 'mad' }, {}]) {
    const res = await withEnv(BASE_ENV, async () => {
      const { POST } = loadTsModule('src/app/api/currency/route.ts');
      return POST(json('https://qatlia.example/api/currency', body));
    });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(fake.state.fromCalls.length, 0);
});

test('a visitor is shown the currency of their country, or the one they picked', async () => {
  const { GET } = loadTsModule('src/app/api/currency/route.ts');
  reset({ user: null });
  const get = async (headers) => (await withEnv(BASE_ENV, () => GET(new Request('https://qatlia.example/api/currency', { headers })))).json();
  assert.equal((await get({ 'x-vercel-ip-country': 'US' })).currency, 'USD');
  assert.equal((await get({ 'x-vercel-ip-country': 'MA' })).currency, 'MAD');
  assert.equal((await get({ 'x-vercel-ip-country': 'US', cookie: 'a=1; qatlia-currency=EUR' })).currency, 'EUR');
});
