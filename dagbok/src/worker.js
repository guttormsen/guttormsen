/**
 * Dagbok – API-et.
 *
 * Statiske filer serveres av Cloudflare rett fra `public/`; alt under `/api/`
 * havner her. Lageret er D1 (SQLite), varslene går til Telegram.
 *
 * Regelen som styrer hele fila: **forfatteren bestemmer hva leseren får se.** Alle svar
 * til leseren går gjennom `forLeseren()`, som fjerner det som ikke er delt. Det
 * er ett sted å lese for å vite at det stemmer.
 */
import {
  COOKIE, lagKode, lagToken, lesToken, lesCookie, likeStrenger, settCookie, slettCookie, stemmerKode,
} from './auth.js';
import {
  dagsnokkel, klokke, minutter, dagerMellom, sisteDager, sammeDagIFjor, norskDato, norskUkedag,
} from './dato.js';
import {
  BEHOV, SVAR, melding, ryddDag, varslerForDag, påminnelse, stilleDager, brevÅpnet, nyMelding, nyttOnske,
  erAktiv, morgenPuff, ukesbrev, arsbok, dagsrapport, onskeliste, statuslinje,
  MENY, TILBAKE, MENYTEKST, HENDELSER, REAKSJONER, sporsmalFor, milepælFor, milepæl,
  LISTA, KATEGORIER, sporsmalMed, PERIODER, sammendragstekst, sporsmalstekst,
} from './varsler.js';
import {
  sendTelegram, sendFil, hentFraTelegram, kvitterTrykk, byttUtKnapper, endreMelding,
} from './telegram.js';

const FORFATTER = 'forfatter';
const LESER = 'leser';
const HISTORIKK_DAGER = 400;

/**
 * Milepælsvarslene låses på denne i stedet for på en dato. Den er ikke en dag,
 * og det er med vilje: «100 gode ting» skjer én gang, ikke én gang per dato.
 * Den overlever også at en dag slettes – milepælen er allerede feiret.
 */
const MILEPÆLSLÅS = 'alle';

/* ---------- svar ---------- */

const json = (data, status = 200, hoder = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...hoder,
    },
  });

const feil = (tekst, status) => json({ feil: tekst }, status);

/* ---------- oppslag ---------- */

const sone = (env) => env.TIDSSONE || 'Europe/Oslo';
/**
 * Delt modus: alt forfatteren fører, ser leseren, og da finnes ikke «bare for meg».
 *
 * Det er forfatterens valg, og det bor i databasen – ikke i oppsettsfila. En bryter
 * som bare kan snus av den som har utviklerverktøy, er ikke forfatterens.
 * `DELT_MODUS` i wrangler.toml er bare utgangspunktet, før forfatteren har valgt.
 */
async function erDelt(env) {
  const valgt = await lesOppsett(env, 'delt_modus');
  return valgt === null ? env.DELT_MODUS === 'ja' : valgt === 'ja';
}
const idag = (env) => dagsnokkel(new Date(), sone(env));
const nå = () => new Date().toISOString();

function radTilDag(rad) {
  if (!rad) return null;
  let gode = [];
  try {
    gode = JSON.parse(rad.gode_ting || '[]');
  } catch {
    gode = [];
  }
  return {
    dato: rad.dato,
    humor: rad.humor,
    gode_ting: Array.isArray(gode) ? gode : [],
    tungt: rad.tungt,
    behov: rad.behov,
    del_gode: Boolean(rad.del_gode),
    del_tungt: Boolean(rad.del_tungt),
    privat: Boolean(rad.privat),
    skrevet_kl: rad.skrevet_kl,
    endret_kl: rad.endret_kl,
  };
}

const hentDag = async (env, dato) =>
  radTilDag(await env.DB.prepare('SELECT * FROM dager WHERE dato = ?1').bind(dato).first());

/**
 * Dagen slik leseren får se den. Alt som ikke er delt, finnes ikke her.
 * En privat dag vises som en grå rute: at forfatteren skrev noe er ikke hemmelig,
 * innholdet er det.
 */
function forLeseren(dag, delt = false) {
  if (!dag) return null;
  if (delt) return { ...dag, holdt_gode: false, holdt_tungt: false };
  if (dag.privat) return { dato: dag.dato, privat: true };
  return {
    dato: dag.dato,
    humor: dag.humor,
    behov: dag.behov,
    gode_ting: dag.del_gode ? dag.gode_ting : [],
    holdt_gode: !dag.del_gode && dag.gode_ting.length > 0,
    tungt: dag.del_tungt ? dag.tungt : null,
    holdt_tungt: Boolean(dag.tungt) && !dag.del_tungt,
    skrevet_kl: dag.skrevet_kl,
    privat: false,
  };
}

/* ---------- varsling ---------- */

/**
 * Sender én gang. Raden i `varsler` er låsen: kommer den inn, er vi først.
 * Uten den ville hver lille retting av dagen utløst varselet på nytt.
 */
async function sendEnGang(env, ctx, slag, dato, tekst, stille, knapper = null) {
  const res = await env.DB
    .prepare('INSERT OR IGNORE INTO varsler (slag, dato, sendt_kl) VALUES (?1, ?2, ?3)')
    .bind(slag, dato, nå())
    .run();
  if (!res.meta?.changes) return false;
  send(env, ctx, tekst, stille, knapper);
  return true;
}

/** Sender uten lås – for ting som skal fram hver gang, som meldinger. */
function send(env, ctx, tekst, stille = false, knapper = null) {
  const oppgave = sendTelegram(env, tekst, { stille, knapper });
  if (ctx?.waitUntil) ctx.waitUntil(oppgave);
  return oppgave;
}

/* ---------- små ting som må huskes ---------- */

const lesOppsett = async (env, nokkel) =>
  (await env.DB.prepare('SELECT verdi FROM oppsett WHERE nokkel = ?1').bind(nokkel).first())?.verdi ?? null;

const skrivOppsett = (env, nokkel, verdi) =>
  env.DB.prepare(`INSERT INTO oppsett (nokkel, verdi, satt_kl) VALUES (?1, ?2, ?3)
                  ON CONFLICT(nokkel) DO UPDATE SET verdi = ?2, satt_kl = ?3`)
    .bind(nokkel, String(verdi), nå()).run();

/** Legger en melding i samtalen. Brukes både fra appen og fra Telegram. */
const leggMelding = (env, fra, tekst) =>
  env.DB.prepare('INSERT INTO meldinger (fra, tekst, laget_kl) VALUES (?1, ?2, ?3)')
    .bind(fra, tekst, nå()).run();

/** Av de id-ene som ble bedt om: de som faktisk ligger og venter på å sendes. */
async function ventendeVedlegg(env, ider) {
  const merker = ider.map((_, i) => `?${i + 1}`).join(',');
  const rader = await env.DB
    .prepare(`SELECT id FROM filer WHERE melding = 0 AND id IN (${merker})`).bind(...ider).all();
  const finnes = new Set((rader.results ?? []).map((r) => r.id));
  // Rekkefølgen forfatteren valgte dem i, ikke den databasen kom på.
  return ider.filter((id) => finnes.has(id));
}

/**
 * Samme, men med vedlegg som allerede ligger i lageret og venter (`melding = 0`).
 *
 * Bytene kan ikke reise sammen med teksten, så de lastes opp først og festes
 * her. Returnerer id-en til meldingen.
 */
async function leggMeldingMedVedlegg(env, fra, tekst, vedlegg) {
  await leggMelding(env, fra, tekst);
  const rad = await env.DB.prepare('SELECT id FROM meldinger ORDER BY id DESC LIMIT 1').first();
  if (vedlegg.length) {
    const merker = vedlegg.map((_, i) => `?${i + 2}`).join(',');
    await env.DB
      .prepare(`UPDATE filer SET melding = ?1 WHERE melding = 0 AND id IN (${merker})`)
      .bind(rad.id, ...vedlegg).run();
  }
  return rad.id;
}

/* ---------- innlogging ---------- */

async function loggInn(req, env, ctx) {
  const ip = req.headers.get('CF-Connecting-IP') || 'ukjent';
  const time = new Date(Date.now() - 3600000).toISOString();

  const teller = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM forsok WHERE ip = ?1 AND kl > ?2')
    .bind(ip, time)
    .first();
  if ((teller?.n ?? 0) >= 10) {
    return feil('For mange forsøk. Prøv igjen om en time.', 429);
  }

  const { hvem, kode } = await req.json().catch(() => ({}));
  const fasit = hvem === FORFATTER ? env.KODE_FORFATTER : hvem === LESER ? env.KODE_LESER : null;

  // Er koden byttet inne i appen, er det den som gjelder. Hemmeligheten fra
  // oppsettet er bare utgangspunktet, ikke fasiten for alltid.
  const byttet = fasit ? await lesOppsett(env, `kode_${hvem}`) : null;
  const stemmer = byttet
    ? await stemmerKode(kode ?? '', byttet)
    : Boolean(fasit) && likeStrenger(kode ?? '', fasit);

  if (!stemmer) {
    await env.DB.prepare('INSERT INTO forsok (ip, kl) VALUES (?1, ?2)').bind(ip, nå()).run();
    return feil('Feil kode.', 401);
  }

  await env.DB.prepare('DELETE FROM forsok WHERE ip = ?1').bind(ip).run();
  // At forfatteren kommer inn er verdt å vite om. Leseren logger jo inn hos seg selv.
  if (hvem === FORFATTER && env.AKTIV_VARSEL !== 'nei') {
    send(env, ctx, HENDELSER.innlogging(), true);
  }
  const token = await lagToken(hvem, env.SESJON_HEMMELIG);
  return json({ hvem }, 200, { 'Set-Cookie': settCookie(token) });
}

