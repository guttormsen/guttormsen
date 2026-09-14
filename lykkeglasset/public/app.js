/**
 * Lykkeglasset i nettleseren.
 *
 * Alt tegnes fra JavaScript – det er lite nok innhold til at en malmotor bare
 * ville vært et mellomledd. Ingen rammeverk, ingen CDN, ingen sporing.
 *
 * Fila kjenner ikke til hvor dataene kommer fra. Alt går gjennom `api()` i
 * api.js, og den kan byttes ut uten at noe her endres.
 */
import { api, VARSLER } from './api.js';

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
  oss: () => ikon('M21 11.5a7.5 7.5 0 0 1-11 6.6L4 20l1.9-5.1A7.5 7.5 0 1 1 21 11.5z'),
};

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

function kveldsrunden(t, ferdig) {
  const fra = t.idag;
  const utkast = {
    humor: fra?.humor ?? null,
    gode: [0, 1, 2].map((i) => fra?.gode_ting?.[i]?.tekst ?? ''),
    omOss: [0, 1, 2].map((i) => Boolean(fra?.gode_ting?.[i]?.om_oss)),
    tungt: fra?.tungt ?? '',
    behov: fra?.behov ?? null,
    privat: fra ? fra.privat : false,
  };
  let steg = 0;
  fanerad.replaceChildren();

  const ramme = (tittel, undertittel, innhold, { videre = 'Videre', kanVidere = true, siste = false } = {}) =>
    tegn(el('div', { class: 'steg' }, [
      el('div', { class: 'framdrift' }, [0, 1, 2, 3].map((i) => el('i', { 'data-pa': i <= steg ? 'ja' : 'nei' }))),
      el('p', { class: 'stempel', text: `Steg ${steg + 1} av 4` }),
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
    ramme('Hvordan var dagen?', datoOrd(t.dato), [el('div', { class: 'humor' }, knapper)],
      { kanVidere: Boolean(utkast.humor) });
  };

  const stegGode = () => {
    const felt = [0, 1, 2].map((i) => {
      const inn = el('input', {
        type: 'text', value: utkast.gode[i], id: `god-${i}`,
        placeholder: ['Noe som var fint …', 'Noe mer …', 'Og én til …'][i],
        oninput: (e) => { utkast.gode[i] = e.target.value; },
      });
      inn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
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
    ramme('Tre gode ting', 'Små ting teller. Kaffen. Været i fem minutter.', felt);
  };

  const stegTungt = () => {
    // Knappen het «Hopp over» så lenge feltet var tomt, men teksten ble stående
    // til neste tegning – altså løy den mens hun skrev. Ett ord, alltid sant.
    ramme('Var noe tungt i dag?', 'Dette er ditt. Det deles bare hvis du sier fra.', [
      el('label', { for: 'tungt', text: 'Fritekst' }),
      el('textarea', {
        value: utkast.tungt, id: 'tungt',
        placeholder: 'Skriv om du vil. Eller la det stå tomt.',
        oninput: (e) => { utkast.tungt = e.target.value; },
      }),
      el('p', { class: 'liten svak', style: 'margin:.6rem 0 0', text: 'Å la det stå tomt er helt greit.' }),
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
      el('h3', { style: 'margin-top:1.4rem', text: 'Dette ser Mathias' }),
      forhåndsvisning(utkast, t.behov),
    ], { videre: 'Lagre dagen', siste: true });
  };

  const lagre = async () => {
    try {
      const svar = await api('/dag', {
        metode: 'POST',
        kropp: {
          dato: t.dato,
          humor: utkast.humor,
          gode_ting: utkast.gode
            .map((tekst, i) => ({ tekst, om_oss: utkast.omOss[i] }))
            .filter((g) => g.tekst.trim()),
          tungt: utkast.tungt,
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

/** Dagen slik den vises når man trykker på den i kalenderen. */
function dagsKort(dag, { egen }) {
  if (!dag) return el('p', { class: 'svak liten', style: 'margin:.9rem 0 0', text: 'Ingenting ført denne dagen.' });
  if (dag.privat && !egen) {
    return el('p', { class: 'svak liten', style: 'margin:.9rem 0 0', text: 'Ført, men holdt for seg selv.' });
  }
  return el('div', { style: 'margin-top:.9rem' }, [
    el('p', { class: 'stempel', text: datoOrd(dag.dato) }),
    el('h3', { style: 'margin-top:.4rem', text: `${humorFjes(dag.humor)} ${humorOrd(dag.humor)}${dag.privat ? ' · privat' : ''}` }),
    dag.gode_ting?.length ? godeTingListe(dag.gode_ting) : null,
    dag.holdt_gode && el('p', { class: 'liten svak', text: 'De gode tingene beholdt hun for seg selv.' }),
    dag.tungt && el('p', { class: 'sendes', style: 'margin-top:.7rem', text: dag.tungt }),
    dag.holdt_tungt && el('p', { class: 'liten svak', style: 'margin-top:.7rem', text: 'Noe var tungt. Det er ikke delt.' }),
  ]);
}

/* ---------- fanene ---------- */

const FANER = [
  { id: 'idag', navn: 'I dag' },
  { id: 'kalender', navn: 'Kalender' },
  { id: 'glasset', navn: 'Glasset' },
  { id: 'oss', navn: 'Oss' },
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
      f.id === 'oss' && n > 0 && el('span', { class: 'duppedott' }),
      el('span', { text: f.navn }),
    ])));
}

function visApp(t) {
  tilstand = t;
  tegnFaner(t);
  const tegner = { idag: faneIdag, kalender: faneKalender, glasset: faneGlasset, oss: faneOss }[fane];
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
        el('button', {
          class: 'blank liten-knapp', type: 'button', style: 'margin-top:.5rem',
          onclick: () => kveldsrunden(t, start),
          text: 'Endre dagen',
        }),
      ])
      : el('div', { class: 'kort løftet' }, [
        el('div', { class: 'glass-rad' }, [
          glassFigur(t.antall_gode_ting),
          el('div', {}, [
            el('h2', { text: 'Kveldsrunden' }),
            el('p', { class: 'svak liten', style: 'margin:0', text: 'Tre gode ting, og hvordan dagen var. Under ett minutt.' }),
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
      el('div', { class: 'topp' }, [
        el('div', {}, [
          el('p', { class: 'stempel', text: datoOrd(t.dato, { year: undefined }) }),
          el('h1', { style: 'margin-top:.3rem', text: 'God kveld, Lykke' }),
        ]),
        el('button', { class: 'blank liten', type: 'button', onclick: loggUt, text: 'Logg ut' }),
      ]),
      hilsen,
      dagensKort,
      brev,
      ifjor,
    );
    return;
  }

  /* ---- hans side ---- */

  const u = t.uke;
  const retning = u.snitt != null && u.forrige_snitt != null
    ? u.snitt - u.forrige_snitt
    : null;

  tegn(
    el('div', { class: 'topp' }, [
      el('div', {}, [
        el('p', { class: 'stempel', text: datoOrd(t.dato, { year: undefined }) }),
        el('h1', { style: 'margin-top:.3rem', text: 'Hos Lykke' }),
      ]),
      el('button', { class: 'blank liten', type: 'button', onclick: loggUt, text: 'Logg ut' }),
    ]),
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
          dag.holdt_gode && el('p', { class: 'liten svak', text: 'De gode tingene beholdt hun for seg selv.' }),
          dag.tungt && el('p', { class: 'sendes', style: 'margin-top:.7rem', text: dag.tungt }),
          dag.holdt_tungt && el('p', { class: 'liten svak', style: 'margin-top:.7rem', text: 'Noe var tungt. Hun valgte å ikke dele det.' }),
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
    el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: 'Om oss' }),
      t.om_oss.length
        ? el('ul', { class: 'liste', style: 'margin-top:.4rem' }, t.om_oss.slice(0, 5).map((g) =>
          el('li', {}, [g.tekst, el('div', { class: 'liten svak', text: kortDato(g.dato) })])))
        : el('p', { class: 'svak liten', style: 'margin:.5rem 0 0', text: 'Ingenting merket «om oss» ennå.' }),
    ]),
  );
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
      const knapp = el('button', {
        type: 'button',
        text: String(i + 1),
        disabled: !d,
        'data-humor': d && !d.privat ? d.humor : null,
        'data-privat': d?.privat ? 'ja' : null,
        'data-idag': dato === t.dato ? 'ja' : null,
        'aria-label': `${datoOrd(dato)}${d ? '' : ' – ikke ført'}`,
        onclick: async () => {
          try {
            const svar = await api(`/dag?dato=${dato}`);
            valgtDag = svar.dag ?? { dato };
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
    el('div', { class: 'topp' }, [el('h1', { text: 'Kalender' })]),
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
      valgtDag && dagsKort(valgtDag.humor || valgtDag.privat ? valgtDag : null, { egen: t.hvem === 'lykke' }),
    ]),
    siste30.length >= 3 && el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: 'Siste 30 dagene' }),
      stemningskurve(siste30),
    ]),
    el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: 'Denne uka' }),
      el('div', { class: 'tall-rad', style: 'margin-top:.7rem' }, [
        el('div', { class: 'tall-rute' }, [
          el('b', { class: 'tall', text: t.uke.snitt == null ? '–' : t.uke.snitt.toFixed(1) }),
          el('span', { text: 'i snitt av 5' }),
        ]),
        el('div', { class: 'tall-rute' }, [
          el('b', { class: 'tall', text: String(t.uke.ført) }),
          el('span', { text: 'dager ført' }),
        ]),
        el('div', { class: 'tall-rute' }, [
          el('b', { class: 'tall', text: String(t.uke.gode) }),
          el('span', { text: 'gode dager' }),
        ]),
      ]),
    ]),
  );
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
        ? treff.slice(0, 60).map((g, i) => {
          const rad = el('div', { class: 'arkiv-rad', 'data-oss': g.om_oss ? 'ja' : null }, [
            el('time', { datetime: g.dato, text: kortDato(g.dato) }),
            el('p', { text: g.tekst }),
          ]);
          rad.style.setProperty('--i', i);
          return rad;
        })
        : [el('p', { class: 'svak liten', text: arkivSok ? `Ingen treff på «${arkivSok}».` : 'Ingenting her ennå.' })]));
      if (treff.length) {
        arkivrute.append(el('p', {
          class: 'liten svak midt', style: 'margin:.6rem 0 0',
          text: n > 60 ? `Viser 60 av ${n}` : `${n} ${n === 1 ? 'ting' : 'ting'}`,
        }));
      }
    } catch (e) { si(e.message); }
  };

  const sokefelt = el('input', {
    type: 'search', value: arkivSok, id: 'sok',
    placeholder: 'Søk i alt som er skrevet …',
    oninput: (e) => { arkivSok = e.target.value; klar(); },
  });
  let tid;
  const klar = () => { clearTimeout(tid); tid = setTimeout(hentArkiv, 220); };

  const tall = el('span', { class: 'stor-tall', text: '0' });

  tegn(
    el('div', { class: 'topp' }, [el('h1', { text: 'Glasset' })]),
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
            const g = await api('/glasset');
            lapperute.replaceChildren(g.tom
              ? el('p', { class: 'svak liten', style: 'margin:.9rem 0 0', text: 'Glasset er tomt ennå. Det fyller seg opp.' })
              : el('div', { class: 'lapp' }, [`«${g.tekst}»`, el('span', { class: 'når', text: g.når })]));
          } catch (e) { si(e.message); }
        },
      }),
      lapperute,
    ]),
    el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: 'Alt som er skrevet' }),
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
  );
  tellOpp(tall, antall);
  hentArkiv();
}

