/**
 * Lykkeglasset – API-et.
 *
 * Statiske filer serveres av Cloudflare rett fra `public/`; alt under `/api/`
 * havner her. Lageret er D1 (SQLite), varslene går til Telegram.
 *
 * Regelen som styrer hele fila: **hun bestemmer hva han får se.** Alle svar
 * til Mathias går gjennom `forHam()`, som fjerner det hun ikke har delt. Det
 * er ett sted å lese for å vite at det stemmer.
 */
import {
  COOKIE, lagKode, lagToken, lesToken, lesCookie, likeStrenger, settCookie, slettCookie, stemmerKode,
} from './auth.js';
import {
  dagsnokkel, klokke, minutter, dagerMellom, sisteDager, sammeDagIFjor, norskDato, norskUkedag,
} from './dato.js';
import {
  BEHOV, SVAR, ryddDag, varslerForDag, påminnelse, stilleDager, brevÅpnet, nyMelding, nyttOnske,
  erAktiv, morgenPuff, ukesbrev, arsbok,
} from './varsler.js';
import { sendTelegram, kvitterTrykk, byttUtKnapper } from './telegram.js';

const LYKKE = 'lykke';
const MATHIAS = 'mathias';
const HISTORIKK_DAGER = 400;

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
 * Delt modus: alt hun fører, ser han, og hver dag varsles. Da finnes ikke
 * valgene om å holde noe tilbake – appen tilbyr dem ikke, i stedet for å
 * tilby dem og overse dem.
 */
const erDelt = (env) => env.DELT_MODUS === 'ja';
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
 * Dagen slik Mathias får se den. Alt som ikke er delt, finnes ikke her.
 * En privat dag vises som en grå rute: at hun skrev noe er ikke hemmelig,
 * innholdet er det.
 */
function forHam(dag, delt = false) {
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

/* ---------- innlogging ---------- */

async function loggInn(req, env) {
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
  const fasit = hvem === LYKKE ? env.KODE_LYKKE : hvem === MATHIAS ? env.KODE_MATHIAS : null;

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

  return {
    dato,
    dager: (dager.results ?? []).map(radTilDag),
    meldinger: (meldinger.results ?? []).reverse(),
    onsker: onsker.results ?? [],
    brev: brev.results ?? [],
    behov: BEHOV,
  };
}

async function tilstandLykke(env) {
  const f = await fellesTilstand(env);
  const alle = f.dager;
  const dag = alle.find((d) => d.dato === f.dato) ?? null;

  return {
    hvem: LYKKE,
    dato: f.dato,
    idag: dag,
    // Hennes egen historikk er hennes egen: også de private dagene har farge.
    historikk: alle.map((d) => ({ dato: d.dato, humor: d.humor, privat: d.privat })),
    ifjor: alle.find((d) => d.dato === sammeDagIFjor(f.dato)) ?? null,
    uke: ukesbilde(alle, f.dato),
    antall_gode_ting: alle.reduce((n, d) => n + d.gode_ting.length, 0),
    dager_i_ar: alle.filter((d) => d.dato.startsWith(f.dato.slice(0, 4))).length,
    meldinger: f.meldinger,
    onsker: f.onsker,
    brev: f.brev.filter((b) => !b.apnet_kl).map(({ id, laget_kl }) => ({ id, laget_kl })),
    behov: f.behov,
    delt: erDelt(env),
    kan_bytte_egen: true,
  };
}

async function tilstandMathias(env) {
  const f = await fellesTilstand(env);
  const alle = f.dager;
  const delt = erDelt(env);

  const omOss = [];
  for (const d of alle) {
    if (!delt && (d.privat || !d.del_gode)) continue;
    for (const g of d.gode_ting) if (g.om_oss) omOss.push({ dato: d.dato, tekst: g.tekst });
  }

  return {
    hvem: MATHIAS,
    dato: f.dato,
    idag: forHam(alle.find((d) => d.dato === f.dato) ?? null, delt),
    siste: alle.slice(0, 14).map((d) => forHam(d, delt)),
    historikk: alle.map((d) => ({
      dato: d.dato,
      humor: !delt && d.privat ? null : d.humor,
      privat: d.privat && !delt,
    })),
    uke: ukesbilde(alle, f.dato),
    om_oss: omOss,
    meldinger: f.meldinger,
    onsker: f.onsker,
    brev: f.brev.map(({ id, laget_kl, apnet_kl }) => ({ id, laget_kl, apnet_kl })),
    sist_skrevet: alle[0]?.dato ?? null,
    behov: f.behov,
    delt,
    // På serveren er koden bare en nøkkel til døra, ikke til innholdet. Da
    // kan den settes på nytt uten at noe går tapt.
    kan_bytte_hennes: true,
    kan_bytte_egen: true,
  };
}

/* ---------- skriving ---------- */

async function lagreDag(kropp, env, ctx) {
  const dato = typeof kropp.dato === 'string' ? kropp.dato : idag(env);

  // Man skal kunne ta igjen i går, men ikke skrive om hele historien og ikke
  // føre dager som ikke har vært ennå.
  const avstand = dagerMellom(dato, idag(env));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato) || avstand < 0 || avstand > 6) {
    return feil('Datoen må være i dag eller opptil seks dager tilbake.', 400);
  }

  const delt = erDelt(env);
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

  const dag = await hentDag(env, dato);
  const igår = await hentDag(env, sisteDager(dato, 2).at(-1));
  const sendt = await env.DB.prepare('SELECT slag FROM varsler WHERE dato = ?1').bind(dato).all();

  const skalSendes = varslerForDag({
    dag,
    igår,
    sendt: (sendt.results ?? []).map((x) => x.slag),
  });
  const sendteNå = [];
  for (const v of skalSendes) {
    if (await sendEnGang(env, ctx, v.slag, dato, v.tekst, v.stille, v.knapper)) sendteNå.push(v.slag);
  }

  return json({ dag, sendt: sendteNå, var_ny: !fraFør });
}

