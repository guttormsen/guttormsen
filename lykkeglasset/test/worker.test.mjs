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
import { dagsnokkel, flyttDag, klokke, minutter, norskUkedag } from '../src/dato.js';

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
    // Testene under kjører i personvernmodus, der hun styrer hva som deles.
    // Delt modus har sine egne tester nederst.
    DELT_MODUS: 'nei',
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

test('Lykke kan ikke legge inn brev til seg selv', async () => {
  const cookie = await loggInn('lykke');
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

test('deler hun dagen, kommer også det tunge fram', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', {
    metode: 'POST', cookie: hennes, kropp: { humor: 2, tungt: 'krangel på jobb' },
  });
  assert.ok(alleMeldinger().includes('krangel på jobb'));

  const hans = await loggInn('mathias');
  const t = await (await kall('/tilstand', { cookie: hans })).json();
  assert.equal(t.idag.tungt, 'krangel på jobb');
});

/* ---------- varsling ---------- */

test('en helt vanlig dag går fram uten lyd, med alt hun skrev', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 4, gode_ting: [{ tekst: 'sol' }] } });
  assert.equal(sendte.length, 1);
  assert.equal(sendte[0].disable_notification, true);
  assert.ok(sendte[0].text.includes('sol'));
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
  const førsteRunde = sendte.length;
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { ...dag, gode_ting: [{ tekst: 'kaffe og sol' }] } });
  assert.equal(sendte.length, førsteRunde, 'samme dag skal bare varsle én gang');
});

test('dager langt tilbake kan ikke føres', async () => {
  const hennes = await loggInn('lykke');
  const svar = await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { dato: '2020-01-01', humor: 3 } });
  assert.equal(svar.status, 400);
});

/* ---------- den andre veien ---------- */

test('brev går fra ham til henne, og røpes ikke før hun åpner det', async () => {
  const hans = await loggInn('mathias');
  await kall('/brev', { metode: 'POST', cookie: hans, kropp: { tekst: 'Til en tung dag.' } });

  const hennes = await loggInn('lykke');
  const t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.equal(t.brev.length, 1);
  assert.equal(t.brev[0].tekst, undefined);

  const brev = await (await kall(`/brev/${t.brev[0].id}/apne`, { metode: 'POST', cookie: hennes })).json();
  assert.equal(brev.tekst, 'Til en tung dag.');
  assert.ok(alleMeldinger().includes('åpnet brevet'));
});

/* ---------- meldinger begge veier ---------- */

test('meldinger går begge veier, og hennes plinger hos ham', async () => {
  const hans = await loggInn('mathias');
  await kall('/melding', { metode: 'POST', cookie: hans, kropp: { tekst: 'God morgen.' } });
  assert.deepEqual(sendte, [], 'hans egne meldinger skal ikke varsle ham selv');

  const hennes = await loggInn('lykke');
  await kall('/melding', { metode: 'POST', cookie: hennes, kropp: { tekst: 'Er på vei hjem.' } });
  assert.equal(sendte.length, 1);
  assert.ok(sendte[0].text.includes('Er på vei hjem.'));

  const t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.deepEqual(t.meldinger.map((m) => [m.fra, m.tekst]), [
    ['mathias', 'God morgen.'],
    ['lykke', 'Er på vei hjem.'],
  ], 'eldste først, så samtalen leses ovenfra og ned');
});

test('tomme meldinger avvises', async () => {
  const cookie = await loggInn('lykke');
  assert.equal((await kall('/melding', { metode: 'POST', cookie, kropp: { tekst: '   ' } })).status, 400);
});

