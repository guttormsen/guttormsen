import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ryddDag, varslerForDag, melding, BEHOV } from '../src/varsler.js';

const dag = (over = {}) => ({
  dato: '2026-09-14',
  humor: 3,
  gode_ting: [],
  tungt: null,
  behov: null,
  del_gode: true,
  del_tungt: false,
  privat: false,
  ...over,
});

const slag = (arg) => varslerForDag(arg).map((v) => v.slag);

/* ---------- rydding ---------- */

test('humøret holdes innenfor 1–5', () => {
  assert.equal(ryddDag({ humor: 9 }).humor, 5);
  assert.equal(ryddDag({ humor: -3 }).humor, 1);
  assert.equal(ryddDag({ humor: 'tull' }).humor, 3);
});

test('bare tre gode ting, og bare de som har tekst', () => {
  const r = ryddDag({
    gode_ting: [
      { tekst: ' kaffe ', merket: true },
      { tekst: '' },
      { tekst: 'sol' },
      { tekst: 'en til' },
      { tekst: 'og en til' },
    ],
  });
  assert.deepEqual(r.gode_ting, [
    { tekst: 'kaffe', merket: true },
    { tekst: 'sol', merket: false },
    { tekst: 'en til', merket: false },
  ]);
});

test('ukjente behov kastes', () => {
  assert.equal(ryddDag({ behov: 'ringe' }).behov, 'ringe');
  assert.equal(ryddDag({ behov: 'constructor' }).behov, null);
  assert.equal(ryddDag({ behov: 'noe helt annet' }).behov, null);
});

test('en dag deles som standard, og deles da helt', () => {
  const r = ryddDag({});
  assert.equal(r.privat, 0);
  assert.equal(r.del_gode, 1);
  assert.equal(r.del_tungt, 1);
});

test('en privat dag deler ingenting – valget er ett, ikke tre', () => {
  const r = ryddDag({ privat: true, del_gode: true, del_tungt: true });
  assert.equal(r.privat, 1);
  assert.equal(r.del_gode, 0);
  assert.equal(r.del_tungt, 0);
});

test('i delt modus finnes ikke privat-valget', () => {
  const r = ryddDag({ privat: true }, true);
  assert.equal(r.privat, 0);
  assert.equal(r.del_tungt, 1);
});

/* ---------- hva som utløser varsel ---------- */

test('en privat dag sender ingenting, uansett hvor lav den er', () => {
  assert.deepEqual(slag({ dag: dag({ humor: 1, behov: 'ringe', privat: true }) }), []);
});

test('en vanlig dag går fram, men uten lyd', () => {
  const ut = varslerForDag({ dag: dag({ humor: 3 }) });
  assert.deepEqual(ut.map((v) => v.slag), ['dagen']);
  assert.equal(ut[0].stille, true);
});

test('tung dag varsler', () => {
  assert.deepEqual(slag({ dag: dag({ humor: 2 }) }), ['tung']);
  assert.deepEqual(slag({ dag: dag({ humor: 1 }) }), ['tung']);
});

test('skikkelig god dag varsler også – ellers blir appen et alarmanlegg', () => {
  assert.deepEqual(slag({ dag: dag({ humor: 5 }) }), ['god']);
});

test('«ring meg» går foran, og erstatter det vanlige tungvarselet', () => {
  assert.deepEqual(slag({ dag: dag({ humor: 2, behov: 'ringe' }) }), ['rop']);
  assert.deepEqual(slag({ dag: dag({ humor: 4, behov: 'komme' }) }), ['rop']);
});

test('behov uten hast gir ikke lyd, men står i dagsvarselet', () => {
  const ut = varslerForDag({ dag: dag({ humor: 4, behov: 'klem' }) });
  assert.deepEqual(ut.map((v) => v.slag), ['dagen']);
  assert.equal(ut[0].stille, true);
  assert.ok(ut[0].tekst.includes('en klem'));
  assert.deepEqual(slag({ dag: dag({ humor: 2, behov: 'alene' }) }), ['tung']);
});

test('to tunge dager på rad gir en ekstra, stille beskjed', () => {
  const ut = varslerForDag({ dag: dag({ humor: 2 }), igår: dag({ humor: 1 }) });
  assert.deepEqual(ut.map((v) => v.slag), ['tung', 'monster']);
  assert.equal(ut.find((v) => v.slag === 'monster').stille, true);
  assert.equal(ut.find((v) => v.slag === 'tung').stille, false);
});

test('en privat gårsdag teller ikke som tung dag nummer én', () => {
  assert.deepEqual(
    slag({ dag: dag({ humor: 2 }), igår: dag({ humor: 1, privat: true }) }),
    ['tung'],
  );
});

test('det som alt er sendt, sendes ikke om igjen når dagen rettes', () => {
  assert.deepEqual(slag({ dag: dag({ humor: 2 }), sendt: ['tung'] }), []);
  // Dagsvarselet skal heller ikke smette inn i etterkant: er noe alt sagt om
  // dagen, er den meldt.
  assert.deepEqual(slag({ dag: dag({ humor: 3 }), sendt: ['dagen'] }), []);
  assert.deepEqual(slag({ dag: dag({ humor: 3 }) }), ['dagen']);
  assert.deepEqual(
    slag({ dag: dag({ humor: 2 }), igår: dag({ humor: 2 }), sendt: ['tung'] }),
    ['monster'],
  );
});

/* ---------- teksten ---------- */

test('fritekst kommer med i en delt dag, og finnes ikke i en privat', () => {
  const delt = ryddDag({ humor: 2, tungt: 'krangel' });
  assert.ok(melding('tung', { ...dag(), ...delt }).includes('krangel'));
  assert.deepEqual(varslerForDag({ dag: { ...dag(), ...ryddDag({ humor: 2, tungt: 'krangel', privat: true }), privat: 1 } }), []);
});

test('gode ting holdes tilbake når forfatteren har skrudd av delingen', () => {
  const d = dag({ humor: 5, gode_ting: [{ tekst: 'kaffe' }], del_gode: false });
  assert.ok(!melding('god', d).includes('kaffe'));
  assert.ok(melding('god', { ...d, del_gode: true }).includes('kaffe'));
});

test('ropet sier hva forfatteren ber om', () => {
  const tekst = melding('rop', dag({ humor: 2, behov: 'komme' }));
  assert.ok(tekst.includes(BEHOV.komme.etikett.toLowerCase()));
  assert.ok(tekst.includes('2 av 5'));
});