/* ---------- tilstand ---------- */

/**
 * Uka mot forrige uke. Ikke for å score noen, men for å se om det er en
 * retning – en enkelt dårlig dag sier lite, fjorten gjør det.
 */
function ukesbilde(dager, dato) {
  const snitt = (liste) =>
    (liste.length ? liste.reduce((s, d) => s + d.humor, 0) / liste.length : null);
  const iVinduet = (fra, til) => dager.filter((d) => {
    const n = dagerMellom(d.dato, dato);
    return !d.privat && n >= fra && n < til;
  });
  const denne = iVinduet(0, 7);
  const forrige = iVinduet(7, 14);
  return {
    snitt: snitt(denne),
    forrige_snitt: snitt(forrige),
    ført: denne.length,
    tunge: denne.filter((d) => d.humor <= 2).length,
    gode: denne.filter((d) => d.humor >= 4).length,
    behov: denne.filter((d) => d.behov).map((d) => d.behov),
  };
}

async function fellesTilstand(env) {
  const dato = idag(env);
  const grense = sisteDager(dato, HISTORIKK_DAGER).at(-1);

  const [dager, meldinger, onsker, brev] = await Promise.all([
    env.DB.prepare('SELECT * FROM dager WHERE dato >= ?1 ORDER BY dato DESC').bind(grense).all(),
    env.DB.prepare('SELECT * FROM meldinger ORDER BY id DESC LIMIT 60').all(),
    env.DB.prepare('SELECT * FROM onsker ORDER BY gjort_kl IS NOT NULL, id DESC').all(),
    env.DB.prepare('SELECT * FROM brev ORDER BY id').all(),
  ]);

  const vedlegg = await env.DB
    .prepare('SELECT id, melding, slag, type FROM filer WHERE melding > 0 ORDER BY laget_kl').all();
  const påMeldingen = new Map();
  for (const f of (vedlegg.results ?? [])) {
    if (!påMeldingen.has(f.melding)) påMeldingen.set(f.melding, []);
    påMeldingen.get(f.melding).push({ id: f.id, slag: f.slag, type: f.type });
  }

  const reaksjoner = await env.DB.prepare('SELECT melding, hvem, tegn FROM reaksjoner').all();
  const påMelding = new Map();
  for (const r of (reaksjoner.results ?? [])) {
    if (!påMelding.has(r.melding)) påMelding.set(r.melding, []);
    påMelding.get(r.melding).push({ hvem: r.hvem, tegn: r.tegn });
  }

  return {
    dato,
    dager: (dager.results ?? []).map(radTilDag),
    meldinger: (meldinger.results ?? []).reverse()
      .map((m) => ({ ...m, reaksjoner: påMelding.get(m.id) ?? [], filer: påMeldingen.get(m.id) ?? [] })),
    onsker: onsker.results ?? [],
    brev: brev.results ?? [],
    behov: BEHOV,
  };
}

async function tilstandForfatter(env) {
  const f = await fellesTilstand(env);
  const alle = f.dager;
  const dag = alle.find((d) => d.dato === f.dato) ?? null;

  return {
    hvem: FORFATTER,
    dato: f.dato,
    idag: await medFiler(env, dag, true),
    sporsmal: sporsmalFor(f.dato),
    // Forfatterens egen historikk er forfatterens egen: også de private dagene har farge.
    historikk: alle.map((d) => ({ dato: d.dato, humor: d.humor, privat: d.privat })),
    ifjor: alle.find((d) => d.dato === sammeDagIFjor(f.dato)) ?? null,
    uke: ukesbilde(alle, f.dato),
    // Alt forfatteren har skrevet, ikke bare det som får plass i historikkvinduet.
    // Ellers hopper glasset nedover når forfatteren laster appen på nytt.
    antall_gode_ting: await antallGodeTing(env),
    dager_i_ar: alle.filter((d) => d.dato.startsWith(f.dato.slice(0, 4))).length,
    meldinger: f.meldinger,
    onsker: f.onsker,
    brev: f.brev.filter((b) => !b.apnet_kl).map(({ id, laget_kl }) => ({ id, laget_kl })),
    behov: f.behov,
    delt: await erDelt(env),
    kan_bytte_egen: true,
  };
}

async function tilstandLeser(env) {
  const f = await fellesTilstand(env);
  const alle = f.dager;
  const delt = await erDelt(env);

  const merkede = [];
  for (const d of alle) {
    if (!delt && (d.privat || !d.del_gode)) continue;
    for (const g of d.gode_ting) if (g.merket) merkede.push({ dato: d.dato, tekst: g.tekst });
  }

  return {
    hvem: LESER,
    dato: f.dato,
    idag: await medFiler(env, forLeseren(alle.find((d) => d.dato === f.dato) ?? null, delt), delt),
    sporsmal: sporsmalFor(f.dato),
    siste: alle.slice(0, 14).map((d) => forLeseren(d, delt)),
    historikk: alle.map((d) => ({
      dato: d.dato,
      humor: !delt && d.privat ? null : d.humor,
      privat: d.privat && !delt,
    })),
    uke: ukesbilde(alle, f.dato),
    merket: merkede,
    meldinger: f.meldinger,
    onsker: f.onsker,
    brev: f.brev.map(({ id, laget_kl, apnet_kl }) => ({ id, laget_kl, apnet_kl })),
    sist_skrevet: alle[0]?.dato ?? null,
    behov: f.behov,
    delt,
    // På serveren er koden bare en nøkkel til døra, ikke til innholdet. Da
    // kan den settes på nytt uten at noe går tapt.
    kan_bytte_andres: true,
    kan_bytte_egen: true,
  };
}

/* ---------- skriving ---------- */

async function lagreDag(kropp, env, ctx) {
  const dato = typeof kropp.dato === 'string' ? kropp.dato : idag(env);

  // Dager som ikke har vært, kan ikke føres. Bakover er det åpent – det er
  // ofte lenge etterpå man husker at noe var verdt å skrive ned.
  const avstand = dagerMellom(dato, idag(env));
  const maksTilbake = Number(env.MAKS_TILBAKE) || 3650;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato) || avstand < 0 || avstand > maksTilbake) {
    return feil('Datoen må være i dag eller tidligere.', 400);
  }

  const delt = await erDelt(env);
  const r = ryddDag(kropp, delt);
  const tid = nå();
  const fraFør = await hentDag(env, dato);

  await env.DB.prepare(`
    INSERT INTO dager (dato, humor, gode_ting, tungt, behov, del_gode, del_tungt, privat, skrevet_kl, endret_kl)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
    ON CONFLICT(dato) DO UPDATE SET
      humor = ?2, gode_ting = ?3, tungt = ?4, behov = ?5,
      del_gode = ?6, del_tungt = ?7, privat = ?8, endret_kl = ?9
  `).bind(
    dato, r.humor, JSON.stringify(r.gode_ting), r.tungt, r.behov,
    r.del_gode, r.del_tungt, r.privat, tid,
  ).run();

  const svaret = String(kropp?.svar ?? '').trim().slice(0, 1000);
  if (svaret) {
    await env.DB.prepare(`INSERT INTO svar (dato, sporsmal, tekst, skrevet_kl) VALUES (?1, ?2, ?3, ?4)
                          ON CONFLICT(dato) DO UPDATE SET sporsmal = ?2, tekst = ?3`)
      .bind(dato, sporsmalFor(dato), svaret, tid).run();
  } else {
    await env.DB.prepare('DELETE FROM svar WHERE dato = ?1').bind(dato).run();
  }

  const dag = await hentDag(env, dato);
  const igår = await hentDag(env, sisteDager(dato, 2).at(-1));
  const sendt = await env.DB.prepare('SELECT slag FROM varsler WHERE dato = ?1').bind(dato).all();

  const sendteNå = [];

  // En dag som fylles ut på nytt er en endring, ikke en ny dag. Den sier fra
  // én gang – ellers ville hvert lille tastetrykk blitt et varsel.
  if (fraFør && !dag.privat) {
    const endret = `✏️ Endret ${avstand === 0 ? 'dagen i dag' : norskDato(dato, true)}.\n\n${melding('dagen', dag)}`;
    await sendEnGang(env, ctx, `endret:${nå().slice(0, 13)}`, dato, endret, true);
  }

  if (avstand > 1) {
    // «Ring meg» fra en dag for tre uker siden er ikke et rop om hjelp, det er
    // et minne. Gamle dager får én stille beskjed, ikke alarmene.
    if (!dag.privat
      && await sendEnGang(env, ctx, 'etterslep', dato,
        HENDELSER.etterslep(norskDato(dato, true), dag.humor), true)) {
      sendteNå.push('etterslep');
    }
  } else {
    const skalSendes = varslerForDag({
      dag,
      igår,
      sendt: (sendt.results ?? []).map((x) => x.slag),
    });
    for (const v of skalSendes) {
      if (await sendEnGang(env, ctx, v.slag, dato, v.tekst, v.stille, v.knapper)) sendteNå.push(v.slag);
    }
  }

  // Milepæler telles på alt forfatteren har skrevet, uansett når dagen var.
  //
  // To feller her. Rettes en dag som alt fantes, er det bare forskjellen som
  // er ny – ikke hele dagen på nytt. Og låsen må være felles for alle datoer:
  // står den på dagens dato, fyrer den samme milepælen igjen i morgen.
  const antall = await antallGodeTing(env);
  const før = antall - r.gode_ting.length + (fraFør?.gode_ting.length ?? 0);
  const nådd = milepælFor(antall, før);
  if (nådd) await sendEnGang(env, ctx, `milepel:${nådd}`, MILEPÆLSLÅS, milepæl(nådd), false);

  return json({ dag, sendt: sendteNå, var_ny: !fraFør, antall_gode_ting: antall });
}

