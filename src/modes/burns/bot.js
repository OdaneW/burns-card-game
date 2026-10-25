/* ==========================================================================
   GAME MODE · BURNS — computer players
   A bot only ever sees its own view (the same one a human gets), so it can't
   peek at hands or the deck. It counts cards that have been revealed and
   remembers which suits opponents are known to be out of.
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

  function me(v) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === v.me) return v.players[i];
    return null;
  }

  function chooseLead(v, rnd) {
    var opps = v.players.filter(function (p) { return p.id !== v.me; });
    var seen = seenIds(v);
    var deckEmpty = v.deckCount === 0;
    var steal = v.options.deckEmpty === 'takeAndPlay';
    var bySuit = {};
    v.hand.forEach(function (c) { (bySuit[c.suit] = bySuit[c.suit] || []).push(c); });

    var best = null, bestScore = -Infinity;
    v.hand.forEach(function (c) {
      var score = 0;
      var voidOpps = opps.filter(function (o) { return o.voids.indexOf(c.suit) >= 0; }).length;
      if (!deckEmpty) score += voidOpps * 2.2;          // they will have to draw
      else score += steal ? -voidOpps * 1.5 : voidOpps * 1.2;
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

  function chooseFollow(v, rnd) {
    var mine = v.hand.filter(function (c) { return c.suit === v.suit; })
      .sort(function (a, b) { return val(a) - val(b); });
    var seen = seenIds(v);
    var toBeat = 0;
    v.table.forEach(function (e) { if (e.card && e.owner && e.owner !== v.me) toBeat = Math.max(toBeat, val(e.card)); });

    var sure = mine.filter(function (c) { return val(c) > toBeat && unseenHigher(c, seen) === 0; });
    if (sure.length) return sure[0];
    var top = mine[mine.length - 1];
    if (v.hand.length <= 3 && val(top) > toBeat) return top;   // close to going out: chase the lead
    if (rnd() < 0.12) return mine[Math.floor(rnd() * mine.length)];
    return mine[0];
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
      if (v.canLead) return { kind: 'lead', key: 'L' + v.setNo };
      if (v.canFollow) return { kind: 'follow', key: 'F' + v.setNo };
      if (v.mustDraw) {
        var drew = me(v).drew;
        return { kind: 'draw', key: 'D' + v.setNo + ':' + drew, first: drew === 0 };
      }
      if (v.canTake) return { kind: 'take', key: 'T' + v.setNo };
      return null;
    },

    /* Human-like thinking time, in ms. */
    delay: function (intent, v, rnd) {
      switch (intent.kind) {
        case 'lead': return 900 + rnd() * 1300;
        case 'follow': return 650 + rnd() * 1500;
        case 'draw': return intent.first ? 450 + rnd() * 500 : v.timing.drawCooldownMs + 60 + rnd() * 380;
        case 'take': return 1400 + rnd() * 4800;
      }
      return 800;
    },

    decide: function (v, memory, rnd) {
      if (v.canLead) {
        var lead = chooseLead(v, rnd);
        return lead ? { type: 'lead', payload: { cardId: lead.id } } : null;
      }
      if (v.canFollow) {
        var follow = chooseFollow(v, rnd);
        return follow ? { type: 'follow', payload: { cardId: follow.id } } : null;
      }
      if (v.mustDraw) return { type: 'draw', payload: {} };
      if (v.canTake) {
        var take = chooseTake(v, rnd);
        return take ? { type: 'take', payload: { cardId: take.id } } : null;
      }
      return null;
    }
  };

  CT.getMode('burns').bot = BurnsBot;
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
