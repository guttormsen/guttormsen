/**
 * Ren geometri på WGS84-koordinater. Ingen DOM, ingen nettverk – enkelt å teste.
 * Punkter representeres som `{ lat, lon }`; høyde legges på som `ele` der den finnes.
 */

const R = 6371008.8; // jordas middelradius i meter (IUGG)
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Avstand i meter mellom to punkter langs jordoverflaten. */
export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Samlet lengde av en linje i meter. */
export function pathLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += haversine(points[i - 1], points[i]);
  return sum;
}

/** Kumulativ avstand fra start for hvert punkt. */
export function cumulativeDistances(points) {
  const out = new Array(points.length);
  out[0] = 0;
  for (let i = 1; i < points.length; i++) out[i] = out[i - 1] + haversine(points[i - 1], points[i]);
  return out;
}

/** Kompasskurs fra a til b i grader (0 = nord). */
export function bearing(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
export const compassPoint = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

/** Punkt en gitt brøkdel ut på strekningen a–b (lineær interpolasjon). */
export function interpolate(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/**
 * Legger inn ekstra punkter slik at ingen strekning er lengre enn `spacing` meter.
 * Brukes før høydeoppslag, så profilen følger terrenget og ikke bare knekkpunktene.
 */
export function densify(points, spacing) {
  if (points.length < 2 || !(spacing > 0)) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(haversine(a, b) / spacing));
    for (let s = 1; s <= steps; s++) out.push(s === steps ? b : interpolate(a, b, s / steps));
  }
  return out;
}

/** Jevner ut en tallrekke med glidende gjennomsnitt (±`radius` naboer). */
export function smooth(values, radius = 2) {
  if (radius < 1) return values.slice();
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      if (Number.isFinite(values[j])) {
        sum += values[j];
        count++;
      }
    }
    return count ? sum / count : values[i];
  });
}

/** Omsluttende boks som `[sørLat, vestLon, nordLat, østLon]`, med valgfri margin i meter. */
export function bbox(points, padMeters = 0) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }
  if (padMeters > 0) {
    const dLat = (padMeters / R) * (180 / Math.PI);
    const midLat = toRad((south + north) / 2);
    const dLon = dLat / Math.max(0.01, Math.cos(midLat));
    south -= dLat;
    north += dLat;
    west -= dLon;
    east += dLon;
  }
  return [south, west, north, east];
}

/**
 * Nærmeste punkt på strekningen a–b, målt fra p.
 * Regner i et lokalt planprojisert rom – nøyaktig nok på turskala.
 */
export function closestPointOnSegment(p, a, b) {
  const kx = Math.cos(toRad(p.lat));
  const ax = (a.lon - p.lon) * kx;
  const ay = a.lat - p.lat;
  const bx = (b.lon - p.lon) * kx;
  const by = b.lat - p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  const point = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
  return { point, t, distance: haversine(p, point) };
}

/** Nærmeste punkt på en hel linje, med indeks for segmentet det traff. */
export function closestPointOnPath(p, points) {
  let best = { distance: Infinity, index: 0, point: points[0], t: 0 };
  for (let i = 1; i < points.length; i++) {
    const hit = closestPointOnSegment(p, points[i - 1], points[i]);
    if (hit.distance < best.distance) best = { ...hit, index: i - 1 };
  }
  return best;
}

/** Douglas–Peucker-forenkling. `tolerance` i meter. */
export function simplify(points, tolerance = 10) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = closestPointOnSegment(points[i], points[start], points[end]).distance;
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }
    if (maxDist > tolerance && maxIndex > 0) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
