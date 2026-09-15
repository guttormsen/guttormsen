/**
 * Lykkeglasset i nettleseren.
 *
 * Alt tegnes fra JavaScript – det er lite nok innhold til at en malmotor bare
 * ville vært et mellomledd. Ingen rammeverk, ingen CDN, ingen sporing.
 *
 * Fila kjenner ikke til hvor dataene kommer fra. Alt går gjennom `api()` i
 * api.js, og den kan byttes ut uten at noe her endres.
 */
import { api, lastOpp, hentFil, VARSLER, KAN_FILER } from './api.js';

const REAKSJONER = ['❤️', '😂', '🥹', '✨'];

/* ---------- små hjelpere ---------- */

const NS = 'http://www.w3.org/2000/svg';

const lagNode = (tag, attrs = {}, barn = [], erSvg = false) => {
  const node = erSvg ? document.createElementNS(NS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const b of [].concat(barn)) {
    // Tomme barn siles bort. `0` og `''` dukker opp av seg selv fra uttrykk
    // som `liste.length && …`, og skal ikke ende som tekst på skjermen.
    if (!b) continue;
    node.append(b instanceof Node ? b : document.createTextNode(String(b)));
  }
  return node;
};

const el = (tag, attrs, barn) => lagNode(tag, attrs, barn, false);
const svg = (tag, attrs, barn) => lagNode(tag, attrs, barn, true);
const sti = (d, attrs = {}) => svg('path', { d, ...attrs });

const app = document.getElementById('app');

/** Lar et tekstfelt vokse med innholdet. Ett ord eller tre linjer, samme felt. */
function voksende(felt) {
  const juster = () => {
    felt.style.height = 'auto';
    felt.style.height = `${felt.scrollHeight}px`;
  };
  felt.addEventListener('input', juster);
  requestAnimationFrame(juster);
  return felt;
}
const fanerad = document.getElementById('faner');
const rolig = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Tegner en skjerm. Hvert kort nummereres, så de legger seg inn etter hverandre. */
function tegn(...barn) {
  const rene = barn.flat().filter(Boolean);
  app.replaceChildren(...rene);
  rene.forEach((node, i) => node.style?.setProperty('--i', i));
  app.scrollIntoView?.({ block: 'start' });
}

let brodTid;
function si(tekst) {
  const rute = document.getElementById('brodske');
  rute.textContent = tekst;
  rute.dataset.vis = 'ja';
  clearTimeout(brodTid);
  brodTid = setTimeout(() => { rute.dataset.vis = 'nei'; }, 3000);
}

/** Teller opp til et tall. Et lite blunk, ikke en forestilling. */
function tellOpp(node, mål, ms = 850) {
  if (rolig() || mål < 10) { node.textContent = String(mål); return; }
  const start = performance.now();
  const steg = (nå) => {
    const t = Math.min(1, (nå - start) / ms);
    node.textContent = String(Math.round(mål * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(steg);
  };
  requestAnimationFrame(steg);
}

/* ---------- humør og datoer ---------- */

const HUMOR = [
  { verdi: 1, fjes: '😞', ord: 'Veldig tung' },
  { verdi: 2, fjes: '🙁', ord: 'Tung' },
  { verdi: 3, fjes: '😐', ord: 'Midt på treet' },
  { verdi: 4, fjes: '🙂', ord: 'God' },
  { verdi: 5, fjes: '😄', ord: 'Skikkelig god' },
];
const humorOrd = (n) => HUMOR.find((h) => h.verdi === n)?.ord ?? '';
const humorFjes = (n) => HUMOR.find((h) => h.verdi === n)?.fjes ?? '';

const klokkeslett = (iso) =>
  (iso ? new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : '');

const somDato = (nokkel) => {
  const [y, m, d] = nokkel.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const datoOrd = (nokkel, form = {}) => (nokkel
  ? somDato(nokkel).toLocaleDateString('nb-NO', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC', ...form,
  })
  : '');

const kortDato = (nokkel) => (nokkel
  ? somDato(nokkel).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  : '');

const flyttDag = (nokkel, dager) => {
  const t = somDato(nokkel).getTime() + dager * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

/** Mandag som første dag i uka, slik kalendere ser ut her. */
const ukedagFra0 = (dato) => (dato.getUTCDay() + 6) % 7;

/* ---------- glasset som figur ---------- */

// Radene fylles nedenfra, tre og to om hverandre, så det ser ut som ting som
// har lagt seg oppå hverandre – ikke som et rutenett.
const PLASSER = [
  [31, 108], [50, 108], [69, 108],
  [40, 95], [59, 95],
  [31, 82], [50, 82], [69, 82],
  [40, 69], [59, 69],
  [31, 56], [50, 56], [69, 56],
  [40, 43], [59, 43],
];
const FARGER = ['#e0806a', '#f0a92f', '#cf9a4e', '#d9835f', '#e6b85c'];

/**
 * Krukka, med så mange ting oppi som hun har skrevet. Ett lag per tretti, så
 * den ikke er full etter en uke.
 */
function glassFigur(antall = 0, klasse = 'glass') {
  const n = Math.max(0, Math.min(PLASSER.length, Math.ceil(antall / 30)));
  const innhold = svg('g', { class: 'innhold' }, PLASSER.slice(0, n).map(([x, y], i) => {
    const sirkel = svg('circle', {
      cx: x, cy: y, r: i % 3 === 1 ? 7 : 8, fill: FARGER[i % FARGER.length],
    });
    sirkel.style.setProperty('--i', i);
    return sirkel;
  }));

  return svg('svg', {
    class: klasse, viewBox: '0 0 100 132', role: 'img',
    'aria-label': antall ? `Glasset, med ${antall} gode ting i` : 'Et tomt glass',
  }, [
    svg('rect', { x: 30, y: 4, width: 40, height: 13, rx: 5, fill: 'var(--lokk)' }),
    svg('rect', { x: 35, y: 15, width: 30, height: 9, fill: 'var(--lokk)', opacity: '.5' }),
    svg('rect', {
      x: 17, y: 22, width: 66, height: 104, rx: 18,
      fill: 'var(--glass-inni)', stroke: 'var(--glass-kant)', 'stroke-width': 4,
    }),
    innhold,
    // Lysstripa i glasset. Den blinker sakte, som lys som beveger seg utenfor.
    svg('rect', {
      class: 'skinn', x: 26, y: 34, width: 9, height: 78, rx: 5,
      fill: 'var(--tekst)', opacity: '.6',
    }),
  ]);
}

/* ---------- ikoner ---------- */

const ikon = (...d) => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, d.map((x) => sti(x)));
const IKONER = {
  idag: () => ikon('M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z'),
  kalender: () => ikon('M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5z', 'M8 3v4', 'M16 3v4', 'M4 10h16'),
  glasset: () => ikon('M8.5 3h7', 'M7 7.5A1.5 1.5 0 0 1 8.5 6h7A1.5 1.5 0 0 1 17 7.5V19a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z', 'M10 14h.01', 'M14 16h.01'),
  meldinger: () => ikon('M21 11.5a7.5 7.5 0 0 1-11 6.6L4 20l1.9-5.1A7.5 7.5 0 1 1 21 11.5z'),
  tannhjul: () => ikon('M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z', 'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.4 14h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.2-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.4v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.3 1z'),
  tilbake: () => ikon('M15 19l-7-7 7-7'),
  binders: () => ikon('M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.9-2.9l8.5-8.5'),
};

/**
 * Toppen av en skjerm. Dato og tittel til venstre, veier ut til høyre.
 * Navigasjon er ikke innhold, så den er lett i uttrykket.
 */
function hode(tittel, { stempel = null, handlinger = [] } = {}) {
  return el('div', { class: 'topp' }, [
    el('div', {}, [
      stempel && el('p', { class: 'stempel', text: stempel }),
      el('h1', { style: stempel ? 'margin-top:.3rem' : null, text: tittel }),
    ]),
    handlinger.length ? el('div', { class: 'hode' }, handlinger) : null,
  ]);
}

const knappIkon = (navn, merkelapp, ved) =>
  el('button', { type: 'button', 'aria-label': merkelapp, title: merkelapp, onclick: ved }, [IKONER[navn]()]);

/* ---------- økta ---------- */

let tilstand = null;
let fane = 'idag';
let visManed = null;
let valgtDag = null;

/* ---------- innlogging ---------- */

function visLoggInn(feilmelding) {
  fanerad.replaceChildren();
  let hvem = null;
  const kode = el('input', { type: 'password', id: 'kode', autocomplete: 'current-password' });

  const knapper = ['lykke', 'mathias'].map((navn) =>
    el('button', {
      type: 'button',
      'aria-pressed': 'false',
      'data-navn': navn,
      text: navn === 'lykke' ? 'Lykke' : 'Mathias',
      onclick: () => {
        hvem = navn;
        for (const k of knapper) k.setAttribute('aria-pressed', String(k.dataset.navn === navn));
        kode.focus();
      },
    }));

  const send = async () => {
    if (!hvem) return si('Hvem er du?');
    try {
      await api('/logg-inn', { metode: 'POST', kropp: { hvem, kode: kode.value } });
      start();
    } catch (e) {
      visLoggInn(e.message);
    }
  };
  kode.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  tegn(
    el('div', { class: 'portal' }, [
      glassFigur(330),
      el('h1', { text: 'Lykkeglasset' }),
      el('p', { class: 'liten svak', text: 'Tre gode ting om dagen.' }),
    ]),
    el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: 'Hvem er du?' }),
      el('div', { class: 'rad', style: 'margin:.7rem 0 1.2rem' }, knapper),
      el('label', { for: 'kode', text: 'Kode' }),
      kode,
      feilmelding && el('p', { class: 'feil', text: feilmelding }),
      el('div', { style: 'margin-top:1.1rem' }, [
        el('button', { class: 'hoved', type: 'button', onclick: send, text: 'Lukk opp' }),
      ]),
    ]),
    el('p', { class: 'liten svak midt', text: 'Siden husker deg i et halvt år.' }),
  );
}

