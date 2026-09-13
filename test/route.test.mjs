import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  elevationStats,
  estimateTime,
  fillGaps,
  gradeRoute,
  packFactor,
  summarise,
  toblerSpeed,
} from '../src/js/route.js';
import { densify } from '../src/js/geo.js';

const OPTIONS = { pace: 'normal', terrain: 'sti', packKg: 8, breaks: false };

/** Rett linje østover fra et gitt punkt, med jevn stigning. */
function ramp(lengthMeters, riseMeters, steps = 40) {
  const start = { lat: 61.0, lon: 8.0 };
  const points = [];
  const elevations = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({ lat: start.lat, lon: start.lon + (lengthMeters * t) / (111320 * Math.cos((61 * Math.PI) / 180)) });
    elevations.push(1000 + riseMeters * t);
  }
  return { points, elevations };
}

test('toblerSpeed har toppfart i svak utforbakke', () => {
  assert.ok(toblerSpeed(-0.05) > toblerSpeed(0));
  assert.ok(toblerSpeed(0) > toblerSpeed(0.2));
  assert.ok(Math.abs(toblerSpeed(0) - 5.036) < 0.01);
});

test('packFactor straffer tung sekk og har bunn på fem prosent gevinst', () => {
  assert.equal(packFactor(8), 1);
  assert.ok(packFactor(20) > 1.1);
  assert.equal(packFactor(1), 0.95);
});

test('fillGaps interpolerer manglende høyder', () => {
  assert.deepEqual(fillGaps([100, null, null, 400]), [100, 200, 300, 400]);
});

test('fillGaps kopierer nærmeste kjente verdi i endene', () => {
  assert.deepEqual(fillGaps([null, 200, null]), [200, 200, 200]);
});

test('fillGaps takler at ingenting er kjent', () => {
  assert.deepEqual(fillGaps([null, null]), [null, null]);
});

test('elevationStats skiller stigning fra fall og ignorerer støy', () => {
  const stats = elevationStats([1000, 1001, 1000, 1300, 1100]);
  assert.ok(Math.abs(stats.ascent - 300) < 5, `stigning ${stats.ascent}`);
  assert.ok(Math.abs(stats.descent - 200) < 5, `fall ${stats.descent}`);
  assert.equal(stats.min, 1000);
  assert.equal(stats.max, 1300);
});

test('flat tur går omtrent i valgt marsjfart', () => {
  const { points, elevations } = ramp(10000, 0);
  const time = estimateTime(points, elevations, OPTIONS);
  const kmh = 10 / (time.movingSeconds / 3600);
  assert.ok(Math.abs(kmh - 4.5) < 0.15, `fikk ${kmh} km/t`);
});

test('stigning gjør turen tregere', () => {
  const flat = ramp(5000, 0);
  const uphill = ramp(5000, 700);
  const flatTime = estimateTime(flat.points, flat.elevations, OPTIONS).movingSeconds;
  const upTime = estimateTime(uphill.points, uphill.elevations, OPTIONS).movingSeconds;
  assert.ok(upTime > flatTime * 1.4, `${upTime} mot ${flatTime}`);
});

test('tidsanslaget ligger nær DNTs egne tall for Besseggen', () => {
  // Besseggen: ca. 14 km og 1100 høydemeter. DNT oppgir 6–8 timer.
  const { points, elevations } = ramp(14000, 1100, 140);
  const time = estimateTime(points, elevations, { ...OPTIONS, terrain: 'ulendt', breaks: true });
  const hours = time.totalSeconds / 3600;
  assert.ok(hours > 5.5 && hours < 8.5, `fikk ${hours.toFixed(1)} timer`);
});

test('ulendt terreng er tregere enn merket sti', () => {
  const { points, elevations } = ramp(8000, 200);
  const easy = estimateTime(points, elevations, OPTIONS).movingSeconds;
  const rough = estimateTime(points, elevations, { ...OPTIONS, terrain: 'ulendt' }).movingSeconds;
  assert.ok(rough > easy * 1.35);
});

test('pauser legges bare til etter første time', () => {
  const short = ramp(3000, 0);
  const long = ramp(20000, 0);
  assert.equal(estimateTime(short.points, short.elevations, { ...OPTIONS, breaks: true }).breakSeconds, 0);
  assert.ok(estimateTime(long.points, long.elevations, { ...OPTIONS, breaks: true }).breakSeconds > 1500);
});

test('kumulativ tid vokser monotont og ender på total gåtid', () => {
  const { points, elevations } = ramp(6000, 300);
  const time = estimateTime(points, elevations, OPTIONS);
  for (let i = 1; i < time.cumulativeSeconds.length; i++) {
    assert.ok(time.cumulativeSeconds[i] >= time.cumulativeSeconds[i - 1]);
  }
  assert.equal(time.cumulativeSeconds.at(-1), time.movingSeconds);
});

test('gradering skiller korte og lange turer', () => {
  assert.equal(gradeRoute({ distance: 3000, ascent: 150, terrain: 'sti' }).id, 'gronn');
  assert.equal(gradeRoute({ distance: 9000, ascent: 400, terrain: 'sti' }).id, 'bla');
  assert.equal(gradeRoute({ distance: 14000, ascent: 1100, terrain: 'ulendt' }).id, 'svart');
});

test('summarise setter sammen hele bildet', () => {
  const { points, elevations } = ramp(5000, 400);
  const summary = summarise(points, elevations, OPTIONS);
  assert.ok(Math.abs(summary.distance - 5000) < 50);
  assert.ok(summary.ascent > 380 && summary.ascent < 420);
  assert.equal(summary.descent, 0);
  assert.ok(summary.hasElevation);
  assert.equal(summary.elevations.length, summary.line.length);
  assert.equal(summary.distances.length, summary.line.length);
});

test('summarise takler at høydene mangler', () => {
  const line = densify([{ lat: 61, lon: 8 }, { lat: 61.05, lon: 8.05 }], 200);
  const summary = summarise(line, [], OPTIONS);
  assert.equal(summary.hasElevation, false);
  assert.equal(summary.ascent, 0);
  assert.ok(summary.time.totalSeconds > 0);
});

test('summarise gir null for en linje uten strekning', () => {
  assert.equal(summarise([{ lat: 61, lon: 8 }], [null], OPTIONS), null);
});
