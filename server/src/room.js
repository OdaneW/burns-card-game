/* ==========================================================================
   ONLINE · one room on the game server
   Who's in the room, the lobby (the game, how many seats and the rule
   choices, all picked by the host), and the game itself, run with the same
   engine and computer players as the app. Everyone only ever receives their
   own view of the table, so nobody's phone holds anyone else's cards.

   Seats go to people in the order they joined; computer players take the
   rest. When someone's connection drops, the game carries on: after a few
   seconds a computer player looks after their seat, and they take it back
   the moment they reconnect. If nobody at the table is connected, the game
   clock stops until someone comes back.

   No platform code here: the Cloudflare Durable Object (worker.js) and the
   tests supply sockets, the clock, timers and storage through `io`:
     send(connId, msg)  close(connId, code, reason)  bind(connId, memberId)
     now()  random()  clock(startAt)  wake(ms)  persist(now?)
   ========================================================================== */
import CT from './engine.js';

export const PROTOCOL = 1;

const MAX_MEMBERS = 6;          // the biggest table (Burns seats six)
const NAME_MAX = 16;
const TICK_MS = 50;             // the game moves on 20 times a second, as in the app
const AWAY_MS = 6000;           // a dropped player's seat is played by the computer after this
const HOST_WAIT_MS = 45000;     // a host gone this long hands the room to someone who's here
const LOBBY_DROP_MS = 120000;   // someone gone from the lobby this long comes off the list
const CHECK_MS = 5000;          // how often to look again while someone is away
const QUIET_MS = 12000;         // during a game phones check in every 4 seconds; silence this long means gone
const BOT_NAMES = ['Mia', 'Dex', 'Rae', 'Kofi', 'Tess', 'Jun', 'Nia', 'Omar', 'Lena', 'Ravi', 'Zoe', 'Ike'];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function cleanName(s) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}

function cleanToken(s) {
  s = String(s || '');
  return /^[A-Za-z0-9_-]{16,64}$/.test(s) ? s : null;
}

function engineVersions() {
  const out = {};
  CT.listModes().forEach(m => { out[m.id] = m.engineVersion; });
  return out;
}

const ERRORS = {
  'no-room': 'There’s no room with that code. Check the code, or ask for a new link.',
  update: 'This room needs the latest version of the app. Update it from the menu screen, then try again.',
  full: 'This room is full: six people are already in it.',
  'bad-hello': 'Something went wrong joining the room. Try again.',
  replaced: 'You opened this room somewhere else, so this screen has stopped following it.',
  closed: 'This room has closed.'
};

export class RoomCore {
  constructor(io, saved) {
    this.io = io;
    this.conns = new Map();     // connId → memberId (null until they say hello)
    this.seen = new Map();      // connId → when we last heard from it
    this.room = null;
    this.session = null;
    this.dirty = false;
    if (saved) this.load(saved);
  }

  /* ---------- the room ---------- */

  exists() { return !!this.room; }

  create(code) {
    this.room = {
      code: code, created: this.io.now(),
      mode: null, size: null, options: {},
      members: [], host: null, nextId: 1,
      phase: 'lobby',             // lobby → playing → over → (playing again | lobby)
      gameNo: 0
    };
    this.io.persist(true);
  }

  member(id) {
    if (!this.room || id == null) return null;
    return this.room.members.find(m => m.id === id) || null;
  }
  active() { return this.room ? this.room.members.filter(m => !m.left) : []; }
  isHost(m) { return !!this.room && this.room.host === m.id; }
  player(pid) {
    return this.session ? this.session.state.players.find(p => p.id === pid) || null : null;
  }

  /* The first person here, or failing that the first person in the room. */
  pickHost() {
    const people = this.active();
    const here = people.find(m => m.connected);
    return here ? here.id : people.length ? people[0].id : null;
  }

  uniqueName(name, self) {
    const taken = n => this.active().some(m => m !== self && m.name.toLowerCase() === n.toLowerCase());
    if (!taken(name)) return name;
    for (let i = 2; i < 20; i++) {
      const suffix = ' ' + i;
      const n = Array.from(name).slice(0, NAME_MAX - suffix.length).join('').trim() + suffix;
      if (!taken(n)) return n;
    }
    return name;
  }

  sizeFor(mode, n) {
    n = Math.round(Number(n));
    if (!isFinite(n)) n = mode.players.default;
    return clamp(n, mode.players.min, mode.players.max);
  }

  configure(mode, size, options) {
    this.room.mode = mode.id;
    this.room.size = this.sizeFor(mode, size);
    this.room.options = CT.resolveOptions(mode.options, options && typeof options === 'object' ? options : {});
  }