/* ---------- kveldsrunden ---------- */

function gjenskinn(verdi) {
  if (rolig()) return;
  const lag = el('div', { class: 'gjenskinn' });
  lag.style.setProperty('--f', `var(--h${verdi})`);
  document.body.append(lag);
  setTimeout(() => lag.remove(), 800);
}

async function kveldsrunden(t, ferdig, dato = t.dato) {
  const gammel = dato !== t.dato;
  // En dag som har vært må hentes; dagens ligger alt i tilstanden.
  let fra = t.idag;
  let sporsmal = t.sporsmal;
  if (gammel) {
    tegn(el('p', { class: 'laster', text: 'Henter dagen …' }));
    try {
      const hentet = await api(`/dag?dato=${dato}`);
      fra = hentet.dag;
      sporsmal = hentet.sporsmal;
    } catch { fra = null; }
  }

  const utkast = {
    humor: fra?.humor ?? null,
    gode: [0, 1, 2].map((i) => fra?.gode_ting?.[i]?.tekst ?? ''),
    omOss: [0, 1, 2].map((i) => Boolean(fra?.gode_ting?.[i]?.om_oss)),
    tungt: fra?.tungt ?? '',
    svar: fra?.svar ?? '',
    behov: fra?.behov ?? null,
    privat: fra ? fra.privat : false,
  };

  let steg = 0;
  fanerad.replaceChildren();
  // Si fra at hun er i gang. Det er den ene hendelsen serveren ikke kan se selv.
  api('/hendelse', { metode: 'POST', kropp: { slag: 'begynt' } }).catch(() => {});

  const ramme = (tittel, undertittel, innhold, { videre = 'Videre', kanVidere = true, siste = false } = {}) =>
    tegn(el('div', { class: 'steg' }, [
      el('div', { class: 'framdrift' }, [0, 1, 2, 3].map((i) => el('i', { 'data-pa': i <= steg ? 'ja' : 'nei' }))),
      el('p', { class: 'stempel', text: gammel ? `${datoOrd(dato)} · steg ${steg + 1} av 4` : `Steg ${steg + 1} av 4` }),
      el('h1', { text: tittel }),
      undertittel && el('p', { class: 'svak liten', style: 'margin-bottom:1.3rem', text: undertittel }),
      el('div', { class: 'kort' }, innhold),
      el('div', { class: 'stegrad' }, [
        el('button', {
          class: 'hoved', type: 'button', disabled: !kanVidere,
          onclick: () => (siste ? lagre() : (steg += 1, vis())),
          text: videre,
        }),
        el('button', {
          class: 'blank', type: 'button',
          onclick: () => (steg === 0 ? ferdig() : (steg -= 1, vis())),
          text: steg === 0 ? 'Avbryt' : 'Tilbake',
        }),
      ]),
    ]));

  const stegHumor = () => {
    const knapper = HUMOR.map((h) =>
      el('button', {
        type: 'button',
        'data-verdi': h.verdi,
        'aria-pressed': String(utkast.humor === h.verdi),
        onclick: () => {
          utkast.humor = h.verdi;
          gjenskinn(h.verdi);
          vis();
          // Å velge er hele steget. Et ekstra trykk på «Videre» er ett trykk
          // for mye – men valget skal rekke å vises først.
          setTimeout(() => { if (steg === 0) { steg = 1; vis(); } }, 380);
        },
      }, [h.fjes, el('span', { text: h.ord })]));
    ramme(
      gammel ? 'Hvordan var den dagen?' : 'Hvordan var dagen?',
      gammel ? 'Du fyller ut en dag som har vært. Mathias får én stille beskjed om det, ikke et varsel.' : datoOrd(dato),
      [el('div', { class: 'humor' }, knapper)],
      { kanVidere: Boolean(utkast.humor) },
    );
  };

  const stegGode = () => {
    const felt = [0, 1, 2].map((i) => {
      // Ett ord eller tre linjer – begge deler skal få plass, og være lesbare
      // etterpå. Derfor et felt som vokser, ikke en linje som klipper.
      const inn = voksende(el('textarea', {
        class: 'vokser', rows: 1, value: utkast.gode[i], id: `god-${i}`,
        placeholder: ['Noe som var fint …', 'Noe mer …', 'Og én til …'][i],
        oninput: (e) => { utkast.gode[i] = e.target.value; },
      }));
      inn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        document.getElementById(`god-${i + 1}`)?.focus();
      });
      return el('div', { style: i < 2 ? 'margin-bottom:1.1rem' : null }, [
        el('label', { for: `god-${i}`, text: `${i + 1}.` }),
        inn,
        el('label', { class: 'hake' }, [
          el('input', {
            type: 'checkbox', checked: utkast.omOss[i],
            onchange: (e) => { utkast.omOss[i] = e.target.checked; },
          }),
          el('span', { text: 'Dette handler om oss' }),
        ]),
      ]);
    });
    ramme('Tre gode ting', 'Ett ord eller tre linjer – begge deler duger. Enter hopper videre.', felt);
  };

  const stegTungt = () => {
    // Spørsmålet veksler fra dag til dag. Et skjema som ser likt ut 365 kvelder
    // på rad blir et skjema; dette blir et spørsmål.
    ramme(sporsmal, 'Begge feltene kan stå tomme.', [
      el('label', { for: 'svar', text: 'Svar' }),
      voksende(el('textarea', {
        class: 'vokser', value: utkast.svar, id: 'svar', rows: 2,
        placeholder: 'Skriv om du vil …',
        oninput: (e) => { utkast.svar = e.target.value; },
      })),
      el('label', { for: 'tungt', style: 'margin-top:1.2rem', text: 'Var noe tungt i dag?' }),
      el('textarea', {
        value: utkast.tungt, id: 'tungt', rows: 3,
        placeholder: 'Dette er ditt. Det deles bare hvis du sier fra.',
        oninput: (e) => { utkast.tungt = e.target.value; },
      }),
    ]);
  };

  const stegBehov = () => {
    const brikker = Object.entries(t.behov).map(([nokkel, b]) =>
      el('button', {
        type: 'button',
        'aria-pressed': String(utkast.behov === nokkel),
        onclick: () => { utkast.behov = utkast.behov === nokkel ? null : nokkel; vis(); },
        text: b.etikett,
      }));

    // Ett valg, ikke tre. Enten går dagen til Mathias, eller så er den hennes.
    const bryter = !t.delt && el('div', { class: 'brikker', style: 'margin-top:1.4rem' }, [
      el('button', {
        type: 'button', 'aria-pressed': String(!utkast.privat),
        onclick: () => { utkast.privat = false; vis(); }, text: 'Del med Mathias',
      }),
      el('button', {
        type: 'button', 'aria-pressed': String(utkast.privat),
        onclick: () => { utkast.privat = true; vis(); }, text: 'Bare for meg',
      }),
    ]);

    ramme('Hva trenger du?', 'Velg én, eller ingen.', [
      el('div', { class: 'brikker' }, brikker),
      bryter,
      t.delt && el('p', {
        class: 'liten svak', style: 'margin:1.3rem 0 0',
        text: 'Denne appen står i delt modus: alt du fører her, ser Mathias.',
      }),
      el('h3', { style: 'margin-top:1.4rem', text: 'Dette ser Mathias' }),
      forhåndsvisning(utkast, t.behov),
    ], { videre: 'Lagre dagen', siste: true });
  };

  const lagre = async () => {
    try {
      const svar = await api('/dag', {
        metode: 'POST',
        kropp: {
          dato,
          humor: utkast.humor,
          gode_ting: utkast.gode
            .map((tekst, i) => ({ tekst, om_oss: utkast.omOss[i] }))
            .filter((g) => g.tekst.trim()),
          tungt: utkast.tungt,
          svar: utkast.svar,
          behov: utkast.behov,
          privat: utkast.privat,
        },
      });
      si(svar.sendt.length ? 'Lagret. Mathias fikk beskjed.' : 'Lagret.');
      ferdig();
    } catch (e) {
      si(e.message);
    }
  };

  const vis = () => [stegHumor, stegGode, stegTungt, stegBehov][steg]();
  vis();
}

/**
 * Sier med ord hva som går videre. Den bygger ikke selve varselteksten – den
 * finnes ett sted, på serveren – men den skal ikke kunne overraske.
 */
