// Generate gallery.html — a visual contact sheet of the whole deck, grouped by
// year with genre color-coding. A dev/browse tool, NOT part of the game: it
// lives at the project root and points at src/img/, so it's never packed into
// the .xdc. Run with `npm run gallery` (after `npm run build`).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GENRES = { rock: '#e8552d', pop: '#f0a500', hiphop: '#34c777', gem: '#8a7dff' };
const ORDER = { rock: 0, pop: 1, hiphop: 2, gem: 3 };
const LABEL = { rock: 'Rock', pop: 'Pop', hiphop: 'Hip-Hop', gem: 'Gem' };
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const albums = JSON.parse(await readFile(join(ROOT, 'src', 'albums.json'), 'utf8'));
albums.sort((a, b) => a.year - b.year || ORDER[a.genre] - ORDER[b.genre]);

// Group into year rows.
const byYear = new Map();
for (const a of albums) {
  if (!byYear.has(a.year)) byYear.set(a.year, []);
  byYear.get(a.year).push(a);
}

const card = (a) => `
  <a class="card" href="${esc(a.links?.apple || '#')}" target="_blank" rel="noreferrer noopener" title="${esc(a.artist)} — ${esc(a.title)}">
    <img src="src/${esc(a.img)}" alt="${esc(a.title)}" loading="lazy" />
    <span class="badge" style="background:${GENRES[a.genre]}">${LABEL[a.genre]}</span>
    <span class="info"><b>${esc(a.title)}</b><i>${esc(a.artist)}</i></span>
  </a>`;

const rows = [...byYear.entries()]
  .map(
    ([year, list]) => `
  <section class="year">
    <h2>${year}</h2>
    <div class="row">${list.map(card).join('')}</div>
  </section>`,
  )
  .join('');

const legend = Object.entries(GENRES)
  .map(([g, c]) => `<span class="leg"><i style="background:${c}"></i>${LABEL[g]}</span>`)
  .join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Crate Diggers — The Deck (${albums.length} albums)</title>
<style>
  :root { --bg:#14141c; --card:#1f1f2b; --ink:#f3f1ea; --muted:#9b9aaa; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  header { padding:24px 20px 8px; text-align:center; }
  h1 { margin:0; font-size:30px; font-weight:800;
    background:linear-gradient(90deg,#f0a500,#e8552d);
    -webkit-background-clip:text; background-clip:text; color:transparent; }
  .sub { color:var(--muted); margin:6px 0 14px; }
  .legend { display:flex; gap:16px; justify-content:center; flex-wrap:wrap; margin-bottom:8px; }
  .leg { color:var(--muted); font-size:13px; display:flex; align-items:center; gap:6px; }
  .leg i { width:12px; height:12px; border-radius:3px; display:inline-block; }
  main { max-width:1100px; margin:0 auto; padding:8px 16px 56px; }
  .year { margin-top:18px; }
  .year h2 { font-size:14px; color:var(--muted); border-bottom:1px solid #2c2c3b;
    padding-bottom:6px; margin:0 0 12px; position:sticky; top:0; background:var(--bg); }
  .row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  @media (max-width:680px){ .row { grid-template-columns:repeat(2,1fr); } }
  .card { position:relative; background:var(--card); border-radius:12px; overflow:hidden;
    text-decoration:none; color:inherit; display:flex; flex-direction:column;
    border:1px solid transparent; transition:border-color .15s, transform .15s; }
  .card:hover { border-color:#f0a500; transform:translateY(-2px); }
  .card img { width:100%; aspect-ratio:1; object-fit:cover; display:block; }
  .badge { position:absolute; top:8px; left:8px; color:#fff; font-size:10px; font-weight:800;
    padding:3px 7px; border-radius:999px; text-transform:uppercase; letter-spacing:.3px; }
  .info { padding:9px 10px; display:flex; flex-direction:column; gap:2px; }
  .info b { font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .info i { color:var(--muted); font-style:normal; font-size:12px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
</style>
</head>
<body>
<header>
  <h1>Crate Diggers</h1>
  <p class="sub">The deck — ${albums.length} albums, ${byYear.size} years. Tap a cover to open it in Apple Music.</p>
  <div class="legend">${legend}</div>
</header>
<main>${rows}
</main>
</body>
</html>
`;

await writeFile(join(ROOT, 'gallery.html'), html);
console.log(`Wrote gallery.html (${albums.length} albums, ${byYear.size} years).`);
