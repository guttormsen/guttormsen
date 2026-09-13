/**
 * Vær og dagslys fra Meteorologisk institutt.
 * https://api.met.no/weatherapi/locationforecast/2.0/documentation
 *
 * MET ber om at klienter identifiserer seg med User-Agent. Nettlesere lar ikke
 * JavaScript sette den headeren, så nettleserens egen User-Agent brukes.
 * Se README for hvordan du setter opp en proxy hvis trafikken blir stor.
 */
import { request, withQuery } from './http.js';
import { API } from '../config.js';

/** MET avviser koordinater med mer enn 4 desimaler. */
const trim = (value) => Number(value.toFixed(4));

/**
 * Henter varselet for ett punkt.
 * @returns {Promise<{updatedAt: Date, series: Array<object>}>}
 */
export async function fetchForecast({ lat, lon }, { signal } = {}) {
  const url = withQuery(API.metForecast, { lat: trim(lat), lon: trim(lon) });
  const data = await request(url, { ttl: 20 * 60 * 1000, signal, timeout: 20000 });

  const series = (data?.properties?.timeseries ?? []).map((entry) => {
    const instant = entry.data?.instant?.details ?? {};
    // MET har 1-times-oppløsning de første tre døgnene, 6 timer etter det.
    const next = entry.data?.next_1_hours ?? entry.data?.next_6_hours ?? {};
    return {
      time: new Date(entry.time),
      temperature: instant.air_temperature ?? null,
      windSpeed: instant.wind_speed ?? null,
      windGust: instant.wind_speed_of_gust ?? null,
      windFrom: instant.wind_from_direction ?? null,
      humidity: instant.relative_humidity ?? null,
      cloudCover: instant.cloud_area_fraction ?? null,
      precipitation: next.details?.precipitation_amount ?? null,
      symbol: next.summary?.symbol_code ?? null,
      /** Antall timer `precipitation` og `symbol` gjelder for. */
      spanHours: entry.data?.next_1_hours ? 1 : 6,
    };
  });

  return { updatedAt: new Date(data?.properties?.meta?.updated_at ?? Date.now()), series };
}

/** Nærmeste varseltidspunkt til `target`, eller `null` hvis vi er utenfor varselperioden. */
export function pickNearest(series, target) {
  if (!series?.length) return null;
  const t = target.getTime();
  let best = null;
  let bestDiff = Infinity;
  for (const entry of series) {
    const diff = Math.abs(entry.time.getTime() - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  // Mer enn tre timer unna nærmeste varsel betyr at vi er forbi varselhorisonten.
  return bestDiff <= 3 * 60 * 60 * 1000 ? best : null;
}

/**
 * Soloppgang og solnedgang for et punkt og en dato.
 * Returnerer `null`-felt ved midnattssol eller mørketid.
 */
export async function fetchSun({ lat, lon }, date, { signal } = {}) {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const offset = `${sign}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(
    Math.abs(minutes) % 60,
  ).padStart(2, '0')}`;

  const url = withQuery(API.metSunrise, { lat: trim(lat), lon: trim(lon), date: iso, offset });
  const data = await request(url, { ttl: 6 * 60 * 60 * 1000, signal, retries: 1 });
  const props = data?.properties ?? {};
  const parse = (value) => (value ? new Date(value) : null);

  return {
    sunrise: parse(props.sunrise?.time),
    sunset: parse(props.sunset?.time),
    solarNoon: parse(props.solarnoon?.time),
    /** Sola er over horisonten hele døgnet (midnattssol) eller aldri (mørketid). */
    polarDay: !props.sunrise?.time && (props.solarnoon?.disc_centre_elevation ?? -1) > 0,
    polarNight: !props.sunrise?.time && (props.solarnoon?.disc_centre_elevation ?? 1) <= 0,
  };
}

/* ---------- Symboler ---------- */

const SYMBOLS = {
  clearsky: ['☀️', 'Klarvær'],
  fair: ['🌤️', 'Lettskyet'],
  partlycloudy: ['⛅', 'Delvis skyet'],
  cloudy: ['☁️', 'Skyet'],
  fog: ['🌫️', 'Tåke'],
  lightrain: ['🌦️', 'Lett regn'],
  rain: ['🌧️', 'Regn'],
  heavyrain: ['🌧️', 'Kraftig regn'],
  lightrainshowers: ['🌦️', 'Lette regnbyger'],
  rainshowers: ['🌦️', 'Regnbyger'],
  heavyrainshowers: ['🌧️', 'Kraftige regnbyger'],
  lightsleet: ['🌨️', 'Lett sludd'],
  sleet: ['🌨️', 'Sludd'],
  heavysleet: ['🌨️', 'Kraftig sludd'],
  lightsleetshowers: ['🌨️', 'Lette sluddbyger'],
  sleetshowers: ['🌨️', 'Sluddbyger'],
  heavysleetshowers: ['🌨️', 'Kraftige sluddbyger'],
  lightsnow: ['🌨️', 'Lett snø'],
  snow: ['❄️', 'Snø'],
  heavysnow: ['❄️', 'Kraftig snø'],
  lightsnowshowers: ['🌨️', 'Lette snøbyger'],
  snowshowers: ['🌨️', 'Snøbyger'],
  heavysnowshowers: ['❄️', 'Kraftige snøbyger'],
};

/**
 * Oversetter en MET-symbolkode til ikon og norsk tekst.
 * @param {string|null} code f.eks. `heavyrainshowersandthunder_day`
 */
export function describeSymbol(code) {
  if (!code) return { icon: '·', label: 'Ukjent' };
  const base = code.replace(/_(day|night|polartwilight)$/, '');
  const thunder = base.endsWith('andthunder');
  const key = thunder ? base.replace(/andthunder$/, '') : base;
  const [icon, label] = SYMBOLS[key] ?? ['·', key.replace(/_/g, ' ')];
  return thunder ? { icon: '⛈️', label: `${label} og torden` } : { icon, label };
}

/** Beaufort-nær beskrivelse av vindstyrke, slik den brukes i norske varsler. */
export function describeWind(speed) {
  if (!Number.isFinite(speed)) return '';
  if (speed < 0.3) return 'stille';
  if (speed < 3.4) return 'svak vind';
  if (speed < 8.0) return 'lett bris';
  if (speed < 10.8) return 'frisk bris';
  if (speed < 13.9) return 'liten kuling';
  if (speed < 17.2) return 'stiv kuling';
  if (speed < 20.8) return 'sterk kuling';
  if (speed < 24.5) return 'liten storm';
  if (speed < 28.5) return 'full storm';
  if (speed < 32.6) return 'sterk storm';
  return 'orkan';
}
