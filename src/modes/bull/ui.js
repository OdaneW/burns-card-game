/* ==========================================================================
   GAME MODE · BULL — table screen
   A round table: you at the bottom, everyone else round the circle
   clockwise from your left. The face-down pile sits in the middle under the
   rank that's due next. Pick one to four cards and play them as that rank;
   when someone else plays, the Bull! button is yours until the next player
   has gone. Everything drawn comes from session.view(me), so nothing hidden
   can leak onto the screen.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var Bull = CT.getMode('bull');
  var RANKS = Bull.ranks;
  var PAINTS = ['#F4B942', '#F0643C', '#7FD1C1', '#9CC9EE', '#EBDDBB', '#C9A8F0'];
  var SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
  var NUM = ['no', 'one', 'two', 'three', 'four'];
  var RING = 113.1;   // circumference of the avatar timer ring (r = 18)

  function sortHand(hand) {
    return hand.slice().sort(function (a, b) {
      return (RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)) || (SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]);
    });
  }
  function plural(rank) { return Bull.rankName(rank, 2); }
  function article(rank) { return rank === 'A' || rank === '8' ? 'an' : 'a'; }
  /* "a 7", "an Ace", "two 7s", "four Kings": a claim as it's announced. */
  function claim(rank, n) { return n === 1 ? article(rank) + ' ' + Bull.rankName(rank, 1) : NUM[n] + ' ' + plural(rank); }
  /* After "Mia’s" or "your": "Mia’s 7", "your two 7s". */
  function owned(rank, n) { return n === 1 ? Bull.rankName(rank, 1) : NUM[n] + ' ' + plural(rank); }
  function cardsWord(n) { return n === 1 ? '1 card' : n + ' cards'; }

  function avatarHtml(initial) {
    return '<span class="dk-avatar"><svg class="dk-ring" viewBox="0 0 40 40" aria-hidden="true" hidden>' +
      '<circle class="bg" cx="20" cy="20" r="18"/><circle class="fg" cx="20" cy="20" r="18" stroke-dasharray="' + RING + '" stroke-dashoffset="0"/></svg>' +
      '<span class="dk-initial">' + UI.esc(initial) + '</span></span>';
  }

  function BullTable(app, session, me, opts) {
    opts = opts || {};
    this.app = app;
    this.session = session;
    this.me = me;
    this.lastSeq = 0;
    this.selected = [];
    this.hidden = {};
    this.handEls = {};
    this.seatEls = {};
    this.logItems = [];
    this.v = null;
    this.first = true;
    this.quiet = !!opts.restored;
    this.root = document.getElementById('screen-table');
    this.build();
    var self = this;
    this.unsub = session.on(function () { self.update(); });
    this.onResize = function () { if (self.v) self.layoutHand(sortHand(self.v.hand)); };
    window.addEventListener('resize', this.onResize);
    this.update();
  }

  BullTable.prototype.destroy = function () {
    if (this.unsub) this.unsub();
    window.removeEventListener('resize', this.onResize);
    clearTimeout(this.overTimer);
    this.root.innerHTML = '';
    var fx = document.getElementById('fx');
    if (fx) fx.innerHTML = '';
  };

  BullTable.prototype.name = function (pid) {
    if (pid === this.me) return 'You';
    var p = this.session.state.players.filter(function (x) { return x.id === pid; })[0];
    return p ? UI.esc(p.name) : 'Someone';
  };
  BullTable.prototype.lname = function (pid) { return pid === this.me ? 'you' : this.name(pid); };
  /* "Mia’s" or "your" */
  BullTable.prototype.poss = function (pid) { return pid === this.me ? 'your' : this.name(pid) + '’s'; };
  BullTable.prototype.player = function (v, pid) { return v.players.filter(function (p) { return p.id === pid; })[0]; };

  /* Seats round the table, clockwise from your left. */
  BullTable.prototype.spot = function (v, pid) {
    var ids = v.players.map(function (p) { return p.id; });
    var n = ids.length;
    var k = (ids.indexOf(pid) - ids.indexOf(this.me) + n) % n;
    var a = 2 * Math.PI * k / n;
    return { x: 0.5 - 0.37 * Math.sin(a), y: 0.5 + 0.4 * Math.cos(a) };
  };

  /* ---------- static layout ---------- */

  BullTable.prototype.build = function () {
    var v = this.session.view(this.me, { events: false });
    var self = this;
    this.root.innerHTML =
      '<header class="topbar">' +
        '<button class="icon-btn" id="b-menu" type="button" aria-label="Game menu">' + UI.icon.menu + '</button>' +
        '<span class="wordmark">BULL</span>' +
        '<span class="spacer"></span>' +
        '<button class="icon-btn" id="b-music" type="button"></button>' +
        '<button class="icon-btn" id="b-sound" type="button"></button>' +
      '</header>' +
      '<div class="bl-table" id="b-table">' +
        '<div class="bl-felt" aria-hidden="true"></div>' +
        '<div class="bl-center" id="b-center">' +
          // the last play, big: who played, and what they claim it is
          '<div class="bl-claim" id="b-claim" aria-live="polite" style="visibility:hidden"><span class="who" id="b-claim-who">·</span><b class="what" id="b-claim-what">·</b></div>' +
          '<div class="bl-pile" id="b-pile" aria-hidden="true"><span class="card back"></span><span class="card back"></span><span class="card back"></span></div>' +
          '<p class="bl-pilecount" id="b-pilecount"></p>' +
          // the rank that must be claimed next: the rank alone on a tile, and who has to play it
          '<div class="bl-now" id="b-now"><b class="bl-rank" id="b-rank"></b>' +
            '<span class="bl-now-text"><span class="lbl">Next rank</span><span class="bl-turn" id="b-turn"></span></span></div>' +
          '<div class="bl-reveal" id="b-reveal" hidden></div>' +
        '</div>' +
      '</div>' +
      '<div class="status" id="b-status" aria-live="polite"><p class="status-main"></p><p class="status-sub"></p></div>' +
      '<div class="bl-me" id="b-me">' +
        '<div class="bl-me-info">' + avatarHtml('Y') + '<div class="bl-me-text"><span class="me-name">You</span><span class="me-count" id="b-mecount"></span></div></div>' +
        '<div class="bl-actions">' +
          '<button class="btn bl-bull" id="b-bull" type="button" hidden>Bull!</button>' +
          '<button class="btn btn-primary btn-play" id="b-play" type="button" hidden></button>' +
        '</div>' +
      '</div>' +
      '<div class="hand-wrap bl-handwrap" id="b-handwrap"><div class="hand" id="b-hand"></div></div>';

    var table = this.root.querySelector('#b-table');
    v.players.forEach(function (p, i) {
      if (p.id === self.me) return;
      var at = self.spot(v, p.id);
      var seat = document.createElement('div');
      seat.className = 'bl-seat';
      seat.dataset.pid = p.id;
      seat.style.left = (at.x * 100) + '%';
      seat.style.top = (at.y * 100) + '%';
      seat.style.setProperty('--paint', PAINTS[i % PAINTS.length]);
      seat.innerHTML = avatarHtml(p.name.charAt(0)) +
        '<span class="seat-name">' + UI.esc(p.name) + '</span>' +
        '<span class="bl-count"><span class="card back" aria-hidden="true"></span><b></b></span>' +
        '<span class="bl-bubble" style="visibility:hidden">·</span>';
      table.appendChild(seat);
      self.seatEls[p.id] = {
        seat: seat,
        ring: seat.querySelector('.dk-ring'),
        ringFg: seat.querySelector('.dk-ring .fg'),
        count: seat.querySelector('.bl-count b'),
        stack: seat.querySelector('.bl-count .card'),
        bubble: seat.querySelector('.bl-bubble')
      };
    });
    var meEl = this.root.querySelector('#b-me');
    this.seatEls[this.me] = { seat: meEl, ring: meEl.querySelector('.dk-ring'), ringFg: meEl.querySelector('.dk-ring .fg') };

    this.el = {
      music: this.root.querySelector('#b-music'),
      sound: this.root.querySelector('#b-sound'),
      center: this.root.querySelector('#b-center'),
      claim: this.root.querySelector('#b-claim'),
      claimWho: this.root.querySelector('#b-claim-who'),
      claimWhat: this.root.querySelector('#b-claim-what'),
      rank: this.root.querySelector('#b-rank'),
      turn: this.root.querySelector('#b-turn'),
      now: this.root.querySelector('#b-now'),
      pile: this.root.querySelector('#b-pile'),
      pileCount: this.root.querySelector('#b-pilecount'),
      reveal: this.root.querySelector('#b-reveal'),
      statusMain: this.root.querySelector('#b-status .status-main'),
      statusSub: this.root.querySelector('#b-status .status-sub'),
      meCount: this.root.querySelector('#b-mecount'),
      meAvatar: this.root.querySelector('#b-me .dk-avatar'),
      bull: this.root.querySelector('#b-bull'),
      play: this.root.querySelector('#b-play'),
      handWrap: this.root.querySelector('#b-handwrap'),
      hand: this.root.querySelector('#b-hand')
    };
    this.renderAudio();

    this.root.querySelector('#b-menu').addEventListener('click', function () { self.app.openMenu(); });
    this.el.music.addEventListener('click', function () { self.app.toggleMusic(); self.renderAudio(); });
    this.el.sound.addEventListener('click', function () { self.app.toggleSound(); self.renderAudio(); });
    this.el.hand.addEventListener('click', function (e) {
      var btn = e.target.closest('.hcard');
      if (btn) self.tapCard(btn.dataset.id, btn);
    });
    this.el.play.addEventListener('click', function () { self.play(); });
    // called on the press: a moment can decide whether the window is still open
    this.el.bull.addEventListener('pointerdown', function (e) { e.preventDefault(); self.callBull(); });
    this.el.bull.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.callBull(); }
    });
  };

  BullTable.prototype.renderAudio = function () {
    var m = UI.Music.on, s = UI.Sound.on;
    this.el.music.innerHTML = m ? UI.icon.musicOn : UI.icon.musicOff;
    this.el.music.setAttribute('aria-label', m ? 'Music on. Tap to turn it off.' : 'Music off. Tap to turn it on.');
    this.el.music.classList.toggle('off', !m);
    this.el.sound.innerHTML = s ? UI.icon.soundOn : UI.icon.soundOff;
    this.el.sound.setAttribute('aria-label', s ? 'Sound effects on. Tap to mute.' : 'Sound effects off. Tap to turn on.');
    this.el.sound.classList.toggle('off', !s);
  };

  /* ---------- update cycle ---------- */

  BullTable.prototype.update = function () {
    var v = this.session.view(this.me, { sinceSeq: this.lastSeq });
    var events = v.events || [];
    var prev = this.v;
    this.v = v;
    var pre = (events.length && prev && !this.quiet) ? this.capture() : null;
    var plan = (!this.quiet && events.length) ? this.plan(events, pre, v) : { flights: [] };
    this.render(v);
    if (plan.flights.length) this.run(plan);
    if (!this.quiet) this.react(events, v);
    var self = this;
    events.forEach(function (e) { self.logEvent(e, v); });
    if (events.length) this.lastSeq = events[events.length - 1].seq;
    this.first = false;
    this.quiet = false;
    if (this.app.logOpen) this.app.renderLog();

    if (v.phase === 'over' && !this.overShown) {
      this.overShown = true;
      this.overTimer = setTimeout(function () { self.app.showResult(self.v); }, events.length ? 2200 : 200);
    }
  };

  BullTable.prototype.capture = function () {
    var pre = { hand: {} };
    for (var id in this.handEls) pre.hand[id] = this.handEls[id].getBoundingClientRect();
    return pre;
  };

  /* Card flights for a batch of events. */
  BullTable.prototype.plan = function (events, pre, v) {
    var me = this.me, self = this;
    var flights = [];
    function add(f) { if (f.hide) self.hide(f.hide); flights.push(f); }
    events.forEach(function (e) {
      if (e.type === 'deal') {
        var mine = e.mine ? sortHand(e.mine.hand) : [];
        var gap = Math.min(45, 1100 / Math.max(1, mine.length));
        mine.forEach(function (c, i) {
          add({ from: 'pile', to: 'h:' + c.id, card: c, delay: 120 + i * gap, duration: 300, hide: 'h:' + c.id, sound: i % 2 ? null : 'deal' });
        });
        e.order.forEach(function (pid, k) {
          if (pid === me) return;
          for (var r = 0; r < 3; r++) add({ from: 'pile', to: 'seat:' + pid, card: null, delay: 160 + (r * e.order.length + k) * 70, duration: 300 });
        });
      } else if (e.type === 'play') {
        var cards = e.player === me && e.mine ? e.mine.cards : null;
        for (var i = 0; i < e.n; i++) {
          var c = cards ? cards[i] : null;
          add({ fromRect: c && pre ? pre.hand[c.id] : null, from: 'seat:' + e.player, to: 'pile', card: null, delay: i * 70, duration: 380 });
        }
      } else if (e.type === 'pickup') {
        if (e.player === me && e.mine) {
          sortHand(e.mine.cards).forEach(function (c, i) {
            if (i < 10) add({ from: 'pile', to: 'h:' + c.id, card: null, delay: i * 55, duration: 380, hide: 'h:' + c.id });
          });
        } else {
          for (var j = 0; j < Math.min(6, e.count); j++) add({ from: 'pile', to: 'seat:' + e.player, card: null, delay: j * 55, duration: 380 });
        }
      }
    });
    return { flights: flights };
  };

  BullTable.prototype.target = function (key) {
    if (key === 'pile') return this.el.pile.lastElementChild;
    if (key.indexOf('h:') === 0) return this.handEls[key.slice(2)] || null;
    if (key.indexOf('seat:') === 0) {
      var pid = key.slice(5);
      if (pid === this.me) {
        var cards = this.el.hand.children;
        return cards.length ? cards[Math.floor(cards.length / 2)] : this.el.meAvatar;
      }
      var s = this.seatEls[pid];
      return s ? s.stack : null;
    }
    return null;
  };

  BullTable.prototype.run = function (plan) {
    var self = this;
    plan.flights.forEach(function (f) {
      var from = f.fromRect ? null : self.target(f.from);
      var to = self.target(f.to);
      if (f.sound) setTimeout(function () { UI.Sound.play(f.sound); }, f.delay || 0);
      UI.fly({ from: from, fromRect: f.fromRect, to: to, card: f.card, delay: f.delay, duration: f.duration })
        .then(function () { if (f.hide) self.unhide(f.hide); });
    });
  };

  BullTable.prototype.hide = function (key) { this.hidden[key] = (this.hidden[key] || 0) + 1; };
  BullTable.prototype.unhide = function (key) {
    this.hidden[key] = Math.max(0, (this.hidden[key] || 0) - 1);
    if (this.hidden[key]) return;
    delete this.hidden[key];
    var el = this.target(key);
    if (el) el.style.visibility = '';
  };

  /* ---------- rendering ---------- */

  BullTable.prototype.render = function (v) {
    this.renderSeats(v);
    this.renderCenter(v);
    this.renderStatus(v);
    this.renderMe(v);
    this.renderHand(v);
  };

  BullTable.prototype.renderSeats = function (v) {
    var self = this, r = v.phase === 'reveal' ? v.reveal : null;
    v.players.forEach(function (p) {
      var s = self.seatEls[p.id];
      if (!s) return;
      var turn = (v.phase === 'play' && v.turn === p.id);
      s.seat.classList.toggle('is-turn', turn);
      if (p.id === self.me) return;
      s.count.textContent = p.handCount;
      s.seat.classList.toggle('is-out', p.handCount === 0);
      s.seat.setAttribute('aria-label', p.name + ', ' + cardsWord(p.handCount) + (turn ? ', playing' : ''));
      // what they're saying: Bull!, or how a call went (their claims show big in the middle)
      var say = '', tone = '';
      if (r && r.challenger === p.id) { say = 'Bull!'; tone = 'hot'; }
      else if (r && r.accused === p.id) { say = r.lie ? 'Caught!' : 'True!'; tone = r.lie ? 'ember' : 'ok'; }
      else if (v.phase === 'over' && v.winners && v.winners[0] === p.id) { say = 'Out!'; tone = 'ok'; }
      s.bubble.style.visibility = say ? '' : 'hidden';   // keeps its space, so the seat doesn't jump
      s.bubble.textContent = say || '·';
      s.bubble.className = 'bl-bubble' + (tone ? ' ' + tone : '');
    });
  };

  BullTable.prototype.renderCenter = function (v) {
    var r = v.reveal;
    var showReveal = v.phase === 'reveal' && r;
    this.el.center.classList.toggle('revealing', !!showReveal);
    this.el.reveal.hidden = !showReveal;
    this.renderClaim(v);
    // the rank to claim next, on its own ("5", not "5s"), and who has to play it
    var mine = v.phase === 'play' && v.turn === this.me;
    var turnText = mine ? 'Your turn: play ' + plural(v.rank)
      : v.turn ? this.name(v.turn) + ' must play ' + plural(v.rank) : '';
    this.el.rank.textContent = v.rank;
    this.el.rank.setAttribute('aria-label', plural(v.rank));
    if (this.el.turn.innerHTML !== turnText) this.el.turn.innerHTML = turnText;
    this.el.now.classList.toggle('mine', mine);
    // keeps its space while hidden, so the pile doesn't jump
    this.el.now.style.visibility = v.phase === 'play' ? '' : 'hidden';
    // the pile: up to three backs, to suggest its size
    var backs = this.el.pile.children;
    var shown = v.phase === 'dealing' ? 1 : v.pileCount ? Math.min(3, Math.ceil(v.pileCount / 4)) : 0;
    for (var i = 0; i < backs.length; i++) backs[i].style.visibility = i < shown ? '' : 'hidden';
    this.el.pile.classList.toggle('empty', !shown);
    this.el.pileCount.textContent = v.pileCount ? cardsWord(v.pileCount) : (v.phase === 'dealing' ? '' : 'No cards yet');
    if (!showReveal) return;
    var key = r.no + ':' + r.challenger;
    if (this.el.reveal.dataset.key === key) return;
    this.el.reveal.dataset.key = key;
    this.el.reveal.innerHTML = '<p class="bl-reveal-head">' + this.poss(r.accused).replace(/^your/, 'Your') + ' ' + owned(r.rank, r.n) + ':</p>' +
      '<div class="bl-reveal-cards"></div><p class="bl-stamp ' + (r.lie ? 'lie' : 'true') + '">' + (r.lie ? 'Bluff!' : 'True!') + '</p>';
    var row = this.el.reveal.querySelector('.bl-reveal-cards');
    r.cards.forEach(function (c, i) {
      var el = UI.makeCard(c);
      el.classList.toggle('wrong', c.rank !== r.rank);
      el.style.setProperty('--i', i);
      row.appendChild(el);
    });
  };

  /* The last play, big enough to read across the table: "Mia played / two
     Kings". It pops in with every play, and goes once the pile is picked up. */
  BullTable.prototype.renderClaim = function (v) {
    var last = (v.phase === 'play' || v.phase === 'lastcall') ? v.last : null;
    var el = this.el.claim;
    el.style.visibility = last ? '' : 'hidden';   // keeps its space, so the pile doesn't jump
    if (!last) { this.claimKey = null; return; }
    var key = last.no + ':' + last.by;
    if (this.claimKey === key) return;
    this.claimKey = key;
    var p = this.player(v, last.by);
    var mine = last.by === this.me;
    this.el.claimWho.textContent = (mine ? 'You' : (p ? p.name : 'Someone')) + ' played';
    this.el.claimWho.style.color = mine ? '' : PAINTS[Math.max(0, v.players.indexOf(p)) % PAINTS.length];
    this.el.claimWhat.textContent = claim(last.rank, last.n);
    if (this.quiet) return;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  };

  BullTable.prototype.statusFor = function (v) {
    var me = this.me, self = this;
    var timer = ' <span class="secs"></span>';
    var last = v.last, r = v.reveal;
    switch (v.phase) {
      case 'dealing':
        return { main: 'Dealing the whole deck…', sub: (v.starter === me ? 'You start' : this.name(v.starter) + ' starts') + ' with Aces.' };
      case 'play': {
        var want = plural(v.rank);
        if (v.turn === me) {
          var have = v.hand.filter(function (c) { return c.rank === v.rank; }).length;
          var waiting = v.openAt != null && this.session.now() < v.openAt && last;
          var picked = this.selected.length && this.selected.every(function (id) { return v.hand.some(function (c) { return c.id === id && c.rank === v.rank; }); }) && this.selected.length === Math.min(4, have);
          var pick = have && !picked ? ' <button class="link-btn bl-pick" id="b-pick" type="button">Pick ' + (have === 1 ? 'it' : 'them') + '</button>' : '';
          var sub = waiting
            ? 'Everyone has a moment to call Bull on ' + this.poss(last.by) + ' ' + owned(last.rank, last.n) + '.'
            : have ? 'You have ' + NUM[have] + ' ' + Bull.rankName(v.rank, have) + '.' + pick
              : 'You have no ' + want + ', so you’ll have to bluff.';
          return { main: '<span class="hl">Your turn:</span> play ' + want + '.' + timer, sub: sub };
        }
        var main = this.name(v.turn) + ' is playing ' + want + '…';
        if (v.canBull && last) {
          var q = last.n === 1 ? 'Is ' + this.poss(last.by) + ' card really ' + claim(last.rank, 1) : 'Are ' + this.poss(last.by) + ' cards really ' + claim(last.rank, last.n);
          return { main: main, sub: q + '? If not, call Bull before ' + this.lname(v.turn) + ' plays.' };
        }
        if (last && last.by === me) return { main: main, sub: 'You played ' + claim(last.rank, last.n) + '. Will anyone call Bull?' };
        return { main: main, sub: '' };
      }
      case 'lastcall':
        if (last.by === me) return { main: 'That was your last card! <span class="hl">Will anyone call Bull?</span>', sub: 'If nobody does, you win.' };
        return { main: '<span class="hl">' + this.name(last.by) + ' played their last ' + (last.n === 1 ? 'card' : 'cards') + '!</span>' + timer, sub: 'Call Bull now, or ' + this.name(last.by) + ' wins.' };
      case 'reveal': {
        var who = r.challenger === me ? 'You called' : this.name(r.challenger) + ' called';
        var taker = r.taker === me ? 'You pick up ' : this.name(r.taker) + ' picks up ';
        var main = r.lie
          ? '<span class="em">Bluff!</span> ' + taker + cardsWord(r.count) + '.'
          : '<span class="hl">True!</span> ' + taker + cardsWord(r.count) + '.';
        var sub = who + ' Bull on ' + this.poss(r.accused) + ' ' + owned(r.rank, r.n) + ': ' + r.cards.map(UI.cardText).join(' ');
        if (r.wasLast && !r.lie) sub = this.name(r.accused) + (r.accused === me ? ' were' : ' was') + ' telling the truth with ' + (r.accused === me ? 'your' : 'their') + ' last cards.';
        return { main: main, sub: sub };
      }
      case 'over': {
        var w = v.winners && v.winners[0];
        return { main: w === me ? '<span class="hl">You win!</span>' : this.name(w) + ' wins.', sub: (w === me ? 'You' : this.name(w)) + ' got rid of every card.' };
      }
    }
    return { main: '', sub: '' };
  };

  BullTable.prototype.renderStatus = function (v) {
    var st = this.statusFor(v);
    if (this.statusHtml === st.main + '|' + st.sub) return;
    this.statusHtml = st.main + '|' + st.sub;
    this.el.statusMain.innerHTML = st.main;
    this.el.statusSub.innerHTML = st.sub || '';
    var self = this, pick = this.el.statusSub.querySelector('#b-pick');
    if (pick) pick.addEventListener('click', function () { self.pickRank(); });
  };

  BullTable.prototype.renderMe = function (v) {
    var mine = this.player(v, this.me);
    this.el.meCount.textContent = mine ? cardsWord(mine.handCount) : '';
    this.el.bull.hidden = !v.canBull;
    if (v.canBull && v.last) this.el.bull.setAttribute('aria-label', 'Call Bull on ' + this.poss(v.last.by) + ' ' + owned(v.last.rank, v.last.n));
    var n = this.selected.length;
    this.el.play.hidden = !(v.canPlay && n);
    if (v.canPlay && n) {
      this.el.play.innerHTML = 'Play ' + n + '<span class="as"> as ' + (n === 1 ? article(v.rank) + ' ' + Bull.rankName(v.rank, 1) : plural(v.rank)) + '</span>';
      this.el.play.setAttribute('aria-label', 'Play ' + n + ' as ' + claim(v.rank, n).replace(/^(one|two|three|four) /, ''));
      this.updatePlayWait();
    }
  };

  /* Play waits until everyone has had their moment to call Bull. */
  BullTable.prototype.updatePlayWait = function () {
    var v = this.v;
    if (!v || this.el.play.hidden) return;
    var wait = v.openAt != null ? v.openAt - this.session.now() : 0;
    var waiting = wait > 0;
    this.el.play.disabled = waiting;
    this.el.play.classList.toggle('waiting', waiting);
  };

  BullTable.prototype.renderHand = function (v) {
    var cards = sortHand(v.hand);
    var self = this;
    this.selected = this.selected.filter(function (id) { return v.hand.some(function (c) { return c.id === id; }); });
    var keep = {};
    cards.forEach(function (c, i) {
      keep[c.id] = true;
      var el = self.handEls[c.id];
      if (!el) {
        el = UI.makeCard(c, 'button');
        el.type = 'button';
        el.classList.add('hcard');
        el.dataset.id = c.id;
        if (!self.first && !self.hidden['h:' + c.id]) el.classList.add('new');
        self.el.hand.appendChild(el);
        self.handEls[c.id] = el;
      }
      el.classList.toggle('playable', !!v.canPlay && c.rank === v.rank);
      el.classList.toggle('selected', self.selected.indexOf(c.id) >= 0);
      el.style.visibility = self.hidden['h:' + c.id] ? 'hidden' : '';
    });
    for (var id in this.handEls) {
      if (!keep[id]) { this.handEls[id].parentNode.removeChild(this.handEls[id]); delete this.handEls[id]; }
    }
    this.layoutHand(cards);
  };

  /* One row while the cards fit; two overlapping rows for a big hand. */
  BullTable.prototype.layoutHand = function (cards) {
    var wrap = this.el.handWrap;
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hcw')) || 58;
    var n = cards.length;
    var two = n > 1 && (W - cw) / (n - 1) < cw * 0.36;
    wrap.classList.toggle('two', two);
    this.el.hand.style.width = W + 'px';
    var rows = two ? [cards.slice(0, Math.ceil(n / 2)), cards.slice(Math.ceil(n / 2))] : [cards];
    var lift = cw * 1.4 * 0.56;
    var self = this;
    rows.forEach(function (row, ri) {
      var m = row.length;
      var step = m > 1 ? Math.min(cw + 8, (W - cw) / (m - 1)) : 0;
      var total = m ? (m - 1) * step + cw : 0;
      var offset = Math.max(0, (W - total) / 2);
      row.forEach(function (c, i) {
        var el = self.handEls[c.id];
        if (!el) return;
        el.style.left = (offset + i * step) + 'px';
        el.style.bottom = (two && ri === 0 ? lift + 4 : 4) + 'px';
        el.style.zIndex = String(ri * 100 + i + 1);   // a picked card rises, but never covers its neighbours
      });
    });
  };

  /* ~20×/s from the app loop: turn timers, and Play waiting for Bull calls. */
  BullTable.prototype.frame = function () {
    var v = this.v;
    if (!v) return;
    var now = this.session.now();
    var self = this;
    var who = null, endsAt = null, total = 0;
    if (v.phase === 'play' && v.turnEndsAt && (v.openAt == null || now >= v.openAt)) { who = v.turn; endsAt = v.turnEndsAt; total = v.timing.turnMs; }
    if (v.phase === 'lastcall' && v.last) { who = v.last.by; endsAt = v.phaseEndsAt; total = v.timing.lastCallMs; }
    Object.keys(this.seatEls).forEach(function (pid) {
      var s = self.seatEls[pid];
      if (!s.ring) return;
      if (pid === who && endsAt) {
        s.ring.removeAttribute('hidden');
        var left = Math.max(0, endsAt - now);
        s.ringFg.setAttribute('stroke-dashoffset', String(RING * (1 - (total ? left / total : 0))));
        s.ring.classList.toggle('urgent', left <= 5000);
      } else s.ring.setAttribute('hidden', '');
    });
    var span = this.el.statusMain.querySelector('.secs');
    var mineToWatch = (who === this.me && v.phase === 'play') || v.phase === 'lastcall';
    if (span && endsAt && mineToWatch) {
      var left = Math.max(0, endsAt - now);
      var sec = Math.ceil(left / 1000);
      span.textContent = (v.phase === 'lastcall' || left <= 10000) ? '· ' + sec + 's' : '';
      if (sec !== this.lastSecs) {
        this.lastSecs = sec;
        if (v.phase === 'play' && left <= 5000 && sec > 0) UI.Sound.play('tick');
      }
    } else if (span) span.textContent = '';
    // the waiting moment ends: Play comes alive, and the hint changes
    var waiting = v.phase === 'play' && v.turn === this.me && v.openAt != null && now < v.openAt;
    if (waiting !== this.wasWaiting) { this.wasWaiting = waiting; this.renderStatus(v); }
    this.updatePlayWait();
  };

  /* ---------- input ---------- */

  BullTable.prototype.tapCard = function (id, el) {
    var v = this.v;
    if (!v) return;
    UI.Sound.unlock();
    var i = this.selected.indexOf(id);
    if (i >= 0) this.selected.splice(i, 1);
    else if (this.selected.length >= Bull.maxPlay) {
      this.shake(el);
      UI.toast('You can play up to four cards at a time.');
      return;
    } else this.selected.push(id);
    UI.buzz(8);
    this.renderHand(v);
    this.renderMe(v);
    this.renderStatus(v);
  };

  BullTable.prototype.pickRank = function () {
    var v = this.v;
    if (!v) return;
    this.selected = v.hand.filter(function (c) { return c.rank === v.rank; }).slice(0, 4).map(function (c) { return c.id; });
    UI.buzz(8);
    this.renderHand(v);
    this.renderMe(v);
    this.renderStatus(v);
  };

  BullTable.prototype.shake = function (el) {
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  };

  /* A move. At this table the answer is immediate; at an online table it
     comes back from the server a moment later, and further taps wait for it. */
  BullTable.prototype.send = function (type, payload, then) {
    if (this.sending) return;
    var self = this;
    this.sending = true;
    var finish = function (res) { self.sending = false; if (then) then(res); };
    var res = this.session.act(this.me, type, payload, finish);
    if (!res || !res.pending) finish(res);
  };

  BullTable.prototype.play = function () {
    var v = this.v, self = this;
    if (!v || !v.canPlay || !this.selected.length) return;
    UI.Sound.unlock();
    this.send('play', { cardIds: this.selected.slice() }, function (res) {
      if (!res.ok) {
        if (res.code !== 'wait') UI.toast(UI.esc(res.message));
        UI.Sound.play('nope');
        return;
      }
      self.selected = [];
      UI.buzz(10);
    });
  };

  BullTable.prototype.callBull = function () {
    var v = this.v;
    if (!v || !v.canBull || !v.last) return;
    UI.Sound.unlock();
    var key = v.last.no;
    if (this.called === key) return;
    this.called = key;
    UI.Sound.play('bull');
    UI.buzz(30);
    var self = this;
    this.send('bull', {}, function (res) {
      if (!res.ok) {
        if (res.code === 'offline') self.called = null;
        else if (res.code === 'phase' || res.code === 'nothing') UI.toast('Too late: ' + UI.esc(res.message.charAt(0).toLowerCase() + res.message.slice(1)));
      }
    });
  };

  /* ---------- sounds and notices ---------- */

  BullTable.prototype.react = function (events, v) {
    var me = this.me;
    events.forEach(function (e) {
      switch (e.type) {
        case 'play':
          UI.Sound.play(e.player === me ? 'play' : 'deal');
          break;
        case 'bull':
          if (e.challenger !== me) UI.Sound.play('bull');
          setTimeout(function () { UI.Sound.play('flip'); }, 420);
          if (e.accused === me || e.challenger === me) UI.buzz(e.taker === me ? 60 : 15);
          break;
        case 'pickup':
          setTimeout(function () { UI.Sound.play(e.player === me ? 'lose' : 'draw'); }, 120);
          break;
        case 'lastCall':
          UI.Sound.play('alert');
          break;
        case 'timeout':
          if (e.player === me) { UI.toast('Time’s up. A card was played for you.'); UI.Sound.play('nope'); }
          break;
        case 'gameOver':
          setTimeout(function () { UI.Sound.play(e.winners.indexOf(me) >= 0 ? 'victory' : 'lose'); }, 700);
          break;
      }
    });
  };

  /* ---------- play-by-play ---------- */

  BullTable.prototype.pushLog = function (html, cls) {
    var item = { html: html, cls: cls || '' };
    this.logItems.push(item);
    if (this.logItems.length > 600) this.logItems.shift();
    return item;
  };

  BullTable.prototype.logEvent = function (e, v) {
    var me = this.me, self = this;
    var N = function (pid) { return self.name(pid); };
    switch (e.type) {
      case 'deal':
        this.pushLog('The whole deck is dealt. ' + (e.starter === me ? 'You start' : N(e.starter) + ' starts') + ' with Aces.', 'set');
        if (e.mine) this.pushLog('Your hand: ' + sortHand(e.mine.hand).map(UI.cardText).join(' '));
        break;
      case 'play': {
        var text = (e.player === me ? 'You played ' : N(e.player) + ' played ') + claim(e.rank, e.n);
        if (e.player === me && e.mine) {
          var bluff = e.mine.cards.some(function (c) { return c.rank !== e.rank; });
          text += ': ' + e.mine.cards.map(UI.cardText).join(' ') + (bluff ? ' (a bluff)' : '');
        }
        this.pushLog(text + (e.auto ? ' (time ran out)' : '') + '.');
        break;
      }
      case 'bull':
        this.pushLog((e.challenger === me ? 'You' : N(e.challenger)) + ' called Bull on ' + this.poss(e.accused) + ' ' + owned(e.rank, e.n) + ': ' +
          e.cards.map(UI.cardText).join(' ') + '. ' + (e.lie ? 'A bluff!' : 'True!'), 'win');
        break;
      case 'pickup':
        this.pushLog((e.player === me ? 'You pick up ' : N(e.player) + ' picks up ') + cardsWord(e.count) + '.');
        break;
      case 'lastCall':
        this.pushLog((e.player === me ? 'You' : N(e.player)) + ' played ' + (e.player === me ? 'your' : 'their') + ' last cards. Last chance to call Bull!', 'set');
        break;
      case 'gameOver':
        this.pushLog((e.winners[0] === me ? 'You win' : N(e.winners[0]) + ' wins') + ': no cards left.', 'win');
        break;
    }
  };

  /* ---------- end of game ---------- */

  BullTable.prototype.result = function (v) {
    var me = this.me, self = this;
    var w = v.winners && v.winners[0];
    var order = v.players.slice().sort(function (a, b) { return a.handCount - b.handCount; });
    var rows = order.map(function (p) {
      var idx = v.players.indexOf(p);
      var paint = p.id === me ? 'var(--ink)' : PAINTS[idx % PAINTS.length];
      var nm = p.id === me ? 'You' : UI.esc(p.name);
      return '<li class="' + (p.id === w ? 'champ' : '') + '"><span class="avatar" style="--paint:' + paint + '">' + UI.esc(nm.charAt(0)) + '</span>' +
        '<span>' + nm + '</span><span class="left">' + (p.handCount ? cardsWord(p.handCount) + ' left' : 'out') + '</span></li>';
    }).join('');
    return {
      why: (w === me ? 'You' : this.name(w)) + ' got rid of every card first.',
      body: '<div class="standings"><ul>' + rows + '</ul></div>'
    };
  };

  CT.UI.presenters = CT.UI.presenters || {};
  CT.UI.presenters.bull = BullTable;
})(window.CT);
