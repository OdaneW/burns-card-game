/* ==========================================================================
   GAME MODE · STRIP-ME — interactive tutorial
   Five short lessons on the real table against Mia, with small hand-arranged
   decks so they're quick, and a scripted Mia who turns her cards over at an
   easy pace and never shuffles. The steps run on the shared lesson runner
   (src/ui/tutorial.js). Nothing is saved or counted in stats.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var StripMe = CT.getMode('stripme');

  function C(id) { return { id: id, rank: id.slice(0, -1), suit: id.slice(-1) }; }

  var PLAYERS = [
    { id: 'p0', name: 'You', isBot: false },
    { id: 'p1', name: 'Mia', isBot: true }
  ];
  // No time limit a card; the pile stays on show a moment before it's taken;
  // a finished round waits (the lesson moves on before the next deal).
  var TIMING = { dealHoldMs: 0, pickupHoldMs: 1300, roundHoldMs: 600000, turnMs: 0 };

  /* ---------- helpers the lessons use ---------- */

  function saw(ctx, type, pid) {
    return ctx.events.some(function (e) { return e.type === type && (!pid || e.player === pid); });
  }
  function played(pid) { return function (ctx) { return saw(ctx, 'play', pid); }; }
  function pickedUp(pid) { return function (ctx) { return saw(ctx, 'pickup', pid); }; }
  function shuffled(ctx) { return saw(ctx, 'shuffle', 'p0'); }
  function roundEnded(ctx) { return saw(ctx, 'roundEnd'); }
  function autoOn() { return !!(CT.App && CT.App.table && CT.App.table.auto); }

  /* ---------- the lessons ---------- */

  var LESSONS = [
    {
      title: 'Taking turns',
      decks: [['4S', '9H', '7C', '2D', '5H'], ['6D', '3S', '8C', '10H', '2C']],
      turn: 'p0',
      steps: [
        { next: true, title: 'Welcome to Strip-Me', text: 'It’s you against Mia. You each have a deck of cards face down, and nobody looks at their cards, not even their own. The aim is to be the first to turn over all your cards. In a real game you get 26 cards each; here it’s just a few, so the lessons are quick.' },
        { next: true, target: 'them', text: 'Mia is dressed up in fun garments, and so are you. Lose a round and one of them comes off! The little icons by each name show what’s still on.' },
        { target: 'deck', text: 'You start. Tap your deck to turn over its top card.', done: played('p0'), after: 500 },
        { watch: true, target: 'pile', text: 'Your card goes face up on the pile in the middle. Then it’s Mia’s turn.', done: played('p1'), after: 700 },
        { next: true, target: 'pile', text: 'Cards from 2 to 10 do nothing: you just take turns. But four kinds of card make things exciting…' }
      ]
    },
    {
      title: 'Action Cards',
      decks: [['KS', '7S', '10S', '3H', '6S'], ['4D', '9C', '6H', '8D', '5D']],
      turn: 'p0',
      steps: [
        { target: 'deck', title: 'Action Cards', text: 'Jacks, Queens, Kings and Aces are Action Cards. Tap your deck and see what you get.', done: played('p0'), after: 600 },
        { next: true, target: 'mid', text: 'A King! Turn over an Action Card and the other player has to pay: 1 card for a Jack, 2 for a Queen, 3 for a King, 4 for an Ace. So Mia pays 3, one card at a time.' },
        { watch: true, target: 'mid', text: 'Mia is paying. If none of her cards is an Action Card…', done: pickedUp('p1'), after: 900 },
        { next: true, target: 'them', text: 'No Action Card, so Mia takes the whole pile and puts it under her deck. That’s bad news for her: more cards to get through before she can win. And you, who made her pay, start again.' }
      ]
    },
    {
      title: 'Paying up',
      decks: [['8S', 'JH', '2H', '4H', '9S'], ['QD', '3C', '5C', '7D', '10C']],
      turn: 'p1',
      steps: [
        { watch: true, target: 'them', title: 'Paying up', text: 'This time Mia starts…', done: played('p1'), after: 500 },
        { target: 'deck', text: 'Mia turned over a Queen, so you pay 2. Tap your deck to turn over the first card.', done: played('p0'), after: 400 },
        // (done when your Jack is the card being paid for, however quickly it was tapped)
        { target: 'deck', text: 'Not an Action Card. One more to pay: tap your deck again.', done: function (ctx) { return !!(ctx.v.demand && ctx.v.demand.by === 'p0'); }, after: 600 },
        { next: true, target: 'mid', text: 'A Jack! Turn up an Action Card while you’re paying and the rest of your payment is cancelled. Now Mia pays you 1 card.' },
        { watch: true, target: 'mid', text: 'Mia pays…', done: pickedUp('p1'), after: 900 },
        { next: true, target: 'them', text: 'Just a 3, so Mia takes the pile. Payments can go back and forth like this several times before somebody takes the pile.' }
      ]
    },
    {
      title: 'Shuffle and Auto',
      decks: [['5S', '8H', '3D', '10D', '6C', '9D', '2S', '7H'], ['4C', '9S', '2H', '6D', '8S', '3S', '10S', '5H']],
      turn: 'p0',
      shuffle: true,   // the lesson where you can
      steps: [
        { target: 'shuffle', title: 'Shuffle', text: 'Before each card you turn over, you may shuffle your own deck once. Nobody knows what’s in it, but it might change your luck. Tap Shuffle.', done: shuffled, after: 700 },
        { target: 'deck', text: 'Now tap your deck.', done: played('p0'), after: 400 },
        { watch: true, target: 'them', text: 'Mia’s turn…', done: played('p1'), after: 500 },
        { target: 'auto', title: 'Auto', text: 'Rounds can be long. Switch on Auto and your cards turn over by themselves while it’s your turn. Try it.',
          done: function (ctx) { return autoOn() && played('p0')(ctx); }, after: 900 },
        { next: true, target: 'auto', text: 'Auto keeps going until you tap it again to play yourself. And in a game, if you don’t play within 10 seconds, a card is turned over for you, then more, quickly, until you tap your deck.' }
      ]
    },
    {
      title: 'Winning a round',
      decks: [['6C'], ['2D', '9H', 'KC', '4S', '7D', '3H']],
      turn: 'p0',
      steps: [
        { target: 'deck', title: 'Winning a round', text: function (ctx) {
          return roundEnded(ctx) ? 'Your deck is empty! Watch Mia…' : 'You’re down to your last card. Turn it over!';
        }, done: roundEnded, after: 3000 },
        { final: true, title: 'You win the round!', text: 'You ran out first, so you win the round, and off comes Mia’s silly hat! Running out wins even in the middle of paying. Each round is dealt afresh until someone has lost all their garments: you choose 2 to 5. Or pick Quick Play, one round, and add a round timer if you like: when time’s up, whoever has more cards loses.' }
      ]
    }
  ];

  /* ---------- a scripted Mia: an easy pace, no shuffling ---------- */

  function scriptedBot() {
    return {
      intent: function (v) { return v.canPlay ? { kind: 'play', key: 'P' + v.round + ':' + v.plays + ':' + v.owe } : null; },
      delay: function (intent, v) { return v.owe ? 800 : 1100; },
      decide: function (v) { return v.canPlay ? { type: 'play', payload: {} } : null; }
    };
  }

  /* The mode with scripted Mia. Shuffling waits for its lesson, so your
     deck stays in the order each lesson needs. */
  function modeFor(lesson) {
    var mode = Object.assign({}, StripMe, { bot: scriptedBot() });
    mode.act = function (state, pid, type, payload, now) {
      if (pid === 'p0' && type === 'shuffle' && !lesson.shuffle) return CT.fail('lesson', 'Shuffling comes in lesson 4. For now, just tap your deck.');
      return StripMe.act(state, pid, type, payload, now);
    };
    if (!lesson.shuffle) {
      mode.view = function (state, pid, opts) {
        var v = StripMe.view(state, pid, opts);
        if (pid === 'p0') v.canShuffle = false;
        return v;
      };
    }
    return mode;
  }

  /* Lay out the lesson: both decks (top card first), whose turn, an empty pile. */
  function rig(state, lesson) {
    state.players.forEach(function (p, i) { p.deck = lesson.decks[i].map(C); p.lost = 0; });
    state.pile = [];
    state.round = 1;
    state.phase = 'play';
    state.phaseEndsAt = 0;
    state.turn = lesson.turn;
    state.starter = lesson.turn;
    state.turnEndsAt = null;
    state.owe = 0;
    state.demand = null;
    state.taker = null;
    state.shuffled = {};
    state.idle = {};
    state.plays = 0;
    state.roundEndsAt = null;
    state.overtime = false;
    state.result = null;
    state.winners = null;
    state.events = [];
    state.seq = 0;
  }

  function makeSession(lesson) {
    var session = new CT.Session({ mode: modeFor(lesson), players: PLAYERS, options: { mode: 'strip', losses: '3', timer: 'off' }, seed: 7, timing: TIMING });
    rig(session.state, lesson);
    return session;
  }

  /* A phone on its side: you, the pile and Mia side by side (styles.css). */
  function SIDE_BY_SIDE() {
    return !!(window.matchMedia && window.matchMedia('(max-height: 560px) and (orientation: landscape) and (min-width: 600px)').matches);
  }

  /* ---------- the runner (shared with the other modes' tutorials) ---------- */

  UI.tutorials = UI.tutorials || {};
  UI.tutorials.stripme = UI.makeTutorial({
    modeId: 'stripme',
    lessons: LESSONS,
    makeSession: makeSession,
    modeFor: modeFor,
    target: function (key) {
      var $ = function (id) { return document.getElementById(id); };
      if (key === 'deck') return $('s-deck');
      if (key === 'shuffle') return $('s-shuffle');
      if (key === 'auto') return $('s-auto');
      if (key === 'mid') return UI.around([$('s-banner'), $('s-pile'), $('s-pilecount')]);
      if (key === 'pile') return UI.around([$('s-pile'), $('s-pilecount')]);
      if (key === 'them') return document.querySelector('.sm-seat.sm-them');
      if (key === 'me') return document.querySelector('.sm-seat.sm-me');
      return null;
    },
    // your deck and buttons are at the bottom: notes about them go up top
    topTargets: /^(deck|shuffle|auto|me)$/,
    // A phone on its side: notes about the middle or Mia sit in the column beside them.
    anchor: function (key) {
      if (!SIDE_BY_SIDE()) return null;
      if (key === 'them') return document.querySelector('.sm-seat.sm-them');
      if (key === 'mid' || key === 'pile') return $mid();
      return null;
    },
    playLabel: 'Play Strip-Me'
  });

  function $mid() { return document.getElementById('s-mid'); }
})(window.CT);
