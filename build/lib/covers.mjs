// Cover download + resize. Adapted from best-albums-headless-astro covers.mjs.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';

const UA = 'CrateDiggersBot/0.1 (audiodude@gmail.com)';

// Fetch a remote image into a Buffer.
export async function downloadImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Cover HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Cover Art Archive fallback by MusicBrainz release-group MBID.
export function caaUrl(mbid, size = 500) {
  return `https://coverartarchive.org/release-group/${mbid}/front-${size}`;
}

// Resize a cover Buffer to a square JPEG and write it to outPath.
export async function resizeCover(buffer, outPath, size = 256) {
  await mkdir(dirname(outPath), { recursive: true });
  await sharp(buffer)
    .resize(size, size, { fit: 'cover' })
    .jpeg({ quality: 82 })
    .toFile(outPath);
  return outPath;
}

// A flat-color placeholder cover so a fetch miss never breaks the deck.
export async function placeholderCover(outPath, label, size = 256) {
  await mkdir(dirname(outPath), { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="#2b2b3a"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 3}" fill="#1a1a24"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 14}" fill="#444"/>
    <text x="50%" y="92%" fill="#888" font-family="sans-serif" font-size="16"
      text-anchor="middle">${label}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile(outPath);
  return outPath;
}
