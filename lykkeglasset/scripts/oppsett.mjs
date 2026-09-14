/**
 * Setter opp hele appen i ett kjør.
 *
 * Du trenger ikke en server. Cloudflare kjører både siden og API-et gratis,
 * og dette skriptet gjør de fem tingene som ellers måtte gjøres for hånd:
 * logge inn, lage databasen, sette inn tabellene, legge inn hemmelighetene og
 * legge appen ut.
 *
 *   npm run oppsett
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = join(ROT, 'wrangler.toml');
const les = createInterface({ input: process.stdin, output: process.stdout });

const si = (...t) => console.log(...t);
const overskrift = (t) => si(`\n\x1b[1m${t}\x1b[0m`);

/** Kjører wrangler og lar den skrive rett til skjermen. */
const wrangler = (args, valg = {}) =>
  spawnSync('npx', ['wrangler', ...args], { cwd: ROT, stdio: 'inherit', ...valg });

/** Kjører wrangler og fanger utskriften, for når vi skal lese noe ut av den. */
const wranglerStille = (args) =>
  execFileSync('npx', ['wrangler', ...args], { cwd: ROT, encoding: 'utf8' });

async function spør(tekst, { påkrevd = true } = {}) {
  for (;;) {
    const svar = (await les.question(`${tekst} `)).trim();
    if (svar || !påkrevd) return svar;
    si('  (må fylles ut)');
  }
}

/** Sender en hemmelighet inn til wrangler på standard inn, så den aldri blir et argument. */
function settHemmelighet(navn, verdi) {
  const res = spawnSync('npx', ['wrangler', 'secret', 'put', navn], {
    cwd: ROT,
    input: `${verdi}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (res.status !== 0) throw new Error(`Fikk ikke satt ${navn}`);
}

try {
  si('🫙  Lykkeglasset – oppsett\n');
  si('Dette tar et par minutter. Alt som spørres om, blir liggende hos');
  si('Cloudflare – ingenting av det havner i koden eller på GitHub.');

  /* 1. Innlogging */
  overskrift('1. Cloudflare');
  si('En nettleser åpner seg. Lag konto hvis du ikke har – det er gratis og');
  si('krever ikke kort.');
  wrangler(['login']);

  /* 2. Database */
  overskrift('2. Database');
  let toml = readFileSync(TOML, 'utf8');
  if (toml.includes('SETT_INN_HER')) {
    const ut = wranglerStille(['d1', 'create', 'lykkeglasset']);
    const id = ut.match(/database_id\s*=\s*"([0-9a-f-]+)"/i)?.[1]
      ?? ut.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
    if (!id) {
      si(ut);
      throw new Error('Fant ikke database_id i svaret. Lim den inn i wrangler.toml for hånd.');
    }
    toml = toml.replace('SETT_INN_HER', id);
    writeFileSync(TOML, toml);
    si(`  database_id satt til ${id}`);
  } else {
    si('  Databasen er alt satt opp i wrangler.toml – hopper over.');
  }

  overskrift('3. Tabeller');
  wrangler(['d1', 'execute', 'lykkeglasset', '--remote', '--file=schema.sql', '--yes']);

  /* 4. Hemmeligheter */
  overskrift('4. Koder og token');
  si('Kodene er det dere to taster inn i appen. Velg noe dere husker, men som');
  si('ikke er de fire sifrene telefonen deres låses opp med.\n');

  const kodeLykke = await spør('Kode for Lykke:');
  const kodeMathias = await spør('Kode for Mathias:');
  si('\nTelegram-token får du av @BotFather i Telegram (/mybots → API Token).');
  const token = await spør('Telegram-token:');

  settHemmelighet('KODE_LYKKE', kodeLykke);
  settHemmelighet('KODE_MATHIAS', kodeMathias);
  settHemmelighet('TELEGRAM_TOKEN', token);
  // Sesjonsnøkkelen skal ingen taste inn, og ingen trenger å kunne.
  settHemmelighet('SESJON_HEMMELIG', Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));

  /* 5. Ut i verden */
  overskrift('5. Legger ut');
  wrangler(['deploy']);

  overskrift('Ferdig');
  si('Adressen står rett over. Åpne den på telefonen og legg den til på');
  si('hjemskjermen – da ser den ut som en app og varslene virker som de skal.');
  si('\nEn ting til: send en melding i Telegram-gruppa og sjekk at boten');
  si('faktisk er medlem der. Uten det kommer ingen varsler fram.');
} catch (feil) {
  console.error(`\n✖ ${feil.message}`);
  process.exitCode = 1;
} finally {
  les.close();
}
