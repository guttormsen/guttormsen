/**
 * Samme app, annet lager.
 *
 * Denne fila erstatter `public/api.js` når appen publiseres som en privat
 * side i stedet for å kjøre på Cloudflare. Grensesnittet er det samme, så
 * ingen skjerm vet forskjellen – men to ting er annerledes, og de er verdt
 * å vite om:
 *
 * 1. **Ingen Telegram.** Siden får ikke lov til å ringe ut til andre
 *    tjenester. `VARSLER` er false, og appen lover derfor ikke noe annet enn
 *    at det står der når han åpner den.
 *
 * 2. **Ingen server til å holde ting fra hverandre.** Lageret er felles for
 *    alle som kan åpne siden. Derfor gjøres personvernet med kryptografi i
 *    stedet: en dag hun holder for seg selv, låses med en nøkkel utledet av
 *    hennes egen kode, og ligger i lageret som noe ingen andre kan lese –
 *    heller ikke den som eier siden.
 */
import { dagsnokkel, sisteDager, sammeDagIFjor, dagerMellom, norskDato } from './dato.js';
import { BEHOV, ryddDag } from './varsler.js';

export const VARSLER = false;
/** Ingen server, ingen filplass. Appen skjuler knappene i stedet for å love noe. */
export const KAN_FILER = false;
export const lastOpp = async () => { throw new Error('Bilder og lyd finnes bare i utgaven med server.'); };
export const hentFil = async () => { throw new Error('Eksport finnes bare i utgaven med server.'); };

const SONE = 'Europe/Oslo';
const LYKKE = 'lykke';
const MATHIAS = 'mathias';
const PROVE = 'lykkeglasset';

/* ---------- lageret ---------- */

let dbLøfte;
async function hentDb() {
  dbLøfte ??= window.claude?.use?.('db') ?? Promise.resolve(null);
  const db = await dbLøfte;
  if (!db) throw new Error('Får ikke kontakt med lagringen. Prøv å laste siden på nytt.');
  return db;
}

const radene = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const nå = () => new Date().toISOString();

/* ---------- nøkkelen hennes ---------- */

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fraB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Koden hennes blir til en nøkkel. Saltet er fast: uten en server finnes det
 * ingen som kan holde på et tilfeldig salt, og et fast salt er fortsatt mye
 * bedre enn ingen utledning.
 */
async function lagNokkel(kode) {
  const grunn = await crypto.subtle.importKey('raw', ENC.encode(kode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: ENC.encode('lykkeglasset/v1'), iterations: 250000, hash: 'SHA-256' },
    grunn,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function lås(nokkel, verdi) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ut = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, nokkel, ENC.encode(JSON.stringify(verdi)));
  return { iv: b64(iv), ct: b64(ut) };
}

async function låsOpp(nokkel, pakke) {
  if (!nokkel || !pakke?.ct) return null;
  try {
    const ut = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fraB64(pakke.iv) }, nokkel, fraB64(pakke.ct),
    );
    return JSON.parse(DEC.decode(ut));
  } catch {
    return null; // feil kode, eller noe som ikke var vårt
  }
}

/* ---------- økta ---------- */

const HUSK = 'lykkeglasset.hvem';
let hvem = null;
let nokkel = null;
try { hvem = localStorage.getItem(HUSK); } catch { hvem = null; }

async function loggInn({ hvem: rolle, kode }) {
  if (rolle !== LYKKE && rolle !== MATHIAS) throw new Error('Ukjent bruker.');
  if (!kode || kode.length < 4) throw new Error('Koden må være minst fire tegn.');

  if (rolle === LYKKE) {
    const db = await hentDb();
    const nøkkelen = await lagNokkel(kode);
    const doc = db.doc('oppsett/nokkel');
    const snap = await doc.get();
    if (!snap.exists) {
      // Første gang: koden hun taster nå, er koden.
      await doc.set({ prove: await lås(nøkkelen, PROVE) });
    } else if (await låsOpp(nøkkelen, snap.data()?.prove) !== PROVE) {
      throw new Error('Feil kode.');
    }
    nokkel = nøkkelen;
  }

  hvem = rolle;
  try { localStorage.setItem(HUSK, rolle); } catch { /* privat vindu */ }
  return { hvem };
}

