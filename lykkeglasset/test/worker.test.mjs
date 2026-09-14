/**
 * Kjører hele API-et mot en ekte SQLite-database i minnet.
 *
 * Poenget er ikke å teste Cloudflare, men de påstandene som ellers bare står
 * i README-en: at en privat dag ikke lekker, at fritekst hun ikke har delt
 * aldri når fram, og at en rettelse ikke sender varselet på nytt.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { dagsnokkel, flyttDag, klokke, minutter } from '../src/dato.js';

/* ---------- D1 på ekte SQLite ---------- */

class Setning {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(r.changes) } };
  }
}

let db;
let sendte;
let env;

const ekteFetch = globalThis.fetch;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  sendte = [];
  globalThis.fetch = async (url, valg) => {
    if (String(url).includes('api.telegram.org')) {
      sendte.push(JSON.parse(valg.body));
      return new Response('{"ok":true}', { status: 200 });
    }
    return ekteFetch(url, valg);
  };
  env = {
    DB: { prepare: (sql) => new Setning(db, sql) },
    ASSETS: { fetch: async () => new Response('skall') },
    KODE_LYKKE: 'lykke-kode',
    KODE_MATHIAS: 'mathias-kode',
    SESJON_HEMMELIG: 'test-hemmelighet',
    TELEGRAM_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '-1',
    TIDSSONE: 'Europe/Oslo',
    PAMINNELSE_KL: '21:30',
  };
});

/* ---------- små hjelpere ---------- */

const ctx = { waitUntil: (p) => p };

const kall = (sti, { metode = 'GET', kropp, cookie } = {}) =>
  worker.fetch(new Request(`https://test.local/api${sti}`, {
    method: metode,
    headers: {
      ...(kropp ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      'CF-Connecting-IP': '203.0.113.7',
    },
    body: kropp ? JSON.stringify(kropp) : undefined,
  }), env, ctx);

async function loggInn(hvem) {
  const svar = await kall('/logg-inn', {
    metode: 'POST',
    kropp: { hvem, kode: hvem === 'lykke' ? 'lykke-kode' : 'mathias-kode' },
  });
  assert.equal(svar.status, 200, 'skulle fått logge inn');
  return svar.headers.get('Set-Cookie').split(';')[0];
}

const alleMeldinger = () => sendte.map((s) => s.text).join('\n---\n');

/* ---------- tilgang ---------- */

test('uten innlogging får man ingenting', async () => {
  assert.equal((await kall('/tilstand')).status, 401);
  assert.equal((await kall('/dag', { metode: 'POST', kropp: {} })).status, 401);
  assert.equal((await kall('/glasset')).status, 401);
});

test('feil kode slipper ikke inn', async () => {
  const svar = await kall('/logg-inn', { metode: 'POST', kropp: { hvem: 'lykke', kode: 'feil' } });
  assert.equal(svar.status, 401);
  assert.equal(svar.headers.get('Set-Cookie'), null);
});

test('ukjent bruker slipper ikke inn, uansett kode', async () => {
  const svar = await kall('/logg-inn', { metode: 'POST', kropp: { hvem: 'noen', kode: 'lykke-kode' } });
  assert.equal(svar.status, 401);
});

test('etter ti bomskudd stenges det i en time', async () => {
  for (let i = 0; i < 10; i += 1) {
    await kall('/logg-inn', { metode: 'POST', kropp: { hvem: 'lykke', kode: `gjett-${i}` } });
  }
  const svar = await kall('/logg-inn', { metode: 'POST', kropp: { hvem: 'lykke', kode: 'lykke-kode' } });
  assert.equal(svar.status, 429);
});

test('en vellykket innlogging nullstiller tellingen', async () => {
  for (let i = 0; i < 5; i += 1) {
    await kall('/logg-inn', { metode: 'POST', kropp: { hvem: 'lykke', kode: 'feil' } });
  }
  await loggInn('lykke');
  const rest = db.prepare('SELECT COUNT(*) AS n FROM forsok').get();
  assert.equal(Number(rest.n), 0);
});

test('Mathias kan ikke skrive kveldsrunden hennes', async () => {
  const cookie = await loggInn('mathias');
  const svar = await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 5 } });
  assert.equal(svar.status, 403);
});

test('Lykke kan ikke legge inn hilsener eller brev', async () => {
  const cookie = await loggInn('lykke');
  assert.equal((await kall('/hilsen', { metode: 'POST', cookie, kropp: { tekst: 'hei' } })).status, 403);
  assert.equal((await kall('/brev', { metode: 'POST', cookie, kropp: { tekst: 'hei' } })).status, 403);
});

/* ---------- personvernet, som er hele poenget ---------- */

test('en privat dag sender ingenting og viser ingenting', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', {
    metode: 'POST',
    cookie: hennes,
    kropp: {
      humor: 1,
      behov: 'ringe',
      tungt: 'noe jeg ikke vil dele',
      gode_ting: [{ tekst: 'hemmelig god ting' }],
      privat: true,
    },
  });
  assert.deepEqual(sendte, [], 'ingenting skal ut');

  const hans = await loggInn('mathias');
  const t = await (await kall('/tilstand', { cookie: hans })).json();
  assert.equal(t.idag.privat, true);
  assert.equal(t.idag.humor, undefined);
  assert.ok(!JSON.stringify(t).includes('hemmelig god ting'));
  assert.ok(!JSON.stringify(t).includes('noe jeg ikke vil dele'));
});