  info() {
    const r = this.room;
    const seated = new Set(this.active().map(m => m.pid).filter(Boolean));
    return {
      code: r.code, phase: r.phase, gameNo: r.gameNo,
      mode: r.mode, size: r.size, options: r.options, host: r.host,
      members: this.active().map(m => ({ id: m.id, name: m.name, connected: m.connected, pid: m.pid, computer: m.computer })),
      // computer players at the table who aren't standing in for anyone
      bots: this.session ? this.session.state.players.filter(p => p.isBot && !seated.has(p.id)).map(p => ({ pid: p.id, name: p.name })) : []
    };
  }

  broadcastRoom() {
    if (!this.room) return;
    const msg = { t: 'room', room: this.info() };
    for (const [connId, id] of this.conns) if (id != null) this.io.send(connId, msg);
  }

  notice(m, message) { if (m.connId) this.io.send(m.connId, { t: 'notice', message: message }); }

  fail(connId, code) {
    this.io.send(connId, { t: 'error', code: code, message: ERRORS[code] || ERRORS['bad-hello'] });
    this.io.close(connId, 4000, code);
  }

  /* ---------- connections ---------- */

  open(connId) {
    this.conns.set(connId, null);
    this.seen.set(connId, this.io.now());
    if (!this.room) this.fail(connId, 'no-room');
  }

  /* A connection that stayed open while the server object slept. */
  reattach(connId, memberId) {
    this.conns.set(connId, memberId == null ? null : memberId);
    this.seen.set(connId, this.io.now());
    const m = this.member(memberId);
    if (m && !m.left) { m.connId = connId; m.connected = true; m.goneAt = null; }
  }

  disconnect(connId) {
    if (!this.conns.has(connId)) return;
    const id = this.conns.get(connId);
    this.conns.delete(connId);
    this.seen.delete(connId);
    const m = this.member(id);
    if (!m || m.connId !== connId) return;
    m.connId = null;
    m.connected = false;
    m.goneAt = this.io.now();
    // the last person at the table has gone: stop the clock until someone's back
    if (this.session && this.room.phase === 'playing' && !this.room.members.some(x => x.pid && x.connected && !x.left)) this.session.pause();
    this.broadcastRoom();
    this.io.persist(true);
    this.wake();
  }

  message(connId, msg) {
    if (!this.room || !msg || typeof msg !== 'object') return;
    this.seen.set(connId, this.io.now());
    if (msg.t === 'ping') {
      this.io.send(connId, { t: 'pong', c: msg.c, gt: this.session ? this.session.now() : null });
      return;
    }
    if (msg.t === 'hello') { this.hello(connId, msg); return; }
    const m = this.member(this.conns.get(connId));
    if (!m || m.left || m.connId !== connId) return;
    switch (msg.t) {
      case 'name': this.rename(m, msg.name); break;
      case 'setup': this.setup(m, msg); break;
      case 'start': this.start(m); break;
      case 'lobby': this.backToLobby(m); break;
      case 'act': this.act(m, msg); break;
      case 'leave': this.leave(m); break;
    }
  }

  /* Joining, or coming back: the token (kept on the person's device) is who
     they are, so a dropped connection or a reload finds the same seat. */
  hello(connId, msg) {
    if (msg.v !== PROTOCOL) { this.fail(connId, 'update'); return; }
    const token = cleanToken(msg.token);
    if (!token) { this.fail(connId, 'bad-hello'); return; }
    const r = this.room;
    let m = r.members.find(x => x.token === token && !x.left);
    if (m) {
      if (m.connId && m.connId !== connId) {
        const old = m.connId;
        this.conns.set(old, null);
        this.fail(old, 'replaced');
      }
      if (r.phase !== 'playing' && msg.name) m.name = this.uniqueName(cleanName(msg.name) || m.name, m);
    } else {
      if (this.active().length >= MAX_MEMBERS) { this.fail(connId, 'full'); return; }
      m = {
        id: r.nextId++, token: token, name: this.uniqueName(cleanName(msg.name) || 'Player', null),
        since: this.io.now(), goneAt: null, pid: null, computer: false, left: false
      };
      r.members.push(m);
      if (!this.member(r.host) || this.member(r.host).left) r.host = m.id;
      if (!r.mode) {
        // the room's creator says which game it's for
        const mode = CT.getMode(msg.mode) || CT.getMode('burns');
        this.configure(mode, msg.size, msg.options);
      }
    }
    m.connId = connId;
    m.connected = true;
    m.goneAt = null;
    m.seq = 0;
    this.conns.set(connId, m.id);
    this.io.bind(connId, m.id);
    if (m.computer) this.takeBack(m);
    this.io.send(connId, { t: 'welcome', protocol: PROTOCOL, code: r.code, you: m.id, engines: engineVersions() });
    this.broadcastRoom();
    if (this.session && m.pid) this.sendState(m, { reset: true });
    this.flush();
    this.io.persist(true);
    this.wake();
  }

