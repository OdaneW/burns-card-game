/* ==========================================================================
   GAME MODE · BURNS — table screen
   Draws one player's view of a Burns game and turns taps into actions.
   It never reads the rules state directly: everything comes from
   session.view(me), so it can't show anything the player shouldn't see.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var PAINTS = ['#F4B942', '#F0643C', '#7FD1C1', '#9CC9EE', '#EBDDBB'];
  var SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
  var RING = 295.3;          // circumference of the countdown ring
  var SHOW_SECS_AT = 10000;  // show the seconds when this little time is left
  var SUIT_ARM_MS = 800;     // Real Burns: after Stop, the suit buttons wake up this much later

  function sortHand(hand) {
    return hand.slice().sort(function (a, b) {
      return (SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]) || (CT.rankValue(a.rank, true) - CT.rankValue(b.rank, true));
    });
  }

  function list(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function makeFlip() {
    var flip = document.createElement('div');
    flip.className = 'flip';
    flip.dataset.up = '0';
    var inner = document.createElement('div');
    inner.className = 'flip-in';
    var back = UI.makeCard(null);
    var front = UI.makeCard(null);
    front.classList.add('front');
    inner.appendChild(back);
    inner.appendChild(front);
    flip.appendChild(inner);
    return { flip: flip, inner: inner, front: front };
  }

  function BurnsTable(app, session, me, opts) {
    opts = opts || {};
    this.app = app;
    this.session = session;
    this.me = me;
    this.lastSeq = 0;
    this.selected = null;
    this.hidden = {};
    this.handEls = {};
    this.seatEls = {};
    this.slotState = {};
    this.logItems = [];
    this.drawLog = {};
    this.v = null;
    this.overShown = false;
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

  BurnsTable.prototype.destroy = function () {
    if (this.unsub) this.unsub();
    window.removeEventListener('resize', this.onResize);
    clearTimeout(this.overTimer);
    this.root.innerHTML = '';
    var fx = document.getElementById('fx');
    if (fx) fx.innerHTML = '';   // cards still in flight belonged to this table
  };

  BurnsTable.prototype.name = function (pid, cap) {
    if (pid === this.me) return cap === false ? 'you' : 'You';
    var p = this.v && this.v.players.filter(function (x) { return x.id === pid; })[0];
    if (!p) p = this.session.state.players.filter(function (x) { return x.id === pid; })[0];
    return p ? UI.esc(p.name) : 'Someone';
  };

  BurnsTable.prototype.mine = function (v) {
    var me = this.me;
    return v.players.filter(function (p) { return p.id === me; })[0];
  };

  /* ---------- static layout ---------- */

  BurnsTable.prototype.build = function () {
    var view = this.session.view(this.me, { events: false });
    var me = this.me;
    var opps = view.players.filter(function (p) { return p.id !== me; });
    this.root.innerHTML =
      '<header class="topbar">' +
        '<button class="icon-btn" id="t-menu" type="button" aria-label="Game menu">' + UI.icon.menu + '</button>' +
        '<span class="wordmark">BURNS</span>' +
        '<span class="chip" id="t-set">Dealing</span>' +
        '<span class="spacer"></span>' +
        '<button class="icon-btn" id="t-music" type="button"></button>' +
        '<button class="icon-btn" id="t-sound" type="button"></button>' +
      '</header>' +
      '<div class="seats" id="t-seats"></div>' +
      '<div class="rail-zone">' +
        '<div class="rail">' +
          '<button class="deck" id="t-deck" type="button" aria-label="Deck">' +
            '<span class="deck-stack"><span class="card back"></span><span class="card back"></span><span class="card back"></span></span>' +
            '<svg class="cool" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16"/></svg>' +
            '<span class="deck-count" id="t-deckcount"></span>' +
          '</button>' +
          '<div class="lead-spot" id="t-lead">' +
            '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true" hidden><circle class="bg" cx="50" cy="50" r="47"/><circle class="fg" cx="50" cy="50" r="47" stroke-dasharray="' + RING + '" stroke-dashoffset="0"/></svg>' +
            '<div class="lead-content" id="t-leadcontent"></div>' +
            '<span class="timer-num" id="t-timer" hidden></span>' +
            '<span class="lead-label" id="t-leadlabel"></span>' +
          '</div>' +
          '<div class="aside" id="t-aside">' +
            '<span class="aside-stack"><span class="card back"></span><span class="card back"></span></span>' +
            '<span class="aside-count" id="t-asidecount"></span>' +
          '</div>' +
        '</div>' +
        '<div class="status" id="t-status" aria-live="polite"><p class="status-main"></p><p class="status-sub"></p></div>' +
      '</div>' +
      // Real Burns: the penalty round takes over from the table once the loser is known
      '<section class="pen" id="t-pen" aria-label="Penalty round">' +
        '<header class="pen-head"><p class="pen-eyebrow">Real Burns · penalty round</p>' +
          '<h2 class="pen-title" id="pen-title"></h2><p class="pen-who" id="pen-who"></p></header>' +
        '<div class="pen-stage">' +
          '<div class="pen-deck" id="pen-deck" aria-hidden="true"><span class="card back"></span><span class="card back"></span><span class="card back"></span></div>' +
          '<span class="pen-suit" id="pen-suit" hidden></span>' +
          '<div class="pen-row" id="pen-row"></div>' +
        '</div>' +
        '<div class="pen-tally" id="pen-tally" hidden>' +
          '<span class="pen-count soft"><b id="pen-soft">0</b><span>soft · black</span></span>' +
          '<span class="pen-count hard"><b id="pen-hard">0</b><span>hard · red</span></span>' +
        '</div>' +
        '<p class="pen-say" id="pen-say" aria-live="polite"></p>' +
        '<div class="pen-act" id="pen-act"></div>' +
        '<p class="pen-timer" id="pen-timer"></p>' +
        '<ol class="pen-done" id="pen-done"></ol>' +
      '</section>' +
      '<div class="me" id="t-me">' +
        '<div class="me-info"><span class="me-name">You' + UI.icon.flame + '</span><span class="me-count" id="t-mycount"></span></div>' +
        '<div class="slot" id="slot-' + me + '"></div>' +
        '<div class="me-action"><button class="btn btn-primary btn-play" id="t-play" type="button" hidden></button></div>' +
      '</div>' +
      '<div class="hand-wrap" id="t-handwrap"><div class="hand" id="t-hand"></div></div>';

    var seats = this.root.querySelector('#t-seats');
    var self = this;
    opps.forEach(function (p, i) {
      var seat = document.createElement('div');
      seat.className = 'seat';
      seat.dataset.pid = p.id;
      seat.style.setProperty('--paint', PAINTS[i % PAINTS.length]);
      seat.innerHTML =
        '<div class="seat-row"><span class="avatar">' + UI.esc(p.name.charAt(0)) + UI.icon.flame + '</span>' +
        '<span class="seat-count"><span class="mini-back"></span><b></b></span></div>' +
        '<span class="seat-name">' + UI.esc(p.name) + '</span>' +
        '<div class="slot" id="slot-' + p.id + '"></div>' +
        '<span class="seat-chip"></span>';
      seats.appendChild(seat);
      self.seatEls[p.id] = {
        seat: seat,
        avatar: seat.querySelector('.avatar'),
        mini: seat.querySelector('.mini-back'),
        count: seat.querySelector('.seat-count b'),
        chip: seat.querySelector('.seat-chip'),
        slot: seat.querySelector('.slot')
      };
    });

    this.el = {
      set: this.root.querySelector('#t-set'),
      music: this.root.querySelector('#t-music'),
      sound: this.root.querySelector('#t-sound'),
      deck: this.root.querySelector('#t-deck'),
      deckTop: this.root.querySelector('#t-deck .deck-stack .card:last-child'),
      deckCount: this.root.querySelector('#t-deckcount'),
      lead: this.root.querySelector('#t-lead'),
      leadContent: this.root.querySelector('#t-leadcontent'),
      leadLabel: this.root.querySelector('#t-leadlabel'),
      ring: this.root.querySelector('#t-lead .ring'),
      ringFg: this.root.querySelector('#t-lead .ring .fg'),
      timer: this.root.querySelector('#t-timer'),
      aside: this.root.querySelector('#t-aside'),
      asideTop: this.root.querySelector('#t-aside .aside-stack'),
      asideCount: this.root.querySelector('#t-asidecount'),
      statusMain: this.root.querySelector('#t-status .status-main'),
      statusSub: this.root.querySelector('#t-status .status-sub'),
      me: this.root.querySelector('#t-me'),
      myCount: this.root.querySelector('#t-mycount'),
      mySlot: this.root.querySelector('#slot-' + me),
      play: this.root.querySelector('#t-play'),
      handWrap: this.root.querySelector('#t-handwrap'),
      hand: this.root.querySelector('#t-hand')
    };
    var $p = function (id) { return self.root.querySelector('#' + id); };
    this.pen = {
      root: $p('t-pen'), title: $p('pen-title'), who: $p('pen-who'), deck: $p('pen-deck'), suit: $p('pen-suit'),
      row: $p('pen-row'), tally: $p('pen-tally'), soft: $p('pen-soft'), hard: $p('pen-hard'),
      say: $p('pen-say'), act: $p('pen-act'), timer: $p('pen-timer'), done: $p('pen-done')
    };
    this.pen.act.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.suit) self.penaltyMove('suit', { suit: b.dataset.suit });
      else if (b.id === 'pen-next') self.penaltyMove('next', {});
    });
    // Stop counts the moment it's pressed
    this.pen.act.addEventListener('pointerdown', function (e) {
      var b = e.target.closest('#pen-stop');
      if (!b || b.disabled) return;
      e.preventDefault();
      self.penaltyMove('stop', {});
    });
    this.pen.act.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'pen-stop') { e.preventDefault(); self.penaltyMove('stop', {}); }
    });
    this.renderAudio();

    // input
    this.root.querySelector('#t-menu').addEventListener('click', function () { self.app.openMenu(); });
    this.el.music.addEventListener('click', function () { self.app.toggleMusic(); self.renderAudio(); });
    this.el.sound.addEventListener('click', function () { self.app.toggleSound(); self.renderAudio(); });
    this.el.hand.addEventListener('click', function (e) {
      var btn = e.target.closest('.hcard');
      if (btn) self.tapCard(btn.dataset.id, btn);
    });
    this.el.play.addEventListener('click', function () { if (self.selected) self.play(self.selected); });
    this.el.deck.addEventListener('pointerdown', function (e) { e.preventDefault(); self.tapDeck(); });
    this.el.deck.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.tapDeck(); }
    });
    this.root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-take]');
      if (t) self.take(t.dataset.take);
    });
  };

  BurnsTable.prototype.renderAudio = function () {
    var m = UI.Music.on, s = UI.Sound.on;
    this.el.music.innerHTML = m ? UI.icon.musicOn : UI.icon.musicOff;
    this.el.music.setAttribute('aria-label', m ? 'Music on. Tap to turn it off.' : 'Music off. Tap to turn it on.');
    this.el.music.classList.toggle('off', !m);
    this.el.sound.innerHTML = s ? UI.icon.soundOn : UI.icon.soundOff;
    this.el.sound.setAttribute('aria-label', s ? 'Sound effects on. Tap to mute.' : 'Sound effects off. Tap to turn on.');
    this.el.sound.classList.toggle('off', !s);
  };

  /* ---------- update cycle ---------- */

  BurnsTable.prototype.update = function () {
    var v = this.session.view(this.me, { sinceSeq: this.lastSeq });
    var events = v.events || [];
    var prev = this.v;
    this.v = v;
    var pre = (events.length && prev && !this.quiet) ? this.capture(prev) : null;
    var plan = (!this.quiet && events.length) ? this.plan(events, pre, v) : { flights: [], intoSlots: false };
    this.render(v, plan);
    if (plan.flights.length) this.run(plan);
    if (!this.quiet) this.react(events, v);
    var self = this;
    events.forEach(function (e) { self.logEvent(e, v); });
    if (events.some(function (e) { return e.type === 'out'; })) this.renderStatus(v);   // "… is out and safe!"
    if (events.length) this.lastSeq = events[events.length - 1].seq;
    this.first = false;
    this.quiet = false;
    if (this.app.logOpen) this.app.renderLog();

    if (v.phase === 'over' && !this.overShown) {
      this.overShown = true;
      var wait = v.winReason === 'flush' ? 1700 : 2400;
      if (!events.length) wait = 200;
      this.overTimer = setTimeout(function () { self.app.showResult(self.v); }, wait);
    }
  };

  /* Where cards are on screen right now (before the DOM changes). */
  BurnsTable.prototype.capture = function (prev) {
    var pre = { hand: {}, table: [] };
    for (var id in this.handEls) pre.hand[id] = this.handEls[id].getBoundingClientRect();
    var self = this;
    prev.table.forEach(function (e) {
      if (!e.card) return;
      var el = null;
      if (e.via === 'starter') el = self.el.leadContent.querySelector('.starter-card .flip');
      else {
        var st = self.slotState[e.owner];
        if (st && st.flip) el = st.flip;
      }
      if (el) pre.table.push({ card: e.card, rect: el.getBoundingClientRect(), gone: e.gone });
    });
    return pre;
  };

  /* Work out the card flights for a batch of events; hide their landing spots. */
  BurnsTable.prototype.plan = function (events, pre, v) {
    var me = this.me;
    var flights = [];
    var self = this;
    var intoSlots = false;
    var drawsBy = {};
    function preTable(cardId) {
      if (!pre) return null;
      for (var i = 0; i < pre.table.length; i++) if (pre.table[i].card.id === cardId) return pre.table[i];
      return null;
    }
    function add(f) {
      if (f.hide) self.hide(f.hide);
      if (f.to.indexOf('slot:') === 0) intoSlots = true;
      flights.push(f);
    }

    events.forEach(function (e) {
      if (e.type === 'deal') {
        var k = 0;
        for (var r = 0; r < e.handSize; r++) {
          e.order.forEach(function (pid) {
            var delay = 120 + k * 70;
            k++;
            if (pid === me && e.mine) {
              var c = e.mine.hand[r];
              add({ from: 'deck', to: 'h:' + c.id, card: c, delay: delay, duration: 340, hide: 'h:' + c.id, sound: 'deal' });
            } else {
              add({ from: 'deck', to: 'seat:' + pid, card: null, delay: delay, duration: 320, sound: 'deal' });
            }
          });
        }
        self.dealDoneAt = performance.now() + 120 + k * 70 + 340;
      } else if (e.type === 'setStart' && pre) {
        pre.table.forEach(function (t, i) {
          if (!t.gone) add({ fromRect: t.rect, to: 'aside', card: t.card, delay: i * 45, duration: 420 });
        });
      } else if (e.type === 'lead' || e.type === 'commit') {
        if (e.player === me && e.mine) {
          // a card drawn in this same batch (time ran out) starts from the deck
          var r1 = pre && pre.hand[e.mine.card.id];
          if (r1) add({ fromRect: r1, to: 'slot:' + me, card: e.mine.card, duration: 300, hide: 'slot:' + me });
          else add({ from: 'deck', to: 'slot:' + me, card: e.mine.card, duration: 360, delay: (drawsBy[me] || 0) * 90, hide: 'slot:' + me });
        } else {
          add({ from: 'seat:' + e.player, to: 'slot:' + e.player, card: e.card || null, duration: 340, delay: (drawsBy[e.player] || 0) * 90, hide: 'slot:' + e.player });
        }
      } else if (e.type === 'draw') {
        var n = drawsBy[e.player] = (drawsBy[e.player] || 0) + 1;
        var delay = (n - 1) * 90;
        if (e.player === me && e.mine) {
          add({ from: 'deck', to: 'h:' + e.mine.card.id, card: e.mine.card, duration: 330, delay: delay, hide: 'h:' + e.mine.card.id });
        } else {
          add({ from: 'deck', to: 'seat:' + e.player, card: null, duration: 300, delay: delay });
        }
      } else if (e.type === 'take') {
        var src = preTable(e.card.id);
        var fromRect = src ? src.rect : null;
        if (e.player === me) add({ fromRect: fromRect, to: 'h:' + e.card.id, card: e.card, duration: 380, hide: 'h:' + e.card.id });
        else add({ fromRect: fromRect, to: 'seat:' + e.player, card: e.card, duration: 380 });
      }
    });
    return { flights: flights, intoSlots: intoSlots };
  };

  BurnsTable.prototype.target = function (key) {
    if (key === 'deck') return this.el.deckTop;
    if (key === 'aside') return this.el.asideTop;
    if (key.indexOf('h:') === 0) return this.handEls[key.slice(2)] || null;
    if (key.indexOf('slot:') === 0) {
      var st = this.slotState[key.slice(5)];
      return st && st.flip ? st.flip : null;
    }
    if (key.indexOf('seat:') === 0) {
      var s = this.seatEls[key.slice(5)];
      return s ? s.mini : this.el.mySlot;
    }
    return null;
  };

  BurnsTable.prototype.run = function (plan) {
    var self = this;
    plan.flights.forEach(function (f) {
      var from = f.fromRect ? null : (f.from.indexOf('seat:') === 0 ? (self.seatEls[f.from.slice(5)] || {}).avatar : self.target(f.from));
      var to = self.target(f.to);
      if (f.sound) setTimeout(function () { UI.Sound.play(f.sound); }, f.delay || 0);
      UI.fly({ from: from, fromRect: f.fromRect, to: to, card: f.card, delay: f.delay, duration: f.duration })
        .then(function () { if (f.hide) self.unhide(f.hide); });
    });
  };

  BurnsTable.prototype.hide = function (key) { this.hidden[key] = (this.hidden[key] || 0) + 1; };
  BurnsTable.prototype.unhide = function (key) {
    this.hidden[key] = Math.max(0, (this.hidden[key] || 0) - 1);
    if (this.hidden[key]) return;
    delete this.hidden[key];
    var el = this.target(key);
    if (el) el.style.visibility = '';
  };

  /* ---------- rendering ---------- */

  BurnsTable.prototype.render = function (v, plan) {
    this.renderTop(v);
    this.renderSeats(v, plan);
    this.renderRail(v);
    this.renderStatus(v);
    this.renderMe(v, plan);
    this.renderHand(v);
    this.renderPenalty(v);
  };

  BurnsTable.prototype.renderTop = function (v) {
    this.el.set.textContent = v.phase === 'dealing' ? 'Dealing'
      : v.phase === 'penalty' || (v.phase === 'over' && v.winReason === 'real') ? 'Penalty round' : 'Set ' + v.setNo;
  };

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], m = n % 100;
    return n + (s[(m - 20) % 10] || s[m] || s[0]);
  }

  BurnsTable.prototype.entryFor = function (v, pid) {
    for (var i = 0; i < v.table.length; i++) if (v.table[i].owner === pid) return v.table[i];
    return null;
  };

  BurnsTable.prototype.renderSeats = function (v, plan) {
    var self = this;
    var revealOrder = 0;
    v.players.forEach(function (p) {
      if (p.id === self.me) return;
      var s = self.seatEls[p.id];
      if (!s) return;
      s.count.textContent = p.handCount;
      s.seat.setAttribute('aria-label', p.name + ', ' + (p.out ? 'out and safe' : p.handCount + ' cards') + (v.loser === p.id ? ', lost' : ''));
      s.seat.classList.toggle('is-leader', p.isLeader);
      s.seat.classList.toggle('is-active', self.isActive(v, p));
      s.seat.classList.toggle('is-out', !!p.out);
      s.seat.classList.toggle('is-loser', v.loser === p.id);
      var chip = self.chipFor(v, p);
      s.chip.textContent = chip.text;
      s.chip.className = 'seat-chip' + (chip.tone ? ' ' + chip.tone : '');
      if (self.renderSlot(s.slot, p.id, v, plan, revealOrder)) revealOrder++;
    });
    this.revealCount = revealOrder;
  };

  BurnsTable.prototype.isActive = function (v, p) {
    if (p.out) return false;
    if (v.phase === 'lead') return p.isLeader;
    if (v.phase === 'follow') return !p.isLeader && !p.committed && !p.isTaker;
    if (v.phase === 'take') return p.isTaker && !p.took;
    if (v.phase === 'penalty' && v.penalty) {
      var P = v.penalty;
      return P.step === 'shuffle' || P.step === 'suit' ? p.id === v.loser : P.step === 'result' && p.id === P.shuffler;
    }
    return false;
  };

  BurnsTable.prototype.chipFor = function (v, p) {
    var won = v.setResult && v.setResult.player === p.id && (v.phase === 'reveal' || v.phase === 'over');
    // Real Burns: who's safe, who lost, and whose turn it is in the penalty round
    if (v.loser === p.id && (v.phase === 'lost' || v.phase === 'penalty' || v.phase === 'over')) return { text: 'lost', tone: 'warn' };
    if (v.phase === 'penalty' && v.penalty && v.penalty.shuffler === p.id) {
      var step = v.penalty.step;
      return { text: step === 'shuffle' ? 'shuffling' : step === 'result' ? 'slapping' : 'turning over', tone: 'hot' };
    }
    if (p.out) return { text: 'safe · ' + ordinal(p.place), tone: 'ok' };
    switch (v.phase) {
      case 'lead': return p.isLeader ? { text: 'choosing…', tone: 'hot' } : { text: '' };
      case 'follow':
        if (p.isLeader) return { text: 'led' };
        if (p.isTaker) return { text: 'can’t follow', tone: 'warn' };
        if (p.committed) return { text: p.drew ? 'drew ' + p.drew + ' · in' : 'card in' };
        if (p.drew) return { text: 'drawing · ' + p.drew, tone: 'hot' };
        return { text: 'thinking…' };
      case 'take':
        if (p.isTaker) return p.took ? { text: 'took one' } : { text: 'taking…', tone: 'hot' };
        return { text: p.drew ? 'drew ' + p.drew : '' };
      case 'reveal':
      case 'over':
        if (won) return { text: 'wins the set', tone: 'hot' };
        if (p.took) return { text: 'picked one up' };
        return { text: p.drew ? 'drew ' + p.drew : '' };
    }
    return { text: '' };
  };

  /* Returns true when this slot flips face up in this render (for staggering). */
  BurnsTable.prototype.renderSlot = function (slotEl, pid, v, plan, order) {
    var st = this.slotState[pid] || (this.slotState[pid] = { flip: null, key: null, up: false });
    var entry = this.entryFor(v, pid);
    var flipped = false;
    var tag = null;

    if (!entry) {
      if (st.flip) { st.flip.parentNode && st.flip.parentNode.removeChild(st.flip); st.flip = null; st.key = null; st.up = false; }
      slotEl.classList.remove('winner', 'takeable', 'gone');
      slotEl.removeAttribute('data-take');
    } else {
      var key = v.setNo + '|' + entry.owner + '|' + entry.via;
      if (st.key !== key) {
        if (st.flip && st.flip.parentNode) st.flip.parentNode.removeChild(st.flip);
        var f = makeFlip();
        st.flip = f.flip; st.inner = f.inner; st.front = f.front; st.key = key; st.up = false;
        slotEl.appendChild(st.flip);
      }
      var card = entry.card;
      if (card) UI.setCard(st.front, card);
      var wantUp = !!card;
      if (wantUp !== st.up) {
        var isReveal = wantUp && v.revealed && entry.owner !== this.me && !(entry.via === 'lead' && v.options.leadCard === 'faceUp');
        if (isReveal && !this.quiet) {
          st.flip.classList.remove('no-anim');
          void st.flip.offsetWidth;
          st.inner.style.transitionDelay = ((plan.intoSlots ? 380 : 40) + order * 90) + 'ms';
          flipped = true;
        } else {
          st.flip.classList.add('no-anim');
          st.inner.style.transitionDelay = '0ms';
        }
        st.flip.dataset.up = wantUp ? '1' : '0';
        st.up = wantUp;
        if (!isReveal || this.quiet) { void st.flip.offsetWidth; st.flip.classList.remove('no-anim'); }
      }
      st.flip.style.visibility = this.hidden['slot:' + pid] ? 'hidden' : '';

      var won = v.setResult && v.setResult.player === pid && (v.phase === 'reveal' || v.phase === 'over' || v.phase === 'lost');
      slotEl.classList.toggle('winner', !!won);
      slotEl.classList.toggle('gone', !!entry.gone);
      var takeable = v.canTake && card && !entry.takenBy;
      slotEl.classList.toggle('takeable', !!takeable);
      if (takeable) slotEl.dataset.take = card.id; else slotEl.removeAttribute('data-take');
      if (won && pid === this.me) tag = { text: 'wins', tone: 'ember' };
      else if (entry.gone && entry.takenBy) tag = { text: '→ ' + this.name(entry.takenBy), tone: '' };
      else if (takeable) tag = { text: 'take', tone: '' };
    }

    // hidden-from-others marker on your own card before the reveal
    var eye = slotEl.querySelector('.eye');
    var showEye = pid === this.me && entry && entry.card && !v.revealed && v.phase !== 'over' &&
      !(entry.via === 'lead' && v.options.leadCard === 'faceUp');   // a face-up lead is public
    if (showEye && !eye) {
      eye = document.createElement('span');
      eye.className = 'eye';
      eye.title = 'Only you can see this card until the reveal';
      eye.innerHTML = UI.icon.eyeOff;
      slotEl.appendChild(eye);
    } else if (!showEye && eye) eye.parentNode.removeChild(eye);

    var tagEl = slotEl.querySelector('.slot-tag');
    if (tag) {
      if (!tagEl) { tagEl = document.createElement('span'); slotEl.appendChild(tagEl); }
      tagEl.className = 'slot-tag' + (tag.tone ? ' ' + tag.tone : '');
      tagEl.innerHTML = tag.text;
    } else if (tagEl) tagEl.parentNode.removeChild(tagEl);
    return flipped;
  };

  BurnsTable.prototype.renderRail = function (v) {
    var deck = this.el.deck;
    deck.classList.toggle('can-draw', !!v.mustDraw);
    deck.classList.toggle('may-draw', !!v.mayDraw);
    deck.classList.toggle('empty', v.deckCount === 0);
    this.el.deckCount.textContent = v.deckCount === 0 ? 'empty' : v.deckCount + ' left';
    deck.setAttribute('aria-label', v.canDraw ? 'Deck, ' + v.deckCount + ' cards. Tap to draw.' : 'Deck, ' + v.deckCount + ' cards');

    this.el.aside.classList.toggle('empty', v.discard.length === 0);
    this.el.asideCount.textContent = v.discard.length + ' aside';

    // middle of the rail: starter card, suit to follow, or who leads
    var starterEntry = null;
    v.table.forEach(function (e) { if (e.via === 'starter') starterEntry = e; });
    var content = this.el.leadContent;
    var label = { text: '', tone: '' };
    var acting = v.canFollow || v.canDraw;
    var key, html = null;

    if ((v.phase === 'dealing' || (v.phase === 'over' && v.winReason === 'flush')) && v.starter) {
      key = 'starter-deal:' + v.starter.id;
      label.text = 'Starter';
    } else if (starterEntry) {
      key = 'starter:' + starterEntry.card.id;
      label.text = 'Follow ' + UI.suitPlural(v.suit);
      label.tone = acting ? 'hot' : '';
    } else if (v.phase === 'lead') {
      key = 'lead';
      html = '<div class="roundel empty"><span class="q">?</span></div>';
      label.text = v.canLead ? 'Your lead' : this.name(v.leader) + ' leads';
      label.tone = v.canLead ? 'hot' : '';
    } else if (v.suit) {
      key = 'suit:' + v.suit;
      html = '<div class="roundel ' + (UI.isRed(v.suit) ? 'red' : '') + '" aria-label="Suit in play: ' + UI.suitPlural(v.suit) + '">' + UI.suitSvg(v.suit) + '</div>';
      label.text = 'Follow ' + UI.suitPlural(v.suit);
      label.tone = acting ? 'hot' : '';
    } else {
      key = 'blank';
      html = '<div class="roundel empty"></div>';
    }
    if (v.phase === 'take') { label.text = 'Deck empty'; label.tone = 'ember'; }
    if (v.phase === 'reveal' && v.setResult) { label.text = v.setResult.player === this.me ? 'You win it' : this.name(v.setResult.player) + ' wins'; label.tone = 'ember'; }
    if (v.phase === 'lost') { label.text = v.loser === this.me ? 'You lose' : this.name(v.loser) + ' loses'; label.tone = 'ember'; }

    if (content.dataset.key !== key) {
      content.dataset.key = key;
      if (html != null) content.innerHTML = html;
      else {
        var card = key.indexOf('starter-deal:') === 0 ? v.starter : starterEntry.card;
        content.innerHTML = '';
        var wrap = document.createElement('div');
        wrap.className = 'starter-card';
        var f = makeFlip();
        f.flip.classList.add('no-anim');
        UI.setCard(f.front, card);
        wrap.appendChild(f.flip);
        content.appendChild(wrap);
        if (v.phase === 'dealing' && !this.quiet) {
          // turn the starter face up once the deal has landed
          var wait = Math.max(0, (this.dealDoneAt || performance.now()) - performance.now());
          wrap.classList.add('deal-in');
          wrap.style.animationDelay = Math.max(0, wait - 350) + 'ms';
          setTimeout(function () { f.flip.classList.remove('no-anim'); f.flip.dataset.up = '1'; UI.Sound.play('flip'); }, wait + 60);
        } else {
          f.flip.dataset.up = '1';
          void f.flip.offsetWidth;
          f.flip.classList.remove('no-anim');
        }
      }
    }
    var starterWrap = content.querySelector('.starter-card');
    if (starterWrap && starterEntry) {
      var takeable = v.canTake && !starterEntry.takenBy;
      starterWrap.classList.toggle('takeable', !!takeable);
      starterWrap.classList.toggle('gone', !!starterEntry.gone);
      if (takeable) starterWrap.dataset.take = starterEntry.card.id; else starterWrap.removeAttribute('data-take');
      if (starterEntry.gone && starterEntry.takenBy) { label.text = '→ ' + this.name(starterEntry.takenBy); label.tone = ''; }
    }
    this.el.leadLabel.innerHTML = label.text;
    this.el.leadLabel.className = 'lead-label' + (label.tone ? ' ' + label.tone : '');
    this.el.leadLabel.hidden = !label.text;
    this.frame();
  };

  /* The clock that matters right now: the take window, or the set's time limit. */
  BurnsTable.prototype.clock = function (v) {
    if (v.phase === 'take' && v.takeEndsAt) return { endsAt: v.takeEndsAt, total: v.timing.takeWindowMs, take: true };
    if ((v.phase === 'lead' || v.phase === 'follow') && v.turnEndsAt) return { endsAt: v.turnEndsAt, total: v.timing.turnMs, take: false };
    return null;
  };

  BurnsTable.prototype.myTurn = function (v) {
    return v.canLead || v.canFollow || v.canDraw || v.canTake;
  };

  BurnsTable.prototype.statusFor = function (v) {
    var me = this.me, self = this;
    var mine = this.mine(v);
    var s = v.suit;
    var P = s ? UI.suit(s) + ' ' + UI.suitPlural(s) : '';
    var one = s ? UI.suitSingle(s) : '';
    var secs = ' <span class="secs"></span>';
    var waitingOn = v.players.filter(function (p) { return p.id !== v.leader && !p.committed && !p.isTaker && p.id !== me && !p.out; })
      .map(function (p) { return self.name(p.id); });
    var leadWhy = v.leadFrom ? this.name(v.leadFrom) + ' went out, so ' + this.name(v.leader, false) + ' leads.' : this.name(v.leader) + ' won the last set.';

    // Real Burns: you're out and safe, watching the rest play on
    if (v.real && mine && mine.out && (v.phase === 'lead' || v.phase === 'follow' || v.phase === 'take')) {
      var safe = '<span class="hl">You’re safe</span> · ' + ordinal(mine.place) + ' out.';
      if (v.phase === 'lead') return { main: safe, sub: this.name(v.leader) + ' is choosing a suit. The rest play on until one is left holding cards.' };
      if (v.phase === 'follow') return { main: safe, sub: waitingOn.length ? 'Waiting for ' + list(waitingOn) + '.' : 'The rest play on until one is left holding cards.' };
      return { main: safe, sub: 'The deck is empty, so some pick up from the set.' };
    }

    switch (v.phase) {
      case 'dealing':
        return { main: 'Dealing…', sub: v.flushRule ? (v.real ? 'Four cards each. A Flush (one of every suit) is safe on the spot.' : 'Four cards each. A Flush (one of every suit) wins on the spot.') : 'Four cards each. The face-up starter card sets the first suit.' };
      case 'lead':
        if (v.canLead) return { main: '<span class="hl">Your lead.</span> Play any card.' + secs, sub: v.leadFrom ? this.name(v.leadFrom) + ' went out, so you lead. Its suit is the one everyone must follow.' : 'Its suit is the one everyone must follow.' };
        return { main: this.name(v.leader) + ' is choosing a suit…', sub: leadWhy };
      case 'follow': {
        var led = v.table.filter(function (e) { return e.via === 'lead'; })[0];
        var intro = v.setNo === 1 ? 'The starter card sets the suit.'
          : this.name(v.leader) + ' led ' + (led && led.card ? UI.cardText(led.card) : UI.suit(s)) + '.';
        if (v.mayDraw && !mine.drew) {
          return {
            main: 'Follow ' + P + ' — <span class="hl">pick a ' + one + '</span>, or draw for a better one.' + secs,
            sub: intro + ' Every card you draw stays in your hand.'
          };
        }
        if (v.mayDraw) {
          return {
            main: '<span class="hl">Play a ' + UI.suit(s) + ' ' + one + ', or keep drawing.</span>' + secs,
            sub: 'Drawn ' + mine.drew + ' so far. A higher ' + one + ' could win the set, but every card you draw stays in your hand.'
          };
        }
        if (v.canFollow) {
          if (mine.drew) return { main: '<span class="hl">Play a ' + one + '.</span> The deck is empty.' + secs, sub: 'Cards stay hidden until everyone has played.' };
          return { main: 'Follow ' + P + ' — <span class="hl">pick a ' + one + '</span>' + secs, sub: intro + ' The deck is empty, so no more drawing.' };
        }
        if (v.mustDraw) {
          return {
            main: 'No ' + P + '. <span class="hl">Tap the deck to draw.</span>' + secs,
            sub: mine.drew ? 'Drawn ' + mine.drew + ' so far. Keep going until a ' + one + ' turns up.' : 'When a ' + one + ' turns up, play it or keep drawing for a better one.'
          };
        }
        if (mine && mine.isTaker) return { main: '<span class="em">No ' + P + ' and the deck is empty.</span>', sub: 'Once everyone else is in, you take a card from the set.' };
        return { main: v.leader === me ? 'You led ' + (led && led.card ? UI.cardText(led.card) : P) + '.' : 'Your card is in.', sub: waitingOn.length ? 'Waiting for ' + list(waitingOn) + '.' : '' };
      }
      case 'take': {
        var takers = v.players.filter(function (p) { return p.isTaker; });
        var pending = takers.filter(function (p) { return !p.took && p.id !== me; }).map(function (p) { return self.name(p.id); });
        if (v.canTake) return { main: '<span class="hl">Take a card from the set</span>' + secs, sub: 'It goes into your hand. Each card can only be taken once.' };
        if (mine && mine.isTaker) return { main: 'Got it.', sub: pending.length ? 'Waiting for ' + list(pending) + '.' : '' };
        var names = takers.map(function (p) { return self.name(p.id); });
        return { main: list(names) + (names.length > 1 ? ' are' : ' is') + ' taking from the set' + secs, sub: 'The deck is empty, so they pick up from the cards just played.' };
      }
      case 'reveal': {
        var r = v.setResult;
        var next = v.nextLeader || (r && r.player);
        var leadsNext = next === me ? 'You lead next.' : this.name(next) + ' leads next.';
        // Real Burns: anyone who just went out is safe
        var gone = this.justOut && this.justOut.set === v.setNo ? this.justOut.players : [];
        var safeNow = !gone.length ? '' : gone.indexOf(me) >= 0
          ? (gone.length > 1 ? 'You and ' + list(gone.filter(function (id) { return id !== me; }).map(function (id) { return self.name(id); })) + ' are' : 'You’re') + ' out and safe! '
          : list(gone.map(function (id) { return self.name(id); })) + (gone.length > 1 ? ' are' : ' is') + ' out and safe! ';
        if (!r || !r.card) return { main: this.name(next) + ' keeps the lead.', sub: safeNow };
        if (r.player === me) return { main: '<span class="hl">You win the set</span> with ' + UI.cardText(r.card) + '.', sub: safeNow + leadsNext };
        return { main: this.name(r.player) + ' wins the set with ' + UI.cardText(r.card) + '.', sub: safeNow + leadsNext };
      }
      case 'lost': {
        var iLost = v.loser === me;
        var winners = v.players.filter(function (p) { return p.id !== v.loser; }).length;
        return {
          main: iLost ? '<span class="em">You’re left holding cards. You lose!</span>' : '<span class="hl">' + this.name(v.loser) + ' is left holding cards and loses!</span>',
          sub: 'Next, the penalty round: ' + (winners === 1 ? 'one turn of slaps.' : 'every winner takes a turn.')
        };
      }
      case 'over': {
        var w = (v.winners || []).map(function (id) { return self.name(id); });
        var iWon = (v.winners || []).indexOf(me) >= 0;
        if (v.winReason === 'real') return { main: v.loser === me ? '<span class="em">You lost.</span>' : this.name(v.loser) + ' lost.', sub: 'Everyone else wins.' };
        if (v.winReason === 'flush') return { main: (iWon ? '<span class="hl">Flush! You win.</span>' : 'Flush! ' + list(w) + (w.length > 1 ? ' win.' : ' wins.')), sub: 'All four suits on the deal.' };
        return { main: iWon ? '<span class="hl">You emptied your hand. You win!</span>' : list(w) + ' emptied their hand and wins.', sub: '' };
      }
    }
    return { main: '', sub: '' };
  };

  /* ---------- Real Burns: the penalty round ---------- */

  function slapsText(soft, hard) {
    var parts = [];
    if (soft) parts.push(soft + ' soft slap' + (soft === 1 ? '' : 's'));
    if (hard) parts.push(hard + ' hard slap' + (hard === 1 ? '' : 's'));
    return parts.length ? parts.join(' and ') : 'no slaps';
  }

  BurnsTable.prototype.renderPenalty = function (v) {
    var on = !!v.penalty && (v.phase === 'penalty' || (v.phase === 'over' && v.winReason === 'real'));
    this.root.classList.toggle('pen-on', on);
    if (!on) return;
    var P = v.penalty, me = this.me, el = this.pen, self = this;
    var iLost = v.loser === me, mineTurn = P.shuffler === me;
    var loser = this.name(v.loser), shuffler = P.shuffler ? this.name(P.shuffler) : '';
    var step = P.step, n = P.order.length;

    el.title.innerHTML = iLost ? 'You lost' : loser + ' lost';
    el.who.innerHTML = step === 'done' ? 'Every winner has had a turn.'
      : 'Turn ' + (P.turn + 1) + ' of ' + n + ' · ' + (mineTurn ? '<span class="hl">your turn</span>' : shuffler + '’s turn');

    // the deck: shuffling until Stop, then waiting for the suit
    el.deck.hidden = step === 'done';
    el.deck.classList.toggle('shuffling', step === 'shuffle');
    el.deck.classList.toggle('small', step === 'draw' || step === 'result');
    el.suit.hidden = !P.suit || step === 'done';
    if (P.suit) el.suit.innerHTML = 'Looking for ' + UI.suitSvg(P.suit) + ' ' + UI.suitPlural(P.suit);
    el.suit.className = 'pen-suit' + (P.suit && UI.isRed(P.suit) ? ' red' : '');

    // the cards turned over this turn
    var rowKey = P.turn + ':' + (P.suit || '');
    if (this.penRowKey !== rowKey) { this.penRowKey = rowKey; el.row.innerHTML = ''; }
    var have = el.row.children.length;
    P.drawn.forEach(function (c, i) {
      if (i < have) return;
      var card = UI.makeCard(c);
      if (c.suit === P.suit) card.classList.add('match');
      if (self.quiet) card.style.animation = 'none';
      el.row.appendChild(card);
    });
    el.row.classList.toggle('many', P.drawn.length > 6);
    el.row.hidden = !P.drawn.length || step === 'done';

    // the count so far
    el.tally.hidden = !(step === 'draw' || step === 'result');
    this.bumpCount(el.soft, P.soft);
    this.bumpCount(el.hard, P.hard);

    // what's happening, and what (if anything) you can do
    var say = '', actKey = step + ':' + P.turn, act = '';
    if (step === 'shuffle') {
      say = iLost ? '<b>Say stop</b> whenever you like.' : (mineTurn ? 'You’re shuffling. ' : shuffler + ' is shuffling. ') + loser + ' says when to stop.';
      if (v.canStop) { act = '<button class="btn pen-stop" id="pen-stop" type="button">Stop!</button>'; actKey += ':stop'; }
    } else if (step === 'suit') {
      say = iLost ? 'Name a suit. Every card turned over before it is a slap: <b>black soft, red hard</b>.' : loser + ' is naming a suit…';
      if (v.canSuit) {
        act = '<div class="pen-suits arming">' + ['H', 'S', 'D', 'C'].map(function (s) {
          return '<button class="btn pen-suitbtn' + (UI.isRed(s) ? ' red' : '') + '" type="button" data-suit="' + s + '" disabled>' + UI.suitSvg(s) + '<span>' + UI.suitPlural(s).charAt(0).toUpperCase() + UI.suitPlural(s).slice(1) + '</span></button>';
        }).join('') + '</div>';
        actKey += ':suit';
      }
    } else if (step === 'draw') {
      say = (mineTurn ? 'You turn' : shuffler + ' turns') + ' cards over until a ' + UI.suit(P.suit) + ' ' + UI.suitSingle(P.suit) + ' appears…';
    } else if (step === 'result') {
      var giver = mineTurn ? 'you' : shuffler;
      if (P.lucky) say = '<b>Lucky!</b> The first card was a ' + UI.suit(P.suit) + ' ' + UI.suitSingle(P.suit) + ', so ' + (iLost ? 'no slaps from ' + giver : loser + ' gets no slaps from ' + giver) + '.';
      else say = '<b>' + (mineTurn ? 'You give ' + loser : shuffler + ' gives ' + (iLost ? 'you' : loser)) + ' ' + slapsText(P.soft, P.hard) + '.</b>';
      if (v.canNext) { act = '<button class="btn btn-primary pen-next" id="pen-next" type="button">' + (P.turn + 1 < n ? 'Next turn' : 'Finish') + '</button>'; actKey += ':next'; }
      else if (!this.isBotSeat(v, P.shuffler)) act = '<p class="pen-wait">' + (iLost ? 'Hold out your hand…' : 'Waiting for ' + shuffler + '…') + '</p>';
      actKey += ':' + act.length;
    } else if (step === 'done') {
      var t = { soft: 0, hard: 0 };
      P.results.forEach(function (r) { t.soft += r.soft; t.hard += r.hard; });
      say = (iLost ? 'In all, you take ' : 'In all, ' + loser + ' takes ') + slapsText(t.soft, t.hard) + '.';
    }
    if (el.say.innerHTML !== say) el.say.innerHTML = say;
    if (this.penActKey !== actKey) {
      this.penActKey = actKey;
      el.act.innerHTML = act;
      // the suits appear where Stop was: the press that stopped the shuffle mustn't pick one too
      this.suitsFrom = /:suit$/.test(actKey) ? performance.now() + SUIT_ARM_MS : 0;
      this.penaltyFrame();
    }

    // earlier turns
    var done = P.results.slice(0, step === 'result' ? -1 : P.results.length);
    var doneKey = done.length + ':' + step;
    if (this.penDoneKey !== doneKey) {
      this.penDoneKey = doneKey;
      el.done.innerHTML = done.map(function (r) {
        return '<li><span>' + self.name(r.by) + '</span><span class="pen-res">' + (r.lucky ? 'lucky: no slaps' : slapsText(r.soft, r.hard).replace(/ slaps?/g, '')) + '</span></li>';
      }).join('');
      el.done.hidden = !done.length;
    }
  };

  BurnsTable.prototype.isBotSeat = function (v, pid) {
    var p = v.players.filter(function (x) { return x.id === pid; })[0];
    return !!(p && p.isBot);
  };

  /* A slap count that just went up gives a little jump. */
  BurnsTable.prototype.bumpCount = function (el, n) {
    var was = Number(el.textContent);
    if (was === n) return;
    el.textContent = String(n);
    if (n > was && !this.quiet) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  };

  /* ~20×/s: Stop comes alive once the shuffle has had a moment, and the
     loser sees how long they have before the game decides for them. */
  BurnsTable.prototype.penaltyFrame = function () {
    var v = this.v;
    if (!v || !v.penalty || v.phase !== 'penalty') return;
    var P = v.penalty, now = this.session.now();
    var stop = this.pen.act.querySelector('#pen-stop');
    if (stop) {
      var ready = P.stopFrom == null || now >= P.stopFrom;
      if (stop.disabled === ready) stop.disabled = !ready;
    }
    var suits = this.pen.act.querySelector('.pen-suits');
    if (suits) {
      var armed = performance.now() >= (this.suitsFrom || 0);
      if (suits.classList.contains('arming') === armed) {
        suits.classList.toggle('arming', !armed);
        suits.querySelectorAll('button').forEach(function (b) { b.disabled = !armed; });
      }
    }
    var text = '';
    var left = P.endsAt != null ? Math.max(0, P.endsAt - now) : null;
    if (left != null && left <= 5000 && v.loser === this.me && (P.step === 'shuffle' || P.step === 'suit')) {
      var s = Math.ceil(left / 1000);
      text = P.step === 'shuffle' ? 'The shuffle stops by itself in ' + s + 's' : 'A suit is picked for you in ' + s + 's';
    }
    if (this.pen.timer.textContent !== text) this.pen.timer.textContent = text;
    // the sound of shuffling
    if (P.step === 'shuffle') {
      var t = performance.now();
      if (!this.riffleAt || t - this.riffleAt > 1100) { this.riffleAt = t; UI.Sound.play('riffle'); }
    }
  };

  BurnsTable.prototype.penaltyMove = function (type, payload) {
    var v = this.v;
    if (!v || !v.penalty) return;
    UI.Sound.unlock();
    if (type === 'stop') { UI.Sound.play('tick'); UI.buzz(20); }
    this.send(type, payload, function (res) {
      if (!res.ok && res.code !== 'wait') { UI.toast(UI.esc(res.message)); UI.Sound.play('nope'); }
    });
  };

  BurnsTable.prototype.renderStatus = function (v) {
    var st = this.statusFor(v);
    this.el.statusMain.innerHTML = st.main;
    this.el.statusSub.innerHTML = st.sub || '';
  };

  BurnsTable.prototype.renderMe = function (v, plan) {
    var mine = this.mine(v);
    this.el.me.classList.toggle('is-leader', !!(mine && mine.isLeader));
    this.el.myCount.textContent = mine && mine.out ? 'safe · ' + ordinal(mine.place) : v.hand.length === 1 ? '1 card' : v.hand.length + ' cards';
    this.renderSlot(this.el.mySlot, this.me, v, plan, this.revealCount || 0);
    var sel = this.selected && v.playable.indexOf(this.selected) >= 0 ? this.selected : null;
    var card = sel && v.hand.filter(function (c) { return c.id === sel; })[0];
    if (card) {
      this.el.play.hidden = false;
      this.el.play.innerHTML = (v.canLead ? 'Lead ' : 'Play ') + card.rank + UI.suitSvg(card.suit);
      this.el.play.setAttribute('aria-label', (v.canLead ? 'Lead the ' : 'Play the ') + CT.cardName(card));
    } else {
      this.el.play.hidden = true;
    }
  };

  BurnsTable.prototype.renderHand = function (v) {
    var cards = sortHand(v.hand);
    var playable = {};
    v.playable.forEach(function (id) { playable[id] = true; });
    var needAct = v.canLead || v.canFollow;
    if (this.selected && !playable[this.selected]) this.selected = null;
    var keep = {};
    var self = this;
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
      el.classList.toggle('playable', needAct && !!playable[c.id]);
      el.classList.toggle('dim', (needAct && !playable[c.id]) || !!v.mustDraw || !!v.canTake);
      el.classList.toggle('selected', self.selected === c.id);
      el.style.visibility = self.hidden['h:' + c.id] ? 'hidden' : '';
      el.style.zIndex = String(i + 1);
    });
    for (var id in this.handEls) {
      if (!keep[id]) { this.handEls[id].parentNode.removeChild(this.handEls[id]); delete this.handEls[id]; }
    }
    this.layoutHand(cards);

    // bring the first playable card into view when it becomes playable on a long hand
    var firstPlayable = cards.filter(function (c) { return playable[c.id]; })[0];
    var turnKey = needAct && firstPlayable ? v.setNo + v.phase + firstPlayable.id : null;
    if (turnKey && turnKey !== this.turnKey) {
      var wrap = this.el.handWrap;
      if (wrap.scrollWidth > wrap.clientWidth) {
        var left = parseFloat(this.handEls[firstPlayable.id].style.left) || 0;
        wrap.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
      }
    }
    this.turnKey = turnKey;
  };

  BurnsTable.prototype.layoutHand = function (cards) {
    var wrap = this.el.handWrap;
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hcw')) || 58;
    var n = cards.length;
    var step = n > 1 ? Math.min(cw + 6, (W - cw) / (n - 1)) : 0;
    var minStep = Math.max(18, cw * 0.4);
    if (n > 1 && step < minStep) step = minStep;
    var total = n ? (n - 1) * step + cw : 0;
    var offset = total < W ? (W - total) / 2 : 0;
    this.el.hand.style.width = Math.max(total, W) + 'px';
    var self = this;
    cards.forEach(function (c, i) {
      var el = self.handEls[c.id];
      if (el) el.style.left = (offset + i * step) + 'px';
    });
  };

  /* Called ~20×/s by the app loop for the countdown ring and seconds. */
  BurnsTable.prototype.frame = function () {
    var v = this.v;
    if (!v) return;
    this.penaltyFrame();
    var c = this.clock(v);
    var lead = this.el.lead;
    // the ring is an <svg>, which has no .hidden property: toggle the attribute
    if (c) this.el.ring.removeAttribute('hidden'); else this.el.ring.setAttribute('hidden', '');
    if (!c) {
      this.el.timer.hidden = true;
      lead.classList.remove('urgent', 'turn', 'late');
      return;
    }
    var left = Math.max(0, c.endsAt - this.session.now());
    var frac = c.total ? left / c.total : 0;
    this.el.ringFg.setAttribute('stroke-dashoffset', String(RING * (1 - frac)));
    var secs = Math.ceil(left / 1000);
    var showSecs = c.take || left <= SHOW_SECS_AT;
    var urgent = left <= (c.take ? 3000 : 5000);
    lead.classList.toggle('turn', !c.take);
    lead.classList.toggle('late', !c.take && left <= SHOW_SECS_AT);
    lead.classList.toggle('urgent', urgent);
    this.el.timer.hidden = !showSecs;
    this.el.timer.textContent = secs + 's';
    var span = this.el.statusMain.querySelector('.secs');
    if (span) span.textContent = showSecs ? '· ' + secs + 's' : '';
    if (secs !== this.lastSecs) {
      this.lastSecs = secs;
      if (urgent && secs > 0 && this.myTurn(v)) UI.Sound.play('tick');
    }
  };

  /* ---------- input ---------- */

  BurnsTable.prototype.tapCard = function (id, el) {
    var v = this.v;
    if (!v) return;
    UI.Sound.unlock();
    if (v.canLead || v.canFollow) {
      if (v.playable.indexOf(id) < 0) {
        this.shake(el);
        UI.toast('Follow ' + UI.suit(v.suit) + ' — play a ' + UI.suitSingle(v.suit) + '.');
        UI.Sound.play('nope');
        return;
      }
      if (this.selected === id) { this.play(id); return; }
      this.selected = id;
      UI.buzz(8);
      this.renderHand(v);
      this.renderMe(v, { intoSlots: false });
      return;
    }
    if (v.mustDraw) {
      this.shake(el);
      UI.toast('No ' + UI.suit(v.suit) + ' ' + UI.suitPlural(v.suit) + ' yet. Draw from the deck.');
      return;
    }
    if (v.canTake) { UI.toast('Tap a glowing card on the table to take it.'); return; }
  };

  BurnsTable.prototype.shake = function (el) {
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  };

  /* A move. At this table the answer is immediate; at an online table it
     comes back from the server a moment later, and further taps wait for it. */
  BurnsTable.prototype.send = function (type, payload, then) {
    if (this.sending) return;
    var self = this;
    this.sending = true;
    var finish = function (res) { self.sending = false; then(res); };
    var res = this.session.act(this.me, type, payload, finish);
    if (!res || !res.pending) finish(res);
  };

  BurnsTable.prototype.play = function (id) {
    var v = this.v, self = this;
    this.send(v.canLead ? 'lead' : 'follow', { cardId: id }, function (res) {
      if (!res.ok) { UI.toast(UI.esc(res.message)); UI.Sound.play('nope'); return; }
      self.selected = null;
      UI.Sound.play('play');
      UI.buzz(10);
    });
  };

  BurnsTable.prototype.tapDeck = function () {
    var v = this.v;
    if (!v) return;
    UI.Sound.unlock();
    var deck = this.el.deck;
    if (!v.canDraw) {
      if (v.canFollow && v.deckCount === 0) UI.toast('The deck is empty. Play a ' + UI.suit(v.suit) + ' ' + UI.suitSingle(v.suit) + '.');
      else if (v.canLead) UI.toast('The leader doesn’t draw. Lead any card.');
      return;
    }
    var self = this;
    this.send('draw', {}, function (res) {
      if (res.ok) {
        var cd = v.timing.drawCooldownMs;
        deck.classList.remove('cooling');
        void deck.offsetWidth;
        deck.style.setProperty('--cool', cd + 'ms');
        deck.classList.add('cooling');
        clearTimeout(self.coolTimer);
        self.coolTimer = setTimeout(function () { deck.classList.remove('cooling'); }, cd);
        UI.Sound.play('draw');
        UI.buzz(8);
        if (res.matched) UI.toast('Found ' + UI.cardText(res.card) + '. Play it, or keep drawing.', 2400);
      } else if (res.code === 'cooldown') {
        deck.classList.remove('wiggle');
        void deck.offsetWidth;
        deck.classList.add('wiggle');
      } else {
        UI.toast(UI.esc(res.message));
      }
    });
  };

  BurnsTable.prototype.take = function (cardId) {
    var v = this.v;
    if (!v || !v.canTake) return;
    this.send('take', { cardId: cardId }, function (res) {
      if (!res.ok) { UI.toast(UI.esc(res.message)); UI.Sound.play('nope'); return; }
      UI.Sound.play('draw');
      UI.buzz(10);
    });
  };

  /* ---------- sounds and notices for things other players did ---------- */

  BurnsTable.prototype.react = function (events, v) {
    var me = this.me;
    events.forEach(function (e) {
      switch (e.type) {
        case 'lead':
        case 'commit':
          if (e.player !== me) UI.Sound.play('play');
          break;
        case 'draw':
          if (e.player !== me || e.auto) UI.Sound.play('draw');
          break;
        case 'reveal':
          setTimeout(function () { UI.Sound.play('flip'); }, 420);
          break;
        case 'setWon':
          if (e.player === me && v.phase !== 'over') setTimeout(function () { UI.Sound.play('win'); }, 700);
          break;
        case 'deckEmpty':
          UI.toast('The deck is empty.');
          break;
        case 'stuck':
          if (e.players.indexOf(me) >= 0) UI.toast('No ' + UI.suit(e.suit) + ' and the deck is empty. You’ll take from the set.', 2600);
          break;
        case 'timeout':
          if (e.players.indexOf(me) >= 0) {
            UI.toast(e.phase === 'lead' ? 'Time’s up. A random card was led for you.' : 'Time’s up. A random card was played for you.', 2600);
            UI.Sound.play('nope');
          }
          break;
        case 'takeStart':
          if (e.takers.indexOf(me) >= 0) UI.Sound.play('alert');
          break;
        case 'take':
          if (e.player !== me) UI.Sound.play('draw');
          if (e.player === me && e.auto) UI.toast('Time’s up. You picked up ' + UI.cardText(e.card) + '.');
          break;
        case 'gameOver':
          var iWon = e.winners.indexOf(me) >= 0;
          setTimeout(function () { UI.Sound.play(iWon ? 'victory' : 'lose'); }, e.reason === 'flush' ? 1200 : 1500);
          break;
        // Real Burns
        case 'out':
          if (e.players.indexOf(me) >= 0) setTimeout(function () { UI.Sound.play('win'); }, e.flush ? 1200 : 700);
          break;
        case 'loser':
          setTimeout(function () { UI.Sound.play(e.player === me ? 'lose' : 'alert'); }, 600);
          if (e.player === me) UI.buzz(80);
          break;
        case 'penaltyStop':
          UI.Sound.play('thud');
          break;
        case 'penaltyCard':
          if (e.match) UI.Sound.play(e.n === 1 ? 'victory' : 'flip');
          else UI.Sound.play(UI.isRed(e.card.suit) ? 'slapHard' : 'slapSoft');
          if (!e.match && v.loser === me) UI.buzz(UI.isRed(e.card.suit) ? 40 : 15);
          break;
      }
    });
  };

  /* ---------- play-by-play ---------- */

  BurnsTable.prototype.pushLog = function (html, cls) {
    var item = { html: html, cls: cls || '' };
    this.logItems.push(item);
    if (this.logItems.length > 600) this.logItems.shift();
    return item;
  };

  BurnsTable.prototype.logEvent = function (e, v) {
    var self = this;
    var me = this.me;
    var N = function (pid) { return self.name(pid); };
    var timed = ' (time ran out, so it was picked at random)';
    switch (e.type) {
      case 'deal':
        this.pushLog('Dealt ' + e.handSize + ' cards to each of ' + e.order.length + ' players.', 'set');
        if (e.mine) this.pushLog('Your hand: ' + sortHand(e.mine.hand).map(UI.cardText).join(' '));
        break;
      case 'flush':
        this.pushLog('Flush! ' + list(e.players.map(N)) + (e.players.length > 1 ? ' hold' : ' holds') + ' all four suits.', 'win');
        break;
      case 'noFlush':
        this.pushLog('No Flush on the deal.');
        break;
      case 'setStart':
        if (e.setNo === 1) this.pushLog('Set 1 · starter card ' + UI.cardText(e.starter) + ', so everyone follows ' + UI.suit(e.suit) + '.', 'set');
        else this.pushLog('Set ' + e.setNo + ' · ' + N(e.leader) + ' to lead.', 'set');
        break;
      case 'timeout':
        this.pushLog('Time ran out for ' + list(e.players.map(function (p) { return N(p) === 'You' ? 'you' : N(p); })) + '.');
        break;
      case 'lead':
        if (e.player === me && e.mine) this.pushLog('You led ' + UI.cardText(e.mine.card) + (e.auto ? timed : '') + (e.card ? '.' : ' Others only see the suit.'));
        else this.pushLog(N(e.player) + ' led ' + (e.card ? UI.cardText(e.card) : UI.suit(e.suit) + ' (card hidden)') + (e.auto ? timed : '') + '.');
        break;
      case 'commit':
        this.pushLog((e.player === me && e.mine ? 'You played ' + UI.cardText(e.mine.card) : N(e.player) + ' played a card') + (e.auto ? timed : '') + '.');
        break;
      case 'draw': {
        var k = this.lastSetNo + ':' + e.player;
        var d = this.drawLog[k];
        if (!d) d = this.drawLog[k] = { item: this.pushLog(''), n: 0, cards: [] };
        d.n = e.n;
        if (e.mine) d.cards.push(e.mine.card);
        d.item.html = e.player === me
          ? 'You drew ' + d.cards.map(UI.cardText).join(', ') + '.'
          : N(e.player) + ' drew ' + d.n + (d.n === 1 ? ' card.' : ' cards.');
        break;
      }
      case 'deckEmpty':
        this.pushLog('The deck is empty.');
        break;
      case 'stuck':
        this.pushLog(list(e.players.map(N)) + ' can’t follow ' + UI.suit(e.suit) + ' and can’t draw.');
        break;
      case 'reveal':
        this.pushLog('Reveal: ' + e.cards.filter(function (c) { return c.owner; }).map(function (c) {
          return N(c.owner) + ' ' + UI.cardText(c.card);
        }).join(' · '));
        break;
      case 'takeStart':
        this.pushLog(list(e.takers.map(N)) + (e.takers.length > 1 ? ' have' : ' has') + ' 10 seconds to take a card from the set.');
        break;
      case 'take':
        this.pushLog(N(e.player) + ' picked up ' + UI.cardText(e.card) +
          (e.from ? ' (' + (e.from === me ? 'yours' : N(e.from) + '’s') + ')' : ' (the starter)') +
          (e.auto ? ', picked at random when time ran out.' : '.'));
        break;
      case 'setWon':
        if (e.card) this.pushLog(N(e.player) + ' won the set with ' + UI.cardText(e.card) + '.', 'win');
        break;
      case 'gameOver':
        if (e.reason === 'empty') this.pushLog(list(e.winners.map(N)) + (e.winners[0] === me ? ' emptied your hand and won!' : ' emptied their hand and won.'), 'win');
        if (e.reason === 'real') this.pushLog((e.loser === me ? 'You lost and take ' : N(e.loser) + ' lost and takes ') + slapsText(e.soft, e.hard) + ' in all.', 'win');
        break;
      // Real Burns
      case 'out':
        this.pushLog(list(e.players.map(function (p, i) { return N(p) + ' (' + ordinal(e.places[i]) + ')'; })) +
          (e.players.length > 1 ? ' are' : e.players[0] === me ? ' are' : ' is') + ' out and safe' + (e.flush ? ' with a Flush.' : '.'), 'win');
        break;
      case 'loser':
        this.pushLog((e.player === me ? 'You’re' : N(e.player) + ' is') + ' left holding cards and ' + (e.player === me ? 'lose.' : 'loses.'), 'set');
        break;
      case 'penaltyStart':
        this.pushLog('Penalty round: ' + list(e.order.map(N)) + (e.order.length > 1 ? ' each take a turn.' : ' takes a turn.'), 'set');
        break;
      case 'penaltyTurn':
        this.pushLog((e.shuffler === me ? 'You shuffle.' : N(e.shuffler) + ' shuffles.'));
        break;
      case 'penaltyStop':
        this.pushLog(e.auto ? 'The shuffle stopped by itself.' : N(e.player) + (e.player === me ? ' say' : ' says') + ' “Stop!”');
        break;
      case 'penaltySuit':
        this.pushLog((e.auto ? 'A suit was picked for ' + (e.player === me ? 'you' : N(e.player)) + ': ' : (e.player === me ? 'You pick ' : N(e.player) + ' picks ')) + UI.suit(e.suit) + ' ' + UI.suitPlural(e.suit) + '.');
        this.penLog = this.pushLog('');
        this.penCards = [];
        break;
      case 'penaltyCard':
        if (this.penLog) {
          this.penCards.push(e.card);
          this.penLog.html = (e.shuffler === me ? 'You turned over ' : N(e.shuffler) + ' turned over ') + this.penCards.map(UI.cardText).join(' ') + '.';
        }
        break;
      case 'penaltyResult':
        this.pushLog(e.lucky ? 'Lucky: the first card was a ' + UI.suitSingle(e.suit) + ', so no slaps from ' + (e.shuffler === me ? 'you' : N(e.shuffler)) + '.'
          : slapsText(e.soft, e.hard).charAt(0).toUpperCase() + slapsText(e.soft, e.hard).slice(1) + ' from ' + (e.shuffler === me ? 'you' : N(e.shuffler)) + '.', 'win');
        break;
    }
    if (e.type === 'setStart') this.lastSetNo = e.setNo;
    if (e.type === 'out') this.justOut = { set: v.setNo, players: e.players.slice() };
  };

  /* ---------- end of game ---------- */

  /* What the end-of-game sheet shows for Burns: how it was won, any Flush,
     and everyone's cards left. */
  BurnsTable.prototype.result = function (v) {
    var me = this.me;
    var byId = {};
    v.players.forEach(function (p, i) { byId[p.id] = { p: p, i: i }; });
    if (v.winReason === 'real') return this.realResult(v, byId);
    var winners = v.winners || [];
    var iWon = winners.indexOf(me) >= 0;
    var names = winners.map(function (id) { return id === me ? 'You' : UI.esc(byId[id].p.name); });
    var why, cards = '';
    if (v.winReason === 'flush') {
      why = (winners.length > 1 ? names.join(' and ') + ' each held' : (iWon ? 'You held' : names[0] + ' held')) + ' one card of every suit on the deal: a Flush.';
      winners.forEach(function (id) {
        cards += '<div class="result-cards" aria-label="' + (id === me ? 'Your' : UI.esc(byId[id].p.name) + '’s') + ' Flush"></div>';
      });
    } else {
      why = (iWon ? 'You played your last card' : names[0] + ' played their last card') + ' in set ' + v.setNo + '.';
    }
    var standings = v.players.slice().sort(function (a, b) {
      var aw = winners.indexOf(a.id) >= 0 ? -1 : 0, bw = winners.indexOf(b.id) >= 0 ? -1 : 0;
      return (aw - bw) || (a.handCount - b.handCount);
    }).map(function (p) {
      var paint = p.id === me ? 'var(--ink)' : PAINTS[(byId[p.id].i - 1 + PAINTS.length) % PAINTS.length];
      return '<li class="' + (winners.indexOf(p.id) >= 0 ? 'champ' : '') + '"><span class="avatar" style="--paint:' + paint + '">' + UI.esc((p.id === me ? 'You' : p.name).charAt(0)) + '</span>' +
        '<span>' + (p.id === me ? 'You' : UI.esc(p.name)) + '</span><span class="left">' + p.handCount + (p.handCount === 1 ? ' card' : ' cards') + ' left</span></li>';
    }).join('');
    return {
      when: v.winReason === 'flush' ? 'on the deal' : 'set ' + v.setNo,
      why: why,
      body: cards + '<div class="standings"><ul>' + standings + '</ul></div>',
      after: function (sheet) {
        if (v.winReason !== 'flush') return;
        var rows = sheet.querySelectorAll('.result-cards');
        winners.forEach(function (id, k) {
          (byId[id].p.hand || []).forEach(function (c) { rows[k].appendChild(UI.makeCard(c)); });
        });
      }
    };
  };

  /* Real Burns: one loser, everyone else wins, and the slaps each winner gave. */
  BurnsTable.prototype.realResult = function (v, byId) {
    var me = this.me, self = this;
    var iLost = v.loser === me;
    var given = {}, t = { soft: 0, hard: 0 };
    (v.penalty ? v.penalty.results : []).forEach(function (r) { given[r.by] = r; t.soft += r.soft; t.hard += r.hard; });
    var row = function (pid, right, cls) {
      var p = byId[pid].p;
      var paint = pid === me ? 'var(--ink)' : PAINTS[(byId[pid].i - 1 + PAINTS.length) % PAINTS.length];
      return '<li class="' + (cls || '') + '"><span class="avatar" style="--paint:' + paint + '">' + UI.esc((pid === me ? 'You' : p.name).charAt(0)) + '</span>' +
        '<span>' + self.name(pid) + '</span><span class="left">' + right + '</span></li>';
    };
    var rows = (v.winners || []).map(function (pid) {
      var r = given[pid];
      return row(pid, ordinal(byId[pid].p.place || 0) + ' · ' + (!r ? 'safe' : r.lucky ? 'lucky: no slaps' : slapsText(r.soft, r.hard).replace(/ slaps?/g, '')));
    }).join('') + row(v.loser, 'lost', 'loser');
    var name = this.name(v.loser);
    return {
      when: 'set ' + v.setNo,
      title: iLost ? 'YOU LOSE' : String(byId[v.loser].p.name).toUpperCase() + ' LOSES',
      why: iLost ? 'You were left holding cards, so you take ' + slapsText(t.soft, t.hard) + '. Everyone else wins.'
        : name + ' was left holding cards and takes ' + slapsText(t.soft, t.hard) + '. Everyone else wins.',
      body: '<div class="standings"><ul>' + rows + '</ul></div>'
    };
  };

  CT.UI.presenters = CT.UI.presenters || {};
  CT.UI.presenters.burns = BurnsTable;
})(window.CT);
