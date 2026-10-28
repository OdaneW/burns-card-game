/* ==========================================================================
   ONLINE · chat and quick reactions
   Everyone in a room can send messages and quick reactions: a laughing face,
   a crying one, a sad one and more. A reaction pops up and moves over the
   sender's seat at the table (or by their name in the room) on everyone's
   screen; a message goes into the chat and pops up for a moment by whoever
   sent it. The chat button sits in the room's header and in the table's top
   bar, with a count of messages not read yet.
   The faces are drawn here (the same on every phone), and their movement
   is in styles.css.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;

  var PAINTS = ['#F4B942', '#F0643C', '#7FD1C1', '#C9A8F0', '#9BC76B', '#F59BB8'];   // as in the room's list
  var REACT_GAP_MS = 550;       // the server takes one every half second from each person
  var CHAT_MAX = 200;
  var SHOW_MS = 3300;           // a reaction on screen
  var KEEP = 80;                // chat lines kept on this phone

  UI.icon.chat = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4.5 4.5h15a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H11l-5 4v-4H4.5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z"/>' +
    '<path d="M8.5 11.6q3.5 3 7 0"/><circle cx="9" cy="8.6" r=".9" fill="currentColor" stroke="none"/><circle cx="15" cy="8.6" r=".9" fill="currentColor" stroke="none"/></svg>';

  /* ---------- the faces ---------- */

  var INK = '#4A2E12', TEAR = '#7CC6F2';
  function heart(cx, cy, s, cls, fill) {
    return '<path class="' + (cls || '') + '" fill="' + (fill || '#E8344E') + '" d="M' + cx + ' ' + (cy + s * 0.9) +
      'C' + (cx - s * 1.5) + ' ' + (cy + s * 0.05) + ' ' + (cx - s * 0.95) + ' ' + (cy - s * 1.05) + ' ' + cx + ' ' + (cy - s * 0.35) +
      'C' + (cx + s * 0.95) + ' ' + (cy - s * 1.05) + ' ' + (cx + s * 1.5) + ' ' + (cy + s * 0.05) + ' ' + cx + ' ' + (cy + s * 0.9) + 'Z"/>';
  }
  function line(d, w) { return '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="' + (w || 5) + '" stroke-linecap="round" stroke-linejoin="round"/>'; }

  /* Each face: what moves with the head (inside .rx-body) and what floats
     about it (tears squirting, steam, hearts, Zs). */
  var FACES = {
    laugh: {
      label: 'Laughing',
      body: line('M27 40l12 6-12 6') + line('M73 40l-12 6 12 6') +
        '<path d="M25 58h50q-3 27-25 27t-25-27z" fill="' + INK + '"/><path d="M29 59h42v6H29z" fill="#fff"/>' +
        '<ellipse cx="50" cy="77" rx="12" ry="5.5" fill="#F0643C"/>' +
        '<path class="rx-tear rx-tl" d="M21 46q-6 8 0 12q6-4 0-12z" fill="' + TEAR + '"/>' +
        '<path class="rx-tear rx-tr" d="M79 46q6 8 0 12q-6-4 0-12z" fill="' + TEAR + '"/>'
    },
    cry: {
      label: 'Crying',
      body: line('M27 37q7-7 15-3M73 37q-7-7-15-3', 4) + line('M28 47q7-7 14 0M58 47q7-7 14 0', 4.5) +
        '<path class="rx-wail" d="M34 76q16-24 32 0q-16 7-32 0z" fill="' + INK + '"/>' +
        '<path class="rx-stream" d="M35 50V86" stroke="' + TEAR + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="7 6" fill="none"/>' +
        '<path class="rx-stream" d="M65 50V86" stroke="' + TEAR + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="7 6" fill="none"/>'
    },
    sad: {
      label: 'Sad',
      body: line('M27 39l12-5M73 39l-12-5', 4) +
        '<circle cx="37" cy="48" r="4.6" fill="' + INK + '"/><circle cx="63" cy="48" r="4.6" fill="' + INK + '"/>' +
        line('M36 74q14-12 28 0') +
        '<path class="rx-drop" d="M33 55q-4.5 7 0 10q4.5-3 0-10z" fill="' + TEAR + '"/>'
    },
    wow: {
      label: 'Shocked',
      body: line('M27 29q9-7 17 0M56 29q9-7 17 0', 4) +
        '<g class="rx-eyes"><circle cx="37" cy="45" r="9.5" fill="#fff" stroke="' + INK + '" stroke-width="3"/><circle cx="37" cy="46" r="3.8" fill="' + INK + '"/>' +
        '<circle cx="63" cy="45" r="9.5" fill="#fff" stroke="' + INK + '" stroke-width="3"/><circle cx="63" cy="46" r="3.8" fill="' + INK + '"/></g>' +
        '<ellipse class="rx-o" cx="50" cy="72" rx="7.5" ry="9.5" fill="' + INK + '"/>'
    },
    angry: {
      label: 'Angry',
      body: '<circle class="rx-flush" cx="50" cy="52" r="38.5" fill="#F0643C" opacity="0"/>' +
        line('M26 35l15 8M74 35l-15 8') +
        '<circle cx="38" cy="49" r="4.4" fill="' + INK + '"/><circle cx="62" cy="49" r="4.4" fill="' + INK + '"/>' +
        '<rect x="34" y="65" width="32" height="11" rx="4" fill="#fff" stroke="' + INK + '" stroke-width="3"/>' +
        '<path d="M42.5 65v11M50 65v11M57.5 65v11" stroke="' + INK + '" stroke-width="2"/>',
      out: '<g class="rx-puff rx-p1"><circle cx="15" cy="24" r="6" fill="#EEF2F3"/><circle cx="21" cy="19" r="5" fill="#EEF2F3"/></g>' +
        '<g class="rx-puff rx-p2"><circle cx="85" cy="24" r="6" fill="#EEF2F3"/><circle cx="79" cy="19" r="5" fill="#EEF2F3"/></g>'
    },
    love: {
      label: 'Love it',
      body: '<g class="rx-heyes">' + heart(36, 46, 10) + heart(64, 46, 10) + '</g>' + line('M32 64q18 19 36 0'),
      out: heart(16, 78, 6, 'rx-fh rx-f1') + heart(84, 72, 5, 'rx-fh rx-f2') + heart(50, 92, 5, 'rx-fh rx-f3', '#F59BB8')
    },
    cool: {
      label: 'Cool',
      body: line('M38 70q13 8 25-3') +
        '<g class="rx-shades"><path d="M15 43l8-1M85 43l-8-1" stroke="#1D2633" stroke-width="3.5" stroke-linecap="round"/>' +
        '<rect x="22" y="38" width="25" height="16" rx="7" fill="#1D2633"/><rect x="53" y="38" width="25" height="16" rx="7" fill="#1D2633"/>' +
        '<rect x="45" y="41" width="10" height="4" fill="#1D2633"/>' +
        '<path d="M27 43l6 0M58 43l6 0" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/></g>',
      out: '<path class="rx-spark" d="M82 22l2.4 6.6 6.6 2.4-6.6 2.4L82 40l-2.4-6.6-6.6-2.4 6.6-2.4z" fill="#fff"/>'
    },
    sleepy: {
      label: 'Sleepy',
      body: line('M29 48q8 6 16 0M55 48q8 6 16 0', 4.5) +
        '<ellipse class="rx-breath" cx="50" cy="71" rx="5.5" ry="4.5" fill="' + INK + '"/>',
      out: '<path class="rx-z rx-z1" d="M70 30h8l-8 9h8" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path class="rx-z rx-z2" d="M78 18h10l-10 11h10" fill="none" stroke="#fff" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path class="rx-z rx-z3" d="M87 5h12l-12 13h12" fill="none" stroke="#fff" stroke-width="3.8" stroke-linejoin="round" stroke-linecap="round"/>'
    }
  };
  var ORDER = ['laugh', 'cry', 'sad', 'wow', 'angry', 'love', 'cool', 'sleepy'];

  function faceSvg(kind) {
    var f = FACES[kind];
    if (!f) return '';
    return '<svg class="rx rx-' + kind + '" viewBox="0 0 100 100" aria-hidden="true">' +
      '<g class="rx-body">' +
        '<circle cx="50" cy="52" r="40" fill="#FFCD3C" stroke="#E2A21A" stroke-width="3"/>' +
        '<ellipse cx="37" cy="29" rx="13" ry="6.5" fill="#FFF1BF" opacity=".6" transform="rotate(-24 37 29)"/>' +
        f.body +
      '</g>' + (f.out || '') + '</svg>';
  }
  UI.reactionFace = faceSvg;
  UI.reactions = ORDER.map(function (id) { return { id: id, label: FACES[id].label }; });

  /* ---------- where someone is on the screen ---------- */

  function layer() {
    var el = document.getElementById('rx-layer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rx-layer';
      el.className = 'rx-layer';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    return el;
  }

  /* A seat at the table, and the face on it (the avatar, if it has one).
     Your own place has no seat of its own in some games: then the strip
     above your hand. */
  function seatAnchor(pid, me) {
    var root = document.getElementById('screen-table');
    if (!root) return null;
    var seat = root.querySelector('[data-pid="' + pid + '"]');
    if (!seat && pid === me) seat = root.querySelector('#t-me, #d-me, #b-me');
    if (!seat) return null;
    return { box: seat, face: seat.querySelector('.sm-fig, .avatar, .dk-avatar, .me-info') || seat };
  }

  function visible(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return r.width && r.height && r.bottom > 0 && r.top < window.innerHeight ? r : null;
  }

  /* ---------- chat and reactions for one room ---------- */

  function Social(online) {
    this.online = online;
    this.code = null;       // the room these lines belong to
    this.lines = [];        // { id, from, name, text, at } or { sys: true, text }
    this.lastSeen = 0;      // the newest message read
    this.unread = 0;
    this.isOpen = false;
    this.lastReact = 0;
    this.shown = {};        // memberId → the reaction or message on screen now
  }

  Social.prototype.app = function () { return this.online.app; };
  Social.prototype.you = function () { return this.online.you; };
  Social.prototype.member = function (id) {
    var r = this.online.room;
    return r ? r.members.filter(function (m) { return m.id === id; })[0] || null : null;
  };
  Social.prototype.paint = function (id) {
    var r = this.online.room;
    var i = r ? r.members.map(function (m) { return m.id; }).indexOf(id) : -1;
    return PAINTS[(i < 0 ? id : i) % PAINTS.length];
  };

  /* Off to another room, or out of rooms altogether. */
  Social.prototype.reset = function () {
    this.code = null;
    this.lines = [];
    this.lastSeen = 0;
    this.unread = 0;
    this.close();
    this.clearAll();
    this.badges();
  };

  /* Everything popping up goes (the screen is changing under it). */
  Social.prototype.clearAll = function () {
    for (var key in this.shown) { clearTimeout(this.shown[key].timer); var el = this.shown[key].el; if (el.parentNode) el.parentNode.removeChild(el); }
    this.shown = {};
  };

  /* The messages so far, as the server sends them when we join or come back.
     Joining: all of it counts as read. Back after a dropped connection: what
     we missed is new. */
  Social.prototype.history = function (code, list) {
    var self = this;
    list = Array.isArray(list) ? list : [];
    if (this.code !== code) {
      this.reset();
      this.code = code;
      this.lines = list.slice(-KEEP);
      this.lastSeen = list.length ? list[list.length - 1].id : 0;
    } else {
      // what was said while we were away comes after what we had
      var have = {};
      this.lines.forEach(function (l) { if (l.id) have[l.id] = true; });
      list.forEach(function (l) { if (!have[l.id]) self.lines.push(l); });
      if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
      this.countUnread();
    }
    this.renderLog();
    this.badges();
  };

  Social.prototype.countUnread = function () {
    var you = this.you(), seen = this.lastSeen;
    this.unread = this.isOpen ? 0 : this.lines.filter(function (l) { return l.id > seen && l.from !== you; }).length;
  };

  /* One new message, from anyone (our own come back this way too). */
  Social.prototype.receive = function (line) {
    if (!line || !line.id || this.lines.some(function (l) { return l.id === line.id; })) return;
    this.lines.push(line);
    if (this.lines.length > KEEP) this.lines.shift();
    var mine = line.from === this.you();
    if (this.isOpen || mine) this.lastSeen = Math.max(this.lastSeen, line.id);
    this.countUnread();
    this.appendLine(line);
    this.badges();
    this.showMessage(line);
    if (!mine) UI.Sound.play('pop');
  };

  /* Someone arrived or went: a quiet line in the chat. */
  Social.prototype.note = function (text) {
    this.lines.push({ sys: true, text: text, at: Date.now() });
    if (this.lines.length > KEEP) this.lines.shift();
    this.appendLine(this.lines[this.lines.length - 1]);
  };

  /* People joining and leaving, from one list of members to the next. */
  Social.prototype.members = function (before, after) {
    if (!before || !after || before.code !== after.code) return;
    var self = this, was = {}, now = {};
    before.members.forEach(function (m) { was[m.id] = m; });
    after.members.forEach(function (m) { now[m.id] = m; });
    after.members.forEach(function (m) { if (!was[m.id] && m.id !== self.you()) self.note(m.name + ' joined the room.'); });
    before.members.forEach(function (m) { if (!now[m.id]) self.note(m.name + ' left the room.'); });
  };

  /* ---------- reactions ---------- */

  Social.prototype.react = function (kind) {
    var now = Date.now();
    if (!FACES[kind] || now - this.lastReact < REACT_GAP_MS || !this.online.conn) return false;
    this.lastReact = now;
    this.online.conn.send({ t: 'react', r: kind });
    this.showReaction(this.you(), kind);
    UI.Sound.play('pop');
    return true;
  };

  /* From the server: everyone's, ours included (already on screen). */
  Social.prototype.reaction = function (msg) {
    if (!msg || msg.from === this.you() || !FACES[msg.r]) return;
    this.showReaction(msg.from, msg.r);
    UI.Sound.play('pop');
  };

  /* Where to show something from this person: by their seat or their name
     ({ face, box }), or null: a sheet is up, or they're not at this table, so
     it goes at the top with their name. */
  Social.prototype.anchor = function (memberId) {
    var app = this.app();
    if (app.sheet) return null;
    if (app.screen === 'lobby') {
      var row = document.querySelector('#screen-lobby [data-member="' + memberId + '"]');
      var face = row && (row.querySelector('.avatar') || row);
      return visible(face) ? { face: face, box: face } : null;
    }
    if (app.screen === 'table' && app.session && app.session.remote) {
      var m = this.member(memberId);
      var a = m && m.pid ? seatAnchor(m.pid, app.table && app.table.me) : null;
      return a && visible(a.face) ? a : null;
    }
    return null;
  };

  Social.prototype.clearShown = function (id, kind) {
    var s = this.shown[id + ':' + kind];
    if (!s) return;
    clearTimeout(s.timer);
    if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
    delete this.shown[id + ':' + kind];
  };

  Social.prototype.showReaction = function (memberId, kind) {
    this.clearShown(memberId, 'rx');
    var el = document.createElement('div');
    var anchor = this.anchor(memberId);
    var m = this.member(memberId);
    var small = this.app().screen === 'lobby';
    el.className = 'rxpop' + (small ? ' small' : '') + (anchor ? '' : ' named');
    el.innerHTML = faceSvg(kind) + (anchor ? '' : '<span class="rx-name">' + UI.esc(memberId === this.you() ? 'You' : (m ? m.name : 'Someone')) + '</span>');
    layer().appendChild(el);
    var w = el.offsetWidth, h = el.offsetHeight, x, y;
    if (anchor) {
      var r = anchor.face.getBoundingClientRect();
      x = r.left + r.width / 2 - w / 2;
      y = r.top + r.height / 2 - h / 2 - (small ? 0 : 8);
    } else {
      x = window.innerWidth / 2 - w / 2;
      y = 58;
    }
    el.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, x))) + 'px';
    el.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, y))) + 'px';
    var self = this, key = memberId + ':rx';
    this.shown[key] = { el: el, timer: setTimeout(function () { self.clearShown(memberId, 'rx'); }, SHOW_MS) };
  };

  /* A message pops up for a moment by whoever sent it. */
  Social.prototype.showMessage = function (line) {
    if (this.isOpen) return;          // reading the chat already
    this.clearShown(line.from, 'msg');
    var anchor = this.anchor(line.from);
    var mine = line.from === this.you();
    var el = document.createElement('div');
    el.className = 'chat-pop';
    el.innerHTML = '<b class="who">' + UI.esc(mine ? 'You' : line.name) + '</b><span class="text">' + UI.esc(line.text) + '</span>';
    layer().appendChild(el);
    var w = el.offsetWidth, h = el.offsetHeight, x, y, below = true;
    if (anchor) {
      var f = anchor.face.getBoundingClientRect(), b = anchor.box.getBoundingClientRect();
      if (this.app().screen === 'lobby') {
        // beside their name in the list
        x = f.right + 10; y = f.top + f.height / 2 - h / 2; below = null;
      } else {
        // under a seat near the top of the screen, over one near the bottom; the tail to their face
        below = f.top + f.height / 2 < window.innerHeight / 2;
        x = f.left + f.width / 2 - w / 2;
        y = below ? b.bottom + 8 : b.top - h - 8;
      }
    } else {
      x = window.innerWidth / 2 - w / 2;
      y = 58;
    }
    el.classList.add(below == null ? 'beside' : below ? 'below' : 'above');
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, y))) + 'px';
    if (anchor && below != null) {
      var fr = anchor.face.getBoundingClientRect();
      el.style.setProperty('--tail', Math.round(Math.max(14, Math.min(w - 14, fr.left + fr.width / 2 - x))) + 'px');
    }
    var ms = Math.max(3500, Math.min(8000, 3000 + 60 * line.text.length));
    el.style.setProperty('--life', ms + 'ms');
    var self = this;
    this.shown[line.from + ':msg'] = { el: el, timer: setTimeout(function () { self.clearShown(line.from, 'msg'); }, ms) };
  };

  /* ---------- the chat button ---------- */

  Social.prototype.buttonHtml = function (id) {
    return '<button class="icon-btn chat-btn" type="button" id="' + id + '" aria-label="Chat and reactions">' + UI.icon.chat +
      '<span class="chat-badge" hidden></span></button>';
  };

  Social.prototype.wire = function (btn) {
    var self = this;
    if (!btn) return;
    btn.addEventListener('click', function () { UI.Sound.unlock(); if (self.isOpen) self.close(); else self.open(); });
    this.badges();
  };

  /* At an online table: the chat button goes in the game's top bar, before
     the music. If the bar gets too full (a narrow phone), the game's name
     makes way. */
  Social.prototype.mountTable = function () {
    this.clearAll();
    var bar = document.querySelector('#screen-table .topbar');
    if (!bar || bar.querySelector('.chat-btn')) return;
    var holder = document.createElement('span');
    holder.innerHTML = this.buttonHtml('t-chat');
    var btn = holder.firstChild;
    var music = bar.querySelector('[id$="-music"]');
    bar.insertBefore(btn, music || null);
    this.wire(btn);
    this.fitBar();
    var self = this;
    if (!this.onResize) {
      this.onResize = function () { self.fitBar(); };
      window.addEventListener('resize', this.onResize);
    }
    // the bar's chips change as the game goes ("Round 9", "Round 10"…): check again when they do
    if (this.barWatch) this.barWatch.disconnect();
    if (window.MutationObserver) {
      this.barWatch = new MutationObserver(function () { self.fitBar(); });
      this.barWatch.observe(bar, { childList: true, characterData: true, subtree: true });
    }
  };

  Social.prototype.fitBar = function () {
    var bar = document.querySelector('#screen-table .topbar');
    if (!bar || !bar.querySelector('.chat-btn')) return;
    var was = bar.classList.contains('tight');
    bar.classList.remove('tight');
    var tight = bar.scrollWidth > bar.clientWidth + 1;
    if (tight) bar.classList.add('tight');
    if (tight !== was && this.barWatch) this.barWatch.takeRecords();   // (our own change, not the game's)
  };

  Social.prototype.badges = function () {
    var n = this.unread;
    document.querySelectorAll('.chat-btn').forEach(function (b) {
      var badge = b.querySelector('.chat-badge');
      badge.hidden = !n;
      badge.textContent = n > 9 ? '9+' : String(n);
      b.setAttribute('aria-label', n ? 'Chat and reactions: ' + n + ' new ' + (n === 1 ? 'message' : 'messages') : 'Chat and reactions');
    });
  };

  /* ---------- the chat panel ---------- */

  Social.prototype.build = function () {
    if (this.panel) return;
    var self = this;
    var scrim = this.scrim = document.createElement('div');
    scrim.className = 'chat-scrim';
    scrim.hidden = true;
    var panel = this.panel = document.createElement('section');
    panel.className = 'chat-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat');
    panel.innerHTML =
      '<header class="chat-head"><h2>Chat</h2><span class="chat-sub" id="chat-sub"></span><span class="spacer"></span>' +
        '<button class="icon-btn" type="button" id="chat-close" aria-label="Close the chat">' + UI.icon.close + '</button></header>' +
      '<div class="chat-rx" role="group" aria-label="Quick reactions">' + ORDER.map(function (k) {
        return '<button type="button" class="rx-btn" data-rx="' + k + '" aria-label="' + FACES[k].label + '" title="' + FACES[k].label + '">' + faceSvg(k) + '</button>';
      }).join('') + '</div>' +
      '<ol class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="Messages"></ol>' +
      '<form class="chat-form" id="chat-form" autocomplete="off">' +
        '<input class="text-input chat-input" id="chat-input" type="text" maxlength="' + CHAT_MAX + '" enterkeyhint="send" spellcheck="true" placeholder="Say something…" aria-label="Message">' +
        '<button class="btn btn-primary chat-send" type="submit" id="chat-send">Send</button></form>';
    document.body.appendChild(scrim);
    document.body.appendChild(panel);
    this.log = panel.querySelector('#chat-log');
    this.input = panel.querySelector('#chat-input');
    scrim.addEventListener('click', function () { self.close(); });
    panel.querySelector('#chat-close').addEventListener('click', function () { self.close(); });
    panel.querySelectorAll('[data-rx]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!self.react(b.dataset.rx)) return;
        b.classList.remove('sent'); void b.offsetWidth; b.classList.add('sent');
        // a reaction is for the table to see: out of the way, unless a message is being written
        if (!self.input.value.trim()) self.close();
      });
    });
    panel.querySelector('#chat-form').addEventListener('submit', function (e) {
      e.preventDefault();
      self.sendText();
    });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') self.close(); });
    // the on-screen keyboard: keep the panel above it
    var vv = window.visualViewport;
    if (vv) {
      var fit = function () {
        if (!self.isOpen) return;
        var hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        panel.style.bottom = hidden ? hidden + 'px' : '';
        panel.style.maxHeight = hidden ? Math.max(200, vv.height - 16) + 'px' : '';
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
    }
  };

  Social.prototype.sendText = function () {
    var text = String(this.input.value || '').replace(/\s+/g, ' ').trim();
    if (!text || !this.online.conn) return;
    this.online.conn.send({ t: 'chat', text: text.slice(0, CHAT_MAX) });
    this.input.value = '';
  };

  Social.prototype.lineHtml = function (l) {
    if (l.sys) return '<li class="chat-line sys">' + UI.esc(l.text) + '</li>';
    var mine = l.from === this.you();
    return '<li class="chat-line' + (mine ? ' mine' : '') + '"><b class="who" style="color:' + this.paint(l.from) + '">' + UI.esc(mine ? 'You' : l.name) + '</b>' +
      '<span class="text">' + UI.esc(l.text) + '</span></li>';
  };

  Social.prototype.renderLog = function () {
    if (!this.log) return;
    var self = this;
    this.log.innerHTML = this.lines.length
      ? this.lines.map(function (l) { return self.lineHtml(l); }).join('')
      : '<li class="chat-empty">No messages yet. Say hello, or send a reaction.</li>';
    this.log.scrollTop = this.log.scrollHeight;
  };

  Social.prototype.appendLine = function (l) {
    if (!this.log || !this.isOpen) return;
    var empty = this.log.querySelector('.chat-empty');
    if (empty) empty.parentNode.removeChild(empty);
    var near = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 60;
    this.log.insertAdjacentHTML('beforeend', this.lineHtml(l));
    while (this.log.children.length > KEEP) this.log.removeChild(this.log.firstChild);
    if (near || l.from === this.you()) this.log.scrollTop = this.log.scrollHeight;
  };

  Social.prototype.open = function () {
    if (!this.online.room) return;
    this.build();
    this.isOpen = true;
    this.panel.querySelector('#chat-sub').textContent = 'Room ' + this.online.room.code;
    this.renderLog();
    var newest = this.lines.reduce(function (n, l) { return l.id > n ? l.id : n; }, 0);
    this.lastSeen = Math.max(this.lastSeen, newest);
    this.unread = 0;
    this.badges();
    // what was popping up is in the chat now
    for (var key in this.shown) if (/:msg$/.test(key)) this.clearShown(key.split(':')[0], 'msg');
    this.scrim.hidden = false;
    this.panel.hidden = false;
    this.log.scrollTop = this.log.scrollHeight;     // (only measurable once it's showing)
    this.panel.classList.remove('enter'); void this.panel.offsetWidth; this.panel.classList.add('enter');
    // a keyboard pops up on a phone: only go straight to typing on a computer
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) try { this.input.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  };

  Social.prototype.close = function () {
    if (!this.panel) { this.isOpen = false; return; }
    this.isOpen = false;
    if (document.activeElement === this.input) this.input.blur();
    this.panel.hidden = true;
    this.scrim.hidden = true;
    this.panel.style.bottom = this.panel.style.maxHeight = '';
  };

  UI.Social = Social;
})(window.CT);
