import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FILTERS,
  GRADES,
  buildTrips,
  chainSegments,
  cleanRouteName,
  filterTrips,
  gradeOf,
  hasActiveFilters,
  sampleForCard,
  surpriseMe,
} from '../src/js/trips.js';
import { pathLength } from '../src/js/geo.js';

/** Én grad breddegrad er ca. 111 km; 0,01° ≈ 1,1 km. */
const at = (lat, lon) => ({ lat, lon });

/** Bygger et rutesegment slik parseFotruter leverer dem. */
const segment = (name, points, extra = {}) => ({
  id: `${name}-${Math.random()}`,
  name,
  points,
  marking: 'merket',
  grade: null,
  special: null,
  maintainer: 'Testkommune',
  ...extra,
});

test('cleanRouteName reparerer skilletegn som er blitt til doble ŋ', () => {
  assert.equal(cleanRouteName('Reigstadfjellet -ŋŋ Hånipa'), 'Reigstadfjellet – Hånipa');
  assert.equal(cleanRouteName('Mjelda ŋŋ Sundland'), 'Mjelda – Sundland');
  assert.equal(cleanRouteName('  Fløyveien  '), 'Fløyveien');
});

test('cleanRouteName lar ekte ŋ i samiske navn være i fred', () => {
  assert.equal(cleanRouteName('Skáiddevárri geaŋgan'), 'Skáiddevárri geaŋgan');
});

test('chainSegments syr sammen biter som deler endepunkt', () => {
  const chains = chainSegments([
    { points: [at(61.0, 8.0), at(61.0, 8.01)] },
    { points: [at(61.0, 8.01), at(61.0, 8.02)] },
    { points: [at(61.0, 8.02), at(61.0, 8.03)] },
  ]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].length, 4);
});

test('chainSegments snur en bit som ligger motsatt vei', () => {
  const chains = chainSegments([
    { points: [at(61.0, 8.0), at(61.0, 8.01)] },
    { points: [at(61.0, 8.02), at(61.0, 8.01)] },
  ]);
  assert.equal(chains.length, 1);
  assert.ok(Math.abs(chains[0].at(-1).lon - 8.02) < 1e-9);
});

test('chainSegments holder atskilte deler fra hverandre', () => {
  const chains = chainSegments([
    { points: [at(61.0, 8.0), at(61.0, 8.01)] },
    { points: [at(62.0, 9.0), at(62.0, 9.01)] },
  ]);
  assert.equal(chains.length, 2);
});

test('chainSegments gir lengste del først', () => {
  const chains = chainSegments([
    { points: [at(61.0, 8.0), at(61.0, 8.001)] },
    { points: [at(62.0, 9.0), at(62.0, 9.05)] },
  ]);
  assert.ok(pathLength(chains[0]) > pathLength(chains[1]));
});

test('buildTrips grupperer segmenter på navn', () => {
  const trips = buildTrips([
    segment('Fløyveien', [at(60.39, 5.33), at(60.395, 5.335)]),
    segment('Fløyveien', [at(60.395, 5.335), at(60.4, 5.34)]),
    segment('Stoltzekleiven', [at(60.4, 5.35), at(60.41, 5.36)]),
  ]);
  assert.equal(trips.length, 2);
  const floyen = trips.find((trip) => trip.name === 'Fløyveien');
  assert.equal(floyen.points.length, 3);
  assert.ok(floyen.length > 1000);
});

test('buildTrips hopper over navnløse og altfor korte ruter', () => {
  const trips = buildTrips([
    segment('Ukjent', [at(60.39, 5.33), at(60.4, 5.34)]),
    segment('', [at(60.39, 5.33), at(60.4, 5.34)]),
    segment('Stistump', [at(60.39, 5.33), at(60.3902, 5.3302)]),
  ]);
  assert.deepEqual(trips, []);
});

test('buildTrips kjenner igjen en rundtur', () => {
  const ring = [at(60.39, 5.33), at(60.40, 5.33), at(60.40, 5.35), at(60.39, 5.35), at(60.39, 5.33)];
  const [trip] = buildTrips([segment('Vannet rundt', ring)]);
  assert.equal(trip.loop, true);
  assert.equal(buildTrips([segment('Rett fram', [at(60.39, 5.33), at(60.45, 5.33)])])[0].loop, false);
});

test('buildTrips velger den vanligste graderingen i gruppa', () => {
  const [trip] = buildTrips([
    segment('Ulriken', [at(60.39, 5.33), at(60.40, 5.34)], { grade: 'R' }),
    segment('Ulriken', [at(60.40, 5.34), at(60.41, 5.35)], { grade: 'R' }),
    segment('Ulriken', [at(60.41, 5.35), at(60.42, 5.36)], { grade: 'B' }),
  ]);
  assert.equal(trip.grade.id, 'krevende');
});

test('buildTrips faller tilbake til ugradert når koden er ukjent', () => {
  const [trip] = buildTrips([segment('Rute', [at(60.39, 5.33), at(60.45, 5.33)], { grade: 'I' })]);
  assert.equal(trip.grade.id, 'ugradert');
  assert.equal(gradeOf('G').label, GRADES.G.label);
  assert.equal(gradeOf(null).id, 'ugradert');
});

