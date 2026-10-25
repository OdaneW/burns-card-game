/* ==========================================================================
   GAME MODE · PASS-ROUN DONKEY — interactive tutorial
   Five short lessons, each a hand-arranged deal played on the real table
   with scripted computer players (Mia on your left, Dex across, Rae on your
   right), so every lesson plays out as written. The steps run on the shared
   lesson runner (src/ui/tutorial.js). Nothing is saved or counted in stats.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var Donkey = CT.getMode('donkey');

  function C(id) { return { id: id, rank: id.slice(0, -1), suit: id.slice(-1) }; }
  function K(id) { return UI.cardText(C(id)); }

  var PLAYERS = [
    { id: 'p0', name: 'You', isBot: false },
    { id: 'p1', name: 'Mia', isBot: true },
    { id: 'p2', name: 'Dex', isBot: true },
    { id: 'p3', name: 'Rae', isBot: true }
  ];
  var NAMES = { p0: 'You', p1: 'Mia', p2: 'Dex', p3: 'Rae' };
  var TIMING = { dealHoldMs: 0, raceDelayMs: 450, raceMs: 8000, roundHoldMs: 3200, duelChoiceMs: 120000, duelHoldMs: 2600, passMs: 0 };

  /* ---------- helpers the lesson text uses ---------- */

  function lettersOf(ctx, pid) {
    var p = ctx.v.players.filter(function (x) { return x.id === pid; })[0];
    return p ? p.letters : 0;
  }
  function loser(ctx) { return ctx.v.result ? ctx.v.result.losers[0] : null; }
  function myTime(ctx) {
    var o = ctx.v.race && ctx.v.race.order.filter(function (x) { return x.player === 'p0'; })[0];
    return o ? (o.ms / 1000).toFixed(2) + ' seconds' : '';
  }
  function iPassed(ctx) { return ctx.v.passes >= 1 && ctx.v.turn !== 'p0'; }
  function keepKings(state, type, payload) {
    if (type === 'pass' && /^K/.test(payload.cardId || '')) return 'Keep your Kings: they’re what you’re collecting. Pass a card you don’t need.';
    return null;
  }

  /* ---------- the lessons ---------- */

  var LESSONS = [
    {
      title: 'Passing',
      hands: [['KS', 'KH', 'QD', 'JC'], ['QS', 'QH', 'AD', 'JD'], ['AS', 'AH', 'JH', 'QC'], ['KC', 'KD', 'AC', 'JS']],
      turn: 'p0',
      bots: { p1: { passes: ['JD'] }, p2: { passes: ['QC'] }, p3: { passes: ['KC'] } },
      guard: keepKings,
      steps: [
        { next: true, title: 'Welcome to Pass-Roun Donkey', text: 'You’re at the table with Mia, Dex and Rae. Only the Jacks, Queens, Kings and Aces are used: 16 cards, four each.' },
        { next: true, target: 'hand', text: 'These are your cards. The aim is to collect four of a kind: four Jacks, Queens, Kings or Aces. You already have two Kings, so go for Kings.' },
        { next: true, target: 'center', text: 'One card at a time travels round the table, clockwise. You pass to Mia, on your left, and you get cards from Rae, on your right.' },
        { target: 'hand', text: 'You start. Pass a card you don’t need to Mia: tap the ' + K('QD') + ' or the ' + K('JC') + ', then tap it again.', done: iPassed, after: 500 },
        { watch: true, target: 'table', text: 'Round it goes: Mia passes to Dex, Dex to Rae, and Rae back to you. Only the player who receives a card sees what it is.',
          done: function (ctx) { return ctx.v.turn === 'p0'; }, after: 700 },
        { next: true, target: 'card:KC', text: 'Rae passed you the ' + K('KC') + ': three Kings! Each time a card reaches you, keep what you’re collecting and pass something else on. In a real game you have 15 seconds to pass, or a random card goes for you.' }
      ]
    },
    {
      title: 'Four of a kind',
      hands: [['KS', 'KH', 'KC', 'JC'], ['QS', 'QH', 'QD', 'AD'], ['AS', 'AH', 'JH', 'QC'], ['KD', 'AC', 'JS', 'JD']],
      turn: 'p0',
      bots: { p1: { passes: ['JC'], react: 700 }, p2: { passes: ['QC'], react: 1500 }, p3: { passes: ['KD'], react: 1050 } },
      guard: keepKings,
      steps: [
        { target: 'card:JC', title: 'Four of a kind', text: 'You have three Kings. Pass the ' + K('JC') + ' to Mia and wait for the card to come round.', done: iPassed, after: 500 },
        { watch: true, target: 'table', text: 'Mia, Dex and Rae each pass a card on…', done: function (ctx) { return ctx.v.canDeclare; }, after: 600 },
        { target: 'declare', text: 'Rae passed you the ' + K('KD') + ': four Kings! Tap Four of a kind! to put them down. If you held a spare card, it would go on to Mia first.',
          done: function (ctx) { return !!ctx.v.declare; }, after: 300 },
        { watch: true, target: 'table', text: 'The moment your Kings hit the table, everyone else races to put their cards down…',
          done: function (ctx) { return ctx.v.phase === 'roundEnd'; }, after: 1000 },
        { next: true, target: function (ctx) { return 'seat:' + (loser(ctx) || 'p2'); }, text: function (ctx) {
          return NAMES[loser(ctx) || 'p2'] + ' was the slowest, so he gets a D, the first letter of DONKEY. You put four of a kind down first, so you’re safe this round.';
        } }
      ]
    },
    {
      title: 'Put your cards down!',
      hands: [['KS', 'KH', 'JC', 'QD'], ['QS', 'QH', 'JD', 'JH'], ['AS', 'KC', 'KD', 'QC', 'JS'], ['AH', 'AC', 'AD']],
      starter: 'p3', turn: 'p2', passes: 3,
      letters: [0, 0, 1, 0],
      bots: { p1: { react: 750 }, p2: { passes: ['AS'], react: 3000 } },   // Dex gives a first-timer time to read and tap
      steps: [
        { next: true, title: 'Put your cards down!', target: 'table', text: 'Now someone else gets lucky. When anyone puts down four of a kind, everyone else must put their cards down as fast as they can. The slowest gets a letter.' },
        { target: 'center', dim: false, text: 'Dex is passing to Rae. Watch the middle of the table and be ready to tap.',
          done: function (ctx) { return ctx.v.phase === 'declared' || ctx.v.phase === 'race'; }, after: 0 },
        { target: 'slap', dim: false, text: 'Rae has four Aces! Tap Put down! now!',
          done: function (ctx) {
            var mine = ctx.v.race && ctx.v.race.order.some(function (o) { return o.player === 'p0'; });
            return mine || ctx.v.phase === 'roundEnd';
          }, after: 300 },
        { watch: true, target: 'table', text: 'Waiting for the others…', done: function (ctx) { return ctx.v.phase === 'roundEnd'; }, after: 900 },
        { next: true, target: function (ctx) { return 'seat:' + (loser(ctx) || 'p2'); }, text: function (ctx) {
          if (loser(ctx) === 'p0') return 'Dex was quicker this time, so you get a D. Keep your eyes on the table and tap the moment four of a kind lands.';
          return 'You put your cards down in ' + myTime(ctx) + ' and beat Dex, so he collects another letter: D-O. Letters never come off.';
        } }
      ]
    },
    {
      title: 'DONKEY',
      hands: [['QS', 'QH', 'QD', 'QC', 'KS'], ['KH', 'JC', 'AD', 'JD'], ['AS', 'AH', 'JH', 'KC'], ['KD', 'AC', 'JS']],
      starter: 'p3', turn: 'p0', passes: 3,
      letters: [0, 2, 5, 0],
      bots: { p1: { react: 700 }, p2: { react: 2400 }, p3: { react: 1000 } },
      steps: [
        { next: true, title: 'DONKEY', target: 'seat:p2', text: 'Every time you’re the slowest, you get the next letter: D, O, N, K, E, Y. Dex already has D-O-N-K-E. One more and he spells DONKEY.' },
        { target: 'declare', text: 'You have four Queens. Put them down and see if Dex is quick enough.', done: function (ctx) { return !!ctx.v.declare; }, after: 300 },
        { watch: true, target: 'table', text: 'Everyone races…', done: function (ctx) { return ctx.v.phase === 'roundEnd'; }, after: 900 },
        { next: true, target: 'seat:p2', text: function (ctx) {
          return lettersOf(ctx, 'p2') >= 6
            ? 'Dex was the slowest again: Y. He’s spelled DONKEY, so the game ends right there, and he finishes last.'
            : 'The slowest player gets the next letter, and whoever spells DONKEY ends the game in last place.';
        } },
        { next: true, target: 'table', text: 'Everyone else is placed by their letters: the fewer, the better. Mia has two. You and Rae have none, so you’re tied for first place.' }
      ]
    },
    {
      title: 'Tie-breaker',
      hands: [['KS', 'KH', 'JC', 'QD'], ['QS', 'QH', 'JD', 'JH'], ['AS', 'KC', 'KD', 'QC'], ['AH', 'AC', 'AD', 'JS']],
      letters: [0, 2, 6, 0],
      duel: { players: ['p0', 'p3'], challenger: 'p0', opponent: 'p3', cards: { p0: '9S', p3: '6D' }, standings: [null, null, 'p1', 'p2'] },
      steps: [
        { next: true, title: 'Tie-breaker', target: 'center', text: 'Players tied on letters settle it with a duel, using a full 52-card deck. You and Rae each draw a card and look only at your own. You’re the challenger, so you make the call.' },
        { target: 'choices', text: 'Your card is the ' + K('9S') + '. Is it lower, equal or higher than Rae’s? Aces are high, and suits don’t matter.',
          done: function (ctx) { return ctx.v.tiebreak && ctx.v.tiebreak.duel && ctx.v.tiebreak.duel.step === 'reveal'; }, after: 600 },
        { next: true, target: 'center', text: function (ctx) {
          var d = ctx.v.tiebreak.duel, r = d.result;
          var first = r.right
            ? 'Rae had the ' + K('6D') + ', so ' + d.call + ' was right: Rae is out and takes 2nd place, and you win the game!'
            : 'Rae had the ' + K('6D') + ', so ' + d.call + ' was wrong: you’re out and take 2nd place, and Rae wins. A right call knocks out your opponent; a wrong one knocks out you.';
          return first + ' With three or more tied, the challenger first picks who to duel, and the duels go on until one player is left.';
        } },
        { final: true, title: 'That’s Pass-Roun Donkey!', text: 'Pass round the circle, collect four of a kind, put your cards down fast, and don’t be the one who spells DONKEY.' }
      ]
    }
  ];

  /* ---------- scripted computer players: predictable, so lessons play out as written ---------- */

  function scriptedBot(lesson) {
    var script = lesson.bots || {};
    return {
      intent: Donkey.bot.intent,
      delay: function (intent, v) {
        var mine = script[v.me] || {};
        if (intent.kind === 'react') return mine.react || 1200;
        if (intent.kind === 'pass') return 1150;
        if (intent.kind === 'declare') return 900;
        return 1400;
      },
      decide: function (v, memory, rnd) {
        var mine = script[v.me] || {};
        if (v.canDeclare) return { type: 'declare' };
        if (v.canPass) {
          // the first scripted card still in hand, or else the loosest card
          var queue = (mine.passes || []).filter(function (id) { return v.hand.some(function (c) { return c.id === id; }); });
          var card = queue.length ? C(queue[0]) : Donkey.bot.choosePass(v, memory, rnd);
          return { type: 'pass', payload: { cardId: card.id } };
        }
        if (v.canReact) return { type: 'react' };
        return null;
      }
    };
  }

  /* The mode with scripted players, and (for some lessons) a guard that
     steers the player back on track instead of letting the lesson derail. */
  function modeFor(lesson) {
    var mode = Object.assign({}, Donkey, { bot: scriptedBot(lesson) });
    if (lesson.guard) {
      mode.act = function (state, pid, type, payload, now) {
        var no = pid === 'p0' && lesson.guard(state, type, payload || {});
        return no ? CT.fail('lesson', no) : Donkey.act(state, pid, type, payload, now);
      };
    }
    return mode;
  }

  /* Lay out the lesson: hands, letters, whose turn, or a tie-breaker duel. */
  function rig(state, lesson, now) {
    state.players.forEach(function (p, i) {
      p.hand = lesson.hands[i].map(C);
      p.letters = (lesson.letters || [0, 0, 0, 0])[i];
    });
    state.events = [];
    state.seq = 0;
    state.round = 1;
    state.starter = lesson.starter || 'p0';
    state.passes = lesson.passes || 0;
    state.declare = null;
    state.race = null;
    state.result = null;
    state.turnEndsAt = null;
    if (lesson.duel) {
      var d = lesson.duel;
      var cards = {};
      Object.keys(d.cards).forEach(function (pid) { cards[pid] = C(d.cards[pid]); });
      state.phase = 'tiebreak';
      state.turn = null;
      state.standings = d.standings.slice();
      state.tiebreak = {
        queue: [], n: 1,
        group: { place: 0, remaining: d.players.slice(), out: [] },
        duel: { n: 1, place: 0, players: d.players.slice(), challenger: d.challenger, opponent: d.opponent,
          cards: cards, call: null, result: null, step: 'call', endsAt: now + TIMING.duelChoiceMs }
      };
    } else {
      state.phase = 'pass';
      state.turn = lesson.turn || state.starter;
    }
  }

  function makeSession(lesson) {
    var session = new CT.Session({ mode: modeFor(lesson), players: PLAYERS, options: { passTime: '15', reflexes: 'normal' }, seed: 9, timing: TIMING });
    rig(session.state, lesson, session.now());
    return session;
  }

  /* ---------- the runner (shared with the other modes' tutorials) ---------- */

  UI.tutorials = UI.tutorials || {};
  UI.tutorials.donkey = UI.makeTutorial({
    modeId: 'donkey',
    lessons: LESSONS,
    makeSession: makeSession,
    modeFor: modeFor,
    target: function (key) {
      if (key === 'table') return document.getElementById('d-table');
      if (key === 'center') return document.getElementById('d-center');
      if (key === 'hand') return document.getElementById('d-handwrap');
      if (key === 'declare') return document.getElementById('d-declare');
      if (key === 'slap') return document.getElementById('d-slap');
      if (key === 'choices') return document.getElementById('d-choices');
      if (key === 'me' || key === 'seat:p0') return document.getElementById('d-me');
      if (key.indexOf('seat:') === 0) return document.querySelector('.dk-seat[data-pid="' + key.slice(5) + '"]');
      if (key.indexOf('card:') === 0) return document.querySelector('.hcard[data-id="' + key.slice(5) + '"]');
      return null;
    },
    topTargets: /^(card:|hand|declare|slap|choices|me|seat:p0)/,
    playLabel: 'Play Donkey'
  });
})(window.CT);
