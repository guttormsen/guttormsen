import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, encodePolyline, tripFromUrl, tripToUrl } from '../src/js/share.js';

const BASE = 'https://example.no/lykkeligtur/';

test('polylinje tåler tur–retur gjennom koding', () => {
  const points = [
    { lat: 61.4934, lon: 8.7186 },
    { lat: 61.5061, lon: 8.5236 },
    { lat: 59.8542, lon: 8.6492 },
  ];
  const decoded = decodePolyline(encodePolyline(points));
  assert.equal(decoded.length, 3);
  decoded.forEach((point, i) => {
    assert.ok(Math.abs(point.lat - points[i].lat) < 1e-5);
    assert.ok(Math.abs(point.lon - points[i].lon) < 1e-5);
  });
});

test('polylinje håndterer negative koordinater', () => {
  const decoded = decodePolyline(encodePolyline([{ lat: -33.8688, lon: 151.2093 }]));
  assert.ok(Math.abs(decoded[0].lat + 33.8688) < 1e-5);
  assert.ok(Math.abs(decoded[0].lon - 151.2093) < 1e-5);
});

test('tom liste gir tom streng', () => {
  assert.equal(encodePolyline([]), '');
  assert.deepEqual(decodePolyline(''), []);
});

test('turen overlever veien gjennom en delbar lenke', () => {
  const trip = {
    name: 'Besseggen',
    waypoints: [
      { lat: 61.4934, lon: 8.7186 },
      { lat: 61.5061, lon: 8.5236 },
    ],
    options: { pace: 'rask', terrain: 'ulendt', snapToTrail: true, packKg: 14 },
  };
  const restored = tripFromUrl(tripToUrl(trip, BASE));
  assert.equal(restored.name, 'Besseggen');
  assert.equal(restored.waypoints.length, 2);
  assert.equal(restored.options.pace, 'rask');
  assert.equal(restored.options.terrain, 'ulendt');
  assert.equal(restored.options.snapToTrail, true);
  assert.equal(restored.options.packKg, 14);
});

test('lenken bruker hash slik at ruta aldri sendes til serveren', () => {
  const url = tripToUrl(
    { name: 'Tur', waypoints: [{ lat: 61, lon: 8 }], options: { pace: 'normal', terrain: 'sti' } },
    BASE,
  );
  assert.ok(url.includes('#'));
  assert.equal(new URL(url).search, '');
});

test('en lenke uten rute gir null', () => {
  assert.equal(tripFromUrl(BASE), null);
  assert.equal(tripFromUrl(`${BASE}#n=Bare%20navn`), null);
});
