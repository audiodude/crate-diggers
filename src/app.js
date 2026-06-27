// Crate Diggers — UI + WebXDC wiring (all effects live here; game.js stays pure).
// Classic script: game.js (loaded before this) put the reducer on window.
// Wrapped in an IIFE so its top-level names don't collide in the shared global.
(function () {
const { reduce, phaseOf, displayName, POINTS_PER_CORRECT } = window.CrateGame;

const xdc = window.webxdc;
const ALBUMS = window.ALBUMS || [];
const byId = new Map(ALBUMS.map((a) => [a.id, a]));
const self = xdc.selfAddr;
const selfName = xdc.selfName || (self ? window.CrateGame.shortId(self) : 'me');

const app = document.getElementById('app');
let updates = []; // received payloads, in arrival order (order doesn't matter)
let manualView = null; // null = auto, 'lobby', 'new'
let detailId = null; // album id shown in the detail overlay
let scoreModal = null; // null | 'export' | 'import' — the save/load-scores sheet
let scoreError = null; // import parse error to show in the modal
let exportPayload = null; // frozen export blob while the export sheet is open
let importText = ''; // in-progress paste, preserved across re-renders

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
function startRound(subject, roster) {
  const roundId = nextRoundId();
  const slate = randomSlate();
  const who = nameOf(subject, roster); // resolve via roster so the broadcast shows a name, not a raw addr
  send(
    { type: 'round_start', roundId, by: self, subject, slate },
    {
      info: `🎵 ${who} is the digger — guess what they'd pick`,
      summary: `Round: what would ${who} pick?`,
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
  return displayName(addr, roster, self, selfName);
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

// Serialize the current scoreboard so it can be carried into a new .xdc build.
// The seedId is baked in so re-importing the same blob is idempotent (the
// reducer keys baselines by seedId — see game.js).
function scoresBlob(state) {
  const { roster, scores } = state;
  const out = {
    app: 'crate-diggers',
    v: 1,
    seedId: `${self}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    scores: {},
    names: {},
  };
  for (const [addr, pts] of scores) {
    if (!pts) continue;
    out.scores[addr] = pts;
    out.names[addr] = nameOf(addr, roster);
  }
  return JSON.stringify(out, null, 2);
}

// Parse a pasted blob and broadcast it as a seed. Returns an error string on
// failure, or null on success.
function importScores(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return 'That doesn’t look like exported scores (couldn’t read the JSON).';
  }
  if (!data || typeof data !== 'object' || !data.scores || typeof data.scores !== 'object' || !Object.keys(data.scores).length) {
    return 'No scores found in that text.';
  }
  const seedId =
    typeof data.seedId === 'string' && data.seedId ? data.seedId : `import-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const names = data.names && typeof data.names === 'object' ? data.names : {};
  send({ type: 'seed', seedId, scores: data.scores, names });
  return null;
}

// Compact "Scores: [Load] [Export]" row — both always visible so a fresh game
// can be seeded and a running one can be carried out.
function scoreTools() {
  return `<div class="score-tools"><span class="lbl">Scores:</span>
    <button data-action="import-scores">Load</button>
    <button data-action="export-scores">Export</button></div>`;
}

// ---- views ------------------------------------------------------------------
function render() {
  // Keep whatever the user is pasting if an update re-renders us mid-import.
  if (scoreModal === 'import') {
    const ta = document.getElementById('score-blob');
    if (ta) importText = ta.value;
  }
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

  app.innerHTML = html + (detailId ? detailOverlay(detailId) : '') + (scoreModal ? scoreModalView() : '');
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
    scoreTools() +
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

// Live list of guesses made so far this round (subject excluded). Shown during
// the guessing phase so everyone can watch the picks roll in.
function liveGuesses(round, state) {
  const items = [...round.guesses]
    .filter(([a]) => a !== round.subject)
    .map(([a, id]) => {
      const g = byId.get(id);
      return `<li><span>${esc(nameOf(a, state.roster))}</span><em>${g ? esc(g.title) : '?'}</em></li>`;
    })
    .join('');
  if (!items) return '';
  return `<section class="card"><h2>Guesses so far</h2><ul class="guesses">${items}</ul></section>`;
}

function subjectView(round, state) {
  const pick = localPicks()[round.roundId];
  const guessCount = [...round.guesses.keys()].filter((a) => a !== round.subject).length;
  if (!pick) {
    return (
      header('You’re the digger 🎧') +
      `<section class="card"><h2>Which of these would YOU pick?</h2>
       <p class="hint">Stays secret until you reveal.</p>${slateGrid(round.slate, 'pick')}</section>` +
      liveGuesses(round, state)
    );
  }
  const a = byId.get(pick);
  return (
    header('You’re the digger 🎧') +
    `<section class="card"><h2>Your secret pick</h2>
     ${slateGrid([pick], 'detail', pick)}
     <p class="hint">${guessCount} guess${guessCount === 1 ? '' : 'es'} in.</p>
     <button class="primary big" data-action="reveal">Reveal &amp; score</button></section>` +
    liveGuesses(round, state)
  );
}

function guesserView(round, state) {
  const myGuess = round.guesses.get(self);
  const subj = nameOf(round.subject, state.roster);
  const guessCount = [...round.guesses.keys()].filter((a) => a !== round.subject).length;
  if (!myGuess) {
    return (
      header(`What would ${esc(subj)} pick?`) +
      `<section class="card"><h2>Make your guess</h2>${slateGrid(round.slate, 'guess')}</section>` +
      liveGuesses(round, state)
    );
  }
  return (
    header(`What would ${esc(subj)} pick?`) +
    `<section class="card"><h2>Locked in ✓</h2>
     <p class="hint">${guessCount} guess${guessCount === 1 ? '' : 'es'} so far — revealed when ${esc(subj)} reveals.</p>
     <button class="ghost" data-action="lobby">Watch scoreboard</button></section>` +
    liveGuesses(round, state)
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
        <em>${g ? esc(g.title) : '?'}</em>${ok ? `<b>+${POINTS_PER_CORRECT}</b>` : ''}</li>`;
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
    scoreTools() +
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

function scoreModalView() {
  if (scoreModal === 'export') {
    return `<div class="overlay" data-action="close-score-modal"><div class="sheet" data-stop>
      <h2>Save scores</h2>
      <p>Copy this, then paste it into the new version with “Load scores”.</p>
      <textarea id="score-blob" readonly>${esc(exportPayload || '')}</textarea>
      <div class="row"><button class="primary" data-action="copy-scores">Copy</button>
        <button class="ghost" data-action="close-score-modal">Close</button></div>
    </div></div>`;
  }
  return `<div class="overlay" data-action="close-score-modal"><div class="sheet" data-stop>
    <h2>Load scores</h2>
    <p>Paste an exported scoreboard to carry it into this game.</p>
    <textarea id="score-blob" placeholder="Paste exported scores here…">${esc(importText || '')}</textarea>
    ${scoreError ? `<p class="err">${esc(scoreError)}</p>` : ''}
    <div class="row"><button class="primary" data-action="load-scores">Load</button>
      <button class="ghost" data-action="close-score-modal">Close</button></div>
  </div></div>`;
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
      startRound(addr, state.roster);
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
    case 'export-scores':
      exportPayload = scoresBlob(state);
      scoreModal = 'export';
      scoreError = null;
      break;
    case 'import-scores':
      scoreModal = 'import';
      scoreError = null;
      importText = '';
      break;
    case 'copy-scores': {
      const ta = document.getElementById('score-blob');
      if (ta) {
        ta.focus();
        ta.select();
        try {
          if (navigator.clipboard) navigator.clipboard.writeText(ta.value);
        } catch (err) {}
        try {
          document.execCommand('copy');
        } catch (err) {}
      }
      return; // keep the sheet open and the text selected
    }
    case 'load-scores': {
      const ta = document.getElementById('score-blob');
      const err = ta ? importScores(ta.value) : 'Nothing to load.';
      if (err) {
        scoreError = err;
        importText = ta ? ta.value : importText;
      } else {
        scoreModal = null;
        scoreError = null;
        importText = '';
      }
      break;
    }
    case 'close-score-modal':
      if (e.target.closest('[data-stop]') && !e.target.closest('.ghost')) return;
      scoreModal = null;
      scoreError = null;
      exportPayload = null;
      importText = '';
      break;
    default:
      return;
  }
  render();
});

// ---- boot -------------------------------------------------------------------
// setUpdateListener returns a promise that resolves once the host is ready and
// history has replayed. We MUST wait for it before the first sendUpdate: some
// hosts (e.g. webxdc-dev) back sendUpdate with a WebSocket that is still
// CONNECTING at boot, and sending early throws "Failed to execute 'send'",
// which would abort boot before the UI ever renders. render() runs immediately
// so "Loading the crate…" is replaced while that connection settles.
const ready = xdc.setUpdateListener((u) => {
  updates.push(u.payload);
  render();
}, 0);
render();
Promise.resolve(ready).then(sendHello);
})();
