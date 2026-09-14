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
  COOKIE, lagToken, lesToken, lesCookie, likeStrenger, settCookie, slettCookie,
} from './auth.js';
import {
  dagsnokkel, klokke, minutter, dagerMellom, sisteDager, sammeDagIFjor, norskDato,
} from './dato.js';
import {
  BEHOV, ryddDag, varslerForDag, påminnelse, stilleDager, brevÅpnet,
} from './varsler.js';
import { sendTelegram } from './telegram.js';

const LYKKE = 'lykke';
const MATHIAS = 'mathias';

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
const idag = (env) => dagsnokkel(new Date(), sone(env));

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
 * En privat dag vises som en grå prikk: at hun skrev noe er ikke hemmelig,
 * innholdet er det.
 */
function forHam(dag) {
  if (!dag) return null;
  if (dag.privat) return { dato: dag.dato, privat: true };
  return {
    dato: dag.dato,
    humor: dag.humor,
    behov: dag.behov,
    gode_ting: dag.del_gode ? dag.gode_ting : [],
    holdt_gode: !dag.del_gode,
    tungt: dag.del_tungt ? dag.tungt : null,
    holdt_tungt: Boolean(dag.tungt) && !dag.del_tungt,
    skrevet_kl: dag.skrevet_kl,
  };
}

/* ---------- varsling ---------- */

/**
 * Sender én gang. Raden i `varsler` er låsen: kommer den inn, er vi først.
 * Uten den ville hver lille retting av dagen utløst varselet på nytt.
 */
async function sendEnGang(env, ctx, slag, dato, tekst, stille) {
  const res = await env.DB
    .prepare('INSERT OR IGNORE INTO varsler (slag, dato, sendt_kl) VALUES (?1, ?2, ?3)')
    .bind(slag, dato, new Date().toISOString())
    .run();
  if (!res.meta?.changes) return false;
  const oppgave = sendTelegram(env, tekst, { stille });
  if (ctx?.waitUntil) ctx.waitUntil(oppgave);
  else await oppgave;
  return true;
}

/* ---------- ruter ---------- */

async function loggInn(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'ukjent';
  const nå = new Date();
  const time = new Date(nå.getTime() - 3600000).toISOString();

  const teller = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM forsok WHERE ip = ?1 AND kl > ?2')
    .bind(ip, time)
    .first();
  if ((teller?.n ?? 0) >= 10) {
    return feil('For mange forsøk. Prøv igjen om en time.', 429);
  }

  const { hvem, kode } = await req.json().catch(() => ({}));
  const fasit = hvem === LYKKE ? env.KODE_LYKKE : hvem === MATHIAS ? env.KODE_MATHIAS : null;

  if (!fasit || !likeStrenger(kode ?? '', fasit)) {
    await env.DB.prepare('INSERT INTO forsok (ip, kl) VALUES (?1, ?2)')
      .bind(ip, nå.toISOString()).run();
    return feil('Feil kode.', 401);
  }

  await env.DB.prepare('DELETE FROM forsok WHERE ip = ?1').bind(ip).run();
  const token = await lagToken(hvem, env.SESJON_HEMMELIG);
  return json({ hvem }, 200, { 'Set-Cookie': settCookie(token) });
}

async function tilstandLykke(env) {
  const dato = idag(env);
  const [dag, hilsen, brev, historikk, ifjor, tall] = await Promise.all([
    hentDag(env, dato),
    env.DB.prepare('SELECT id, tekst, laget_kl, lest_kl FROM hilsener ORDER BY id DESC LIMIT 1').first(),
    env.DB.prepare('SELECT id, laget_kl FROM brev WHERE apnet_kl IS NULL ORDER BY id').all(),
    env.DB.prepare('SELECT dato, humor, privat FROM dager WHERE dato > ?1 ORDER BY dato')
      .bind(sisteDager(dato, 70).at(-1)).all(),
    hentDag(env, sammeDagIFjor(dato)),
    env.DB.prepare("SELECT COUNT(*) AS dager FROM dager WHERE dato >= ?1")
      .bind(`${dato.slice(0, 4)}-01-01`).first(),
  ]);

  const gode = await env.DB.prepare('SELECT gode_ting FROM dager').all();
  const antallGode = (gode.results ?? []).reduce((sum, rad) => {
    try {
      return sum + JSON.parse(rad.gode_ting || '[]').length;
    } catch {
      return sum;
    }
  }, 0);

  return {
    hvem: LYKKE,
    dato,
    idag: dag,
    hilsen: hilsen ?? null,
    brev: brev.results ?? [],
    historikk: historikk.results ?? [],
    ifjor,
    antall_gode_ting: antallGode,
    dager_i_ar: tall?.dager ?? 0,
    behov: BEHOV,
  };
}

