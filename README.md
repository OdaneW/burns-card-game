# Burns Card Game

A phone-first card game with several game modes, played against computer players, or online with friends:

- **Burns**: follow the suit, draw when you can't, and be the first to empty your hand. Switch on
  **Real Burns** for friends in the same room: everyone who empties their hand is safe, play goes on until one
  player is left holding cards, and then each winner shuffles while the loser calls "Stop!", the loser names a
  suit, and cards are turned over until it appears. Every card before it is a slap on the loser's hand: soft
  for black, hard for red.
- **Pass-Roun Donkey**: pass one card round the circle, collect four of a kind, and never be last
  to put your cards down, or you collect a letter of DONKEY.
- **Bull**: the whole deck is dealt round a circular table. Play one to four cards face down as the next
  rank (Aces, then 2s, up to Kings and round again), bluff when you have to, and call "Bull!" on anyone
  you think is lying. Whoever is wrong picks up the pile. A rule choice turns over the bluffs nobody called.
- **Strip-Me**: two players, 26 cards each, face down. Take turns turning over your top card. A Jack, Queen,
  King or Ace makes the other player pay 1, 2, 3 or 4 cards; turn up one of those while paying and the payment
  switches back. Pay in full and you pick up the whole pile under your deck. Play your last card to win the
  round: the loser's cartoon avatar loses a garment, and you choose how many losses (2 to 5) end the game.
  Quick Play is a single round. Add a round timer if you like: when time's up, whoever has more cards loses
  the round.

**Play:** https://odanew.github.io/burns-card-game/

## Play with friends online

On the home screen, **Play with friends** makes a room with a four-letter code. Share the invite link (or
the code), and everyone plays on their own phone. The host picks the game, the number of seats and the rule
choices; computer players take any empty seats. If someone's connection drops, a computer player looks after
their seat until they're back, and the app reconnects by itself.

The chat button, in the room and at the table, opens the chat and eight quick reactions: laughing, crying,
sad, shocked, angry, love, cool and sleepy. A reaction pops up, moving, over the sender's seat on everyone's
screen (or by their name in the room), and a new message pops up for a moment by whoever sent it. Anyone who
joins or comes back sees the last 40 messages.

## Friends and the leaderboard

**Friends** on the home screen shows your friend code (like `K7PQ-2MXD`). Share it, or your invite link, and
type your friends' codes to add them; in an online room, tap **Add** next to anyone who isn't a friend yet.
Adding someone puts you on each other's list straight away, and removing works both ways too.

The leaderboard ranks you and your friends in each game, or in every game together: by wins, win % (from
5 games), games played and best winning streak, and by what each game counts: sets won, Flushes and Real Burns slaps in Burns,
fours of a kind and the fastest put-down in Donkey, bluffs caught and Bull calls that were right in Bull, rounds
and garments won in Strip-Me. Tap anyone for the two of you side by side, with everything the game counts.
It counts every game, against the computer too, or switch to **Online only**.

Each phone keeps its own record and sends it to the server after every game, so friends see it. You are your
phone (there are no accounts): clearing the app's data or changing phones starts a new code and an empty list.

## Install it on an Android phone

1. Open the link above in Chrome.
2. Tap the **⋮** menu, then **Install app** (on some phones it says **Add to Home screen**).
3. Open it from its icon. It runs full screen and works offline.

When a new version is published, the app shows **A new version is ready**. Tap **Update**.
A game in progress is saved first, so you can resume it. The version and build number are
at the bottom of the menu screen.

## How the code is organised

