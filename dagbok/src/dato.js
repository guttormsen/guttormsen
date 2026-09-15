/**
 * Datoer i norsk tid. Rene funksjoner uten avhengigheter, så de kan testes
 * med `node --test` uten at Cloudflare er i nærheten.
 *
 * Hele appen regner døgnet i Europe/Oslo. Skriver forfatteren klokka 00:20, hører det
 * til kvelden før i alt annet enn navnet – men å begynne å gjette på det blir
 * fort verre enn det løser, så grensa går ved midnatt norsk tid, ikke UTC.
 */

export const SONE = 'Europe/Oslo';

/** 'YYYY-MM-DD' for et tidspunkt. sv-SE er den korteste veien til ISO-format. */
export function dagsnokkel(when = new Date(), sone = SONE) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: sone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);
}

/** 'HH:MM' i norsk tid. */
export function klokke(when = new Date(), sone = SONE) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: sone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(when);
}

/** Antall minutter etter midnatt, for å sammenligne klokkeslett som tall. */
export function minutter(hhmm) {
  const [t, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(t) || !Number.isFinite(m)) return null;
  return t * 60 + m;
}

/**
 * Flytter en dagsnøkkel et antall dager. Regnestykket gjøres i UTC med vilje:
 * nøkkelen er en ren kalenderdato, og da skal ikke sommertid flytte den.
 */
export function flyttDag(nokkel, dager) {
  const [y, m, d] = nokkel.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + dager * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export const forrigeDag = (nokkel) => flyttDag(nokkel, -1);

/** De siste `antall` dagene, nyeste først, `nokkel` inkludert. */
export function sisteDager(nokkel, antall) {
  return Array.from({ length: antall }, (_, i) => flyttDag(nokkel, -i));
}

/** Hele dager mellom to nøkler. Negativt hvis `b` kommer før `a`. */
export function dagerMellom(a, b) {
  const tall = (n) => {
    const [y, m, d] = n.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((tall(b) - tall(a)) / 86400000);
}

/** Samme dag, tidligere år: '2024-09-14' → '2025-09-14'. */
export function sammeDagIFjor(nokkel, arTilbake = 1) {
  const [y, m, d] = nokkel.split('-');
  return `${Number(y) - arTilbake}-${m}-${d}`;
}

const MANEDER = [
  'januar', 'februar', 'mars', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'desember',
];
const UKEDAGER = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

/** '2026-09-14' → '14. september'. */
export function norskDato(nokkel, medAr = false) {
  const [y, m, d] = nokkel.split('-').map(Number);
  const grunn = `${d}. ${MANEDER[m - 1]}`;
  return medAr ? `${grunn} ${y}` : grunn;
}

/** '2026-09-14' → 'mandag'. */
export function norskUkedag(nokkel) {
  const [y, m, d] = nokkel.split('-').map(Number);
  return UKEDAGER[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 'for 3 dager siden', 'i går', 'i dag'. */
export function nårVar(nokkel, idag) {
  const n = dagerMellom(nokkel, idag);
  if (n <= 0) return 'i dag';
  if (n === 1) return 'i går';
  if (n < 7) return `for ${n} dager siden`;
  if (n < 14) return 'for en uke siden';
  if (n < 60) return `for ${Math.round(n / 7)} uker siden`;
  return `for ${Math.round(n / 30)} måneder siden`;
}
