/**
 * Kobler geotaggede bilder til turer.
 *
 * Et rent geografisk søk gir mye rart: kart, kommunevåpen, bilder av en
 * fotballstadion i nabodalen. Her siles det bort, og det som er igjen rangeres
 * etter hvor godt det passer turen – både i navn og i avstand fra ruta.
 *
 * Rene funksjoner – ingen DOM, ingen nettverk.
 */
import { haversine } from './geo.js';

/** Hvor langt fra ruta et bilde kan ligge og fortsatt sies å være «fra turen». */
export const PHOTO_RADIUS_M = 500;

/**
 * Filnavn som nesten aldri er et turbilde.
 * `\p{L}*kart` fanger også sammensetninger som «turkart» og «sjøkart», men
 * ikke ord som bare begynner på kart – «Kartverkethuset» er en bygning.
 */
const NOT_A_PHOTO =
  /(^|[\s_-])(\p{L}*kart|map|karte|plan|logo|v[åa]pen|coat[\s_-]of[\s_-]arms|arms|seal|flag|diagram|graf|chart|skisse|skilt|plakat|poster|portrait|portrett|scan|faksimile|dokument|brev|frimerke|mynt|ic[oó]n)(?![\p{L}\p{N}])/iu;

/**
 * Motiver som er geotagget i nærheten, men som ingen leter etter når de skal
 * på tur: kjøpesentre, stadioner, blader og kontorbygg.
 */
const NOT_OUTDOORS =
  /(?<![\p{L}\p{N}])(magazine|magasin|blad|cover|omslag|arena|stadion|stadium|forum|hall|kj[øo]pesenter|storsenter|senter|senteret|terminal|fabrikk|industri|kontor|butikk|interi[øo]r|parkeringshus|airport|lufthavn|tank|milit[æa]r|aircraft|helikopter)(?![\p{L}\p{N}])/iu;

/**
 * Ord som tyder på at bildet faktisk viser natur. Gir et lite løft, slik at et
 * utsiktsbilde vinner over et tilfeldig gatebilde like i nærheten.
 */
const OUTDOORS =
  /(?<![\p{L}\p{N}])(fjell|fjellet|vann|vannet|tjern|tj[øo]rn|utsikt|view|panorama|skog|sti|stien|foss|bre|breen|topp|toppen|dal|dalen|strand|fjord|sj[øo]|nature|natur|landscape|landskap|hike|hiking|trail|mountain|forest|lake|sunset|solnedgang|myr|hytte|varde)(?![\p{L}\p{N}])/iu;

/** Ord som ikke sier noe om hvilken tur et bilde hører til. */
const STOP_WORDS = new Set([
  'sti', 'stien', 'tur', 'turen', 'turvei', 'turveg', 'løype', 'loype', 'rute', 'ruta',
  'rundt', 'til', 'fra', 'og', 'over', 'ved', 'i', 'på', 'pa', 'den', 'det', 'de',
  'nord', 'sør', 'sor', 'øst', 'ost', 'vest', 'nedre', 'øvre', 'ovre', 'gamle', 'nye',
  'merket', 'blåmerket', 'blamerket', 'rundtur', 'kommune',
]);