function forhåndsvisning(u, behov) {
  if (u.privat) {
    return el('div', { class: 'sendes' }, [
      'Ingenting av dette går videre. Dagen blir liggende her, bare for deg.',
      '\n\nMathias ser at du førte noe denne datoen – ikke hva.',
    ].join(''));
  }

  const linjer = [`Dagen: ${u.humor ?? '–'} av 5 – ${humorOrd(u.humor).toLowerCase()}`];
  if (u.behov) linjer.push(`Du trenger: ${behov[u.behov].etikett.toLowerCase()}`);
  const gode = u.gode.filter((g) => g.trim());
  if (gode.length) linjer.push('', 'Tre gode ting:', ...gode.map((g) => `  • ${g}`));
  if (u.tungt.trim()) linjer.push('', `Du skrev: «${u.tungt.trim()}»`);

  const lyd = u.humor <= 2 || u.humor === 5 || u.behov === 'ringe' || u.behov === 'komme';
  linjer.push('', VARSLER
    ? (lyd ? '→ Han får varsel på telefonen nå.' : '→ Han får en stille beskjed nå.')
    : '→ Det står her når han åpner appen.');
  return el('div', { class: 'sendes' }, linjer.join('\n'));
}

/* ---------- felles biter ---------- */

const godeTingListe = (gode) =>
  el('ul', { class: 'liste' }, gode.map((g) =>
    el('li', {}, [g.om_oss && el('span', { class: 'merke', text: '💞' }), g.tekst])));

/** Dagen satt til å leses – ikke en liste med felter. */
function dagsark(dag, { egen }) {
  if (!dag) return el('p', { class: 'hjelp', style: 'margin-top:.9rem', text: 'Ingenting ført denne dagen.' });
  if (dag.privat && !egen) {
    return el('p', { class: 'hjelp', style: 'margin-top:.9rem', text: 'Ført, men holdt for seg selv.' });
  }

  return el('div', { class: 'ark', style: 'margin-top:1.1rem' }, [
    el('p', { class: 'dato', text: datoOrd(dag.dato, { year: 'numeric' }) }),
    el('p', { class: 'humor-linje' }, [
      el('em', { text: humorFjes(dag.humor) }),
      `${humorOrd(dag.humor)}${dag.privat ? ' · bare for henne' : ''}`,
    ]),
    dag.behov && el('p', { class: 'liten svak', style: 'margin:-.6rem 0 1rem' }, [
      el('strong', { text: 'Trengte: ' }),
      (tilstand?.behov?.[dag.behov]?.etikett ?? dag.behov).toLowerCase(),
    ]),
    dag.gode_ting?.length
      ? el('ul', { class: 'gode' }, dag.gode_ting.map((g) =>
        el('li', { 'data-oss': g.om_oss ? 'ja' : null }, [g.om_oss && '💞', g.tekst])))
      : null,
    dag.holdt_gode && el('p', { class: 'hjelp', text: 'De gode tingene beholdt hun for seg selv.' }),
    dag.svar && el('div', { class: 'felt' }, [
      el('p', { class: 'stempel', text: dag.sporsmal }),
      el('p', { text: dag.svar }),
    ]),
    dag.tungt && el('div', { class: 'felt' }, [
      el('p', { class: 'stempel', text: 'Det som var tungt' }),
      el('p', { text: dag.tungt }),
    ]),
    dag.holdt_tungt && el('p', { class: 'hjelp', text: 'Noe var tungt. Det er ikke delt.' }),
    mediekort(dag, { egen }),
    egen && arkbunn(dag),
  ]);
}

/**
 * Endre eller slette en dag som er ført.
 *
 * Å slette er ikke det samme som å angre på et ord, så sletteknappen spør
 * én gang først – men i selve knappen, ikke i en boks som spretter opp og
 * må lukkes. Angrer man på spørsmålet, forsvinner det av seg selv.
 */
function arkbunn(dag) {
  let vent = null;

  const slett = el('button', {
    class: 'blank liten-knapp fare', type: 'button', text: 'Slett dagen',
    onclick: async () => {
      if (!vent) {
        slett.textContent = 'Sikker? Trykk igjen';
        slett.dataset.sikker = 'ja';
        vent = setTimeout(() => {
          vent = null;
          slett.textContent = 'Slett dagen';
          delete slett.dataset.sikker;
        }, 5000);
        return;
      }
      clearTimeout(vent);
      vent = null;
      slett.disabled = true;
      try {
        await api(`/dag?dato=${dag.dato}`, { metode: 'DELETE' });
        valgtDag = null;
        si(`${datoOrd(dag.dato)} er slettet.`);
        await start();
      } catch (e) {
        slett.disabled = false;
        slett.textContent = 'Slett dagen';
        delete slett.dataset.sikker;
        si(e.message);
      }
    },
  });

  return el('div', { class: 'arkbunn' }, [
    el('button', {
      class: 'blank liten-knapp', type: 'button', text: 'Endre dagen',
      onclick: () => kveldsrunden(tilstand, start, dag.dato),
    }),
    slett,
  ]);
}

/* ---------- bilder og lyd ---------- */

/**
 * Krymper bildet før det sendes.
 *
 * Et telefonbilde er fire megapiksler og fem megabyte. På skjermen her er det
 * en firkant på hundre piksler, og i årsboka er det et minne – ingen av
 * delene trenger mer enn halvannen tusen piksler.
 */
async function krympBilde(fil, maks = 1600) {
  const kilde = await createImageBitmap(fil);
  const skala = Math.min(1, maks / Math.max(kilde.width, kilde.height));
  const b = Math.round(kilde.width * skala);
  const h = Math.round(kilde.height * skala);
  const lerret = new OffscreenCanvas(b, h);
  lerret.getContext('2d').drawImage(kilde, 0, 0, b, h);
  kilde.close?.();
  return lerret.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
}

/** Bildene og lydklippene som hører til en dag, med knapper for å legge til. */
function mediekort(dag, { egen }) {
  if (!KAN_FILER || !dag) return null;
  const filer = dag.filer ?? [];
  if (!filer.length && !egen) return null;

  const rute = el('div', { class: 'media' }, filer.map((f) => (f.slag === 'lyd'
    ? el('div', { class: 'lyd' }, [
      el('audio', { controls: true, src: `/api/fil/${f.id}`, preload: 'none' }),
      egen && el('button', {
        class: 'blank', type: 'button', text: '×', 'aria-label': 'Slett lydklippet',
        onclick: () => slett(f.id),
      }),
    ])
    : el('figure', {}, [
      el('img', { src: `/api/fil/${f.id}`, alt: `Bilde fra ${datoOrd(dag.dato)}`, loading: 'lazy' }),
      egen && el('button', { type: 'button', text: '×', 'aria-label': 'Slett bildet', onclick: () => slett(f.id) }),
    ]))));

  async function slett(id) {
    try { await api(`/fil/${id}`, { metode: 'DELETE' }); await start(); }
    catch (e) { si(e.message); }
  }

  if (!egen) return rute;

  const velger = el('input', {
    type: 'file', accept: 'image/*', id: 'bildevelger', style: 'display:none',
    onchange: async (e) => {
      const fil = e.target.files?.[0];
      e.target.value = '';
      if (!fil) return;
      si('Laster opp …');
      try {
        const liten = await krympBilde(fil);
        await lastOpp(`/fil?dato=${dag.dato}&slag=bilde`, liten, 'image/jpeg');
        await start();
      } catch (feil) { si(feil.message); }
    },
  });

  const knapper = [
    el('button', {
      type: 'button', text: '📷 Legg til bilde',
      onclick: () => velger.click(),
    }),
  ];

  // Opptak er valgfritt: knappen finnes bare der nettleseren faktisk kan det.
  if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
    let opptaker = null;
    const knapp = el('button', {
      type: 'button', text: '🎙 Ta opp',
      onclick: async () => {
        if (opptaker) { opptaker.stop(); return; }
        try {
          const strøm = await navigator.mediaDevices.getUserMedia({ audio: true });
          const biter = [];
          opptaker = new MediaRecorder(strøm);
          opptaker.ondataavailable = (e) => biter.push(e.data);
          opptaker.onstop = async () => {
            for (const spor of strøm.getTracks()) spor.stop();
            knapp.dataset.tarOpp = 'nei';
            knapp.textContent = '🎙 Ta opp';
            opptaker = null;
            const lyd = new Blob(biter, { type: biter[0]?.type || 'audio/webm' });
            if (lyd.size < 1200) return si('For kort til å bli noe.');
            si('Laster opp …');
            try {
              await lastOpp(`/fil?dato=${dag.dato}&slag=lyd`, lyd, lyd.type.split(';')[0]);
              await start();
            } catch (feil) { si(feil.message); }
          };
          opptaker.start();
          knapp.dataset.tarOpp = 'ja';
          knapp.textContent = '⏹ Stopp';
        } catch {
          si('Fikk ikke tilgang til mikrofonen.');
        }
      },
    });
    knapper.push(knapp);
  }

  return el('div', {}, [rute, velger, el('div', { class: 'medieknapper' }, knapper)]);
}

/* ---------- fanene ---------- */

const FANER = [
  { id: 'idag', navn: 'I dag' },
  { id: 'kalender', navn: 'Kalender' },
  { id: 'glasset', navn: 'Glasset' },
  { id: 'meldinger', navn: 'Meldinger' },
];

function uleste(t) {
  const fra = t.hvem === 'lykke' ? 'mathias' : 'lykke';
  return t.meldinger.filter((m) => m.fra === fra && !m.lest_kl).length;
}

