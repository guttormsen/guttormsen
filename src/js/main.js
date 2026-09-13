/**
 * Oppstart og lim. Her kobles kart, tilstand, API-er og panel sammen.
 */
import { APP, DEFAULT_OPTIONS, ELEVATION_MAX_SAMPLES, ELEVATION_MIN_SPACING, TRAIL_WMS } from './config.js';
import { $, debounce, formatDistance, render } from './util.js';
import { densify, pathLength, simplify } from './geo.js';
import { summarise } from './route.js';
import { fetchElevations } from './api/hoydedata.js';
import { fetchAvalancheWarning } from './api/varsom.js';
import { fetchPois } from './api/overpass.js';
import { buildCheckpoints, loadSun, loadWeather } from './weather.js';
import { createMap } from './map.js';
import { createProfile } from './profile.js';
import { createSearch } from './search.js';
import { createSnapper, SNAP_REASONS } from './snap.js';
import { buildGpx, parseGpx, safeFilename } from './gpx.js';
import { copyText, downloadText, toast } from './ui.js';
import * as panels from './panels.js';
import * as S from './state.js';
import { tripFromUrl, tripToUrl } from './share.js';

/* ---------- Oppsett ---------- */

const prefs = S.loadPrefs();
const trailState = Object.fromEntries(
  TRAIL_WMS.layers.map((layer) => [layer.id, prefs.trails?.[layer.id] ?? layer.defaultOn]),
);
let basemap = prefs.basemap ?? DEFAULT_OPTIONS.basemap;
const checklist = prefs.checklist ?? [];

const snapper = createSnapper();
let watchId = null;
/** Øker for hver omregning, så gamle svar kan forkastes. */
let generation = 0;
let inflight = null;

const view = createMap($('#map'), {
  onMapClicked: (point) => {
    S.addWaypoint(point);
  },
  onLineClicked: (point, segmentIndex) => {
    const legIndex = legIndexForSegment(segmentIndex);
    if (legIndex == null) return;
    S.insertWaypoint(legIndex, point);
  },
  onWaypointMoved: (id, point) => S.moveWaypoint(id, point),
  onWaypointClicked: (id) => S.removeWaypoint(id),
  onPoiClicked: (poi) => {
    S.state.selectedPoi = poi;
    selectTab('rute');
    openSheet();
    renderAll();
  },
});
view.setBasemap(basemap);
for (const [id, visible] of Object.entries(trailState)) view.setTrailLayer(id, visible);

const profile = createProfile($('#profile'), {
  onHover: (point) => view.showHover(point),
});

createSearch(
  { input: $('#search-input'), listbox: $('#search-results'), status: $('#search-status') },
  {
    onPick: (place) => {
      view.flyTo(place, place.type?.includes('Fjell') ? 14 : 13);
      // Første søk setter startpunktet – da slipper brukeren å lete etter det i kartet.
      if (!S.state.trip.waypoints.length) {
        S.addWaypoint({ lat: place.lat, lon: place.lon, name: place.name });
      }
    },
  },
);

/* ---------- Etapper og geometri ---------- */

/**
 * Linja slik den tegnes, sammen med hvor hver etappe slutter.
 * Grensene brukes til å finne ut hvilken etappe brukeren klikket på.
 */
function routeLineWithBoundaries() {
  const line = [];
  const boundaries = [];
  for (const leg of S.state.trip.legs) {
    for (const point of leg.points) {
      const last = line.at(-1);
      if (last && Math.abs(last.lat - point.lat) < 1e-9 && Math.abs(last.lon - point.lon) < 1e-9) continue;
      line.push(point);
    }
    boundaries.push(line.length);
  }
  if (!line.length && S.state.trip.waypoints.length === 1) {
    const only = S.state.trip.waypoints[0];
    return { line: [{ lat: only.lat, lon: only.lon }], boundaries: [] };
  }
  return { line, boundaries };
}

let drawnBoundaries = [];

/** Etappe-indeks for et segment i den tegnede linja. */
function legIndexForSegment(segmentIndex) {
  for (let i = 0; i < drawnBoundaries.length; i++) {
    if (segmentIndex < drawnBoundaries[i]) return i;
  }
  return Math.max(0, drawnBoundaries.length - 1);
}

