/**
 * Oppstart og lim. Her kobles kart, tilstand, API-er og panel sammen.
 */
import { DEFAULT_OPTIONS, ELEVATION_MAX_SAMPLES, ELEVATION_MIN_SPACING, TRAIL_WMS } from './config.js';
import { $, debounce, formatDistance, render } from './util.js';
import { densify, pathLength, simplify } from './geo.js';
import { summarise } from './route.js';
import { fetchElevations } from './api/hoydedata.js';
import { fetchAvalancheWarning } from './api/varsom.js';
import { fetchPois } from './api/overpass.js';
import { fetchFotruterForDiscovery } from './api/turrutebasen.js';
import { buildCheckpoints, loadSun, loadWeather } from './weather.js';
import { createMap } from './map.js';
import { createProfile } from './profile.js';
import { createSearch } from './search.js';
import { createSnapper, SNAP_REASONS } from './snap.js';
import { buildGpx, parseGpx, safeFilename } from './gpx.js';
import { copyText, downloadText, toast } from './ui.js';
import { DEFAULT_FILTERS, buildTrips, enrichTrip, filterTrips, sampleForCard, surpriseMe } from './trips.js';
import { entries as journalEntries, logTrip, removeEntry } from './journal.js';
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
let myPosition = null;
/** Øker for hver omregning, så gamle svar kan forkastes. */
let generation = 0;
let inflight = null;
let activeTab = 'finn';

const view = createMap($('#map'), {
  onMapClicked: (point) => S.addWaypoint(point),
  onLineClicked: (point, segmentIndex) => S.insertWaypoint(legIndexForSegment(segmentIndex), point),
  onWaypointMoved: (id, point) => S.moveWaypoint(id, point),
  onWaypointClicked: (id) => S.removeWaypoint(id),
  onPoiClicked: (poi) => view.flyTo(poi, 15),
  onMoveEnd: () => updateSearchHere(),
});
view.setBasemap(basemap);
for (const [id, visible] of Object.entries(trailState)) view.setTrailLayer(id, visible);

const profile = createProfile($('#profile'), { onHover: (point) => view.showHover(point) });

createSearch(
  { input: $('#search-input'), listbox: $('#search-results'), status: $('#search-status') },
  {
    onPick: (place) => {
      view.flyTo(place, 13);
      // Etter et søk er det nesten alltid turforslag brukeren er ute etter.
      selectTab('finn');
      setTimeout(() => loadDiscovery(), 900);
    },
  },
);

/* ---------- Etapper og geometri ---------- */

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
  if (!trip.legs.some((leg) => leg.pending)) return;

  if (!trip.options.snapToTrail) {
    for (const leg of trip.legs) leg.pending = false;
    return;
  }

  S.state.loading.snap = true;
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
        if (signal.aborted) return;
        trip.legs[i] = { points: result.points, snapped: result.snapped, pending: false };
        if (!result.snapped && result.reason) reasons.add(result.reason);
      } catch (error) {
        if (signal.aborted) return;
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
}

/**
 * Lager punktrekka vi slår opp høyder for: tett nok til å følge terrenget,
 * men aldri flere punkter enn Kartverket bør bli spurt om.
 */
function buildSampleLine() {
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

  const geometryChanged = [
    'add', 'move', 'remove', 'insert', 'reverse', 'roundtrip', 'load', 'reset', 'legs', 'options-geometry',
  ].includes(reason);

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

  const sample = line.length >= 2 ? buildSampleLine() : [];
  if (sample.length < 2) {
    S.state.summary = null;
    S.state.weather = null;
    S.state.pois = [];
    S.state.avalanche = null;
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
  const elevations = S.state.elevationCache?.length === sample.length ? S.state.elevationCache : [];
  S.state.summary = summarise(sample, elevations, S.state.trip.options);
  profile.update(S.state.summary);
  renderAll();

  if (geometryChanged) refreshContext();
  else loadWeatherOnly();
}

/**
 * Henter alt som avhenger av hvor ruta går: vær, sol, skred og severdigheter.
 * Hver kilde tegnes så snart den svarer.
 */
function loadContext() {
  const id = generation;
  const summary = S.state.summary;
  if (!summary) return;
  const start = S.startDate();
  const fresh = () => id === generation;

  S.state.loading.weather = true;
  S.state.loading.pois = true;
  renderPane('turen');

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
      renderPane('turen');
    });

  fetchAvalancheWarning(summary.line[0], { from: start })
    .then((avalanche) => {
      if (!fresh()) return;
      S.state.avalanche = avalanche;
      renderPane('turen');
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
      renderPane('turen');
    });
}

