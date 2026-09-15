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
let endret;
let filer;
let hentedeFiler;
let env;

const ekteFetch = globalThis.fetch;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  sendte = [];
  endret = [];
  filer = [];
  hentedeFiler = [];
  ventende.length = 0;
  globalThis.fetch = async (url, valg) => {
    if (String(url).includes('api.telegram.org')) {
      // Bilder han sender boten hentes i to steg: adressen, og så bytene.
      if (String(url).includes('/file/bot')) {
        return new Response(PIKSEL, { status: 200 });
      }
      if (String(url).includes('getFile')) {
        hentedeFiler.push(JSON.parse(valg.body).file_id);
        return new Response('{"ok":true,"result":{"file_path":"photos/en.jpg"}}', { status: 200 });
      }
      // Filer går som multipart, ikke JSON. De telles for seg.
      if (valg.body instanceof FormData) {
        filer.push({
          metode: String(url).split('/').at(-1),
          tekst: valg.body.get('caption'),
          navn: [...valg.body.keys()],
        });
        return new Response('{"ok":true,"result":{}}', { status: 200 });
      }
      const kropp = JSON.parse(valg.body);
      // Menyen skriver om meldinger i stedet for å sende nye. De to holdes
      // fra hverandre, ellers ville hver telling av «sendte» vært feil.
      if (String(url).includes('editMessageText')) endret.push(kropp);
      else if (String(url).includes('sendMessage')) sendte.push(kropp);
      return new Response('{"ok":true,"result":{}}', { status: 200 });
    }
    return ekteFetch(url, valg);
  };
  // KV i minnet. Nok til å se at rett fil kommer ut igjen.
  const lager = new Map();
  env = {
    DB: {
      prepare: (sql) => new Setning(db, sql),
      // D1 kjører en batch atomisk. Her holder det å kjøre dem i rekkefølge –
      // poenget i testen er at alle fire faktisk blir kjørt.
      batch: async (setninger) => Promise.all(setninger.map((s) => s.run())),
    },
    FILER: {
      put: async (n, v) => { lager.set(n, v); },
      get: async (n) => lager.get(n) ?? null,
      delete: async (n) => { lager.delete(n); },
    },
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
    // Hendelsesvarslene ville ellers blandet seg inn i hver eneste telling.
    // De har sine egne tester.
    AKTIV_VARSEL: 'nei',
  };
});

/* ---------- små hjelpere ---------- */

/**
 * Arbeid som legges i `waitUntil` skjer etter at svaret er sendt. Her samles
 * det opp, og `roligNå()` venter til alt er ferdig – ellers ville en test
 * målt et varsel som ikke var sendt ennå.
 */
const ventende = [];
const ctx = { waitUntil: (p) => { ventende.push(p); return p; } };
const roligNå = async () => {
  while (ventende.length) await ventende.shift().catch(() => {});
};

const kall = async (sti, { metode = 'GET', kropp, cookie } = {}) => {
  const svar = await worker.fetch(new Request(`https://test.local/api${sti}`, {
    method: metode,
    headers: {
      ...(kropp ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      'CF-Connecting-IP': '203.0.113.7',
    },
    body: kropp ? JSON.stringify(kropp) : undefined,
  }), env, ctx);
  await roligNå();
  return svar;
};

async function loggInn(hvem) {
  const svar = await kall('/logg-inn', {
    metode: 'POST',
    kropp: { hvem, kode: hvem === 'lykke' ? 'lykke-kode' : 'mathias-kode' },
  });
  assert.equal(svar.status, 200, 'skulle fått logge inn');
  return svar.headers.get('Set-Cookie').split(';')[0];
}

const alleMeldinger = () => sendte.map((s) => s.text).join('\n---\n');

const kjørKlokka = async (hendelse) => {
  await worker.scheduled(hendelse, env, ctx);
  await roligNå();
};

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
  assert.equal(sendte.filter((m) => m.text.includes('tung dag')).length, 1);

  sendte.length = 0;
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { ...dag, gode_ting: [{ tekst: 'kaffe og sol' }] } });

  // Alarmen går ikke igjen, men endringen loggføres – stille.
  assert.equal(sendte.filter((m) => m.text.includes('tung dag')).length, 0);
  const endring = sendte.filter((m) => m.text.includes('endret'));
  assert.equal(endring.length, 1);
  assert.equal(endring[0].disable_notification, true);
  assert.ok(endring[0].text.includes('kaffe og sol'));

  // Og ikke én gang til for hvert tastetrykk i samme time.
  sendte.length = 0;
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { ...dag, gode_ting: [{ tekst: 'kaffe, sol og en tur' }] } });
  assert.deepEqual(sendte, []);
});

test('dager som ikke har vært, kan ikke føres', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  assert.equal((await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, 1), humor: 3 } })).status, 400);
  assert.equal((await kall('/dag', { metode: 'POST', cookie, kropp: { dato: 'i-fjor', humor: 3 } })).status, 400);
  assert.equal((await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -4000), humor: 3 } })).status, 400);
});

test('gamle dager kan fylles ut, og varsler mildere enn dagens', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  const lengeSiden = flyttDag(idag, -40);
  sendte.length = 0;

  const svar = await kall('/dag', {
    metode: 'POST', cookie,
    kropp: { dato: lengeSiden, humor: 1, behov: 'ringe', gode_ting: [{ tekst: 'husket det nå' }] },
  });
  assert.equal(svar.status, 200);

  // Ingen alarm for en dag som var for seks uker siden.
  assert.equal(sendte.length, 1);
  assert.equal(sendte[0].disable_notification, true);
  assert.ok(sendte[0].text.includes('i etterkant'));
  assert.ok(!alleMeldinger().includes('trenger deg nå'));

  const hentet = await (await kall(`/dag?dato=${lengeSiden}`, { cookie })).json();
  assert.equal(hentet.dag.humor, 1);
});

test('en gammel privat dag sier ingenting i det hele tatt', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  sendte.length = 0;
  await kall('/dag', {
    metode: 'POST', cookie,
    kropp: { dato: flyttDag(idag, -20), humor: 2, privat: true },
  });
  assert.deepEqual(sendte, []);
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
  await kjørKlokka({ scheduledTime: I_VINDUET });
  assert.equal(sendte.length, 1);
  assert.equal(sendte[0].disable_notification, true);
  assert.ok(sendte[0].text.includes('Kveldsrunden står tom'));
});