/** Bygger etapper som mangler geometri – med sti-snapping når det er slått på. */
async function buildLegs(signal) {
  const { trip } = S.state;
  const pendingLegs = trip.legs.filter((leg) => leg.pending);
  if (!pendingLegs.length) return false;

  if (!trip.options.snapToTrail) {
    for (const leg of trip.legs) if (leg.pending) leg.pending = false;
    return false;
  }

  S.state.loading.snap = true;
  renderStats();
  const reasons = new Set();

  try {
    for (let i = 0; i < trip.legs.length; i++) {
      const leg = trip.legs[i];
      if (!leg.pending) continue;
      const from = trip.waypoints[i];
      const to = trip.waypoints[i + 1];
      if (!from || !to) continue;
      try {
        const result = await snapper.connect(from, to, { signal });
        if (signal.aborted) return false;
        trip.legs[i] = { points: result.points, snapped: result.snapped, pending: false };
        if (!result.snapped && result.reason) reasons.add(result.reason);
      } catch (error) {
        if (signal.aborted) return false;
        console.warn('Sti-snapping feilet', error);
        trip.legs[i] = { points: leg.points, snapped: false, pending: false };
        reasons.add('feil');
      }
    }
  } finally {
    // Et avbrutt forsøk skal ikke la kartet stå igjen med stiplet «venter»-linje.
    S.state.loading.snap = false;
  }

  for (const reason of reasons) toast(SNAP_REASONS[reason] ?? SNAP_REASONS.feil, { kind: 'advarsel' });
  return true;
}

/**
 * Lager punktrekka vi slår opp høyder for: tett nok til å følge terrenget,
 * men aldri flere punkter enn Kartverket bør bli spurt om.
 *
 * @returns {Array<{lat:number,lon:number}>}
 */
function buildSampleLine() {
  // Snappede etapper har mange nære punkter; forenkling fjerner støy uten å flytte ruta.
  const legs = S.state.trip.legs
    .map((leg) => (leg.points.length > 3 ? simplify(leg.points, 6) : leg.points))
    .filter((points) => points.length >= 2);
  if (!legs.length) return [];

  const total = legs.reduce((sum, points) => sum + pathLength(points), 0);
  const spacing = Math.max(ELEVATION_MIN_SPACING, total / ELEVATION_MAX_SAMPLES);

  const sample = [];
  for (const points of legs) {
    for (const point of densify(points, spacing)) {
      const last = sample.at(-1);
      if (last && Math.abs(last.lat - point.lat) < 1e-9 && Math.abs(last.lon - point.lon) < 1e-9) continue;
      sample.push(point);
    }
  }

  // Fortetting kan gi flere punkter enn taket når ruta har mange knekk – tynn ut.
  if (sample.length > ELEVATION_MAX_SAMPLES) {
    const step = Math.ceil(sample.length / ELEVATION_MAX_SAMPLES);
    return sample.filter((_, i) => i % step === 0 || i === sample.length - 1);
  }
  return sample;
}

/* ---------- Omregning ---------- */

const refreshContext = debounce(() => loadContext(), 600);

