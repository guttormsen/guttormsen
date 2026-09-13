/** Små hjelpefunksjoner uten avhengigheter. Holdes rene så de kan enhetstestes. */

/* ---------- DOM ---------- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Lager et element. `attrs.class`, `attrs.text`, `attrs.html` og `on*` håndteres spesielt.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Tømmer et element og setter inn nytt innhold. */
export function render(target, ...children) {
  target.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
  return target;
}

/* ---------- Formatering (norsk) ---------- */

const nf = (digits) =>
  new Intl.NumberFormat('nb-NO', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 850 m / 12,4 km */
export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '–';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 10000) return `${nf(1).format(meters / 1000)} km`;
  return `${nf(0).format(meters / 1000)} km`;
}

/** 1 240 m */
export function formatElevation(meters) {
  if (!Number.isFinite(meters)) return '–';
  return `${nf(0).format(Math.round(meters))} m`;
}

/** 4 t 25 min */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} t`;
  return `${hours} t ${minutes} min`;
}

/** 14:05 */
export function formatClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' }).format(date);
}

/** onsdag 13. september */
export function formatDay(date) {
  return new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

/** 59.8542° N, 8.6492° Ø – desimalgrader er det Kartverket bruker. */
export function formatCoord(lat, lon) {
  return `${nf(4).format(lat)}° N, ${nf(4).format(lon)}° Ø`;
}

export function formatNumber(value, digits = 0) {
  return Number.isFinite(value) ? nf(digits).format(value) : '–';
}

/* ---------- Kontrollflyt ---------- */

export function debounce(fn, ms = 250) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Kjører oppgaver med begrenset parallellitet, bevarer rekkefølgen på resultatet. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ---------- Lagring ---------- */

/** localStorage kan kaste i privat modus – aldri la det velte appen. */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignorert med vilje */
    }
  },
};

/* ---------- Diverse ---------- */

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** Enkel event-buss slik at modulene slipper å kjenne hverandre. */
export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) {
        try {
          fn(payload);
        } catch (error) {
          console.error(`Feil i lytter for "${event}"`, error);
        }
      }
    },
  };
}
