import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Dagboka bruker localStorage; her er en liten stand-in for Node. */
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { badgeStatus, entries, highlights, logTrip, nextBadges, removeEntry, totals } = await import(
  '../src/js/journal.js'
);

const tur = (overrides = {}) => ({
  name: 'Testtur',
  distance: 5000,
  ascent: 300,
  seconds: 5400,
  maxElevation: 600,
  loop: false,
  ...overrides,
});

beforeEach(() => store.clear());

test('logTrip legger turen øverst og fyller ut feltene', () => {
  logTrip(tur({ name: 'Første' }));
  logTrip(tur({ name: 'Andre' }));
  const all = entries();
  assert.equal(all.length, 2);
  assert.equal(all[0].name, 'Andre');
  assert.ok(all[0].id);
  assert.ok(Date.parse(all[0].date));
});

test('logTrip tåler manglende og negative verdier', () => {
  const entry = logTrip({ distance: -5, ascent: undefined, seconds: NaN });
  assert.equal(entry.name, 'Tur uten navn');
  assert.equal(entry.distance, 0);
  assert.equal(entry.ascent, 0);
  assert.equal(entry.seconds, 0);
  assert.equal(entry.maxElevation, null);
});

test('removeEntry fjerner bare den ene turen', () => {
  const first = logTrip(tur({ name: 'Beholdes' }));
  const second = logTrip(tur({ name: 'Slettes' }));
  removeEntry(second.id);
  assert.deepEqual(entries().map((e) => e.name), ['Beholdes']);
  assert.equal(entries()[0].id, first.id);
});

test('totals summerer og finner høyeste punkt', () => {
  logTrip(tur({ distance: 5000, ascent: 300, seconds: 3600, maxElevation: 600 }));
  logTrip(tur({ distance: 7000, ascent: 500, seconds: 7200, maxElevation: 1200 }));
  const sums = totals();
  assert.equal(sums.trips, 2);
  assert.equal(sums.distance, 12000);
  assert.equal(sums.ascent, 800);
  assert.equal(sums.seconds, 10800);
  assert.equal(sums.highest, 1200);
});

test('totals på tom dagbok gir nuller', () => {
  const sums = totals();
  assert.equal(sums.trips, 0);
  assert.equal(sums.distance, 0);
  assert.equal(sums.highest, 0);
});

test('første tur gir første merke, resten er fortsatt låst', () => {
  logTrip(tur());
  const badges = badgeStatus();
  assert.equal(badges.find((b) => b.id === 'forste').earned, true);
  assert.equal(badges.find((b) => b.id === 'everest').earned, false);
  assert.equal(badges.every((b) => b.progress >= 0 && b.progress <= 1), true);
});

test('høydemetermerkene løses ut av summen, ikke av én tur', () => {
  for (let i = 0; i < 9; i++) logTrip(tur({ ascent: 300 }));
  const badges = badgeStatus();
  assert.equal(badges.find((b) => b.id === 'galdhopiggen').earned, true, '2 700 hm skal gi Galdhøpiggen');
  assert.equal(badges.find((b) => b.id === 'everest').earned, false);
});

test('milsluker krever én lang tur, ikke mange korte', () => {
  for (let i = 0; i < 10; i++) logTrip(tur({ distance: 5000 }));
  assert.equal(badgeStatus().find((b) => b.id === 'milsluker').earned, false);
  logTrip(tur({ distance: 21000 }));
  assert.equal(badgeStatus().find((b) => b.id === 'milsluker').earned, true);
});

test('rundtur- og vintermerket ser på egenskaper ved turen', () => {
  logTrip(tur({ loop: true, date: new Date('2026-01-15T10:00:00').toISOString() }));
  const badges = badgeStatus();
  assert.equal(badges.find((b) => b.id === 'rundtur').earned, true);
  assert.equal(badges.find((b) => b.id === 'vinter').earned, true);
  assert.equal(badges.find((b) => b.id === 'morgenfugl').earned, false);
});

test('turhelg krever to dager på rad', () => {
  logTrip(tur({ date: new Date('2026-06-01T10:00:00').toISOString() }));
  logTrip(tur({ date: new Date('2026-06-03T10:00:00').toISOString() }));
  assert.equal(badgeStatus().find((b) => b.id === 'turhelg').earned, false);
  logTrip(tur({ date: new Date('2026-06-02T10:00:00').toISOString() }));
  assert.equal(badgeStatus().find((b) => b.id === 'turhelg').earned, true);
});

test('nextBadges peker på de nærmeste uoppnådde merkene', () => {
  logTrip(tur({ distance: 40000, ascent: 2400 }));
  const coming = nextBadges(entries(), 2);
  assert.equal(coming.length, 2);
  assert.equal(coming.every((badge) => !badge.earned), true);
  assert.ok(coming[0].progress >= coming[1].progress);
});

test('highlights sammenligner med kjente høyder og avstander', () => {
  logTrip(tur({ distance: 50000, ascent: 2600, seconds: 40000 }));
  const lines = highlights();
  assert.ok(lines.some((line) => /Galdhøpiggen/.test(line)), lines.join(' | '));
  assert.ok(lines.some((line) => /maraton/.test(line)), lines.join(' | '));
  assert.ok(lines.some((line) => /timer på beina/.test(line)));
});

test('highlights er tom før første tur', () => {
  assert.deepEqual(highlights(), []);
});
