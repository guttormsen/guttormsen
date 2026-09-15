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

/**
 * En feil appen kan vise fram.
 *
 * `fetch` kaster «Failed to fetch» på engelsk når telefonen er uten dekning.
 * Det er ikke noe å sette foran noen, og det er heller ikke det samme som at
 * økta har gått ut – derfor `frakoblet`, som skjermene kan spørre på.
 */
class Feil extends Error {
  constructor(tekst, { status = 0, frakoblet = false } = {}) {
    super(tekst);
    this.status = status;
    this.frakoblet = frakoblet;
  }
}

const UTEN_NETT = 'Ingen forbindelse akkurat nå. Prøv igjen om litt.';

/** Laster opp rå bytes. Går utenom `api()`, som bare kan JSON. */
export async function lastOpp(sti, data, type) {
  let svar;
  try {
    svar = await fetch(`/api${sti}`, { method: 'POST', headers: { 'Content-Type': type }, body: data });
  } catch {
    throw new Feil(UTEN_NETT, { frakoblet: true });
  }
  const ut = await svar.json().catch(() => ({}));
  if (!svar.ok) throw new Feil(ut.feil || 'Fikk ikke lastet opp.', { status: svar.status });
  return ut;
}

/** Henter noe som ikke er JSON – brukt til eksportfila. */
export const hentFil = (sti) => fetch(`/api${sti}`);

export async function api(sti, { metode = 'GET', kropp } = {}) {
  let svar;
  try {
    svar = await fetch(`/api${sti}`, {
      method: metode,
      headers: kropp ? { 'Content-Type': 'application/json' } : undefined,
      body: kropp ? JSON.stringify(kropp) : undefined,
    });
  } catch {
    throw new Feil(UTEN_NETT, { frakoblet: true });
  }
  const data = await svar.json().catch(() => ({}));
  if (!svar.ok) throw new Feil(data.feil || 'Noe gikk galt.', { status: svar.status });
  return data;
}
