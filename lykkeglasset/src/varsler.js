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

const PERIODENAVN = { uke: 'Sju siste dagene', maned: 'Siste måneden', ar: 'Siste året' };

/** Tallene for en periode, og hennes egne ord om den beste og den tyngste. */
export function sammendragstekst(d, behovTabell = BEHOV) {
  const linjer = [`📆 ${PERIODENAVN[d.periode] ?? 'Perioden'}`, ''];
  linjer.push(`${d.ført} dager ført${d.private ? ` (${d.private} holdt for seg selv)` : ''}`);
  if (d.snitt != null) {
    linjer.push(`Snitt: ${d.snitt.toFixed(1).replace('.', ',')} av 5`);
    linjer.push(`${d.gode_dager} gode · ${d.tunge_dager} tunge`);
  }
  linjer.push(`${d.antall_gode_ting} gode ting${d.om_oss ? `, ${d.om_oss} om dere` : ''}`);
  if (d.antall_bilder) linjer.push(`${d.antall_bilder} bilder og lydklipp`);

  if (d.beste) {
    linjer.push('', `Beste dagen: ${norskDatoKort(d.beste.dato)} – ${d.beste.humor} av 5`);
    for (const g of d.beste.gode_ting.slice(0, 3)) linjer.push(`  • ${g.tekst}`);
  }
  if (d.tyngste) {
    linjer.push('', `Tyngste dagen: ${norskDatoKort(d.tyngste.dato)} – ${d.tyngste.humor} av 5`);
  }
  if (d.behov.length) {
    linjer.push('', 'Hun har bedt om:');
    for (const b of d.behov) {
      linjer.push(`  • ${behovTabell[b.behov].etikett.toLowerCase()}${b.antall > 1 ? ` (${b.antall})` : ''}`);
    }
  }
  return linjer.join('\n');
}

const norskDatoKort = (n) => `${Number(n.slice(8))}.${Number(n.slice(5, 7))}.`;

/** Hvor langt hun er kommet i spørsmålslista, og det siste hun har svart. */
export function sporsmalstekst({ ferdig, igjen, svarte }) {
  const linjer = [`📝 Lykke har svart på ${ferdig} av ${ferdig + igjen} spørsmål.`];
  if (!svarte.length) return `${linjer[0]}\n\nIngen svar ennå.`;
  for (const s of svarte.slice(0, 3)) {
    linjer.push('', s.t, `  «${s.svar}»`);
  }
  if (svarte.length > 3) linjer.push('', `… og ${svarte.length - 3} til i appen.`);
  return linjer.join('\n');
}

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

/* ---------- kveldens spørsmål ---------- */

/**
 * Spørsmålet som kommer i tillegg til de tre gode tingene.
 *
 * Et skjema som ser likt ut 365 kvelder på rad blir et skjema. Dette veksler,
 * og det samme spørsmålet kommer igjen først om et par måneder.
 */
export const SPORSMAL = [
  'Hva lo du av i dag?',
  'Hvem tenkte du på?',
  'Hva var det første du kjente da du våknet?',
  'Hva gledet du deg til?',
  'Hva sa du ja til i dag?',
  'Hva sa du nei til?',
  'Hvor var du da du pustet ut?',
  'Hva smakte best?',
  'Hva hørte du som du likte?',
  'Hva ville du gjort om igjen?',
  'Hvem burde fått vite at du satte pris på dem?',
  'Hva slags vær var det inni deg?',
  'Hva tok lengst tid i dag?',
  'Hva var du stolt av?',
  'Hva trengte du mer av?',
  'Hva sa du til deg selv i dag?',
  'Hvor lenge var du ute?',
  'Hva holdt du på med da du glemte tida?',
  'Hva var rart i dag?',
  'Hva vil du huske fra i dag om ti år?',
];

/** Samme dag gir samme spørsmål, for begge to, uansett når de spør. */
export function sporsmalFor(dato) {
  const tall = [...dato].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 100000, 7);
  return SPORSMAL[tall % SPORSMAL.length];
}

/* ---------- spørsmålslista ---------- */

/**
 * Lykkes egen liste. Ikke kveldsrunden – dette er spørsmål man svarer på når
 * man har lyst, og svarene legger seg i arkivet sammen med de gode tingene.
 *
 * Rekkefølgen er nøkkelen: et svar peker på plassen i denne lista, så nye
 * spørsmål må legges til på slutten og gamle aldri fjernes.
 */
export const KATEGORIER = {
  meg: 'Om meg',
  oss: 'Om oss',
  minner: 'Minner',
  framover: 'Framover',
  smatt: 'Småting',
};

/**
 * Nøkkelen er det som lagres, ikke plassen i lista. Nye spørsmål kan legges
 * hvor som helst og gamle kan tas ut, uten at et svar plutselig hører til et
 * annet spørsmål enn det hun svarte på.
 */
