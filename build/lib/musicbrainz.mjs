// MusicBrainz lookup — used to reach Cover Art Archive when iTunes has no
// artwork (common for older indie/rap catalog).
const UA = 'CrateDiggersBot/0.1 (audiodude@gmail.com)';

// First release-group MBID matching artist + title, or null.
export async function mbReleaseGroup(artist, title) {
  const q = encodeURIComponent(`releasegroup:"${title}" AND artist:"${artist}"`);
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${q}&fmt=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const json = await res.json();
    return json['release-groups']?.[0]?.id ?? null;
  } catch {
    return null;
  }
}
