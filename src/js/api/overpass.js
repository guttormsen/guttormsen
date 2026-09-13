/**
 * OpenStreetMap-data via Overpass API.
 * Brukes til to ting: severdigheter langs ruta, og stinettet vi snapper mot.
 *
 * Overpass er en dugnadstjeneste som ofte svarer 504 når den er travel,
 * derfor prøver vi flere speil i rekkefølge.
 */
import { request } from './http.js';
import { API } from '../config.js';
import { simplify } from '../geo.js';

/** Kjører en Overpass-QL-spørring mot første speil som svarer. */
async function overpass(query, { signal, ttl = 15 * 60 * 1000, timeout = 45000 } = {}) {
  let lastError;
  for (const endpoint of API.overpass) {
    try {
      return await request(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        ttl,
        timeout,
        retries: 0,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error('Ingen Overpass-speil svarte');
}

/** `lat,lon,lat,lon,…` – Overpass tar en hel linje i `around`. */
function aroundList(points, maxVertices = 40) {
  const trimmed = points.length > maxVertices ? simplify(points, 150).slice(0, maxVertices) : points;
  return trimmed.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',');
}

/** Kategoriene vi viser langs ruta, i prioritert rekkefølge. */
export const POI_KINDS = {
  hytte: { label: 'Hytte', icon: '🛖' },
  gapahuk: { label: 'Gapahuk/bu', icon: '⛺' },
  topp: { label: 'Topp', icon: '⛰️' },
  utsikt: { label: 'Utsiktspunkt', icon: '🔭' },
  vann: { label: 'Drikkevann', icon: '💧' },
  bål: { label: 'Bålplass', icon: '🔥' },
  parkering: { label: 'Parkering', icon: '🅿️' },
  kollektiv: { label: 'Kollektiv', icon: '🚌' },
};

function classify(tags = {}) {
  if (tags.tourism === 'alpine_hut' || tags.tourism === 'chalet') return 'hytte';
  if (tags.tourism === 'wilderness_hut' || tags.amenity === 'shelter') return 'gapahuk';
  if (tags.natural === 'peak') return 'topp';
  if (tags.tourism === 'viewpoint') return 'utsikt';
  if (tags.amenity === 'drinking_water' || tags.natural === 'spring') return 'vann';
  if (tags.leisure === 'firepit') return 'bål';
  if (tags.amenity === 'parking') return 'parkering';
  if (tags.highway === 'bus_stop' || tags.railway === 'station' || tags.public_transport === 'station')
    return 'kollektiv';
  return null;
}

/**
 * Severdigheter og fasiliteter innenfor `radius` meter fra ruta.
 * @param {Array<{lat:number,lon:number}>} route
 */
export async function fetchPois(route, { radius = 700, signal } = {}) {
  if (route.length < 1) return [];
  const near = `around:${radius},${aroundList(route)}`;
  const query = `[out:json][timeout:40];
(
  node["tourism"~"^(alpine_hut|wilderness_hut|chalet|viewpoint)$"](${near});
  way["tourism"~"^(alpine_hut|wilderness_hut|chalet)$"](${near});
  node["amenity"="shelter"](${near});
  node["natural"="peak"]["name"](${near});
  node["natural"="spring"]["drinking_water"!="no"](${near});
  node["amenity"="drinking_water"](${near});
  node["leisure"="firepit"](${near});
  node["amenity"="parking"](${near});
  way["amenity"="parking"](${near});
  node["highway"="bus_stop"](${near});
  node["railway"="station"](${near});
);
out center tags 250;`;

  const data = await overpass(query, { signal });
  const seen = new Set();

  return (data?.elements ?? [])
    .map((element) => {
      const tags = element.tags ?? {};
      const kind = classify(tags);
      if (!kind) return null;
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `${element.type}/${element.id}`,
        kind,
        lat,
        lon,
        name: tags.name ?? tags['name:no'] ?? POI_KINDS[kind].label,
        operator: tags.operator ?? null,
        elevation: tags.ele ? Number(tags.ele) : null,
        website: tags.website ?? tags['contact:website'] ?? null,
        /** DNT-hytter har som regel operator som starter med "DNT". */
        dnt: /(^|\s)DNT(\s|$)|Turistforening/i.test(tags.operator ?? ''),
      };
    })
    .filter((poi) => {
      if (!poi) return false;
      const key = `${poi.kind}|${poi.name}|${poi.lat.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Vegtyper vi lar ruta følge, med kostnadsvekt (lavere = mer ønskelig). */
export const WALKABLE = {
  path: 1.0,
  footway: 1.0,
  steps: 1.6,
  bridleway: 1.1,
  track: 1.15,
  cycleway: 1.3,
  pedestrian: 1.2,
  living_street: 1.5,
  service: 1.7,
  residential: 1.6,
  unclassified: 1.6,
  tertiary: 2.0,
  secondary: 3.0,
};

/**
 * Henter gangbare veger og stier i et utsnitt, til bruk i sti-snapping.
 * @param {[number,number,number,number]} box `[sør, vest, nord, øst]`
 */
export async function fetchWalkableWays(box, { signal, timeout = 20000 } = {}) {
  const [south, west, north, east] = box.map((v) => v.toFixed(5));
  const types = Object.keys(WALKABLE).join('|');
  const query = `[out:json][timeout:40];
way["highway"~"^(${types})$"]["access"!~"^(private|no)$"](${south},${west},${north},${east});
out geom;`;

  const data = await overpass(query, { signal, ttl: 30 * 60 * 1000, timeout });
  return (data?.elements ?? [])
    .filter((way) => way.geometry?.length >= 2 && way.nodes?.length === way.geometry.length)
    .map((way) => ({
      id: way.id,
      nodes: way.nodes,
      geometry: way.geometry.map((g) => ({ lat: g.lat, lon: g.lon })),
      tags: way.tags ?? {},
      weight: WALKABLE[way.tags?.highway] ?? 2.5,
    }));
}
