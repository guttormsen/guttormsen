/**
 * GPX inn og ut.
 *
 * Lesing gjøres med en målrettet skanner framfor en full XML-parser: GPX-punkter
 * (`trkpt`, `rtept`, `wpt`) er flate elementer uten nøsting, og da holder det –
 * samtidig som modulen kan kjøres og testes utenfor nettleseren.
 */

const POINT_RE = /<(trkpt|rtept|wpt)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1\s*>)/gi;
const ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;
const NAME_RE = /<name[^>]*>([\s\S]*?)<\/name>/i;

function attributes(source) {
  const out = {};
  let match;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(source))) out[match[1].toLowerCase()] = match[2];
  return out;
}

function childText(body, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(body ?? '');
  return match ? decode(match[1].trim()) : null;
}

function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function encode(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Leser en GPX-fil.
 * @param {string} xml
 * @returns {{name: string|null, track: Array<{lat:number,lon:number,ele:number|null}>,
 *            waypoints: Array<{lat:number,lon:number,name:string|null}>}}
 */
export function parseGpx(xml) {
  if (typeof xml !== 'string' || !/<gpx[\s>]/i.test(xml)) {
    throw new Error('Filen ser ikke ut til å være en GPX-fil.');
  }

  const track = [];
  const waypoints = [];
  let match;
  POINT_RE.lastIndex = 0;

  while ((match = POINT_RE.exec(xml))) {
    const tag = match[1].toLowerCase();
    const attrs = attributes(match[2]);
    const body = match[4] ?? '';
    const lat = Number(attrs.lat);
    const lon = Number(attrs.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (tag === 'wpt') {
      waypoints.push({ lat, lon, name: childText(body, 'name') });
    } else {
      // Number(null) er 0 – en manglende høyde må ikke bli til havnivå.
      const raw = childText(body, 'ele');
      const ele = raw == null || raw === '' ? Number.NaN : Number(raw);
      track.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
    }
  }

  if (!track.length && !waypoints.length) {
    throw new Error('Fant ingen punkter i GPX-filen.');
  }

  const nameMatch = NAME_RE.exec(xml);
  return { name: nameMatch ? decode(nameMatch[1].trim()) : null, track, waypoints };
}

/**
 * Skriver en GPX-fil med ett spor og eventuelle veipunkter.
 *
 * @param {object} trip
 * @param {string} trip.name
 * @param {Array<{lat:number,lon:number}>} trip.line
 * @param {Array<number|null>} [trip.elevations]
 * @param {Array<{lat:number,lon:number,name?:string}>} [trip.waypoints]
 */
export function buildGpx({ name = 'Tur', line = [], elevations = [], waypoints = [] }) {
  const fixed = (value) => value.toFixed(6);
  const points = line
    .map((point, i) => {
      const ele = elevations[i];
      const eleTag = Number.isFinite(ele) ? `<ele>${ele.toFixed(1)}</ele>` : '';
      return `      <trkpt lat="${fixed(point.lat)}" lon="${fixed(point.lon)}">${eleTag}</trkpt>`;
    })
    .join('\n');

  const marks = waypoints
    .map(
      (point, i) =>
        `  <wpt lat="${fixed(point.lat)}" lon="${fixed(point.lon)}">\n` +
        `    <name>${encode(point.name ?? `Punkt ${i + 1}`)}</name>\n  </wpt>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lykkelig tur" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${encode(name)}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
${marks}${marks ? '\n' : ''}  <trk>
    <name>${encode(name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Filnavn uten tegn som gir trøbbel på tvers av operativsystemer. */
export function safeFilename(name, extension = 'gpx') {
  const base =
    String(name ?? '')
      .trim()
      .replace(/[^\p{L}\p{N}\s._-]/gu, '')
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'tur';
  return `${base}.${extension}`;
}
