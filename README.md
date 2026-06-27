# Crate Diggers 🎧

A tiny **WebXDC** party game for [Delta Chat](https://delta.chat): *how well do
you know your friends' taste in music?*

Each round one player is the **digger**. The app shows them 4 random albums from
a 124-album deck (1985–2015); they secretly pick the one they'd most enjoy.
Everyone else guesses which one. Correct guess = **+100**. Scores pile up forever.
The deck mixes the era's chart-toppers with cult deep cuts, so some rounds are
gimmes and some are wild cards.

It runs entirely inside the chat — **no server, no network at runtime.** All
game state is reconstructed from the messages players send, so it works offline,
async (a round can sit for hours), and across any number of people.

## How a round works

1. Anyone taps **New Round** and picks the digger (yourself is allowed).
2. The digger sees 4 covers and secretly taps their pick — held on their device,
   **never sent** until they reveal.
3. Everyone else taps their guess — guesses show up **live** for the whole group
   as they roll in (only the digger's own pick stays secret until reveal).
4. The digger taps **Reveal** → the pick is shown and correct guessers score +100.
5. Tap any cover for an **album detail** card with Spotify / Apple Music /
   YouTube Music links — great for discovering the obscure ones.

## Build it

Runtime is offline, but the build needs network to fetch cover art + links.

```sh
npm install
npm run build    # the whole thing: fetch art + links, then zip -> crate-diggers.xdc
```

That's the deploy artifact — see [Deploy](#deploy) below. `build` runs two steps
you can also invoke on their own:

```sh
npm run art      # deck.json -> src/albums.json + src/albums.js + src/img/*.jpg
npm run pack     # zip src/ -> crate-diggers.xdc
npm test         # (optional) unit-tests the pure reducer (incl. order-independence)
npm run icon     # (optional) regenerate src/icon.png — already committed
```

- **Artwork + the direct Apple Music link** come from the iTunes Search API (no
  key), with retry/backoff for its rate limit.
- Albums iTunes doesn't carry (older indie/rap) fall back to **Cover Art Archive
  via MusicBrainz**; anything still missing gets a neutral placeholder so the
  build never fails on one row.
- **Spotify and YouTube Music** links are search URLs (no reliable public id
  lookup); Apple is direct. Every album always has all three.
- The art step is **resumable** — covers already fetched are skipped, so if
  iTunes rate-limits you, just run `npm run build` again until it reports 0
  placeholders.

Edit `deck.json` and re-run `npm run build` to rebuild the deck and repack.

## Deploy

A WebXDC app has **no server** — "deploying" just means handing people the `.xdc`:

1. `npm run build` → **`crate-diggers.xdc`** (~2 MB) at the project root.
2. In Delta Chat, open the group (or your own "Saved Messages"), attach
   `crate-diggers.xdc` like any file, and send it.
3. Everyone taps it to launch and play; game state syncs as ordinary chat
   messages. No install, no accounts, works offline.

Ship a new version by re-running `npm run build` and sending the new `.xdc`.

**Carrying scores across versions.** Each `.xdc` you send is a *separate* game
instance with its own state — the new build starts with an empty scoreboard, and
WebXDC gives no way to auto-read the old instance's state. To keep a running
tally, use the **Save scores** / **Load scores** buttons (lobby and results):
*Save* copies the current scoreboard as a small blob; paste it into the new
version with *Load* and those points are seeded in. Imports are idempotent (each
export is tagged, so loading the same blob twice never double-counts).

## Browse the deck

```sh
npm run gallery    # generates gallery.html from src/albums.json
```

`npm run gallery` writes **`gallery.html`** at the project root — a visual contact
sheet of all 124 covers, grouped by year and color-coded by genre (rock / pop /
hip-hop / gem). Open it in a browser to eyeball the whole deck; tap any cover to
open the album in Apple Music. It points at `src/img/`, so run `npm run art` (or
`npm run build`) first. It's a browse tool only — it is never packed into the
`.xdc`.

## Playtest with a simulated friend

You don't need Delta Chat or a second phone to test multiplayer.

### Option A — `webxdc-dev` (recommended)

Simulates several peers, each in its own browser tab, talking to one another:

```sh
npm run art             # make sure src/albums.js exists first
npx webxdc-dev run src
```

Open the URL it prints. It gives you multiple simulated devices — use one tab as
the digger and the others as guessers. Start a round, pick, guess across tabs,
reveal, and watch the scoreboard update live. This exercises the real WebXDC
update gossip, including out-of-order delivery.

### Option B — two browser tabs (quick & dirty)

The app loads a built-in **local shim** for `window.webxdc` that relays updates
between tabs of the same browser via `localStorage`. Identity is per-tab, so two
tabs are two different players sharing one game:

```sh
npm run art
npx serve src      # or: python3 -m http.server -d src 8000
```

Open the served URL in two tabs. To pin who's who, add `?as=`:
`…/?as=alice` in one tab and `…/?as=bob` in the other. Start a round in one,
guess in the other, reveal, watch the score. Cruder than `webxdc-dev` but enough
to click through a full round yourself.

### Option C — real Delta Chat

Send `crate-diggers.xdc` into any Delta Chat group (or a self-chat with a second
account / the [Delta Chat Desktop](https://delta.chat/) "Saved Messages"), tap to
launch, and play for real. Add a second account to verify cross-device sync, the
locally-held secret pick, and that the listen links open in your browser.

## Project layout

```
deck.json            # 124 curated albums (artist, title, year, genre slot)
build/
  fetch-art.mjs      # deck.json + network -> albums.json + albums.js + img/
  lib/{itunes,musicbrainz,covers}.mjs
  make-icon.mjs      # generates src/icon.png
  pack.mjs           # zips src/ -> crate-diggers.xdc
src/
  index.html app.js styles.css   # the app
  game.js            # PURE reducer: reduce(updates) -> {roster, rounds, scores}
  webxdc-shim.js     # local fallback host (no-op under a real host)
  manifest.toml icon.png
  albums.json albums.js img/      # generated by `npm run build`
test/
  game.test.mjs itunes.test.mjs
docs/superpowers/    # design spec + implementation plan
```

## Design notes

- **`game.js` is pure and order-independent.** WebXDC gives no global message
  order and replays history to late joiners, so state is rebuilt from scratch on
  every update and never depends on arrival order. A test feeds the same log in
  several shuffled orders and asserts identical scores.
- **The digger's pick is the only real secret** and is never broadcast before
  reveal. Guesses are broadcast but UI-hidden; a determined packet-sniffer could
  peek, which is fine for a friends' game. (A cryptographic commit–reveal would
  close that — intentionally out of scope.)
- The deck's "top-selling rock/pop/hip-hop per year" is a hand-resolved proxy
  from Billboard year-end / Wikipedia charts, not literal sales — see
  `docs/superpowers/specs/`.
