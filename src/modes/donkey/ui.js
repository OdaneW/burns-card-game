/* ==========================================================================
   GAME MODE · PASS-ROUN DONKEY — table screen
   Four seats round a table: you at the bottom, then clockwise the players
   on your left, across and on your right. A card travels round; four of a
   kind lands in the middle; everyone races to put their cards down; the
   slowest collects a letter of DONKEY. Everything drawn comes from
   session.view(me), so nothing hidden can leak onto the screen.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var PAINTS = ['#F4B942', '#F0643C', '#7FD1C1', '#9CC9EE', '#EBDDBB'];
  var RANK_ORDER = { J: 0, Q: 1, K: 2, A: 3 };
  var SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
  var RANKS = { J: 'Jacks', Q: 'Queens', K: 'Kings', A: 'Aces' };
  var PLACES = ['1st', '2nd', '3rd', '4th'];
  var RING = 113.1;   // circumference of the avatar timer ring (r = 18)

  function sortHand(hand) {
    return hand.slice().sort(function (a, b) {
      return (RANK_ORDER[a.rank] - RANK_ORDER[b.rank]) || (SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]);
    });
  }
  function list(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  function secs(ms) { return (ms / 1000).toFixed(2) + 's'; }
  function an(letter) { return /[AEFHILMNORSX]/.test(letter) ? 'an' : 'a'; }

  function avatarHtml(initial) {
    return '<span class="dk-avatar"><svg class="dk-ring" viewBox="0 0 40 40" aria-hidden="true" hidden>' +
      '<circle class="bg" cx="20" cy="20" r="18"/><circle class="fg" cx="20" cy="20" r="18" stroke-dasharray="' + RING + '" stroke-dashoffset="0"/></svg>' +
      '<span class="dk-initial">' + UI.esc(initial) + '</span></span>';
  }
  function wordHtml(word) {
    return '<span class="dk-word">' + word.split('').map(function (l) { return '<b>' + l + '</b>'; }).join('') + '</span>';
  }

  function DonkeyTable(app, session, me, opts) {
    opts = opts || {};
    this.app = app;
    this.session = session;
    this.me = me;
    this.lastSeq = 0;
    this.selected = null;
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

  DonkeyTable.prototype.destroy = function () {
    if (this.unsub) this.unsub();
    window.removeEventListener('resize', this.onResize);
    clearTimeout(this.overTimer);
    this.root.innerHTML = '';
    var fx = document.getElementById('fx');
    if (fx) fx.innerHTML = '';
  };

  DonkeyTable.prototype.name = function (pid) {
    if (pid === this.me) return 'You';
    var p = this.session.state.players.filter(function (x) { return x.id === pid; })[0];
    return p ? UI.esc(p.name) : 'Someone';
  };
  /* "you" in the middle of a sentence */
  DonkeyTable.prototype.lname = function (pid) { return pid === this.me ? 'you' : this.name(pid); };

  DonkeyTable.prototype.player = function (v, pid) {
    return v.players.filter(function (p) { return p.id === pid; })[0];
  };

  /* Where a seat sits on screen, counted clockwise from you. */
  DonkeyTable.prototype.where = function (v, pid) {
    var ids = v.players.map(function (p) { return p.id; });
    var off = (ids.indexOf(pid) - ids.indexOf(this.me) + ids.length) % ids.length;
    return ['me', 'left', 'top', 'right'][off];
  };

  DonkeyTable.prototype.nextOf = function (v, pid) {
    var ids = v.players.map(function (p) { return p.id; });
    return ids[(ids.indexOf(pid) + 1) % ids.length];
  };

  /* ---------- static layout ---------- */

  DonkeyTable.prototype.build = function () {
    var v = this.session.view(this.me, { events: false });
    var self = this;
    this.root.innerHTML =
      '<header class="topbar">' +
        '<button class="icon-btn" id="d-menu" type="button" aria-label="Game menu">' + UI.icon.menu + '</button>' +
        '<span class="wordmark">DONKEY</span>' +
        '<span class="chip" id="d-round"></span>' +
        '<span class="spacer"></span>' +
        '<button class="icon-btn" id="d-music" type="button"></button>' +
        '<button class="icon-btn" id="d-sound" type="button"></button>' +
      '</header>' +
      '<div class="dk-table" id="d-table">' +
        '<div class="dk-center" id="d-center">' +
          // dashed ring with an arrowhead: passing goes clockwise
          '<svg class="dk-flow" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 8A42 42 0 1 1 20.3 20.3"/><path class="tip" d="M16.4 19.2L23.1 17.5L21.4 24.2"/></svg>' +
          '<span class="dk-deck card back" id="d-deck" aria-hidden="true"></span>' +
          '<div class="dk-four" id="d-four"></div>' +
          '<p class="dk-caption" id="d-caption"></p>' +
          '<div class="dk-duel" id="d-duel" hidden></div>' +
        '</div>' +
      '</div>' +
      '<div class="status" id="d-status" aria-live="polite"><p class="status-main"></p><p class="status-sub"></p></div>' +
      '<div class="dk-choices" id="d-choices" hidden></div>' +
      '<div class="dk-me" id="d-me">' +
        '<div class="dk-me-info">' + avatarHtml('Y') + '<div class="dk-me-text"><span class="me-name">You</span>' + wordHtml(v.word) + '</div></div>' +
        '<div class="dk-actions">' +
          '<button class="btn btn-primary dk-four-btn" id="d-declare" type="button" hidden>Four of a kind!</button>' +
          '<button class="btn btn-primary btn-play" id="d-pass" type="button" hidden></button>' +
        '</div>' +
      '</div>' +
      '<div class="hand-wrap dk-handwrap" id="d-handwrap"><div class="hand" id="d-hand"></div>' +
        '<button class="dk-slap" id="d-slap" type="button" hidden><span>Put down!</span></button>' +
      '</div>';

    var table = this.root.querySelector('#d-table');
    v.players.forEach(function (p, i) {
      if (p.id === self.me) return;
      var seat = document.createElement('div');
      seat.className = 'dk-seat dk-' + self.where(v, p.id);
      seat.dataset.pid = p.id;
      seat.style.setProperty('--paint', PAINTS[(i - 1 + PAINTS.length) % PAINTS.length]);
      seat.innerHTML = avatarHtml(p.name.charAt(0)) +
        '<span class="seat-name">' + UI.esc(p.name) + '</span>' + wordHtml(v.word) +
        '<div class="dk-fan"></div><span class="seat-chip"></span>';
      table.appendChild(seat);
      self.seatEls[p.id] = {
        seat: seat,
        ring: seat.querySelector('.dk-ring'),
        ringFg: seat.querySelector('.dk-ring .fg'),
        word: seat.querySelector('.dk-word'),
        fan: seat.querySelector('.dk-fan'),
        chip: seat.querySelector('.seat-chip')
      };
    });

    var meEl = this.root.querySelector('#d-me');
    this.seatEls[this.me] = {
      seat: meEl,
      ring: meEl.querySelector('.dk-ring'),
      ringFg: meEl.querySelector('.dk-ring .fg'),
      word: meEl.querySelector('.dk-word'),
      fan: null,
      chip: null
    };

    this.el = {
      round: this.root.querySelector('#d-round'),
      music: this.root.querySelector('#d-music'),
      sound: this.root.querySelector('#d-sound'),
      center: this.root.querySelector('#d-center'),
      deck: this.root.querySelector('#d-deck'),
      meAvatar: this.root.querySelector('#d-me .dk-avatar'),
      four: this.root.querySelector('#d-four'),
      caption: this.root.querySelector('#d-caption'),
      duel: this.root.querySelector('#d-duel'),
      choices: this.root.querySelector('#d-choices'),
      statusMain: this.root.querySelector('#d-status .status-main'),
      statusSub: this.root.querySelector('#d-status .status-sub'),
      declare: this.root.querySelector('#d-declare'),
      pass: this.root.querySelector('#d-pass'),
      handWrap: this.root.querySelector('#d-handwrap'),
      hand: this.root.querySelector('#d-hand'),
      slap: this.root.querySelector('#d-slap')
    };
    this.renderAudio();

    this.root.querySelector('#d-menu').addEventListener('click', function () { self.app.openMenu(); });
    this.el.music.addEventListener('click', function () { self.app.toggleMusic(); self.renderAudio(); });
    this.el.sound.addEventListener('click', function () { self.app.toggleSound(); self.renderAudio(); });
    this.el.hand.addEventListener('click', function (e) {
      var btn = e.target.closest('.hcard');
      if (btn) self.tapCard(btn.dataset.id, btn);
    });
    this.el.pass.addEventListener('click', function () { if (self.selected) self.pass(self.selected); });
    this.el.declare.addEventListener('click', function () { self.declare(); });
    // the race is won on the press, not the release
    this.el.slap.addEventListener('pointerdown', function (e) { e.preventDefault(); self.slap(); });
    this.el.slap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.slap(); }
    });
    this.el.choices.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.target) self.challenge(b.dataset.target);
      if (b.dataset.call) self.call(b.dataset.call);
    });
  };

  DonkeyTable.prototype.renderAudio = function () {
    var m = UI.Music.on, s = UI.Sound.on;
    this.el.music.innerHTML = m ? UI.icon.musicOn : UI.icon.musicOff;
    this.el.music.setAttribute('aria-label', m ? 'Music on. Tap to turn it off.' : 'Music off. Tap to turn it on.');
    this.el.music.classList.toggle('off', !m);
    this.el.sound.innerHTML = s ? UI.icon.soundOn : UI.icon.soundOff;
    this.el.sound.setAttribute('aria-label', s ? 'Sound effects on. Tap to mute.' : 'Sound effects off. Tap to turn on.');
    this.el.sound.classList.toggle('off', !s);
  };

  /* ---------- update cycle ---------- */

  DonkeyTable.prototype.update = function () {
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
      this.overTimer = setTimeout(function () { self.app.showResult(self.v); }, events.length ? 2400 : 200);
    }
  };

  /* Where things are on screen before the DOM changes. */
  DonkeyTable.prototype.capture = function () {
    var pre = { hand: {} };
    for (var id in this.handEls) pre.hand[id] = this.handEls[id].getBoundingClientRect();
    return pre;
  };

  /* Card flights for a batch of events. */
  DonkeyTable.prototype.plan = function (events, pre, v) {
    var me = this.me, self = this;
    var flights = [];
    function add(f) { if (f.hide) self.hide(f.hide); flights.push(f); }
    events.forEach(function (e) {
      if (e.type === 'deal') {
        var k = 0;
        for (var r = 0; r < e.handSize; r++) {
          e.order.forEach(function (pid) {
            var delay = 120 + k * 55;
            k++;
            if (pid === me && e.mine) {
              var c = e.mine.hand[r];
              add({ from: 'center', to: 'h:' + c.id, card: c, delay: delay, duration: 320, hide: 'h:' + c.id, sound: 'deal' });
            } else {
              add({ from: 'center', to: 'seat:' + pid, card: null, delay: delay, duration: 300, sound: k % 2 ? 'deal' : null });
            }
          });
        }
      } else if (e.type === 'pass') {
        if (e.from === me && e.mine) {
          add({ fromRect: pre && pre.hand[e.mine.card.id], from: 'seat:' + me, to: 'seat:' + e.to, card: e.mine.card, duration: 380 });
        } else if (e.to === me && e.mine) {
          add({ from: 'seat:' + e.from, to: 'h:' + e.mine.card.id, card: e.mine.card, duration: 420, hide: 'h:' + e.mine.card.id });
        } else {
          add({ from: 'seat:' + e.from, to: 'seat:' + e.to, card: null, duration: 380 });
        }
      } else if (e.type === 'declare') {
        e.cards.forEach(function (c, i) {
          var fromRect = e.player === me && pre ? pre.hand[c.id] : null;
          add({ fromRect: fromRect, from: 'seat:' + e.player, to: 'four:' + i, card: c, delay: 70 + i * 55, duration: 340, hide: 'four:' + i });
        });
      }
    });
    return { flights: flights };
  };

  DonkeyTable.prototype.target = function (key) {
    if (key === 'center') return this.el.deck;   // a card-sized spot in the middle of the table
    if (key.indexOf('h:') === 0) return this.handEls[key.slice(2)] || null;
    if (key.indexOf('four:') === 0) return this.el.four.children[+key.slice(5)] || null;
    if (key.indexOf('seat:') === 0) {
      var pid = key.slice(5);
      if (pid === this.me) {
        var cards = this.el.hand.children;
        return cards.length ? cards[Math.floor(cards.length / 2)] : this.el.meAvatar;
      }
      var s = this.seatEls[pid];
      return s ? (s.fan.lastElementChild || s.fan) : null;
    }
    return null;
  };

  DonkeyTable.prototype.run = function (plan) {
    var self = this;
    plan.flights.forEach(function (f) {
      var from = f.fromRect ? null : self.target(f.from);
      var to = self.target(f.to);
      if (f.sound) setTimeout(function () { UI.Sound.play(f.sound); }, f.delay || 0);
      UI.fly({ from: from, fromRect: f.fromRect, to: to, card: f.card, delay: f.delay, duration: f.duration })
        .then(function () { if (f.hide) self.unhide(f.hide); });
    });
  };

  DonkeyTable.prototype.hide = function (key) { this.hidden[key] = (this.hidden[key] || 0) + 1; };
  DonkeyTable.prototype.unhide = function (key) {
    this.hidden[key] = Math.max(0, (this.hidden[key] || 0) - 1);
    if (this.hidden[key]) return;
    delete this.hidden[key];
    var el = this.target(key);
    if (el) el.style.visibility = '';
  };

  /* ---------- rendering ---------- */

  DonkeyTable.prototype.render = function (v) {
    this.el.round.textContent = 'Round ' + v.round;
    this.renderSeats(v);
    this.renderCenter(v);
    this.renderStatus(v);
    this.renderChoices(v);
    this.renderMe(v);
    this.renderHand(v);
  };

  DonkeyTable.prototype.raceEntry = function (v, pid) {
    if (!v.race) return null;
    for (var i = 0; i < v.race.order.length; i++) if (v.race.order[i].player === pid) return { place: i + 1, ms: v.race.order[i].ms };
    return null;
  };

  DonkeyTable.prototype.renderWord = function (el, n, fresh) {
    var bs = el.children;
    for (var i = 0; i < bs.length; i++) {
      bs[i].classList.toggle('on', i < n);
      bs[i].classList.toggle('fresh', !!fresh && i === n - 1);
    }
    el.setAttribute('aria-label', n ? 'Letters: ' + this.v.word.slice(0, n) : 'No letters');
  };

  DonkeyTable.prototype.renderSeats = function (v) {
    var self = this;
    var losers = (v.phase === 'roundEnd' && v.result) ? v.result.losers : [];
    v.players.forEach(function (p) {
      var s = self.seatEls[p.id];
      if (!s) return;
      s.seat.classList.toggle('is-turn', p.isTurn);
      s.seat.classList.toggle('is-down', p.down);
      s.seat.classList.toggle('is-safe', p.declared && (v.phase === 'declared' || v.phase === 'race' || v.phase === 'roundEnd'));
      s.seat.classList.toggle('is-loser', losers.indexOf(p.id) >= 0);
      var inDuel = v.tiebreak && v.tiebreak.duel && (v.tiebreak.duel.challenger === p.id || v.tiebreak.duel.opponent === p.id);
      s.seat.classList.toggle('in-duel', !!inDuel && v.phase === 'tiebreak');
      self.renderWord(s.word, p.letters, losers.indexOf(p.id) >= 0);
      if (p.id === self.me) return;
      // a small fan of card backs
      var n = Math.min(p.handCount, 5);
      while (s.fan.children.length < n) s.fan.appendChild(UI.makeCard(null));
      while (s.fan.children.length > n) s.fan.removeChild(s.fan.lastElementChild);
      s.fan.style.setProperty('--n', n);
      s.seat.setAttribute('aria-label', p.name + ', ' + p.handCount + ' cards, ' + (p.letters ? 'letters ' + v.word.slice(0, p.letters) : 'no letters'));
      var chip = self.chipFor(v, p);
      s.chip.textContent = chip.text;
      s.chip.className = 'seat-chip' + (chip.tone ? ' ' + chip.tone : '');
    });
  };

  DonkeyTable.prototype.chipFor = function (v, p) {
    var r = this.raceEntry(v, p.id);
    switch (v.phase) {
      case 'dealing': return { text: p.id === v.starter ? 'starts' : '' };
      case 'pass': return p.isTurn ? { text: 'passing…', tone: 'hot' } : { text: '' };
      case 'declared':
      case 'race':
        if (p.declared) return { text: 'four ' + RANKS[v.declare.rank] + '!', tone: 'hot' };
        if (r) return { text: PLACES[r.place - 1] + ' · ' + secs(r.ms) };
        return { text: '' };
      case 'roundEnd': {
        var res = v.result;
        if (res.losers.indexOf(p.id) >= 0) return { text: '+' + v.word.charAt(p.letters - 1), tone: 'ember' };
        if (p.id === res.declarer) return { text: 'safe' };
        return { text: r ? secs(r.ms) : '' };
      }
      case 'tiebreak':
      case 'over': {
        var place = v.standings ? v.standings.indexOf(p.id) : -1;
        var d = v.tiebreak && v.tiebreak.duel;
        if (v.phase === 'tiebreak' && d && d.step !== 'reveal' && d.challenger === p.id) return { text: 'challenger', tone: 'hot' };
        if (v.phase === 'tiebreak' && d && d.step !== 'reveal' && d.opponent === p.id) return { text: 'challenged' };
        return { text: place >= 0 ? PLACES[place] : 'in a tie', tone: place === 0 ? 'hot' : '' };
      }
    }
    return { text: '' };
  };

  DonkeyTable.prototype.renderCenter = function (v) {
    var duel = v.tiebreak && v.tiebreak.duel;
    var showDuel = (v.phase === 'tiebreak' || v.phase === 'over') && duel;
    this.el.center.classList.toggle('duel-on', !!showDuel);
    this.el.duel.hidden = !showDuel;
    if (showDuel) { this.renderDuel(v, duel); return; }

    var d = v.declare;
    var key = d ? v.round + ':' + d.player : '';
    if (this.el.four.dataset.key !== key) {
      this.el.four.dataset.key = key;
      this.el.four.innerHTML = '';
      if (d) {
        var self = this;
        d.cards.forEach(function (c, i) {
          var el = UI.makeCard(c);
          el.style.setProperty('--i', i);
          if (self.hidden['four:' + i]) el.style.visibility = 'hidden';
          self.el.four.appendChild(el);
        });
      }
    }
    this.el.center.classList.toggle('has-four', !!d);
    this.el.center.classList.toggle('racing', v.phase === 'race');
    this.el.caption.innerHTML = d
      ? (d.player === this.me ? 'Your' : this.name(d.player) + '’s') + ' four ' + RANKS[d.rank]
      : (v.phase === 'pass' ? 'Passing to the left' : '');
  };

  DonkeyTable.prototype.renderDuel = function (v, d) {
    var me = this.me, self = this;
    var tied = d.players.map(function (pid) { return self.name(pid); });
    var head = 'Tie-breaker for ' + PLACES[d.place] + ' place';
    var cardEl = function (pid) {
      var drawn = d.step !== 'choose';
      if (!pid || !drawn) return '<div class="dk-duel-card empty"></div>';
      var c = d.cards ? d.cards[pid] : (pid === me ? d.myCard : null);
      return '<div class="dk-duel-card" data-card="' + (c ? c.id : '') + '"></div>';
    };
    var side = function (pid, role) {
      return '<div class="dk-duel-side">' + cardEl(pid) +
        '<span class="nm">' + (pid ? self.name(pid) : '…') + '</span><span class="role">' + role + '</span></div>';
    };
    var html = '<p class="dk-duel-head">' + head + '</p>' +
      '<p class="dk-duel-tied">' + list(tied) + ' have ' + this.lettersWord(v, d.players[0]) + '</p>' +
      '<div class="dk-duel-cards">' + side(d.challenger, 'challenger') + '<span class="vs">vs</span>' + side(d.opponent, d.opponent ? 'opponent' : 'being picked') + '</div>';
    if (d.step === 'reveal' && d.result) {
      html += '<p class="dk-duel-call ' + (d.result.right ? 'right' : 'wrong') + '">Called ' + d.call + ' · ' + (d.result.right ? 'right' : 'wrong') + '</p>';
    }
    var key = JSON.stringify([d.n, d.step, d.opponent, !!d.cards, v.canChallenge, v.canCall]);
    if (this.el.duel.dataset.key !== key) {
      this.el.duel.dataset.key = key;
      this.el.duel.innerHTML = html;
      this.el.duel.querySelectorAll('.dk-duel-card[data-card]').forEach(function (el) {
        var id = el.dataset.card;
        var c = null;
        if (id) {
          var all = [d.myCard].concat(d.cards ? Object.keys(d.cards).map(function (k) { return d.cards[k]; }) : []);
          c = all.filter(function (x) { return x && x.id === id; })[0] || null;
        }
        el.appendChild(UI.makeCard(c));
      });
    }
  };

  /* The challenger's buttons, in a full-width row under the status. */
  DonkeyTable.prototype.renderChoices = function (v) {
    var d = v.tiebreak && v.tiebreak.duel, me = this.me, self = this;
    var html = '';
    if (d && v.canChallenge) {
      html = d.players.filter(function (pid) { return pid !== me; }).map(function (pid) {
        return '<button class="btn btn-ghost" type="button" data-target="' + pid + '">Challenge ' + self.name(pid) + '</button>';
      }).join('');
    } else if (d && v.canCall) {
      html = '<button class="btn btn-ghost" type="button" data-call="lower">Lower</button>' +
        '<button class="btn btn-ghost" type="button" data-call="equal">Equal</button>' +
        '<button class="btn btn-ghost" type="button" data-call="higher">Higher</button>';
    }
    if (this.el.choices.dataset.html !== html) {
      this.el.choices.dataset.html = html;
      this.el.choices.innerHTML = html;
    }
    this.el.choices.hidden = !html;
  };

  DonkeyTable.prototype.lettersWord = function (v, pid) {
    var p = this.player(v, pid);
    if (!p || !p.letters) return 'no letters';
    return p.letters === 1 ? '1 letter' : p.letters + ' letters';
  };

  DonkeyTable.prototype.statusFor = function (v) {
    var me = this.me, self = this;
    var timer = ' <span class="secs"></span>';
    var four = v.myFour ? 'four ' + RANKS[v.myFour] : '';
    switch (v.phase) {
      case 'dealing':
        return { main: 'Round ' + v.round + ' · dealing…', sub: (v.starter === me ? 'You start' : this.name(v.starter) + ' starts') + ' the passing.' };
      case 'pass': {
        var to = this.name(this.nextOf(v, v.turn));
        if (v.canDeclare) return { main: '<span class="hl">You have ' + four + '!</span> Put them down.', sub: 'Tap Four of a kind before anyone else gets there.' };
        if (v.canPass) return { main: '<span class="hl">Your turn.</span> Pass a card to ' + to + '.' + timer, sub: 'Keep the cards you’re collecting. Tap a card, then tap it again.' };
        return { main: this.name(v.turn) + ' is passing to ' + (to === 'You' ? 'you' : to) + '…', sub: 'Watch for four of a kind, and be quick to put your cards down.' };
      }
      case 'declared':
        return { main: (v.declare.player === me ? 'You put down four ' : this.name(v.declare.player) + ' has four ') + RANKS[v.declare.rank] + '!', sub: v.declare.player === me ? 'You’re safe this round.' : 'Get ready…' };
      case 'race': {
        var mine = this.raceEntry(v, me);
        var waiting = v.race.racers.filter(function (pid) { return !self.raceEntry(v, pid); }).map(function (pid) { return self.lname(pid); });
        if (v.canReact) return { main: '<span class="hl">Put your cards down!</span>', sub: 'The last one gets a letter.' };
        if (v.declare.player === me) return { main: 'You’re safe. Who’s slowest?', sub: waiting.length ? 'Waiting for ' + list(waiting) + '.' : '' };
        if (mine) return { main: 'Down in ' + secs(mine.ms) + '.', sub: waiting.length ? 'Waiting for ' + list(waiting) + '.' : '' };
        return { main: '', sub: '' };
      }
      case 'roundEnd': {
        var r = v.result;
        var who = r.losers.map(function (pid) { return self.lname(pid); });
        var gets = r.losers.map(function (pid) {
          var p = self.player(v, pid);
          return v.word.charAt(p.letters - 1);
        });
        var iLost = r.losers.indexOf(me) >= 0;
        var main;
        if (r.losers.length === 1) {
          main = iLost
            ? '<span class="em">You were ' + (r.late.length ? 'too slow' : 'last') + '.</span> You get ' + an(gets[0]) + ' ' + gets[0] + '.'
            : this.name(r.losers[0]) + ' was ' + (r.late.length ? 'too slow' : 'last') + ' and gets ' + an(gets[0]) + ' ' + gets[0] + '.';
        } else {
          main = list(who) + ' never put their cards down: a letter each.';
        }
        var times = r.order.map(function (o) { return self.name(o.player) + ' ' + secs(o.ms); }).join(' · ');
        var anyDonkey = v.players.some(function (p) { return p.letters >= v.word.length; });
        return { main: main, sub: anyDonkey ? 'That spells DONKEY. Game over!' : times };
      }
      case 'tiebreak': {
        var d = v.tiebreak.duel;
        if (!d) return { main: 'Tie-breaker', sub: '' };
        var opp = d.opponent ? this.lname(d.opponent) : '';
        if (d.step === 'choose') {
          if (v.canChallenge) return { main: '<span class="hl">You’re the challenger.</span> Pick who to duel.' + timer, sub: 'You’ll each draw a card from a full deck.' };
          return { main: this.name(d.challenger) + ' is picking who to challenge…', sub: 'Tied players settle their places with a duel.' };
        }
        if (d.step === 'call') {
          var my = d.myCard ? UI.cardText(d.myCard) : '';
          if (v.canCall) return { main: 'Your card is ' + my + '. Is it lower, equal or higher than ' + opp + '’s?' + timer, sub: 'A right call knocks ' + opp + ' out; a wrong one knocks you out. Aces are high.' };
          if (d.opponent === me) return { main: this.name(d.challenger) + ' is making the call…', sub: 'Your card is ' + my + '.' };
          return { main: this.name(d.challenger) + ' is making the call against ' + opp + '…', sub: '' };
        }
        var res = d.result;
        return {
          main: (d.challenger === me ? 'You' : this.name(d.challenger)) + ' called ' + d.call + ': ' + (res.right ? 'right' : 'wrong') + '.',
          sub: (res.out === me ? 'You take ' : this.name(res.out) + ' takes ') + PLACES[res.place] + ' place.'
        };
      }
      case 'over': {
        var w = v.winners && v.winners[0];
        return { main: w === me ? '<span class="hl">You win!</span>' : this.name(w) + ' wins.', sub: 'Fewest letters when DONKEY was spelled.' };
      }
    }
    return { main: '', sub: '' };
  };

  DonkeyTable.prototype.renderStatus = function (v) {
    var st = this.statusFor(v);
    this.el.statusMain.innerHTML = st.main;
    this.el.statusSub.innerHTML = st.sub || '';
  };

  DonkeyTable.prototype.renderMe = function (v) {
    this.el.declare.hidden = !v.canDeclare;
    var sel = v.canPass && this.selected ? v.hand.filter(function (c) { return c.id === this.selected; }, this)[0] : null;
    if (sel && !v.canDeclare) {
      this.el.pass.hidden = false;
      this.el.pass.innerHTML = 'Pass ' + sel.rank + UI.suitSvg(sel.suit);
      this.el.pass.setAttribute('aria-label', 'Pass the ' + CT.cardName(sel));
    } else {
      this.el.pass.hidden = true;
    }
    this.el.slap.hidden = !v.canReact;
    this.el.handWrap.classList.toggle('is-down', !!this.raceEntry(v, this.me) && (v.phase === 'race' || v.phase === 'roundEnd'));
  };

  DonkeyTable.prototype.renderHand = function (v) {
    var cards = sortHand(v.hand);
    var self = this;
    if (this.selected && !v.hand.some(function (c) { return c.id === self.selected; })) this.selected = null;
    if (!v.canPass) this.selected = null;
    var keep = {};
    var fourRank = v.myFour;
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
      el.classList.toggle('playable', !!v.canPass && !v.canDeclare);
      el.classList.toggle('four', !!fourRank && c.rank === fourRank);
      el.classList.toggle('selected', self.selected === c.id);
      el.classList.remove('dim');
      el.style.visibility = self.hidden['h:' + c.id] ? 'hidden' : '';
      el.style.zIndex = String(i + 1);
    });
    for (var id in this.handEls) {
      if (!keep[id]) { this.handEls[id].parentNode.removeChild(this.handEls[id]); delete this.handEls[id]; }
    }
    this.layoutHand(cards);
  };

  DonkeyTable.prototype.layoutHand = function (cards) {
    var wrap = this.el.handWrap;
    var cs = getComputedStyle(wrap);
    var W = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hcw')) || 58;
    var n = cards.length;
    var step = n > 1 ? Math.min(cw + 8, (W - cw) / (n - 1)) : 0;
    var total = n ? (n - 1) * step + cw : 0;
    var offset = Math.max(0, (W - total) / 2);
    this.el.hand.style.width = W + 'px';
    var self = this;
    cards.forEach(function (c, i) {
      var el = self.handEls[c.id];
      if (el) el.style.left = (offset + i * step) + 'px';
    });
  };

  /* ~20×/s from the app loop: pass and tie-breaker countdowns. */
  DonkeyTable.prototype.frame = function () {
    var v = this.v;
    if (!v) return;
    var now = this.session.now();
    var self = this;
    var endsAt = null, total = 0, who = null;
    if (v.phase === 'pass' && v.turnEndsAt) { endsAt = v.turnEndsAt; total = v.timing.passMs; who = v.turn; }
    if (v.phase === 'tiebreak' && v.tiebreak.duel && v.tiebreak.duel.step !== 'reveal') {
      endsAt = v.tiebreak.duel.endsAt; total = v.timing.duelChoiceMs; who = v.tiebreak.duel.challenger;
    }
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
    if (who === this.me && endsAt) {
      var left = Math.max(0, endsAt - now);
      var sec = Math.ceil(left / 1000);
      if (span) span.textContent = left <= 10000 ? '· ' + sec + 's' : '';
      if (sec !== this.lastSecs) {
        this.lastSecs = sec;
        if (left <= 5000 && sec > 0) UI.Sound.play('tick');
      }
    } else if (span) span.textContent = '';
  };

  /* ---------- input ---------- */

  DonkeyTable.prototype.tapCard = function (id, el) {
    var v = this.v;
    if (!v) return;
    UI.Sound.unlock();
    if (v.canDeclare) { this.shake(this.el.declare); UI.toast('You have four of a kind. Put them down!'); return; }
    if (!v.canPass) {
      if (v.phase === 'pass') UI.toast('Wait for your turn. ' + this.name(v.turn) + ' is passing.');
      return;
    }
    if (this.selected === id) { this.pass(id); return; }
    this.selected = id;
    UI.buzz(8);
    this.renderHand(v);
    this.renderMe(v);
  };

  DonkeyTable.prototype.shake = function (el) {
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  };

  DonkeyTable.prototype.pass = function (id) {
    var res = this.session.act(this.me, 'pass', { cardId: id });
    if (!res.ok) { UI.toast(UI.esc(res.message)); UI.Sound.play('nope'); return; }
    this.selected = null;
    UI.Sound.play('play');
    UI.buzz(10);
  };

  DonkeyTable.prototype.declare = function () {
    UI.Sound.unlock();
    var res = this.session.act(this.me, 'declare');
    if (!res.ok) { UI.toast(UI.esc(res.message)); UI.Sound.play('nope'); return; }
    UI.buzz(20);
  };

  DonkeyTable.prototype.slap = function () {
    var v = this.v;
    if (!v || !v.canReact) return;
    var res = this.session.act(this.me, 'react');
    if (!res.ok) return;
    UI.Sound.play('slap');
    UI.buzz(25);
  };

  DonkeyTable.prototype.challenge = function (pid) {
    var res = this.session.act(this.me, 'challenge', { target: pid });
    if (!res.ok) UI.toast(UI.esc(res.message));
  };

  DonkeyTable.prototype.call = function (call) {
    var res = this.session.act(this.me, 'call', { call: call });
    if (!res.ok) UI.toast(UI.esc(res.message));
  };

  /* ---------- sounds and notices ---------- */

  DonkeyTable.prototype.react = function (events, v) {
    var me = this.me, self = this;
    events.forEach(function (e) {
      switch (e.type) {
        case 'pass':
          if (e.to === me) UI.Sound.play('draw');
          else if (e.from !== me) UI.Sound.play('deal');
          break;
        case 'declare':
          setTimeout(function () { UI.Sound.play('slap'); }, 380);
          break;
        case 'react':
          if (e.player !== me) UI.Sound.play('thud');
          break;
        case 'roundEnd':
          if (e.losers.indexOf(me) >= 0) setTimeout(function () { UI.Sound.play('bray'); }, 250);
          else setTimeout(function () { UI.Sound.play('win'); }, 250);
          break;
        case 'timeout':
          if (e.player === me) {
            UI.toast(e.phase === 'pass' ? 'Time’s up. A card was passed for you.' : e.phase === 'choose' ? 'Time’s up. An opponent was picked for you.' : 'Time’s up. The likeliest call was made for you.');
            UI.Sound.play('nope');
          }
          break;
        case 'duelDraw':
        case 'duel':
          UI.Sound.play('flip');
          break;
        case 'gameOver':
          setTimeout(function () { UI.Sound.play(e.winners.indexOf(me) >= 0 ? 'victory' : 'lose'); }, 900);
          break;
      }
    });
  };

  /* ---------- play-by-play ---------- */

  DonkeyTable.prototype.pushLog = function (html, cls) {
    var item = { html: html, cls: cls || '' };
    this.logItems.push(item);
    if (this.logItems.length > 600) this.logItems.shift();
    return item;
  };

  DonkeyTable.prototype.logEvent = function (e, v) {
    var me = this.me, self = this;
    var N = function (pid) { return self.name(pid); };
    switch (e.type) {
      case 'deal':
        this.pushLog('Round ' + e.round + ' · ' + (e.starter === me ? 'you start' : N(e.starter) + ' starts') + '.', 'set');
        if (e.mine) this.pushLog('Your hand: ' + sortHand(e.mine.hand).map(UI.cardText).join(' '));
        break;
      case 'pass':
        if (e.from === me && e.mine) this.pushLog('You passed ' + UI.cardText(e.mine.card) + ' to ' + N(e.to) + (e.auto ? ' (time ran out)' : e.spare ? ' (your spare card)' : '') + '.');
        else if (e.to === me && e.mine) this.pushLog(N(e.from) + ' passed you ' + UI.cardText(e.mine.card) + (e.spare ? ' (their spare card)' : '') + '.');
        break;
      case 'declare':
        this.pushLog((e.player === me ? 'You' : N(e.player)) + ' put down four ' + RANKS[e.rank] + (e.auto ? ' (time ran out)' : '') + '!', 'win');
        break;
      case 'react':
        this.pushLog((e.player === me ? 'You' : N(e.player)) + ' put ' + (e.player === me ? 'your' : 'their') + ' cards down in ' + secs(e.ms) + '.');
        break;
      case 'roundEnd':
        e.losers.forEach(function (pid) {
          var n = e.letters[pid];
          self.pushLog((pid === me ? 'You get ' : N(pid) + ' gets ') + an(v.word.charAt(n - 1)) + ' ' + v.word.charAt(n - 1) + ': ' + v.word.slice(0, n) + '.', 'win');
        });
        break;
      case 'gameEnd':
        this.pushLog(list(e.donkeys.map(function (pid) { return pid === me ? 'You' : N(pid); })) + (e.donkeys.length > 1 ? ' spell' : (e.donkeys[0] === me ? ' spell' : ' spells')) + ' DONKEY.', 'set');
        break;
      case 'tiebreakStart':
        e.groups.forEach(function (g) {
          self.pushLog('Tie-breaker for ' + PLACES[g.place] + ' place: ' + list(g.players.map(N)) + '.', 'set');
        });
        break;
      case 'duel':
        this.pushLog(N(e.challenger) + ' (' + UI.cardText(e.cards[e.challenger]) + ') called ' + e.call + ' against ' + N(e.opponent) + ' (' + UI.cardText(e.cards[e.opponent]) + '): ' +
          (e.right ? 'right' : 'wrong') + '. ' + N(e.out) + ' takes ' + PLACES[e.place] + '.');
        break;
      case 'gameOver':
        this.pushLog('Final placings: ' + e.standings.map(function (pid, i) { return PLACES[i] + ' ' + N(pid); }).join(', ') + '.', 'win');
        break;
    }
  };

  /* ---------- end of game ---------- */

  DonkeyTable.prototype.result = function (v) {
    var me = this.me, self = this;
    var donkeys = v.players.filter(function (p) { return p.letters >= v.word.length; }).map(function (p) { return p.id; });
    var who = donkeys.map(function (pid) { return pid === me ? 'You' : self.name(pid); });
    var settled = {};
    this.session.state.events.forEach(function (e) {
      if (e.type === 'tieSettled') settled[e.first] = e.place;
    });
    var rows = (v.standings || []).map(function (pid, i) {
      var p = self.player(v, pid);
      var idx = v.players.indexOf(p);
      var paint = pid === me ? 'var(--ink)' : PAINTS[(idx - 1 + PAINTS.length) % PAINTS.length];
      var word = v.word.split('').map(function (l, k) { return '<b class="' + (k < p.letters ? 'on' : '') + '">' + l + '</b>'; }).join('');
      var note = settled[pid] != null ? ' <small>won the tie-breaker</small>' : '';
      return '<li class="' + (i === 0 ? 'champ' : '') + '"><span class="place">' + PLACES[i] + '</span>' +
        '<span class="avatar" style="--paint:' + paint + '">' + UI.esc((pid === me ? 'You' : p.name).charAt(0)) + '</span>' +
        '<span>' + (pid === me ? 'You' : UI.esc(p.name)) + note + '</span><span class="dk-word small">' + word + '</span></li>';
    }).join('');
    return {
      when: 'round ' + v.round,
      why: list(who) + ' spelled DONKEY.',
      body: '<div class="standings dk-standings"><ul>' + rows + '</ul></div>'
    };
  };

  CT.UI.presenters = CT.UI.presenters || {};
  CT.UI.presenters.donkey = DonkeyTable;
})(window.CT);