| Path | What it does |
| --- | --- |
| `src/engine/core.js` | Cards, deck, seeded randomness and the game-mode registry |
| `src/engine/session.js` | Runs one game: clock, actions, timed steps, computer players, save and restore; counts each player's stats as it goes (the mode's `stats.count`) |
| `src/engine/standings.js` | Each phone's record of its games (wins, streaks and the game's own counts, online games again on their own) and the friends leaderboard |
| `src/modes/burns/rules.js` | The Burns rules and its rule choices, including Real Burns and its penalty round. Pure logic, no screen code |
| `src/modes/burns/bot.js` | The Burns computer player. It only sees what a human player would see |
| `src/modes/burns/ui.js` | The Burns table screen, and the Real Burns penalty round |
| `src/modes/burns/tutorial.js` | The interactive Burns tutorial: six rigged lessons on the real table, and an extra one on Real Burns |
| `src/modes/donkey/rules.js` | The Pass-Roun Donkey rules: passing, four of a kind, the race, letters and the tie-breaker |
| `src/modes/donkey/bot.js` | The Donkey computer player, with three reflex speeds for the race |
| `src/modes/donkey/ui.js` | The Donkey table screen: four seats round a table |
| `src/modes/donkey/tutorial.js` | The interactive Donkey tutorial: five rigged lessons on the real table |
| `src/modes/bull/rules.js` | The Bull rules: dealing the whole deck, the rank sequence, face-down plays, calling Bull and the last-card call |
| `src/modes/bull/bot.js` | The Bull computer player: when to bluff, and when to call Bull from the cards it has seen |
| `src/modes/bull/ui.js` | The Bull table screen: three to six seats round an oval table |
| `src/modes/bull/tutorial.js` | The interactive Bull tutorial: five rigged lessons on the real table, from your first play to calling Bull and winning |
| `src/modes/stripme/rules.js` | The Strip-Me rules: the deal, Action Cards and payments, picking up the pile, rounds and garments, the round timer, the shuffle and autopilot |
| `src/modes/stripme/bot.js` | The Strip-Me computer player: it turns cards over at a human pace and sometimes shuffles |
| `src/modes/stripme/ui.js` | The Strip-Me table screen: two avatars that lose a garment for each round they lose, the round's clock, Auto and the shuffle |
| `src/modes/stripme/tutorial.js` | The interactive Strip-Me tutorial: five rigged lessons on the real table against Mia |
| `src/ui/kit.js` | Shared screen pieces: cards, animations, sound effects, storage |
| `src/ui/music.js` | Background music, composed live in the browser (no audio files) |
| `src/ui/coach.js` | The tutorial's speech bubble and spotlight, usable by any mode |
| `src/ui/tutorial.js` | The lesson runner every tutorial uses: steps, waiting for the player, notes held until read, Previous, and extra lessons for rule choices |
| `src/net/online.js` | The link to the game server: reconnecting, keeping the clock in step, and a remote session the table screens use like a local one |
| `src/ui/online.js` | Play with friends: creating and joining rooms, the lobby, and the online menu and results |
| `src/ui/social.js` | Chat and quick reactions in online rooms: the chat panel, the drawn reaction faces, and pop-ups by each player's seat |
| `src/ui/friends.js` | Friends: your friend code, adding friends (by code, invite link or in a room), the leaderboard and comparing two players |
| `src/ui/app.js` | Menu, setup screen, sheets, saving and the game loop |
| `src/ui/styles.css` | Look and layout |
| `src/shell/body.html` | Page markup and the suit icons |
| `src/assets/` | Fonts (SIL Open Font License) and app icons |
| `build.js` | Builds `docs/` (the installable app) and `dist/burns.html` (a single-file preview) |
| `docs/` | The built app that GitHub Pages serves. Generated by `build.js`; don't edit it by hand |
| `server/` | The online game server: a Cloudflare Worker with one Durable Object per room (`src/room.js` holds the room and its chat, `src/worker.js` the platform side), running the same engine and modes, and one more for every player's friends and stats (`src/players.js`) |

## Adding a game mode

1. Create `src/modes/<mode>/rules.js` and register the mode with `CT.registerMode({...})`.
   Burns shows the shape: `createGame`, `act`, `tick`, `view`, `rules`, and an `options` list
   for rule choices.
2. Add a computer player (`bot.js`) and a table screen (`ui.js`), reusing pieces from Burns where they fit.
3. Optionally, add an interactive tutorial (`tutorial.js`): lessons for `UI.makeTutorial`, registered in
   `UI.tutorials`. How to play then offers it automatically, and so does Play, once, for someone new to the mode.
   A lesson marked `extra: true` (for a rule choice, like Real Burns) isn't counted: the last note offers it,
   and How to play can start it on its own.
4. Optionally, give the mode `stats`: `count(tally, event)` adds up what each player did from the game's
   events (with `CT.tally.add` or `CT.tally.best`), and `show` lists those counts with a label and a short
   `help`. Ones marked `rank: true` appear on the leaderboard; `low: true` means fewer is better.
5. Add the new files to `SOURCES` in `build.js`, and the rules and computer player to `server/src/engine.js`
   so online rooms can play it. Phones on an app without the mode are asked to update when they join its room.

The menu lists every registered mode, and each mode's rule choices appear on its setup screen automatically.
The setup screen saves only the choices a player actually taps, so changing an option's `default` in an
update reaches everyone who left that option alone.

## Developing

Needs Node 18 or newer. The app has no dependencies; the server uses Cloudflare's `wrangler`.

```sh
npm test         # rule scenarios, simulated all-bot games for each mode, stats and the leaderboard, online rooms and friends
npm run build    # rebuild docs/ and dist/
```

For each release: bump `version` in `package.json`, run the tests, build, and commit `docs/` with the source.
GitHub Pages republishes within a minute or two, and installed copies offer the update.

### The game server

`server/` deploys to Cloudflare from GitHub Actions (`.github/workflows/server.yml`) whenever it, or the rules
and computer players it runs, change. The workflow needs two repository secrets: `CLOUDFLARE_API_TOKEN` (an API
token made from the *Edit Cloudflare Workers* template) and `CLOUDFLARE_ACCOUNT_ID`. After deploying, it plays a
game against the live server, and two test players add and remove each other as friends (`server/check.mjs`). The app connects to the address in `package.json` (`server`).

To run it locally: `cd server && npm install && npm run dev`, then point the app at it by setting
`localStorage['cardtable.server'] = '"ws://localhost:8787"'` in the browser console.
`node test/online.test.mjs` tests the room logic with pretend phones, and `node test/ui-run.js <dir> online`
plays through the screens with two phones against the local server (`online-burns` and `online-bull` use three,
and `online-stripme` plays Strip-Me with one phone on Auto that drops off for a while; `online-chat` and
`online-chat-tables` try the chat and reactions in the room and at each game's table; `friends` adds friends
by code, by invite link and in a room, and goes through the leaderboard with three phones).
`node test/players.test.mjs` tests friend codes and lists, and `node test/stats.test.js` and
`node test/standings.test.js` the stats each game counts and the leaderboard.

A room's rules version must match the app's: when a mode's rules change in a way that affects saved or online
games, bump its `ENGINE_VERSION`, and phones on an older app are asked to update.

Optional tools, which need Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`):
`npm run ui-test` plays a game through the screen at phone size and saves screenshots to `test/shots/`,
and `npm run icons` redraws the app icons from `tools/make-icons.js`.
