/**
 * Ta med kartet på tur.
 *
 * I fjellet er det ofte ikke dekning, og et kart som må lastes ned mens du
 * står der er ikke et kart. Her regner vi ut hvilke kartfliser som dekker ruta
 * og legger dem i samme mellomlager som service workeren bruker, slik at de
 * ligger klare når nettet er borte.
 */

/** Hvor mange meter på hver side av ruta vi tar med. */
const BUFFER_M = 700;

/** Flere enn dette er for mye å be Kartverket om på én gang. */
export const MAX_TILES = 900;

/**
 * Navnet service workeren gir flis-mellomlageret. Det er med vilje uten
 * versjonsnummer: et nedlastet kart skal overleve at appen oppdateres.
 */
const TILE_CACHE = 'lykkeligtur-tiles';

/** Lengdegrad → flis-x på et zoomnivå. */
const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);

/** Breddegrad → flis-y på et zoomnivå (Web Mercator). */
function latToY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

/**
 * Omtrentlig buffer i grader. Lengdegrader blir smalere jo lenger nord man er,
 * og i Norge er den forskjellen stor nok til å måtte tas med.
 */
function bufferDegrees(lat, meters) {
  const north = meters / 111320;
  const east = meters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { north, east };
}

/**
 * Flisene som dekker ruta, på hvert zoomnivå i `zooms`.
 *
 * @param {Array<{lat:number,lon:number}>} points
 * @param {{ zooms?: number[], buffer?: number }} [options]
 * @returns {{z:number,x:number,y:number}[]}
 */
export function tilesForRoute(points, { zooms = [12, 13, 14, 15], buffer = BUFFER_M } = {}) {
  if (!points?.length) return [];

  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const point of points) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
  }
  const pad = bufferDegrees((south + north) / 2, buffer);
  south = Math.max(-85, south - pad.north);
  north = Math.min(85, north + pad.north);
  west = Math.max(-180, west - pad.east);
  east = Math.min(180, east + pad.east);

  const tiles = [];
  for (const z of zooms) {
    const xMin = lonToX(west, z);
    const xMax = lonToX(east, z);
    // y vokser sørover, så nord gir det laveste tallet.
    const yMin = latToY(north, z);
    const yMax = latToY(south, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) tiles.push({ z, x, y });
    }
  }
  return tiles;
}

/** Fyller ut `{z}`, `{x}` og `{y}` i en flismal. */
export const tileUrl = (template, { z, x, y }) =>
  template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

/**
 * Zoomnivåene det er verdt å ta med for en rute av denne lengden.
 * Lange ruter dekker mye areal, og da eksploderer antallet fliser.
 */
export function zoomsForRoute(distanceMeters) {
  if (distanceMeters > 40000) return [10, 11, 12, 13];
  if (distanceMeters > 15000) return [11, 12, 13, 14];
  return [12, 13, 14, 15];
}

/** Åpner flis-mellomlageret service workeren bruker. */
export async function openTileCache(cacheStorage = globalThis.caches) {
  if (!cacheStorage) return null;
  return cacheStorage.open(TILE_CACHE);
}

/**
 * Henter flisene og legger dem i mellomlageret, noen om gangen.
 *
 * Kartverket er et fellesgode. Vi henter fire i slengen, hopper over det som
 * allerede ligger der, og gir oss med én gang brukeren avbryter.
 *
 * @param {string[]} urls
 * @param {{ onProgress?: (done: number, total: number) => void, signal?: AbortSignal, concurrency?: number }} [options]
 * @returns {Promise<{ saved: number, failed: number, bytes: number }>}
 */
export async function downloadTiles(urls, { onProgress, signal, concurrency = 4, cache } = {}) {
  const store = cache ?? (await openTileCache());
  if (!store) throw new Error('Nettleseren har ikke mellomlager for kartfliser');

  let done = 0;
  let saved = 0;
  let failed = 0;
  let bytes = 0;
  let next = 0;

  async function worker() {
    while (next < urls.length) {
      if (signal?.aborted) return;
      const url = urls[next++];
      try {
        // Ligger flisa der fra før, er det ingenting å hente.
        const hit = await store.match(url);
        if (!hit) {
          const response = await fetch(url, { mode: 'cors', signal });
          if (response.ok) {
            bytes += Number(response.headers.get('content-length')) || 0;
            await store.put(url, response.clone());
            saved++;
          } else {
            failed++;
          }
        }
      } catch {
        if (signal?.aborted) return;
        failed++;
      }
      done++;
      onProgress?.(done, urls.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return { saved, failed, bytes };
}

/** Grov anslått størrelse: Kartverkets flisbilder ligger rundt 25 kB. */
export const estimateBytes = (tileCount) => tileCount * 25 * 1024;
