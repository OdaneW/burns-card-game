/* ==========================================================================
   CARD TABLE ENGINE · core
   Mode-agnostic building blocks shared by every game mode:
   cards and decks, a seedable random source kept inside the game state,
   and the registry that game modes plug into.
   Works in the browser (attaches to window.CT) and in Node (globalThis.CT).
   ========================================================================== */
(function (CT) {
  'use strict';

  /* ---------- Cards ------------------------------------------------------ */

  // Display order alternates colours so a sorted hand is easy to read.
  var SUITS = ['S', 'H', 'C', 'D'];
  var SUIT_INFO = {
    S: { name: 'Spades', single: 'spade', color: 'black' },
    H: { name: 'Hearts', single: 'heart', color: 'red' },
    C: { name: 'Clubs', single: 'club', color: 'black' },
    D: { name: 'Diamonds', single: 'diamond', color: 'red' }
  };
  var RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  var RANK_NAMES = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };

  function makeCard(rank, suit) {
    return { id: rank + suit, rank: rank, suit: suit };
  }

  /** A fresh, ordered 52-card deck. */
  function standardDeck() {
    var deck = [];
    SUITS.forEach(function (s) {
      RANKS.forEach(function (r) { deck.push(makeCard(r, s)); });
    });
    return deck;
  }

  /** 2 → 1 … K → 12, A → 13 (or 0 when aces are low). */
  function rankValue(rank, aceHigh) {
    if (rank === 'A' && aceHigh === false) return 0;
    return RANKS.indexOf(rank) + 1;
  }

  function cardName(card) {
    return (RANK_NAMES[card.rank] || card.rank) + ' of ' + SUIT_INFO[card.suit].name;
  }

  function hasSuit(hand, suit) {
    for (var i = 0; i < hand.length; i++) if (hand[i].suit === suit) return true;
    return false;
  }

  /* ---------- Randomness ------------------------------------------------- *
   * The generator's state lives on the game state (state.rng), so a saved or
   * transmitted game replays exactly. mulberry32.                            */

  function rand(state) {
    var a = (state.rng + 0x6D2B79F5) | 0;
    state.rng = a >>> 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(arr, state) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand(state) * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function pickRandom(arr, state) {
    return arr[Math.floor(rand(state) * arr.length)];
  }

  /** Stand-alone generator for things outside the rules (bot timing, names). */
  function makeRng(seed) {
    var box = { rng: (seed >>> 0) || 1 };
    return function () { return rand(box); };
  }

  /* ---------- Results ---------------------------------------------------- */

  function ok(extra) {
    var r = { ok: true };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }

  function fail(code, message, extra) {
    var r = { ok: false, code: code, message: message };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }

  /* ---------- Game-mode registry ----------------------------------------- *
   * A mode is a plain object:
   *   id, name, tagline, players {min,max,default}, options [ ... ],
   *   rules(options)            → [{ title, text }]   (shown in How to play)
   *   createGame(config)        → state               (JSON-serialisable)
   *   act(state, pid, type, payload, now) → { ok, code?, message? }
   *   tick(state, now)          → true when the state changed
   *   view(state, pid, opts)    → what that one player is allowed to see
   *   bot                       → { intent(view), delay(intent, view, rnd), decide(view, memory, rnd) }
   *   presenter                 → id of the table UI that draws this mode
   * ------------------------------------------------------------------------ */

  var modes = [];

  function registerMode(def) {
    ['id', 'name', 'createGame', 'act', 'tick', 'view'].forEach(function (key) {
      if (!def[key]) throw new Error('Game mode is missing "' + key + '"');
    });
    modes = modes.filter(function (m) { return m.id !== def.id; });
    modes.push(def);
    return def;
  }

  function getMode(id) {
    for (var i = 0; i < modes.length; i++) if (modes[i].id === id) return modes[i];
    return null;
  }

  function listModes() { return modes.slice(); }

  /** Fill in defaults for a mode's option schema and drop unknown values. */
  function resolveOptions(schema, given) {
    var out = {};
    (schema || []).forEach(function (opt) {
      var v = given ? given[opt.id] : undefined;
      var valid = opt.choices.some(function (c) { return c.value === v; });
      out[opt.id] = valid ? v : opt.default;
    });
    return out;
  }

  /* ---------- stats counted as a game is played ---------------------------
     A mode may give `stats`: { count(tally, event, state), show: [...] }.
     The Session calls count() with each new event, and it adds to
     tally[pid]. `show` says what the records and the leaderboard display:
       { key, label, help (what it counts, in a line), rank: true (on the
         leaderboard), low: true (fewer is better), best: 'min' (the best
         single game rather than a total), rate: [part, whole] (a
         percentage), min (how many before a rate ranks), unit, note } */
  function tallyAdd(t, pid, key, n) {
    if (pid == null) return;
    var p = t[pid] || (t[pid] = {});
    p[key] = (p[key] || 0) + (n == null ? 1 : n);
  }
  function tallyBest(t, pid, key, v, how) {
    if (pid == null || typeof v !== 'number' || !isFinite(v)) return;
    var p = t[pid] || (t[pid] = {});
    if (p[key] == null || (how === 'max' ? v > p[key] : v < p[key])) p[key] = v;
  }

  /* A rule choice that only matters with another one (showIf: { mode: 'strip' })
     is left off the setup screen otherwise. */
  function optionShown(opt, values) {
    if (!opt.showIf) return true;
    return Object.keys(opt.showIf).every(function (k) { return values && values[k] === opt.showIf[k]; });
  }

  CT.SUITS = SUITS;
  CT.SUIT_INFO = SUIT_INFO;
  CT.RANKS = RANKS;
  CT.makeCard = makeCard;
  CT.standardDeck = standardDeck;
  CT.rankValue = rankValue;
  CT.cardName = cardName;
  CT.hasSuit = hasSuit;
  CT.rand = rand;
  CT.shuffle = shuffle;
  CT.pickRandom = pickRandom;
  CT.makeRng = makeRng;
  CT.ok = ok;
  CT.fail = fail;
  CT.registerMode = registerMode;
  CT.getMode = getMode;
  CT.listModes = listModes;
  CT.resolveOptions = resolveOptions;
  CT.optionShown = optionShown;
  CT.tally = { add: tallyAdd, best: tallyBest };
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
