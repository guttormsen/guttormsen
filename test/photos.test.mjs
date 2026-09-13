import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  articleMatches,
  attachPhotos,
  buildPhotoIndex,
  isLikelyPhoto,
  photosForTrip,
  scorePhoto,
  significantWords,
} from '../src/js/photos.js';

const photo = (id, title, lat, lon, extra = {}) => ({
  id,
  title,
  lat,
  lon,
  thumb: `https://example.org/${id}.jpg`,
  width: 480,
  height: 320,
  ...extra,
});

test('significantWords dropper fyllord og korte ord', () => {
  assert.deepEqual(significantWords('Turen rundt Nøklevann'), ['nøklevann']);
  assert.deepEqual(significantWords('Blåmerket sti Østmarka'), ['østmarka']);
  assert.deepEqual(significantWords('Fløyveien til Rundemannen'), ['fløyveien', 'rundemannen']);
  assert.deepEqual(significantWords(''), []);
});

test('isLikelyPhoto slipper gjennom foto og stopper kart og logoer', () => {
  assert.equal(isLikelyPhoto('File:Preikestolen 2004.jpg'), true);
  assert.equal(isLikelyPhoto('Fløyen utsikt.JPEG'), true);
  assert.equal(isLikelyPhoto('Nøklevann.svg'), false);
  assert.equal(isLikelyPhoto('Kart over Østmarka.png'), false);
  assert.equal(isLikelyPhoto('Bergen kommune våpen.png'), false);
  assert.equal(isLikelyPhoto('Coat of arms of Tromsø.jpg'), false);
  assert.equal(isLikelyPhoto('Turkart Jotunheimen.jpg'), false);
});

test('isLikelyPhoto forveksler ikke stedsnavn med kartord', () => {
  // «Kartverkethuset» og «Skiltebakken» inneholder ordene, men ikke som egne ord.
  assert.equal(isLikelyPhoto('Kartverkethuset i Hønefoss.jpg'), true);
  assert.equal(isLikelyPhoto('Skiltebakken 4.jpg'), true);
});

test('isLikelyPhoto luker ut motiver ingen leter etter på tur', () => {
  assert.equal(isLikelyPhoto('Vallhall Arena, 2017.jpg'), false, 'komma skal telle som ordgrense');
  assert.equal(isLikelyPhoto('Furuset Forum (bilde 02).jpg'), false, 'parentes skal telle som ordgrense');
  assert.equal(isLikelyPhoto('Military tank near Stavanger Airport.jpg'), false);
  assert.equal(isLikelyPhoto('Smalvann (april 2024).jpg'), true);
  assert.equal(isLikelyPhoto('View from Dalsnuten.jpg'), true);
});

test('naturmotiv vinner over et tilfeldig gatebilde like i nærheten', () => {
  const words = [];
  const natur = scorePhoto(photo('a', 'Utsikt fra toppen.jpg', 0, 0), { words, distance: 200 });
  const gate = scorePhoto(photo('b', 'Storgata 14.jpg', 0, 0), { words, distance: 200 });
  assert.ok(natur > gate, `${natur} skal slå ${gate}`);
});

test('uten navnetreff må bildet ligge tett på ruta', () => {
  const words = significantWords('Fløyveien');
  assert.equal(scorePhoto(photo('a', 'Et hus.jpg', 0, 0), { words, distance: 400, radius: 500 }), 0);
  assert.ok(scorePhoto(photo('b', 'Et hus.jpg', 0, 0), { words, distance: 200, radius: 500 }) > 0);
  // Med navnetreff får bildet være lenger unna.
  assert.ok(scorePhoto(photo('c', 'Fløyveien.jpg', 0, 0), { words, distance: 400, radius: 500 }) > 0);
});

test('scorePhoto lar navnetreff slå nærhet', () => {
  const words = significantWords('Preikestolen');
  const nærtUtenNavn = scorePhoto(photo('a', 'Lysefjorden.jpg', 0, 0), { words, distance: 10 });
  const lengerMedNavn = scorePhoto(photo('b', 'Preikestolen i tåke.jpg', 0, 0), { words, distance: 400 });
  assert.ok(lengerMedNavn > nærtUtenNavn, `${lengerMedNavn} skal slå ${nærtUtenNavn}`);
});

test('scorePhoto forkaster det som ligger for langt unna eller ikke er foto', () => {
  const words = significantWords('Fløyen');
  assert.equal(scorePhoto(photo('a', 'Fløyen.jpg', 0, 0), { words, distance: 900, radius: 500 }), 0);
  assert.equal(scorePhoto(photo('b', 'Kart Fløyen.png', 0, 0), { words, distance: 10 }), 0);
});

