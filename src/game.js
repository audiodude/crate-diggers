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

function reduce(updates) {
  const roster = new Map(); // addr -> name
  const rmap = new Map(); // roundId -> round object
  const seen = new Set(); // addrs that have acted at all

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
        if (p.addr && p.name) roster.set(p.addr, p.name);
        break;
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

  // Stable round ordering by first-seen sequence.
  const rounds = [...rmap.values()].sort((a, b) => a._seq - b._seq);
  const scores = scoreFor(rounds, seen);
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
      if (albumId === r.reveal) scores.set(addr, (scores.get(addr) || 0) + 1);
    }
  }
  return scores;
}

const api = { reduce, phaseOf, scoreFor };

// Dual export: browser global + Node ESM.
if (typeof window !== 'undefined') window.CrateGame = api;
export { reduce, phaseOf, scoreFor };
export default api;