async function tilstandMathias(env) {
  const dato = idag(env);
  const grense = sisteDager(dato, 14).at(-1);
  const [dager, historikk, hilsen, brev, sist] = await Promise.all([
    env.DB.prepare('SELECT * FROM dager WHERE dato >= ?1 ORDER BY dato DESC').bind(grense).all(),
    env.DB.prepare('SELECT dato, humor, privat FROM dager WHERE dato > ?1 ORDER BY dato')
      .bind(sisteDager(dato, 70).at(-1)).all(),
    env.DB.prepare('SELECT id, tekst, laget_kl, lest_kl FROM hilsener ORDER BY id DESC LIMIT 1').first(),
    env.DB.prepare('SELECT id, laget_kl, apnet_kl FROM brev ORDER BY id DESC').all(),
    env.DB.prepare('SELECT dato FROM dager ORDER BY dato DESC LIMIT 1').first(),
  ]);

  const rader = (dager.results ?? []).map(radTilDag);
  const omOss = [];
  for (const dag of rader) {
    if (dag.privat || !dag.del_gode) continue;
    for (const g of dag.gode_ting) if (g.om_oss) omOss.push({ dato: dag.dato, tekst: g.tekst });
  }

  return {
    hvem: MATHIAS,
    dato,
    idag: forHam(rader.find((d) => d.dato === dato) ?? null),
    siste: rader.map(forHam),
    historikk: (historikk.results ?? []).map((r) => ({
      dato: r.dato,
      humor: r.privat ? null : r.humor,
      privat: Boolean(r.privat),
    })),
    om_oss: omOss,
    hilsen: hilsen ?? null,
    brev: brev.results ?? [],
    sist_skrevet: sist?.dato ?? null,
    behov: BEHOV,
  };
}

async function lagreDag(req, env, ctx) {
  const kropp = await req.json().catch(() => ({}));
  const dato = typeof kropp.dato === 'string' ? kropp.dato : idag(env);

  // Man skal kunne ta igjen i går, men ikke skrive om hele historien og ikke
  // føre dager som ikke har vært ennå.
  const avstand = dagerMellom(dato, idag(env));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato) || avstand < 0 || avstand > 6) {
    return feil('Datoen må være i dag eller opptil seks dager tilbake.', 400);
  }

  const rydda = ryddDag(kropp);
  const nå = new Date().toISOString();
  const fra_før = await hentDag(env, dato);

  await env.DB.prepare(`
    INSERT INTO dager (dato, humor, gode_ting, tungt, behov, del_gode, del_tungt, privat, skrevet_kl, endret_kl)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
    ON CONFLICT(dato) DO UPDATE SET
      humor = ?2, gode_ting = ?3, tungt = ?4, behov = ?5,
      del_gode = ?6, del_tungt = ?7, privat = ?8, endret_kl = ?9
  `).bind(
    dato, rydda.humor, JSON.stringify(rydda.gode_ting), rydda.tungt, rydda.behov,
    rydda.del_gode, rydda.del_tungt, rydda.privat, nå,
  ).run();

  const dag = await hentDag(env, dato);
  const igår = await hentDag(env, sisteDager(dato, 2).at(-1));
  const sendt = await env.DB.prepare('SELECT slag FROM varsler WHERE dato = ?1').bind(dato).all();

  const skalSendes = varslerForDag({
    dag,
    igår,
    sendt: (sendt.results ?? []).map((r) => r.slag),
  });
  const sendteNå = [];
  for (const v of skalSendes) {
    if (await sendEnGang(env, ctx, v.slag, dato, v.tekst, v.stille)) sendteNå.push(v.slag);
  }

  return json({ dag, sendt: sendteNå, var_ny: !fra_før });
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
    const alle = await env.DB
      .prepare('SELECT dato, gode_ting FROM dager WHERE gode_ting != ?1').bind('[]').all();
    rader = alle.results ?? [];
  }

  const alt = [];
  for (const rad of rader) {
    try {
      for (const g of JSON.parse(rad.gode_ting || '[]')) {
        if (g?.tekst) alt.push({ dato: rad.dato, tekst: g.tekst, om_oss: Boolean(g.om_oss) });
      }
    } catch { /* en ødelagt rad skal ikke stoppe resten */ }
  }
  if (!alt.length) return json({ tom: true });

  const valgt = alt[Math.floor(Math.random() * alt.length)];
  return json({ ...valgt, når: norskDato(valgt.dato, true) });
}

