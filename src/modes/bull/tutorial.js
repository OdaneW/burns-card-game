/* ==========================================================================
   GAME MODE · BULL — interactive tutorial
   Five short lessons on the real table, with small hand-arranged hands so
   they're quick, and scripted computer players (Mia on your left, Dex
   across, Rae on your right) who play and call Bull exactly as written. The
   steps run on the shared lesson runner (src/ui/tutorial.js). Nothing is
   saved or counted in stats.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var Bull = CT.getMode('bull');
  var RANKS = Bull.ranks;

  function C(id) { return { id: id, rank: id.slice(0, -1), suit: id.slice(-1) }; }
  function K(id) { return UI.cardText(C(id)); }

  var PLAYERS = [
    { id: 'p0', name: 'You', isBot: false },
    { id: 'p1', name: 'Mia', isBot: true },
    { id: 'p2', name: 'Dex', isBot: true },
    { id: 'p3', name: 'Rae', isBot: true }
  ];
  // No time limit to play; two seconds to call Bull after each play.
  var TIMING = { dealHoldMs: 0, turnMs: 0, bullMs: 2000, revealMs: 3200, lastCallExtraMs: 1500 };

  /* ---------- helpers the lessons use ---------- */

  function saw(ctx, type, pid) {
    return ctx.events.some(function (e) { return e.type === type && (!pid || e.player === pid); });
  }
  function played(pid) { return function (ctx) { return saw(ctx, 'play', pid); }; }
  function called(ctx) { return saw(ctx, 'bull'); }
  function pickedUp(ctx) { return saw(ctx, 'pickup'); }
  function count(ctx, pid) {
    var p = ctx.v.players.filter(function (x) { return x.id === pid; })[0];
    return p ? p.handCount : 0;
  }
  /* The cards a play would put down, from your hand. */
  function chosen(state, payload) {
    var hand = state.players[0].hand;
    return (payload.cardIds || []).map(function (id) { return hand.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean);
  }

  /* ---------- the lessons ---------- */

  var LESSONS = [
    {
      title: 'Taking turns',
      hands: [['AS', 'AH', '3C', '8D', 'JC', 'KH'], ['2C', '2S', '6H', '9C', 'QD'], ['3D', '7S', '10H', '5C'], ['4H', '4D', 'JS', '9H', '6S']],
      turn: 'p0', rank: 'A',
      bots: { p1: { plays: [['2C', '2S']] }, p2: { plays: [['3D']] }, p3: { plays: [['4H']] } },
      guard: function (state, type, payload) {
        if (type !== 'play') return null;
        var cards = chosen(state, payload);
        if (cards.some(function (c) { return c.rank !== 'A'; })) return 'Play only your Aces for now. Bluffing comes next.';
        if (cards.length < 2) return 'You have two Aces: pick both, then tap Play.';
        return null;
      },
      steps: [
        { next: true, title: 'Welcome to Bull', text: 'You’re at the table with Mia, Dex and Rae. The aim is to be the first to get rid of all your cards. In a real game the whole deck is dealt out; here everyone has just a few cards, so the lessons are quick.' },
        { next: true, target: 'table', text: 'Turns go clockwise round the table: after you comes Mia, on your left, then Dex, then Rae.' },
        { next: true, target: 'now', text: 'Each turn has a rank: Aces first, then 2s, 3s and so on up to Kings, then round to Aces again. The middle of the table shows the rank that’s next, and who has to play it.' },
        { target: 'mine', text: 'You start, so you play Aces. Tap your two Aces, then tap Play. You can play up to four cards in a turn.', done: played('p0'), after: 400 },
        { next: true, target: 'claim', text: 'Your cards go face down on the pile, and everyone sees what you claimed: two Aces. Nobody else can see whether that’s true.' },
        { watch: true, target: 'table', text: 'Now Mia plays 2s, then Dex plays 3s and Rae plays 4s. Each claim shows in the middle of the table.', done: played('p3'), after: 800 },
        { next: true, target: 'now', text: 'Round it comes to you again, and you’re on 5s. But you don’t have any 5s…' }
      ]
    },
    {
      title: 'Bluffing',
      hands: [['3C', '8D', 'JC', 'KH'], ['6H', '9C', 'QD'], ['7S', '10H', '5C'], ['4D', 'JS', '9H', '6S']],
      pile: [['p0', 'A', ['AS', 'AH']], ['p1', '2', ['2C', '2S']], ['p2', '3', ['3D']], ['p3', '4', ['4H']]],
      last: true, turn: 'p0', rank: '5',
      bots: { p1: { plays: [['6H']] } },
      guard: function (state, type, payload) {
        if (type === 'play' && (payload.cardIds || []).length > 2) return 'Keep some cards back: one or two is plenty for a bluff.';
        return null;
      },
      steps: [
        { target: 'mine', title: 'Bluffing', text: 'Your cards don’t have to be what you claim. You have no 5s, so bluff: pick one card, or two, and play them as 5s.', done: played('p0'), after: 400 },
        { watch: true, target: 'seat:p1', text: 'Will anyone call Bull before Mia plays?', done: played('p1'), after: 700 },
        { next: true, text: 'Nobody called Bull before Mia played, so your bluff worked: those cards are gone for good. Bluff with cards you won’t need for a while. In a real game there’s a time limit too: 30 seconds a turn unless you change it. If it runs out, one card is played for you.' }
      ]
    },
    {
      title: 'Calling Bull',
      hands: [['7S', '7H', '7C', '2D', '10C', 'QS'], ['5H', '9S', 'KD', '3H'], ['7D', 'QC', '4S', '8H', 'JD'], ['8S', '8C', 'AD', '6C']],
      pile: [['p2', '3', ['3S', '3D']], ['p3', '4', ['4C']], ['p0', '5', ['5C', '5S']], ['p1', '6', ['6D']]],
      turn: 'p2', rank: '7',
      bull: true,   // the lesson where you call it
      bots: { p2: { plays: [['7D', 'QC']], think: 1200 } },
      steps: [
        { next: true, title: 'Calling Bull', target: 'hand', text: 'You have three 7s, and it’s Dex’s turn to play 7s. Watch what he claims.' },
        { watch: true, target: 'seat:p2', text: 'Dex is playing…', done: played('p2'), after: 300 },
        { target: 'bull', text: 'Dex claims two 7s. But there are only four 7s in the deck, and three of them are in your hand. He must be bluffing! Tap Bull! before Rae plays.', done: called, after: 300 },
        { watch: true, target: 'center', text: 'Dex’s cards are turned over for everyone to see…', done: pickedUp, after: 900 },
        { next: true, target: 'seat:p2', text: 'One of them was the ' + K('QC') + ': a bluff! So Dex picks up the whole pile, all 8 cards. Call Bull when a claim can’t be true, or just seems unlikely. You can call on anyone, but only on the last play, and only until the next player has played.' }
      ]
    },
    {
      title: 'A wrong call',
      hands: [['9C', '9H', '4D', 'JH', '2S'], ['10D', '6S', 'KC', '3C'], ['8C', 'QD', '5H', 'AS', 'JD'], ['2H', '10S', 'KH', '4C']],
      pile: [['p1', '6', ['6D', '6C']], ['p2', '7', ['7C', '7S']], ['p3', '8', ['8D']]],
      turn: 'p0', rank: '9',
      bots: { p1: { callOn: 'p0', react: 1500 } },
      guard: function (state, type, payload) {
        if (type !== 'play') return null;
        var cards = chosen(state, payload);
        if (cards.some(function (c) { return c.rank !== '9'; })) return 'Play just your 9s this time: no bluffing.';
        if (cards.length < 2) return 'Play both your 9s.';
        return null;
      },
      steps: [
        { target: 'mine', title: 'A wrong call', text: 'You’re on 9s, and you have two. Play them both: the truth, this time.', done: played('p0'), after: 400 },
        { watch: true, target: 'seat:p1', text: 'Mia doesn’t believe you…', done: called, after: 300 },
        { watch: true, target: 'center', text: 'Mia called Bull, so your cards are turned over…', done: pickedUp, after: 900 },
        { next: true, target: 'seat:p1', text: function (ctx) {
          var took = count(ctx, 'p1') - 4;
          return 'They really were 9s, so Mia was wrong, and she picks up the whole pile: ' + took + ' cards. Whoever is wrong picks up: a player caught bluffing, or whoever called Bull on the truth.';
        } }
      ]
    },
    {
      title: 'Winning',
      hands: [['KS'], ['5D', '9D', '3S'], ['4H', '7H', 'AC', 'JS'], ['8H', '6D']],
      pile: [['p1', '10', ['10S', '10D']], ['p2', 'J', ['JC']], ['p3', 'Q', ['QH', '2C']]],
      turn: 'p0', rank: 'K',
      bots: { p2: { callOn: 'p0', react: 3000 } },
      steps: [
        { target: 'mine', title: 'Winning', text: 'You’re down to your last card, the ' + K('KS') + ', and you’re on Kings. Play it!', done: played('p0'), after: 400 },
        { watch: true, target: 'table', text: 'Your last card! Will anyone call Bull?', done: function (ctx) { return called(ctx) || ctx.v.phase === 'over'; }, after: 300 },
        { watch: true, target: 'center', text: 'Dex calls Bull! Your card is turned over…', done: function (ctx) { return ctx.v.phase === 'over'; }, after: 1200 },
        { final: true, title: 'You win!', text: 'It really was a King, so Dex picks up the pile, and you’re out of cards: you win! If you’d been bluffing, you would have picked up the pile and played on. That’s Bull: play the next rank, bluff when you must, and call Bull when you think someone’s lying.' }
      ]
    }
  ];

  /* ---------- scripted computer players: predictable, so lessons play out as written ---------- */

  /* bots: { pid: { plays: [[card ids], …] the plays to make, in order (the
     first whose cards are all still in hand); none left: wait. think: ms
     after the Bull moment. callOn: pid whose plays to call Bull on; react: ms } } */
  function scriptedBot(lesson) {
    var script = lesson.bots || {};
    function nextPlay(mine, v) {
      var list = mine.plays || [];
      for (var i = 0; i < list.length; i++) {
        var ids = list[i];
        if (ids.every(function (id) { return v.hand.some(function (c) { return c.id === id; }); })) return ids;
      }
      return null;
    }
    function calls(mine, v) { return !!(v.canBull && v.last && mine.callOn && v.last.by === mine.callOn); }
    return {
      intent: function (v) {
        var mine = script[v.me] || {};
        if (calls(mine, v)) return { key: 'bull:' + v.last.no, kind: 'bull' };
        if (v.canPlay && nextPlay(mine, v)) return { key: 'play:' + v.plays + ':' + v.turn, kind: 'play' };
        return null;
      },
      delay: function (intent, v, rnd, now) {
        var mine = script[v.me] || {};
        if (intent.kind === 'bull') return mine.react || 1500;
        var wait = (v.openAt != null && now != null) ? Math.max(0, v.openAt - now) : 0;
        return wait + (mine.think || 900);
      },
      decide: function (v) {
        var mine = script[v.me] || {};
        if (calls(mine, v)) return { type: 'bull' };
        var ids = v.canPlay ? nextPlay(mine, v) : null;
        return ids ? { type: 'play', payload: { cardIds: ids.slice() } } : null;
      }
    };
  }

  /* The mode with scripted players. In lessons that aren't about calling
     Bull, the Bull! button stays away, and a guard steers your plays back
     on track instead of letting the lesson derail. */
  function modeFor(lesson) {
    var mode = Object.assign({}, Bull, { bot: scriptedBot(lesson) });
    mode.act = function (state, pid, type, payload, now) {
      if (pid === 'p0') {
        if (type === 'bull' && !lesson.bull) return CT.fail('lesson', 'Calling Bull comes in a moment. For now, just watch.');
        var no = lesson.guard && lesson.guard(state, type, payload || {});
        if (no) return CT.fail('lesson', no);
      }
      return Bull.act(state, pid, type, payload, now);
    };
    if (!lesson.bull) {
      mode.view = function (state, pid, opts) {
        var v = Bull.view(state, pid, opts);
        if (pid === 'p0') v.canBull = false;
        return v;
      };
    }
    return mode;
  }

  /* Lay out the lesson: hands, the pile so far, whose turn and which rank. */
  function rig(state, lesson, now) {
    state.players.forEach(function (p, i) { p.hand = lesson.hands[i].map(C); });
    state.pile = (lesson.pile || []).map(function (pl) { return { by: pl[0], rank: RANKS.indexOf(pl[1]), cards: pl[2].map(C) }; });
    state.plays = state.pile.length;
    state.rank = RANKS.indexOf(lesson.rank);
    state.turn = lesson.turn;
    state.starter = lesson.turn;
    state.phase = 'play';
    state.phaseEndsAt = null;
    state.openAt = now;
    state.turnEndsAt = null;
    state.last = null;
    if (lesson.last && state.pile.length) {
      // the play just before: its claim shows by the player's name
      var top = state.pile[state.pile.length - 1];
      state.last = { by: top.by, rank: top.rank, n: top.cards.length, at: now, no: state.plays };
    }
    state.reveal = null;
    state.winners = null;
    state.events = [];
    state.seq = 0;
  }

  function makeSession(lesson) {
    var session = new CT.Session({ mode: modeFor(lesson), players: PLAYERS, options: { turnTime: '30', bullTime: '3', bots: 'normal' }, seed: 11, timing: TIMING });
    rig(session.state, lesson, session.now());
    return session;
  }

  /* The layout where the table and your hand sit side by side (styles.css). */
  function SIDE_BY_SIDE() {
    return !!(window.matchMedia && window.matchMedia('(max-height: 560px) and (orientation: landscape) and (min-width: 600px)').matches);
  }

  /* Several elements as one spotlight: your seat and your hand together. */
  var around = UI.around;

  /* ---------- the runner (shared with the other modes' tutorials) ---------- */

  UI.tutorials = UI.tutorials || {};
  UI.tutorials.bull = UI.makeTutorial({
    modeId: 'bull',
    lessons: LESSONS,
    makeSession: makeSession,
    modeFor: modeFor,
    target: function (key) {
      var $ = function (id) { return document.getElementById(id); };
      if (key === 'table') return $('b-table');
      if (key === 'center') return $('b-center');
      if (key === 'now') return $('b-now');
      if (key === 'pile') return $('b-pile');
      if (key === 'claim') return around([$('b-claim'), $('b-pile')]);
      if (key === 'hand') return $('b-handwrap');
      if (key === 'bull') return $('b-bull');
      if (key === 'me') return $('b-me');
      if (key === 'mine') return around([$('b-me'), $('b-handwrap')]);
      if (key.indexOf('seat:') === 0) return document.querySelector('.bl-seat[data-pid="' + key.slice(5) + '"]');
      if (key.indexOf('card:') === 0) return document.querySelector('.hcard[data-id="' + key.slice(5) + '"]');
      return null;
    },
    topTargets: /^(card:|hand|mine|me)/,
    // A phone on its side: the table fills the left, so notes about it go in the column beside it.
    anchor: function (key) {
      if (!/^(table|center|now|pile|claim|seat:)/.test(key) || !SIDE_BY_SIDE()) return null;
      return document.getElementById('b-table');
    },
    playLabel: 'Play Bull'
  });
})(window.CT);