function tegnFaner(t) {
  const n = uleste(t);
  fanerad.replaceChildren(...FANER.map((f) =>
    el('button', {
      type: 'button',
      'aria-current': fane === f.id ? 'page' : null,
      onclick: () => { fane = f.id; visApp(t); },
    }, [
      IKONER[f.id](),
      f.id === 'meldinger' && n > 0 && el('span', { class: 'duppedott' }),
      el('span', { text: f.navn }),
    ])));
}

function visApp(t) {
  tilstand = t;
  tegnFaner(t);
  const tegner = { idag: faneIdag, kalender: faneKalender, glasset: faneGlasset, meldinger: faneMeldinger }[fane];
  tegner(t);
  app.firstElementChild?.classList.add('fane-inn');
}

/* ---------- fane: i dag ---------- */

function faneIdag(t) {
  const erLykke = t.hvem === 'lykke';
  const dag = t.idag;
  const fraDen_andre = t.meldinger.filter((m) => m.fra !== t.hvem);
  const siste = fraDen_andre.at(-1);
  const nyMelding = siste && !siste.lest_kl && siste;

  const hilsen = nyMelding && el('div', { class: 'kort løftet' }, [
    el('p', { class: 'stempel', text: erLykke ? 'Ny melding fra Mathias' : 'Ny melding fra Lykke' }),
    el('p', {
      style: 'white-space:pre-wrap;font-family:var(--serif);font-size:1.15rem;line-height:1.6;margin:.6rem 0 .3rem',
      text: nyMelding.tekst,
    }),
    el('p', { class: 'liten svak', text: `${klokkeslett(nyMelding.laget_kl)} · ${kortDato(nyMelding.laget_kl.slice(0, 10))}` }),
    el('button', {
      class: 'blank liten-knapp', type: 'button', style: 'margin-top:.4rem',
      onclick: () => { fane = 'oss'; visApp(t); },
      text: 'Svar →',
    }),
  ]);

  if (erLykke) {
    const dagensKort = dag
      ? el('div', { class: 'kort' }, [
        el('p', { class: 'stempel', text: `Ført ${klokkeslett(dag.skrevet_kl)}${dag.privat ? ' · bare for deg' : ''}` }),
        el('h2', { style: 'margin-top:.45rem', text: `${humorFjes(dag.humor)} ${humorOrd(dag.humor)}` }),
        dag.gode_ting.length && godeTingListe(dag.gode_ting),
        dag.svar && el('div', { style: 'margin-top:.8rem' }, [
          el('p', { class: 'stempel', text: dag.sporsmal }),
          el('p', { style: 'margin:.35rem 0 0', text: dag.svar }),
        ]),
        mediekort(dag, { egen: true }),
        arkbunn(dag),
      ])
      : el('div', { class: 'kort løftet' }, [
        el('div', { class: 'glass-rad' }, [
          glassFigur(t.antall_gode_ting),
          el('div', {}, [
            el('h2', { text: 'Kveldsrunden' }),
            el('p', { class: 'svak liten', style: 'margin:0', text: 'Tre gode ting, og hvordan dagen var. Under ett minutt.' }),
            t.delt && el('p', {
              class: 'liten svak', style: 'margin:.5rem 0 0',
              text: 'Delt modus: alt du fører her, ser Mathias.',
            }),
          ]),
        ]),
        el('button', {
          class: 'hoved', type: 'button', style: 'margin-top:1rem',
          onclick: () => kveldsrunden(t, start), text: 'Begynn',
        }),
      ]);

    const brev = t.brev.length && el('div', { class: 'kort' }, [
      el('h2', { text: t.brev.length === 1 ? '💌 Et brev ligger klart' : `💌 ${t.brev.length} brev ligger klare` }),
      el('p', { class: 'svak liten', text: 'Skrevet på forhånd, til en dag du trenger det.' }),
      el('button', {
        class: 'hoved', type: 'button', text: 'Åpne ett', style: 'margin-top:.6rem',
        onclick: async () => {
          try {
            const b = await api(`/brev/${t.brev[0].id}/apne`, { metode: 'POST' });
            fanerad.replaceChildren();
            tegn(el('div', { class: 'kort' }, [
              el('p', { class: 'stempel', text: 'Fra Mathias' }),
              el('p', { class: 'brev-apen', style: 'margin-top:.8rem', text: b.tekst }),
              el('button', { class: 'blank', type: 'button', onclick: start, text: 'Lukk' }),
            ]));
          } catch (e) { si(e.message); }
        },
      }),
    ]);

    const ifjor = t.ifjor && !t.ifjor.privat && el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: 'På denne dagen i fjor' }),
      el('p', { class: 'svak liten', style: 'margin:.45rem 0 0', text: `${humorFjes(t.ifjor.humor)} ${humorOrd(t.ifjor.humor)}` }),
      t.ifjor.gode_ting.length && godeTingListe(t.ifjor.gode_ting),
    ]);

    tegn(
      hode('God kveld, Lykke', {
        stempel: datoOrd(t.dato, { year: undefined }),
        handlinger: [knappIkon('tannhjul', 'Innstillinger', () => visInnstillinger(t))],
      }),
      hilsen,
      dagensKort,
      brev,
      ifjor,
      onskelisteSeksjon(t),
    );
    return;
  }

  /* ---- hans side ---- */

  const u = t.uke;
  const retning = u.snitt != null && u.forrige_snitt != null
    ? u.snitt - u.forrige_snitt
    : null;

  tegn(
    hode('Hos Lykke', {
      stempel: datoOrd(t.dato, { year: undefined }),
      handlinger: [knappIkon('tannhjul', 'Innstillinger', () => visInnstillinger(t))],
    }),
    hilsen,
    el('div', { class: dag && !dag.privat && dag.humor <= 2 ? 'kort løftet' : 'kort' }, dag
      ? dag.privat
        ? [
          el('p', { class: 'stempel', text: 'I dag' }),
          el('h2', { style: 'margin-top:.45rem', text: 'Holdt for seg selv' }),
          el('p', { class: 'svak liten', style: 'margin:0', text: 'Hun har ført dagen, men valgt å ikke dele den.' }),
        ]
        : [
          el('p', { class: 'stempel', text: `I dag · ført ${klokkeslett(dag.skrevet_kl)}` }),
          el('h2', { style: 'margin-top:.45rem', text: `${humorFjes(dag.humor)} ${humorOrd(dag.humor)}` }),
          dag.behov && el('p', { style: 'margin-top:.6rem' }, [
            el('strong', { text: 'Hun trenger: ' }),
            t.behov[dag.behov].etikett.toLowerCase(),
          ]),
          dag.gode_ting.length && godeTingListe(dag.gode_ting),
          dag.svar && el('div', { style: 'margin-top:.8rem' }, [
            el('p', { class: 'stempel', text: dag.sporsmal }),
            el('p', { style: 'margin:.35rem 0 0', text: dag.svar }),
          ]),
          dag.holdt_gode && el('p', { class: 'liten svak', text: 'De gode tingene beholdt hun for seg selv.' }),
          dag.tungt && el('p', { class: 'sendes', style: 'margin-top:.7rem', text: dag.tungt }),
          dag.holdt_tungt && el('p', { class: 'liten svak', style: 'margin-top:.7rem', text: 'Noe var tungt. Hun valgte å ikke dele det.' }),
          mediekort(dag, { egen: false }),
        ]
      : [
        el('p', { class: 'stempel', text: 'I dag' }),
        el('h2', { style: 'margin-top:.45rem', text: 'Ikke ført ennå' }),
        t.sist_skrevet && el('p', { class: 'svak liten', style: 'margin:0', text: `Sist: ${datoOrd(t.sist_skrevet)}` }),
      ]),
    el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: 'Sju siste dagene' }),
      el('div', { class: 'tall-rad', style: 'margin-top:.7rem' }, [
        el('div', { class: 'tall-rute' }, [
          el('b', { class: 'tall', text: u.snitt == null ? '–' : u.snitt.toFixed(1) }),
          el('span', { text: 'i snitt av 5' }),
        ]),
        el('div', { class: 'tall-rute' }, [
          el('b', { class: 'tall', text: String(u.gode) }),
          el('span', { text: 'gode dager' }),
        ]),
        el('div', { class: 'tall-rute' }, [
          el('b', { class: 'tall', text: String(u.tunge) }),
          el('span', { text: 'tunge dager' }),
        ]),
      ]),
      retning != null && Math.abs(retning) >= 0.2 && el('p', {
        class: 'retning',
        'data-vei': retning > 0 ? 'opp' : 'ned',
        style: 'margin:.8rem 0 0',
        text: retning > 0
          ? `↑ ${retning.toFixed(1)} bedre enn uka før`
          : `↓ ${Math.abs(retning).toFixed(1)} tyngre enn uka før`,
      }),
      u.behov.length > 0 && el('p', { class: 'liten svak', style: 'margin:.6rem 0 0' }, [
        'Hun har bedt om: ',
        [...new Set(u.behov)].map((b) => t.behov[b].etikett.toLowerCase()).join(', '),
      ]),
    ]),
    el('div', { class: 'seksjon' }, [
      el('h2', { text: 'Om oss' }),
      t.om_oss.length
        ? el('ul', { class: 'liste' }, t.om_oss.slice(0, 5).map((g) =>
          el('li', {}, [g.tekst, el('div', { class: 'liten svak', text: kortDato(g.dato) })])))
        : el('p', { class: 'hjelp', text: 'Ingenting merket «om oss» ennå.' }),
    ]),
    onskelisteSeksjon(t),
    brevSeksjon(t),
  );
}

