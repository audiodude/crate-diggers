// One-off: generate src/icon.png — a crate/vinyl mark. Run via `npm run icon`.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const S = 256;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f0a500"/><stop offset="1" stop-color="#e8552d"/>
  </linearGradient></defs>
  <rect width="${S}" height="${S}" rx="48" fill="#14141c"/>
  <circle cx="128" cy="128" r="78" fill="#0c0c12" stroke="url(#g)" stroke-width="6"/>
  <circle cx="128" cy="128" r="52" fill="none" stroke="#2c2c3b" stroke-width="2"/>
  <circle cx="128" cy="128" r="34" fill="none" stroke="#2c2c3b" stroke-width="2"/>
  <circle cx="128" cy="128" r="14" fill="url(#g)"/>
  <circle cx="128" cy="128" r="4" fill="#14141c"/>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(join(SRC, 'icon.png'));
console.log('Wrote src/icon.png');