/** Bare været – når bare tidspunkt eller marsjfart er endret. */
async function loadWeatherOnly() {
  const summary = S.state.summary;
  if (!summary) return;
  const id = generation;
  S.state.loading.weather = true;
  renderPane('turen');
  const start = S.startDate();
  const [weather, sun] = await Promise.all([
    loadWeather(buildCheckpoints(summary, start)).catch(() => null),
    loadSun(summary.line[0], start),
  ]);
  if (id !== generation) return;
  S.state.weather = weather;
  S.state.sun = sun;
  S.state.loading.weather = false;
  renderPane('turen');
}

/* ---------- Finn tur ---------- */

let discoveryRun = 0;

async function loadDiscovery() {
  const run = ++discoveryRun;
  const box = view.searchBox();
  const discovery = S.state.discovery;
  discovery.loading = true;
  discovery.error = false;
  discovery.box = box;
  renderPane('finn');
  updateSearchHere();

  try {
    const segments = await fetchFotruterForDiscovery(box);
    if (run !== discoveryRun) return;
    discovery.all = buildTrips(segments);
    discovery.truncated = segments.length >= 1200;
    discovery.searched = true;
    applyFilters();
    loadCardElevations(run);
  } catch (error) {
    if (run !== discoveryRun) return;
    console.warn('Turrutebasen feilet', error);
    discovery.error = true;
    discovery.searched = true;
  } finally {
    if (run === discoveryRun) {
      discovery.loading = false;
      renderPane('finn');
      updateSearchHere();
    }
  }
}

function applyFilters() {
  const discovery = S.state.discovery;
  const origin = myPosition ?? view.center();
  discovery.visible = filterTrips(discovery.all, S.state.filters, origin);
  discovery.total = discovery.all.length;
  renderPane('finn');
}

/** Henter grove høyder for de øverste kortene, så de får stigning og tid. */
async function loadCardElevations(run) {
  const targets = S.state.discovery.visible.filter((trip) => trip.ascent == null).slice(0, 12);
  if (!targets.length) return;

  const samples = targets.map((trip) => sampleForCard(trip.points));
  const flat = samples.flat();
  let elevations;
  try {
    elevations = await fetchElevations(flat);
  } catch (error) {
    console.warn('Høyder for turforslag feilet', error);
    return;
  }
  if (run !== discoveryRun) return;

  let cursor = 0;
  const enriched = new Map();
  targets.forEach((trip, index) => {
    const sample = samples[index];
    const slice = elevations.slice(cursor, cursor + sample.length);
    cursor += sample.length;
    enriched.set(trip.id, enrichTrip(trip, sample, slice, S.state.trip.options));
  });

  const merge = (trip) => enriched.get(trip.id) ?? trip;
  S.state.discovery.all = S.state.discovery.all.map(merge);
  applyFilters();
}

/** Viser eller skjuler «Finn turer her» etter hvor kartet står. */
function updateSearchHere() {
  const button = $('#btn-search-here');
  const zoomedEnough = view.zoom() >= 10;
  const discovery = S.state.discovery;
  const moved =
    !discovery.box ||
    Math.abs((discovery.box[0] + discovery.box[2]) / 2 - view.center().lat) > 0.03 ||
    Math.abs((discovery.box[1] + discovery.box[3]) / 2 - view.center().lon) > 0.06;
  button.hidden = activeTab !== 'finn' || discovery.loading || !zoomedEnough || (!moved && discovery.searched);
  button.textContent = discovery.searched ? '🔍 Søk i dette området' : '🔍 Finn turer her';
}