test('«lest» gjelder bare den andres meldinger', async () => {
  const hans = await loggInn('mathias');
  await kall('/melding', { metode: 'POST', cookie: hans, kropp: { tekst: 'fra ham' } });
  const hennes = await loggInn('lykke');
  await kall('/melding', { metode: 'POST', cookie: hennes, kropp: { tekst: 'fra henne' } });

  await kall('/meldinger/lest', { metode: 'POST', cookie: hennes });
  const t = await (await kall('/tilstand', { cookie: hennes })).json();
  const lest = Object.fromEntries(t.meldinger.map((m) => [m.fra, Boolean(m.lest_kl)]));
  assert.equal(lest.mathias, true);
  assert.equal(lest.lykke, false, 'hennes egne skal ikke merkes lest av henne selv');
});

/* ---------- ønskelista ---------- */

test('begge kan legge til ønsker, og huke dem av og på igjen', async () => {
  const hans = await loggInn('mathias');
  await kall('/onske', { metode: 'POST', cookie: hans, kropp: { tekst: 'Bade i Nordsjøen' } });
  const hennes = await loggInn('lykke');
  await kall('/onske', { metode: 'POST', cookie: hennes, kropp: { tekst: 'Kino på en tirsdag' } });

  let t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.equal(t.onsker.length, 2);
  const id = t.onsker.find((o) => o.tekst === 'Bade i Nordsjøen').id;

  await kall(`/onske/${id}/gjort`, { metode: 'POST', cookie: hennes });
  t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.equal(t.onsker.find((o) => o.id === id).gjort_av, 'lykke');

  await kall(`/onske/${id}/gjort`, { metode: 'POST', cookie: hennes });
  t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.equal(t.onsker.find((o) => o.id === id).gjort_kl, null, 'skal kunne angres');
});

test('gjorte ønsker havner nederst', async () => {
  const cookie = await loggInn('lykke');
  await kall('/onske', { metode: 'POST', cookie, kropp: { tekst: 'først' } });
  await kall('/onske', { metode: 'POST', cookie, kropp: { tekst: 'sist' } });
  let t = await (await kall('/tilstand', { cookie })).json();
  const id = t.onsker.find((o) => o.tekst === 'sist').id;
  await kall(`/onske/${id}/gjort`, { metode: 'POST', cookie });
  t = await (await kall('/tilstand', { cookie })).json();
  assert.equal(t.onsker.at(-1).tekst, 'sist');
});

test('ønsker kan slettes', async () => {
  const cookie = await loggInn('lykke');
  await kall('/onske', { metode: 'POST', cookie, kropp: { tekst: 'feiltrykk' } });
  const t = await (await kall('/tilstand', { cookie })).json();
  await kall(`/onske/${t.onsker[0].id}`, { metode: 'DELETE', cookie });
  const etter = await (await kall('/tilstand', { cookie })).json();
  assert.equal(etter.onsker.length, 0);
});

/* ---------- arkivet ---------- */

test('arkivet søker, og han ser bare det hun har delt', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', {
    metode: 'POST',
    cookie: hennes,
    kropp: { humor: 4, gode_ting: [{ tekst: 'bålkaffe ved vannet' }, { tekst: 'du ringte', om_oss: true }] },
  });
  await kall('/dag', {
    metode: 'POST',
    cookie: hennes,
    kropp: { dato: flyttDag(dagsnokkel(new Date(), 'Europe/Oslo'), -1), humor: 3, gode_ting: [{ tekst: 'hemmelig kaffe' }], privat: true },
  });

  const hennesTreff = await (await kall('/arkiv?sok=kaffe', { cookie: hennes })).json();
  assert.equal(hennesTreff.antall, 2);

  const oss = await (await kall('/arkiv?oss=ja', { cookie: hennes })).json();
  assert.deepEqual(oss.treff.map((t) => t.tekst), ['du ringte']);

  const hans = await loggInn('mathias');
  const hansTreff = await (await kall('/arkiv?sok=kaffe', { cookie: hans })).json();
  assert.deepEqual(hansTreff.treff.map((t) => t.tekst), ['bålkaffe ved vannet'],
    'det hun holdt tilbake skal ikke være søkbart for ham');
});

/* ---------- ukesbildet ---------- */