/** Alt forfatteren har skrevet, talt opp. Tabellen er liten nok til å leses helt. */
async function antallGodeTing(env) {
  const rader = await env.DB.prepare('SELECT gode_ting FROM dager').all();
  return (rader.results ?? []).reduce((n, r) => {
    try {
      return n + JSON.parse(r.gode_ting || '[]').length;
    } catch {
      return n;
    }
  }, 0);
}

/** Én tilfeldig god ting fra før i tiden. Helst noe forfatteren har rukket å glemme. */
async function trekkLapp(env, forrige = null) {
  const dato = idag(env);
  const grense = sisteDager(dato, 15).at(-1);
  const gamle = await env.DB
    .prepare('SELECT dato, gode_ting FROM dager WHERE dato < ?1 AND gode_ting != ?2')
    .bind(grense, '[]').all();
  // Helst noe forfatteren har rukket å glemme – men er det bare én gammel lapp, blir
  // det den samme hver gang, og da ser glasset tomt ut. Da tas alt med.
  const alt = await env.DB
    .prepare('SELECT dato, gode_ting FROM dager WHERE gode_ting != ?1').bind('[]').all();
  const gamleRader = gamle.results ?? [];
  const antallGamle = gamleRader.reduce((n, r) => {
    try {
      return n + JSON.parse(r.gode_ting || '[]').length;
    } catch {
      return n;
    }
  }, 0);
  const rader = antallGamle >= 3 ? gamleRader : (alt.results ?? []);

  const lapper = [];
  for (const rad of rader) {
    try {
      for (const g of JSON.parse(rad.gode_ting || '[]')) {
        if (g?.tekst) lapper.push({ dato: rad.dato, tekst: g.tekst, merket: Boolean(g.merket) });
      }
    } catch { /* en ødelagt rad skal ikke stoppe resten */ }
  }
  if (!lapper.length) return { tom: true };

  // Trekkes den samme lappen om igjen, ser det ut som glasset er tomt. Den
  // forrige holdes utenfor når det finnes noe annet å ta.
  const utenom = lapper.filter((l) => l.tekst !== forrige);
  const blant = utenom.length ? utenom : lapper;
  const valgt = blant[Math.floor(Math.random() * blant.length)];
  return { ...valgt, når: norskDato(valgt.dato, true), av: blant.length };
}

/** Alt som er skrevet, søkbart. Leseren ser bare det som er delt. */
async function arkiv(env, hvem, url) {
  const delt = await erDelt(env);
  const sok = (url.searchParams.get('sok') ?? '').trim().toLowerCase();
  const bareMerket = url.searchParams.get('merket') === 'ja';
  const rader = await env.DB.prepare('SELECT * FROM dager ORDER BY dato DESC').all();

  const ut = [];
  if (hvem === FORFATTER || delt) {
    const svar = await svarene(env);
    for (const spm of LISTA) {
      const s = svar.get(spm.k);
      if (!s) continue;
      if (bareMerket && spm.kat !== 'nare') continue;
      if (sok && !s.tekst.toLowerCase().includes(sok) && !spm.t.toLowerCase().includes(sok)) continue;
      ut.push({
        dato: s.skrevet_kl.slice(0, 10),
        tekst: s.tekst,
        sporsmal: spm.t,
        merket: spm.kat === 'nare',
        privat: false,
      });
    }
  }

  for (const rad of (rader.results ?? [])) {
    const dag = radTilDag(rad);
    if (hvem !== FORFATTER && !delt && (dag.privat || !dag.del_gode)) continue;
    for (const g of dag.gode_ting) {
      if (!g?.tekst) continue;
      if (bareMerket && !g.merket) continue;
      if (sok && !g.tekst.toLowerCase().includes(sok)) continue;
      ut.push({ dato: dag.dato, tekst: g.tekst, merket: Boolean(g.merket), privat: dag.privat });
    }
  }
  return json({ treff: ut.slice(0, 400), antall: ut.length });
}

/* ---------- bilder og lyd ---------- */

const MAKS_FIL = 8 * 1024 * 1024;
const TYPER = {
  bilde: ['image/jpeg', 'image/png', 'image/webp'],
  lyd: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'],
};

/** Filene som hører til én eller flere dager. */
async function filerFor(env, datoer) {
  if (!datoer.length) return new Map();
  const merker = datoer.map((_, i) => `?${i + 1}`).join(',');
  const rader = await env.DB
    .prepare(`SELECT id, dato, slag, type FROM filer
              WHERE melding IS NULL AND dato IN (${merker}) ORDER BY laget_kl`)
    .bind(...datoer).all();
  const kart = new Map(datoer.map((d) => [d, []]));
  for (const r of (rader.results ?? [])) kart.get(r.dato)?.push(r);
  return kart;
}

/**
 * Henger filene på en dag.
 *
 * På en privat dag får bare forfatteren lista. At det ligger et bilde der er i seg
 * selv noe forfatteren ikke har delt – og en id er nok til å spørre etter det.
 */
async function medFiler(env, dag, egen) {
  if (!dag) return dag;
  const sporsmal = sporsmalFor(dag.dato);
  if (!egen && dag.privat) return { ...dag, filer: [], sporsmal };
  const [kart, svaret] = await Promise.all([
    filerFor(env, [dag.dato]),
    env.DB.prepare('SELECT tekst FROM svar WHERE dato = ?1').bind(dag.dato).first(),
  ]);
  return { ...dag, filer: kart.get(dag.dato) ?? [], sporsmal, svar: svaret?.tekst ?? null };
}

/**
 * Tar imot rå bytes og legger dem i lageret.
 *
 * @param {number|null} melding `null` for en dag, `0` for et vedlegg som
 *   ennå ikke er sendt.
 */
async function taImotFil(req, env, dato, slag, melding) {
  const type = (req.headers.get('Content-Type') ?? '').split(';')[0].trim();
  const data = await req.arrayBuffer();
  return lagreBytes(env, { data, dato, slag, type, melding });
}

