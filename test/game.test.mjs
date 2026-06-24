import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/game.js'; // classic script: defines globalThis.CrateGame
const { reduce, phaseOf } = globalThis.CrateGame;

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

test('correct guessers score +1, wrong guessers score 0', () => {
  const { scores } = reduce(fullGame());
  assert.equal(scores.get('bob'), 1);
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
  assert.equal(scores.get('bob'), 1);
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
  assert.equal(reduce(game).scores.get('bob'), 1);
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
