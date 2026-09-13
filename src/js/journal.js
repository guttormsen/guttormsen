/**
 * Turdagboka. Alt ligger i nettleseren din – ingen konto, ingen server.
 *
 * Poenget er ikke statistikk for statistikkens skyld, men å gjøre det litt
 * gøyere å komme seg ut igjen: se hva du har gått, og hva som mangler til
 * neste milepæl.
 */
import { store } from './util.js';
import { APP } from './config.js';

const KEY = `${APP.storageKey}.journal`;

/** @returns {Array<object>} gjennomførte turer, nyeste først */
export const entries = () => store.get(KEY, []);

/**
 * Fører opp en gjennomført tur.
 * @param {{name:string, distance:number, ascent:number, seconds:number,
 *          maxElevation:number|null, loop:boolean, date?:string}} trip
 */
export function logTrip(trip) {
  const entry = {
    id: `${Date.now().toString(36)}`,
    name: trip.name || 'Tur uten navn',
    date: trip.date ?? new Date().toISOString(),
    distance: Math.max(0, trip.distance || 0),
    ascent: Math.max(0, trip.ascent || 0),
    seconds: Math.max(0, trip.seconds || 0),
    maxElevation: Number.isFinite(trip.maxElevation) ? trip.maxElevation : null,
    loop: Boolean(trip.loop),
  };
  const all = [entry, ...entries()].slice(0, 500);
  store.set(KEY, all);
  return entry;
}

export function removeEntry(id) {
  store.set(KEY, entries().filter((entry) => entry.id !== id));
}

/** Summene dagboka bygger på. */
export function totals(all = entries()) {
  return all.reduce(
    (sum, entry) => ({
      trips: sum.trips + 1,
      distance: sum.distance + entry.distance,
      ascent: sum.ascent + entry.ascent,
      seconds: sum.seconds + entry.seconds,
      highest: Math.max(sum.highest, entry.maxElevation ?? 0),
    }),
    { trips: 0, distance: 0, ascent: 0, seconds: 0, highest: 0 },
  );
}

/* ---------- Milepæler ---------- */

const month = (entry) => new Date(entry.date).getMonth();
const hour = (entry) => new Date(entry.date).getHours();
const dayNumber = (entry) => Math.floor(new Date(entry.date).getTime() / 86400000);

/** Har du gått tur to dager på rad? */
function hasBackToBack(all) {
  const days = [...new Set(all.map(dayNumber))].sort((a, b) => a - b);
  return days.some((day, i) => i > 0 && day - days[i - 1] === 1);
}

/**
 * Merkene du kan samle. Hver har en `test` mot summene og turlista, og en
 * `progress` som gir noe å strekke seg etter før den er nådd.
 */
