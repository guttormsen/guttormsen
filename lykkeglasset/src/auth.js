/**
 * Innlogging. To personer, én kode hver, og en signert informasjonskapsel som
 * varer et halvår – så slipper hun å taste noe for å skrive tre linjer.
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

/** Lager et token på formen `hvem.utløper.signatur`. */
export async function lagToken(hvem, hemmelig, nå = Date.now()) {
  const utløper = nå + LEVETID_DAGER * 86400000;
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
