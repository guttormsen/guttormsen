import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGpx, parseGpx, safeFilename } from '../src/js/gpx.js';

const SAMPLE = `<?xml version="1.0"?>
<gpx version="1.1" creator="Garmin">
  <metadata><name>Besseggen</name></metadata>
  <wpt lat="61.49340" lon="8.71860"><name>Gjendesheim</name></wpt>
  <trk><name>Besseggen</name><trkseg>
    <trkpt lat="61.49340" lon="8.71860"><ele>995.0</ele></trkpt>
    <trkpt lat="61.49500" lon="8.70000"><ele>1102.5</ele></trkpt>
    <trkpt lat="61.50000" lon="8.65000"/>
  </trkseg></trk>
</gpx>`;

test('parseGpx leser spor, høyder og veipunkter', () => {
  const parsed = parseGpx(SAMPLE);
  assert.equal(parsed.name, 'Besseggen');
  assert.equal(parsed.track.length, 3);
  assert.equal(parsed.track[0].ele, 995);
  assert.equal(parsed.track[2].ele, null);
  assert.equal(parsed.waypoints.length, 1);
  assert.equal(parsed.waypoints[0].name, 'Gjendesheim');
});

test('parseGpx avviser filer som ikke er GPX', () => {
  assert.throws(() => parseGpx('<html></html>'), /GPX/);
});

test('parseGpx avviser GPX uten punkter', () => {
  assert.throws(() => parseGpx('<gpx version="1.1"><trk></trk></gpx>'), /punkter/);
});

test('parseGpx håndterer rutepunkter og CDATA-navn', () => {
  const xml = `<gpx version="1.1"><rte><name><![CDATA[Tur & retur]]></name>
    <rtept lat="60.1" lon="10.1"></rtept><rtept lat="60.2" lon="10.2"></rtept></rte></gpx>`;
  const parsed = parseGpx(xml);
  assert.equal(parsed.name, 'Tur & retur');
  assert.equal(parsed.track.length, 2);
});

test('buildGpx og parseGpx er hverandres motsatte', () => {
  const line = [
    { lat: 61.4934, lon: 8.7186 },
    { lat: 61.505, lon: 8.62 },
  ];
  const xml = buildGpx({
    name: 'Test & tur',
    line,
    elevations: [995.4, 1743.2],
    waypoints: [{ lat: 61.4934, lon: 8.7186, name: 'Start' }],
  });
  const parsed = parseGpx(xml);
  assert.equal(parsed.name, 'Test & tur');
  assert.equal(parsed.track.length, 2);
  assert.ok(Math.abs(parsed.track[1].lat - 61.505) < 1e-6);
  assert.equal(parsed.track[0].ele, 995.4);
  assert.equal(parsed.waypoints[0].name, 'Start');
});

test('buildGpx utelater høyde når den mangler', () => {
  const xml = buildGpx({ name: 'Uten høyde', line: [{ lat: 61, lon: 8 }], elevations: [null] });
  assert.ok(!xml.includes('<ele>'));
  assert.equal(parseGpx(xml).track[0].ele, null);
});

test('safeFilename beholder norske bokstaver og fjerner farlige tegn', () => {
  assert.equal(safeFilename('Tur til Kjerag/Preikestolen'), 'Tur-til-KjeragPreikestolen.gpx');
  assert.equal(safeFilename('Fløyen æøå'), 'Fløyen-æøå.gpx');
  assert.equal(safeFilename('   '), 'tur.gpx');
  assert.equal(safeFilename('rute', 'json'), 'rute.json');
});
