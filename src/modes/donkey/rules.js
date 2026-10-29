/* ==========================================================================
   GAME MODE · PASS-ROUN DONKEY — rules
   Exactly four players and sixteen cards: the Jacks, Queens, Kings and Aces.
   One card at a time travels clockwise round the circle. Whoever gathers
   four of a kind passes on their spare card and puts the four down; then
   everyone else races to put their cards down too, and the slowest gets the
   next letter of DONKEY. Spell the whole word and you lose. Players tied on
   letters at the end settle their places with a higher-or-lower duel.

   Flow
     dealing ─► pass ─► declared (the four land) ─► race ─► roundEnd ─►
     dealing … until someone has all six letters ─► tiebreak (only when
     placings are tied) ─► over
   Pure rules: every function takes the state and the game time; no timers,
   no DOM. Seats run clockwise in the order of state.players.
   ========================================================================== */
(function (CT) {
  'use strict';

  var ENGINE_VERSION = 1;
  var SEATS = 4;
  var HAND_SIZE = 4;
  var RANKS = ['J', 'Q', 'K', 'A'];
  var WORD = 'DONKEY';
  var CALLS = ['lower', 'equal', 'higher'];

  var DEFAULT_TIMING = {
    dealHoldMs: 1700,     // look at the new hand before the first pass
    raceDelayMs: 450,     // the four land on the table, then the race is on
    raceMs: 6000,         // anyone whose cards aren't down by then counts as last
    roundHoldMs: 4600,    // the round's result stays on screen
    duelChoiceMs: 20000,  // tie-breaker: time to pick an opponent or make the call
    duelHoldMs: 3600      // tie-breaker: the revealed cards stay on screen
  };

  /* Choices on the setup screen; the rules text and bots read them too. */
  var OPTIONS = [
    {
      id: 'passTime',
      label: 'Time to pass',
      default: '15',
      choices: [
        { value: '10', label: '10 sec', help: 'You have 10 seconds to pass a card on. When time runs out, a random card is passed for you.' },
        { value: '15', label: '15 sec', help: 'You have 15 seconds to pass a card on. When time runs out, a random card is passed for you.' },
        { value: '30', label: '30 sec', help: 'You have 30 seconds to pass a card on. When time runs out, a random card is passed for you.' }
      ]
    },
    {
      id: 'reflexes',
      label: 'Computer reflexes',
      default: 'normal',
      choices: [
        { value: 'relaxed', label: 'Relaxed', help: 'The computer players are slow to put their cards down, so they’re easy to beat.' },
        { value: 'normal', label: 'Normal', help: 'The computer players are about as quick as an alert person.' },
        { value: 'sharp', label: 'Sharp', help: 'The computer players put their cards down very quickly. Hard to beat.' }
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

  function passMs(state) {
    if (state.timing.passMs != null) return state.timing.passMs;   // tests and lessons
    return (Number(state.options.passTime) || 15) * 1000;
  }
  /* When the current pass must happen by; 0 ms means no limit (the tutorial). */
  function passDeadline(state, now) { var ms = passMs(state); return ms ? now + ms : null; }

  /* The rank a hand holds four of, or null. */
  function fourOf(hand) {
    var n = {};
    for (var i = 0; i < hand.length; i++) {
      var r = hand[i].rank;
      n[r] = (n[r] || 0) + 1;
      if (n[r] === 4) return r;
    }
    return null;
  }

  function removeCard(hand, cardId) {
    for (var i = 0; i < hand.length; i++) if (hand[i].id === cardId) return hand.splice(i, 1)[0];
    return null;
  }

  function sixteen() {
    return CT.standardDeck().filter(function (c) { return RANKS.indexOf(c.rank) >= 0; });
  }

  function letters(state) {
    var out = {};
    state.players.forEach(function (p) { out[p.id] = p.letters; });
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

  /* Which call is most likely right for this card (aces high, 2 low). */
  function bestCall(card, coin) {
    var v = CT.rankValue(card.rank, true);   // 2 → 1 … A → 13
    var iWin = (v - 1) * 4, iLose = (13 - v) * 4;   // of the other 51 cards
    if (iWin === iLose) return coin < 0.5 ? 'lower' : 'higher';
    return iWin > iLose ? 'higher' : 'lower';
  }

  /* ---------- setup ------------------------------------------------------ */

  function createGame(config) {
    var players = config.players || [];
    if (players.length !== SEATS) throw new Error('Pass-Roun Donkey needs exactly four players');
    var now = config.now || 0;
    var timing = {};
    for (var k in DEFAULT_TIMING) timing[k] = DEFAULT_TIMING[k];
    if (config.timing) for (var t in config.timing) timing[t] = config.timing[t];

    var state = {
      mode: 'donkey',
      engineVersion: ENGINE_VERSION,
      rng: ((config.seed != null ? config.seed : Date.now()) >>> 0) || 1,
      options: CT.resolveOptions(OPTIONS, config.options),
      timing: timing,
      players: players.map(function (p, i) {
        return { id: p.id, name: p.name, isBot: !!p.isBot, seat: i, hand: [], letters: 0 };
      }),
      round: 0,
      phase: 'dealing',
      phaseEndsAt: 0,
      starter: null,
      turn: null,        // whose turn it is to pass
      turnEndsAt: null,
      passes: 0,
      declare: null,     // { player, rank, cards, extraTo }
      race: null,        // { startAt, endsAt, racers, order: [{ player, ms }] }
      result: null,      // the round just finished
      tiebreak: null,
      standings: null,   // player ids by final place, best first
      winners: null,
      seq: 0,
      events: []
    };
    deal(state, now);
    return state;
  }

  function deal(state, now) {
    state.round += 1;
    var deck = CT.shuffle(sixteen(), state);
    state.players.forEach(function (p) { p.hand = deck.splice(0, HAND_SIZE); });
    state.starter = CT.pickRandom(state.players, state).id;
    state.turn = null;
    state.turnEndsAt = null;
    state.passes = 0;
    state.declare = null;
    state.race = null;
    state.result = null;
    state.phase = 'dealing';
    state.phaseEndsAt = now + state.timing.dealHoldMs;
    var secret = {};
    state.players.forEach(function (p) { secret[p.id] = { hand: p.hand.slice() }; });
    emit(state, now, { type: 'deal', round: state.round, starter: state.starter, handSize: HAND_SIZE,
      order: state.players.map(function (p) { return p.id; }) }, secret);
  }

  function startPassing(state, now) {
    state.phase = 'pass';
    state.turn = state.starter;
    state.turnEndsAt = passDeadline(state, now);
    emit(state, now, { type: 'passStart', round: state.round, player: state.starter });
  }

  /* ---------- passing ---------------------------------------------------- */

  /* Hand a card to the next seat. The giver and receiver both know what it
     was; everyone else only sees a card go by. A spare card passed on while
     declaring doesn't move the turn. */
  function passCard(state, p, card, now, auto, spare) {
    var to = player(state, nextAfter(state, p.id));
    to.hand.push(card);
    state.passes += 1;
    var secret = {};
    secret[p.id] = { card: card };
    secret[to.id] = { card: card };
    emit(state, now, { type: 'pass', from: p.id, to: to.id, n: state.passes, auto: !!auto, spare: !!spare }, secret);
    if (!spare) {
      state.turn = to.id;
      state.turnEndsAt = passDeadline(state, now);
    }
  }

  function actPass(state, p, cardId, now) {
    if (state.phase !== 'pass') return CT.fail('phase', 'It isn’t time to pass a card.');
    if (state.turn !== p.id) return CT.fail('turn', 'Wait for your turn to pass.');
    var card = removeCard(p.hand, cardId);
    if (!card) return CT.fail('card', 'That card isn’t in your hand.');
    passCard(state, p, card, now, false, false);
    return CT.ok({ card: card });
  }

  /* Four of a kind: pass the spare card on (if there is one), then put the
     four down. Anyone holding four may do it while cards are being passed,
     including straight after the deal. */
  function actDeclare(state, p, now, auto) {
    if (state.phase !== 'pass') return CT.fail('phase', 'You can only put down four of a kind while cards are being passed.');
    var rank = fourOf(p.hand);
    if (!rank) return CT.fail('no-four', 'You need four cards of the same rank.');
    var spare = p.hand.filter(function (c) { return c.rank !== rank; });
    var four = p.hand.filter(function (c) { return c.rank === rank; });
    p.hand = [];
    spare.forEach(function (c) { passCard(state, p, c, now, auto, true); });
    var extraTo = spare.length ? nextAfter(state, p.id) : null;
    state.declare = { player: p.id, rank: rank, cards: four, extraTo: extraTo };
    state.turn = null;
    state.turnEndsAt = null;
    state.race = {
      startAt: null,
      endsAt: null,
      racers: state.players.filter(function (x) { return x.id !== p.id; }).map(function (x) { return x.id; }),
      order: []
    };
    state.phase = 'declared';
    state.phaseEndsAt = now + state.timing.raceDelayMs;
    emit(state, now, { type: 'declare', player: p.id, rank: rank, cards: four.slice(), extraTo: extraTo, auto: !!auto });
    return CT.ok({ rank: rank });
  }

  function passTimeout(state, now) {
    var p = player(state, state.turn);
    emit(state, now, { type: 'timeout', phase: 'pass', player: p.id });
    if (fourOf(p.hand)) { actDeclare(state, p, now, true); return; }
    var card = removeCard(p.hand, CT.pickRandom(p.hand, state).id);
    passCard(state, p, card, now, true, false);
  }

  /* ---------- the race --------------------------------------------------- */

  function startRace(state, now) {
    state.phase = 'race';
    state.race.startAt = now;
    state.race.endsAt = now + state.timing.raceMs;
    emit(state, now, { type: 'raceStart', racers: state.race.racers.slice() });
  }

  function reacted(race, pid) {
    for (var i = 0; i < race.order.length; i++) if (race.order[i].player === pid) return true;
    return false;
  }

  /* Online, a player's tap reaches the table a moment after they made it, so
     their device reports how long they took from the moment the race showed
     on their screen. The claim is believed, but never faster than a person
     can react, and never slower than what the table saw. */
  var MIN_REACT_MS = 100;

  function actReact(state, p, now, claimedMs) {
    var race = state.race;
    if (state.declare && state.declare.player === p.id) return CT.fail('safe', 'You put the four down, so you’re safe this round.');
    if (state.phase === 'declared') return CT.fail('early', 'Not yet!', { retryInMs: Math.max(0, state.phaseEndsAt - now) });
    if (state.phase !== 'race' || !race) return CT.fail('phase', 'Nobody has put down four of a kind.');
    if (race.racers.indexOf(p.id) < 0) return CT.fail('safe', 'You’re not in this race.');
    if (reacted(race, p.id)) return CT.fail('done', 'Your cards are already down.');
    var ms = Math.max(0, Math.round(now - race.startAt));
    if (typeof claimedMs === 'number' && isFinite(claimedMs)) ms = Math.min(ms, Math.max(MIN_REACT_MS, Math.round(claimedMs)));
    race.order.push({ player: p.id, ms: ms });
    // fastest first (a reported time can come in after a slower one)
    race.order.sort(function (a, b) { return a.ms - b.ms; });
    var place = 1 + race.order.map(function (o) { return o.player; }).indexOf(p.id);
    emit(state, now, { type: 'react', player: p.id, ms: ms, place: place });
    if (race.order.length === race.racers.length) finishRace(state, now);
    return CT.ok({ ms: ms, place: place });
  }

  /* The slowest gets the next letter. Anyone who never reacted counts as
     slowest; if that's more than one player, each of them gets a letter. */
  function finishRace(state, now) {
    var race = state.race, d = state.declare;
    var late = race.racers.filter(function (pid) { return !reacted(race, pid); });
    var losers = late.length ? late : [race.order[race.order.length - 1].player];
    losers.forEach(function (pid) { player(state, pid).letters += 1; });
    state.result = { round: state.round, declarer: d.player, rank: d.rank, order: race.order.slice(), late: late, losers: losers };
    state.phase = 'roundEnd';
    state.phaseEndsAt = now + state.timing.roundHoldMs;
    emit(state, now, { type: 'roundEnd', round: state.round, declarer: d.player, rank: d.rank,
      order: race.order.slice(), late: late, losers: losers, letters: letters(state) });
  }

  /* ---------- the end and the tie-breaker -------------------------------- */

  /* Rank by letters, fewest first. Groups with the same count go to the
     tie-breaker, which fills their places from the bottom up. */
  function startEnd(state, now) {
    var byCount = {};
    state.players.forEach(function (p) { (byCount[p.letters] = byCount[p.letters] || []).push(p.id); });
    var counts = Object.keys(byCount).map(Number).sort(function (a, b) { return a - b; });
    state.standings = [];
    for (var i = 0; i < SEATS; i++) state.standings.push(null);
    var place = 0, queue = [];
    counts.forEach(function (n) {
      var group = byCount[n];
      if (group.length === 1) state.standings[place] = group[0];
      else queue.push({ place: place, remaining: group.slice(), out: [] });
      place += group.length;
    });
    emit(state, now, { type: 'gameEnd', letters: letters(state),
      donkeys: state.players.filter(function (p) { return p.letters >= WORD.length; }).map(function (p) { return p.id; }) });
    if (!queue.length) { finish(state, now); return; }
    state.tiebreak = { queue: queue, group: null, duel: null, n: 0 };
    state.phase = 'tiebreak';
    emit(state, now, { type: 'tiebreakStart', groups: queue.map(function (g) { return { place: g.place, players: g.remaining.slice() }; }) });
    nextGroup(state, now);
  }

  function nextGroup(state, now) {
    var tb = state.tiebreak;
    tb.group = tb.queue.shift() || null;
    if (!tb.group) { finish(state, now); return; }
    startDuel(state, now);
  }

  function startDuel(state, now) {
    var tb = state.tiebreak, g = tb.group;
    tb.n += 1;
    var challenger = CT.pickRandom(g.remaining, state);
    tb.duel = {
      n: tb.n, place: g.place, players: g.remaining.slice(),
      challenger: challenger, opponent: null, cards: null, call: null, result: null,
      step: 'choose', endsAt: now + state.timing.duelChoiceMs
    };
    emit(state, now, { type: 'duelStart', n: tb.n, place: g.place, players: g.remaining.slice(), challenger: challenger });
    var rivals = g.remaining.filter(function (pid) { return pid !== challenger; });
    if (rivals.length === 1) setOpponent(state, rivals[0], now, false);   // only one to pick
  }

  /* Both draw from a freshly shuffled full deck; each sees only their own card. */
  function setOpponent(state, target, now, auto) {
    var d = state.tiebreak.duel;
    var deck = CT.shuffle(CT.standardDeck(), state);
    d.opponent = target;
    d.cards = {};
    d.cards[d.challenger] = deck[0];
    d.cards[target] = deck[1];
    d.step = 'call';
    d.endsAt = now + state.timing.duelChoiceMs;
    var secret = {};
    secret[d.challenger] = { card: deck[0] };
    secret[target] = { card: deck[1] };
    emit(state, now, { type: 'duelDraw', n: d.n, challenger: d.challenger, opponent: target, auto: !!auto }, secret);
  }

  function duelOf(state) { return state.phase === 'tiebreak' && state.tiebreak ? state.tiebreak.duel : null; }

  function actChallenge(state, p, target, now, auto) {
    var d = duelOf(state);
    if (!d || d.step !== 'choose') return CT.fail('phase', 'There’s nobody to challenge right now.');
    if (d.challenger !== p.id) return CT.fail('turn', 'Only the challenger picks an opponent.');
    if (target === p.id || d.players.indexOf(target) < 0) return CT.fail('target', 'Pick another player from the tie.');
    setOpponent(state, target, now, auto);
    return CT.ok();
  }

  /* Right call: the opponent is out. Wrong call: the challenger is out.
     Whoever goes out takes the lowest place still open in the group. */
  function actCall(state, p, call, now, auto) {
    var d = duelOf(state);
    if (!d || d.step !== 'call') return CT.fail('phase', 'There’s no call to make right now.');
    if (d.challenger !== p.id) return CT.fail('turn', 'Only the challenger makes the call.');
    if (CALLS.indexOf(call) < 0) return CT.fail('call', 'Call lower, equal or higher.');
    var mine = CT.rankValue(d.cards[d.challenger].rank, true);
    var theirs = CT.rankValue(d.cards[d.opponent].rank, true);
    var truth = mine < theirs ? 'lower' : mine > theirs ? 'higher' : 'equal';
    var right = call === truth;
    var out = right ? d.opponent : d.challenger;
    var g = state.tiebreak.group;
    var place = g.place + g.remaining.length - 1;
    state.standings[place] = out;
    g.out.push(out);
    g.remaining = g.remaining.filter(function (pid) { return pid !== out; });
    d.call = call;
    d.result = { truth: truth, right: right, out: out, place: place };
    d.step = 'reveal';
    d.endsAt = now + state.timing.duelHoldMs;
    var cards = {};
    cards[d.challenger] = d.cards[d.challenger];
    cards[d.opponent] = d.cards[d.opponent];
    emit(state, now, { type: 'duel', n: d.n, challenger: d.challenger, opponent: d.opponent, call: call, auto: !!auto,
      cards: cards, truth: truth, right: right, out: out, place: place });
    return CT.ok({ right: right });
  }

  function tickTiebreak(state, now) {
    var tb = state.tiebreak, d = tb && tb.duel;
    if (!d || now < d.endsAt) return false;
    var challenger = player(state, d.challenger);
    if (d.step === 'choose') {
      emit(state, now, { type: 'timeout', phase: 'choose', player: d.challenger });
      var rivals = d.players.filter(function (pid) { return pid !== d.challenger; });
      actChallenge(state, challenger, CT.pickRandom(rivals, state), now, true);
      return true;
    }
    if (d.step === 'call') {
      emit(state, now, { type: 'timeout', phase: 'call', player: d.challenger });
      actCall(state, challenger, bestCall(d.cards[d.challenger], CT.rand(state)), now, true);
      return true;
    }
    // reveal is over: the next duel, the next tied group, or the end
    var g = tb.group;
    if (g.remaining.length === 1) {
      state.standings[g.place] = g.remaining[0];
      emit(state, now, { type: 'tieSettled', place: g.place, first: g.remaining[0], out: g.out.slice() });
      nextGroup(state, now);
    } else {
      startDuel(state, now);
    }
    return true;
  }

  function finish(state, now) {
    state.phase = 'over';
    state.winners = [state.standings[0]];
    emit(state, now, { type: 'gameOver', standings: state.standings.slice(), winners: state.winners.slice(), letters: letters(state) });
  }

  /* ---------- actions and time ------------------------------------------- */

  function act(state, pid, type, payload, now) {
    var p = player(state, pid);
    if (!p) return CT.fail('no-player', 'You’re not in this game.');
    payload = payload || {};
    switch (type) {
      case 'pass': return actPass(state, p, payload.cardId, now);
      case 'declare': return actDeclare(state, p, now, false);
      case 'react': return actReact(state, p, now, payload.ms);
      case 'challenge': return actChallenge(state, p, payload.target, now, false);
      case 'call': return actCall(state, p, payload.call, now, false);
    }
    return CT.fail('unknown', 'That move doesn’t exist in this game.');
  }

  function tick(state, now) {
    switch (state.phase) {
      case 'dealing':
        if (now < state.phaseEndsAt) return false;
        startPassing(state, now);
        return true;
      case 'pass':
        if (state.turnEndsAt == null || now < state.turnEndsAt) return false;
        passTimeout(state, now);
        return true;
      case 'declared':
        if (now < state.phaseEndsAt) return false;
        startRace(state, now);
        return true;
      case 'race':
        if (now < state.race.endsAt) return false;
        finishRace(state, now);
        return true;
      case 'roundEnd':
        if (now < state.phaseEndsAt) return false;
        var spelled = state.players.some(function (p) { return p.letters >= WORD.length; });
        if (spelled) startEnd(state, now); else deal(state, now);
        return true;
      case 'tiebreak':
        return tickTiebreak(state, now);
    }
    return false;
  }

  /* ---------- what one player may see ------------------------------------ */

  function view(state, pid, opts) {
    opts = opts || {};
    var me = player(state, pid);
    var race = state.race, d = state.tiebreak ? state.tiebreak.duel : null;
    var v = {
      mode: 'donkey',
      engineVersion: state.engineVersion,
      me: pid,
      word: WORD,
      phase: state.phase,
      round: state.round,
      options: state.options,
      timing: {
        passMs: passMs(state), raceDelayMs: state.timing.raceDelayMs, raceMs: state.timing.raceMs,
        roundHoldMs: state.timing.roundHoldMs, duelChoiceMs: state.timing.duelChoiceMs, duelHoldMs: state.timing.duelHoldMs
      },
      phaseEndsAt: state.phaseEndsAt,
      starter: state.starter,
      turn: state.turn,
      turnEndsAt: state.turnEndsAt,
      passes: state.passes,
      hand: me ? me.hand.slice() : [],
      players: state.players.map(function (p) {
        return {
          id: p.id, name: p.name, isBot: p.isBot, seat: p.seat,
          handCount: p.hand.length,
          letters: p.letters,
          isTurn: state.phase === 'pass' && state.turn === p.id,
          down: !!(race && reacted(race, p.id)),
          declared: !!(state.declare && state.declare.player === p.id)
        };
      }),
      declare: state.declare ? {
        player: state.declare.player, rank: state.declare.rank,
        cards: state.declare.cards.slice(), extraTo: state.declare.extraTo
      } : null,
      race: race ? { startAt: race.startAt, endsAt: race.endsAt, racers: race.racers.slice(), order: race.order.slice() } : null,
      result: state.result,
      tiebreak: null,
      standings: state.standings ? state.standings.slice() : null,
      winners: state.winners,
      seq: state.seq
    };
    if (state.tiebreak) {
      v.tiebreak = {
        groups: state.tiebreak.queue.map(function (g) { return { place: g.place, players: g.remaining.slice() }; }),
        duel: d ? {
          n: d.n, place: d.place, players: d.players.slice(),
          challenger: d.challenger, opponent: d.opponent, step: d.step, endsAt: d.endsAt, call: d.call,
          myCard: d.cards && d.cards[pid] ? d.cards[pid] : null,   // only your own card until the reveal
          cards: d.step === 'reveal' ? JSON.parse(JSON.stringify(d.cards)) : null,
          result: d.result
        } : null
      };
    }
    v.myFour = me ? fourOf(me.hand) : null;
    v.canPass = !!me && state.phase === 'pass' && state.turn === pid;
    v.canDeclare = !!me && state.phase === 'pass' && !!v.myFour;
    v.canReact = !!me && state.phase === 'race' && race.racers.indexOf(pid) >= 0 && !reacted(race, pid);
    v.canChallenge = !!(d && d.step === 'choose' && d.challenger === pid && state.phase === 'tiebreak');
    v.canCall = !!(d && d.step === 'call' && d.challenger === pid && state.phase === 'tiebreak');

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
    var secs = Number(o.passTime) || 15;
    return [
      { title: 'The cards', text: 'Four players sit in a circle. Only the Jacks, Queens, Kings and Aces are used, 16 cards in all, and everyone gets four.' },
      { title: 'Passing', text: 'A random player starts by passing one card, face down, to the next player clockwise. Whoever receives it checks their hand. Without four of a kind, they pass one card on, and so a card keeps travelling round the circle. You have ' + secs + ' seconds to pass; when time runs out, a random card is passed for you.' },
      { title: 'Four of a kind', text: 'Hold four Jacks, four Queens, four Kings or four Aces? Pass on your spare card, if you have one, and put the four down on the table.' },
      { title: 'React quickly', text: 'The moment someone puts down four of a kind, everyone else must put their cards down as fast as they can: a Put down! button pops up somewhere on the table, so tap it. The last one to do it gets a letter. Anyone whose cards aren’t down after 6 seconds counts as last. Tapping before you could have seen it doesn’t count: the button jumps somewhere else.' },
      { title: 'DONKEY', text: 'Letters come in order: D, O, N, K, E, Y. Whoever spells DONKEY loses, and the game ends right there.' },
      { title: 'Placings', text: 'Everyone else is ranked by letters: the fewer you have, the better you place. The player with the fewest letters wins.' },
      { title: 'Tie-breaker', text: 'Players tied on letters settle it with a full 52-card deck. A random player from the tie is the challenger and picks someone else from the tie. Each draws a card and looks at it secretly, and the challenger calls whether their own card is lower, equal or higher. A right call knocks out the opponent; a wrong one knocks out the challenger. Aces are high and suits don’t matter, so equal ranks only count for a call of equal. The first one out takes the lowest place, and new duels follow, with a fresh deck and a new random challenger, until one player is left.' }
    ];
  }

  /* One line for the "game in progress" card on the home screen. */
  function describe(state, pid) {
    var me = player(state, pid);
    var mine = me && me.letters ? 'your letters: ' + WORD.slice(0, me.letters) : 'no letters yet';
    return 'Round ' + state.round + ' · ' + mine;
  }

  /* Stats each player collects (CT.tally): fours of a kind, the fastest
     put-down, letters taken and the times they spelled DONKEY. */
  var STATS = {
    count: function (t, e) {
      var add = CT.tally.add;
      switch (e.type) {
        case 'declare': add(t, e.player, 'fours'); break;
        case 'react': CT.tally.best(t, e.player, 'bestReact', e.ms, 'min'); break;
        case 'roundEnd': (e.losers || []).forEach(function (pid) { add(t, pid, 'letters'); }); break;
        case 'gameEnd': (e.donkeys || []).forEach(function (pid) { add(t, pid, 'donkeys'); }); break;
      }
    },
    show: [
      { key: 'fours', label: 'Fours of a kind', rank: true, help: 'Fours of a kind put down.' },
      { key: 'bestReact', label: 'Fastest put-down', rank: true, best: 'min', low: true, unit: 'ms', help: 'The quickest put-down after someone else’s four of a kind.' },
      { key: 'letters', label: 'Letters taken', low: true, help: 'Letters for being the last to put your cards down.' },
      { key: 'donkeys', label: 'Times the Donkey', low: true, help: 'Games lost by spelling DONKEY.' }
    ]
  };

  CT.registerMode({
    id: 'donkey',
    name: 'Pass-Roun Donkey',
    shortName: 'Donkey',
    fan: ['JC', 'KH', 'AS'],
    tagline: 'Pass one card round the circle, collect four of a kind, and never be last to put your cards down.',
    engineVersion: ENGINE_VERSION,
    players: { min: SEATS, max: SEATS, default: SEATS },
    options: OPTIONS,
    defaultTiming: DEFAULT_TIMING,
    handSize: HAND_SIZE,
    word: WORD,
    bestCall: bestCall,
    fourOf: fourOf,
    rules: rules,
    describe: describe,
    createGame: createGame,
    act: act,
    tick: tick,
    view: view,
    stats: STATS,
    presenter: 'donkey'
  });
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
