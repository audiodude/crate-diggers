import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/game.js'; // classic script: defines globalThis.CrateGame
const { reduce, phaseOf, displayName, shortId, POINTS_PER_CORRECT } = globalThis.CrateGame;

const hello = (addr, name) => ({ payload: { type: 'hello', addr, name } });
const start = (roundId, by, subject, slate) => ({
  payload: { type: 'round_start', roundId, by, subject, slate },
});
const guess = (roundId, addr, albumId) => ({
  payload: { type: 'guess', roundId, addr, albumId },
});
const reveal = (roundId, subject, albumId) => ({
  payload: { type: 'reveal', roundId, subject, albumId },
});
const seed = (seedId, scores, names) => ({ payload: { type: 'seed', seedId, scores, names } });

const SLATE = ['a', 'b', 'c', 'd'];

function fullGame() {
  return [
    hello('alice', 'Alice'),
    hello('bob', 'Bob'),
    hello('carol', 'Carol'),
    start('r1', 'alice', 'alice', SLATE),
    guess('r1', 'bob', 'c'), // correct
    guess('r1', 'carol', 'a'), // wrong
    reveal('r1', 'alice', 'c'),
  ];
}

test('roster is built from hello updates with names', () => {
  const { roster } = reduce([hello('alice', 'Alice'), hello('bob', 'Bob')]);
  assert.equal(roster.get('alice'), 'Alice');
  assert.equal(roster.get('bob'), 'Bob');
});

test('a correct guess is worth 100 points', () => {
  assert.equal(POINTS_PER_CORRECT, 100);
});

test('correct guessers score one award, wrong guessers score 0', () => {
  const { scores } = reduce(fullGame());
  assert.equal(scores.get('bob'), POINTS_PER_CORRECT);
  assert.equal(scores.get('carol'), 0);
  assert.equal(scores.get('alice'), 0); // subject never scores
});

test('phase is guessing before reveal, revealed after', () => {
  const before = reduce([start('r1', 'alice', 'alice', SLATE), guess('r1', 'bob', 'c')]);
  assert.equal(phaseOf(before.rounds[0]), 'guessing');
  const after = reduce(fullGame());
  assert.equal(phaseOf(after.rounds[0]), 'revealed');
});

test('order-independence: any permutation yields identical scores + roster', () => {
  const base = fullGame();
  const expected = reduce(base);
  const expScores = JSON.stringify([...expected.scores].sort());
  const expRoster = JSON.stringify([...expected.roster].sort());

  // deterministic shuffles (no Math.random — index-driven rotations/reversals)
  const perms = [
    [...base].reverse(),
    base.map((_, i) => base[(i * 3 + 1) % base.length]).length === base.length
      ? rotate(base, 2)
      : base,
    rotate(base, 4),
    rotate([...base].reverse(), 3),
    interleave(base),
  ];
  for (const perm of perms) {
    const got = reduce(perm);
    assert.equal(JSON.stringify([...got.scores].sort()), expScores);
    assert.equal(JSON.stringify([...got.roster].sort()), expRoster);
  }
});

test('idempotent: duplicate and reveal-before-guess updates converge', () => {
  const weird = [
    reveal('r1', 'alice', 'c'), // reveal arrives first
    guess('r1', 'bob', 'c'),
    guess('r1', 'bob', 'c'), // duplicate
    start('r1', 'alice', 'alice', SLATE),
    hello('alice', 'Alice'),
  ];
  const { scores, rounds } = reduce(weird);
  assert.equal(scores.get('bob'), POINTS_PER_CORRECT);
  assert.deepEqual(rounds[0].slate, SLATE);
  assert.equal(rounds[0].reveal, 'c');
});

test('last guess per player wins (player changes their mind)', () => {
  const game = [
    start('r1', 'alice', 'alice', SLATE),
    guess('r1', 'bob', 'a'), // first guess wrong
    guess('r1', 'bob', 'c'), // changed to correct
    reveal('r1', 'alice', 'c'),
  ];
  assert.equal(reduce(game).scores.get('bob'), POINTS_PER_CORRECT);
});

