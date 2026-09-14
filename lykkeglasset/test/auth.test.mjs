import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lagToken, lesToken, likeStrenger, lesCookie, settCookie } from '../src/auth.js';

const HEM = 'en-hemmelighet-til-testen';

test('et token leses tilbake til den det tilhører', async () => {
  const t = await lagToken('lykke', HEM);
  assert.equal(await lesToken(t, HEM), 'lykke');
});

test('tuklet token godtas ikke', async () => {
  const t = await lagToken('lykke', HEM);
  const [hvem, utløper, sig] = t.split('.');
  assert.equal(await lesToken(`mathias.${utløper}.${sig}`, HEM), null);
  assert.equal(await lesToken(`${hvem}.${utløper}.xxx`, HEM), null);
  assert.equal(await lesToken(t, 'feil nøkkel'), null);
  assert.equal(await lesToken('bare-tull', HEM), null);
  assert.equal(await lesToken(null, HEM), null);
});

test('utløpt token godtas ikke', async () => {
  const t = await lagToken('lykke', HEM, Date.now() - 400 * 86400000);
  assert.equal(await lesToken(t, HEM), null);
});

test('strengsammenligning tåler ulike lengder', () => {
  assert.equal(likeStrenger('abc', 'abc'), true);
  assert.equal(likeStrenger('abc', 'abcd'), false);
  assert.equal(likeStrenger('', ''), true);
  assert.equal(likeStrenger(undefined, ''), true);
  assert.equal(likeStrenger('abc', 'abd'), false);
});

test('informasjonskapselen plukkes ut av hodet', () => {
  const req = { headers: { get: () => 'annet=1; lg_sesjon=verdi%2Etull; til=2' } };
  assert.equal(lesCookie(req), 'verdi.tull');
  assert.equal(lesCookie({ headers: { get: () => '' } }), null);
});

test('kapselen settes med de flaggene som faktisk beskytter den', () => {
  const h = settCookie('abc');
  for (const flagg of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
    assert.ok(h.includes(flagg), `mangler ${flagg}`);
  }
});
