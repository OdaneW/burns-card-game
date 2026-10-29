/* ==========================================================================
   FRIENDS · friend codes and the leaderboard
   Everyone who plays online, or opens Friends, gets a friend code. Type a
   friend's code here, open their invite link, or tap Add next to them in an
   online room, and you're on each other's list until either of you removes
   the other.

   The leaderboard ranks you and your friends in each game (standings.js):
   wins, win %, games, best streak, and whatever that game counts. Each
   phone keeps the record of its own games and sends it to the server after
   every game, so friends see it; counting every game, or online ones only.
   The server (server/src/players.js) knows a phone only by its online token.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var S = CT.Standings;
  var KEY = 'cardtable.friends.v1';   // { joined, you: { code, name }, friends: [{ code, name, stats, updated }], at, view }
  var TIMEOUT_MS = 10000;
  var TOUCH_MS = 60000;               // joining a room tells the server you're about, at most this often
  var PAINTS = ['#F4B942', '#F0643C', '#7FD1C1', '#C9A8F0', '#9BC76B', '#F59BB8'];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return UI.esc(s); }

  UI.icon.trophy = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h10v5a5 5 0 01-10 0z"/><path d="M7 5.5H4.5v1.2a3.3 3.3 0 003.1 3.3M17 5.5h2.5v1.2a3.3 3.3 0 01-3.1 3.3"/><path d="M12 13.5v3.5M8 20.5h8M9.2 20.5c.3-2 1.4-3.4 2.8-3.4s2.5 1.4 2.8 3.4"/></svg>';
  UI.icon.refresh = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.5 15.75A7.5 7.5 0 1118.5 8.25"/><path d="M19.5 3.5v5h-5"/></svg>';
  UI.icon.addFriend = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9.5" cy="8" r="3.5"/><path d="M3 20c.6-3.7 3.3-5.8 6.5-5.8s5.9 2.1 6.5 5.8"/><path d="M19 7.5v6M16 10.5h6"/></svg>';

  /* What someone typed: "k7pq-2mxd" → "K7PQ2MXD" (codes never use 0, O, 1 or I). */
  function cleanCode(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '').slice(0, 16); }
  /* K7PQ2MXD → K7PQ-2MXD, easier to read out */
  function showCode(code) { return String(code || '').replace(/(.{4})(?=.)/g, '$1-'); }
  function paintFor(code) {
    var h = 0;
    for (var i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
    return PAINTS[h % PAINTS.length];
  }
  function initial(name) { return (Array.from(String(name || '?').trim())[0] || '?').toUpperCase(); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    var d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }

  function Friends(app) {
    this.app = app;
    this.online = app.online;
    var d = UI.store.get(KEY, null);
    this.data = d && typeof d === 'object' ? d : {};
    if (!Array.isArray(this.data.friends)) this.data.friends = [];
    var v = this.data.view || {};
    this.view = { mode: v.mode || 'all', metric: v.metric || 'won', online: !!v.online };
    this.status = null;     // null, 'loading', 'offline' or 'error' (with this.message)
    this.message = '';
    this.flash = null;      // a friend just added: their row lights up
    this.adding = {};       // codes being added from a room (the room may redraw meanwhile)
  }

  Friends.prototype.save = function () { this.data.view = this.view; UI.store.set(KEY, this.data); };
  Friends.prototype.available = function () { return !!(this.online && this.online.available()); };
  Friends.prototype.name = function () { return this.online.data.name || ''; };
  Friends.prototype.code = function () { return this.data.you ? this.data.you.code : ''; };
  Friends.prototype.isFriend = function (code) { return this.data.friends.some(function (f) { return f.code === code; }); };

  /* ---------- the server ---------- */

  /* This phone's record, as the server keeps it: numbers only, and not when each game was played. */
  Friends.prototype.myStats = function () {
    var out = {}, all = this.app.stats || {};
    CT.listModes().forEach(function (m) {
      var rec = all[m.id];
      if (!rec || !rec.played) return;
      var o = {};
      Object.keys(rec).forEach(function (k) {
        var v = rec[k];
        if (k === 'online' && v && typeof v === 'object') {
          o.online = {};
          Object.keys(v).forEach(function (j) { if (typeof v[j] === 'number') o.online[j] = v[j]; });
        } else if (k !== 'last' && typeof v === 'number') o[k] = v;
      });
      out[m.id] = o;
    });
    return out;
  };

  /* One request does everything: your name and stats go up with every one,
     your friends (and theirs) come back. body: { add?: code, remove?: code }. */
  Friends.prototype.request = function (body) {
    var self = this, online = this.online;
    body = body || {};
    if (online.data.name) body.name = online.data.name;
    body.stats = this.myStats();
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(online.httpUrl('/players'), {
      method: 'POST',
      headers: { authorization: 'Bearer ' + online.data.token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        clearTimeout(timer);
        data = data && typeof data === 'object' ? data : {};
        if (!res.ok && !data.error) data.error = 'server';
        if (data.you) {
          self.data.you = data.you;
          self.data.friends = Array.isArray(data.friends) ? data.friends : [];
          self.data.at = Date.now();
          self.data.joined = true;
          self.save();
        }
        return data;
      });
    }, function (e) { clearTimeout(timer); throw e; });
  };

  /* In a room: make sure the server knows you, so the others can add you. */
  Friends.prototype.touch = function () {
    if (!this.available() || (this.data.joined && Date.now() - (this.data.at || 0) < TOUCH_MS)) return;
    this.request({}).catch(function () { /* next time */ });
  };

  /* After each game: the new stats go up for your friends to see. */
  Friends.prototype.gamePlayed = function () {
    var self = this;
    if (!this.available() || !this.data.joined) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(function () {
      self.request({}).then(function () { if (self.app.screen === 'friends') self.paint(); }, function () { /* next time */ });
    }, 1500);
  };

  Friends.prototype.add = function (code) { return this.request({ add: code }); };
  Friends.prototype.remove = function (code) { return this.request({ remove: code }); };

  /* Add next to someone in an online room. They may have only just arrived, so one more try.
     Then the room tells them (to: their place in the room), so their list updates too. */
  Friends.prototype.addFromRoom = function (code, name, to) {
    var self = this, tries = 0;
    if (this.adding[code]) return;
    this.adding[code] = true;
    var done = function () { delete self.adding[code]; if (self.online.room) self.online.renderLobby(); };
    var go = function () {
      self.add(code).then(function (data) {
        if (data.error === 'no-player' && tries++ < 1) { setTimeout(go, 2000); return; }
        if (data.error === 'no-player') UI.toast(esc('Couldn’t add ' + name + ' yet: they need the latest version of the app.'));
        else if (data.error) UI.toast(esc(data.message || 'Couldn’t add ' + name + '. Try again.'));
        else {
          UI.toast(esc('You and ' + name + ' are friends now. See how you compare under Friends.'));
          if (self.online.conn && to != null) self.online.conn.send({ t: 'friend', to: to });
        }
        done();
      }, function () {
        UI.toast('Can’t reach the server. Try again in a moment.');
        done();
      });
    };
    go();
  };

  /* Someone in the room says they've added you: check with the server, and say so if it's true. */
  Friends.prototype.addedBy = function (memberId) {
    var self = this, online = this.online;
    var member = online.room && online.room.members.filter(function (m) { return m.id === memberId; })[0];
    if (!member || !member.code || this.isFriend(member.code)) return;
    this.request({}).then(function () {
      if (!self.isFriend(member.code)) return;
      UI.toast(esc(member.name + ' added you as a friend. See how you compare under Friends.'));
      if (online.room) online.renderLobby();
    }, function () { /* next time */ });
  };

  /* ---------- home ---------- */

  Friends.prototype.people = function () {
    var me = { me: true, name: this.name() || 'You', code: this.code(), stats: this.app.stats || {} };
    return [me].concat(this.data.friends.map(function (f) {
      return { name: f.name, code: f.code, stats: f.stats || {}, updated: f.updated };
    }));
  };

  Friends.prototype.tileHtml = function () {
    if (!this.available()) return '';
    var n = this.data.friends.length, line;
    if (n) {
      // where you stand on wins, every game together
      var rows = S.standings(this.people(), 'all', 'won', false).rows;
      var mine = rows.filter(function (r) { return r.person.me; })[0];
      var level = rows.filter(function (r) { return !r.person.me && r.rank === 1; });
      if (!mine || !mine.rank) line = 'Finish a game to get on the leaderboard.';
      else if (mine.rank === 1 && level.length) line = 'You and ' + level[0].person.name + (level.length > 1 ? ' and others' : '') + ' share the top spot for wins.';
      else if (mine.rank === 1) line = 'You’re top for wins, out of you and ' + n + (n === 1 ? ' friend.' : ' friends.');
      else line = 'You’re ' + ordinal(mine.rank) + ' of ' + (n + 1) + ' for wins. ' + rows[0].person.name + ' is top.';
    } else {
      line = 'Add friends with a code and see who comes out on top in every game.';
    }
    return '<article class="mode-tile friends-tile">' +
      '<div class="online-top"><span class="online-icon">' + UI.icon.trophy + '</span>' +
      '<h2>Friends</h2><span class="chip friends-chip">' + (n ? n + (n === 1 ? ' friend' : ' friends') : 'Leaderboard') + '</span></div>' +
      '<p class="tag">' + esc(line) + '</p>' +
      '<div class="mode-actions"><button class="btn btn-primary" type="button" data-friends>' + (n ? 'See the leaderboard' : 'Add friends') + '</button></div>' +
      '</article>';
  };

  Friends.prototype.wireHome = function (root) {
    var self = this, b = root.querySelector('[data-friends]');
    if (b) b.addEventListener('click', function () { self.open(); });
  };

  /* A friend's invite link: …/?friend=K7PQ2MXD opens Friends with their code ready to add. */
  Friends.prototype.boot = function () {
    if (!this.available()) return;
    var m = (location.search + '&' + location.hash).match(/[?&#]friend=([A-Za-z0-9-]{8,24})/);
    if (!m) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* keep the address */ }
    if (this.app.screen === 'home' && !this.app.sheet) this.open({ code: m[1] });
  };

  /* ---------- the screen ---------- */

  Friends.prototype.open = function (opts) {
    opts = opts || {};
    this.app.closeSheet(true);
    this.app.show('friends');
    this.render(opts.code ? cleanCode(opts.code) : '');
    this.refresh();
  };

  Friends.prototype.refresh = function () {
    var self = this;
    if (!this.name()) { this.status = null; this.paint(); return; }   // a name first
    this.status = 'loading';
    this.paintNote();
    this.request({}).then(function (data) {
      self.status = data.error ? 'error' : null;
      self.message = data.message || (data.error ? 'Something went wrong on the server. Try again in a moment.' : '');
      self.paint();
    }, function () {
      self.status = 'offline';
      self.paint();
    });
  };

  Friends.prototype.render = function (prefill) {
    var self = this, app = this.app;
    $('screen-friends').innerHTML =
      '<header class="setup-head">' +
        '<button class="icon-btn" id="f-back" type="button" aria-label="Back to games">' + UI.icon.back + '</button>' +
        '<span class="wordmark">FRIENDS</span><span class="spacer"></span>' +
        '<button class="icon-btn" id="f-refresh" type="button" aria-label="Refresh">' + UI.icon.refresh + '</button>' +
      '</header>' +
      '<div class="setup-body friends-body">' +
        '<div id="f-note" role="status"></div>' +
        '<section class="invite friend-card" id="f-card"></section>' +
        '<section class="field" id="f-add">' +
          '<h3><label for="f-code">Add a friend</label></h3>' +
          '<div class="add-row">' +
            '<input class="text-input code-input friend-input" id="f-code" type="text" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="ABCD2345" value="' + esc(prefill || '') + '">' +
            '<button class="btn btn-primary" type="button" id="f-go">Add</button>' +
          '</div>' +
          '<p class="form-error" id="f-error" role="alert" hidden></p>' +
          '<p class="help" id="f-help">' + (prefill ? 'That’s the code from your friend’s invite link. Tap Add.' : 'Ask friends for their code: it’s under Friends on their phone. Or tap Add next to them in an online room.') + '</p>' +
        '</section>' +
        '<section class="board" id="f-board" aria-labelledby="f-board-title"></section>' +
      '</div>';
    $('f-back').addEventListener('click', function () { app.showHome(); });
    $('f-refresh').addEventListener('click', function () { self.refresh(); });
    var input = $('f-code');
    input.addEventListener('input', function () {
      var v = cleanCode(input.value);
      if (v !== input.value) input.value = v;
      $('f-error').hidden = true;
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') self.addTyped(); });
    $('f-go').addEventListener('click', function () { self.addTyped(); });
    $('f-board').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var v = self.view;
      if (b.dataset.fMode) { v.mode = b.dataset.fMode; self.save(); self.paintBoard(); }
      else if (b.dataset.fMetric) { v.metric = b.dataset.fMetric; self.save(); self.paintBoard(); }
      else if (b.dataset.fOnline) { v.online = b.dataset.fOnline === '1'; self.save(); self.paintBoard(); }
      else if (b.dataset.who != null) self.openPerson(b.dataset.who);
    });
    this.paint();
    if (prefill && this.name()) try { $('f-go').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };

  Friends.prototype.paint = function () {
    if (this.app.screen !== 'friends' || !$('f-card')) return;
    this.paintNote();
    this.paintCard();
    $('f-add').hidden = !this.name();
    this.paintBoard();
  };

  Friends.prototype.paintNote = function () {
    var el = $('f-note'), self = this;
    if (!el) return;
    var html = '';
    if (this.status === 'loading' && !this.code()) html = '<p class="lobby-note">Getting your friend code…</p>';
    else if (this.status === 'offline') {
      html = '<p class="lobby-note warn">Can’t reach the server right now.' +
        (this.data.at && this.data.friends.length ? ' Your friends’ stats are from ' + esc(ago(this.data.at)) + '.' : '') +
        ' <button class="link-btn" type="button" id="f-retry">Try again</button></p>';
    } else if (this.status === 'error') html = '<p class="lobby-note warn">' + esc(this.message) + '</p>';
    el.innerHTML = html;
    el.hidden = !html;
    var retry = $('f-retry');
    if (retry) retry.addEventListener('click', function () { self.refresh(); });
    var r = $('f-refresh');
    if (r) r.classList.toggle('spin', this.status === 'loading');
  };

  Friends.prototype.paintCard = function () {
    var self = this, card = $('f-card');
    if (!this.name()) {
      // first time: the name your friends will see (the same one rooms use)
      card.innerHTML =
        '<h2 class="friend-title">First, your name</h2>' +
        '<p class="invite-help">Your friends see it on the leaderboard, and so does everyone in a room with you.</p>' +
        '<div class="add-row">' +
          '<input class="text-input" id="o-name" type="text" maxlength="16" autocomplete="nickname" autocapitalize="words" enterkeyhint="go" spellcheck="false" placeholder="Your name">' +
          '<button class="btn btn-primary" type="button" id="f-name-go">Save</button>' +
        '</div>' +
        '<p class="form-error" id="o-error" role="alert" hidden></p>';
      var go = function () { if (self.online.readName()) self.refresh(); };
      $('f-name-go').addEventListener('click', go);
      $('o-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      return;
    }
    var code = this.code();
    card.innerHTML =
      '<p class="eyebrow">Your friend code</p>' +
      '<p class="room-code friend-code' + (code ? '' : ' waiting') + '"' + (code ? ' aria-label="Friend code ' + esc(code.split('').join(' ')) + '"' : '') + '>' + (code ? esc(showCode(code)) : '····-····') + '</p>' +
      '<p class="invite-help">Friends see you as <b>' + esc(this.name()) + '</b> <button class="link-btn inline" type="button" id="f-rename">Change</button></p>' +
      '<div class="invite-actions">' +
        '<button class="btn btn-primary" type="button" id="f-share"' + (code ? '' : ' disabled') + '>' + UI.icon.share + '<span>Share code</span></button>' +
        '<button class="btn btn-ghost" type="button" id="f-copy"' + (code ? '' : ' disabled') + '>Copy code</button>' +
      '</div>';
    $('f-rename').addEventListener('click', function () { self.openRename(); });
    $('f-share').addEventListener('click', function () { self.share(); });
    $('f-copy').addEventListener('click', function () { self.copy(code, 'Friend code copied.'); });
  };

  Friends.prototype.paintBoard = function () {
    var box = $('f-board');
    if (!box) return;
    var v = this.view, flash = this.flash;
    this.flash = null;
    if (v.mode !== 'all' && !CT.getMode(v.mode)) v.mode = 'all';
    var b = S.standings(this.people(), v.mode, v.metric, v.online);
    v.metric = b.metric.id;
    var pill = function (attr, value, label, on) {
      return '<button type="button" data-' + attr + '="' + value + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
    };
    var games = [{ id: 'all', label: 'Overall' }].concat(CT.listModes().map(function (m) { return { id: m.id, label: m.shortName || m.name }; }));
    var rows = b.rows.map(function (r) {
      var p = r.person;
      var value = r.value == null ? '–' : b.metric.fmt(r.value);
      var sub = S.summary(r.rec, b.metric, r.value, v.online);
      var said = (r.rank ? ordinal(r.rank) + ': ' : '') + p.name + (p.me ? ' (you)' : '') + ', ' +
        (r.value == null ? 'not counted yet' : b.metric.label + ' ' + value) + '. ' + sub + (p.me ? '' : '. Tap to compare.');
      return '<li><button type="button" class="board-row' + (p.me ? ' me' : '') + (r.rank == null ? ' unranked' : '') + (flash && p.code === flash ? ' fresh' : '') + '" data-who="' + (p.me ? '' : esc(p.code)) + '" aria-label="' + esc(said) + '">' +
        '<span class="rank' + (r.rank && r.rank <= 3 ? ' top' + r.rank : '') + '">' + (r.rank || '') + '</span>' +
        '<span class="avatar" style="--paint:' + (p.me ? 'var(--marigold)' : paintFor(p.code || p.name)) + '">' + esc(initial(p.name)) + '</span>' +
        '<span class="who"><span class="name">' + esc(p.name) + (p.me ? ' <small>you</small>' : '') + '</span>' +
        '<span class="sub">' + esc(sub) + '</span></span>' +
        '<span class="val">' + esc(value) + '</span>' +
      '</button></li>';
    }).join('');
    var friends = this.data.friends.length;
    var note = b.metric.note ? ' Only in games with ' + b.metric.note + ' on.' : '';
    var scrolled = Array.prototype.map.call(box.querySelectorAll('.pills'), function (row) { return row.scrollLeft; });
    box.innerHTML =
      '<h3 id="f-board-title">Leaderboard</h3>' +
      '<div class="pills" role="group" aria-label="Game">' + games.map(function (g) { return pill('f-mode', g.id, g.label, g.id === v.mode); }).join('') + '</div>' +
      '<div class="pills pills-sm" role="group" aria-label="Rank by">' + S.metrics(v.mode).map(function (m) { return pill('f-metric', m.id, m.label, m.id === v.metric); }).join('') + '</div>' +
      '<div class="seg seg-sm" role="group" aria-label="Which games count">' + pill('f-online', '0', 'All games', !v.online) + pill('f-online', '1', 'Online only', v.online) + '</div>' +
      '<ol class="board-list">' + rows + '</ol>' +
      (friends ? '' : '<p class="board-empty">No friends here yet. Share your code, or add theirs above, to see how you compare.</p>') +
      '<p class="help board-help">' + esc(b.metric.help + note) + ' ' +
        (v.online ? 'Counting only games in online rooms.' : 'Counting every game, against the computer too.') +
        (friends ? ' Tap anyone to compare.' : '') + '</p>';
    // each row of choices stays where it was scrolled to, moving only to bring the chosen one into view
    box.querySelectorAll('.pills').forEach(function (row, i) {
      row.scrollLeft = scrolled[i] || 0;
      var on = row.querySelector('[aria-pressed="true"]');
      if (!on) return;
      var from = on.offsetLeft - 16, to = on.offsetLeft + on.offsetWidth + 16 - row.clientWidth;
      if (row.scrollLeft > from) row.scrollLeft = Math.max(0, from);
      else if (row.scrollLeft < to) row.scrollLeft = to;
    });
  };

  /* ---------- adding, comparing, removing ---------- */

  Friends.prototype.addTyped = function () {
    var self = this, input = $('f-code'), btn = $('f-go');
    var code = cleanCode(input.value);
    var fail = function (text) {
      var err = $('f-error');
      if (err) { err.textContent = text; err.hidden = false; }
      if (btn) { btn.disabled = false; btn.textContent = 'Add'; }
    };
    if (code.length < 8) { fail('A friend code has 8 letters and numbers.'); input.focus(); return; }
    if (code === this.code()) { fail('That’s your own code. Share it with your friends so they can add you.'); return; }
    var already = this.isFriend(code);
    btn.disabled = true;
    btn.textContent = 'Adding…';
    $('f-error').hidden = true;
    this.add(code).then(function (data) {
      if (data.error) { fail(data.message || 'That didn’t work. Try again.'); return; }
      if (btn) { btn.disabled = false; btn.textContent = 'Add'; }
      if ($('f-code')) $('f-code').value = '';
      var help = $('f-help');
      if (help) help.textContent = 'Ask friends for their code: it’s under Friends on their phone. Or tap Add next to them in an online room.';
      var name = data.added ? data.added.name : 'They';
      UI.toast(esc(already ? name + ' is already your friend.' : 'You and ' + name + ' are friends now.'));
      self.status = null;
      self.flash = data.added ? data.added.code : null;
      self.paint();
    }, function () {
      fail('Can’t reach the server. Check your internet connection and try again.');
    });
  };

  /* You and a friend side by side (or just you), for the game the leaderboard shows. */
  Friends.prototype.openPerson = function (code) {
    var self = this, app = this.app, v = this.view;
    var people = this.people(), me = people[0];
    var them = code ? people.filter(function (p) { return p.code === code; })[0] : null;
    if (code && !them) return;
    var cols = them ? [them, me] : [me];
    var mode = v.mode === 'all' ? null : CT.getMode(v.mode);
    var lines = S.details(v.mode).map(function (m) {
      var vals = cols.map(function (p) { return m.get(S.recordFor(p.stats, v.mode, v.online), p.stats, v.online); });
      var best = -1;
      if (cols.length === 2 && !m.neutral && vals[0] != null && vals[1] != null && vals[0] !== vals[1]) best = (m.low ? vals[0] < vals[1] : vals[0] > vals[1]) ? 0 : 1;
      return '<tr><th scope="row">' + esc(m.label) + '</th>' + vals.map(function (x, i) {
        return '<td' + (i === best ? ' class="better"' : '') + '>' + (x == null ? '–' : esc(m.fmt(x))) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var title = them ? them.name + ' and you' : 'Your stats';
    var where = (mode ? mode.name : 'All games together') + (v.online ? ' · online games only' : '') + (them && them.updated ? ' · their stats from ' + ago(them.updated) : '');
    var sheet = app.openSheet('friend', app.sheetHead(esc(title)) +
      '<p class="sheet-sub">' + esc(where) + '</p>' +
      '<div class="vs-wrap"><table class="vs"><thead><tr><td></td>' + cols.map(function (p) { return '<th scope="col">' + esc(p.me ? 'You' : p.name) + '</th>'; }).join('') + '</tr></thead>' +
        '<tbody>' + lines + '</tbody></table></div>' +
      (them ? '<p class="help">Friend code ' + esc(showCode(them.code)) + '</p><div id="f-remove-box"><button class="btn btn-ghost btn-wide" type="button" id="f-remove">Remove friend</button></div>' : '') +
      '<button class="btn btn-primary" type="button" data-close>Done</button>', { label: title });
    app.wireClose(sheet);
    if (!them) return;
    $('f-remove').addEventListener('click', function () {
      $('f-remove-box').innerHTML = '<div class="confirm"><p>Remove ' + esc(them.name) + '? You’ll both drop off each other’s leaderboard. You can add each other again with your codes.</p>' +
        '<p class="form-error" id="f-remove-error" role="alert" hidden></p>' +
        '<div class="confirm-actions"><button class="btn btn-primary" type="button" id="f-remove-yes">Remove</button>' +
        '<button class="btn btn-ghost" type="button" id="f-remove-no">Keep</button></div></div>';
      $('f-remove-no').addEventListener('click', function () { self.openPerson(code); });
      $('f-remove-yes').addEventListener('click', function () {
        var yes = $('f-remove-yes');
        yes.disabled = true;
        yes.textContent = 'Removing…';
        self.remove(them.code).then(function (data) {
          if (data.error) throw new Error(data.message);
          app.closeSheet(true);
          UI.toast(esc(them.name + ' is no longer on your list.'));
          self.status = null;
          self.paint();
        }).catch(function () {
          yes.disabled = false;
          yes.textContent = 'Remove';
          var err = $('f-remove-error');
          if (err) { err.textContent = 'Can’t reach the server. Try again in a moment.'; err.hidden = false; }
        });
      });
    });
  };

  Friends.prototype.openRename = function () {
    var self = this, app = this.app;
    var sheet = app.openSheet('rename', app.sheetHead('Your name') +
      '<div class="online-form">' + this.online.nameField() +
        '<p class="form-error" id="o-error" role="alert" hidden></p>' +
        '<button class="btn btn-primary btn-wide" type="button" id="f-name-save">Save</button>' +
        '<p class="form-help">Friends see this name on the leaderboard, and so does everyone in a room with you.</p>' +
      '</div>', { label: 'Your name' });
    app.wireClose(sheet);
    var save = function () {
      if (!self.online.readName()) return;
      app.closeSheet(true);
      self.paint();
      self.refresh();
    };
    $('f-name-save').addEventListener('click', save);
    $('o-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
    try { $('o-name').focus({ preventScroll: true }); $('o-name').select(); } catch (e) { /* ignore */ }
  };

  Friends.prototype.share = function () {
    var self = this, code = this.code();
    if (!code) return;
    var url = location.href.split(/[?#]/)[0] + '?friend=' + code;
    var text = 'Add me as a friend in the Burns card game. My friend code is ' + showCode(code) + '.';
    if (navigator.share) {
      navigator.share({ title: 'Add me as a friend', text: text, url: url }).catch(function (e) {
        if (e && e.name !== 'AbortError') self.copy(text + ' ' + url, 'Invite copied. Paste it in a message to your friends.');
      });
    } else {
      this.copy(text + ' ' + url, 'Invite copied. Paste it in a message to your friends.');
    }
  };

  Friends.prototype.copy = function (text, done) {
    var ok = function () { UI.toast(esc(done)); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { window.prompt('Copy this:', text); });
    } else {
      window.prompt('Copy this:', text);
    }
  };

  UI.Friends = Friends;
})(window.CT);