/* ---------- Handlinger ---------- */

const handlers = {
  /* Finn tur */
  onSearchHere: () => loadDiscovery(),
  onToggleLength: (id) => {
    const list = S.state.filters.lengths;
    S.state.filters.lengths = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    applyFilters();
  },
  onToggleGrade: (id) => {
    const list = S.state.filters.grades;
    S.state.filters.grades = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    applyFilters();
  },
  onShape: (shape) => {
    S.state.filters.shape = S.state.filters.shape === shape ? null : shape;
    applyFilters();
  },
  onSpecial: (id) => {
    S.state.filters.special = S.state.filters.special === id ? null : id;
    applyFilters();
  },
  onToggleMarked: () => {
    S.state.filters.markedOnly = !S.state.filters.markedOnly;
    applyFilters();
  },
  onResetFilters: () => {
    S.state.filters = { ...DEFAULT_FILTERS };
    applyFilters();
  },
  onPreviewTrip: (trip) => {
    S.state.preview = trip;
    view.showSuggestion(trip?.points ?? null);
  },
  onPickTrip: (trip) => {
    view.showSuggestion(null);
    S.setTrip(S.tripFromSuggestion(trip), 'load');
    view.fitRoute(trip.points);
    selectTab('turen');
    toast(`«${trip.name}» er lagt inn. Juster gjerne start og fart.`, { kind: 'ok' });
  },
  onSurprise: () => {
    const trip = surpriseMe(S.state.discovery.visible);
    if (trip) handlers.onPickTrip(trip);
  },
  onDrawOwn: () => {
    selectTab('turen');
    toast('Trykk i kartet for å sette startpunktet.');
  },
  onGoDiscover: () => selectTab('finn'),

  /* Turen */
  onName: (name) => S.setName(name),
  onStartTime: (date) => S.setStartTime(date),
  onOptions: (patch) => S.setOptions(patch),
  onReverse: () => S.reverseTrip(),
  onRoundTrip: () => S.makeRoundTrip(),
  onRemoveWaypoint: (id) => S.removeWaypoint(id),
  onFocusWaypoint: (waypoint) => view.flyTo(waypoint, 14),
  onFocusPoi: (poi) => view.flyTo(poi, 15),
  onToggleCheck: (index, value) => {
    checklist[index] = value;
    persistPrefs();
    renderPane('turen');
  },
  onExportGpx: () => exportGpx(),
  onImportGpx: (event) => importGpx(event),

  /* Kartlag */
  onBasemap: (id) => {
    basemap = id;
    view.setBasemap(id);
    persistPrefs();
    renderLayerPopover();
  },
  onTrailLayer: (id, visible) => {
    trailState[id] = visible;
    view.setTrailLayer(id, visible);
    persistPrefs();
  },

  /* Dagbok */
  entries: () => journalEntries(),
  onRemoveEntry: (id) => {
    removeEntry(id);
    renderPane('dagbok');
  },
  onOpenTrip: (saved) => {
    S.setTrip({ ...saved }, 'load');
    selectTab('turen');
    toast(`Åpnet «${saved.name}».`, { kind: 'ok' });
  },
  onDeleteTrip: (saved) => {
    S.deleteTrip(saved.id);
    renderPane('dagbok');
  },

  /* Bunnrad */
  onLogTrip: () => {
    const summary = S.state.summary;
    if (!summary) return;
    const name = S.state.trip.name || suggestName();
    const entry = logTrip({
      name,
      distance: summary.distance,
      ascent: summary.ascent,
      seconds: summary.time.totalSeconds,
      maxElevation: summary.maxElevation,
      loop: S.state.trip.waypoints.length > 1 && summary.distances.at(-1) > 0 && isLoop(summary),
      date: S.state.trip.startTime,
    });
    toast(`«${entry.name}» er ført i dagboka. Godt gått!`, { kind: 'ok' });
    selectTab('dagbok');
  },
  onSave: () => {
    if (!S.state.trip.name) S.setName(suggestName());
    const record = S.saveTrip();
    toast(`Lagret «${record.name}» på denne enheten.`, { kind: 'ok' });
  },
  onShare: () => share(),
};

