/**
 * Hva som skal sendes, og hva det skal stå.
 *
 * To ting styrer alt her:
 *
 * 1. **Hun bestemmer.** Er dagen merket privat, går ingenting ut – uansett
 *    hvor lav den er. Fritekst deles bare hvis hun har huket det av.
 * 2. **Varsler bare når det betyr noe.** Får han pling hver kveld, slutter
 *    han å se etter. Får han pling bare når det er tungt, blir appen et
 *    alarmanlegg, og da slutter hun å skrive. Derfor går både de tunge og de
 *    skikkelig gode dagene gjennom, og alt midt imellom blir stående i appen.
 *
 * Rene funksjoner: ingen fetch, ingen database, ingen klokke som ikke kommer
 * inn som argument.
 */

/** Hva hun kan be om. `hast` avgjør om varselet kommer med lyd. */
export const BEHOV = {
  vite: { etikett: 'Ingenting, bare vit det', hast: false },
  klem: { etikett: 'En klem', hast: false },
  ringe: { etikett: 'Ring meg', hast: true },
  komme: { etikett: 'Kom hit', hast: true },
  vaere: { etikett: 'Ikke spør, bare vær der', hast: false },
  snakke: { etikett: 'Snakke i morgen', hast: false },
  alene: { etikett: 'La meg være i fred i kveld', hast: false },
};

/**
 * Knappene som ligger under de varslene det går an å gjøre noe med.
 *
 * Poenget er at et varsel om en tung dag ellers bare er en beskjed: du får
 * vite at det er tungt, og så skjer det ingenting. Ett trykk her, og hun ser
 * svaret i appen innen sekunder.
 */
export const SVAR = {
  ringer: { knapp: 'Ringer deg nå', melding: 'Jeg ringer deg nå.' },
  kommer: { knapp: 'Kommer hjem', melding: 'Jeg kommer hjem.' },
  tenker: { knapp: 'Tenker på deg 🫂', melding: 'Tenker på deg.' },
};

const SVARKNAPPER = [
  [['Ringer deg nå', 'svar:ringer'], ['Kommer hjem', 'svar:kommer']],
  [['Tenker på deg 🫂', 'svar:tenker']],
];

/** Varsler man kan gjøre noe med, får knapper. Resten skal ikke mase. */
const KNAPPER_FOR = new Set(['rop', 'tung', 'monster', 'morgen']);

export const HUMOR = {
  1: 'veldig tung',
  2: 'tung',
  3: 'midt på treet',
  4: 'god',
  5: 'skikkelig god',
};

/**
 * Rydder en innsendt dag til noe som trygt kan lagres.
 *
 * I delt modus finnes ikke valgene om hva som holdes tilbake – da deles alt,
 * og appen sier det rett ut i stedet for å tilby knapper som ikke gjelder.
 */
export function ryddDag(rå = {}, delt = false) {
  // Uten et tall å gå ut fra er «midt på treet» det ærligste – ikke 1, som
  // ville utløst varsel om en tung dag hun aldri har sagt at hun hadde.
  const tall = Number(rå.humor);
  const humor = Number.isFinite(tall) ? Math.min(5, Math.max(1, Math.round(tall))) : 3;
  const godeTing = (Array.isArray(rå.gode_ting) ? rå.gode_ting : [])
    .map((g) => ({
      tekst: String(g?.tekst ?? '').trim().slice(0, 280),
      om_oss: Boolean(g?.om_oss),
    }))
    .filter((g) => g.tekst)
    .slice(0, 3);
  const behov = Object.hasOwn(BEHOV, rå.behov) ? rå.behov : null;
  const tungt = String(rå.tungt ?? '').trim().slice(0, 2000) || null;
  // Valget er ett, ikke tre: dagen deles, eller så er den hennes. Tre brytere
  // for samme spørsmål gjorde det bare vanskeligere å vite hva som gikk ut.
  const privat = !delt && rå.privat === true;
  return {
    humor,
    gode_ting: godeTing,
    tungt,
    behov,
    del_gode: privat ? 0 : 1,
    del_tungt: privat ? 0 : 1,
    privat: privat ? 1 : 0,
  };
}

/**
 * Hvilke varsler dagen utløser.
 *
 * @param {object} arg
 * @param {object} arg.dag      dagen slik den nå er lagret
 * @param {object|null} arg.igår  dagen før, hvis den finnes
 * @param {string[]} arg.sendt  slag som allerede er sendt for denne datoen
 * @returns {Array<{slag:string, tekst:string, stille:boolean}>}
 */
