/* ==========================================================================
   ONLINE · the link to the game server
   Connection   keeps one phone connected to one room: says who it is,
                reconnects after a dropped signal or a locked screen, and
                keeps its idea of the game clock in step with the server's.
   RemoteSession  stands in for the engine's Session at an online table, so
                the Burns and Donkey table screens work unchanged: view(),
                act(), now() and on() look the same, but the game itself runs
                on the server and every view is that player's own.
   ========================================================================== */
(function (CT) {
  'use strict';

  var PROTOCOL = 1;
  var RETRY_MS = [400, 1000, 2000, 4000, 8000];
  var PING_MS = 4000;          // clock checks during a game
  var KEEPALIVE_MS = 25000;    // a tiny ping otherwise, so idle connections aren't dropped
  // Refusals that won't change by trying again.
  var FINAL = { 'no-room': 1, update: 1, 'no-mode': 1, full: 1, 'bad-hello': 1, replaced: 1, closed: 1 };

  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* ---------- the connection ---------- */

  /* new Connection({ server, code: 'new' | 'ABCD', hello: { token, name, mode?, size?, options? },
       on: { welcome, room, state, result, notice, error, status, bye } }) */
  function Connection(opts) {
    this.server = String(opts.server || '').replace(/\/+$/, '');
    this.code = opts.code || 'new';
    this.hello = opts.hello;
    this.on = opts.on || {};
    this.status = 'connecting';     // connecting → open ⇄ reconnecting; closed at the end
    this.tries = 0;
    this.queue = [];
    this.stopped = false;
    this.offset = null;             // server game time minus this phone's clock
    this.samples = [];
    this.syncing = false;           // during a game: check the clock often
    this.ws = null;
    this.connect();
  }

  Connection.prototype.emit = function (name, arg) {
    var fn = this.on[name];
    if (fn) try { fn(arg); } catch (e) { setTimeout(function () { throw e; }, 0); }
  };

  Connection.prototype.setStatus = function (s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  };

  Connection.prototype.isOpen = function () { return this.status === 'open'; };

  Connection.prototype.connect = function () {
    if (this.stopped) return;
    var self = this, ws;
    clearTimeout(this.retryTimer);
    this.setStatus(this.tries || this.welcomed ? 'reconnecting' : 'connecting');
    try { ws = new WebSocket(this.server + '/rooms/' + this.code); }
    catch (e) { this.retry(); return; }
    this.ws = ws;
    ws.onopen = function () {
      if (self.ws !== ws) return;
      var hello = { t: 'hello', v: PROTOCOL };
      for (var k in self.hello) hello[k] = self.hello[k];
      ws.send(JSON.stringify(hello));
    };
    ws.onmessage = function (e) { if (self.ws === ws) self.receive(e.data); };
    ws.onclose = function () {
      if (self.ws !== ws) return;
      self.ws = null;
      self.stopTimers();
      if (self.stopped) { self.setStatus('closed'); return; }
      self.emit('lost');
      self.retry();
    };
    ws.onerror = function () { /* onclose follows */ };
  };

  Connection.prototype.retry = function () {
    if (this.stopped) return;
    var self = this;
    var wait = RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)];
    this.tries++;
    this.setStatus(this.welcomed ? 'reconnecting' : 'connecting');
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(function () { self.connect(); }, wait);
  };

  /* Back in the app after the screen was off. A phone often keeps a dead
     connection looking alive, so check it answers; if not, start afresh. */
  Connection.prototype.wake = function () {
    if (this.stopped) return;
    if (!this.ws) { this.tries = 0; this.connect(); return; }
    if (this.status !== 'open') return;
    var self = this, ws = this.ws, heard = this.heardAt;
    this.ping();
    clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(function () {
      if (self.ws === ws && self.heardAt === heard) self.drop();
    }, 4000);
  };

  /* Give up on a connection that has gone quiet, and make a new one. */
  Connection.prototype.drop = function () {
    var ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onclose = ws.onmessage = ws.onopen = null;
    try { ws.close(); } catch (e) { /* already dead */ }
    this.stopTimers();
    this.emit('lost');
    this.tries = 0;
    this.connect();
  };

  Connection.prototype.live = function () { return !!this.ws && this.ws.readyState === 1 && this.status === 'open'; };

  Connection.prototype.receive = function (data) {
    this.heardAt = perfNow();
    if (data === 'pong') return;              // keep-alive answer
    var msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    switch (msg.t) {
      case 'welcome':
        this.code = msg.code;
        this.welcomed = true;
        this.tries = 0;
        this.setStatus('open');
        this.startTimers();
        while (this.queue.length) this.ws.send(this.queue.shift());
        this.emit('welcome', msg);
        break;
      case 'pong': this.pong(msg); break;
      case 'error':
        if (FINAL[msg.code]) this.stop();
        this.emit('error', msg);
        break;
      case 'bye': this.stop(); this.emit('bye', msg); break;
      default: this.emit(msg.t, msg);
    }
  };

  Connection.prototype.send = function (msg) {
    var data = JSON.stringify(msg);
    if (this.live()) this.ws.send(data);
    else this.queue.push(data);
  };

  Connection.prototype.stop = function () {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.stopTimers();
    var ws = this.ws;
    this.ws = null;
    if (ws) try { ws.close(1000); } catch (e) { /* closed */ }
    this.setStatus('closed');
  };

  /* ---------- keeping time with the server ---------- */

  Connection.prototype.startTimers = function () {
    var self = this;
    this.stopTimers();
    this.heardAt = perfNow();
    this.ping();
    this.pingTimer = setInterval(function () { if (self.syncing) self.ping(); }, PING_MS);
    this.keepTimer = setInterval(function () {
      if (!self.syncing && self.live()) self.ws.send('ping');
    }, KEEPALIVE_MS);
    // a connection that has stopped answering is dead, even if the phone hasn't noticed
    this.watchTimer = setInterval(function () {
      if (!self.ws || self.status !== 'open' || document.hidden) return;
      var quiet = perfNow() - (self.heardAt || 0);
      if (self.ws.readyState > 1 || quiet > (self.syncing ? 10000 : KEEPALIVE_MS * 2 + 10000)) self.drop();
    }, 2000);
  };

  Connection.prototype.stopTimers = function () {
    clearInterval(this.pingTimer);
    clearInterval(this.keepTimer);
    clearInterval(this.watchTimer);
    clearTimeout(this.probeTimer);
  };

  Connection.prototype.ping = function () {
    if (this.live()) this.ws.send(JSON.stringify({ t: 'ping', c: perfNow() }));
  };

  /* The quickest recent round trip gives the best estimate of the server's clock. */
  Connection.prototype.pong = function (msg) {
    if (msg.gt == null || typeof msg.c !== 'number') return;
    var now = perfNow(), rtt = now - msg.c;
    this.samples.push({ rtt: rtt, offset: msg.gt + rtt / 2 - now, at: now });
    this.samples = this.samples.filter(function (s) { return now - s.at < 60000; }).slice(-12);
    var best = this.samples.reduce(function (a, b) { return b.rtt < a.rtt ? b : a; });
    this.offset = best.offset;
    this.rtt = best.rtt;
  };

  /* Every view comes with the server's game time: a first estimate, and a
     reset if the game clock was stopped and started while we were away. */
  Connection.prototype.syncFrom = function (gt) {
    if (typeof gt !== 'number') return;
    var now = perfNow();
    if (this.offset == null || Math.abs(now + this.offset - gt) > 1500) {
      this.offset = gt - now;
      this.samples = [];
    }
  };

  Connection.prototype.gameNow = function () { return perfNow() + (this.offset || 0); };

  /* ---------- a game seen from one seat ---------- */

  function RemoteSession(conn, first) {
    this.conn = conn;
    this.remote = true;
    this.me = first.view.me;
    this.game = first.game;
    this.mode = CT.getMode(first.view.mode);
    this.listeners = [];
    this.events = [];
    this.latest = null;
    this.state = { players: [], events: this.events, phase: null, seq: 0, options: {} };
    this.pending = {};
    this.nextId = 1;
    this.race = null;
    this.apply(first, true);
  }

  RemoteSession.prototype.apply = function (msg, quiet) {
    var v = msg.view;
    var incoming = v.events || [];
    delete v.events;
    if (msg.reset) this.events.length = 0;
    var lastSeq = this.events.length ? this.events[this.events.length - 1].seq : 0;
    for (var i = 0; i < incoming.length; i++) if (incoming[i].seq > lastSeq) this.events.push(incoming[i]);
    if (this.events.length > 800) this.events.splice(0, this.events.length - 800);
    this.latest = v;
    var st = this.state;
    st.players = v.players;
    st.phase = v.phase;
    st.seq = v.seq;
    st.options = v.options;
    st.winners = v.winners;
    // when a race showed on this screen, so the reaction is timed on this phone
    if (v.canReact) {
      var key = v.round + ':' + (v.race && v.race.startAt);
      if (!this.race || this.race.key !== key) this.race = { key: key, at: perfNow() };
    }
    this.conn.syncFrom(msg.gt);
    if (!quiet) for (var j = 0; j < this.listeners.length; j++) this.listeners[j]({ type: 'remote' });
  };

  RemoteSession.prototype.view = function (pid, opts) {
    opts = opts || {};
    var v = JSON.parse(JSON.stringify(this.latest));
    if (opts.events !== false) {
      var since = opts.sinceSeq || 0;
      v.events = JSON.parse(JSON.stringify(this.events.filter(function (e) { return e.seq > since; })));
    }
    return v;
  };

  /* Moves go to the server; the answer comes back a moment later, to `done`.
     Returns { pending: true } so the table knows to wait for it. */
  RemoteSession.prototype.act = function (pid, type, payload, done) {
    if (!this.conn.live()) return CT.fail('offline', 'The connection dropped. Reconnecting…');
    payload = JSON.parse(JSON.stringify(payload || {}));
    if (type === 'react' && this.race) payload.ms = Math.round(perfNow() - this.race.at);
    var id = this.nextId++;
    this.pending[id] = done || function () {};
    this.conn.send({ t: 'act', id: id, type: type, payload: payload });
    return { ok: true, pending: true };
  };

  RemoteSession.prototype.result = function (msg) {
    var done = this.pending[msg.id];
    if (!done) return;
    delete this.pending[msg.id];
    done(msg.res || CT.fail('error', 'Something went wrong. Try again.'));
  };

  /* The connection dropped: nothing in flight will be answered now. */
  RemoteSession.prototype.dropPending = function () {
    var pending = this.pending;
    this.pending = {};
    for (var id in pending) pending[id](CT.fail('offline', 'The connection dropped. Reconnecting…'));
  };

  RemoteSession.prototype.now = function () { return this.conn.gameNow(); };

  RemoteSession.prototype.on = function (fn) {
    var list = this.listeners;
    list.push(fn);
    return function () { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  };

  // The server keeps time and runs the computer players; nothing to do here.
  RemoteSession.prototype.tick = function () {};
  RemoteSession.prototype.pause = function () {};
  RemoteSession.prototype.resume = function () {};
  RemoteSession.prototype.serialize = function () { return null; };

  CT.Net = { PROTOCOL: PROTOCOL, Connection: Connection, RemoteSession: RemoteSession };
})(window.CT);
