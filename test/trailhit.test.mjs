import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrailIndex, findTrailAt } from '../src/js/trailhit.js';

const at = (lat, lon) => ({ lat, lon });

/** To parallelle stier ca. 550 meter fra hverandre. */
const nord = {
  id: 'nord',
  name: 'Nordstien',
  points: Array.from({ length: 21 }, (_, i) => at(60.0, 5.0 + i * 0.001)),
};
const sør = {
  id: 'sør',
  name: 'Sørstien',
  points: Array.from({ length: 21 }, (_, i) => at(59.995, 5.0 + i * 0.001)),
};
const index = buildTrailIndex([nord, sør]);

test('finner stien rett under punktet', () => {
  const hit = findTrailAt(index, at(60.0, 5.01), 50);
  assert.equal(hit.trip.id, 'nord');
  assert.ok(hit.distance < 5);
});

test('velger den nærmeste når to stier er innenfor rekkevidde', () => {
  // 60.0 er nord, 59.995 er sør; dette punktet ligger nærmest sør.
  const hit = findTrailAt(index, at(59.9962, 5.01), 400);
  assert.equal(hit.trip.id, 'sør');
});

test('gir ingenting når ingen sti er nær nok', () => {
  assert.equal(findTrailAt(index, at(60.02, 5.01), 50), null);
  assert.equal(findTrailAt(index, at(60.0, 5.01), 0), null);
  assert.equal(findTrailAt(null, at(60.0, 5.01), 50), null);
});

test('toleransen bestemmer hvor langt unna et trykk kan lande', () => {
  // Ca. 110 meter nord for stien.
  const punkt = at(60.001, 5.01);
  assert.equal(findTrailAt(index, punkt, 50), null);
  assert.equal(findTrailAt(index, punkt, 200).trip.id, 'nord');
});

test('leter i flere celler når toleransen er stor', () => {
  // Cellene er 120 meter; en toleranse på 500 må dekke flere av dem.
  const hit = findTrailAt(index, at(60.004, 5.01), 500);
  assert.equal(hit.trip.id, 'nord');
  assert.ok(hit.distance > 400 && hit.distance < 460, `fikk ${hit.distance}`);
});

test('tom indeks er trygg å slå opp i', () => {
  const empty = buildTrailIndex([]);
  assert.equal(empty.size, 0);
  assert.equal(findTrailAt(empty, at(60, 5), 100), null);
  assert.equal(findTrailAt(buildTrailIndex([{ id: 'x', name: 'X' }]), at(60, 5), 100), null);
});
