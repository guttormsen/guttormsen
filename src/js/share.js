/**
 * Delbare lenker. Turen pakkes inn i selve URL-en, så det trengs ingen server
 * og lenken virker like lenge som nettsiden gjør.
 *
 * Veipunktene kodes med Googles polylinjeformat (5 desimalers presisjon,
 * ca. 1 m) fordi det gir korte lenker som tåler å bli limt inn i en SMS.
 */

const PRECISION = 1e5;

export function encodePolyline(points) {
  let lastLat = 0;
  let lastLon = 0;
  let out = '';

  const chunk = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>>= 5;
    }
    out += String.fromCharCode(v + 63);
  };

  for (const point of points) {
    const lat = Math.round(point.lat * PRECISION);
    const lon = Math.round(point.lon * PRECISION);
    chunk(lat - lastLat);
    chunk(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return out;
}

export function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / PRECISION, lon: lon / PRECISION });
  }
  return points;
}

/**
 * Bygger en delbar lenke. Bare veipunktene deles – etappene bygges opp igjen
 * hos mottakeren, slik at lenken holder seg kort.
 */
export function tripToUrl(trip, base = location.href) {
  const url = new URL(base);
  url.hash = '';
  url.search = '';
  const params = new URLSearchParams();
  if (trip.waypoints.length) params.set('r', encodePolyline(trip.waypoints));
  if (trip.name) params.set('n', trip.name);
  params.set('p', trip.options.pace);
  params.set('t', trip.options.terrain);
  if (trip.options.snapToTrail) params.set('s', '1');
  if (trip.options.packKg !== 8) params.set('k', String(trip.options.packKg));
  url.hash = params.toString();
  return url.toString();
}

/** Leser en tur ut av en URL-hash. Returnerer `null` når det ikke er noen tur der. */
export function tripFromUrl(href = location.href) {
  const hash = new URL(href).hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const encoded = params.get('r');
  if (!encoded) return null;

  let waypoints;
  try {
    waypoints = decodePolyline(encoded);
  } catch {
    return null;
  }
  if (!waypoints.length) return null;

  const packKg = Number(params.get('k'));
  return {
    name: params.get('n') ?? '',
    waypoints,
    options: {
      pace: params.get('p') ?? undefined,
      terrain: params.get('t') ?? undefined,
      snapToTrail: params.get('s') === '1',
      ...(Number.isFinite(packKg) && packKg > 0 ? { packKg } : {}),
    },
  };
}
