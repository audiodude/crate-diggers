// Crate Diggers — pure game reducer.
//
// The whole game state is a deterministic reduction over the WebXDC update log.
// It MUST be order-independent and idempotent: WebXDC gives no global ordering
// guarantee, replays history to late joiners, and may deliver duplicates. So we
// rebuild from scratch on every call and never depend on arrival order.
//
// Update payloads (one per sendUpdate):
//   { type: 'hello',       addr, name }
//   { type: 'round_start', roundId, by, subject, slate: [id,id,id,id] }
//   { type: 'guess',       roundId, addr, albumId }
//   { type: 'reveal',      roundId, subject, albumId }
//
// Works in both the browser (script tag) and Node (ESM import) via the shim at
// the bottom of the file.

// Wrapped in an IIFE so nothing leaks to the global scope except CrateGame —
// classic <script>s share one global, and app.js declares its own `reduce`.
(function (root) {
const POINTS_PER_CORRECT = 100; // points a guesser earns for matching a reveal

function reduce(updates) {
  const roster = new Map(); // addr -> name
  const rmap = new Map(); // roundId -> round object
  const seen = new Set(); // addrs that have acted at all
  const seeds = new Map(); // seedId -> { scores:{addr:pts}, names:{addr:name} } — imported baselines
  const helloNamed = new Set(); // addrs that announced a real name via hello (authoritative)

  const note = (addr) => {
    if (addr && !roster.has(addr)) roster.set(addr, addr); // default name = addr
    if (addr) seen.add(addr);
  };

  const round = (roundId) => {
    let r = rmap.get(roundId);
    if (!r) {
      r = { roundId, by: null, subject: null, slate: null, guesses: new Map(), reveal: null, _seq: rmap.size };
      rmap.set(roundId, r);
    }
    return r;
  };

  for (const u of updates) {
    const p = u && u.payload ? u.payload : u; // accept raw payloads or {payload}
    if (!p || !p.type) continue;
    switch (p.type) {
      case 'hello':
        note(p.addr);
        if (p.addr && p.name) {
          roster.set(p.addr, p.name);
          helloNamed.add(p.addr);
        }
        break;
      case 'seed': {
        // An imported scoreboard from a previous .xdc instance. Keyed by seedId
        // so duplicate delivery / re-imports of the same blob can't double-count.
        if (!p.seedId) break;
        const s = p.scores && typeof p.scores === 'object' ? p.scores : {};
        const names = p.names && typeof p.names === 'object' ? p.names : {};
        seeds.set(p.seedId, { scores: s, names });
        for (const a of Object.keys(s)) note(a);
        for (const a of Object.keys(names)) note(a);
        break;
      }
      case 'round_start': {
        note(p.by);
        note(p.subject);
        const r = round(p.roundId);
        r.by = p.by ?? r.by;
        r.subject = p.subject ?? r.subject;
        if (Array.isArray(p.slate)) r.slate = p.slate.slice();
        break;
      }
      case 'guess': {
        note(p.addr);
        const r = round(p.roundId);
        // last write per (round, addr) wins — deterministic on dedup
        r.guesses.set(p.addr, p.albumId);
        break;
      }
      case 'reveal': {
        note(p.subject);
        const r = round(p.roundId);
        r.subject = p.subject ?? r.subject;
        r.reveal = p.albumId;
        break;
      }
      default:
        break;
    }
  }

  // Fold seeded names into the roster: a real hello name always wins; among
  // seeds, the smallest seedId wins — both rules keep this order-independent.
  for (const sid of [...seeds.keys()].sort()) {
    const { names } = seeds.get(sid);
    for (const a of Object.keys(names)) {
      const nm = names[a];
      if (!nm || nm === a || helloNamed.has(a)) continue;
      if (!roster.has(a) || roster.get(a) === a) roster.set(a, nm);
    }
  }

  // Stable round ordering by first-seen sequence.
  const rounds = [...rmap.values()].sort((a, b) => a._seq - b._seq);
  const scores = scoreFor(rounds, seen);
  // Add imported baselines on top of points earned this game (sum over distinct
  // seedIds — commutative and idempotent on duplicate delivery).
  for (const { scores: s } of seeds.values()) {
    for (const a of Object.keys(s)) {
      const pts = Number(s[a]) || 0;
      scores.set(a, (scores.get(a) || 0) + pts);
    }
  }
  return { roster, rounds, scores };
}

// Phase of a round, derived purely from its fields.
function phaseOf(round) {
  if (round.reveal != null) return 'revealed';
  return 'guessing';
}

// Score: +1 to each guesser whose guess matches a revealed pick. The subject's
// own pick (revealed) is not a guess and is excluded.
function scoreFor(rounds, seen) {
  const scores = new Map();
  for (const addr of seen) scores.set(addr, 0);
  for (const r of rounds) {
    if (r.reveal == null) continue;
    for (const [addr, albumId] of r.guesses) {
      if (addr === r.subject) continue; // subject doesn't guess against self
      if (albumId === r.reveal) scores.set(addr, (scores.get(addr) || 0) + POINTS_PER_CORRECT);
    }
  }
  return scores;
}

// A short, human-readable label for an addr. Delta Chat's selfAddr is an opaque
// hash (no '@'), older/shim addrs are emails — handle both, and never return a
// wall of hex when an addr is all we have.
function shortId(addr) {
  if (!addr) return '?';
  const at = addr.indexOf('@');
  if (at > 0) return addr.slice(0, at); // email-style: the local part
  return addr.length > 8 ? addr.slice(0, 6) : addr; // opaque id: a short prefix
}

// Resolve an addr to a display name. Prefers selfName for self, then a roster
// name (from hello updates), falling back to a short id. The roster default for
// an unknown peer is the addr itself, so an entry equal to the addr is "no name".
function displayName(addr, roster, self, selfName) {
  if (addr && addr === self) return selfName || shortId(addr);
  const n = roster && roster.get(addr);
  if (n && n !== addr) return n;
  return shortId(addr);
}

// Expose one global — works in the browser (classic <script>) and in Node (the
// unit tests import this file for its side effect, then read globalThis.CrateGame).
root.CrateGame = { reduce, phaseOf, scoreFor, shortId, displayName, POINTS_PER_CORRECT };
})(typeof window !== 'undefined' ? window : globalThis);
