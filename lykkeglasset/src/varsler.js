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
    ut.push({ slag, tekst: melding(slag, dag), stille });
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

  return linjer.join('\n');
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
