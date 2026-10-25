/* ==========================================================================
   GAME MODE · PASS-ROUN DONKEY — computer player
   Sees only what a person in that seat would see (its view). Keeps the rank
   it holds most of and passes on its loosest card; puts four of a kind down
   after a short, human-looking pause; reacts to someone else's four with a
   reflex drawn from the chosen speed; in a tie-breaker, makes the call most
   likely to be right.
   ========================================================================== */
(function (CT) {
  'use strict';
  var Donkey = CT.getMode('donkey');

  /* Reaction to someone putting four down, in ms after the race starts:
     base + up to spread, and now and then a slow moment. */
  var REFLEX = {
    relaxed: { base: 560, spread: 420, slip: 0.12, slipBase: 500, slipSpread: 800 },   // ~0.8 s
    normal: { base: 380, spread: 260, slip: 0.07, slipBase: 300, slipSpread: 600 },    // ~0.55 s, an alert person
    sharp: { base: 280, spread: 160, slip: 0.04, slipBase: 250, slipSpread: 400 }      // ~0.4 s
  };

  function reflex(v, rnd) {
    var r = REFLEX[v.options && v.options.reflexes] || REFLEX.normal;
    var ms = r.base + rnd() * r.spread;
    if (rnd() < r.slip) ms += r.slipBase + rnd() * r.slipSpread;
    return ms;
  }

  function counts(hand) {
    var n = {};
    hand.forEach(function (c) { n[c.rank] = (n[c.rank] || 0) + 1; });
    return n;
  }

  function pickOf(list, rnd) { return list[Math.floor(rnd() * list.length)]; }

  /* Collect the rank held most (sticking with the current aim on a tie);
     pass a card of the rank held least. */
  function choosePass(v, memory, rnd) {
    if (memory.round !== v.round) { memory.round = v.round; memory.target = null; }
    var n = counts(v.hand);
    var ranks = Object.keys(n);
    var most = Math.max.apply(null, ranks.map(function (r) { return n[r]; }));
    var top = ranks.filter(function (r) { return n[r] === most; });
    var target = top.indexOf(memory.target) >= 0 ? memory.target : pickOf(top, rnd);
    memory.target = target;
    var others = v.hand.filter(function (c) { return c.rank !== target; });
    if (!others.length) return pickOf(v.hand, rnd);
    var fewest = Math.min.apply(null, others.map(function (c) { return n[c.rank]; }));
    return pickOf(others.filter(function (c) { return n[c.rank] === fewest; }), rnd);
  }

  var bot = {
    intent: function (v) {
      if (v.canDeclare) return { key: 'declare:' + v.round, kind: 'declare' };
      if (v.canPass) return { key: 'pass:' + v.round + ':' + v.passes, kind: 'pass' };
      if (v.canReact) return { key: 'react:' + v.round, kind: 'react' };
      if (v.canChallenge) return { key: 'challenge:' + v.tiebreak.duel.n, kind: 'challenge' };
      if (v.canCall) return { key: 'call:' + v.tiebreak.duel.n, kind: 'call' };
      return null;
    },

    delay: function (intent, v, rnd) {
      switch (intent.kind) {
        case 'declare': return 500 + rnd() * 700;
        case 'pass': return 650 + rnd() * 850;
        case 'react': return reflex(v, rnd);
        case 'challenge': return 1100 + rnd() * 900;
        case 'call': return 1300 + rnd() * 1100;
      }
      return 800;
    },

    decide: function (v, memory, rnd) {
      if (v.canDeclare) return { type: 'declare' };
      if (v.canPass) return { type: 'pass', payload: { cardId: choosePass(v, memory, rnd).id } };
      if (v.canReact) return { type: 'react' };
      if (v.canChallenge) {
        var rivals = v.tiebreak.duel.players.filter(function (pid) { return pid !== v.me; });
        return { type: 'challenge', payload: { target: pickOf(rivals, rnd) } };
      }
      if (v.canCall) return { type: 'call', payload: { call: Donkey.bestCall(v.tiebreak.duel.myCard, rnd()) } };
      return null;
    },

    choosePass: choosePass,
    reflex: reflex
  };

  Donkey.bot = bot;
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
