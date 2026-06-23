# Crate Diggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a self-contained WebXDC `.xdc` party game where players guess which of 4 random albums a chosen friend would most enjoy, scored over an append-only update log.

**Architecture:** A build-time Node pipeline turns a hand-curated `deck.json` into `albums.json` + bundled cover thumbnails (iTunes art + Apple link, Wikidata Spotify id, CAA fallback). The runtime app is a pure, dependency-free reducer (`game.js`) over the WebXDC update log plus a thin effects/UI layer (`app.js`). Everything ships in one zip; no network or server at runtime.

**Tech Stack:** Node ≥ 20 (build only: `sharp`, `adm-zip`), vanilla HTML/CSS/JS runtime, `node --test` for unit tests, `webxdc-dev` for multiplayer playtesting.

## Global Constraints

- Runtime is fully offline: no `fetch`/XHR/CDN/external fonts; all assets bundled in the `.xdc` zip.
- App name (manifest + title): **Crate Diggers**.
- Deck: **124 albums**, 4 per year × (1985–2015), slots `rock` / `pop` / `hiphop` / `gem`.
- All cross-peer state derives from a **pure reduction over the update log**; must be order-independent and idempotent.
- Update types: `hello {addr,name}`, `round_start {roundId,by,subject,slate[4]}`, `guess {roundId,addr,albumId}`, `reveal {roundId,subject,albumId}`.
- Subject's pick is **never broadcast before reveal** (held in `localStorage` keyed by `roundId`).
- `User-Agent` header required on Wikidata + Cover Art Archive requests.
- Every album exposes 3 external listen links (Spotify / Apple Music / YouTube Music), search-URL fallbacks always present.

---

### Task 1: Project scaffold & deck data

**Files:**
- Create: `package.json`, `deck.json`, `src/manifest.toml`, `src/icon.png`

**Interfaces:**
- Produces: `deck.json` = array of `{id, artist, title, year, genre}` where `genre ∈ {rock,pop,hiphop,gem}` and `id = "<year>-<genre>"`; 124 rows.

- [ ] Write `package.json` with deps `sharp`, `adm-zip` and scripts `build`, `pack`, `test`.
- [ ] Write `deck.json`: 124 curated rows (rock/pop/hiphop chart-topper + one gem per year 1985–2015).
- [ ] Write `src/manifest.toml` → `name = "Crate Diggers"`.
- [ ] Generate a simple 256×256 `src/icon.png` (crate/record motif) via sharp/SVG.
- [ ] Commit.

### Task 2: Build pipeline — metadata + artwork fetch

**Files:**
- Create: `build/lib/wikidata.mjs` (adapted), `build/lib/itunes.mjs`, `build/lib/covers.mjs` (adapted), `build/fetch-art.mjs`
- Test: `test/itunes.test.mjs`

**Interfaces:**
- Consumes: `deck.json` rows.
- Produces: `src/albums.json` (rows + `img`, `links{spotify,apple,youtube}`), `src/img/<id>.jpg`. Exposes `buildLinks(row, {spotifyId, appleUrl})` (pure) and `searchItunes(term)`.

- [ ] Write failing test for `buildLinks()`: given a row + ids, returns correct direct/search URLs; missing ids → search URLs.
- [ ] Implement `build/lib/itunes.mjs` (`searchItunes`, `bestArtworkUrl`) and the pure `buildLinks()`.
- [ ] Run test → pass.
- [ ] Implement `build/lib/wikidata.mjs` (`wbsearch`→QID, `fetchEntity`, `spotifyId`) adapted from best-albums-headless-astro.
- [ ] Implement `build/lib/covers.mjs` (`downloadImage`, `resizeCover` via sharp, ~256px) adapted likewise.
- [ ] Implement `build/fetch-art.mjs`: for each deck row → iTunes art+apple+year, Wikidata spotify id, CAA fallback; write `img/<id>.jpg` + `albums.json`. Rate-limit, retry, report failures, never crash on one bad row (placeholder cover if all sources fail).
- [ ] Run `npm run build`; verify `albums.json` has 124 rows and `img/` populated.
- [ ] Commit.

### Task 3: Pure reducer (`game.js`) + tests

**Files:**
- Create: `src/game.js`
- Test: `test/game.test.mjs`

**Interfaces:**
- Produces: `reduce(updates) -> {roster:Map<addr,name>, rounds:[{roundId,by,subject,slate,guesses:Map,reveal}], scores:Map<addr,number>}`; helpers `phaseOf(round)`, `scoreFor(rounds)`. Pure, no DOM, no globals.

- [ ] Write failing tests: roster from `hello`; a full round (start→guesses→reveal) scores correct guessers +1; wrong guesses score 0; **same log shuffled into 5 random orders yields identical scores/roster** (order-independence); reveal-before-guess and duplicate updates are idempotent.
- [ ] Run → fail.
- [ ] Implement `reduce()` and helpers (`payload.type` switch; rebuild from scratch each call; dedupe guesses by `(roundId,addr)` last-write).
- [ ] Run → pass.
- [ ] Commit.

### Task 4: Runtime app shell + webxdc wiring

**Files:**
- Create: `src/index.html`, `src/app.js`, `src/styles.css`, `src/webxdc-shim.js`
- Modify: load `albums.json` via a generated `albums.js` (`window.ALBUMS = [...]`) so no runtime `fetch` is needed.

**Interfaces:**
- Consumes: `reduce()` from `game.js`, `window.ALBUMS`, `window.webxdc`.
- Produces: rendering for screens (lobby, new-round, subject, guesser, reveal, album-detail); `sendUpdate` wrappers `sendHello/startRound/sendGuess/sendReveal`.

- [ ] Add `build/fetch-art.mjs` step (or `pack.mjs`) to also emit `src/albums.js` (`window.ALBUMS=`) from `albums.json` — runtime can't `fetch` a JSON file under all hosts, so inline it.
- [ ] Implement `src/app.js`: subscribe `setUpdateListener`, keep update array, re-`reduce()` + re-render on each; `sendHello` once; local `localStorage` for subject pick keyed by roundId; counter for `roundId`.
- [ ] Implement screens in `index.html` + `app.js`; `styles.css` for a clean crate/record look; album-detail overlay with 3 listen links (`target="_blank" rel="noreferrer"`).
- [ ] Manual sanity: open `src/index.html` with `webxdc-shim.js` (a tiny local mock of `window.webxdc`) in a browser; verify a round can be started/guessed/revealed single-player.
- [ ] Commit.

### Task 5: Packaging + README + final test

**Files:**
- Create: `build/pack.mjs`, `README.md`

**Interfaces:**
- Produces: `crate-diggers.xdc` zip (src/ contents at zip root); README with playtest instructions.

- [ ] Implement `build/pack.mjs`: zip everything in `src/` (index.html at root) → `crate-diggers.xdc`; assert `index.html` + `manifest.toml` present; print size.
- [ ] Write `README.md`: what it is, build steps (`npm i`, `npm run build`, `npm run pack`), and **playtesting with a simulated friend** via `npx webxdc-dev run src` (multi-peer browser); plus Delta Chat Desktop two-account check.
- [ ] Run full chain: `npm run build && npm test && npm run pack`; verify `crate-diggers.xdc` exists and is ~1–2 MB.
- [ ] Commit.

## Self-Review notes

- Spec §2–§10 each map to a task (flow/reducer→T3, privacy→T3/T4, deck→T1, pipeline→T2, links→T2/T4, screens→T4, packaging/test→T5). ✓
- Order-independence (spec §5) is explicitly tested in T3. ✓
- Runtime-no-fetch constraint handled by inlining `albums.js` (T4). ✓
