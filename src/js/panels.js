/**
 * Innholdet i panelet. Hver funksjon tar data inn og gir DOM-noder ut,
 * uten å røre global tilstand – da er de lette å flytte på og resonnere om.
 */
import { BASEMAPS, PACE, TERRAIN, TRAIL_WMS } from './config.js';
import { DANGER_LEVELS } from './api/varsom.js';
import { POI_KINDS } from './api/overpass.js';
import { describeSymbol, describeWind } from './api/met.js';
import { closestPointOnPath, compassPoint } from './geo.js';
import { arrivalTime, formatPosition, headingAhead, nextAhead } from './navigate.js';
import { describeMode, directionsUrl } from './api/entur.js';
import { MAX_TILES } from './offline.js';
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

/* ---------- Forhåndsvisning i kartet ---------- */

/**
 * Kortet som legger seg over kartet når man trykker på en sti.
 *
 * Poenget er at man skal kunne se på en tur uten at panelet spretter opp og
 * dekker kartet man nettopp trykket i.
 */
export function renderPreview(trip, handlers) {
  if (!trip) return [];
  const facts = [
    formatDistance(trip.length),
    trip.ascent != null ? `${formatElevation(trip.ascent)} opp` : null,
    trip.seconds != null ? formatDuration(trip.seconds) : null,
  ].filter(Boolean);

  const { shown } = topFeatures(trip.features ?? [], 3);

  return [
    el('div', { class: 'preview__head' }, [
      el('strong', { class: 'preview__name', text: trip.name }),
      el('button', {
        class: 'icon-btn icon-btn--tiny',
        type: 'button',
        title: 'Lukk',
        html: '<span aria-hidden="true">✕</span>',
        onclick: handlers.onClosePreview,
      }),
    ]),
    el('div', { class: 'preview__facts' }, [
      el('span', { class: 'card__grade', style: `--dot:${trip.grade.color}`, text: trip.grade.label }),
      el('strong', { text: facts.join(' · ') }),
      trip.ascent == null && el('span', { class: 'card__pending', text: 'henter høyder …' }),
    ]),
    shown.length > 0 &&
      el('div', { class: 'card__tags' },
        shown.map((id) =>
          el('span', {
            class: `tag tag--feature${id === 'hc' ? ' tag--hc' : ''}`,
            text: `${FEATURES[id].icon} ${FEATURES[id].label}`,
          }),
        ),
      ),
    el('button', {
      class: 'btn btn--primary preview__pick',
      type: 'button',
      text: 'Velg denne turen',
      onclick: () => handlers.onPickTrip(trip),
    }),
  ];
}

/* ---------- Turmodus ---------- */

/**
 * Den smale linja som vises mens du går. Den ligger øverst i arket, slik at
 * tallene er lesbare også når panelet er skjøvet ned.
 */