/** Én tilfeldig god ting fra før i tiden. Helst noe hun har rukket å glemme. */
async function glasset(env) {
  const dato = idag(env);
  const grense = sisteDager(dato, 15).at(-1);
  const gamle = await env.DB
    .prepare('SELECT dato, gode_ting FROM dager WHERE dato < ?1 AND gode_ting != ?2')
    .bind(grense, '[]').all();
  let rader = gamle.results ?? [];
  if (!rader.length) {
    const alt = await env.DB
      .prepare('SELECT dato, gode_ting FROM dager WHERE gode_ting != ?1').bind('[]').all();
    rader = alt.results ?? [];
  }

  const lapper = [];
  for (const rad of rader) {
    try {
      for (const g of JSON.parse(rad.gode_ting || '[]')) {
        if (g?.tekst) lapper.push({ dato: rad.dato, tekst: g.tekst, om_oss: Boolean(g.om_oss) });
      }
    } catch { /* en ødelagt rad skal ikke stoppe resten */ }
  }
  if (!lapper.length) return json({ tom: true });

  const valgt = lapper[Math.floor(Math.random() * lapper.length)];
  return json({ ...valgt, når: norskDato(valgt.dato, true) });
}

/** Alt hun har skrevet, søkbart. Han ser bare det hun har delt. */
async function arkiv(env, hvem, url) {
  const sok = (url.searchParams.get('sok') ?? '').trim().toLowerCase();
  const bareOss = url.searchParams.get('oss') === 'ja';
  const rader = await env.DB.prepare('SELECT * FROM dager ORDER BY dato DESC').all();

  const ut = [];
  for (const rad of (rader.results ?? [])) {
    const dag = radTilDag(rad);
    if (hvem !== LYKKE && !erDelt(env) && (dag.privat || !dag.del_gode)) continue;
    for (const g of dag.gode_ting) {
      if (!g?.tekst) continue;
      if (bareOss && !g.om_oss) continue;
      if (sok && !g.tekst.toLowerCase().includes(sok)) continue;
      ut.push({ dato: dag.dato, tekst: g.tekst, om_oss: Boolean(g.om_oss), privat: dag.privat });
    }
  }
  return json({ treff: ut.slice(0, 400), antall: ut.length });
}

/* ---------- Telegram inn ---------- */

const KOMMANDOER = [
  '/logginn – engangslenke rett inn i appen',
  '/si <tekst> – send en melding til Lykke',
  '/hjelp – denne lista',
].join('\n');

const svarTil = (env, ctx, chat, tekst) => {
  const oppgave = sendTelegram(env, tekst, { stille: true, chat });
  if (ctx?.waitUntil) ctx.waitUntil(oppgave);
};

