/* ==========================================================================
   GAME MODE · BURNS — interactive tutorial
   Six short lessons, each a hand-arranged deal played on the real table
   against scripted computer players. A coach bubble explains each step and
   waits for the player to do it. Nothing here is saved or counted in stats.
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
        { next: true, title: 'Lucky deal?', text: 'If your 4 starting cards are all different suits, that’s a Flush and you win on the spot. No Flush this time, so let’s play.' },
        { target: 'card:KD', text: 'Play a diamond. Tap your ' + K('KD') + ' once to pick it, then tap it again, or press Play.', done: function (ctx) { return ctx.me.committed; }, after: 400 },
        { target: 'seats', text: 'Your card lies face down, so Mia and Dex can’t see it. When everyone has played, all the cards are turned over together.', done: function (ctx) { return ctx.v.revealed; }, after: 1500 },
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
        { target: 'seats', text: 'The others only see the suit you led, not the card. Mia and Dex have no hearts, so they must draw from the deck until a heart turns up.', done: function (ctx) { return ctx.v.revealed; }, after: 1500 },
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
        { target: 'lead', title: 'Drawing', text: 'Dex won the last set, so Dex leads. Watch which suit he picks.', done: function (ctx) { return ctx.v.phase === 'follow'; }, after: 700 },
        { target: 'deck', text: 'Dex led ' + S('S') + ' spades, and you don’t have any. Tap the deck to draw, and keep going until a spade turns up.', done: function (ctx) { return ctx.v.canFollow || ctx.me.committed; } },
        { text: function (ctx) {
          var best = bestOfSuit(ctx);
          return 'You found ' + (best ? 'the ' + UI.cardText(best) : 'a spade') + '. Play it now, or tap the deck again to look for a higher spade. Every card you draw stays in your hand, so it’s a gamble.';
        }, done: function (ctx) { return ctx.me.committed; }, after: 400 },
        { target: 'seats', text: 'Now everyone’s card is in…', done: function (ctx) { return ctx.v.revealed; }, after: 1500 },
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
        { target: 'deck', title: 'When the deck runs out', text: 'Mia leads this set. Look at the deck: only one card is left.', done: function (ctx) { return ctx.v.phase === 'follow'; }, after: 700 },
        { target: 'deck', text: 'Mia led ' + S('H') + ' hearts and you have none. Draw the last card.', done: function (ctx) { return ctx.v.deckCount === 0 || ctx.me.committed; } },
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
        // The ring is outlined but the hand stays bright: that's where the tap happens.
        { target: 'lead', place: 'top', dim: false, title: 'The time limit', text: 'Each set has a time limit, and the ring around the middle counts it down. You lead this set and have 8 seconds. Lead a card, or wait and see what happens when time runs out.', done: function (ctx) { return ctx.me.committed; }, after: 900 },
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
        { target: 'seats', text: 'Mia and Dex play their clubs…', done: function (ctx) { return ctx.v.phase === 'over'; }, after: 1800 },
        { final: true, title: 'You win!', text: 'You emptied your hand first. That’s Burns: follow the suit, draw when you can’t (or when you want a better card), pick up when the deck runs out, and be the first to empty your hand.' }
      ]
    }
  ];

  /* ---------- scripted computer players: predictable, so lessons play out as written ---------- */

  function scriptedBot(lesson) {
    var script = lesson.bots || {};
    return {
      intent: Burns.bot.intent,
      delay: function (intent, v) {
        if (intent.kind === 'lead') return 1300;
        if (intent.kind === 'draw') return v.timing.drawCooldownMs + 350;
        if (intent.kind === 'take') return 1800;
        return 1100;
      },
      decide: function (v) {
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

  function makeSession(lesson) {
    var mode = Object.assign({}, Burns, { bot: scriptedBot(lesson) });
    var timing = Object.assign({ dealHoldMs: 0, revealHoldMs: 2600, takeWindowMs: 60000, turnMs: 0 }, lesson.timing || {});
    var session = new CT.Session({ mode: mode, players: PLAYERS, options: { leadCard: 'suitOnly', turnTime: '30' }, seed: 7, timing: timing });
    rig(session.state, lesson, session.now());
    mode.tick(session.state, session.now());   // start the set right away
    return session;
  }

  function targetFn(key) {
    if (!key) return null;
    return function () {
      if (key === 'hand') return document.getElementById('t-handwrap');
      if (key === 'deck') return document.getElementById('t-deck');
      if (key === 'lead') return document.getElementById('t-lead');
      if (key === 'seats') return document.getElementById('t-seats');
      if (key === 'me') return document.getElementById('t-me');
      if (key.indexOf('slot:') === 0) return document.getElementById('slot-' + key.slice(5));
      if (key.indexOf('card:') === 0) return document.querySelector('.hcard[data-id="' + key.slice(5) + '"]');
      return null;
    };
  }

  /* ---------- the controller ---------- */

  function Tutorial(app) {
    this.app = app;
    this.coach = UI.coach || (UI.coach = new UI.Coach());
    this.holding = false;
    this.index = 0;
    this.step = -1;
  }

  Tutorial.prototype.lessons = LESSONS;

  Tutorial.prototype.start = function () {
    var self = this;
    this.coach.onSkip = function () { self.exit(); };
    this.index = 0;
    this.begin();
  };

  Tutorial.prototype.begin = function () {
    var lesson = LESSONS[this.index];
    if (this.unsub) this.unsub();
    this.session = makeSession(lesson);
    this.session.pause();
    this.app.attachTutorial(this.session);
    var self = this;
    this.unsub = this.session.on(function () { self.check(); });
    this.step = -1;
    this.nextStep();
  };

  Tutorial.prototype.ctx = function () {
    var v = this.session.view('p0', { sinceSeq: this.stepSeq || 0 });
    var me = v.players.filter(function (p) { return p.id === 'p0'; })[0];
    return { v: v, me: me, events: v.events || [] };
  };

  Tutorial.prototype.current = function () { return LESSONS[this.index].steps[this.step]; };

  Tutorial.prototype.nextStep = function () {
    clearTimeout(this.timer);
    this.step++;
    var lesson = LESSONS[this.index];
    if (this.step >= lesson.steps.length) {
      this.index++;
      if (this.index >= LESSONS.length) { this.exit(); return; }
      this.begin();
      return;
    }
    var s = this.current();
    this.stepSeq = this.session.state.seq;
    this.advancing = false;
    var read = !!(s.next || s.final);
    this.holding = read;            // the table waits while you read
    if (read) this.session.pause(); else this.app.resumePlay();
    this.render();
    if (!read) this.check();
  };

  Tutorial.prototype.render = function () {
    var self = this, s = this.current(), ctx = this.ctx();
    var lesson = LESSONS[this.index];
    var actions = [];
    if (s.final) {
      actions = [
        { label: 'Back to games', onClick: function () { self.exit(); } },
        { label: 'Play Burns', primary: true, onClick: function () { self.exit('setup'); } }
      ];
    } else if (s.next) {
      actions = [{ label: 'Next', primary: true, onClick: function () { self.nextStep(); } }];
    }
    var target = typeof s.target === 'function' ? s.target(ctx) : s.target;
    var read = !!(s.next || s.final);
    // Reading: dim the table. Doing: keep the hand, deck and Play button clear.
    var place = s.place || (!target ? (read ? 'center' : 'top') : (/^(card:|hand)/.test(target) ? 'top' : 'auto'));
    this.coach.show({
      step: 'Lesson ' + (this.index + 1) + ' of ' + LESSONS.length + ' · ' + lesson.title,
      title: s.title,
      text: typeof s.text === 'function' ? s.text(ctx) : s.text,
      target: targetFn(target),
      place: place,
      dim: s.dim != null ? s.dim : (target ? true : read),
      actions: actions
    });
  };

  /* After every change at the table: has the player done what this step asks? */
  Tutorial.prototype.check = function () {
    var s = this.current();
    if (!s || s.next || s.final || this.advancing) return;
    var ctx = this.ctx();
    if (typeof s.text === 'function') this.coach.setText(s.text(ctx));
    if (!s.done(ctx)) return;
    this.advancing = true;
    var self = this;
    this.timer = setTimeout(function () { self.nextStep(); }, s.after || 400);
  };

  Tutorial.prototype.exit = function (to) {
    clearTimeout(this.timer);
    if (this.unsub) this.unsub();
    this.unsub = null;
    this.holding = false;
    this.coach.hide();
    this.app.endTutorial(to);
  };

  UI.tutorials = UI.tutorials || {};
  UI.tutorials.burns = Tutorial;
})(window.CT);