test('uka teller bare dager hun har delt', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: idag, humor: 4 } });
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -1), humor: 2 } });
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -2), humor: 1, privat: true } });

  const t = await (await kall('/tilstand', { cookie })).json();
  assert.equal(t.uke.ført, 2);
  assert.equal(t.uke.tunge, 1);
  assert.equal(t.uke.gode, 1);
  assert.equal(t.uke.snitt, 3);
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

/* ---------- én dag om gangen, for kalenderen ---------- */

test('en enkelt dag kan hentes, og han får den gjennom filteret', async () => {
  const hennes = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', {
    metode: 'POST',
    cookie: hennes,
    kropp: { dato: idag, humor: 2, tungt: 'noe privat', privat: true },
  });

  const hennesDag = await (await kall(`/dag?dato=${idag}`, { cookie: hennes })).json();
  assert.equal(hennesDag.dag.tungt, 'noe privat');

  const hans = await loggInn('mathias');
  const hansDag = await (await kall(`/dag?dato=${idag}`, { cookie: hans })).json();
  assert.equal(hansDag.dag.privat, true);
  assert.equal(hansDag.dag.tungt, undefined, 'en privat dag har ikke noe innhold for ham');
});

test('ugyldig dato avvises', async () => {
  const cookie = await loggInn('lykke');
  assert.equal((await kall('/dag?dato=i-morgen', { cookie })).status, 400);
});

/* ---------- delt modus ---------- */

test('delt modus varsler hver dag, også de helt vanlige', async () => {
  env.DELT_MODUS = 'ja';
  const cookie = await loggInn('lykke');
  sendte.length = 0;
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 3, gode_ting: [{ tekst: 'grei kaffe' }] } });

  const dagsvarsel = sendte.filter((m) => m.text.includes('førte dagen'));
  assert.equal(dagsvarsel.length, 1);
  assert.equal(dagsvarsel[0].disable_notification, true, 'hverdagen skal ikke pipe');
  assert.ok(dagsvarsel[0].text.includes('grei kaffe'));
});

test('delt modus sender det hun skrev, og ber ikke om lov', async () => {
  env.DELT_MODUS = 'ja';
  const cookie = await loggInn('lykke');
  sendte.length = 0;
  await kall('/dag', {
    metode: 'POST',
    cookie,
    // Selv om klienten skulle sende valgene, finnes de ikke i denne modusen.
    kropp: { humor: 2, tungt: 'sliten av alt', del_tungt: false, privat: true },
  });
  assert.ok(alleMeldinger().includes('sliten av alt'));

  const hans = await loggInn('mathias');
  const t = await (await kall('/tilstand', { cookie: hans })).json();
  assert.equal(t.delt, true);
  assert.equal(t.idag.privat, false, 'privat-valget finnes ikke i delt modus');
  assert.equal(t.idag.tungt, 'sliten av alt');
});

test('delt modus sier fra når hun er inne, høyst én gang i timen', async () => {
  env.DELT_MODUS = 'ja';
  const cookie = await loggInn('lykke');
  sendte.length = 0;
  await kall('/tilstand', { cookie });
  await kall('/tilstand', { cookie });
  await kall('/tilstand', { cookie });
  const aktiv = sendte.filter((m) => m.text.includes('inne i appen'));
  assert.equal(aktiv.length, 1);
  assert.equal(aktiv[0].disable_notification, true);
});

test('at han åpner appen, varsler ingen', async () => {
  env.DELT_MODUS = 'ja';
  const cookie = await loggInn('mathias');
  sendte.length = 0;
  await kall('/tilstand', { cookie });
  assert.deepEqual(sendte, []);
});

test('delt modus gjør alt søkbart for ham', async () => {
  env.DELT_MODUS = 'ja';
  const hennes = await loggInn('lykke');
  await kall('/dag', {
    metode: 'POST',
    cookie: hennes,
    kropp: { humor: 3, gode_ting: [{ tekst: 'stille morgen' }], privat: true },
  });
  const hans = await loggInn('mathias');
  const treff = await (await kall('/arkiv?sok=stille', { cookie: hans })).json();
  assert.deepEqual(treff.treff.map((t) => t.tekst), ['stille morgen']);
});

