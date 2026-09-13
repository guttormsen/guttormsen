/**
 * Treffdeteksjon mot turrutene som er lastet inn.
 *
 * Kartet viser merkede stier, og de skal kunne trykkes på. For at det skal
 * kjennes umiddelbart må vi kunne svare på «hvilken tur ligger under fingeren»
 * uten å gå på nettet – derfor legges alle rutepunktene i et rutenett når
 * turforslagene lastes.
 *
 * Rene funksjoner – ingen DOM, ingen nettverk.
 */
import { haversine } from './geo.js';

/** Cellestørrelse i meter. Litt større enn den største treffradiusen vi bruker. */
const CELL_M = 120;

/**
 * Bygger et rutenett over punktene i alle turene.
 * @param {Array<{id:string, name:string, points:Array<{lat:number,lon:number}>}>} trips
 */
export function buildTrailIndex(trips) {
  const cell = CELL_M / 111320;
  const grid = new Map();

  for (const trip of trips) {
    const points = trip.points ?? [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const key = `${Math.floor(point.lat / cell)},${Math.floor(point.lon / (cell * 2))}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push({ trip, point });
    }
  }

  return { grid, cell, size: trips.length };
}

/**
 * Nærmeste tur under et punkt.
 *
 * Avstanden måles til rutens punkter, ikke til linja mellom dem. Geometrien
 * fra Turrutebasen har punkter få meter fra hverandre, så forskjellen er
 * mindre enn fingeren uansett.
 *
 * @param {object} index fra `buildTrailIndex`
 * @param {{lat:number, lon:number}} point
 * @param {number} tolerance meter
 * @returns {{trip: object, distance: number}|null}
 */
export function findTrailAt(index, point, tolerance) {
  if (!index || !(tolerance > 0)) return null;
  const { grid, cell } = index;
  const row = Math.floor(point.lat / cell);
  const column = Math.floor(point.lon / (cell * 2));

  // Let i så mange celler som toleransen krever, minst nabolaget rundt.
  const reach = Math.max(1, Math.ceil(tolerance / CELL_M));
  let best = null;

  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      for (const entry of grid.get(`${row + dr},${column + dc}`) ?? []) {
        const distance = haversine(point, entry.point);
        if (distance > tolerance) continue;
        if (!best || distance < best.distance) best = { trip: entry.trip, distance };
      }
    }
  }

  return best;
}