test('scorePhoto favoriserer liggende bilder', () => {
  const words = [];
  const liggende = scorePhoto(photo('a', 'Utsikt.jpg', 0, 0, { width: 480, height: 320 }), { words, distance: 100 });
  const stående = scorePhoto(photo('b', 'Utsikt.jpg', 0, 0, { width: 320, height: 480 }), { words, distance: 100 });
  assert.ok(liggende > stående);
});

test('scorePhoto bruker også bildebeskrivelsen', () => {
  const words = significantWords('Stoltzekleiven');
  const medTekst = scorePhoto(
    photo('a', 'IMG_2043.jpg', 0, 0, { description: 'Trappene opp Stoltzekleiven en høstdag' }),
    { words, distance: 300 },
  );
  assert.ok(medTekst > 100, `fikk ${medTekst}`);
});

/* ---------- Kobling til turer ---------- */

const trip = {
  name: 'Fløyveien',
  points: [
    { lat: 60.3900, lon: 5.3300 },
    { lat: 60.3950, lon: 5.3350 },
    { lat: 60.4000, lon: 5.3400 },
  ],
};

test('photosForTrip finner bilder langs hele ruta', () => {
  const photos = [
    photo('nær-start', 'Utsikt fra Fløyveien.jpg', 60.3901, 5.3301),
    photo('nær-slutt', 'Skogen.jpg', 60.3999, 5.3399),
    photo('langt-unna', 'Fløyveien.jpg', 61.0, 6.0),
  ];
  const found = photosForTrip(buildPhotoIndex(photos), trip);
  const ids = found.map((p) => p.id);
  assert.ok(ids.includes('nær-start'));
  assert.ok(ids.includes('nær-slutt'));
  assert.ok(!ids.includes('langt-unna'));
  assert.equal(ids[0], 'nær-start', 'navnetreffet skal ligge først');
});

test('photosForTrip gir tom liste uten treff', () => {
  assert.deepEqual(photosForTrip(buildPhotoIndex([photo('x', 'Oslo.jpg', 59.9, 10.7)]), trip), []);
  assert.deepEqual(photosForTrip(buildPhotoIndex([]), trip), []);
  assert.deepEqual(photosForTrip(buildPhotoIndex([]), { name: 'Tom', points: [] }), []);
});

test('photosForTrip teller hvert bilde én gang, med sin beste posisjon', () => {
  const photos = [photo('a', 'Fløyveien.jpg', 60.3950, 5.3350)];
  const found = photosForTrip(buildPhotoIndex(photos), trip);
  assert.equal(found.length, 1);
  assert.ok(found[0].distance < 100);
});

test('attachPhotos gir naboturer hvert sitt toppbilde', () => {
  const trips = [
    { id: 't1', name: 'Rute A', points: [{ lat: 60.39, lon: 5.33 }] },
    { id: 't2', name: 'Rute B', points: [{ lat: 60.3901, lon: 5.3301 }] },
  ];
  const photos = [
    photo('p1', 'Fjellet.jpg', 60.39, 5.33),
    photo('p2', 'Vannet.jpg', 60.3902, 5.3302),
  ];
  const [a, b] = attachPhotos(trips, photos);
  assert.ok(a.photo && b.photo);
  assert.notEqual(a.photo.id, b.photo.id);
});

test('attachPhotos lar turer uten treff være urørt', () => {
  const trips = [{ id: 't1', name: 'Rute', points: [{ lat: 65.0, lon: 12.0 }] }];
  assert.equal(attachPhotos(trips, [photo('p', 'Bergen.jpg', 60.39, 5.33)])[0].photo, undefined);
  assert.equal(attachPhotos(trips, [])[0].photo, undefined);
});

/* ---------- Wikipedia ---------- */

test('articleMatches krever at artikkelen deler navn med turen', () => {
  assert.equal(articleMatches('Fløyfjellet (vei)', 'Fløyveien til Fløyfjellet'), true);
  assert.equal(articleMatches('Preikestolen', 'Preikestolen fra Preikestolhytta'), true);
  assert.equal(articleMatches('TUIL Arena', 'Tromsdalstinden'), false);
  assert.equal(articleMatches('Nøklevann', 'Blåmerket sti Østmarka'), false);
  assert.equal(articleMatches('Hva som helst', ''), false);
});