export function varslerForDag({ dag, igår = null, sendt = [] }) {
  if (!dag || dag.privat) return [];

  const ut = [];
  const legg = (slag, stille) => {
    if (sendt.includes(slag)) return;
    ut.push({
      slag,
      tekst: melding(slag, dag),
      stille,
      knapper: KNAPPER_FOR.has(slag) ? SVARKNAPPER : null,
    });
  };

  const hastebehov = dag.behov && BEHOV[dag.behov]?.hast;
  if (hastebehov) legg('rop', false);

  if (dag.humor <= 2) {
    // Har hun allerede bedt om å bli ringt, er «tung dag» bare støy oppå det.
    if (!hastebehov) legg('tung', false);
    if (igår && !igår.privat && igår.humor <= 2) legg('monster', true);
  }

  if (dag.humor === 5) legg('god', false);

  // En delt dag skal alltid fram: de som ikke utløste noe av det over, går som
  // en stille oppsummering – ellers ville bare ytterpunktene nådd ham, og
  // hverdagen vært taus. Men bare når ingenting er sagt om dagen fra før;
  // ellers ville hver lille rettelse gitt en ny melding.
  if (!ut.length && !sendt.length) legg('dagen', true);

  return ut;
}

const OVERSKRIFT = {
  rop: (dag) => `📞 Lykke trenger deg nå – «${BEHOV[dag.behov].etikett.toLowerCase()}»`,
  tung: () => '🫂 Lykke har hatt en tung dag',
  monster: () => '🫂 Andre tunge dagen på rad',
  god: () => '✨ Lykke har hatt en skikkelig god dag',
  dagen: (dag) => `🫙 Lykke førte dagen – ${HUMOR[dag.humor]}`,
  morgen: () => '☀️ God morgen. I går var tung hos Lykke',
};

/** Selve teksten i Telegram. Ren tekst – ingen formatering å rote med. */
export function melding(slag, dag) {
  const linjer = [OVERSKRIFT[slag](dag), ''];

  linjer.push(`Dagen: ${dag.humor} av 5 – ${HUMOR[dag.humor]}`);

  if (dag.behov && slag !== 'rop') {
    linjer.push(`Hun trenger: ${BEHOV[dag.behov].etikett.toLowerCase()}`);
  }

  if (dag.del_tungt && dag.tungt) {
    linjer.push('', `Hun skrev: «${dag.tungt}»`);
  }

  const gode = dag.del_gode ? (dag.gode_ting ?? []) : [];
  if (gode.length && slag !== 'monster' && slag !== 'rop') {
    linjer.push('', 'Tre gode ting i dag:');
    for (const g of gode) linjer.push(`  • ${g.tekst}`);
  }

  if (slag === 'monster') {
    linjer.push('', 'To dager på rad. Kanskje det er verdt et spørsmål framfor å vente.');
  }
  if (slag === 'morgen') {
    linjer.push('', 'Varselet kom i går kveld, da du sov. Nå kan du gjøre noe med det.');
  }

  return linjer.join('\n');
}

/**
 * Puffet morgenen etter en tung kveld.
 *
 * Et varsel klokka 22:40 er lite verdt – da sover han. Dette er den samme
 * beskjeden, levert på et tidspunkt den kan brukes til noe.
 */
export function morgenPuff(dag) {
  return { tekst: melding('morgen', dag), knapper: SVARKNAPPER };
}

const snittOrd = (n) => (n == null ? '–' : n.toFixed(1).replace('.', ','));

/** Én melding i uka som sier noe en enkeltdag ikke kan. */
export function ukesbrev(uke, godeTing) {
  const linjer = [
    '📆 Uka hos Lykke',
    '',
    `Snitt: ${snittOrd(uke.snitt)} av 5${uke.forrige_snitt == null ? '' : ` (uka før: ${snittOrd(uke.forrige_snitt)})`}`,
    `${uke.ført} dager ført · ${uke.gode} gode · ${uke.tunge} tunge`,
  ];
  if (uke.behov.length) {
    const teller = new Map();
    for (const b of uke.behov) teller.set(b, (teller.get(b) ?? 0) + 1);
    linjer.push('', 'Hun har bedt om:');
    for (const [b, n] of teller) {
      linjer.push(`  • ${BEHOV[b].etikett.toLowerCase()}${n > 1 ? ` (${n} ganger)` : ''}`);
    }
  }
  if (godeTing) linjer.push('', `${godeTing} gode ting skrevet denne uka.`);

  const retning = uke.snitt != null && uke.forrige_snitt != null ? uke.snitt - uke.forrige_snitt : null;
  if (retning != null && Math.abs(retning) >= 0.4) {
    linjer.push('', retning > 0 ? 'Det går oppover.' : 'Det har vært tyngre enn uka før.');
  }
  return linjer.join('\n');
}