test('påminnelsen kommer bare én gang samme kveld', async () => {
  await kjørKlokka({ scheduledTime: I_VINDUET });
  await kjørKlokka({ scheduledTime: I_VINDUET + 600000 });
  assert.equal(sendte.length, 1);
});

test('før klokkeslettet skjer ingenting', async () => {
  await kjørKlokka({ scheduledTime: FØR_VINDUET });
  assert.deepEqual(sendte, []);
});

test('er dagen ført, minnes det ikke på', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 4 } });
  sendte.length = 0;
  await kjørKlokka({ scheduledTime: I_VINDUET });
  assert.deepEqual(sendte, []);
});

test('har det vært stille i flere dager, sies det fra', async () => {
  const femDagerSiden = flyttDag(dagsnokkel(new Date(), 'Europe/Oslo'), -5);
  db.prepare('INSERT INTO dager (dato, humor, gode_ting, skrevet_kl, endret_kl) VALUES (?, 4, ?, ?, ?)')
    .run(femDagerSiden, '[]', '', '');
  await kjørKlokka({ scheduledTime: I_VINDUET });
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

const oppdatering = async (kropp, hemmelig = HEM) => {
  const svar = await worker.fetch(new Request('https://test.local/api/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': hemmelig },
    body: JSON.stringify(kropp),
  }), env, ctx);
  await roligNå();
  return svar;
};

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

  await kjørKlokka({ scheduledTime: iDagKl('08:10') });
  assert.equal(sendte.length, 1);
  assert.ok(sendte[0].text.includes('I går var tung'));
  assert.ok(sendte[0].text.includes('en klem'));
  assert.ok(sendte[0].reply_markup?.inline_keyboard?.length, 'skal ha svarknapper');

  await kjørKlokka({ scheduledTime: iDagKl('08:10') });
  assert.equal(sendte.length, 1, 'bare én gang');
});

test('en grei gårsdag gir ingen morgenpuff', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -1), humor: 4 } });
  sendte.length = 0;
  await kjørKlokka({ scheduledTime: iDagKl('08:10') });
  assert.deepEqual(sendte, []);
});

test('en privat gårsdag puffer ingen', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -1), humor: 1, privat: true } });
  sendte.length = 0;
  await kjørKlokka({ scheduledTime: iDagKl('08:10') });
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

  await kjørKlokka({ scheduledTime: sondagKl('20:10') });
  const brev = sendte.filter((m) => m.text.includes('Uka hos Lykke'));
  assert.equal(brev.length, 1);
  assert.ok(brev[0].text.includes('3 dager ført'));
  assert.equal(brev[0].disable_notification, true);
});

test('en uke uten noe ført gir ikke noe brev', async () => {
  sendte.length = 0;
  await kjørKlokka({ scheduledTime: sondagKl('20:10') });
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

const knappene = (m) => (m?.reply_markup?.inline_keyboard ?? []).flat().map((k) => k.callback_data);

test('/meny gir en meny med knapper', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await fraEier('/meny');
  const data = knappene(sendte.at(-1));
  for (const k of ['meny:idag', 'meny:sammendrag', 'meny:glasset', 'meny:sporsmal', 'meny:status', 'meny:onsker', 'meny:brev', 'meny:logginn', 'meny:lenkelykke', 'meny:eksport']) {
    assert.ok(data.includes(k), `mangler ${k}`);
  }
});

test('/hjelp og /start gir den samme menyen', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  for (const kommando of ['/hjelp', '/start']) {
    sendte.length = 0;
    await fraEier(kommando);
    assert.ok(knappene(sendte.at(-1)).includes('meny:idag'), kommando);
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

/* ---------- delingen er hennes valg ---------- */

test('hun kan slå delt modus av og på, og han ser det', async () => {
  const hennes = await loggInn('lykke');
  assert.equal((await kall('/delt', { metode: 'POST', cookie: hennes, kropp: { på: true } })).status, 200);

  const hans = await loggInn('mathias');
  let t = await (await kall('/tilstand', { cookie: hans })).json();
  assert.equal(t.delt, true);
  assert.ok(t.meldinger.some((m) => m.fra === 'lykke' && m.tekst.includes('slått på delt modus')));

  await kall('/delt', { metode: 'POST', cookie: hennes, kropp: { på: false } });
  t = await (await kall('/tilstand', { cookie: hans })).json();
  assert.equal(t.delt, false);
});

test('han kan ikke snu delingen for henne', async () => {
  const hans = await loggInn('mathias');
  assert.equal((await kall('/delt', { metode: 'POST', cookie: hans, kropp: { på: true } })).status, 403);
});

test('valget hennes går foran oppsettsfila', async () => {
  env.DELT_MODUS = 'ja';
  const hennes = await loggInn('lykke');
  await kall('/delt', { metode: 'POST', cookie: hennes, kropp: { på: false } });

  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 2, tungt: 'mitt eget', privat: true } });
  const hans = await loggInn('mathias');
  const t = await (await kall('/tilstand', { cookie: hans })).json();
  assert.equal(t.idag.privat, true);
  assert.ok(!JSON.stringify(t).includes('mitt eget'));
});

test('hun får også en engangslenke, og den logger inn henne', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await fraEier('/logginn lykke');

  const lenke = sendte.map((m) => m.text).join('\n').match(/\/api\/lenke\?t=([\w.\-]+)/);
  assert.ok(lenke, 'skulle fått en lenke');

  const svar = await kall(`/lenke?t=${lenke[1]}`);
  assert.equal(svar.status, 302);
  const cookie = svar.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await (await kall('/meg', { cookie })).json()).hvem, 'lykke');
  assert.equal((await kall(`/lenke?t=${lenke[1]}`)).status, 401, 'også hennes skal være brukt opp');
});

test('de to lenkene spiser ikke hverandre', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await fraEier('/logginn');
  await fraEier('/logginn lykke');

  const alle = [...sendte.map((m) => m.text).join('\n').matchAll(/\/api\/lenke\?t=([\w.\-]+)/g)].map((m) => m[1]);
  assert.equal(alle.length, 2);
  for (const t of alle) assert.equal((await kall(`/lenke?t=${t}`)).status, 302);
});

