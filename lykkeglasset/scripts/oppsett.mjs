/**
 * Setter opp hele appen i ett kjør.
 *
 * Du trenger ikke en server. Cloudflare kjører både siden og API-et gratis,
 * og dette skriptet gjør de fem tingene som ellers måtte gjøres for hånd:
 * logge inn, lage databasen, sette inn tabellene, legge inn hemmelighetene og
 * legge appen ut.
 *
 *   npm run oppsett
 *
 * Det kan kjøres om igjen. Steg som alt er gjort, hoppes over.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = join(ROT, 'wrangler.toml');
const DB = 'lykkeglasset';
const les = createInterface({ input: process.stdin, output: process.stdout });

const si = (...t) => console.log(...t);
const overskrift = (t) => si(`\n\x1b[1m${t}\x1b[0m`);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Lar wrangler skrive rett til skjermen, så du kan svare på det den spør om. */
function wrangler(args) {
  const res = spawnSync('npx', ['wrangler', ...args], { cwd: ROT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.error) throw new Error(`Fikk ikke kjørt wrangler: ${res.error.message}`);
  return res.status === 0;
}

/**
 * Kjører wrangler og fanger utskriften. `CI` settes fordi wrangler ellers kan
 * stille et spørsmål ingen ser – utskriften går jo ikke til skjermen her.
 */
function wranglerStille(args) {
  const res = spawnSync('npx', ['wrangler', ...args], {
    cwd: ROT,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    shell: process.platform === 'win32',
  });
  return `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
}

async function spør(tekst, { påkrevd = true } = {}) {
  for (;;) {
    const svar = (await les.question(`${tekst} `)).trim();
    if (svar || !påkrevd) return svar;
    si('  (må fylles ut)');
  }
}

const jaNei = async (tekst) => /^j/i.test(await spør(`${tekst} [j/N]`, { påkrevd: false }) || 'n');

/** Sender hemmeligheten på standard inn, så den aldri blir et argument. */
function settHemmelighet(navn, verdi) {
  const res = spawnSync('npx', ['wrangler', 'secret', 'put', navn], {
    cwd: ROT,
    input: `${verdi}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) throw new Error(`Fikk ikke satt ${navn}`);
  return true;
}

/** Finner databasens id, enten den er ny eller laget fra før. */
function finnDatabaseId() {
  const laget = wranglerStille(['d1', 'create', DB]);
  const fraNy = laget.match(UUID);
  if (fraNy) return fraNy[0];

  // Finnes den alt, sier `create` ifra, og `info` vet id-en.
  const info = wranglerStille(['d1', 'info', DB]);
  const fraInfo = info.match(UUID);
  if (fraInfo) return fraInfo[0];

  si(laget.trim());
  si(info.trim());
  throw new Error(
    'Fant ikke database-id. Kjør «npx wrangler d1 info lykkeglasset» og lim id-en inn i wrangler.toml.',
  );
}