/** Selve lagringen. Bytene kan komme fra appen eller fra Telegram. */
async function lagreBytes(env, { data, dato, slag, type, melding }) {
  if (!TYPER[slag].includes(type)) return { feil: `Ikke en fil vi kan ta imot: ${type}`, status: 415 };
  if (!data.byteLength) return { feil: 'Tom fil.', status: 400 };
  if (data.byteLength > MAKS_FIL) return { feil: 'Fila er for stor. Maks 8 MB.', status: 413 };

  const id = crypto.randomUUID();
  await env.FILER.put(`fil:${id}`, data, { metadata: { type, slag } });
  await env.DB
    .prepare(`INSERT INTO filer (id, dato, slag, type, storrelse, laget_kl, melding)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(id, dato, slag, type, data.byteLength, nå(), melding).run();
  return { id, slag, type, data };
}

async function lagreFil(req, env, ctx, url) {
  const dato = url.searchParams.get('dato') || idag(env);
  const slag = url.searchParams.get('slag') === 'lyd' ? 'lyd' : 'bilde';
  // Samme grense som for dagene selv: bakover så langt man vil, aldri framover.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato) || dagerMellom(dato, idag(env)) < 0) {
    return feil('Ugyldig dato.', 400);
  }

  const lagret = await taImotFil(req, env, dato, slag, null);
  if (lagret.feil) return feil(lagret.feil, lagret.status);
  const { id, data, type } = lagret;

  // Delte dager sender fila videre. En privat dag gjør det ikke.
  const dag = await hentDag(env, dato);
  if ((!dag || !dag.privat) || await erDelt(env)) {
    const oppgave = slag === 'bilde'
      ? sendFil(env, 'sendPhoto', 'photo', data, { navn: 'bilde.jpg', tekst: `📷 Bilde – ${norskDato(dato)}` })
      : sendFil(env, 'sendAudio', 'audio', data, { navn: 'lydklipp', tekst: `🎙 Lydklipp – ${norskDato(dato)}` });
    if (ctx?.waitUntil) ctx.waitUntil(oppgave);
  }
  return json({ id, dato, slag, type });
}

/** Alt som finnes, som én fil. Data man ikke kan få ut, kan man miste. */
async function eksport(env, hvem) {
  const delt = await erDelt(env);
  const [dager, meldinger, onsker, brev, filer] = await Promise.all([
    env.DB.prepare('SELECT * FROM dager ORDER BY dato').all(),
    env.DB.prepare('SELECT * FROM meldinger ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM onsker ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM brev ORDER BY id').all(),
    env.DB.prepare('SELECT id, dato, slag, type, storrelse FROM filer ORDER BY laget_kl').all(),
  ]);

  const alle = (dager.results ?? []).map(radTilDag);
  return {
    laget: nå(),
    for: hvem,
    dager: hvem === FORFATTER ? alle : alle.map((d) => forLeseren(d, delt)),
    meldinger: meldinger.results ?? [],
    onsker: onsker.results ?? [],
    brev: hvem === FORFATTER ? (brev.results ?? []).map(({ tekst, ...r }) => r) : (brev.results ?? []),
    filer: filer.results ?? [],
  };
}

/* ---------- spørsmålslista ---------- */

const svarene = async (env) => {
  const rader = await env.DB.prepare('SELECT nokkel, tekst, skrevet_kl FROM sporsmalsvar').all();
  return new Map((rader.results ?? []).map((r) => [r.nokkel, r]));
};

/**
 * Tre spørsmål om gangen, fra den kategorien forfatteren har valgt.
 *
 * Seksti spørsmål i en liste er en oppgave. Tre er et tilbud – og de byttes
 * ut hver gang det bes om nye, eller når ett av dem er besvart.
 */
async function sporsmalslista(env, url) {
  const kat = Object.hasOwn(KATEGORIER, url.searchParams.get('kat')) ? url.searchParams.get('kat') : null;
  const svar = await svarene(env);

  const iKategorien = LISTA.filter((s) => !kat || s.kat === kat);
  const usvarte = iKategorien.filter((s) => !svar.has(s.k));
  // Stokkes, så det ikke er de tre samme hver gang forfatteren kommer tilbake.
  for (let i = usvarte.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [usvarte[i], usvarte[j]] = [usvarte[j], usvarte[i]];
  }

  // Forfatteren bestemmer hvor mange forfatteren orker å se. Tre er et tilbud, tretti er en
  // liste – og bare den som skriver vet hvilket av dem det er humør til.
  const ønsket = Number(url.searchParams.get('antall'));
  const antall = [3, 10, 20, 30].includes(ønsket) ? ønsket : 3;

  return json({
    kategorier: KATEGORIER,
    kat,
    antall,
    forslag: usvarte.slice(0, antall),
    igjen: usvarte.length,
    ferdig: iKategorien.length - usvarte.length,
    svarte: LISTA
      .filter((s) => svar.has(s.k))
      .map((s) => ({ ...s, svar: svar.get(s.k).tekst, skrevet_kl: svar.get(s.k).skrevet_kl }))
      .reverse(),
  });
}

/* ---------- sammendrag ---------- */

/** Uke, måned eller år – tall og forfatterens egne ord, ikke tolkninger. */
async function sammendrag(env, hvem, url) {
  const til = idag(env);
  const lengde = { uke: 7, maned: 30, ar: 365 }[url.searchParams.get('periode')] ?? 7;
  const fra = sisteDager(til, lengde).at(-1);
  const delt = await erDelt(env);

  const rader = await env.DB
    .prepare('SELECT * FROM dager WHERE dato >= ?1 AND dato <= ?2 ORDER BY dato')
    .bind(fra, til).all();
  const alle = (rader.results ?? []).map(radTilDag);
  const synlige = hvem === FORFATTER || delt ? alle : alle.filter((d) => !d.privat);
  const åpne = synlige.filter((d) => !d.privat || hvem === FORFATTER || delt);

  const medHumør = åpne.filter((d) => Number.isFinite(d.humor));
  const beste = medHumør.reduce((b, d) => (!b || d.humor > b.humor ? d : b), null);
  const tyngste = medHumør.reduce((b, d) => (!b || d.humor < b.humor ? d : b), null);

  const behov = new Map();
  for (const d of åpne) if (d.behov) behov.set(d.behov, (behov.get(d.behov) ?? 0) + 1);

  const gode = åpne.flatMap((d) => d.gode_ting);
  const filer = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM filer
              WHERE melding IS NULL AND dato >= ?1 AND dato <= ?2`).bind(fra, til).first();

  const kort = (d) => (d ? { dato: d.dato, humor: d.humor, gode_ting: d.gode_ting } : null);

  return json({
    fra,
    til,
    periode: url.searchParams.get('periode') ?? 'uke',
    ført: alle.length,
    private: alle.length - åpne.length,
    snitt: medHumør.length ? medHumør.reduce((n, d) => n + d.humor, 0) / medHumør.length : null,
    gode_dager: medHumør.filter((d) => d.humor >= 4).length,
    tunge_dager: medHumør.filter((d) => d.humor <= 2).length,
    beste: kort(beste),
    tyngste: tyngste && beste && tyngste.dato !== beste.dato ? kort(tyngste) : null,
    behov: [...behov].sort((a, b) => b[1] - a[1]).map(([n, antall]) => ({ behov: n, antall })),
    antall_gode_ting: gode.length,
    merket: gode.filter((g) => g.merket).length,
    antall_bilder: filer?.n ?? 0,
  });
}

/* ---------- det boten kan fortelle ---------- */

async function tekstDag(env, dato) {
  const delt = await erDelt(env);
  const dag = await medFiler(env, forLeseren(await hentDag(env, dato), delt), delt);
  return dagsrapport(dag, dato === idag(env) ? 'i dag' : norskDato(dato, true));
}

const tekstIdag = (env) => tekstDag(env, idag(env));

async function tekstUke(env) {
  const dato = idag(env);
  const rader = await env.DB
    .prepare('SELECT * FROM dager WHERE dato >= ?1 ORDER BY dato DESC')
    .bind(sisteDager(dato, 14).at(-1)).all();
  const dager = (rader.results ?? []).map(radTilDag);
  const uke = ukesbilde(dager, dato);
  if (!uke.ført) return '🫙 Ingen dager ført denne uka ennå.';
  const gode = dager
    .filter((d) => !d.privat && dagerMellom(d.dato, dato) < 7)
    .reduce((n, d) => n + d.gode_ting.length, 0);
  return ukesbrev(uke, gode);
}

async function tekstStatus(env) {
  const [sist, sistAktiv, uleste, brev, onsker] = await Promise.all([
    env.DB.prepare('SELECT dato FROM dager ORDER BY dato DESC LIMIT 1').first(),
    env.DB.prepare("SELECT sendt_kl FROM varsler WHERE slag = 'aktiv' ORDER BY sendt_kl DESC LIMIT 1").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM meldinger WHERE fra = 'leser' AND lest_kl IS NULL").first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM brev WHERE apnet_kl IS NULL').first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM onsker WHERE gjort_kl IS NULL').first(),
  ]);
  const linjer = statuslinje({
    sist: sist ? norskDato(sist.dato, true) : null,
    sistAktiv: sistAktiv ? norskDato(sistAktiv.sendt_kl.slice(0, 10), true) : null,
    uleste: uleste?.n ?? 0,
    brev: brev?.n ?? 0,
    onsker: onsker?.n ?? 0,
  });
  return `${linjer}\n\nDeling: ${await erDelt(env) ? 'alt deles' : 'forfatteren velger dag for dag'}`;
}

async function tekstGlasset(env) {
  const lapp = await trekkLapp(env);
  return lapp.tom
    ? '🫙 Glasset er tomt ennå. Det fyller seg opp.'
    : `🫙 «${lapp.tekst}»\n\n${lapp.når}`;
}

/** Sammendraget for en periode, som tekst. */
async function tekstSammendrag(env, periode) {
  const url = new URL(`https://x/?periode=${periode}`);
  const d = await (await sammendrag(env, LESER, url)).json();
  return d.ført ? sammendragstekst(d, BEHOV) : '🫙 Ingenting ført i denne perioden.';
}

/** Hvor langt forfatteren er kommet i sin egen spørsmålsliste. */
async function tekstSporsmal(env) {
  const d = await (await sporsmalslista(env, new URL('https://x/'))).json();
  const svar = await svarene(env);
  const perKategori = {};
  for (const nokkel of Object.keys(KATEGORIER)) {
    const i = LISTA.filter((spm) => spm.kat === nokkel);
    perKategori[nokkel] = { alle: i.length, ferdig: i.filter((spm) => svar.has(spm.k)).length };
  }
  return sporsmalstekst({ ...d, perKategori });
}

/** Ønskelista, med en knapp per ting så den kan hukes av herfra. */
async function ønskeskjerm(env) {
  const rader = await env.DB.prepare('SELECT * FROM onsker ORDER BY gjort_kl IS NOT NULL, id DESC').all();
  const onsker = rader.results ?? [];
  const knapper = onsker.slice(0, 8).map((o) =>
    [[`${o.gjort_kl ? '✓' : '○'} ${o.tekst.slice(0, 40)}`, `onske:${o.id}`]]);
  return { tekst: onskeliste(onsker), knapper: [...knapper, ...TILBAKE] };
}

async function tekstBrev(env) {
  const rad = await env.DB.prepare('SELECT COUNT(*) AS n FROM brev WHERE apnet_kl IS NULL').first();
  return [
    `💌 ${rad?.n ?? 0} brev ligger klare.`,
    '',
    'Forfatteren får tilbud om ett når dagen er tung.',
    'Legg inn et nytt med «/brev <tekst>».',
  ].join('\n');
}

