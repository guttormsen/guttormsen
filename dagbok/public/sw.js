/**
 * Service worker: appen skal åpne seg med én gang, også på dårlig nett.
 *
 * Ingenting under /api/ mellomlagres. Dagene forfatterens skal ikke bli liggende i
 * et cachelager på telefonen lenger enn nødvendig, og en gammel tilstand er
 * verre enn ingen tilstand.
 */
const LAGER = 'dagbok-v2';
const SKALL = ['./', 'index.html', 'app.css', 'app.js', 'api.js', 'manifest.webmanifest', 'ikoner/glass.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(LAGER).then((c) => c.addAll(SKALL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((navn) => Promise.all(navn.filter((n) => n !== LAGER).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Svar fra lageret med én gang, men hent ferskt i bakgrunnen – ellers kan en
  // installert app bli stående på gammel kode til service workeren byttes ut.
  e.respondWith(
    caches.open(LAGER).then(async (lager) => {
      const lagret = await lager.match(e.request, { ignoreSearch: true });
      const ferskt = fetch(e.request)
        .then((svar) => {
          if (svar.ok) lager.put(e.request, svar.clone());
          return svar;
        })
        .catch(() => lagret);
      return lagret || ferskt;
    }),
  );
});
