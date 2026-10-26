/* ==========================================================================
   GAME MODE · BULL — rules
   Three to six players share out the whole deck. Taking turns clockwise,
   each puts one to four cards face down and claims they're the next rank in
   an endless sequence: Aces, then 2s, 3s … Kings, then Aces again. They may
   be lying. After every play anyone may call "Bull!", until the next player
   has played: the cards are turned over, and whoever was wrong (the liar, or
   whoever doubted an honest play) picks up the whole pile. The first to get
   rid of all their cards wins, but that last play can be called too.

   Flow
     dealing ─► play (turn by turn; every play can be called) ─► reveal
       (someone called Bull) ─► play …
     Someone plays their last cards ─► lastcall ─► over, or reveal if called
   Everyone gets a few seconds after each play to call Bull before the next
   player may play; after that, calls are still open until they do.
   Pure rules: every function takes the state and the game time; no timers,
   no DOM. Seats run clockwise in the order of state.players.
   ========================================================================== */
(function (CT) {
  'use strict';

  var ENGINE_VERSION = 1;
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var MAX_PLAY = 4;   // there are only four of each rank
  var NAMES = { A: ['Ace', 'Aces'], J: ['Jack', 'Jacks'], Q: ['Queen', 'Queens'], K: ['King', 'Kings'] };

  /* "Ace", "Aces", "7", "7s": a rank as it's claimed. */
  function rankName(rank, n) {
    var nm = NAMES[rank];
    if (nm) return n === 1 ? nm[0] : nm[1];
    return n === 1 ? rank : rank + 's';
  }

  var DEFAULT_TIMING = {
    dealHoldMs: 1900,        // the deal plays out
    revealMs: 3000,          // the called cards stay face up
    lastCallExtraMs: 1500    // someone's last cards: a little longer to decide
  };

  /* Choices on the setup screen; the rules text and computer players read them too. */
  var OPTIONS = [
    {
      id: 'turnTime',
      label: 'Time to play',
      default: '30',
      choices: [
        { value: '15', label: '15 sec', help: 'You have 15 seconds to play your cards. When time runs out, one card is played for you.' },
        { value: '30', label: '30 sec', help: 'You have 30 seconds to play your cards. When time runs out, one card is played for you.' },
        { value: '60', label: '60 sec', help: 'You have a minute to play your cards. When time runs out, one card is played for you.' }
      ]
    },
    {
      id: 'bullTime',
      label: 'Time to call Bull',
      default: '3',
      choices: [
        { value: '2', label: '2 sec', help: 'After each play, everyone has 2 seconds to call Bull before the next player can play. Quick games.' },
        { value: '3', label: '3 sec', help: 'After each play, everyone has 3 seconds to call Bull before the next player can play.' },
        { value: '5', label: '5 sec', help: 'After each play, everyone has 5 seconds to call Bull before the next player can play. Time to think.' }
      ]
    },
    {
      id: 'bots',
      label: 'Computer players',
      default: 'normal',
      choices: [
        { value: 'easy', label: 'Trusting', help: 'The computer players rarely call Bull and bluff in obvious ways.' },
        { value: 'normal', label: 'Normal', help: 'The computer players call Bull when a claim looks unlikely, and bluff now and then.' },
        { value: 'sharp', label: 'Suspicious', help: 'The computer players call Bull more often and sneak in extra cards when they can.' }
      ]
    }
  ];

  /* ---------- helpers ---------------------------------------------------- */

  function player(state, pid) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === pid) return state.players[i];
    return null;
  }

  /* The next seat clockwise. */
  function nextAfter(state, pid) {
    var ps = state.players;
    for (var i = 0; i < ps.length; i++) if (ps[i].id === pid) return ps[(i + 1) % ps.length].id;
    return null;
  }

  function turnMs(state) {
    if (state.timing.turnMs != null) return state.timing.turnMs;    // tests and lessons
    return (Number(state.options.turnTime) || 30) * 1000;
  }
  function bullMs(state) {
    if (state.timing.bullMs != null) return state.timing.bullMs;
    return (Number(state.options.bullTime) || 3) * 1000;
  }
  function turnDeadline(state, from) { var ms = turnMs(state); return ms ? from + ms : null; }

  function pileCount(state) {
    var n = 0;
    state.pile.forEach(function (pl) { n += pl.cards.length; });
    return n;
  }

  function counts(state) {
    var out = {};
    state.players.forEach(function (p) { out[p.id] = p.hand.length; });
    return out;
  }

  function emit(state, now, ev, secret) {
    state.seq += 1;
    ev.seq = state.seq;
    ev.t = Math.round(now);
    if (secret) ev.secret = secret;
    state.events.push(ev);
    if (state.events.length > 400) state.events.splice(0, state.events.length - 400);
  }

  /* ---------- setup ------------------------------------------------------ */

  function createGame(config) {
    var players = config.players || [];
    if (players.length < 3 || players.length > 6) throw new Error('Bull needs 3 to 6 players');
    var now = config.now || 0;
    var timing = {};
    for (var k in DEFAULT_TIMING) timing[k] = DEFAULT_TIMING[k];
    if (config.timing) for (var t in config.timing) timing[t] = config.timing[t];

    var state = {
      mode: 'bull',
      engineVersion: ENGINE_VERSION,
      rng: ((config.seed != null ? config.seed : Date.now()) >>> 0) || 1,
      options: CT.resolveOptions(OPTIONS, config.options),
      timing: timing,
      players: players.map(function (p, i) {
        return { id: p.id, name: p.name, isBot: !!p.isBot, seat: i, hand: [] };
      }),
      phase: 'dealing',
      phaseEndsAt: now + timing.dealHoldMs,
      starter: null,
      turn: null,         // whose turn it is to play
      turnEndsAt: null,   // when time runs out for them
      openAt: null,       // they may play from here (everyone's had a moment to call Bull)
      rank: 0,            // the rank they must claim: an index into RANKS
      pile: [],           // face-down plays since the pile was last picked up: { by, rank, cards }
      last: null,         // the play that can be called: { by, rank, n, at, no }
      plays: 0,
      reveal: null,       // a call being shown: { challenger, accused, rank, n, cards, lie, taker, count, wasLast, no }
      winners: null,
      seq: 0,
      events: []
    };

    // the whole deck, one card at a time clockwise from the player who starts
    var deck = CT.shuffle(CT.standardDeck(), state);
    var start = state.players.indexOf(CT.pickRandom(state.players, state));
    state.starter = state.players[start].id;
    deck.forEach(function (c, i) { state.players[(start + i) % state.players.length].hand.push(c); });
    var secret = {};
    state.players.forEach(function (p) { secret[p.id] = { hand: p.hand.slice() }; });
    var order = [];
    for (var i = 0; i < state.players.length; i++) order.push(state.players[(start + i) % state.players.length].id);
    emit(state, now, { type: 'deal', starter: state.starter, order: order, counts: counts(state) }, secret);
    return state;
  }

  function startPlay(state, now) {
    state.phase = 'play';
    state.turn = state.starter;
    state.rank = 0;
    state.openAt = now;
    state.turnEndsAt = turnDeadline(state, now);
    emit(state, now, { type: 'start', player: state.starter, rank: RANKS[0] });
  }

  /* ---------- playing ---------------------------------------------------- */

  /* Cards go face down on the pile, claimed as the rank in sequence. Only
     the player knows what they really are. */
  function lay(state, p, cards, now, auto) {
    var rank = state.rank;
    state.plays += 1;
    state.pile.push({ by: p.id, rank: rank, cards: cards });
    state.last = { by: p.id, rank: rank, n: cards.length, at: now, no: state.plays };
    var secret = {};
    secret[p.id] = { cards: cards.slice() };
    emit(state, now, { type: 'play', player: p.id, rank: RANKS[rank], n: cards.length, no: state.plays,
      auto: !!auto, pile: pileCount(state), left: p.hand.length }, secret);
    state.rank = (rank + 1) % RANKS.length;
    state.turn = nextAfter(state, p.id);
    if (!p.hand.length) {
      // their last cards: one last chance to call Bull before they win
      state.phase = 'lastcall';
      state.phaseEndsAt = now + bullMs(state) + state.timing.lastCallExtraMs;
      state.openAt = null;
      state.turnEndsAt = null;
      emit(state, now, { type: 'lastCall', player: p.id });
      return;
    }
    state.openAt = now + bullMs(state);
    state.turnEndsAt = turnDeadline(state, state.openAt);
  }

  function actPlay(state, p, cardIds, now) {
    if (state.phase !== 'play') return CT.fail('phase', 'It isn’t time to play.');
    if (state.turn !== p.id) return CT.fail('turn', 'Wait for your turn.');
    if (now < state.openAt) return CT.fail('wait', 'Give everyone a moment to call Bull.', { retryInMs: Math.max(0, state.openAt - now) });
    var ids = [];
    (Array.isArray(cardIds) ? cardIds : []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    if (!ids.length) return CT.fail('none', 'Pick at least one card to play.');
    if (ids.length > MAX_PLAY) return CT.fail('many', 'You can play up to four cards at a time.');
    var cards = [];
    for (var i = 0; i < ids.length; i++) {
      var c = p.hand.filter(function (x) { return x.id === ids[i]; })[0];
      if (!c) return CT.fail('card', 'That card isn’t in your hand.');
      cards.push(c);
    }
    p.hand = p.hand.filter(function (x) { return ids.indexOf(x.id) < 0; });
    var claimed = RANKS[state.rank];
    lay(state, p, cards, now, false);
    return CT.ok({ n: cards.length, rank: claimed });
  }

  /* Time ran out: one card goes down for them, a true one if they have it. */
  function playTimeout(state, now) {
    var p = player(state, state.turn);
    emit(state, now, { type: 'timeout', player: p.id });
    var want = RANKS[state.rank];
    var card = p.hand.filter(function (c) { return c.rank === want; })[0] || CT.pickRandom(p.hand, state);
    p.hand = p.hand.filter(function (c) { return c.id !== card.id; });
    lay(state, p, [card], now, true);
  }

  /* ---------- calling Bull ------------------------------------------------ */

  function actBull(state, p, now) {
    if (state.phase !== 'play' && state.phase !== 'lastcall') return CT.fail('phase', 'There’s nothing to call Bull on right now.');
    var last = state.last;
    if (!last) return CT.fail('nothing', 'There’s nothing to call Bull on right now.');
    if (last.by === p.id) return CT.fail('self', 'You can’t call Bull on your own cards.');
    var play = state.pile[state.pile.length - 1];
    var want = RANKS[last.rank];
    var lie = play.cards.some(function (c) { return c.rank !== want; });
    state.reveal = {
      challenger: p.id, accused: last.by, rank: want, n: last.n, cards: play.cards.slice(),
      lie: lie, taker: lie ? last.by : p.id, count: pileCount(state), wasLast: state.phase === 'lastcall', no: last.no
    };
    state.last = null;
    state.phase = 'reveal';
    state.phaseEndsAt = now + state.timing.revealMs;
    state.openAt = null;
    state.turnEndsAt = null;
    var r = state.reveal;
    emit(state, now, { type: 'bull', challenger: r.challenger, accused: r.accused, rank: r.rank, n: r.n,
      cards: r.cards.slice(), lie: lie, taker: r.taker, count: r.count, wasLast: r.wasLast, no: r.no });
    return CT.ok({ lie: lie });
  }

  /* Whoever was wrong takes the whole pile. If someone went out honestly,
     they've won; otherwise the player whose turn it was carries on. */
  function settle(state, now) {
    var r = state.reveal;
    var taker = player(state, r.taker);
    var cards = [];
    state.pile.forEach(function (pl) { pl.cards.forEach(function (c) { cards.push(c); }); });
    taker.hand = taker.hand.concat(cards);
    state.pile = [];
    var secret = {};
    secret[r.taker] = { cards: cards.slice() };
    emit(state, now, { type: 'pickup', player: r.taker, count: cards.length, counts: counts(state) }, secret);
    if (r.wasLast && !r.lie) { finish(state, now, r.accused); return; }
    state.reveal = null;
    state.phase = 'play';
    state.openAt = now;
    state.turnEndsAt = turnDeadline(state, now);
    emit(state, now, { type: 'resume', player: state.turn, rank: RANKS[state.rank] });
  }

  function finish(state, now, winner) {
    state.phase = 'over';
    state.winners = [winner];
    state.turn = null;
    state.turnEndsAt = null;
    state.openAt = null;
    emit(state, now, { type: 'gameOver', winners: [winner], counts: counts(state) });
  }

  /* ---------- actions and time ------------------------------------------- */

  function act(state, pid, type, payload, now) {
    var p = player(state, pid);
    if (!p) return CT.fail('no-player', 'You’re not in this game.');
    payload = payload || {};
    switch (type) {
      case 'play': return actPlay(state, p, payload.cardIds, now);
      case 'bull': return actBull(state, p, now);
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
        if (state.turnEndsAt == null || now < state.turnEndsAt) return false;
        playTimeout(state, now);
        return true;
      case 'lastcall':
        if (now < state.phaseEndsAt) return false;
        finish(state, now, state.last.by);       // nobody called: they're out
        return true;
      case 'reveal':
        if (now < state.phaseEndsAt) return false;
        settle(state, now);
        return true;
    }
    return false;
  }

  /* ---------- what one player may see ------------------------------------ */

  function view(state, pid, opts) {
    opts = opts || {};
    var me = player(state, pid);
    var last = state.last, r = state.reveal;
    var v = {
      mode: 'bull',
      engineVersion: state.engineVersion,
      me: pid,
      phase: state.phase,
      options: state.options,
      timing: { turnMs: turnMs(state), bullMs: bullMs(state), revealMs: state.timing.revealMs, lastCallMs: bullMs(state) + state.timing.lastCallExtraMs },
      phaseEndsAt: state.phaseEndsAt,
      starter: state.starter,
      turn: state.turn,
      turnEndsAt: state.turnEndsAt,
      openAt: state.openAt,
      rank: RANKS[state.rank],
      rankIdx: state.rank,
      hand: me ? me.hand.slice() : [],
      players: state.players.map(function (p) {
        return { id: p.id, name: p.name, isBot: p.isBot, seat: p.seat, handCount: p.hand.length, isTurn: state.phase === 'play' && state.turn === p.id };
      }),
      pileCount: pileCount(state),
      // what has been claimed on the pile (everyone heard), never what the cards are
      pilePlays: state.pile.map(function (pl) { return { by: pl.by, rank: RANKS[pl.rank], n: pl.cards.length }; }),
      last: last ? { by: last.by, rank: RANKS[last.rank], n: last.n, at: last.at, no: last.no } : null,
      reveal: r ? { challenger: r.challenger, accused: r.accused, rank: r.rank, n: r.n, cards: r.cards.slice(), lie: r.lie,
        taker: r.taker, count: r.count, wasLast: r.wasLast, no: r.no } : null,
      plays: state.plays,
      winners: state.winners,
      seq: state.seq
    };
    // the cards you put on the pile yourself: you know what they are
    v.myPileCards = [];
    state.pile.forEach(function (pl) { if (pl.by === pid) pl.cards.forEach(function (c) { v.myPileCards.push(c); }); });
    v.canPlay = !!me && state.phase === 'play' && state.turn === pid && me.hand.length > 0;
    v.canBull = !!me && (state.phase === 'play' || state.phase === 'lastcall') && !!last && last.by !== pid;

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

  /* ---------- How to play ------------------------------------------------- */

  function rules(options) {
    var o = CT.resolveOptions(OPTIONS, options);
    var turn = Number(o.turnTime) || 30, call = Number(o.bullTime) || 3;
    return [
      { title: 'The cards', text: 'Three to six players. The whole deck is dealt out, so some players may get a card more than others. Keep your cards hidden.' },
      { title: 'Your turn', text: 'Players take turns clockwise. On your turn, put one to four cards face down on the pile and claim they’re the rank in sequence: the first player plays Aces, the next 2s, then 3s, and so on up to Kings, then back to Aces. The app announces your claim, such as “two 7s”.' },
      { title: 'Bluffing', text: 'Your cards don’t have to be what you claim. If you have no 7s when it’s your turn for 7s, you’ll have to bluff, and you can bluff even when you do have them.' },
      { title: 'Bull!', text: 'If you think the last player lied, call Bull! Anyone can call, but only on the last play, and only until the next player has played. After each play everyone has ' + call + ' seconds to call before the next player can go.' },
      { title: 'Who picks up', text: 'The cards that were called are turned over. If any of them isn’t what was claimed, the liar picks up the whole pile. If they told the truth, whoever called Bull picks up the whole pile instead. Then play carries on with the next rank.' },
      { title: 'Winning', text: 'The first player to get rid of all their cards wins. When someone plays their last cards, everyone gets one last chance to call Bull. If they were bluffing, they pick up the pile and play on.' },
      { title: 'Time limit', text: 'You have ' + turn + ' seconds to play. When time runs out, one card is played for you: a true one if you have it.' }
    ];
  }

  /* One line for the "game in progress" card on the home screen. */
  function describe(state, pid) {
    var me = player(state, pid);
    var n = me ? me.hand.length : 0;
    return (n === 1 ? '1 card' : n + ' cards') + ' in your hand · ' + rankName(RANKS[state.rank], 2) + ' next';
  }

  CT.registerMode({
    id: 'bull',
    name: 'Bull',
    shortName: 'Bull',
    fan: ['7S', '7D', 'QC'],
    tagline: 'Play your cards face down and claim they’re the next rank. Bluff your way out, or call Bull on a liar.',
    handText: 'the whole deck dealt out',
    engineVersion: ENGINE_VERSION,
    players: { min: 3, max: 6, default: 4 },
    options: OPTIONS,
    defaultTiming: DEFAULT_TIMING,
    ranks: RANKS,
    rankName: rankName,
    maxPlay: MAX_PLAY,
    rules: rules,
    describe: describe,
    createGame: createGame,
    act: act,
    tick: tick,
    view: view,
    presenter: 'bull'
  });
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
