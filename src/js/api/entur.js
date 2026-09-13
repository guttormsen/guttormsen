/**
 * Kollektivtransport fra Entur.
 *
 * Entur samler rutedata for hele Norge og har et åpent API uten nøkkel. Det
 * eneste kravet er at klienten identifiserer seg med `ET-Client-Name`, som
 * nettleseren får lov til å sette. Se https://developer.entur.org/.
 */
import { request } from './http.js';

const ENDPOINT = 'https://api.entur.io/journey-planner/v3/graphql';

/** Entur ber om et navn på formen «organisasjon-app». */
const CLIENT_NAME = 'guttormsen-lykkeligtur';

const QUERY = `
query Reise($fraLat: Float!, $fraLon: Float!, $tilLat: Float!, $tilLon: Float!, $naar: DateTime) {
  trip(
    from: { coordinates: { latitude: $fraLat, longitude: $fraLon } }
    to: { coordinates: { latitude: $tilLat, longitude: $tilLon } }
    dateTime: $naar
    numTripPatterns: 3
    walkSpeed: 1.3
    modes: {
      accessMode: foot
      egressMode: foot
      transportModes: [
        { transportMode: bus }
        { transportMode: rail }
        { transportMode: tram }
        { transportMode: metro }
        { transportMode: water }
      ]
    }
  ) {
    tripPatterns {
      duration
      walkDistance
      startTime
      endTime
      legs {
        mode
        distance
        expectedStartTime
        fromPlace { name }
        toPlace { name }
        line { publicCode name }
      }
    }
  }
}`;

/**
 * Foreslår kollektivreiser fra et sted til et annet.
 *
 * @param {{lat:number, lon:number}} from
 * @param {{lat:number, lon:number}} to
 * @param {{ when?: Date, signal?: AbortSignal }} [options]
 * @returns {Promise<Array<{duration:number, walkDistance:number, start:Date, end:Date, legs:Array<object>}>>}
 */
export async function planJourney(from, to, { when, signal } = {}) {
  const data = await request(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ET-Client-Name': CLIENT_NAME,
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        fraLat: Number(from.lat.toFixed(5)),
        fraLon: Number(from.lon.toFixed(5)),
        tilLat: Number(to.lat.toFixed(5)),
        tilLon: Number(to.lon.toFixed(5)),
        naar: (when ?? new Date()).toISOString(),
      },
    }),
    ttl: 5 * 60 * 1000,
    timeout: 15000,
    retries: 1,
    signal,
  });

  if (data?.errors?.length) {
    throw new Error(data.errors[0]?.message ?? 'Entur svarte med en feil');
  }

  return (data?.data?.trip?.tripPatterns ?? [])
    .map((pattern) => ({
      duration: pattern.duration,
      walkDistance: pattern.walkDistance,
      start: new Date(pattern.startTime),
      end: new Date(pattern.endTime),
      legs: (pattern.legs ?? [])
        // Korte gåstrekk mellom holdeplasser er støy i en oppsummering.
        .filter((leg) => leg.mode !== 'foot' || leg.distance > 300)
        .map((leg) => ({
          mode: leg.mode,
          distance: leg.distance,
          start: leg.expectedStartTime ? new Date(leg.expectedStartTime) : null,
          from: leg.fromPlace?.name ?? null,
          to: leg.toPlace?.name ?? null,
          line: leg.line?.publicCode ?? null,
          lineName: leg.line?.name ?? null,
        })),
    }))
    .filter((pattern) => pattern.legs.some((leg) => leg.mode !== 'foot'));
}

/** Ikon og navn for transportmåtene Entur bruker. */
export const MODES = {
  foot: { icon: '🚶', label: 'Gå' },
  bus: { icon: '🚌', label: 'Buss' },
  rail: { icon: '🚆', label: 'Tog' },
  tram: { icon: '🚋', label: 'Trikk' },
  metro: { icon: '🚇', label: 'T-bane' },
  water: { icon: '⛴️', label: 'Båt' },
};

export const describeMode = (mode) => MODES[mode] ?? { icon: '•', label: mode };

/** Lenke som åpner veibeskrivelse til startpunktet i telefonens kartprogram. */
export const directionsUrl = ({ lat, lon }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lon.toFixed(5)}&travelmode=driving`;
