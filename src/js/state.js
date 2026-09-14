/**
 * Appens tilstand med enkel abonnementsmodell.
 *
 * Turen er modellert som veipunkter brukeren har satt, pluss én «etappe» mellom
 * hvert par. En etappe er enten en rett strek eller en sti-snappet punktrekke.
 * Selve linja utledes av etappene, aldri motsatt.
 */
import { createEmitter, migrateStoragePrefix, store, uid } from './util.js';
import { APP, DEFAULT_OPTIONS } from './config.js';
import { DEFAULT_FILTERS } from './trips.js';

// Kjøres før noe leses, så et navnebytte ikke tømmer dagboka til folk.
migrateStoragePrefix(APP.previousStorageKey, APP.storageKey);

const emitter = createEmitter();
export const on = emitter.on;

/** Standard starttidspunkt: neste hele time. */
function nextHour() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
}

function emptyTrip() {
  return {
    id: uid(),
    name: '',
    waypoints: [],
    legs: [],
    startTime: nextHour().toISOString(),
    options: { ...DEFAULT_OPTIONS },
  };
}

export const state = {
  trip: emptyTrip(),
  /** Resultatet av `summarise()` – `null` til ruta har minst to punkter. */
  summary: null,
  /** Høyder for gjeldende prøvelinje, gjenbrukes når bare innstillinger endres. */
  elevationCache: null,
  /** Statusflagg for det som lastes i bakgrunnen. */
  loading: { elevation: false, weather: false, pois: false, snap: false, photos: false, journeys: false },
  weather: null,
  sun: null,
  avalanche: null,
  pois: [],
  /** Sant når Overpass ikke svarte. Da er tomt ikke det samme som ingenting. */
  poiError: false,

  /** Turforslag i området brukeren ser på. */
  discovery: {
    loading: false,
    searched: false,
    error: false,
    /** Alle turer i utsnittet, før filtrering. */
    all: [],
    /** Etter filtrering og sortering – det kortene viser. */
    visible: [],
    total: 0,
    truncated: false,
    box: null,
  },
  filters: { ...DEFAULT_FILTERS },
  /** Om filterbrikkene er brettet ut. Sammenslått gir plass til resultatene. */
  filtersOpen: false,
  /** Bilder og stedsbeskrivelse for turen som er valgt. */
  photos: [],
  article: null,
  /** Turforslaget som vises som kort over kartet, før man har valgt det. */
  preview: null,
  /** Turen man peker på i lista. Bare en markering i kartet, ikke et kort. */
  hoveredCard: null,
  /** Kollektivreiser til startpunktet. */
  journeys: null,
  /** Hva vi faktisk fikk vite om kollektivreisen, og for hvilket tidspunkt. */
  journeysFor: null,
  journeysWalk: null,
  journeysError: false,

  /** Turmodus: posisjonen din målt mot ruta. */
  navigation: {
    active: false,
    startedAt: null,
    position: null,
    progress: null,
    follow: true,
  },
};

/** Bygger en tur av et turforslag, med hele den kartlagte geometrien beholdt. */
export function tripFromSuggestion(suggestion) {
  const points = suggestion.points;
  const start = { lat: points[0].lat, lon: points[0].lon, name: suggestion.name, id: uid() };
  const end = { lat: points.at(-1).lat, lon: points.at(-1).lon, name: null, id: uid() };
  return {
    id: uid(),
    name: suggestion.name,
    waypoints: [start, end],
    legs: [{ points: points.map((p) => ({ lat: p.lat, lon: p.lon })), snapped: true, pending: false }],
    startTime: nextHour().toISOString(),
    options: { ...state.trip.options },
  };
}

/** Sammenhengende linje gjennom alle etappene, uten dupliserte knekkpunkter. */
export function routeLine(trip = state.trip) {
  const line = [];
  for (const leg of trip.legs) {
    for (const point of leg.points) {
      const last = line.at(-1);
      if (last && Math.abs(last.lat - point.lat) < 1e-9 && Math.abs(last.lon - point.lon) < 1e-9) {
        continue;
      }
      line.push(point);
    }
  }
  if (!line.length && trip.waypoints.length === 1) return [{ ...trip.waypoints[0] }];
  return line;
}

export const startDate = () => new Date(state.trip.startTime);

/** Melder fra om at turen er endret. `reason` sier hva som må regnes om. */
function changed(reason) {
  emitter.emit('trip', { trip: state.trip, reason });
}

export function setTrip(trip, reason = 'load') {
  state.trip = { ...emptyTrip(), ...trip, options: { ...DEFAULT_OPTIONS, ...trip.options } };
  state.summary = null;
  changed(reason);
}

export function resetTrip() {
  const { options } = state.trip;
  state.trip = { ...emptyTrip(), options: { ...options } };
  state.summary = null;
  state.weather = null;
  state.avalanche = null;
  state.pois = [];
  changed('reset');
}

/**
 * Legger til et veipunkt til slutt. Etappen fylles inn av rutebyggeren i main.js,
 * som midlertidig setter en rett strek slik at kartet svarer umiddelbart.
 */
export function addWaypoint(point) {
  const waypoint = { lat: point.lat, lon: point.lon, name: point.name ?? null, id: uid() };
  state.trip.waypoints.push(waypoint);
  if (state.trip.waypoints.length > 1) {
    const from = state.trip.waypoints.at(-2);
    state.trip.legs.push({ points: [strip(from), strip(waypoint)], snapped: false, pending: true });
  }
  changed('add');
  return waypoint;
}

