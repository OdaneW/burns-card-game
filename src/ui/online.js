/* ==========================================================================
   ONLINE · rooms, the lobby, and playing with friends
   Create a room or join one with its code (or a shared link), wait in the
   lobby while people arrive, then play on the same table screens as an
   offline game. The host picks the game and starts it; computer players
   take any empty seats. If the connection drops, the app reconnects by
   itself, and a computer player looks after your seat until you're back.
   Chat and quick reactions are in social.js.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var KEY = 'cardtable.online.v1';            // this device: { token, name, lastMode, room: { code, mode, at } }
  var REJOIN_MS = 12 * 60 * 60 * 1000;        // offer to go back to a room for this long
  var AUTO_REJOIN_MS = 3 * 60 * 1000;         // after a quick reload (an update), go straight back in
  var PAINTS = ['#F4B942', '#F0643C', '#7FD1C1', '#C9A8F0', '#9BC76B', '#F59BB8'];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return UI.esc(s); }

  UI.icon.share = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4"/></svg>';
  UI.icon.people = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c.6-3.6 3.2-5.6 6.2-5.6s5.6 2 6.2 5.6"/><circle cx="17.2" cy="9" r="2.6"/><path d="M16.4 14.6c2.5.2 4.3 1.9 4.8 5"/></svg>';

  function newToken() {
    var bytes = new Uint8Array(18);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* Where the game server is: set at build time; tests may point elsewhere. */
  function serverUrl() {
    var override = UI.store.get('cardtable.server', null);
    if (typeof override === 'string' && /^wss?:\/\//.test(override)) return override;
    return (CT.BUILD && CT.BUILD.server) || '';
  }

  function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); }
  function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16); }

  /* A room code from a shared link: …/?room=ABCD or …/#room=ABCD */
  function linkCode() {
    var m = (location.search + '&' + location.hash).match(/[?&#]room=([A-Za-z0-9]{4})/);
    return m ? cleanCode(m[1]) : null;
  }

  function Online(app) {
    this.app = app;
    this.data = UI.store.get(KEY, {}) || {};
    if (!this.data.token) { this.data.token = newToken(); this.store(); }
    this.conn = null;
    this.room = null;        // the latest room from the server
    this.you = null;         // my id in the room
    this.remote = null;      // the game in progress (a RemoteSession)
    this.form = null;        // the create/join sheet, while it's waiting
    this.social = new UI.Social(this);   // chat and reactions
  }

  Online.prototype.store = function () { UI.store.set(KEY, this.data); };
  Online.prototype.available = function () { return !!serverUrl(); };
  /* The same server over https, for everything that isn't a room (friends). */
  Online.prototype.httpUrl = function (path) { return serverUrl().replace(/^ws/, 'http').replace(/\/+$/, '') + path; };
  Online.prototype.inRoom = function () { return !!this.conn; };
  Online.prototype.me = function () {
    var self = this;
    return this.room ? this.room.members.filter(function (m) { return m.id === self.you; })[0] || null : null;
  };
  Online.prototype.isHost = function () { return !!this.room && this.room.host === this.you; };
  Online.prototype.hostName = function () {
    var r = this.room;
    var h = r && r.members.filter(function (m) { return m.id === r.host; })[0];
    return h ? h.name : 'the host';
  };

  /* ---------- home ---------- */

  /* "You're in a room": near the top of the home screen. */
  Online.prototype.rejoinHtml = function () {
    var r = this.data.room;
    if (!this.available() || !r || this.conn || Date.now() - r.at >= REJOIN_MS) return '';
    var mode = CT.getMode(r.mode);
    return '<div class="resume rejoin"><p>Online room ' + esc(r.code) +
      '<small>' + esc(mode ? mode.name : 'Card game') + ' with friends</small></p>' +
      '<button class="btn btn-primary" type="button" id="o-rejoin">Rejoin</button>' +
      '<button class="icon-btn" type="button" id="o-forget" aria-label="Forget this room">' + UI.icon.close + '</button></div>';
  };

  /* The "Play with friends" tile, after the games. */
  Online.prototype.tileHtml = function () {
    if (!this.available()) return '';
    return '<article class="mode-tile online-tile">' +
      '<div class="online-top"><span class="online-icon">' + UI.icon.people + '</span>' +
      '<h2>Play with friends</h2><span class="chip online-chip">Online</span></div>' +
      '<p class="tag">Make a room, share the code, and everyone plays on their own phone. Computer players fill any empty seats.</p>' +
      '<div class="mode-actions">' +
        '<button class="btn btn-primary" type="button" data-online="create">Create a room</button>' +
        '<button class="btn btn-ghost" type="button" data-online="join">Join a room</button>' +
      '</div></article>';
  };

  Online.prototype.wireHome = function (root) {
    var self = this;
    root.querySelectorAll('[data-online]').forEach(function (b) {
      b.addEventListener('click', function () { if (b.dataset.online === 'create') self.openCreate(); else self.openJoin(); });
    });
    var rejoin = $('o-rejoin');
    if (rejoin) rejoin.addEventListener('click', function () {
      UI.Sound.unlock();
      rejoin.disabled = true;
      rejoin.textContent = 'Joining…';
      self.connect(self.data.room.code, {});
    });
    var forget = $('o-forget');
    if (forget) forget.addEventListener('click', function () { delete self.data.room; self.store(); self.app.showHome(); });
  };

  /* On start: a shared link opens the join form; a reload during a game goes straight back in. */
  Online.prototype.boot = function () {
    if (!this.available()) return;
    var code = linkCode();
    if (code) {
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* keep the address */ }
      this.openJoin(code);
      return;
    }
    var r = this.data.room;
    if (r && Date.now() - r.at < AUTO_REJOIN_MS && this.app.screen === 'home') this.connect(r.code, {});
  };

  /* ---------- create and join ---------- */

  Online.prototype.nameField = function () {
    return '<section class="field"><h3><label for="o-name">Your name</label></h3>' +
      '<input class="text-input" id="o-name" type="text" maxlength="16" autocomplete="nickname" autocapitalize="words" enterkeyhint="go" spellcheck="false" placeholder="So your friends know it’s you" value="' + esc(this.data.name || '') + '"></section>';
  };

  Online.prototype.openCreate = function () {
    var self = this, app = this.app;
    var modes = CT.listModes();
    var chosen = CT.getMode(this.data.lastMode) ? this.data.lastMode : modes[0].id;
    var sheet = app.openSheet('online', app.sheetHead('Create a room') +
      '<div class="online-form">' +
        '<section class="field"><h3 id="lbl-o-mode">Game</h3><div class="seg" role="group" aria-labelledby="lbl-o-mode">' +
          modes.map(function (m) { return '<button type="button" data-mode="' + m.id + '" aria-pressed="' + (m.id === chosen) + '">' + esc(m.shortName || m.name) + '</button>'; }).join('') +
        '</div></section>' +
        this.nameField() +
        '<p class="form-error" id="o-error" role="alert" hidden></p>' +
        '<button class="btn btn-primary btn-wide" type="button" id="o-go">Create room</button>' +
        '<p class="form-help">You’ll get a code to share with your friends. You can change the game and its choices in the room.</p>' +
      '</div>', { label: 'Create a room' });
    app.wireClose(sheet);
    sheet.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        chosen = b.dataset.mode;
        sheet.querySelectorAll('[data-mode]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
    });
    var go = function () {
      var name = self.readName();
      if (!name) return;
      var mode = CT.getMode(chosen);
      var cfg = app.modeSettings(mode);        // your own choices for this game start the room off
      self.data.lastMode = chosen;
      self.store();
      self.wait('Creating…');
      self.connect('new', { mode: chosen, size: cfg.opponents + 1, options: cfg.options });
    };
    $('o-go').addEventListener('click', go);
    $('o-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  };

  Online.prototype.openJoin = function (code) {
    var self = this, app = this.app;
    var sheet = app.openSheet('online', app.sheetHead('Join a room') +
      '<div class="online-form">' +
        '<section class="field"><h3><label for="o-code">Room code</label></h3>' +
          '<input class="text-input code-input" id="o-code" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next" placeholder="ABCD" value="' + esc(code || '') + '"></section>' +
        this.nameField() +
        '<p class="form-error" id="o-error" role="alert" hidden></p>' +
        '<button class="btn btn-primary btn-wide" type="button" id="o-go">Join room</button>' +
        '<p class="form-help">Ask whoever made the room for its four-letter code, or for the link.</p>' +
      '</div>', { label: 'Join a room' });
    app.wireClose(sheet);
    var input = $('o-code');
    input.addEventListener('input', function () {
      var v = cleanCode(input.value);
      if (v !== input.value) input.value = v;
      if (v.length === 4 && !$('o-name').value) $('o-name').focus();
    });
    var go = function () {
      var c = cleanCode(input.value);
      if (c.length !== 4) { self.formError('Type the four-letter room code.'); input.focus(); return; }
      var name = self.readName();
      if (!name) return;
      self.wait('Joining…');
      self.connect(c, {});
    };
    $('o-go').addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('o-name').focus(); });
    $('o-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    if (code && this.data.name) try { $('o-go').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };

  Online.prototype.readName = function () {
    var input = $('o-name');
    var name = cleanName(input && input.value);
    if (!name) { this.formError('Type your name, so the others know who you are.'); if (input) input.focus(); return null; }
    this.data.name = name;
    this.store();
    return name;
  };

  Online.prototype.formError = function (text) {
    var el = $('o-error');
    if (el) { el.textContent = text; el.hidden = false; }
    var go = $('o-go');
    if (go && go.dataset.label) { go.disabled = false; go.textContent = go.dataset.label; }
    this.form = null;
  };

  Online.prototype.wait = function (label) {
    var go = $('o-go'), err = $('o-error');
    if (err) err.hidden = true;
    if (go) { go.dataset.label = go.dataset.label || go.textContent; go.disabled = true; go.textContent = label; }
    this.form = true;
  };

  /* ---------- the connection ---------- */

  Online.prototype.connect = function (code, extra) {
    var self = this;
    if (this.conn) this.conn.stop();
    this.room = null;
    this.you = null;
    this.remote = null;
    var hello = { token: this.data.token, name: this.data.name || 'Player', engines: this.app.engines() };
    for (var k in extra) hello[k] = extra[k];
    this.conn = new CT.Net.Connection({
      server: serverUrl(), code: code, hello: hello,
      on: {
        welcome: function (m) { self.onWelcome(m); },
        room: function (m) { self.onRoom(m.room); },
        state: function (m) { self.onState(m); },
        result: function (m) { if (self.remote) self.remote.result(m); },
        notice: function (m) { UI.toast(esc(m.message)); },
        chat: function (m) { self.social.receive(m.m); },
        react: function (m) { self.social.reaction(m); },
        friend: function (m) { if (self.app.friends) self.app.friends.addedBy(m.from); },
        error: function (m) { self.onError(m); },
        lost: function () { if (self.remote) self.remote.dropPending(); },
        status: function (s) { self.onStatus(s); }
      }
    });
    // the first connection failing (no network, server unreachable)
    clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(function () {
      if (self.conn && !self.conn.welcomed && self.form) {
        self.conn.stop();
        self.conn = null;
        self.formError('Can’t reach the game server. Check your internet connection and try again.');
      }
    }, 12000);
  };

  Online.prototype.onWelcome = function (msg) {
    var mine = this.app.engines();
    for (var id in msg.engines) {
      if (mine[id] != null && mine[id] !== msg.engines[id]) {
        this.onError({ code: 'update', message: 'This room runs a different version of the game. Make sure everyone has updated the app (the version is at the bottom of the home screen).' });
        return;
      }
    }
    this.you = msg.you;
    this.data.room = { code: msg.code, mode: this.data.room && this.data.room.code === msg.code ? this.data.room.mode : null, at: Date.now() };
    this.store();
    this.social.history(msg.code, msg.chat);
    if (this.app.friends) this.app.friends.touch();   // so the others in the room can add you as a friend
  };

  Online.prototype.onRoom = function (room) {
    if (!CT.getMode(room.mode)) {
      // a game this version of the app doesn't have yet
      this.onError({ code: 'update', message: 'This room is playing a game your app doesn’t have yet. Update the app, then join again with the code.' });
      return;
    }
    var first = !this.room;
    this.social.members(this.room, room);   // "Tess joined the room." in the chat
    this.room = room;
    this.data.room = { code: room.code, mode: room.mode, at: Date.now() };
    this.store();
    if (this.form) { this.form = null; this.app.closeSheet(true); }
    var me = this.me();
    var seated = me && me.pid;
    if (room.phase === 'lobby') {
      if (this.remote || this.app.screen !== 'lobby') this.leaveTable();
      this.showLobby();
      return;
    }
    // a game is on or just finished
    if (seated && (this.remote || first)) {
      // at the table (or about to be: the view follows straight after)
      if (this.remote && this.app.sheet === 'result') this.refreshResult();
      return;
    }
    if (this.remote) this.leaveTable();
    this.showLobby();
  };

  Online.prototype.onState = function (msg) {
    if (!this.remote || msg.game !== this.remote.game) {
      // a new game, or one already going when we joined
      this.remote = new CT.Net.RemoteSession(this.conn, msg);
      this.conn.syncing = true;
      this.app.attachOnline(this.remote, { restored: !msg.fresh });
      this.social.mountTable();
      return;
    }
    if (msg.reset) {
      // back after a dropped connection: redraw the table as it is now
      this.remote.apply(msg, true);
      this.app.attachOnline(this.remote, { restored: true });
      this.social.mountTable();
      return;
    }
    this.remote.apply(msg);
  };

  Online.prototype.onError = function (msg) {
    var text = msg.message || 'Something went wrong.';
    if (this.form) {
      if (this.conn) this.conn.stop();
      this.conn = null;
      if (msg.code === 'no-room' && this.data.room) { delete this.data.room; this.store(); }
      this.formError(text);
      return;
    }
    if (this.conn && !this.conn.stopped && msg.code !== 'update') { UI.toast(esc(text)); return; }
    // the room is gone for this phone: say why, then back to the games
    if (this.conn) this.conn.stop();
    this.conn = null;
    if (msg.code !== 'replaced') { delete this.data.room; this.store(); }
    this.endOnline();
    var self = this, app = this.app;
    var sheet = app.openSheet('confirm', '<div class="sheet-head"><h2>' + (msg.code === 'no-room' ? 'That room has closed' : 'Left the room') + '</h2></div>' +
      '<p class="sheet-text">' + esc(text) + '</p>' +
      '<button class="btn btn-primary" type="button" id="o-ok">Back to games</button>', { label: 'Online room', center: true });
    $('o-ok').addEventListener('click', function () { app.closeSheet(true); self.app.showHome(); });
    if (sheet) try { $('o-ok').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };

  Online.prototype.onStatus = function (s) {
    var bar = $('net-bar');
    clearTimeout(this.barTimer);
    if (s === 'reconnecting' && bar) {
      this.barTimer = setTimeout(function () { bar.hidden = false; }, 1200);
    } else if (bar) {
      bar.hidden = true;
    }
    var dot = $('l-net');
    if (dot) dot.className = 'net-dot ' + (s === 'open' ? 'on' : 'off');
  };

  /* Back in the app: if the screen was off, reconnect straight away. */
  Online.prototype.wake = function () { if (this.conn) this.conn.wake(); };

  /* ---------- the lobby ---------- */

  Online.prototype.inviteUrl = function () {
    return location.href.split(/[?#]/)[0] + '?room=' + this.room.code;
  };

  Online.prototype.showLobby = function () {
    var app = this.app;
    if (app.screen !== 'lobby') this.social.clearAll();   // whatever was popping up at the table
    if (app.sheet && app.sheet !== 'online' && app.sheet !== 'rules') app.closeSheet(true);
    app.show('lobby');
    this.renderLobby();
  };

  Online.prototype.renderLobby = function () {
    var self = this, app = this.app, r = this.room;
    if (!r || app.screen !== 'lobby') return;
    var mode = CT.getMode(r.mode);
    var host = this.isHost();
    var lobby = r.phase === 'lobby';
    var fixed = mode.players.min === mode.players.max;
    var size = r.size;
    var people = r.members;
    var rows = [];
    var me = this.me();
    // who sits where: in the lobby, the first `size` people, then computer players; during a game, the actual seats
    if (lobby) {
      people.forEach(function (m, i) { rows.push({ m: m, waits: i >= size }); });
      for (var k = people.length; k < size; k++) rows.push({ bot: true });
    } else {
      people.forEach(function (m) { rows.push({ m: m, waits: !m.pid }); });
      (r.bots || []).forEach(function (b) { rows.push({ bot: true, name: b.name }); });
    }
    var humans = Math.min(people.length, size);
    var seatsHelp = lobby
      ? size + ' at the table: ' + humans + (humans === 1 ? ' person' : ' people') + (size - humans ? ' and ' + (size - humans) + ' computer ' + (size - humans === 1 ? 'player' : 'players') : '') + '.' +
        (people.length > size ? ' Everyone else waits for the next game.' : '')
      : '';
    var friends = this.app.friends;
    var seatRows = rows.map(function (row, i) {
      if (row.bot) {
        return '<li class="lobby-seat bot"><span class="avatar">' + UI.icon.people + '</span><span class="who">' + (row.name ? esc(row.name) + ' <small>computer player</small>' : 'Computer player') + '</span>' +
          '<span class="state">' + (lobby ? '' : 'Playing') + '</span></li>';
      }
      var m = row.m;
      var tags = [];
      if (m.id === self.you) tags.push('you');
      if (m.id === r.host) tags.push('host');
      // anyone else here can be added as a friend, with a tap
      var canAdd = friends && m.code && m.id !== self.you;
      var friend = canAdd && friends.isFriend(m.code);
      if (friend) tags.push('friend');
      var adding = canAdd && friends.adding[m.code];
      var add = canAdd && !friend
        ? '<button class="add-friend" type="button" data-befriend="' + esc(m.code) + '" data-to="' + m.id + '" data-name="' + esc(m.name) + '" aria-label="Add ' + esc(m.name) + ' as a friend"' + (adding ? ' disabled' : '') + '>' +
            UI.icon.addFriend + '<span>' + (adding ? 'Adding…' : 'Add') + '</span></button>'
        : '';
      var state = row.waits ? (lobby ? 'Waits' : 'Next game') : m.computer ? 'Computer covering' : m.connected ? 'Here' : 'Away';
      return '<li class="lobby-seat' + (row.waits ? ' waits' : '') + '" data-member="' + m.id + '"><span class="avatar" style="--paint:' + PAINTS[i % PAINTS.length] + '">' + esc(m.name.charAt(0).toUpperCase()) + '</span>' +
        '<span class="who">' + esc(m.name) + (tags.length ? ' <small>' + tags.join(' · ') + '</small>' : '') + '</span>' +
        '<span class="seat-end">' + add + '<span class="state ' + (m.connected ? 'on' : 'off') + '">' + state + '</span></span></li>';
    }).join('');

    var gameField = host && lobby
      ? '<div class="seg" role="group" aria-labelledby="lbl-l-mode">' + CT.listModes().map(function (m) {
          return '<button type="button" data-l-mode="' + m.id + '" aria-pressed="' + (m.id === r.mode) + '">' + esc(m.shortName || m.name) + '</button>';
        }).join('') + '</div>'
      : '<p class="lobby-value">' + esc(mode.name) + '</p>';
    var sizeField = '';
    if (!fixed && host && lobby) {
      var segs = '';
      for (var n = mode.players.min; n <= mode.players.max; n++) segs += '<button type="button" data-l-size="' + n + '" aria-pressed="' + (n === size) + '">' + n + '</button>';
      sizeField = '<section class="field"><h3 id="lbl-l-size">Seats at the table</h3><div class="seg" role="group" aria-labelledby="lbl-l-size">' + segs + '</div></section>';
    }
    var opts = (mode.options || []).filter(function (o) { return CT.optionShown(o, r.options); }).map(function (o) {
      var current = r.options[o.id];
      if (host && lobby) {
        var segs = o.choices.map(function (c) {
          return '<button type="button" data-l-opt="' + o.id + '" data-val="' + c.value + '" aria-pressed="' + (current === c.value) + '">' + esc(c.label) + '</button>';
        }).join('');
        var choice = o.choices.filter(function (c) { return c.value === current; })[0];
        return '<section class="field"><h3 id="lbl-l-' + o.id + '">' + esc(o.label) + '</h3><div class="seg" role="group" aria-labelledby="lbl-l-' + o.id + '">' + segs + '</div>' +
          '<p class="help">' + esc(choice ? choice.help : '') + '</p></section>';
      }
      var c = o.choices.filter(function (x) { return x.value === current; })[0];
      return '<li><span>' + esc(o.label) + '</span><b>' + esc(c ? c.label : '') + '</b></li>';
    });
    var optsHtml = !opts.length ? '' : (host && lobby)
      ? '<p class="eyebrow">Game choices</p>' + opts.join('')
      : '<section class="field"><h3>Game choices</h3><ul class="lobby-choices">' + opts.join('') + '</ul></section>';

    var banner = '';
    if (r.phase === 'playing') banner = '<p class="lobby-note">A game is under way. ' + (me && !me.pid ? 'You’ll get a seat in the next one.' : '') + '</p>';
    if (r.phase === 'over') banner = '<p class="lobby-note">The game has just finished. ' + (host ? 'Start the next one when everyone’s ready.' : 'Waiting for ' + esc(this.hostName()) + ' to start the next one.') + '</p>';

    var foot = host
      ? '<button class="btn btn-primary btn-wide" type="button" id="l-start"' + (r.phase === 'playing' ? ' disabled' : '') + '>' + (r.phase === 'playing' ? 'Game under way' : 'Start game') + '</button>'
      : '<p class="lobby-wait">' + (r.phase === 'playing' ? 'Waiting for this game to finish…' : 'Waiting for ' + esc(this.hostName()) + ' to start the game…') + '</p>';

    var oldBody = document.querySelector('#screen-lobby .lobby-body');
    var scrolled = oldBody ? oldBody.scrollTop : 0;   // someone joining shouldn't scroll the host back up
    $('screen-lobby').innerHTML =
      '<header class="setup-head lobby-head">' +
        '<button class="icon-btn" id="l-back" type="button" aria-label="Leave the room">' + UI.icon.back + '</button>' +
        '<span class="wordmark">ROOM</span><span class="spacer"></span>' +
        this.social.buttonHtml('l-chat') +
        '<span class="net-dot ' + (this.conn && this.conn.isOpen() ? 'on' : 'off') + '" id="l-net" title="Connection"></span>' +
      '</header>' +
      '<div class="setup-body lobby-body">' +
        banner +
        '<section class="invite">' +
          '<p class="eyebrow">Room code</p>' +
          '<p class="room-code" aria-label="Room code ' + esc(r.code.split('').join(' ')) + '">' + esc(r.code) + '</p>' +
          '<p class="invite-help">Friends tap <b>Join a room</b> and type the code, or open your invite link.</p>' +
          '<div class="invite-actions"><button class="btn btn-primary" type="button" id="l-share">' + UI.icon.share + '<span>Share invite</span></button>' +
          '<button class="btn btn-ghost" type="button" id="l-copy">Copy link</button></div>' +
        '</section>' +
        '<section class="field"><h3 id="lbl-l-mode">Game</h3>' + gameField + '</section>' +
        sizeField +
        '<section class="field"><h3>At the table</h3><ul class="lobby-seats">' + seatRows + '</ul>' +
          (seatsHelp ? '<p class="help">' + esc(seatsHelp) + '</p>' : '') + '</section>' +
        optsHtml +
      '</div>' +
      '<div class="setup-foot">' + foot +
        '<button class="link-btn" id="l-rules" type="button">How to play ' + esc(mode.name) + '</button></div>';

    if (scrolled) document.querySelector('#screen-lobby .lobby-body').scrollTop = scrolled;
    $('l-back').addEventListener('click', function () { self.confirmLeave(); });
    this.social.wire($('l-chat'));
    $('l-share').addEventListener('click', function () { self.share(); });
    $('l-copy').addEventListener('click', function () { self.copy(self.inviteUrl()); });
    $('l-rules').addEventListener('click', function () { app.openRules(mode.id, r.options); });
    var start = $('l-start');
    if (start) start.addEventListener('click', function () {
      UI.Sound.unlock();
      start.disabled = true;
      start.textContent = 'Starting…';
      self.conn.send({ t: 'start' });
    });
    var screen = $('screen-lobby');
    screen.querySelectorAll('[data-l-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.lMode === r.mode) return;
        var m = CT.getMode(b.dataset.lMode), cfg = app.modeSettings(m);
        self.conn.send({ t: 'setup', mode: m.id, size: cfg.opponents + 1, options: cfg.options });
      });
    });
    screen.querySelectorAll('[data-befriend]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        b.lastChild.textContent = 'Adding…';
        friends.addFromRoom(b.dataset.befriend, b.dataset.name, +b.dataset.to);
      });
    });
    screen.querySelectorAll('[data-l-size]').forEach(function (b) {
      b.addEventListener('click', function () { self.conn.send({ t: 'setup', size: +b.dataset.lSize }); });
    });
    screen.querySelectorAll('[data-l-opt]').forEach(function (b) {
      b.addEventListener('click', function () {
        var o = {};
        for (var k in r.options) o[k] = r.options[k];
        o[b.dataset.lOpt] = b.dataset.val;
        self.conn.send({ t: 'setup', options: o });
      });
    });
  };

  Online.prototype.share = function () {
    var self = this, url = this.inviteUrl(), mode = CT.getMode(this.room.mode);
    var text = 'Join my game of ' + mode.name + '! Room code ' + this.room.code + '.';
    if (navigator.share) {
      navigator.share({ title: 'Join my card game', text: text, url: url }).catch(function (e) {
        if (e && e.name !== 'AbortError') self.copy(url);
      });
    } else {
      this.copy(url);
    }
  };

  Online.prototype.copy = function (text) {
    var done = function () { UI.toast('Invite link copied. Paste it in a message to your friends.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy this link:', text); });
    } else {
      window.prompt('Copy this link:', text);
    }
  };

  /* ---------- leaving ---------- */

  Online.prototype.confirmLeave = function () {
    var self = this, app = this.app;
    var playing = this.room && this.room.phase === 'playing' && this.me() && this.me().pid;
    var alone = !this.room || this.room.members.length <= 1;
    if (alone && !playing) { this.leave(); return; }
    app.openSheet('confirm', '<div class="sheet-head"><h2>Leave the room?</h2></div>' +
      '<p class="sheet-text">' + (playing ? 'A computer player takes over your seat for the rest of this game.' : 'You can come back with the code while the room is open.') + '</p>' +
      '<div class="confirm-actions"><button class="btn btn-primary" type="button" id="o-leave">Leave room</button>' +
      '<button class="btn btn-ghost" type="button" id="o-stay">Stay</button></div>', { label: 'Leave the room', center: true });
    $('o-leave').addEventListener('click', function () { app.closeSheet(true); self.leave(); });
    $('o-stay').addEventListener('click', function () { app.closeSheet(); });
  };

  Online.prototype.leave = function () {
    if (this.conn) {
      var conn = this.conn;
      conn.on = {};                                     // nothing more from this room
      if (conn.live()) conn.send({ t: 'leave' });
      setTimeout(function () { conn.stop(); }, 300);   // let the goodbye go out first
    }
    this.conn = null;
    delete this.data.room;
    this.store();
    this.endOnline();
    this.app.showHome();
  };

  /* Off the table (back to the lobby, or out of the room). */
  Online.prototype.leaveTable = function () {
    this.remote = null;
    if (this.conn) this.conn.syncing = false;
    this.app.detachOnline();
  };

  Online.prototype.endOnline = function () {
    clearTimeout(this.barTimer);
    this.social.reset();
    var bar = $('net-bar');
    if (bar) bar.hidden = true;
    this.leaveTable();
    this.room = null;
    this.you = null;
  };

  /* ---------- the table's menu and the end of a game ---------- */

  Online.prototype.openMenu = function () {
    var self = this, app = this.app;
    var over = this.room && this.room.phase === 'over';
    var host = this.isHost();
    var sheet = app.openSheet('menu', app.sheetHead('Room ' + esc(this.room ? this.room.code : '')) +
      '<div class="menu-list">' +
        '<button class="btn btn-primary" type="button" data-close>' + (over ? 'Back to the table' : 'Keep playing') + '</button>' +
        (over && host ? '<button class="btn btn-ghost" type="button" id="m-again">Play again</button><button class="btn btn-ghost" type="button" id="m-lobby">Back to the room</button>' : '') +
        '<button class="btn btn-ghost" type="button" id="m-rules">How to play</button>' +
        '<button class="btn btn-ghost" type="button" id="m-log">Play-by-play</button>' +
        '<button class="btn btn-ghost" type="button" id="m-invite">Invite friends</button>' +
        '<button class="btn btn-ghost" type="button" id="m-leave">Leave room</button>' +
      '</div>', { label: 'Game menu' });
    app.wireClose(sheet);
    var again = $('m-again'), lobby = $('m-lobby');
    if (again) again.addEventListener('click', function () { app.closeSheet(true); self.conn.send({ t: 'start' }); });
    if (lobby) lobby.addEventListener('click', function () { app.closeSheet(true); self.conn.send({ t: 'lobby' }); });
    $('m-rules').addEventListener('click', function () { app.openRules(app.session.mode.id, app.session.state.options); });
    $('m-log').addEventListener('click', function () { app.openLog(); });
    $('m-invite').addEventListener('click', function () { self.share(); });
    $('m-leave').addEventListener('click', function () { app.closeSheet(true); self.confirmLeave(); });
  };

  /* The buttons under an online result: the host decides what's next. */
  Online.prototype.resultActions = function () {
    if (this.isHost()) {
      return '<button class="btn btn-primary" type="button" id="r-again">Play again</button>' +
        '<button class="btn btn-ghost" type="button" id="r-lobby">Back to the room</button>' +
        '<button class="btn btn-ghost" type="button" id="r-table">See the table</button>' +
        '<button class="btn btn-ghost" type="button" id="r-leave">Leave room</button>';
    }
    return '<p class="result-wait" id="r-wait">Waiting for ' + esc(this.hostName()) + ' to start the next game…</p>' +
      '<button class="btn btn-ghost" type="button" id="r-table">See the table</button>' +
      '<button class="btn btn-ghost" type="button" id="r-leave">Leave room</button>';
  };

  Online.prototype.wireResult = function () {
    var self = this, app = this.app;
    var again = $('r-again'), lobby = $('r-lobby');
    if (again) again.addEventListener('click', function () { again.disabled = true; again.textContent = 'Starting…'; self.conn.send({ t: 'start' }); });
    if (lobby) lobby.addEventListener('click', function () { self.conn.send({ t: 'lobby' }); });
    $('r-table').addEventListener('click', function () { app.closeSheet(); });
    $('r-leave').addEventListener('click', function () { app.closeSheet(true); self.confirmLeave(); });
  };

  /* Someone else became host while the result was up. */
  Online.prototype.refreshResult = function () {
    var wait = $('r-wait');
    if (wait && this.isHost() && this.app.table) { this.app.closeSheet(true); this.app.showResult(this.app.table.v); }
    else if (wait) wait.textContent = 'Waiting for ' + this.hostName() + ' to start the next game…';
  };

  UI.Online = Online;
})(window.CT);