export function renderNavBar(navigation, summary, handlers) {
  const { progress } = navigation;
  const heading = progress ? headingAhead(summary, progress.index, navigation.position) : null;
  if (!progress) {
    return [el('p', { class: 'navbar__waiting', text: 'Venter på posisjon …' })];
  }

  if (progress.finished) {
    return [
      el('div', { class: 'navbar__done' }, [
        el('strong', { text: '🎉 Du er fremme!' }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'Avslutt og før i dagboka', onclick: handlers.onFinish }),
      ]),
    ];
  }

  return [
    el('div', { class: 'navbar__numbers' }, [
      el('div', { class: 'navbar__stat' }, [
        el('span', { class: 'navbar__value', text: formatDistance(progress.distanceLeft) }),
        el('span', { class: 'navbar__label', text: 'igjen' }),
      ]),
      el('div', { class: 'navbar__stat' }, [
        el('span', { class: 'navbar__value', text: formatDuration(progress.secondsLeft) }),
        el('span', { class: 'navbar__label', text: 'å gå' }),
      ]),
      el('div', { class: 'navbar__stat' }, [
        el('span', { class: 'navbar__value', text: formatClock(arrivalTime(progress.secondsLeft)) }),
        el('span', { class: 'navbar__label', text: 'fremme' }),
      ]),
      el('div', { class: 'navbar__stat' }, [
        el('span', { class: 'navbar__value', text: formatElevation(progress.ascentLeft) }),
        el('span', { class: 'navbar__label', text: 'opp igjen' }),
      ]),
    ]),
    el('span', {
      class: 'bar bar--nav',
      role: 'progressbar',
      'aria-valuenow': Math.round(progress.fraction * 100),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-label': 'Hvor langt du har kommet',
    }, [el('span', { class: 'bar__fill', style: `width:${Math.round(progress.fraction * 100)}%` })]),
    el('div', { class: 'navbar__row' }, [
      progress.offRoute
        ? el('span', {
            class: 'navbar__warn',
            text: `⚠ ${formatDistance(progress.offRouteDistance)} fra ruta`,
          })
        : el('span', {
            class: 'navbar__ok',
            text: heading
              ? `Følg ruta mot ${heading.compass} · ${Math.round(progress.fraction * 100)} % gått`
              : `På ruta · ${Math.round(progress.fraction * 100)} % gått`,
          }),
      el('button', {
        class: `pill pill--tiny${navigation.follow ? ' is-on' : ''}`,
        type: 'button',
        text: navigation.follow ? '◎ Følger deg' : '◎ Følg meg',
        onclick: handlers.onToggleFollow,
      }),
      el('button', { class: 'pill pill--tiny', type: 'button', text: 'Avslutt', onclick: handlers.onFinish }),
    ]),
  ];
}

/** Detaljene man vil ha når man stopper og tar opp telefonen. */
function navDetails(navigation, pois) {
  const { progress, position } = navigation;
  if (!progress) return null;

  const ahead = nextAhead(pois, progress.distanceDone);
  const where = formatPosition(position);

  return section('Underveis', [
    ahead &&
      el('p', { class: 'next-up' }, [
        el('span', { 'aria-hidden': 'true', text: `${POI_KINDS[ahead.kind].icon} ` }),
        el('strong', { text: ahead.name }),
        el('span', { text: ` om ${formatDistance(ahead.along - progress.distanceDone)}` }),
      ]),
    where &&
      el('div', { class: 'position' }, [
        el('span', { class: 'field__label', text: 'Posisjonen din' }),
        el('output', { id: 'live-position', class: 'position__value', text: where.text }),
        el('span', {
          id: 'live-accuracy',
          class: 'hint',
          text: where.accuracy != null ? `Nøyaktighet ±${where.accuracy} m` : '',
        }),
        el('p', { class: 'hint', text: 'Les disse tallene opp hvis du må ringe 113.' }),
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Kopier posisjon',
          onclick: () => handlersRef.onCopyPosition?.(where),
        }),
      ]),
  ]);
}

/** Settes av `renderTrip` så småknapper inne i seksjonene når fram. */
let handlersRef = {};

/* ---------- Finn tur ---------- */

const gradeFilters = [
  { id: 'enkel', ...GRADES.G },
  { id: 'middels', ...GRADES.B },
  { id: 'krevende', ...GRADES.R },
  { id: 'ekspert', ...GRADES.S },
];

/**
 * De påslåtte filtrene som brikker man kan trykke av. Vises når filterlista er
 * slått sammen, så det aldri er skjult hvorfor lista er kort.
 */
