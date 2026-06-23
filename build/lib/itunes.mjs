// iTunes Search API helpers (no API key). Primary source for artwork + Apple
// Music link + Apple id. https://performance-partners.apple.com/search-api

const UA = 'CrateDiggersBot/0.1 (audiodude@gmail.com)';

const q = (s) => encodeURIComponent(s);

// Build the three external "listen" links for an album. Pure: no I/O.
// `ids` may carry { spotifyId, appleUrl } discovered during the build; any
// missing id falls back to a search URL so all three links always resolve.
export function buildLinks(row, ids = {}) {
  const term = `${row.artist} ${row.title}`;
  const spotify = ids.spotifyId
    ? `https://open.spotify.com/album/${ids.spotifyId}`
    : `https://open.spotify.com/search/${q(term)}`;
  const apple = ids.appleUrl
    ? ids.appleUrl
    : `https://music.apple.com/us/search?term=${q(term)}`;
  const youtube = `https://music.youtube.com/search?q=${q(term)}`;
  return { spotify, apple, youtube };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One iTunes request with backoff on rate-limit (429/403) responses.
async function itunesGet(term) {
  const url = `https://itunes.apple.com/search?term=${q(term)}&entity=album&limit=1`;
  let res;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) break;
    if (res.status === 429 || res.status === 403) {
      await sleep(4000 * (attempt + 1)); // 4s, 8s, 12s, 16s, 20s
      continue;
    }
    throw new Error(`iTunes HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status} (after retries)`);
  return (await res.json()).results?.[0] || null;
}

// Strip punctuation iTunes search chokes on: leading "...", "*", "&"→"and",
// trailing parentheticals, stylized casing like "m.A.A.d".
function cleanTitle(t) {
  return t
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, 'and')
    .replace(/[*.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Query iTunes for the best album match, trying progressively looser terms.
// Returns { artworkUrl, appleUrl, appleId, year } or null.
export async function searchItunes(artist, title) {
  const terms = [`${artist} ${title}`];
  const ct = cleanTitle(title);
  if (ct && ct.toLowerCase() !== title.toLowerCase()) terms.push(`${artist} ${ct}`);
  terms.push(`${artist} ${title.split(/[:(]/)[0].trim()}`); // title before ":"/"("

  let r = null;
  for (const term of terms) {
    r = await itunesGet(term);
    if (r) break;
    await sleep(800);
  }
  if (!r) return null;
  return {
    artworkUrl: upscaleArtwork(r.artworkUrl100),
    appleUrl: stripApple(r.collectionViewUrl),
    appleId: r.collectionId,
    year: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : undefined,
  };
}

// iTunes returns a 100x100 thumb URL; the size token can be swapped for a
// larger render (600x600 is plenty for a ~256px display cover).
export function upscaleArtwork(url, size = 600) {
  if (!url) return undefined;
  return url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
}

// Drop the affiliate `?uo=4` query so the stored link is clean.
function stripApple(url) {
  if (!url) return undefined;
  return url.split('?')[0];
}
