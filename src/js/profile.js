/**
 * Høydeprofil tegnet som SVG uten grafbibliotek.
 * Grafen er fokuserbar og kan styres med piltaster, og oppgir verdiene i tekst
 * for skjermlesere.
 */
import { clamp, formatDistance, formatDuration, formatElevation } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = { top: 14, right: 12, bottom: 22, left: 44 };

const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

/** Pene aksesteg: 1, 2, 5 × 10ⁿ. */
function niceStep(range, targetTicks) {
  const raw = range / Math.max(1, targetTicks);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export function createProfile(container, { onHover } = {}) {
  const svg = svgEl('svg', {
    class: 'profile__svg',
    preserveAspectRatio: 'none',
    role: 'img',
    tabindex: '0',
    'aria-label': 'Høydeprofil',
  });
  const tooltip = document.createElement('div');
  tooltip.className = 'profile__tip';
  tooltip.hidden = true;

  container.replaceChildren(svg, tooltip);

  let summary = null;
  let width = container.clientWidth || 600;
  let height = container.clientHeight || 160;
  let cursor = null;

  const observer = new ResizeObserver(() => {
    const next = container.clientWidth;
    if (next && Math.abs(next - width) > 1) {
      width = next;
      height = container.clientHeight || height;
      draw();
    }
  });
  observer.observe(container);

  const plot = () => ({
    x0: PAD.left,
    x1: width - PAD.right,
    y0: PAD.top,
    y1: height - PAD.bottom,
  });

  function scales() {
    const { x0, x1, y0, y1 } = plot();
    const maxDistance = summary.distance || 1;
    const values = summary.elevations.filter(Number.isFinite);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 100;
    // Litt luft over og under, og aldri under 60 m spenn – ellers blir småkuler til fjell.
    const span = Math.max(60, max - min);
    const lo = min - span * 0.12;
    const hi = max + span * 0.12;
    return {
      x: (distance) => x0 + ((x1 - x0) * distance) / maxDistance,
      y: (elevation) => y1 - ((y1 - y0) * (elevation - lo)) / (hi - lo),
      lo,
      hi,
      maxDistance,
    };
  }

  function draw() {
    svg.replaceChildren();
    if (!summary || !summary.hasElevation || summary.line.length < 2) {
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      return;
    }

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('aria-label', ariaSummary());
    const { x0, x1, y0, y1 } = plot();
    const s = scales();

    /* Rutenett og akser */
    const grid = svgEl('g', { class: 'profile__grid' });
    const yStep = niceStep(s.hi - s.lo, 4);
    for (let value = Math.ceil(s.lo / yStep) * yStep; value <= s.hi; value += yStep) {
      const y = s.y(value);
      grid.append(svgEl('line', { x1: x0, x2: x1, y1: y, y2: y }));
      const label = svgEl('text', { x: x0 - 8, y: y + 4, class: 'profile__label', 'text-anchor': 'end' });
      label.textContent = `${Math.round(value)}`;
      grid.append(label);
    }

    const xStep = niceStep(s.maxDistance, 5);
    for (let value = 0; value <= s.maxDistance + 1; value += xStep) {
      const x = s.x(value);
      grid.append(svgEl('line', { x1: x, x2: x, y1: y0, y2: y1, class: 'profile__gridv' }));
      const label = svgEl('text', { x, y: y1 + 15, class: 'profile__label', 'text-anchor': 'middle' });
      label.textContent = value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} km` : `${Math.round(value)} m`;
      grid.append(label);
    }
    svg.append(grid);

    /* Selve profilen, fargelagt etter stigning */
    const points = summary.line.map((_, i) => [s.x(summary.distances[i]), s.y(summary.elevations[i])]);
    const area = `M ${x0} ${y1} ` + points.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ` L ${x1} ${y1} Z`;
    svg.append(svgEl('path', { d: area, class: 'profile__area' }));

    for (let i = 1; i < points.length; i++) {
      const run = summary.distances[i] - summary.distances[i - 1];
      const rise = summary.elevations[i] - summary.elevations[i - 1];
      const slope = run > 0 ? rise / run : 0;
      svg.append(
        svgEl('line', {
          x1: points[i - 1][0],
          y1: points[i - 1][1],
          x2: points[i][0],
          y2: points[i][1],
          class: `profile__seg profile__seg--${slopeClass(slope)}`,
        }),
      );
    }

    if (cursor != null) drawCursor(s);
  }

  const slopeClass = (slope) => {
    if (slope > 0.25) return 'bratt-opp';
    if (slope > 0.08) return 'opp';
    if (slope < -0.25) return 'bratt-ned';
    if (slope < -0.08) return 'ned';
    return 'flat';
  };

  function drawCursor(s) {
    const { y0, y1 } = plot();
    const index = cursor;
    const x = s.x(summary.distances[index]);
    const y = s.y(summary.elevations[index]);
    svg.append(svgEl('line', { x1: x, x2: x, y1: y0, y2: y1, class: 'profile__cursor' }));
    svg.append(svgEl('circle', { cx: x, cy: y, r: 4.5, class: 'profile__dot' }));
  }

  function ariaSummary() {
    return (
      `Høydeprofil: ${formatDistance(summary.distance)}, ` +
      `${formatElevation(summary.ascent)} stigning og ${formatElevation(summary.descent)} fall. ` +
      `Laveste punkt ${formatElevation(summary.minElevation)}, høyeste ${formatElevation(summary.maxElevation)}.`
    );
  }

  /** Nærmeste punktindeks til en x-koordinat i piksler. */
  function indexAtX(px) {
    const s = scales();
    const { x0, x1 } = plot();
    const ratio = clamp((px - x0) / (x1 - x0), 0, 1);
    const target = ratio * s.maxDistance;
    let lo = 0;
    let hi = summary.distances.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (summary.distances[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(summary.distances[lo - 1] - target) < Math.abs(summary.distances[lo] - target)) {
      return lo - 1;
    }
    return lo;
  }

  function setCursor(index) {
    if (!summary) return;
    cursor = index == null ? null : clamp(index, 0, summary.line.length - 1);
    draw();
    if (cursor == null) {
      tooltip.hidden = true;
      onHover?.(null);
      return;
    }
    const s = scales();
    const point = summary.line[cursor];
    const seconds = summary.time.cumulativeSeconds[cursor];
    tooltip.hidden = false;
    tooltip.innerHTML =
      `<strong>${formatElevation(summary.elevations[cursor])}</strong> moh.` +
      `<span>${formatDistance(summary.distances[cursor])} inn i turen</span>` +
      `<span>ca. ${formatDuration(seconds)} gått</span>`;
    const x = s.x(summary.distances[cursor]);
    tooltip.style.left = `${clamp(x, 60, width - 60)}px`;
    onHover?.({ ...point, index: cursor });
  }

  /* Peker og tastatur */
  const pointerMove = (event) => {
    if (!summary?.hasElevation) return;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    setCursor(indexAtX(px));
  };
  svg.addEventListener('pointermove', pointerMove);
  svg.addEventListener('pointerdown', pointerMove);
  svg.addEventListener('pointerleave', () => setCursor(null));
  svg.addEventListener('blur', () => setCursor(null));
  svg.addEventListener('keydown', (event) => {
    if (!summary?.hasElevation) return;
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowRight') setCursor((cursor ?? -1) + step);
    else if (event.key === 'ArrowLeft') setCursor((cursor ?? summary.line.length) - step);
    else if (event.key === 'Home') setCursor(0);
    else if (event.key === 'End') setCursor(summary.line.length - 1);
    else if (event.key === 'Escape') setCursor(null);
    else return;
    event.preventDefault();
  });

  return {
    update(next) {
      summary = next;
      cursor = null;
      tooltip.hidden = true;
      draw();
    },
    destroy() {
      observer.disconnect();
    },
  };
}
