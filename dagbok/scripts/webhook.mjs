/**
 * Sier fra til Telegram hvor svarene skal sendes.
 *
 * Kjøres av oppsettskriptet, men finnes for seg selv også – adressen kan bli
 * en annen senere, eller så gikk det galt første gang.
 *
 *   npm run webhook
 */
import { createInterface } from 'node:readline/promises';

const les = createInterface({ input: process.stdin, output: process.stdout });

try {
  console.log('Token får du av @BotFather. Hemmeligheten er den samme som');
  console.log('TELEGRAM_WEBHOOK_HEMMELIG hos Cloudflare – står du fast, sett');
  console.log('en ny med «npx wrangler secret put TELEGRAM_WEBHOOK_HEMMELIG»');
  console.log('og bruk den samme her.\n');

  const token = (await les.question('Telegram-token: ')).trim();
  const adresse = (await les.question('Adressen til appen: ')).trim().replace(/\/+$/, '');
  const hemmelig = (await les.question('TELEGRAM_WEBHOOK_HEMMELIG: ')).trim();

  const svar = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${adresse}/api/telegram`,
      secret_token: hemmelig,
      allowed_updates: ['message', 'callback_query'],
    }),
  }).then((r) => r.json());

  console.log(svar?.ok ? '\n✓ Ferdig.' : `\n✖ ${svar?.description ?? 'Ukjent feil'}`);
  if (!svar?.ok) process.exitCode = 1;
} finally {
  les.close();
}
