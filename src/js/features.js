/**
 * Hva finnes langs turen? Bading, bålplass, toalett, buss til start.
 *
 * Fasilitetene hentes én gang for hele kartutsnittet og fordeles herfra på
 * turene, slik at kortene kan merkes uten ett oppslag per tur.
 *
 * Rene funksjoner – ingen DOM, ingen nettverk.
 */
import { haversine } from './geo.js';

/**
 * Merkene en tur kan få.
 *
 * `radius` er hvor nær ruta fasiliteten må ligge for å telle med. Bading og
 * bål må være rett ved stien for å være til nytte; et toalett eller en buss
 * kan ligge litt lenger unna.
 */
export const FEATURES = {
  bading: { id: 'bading', label: 'Bading', icon: '🏊', kinds: ['bading'], radius: 200 },
  bål: { id: 'bål', label: 'Bål og grill', icon: '🔥', kinds: ['bål'], radius: 200 },
  rasteplass: { id: 'rasteplass', label: 'Rasteplass', icon: '🧺', kinds: ['rasteplass'], radius: 250 },
  utsikt: { id: 'utsikt', label: 'Utsikt', icon: '🔭', kinds: ['utsikt'], radius: 200 },
  hytte: { id: 'hytte', label: 'Hytte', icon: '🛖', kinds: ['hytte', 'gapahuk'], radius: 250 },
  toalett: { id: 'toalett', label: 'Toalett', icon: '🚻', kinds: ['toalett'], radius: 300 },
  lek: { id: 'lek', label: 'Lekeplass', icon: '🛝', kinds: ['lek'], radius: 200 },
  kollektiv: {
    id: 'kollektiv',
    label: 'Buss til start',
    icon: '🚌',
    kinds: ['kollektiv'],
    radius: 400,
    /** Bussholdeplassen må ligge ved start eller mål, ikke midt på fjellet. */
    endsOnly: true,
  },
  hc: {
    id: 'hc',
    label: 'HC-fasiliteter',
    icon: '♿',
    radius: 400,
    /** Teller bare fasiliteter OpenStreetMap har merket som rullestolvennlige. */
    wheelchairOnly: true,
    hint: 'Toalett, parkering eller rasteplass merket som rullestolvennlig i OpenStreetMap. Sier ikke noe om selve stien.',
  },
};

export const FEATURE_LIST = Object.values(FEATURES);

/**
 * Rekkefølgen merkene vises i når det ikke er plass til alle.
 * I en by ligger det en lekeplass nær nesten alt; en badeplass eller en
 * bålplass sier langt mer om hva slags tur dette er.
 */
export const FEATURE_PRIORITY = ['bading', 'bål', 'utsikt', 'hytte', 'kollektiv', 'hc', 'rasteplass', 'toalett', 'lek'];

/** De mest interessante merkene først, til bruk på trange turkort. */
export function topFeatures(features = [], limit = 3) {
  const sorted = [...features].sort(
    (a, b) => FEATURE_PRIORITY.indexOf(a) - FEATURE_PRIORITY.indexOf(b),
  );
  return { shown: sorted.slice(0, limit), rest: Math.max(0, sorted.length - limit) };
}

/** Største radius vi trenger å lete innenfor. */
const MAX_RADIUS = Math.max(...FEATURE_LIST.map((feature) => feature.radius));

/** Legger fasilitetene i et grovt rutenett for raske oppslag langs en rute. */
export function buildFacilityIndex(facilities, cellMeters = MAX_RADIUS) {
  const cell = cellMeters / 111320;
  const grid = new Map();
  for (const facility of facilities) {
    if (!Number.isFinite(facility.lat) || !Number.isFinite(facility.lon)) continue;
    const key = `${Math.floor(facility.lat / cell)},${Math.floor(facility.lon / (cell * 2))}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(facility);
  }
  return { grid, cell };
}

function near({ grid, cell }, point) {
  const row = Math.floor(point.lat / cell);
  const column = Math.floor(point.lon / (cell * 2));
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const bucket = grid.get(`${row + dr},${column + dc}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

/** Passer fasiliteten til dette merket? */
function matches(feature, facility) {
  if (feature.wheelchairOnly) return facility.wheelchair === 'ja';
  return feature.kinds?.includes(facility.kind) ?? false;
}

/**
 * Finner merkene én tur skal ha.
 *
 * Avstanden måles fra punkter langs ruta, ikke fra selve linja. Prøver vi for
 * få punkter, glipper en badeplass som ligger midt mellom to av dem – derfor
 * er `samples` satt høyt nok til at avstanden mellom dem blir liten.
 *
 * @param {object} index fra `buildFacilityIndex`
 * @param {{points: Array<{lat:number,lon:number}>}} trip
 * @returns {{features: string[], nearby: Array<object>}}
 */
export function featuresForTrip(index, trip, { samples = 200 } = {}) {
  const points = trip.points ?? [];
  if (points.length < 1) return { features: [], nearby: [] };

  const step = Math.max(1, Math.floor(points.length / samples));
  const along = [];
  for (let i = 0; i < points.length; i += step) along.push(points[i]);
  if (along.at(-1) !== points.at(-1)) along.push(points.at(-1));
  const ends = [points[0], points.at(-1)];

  /** Korteste avstand fra ruta (eller endene) til hver fasilitet. */
  const closest = new Map();
  const measure = (samplePoints, endsOnly) => {
    for (const point of samplePoints) {
      for (const facility of near(index, point)) {
        const distance = haversine(point, facility);
        const key = `${facility.id}|${endsOnly}`;
        const previous = closest.get(key);
        if (!previous || distance < previous.distance) closest.set(key, { facility, distance, endsOnly });
      }
    }
  };
  measure(along, false);
  measure(ends, true);

  const found = new Set();
  const nearby = new Map();
  for (const { facility, distance, endsOnly } of closest.values()) {
    for (const feature of FEATURE_LIST) {
      if (Boolean(feature.endsOnly) !== endsOnly) continue;
      if (distance > feature.radius) continue;
      if (!matches(feature, facility)) continue;
      found.add(feature.id);
      if (!nearby.has(facility.id)) nearby.set(facility.id, { ...facility, distance });
    }
  }

  return {
    features: FEATURE_LIST.filter((feature) => found.has(feature.id)).map((feature) => feature.id),
    nearby: [...nearby.values()].sort((a, b) => a.distance - b.distance),
  };
}

/**
 * Merker alle turene med det som finnes langs dem.
 * @returns {Array<object>} turene med `features` og `nearby` fylt ut
 */
export function attachFeatures(trips, facilities) {
  if (!facilities?.length) return trips;
  const index = buildFacilityIndex(facilities);
  return trips.map((trip) => ({ ...trip, ...featuresForTrip(index, trip) }));
}