export const LISTA = [
  { k: 1, kat: 'meg', t: 'Hva er du best til som ingen vet om?' },
  { k: 2, kat: 'meg', t: 'Hva er du dårligst til å be om?' },
  { k: 3, kat: 'meg', t: 'Hva gjør du når ingen ser på?' },
  { k: 4, kat: 'meg', t: 'Hva er du stolt av som ikke står på noen CV?' },
  { k: 5, kat: 'meg', t: 'Hvilken versjon av deg selv er du mest glad i?' },
  { k: 6, kat: 'meg', t: 'Hva gjør deg rolig?' },
  { k: 7, kat: 'meg', t: 'Hva er ditt trygge sted?' },
  { k: 8, kat: 'meg', t: 'Hva liker du ved deg selv om morgenen?' },
  { k: 9, kat: 'meg', t: 'Hva er du ferdig med å bry deg om?' },
  { k: 10, kat: 'meg', t: 'Hva gjør deg sint, men på en god måte?' },
  { k: 11, kat: 'meg', t: 'Hvilken årstid er du?' },
  { k: 12, kat: 'meg', t: 'Hva slags kveld trenger du når alt er mye?' },

  { k: 13, kat: 'oss', t: 'Hva er den beste dagen du har hatt med Mathias?' },
  { k: 14, kat: 'oss', t: 'Når visste du at det var noe?' },
  { k: 15, kat: 'oss', t: 'Hva er det rareste dere gjør sammen?' },
  { k: 16, kat: 'oss', t: 'Hva tror du han ikke vet at du legger merke til?' },
  { k: 17, kat: 'oss', t: 'Hva er han best til?' },
  { k: 18, kat: 'oss', t: 'Hva savner du når han ikke er der?' },
  { k: 19, kat: 'oss', t: 'Hvilken vane hos ham har du begynt å gjøre selv?' },
  { k: 20, kat: 'oss', t: 'Hva vil du dere skal bli bedre på?' },
  { k: 21, kat: 'oss', t: 'Hva er den beste samtalen dere har hatt?' },
  { k: 22, kat: 'oss', t: 'Hva skulle du sagt oftere?' },
  { k: 23, kat: 'oss', t: 'Hvor skulle du ønske dere dro nå?' },
  { k: 24, kat: 'oss', t: 'Hva slags gamle mennesker tror du dere blir?' },

  { k: 25, kat: 'minner', t: 'Hvor var du lykkeligst som barn?' },
  { k: 26, kat: 'minner', t: 'Hva lukter barndom?' },
  { k: 27, kat: 'minner', t: 'Hva er det fineste noen har sagt til deg?' },
  { k: 28, kat: 'minner', t: 'Hvilken dag ville du levd om igjen, akkurat lik?' },
  { k: 29, kat: 'minner', t: 'Hva er det vanskeligste du har klart?' },
  { k: 30, kat: 'minner', t: 'Hva sa foreldrene dine som du hører deg selv si nå?' },
  { k: 31, kat: 'minner', t: 'Hvilken kompliment sitter fortsatt i?' },
  { k: 32, kat: 'minner', t: 'Hva er den beste gaven du har gitt?' },
  { k: 33, kat: 'minner', t: 'Hvilket sted vil du tilbake til?' },
  { k: 34, kat: 'minner', t: 'Hva er du redd for å glemme?' },
  { k: 35, kat: 'minner', t: 'Hvem savner du?' },
  { k: 36, kat: 'minner', t: 'Hvilket råd har du fått som var feil?' },

  { k: 37, kat: 'framover', t: 'Hva ville du gjort med et helt år fri?' },
  { k: 38, kat: 'framover', t: 'Hvilken vane vil du ha om ti år?' },
  { k: 39, kat: 'framover', t: 'Hva vil du lære?' },
  { k: 40, kat: 'framover', t: 'Hva slags gammel dame vil du bli?' },
  { k: 41, kat: 'framover', t: 'Hva vil du at folk skal huske deg for?' },
  { k: 42, kat: 'framover', t: 'Hva ville du sagt til deg selv om fem år?' },
  { k: 43, kat: 'framover', t: 'Hva håper du blir likt om ti år?' },
  { k: 44, kat: 'framover', t: 'Hva håper du blir annerledes?' },
  { k: 45, kat: 'framover', t: 'Hva skulle du ønske du turte oftere?' },
  { k: 46, kat: 'framover', t: 'Hvem har du lyst til å ta kontakt med?' },
  { k: 47, kat: 'framover', t: 'Hva er du nysgjerrig på nå?' },
  { k: 48, kat: 'framover', t: 'Hva vil du at dette glasset skal ha samlet opp om fem år?' },

  { k: 49, kat: 'smatt', t: 'Hvilken sang kan du ikke høre uten å bli i godt humør?' },
  { k: 50, kat: 'smatt', t: 'Hvilken mat smaker hjem?' },
  { k: 51, kat: 'smatt', t: 'Hva er det dummeste du har ledd av?' },
  { k: 52, kat: 'smatt', t: 'Hva er din favorittid på døgnet, og hvorfor?' },
  { k: 53, kat: 'smatt', t: 'Hvordan ser en perfekt lørdag ut?' },
  { k: 54, kat: 'smatt', t: 'Hva er det rareste du har vært redd for?' },
  { k: 55, kat: 'smatt', t: 'Hvilken liten ting kan redde en dårlig dag?' },
  { k: 56, kat: 'smatt', t: 'Hva er det fineste ved der du bor nå?' },
  { k: 57, kat: 'smatt', t: 'Hvilken bok eller film har forandret noe i deg?' },
  { k: 58, kat: 'smatt', t: 'Hva tar du for gitt som du ikke burde?' },
  { k: 59, kat: 'smatt', t: 'Hva er det siste som fikk deg til å gråte av noe fint?' },
  { k: 60, kat: 'smatt', t: 'Hva gjør en dag god, egentlig?' },
];

