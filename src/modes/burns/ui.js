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
  };

  BurnsTable.prototype.name = function (pid, cap) {
    if (pid === this.me) return cap === false ? 'you' : 'You';
    var p = this.v && this.v.players.filter(function (x) { return x.id === pid; })[0];
    if (!p) p = this.session.state.players.filter(function (x) { return x.id === pid; })[0];
    return p ? UI.esc(p.name) : 'Someone';
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
        '<span class="chip chip-warn" id="t-empty" hidden>Deck empty</span>' +
        '<span class="spacer"></span>' +
        '<button class="icon-btn" id="t-sound" type="button" aria-label="Sound"></button>' +
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
            '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true" hidden><circle class="bg" cx="50" cy="50" r="47"/><circle class="fg" cx="50" cy="50" r="47" stroke-dasharray="295.3" stroke-dashoffset="0"/></svg>' +
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
        '<span class="seat-chip"></span>' +
        '<span class="seat-voids"></span>';
      seats.appendChild(seat);
      self.seatEls[p.id] = {
        seat: seat,
        avatar: seat.querySelector('.avatar'),
        mini: seat.querySelector('.mini-back'),
        count: seat.querySelector('.seat-count b'),
        chip: seat.querySelector('.seat-chip'),
        voids: seat.querySelector('.seat-voids'),
        slot: seat.querySelector('.slot')
      };
    });

    this.el = {
      set: this.root.querySelector('#t-set'),
      empty: this.root.querySelector('#t-empty'),
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
    this.renderSound();

    // input
    this.root.querySelector('#t-menu').addEventListener('click', function () { self.app.openMenu(); });
    this.el.sound.addEventListener('click', function () { self.app.toggleSound(); self.renderSound(); });
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

  BurnsTable.prototype.renderSound = function () {
    var on = UI.Sound.on;
    this.el.sound.innerHTML = on ? UI.icon.soundOn : UI.icon.soundOff;
    this.el.sound.setAttribute('aria-label', on ? 'Sound on. Tap to mute.' : 'Sound off. Tap to turn on.');
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
    var steal = prev.options.deckEmpty === 'takeAndPlay';
    prev.table.forEach(function (e) {
      if (!e.card) return;
      var el = null;
      if (e.via === 'starter' && !(steal && e.takenBy)) el = self.el.leadContent.querySelector('.starter-card .flip');
      else {
        var holder = steal ? (e.takenBy || e.owner) : e.owner;
        var st = self.slotState[holder];
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
    var steal = v.options.deckEmpty === 'takeAndPlay';
    var intoSlots = false;
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
          if (!t.gone) add({ fromRect: t.rect, to: 'aside', card: t.card, delay: i * 45, duration: 420, spin: 0 });
        });
      } else if (e.type === 'lead' || e.type === 'commit') {
        if (e.player === me && e.mine) {
          var r1 = pre && pre.hand[e.mine.card.id];
          add({ fromRect: r1, to: 'slot:' + me, card: e.mine.card, duration: 300, hide: 'slot:' + me });
        } else {
          add({ from: 'seat:' + e.player, to: 'slot:' + e.player, card: e.card || null, duration: 340, hide: 'slot:' + e.player });
        }
      } else if (e.type === 'draw') {
        if (e.player === me && e.mine) {
          if (e.matched) add({ from: 'deck', to: 'slot:' + me, card: e.mine.card, duration: 360, hide: 'slot:' + me });
          else add({ from: 'deck', to: 'h:' + e.mine.card.id, card: e.mine.card, duration: 330, hide: 'h:' + e.mine.card.id });
        } else {
          if (e.matched) add({ from: 'deck', to: 'slot:' + e.player, card: null, duration: 340, hide: 'slot:' + e.player });
          else add({ from: 'deck', to: 'seat:' + e.player, card: null, duration: 300 });
        }
      } else if (e.type === 'take') {
        var src = preTable(e.card.id);
        var fromRect = src ? src.rect : null;
        if (steal) add({ fromRect: fromRect, to: 'slot:' + e.player, card: e.card, duration: 380, hide: 'slot:' + e.player });
        else if (e.player === me) add({ fromRect: fromRect, to: 'h:' + e.card.id, card: e.card, duration: 380, hide: 'h:' + e.card.id });
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
      UI.fly({ from: from, fromRect: f.fromRect, to: to, card: f.card, delay: f.delay, duration: f.duration, spin: f.spin })
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
  };

  BurnsTable.prototype.renderTop = function (v) {
    this.el.set.textContent = v.phase === 'dealing' ? 'Dealing' : 'Set ' + v.setNo;
    this.el.empty.hidden = !(v.deckCount === 0 && v.phase !== 'dealing');
  };

  BurnsTable.prototype.holder = function (v, e) {
    return v.options.deckEmpty === 'takeAndPlay' ? (e.takenBy || e.owner) : e.owner;
  };

  BurnsTable.prototype.entryFor = function (v, pid) {
    for (var i = 0; i < v.table.length; i++) {
      var e = v.table[i];
      if (this.holder(v, e) === pid) return e;
    }
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
      s.seat.setAttribute('aria-label', p.name + ', ' + p.handCount + ' cards');
      s.seat.classList.toggle('is-leader', p.isLeader);
      s.seat.classList.toggle('is-active', self.isActive(v, p));
      var chip = self.chipFor(v, p);
      s.chip.textContent = chip.text;
      s.chip.className = 'seat-chip' + (chip.tone ? ' ' + chip.tone : '');
      var vk = p.voids.join('') + (v.phase === 'over');
      if (s.voids.dataset.k !== vk) {
        s.voids.dataset.k = vk;
        s.voids.innerHTML = p.voids.length && v.phase !== 'over'
          ? 'no&nbsp;' + p.voids.map(UI.suit).join('')
          : '';
        s.voids.title = p.voids.length ? p.name + ' is known to be out of ' + p.voids.map(UI.suitPlural).join(' and ') : '';
      }
      if (self.renderSlot(s.slot, p.id, v, plan, revealOrder)) revealOrder++;
    });
    this.revealCount = revealOrder;
  };

  BurnsTable.prototype.isActive = function (v, p) {
    if (v.phase === 'lead') return p.isLeader;
    if (v.phase === 'follow') return !p.isLeader && !p.committed && !p.isTaker;
    if (v.phase === 'take') return p.isTaker && !p.took;
    return false;
  };

  BurnsTable.prototype.chipFor = function (v, p) {
    var won = v.setResult && v.setResult.player === p.id && (v.phase === 'reveal' || v.phase === 'over');
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
        if (p.took) return { text: v.options.deckEmpty === 'pickUp' ? 'picked one up' : 'took one' };
        return { text: p.drew ? 'drew ' + p.drew : '' };
    }
    return { text: '' };
  };

  /* Returns true when this slot flips face up in this render (for staggering). */
  BurnsTable.prototype.renderSlot = function (slotEl, pid, v, plan, order) {
    var st = this.slotState[pid] || (this.slotState[pid] = { flip: null, key: null, up: false });
    var steal = v.options.deckEmpty === 'takeAndPlay';
    var entry = this.entryFor(v, pid);
    var flipped = false;
    var tag = null;

    // A card this player played was taken away by someone else ("Take and play").
    var lostTo = null;
    if (steal) v.table.forEach(function (e) { if (e.owner === pid && e.takenBy && e.takenBy !== pid) lostTo = e.takenBy; });

    if (!entry) {
      if (st.flip) { st.flip.parentNode && st.flip.parentNode.removeChild(st.flip); st.flip = null; st.key = null; st.up = false; }
      slotEl.classList.remove('winner', 'takeable', 'gone');
      slotEl.removeAttribute('data-take');
      if (lostTo) tag = { text: 'taken', tone: '' };
    } else {
      var key = v.setNo + '|' + (entry.owner || 'starter') + '|' + entry.via;
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
        var isReveal = wantUp && v.revealed && entry.owner !== this.me && entry.via !== 'starter' &&
          !(entry.via === 'lead' && v.options.leadCard === 'faceUp') && !(steal && entry.takenBy === pid);
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

      var won = v.setResult && v.setResult.player === pid && (v.phase === 'reveal' || v.phase === 'over');
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
    var showEye = pid === this.me && entry && entry.card && !v.revealed && v.phase !== 'over';
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
      tagEl.className = 'slot-tag' + (tag.tone ? ' ' + tag.tone : '') + (tag.top ? ' top' : '');
      tagEl.innerHTML = tag.text;
    } else if (tagEl) tagEl.parentNode.removeChild(tagEl);
    return flipped;
  };

  BurnsTable.prototype.renderRail = function (v) {
    var deck = this.el.deck;
    deck.classList.toggle('can-draw', !!v.mustDraw);
    deck.classList.toggle('empty', v.deckCount === 0);
    this.el.deckCount.textContent = v.deckCount === 0 ? 'empty' : v.deckCount + ' left';
    deck.setAttribute('aria-label', v.mustDraw ? 'Deck, ' + v.deckCount + ' cards. Tap to draw.' : 'Deck, ' + v.deckCount + ' cards');

    this.el.aside.classList.toggle('empty', v.discard.length === 0);
    this.el.asideCount.textContent = v.discard.length + ' aside';

    // middle of the rail: starter card, suit to follow, or who leads
    var steal = v.options.deckEmpty === 'takeAndPlay';
    var starterEntry = null;
    v.table.forEach(function (e) { if (e.via === 'starter') starterEntry = e; });
    var content = this.el.leadContent;
    var label = { text: '', tone: '' };
    var key, html = null;

    if ((v.phase === 'dealing' || (v.phase === 'over' && v.winReason === 'flush')) && v.starter) {
      key = 'starter-deal:' + v.starter.id;
      label.text = 'Starter';
    } else if (starterEntry && !(steal && starterEntry.takenBy)) {
      key = 'starter:' + starterEntry.card.id;
      label.text = 'Follow ' + UI.suitPlural(v.suit);
      label.tone = v.canFollow || v.mustDraw ? 'hot' : '';
    } else if (v.phase === 'lead') {
      key = 'lead';
      html = '<div class="roundel empty"><span class="q">?</span></div>';
      label.text = v.canLead ? 'Your lead' : this.name(v.leader) + ' leads';
      label.tone = v.canLead ? 'hot' : '';
    } else if (v.suit) {
      key = 'suit:' + v.suit;
      html = '<div class="roundel ' + (UI.isRed(v.suit) ? 'red' : '') + '" aria-label="Suit in play: ' + UI.suitPlural(v.suit) + '">' + UI.suitSvg(v.suit) + '</div>';
      label.text = 'Follow ' + UI.suitPlural(v.suit);
      label.tone = v.canFollow || v.mustDraw ? 'hot' : '';
    } else {
      key = 'blank';
      html = '<div class="roundel empty"></div>';
    }
    if (v.phase === 'take') { label.text = 'Deck empty'; label.tone = 'ember'; }
    if (v.phase === 'reveal' && v.setResult) { label.text = v.setResult.player === this.me ? 'You win it' : this.name(v.setResult.player) + ' wins'; label.tone = 'ember'; }

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
        this.starterFlip = f;
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
    this.el.leadLabel.textContent = '';
    this.el.leadLabel.innerHTML = label.text;
    this.el.leadLabel.className = 'lead-label' + (label.tone ? ' ' + label.tone : '');
    this.el.leadLabel.hidden = !label.text;

    var timing = v.phase === 'take';
    this.el.ring.hidden = !timing;
    this.el.timer.hidden = !timing;
    if (!timing) this.el.lead.classList.remove('urgent');
    this.frame();
  };

  BurnsTable.prototype.statusFor = function (v) {
    var me = this.me, self = this;
    var mine = v.players.filter(function (p) { return p.id === me; })[0];
    var s = v.suit;
    var P = s ? UI.suit(s) + ' ' + UI.suitPlural(s) : '';
    var one = s ? UI.suitSingle(s) : '';
    var waitingOn = v.players.filter(function (p) { return p.id !== v.leader && !p.committed && !p.isTaker && p.id !== me; })
      .map(function (p) { return self.name(p.id); });

    switch (v.phase) {
      case 'dealing':
        return { main: 'Dealing…', sub: 'Four cards each. A Flush (one of every suit) wins on the spot.' };
      case 'lead':
        if (v.canLead) return { main: '<span class="hl">Your lead.</span> Play any card.', sub: 'Its suit is the one everyone must follow.' };
        return { main: this.name(v.leader) + ' is choosing a suit…', sub: this.name(v.leader) + ' won the last set.' };
      case 'follow': {
        var intro = v.setNo === 1 ? 'The starter card sets the suit.' : this.name(v.leader) + ' led ' + UI.suit(s) + '.';
        if (v.canFollow) return { main: 'Follow ' + P + ' — <span class="hl">pick a ' + one + '</span>', sub: intro + ' Cards stay hidden until everyone has played.' };
        if (v.mustDraw) {
          return {
            main: 'No ' + P + '. <span class="hl">Tap the deck to draw.</span>',
            sub: mine.drew ? 'Drawn ' + mine.drew + ' so far. Keep going until a ' + one + ' turns up.' : 'Draw until a ' + one + ' turns up. It is played for you.'
          };
        }
        if (mine && mine.isTaker) return { main: '<span class="em">No ' + P + ' and the deck is empty.</span>', sub: 'Once everyone else is in, you take a card from the set.' };
        return { main: v.leader === me ? 'You led ' + P + '.' : 'Your card is in.', sub: waitingOn.length ? 'Waiting for ' + list(waitingOn) + '.' : '' };
      }
      case 'take': {
        var takers = v.players.filter(function (p) { return p.isTaker; });
        var pending = takers.filter(function (p) { return !p.took && p.id !== me; }).map(function (p) { return self.name(p.id); });
        var verb = v.options.deckEmpty === 'pickUp' ? 'It goes into your hand.' : 'You play it as your own.';
        if (v.canTake) return { main: '<span class="hl">Take a card from the set</span> <span class="secs"></span>', sub: verb + ' Each card can only be taken once.' };
        if (mine && mine.isTaker) return { main: 'Got it.', sub: pending.length ? 'Waiting for ' + list(pending) + '.' : '' };
        var names = takers.map(function (p) { return self.name(p.id); });
        return { main: list(names) + (names.length > 1 ? ' are' : ' is') + ' taking from the set <span class="secs"></span>', sub: 'The deck is empty, so they take from the cards just played.' };
      }
      case 'reveal': {
        var r = v.setResult;
        if (!r || !r.card) return { main: this.name(r && r.player) + ' keeps the lead.', sub: '' };
        if (r.player === me) return { main: '<span class="hl">You win the set</span> with ' + UI.cardText(r.card) + '.', sub: 'You lead next.' };
        return { main: this.name(r.player) + ' wins the set with ' + UI.cardText(r.card) + '.', sub: this.name(r.player) + ' leads next.' };
      }
      case 'over': {
        var w = (v.winners || []).map(function (id) { return self.name(id); });
        var iWon = (v.winners || []).indexOf(me) >= 0;
        if (v.winReason === 'flush') return { main: (iWon ? '<span class="hl">Flush! You win.</span>' : 'Flush! ' + list(w) + (w.length > 1 ? ' win.' : ' wins.')), sub: 'All four suits on the deal.' };
        return { main: iWon ? '<span class="hl">You emptied your hand. You win!</span>' : list(w) + ' emptied their hand and wins.', sub: '' };
      }
    }
    return { main: '', sub: '' };
  };

  BurnsTable.prototype.renderStatus = function (v) {
    var st = this.statusFor(v);
    this.el.statusMain.innerHTML = st.main;
    this.el.statusSub.innerHTML = st.sub || '';
  };

  BurnsTable.prototype.renderMe = function (v, plan) {
    var me = this.me;
    var mine = v.players.filter(function (p) { return p.id === me; })[0];
    this.el.me.classList.toggle('is-leader', !!(mine && mine.isLeader));
    this.el.myCount.textContent = v.hand.length === 1 ? '1 card' : v.hand.length + ' cards';
    this.renderSlot(this.el.mySlot, me, v, plan, this.revealCount || 0);
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
      el.classList.toggle('dim', (needAct && !playable[c.id]) || !!v.mustDraw || (v.canTake && true));
      el.classList.toggle('selected', self.selected === c.id);
      el.style.visibility = self.hidden['h:' + c.id] ? 'hidden' : '';
      el.style.zIndex = String(i + 1);
    });
    for (var id in this.handEls) {
      if (!keep[id]) { this.handEls[id].parentNode.removeChild(this.handEls[id]); delete this.handEls[id]; }
    }
    this.layoutHand(cards);

    // bring the first playable card into view when it's your turn on a long hand
    var turnKey = needAct ? v.setNo + v.phase : null;
    if (turnKey && turnKey !== this.turnKey) {
      var first = cards.filter(function (c) { return playable[c.id]; })[0];
      var wrap = this.el.handWrap;
      if (first && wrap.scrollWidth > wrap.clientWidth) {
        var left = parseFloat(this.handEls[first.id].style.left) || 0;
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

  /* Called ~20×/s by the app loop for live timers. */
  BurnsTable.prototype.frame = function () {
    var v = this.v;
    if (!v || v.phase !== 'take' || !v.takeEndsAt) return;
    var left = Math.max(0, v.takeEndsAt - this.session.now());
    var frac = left / (v.timing.takeWindowMs || 10000);
    this.el.ringFg.setAttribute('stroke-dashoffset', String(295.3 * (1 - frac)));
    var secs = Math.ceil(left / 1000);
    this.el.timer.textContent = secs + 's';
    var urgent = left <= 3000;
    this.el.lead.classList.toggle('urgent', urgent);
    var span = this.el.statusMain.querySelector('.secs');
    if (span) span.textContent = '· ' + secs + 's';
    if (secs !== this.lastSecs) {
      this.lastSecs = secs;
      if (urgent && secs > 0 && v.canTake) UI.Sound.play('tick');
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
      UI.toast('No ' + UI.suit(v.suit) + ' ' + UI.suitPlural(v.suit) + '. Draw from the deck.');
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

  BurnsTable.prototype.play = function (id) {
    var v = this.v;
    var res = this.session.act(this.me, v.canLead ? 'lead' : 'follow', { cardId: id });
    if (!res.ok) { UI.toast(UI.esc(res.message)); UI.Sound.play('nope'); return; }
    this.selected = null;
    UI.Sound.play('play');
    UI.buzz(10);
  };

  BurnsTable.prototype.tapDeck = function () {
    var v = this.v;
    if (!v) return;
    UI.Sound.unlock();
    var deck = this.el.deck;
    if (!v.mustDraw) {
      if (v.canFollow) UI.toast('You have a ' + UI.suit(v.suit) + ' ' + UI.suitSingle(v.suit) + '. Play it.');
      return;
    }
    var res = this.session.act(this.me, 'draw');
    if (res.ok) {
      var cd = v.timing.drawCooldownMs;
      deck.classList.remove('cooling');
      void deck.offsetWidth;
      deck.style.setProperty('--cool', cd + 'ms');
      deck.classList.add('cooling');
      clearTimeout(this.coolTimer);
      this.coolTimer = setTimeout(function () { deck.classList.remove('cooling'); }, cd);
      UI.Sound.play('draw');
      UI.buzz(8);
      if (res.matched) UI.toast('Drew ' + UI.cardText(res.card) + ' — played for you.');
    } else if (res.code === 'cooldown') {
      deck.classList.remove('wiggle');
      void deck.offsetWidth;
      deck.classList.add('wiggle');
    } else {
      UI.toast(UI.esc(res.message));
    }
  };

  BurnsTable.prototype.take = function (cardId) {
    var v = this.v;
    if (!v || !v.canTake) return;
    var res = this.session.act(this.me, 'take', { cardId: cardId });
    if (!res.ok) { UI.toast(UI.esc(res.message)); UI.Sound.play('nope'); return; }
    UI.Sound.play('draw');
    UI.buzz(10);
  };

  /* ---------- sounds and notices for things other players did ---------- */

  BurnsTable.prototype.react = function (events, v) {
    var me = this.me, self = this;
    events.forEach(function (e) {
      switch (e.type) {
        case 'lead':
        case 'commit':
          if (e.player !== me) UI.Sound.play('play');
          break;
        case 'draw':
          if (e.player !== me) UI.Sound.play('draw');
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
        case 'takeStart':
          if (e.takers.indexOf(me) >= 0) UI.Sound.play('alert');
          break;
        case 'take':
          if (e.player !== me) UI.Sound.play('draw');
          if (e.player === me && e.auto) UI.toast('Time’s up — you got ' + UI.cardText(e.card) + '.');
          break;
        case 'gameOver':
          var iWon = e.winners.indexOf(me) >= 0;
          setTimeout(function () { UI.Sound.play(iWon ? 'victory' : 'lose'); }, e.reason === 'flush' ? 1200 : 1500);
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
      case 'lead':
        if (e.player === me && e.mine) this.pushLog('You led ' + UI.cardText(e.mine.card) + (e.card ? '.' : ' (others only see the suit).'));
        else this.pushLog(N(e.player) + ' led ' + (e.card ? UI.cardText(e.card) : UI.suit(e.suit) + ' (card hidden)') + '.');
        break;
      case 'commit':
        this.pushLog(e.player === me && e.mine ? 'You played ' + UI.cardText(e.mine.card) + '.' : N(e.player) + ' played a card.');
        break;
      case 'draw': {
        var k = this.lastSetNo + ':' + e.player;
        var d = this.drawLog[k];
        if (!d) d = this.drawLog[k] = { item: this.pushLog(''), n: 0, cards: [] };
        d.n = e.n;
        if (e.mine) d.cards.push(e.mine.card);
        var text;
        if (e.player === me) {
          text = 'You drew ' + d.cards.map(UI.cardText).join(', ');
          if (e.matched) text += ' — played the ' + UI.cardText(e.mine.card) + '.';
        } else {
          text = N(e.player) + ' drew ' + d.n + (d.n === 1 ? ' card' : ' cards');
          if (e.matched) text += d.n === 1 ? ', which matched and was played.' : '; the last one matched and was played.';
        }
        d.item.html = text;
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
        this.pushLog(N(e.player) + (v.options.deckEmpty === 'pickUp' ? ' picked up ' : ' took and played ') + UI.cardText(e.card) +
          (e.from ? ' (' + N(e.from).replace(/^You$/, 'yours') + (e.from === me ? '' : '’s') + ')' : ' (the starter)') +
          (e.auto ? ', picked at random when time ran out.' : '.'));
        break;
      case 'setWon':
        if (e.card) this.pushLog(N(e.player) + ' won the set with ' + UI.cardText(e.card) + '.', 'win');
        break;
      case 'gameOver':
        if (e.reason === 'empty') this.pushLog(list(e.winners.map(N)) + (e.winners[0] === me ? ' emptied your hand and won!' : ' emptied their hand and won.'), 'win');
        break;
    }
    if (e.type === 'setStart') this.lastSetNo = e.setNo;
  };

  CT.UI.presenters = CT.UI.presenters || {};
  CT.UI.presenters.burns = BurnsTable;
})(window.CT);