/* ---------- dager ---------- */

const idag = () => dagsnokkel(new Date(), SONE);

/** Setter en dag sammen igjen: det åpne, pluss det hun kan låse opp. */
async function lesDag(rad) {
  if (!rad) return null;
  const åpent = {
    dato: rad.dato,
    humor: rad.humor ?? null,
    gode_ting: rad.gode_ting ?? [],
    tungt: rad.tungt ?? null,
    behov: rad.behov ?? null,
    del_gode: !rad.privat,
    del_tungt: !rad.privat,
    privat: Boolean(rad.privat),
    holdt_gode: false,
    holdt_tungt: false,
    skrevet_kl: rad.skrevet_kl,
  };
  if (!rad.skjult) return åpent;
  const åpnet = await låsOpp(nokkel, rad.skjult);
  return åpnet ? { ...åpent, ...åpnet } : åpent;
}

/** Dagen slik Mathias får se den: en privat dag har ingen innside. */
const forHam = (rad) => (rad
  ? (rad.privat
    ? { dato: rad.dato, privat: true }
    : {
      dato: rad.dato,
      humor: rad.humor,
      behov: rad.behov ?? null,
      gode_ting: rad.gode_ting ?? [],
      tungt: rad.tungt ?? null,
      holdt_gode: false,
      holdt_tungt: false,
      privat: false,
      skrevet_kl: rad.skrevet_kl,
    })
  : null);

async function lagreDag(kropp) {
  const db = await hentDb();
  const dato = kropp.dato || idag();
  const avstand = dagerMellom(dato, idag());
  if (avstand < 0 || avstand > 6) throw new Error('Datoen må være i dag eller opptil seks dager tilbake.');

  const r = ryddDag(kropp);
  const fraFør = await db.doc(`dager/${dato}`).get();
  const rad = {
    dato,
    privat: Boolean(r.privat),
    skrevet_kl: fraFør.data()?.skrevet_kl ?? nå(),
    endret_kl: nå(),
  };

  if (r.privat) {
    if (!nokkel) throw new Error('Du må taste koden din for å holde en dag for deg selv.');
    // Alt innholdet låses. Det som ligger igjen er at dagen finnes.
    rad.skjult = await lås(nokkel, {
      humor: r.humor, gode_ting: r.gode_ting, tungt: r.tungt, behov: r.behov,
    });
  } else {
    Object.assign(rad, { humor: r.humor, gode_ting: r.gode_ting, tungt: r.tungt, behov: r.behov });
  }

  await db.doc(`dager/${dato}`).set(rad);
  return { dag: await lesDag(rad), sendt: [], var_ny: !fraFør.exists };
}

/* ---------- tilstanden ---------- */

/** Uka mot forrige uke. Ikke for å score noen, men for å se en retning. */
function ukesbilde(dager, dato) {
  const snitt = (l) => (l.length ? l.reduce((s, d) => s + d.humor, 0) / l.length : null);
  const vindu = (fra, til) => dager.filter((d) => {
    const n = dagerMellom(d.dato, dato);
    return !d.privat && n >= fra && n < til;
  });
  const denne = vindu(0, 7);
  return {
    snitt: snitt(denne),
    forrige_snitt: snitt(vindu(7, 14)),
    ført: denne.length,
    tunge: denne.filter((d) => d.humor <= 2).length,
    gode: denne.filter((d) => d.humor >= 4).length,
    behov: denne.filter((d) => d.behov).map((d) => d.behov),
  };
}

