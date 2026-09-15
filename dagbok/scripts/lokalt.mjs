/**
 * Kjører hele appen på egen maskin, uten Cloudflare og uten konto noe sted.
 *
 *   npm run lokalt
 *
 * Databasen er en fil i .wrangler/lokalt.sqlite, kodene er «forfatter» og
 * «leser», og Telegram-meldinger skrives i terminalen i stedet for å sendes.
 * Det er nok til å se hvordan appen kjennes ut før noe legges ut.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

const ROT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OFFENTLIG = join(ROT, 'public');
const PORT = Number(process.env.PORT) || 8787;

mkdirSync(join(ROT, '.wrangler'), { recursive: true });
const db = new DatabaseSync(join(ROT, '.wrangler', 'lokalt.sqlite'));
db.exec(readFileSync(join(ROT, 'schema.sql'), 'utf8'));

/* D1-grensesnittet over vanlig SQLite. Samme form, ikke samme motor. */
class Setning {
  constructor(sql) { this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async all() { return { results: db.prepare(this.sql).all(...this.args) }; }
  async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
  async run() {
    const r = db.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(r.changes) } };
  }
}

const TYPER = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

// Bilder og lyd. Filer på disk her, KV i skyen – samme tre metodene.
const FILROT = join(ROT, '.wrangler', 'filer');
mkdirSync(FILROT, { recursive: true });
const filsti = (navn) => join(FILROT, navn.replaceAll(':', '_'));

const env = {
  DB: {
    prepare: (sql) => new Setning(sql),
    batch: async (setninger) => Promise.all(setninger.map((s) => s.run())),
  },
  FILER: {
    async put(navn, data) { writeFileSync(filsti(navn), Buffer.from(data)); },
    async get(navn) {
      if (!existsSync(filsti(navn))) return null;
      // `.buffer` på en Node-buffer er hele den delte minneblokka, ikke fila.
      // Uten dette snittet sendes naboens bytes med.
      const b = readFileSync(filsti(navn));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
    async delete(navn) { if (existsSync(filsti(navn))) rmSync(filsti(navn)); },
  },
  ASSETS: {
    async fetch(req) {
      const sti = new URL(req.url).pathname;
      const rel = normalize(sti === '/' ? 'index.html' : sti.replace(/^\/+/, ''));
      const fil = join(OFFENTLIG, rel);
      if (!fil.startsWith(OFFENTLIG) || !existsSync(fil)) {
        return new Response('Ikke her', { status: 404 });
      }
      return new Response(readFileSync(fil), {
        headers: { 'Content-Type': TYPER[extname(fil)] ?? 'application/octet-stream' },
      });
    },
  },
  KODE_FORFATTER: process.env.KODE_FORFATTER || 'forfatter',
  KODE_LESER: process.env.KODE_LESER || 'leser',
  SESJON_HEMMELIG: 'bare-lokalt',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  TIDSSONE: 'Europe/Oslo',
  PAMINNELSE_KL: '21:30',
  // Kjør med STENGT=ja for å se skiltet i stedet for appen.
  STENGT: process.env.STENGT || 'nei',
};

createServer(async (inn, ut) => {
  const kropp = inn.method === 'GET' || inn.method === 'HEAD'
    ? undefined
    : Buffer.concat(await inn.toArray());
  const req = new Request(`http://localhost:${PORT}${inn.url}`, {
    method: inn.method,
    headers: inn.headers,
    body: kropp?.length ? kropp : undefined,
  });

  const svar = await worker.fetch(req, env, { waitUntil: (p) => p });
  ut.writeHead(svar.status, Object.fromEntries(svar.headers));
  ut.end(Buffer.from(await svar.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`🫙  Dagbok kjører på http://localhost:${PORT}`);
  console.log(`   Koder: «${env.KODE_FORFATTER}» og «${env.KODE_LESER}».`);
  if (!env.TELEGRAM_TOKEN) console.log('   Uten TELEGRAM_TOKEN sendes ingen varsler.');
});