async function recompute(reason) {
  const id = ++generation;
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;

  const geometryChanged = ['add', 'move', 'remove', 'insert', 'reverse', 'roundtrip', 'load', 'reset', 'legs', 'options-geometry'].includes(
    reason,
  );

  if (geometryChanged) {
    try {
      await buildLegs(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) console.warn(error);
    }
    if (id !== generation) return;
  }

  const { line, boundaries } = routeLineWithBoundaries();
  drawnBoundaries = boundaries;
  view.drawWaypoints(S.state.trip.waypoints);
  view.drawLine(line, { pending: S.state.loading.snap });

  if (line.length < 2) {
    S.state.summary = null;
    S.state.weather = null;
    S.state.pois = [];
    S.state.avalanche = null;
    profile.update(null);
    renderAll();
    return;
  }

  const sample = buildSampleLine();
  if (sample.length < 2) {
    S.state.summary = null;
    profile.update(null);
    renderAll();
    return;
  }

  // Vis foreløpige tall uten høyder med én gang, så appen kjennes rask ut.
  S.state.summary = summarise(sample, new Array(sample.length).fill(null), S.state.trip.options);
  renderAll();

  if (geometryChanged) S.state.elevationCache = null;

  if (S.state.elevationCache?.length !== sample.length) {
    S.state.loading.elevation = true;
    renderStats();
    try {
      const elevations = await fetchElevations(sample, { signal: controller.signal });
      if (id !== generation) return;
      S.state.elevationCache = elevations;
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn('Høydedata feilet', error);
        toast('Fikk ikke tak i høydedata fra Kartverket. Tidsestimatet blir grovt.', { kind: 'advarsel' });
      }
    } finally {
      S.state.loading.elevation = false;
    }
  }

  if (id !== generation) return;
  // Slo høydeoppslaget feil, regner vi videre uten høyder framfor å blande inn
  // tallene fra forrige rute.
  const elevations =
    S.state.elevationCache?.length === sample.length ? S.state.elevationCache : [];
  S.state.summary = summarise(sample, elevations, S.state.trip.options);
  profile.update(S.state.summary);
  renderAll();

  if (geometryChanged) refreshContext();
  else loadWeatherOnly();
}

/**
 * Henter alt som avhenger av hvor ruta går: vær, sol, skred og severdigheter.
 * Hver kilde tegnes så snart den svarer – Overpass bruker gjerne et titalls
 * sekunder, og været skal ikke måtte vente på den.
 */
function loadContext() {
  const id = generation;
  const summary = S.state.summary;
  if (!summary) return;
  const start = S.startDate();
  const fresh = () => id === generation;

  S.state.loading.weather = true;
  S.state.loading.pois = true;
  renderPane('vaer');
  renderPane('rute');

  Promise.all([loadWeather(buildCheckpoints(summary, start)), loadSun(summary.line[0], start)])
    .then(([weather, sun]) => {
      if (!fresh()) return;
      S.state.weather = weather;
      S.state.sun = sun;
    })
    .catch((error) => console.warn('Værdata feilet', error))
    .finally(() => {
      if (!fresh()) return;
      S.state.loading.weather = false;
      renderPane('vaer');
      renderPane('sikkerhet');
    });

  fetchAvalancheWarning(summary.line[0], { from: start })
    .then((avalanche) => {
      if (!fresh()) return;
      S.state.avalanche = avalanche;
      renderPane('sikkerhet');
    })
    .catch(() => {});

  fetchPois(summary.line)
    .then((pois) => {
      if (!fresh()) return;
      S.state.pois = pois;
      view.drawPois(pois);
    })
    .catch((error) => console.warn('Overpass feilet', error))
    .finally(() => {
      if (!fresh()) return;
      S.state.loading.pois = false;
      renderPane('rute');
    });
}

/** Bare været – når bare tidspunkt eller marsjfart er endret. */
async function loadWeatherOnly() {
  const summary = S.state.summary;
  if (!summary) return;
  const id = generation;
  S.state.loading.weather = true;
  renderPane('vaer');
  const start = S.startDate();
  const [weather, sun] = await Promise.all([
    loadWeather(buildCheckpoints(summary, start)).catch(() => null),
    loadSun(summary.line[0], start),
  ]);
  if (id !== generation) return;
  S.state.weather = weather;
  S.state.sun = sun;
  S.state.loading.weather = false;
  renderPane('vaer');
  renderPane('sikkerhet');
}

/* ---------- Panel ---------- */

const handlers = {
  onName: (name) => S.setName(name),
  onStartTime: (date) => S.setStartTime(date),
  onOptions: (patch) => S.setOptions(patch),
  onReverse: () => S.reverseTrip(),
  onRoundTrip: () => S.makeRoundTrip(),
  onRemoveWaypoint: (id) => S.removeWaypoint(id),
  onFocusWaypoint: (waypoint) => view.flyTo(waypoint, 14),
  onFocusPoi: (poi) => view.flyTo(poi, 15),
  onBasemap: (id) => {
    basemap = id;
    view.setBasemap(id);
    persistPrefs();
    renderPane('kart');
  },
  onTrailLayer: (id, visible) => {
    trailState[id] = visible;
    view.setTrailLayer(id, visible);
    persistPrefs();
  },
  onOpenTrip: (trip) => {
    S.setTrip({ ...trip, id: trip.id }, 'load');
    toast(`Åpnet «${trip.name}».`, { kind: 'ok' });
  },
  onDeleteTrip: (trip) => {
    S.deleteTrip(trip.id);
    renderPane('turer');
  },
};