async function api(req, env, url, ctx) {
  const sti = url.pathname.replace(/^\/api/, '');
  const hvem = await lesToken(lesCookie(req, COOKIE), env.SESJON_HEMMELIG);

  if (sti === '/logg-inn' && req.method === 'POST') return loggInn(req, env);
  if (sti === '/logg-ut') return json({ ok: true }, 200, { 'Set-Cookie': slettCookie() });
  if (sti === '/meg') return json({ hvem });

  if (!hvem) return feil('Ikke logget inn.', 401);
  const bare = (rolle) => hvem === rolle;

  if (sti === '/tilstand' && req.method === 'GET') {
    return json(bare(LYKKE) ? await tilstandLykke(env) : await tilstandMathias(env));
  }

  if (sti === '/dag' && req.method === 'POST') {
    if (!bare(LYKKE)) return feil('Bare Lykke skriver kveldsrunden.', 403);
    return lagreDag(req, env, ctx);
  }

  if (sti === '/glasset' && req.method === 'GET') return glasset(env);

  if (sti === '/hilsen' && req.method === 'POST') {
    if (!bare(MATHIAS)) return feil('Bare Mathias skriver hilsener.', 403);
    const { tekst } = await req.json().catch(() => ({}));
    const rein = String(tekst ?? '').trim().slice(0, 2000);
    if (!rein) return feil('Tom hilsen.', 400);
    await env.DB.prepare('INSERT INTO hilsener (tekst, laget_kl) VALUES (?1, ?2)')
      .bind(rein, new Date().toISOString()).run();
    return json({ ok: true });
  }

  if (sti === '/hilsen/lest' && req.method === 'POST') {
    if (!bare(LYKKE)) return feil('Ikke din.', 403);
    const { id } = await req.json().catch(() => ({}));
    await env.DB.prepare('UPDATE hilsener SET lest_kl = ?1 WHERE id = ?2 AND lest_kl IS NULL')
      .bind(new Date().toISOString(), Number(id) || 0).run();
    return json({ ok: true });
  }

  if (sti === '/brev' && req.method === 'POST') {
    if (!bare(MATHIAS)) return feil('Bare Mathias legger inn brev.', 403);
    const { tekst } = await req.json().catch(() => ({}));
    const rein = String(tekst ?? '').trim().slice(0, 4000);
    if (!rein) return feil('Tomt brev.', 400);
    await env.DB.prepare('INSERT INTO brev (tekst, laget_kl) VALUES (?1, ?2)')
      .bind(rein, new Date().toISOString()).run();
    return json({ ok: true });
  }

  const åpne = sti.match(/^\/brev\/(\d+)\/apne$/);
  if (åpne && req.method === 'POST') {
    if (!bare(LYKKE)) return feil('Ikke ditt å åpne.', 403);
    const id = Number(åpne[1]);
    const rad = await env.DB.prepare('SELECT * FROM brev WHERE id = ?1').bind(id).first();
    if (!rad) return feil('Fant ikke brevet.', 404);
    if (!rad.apnet_kl) {
      await env.DB.prepare('UPDATE brev SET apnet_kl = ?1 WHERE id = ?2')
        .bind(new Date().toISOString(), id).run();
      const melding = brevÅpnet(norskDato(rad.laget_kl.slice(0, 10), true));
      const oppgave = sendTelegram(env, melding, { stille: true });
      if (ctx?.waitUntil) ctx.waitUntil(oppgave);
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
    // vinduet testes uten å måtte vente til halv ti om kvelden.
    const nå = new Date(event?.scheduledTime ?? Date.now());
    const dato = dagsnokkel(nå, sone(env));
    const nåMin = minutter(klokke(nå, sone(env)));
    const målMin = minutter(env.PAMINNELSE_KL || '21:30') ?? 21 * 60 + 30;
    if (nåMin === null || nåMin < målMin || nåMin >= målMin + 30) return;

    const dag = await hentDag(env, dato);
    if (!dag && env.PAMINNELSE !== 'nei') {
      await sendEnGang(env, ctx, 'paminnelse', dato, påminnelse(), true);
    }

    const sist = await env.DB.prepare('SELECT dato FROM dager ORDER BY dato DESC LIMIT 1').first();
    if (sist) {
      const stille = dagerMellom(sist.dato, dato);
      if (stille >= 3) await sendEnGang(env, ctx, 'stille', dato, stilleDager(stille), true);
    }
  },
};
