/**
 * Røyktest i ekte nettleser: starter en lokal server, åpner appen, tegner en rute
 * og sjekker at nøkkeltall, høydeprofil og vær faktisk fylles ut.
 *
 *   node test/e2e/smoke.mjs [--headed] [--shots <mappe>]
 */
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : join(ROOT, 'test', 'e2e', 'shots');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serve() {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const file = join(ROOT, normalize(path === '/' ? '/index.html' : path));
    if (!file.startsWith(ROOT)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('ikke funnet');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FEIL '} ${name}${detail ? ` – ${detail}` : ''}`);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  headless: !process.argv.includes('--headed'),
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
// Service workeren tar over nettverket i nettleseren, og Playwright kan ikke
// omdirigere trafikken dens. Den slås av her; den testes for seg i sw-testen.
const contextOptions = { locale: 'nb-NO', serviceWorkers: 'block' };

/**
 * I sandkassede miljøer når ikke nettleseren ut på egen hånd, mens Node gjør det.
 * Vi lar derfor Node hente alt som ligger utenfor testserveren, og leverer svaret
 * tilbake til siden. Testen treffer fortsatt de ekte tjenestene.
 */
async function relayExternalRequests(target) {
  await target.route('**/*', async (route) => {
    const request = route.request();
    if (request.url().startsWith(base)) return route.continue();
    try {
      const response = await fetch(request.url(), {
        method: request.method(),
        headers: Object.fromEntries(
          Object.entries(request.headers()).filter(([key]) => !key.startsWith(':') && key !== 'host'),
        ),
        body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postData() ?? undefined,
        redirect: 'follow',
      });
      const headers = Object.fromEntries(response.headers.entries());
      delete headers['content-encoding'];
      delete headers['content-length'];
      headers['access-control-allow-origin'] = '*';
      await route.fulfill({
        status: response.status,
        headers,
        body: Buffer.from(await response.arrayBuffer()),
      });
    } catch (error) {
      await route.abort('failed');
    }
  });
}

const context = await browser.newContext({ ...contextOptions, viewport: { width: 1280, height: 860 } });
await relayExternalRequests(context);
const page = await context.newPage();

/**
 * Overpass og andre dugnadstjenester svarer med 504 når de er travle. Appen
 * håndterer det, så nettleserens egen «failed to load»-melding er ikke en feil
 * i appen – vi ser bort fra den, men beholder alle ekte JavaScript-feil.
 */
const FLAKY = /Failed to load resource|net::ERR|ERR_FAILED/i;
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error' && !FLAKY.test(message.text())) errors.push(message.text());
});