const PANES = {
  plan: () => panels.renderPlan(S.state.trip, S.state.summary, S.startDate(), handlers),
  vaer: () => panels.renderWeather(S.state.weather, S.state.sun, S.state.loading.weather, S.startDate()),
  sikkerhet: () =>
    panels.renderSafety(
      S.state.summary,
      S.state.sun,
      S.state.avalanche,
      S.startDate(),
      checklist,
      (index, value) => {
        checklist[index] = value;
        persistPrefs();
      },
    ),
  rute: () => panels.renderPois(S.state.pois, S.state.summary, S.state.loading.pois, handlers),
  kart: () => panels.renderLayers({ basemap }, trailState, handlers),
  turer: () => panels.renderSavedTrips(S.savedTrips(), handlers),
};

let activeTab = 'plan';

function renderPane(name) {
  const node = $(`#pane-${name}`);
  if (!node) return;
  // Skjulte faner tegnes først når de vises – sparer arbeid ved hvert tastetrykk.
  if (node.hidden && name !== activeTab) return;
  render(node, PANES[name]().flat().filter(Boolean));
}

function renderStats() {
  render($('#stats'), panels.renderStats(S.state.summary, S.state.loading).filter(Boolean));
}

function renderAll() {
  renderStats();
  renderPane(activeTab);
  $('#profile-empty').hidden = Boolean(S.state.summary);
  $('#btn-undo').disabled = S.state.trip.waypoints.length === 0;
  $('#btn-clear').disabled = S.state.trip.waypoints.length === 0;
  $('#btn-save').disabled = S.state.trip.waypoints.length < 2;
  $('#btn-share').disabled = S.state.trip.waypoints.length < 1;
  $('#btn-gpx').disabled = !S.state.summary;
}

function selectTab(name) {
  activeTab = name;
  for (const button of document.querySelectorAll('.tab')) {
    const selected = button.dataset.tab === name;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
  for (const pane of document.querySelectorAll('.pane')) {
    pane.hidden = pane.dataset.pane !== name;
  }
  renderPane(name);
}

for (const button of document.querySelectorAll('.tab')) {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
}

/* ---------- Bunnark på mobil ---------- */

const panel = $('#panel');
const sheetHandle = $('#sheet-handle');

function openSheet(open = true) {
  panel.classList.toggle('is-open', open);
  sheetHandle.setAttribute('aria-expanded', String(open));
  setTimeout(() => view.invalidate(), 260);
}
sheetHandle.addEventListener('click', () => openSheet(!panel.classList.contains('is-open')));

/* ---------- Verktøyknapper ---------- */

$('#btn-undo').addEventListener('click', () => {
  const last = S.state.trip.waypoints.at(-1);
  if (last) S.removeWaypoint(last.id);
});

$('#btn-clear').addEventListener('click', () => {
  if (S.state.trip.waypoints.length > 1 && !confirm('Vil du fjerne hele ruta?')) return;
  S.resetTrip();
});

$('#btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    toast('Nettleseren din deler ikke posisjon.', { kind: 'feil' });
    return;
  }
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    view.showPosition(null);
    $('#btn-locate').classList.remove('is-on');
    return;
  }
  $('#btn-locate').classList.add('is-on');
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const point = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      view.showPosition(point);
      if (!view.map.getBounds().contains([point.lat, point.lon])) view.flyTo(point, 14);
    },
    (error) => {
      $('#btn-locate').classList.remove('is-on');
      watchId = null;
      toast(
        error.code === error.PERMISSION_DENIED
          ? 'Du må gi siden tilgang til posisjon i nettleserinnstillingene.'
          : 'Fant ikke posisjonen din.',
        { kind: 'feil' },
      );
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
  );
});

$('#btn-save').addEventListener('click', () => {
  if (!S.state.trip.name) S.setName(suggestName());
  const record = S.saveTrip();
  toast(`Lagret «${record.name}» på denne enheten.`, { kind: 'ok' });
  renderPane('turer');
});

