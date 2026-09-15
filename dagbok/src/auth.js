/**
 * Innlogging. To personer, én kode hver, og en signert informasjonskapsel som
 * varer et halvår – så slipper forfatteren å taste noe for å skrive tre linjer.
 *
 * Kodene og sesjonsnøkkelen kommer fra `wrangler secret put` og finnes ikke i
 * repoet.
 */

const ENC = new TextEncoder();
export const COOKIE = 'lg_sesjon';
const LEVETID_DAGER = 180;

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

async function signer(data, hemmelig) {
  const nøkkel = await crypto.subtle.importKey(
    'raw', ENC.encode(hemmelig), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', nøkkel, ENC.encode(data)));
}

/**
 * Sammenligner to strenger uten å røpe hvor de begynner å skille lag.
 * Lengden lekker fortsatt, men det er ikke lengden noen gjetter seg til en
 * kode av.
 */
export function likeStrenger(a = '', b = '') {
  const x = ENC.encode(String(a));
  const y = ENC.encode(String(b));
  let ulik = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) ulik |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return ulik === 0;
}

/* ---------- koder ---------- */

/**
 * Cloudflare Workers nekter PBKDF2 over 100 000 runder. Node har ingen slik
 * grense, så et høyere tall går rett gjennom testene og faller først på
 * serveren – derfor står taket her, og derfor tester vi det.
 */
const MAKS_RUNDER = 100000;
const RUNDER = MAKS_RUNDER;

async function utled(kode, salt, runder) {
  const grunn = await crypto.subtle.importKey('raw', ENC.encode(kode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: Math.min(runder, MAKS_RUNDER), hash: 'SHA-256' }, grunn, 256,
  );
  return base64url(bits);
}

/**
 * Gjør en kode om til noe som kan lagres.
 *
 * Kodene begynner som hemmeligheter hos Cloudflare, men de må kunne byttes
 * uten en maskin med wrangler på. Da må de ligge i databasen – og en kode i
 * klartekst i en database er en kode på avveie den dagen databasen er det.
 */
export async function lagKode(kode) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${RUNDER}$${base64url(salt)}$${await utled(kode, salt, RUNDER)}`;
}

/** @returns {Promise<boolean>} om koden stemmer med det lagrede. */
export async function stemmerKode(kode, lagret) {
  const [merke, runder, salt, fasit] = String(lagret ?? '').split('$');
  if (merke !== 'pbkdf2' || !runder || !salt || !fasit) return false;
  // En lagring vi ikke kan regne oss fram til, skal svare nei – ikke krasje.
  if (Number(runder) > MAKS_RUNDER) return false;
  const bytes = Uint8Array.from(
    atob(salt.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0),
  );
  return likeStrenger(await utled(kode, bytes, Number(runder)), fasit);
}

/**
 * Lager et token på formen `hvem.utløper.signatur`.
 *
 * `levetidMs` er der for engangslenkene fra Telegram: de skal vare minutter,
 * ikke måneder.
 */
export async function lagToken(hvem, hemmelig, nå = Date.now(), levetidMs = LEVETID_DAGER * 86400000) {
  const utløper = nå + levetidMs;
  const kropp = `${hvem}.${utløper}`;
  return `${kropp}.${await signer(kropp, hemmelig)}`;
}

/** @returns {Promise<string|null>} hvem tokenet tilhører, eller null. */
export async function lesToken(token, hemmelig, nå = Date.now()) {
  if (!token) return null;
  const biter = String(token).split('.');
  if (biter.length !== 3) return null;
  const [hvem, utløper, signatur] = biter;
  const fasit = await signer(`${hvem}.${utløper}`, hemmelig);
  if (!likeStrenger(signatur, fasit)) return null;
  if (!Number(utløper) || Number(utløper) < nå) return null;
  return hvem;
}

/** Plukker én informasjonskapsel ut av `Cookie`-hodet. */
export function lesCookie(req, navn = COOKIE) {
  const rå = req.headers.get('Cookie') ?? '';
  for (const del of rå.split(';')) {
    const [k, ...v] = del.trim().split('=');
    if (k === navn) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function settCookie(token) {
  const maks = LEVETID_DAGER * 86400;
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maks}; HttpOnly; Secure; SameSite=Lax`;
}

export const slettCookie = () =>
  `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
