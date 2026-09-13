import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bbox,
  bearing,
  closestPointOnPath,
  compassPoint,
  cumulativeDistances,
  densify,
  haversine,
  pathLength,
  simplify,
  smooth,
} from '../src/js/geo.js';

const GJENDESHEIM = { lat: 61.4934, lon: 8.7186 };
const MEMURUBU = { lat: 61.5061, lon: 8.5236 };

test('haversine treffer kjent avstand i Jotunheimen', () => {
  // Gjendesheim–Memurubu i luftlinje er ca. 10,7 km.
  const distance = haversine(GJENDESHEIM, MEMURUBU);
  assert.ok(distance > 10400 && distance < 11000, `fikk ${distance}`);
});

test('haversine er null for samme punkt og symmetrisk', () => {
  assert.equal(haversine(GJENDESHEIM, GJENDESHEIM), 0);
  assert.ok(Math.abs(haversine(GJENDESHEIM, MEMURUBU) - haversine(MEMURUBU, GJENDESHEIM)) < 1e-6);
});

test('pathLength summerer strekningene', () => {
  const points = [GJENDESHEIM, MEMURUBU, GJENDESHEIM];
  assert.ok(Math.abs(pathLength(points) - 2 * haversine(GJENDESHEIM, MEMURUBU)) < 1e-6);
});

test('cumulativeDistances starter på null og vokser', () => {
  const distances = cumulativeDistances([GJENDESHEIM, MEMURUBU, { lat: 61.6, lon: 8.5 }]);
  assert.equal(distances[0], 0);
  assert.ok(distances[1] < distances[2]);
});

test('bearing peker vestover fra Gjendesheim til Memurubu', () => {
  const deg = bearing(GJENDESHEIM, MEMURUBU);
  assert.ok(deg > 250 && deg < 300, `fikk ${deg}`);
  assert.equal(compassPoint(deg), 'V');
});

test('compassPoint dekker hele sirkelen', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(90), 'Ø');
  assert.equal(compassPoint(180), 'S');
  assert.equal(compassPoint(359), 'N');
});

test('densify legger inn punkter uten å flytte endepunktene', () => {
  const dense = densify([GJENDESHEIM, MEMURUBU], 500);
  assert.ok(dense.length >= 22, `fikk ${dense.length}`);
  assert.deepEqual(dense[0], GJENDESHEIM);
  assert.deepEqual(dense.at(-1), MEMURUBU);
  for (let i = 1; i < dense.length; i++) {
    assert.ok(haversine(dense[i - 1], dense[i]) <= 501);
  }
});

test('densify beholder linja når avstanden er kortere enn steget', () => {
  const line = [GJENDESHEIM, { lat: 61.4935, lon: 8.7188 }];
  assert.equal(densify(line, 500).length, 2);
});

test('simplify fjerner punkter på en rett linje', () => {
  const straight = densify([GJENDESHEIM, MEMURUBU], 200);
  assert.ok(straight.length > 50);
  assert.equal(simplify(straight, 10).length, 2);
});

test('simplify beholder en tydelig knekk', () => {
  const corner = [
    { lat: 61.0, lon: 8.0 },
    { lat: 61.0, lon: 8.1 },
    { lat: 61.1, lon: 8.1 },
  ];
  assert.equal(simplify(corner, 10).length, 3);
});

test('closestPointOnPath finner riktig segment', () => {
  const line = [
    { lat: 61.0, lon: 8.0 },
    { lat: 61.0, lon: 8.1 },
    { lat: 61.1, lon: 8.1 },
  ];
  const hit = closestPointOnPath({ lat: 61.05, lon: 8.1005 }, line);
  assert.equal(hit.index, 1);
  assert.ok(hit.distance < 40, `fikk ${hit.distance}`);
});

test('bbox omslutter alle punkter og utvides med margin', () => {
  const tight = bbox([GJENDESHEIM, MEMURUBU]);
  assert.ok(tight[0] <= GJENDESHEIM.lat && tight[2] >= MEMURUBU.lat);
  const padded = bbox([GJENDESHEIM, MEMURUBU], 1000);
  assert.ok(padded[0] < tight[0] && padded[3] > tight[3]);
});

test('smooth demper enkeltavvik uten å endre nivået', () => {
  const values = [100, 100, 160, 100, 100];
  const result = smooth(values, 1);
  assert.ok(result[2] < 160 && result[2] > 100);
  assert.ok(Math.abs(result.reduce((a, b) => a + b, 0) / 5 - 112) < 12);
});
