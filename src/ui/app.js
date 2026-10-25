/* ==========================================================================
   APP SHELL — menu, setup, sheets, saving, and the game loop.
   Mode-agnostic: the home screen lists every registered mode, the setup
   screen is generated from the mode's option list, and the table screen is
   whichever presenter the mode names.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var SAVE_KEY = 'cardtable.save.v1';
  var SETTINGS_KEY = 'cardtable.settings.v1';
  var STATS_KEY = 'cardtable.stats.v1';
  var BOT_NAMES = ['Mia', 'Dex', 'Rae', 'Kofi', 'Tess', 'Jun', 'Nia', 'Omar', 'Lena', 'Ravi', 'Zoe', 'Ike'];
  var PAINTS = ['#F4B942', '#F0643C', '#7FD1C1', '#9CC9EE', '#EBDDBB'];

  function $(id) { return document.getElementById(id); }

  function pickNames(n) {
    var pool = BOT_NAMES.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, n);
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  var App = {
    settings: {},
    stats: {},
    session: null,
    table: null,
    game: null,
    screen: 'home',
    sheet: null,
    logOpen: false,

    boot: function (data) {
      var self = this;
      this.settings = UI.store.get(SETTINGS_KEY, {}) || {};
      this.migrateSettings();
      this.stats = UI.store.get(STATS_KEY, {}) || {};
      UI.Sound.on = this.settings.sound !== false;
      UI.Music.on = this.settings.music !== false;

      // Browsers only allow audio after a tap; start the music on the first one.
      document.addEventListener('pointerdown', function () {
        UI.Sound.unlock();
        if (UI.Music.on && !UI.Music.playing) UI.Music.start();
      }, true);
      document.addEventListener('visibilitychange', function () { self.onVisibility(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && self.sheet && self.sheet !== 'result') self.closeSheet(); });
      $('overlay').addEventListener('click', function (e) { if (e.target === this && self.sheet !== 'confirm') self.closeSheet(); });
      setInterval(function () { self.loop(); }, 50);
      setInterval(function () { self.save(); }, 2500);

      var hot = window.claude && window.claude.hot;
      if (hot && typeof hot.snapshot === 'function') {
        try { hot.snapshot(function () { return self.snapshot(); }); } catch (e) { /* optional */ }
      }

      data = data || {};
      if (data.save && data.screen === 'table' && this.resume(data.save)) return;
      this.showHome();
    },

    snapshot: function () {
      return { save: this.currentSave(), screen: this.screen };
    },

    /* Setup saves only the choices you actually tap, so when a default changes
       in an update it reaches everyone who never picked otherwise. Versions
       before 0.4 saved every rule; keep only values that differ from anything
       that has been the default. */
    migrateSettings: function () {
      var s = this.settings;
      if (s.format >= 2) return;
      CT.listModes().forEach(function (m) {
        var cfg = s[m.id];
        if (!cfg || typeof cfg !== 'object') return;
        if (cfg.opponents === m.players.default - 1) delete cfg.opponents;
        var kept = {};
        (m.options || []).forEach(function (o) {
          var v = cfg.options ? cfg.options[o.id] : undefined;
          if (v == null || v === o.default || (o.formerDefaults || []).indexOf(v) >= 0) return;
          kept[o.id] = v;
        });
        cfg.options = kept;
      });
      s.format = 2;
      UI.store.set(SETTINGS_KEY, s);
    },

    /* ---------- screens ---------- */

    show: function (name) {
      this.screen = name;
      ['home', 'setup', 'table'].forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    },

    showHome: function () {
      var self = this;
      if (this.session && this.session.state.phase !== 'over') { this.session.pause(); this.save(); }
      this.show('home');
      var save = this.loadSave();
      var modes = CT.listModes();
      var html =
        '<header class="home-head"><p class="eyebrow">Card table</p>' +
        '<span class="spacer"></span>' +
        '<button class="icon-btn" id="h-music" type="button"></button>' +
        '<button class="icon-btn" id="h-sound" type="button"></button></header>' +
        '<h1 class="home-title">Pick a game</h1>';
      if (save) {
        var st = save.session.state;
        var mine = st.players.filter(function (p) { return p.id === save.me; })[0];
        var mode = CT.getMode(save.session.modeId);
        html += '<div class="resume"><p>' + UI.esc(mode ? mode.name : 'Game') + ' in progress' +
          '<small>' + (st.setNo ? 'Set ' + st.setNo : 'Just dealt') + ' · you hold ' + (mine ? mine.hand.length : 0) + ' cards · ' + (st.players.length - 1) + ' opponents</small></p>' +
          '<button class="btn btn-primary" id="h-resume" type="button">Resume</button></div>';
      }
      html += '<section class="modes">';
      modes.forEach(function (m) {
        var hand = m.handSize ? ' · ' + m.handSize + ' cards each' : '';
        html += '<article class="mode-tile" data-mode="' + m.id + '">' +
          '<div class="mode-top"><h2 class="wordmark">' + UI.esc(m.name.toUpperCase()) + '</h2><div class="fan" aria-hidden="true"></div></div>' +
          '<p class="tag">' + UI.esc(m.tagline || '') + '</p>' +
          '<p class="meta">' + m.players.min + '–' + m.players.max + ' players' + hand + ' · you vs computer players</p>' +
          '<div class="mode-actions"><button class="btn btn-primary" type="button" data-play="' + m.id + '">Play ' + UI.esc(m.name) + '</button>' +
          '<button class="btn btn-ghost" type="button" data-rules="' + m.id + '">How to play</button></div>' +
          '</article>';
      });
      html += '<article class="mode-tile soon"><h3>More games</h3><p>New modes appear here as their rules are added.</p></article></section>';
      var lines = modes.map(function (m) {
        var s = self.stats[m.id];
        if (!s || !s.played) return '';
        return UI.esc(m.name) + ': <b>' + s.won + '</b> ' + (s.won === 1 ? 'win' : 'wins') + ' from <b>' + s.played + '</b> ' + (s.played === 1 ? 'game' : 'games');
      }).filter(Boolean);
      if (lines.length) html += '<p class="record">Your record · ' + lines.join(' · ') + '</p>';
      if (CT.BUILD) html += '<p class="build">Version ' + UI.esc(CT.BUILD.version) + ' · build ' + UI.esc(CT.BUILD.id) + '</p>';
      var home = $('screen-home');
      home.innerHTML = html;

      // decorative fan of cards on each tile
      home.querySelectorAll('.fan').forEach(function (fan) {
        [{ id: 'QS', rank: 'Q', suit: 'S' }, { id: '9D', rank: '9', suit: 'D' }, { id: 'AH', rank: 'A', suit: 'H' }].forEach(function (c) {
          fan.appendChild(UI.makeCard(c));
        });
      });
      var snd = $('h-sound'), mus = $('h-music');
      var paintAudio = function () {
        mus.innerHTML = UI.Music.on ? UI.icon.musicOn : UI.icon.musicOff;
        mus.setAttribute('aria-label', UI.Music.on ? 'Music on. Tap to turn it off.' : 'Music off. Tap to turn it on.');
        mus.classList.toggle('off', !UI.Music.on);
        snd.innerHTML = UI.Sound.on ? UI.icon.soundOn : UI.icon.soundOff;
        snd.setAttribute('aria-label', UI.Sound.on ? 'Sound effects on. Tap to mute.' : 'Sound effects off. Tap to turn on.');
        snd.classList.toggle('off', !UI.Sound.on);
      };
      paintAudio();
      mus.addEventListener('click', function () { self.toggleMusic(); paintAudio(); });
      snd.addEventListener('click', function () { self.toggleSound(); paintAudio(); });
      if (save) $('h-resume').addEventListener('click', function () { self.resume(save); });
      home.querySelectorAll('[data-play]').forEach(function (b) {
        b.addEventListener('click', function () { self.openSetup(b.dataset.play); });
      });
      home.querySelectorAll('[data-rules]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = CT.getMode(b.dataset.rules);
          self.openRules(m.id, CT.resolveOptions(m.options, (self.settings[m.id] || {}).options));
        });
      });
    },

    modeSettings: function (mode) {
      var cfg = this.settings[mode.id] || {};
      return {
        opponents: clamp(cfg.opponents != null ? cfg.opponents : mode.players.default - 1, mode.players.min - 1, mode.players.max - 1),
        options: CT.resolveOptions(mode.options, cfg.options)
      };
    },

    openSetup: function (modeId) {
      var self = this;
      var mode = CT.getMode(modeId);
      var cfg = this.modeSettings(mode);
      this.show('setup');
      var opp = '';
      for (var n = mode.players.min - 1; n <= mode.players.max - 1; n++) {
        opp += '<button type="button" data-opp="' + n + '" aria-pressed="' + (n === cfg.opponents) + '">' + n + '</button>';
      }
      var opts = (mode.options || []).map(function (o) {
        var segs = o.choices.map(function (c) {
          return '<button type="button" data-opt="' + o.id + '" data-val="' + c.value + '" aria-pressed="' + (cfg.options[o.id] === c.value) + '">' + UI.esc(c.label) + '</button>';
        }).join('');
        return '<section class="field"><h3 id="lbl-' + o.id + '">' + UI.esc(o.label) + '</h3>' +
          '<div class="seg" role="group" aria-labelledby="lbl-' + o.id + '">' + segs + '</div>' +
          '<p class="help" id="help-' + o.id + '"></p></section>';
      }).join('');
      $('screen-setup').innerHTML =
        '<header class="setup-head"><button class="icon-btn" id="s-back" type="button" aria-label="Back to games">' + UI.icon.back + '</button>' +
        '<span class="wordmark">' + UI.esc(mode.name.toUpperCase()) + '</span></header>' +
        '<div class="setup-body">' +
          '<section class="field"><h3 id="lbl-opp">Opponents</h3><div class="seg" role="group" aria-labelledby="lbl-opp">' + opp + '</div>' +
          '<p class="help" id="help-opp"></p></section>' +
          '<p class="eyebrow">Rule choices</p>' + opts +
        '</div>' +
        '<div class="setup-foot"><button class="btn btn-primary btn-wide" id="s-deal" type="button">Deal</button>' +
        '<button class="link-btn" id="s-rules" type="button">How to play</button></div>';

      var paint = function () {
        var c = self.modeSettings(mode);
        $('screen-setup').querySelectorAll('[data-opp]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.opp === c.opponents)); });
        $('help-opp').textContent = c.opponents + ' computer ' + (c.opponents === 1 ? 'player' : 'players') + ' join you, ' + (c.opponents + 1) + ' at the table.';
        (mode.options || []).forEach(function (o) {
          $('screen-setup').querySelectorAll('[data-opt="' + o.id + '"]').forEach(function (b) { b.setAttribute('aria-pressed', String(c.options[o.id] === b.dataset.val)); });
          var choice = o.choices.filter(function (x) { return x.value === c.options[o.id]; })[0];
          $('help-' + o.id).textContent = choice ? choice.help : '';
        });
      };
      var store = function (patch) {
        // only what was tapped; untouched rules follow the defaults
        var saved = self.settings[mode.id] || {};
        var next = { opponents: saved.opponents, options: Object.assign({}, saved.options) };
        if (patch.opponents != null) next.opponents = patch.opponents;
        if (patch.opt) next.options[patch.opt] = patch.val;
        self.settings[mode.id] = next;
        UI.store.set(SETTINGS_KEY, self.settings);
        paint();
      };
      paint();
      $('screen-setup').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.opp != null) store({ opponents: +b.dataset.opp });
        else if (b.dataset.opt) store({ opt: b.dataset.opt, val: b.dataset.val });
      });
      $('s-back').addEventListener('click', function () { self.showHome(); });
      $('s-rules').addEventListener('click', function () { self.openRules(mode.id, self.modeSettings(mode).options); });
      $('s-deal').addEventListener('click', function () {
        UI.Sound.unlock();
        var c = self.modeSettings(mode);
        self.startGame(mode.id, { opponents: c.opponents, options: c.options });
      });
    },

    /* ---------- games ---------- */

    startGame: function (modeId, cfg) {
      var names = cfg.names && cfg.names.length === cfg.opponents ? cfg.names : pickNames(cfg.opponents);
      var players = [{ id: 'p0', name: 'You', isBot: false }].concat(names.map(function (n, i) {
        return { id: 'p' + (i + 1), name: n, isBot: true };
      }));
      var session = new CT.Session({
        modeId: modeId,
        players: players,
        options: cfg.options,
        seed: (Math.random() * 4294967296) >>> 0
      });
      this.game = { modeId: modeId, opponents: cfg.opponents, options: cfg.options, names: names };
      this.attach(session, false);
    },

    attach: function (session, restored) {
      this.closeSheet(true);
      if (this.table) this.table.destroy();
      this.session = session;
      this.recorded = session.state.phase === 'over';
      this.show('table');
      var Presenter = UI.presenters[session.mode.presenter];
      this.table = new Presenter(this, session, 'p0', { restored: restored });
      session.resume();
      this.save();
    },

    /* ---------- tutorial ---------- */

    startTutorial: function (modeId) {
      var Tutorial = UI.tutorials && UI.tutorials[modeId];
      if (!Tutorial) return;
      if (this.session && !this.tutorial) this.save();   // a game in progress stays resumable
      this.closeSheet(true);
      this.tutorial = new Tutorial(this);
      this.tutorial.start();
    },

    attachTutorial: function (session) {
      if (this.table) this.table.destroy();
      this.session = session;
      this.show('table');
      var Presenter = UI.presenters[session.mode.presenter];
      this.table = new Presenter(this, session, 'p0', { restored: true });
    },

    endTutorial: function (to) {
      this.tutorial = null;
      this.closeSheet(true);
      if (this.table) this.table.destroy();
      this.table = null;
      this.session = null;
      if (to === 'setup') this.openSetup('burns');
      else this.showHome();
    },

    /* Let the game clock run, unless something is in the way. */
    resumePlay: function () {
      if (!this.session || this.screen !== 'table' || this.sheet || document.hidden) return;
      if (this.tutorial && this.tutorial.holding) return;
      this.session.resume();
    },

    resume: function (save) {
      var session = CT.Session.restore(save.session);
      if (!session) { UI.store.del(SAVE_KEY); return false; }
      this.game = save.game;
      this.attach(session, true);
      return true;
    },

    currentSave: function () {
      if (!this.session || this.tutorial || this.session.state.phase === 'over') return null;
      return { session: this.session.serialize(), game: this.game, me: 'p0', savedAt: Date.now() };
    },

    save: function () {
      if (!this.session || this.tutorial) return;
      if (this.session.state.phase === 'over') { UI.store.del(SAVE_KEY); return; }
      var s = this.currentSave();
      if (s) UI.store.set(SAVE_KEY, s);
    },

    loadSave: function () {
      var s = UI.store.get(SAVE_KEY, null);
      if (!s || !s.session || !s.session.state || s.session.state.phase === 'over') return null;
      if (!CT.Session.restore(s.session)) return null;
      return s;
    },

    loop: function () {
      if (!this.session || this.screen !== 'table' || this.sheet) return;
      this.session.tick();
      if (this.table) this.table.frame();
    },

    onVisibility: function () {
      if (document.hidden) {
        UI.Music.stop();
        if (this.session) { this.session.pause(); this.save(); }
        return;
      }
      if (UI.Music.on) UI.Music.start();
      this.resumePlay();
    },

    toggleMusic: function () {
      UI.Sound.unlock();
      UI.Music.setOn(!UI.Music.on);
      this.settings.music = UI.Music.on;
      UI.store.set(SETTINGS_KEY, this.settings);
    },

    toggleSound: function () {
      UI.Sound.on = !UI.Sound.on;
      this.settings.sound = UI.Sound.on;
      UI.store.set(SETTINGS_KEY, this.settings);
      if (UI.Sound.on) { UI.Sound.unlock(); UI.Sound.play('tick'); }
    },

    /* ---------- sheets ---------- */

    openSheet: function (name, html, opts) {
      var ov = $('overlay');
      ov.className = 'overlay' + (opts && opts.center ? ' center' : '');
      ov.innerHTML = '<div class="sheet ' + ((opts && opts.cls) || '') + '" role="dialog" aria-modal="true" aria-label="' + UI.esc((opts && opts.label) || name) + '">' + html + '</div>';
      ov.hidden = false;
      this.sheet = name;
      if (this.session) this.session.pause();
      var first = ov.querySelector('button');
      if (first) try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      return ov.firstChild;
    },

    closeSheet: function (silent) {
      var ov = $('overlay');
      ov.hidden = true;
      ov.innerHTML = '';
      this.sheet = null;
      this.logOpen = false;
      if (!silent) this.resumePlay();
    },

    sheetHead: function (title) {
      return '<div class="sheet-head"><h2>' + title + '</h2><button class="icon-btn" type="button" data-close aria-label="Close">' + UI.icon.close + '</button></div>';
    },

    wireClose: function (sheet) {
      var self = this;
      sheet.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { self.closeSheet(); }); });
    },

    openRules: function (modeId, options) {
      var mode = CT.getMode(modeId);
      var sections = mode.rules(options).map(function (r) {
        return '<section><h3>' + UI.esc(r.title) + '</h3><p>' + UI.esc(r.text) + '</p></section>';
      }).join('');
      var chosen = (mode.options || []).map(function (o) {
        var c = o.choices.filter(function (x) { return x.value === options[o.id]; })[0];
        return UI.esc(o.label) + ': ' + UI.esc(c ? c.label : '');
      }).join(' · ');
      var self = this;
      var Tutorial = !this.tutorial && UI.tutorials && UI.tutorials[modeId];
      var inGame = this.session && this.session.state.phase !== 'over';
      var tutorial = Tutorial
        ? '<div class="tut-card"><div><h3>Learn by playing</h3><p>A short guided game with ' + Tutorial.prototype.lessons.length +
          ' quick lessons, about three minutes.' + (inGame ? ' Your current game is saved, so you can resume it afterwards.' : '') + '</p></div>' +
          '<button class="btn btn-primary" type="button" id="r-tutorial">Start the tutorial</button></div>' +
          '<p class="eyebrow">Or read the rules</p>'
        : '';
      var sheet = this.openSheet('rules', this.sheetHead('How to play ' + UI.esc(mode.name)) + tutorial +
        '<div class="rules">' + sections + (chosen ? '<p class="house">Rule choices for this table · ' + chosen + '</p>' : '') + '</div>' +
        '<button class="btn ' + (Tutorial ? 'btn-ghost' : 'btn-primary') + '" type="button" data-close>Got it</button>', { label: 'How to play' });
      this.wireClose(sheet);
      if (Tutorial) $('r-tutorial').addEventListener('click', function () { self.startTutorial(modeId); });
    },

    openMenu: function () {
      var self = this;
      if (this.tutorial) {
        var t = this.openSheet('menu', this.sheetHead('Tutorial') +
          '<div class="menu-list">' +
            '<button class="btn btn-primary" type="button" data-close>Keep going</button>' +
            '<button class="btn btn-ghost" type="button" id="m-leave">Leave tutorial</button>' +
          '</div>', { label: 'Tutorial menu' });
        this.wireClose(t);
        $('m-leave').addEventListener('click', function () { self.tutorial.exit(); });
        return;
      }
      var sheet = this.openSheet('menu', this.sheetHead('Game menu') +
        '<div class="menu-list">' +
          '<button class="btn btn-primary" type="button" data-close>Keep playing</button>' +
          '<button class="btn btn-ghost" type="button" id="m-rules">How to play</button>' +
          '<button class="btn btn-ghost" type="button" id="m-log">Play-by-play</button>' +
          '<button class="btn btn-ghost" type="button" id="m-new">New game</button>' +
          '<button class="btn btn-ghost" type="button" id="m-home">Back to games</button>' +
        '</div><div id="m-confirm"></div>', { label: 'Game menu' });
      this.wireClose(sheet);
      $('m-rules').addEventListener('click', function () { self.openRules(self.session.mode.id, self.session.state.options); });
      $('m-log').addEventListener('click', function () { self.openLog(); });
      $('m-home').addEventListener('click', function () { self.closeSheet(true); self.showHome(); });
      $('m-new').addEventListener('click', function () {
        var over = self.session.state.phase === 'over';
        if (over) { self.closeSheet(true); self.playAgain(); return; }
        $('m-confirm').innerHTML = '<div class="confirm"><p>Start a new game? This one ends without a result.</p>' +
          '<div class="confirm-actions"><button class="btn btn-primary" type="button" id="m-yes">Start new game</button>' +
          '<button class="btn btn-ghost" type="button" id="m-no">Keep this one</button></div></div>';
        $('m-yes').addEventListener('click', function () { self.closeSheet(true); self.playAgain(); });
        $('m-no').addEventListener('click', function () { $('m-confirm').innerHTML = ''; });
      });
    },

    openLog: function () {
      var sheet = this.openSheet('log', this.sheetHead('Play-by-play') + '<div class="log" id="log-list"></div>' +
        '<button class="btn btn-ghost" type="button" data-close>Back to the table</button>', { label: 'Play-by-play' });
      this.wireClose(sheet);
      this.logOpen = true;
      this.renderLog();
    },

    renderLog: function () {
      var box = $('log-list');
      if (!box || !this.table) return;
      var items = this.table.logItems;
      box.innerHTML = items.length
        ? items.map(function (it) { return '<p class="' + it.cls + '">' + it.html + '</p>'; }).join('')
        : '<p class="empty">Nothing has happened yet.</p>';
      box.scrollTop = box.scrollHeight;
    },

    playAgain: function () {
      var g = this.game;
      if (!g) { this.showHome(); return; }
      this.startGame(g.modeId, { opponents: g.opponents, options: g.options, names: g.names });
    },

    record: function (v) {
      if (this.recorded) return;
      this.recorded = true;
      var id = this.session.mode.id;
      var s = this.stats[id] || (this.stats[id] = { played: 0, won: 0, flushWins: 0 });
      s.played++;
      if ((v.winners || []).indexOf('p0') >= 0) {
        s.won++;
        if (v.winReason === 'flush') s.flushWins++;
      }
      UI.store.set(STATS_KEY, this.stats);
      UI.store.del(SAVE_KEY);
    },

    showResult: function (v) {
      var self = this;
      if (this.tutorial) return;   // the tutorial explains the ending itself
      this.record(v);
      var me = 'p0';
      var byId = {};
      v.players.forEach(function (p, i) { byId[p.id] = { p: p, i: i }; });
      var winners = v.winners || [];
      var iWon = winners.indexOf(me) >= 0;
      var raw = winners.map(function (id) { return id === me ? 'You' : byId[id].p.name; });
      var names = raw.map(UI.esc);
      var title;
      if (winners.length > 1) title = iWon ? 'SHARED WIN' : raw.join(' & ').toUpperCase() + ' WIN';
      else title = iWon ? 'YOU WIN' : raw[0].toUpperCase() + ' WINS';
      title = UI.esc(title);

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

      var sheet = this.openSheet('result',
        '<p class="eyebrow">' + UI.esc(this.session.mode.name) + ' · ' + (v.winReason === 'flush' ? 'on the deal' : 'set ' + v.setNo) + '</p>' +
        '<h2 class="wordmark">' + title + '</h2>' +
        '<p class="result-why">' + why + '</p>' + cards +
        '<div class="standings"><ul>' + standings + '</ul></div>' +
        '<div class="result-actions">' +
          '<button class="btn btn-primary" type="button" id="r-again">Play again</button>' +
          '<button class="btn btn-ghost" type="button" id="r-setup">Change setup</button>' +
          '<button class="btn btn-ghost" type="button" id="r-table">See the table</button>' +
        '</div>', { cls: 'result', center: true, label: 'Game result' });
      if (v.winReason === 'flush') {
        var rows = sheet.querySelectorAll('.result-cards');
        winners.forEach(function (id, k) {
          (byId[id].p.hand || []).forEach(function (c) { rows[k].appendChild(UI.makeCard(c)); });
        });
      }
      $('r-again').addEventListener('click', function () { self.closeSheet(true); self.playAgain(); });
      $('r-setup').addEventListener('click', function () { self.closeSheet(true); self.openSetup(self.session.mode.id); });
      $('r-table').addEventListener('click', function () { self.closeSheet(); });
    }
  };

  CT.App = App;

  function start(data) { App.boot(data || {}); }
  var hot = window.claude && window.claude.hot;
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start((hot && hot.data) || {});
})(window.CT);