test('«ring meg» går fortsatt med lyd i delt modus', async () => {
  env.DELT_MODUS = 'ja';
  const cookie = await loggInn('lykke');
  sendte.length = 0;
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4, behov: 'ringe' } });
  const rop = sendte.filter((m) => m.text.includes('trenger deg nå'));
  assert.equal(rop.length, 1);
  assert.equal(rop[0].disable_notification, false);
});

/* ---------- Telegram inn ---------- */

const HEM = 'webhook-hemmelighet';
const EIER = 4242;

const oppdatering = (kropp, hemmelig = HEM) =>
  worker.fetch(new Request('https://test.local/api/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': hemmelig },
    body: JSON.stringify(kropp),
  }), env, ctx);

const fraEier = (tekst, ekstra = {}) => oppdatering({
  message: { from: { id: EIER }, chat: { id: -1, type: 'group' }, text: tekst, ...ekstra },
});

const blirEier = () => fraEier(`/eier ${env.KODE_MATHIAS}`);

const meldingene = async () => {
  const cookie = await loggInn('lykke');
  const t = await (await kall('/tilstand', { cookie })).json();
  return t.meldinger;
};

test('webhooken avviser alle som ikke kan hemmeligheten', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  assert.equal((await oppdatering({ message: { from: { id: 1 }, text: 'hei' } }, 'gjett')).status, 401);
  // Uten hemmelighet satt skal ingenting slippe inn, uansett hva som sendes.
  env.TELEGRAM_WEBHOOK_HEMMELIG = '';
  assert.equal((await oppdatering({ message: { from: { id: 1 }, text: 'hei' } }, '')).status, 401);
});

test('den første som sier koden blir eier, og bare han blir hørt på', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await oppdatering({ message: { from: { id: 99 }, chat: { id: -1, type: 'group' }, text: '/eier feil' } });
  assert.equal(await (await kall('/meg')).json().then(() => 0), 0);

  await blirEier();
  await fraEier('/si hei fra meg');
  let m = await meldingene();
  assert.deepEqual(m.map((x) => [x.fra, x.tekst]), [['mathias', 'hei fra meg']]);

  // Noen andre i gruppa skal ikke kunne skrive i appen hennes.
  await oppdatering({ message: { from: { id: 777 }, chat: { id: -1, type: 'group' }, text: '/si tull' } });
  m = await meldingene();
  assert.equal(m.length, 1);
});

test('feil kode gjør ingen til eier', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await oppdatering({ message: { from: { id: 99 }, chat: { id: -1, type: 'group' }, text: '/eier nesten' } });
  await oppdatering({ message: { from: { id: 99 }, chat: { id: -1, type: 'group' }, text: '/si slipp meg inn' } });
  assert.deepEqual(await meldingene(), []);
});

test('et knappetrykk blir til en melding i appen', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  await oppdatering({
    callback_query: {
      id: 'c1', from: { id: EIER }, data: 'svar:ringer',
      message: { message_id: 7, chat: { id: -1 } },
    },
  });
  const m = await meldingene();
  assert.deepEqual(m.map((x) => [x.fra, x.tekst]), [['mathias', 'Jeg ringer deg nå.']]);
});

test('vanlig prat i gruppa havner ikke i appen', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  await fraEier('husker du melka');
  assert.deepEqual(await meldingene(), []);

  // Men et svar på det boten har sagt, er ment hit.
  await fraEier('ja, jeg kommer', { reply_to_message: { from: { is_bot: true } } });
  assert.deepEqual((await meldingene()).map((x) => x.tekst), ['ja, jeg kommer']);
});