// ---- seed / import (carry scores into a new .xdc instance) ------------------
test('a seed injects baseline scores and shows the player on the board', () => {
  const { scores, roster } = reduce([seed('s1', { bob: 300 }, { bob: 'Bob' })]);
  assert.equal(scores.get('bob'), 300);
  assert.equal(roster.get('bob'), 'Bob'); // seeded name renders before bob re-joins
});

test('seed baseline adds on top of points earned this game', () => {
  const { scores } = reduce([seed('s1', { bob: 100 }), ...fullGame()]);
  assert.equal(scores.get('bob'), 100 + POINTS_PER_CORRECT);
});

test('a duplicate seed (same seedId) is not double-counted', () => {
  const { scores } = reduce([seed('s1', { bob: 100 }), seed('s1', { bob: 100 })]);
  assert.equal(scores.get('bob'), 100);
});

test('distinct seeds sum (two imported games)', () => {
  const { scores } = reduce([seed('s1', { bob: 100 }), seed('s2', { bob: 250 })]);
  assert.equal(scores.get('bob'), 350);
});

test('a real hello name wins over a seeded name, regardless of order', () => {
  const a = reduce([seed('s1', { bob: 100 }, { bob: 'Bobby' }), hello('bob', 'Bob')]);
  const b = reduce([hello('bob', 'Bob'), seed('s1', { bob: 100 }, { bob: 'Bobby' })]);
  assert.equal(a.roster.get('bob'), 'Bob');
  assert.equal(b.roster.get('bob'), 'Bob');
});

test('seeded scores are order-independent', () => {
  const ups = [seed('s2', { bob: 50 }), seed('s1', { bob: 100 }), ...fullGame()];
  const fwd = reduce(ups);
  const rev = reduce([...ups].reverse());
  assert.equal(fwd.scores.get('bob'), rev.scores.get('bob'));
  assert.equal(fwd.scores.get('bob'), 150 + POINTS_PER_CORRECT);
});

// Modern Delta Chat selfAddr is an opaque hash, not an email. The 64-hex digger
// id in the wild (6ef68df…) is exactly such an addr; names must come from the
// roster (built from hello updates), and unknown ids must not dump a wall of hex.
const HASH = '6ef68df184e30613ca147cd13548fd29193a72c03d9fe9d78db9926d8d253b6e';

test('shortId returns the local part of an email-style addr', () => {
  assert.equal(shortId('alice@example.com'), 'alice');
});

test('shortId truncates an opaque hash addr instead of returning all of it', () => {
  const s = shortId(HASH);
  assert.ok(s.length <= 8, `expected a short id, got ${s.length} chars`);
  assert.ok(HASH.startsWith(s), 'should be a prefix of the addr');
});

test('displayName resolves a non-self digger from the roster', () => {
  // Regression: round_start broadcast showed the raw addr because the roster
  // was never consulted. With the roster, a known digger renders as their name.
  const roster = new Map([[HASH, 'Bob']]);
  assert.equal(displayName(HASH, roster, 'me@local', 'Me'), 'Bob');
});

test('displayName returns selfName for self, and a short id for an unknown addr', () => {
  assert.equal(displayName('me@local', new Map(), 'me@local', 'Me'), 'Me');
  const unknown = displayName(HASH, new Map(), 'me@local', 'Me');
  assert.ok(unknown.length <= 8 && HASH.startsWith(unknown), 'unknown addr should truncate');
});

function rotate(arr, n) {
  const k = n % arr.length;
  return arr.slice(k).concat(arr.slice(0, k));
}
function interleave(arr) {
  const even = arr.filter((_, i) => i % 2 === 0);
  const odd = arr.filter((_, i) => i % 2 === 1);
  return even.concat(odd);
}