export function moveWaypoint(id, point) {
  const index = state.trip.waypoints.findIndex((w) => w.id === id);
  if (index < 0) return;
  state.trip.waypoints[index] = { ...state.trip.waypoints[index], ...strip(point), name: null };
  markLegsDirty(index);
  changed('move');
}

export function removeWaypoint(id) {
  const index = state.trip.waypoints.findIndex((w) => w.id === id);
  if (index < 0) return;
  state.trip.waypoints.splice(index, 1);

  if (state.trip.waypoints.length < 2) {
    state.trip.legs = [];
  } else if (index === 0) {
    state.trip.legs.shift();
  } else if (index === state.trip.waypoints.length) {
    state.trip.legs.pop();
  } else {
    // Punktet lå i midten: de to etappene rundt slås sammen til én ny.
    state.trip.legs.splice(index - 1, 2, {
      points: [strip(state.trip.waypoints[index - 1]), strip(state.trip.waypoints[index])],
      snapped: false,
      pending: true,
    });
  }
  changed('remove');
}

/** Setter inn et nytt veipunkt midt i en etappe (brukeren drar på selve linja). */
export function insertWaypoint(legIndex, point) {
  if (legIndex < 0 || legIndex >= state.trip.legs.length) return null;
  const waypoint = { lat: point.lat, lon: point.lon, name: null, id: uid() };
  state.trip.waypoints.splice(legIndex + 1, 0, waypoint);
  state.trip.legs.splice(
    legIndex,
    1,
    { points: [strip(state.trip.waypoints[legIndex]), strip(waypoint)], snapped: false, pending: true },
    { points: [strip(waypoint), strip(state.trip.waypoints[legIndex + 2])], snapped: false, pending: true },
  );
  changed('insert');
  return waypoint;
}

export function reverseTrip() {
  state.trip.waypoints.reverse();
  state.trip.legs.reverse();
  for (const leg of state.trip.legs) leg.points.reverse();
  changed('reverse');
}

/** Gjør turen til en tur–retur ved å speile etappene tilbake. */
export function makeRoundTrip() {
  const { waypoints, legs } = state.trip;
  if (waypoints.length < 2) return;
  const backWaypoints = waypoints.slice(0, -1).reverse().map((w) => ({ ...w, id: uid() }));
  const backLegs = legs
    .slice()
    .reverse()
    .map((leg) => ({ ...leg, points: leg.points.slice().reverse() }));
  state.trip.waypoints = [...waypoints, ...backWaypoints];
  state.trip.legs = [...legs, ...backLegs];
  changed('roundtrip');
}

export function setOptions(patch) {
  const before = state.trip.options.snapToTrail;
  state.trip.options = { ...state.trip.options, ...patch };

  if ('snapToTrail' in patch && patch.snapToTrail !== before) {
    // Skrus «følg sti» på, skal ruta legges om langs stiene. Skrus den av,
    // skal den tilbake til rette streker mellom veipunktene.
    state.trip.legs = state.trip.legs.map((leg, index) => {
      const from = state.trip.waypoints[index];
      const to = state.trip.waypoints[index + 1];
      if (!from || !to) return leg;
      return { points: [strip(from), strip(to)], snapped: false, pending: patch.snapToTrail };
    });
    changed('options-geometry');
    return;
  }
  changed('options');
}

export function setName(name) {
  state.trip.name = name;
  changed('meta');
}

export function setStartTime(date) {
  state.trip.startTime = date.toISOString();
  changed('time');
}

/** Erstatter etappene med ferdig beregnet geometri. */
export function setLegs(legs) {
  state.trip.legs = legs;
  changed('legs');
}

function markLegsDirty(waypointIndex) {
  for (const index of [waypointIndex - 1, waypointIndex]) {
    const leg = state.trip.legs[index];
    if (!leg) continue;
    const from = state.trip.waypoints[index];
    const to = state.trip.waypoints[index + 1];
    if (from && to) {
      state.trip.legs[index] = { points: [strip(from), strip(to)], snapped: false, pending: true };
    }
  }
}

const strip = ({ lat, lon }) => ({ lat, lon });

/* ---------- Lagrede turer ---------- */

const tripsKey = `${APP.storageKey}.trips`;

export const savedTrips = () => store.get(tripsKey, []);

export function saveTrip(trip = state.trip) {
  const trips = savedTrips().filter((t) => t.id !== trip.id);
  const record = {
    id: trip.id,
    name: trip.name || 'Uten navn',
    savedAt: new Date().toISOString(),
    startTime: trip.startTime,
    options: trip.options,
    waypoints: trip.waypoints,
    legs: trip.legs,
  };
  trips.unshift(record);
  store.set(tripsKey, trips.slice(0, 50));
  emitter.emit('saved', record);
  return record;
}

export function deleteTrip(id) {
  store.set(tripsKey, savedTrips().filter((t) => t.id !== id));
  emitter.emit('saved', null);
}

/* ---------- Innstillinger som overlever mellom besøk ---------- */

const prefsKey = `${APP.storageKey}.prefs`;

export const loadPrefs = () => store.get(prefsKey, {});
export const savePrefs = (prefs) => store.set(prefsKey, prefs);
