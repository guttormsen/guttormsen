/**
 * Turforslag: gjør løse rutesegmenter fra Turrutebasen om til hele turer.
 *
 * Basen lagrer én rute som mange korte biter. «Preikestolen» kan være 40
 * segmenter. Her grupperes de på navn, settes sammen til sammenhengende
 * strekninger, og det som blir igjen er noe en turgåer kjenner igjen: et navn,
 * en lengde, en vanskegrad og en form.
 *
 * Rene funksjoner – ingen DOM, ingen nettverk.
 */
import { haversine, pathLength, smooth } from './geo.js';
import { elevationStats, estimateTime, fillGaps } from './route.js';

/** Endepunkter nærmere hverandre enn dette regnes som samme punkt. */
const JOIN_TOLERANCE_M = 30;
/** Kortere enn dette er en stistump, ikke en tur. */
const MIN_TRIP_LENGTH_M = 800;
/** Navn som dekker et helt stinett, ikke én tur. */
const NETWORK_LENGTH_M = 60000;
const NETWORK_PARTS = 25;
/** Start og mål nærmere hverandre enn dette gjør turen til en rundtur. */
const LOOP_TOLERANCE_M = 350;

/**
 * Den nasjonale merkestandarden (Merkehåndboka) graderer turer i fire farger.
 * Koder utenfor disse lar vi stå som ugradert framfor å gjette.
 */
export const GRADES = {
  G: { id: 'enkel', label: 'Enkel', color: '#2e8b57', order: 1, hint: 'Grønn – passer for de fleste' },
  B: { id: 'middels', label: 'Middels', color: '#2f6fd0', order: 2, hint: 'Blå – krever litt turvant' },
  R: { id: 'krevende', label: 'Krevende', color: '#c8422c', order: 3, hint: 'Rød – god form og erfaring' },
  S: { id: 'ekspert', label: 'Ekspert', color: '#2b2b2b', order: 4, hint: 'Svart – bratt og utsatt' },
};

export const UNGRADED = { id: 'ugradert', label: 'Ugradert', color: '#8a8f88', order: 5, hint: 'Ikke gradert i rutebasen' };

export const gradeOf = (code) => GRADES[code] ?? UNGRADED;

/**
 * Rutetypene Turrutebasen skiller på, med samme inndeling som kartlaget
 * «Fotrutetype». Ukjente koder får ingen merkelapp.
 */
export const SPECIAL_TYPES = {
  NT: { id: 'natursti', label: 'Natursti', icon: '🌿' },
  KY: { id: 'kyststi', label: 'Kyststi', icon: '🌊' },
  KT: { id: 'kultursti', label: 'Kultursti', icon: '🏛️' },
  HI: { id: 'historisk', label: 'Historisk veg', icon: '🗿' },
};

/** Rutenett-celle på ca. 30 m, brukt til å finne endepunkter som møtes. */
const CELL = JOIN_TOLERANCE_M / 111320;
const cellOf = (point) => [Math.floor(point.lat / CELL), Math.floor(point.lon / (CELL * 2))];

/** Navn som ikke sier noe om en bestemt tur. */
const isAnonymous = (name) => !name || /^ukjent$/i.test(name.trim());

/**
 * Rydder i navn fra rutebasen. Enkelte leveranser har mistet bindestreker i
 * en tegnsettkonvertering og sitter igjen med doble ŋ som skilletegn.
 */