/** Ting dere skal gjøre. Hører hjemme sammen med dagen, ikke med samtalen. */
function onskelisteSeksjon(t) {
  const felt = el('input', { type: 'text', id: 'onske', placeholder: 'Noe vi skal gjøre …' });
  const leggTil = async () => {
    const tekst = felt.value.trim();
    if (!tekst) return;
    felt.value = '';
    try { await api('/onske', { metode: 'POST', kropp: { tekst } }); await start(); }
    catch (e) { si(e.message); }
  };
  felt.addEventListener('keydown', (e) => { if (e.key === 'Enter') leggTil(); });

  const igjen = t.onsker.filter((o) => !o.gjort_kl).length;
  return el('div', { class: 'seksjon' }, [
    el('h2', { text: `Ønskelista${igjen ? ` · ${igjen} igjen` : ''}` }),
    t.onsker.length
      ? el('div', { class: 'onsker' }, t.onsker.map((o) =>
        el('div', { class: 'onske', 'data-gjort': o.gjort_kl ? 'ja' : null }, [
          el('button', {
            class: 'kryss', type: 'button',
            'aria-label': o.gjort_kl ? 'Angre' : 'Huk av',
            text: o.gjort_kl ? '✓' : '',
            onclick: async () => {
              try { await api(`/onske/${o.id}/gjort`, { metode: 'POST' }); await start(); }
              catch (e) { si(e.message); }
            },
          }),
          el('p', {}, [
            o.tekst,
            el('span', { class: 'hvem', text: ` · ${o.laget_av === t.hvem ? 'du' : (o.laget_av === 'lykke' ? 'Lykke' : 'Mathias')}` }),
          ]),
          el('button', {
            class: 'blank fjern', type: 'button', text: '×', 'aria-label': 'Fjern',
            onclick: async () => {
              try { await api(`/onske/${o.id}`, { metode: 'DELETE' }); await start(); }
              catch (e) { si(e.message); }
            },
          }),
        ])))
      : el('p', { class: 'hjelp', text: 'Tom foreløpig. Hva har dere lyst til?' }),
    el('div', { class: 'skrivefelt', style: 'margin-top:.7rem' }, [
      felt,
      el('button', { class: 'hoved', type: 'button', onclick: leggTil, 'aria-label': 'Legg til', text: '+' }),
    ]),
  ]);
}

/** Brevene han legger inn på forhånd. */
function brevSeksjon(t) {
  const felt = el('textarea', { id: 'brev', placeholder: 'Noe hun skal lese når det er vanskelig …' });
  const uåpnet = t.brev.filter((b) => !b.apnet_kl).length;
  return el('div', { class: 'seksjon' }, [
    el('h2', { text: 'Brev til en dårlig dag' }),
    el('p', {
      class: 'hjelp',
      text: `${uåpnet === 0 ? 'Ingen ligger klare' : uåpnet === 1 ? 'Ett ligger klart' : `${uåpnet} ligger klare`}. Hun får tilbud om ett når dagen er tung.`,
    }),
    felt,
    el('button', {
      class: 'hoved', type: 'button', style: 'margin-top:.7rem', text: 'Legg i glasset',
      onclick: async () => {
        if (!felt.value.trim()) return si('Tomt brev.');
        try { await api('/brev', { metode: 'POST', kropp: { tekst: felt.value } }); si('Lagt inn.'); await start(); }
        catch (e) { si(e.message); }
      },
    }),
    t.brev.length ? el('ul', { class: 'liste', style: 'margin-top:.9rem' }, t.brev.map((b) =>
      el('li', { class: 'liten svak' },
        `${kortDato(b.laget_kl.slice(0, 10))} – ${b.apnet_kl ? `åpnet ${kortDato(b.apnet_kl.slice(0, 10))}` : 'ligger klart'}`))) : null,
  ]);
}

/* ---------- fane: kalender ---------- */

