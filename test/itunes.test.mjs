import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLinks, upscaleArtwork } from '../build/lib/itunes.mjs';

const row = { artist: 'Radiohead', title: 'OK Computer' };

test('buildLinks uses direct ids when present', () => {
  const links = buildLinks(row, {
    spotifyId: 'abc123',
    appleUrl: 'https://music.apple.com/us/album/ok-computer/1097861387',
  });
  assert.equal(links.spotify, 'https://open.spotify.com/album/abc123');
  assert.equal(links.apple, 'https://music.apple.com/us/album/ok-computer/1097861387');
  assert.match(links.youtube, /^https:\/\/music\.youtube\.com\/search\?q=/);
});

test('buildLinks falls back to search URLs when ids are missing', () => {
  const links = buildLinks(row, {});
  assert.match(links.spotify, /^https:\/\/open\.spotify\.com\/search\//);
  assert.match(links.apple, /^https:\/\/music\.apple\.com\/us\/search\?term=/);
  assert.ok(decodeURIComponent(links.spotify).includes('Radiohead OK Computer'));
});

test('upscaleArtwork swaps the iTunes size token', () => {
  const u = upscaleArtwork('https://x/abc/100x100bb.jpg', 600);
  assert.equal(u, 'https://x/abc/600x600bb.jpg');
});
