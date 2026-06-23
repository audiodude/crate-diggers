// Pack src/ into crate-diggers.xdc (a zip whose root is the app — index.html at
// the top level). Verifies the two files a WebXDC host requires before writing.
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';
import AdmZip from 'adm-zip';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'crate-diggers.xdc');

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

if (!existsSync(join(SRC, 'index.html'))) throw new Error('src/index.html missing');
if (!existsSync(join(SRC, 'manifest.toml'))) throw new Error('src/manifest.toml missing');
if (!existsSync(join(SRC, 'albums.js'))) {
  console.warn('WARNING: src/albums.js missing — run `npm run build` first.');
}

// albums.json is a build-time artifact (carries the _ok resume marker); the
// runtime only reads albums.js. Keep it out of the shipped app.
const SKIP = new Set(['albums.json']);

const zip = new AdmZip();
let count = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split(sep).join('/');
  if (SKIP.has(rel)) continue;
  zip.addLocalFile(file, dirname(rel) === '.' ? '' : dirname(rel));
  count += 1;
}
zip.writeZip(OUT);

const mb = (statSync(OUT).size / 1e6).toFixed(2);
console.log(`Wrote ${OUT}  (${count} files, ${mb} MB)`);