/** Hele lageret som én fil i Telegram. */
async function sendEksport(env, chat) {
  const data = new TextEncoder().encode(JSON.stringify(await eksport(env, LESER), null, 2));
  return sendFil(env, 'sendDocument', 'document', data, {
    navn: `dagbok-${idag(env)}.json`,
    tekst: '⬇️ Alt som ligger i appen, akkurat nå.',
    chat,
  });
}

/** Én engangslenke, til leseren eller til forfatteren. */
async function engangslenke(env, hvem, origin) {
  const token = await lagToken(hvem, `${env.SESJON_HEMMELIG}:lenke`, Date.now(), 900000);
  await skrivOppsett(env, hvem === FORFATTER ? 'lenke_forfatter' : 'lenke', token);
  const lenke = `${origin}/api/lenke?t=${token}`;
  return hvem === FORFATTER
    ? `🔗 Lenke til forfatteren – et kvarter, én gang. Send den videre.\n\n${lenke}`
    : `🔑 Her, gyldig i et kvarter og bare én gang:\n\n${lenke}`;
}

/** Hva en menyknapp skal vise. */
async function menyskjerm(env, valg, origin) {
  if (valg === 'onsker') return ønskeskjerm(env);

  // Sammendraget har tre perioder å velge mellom, i den samme meldingen.
  if (valg === 'sammendrag' || valg.startsWith('sammendrag:')) {
    const periode = valg.split(':')[1] ?? 'uke';
    return { tekst: await tekstSammendrag(env, periode), knapper: [...PERIODER, ...TILBAKE] };
  }
  const tekst = {
    hjem: async () => MENYTEKST,
    idag: () => tekstIdag(env),
    uke: () => tekstUke(env),
    status: () => tekstStatus(env),
    glasset: () => tekstGlasset(env),
    brev: () => tekstBrev(env),
    sporsmal: () => tekstSporsmal(env),
    logginn: () => engangslenke(env, LESER, origin),
    lenkeforfatter: () => engangslenke(env, FORFATTER, origin),
  }[valg];
  if (!tekst) return null;
  return {
    tekst: await tekst(),
    knapper: valg === 'hjem' ? MENY : (valg === 'glasset'
      ? [[['🫙 Trekk en til', 'meny:glasset']], ...TILBAKE]
      : TILBAKE),
  };
}

/* ---------- Telegram inn ---------- */

const KOMMANDOER = [
  '📓 Dagbok',
  '',
  '/idag – dagen forfatterens så langt',
  '/uke – uka samlet',
  '/status – hvor ting står',
  '/glasset – trekk en lapp fra glasset',
  '',
  '/si <tekst> – send en melding til forfatteren',
  'Send et bilde eller en talemelding hit, så havner det i samtalen.',
  '/brev <tekst> – legg inn et brev til en dårlig dag',
  '/onske <tekst> – legg til på ønskelista',
  '/onsker – vis ønskelista',
  '',
  '/logginn – engangslenke rett inn i appen',
  '/logginn forfatter – engangslenke du kan sende til forfatteren',
  '/kode <ny kode> – sett ny kode for forfatteren',
  '/hjelp – denne lista',
  '',
  'Du kan også svare på en melding fra meg, så går den rett til forfatteren.',
].join('\n');

const svarTil = (env, ctx, chat, tekst) => {
  const oppgave = sendTelegram(env, tekst, { stille: true, chat });
  if (ctx?.waitUntil) ctx.waitUntil(oppgave);
};

/**
 * Svar fra Telegram.
 *
 * To lag holder fremmede ute: Telegram sender en hemmelighet bare den og vi
 * kjenner, og bare kontoen som én gang har sagt leserens kode, blir hørt på.
 * Alt annet svares det høflig ja til og gjøres ingenting med – en webhook som
 * klager, forteller bare den som prøver at den fant noe.
 */
/**
 * Finner ut om meldingen fra Telegram har et vedlegg vi kan ta imot.
 *
 * Et bilde kommer i flere størrelser; vi tar den største som får plass. Lyd
 * kommer som `voice` (talemelding) eller `audio` (en fil).
 */
function telegramVedlegg(melding) {
  if (melding.photo?.length) {
    const brukbare = melding.photo.filter((f) => (f.file_size ?? 0) <= MAKS_FIL);
    const størst = (brukbare.length ? brukbare : melding.photo).at(-1);
    return { fil_id: størst.file_id, slag: 'bilde', type: 'image/jpeg' };
  }
  const lyd = melding.voice ?? melding.audio;
  if (lyd) {
    const type = TYPER.lyd.includes(lyd.mime_type) ? lyd.mime_type : 'audio/ogg';
    return { fil_id: lyd.file_id, slag: 'lyd', type };
  }
  return null;
}

async function fraTelegram(req, env, ctx, origin) {
  if (!env.TELEGRAM_WEBHOOK_HEMMELIG
    || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_HEMMELIG) {
    return feil('Nei.', 401);
  }

  const oppd = await req.json().catch(() => ({}));
  const melding = oppd.message;
  const trykk = oppd.callback_query;
  const avsender = melding?.from?.id ?? trykk?.from?.id;
  const chat = melding?.chat?.id ?? trykk?.message?.chat?.id;
  if (!avsender) return json({ ok: true });

  const tekst = (melding?.text ?? '').trim();
  const eier = await lesOppsett(env, 'eier');

  // Den første som sier koden, blir eier. Etter det er det bare leseren.
  if (!eier) {
    if (tekst.startsWith('/eier ') && likeStrenger(tekst.slice(6).trim(), env.KODE_LESER)) {
      await skrivOppsett(env, 'eier', avsender);
      svarTil(env, ctx, chat, `Takk. Herfra er det bare deg jeg hører på.\n\n${KOMMANDOER}`);
    } else if (tekst.startsWith('/')) {
      svarTil(env, ctx, chat, 'Send «/eier <koden din>» én gang, så vet jeg hvem du er.');
    }
    return json({ ok: true });
  }
  if (String(avsender) !== String(eier)) return json({ ok: true });

  /* --- trykk på en knapp --- */
  if (trykk) {
    const data = String(trykk.data ?? '');
    const melding_id = trykk.message?.message_id;
    const kvitter = (t) => ctx?.waitUntil?.(kvitterTrykk(env, trykk.id, t ?? ''));

    if (data.startsWith('svar:')) {
      const valg = SVAR[data.slice(5)];
      if (valg) {
        await leggMelding(env, LESER, valg.melding);
        kvitter('Sendt');
        ctx?.waitUntil?.(byttUtKnapper(env, chat, melding_id, `✓ ${valg.knapp}`));
      } else kvitter();
      return json({ ok: true });
    }

    if (data === 'meny:eksport') {
      kvitter('Sender fila …');
      ctx?.waitUntil?.(sendEksport(env, chat));
      return json({ ok: true });
    }

    if (data.startsWith('meny:')) {
      const skjerm = await menyskjerm(env, data.slice(5), origin);
      if (skjerm) ctx?.waitUntil?.(endreMelding(env, chat, melding_id, skjerm.tekst, skjerm.knapper));
      kvitter();
      return json({ ok: true });
    }

    // Huk av et ønske uten å åpne appen. Lista tegnes på nytt i samme melding.
    if (data.startsWith('onske:')) {
      const id = Number(data.slice(6));
      const rad = await env.DB.prepare('SELECT gjort_kl FROM onsker WHERE id = ?1').bind(id).first();
      if (rad) {
        await env.DB.prepare('UPDATE onsker SET gjort_kl = ?1, gjort_av = ?2 WHERE id = ?3')
          .bind(rad.gjort_kl ? null : nå(), rad.gjort_kl ? null : LESER, id).run();
      }
      const skjerm = await ønskeskjerm(env);
      ctx?.waitUntil?.(endreMelding(env, chat, melding_id, skjerm.tekst, skjerm.knapper));
      kvitter();
      return json({ ok: true });
    }

    kvitter();
    return json({ ok: true });
  }

  /* --- bilde eller lydklipp leseren sender boten --- */
  const sendtFil = melding && telegramVedlegg(melding);
  if (sendtFil) {
    const hentet = await hentFraTelegram(env, sendtFil.fil_id);
    if (!hentet) {
      svarTil(env, ctx, chat, 'Fikk ikke hentet fila fra Telegram. Prøv en gang til.');
      return json({ ok: true });
    }
    const lagret = await lagreBytes(env, {
      data: hentet.data,
      dato: idag(env),
      slag: sendtFil.slag,
      type: sendtFil.type,
      melding: 0,
    });
    if (lagret.feil) {
      svarTil(env, ctx, chat, lagret.feil);
      return json({ ok: true });
    }
    const bildetekst = (melding.caption ?? '').trim().slice(0, 2000);
    await leggMeldingMedVedlegg(env, LESER, bildetekst || (sendtFil.slag === 'lyd' ? '🎙' : '📷'), [lagret.id]);
    svarTil(env, ctx, chat, sendtFil.slag === 'lyd' ? '✓ Lydklippet ligger i samtalen.' : '✓ Bildet ligger i samtalen.');
    return json({ ok: true });
  }

  /* --- kommandoer --- */
  if (tekst === '/meny' || tekst === '/start' || tekst === '/hjelp') {
    const oppgave = sendTelegram(env, MENYTEKST, { stille: true, chat, knapper: MENY });
    if (ctx?.waitUntil) ctx.waitUntil(oppgave);
    return json({ ok: true });
  }

  // Kommandoene viser de samme skjermene som knappene. Man skal kunne bruke
  // begge deler uten å lære to systemer.
  const snarvei = {
    '/idag': 'idag',
    '/uke': 'uke',
    '/sammendrag': 'sammendrag',
    '/maned': 'sammendrag:maned',
    '/ar': 'sammendrag:ar',
    '/sporsmal': 'sporsmal',
    '/status': 'status',
    '/glasset': 'glasset',
    '/onsker': 'onsker',
    '/logginn': 'logginn',
    '/logginn forfatter': 'lenkeforfatter',
    '/logginnforfatter': 'lenkeforfatter',
  }[tekst];

  // Én bestemt dag, for de gangene man lurer på hvordan det var.
  const dagen = tekst.match(/^\/dag\s+(\d{4}-\d{2}-\d{2})$/);
  if (dagen) {
    const oppgave = sendTelegram(env, await tekstDag(env, dagen[1]), { stille: true, chat, knapper: TILBAKE });
    if (ctx?.waitUntil) ctx.waitUntil(oppgave);
    return json({ ok: true });
  }

  if (tekst === '/eksport') {
    if (ctx?.waitUntil) ctx.waitUntil(sendEksport(env, chat));
    return json({ ok: true });
  }

  if (snarvei) {
    const skjerm = await menyskjerm(env, snarvei, origin);
    const oppgave = sendTelegram(env, skjerm.tekst, { stille: true, chat, knapper: skjerm.knapper });
    if (ctx?.waitUntil) ctx.waitUntil(oppgave);
    return json({ ok: true });
  }

  /** Teksten etter kommandoordet, eller tom streng. */
  const etter = (kommando) => (tekst.startsWith(`${kommando} `) ? tekst.slice(kommando.length + 1).trim() : '');

  if (tekst.startsWith('/si ')) {
    const sagt = etter('/si').slice(0, 2000);
    if (sagt) {
      await leggMelding(env, LESER, sagt);
      svarTil(env, ctx, chat, '✓ Sendt.');
    }
    return json({ ok: true });
  }

  if (tekst.startsWith('/onske ')) {
    const ønsket = etter('/onske').slice(0, 200);
    if (ønsket) {
      await env.DB.prepare('INSERT INTO onsker (tekst, laget_av, laget_kl) VALUES (?1, ?2, ?3)')
        .bind(ønsket, LESER, nå()).run();
      svarTil(env, ctx, chat, `✓ Lagt til: ${ønsket}`);
    }
    return json({ ok: true });
  }

  if (tekst.startsWith('/brev ')) {
    const brevet = etter('/brev').slice(0, 4000);
    if (brevet) {
      await env.DB.prepare('INSERT INTO brev (tekst, laget_kl) VALUES (?1, ?2)').bind(brevet, nå()).run();
      svarTil(env, ctx, chat, '✓ Lagt i glasset. Forfatteren får tilbud om det når dagen er tung.');
    }
    return json({ ok: true });
  }

  if (tekst.startsWith('/kode ')) {
    const ny = etter('/kode');
    if (ny.length < 6) {
      svarTil(env, ctx, chat, 'Koden må være minst seks tegn.');
      return json({ ok: true });
    }
    await skrivOppsett(env, `kode_${FORFATTER}`, await lagKode(ny));
    await leggMelding(env, LESER, 'Jeg satte en ny kode for deg her i appen.');
    svarTil(env, ctx, chat, `✓ Ny kode satt for forfatteren. Forfatteren har fått en melding om det.`);
    return json({ ok: true });
  }

  /* --- vanlig tekst ---
     I en gruppe snakker dere også om alt mulig annet, så der må det være et
     svar på noe boten har sagt. I en samtale med boten alene er alt ment hit. */
  const svarPåBoten = Boolean(melding.reply_to_message?.from?.is_bot);
  const aleneMedBoten = melding.chat?.type === 'private';
  if (tekst && !tekst.startsWith('/') && (svarPåBoten || aleneMedBoten)) {
    await leggMelding(env, LESER, tekst.slice(0, 2000));
    svarTil(env, ctx, chat, '✓ Sendt.');
  }
  return json({ ok: true });
}