/* ---------- fane: oss ---------- */

function faneOss(t) {
  const erLykke = t.hvem === 'lykke';
  // Merkes lest med én gang fanen åpnes. Duppedotten skal bort nå, ikke ved
  // neste henting – ellers står den og lyser over meldinger man leser.
  if (uleste(t)) {
    api('/meldinger/lest', { metode: 'POST' }).catch(() => {});
    for (const m of t.meldinger) if (m.fra !== t.hvem) m.lest_kl ??= new Date().toISOString();
    tegnFaner(t);
  }

  const felt = el('textarea', { id: 'melding', placeholder: 'Skriv noe …', rows: 1 });
  const sendMelding = async () => {
    const tekst = felt.value.trim();
    if (!tekst) return;
    felt.value = '';
    try { await api('/melding', { metode: 'POST', kropp: { tekst } }); await start(); }
    catch (e) { si(e.message); }
  };
  felt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMelding(); }
  });

  const onskefelt = el('input', { type: 'text', id: 'onske', placeholder: 'Noe vi skal gjøre …' });
  const leggTil = async () => {
    const tekst = onskefelt.value.trim();
    if (!tekst) return;
    onskefelt.value = '';
    try { await api('/onske', { metode: 'POST', kropp: { tekst } }); await start(); }
    catch (e) { si(e.message); }
  };
  onskefelt.addEventListener('keydown', (e) => { if (e.key === 'Enter') leggTil(); });

  const igjen = t.onsker.filter((o) => !o.gjort_kl).length;

  tegn(
    el('div', { class: 'topp' }, [el('h1', { text: 'Oss' })]),

    el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: 'Meldinger' }),
      t.meldinger.length
        ? el('div', { class: 'samtale', style: 'margin-top:.8rem' }, t.meldinger.slice(-18).map((m, i) => {
          const boble = el('div', { class: 'boble', 'data-min': m.fra === t.hvem ? 'ja' : 'nei' }, [
            m.tekst,
            el('time', { datetime: m.laget_kl, text: `${kortDato(m.laget_kl.slice(0, 10))} ${klokkeslett(m.laget_kl)}` }),
          ]);
          boble.style.setProperty('--i', i);
          return boble;
        }))
        : el('p', { class: 'svak liten', style: 'margin:.7rem 0' , text: 'Ingen meldinger ennå. Begynn du.' }),
      el('div', { class: 'skrivefelt' }, [
        felt,
        el('button', { class: 'hoved', type: 'button', onclick: sendMelding, 'aria-label': 'Send', text: '↑' }),
      ]),
    ]),

    el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: `Ønskelista · ${igjen} igjen` }),
      t.onsker.length
        ? el('div', { class: 'onsker', style: 'margin-top:.8rem' }, t.onsker.map((o) =>
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
        : el('p', { class: 'svak liten', style: 'margin:.7rem 0', text: 'Tom foreløpig. Hva har dere lyst til?' }),
      el('div', { class: 'skrivefelt' }, [
        onskefelt,
        el('button', { class: 'hoved', type: 'button', onclick: leggTil, 'aria-label': 'Legg til', text: '+' }),
      ]),
    ]),

    !erLykke && el('div', { class: 'kort' }, [
      el('p', { class: 'stempel', text: 'Brev til en dårlig dag' }),
      el('p', {
        class: 'svak liten', style: 'margin:.5rem 0 .7rem',
        text: `${t.brev.filter((b) => !b.apnet_kl).length} ligger uåpnet. Hun får tilbud om ett når dagen er tung.`,
      }),
      el('textarea', { id: 'brev', placeholder: 'Noe hun skal lese når det er vanskelig …' }),
      el('button', {
        class: 'hoved', type: 'button', style: 'margin-top:.7rem', text: 'Legg i glasset',
        onclick: async () => {
          const rute = document.getElementById('brev');
          if (!rute.value.trim()) return si('Tomt brev.');
          try { await api('/brev', { metode: 'POST', kropp: { tekst: rute.value } }); si('Lagt inn.'); await start(); }
          catch (e) { si(e.message); }
        },
      }),
      t.brev.length && el('ul', { class: 'liste', style: 'margin-top:.9rem' }, t.brev.map((b) =>
        el('li', { class: 'liten svak' },
          `${kortDato(b.laget_kl.slice(0, 10))} – ${b.apnet_kl ? `åpnet ${kortDato(b.apnet_kl.slice(0, 10))}` : 'ligger klart'}`))),
    ]),
  );
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
