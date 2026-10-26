/* ==========================================================================
   GAME MODE · BULL — computer player
   Sees only what a person in that seat would see (its view). Plays its true
   cards when it has them, now and then slipping in an extra; with nothing
   true to play, it bluffs with the cards it will need least soon. It calls
   Bull when a claim can't be true (it holds too many of that rank itself),
   and otherwise when a claim looks unlikely, more readily when the player is
   close to winning and less when the pile it might pick up is big.
   ========================================================================== */
(function (CT) {
  'use strict';
  var Bull = CT.getMode('bull');
  var RANKS = Bull.ranks;

  var SKILL = {
    easy: { spot: 0.7, bar: 0.78, memory: false, extra: 0.05, react: [1000, 1900] },
    normal: { spot: 1, bar: 0.68, memory: true, extra: 0.12, react: [750, 1600] },
    sharp: { spot: 1, bar: 0.58, memory: true, extra: 0.2, react: [600, 1300] }
  };
  function skill(v) { return SKILL[v.options && v.options.bots] || SKILL.normal; }

  /* A steady random number for this seat and this play, so a decision made
     on one look at the table is the same on the next. */
  function coin(v, salt) {
    var s = v.me + ':' + salt, h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10007) / 10007;
  }

  function choose(n, k) {
    if (k < 0 || k > n) return 0;
    var r = 1;
    for (var i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return r;
  }

  /* How likely the last claim is a lie, from what this seat knows. Most
     people play every true card they have, sometimes slipping in one extra,
     and bluff with a single card when they have none. So: how likely were
     they to hold that many of the rank, given how many cards they had and
     how many of the rank this seat knows are elsewhere (its own hand, and
     what it put on the pile)? */
  var BLUFF2 = 0.15, EXTRA = 0.12;
  function lieChance(v, k) {
    var last = v.last, n = last.n;
    var known = v.hand.filter(function (c) { return c.rank === last.rank; }).length;
    var mine = v.hand.length;
    if (k.memory) {
      var pile = v.myPileCards || [];
      known += pile.filter(function (c) { return c.rank === last.rank; }).length;
      mine += pile.length;
    }
    var left = 4 - known;
    if (left < n) return 1;                                       // can't be true: the rest are mine
    var accused = v.players.filter(function (p) { return p.id === last.by; })[0];
    var unseen = 52 - mine;
    var had = Math.min(unseen, (accused ? accused.handCount : 0) + n);
    var total = choose(unseen, had);
    var held = function (j) { return total ? choose(left, j) * choose(unseen - left, had - j) / total : 0; };
    var truth = held(n), lie;
    if (n === 1) lie = held(0) * (1 - BLUFF2);
    else if (n === 2) lie = held(0) * BLUFF2 + held(1) * EXTRA;
    else lie = held(n - 1) * EXTRA;
    return lie + truth ? lie / (lie + truth) : 0.5;
  }

  function wantsBull(v) {
    if (!v.canBull || !v.last) return false;
    var k = skill(v), last = v.last;
    var lie = lieChance(v, k);
    if (lie >= 1) return coin(v, last.no + 'x') < k.spot;
    // their last cards: if it's true they've won anyway, so calling costs nothing
    if (v.phase === 'lastcall') return coin(v, last.no + 'L') < (k.memory ? 1 : 0.8);
    var accused = v.players.filter(function (p) { return p.id === last.by; })[0];
    var bar = k.bar + Math.min(0.15, v.pileCount * 0.006)           // a big pile makes a wrong call costly
      + 0.05 * Math.max(0, v.players.length - 4);                   // more of us watching: leave it to the surest
    if (accused && accused.handCount <= 2) bar -= 0.15;             // nearly out: worth the risk
    return lie + (coin(v, last.no) - 0.5) * 0.16 > bar;
  }

  /* How many of my own turns until each rank is mine to play (0: now). */
  function turnsUntil(v) {
    var n = v.players.length, out = {};
    RANKS.forEach(function (r, ri) {
      for (var t = 0; t < 13; t++) if ((v.rankIdx + t * n) % 13 === ri) { out[r] = t; return; }
      out[r] = 13;
    });
    return out;
  }

  function choosePlay(v, memory, rnd) {
    var k = skill(v), want = v.rank, hand = v.hand;
    var until = turnsUntil(v);
    var spare = hand.filter(function (c) { return c.rank !== want; })
      .sort(function (a, b) { return (until[b.rank] - until[a.rank]) || (rnd() - 0.5); });
    var have = hand.filter(function (c) { return c.rank === want; }).slice(0, 4);
    if (have.length) {
      var cards = have.slice();
      // now and then slip in a card that won't be needed for a long while
      if (cards.length < 4 && spare.length > 2 && rnd() < k.extra) cards.push(spare[0]);
      return cards.map(function (c) { return c.id; });
    }
    // nothing true to play: bluff, usually with one card
    var count = hand.length >= 6 && rnd() < 0.15 ? 2 : 1;
    return spare.slice(0, count).map(function (c) { return c.id; });
  }

  var bot = {
    intent: function (v) {
      if (wantsBull(v)) return { key: 'bull:' + v.last.no, kind: 'bull' };
      if (v.canPlay) return { key: 'play:' + v.plays + ':' + v.turn + ':' + v.pileCount, kind: 'play' };
      return null;
    },

    delay: function (intent, v, rnd, now) {
      var k = skill(v);
      if (intent.kind === 'bull') return k.react[0] + rnd() * (k.react[1] - k.react[0]);
      // wait out everyone's moment to call Bull, then think
      var wait = (v.openAt != null && now != null) ? Math.max(0, v.openAt - now) : 0;
      return wait + 700 + rnd() * 1500;
    },

    decide: function (v, memory, rnd) {
      if (wantsBull(v)) return { type: 'bull' };
      if (v.canPlay) return { type: 'play', payload: { cardIds: choosePlay(v, memory, rnd) } };
      return null;
    },

    wantsBull: wantsBull,
    lieChance: function (v) { return lieChance(v, skill(v)); },
    choosePlay: choosePlay
  };

  Bull.bot = bot;
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