test('i en samtale med boten alene er alt ment til henne', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  await oppdatering({
    message: { from: { id: EIER }, chat: { id: EIER, type: 'private' }, text: 'er straks hjemme' },
  });
  assert.deepEqual((await meldingene()).map((x) => x.tekst), ['er straks hjemme']);
});

test('engangslenka logger ham inn, og virker bare én gang', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await fraEier('/logginn');

  const lenke = sendte.map((m) => m.text).join('\n').match(/\/api\/lenke\?t=([\w.\-]+)/);
  assert.ok(lenke, 'skulle fått en lenke');

  const svar = await kall(`/lenke?t=${lenke[1]}`);
  assert.equal(svar.status, 302);
  const cookie = svar.headers.get('Set-Cookie').split(';')[0];
  const meg = await (await kall('/meg', { cookie })).json();
  assert.equal(meg.hvem, 'mathias');

  assert.equal((await kall(`/lenke?t=${lenke[1]}`)).status, 401, 'lenka skal være brukt opp');
});

test('en oppdiktet lenke slipper ingen inn', async () => {
  assert.equal((await kall('/lenke?t=mathias.9999999999999.xxx')).status, 401);
});

/* ---------- morgenpuffen ---------- */

test('var i går tung, kommer puffet om morgenen – med knapper', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', {
    metode: 'POST', cookie,
    kropp: { dato: flyttDag(idag, -1), humor: 2, behov: 'klem', tungt: 'alt var mye' },
  });
  sendte.length = 0;

  await worker.scheduled({ scheduledTime: iDagKl('08:10') }, env, ctx);
  assert.equal(sendte.length, 1);
  assert.ok(sendte[0].text.includes('I går var tung'));
  assert.ok(sendte[0].text.includes('en klem'));
  assert.ok(sendte[0].reply_markup?.inline_keyboard?.length, 'skal ha svarknapper');

  await worker.scheduled({ scheduledTime: iDagKl('08:10') }, env, ctx);
  assert.equal(sendte.length, 1, 'bare én gang');
});

test('en grei gårsdag gir ingen morgenpuff', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -1), humor: 4 } });
  sendte.length = 0;
  await worker.scheduled({ scheduledTime: iDagKl('08:10') }, env, ctx);
  assert.deepEqual(sendte, []);
});

test('en privat gårsdag puffer ingen', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -1), humor: 1, privat: true } });
  sendte.length = 0;
  await worker.scheduled({ scheduledTime: iDagKl('08:10') }, env, ctx);
  assert.deepEqual(sendte, []);
});

/* ---------- søndagsbrevet ---------- */

/** Siste søndag som har vært – dager fram i tid kan ikke føres. */
function sondagKl(hhmm) {
  for (let i = 0; i < 8; i += 1) {
    const t = iDagKl(hhmm) - i * 86400000;
    const d = new Date(t);
    if (norskUkedag(dagsnokkel(d, 'Europe/Oslo')) === 'søndag' && klokke(d, 'Europe/Oslo') === hhmm) return t;
  }
  throw new Error('fant ingen søndag');
}

test('søndag kveld kommer uka samlet', async () => {
  const cookie = await loggInn('lykke');
  const sondag = dagsnokkel(new Date(sondagKl('20:10')), 'Europe/Oslo');
  for (const [tilbake, humor] of [[0, 4], [1, 2], [2, 5]]) {
    await kall('/dag', {
      metode: 'POST', cookie,
      kropp: { dato: flyttDag(sondag, -tilbake), humor, gode_ting: [{ tekst: 'noe fint' }] },
    });
  }
  sendte.length = 0;

  await worker.scheduled({ scheduledTime: sondagKl('20:10') }, env, ctx);
  const brev = sendte.filter((m) => m.text.includes('Uka hos Lykke'));
  assert.equal(brev.length, 1);
  assert.ok(brev[0].text.includes('3 dager ført'));
  assert.equal(brev[0].disable_notification, true);
});