/**
 * Svar fra Telegram.
 *
 * To lag holder fremmede ute: Telegram sender en hemmelighet bare den og vi
 * kjenner, og bare kontoen som én gang har sagt Mathias' kode, blir hørt på.
 * Alt annet svares det høflig ja til og gjøres ingenting med – en webhook som
 * klager, forteller bare den som prøver at den fant noe.
 */
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

  // Den første som sier koden, blir eier. Etter det er det bare han.
  if (!eier) {
    if (tekst.startsWith('/eier ') && likeStrenger(tekst.slice(6).trim(), env.KODE_MATHIAS)) {
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
    const valg = SVAR[String(trykk.data ?? '').replace('svar:', '')];
    if (valg) {
      await leggMelding(env, MATHIAS, valg.melding);
      if (ctx?.waitUntil) {
        ctx.waitUntil(kvitterTrykk(env, trykk.id, 'Sendt til Lykke'));
        ctx.waitUntil(byttUtKnapper(env, chat, trykk.message?.message_id, `✓ ${valg.knapp}`));
      }
    } else if (ctx?.waitUntil) {
      ctx.waitUntil(kvitterTrykk(env, trykk.id, ''));
    }
    return json({ ok: true });
  }

  /* --- kommandoer --- */
  if (tekst === '/hjelp' || tekst === '/start') {
    svarTil(env, ctx, chat, KOMMANDOER);
    return json({ ok: true });
  }

  if (tekst === '/logginn') {
    // Egen nøkkel for lenker: en sesjonskapsel skal ikke kunne brukes som
    // lenke, og en lenke skal ikke kunne brukes som kapsel.
    const token = await lagToken(MATHIAS, `${env.SESJON_HEMMELIG}:lenke`, Date.now(), 900000);
    await skrivOppsett(env, 'lenke', token);
    svarTil(env, ctx, chat, `Her, gyldig i et kvarter og bare én gang:\n${origin}/api/lenke?t=${token}`);
    return json({ ok: true });
  }

  if (tekst.startsWith('/si ')) {
    const sagt = tekst.slice(4).trim().slice(0, 2000);
    if (sagt) {
      await leggMelding(env, MATHIAS, sagt);
      svarTil(env, ctx, chat, '✓ Sendt til Lykke.');
    }
    return json({ ok: true });
  }

  /* --- vanlig tekst ---
     I en gruppe snakker dere også om alt mulig annet, så der må det være et
     svar på noe boten har sagt. I en samtale med boten alene er alt ment hit. */
  const svarPåBoten = Boolean(melding.reply_to_message?.from?.is_bot);
  const aleneMedBoten = melding.chat?.type === 'private';
  if (tekst && !tekst.startsWith('/') && (svarPåBoten || aleneMedBoten)) {
    await leggMelding(env, MATHIAS, tekst.slice(0, 2000));
    svarTil(env, ctx, chat, '✓ Sendt til Lykke.');
  }
  return json({ ok: true });
}

