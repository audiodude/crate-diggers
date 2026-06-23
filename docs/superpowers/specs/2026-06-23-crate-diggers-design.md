# Crate Diggers — Design Spec

**Date:** 2026-06-23
**Status:** Approved design, pre-implementation
**Platform:** WebXDC app (`.xdc`) for Delta Chat and compatible messengers

## 1. Concept

A WebXDC party game that lives inside a Delta Chat group: *how well do you know
your friends' taste in music?*

Each round, one player is the **subject**. The app shows them 4 random albums
from a fixed 124-album deck; the subject secretly picks the one *they'd* most
enjoy. Everyone else guesses which of the 4 the subject picked. Correct guessers
score +1. Scores accumulate forever. The deck spans 1985–2015 and deliberately
mixes mega-famous chart-toppers with obscure cult gems, so some rounds are easy
reads and others are wild cards.

The game is designed to be *native to the platform*: no server, no global
ordering assumptions, fully reconstructable from the append-only update log,
async-friendly (a round can sit for hours), and offline-tolerant.

## 2. Round flow & rules

Format is **open / endless** — no rotation, no end state.

1. Any player taps **New Round** and picks a **subject** from the player list
   (picking yourself is allowed).
2. The starter's app draws **4 random albums** from the deck and broadcasts them
   as the round's slate, so every client sees the same 4.
3. The **subject** sees the 4 covers and secretly taps the album they'd most
   enjoy. This pick is held **locally and is NOT broadcast** (see §5).
4. **Everyone else** taps their guess. Guesses broadcast immediately but are
   **UI-hidden** until reveal.
5. The subject taps **Reveal** → their pick is broadcast, the round closes, and
   every guesser whose guess matches the subject's pick scores **+1**.
6. A running scoreboard shows cumulative points per player.

Edge cases:
- Subject is also the starter: allowed; they pick, others guess.
- Solo testing (no other players): subject can pick and reveal; nobody scores.
- Concurrent rounds: only one round is "active" in the UI at a time (the latest
  un-revealed `round_start`). A rare simultaneous double-start produces two valid
  rounds in the log; the UI focuses the latest and the other still resolves on its
  own reveal. Acceptable for a casual game; not specially handled.

## 3. Privacy model

WebXDC broadcasts every `sendUpdate` payload to all members, so "secret" data is
only as private as the app's discipline:

- **Subject's pick** is the actual answer and the most important secret. It is
  **never put in the log until Reveal** — the subject's app holds it in
  `localStorage` keyed by `roundId` (survives a reload) and only emits a `reveal`
  update when the subject taps Reveal.
- **Guesses** broadcast immediately (so the UI can show "3/4 have guessed") but
  are **hidden in every client's UI** until reveal. A determined user inspecting
  raw messages could peek at others' guesses; this is acceptable for a friends'
  game. A true commit–reveal scheme (broadcast `hash(album+nonce)`, reveal later)
  is a documented future upgrade, intentionally out of scope.

## 4. Deck (the curated data)

**124 albums = 4 per year × 31 years (1985–2015).** Per year:

| Slot | Definition |
|---|---|
| `rock` | Top-selling / highest year-end-charting rock album that year |
| `pop` | Top-selling / highest year-end-charting pop album that year |
| `hiphop` | Top-selling / highest year-end-charting hip-hop/rap album that year |
| `gem` | One hand-picked overlooked cult classic from that year |

**Sourcing caveats (surfaced, not hidden):**
- "Top-selling album in genre X for year Y" has no single free API. The three
  famous slots are **hand-resolved** from Billboard year-end genre charts (Top
  R&B/Hip-Hop Albums, Top Rock Albums, Billboard 200) cross-referenced with
  Wikipedia year-end best-seller lists.
- Billboard year-end **genre** charts do not all reach back to 1985 (notably
  year-end "Top Rock Albums" is more recent). For early years the rock/pop slot
  is filled by *"the clearly-genre album highest on that year's overall
  best-sellers list."* "Top-selling" is operationalized as **"year-end chart #1
  or highest-charting in that genre,"** a defensible proxy, not literal RIAA
  sales.
- The `gem` slot is curated by hand (cult classics, critical darlings).

## 5. State & sync model (platform-native core)

All game state is a **pure reduction over the `sendUpdate` log**. The reducer
rebuilds the entire game from the full set of received updates on every change,
so out-of-order delivery, replays, and late joiners are automatically correct and
convergent. The deck is fixed and identical on every client, so album ids resolve
the same everywhere.

**Update types (`payload.type`):**

| Type | Payload | Sent by |
|---|---|---|
| `hello` | `{addr, name}` | every client, once on open (dedup by addr) |
| `round_start` | `{roundId, by, subject, slate:[id,id,id,id]}` | the round starter |
| `guess` | `{roundId, addr, albumId}` | each guesser |
| `reveal` | `{roundId, subject, albumId}` | the subject only |

- `roundId` = `${selfAddr}-${monotonicCounter}` (unique without a server).
- **Roster** = union of all `addr`s seen in any update (plus `hello` for names).
- **Scoring** = for each round that has a `reveal`, each `guess` with
  `albumId === reveal.albumId` grants +1 to that guesser. Idempotent and
  order-independent.
- **No realtime channel.** Persisted updates only; fully async.

`game.js` is a pure, dependency-free function `reduce(updates) -> { roster,
rounds, scores }`. It is the heart of correctness and is unit-tested in isolation.