function activeFilterChips(filters, handlers) {
  const chips = [];
  const off = (label, icon, onClick) =>
    chips.push(
      el('button', { class: 'chip chip--toggle is-on', type: 'button', title: `Skru av ${label}`, onclick: onClick }, [
        icon && el('span', { 'aria-hidden': 'true', text: `${icon} ` }),
        label,
        el('span', { 'aria-hidden': 'true', class: 'chip__x', text: '✕' }),
      ]),
    );

  for (const id of filters.lengths) {
    const bucket = LENGTH_BUCKETS.find((b) => b.id === id);
    if (bucket) off(bucket.label, bucket.icon, () => handlers.onToggleLength(id));
  }
  if (filters.maxMinutes != null) off('Under 1 time', '⏱️', () => handlers.onQuickTime(filters.maxMinutes));
  for (const id of filters.features) {
    off(FEATURES[id].label, FEATURES[id].icon, () => handlers.onToggleFeature(id));
  }
  for (const id of filters.grades) {
    const grade = gradeFilters.find((g) => g.id === id);
    if (grade) off(grade.label, null, () => handlers.onToggleGrade(id));
  }
  if (filters.shape) off('Rundtur', '🔄', () => handlers.onShape(filters.shape));
  if (filters.markedOnly) off('Merket', '🚩', handlers.onToggleMarked);
  if (filters.special) {
    const type = Object.values(SPECIAL_TYPES).find((t) => t.id === filters.special);
    if (type) off(type.label, type.icon, () => handlers.onSpecial(type.id));
  }
  return chips;
}