const isLoop = (summary) => {
  const first = summary.line[0];
  const last = summary.line.at(-1);
  return Math.abs(first.lat - last.lat) < 0.003 && Math.abs(first.lon - last.lon) < 0.006;
};

/* ---------- Tegning av panelet ---------- */

const PANES = {
  finn: () => panels.renderDiscover(S.state.discovery, S.state.filters, handlers),
  turen: () =>
    panels.renderTrip(
      {
        trip: S.state.trip,
        summary: S.state.summary,
        startTime: S.startDate(),
        weather: S.state.weather,
        sun: S.state.sun,
        avalanche: S.state.avalanche,
        pois: S.state.pois,
        loading: S.state.loading,
        checklist,
      },
      handlers,
    ),
  dagbok: () => panels.renderJournal(S.savedTrips(), handlers),
};

function renderPane(name) {
  const node = $(`#pane-${name}`);
  // Skjulte faner tegnes først når de vises – sparer arbeid ved hvert tastetrykk.
  if (!node || name !== activeTab) return;
  render(node, PANES[name]().flat().filter(Boolean));
}

function renderStats() {
  render($('#stats'), panels.renderStats(S.state.summary, S.state.loading).filter(Boolean));
}

function renderAll() {
  const hasRoute = Boolean(S.state.summary);
  $('#route-header').hidden = !hasRoute || activeTab === 'dagbok';
  $('#panel-footer').hidden = !hasRoute;
  $('#draw-tools').hidden = S.state.trip.waypoints.length === 0;

  if (hasRoute) renderStats();
  render($('#panel-footer'), panels.renderFooter(S.state.summary, handlers).flat().filter(Boolean));
  renderPane(activeTab);
  updateSearchHere();
}

