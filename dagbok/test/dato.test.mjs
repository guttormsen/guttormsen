import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dagsnokkel, klokke, minutter, flyttDag, sisteDager, dagerMellom,
  sammeDagIFjor, norskDato, norskUkedag, nårVar,
} from '../src/dato.js';

test('dagsnøkkelen følger norsk tid, ikke UTC', () => {
  // 22:30 UTC i september er 00:30 neste dag i Norge.
  assert.equal(dagsnokkel(new Date('2026-09-14T22:30:00Z')), '2026-09-15');
  assert.equal(dagsnokkel(new Date('2026-09-14T21:59:00Z')), '2026-09-14');
  // Om vinteren er forskjellen én time.
  assert.equal(dagsnokkel(new Date('2026-01-14T23:30:00Z')), '2026-01-15');
});

test('klokka leses i norsk tid', () => {
  assert.equal(klokke(new Date('2026-09-14T19:30:00Z')), '21:30');
  assert.equal(klokke(new Date('2026-01-14T19:30:00Z')), '20:30');
});

test('minutter etter midnatt', () => {
  assert.equal(minutter('21:30'), 1290);
  assert.equal(minutter('00:00'), 0);
  assert.equal(minutter('tull'), null);
});

test('dager flyttes uten at sommertid blander seg inn', () => {
  // Natta til 29. mars 2026 stilles klokka fram i Norge.
  assert.equal(flyttDag('2026-03-29', -1), '2026-03-28');
  assert.equal(flyttDag('2026-03-28', 1), '2026-03-29');
  assert.equal(flyttDag('2026-01-01', -1), '2025-12-31');
  assert.equal(flyttDag('2024-02-28', 1), '2024-02-29');
});

test('siste dager kommer nyeste først', () => {
  assert.deepEqual(sisteDager('2026-01-02', 3), ['2026-01-02', '2026-01-01', '2025-12-31']);
});

test('dager mellom', () => {
  assert.equal(dagerMellom('2026-09-10', '2026-09-14'), 4);
  assert.equal(dagerMellom('2026-09-14', '2026-09-14'), 0);
  assert.equal(dagerMellom('2026-09-15', '2026-09-14'), -1);
  // Over et årsskifte og over sommertidsskiftet.
  assert.equal(dagerMellom('2025-12-30', '2026-01-02'), 3);
  assert.equal(dagerMellom('2026-03-28', '2026-03-30'), 2);
});

test('samme dag i fjor', () => {
  assert.equal(sammeDagIFjor('2026-09-14'), '2025-09-14');
});

test('norske datoer', () => {
  assert.equal(norskDato('2026-09-14'), '14. september');
  assert.equal(norskDato('2026-09-14', true), '14. september 2026');
  assert.equal(norskUkedag('2026-09-14'), 'mandag');
  assert.equal(norskUkedag('2026-09-13'), 'søndag');
});

test('hvor lenge siden', () => {
  assert.equal(nårVar('2026-09-14', '2026-09-14'), 'i dag');
  assert.equal(nårVar('2026-09-13', '2026-09-14'), 'i går');
  assert.equal(nårVar('2026-09-11', '2026-09-14'), 'for 3 dager siden');
});
