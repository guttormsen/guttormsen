/**
 * Vær langs ruta – ikke bare på startpunktet.
 *
 * Vi plukker ut noen sjekkpunkter, regner ut når turgåeren er der, og henter
 * varselet for akkurat det stedet på akkurat den timen.
 */
import { fetchForecast, fetchSun, pickNearest } from './api/met.js';
import { mapLimit } from './util.js';

/** Maks antall punkter vi spør MET om, av hensyn til tjenesten. */
const MAX_CHECKPOINTS = 5;

/**
 * Velger sjekkpunkter jevnt fordelt på gåtid – start og mål er alltid med.
 * @param {object} summary resultatet fra `summarise()`
 * @param {Date} startTime
 */
export function buildCheckpoints(summary, startTime) {
  const { line, distances, time } = summary;
  const totalSeconds = time.movingSeconds;
  const count = Math.min(MAX_CHECKPOINTS, Math.max(2, Math.round(totalSeconds / 3600) + 1));

  const indices = new Set([0, line.length - 1]);
  for (let i = 1; i < count - 1; i++) {
    const target = (totalSeconds * i) / (count - 1);
    let closest = 0;
    let bestDiff = Infinity;
    time.cumulativeSeconds.forEach((seconds, index) => {
      const diff = Math.abs(seconds - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = index;
      }
    });
    indices.add(closest);
  }

  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => {
      // Pauser legges til proporsjonalt, så ankomsttiden blir realistisk.
      const movingSeconds = time.cumulativeSeconds[index];
      const share = totalSeconds > 0 ? movingSeconds / totalSeconds : 0;
      const eta = new Date(startTime.getTime() + (movingSeconds + time.breakSeconds * share) * 1000);
      return {
        index,
        point: line[index],
        distance: distances[index],
        elevation: summary.elevations[index],
        eta,
        label: index === 0 ? 'Start' : index === line.length - 1 ? 'Mål' : null,
      };
    });
}

/**
 * Henter varsel for hvert sjekkpunkt.
 * Feiler ett punkt, får de andre stå – delvis vær er bedre enn ingenting.
 */
export async function loadWeather(checkpoints, { signal } = {}) {
  return mapLimit(checkpoints, 2, async (checkpoint) => {
    try {
      const { series, updatedAt } = await fetchForecast(checkpoint.point, { signal });
      return { ...checkpoint, forecast: pickNearest(series, checkpoint.eta), updatedAt };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ...checkpoint, forecast: null, error: true };
    }
  });
}

/** Dagslys for startpunktet på turdagen. */
export async function loadSun(point, date, { signal } = {}) {
  try {
    return await fetchSun(point, date, { signal });
  } catch {
    return null;
  }
}

/**
 * Sammenligner planlagt slutt-tid med solnedgang.
 * @returns {{status:'ok'|'knapt'|'mørkt', minutesOfLight:number}|null}
 */
export function daylightCheck(sun, startTime, totalSeconds) {
  if (!sun?.sunset) return null;
  const finish = new Date(startTime.getTime() + totalSeconds * 1000);
  const minutesOfLight = (sun.sunset.getTime() - finish.getTime()) / 60000;
  if (minutesOfLight < 0) return { status: 'mørkt', minutesOfLight, finish };
  if (minutesOfLight < 60) return { status: 'knapt', minutesOfLight, finish };
  return { status: 'ok', minutesOfLight, finish };
}
