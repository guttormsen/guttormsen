/**
 * Rutemodellen: lengde, stigning, tidsbruk og gradering.
 * Rene funksjoner over punktlister – ingen DOM, ingen nettverk.
 */
import { cumulativeDistances, haversine, smooth } from './geo.js';
import { BREAK_MINUTES_PER_HOUR, PACE, TERRAIN } from './config.js';

/** Høydeendringer under denne terskelen regnes som støy i høydemodellen. */
const NOISE_THRESHOLD_M = 2.5;

export const paceById = (id) => PACE.find((p) => p.id === id) ?? PACE[1];
export const terrainById = (id) => TERRAIN.find((t) => t.id === id) ?? TERRAIN[0];

/**
 * Toblers gangfunksjon: km/t som funksjon av helning.
 * Toppfarten ligger på svakt utforbakke (−2,9 %), akkurat som i virkeligheten.
 */
export function toblerSpeed(slope) {
  return 6 * Math.exp(-3.5 * Math.abs(slope + 0.05));
}

const TOBLER_FLAT = toblerSpeed(0); // ≈ 5,04 km/t

/** Tyngre sekk enn 8 kg koster tid; lettere gir en liten, begrenset gevinst. */
export function packFactor(kg) {
  if (!Number.isFinite(kg)) return 1;
  return 1 + Math.max(-0.05, (kg - 8) * 0.012);
}

/**
 * Fyller hull i høydeserien ved lineær interpolasjon mellom kjente naboer,
 * slik at én manglende måling ikke lager et kunstig stup i profilen.
 */
export function fillGaps(elevations) {
  const out = elevations.slice();
  const known = out.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  if (!known.length) return out;
  for (let i = 0; i < out.length; i++) {
    if (Number.isFinite(out[i])) continue;
    const before = known.filter((k) => k < i).pop();
    const after = known.find((k) => k > i);
    if (before == null && after == null) continue;
    if (before == null) out[i] = out[after];
    else if (after == null) out[i] = out[before];
    else out[i] = out[before] + ((out[after] - out[before]) * (i - before)) / (after - before);
  }
  return out;
}

/**
 * Summerer stigning og fall med støyfilter.
 * @returns {{ascent:number, descent:number, min:number, max:number}}
 */
export function elevationStats(elevations) {
  const values = elevations.filter(Number.isFinite);
  if (!values.length) return { ascent: 0, descent: 0, min: null, max: null };

  let ascent = 0;
  let descent = 0;
  let anchor = values[0];
  for (const value of values) {
    const delta = value - anchor;
    if (delta > NOISE_THRESHOLD_M) {
      ascent += delta;
      anchor = value;
    } else if (delta < -NOISE_THRESHOLD_M) {
      descent += -delta;
      anchor = value;
    }
  }
  return { ascent, descent, min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Beregner gåtid segment for segment.
 *
 * @param {Array<{lat:number,lon:number}>} points
 * @param {Array<number|null>} elevations samme lengde som `points`
 * @param {{pace:string, terrain:string, packKg:number, breaks:boolean}} options
 * @returns {{movingSeconds:number, breakSeconds:number, totalSeconds:number,
 *            lowSeconds:number, highSeconds:number, cumulativeSeconds:number[]}}
 */
export function estimateTime(points, elevations, options) {
  const speedFlat = paceById(options.pace).speed;
  const terrain = terrainById(options.terrain).factor;
  const pack = packFactor(options.packKg);
  const scale = speedFlat / TOBLER_FLAT;

  const cumulativeSeconds = new Array(points.length).fill(0);
  let moving = 0;

  for (let i = 1; i < points.length; i++) {
    const distance = haversine(points[i - 1], points[i]);
    if (distance > 0) {
      const a = elevations[i - 1];
      const b = elevations[i];
      const rise = Number.isFinite(a) && Number.isFinite(b) ? b - a : 0;
      const slope = rise / distance;
      // Ekstreme helninger oppstår når høydemodellen treffer en bergvegg – kapp dem.
      const speedKmh = toblerSpeed(Math.max(-0.7, Math.min(0.7, slope))) * scale;
      const speedMs = (speedKmh * 1000) / 3600 / (terrain * pack);
      moving += distance / Math.max(0.15, speedMs);
    }
    cumulativeSeconds[i] = moving;
  }

  const hours = moving / 3600;
  const breakSeconds = options.breaks ? Math.max(0, hours - 1) * BREAK_MINUTES_PER_HOUR * 60 : 0;
  const totalSeconds = moving + breakSeconds;

  return {
    movingSeconds: moving,
    breakSeconds,
    totalSeconds,
    // Terreng, føre og dagsform gir fort ±20 % – vis det heller enn å late som noe annet.
    lowSeconds: totalSeconds * 0.82,
    highSeconds: totalSeconds * 1.22,
    cumulativeSeconds,
  };
}

const GRADES = [
  { id: 'gronn', label: 'Enkel', color: '#2e8b57', description: 'Passer for de fleste, også med barn.' },
  { id: 'bla', label: 'Middels', color: '#2f6fd0', description: 'Krever normal form og turerfaring.' },
  { id: 'rod', label: 'Krevende', color: '#c8422c', description: 'Lang eller bratt. God form anbefales.' },
  { id: 'svart', label: 'Ekspert', color: '#2b2b2b', description: 'Svært lang eller svært bratt. Erfaring kreves.' },
];

/**
 * Gradering etter samme logikk som den nasjonale merkestandarden:
 * lengde, stigning og underlag veies sammen.
 */
export function gradeRoute({ distance, ascent, terrain }) {
  const factor = terrainById(terrain).factor;
  // Ett høydemeter oppover koster omtrent like mye som 8 meter flatt.
  const effortKm = ((distance + ascent * 8) / 1000) * factor;
  if (effortKm < 6) return GRADES[0];
  if (effortKm < 14) return GRADES[1];
  if (effortKm < 28) return GRADES[2];
  return GRADES[3];
}

/**
 * Setter sammen alt vi vet om ruta.
 *
 * @param {Array<{lat:number,lon:number}>} line tettet linje
 * @param {Array<number|null>} rawElevations
 * @param {object} options
 */
export function summarise(line, rawElevations, options) {
  if (line.length < 2) return null;

  const filled = fillGaps(rawElevations ?? []);
  // Litt utjevning fjerner laserstøy uten å spise reell stigning.
  const elevations = filled.length === line.length ? smooth(filled, 1) : new Array(line.length).fill(null);

  const distances = cumulativeDistances(line);
  const distance = distances.at(-1);
  const { ascent, descent, min, max } = elevationStats(elevations);
  const time = estimateTime(line, elevations, options);
  const grade = gradeRoute({ distance, ascent, terrain: options.terrain });

  const steepest = line.reduce((worst, _, i) => {
    if (i === 0) return worst;
    const run = distances[i] - distances[i - 1];
    const rise = (elevations[i] ?? 0) - (elevations[i - 1] ?? 0);
    if (run < 15) return worst;
    const slope = Math.abs(rise / run);
    return slope > worst ? slope : worst;
  }, 0);

  return {
    line,
    elevations,
    distances,
    distance,
    ascent,
    descent,
    minElevation: min,
    maxElevation: max,
    steepestSlope: steepest,
    time,
    grade,
    hasElevation: elevations.some(Number.isFinite),
  };
}