function faneKalender(t) {
  const kart = new Map(t.historikk.map((d) => [d.dato, d]));
  visManed ??= t.dato.slice(0, 7);
  const [år, md] = visManed.split('-').map(Number);
  const først = new Date(Date.UTC(år, md - 1, 1));
  const dagerIMåneden = new Date(Date.UTC(år, md, 0)).getUTCDate();
  const tomme = ukedagFra0(først);

  const ruter = [
    ...Array.from({ length: tomme }, () => el('span')),
    ...Array.from({ length: dagerIMåneden }, (_, i) => {
      const dato = `${visManed}-${String(i + 1).padStart(2, '0')}`;
      const d = kart.get(dato);
      const harVært = dato <= t.dato;
      const kanFylle = t.hvem === 'lykke' && harVært && !d;
      const knapp = el('button', {
        type: 'button',
        text: String(i + 1),
        disabled: !d && !kanFylle,
        'data-humor': d && !d.privat ? d.humor : null,
        'data-privat': d?.privat ? 'ja' : null,
        'data-idag': dato === t.dato ? 'ja' : null,
        'aria-label': `${datoOrd(dato)}${d ? '' : kanFylle ? ' – ikke ført, trykk for å fylle ut' : ' – ikke ført'}`,
        onclick: async () => {
          // En tom dag som har vært er en invitasjon, ikke en blindvei.
          if (kanFylle) return kveldsrunden(t, start, dato);
          try {
            valgtDag = (await api(`/dag?dato=${dato}`)).dag ?? { dato };
            visApp(t);
          } catch (e) { si(e.message); }
        },
      });
      knapp.style.setProperty('--i', i);
      return knapp;
    }),
  ];

  const byttMåned = (steg) => {
    const d = new Date(Date.UTC(år, md - 1 + steg, 1));
    visManed = d.toISOString().slice(0, 7);
    valgtDag = null;
    visApp(t);
  };

  const månedsnavn = først.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const siste30 = t.historikk
    .filter((d) => d.humor != null && d.dato > flyttDag(t.dato, -30))
    .sort((a, b) => a.dato.localeCompare(b.dato));

  tegn(
    hode('Kalender', { handlinger: [knappIkon('tannhjul', 'Innstillinger', () => visInnstillinger(t))] }),
    el('div', { class: 'kort' }, [
      el('div', { class: 'maned-topp' }, [
        el('button', { type: 'button', onclick: () => byttMåned(-1), 'aria-label': 'Forrige måned', text: '‹' }),
        el('h2', { text: månedsnavn }),
        el('button', {
          type: 'button', onclick: () => byttMåned(1), 'aria-label': 'Neste måned', text: '›',
          disabled: visManed >= t.dato.slice(0, 7),
        }),
      ]),
      el('div', { class: 'uke-navn' }, ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'].map((d) => el('span', { text: d }))),
      el('div', { class: 'maned' }, ruter),
      t.hvem === 'lykke' && el('p', {
        class: 'liten svak', style: 'margin:.9rem 0 0',
        text: 'Trykk på en tom dag som har vært, så kan du fylle den ut.',
      }),
      valgtDag && dagsark(valgtDag.humor || valgtDag.privat ? valgtDag : null, { egen: t.hvem === 'lykke' }),
    ]),
    siste30.length >= 3 && el('div', { class: 'seksjon' }, [
      el('h2', { text: 'Siste 30 dagene' }),
      stemningskurve(siste30),
    ]),
    sammendragSeksjon(t),
  );
}

let periode = 'uke';

/**
 * Sammendraget for en periode.
 *
 * Bare tall og hennes egne ord. Ingen automatiske tolkninger – de blir fort
 * tullete, og verre: de blir feil om et menneske.
 */
function sammendragSeksjon(t) {
  const rute = el('div', { class: 'laster liten', text: 'Regner …' });

  const hent = async () => {
    try {
      const d = await api(`/sammendrag?periode=${periode}`);
      rute.className = '';
      rute.replaceChildren(...(d.ført ? [
        el('div', { class: 'tall-rad' }, [
          el('div', { class: 'tall-rute' }, [
            el('b', { class: 'tall', text: d.snitt == null ? '–' : d.snitt.toFixed(1).replace('.', ',') }),
            el('span', { text: 'i snitt av 5' }),
          ]),
          el('div', { class: 'tall-rute' }, [
            el('b', { class: 'tall', text: String(d.ført) }),
            el('span', { text: 'dager ført' }),
          ]),
          el('div', { class: 'tall-rute' }, [
            el('b', { class: 'tall', text: String(d.antall_gode_ting) }),
            el('span', { text: 'gode ting' }),
          ]),
        ]),
        d.beste && el('div', { class: 'hoydepunkt' }, [
          el('p', { class: 'dato', text: `Beste dagen · ${datoOrd(d.beste.dato, { year: undefined })}` }),
          el('p', { text: d.beste.gode_ting[0]?.tekst ?? `${d.beste.humor} av 5` }),
        ]),
        d.tyngste && el('div', { class: 'hoydepunkt', 'data-slag': 'tung' }, [
          el('p', { class: 'dato', text: `Tyngste dagen · ${datoOrd(d.tyngste.dato, { year: undefined })}` }),
          el('p', { text: `${d.tyngste.humor} av 5` }),
        ]),
        d.behov.length && el('p', { class: 'liten svak', style: 'margin:.8rem 0 0' }, [
          'Bedt om: ',
          d.behov.map((b) => `${t.behov[b.behov].etikett.toLowerCase()}${b.antall > 1 ? ` ×${b.antall}` : ''}`).join(', '),
        ]),
        d.private ? el('p', { class: 'hjelp', style: 'margin:.5rem 0 0', text: `${d.private} dager er holdt for seg selv.` }) : null,
        d.antall_bilder ? el('p', { class: 'hjelp', style: 'margin:.3rem 0 0', text: `${d.antall_bilder} bilder og lydklipp.` }) : null,
      ].filter(Boolean) : [el('p', { class: 'hjelp', text: 'Ingenting ført i denne perioden.' })]));
    } catch (e) { si(e.message); }
  };

  hent();
  return el('div', { class: 'seksjon' }, [
    el('h2', { text: 'Sammendrag' }),
    el('div', { class: 'periode' }, [['uke', 'Uka'], ['maned', 'Måneden'], ['ar', 'Året']].map(([id, navn]) =>
      el('button', {
        type: 'button', text: navn, 'aria-pressed': String(periode === id),
        onclick: (e) => {
          periode = id;
          for (const b of e.target.parentElement.children) b.setAttribute('aria-pressed', String(b === e.target));
          hent();
        },
      }))),
    rute,
  ]);
}

/** Stemningen som en kurve. Y-aksen er 1–5 og står fast, så formen betyr noe. */
function stemningskurve(dager) {
  const B = 300;
  const H = 100;
  const pad = { topp: 10, bunn: 18, side: 6 };
  const x = (i) => pad.side + (i / Math.max(1, dager.length - 1)) * (B - pad.side * 2);
  const y = (v) => pad.topp + (1 - (v - 1) / 4) * (H - pad.topp - pad.bunn);

  const punkter = dager.map((d, i) => [x(i), y(d.humor)]);
  const linje = punkter.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const flate = `${linje} L${x(dager.length - 1).toFixed(1)} ${H - pad.bunn} L${x(0).toFixed(1)} ${H - pad.bunn} Z`;

  const strek = sti(linje, { class: 'strek' });
  // Lengden må være kjent før streken kan tegnes opp; et anslag holder.
  const lengde = Math.round(punkter.reduce((sum, p, i) =>
    (i ? sum + Math.hypot(p[0] - punkter[i - 1][0], p[1] - punkter[i - 1][1]) : 0), 0)) + 10;
  strek.style.setProperty('--lengde', lengde);

  const [sx, sy] = punkter.at(-1);
  return svg('svg', { class: 'kurve', viewBox: `0 0 ${B} ${H}`, role: 'img', 'aria-label': 'Stemningen de siste 30 dagene' }, [
    svg('defs', {}, [
      svg('linearGradient', { id: 'kurvefyll', x1: '0', y1: '0', x2: '0', y2: '1' }, [
        svg('stop', { offset: '0', 'stop-color': 'var(--honning)', 'stop-opacity': '.35' }),
        svg('stop', { offset: '1', 'stop-color': 'var(--honning)', 'stop-opacity': '0' }),
      ]),
    ]),
    svg('line', { class: 'rutenett', x1: pad.side, y1: y(3), x2: B - pad.side, y2: y(3) }),
    sti(flate, { class: 'flate' }),
    strek,
    svg('circle', { class: 'siste', cx: sx, cy: sy, r: 4 }),
    svg('text', { x: pad.side, y: H - 4, text: kortDato(dager[0].dato) }),
    svg('text', { x: B - pad.side, y: H - 4, 'text-anchor': 'end', text: kortDato(dager.at(-1).dato) }),
  ]);
}

/* ---------- fane: glasset ---------- */

let arkivSok = '';
let arkivOss = false;
let forrigeLapp = null;
let arkivAlle = false;

function faneGlasset(t) {
  const erLykke = t.hvem === 'lykke';
  const lapperute = el('div');
  const arkivrute = el('div', { class: 'arkiv' });
  const antall = erLykke ? t.antall_gode_ting : t.om_oss.length;

  const hentArkiv = async () => {
    try {
      const p = new URLSearchParams();
      if (arkivSok) p.set('sok', arkivSok);
      if (arkivOss) p.set('oss', 'ja');
      const { treff, antall: n } = await api(`/arkiv?${p}`);
      arkivrute.replaceChildren(...(treff.length
        ? treff.slice(0, arkivAlle ? 200 : 12).map((g, i) => {
          const rad = el('div', { class: 'arkiv-rad', 'data-oss': g.om_oss ? 'ja' : null }, [
            el('time', { datetime: g.dato, text: kortDato(g.dato) }),
            el('p', { text: g.tekst }),
          ]);
          rad.style.setProperty('--i', i);
          return rad;
        })
        : [el('p', { class: 'svak liten', text: arkivSok ? `Ingen treff på «${arkivSok}».` : 'Ingenting her ennå.' })]));
      if (treff.length > 12 && !arkivAlle) {
        arkivrute.append(el('button', {
          class: 'blank', type: 'button', style: 'margin-top:.4rem',
          onclick: () => { arkivAlle = true; hentArkiv(); },
          text: `Vis alle ${n}`,
        }));
      } else if (treff.length) {
        arkivrute.append(el('p', { class: 'liten svak midt', style: 'margin:.6rem 0 0', text: `${n} ting` }));
      }
    } catch (e) { si(e.message); }
  };

  const sokefelt = el('input', {
    type: 'search', value: arkivSok, id: 'sok',
    placeholder: 'Søk i alt som er skrevet …',
    oninput: (e) => { arkivSok = e.target.value; arkivAlle = false; klar(); },
  });
  let tid;
  const klar = () => { clearTimeout(tid); tid = setTimeout(hentArkiv, 220); };

  const tall = el('span', { class: 'stor-tall', text: '0' });

  tegn(
    hode('Glasset', { handlinger: [knappIkon('tannhjul', 'Innstillinger', () => visInnstillinger(t))] }),
    el('div', { class: 'kort' }, [
      el('div', { class: 'glass-scene' }, [glassFigur(antall, 'glass')]),
      el('p', { class: 'midt', style: 'margin:0' }, [
        tall,
        el('span', { class: 'svak', style: 'margin-left:.4rem', text: erLykke ? 'gode ting skrevet' : 'ting om oss' }),
      ]),
      erLykke && el('p', { class: 'liten svak midt', text: `${t.dager_i_ar} dager ført i år · ett lag i glasset per tretti ting` }),
      el('button', {
        class: 'hoved', type: 'button', style: 'margin-top:1rem', text: 'Trekk en lapp',
        onclick: async () => {
          try {
            const g = await api(`/glasset${forrigeLapp ? `?forrige=${encodeURIComponent(forrigeLapp)}` : ''}`);
          forrigeLapp = g.tekst ?? null;
            lapperute.replaceChildren(g.tom
              ? el('p', { class: 'svak liten', style: 'margin:.9rem 0 0', text: 'Glasset er tomt ennå. Det fyller seg opp.' })
              : el('div', { class: 'lapp' }, [`«${g.tekst}»`, el('span', { class: 'når', text: g.når })]));
          } catch (e) { si(e.message); }
        },
      }),
      lapperute,
    ]),
    (erLykke || t.delt) && el('button', {
      class: 'kort', type: 'button',
      style: 'display:flex;width:100%;align-items:center;justify-content:space-between;gap:1rem;text-align:left',
      onclick: () => visQuiz(t),
    }, [
      el('span', {}, [
        el('b', { style: 'font-family:var(--serif);font-size:1.15rem;display:block', text: 'Spørsmål' }),
        el('span', { class: 'liten svak', text: 'Seksti spørsmål i fem kategorier. Svar når du vil.' }),
      ]),
      el('span', { class: 'svak', style: 'font-size:1.3rem', text: '›' }),
    ]),
    el('div', { class: 'seksjon' }, [
      el('h2', { text: 'Alt som er skrevet' }),
      el('div', { style: 'margin:.7rem 0' }, [sokefelt]),
      el('div', { class: 'brikker' }, [
        el('button', {
          type: 'button', 'aria-pressed': String(!arkivOss),
          onclick: () => { arkivOss = false; hentArkiv(); visApp(t); }, text: 'Alt',
        }),
        el('button', {
          type: 'button', 'aria-pressed': String(arkivOss),
          onclick: () => { arkivOss = true; hentArkiv(); visApp(t); }, text: '💞 Om oss',
        }),
      ]),
      arkivrute,
    ]),
    el('div', { class: 'seksjon' }, [
      el('h2', { text: 'Årsboka' }),
      el('p', { class: 'hjelp', text: 'Hele året på én side, å lese fra topp til bunn.' }),
      el('div', { class: 'rad' }, [Number(t.dato.slice(0, 4)), Number(t.dato.slice(0, 4)) - 1].map((ar) =>
        el('button', { type: 'button', text: String(ar), onclick: () => visArsbok(t, ar) }))),
    ]),
  );
  tellOpp(tall, antall);
  hentArkiv();
}

/** Hele året på én side. Den eneste skjermen som er laget for å leses. */
/* ---------- quizen ---------- */

/**
 * Spørsmålene hennes, som en egen skjerm.
 *
 * Lå før som to rader med brikker midt i Glasset-fanen og rotet til alt rundt
 * seg. Nå er det ett spørsmål om gangen, stort nok til å tenke over.
 */
async function visQuiz(t, kat = null) {
  fanerad.replaceChildren();
  tegn(el('p', { class: 'laster', text: 'Henter …' }));

  let d;
  try {
    d = await api(`/sporsmal?antall=30${kat ? `&kat=${kat}` : ''}`);
  } catch (e) {
    si(e.message);
    return visApp(t);
  }

  // Ingen kategori valgt: vis dem, med hvor langt hun er kommet i hver.
  if (!kat) {
    const alle = await api('/sporsmal?antall=30');
    tegn(
      hode('Spørsmål', {
        stempel: `${alle.ferdig} svart · ${alle.igjen} igjen`,
        handlinger: [knappIkon('tilbake', 'Tilbake', () => visApp(t))],
      }),
      el('p', { class: 'hjelp', style: 'margin-bottom:1rem', text: 'Velg noe du har lyst til å tenke på. Svarene legger seg i arkivet.' }),
      el('div', { class: 'kat-rutenett' }, Object.entries(alle.kategorier).map(([k, navn]) =>
        el('button', { class: 'kat', type: 'button', onclick: () => visQuiz(t, k) }, [
          el('b', { text: navn }),
          el('span', { text: 'Åpne' }),
          el('span', { class: 'maler' }, [el('i')]),
        ]))),
      alle.svarte.length ? el('div', { class: 'seksjon', style: 'margin-top:1.6rem' }, [
        el('h2', { text: `Svarte · ${alle.svarte.length}` }),
        el('div', { class: 'spm-liste' }, alle.svarte.slice(0, 30).map((spm) =>
          el('button', {
            class: 'spm', type: 'button', 'data-svart': 'ja',
            onclick: () => visSpørsmål(t, [spm], 0, null, spm.svar),
          }, [spm.t, el('span', { class: 'svaret', text: spm.svar })]))),
      ]) : null,
    );
    // Fyll framdriftsstrekene når tallene er kjent.
    const iKat = Object.keys(alle.kategorier);
    for (const [i, k] of iKat.entries()) {
      api(`/sporsmal?kat=${k}&antall=3`).then((kd) => {
        const rute = app.querySelectorAll('.kat')[i];
        if (!rute) return;
        const alle_i = kd.ferdig + kd.igjen;
        rute.querySelector('span').textContent = `${kd.ferdig} av ${alle_i}`;
        rute.querySelector('.maler i').style.width = `${Math.round((kd.ferdig / alle_i) * 100)}%`;
      }).catch(() => {});
    }
    return;
  }

  if (!d.forslag.length) {
    tegn(
      hode(d.kategorier[kat], { handlinger: [knappIkon('tilbake', 'Tilbake', () => visQuiz(t))] }),
      el('div', { class: 'kort midt' }, [
        el('p', { style: 'margin:0', text: 'Du har svart på alle i denne kategorien.' }),
      ]),
    );
    return;
  }
  visSpørsmål(t, d.forslag, 0, kat, null);
}

/** Ett spørsmål om gangen, med vei videre uten å måtte svare. */
function visSpørsmål(t, bunke, i, kat, gammelt) {
  const spm = bunke[i];
  const felt = voksende(el('textarea', {
    class: 'vokser', rows: 3, value: gammelt ?? '',
    placeholder: 'Skriv så langt eller kort du vil …',
  }));

  const lagre = async () => {
    try {
      await api('/sporsmal', { metode: 'POST', kropp: { k: spm.k, tekst: felt.value } });
      si(felt.value.trim() ? 'Svart.' : 'Fjernet.');
      if (kat && i + 1 < bunke.length) visSpørsmål(t, bunke, i + 1, kat, null);
      else visQuiz(t, kat);
    } catch (e) { si(e.message); }
  };

  tegn(
    hode(kat ? t.kategorier?.[kat] ?? 'Spørsmål' : 'Spørsmål', {
      stempel: kat ? `${i + 1} av ${bunke.length}` : 'Svart før',
      handlinger: [knappIkon('tilbake', 'Tilbake', () => visQuiz(t, kat))],
    }),
    el('div', { class: 'quiz' }, [
      kat && el('div', { class: 'teller' }, bunke.map((_, n) =>
        el('i', { 'data-na': n === i ? 'ja' : null }))),
      el('div', { class: 'kortet' }, [
        el('h2', { text: spm.t }),
        felt,
      ]),
      el('div', { class: 'stegrad' }, [
        el('button', { class: 'hoved', type: 'button', onclick: lagre, text: 'Lagre' }),
        kat && i + 1 < bunke.length
          ? el('button', { class: 'blank', type: 'button', onclick: () => visSpørsmål(t, bunke, i + 1, kat, null), text: 'Neste →' })
          : el('button', { class: 'blank', type: 'button', onclick: () => visQuiz(t, kat), text: 'Tilbake' }),
      ]),
    ]),
  );
  felt.focus();
}

async function visArsbok(t, ar) {
  fanerad.replaceChildren();
  tegn(el('p', { class: 'laster', text: 'Blar opp …' }));
  try {
    const bok = await api(`/aarsbok?ar=${ar}`);
    tegn(el('div', { class: 'arsbok' }, [
      el('button', { class: 'blank', type: 'button', onclick: start, text: '← Tilbake' }),
      el('h1', { style: 'margin-top:1rem', text: `${bok.ar} i ${bok.antall} gode ting` }),
      el('p', { class: 'fasit', text: `Skrevet over ${bok.dager} dager.` }),
      ...bok.maneder.map((m) => el('section', {}, [
        el('h2', { text: somDato(`${m.maned}-01`).toLocaleDateString('nb-NO', { month: 'long', timeZone: 'UTC' }) }),
        el('ul', {}, m.ting.map((g) => el('li', {}, [
          el('time', { datetime: g.dato, text: g.dato.slice(8) + '.' }),
          el('span', {}, [g.om_oss && el('span', { class: 'merke', text: '💞' }), g.tekst]),
        ]))),
      ])),
      !bok.antall && el('p', { class: 'svak', text: 'Ingenting skrevet dette året ennå.' }),
      el('button', { class: 'blank', type: 'button', style: 'margin-top:1.5rem', onclick: start, text: '← Tilbake' }),
    ]));
  } catch (e) {
    si(e.message);
    start();
  }
}

/* ---------- fane: meldinger ---------- */

/** Samtalen, som en samtale. Skrivefeltet nederst, alt annet er flyttet ut. */
function faneMeldinger(t) {
  // Merkes lest med én gang fanen åpnes. Duppedotten skal bort nå, ikke ved
  // neste henting – ellers står den og lyser over meldinger man leser.
  if (uleste(t)) {
    api('/meldinger/lest', { metode: 'POST' }).catch(() => {});
    for (const m of t.meldinger) if (m.fra !== t.hvem) m.lest_kl ??= new Date().toISOString();
    tegnFaner(t);
  }

  const felt = el('textarea', { id: 'melding', class: 'vokser', placeholder: 'Skriv noe …', rows: 1 });
  voksende(felt);

  // Vedleggene lastes opp med én gang de velges, men festes ikke til noe før
  // meldingen sendes. Utkastet står altså i lista her, ikke i samtalen.
  const utkast = [];
  const utkastrad = el('div', { class: 'utkastfiler', hidden: true });

  function tegnUtkast() {
    utkastrad.hidden = !utkast.length;
    utkastrad.replaceChildren(...utkast.map((v) => el('figure', {}, [
      v.slag === 'lyd'
        ? el('div', { class: 'merke-lyd', text: '🎙' })
        : el('img', { src: `/api/fil/${v.id}`, alt: 'Vedlegg' }),
      el('button', {
        type: 'button', text: '×', 'aria-label': 'Fjern vedlegget',
        onclick: () => {
          api(`/fil/${v.id}`, { metode: 'DELETE' }).catch(() => {});
          utkast.splice(utkast.indexOf(v), 1);
          tegnUtkast();
        },
      }),
    ])));
  }

  const send = async () => {
    const tekst = felt.value.trim();
    if (!tekst && !utkast.length) return;
    const filer = utkast.map((v) => v.id);
    felt.value = '';
    felt.style.height = 'auto';
    utkast.length = 0;
    tegnUtkast();
    try { await api('/melding', { metode: 'POST', kropp: { tekst, filer } }); await start(); }
    catch (e) { si(e.message); }
  };
  felt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  });

  const velger = KAN_FILER && el('input', {
    type: 'file', accept: 'image/*', multiple: true, style: 'display:none',
    onchange: async (e) => {
      const valgte = [...(e.target.files ?? [])].slice(0, 6 - utkast.length);
      e.target.value = '';
      if (!valgte.length) return si(utkast.length ? 'Seks vedlegg er nok på én melding.' : 'Ingen bilde valgt.');
      si(valgte.length > 1 ? 'Laster opp bildene …' : 'Laster opp …');
      for (const fil of valgte) {
        try {
          const liten = await krympBilde(fil);
          utkast.push(await lastOpp('/melding/fil?slag=bilde', liten, 'image/jpeg'));
          tegnUtkast();
        } catch (feil) { si(feil.message); }
      }
      felt.focus();
    },
  });

  tegn(
    hode('Meldinger', { handlinger: [knappIkon('tannhjul', 'Innstillinger', () => visInnstillinger(t))] }),
    el('div', { class: 'chat' }, [
      t.meldinger.length
        ? samtale(t)
        : el('p', { class: 'svak liten midt tomt', text: 'Ingen meldinger ennå. Begynn du.' }),
      el('div', { class: 'skrivebunn' }, [
        utkastrad,
        el('div', { class: 'skrivefelt' }, [
          velger || null,
          velger && el('button', {
            class: 'blank fest', type: 'button', onclick: () => velger.click(),
            'aria-label': 'Legg ved bilde', title: 'Legg ved bilde',
          }, [IKONER.binders()]),
          felt,
          el('button', { class: 'hoved', type: 'button', onclick: send, 'aria-label': 'Send', text: '↑' }),
        ]),
      ]),
    ]),
  );
  app.querySelector('.samtale')?.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
}

