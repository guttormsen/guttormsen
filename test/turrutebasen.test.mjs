import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFotruter } from '../src/js/api/turrutebasen.js';

/** Forkortet, men strukturelt identisk med det Geonorge faktisk svarer. */
const GML = `<?xml version='1.0' encoding='UTF-8'?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2">
<wfs:member>
<app:Fotrute xmlns:app="http://skjema.geonorge.no/SOSI/produktspesifikasjon/TurOgFriluftsruter/20171210" gml:id="fotrute.125313">
  <app:identifikasjon><app:Identifikasjon><app:lokalId>777b01d6</app:lokalId></app:Identifikasjon></app:identifikasjon>
  <app:senterlinje>
    <gml:LineString gml:id="a" srsName="urn:ogc:def:crs:EPSG::4258">
      <gml:posList>61.556071 8.793838 61.555945 8.793650 61.555739 8.793426</gml:posList>
    </gml:LineString>
  </app:senterlinje>
  <app:fotruteInfo><app:FotruteInfo>
    <app:rutenavn>Besseggen</app:rutenavn>
    <app:merking>Merket</app:merking>
    <app:gradering>Krevende</app:gradering>
    <app:underlagstype>Sti</app:underlagstype>
  </app:FotruteInfo></app:fotruteInfo>
  <app:vedlikeholdsansvarlig>DNT Oslo og Omegn</app:vedlikeholdsansvarlig>
</app:Fotrute>
</wfs:member>
<wfs:member>
<app:Fotrute xmlns:app="http://skjema.geonorge.no/SOSI/produktspesifikasjon/TurOgFriluftsruter/20171210" gml:id="fotrute.2">
  <app:identifikasjon><app:Identifikasjon><app:lokalId>abc</app:lokalId></app:Identifikasjon></app:identifikasjon>
  <app:senterlinje><gml:MultiCurve>
    <gml:curveMember><gml:LineString><gml:posList>60.1 10.1 60.2 10.2</gml:posList></gml:LineString></gml:curveMember>
    <gml:curveMember><gml:LineString><gml:posList>60.3 10.3 60.4 10.4</gml:posList></gml:LineString></gml:curveMember>
  </gml:MultiCurve></app:senterlinje>
</app:Fotrute>
</wfs:member>
</wfs:FeatureCollection>`;

test('parseFotruter leser geometri i riktig rekkefølge (lat lon)', () => {
  const routes = parseFotruter(GML);
  const besseggen = routes[0];
  assert.equal(besseggen.points.length, 3);
  assert.ok(Math.abs(besseggen.points[0].lat - 61.556071) < 1e-9);
  assert.ok(Math.abs(besseggen.points[0].lon - 8.793838) < 1e-9);
});

test('parseFotruter henter navn, merking og gradering', () => {
  const [besseggen] = parseFotruter(GML);
  assert.equal(besseggen.name, 'Besseggen');
  assert.equal(besseggen.marking, 'merket');
  assert.equal(besseggen.grade, 'Krevende');
  assert.equal(besseggen.surface, 'Sti');
  assert.equal(besseggen.maintainer, 'DNT Oslo og Omegn');
});

test('parseFotruter deler en MultiCurve i én lenke per bit', () => {
  const routes = parseFotruter(GML);
  assert.equal(routes.length, 3);
  assert.equal(routes[1].points.length, 2);
  assert.equal(routes[2].points.length, 2);
  assert.notEqual(routes[1].id, routes[2].id);
});

test('parseFotruter forveksler ikke Fotrute med FotruteInfo', () => {
  assert.equal(parseFotruter(GML).filter((r) => r.name === 'Besseggen').length, 1);
});

test('parseFotruter gir tom liste for et tomt svar', () => {
  assert.deepEqual(parseFotruter('<wfs:FeatureCollection numberReturned="0"/>'), []);
});

test('parseFotruter hopper over linjer med bare ett punkt', () => {
  const gml = `<app:Fotrute id="x"><gml:posList>61.0 8.0</gml:posList></app:Fotrute>`;
  assert.deepEqual(parseFotruter(gml), []);
});
