/**
 * Innholdet i sidepanelet. Hver funksjon tar data inn og gir DOM-noder ut,
 * uten å røre global tilstand – da er de lette å flytte på og resonnere om.
 */
import { BASEMAPS, PACE, TERRAIN, TRAIL_WMS } from './config.js';
import { DANGER_LEVELS } from './api/varsom.js';
import { POI_KINDS } from './api/overpass.js';
import { describeSymbol, describeWind } from './api/met.js';
import { closestPointOnPath, compassPoint } from './geo.js';
import { daylightCheck } from './weather.js';
import { segmented } from './ui.js';
import {
  el,
  formatClock,
  formatDay,
  formatDistance,
  formatDuration,
  formatElevation,
  formatNumber,
} from './util.js';

const stat = (label, value, hint) =>
  el('div', { class: 'stat' }, [
    el('span', { class: 'stat__value', text: value }),
    el('span', { class: 'stat__label', text: label }),
    hint && el('span', { class: 'stat__hint', text: hint }),
  ]);

/* ---------- Nøkkeltall ---------- */

export function renderStats(summary, loading) {
  if (!summary) {
    return [
      el('p', {
        class: 'stats__empty',
        text: 'Ingen rute ennå. Søk deg fram eller klikk i kartet for å begynne.',
      }),
    ];
  }

  const { time, grade } = summary;
  const nodes = [
    el('div', { class: 'stats__grid' }, [
      stat('Lengde', formatDistance(summary.distance)),
      stat('Stigning', summary.hasElevation ? formatElevation(summary.ascent) : '…'),
      stat('Fall', summary.hasElevation ? formatElevation(summary.descent) : '…'),
      stat(
        'Tidsbruk',
        formatDuration(time.totalSeconds),
        `${formatDuration(time.lowSeconds)}–${formatDuration(time.highSeconds)}`,
      ),
    ]),
    el('div', { class: 'stats__row' }, [
      el('span', {
        class: 'chip chip--grade',
        style: `--chip-color:${grade.color}`,
        text: grade.label,
        title: grade.description,
      }),
      summary.hasElevation &&
        el('span', {
          class: 'chip',
          text: `Høyeste punkt ${formatElevation(summary.maxElevation)}`,
        }),
      summary.steepestSlope > 0.35 &&
        el('span', {
          class: 'chip chip--warn',
          text: `Bratteste parti ${formatNumber(summary.steepestSlope * 100, 0)} %`,
        }),
    ]),
  ];

  if (loading.elevation) {
    nodes.push(el('p', { class: 'loading', text: 'Henter høyder fra Kartverket …' }));
  }
  return nodes;
}

/* ---------- Plan ---------- */

function localInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function renderPlan(trip, summary, startTime, handlers) {
  const { options } = trip;

  const field = (label, control, hint) =>
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', text: label }),
      control,
      hint && el('span', { class: 'field__hint', text: hint }),
    ]);

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'trip-name',
    placeholder: 'F.eks. Besseggen fra Gjendesheim',
    value: trip.name,
    maxlength: 80,
    oninput: (event) => handlers.onName(event.target.value),
  });

  const timeInput = el('input', {
    class: 'input',
    type: 'datetime-local',
    id: 'trip-start',
    value: localInputValue(startTime),
    onchange: (event) => {
      const date = new Date(event.target.value);
      if (!Number.isNaN(date.getTime())) handlers.onStartTime(date);
    },
  });

  const pack = el('input', {
    class: 'range',
    type: 'range',
    min: '2',
    max: '25',
    step: '1',
    value: String(options.packKg),
    'aria-label': 'Sekkevekt i kilo',
    oninput: (event) => handlers.onOptions({ packKg: Number(event.target.value) }),
  });

  const toggle = (id, label, checked, hint, onChange) =>
    el('label', { class: 'toggle', for: id }, [
      el('input', {
        id,
        type: 'checkbox',
        checked,
        onchange: (event) => onChange(event.target.checked),
      }),
      el('span', { class: 'toggle__body' }, [
        el('span', { class: 'toggle__label', text: label }),
        el('span', { class: 'toggle__hint', text: hint }),
      ]),
    ]);

  return [
    el('div', { class: 'stack' }, [
      field('Navn på turen', nameInput),
      field('Start', timeInput, 'Brukes til vær, dagslys og ankomsttider.'),
      field(
        'Marsjfart',
        segmented('Marsjfart', PACE, options.pace, (id) => handlers.onOptions({ pace: id })),
        PACE.find((p) => p.id === options.pace)?.hint,
      ),
      field(
        'Underlag',
        segmented('Underlag', TERRAIN, options.terrain, (id) => handlers.onOptions({ terrain: id })),
        TERRAIN.find((t) => t.id === options.terrain)?.hint,
      ),
      field('Sekkevekt', el('div', { class: 'range-row' }, [pack, el('output', { text: `${options.packKg} kg` })])),
      toggle('opt-breaks', 'Regn med pauser', options.breaks, 'Legger til 8 minutter per gåtime etter den første.', (value) =>
        handlers.onOptions({ breaks: value }),
      ),
      toggle(
        'opt-snap',
        'Følg sti',
        options.snapToTrail,
        'Nye strekninger legges langs kartlagte stier i stedet for rett strek.',
        (value) => handlers.onOptions({ snapToTrail: value }),
      ),
    ]),

    el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn',
        type: 'button',
        text: 'Snu retning',
        disabled: trip.waypoints.length < 2,
        onclick: handlers.onReverse,
      }),
      el('button', {
        class: 'btn',
        type: 'button',
        text: 'Gjør til tur–retur',
        disabled: trip.waypoints.length < 2,
        onclick: handlers.onRoundTrip,
      }),
    ]),

    renderWaypoints(trip, summary, handlers),
  ];
}

function renderWaypoints(trip, summary, handlers) {
  if (!trip.waypoints.length) return null;

  return el('section', { class: 'block' }, [
    el('h2', { class: 'block__title', text: `Veipunkter (${trip.waypoints.length})` }),
    el(
      'ol',
      { class: 'waypoints' },
      trip.waypoints.map((waypoint, index) => {
        const along =
          summary && summary.line.length > 1 ? closestPointOnPath(waypoint, summary.line) : null;
        const distance = along ? summary.distances[along.index] : null;
        const seconds = along ? summary.time.cumulativeSeconds[along.index] : null;

        return el('li', { class: 'waypoint' }, [
          el('span', {
            class: `wp wp--${index === 0 ? 'start' : index === trip.waypoints.length - 1 ? 'slutt' : 'mellom'}`,
            'aria-hidden': 'true',
            text: index === 0 ? 'A' : index === trip.waypoints.length - 1 ? 'B' : String(index),
          }),
          el('span', { class: 'waypoint__body' }, [
            el('button', {
              class: 'linkish',
              type: 'button',
              text: waypoint.name ?? `Punkt ${index + 1}`,
              onclick: () => handlers.onFocusWaypoint(waypoint),
            }),
            distance != null &&
              el('span', {
                class: 'waypoint__meta',
                text: `${formatDistance(distance)} · ${formatDuration(seconds)} inn i turen`,
              }),
          ]),
          el('button', {
            class: 'icon-btn icon-btn--tiny',
            type: 'button',
            title: `Fjern punkt ${index + 1}`,
            html: '<span aria-hidden="true">✕</span>',
            onclick: () => handlers.onRemoveWaypoint(waypoint.id),
          }),
        ]);
      }),
    ),
    el('p', {
      class: 'hint',
      text: 'Dra et punkt for å flytte det. Klikk på selve ruta for å sette inn et nytt punkt.',
    }),
  ]);
}

/* ---------- Vær ---------- */

