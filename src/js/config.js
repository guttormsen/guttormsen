/**
 * Sentral konfigurasjon: karttjenester, API-endepunkter og standardverdier.
 * Alle datakilder er offentlige og åpne. Se README.md for lisenser.
 */

export const APP = {
  name: 'Turplan',
  version: '1.0.0',
  storageKey: 'turplan.v1',
  /** Sendes som identifikasjon der tjenesten tillater det. */
  contact: 'https://github.com/guttormsen/guttormsen',
};

/** Startutsnitt: hele Sør-Norge. */
export const DEFAULT_VIEW = { lat: 61.5, lon: 9.0, zoom: 6 };

const KV_WMTS = 'https://cache.kartverket.no/v1/wmts/1.0.0';

/**
 * Bakgrunnskart fra Kartverket (WMTS, webmercator).
 * `topo` er samme kartgrunnlag som norgeskart.no.
 */
export const BASEMAPS = [
  {
    id: 'topo',
    label: 'Topografisk',
    hint: 'Kartverkets standardkart – best for de fleste turer',
    url: `${KV_WMTS}/topo/default/webmercator/{z}/{y}/{x}.png`,
    maxZoom: 18,
  },
  {
    id: 'topograatone',
    label: 'Gråtone',
    hint: 'Dempet kart – rute og spor kommer tydeligere fram',
    url: `${KV_WMTS}/topograatone/default/webmercator/{z}/{y}/{x}.png`,
    maxZoom: 18,
  },
  {
    id: 'toporaster',
    label: 'Turkart',
    hint: 'Papirkart-uttrykket fra Norge-serien',
    url: `${KV_WMTS}/toporaster/default/webmercator/{z}/{y}/{x}.png`,
    maxZoom: 18,
  },
  {
    id: 'sjokartraster',
    label: 'Sjøkart',
    hint: 'Dybder og sjømerker for padling og kystturer',
    url: `${KV_WMTS}/sjokartraster/default/webmercator/{z}/{y}/{x}.png`,
    maxZoom: 18,
  },
];

export const KARTVERKET_ATTRIBUTION =
  '<a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>';

/**
 * Turrutebasen – den nasjonale rutedatabasen, levert som WMS.
 * Lagene har MaxScaleDenominator 1e6, så de tegnes først fra ca. zoom 11.
 */
export const TRAIL_WMS = {
  url: 'https://wms.geonorge.no/skwms1/wms.friluftsruter2',
  minZoom: 11,
  layers: [
    { id: 'Fotrute', label: 'Fotruter', defaultOn: true },
    { id: 'Skiloype', label: 'Skiløyper', defaultOn: false },
    { id: 'Sykkelrute', label: 'Sykkelruter', defaultOn: false },
    { id: 'AnnenRute', label: 'Andre ruter', defaultOn: false },
  ],
};

export const API = {
  stedsnavn: 'https://ws.geonorge.no/stedsnavn/v1/navn',
  hoydedata: 'https://ws.geonorge.no/hoydedata/v1/punkt',
  metForecast: 'https://api.met.no/weatherapi/locationforecast/2.0/compact',
  metSunrise: 'https://api.met.no/weatherapi/sunrise/3.0/sun',
  varsom:
    'https://api01.nve.no/hydrology/forecast/avalanche/v6.3.0/api/AvalancheWarningByCoordinates/Simple',
  /** Speil prøves i rekkefølge; Overpass svarer med 504 når det er travelt. */
  overpass: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ],
};

/** Kartverket tar maks 50 punkter per kall til høydedata. */
export const ELEVATION_BATCH = 50;
/** Øvre grense for antall høydepunkter i én profil (8 kall). */
export const ELEVATION_MAX_SAMPLES = 400;
/** Minste avstand mellom høydepunkter i meter. */
export const ELEVATION_MIN_SPACING = 20;

/**
 * Terrengfaktorer. Multipliseres inn i gåtiden.
 * Tallene er kalibrert mot DNTs egne tidsanslag for kjente turer.
 */
export const TERRAIN = [
  { id: 'sti', label: 'Merket sti', factor: 1.0, hint: 'T-merket eller tydelig tråkk' },
  { id: 'umerket', label: 'Umerket/åpent', factor: 1.2, hint: 'Snaufjell, myr, lyng' },
  { id: 'ulendt', label: 'Ulendt', factor: 1.45, hint: 'Blokkmark, ur, kratt' },
  { id: 'snø', label: 'Snø/vinter', factor: 1.6, hint: 'Løs snø, truger eller ski utenfor løype' },
];

/** Flat marsjfart i km/t før terreng- og stigningskorreksjon. */
export const PACE = [
  { id: 'rolig', label: 'Rolig', speed: 3.6, hint: 'Barnefamilie, tung sekk eller stor gruppe' },
  { id: 'normal', label: 'Normal', speed: 4.5, hint: 'Vanlig turgåer i god form' },
  { id: 'rask', label: 'Rask', speed: 5.4, hint: 'Trent, lett sekk' },
];

/** Pauseminutter per gåtime, utover første time. */
export const BREAK_MINUTES_PER_HOUR = 8;

export const DEFAULT_OPTIONS = {
  basemap: 'topo',
  pace: 'normal',
  terrain: 'sti',
  packKg: 8,
  breaks: true,
  roundTrip: false,
  snapToTrail: false,
};