  rename(m, name) {
    if (this.room.phase === 'playing') return;
    m.name = this.uniqueName(cleanName(name) || m.name, m);
    this.broadcastRoom();
    this.io.persist(true);
  }

  /* The host picks the game, the number of seats and the rule choices. */
  setup(m, msg) {
    if (!this.isHost(m)) { this.notice(m, 'Only the host can change the game.'); return; }
    if (this.room.phase === 'playing') return;
    const mode = CT.getMode(msg.mode != null ? msg.mode : this.room.mode);
    if (!mode) return;
    const same = mode.id === this.room.mode;
    this.configure(mode,
      msg.size != null ? msg.size : same ? this.room.size : mode.players.default,
      msg.options != null ? msg.options : same ? this.room.options : {});
    if (this.room.phase === 'over') this.backToLobby(m);
    this.broadcastRoom();
    this.io.persist(true);
  }

  /* ---------- the game ---------- */

  newSession(config) {
    const session = new CT.Session(Object.assign({ clock: this.io.clock(config.clockAt || 0) }, config));
    session.on(() => { this.dirty = true; });
    return session;
  }

  start(m) {
    if (!this.isHost(m)) { this.notice(m, 'Only the host can start the game.'); return; }
    const r = this.room;
    if (r.phase === 'playing') return;
    const mode = CT.getMode(r.mode);
    const size = this.sizeFor(mode, r.size);
    r.members = r.members.filter(x => !x.left);
    const humans = r.members.slice(0, size);
    const used = humans.map(h => h.name.toLowerCase());
    const pool = BOT_NAMES.filter(n => used.indexOf(n.toLowerCase()) < 0);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.io.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const players = humans.map((h, i) => ({ id: 'p' + i, name: h.name, isBot: false }));
    while (players.length < size) players.push({ id: 'p' + players.length, name: pool.shift() || 'Computer ' + players.length, isBot: true });
    r.members.forEach(x => { x.pid = null; x.computer = false; x.seq = 0; });
    humans.forEach((h, i) => { h.pid = 'p' + i; });
    this.session = this.newSession({
      modeId: mode.id, players: players, options: r.options,
      seed: (Math.floor(this.io.random() * 4294967296) >>> 0) || 1
    });
    r.phase = 'playing';
    r.gameNo += 1;
    this.dirty = false;
    this.broadcastRoom();
    humans.forEach(h => { if (h.connected) this.sendState(h, { reset: true, fresh: true }); });
    this.io.persist(true);
    this.wake();
  }

  act(m, msg) {
    const reply = res => { if (m.connId) this.io.send(m.connId, { t: 'result', id: msg.id, res: res }); };
    if (!this.session || this.room.phase !== 'playing' || !m.pid) {
      reply(CT.fail('not-playing', 'You’re not playing in this game.'));
      return;
    }
    const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
    this.session.resume();
    reply(this.session.act(m.pid, String(msg.type || ''), payload));
    this.flush();
    if (this.session.state.phase === 'over') this.gameOver();
  }

  /* A computer player looks after the seat of someone who's dropped out... */
  handOver(m) {
    const p = this.player(m.pid);
    if (p) p.isBot = true;
    m.computer = true;
    this.dirty = true;
    this.broadcastRoom();
  }

  /* ...until they're back. */
  takeBack(m) {
    const p = this.player(m.pid);
    if (p) {
      p.isBot = false;
      delete this.session.botPlans[m.pid];
    }
    m.computer = false;
    this.dirty = true;
  }

  sendState(m, opts) {
    if (!m.connId || !this.session || !m.pid) return;
    opts = opts || {};
    const v = this.session.view(m.pid, { sinceSeq: opts.reset ? 0 : (m.seq || 0) });
    m.seq = v.seq;
    this.io.send(m.connId, {
      t: 'state', game: this.room.gameNo, view: v, gt: this.session.now(),
      reset: !!opts.reset, fresh: !!opts.fresh
    });
  }

  /* After anything changes at the table, everyone gets their own view. */
  flush() {
    if (!this.dirty || !this.session) return;
    this.dirty = false;
    this.room.members.forEach(m => { if (m.pid && m.connected && !m.left) this.sendState(m); });
    this.io.persist();
  }

  gameOver() {
    if (this.room.phase !== 'playing') return;
    this.room.phase = 'over';
    this.broadcastRoom();
    this.io.persist(true);
  }

