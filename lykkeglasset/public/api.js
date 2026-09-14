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