export function renderWeather(checkpoints, sun, loading, startTime) {
  if (!checkpoints?.length) {
    return [
      el('p', {
        class: 'hint',
        text: loading ? 'Henter varsel fra Meteorologisk institutt …' : 'Tegn en rute for å se været langs den.',
      }),
    ];
  }

  const nodes = [];

  if (sun) {
    nodes.push(
      el('div', { class: 'sun' }, [
        el('span', { text: `☀️ Sol opp ${sun.sunrise ? formatClock(sun.sunrise) : '–'}` }),
        el('span', { text: `🌇 Sol ned ${sun.sunset ? formatClock(sun.sunset) : '–'}` }),
        sun.polarDay && el('span', { text: 'Midnattssol' }),
        sun.polarNight && el('span', { text: 'Mørketid' }),
      ]),
    );
  }

  nodes.push(
    el('p', { class: 'hint', text: `Varselet gjelder klokkeslettet du er beregnet å være der, ${formatDay(startTime)}.` }),
  );

  nodes.push(
    el(
      'ul',
      { class: 'weather' },
      checkpoints.map((checkpoint) => {
        const forecast = checkpoint.forecast;
        const symbol = describeSymbol(forecast?.symbol);
        const place =
          checkpoint.label ?? `${formatDistance(checkpoint.distance)}`;

        if (!forecast) {
          return el('li', { class: 'weather__row weather__row--empty' }, [
            el('span', { class: 'weather__where', text: place }),
            el('span', {
              class: 'weather__none',
              text: checkpoint.error ? 'Varsel utilgjengelig' : 'Utenfor varselperioden (mer enn 9 døgn fram)',
            }),
          ]);
        }

        return el('li', { class: 'weather__row' }, [
          el('span', { class: 'weather__where' }, [
            el('strong', { text: place }),
            el('span', { class: 'weather__time', text: `kl. ${formatClock(checkpoint.eta)}` }),
            Number.isFinite(checkpoint.elevation) &&
              el('span', { class: 'weather__ele', text: `${formatElevation(checkpoint.elevation)} moh.` }),
          ]),
          el('span', { class: 'weather__icon', title: symbol.label, text: symbol.icon }),
          el('span', { class: 'weather__values' }, [
            el('strong', {
              class: `temp ${forecast.temperature < 0 ? 'temp--cold' : ''}`,
              text: `${formatNumber(forecast.temperature, 0)}°`,
            }),
            el('span', {
              text: `${formatNumber(forecast.windSpeed, 0)} m/s${
                forecast.windFrom != null ? ` fra ${compassPoint(forecast.windFrom)}` : ''
              }`,
              title: describeWind(forecast.windSpeed),
            }),
            forecast.precipitation > 0 &&
              el('span', { class: 'rain', text: `${formatNumber(forecast.precipitation, 1)} mm` }),
          ]),
        ]);
      }),
    ),
  );

  const gusts = checkpoints
    .map((c) => c.forecast?.windGust ?? c.forecast?.windSpeed)
    .filter(Number.isFinite);
  if (gusts.length && Math.max(...gusts) >= 13.9) {
    nodes.push(
      el('p', {
        class: 'notice notice--warn',
        text: `Kraftig vind i vente – opptil ${formatNumber(Math.max(...gusts), 0)} m/s (${describeWind(
          Math.max(...gusts),
        )}). På eksponerte rygger merkes det kraftig.`,
      }),
    );
  }

  const cold = checkpoints.map((c) => c.forecast?.temperature).filter(Number.isFinite);
  if (cold.length && Math.min(...cold) <= 0) {
    nodes.push(
      el('p', {
        class: 'notice',
        text: `Det kan bli ned mot ${formatNumber(Math.min(...cold), 0)} °C. Regn med is på stien og ta med ekstra lag.`,
      }),
    );
  }

  return nodes;
}

/* ---------- Sikkerhet ---------- */

const FJELLVETT = [
  'Planlegg turen og meld fra hvor du går.',
  'Tilpass turen etter evne og forhold.',
  'Ta hensyn til vær- og skredvarsel.',
  'Vær forberedt på uvær og kulde, selv på korte turer.',
  'Ta med nødvendig utstyr for å hjelpe deg selv og andre.',
  'Ta trygge veivalg. Gjenkjenn skredfarlig terreng og usikker is.',
  'Bruk kart og kompass. Vit alltid hvor du er.',
  'Vend i tide, det er ingen skam å snu.',
  'Spar på kreftene og søk ly om nødvendig.',
];

