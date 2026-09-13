import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, attachFeatures, buildFacilityIndex, featuresForTrip, topFeatures } from '../src/js/features.js';

const at = (lat, lon) => ({ lat, lon });

const facility = (id, kind, lat, lon, extra = {}) => ({
  id,
  kind,
  lat,
  lon,
  name: kind,
  wheelchair: null,
  ...extra,
});

/** En rute rett østover, ca. 1,1 km lang, med punkt hver ~55 meter. */
const trip = {
  name: 'Testruta',
  points: Array.from({ length: 21 }, (_, i) => at(60.0, 5.0 + i * 0.001)),
};

const featuresOf = (facilities, target = trip) =>
  featuresForTrip(buildFacilityIndex(facilities), target).features;

test('badeplass rett ved ruta gir badebrikke', () => {
  assert.deepEqual(featuresOf([facility('a', 'bading', 60.0005, 5.01)]), ['bading']);
});

test('badeplass langt fra ruta teller ikke', () => {
  // 0,005 grader breddegrad er ca. 550 meter – utenfor badingens 200 m.
  assert.deepEqual(featuresOf([facility('a', 'bading', 60.005, 5.01)]), []);
});

test('toalett får større slingringsmonn enn badeplass', () => {
  const punkt = at(60.00225, 5.01); // ca. 250 m fra ruta
  assert.deepEqual(featuresOf([facility('a', 'bading', punkt.lat, punkt.lon)]), [], 'bading krever 200 m');
  assert.deepEqual(featuresOf([facility('b', 'toalett', punkt.lat, punkt.lon)]), ['toalett'], 'toalett tåler 300 m');
});

test('buss teller bare ved start og mål', () => {
  const vedStart = featuresOf([facility('a', 'kollektiv', 60.0, 5.0005)]);
  const påMidten = featuresOf([facility('b', 'kollektiv', 60.0, 5.01)]);
  assert.deepEqual(vedStart, ['kollektiv']);
  assert.deepEqual(påMidten, [], 'holdeplass midt på ruta skal ikke gi «buss til start»');
});

test('buss ved målet teller også', () => {
  assert.deepEqual(featuresOf([facility('a', 'kollektiv', 60.0, 5.0203)]), ['kollektiv']);
});

test('HC-brikken krever at fasiliteten er merket rullestolvennlig', () => {
  assert.deepEqual(featuresOf([facility('a', 'toalett', 60.0, 5.01, { wheelchair: 'ja' })]).sort(), ['hc', 'toalett']);
  assert.deepEqual(featuresOf([facility('b', 'toalett', 60.0, 5.01, { wheelchair: 'nei' })]), ['toalett']);
  assert.deepEqual(featuresOf([facility('c', 'toalett', 60.0, 5.01, { wheelchair: 'delvis' })]), ['toalett']);
});

test('flere fasiliteter gir flere brikker, i fast rekkefølge', () => {
  const found = featuresOf([
    facility('a', 'bål', 60.0, 5.005),
    facility('b', 'bading', 60.0, 5.015),
    facility('c', 'utsikt', 60.0, 5.02),
  ]);
  assert.deepEqual(found, ['bading', 'bål', 'utsikt']);
});

test('fasilitet midt mellom to rutepunkter blir ikke oversett', () => {
  // Ruta har punkt hver ~55 m; badeplassen ligger mellom to av dem.
  assert.deepEqual(featuresOf([facility('a', 'bading', 60.0, 5.0105)]), ['bading']);
});

test('hytte og gapahuk havner under samme brikke', () => {
  assert.deepEqual(featuresOf([facility('a', 'gapahuk', 60.0, 5.01)]), ['hytte']);
  assert.deepEqual(featuresOf([facility('b', 'hytte', 60.0, 5.01)]), ['hytte']);
});

test('nærby-lista er sortert etter avstand', () => {
  const index = buildFacilityIndex([
    facility('langt', 'bål', 60.0015, 5.01),
    facility('nært', 'bål', 60.0001, 5.01),
  ]);
  const { nearby } = featuresForTrip(index, trip);
  assert.deepEqual(nearby.map((f) => f.id), ['nært', 'langt']);
  assert.ok(nearby[0].distance < nearby[1].distance);
});

test('ingen fasiliteter gir ingen brikker', () => {
  assert.deepEqual(featuresOf([]), []);
  assert.deepEqual(featuresForTrip(buildFacilityIndex([]), { name: 'Tom', points: [] }).features, []);
});

test('attachFeatures merker hver tur for seg', () => {
  const trips = [
    { id: 't1', name: 'Med bading', points: [at(60.0, 5.0)] },
    { id: 't2', name: 'Uten', points: [at(61.0, 6.0)] },
  ];
  const [a, b] = attachFeatures(trips, [facility('a', 'bading', 60.0005, 5.0)]);
  assert.deepEqual(a.features, ['bading']);
  assert.deepEqual(b.features, []);
});

test('attachFeatures lar turene være urørt når det ikke finnes fasiliteter', () => {
  const trips = [{ id: 't1', name: 'Tur', points: [at(60, 5)] }];
  assert.equal(attachFeatures(trips, [])[0].features, undefined);
});

test('alle brikkene har ikon og forklarende tekst', () => {
  for (const feature of Object.values(FEATURES)) {
    assert.ok(feature.icon, `${feature.id} mangler ikon`);
    assert.ok(feature.label, `${feature.id} mangler navn`);
    assert.ok(feature.radius > 0, `${feature.id} mangler radius`);
  }
  // HC-brikken må forklare hva den faktisk sier noe om.
  assert.match(FEATURES.hc.hint, /OpenStreetMap/);
  assert.match(FEATURES.hc.hint, /ikke.*stien/i);
});

test('topFeatures viser de mest interessante først', () => {
  const { shown, rest } = topFeatures(['lek', 'toalett', 'bading', 'utsikt', 'bål'], 3);
  assert.deepEqual(shown, ['bading', 'bål', 'utsikt']);
  assert.equal(rest, 2);
});

test('topFeatures takler få eller ingen merker', () => {
  assert.deepEqual(topFeatures(['bading'], 3), { shown: ['bading'], rest: 0 });
  assert.deepEqual(topFeatures([], 3), { shown: [], rest: 0 });
  assert.deepEqual(topFeatures(undefined, 3), { shown: [], rest: 0 });
});
