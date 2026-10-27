/* ==========================================================================
   GAME MODE · BURNS — interactive tutorial
   Six short lessons, each a hand-arranged deal played on the real table
   against scripted computer players, and an extra one on Real Burns (a rule
   choice): offered at the end, or taken on its own from How to play. The
   steps run on the shared lesson runner (src/ui/tutorial.js). Nothing here
   is saved or counted in stats.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var Burns = CT.getMode('burns');

  function C(id) { return { id: id, rank: id.slice(0, -1), suit: id.slice(-1) }; }
  function val(c) { return CT.rankValue(c.rank, true); }
  function S(suit) { return UI.suit(suit); }
  function K(id) { return UI.cardText(C(id)); }

  var PLAYERS = [
    { id: 'p0', name: 'You', isBot: false },
    { id: 'p1', name: 'Mia', isBot: true },
    { id: 'p2', name: 'Dex', isBot: true }
  ];
  var NAMES = { p0: 'You', p1: 'Mia', p2: 'Dex' };

  /* ---------- helpers the lesson text uses ---------- */

  function winner(ctx) { return ctx.v.setResult ? ctx.v.setResult.player : null; }
  function winText(ctx) {
    var r = ctx.v.setResult;
    if (!r || !r.card) return '';
    return r.player === 'p0' ? 'Your ' + UI.cardText(r.card) + ' wins the set.' : NAMES[r.player] + '’s ' + UI.cardText(r.card) + ' wins the set.';
  }
  function myPlayed(ctx) {
    var e = ctx.v.table.filter(function (x) { return x.owner === 'p0'; })[0];
    return e && e.card;
  }
  function bestOfSuit(ctx) {
    var mine = ctx.v.hand.filter(function (c) { return c.suit === ctx.v.suit; }).sort(function (a, b) { return val(b) - val(a); });
    return mine[0];
  }
  function saw(ctx, type) { return ctx.events.some(function (e) { return e.type === type; }); }

  /* Real Burns: where the penalty round has got to */
  var PEN_STEPS = ['shuffle', 'suit', 'draw', 'result'];
  function penAt(ctx, turn, step) {
    var P = ctx.v.penalty;
    if (!P) return false;
    if (P.turn > turn || P.step === 'done') return true;
    return P.turn === turn && PEN_STEPS.indexOf(P.step) >= PEN_STEPS.indexOf(step);
  }
  function penSuit(ctx) { var P = ctx.v.penalty; return P && P.suit ? S(P.suit) + ' ' + UI.suitSingle(P.suit) : 'card of your suit'; }
  function slapsText(soft, hard) {
    var parts = [];
    if (soft) parts.push(soft + ' soft slap' + (soft === 1 ? '' : 's'));
    if (hard) parts.push(hard + ' hard slap' + (hard === 1 ? '' : 's'));
    return parts.length ? parts.join(' and ') : 'no slaps';
  }
  function penSlaps(ctx) { var P = ctx.v.penalty; return P ? slapsText(P.soft, P.hard) : ''; }
  function penMatch(ctx) {
    var P = ctx.v.penalty, last = P && P.drawn[P.drawn.length - 1];
    return last ? UI.cardText(last) : 'card of your suit';
  }
  function penTotal(ctx) {
    var t = { soft: 0, hard: 0 };
    (ctx.v.penalty ? ctx.v.penalty.results : []).forEach(function (r) { t.soft += r.soft; t.hard += r.hard; });
    return slapsText(t.soft, t.hard);
  }

  /* ---------- the lessons ---------- */

  var LESSONS = [
    {
      title: 'Following suit',
      hands: [['KD', '4C', '7S', '9S'], ['5D', '3C', '10H', 'JH'], ['9D', '6C', 'QC', '2S']],
      starter: '8D',
      steps: [
        { next: true, title: 'Welcome to Burns', text: 'You’re playing against Mia and Dex. The goal is simple: be the first to get rid of all your cards.' },
        { next: true, target: 'hand', text: 'These are your cards. Only you can see them.' },
        { next: true, target: 'lead', text: 'Everyone gets 4 cards, then one more is turned face up: the starter. Its suit, ' + S('D') + ' diamonds, is the suit everyone must play in the first set.' },
        { next: true, title: 'Lucky deal?', text: 'There’s an optional Flush rule you can switch on before a game: if your 4 starting cards are all different suits, you win on the spot. It’s off here, so let’s play.' },
        { target: 'card:KD', text: 'Play a diamond. Tap your ' + K('KD') + ' once to pick it, then tap it again, or press Play.', done: function (ctx) { return ctx.me.committed; }, after: 400 },
        { target: 'seats', watch: true, text: 'Your card lies face down, so Mia and Dex can’t see it. When everyone has played, all the cards are turned over together.', done: function (ctx) { return ctx.v.revealed; }, after: 1500 },
        { next: true, target: function (ctx) { return 'slot:' + winner(ctx); }, text: function (ctx) {
          return 'The highest card wins the set. Cards rank from 2 (lowest) up to 10, Jack, Queen, King and Ace (highest). ' + winText(ctx);
        } }
      ]
    },
    {
      title: 'Leading',
      hands: [['QH', '6H', '9H'], ['3C', '7C', '2D'], ['4S', '8D', 'JC']],
      leader: 'p0', setNo: 2,
      deck: ['5C', '2H', '10S', '7H'],
      steps: [
        { next: true, target: 'hand', title: 'Leading', text: 'The winner of a set leads the next one. This time that’s you: play any card you like, and its suit becomes the suit everyone must follow.' },
        { target: 'hand', text: 'Lead one of your hearts.', done: function (ctx) { return ctx.me.committed; }, after: 400 },
        { target: 'seats', watch: true, text: 'The leader’s card is played face up, so Mia and Dex can see what they have to beat. Neither has a heart, so they must draw from the deck until one turns up.', done: function (ctx) { return ctx.v.revealed; }, after: 1500 },
        { next: true, target: function (ctx) { return 'slot:' + winner(ctx); }, text: function (ctx) {
          return 'Every card they drew stays in their hand. That’s the price of not having the suit. ' + winText(ctx);
        } }
      ]
    },
    {
      title: 'Drawing',
      hands: [['3H', '8C', 'JD'], ['6S', '2C', '9H'], ['KS', '4D', '5H']],
      leader: 'p2', setNo: 3,
      deck: ['10H', '4S', 'AS', '5D'],
      bots: { p2: { lead: 'KS' } },
      steps: [
        { target: 'lead', watch: true, title: 'Drawing', text: 'Dex won the last set, so Dex leads. Watch what he plays.', done: function (ctx) { return ctx.v.phase === 'follow'; }, after: 700 },
        { target: 'deck', text: 'Dex led the ' + K('KS') + ', and you don’t have any spades. Tap the deck to draw, and keep going until a spade turns up.', done: function (ctx) { return ctx.v.canFollow || ctx.me.committed; } },
        { text: function (ctx) {
          var best = bestOfSuit(ctx);
          if (!best) return 'Play a spade, or tap the deck again to look for a higher one.';
          if (val(best) > val(C('KS'))) return 'You found the ' + UI.cardText(best) + ', and it beats Dex’s ' + K('KS') + '. Play it!';
          return 'You found the ' + UI.cardText(best) + ', but Dex’s ' + K('KS') + ' beats it. Play it anyway, or tap the deck again to look for a higher spade. Every card you draw stays in your hand, so it’s a gamble.';
        }, done: function (ctx) { return ctx.me.committed; }, after: 400 },
        { target: 'seats', watch: true, text: 'Now everyone’s card is in…', done: function (ctx) { return ctx.v.revealed; }, after: 1500 },
        { next: true, target: function (ctx) { return 'slot:' + winner(ctx); }, text: function (ctx) {
          var mine = myPlayed(ctx);
          var lead = mine && mine.id === 'AS'
            ? 'Your ' + K('AS') + ' beats Dex’s ' + K('KS') + '. Drawing paid off this time, but the extra cards are still in your hand.'
            : 'Dex’s ' + K('KS') + ' wins. Drawing more might have found a higher spade, at the cost of more cards in your hand.';
          return lead + ' You can also draw for a better card when you already have the suit.';
        } }
      ]
    },
    {
      title: 'When the deck runs out',
      hands: [['2S', '10C'], ['JH', '5S'], ['8H', '3D']],
      leader: 'p1', setNo: 4,
      deck: ['7C'], fillDeck: false,
      bots: { p1: { lead: 'JH' } },
      steps: [
        { target: 'deck', watch: true, title: 'When the deck runs out', text: 'Mia leads this set. Look at the deck: only one card is left.', done: function (ctx) { return ctx.v.phase === 'follow'; }, after: 700 },
        { target: 'deck', text: 'Mia led the ' + K('JH') + ' and you have no hearts. Draw the last card.', done: function (ctx) { return ctx.v.deckCount === 0 || ctx.me.committed; } },
        { target: 'seats', text: 'The deck is empty and you still have no hearts, so you can’t play this set. Instead, pick up one card from the set into your hand. In a real game you have 10 seconds. Tap a glowing card.', done: function (ctx) { return !!ctx.me.took || ctx.v.phase === 'reveal'; }, after: 900 },
        { next: true, target: 'slot:p1', text: function (ctx) {
          var took = ctx.me.took ? K(ctx.me.took) : 'a card';
          return 'You picked up ' + took + '. A picked-up card still counts for whoever played it, so Mia wins the set with the ' + K('JH') + '. At least you now hold a heart for later.';
        } }
      ]
    },
    {
      title: 'The time limit',
      hands: [['5C', 'QD', '2S'], ['9C', '6D', '3S'], ['KC', '7D', '4S']],
      leader: 'p0', setNo: 5,
      timing: { turnMs: 8000 },
      steps: [
        // Explain first with the clock stopped; the countdown starts on Next.
        { next: true, target: 'lead', place: 'top', dim: false, title: 'The time limit', text: 'Each set has a time limit, and the ring around the middle counts it down. You lead this set. When you tap Next, you’ll have 8 seconds.' },
        // The ring is outlined but the hand stays bright: that's where the tap happens.
        { target: 'lead', place: 'top', dim: false, text: 'Lead a card, or wait and see what happens when time runs out.', done: function (ctx) { return ctx.me.committed; }, after: 900 },
        { next: true, text: function (ctx) {
          var first = saw(ctx, 'timeout') ? 'Time ran out, so a random card was led for you.' : 'You led in time. If you hadn’t, a random card would have been led for you.';
          return first + ' Real games give 30 seconds by default, and you can change that on the setup screen. If you can’t follow when time runs out, the game draws for you until the suit turns up.';
        } }
      ]
    },
    {
      title: 'Winning',
      hands: [['AC'], ['4C', '9D'], ['KC', '6H']],
      leader: 'p0', setNo: 6,
      steps: [
        { target: 'card:AC', title: 'Winning', text: 'You have one card left. Lead it. If nobody else runs out of cards this set, you win the game.', done: function (ctx) { return ctx.me.committed; }, after: 400 },
        { target: 'seats', watch: true, text: 'Mia and Dex play their clubs…', done: function (ctx) { return ctx.v.phase === 'over'; }, after: 1800 },
        { final: true, title: 'You win!', text: 'You emptied your hand first. That’s Burns: follow the suit, draw when you can’t (or when you want a better card), pick up when the deck runs out, and be the first to empty your hand. Playing with friends in the same room? There’s one more lesson: Real Burns.' }
      ]
    },
    {
      // A rule choice, so an extra lesson. You're the one left holding cards,
      // so you call Stop and name the suits; the penalty plan below decides
      // what turns up, whichever suit you name.
      title: 'Real Burns',
      extra: true,
      offer: 'Learn Real Burns',
      options: { real: 'on' },
      hands: [['6D', '3S'], [], ['10D']],
      out: ['p1'],                       // Mia emptied her hand last set
      leader: 'p2', setNo: 6,
      deck: ['2C', '7H', 'QS', '5C', '9S', 'JD', '4H', '8S', 'KC', '3D', '6H', 'AC'], fillDeck: false,
      // each winner's turn: the cards before your suit (Mia: soft, hard, soft), then one of it
      penalty: [['black', 'red', 'black'], []],
      timing: { lostHoldMs: 1000, flipMs: 900, shuffleMs: 600000, suitMs: 600000, slapMs: 600000 },
      steps: [
        { next: true, target: 'seat:p1', title: 'Real Burns', text: 'Real Burns is a rule choice for friends in the same room. Mia has emptied her hand, so she’s safe, but the game isn’t over: the rest play on until one player is left holding cards. They lose.' },
        { target: 'lead', watch: true, text: 'Dex leads with his last card.', done: function (ctx) { return ctx.v.phase === 'follow'; }, after: 700 },
        { target: 'card:6D', text: 'Dex led the ' + K('10D') + '. Follow with your ' + K('6D') + '.', done: function (ctx) { return ctx.me.committed; }, after: 400 },
        { target: 'seats', watch: true, text: 'Dex is out of cards too, so he’s safe. You’re the last player still holding cards, so you lose!', done: function (ctx) { return ctx.v.phase === 'lost' || ctx.v.phase === 'penalty'; }, after: 900 },
        { target: 'act', text: 'Now the penalty round. Each winner takes a turn, starting with Mia. While she shuffles, tap Stop whenever you like.', done: function (ctx) { return penAt(ctx, 0, 'suit'); }, after: 400 },
        { target: 'act', text: 'Name a suit. Mia turns cards over until one of that suit appears.', done: function (ctx) { return penAt(ctx, 0, 'draw'); }, after: 300 },
        { target: 'flips', watch: true, text: function (ctx) { return 'Each card she turns over before a ' + penSuit(ctx) + ' is a slap on your hand…'; }, done: function (ctx) { return penAt(ctx, 0, 'result'); }, after: 900 },
        { next: true, target: 'flips', text: function (ctx) {
          return 'Black cards are soft slaps and red cards are hard ones, so Mia gives you ' + penSlaps(ctx) + '. The ' + penMatch(ctx) + ' itself doesn’t count. Playing with friends, the slaps are real!';
        } },
        { target: 'act', text: 'Now it’s Dex’s turn. Tap Stop again, then name a suit.', done: function (ctx) { return penAt(ctx, 1, 'result'); }, after: 900 },
        { final: true, target: 'flips', title: 'Lucky!', text: function (ctx) {
          return 'Dex’s very first card was a ' + penSuit(ctx) + ', so he gives you no slaps. In all, you take ' + penTotal(ctx) + '. That’s Real Burns! Switch it on in the game setup when you play with friends.';
        } }
      ]
    }
  ];

  /* ---------- scripted computer players: predictable, so lessons play out as written ---------- */

  function scriptedBot(lesson) {
    var script = lesson.bots || {};
    return {
      intent: Burns.bot.intent,
      delay: function (intent, v, rnd, now) {
        if (intent.kind === 'lead') return 1300;
        if (intent.kind === 'draw') return v.timing.drawCooldownMs + 350;
        if (intent.kind === 'take') return 1800;
        // Real Burns: a winner's moment, then Next turn (a computer player that lost calls Stop and names hearts)
        if (intent.kind === 'next') return 1500;
        if (intent.kind === 'stop') return Math.max(0, (v.penalty.stopFrom || 0) - (now || 0)) + 1500;
        if (intent.kind === 'suit') return 1400;
        return 1100;
      },
      decide: function (v) {
        if (v.canStop) return { type: 'stop', payload: {} };
        if (v.canSuit) return { type: 'suit', payload: { suit: 'H' } };
        if (v.canNext) return { type: 'next', payload: {} };
        var mine = script[v.me] || {};
        var byId = function (id) { return v.hand.filter(function (c) { return c.id === id; })[0]; };
        var low = function (cards) { return cards.slice().sort(function (a, b) { return val(a) - val(b); })[0]; };
        if (v.canLead) return { type: 'lead', payload: { cardId: (byId(mine.lead) || low(v.hand)).id } };
        if (v.mustDraw) return { type: 'draw', payload: {} };
        if (v.canFollow) {
          var suited = v.hand.filter(function (c) { return c.suit === v.suit; });
          return { type: 'follow', payload: { cardId: (byId(mine.follow) || low(suited)).id } };
        }
        if (v.canTake) {
          var open = v.table.filter(function (e) { return e.card && !e.takenBy; }).sort(function (a, b) { return val(b.card) - val(a.card); });
          return open.length ? { type: 'take', payload: { cardId: open[0].card.id } } : null;
        }
        return null;
      }
    };
  }

  /* Lay out the lesson's cards. Cards not named go under the named deck
     cards (or aside, with fillDeck: false), in a fixed shuffled order. */
  function rig(state, lesson, now) {
    var used = {};
    state.players.forEach(function (p, i) {
      p.hand = lesson.hands[i].map(C);
      lesson.hands[i].forEach(function (id) { used[id] = true; });
    });
    var top = (lesson.deck || []).map(C);
    top.forEach(function (c) { used[c.id] = true; });
    if (lesson.starter) used[lesson.starter] = true;
    var rest = CT.shuffle(CT.standardDeck().filter(function (c) { return !used[c.id]; }), { rng: 2026 });
    if (lesson.fillDeck === false) { state.deck = top.slice().reverse(); state.discard = rest; }
    else { state.deck = rest.concat(top.slice().reverse()); state.discard = []; }
    state.out = (lesson.out || []).slice();   // Real Burns: players already out and safe
    state.events = [];
    state.seq = 0;
    if (lesson.starter) {
      state.starter = C(lesson.starter);
      state.phase = 'dealing';
      state.phaseEndsAt = now;
    } else {
      // jump straight to the lead of the given set
      state.starter = null;
      state.setNo = lesson.setNo - 1;
      state.phase = 'reveal';
      state.setResult = { player: lesson.leader, card: null };
      state.phaseEndsAt = now;
    }
  }

  /* Real Burns: once you've named a suit, the cards the lesson wants turned
     over go on top of the deck. Nobody sees the deck, so it plays like any
     shuffle. Safe to repeat until the first card is turned over. */
  function stackPenalty(state, lesson) {
    var P = state.penalty;
    if (!P || P.step !== 'draw' || P.drawn.length || !P.deck) return;
    var plan = lesson.penalty[P.turn];
    if (!plan) return;
    var blacks = ['S', 'C'].filter(function (s) { return s !== P.suit; });
    var reds = ['H', 'D'].filter(function (s) { return s !== P.suit; });
    var nb = 0, nr = 0;
    var top = plan.map(function (colour, i) {
      return C(['7', 'J', '4', 'K', '2', 'Q'][i] + (colour === 'red' ? reds[nr++ % reds.length] : blacks[nb++ % blacks.length]));
    });
    top.push(C((plan.length ? '9' : 'A') + P.suit));
    var ids = {};
    top.forEach(function (c) { ids[c.id] = true; });
    P.deck = P.deck.filter(function (c) { return !ids[c.id]; }).concat(top.reverse());   // turned over from the end
  }

  function modeFor(lesson) {
    var mode = Object.assign({}, Burns, { bot: scriptedBot(lesson) });
    if (lesson.penalty) mode.tick = function (state, now) { stackPenalty(state, lesson); return Burns.tick(state, now); };
    return mode;
  }

  function makeSession(lesson) {
    var mode = modeFor(lesson);
    var timing = Object.assign({ dealHoldMs: 0, revealHoldMs: 2600, takeWindowMs: 60000, turnMs: 0 }, lesson.timing || {});
    var options = Object.assign({ flush: 'off', leadCard: 'faceUp', turnTime: '30' }, lesson.options || {});
    var session = new CT.Session({ mode: mode, players: PLAYERS, options: options, seed: 7, timing: timing });
    rig(session.state, lesson, session.now());
    mode.tick(session.state, session.now());   // start the set right away
    return session;
  }

  /* The layout where the table and your hand sit side by side (styles.css). */
  function SIDE_BY_SIDE() {
    return !!(window.matchMedia && window.matchMedia('(max-height: 560px) and (orientation: landscape) and (min-width: 600px)').matches);
  }

  /* ---------- the runner (shared with the other modes' tutorials) ---------- */

  UI.tutorials = UI.tutorials || {};
  UI.tutorials.burns = UI.makeTutorial({
    modeId: 'burns',
    lessons: LESSONS,
    makeSession: makeSession,
    modeFor: modeFor,
    target: function (key) {
      var $ = function (id) { return document.getElementById(id); };
      if (key === 'hand') return $('t-handwrap');
      if (key === 'deck') return $('t-deck');
      if (key === 'lead') return $('t-lead');
      if (key === 'seats') return $('t-seats');
      if (key === 'me') return $('t-me');
      // Real Burns: the cards turned over with their count, and the Stop or suit
      // buttons (or, while there's nothing to tap, the cards again)
      var flips = function () { return UI.around([$('pen-suit'), $('pen-row'), $('pen-tally'), $('pen-say')]); };
      if (key === 'flips') return flips();
      if (key === 'act') { var act = $('pen-act'); return act && act.children.length ? UI.around([$('pen-say'), act]) : flips(); }
      if (key.indexOf('seat:') === 0) return document.querySelector('.seat[data-pid="' + key.slice(5) + '"]');
      if (key.indexOf('slot:') === 0) return $('slot-' + key.slice(5));
      if (key.indexOf('card:') === 0) return document.querySelector('.hcard[data-id="' + key.slice(5) + '"]');
      return null;
    },
    topTargets: /^(card:|hand)/,
    // A phone on its side: the penalty round is two columns (the cards on the
    // left, the count and the buttons on the right), so notes about it sit
    // up in the left column, clear of both.
    anchor: function (key) {
      var pen = document.getElementById('t-pen');
      if (!/^(act|flips)$/.test(key) || !pen || !SIDE_BY_SIDE()) return null;
      return { top: true, el: { getBoundingClientRect: function () {
        var r = pen.getBoundingClientRect(), mid = r.left + r.width / 2;
        return { left: mid, top: r.top, right: r.right, bottom: r.bottom, width: r.right - mid, height: r.height };
      } } };
    },
    playLabel: 'Play Burns'
  });
})(window.CT);
