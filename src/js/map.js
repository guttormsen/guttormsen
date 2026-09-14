/**
 * Kartlaget. Pakker inn Leaflet slik at resten av appen bare forholder seg til
 * veipunkter og linjer, ikke til lag, ikoner og hendelser.
 */
/* global L */
import { BASEMAPS, DEFAULT_VIEW, KARTVERKET_ATTRIBUTION, TRAIL_WMS } from './config.js';
import { closestPointOnPath } from './geo.js';
import { POI_KINDS } from './api/overpass.js';

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** Største område vi ber Turrutebasen om på én gang, i grader. */
const SEARCH_SPAN = { lat: 0.11, lon: 0.24 };

export function createMap(container, handlers = {}) {
  const map = L.map(container, {
    center: [DEFAULT_VIEW.lat, DEFAULT_VIEW.lon],
    zoom: DEFAULT_VIEW.zoom,
    zoomControl: false,
    // Kartverkets fliser dekker bare Norge; hindrer at brukeren surfer ut i havet.
    maxBounds: L.latLngBounds([53.0, -12.0], [75.5, 42.0]),
    maxBoundsViscosity: 0.6,
    worldCopyJump: false,
  });

  L.control.zoom({ position: 'topright', zoomInTitle: 'Zoom inn', zoomOutTitle: 'Zoom ut' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false, metric: true }).addTo(map);

  /* ---------- Bakgrunnskart ---------- */

  const baseLayers = new Map(
    BASEMAPS.map((basemap) => [
      basemap.id,
      L.tileLayer(basemap.url, {
        maxZoom: basemap.maxZoom,
        maxNativeZoom: basemap.maxZoom,
        attribution: `${KARTVERKET_ATTRIBUTION} · ${OSM_ATTRIBUTION}`,
        crossOrigin: 'anonymous',
      }),
    ]),
  );

  let activeBase = null;
  function setBasemap(id) {
    const next = baseLayers.get(id) ?? baseLayers.get(BASEMAPS[0].id);
    if (next === activeBase) return;
    if (activeBase) map.removeLayer(activeBase);
    activeBase = next;
    activeBase.addTo(map).bringToBack();
  }
  setBasemap(BASEMAPS[0].id);

  /* ---------- Turrutebasen ---------- */

  const trailLayers = new Map(
    TRAIL_WMS.layers.map((layer) => [
      layer.id,
      L.tileLayer.wms(TRAIL_WMS.url, {
        layers: layer.id,
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        // Lagene har MaxScaleDenominator 1e6 og tegnes ikke lenger ute enn dette.
        minZoom: TRAIL_WMS.minZoom,
        opacity: 0.9,
        attribution: `${KARTVERKET_ATTRIBUTION} Turrutebasen`,
      }),
    ]),
  );

  function setTrailLayer(id, visible) {
    const layer = trailLayers.get(id);
    if (!layer) return;
    if (visible) layer.addTo(map);
    else map.removeLayer(layer);
  }

  /* ---------- Rute og markører ---------- */

  const routePane = map.createPane('route');
  routePane.style.zIndex = 450;

  const shadow = L.polyline([], { pane: 'route', color: '#ffffff', weight: 9, opacity: 0.75 });
  const line = L.polyline([], { pane: 'route', color: '#e2483d', weight: 5, opacity: 0.95 });
  const pending = L.polyline([], {
    pane: 'route',
    color: '#e2483d',
    weight: 4,
    opacity: 0.5,
    dashArray: '6 8',
  });
  const markerGroup = L.layerGroup().addTo(map);
  const poiGroup = L.layerGroup().addTo(map);
  shadow.addTo(map);
  line.addTo(map);
  pending.addTo(map);

  // Forhåndsvisning av et turforslag, tegnet under den planlagte ruta.
  const suggestion = L.polyline([], {
    pane: 'route',
    color: '#1c6fd4',
    weight: 6,
    opacity: 0.9,
    lineCap: 'round',
  });
  const suggestionHalo = L.polyline([], {
    pane: 'route',
    color: '#ffffff',
    weight: 11,
    opacity: 0.8,
    lineCap: 'round',
  });
  const suggestionEnds = L.layerGroup();

  // Stien under pekeren, så det er tydelig at den kan trykkes på.
  const hovered = L.polyline([], {
    pane: 'route',
    color: '#1c6fd4',
    weight: 8,
    opacity: 0.55,
    lineCap: 'round',
  });

  const hoverMarker = L.circleMarker([0, 0], {
    pane: 'route',
    radius: 7,
    color: '#ffffff',
    weight: 3,
    fillColor: '#1d1d1f',
    fillOpacity: 1,
  });

  let positionMarker = null;
  let accuracyCircle = null;
  let currentLine = [];
  /**
   * Utenfor tegnemodus er kartet til for å se på. Da skal et trykk aldri
   * etterlate en markør – det holder å komme borti skjermen.
   */
  let drawing = false;

  function waypointIcon(index, total) {
    const isStart = index === 0;
    const isEnd = index === total - 1 && total > 1;
    const kind = isStart ? 'start' : isEnd ? 'slutt' : 'mellom';
    const label = isStart ? 'A' : isEnd ? 'B' : String(index);
    return L.divIcon({
      className: '',
      html: `<span class="wp wp--${kind}" aria-hidden="true">${label}</span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
  }

  /** Tegner veipunktene på nytt. */
  function drawWaypoints(waypoints) {
    markerGroup.clearLayers();
    waypoints.forEach((waypoint, index) => {
      const marker = L.marker([waypoint.lat, waypoint.lon], {
        icon: waypointIcon(index, waypoints.length),
        // Punkter flyttes og fjernes bare når man har bedt om å redigere.
        draggable: drawing,
        interactive: drawing,
        keyboard: drawing,
        title:
          waypoint.name ??
          (index === 0 ? 'Startpunkt' : index === waypoints.length - 1 ? 'Sluttpunkt' : `Punkt ${index}`),
        alt: `Veipunkt ${index + 1} av ${waypoints.length}`,
        riseOnHover: true,
      });
      marker.on('dragend', (event) => {
        const { lat, lng } = event.target.getLatLng();
        handlers.onWaypointMoved?.(waypoint.id, { lat, lon: lng });
      });
      marker.on('click', (event) => {
        L.DomEvent.stop(event);
        handlers.onWaypointClicked?.(waypoint.id, index);
      });
      marker.addTo(markerGroup);
    });
  }

  function drawLine(points, { pending: isPending = false } = {}) {
    currentLine = points;
    const latlngs = points.map((p) => [p.lat, p.lon]);
    shadow.setLatLngs(latlngs);
    line.setLatLngs(latlngs);
    pending.setLatLngs(isPending ? latlngs : []);
  }

  function drawPois(pois) {
    poiGroup.clearLayers();
    for (const poi of pois) {
      const meta = POI_KINDS[poi.kind];
      const marker = L.marker([poi.lat, poi.lon], {
        icon: L.divIcon({
          className: '',
          html: `<span class="poi poi--${poi.kind}" title="${meta.label}">${meta.icon}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        title: poi.name,
        alt: `${meta.label}: ${poi.name}`,
      });
      marker.on('click', (event) => {
        L.DomEvent.stop(event);
        handlers.onPoiClicked?.(poi);
      });
      marker.addTo(poiGroup);
    }
  }

  /* ---------- Hendelser ---------- */

  map.on('moveend', () => handlers.onMoveEnd?.());
  map.on('zoomend', () => handlers.onMoveEnd?.());

  map.on('mousemove', (event) => {
    handlers.onMapHover?.({ lat: event.latlng.lat, lon: event.latlng.lng }, metersPerPixel());
  });
  map.on('mouseout', () => handlers.onMapHover?.(null, metersPerPixel()));

  map.on('click', (event) => {
    const point = { lat: event.latlng.lat, lon: event.latlng.lng };

    if (!drawing) {
      handlers.onMapPicked?.(point, metersPerPixel());
      return;
    }

    // I tegnemodus setter et klikk nær ruta inn et punkt i stedet for å forlenge den.
    if (currentLine.length > 1) {
      const hit = closestPointOnPath(point, currentLine);
      if (hit.distance < metersPerPixel() * 12) {
        handlers.onLineClicked?.(hit.point, hit.index);
        return;
      }
    }
    handlers.onMapClicked?.(point);
  });

  function metersPerPixel() {
    const center = map.getCenter();
    return (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / 2 ** map.getZoom();
  }

  /* ---------- Publikt grensesnitt ---------- */

  /**
   * Hvor mye av kartets underkant som er dekket av noe annet – bunnarket, og
   * forhåndsvisningen når den ligger der. Turen skal få plass i det man
   * faktisk ser, ikke bak arket.
   */
  function coveredBySheet() {
    const box = container.getBoundingClientRect();
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--sheet-cover');
    const sheet = Number.parseFloat(raw);
    let covered = 0;
    if (Number.isFinite(sheet) && sheet > 0) {
      covered = Math.max(0, sheet - (window.innerHeight - box.bottom));
    }
    const preview = document.querySelector('#trail-preview');
    if (preview && !preview.hidden) {
      // Kortet ligger rett over arket, så det legger seg på toppen av tallet.
      covered += preview.getBoundingClientRect().height + 12;
    }
    return Math.max(0, Math.min(covered, box.height * 0.55));
  }

  return {
    map,
    setBasemap,
    setTrailLayer,
    drawWaypoints,
    drawLine,
    drawPois,

    fitRoute(points, options = {}) {
      const hidden = coveredBySheet();
      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lon], Math.max(map.getZoom(), 13));
        if (hidden) map.panBy([0, hidden / 2], { animate: false });
        return;
      }
      if (points.length < 2) return;
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])), {
        // Bunnarket dekker nedre del av kartet. Uten dette havner turen bak det.
        paddingTopLeft: [34, 34],
        paddingBottomRight: [34, 34 + hidden],
        maxZoom: 15,
        ...options,
      });
    },

    flyTo(point, zoom = 14) {
      map.flyTo([point.lat, point.lon], zoom, { duration: 0.8 });
      const hidden = coveredBySheet();
      if (hidden) map.once('moveend', () => map.panBy([0, hidden / 2], { animate: false }));
    },

    /** Markerer et punkt langs ruta, brukt når musa er over høydeprofilen. */
    showHover(point) {
      if (!point) {
        map.removeLayer(hoverMarker);
        return;
      }
      hoverMarker.setLatLng([point.lat, point.lon]);
      if (!map.hasLayer(hoverMarker)) hoverMarker.addTo(map);
    },

    showPosition(position) {
      if (!position) {
        if (positionMarker) map.removeLayer(positionMarker);
        if (accuracyCircle) map.removeLayer(accuracyCircle);
        positionMarker = null;
        accuracyCircle = null;
        return;
      }
      const latlng = [position.lat, position.lon];
      if (!positionMarker) {
        positionMarker = L.marker(latlng, {
          icon: L.divIcon({ className: '', html: '<span class="me" aria-hidden="true"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
          title: 'Din posisjon',
          interactive: false,
        }).addTo(map);
        accuracyCircle = L.circle(latlng, {
          radius: position.accuracy ?? 30,
          color: '#2f6fd0',
          weight: 1,
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(map);
      } else {
        positionMarker.setLatLng(latlng);
        accuracyCircle.setLatLng(latlng).setRadius(position.accuracy ?? 30);
      }
    },

    /** Slår tegnemodus av og på. Utenfor den legger ingen trykk igjen spor. */
    setDrawing(on) {
      drawing = Boolean(on);
      container.classList.toggle('is-drawing', drawing);
      if (drawing) {
        map.removeLayer(hovered);
        container.classList.remove('is-pointing');
      }
    },

    isDrawing: () => drawing,

    /**
     * Markerer stien under pekeren og setter pekefinger-markøren, så det
     * er synlig at den kan trykkes på.
     */
    highlightTrail(points) {
      if (!points?.length) {
        map.removeLayer(hovered);
        container.classList.remove('is-pointing');
        return;
      }
      hovered.setLatLngs(points.map((p) => [p.lat, p.lon]));
      if (!map.hasLayer(hovered)) hovered.addTo(map);
      hovered.bringToFront();
      container.classList.add('is-pointing');
    },

    /** Viser et turforslag i kartet, med markør i hver ende. */
    showSuggestion(points) {
      suggestionEnds.clearLayers();
      if (!points?.length) {
        for (const layer of [suggestionHalo, suggestion, suggestionEnds]) map.removeLayer(layer);
        return;
      }
      const latlngs = points.map((p) => [p.lat, p.lon]);
      suggestionHalo.setLatLngs(latlngs);
      suggestion.setLatLngs(latlngs);
      if (!map.hasLayer(suggestion)) {
        suggestionHalo.addTo(map);
        suggestion.addTo(map);
        suggestionEnds.addTo(map);
      }
      suggestionHalo.bringToFront();
      suggestion.bringToFront();
      for (const [point, kind] of [
        [points[0], 'start'],
        [points.at(-1), 'slutt'],
      ]) {
        L.marker([point.lat, point.lon], {
          icon: L.divIcon({
            className: '',
            html: `<span class="tip tip--${kind}" aria-hidden="true"></span>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
          interactive: false,
        }).addTo(suggestionEnds);
      }
    },

    /**
     * Området vi leter etter turforslag i: kartutsnittet, men aldri større enn
     * det rutebasen svarer på i rimelig tid.
     */
    searchBox() {
      const bounds = map.getBounds();
      const center = bounds.getCenter();
      const south = Math.max(bounds.getSouth(), center.lat - SEARCH_SPAN.lat / 2);
      const north = Math.min(bounds.getNorth(), center.lat + SEARCH_SPAN.lat / 2);
      const west = Math.max(bounds.getWest(), center.lng - SEARCH_SPAN.lon / 2);
      const east = Math.min(bounds.getEast(), center.lng + SEARCH_SPAN.lon / 2);
      return [south, west, north, east];
    },

    /** Sentrerer på posisjonen uten å endre zoom – brukes mens man går. */
    follow(point) {
      if (!point) return;
      map.panTo([point.lat, point.lon], { animate: true, duration: 0.6 });
    },

    center() {
      const { lat, lng } = map.getCenter();
      return { lat, lon: lng };
    },

    zoom: () => map.getZoom(),

    invalidate() {
      map.invalidateSize();
    },
  };
}