export function renderSafety(summary, sun, avalanche, startTime, checklist, onToggleCheck) {
  const nodes = [];

  if (!summary) {
    nodes.push(el('p', { class: 'hint', text: 'Tegn en rute for å få en sikkerhetsvurdering.' }));
  } else {
    const daylight = daylightCheck(sun, startTime, summary.time.totalSeconds);
    if (daylight) {
      const text =
        daylight.status === 'mørkt'
          ? `Du er beregnet i mål kl. ${formatClock(daylight.finish)} – ${formatDuration(
              -daylight.minutesOfLight * 60,
            )} etter solnedgang. Ta med hodelykt eller start tidligere.`
          : daylight.status === 'knapt'
            ? `Du er i mål kl. ${formatClock(daylight.finish)}, bare ${Math.round(
                daylight.minutesOfLight,
              )} minutter før solnedgang. Marginen er tynn.`
            : `Du er i mål kl. ${formatClock(daylight.finish)}, ${formatDuration(
                daylight.minutesOfLight * 60,
              )} før solnedgang.`;
      nodes.push(
        el('p', {
          class: `notice notice--${daylight.status === 'ok' ? 'ok' : daylight.status === 'knapt' ? 'warn' : 'alert'}`,
          text,
        }),
      );
    }

    if (summary.steepestSlope > 0.4) {
      nodes.push(
        el('p', {
          class: 'notice notice--warn',
          text: `Ruta har partier brattere enn ${formatNumber(
            summary.steepestSlope * 100,
            0,
          )} %. Sjekk i kartet at du ikke har lagt linja over en bergvegg.`,
        }),
      );
    }
  }

  if (avalanche?.warnings?.length) {
    for (const warning of avalanche.warnings) {
      const level = DANGER_LEVELS[warning.level];
      nodes.push(
        el('div', { class: 'danger', style: `--danger-color:${level?.color ?? '#888'}` }, [
          el('span', { class: 'danger__level', text: String(warning.level) }),
          el('div', {}, [
            el('strong', { text: `Skredfare ${level?.label ?? ''} – ${formatDay(warning.date)}` }),
            el('span', { class: 'danger__region', text: warning.region ?? '' }),
            el('p', { text: warning.text || level?.advice || '' }),
          ]),
        ]),
      );
    }
    nodes.push(
      el('p', { class: 'hint' }, [
        'Fullt varsel på ',
        el('a', { href: 'https://varsom.no/', target: '_blank', rel: 'noopener', text: 'varsom.no' }),
        '.',
      ]),
    );
  } else if (avalanche && !avalanche.unavailable) {
    nodes.push(
      el('p', { class: 'hint', text: 'Ingen snøskredvarsel for dette området nå. Varslene går normalt fra desember til mai.' }),
    );
  }

  nodes.push(
    el('section', { class: 'block' }, [
      el('h2', { class: 'block__title', text: 'Fjellvettreglene' }),
      el(
        'ul',
        { class: 'checklist' },
        FJELLVETT.map((rule, index) =>
          el('li', {}, [
            el('label', { class: 'check' }, [
              el('input', {
                type: 'checkbox',
                checked: Boolean(checklist?.[index]),
                onchange: (event) => onToggleCheck(index, event.target.checked),
              }),
              el('span', { text: rule }),
            ]),
          ]),
        ),
      ),
      el('p', { class: 'hint' }, [
        'Nødnummer i fjellet: ',
        el('strong', { text: '112' }),
        ' (politi, redning) og ',
        el('strong', { text: '113' }),
        ' (ambulanse). Appen ',
        el('a', { href: 'https://www.hjelp113.no/', target: '_blank', rel: 'noopener', text: 'Hjelp 113' }),
        ' sender posisjonen din automatisk.',
      ]),
    ]),
  );

  return nodes;
}

/* ---------- Langs ruta ---------- */

