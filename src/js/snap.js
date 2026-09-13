/**
 * «Følg sti»: finner vegen mellom to punkter langs faktiske stier, slik at ruta
 * ikke går rett over stup, myr og vann.
 *
 * Stinettet settes sammen av to kilder:
 *   1. Turrutebasen (Kartverket) – de offisielt merkede rutene.
 *   2. OpenStreetMap – stier og skogsveger som ikke er merket.
 *
 * Ingen av dem dekker hele landet alene, og til sammen blir nettet vesentlig
 * tettere. Merkede ruter får lavere kostnad, så ruta følger dem når den kan.
 */
import { bbox, haversine } from './geo.js';
import { fetchWalkableWays } from './api/overpass.js';
import { fetchFotruter } from './api/turrutebasen.js';

/** Lengre enn dette henter vi ikke stinett for – utsnittet blir for stort. */
export const MAX_SNAP_DISTANCE_M = 30000;
/** Hvor langt fra en sti et klikk kan ligge og fortsatt regnes som «på stien». */
const MAX_ANCHOR_DISTANCE_M = 400;
/** Endepunkter nærmere hverandre enn dette knyttes sammen på tvers av kildene. */
const STITCH_DISTANCE_M = 25;
/** Merkede ruter foretrekkes framfor umerkede tråkk. */
const MARKED_ROUTE_WEIGHT = 0.85;
/**
 * Hvor lenge vi venter på én datakilde før vi går videre uten den.
 * Overpass er en dugnadstjeneste som fort bruker et halvt minutt når den er
 * travel, og da er det bedre å snappe mot Turrutebasen alene enn å la
 * brukeren sitte og se på en spinner.
 */
const SOURCE_DEADLINE_MS = 12000;

/**
 * Kjører ett kildeoppslag med frist.
 * @returns {Promise<{items: Array, failed: boolean}>} tom liste og `failed`
 *   hvis kilden feilet eller brukte for lang tid.
 */
function withDeadline(start, ms, outerSignal) {
  const controller = new AbortController();
  const signal = outerSignal
    ? AbortSignal.any([outerSignal, controller.signal])
    : controller.signal;

  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error('Tidsavbrudd'));
      resolve({ items: [], failed: true });
    }, ms);
  });

  const attempt = start(signal)
    .then((items) => ({ items, failed: false }))
    .catch((error) => {
      if (outerSignal?.aborted) throw error;
      console.warn('Stikilde svarte ikke', error);
      return { items: [], failed: true };
    })
    .finally(() => clearTimeout(timer));

  return Promise.race([attempt, deadline]);
}

class MinHeap {
  #items = [];

  get size() {
    return this.#items.length;
  }