await mkdir(SHOTS, { recursive: true });

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => Boolean(window.turplan), null, { timeout: 15000 });
    check('appen starter', true);
  } catch (error) {
    check('appen starter', false, errors.slice(0, 4).join(' | ') || String(error).split('\n')[0]);
    throw error;
  }

  /* Bakgrunnskart fra Kartverket */
  await page.waitForFunction(
    () => [...document.querySelectorAll('.leaflet-tile')].some((img) => img.complete && img.naturalWidth > 0),
    null,
    { timeout: 25000 },
  );
  const tileHosts = await page.evaluate(() =>
    [...document.querySelectorAll('.leaflet-tile')].map((img) => new URL(img.src).hostname),
  );
  check('kartfliser fra Kartverket lastes', tileHosts.includes('cache.kartverket.no'), tileHosts[0]);

  /* Stedsnavnsøk */
  await page.fill('#search-input', 'Gjendesheim');
  await page.waitForSelector('#search-results li', { timeout: 15000 });
  const first = await page.textContent('#search-results li .search__name');
  check('stedsnavnsøk gir treff', /Gjendesheim/i.test(first ?? ''), first ?? '');
  await page.click('#search-results li');
  await page.waitForTimeout(1200);

  /* Tegn en rute: søket satte startpunktet, vi legger til ett punkt til */
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.4);
  await page.waitForTimeout(400);
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.62);

  await page.waitForFunction(() => window.turplan.state.summary?.hasElevation === true, null, {
    timeout: 30000,
  });
  const summary = await page.evaluate(() => {
    const s = window.turplan.state.summary;
    return {
      distance: s.distance,
      ascent: s.ascent,
      seconds: s.time.totalSeconds,
      samples: s.line.length,
      grade: s.grade.label,
    };
  });
  check('ruta får lengde', summary.distance > 100, `${Math.round(summary.distance)} m`);
  check('høyder hentes fra Kartverket', summary.ascent >= 0 && summary.samples > 10, `${summary.samples} punkter`);
  check('tidsestimat beregnes', summary.seconds > 0, `${Math.round(summary.seconds / 60)} min`);

  const statValues = await page.locator('.stat__value').allTextContents();
  check('nøkkeltall vises i panelet', statValues.length === 4 && statValues.every(Boolean), statValues.join(' / '));

  const segments = await page.locator('.profile__seg').count();
  check('høydeprofilen tegnes', segments > 5, `${segments} segmenter`);

  /* Hover på profilen skal markere punktet i kartet */
  const profileBox = await page.locator('.profile__svg').boundingBox();
  await page.mouse.move(profileBox.x + profileBox.width * 0.5, profileBox.y + profileBox.height * 0.5);
  await page.waitForTimeout(300);
  check('profilmarkør vises i kartet', (await page.locator('.leaflet-interactive').count()) > 0);

  /* Vær */
  await page.click('.tab[data-tab="vaer"]');
  await page.waitForSelector('.weather__row', { timeout: 30000 });
  const rows = await page.locator('.weather__row').count();
  check('vær langs ruta hentes fra MET', rows >= 2, `${rows} sjekkpunkter`);

  /* Sikkerhet */
  await page.click('.tab[data-tab="sikkerhet"]');
  await page.waitForSelector('.checklist li', { timeout: 10000 });
  check('fjellvettreglene vises', (await page.locator('.checklist li').count()) === 9);

  /* Kartlag */
  await page.click('.tab[data-tab="kart"]');
  await page.check('input[value="topograatone"]');
  await page.waitForTimeout(1500);
  const grayscale = await page.evaluate(() =>
    [...document.querySelectorAll('.leaflet-tile')].some((img) => img.src.includes('topograatone')),
  );
  check('bakgrunnskart kan byttes', grayscale);

  /* Deling */
  await page.click('.tab[data-tab="plan"]');
  await page.fill('#trip-name', 'Røyktest');
  const shareUrl = await page.evaluate(async () => {
    const { tripToUrl } = await import('./src/js/share.js');
    return tripToUrl(window.turplan.state.trip);
  });
  check('delbar lenke inneholder ruta', shareUrl.includes('#r='), shareUrl.slice(0, 60));

  const restored = await page.evaluate(async (url) => {
    const { tripFromUrl } = await import('./src/js/share.js');
    return tripFromUrl(url)?.waypoints.length ?? 0;
  }, shareUrl);
  check('lenken kan leses tilbake', restored === (await page.evaluate(() => window.turplan.state.trip.waypoints.length)));

  /* GPX */
  const gpx = await page.evaluate(async () => {
    const { buildGpx } = await import('./src/js/gpx.js');
    const s = window.turplan.state.summary;
    return buildGpx({ name: 'Røyktest', line: s.line, elevations: s.elevations });
  });
  check('GPX bygges med høyder', gpx.includes('<trkpt') && gpx.includes('<ele>'));

  await page.screenshot({ path: join(SHOTS, 'desktop.png'), fullPage: false });

  /*
   * «Følg sti» testes i Nordmarka. Turrutebasen har ujevn dekning – i deler av
   * høyfjellet finnes det ingen kartlagte ruter, og da skal appen falle tilbake
   * til rett strek. Her velger vi et område der vi vet det finnes data.
   */
  const snapPage = await context.newPage();
  const snapHash = await page.evaluate(async () => {
    const { encodePolyline } = await import('./src/js/share.js');
    return `r=${encodeURIComponent(
      encodePolyline([
        { lat: 60.01, lon: 10.68 },
        { lat: 60.025, lon: 10.705 },
      ]),
    )}&s=1&n=Snapping`;
  });
  await snapPage.goto(`${base}#${snapHash}`, { waitUntil: 'domcontentloaded' });
  await snapPage.waitForFunction(
    () => window.turplan?.state.trip.legs.length > 0 && window.turplan.state.trip.legs.every((leg) => !leg.pending),
    null,
    { timeout: 90000 },
  );
  const leg = await snapPage.evaluate(() => {
    const first = window.turplan.state.trip.legs[0];
    return { snapped: first.snapped, points: first.points.length };
  });
  check(
    'følg sti legger ruta langs stinettet',
    leg.snapped && leg.points > 10,
    `${leg.points} punkter, snappet=${leg.snapped}`,
  );
  await snapPage.waitForTimeout(1500);
  await snapPage.screenshot({ path: join(SHOTS, 'folg-sti.png') });
  await snapPage.close();

  /* Mørk modus */
  const dark = await browser.newContext({
    ...contextOptions,
    viewport: { width: 1280, height: 860 },
    colorScheme: 'dark',
  });
  await relayExternalRequests(dark);
  const darkPage = await dark.newPage();
  await darkPage.goto(`${base}#${new URL(shareUrl).hash.slice(1)}`, { waitUntil: 'domcontentloaded' });
  await darkPage.waitForFunction(() => window.turplan?.state.summary != null, null, { timeout: 40000 });
  await darkPage.waitForTimeout(2500);
  const bg = await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('mørk modus bruker mørk bakgrunn', bg === 'rgb(20, 22, 26)', bg);
  await darkPage.screenshot({ path: join(SHOTS, 'morkt.png') });
  await dark.close();

  check('ingen JavaScript-feil i konsollen', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  check('testen kjørte ferdig', false, String(error).split('\n')[0]);
  await page.screenshot({ path: join(SHOTS, 'feil.png') }).catch(() => {});
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} sjekker gikk gjennom.`);
if (await stat(SHOTS).catch(() => null)) console.log(`Skjermbilder: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
