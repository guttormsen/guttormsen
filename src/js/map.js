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
        draggable: true,
        keyboard: true,
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

  map.on('click', (event) => {
    const point = { lat: event.latlng.lat, lon: event.latlng.lng };
    // Klikk nær ruta setter inn et punkt i stedet for å forlenge den.
    if (currentLine.length > 1) {
      const hit = closestPointOnPath(point, currentLine);
      const tolerance = metersPerPixel() * 12;
      if (hit.distance < tolerance) {
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

  return {
    map,
    setBasemap,
    setTrailLayer,
    drawWaypoints,
    drawLine,
    drawPois,

    fitRoute(points, options = {}) {
      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lon], Math.max(map.getZoom(), 13));
        return;
      }
      if (points.length < 2) return;
      map.fitBounds(
        L.latLngBounds(points.map((p) => [p.lat, p.lon])),
        { padding: [50, 50], maxZoom: 15, ...options },
      );
    },

    flyTo(point, zoom = 14) {
      map.flyTo([point.lat, point.lon], zoom, { duration: 0.8 });
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

    invalidate() {
      map.invalidateSize();
    },
  };
}
