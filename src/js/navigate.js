/**
 * Turmodus: hvor er du på ruta, og hvor mye gjenstår.
 *
 * All regning skjer mot den ferdig oppsummerte ruta, som allerede har
 * avstander, høyder og kumulativ gåtid punkt for punkt. Da er det bare å slå
 * opp hvor langt du har kommet.
 *
 * Rene funksjoner – ingen DOM, ingen nettverk.
 */
import { closestPointOnPath, haversine } from './geo.js';

/** Lenger enn dette fra ruta regnes du som utenfor den. */
export const OFF_ROUTE_M = 60;

/**
 * Hvor du er på ruta, og hva som gjenstår.
 *
 * @param {object} summary resultatet fra `summarise()`
 * @param {{lat:number, lon:number, accuracy?:number}} position
 * @returns {{
 *   index: number, fraction: number,
 *   distanceDone: number, distanceLeft: number,
 *   ascentLeft: number, secondsLeft: number,
 *   offRoute: boolean, offRouteDistance: number,
 *   finished: boolean
 * }|null}
 */
export function progressOnRoute(summary, position) {
  if (!summary || summary.line.length < 2 || !position) return null;

  const hit = closestPointOnPath(position, summary.line);
  // `index` peker på segmentets startpunkt; nærmeste punkt er det av de to.
  const next = Math.min(summary.line.length - 1, hit.index + 1);
  const index =
    haversine(position, summary.line[hit.index]) <= haversine(position, summary.line[next])
      ? hit.index
      : next;

  const distanceDone = summary.distances[index];
  const distanceLeft = Math.max(0, summary.distance - distanceDone);

  const total = summary.time.cumulativeSeconds.at(-1) || 0;
  const movingLeft = Math.max(0, total - summary.time.cumulativeSeconds[index]);
  // Pausene fordeles jevnt utover, så anslaget stemmer også midt i turen.
  const share = total > 0 ? movingLeft / total : 0;
  const secondsLeft = movingLeft + summary.time.breakSeconds * share;

  let ascentLeft = 0;
  for (let i = index + 1; i < summary.elevations.length; i++) {
    const rise = summary.elevations[i] - summary.elevations[i - 1];
    if (rise > 0) ascentLeft += rise;
  }

  // Nær nok målet til at det ikke er noe igjen å navigere etter.
  const finished = distanceLeft < 40;

  return {
    index,
    fraction: summary.distance > 0 ? distanceDone / summary.distance : 0,
    distanceDone,
    distanceLeft,
    ascentLeft,
    secondsLeft,
    offRoute: hit.distance > OFF_ROUTE_M,
    offRouteDistance: hit.distance,
    finished,
  };
}

/** Klokkeslettet du er beregnet å være fremme. */
export const arrivalTime = (secondsLeft, now = new Date()) =>
  new Date(now.getTime() + Math.max(0, secondsLeft) * 1000);

/**
 * Det neste av interesse foran deg på ruta.
 * @param {Array<object>} pois severdigheter med `along` satt
 * @param {number} distanceDone
 */
export function nextAhead(pois, distanceDone) {
  if (!pois?.length) return null;
  return (
    pois
      .filter((poi) => poi.along > distanceDone + 25)
      .sort((a, b) => a.along - b.along)[0] ?? null
  );
}

/**
 * Posisjonen din i desimalgrader – formatet nødetatene ber om på telefonen.
 * @param {{lat:number, lon:number, accuracy?:number}} position
 */
export function formatPosition(position) {
  if (!position) return null;
  const lat = position.lat.toFixed(5);
  const lon = position.lon.toFixed(5);
  return {
    text: `${lat}, ${lon}`,
    spoken: `${lat} nord, ${lon} øst`,
    accuracy: Number.isFinite(position.accuracy) ? Math.round(position.accuracy) : null,
    /** Lenke som åpner punktet i et hvilket som helst kartprogram. */
    geoUri: `geo:${lat},${lon}`,
  };
}
