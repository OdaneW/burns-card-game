/* ==========================================================================
   GAME MODE · STRIP-ME — rules
   Two players, the deck split 26 and 26, face down: nobody looks at their
   cards. Taking turns, each turns over the top card of their own deck onto
   the pile in the middle. Jacks, Queens, Kings and Aces are Action Cards:
   the other player must pay 1, 2, 3 or 4 cards, one at a time. Turn up an
   Action Card while paying and the rest is cancelled: now the other player
   pays for that one. Pay in full without one and you take the whole pile
   under your deck, and the player who made you pay starts again. The first
   to turn over their last card wins the round.
   Strip Mode: everyone wears as many garments as the losses allowed, and the
   loser of each round takes one off; lose them all and you lose the game.
   Quick Play: one round decides it.
   Round timer (optional): when a round's time is up, whoever has more cards
   in their deck loses it. Level? Play on: the next to take the pile loses.

   Flow
     dealing ─► play ─► (pickup: the pile is taken) ─► play … ─► roundOver
       ─► dealing (Strip Mode, garments left) … ─► over
   Pure rules: every function takes the state and the game time; no timers,
   no DOM. Nobody, not even the owner, is ever shown the order of a deck.
   ========================================================================== */
(function (CT) {
  'use strict';

  var ENGINE_VERSION = 2;   // 2: the round timer
  var SEATS = 2;
  var OWED = { J: 1, Q: 2, K: 3, A: 4 };   // what each Action Card makes the other player pay

  var DEFAULT_TIMING = {
    dealHoldMs: 1400,      // the new round's cards are dealt
    pickupHoldMs: 1300,    // the last card of a payment stays on show before the pile is taken
    roundHoldMs: 5200,     // the round's result, and the garment coming off
    turnMs: 10000,         // play within this long, or a card is turned over for you…
    idleMs: 1200,          // …and after that, quickly, until you play again yourself
    timedTurnMs: 3000      // in a timed round the clock is running: play within this long
  };

  var OPTIONS = [
    {
      id: 'mode',
      label: 'Game',
      default: 'strip',
      choices: [
        { value: 'strip', label: 'Strip Mode', help: 'Lose a round and one of your garments comes off. Lose them all and you lose the game.' },
        { value: 'quick', label: 'Quick Play', help: 'One round, no stripping: whoever loses the round loses the game.' }
      ]
    },
    {
      id: 'losses',
      label: 'Losses',
      default: '3',
      showIf: { mode: 'strip' },
      choices: [
        { value: '2', label: '2', help: 'Everyone wears 2 garments. Lose 2 rounds and you lose the game.' },
        { value: '3', label: '3', help: 'Everyone wears 3 garments. Lose 3 rounds and you lose the game.' },
        { value: '4', label: '4', help: 'Everyone wears 4 garments. Lose 4 rounds and you lose the game.' },
        { value: '5', label: '5', help: 'Everyone wears 5 garments. Lose 5 rounds and you lose the game. A long game.' }
      ]
    },
    {
      id: 'timer',
      label: 'Round timer',
      default: 'off',
      choices: [
        { value: 'off', label: 'Off', help: 'No time limit: a round lasts until someone turns over their last card.' },
        { value: '60', label: '1 min', help: 'Each round lasts a minute at most. When time’s up, whoever has more cards loses the round.' },
        { value: '120', label: '2 min', help: 'Each round lasts two minutes at most. When time’s up, whoever has more cards loses the round.' },
        { value: '180', label: '3 min', help: 'Each round lasts three minutes at most. When time’s up, whoever has more cards loses the round.' }
      ]
    }
  ];

  /* ---------- helpers ---------------------------------------------------- */

  function player(state, pid) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === pid) return state.players[i];
    return null;
  }
  function other(state, pid) { return state.players[0].id === pid ? state.players[1].id : state.players[0].id; }

  function strip(state) { return state.options.mode !== 'quick'; }
  /* How long a round may last, or 0 for no time limit. */
  function roundMs(state) { var s = Number(state.options.timer); return s > 0 ? s * 1000 : 0; }
  /* Rounds a player may lose: their garments. Quick Play is a single round. */
  function allowed(state) { return strip(state) ? (Number(state.options.losses) || 3) : 1; }

  function counts(state) {
    var out = {};
    state.players.forEach(function (p) { out[p.id] = p.deck.length; });
    return out;
  }
  function lost(state) {
    var out = {};
    state.players.forEach(function (p) { out[p.id] = p.lost; });
    return out;
  }

  function emit(state, now, ev) {
    state.seq += 1;
    ev.seq = state.seq;
    ev.t = Math.round(now);
    state.events.push(ev);
    if (state.events.length > 400) state.events.splice(0, state.events.length - 400);
  }

  /* When the player to move must have played by. Someone whose time ran out
     is playing on autopilot until they tap again, so their cards go quickly. */
  function deadline(state, now, pid) {
    var limit = roundMs(state) ? state.timing.timedTurnMs : state.timing.turnMs;
    if (!limit) return null;
    return now + (state.idle[pid] ? Math.min(state.timing.idleMs, limit) : limit);
  }

  /* ---------- setup ------------------------------------------------------ */

  function createGame(config) {
    var players = config.players || [];
    if (players.length !== SEATS) throw new Error('Strip-Me needs exactly two players');
    var now = config.now || 0;
    var timing = {};
    for (var k in DEFAULT_TIMING) timing[k] = DEFAULT_TIMING[k];
    if (config.timing) for (var t in config.timing) timing[t] = config.timing[t];

    var state = {
      mode: 'stripme',
      engineVersion: ENGINE_VERSION,
      rng: ((config.seed != null ? config.seed : Date.now()) >>> 0) || 1,
      options: CT.resolveOptions(OPTIONS, config.options),
      timing: timing,
      players: players.map(function (p, i) {
        return { id: p.id, name: p.name, isBot: !!p.isBot, seat: i, deck: [], lost: 0 };
      }),
      round: 0,
      phase: 'dealing',
      phaseEndsAt: 0,
      starter: null,
      turn: null,         // who turns over the next card
      turnEndsAt: null,
      owe: 0,             // cards the player to move still has to pay (0: an ordinary turn)
      demand: null,       // the Action Card being paid for: { by, rank, n }
      taker: null,        // who is about to take the pile (pickup)
      pile: [],           // face up in the middle, oldest first
      shuffled: {},       // pid → true once they've shuffled before their next card
      idle: {},           // pid → true after their time ran out, until they play again
      plays: 0,           // cards turned over this round
      roundEndsAt: null,  // timed rounds: when this round's time is up
      overtime: false,    // timed rounds: level when time ran out, so the next to take the pile loses
      result: null,       // the round just finished
      winners: null,
      seq: 0,
      events: []
    };
    deal(state, now, CT.pickRandom(state.players, state).id);
    return state;
  }

  /* A fresh deal: the whole deck shuffled and split, 26 each, face down. */
  function deal(state, now, starter) {
    state.round += 1;
    var deck = CT.shuffle(CT.standardDeck(), state);
    state.players.forEach(function (p) { p.deck = []; });
    var a = state.players.indexOf(player(state, starter));
    deck.forEach(function (c, i) { state.players[(a + i) % SEATS].deck.push(c); });
    state.pile = [];
    state.starter = starter;
    state.turn = null;
    state.turnEndsAt = null;
    state.owe = 0;
    state.demand = null;
    state.taker = null;
    state.shuffled = {};
    state.plays = 0;
    state.roundEndsAt = null;
    state.overtime = false;
    state.result = null;
    state.phase = 'dealing';
    state.phaseEndsAt = now + state.timing.dealHoldMs;
    emit(state, now, { type: 'deal', round: state.round, starter: starter, counts: counts(state) });
  }

  function startPlay(state, now) {
    state.phase = 'play';
    state.turn = state.starter;
    state.turnEndsAt = deadline(state, now, state.turn);
    state.roundEndsAt = roundMs(state) ? now + roundMs(state) : null;   // the clock starts with the first card
    emit(state, now, { type: 'start', round: state.round, player: state.starter, endsAt: state.roundEndsAt });
  }

  /* ---------- turning cards over ----------------------------------------- */

  function turnOver(state, p, now, auto) {
    var card = p.deck.shift();
    state.pile.push(card);
    state.plays += 1;
    state.shuffled[p.id] = false;
    var paying = state.owe > 0;
    var ev = { type: 'play', player: p.id, card: card, n: state.plays, pile: state.pile.length, left: p.deck.length, auto: !!auto };
    var n = OWED[card.rank];
    if (!p.deck.length) {
      // their last card: they win the round, even in the middle of paying
      ev.last = true;
      emit(state, now, ev);
      endRound(state, now, p.id, 'out');
      return;
    }
    if (n) {
      // an Action Card: the other player pays; whatever was still owed here is cancelled
      if (paying) ev.cancelled = state.owe;
      ev.demand = n;
      state.demand = { by: p.id, rank: card.rank, n: n };
      state.owe = n;
      state.turn = other(state, p.id);
      state.turnEndsAt = deadline(state, now, state.turn);
      emit(state, now, ev);
      return;
    }
    if (paying) {
      state.owe -= 1;
      ev.owe = state.owe;
      emit(state, now, ev);
      if (state.owe === 0) {
        // paid in full without an Action Card: they take the pile, once everyone has seen the card
        state.phase = 'pickup';
        state.taker = p.id;
        state.turn = null;
        state.turnEndsAt = null;
        state.phaseEndsAt = now + state.timing.pickupHoldMs;
        emit(state, now, { type: 'paid', player: p.id, by: state.demand.by, count: state.pile.length });
        return;
      }
      state.turnEndsAt = deadline(state, now, p.id);   // still paying: their turn again
      return;
    }
    emit(state, now, ev);
    state.turn = other(state, p.id);
    state.turnEndsAt = deadline(state, now, state.turn);
  }

  /* The pile goes under the taker's deck, in the order it was played; the
     player who made them pay starts again. */
  function pickup(state, now) {
    var p = player(state, state.taker);
    var count = state.pile.length;
    p.deck = p.deck.concat(state.pile);
    state.pile = [];
    var next = state.demand.by;
    emit(state, now, { type: 'pickup', player: p.id, count: count, counts: counts(state), next: next });
    state.taker = null;
    state.owe = 0;
    state.demand = null;
    state.phase = 'play';
    state.turn = next;
    state.turnEndsAt = deadline(state, now, next);
  }

  /* how: 'out' (the winner turned over their last card) or 'time' (the loser had
     more cards when the round's time was up, or took the pile in sudden death). */
  function endRound(state, now, winner, how) {
    var loser = player(state, other(state, winner));
    loser.lost += 1;
    var out = loser.lost >= allowed(state);
    state.result = { round: state.round, winner: winner, loser: loser.id, garment: strip(state) ? loser.lost : 0, plays: state.plays, final: out,
      how: how, counts: counts(state), overtime: state.overtime };
    state.turn = null;
    state.turnEndsAt = null;
    state.owe = 0;
    state.demand = null;
    state.taker = null;
    state.roundEndsAt = null;
    state.overtime = false;
    emit(state, now, { type: 'roundEnd', round: state.round, winner: winner, loser: loser.id, garment: state.result.garment,
      lost: lost(state), plays: state.plays, final: out, how: how, counts: state.result.counts, overtime: state.result.overtime });
    if (out) { finish(state, now, winner); return; }
    state.phase = 'roundOver';
    state.phaseEndsAt = now + state.timing.roundHoldMs;
  }

  /* The round's time is up: whoever has more cards in their deck loses it (the
     pile belongs to nobody). Level? Play on, and whoever takes the pile next has
     more, so loses; running out of cards still wins. */
  function clockDue(state, now) { return state.roundEndsAt != null && !state.overtime && now >= state.roundEndsAt; }
  function timeUp(state, now) {
    var a = state.players[0], b = state.players[1];
    var diff = a.deck.length - b.deck.length;
    if (!diff) {
      if (!state.overtime) {
        state.overtime = true;
        emit(state, now, { type: 'timeUp', counts: counts(state), level: true, pile: state.pile.length });
      }
      return;
    }
    var loser = diff > 0 ? a : b;
    emit(state, now, { type: 'timeUp', counts: counts(state), loser: loser.id, overtime: state.overtime, pile: state.pile.length });
    endRound(state, now, other(state, loser.id), 'time');
  }

  function finish(state, now, winner) {
    state.phase = 'over';
    state.winners = [winner];
    emit(state, now, { type: 'gameOver', winners: [winner], lost: lost(state), rounds: state.round });
  }

  /* ---------- actions and time ------------------------------------------- */

  function actPlay(state, p, now) {
    if (state.phase !== 'play') return CT.fail('phase', state.phase === 'pickup' ? 'Wait: the pile is being taken.' : 'It isn’t time to play.');
    if (state.turn !== p.id) return CT.fail('turn', 'Wait for your turn.');
    delete state.idle[p.id];   // back in charge
    turnOver(state, p, now, false);
    return CT.ok();
  }

  /* Once a turn, before turning a card over, a player may shuffle their own deck. */
  function actShuffle(state, p, now) {
    if (state.phase !== 'play') return CT.fail('phase', 'It isn’t time to play.');
    if (state.turn !== p.id) return CT.fail('turn', 'You can only shuffle on your turn.');
    if (state.shuffled[p.id]) return CT.fail('again', 'One shuffle a turn. Turn a card over first.');
    if (p.deck.length < 2) return CT.fail('few', 'Nothing to shuffle.');
    p.deck = CT.shuffle(p.deck, state);
    state.shuffled[p.id] = true;
    if (state.idle[p.id]) { delete state.idle[p.id]; state.turnEndsAt = deadline(state, now, p.id); }
    emit(state, now, { type: 'shuffle', player: p.id, left: p.deck.length });
    return CT.ok();
  }

  function act(state, pid, type, payload, now) {
    var p = player(state, pid);
    if (!p) return CT.fail('no-player', 'You’re not in this game.');
    if (state.phase === 'over') return CT.fail('over', 'This game is over.');
    switch (type) {
      case 'play': return actPlay(state, p, now);
      case 'shuffle': return actShuffle(state, p, now);
    }
    return CT.fail('unknown', 'That move doesn’t exist in this game.');
  }

  function tick(state, now) {
    switch (state.phase) {
      case 'dealing':
        if (now < state.phaseEndsAt) return false;
        startPlay(state, now);
        return true;
      case 'play':
        if (clockDue(state, now)) { timeUp(state, now); return true; }
        if (state.turnEndsAt == null || now < state.turnEndsAt) return false;
        var p = player(state, state.turn);
        if (!state.idle[p.id]) emit(state, now, { type: 'timeout', player: p.id });
        state.idle[p.id] = true;
        turnOver(state, p, now, true);
        return true;
      case 'pickup':
        if (now < state.phaseEndsAt) return false;
        pickup(state, now);
        // the pile was already theirs when time ran out; in sudden death, taking it loses
        if (state.overtime || clockDue(state, now)) timeUp(state, now);
        return true;
      case 'roundOver':
        if (now < state.phaseEndsAt) return false;
        deal(state, now, state.result.loser);    // the player who lost starts the next round
        return true;
    }
    return false;
  }

  /* ---------- what one player may see ------------------------------------ */

  function view(state, pid, opts) {
    opts = opts || {};
    var me = player(state, pid);
    var n = allowed(state);
    var v = {
      mode: 'stripme',
      engineVersion: state.engineVersion,
      me: pid,
      phase: state.phase,
      round: state.round,
      options: state.options,
      strip: strip(state),
      garments: strip(state) ? n : 0,
      timing: { dealHoldMs: state.timing.dealHoldMs, pickupHoldMs: state.timing.pickupHoldMs, roundHoldMs: state.timing.roundHoldMs,
        turnMs: roundMs(state) ? state.timing.timedTurnMs : state.timing.turnMs, idleMs: state.timing.idleMs },
      timed: !!roundMs(state),
      roundMs: roundMs(state),
      roundEndsAt: state.roundEndsAt,
      overtime: !!state.overtime,
      phaseEndsAt: state.phaseEndsAt,
      starter: state.starter,
      turn: state.turn,
      turnEndsAt: state.turnEndsAt,
      owe: state.owe,
      demand: state.demand ? { by: state.demand.by, rank: state.demand.rank, n: state.demand.n } : null,
      taker: state.taker,
      players: state.players.map(function (p) {
        return {
          id: p.id, name: p.name, isBot: p.isBot, seat: p.seat,
          count: p.deck.length,                       // how many, never which
          lost: p.lost,
          left: strip(state) ? Math.max(0, n - p.lost) : null,
          isTurn: state.phase === 'play' && state.turn === p.id,
          shuffled: !!state.shuffled[p.id],
          idle: !!state.idle[p.id]
        };
      }),
      pileCount: state.pile.length,
      pileTop: state.pile.slice(-6),                   // face up: everyone has seen them
      plays: state.plays,
      result: state.result,
      winners: state.winners,
      seq: state.seq
    };
    v.canPlay = !!me && state.phase === 'play' && state.turn === pid;
    v.canShuffle = v.canPlay && !state.shuffled[pid] && me.deck.length >= 2;

    if (opts.events !== false) {
      var since = opts.sinceSeq || 0;
      v.events = state.events.filter(function (e) { return e.seq > since; }).map(function (e) {
        var copy = {};
        for (var k in e) copy[k] = e[k];
        return copy;
      });
    }
    return v;
  }

  /* ---------- How to play ------------------------------------------------- */

  function rules(options) {
    var o = CT.resolveOptions(OPTIONS, options);
    var n = Number(o.losses) || 3;
    var timer = Number(o.timer) > 0 ? Number(o.timer) : 0;
    var secs = Math.round((timer ? DEFAULT_TIMING.timedTurnMs : DEFAULT_TIMING.turnMs) / 1000);
    var mins = timer / 60;
    return [
      { title: 'The cards', text: 'Two players. The deck is shuffled and split, 26 cards each, face down. Nobody looks at their cards, not even their own.' },
      { title: 'Your turn', text: 'Take turns turning over the top card of your deck onto the pile in the middle. Tap your deck to do it.' },
      { title: 'Action Cards', text: 'Jacks, Queens, Kings and Aces are Action Cards. Turn one over and the other player has to pay: 1 card for a Jack, 2 for a Queen, 3 for a King, 4 for an Ace, turned over one at a time. Cards from 2 to 10 do nothing.' },
      { title: 'Paying up', text: 'Turn up an Action Card while you’re paying and the rest of your payment is cancelled: now the other player pays for your card. Pay in full without one and you take the whole pile and put it under your deck, and the player who made you pay starts again.' },
      { title: 'Shuffle', text: 'Once a turn, before you turn a card over, you may shuffle your own deck. Nobody knows what’s in it, but it might change your luck.' },
      { title: 'Winning a round', text: 'The first player to turn over their last card wins the round, even in the middle of paying up.' },
      o.mode === 'quick'
        ? { title: 'Quick Play', text: 'One round decides the game: whoever loses it loses the game. No garments come off.' }
        : { title: 'Strip Mode', text: 'Everyone wears ' + n + ' fun garments. Lose a round and one of them comes off; lose all ' + n + ' and you lose the game. Every round is dealt afresh, and whoever lost the last round starts.' },
      timer
        ? { title: 'Round timer', text: 'Each round lasts ' + (mins === 1 ? 'a minute' : ['', '', 'two', 'three'][mins] + ' minutes') + ' at most. When time’s up, whoever has more cards in their deck loses the round; the pile doesn’t count. Level? Play on: whoever picks up the pile next loses.' }
        : { title: 'Round timer', text: 'Off. Choose a round timer and each round lasts one, two or three minutes at most: when time’s up, whoever has more cards loses the round.' },
      { title: 'Time limit', text: (timer ? 'In a timed round, play within ' : 'Play within ') + secs + ' seconds, or a card is turned over for you, and after that your cards keep turning over quickly until you tap again. Switch on Auto at the table and your cards turn over by themselves.' }
    ];
  }

  /* One line for the "game in progress" card on the home screen. */
  function describe(state, pid) {
    var me = player(state, pid), them = player(state, other(state, pid));
    var deck = me ? me.deck.length + ' cards in your deck' : '';
    if (!strip(state)) return 'Quick Play · ' + deck;
    var n = allowed(state);
    return 'Round ' + state.round + ' · ' + deck + ' · garments: you ' + (n - (me ? me.lost : 0)) + ', ' + (them ? them.name : 'them') + ' ' + (n - (them ? them.lost : 0));
  }

  CT.registerMode({
    id: 'stripme',
    name: 'Strip-Me',
    shortName: 'Strip-Me',
    fan: ['KH', 'JS', 'AD'],
    tagline: 'Turn your cards over in turn, make your rival pay with Jacks, Queens, Kings and Aces, and empty your deck first, or lose a garment!',
    handText: '26 cards each, face down',
    engineVersion: ENGINE_VERSION,
    players: { min: SEATS, max: SEATS, default: SEATS },
    options: OPTIONS,
    defaultTiming: DEFAULT_TIMING,
    owed: OWED,
    rules: rules,
    describe: describe,
    createGame: createGame,
    act: act,
    tick: tick,
    view: view,
    presenter: 'stripme'
  });
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