/** Alt som er skrevet i ett år, samlet måned for måned. */
async function arsboka(env, hvem, url) {
  const ar = (url.searchParams.get('ar') ?? idag(env).slice(0, 4)).slice(0, 4);
  const rader = await env.DB
    .prepare('SELECT * FROM dager WHERE dato >= ?1 AND dato <= ?2 ORDER BY dato')
    .bind(`${ar}-01-01`, `${ar}-12-31`).all();

  const måneder = new Map();
  let antall = 0;
  let dager = 0;
  for (const rad of (rader.results ?? [])) {
    const dag = radTilDag(rad);
    if (hvem !== LYKKE && !erDelt(env) && (dag.privat || !dag.del_gode)) continue;
    dager += 1;
    const md = dag.dato.slice(0, 7);
    if (!måneder.has(md)) måneder.set(md, []);
    for (const g of dag.gode_ting) {
      if (!g?.tekst) continue;
      antall += 1;
      måneder.get(md).push({ dato: dag.dato, tekst: g.tekst, om_oss: Boolean(g.om_oss) });
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
  // Kroppen kan bare leses én gang. Den leses her, og sendes videre som data –
  // ikke som en forespørsel andre kan prøve å lese om igjen.

  if (sti === '/logg-inn' && req.method === 'POST') return loggInn(req, env);
  if (sti === '/logg-ut') return json({ ok: true }, 200, { 'Set-Cookie': slettCookie() });
  if (sti === '/meg') return json({ hvem });

  // Telegram og engangslenka har ingen informasjonskapsel å vise til.
  if (sti === '/telegram' && req.method === 'POST') return fraTelegram(req, env, ctx, url.origin);

  if (sti === '/lenke' && req.method === 'GET') {
    const t = url.searchParams.get('t') ?? '';
    const lagret = await lesOppsett(env, 'lenke');
    const gjelder = await lesToken(t, `${env.SESJON_HEMMELIG}:lenke`);
    if (!t || !lagret || t !== lagret || gjelder !== MATHIAS) {
      return feil('Lenken er brukt opp eller utløpt. Send /logginn på nytt.', 401);
    }
    await skrivOppsett(env, 'lenke', '');
    const token = await lagToken(MATHIAS, env.SESJON_HEMMELIG);
    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Set-Cookie': settCookie(token), 'Cache-Control': 'no-store' },
    });
  }

  if (!hvem) return feil('Ikke logget inn.', 401);
  const erLykke = hvem === LYKKE;
  const kropp = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const tekstFra = (felt, maks) => String(kropp?.[felt] ?? '').trim().slice(0, maks);

  if (sti === '/tilstand') {
    // At hun er inne, er i seg selv verdt å vite om. Høyst én gang i timen.
    if (erLykke && env.AKTIV_VARSEL !== 'nei') {
      const tid = new Date();
      await sendEnGang(env, ctx, 'aktiv', `${idag(env)}T${klokke(tid, sone(env)).slice(0, 2)}`,
        erAktiv(klokke(tid, sone(env))), true);
    }
    return json(erLykke ? await tilstandLykke(env) : await tilstandMathias(env));
  }
  if (sti === '/glasset') return glasset(env);
  if (sti === '/arkiv') return arkiv(env, hvem, url);

  /**
   * Bytt kode. Hun kan alltid bytte sin egen. Mathias kan i tillegg sette en
   * ny for henne – men aldri i det skjulte: hun får en melding om det i
   * samtalen, slik at en ny kode aldri er en overraskelse.
   */
  if (sti === '/kode' && req.method === 'POST') {
    const mål = kropp?.hvem === LYKKE ? LYKKE : kropp?.hvem === MATHIAS ? MATHIAS : null;
    const ny = String(kropp?.kode ?? '');
    if (!mål) return feil('Hvem sin kode?', 400);
    if (ny.length < 6) return feil('Koden må være minst seks tegn.', 400);
    if (erLykke && mål !== LYKKE) return feil('Du kan bare bytte din egen kode.', 403);

    await skrivOppsett(env, `kode_${mål}`, await lagKode(ny));
    if (!erLykke && mål === LYKKE) {
      await leggMelding(env, MATHIAS, 'Jeg satte en ny kode for deg her i appen.');
    }
    return json({ ok: true, hvem: mål });
  }
  if (sti === '/aarsbok') return arsboka(env, hvem, url);

  // Én enkelt dag, for kalenderen. Han får den gjennom det samme filteret.
  if (sti === '/dag' && req.method === 'GET') {
    const dato = url.searchParams.get('dato') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) return feil('Ugyldig dato.', 400);
    const dag = await hentDag(env, dato);
    return json({ dag: erLykke ? dag : forHam(dag, erDelt(env)) });
  }

  if (sti === '/dag' && req.method === 'POST') {
    if (!erLykke) return feil('Bare Lykke skriver kveldsrunden.', 403);
    return lagreDag(kropp, env, ctx);
  }

  /* --- meldinger --- */

  if (sti === '/melding' && req.method === 'POST') {
    const tekst = tekstFra('tekst', 2000);
    if (!tekst) return feil('Tom melding.', 400);
    await leggMelding(env, hvem, tekst);
    // Bare den ene veien har en telefon å pinge. Den andre ser det i appen.
    if (erLykke) send(env, ctx, nyMelding(tekst));
    return json({ ok: true });
  }

  if (sti === '/meldinger/lest' && req.method === 'POST') {
    const fra = erLykke ? MATHIAS : LYKKE;
    await env.DB.prepare('UPDATE meldinger SET lest_kl = ?1 WHERE fra = ?2 AND lest_kl IS NULL')
      .bind(nå(), fra).run();
    return json({ ok: true });
  }

  /* --- ønskelista --- */

  if (sti === '/onske' && req.method === 'POST') {
    const tekst = tekstFra('tekst', 200);
    if (!tekst) return feil('Tomt ønske.', 400);
    await env.DB.prepare('INSERT INTO onsker (tekst, laget_av, laget_kl) VALUES (?1, ?2, ?3)')
      .bind(tekst, hvem, nå()).run();
    if (erLykke) send(env, ctx, nyttOnske(tekst), true);
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
    return json({ ok: true, gjort: !rad.gjort_kl });
  }

  const slett = sti.match(/^\/onske\/(\d+)$/);
  if (slett && req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM onsker WHERE id = ?1').bind(Number(slett[1])).run();
    return json({ ok: true });
  }

  /* --- brev --- */

  if (sti === '/brev' && req.method === 'POST') {
    if (erLykke) return feil('Bare Mathias legger inn brev.', 403);
    const tekst = tekstFra('tekst', 4000);
    if (!tekst) return feil('Tomt brev.', 400);
    await env.DB.prepare('INSERT INTO brev (tekst, laget_kl) VALUES (?1, ?2)').bind(tekst, nå()).run();
    return json({ ok: true });
  }

  const åpne = sti.match(/^\/brev\/(\d+)\/apne$/);
  if (åpne && req.method === 'POST') {
    if (!erLykke) return feil('Ikke ditt å åpne.', 403);
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

    /* Morgenen: var i går tung, kommer beskjeden nå – da kan han gjøre noe. */
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