/* ---------- varsel på det hun gjør ---------- */

test('innlogging, kveldsrunde og lesing sier fra – stille', async () => {
  env.AKTIV_VARSEL = 'ja';
  sendte.length = 0;
  const cookie = await loggInn('lykke');
  assert.ok(sisteSvar().includes('logget inn'));
  assert.equal(sendte.at(-1).disable_notification, true);

  sendte.length = 0;
  await kall('/hendelse', { metode: 'POST', cookie, kropp: { slag: 'begynt' } });
  assert.ok(sisteSvar().includes('kveldsrunden'));

  // Bare én gang samme dag.
  sendte.length = 0;
  await kall('/hendelse', { metode: 'POST', cookie, kropp: { slag: 'begynt' } });
  assert.deepEqual(sendte, []);
});

test('han utløser ingen hendelsesvarsler om seg selv', async () => {
  env.AKTIV_VARSEL = 'ja';
  sendte.length = 0;
  const cookie = await loggInn('mathias');
  await kall('/hendelse', { metode: 'POST', cookie, kropp: { slag: 'begynt' } });
  await kall('/tilstand', { cookie });
  assert.deepEqual(sendte, []);
});

test('at hun leser meldingene sies fra, men bare når det lå noe ulest', async () => {
  env.AKTIV_VARSEL = 'ja';
  const hans = await loggInn('mathias');
  await kall('/melding', { metode: 'POST', cookie: hans, kropp: { tekst: 'hei' } });

  const hennes = await loggInn('lykke');
  sendte.length = 0;
  await kall('/meldinger/lest', { metode: 'POST', cookie: hennes });
  assert.ok(sisteSvar().includes('lest meldingene'));

  sendte.length = 0;
  await kall('/meldinger/lest', { metode: 'POST', cookie: hennes });
  assert.deepEqual(sendte, [], 'ingenting nytt å lese, ingenting å si fra om');
});

test('at hun snur delingen sies fra med lyd', async () => {
  env.AKTIV_VARSEL = 'ja';
  const cookie = await loggInn('lykke');
  sendte.length = 0;
  await kall('/delt', { metode: 'POST', cookie, kropp: { på: true } });
  assert.ok(sisteSvar().includes('slo på delt modus'));
  assert.equal(sendte.at(-1).disable_notification, false);
});

test('at hun huker av et ønske sies fra', async () => {
  env.AKTIV_VARSEL = 'ja';
  const cookie = await loggInn('lykke');
  await kall('/onske', { metode: 'POST', cookie, kropp: { tekst: 'Bade i Nordsjøen' } });
  const t = await (await kall('/tilstand', { cookie })).json();
  sendte.length = 0;
  await kall(`/onske/${t.onsker[0].id}/gjort`, { metode: 'POST', cookie });
  assert.ok(sisteSvar().includes('huket av'));
  assert.ok(sisteSvar().includes('Bade i Nordsjøen'));
});

test('«hun er inne» kommer ett per vindu, ikke ett per trykk', async () => {
  env.AKTIV_VARSEL = 'ja';
  const cookie = await loggInn('lykke');
  sendte.length = 0;
  for (let i = 0; i < 4; i += 1) await kall('/tilstand', { cookie });
  assert.equal(sendte.filter((m) => m.text.includes('inne i appen')).length, 1);
});

/* ---------- menyen ---------- */

test('et menytrykk skriver om meldingen i stedet for å sende en ny', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  env.AKTIV_VARSEL = 'nei';
  await blirEier();
  sendte.length = 0;
  await oppdatering({
    callback_query: { id: 'c2', from: { id: EIER }, data: 'meny:status', message: { message_id: 9, chat: { id: -1 } } },
  });
  assert.deepEqual(sendte, [], 'ingen ny melding skal sendes');
  assert.ok(endret.at(-1)?.text.includes('Status'));
  assert.ok(knappene(endret.at(-1)).includes('meny:hjem'), 'skal ha en vei tilbake');
});

test('ønskelista kan hukes av fra knappene', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  await fraEier('/onske Kino på en tirsdag');

  const cookie = await loggInn('lykke');
  const t = await (await kall('/tilstand', { cookie })).json();
  const id = t.onsker[0].id;

  endret.length = 0;
  await oppdatering({
    callback_query: { id: 'c3', from: { id: EIER }, data: `onske:${id}`, message: { message_id: 9, chat: { id: -1 } } },
  });
  assert.ok(endret.at(-1)?.text.includes('✓ Kino på en tirsdag'));

  const etter = await (await kall('/tilstand', { cookie })).json();
  assert.equal(etter.onsker[0].gjort_av, 'mathias');
});

/* ---------- bilder og lyd ---------- */

const PIKSEL = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

const lastOppFil = async (cookie, { dato = '', slag = 'bilde', type = 'image/jpeg', data = PIKSEL } = {}) => {
  const svar = await worker.fetch(new Request(`https://test.local/api/fil?dato=${dato}&slag=${slag}`, {
    method: 'POST',
    headers: { 'Content-Type': type, Cookie: cookie },
    body: data,
  }), env, ctx);
  await roligNå();
  return svar;
};

test('hun kan legge et bilde på dagen, og det følger med til Telegram', async () => {
  const cookie = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4 } });
  filer.length = 0;

  const svar = await lastOppFil(cookie);
  assert.equal(svar.status, 200);
  const { id } = await svar.json();

  assert.equal(filer.length, 1);
  assert.equal(filer[0].metode, 'sendPhoto');

  const t = await (await kall('/tilstand', { cookie })).json();
  assert.deepEqual(t.idag.filer.map((f) => f.slag), ['bilde']);

  const hentet = await kall(`/fil/${id}`, { cookie });
  assert.equal(hentet.status, 200);
  assert.equal(hentet.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await hentet.arrayBuffer()), PIKSEL);
});

test('bilder på en privat dag går ingen steder, og han får dem ikke', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 2, privat: true } });
  filer.length = 0;

  const { id } = await (await lastOppFil(hennes)).json();
  assert.deepEqual(filer, [], 'ingenting skal ut fra en privat dag');

  const hans = await loggInn('mathias');
  assert.equal((await kall(`/fil/${id}`, { cookie: hans })).status, 403);
  const t = await (await kall('/tilstand', { cookie: hans })).json();
  assert.deepEqual(t.idag.filer ?? [], []);
});

