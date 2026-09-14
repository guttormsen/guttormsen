/**
 * Veien til serveren.
 *
 * Hele grensesnittet snakker med baksiden gjennom denne ene funksjonen, og
 * ingen andre steder. Det er derfor appen kan kjøre både mot Cloudflare-
 * workeren og mot et helt annet lager uten at en eneste skjerm endres – det
 * er bare denne fila som byttes ut.
 */
/** Denne utgaven snakker med en server som kan sende Telegram-varsler. */
export const VARSLER = true;
/** …og som har et sted å legge bilder og lyd. */
export const KAN_FILER = true;

/** Laster opp rå bytes. Går utenom `api()`, som bare kan JSON. */
export async function lastOpp(sti, data, type) {
  const svar = await fetch(`/api${sti}`, { method: 'POST', headers: { 'Content-Type': type }, body: data });
  const ut = await svar.json().catch(() => ({}));
  if (!svar.ok) throw new Error(ut.feil || 'Fikk ikke lastet opp.');
  return ut;
}

/** Henter noe som ikke er JSON – brukt til eksportfila. */
export const hentFil = (sti) => fetch(`/api${sti}`);

export async function api(sti, { metode = 'GET', kropp } = {}) {
  const svar = await fetch(`/api${sti}`, {
    method: metode,
    headers: kropp ? { 'Content-Type': 'application/json' } : undefined,
    body: kropp ? JSON.stringify(kropp) : undefined,
  });
  const data = await svar.json().catch(() => ({}));
  if (!svar.ok) throw new Error(data.feil || 'Noe gikk galt.');
  return data;
}