export function renderPois(pois, summary, loading, handlers) {
  if (loading) return [el('p', { class: 'hint', text: 'Leter etter hytter, topper og vann langs ruta …' })];
  if (!summary) return [el('p', { class: 'hint', text: 'Tegn en rute for å se hva som ligger langs den.' })];
  if (!pois.length) {
    return [el('p', { class: 'hint', text: 'Fant ingenting kartlagt langs denne ruta. Prøv en lengre strekning.' })];
  }

  const withDistance = pois
    .map((poi) => {
      const hit = closestPointOnPath(poi, summary.line);
      return { ...poi, along: summary.distances[hit.index], offRoute: hit.distance };
    })
    .sort((a, b) => a.along - b.along);

  return [
    el('p', { class: 'hint', text: `${withDistance.length} steder innenfor 700 meter fra ruta. Data fra OpenStreetMap.` }),
    el(
      'ul',
      { class: 'pois' },
      withDistance.map((poi) =>
        el('li', { class: 'poi-row' }, [
          el('span', { class: 'poi-row__icon', 'aria-hidden': 'true', text: POI_KINDS[poi.kind].icon }),
          el('span', { class: 'poi-row__body' }, [
            el('button', {
              class: 'linkish',
              type: 'button',
              text: poi.name,
              onclick: () => handlers.onFocusPoi(poi),
            }),
            el('span', { class: 'poi-row__meta' }, [
              POI_KINDS[poi.kind].label,
              poi.dnt ? ' · DNT' : '',
              Number.isFinite(poi.elevation) ? ` · ${formatElevation(poi.elevation)} moh.` : '',
              ` · ${formatDistance(poi.along)} inn i turen`,
              poi.offRoute > 60 ? ` · ${formatDistance(poi.offRoute)} til siden` : '',
            ].join('')),
          ]),
          (poi.website || poi.kind === 'hytte') &&
            el('a', {
              class: 'linkish linkish--small',
              href: poi.website ?? `https://ut.no/sok?query=${encodeURIComponent(poi.name)}`,
              target: '_blank',
              rel: 'noopener',
              text: poi.website ? 'Nettside' : 'ut.no',
            }),
        ]),
      ),
    ),
  ];
}

/* ---------- Kartlag ---------- */

export function renderLayers(options, trailState, handlers) {
  return [
    el('section', { class: 'block' }, [
      el('h2', { class: 'block__title', text: 'Bakgrunnskart' }),
      el(
        'div',
        { class: 'radio-list', role: 'radiogroup', 'aria-label': 'Bakgrunnskart' },
        BASEMAPS.map((basemap) =>
          el('label', { class: 'radio' }, [
            el('input', {
              type: 'radio',
              name: 'basemap',
              value: basemap.id,
              checked: options.basemap === basemap.id,
              onchange: () => handlers.onBasemap(basemap.id),
            }),
            el('span', {}, [
              el('strong', { text: basemap.label }),
              el('span', { class: 'radio__hint', text: basemap.hint }),
            ]),
          ]),
        ),
      ),
    ]),
    el('section', { class: 'block' }, [
      el('h2', { class: 'block__title', text: 'Ruter og løyper' }),
      el('p', { class: 'hint', text: 'Fra Turrutebasen – den nasjonale databasen over merkede ruter. Vises fra zoomnivå 11.' }),
      el(
        'div',
        { class: 'check-list' },
        TRAIL_WMS.layers.map((layer) =>
          el('label', { class: 'check' }, [
            el('input', {
              type: 'checkbox',
              checked: Boolean(trailState[layer.id]),
              onchange: (event) => handlers.onTrailLayer(layer.id, event.target.checked),
            }),
            el('span', { text: layer.label }),
          ]),
        ),
      ),
    ]),
  ];
}

/* ---------- Lagrede turer ---------- */

export function renderSavedTrips(trips, handlers) {
  if (!trips.length) {
    return [
      el('p', {
        class: 'hint',
        text: 'Ingen lagrede turer ennå. Trykk «Lagre» så ligger turen her neste gang du åpner siden – også uten nett.',
      }),
    ];
  }

  return [
    el(
      'ul',
      { class: 'trips' },
      trips.map((trip) =>
        el('li', { class: 'trip' }, [
          el('button', {
            class: 'trip__open',
            type: 'button',
            onclick: () => handlers.onOpenTrip(trip),
            html: `<strong>${escapeHtml(trip.name)}</strong><span>${trip.waypoints.length} punkter · lagret ${formatDay(
              new Date(trip.savedAt),
            )}</span>`,
          }),
          el('button', {
            class: 'icon-btn icon-btn--tiny',
            type: 'button',
            title: `Slett ${trip.name}`,
            html: '<span aria-hidden="true">✕</span>',
            onclick: () => handlers.onDeleteTrip(trip),
          }),
        ]),
      ),
    ),
  ];
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