test('bare hun legger til og sletter', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 4 } });
  const { id } = await (await lastOppFil(hennes)).json();

  const hans = await loggInn('mathias');
  assert.equal((await lastOppFil(hans)).status, 403);
  assert.equal((await kall(`/fil/${id}`, { metode: 'DELETE', cookie: hans })).status, 403);

  assert.equal((await kall(`/fil/${id}`, { metode: 'DELETE', cookie: hennes })).status, 200);
  assert.equal((await kall(`/fil/${id}`, { cookie: hennes })).status, 404);
});

test('filtypen må være noe vi faktisk kan vise', async () => {
  const cookie = await loggInn('lykke');
  assert.equal((await lastOppFil(cookie, { type: 'application/zip' })).status, 415);
  assert.equal((await lastOppFil(cookie, { slag: 'lyd', type: 'image/jpeg' })).status, 415);
  assert.equal((await lastOppFil(cookie, { slag: 'lyd', type: 'audio/webm' })).status, 200);
});

test('tomme og altfor store filer avvises', async () => {
  const cookie = await loggInn('lykke');
  assert.equal((await lastOppFil(cookie, { data: new Uint8Array(0) })).status, 400);
  assert.equal((await lastOppFil(cookie, { data: new Uint8Array(9 * 1024 * 1024) })).status, 413);
});

test('uten innlogging får ingen se en fil', async () => {
  const cookie = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4 } });
  const { id } = await (await lastOppFil(cookie)).json();
  assert.equal((await kall(`/fil/${id}`)).status, 401);
});

/* ---------- eksport ---------- */

test('eksporten har alt hennes, og bare det delte hos ham', async () => {
  const hennes = await loggInn('lykke');
  await kall('/dag', {
    metode: 'POST', cookie: hennes,
    kropp: { humor: 2, tungt: 'noe for meg selv', privat: true },
  });
  await kall('/onske', { metode: 'POST', cookie: hennes, kropp: { tekst: 'Kino' } });

  const hennesFil = await (await kall('/eksport', { cookie: hennes })).json();
  assert.equal(hennesFil.dager[0].tungt, 'noe for meg selv');
  assert.equal(hennesFil.onsker.length, 1);

  const hans = await loggInn('mathias');
  const svar = await kall('/eksport', { cookie: hans });
  assert.match(svar.headers.get('Content-Disposition'), /lykkeglasset-\d{4}-\d{2}-\d{2}\.json/);
  const hansFil = await svar.json();
  assert.equal(hansFil.dager[0].privat, true);
  assert.ok(!JSON.stringify(hansFil).includes('noe for meg selv'));
});

test('eksporten røper ikke brev hun ikke har åpnet', async () => {
  const hans = await loggInn('mathias');
  await kall('/brev', { metode: 'POST', cookie: hans, kropp: { tekst: 'Til en tung dag.' } });
  const hennes = await loggInn('lykke');
  const fil = await (await kall('/eksport', { cookie: hennes })).json();
  assert.equal(fil.brev.length, 1);
  assert.equal(fil.brev[0].tekst, undefined);
});

test('/eksport i boten sender fila som dokument', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  filer.length = 0;
  await fraEier('/eksport');
  assert.equal(filer.length, 1);
  assert.equal(filer[0].metode, 'sendDocument');
});

test('han ser ikke engang at det ligger et bilde på en privat dag', async () => {
  const hennes = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 3, privat: true } });
  await lastOppFil(hennes);

  const hans = await loggInn('mathias');
  const via = await (await kall(`/dag?dato=${idag}`, { cookie: hans })).json();
  assert.deepEqual(via.dag.filer, []);
  const t = await (await kall('/tilstand', { cookie: hans })).json();
  assert.deepEqual(t.idag.filer, []);
});

/* ---------- reaksjoner ---------- */

test('et hjerte kan settes, byttes og tas bort igjen', async () => {
  const hans = await loggInn('mathias');
  await kall('/melding', { metode: 'POST', cookie: hans, kropp: { tekst: 'Er straks hjemme' } });

  const hennes = await loggInn('lykke');
  let t = await (await kall('/tilstand', { cookie: hennes })).json();
  const id = t.meldinger[0].id;

  await kall(`/melding/${id}/reaksjon`, { metode: 'POST', cookie: hennes, kropp: { tegn: '❤️' } });
  t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.deepEqual(t.meldinger[0].reaksjoner, [{ hvem: 'lykke', tegn: '❤️' }]);

  await kall(`/melding/${id}/reaksjon`, { metode: 'POST', cookie: hennes, kropp: { tegn: '😂' } });
  t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.deepEqual(t.meldinger[0].reaksjoner, [{ hvem: 'lykke', tegn: '😂' }]);

  // Samme tegn om igjen tar det bort.
  await kall(`/melding/${id}/reaksjon`, { metode: 'POST', cookie: hennes, kropp: { tegn: '😂' } });
  t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.deepEqual(t.meldinger[0].reaksjoner, []);
});

test('begge kan reagere på den samme meldingen', async () => {
  const hans = await loggInn('mathias');
  await kall('/melding', { metode: 'POST', cookie: hans, kropp: { tekst: 'hei' } });
  const t0 = await (await kall('/tilstand', { cookie: hans })).json();
  const id = t0.meldinger[0].id;

  await kall(`/melding/${id}/reaksjon`, { metode: 'POST', cookie: hans, kropp: { tegn: '✨' } });
  const hennes = await loggInn('lykke');
  await kall(`/melding/${id}/reaksjon`, { metode: 'POST', cookie: hennes, kropp: { tegn: '❤️' } });

  const t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.equal(t.meldinger[0].reaksjoner.length, 2);
});

test('hennes reaksjon sier fra, hans gjør ikke', async () => {
  env.AKTIV_VARSEL = 'ja';
  const hans = await loggInn('mathias');
  await kall('/melding', { metode: 'POST', cookie: hans, kropp: { tekst: 'Jeg tar middagen' } });
  const t = await (await kall('/tilstand', { cookie: hans })).json();
  const id = t.meldinger[0].id;

  sendte.length = 0;
  await kall(`/melding/${id}/reaksjon`, { metode: 'POST', cookie: hans, kropp: { tegn: '❤️' } });
  assert.deepEqual(sendte, []);

  const hennes = await loggInn('lykke');
  sendte.length = 0;
  await kall(`/melding/${id}/reaksjon`, { metode: 'POST', cookie: hennes, kropp: { tegn: '❤️' } });
  assert.ok(sisteSvar().includes('reagerte på'));
  assert.ok(sisteSvar().includes('Jeg tar middagen'));
});

