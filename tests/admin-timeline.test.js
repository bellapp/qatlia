const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// « Dernières activités » on the client page (spec 2026-11-25): one list,
// newest first, built from what the page already loads.

const { buildClientTimeline } = loadTsModule('src/lib/admin/timeline.ts');

const ledgerRow = (over) => ({
  id: 'l1',
  type: 'usage',
  amount: -1,
  balance_after: 9,
  description: null,
  reason: 'vision',
  stripe_payment_id: null,
  created_at: '2026-11-10T10:00:00Z',
  ...over,
});

const project = (over) => ({
  id: 'p1',
  name: 'Cuisine',
  material: 'mdf',
  sheetWidth: 280,
  sheetHeight: 207,
  createdAt: '2026-11-10T10:05:00Z',
  pieceCount: 12,
  sheetsUsed: 2,
  wastePercentage: 14.2,
  scanThumb: null,
  scanThumbs: [],
  pdfGeneratedAt: null,
  hasQuotation: false,
  ...over,
});

const empty = { identity: { signedUpAt: null, lastSignInAt: null }, ledger: [], orders: [], projects: [], audit: [] };

test('les sources sont mêlées, du plus récent au plus ancien', () => {
  const events = buildClientTimeline({
    identity: { signedUpAt: '2026-11-01T08:00:00Z', lastSignInAt: '2026-11-20T09:00:00Z' },
    ledger: [ledgerRow({})],
    orders: [],
    projects: [project({})],
    audit: [{ action: 'note_updated', details: { fields: ['phone'] }, createdAt: '2026-11-15T12:00:00Z', adminId: 'x' }],
  });
  assert.deepEqual(
    events.map((e) => e.kind),
    ['last_sign_in', 'admin', 'project', 'ledger', 'signup']
  );
  assert.equal(events[3].label, 'Analyse photo');
  assert.equal(events[3].amount, -1);
});

test('un plan calculé pointe vers sa page, son PDF est un événement à part', () => {
  const events = buildClientTimeline({ ...empty, projects: [project({ pdfGeneratedAt: '2026-11-11T09:00:00Z' })] });
  assert.deepEqual(
    events.map((e) => [e.kind, e.projectId]),
    [
      ['pdf', 'p1'],
      ['project', 'p1'],
    ]
  );
  assert.match(events[1].detail, /12 pièces · 2 panneaux · chute 14\.2 %/);
});

test('une commande décidée donne deux événements', () => {
  const events = buildClientTimeline({
    ...empty,
    orders: [
      {
        order_number: 'QT-ABC',
        pack_id: 'standard',
        amount_mad: 199,
        credits: 60,
        status: 'granted',
        method: 'cih',
        payment_reference: null,
        operator_note: null,
        created_at: '2026-11-05T10:00:00Z',
        decided_at: '2026-11-05T12:00:00Z',
      },
    ],
  });
  assert.deepEqual(
    events.map((e) => e.kind),
    ['order_decided', 'order_created']
  );
  assert.match(events[0].label, /Crédits ajoutés/);
});

test('la liste est plafonnée et ignore les dates illisibles', () => {
  const ledger = Array.from({ length: 150 }, (_, i) =>
    ledgerRow({ id: `l${i}`, created_at: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString() })
  );
  ledger.push(ledgerRow({ id: 'bad', created_at: 'pas une date' }));
  const events = buildClientTimeline({ ...empty, ledger }, 100);
  assert.equal(events.length, 100);
  assert.ok(events.every((e) => !Number.isNaN(Date.parse(e.at))));
  assert.equal(events[0].at, ledger[149].created_at);
});

test('sans rien : liste vide', () => {
  assert.deepEqual(buildClientTimeline(empty), []);
});
