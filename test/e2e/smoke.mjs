/**
 * Røyktest i ekte nettleser: starter en lokal server, åpner appen og går
 * gjennom hovedflyten – finn en tur, velg den, se vær og høydeprofil, før den
 * i dagboka – mot de ekte tjenestene.
 *
 *   node test/e2e/smoke.mjs [--headed] [--shots <mappe>]
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : join(ROOT, 'test', 'e2e', 'shots');

/** Bergen: her har Turrutebasen god dekning, så turforslagene er forutsigbare. */
const TEST_VIEW = { lat: 60.39, lon: 5.33, zoom: 12 };

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
// omdirigere trafikken dens. Den slås av her.
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
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    } catch {
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
page.on('dialog', (dialog) => dialog.accept());
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error' && !FLAKY.test(message.text())) errors.push(message.text());
});

const goToTestView = (target) =>
  target.evaluate(
    ({ lat, lon, zoom }) => window.lykkeligtur.view.map.setView([lat, lon], zoom),
    TEST_VIEW,
  );

await mkdir(SHOTS, { recursive: true });

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => Boolean(window.lykkeligtur), null, { timeout: 15000 });
    check('appen starter', true);
  } catch (error) {
    check('appen starter', false, errors.slice(0, 4).join(' | ') || String(error).split('\n')[0]);
    throw error;
  }

  check('appen åpner på turforslag', await page.locator('.tab[data-tab="finn"].is-active').count() === 1);
  check('tegneknappene er skjult uten rute', await page.locator('#draw-tools').isHidden());

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
  const firstHit = await page.textContent('#search-results li .search__name');
  check('stedsnavnsøk gir treff', /Gjendesheim/i.test(firstHit ?? ''), firstHit ?? '');
  await page.keyboard.press('Escape');

  /* Turforslag fra Turrutebasen */
  await goToTestView(page);
  await page.waitForTimeout(900);
  await page.click('#btn-search-here');
  await page.waitForSelector('.card', { timeout: 120000 });
  const cardCount = await page.locator('.card').count();
  const firstName = await page.locator('.card__name').first().textContent();
  check('turforslag hentes fra Turrutebasen', cardCount > 5, `${cardCount} turer, første «${firstName}»`);

  const mapHeight = await page.evaluate(() => Math.round(document.querySelector('#map').getBoundingClientRect().height));
  check('kartet holder seg innenfor skjermen', mapHeight <= 860, `${mapHeight} px høyt`);

  /* Høyder fyller ut kortene */
  await page.waitForFunction(() => document.querySelector('.spark') != null, null, { timeout: 90000 });
  const facts = await page.locator('.card__facts').first().textContent();
  check('kortene får stigning og tid', /opp/.test(facts ?? ''), (facts ?? '').trim());

  /* Filtrering */
  await page.click('.chip--toggle:has-text("Kort tur")');
  await page.waitForTimeout(300);
  const shortOnly = await page.evaluate(() =>
    window.lykkeligtur.state.discovery.visible.every((trip) => trip.length < 3000),
  );
  const shortCount = await page.locator('.card').count();
  check('lengdefilter virker', shortOnly && shortCount > 0, `${shortCount} korte turer`);

  await page.click('.chip--toggle:has-text("Rundtur")');
  await page.waitForTimeout(300);
  const loopsOnly = await page.evaluate(() =>
    window.lykkeligtur.state.discovery.visible.every((trip) => trip.loop && trip.length < 3000),
  );
  check('flere filtre kombineres', loopsOnly);

  await page.click('.linkish:has-text("Nullstill filtre")');
  await page.waitForTimeout(300);
  check('filtrene kan nullstilles', (await page.locator('.card').count()) === cardCount);

  /* Bilder fra Wikimedia Commons */
  await page
    .waitForFunction(() => document.querySelector('.card__photo img')?.complete === true, null, { timeout: 60000 })
    .catch(() => {});
  const cardPhotos = await page.locator('.card__photo img').count();
  check('turkortene får bilder', cardPhotos > 0, `${cardPhotos} kort med bilde`);
  if (cardPhotos) {
    const credit = await page.locator('.card__photo .photo__credit').first().textContent();
    check('bildene oppgir fotograf og lisens', Boolean(credit?.trim()), credit?.trim().slice(0, 50));
  }

  await page.screenshot({ path: join(SHOTS, 'finn-tur.png') });

  /* Velg en tur */
  const picked = await page.locator('.card__name').first().textContent();
  await page.locator('.card').first().click();
  await page.waitForFunction(() => window.lykkeligtur.state.summary?.hasElevation === true, null, { timeout: 60000 });
  check('tur kan velges fra kortet', (await page.locator('.tab[data-tab="turen"].is-active').count()) === 1, picked ?? '');

  const summary = await page.evaluate(() => {
    const s = window.lykkeligtur.state.summary;
    return { distance: s.distance, ascent: s.ascent, seconds: s.time.totalSeconds, samples: s.line.length };
  });
  check('høyder hentes fra Kartverket', summary.samples > 5, `${summary.samples} punkter`);
  check('tidsestimat beregnes', summary.seconds > 0, `${Math.round(summary.seconds / 60)} min`);
  check('nøkkeltall vises', (await page.locator('.stat__value').count()) === 4);
  check('høydeprofilen tegnes', (await page.locator('.profile__seg').count()) > 3);
  check('tegneknappene dukker opp', await page.locator('#draw-tools').isVisible());

  /* Bildegalleri i turvisningen */
  const gallery = await page
    .waitForSelector('.photo--lead img', { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  check(
    'turen får et bildegalleri',
    gallery,
    gallery ? `${await page.locator('.gallery__thumb').count()} småbilder` : 'ingen bilder i området',
  );

  /* Vær */
  await page.waitForSelector('.weather__row', { timeout: 60000 });
  check('vær langs ruta hentes fra MET', (await page.locator('.weather__row').count()) >= 2);

  /* Avanserte valg er skjult til man ber om dem */
  const advanced = page.locator('.block--fold:has(> summary:text("Avansert"))');
  check('avanserte valg ligger sammenslått', await page.locator('#opt-snap').isHidden());
  await advanced.locator('summary').click();
  await page.waitForTimeout(200);
  check('avanserte valg kan åpnes', await page.locator('#opt-snap').isVisible());
  await advanced.locator('summary').click();

  // Rull til toppen, så skjermbildet viser turen slik man møter den.
  await page.locator('.panes').evaluate((node) => { node.scrollTop = 0; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, 'turen.png') });

  /* Dagbok */
  await page.click('.btn:has-text("Jeg gikk denne")');
  await page.waitForTimeout(400);
  check('turen føres i dagboka', (await page.locator('.tab[data-tab="dagbok"].is-active').count()) === 1);
  const totals = await page.locator('.totals .stat__value').allTextContents();
  check('dagboka summerer turen', totals[0] === '1', totals.join(' / '));
  check('første merke er oppnådd', (await page.locator('.badge.is-earned').count()) >= 1);
  await page.screenshot({ path: join(SHOTS, 'dagbok.png') });

  /* Kartlag */
  await page.click('#btn-layers');
  await page.waitForSelector('#layer-popover input[value="topograatone"]');
  await page.check('#layer-popover input[value="topograatone"]');
  await page.waitForTimeout(1500);
  const grayscale = await page.evaluate(() =>
    [...document.querySelectorAll('.leaflet-tile')].some((img) => img.src.includes('topograatone')),
  );
  check('bakgrunnskart kan byttes', grayscale);
  await page.keyboard.press('Escape');

  /* Deling og GPX */
  const shareUrl = await page.evaluate(async () => {
    const { tripToUrl } = await import('./src/js/share.js');
    return tripToUrl(window.lykkeligtur.state.trip);
  });
  check('delbar lenke inneholder ruta', shareUrl.includes('#r='));
  const gpx = await page.evaluate(async () => {
    const { buildGpx } = await import('./src/js/gpx.js');
    const s = window.lykkeligtur.state.summary;
    return buildGpx({ name: 'Røyktest', line: s.line, elevations: s.elevations });
  });
  check('GPX bygges med høyder', gpx.includes('<trkpt') && gpx.includes('<ele>'));

  /* Tegn egen rute */
  await page.click('.tab[data-tab="finn"]');
  await page.click('#btn-clear');
  await page.waitForTimeout(400);
  const box = await page.locator('#map').boundingBox();
  const topAt = (fx, fy) =>
    page.evaluate(
      ([px, py]) => {
        const node = document.elementFromPoint(px, py);
        return node ? `${node.tagName.toLowerCase()}.${node.className?.baseVal ?? node.className ?? ''}`.slice(0, 40) : 'ingen';
      },
      [box.x + box.width * fx, box.y + box.height * fy],
    );
  const cover = [await topAt(0.3, 0.35), await topAt(0.6, 0.6)];
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35);
  await page.waitForTimeout(600);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  let drawn = { waypoints: 0, distance: null };
  try {
    await page.waitForFunction(() => window.lykkeligtur.state.summary?.distance > 100, null, { timeout: 30000 });
    drawn = await page.evaluate(() => ({
      waypoints: window.lykkeligtur.state.trip.waypoints.length,
      distance: Math.round(window.lykkeligtur.state.summary?.distance ?? 0),
    }));
  } catch {
    drawn = await page.evaluate(() => ({
      waypoints: window.lykkeligtur.state.trip.waypoints.length,
      distance: Math.round(window.lykkeligtur.state.summary?.distance ?? 0),
    }));
  }
  check(
    'egen rute kan tegnes i kartet',
    drawn.distance > 100 && (await page.locator('.tab[data-tab="turen"].is-active').count()) === 1,
    `${drawn.waypoints} punkter, ${drawn.distance} m (traff ${cover.join(' / ')})`,
  );

  /* Mobil */
  const phone = await browser.newContext({
    ...contextOptions,
    viewport: { width: 390, height: 780 },
    isMobile: true,
    hasTouch: true,
  });
  await relayExternalRequests(phone);
  const mobile = await phone.newPage();
  await mobile.goto(base, { waitUntil: 'domcontentloaded' });
  await mobile.waitForFunction(() => Boolean(window.lykkeligtur), null, { timeout: 20000 });
  await goToTestView(mobile);
  await mobile.waitForTimeout(1500);

  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('ingen vannrett rulling på mobil', overflow <= 1, `${overflow} px`);
  check('fanene er synlige i sammenslått bunnark', await mobile.locator('.tab[data-tab="finn"]').isVisible());

  await mobile.click('#sheet-handle');
  await mobile.waitForTimeout(400);
  check('bunnarket kan åpnes', (await mobile.locator('#panel.is-open').count()) === 1);

  const tapTargets = await mobile.evaluate(() =>
    [...document.querySelectorAll('.tab, .map-btn, .pill, .btn')]
      .filter((node) => node.offsetParent !== null)
      .map((node) => Math.round(node.getBoundingClientRect().height)),
  );
  const smallest = Math.min(...tapTargets);
  check('trykkflatene er store nok', smallest >= 36, `minste ${smallest} px av ${tapTargets.length}`);

  await mobile.click('#btn-search-here');
  await mobile.waitForSelector('.card', { timeout: 120000 });
  check('turforslag virker på mobil', (await mobile.locator('.card').count()) > 3);
  await mobile.screenshot({ path: join(SHOTS, 'mobil.png') });
  await phone.close();

  /* Mørk modus */
  const dark = await browser.newContext({
    ...contextOptions,
    viewport: { width: 1280, height: 860 },
    colorScheme: 'dark',
  });
  await relayExternalRequests(dark);
  const darkPage = await dark.newPage();
  await darkPage.goto(`${base}#${new URL(shareUrl).hash.slice(1)}`, { waitUntil: 'domcontentloaded' });
  await darkPage.waitForFunction(() => window.lykkeligtur?.state.summary != null, null, { timeout: 40000 });
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
console.log(`Skjermbilder: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