/** Boblene, med reaksjoner som svever over i stedet for å dytte. */
function samtale(t) {
  let åpen = null;

  return el('div', { class: 'samtale' }, t.meldinger.slice(-40).map((m, i) => {
    const mine = (m.reaksjoner ?? []).find((r) => r.hvem === t.hvem)?.tegn ?? null;

    const velger = el('div', { class: 'velgreaksjon', hidden: true }, REAKSJONER.map((tegn) =>
      el('button', {
        type: 'button',
        text: tegn,
        'aria-pressed': String(mine === tegn),
        onclick: async (e) => {
          e.stopPropagation();
          try { await api(`/melding/${m.id}/reaksjon`, { metode: 'POST', kropp: { tegn } }); await start(); }
          catch (feil) { si(feil.message); }
        },
      })));

    const filer = m.filer ?? [];
    // Serveren setter 📷 som tekst når meldingen bare var et bilde. Da er
    // bildet meldingen, og teksten står bare i veien.
    const tekst = filer.length && m.tekst === '📷' ? null : m.tekst;

    const boble = el('div', { class: 'boble', 'data-min': m.fra === t.hvem ? 'ja' : 'nei' }, [
      filer.length
        ? el('div', { class: 'vedlegg' }, filer.map((f) => (f.slag === 'lyd'
          ? el('audio', { controls: true, src: `/api/fil/${f.id}`, preload: 'none' })
          : el('a', { href: `/api/fil/${f.id}`, target: '_blank', rel: 'noreferrer' }, [
            el('img', { src: `/api/fil/${f.id}`, alt: 'Vedlegg', loading: 'lazy' }),
          ]))))
        : null,
      tekst,
      el('time', { datetime: m.laget_kl, text: `${kortDato(m.laget_kl.slice(0, 10))} ${klokkeslett(m.laget_kl)}` }),
      (m.reaksjoner ?? []).length
        ? el('div', { class: 'reaksjoner' }, [...new Set(m.reaksjoner.map((r) => r.tegn))])
        : null,
    ]);
    boble.style.setProperty('--i', i);

    const rad = el('div', {
      class: 'boblerad',
      'data-min': m.fra === t.hvem ? 'ja' : 'nei',
      // Én velger av gangen. To åpne samtidig er bare rot.
      onclick: () => {
        if (åpen && åpen !== velger) åpen.hidden = true;
        velger.hidden = !velger.hidden;
        åpen = velger.hidden ? null : velger;
      },
    }, [velger, boble]);
    return rad;
  }));
}

