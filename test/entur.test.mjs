import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODES, describeMode, directionsUrl } from '../src/js/api/entur.js';

const source = await readFile(new URL('../src/js/api/entur.js', import.meta.url), 'utf8');
const query = source.slice(source.indexOf('const QUERY = `') + 'const QUERY = `'.length, source.indexOf('`;', source.indexOf('const QUERY = `')));

test('spørringen har ingen JavaScript-kommentarer i seg', () => {
  // GraphQL kommenterer med #. En skråstrek-stjerne her gjør hele spørringen
  // ugyldig, og Entur svarer med syntaksfeil i stedet for reiseforslag.
  assert.ok(!query.includes('/*'), 'fant /* i GraphQL-spørringen');
  assert.ok(!query.includes('*/'), 'fant */ i GraphQL-spørringen');
  assert.ok(!/^\s*\/\//m.test(query), 'fant // i GraphQL-spørringen');
});

test('spørringen er balansert', () => {
  const tell = (tegn) => [...query].filter((c) => c === tegn).length;
  assert.equal(tell('{'), tell('}'), 'ubalanserte krøllparenteser');
  assert.equal(tell('('), tell(')'), 'ubalanserte parenteser');
  assert.equal(tell('['), tell(']'), 'ubalanserte hakeparenteser');
});

test('ekspressbuss er med, ellers finnes ingen vei til fjellet', () => {
  // Uten coach fant Entur ingen forbindelse til Gjendesheim i det hele tatt.
  assert.match(query, /transportMode: coach/);
  assert.match(query, /transportMode: bus/);
  assert.match(query, /transportMode: rail/);
  // Fløibanen og Ulriksbanen.
  assert.match(query, /transportMode: funicular/);
  assert.match(query, /transportMode: cableway/);
});

test('hver transportmåte i spørringen har ikon og navn', () => {
  const brukte = [...query.matchAll(/transportMode: (\w+)/g)].map((m) => m[1]);
  for (const mode of brukte) {
    assert.ok(MODES[mode], `mangler ikon og navn for «${mode}»`);
  }
});

test('ukjente transportmåter får et nøytralt svar', () => {
  assert.deepEqual(describeMode('bus'), { icon: '🚌', label: 'Buss' });
  assert.equal(describeMode('rakett').label, 'rakett');
});

test('veibeskrivelsen peker på riktige koordinater', () => {
  const url = directionsUrl({ lat: 61.49582, lon: 8.82831 });
  assert.match(url, /destination=61\.49582,8\.82831/);
});
