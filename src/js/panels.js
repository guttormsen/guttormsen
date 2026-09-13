/**
 * Innholdet i panelet. Hver funksjon tar data inn og gir DOM-noder ut,
 * uten å røre global tilstand – da er de lette å flytte på og resonnere om.
 */
import { BASEMAPS, PACE, TERRAIN, TRAIL_WMS } from './config.js';
import { DANGER_LEVELS } from './api/varsom.js';
import { POI_KINDS } from './api/overpass.js';
import { describeSymbol, describeWind } from './api/met.js';
import { closestPointOnPath, compassPoint } from './geo.js';
import { daylightCheck } from './weather.js';
import { GRADES, LENGTH_BUCKETS, SPECIAL_TYPES, hasActiveFilters } from './trips.js';
import { FEATURES, FEATURE_LIST, topFeatures } from './features.js';
import { badgeStatus, highlights, nextBadges, totals } from './journal.js';
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

/* ---------- Små byggeklosser ---------- */

const stat = (label, value, hint) =>
  el('div', { class: 'stat' }, [
    el('span', { class: 'stat__value', text: value }),
    el('span', { class: 'stat__label', text: label }),
    hint && el('span', { class: 'stat__hint', text: hint }),
  ]);

const chip = (label, active, onClick, { icon, title, disabled } = {}) =>
  el('button', {
    type: 'button',
    class: `chip chip--toggle${active ? ' is-on' : ''}`,
    'aria-pressed': String(Boolean(active)),
    title: title ?? '',
    disabled,
    onclick: onClick,
  }, [icon && el('span', { 'aria-hidden': 'true', text: `${icon} ` }), label]);

const section = (title, children, { open = true, collapsible = false, badge } = {}) => {
  if (!collapsible) {
    return el('section', { class: 'block' }, [
      title &&
        el('h2', { class: 'block__title' }, [title, badge && el('span', { class: 'block__badge', text: badge })]),
      ...[].concat(children).filter(Boolean),
    ]);
  }
  return el('details', { class: 'block block--fold', open }, [
    el('summary', { class: 'block__title' }, [title, badge && el('span', { class: 'block__badge', text: badge })]),
    el('div', { class: 'block__body' }, [].concat(children).filter(Boolean)),
  ]);
};

// `el` bruker createElement, som ikke duger til SVG – lag dem i riktig navnerom.
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of [].concat(children).filter(Boolean)) node.append(child);
  return node;
}

