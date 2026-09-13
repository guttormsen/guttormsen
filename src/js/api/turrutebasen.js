/**
 * Turrutebasen – den nasjonale databasen over merkede turruter, hentet som
 * WFS fra Geonorge. Dette er de samme rutene som vises i Norgeskart, og de
 * har både navn, merking, gradering og underlag.
 *
 * Tjenesten leverer bare GML. Rutene er flate elementer med én linje hver, så
 * vi henter ut det vi trenger med en målrettet skanner i stedet for å dra inn
 * en full XML-parser (som også ville krevd DOM i testene).
 */
import { request, withQuery } from './http.js';

const WFS = 'https://wfs.geonorge.no/skwms1/wfs.turogfriluftsruter';

/** Maks antall ruter per kall. Nok til et turutsnitt, lite nok til å gå fort. */
const MAX_FEATURES = 400;
/** Turforslag trenger flere biter, siden én tur ofte er mange segmenter. */
const MAX_FEATURES_DISCOVERY = 1200;

const FEATURE_RE = /<app:Fotrute\b[^>]*>([\s\S]*?)<\/app:Fotrute>/g;
const POSLIST_RE = /<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>/g;

function tag(block, name) {
  const match = new RegExp(`<app:${name}>([\\s\\S]*?)</app:${name}>`).exec(block);
  return match ? match[1].trim() : null;
}

/** `"61.556071 8.793838 61.555945 8.793650"` → punktliste. EPSG:4258 er lat lon. */
function parsePosList(text) {
  const numbers = text.trim().split(/\s+/).map(Number);
  const points = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    if (Number.isFinite(numbers[i]) && Number.isFinite(numbers[i + 1])) {
      points.push({ lat: numbers[i], lon: numbers[i + 1] });
    }
  }
  return points;
}

/** Merkingen sier hvor lett ruta er å følge i felt. */
const MERKING = {
  Merket: 'merket',
  Umerket: 'umerket',
  Sesongmerket: 'sesongmerket',
};

/**
 * @param {string} gml
 * @returns {Array<{id:string, points:Array<{lat:number,lon:number}>, name:string|null,
 *                  marking:string|null, grade:string|null, surface:string|null, season:string|null}>}
 */
export function parseFotruter(gml) {
  const routes = [];
  let match;
  FEATURE_RE.lastIndex = 0;

  while ((match = FEATURE_RE.exec(gml))) {
    const block = match[1];
    POSLIST_RE.lastIndex = 0;
    let geometry;
    // En rute kan være en MultiCurve med flere biter; hver bit blir sin egen lenke.
    while ((geometry = POSLIST_RE.exec(block))) {
      const points = parsePosList(geometry[1]);
      if (points.length < 2) continue;
      routes.push({
        id: `${tag(block, 'lokalId') ?? routes.length}-${routes.length}`,
        points,
        name: tag(block, 'rutenavn'),
        number: tag(block, 'rutenummer'),
        marking: MERKING[tag(block, 'merking')] ?? tag(block, 'merking'),
        grade: tag(block, 'gradering'),
        /** Kode for natursti, kyststi, kultursti eller historisk veg. */
        special: tag(block, 'spesialFotrutetype'),
        surface: tag(block, 'underlagstype'),
        season: tag(block, 'sesong'),
        maintainer: tag(block, 'vedlikeholdsansvarlig'),
      });
    }
  }
  return routes;
}

/**
 * Henter fotruter i et utsnitt.
 * @param {[number,number,number,number]} box `[sør, vest, nord, øst]`
 */
export async function fetchFotruter(box, { signal, count = MAX_FEATURES } = {}) {
  // WFS 2.0 med EPSG:4258 tar bbox i rekkefølgen lat, lon.
  const url = withQuery(WFS, {
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'app:Fotrute',
    count,
    bbox: box.map((value) => value.toFixed(5)).join(','),
  });

  const gml = await request(url, { as: 'text', ttl: 30 * 60 * 1000, signal, timeout: 30000, retries: 1 });
  return parseFotruter(gml);
}

/** Som `fetchFotruter`, men henter nok segmenter til å sette sammen hele turer. */
export const fetchFotruterForDiscovery = (box, options = {}) =>
  fetchFotruter(box, { ...options, count: MAX_FEATURES_DISCOVERY });