/** Slår opp ett spørsmål på nøkkelen sin. */
export const sporsmalMed = (k) => LISTA.find((s) => s.k === Number(k)) ?? null;

/* ---------- milepæler ---------- */

const MILEPÆLER = [100, 250, 500, 1000, 2500, 5000];

/** Hvilken milepæl et tall nettopp passerte, hvis noen. */
export const milepælFor = (antall, før) =>
  MILEPÆLER.find((m) => før < m && antall >= m) ?? null;

export const milepæl = (n) => [
  '🎉 Milepæl!',
  '',
  `Lykke har skrevet ${n} gode ting i glasset.`,
  '',
  n >= 1000 ? 'Det er et helt liv av små ting.' : 'Det blir et fint glass.',
].join('\n');

/* ---------- menyen i Telegram ---------- */

/** Forsida i boten. Én melding som bytter innhold, ikke en strøm av nye. */
export const MENY = [
  [['📅 I dag', 'meny:idag'], ['📆 Sammendrag', 'meny:sammendrag']],
  [['🫙 Glasset', 'meny:glasset'], ['📝 Spørsmål', 'meny:sporsmal']],
  [['✨ Ønskelista', 'meny:onsker'], ['💌 Brev', 'meny:brev']],
  [['📋 Status', 'meny:status'], ['⬇️ Eksporter', 'meny:eksport']],
  [['🔑 Logg meg inn', 'meny:logginn'], ['🔗 Lenke til Lykke', 'meny:lenkelykke']],
];

export const PERIODER = [
  [['Uka', 'meny:sammendrag:uke'], ['Måneden', 'meny:sammendrag:maned'], ['Året', 'meny:sammendrag:ar']],
];

export const TILBAKE = [[['‹ Meny', 'meny:hjem']]];

export const MENYTEKST = [
  '🫙 Lykkeglasset',
  '',
  'Trykk deg rundt, eller skriv:',
  '  /si <tekst> – melding til Lykke',
  '  … eller send et bilde / en talemelding rett hit',
  '  /brev <tekst> – brev til en dårlig dag',
  '  /onske <tekst> – på ønskelista',
  '  /dag 2026-09-14 – én bestemt dag',
  '  /sammendrag, /maned, /ar – tallene for en periode',
  '  /sporsmal – hvor langt hun er kommet i lista',
  '  /kode <ny kode> – ny kode for Lykke',
  '  /eksport – alt sammen som én fil',
].join('\n');

/* ---------- ting hun gjør ---------- */

export const REAKSJONER = ['❤️', '😂', '🥹', '✨'];

export const HENDELSER = {
  innlogging: () => '🔓 Lykke logget inn i appen.',
  begynt: () => '✍️ Lykke holder på med kveldsrunden nå.',
  lest: () => '👀 Lykke har lest meldingene dine.',
  deling: (på) => (på
    ? '🔓 Lykke slo på delt modus. Du ser alt hun fører nå.'
    : '🔒 Lykke slo av delt modus. Nå velger hun dag for dag.'),
  kode: () => '🔑 Lykke byttet koden sin.',
  huket: (tekst) => `✓ Lykke huket av: «${tekst}»`,
  reaksjon: (tegn, tekst) => `${tegn} Lykke reagerte på «${tekst}»`,
  svarte: (sporsmal, svar) => `📝 Lykke svarte på «${sporsmal}»\n\n«${svar}»`,
  etterslep: (dato, humor) => [
    `🗓 Lykke fylte ut ${dato} i etterkant.`,
    '',
    `${humor} av 5 – ${HUMOR[humor]}`,
    '',
    'Varsler for gamle dager sier lite om hvordan hun har det nå, så dette er alt.',
  ].join('\n'),
  angret: (tekst) => `○ Lykke tok bort haken på «${tekst}»`,
};

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
  if (dag.svar) linjer.push('', `${dag.sporsmal}`, `  «${dag.svar}»`);
  if (dag.filer?.length) {
    const bilder = dag.filer.filter((f) => f.slag === 'bilde').length;
    const lyd = dag.filer.length - bilder;
    linjer.push('', [bilder && `${bilder} bilde${bilder > 1 ? 'r' : ''}`, lyd && `${lyd} lydklipp`]
      .filter(Boolean).join(' og '));
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