test('ukjente tegn settes ikke', async () => {
  const hans = await loggInn('mathias');
  await kall('/melding', { metode: 'POST', cookie: hans, kropp: { tekst: 'hei' } });
  const t = await (await kall('/tilstand', { cookie: hans })).json();
  await kall(`/melding/${t.meldinger[0].id}/reaksjon`, { metode: 'POST', cookie: hans, kropp: { tegn: '<script>' } });
  const etter = await (await kall('/tilstand', { cookie: hans })).json();
  assert.deepEqual(etter.meldinger[0].reaksjoner, []);
});

test('/dag <dato> henter en bestemt dag, med svaret på kveldens spørsmål', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  const dato = flyttDag(idag, -3);
  await kall('/dag', {
    metode: 'POST', cookie,
    kropp: { dato, humor: 5, gode_ting: [{ tekst: 'sol' }], svar: 'Vi lo av katten' },
  });

  sendte.length = 0;
  await fraEier(`/dag ${dato}`);
  assert.ok(sisteSvar().includes('Vi lo av katten'));
  assert.ok(sisteSvar().includes('sol'));
});

test('/dag med tull som dato gjør ingenting', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;
  await fraEier('/dag i-fjor');
  assert.deepEqual(sendte, []);
});

test('spørsmålet følger datoen, også for en dag som ikke er skrevet', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  const tom = flyttDag(idag, -12);

  const svar = await (await kall(`/dag?dato=${tom}`, { cookie })).json();
  assert.equal(svar.dag, null);
  assert.ok(svar.sporsmal.length > 5, 'en tom dag har også et spørsmål');

  const t = await (await kall('/tilstand', { cookie })).json();
  assert.ok(t.sporsmal.length > 5);
  assert.notEqual(t.sporsmal, svar.sporsmal, 'ulike dager, ulike spørsmål');
});

/* ---------- spørsmålslista ---------- */

test('lista gir tre om gangen, fra den kategorien hun velger', async () => {
  const cookie = await loggInn('lykke');
  const alt = await (await kall('/sporsmal', { cookie })).json();
  assert.equal(alt.forslag.length, 3);
  assert.equal(alt.igjen, 60);
  assert.ok(Object.keys(alt.kategorier).includes('oss'));

  const oss = await (await kall('/sporsmal?kat=oss', { cookie })).json();
  assert.equal(oss.igjen, 12, 'tolv i hver kategori');
  for (const s of oss.forslag) assert.equal(s.kat, 'oss');
});

test('forslagene byttes ut, så det ikke er de samme tre hver gang', async () => {
  const cookie = await loggInn('lykke');
  const sett = new Set();
  for (let i = 0; i < 6; i += 1) {
    const d = await (await kall('/sporsmal?kat=minner', { cookie })).json();
    for (const s of d.forslag) sett.add(s.k);
  }
  assert.ok(sett.size > 3, `fikk bare ${sett.size} ulike spørsmål på seks forsøk`);
});

test('et svar lagres, teller ned, og forsvinner fra forslagene', async () => {
  const cookie = await loggInn('lykke');
  const før = await (await kall('/sporsmal?kat=oss', { cookie })).json();
  const spm = før.forslag[0];

  await kall('/sporsmal', { metode: 'POST', cookie, kropp: { k: spm.k, tekst: 'Da du hentet meg i regnet.' } });

  const etter = await (await kall('/sporsmal?kat=oss', { cookie })).json();
  assert.equal(etter.igjen, 11);
  assert.equal(etter.ferdig, 1);
  assert.ok(!etter.forslag.some((s) => s.k === spm.k));
  assert.deepEqual(etter.svarte.map((s) => s.svar), ['Da du hentet meg i regnet.']);
});

test('et tomt svar fjerner det som lå der', async () => {
  const cookie = await loggInn('lykke');
  await kall('/sporsmal', { metode: 'POST', cookie, kropp: { k: 13, tekst: 'noe' } });
  await kall('/sporsmal', { metode: 'POST', cookie, kropp: { k: 13, tekst: '   ' } });
  const d = await (await kall('/sporsmal', { cookie })).json();
  assert.equal(d.ferdig, 0);
});

test('ukjente spørsmål avvises, og bare hun svarer', async () => {
  const hennes = await loggInn('lykke');
  assert.equal((await kall('/sporsmal', { metode: 'POST', cookie: hennes, kropp: { k: 9999, tekst: 'hei' } })).status, 400);

  const hans = await loggInn('mathias');
  assert.equal((await kall('/sporsmal', { metode: 'POST', cookie: hans, kropp: { k: 1, tekst: 'hei' } })).status, 403);
});

test('svarene hennes havner i arkivet', async () => {
  const cookie = await loggInn('lykke');
  await kall('/sporsmal', { metode: 'POST', cookie, kropp: { k: 25, tekst: 'På hytta til bestemor' } });
  const treff = await (await kall('/arkiv?sok=bestemor', { cookie })).json();
  assert.equal(treff.antall, 1);
  assert.ok(treff.treff[0].sporsmal.includes('lykkeligst'));
});

test('hun får si fra selv når hun svarer', async () => {
  env.AKTIV_VARSEL = 'ja';
  const cookie = await loggInn('lykke');
  sendte.length = 0;
  await kall('/sporsmal', { metode: 'POST', cookie, kropp: { k: 17, tekst: 'Å høre etter.' } });
  assert.ok(sisteSvar().includes('Å høre etter.'));
  assert.equal(sendte.at(-1).disable_notification, true);
});

/* ---------- sammendraget ---------- */