/** Bittelite høydeprofil-riss til turkortene. */
function sparkline(elevations) {
  const values = (elevations ?? []).filter(Number.isFinite);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(20, max - min);
  const points = values
    .map((value, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(24 - ((value - min) / span) * 22).toFixed(1)}`)
    .join(' ');
  return svg('svg', { class: 'spark', viewBox: '0 0 100 24', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, [
    svg('polyline', { points: `0,24 ${points} 100,24`, class: 'spark__fill' }),
    svg('polyline', { points, class: 'spark__line' }),
  ]);
}

/* ---------- Nøkkeltall ---------- */

export function renderStats(summary, loading) {
  if (!summary) return [];

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
        el('span', { class: 'chip', text: `Høyeste punkt ${formatElevation(summary.maxElevation)}` }),
      summary.steepestSlope > 0.35 &&
        el('span', {
          class: 'chip chip--warn',
          text: `Bratteste parti ${formatNumber(summary.steepestSlope * 100, 0)} %`,
        }),
      loading.elevation && el('span', { class: 'chip chip--busy', text: 'Henter høyder …' }),
    ]),
  ];
  return nodes;
}

/* ---------- Finn tur ---------- */

const gradeFilters = [
  { id: 'enkel', ...GRADES.G },
  { id: 'middels', ...GRADES.B },
  { id: 'krevende', ...GRADES.R },
  { id: 'ekspert', ...GRADES.S },
];

export function renderDiscover(discovery, filters, handlers) {
  const nodes = [];

  /* Filtre */
  nodes.push(
    el('div', { class: 'filters' }, [
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Hvor lang tur' },
        LENGTH_BUCKETS.map((bucket) =>
          chip(bucket.label, filters.lengths.includes(bucket.id), () => handlers.onToggleLength(bucket.id), {
            icon: bucket.icon,
            title: bucket.hint,
          }),
        ),
      ),
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Hva vil du ha med' }, [
        chip('Under 1 time', filters.maxMinutes === 60, () => handlers.onQuickTime(60), {
          icon: '⏱️',
          title: 'Turer som tar under en time',
        }),
        ...['bading', 'bål', 'rasteplass', 'utsikt', 'kollektiv', 'hc', 'toalett', 'lek'].map((id) =>
          chip(FEATURES[id].label, filters.features.includes(id), () => handlers.onToggleFeature(id), {
            icon: FEATURES[id].icon,
            title: FEATURES[id].hint ?? `Turer med ${FEATURES[id].label.toLowerCase()} langs ruta`,
          }),
        ),
      ]),
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Vanskegrad' }, [
        ...gradeFilters.map((grade) =>
          el('button', {
            type: 'button',
            class: `chip chip--toggle chip--dot${filters.grades.includes(grade.id) ? ' is-on' : ''}`,
            style: `--dot:${grade.color}`,
            'aria-pressed': String(filters.grades.includes(grade.id)),
            title: grade.hint,
            text: grade.label,
            onclick: () => handlers.onToggleGrade(grade.id),
          }),
        ),
        chip('Rundtur', filters.shape === 'rundtur', () => handlers.onShape('rundtur'), {
          icon: '🔄',
          title: 'Turer som ender der de startet',
        }),
        chip('Merket', filters.markedOnly, handlers.onToggleMarked, {
          icon: '🚩',
          title: 'Bare ruter som er merket i terrenget',
        }),
        ...Object.values(SPECIAL_TYPES).map((type) =>
          chip(type.label, filters.special === type.id, () => handlers.onSpecial(type.id), { icon: type.icon }),
        ),
      ]),
      hasActiveFilters(filters) &&
        el('button', { class: 'linkish linkish--small', type: 'button', text: 'Nullstill filtre', onclick: handlers.onResetFilters }),
    ]),
  );

  /* Tilstander */
  if (discovery.loading) {
    nodes.push(
      el('p', { class: 'hint', text: 'Leter i den nasjonale rutebasen. Det tar gjerne ti sekunder første gang – etterpå ligger området i minnet.' }),
      el('div', { class: 'skeletons' }, Array.from({ length: 4 }, () => el('div', { class: 'skeleton' }))),
    );
    return nodes;
  }

  if (!discovery.searched) {
    nodes.push(
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__big', text: '🧭' }),
        el('p', { class: 'empty__title', text: 'Hvor skal vi i dag?' }),
        el('p', { text: 'Søk opp et sted, eller flytt kartet dit du vil gå. Så finner jeg turene som allerede er merket der.' }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'Finn turer her', onclick: handlers.onSearchHere }),
      ]),
    );
    return nodes;
  }

  if (discovery.error) {
    nodes.push(
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__big', text: '📡' }),
        el('p', { class: 'empty__title', text: 'Fikk ikke svar fra rutebasen' }),
        el('p', { text: 'Tjenesten hos Geonorge svarte ikke. Prøv en gang til om litt.' }),
        el('button', { class: 'btn', type: 'button', text: 'Prøv igjen', onclick: handlers.onSearchHere }),
      ]),
    );
    return nodes;
  }

  const { visible, total } = discovery;

  if (!total) {
    nodes.push(
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__big', text: '🫥' }),
        el('p', { class: 'empty__title', text: 'Ingen merkede turer her' }),
        el('p', {
          text: 'Rutebasen bygges på leveranser fra kommuner og turlag, og dekningen er ujevn. Prøv et annet område – eller tegn din egen rute rett i kartet.',
        }),
        el('button', { class: 'btn', type: 'button', text: 'Tegn min egen', onclick: handlers.onDrawOwn }),
      ]),
    );
    return nodes;
  }

  if (!visible.length) {
    nodes.push(
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__big', text: '🔎' }),
        el('p', { class: 'empty__title', text: `Ingen av de ${total} turene passer filtrene` }),
        el('button', { class: 'btn', type: 'button', text: 'Nullstill filtre', onclick: handlers.onResetFilters }),
      ]),
    );
    return nodes;
  }

  nodes.push(
    el('div', { class: 'result-bar' }, [
      el('span', { class: 'result-bar__count', text: `${visible.length} av ${total} turer` }),
      el('button', {
        class: 'btn btn--dice',
        type: 'button',
        text: '🎲 Overrask meg',
        title: 'Plukk en tilfeldig tur',
        onclick: handlers.onSurprise,
      }),
    ]),
  );

  nodes.push(el('ul', { class: 'cards' }, visible.map((trip) => tripCard(trip, handlers))));

  if (discovery.truncated) {
    nodes.push(
      el('p', { class: 'hint', text: 'Viser turene i dette utsnittet. Zoom inn for å få med flere detaljer i området.' }),
    );
  }

  return nodes;
}

/** Fotograf og lisens, slik Commons krever at de oppgis. */
function photoCredit(photo, { compact = false } = {}) {
  const parts = [photo.author, photo.license].filter(Boolean);
  if (!parts.length) return null;
  const text = compact ? parts.join(' · ') : `Foto: ${parts.join(' · ')}`;
  return photo.pageUrl
    ? el('a', {
        class: 'photo__credit',
        href: photo.pageUrl,
        target: '_blank',
        rel: 'noopener',
        title: 'Åpne bildesiden på Wikimedia Commons',
        text,
        onclick: (event) => event.stopPropagation(),
      })
    : el('span', { class: 'photo__credit', text });
}

function tripCard(trip, handlers) {
  const { shown, rest } = topFeatures(trip.features ?? []);
  const facts = [
    formatDistance(trip.length),
    trip.ascent != null ? `${formatElevation(trip.ascent)} opp` : null,
    trip.seconds != null ? formatDuration(trip.seconds) : null,
  ].filter(Boolean);

  return el('li', {}, [
    el('button', {
      class: 'card',
      type: 'button',
      onclick: () => handlers.onPickTrip(trip),
      onmouseenter: () => handlers.onPreviewTrip(trip),
      onfocus: () => handlers.onPreviewTrip(trip),
      onmouseleave: () => handlers.onPreviewTrip(null),
      onblur: () => handlers.onPreviewTrip(null),
    }, [
      trip.photo &&
        el('span', { class: 'card__photo' }, [
          el('img', {
            src: trip.photo.thumb,
            alt: `Bilde fra området ved ${trip.name}`,
            loading: 'lazy',
            decoding: 'async',
          }),
          photoCredit(trip.photo, { compact: true }),
        ]),
      el('span', { class: 'card__top' }, [
        el('span', { class: 'card__name', text: trip.name }),
        el('span', {
          class: 'card__grade',
          style: `--dot:${trip.grade.color}`,
          title: trip.grade.hint,
          text: trip.grade.label,
        }),
      ]),
      el('span', { class: 'card__facts' }, [
        el('strong', { text: facts.join(' · ') }),
        trip.ascent == null && el('span', { class: 'card__pending', text: ' henter høyder …' }),
      ]),
      el('span', { class: 'card__tags' }, [
        trip.loop ? el('span', { class: 'tag', text: '🔄 Rundtur' }) : el('span', { class: 'tag', text: '↗ Strekning' }),
        trip.marked && el('span', { class: 'tag', text: '🚩 Merket' }),
        trip.special && el('span', { class: 'tag', text: `${trip.special.icon} ${trip.special.label}` }),
        ...shown.map((id) =>
          el('span', {
            class: `tag tag--feature${id === 'hc' ? ' tag--hc' : ''}`,
            title: FEATURES[id]?.hint ?? `${FEATURES[id].label} langs ruta`,
            text: `${FEATURES[id].icon} ${FEATURES[id].label}`,
          }),
        ),
        rest > 0 &&
          el('span', {
            class: 'tag tag--more',
            title: (trip.features ?? []).map((id) => FEATURES[id].label).join(', '),
            text: `+${rest}`,
          }),
        trip.distanceFromYou != null &&
          el('span', { class: 'tag', text: `📍 ${formatDistance(trip.distanceFromYou)} unna` }),
      ]),
      trip.profile ? sparkline(trip.profile) : null,
      trip.maintainer && el('span', { class: 'card__by', text: trip.maintainer }),
    ]),
  ]);
}

/* ---------- Turen ---------- */

function localInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function renderTrip(context, handlers) {
  const { trip, summary, startTime, weather, sun, avalanche, pois, photos, article, loading, checklist } = context;

  if (!summary) {
    return [
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__big', text: '🥾' }),
        el('p', { class: 'empty__title', text: 'Ingen tur ennå' }),
        el('p', { text: 'Trykk i kartet for å sette startpunktet, og en gang til for å legge på en strekning. Eller finn en ferdig tur under «Finn tur».' }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'Se turforslag', onclick: handlers.onGoDiscover }),
      ]),
    ];
  }

  return [
    gallerySection(photos, loading.photos),
    featureSection(featuresAlongRoute(pois)),
    articleSection(article),
    quickSettings(trip, startTime, handlers),
    weatherSection(weather, sun, loading.weather, startTime),
    safetySection(summary, sun, avalanche, startTime, checklist, handlers),
    poiSection(pois, summary, loading.pois, handlers),
    waypointSection(trip, summary, handlers),
    advancedSection(trip, handlers),
  ];
}

/**
 * Bilder tatt i nærheten av ruta. De er geotaggede av fotografene selv, så
 * utvalget er sortert etter hvor godt de passer – ikke garantert å vise stien.
 */
function gallerySection(photos, loading) {
  if (loading && !photos?.length) {
    return el('div', { class: 'gallery gallery--loading' }, [el('div', { class: 'skeleton skeleton--photo' })]);
  }
  if (!photos?.length) return null;

  const [lead, ...rest] = photos;
  return el('section', { class: 'gallery' }, [
    el('figure', { class: 'photo photo--lead' }, [
      el('img', {
        src: lead.thumb,
        alt: lead.description ? lead.description.slice(0, 140) : `Bilde fra området rundt turen: ${lead.title}`,
        loading: 'lazy',
        decoding: 'async',
      }),
      el('figcaption', {}, [photoCredit(lead)]),
    ]),
    rest.length > 0 &&
      el('div', { class: 'gallery__strip' },
        rest.slice(0, 5).map((photo) =>
          el('a', {
            class: 'gallery__thumb',
            href: photo.pageUrl ?? photo.thumb,
            target: '_blank',
            rel: 'noopener',
            title: [photo.title, photo.author, photo.license].filter(Boolean).join(' · '),
          }, [
            el('img', { src: photo.thumb, alt: photo.title, loading: 'lazy', decoding: 'async' }),
          ]),
        ),
      ),
    el('p', { class: 'gallery__note' }, [
      'Bilder fra ',
      el('a', { href: 'https://commons.wikimedia.org/', target: '_blank', rel: 'noopener', text: 'Wikimedia Commons' }),
      ', tatt i nærheten av ruta.',
    ]),
  ]);
}

/** Kort utdrag fra Wikipedia, bare når artikkelen handler om denne turen. */
function articleSection(article) {
  if (!article) return null;
  return section('Om stedet', [
    el('p', { class: 'article__text', text: article.extract }),
    el('a', {
      class: 'linkish linkish--small',
      href: article.url,
      target: '_blank',
      rel: 'noopener',
      text: `Les mer om ${article.title} på Wikipedia`,
    }),
  ]);
}

function quickSettings(trip, startTime, handlers) {
  return el('div', { class: 'quick' }, [
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Hvor fort går du?' }),
      segmented('Marsjfart', PACE, trip.options.pace, (id) => handlers.onOptions({ pace: id })),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'trip-start', text: 'Når starter du?' }),
      el('input', {
        class: 'input',
        type: 'datetime-local',
        id: 'trip-start',
        value: localInputValue(startTime),
        onchange: (event) => {
          const date = new Date(event.target.value);
          if (!Number.isNaN(date.getTime())) handlers.onStartTime(date);
        },
      }),
    ]),
  ]);
}

function weatherSection(checkpoints, sun, loading, startTime) {
  const body = [];

  if (sun) {
    body.push(
      el('div', { class: 'sun' }, [
        el('span', { text: `🌅 ${sun.sunrise ? formatClock(sun.sunrise) : '–'}` }),
        el('span', { text: `🌇 ${sun.sunset ? formatClock(sun.sunset) : '–'}` }),
        sun.polarDay && el('span', { text: 'Midnattssol' }),
        sun.polarNight && el('span', { text: 'Mørketid' }),
      ]),
    );
  }

  if (!checkpoints?.length) {
    body.push(
      el('p', {
        class: 'hint',
        text: loading ? 'Henter varsel fra Meteorologisk institutt …' : 'Varselet kommer så snart ruta er klar.',
      }),
    );
    return section('Været underveis', body);
  }

  body.push(
    el('ul', { class: 'weather' },
      checkpoints.map((checkpoint) => {
        const forecast = checkpoint.forecast;
        const symbol = describeSymbol(forecast?.symbol);
        const place = checkpoint.label ?? formatDistance(checkpoint.distance);

        if (!forecast) {
          return el('li', { class: 'weather__row weather__row--empty' }, [
            el('span', { class: 'weather__where', text: place }),
            el('span', {
              class: 'weather__none',
              text: checkpoint.error ? 'Varsel utilgjengelig' : 'Lenger fram enn varselet rekker',
            }),
          ]);
        }

        return el('li', { class: 'weather__row' }, [
          el('span', { class: 'weather__where' }, [
            el('strong', { text: place }),
            el('span', { class: 'weather__time', text: `kl. ${formatClock(checkpoint.eta)}` }),
          ]),
          el('span', { class: 'weather__icon', title: symbol.label, text: symbol.icon }),
          el('span', { class: 'weather__values' }, [
            el('strong', {
              class: `temp ${forecast.temperature < 0 ? 'temp--cold' : ''}`,
              text: `${formatNumber(forecast.temperature, 0)}°`,
            }),
            el('span', {
              text: `${formatNumber(forecast.windSpeed, 0)} m/s${
                forecast.windFrom != null ? ` ${compassPoint(forecast.windFrom)}` : ''
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

  const gusts = checkpoints.map((c) => c.forecast?.windGust ?? c.forecast?.windSpeed).filter(Number.isFinite);
  if (gusts.length && Math.max(...gusts) >= 13.9) {
    body.push(
      el('p', {
        class: 'notice notice--warn',
        text: `Opptil ${formatNumber(Math.max(...gusts), 0)} m/s – ${describeWind(
          Math.max(...gusts),
        )}. På eksponerte rygger merkes det godt.`,
      }),
    );
  }

  const temperatures = checkpoints.map((c) => c.forecast?.temperature).filter(Number.isFinite);
  if (temperatures.length && Math.min(...temperatures) <= 0) {
    body.push(
      el('p', {
        class: 'notice',
        text: `Ned mot ${formatNumber(Math.min(...temperatures), 0)} °C. Regn med is på stien.`,
      }),
    );
  }

  body.push(el('p', { class: 'hint', text: `Varselet gjelder klokkeslettet du er beregnet å være der, ${formatDay(startTime)}.` }));
  return section('Været underveis', body);
}

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

function safetySection(summary, sun, avalanche, startTime, checklist, handlers) {
  const body = [];
  let warnings = 0;

  const daylight = daylightCheck(sun, startTime, summary.time.totalSeconds);
  if (daylight) {
    const text =
      daylight.status === 'mørkt'
        ? `Du er i mål kl. ${formatClock(daylight.finish)} – etter at sola har gått ned. Ta med hodelykt, eller start tidligere.`
        : daylight.status === 'knapt'
          ? `Du er i mål kl. ${formatClock(daylight.finish)}, bare ${Math.round(daylight.minutesOfLight)} minutter før solnedgang.`
          : `Du er i mål kl. ${formatClock(daylight.finish)}, i god tid før mørket.`;
    if (daylight.status !== 'ok') warnings++;
    body.push(
      el('p', {
        class: `notice notice--${daylight.status === 'ok' ? 'ok' : daylight.status === 'knapt' ? 'warn' : 'alert'}`,
        text,
      }),
    );
  }

  if (summary.steepestSlope > 0.4) {
    warnings++;
    body.push(
      el('p', {
        class: 'notice notice--warn',
        text: `Ruta har partier brattere enn ${formatNumber(summary.steepestSlope * 100, 0)} %. Sjekk i kartet at linja ikke går over en bergvegg.`,
      }),
    );
  }

  if (avalanche?.warnings?.length) {
    warnings += avalanche.warnings.length;
    for (const warning of avalanche.warnings) {
      const level = DANGER_LEVELS[warning.level];
      body.push(
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
  } else if (avalanche && !avalanche.unavailable) {
    body.push(el('p', { class: 'hint', text: 'Ingen snøskredvarsel for området nå. Varslene går normalt fra desember til mai.' }));
  }

  const done = checklist.filter(Boolean).length;
  body.push(
    section(
      'Fjellvettreglene',
      [
        el('ul', { class: 'checklist' },
          FJELLVETT.map((rule, index) =>
            el('li', {}, [
              el('label', { class: 'check' }, [
                el('input', {
                  type: 'checkbox',
                  checked: Boolean(checklist[index]),
                  onchange: (event) => handlers.onToggleCheck(index, event.target.checked),
                }),
                el('span', { text: rule }),
              ]),
            ]),
          ),
        ),
        el('p', { class: 'hint' }, [
          'Nødnummer i fjellet: ',
          el('strong', { text: '112' }),
          ' og ',
          el('strong', { text: '113' }),
          '. Appen ',
          el('a', { href: 'https://www.hjelp113.no/', target: '_blank', rel: 'noopener', text: 'Hjelp 113' }),
          ' sender posisjonen din automatisk.',
        ]),
      ],
      { collapsible: true, open: false, badge: `${done}/9` },
    ),
  );

  return section('Sikkerhet', body, { collapsible: true, open: warnings > 0, badge: warnings ? String(warnings) : null });
}

/** Utleder merkene av de fasilitetene vi allerede har hentet for ruta. */
function featuresAlongRoute(pois) {
  if (!pois?.length) return [];
  return FEATURE_LIST.filter((feature) =>
    pois.some((poi) => (feature.wheelchairOnly ? poi.wheelchair === 'ja' : feature.kinds?.includes(poi.kind))),
  ).map((feature) => feature.id);
}

/** Kjapp oversikt over hva som finnes langs turen. */
function featureSection(features) {
  if (!features?.length) return null;
  return el('div', { class: 'feature-row' },
    features.map((id) =>
      el('span', {
        class: `tag tag--feature${id === 'hc' ? ' tag--hc' : ''}`,
        title: FEATURES[id]?.hint ?? `${FEATURES[id].label} langs ruta`,
        text: `${FEATURES[id].icon} ${FEATURES[id].label}`,
      }),
    ),
  );
}

function poiSection(pois, summary, loading, handlers) {
  if (loading) return section('Langs ruta', el('p', { class: 'hint', text: 'Ser etter hytter, topper og vann …' }), { collapsible: true, open: false });
  if (!pois.length) {
    return section('Langs ruta', el('p', { class: 'hint', text: 'Fant ingenting kartlagt langs denne ruta.' }), {
      collapsible: true,
      open: false,
    });
  }

  const withDistance = pois
    .map((poi) => {
      const hit = closestPointOnPath(poi, summary.line);
      return { ...poi, along: summary.distances[hit.index], offRoute: hit.distance };
    })
    .sort((a, b) => a.along - b.along);

  return section(
    'Langs ruta',
    el('ul', { class: 'pois' },
      withDistance.map((poi) =>
        el('li', { class: 'poi-row' }, [
          el('span', { class: 'poi-row__icon', 'aria-hidden': 'true', text: POI_KINDS[poi.kind].icon }),
          el('span', { class: 'poi-row__body' }, [
            el('button', { class: 'linkish', type: 'button', text: poi.name, onclick: () => handlers.onFocusPoi(poi) }),
            el('span', {
              class: 'poi-row__meta',
              text: [
                POI_KINDS[poi.kind].label,
                poi.dnt ? 'DNT' : null,
                Number.isFinite(poi.elevation) ? `${formatElevation(poi.elevation)} moh.` : null,
                `${formatDistance(poi.along)} inn i turen`,
              ]
                .filter(Boolean)
                .join(' · '),
            }),
            poi.wheelchair &&
              el('span', {
                class: `access access--${poi.wheelchair}`,
                title: 'Rullestoltilgang slik OpenStreetMap oppgir den',
                text:
                  poi.wheelchair === 'ja'
                    ? '♿ Rullestolvennlig'
                    : poi.wheelchair === 'delvis'
                      ? '♿ Delvis tilgjengelig'
                      : '♿ Ikke tilrettelagt',
              }),
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
    { collapsible: true, open: false, badge: String(withDistance.length) },
  );
}

function waypointSection(trip, summary, handlers) {
  if (!trip.waypoints.length) return null;

  return section(
    'Veipunkter',
    [
      el('ol', { class: 'waypoints' },
        trip.waypoints.map((waypoint, index) => {
          const along = summary?.line.length > 1 ? closestPointOnPath(waypoint, summary.line) : null;
          const distance = along ? summary.distances[along.index] : null;
          const seconds = along ? summary.time.cumulativeSeconds[along.index] : null;
          const kind = index === 0 ? 'start' : index === trip.waypoints.length - 1 ? 'slutt' : 'mellom';

          return el('li', { class: 'waypoint' }, [
            el('span', { class: `wp wp--${kind}`, 'aria-hidden': 'true', text: index === 0 ? 'A' : kind === 'slutt' ? 'B' : String(index) }),
            el('span', { class: 'waypoint__body' }, [
              el('button', {
                class: 'linkish',
                type: 'button',
                text: waypoint.name ?? `Punkt ${index + 1}`,
                onclick: () => handlers.onFocusWaypoint(waypoint),
              }),
              distance != null &&
                el('span', { class: 'waypoint__meta', text: `${formatDistance(distance)} · ${formatDuration(seconds)} inn i turen` }),
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
      el('p', { class: 'hint', text: 'Dra et punkt for å flytte det. Trykk på selve ruta for å sette inn et nytt.' }),
    ],
    { collapsible: true, open: false, badge: String(trip.waypoints.length) },
  );
}

function advancedSection(trip, handlers) {
  const { options } = trip;

  const toggle = (id, label, checked, hint, onChange) =>
    el('label', { class: 'toggle', for: id }, [
      el('input', { id, type: 'checkbox', checked, onchange: (event) => onChange(event.target.checked) }),
      el('span', { class: 'toggle__body' }, [
        el('span', { class: 'toggle__label', text: label }),
        el('span', { class: 'toggle__hint', text: hint }),
      ]),
    ]);

  return section(
    'Avansert',
    [
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Navn på turen' }),
        el('input', {
          class: 'input',
          type: 'text',
          id: 'trip-name',
          placeholder: 'F.eks. Besseggen fra Gjendesheim',
          value: trip.name,
          maxlength: 80,
          oninput: (event) => handlers.onName(event.target.value),
        }),
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Underlag' }),
        segmented('Underlag', TERRAIN, options.terrain, (id) => handlers.onOptions({ terrain: id })),
        el('span', { class: 'field__hint', text: TERRAIN.find((t) => t.id === options.terrain)?.hint ?? '' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label', for: 'opt-pack', text: 'Sekkevekt' }),
        el('div', { class: 'range-row' }, [
          el('input', {
            class: 'range',
            type: 'range',
            id: 'opt-pack',
            min: '2',
            max: '25',
            step: '1',
            value: String(options.packKg),
            oninput: (event) => handlers.onOptions({ packKg: Number(event.target.value) }),
          }),
          el('output', { text: `${options.packKg} kg` }),
        ]),
      ]),
      toggle('opt-breaks', 'Regn med pauser', options.breaks, '8 minutter per gåtime etter den første.', (value) =>
        handlers.onOptions({ breaks: value }),
      ),
      toggle('opt-snap', 'Følg sti', options.snapToTrail, 'Nye strekninger legges langs kartlagte stier.', (value) =>
        handlers.onOptions({ snapToTrail: value }),
      ),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', type: 'button', text: 'Snu retning', disabled: trip.waypoints.length < 2, onclick: handlers.onReverse }),
        el('button', { class: 'btn', type: 'button', text: 'Gjør til tur–retur', disabled: trip.waypoints.length < 2, onclick: handlers.onRoundTrip }),
        el('button', { class: 'btn', type: 'button', text: 'Last ned GPX', onclick: handlers.onExportGpx }),
        el('label', { class: 'btn btn--file' }, [
          'Åpne GPX',
          el('input', {
            id: 'input-gpx',
            type: 'file',
            accept: '.gpx,application/gpx+xml',
            class: 'visually-hidden',
            onchange: handlers.onImportGpx,
          }),
        ]),
      ]),
    ],
    { collapsible: true, open: false },
  );
}

/* ---------- Dagbok ---------- */

export function renderJournal(savedTrips, handlers) {
  const all = handlers.entries();
  const sums = totals(all);
  const nodes = [];

  nodes.push(
    el('div', { class: 'totals' }, [
      stat('Turer', formatNumber(sums.trips)),
      stat('Kilometer', formatNumber(sums.distance / 1000, sums.distance < 100000 ? 1 : 0)),
      stat('Høydemeter', formatNumber(sums.ascent)),
    ]),
  );

  const lines = highlights(all);
  if (lines.length) {
    nodes.push(el('ul', { class: 'highlights' }, lines.map((line) => el('li', { text: line }))));
  }

  if (!sums.trips) {
    nodes.push(
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__big', text: '📖' }),
        el('p', { class: 'empty__title', text: 'Boka er tom – foreløpig' }),
        el('p', { text: 'Når du har gått en tur, trykker du «Jeg gikk denne» nederst. Da samler den seg opp her, med kilometer, høydemeter og merker.' }),
      ]),
    );
  }

  const coming = nextBadges(all, 2);
  if (coming.length && sums.trips > 0) {
    nodes.push(
      section('Nærmeste milepæl', coming.map((badge) =>
        el('div', { class: 'goal' }, [
          el('span', { class: 'goal__icon', 'aria-hidden': 'true', text: badge.icon }),
          el('span', { class: 'goal__body' }, [
            el('strong', { text: badge.label }),
            el('span', { class: 'goal__hint', text: badge.hint }),
            el('span', {
              class: 'bar',
              role: 'progressbar',
              'aria-valuenow': Math.round(badge.progress * 100),
              'aria-valuemin': '0',
              'aria-valuemax': '100',
              'aria-label': `Framgang mot ${badge.label}`,
            }, [el('span', { class: 'bar__fill', style: `width:${Math.round(badge.progress * 100)}%` })]),
          ]),
        ]),
      )),
    );
  }

  const badges = badgeStatus(all);
  const earned = badges.filter((badge) => badge.earned).length;
  nodes.push(
    section(
      'Merker',
      el('ul', { class: 'badges' },
        badges.map((badge) =>
          el('li', { class: `badge${badge.earned ? ' is-earned' : ''}`, title: badge.hint }, [
            el('span', { class: 'badge__icon', 'aria-hidden': 'true', text: badge.icon }),
            el('span', { class: 'badge__label', text: badge.label }),
          ]),
        ),
      ),
      { badge: `${earned}/${badges.length}` },
    ),
  );

  if (all.length) {
    nodes.push(
      section(
        'Gåtte turer',
        el('ul', { class: 'trips' },
          all.map((entry) =>
            el('li', { class: 'trip' }, [
              el('span', { class: 'trip__body' }, [
                el('strong', { text: entry.name }),
                el('span', {
                  text: `${formatDay(new Date(entry.date))} · ${formatDistance(entry.distance)} · ${formatElevation(
                    entry.ascent,
                  )} opp`,
                }),
              ]),
              el('button', {
                class: 'icon-btn icon-btn--tiny',
                type: 'button',
                title: `Fjern ${entry.name} fra dagboka`,
                html: '<span aria-hidden="true">✕</span>',
                onclick: () => handlers.onRemoveEntry(entry.id),
              }),
            ]),
          ),
        ),
        { collapsible: true, open: true, badge: String(all.length) },
      ),
    );
  }

  nodes.push(
    section(
      'Lagrede planer',
      savedTrips.length
        ? el('ul', { class: 'trips' },
            savedTrips.map((saved) =>
              el('li', { class: 'trip' }, [
                el('button', {
                  class: 'trip__open',
                  type: 'button',
                  onclick: () => handlers.onOpenTrip(saved),
                }, [
                  el('strong', { text: saved.name }),
                  el('span', { text: `${saved.waypoints.length} punkter · lagret ${formatDay(new Date(saved.savedAt))}` }),
                ]),
                el('button', {
                  class: 'icon-btn icon-btn--tiny',
                  type: 'button',
                  title: `Slett ${saved.name}`,
                  html: '<span aria-hidden="true">✕</span>',
                  onclick: () => handlers.onDeleteTrip(saved),
                }),
              ]),
            ),
          )
        : el('p', { class: 'hint', text: 'Trykk «Lagre» på en tur, så ligger den her – også uten nett.' }),
      { collapsible: true, open: false, badge: savedTrips.length ? String(savedTrips.length) : null },
    ),
  );

  nodes.push(
    el('p', { class: 'credits' }, [
      'Alt i dagboka ligger bare i denne nettleseren. Ingen konto, ingenting sendes noe sted.',
    ]),
  );

  return nodes;
}

/* ---------- Kartlag ---------- */

export function renderLayers(basemap, trailState, handlers) {
  return [
    el('h2', { class: 'popover__title', text: 'Bakgrunnskart' }),
    el('div', { class: 'radio-list', role: 'radiogroup', 'aria-label': 'Bakgrunnskart' },
      BASEMAPS.map((map) =>
        el('label', { class: 'radio' }, [
          el('input', {
            type: 'radio',
            name: 'basemap',
            value: map.id,
            checked: basemap === map.id,
            onchange: () => handlers.onBasemap(map.id),
          }),
          el('span', {}, [el('strong', { text: map.label }), el('span', { class: 'radio__hint', text: map.hint })]),
        ]),
      ),
    ),
    el('h2', { class: 'popover__title', text: 'Ruter og løyper' }),
    el('div', { class: 'check-list' },
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
    el('p', { class: 'hint', text: 'Fra Turrutebasen. Vises fra zoomnivå 11.' }),
  ];
}

/* ---------- Bunnrad ---------- */

export function renderFooter(summary, handlers) {
  if (!summary) return [];
  return [
    el('div', { class: 'panel__buttons' }, [
      el('button', { class: 'btn btn--primary', type: 'button', text: '✓ Jeg gikk denne', onclick: handlers.onLogTrip }),
      el('button', { class: 'btn', type: 'button', text: 'Lagre', onclick: handlers.onSave }),
      el('button', { class: 'btn', type: 'button', text: 'Del', onclick: handlers.onShare }),
    ]),
    el('p', { class: 'credits' }, [
      'Kart og høyder: ',
      el('a', { href: 'https://www.kartverket.no/', target: '_blank', rel: 'noopener', text: 'Kartverket' }),
      ' · Ruter: Turrutebasen og ',
      el('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: 'OpenStreetMap' }),
      ' · Vær: ',
      el('a', { href: 'https://www.met.no/', target: '_blank', rel: 'noopener', text: 'MET' }),
      ' · Skred: ',
      el('a', { href: 'https://varsom.no/', target: '_blank', rel: 'noopener', text: 'Varsom' }),
    ]),
  ];
}

