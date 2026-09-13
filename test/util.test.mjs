import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, formatDistance, formatDuration, formatElevation, mapLimit } from '../src/js/util.js';

/** Norsk tallformat bruker hardt mellomrom som tusenskille. */
const normalise = (text) => text.replace(/[  ]/g, ' ');

test('formatDistance bytter enhet på riktig sted', () => {
  assert.equal(formatDistance(0), '0 m');
  assert.equal(formatDistance(846), '850 m');
  assert.equal(formatDistance(999), '1000 m');
  assert.equal(normalise(formatDistance(1000)), '1,0 km');
  assert.equal(normalise(formatDistance(12450)), '12 km');
  assert.equal(formatDistance(NaN), '–');
});

test('formatElevation runder til hele meter', () => {
  assert.equal(formatElevation(1607.69), '1 608 m'.replace(' ', ' '));
  assert.equal(formatElevation(null), '–');
});

test('formatDuration skriver timer og minutter', () => {
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(45 * 60), '45 min');
  assert.equal(formatDuration(3600), '1 t');
  assert.equal(formatDuration(4 * 3600 + 25 * 60), '4 t 25 min');
  assert.equal(formatDuration(-5), '–');
});

test('clamp holder seg innenfor grensene', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('mapLimit bevarer rekkefølgen og begrenser samtidighet', async () => {
  let running = 0;
  let peak = 0;
  const result = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (value) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2, `kjørte ${peak} samtidig`);
});

test('mapLimit takler tom liste', async () => {
  assert.deepEqual(await mapLimit([], 3, async () => 1), []);
});
