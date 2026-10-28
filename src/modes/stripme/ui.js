/* ==========================================================================
   GAME MODE · STRIP-ME — table screen
   Your rival across the top, you at the bottom, the pile between you. Each
   player is a cartoon character in fun garments (as many as the losses
   allowed), over a T-shirt and shorts that always stay on. Lose a round and
   a garment flies off while its owner blushes and shivers. Tap your deck to
   turn its top card over. Everything drawn comes from session.view(me), so
   nothing hidden can leak onto the screen.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var StripMe = CT.getMode('stripme');
  var OWED = StripMe.owed;
  var RANK_NAME = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };
  var NUM = ['no', 'one', 'two', 'three', 'four'];
  var AUTO_KEY = 'cardtable.stripme.auto';
  var AUTO_MS = 620;          // Auto: a card every so often while it's your turn

  /* The garments for each number of losses allowed, in the order they come off. */
  var OUTFITS = {
    1: ['hat'],
    2: ['hat', 'coat'],
    3: ['hat', 'glasses', 'coat'],
    4: ['hat', 'glasses', 'coat', 'socks'],
    5: ['hat', 'glasses', 'scarf', 'coat', 'socks']
  };
  var QUICK_OUTFIT = ['hat', 'glasses', 'coat'];   // Quick Play: dressed up, but nothing comes off
  var GARMENTS = {
    hat: { name: 'silly hat', icon: '<path d="M5.5 2.5h7v8h-7z"/><rect x="2" y="10.5" width="14" height="2.6" rx="1.3"/><rect x="5.5" y="7.6" width="7" height="1.6" fill="var(--board)"/>' },
    glasses: { name: 'giant sunglasses', plural: true, icon: '<rect x="1.5" y="6" width="6.5" height="5" rx="2"/><rect x="10" y="6" width="6.5" height="5" rx="2"/><rect x="7.5" y="7.2" width="3" height="1.4"/>' },
    scarf: { name: 'stripy scarf', icon: '<path d="M3 4.5q6 4 12 0l1 2.4q-7 5-14 0z"/><path d="M10.5 8h3l1.3 7.5h-3.4z"/>' },
    coat: { name: 'oversized coat', icon: '<path d="M5 2.5q4-1.5 8 0l3.5 9-2.4.8-.9-4 .5 8.2H4.3l.5-8.2-.9 4-2.4-.8z"/>' },
    socks: { name: 'odd socks', plural: true, icon: '<path d="M4 2h4v8.5q0 2-2 3.5L4.6 15q-1.6 1-2.4-.5t.6-2.4L4 11z"/><path d="M11 2h4v8.5q0 2-2 3.5l-1.4 1q-1.6 1-2.4-.5t.6-2.4L11 11z" opacity=".6"/>' }
  };

  /* Two characters, tied to the seats so every phone shows the same player the same way. */
  var LOOKS = [
    { skin: '#8D5A3B', hair: '#1E1A17', style: 'puffs', shirt: '#F4B942', shorts: '#2E5E8C', shoes: '#2B2B2B',
      hat: '#7A3FB0', band: '#F0643C', glasses: '#14213D', scarf: '#F0643C', scarf2: '#FBF7EC', coat: '#3FA796', trim: '#25695E',
      sock1: '#E94F37', sock1b: '#FBF7EC', sock2: '#FFD23F', sock2b: '#3A86FF' },
    { skin: '#F2C9A0', hair: '#D9692A', style: 'spikes', shirt: '#9CC9EE', shorts: '#6B4E9B', shoes: '#3B2A1F',
      hat: '#2B9348', band: '#FFD23F', glasses: '#B5179E', scarf: '#3A86FF', scarf2: '#FFD23F', coat: '#F0643C', trim: '#A8401E',
      sock1: '#2B9348', sock1b: '#FBF7EC', sock2: '#F7A1C4', sock2b: '#7A3FB0' }
  ];

  function lookFor(seat) { return LOOKS[seat % LOOKS.length]; }
  function outfitFor(v) { return v.strip ? OUTFITS[v.garments] || OUTFITS[3] : QUICK_OUTFIT; }

  /* A character in SVG: the body, a face that can change mood, and the
     garments as separate groups that can be taken off. */
  function avatarSvg(L) {
    var dark = '#24160F';
    var hair = L.style === 'puffs'
      ? '<circle cx="43" cy="31" r="10" fill="' + L.hair + '"/><circle cx="77" cy="31" r="10" fill="' + L.hair + '"/>' +
        '<path d="M39 42Q41 18 60 19Q79 18 81 42Q73 30 60 30Q47 30 39 42Z" fill="' + L.hair + '"/>'
      : '<path d="M38 43L41 24L48 32L53 17L59 29L66 16L71 30L78 22L82 42Q71 31 60 31Q49 31 38 43Z" fill="' + L.hair + '"/>';
    return '<svg class="sm-av-svg" viewBox="0 0 120 170" aria-hidden="true">' +
      '<ellipse class="sm-shadow" cx="60" cy="161" rx="30" ry="5"/>' +
      '<g class="sm-body">' +
        // arms behind the sleeves, legs, shoes
        '<path d="M33 86L27 108Q26 115 32 116L35 116Q39 114 37 108L41 90Z" fill="' + L.skin + '"/>' +
        '<path d="M87 86L93 108Q94 115 88 116L85 116Q81 114 83 108L79 90Z" fill="' + L.skin + '"/>' +
        '<rect x="45" y="122" width="11" height="34" rx="5" fill="' + L.skin + '"/><rect x="64" y="122" width="11" height="34" rx="5" fill="' + L.skin + '"/>' +
        '<path d="M40 157Q40 151 47 151H54Q58 151 58 156V159H40Z" fill="' + L.shoes + '"/><path d="M62 156Q62 151 66 151H73Q80 151 80 157V159H62Z" fill="' + L.shoes + '"/>' +
        // shorts and T-shirt: these always stay on
        '<path d="M41 106H79V127H63L60 118L57 127H41Z" fill="' + L.shorts + '"/>' +
        '<path d="M41 72Q60 64 79 72L91 84L84 92L79 88V110H41V88L36 92L29 84Z" fill="' + L.shirt + '"/>' +
        '<path d="M53 68Q60 74 67 68" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="2"/>' +
        // neck, head, ears, hair
        '<rect x="55" y="61" width="10" height="10" rx="3" fill="' + L.skin + '"/>' +
        '<circle cx="39" cy="48" r="4.2" fill="' + L.skin + '"/><circle cx="81" cy="48" r="4.2" fill="' + L.skin + '"/>' +
        '<circle cx="60" cy="45" r="21.5" fill="' + L.skin + '"/>' + hair +
        // the face
        '<g class="sm-face">' +
          '<g class="sm-eyes" fill="' + dark + '"><circle cx="52" cy="46" r="2.6"/><circle cx="68" cy="46" r="2.6"/></g>' +
          '<path class="sm-brows" d="M47.5 40Q52 37.5 56 39.5M64 39.5Q68 37.5 72.5 40" fill="none" stroke="' + dark + '" stroke-width="2" stroke-linecap="round"/>' +
          '<g class="sm-blush" fill="#FF6B6B" opacity=".55"><ellipse cx="45" cy="53" rx="4.6" ry="2.8"/><ellipse cx="75" cy="53" rx="4.6" ry="2.8"/></g>' +
          '<path class="sm-m-smile" d="M53 54Q60 60 67 54" fill="none" stroke="' + dark + '" stroke-width="2.4" stroke-linecap="round"/>' +
          '<path class="sm-m-grin" d="M51 52Q60 64 69 52Z" fill="' + dark + '"/>' +
          '<ellipse class="sm-m-oh" cx="60" cy="56" rx="3.6" ry="4.6" fill="' + dark + '"/>' +
          '<path class="sm-sweat" d="M84 28Q88 34 84 38Q80 34 84 28Z" fill="#9CDBFF"/>' +
        '</g>' +
      '</g>' +
      // the garments, bottom layer first
      '<g class="gm gm-socks">' +
        '<rect x="44.3" y="131" width="12.4" height="23" rx="4" fill="' + L.sock1 + '"/>' +
        '<path d="M44.3 136.5h12.4M44.3 142.5h12.4M44.3 148.5h12.4" stroke="' + L.sock1b + '" stroke-width="2.6"/>' +
        '<rect x="63.3" y="131" width="12.4" height="23" rx="4" fill="' + L.sock2 + '"/>' +
        '<g fill="' + L.sock2b + '"><circle cx="67" cy="136" r="1.7"/><circle cx="72.5" cy="140.5" r="1.7"/><circle cx="67" cy="145" r="1.7"/><circle cx="72.5" cy="149.5" r="1.7"/></g>' +
      '</g>' +
      '<g class="gm gm-coat">' +
        '<path d="M34 70Q60 59 86 70L101 118L89 122L86 104L88 141H32L34 104L31 122L19 118Z" fill="' + L.coat + '"/>' +
        '<path d="M51 67L60 91L69 67" fill="none" stroke="' + L.trim + '" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M60 91V141" stroke="' + L.trim + '" stroke-width="1.6"/>' +
        '<g fill="' + L.trim + '"><circle cx="64" cy="102" r="2.2"/><circle cx="64" cy="115" r="2.2"/><circle cx="64" cy="128" r="2.2"/></g>' +
        '<path d="M19 118L31 122M89 122L101 118" stroke="' + L.trim + '" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M38 120h12M70 120h12" stroke="' + L.trim + '" stroke-width="2" stroke-linecap="round"/>' +
      '</g>' +
      '<g class="gm gm-scarf">' +
        '<path d="M45 63Q60 74 75 63L77 71Q60 83 43 71Z" fill="' + L.scarf + '"/>' +
        '<path d="M63 71L70 71L74 101L65 102Z" fill="' + L.scarf + '"/>' +
        '<path d="M64.6 79H71.2M65.4 87H72.2M66 95H73" stroke="' + L.scarf2 + '" stroke-width="3"/>' +
        '<path d="M65.5 102v4M68.5 102v4M71.5 101.5v4" stroke="' + L.scarf + '" stroke-width="1.6" stroke-linecap="round"/>' +
      '</g>' +
      '<g class="gm gm-glasses">' +
        '<path d="M35.5 44L32 46.5M84.5 44L88 46.5" stroke="' + L.glasses + '" stroke-width="2.2" stroke-linecap="round"/>' +
        '<rect x="35" y="38" width="22" height="15" rx="6" fill="' + L.glasses + '"/><rect x="63" y="38" width="22" height="15" rx="6" fill="' + L.glasses + '"/>' +
        '<path d="M57 44Q60 40.5 63 44" fill="none" stroke="' + L.glasses + '" stroke-width="3"/>' +
        '<path d="M39 42.5l7-2.4M67 42.5l7-2.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".75"/>' +
      '</g>' +
      '<g class="gm gm-hat">' +
        '<g transform="rotate(-8 60 22)">' +
          '<rect x="43" y="1" width="34" height="25" rx="4" fill="' + L.hat + '"/>' +
          '<rect x="43" y="17" width="34" height="5" fill="' + L.band + '"/>' +
          '<ellipse cx="60" cy="27" rx="27" ry="5" fill="' + L.hat + '"/>' +
          '<circle cx="72" cy="15" r="5" fill="#FBF7EC"/><circle cx="72" cy="15" r="2.2" fill="' + L.band + '"/>' +
        '</g>' +
      '</g>' +
    '</svg>';
  }

  function iconSvg(kind) { return '<svg viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">' + GARMENTS[kind].icon + '</svg>'; }

  function StripMeTable(app, session, me, opts) {
    opts = opts || {};
    this.app = app;
    this.session = session;
    this.me = me;
    this.lastSeq = 0;
    this.logItems = [];
    this.seats = {};
    this.v = null;
    this.first = true;
    this.quiet = !!opts.restored;
    this.flying = null;      // a garment on its way off: { pid, kind }
    this.landing = 0;
    this.auto = !!UI.store.get(AUTO_KEY, false);
    this.root = document.getElementById('screen-table');
    this.build();
    var self = this;
    this.unsub = session.on(function () { self.update(); });
    this.update();
  }

  StripMeTable.prototype.destroy = function () {
    if (this.unsub) this.unsub();
    clearTimeout(this.overTimer);
    (this.timers || []).forEach(clearTimeout);
    this.root.innerHTML = '';
    var fx = document.getElementById('fx');
    if (fx) fx.innerHTML = '';
  };

  StripMeTable.prototype.later = function (fn, ms) {
    var t = setTimeout(fn, ms);
    (this.timers = this.timers || []).push(t);
    return t;
  };

  StripMeTable.prototype.name = function (pid) {
    if (pid === this.me) return 'You';
    var p = this.session.state.players.filter(function (x) { return x.id === pid; })[0];
    return p ? UI.esc(p.name) : 'Someone';
  };
  StripMeTable.prototype.lname = function (pid) { return pid === this.me ? 'you' : this.name(pid); };
  StripMeTable.prototype.poss = function (pid) { return pid === this.me ? 'your' : this.name(pid) + '’s'; };
  StripMeTable.prototype.player = function (v, pid) { return v.players.filter(function (p) { return p.id === pid; })[0]; };
  StripMeTable.prototype.rival = function (v) { var me = this.me; return v.players.filter(function (p) { return p.id !== me; })[0]; };

  /* ---------- static layout ---------- */

  StripMeTable.prototype.seatHtml = function (p, mine) {
    var deck = '<span class="sm-stack" aria-hidden="true"><span class="card back"></span><span class="card back"></span><span class="card back"></span></span>' +
      '<b class="sm-count"></b>';
    return '<section class="sm-seat ' + (mine ? 'sm-me' : 'sm-them') + '" data-pid="' + p.id + '">' +
      '<div class="sm-fig"><span class="sm-bubble" hidden></span>' + avatarSvg(lookFor(p.seat)) + '</div>' +
      '<div class="sm-info"><span class="sm-name">' + (mine ? 'You' : UI.esc(p.name)) + '</span>' +
        '<span class="sm-wear"></span><span class="sm-chip"></span>' +
        (mine ? '<div class="sm-tools"><button class="btn sm-tool" type="button" id="s-shuffle">Shuffle</button>' +
          '<button class="btn sm-tool sm-auto" type="button" id="s-auto" aria-pressed="false"><span class="sw" aria-hidden="true"></span>Auto</button></div>' : '') +
      '</div>' +
      (mine
        ? '<button class="sm-deck mine" type="button" id="s-deck" aria-label="Your deck: tap to turn over the top card">' + deck + '<span class="sm-tap">Tap</span></button>'
        : '<div class="sm-deck" aria-hidden="true">' + deck + '</div>') +
      '</section>';
  };

  StripMeTable.prototype.build = function () {
    var v = this.session.view(this.me, { events: false });
    var self = this, me = this.me;
    var mine = this.player(v, me), them = this.rival(v);
    this.root.innerHTML =
      '<header class="topbar">' +
        '<button class="icon-btn" id="s-menu" type="button" aria-label="Game menu">' + UI.icon.menu + '</button>' +
        '<span class="wordmark">STRIP-ME</span>' +
        '<span class="chip" id="s-round"></span>' +
        '<span class="spacer"></span>' +
        '<button class="icon-btn" id="s-music" type="button"></button>' +
        '<button class="icon-btn" id="s-sound" type="button"></button>' +
      '</header>' +
      '<div class="sm-table" id="s-table">' +
        this.seatHtml(them, false) +
        '<div class="sm-mid" id="s-mid">' +
          '<div class="sm-banner" id="s-banner" style="visibility:hidden"><span class="who" id="s-banner-who">·</span><b class="what" id="s-banner-what">·</b><span class="sm-pips" id="s-pips"></span></div>' +
          '<div class="sm-pile" id="s-pile"></div>' +
          '<p class="sm-pilecount" id="s-pilecount"></p>' +
        '</div>' +
        '<div class="status" id="s-status" aria-live="polite"><p class="status-main"></p><p class="status-sub"></p></div>' +
        this.seatHtml(mine, true) +
      '</div>';

    var $ = function (sel) { return self.root.querySelector(sel); };
    [them, mine].forEach(function (p) {
      var el = $('.sm-seat[data-pid="' + p.id + '"]');
      self.seats[p.id] = {
        seat: el, fig: el.querySelector('.sm-fig'), av: el.querySelector('.sm-av-svg'), bubble: el.querySelector('.sm-bubble'),
        wear: el.querySelector('.sm-wear'), chip: el.querySelector('.sm-chip'), deck: el.querySelector('.sm-deck'),
        stack: el.querySelector('.sm-stack'), count: el.querySelector('.sm-count')
      };
    });
    this.el = {
      round: $('#s-round'), music: $('#s-music'), sound: $('#s-sound'), mid: $('#s-mid'),
      banner: $('#s-banner'), bannerWho: $('#s-banner-who'), bannerWhat: $('#s-banner-what'), pips: $('#s-pips'),
      pile: $('#s-pile'), pileCount: $('#s-pilecount'),
      statusMain: $('#s-status .status-main'), statusSub: $('#s-status .status-sub'),
      deck: $('#s-deck'), shuffle: $('#s-shuffle'), autoBtn: $('#s-auto')
    };
    this.renderAudio();

    $('#s-menu').addEventListener('click', function () { self.app.openMenu(); });
    this.el.music.addEventListener('click', function () { self.app.toggleMusic(); self.renderAudio(); });
    this.el.sound.addEventListener('click', function () { self.app.toggleSound(); self.renderAudio(); });
    // a card goes over on the press, not the release: paying four should be quick
    this.el.deck.addEventListener('pointerdown', function (e) { e.preventDefault(); self.tapDeck(); });
    this.el.deck.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); self.tapDeck(); }
    });
    this.el.shuffle.addEventListener('click', function () { self.shuffle(); });
    this.el.autoBtn.addEventListener('click', function () { self.setAuto(!self.auto); });
  };

  StripMeTable.prototype.renderAudio = function () {
    var m = UI.Music.on, s = UI.Sound.on;
    this.el.music.innerHTML = m ? UI.icon.musicOn : UI.icon.musicOff;
    this.el.music.setAttribute('aria-label', m ? 'Music on. Tap to turn it off.' : 'Music off. Tap to turn it on.');
    this.el.music.classList.toggle('off', !m);
    this.el.sound.innerHTML = s ? UI.icon.soundOn : UI.icon.soundOff;
    this.el.sound.setAttribute('aria-label', s ? 'Sound effects on. Tap to mute.' : 'Sound effects off. Tap to turn on.');
    this.el.sound.classList.toggle('off', !s);
  };

  /* ---------- update cycle ---------- */

  StripMeTable.prototype.update = function () {
    var v = this.session.view(this.me, { sinceSeq: this.lastSeq });
    var events = v.events || [];
    this.v = v;
    var pre = (events.length && !this.quiet) ? this.capture() : null;
    var self = this;
    // a garment that's coming off stays on until its little sequence plays
    if (!this.quiet) events.forEach(function (e) { if (e.type === 'roundEnd' && e.garment) self.flying = { pid: e.loser, garment: e.garment }; });
    this.render(v);
    if (pre) this.animate(events, pre, v);
    if (!this.quiet) this.react(events, v);
    events.forEach(function (e) { self.logEvent(e, v); });
    if (events.length) this.lastSeq = events[events.length - 1].seq;
    this.first = false;
    this.quiet = false;
    if (this.app.logOpen) this.app.renderLog();

    if (v.phase === 'over' && !this.overShown) {
      this.overShown = true;
      this.overTimer = setTimeout(function () { self.app.showResult(self.v); }, events.length ? 3600 : 200);
    }
  };

  /* Where things are before the screen changes. */
  StripMeTable.prototype.capture = function () {
    var pre = { pile: this.el.pile.getBoundingClientRect(), decks: {} };
    for (var pid in this.seats) pre.decks[pid] = this.seats[pid].stack.getBoundingClientRect();
    return pre;
  };

  /* Cards flying: from a deck to the pile, the pile to whoever takes it, and the deal. */
  StripMeTable.prototype.animate = function (events, pre, v) {
    var self = this;
    events.forEach(function (e) {
      if (e.type === 'play') {
        var top = self.el.pile.lastElementChild;
        if (!top) return;
        var n = ++self.landing;
        top.style.visibility = 'hidden';
        UI.fly({ fromRect: pre.decks[e.player], to: top, card: e.card, duration: 230, spin: e.player === self.me ? -6 : 6 }).then(function () {
          if (self.landing === n && top.parentNode) top.style.visibility = '';
        });
      } else if (e.type === 'pickup') {
        var to = self.seats[e.player] && self.seats[e.player].stack;
        for (var i = 0; i < Math.min(6, e.count); i++) UI.fly({ fromRect: pre.pile, to: to, card: null, delay: i * 60, duration: 380 });
      } else if (e.type === 'deal') {
        var ids = v.players.map(function (p) { return p.id; });
        for (var j = 0; j < 10; j++) {
          var s = self.seats[ids[j % 2]];
          UI.fly({ fromRect: pre.pile, to: s && s.stack, card: null, delay: j * 70, duration: 320 });
        }
      }
    });
  };

  /* ---------- rendering ---------- */

  StripMeTable.prototype.render = function (v) {
    this.el.round.textContent = v.strip ? 'Round ' + v.round : 'Quick Play';
    var self = this;
    v.players.forEach(function (p) { self.renderSeat(v, p); });
    this.renderMid(v);
    this.renderStatus(v);
    this.renderControls(v);
  };

  StripMeTable.prototype.renderSeat = function (v, p) {
    var s = this.seats[p.id];
    if (!s) return;
    var outfit = outfitFor(v);
    // garments already off; one on its way off stays until its sequence plays
    var off = v.strip ? p.lost : 0;
    if (this.flying && this.flying.pid === p.id) off = Math.min(off, this.flying.garment - 1);
    ['hat', 'glasses', 'scarf', 'coat', 'socks'].forEach(function (kind) {
      var at = outfit.indexOf(kind);
      var g = s.av.querySelector('.gm-' + kind);
      var on = at >= 0 && at >= off;
      if (!g.classList.contains('flying')) g.classList.toggle('off', !on);
    });
    // what's still on, as little icons (Strip Mode)
    var wearKey = v.strip ? outfit.join(',') + ':' + off : '';
    if (s.wearKey !== wearKey) {
      s.wearKey = wearKey;
      s.wear.innerHTML = v.strip ? outfit.map(function (kind, i) {
        return '<span class="sm-g' + (i < off ? ' lost' : '') + '" title="' + GARMENTS[kind].name + '">' + iconSvg(kind) + '</span>';
      }).join('') : '';
      s.wear.setAttribute('aria-label', v.strip ? (outfit.length - off) + ' of ' + outfit.length + ' garments left' : '');
    }
    s.count.textContent = String(p.count);
    s.deck.classList.toggle('empty', p.count === 0);
    s.stack.querySelectorAll('.card').forEach(function (c, i) { c.style.visibility = p.count > i ? '' : 'hidden'; });
    var turn = v.phase === 'play' && v.turn === p.id;
    s.seat.classList.toggle('is-turn', turn);
    s.seat.classList.toggle('is-paying', turn && v.owe > 0);
    var chip = '', tone = '';
    if (p.idle) { chip = 'on autopilot'; tone = 'warn'; }
    else if (turn && v.owe) { chip = 'paying · ' + v.owe + ' to go'; tone = 'hot'; }
    else if (turn) { chip = p.id === this.me ? 'your turn' : 'turning over'; tone = 'hot'; }
    else if (v.phase === 'pickup' && v.taker === p.id) { chip = 'takes the pile'; tone = 'warn'; }
    if (s.chip.textContent !== chip) s.chip.textContent = chip;
    s.chip.className = 'sm-chip' + (tone ? ' ' + tone : '');
  };

  StripMeTable.prototype.renderMid = function (v) {
    // the banner: an Action Card being paid for, the pile being taken, or the round's result
    var who = '', what = '', pips = '';
    var d = v.demand;
    if (v.phase === 'dealing') { who = 'Round ' + v.round; what = '26 cards each'; }
    else if (v.phase === 'pickup' && v.taker) {
      who = 'No Action Card';
      what = v.taker === this.me ? 'You take the pile' : this.name(v.taker) + ' takes the pile';
    } else if ((v.phase === 'roundOver' || v.phase === 'over') && v.result) {
      who = v.strip ? 'Round ' + v.result.round : 'Quick Play';
      what = v.result.winner === this.me ? 'You win the round!' : this.name(v.result.winner) + ' wins the round';
    } else if (v.phase === 'play' && d) {
      var payer = d.by === this.me ? this.rival(v).id : this.me;
      who = this.poss(d.by).replace(/^your/, 'Your') + ' ' + RANK_NAME[d.rank];
      what = (payer === this.me ? 'You pay ' : this.name(payer) + ' pays ') + d.n;
      for (var i = 0; i < d.n; i++) pips += '<i class="' + (i < d.n - v.owe ? 'paid' : '') + '"></i>';
    }
    var key = who + '|' + what;
    this.el.banner.style.visibility = who ? '' : 'hidden';
    if (this.bannerKey !== key) {
      this.bannerKey = key;
      this.el.bannerWho.textContent = who || '·';
      this.el.bannerWhat.textContent = what || '·';
      if (who && !this.quiet) { this.el.banner.classList.remove('pop'); void this.el.banner.offsetWidth; this.el.banner.classList.add('pop'); }
    }
    if (this.el.pips.innerHTML !== pips) this.el.pips.innerHTML = pips;
    this.el.banner.classList.toggle('hot', !!d && v.phase === 'play');

    // the pile: the last few cards, the newest on top
    var top = v.pileTop.slice(-3);
    var pileKey = top.map(function (c) { return c.id; }).join(',') + ':' + v.pileCount;
    if (this.pileKey !== pileKey) {
      this.pileKey = pileKey;
      var box = this.el.pile;
      box.innerHTML = '';
      top.forEach(function (c, i) {
        var el = UI.makeCard(c);
        var h = 0;
        for (var k = 0; k < c.id.length; k++) h = (h * 31 + c.id.charCodeAt(k)) % 997;
        el.style.setProperty('--tilt', ((h % 17) - 8) + 'deg');
        el.style.setProperty('--dx', ((h % 11) - 5) + 'px');
        el.classList.toggle('action', !!OWED[c.rank]);
        el.classList.toggle('top', i === top.length - 1);
        box.appendChild(el);
      });
      box.classList.toggle('empty', !top.length);
    }
    this.el.pileCount.textContent = v.pileCount ? (v.pileCount === 1 ? '1 card in the pile' : v.pileCount + ' cards in the pile') : (v.phase === 'play' ? 'The pile is empty' : '');
  };

  StripMeTable.prototype.statusFor = function (v) {
    var me = this.me, them = this.rival(v), mine = this.player(v, me);
    var secs = ' <span class="secs"></span>';
    var d = v.demand;
    switch (v.phase) {
      case 'dealing':
        return { main: 'Round ' + v.round + ': dealing…', sub: '26 cards each, face down. ' + (v.starter === me ? 'You start.' : this.name(v.starter) + ' starts.') };
      case 'play':
        if (v.turn === me) {
          if (mine && mine.idle) return { main: '<span class="em">Your cards are turning over by themselves.</span>', sub: 'Tap your deck to take over.' };
          if (v.owe) return {
            main: '<span class="hl">Pay up:</span> ' + (v.owe === 1 ? 'one more card.' : NUM[v.owe] + ' more cards.') + secs,
            sub: 'Turn up a Jack, Queen, King or Ace and ' + this.name(them.id) + ' pays instead.'
          };
          return { main: (this.auto ? '<span class="hl">Auto</span> is turning your cards over.' : '<span class="hl">Your turn.</span> Tap your deck.') + secs,
            sub: v.canShuffle && !this.auto ? 'You may shuffle your deck first.' : '' };
        }
        if (v.owe) return { main: this.name(v.turn) + ' is paying: ' + (v.owe === 1 ? 'one more card…' : NUM[v.owe] + ' more cards…'),
          sub: 'If no Action Card turns up, ' + this.name(v.turn) + ' takes the pile.' };
        return { main: this.name(v.turn) + '’s turn…', sub: d ? '' : (them && them.idle ? this.name(them.id) + ' is on autopilot.' : '') };
      case 'pickup':
        return { main: v.taker === me ? '<span class="em">You take the pile:</span> ' + v.pileCount + ' cards.' : this.name(v.taker) + ' takes the pile: ' + v.pileCount + ' cards.',
          sub: 'They go under ' + (v.taker === me ? 'your' : 'the') + ' deck. ' + (d && d.by === me ? 'You start again.' : (d ? this.name(d.by) + ' starts again.' : '')) };
      case 'roundOver':
      case 'over': {
        var r = v.result;
        if (!r) return { main: '', sub: '' };
        var won = r.winner === me;
        var main = won ? '<span class="hl">Your deck is empty!</span>' : this.name(r.winner) + '’s deck is empty first.';
        var sub = '';
        if (v.strip && r.garment) {
          var kind = outfitFor(v)[r.garment - 1];
          var g = GARMENTS[kind];
          sub = 'Off ' + (g.plural ? 'come ' : 'comes ') + this.poss(r.loser) + ' ' + g.name + '!';
          if (v.phase === 'over') sub += r.loser === me ? ' That was your last one.' : ' That was the last one.';
        } else if (v.phase === 'over') sub = won ? 'You win the game.' : this.name(r.winner) + ' wins the game.';
        return { main: main, sub: sub };
      }
    }
    return { main: '', sub: '' };
  };

  StripMeTable.prototype.renderStatus = function (v) {
    var st = this.statusFor(v);
    var key = st.main + '|' + st.sub;
    if (this.statusKey === key) return;
    this.statusKey = key;
    this.el.statusMain.innerHTML = st.main;
    this.el.statusSub.innerHTML = st.sub || '';
  };

  StripMeTable.prototype.renderControls = function (v) {
    var deck = this.el.deck;
    deck.classList.toggle('ready', !!v.canPlay);
    deck.classList.toggle('paying', !!v.canPlay && v.owe > 0);
    this.el.shuffle.disabled = !v.canShuffle;
    this.el.autoBtn.setAttribute('aria-pressed', String(this.auto));
    this.el.autoBtn.classList.toggle('on', this.auto);
  };

  /* ~60×/s from the app loop: Auto, and the seconds when time is short. */
  StripMeTable.prototype.frame = function () {
    var v = this.v;
    if (!v) return;
    var now = this.session.now();
    if (this.auto && v.canPlay && !this.sending) {
      var key = v.round + ':' + v.plays + ':' + v.owe;
      if (this.autoKey !== key) { this.autoKey = key; this.autoAt = performance.now() + AUTO_MS; }
      else if (performance.now() >= this.autoAt) { this.autoAt = Infinity; this.play(true); }
    }
    var span = this.el.statusMain.querySelector('.secs');
    if (span) {
      var left = v.turn === this.me && v.turnEndsAt ? Math.max(0, v.turnEndsAt - now) : null;
      var sec = left == null ? null : Math.ceil(left / 1000);
      span.textContent = sec != null && left <= 5000 && !this.auto ? '· ' + sec + 's' : '';
      if (sec !== this.lastSecs) { this.lastSecs = sec; if (sec != null && left <= 3000 && sec > 0 && !this.auto) UI.Sound.play('tick'); }
    }
  };

  /* ---------- input ---------- */

  StripMeTable.prototype.send = function (type, payload, then) {
    if (this.sending) return;
    var self = this;
    this.sending = true;
    var finish = function (res) { self.sending = false; if (then) then(res); };
    var res = this.session.act(this.me, type, payload, finish);
    if (!res || !res.pending) finish(res);
  };

  StripMeTable.prototype.tapDeck = function () {
    UI.Sound.unlock();
    var v = this.v;
    if (!v) return;
    if (!v.canPlay) {
      this.nudge(this.el.deck);
      if (v.phase === 'play' && v.turn !== this.me && !this.waitToast) {
        this.waitToast = true;
        UI.toast('Wait for ' + this.name(v.turn) + '.');
        var self = this;
        this.later(function () { self.waitToast = false; }, 2500);
      }
      return;
    }
    this.play(false);
  };

  StripMeTable.prototype.play = function (auto) {
    var self = this;
    if (!auto) UI.buzz(8);
    this.send('play', {}, function (res) {
      if (!res.ok && res.code !== 'turn' && res.code !== 'phase') UI.toast(UI.esc(res.message));
      if (res.ok) self.autoKey = null;
    });
  };

  StripMeTable.prototype.shuffle = function () {
    UI.Sound.unlock();
    var self = this;
    this.send('shuffle', {}, function (res) {
      if (!res.ok) { UI.toast(UI.esc(res.message)); return; }
      self.autoKey = null;
    });
  };

  StripMeTable.prototype.setAuto = function (on) {
    UI.Sound.unlock();
    this.auto = on;
    this.autoKey = null;
    UI.store.set(AUTO_KEY, on);
    if (this.v) { this.renderControls(this.v); this.renderStatus(this.v); }
    UI.toast(on ? 'Auto is on: your cards turn over by themselves.' : 'Auto is off: tap your deck to play.');
  };

  StripMeTable.prototype.nudge = function (el) {
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
  };

  /* ---------- the strip sequence ---------- */

  StripMeTable.prototype.mood = function (pid, mood, ms) {
    var s = this.seats[pid];
    if (!s) return;
    s.av.classList.remove('mood-shock', 'mood-grin', 'mood-blush');
    if (mood) s.av.classList.add('mood-' + mood);
    var self = this;
    if (ms) this.later(function () { if (s.av.classList.contains('mood-' + mood)) s.av.classList.remove('mood-' + mood); }, ms);
    void self;
  };

  StripMeTable.prototype.say = function (pid, text, ms) {
    var s = this.seats[pid];
    if (!s) return;
    s.bubble.textContent = text;
    s.bubble.hidden = false;
    s.bubble.classList.remove('pop'); void s.bubble.offsetWidth; s.bubble.classList.add('pop');
    clearTimeout(s.sayTimer);
    s.sayTimer = this.later(function () { s.bubble.hidden = true; }, ms || 1600);
  };

  StripMeTable.prototype.bounce = function (pid, cls, ms) {
    var s = this.seats[pid];
    if (!s) return;
    s.fig.classList.remove(cls); void s.fig.offsetWidth; s.fig.classList.add(cls);
    this.later(function () { s.fig.classList.remove(cls); }, ms);
  };

  /* The loser blushes, the garment flies off with a boing, they shiver; the winner cheers. */
  StripMeTable.prototype.stripSequence = function (e, v) {
    var self = this, loser = e.loser, winner = e.winner;
    var kind = outfitFor(v)[e.garment - 1];
    var s = this.seats[loser];
    this.mood(winner, 'grin', 3200);
    this.bounce(winner, 'cheer', 1100);
    this.mood(loser, 'shock');
    this.say(loser, e.final ? 'Nooo!' : ['Oh no!', 'Eek!', 'Hey!', 'Not that!'][e.round % 4], 1400);
    this.later(function () {
      var g = s && s.av.querySelector('.gm-' + kind);
      if (g) { g.classList.add('flying', 'fly-' + kind); }
      UI.Sound.play('boing');
      self.later(function () { UI.Sound.play('whoosh'); }, 180);
    }, 650);
    this.later(function () {
      var g = s && s.av.querySelector('.gm-' + kind);
      if (g) { g.classList.remove('flying', 'fly-' + kind); g.classList.add('off'); }
      if (self.flying && self.flying.pid === loser) self.flying = null;
      if (self.v) self.renderSeat(self.v, self.player(self.v, loser));
      self.mood(loser, e.final ? 'shock' : 'blush', e.final ? 0 : 2400);
      self.bounce(loser, 'shiver', 1300);
      self.say(loser, e.final ? 'That’s my last one!' : 'Brrr!', 1500);
    }, 1750);
  };

  /* ---------- sounds and notices ---------- */

  StripMeTable.prototype.react = function (events, v) {
    var me = this.me, self = this;
    events.forEach(function (e) {
      switch (e.type) {
        case 'deal': UI.Sound.play('riffle'); break;
        case 'play':
          if (e.demand) {
            UI.Sound.play('action');
            if (e.player !== me) { UI.buzz(30); self.say(e.player, e.cancelled ? 'Ha! Your turn!' : 'Pay up!', 1100); }
            else self.say(e.player, e.cancelled ? 'Saved!' : 'Pay up!', 1000);
          } else UI.Sound.play('flip');
          break;
        case 'paid':
          UI.Sound.play(e.player === me ? 'nope' : 'win');
          self.mood(e.player, 'shock', 1500);
          self.mood(e.by, 'grin', 1500);
          break;
        case 'pickup': UI.Sound.play('draw'); break;
        case 'shuffle':
          UI.Sound.play('riffle');
          var s = self.seats[e.player];
          if (s) { s.stack.classList.remove('shuffling'); void s.stack.offsetWidth; s.stack.classList.add('shuffling'); }
          if (e.player !== me) self.say(e.player, 'For luck!', 1000);
          break;
        case 'roundEnd':
          UI.Sound.play(e.winner === me ? 'win' : 'lose');
          if (e.garment) self.stripSequence(e, v);
          else { self.mood(e.winner, 'grin', 3000); self.mood(e.loser, 'shock', 3000); self.bounce(e.winner, 'cheer', 1100); }
          break;
        case 'gameOver':
          self.later(function () { UI.Sound.play(e.winners.indexOf(me) >= 0 ? 'victory' : 'lose'); }, 2600);
          break;
        case 'timeout':
          if (e.player === me) { UI.toast('Time’s up: your cards turn over by themselves until you tap your deck.'); UI.Sound.play('nope'); }
          break;
      }
    });
  };

  /* ---------- play-by-play: the moments that matter, not every card ---------- */

  StripMeTable.prototype.pushLog = function (html, cls) {
    var item = { html: html, cls: cls || '' };
    this.logItems.push(item);
    if (this.logItems.length > 600) this.logItems.shift();
    return item;
  };

  StripMeTable.prototype.logEvent = function (e, v) {
    var me = this.me, self = this;
    var N = function (pid) { return self.name(pid); };
    switch (e.type) {
      case 'deal':
        this.pushLog((v.strip ? 'Round ' + e.round + ': ' : '') + '26 cards each, face down. ' + (e.starter === me ? 'You start.' : N(e.starter) + ' starts.'), 'set');
        break;
      case 'play':
        if (e.demand) {
          var payer = e.player === me ? 'the other player' : 'you';
          payer = e.player === me ? N(this.rival(v).id) : 'you';
          this.pushLog((e.player === me ? 'You turned over ' : N(e.player) + ' turned over ') + UI.cardText(e.card) +
            (e.cancelled ? ' while paying: the rest is cancelled, and ' : ': ') + payer + (payer === 'you' ? ' pay ' : ' pays ') + e.demand + '.');
        }
        if (e.last) this.pushLog((e.player === me ? 'You turned over your last card.' : N(e.player) + ' turned over their last card.'), 'win');
        break;
      case 'pickup':
        this.pushLog((e.player === me ? 'You take the pile: ' : N(e.player) + ' takes the pile: ') + e.count + ' cards. ' +
          (e.player === me ? 'Your deck: ' : N(e.player) + '’s deck: ') + e.counts[e.player] + '.');
        break;
      case 'shuffle':
        this.pushLog((e.player === me ? 'You shuffled your deck.' : N(e.player) + ' shuffled their deck.'));
        break;
      case 'timeout':
        this.pushLog((e.player === me ? 'Your time ran out: your cards turn over by themselves.' : N(e.player) + '’s time ran out.'));
        break;
      case 'roundEnd': {
        var text = (e.winner === me ? 'You win' : N(e.winner) + ' wins') + (v.strip ? ' round ' + e.round : ' the round') + ' after ' + e.plays + ' cards.';
        if (e.garment) {
          var g = GARMENTS[outfitFor(v)[e.garment - 1]];
          text += ' Off ' + (g.plural ? 'come ' : 'comes ') + this.poss(e.loser) + ' ' + g.name + '.';
        }
        this.pushLog(text, 'win');
        break;
      }
      case 'gameOver':
        this.pushLog((e.winners[0] === me ? 'You win the game.' : N(e.winners[0]) + ' wins the game.'), 'win');
        break;
    }
  };

  /* ---------- end of game ---------- */

  StripMeTable.prototype.result = function (v) {
    var me = this.me, self = this;
    var w = v.winners && v.winners[0];
    var loser = v.players.filter(function (p) { return p.id !== w; })[0];
    var outfit = outfitFor(v);
    var why = v.strip
      ? (loser.id === me ? 'You lost all ' + v.garments + ' garments.' : this.name(loser.id) + ' lost all ' + v.garments + ' garments.')
      : (w === me ? 'Your deck was empty first.' : this.name(w) + '’s deck was empty first.');
    var cards = v.players.map(function (p) {
      var left = v.strip ? outfit.length - p.lost : null;
      return '<div class="sm-final' + (p.id === w ? ' champ' : '') + '" data-pid="' + p.id + '"><div class="sm-final-fig">' + avatarSvg(lookFor(p.seat)) + '</div>' +
        '<b>' + (p.id === me ? 'You' : UI.esc(p.name)) + '</b><span>' +
        (v.strip ? (left ? left + ' of ' + outfit.length + ' garments on' : 'no garments left') : (p.id === w ? 'empty deck' : p.count + ' cards left')) + '</span></div>';
    }).join('');
    return {
      when: v.strip ? v.round + ' round' + (v.round === 1 ? '' : 's') : 'Quick Play',
      why: why,
      body: '<div class="sm-finals">' + cards + '</div>',
      after: function (sheet) {
        // dress the two figures as they ended up
        v.players.forEach(function (p) {
          var fig = sheet.querySelector('.sm-final[data-pid="' + p.id + '"] svg');
          if (!fig) return;
          var off = v.strip ? p.lost : 0;
          ['hat', 'glasses', 'scarf', 'coat', 'socks'].forEach(function (kind) {
            var at = outfit.indexOf(kind);
            fig.querySelector('.gm-' + kind).classList.toggle('off', !(at >= 0 && at >= off));
          });
          fig.classList.add(p.id === w ? 'mood-grin' : 'mood-shock');
        });
        void self;
      }
    };
  };

  CT.UI.presenters = CT.UI.presenters || {};
  CT.UI.presenters.stripme = StripMeTable;
})(window.CT);
