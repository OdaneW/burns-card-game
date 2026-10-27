/* ==========================================================================
   GAME MODE · BURNS — rules
   Pure rules: every function takes the state and the current game time and
   either changes the state or explains why it can't. No timers, no DOM.

   Flow of one game
     dealing ──(Flush rule on and someone holds one)──► over
        └──► set 1: starter card sets the suit ─► follow ─► [take] ─► reveal
     reveal ──► lead (set winner plays any suit) ─► follow ─► [take] ─► reveal …
     A set ends with everyone's card revealed; whoever has emptied their hand
     at that point wins. Lead and follow each have a time limit so an idle
     player can't hold up the table.

   Real Burns (a rule choice, for friends in the same room)
     Emptying your hand makes you safe: you're out, a winner, and the rest
     play on until one player is left holding cards. They lose: …► lost ─►
     penalty, where each winner in turn "shuffles" until the loser calls
     Stop, the loser names a suit, and cards are turned over until that suit
     appears. Every card before it is a slap on the loser's hand (black
     soft, red hard); a first-card match means no slaps from that winner.
     penalty step by step: shuffle ─► suit ─► draw ─► result ─► next winner …
   ========================================================================== */
(function (CT) {
  'use strict';

  var ENGINE_VERSION = 3;
  var HAND_SIZE = 4;

  var DEFAULT_TIMING = {
    drawCooldownMs: 500,   // minimum gap between two draws by the same player
    takeWindowMs: 10000,   // time to choose a card from the set when the deck is empty
    dealHoldMs: 1900,      // pause after the deal before play (and the Flush check)
    revealHoldMs: 2700,    // how long a revealed set stays on the table
    quickHoldMs: 1200,     // …once every person is out and only computer players are left
    lostHoldMs: 4200,      // Real Burns: the last set and the loser, before the penalty round
    stopFromMs: 1500,      // the loser can call Stop this long after a shuffle starts
    shuffleMs: 15000,      // a shuffle stops by itself after this long
    suitMs: 15000,         // a suit is picked for the loser after this long
    flipMs: 750,           // a card is turned over every so often…
    fastFlipMs: 420,       // …a little faster after the first few
    slapMs: 30000          // the winner's moment, until they tap Next
  };

  /* Rule choices the user can switch on the setup screen. Add new house
     rules here; the setup screen and the rules text pick them up.
     formerDefaults lists values that used to be the default: a choice saved
     by an older version that matches one was never really picked, so the
     current default replaces it. */
  var OPTIONS = [
    {
      id: 'real',
      label: 'Real Burns',
      default: 'off',
      choices: [
        { value: 'off', label: 'Off', help: 'The first player to empty their hand wins.' },
        { value: 'on', label: 'On', help: 'Play on until one player is left holding cards: they lose. Then each winner turns cards over to count the loser’s slaps on the hand. For friends in the same room.' }
      ]
    },
    {
      id: 'flush',
      label: 'Flush',
      default: 'off',
      choices: [
        { value: 'off', label: 'Off', help: 'A hand with one card of every suit is just a normal hand. Play always begins after the deal.' },
        { value: 'on', label: 'On', help: 'If your 4 starting cards include all four suits, you have a Flush and win before play begins.' }
      ]
    },
    {
      id: 'leadCard',
      label: 'The leader’s card',
      default: 'faceUp',
      formerDefaults: ['suitOnly'],
      choices: [
        { value: 'suitOnly', label: 'Suit only', help: 'Everyone sees which suit was led. The card itself stays hidden until the reveal.' },
        { value: 'faceUp', label: 'Face up', help: 'The lead card is shown to everyone as soon as it is played.' }
      ]
    },
    {
      id: 'turnTime',
      label: 'Time to play',
      default: '30',
      choices: [
        { value: '15', label: '15 sec', help: 'The leader has 15 seconds to lead, then everyone has 15 seconds to play. When time runs out, a random card is played for anyone still deciding.' },
        { value: '30', label: '30 sec', help: 'The leader has 30 seconds to lead, then everyone has 30 seconds to play. When time runs out, a random card is played for anyone still deciding.' },
        { value: '60', label: '60 sec', help: 'The leader has 60 seconds to lead, then everyone has 60 seconds to play. When time runs out, a random card is played for anyone still deciding.' }
      ]
    }
  ];

  /* ---------- helpers ---------------------------------------------------- */

  function player(state, pid) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === pid) return state.players[i];
    return null;
  }

  /* Real Burns: players who have emptied their hands are out (and safe). */
  function realOn(state) { return state.options.real === 'on'; }
  function isOut(state, pid) { return !!state.out && state.out.indexOf(pid) >= 0; }
  function active(state) { return state.players.filter(function (p) { return !isOut(state, p.id); }); }

  /* The next player still in, clockwise after pid. */
  function nextActive(state, pid) {
    var ps = state.players, at = 0;
    for (var i = 0; i < ps.length; i++) if (ps[i].id === pid) at = i;
    for (var k = 1; k <= ps.length; k++) {
      var q = ps[(at + k) % ps.length];
      if (!isOut(state, q.id)) return q.id;
    }
    return null;
  }

  /* Once every person is out, the computer players finish quickly. */
  function revealHold(state) {
    var person = active(state).some(function (p) { return !p.isBot; });
    return state.out && state.out.length && !person ? Math.min(state.timing.revealHoldMs, state.timing.quickHoldMs) : state.timing.revealHoldMs;
  }

  function followers(state) {
    return active(state).filter(function (p) { return p.id !== state.leader; });
  }

  function isTaker(state, pid) { return state.takers.indexOf(pid) >= 0; }

  function value(card) { return CT.rankValue(card.rank, true); }

  function suitName(suit) { return CT.SUIT_INFO[suit].single; }

  /* Time limit per lead and per follow, in ms. timing.turnMs overrides the rule
     choice (the tutorial uses it); 0 means no limit. */
  function turnMs(state) {
    if (state.timing.turnMs != null) return state.timing.turnMs;
    return (Number(state.options.turnTime) || 30) * 1000;
  }
  function deadline(state, now) { var ms = turnMs(state); return ms ? now + ms : null; }

  /* The Flush rule. Games saved before it became a choice always had it on. */
  function flushOn(state) {
    return state.options.flush == null ? true : state.options.flush === 'on';
  }

  function secretFor(pid, data) { var s = {}; s[pid] = data; return s; }

  function emit(state, now, ev, secret) {
    state.seq += 1;
    ev.seq = state.seq;
    ev.t = Math.round(now);
    if (secret) ev.secret = secret;
    state.events.push(ev);
    if (state.events.length > 400) state.events.splice(0, state.events.length - 400);
  }

  function cardsOnTable(state) { return state.table.filter(function (e) { return !e.takenBy; }); }

  /* Followers who still owe a card this set (not in yet, not stuck). */
  function pending(state) {
    return followers(state).filter(function (p) { return !state.committed[p.id] && !isTaker(state, p.id); });
  }

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
      turnEndsAt: null, // time limit for leading, then for following
      leader: null,
      suit: null,
      table: [],        // [{ card, owner, via: 'starter'|'lead'|'hand', auto?, takenBy?, gone? }]
      committed: {},    // pid → true once their card for this set is in
      drawn: {},        // pid → cards drawn this set
      takers: [],       // pids who must take a card from the set (deck empty)
      taken: {},        // pid → card id taken in the take phase
      takeEndsAt: null,
      revealed: false,
      lastDrawAt: {},
      setResult: null,
      winners: null,
      winReason: null,
      // Real Burns
      out: [],          // players who have emptied their hands, in the order they went
      leadFrom: null,   // the set winner who went out, so the lead passed on
      nextLeader: null,
      loser: null,
      penalty: null,    // the penalty round (see startPenalty)
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
      state.turnEndsAt = deadline(state, now);
      emit(state, now, { type: 'setStart', setNo: state.setNo, leader: leaderId, turnEndsAt: state.turnEndsAt });
    }
  }

  /* The suit is known: start the clock. Anyone who can't follow while the
     deck is already empty is stuck straight away. */
  function beginFollow(state, now) {
    state.turnEndsAt = deadline(state, now);
    if (state.deck.length === 0) markStuck(state, now);
    checkFollowComplete(state, now);
  }

  function markStuck(state, now) {
    var stuck = [];
    followers(state).forEach(function (p) {
      if (!state.committed[p.id] && !isTaker(state, p.id) && !CT.hasSuit(p.hand, state.suit)) {
        state.takers.push(p.id);
        stuck.push(p.id);
      }
    });
    if (stuck.length) emit(state, now, { type: 'stuck', players: stuck, suit: state.suit });
    return stuck;
  }

  /* When every follower has a card in (or is stuck), reveal the set. */
  function checkFollowComplete(state, now) {
    if (state.phase !== 'follow' || pending(state).length) return;
    state.turnEndsAt = null;
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

  /* A taker picks a card up from the set into their hand. It still counts
     for the player who played it when the set is decided. */
  function applyTake(state, pid, entry, now, auto) {
    entry.takenBy = pid;
    entry.gone = true;
    state.taken[pid] = entry.card.id;
    player(state, pid).hand.push(entry.card);
    emit(state, now, { type: 'take', player: pid, card: entry.card, from: entry.owner, auto: !!auto });
  }

  function maybeFinishTake(state, now) {
    var waiting = state.takers.filter(function (pid) { return !state.taken[pid]; });
    if (!waiting.length || !cardsOnTable(state).length) finishSet(state, now);
  }

  function finishSet(state, now) {
    // Highest card in the set wins it. The starter card only sets the suit.
    var best = null;
    state.table.forEach(function (e) {
      if (!e.owner) return;
      if (!best || value(e.card) > value(best.card)) best = { player: e.owner, card: e.card };
    });

    var out = active(state).filter(function (p) { return p.hand.length === 0; });
    // Two players went out on the same set: the higher card they played comes first.
    var playedValue = function (pid) {
      for (var i = 0; i < state.table.length; i++) {
        if (state.table[i].owner === pid) return value(state.table[i].card);
      }
      return -1;
    };
    out.sort(function (a, b) { return playedValue(b.id) - playedValue(a.id); });

    if (out.length && realOn(state)) {
      // Real Burns: they're safe, and the rest play on until one is left holding cards.
      var going = out.map(function (p) { return p.id; });
      var left = active(state).filter(function (p) { return p.hand.length > 0; });
      // everyone still in went out together: the lowest card among them loses
      var loser = left.length === 1 ? left[0].id : !left.length ? going.pop() : null;
      going.forEach(function (pid) { state.out.push(pid); });
      if (going.length) emit(state, now, { type: 'out', players: going, places: going.map(function (pid) { return state.out.indexOf(pid) + 1; }) });
      if (loser) {
        state.setResult = best;
        emit(state, now, { type: 'setWon', player: best ? best.player : null, card: best ? best.card : null });
        lose(state, now, loser);
        return;
      }
      out = [];
    }

    if (out.length) {
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
      var keep = state.leader && !isOut(state, state.leader) ? state.leader : CT.pickRandom(active(state), state).id;
      best = { player: keep, card: null };
    }
    state.setResult = best;
    // a set winner who went out can't lead: the next player still in does
    state.leadFrom = isOut(state, best.player) ? best.player : null;
    state.nextLeader = state.leadFrom ? nextActive(state, best.player) : best.player;
    state.phase = 'reveal';
    state.phaseEndsAt = now + revealHold(state);
    emit(state, now, { type: 'setWon', player: best.player, card: best.card, next: state.nextLeader });
  }

  /* ---------- Real Burns: the loser and the penalty round ----------------- */

  /* One player is left holding cards. The last set stays on the table a
     moment, then the penalty round begins. */
  function lose(state, now, pid) {
    state.loser = pid;
    state.phase = 'lost';
    state.turnEndsAt = null;
    state.phaseEndsAt = now + state.timing.lostHoldMs;
    emit(state, now, { type: 'loser', player: pid, out: state.out.slice() });
  }

  /* Every winner takes a turn, clockwise from the loser's left. */
  function startPenalty(state, now) {
    var ps = state.players, at = 0, order = [];
    for (var i = 0; i < ps.length; i++) if (ps[i].id === state.loser) at = i;
    for (var k = 1; k < ps.length; k++) order.push(ps[(at + k) % ps.length].id);
    state.phase = 'penalty';
    state.penalty = {
      order: order, turn: -1, step: null, shuffler: null,
      stopFrom: null, endsAt: null, nextAt: null,
      suit: null, deck: null, drawn: [], soft: 0, hard: 0, lucky: false,
      results: []
    };
    emit(state, now, { type: 'penaltyStart', loser: state.loser, order: order.slice() });
    nextTurn(state, now);
  }

  function nextTurn(state, now) {
    var P = state.penalty;
    P.turn += 1;
    if (P.turn >= P.order.length) { finishPenalty(state, now); return; }
    P.shuffler = P.order[P.turn];
    P.step = 'shuffle';
    P.suit = null; P.deck = null; P.drawn = []; P.soft = 0; P.hard = 0; P.lucky = false; P.nextAt = null;
    P.stopFrom = now + state.timing.stopFromMs;
    P.endsAt = now + state.timing.shuffleMs;
    emit(state, now, { type: 'penaltyTurn', shuffler: P.shuffler, turn: P.turn, of: P.order.length });
  }

  /* "Stop!": the deck is as it lies when the shuffling stops. */
  function stopShuffle(state, now, auto) {
    var P = state.penalty;
    P.deck = CT.shuffle(CT.standardDeck(), state);
    P.step = 'suit';
    P.stopFrom = null;
    P.endsAt = now + state.timing.suitMs;
    emit(state, now, { type: 'penaltyStop', player: state.loser, shuffler: P.shuffler, auto: !!auto });
  }

  function pickSuit(state, now, suit, auto) {
    var P = state.penalty;
    P.suit = suit;
    P.step = 'draw';
    P.endsAt = null;
    P.nextAt = now + state.timing.flipMs;
    emit(state, now, { type: 'penaltySuit', player: state.loser, shuffler: P.shuffler, suit: suit, auto: !!auto });
  }

  /* Turn over the next card. Until the loser's suit turns up, each one is a
     slap: soft for black, hard for red. The card of the suit doesn't count. */
  function flipCard(state, now) {
    var P = state.penalty;
    var card = P.deck.pop();
    P.drawn.push(card);
    var match = card.suit === P.suit;
    if (!match) { if (CT.SUIT_INFO[card.suit].color === 'red') P.hard++; else P.soft++; }
    emit(state, now, { type: 'penaltyCard', shuffler: P.shuffler, card: card, n: P.drawn.length, match: match, soft: P.soft, hard: P.hard });
    if (!match) { P.nextAt = now + (P.drawn.length < 4 ? state.timing.flipMs : state.timing.fastFlipMs); return; }
    P.lucky = P.drawn.length === 1;
    P.step = 'result';
    P.nextAt = null;
    P.endsAt = now + state.timing.slapMs;
    P.results.push({ by: P.shuffler, suit: P.suit, cards: P.drawn.slice(), soft: P.soft, hard: P.hard, lucky: P.lucky });
    emit(state, now, { type: 'penaltyResult', shuffler: P.shuffler, loser: state.loser, suit: P.suit, soft: P.soft, hard: P.hard, lucky: P.lucky, n: P.drawn.length });
  }

  function slapTotals(state) {
    var t = { soft: 0, hard: 0 };
    (state.penalty ? state.penalty.results : []).forEach(function (r) { t.soft += r.soft; t.hard += r.hard; });
    return t;
  }

  /* Everyone but the loser wins. */
  function finishPenalty(state, now) {
    var P = state.penalty;
    P.step = 'done';
    P.shuffler = null;
    P.endsAt = null;
    state.phase = 'over';
    state.winners = state.out.slice();
    state.winReason = 'real';
    var t = slapTotals(state);
    emit(state, now, { type: 'gameOver', reason: 'real', winners: state.winners.slice(), loser: state.loser, soft: t.soft, hard: t.hard, hands: handsOf(state) });
  }

  function handsOf(state) {
    var hands = {};
    state.players.forEach(function (p) { hands[p.id] = p.hand.slice(); });
    return hands;
  }

  /* ---------- moves shared by actions and time-outs ---------------------- */

  function lead(state, p, card, now, auto) {
    p.hand.splice(p.hand.indexOf(card), 1);
    state.table.push({ card: card, owner: p.id, via: 'lead', auto: !!auto });
    state.committed[p.id] = true;
    state.suit = card.suit;
    state.phase = 'follow';
    var faceUp = state.options.leadCard === 'faceUp';
    emit(state, now, { type: 'lead', player: p.id, suit: card.suit, card: faceUp ? card : null, auto: !!auto }, secretFor(p.id, { card: card }));
    beginFollow(state, now);
  }

  function commit(state, p, card, now, auto) {
    p.hand.splice(p.hand.indexOf(card), 1);
    state.table.push({ card: card, owner: p.id, via: 'hand', auto: !!auto });
    state.committed[p.id] = true;
    emit(state, now, { type: 'commit', player: p.id, auto: !!auto }, secretFor(p.id, { card: card }));
  }

  /* Draws go into the hand. Players see their own card; everyone else only
     sees that a card was drawn. */
  function drawOne(state, p, now, auto) {
    var card = state.deck.pop();
    var n = (state.drawn[p.id] || 0) + 1;
    state.drawn[p.id] = n;
    p.hand.push(card);
    var matched = card.suit === state.suit;
    emit(state, now, { type: 'draw', player: p.id, n: n, deckLeft: state.deck.length, auto: !!auto }, secretFor(p.id, { card: card, matched: matched }));
    if (!state.deck.length) {
      emit(state, now, { type: 'deckEmpty' });
      markStuck(state, now);
    }
    return card;
  }

  /* ---------- actions ---------------------------------------------------- */

  function actLead(state, pid, payload, now) {
    if (state.phase !== 'lead') return CT.fail('not-now', 'Wait for the next set to start.');
    if (pid !== state.leader) return CT.fail('not-leader', 'Only the winner of the last set leads.');
    var p = player(state, pid);
    var card = p.hand.filter(function (c) { return c.id === payload.cardId; })[0];
    if (!card) return CT.fail('no-card', 'That card is not in your hand.');
    lead(state, p, card, now, false);
    return CT.ok();
  }

  function followGuard(state, pid) {
    if (state.phase !== 'follow') return CT.fail('not-now', 'Wait for the suit to be set.');
    if (pid === state.leader) return CT.fail('leader', 'You already led this set.');
    if (!player(state, pid)) return CT.fail('no-player', 'You are not in this game.');
    if (isOut(state, pid)) return CT.fail('out', 'You’re out: you emptied your hand.');
    if (state.committed[pid]) return CT.fail('done', 'Your card for this set is already in.');
    if (isTaker(state, pid)) return CT.fail('stuck', 'The deck is empty. You will take a card from the set once everyone has played.');
    return null;
  }

  function actFollow(state, pid, payload, now) {
    var bad = followGuard(state, pid);
    if (bad) return bad;
    var p = player(state, pid);
    var card = p.hand.filter(function (c) { return c.id === payload.cardId; })[0];
    if (!card) return CT.fail('no-card', 'That card is not in your hand.');
    if (card.suit !== state.suit) return CT.fail('wrong-suit', 'You must play a ' + suitName(state.suit) + '.');
    commit(state, p, card, now, false);
    checkFollowComplete(state, now);
    return CT.ok();
  }

  /* Any follower may draw while the deck lasts, hoping for a better card of
     the suit; players without the suit must draw until one turns up. Every
     drawn card stays in the hand. */
  function actDraw(state, pid, payload, now) {
    var bad = followGuard(state, pid);
    if (bad) return bad;
    var p = player(state, pid);
    if (!state.deck.length) return CT.fail('deck-empty', 'The deck is empty.');
    var last = state.lastDrawAt[pid];
    var gap = state.timing.drawCooldownMs;
    if (last != null && now - last < gap) {
      return CT.fail('cooldown', 'Drawing too fast.', { retryInMs: Math.ceil(gap - (now - last)) });
    }
    state.lastDrawAt[pid] = now;
    var card = drawOne(state, p, now, false);
    checkFollowComplete(state, now);
    return CT.ok({ card: card, matched: card.suit === state.suit });
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

  /* ---------- Real Burns: the penalty round's moves ---------------------- */

  function penaltyStep(state, step) {
    return state.phase === 'penalty' && state.penalty && state.penalty.step === step;
  }
  function loserName(state) { var p = player(state, state.loser); return p ? p.name : 'The loser'; }

  /* The loser calls Stop while a winner shuffles. */
  function actStop(state, pid, payload, now) {
    if (!penaltyStep(state, 'shuffle')) return CT.fail('not-now', 'Nobody is shuffling right now.');
    if (pid !== state.loser) return CT.fail('not-loser', loserName(state) + ' calls Stop, not you.');
    var P = state.penalty;
    if (now < P.stopFrom) return CT.fail('wait', 'Let them shuffle for a moment first.', { retryInMs: Math.ceil(P.stopFrom - now) });
    stopShuffle(state, now, false);
    return CT.ok();
  }

  /* …then names a suit. */
  function actSuit(state, pid, payload, now) {
    if (!penaltyStep(state, 'suit')) return CT.fail('not-now', 'It isn’t time to pick a suit.');
    if (pid !== state.loser) return CT.fail('not-loser', loserName(state) + ' picks the suit, not you.');
    if (CT.SUITS.indexOf(payload.suit) < 0) return CT.fail('bad-suit', 'Pick Hearts, Spades, Diamonds or Clubs.');
    pickSuit(state, now, payload.suit, false);
    return CT.ok();
  }

  /* The winner has had their moment: on to the next winner. */
  function actNext(state, pid, payload, now) {
    if (!penaltyStep(state, 'result')) return CT.fail('not-now', 'Not yet.');
    var P = state.penalty;
    if (pid !== P.shuffler) {
      var s = player(state, P.shuffler);
      return CT.fail('not-yours', 'Waiting for ' + (s ? s.name : 'the shuffler') + '.');
    }
    nextTurn(state, now);
    return CT.ok();
  }

  var ACTIONS = { lead: actLead, follow: actFollow, draw: actDraw, take: actTake, stop: actStop, suit: actSuit, next: actNext };

  function act(state, pid, type, payload, now) {
    if (state.phase === 'over') return CT.fail('over', 'This game is over.');
    var fn = ACTIONS[type];
    if (!fn) return CT.fail('unknown', 'Unknown action: ' + type);
    return fn(state, pid, payload || {}, now);
  }

  /* ---------- timed steps ------------------------------------------------ */

  /* Time ran out: finish the turn for anyone still deciding. A random card is
     played for them; if they have none of the suit, they draw until one turns
     up and it is played (or, if the deck runs out, they take from the set). */
  function timeOut(state, now) {
    if (state.phase === 'lead') {
      var leader = player(state, state.leader);
      emit(state, now, { type: 'timeout', phase: 'lead', players: [leader.id] });
      lead(state, leader, CT.pickRandom(leader.hand, state), now, true);
      return;
    }
    var late = pending(state);
    emit(state, now, { type: 'timeout', phase: 'follow', players: late.map(function (p) { return p.id; }) });
    late.forEach(function (p) {
      if (state.committed[p.id] || isTaker(state, p.id)) return;
      var suited = p.hand.filter(function (c) { return c.suit === state.suit; });
      if (suited.length) { commit(state, p, CT.pickRandom(suited, state), now, true); return; }
      while (state.deck.length && !isTaker(state, p.id)) {
        var card = drawOne(state, p, now, true);
        if (card.suit === state.suit) { commit(state, p, card, now, true); return; }
      }
    });
    checkFollowComplete(state, now);
    if (state.phase === 'follow' && pending(state).length) state.turnEndsAt = now + 1000;  // safety net
  }

  function tick(state, now) {
    if (state.phase === 'dealing' && now >= state.phaseEndsAt) {
      var flush = !flushOn(state) ? [] : state.players.filter(function (p) {
        return CT.SUITS.every(function (s) { return CT.hasSuit(p.hand, s); });
      });
      if (flush.length && realOn(state)) {
        // Real Burns: a Flush is safe straight away, and the rest play on.
        var safe = flush.map(function (p) { return p.id; });
        var shown = {};   // only the Flush hands are shown: everyone else plays on
        flush.forEach(function (p) { shown[p.id] = p.hand.slice(); });
        emit(state, now, { type: 'flush', players: safe, hands: shown });
        flush.forEach(function (p) {
          p.hand.forEach(function (c) { state.discard.push(c); });
          p.hand = [];
          state.out.push(p.id);
        });
        emit(state, now, { type: 'out', players: safe, places: safe.map(function (pid) { return state.out.indexOf(pid) + 1; }), flush: true });
        var left = active(state);
        if (left.length >= 2) startSet(state, now, null);
        else if (left.length === 1) {
          state.discard.push(state.starter);
          state.starter = null;
          lose(state, now, left[0].id);
        } else {
          // everyone held a Flush: nobody loses
          state.phase = 'over';
          state.winners = safe;
          state.winReason = 'flush';
          emit(state, now, { type: 'gameOver', reason: 'flush', winners: safe, hands: handsOf(state) });
        }
      } else if (flush.length) {
        state.phase = 'over';
        state.winners = flush.map(function (p) { return p.id; });
        state.winReason = 'flush';
        emit(state, now, { type: 'flush', players: state.winners, hands: handsOf(state) });
        emit(state, now, { type: 'gameOver', reason: 'flush', winners: state.winners, hands: handsOf(state) });
      } else {
        if (flushOn(state)) emit(state, now, { type: 'noFlush' });
        startSet(state, now, null);
      }
      return true;
    }

    if ((state.phase === 'lead' || state.phase === 'follow') && state.turnEndsAt != null && now >= state.turnEndsAt) {
      timeOut(state, now);
      return true;
    }

    if (state.phase === 'take' && now >= state.takeEndsAt) {
      // Anyone who didn't choose gets a random card, in random order, while cards last.
      var waiting = CT.shuffle(state.takers.filter(function (pid) { return !state.taken[pid]; }), state);
      waiting.forEach(function (pid) {
        var left = cardsOnTable(state);
        if (left.length) applyTake(state, pid, CT.pickRandom(left, state), now, true);
      });
      finishSet(state, now);
      return true;
    }

    if (state.phase === 'reveal' && now >= state.phaseEndsAt) {
      startSet(state, now, state.nextLeader || state.setResult.player);
      return true;
    }

    if (state.phase === 'lost' && now >= state.phaseEndsAt) {
      startPenalty(state, now);
      return true;
    }

    if (state.phase === 'penalty') {
      var P = state.penalty;
      if (P.step === 'shuffle' && now >= P.endsAt) { stopShuffle(state, now, true); return true; }
      if (P.step === 'suit' && now >= P.endsAt) { pickSuit(state, now, CT.pickRandom(CT.SUITS, state), true); return true; }
      if (P.step === 'draw' && now >= P.nextAt) { flipCard(state, now); return true; }
      if (P.step === 'result' && now >= P.endsAt) { nextTurn(state, now); return true; }
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
      flushRule: flushOn(state),
      timing: { drawCooldownMs: state.timing.drawCooldownMs, takeWindowMs: state.timing.takeWindowMs, turnMs: turnMs(state) },
      phaseEndsAt: state.phaseEndsAt,
      turnEndsAt: state.turnEndsAt,
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
          out: isOut(state, p.id),
          place: isOut(state, p.id) ? state.out.indexOf(p.id) + 1 : null,
          hand: over ? p.hand.slice() : undefined
        };
      }),
      table: state.table.map(function (e) {
        return { owner: e.owner, via: e.via, auto: !!e.auto, takenBy: e.takenBy || null, gone: !!e.gone, card: visible(e) ? e.card : null };
      }),
      setResult: state.setResult,
      winners: state.winners,
      winReason: state.winReason,
      lastDrawAt: state.lastDrawAt[pid] != null ? state.lastDrawAt[pid] : null,
      real: realOn(state),
      out: (state.out || []).slice(),
      leadFrom: state.leadFrom || null,
      nextLeader: state.phase === 'reveal' ? state.nextLeader || null : null,
      loser: state.loser || null,
      penalty: null,
      seq: state.seq
    };

    // the penalty round: everything but the order of the deck still to be turned over
    var P = state.penalty;
    if (P) {
      v.penalty = {
        order: P.order.slice(), turn: P.turn, step: P.step, shuffler: P.shuffler,
        stopFrom: P.stopFrom, endsAt: P.endsAt, suit: P.suit,
        drawn: P.drawn.slice(), soft: P.soft, hard: P.hard, lucky: P.lucky,
        results: P.results.map(function (r) { return { by: r.by, suit: r.suit, cards: r.cards.slice(), soft: r.soft, hard: r.hard, lucky: r.lucky }; }),
        timing: { stopFromMs: state.timing.stopFromMs, shuffleMs: state.timing.shuffleMs, suitMs: state.timing.suitMs, slapMs: state.timing.slapMs }
      };
    }
    v.canStop = !!me && penaltyStep(state, 'shuffle') && pid === state.loser;
    v.canSuit = !!me && penaltyStep(state, 'suit') && pid === state.loser;
    v.canNext = !!me && penaltyStep(state, 'result') && pid === P.shuffler;

    // still owes a card this set (Real Burns: players who are out and safe owe nothing)
    var mine = me && state.phase === 'follow' && pid !== state.leader && !isOut(state, pid) && !state.committed[pid] && !isTaker(state, pid);
    var hasIt = !!mine && CT.hasSuit(hand, state.suit);
    v.canLead = !!me && state.phase === 'lead' && state.leader === pid;
    v.canFollow = hasIt;
    v.canDraw = !!mine && state.deck.length > 0;
    v.mustDraw = v.canDraw && !hasIt;
    v.mayDraw = v.canDraw && hasIt;   // holds the suit: play it, or draw for a better one
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
    var leadText = o.leadCard === 'suitOnly'
      ? 'Everyone sees the suit that was led; the card itself stays hidden until the reveal.'
      : 'The lead card is shown to everyone straight away.';
    var secs = Number(o.turnTime) || 30;
    var flushText = o.flush === 'on'
      ? 'If your 4 starting cards include all four suits, you have a Flush and win before play begins. If more than one player has a Flush, they share the win.'
      : 'A Flush is 4 starting cards that include all four suits. It only counts when the Flush rule is switched on in the game setup; then it wins before play begins. The rule is off, so play always begins after the deal.';
    var real = o.real === 'on';
    if (real && o.flush === 'on') flushText = 'If your 4 starting cards include all four suits, you have a Flush: you’re safe before play begins, and the rest play on.';
    var winText = real
      ? 'Real Burns is on: everyone who empties their hand is safe, and the rest play on. The last player left holding cards loses. If everyone still playing goes out on the same set, the one who played the lowest card loses.'
      : 'Be the first to have no cards left. If two players go out on the same set, the one who played the higher card wins.';
    var list = [
      { title: 'The deal', text: 'Everyone gets 4 cards from a standard 52-card deck. One more card is turned face up. Its suit must be followed in the first set.' },
      { title: 'Flush', text: flushText },
      { title: 'Playing a set', text: 'Everyone plays one card of the suit in play. Cards stay hidden until everyone has played, then they are revealed together.' },
      { title: 'Winning a set', text: 'The highest card wins the set. Cards rank 2 (low) up to 10, Jack, Queen, King and Ace (high). The cards are put aside and the winner leads the next set with any card they like. ' + leadText },
      { title: 'Drawing', text: 'Before you play, you may draw from the deck to look for a better card of the suit, but every card you draw stays in your hand. If you don’t have the suit, you must draw until one turns up; then play it or keep drawing. Everyone draws at the same time, with a short pause between draws. The leader doesn’t draw.' },
      { title: 'Deck empty', text: 'If the deck runs out before you have a card of the suit, take one card from the set into your hand instead and sit out that set. The card still counts for whoever played it. You have 10 seconds to choose, and each card can only be taken once. If you don’t choose in time, a card is picked for you at random.' },
      { title: 'Time limit', text: 'The leader has ' + secs + ' seconds to lead, then everyone has ' + secs + ' seconds to play. When time runs out, a random card of the suit is played for anyone still deciding. If they have none, they draw until one turns up and it is played.' },
      { title: 'Winning the game', text: winText }
    ];
    list.push(real
      ? { title: 'The penalty round', text: 'Each winner takes a turn, going round the table. While the winner shuffles, the loser calls “Stop!” whenever they like, then names a suit. The winner turns cards over from the top until that suit appears. Every card before it is a slap on the loser’s hand: a soft slap for a black card (spades or clubs), a hard slap for a red one (hearts or diamonds). The card of the chosen suit doesn’t count, and if it’s the very first card, the loser gets no slaps from that winner.' }
      : { title: 'Real Burns', text: 'A rule choice for friends in the same room: switch it on in the game setup and the game goes on until one player is left holding cards. They lose, and each winner turns cards over to count the loser’s slaps on the hand.' });
    return list;
  }

  /* One line for the "game in progress" card on the home screen. */
  function describe(state, pid) {
    var me = player(state, pid);
    if (state.phase === 'lost' || state.phase === 'penalty') return 'Real Burns · the penalty round';
    var you = isOut(state, pid) ? 'you’re out and safe' : 'you hold ' + (me ? me.hand.length : 0) + ' cards';
    return (realOn(state) ? 'Real Burns · ' : '') + (state.setNo ? 'Set ' + state.setNo : 'Just dealt') + ' · ' + you +
      ' · ' + (state.players.length - 1) + ' opponents';
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
    describe: describe,
    createGame: createGame,
    act: act,
    tick: tick,
    view: view,
    presenter: 'burns'
  });
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
