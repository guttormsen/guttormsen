/**
 * Høyder fra Kartverkets nasjonale høydemodell (DTM1, 1 m laserdata der den finnes).
 * https://ws.geonorge.no/hoydedata/v1/
 */
import { request, withQuery } from './http.js';
import { API, ELEVATION_BATCH } from '../config.js';
import { mapLimit } from '../util.js';

/** Rundes til ~1 m oppløsning så mellomlageret treffer på gjentatte oppslag. */
const cacheKey = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
const elevationCache = new Map();

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Slår opp terrenghøyde for en liste punkter.
 * Kartverket tar maks 50 punkter per kall; vi kjører 3 kall i parallell.
 *
 * @param {Array<{lat:number,lon:number}>} points
 * @param {{ signal?: AbortSignal, onProgress?: (done:number,total:number)=>void }} [options]
 * @returns {Promise<Array<number|null>>} høyde i meter, `null` der Kartverket ikke har data
 */
export async function fetchElevations(points, { signal, onProgress } = {}) {
  if (!points.length) return [];

  const result = new Array(points.length).fill(null);
  const missing = [];
  points.forEach((point, index) => {
    const cached = elevationCache.get(cacheKey(point));
    if (cached !== undefined) result[index] = cached;
    else missing.push({ point, index });
  });

  const batches = chunk(missing, ELEVATION_BATCH);
  let done = 0;

  await mapLimit(batches, 3, async (batch) => {
    const url = withQuery(API.hoydedata, {
      punkter: JSON.stringify(batch.map(({ point }) => [point.lon, point.lat])),
      koordsys: 4258,
      geojson: false,
    });
    try {
      const data = await request(url, { ttl: 60 * 60 * 1000, signal, timeout: 20000 });
      (data?.punkter ?? []).forEach((entry, i) => {
        const target = batch[i];
        if (!target) return;
        const z = Number.isFinite(entry?.z) ? entry.z : null;
        result[target.index] = z;
        elevationCache.set(cacheKey(target.point), z);
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      // Én tapt bolk skal ikke felle hele profilen – hullene fylles ved interpolasjon.
      console.warn('Høydeoppslag feilet for én bolk', error);
    }
    done += batch.length;
    onProgress?.(Math.min(done, missing.length), missing.length);
  });

  return result;
}

/** Høyde for ett enkelt punkt. */
export async function fetchElevation(point, options) {
  const [z] = await fetchElevations([point], options);
  return z;
}