/* ---------- svar på spørsmål fra Telegram ---------- */

/** Dagen hennes, slik den spørres etter. */
export function dagsrapport(dag, dato) {
  if (!dag) return `🫙 Ingenting ført ${dato} ennå.`;
  if (dag.privat) return `🔒 Dagen er ført, men holdt for seg selv.`;

  const linjer = [`${dag.humor} av 5 – ${HUMOR[dag.humor]}`];
  if (dag.behov) linjer.push(`Hun trenger: ${BEHOV[dag.behov].etikett.toLowerCase()}`);
  if (dag.gode_ting?.length) {
    linjer.push('', 'Tre gode ting:');
    for (const g of dag.gode_ting) linjer.push(`  • ${g.tekst}`);
  }
  if (dag.holdt_gode) linjer.push('', 'De gode tingene beholdt hun for seg selv.');
  if (dag.tungt) linjer.push('', `Hun skrev: «${dag.tungt}»`);
  if (dag.holdt_tungt) linjer.push('', 'Noe var tungt. Det er ikke delt.');
  return linjer.join('\n');
}

/** Ønskelista, med de gjorte nederst. */
export function onskeliste(onsker) {
  if (!onsker.length) return '✨ Ønskelista er tom. Legg til med «/onske <noe dere skal gjøre>».';
  const igjen = onsker.filter((o) => !o.gjort_kl);
  const gjort = onsker.filter((o) => o.gjort_kl);
  const linjer = [`✨ Ønskelista – ${igjen.length} igjen`, ''];
  for (const o of igjen) linjer.push(`  ○ ${o.tekst}`);
  if (gjort.length) {
    linjer.push('', 'Gjort:');
    for (const o of gjort) linjer.push(`  ✓ ${o.tekst}`);
  }
  return linjer.join('\n');
}

/** Hvor ting står akkurat nå. */
export function statuslinje({ sist, sistAktiv, uleste, brev, onsker }) {
  return [
    '🫙 Status',
    '',
    `Sist ført: ${sist ?? 'aldri'}`,
    `Sist inne i appen: ${sistAktiv ?? 'ukjent'}`,
    `Uleste meldinger til henne: ${uleste}`,
    `Brev som ligger klare: ${brev}`,
    `Ønsker igjen: ${onsker}`,
  ].join('\n');
}

/** Siste kvelden i året. Den eneste meldingen som blir bedre for hvert år. */
export function arsbok(ar, antall, dager) {
  return [
    `🫙 ${ar} er i glasset.`,
    '',
    `${antall} gode ting, skrevet over ${dager} dager.`,
    '',
    'Årsboka ligger i appen, under Glasset. Les den sammen.',
  ].join('\n');
}

/** Påminnelsen om at kveldsrunden ikke er fylt ut. Går stille. */
export function påminnelse() {
  return [
    '🫙 Kveldsrunden står tom i dag.',
    '',
    'Tre gode ting, og hvordan dagen var. Tar under ett minutt.',
  ].join('\n');
}

/** Sendes når det har gått noen dager uten at noe er skrevet. */
export function stilleDager(antall) {
  return [
    `🫙 Det er ${antall} dager siden sist Lykke skrev noe her.`,
    '',
    'Trenger ikke bety noe. Men nå vet du det.',
  ].join('\n');
}

/** Når hun åpner et brev, får han vite det. */
export function brevÅpnet(laget) {
  return `💌 Lykke åpnet brevet du la inn ${laget}.`;
}

/**
 * Melding fra henne. Den går alltid gjennom – en melding er noe hun
 * uttrykkelig har sendt til ham, ikke noe appen har tolket seg fram til.
 */
export function nyMelding(tekst) {
  return `💬 Melding fra Lykke:\n\n«${tekst}»`;
}

/**
 * Hun har åpnet appen. Sendes stille, og høyst én gang i timen – ellers blir
 * det et pip hver gang hun bytter fane.
 */
export function erAktiv(klokkeslett) {
  return `👋 Lykke er inne i appen nå (${klokkeslett}).`;
}

/** Noe nytt på ønskelista. Går stille; det haster aldri. */
export function nyttOnske(tekst) {
  return `✨ Lykke la til på ønskelista: «${tekst}»`;
}
