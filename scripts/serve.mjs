/**
 * Minimal statisk server for lokal utvikling.
 *
 *   npm start        → http://localhost:8080
 *   npm start 3000   → annen port
 *
 * Prosjektet har ingen byggesteg; enhver statisk server duger.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gpx': 'application/gpx+xml',
};

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = join(ROOT, normalize(path === '/' ? '/index.html' : path));
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end('Forbudt');
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Fant ikke filen');
  }
}).listen(PORT, () => {
  console.log(`Turplan kjører på http://localhost:${PORT}`);
});