$('#btn-share').addEventListener('click', async () => {
  const url = tripToUrl(S.state.trip);
  history.replaceState(null, '', url);
  const name = S.state.trip.name || suggestName();
  if (navigator.share) {
    try {
      await navigator.share({ title: `${name} – Turplan`, url });
      return;
    } catch {
      // Brukeren avbrøt delingen; fall tilbake til kopiering.
    }
  }
  toast((await copyText(url)) ? 'Lenken er kopiert.' : 'Kunne ikke kopiere lenken.', {
    kind: 'ok',
  });
});

$('#btn-gpx').addEventListener('click', () => {
  const summary = S.state.summary;
  if (!summary) return;
  const name = S.state.trip.name || suggestName();
  const gpx = buildGpx({
    name,
    line: summary.line,
    elevations: summary.elevations,
    waypoints: S.state.trip.waypoints.map((w, i) => ({ ...w, name: w.name ?? `Punkt ${i + 1}` })),
  });
  downloadText(safeFilename(name), gpx);
});

$('#input-gpx').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = parseGpx(await file.text());
    const source = parsed.track.length ? parsed.track : parsed.waypoints;
    // Et GPX-spor kan ha tusenvis av punkter; vi beholder formen, ikke hvert måleavvik.
    const waypoints = simplify(source, 25).map((p) => ({ lat: p.lat, lon: p.lon, name: null }));
    if (waypoints.length < 2) throw new Error('Sporet har for få punkter.');
    S.setTrip({
      name: parsed.name ?? file.name.replace(/\.gpx$/i, ''),
      waypoints: waypoints.map((w, i) => ({ ...w, id: `gpx-${i}` })),
      legs: waypoints.slice(1).map((point, i) => ({
        points: [waypoints[i], point],
        snapped: false,
        pending: false,
      })),
      options: S.state.trip.options,
    });
    toast(`Leste inn ${waypoints.length} punkter fra ${file.name}.`, { kind: 'ok' });
  } catch (error) {
    toast(error.message || 'Klarte ikke å lese GPX-filen.', { kind: 'feil' });
  } finally {
    event.target.value = '';
  }
});

function suggestName() {
  const first = S.state.trip.waypoints[0];
  const last = S.state.trip.waypoints.at(-1);
  if (first?.name && last?.name && first.name !== last.name) return `${first.name} – ${last.name}`;
  if (first?.name) return first.name;
  return S.state.summary ? `Tur på ${formatDistance(S.state.summary.distance)}` : 'Ny tur';
}

function persistPrefs() {
  S.savePrefs({ basemap, trails: trailState, checklist });
}

/* ---------- Tastatursnarveier ---------- */

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea, select')) return;
  if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
    $('#btn-undo').click();
    event.preventDefault();
  } else if (event.key === '/') {
    $('#search-input').focus();
    event.preventDefault();
  }
});

/* ---------- Kobling til tilstand ---------- */

S.on('trip', ({ reason }) => {
  if (reason === 'meta') {
    renderAll();
    return;
  }
  recompute(reason);
});

/* ---------- Oppstart ---------- */

function boot() {
  const shared = tripFromUrl();
  if (shared?.waypoints?.length) {
    const waypoints = shared.waypoints.map((point, i) => ({ ...point, name: null, id: `del-${i}` }));
    S.setTrip({
      name: shared.name,
      waypoints,
      legs: waypoints.slice(1).map((point, i) => ({ points: [waypoints[i], point], snapped: false, pending: true })),
      options: { ...DEFAULT_OPTIONS, ...S.state.trip.options, ...clean(shared.options) },
    });
    setTimeout(() => view.fitRoute(S.routeLine()), 200);
    openSheet(window.matchMedia('(min-width: 900px)').matches);
  } else {
    renderAll();
    selectTab('plan');
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline-støtte er en bonus, ikke et krav */
    });
  }
}

const clean = (object) =>
  Object.fromEntries(Object.entries(object ?? {}).filter(([, value]) => value !== undefined));

boot();

// Praktisk for feilsøking i konsollen; ikke noe appen selv er avhengig av.
window.turplan = { state: S.state, view, version: APP.version };
