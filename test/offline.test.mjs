import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TILES, downloadTiles, estimateBytes, tileUrl, tilesForRoute, zoomsForRoute } from '../src/js/offline.js';

/** Kort rute i Jotunheimen. */
const route = [
  { lat: 61.49, lon: 8.81 },
  { lat: 61.496, lon: 8.84 },
];

test('dekker ruta med fliser på hvert zoomnivå', () => {
  const tiles = tilesForRoute(route, { zooms: [13] });
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every((t) => t.z === 13));
  // Flisene skal ligge i et sammenhengende rutenett.
  const xs = new Set(tiles.map((t) => t.x));
  const ys = new Set(tiles.map((t) => t.y));
  assert.equal(tiles.length, xs.size * ys.size);
});

test('flere zoomnivåer gir flere fliser', () => {
  const ett = tilesForRoute(route, { zooms: [13] }).length;
  const to = tilesForRoute(route, { zooms: [13, 14] }).length;
  assert.ok(to > ett);
});

test('høyere zoom gir flere fliser over samme område', () => {
  const lav = tilesForRoute(route, { zooms: [12] }).length;
  const høy = tilesForRoute(route, { zooms: [15] }).length;
  assert.ok(høy > lav, `${høy} skal være flere enn ${lav}`);
});

test('bufferen legger til fliser rundt ruta', () => {
  const uten = tilesForRoute(route, { zooms: [15], buffer: 0 }).length;
  const med = tilesForRoute(route, { zooms: [15], buffer: 2000 }).length;
  assert.ok(med > uten);
});

test('y teller nordfra, så nordligste punkt gir lavest y', () => {
  const nord = tilesForRoute([{ lat: 70, lon: 20 }], { zooms: [10], buffer: 0 })[0];
  const sør = tilesForRoute([{ lat: 58, lon: 20 }], { zooms: [10], buffer: 0 })[0];
  assert.ok(nord.y < sør.y);
});

test('tom rute gir ingen fliser', () => {
  assert.deepEqual(tilesForRoute([]), []);
  assert.deepEqual(tilesForRoute(null), []);
});

test('lange ruter tas ned på lavere zoom, så det ikke blir uendelig mange', () => {
  assert.deepEqual(zoomsForRoute(3000), [12, 13, 14, 15]);
  assert.deepEqual(zoomsForRoute(20000), [11, 12, 13, 14]);
  assert.deepEqual(zoomsForRoute(60000), [10, 11, 12, 13]);
});

test('en dagstur holder seg under grensa', () => {
  const dagstur = [
    { lat: 61.3, lon: 8.5 },
    { lat: 61.45, lon: 8.9 },
  ];
  const tiles = tilesForRoute(dagstur, { zooms: zoomsForRoute(20000) });
  assert.ok(tiles.length < MAX_TILES, `${tiles.length} fliser`);
});

test('flismalen fylles ut', () => {
  assert.equal(
    tileUrl('https://x/{z}/{y}/{x}.png', { z: 12, x: 3, y: 4 }),
    'https://x/12/4/3.png',
  );
});

test('anslaget vokser med antall fliser', () => {
  assert.ok(estimateBytes(100) > estimateBytes(10));
});

/** Mellomlager som holder styr på hva som er lagt inn. */
function fakeCache() {
  const store = new Map();
  return {
    store,
    match: async (url) => store.get(url),
    put: async (url, response) => store.set(url, response),
  };
}

test('laster ned det som mangler og hopper over det som ligger der', async () => {
  const cache = fakeCache();
  cache.store.set('b', { ok: true });
  const hentet = [];
  globalThis.fetch = async (url) => {
    hentet.push(url);
    return { ok: true, headers: new Map([['content-length', '1000']]), clone: () => ({}) };
  };
  // Map har get, men Headers har get – begge svarer på .get.
  const result = await downloadTiles(['a', 'b', 'c'], { cache, concurrency: 1 });
  assert.deepEqual(hentet.sort(), ['a', 'c']);
  assert.equal(result.saved, 2);
  assert.equal(result.failed, 0);
});

test('teller feil uten å gi opp resten', async () => {
  const cache = fakeCache();
  globalThis.fetch = async (url) => {
    if (url === 'b') throw new Error('nede');
    return { ok: true, headers: new Map([['content-length', '10']]), clone: () => ({}) };
  };
  const result = await downloadTiles(['a', 'b', 'c'], { cache, concurrency: 1 });
  assert.equal(result.saved, 2);
  assert.equal(result.failed, 1);
});

test('melder framdrift for hver flis', async () => {
  const cache = fakeCache();
  globalThis.fetch = async () => ({ ok: true, headers: new Map(), clone: () => ({}) });
  const steps = [];
  await downloadTiles(['a', 'b'], { cache, concurrency: 1, onProgress: (done, total) => steps.push(`${done}/${total}`) });
  assert.deepEqual(steps, ['1/2', '2/2']);
});

test('avbryter når brukeren sier stopp', async () => {
  const cache = fakeCache();
  const controller = new AbortController();
  globalThis.fetch = async () => {
    controller.abort();
    return { ok: true, headers: new Map(), clone: () => ({}) };
  };
  const result = await downloadTiles(['a', 'b', 'c', 'd'], {
    cache,
    concurrency: 1,
    signal: controller.signal,
  });
  assert.ok(result.saved <= 1, `stoppet etter ${result.saved}`);
});
