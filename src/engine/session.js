/* ==========================================================================
   CARD TABLE ENGINE · session
   Runs one game of any registered mode: owns the state, a pausable game
   clock, action dispatch, timed rule steps (tick) and computer players.
   The UI only ever talks to a Session; a future online version can swap the
   Session for a network client with the same act/view/on surface.
   ========================================================================== */
(function (CT) {
  'use strict';

  function realNow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /** Game time in ms. Stops while paused (app in background), survives reloads. */
  function Clock(startAt) {
    this.base = startAt || 0;
    this.since = realNow();
    this.running = true;
  }
  Clock.prototype.now = function () {
    return this.running ? this.base + (realNow() - this.since) : this.base;
  };
  Clock.prototype.pause = function () {
    if (!this.running) return;
    this.base = this.now();
    this.running = false;
  };
  Clock.prototype.resume = function () {
    if (this.running) return;
    this.since = realNow();
    this.running = true;
  };

  /** Manually advanced clock for tests and simulations. */
  function ManualClock(startAt) { this.t = startAt || 0; }
  ManualClock.prototype.now = function () { return this.t; };
  ManualClock.prototype.advance = function (ms) { this.t += ms; };
  ManualClock.prototype.pause = function () {};
  ManualClock.prototype.resume = function () {};

  /**
   * new Session({ modeId, players:[{id,name,isBot}], options, seed, timing, clock })
   * or Session.restore(saved)
   */
  function Session(config) {
    // `mode` lets a caller pass a variant of a registered mode (the tutorial
    // uses Burns with scripted computer players).
    this.mode = config.mode || CT.getMode(config.modeId);
    if (!this.mode) throw new Error('Unknown game mode: ' + config.modeId);
    this.clock = config.clock || new Clock(0);
    this.state = config.state || this.mode.createGame({
      players: config.players,
      options: config.options,
      seed: config.seed,
      timing: config.timing,
      now: this.clock.now()
    });
    // each player's stats for this game, counted from its events as they
    // happen (a game saved before there were stats counts from here on)
    if (!this.state.tally) {
      this.state.tally = {};
      this.state.tallySeq = config.state ? (this.state.seq || 0) : 0;
    }
    this._count();
    this.botRng = CT.makeRng((config.botSeed != null ? config.botSeed : (this.state.rng ^ 0x9E3779B9)) >>> 0);
    this.botPlans = {};
    this.botMemory = {};
    this.listeners = [];
  }

  Session.prototype.now = function () { return this.clock.now(); };

  Session.prototype.on = function (fn) {
    var list = this.listeners;
    list.push(fn);
    return function () { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  };

  Session.prototype._changed = function (info) {
    this._count();
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](info);
  };

  /* New events go into each player's stats for this game (mode.stats.count). */
  Session.prototype._count = function () {
    var stats = this.mode.stats, s = this.state;
    if (!stats || !stats.count || !s.events || !s.tally) return;
    var from = s.tallySeq || 0;
    if ((s.seq || 0) < from) from = 0;      // renumbered (a tutorial lays out its own table)
    for (var i = 0; i < s.events.length; i++) {
      var e = s.events[i];
      if (!(e.seq > from)) continue;
      try { stats.count(s.tally, e, s); } catch (err) { /* a stat must never stop a game */ }
      from = e.seq;
    }
    s.tallySeq = from;
  };

  /** Apply a player's action. Returns the mode's { ok, code, message, … }. */
  Session.prototype.act = function (playerId, type, payload) {
    var res = this.mode.act(this.state, playerId, type, payload || {}, this.now());
    if (res.ok) this._changed({ by: playerId, type: type });
    return res;
  };

  /** Advance timed rule steps and let computer players act. Call ~20×/s. */
  Session.prototype.tick = function () {
    var now = this.now();
    if (this.mode.tick(this.state, now)) this._changed({ type: 'tick' });
    this._runBots(now);
  };

  Session.prototype._runBots = function (now) {
    var bot = this.mode.bot;
    if (!bot) return;
    var players = this.state.players;
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!p.isBot) continue;
      var view = this.mode.view(this.state, p.id, { events: false });
      var intent = bot.intent(view);
      if (!intent) { delete this.botPlans[p.id]; continue; }
      var plan = this.botPlans[p.id];
      if (!plan || plan.key !== intent.key) {
        plan = this.botPlans[p.id] = { key: intent.key, at: now + bot.delay(intent, view, this.botRng, now) };
      }
      if (now < plan.at) continue;
      var memory = this.botMemory[p.id] || (this.botMemory[p.id] = {});
      var action = bot.decide(view, memory, this.botRng);
      delete this.botPlans[p.id];
      if (!action) continue;
      var res = this.act(p.id, action.type, action.payload);
      if (!res.ok) {
        // Lost a race (card already taken, still cooling down…): think again shortly.
        this.botPlans[p.id] = { key: intent.key, at: now + (res.retryInMs || 0) + 250 };
      }
      now = this.now();
    }
  };

  /* What one player may see, with their own stats for this game so far. */
  Session.prototype.view = function (playerId, opts) {
    var v = this.mode.view(this.state, playerId, opts || {});
    if (v && this.state.tally) v.tally = JSON.parse(JSON.stringify(this.state.tally[playerId] || {}));
    return v;
  };

  Session.prototype.pause = function () { this.clock.pause(); };
  Session.prototype.resume = function () { this.clock.resume(); };

  Session.prototype.serialize = function () {
    return {
      kind: 'card-table-session',
      modeId: this.mode.id,
      engineVersion: this.state.engineVersion,
      clock: this.clock.now(),
      state: this.state
    };
  };

  /** Rebuild a session from serialize() output. Returns null when incompatible. */
  Session.restore = function (saved) {
    if (!saved || saved.kind !== 'card-table-session') return null;
    var mode = CT.getMode(saved.modeId);
    if (!mode || !saved.state || mode.engineVersion !== saved.engineVersion) return null;
    try {
      return new Session({ modeId: saved.modeId, state: saved.state, clock: new Clock(saved.clock || 0) });
    } catch (e) {
      return null;
    }
  };

  CT.Clock = Clock;
  CT.ManualClock = ManualClock;
  CT.Session = Session;
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