function selectTab(name) {
  activeTab = name;
  for (const button of document.querySelectorAll('.tab')) {
    const selected = button.dataset.tab === name;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
  for (const pane of document.querySelectorAll('.pane')) pane.hidden = pane.dataset.pane !== name;
  if (name !== 'finn') view.showSuggestion(null);
  openSheet(true);
  renderAll();
}

for (const button of document.querySelectorAll('.tab')) {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
}

/* ---------- Bunnark ---------- */

const panel = $('#panel');
const sheetHandle = $('#sheet-handle');

function openSheet(open = true) {
  panel.classList.toggle('is-open', open);
  sheetHandle.setAttribute('aria-expanded', String(open));
  setTimeout(() => view.invalidate(), 260);
}
sheetHandle.addEventListener('click', () => openSheet(!panel.classList.contains('is-open')));

/* ---------- Kartlag ---------- */

const layerPopover = $('#layer-popover');
const layerButton = $('#btn-layers');

function renderLayerPopover() {
  render(layerPopover, panels.renderLayers(basemap, trailState, handlers).flat().filter(Boolean));
}

layerButton.addEventListener('click', () => {
  const open = layerPopover.hidden;
  layerPopover.hidden = !open;
  layerButton.setAttribute('aria-expanded', String(open));
  if (open) renderLayerPopover();
});
document.addEventListener('click', (event) => {
  if (layerPopover.hidden) return;
  if (layerPopover.contains(event.target) || layerButton.contains(event.target)) return;
  layerPopover.hidden = true;
  layerButton.setAttribute('aria-expanded', 'false');
});

/* ---------- Verktøy på kartet ---------- */

$('#btn-search-here').addEventListener('click', () => loadDiscovery());

$('#btn-undo').addEventListener('click', () => {
  const last = S.state.trip.waypoints.at(-1);
  if (last) S.removeWaypoint(last.id);
});

$('#btn-clear').addEventListener('click', () => {
  if (!S.state.trip.waypoints.length) return;
  // Ingen bekreftelsesdialog: det er raskere å angre enn å svare på et spørsmål.
  const previous = structuredClone(S.state.trip);
  S.resetTrip();
  toast('Ruta er tømt.', {
    action: { label: 'Angre', onClick: () => S.setTrip(previous, 'load') },
  });
});

$('#btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    toast('Nettleseren din deler ikke posisjon.', { kind: 'feil' });
    return;
  }
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    myPosition = null;
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
      const first = myPosition == null;
      myPosition = point;
      view.showPosition(point);
      if (first) {
        view.flyTo(point, 13);
        if (activeTab === 'finn' && !S.state.discovery.searched) setTimeout(() => loadDiscovery(), 1000);
      }
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

/* ---------- Del, GPX og navn ---------- */

async function share() {
  const url = tripToUrl(S.state.trip);
  history.replaceState(null, '', url);
  const name = S.state.trip.name || suggestName();
  const summary = S.state.summary;
  const text = summary
    ? `${name} – ${formatDistance(summary.distance)}, ${Math.round(summary.ascent)} høydemeter`
    : name;

  if (navigator.share) {
    try {
      await navigator.share({ title: `${name} – Turplan`, text, url });
      return;
    } catch {
      // Brukeren avbrøt delingen; fall tilbake til kopiering.
    }
  }
  toast((await copyText(url)) ? 'Lenken er kopiert.' : 'Kunne ikke kopiere lenken.', { kind: 'ok' });
}

function exportGpx() {
  const summary = S.state.summary;
  if (!summary) return;
  const name = S.state.trip.name || suggestName();
  downloadText(
    safeFilename(name),
    buildGpx({
      name,
      line: summary.line,
      elevations: summary.elevations,
      waypoints: S.state.trip.waypoints.map((w, i) => ({ ...w, name: w.name ?? `Punkt ${i + 1}` })),
    }),
  );
}

async function importGpx(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = parseGpx(await file.text());
    const source = parsed.track.length ? parsed.track : parsed.waypoints;
    // Et GPX-spor kan ha tusenvis av punkter; vi beholder formen, ikke hvert måleavvik.
    const points = simplify(source, 15).map((p) => ({ lat: p.lat, lon: p.lon }));
    if (points.length < 2) throw new Error('Sporet har for få punkter.');
    const waypoints = [
      { ...points[0], name: null, id: 'gpx-start' },
      { ...points.at(-1), name: null, id: 'gpx-slutt' },
    ];
    S.setTrip({
      name: parsed.name ?? file.name.replace(/\.gpx$/i, ''),
      waypoints,
      legs: [{ points, snapped: true, pending: false }],
      options: S.state.trip.options,
    });
    selectTab('turen');
    view.fitRoute(points);
    toast(`Leste inn ${points.length} punkter fra ${file.name}.`, { kind: 'ok' });
  } catch (error) {
    toast(error.message || 'Klarte ikke å lese GPX-filen.', { kind: 'feil' });
  } finally {
    event.target.value = '';
  }
}

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
  // Escape lukker kartlagsvinduet uansett hvor fokus står – også når det står
  // i en av radioknappene inni vinduet.
  if (event.key === 'Escape' && !layerPopover.hidden) {
    layerPopover.hidden = true;
    layerButton.setAttribute('aria-expanded', 'false');
    layerButton.focus();
    return;
  }
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
  if (['add', 'insert', 'move'].includes(reason) && activeTab === 'finn') selectTab('turen');
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
    selectTab('turen');
    setTimeout(() => view.fitRoute(S.routeLine()), 200);
  } else {
    selectTab('finn');
    openSheet(window.matchMedia('(min-width: 900px)').matches);
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
window.turplan = { state: S.state, view, loadDiscovery, selectTab };