/* ---------- innstillinger ---------- */

/** Brytere og nøkler, samlet ett sted i stedet for å ligge blant innholdet. */
function visInnstillinger(t) {
  fanerad.replaceChildren();
  tegn(
    hode('Innstillinger', { handlinger: [knappIkon('tilbake', 'Tilbake', () => visApp(t))] }),
    delingKort(t),
    kodeKort(t),
    eksportKort(),
    el('div', { class: 'seksjon' }, [
      el('h2', { text: 'Økta' }),
      el('button', { class: 'blank', type: 'button', onclick: loggUt, text: 'Logg ut' }),
    ]),
  );
}


/**
 * Delingen.
 *
 * Bryteren sitter hos den det gjelder. Han ser hva den står på – det er
 * forskjellen på innsyn og en bakvei – men det er hun som snur den.
 */
function delingKort(t) {
  if (t.hvem !== 'lykke') {
    return el('div', { class: 'seksjon' }, [
      el('h2', { text: 'Deling' }),
      el('p', { style: 'margin:.6rem 0 0' }, [
        el('strong', { text: t.delt ? 'Delt modus er på. ' : 'Lykke velger dag for dag. ' }),
        t.delt
          ? 'Du ser alt hun fører.'
          : 'Du ser dagene hun deler, og at de andre finnes.',
      ]),
      el('p', { class: 'liten svak', style: 'margin:.6rem 0 0', text: 'Det er hun som styrer denne.' }),
    ]);
  }

  const velg = async (på) => {
    try {
      await api('/delt', { metode: 'POST', kropp: { på } });
      si(på ? 'Delt modus er på.' : 'Du velger dag for dag igjen.');
      await start();
    } catch (e) { si(e.message); }
  };

  return el('div', { class: 'seksjon' }, [
    el('h2', { text: 'Deling' }),
    el('p', { class: 'hjelp', text: 'Hvor mye Mathias får se. Du kan snu den når du vil.' }),
    el('div', { class: 'brikker' }, [
      el('button', {
        type: 'button', 'aria-pressed': String(!t.delt),
        onclick: () => velg(false), text: 'Jeg velger dag for dag',
      }),
      el('button', {
        type: 'button', 'aria-pressed': String(t.delt),
        onclick: () => velg(true), text: 'Del alt',
      }),
    ]),
    el('p', {
      class: 'liten svak', style: 'margin:.8rem 0 0',
      text: t.delt
        ? 'Alt du fører går til Mathias. «Bare for meg» finnes ikke så lenge dette står på.'
        : 'Hver kveld velger du om dagen deles. De du holder for deg selv, ser han bare at finnes.',
    }),
  ]);
}

/** Alt som ligger her, som én fil. Data man ikke kan få ut, kan man miste. */
function eksportKort() {
  if (!KAN_FILER) return null;
  return el('div', { class: 'seksjon' }, [
    el('h2', { text: 'Sikkerhetskopi' }),
    el('p', { class: 'hjelp', text: 'Alt som ligger her, som én fil. Legg den et trygt sted.' }),
    el('button', {
      class: 'hoved', type: 'button', text: '⬇️ Last ned alt',
      onclick: async () => {
        try {
          const svar = await hentFil('/eksport');
          if (!svar.ok) throw new Error('Fikk ikke hentet fila.');
          const url = URL.createObjectURL(await svar.blob());
          const lenke = el('a', { href: url, download: `lykkeglasset-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(lenke);
          lenke.click();
          lenke.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (e) { si(e.message); }
      },
    }),
  ]);
}

/**
 * Kodekortet.
 *
 * Koden må kunne byttes fra telefonen. Ligger den bare som en hemmelighet hos
 * Cloudflare, må man ha en maskin med utviklerverktøy for å glemme den.
 */
function kodeKort(t) {
  if (!t.kan_bytte_egen && !t.kan_bytte_hennes) return null;

  const bytt = async (hvem, felt) => {
    const kode = felt.value.trim();
    if (kode.length < 6) return si('Minst seks tegn.');
    try {
      await api('/kode', { metode: 'POST', kropp: { hvem, kode } });
      felt.value = '';
      si(hvem === t.hvem ? 'Koden din er byttet.' : 'Ny kode satt for Lykke.');
    } catch (e) { si(e.message); }
  };

  const rad = (hvem, merkelapp, knapp) => {
    const felt = el('input', {
      type: 'password', id: `kode-${hvem}`, autocomplete: 'new-password', placeholder: 'Minst seks tegn',
    });
    felt.addEventListener('keydown', (e) => { if (e.key === 'Enter') bytt(hvem, felt); });
    return el('div', { style: 'margin-top:.9rem' }, [
      el('label', { for: `kode-${hvem}`, text: merkelapp }),
      el('div', { class: 'skrivefelt' }, [
        felt,
        el('button', { class: 'hoved', type: 'button', style: 'width:auto;padding-inline:1rem', onclick: () => bytt(hvem, felt), text: knapp }),
      ]),
    ]);
  };

  return el('div', { class: 'seksjon' }, [
    el('h2', { text: 'Koder' }),
    t.kan_bytte_egen && rad(t.hvem, 'Ny kode for deg selv', 'Bytt'),
    t.kan_bytte_hennes && t.hvem !== 'lykke' && rad('lykke', 'Ny kode for Lykke', 'Sett'),
    t.kan_bytte_hennes && t.hvem !== 'lykke' && el('p', {
      class: 'liten svak', style: 'margin:.7rem 0 0',
      text: 'Setter du en ny for henne, får hun en melding om det. En kode som byttes i det skjulte, er ikke en kode – det er en lås.',
    }),
  ]);
}

/* ---------- oppstart ---------- */

async function loggUt() {
  await api('/logg-ut').catch(() => {});
  tilstand = null;
  visLoggInn();
}

async function start() {
  try {
    const { hvem } = await api('/meg');
    if (!hvem) return visLoggInn();
    visApp(await api('/tilstand'));
  } catch {
    visLoggInn();
  }
}

start();

// Finnes bare når appen serveres av sin egen worker. Andre steder er det
// ingen sw.js å registrere, og da skal det ikke bråkes om det.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.claude) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