test('en uke uten noe ført gir ikke noe brev', async () => {
  sendte.length = 0;
  await worker.scheduled({ scheduledTime: sondagKl('20:10') }, env, ctx);
  assert.deepEqual(sendte.filter((m) => m.text.includes('Uka hos Lykke')), []);
});

/* ---------- årsboka ---------- */

test('årsboka samler året måned for måned', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', {
    metode: 'POST', cookie,
    kropp: { humor: 4, gode_ting: [{ tekst: 'sol på trappa' }, { tekst: 'du kom innom', om_oss: true }] },
  });

  const bok = await (await kall(`/aarsbok?ar=${idag.slice(0, 4)}`, { cookie })).json();
  assert.equal(bok.antall, 2);
  assert.equal(bok.dager, 1);
  assert.equal(bok.maneder.length, 1);
  assert.deepEqual(bok.maneder[0].ting.map((t) => t.tekst), ['sol på trappa', 'du kom innom']);
});

test('årsboka hans har ikke med de private dagene', async () => {
  const hennes = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', {
    metode: 'POST', cookie: hennes,
    kropp: { humor: 3, gode_ting: [{ tekst: 'bare mitt' }], privat: true },
  });
  const hans = await loggInn('mathias');
  const bok = await (await kall(`/aarsbok?ar=${idag.slice(0, 4)}`, { cookie: hans })).json();
  assert.equal(bok.antall, 0);
});

/* ---------- koder som kan byttes ---------- */

test('hun kan bytte sin egen kode, og den gamle slutter å virke', async () => {
  const cookie = await loggInn('lykke');
  assert.equal((await kall('/kode', {
    metode: 'POST', cookie, kropp: { hvem: 'lykke', kode: 'nytt-passord' },
  })).status, 200);

  assert.equal((await kall('/logg-inn', {
    metode: 'POST', kropp: { hvem: 'lykke', kode: 'lykke-kode' },
  })).status, 401, 'den gamle koden skal være død');

  assert.equal((await kall('/logg-inn', {
    metode: 'POST', kropp: { hvem: 'lykke', kode: 'nytt-passord' },
  })).status, 200);
});

test('Mathias kan sette en ny kode for henne – og hun får vite det', async () => {
  const hans = await loggInn('mathias');
  await kall('/kode', { metode: 'POST', cookie: hans, kropp: { hvem: 'lykke', kode: 'ny-kode-til-lykke' } });

  const nyInn = await kall('/logg-inn', { metode: 'POST', kropp: { hvem: 'lykke', kode: 'ny-kode-til-lykke' } });
  assert.equal(nyInn.status, 200);

  const cookie = nyInn.headers.get('Set-Cookie').split(';')[0];
  const t = await (await kall('/tilstand', { cookie })).json();
  assert.ok(t.meldinger.some((m) => m.tekst.includes('ny kode')), 'hun skal se at det skjedde');
});

test('hun kan ikke sette hans kode', async () => {
  const cookie = await loggInn('lykke');
  assert.equal((await kall('/kode', {
    metode: 'POST', cookie, kropp: { hvem: 'mathias', kode: 'jeg-tar-over' },
  })).status, 403);
});

test('for korte koder avvises', async () => {
  const cookie = await loggInn('lykke');
  assert.equal((await kall('/kode', { metode: 'POST', cookie, kropp: { hvem: 'lykke', kode: '1234' } })).status, 400);
  // …og den gamle virker fortsatt.
  assert.equal((await kall('/logg-inn', { metode: 'POST', kropp: { hvem: 'lykke', kode: 'lykke-kode' } })).status, 200);
});

test('koden ligger ikke i klartekst i databasen', async () => {
  const cookie = await loggInn('lykke');
  await kall('/kode', { metode: 'POST', cookie, kropp: { hvem: 'lykke', kode: 'hemmelig-kode' } });
  const rad = db.prepare("SELECT verdi FROM oppsett WHERE nokkel = 'kode_lykke'").get();
  assert.ok(rad.verdi.startsWith('pbkdf2$'));
  assert.ok(!rad.verdi.includes('hemmelig-kode'));
});

