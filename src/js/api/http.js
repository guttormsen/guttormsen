/**
 * Felles HTTP-lag: tidsavbrudd, forsiktig retry og mellomlagring.
 *
 * Alle tjenestene vi snakker med er gratis fellesgoder. Vi mellomlagrer
 * aggressivt og gjentar aldri et kall som feilet med en klientfeil (4xx).
 */

const memory = new Map();
const inflight = new Map();

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', cause } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.cause = cause;
  }
}

/** Feil vi ikke skal prøve på nytt: alt klienten selv gjorde galt. */
const isClientError = (status) => status >= 400 && status < 500 && status !== 408 && status !== 429;

/**
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeout=15000] millisekunder før vi gir opp ett forsøk
 * @param {number} [options.retries=2]     antall ekstra forsøk ved nettverks-/5xx-feil
 * @param {number} [options.ttl=0]         hvor lenge svaret kan gjenbrukes, i millisekunder
 * @param {'json'|'text'} [options.as='json']
 * @param {AbortSignal} [options.signal]   avbryt utenfra (f.eks. nytt søk)
 */
export async function request(url, options = {}) {
  const { timeout = 15000, retries = 2, ttl = 0, as = 'json', signal, ...init } = options;
  const key = `${init.method ?? 'GET'} ${url} ${init.body ?? ''}`;

  if (ttl > 0) {
    const hit = memory.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const run = (async () => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        // 400 ms, 800 ms, 1600 ms … med litt slingring så vi ikke synkroniserer klienter.
        const backoff = 400 * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('Tidsavbrudd')), timeout);
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) {
          const error = new HttpError(`${response.status} ${response.statusText}`, {
            status: response.status,
            url,
          });
          if (isClientError(response.status)) throw error;
          lastError = error;
          continue;
        }
        const value = as === 'text' ? await response.text() : await response.json();
        if (ttl > 0) memory.set(key, { value, expires: Date.now() + ttl });
        return value;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error instanceof HttpError && isClientError(error.status)) throw error;
        lastError = error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    throw new HttpError(`Kunne ikke hente data: ${lastError?.message ?? 'ukjent feil'}`, {
      url,
      cause: lastError,
    });
  })();

  if (ttl > 0) {
    inflight.set(key, run);
    run.finally(() => inflight.delete(key)).catch(() => {});
  }
  return run;
}

/** Bygger en URL med søkeparametre, uten undefined-verdier. */
export function withQuery(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Tømmer mellomlageret. Brukes av testene. */
export function clearCache() {
  memory.clear();
  inflight.clear();
}
