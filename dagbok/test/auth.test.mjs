import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lagToken, lesToken, likeStrenger, lesCookie, settCookie } from '../src/auth.js';

const HEM = 'en-hemmelighet-til-testen';

test('et token leses tilbake til den det tilhører', async () => {
  const t = await lagToken('forfatter', HEM);
  assert.equal(await lesToken(t, HEM), 'forfatter');
});

test('tuklet token godtas ikke', async () => {
  const t = await lagToken('forfatter', HEM);
  const [hvem, utløper, sig] = t.split('.');
  assert.equal(await lesToken(`leser.${utløper}.${sig}`, HEM), null);
  assert.equal(await lesToken(`${hvem}.${utløper}.xxx`, HEM), null);
  assert.equal(await lesToken(t, 'feil nøkkel'), null);
  assert.equal(await lesToken('bare-tull', HEM), null);
  assert.equal(await lesToken(null, HEM), null);
});

test('utløpt token godtas ikke', async () => {
  const t = await lagToken('forfatter', HEM, Date.now() - 400 * 86400000);
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

/* ---------- koder som kan byttes ---------- */

test('en lagret kode kan sjekkes, men ikke leses', async () => {
  const { lagKode, stemmerKode } = await import('../src/auth.js');
  const lagret = await lagKode('sommerfugl');
  assert.ok(!lagret.includes('sommerfugl'), 'koden skal ikke stå der');
  assert.equal(await stemmerKode('sommerfugl', lagret), true);
  assert.equal(await stemmerKode('sommerfug', lagret), false);
  assert.equal(await stemmerKode('', lagret), false);
});

test('to like koder får ulikt salt, og dermed ulik lagring', async () => {
  const { lagKode } = await import('../src/auth.js');
  assert.notEqual(await lagKode('samme'), await lagKode('samme'));
});

test('tull i stedet for en lagret kode slipper ingen inn', async () => {
  const { stemmerKode } = await import('../src/auth.js');
  for (const rart of [null, '', 'bare-tekst', 'pbkdf2$$$', 'md5$1$a$b']) {
    assert.equal(await stemmerKode('hva som helst', rart), false);
  }
});

test('rundetallet holder seg innenfor det Cloudflare tillater', async () => {
  const { lagKode } = await import('../src/auth.js');
  const runder = Number((await lagKode('noe')).split('$')[1]);
  // Workers nekter over 100 000, og feiler først i produksjon om vi bommer.
  assert.ok(runder <= 100000, `${runder} runder er for mange`);
  assert.ok(runder >= 50000, 'og ikke så få at det ikke er verdt noe');
});

test('en lagring med for mange runder svarer nei i stedet for å krasje', async () => {
  const { stemmerKode } = await import('../src/auth.js');
  assert.equal(await stemmerKode('hva som helst', 'pbkdf2$500000$abcd$efgh'), false);
});