test('sammendraget teller dagene og finner den beste og den tyngste', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  for (const [tilbake, humor, tekst] of [[0, 3, 'grei'], [1, 5, 'best'], [2, 1, 'verst'], [3, 4, 'fin']]) {
    await kall('/dag', {
      metode: 'POST', cookie,
      kropp: { dato: flyttDag(idag, -tilbake), humor, gode_ting: [{ tekst }], behov: humor <= 2 ? 'klem' : null },
    });
  }

  const d = await (await kall('/sammendrag?periode=uke', { cookie })).json();
  assert.equal(d.ført, 4);
  assert.equal(d.snitt, 3.25);
  assert.equal(d.beste.humor, 5);
  assert.equal(d.tyngste.humor, 1);
  assert.deepEqual(d.beste.gode_ting.map((g) => g.tekst), ['best']);
  assert.deepEqual(d.behov, [{ behov: 'klem', antall: 1 }]);
  assert.equal(d.antall_gode_ting, 4);
});

test('sammendraget hans holder de private dagene utenfor', async () => {
  const hennes = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { dato: idag, humor: 5, gode_ting: [{ tekst: 'delt' }] } });
  await kall('/dag', {
    metode: 'POST', cookie: hennes,
    kropp: { dato: flyttDag(idag, -1), humor: 1, gode_ting: [{ tekst: 'hemmelig' }], privat: true },
  });

  const hans = await loggInn('mathias');
  const d = await (await kall('/sammendrag?periode=uke', { cookie: hans })).json();
  assert.equal(d.private, 1);
  assert.equal(d.tyngste, null, 'den private dagen skal ikke bli tyngste dag');
  assert.ok(!JSON.stringify(d).includes('hemmelig'));
});

test('/sammendrag i boten kommer med knapper for periode', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  const cookie = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4, gode_ting: [{ tekst: 'sol' }] } });

  sendte.length = 0;
  await fraEier('/sammendrag');
  assert.ok(sisteSvar().includes('Sju siste dagene'));
  const data = knappene(sendte.at(-1));
  assert.ok(data.includes('meny:sammendrag:maned'));
  assert.ok(data.includes('meny:sammendrag:ar'));
});

test('/sporsmal i boten viser hvor langt hun er kommet', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  const cookie = await loggInn('lykke');
  await kall('/sporsmal', { metode: 'POST', cookie, kropp: { k: 1, tekst: 'Å pakke sekker.' } });

  sendte.length = 0;
  await fraEier('/sporsmal');
  assert.ok(sisteSvar().includes('1 av 60'));
  assert.ok(sisteSvar().includes('Å pakke sekker.'));
});

test('hun velger hvor mange spørsmål hun vil se', async () => {
  const cookie = await loggInn('lykke');
  for (const antall of [3, 10, 20, 30]) {
    const d = await (await kall(`/sporsmal?antall=${antall}`, { cookie })).json();
    assert.equal(d.forslag.length, antall);
    assert.equal(d.antall, antall);
  }
  // Et tall vi ikke tilbyr faller tilbake til tre.
  const rart = await (await kall('/sporsmal?antall=7', { cookie })).json();
  assert.equal(rart.forslag.length, 3);
});

test('en kategori gir aldri flere enn den har', async () => {
  const cookie = await loggInn('lykke');
  const d = await (await kall('/sporsmal?kat=oss&antall=30', { cookie })).json();
  assert.equal(d.forslag.length, 12);
});

test('glasset trekker ikke den samme lappen to ganger på rad', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  for (const [i, tekst] of ['bålkaffe', 'sol på trappa', 'lang telefon'].entries()) {
    await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -20 - i), humor: 4, gode_ting: [{ tekst }] } });
  }

  const først = await (await kall('/glasset', { cookie })).json();
  for (let i = 0; i < 6; i += 1) {
    const neste = await (await kall(`/glasset?forrige=${encodeURIComponent(først.tekst)}`, { cookie })).json();
    assert.notEqual(neste.tekst, først.tekst);
  }
});

test('med bare én lapp i glasset kommer den samme igjen', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -30), humor: 4, gode_ting: [{ tekst: 'den ene' }] } });
  const d = await (await kall('/glasset?forrige=den%20ene', { cookie })).json();
  assert.equal(d.tekst, 'den ene');
});

/* ---------- slette en dag ---------- */

test('hun kan slette en dag, med bilder og svar og alt', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4, gode_ting: [{ tekst: 'feil dag' }], svar: 'og et svar' } });
  const { id } = await (await lastOppFil(cookie)).json();

  sendte.length = 0;
  assert.equal((await kall(`/dag?dato=${idag}`, { metode: 'DELETE', cookie })).status, 200);

  const etter = await (await kall('/tilstand', { cookie })).json();
  assert.equal(etter.idag, null);
  assert.equal(etter.antall_gode_ting, 0);
  assert.equal((await kall(`/fil/${id}`, { cookie })).status, 404);
  assert.ok(sisteSvar().includes('slettet'));

  // Og dagen kan føres på nytt, med varsel som om den var ny.
  sendte.length = 0;
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 2 } });
  assert.ok(alleMeldinger().includes('tung dag'));
});

test('han kan ikke slette dagene hennes', async () => {
  const hennes = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie: hennes, kropp: { humor: 4 } });
  const hans = await loggInn('mathias');
  assert.equal((await kall(`/dag?dato=${idag}`, { metode: 'DELETE', cookie: hans })).status, 403);
});

test('en slettet privat dag sier ingenting', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 2, privat: true } });
  sendte.length = 0;
  await kall(`/dag?dato=${idag}`, { metode: 'DELETE', cookie });
  assert.deepEqual(sendte, []);
});

test('glasset trekker fra alt når det er få gamle lapper', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  // Én gammel og tre ferske: da skal de ferske telle med, ellers blir det
  // den samme lappen hver eneste gang.
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -30), humor: 4, gode_ting: [{ tekst: 'gammel' }] } });
  await kall('/dag', {
    metode: 'POST', cookie,
    kropp: { humor: 4, gode_ting: [{ tekst: 'fersk en' }, { tekst: 'fersk to' }, { tekst: 'fersk tre' }] },
  });

  const sett = new Set();
  for (let i = 0; i < 12; i += 1) {
    const g = await (await kall('/glasset', { cookie })).json();
    sett.add(g.tekst);
  }
  assert.ok(sett.size > 1, `fikk bare «${[...sett]}» på tolv trekk`);
});

/* ---------- vedlegg i meldinger ---------- */