export function renderDiscover(discovery, filters, filtersOpen, handlers) {
  const nodes = [];
  const activeCount =
    filters.lengths.length +
    filters.grades.length +
    filters.features.length +
    (filters.shape ? 1 : 0) +
    (filters.special ? 1 : 0) +
    (filters.markedOnly ? 1 : 0) +
    (filters.maxMinutes != null ? 1 : 0);

  /* Én kompakt rad øverst; filtrene tar ikke plass før man vil ha dem. */
  nodes.push(
    el('div', { class: 'result-bar' }, [
      el('span', { class: 'result-bar__count' }, [
        discovery.loading
          ? 'Leter etter turer …'
          : discovery.searched && discovery.total
            ? `${discovery.visible.length} av ${discovery.total} turer`
            : '',
      ]),
      el('button', {
        class: `chip chip--toggle${activeCount ? ' is-on' : ''}`,
        type: 'button',
        'aria-expanded': String(filtersOpen),
        onclick: handlers.onToggleFilters,
      }, [`⚙ Filtre${activeCount ? ` (${activeCount})` : ''}`]),
      discovery.visible.length > 1 &&
        el('button', {
          class: 'chip chip--toggle',
          type: 'button',
          title: 'Plukk en tilfeldig tur',
          text: '🎲',
          'aria-label': 'Overrask meg med en tilfeldig tur',
          onclick: handlers.onSurprise,
        }),
    ]),
  );

  if (filtersOpen) {
    /* Én gruppe per spørsmål, med overskrift. Brikkene brytes over flere
     * linjer i stedet for å rulle sidelengs – to tredeler av valgene lå før
     * utenfor skjermen, i rader man måtte gjette at kunne dras. */
    const group = (title, chips) =>
      el('div', { class: 'filter-group' }, [
        el('h3', { class: 'filter-group__title', text: title }),
        el('div', { class: 'chips', role: 'group', 'aria-label': title }, chips),
      ]);

    nodes.push(
      el('div', { class: 'filters', id: 'filters' }, [
        group(
          'Hvor lang tur?',
          LENGTH_BUCKETS.map((bucket) =>
            chip(bucket.label, filters.lengths.includes(bucket.id), () => handlers.onToggleLength(bucket.id), {
              icon: bucket.icon,
              title: bucket.hint,
            }),
          ),
        ),
        group('Hva vil du ha med?', [
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
        group(
          'Hvor krevende?',
          gradeFilters.map((grade) =>
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
        ),
        group('Hva slags tur?', [
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
        el('div', { class: 'filters__foot' }, [
          el('button', {
            class: 'btn btn--primary',
            type: 'button',
            text: discovery.searched ? `Vis ${discovery.visible.length} turer` : 'Ferdig',
            onclick: handlers.onToggleFilters,
          }),
          hasActiveFilters(filters) &&
            el('button', {
              class: 'btn',
              type: 'button',
              text: 'Nullstill',
              onclick: handlers.onResetFilters,
            }),
        ]),
      ]),
    );
  } else if (activeCount) {
    /* Slått sammen skal man fortsatt se hva som er på – og kunne skru det av
     * uten å åpne filtrene igjen. */
    nodes.push(
      el('div', { class: 'chips chips--active', role: 'group', 'aria-label': 'Aktive filtre' }, [
        ...activeFilterChips(filters, handlers),
        el('button', {
          class: 'chip chip--toggle chip--clear',
          type: 'button',
          text: '✕ Nullstill',
          onclick: handlers.onResetFilters,
        }),
      ]),
    );
  }

  /* Tilstander */
  if (discovery.loading) {
    nodes.push(
      el('p', { class: 'hint', text: 'Leter i den nasjonale rutebasen. Det tar gjerne ti sekunder første gang – etterpå ligger området i minnet.' }),
      el('div', { class: 'skeletons' }, Array.from({ length: 3 }, () => el('div', { class: 'skeleton' }))),
    );
    return nodes;
  }

  if (!discovery.searched) {
    nodes.push(
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__big', text: '🧭' }),
        el('p', { class: 'empty__title', text: 'Hvor skal vi i dag?' }),
        el('p', { text: 'Jeg finner de merkede turene som allerede finnes der du er – eller hvor som helst du flytter kartet.' }),
        el('button', { class: 'btn btn--primary', type: 'button', text: '📍 Finn turer nær meg', onclick: handlers.onNearMe }),
        el('button', { class: 'btn', type: 'button', text: 'Se i dette kartutsnittet', onclick: handlers.onSearchHere }),
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
  const {
    trip, summary, startTime, weather, sun, avalanche, pois, poiError, photos, article,
    loading, checklist, navigation, journeys, offline,
  } = context;
  handlersRef = handlers;

  if (!summary) {
    return [
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__big', text: '🥾' }),
        el('p', { class: 'empty__title', text: 'Ingen tur valgt' }),
        el('p', { text: 'Velg en av de merkede turene, så får du høydeprofil, vær langs ruta, bilder og veien til startpunktet her.' }),
        el('button', { class: 'btn btn--primary', type: 'button', text: '🧭 Finn en tur', onclick: handlers.onGoDiscover }),
        el('p', { class: 'hint', text: 'Vil du heller lage din egen? Bruk blyanten i kartet og trykk der du vil gå.' }),
        el('button', { class: 'btn', type: 'button', text: '✏️ Tegn din egen rute', onclick: handlers.onDrawOwn }),
      ]),
    ];
  }

  /*
   * Rekkefølgen følger spørsmålene man stiller seg: Hvordan ser det ut? Hvordan
   * kommer jeg meg dit? Hva finnes underveis? Hvordan blir været? Er det trygt?
   * Først deretter innstillinger og finjustering.
   */
  return [
    navigation.active ? navDetails(navigation, pois) : null,
    gallerySection(photos, loading.photos),
    gettingThereSection(summary, journeys, loading.journeys, handlers),
    featureSection(featuresAlongRoute(pois)),
    poiSection(pois, poiError, loading.pois, handlers),
    articleSection(article),
    weatherSection(weather, sun, loading.weather, startTime),
    safetySection(summary, sun, avalanche, startTime, checklist, handlers),
    offlineSection(summary, offline, handlers),
    quickSettings(trip, startTime, handlers),
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

/**
 * Hvordan komme seg til startpunktet. Uten bil er dette ofte det som avgjør
 * om turen blir noe av.
 */
function gettingThereSection(summary, journeys, loading, handlers) {
  const start = summary.line[0];
  const body = [];

  if (loading) {
    body.push(el('p', { class: 'hint', text: 'Ser etter kollektivforbindelser …' }));
  } else if (journeys?.length) {
    body.push(
      el('ul', { class: 'journeys' },
        journeys.slice(0, 3).map((journey) =>
          el('li', { class: 'journey' }, [
            el('span', { class: 'journey__when' }, [
              el('strong', { text: formatClock(journey.start) }),
              el('span', { text: `${Math.round(journey.duration / 60)} min` }),
            ]),
            el('span', { class: 'journey__legs' },
              journey.legs.map((leg) =>
                el('span', {
                  class: `leg leg--${leg.mode}`,
                  title: [describeMode(leg.mode).label, leg.lineName, leg.from].filter(Boolean).join(' · '),
                  text: `${describeMode(leg.mode).icon}${leg.line ? ` ${leg.line}` : ''}`,
                }),
              ),
            ),
            el('span', { class: 'journey__walk', text: `${formatDistance(journey.walkDistance)} gange` }),
          ]),
        ),
      ),
      el('p', { class: 'hint' }, [
        'Rutedata fra ',
        el('a', { href: 'https://entur.no/', target: '_blank', rel: 'noopener', text: 'Entur' }),
        '. Sjekk avgangen før du drar.',
      ]),
    );
  } else if (journeys) {
    body.push(el('p', { class: 'hint', text: 'Fant ingen kollektivforbindelse hit akkurat nå.' }));
  } else {
    body.push(
      el('p', { class: 'hint', text: 'Slå på posisjon, så finner jeg kollektivforbindelser til startpunktet.' }),
      el('button', { class: 'btn', type: 'button', text: '📍 Finn vei hit', onclick: handlers.onFindWayThere }),
    );
  }

  body.push(
    el('a', {
      class: 'btn btn--link',
      href: directionsUrl(start),
      target: '_blank',
      rel: 'noopener',
      text: '🚗 Veibeskrivelse til startpunktet',
    }),
  );

  // Uten bil er dette ofte det som avgjør om turen blir noe av. Derfor åpen.
  return section('Kom deg til start', body, { collapsible: true, open: true });
}

/**
 * Kartet med på tur.
 *
 * På fjellet er det ofte ikke dekning, og et kart som må lastes ned mens du
 * står der er ikke et kart. Her hentes flisene langs ruta ned på forhånd.
 */
function offlineSection(summary, offline, handlers) {
  const { status, done, total, tiles, savedMb, error } = offline;

  if (status === 'laster') {
    const andel = total ? Math.round((done / total) * 100) : 0;
    return section('Ta kartet med offline', [
      el('div', { class: 'progress' }, [
        el('div', { class: 'progress__bar', style: `--andel:${andel}%` }),
      ]),
      el('p', { class: 'hint', text: `${done} av ${total} kartruter · ${andel} %` }),
      el('button', { class: 'btn', type: 'button', text: 'Avbryt', onclick: handlers.onCancelOffline }),
    ]);
  }

  if (status === 'ferdig') {
    return section('Ta kartet med offline', [
      el('p', { class: 'ok-line', text: `✓ Kartet langs ruta ligger nå på telefonen${savedMb ? ` (${savedMb} MB)` : ''}. Det virker uten dekning.` }),
      el('button', { class: 'btn', type: 'button', text: '↻ Hent på nytt', onclick: handlers.onDownloadOffline }),
    ]);
  }

  if (status === 'feil') {
    return section('Ta kartet med offline', [
      el('p', { class: 'hint', text: error ?? 'Nedlastingen stoppet.' }),
      el('button', { class: 'btn', type: 'button', text: '↻ Prøv igjen', onclick: handlers.onDownloadOffline }),
    ]);
  }

  if (tiles > MAX_TILES) {
    return section('Ta kartet med offline', [
      el('p', { class: 'hint', text: `Denne ruta dekker et så stort område at kartet ville blitt ${tiles} ruter. Del turen opp, så går det.` }),
    ]);
  }

  return section('Ta kartet med offline', [
    el('p', { class: 'hint', text: `I fjellet er det ofte ikke dekning. Hent kartet langs ruta nå, så ligger det klart – omtrent ${Math.max(1, Math.round((tiles * 25) / 1024))} MB.` }),
    el('button', {
      class: 'btn btn--primary',
      type: 'button',
      text: '⬇ Last ned kartet for denne turen',
      onclick: handlers.onDownloadOffline,
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

function poiSection(pois, poiError, loading, handlers) {
  if (loading) {
    return section('Langs ruta', el('p', { class: 'hint', text: 'Ser etter hytter, topper og vann …' }), {
      collapsible: true,
      open: true,
    });
  }
  // Å si «her finnes ingenting» når vi ikke fikk spurt, er å lyve for folk
  // som skal ut i fjellet.
  if (poiError) {
    return section(
      'Langs ruta',
      [
        el('p', { class: 'hint', text: 'Fikk ikke kontakt med OpenStreetMap-tjenesten akkurat nå, så jeg vet ikke hva som ligger langs ruta. Den er en dugnad og er ofte travel.' }),
        el('button', { class: 'btn', type: 'button', text: '↻ Prøv igjen', onclick: handlers.onRetryPois }),
      ],
      { collapsible: true, open: true },
    );
  }
  if (!pois.length) {
    return section(
      'Langs ruta',
      el('p', { class: 'hint', text: 'Ingenting er kartlagt langs denne ruta i OpenStreetMap. Det betyr ikke at det ikke finnes noe – bare at ingen har lagt det inn ennå.' }),
      { collapsible: true, open: false },
    );
  }

  // `along` og `offRoute` settes når severdighetene hentes.
  const withDistance = [...pois].sort((a, b) => a.along - b.along);

  return section(
    'Langs ruta',
    el('ul', { class: 'pois' }, withDistance.map((poi) => poiRow(poi, handlers))),
    { collapsible: true, open: true, badge: String(withDistance.length) },
  );
}

/** Hva som er verdt å vite om et sted man passerer, og hvordan man kommer dit. */
function poiRow(poi, handlers) {
  const meta = [
    POI_KINDS[poi.kind].label,
    Number.isFinite(poi.elevation) ? `${formatElevation(poi.elevation)} moh.` : null,
    `${formatDistance(poi.along)} inn i turen`,
    // Ligger stedet et stykke unna, er det greit å vite før man går etter det.
    poi.offRoute > 40 ? `${formatDistance(poi.offRoute)} fra ruta` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /* Hytter er det man planlegger rundt: hvem som driver den, om den er åpen
   * og om den koster noe. Det står i OpenStreetMap når noen har lagt det inn. */
  const facts = [
    poi.dnt ? el('span', { class: 'tag tag--dnt', text: '🏔️ DNT' }) : null,
    poi.operator && !poi.dnt ? el('span', { class: 'tag', text: poi.operator }) : null,
    poi.fee === 'no' ? el('span', { class: 'tag', text: 'Gratis' }) : null,
    poi.fee === 'yes' ? el('span', { class: 'tag', text: 'Koster penger' }) : null,
    poi.opening ? el('span', { class: 'tag', text: `Åpent: ${poi.opening}` }) : null,
    poi.capacity ? el('span', { class: 'tag', text: `${poi.capacity} senger` }) : null,
    poi.drinkable === false ? el('span', { class: 'tag tag--warn', text: 'Ikke drikkevann' }) : null,
    poi.wheelchair
      ? el('span', {
          class: `access access--${poi.wheelchair}`,
          title: 'Rullestoltilgang slik OpenStreetMap oppgir den',
          text:
            poi.wheelchair === 'ja'
              ? '♿ Rullestolvennlig'
              : poi.wheelchair === 'delvis'
                ? '♿ Delvis tilgjengelig'
                : '♿ Ikke tilrettelagt',
        })
      : null,
  ].filter(Boolean);

  return el('li', { class: 'poi-row' }, [
    el('span', { class: 'poi-row__icon', 'aria-hidden': 'true', text: POI_KINDS[poi.kind].icon }),
    el('span', { class: 'poi-row__body' }, [
      el('button', {
        class: 'linkish poi-row__name',
        type: 'button',
        text: poi.name,
        title: 'Vis stedet i kartet',
        onclick: () => handlers.onFocusPoi(poi),
      }),
      el('span', { class: 'poi-row__meta', text: meta }),
      facts.length ? el('span', { class: 'poi-row__facts' }, facts) : null,
      el('span', { class: 'poi-row__links' }, [
        el('a', {
          class: 'linkish linkish--small',
          href: directionsUrl(poi),
          target: '_blank',
          rel: 'noopener',
          text: '🧭 Veibeskrivelse',
        }),
        poi.website &&
          el('a', {
            class: 'linkish linkish--small',
            href: poi.website,
            target: '_blank',
            rel: 'noopener',
            text: 'Nettside',
          }),
        !poi.website &&
          (poi.kind === 'hytte' || poi.kind === 'gapahuk') &&
          el('a', {
            class: 'linkish linkish--small',
            href: `https://ut.no/sok?query=${encodeURIComponent(poi.name)}`,
            target: '_blank',
            rel: 'noopener',
            text: 'Søk på ut.no',
          }),
      ]),
    ]),
  ]);
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
        el('p', { text: 'Når du har gått en tur, trykker du «Gikk den» nederst i turen. Da samler den seg opp her, med kilometer, høydemeter og merker.' }),
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
    /* Egen topp med lukkeknapp. Håndtaket alene er ikke nok – man skal se
     * hvordan man kommer ut igjen, ikke gjette. */
    el('div', { class: 'popover__head' }, [
      el('h2', { class: 'popover__heading', text: 'Kartlag' }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        title: 'Lukk kartlag',
        'aria-label': 'Lukk kartlag',
        html: '<span aria-hidden="true">✕</span>',
        onclick: handlers.onCloseLayers,
      }),
    ]),
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

/** Kildene, nederst i rullingen. */
export function renderCredits() {
  return [
    'Kart og høyder: ',
    el('a', { href: 'https://www.kartverket.no/', target: '_blank', rel: 'noopener', text: 'Kartverket' }),
    ' · Ruter: Turrutebasen og ',
    el('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: 'OpenStreetMap' }),
    ' · Vær: ',
    el('a', { href: 'https://www.met.no/', target: '_blank', rel: 'noopener', text: 'MET' }),
    ' · Skred: ',
    el('a', { href: 'https://varsom.no/', target: '_blank', rel: 'noopener', text: 'Varsom' }),
    ' · Kollektiv: ',
    el('a', { href: 'https://entur.no/', target: '_blank', rel: 'noopener', text: 'Entur' }),
    ' · Bilder: ',
    el('a', { href: 'https://commons.wikimedia.org/', target: '_blank', rel: 'noopener', text: 'Wikimedia Commons' }),
  ];
}

export function renderFooter(summary, navigation, handlers) {
  if (!summary) return [];
  return [
    el('div', { class: 'panel__buttons' }, [
      navigation.active
        ? el('button', { class: 'btn', type: 'button', text: '■ Avslutt', onclick: handlers.onFinish })
        : el('button', { class: 'btn btn--primary', type: 'button', text: '▶ Start turen', onclick: handlers.onStart }),
      el('button', { class: 'btn', type: 'button', text: '✓ Gikk den', onclick: handlers.onLogTrip }),
      el('button', { class: 'btn', type: 'button', text: 'Lagre', onclick: handlers.onSave }),
      el('button', { class: 'btn', type: 'button', text: 'Del', onclick: handlers.onShare }),
    ]),
  ];
}

