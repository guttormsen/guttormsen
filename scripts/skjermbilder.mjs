/**
 * Tar bilde av hver skjerm i appen på telefonstørrelse, og sier fra om noe
 * stikker utenfor skjermen eller havner bak bunnarket.
 *
 * Røyktesten sjekker at ting virker. Denne er for å se hvordan det ser ut.
 *
 *   node scripts/skjermbilder.mjs [--bredde 390] [--hoyde 780] [--ut mappe]
 */
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const OUT = flag('ut', join(ROOT, 'test', 'e2e', 'shots'));
const SIZE = { width: Number(flag('bredde', 390)), height: Number(flag('hoyde', 780)) };

/** Bergen: her har Turrutebasen god dekning, så turforslagene er forutsigbare. */
const TEST_VIEW = { lat: 60.39, lon: 5.33, zoom: 12 };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = await new Promise((resolve) => {
  const instance = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const file = join(ROOT, normalize(path === '/' ? '/index.html' : path));
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('ikke funnet');
    }
  });
  instance.listen(0, '127.0.0.1', () => resolve(instance));
});
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const context = await browser.newContext({
  locale: 'nb-NO',
  serviceWorkers: 'block',
  viewport: SIZE,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

// I sandkassede miljøer når ikke nettleseren ut på egen hånd, mens Node gjør det.
await context.route('**/*', async (route) => {
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

const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
await mkdir(OUT, { recursive: true });

/** Innhold som stikker utenfor skjermen eller gjemmer seg bak bunnarket. */
const problems = () =>
  page.evaluate(() => {
    const bad = [];
    const panel = document.querySelector('#panel').getBoundingClientRect();
    for (const node of document.querySelectorAll('button, a, input, h1, h2, h3, p, li')) {
      if (node.offsetParent === null) continue;
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Bildestripa og knapperaden rulles sidelengs med vilje.
      const scroller = node.closest('.gallery, .panel__buttons');
      if (!scroller && (box.right > window.innerWidth + 1 || box.left < -1)) {
        bad.push(`utenfor bredden: ${node.tagName}.${node.className}`);
      }
      const inMap = node.closest('.map-wrap') && !node.closest('.leaflet-control') && !node.closest('.popover');
      if (inMap && box.top > panel.top && panel.top < window.innerHeight) {
        bad.push(`bak arket: ${node.tagName}.${node.className}`);
      }
    }
    return bad;
  });

let step = 0;
async function shot(name) {
  step += 1;
  const file = join(OUT, `skjerm-${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  const found = await problems();
  console.log(`${String(step).padStart(2, '0')} ${name.padEnd(16)} ${found.length ? found.join(' | ') : 'ok'}`);
}

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.lykkeligtur), null, { timeout: 20000 });
await page.waitForTimeout(500);
await shot('velkommen');
await page.evaluate(() => document.querySelector('#intro .btn')?.click());
await page.evaluate(({ lat, lon, zoom }) => window.lykkeligtur.view.map.setView([lat, lon], zoom), TEST_VIEW);
await page.waitForSelector('.card', { timeout: 120000 });
await page.waitForTimeout(2500);
await shot('finn');

await page.tap('.chip--toggle:has-text("Filtre")');
await page.waitForTimeout(600);
await shot('filtre');
await page.evaluate(() => document.querySelector('.filters__foot .btn').click());
await page.waitForTimeout(800);

await page.evaluate(() => window.lykkeligtur.sheet.go('peek'));
await page.waitForTimeout(500);
const pick = await page.evaluate(() => {
  const trip = window.lykkeligtur.state.discovery.visible[0];
  const middle = trip.points[Math.floor(trip.points.length / 2)];
  window.lykkeligtur.view.map.setView([middle.lat, middle.lon], 15, { animate: false });
  const point = window.lykkeligtur.view.map.latLngToContainerPoint([middle.lat, middle.lon]);
  return { x: point.x, y: point.y };
});
await page.waitForTimeout(700);
const mapBox = await page.locator('#map').boundingBox();
await page.touchscreen.tap(mapBox.x + pick.x, mapBox.y + pick.y);
await page.waitForTimeout(1200);
await shot('forhandsvisning');

await page.waitForSelector('.preview__pick', { timeout: 30000 });
await page.evaluate(() => document.querySelector('.preview__pick').click());
await page.waitForFunction(() => window.lykkeligtur.state.trip.waypoints.length === 2, null, { timeout: 30000 });
await page.waitForTimeout(5000);
await shot('turen');

await page.evaluate(() => window.lykkeligtur.sheet.go('full'));
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.panes').scrollTo(0, 800));
await page.waitForTimeout(400);
await shot('turen-midt');

await page.evaluate(() => window.lykkeligtur.startNavigation());
await page.waitForTimeout(1200);
await shot('turmodus');
await page.evaluate(() => window.lykkeligtur.stopNavigation());
await page.waitForTimeout(600);

await page.tap('.tab[data-tab="dagbok"]');
await page.waitForTimeout(600);
await shot('dagbok');

await page.tap('.tab[data-tab="finn"]');
await page.waitForTimeout(400);
await page.evaluate(() => window.lykkeligtur.sheet.go('peek'));
await page.waitForTimeout(400);
await page.tap('#btn-draw');
await page.waitForTimeout(500);
await shot('tegnemodus');
await page.tap('#btn-draw');

await page.waitForTimeout(400);
await page.tap('#btn-layers');
await page.waitForTimeout(500);
await shot('kartlag');
await page.keyboard.press('Escape');

await page.waitForTimeout(400);
await page.fill('#search-input', 'Gjendesheim');
await page.waitForSelector('#search-results li', { timeout: 20000 });
await page.waitForTimeout(400);
await shot('sok');

console.log(errors.length ? `JavaScript-feil: ${errors.join(' | ')}` : 'Ingen JavaScript-feil.');
console.log(`Bilder: ${OUT}`);
await browser.close();
server.close();