test('fritekst hun ikke har delt, når verken Telegram eller Mathias', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', {
    metode: 'POST',
    cookie: hennes,
    kropp: { humor: 2, tungt: 'krangel på jobb', del_tungt: false },
  });

  assert.equal(sendte.length, 1);
  assert.ok(!alleMeldinger().includes('krangel på jobb'));

  const hans = await loggInn('mathias');
  const t = await (await kall('/tilstand', { cookie: hans })).json();
  assert.equal(t.idag.tungt, null);
  assert.equal(t.idag.holdt_tungt, true, 'han skal få vite at noe var tungt, ikke hva');
});

test('deler hun det tunge, kommer det fram', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', {
    metode: 'POST',
    cookie: hennes,
    kropp: { humor: 2, tungt: 'krangel på jobb', del_tungt: true },
  });
  assert.ok(alleMeldinger().includes('krangel på jobb'));
});

/* ---------- varsling ---------- */

test('en helt vanlig dag gir ingen pling', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 4, gode_ting: [{ tekst: 'sol' }] } });
  assert.deepEqual(sendte, []);
});

test('«ring meg» går ut med lyd', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 3, behov: 'ringe' } });
  assert.equal(sendte.length, 1);
  assert.equal(sendte[0].disable_notification, false);
  assert.ok(sendte[0].text.includes('trenger deg nå'));
});

test('å rette dagen sender ikke varselet på nytt', async () => {
  const hennes = await loggInn('lykke');
  const dag = { humor: 2, gode_ting: [{ tekst: 'kaffe' }] };
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: dag });
  assert.equal(sendte.length, 1);
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { ...dag, gode_ting: [{ tekst: 'kaffe og sol' }] } });
  assert.equal(sendte.length, 1, 'samme dag skal bare varsle én gang');
});

test('dager langt tilbake kan ikke føres', async () => {
  const hennes = await loggInn('lykke');
  const svar = await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { dato: '2020-01-01', humor: 3 } });
  assert.equal(svar.status, 400);
});

/* ---------- den andre veien ---------- */

test('hilsener og brev går fra ham til henne', async () => {
  const hans = await loggInn('mathias');
  await kall('/hilsen', { metode: 'POST', cookie: hans, kropp: { tekst: 'God morgen.' } });
  await kall('/brev', { metode: 'POST', cookie: hans, kropp: { tekst: 'Til en tung dag.' } });

  const hennes = await loggInn('lykke');
  const t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.equal(t.hilsen.tekst, 'God morgen.');
  assert.equal(t.brev.length, 1);
  assert.equal(t.brev[0].tekst, undefined, 'brevet skal ikke røpes før hun åpner det');

  const brev = await (await kall(`/brev/${t.brev[0].id}/apne`, { metode: 'POST', cookie: hennes })).json();
  assert.equal(brev.tekst, 'Til en tung dag.');
  assert.ok(alleMeldinger().includes('åpnet brevet'));
});

test('glasset trekker fra det hun har skrevet før', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 4, gode_ting: [{ tekst: 'bålkaffe' }] } });
  const g = await (await kall('/glasset', { cookie: hennes })).json();
  assert.equal(g.tekst, 'bålkaffe');
});

test('tomt glass sier fra i stedet for å krasje', async () => {
  const hennes = await loggInn('lykke');
  const g = await (await kall('/glasset', { cookie: hennes })).json();
  assert.equal(g.tom, true);
});

/* ---------- påminnelsen ---------- */

/**
 * Et tidspunkt i dag, på et gitt norsk klokkeslett. Regnet ut fra nå, ikke
 * spikret til en dato – ellers ville testene sluttet å virke neste uke.
 */
function iDagKl(hhmm) {
  const nå = Date.now();
  const nåMin = minutter(klokke(new Date(nå)));
  return nå + (minutter(hhmm) - nåMin) * 60000;
}

const I_VINDUET = iDagKl('21:35');   // like etter PAMINNELSE_KL
const FØR_VINDUET = iDagKl('19:05'); // godt før

test('står dagen tom når klokka passerer, kommer påminnelsen stille', async () => {
  await worker.scheduled({ scheduledTime: I_VINDUET }, env, ctx);
  assert.equal(sendte.length, 1);
  assert.equal(sendte[0].disable_notification, true);
  assert.ok(sendte[0].text.includes('Kveldsrunden står tom'));
});

test('påminnelsen kommer bare én gang samme kveld', async () => {
  await worker.scheduled({ scheduledTime: I_VINDUET }, env, ctx);
  await worker.scheduled({ scheduledTime: I_VINDUET + 600000 }, env, ctx);
  assert.equal(sendte.length, 1);
});

test('før klokkeslettet skjer ingenting', async () => {
  await worker.scheduled({ scheduledTime: FØR_VINDUET }, env, ctx);
  assert.deepEqual(sendte, []);
});

test('er dagen ført, minnes det ikke på', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 4 } });
  sendte.length = 0;
  await worker.scheduled({ scheduledTime: I_VINDUET }, env, ctx);
  assert.deepEqual(sendte, []);
});

test('har det vært stille i flere dager, sies det fra', async () => {
  const femDagerSiden = flyttDag(dagsnokkel(new Date(), 'Europe/Oslo'), -5);
  db.prepare('INSERT INTO dager (dato, humor, gode_ting, skrevet_kl, endret_kl) VALUES (?, 4, ?, ?, ?)')
    .run(femDagerSiden, '[]', '', '');
  await worker.scheduled({ scheduledTime: I_VINDUET }, env, ctx);
  const tekster = sendte.map((s) => s.text).join('\n');
  assert.ok(tekster.includes('5 dager siden'), tekster);
});
