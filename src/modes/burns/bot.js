/* ==========================================================================
   GAME MODE · BURNS — computer players
   A bot only ever sees its own view (the same one a human gets), so it can't
   peek at hands or the deck. It counts cards that have been revealed and
   estimates which suits opponents are likely to be short of.
   ========================================================================== */
(function (CT) {
  'use strict';

  function val(card) { return CT.rankValue(card.rank, true); }

  function seenIds(v) {
    var seen = {};
    v.discard.forEach(function (c) { seen[c.id] = true; });
    v.hand.forEach(function (c) { seen[c.id] = true; });
    v.table.forEach(function (e) { if (e.card) seen[e.card.id] = true; });
    return seen;
  }

  /* How many cards of this suit that could beat `card` are still unaccounted for. */
  function unseenHigher(card, seen) {
    var n = 0;
    CT.RANKS.forEach(function (r) {
      if (!seen[r + card.suit] && CT.rankValue(r, true) > val(card)) n++;
    });
    return n;
  }

  /* Chance that a hand of `size` unseen cards holds none of `suit`. */
  function chanceShort(suit, size, seen) {
    var unseen = 52 - Object.keys(seen).length;
    var unseenSuit = 13;
    CT.RANKS.forEach(function (r) { if (seen[r + suit]) unseenSuit--; });
    if (unseen <= 0 || size <= 0) return 0;
    var p = 1;
    for (var i = 0; i < size; i++) p *= Math.max(0, unseen - unseenSuit - i) / Math.max(1, unseen - i);
    return p;
  }

  function me(v) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === v.me) return v.players[i];
    return null;
  }

  function chooseLead(v, rnd) {
    var opps = v.players.filter(function (p) { return p.id !== v.me; });
    var seen = seenIds(v);
    var deckEmpty = v.deckCount === 0;
    var bySuit = {};
    v.hand.forEach(function (c) { (bySuit[c.suit] = bySuit[c.suit] || []).push(c); });

    var best = null, bestScore = -Infinity;
    v.hand.forEach(function (c) {
      var score = 0;
      // Opponents likely to be short of this suit will have to draw (or pick up).
      var forced = 0;
      opps.forEach(function (o) { forced += chanceShort(c.suit, o.handCount, seen); });
      score += forced * (deckEmpty ? 1.2 : 2.2);
      var higher = unseenHigher(c, seen);
      var sure = higher === 0;
      score += sure ? 3 : Math.max(0, 1.5 - higher * 0.6);
      var count = bySuit[c.suit].length;
      if (count === 1 && v.hand.length > 2) score -= 1.6;  // don't open a gap in my own hand
      score += (count - 1) * 0.25;
      if (!sure) score -= val(c) * 0.05;                  // save high cards that won't win anyway
      if (v.hand.length === 2 && sure) score += 3;          // win this, then lead my last card
      score += (rnd() - 0.5) * 0.8;
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return best;
  }

  function suited(v) {
    return v.hand.filter(function (c) { return c.suit === v.suit; }).sort(function (a, b) { return val(a) - val(b); });
  }

  function toBeat(v) {
    var t = 0;
    v.table.forEach(function (e) { if (e.card && e.owner && e.owner !== v.me) t = Math.max(t, val(e.card)); });
    return t;
  }

  function chooseFollow(v, rnd) {
    var mine = suited(v);
    var seen = seenIds(v);
    var beat = toBeat(v);
    var sure = mine.filter(function (c) { return val(c) > beat && unseenHigher(c, seen) === 0; });
    if (sure.length) return sure[0];
    var top = mine[mine.length - 1];
    if (v.hand.length <= 3 && val(top) > beat) return top;   // close to going out: chase the lead
    if (rnd() < 0.12) return mine[Math.floor(rnd() * mine.length)];
    return mine[0];
  }

  /* Found the suit while drawing: play the best one, or draw again hoping for
     a winner. Every extra draw stays in the hand, so don't push it far. */
  function playOrKeepDrawing(v, memory, rnd) {
    if (memory.set !== v.setNo) { memory.set = v.setNo; memory.matchAt = null; }
    var drew = me(v).drew;
    if (memory.matchAt == null) memory.matchAt = drew;
    var extra = drew - memory.matchAt;
    var mine = suited(v);
    var best = mine[mine.length - 1];
    var seen = seenIds(v);
    var play = { type: 'follow', payload: { cardId: best.id } };
    if (val(best) > toBeat(v) && unseenHigher(best, seen) === 0) return play;  // already a sure winner
    if (v.deckCount < 3 || extra >= 2 || val(best) >= 10 || v.hand.length >= 9) return play;
    var keepGoing = val(best) <= 6 ? 0.5 : 0.25;
    return rnd() < keepGoing ? { type: 'draw', payload: {} } : play;
  }

  function chooseTake(v, rnd) {
    var open = v.table.filter(function (e) { return e.card && !e.takenBy; })
      .sort(function (a, b) { return val(b.card) - val(a.card); });
    if (!open.length) return null;
    if (open.length > 1 && rnd() < 0.1) return open[1].card;
    return open[0].card;
  }

  var BurnsBot = {
    /* What this bot needs to do right now; the key changes whenever a new decision is due. */
    intent: function (v) {
      var drew = v.canDraw || v.canFollow ? me(v).drew : 0;
      if (v.canLead) return { kind: 'lead', key: 'L' + v.setNo };
      if (v.mustDraw) return { kind: 'draw', key: 'D' + v.setNo + ':' + drew, first: drew === 0 };
      if (v.mayDraw) return { kind: 'drawOrPlay', key: 'P' + v.setNo + ':' + drew };
      if (v.canFollow) return { kind: 'follow', key: 'F' + v.setNo + ':' + drew };
      if (v.canTake) return { kind: 'take', key: 'T' + v.setNo };
      return null;
    },

    /* Human-like thinking time, in ms. */
    delay: function (intent, v, rnd) {
      switch (intent.kind) {
        case 'lead': return 900 + rnd() * 1300;
        case 'follow': return 650 + rnd() * 1500;
        case 'draw': return intent.first ? 450 + rnd() * 500 : v.timing.drawCooldownMs + 60 + rnd() * 380;
        case 'drawOrPlay': return v.timing.drawCooldownMs + 250 + rnd() * 600;
        case 'take': return 1400 + rnd() * 4800;
      }
      return 800;
    },

    decide: function (v, memory, rnd) {
      if (v.canLead) {
        var lead = chooseLead(v, rnd);
        return lead ? { type: 'lead', payload: { cardId: lead.id } } : null;
      }
      if (v.mustDraw) return { type: 'draw', payload: {} };
      if (v.mayDraw) return playOrKeepDrawing(v, memory, rnd);
      if (v.canFollow) {
        var follow = chooseFollow(v, rnd);
        return follow ? { type: 'follow', payload: { cardId: follow.id } } : null;
      }
      if (v.canTake) {
        var take = chooseTake(v, rnd);
        return take ? { type: 'take', payload: { cardId: take.id } } : null;
      }
      return null;
    }
  };

  CT.getMode('burns').bot = BurnsBot;
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
