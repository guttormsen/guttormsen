/**
 * Service worker for Lykkelig tur.
 *
 * Appen skal virke i fjellet, der det ofte ikke er dekning. Selve appen
 * forhåndslagres, og kartfliser og API-svar du allerede har sett beholdes
 * slik at ruta du planla hjemme fortsatt kan leses på tur.
 */

const VERSION = 'v1';
const SHELL = `lykkeligtur-shell-${VERSION}`;
const TILES = `lykkeligtur-tiles-${VERSION}`;
const DATA = `lykkeligtur-data-${VERSION}`;

/** Maks antall kartfliser vi tar vare på (ca. 40–60 MB). */
const TILE_LIMIT = 1200;

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/css/app.css',
  'src/js/main.js',
  'src/js/config.js',
  'src/js/util.js',
  'src/js/geo.js',
  'src/js/route.js',
  'src/js/state.js',
  'src/js/map.js',
  'src/js/profile.js',
  'src/js/panels.js',
  'src/js/search.js',
  'src/js/snap.js',
  'src/js/trips.js',
  'src/js/journal.js',
  'src/js/photos.js',
  'src/js/share.js',
  'src/js/gpx.js',
  'src/js/ui.js',
  'src/js/weather.js',
  'src/js/api/http.js',
  'src/js/api/stedsnavn.js',
  'src/js/api/hoydedata.js',
  'src/js/api/met.js',
  'src/js/api/varsom.js',
  'src/js/api/overpass.js',
  'src/js/api/turrutebasen.js',
  'src/js/api/commons.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// Bilder og kartfliser hentes én gang og blir liggende – de endrer seg ikke.
const TILE_HOSTS = ['cache.kartverket.no', 'wms.geonorge.no', 'upload.wikimedia.org', 'thumb.wikimedia.org'];
const DATA_HOSTS = [
  'ws.geonorge.no',
  'wfs.geonorge.no',
  'api.met.no',
  'api01.nve.no',
  'commons.wikimedia.org',
  'no.wikipedia.org',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Enkeltfiler kan feile (f.eks. bak en proxy) uten at hele installasjonen ryker.
      .then((cache) => Promise.allSettled(SHELL_FILES.map((file) => cache.add(file))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => ![SHELL, TILES, DATA].includes(key)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Holder flislageret under grensen ved å kaste de eldste oppføringene. */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (limit) trim(cacheName, limit);
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, TILES, TILE_LIMIT).catch(() => Response.error()));
    return;
  }

  if (DATA_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(request, DATA));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navigasjon: vis appen fra lageret når nettet er borte.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('index.html', { ignoreSearch: true })),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => hit ?? fetch(request).catch(() => caches.match('index.html'))),
  );
});
