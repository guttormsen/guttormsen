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
      { tekst: ' kaffe ', om_oss: true },
      { tekst: '' },
      { tekst: 'sol' },
      { tekst: 'en til' },
      { tekst: 'og en til' },
    ],
  });
  assert.deepEqual(r.gode_ting, [
    { tekst: 'kaffe', om_oss: true },
    { tekst: 'sol', om_oss: false },
    { tekst: 'en til', om_oss: false },
  ]);
});

test('ukjente behov kastes', () => {
  assert.equal(ryddDag({ behov: 'ringe' }).behov, 'ringe');
  assert.equal(ryddDag({ behov: 'constructor' }).behov, null);
  assert.equal(ryddDag({ behov: 'noe helt annet' }).behov, null);
});

test('deling er av som standard for det tunge, på for det gode', () => {
  const r = ryddDag({});
  assert.equal(r.del_gode, 1);
  assert.equal(r.del_tungt, 0);
  assert.equal(r.privat, 0);
});

/* ---------- hva som utløser varsel ---------- */

test('en privat dag sender ingenting, uansett hvor lav den er', () => {
  assert.deepEqual(slag({ dag: dag({ humor: 1, behov: 'ringe', privat: true }) }), []);
});

test('midt på treet gir ingen pling', () => {
  assert.deepEqual(slag({ dag: dag({ humor: 3 }) }), []);
  assert.deepEqual(slag({ dag: dag({ humor: 4 }) }), []);
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

test('behov uten hast utløser ikke varsel alene', () => {
  assert.deepEqual(slag({ dag: dag({ humor: 4, behov: 'klem' }) }), []);
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
  assert.deepEqual(
    slag({ dag: dag({ humor: 2 }), igår: dag({ humor: 2 }), sendt: ['tung'] }),
    ['monster'],
  );
});

/* ---------- teksten ---------- */

test('fritekst kommer bare med når hun har delt den', () => {
  const uten = melding('tung', dag({ humor: 2, tungt: 'hemmelig', del_tungt: false }));
  assert.ok(!uten.includes('hemmelig'));
  const med = melding('tung', dag({ humor: 2, tungt: 'hemmelig', del_tungt: true }));
  assert.ok(med.includes('hemmelig'));
});

test('gode ting holdes tilbake når hun har skrudd av delingen', () => {
  const d = dag({ humor: 5, gode_ting: [{ tekst: 'kaffe' }], del_gode: false });
  assert.ok(!melding('god', d).includes('kaffe'));
  assert.ok(melding('god', { ...d, del_gode: true }).includes('kaffe'));
});

test('ropet sier hva hun ber om', () => {
  const tekst = melding('rop', dag({ humor: 2, behov: 'komme' }));
  assert.ok(tekst.includes(BEHOV.komme.etikett.toLowerCase()));
  assert.ok(tekst.includes('2 av 5'));
});
