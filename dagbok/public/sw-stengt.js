/**
 * Service worker som bare finnes for å fjerne seg selv.
 *
 * Serveren sender denne i stedet for sw.js når appen er stengt. En kopi som
 * ligger installert i en nettleser fra før, oppdager den ved neste besøk,
 * installerer den – og da er det siste den gjør å rydde bort alt: lagrene,
 * registreringen, og til slutt laste vinduene på nytt så de møter serveren
 * direkte og ser at det står stengt.
 *
 * Den har med vilje ingen `fetch`-lytter. Det er ingenting den skal svare på.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const navn = await caches.keys();
    await Promise.all(navn.map((n) => caches.delete(n)));
    await self.clients.claim();
    await self.registration.unregister();
    const vinduer = await self.clients.matchAll({ type: 'window' });
    for (const v of vinduer) {
      try { await v.navigate(v.url); } catch { /* vinduet er borte, og da er det greit */ }
    }
  })());
});