test('buildTrips merker rutetype når koden er kjent', () => {
  const [trip] = buildTrips([segment('Kysten', [at(60.39, 5.33), at(60.45, 5.33)], { special: 'KY' })]);
  assert.equal(trip.special.id, 'kyststi');
  const [plain] = buildTrips([segment('Vanlig', [at(60.39, 5.33), at(60.45, 5.33)], { special: 'XX' })]);
  assert.equal(plain.special, null);
});

test('buildTrips kaster ut navn som dekker et helt stinett', () => {
  // Tretti atskilte biter under samme navn er et nett, ikke en tur.
  const segments = Array.from({ length: 30 }, (_, i) =>
    segment('Blåmerket sti Østmarka', [at(59.8 + i * 0.05, 10.8), at(59.81 + i * 0.05, 10.8)]),
  );
  assert.deepEqual(buildTrips(segments), []);
});

/* ---------- Filtrering ---------- */

const trips = [
  { id: 'a', name: 'Kort rundtur', length: 2000, loop: true, marked: true, grade: GRADES.G, special: null, start: at(60.0, 5.0), seconds: 1800 },
  { id: 'b', name: 'Dagstur', length: 12000, loop: false, marked: true, grade: GRADES.R, special: null, start: at(60.1, 5.0), seconds: 18000 },
  { id: 'c', name: 'Kyststi', length: 6000, loop: false, marked: false, grade: GRADES.B, special: { id: 'kyststi' }, start: at(60.01, 5.0), seconds: 7200 },
].map((trip) => ({ ...trip, grade: trip.grade ? { ...trip.grade, id: trip.grade === GRADES.G ? 'enkel' : trip.grade === GRADES.R ? 'krevende' : 'middels' } : trip.grade }));

test('uten filtre kommer alle turene med', () => {
  assert.equal(filterTrips(trips, DEFAULT_FILTERS).length, 3);
  assert.equal(hasActiveFilters(DEFAULT_FILTERS), false);
});

test('lengdefilter plukker riktig bøtte', () => {
  const short = filterTrips(trips, { ...DEFAULT_FILTERS, lengths: ['kort'] });
  assert.deepEqual(short.map((t) => t.id), ['a']);
  const mid = filterTrips(trips, { ...DEFAULT_FILTERS, lengths: ['halvdag', 'dagstur'] });
  assert.deepEqual(mid.map((t) => t.id).sort(), ['b', 'c']);
});

test('gradering, form og merking kan kombineres', () => {
  assert.deepEqual(filterTrips(trips, { ...DEFAULT_FILTERS, grades: ['krevende'] }).map((t) => t.id), ['b']);
  assert.deepEqual(filterTrips(trips, { ...DEFAULT_FILTERS, shape: 'rundtur' }).map((t) => t.id), ['a']);
  assert.deepEqual(filterTrips(trips, { ...DEFAULT_FILTERS, markedOnly: true }).map((t) => t.id).sort(), ['a', 'b']);
  assert.deepEqual(filterTrips(trips, { ...DEFAULT_FILTERS, special: 'kyststi' }).map((t) => t.id), ['c']);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, markedOnly: true }), true);
});

test('tidsfilteret slår bare inn når tiden er kjent', () => {
  const uten = [{ ...trips[1], seconds: null }];
  assert.equal(filterTrips(uten, { ...DEFAULT_FILTERS, maxMinutes: 60 }).length, 1);
  assert.equal(filterTrips([trips[1]], { ...DEFAULT_FILTERS, maxMinutes: 60 }).length, 0);
});

test('nærmeste bånd først, lengste tur innenfor båndet', () => {
  const sorted = filterTrips(trips, DEFAULT_FILTERS, at(60.0, 5.0));
  // «a» (0 m) og «c» (1,1 km) er i samme nærhetsbånd, så den lengste vinner.
  // «b» ligger elleve kilometer unna og havner bakerst uansett lengde.
  assert.deepEqual(sorted.map((t) => t.id), ['c', 'a', 'b']);
  assert.ok(sorted[0].distanceFromYou < sorted[2].distanceFromYou);
});

test('surpriseMe plukker fra lista og takler at den er tom', () => {
  assert.equal(surpriseMe([], () => 0), null);
  assert.equal(surpriseMe(trips, () => 0).id, 'a');
  assert.equal(surpriseMe(trips, () => 0.99).id, 'c');
});

test('sampleForCard tynner ut lange ruter, men beholder endene', () => {
  const points = Array.from({ length: 500 }, (_, i) => at(60 + i * 0.001, 5));
  const sample = sampleForCard(points, 24);
  assert.equal(sample.length, 24);
  assert.deepEqual(sample[0], points[0]);
  assert.deepEqual(sample.at(-1), points.at(-1));
  assert.deepEqual(sampleForCard(points.slice(0, 10), 24).length, 10);
});