/** Alt som er skrevet i ett år, samlet måned for måned. */
async function arsboka(env, hvem, url) {
  const ar = (url.searchParams.get('ar') ?? idag(env).slice(0, 4)).slice(0, 4);
  const rader = await env.DB
    .prepare('SELECT * FROM dager WHERE dato >= ?1 AND dato <= ?2 ORDER BY dato')
    .bind(`${ar}-01-01`, `${ar}-12-31`).all();

  const delt = await erDelt(env);
  const måneder = new Map();
  let antall = 0;
  let dager = 0;
  for (const rad of (rader.results ?? [])) {
    const dag = radTilDag(rad);
    if (hvem !== FORFATTER && !delt && (dag.privat || !dag.del_gode)) continue;
    dager += 1;
    const md = dag.dato.slice(0, 7);
    if (!måneder.has(md)) måneder.set(md, []);
    for (const g of dag.gode_ting) {
      if (!g?.tekst) continue;
      antall += 1;
      måneder.get(md).push({ dato: dag.dato, tekst: g.tekst, merket: Boolean(g.merket) });
    }
  }

  return json({
    ar,
    antall,
    dager,
    maneder: [...måneder].filter(([, ting]) => ting.length).map(([maned, ting]) => ({ maned, ting })),
  });
}

/* ---------- ruteren ---------- */