## 6. Build pipeline (reuses `best-albums-headless-astro`)

Runtime is offline, but **build time has full network access**. A one-time Node
build bakes metadata + artwork into the `.xdc`. It reuses the proven, no-API-key
path from `/home/tmoney/code/starred/best-albums-headless-astro`:

```
deck.json  (124 rows: "Artist — Title", genre slot, year, optional QID override)
   │
   ├─▶ resolve QID via Wikidata wbsearchentities        [new, small]
   │      (rows may pin an explicit QID to disambiguate)
   │
   ├─▶ wikidata.mjs: EntityData/<QID>.json              [reused as-is]
   │      → title (P1448), MBID (P436), release date (P577),
   │        Spotify id (P2205), Apple Music id (P2281), artist (P175→label)
   │
   ├─▶ covers.mjs: downloadCover() from Cover Art Archive [reused as-is]
   │      coverartarchive.org/release-group/<mbid>/front-500
   │      → resizeThumbnail() via sharp, ~256px JPEG → img/<id>.jpg
   │
   └─▶ emit albums.json  →  pack into crate-diggers.xdc
```

- A `User-Agent` header is required by Wikidata and Cover Art Archive.
- If CAA has no cover for an MBID, fall back to the iTunes Search API artwork
  (no key) so every album still gets a cover.
- Target bundle size: **~1–2 MB total**.

`albums.json` row shape:
```json
{
  "id": "1991-rock",
  "artist": "Metallica",
  "title": "Metallica",
  "year": 1991,
  "genre": "rock",
  "img": "img/1991-rock.jpg",
  "spotifyId": "...",        // optional
  "appleId": "...",          // optional
  "links": {                 // precomputed at build time
    "spotify": "https://open.spotify.com/album/...",
    "apple":   "https://music.apple.com/...",
    "youtube": "https://music.youtube.com/search?q=..."
  }
}
```

## 7. Listen links (external browsing)

WebXDC forbids network requests but **allows external `<a href>` links**, which
the host messenger opens in the system browser (with a tap-through). Each album
carries three precomputed listen links:

- **Spotify** — direct (`open.spotify.com/album/<P2205 id>`) when known.
- **Apple Music** — direct via P2281 when known, else a `music.apple.com/search`
  URL built from artist+title.
- **YouTube Music** — always a `music.youtube.com/search?q=…` URL.

Search-URL fallbacks always resolve, so every album gets all three links.

**Where shown:** a tappable **album detail view** (tap any cover → artist /
title / year + three listen buttons) and prominently on the **reveal screen** for
the subject's pick — the discovery payoff, especially for obscure gems. Links say
nothing about the *subject's* taste, so they are harmless to show during play.
Exact tap-through behavior is verified in Delta Chat during testing.

## 8. Architecture / files

```
crate-diggers/
  deck.json            # hand-curated 124-album source (name, genre, year, QID?)
  build/
    resolve.mjs        # deck.json -> QIDs + Wikidata metadata
    fetch-art.mjs      # covers via CAA/iTunes + sharp thumbnails -> albums.json + img/
    lib/wikidata.mjs   # adapted from best-albums-headless-astro
    lib/covers.mjs     # adapted from best-albums-headless-astro
    pack.mjs           # zip src/ -> crate-diggers.xdc
  src/
    index.html
    app.js             # UI + webxdc wiring (sendUpdate / setUpdateListener)
    game.js            # PURE reducer: reduce(updates) -> {roster, rounds, scores}
    styles.css
    albums.json        # generated
    img/               # generated thumbnails
    manifest.toml      # name = "Crate Diggers"
    icon.png
  test/
    game.test.mjs      # reducer unit tests (incl. shuffled-order invariance)
  package.json
```

`game.js` (pure reducer) and `app.js` (effects/UI/webxdc) are separated so the
correctness-critical logic is testable without a webview.

## 9. UI screens

1. **Home / lobby** — title, scoreboard (players + cumulative points), recent
   round history, **New Round** button.
2. **New round setup** — pick subject from roster chips → confirm → emits
   `round_start` with a 4-album slate.
3. **Subject view** — "Which would *you* pick?" 4 covers → tap one → stored
   locally → "waiting for guesses…" with a **Reveal** button.
4. **Guesser view** — "Which would *<subject>* pick?" 4 covers → tap → guess
   locks (hidden) → "waiting for reveal…".
5. **Reveal / results** — subject's pick highlighted, each guesser's guess shown,
   points awarded, listen links on the picked album → back to lobby.
6. **Album detail** (overlay) — artist / title / year + Spotify / Apple /
   YouTube buttons. Reachable by tapping any cover.

## 10. Testing

- **Reducer unit tests** (`test/game.test.mjs`): feed a synthetic update log,
  assert roster / rounds / scores; then replay the same log in multiple shuffled
  orders and assert identical output — proving the order-independence the
  platform requires.
- **Multiplayer dry-run:** `npx webxdc-dev` simulates several peers in the
  browser to playtest real rounds without Delta Chat.
- **Final check:** load `crate-diggers.xdc` in Delta Chat Desktop with a second
  account; verify cross-device sync, the local-held subject pick, reveal scoring,
  and that listen links open externally.

## 11. Out of scope (YAGNI)

- Round rotation / win conditions / game-over (format is endless by design).
- Realtime channel / live presence.
- True cryptographic commit–reveal for guesses (soft UI-hiding is enough).
- In-app audio playback (we link out instead).
- Editing the deck from inside the app (deck is build-time data).
