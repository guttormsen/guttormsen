/**
 * Stedsnavnsøk mot Sentralt stedsnavnregister (SSR) via Geonorge.
 * https://ws.geonorge.no/stedsnavn/v1/
 */
import { request, withQuery } from './http.js';
import { API } from '../config.js';

/** Navneobjekttyper vi prioriterer i trefflista, i den rekkefølgen en turgåer leter. */
const TYPE_RANK = new Map(
  [
    'Fjell',
    'Fjelltopp',
    'Berg',
    'Ås',
    'Hytte',
    'Turisthytte',
    'Dal',
    'Vann',
    'Innsjø',
    'Elv',
    'Foss',
    'Bre',
    'Øy',
    'Fjord',
    'Bruk',
    'Gard',
    'By',
    'Tettsted',
    'Bygd',
    'Grend',
  ].map((name, index) => [name, index]),
);

const rank = (type) => TYPE_RANK.get(type) ?? TYPE_RANK.size;

/**
 * @param {string} query fritekst
 * @param {{ limit?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<Array<{id:string,name:string,type:string,municipality:string,county:string,lat:number,lon:number}>>}
 */
export async function searchPlaces(query, { limit = 8, signal } = {}) {
  const term = query.trim();
  if (term.length < 2) return [];

  // Jokertegn til slutt gir treff mens brukeren fortsatt skriver.
  const url = withQuery(API.stedsnavn, {
    sok: term.endsWith('*') ? term : `${term}*`,
    treffPerSide: Math.min(30, limit * 3),
    side: 1,
    utkoordsys: 4258,
    fuzzy: true,
  });

  const data = await request(url, { ttl: 10 * 60 * 1000, signal, retries: 1 });
  const seen = new Set();

  return (data?.navn ?? [])
    .filter((n) => n.stedstatus === 'aktiv' && n.representasjonspunkt)
    .map((n) => {
      const name = n.skrivemåte ?? '';
      const lower = name.toLowerCase();
      const needle = term.toLowerCase();
      // Skriver du «Gjendesheim» skal Gjendesheim komme før Gjendehalsen,
      // uansett hva slags navneobjekt de er.
      const match = lower === needle ? 0 : lower.startsWith(needle) ? 1 : 2;
      return {
        id: String(n.stedsnummer),
        name,
        type: n.navneobjekttype ?? '',
        municipality: n.kommuner?.[0]?.kommunenavn ?? '',
        county: n.fylker?.[0]?.fylkesnavn ?? '',
        lat: n.representasjonspunkt.nord,
        lon: n.representasjonspunkt.øst,
        match,
        priority: n.navnestatus === 'hovednavn' ? 0 : 1,
      };
    })
    .filter((place) => {
      // Samme navn kan ligge inne på flere språk; vis bare det første.
      const key = `${place.name}|${place.municipality}|${place.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (a.match !== b.match) return a.match - b.match;
      if (a.priority !== b.priority) return a.priority - b.priority;
      const byType = rank(a.type) - rank(b.type);
      if (byType !== 0) return byType;
      return a.name.localeCompare(b.name, 'nb');
    })
    .slice(0, limit);
}