  push(priority, value) {
    const items = this.#items;
    items.push({ priority, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].priority <= items[i].priority) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left].priority < items[smallest].priority) smallest = left;
        if (right < items.length && items[right].priority < items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Nodenøkkel. Kildene deler ingen ID-er, så geometrien er det eneste vi kan
 * knytte dem sammen på. Seks desimaler er ca. 10 cm.
 */
export const nodeKey = (point) => `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;

/**
 * Bygger en nabolagsgraf av lenker.
 * @param {Array<{points:Array<{lat:number,lon:number}>, weight:number}>} links
 * @returns {Map<string, {lat:number, lon:number, edges: Array<{to:string, cost:number}>}>}
 */
export function buildGraph(links) {
  const nodes = new Map();

  const ensure = (point) => {
    const key = nodeKey(point);
    let node = nodes.get(key);
    if (!node) {
      node = { lat: point.lat, lon: point.lon, edges: [] };
      nodes.set(key, node);
    }
    return [key, node];
  };

  for (const link of links) {
    for (let i = 1; i < link.points.length; i++) {
      const [aKey, a] = ensure(link.points[i - 1]);
      const [bKey, b] = ensure(link.points[i]);
      if (aKey === bKey) continue;
      const length = haversine(link.points[i - 1], link.points[i]);
      if (!(length > 0)) continue;
      const cost = length * link.weight;
      a.edges.push({ to: bKey, cost });
      b.edges.push({ to: aKey, cost });
    }
  }

  return nodes;
}

/**
 * Knytter sammen noder fra ulike kilder som ligger nesten oppå hverandre.
 * Uten dette blir Turrutebasen og OpenStreetMap to atskilte nett.
 * Nodene bøtteslegges i et grovt rutenett, så dette er lineært, ikke kvadratisk.
 */
export function stitchNetworks(nodes, maxDistance = STITCH_DISTANCE_M) {
  const cell = maxDistance / 111320; // ca. maxDistance i breddegrader
  const buckets = new Map();

  for (const [key, node] of nodes) {
    const bucket = `${Math.floor(node.lat / cell)},${Math.floor(node.lon / (cell * 2))}`;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push([key, node]);
  }

  let added = 0;
  for (const [bucket, entries] of buckets) {
    const [row, column] = bucket.split(',').map(Number);
    const neighbours = [];
    for (let dr = 0; dr <= 1; dr++) {
      for (let dc = dr === 0 ? 0 : -1; dc <= 1; dc++) {
        neighbours.push(...(buckets.get(`${row + dr},${column + dc}`) ?? []));
      }
    }
    for (const [aKey, a] of entries) {
      for (const [bKey, b] of neighbours) {
        if (aKey >= bKey) continue;
        const distance = haversine(a, b);
        if (distance > maxDistance) continue;
        // Litt ekstra kostnad: dette er en antatt forbindelse, ikke en kartlagt en.
        const cost = Math.max(1, distance) * 1.5;
        a.edges.push({ to: bKey, cost });
        b.edges.push({ to: aKey, cost });
        added++;
      }
    }
  }
  return added;
}

/** Nodenøkkelen nærmest et punkt, eller `null` hvis alt ligger for langt unna. */
export function nearestNode(nodes, point, maxDistance = MAX_ANCHOR_DISTANCE_M) {
  let bestKey = null;
  let bestDistance = maxDistance;
  for (const [key, node] of nodes) {
    const distance = haversine(point, node);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKey = key;
    }
  }
  return bestKey;
}

/**
 * Dijkstra fra `startKey` til `goalKey`.
 * @returns {Array<{lat:number,lon:number}>|null} punktrekke, eller `null` hvis ingen veg finnes
 */
export function shortestPath(nodes, startKey, goalKey) {
  if (startKey == null || goalKey == null) return null;
  if (startKey === goalKey) {
    const node = nodes.get(startKey);
    return node ? [{ lat: node.lat, lon: node.lon }] : null;
  }

  const best = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const settled = new Set();
  const queue = new MinHeap();
  queue.push(0, startKey);

  while (queue.size) {
    const { priority, value: current } = queue.pop();
    if (settled.has(current)) continue;
    settled.add(current);
    if (current === goalKey) break;
    if (priority > (best.get(current) ?? Infinity)) continue;

    for (const edge of nodes.get(current)?.edges ?? []) {
      if (settled.has(edge.to)) continue;
      const candidate = priority + edge.cost;
      if (candidate < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, candidate);
        cameFrom.set(edge.to, current);
        queue.push(candidate, edge.to);
      }
    }
  }

  if (!settled.has(goalKey)) return null;

  const path = [];
  for (let key = goalKey; key != null; key = cameFrom.get(key)) {
    const node = nodes.get(key);
    path.push({ lat: node.lat, lon: node.lon });
    if (key === startKey) break;
  }
  return path.reverse();
}

/**
 * Lager en snapper med mellomlager for stinettet.
 * Returnerer `{ points, snapped, reason }` – `snapped: false` betyr at kallende
 * kode skal falle tilbake til luftlinje, og `reason` sier hvorfor.
 */
export function createSnapper() {
  const cache = new Map();
  /** Turruter appen allerede har hentet, gjenbrukt i stedet for nye kall. */
  let seeded = [];

  async function loadGraph(box, signal) {
    const key = box.map((value) => value.toFixed(3)).join(',');
    if (!cache.has(key)) {
      // Ruter vi allerede har i minnet slipper å hentes på nytt.
      const [south, west, north, east] = box;
      const local = seeded.filter((route) =>
        route.points.some(
          (p) => p.lat >= south && p.lat <= north && p.lon >= west && p.lon <= east,
        ),
      );

      const promise = (async () => {
        // Begge kildene spørres samtidig. Én som svikter eller somler skal ikke
        // ta med seg den andre – vi bygger grafen av det som rakk fram.
        const [marked, osm] = await Promise.all([
          withDeadline((inner) => fetchFotruter(box, { signal: inner }), SOURCE_DEADLINE_MS, signal),
          withDeadline((inner) => fetchWalkableWays(box, { signal: inner }), SOURCE_DEADLINE_MS, signal),
        ]);

        const seen = new Set(local.map((route) => route.id));
        const links = [
          ...local.map((route) => ({ points: route.points, weight: MARKED_ROUTE_WEIGHT })),
          ...marked.items
            .filter((route) => !seen.has(route.id))
            .map((route) => ({ points: route.points, weight: MARKED_ROUTE_WEIGHT })),
          ...osm.items.map((way) => ({ points: way.geometry, weight: way.weight })),
        ];
        const nodes = buildGraph(links);
        stitchNetworks(nodes);
        // Har vi ruter fra før, er nettet brukbart selv om begge kildene svikter.
        return { nodes, unavailable: marked.failed && osm.failed && !local.length };
      })();
      cache.set(key, promise);
      // Feilet begge kildene, skal neste forsøk få prøve på nytt.
      promise.then(
        (result) => {
          if (result.unavailable) cache.delete(key);
        },
        () => cache.delete(key),
      );
    }
    return cache.get(key);
  }

  return {
    /**
     * @param {{lat:number,lon:number}} from
     * @param {{lat:number,lon:number}} to
     */
    async connect(from, to, { signal } = {}) {
      const direct = haversine(from, to);
      if (direct > MAX_SNAP_DISTANCE_M) {
        return { points: [from, to], snapped: false, reason: 'for-langt' };
      }

      const pad = Math.min(3000, Math.max(700, direct * 0.4));
      const { nodes, unavailable } = await loadGraph(bbox([from, to], pad), signal);
      if (unavailable) return { points: [from, to], snapped: false, reason: 'feil' };

      const startKey = nearestNode(nodes, from);
      const goalKey = nearestNode(nodes, to);
      if (startKey == null || goalKey == null) {
        return { points: [from, to], snapped: false, reason: 'ingen-sti' };
      }

      const path = shortestPath(nodes, startKey, goalKey);
      if (!path || path.length < 2) {
        return { points: [from, to], snapped: false, reason: 'ingen-forbindelse' };
      }

      // En omveg på over det tredoble av luftlinja er nesten alltid feil sti-treff.
      let length = 0;
      for (let i = 1; i < path.length; i++) length += haversine(path[i - 1], path[i]);
      if (direct > 50 && length > direct * 3.5) {
        return { points: [from, to], snapped: false, reason: 'omveg' };
      }

      return { points: [from, ...path, to], snapped: true, reason: null };
    },

    /**
     * Gir snapperen turruter appen allerede har lastet, så en ny etappe kan
     * beregnes uten å vente på nettet.
     * @param {Array<{id: string, points: Array<{lat:number,lon:number}>}>} routes
     */
    seed(routes) {
      seeded = routes ?? [];
      cache.clear();
    },

    clear() {
      cache.clear();
    },
  };
}

export const SNAP_REASONS = {
  'for-langt': 'Strekningen er for lang til å følge sti automatisk.',
  'ingen-sti': 'Fant ingen kartlagt sti i nærheten – tegnet rett strek.',
  'ingen-forbindelse': 'Stiene henger ikke sammen her – tegnet rett strek.',
  omveg: 'Stien gikk en urimelig omveg – tegnet rett strek.',
  feil: 'Kunne ikke hente stinettet akkurat nå – tegnet rett strek.',
};
