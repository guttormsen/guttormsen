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
  bading: { label: 'Badeplass', icon: '🏊' },
  rasteplass: { label: 'Rasteplass', icon: '🧺' },
  bål: { label: 'Bål og grill', icon: '🔥' },
  vann: { label: 'Drikkevann', icon: '💧' },
  toalett: { label: 'Toalett', icon: '🚻' },
  lek: { label: 'Lekeplass', icon: '🛝' },
  parkering: { label: 'Parkering', icon: '🅿️' },
  kollektiv: { label: 'Kollektiv', icon: '🚌' },
};

function classify(tags = {}) {
  if (tags.tourism === 'alpine_hut' || tags.tourism === 'chalet') return 'hytte';
  if (tags.tourism === 'wilderness_hut' || tags.amenity === 'shelter') return 'gapahuk';
  if (tags.natural === 'peak') return 'topp';
  if (tags.tourism === 'viewpoint') return 'utsikt';
  if (tags.leisure === 'swimming_area' || tags.natural === 'beach' || tags.leisure === 'beach_resort') {
    return 'bading';
  }
  if (tags.tourism === 'picnic_site' || tags.leisure === 'picnic_table') return 'rasteplass';
  if (tags.leisure === 'firepit' || tags.amenity === 'bbq') return 'bål';
  if (tags.amenity === 'drinking_water' || tags.natural === 'spring') return 'vann';
  if (tags.amenity === 'toilets') return 'toalett';
  if (tags.leisure === 'playground') return 'lek';
  if (tags.amenity === 'parking') return 'parkering';
  if (tags.highway === 'bus_stop' || tags.railway === 'station' || tags.public_transport === 'station')
    return 'kollektiv';
  return null;
}

/**
 * Rullestoltilgang slik OpenStreetMap oppgir den.
 * Sier noe om selve fasiliteten, ikke om stien dit.
 */
export function wheelchairAccess(tags = {}) {
  if (tags.wheelchair === 'yes' || tags.wheelchair === 'designated') return 'ja';
  if (tags.wheelchair === 'limited') return 'delvis';
  if (tags.wheelchair === 'no') return 'nei';
  return null;
}

/** Overpass-uttrykk for alt vi kaller en fasilitet. */
const FACILITY_QUERY = (area) => `
  node["tourism"~"^(alpine_hut|wilderness_hut|chalet|viewpoint|picnic_site)$"](${area});
  way["tourism"~"^(alpine_hut|wilderness_hut|chalet|picnic_site)$"](${area});
  node["amenity"~"^(shelter|drinking_water|toilets|bbq|parking)$"](${area});
  way["amenity"~"^(parking|toilets)$"](${area});
  node["leisure"~"^(firepit|picnic_table|swimming_area|playground|beach_resort)$"](${area});
  way["leisure"~"^(swimming_area|playground|beach_resort)$"](${area});
  node["natural"~"^(peak|spring|beach)$"]["name"](${area});
  way["natural"="beach"](${area});
  node["highway"="bus_stop"](${area});
  node["railway"="station"](${area});
`;

/** Gjør et Overpass-element om til en fasilitet vi kan vise. */
function toPoi(element) {
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
    wheelchair: wheelchairAccess(tags),
    /** Noen OSM-objekter peker på et bilde. Brukes når Commons ikke har noe. */
    image: tags.image ?? null,
    commons: tags.wikimedia_commons ?? null,
    fee: tags.fee ?? null,
    /** DNT-hytter har som regel operator som starter med «DNT». */
    dnt: /(^|\s)DNT(\s|$)|Turistforening/i.test(tags.operator ?? ''),
  };
}

/**
 * Severdigheter og fasiliteter innenfor `radius` meter fra ruta.
 * @param {Array<{lat:number,lon:number}>} route
 */
export async function fetchPois(route, { radius = 700, signal } = {}) {
  if (route.length < 1) return [];
  const query = `[out:json][timeout:40];
(${FACILITY_QUERY(`around:${radius},${aroundList(route)}`)});
out center tags 300;`;

  const data = await overpass(query, { signal });
  return dedupe((data?.elements ?? []).map(toPoi).filter(Boolean));
}

/**
 * Alle fasiliteter i et kartutsnitt, i ett kall.
 * Brukes til å merke turforslagene med bading, bål, toalett og kollektivt,
 * uten å spørre Overpass én gang per tur.
 *
 * @param {[number,number,number,number]} box `[sør, vest, nord, øst]`
 */
export async function fetchAreaFacilities(box, { signal } = {}) {
  const area = box.map((value) => value.toFixed(5)).join(',');
  const query = `[out:json][timeout:60];
(${FACILITY_QUERY(area)});
out center tags 2000;`;

  const data = await overpass(query, { signal, timeout: 60000 });
  return dedupe((data?.elements ?? []).map(toPoi).filter(Boolean));
}

/** Samme sted kartlagt både som node og flate skal bare telle én gang. */
function dedupe(pois) {
  const seen = new Set();
  return pois.filter((poi) => {
    const key = `${poi.kind}|${poi.name}|${poi.lat.toFixed(3)}|${poi.lon.toFixed(3)}`;
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