export const BADGES = [
  {
    id: 'forste',
    icon: '🥾',
    label: 'Første tur',
    hint: 'Du førte opp din første tur.',
    test: (t) => t.trips >= 1,
    progress: (t) => t.trips / 1,
  },
  {
    id: 'fem',
    icon: '🌲',
    label: 'Fem turer',
    hint: 'Fem turer i boka.',
    test: (t) => t.trips >= 5,
    progress: (t) => t.trips / 5,
  },
  {
    id: 'tjuefem',
    icon: '🏕️',
    label: 'Stamgjest',
    hint: '25 turer. Nå er det blitt en vane.',
    test: (t) => t.trips >= 25,
    progress: (t) => t.trips / 25,
  },
  {
    id: 'maraton',
    icon: '📏',
    label: 'Maratonlengde',
    hint: '42 km til sammen.',
    test: (t) => t.distance >= 42195,
    progress: (t) => t.distance / 42195,
  },
  {
    id: 'kvart-tusen',
    icon: '🗺️',
    label: '250 kilometer',
    hint: 'Like langt som Oslo til Kristiansand i luftlinje.',
    test: (t) => t.distance >= 250000,
    progress: (t) => t.distance / 250000,
  },
  {
    id: 'tusen',
    icon: '🧭',
    label: 'Tusen kilometer',
    hint: 'Fire ganger Norge på tvers.',
    test: (t) => t.distance >= 1000000,
    progress: (t) => t.distance / 1000000,
  },
  {
    id: 'galdhopiggen',
    icon: '⛰️',
    label: 'Én Galdhøpiggen',
    hint: '2 469 høydemeter til sammen – Norges tak.',
    test: (t) => t.ascent >= 2469,
    progress: (t) => t.ascent / 2469,
  },
  {
    id: 'everest',
    icon: '🏔️',
    label: 'Everesting',
    hint: '8 848 høydemeter til sammen.',
    test: (t) => t.ascent >= 8848,
    progress: (t) => t.ascent / 8848,
  },
  {
    id: 'tusenmeter',
    icon: '☁️',
    label: 'Over tusen meter',
    hint: 'En tur med høyeste punkt over 1 000 moh.',
    test: (t) => t.highest >= 1000,
    progress: (t) => t.highest / 1000,
  },
  {
    id: 'milsluker',
    icon: '🚀',
    label: 'Milsluker',
    hint: 'Én enkelt tur på over 20 km.',
    test: (t, all) => all.some((entry) => entry.distance >= 20000),
    progress: (t, all) => Math.max(0, ...all.map((entry) => entry.distance / 20000), 0),
  },
  {
    id: 'rundtur',
    icon: '🔄',
    label: 'Full runde',
    hint: 'Fullført en rundtur.',
    test: (t, all) => all.some((entry) => entry.loop),
    progress: (t, all) => (all.some((entry) => entry.loop) ? 1 : 0),
  },
  {
    id: 'vinter',
    icon: '❄️',
    label: 'Vintertur',
    hint: 'En tur i desember, januar eller februar.',
    test: (t, all) => all.some((entry) => [11, 0, 1].includes(month(entry))),
    progress: (t, all) => (all.some((entry) => [11, 0, 1].includes(month(entry))) ? 1 : 0),
  },
  {
    id: 'morgenfugl',
    icon: '🌅',
    label: 'Morgenfugl',
    hint: 'En tur som startet før klokka sju.',
    test: (t, all) => all.some((entry) => hour(entry) < 7),
    progress: (t, all) => (all.some((entry) => hour(entry) < 7) ? 1 : 0),
  },
  {
    id: 'turhelg',
    icon: '📅',
    label: 'Turhelg',
    hint: 'Turer to dager på rad.',
    test: (t, all) => hasBackToBack(all),
    progress: (t, all) => (hasBackToBack(all) ? 1 : 0),
  },
];

/** @returns {Array<object>} alle merker med `earned` og `progress` (0–1) */
export function badgeStatus(all = entries()) {
  const sums = totals(all);
  return BADGES.map((badge) => ({
    ...badge,
    earned: Boolean(badge.test(sums, all)),
    progress: Math.max(0, Math.min(1, badge.progress(sums, all) || 0)),
  }));
}

/** Merkene du er nærmest, men ikke har fått ennå. */
export function nextBadges(all = entries(), count = 2) {
  return badgeStatus(all)
    .filter((badge) => !badge.earned)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, count);
}

/* ---------- Sammenligninger ---------- */

const ASCENT_MARKS = [
  { meters: 604, name: 'Preikestolen' },
  { meters: 1085, name: 'Gaustatoppen' },
  { meters: 2469, name: 'Galdhøpiggen' },
  { meters: 8848, name: 'Mount Everest' },
];

const DISTANCE_MARKS = [
  { meters: 42195, name: 'et maraton' },
  { meters: 463000, name: 'Oslo–Bergen' },
  { meters: 2518000, name: 'Norge på langs' },
];

/** Finner den største referansen du har passert, og hvor mange ganger. */
function compare(value, marks, verb) {
  const passed = marks.filter((mark) => value >= mark.meters).pop();
  if (!passed) {
    const next = marks[0];
    return `${Math.round((value / next.meters) * 100)} % av ${next.name}`;
  }
  const times = value / passed.meters;
  const rounded = times >= 10 ? Math.round(times) : Math.round(times * 10) / 10;
  return `${verb} ${String(rounded).replace('.', ',')} × ${passed.name}`;
}

/** Korte, konkrete setninger til dagboka. */
export function highlights(all = entries()) {
  const sums = totals(all);
  if (!sums.trips) return [];
  return [
    sums.ascent > 0 && `Til sammen har du klatret ${compare(sums.ascent, ASCENT_MARKS, '')}`.trim(),
    sums.distance > 0 && `Du har gått ${compare(sums.distance, DISTANCE_MARKS, '')}`.trim(),
    sums.seconds > 3600 && `Det har tatt deg ${Math.round(sums.seconds / 3600)} timer på beina`,
  ].filter(Boolean);
}