async function api(req, env, url, ctx) {
  const sti = url.pathname.replace(/^\/api/, '');
  const hvem = await lesToken(lesCookie(req, COOKIE), env.SESJON_HEMMELIG);

  if (sti === '/logg-inn' && req.method === 'POST') return loggInn(req, env, ctx);
  if (sti === '/logg-ut') return json({ ok: true }, 200, { 'Set-Cookie': slettCookie() });
  if (sti === '/meg') return json({ hvem });

  // Telegram og engangslenka har ingen informasjonskapsel å vise til.
  if (sti === '/telegram' && req.method === 'POST') return fraTelegram(req, env, ctx, url.origin);

  if (sti === '/lenke' && req.method === 'GET') {
    const t = url.searchParams.get('t') ?? '';
    const gjelder = await lesToken(t, `${env.SESJON_HEMMELIG}:lenke`);
    // Én lenke om gangen per person, og den forsvinner når den er brukt.
    const nøkkel = gjelder === FORFATTER ? 'lenke_forfatter' : 'lenke';
    const lagret = await lesOppsett(env, nøkkel);
    if (!t || !lagret || t !== lagret || !(gjelder === LESER || gjelder === FORFATTER)) {
      return feil('Lenken er brukt opp eller utløpt. Be om en ny.', 401);
    }
    await skrivOppsett(env, nøkkel, '');
    const token = await lagToken(gjelder, env.SESJON_HEMMELIG);
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Set-Cookie': settCookie(token), 'Cache-Control': 'no-store' },
    });
  }

  if (!hvem) return feil('Ikke logget inn.', 401);
  const erForfatter = hvem === FORFATTER;
  // Kroppen kan bare leses én gang, så den leses her og sendes videre som data.
  // Men bare når den faktisk er JSON – et bilde skal leses som bytes, og en
  // kropp som alt er spist, finnes ikke å lese om igjen.
  const erJson = (req.headers.get('Content-Type') ?? '').includes('application/json');
  const kropp = req.method === 'POST' && erJson ? await req.json().catch(() => ({})) : {};
  const tekstFra = (felt, maks) => String(kropp?.[felt] ?? '').trim().slice(0, maks);

  // Ting appen forfatterens sier fra om mens de skjer.
  if (sti === '/hendelse' && req.method === 'POST') {
    if (erForfatter && kropp?.slag === 'begynt' && env.AKTIV_VARSEL !== 'nei') {
      await sendEnGang(env, ctx, 'begynt', idag(env), HENDELSER.begynt(), true);
    }
    return json({ ok: true });
  }

  if (sti === '/tilstand') {
    // At forfatteren er inne, er i seg selv verdt å vite om. Høyst én gang i timen.
    if (erForfatter && env.AKTIV_VARSEL !== 'nei') {
      const tid = new Date();
      const kl = klokke(tid, sone(env));
      // Ett varsel per vindu, ikke ett per fanebytte.
      const vindu = Math.max(5, Number(env.AKTIV_MINUTTER) || 30);
      const bøtte = Math.floor((minutter(kl) ?? 0) / vindu);
      await sendEnGang(env, ctx, 'aktiv', `${idag(env)}#${bøtte}`, erAktiv(kl), true);
    }
    return json(erForfatter ? await tilstandForfatter(env) : await tilstandLeser(env));
  }
  if (sti === '/glasset') return json(await trekkLapp(env, url.searchParams.get('forrige')));

  if (sti === '/fil' && req.method === 'POST') {
    if (!erForfatter) return feil('Bare forfatteren legger til bilder og lyd.', 403);
    return lagreFil(req, env, ctx, url);
  }

  const fil = sti.match(/^\/fil\/([\w-]+)$/);
  if (fil) {
    const rad = await env.DB.prepare('SELECT * FROM filer WHERE id = ?1').bind(fil[1]).first();
    if (!rad) return feil('Fant ikke fila.', 404);

    if (req.method === 'DELETE') {
      // Et vedlegg som ikke er festet til noe ennå, er et utkast. Den som
      // skriver meldingen får angre på det, uansett hvem av de to det er.
      if (!erForfatter && rad.melding !== 0) return feil('Ikke din å slette.', 403);
      await env.FILER.delete(`fil:${rad.id}`);
      await env.DB.prepare('DELETE FROM filer WHERE id = ?1').bind(rad.id).run();
      return json({ ok: true });
    }

    // Et vedlegg hører til samtalen og er delt i kraft av å være sendt.
    // En privat dag har derimot ingen bilder å vise fram.
    if (rad.melding === null && !erForfatter && !(await erDelt(env))) {
      const dag = await hentDag(env, rad.dato);
      if (dag?.privat) return feil('Ikke delt.', 403);
    }
    const data = await env.FILER.get(`fil:${rad.id}`, 'arrayBuffer');
    if (!data) return feil('Fila er borte.', 404);
    return new Response(data, {
      headers: { 'Content-Type': rad.type, 'Cache-Control': 'private, max-age=31536000' },
    });
  }

  if (sti === '/eksport') {
    return json(await eksport(env, hvem), 200, {
      'Content-Disposition': `attachment; filename="dagbok-${idag(env)}.json"`,
    });
  }
  if (sti === '/arkiv') return arkiv(env, hvem, url);

  /**
   * Delt modus er forfatterens valg, ikke leserens. Leseren kan se hva det står på, og be
   * om det – men bryteren sitter hos den det gjelder.
   */
  if (sti === '/delt' && req.method === 'POST') {
    if (!erForfatter) return feil('Dette er forfatterens valg.', 403);
    const på = kropp?.på === true;
    await skrivOppsett(env, 'delt_modus', på ? 'ja' : 'nei');
    send(env, ctx, HENDELSER.deling(på));
    await leggMelding(env, FORFATTER, på
      ? 'Jeg har slått på delt modus. Du ser alt jeg fører her nå.'
      : 'Jeg har slått av delt modus. Nå velger jeg selv hvilke dager jeg deler.');
    return json({ ok: true, delt: på });
  }

  /**
   * Bytt kode. Begge kan alltid bytte sin egen. Leseren kan i tillegg sette en
   * ny for den andre – men aldri i det skjulte: det kommer en melding om det i
   * samtalen, slik at en ny kode aldri er en overraskelse.
   */
  if (sti === '/kode' && req.method === 'POST') {
    const mål = kropp?.hvem === FORFATTER ? FORFATTER : kropp?.hvem === LESER ? LESER : null;
    const ny = String(kropp?.kode ?? '');
    if (!mål) return feil('Hvem sin kode?', 400);
    if (ny.length < 6) return feil('Koden må være minst seks tegn.', 400);
    if (erForfatter && mål !== FORFATTER) return feil('Du kan bare bytte din egen kode.', 403);

    await skrivOppsett(env, `kode_${mål}`, await lagKode(ny));
    if (erForfatter) send(env, ctx, HENDELSER.kode(), true);
    if (!erForfatter && mål === FORFATTER) {
      await leggMelding(env, LESER, 'Jeg satte en ny kode for deg her i appen.');
    }
    return json({ ok: true, hvem: mål });
  }
  if (sti === '/aarsbok') return arsboka(env, hvem, url);
  if (sti === '/sammendrag') return sammendrag(env, hvem, url);

  if (sti === '/sporsmal' && req.method === 'GET') {
    if (!erForfatter && !(await erDelt(env))) return feil('Forfatterens egen liste.', 403);
    return sporsmalslista(env, url);
  }

  if (sti === '/sporsmal' && req.method === 'POST') {
    if (!erForfatter) return feil('Bare forfatteren svarer på disse.', 403);
    const spm = sporsmalMed(kropp?.k);
    if (!spm) return feil('Ukjent spørsmål.', 400);
    const tekst = String(kropp?.tekst ?? '').trim().slice(0, 4000);

    if (!tekst) {
      await env.DB.prepare('DELETE FROM sporsmalsvar WHERE nokkel = ?1').bind(spm.k).run();
      return json({ ok: true, tekst: null });
    }
    await env.DB.prepare(`INSERT INTO sporsmalsvar (nokkel, tekst, skrevet_kl) VALUES (?1, ?2, ?3)
                          ON CONFLICT(nokkel) DO UPDATE SET tekst = ?2, skrevet_kl = ?3`)
      .bind(spm.k, tekst, nå()).run();
    send(env, ctx, HENDELSER.svarte(spm.t, tekst), true);
    return json({ ok: true, tekst });
  }

  // Én enkelt dag, for kalenderen. Leseren får den gjennom det samme filteret.
  if (sti === '/dag' && req.method === 'GET') {
    const dato = url.searchParams.get('dato') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) return feil('Ugyldig dato.', 400);
    const dag = await hentDag(env, dato);
    return json({
      dag: await medFiler(env, erForfatter ? dag : forLeseren(dag, await erDelt(env)), erForfatter || await erDelt(env)),
      // Spørsmålet hører til datoen, ikke til en oppføring. Ellers hadde en
      // tom dag ikke hatt noe å spørre om.
      sporsmal: sporsmalFor(dato),
    });
  }

  // En dag ført ved uhell skal kunne slettes, ikke bare rettes.
  if (sti === '/dag' && req.method === 'DELETE') {
    if (!erForfatter) return feil('Bare forfatteren sletter sine egne dager.', 403);
    const dato = url.searchParams.get('dato') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) return feil('Ugyldig dato.', 400);

    const dag = await hentDag(env, dato);
    if (!dag) return feil('Fant ikke dagen.', 404);

    // Filene må ut av lageret også, ellers blir de liggende uten en dag. Bare
    // dagens egne: et vedlegg i samtalen bærer samme dato, men hører til
    // meldingen sin og skal stå der den står.
    const filer = await env.DB
      .prepare('SELECT id FROM filer WHERE melding IS NULL AND dato = ?1').bind(dato).all();
    for (const f of (filer.results ?? [])) await env.FILER.delete(`fil:${f.id}`);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM dager WHERE dato = ?1').bind(dato),
      env.DB.prepare('DELETE FROM filer WHERE melding IS NULL AND dato = ?1').bind(dato),
      env.DB.prepare('DELETE FROM svar WHERE dato = ?1').bind(dato),
      // Varselraden går med, så dagen kan føres på nytt uten å være «alt meldt».
      env.DB.prepare('DELETE FROM varsler WHERE dato = ?1').bind(dato),
    ]);

    if (!dag.privat) send(env, ctx, `🗑 Slettet ${norskDato(dato, true)}.`, true);
    return json({ ok: true });
  }

  if (sti === '/dag' && req.method === 'POST') {
    if (!erForfatter) return feil('Bare forfatteren skriver kveldsrunden.', 403);
    return lagreDag(kropp, env, ctx);
  }

  /* --- meldinger --- */

  // Vedlegg lastes opp først og festes når meldingen sendes. Rå bytes og
  // JSON kan ikke reise i samme forespørsel.
  if (sti === '/melding/fil' && req.method === 'POST') {
    const slag = url.searchParams.get('slag') === 'lyd' ? 'lyd' : 'bilde';
    const lagret = await taImotFil(req, env, idag(env), slag, 0);
    if (lagret.feil) return feil(lagret.feil, lagret.status);
    return json({ id: lagret.id, slag: lagret.slag, type: lagret.type });
  }

  if (sti === '/melding' && req.method === 'POST') {
    const tekst = tekstFra('tekst', 2000);
    const bedt = [...new Set((Array.isArray(kropp?.filer) ? kropp.filer : []).map(String))].slice(0, 6);
    // Bare vedlegg som faktisk ligger og venter, teller. Ellers ville en id
    // som var ryddet bort blitt til en melding som bare sier 📷 og ikke viser noe.
    const vedlegg = bedt.length ? await ventendeVedlegg(env, bedt) : [];
    if (!tekst && !vedlegg.length) {
      return feil(bedt.length ? 'Vedleggene er ikke der lenger. Legg dem ved på nytt.' : 'Tom melding.', 400);
    }
    await leggMeldingMedVedlegg(env, hvem, tekst || '📷', vedlegg);

    if (vedlegg.length) {
      // Forfatterens vedlegg går videre til Telegram, som meldingene ellers.
      if (erForfatter && ctx?.waitUntil) {
        for (const id of vedlegg) {
          const f = await env.DB.prepare('SELECT slag FROM filer WHERE id = ?1').bind(id).first();
          const data = await env.FILER.get(`fil:${id}`, 'arrayBuffer');
          if (!data) continue;
          ctx.waitUntil(f?.slag === 'lyd'
            ? sendFil(env, 'sendAudio', 'audio', data, { navn: 'lydklipp', tekst: '🎙 Lydklipp' })
            : sendFil(env, 'sendPhoto', 'photo', data, { navn: 'bilde.jpg', tekst: '📷 Bilde' }));
        }
      }
    }
    // Bare den ene veien har en telefon å pinge. Den andre ser det i appen.
    if (erForfatter && tekst) send(env, ctx, nyMelding(tekst));
    return json({ ok: true });
  }

  // Et hjerte på en melding. Trykk på det samme igjen, og det er borte.
  const reaksjon = sti.match(/^\/melding\/(\d+)\/reaksjon$/);
  if (reaksjon && req.method === 'POST') {
    const id = Number(reaksjon[1]);
    const tegn = REAKSJONER.includes(kropp?.tegn) ? kropp.tegn : null;
    const melding = await env.DB.prepare('SELECT id, tekst FROM meldinger WHERE id = ?1').bind(id).first();
    if (!melding) return feil('Fant ikke meldingen.', 404);

    const fra_før = await env.DB.prepare('SELECT tegn FROM reaksjoner WHERE melding = ?1 AND hvem = ?2')
      .bind(id, hvem).first();

    if (!tegn || fra_før?.tegn === tegn) {
      await env.DB.prepare('DELETE FROM reaksjoner WHERE melding = ?1 AND hvem = ?2').bind(id, hvem).run();
      return json({ ok: true, tegn: null });
    }

    await env.DB.prepare(`INSERT INTO reaksjoner (melding, hvem, tegn, satt_kl) VALUES (?1, ?2, ?3, ?4)
                          ON CONFLICT(melding, hvem) DO UPDATE SET tegn = ?3, satt_kl = ?4`)
      .bind(id, hvem, tegn, nå()).run();
    if (erForfatter) send(env, ctx, HENDELSER.reaksjon(tegn, melding.tekst.slice(0, 60)), true);
    return json({ ok: true, tegn });
  }

  if (sti === '/meldinger/lest' && req.method === 'POST') {
    const fra = erForfatter ? LESER : FORFATTER;
    const res = await env.DB.prepare('UPDATE meldinger SET lest_kl = ?1 WHERE fra = ?2 AND lest_kl IS NULL')
      .bind(nå(), fra).run();
    // Bare når det faktisk lå noe ulest, og høyst én gang om dagen.
    if (erForfatter && res.meta?.changes && env.AKTIV_VARSEL !== 'nei') {
      await sendEnGang(env, ctx, 'lest', idag(env), HENDELSER.lest(), true);
    }
    return json({ ok: true });
  }

  /* --- ønskelista --- */

  if (sti === '/onske' && req.method === 'POST') {
    const tekst = tekstFra('tekst', 200);
    if (!tekst) return feil('Tomt ønske.', 400);
    await env.DB.prepare('INSERT INTO onsker (tekst, laget_av, laget_kl) VALUES (?1, ?2, ?3)')
      .bind(tekst, hvem, nå()).run();
    if (erForfatter) send(env, ctx, nyttOnske(tekst), true);
    return json({ ok: true });
  }

  const gjort = sti.match(/^\/onske\/(\d+)\/gjort$/);
  if (gjort && req.method === 'POST') {
    const id = Number(gjort[1]);
    const rad = await env.DB.prepare('SELECT gjort_kl FROM onsker WHERE id = ?1').bind(id).first();
    if (!rad) return feil('Fant ikke ønsket.', 404);
    // Samme knapp begge veier: huket av ved uhell skal kunne angres.
    await env.DB.prepare('UPDATE onsker SET gjort_kl = ?1, gjort_av = ?2 WHERE id = ?3')
      .bind(rad.gjort_kl ? null : nå(), rad.gjort_kl ? null : hvem, id).run();
    if (erForfatter) {
      const tekst = (await env.DB.prepare('SELECT tekst FROM onsker WHERE id = ?1').bind(id).first())?.tekst ?? '';
      send(env, ctx, rad.gjort_kl ? HENDELSER.angret(tekst) : HENDELSER.huket(tekst), true);
    }
    return json({ ok: true, gjort: !rad.gjort_kl });
  }

  const slett = sti.match(/^\/onske\/(\d+)$/);
  if (slett && req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM onsker WHERE id = ?1').bind(Number(slett[1])).run();
    return json({ ok: true });
  }

  /* --- brev --- */

  if (sti === '/brev' && req.method === 'POST') {
    if (erForfatter) return feil('Bare leseren legger inn brev.', 403);
    const tekst = tekstFra('tekst', 4000);
    if (!tekst) return feil('Tomt brev.', 400);
    await env.DB.prepare('INSERT INTO brev (tekst, laget_kl) VALUES (?1, ?2)').bind(tekst, nå()).run();
    return json({ ok: true });
  }

  const åpne = sti.match(/^\/brev\/(\d+)\/apne$/);
  if (åpne && req.method === 'POST') {
    if (!erForfatter) return feil('Ikke ditt å åpne.', 403);
    const id = Number(åpne[1]);
    const rad = await env.DB.prepare('SELECT * FROM brev WHERE id = ?1').bind(id).first();
    if (!rad) return feil('Fant ikke brevet.', 404);
    if (!rad.apnet_kl) {
      await env.DB.prepare('UPDATE brev SET apnet_kl = ?1 WHERE id = ?2').bind(nå(), id).run();
      send(env, ctx, brevÅpnet(norskDato(rad.laget_kl.slice(0, 10), true)), true);
    }
    return json({ id, tekst: rad.tekst, laget_kl: rad.laget_kl });
  }

  return feil('Ukjent rute.', 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url, ctx);
    } catch (e) {
      console.error('API-feil:', e?.stack ?? e);
      return feil('Noe gikk galt her inne.', 500);
    }
  },

  /**
   * Halvtimesticket. Cron kjører i UTC og vet ikke om det er sommertid, så
   * jobben er å finne ut om klokka nettopp passerte påminnelsestiden i norsk
   * tid – og gjøre resten én gang i det vinduet.
   */
  async scheduled(event, env, ctx) {
    // Tidspunktet kommer fra selve tikket, ikke fra klokka her og nå. Da kan
    // vinduene testes uten å måtte vente til halv ti om kvelden.
    const tid = new Date(event?.scheduledTime ?? Date.now());
    const dato = dagsnokkel(tid, sone(env));
    const nåMin = minutter(klokke(tid, sone(env)));
    if (nåMin === null) return;
    // Cron tikker hver halvtime. Et vindu er den halvtimen som følger.
    const iVinduet = (kl) => {
      const m = minutter(kl);
      return m != null && nåMin >= m && nåMin < m + 30;
    };

    /* Kvelden: er dagen ikke ført, minnes det på. */
    if (iVinduet(env.PAMINNELSE_KL || '21:30')) {
      const dag = await hentDag(env, dato);
      if (!dag && env.PAMINNELSE !== 'nei') {
        await sendEnGang(env, ctx, 'paminnelse', dato, påminnelse(), true);
      }
      const sist = await env.DB.prepare('SELECT dato FROM dager ORDER BY dato DESC LIMIT 1').first();
      if (sist) {
        const stille = dagerMellom(sist.dato, dato);
        if (stille >= 3) await sendEnGang(env, ctx, 'stille', dato, stilleDager(stille), true);
      }
    }

    /* Morgenen: var i går tung, kommer beskjeden nå – da kan leseren gjøre noe. */
    if (iVinduet(env.MORGEN_KL || '08:00')) {
      const igår = await hentDag(env, sisteDager(dato, 2).at(-1));
      if (igår && !igår.privat && igår.humor <= 2) {
        const puff = morgenPuff(igår);
        await sendEnGang(env, ctx, 'morgen', dato, puff.tekst, false, puff.knapper);
      }
    }

    /* Søndag kveld: uka sett under ett. */
    if (norskUkedag(dato) === 'søndag' && iVinduet(env.UKEBREV_KL || '20:00')) {
      const grense = sisteDager(dato, 14).at(-1);
      const rader = await env.DB
        .prepare('SELECT * FROM dager WHERE dato >= ?1 ORDER BY dato DESC').bind(grense).all();
      const dager = (rader.results ?? []).map(radTilDag);
      const uke = ukesbilde(dager, dato);
      if (uke.ført) {
        const gode = dager
          .filter((d) => !d.privat && dagerMellom(d.dato, dato) < 7)
          .reduce((n, d) => n + d.gode_ting.length, 0);
        await sendEnGang(env, ctx, 'uke', dato, ukesbrev(uke, gode), true);
      }
    }

    /* Vedlegg som aldri ble sendt, blir liggende. De ryddes bort en gang i døgnet. */
    if (iVinduet(env.PAMINNELSE_KL || '21:30')) {
      const glemte = await env.DB
        .prepare("SELECT id FROM filer WHERE melding = 0 AND laget_kl < ?1")
        .bind(new Date(tid.getTime() - 86400000).toISOString()).all();
      for (const f of (glemte.results ?? [])) {
        await env.FILER.delete(`fil:${f.id}`);
        await env.DB.prepare('DELETE FROM filer WHERE id = ?1').bind(f.id).run();
      }
    }

    /* Siste kvelden i året. */
    if (dato.slice(5) === '12-31' && iVinduet('20:00')) {
      const ar = dato.slice(0, 4);
      const rader = await env.DB
        .prepare('SELECT gode_ting FROM dager WHERE dato >= ?1 AND dato <= ?2')
        .bind(`${ar}-01-01`, `${ar}-12-31`).all();
      const alle = rader.results ?? [];
      const antall = alle.reduce((n, r) => {
        try {
          return n + JSON.parse(r.gode_ting || '[]').length;
        } catch {
          return n;
        }
      }, 0);
      if (antall) await sendEnGang(env, ctx, 'aarsbok', dato, arsbok(ar, antall, alle.length), false);
    }
  },
};