try {
  si('🫙  Lykkeglasset – oppsett\n');
  si('Dette tar et par minutter. Alt som spørres om, blir liggende hos');
  si('Cloudflare – ingenting av det havner i koden eller på GitHub.');

  /* 1. Innlogging */
  overskrift('1 av 5 · Cloudflare');
  si('En nettleser åpner seg. Lag konto hvis du ikke har – det er gratis og');
  si('krever ikke betalingskort.\n');
  if (!wrangler(['login'])) {
    si('\nInnloggingen svarte ikke OK. Er du alt logget inn, er det helt i orden.');
    if (!await jaNei('Gå videre?')) process.exit(1);
  }

  /* 2. Database */
  overskrift('2 av 5 · Database');
  let toml = readFileSync(TOML, 'utf8');
  if (toml.includes('SETT_INN_HER')) {
    const id = finnDatabaseId();
    writeFileSync(TOML, toml.replace('SETT_INN_HER', id));
    toml = readFileSync(TOML, 'utf8');
    si(`  database_id satt til ${id}`);
  } else {
    si('  Står alt i wrangler.toml. Hopper over.');
  }

  /* 3. Tabeller */
  overskrift('3 av 5 · Tabeller');
  si('  (schema.sql kan kjøres om igjen uten at noe går tapt)\n');
  if (!wrangler(['d1', 'execute', DB, '--remote', '--file=schema.sql', '--yes'])) {
    throw new Error('Fikk ikke satt inn tabellene.');
  }

  /* 4. Hemmeligheter */
  overskrift('4 av 5 · Koder og token');
  si('Kodene er det dere to taster inn i appen. Velg noe dere husker, men');
  si('ikke de fire sifrene telefonen låses opp med. Minst seks tegn.\n');

  const kodeLykke = await spør('Kode for Lykke:');
  const kodeMathias = await spør('Kode for Mathias:');
  si('\nTelegram-token får du av @BotFather i Telegram: /mybots → velg boten');
  si('→ API Token. Har tokenet vært innom en chat eller e-post, lag et nytt');
  si('med /revoke først.\n');
  const token = await spør('Telegram-token:');

  // Disse skal ingen taste inn, og ingen trenger å kunne.
  const tilfeldig = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const webhookHemmelig = tilfeldig();

  settHemmelighet('KODE_LYKKE', kodeLykke);
  settHemmelighet('KODE_MATHIAS', kodeMathias);
  settHemmelighet('TELEGRAM_TOKEN', token);
  settHemmelighet('SESJON_HEMMELIG', tilfeldig());
  settHemmelighet('TELEGRAM_WEBHOOK_HEMMELIG', webhookHemmelig);

  /* 5. Ut i verden */
  overskrift('5 av 6 · Legger ut');
  si('Blir du spurt om et workers.dev-underdomene: velg et navn og svar ja.\n');
  if (!wrangler(['deploy'])) throw new Error('Utleggingen feilet. Se meldingen over.');

  /* 6. Svarveien tilbake */
  overskrift('6 av 6 · Svar fra Telegram');
  si('Adressen står i utskriften rett over – den som slutter på .workers.dev.');
  si('Lim den inn her, så sier jeg fra til Telegram hvor svarene skal.\n');
  const adresse = (await spør('Adressen til appen:')).replace(/\/+$/, '');

  const svar = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${adresse}/api/telegram`,
      secret_token: webhookHemmelig,
      allowed_updates: ['message', 'callback_query'],
    }),
  }).then((r) => r.json()).catch((e) => ({ ok: false, description: e.message }));

  if (svar?.ok) si('  ✓ Telegram sender svarene til appen nå.');
  else si(`  ✖ Fikk ikke satt det opp: ${svar?.description ?? 'ukjent feil'}. Kjør «npm run webhook» senere.`);

  overskrift('Ferdig');
  si(`Appen ligger på ${adresse}`);
  si('\nÅpne den på telefonen og legg den til på hjemskjermen – da ser den ut');
  si('som en app, og den åpner seg uten nettleserlinje.');
  si('\nTre ting igjen:');
  si('  1. Legg boten inn i Telegram-gruppa, og send en melding der etterpå.');
  si('     Uten det kommer ingen varsler fram.');
  si('  2. Send «/eier ' + kodeMathias + '» til boten én gang. Da vet den at det');
  si('     er deg, og bare deg, som kan svare derfra.');
  si('  3. Prøv en dag med 2 av 5, og se at varselet kommer med knapper.');
  si('\nDu trenger aldri taste koden din igjen: send «/logginn» til boten, så');
  si('får du en lenke rett inn i appen.');
  si('\nNoe som ikke virker? «npm run logg» viser hva som skjer i sanntid.');
} catch (feil) {
  console.error(`\n\x1b[31m✖ ${feil.message}\x1b[0m`);
  process.exitCode = 1;
} finally {
  les.close();
}
