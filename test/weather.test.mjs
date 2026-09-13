import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckpoints, daylightCheck } from '../src/js/weather.js';
import { describeSymbol, describeWind, pickNearest } from '../src/js/api/met.js';
import { summarise } from '../src/js/route.js';

function longRoute() {
  const points = [];
  const elevations = [];
  for (let i = 0; i <= 200; i++) {
    points.push({ lat: 61.0 + i * 0.0009, lon: 8.0 });
    elevations.push(900 + i * 3);
  }
  return summarise(points, elevations, { pace: 'normal', terrain: 'sti', packKg: 8, breaks: true });
}

test('buildCheckpoints tar med start og mål og holder seg innenfor taket', () => {
  const summary = longRoute();
  const start = new Date('2026-07-01T08:00:00Z');
  const checkpoints = buildCheckpoints(summary, start);
  assert.ok(checkpoints.length >= 2 && checkpoints.length <= 5, `fikk ${checkpoints.length}`);
  assert.equal(checkpoints[0].index, 0);
  assert.equal(checkpoints.at(-1).index, summary.line.length - 1);
  assert.equal(checkpoints[0].label, 'Start');
  assert.equal(checkpoints.at(-1).label, 'Mål');
});

test('ankomsttidene stiger og starter på turstart', () => {
  const summary = longRoute();
  const start = new Date('2026-07-01T08:00:00Z');
  const checkpoints = buildCheckpoints(summary, start);
  assert.equal(checkpoints[0].eta.getTime(), start.getTime());
  for (let i = 1; i < checkpoints.length; i++) {
    assert.ok(checkpoints[i].eta > checkpoints[i - 1].eta);
  }
  const finish = checkpoints.at(-1).eta.getTime() - start.getTime();
  assert.ok(Math.abs(finish / 1000 - summary.time.totalSeconds) < 60);
});

test('daylightCheck melder fra når turen ender etter solnedgang', () => {
  const start = new Date('2026-09-13T14:00:00Z');
  const sunset = new Date('2026-09-13T18:00:00Z');
  const late = daylightCheck({ sunset }, start, 5 * 3600);
  assert.equal(late.status, 'mørkt');
  assert.ok(late.minutesOfLight < 0);

  const tight = daylightCheck({ sunset }, start, 3.6 * 3600);
  assert.equal(tight.status, 'knapt');

  const fine = daylightCheck({ sunset }, start, 2 * 3600);
  assert.equal(fine.status, 'ok');
});

test('daylightCheck gir null når solnedgangen er ukjent', () => {
  assert.equal(daylightCheck(null, new Date(), 3600), null);
  assert.equal(daylightCheck({ sunset: null }, new Date(), 3600), null);
});

test('pickNearest finner nærmeste time og gir opp utenfor varselet', () => {
  const series = [
    { time: new Date('2026-09-13T10:00:00Z'), temperature: 8 },
    { time: new Date('2026-09-13T11:00:00Z'), temperature: 9 },
  ];
  assert.equal(pickNearest(series, new Date('2026-09-13T10:40:00Z')).temperature, 9);
  assert.equal(pickNearest(series, new Date('2026-09-20T10:00:00Z')), null);
  assert.equal(pickNearest([], new Date()), null);
});

test('describeSymbol oversetter MET-koder til norsk', () => {
  assert.equal(describeSymbol('clearsky_day').label, 'Klarvær');
  assert.equal(describeSymbol('heavyrainshowers_night').label, 'Kraftige regnbyger');
  assert.equal(describeSymbol('rainandthunder').label, 'Regn og torden');
  assert.equal(describeSymbol('partlycloudy_polartwilight').label, 'Delvis skyet');
  assert.equal(describeSymbol(null).label, 'Ukjent');
});

test('describeWind bruker norske vindbetegnelser', () => {
  assert.equal(describeWind(0.1), 'stille');
  assert.equal(describeWind(6), 'lett bris');
  assert.equal(describeWind(15), 'stiv kuling');
  assert.equal(describeWind(35), 'orkan');
  assert.equal(describeWind(null), '');
});
