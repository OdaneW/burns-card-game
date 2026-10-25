/* ==========================================================================
   GAME MODE · BURNS — rules
   Pure rules: every function takes the state and the current game time and
   either changes the state or explains why it can't. No timers, no DOM.

   Flow of one game
     dealing ──(flush?)──► over
        └──► set 1: starter card sets the suit ─► follow ─► [take] ─► reveal
     reveal ──► lead (set winner plays any suit) ─► follow ─► [take] ─► reveal …
     A set ends with everyone's card revealed; whoever has emptied their hand
     at that point wins.
   ========================================================================== */
(function (CT) {
  'use strict';

  var ENGINE_VERSION = 1;
  var HAND_SIZE = 4;

  var DEFAULT_TIMING = {
    drawCooldownMs: 500,   // minimum gap between two draws by the same player
    takeWindowMs: 10000,   // time to choose a card from the set when the deck is empty
    dealHoldMs: 1900,      // pause after the deal before the Flush check
    revealHoldMs: 2700     // how long a revealed set stays on the table
  };

  /* Rule choices the user can switch on the setup screen. Add new house
     rules here; the setup screen and the rules text pick them up. */
  var OPTIONS = [
    {
      id: 'deckEmpty',
      label: 'When the deck runs out',
      default: 'pickUp',
      choices: [
        { value: 'pickUp', label: 'Pick up', help: 'Players who can’t follow take one card from the set into their hand and sit out that set.' },
        { value: 'takeAndPlay', label: 'Take and play', help: 'Players who can’t follow take one card from the set and play it as their own, so it can win them the set.' }
      ]
    },
    {
      id: 'leadCard',
      label: 'The leader’s card',
      default: 'suitOnly',
      choices: [
        { value: 'suitOnly', label: 'Suit only', help: 'Everyone sees which suit was led. The card itself stays hidden until the reveal.' },
        { value: 'faceUp', label: 'Face up', help: 'The lead card is shown to everyone as soon as it is played.' }
      ]
    }
  ];

  /* ---------- helpers ---------------------------------------------------- */

  function player(state, pid) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === pid) return state.players[i];
    return null;
  }

  function followers(state) {
    return state.players.filter(function (p) { return p.id !== state.leader; });
  }

  function isTaker(state, pid) { return state.takers.indexOf(pid) >= 0; }

  function value(state, card) { return CT.rankValue(card.rank, true); }

  function suitName(suit) { return CT.SUIT_INFO[suit].single; }

  function emit(state, now, ev, secret) {
    state.seq += 1;
    ev.seq = state.seq;
    ev.t = Math.round(now);
    if (secret) ev.secret = secret;
    state.events.push(ev);
    if (state.events.length > 400) state.events.splice(0, state.events.length - 400);
  }

  /* Public knowledge: suits a player is certainly out of. */
  function addVoid(state, pid, suit) {
    var v = state.voids[pid] || (state.voids[pid] = []);
    if (v.indexOf(suit) < 0) v.push(suit);
  }
  function removeVoid(state, pid, suit) {
    var v = state.voids[pid];
    if (v) state.voids[pid] = v.filter(function (s) { return s !== suit; });
  }
  function keepOnlyVoid(state, pid, suit) {
    var v = state.voids[pid] || [];
    state.voids[pid] = v.indexOf(suit) >= 0 ? [suit] : [];
  }

  function cardsOnTable(state) { return state.table.filter(function (e) { return !e.takenBy; }); }

  /* ---------- setup ------------------------------------------------------ */

  function createGame(config) {
    var players = config.players || [];
    if (players.length < 2 || players.length > 6) throw new Error('Burns needs 2 to 6 players');
    var now = config.now || 0;
    var timing = {};
    for (var k in DEFAULT_TIMING) timing[k] = DEFAULT_TIMING[k];
    if (config.timing) for (var t in config.timing) timing[t] = config.timing[t];

    var state = {
      mode: 'burns',
      engineVersion: ENGINE_VERSION,
      rng: ((config.seed != null ? config.seed : Date.now()) >>> 0) || 1,
      options: CT.resolveOptions(OPTIONS, config.options),
      timing: timing,
      players: players.map(function (p, i) {
        return { id: p.id, name: p.name, isBot: !!p.isBot, seat: i, hand: [] };
      }),
      deck: [],
      discard: [],
      starter: null,
      setNo: 0,
      phase: 'dealing',
      phaseEndsAt: now + timing.dealHoldMs,
      leader: null,
      suit: null,
      table: [],        // [{ card, owner, via: 'starter'|'lead'|'hand'|'draw', takenBy? }]
      committed: {},    // pid → true once their card for this set is in
      drawn: {},        // pid → cards drawn this set
      takers: [],       // pids who must take a card from the set (deck empty)
      taken: {},        // pid → card id taken in the take phase
      takeEndsAt: null,
      revealed: false,
      lastDrawAt: {},
      voids: {},
      setResult: null,
      winners: null,
      winReason: null,
      seq: 0,
      events: []
    };

    var deck = CT.shuffle(CT.standardDeck(), state);
    for (var round = 0; round < HAND_SIZE; round++) {
      state.players.forEach(function (p) { p.hand.push(deck.pop()); });
    }
    state.starter = deck.pop();
    state.deck = deck;

    var secret = {};
    state.players.forEach(function (p) { secret[p.id] = { hand: p.hand.slice() }; });
    emit(state, now, { type: 'deal', handSize: HAND_SIZE, order: state.players.map(function (p) { return p.id; }) }, secret);
    return state;
  }

  function startSet(state, now, leaderId) {
    // Put the finished set aside. Cards picked up by takers already left the table.
    state.table.forEach(function (e) { if (!e.gone) state.discard.push(e.card); });
    state.table = [];
    state.setNo += 1;
    state.committed = {};
    state.drawn = {};
    state.takers = [];
    state.taken = {};
    state.takeEndsAt = null;
    state.revealed = false;
    state.setResult = null;
    state.phaseEndsAt = null;

    if (state.setNo === 1) {
      var starter = state.starter;
      state.starter = null;
      state.leader = null;
      state.suit = starter.suit;
      state.table.push({ card: starter, owner: null, via: 'starter' });
      state.phase = 'follow';
      emit(state, now, { type: 'setStart', setNo: 1, leader: null, suit: starter.suit, starter: starter });
      beginFollow(state, now);
    } else {
      state.leader = leaderId;
      state.suit = null;
      state.phase = 'lead';
      emit(state, now, { type: 'setStart', setNo: state.setNo, leader: leaderId });
    }
  }

  /* Suit is known: anyone who can't follow while the deck is already empty is stuck. */
  function beginFollow(state, now) {
    if (state.deck.length === 0) markStuck(state, now);
    checkFollowComplete(state, now);
  }

  function markStuck(state, now) {
    var stuck = [];
    followers(state).forEach(function (p) {
      if (!state.committed[p.id] && !isTaker(state, p.id) && !CT.hasSuit(p.hand, state.suit)) {
        state.takers.push(p.id);
        addVoid(state, p.id, state.suit);
        stuck.push(p.id);
      }
    });
    if (stuck.length) emit(state, now, { type: 'stuck', players: stuck, suit: state.suit });
    return stuck;
  }

  /* When every follower has a card in (or is stuck), reveal the set. */
  function checkFollowComplete(state, now) {
    if (state.phase !== 'follow') return;
    var waiting = followers(state).filter(function (p) {
      return !state.committed[p.id] && !isTaker(state, p.id);
    });
    if (waiting.length) return;

    state.revealed = true;
    emit(state, now, {
      type: 'reveal',
      cards: state.table.map(function (e) { return { owner: e.owner, via: e.via, card: e.card }; })
    });
    if (state.takers.length) {
      state.phase = 'take';
      state.takeEndsAt = now + state.timing.takeWindowMs;
      emit(state, now, { type: 'takeStart', takers: state.takers.slice(), endsAt: state.takeEndsAt });
    } else {
      finishSet(state, now);
    }
  }

  function applyTake(state, pid, entry, now, auto) {
    entry.takenBy = pid;
    state.taken[pid] = entry.card.id;
    if (state.options.deckEmpty === 'pickUp') {
      entry.gone = true;
      player(state, pid).hand.push(entry.card);
      removeVoid(state, pid, entry.card.suit);
    }
    emit(state, now, { type: 'take', player: pid, card: entry.card, from: entry.owner, auto: !!auto });
  }

  function maybeFinishTake(state, now) {
    var waiting = state.takers.filter(function (pid) { return !state.taken[pid]; });
    if (!waiting.length || !cardsOnTable(state).length) finishSet(state, now);
  }

  function finishSet(state, now) {
    var steal = state.options.deckEmpty === 'takeAndPlay';

    // Highest card in the set. With "Pick up" a picked-up card still counts for
    // the player who played it; with "Take and play" it counts for the taker.
    // The starter card only sets the suit and never wins on its own.
    var best = null;
    state.table.forEach(function (e) {
      var holder = steal ? (e.takenBy || e.owner) : e.owner;
      if (!holder) return;
      if (!best || value(state, e.card) > value(state, best.card)) best = { player: holder, card: e.card };
    });

    var out = state.players.filter(function (p) { return p.hand.length === 0; });
    if (out.length) {
      // Two players went out on the same set: the higher card they played wins.
      var playedValue = function (pid) {
        for (var i = 0; i < state.table.length; i++) {
          if (state.table[i].owner === pid) return value(state, state.table[i].card);
        }
        return -1;
      };
      out.sort(function (a, b) { return playedValue(b.id) - playedValue(a.id); });
      state.setResult = best;
      state.phase = 'over';
      state.winners = [out[0].id];
      state.winReason = 'empty';
      emit(state, now, { type: 'setWon', player: best ? best.player : null, card: best ? best.card : null });
      emit(state, now, {
        type: 'gameOver', reason: 'empty', winners: state.winners,
        out: out.map(function (p) { return p.id; }),
        hands: handsOf(state)
      });
      return;
    }

    if (!best) {
      // Nobody holds a card in the set (only possible in freak deck-empty cases).
      var keep = state.leader || CT.pickRandom(state.players, state).id;
      best = { player: keep, card: null };
    }
    state.setResult = best;
    state.phase = 'reveal';
    state.phaseEndsAt = now + state.timing.revealHoldMs;
    emit(state, now, { type: 'setWon', player: best.player, card: best.card });
  }

  function handsOf(state) {
    var hands = {};
    state.players.forEach(function (p) { hands[p.id] = p.hand.slice(); });
    return hands;
  }

  /* ---------- actions ---------------------------------------------------- */

  function actLead(state, pid, payload, now) {
    if (state.phase !== 'lead') return CT.fail('not-now', 'Wait for the next set to start.');
    if (pid !== state.leader) return CT.fail('not-leader', 'Only the winner of the last set leads.');
    var p = player(state, pid);
    var idx = p.hand.findIndex(function (c) { return c.id === payload.cardId; });
    if (idx < 0) return CT.fail('no-card', 'That card is not in your hand.');
    var card = p.hand.splice(idx, 1)[0];
    state.table.push({ card: card, owner: pid, via: 'lead' });
    state.committed[pid] = true;
    state.suit = card.suit;
    state.phase = 'follow';
    removeVoid(state, pid, card.suit);
    var faceUp = state.options.leadCard === 'faceUp';
    emit(state, now, { type: 'lead', player: pid, suit: card.suit, card: faceUp ? card : null }, (function () {
      var s = {}; s[pid] = { card: card }; return s;
    })());
    beginFollow(state, now);
    return CT.ok();
  }

  function followGuard(state, pid) {
    if (state.phase !== 'follow') return CT.fail('not-now', 'Wait for the suit to be set.');
    if (pid === state.leader) return CT.fail('leader', 'You already led this set.');
    if (!player(state, pid)) return CT.fail('no-player', 'You are not in this game.');
    if (state.committed[pid]) return CT.fail('done', 'Your card for this set is already in.');
    if (isTaker(state, pid)) return CT.fail('stuck', 'The deck is empty. You will take a card from the set once everyone has played.');
    return null;
  }

  function actFollow(state, pid, payload, now) {
    var bad = followGuard(state, pid);
    if (bad) return bad;
    var p = player(state, pid);
    var idx = p.hand.findIndex(function (c) { return c.id === payload.cardId; });
    if (idx < 0) return CT.fail('no-card', 'That card is not in your hand.');
    var card = p.hand[idx];
    if (card.suit !== state.suit) return CT.fail('wrong-suit', 'You must play a ' + suitName(state.suit) + '.');
    p.hand.splice(idx, 1);
    state.table.push({ card: card, owner: pid, via: 'hand' });
    state.committed[pid] = true;
    var s = {}; s[pid] = { card: card };
    emit(state, now, { type: 'commit', player: pid, via: 'hand' }, s);
    checkFollowComplete(state, now);
    return CT.ok();
  }

  function actDraw(state, pid, payload, now) {
    var bad = followGuard(state, pid);
    if (bad) return bad;
    var p = player(state, pid);
    if (CT.hasSuit(p.hand, state.suit)) return CT.fail('has-suit', 'You have a ' + suitName(state.suit) + '. Play it instead of drawing.');
    if (!state.deck.length) return CT.fail('deck-empty', 'The deck is empty.');
    var last = state.lastDrawAt[pid];
    var gap = state.timing.drawCooldownMs;
    if (last != null && now - last < gap) {
      return CT.fail('cooldown', 'Drawing too fast.', { retryInMs: Math.ceil(gap - (now - last)) });
    }

    var card = state.deck.pop();
    state.lastDrawAt[pid] = now;
    var n = (state.drawn[pid] || 0) + 1;
    state.drawn[pid] = n;
    if (n === 1) addVoid(state, pid, state.suit);   // everyone now knows they lacked it

    var matched = card.suit === state.suit;
    if (matched) {
      state.table.push({ card: card, owner: pid, via: 'draw' });
      state.committed[pid] = true;
    } else {
      p.hand.push(card);
      keepOnlyVoid(state, pid, state.suit);           // the new card may fill other gaps
    }
    var s = {}; s[pid] = { card: card };
    emit(state, now, { type: 'draw', player: pid, n: n, matched: matched, deckLeft: state.deck.length }, s);

    if (!state.deck.length) {
      emit(state, now, { type: 'deckEmpty' });
      markStuck(state, now);
    }
    checkFollowComplete(state, now);
    return CT.ok({ card: card, matched: matched });
  }

  function actTake(state, pid, payload, now) {
    if (state.phase !== 'take') return CT.fail('not-now', 'Cards can only be taken when the deck is empty.');
    if (!isTaker(state, pid)) return CT.fail('not-taker', 'Only players who could not follow take a card.');
    if (state.taken[pid]) return CT.fail('done', 'You already took a card.');
    var entry = null;
    for (var i = 0; i < state.table.length; i++) if (state.table[i].card.id === payload.cardId) entry = state.table[i];
    if (!entry) return CT.fail('no-card', 'That card is not in this set.');
    if (entry.takenBy) {
      var who = player(state, entry.takenBy);
      return CT.fail('taken', (who ? who.name : 'Someone') + ' already took that card.');
    }
    applyTake(state, pid, entry, now, false);
    maybeFinishTake(state, now);
    return CT.ok();
  }

  var ACTIONS = { lead: actLead, follow: actFollow, draw: actDraw, take: actTake };

  function act(state, pid, type, payload, now) {
    if (state.phase === 'over') return CT.fail('over', 'This game is over.');
    var fn = ACTIONS[type];
    if (!fn) return CT.fail('unknown', 'Unknown action: ' + type);
    return fn(state, pid, payload || {}, now);
  }

  /* ---------- timed steps ------------------------------------------------ */

  function tick(state, now) {
    if (state.phase === 'dealing' && now >= state.phaseEndsAt) {
      var flush = state.players.filter(function (p) {
        return CT.SUITS.every(function (s) { return CT.hasSuit(p.hand, s); });
      });
      if (flush.length) {
        state.phase = 'over';
        state.winners = flush.map(function (p) { return p.id; });
        state.winReason = 'flush';
        emit(state, now, { type: 'flush', players: state.winners, hands: handsOf(state) });
        emit(state, now, { type: 'gameOver', reason: 'flush', winners: state.winners, hands: handsOf(state) });
      } else {
        emit(state, now, { type: 'noFlush' });
        startSet(state, now, null);
      }
      return true;
    }

    if (state.phase === 'take' && now >= state.takeEndsAt) {
      // Time's up: anyone who didn't choose gets a random card, in random order,
      // while cards last.
      var waiting = CT.shuffle(state.takers.filter(function (pid) { return !state.taken[pid]; }), state);
      waiting.forEach(function (pid) {
        var left = cardsOnTable(state);
        if (left.length) applyTake(state, pid, CT.pickRandom(left, state), now, true);
      });
      finishSet(state, now);
      return true;
    }

    if (state.phase === 'reveal' && now >= state.phaseEndsAt) {
      startSet(state, now, state.setResult.player);
      return true;
    }
    return false;
  }

  /* ---------- what one player may see ------------------------------------ */

  function view(state, pid, opts) {
    opts = opts || {};
    var me = player(state, pid);
    var over = state.phase === 'over';
    var faceUpLead = state.options.leadCard === 'faceUp';
    var hand = me ? me.hand.slice() : [];

    function visible(e) {
      return state.revealed || over || e.owner === pid || e.via === 'starter' || (e.via === 'lead' && faceUpLead);
    }

    var v = {
      mode: 'burns',
      engineVersion: state.engineVersion,
      me: pid,
      phase: state.phase,
      setNo: state.setNo,
      leader: state.leader,
      suit: state.suit,
      options: state.options,
      timing: { drawCooldownMs: state.timing.drawCooldownMs, takeWindowMs: state.timing.takeWindowMs },
      phaseEndsAt: state.phaseEndsAt,
      takeEndsAt: state.takeEndsAt,
      revealed: state.revealed,
      deckCount: state.deck.length,
      discard: state.discard.slice(),
      starter: state.starter,   // face up during the deal; joins the table in set 1
      hand: hand,
      players: state.players.map(function (p) {
        return {
          id: p.id,
          name: p.name,
          isBot: p.isBot,
          seat: p.seat,
          handCount: p.hand.length,
          isLeader: p.id === state.leader,
          committed: !!state.committed[p.id],
          drew: state.drawn[p.id] || 0,
          isTaker: isTaker(state, p.id),
          took: state.taken[p.id] || null,
          voids: (state.voids[p.id] || []).slice(),
          hand: over ? p.hand.slice() : undefined
        };
      }),
      table: state.table.map(function (e) {
        return { owner: e.owner, via: e.via, takenBy: e.takenBy || null, gone: !!e.gone, card: visible(e) ? e.card : null };
      }),
      setResult: state.setResult,
      winners: state.winners,
      winReason: state.winReason,
      lastDrawAt: state.lastDrawAt[pid] != null ? state.lastDrawAt[pid] : null,
      seq: state.seq
    };

    var mine = me && state.phase === 'follow' && pid !== state.leader && !state.committed[pid] && !isTaker(state, pid);
    v.canLead = !!me && state.phase === 'lead' && state.leader === pid;
    v.canFollow = !!mine && CT.hasSuit(hand, state.suit);
    v.mustDraw = !!mine && !v.canFollow && state.deck.length > 0;
    v.canTake = !!me && state.phase === 'take' && isTaker(state, pid) && !state.taken[pid];
    v.playable = v.canLead ? hand.map(function (c) { return c.id; })
      : v.canFollow ? hand.filter(function (c) { return c.suit === state.suit; }).map(function (c) { return c.id; })
      : [];

    if (opts.events !== false) {
      var since = opts.sinceSeq || 0;
      v.events = state.events.filter(function (e) { return e.seq > since; }).map(function (e) {
        var copy = {};
        for (var k in e) if (k !== 'secret') copy[k] = e[k];
        if (e.secret && e.secret[pid]) copy.mine = e.secret[pid];
        return copy;
      });
    }
    return v;
  }

  /* ---------- rules text for How to play ---------------------------------- */

  function rules(options) {
    var o = CT.resolveOptions(OPTIONS, options);
    var deckEmptyText = o.deckEmpty === 'pickUp'
      ? 'Instead, take one card from the set into your hand and sit out that set. Its card still counts for whoever played it.'
      : 'Instead, take one card from the set and play it as your own. It can win you the set.';
    var leadText = o.leadCard === 'suitOnly'
      ? 'Everyone sees the suit that was led; the card itself stays hidden until the reveal.'
      : 'The lead card is shown to everyone straight away.';
    return [
      { title: 'The deal', text: 'Everyone gets 4 cards from a standard 52-card deck. One more card is turned face up. Its suit must be followed in the first set.' },
      { title: 'Flush', text: 'If your 4 starting cards include all four suits, you have a Flush and win before play begins. If more than one player has a Flush, they share the win.' },
      { title: 'Playing a set', text: 'Everyone plays one card of the suit in play. Cards stay hidden until everyone has played, then they are revealed together.' },
      { title: 'Winning a set', text: 'The highest card wins the set (Ace is high). The cards are put aside and the winner leads the next set with any card they like. ' + leadText },
      { title: 'Can’t follow?', text: 'Draw from the deck until you find a card of the suit, then it is played for you. Everyone who needs to draws at the same time, with a short pause between draws.' },
      { title: 'Deck empty', text: 'If the deck runs out before you find the suit, you can’t draw. ' + deckEmptyText + ' You have 10 seconds to choose, and each card can only be taken once. If you don’t choose in time, a card is picked for you at random.' },
      { title: 'Winning the game', text: 'Be the first to have no cards left. If two players go out on the same set, the one who played the higher card wins.' }
    ];
  }

  CT.registerMode({
    id: 'burns',
    name: 'Burns',
    tagline: 'Follow the suit, draw when you can’t, and be first to empty your hand.',
    engineVersion: ENGINE_VERSION,
    players: { min: 2, max: 6, default: 4 },
    options: OPTIONS,
    defaultTiming: DEFAULT_TIMING,
    handSize: HAND_SIZE,
    rules: rules,
    createGame: createGame,
    act: act,
    tick: tick,
    view: view,
    presenter: 'burns'
  });
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