  backToLobby(m) {
    if (!this.isHost(m) || this.room.phase !== 'over') return;
    const r = this.room;
    r.phase = 'lobby';
    this.session = null;
    r.members = r.members.filter(x => !x.left);
    r.members.forEach(x => { x.pid = null; x.computer = false; });
    this.broadcastRoom();
    this.io.persist(true);
  }

  leave(m) {
    const r = this.room, connId = m.connId;
    m.left = true;
    m.connected = false;
    m.connId = null;
    if (connId) {
      this.conns.set(connId, null);
      this.io.send(connId, { t: 'bye' });
      this.io.close(connId, 1000, 'left');
    }
    if (this.session && r.phase === 'playing' && m.pid) this.handOver(m);   // the computer plays out their seat
    if (r.phase !== 'playing') r.members = r.members.filter(x => x !== m);
    if (r.host === m.id) r.host = this.pickHost();
    if (!this.active().length) { this.closeRoom(); return; }
    this.flush();
    this.broadcastRoom();
    this.io.persist(true);
    this.wake();
  }

  closeRoom() {
    for (const [connId] of this.conns) this.fail(connId, 'closed');
    this.conns.clear();
    this.room = null;
    this.session = null;
    this.io.persist(true);
  }

  /* ---------- time ---------- */

  tick() {
    if (!this.room) return;
    const now = this.io.now();
    this.housekeeping(now);
    if (!this.room) return;
    if (this.session && this.room.phase === 'playing') {
      const watching = this.room.members.some(m => m.pid && m.connected && !m.left);
      if (!watching) {
        this.session.pause();              // nobody at the table is here: wait for them
      } else {
        this.session.resume();
        // a phone that has gone silent (signal lost, screen locked) counts as gone
        this.room.members.forEach(m => {
          if (m.pid && m.connected && now - (this.seen.get(m.connId) || 0) > QUIET_MS) {
            const c = m.connId;
            this.io.close(c, 4002, 'quiet');
            this.disconnect(c);
          }
        });
        this.room.members.forEach(m => {
          if (m.pid && !m.connected && !m.computer && !m.left && now - (m.goneAt || 0) >= AWAY_MS) this.handOver(m);
        });
        this.session.tick();
        this.flush();
        if (this.session.state.phase === 'over') this.gameOver();
      }
    }
    this.wake();
  }

  /* Ask to be called again when time needs to pass: often during a game,
     now and then while someone is away. */
  wake() {
    if (!this.room) return;
    const people = this.active();
    if (this.room.phase === 'playing' && people.some(m => m.pid && m.connected)) { this.io.wake(TICK_MS); return; }
    if (people.some(m => !m.connected) && people.some(m => m.connected)) this.io.wake(CHECK_MS);
  }

  housekeeping(now) {
    const r = this.room;
    let changed = false;
    if (r.phase === 'lobby') {
      const before = r.members.length;
      r.members = r.members.filter(m => !m.left && (m.connected || now - (m.goneAt || 0) < LOBBY_DROP_MS));
      changed = r.members.length !== before;
    }
    const host = this.member(r.host);
    if (!host || host.left || (!host.connected && now - (host.goneAt || 0) >= HOST_WAIT_MS)) {
      const next = this.pickHost();
      if (next !== r.host && (next == null || this.member(next).connected || !host)) { r.host = next; changed = true; }
    }
    if (!this.active().length && !this.conns.size) { this.closeRoom(); return; }
    if (changed) { this.broadcastRoom(); this.io.persist(true); }
  }

  /* ---------- saving (the server object can restart at any time) ---------- */

  snapshot() {
    if (!this.room) return null;
    const now = this.io.now();
    return {
      v: 1,
      room: Object.assign({}, this.room, {
        members: this.room.members.map(m => ({
          id: m.id, token: m.token, name: m.name, since: m.since, pid: m.pid, computer: m.computer, left: m.left,
          goneAt: m.connected ? now : m.goneAt
        }))
      }),
      session: this.session ? this.session.serialize() : null
    };
  }

  load(saved) {
    if (!saved || saved.v !== 1 || !saved.room) return;
    const now = this.io.now();
    this.room = saved.room;
    this.room.members.forEach(m => { m.connected = false; m.connId = null; m.seq = 0; m.goneAt = now; });
    const s = saved.session;
    const mode = s && CT.getMode(s.modeId);
    if (mode && mode.engineVersion === s.engineVersion && s.state) {
      this.session = this.newSession({ modeId: s.modeId, state: s.state, clockAt: s.clock || 0 });
      this.session.pause();      // until someone at the table is back
    } else if (this.room.phase !== 'lobby') {
      this.room.phase = 'lobby';
      this.room.members.forEach(m => { m.pid = null; m.computer = false; });
    }
  }
}
