/**
 * Tegner appikonene som PNG.
 *
 * SVG-en holder for nettleseren, men hjemskjermen på iPhone vil ha PNG, og et
 * byggesteg bare for å rasterisere ett ikon er ikke verdt det. Derfor tegnes
 * den samme figuren her med rein matematikk og skrives ut med zlib.
 *
 *   node scripts/ikoner.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HER = dirname(fileURLToPath(import.meta.url));
const UT = join(HER, '..', 'public', 'ikoner');
const S = 512; // figuren er tegnet i et 512-rutenett
const PRØVER = 3; // punktprøver per piksel per akse

const farge = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const iRundRekt = (x, y, rx, ry, b, h, r) => {
  const cx = Math.max(rx + r, Math.min(x, rx + b - r));
  const cy = Math.max(ry + r, Math.min(y, ry + h - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    || (x >= rx && x <= rx + b && y >= ry + r && y <= ry + h - r)
    || (y >= ry && y <= ry + h && x >= rx + r && x <= rx + b - r);
};
const iSirkel = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Figuren, punkt for punkt. Returnerer farge eller null. */
function figur(x, y) {
  if (iSirkel(x, y, 216, 300, 22)) return farge('#e08a6a');
  if (iSirkel(x, y, 284, 268, 18)) return farge('#e0a83c');
  if (iSirkel(x, y, 300, 336, 24)) return farge('#cf9a4e');
  if (iSirkel(x, y, 228, 364, 16)) return farge('#e08a6a');

  // Glasset: ytre form minus den samme formen krympet med strekbredden.
  const ute = iRundRekt(x, y, 144, 152, 224, 264, 44);
  const inne = iRundRekt(x, y, 164, 172, 184, 224, 30);
  if (ute && !inne) return farge('#f2e9e0');

  if (iRundRekt(x, y, 176, 96, 160, 40, 14)) return farge('#e0a83c');
  if (iRundRekt(x, y, 0, 0, S, S, 112)) return farge('#17130f');
  return null;
}

function tegn(størrelse) {
  const skala = S / størrelse;
  const rader = [];
  for (let py = 0; py < størrelse; py += 1) {
    const rad = Buffer.alloc(1 + størrelse * 4);
    for (let px = 0; px < størrelse; px += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < PRØVER; sy += 1) {
        for (let sx = 0; sx < PRØVER; sx += 1) {
          const x = (px + (sx + 0.5) / PRØVER) * skala;
          const y = (py + (sy + 0.5) / PRØVER) * skala;
          const f = figur(x, y);
          if (f) { r += f[0]; g += f[1]; b += f[2]; a += 255; }
        }
      }
      const n = PRØVER * PRØVER;
      const dekning = a / n / 255;
      const i = 1 + px * 4;
      // Delvis dekkede piksler får gjennomsnittsfargen av de prøvene som traff.
      rad[i] = dekning ? Math.round(r / (a / 255)) : 0;
      rad[i + 1] = dekning ? Math.round(g / (a / 255)) : 0;
      rad[i + 2] = dekning ? Math.round(b / (a / 255)) : 0;
      rad[i + 3] = Math.round(dekning * 255);
    }
    rader.push(rad);
  }
  return Buffer.concat(rader);
}

const crcTabell = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTabell[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function bolk(type, data) {
  const lengde = Buffer.alloc(4);
  lengde.writeUInt32BE(data.length);
  const kropp = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const sjekk = Buffer.alloc(4);
  sjekk.writeUInt32BE(crc(kropp));
  return Buffer.concat([lengde, kropp, sjekk]);
}

function png(størrelse) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(størrelse, 0);
  ihdr.writeUInt32BE(størrelse, 4);
  ihdr[8] = 8;   // bit per kanal
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bolk('IHDR', ihdr),
    bolk('IDAT', deflateSync(tegn(størrelse), { level: 9 })),
    bolk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(UT, { recursive: true });
for (const størrelse of [180, 192, 512]) {
  const fil = join(UT, `ikon-${størrelse}.png`);
  writeFileSync(fil, png(størrelse));
  console.log('skrev', fil);
}