/* ---------- botens kommandoer ---------- */

const sisteSvar = () => sendte.at(-1)?.text ?? '';

test('/hjelp viser hva boten kan', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await fraEier('/hjelp');
  for (const k of ['/idag', '/uke', '/status', '/glasset', '/si', '/brev', '/onske', '/logginn', '/kode']) {
    assert.ok(sisteSvar().includes(k), `mangler ${k}`);
  }
});

test('/idag forteller om dagen, og respekterer at den er privat', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  const cookie = await loggInn('lykke');

  sendte.length = 0;
  await fraEier('/idag');
  assert.ok(sisteSvar().includes('Ingenting ført'));

  await kall('/dag', {
    metode: 'POST', cookie,
    kropp: { humor: 4, behov: 'klem', gode_ting: [{ tekst: 'bålkaffe' }] },
  });
  sendte.length = 0;
  await fraEier('/idag');
  assert.ok(sisteSvar().includes('bålkaffe'));
  assert.ok(sisteSvar().includes('en klem'));

  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4, gode_ting: [{ tekst: 'bålkaffe' }], privat: true } });
  sendte.length = 0;
  await fraEier('/idag');
  assert.ok(sisteSvar().includes('holdt for seg selv'));
  assert.ok(!sisteSvar().includes('bålkaffe'), 'en privat dag skal ikke lekke gjennom boten');
});

test('/uke svarer også når det ikke er ført noe', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await fraEier('/uke');
  assert.ok(sisteSvar().includes('Ingen dager ført'));
});

test('/onske legger til, /onsker viser lista', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await fraEier('/onsker');
  assert.ok(sisteSvar().includes('tom'));

  await fraEier('/onske Bade i Nordsjøen');
  await fraEier('/onsker');
  assert.ok(sisteSvar().includes('Bade i Nordsjøen'));

  const cookie = await loggInn('lykke');
  const t = await (await kall('/tilstand', { cookie })).json();
  assert.equal(t.onsker[0].laget_av, 'mathias');
});

test('/brev legger et brev i glasset', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  await fraEier('/brev Det går over.');

  const cookie = await loggInn('lykke');
  const t = await (await kall('/tilstand', { cookie })).json();
  assert.equal(t.brev.length, 1);
  const åpnet = await (await kall(`/brev/${t.brev[0].id}/apne`, { metode: 'POST', cookie })).json();
  assert.equal(åpnet.tekst, 'Det går over.');
});

test('/kode setter ny kode for henne, og hun får vite det', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await fraEier('/kode kort');
  assert.ok(sisteSvar().includes('minst seks'));

  await fraEier('/kode helt-ny-kode');
  const inn = await kall('/logg-inn', { metode: 'POST', kropp: { hvem: 'lykke', kode: 'helt-ny-kode' } });
  assert.equal(inn.status, 200);

  const cookie = inn.headers.get('Set-Cookie').split(';')[0];
  const t = await (await kall('/tilstand', { cookie })).json();
  assert.ok(t.meldinger.some((m) => m.tekst.includes('ny kode')));
});

test('/status sier hvor ting står', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  await fraEier('/brev noe');
  sendte.length = 0;
  await fraEier('/status');
  assert.ok(sisteSvar().includes('Brev som ligger klare: 1'));
  assert.ok(sisteSvar().includes('Sist ført: aldri'));
});

test('kommandoene virker ikke for andre enn eieren', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await oppdatering({
    message: { from: { id: 777 }, chat: { id: -1, type: 'group' }, text: '/kode jeg-tar-over' },
  });
  assert.deepEqual(sendte, []);
  assert.equal((await kall('/logg-inn', {
    metode: 'POST', kropp: { hvem: 'lykke', kode: 'jeg-tar-over' },
  })).status, 401);
});
