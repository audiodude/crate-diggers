// Wikidata helpers — best-effort enrichment for the Spotify album id.
// Adapted from best-albums-headless-astro/src/lib/wikidata.mjs.

const UA = 'CrateDiggersBot/0.1 (audiodude@gmail.com)';

function claimValue(claims, prop) {
  return claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
}

// Full-text search Wikidata for an album; returns the first QID or null.
export async function wbsearch(artist, title) {
  const term = encodeURIComponent(`${title} ${artist}`);
  const url =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
    `&search=${term}&language=en&format=json&type=item&limit=1&origin=*`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Wikidata search HTTP ${res.status}`);
  const json = await res.json();
  return json.search?.[0]?.id ?? null;
}

export async function fetchEntity(qid) {
  const res = await fetch(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
    { headers: { 'User-Agent': UA } },
  );
  if (!res.ok) throw new Error(`Wikidata ${qid}: HTTP ${res.status}`);
  const json = await res.json();
  return json.entities?.[qid];
}

// Resolve the Spotify album id (P2205) for an album, or null on any miss.
// `qidOverride` short-circuits the search when deck.json pins a QID.
export async function spotifyId(artist, title, qidOverride) {
  try {
    const qid = qidOverride || (await wbsearch(artist, title));
    if (!qid) return null;
    const entity = await fetchEntity(qid);
    return claimValue(entity?.claims, 'P2205') ?? null;
  } catch {
    return null;
  }
}