async function tilstand() {
  const db = await hentDb();
  const dato = idag();

  const [alleSnap, meldingerSnap, onskerSnap, brevSnap] = await Promise.all([
    db.collection('dager').get(),
    db.collection('meldinger').orderBy('laget_kl', 'asc').limit(60).get(),
    db.collection('onsker').orderBy('laget_kl', 'desc').get(),
    db.collection('brev').orderBy('laget_kl', 'asc').get(),
  ]);

  const alle = radene(alleSnap).sort((a, b) => b.dato.localeCompare(a.dato));
  const meldinger = radene(meldingerSnap);
  // Gjorte ønsker nederst, ellers nyeste først – samme rekkefølge som på serveren.
  const onsker = radene(onskerSnap).sort((a, b) => Number(Boolean(a.gjort_kl)) - Number(Boolean(b.gjort_kl)));
  const brev = radene(brevSnap);
  const felles = {
    dato,
    meldinger,
    onsker,
    behov: BEHOV,
    delt: false,
    // Her er koden hennes også nøkkelen til det hun holder for seg selv. Da
    // kan ingen andre sette en ny – da ville innholdet blitt uleselig.
    kan_bytte_egen: hvem === LYKKE,
    kan_bytte_hennes: false,
  };

  if (hvem === LYKKE) {
    const åpnede = await Promise.all(alle.map(lesDag));
    return {
      ...felles,
      hvem: LYKKE,
      idag: åpnede.find((d) => d.dato === dato) ?? null,
      historikk: åpnede.map((d) => ({ dato: d.dato, humor: d.humor, privat: d.privat })),
      ifjor: åpnede.find((d) => d.dato === sammeDagIFjor(dato)) ?? null,
      uke: ukesbilde(åpnede, dato),
      antall_gode_ting: åpnede.reduce((n, d) => n + (d.gode_ting?.length ?? 0), 0),
      dager_i_ar: alle.filter((d) => d.dato.startsWith(dato.slice(0, 4))).length,
      brev: brev.filter((b) => !b.apnet_kl).map(({ id, laget_kl }) => ({ id, laget_kl })),
    };
  }

  const omOss = [];
  for (const d of alle) {
    if (d.privat) continue;
    for (const g of d.gode_ting ?? []) if (g.om_oss) omOss.push({ dato: d.dato, tekst: g.tekst });
  }

  return {
    ...felles,
    hvem: MATHIAS,
    idag: forHam(alle.find((d) => d.dato === dato) ?? null),
    siste: alle.slice(0, 14).map(forHam),
    historikk: alle.map((d) => ({ dato: d.dato, humor: d.privat ? null : d.humor, privat: Boolean(d.privat) })),
    uke: ukesbilde(alle.filter((d) => !d.privat), dato),
    om_oss: omOss,
    brev: brev.map(({ id, laget_kl, apnet_kl }) => ({ id, laget_kl, apnet_kl: apnet_kl ?? null })),
    sist_skrevet: alle[0]?.dato ?? null,
  };
}

/* ---------- glasset og arkivet ---------- */

/** Alle gode ting hun kan se. Han ser bare dem fra delte dager. */
async function lapper(alle) {
  const ut = [];
  for (const rad of alle) {
    if (hvem !== LYKKE && rad.privat) continue;
    const dag = hvem === LYKKE ? await lesDag(rad) : rad;
    for (const g of dag?.gode_ting ?? []) {
      if (g?.tekst) ut.push({ dato: rad.dato, tekst: g.tekst, om_oss: Boolean(g.om_oss), privat: Boolean(rad.privat) });
    }
  }
  return ut;
}

async function glasset() {
  const db = await hentDb();
  const alle = radene(await db.collection('dager').get());
  const grense = sisteDager(idag(), 15).at(-1);

  let valgbare = await lapper(alle.filter((r) => r.dato < grense));
  if (!valgbare.length) valgbare = await lapper(alle);
  if (!valgbare.length) return { tom: true };

  const valgt = valgbare[Math.floor(Math.random() * valgbare.length)];
  return { ...valgt, når: norskDato(valgt.dato, true) };
}