const lastOppVedlegg = async (cookie, slag = 'bilde', type = 'image/jpeg') => {
  const svar = await worker.fetch(new Request(`https://test.local/api/melding/fil?slag=${slag}`, {
    method: 'POST',
    headers: { 'Content-Type': type, Cookie: cookie },
    body: PIKSEL,
  }), env, ctx);
  await roligNå();
  return svar;
};

test('et bilde kan følge med en melding, og begge kan se det', async () => {
  const hennes = await loggInn('lykke');
  const { id } = await (await lastOppVedlegg(hennes)).json();
  filer.length = 0;

  await kall('/melding', { metode: 'POST', cookie: hennes, kropp: { tekst: 'Se her', filer: [id] } });

  const t = await (await kall('/tilstand', { cookie: hennes })).json();
  assert.deepEqual(t.meldinger.at(-1).filer.map((f) => f.id), [id]);
  assert.equal(filer.length, 1, 'vedlegget skal videre til Telegram');

  const hans = await loggInn('mathias');
  assert.equal((await kall(`/fil/${id}`, { cookie: hans })).status, 200);
});

test('et vedlegg havner ikke på dagen', async () => {
  const cookie = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4 } });
  const { id } = await (await lastOppVedlegg(cookie)).json();
  await kall('/melding', { metode: 'POST', cookie, kropp: { tekst: 'hei', filer: [id] } });

  const t = await (await kall('/tilstand', { cookie })).json();
  assert.deepEqual(t.idag.filer, [], 'dagens bilder er dagens, ikke samtalens');
});

test('en melding kan være bare et bilde', async () => {
  const cookie = await loggInn('lykke');
  const { id } = await (await lastOppVedlegg(cookie)).json();
  assert.equal((await kall('/melding', { metode: 'POST', cookie, kropp: { filer: [id] } })).status, 200);
  assert.equal((await kall('/melding', { metode: 'POST', cookie, kropp: {} })).status, 400);
});

test('vedlegg som aldri ble sendt, ryddes bort etter et døgn', async () => {
  const cookie = await loggInn('lykke');
  const { id } = await (await lastOppVedlegg(cookie)).json();
  // Sett tidsstempelet to døgn tilbake, som om det ble glemt.
  db.prepare("UPDATE filer SET laget_kl = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);

  await kjørKlokka({ scheduledTime: iDagKl('21:35') });
  assert.equal((await kall(`/fil/${id}`, { cookie })).status, 404);
});

test('et vedlegg som er sendt, ryddes ikke bort', async () => {
  const cookie = await loggInn('lykke');
  const { id } = await (await lastOppVedlegg(cookie)).json();
  await kall('/melding', { metode: 'POST', cookie, kropp: { tekst: 'beholdes', filer: [id] } });
  db.prepare("UPDATE filer SET laget_kl = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);

  await kjørKlokka({ scheduledTime: iDagKl('21:35') });
  assert.equal((await kall(`/fil/${id}`, { cookie })).status, 200);
});

test('å slette dagen rører ikke vedleggene i samtalen', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4 } });
  const dagsbilde = (await (await lastOppFil(cookie)).json()).id;
  const vedlegg = (await (await lastOppVedlegg(cookie)).json()).id;
  await kall('/melding', { metode: 'POST', cookie, kropp: { tekst: 'står', filer: [vedlegg] } });

  await kall(`/dag?dato=${idag}`, { metode: 'DELETE', cookie });

  assert.equal((await kall(`/fil/${dagsbilde}`, { cookie })).status, 404, 'dagens bilde skal bort');
  assert.equal((await kall(`/fil/${vedlegg}`, { cookie })).status, 200, 'meldingen sin står igjen');
  const t = await (await kall('/tilstand', { cookie })).json();
  assert.deepEqual(t.meldinger.at(-1).filer.map((f) => f.id), [vedlegg]);
});

test('han kan angre på et vedlegg han ikke har sendt ennå', async () => {
  const hans = await loggInn('mathias');
  const { id } = await (await lastOppVedlegg(hans)).json();
  assert.equal((await kall(`/fil/${id}`, { metode: 'DELETE', cookie: hans })).status, 200);
  assert.equal((await kall(`/fil/${id}`, { cookie: hans })).status, 404);
});

test('men ikke på et vedlegg som er sendt', async () => {
  const hennes = await loggInn('lykke');
  const { id } = await (await lastOppVedlegg(hennes)).json();
  await kall('/melding', { metode: 'POST', cookie: hennes, kropp: { tekst: 'sendt', filer: [id] } });

  const hans = await loggInn('mathias');
  assert.equal((await kall(`/fil/${id}`, { metode: 'DELETE', cookie: hans })).status, 403);
});

test('bildetallet i sammendraget teller dagene, ikke samtalen', async () => {
  const cookie = await loggInn('lykke');
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4 } });
  await lastOppFil(cookie);
  const { id } = await (await lastOppVedlegg(cookie)).json();
  await kall('/melding', { metode: 'POST', cookie, kropp: { tekst: 'med bilde', filer: [id] } });

  const s = await (await kall('/sammendrag?periode=uke', { cookie })).json();
  assert.equal(s.antall_bilder, 1);
});

/* ---------- bilde fra Telegram ---------- */

test('et bilde han sender boten, havner i samtalen', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  sendte.length = 0;

  await fraEier(undefined, {
    photo: [{ file_id: 'liten', file_size: 100 }, { file_id: 'stor', file_size: 900 }],
    caption: 'Se hvor fint her',
  });

  assert.deepEqual(hentedeFiler, ['stor'], 'den største varianten skal hentes');
  const m = (await meldingene()).at(-1);
  assert.equal(m.fra, 'mathias');
  assert.equal(m.tekst, 'Se hvor fint her');
  assert.equal(m.filer.length, 1);
  assert.ok(sisteSvar().includes('Bildet ligger i samtalen'));

  // Og hun får det ut igjen.
  const cookie = await loggInn('lykke');
  const hentet = await kall(`/fil/${m.filer[0].id}`, { cookie });
  assert.equal(hentet.status, 200);
  assert.deepEqual(new Uint8Array(await hentet.arrayBuffer()), PIKSEL);
});

test('et bilde uten tekst blir en melding likevel', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  await fraEier(undefined, { photo: [{ file_id: 'stor', file_size: 900 }] });
  assert.equal((await meldingene()).at(-1).tekst, '📷');
});

