import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as navigateModule from '../src/js/navigate.js';
import { OFF_ROUTE_M, arrivalTime, formatPosition, nextAhead, progressOnRoute } from '../src/js/navigate.js';
import { summarise } from '../src/js/route.js';

const OPTIONS = { pace: 'normal', terrain: 'sti', packKg: 8, breaks: true };

/** Rett rute østover, 2 km, med 200 høydemeter jevnt fordelt. */
function route() {
  const points = [];
  const elevations = [];
  for (let i = 0; i <= 40; i++) {
    points.push({ lat: 60.0, lon: 5.0 + (i * 0.036) / 40 });
    elevations.push(500 + i * 5);
  }
  return summarise(points, elevations, OPTIONS);
}

const summary = route();

test('helt i starten gjenstår hele turen', () => {
  const p = progressOnRoute(summary, { lat: 60.0, lon: 5.0 });
  assert.equal(p.index, 0);
  assert.ok(Math.abs(p.distanceLeft - summary.distance) < 1);
  assert.ok(Math.abs(p.ascentLeft - summary.ascent) < 15, `${p.ascentLeft} mot ${summary.ascent}`);
  assert.equal(p.finished, false);
  assert.equal(p.offRoute, false);
  assert.ok(Math.abs(p.fraction) < 0.01);
});

test('midtveis gjenstår omtrent halvparten', () => {
  const middle = summary.line[Math.floor(summary.line.length / 2)];
  const p = progressOnRoute(summary, middle);
  assert.ok(Math.abs(p.fraction - 0.5) < 0.05, `fikk ${p.fraction}`);
  assert.ok(Math.abs(p.distanceLeft - summary.distance / 2) < summary.distance * 0.06);
  assert.ok(p.ascentLeft > 0 && p.ascentLeft < summary.ascent);
});

test('ved målet er turen ferdig', () => {
  const p = progressOnRoute(summary, summary.line.at(-1));
  assert.equal(p.finished, true);
  assert.ok(p.distanceLeft < 40);
  assert.ok(Math.abs(p.fraction - 1) < 0.01);
});

test('gjenstående tid krymper etter hvert som man går', () => {
  const start = progressOnRoute(summary, summary.line[0]);
  const middle = progressOnRoute(summary, summary.line[Math.floor(summary.line.length / 2)]);
  assert.ok(middle.secondsLeft < start.secondsLeft);
  // Pausene skal være med i anslaget, ikke bare ren gåtid.
  assert.ok(start.secondsLeft >= summary.time.movingSeconds);
  assert.ok(Math.abs(start.secondsLeft - summary.time.totalSeconds) < 60);
});

test('utenfor ruta oppdages med avstand', () => {
  // 0,002 grader breddegrad er ca. 220 meter.
  const off = progressOnRoute(summary, { lat: 60.002, lon: 5.018 });
  assert.equal(off.offRoute, true);
  assert.ok(off.offRouteDistance > OFF_ROUTE_M);
  const on = progressOnRoute(summary, { lat: 60.0002, lon: 5.018 });
  assert.equal(on.offRoute, false);
});

test('uten rute eller posisjon gir det ingen framdrift', () => {
  assert.equal(progressOnRoute(null, { lat: 60, lon: 5 }), null);
  assert.equal(progressOnRoute(summary, null), null);
  assert.equal(progressOnRoute({ line: [{ lat: 60, lon: 5 }] }, { lat: 60, lon: 5 }), null);
});

test('arrivalTime legger gjenstående tid til nå', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  assert.equal(arrivalTime(3600, now).toISOString(), '2026-09-13T13:00:00.000Z');
  assert.equal(arrivalTime(-50, now).toISOString(), now.toISOString());
});

test('nextAhead finner neste severdighet foran deg', () => {
  const pois = [
    { id: 'bak', name: 'Passert', along: 100 },
    { id: 'neste', name: 'Gapahuk', along: 900 },
    { id: 'senere', name: 'Topp', along: 1800 },
  ];
  assert.equal(nextAhead(pois, 500).id, 'neste');
  assert.equal(nextAhead(pois, 1000).id, 'senere');
  assert.equal(nextAhead(pois, 1900), null);
  assert.equal(nextAhead([], 0), null);
  assert.equal(nextAhead(null, 0), null);
});

test('nextAhead hopper over det man nettopp passerte', () => {
  const pois = [{ id: 'her', name: 'Her', along: 500 }];
  assert.equal(nextAhead(pois, 490), null, 'under 25 meter foran regnes som passert');
  assert.equal(nextAhead(pois, 400).id, 'her');
});

test('formatPosition gir tall som kan leses opp til 113', () => {
  const where = formatPosition({ lat: 60.397123456, lon: 5.334987, accuracy: 7.4 });
  assert.equal(where.text, '60.39712, 5.33499');
  assert.match(where.spoken, /nord/);
  assert.match(where.spoken, /øst/);
  assert.equal(where.accuracy, 7);
  assert.equal(where.geoUri, 'geo:60.39712,5.33499');
});

test('formatPosition takler manglende nøyaktighet og posisjon', () => {
  assert.equal(formatPosition(null), null);
  assert.equal(formatPosition({ lat: 60, lon: 5 }).accuracy, null);
});

/* ---------- Retning og feil vei ---------- */

test('headingAhead peker dit ruta går videre', () => {
  const { headingAhead } = navigateModule;
  const start = summary.line[0];
  const heading = headingAhead(summary, 0, start);
  // Ruta går rett østover.
  assert.equal(heading.compass, 'Ø');
  assert.ok(heading.distance >= 150 && heading.distance < 300, `${heading.distance} m fram`);
});

test('headingAhead gir ingenting helt på slutten', () => {
  const { headingAhead } = navigateModule;
  assert.equal(headingAhead(summary, summary.line.length - 1, summary.line.at(-1)), null);
  assert.equal(headingAhead(null, 0, { lat: 60, lon: 5 }), null);
});

test('looksReversed kjenner igjen at man står ved målet', () => {
  const { looksReversed } = navigateModule;
  assert.equal(looksReversed(summary, summary.line.at(-1)), true);
  assert.equal(looksReversed(summary, summary.line[0]), false);
  // Midt på ruta er det ingen grunn til å spørre.
  assert.equal(looksReversed(summary, summary.line[Math.floor(summary.line.length / 2)]), false);
  assert.equal(looksReversed(null, { lat: 60, lon: 5 }), false);
});
