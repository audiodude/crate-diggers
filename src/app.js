// Crate Diggers — UI + WebXDC wiring (all effects live here; game.js stays pure).
// Classic script: game.js (loaded before this) put the reducer on window.
// Wrapped in an IIFE so its top-level names don't collide in the shared global.
(function () {
const { reduce, phaseOf } = window.CrateGame;

const xdc = window.webxdc;
const ALBUMS = window.ALBUMS || [];
const byId = new Map(ALBUMS.map((a) => [a.id, a]));
const self = xdc.selfAddr;
const selfName = xdc.selfName || (self ? self.split('@')[0] : 'me');

const app = document.getElementById('app');
let updates = []; // received payloads, in arrival order (order doesn't matter)
let manualView = null; // null = auto, 'lobby', 'new'
let detailId = null; // album id shown in the detail overlay

// ---- local-only state (never broadcast) -------------------------------------
const LS_PICKS = 'cratediggers.picks'; // { roundId: albumId } — subject's secret
const LS_COUNTER = 'cratediggers.counter';

const localPicks = () => JSON.parse(localStorage.getItem(LS_PICKS) || '{}');
function setLocalPick(roundId, albumId) {
  const p = localPicks();
  p[roundId] = albumId;
  localStorage.setItem(LS_PICKS, JSON.stringify(p));
}
function nextRoundId() {
  const n = Number(localStorage.getItem(LS_COUNTER) || '0') + 1;
  localStorage.setItem(LS_COUNTER, String(n));
  return `${self}-${n}`;
}

// ---- send helpers -----------------------------------------------------------
function send(payload, opts = {}) {
  xdc.sendUpdate({ payload, ...opts }, opts.descr || payload.type);
}
function sendHello() {
  send({ type: 'hello', addr: self, name: selfName });
}
function startRound(subject) {
  const roundId = nextRoundId();
  const slate = randomSlate();
  send(
    { type: 'round_start', roundId, by: self, subject, slate },
    {
      info: `🎵 ${nameOf(subject)} is the digger — guess what they'd pick`,
      summary: `Round: what would ${nameOf(subject)} pick?`,
    },
  );
}
function sendGuess(roundId, albumId) {
  send({ type: 'guess', roundId, addr: self, albumId });
}
function sendReveal(roundId, albumId) {
  const al = byId.get(albumId);
  send(
    { type: 'reveal', roundId, subject: self, albumId },
    {
      info: `🥁 ${selfName} picked ${al ? `${al.artist} — ${al.title}` : 'their album'}`,
      summary: `${selfName} revealed their pick`,
    },
  );
}

// ---- helpers ----------------------------------------------------------------
function nameOf(addr, roster) {
  if (addr === self) return selfName;
  const n = roster && roster.get(addr);
  if (n && n !== addr) return n;
  return addr ? addr.split('@')[0] : '?';
}
function randomSlate() {
  const ids = ALBUMS.map((a) => a.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 4);
}
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- views ------------------------------------------------------------------
function render() {
  if (!ALBUMS.length) {
    app.innerHTML = `<div class="loading">No album data. Run <code>npm run build</code> first.</div>`;
    return;
  }
  const state = reduce(updates);
  const { roster, rounds, scores } = state;
  const latest = rounds[rounds.length - 1];
  const active = latest && phaseOf(latest) === 'guessing' ? latest : null;

  let html;
  if (active) {
    manualView = null;
    html = active.subject === self ? subjectView(active, state) : guesserView(active, state);
  } else if (manualView === 'new') {
    html = newRoundView(state);
  } else if (manualView !== 'lobby' && latest && phaseOf(latest) === 'revealed') {
    html = resultsView(latest, state);
  } else {
    html = lobbyView(state);
  }

  app.innerHTML = html + (detailId ? detailOverlay(detailId) : '');
}

function header(sub) {
  return `<header><h1>Crate&nbsp;Diggers</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</header>`;
}

function scoreboard(state) {
  const { roster, scores } = state;
  const rows = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  return `<section class="card"><h2>Scoreboard</h2><ul class="scores">${rows
    .map(
      ([addr, pts]) =>
        `<li><span>${esc(nameOf(addr, roster))}${addr === self ? ' (you)' : ''}</span><b>${pts}</b></li>`,
    )
    .join('')}</ul></section>`;
}

function lobbyView(state) {
  const { rounds } = state;
  const history = rounds
    .filter((r) => phaseOf(r) === 'revealed')
    .slice(-6)
    .reverse()
    .map((r) => {
      const al = byId.get(r.reveal);
      const correct = [...r.guesses].filter(([a, id]) => a !== r.subject && id === r.reveal).length;
      return `<li><span>${esc(nameOf(r.subject, state.roster))} → ${
        al ? esc(`${al.artist} — ${al.title}`) : '?'
      }</span><b>${correct}✓</b></li>`;
    })
    .join('');
  return (
    header('How well do you know your friends’ taste?') +
    scoreboard(state) +
    `<button class="primary big" data-action="new-round">＋ New Round</button>` +
    (history ? `<section class="card"><h2>Recent rounds</h2><ul class="history">${history}</ul></section>` : '') +
    `<p class="hint">Pick a friend, see 4 albums, guess which one they’d love.</p>`
  );
}

function newRoundView(state) {
  const { roster } = state;
  const addrs = [...new Set([self, ...roster.keys()])];
  const chips = addrs
    .map(
      (a) =>
        `<button class="chip" data-action="choose-subject" data-addr="${esc(a)}">${esc(
          nameOf(a, roster),
        )}${a === self ? ' (you)' : ''}</button>`,
    )
    .join('');
  return (
    header('Who are we reading?') +
    `<section class="card"><h2>Pick the digger</h2><div class="chips">${chips}</div>
     <p class="hint">They’ll secretly pick 1 of 4 albums; everyone else guesses it.</p></section>` +
    `<button class="ghost" data-action="lobby">Cancel</button>`
  );
}

function slateGrid(slate, action, picked) {
  return `<div class="grid">${slate
    .map((id) => {
      const a = byId.get(id);
      if (!a) return '';
      const sel = picked === id ? ' selected' : '';
      return `<button class="cover${sel}" data-action="${action}" data-album="${esc(id)}">
        <img src="${esc(a.img)}" alt="${esc(a.title)}" loading="lazy" />
        <span class="meta"><b>${esc(a.title)}</b>${esc(a.artist)} · ${a.year}</span>
      </button>`;
    })
    .join('')}</div>`;
}

function subjectView(round, state) {
  const pick = localPicks()[round.roundId];
  const guessCount = [...round.guesses.keys()].filter((a) => a !== round.subject).length;
  if (!pick) {
    return (
      header('You’re the digger 🎧') +
      `<section class="card"><h2>Which of these would YOU pick?</h2>
       <p class="hint">Stays secret until you reveal.</p>${slateGrid(round.slate, 'pick')}</section>`
    );
  }
  const a = byId.get(pick);
  return (
    header('You’re the digger 🎧') +
    `<section class="card"><h2>Your secret pick</h2>
     ${slateGrid([pick], 'detail', pick)}
     <p class="hint">${guessCount} guess${guessCount === 1 ? '' : 'es'} in.</p>
     <button class="primary big" data-action="reveal">Reveal &amp; score</button></section>`
  );
}

function guesserView(round, state) {
  const myGuess = round.guesses.get(self);
  const subj = nameOf(round.subject, state.roster);
  const guessCount = [...round.guesses.keys()].filter((a) => a !== round.subject).length;
  if (!myGuess) {
    return (
      header(`What would ${esc(subj)} pick?`) +
      `<section class="card"><h2>Make your guess</h2>${slateGrid(round.slate, 'guess')}</section>`
    );
  }
  return (
    header(`What would ${esc(subj)} pick?`) +
    `<section class="card"><h2>Locked in ✓</h2>
     <p class="hint">Your guess is hidden until ${esc(subj)} reveals. ${guessCount} guess${
       guessCount === 1 ? '' : 'es'
     } so far.</p>
     <button class="ghost" data-action="lobby">Watch scoreboard</button></section>`
  );
}

function resultsView(round, state) {
  const al = byId.get(round.reveal);
  const subj = nameOf(round.subject, state.roster);
  const guesses = [...round.guesses]
    .filter(([a]) => a !== round.subject)
    .map(([a, id]) => {
      const g = byId.get(id);
      const ok = id === round.reveal;
      return `<li class="${ok ? 'ok' : 'no'}"><span>${esc(nameOf(a, state.roster))}</span>
        <em>${g ? esc(g.title) : '?'}</em>${ok ? '<b>+1</b>' : ''}</li>`;
    })
    .join('');
  return (
    header(`${esc(subj)} picked…`) +
    (al
      ? `<section class="card pick"><img src="${esc(al.img)}" alt="" />
         <div><h2>${esc(al.title)}</h2><p>${esc(al.artist)} · ${al.year}</p>
         ${listenLinks(al)}</div></section>`
      : '') +
    `<section class="card"><h2>Guesses</h2><ul class="guesses">${guesses || '<li class="no"><span>nobody guessed</span></li>'}</ul></section>` +
    scoreboard(state) +
    `<div class="row"><button class="primary" data-action="new-round">＋ New Round</button>
     <button class="ghost" data-action="lobby">Lobby</button></div>`
  );
}

function listenLinks(a) {
  const L = a.links || {};
  const link = (href, label, cls) =>
    href ? `<a class="listen ${cls}" href="${esc(href)}" target="_blank" rel="noreferrer noopener">${label}</a>` : '';
  return `<div class="listen-row">${link(L.spotify, 'Spotify', 'sp')}${link(L.apple, 'Apple', 'ap')}${link(
    L.youtube,
    'YouTube',
    'yt',
  )}</div>`;
}

function detailOverlay(id) {
  const a = byId.get(id);
  if (!a) return '';
  return `<div class="overlay" data-action="close-detail"><div class="sheet" data-stop>
    <img src="${esc(a.img)}" alt="" />
    <h2>${esc(a.title)}</h2><p>${esc(a.artist)} · ${a.year}</p>
    ${listenLinks(a)}
    <button class="ghost" data-action="close-detail">Close</button>
  </div></div>`;
}

// ---- events -----------------------------------------------------------------
app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const { action, album, addr } = t.dataset;
  const state = reduce(updates);
  const latest = state.rounds[state.rounds.length - 1];
  switch (action) {
    case 'new-round':
      manualView = 'new';
      break;
    case 'lobby':
      manualView = 'lobby';
      break;
    case 'choose-subject':
      startRound(addr);
      manualView = null;
      break;
    case 'pick':
      if (latest) setLocalPick(latest.roundId, album);
      break;
    case 'guess':
      if (latest) sendGuess(latest.roundId, album);
      break;
    case 'reveal':
      if (latest) {
        const pick = localPicks()[latest.roundId];
        if (pick) sendReveal(latest.roundId, pick);
      }
      break;
    case 'detail':
      detailId = album;
      break;
    case 'close-detail':
      if (e.target.closest('[data-stop]') && !e.target.closest('.ghost')) return;
      detailId = null;
      break;
    default:
      return;
  }
  render();
});

// ---- boot -------------------------------------------------------------------
xdc.setUpdateListener((u) => {
  updates.push(u.payload);
  render();
}, 0);
sendHello();
render();
})();