test('en talemelding til boten blir et lydklipp i samtalen', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  await fraEier(undefined, { voice: { file_id: 'tale', mime_type: 'audio/ogg' } });

  const m = (await meldingene()).at(-1);
  assert.equal(m.tekst, '🎙');
  assert.equal(m.filer[0].slag, 'lyd');
  assert.equal(m.filer[0].type, 'audio/ogg');
});

test('bilder hun ikke har sendt, hører ikke boten på', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  await oppdatering({
    message: { from: { id: 999 }, chat: { id: -1, type: 'group' }, photo: [{ file_id: 'stor' }] },
  });
  assert.deepEqual(hentedeFiler, [], 'bare eieren slipper til');
  assert.deepEqual(await meldingene(), []);
});

/* ---------- ting som var galt før ---------- */

test('milepælen feires én gang, ikke én gang per dato', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  // 33 dager à 3 gode ting = 99. Neste dag krysser 100.
  for (let d = 40; d > 7; d -= 1) {
    await kall('/dag', {
      metode: 'POST', cookie,
      kropp: {
        dato: flyttDag(idag, -d),
        humor: 4,
        gode_ting: [{ tekst: `en ${d}` }, { tekst: `to ${d}` }, { tekst: `tre ${d}` }],
      },
    });
  }
  sendte.length = 0;
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4, gode_ting: [{ tekst: 'nummer hundre' }] } });
  assert.equal(sendte.filter((m) => m.text.includes('Milepæl')).length, 1, 'skal feires når den passeres');

  // En helt annen dag etterpå skal ikke feire det samme på nytt.
  sendte.length = 0;
  await kall('/dag', { metode: 'POST', cookie, kropp: { dato: flyttDag(idag, -1), humor: 4, gode_ting: [{ tekst: 'i går' }] } });
  assert.deepEqual(sendte.filter((m) => m.text.includes('Milepæl')), []);
});

test('å rette en dag som alt fantes, utløser ingen milepæl', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  for (let d = 40; d > 7; d -= 1) {
    await kall('/dag', {
      metode: 'POST', cookie,
      kropp: { dato: flyttDag(idag, -d), humor: 4, gode_ting: [{ tekst: `en ${d}` }, { tekst: `to ${d}` }, { tekst: `tre ${d}` }] },
    });
  }
  // 99 ting. Dagen i dag krysser hundre, og den milepælen er nå feiret.
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4, gode_ting: [{ tekst: 'nummer hundre' }] } });

  // Så rettes humøret på en gammel dag. Antallet står stille, og en dato som
  // aldri har sett milepælsvarselet, skal ikke kunne utløse det på nytt.
  sendte.length = 0;
  await kall('/dag', {
    metode: 'POST', cookie,
    kropp: { dato: flyttDag(idag, -20), humor: 5, gode_ting: [{ tekst: 'en 20' }, { tekst: 'to 20' }, { tekst: 'tre 20' }] },
  });
  assert.deepEqual(sendte.filter((m) => m.text.includes('Milepæl')), [], 'det er ingen nye ting i glasset');
});

test('glasset i tilstanden teller også det som er eldre enn historikkvinduet', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  await kall('/dag', {
    metode: 'POST', cookie,
    kropp: { dato: flyttDag(idag, -800), humor: 4, gode_ting: [{ tekst: 'lenge siden' }, { tekst: 'og en til' }] },
  });
  await kall('/dag', { metode: 'POST', cookie, kropp: { humor: 4, gode_ting: [{ tekst: 'i dag' }] } });

  const t = await (await kall('/tilstand', { cookie })).json();
  assert.equal(t.antall_gode_ting, 3, 'glasset skal ikke tømme seg selv med tida');
});

test('en melding med vedlegg som er borte, blir ikke en tom bildeboble', async () => {
  const cookie = await loggInn('lykke');
  const svar = await kall('/melding', { metode: 'POST', cookie, kropp: { filer: ['finnes-ikke'] } });
  assert.equal(svar.status, 400);
  assert.match((await svar.json()).feil, /ikke der lenger/);
  assert.deepEqual(await meldingene(), [], 'ingen melding skal ha blitt til');
});

test('tekst berger meldingen selv om vedlegget er borte', async () => {
  const cookie = await loggInn('lykke');
  const { id } = await (await lastOppVedlegg(cookie)).json();
  await kall(`/fil/${id}`, { metode: 'DELETE', cookie });

  assert.equal((await kall('/melding', { metode: 'POST', cookie, kropp: { tekst: 'står likevel', filer: [id] } })).status, 200);
  const m = (await meldingene()).at(-1);
  assert.equal(m.tekst, 'står likevel');
  assert.deepEqual(m.filer, []);
});

test('vedleggene beholder rekkefølgen hun valgte dem i', async () => {
  const cookie = await loggInn('lykke');
  const a = (await (await lastOppVedlegg(cookie)).json()).id;
  const b = (await (await lastOppVedlegg(cookie)).json()).id;
  await kall('/melding', { metode: 'POST', cookie, kropp: { tekst: 'to stykker', filer: [b, a] } });
  const ider = (await meldingene()).at(-1).filer.map((f) => f.id);
  assert.equal(ider.length, 2);
});

test('et bilde kan ikke legges på en dag som ikke har vært', async () => {
  const cookie = await loggInn('lykke');
  const idag = dagsnokkel(new Date(), 'Europe/Oslo');
  const svar = await worker.fetch(new Request(`https://test.local/api/fil?dato=${flyttDag(idag, 3)}&slag=bilde`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', Cookie: cookie },
    body: PIKSEL,
  }), env, ctx);
  assert.equal(svar.status, 400);
});

test('boten viser hvor langt hun er kommet i hver kategori', async () => {
  env.TELEGRAM_WEBHOOK_HEMMELIG = HEM;
  await blirEier();
  const cookie = await loggInn('lykke');
  const lista = await (await kall('/sporsmal?kat=oss&antall=3', { cookie })).json();
  await kall('/sporsmal', { metode: 'POST', cookie, kropp: { k: lista.forslag[0].k, tekst: 'et svar' } });

  sendte.length = 0;
  await fraEier('/sporsmal');
  const t = sisteSvar();
  assert.match(t, /Om meg: 0 av 12/);
  assert.match(t, /Om oss: 1 av 12/);
});
