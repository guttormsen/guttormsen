/**
 * Bilder fra Wikimedia Commons og korte stedsbeskrivelser fra norsk Wikipedia.
 *
 * Begge er frie og åpne, og begge svarer med CORS så lenge `origin=*` er med.
 * Bildene er geotaggede av fotografene selv, så de er ikke garantert å vise
 * akkurat den stien – utvalget siles og rangeres i `photos.js`.
 */
import { request, withQuery } from './http.js';

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const WIKIPEDIA = 'https://no.wikipedia.org/w/api.php';

/** Commons tar maks 10 km radius per søk. */
const MAX_RADIUS_M = 10000;
/**
 * Med metadatafilteret på svarer Commons med 50 treff per søk, uansett hva vi
 * ber om. Derfor deles et område opp i flere søk i stedet for å be om mer.
 */
const MAX_RESULTS = 50;

const stripHtml = (html) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const meta = (extmetadata, key) => stripHtml(extmetadata?.[key]?.value);

function normalise(page) {
  const info = page.imageinfo?.[0];
  const coordinate = page.coordinates?.[0];
  if (!info || !coordinate) return null;
  const extmetadata = info.extmetadata ?? {};
  return {
    id: String(page.pageid ?? page.title),
    title: String(page.title ?? '').replace(/^File:/, ''),
    thumb: info.thumburl ?? info.url,
    width: info.thumbwidth ?? null,
    height: info.thumbheight ?? null,
    lat: coordinate.lat,
    lon: coordinate.lon,
    pageUrl: info.descriptionurl ?? null,
    author: meta(extmetadata, 'Artist') || null,
    license: meta(extmetadata, 'LicenseShortName') || null,
    licenseUrl: extmetadata.LicenseUrl?.value ?? null,
    description: meta(extmetadata, 'ImageDescription') || null,
  };
}

/**
 * Henter alle geotaggede bilder i et område i ett kall.
 * Ett søk dekker hele turlista, i stedet for ett per tur.
 *
 * @param {{lat:number, lon:number}} centre
 * @param {{ radius?: number, limit?: number, width?: number, signal?: AbortSignal }} [options]
 */
export async function fetchPhotosNear(centre, { radius = MAX_RADIUS_M, limit = MAX_RESULTS, width = 480, signal } = {}) {
  const url = withQuery(COMMONS, {
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'geosearch',
    ggscoord: `${centre.lat.toFixed(5)}|${centre.lon.toFixed(5)}`,
    ggsradius: Math.min(MAX_RADIUS_M, Math.round(radius)),
    ggslimit: Math.min(MAX_RESULTS, limit),
    // Navnerom 6 er filer.
    ggsnamespace: 6,
    prop: 'imageinfo|coordinates',
    colimit: 'max',
    iiprop: 'url|extmetadata',
    iiurlwidth: width,
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ImageDescription',
  });

  const data = await request(url, { ttl: 60 * 60 * 1000, signal, timeout: 20000, retries: 1 });
  return Object.values(data?.query?.pages ?? {})
    .map(normalise)
    .filter(Boolean);
}

/**
 * Bilder for et helt kartutsnitt.
 *
 * Ett søk gir bare de femti nærmeste midtpunktet, og i en by ligger de alle i
 * sentrum. Utsnittet deles derfor i fire, slik at også turene i utkanten får
 * bilder. Feiler én del, brukes de andre.
 *
 * @param {[number,number,number,number]} box `[sør, vest, nord, øst]`
 */
export async function fetchAreaPhotos(box, { width = 480, signal } = {}) {
  const [south, west, north, east] = box;
  const quarters = [0.25, 0.75].flatMap((y) =>
    [0.25, 0.75].map((x) => ({ lat: south + (north - south) * y, lon: west + (east - west) * x })),
  );
  // Radius som dekker en firedel med litt overlapp.
  const radius = Math.min(
    MAX_RADIUS_M,
    Math.max(1500, (haversineMeters(south, west, north, east) / 4) * 1.4),
  );

  const batches = await Promise.all(
    quarters.map((centre) => fetchPhotosNear(centre, { radius, width, signal }).catch(() => [])),
  );

  const seen = new Set();
  const photos = [];
  for (const photo of batches.flat()) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    photos.push(photo);
  }
  return photos;
}