/** Deler et turnavn i ord det er verdt å kjenne igjen. */
export function significantWords(name) {
  return String(name ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

/** Er filnavnet i det hele tatt et fotografi? */
export function isLikelyPhoto(title) {
  const name = String(title ?? '').replace(/^File:/i, '');
  if (!/\.(jpe?g|png|webp)$/i.test(name)) return false;
  const stem = name.replace(/\.[^.]+$/, '');
  return !NOT_A_PHOTO.test(stem) && !NOT_OUTDOORS.test(stem);
}

/**
 * Poeng for hvor godt et bilde passer en tur.
 * Navnetreff veier tyngst; nærhet skiller mellom bilder som ellers er like.
 *
 * @returns {number} høyere er bedre, 0 betyr «ikke aktuelt»
 */
export function scorePhoto(photo, { words, distance, radius = PHOTO_RADIUS_M }) {
  if (!isLikelyPhoto(photo.title)) return 0;
  if (distance > radius) return 0;

  const haystack = `${photo.title} ${photo.description ?? ''}`.toLowerCase();
  const hits = words.filter((word) => haystack.includes(word)).length;

  // Uten navnetreff må bildet ligge tett på ruta for å telle som «fra turen».
  if (hits === 0 && distance > radius * 0.6) return 0;

  const proximity = 1 - distance / radius;
  const nature = OUTDOORS.test(haystack) ? 25 : 0;
  // Liggende bilder fyller kortene pent; stående får et lite fratrekk.
  const shape = photo.width && photo.height && photo.width >= photo.height ? 1 : 0.85;
  return (hits * 100 + nature + proximity * 40 + 1) * shape;
}

/**
 * Legger bildene i et grovt rutenett, så oppslag langs en rute blir raskt.
 * Uten dette må hver tur sammenlignes med hvert bilde.
 */
export function buildPhotoIndex(photos, radius = PHOTO_RADIUS_M) {
  const cell = radius / 111320;
  const grid = new Map();
  for (const photo of photos) {
    if (!Number.isFinite(photo.lat) || !Number.isFinite(photo.lon)) continue;
    const key = `${Math.floor(photo.lat / cell)},${Math.floor(photo.lon / (cell * 2))}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(photo);
  }
  return { grid, cell };
}

/** Bildene i og rundt cellen et punkt ligger i. */
function near({ grid, cell }, point) {
  const row = Math.floor(point.lat / cell);
  const column = Math.floor(point.lon / (cell * 2));
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const bucket = grid.get(`${row + dr},${column + dc}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

/**
 * Finner de beste bildene for én tur.
 *
 * @param {object} index fra `buildPhotoIndex`
 * @param {{name: string, points: Array<{lat:number,lon:number}>}} trip
 * @param {{ radius?: number, limit?: number, samples?: number }} [options]
 */
export function photosForTrip(index, trip, { radius = PHOTO_RADIUS_M, limit = 6, samples = 24 } = {}) {
  const words = significantWords(trip.name);
  const points = trip.points ?? [];
  if (!points.length) return [];

  // Ruta prøves i noen punkter framfor hvert eneste – nok til å dekke traseen.
  const step = Math.max(1, Math.floor(points.length / samples));
  const best = new Map();

  for (let i = 0; i < points.length; i += step) {
    const point = points[i];
    for (const photo of near(index, point)) {
      const distance = haversine(point, photo);
      const score = scorePhoto(photo, { words, distance, radius });
      if (score <= 0) continue;
      const previous = best.get(photo.id);
      if (!previous || score > previous.score) best.set(photo.id, { ...photo, score, distance });
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Vurderer treff fra et navnesøk, der bildet ofte mangler koordinat.
 *
 * Søket er upresist – «Preikestolen» kan gi «Panorama of Lysefjord». Derfor
 * kreves et ekte navnetreff i tittel eller beskrivelse, og ligger bildet
 * langt fra ruta forkastes det selv om navnet stemmer.
 *
 * @param {Array<object>} candidates fra `searchPhotosByName`
 * @param {{name: string, points: Array<{lat:number,lon:number}>}} trip
 * @param {{ maxDistance?: number, limit?: number }} [options]
 */
export function photosFromSearch(candidates, trip, { maxDistance = 15000, limit = 6 } = {}) {
  const words = significantWords(trip.name);
  if (!words.length) return [];
  const middle = trip.points?.[Math.floor((trip.points?.length ?? 1) / 2)];

  return candidates
    .map((photo) => {
      if (!isLikelyPhoto(photo.title)) return null;
      const haystack = `${photo.title} ${photo.description ?? ''}`.toLowerCase();
      const hits = words.filter((word) => haystack.includes(word)).length;
      if (!hits) return null;

      // Har bildet koordinat, må det ligge i samme landskap som turen.
      let distance = null;
      if (middle && Number.isFinite(photo.lat) && Number.isFinite(photo.lon)) {
        distance = haversine(middle, photo);
        if (distance > maxDistance) return null;
      }
      const shape = photo.width && photo.height && photo.width >= photo.height ? 1 : 0.85;
      // Et navnetreff med bekreftet posisjon er det beste vi kan få.
      const confirmed = distance != null ? 60 : 0;
      return { ...photo, distance, score: (hits * 120 + confirmed) * shape };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Slår sammen to bildelister uten duplikater, best først. */
export function mergePhotos(...lists) {
  const seen = new Set();
  return lists
    .flat()
    .filter((photo) => {
      if (!photo || seen.has(photo.id)) return false;
      seen.add(photo.id);
      return true;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Fordeler bilder på turer. Samme bilde kan passe flere turer, men hver tur får
 * ikke det samme toppbildet som naboturen – da blir lista ensformig.
 *
 * @returns {Array<object>} turene med `photo` og `photos` fylt ut
 */
export function attachPhotos(trips, photos, { radius = PHOTO_RADIUS_M } = {}) {
  if (!photos?.length) return trips;
  const index = buildPhotoIndex(photos, radius);
  const claimed = new Set();

  return trips.map((trip) => {
    const found = photosForTrip(index, trip, { radius });
    if (!found.length) return trip;
    const lead = found.find((photo) => !claimed.has(photo.id)) ?? found[0];
    claimed.add(lead.id);
    return { ...trip, photo: lead, photos: found };
  });
}

/**
 * Passer en Wikipedia-artikkel til turen, eller ikke?
 * Uten navnetreff blir det fort en fotballstadion i nabodalen.
 */
export function articleMatches(title, tripName) {
  const words = significantWords(tripName);
  if (!words.length) return false;
  const haystack = String(title ?? '').toLowerCase();
  return words.some((word) => haystack.includes(word));
}
