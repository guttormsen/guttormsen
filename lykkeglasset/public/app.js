/**
 * Lykkeglasset i nettleseren.
 *
 * Alt tegnes fra JavaScript – det er lite nok innhold til at en malmotor bare
 * ville vært et mellomledd. Ingen rammeverk, ingen CDN, ingen sporing.
 */

/* ---------- små hjelpere ---------- */

const el = (tag, attrs = {}, barn = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
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

const app = document.getElementById('app');
const tegn = (...barn) => app.replaceChildren(...barn.flat().filter(Boolean));

let brodTid;
function si(tekst) {
  const rute = document.getElementById('brodske');
  rute.textContent = tekst;
  rute.dataset.vis = 'ja';
  clearTimeout(brodTid);
  brodTid = setTimeout(() => { rute.dataset.vis = 'nei'; }, 3200);
}

async function api(sti, { metode = 'GET', kropp } = {}) {
  const svar = await fetch(`/api${sti}`, {
    method: metode,
    headers: kropp ? { 'Content-Type': 'application/json' } : undefined,
    body: kropp ? JSON.stringify(kropp) : undefined,
  });
  const data = await svar.json().catch(() => ({}));
  if (!svar.ok) throw new Error(data.feil || 'Noe gikk galt.');
  return data;
}

const HUMOR = [
  { verdi: 1, fjes: '😞', ord: 'Veldig tung' },
  { verdi: 2, fjes: '🙁', ord: 'Tung' },
  { verdi: 3, fjes: '😐', ord: 'Midt på treet' },
  { verdi: 4, fjes: '🙂', ord: 'God' },
  { verdi: 5, fjes: '😄', ord: 'Skikkelig god' },
];
const humorOrd = (n) => HUMOR.find((h) => h.verdi === n)?.ord ?? '';
const humorFjes = (n) => HUMOR.find((h) => h.verdi === n)?.fjes ?? '';

const klokkeslett = (iso) => (iso ? new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : '');
const datoOrd = (nokkel) => {
  if (!nokkel) return '';
  const [y, m, d] = nokkel.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('nb-NO', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
};

/* ---------- innlogging ---------- */

function visLoggInn(feilmelding) {
  let hvem = null;
  const kode = el('input', { type: 'password', id: 'kode', autocomplete: 'current-password', inputmode: 'text' });
  const knapper = ['lykke', 'mathias'].map((navn) =>
    el('button', {
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => {
        hvem = navn;
        for (const k of knapper) k.setAttribute('aria-pressed', String(k.dataset.navn === navn));
        kode.focus();
      },
      'data-navn': navn,
      text: navn === 'lykke' ? 'Lykke' : 'Mathias',
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

  tegn(
    el('div', { class: 'topp' }, [el('h1', { text: '🫙 Lykkeglasset' })]),
    el('div', { class: 'kort' }, [
      el('p', { class: 'svak', text: 'Hvem er du?' }),
      el('div', { class: 'rad' }, knapper),
      el('div', { style: 'margin-top:1rem' }, [
        el('label', { for: 'kode', text: 'Kode' }),
        kode,
      ]),
      feilmelding && el('p', { class: 'liten', style: 'color:var(--aksent);margin-top:.6rem', text: feilmelding }),
      el('div', { style: 'margin-top:1rem' }, [
        el('button', { class: 'hoved', type: 'button', onclick: send, text: 'Lukk opp' }),
      ]),
    ]),
    el('p', { class: 'liten svak midt', text: 'Siden husker deg i et halvt år.' }),
  );
  kode.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}

/* ---------- kveldsrunden ---------- */

function kveldsrunden(tilstand, ferdig) {
  const fra = tilstand.idag;
  const utkast = {
    humor: fra?.humor ?? null,
    gode: [0, 1, 2].map((i) => fra?.gode_ting?.[i]?.tekst ?? ''),
    omOss: [0, 1, 2].map((i) => Boolean(fra?.gode_ting?.[i]?.om_oss)),
    tungt: fra?.tungt ?? '',
    behov: fra?.behov ?? null,
    del_gode: fra ? fra.del_gode : true,
    del_tungt: fra ? fra.del_tungt : false,
    privat: fra ? fra.privat : false,
  };
  let steg = 0;

  const ramme = (tittel, undertittel, innhold, { videre = 'Videre', kanVidere = true, sisteSteg = false } = {}) =>
    tegn(
      el('div', { class: 'topp' }, [
        el('div', {}, [
          el('p', { class: 'steg-tall', text: `Steg ${steg + 1} av 4` }),
          el('h1', { text: tittel }),
          undertittel && el('p', { class: 'svak liten', text: undertittel }),
        ]),
      ]),
      el('div', { class: 'kort' }, innhold),
      el('div', { class: 'stegrad' }, [
        el('button', {
          class: 'hoved',
          type: 'button',
          disabled: !kanVidere,
          onclick: () => (sisteSteg ? lagre() : (steg += 1, vis())),
          text: videre,
        }),
        el('button', {
          class: 'blank',
          type: 'button',
          onclick: () => (steg === 0 ? ferdig() : (steg -= 1, vis())),
          text: steg === 0 ? 'Avbryt' : 'Tilbake',
        }),
      ]),
    );

  /* steg 1: hvordan var dagen */
  const stegHumor = () => {
    const knapper = HUMOR.map((h) =>
      el('button', {
        type: 'button',
        'aria-pressed': String(utkast.humor === h.verdi),
        onclick: () => { utkast.humor = h.verdi; vis(); },
      }, [h.fjes, el('span', { text: h.ord })]));
    ramme('Hvordan var dagen?', datoOrd(tilstand.dato), [el('div', { class: 'humor' }, knapper)],
      { kanVidere: Boolean(utkast.humor) });
  };

  /* steg 2: tre gode ting */
  const stegGode = () => {
    const felt = [0, 1, 2].map((i) => {
      const inn = el('input', {
        type: 'text', value: utkast.gode[i], id: `god-${i}`,
        placeholder: ['Noe som var fint …', 'Noe mer …', 'Og én til …'][i],
        oninput: (e) => { utkast.gode[i] = e.target.value; },
      });
      const hake = el('input', {
        type: 'checkbox', checked: utkast.omOss[i],
        onchange: (e) => { utkast.omOss[i] = e.target.checked; },
      });
      return el('div', { style: 'margin-bottom:1rem' }, [
        el('label', { for: `god-${i}`, text: `${i + 1}.` }),
        inn,
        el('label', { class: 'hake' }, [hake, el('span', { text: 'Dette handler om oss' })]),
      ]);
    });
    ramme('Tre gode ting', 'Små ting teller. Kaffen. Været i fem minutter.', felt);
  };

  /* steg 3: det tunge */
  const stegTungt = () => {
    const felt = el('textarea', {
      value: utkast.tungt, id: 'tungt',
      placeholder: 'Skriv om du vil. Eller hopp over.',
      oninput: (e) => { utkast.tungt = e.target.value; },
    });
    // Knappen het «Hopp over» så lenge feltet var tomt, men teksten ble stående
    // til neste tegning – altså løy den mens hun skrev. Ett ord, alltid sant.
    ramme('Var noe tungt i dag?', 'Dette er ditt. Det deles bare hvis du sier fra.', [
      el('label', { for: 'tungt', text: 'Fritekst' }),
      felt,
      el('p', { class: 'liten svak', style: 'margin:.5rem 0 0', text: 'Å la det stå tomt er helt greit.' }),
    ]);
  };

  /* steg 4: hva trenger du, og hva sendes */
  const stegBehov = () => {
    const brikker = Object.entries(tilstand.behov).map(([nokkel, b]) =>
      el('button', {
        type: 'button',
        'aria-pressed': String(utkast.behov === nokkel),
        onclick: () => { utkast.behov = utkast.behov === nokkel ? null : nokkel; vis(); },
        text: b.etikett,
      }));

    const harGode = utkast.gode.some((g) => g.trim());
    const valg = el('div', { style: 'margin-top:1.2rem' }, [
      harGode && el('label', { class: 'hake' }, [
        el('input', {
          type: 'checkbox', checked: utkast.del_gode, disabled: utkast.privat,
          onchange: (e) => { utkast.del_gode = e.target.checked; vis(); },
        }),
        el('span', { text: 'Vis Mathias de gode tingene' }),
      ]),
      utkast.tungt.trim() && el('label', { class: 'hake' }, [
        el('input', {
          type: 'checkbox', checked: utkast.del_tungt, disabled: utkast.privat,
          onchange: (e) => { utkast.del_tungt = e.target.checked; vis(); },
        }),
        el('span', { text: 'Vis Mathias det som var tungt' }),
      ]),
      el('label', { class: 'hake' }, [
        el('input', {
          type: 'checkbox', checked: utkast.privat,
          onchange: (e) => { utkast.privat = e.target.checked; vis(); },
        }),
        el('span', { text: 'Hold hele dagen for meg selv' }),
      ]),
    ]);

    ramme('Hva trenger du?', 'Velg én, eller ingen.', [
      el('div', { class: 'brikker' }, brikker),
      valg,
      el('h3', { style: 'margin-top:1.2rem', text: 'Dette ser Mathias' }),
      forhåndsvisning(utkast, tilstand.behov),
    ], { videre: 'Lagre dagen', sisteSteg: true });
  };

  const lagre = async () => {
    try {
      const svar = await api('/dag', {
        metode: 'POST',
        kropp: {
          dato: tilstand.dato,
          humor: utkast.humor,
          gode_ting: utkast.gode
            .map((tekst, i) => ({ tekst, om_oss: utkast.omOss[i] }))
            .filter((g) => g.tekst.trim()),
          tungt: utkast.tungt,
          behov: utkast.behov,
          del_gode: utkast.del_gode,
          del_tungt: utkast.del_tungt,
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
 * Sier med ord hva som går videre. Den bygger ikke selve Telegram-teksten –
 * den finnes ett sted, på serveren – men den skal ikke kunne overraske.
 */
function forhåndsvisning(u, behov) {
  if (u.privat) {
    return el('div', { class: 'sendes' }, 'Ingenting. Dagen blir liggende her, bare for deg.');
  }
  const linjer = [`Dagen: ${u.humor ?? '–'} av 5 – ${humorOrd(u.humor).toLowerCase()}`];
  if (u.behov) linjer.push(`Du trenger: ${behov[u.behov].etikett.toLowerCase()}`);
  const gode = u.gode.filter((g) => g.trim());
  if (u.del_gode && gode.length) linjer.push('', 'Tre gode ting:', ...gode.map((g) => `  • ${g}`));
  else if (gode.length) linjer.push('De gode tingene beholder du for deg selv.');
  if (u.tungt.trim()) {
    linjer.push(u.del_tungt ? `\nDu skrev: «${u.tungt.trim()}»` : '\nDet du skrev om det tunge, blir her.');
  }
  const pling = u.humor <= 2 || u.humor === 5 || u.behov === 'ringe' || u.behov === 'komme';
  linjer.push('', pling
    ? '→ Han får varsel på telefonen nå.'
    : '→ Ingen varsel. Det står her når han åpner appen.');
  return el('div', { class: 'sendes' }, linjer.join('\n'));
}

/* ---------- Lykkes side ---------- */

function visLykke(t) {
  const dag = t.idag;

  const prikker = el('div', { class: 'prikker' },
    t.historikk.map((d) => el('span', {
      class: 'prikk',
      'data-humor': d.privat ? null : d.humor,
      'data-privat': d.privat ? 'ja' : null,
      title: `${datoOrd(d.dato)}${d.privat ? '' : ` – ${humorOrd(d.humor).toLowerCase()}`}`,
    })));

  const hilsen = t.hilsen && el('div', { class: 'kort' }, [
    el('h2', { text: '💌 Fra Mathias' }),
    el('p', { style: 'white-space:pre-wrap', text: t.hilsen.tekst }),
    el('p', { class: 'liten svak', text: `Skrevet ${klokkeslett(t.hilsen.laget_kl)} ${datoOrd(t.hilsen.laget_kl.slice(0, 10))}` }),
  ]);
  if (t.hilsen && !t.hilsen.lest_kl) {
    api('/hilsen/lest', { metode: 'POST', kropp: { id: t.hilsen.id } }).catch(() => {});
  }

  const dagensKort = dag
    ? el('div', { class: 'kort' }, [
      el('h2', { text: `${humorFjes(dag.humor)} Dagen er ført` }),
      el('p', { class: 'svak liten', text: `${humorOrd(dag.humor)} · ${klokkeslett(dag.skrevet_kl)}${dag.privat ? ' · privat' : ''}` }),
      el('ul', { class: 'liste' }, dag.gode_ting.map((g) =>
        el('li', {}, [g.om_oss ? '💞 ' : '', g.tekst]))),
      el('button', {
        class: 'blank', type: 'button', style: 'margin-top:.5rem',
        onclick: () => kveldsrunden(t, start),
        text: 'Endre dagen',
      }),
    ])
    : el('div', { class: 'kort' }, [
      el('h2', { text: 'Kveldsrunden' }),
      el('p', { class: 'svak', text: 'Tre gode ting, og hvordan dagen var. Under ett minutt.' }),
      el('button', { class: 'hoved', type: 'button', onclick: () => kveldsrunden(t, start), text: 'Begynn' }),
    ]);

  const brev = t.brev.length && el('div', { class: 'kort' }, [
    el('h2', { text: t.brev.length === 1 ? '💌 Et brev ligger klart' : `💌 ${t.brev.length} brev ligger klare` }),
    el('p', { class: 'svak liten', text: 'Skrevet på forhånd, til en dag du trenger det.' }),
    el('button', {
      class: 'hoved', type: 'button', text: 'Åpne ett',
      onclick: async () => {
        try {
          const b = await api(`/brev/${t.brev[0].id}/apne`, { metode: 'POST' });
          tegn(
            el('div', { class: 'kort' }, [
              el('h2', { text: '💌' }),
              el('p', { style: 'white-space:pre-wrap', text: b.tekst }),
              el('button', { class: 'blank', type: 'button', onclick: start, text: 'Lukk' }),
            ]),
          );
        } catch (e) { si(e.message); }
      },
    }),
  ]);

  const ifjor = t.ifjor && !t.ifjor.privat && el('div', { class: 'kort' }, [
    el('h2', { text: 'På denne dagen i fjor' }),
    el('p', { class: 'svak liten', text: `${humorFjes(t.ifjor.humor)} ${humorOrd(t.ifjor.humor)}` }),
    el('ul', { class: 'liste' }, t.ifjor.gode_ting.map((g) => el('li', { text: g.tekst }))),
  ]);

  tegn(
    el('div', { class: 'topp' }, [
      el('h1', { text: 'God kveld, Lykke' }),
      el('button', { class: 'blank liten', type: 'button', onclick: loggUt, text: 'Logg ut' }),
    ]),
    hilsen,
    dagensKort,
    brev,
    el('div', { class: 'kort' }, [
      el('h2', { text: '🫙 Glasset' }),
      el('p', { class: 'svak liten', text: 'Noe godt du skrev en gang, og sikkert har glemt.' }),
      el('div', { id: 'glassrute' }),
      el('button', {
        class: 'hoved', type: 'button', text: 'Trekk en lapp',
        onclick: async () => {
          const rute = document.getElementById('glassrute');
          try {
            const g = await api('/glasset');
            rute.replaceChildren(g.tom
              ? el('p', { class: 'svak', text: 'Glasset er tomt ennå. Det fyller seg opp.' })
              : el('div', { class: 'sendes' }, [
                el('p', { style: 'margin:0 0 .4rem', text: `«${g.tekst}»` }),
                el('span', { class: 'liten svak', text: g.når }),
              ]));
          } catch (e) { si(e.message); }
        },
      }),
    ]),
    ifjor,
    el('div', { class: 'kort' }, [
      el('h2', { text: 'Året så langt' }),
      el('p', {}, [
        el('span', { class: 'stor-tall', text: String(t.antall_gode_ting) }),
        el('span', { class: 'svak', text: ' gode ting skrevet' }),
      ]),
      el('p', { class: 'svak liten', text: `${t.dager_i_ar} dager ført i år` }),
      prikker,
    ]),
  );
}

/* ---------- Mathias' side ---------- */

function visMathias(t) {
  const dag = t.idag;

  const idagKort = el('div', { class: 'kort' }, dag
    ? dag.privat
      ? [el('h2', { text: 'I dag' }), el('p', { class: 'svak', text: 'Hun har ført dagen, men holdt den for seg selv.' })]
      : [
        el('h2', { text: `${humorFjes(dag.humor)} ${humorOrd(dag.humor)}` }),
        el('p', { class: 'svak liten', text: `I dag · ført ${klokkeslett(dag.skrevet_kl)}` }),
        dag.behov && el('p', {}, [el('strong', { text: 'Hun trenger: ' }), t.behov[dag.behov].etikett.toLowerCase()]),
        dag.gode_ting.length && el('ul', { class: 'liste' }, dag.gode_ting.map((g) =>
          el('li', {}, [g.om_oss ? '💞 ' : '', g.tekst]))),
        dag.holdt_gode && el('p', { class: 'liten svak', text: 'De gode tingene beholdt hun for seg selv.' }),
        dag.tungt && el('p', { class: 'sendes', text: dag.tungt }),
        dag.holdt_tungt && el('p', { class: 'liten svak', text: 'Noe var tungt. Hun valgte å ikke dele det.' }),
      ]
    : [
      el('h2', { text: 'I dag' }),
      el('p', { class: 'svak', text: 'Ikke ført ennå.' }),
      t.sist_skrevet && el('p', { class: 'liten svak', text: `Sist: ${datoOrd(t.sist_skrevet)}` }),
    ]);

  const hilsenFelt = el('textarea', { placeholder: 'Noe hun skal lese i morgen tidlig …', id: 'hilsen' });
  const brevFelt = el('textarea', { placeholder: 'Et brev som ligger til en dårlig dag …', id: 'brev' });

  tegn(
    el('div', { class: 'topp' }, [
      el('h1', { text: 'Hos Lykke' }),
      el('button', { class: 'blank liten', type: 'button', onclick: loggUt, text: 'Logg ut' }),
    ]),
    idagKort,
    el('div', { class: 'kort' }, [
      el('h2', { text: 'Siste ukene' }),
      el('div', { class: 'prikker' }, t.historikk.map((d) => el('span', {
        class: 'prikk',
        'data-humor': d.privat ? null : d.humor,
        'data-privat': d.privat ? 'ja' : null,
        title: `${datoOrd(d.dato)}${d.privat ? ' – privat' : ` – ${humorOrd(d.humor).toLowerCase()}`}`,
      }))),
    ]),
    el('div', { class: 'kort' }, [
      el('h2', { text: '💌 Dagens hilsen' }),
      el('p', { class: 'svak liten', text: t.hilsen ? `Forrige: «${t.hilsen.tekst.slice(0, 60)}…»${t.hilsen.lest_kl ? ' – lest' : ' – ikke lest ennå'}` : 'Ingen skrevet ennå.' }),
      hilsenFelt,
      el('button', {
        class: 'hoved', type: 'button', style: 'margin-top:.6rem', text: 'Legg den klar',
        onclick: async () => {
          if (!hilsenFelt.value.trim()) return si('Tom hilsen.');
          try { await api('/hilsen', { metode: 'POST', kropp: { tekst: hilsenFelt.value } }); si('Lagt klar.'); start(); }
          catch (e) { si(e.message); }
        },
      }),
    ]),
    el('div', { class: 'kort' }, [
      el('h2', { text: 'Brev til en dårlig dag' }),
      el('p', { class: 'svak liten', text: (() => {
        const n = t.brev.filter((b) => !b.apnet_kl).length;
        return n === 1 ? 'Ett uåpnet.' : `${n} uåpnede.`;
      })() }),
      brevFelt,
      el('button', {
        class: 'hoved', type: 'button', style: 'margin-top:.6rem', text: 'Legg i glasset',
        onclick: async () => {
          if (!brevFelt.value.trim()) return si('Tomt brev.');
          try { await api('/brev', { metode: 'POST', kropp: { tekst: brevFelt.value } }); si('Lagt inn.'); start(); }
          catch (e) { si(e.message); }
        },
      }),
      t.brev.length && el('ul', { class: 'liste', style: 'margin-top:.8rem' }, t.brev.map((b) =>
        el('li', { class: 'liten svak', text: `${datoOrd(b.laget_kl.slice(0, 10))} – ${b.apnet_kl ? `åpnet ${datoOrd(b.apnet_kl.slice(0, 10))}` : 'ligger klart'}` }))),
    ]),
    t.om_oss.length && el('div', { class: 'kort' }, [
      el('h2', { text: '💞 Om oss' }),
      el('ul', { class: 'liste' }, t.om_oss.map((g) =>
        el('li', {}, [g.tekst, el('div', { class: 'liten svak', text: datoOrd(g.dato) })]))),
    ]),
  );
}

/* ---------- oppstart ---------- */

async function loggUt() {
  await api('/logg-ut').catch(() => {});
  visLoggInn();
}

async function start() {
  try {
    const { hvem } = await api('/meg');
    if (!hvem) return visLoggInn();
    const t = await api('/tilstand');
    (hvem === 'lykke' ? visLykke : visMathias)(t);
  } catch {
    visLoggInn();
  }
}

start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