/** Diagonalen i et utsnitt, i meter. Holder for å velge søkeradius. */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Søker opp bilder på navn i stedet for på koordinat.
 *
 * Et geosøk finner bare det som er geotagget nær ruta, og mange av de beste
 * bildene er tagget på toppen eller ikke i det hele tatt. Et navnesøk på
 * «Preikestolen» finner dem – men søket er upresist, så kallende kode må
 * kontrollere at treffet faktisk har med turen å gjøre.
 *
 * @param {string} name turens navn
 */
export async function searchPhotosByName(name, { limit = 12, width = 800, signal } = {}) {
  const term = String(name ?? '').trim();
  if (term.length < 3) return [];

  const url = withQuery(COMMONS, {
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${term} filetype:bitmap`,
    gsrnamespace: 6,
    gsrlimit: limit,
    prop: 'imageinfo|coordinates',
    colimit: 'max',
    iiprop: 'url|extmetadata',
    iiurlwidth: width,
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ImageDescription',
  });

  const data = await request(url, { ttl: 24 * 60 * 60 * 1000, signal, timeout: 20000, retries: 1 });
  return Object.values(data?.query?.pages ?? {})
    .map((page) => {
      // Treff fra navnesøk har ofte ingen koordinat; de vurderes på navn alene.
      const info = page.imageinfo?.[0];
      if (!info) return null;
      const extmetadata = info.extmetadata ?? {};
      const coordinate = page.coordinates?.[0];
      return {
        id: String(page.pageid ?? page.title),
        title: String(page.title ?? '').replace(/^File:/, ''),
        thumb: info.thumburl ?? info.url,
        width: info.thumbwidth ?? null,
        height: info.thumbheight ?? null,
        lat: coordinate?.lat ?? null,
        lon: coordinate?.lon ?? null,
        pageUrl: info.descriptionurl ?? null,
        author: meta(extmetadata, 'Artist') || null,
        license: meta(extmetadata, 'LicenseShortName') || null,
        licenseUrl: extmetadata.LicenseUrl?.value ?? null,
        description: meta(extmetadata, 'ImageDescription') || null,
        /** Kom fra navnesøk, ikke fra geosøk. */
        fromSearch: true,
      };
    })
    .filter(Boolean);
}

/**
 * Korte utdrag fra norsk Wikipedia nær et punkt.
 * Kallende kode avgjør om artikkelen faktisk handler om turen.
 *
 * @param {{lat:number, lon:number}} point
 */
export async function fetchNearbyArticles(point, { radius = 3000, limit = 6, signal } = {}) {
  const url = withQuery(WIKIPEDIA, {
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'geosearch',
    ggscoord: `${point.lat.toFixed(5)}|${point.lon.toFixed(5)}`,
    ggsradius: Math.min(10000, Math.round(radius)),
    ggslimit: limit,
    prop: 'extracts|pageimages|coordinates',
    exintro: 1,
    explaintext: 1,
    exsentences: 3,
    pithumbsize: 640,
    colimit: 'max',
  });

  const data = await request(url, { ttl: 24 * 60 * 60 * 1000, signal, timeout: 15000, retries: 1 });
  return Object.values(data?.query?.pages ?? {})
    .filter((page) => page.extract)
    .map((page) => ({
      id: String(page.pageid),
      title: page.title,
      extract: page.extract,
      thumb: page.thumbnail?.source ?? null,
      lat: page.coordinates?.[0]?.lat ?? null,
      lon: page.coordinates?.[0]?.lon ?? null,
      url: `https://no.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    }));
}
