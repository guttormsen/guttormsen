/**
 * Snøskredvarsel fra NVE / Varsom.
 * https://api01.nve.no/hydrology/forecast/avalanche/v6.3.0/documentation/
 */
import { request } from './http.js';
import { API } from '../config.js';

export const DANGER_LEVELS = {
  1: { label: 'Liten', color: '#4a9d5b', advice: 'Stort sett trygge forhold. Vurder terrenget lokalt.' },
  2: { label: 'Moderat', color: '#f0c419', advice: 'Unngå de brattest partiene i utsatte himmelretninger.' },
  3: { label: 'Betydelig', color: '#e88a1a', advice: 'Krevende. Hold deg unna terreng brattere enn 30°.' },
  4: { label: 'Stor', color: '#d63b2f', advice: 'Ikke gå i eller under skredterreng.' },
  5: { label: 'Meget stor', color: '#1b1b1b', advice: 'Ekstraordinære forhold. Hold deg i dalbunnen.' },
};

const isoDate = (date) => date.toISOString().slice(0, 10);

/**
 * Skredvarsel for et punkt de neste dagene.
 * Utenfor sesong svarer NVE med nivå "0" / "Ikke vurdert"; de filtreres bort her.
 *
 * @param {{lat:number,lon:number}} point
 * @param {{ from?: Date, days?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{region: string|null, warnings: Array<object>}>}
 */
export async function fetchAvalancheWarning({ lat, lon }, { from = new Date(), days = 2, signal } = {}) {
  const to = new Date(from.getTime() + days * 86400000);
  const url = `${API.varsom}/${lat.toFixed(4)}/${lon.toFixed(4)}/1/${isoDate(from)}/${isoDate(to)}`;

  let data;
  try {
    data = await request(url, { ttl: 30 * 60 * 1000, signal, retries: 1, timeout: 12000 });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { region: null, warnings: [], unavailable: true };
  }

  const rows = Array.isArray(data) ? data : [];
  const warnings = rows
    .map((row) => ({
      date: new Date(row.ValidFrom),
      level: Number(row.DangerLevel) || 0,
      text: row.MainText ?? '',
      region: row.RegionName ?? null,
    }))
    .filter((w) => w.level >= 1);

  return { region: rows[0]?.RegionName ?? null, warnings };
}