async function arkiv(sporring) {
  const db = await hentDb();
  const p = new URLSearchParams(sporring);
  const sok = (p.get('sok') ?? '').trim().toLowerCase();
  const bareOss = p.get('oss') === 'ja';

  const alle = radene(await db.collection('dager').get()).sort((a, b) => b.dato.localeCompare(a.dato));
  const treff = (await lapper(alle)).filter((g) =>
    (!bareOss || g.om_oss) && (!sok || g.tekst.toLowerCase().includes(sok)));
  return { treff: treff.slice(0, 400), antall: treff.length };
}

/* ---------- ruteren ---------- */

export async function api(full, { metode = 'GET', kropp } = {}) {
  const [sti, sporring = ''] = full.split('?');

  if (sti === '/meg') return { hvem };
  if (sti === '/logg-inn') return loggInn(kropp ?? {});
  if (sti === '/logg-ut') {
    hvem = null;
    nokkel = null;
    try { localStorage.removeItem(HUSK); } catch { /* privat vindu */ }
    return { ok: true };
  }

  if (!hvem) throw new Error('Ikke logget inn.');
  const erLykke = hvem === LYKKE;
  const db = await hentDb();
  const tekstFra = (maks) => String(kropp?.tekst ?? '').trim().slice(0, maks);

  if (sti === '/tilstand') return tilstand();
  if (sti === '/glasset') return glasset();
  if (sti === '/arkiv') return arkiv(sporring);

  if (sti === '/aarsbok') {
    const ar = (new URLSearchParams(sporring).get('ar') ?? idag().slice(0, 4)).slice(0, 4);
    const alle = radene(await db.collection('dager').get())
      .filter((r) => r.dato.startsWith(ar))
      .sort((a, b) => a.dato.localeCompare(b.dato));
    const synlige = erLykke ? alle : alle.filter((r) => !r.privat);
    const maneder = new Map();
    let antall = 0;
    for (const rad of synlige) {
      const dag = erLykke ? await lesDag(rad) : rad;
      const md = rad.dato.slice(0, 7);
      if (!maneder.has(md)) maneder.set(md, []);
      for (const g of dag?.gode_ting ?? []) {
        if (!g?.tekst) continue;
        antall += 1;
        maneder.get(md).push({ dato: rad.dato, tekst: g.tekst, om_oss: Boolean(g.om_oss) });
      }
    }
    return {
      ar,
      antall,
      dager: synlige.length,
      maneder: [...maneder].filter(([, ting]) => ting.length).map(([maned, ting]) => ({ maned, ting })),
    };
  }

  if (sti === '/dag' && metode === 'GET') {
    const dato = new URLSearchParams(sporring).get('dato') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) throw new Error('Ugyldig dato.');
    const snap = await db.doc(`dager/${dato}`).get();
    if (!snap.exists) return { dag: null };
    const rad = { id: snap.id, ...snap.data() };
    return { dag: erLykke ? await lesDag(rad) : forHam(rad) };
  }

  if (sti === '/dag' && metode === 'POST') {
    if (!erLykke) throw new Error('Bare Lykke skriver kveldsrunden.');
    return lagreDag(kropp ?? {});
  }

  /**
   * Bytt kode. Bare hennes egen, og bare av henne: koden er nøkkelen til det
   * låste, så et bytte må låse opp alt med den gamle og igjen med den nye.
   * Går noe galt midtveis, er det bedre å ikke ha byttet i det hele tatt.
   */
  if (sti === '/kode' && metode === 'POST') {
    if (!erLykke || kropp?.hvem !== LYKKE) throw new Error('Her kan bare Lykke bytte sin egen kode.');
    const ny = String(kropp?.kode ?? '');
    if (ny.length < 6) throw new Error('Koden må være minst seks tegn.');
    if (!nokkel) throw new Error('Du må være logget inn med koden din for å bytte den.');

    const nyNokkel = await lagNokkel(ny);
    const låste = radene(await db.collection('dager').get()).filter((r) => r.skjult);

    // Alt låses opp først. Får vi ikke opp én av dem, byttes ingenting.
    const åpnet = [];
    for (const rad of låste) {
      const innhold = await låsOpp(nokkel, rad.skjult);
      if (!innhold) throw new Error('Fikk ikke låst opp alt. Koden er ikke byttet.');
      åpnet.push([rad.dato, innhold]);
    }

    for (const [dato, innhold] of åpnet) {
      await db.doc(`dager/${dato}`).update({ skjult: await lås(nyNokkel, innhold) });
    }
    await db.doc('oppsett/nokkel').set({ prove: await lås(nyNokkel, PROVE) });
    nokkel = nyNokkel;
    return { ok: true, hvem: LYKKE, lastOpp: åpnet.length };
  }

  if (sti === '/melding' && metode === 'POST') {
    const tekst = tekstFra(2000);
    if (!tekst) throw new Error('Tom melding.');
    await db.collection('meldinger').add({ fra: hvem, tekst, laget_kl: nå(), lest_kl: null });
    return { ok: true };
  }

  if (sti === '/meldinger/lest' && metode === 'POST') {
    const fra = erLykke ? MATHIAS : LYKKE;
    const snap = await db.collection('meldinger').where('fra', '==', fra).get();
    await Promise.all(radene(snap)
      .filter((m) => !m.lest_kl)
      .map((m) => db.doc(`meldinger/${m.id}`).update({ lest_kl: nå() })));
    return { ok: true };
  }

  if (sti === '/onske' && metode === 'POST') {
    const tekst = tekstFra(200);
    if (!tekst) throw new Error('Tomt ønske.');
    await db.collection('onsker').add({ tekst, laget_av: hvem, laget_kl: nå(), gjort_kl: null, gjort_av: null });
    return { ok: true };
  }

  const gjort = sti.match(/^\/onske\/(.+)\/gjort$/);
  if (gjort && metode === 'POST') {
    const doc = db.doc(`onsker/${gjort[1]}`);
    const snap = await doc.get();
    if (!snap.exists) throw new Error('Fant ikke ønsket.');
    // Samme knapp begge veier: huket av ved uhell skal kunne angres.
    const alt = snap.data().gjort_kl;
    await doc.update({ gjort_kl: alt ? null : nå(), gjort_av: alt ? null : hvem });
    return { ok: true, gjort: !alt };
  }

  const slett = sti.match(/^\/onske\/(.+)$/);
  if (slett && metode === 'DELETE') {
    await db.doc(`onsker/${slett[1]}`).delete();
    return { ok: true };
  }

  if (sti === '/brev' && metode === 'POST') {
    if (erLykke) throw new Error('Bare Mathias legger inn brev.');
    const tekst = tekstFra(4000);
    if (!tekst) throw new Error('Tomt brev.');
    await db.collection('brev').add({ tekst, laget_kl: nå(), apnet_kl: null });
    return { ok: true };
  }

  const åpne = sti.match(/^\/brev\/(.+)\/apne$/);
  if (åpne && metode === 'POST') {
    if (!erLykke) throw new Error('Ikke ditt å åpne.');
    const doc = db.doc(`brev/${åpne[1]}`);
    const snap = await doc.get();
    if (!snap.exists) throw new Error('Fant ikke brevet.');
    const rad = snap.data();
    if (!rad.apnet_kl) await doc.update({ apnet_kl: nå() });
    return { id: åpne[1], tekst: rad.tekst, laget_kl: rad.laget_kl };
  }

  throw new Error('Ukjent rute.');
}