export function cleanRouteName(name) {
  return String(name ?? '')
    .replace(/\s*-?\s*ŋ{2,}\s*/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Setter sammen segmenter som deler endepunkt til lengst mulige strekninger.
 *
 * Endepunktene legges i et grovt rutenett slik at oppslaget er konstant i tid.
 * Uten det blir sammensyingen kvadratisk, og et bymarksområde har fort tusen
 * segmenter.
 *
 * @param {Array<{points: Array<{lat:number,lon:number}>}>} segments
 * @returns {Array<Array<{lat:number,lon:number}>>} én punktrekke per sammenhengende del
 */
export function chainSegments(segments, tolerance = JOIN_TOLERANCE_M) {
  /** @type {Map<string, Array<{index:number, point:object}>>} */
  const grid = new Map();
  const add = (point, index) => {
    const [row, column] = cellOf(point);
    const k = `${row},${column}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ index, point });
  };
  segments.forEach((segment, index) => {
    add(segment.points[0], index);
    add(segment.points.at(-1), index);
  });

  const used = new Array(segments.length).fill(false);

  /** Nærmeste ubrukte segment som starter eller slutter innenfor toleransen. */
  const findNext = (tip) => {
    const [row, column] = cellOf(tip);
    let best = -1;
    let bestDistance = tolerance;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (const entry of grid.get(`${row + dr},${column + dc}`) ?? []) {
          if (used[entry.index]) continue;
          const distance = haversine(tip, entry.point);
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = entry.index;
          }
        }
      }
    }
    return best;
  };

  const chains = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    let chain = segments[start].points.slice();

    // Voks i begge retninger til ingen flere biter passer.
    for (const direction of ['forover', 'bakover']) {
      for (;;) {
        const tip = direction === 'forover' ? chain.at(-1) : chain[0];
        const next = findNext(tip);
        if (next < 0) break;
        used[next] = true;
        const points = segments[next].points;
        const flip = haversine(tip, points[0]) > haversine(tip, points.at(-1));
        const ordered = flip ? points.slice().reverse() : points.slice();
        chain = direction === 'forover' ? [...chain, ...ordered.slice(1)] : [...ordered.slice(0, -1), ...chain];
      }
    }
    chains.push(chain);
  }

  return chains.sort((a, b) => pathLength(b) - pathLength(a));
}

/**
 * Bygger turforslag av rutesegmenter.
 * @param {Array<object>} fotruter fra `fetchFotruter()`
 * @returns {Array<object>} turer, lengste først
 */
export function buildTrips(fotruter) {
  const groups = new Map();
  for (const route of fotruter) {
    if (isAnonymous(route.name) || route.points.length < 2) continue;
    const name = cleanRouteName(route.name);
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(route);
  }

  const trips = [];
  for (const [name, segments] of groups) {
    const chains = chainSegments(segments);
    const main = chains[0];
    if (!main || main.length < 2) continue;

    const length = pathLength(main);
    const totalLength = chains.reduce((sum, chain) => sum + pathLength(chain), 0);
    if (length < MIN_TRIP_LENGTH_M) continue;

    // Et navn som dekker mil på mil i mange biter er et stinett, ikke en tur.
    const isNetwork = totalLength > NETWORK_LENGTH_M || chains.length > NETWORK_PARTS;
    if (isNetwork) continue;

    const first = main[0];
    const last = main.at(-1);
    const loop = haversine(first, last) < LOOP_TOLERANCE_M;

    // Velg den vanligste graderingen blant segmentene.
    const gradeCounts = new Map();
    for (const segment of segments) {
      if (!segment.grade) continue;
      gradeCounts.set(segment.grade, (gradeCounts.get(segment.grade) ?? 0) + 1);
    }
    const gradeCode = [...gradeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const specialCode = segments.find((segment) => SPECIAL_TYPES[segment.special])?.special ?? null;

    trips.push({
      id: `tur-${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}-${Math.round(length)}`,
      name,
      points: main,
      length,
      /** Andre biter med samme navn – vises som «+ 2 sidestrekninger». */
      extraParts: chains.length - 1,
      loop,
      grade: gradeOf(gradeCode),
      special: SPECIAL_TYPES[specialCode] ?? null,
      marked: segments.some((segment) => segment.marking === 'merket' || segment.marking === 'JA'),
      maintainer: segments.find((segment) => segment.maintainer)?.maintainer ?? null,
      start: first,
      end: last,
      middle: main[Math.floor(main.length / 2)],
      /** Fylles inn senere av høydeoppslaget. */
      ascent: null,
      descent: null,
      seconds: null,
      profile: null,
    });
  }

  return trips.sort((a, b) => b.length - a.length);
}

/* ---------- Filtrering ---------- */

/** Lengdebøttene brukeren velger mellom. */
export const LENGTH_BUCKETS = [
  { id: 'kort', label: 'Kort tur', hint: 'Under 3 km', min: 0, max: 3000, icon: '🚶' },
  { id: 'halvdag', label: 'Halvdag', hint: '3–8 km', min: 3000, max: 8000, icon: '🥾' },
  { id: 'dagstur', label: 'Dagstur', hint: '8–15 km', min: 8000, max: 15000, icon: '⛰️' },
  { id: 'lang', label: 'Lang tur', hint: 'Over 15 km', min: 15000, max: Infinity, icon: '🏔️' },
];

export const DEFAULT_FILTERS = {
  lengths: [],
  grades: [],
  shape: null,
  special: null,
  markedOnly: false,
  maxMinutes: null,
  /** Merker fra `features.js` – bading, bål, buss til start, HC. */
  features: [],
};

export const hasActiveFilters = (filters) =>
  filters.lengths.length > 0 ||
  filters.grades.length > 0 ||
  filters.features.length > 0 ||
  filters.shape != null ||
  filters.special != null ||
  filters.markedOnly ||
  filters.maxMinutes != null;

/**
 * Filtrerer og sorterer turforslag.
 * @param {Array<object>} trips
 * @param {object} filters
 * @param {{lat:number,lon:number}|null} origin sorter etter avstand herfra
 */
export function filterTrips(trips, filters, origin = null) {
  const buckets = LENGTH_BUCKETS.filter((bucket) => filters.lengths.includes(bucket.id));

  const matches = trips.filter((trip) => {
    if (buckets.length && !buckets.some((b) => trip.length >= b.min && trip.length < b.max)) return false;
    if (filters.grades.length && !filters.grades.includes(trip.grade.id)) return false;
    if (filters.shape === 'rundtur' && !trip.loop) return false;
    if (filters.shape === 'strekning' && trip.loop) return false;
    if (filters.special && trip.special?.id !== filters.special) return false;
    if (filters.markedOnly && !trip.marked) return false;
    // Flere merker krever at turen har dem alle – man vil både bade og grille.
    if (filters.features.length && !filters.features.every((id) => trip.features?.includes(id))) {
      return false;
    }
    // Tidsfilteret slår først inn når høydene er hentet.
    if (filters.maxMinutes != null && trip.seconds != null && trip.seconds / 60 > filters.maxMinutes) {
      return false;
    }
    return true;
  });

  return matches
    .map((trip) => ({ ...trip, distanceFromYou: origin ? haversine(origin, trip.start) : null }))
    .sort((a, b) => {
      if (!origin) return b.length - a.length;
      // Innenfor samme nærhetsbånd vinner den lengste turen. En stistump
      // hundre meter unna er sjelden det man leter etter.
      const band = (trip) => Math.floor((trip.distanceFromYou ?? 0) / 2000);
      return band(a) - band(b) || b.length - a.length;
    });
}

/** Plukker en tilfeldig tur, vektet mot de nærmeste. */
export function surpriseMe(trips, random = Math.random) {
  if (!trips.length) return null;
  const pool = trips.slice(0, Math.max(1, Math.min(20, trips.length)));
  return pool[Math.floor(random() * pool.length)];
}

/**
 * Punkter å slå opp høyde for når et turforslag skal få stigning og tid.
 * Få nok til at vi kan gjøre det for mange turer samtidig.
 */
export function sampleForCard(points, count = 24) {
  if (points.length <= count) return points.slice();
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => points[Math.round(i * step)]);
}

/**
 * Fyller inn stigning, fall og tidsbruk på et turforslag når høydene er hentet.
 *
 * Kortene bruker en grov punktprøve for å spare Kartverket for oppslag, så
 * tiden regnes på prøven og skaleres opp til turens virkelige lengde.
 *
 * @param {object} trip
 * @param {Array<{lat:number,lon:number}>} sample punktene høydene gjelder for
 * @param {Array<number|null>} elevations
 * @param {object} options marsjfart, underlag og sekkevekt
 */
export function enrichTrip(trip, sample, elevations, options) {
  const filled = smooth(fillGaps(elevations), 1);
  if (!filled.some(Number.isFinite)) return trip;

  const { ascent, descent, max } = elevationStats(filled);
  const sampleLength = pathLength(sample);
  const scale = sampleLength > 0 ? trip.length / sampleLength : 1;
  const time = estimateTime(sample, filled, options);

  return {
    ...trip,
    ascent,
    descent,
    maxElevation: max,
    seconds: time.totalSeconds * scale,
    profile: filled,
  };
}
